//======================================================================================================================
// Tests for the scaling benchmark's definition (bench/scaling.js).
// Run: node bench/test/scaling.test.mjs
//
// The timing exists only on a real GPU. What is checked here is that each row is what its label says, and that the
// copy rows differ in the number of objects and nothing else:
//   - the copy documents parse, hold the stage and exactly n lens assemblies, each a copy of the original but for its
//     ids, its label and where it stands;
//   - one march tolerance and one scene radius for every copy row (both would otherwise grow with n);
//   - the copy rows as data (since 0.22.8; their candidate-grid twins went with the grid in 0.41.0), every count one text,
//     so x 1 compiles and the others name its row;
//   - the scene's uniforms under 64 KiB in every row, computed with tinywebgpu's own layout (the ceiling, PERFORMANCE.md
//     P3) -- and codegen's: 32 copies fit, and the counts stop where it had to;
//   - THE FRAMING through lib/camera.js: every row's target at the centre, copy 1 inside the frame, and every corner of
//     every other copy BEHIND the camera and inside the radius: the same picture whatever the count;
//   - the boxes: the stage and copy 1 measured, every other copy given copy 1's box.
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { scalingTest, lensCopies, copyPosition, CAMERAS, COUNTS, COPY_RADIUS, LENS_ID, GRID } from '../scaling.js'
import { BENCH, sceneOf } from '../index.js'
import { UniformSpec, computeUniformTypes } from '../../lib/pathtracer/core/uniforms.schema.js'
import { autoEps } from '../../lib/pathtracer/core/photometry.js'
import { WEBGPU } from '../../lib/tinywebgpu/src/tinywebgpu.js'
import * as Model from '../../builder/model.js'
import { cullBoxes } from '../../builder/boxes.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }

const load = u => readFileSync(u, 'utf8')
const T = await scalingTest(load)
const bench = Model.parse(load(new URL('../scenes/OpticsBench.json', import.meta.url)))

// ---- the test as a whole
ok('a bench-kind test of its own, at the benchmark\'s size and sample rule', T.kind === 'bench' && T.id === 'scaling'
    && T.size === BENCH.size && T.timed === BENCH.timed && T.warmup === BENCH.warmup && T.kernels === BENCH.kernels)
ok('eight rows', T.cases.length === 8, `${T.cases.length}`)
ok('labels are unique', new Set(T.cases.map(c => c.label)).size === T.cases.length)
for (const c of T.cases) {
    const unknown = Object.keys(c.set || {}).filter(k => !(k in UniformSpec))
    ok(`${c.label}: its settings are renderer settings`, unknown.length === 0, unknown.join(', '))
    ok(`${c.label}: a scene, a camera, a box measurer`, !!c.scene?.wgsl && !!c.camera && typeof c.measureBoxes === 'function')
}
/* the copy rows: 4-7 as data (since 0.22.8; codegen's x 16 and x 32 never compiled in time), row 8 a repeat */
const textOf = s => JSON.stringify([s.wgsl, s.pickWgsl, s.opticsWgsl, s.opticsPickWgsl, computeUniformTypes(s.uniforms)])
const dataRows = T.cases.slice(3, 7), copyRows = dataRows
ok('rows 4-7: a row for each count, in order, as data', JSON.stringify(dataRows.map(c => c.copies)) === JSON.stringify(COUNTS)
    && dataRows.every(c => c.data && !!c.scene.data && /, as data$/.test(c.label)))
