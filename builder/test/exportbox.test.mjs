//======================================================================================================================
// Tests for the print export (exportbox.js): its box, fitted to what is printed, and the export it drives.
// Run: node builder/test/exportbox.test.mjs
//
// NO OBJECT IN THE SCENE (0.next): the box is the dialog's (printdialog.js), { frames, lo, hi } in a frame of its own.
// So: an older file's export box dropped on load (v26to27); the box fitted to the scene (lights and an open floor left
// out) and to one object in its own frame (fittedBox, over a stand-in for the measured boxes); the scene of one object
// alone (subjectTree), which the export of "the selected object" compiles -- the object where it is, nothing else in
// it. The grid: where it is in the world for a box in a moved, turned, scaled and nested frame, and that its faces fall
// half-way between grid planes. And the WHOLE EXPORT, run in node against a stand-in for the GPU kernel -- a JavaScript
// field read through the same header the kernel reads (core/field.js fieldInput) -- so the path from document to 3MF
// is exercised end to end: slabs, the box's cut, the mesher, the colour lookup back into the world, the palette, the
// file. What the stand-in cannot say is that the WGSL computes the same field; check-shaders compiles it, and the
// user's printer is the judge.
//======================================================================================================================
import * as M from '../model.js'
import { generate } from '../codegen.js'
import { exportGrid, gridProblem, boxDistance, runExport, EXPORT_DEFAULTS, corners, BOX_EDGES, fittedBox, subjectTree,
         settingsProblems, boxProblems, boxOf, centreOf, sizeOf } from '../exportbox.js'
import { framesTo } from '../bounds.js'
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
/** A box centred at `c` of full size `s`, in the world. */
const world = (c, s) => boxOf([], c, s)

//----------------------------------------------------------------------------------------------
// no box in the document
//----------------------------------------------------------------------------------------------
{
    const d = M.createDoc()
    M.addObject(d, 'root', { id: 'ball', primitive: 'sphere' })
    throws('there is no export box to add', () => M.addObject(d, 'root', { type: 'export' }), /3D print/)
    ok('...nor a function that adds one', !('addExportBox' in M) && !('setExport' in M))
    // a file of 26 with an export box in a group opens without it, the rest as it was
    const v26 = JSON.parse(M.serialize(d))
    v26.version = 26
    v26.root.children.push({ id: 'g', kind: 'group', label: 'g', enabled: true, transform: M.identity(), blend: 0, children: [
        { id: 'box', kind: 'object', type: 'export', label: 'export box', enabled: true, transform: M.identity(), material: null,
          params: { size: { x: 1, y: 1, z: 1 } }, export: { cell: 0.2 } }] })
    const up = M.parse(JSON.stringify(v26))
    ok('a file of 26 with an export box opens, at the current version, without it', up.version === M.VERSION && !M.find(up, 'box') && !!M.find(up, 'g') && !!M.find(up, 'ball'))
    eq('...and is sound', M.validate(up), [])
    const at27 = structuredClone(v26); at27.version = M.VERSION
    ok('an export box in a file of the current version is refused, by its type', M.validate(at27).some(p => /unknown object type 'export'/.test(p)))
}

//----------------------------------------------------------------------------------------------
// the settings and the box
//----------------------------------------------------------------------------------------------
{
    eq('the defaults are sound', settingsProblems(EXPORT_DEFAULTS), [])
    ok('a bad cell, a bad colour count refused', settingsProblems({ cell: 0, colours: 4 }).length === 1 && settingsProblems({ cell: 1, colours: 2.5 }).length === 1
        && settingsProblems({ cell: 1, colours: 65 }).length === 1)
    eq('a box with size is sound', boxProblems(world([0, 0, 0], [1, 2, 3])), [])
    ok('a flat one is not, nor a missing one', boxProblems(world([0, 0, 0], [1, 0, 3])).length === 1 && boxProblems(null).length === 1)
    const b = world([1, 2, 3], [4, 6, 8])
    eq('a box made from a centre and a size gives them back', [centreOf(b), sizeOf(b)], [[1, 2, 3], [4, 6, 8]])
}

