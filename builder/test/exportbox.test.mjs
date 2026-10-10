//======================================================================================================================
// Tests for the export box and the export it drives (exportbox.js).
// Run: node builder/test/exportbox.test.mjs
//
// The box as a document object: added, validated, saved and loaded, copied, and emitted as nothing.
// The grid: where it is in the world for a box moved, turned, scaled and nested, and that its faces
// fall half-way between grid planes. And the WHOLE EXPORT, run in node against a stand-in for the GPU
// kernel -- a JavaScript field read through the same header the kernel reads (core/field.js
// fieldInput) -- so the path from document to 3MF is exercised end to end: slabs, the box's cut,
// the mesher, the colour lookup back into the world, the palette, the file. What the stand-in cannot
// say is that the WGSL computes the same field; check-shaders compiles it, and the user's printer
// is the judge.
//======================================================================================================================
import * as M from '../model.js'
import { generate } from '../codegen.js'
import { exportGrid, gridProblem, boxDistance, runExport, exportOf, EXPORT_DEFAULTS, boxCorners, BOX_EDGES } from '../exportbox.js'
import { openEdges, meshVolume } from '../mesh.js'
import { FIELD_GRID, FIELD_HEADER } from '../../lib/pathtracer/core/field.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e
const vnear = (name, got, want, e = 1e-9) => ok(name, got.every((v, i) => near(v, want[i], e)), `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
const throws = (name, fn, match) => {
    try { fn() } catch (e) { ok(name, !match || match.test(e.message), `threw: ${e.message}`); return }
    ok(name, false, 'did not throw')
}
const T = (pos = [0, 0, 0], rot = [0, 0, 0], scale = 1) => ({ pos: { x: pos[0], y: pos[1], z: pos[2] }, rot: { x: rot[0], y: rot[1], z: rot[2] }, scale })

//----------------------------------------------------------------------------------------------
// the box in the document
//----------------------------------------------------------------------------------------------
{
    const d = M.createDoc()
    const s = M.addObject(d, 'root', { id: 'ball', primitive: 'sphere' })
    const before = generate(M.toTree(d))
    const b = M.addExportBox(d, 'root', { id: 'box', size: { x: 2, y: 3, z: 4 } })
    eq('a box is an object of type export, with a size and no material', [b.kind, b.type, b.material, b.params], ['object', 'export', null, { size: { x: 2, y: 3, z: 4 } }])
    eq('...and a sound document', M.validate(d), [])
    eq('its settings default', exportOf(b), { ...EXPORT_DEFAULTS })
    const back = M.parse(M.serialize(d))
    eq('it saves and loads as it was', M.find(back, 'box').node, b)
    M.setExport(d, 'box', { cell: 0.2, colours: 8 })
    eq('settings are set', b.export, { cell: 0.2, colours: 8 })
    M.setExport(d, 'box', { cell: EXPORT_DEFAULTS.cell })
    eq('...and one set back to its default is dropped', b.export, { colours: 8 })
    throws('a bad cell is refused', () => M.setExport(d, 'box', { cell: 0 }), /cell/)
    throws('a bad colour count is refused', () => M.setExport(d, 'box', { colours: 2.5 }), /colours/)
    throws('an unknown setting is refused', () => M.setExport(d, 'box', { speed: 3 }), /unknown/)
    throws('a flat box is refused', () => M.addExportBox(d, 'root', { size: { x: 1, y: 0, z: 1 } }), /size/)
    throws('addObject will not make one', () => M.addObject(d, 'root', { type: 'export' }), /addExportBox/)
    throws('it takes no parameters of its own', () => M.addParam(d, 'box', 'radius', 1), /no parameter/)
    const bad = structuredClone(d); M.find(bad, 'box').node.material = 'x'
    ok('a file with a box that has a material does not load', M.validate(bad).some(p => /no material/.test(p)))
    const withCode = structuredClone(d); M.find(withCode, 'box').node.code = 'C = C;'
    ok('...nor one with code', M.validate(withCode).some(p => /no code/.test(p)))
    const copy = M.duplicate(d, 'box')
    ok('it duplicates with its settings', copy.type === 'export' && copy.export?.colours === 8 && copy.id !== 'box')

    // the renderer sees nothing of it but the uniforms the builder writes to
    const after = generate(M.toTree(d))
    ok('it draws nothing: the SDF is the one without it, plus comments', after.wgsl.replace(/^\s*\/\/ node \w+ \(export\).*\n/gm, '') === before.wgsl,
        after.wgsl.split('\n').filter(l => !before.wgsl.includes(l)).join('\n'))
    ok('its transform and size are declared uniforms, so a drag or a slider is not refused', ['xf_box', 'size_box'].every(k => k in after.uniforms))
    eq('it does not change the scene\'s size estimate', after.extent, before.extent)
    // ...and inside a CSG group it is not one of the shapes combined: an intersect with it first
    // would have taken its empty Hit as the base, and one with it later the far side of nothing
    for (const op of ['intersect', 'subtract']) for (const first of [true, false]) {
        const c = M.createDoc()
        M.addGroup(c, 'root', { id: 'cut' })
        M.addObject(c, 'cut', { id: 'a', primitive: 'box' })
        M.addObject(c, 'cut', { id: 'b', primitive: 'sphere', join: op })
        const plain = generate(M.toTree(c))
        M.addExportBox(c, 'cut', { id: 'box' }, first ? 0 : undefined)
        const w = generate(M.toTree(c))
        const strip = t => t.replace(/^\s*\/\/ node \w+ \(export\).*\n/gm, '')
        ok(`an export box ${first ? 'first' : 'last'} in a ${op} group changes nothing but a comment`, strip(w.wgsl) === plain.wgsl && strip(w.pickWgsl) === plain.pickWgsl,
            w.wgsl.split('\n').filter(l => !plain.wgsl.includes(l)).join('\n'))
        ok(`...and still declares its uniforms (${op})`, 'xf_box' in w.uniforms && 'size_box' in w.uniforms)
    }
    // an export box does not make a version 10 file look like one of the optics branch's
    const v10 = structuredClone(d); M.find(v10, 'ball').node.params.radius = 0.25; v10.version = 10
    const up = M.upgrade(v10)
    eq('a file with a box is not taken for the optics branch\'s', M.find(up, 'box').node, M.find(v10, 'box').node)
    void s
}

//----------------------------------------------------------------------------------------------
// the grid
//----------------------------------------------------------------------------------------------
{
    // a 10 x 6 x 4 mm box in a mm scene, 1 mm cells: 10, 6, 4 cells, one point more each side
    const d = M.createDoc(); d.unit = 'mm'
    M.addExportBox(d, 'root', { id: 'box', size: { x: 10, y: 6, z: 4 }, transform: T([5, 0, 0]), cell: 1 })
    const g = exportGrid(d, 'box')
    eq('cells fitted to the box, plus a point outside each face', g.n, [12, 8, 6])
    vnear('spacing in mm', g.spacing, [1, 1, 1])
    vnear('point (0,0,0) is half a cell outside the min corner', g.origin, [5 - 5 - 0.5, -3 - 0.5, -2 - 0.5])
    vnear('steps along the world axes', [...g.ax, ...g.ay, ...g.az], [1, 0, 0, 0, 1, 0, 0, 0, 1])
    ok('the box\'s distance is -half a cell at the first point inside, +half outside', near(boxDistance(g, 1, 3, 3), -0.5) && near(boxDistance(g, 0, 3, 3), 0.5)
        && near(boxDistance(g, 10, 3, 3), -0.5) && near(boxDistance(g, 11, 3, 3), 0.5))
    ok('...and deep inside, the nearest face', near(boxDistance(g, 5, 4, 3), -2.5 + 0.5 - 0.5) || boxDistance(g, 5, 4, 3) < -1)
    // the cell is fitted: 10 mm at 0.3 mm is 33 cells of 0.30303
    const g3 = exportGrid(d, 'box', { cell: 0.3 })
    ok('an uneven cell is fitted to whole cells', g3.n[0] === 35 && near(g3.spacing[0], 10 / 33, 1e-12))
    // a metre scene: the cell is still millimetres of print
    const dm = M.createDoc(); dm.unit = 'm'
    M.addExportBox(dm, 'root', { id: 'box', size: { x: 0.1, y: 0.1, z: 0.05 }, cell: 1 })
    eq('a 10 cm box in a metre scene at 1 mm: 100 cells', exportGrid(dm, 'box').n, [102, 102, 52])
    vnear('...and one step is a millimetre, in metres', exportGrid(dm, 'box').ax, [0.001, 0, 0], 1e-12)
    // turned, scaled and inside a moved group: the steps are the box's own axes in the world
    const dn = M.createDoc(); dn.unit = 'mm'
    const grp = M.addGroup(dn, 'root', { id: 'g', transform: T([0, 0, 10], [0, 0, 0], 2) })
    M.addExportBox(dn, 'g', { id: 'box', size: { x: 4, y: 4, z: 4 }, transform: T([1, 0, 0], [0, 0, 90]), cell: 1 })
    const gn = exportGrid(dn, 'box')
    eq('scale counts: a 4 mm box scaled twice is 8 cells', gn.n, [10, 10, 10])
    vnear('x of the box is y of the world, at the group\'s scale', gn.ax, [0, 1, 0], 1e-12)
    vnear('y of the box is -x of the world', gn.ay, [-1, 0, 0], 1e-12)
    vnear('the grid is centred where the box is', [0, 1, 2].map(k => gn.origin[k] + 4.5 * (gn.ax[k] + gn.ay[k] + gn.az[k])), [2, 0, 10], 1e-12)
    // the outline drawn over the picture is the box the grid fills: corner 0 half a step in from
    // grid point 0, corner 7 half a step in from the last
    const C = boxCorners(dn, 'box'), m = gn.n.map(k => k - 2)
    vnear('the outline\'s min corner is where the grid\'s box starts', C[0], [0, 1, 2].map(k => gn.origin[k] + 0.5 * (gn.ax[k] + gn.ay[k] + gn.az[k])), 1e-12)
    vnear('...and its max corner where it ends', C[7], [0, 1, 2].map(k => gn.origin[k] + (m[0] + 0.5) * gn.ax[k] + (m[1] + 0.5) * gn.ay[k] + (m[2] + 0.5) * gn.az[k]), 1e-12)
    ok('twelve edges, each along one axis of the box', BOX_EDGES.length === 12 && BOX_EDGES.every(([a, b]) => [1, 2, 4].includes(a ^ b)))
    ok('no outline for anything else', boxCorners(dn, 'g') === null)
    void grp
    // too big
    ok('a grid past one pass per layer is refused, with a reason', /coarser/.test(gridProblem({ n: [3000, 3000, 3] })))
    ok('a grid that fits is not', gridProblem(g) === null)
    throws('a code node is not an export box', () => exportGrid(d, 'root'), /not an export box/)
}

//----------------------------------------------------------------------------------------------
// the whole export, against a field in JavaScript read through the kernel's own header
//----------------------------------------------------------------------------------------------
/** What field.js computes, for a scene given as f(world point) and colour(world point). */
const standIn = (f, colour, calls) => async (input, outFloats) => {
    const u = new Uint32Array(input.buffer)
    const count = u[3], nx = u[7], ny = u[11], mode = u[15]
    const v = k => [input[4 * k], input[4 * k + 1], input[4 * k + 2]]
    const out = new Float32Array(outFloats)
    calls.push({ mode, count })
    for (let i = 0; i < count; i++) {
        if (mode === FIELD_GRID) {
            const ix = i % nx, iy = Math.floor(i / nx) % ny, iz = Math.floor(i / (nx * ny))
            const p = [0, 1, 2].map(a => v(0)[a] + ix * v(1)[a] + iy * v(2)[a] + iz * v(3)[a])
            out[i] = f(p)
        } else {
            const p = v(FIELD_HEADER + i)
            out.set([...colour(p), 7], 4 * i)
        }
    }
    return out
}
async function unzipModel(bytes) {
    // the model part is the last entry: find its local header and inflate
    const dv = new DataView(bytes.buffer, bytes.byteOffset)
    let at = 0, text = null
    while (dv.getUint32(at, true) === 0x04034b50) {
        const cs = dv.getUint32(at + 18, true), nl = dv.getUint16(at + 26, true), xl = dv.getUint16(at + 28, true)
        const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nl))
        const raw = bytes.subarray(at + 30 + nl + xl, at + 30 + nl + xl + cs)
        if (name === '3D/3dmodel.model')
            text = new TextDecoder().decode(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer())
        at += 30 + nl + xl + cs
    }
    return text
}
{
    // a metre scene: a sphere of 30 mm at (0.1, 0, 0), red on +x and blue on -x of its centre, cut
    // by a box of 40 x 40 x 20 mm centred on it -- the top and bottom 5 mm of the sphere are cut off
    const d = M.createDoc({ title: 'ball' }); d.unit = 'm'
    M.addExportBox(d, 'root', { id: 'box', size: { x: 0.04, y: 0.04, z: 0.02 }, transform: T([0.1, 0, 0]), cell: 1, colours: 2 })
    const f = p => Math.hypot(p[0] - 0.1, p[1], p[2]) - 0.015
    const colour = p => (p[0] > 0.1 ? [1, 0, 0] : [0, 0, 1])
    const calls = [], said = []
    const r = await runExport({ sample: standIn(f, colour, calls), doc: d, id: 'box', format: '3mf', onProgress: t => said.push(t) })
    ok('the grid is sampled, then the triangles coloured', calls[0].mode === 0 && calls.at(-1).mode === 1)
    ok('...every grid point once', calls.filter(c => c.mode === 0).reduce((s, c) => s + c.count, 0) === r.grid.n.reduce((a, b) => a * b))
    ok('...every triangle once', calls.filter(c => c.mode === 1).reduce((s, c) => s + c.count, 0) === r.triangles)
    eq('the mesh is closed', r.open, 0)
    // a sphere of radius 15 cut at z = +-10: the cap above 10 is pi h^2 (3R - h) / 3 with h = 5
    const cap = Math.PI * 25 * (45 - 5) / 3, want = 4 / 3 * Math.PI * 15 ** 3 - 2 * cap
    const x = await unzipModel(r.bytes)
    const P = [...x.matchAll(/<vertex x="([-\d.e]+)" y="([-\d.e]+)" z="([-\d.e]+)"\/>/g)].map(m => [+m[1], +m[2], +m[3]]).flat()
    const Tr = [...x.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"(?: pid="1" p1="(\d+)")?\/>/g)]
    const tris = Tr.flatMap(m => [+m[1], +m[2], +m[3]])
    const v = meshVolume(P, tris)
    ok('the file holds the cut sphere: its volume in mm^3 within 2%', Math.abs(v / want - 1) < 0.02, `volume ${v}, want ${want}`)
    ok('...closed in the file too', openEdges(tris).length === 0)
    const zs = P.filter((_, i) => i % 3 === 2)
    ok('...in the box\'s frame, min corner at 0: z from 0 to 20 mm, the cut faces flat on the box', near(Math.min(...zs), 0, 1e-3) && near(Math.max(...zs), 20, 1e-3),
        `${Math.min(...zs)} .. ${Math.max(...zs)}`)
    eq('two colours, as asked', r.palette.length, 2)
    ok('...in the colour group', /<m:color color="#FF0000"\/>/.test(x) && /<m:color color="#0000FF"\/>/.test(x))
    // the colour lookup went back to the world: triangles right of the centre (x > 20 mm in the box) are red
    const red = r.palette.findIndex(c => c[0] === 1)
    const wrong = Tr.filter(m => {
        const cx = (P[3 * m[1]] + P[3 * m[2]] + P[3 * m[3]]) / 3
        return Math.abs(cx - 20) > 0.5 && (cx > 20) !== (+m[4] === red)
    }).length
    ok('...and each triangle has the colour of where it is in the world', wrong === 0, `${wrong} wrong`)
    ok('progress was said', said.some(t => /meshing/.test(t)) && said.some(t => /colouring/.test(t)))

    // STL: no colour lookup at all
    const calls2 = []
    const s = await runExport({ sample: standIn(f, colour, calls2), doc: d, id: 'box', format: 'stl' })
    ok('STL: the grid only, no colour pass', calls2.every(c => c.mode === 0))
    ok('STL: the same triangles', s.triangles === r.triangles && s.bytes.length === 84 + 50 * s.triangles)

    // nothing in the box
    let msg = ''
    try { await runExport({ sample: standIn(() => 1, colour, []), doc: d, id: 'box' }) } catch (e) { msg = e.message }
    ok('an empty box says so', /nothing solid/.test(msg), msg)
    // a scene change mid-export
    msg = ''
    try { await runExport({ sample: async () => null, doc: d, id: 'box' }) } catch (e) { msg = e.message }
    ok('a scene change mid-export says so', /scene changed/.test(msg), msg)
}
{
    // a floor (half space z < 0) through a box: the box cuts it into a slab, closed
    const d = M.createDoc(); d.unit = 'mm'
    M.addExportBox(d, 'root', { id: 'box', size: { x: 10, y: 10, z: 10 }, cell: 1 })
    const r = await runExport({ sample: standIn(p => p[2], () => [0.5, 0.5, 0.5], []), doc: d, id: 'box', format: '3mf' })
    eq('a floor cut by the box is closed', r.open, 0)
    eq('...one colour', r.palette.length, 1)
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