ok('...and no grid row (the candidate grid went in 0.41.0)', !T.cases.some(c => /grid$/.test(c.label)))
{
    const [b, off, b2] = T.cases
    ok('rows 1-3: the optics bench, the same made without its boxes (0.29.0: no box test in its text; not compiled uncached), OpticsBench2',
        /optics bench, as it is/.test(b.label) && off.unculled && off.scene.unculled === true && !/\bcullDist\(/.test(off.scene.wgsl)
        && /\bcullDist\(/.test(b.scene.wgsl) && !('cull' in (off.set || {})) && !off.compile && b.compile
        && /OpticsBench2/.test(b2.label) && b2.compile && b2.scene.unit === 'cm')
    const again = T.cases[7]
    ok('row 8: row 4 again, the same scene object (no swap), reported as row 4\'s text', again.scene === dataRows[0].scene
        && again.sameTextAs === 3 && !again.compile && again.set.eps === dataRows[0].set.eps)
    ok('no row turns culling off but row 2: x 32 unculled as data risks a lost GPU (scaling.js)', T.cases.every((c, i) => i === 1 || (!c.unculled && !c.scene.unculled)))
    // x 1 compiles uncached; every other count is its text, so the runner reports "= row 4" instead of compiling
    ok(`${dataRows[0].label}: compiled, and every other count names it`, dataRows[0].compile && dataRows[0].sameTextAs === undefined && T.cases[3] === dataRows[0]
        && dataRows.slice(1).every(c => !c.compile && c.sameTextAs === 3))
    const named = T.cases.filter(c => c.sameTextAs !== undefined)
    ok('every row that names another\'s text has that text, uniforms included', named.length === 4
        && named.every(c => textOf(c.scene) === textOf(T.cases[c.sameTextAs].scene)))
}

// ---- the copy documents: the stage and n assemblies, nothing else changed
{
    const stageOf = d => d.root.children.filter(c => !(c.label || '').startsWith('LENS 1')).map(c => c.id).sort()
    const strip = n => { const c = structuredClone(n); const walk = x => { delete x.id; (x.children || []).forEach(walk) }; walk(c); delete c.label; delete c.transform.pos; return c }
    const original = Model.find(bench, LENS_ID).node
    for (const n of COUNTS) {
        const { doc, copies } = lensCopies(bench, n)
        const lenses = doc.root.children.filter(c => (c.label || '').startsWith('LENS 1'))
        ok(`x ${n}: ${n} assemblies, n - 1 of them copies`, lenses.length === n && copies.size === n - 1)
        ok(`x ${n}: the stage is the table, the floor disc and the two lights`, JSON.stringify(stageOf(doc)) === JSON.stringify(['n11', 'n114', 'n43', 'n7']),
            JSON.stringify(stageOf(doc)))
        ok(`x ${n}: every copy the original but for ids, label and position`, lenses.every(L => JSON.stringify(strip(L)) === JSON.stringify(strip(original))))
        ok(`x ${n}: copy 1 is the original, where it was`, lenses[0].id === LENS_ID && JSON.stringify(lenses[0].transform.pos) === JSON.stringify(original.transform.pos))
        ok(`x ${n}: the copy rows' radius`, doc.envRadius === COPY_RADIUS)
        ok(`x ${n}: the original document untouched`, Model.find(bench, LENS_ID) && bench.root.children.length === 8)
    }
    ok('the grid holds the largest count', COUNTS.at(-1) - 1 <= GRID.columns * GRID.columns)
}

// ---- one tolerance, one radius, the uniforms under 64 KiB
{
    const one = lensCopies(bench, 1).doc
    const eps = autoEps(T.cases[3].scene.extent, one.unit)
    ok('every copy row sets the tolerance x 1 has on its own', copyRows.every(c => c.set.eps === eps) && eps > 0, `${eps}`)
    ok('...and it is not what x 32 would get on its own (the grid makes the scene bigger)', autoEps(copyRows.at(-1).scene.extent, 'cm') > eps)
    ok('every copy row\'s scene says the same radius', copyRows.every(c => c.scene.envRadius === COPY_RADIUS))

    // the uniform struct as tinywebgpu lays it out, on a device that records the buffer it would make
    globalThis.GPUBufferUsage ??= { UNIFORM: 64, STORAGE: 128, COPY_SRC: 4, COPY_DST: 8, INDIRECT: 256, MAP_READ: 1 }
    const S = WEBGPU()
    S.device = { createBuffer: ({ size }) => ({ size }), queue: { writeBuffer() { } } }
    const bytes = scene => S.makeSchema(computeUniformTypes(scene.uniforms)).uniformBuffer.size
    for (const c of T.cases) ok(`${c.label}: its uniforms under 64 KiB`, bytes(c.scene) <= 65536, `${bytes(c.scene)} B`)
    /* WHERE CODEGEN STOPPED, and why the counts end at 32: as codegen every copy's values are uniforms. The rows are as data
       now, whose copies are records (one struct whatever the count, below), so this is codegen's, made here */
    const warn = console.warn; console.warn = () => { }
    const codegen = n => sceneOf(lensCopies(bench, n).doc, 'scaling')
    const b32 = bytes(codegen(32)), b1 = bytes(codegen(1)), per = (b32 - b1) / 31
    console.warn = warn
    const most = 32 + Math.floor((65536 - b32) / per)
    ok('codegen\'s ceiling is near: no more than 40 copies would fit', most >= 32 && most <= 40, `${b32} B at 32, ${per.toFixed(0)} B a copy, ${most} at most`)
    console.log(`  codegen's uniforms: ${b1} B at 1 copy, ${b32} B at 32, ${per.toFixed(0)} B a copy; about ${most} would fill 64 KiB`)
}

// ---- the framing, through lib/camera.js itself
{
    globalThis.addEventListener ??= () => { }
    globalThis.removeEventListener ??= () => { }
    const { CAMERA } = await import('../../lib/camera.js')
    const canvas = { addEventListener() { }, removeEventListener() { }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }), style: {} }
    const sub = (a, b) => a.map((v, i) => v - b[i]), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    const frame = camera => {
        const cam = CAMERA({ canvas, aspect: 1280 / 720, fov: camera.fov, up: [0, 0, 1] })
        cam.set({ mode: camera.mode })
        cam.set({ camtype: camera.camtype, fov: camera.fov, target: camera.target, azimuth: camera.azimuth, elevation: camera.elevation, distance: camera.distance })
        const g = cam.get(), u = cam.getUniforms()
        const x = u.invView.slice(0, 3), y = u.invView.slice(4, 7), z = u.invView.slice(8, 11), fx = u.invProjection[0], fy = u.invProjection[5]
        return { pos: g.pos, project: P => { const d = sub(P, g.pos), zc = -dot(d, z); return zc <= 0 ? null : [dot(d, x) / (zc * fx), dot(d, y) / (zc * fy)] } }
    }
    const corners = b => { const o = []; for (const X of [b.lo[0], b.hi[0]]) for (const Y of [b.lo[1], b.hi[1]]) for (const Z of [b.lo[2], b.hi[2]]) o.push([X, Y, Z]); return o }
    for (const c of T.cases) {
        const p = frame(c.camera).project(c.camera.target)
        ok(`${c.label}: the target at the centre of the frame`, p && Math.abs(p[0]) < 1e-6 && Math.abs(p[1]) < 1e-6)
    }
    ok('every copy row has the one camera', copyRows.every(c => c.camera === CAMERAS.lens))
    // the assembly's box in its own frame, from the document's estimate (bounds.js): -10..10 x, -10..10 y, -2.5..26 z
    const own = { lo: [-10, -10, -2.5], hi: [10, 10, 26] }
    const at = p => ({ lo: [p.x + own.lo[0], p.y + own.lo[1], p.z + own.lo[2]], hi: [p.x + own.hi[0], p.y + own.hi[1], p.z + own.hi[2]] })
    const F = frame(CAMERAS.lens)
    ok('copy 1 inside the frame', corners(at(copyPosition(1))).map(F.project).every(q => q && Math.abs(q[0]) < 1 && Math.abs(q[1]) < 1))
    const rest = Array.from({ length: COUNTS.at(-1) - 1 }, (_, i) => corners(at(copyPosition(i + 2)))).flat()
    ok('every other copy behind the camera: nothing of it in the picture', rest.every(q => F.project(q) === null))
    ok('...and inside the radius', rest.every(q => Math.hypot(...q) < COPY_RADIUS), `${Math.max(...rest.map(q => Math.hypot(...q))).toFixed(1)} cm`)
    // the grid's direction is the camera's: copyPosition's reading of lib/camera.js, checked against it
    const h = sub(F.pos, CAMERAS.lens.target), az = CAMERAS.lens.azimuth * Math.PI / 180
    ok('the camera stands at its azimuth from the target, as copyPosition assumes',
        Math.abs(Math.atan2(h[1], h[0]) - az) < 1e-6 && Math.abs(Math.hypot(h[0], h[1]) - CAMERAS.lens.distance * Math.sin(CAMERAS.lens.elevation * Math.PI / 180)) < 1e-6)
    const doc32 = lensCopies(bench, 32).doc
    ok('the documents put the copies where copyPosition says', doc32.root.children.filter(c => (c.label || '').startsWith('LENS 1 #'))
        .every(c => { const k = +c.label.split('#')[1]; return JSON.stringify(c.transform.pos) === JSON.stringify(copyPosition(k)) }))
}

