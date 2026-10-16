//======================================================================================================================
// Tests for the dichroics bench (bench/dichroics.js, Tests > dichroics). Run: node bench/test/dichroics.test.mjs
//
// The timing exists only on a card, run by a person. What can be checked is that every row is what its label says --
// one change from row 1, the frozen scene baked under its own studio light and lit by its own light's photons -- that
// the batches its note reads the rows by are the ones the engine plans, and that the camera sees the plates, the prism
// and the floor behind them (through lib/camera.js itself). What the picture looks like is the user's: BENCH.dichroics.view(1).
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { dichroicsTest, lightsOf } from '../dichroics.js'
import { BENCH, CAMERAS, BENCH_FILES, benchUrl } from '../index.js'
import { UniformSpec } from '../../lib/pathtracer/core/uniforms.schema.js'
import { planBatches } from '../../lib/pathtracer/core/photons.js'
import * as Model from '../../builder/model.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }

const load = u => readFileSync(u, 'utf8')
const T = await dichroicsTest(load)
const doc = Model.parse(load(benchUrl(BENCH_FILES.dichroics)))
const [base] = T.cases

// ---- the test as a whole
ok('a bench-kind test at 1280 x 720, the benchmark\'s timing', T.kind === 'bench' && T.size === BENCH.size && T.timed === BENCH.timed
    && T.warmup === BENCH.warmup && T.kernels === BENCH.kernels)
ok('nine rows, labels unique', T.cases.length === 9 && new Set(T.cases.map(c => c.label)).size === 9)
ok('the frozen scene is the user\'s dichroics, in mm, under the studio light', doc.unit === 'mm' && /Spectraal/.test(doc.title)
    && base.environment.envMode === 1 && base.scene.unit === 'mm')
ok('row 1: baked, the photon map on, compiled', base.baked && base.set.sppm === 1 && base.compile && /baked/.test(base.label))
ok('the last row is row 1 again', T.cases[8].scene === base.scene && JSON.stringify(T.cases[8].set) === JSON.stringify(base.set) && T.cases[8].sameTextAs === 0)

// ---- every row: its settings exist, ONE change from row 1, the same camera, environment and boxes
const changed = c => [...new Set([...Object.keys(c.set), ...Object.keys(base.set)])].filter(k => c.set[k] !== base.set[k])
for (const c of T.cases) {
    const unknown = Object.keys(c.set).filter(k => !(k in UniformSpec) && !(k in c.scene.uniforms))
    ok(`${c.label}: every setting names a uniform`, !unknown.length, unknown.join(', '))
    ok(`${c.label}: row 1's camera, environment and boxes`, c.camera === CAMERAS.dichroics && c.environment === base.environment
        && c.measureBoxes === base.measureBoxes)
}
const want = {
    'photon map off': ['sppm'], 'NEE off': ['nee'], 'the lights\' rays off': ['lightRays'],
    '1920 x 1080, photon map on': [], '1920 x 1080, photon map off': ['sppm'],
    'the step cache filled once (own cell, 4 M cells)': ['stepCache', 'stepCacheCells', 'stepCacheFill'],
    'codegen (the editing build)': [], 'baked, as it is, again (drift check)': [],
}
for (const [label, keys] of Object.entries(want)) {
    const c = T.cases.find(x => x.label === label)
    ok(`${label}: changes ${keys.length ? keys.join(', ') : 'no setting'} and nothing else`, c && JSON.stringify(changed(c).sort()) === JSON.stringify([...keys].sort()),
        c && JSON.stringify(changed(c)))
}
ok('the two 1920 x 1080 rows at 1920 x 1080, and only they', T.cases.filter(c => c.size).length === 2
    && T.cases.filter(c => c.size).every(c => c.size.width === 1920 && c.size.height === 1080 && /1920/.test(c.label)))
ok('every row the baked scene but the editing build\'s, which is codegen\'s text', T.cases.filter(c => c.scene !== base.scene).length === 1
    && T.cases[7].scene.wgsl !== base.scene.wgsl && !T.cases[7].baked)