//----------------------------------------------------------------------------------------------
// the box fitted to what is printed (fittedBox), over a stand-in for the measured boxes
//----------------------------------------------------------------------------------------------
{
    const d = M.createDoc(); d.unit = 'mm'
    M.addObject(d, 'root', { id: 'a', primitive: 'box', transform: T([10, 0, 0]) })
    M.addObject(d, 'root', { id: 'floor', primitive: 'plane' })
    M.addLight(d, 'root', { id: 'lamp', shape: 'disc', transform: T([0, 0, 50]) })
    M.addGroup(d, 'root', { id: 'room', transform: T([0, 0, 5]) })
    M.addObject(d, 'room', { id: 'chair', primitive: 'box', transform: T([0, 20, 0], [0, 0, 90]) })
    M.addObject(d, 'room', { id: 'rug', primitive: 'plane' })
    const own = { a: { lo: [-1, -1, -1], hi: [1, 1, 1] }, floor: { lo: [-100, -100, -1], hi: [100, 100, 0], open: true },
        lamp: { lo: [-1, -1, 0], hi: [1, 1, 0] }, room: { lo: [-100, -100, -1], hi: [100, 100, 3], open: true },
        chair: { lo: [-2, -1, -3], hi: [2, 1, 3] }, rug: { lo: [-100, -100, -1], hi: [100, 100, 0], open: true } }
    const B = { get: id => own[id] ?? null }
    const sc = fittedBox(d, B, null)
    ok('the whole scene: in the world', sc && sc.frames.length === 0)
    // a: x 9..11; the chair turned 90 degrees about z at (0, 20, 5): x -1..1, y 18..22, z 2..8; floor, lamp, rug out
    vnear('...the union of what is solid: the lights and the open floors left out, an open group looked into', [...sc.lo, ...sc.hi], [-1, -1, -1, 11, 22, 8], 1e-12)
    ok('the root is the whole scene too', JSON.stringify(fittedBox(d, B, 'root')) === JSON.stringify(sc))
    const ch = fittedBox(d, B, 'chair')
    eq('one object: its own box, in its own frame', [ch.lo, ch.hi], [[-2, -1, -3], [2, 1, 3]])
    ok('...the frames from it to the world, its own first', ch.frames.length === 2 && ch.frames[0].rot.z === 90 && ch.frames[1].pos.z === 5)
    ok('nothing for a light, or a node not measured', fittedBox(d, B, 'lamp') === null && fittedBox(d, { get: () => null }, 'a') === null)
    ok('nothing for a scene of nothing measured', fittedBox(d, { get: () => null }, null) === null)
}

//----------------------------------------------------------------------------------------------
// the scene of one object alone (subjectTree)
//----------------------------------------------------------------------------------------------
{
    const d = M.createDoc(); d.unit = 'mm'
    const red = M.addMaterial(d, { label: 'red' })
    M.addObject(d, 'root', { id: 'other', primitive: 'sphere', transform: T([5, 0, 0]) })
    M.addGroup(d, 'root', { id: 'cut', transform: T([0, 0, 10], [0, 0, 30], 2) })
    M.setMaterial(d, 'cut', red.id)
    M.addObject(d, 'cut', { id: 'base', primitive: 'box' })
    M.addObject(d, 'cut', { id: 'hole', primitive: 'cylinder', join: 'subtract', transform: T([0.2, 0, 0]) })
    M.setPattern(d, 'cut', { pos: { x: 1, y: 2, z: 3 }, rot: { x: 0, y: 0, z: 45 } })
    M.addGroup(d, 'root', { id: 'row' })
    M.setCopies(d, 'row', M.copiesRow(3, 4, 'x'))
    M.addObject(d, 'row', { id: 'peg', primitive: 'cylinder', transform: T([0, 1, 0]) })
    M.addLight(d, 'root', { id: 'lamp', shape: 'disc' })
    const ids = n => [n.id, ...(n.children || []).flatMap(ids)]
    const t = subjectTree(d, 'hole')
    eq('one object: alone at the top, inside a plain group carrying its group\'s frame', ids(t), ['root', 'cut__print', 'hole'])
    const g = t.children[0]
    ok('...the group a union of one, no code, no blend, its transform and pattern frame the group\'s', !g.csg && g.blend === 0 && !g.code
        && JSON.stringify(g.transform) === JSON.stringify(M.find(d, 'cut').node.transform) && g.pattern?.rot.z === 45)
    ok('...the object its own transform, no join (a part subtracted from another prints as itself), wearing its group\'s material',
        g.children[0].transform.pos.x === 0.2 && !('join' in g.children[0]) && g.children[0].material === red.id)
    ok('...the materials, unit and functions the scene\'s', t.materials.length === d.materials.length && t.unit === 'mm')
    // where it is: the composed frames are framesTo's, so it is exactly where the scene has it
    const chain = []
    for (let n = t; n; n = n.children?.[0]) if (n.transform && n !== t) chain.unshift(n.transform)
    eq('...its frames to the world framesTo\'s, innermost first', chain, framesTo(d, 'hole'))
    const gen = generate(subjectTree(d, 'hole'))
    ok('...and it generates: the hole drawn, nothing else of the scene', /node hole\b/.test(gen.wgsl) && !/node other\b/.test(gen.wgsl) && !/node base\b/.test(gen.wgsl))
    const p = subjectTree(d, 'peg')
    eq('in an array: one copy, the first, a group of its own', ids(p), ['root', 'row__print', 'row__copy', 'peg'])
    ok('...carrying the array\'s first copy', JSON.stringify(p.children[0].children[0].transform) === JSON.stringify(M.find(d, 'row').node.copies[0]))
    eq('a group: everything under it', ids(subjectTree(d, 'cut')), ['root', 'cut', 'base', 'hole'])
    eq('the root: the whole scene', ids(subjectTree(d, 'root')).length, ids(M.toTree(d)).length)
    throws('a light is refused', () => subjectTree(d, 'lamp'), /light/)
    M.setEnabled(d, 'cut', false)
    throws('a hidden object is refused, saying so', () => subjectTree(d, 'hole'), /hidden/)
    throws('one not in the scene too', () => subjectTree(d, 'nope'), /not in this scene/)
}