// ---- the boxes: the stage and copy 1 measured, the others given copy 1's -- each part its counterpart's
{
    const nodes = n => [n, ...(n.children || []).flatMap(nodes)]
    const ofOriginal = nodes(Model.find(bench, LENS_ID).node)
    const byId = new Map(ofOriginal.map(x => [x.id, x]))
    for (const c of copyRows) {
        const m = c.measureBoxes, { doc } = lensCopies(bench, c.copies)
        const lenses = doc.root.children.filter(x => (x.label || '').startsWith('LENS 1 #'))
        ok(`x ${c.copies}: the stage and copy 1 measured, nothing else`, JSON.stringify([...m.only].sort()) === JSON.stringify(['n11', 'n114', LENS_ID, 'n43', 'n7'].sort()),
            JSON.stringify(m.only))
        ok(`x ${c.copies}: every other copy given copy 1's box`, lenses.every(L => m.same.get(L.id) === LENS_ID))
        ok(`x ${c.copies}: ...and every part of it its counterpart's, of the same kind`, m.same.size === (c.copies - 1) * ofOriginal.length
            && lenses.flatMap(nodes).every(x => { const o = byId.get(m.same.get(x.id)); return o && o.kind === x.kind && o.type === x.type }),
            `${m.same.size} mapped, ${(c.copies - 1) * ofOriginal.length} nodes in the copies`)
        /* THE DEFECT THIS GUARDS (0.22.8): with only the copies mapped, their parts had no box -- 38 of 100 known at x 32 --
           and the candidate grid walked each part with none everywhere outside its volume. Through cullBoxes as the bench
           reads it, with a stand-in measurer that knows what `only` measures: every node a box. */
        const measured = new Set(doc.root.children.filter(x => [...m.only].includes(x.id)).flatMap(nodes).map(x => x.id))
        const unit = { lo: [-1, -1, -1], hi: [1, 1, 1], cell: 0.1 }
        const C = cullBoxes(doc, { fresh: id => measured.has(m.same.get(id) ?? id), get: id => measured.has(m.same.get(id) ?? id) ? unit : null,
                                   missing: () => [] }, { nested: true })
        const known = [...C.values()].filter(Boolean).length
        ok(`x ${c.copies}: every node the records cull has a box`, known === C.size, `${known}/${C.size}`)
    }
}
for (const c of T.cases.slice(0, 3))
    ok(`${c.label}: every node measured, nothing mapped`, c.measureBoxes.only === null && c.measureBoxes.same === null)

/* ---- STEP 4's CHECK, AS FAR AS TEXT GOES (roadmap/ARCHITECTURE.md: the lens assembly x 32 compiles like x 1): as data,
   every count is the same shader and the same uniforms -- the copies are records. Until 0.22.0 each copy's shell was code
   of its own (the scene's materials read p_local), 410 KB of text at 32 against 38 KB at 1, and the card took 52 s to
   compile it. Codegen grows with the count, as it must. What the card does with one text is the card's to say. */
{
    const warn = console.warn; console.warn = () => { }
    const as = n => sceneOf(lensCopies(bench, n).doc, 'scaling', true)
    const one = textOf(as(1))
    ok('as data: 4, 16 and 32 copies are the text of 1, and its uniforms', COUNTS.slice(1).every(n => textOf(as(n)) === one))
    const c1 = sceneOf(lensCopies(bench, 1).doc, 'scaling'), c32 = sceneOf(lensCopies(bench, 32).doc, 'scaling')
    console.warn = warn
    ok('codegen: 32 copies are more text than 1 (the representation the data rows replace)', c32.wgsl.length > 10 * c1.wgsl.length)
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
