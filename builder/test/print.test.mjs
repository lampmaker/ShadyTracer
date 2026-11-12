//======================================================================================================================
// Tests for the print files (print.js): 3MF and STL.
// Run: node builder/test/print.test.mjs
//
// The ZIP is read back here by a reader written from the format, not by the writer's own code: every
// entry found through the central directory, inflated, and its CRC checked -- what a slicer's unzip
// does first. Then the 3MF's model part is checked for what a reader of the colour extension needs:
// the colour group, the object's default colour, a pid and p1 on every triangle. Whether Bambu
// Studio then paints it is for the user's screen.
//======================================================================================================================
import { zip, crc32, write3MF, writeSTL, modelXml, writeOBJ, materialName } from '../print.js'
import { createMesher, openEdges } from '../mesh.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}

async function unzip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let e = bytes.length - 22
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--
    if (e < 0) throw new Error('no end of central directory')
    const n = dv.getUint16(e + 10, true)
    let at = dv.getUint32(e + 16, true)
    const out = {}
    for (let i = 0; i < n; i++) {
        if (dv.getUint32(at, true) !== 0x02014b50) throw new Error('bad central directory entry')
        const method = dv.getUint16(at + 10, true), crc = dv.getUint32(at + 16, true)
        const csize = dv.getUint32(at + 20, true), size = dv.getUint32(at + 24, true)
        const nlen = dv.getUint16(at + 28, true), xlen = dv.getUint16(at + 30, true), clen = dv.getUint16(at + 32, true)
        const local = dv.getUint32(at + 42, true)
        const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nlen))
        if (dv.getUint32(local, true) !== 0x04034b50) throw new Error(`${name}: bad local header`)
        const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true)
        const raw = bytes.subarray(start, start + csize)
        let data = raw
        if (method === 8) data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer())
        out[name] = { data, crcOk: crc32(data) === crc, sizeOk: data.length === size, method }
        at += 46 + nlen + xlen + clen
    }
    return out
}

//----------------------------------------------------------------------------------------------
// the ZIP round-trips
//----------------------------------------------------------------------------------------------
{
    ok('crc32 of "123456789" is the check value', crc32(new TextEncoder().encode('123456789')) === 0xCBF43926)
    const big = 'abc'.repeat(100000)
    const z = await zip([{ name: 'a.txt', chunks: ['hello ', 'world'] }, { name: 'dir/b.txt', chunks: [big.slice(0, 7), big.slice(7)] }])
    const u = await unzip(z)
    ok('two entries', Object.keys(u).join() === 'a.txt,dir/b.txt')
    ok('text survives, chunks joined', new TextDecoder().decode(u['a.txt'].data) === 'hello world')
    ok('a long entry survives and is deflated', new TextDecoder().decode(u['dir/b.txt'].data) === big && u['dir/b.txt'].method === 8)
    ok('CRCs and sizes agree', Object.values(u).every(e => e.crcOk && e.sizeOk))
}

//----------------------------------------------------------------------------------------------
// a 3MF of a real mesh
//----------------------------------------------------------------------------------------------
const n = 12, s = 2 / (n - 1)
const M = createMesher(n, n, n, [s, s, s], [-1, -1, -1])
for (let z = 0; z < n; z++) {
    const L = new Float32Array(n * n)
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) L[x + n * y] = Math.hypot(-1 + x * s, -1 + y * s, -1 + z * s) - 0.7
    M.push(L)
}
const mesh = M.finish()
const nt = mesh.triangles.length / 3, nv = mesh.positions.length / 3
ok('the test mesh is closed', openEdges(mesh.triangles).length === 0)
{
    const index = Uint16Array.from({ length: nt }, (_, i) => (mesh.positions[3 * mesh.triangles[3 * i]] > 0 ? 1 : 0))
    const palette = [[1, 0.5, 0], [0, 0, 1]]
    const u = await unzip(await write3MF({ ...mesh, palette, index, name: 'a <test> & "sphere"' }))
    ok('3MF: the three parts', ['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model'].every(k => k in u), Object.keys(u).join())
    ok('3MF: every part intact', Object.values(u).every(e => e.crcOk && e.sizeOk))
    const x = new TextDecoder().decode(u['3D/3dmodel.model'].data)
    ok('in millimetres', /<model unit="millimeter"/.test(x))
    ok('a colour group of the palette, in hex', /<m:colorgroup id="1">\s*<m:color color="#FF8000"\/>\s*<m:color color="#0000FF"\/>\s*<\/m:colorgroup>/.test(x))
    ok('the object defaults to the first colour', /<object id="2" type="model" name="a &lt;test&gt; &amp; &quot;sphere&quot;" pid="1" pindex="0">/.test(x))
    ok('every vertex', (x.match(/<vertex /g) || []).length === nv)
    const tris = [...x.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)" pid="1" p1="(\d)"\/>/g)]
    ok('every triangle, with its colour', tris.length === nt && tris.every((m, i) => +m[4] === index[i] && +m[1] === mesh.triangles[3 * i]))
    ok('a build item for the object', /<build>\s*<item objectid="2"\/>\s*<\/build>/.test(x))
    // a well-formed shape: every element opened is closed, in order
    const stack = []
    let bad = null
    for (const t of x.matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) {
        if (t[3]) continue
        if (!t[1]) stack.push(t[2])
        else if (stack.pop() !== t[2]) { bad = t[2]; break }
    }
    ok('the model part nests properly', bad === null && stack.length === 0, `at ${bad}, open ${stack.join('>')}`)
}
{
    // one colour: no per-triangle properties, just the object's
    const x = [...modelXml({ ...mesh, palette: [[0.5, 0.5, 0.5]], index: new Uint16Array(nt) })].join('')
    ok('one colour: on the object only', /pid="1" pindex="0"/.test(x) && !/p1=/.test(x))
    const y = [...modelXml({ ...mesh, per: 7 })].join('')
    ok('no palette: no colour group, and chunking changes nothing', !/colorgroup/.test(y) && y === [...modelXml(mesh)].join(''))
}