// ---- the light: the document's one enabled light, collimated, every row
const L = lightsOf(doc)
ok('the scene\'s lights as the Optics page makes them: the one enabled sheet, collimated, 20 lm', L.length === 1
    && L[0].distribution === 'collimated' && Math.abs(L[0].flux - 20) < 1e-9 && L[0].type === 'rectangle' && L[0].onSurface === true,
    JSON.stringify(L))
ok('...lighting every row\'s picture, one photon a pixel', T.cases.every(c => c.opticsLight === base.opticsLight)
    && base.opticsLight.perPixel === 1 && base.opticsLight.sources.length === 1)

// ---- THE BATCHES THE NOTE READS THE ROWS BY (core/photons.js planBatches, as R.trace plans them): one photon a pixel; the
//      buffer as ensureBuffers sizes it -- what the sample needs, up to the engine's maxRays, about 2.31 M (read in
//      raytrace_main.js, on a device whose limits do not cut it). Held over a range of maxRays.
{
    const plan = (w, h, map, maxRays) => {
        const px = w * h, need = 2 * px
        return planBatches(Math.min(maxRays, need), [px, 0, 0, px], 1, map ? { first: [1, 2, 3] } : {}).batches
    }
    const fine = [2.1e6, 2.31e6, 3e6, 4e6].every(m => plan(1280, 720, false, m) === 1 && plan(1280, 720, true, m) === 2
        && plan(1920, 1080, false, m) === 2 && plan(1920, 1080, true, m) === 2)
    ok('at 1280 x 720 the map makes one batch two; at 1920 x 1080 it is two either way (maxRays 2.1 M to 4 M)', fine)
}

// ---- THE FRAMING, through lib/camera.js (as bench.test.mjs does it)
{
    globalThis.addEventListener ??= () => { }
    globalThis.removeEventListener ??= () => { }
    const { CAMERA } = await import('../../lib/camera.js')
    const canvas = { addEventListener() { }, removeEventListener() { }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }), style: {} }
    const camera = CAMERAS.dichroics
    const cam = CAMERA({ canvas, aspect: 1280 / 720, fov: camera.fov, up: [0, 0, 1] })
    cam.set({ mode: camera.mode })
    cam.set({ camtype: camera.camtype, fov: camera.fov, target: camera.target, azimuth: camera.azimuth, elevation: camera.elevation, distance: camera.distance })
    const g = cam.get(), u = cam.getUniforms()
    const sub = (a, b) => a.map((v, i) => v - b[i]), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    const x = u.invView.slice(0, 3), y = u.invView.slice(4, 7), z = u.invView.slice(8, 11), fx = u.invProjection[0], fy = u.invProjection[5]
    const project = P => { const d = sub(P, g.pos), zc = -dot(d, z); return zc <= 0 ? null : [dot(d, x) / (zc * fx), dot(d, y) / (zc * fy)] }
    const inside = p => p && Math.abs(p[0]) < 0.95 && Math.abs(p[1]) < 0.95
    // the plates (the mirror grid's children: the group at the origin, unrotated) and the prism, by their centres
    const grid = doc.root.children.find(n => /mirror grid/.test(n.label))
    const prism = doc.root.children.find(n => n.label === 'prism')
    ok('the mirror grid is at the origin, unturned, unscaled (its children\'s positions are the world\'s)', grid
        && ['x', 'y', 'z'].every(k => grid.transform.pos[k] === 0 && grid.transform.rot[k] === 0) && grid.transform.scale === 1)
    const centres = [...grid.children, prism].map(n => [n.transform.pos.x, n.transform.pos.y, n.transform.pos.z])
    const out = centres.filter(c => !inside(project(c)))
    ok(`every plate's centre and the prism's in the frame (${centres.length})`, out.length === 0, JSON.stringify(out))
    ok('the camera above the floor, in front of the back wall, looking down', g.pos[2] > 0 && g.pos[1] < 365 && z[2] > 0)
}

console.log(`dichroics bench: ${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