//----------------------------------------------------------------------------------------------
// the grid
//----------------------------------------------------------------------------------------------
{
    // a 10 x 6 x 4 mm box in a mm scene, 1 mm cells: 10, 6, 4 cells, one point more each side
    const d = M.createDoc(); d.unit = 'mm'
    const box = boxOf([T([5, 0, 0])], [0, 0, 0], [10, 6, 4])
    const g = exportGrid(d.unit, box, { cell: 1 })
    eq('cells fitted to the box, plus a point outside each face', g.n, [12, 8, 6])
    vnear('spacing in mm', g.spacing, [1, 1, 1])
    vnear('point (0,0,0) is half a cell outside the min corner', g.origin, [5 - 5 - 0.5, -3 - 0.5, -2 - 0.5])
    vnear('steps along the world axes', [...g.ax, ...g.ay, ...g.az], [1, 0, 0, 0, 1, 0, 0, 0, 1])
    ok('the box\'s distance is -half a cell at the first point inside, +half outside', near(boxDistance(g, 1, 3, 3), -0.5) && near(boxDistance(g, 0, 3, 3), 0.5)
        && near(boxDistance(g, 10, 3, 3), -0.5) && near(boxDistance(g, 11, 3, 3), 0.5))
    ok('...and deep inside, the nearest face', near(boxDistance(g, 5, 4, 3), -2.5 + 0.5 - 0.5) || boxDistance(g, 5, 4, 3) < -1)
    // the cell is fitted: 10 mm at 0.3 mm is 33 cells of 0.30303
    const g3 = exportGrid(d.unit, box, { cell: 0.3 })
    ok('an uneven cell is fitted to whole cells', g3.n[0] === 35 && near(g3.spacing[0], 10 / 33, 1e-12))
    // a metre scene: the cell is still millimetres of print
    const dm = M.createDoc(); dm.unit = 'm'
    const bm = world([0, 0, 0], [0.1, 0.1, 0.05])
    eq('a 10 cm box in a metre scene at 1 mm: 100 cells', exportGrid(dm.unit, bm, { cell: 1 }).n, [102, 102, 52])
    vnear('...and one step is a millimetre, in metres', exportGrid(dm.unit, bm, { cell: 1 }).ax, [0.001, 0, 0], 1e-12)
    // a box off centre in its frame (an object's measured box need not be about its origin)
    const off = exportGrid('mm', { frames: [], lo: [2, 0, 0], hi: [6, 2, 2] }, { cell: 1 })
    vnear('a box off its frame\'s origin: the grid starts half a cell outside its min corner', off.origin, [1.5, -0.5, -0.5])
    // turned, scaled and inside a moved group: the steps are the box's own axes in the world
    const dn = M.createDoc(); dn.unit = 'mm'
    const grp = M.addGroup(dn, 'root', { id: 'g', transform: T([0, 0, 10], [0, 0, 0], 2) })
    M.addObject(dn, 'g', { id: 'part', primitive: 'box', transform: T([1, 0, 0], [0, 0, 90]) })
    const bn = boxOf(framesTo(dn, 'part'), [0, 0, 0], [4, 4, 4])
    const gn = exportGrid(dn.unit, bn, { cell: 1 })
    eq('scale counts: a 4 mm box scaled twice is 8 cells', gn.n, [10, 10, 10])
    vnear('x of the box is y of the world, at the group\'s scale', gn.ax, [0, 1, 0], 1e-12)
    vnear('y of the box is -x of the world', gn.ay, [-1, 0, 0], 1e-12)
    vnear('the grid is centred where the box is', [0, 1, 2].map(k => gn.origin[k] + 4.5 * (gn.ax[k] + gn.ay[k] + gn.az[k])), [2, 0, 10], 1e-12)
    // the outline drawn over the picture is the box the grid fills: corner 0 half a step in from
    // grid point 0, corner 7 half a step in from the last
    const C = corners(bn), m = gn.n.map(k => k - 2)
    vnear('the outline\'s min corner is where the grid\'s box starts', C[0], [0, 1, 2].map(k => gn.origin[k] + 0.5 * (gn.ax[k] + gn.ay[k] + gn.az[k])), 1e-12)
    vnear('...and its max corner where it ends', C[7], [0, 1, 2].map(k => gn.origin[k] + (m[0] + 0.5) * gn.ax[k] + (m[1] + 0.5) * gn.ay[k] + (m[2] + 0.5) * gn.az[k]), 1e-12)
    ok('twelve edges, each along one axis of the box', BOX_EDGES.length === 12 && BOX_EDGES.every(([a, b]) => [1, 2, 4].includes(a ^ b)))
    void grp
    // too big
    ok('a grid past one pass per layer is refused, with a reason', /coarser/.test(gridProblem({ n: [3000, 3000, 3] })))
    ok('a grid that fits is not', gridProblem(g) === null)
    throws('a flat box is refused', () => exportGrid('mm', world([0, 0, 0], [1, 0, 1])), /no size/)
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
    const box = world([0.1, 0, 0], [0.04, 0.04, 0.02]), opts = { doc: d, box, cell: 1, colours: 2 }
    const f = p => Math.hypot(p[0] - 0.1, p[1], p[2]) - 0.015
    const colour = p => (p[0] > 0.1 ? [1, 0, 0] : [0, 0, 1])
    const calls = [], said = []
    const r = await runExport({ ...opts, sample: standIn(f, colour, calls), format: '3mf', onProgress: t => said.push(t) })
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
    const s = await runExport({ ...opts, sample: standIn(f, colour, calls2), format: 'stl' })
    ok('STL: the grid only, no colour pass', calls2.every(c => c.mode === 0))
    ok('STL: the same triangles', s.triangles === r.triangles && s.bytes.length === 84 + 50 * s.triangles)

    // nothing in the box
    let msg = ''
    try { await runExport({ ...opts, sample: standIn(() => 1, colour, []) }) } catch (e) { msg = e.message }
    ok('an empty box says so', /nothing solid/.test(msg), msg)
    // a scene change mid-export
    msg = ''
    try { await runExport({ ...opts, sample: async () => null }) } catch (e) { msg = e.message }
    ok('a scene change mid-export says so', /scene changed/.test(msg), msg)
}
{
    // a floor (half space z < 0) through a box: the box cuts it into a slab, closed
    const d = M.createDoc(); d.unit = 'mm'
    const r = await runExport({ sample: standIn(p => p[2], () => [0.5, 0.5, 0.5], []), doc: d, box: world([0, 0, 0], [10, 10, 10]), cell: 1, format: '3mf' })
    eq('a floor cut by the box is closed', r.open, 0)
    eq('...one colour', r.palette.length, 1)
}

{
    // the settings are checked before anything is sampled
    let msg = '', called = 0
    try { await runExport({ sample: async () => { called++; return null }, doc: M.createDoc(), box: world([0, 0, 0], [1, 1, 1]), cell: -1 }) } catch (e) { msg = e.message }
    ok('a bad cell is refused before any sampling', /cell/.test(msg) && called === 0, msg)
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