//----------------------------------------------------------------------------------------------
// STL
//----------------------------------------------------------------------------------------------
{
    const b = writeSTL({ ...mesh, name: 'sphere' })
    const dv = new DataView(b.buffer)
    ok('STL: 84 + 50 bytes a triangle', b.length === 84 + 50 * nt)
    ok('STL: the count', dv.getUint32(80, true) === nt)
    let outward = 0
    for (let t = 0; t < nt; t++) {
        const at = 84 + 50 * t
        const nrm = [0, 1, 2].map(j => dv.getFloat32(at + 4 * j, true))
        const c = [0, 1, 2].map(j => (dv.getFloat32(at + 12 + 4 * j, true) + dv.getFloat32(at + 24 + 4 * j, true) + dv.getFloat32(at + 36 + 4 * j, true)) / 3)
        if (nrm[0] * c[0] + nrm[1] * c[1] + nrm[2] * c[2] > 0) outward++
    }
    ok('STL: the normals of a sphere point out', outward === nt, `${outward} of ${nt}`)
}

//----------------------------------------------------------------------------------------------
// OBJ AND ITS MTL (0.next), read back by a reader written from the format (Wavefront's): `v`, `f` 1-based, `usemtl`
// naming the material of the faces after it, `mtllib` the file; in the MTL `newmtl`, `Kd`, `Ka`, `d`. And what Bambu
// Studio's own loader does with them (print.js's header): Kd as the colour, a tenth of Ka added unless it is 0, d the
// opacity.
//----------------------------------------------------------------------------------------------
function readOBJ(text) {
    const v = [], f = [], mat = [], libs = []
    let cur = null
    for (const line of text.split('\n')) {
        const t = line.trim().split(/\s+/)
        if (t[0] === 'v') v.push(+t[1], +t[2], +t[3])
        else if (t[0] === 'f') { f.push(...t.slice(1, 4).map(x => +x.split('/')[0] - 1)); mat.push(cur) }
        else if (t[0] === 'usemtl') cur = t[1]
        else if (t[0] === 'mtllib') libs.push(t[1])
    }
    return { v, f, mat, libs }
}
function readMTL(text) {
    const m = {}
    let cur = null
    for (const line of text.split('\n')) {
        const t = line.trim().split(/\s+/)
        if (t[0] === 'newmtl') m[cur = t[1]] = {}
        else if (cur && ['Kd', 'Ka', 'd'].includes(t[0])) m[cur][t[0]] = t.slice(1).map(Number)
    }
    return m
}
{
    const index = Uint16Array.from({ length: nt }, (_, i) => (mesh.positions[3 * mesh.triangles[3 * i]] > 0 ? 1 : 0) + (mesh.positions[3 * mesh.triangles[3 * i] + 2] > 0.3 ? 1 : 0))
    const palette = [[1, 0.5, 0], [0, 0, 1], [0.25, 0.75, 0.125]]
    const { obj, mtl } = writeOBJ({ ...mesh, palette, index, name: 'a ball', mtlName: 'ball-2026.mtl' })
    const o = readOBJ(new TextDecoder().decode(obj)), m = readMTL(new TextDecoder().decode(mtl))
    ok('OBJ: every vertex, as given (to 4 decimals of a mm)', o.v.length === mesh.positions.length && o.v.every((x, i) => Math.abs(x - mesh.positions[i]) < 6e-5))
    ok('...every triangle once, closed and wound as given', o.f.length === mesh.triangles.length && openEdges(Uint32Array.from(o.f)).length === 0)
    // each written face is one of the mesh's, with its colour: by its corners
    const key = (a, b, c) => [a, b, c].join()
    const want = new Map()
    for (let i = 0; i < nt; i++) want.set(key(mesh.triangles[3 * i], mesh.triangles[3 * i + 1], mesh.triangles[3 * i + 2]), index[i])
    let wrong = 0
    for (let i = 0; i < o.f.length / 3; i++) if (o.mat[i] !== materialName(want.get(key(o.f[3 * i], o.f[3 * i + 1], o.f[3 * i + 2])))) wrong++
    ok('...each face its own colour\'s material', wrong === 0, `${wrong} wrong`)
    const runs = o.mat.filter((x, i) => i === 0 || x !== o.mat[i - 1]).length
    ok('...the faces of a colour together: one usemtl a colour', runs === 3, runs)
    ok('...naming its MTL by the name given', o.libs.join() === 'ball-2026.mtl')
    ok('MTL: a material a colour, Kd the palette\'s sRGB', Object.keys(m).length === 3 && palette.every((c, i) => m[materialName(i)].Kd.every((x, k) => Math.abs(x - c[k]) < 1e-6)), JSON.stringify(m))
    ok('...Ka 0 (Bambu Studio adds a tenth of it otherwise) and d 1 (its opacity)', Object.values(m).every(x => x.Ka.every(k => k === 0) && x.d[0] === 1))
    const plain = writeOBJ({ ...mesh })
    const p = readOBJ(new TextDecoder().decode(plain.obj))
    ok('no palette: no MTL, no usemtl, no mtllib, the same faces in their order', plain.mtl === null && p.libs.length === 0 && p.mat.every(x => x === null)
        && p.f.every((x, i) => x === mesh.triangles[i]))
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
