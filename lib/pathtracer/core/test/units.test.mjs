// node lib/pathtracer/core/test/units.test.mjs
//
// THE ENGINE'S UNIT ON THE HOST'S SIDE (core/units.js, 0.36.0): the engine works in metres, a scene and the camera in
// the scene's unit, and what crosses is converted in one place each. No GPU. The facade's use of these -- the camera in
// every bag, the pick both ways, the step cache's box -- is build.test's (an mm scene through createPathTracer); the
// kernels' side, the boundary, is unitlint.test's and check-shaders'.
import { engineCamera, toEngine, toScene, metresPerUnit } from '../units.js'
import { CAMERA } from '../../../camera.js'
import { sourceRecords, placeRays } from '../../optics/sources.js'
import { SRC_VEC4, RAYSET_VEC4 } from '../../optics/kernels.js'
import { derive } from '../photometry.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const close = (a, b, rel = 1e-6) => a.length === b.length && [...a].every((x, i) => Math.abs(x - b[i]) <= rel * Math.max(1e-12, Math.abs(b[i])))

ok('metres per unit: m 1, cm 0.01, mm 0.001, none or unknown a metre', metresPerUnit({ unit: 'm' }) === 1 && metresPerUnit({ unit: 'cm' }) === 0.01
    && metresPerUnit({ unit: 'mm' }) === 0.001 && metresPerUnit({}) === 1 && metresPerUnit(null) === 1 && metresPerUnit({ unit: 'furlong' }) === 1)
ok('a point to metres and back', close(toEngine([1, -2, 3], 0.001), [0.001, -0.002, 0.003]) && close(toScene(toEngine([1, -2, 3], 0.01), 0.01), [1, -2, 3])
    && toEngine(25, 0.01) === 0.25 && Math.abs(toScene(0.25, 0.01) - 25) < 1e-12)
ok('...a typed array too, into a plain one', Array.isArray(toEngine(new Float32Array([2, 4]), 0.5)) && close(toEngine(new Float32Array([2, 4]), 0.5), [1, 2]))

// THE CAMERA: a real one (lib/camera.js), in mm
{
    const cam = CAMERA({ aspect: 2, fov: 40, near: 0.01, far: 4000, up: [0, 0, 1] })
    cam.set({ mode: 'orbit', azimuth: 30, elevation: 20, distance: 120, target: [5, 6, 7] })
    const CU = cam.getUniforms(), before = { v: [...CU.invView], p: [...CU.invProjection], c: [...CU.camPos] }
    const E = engineCamera(CU, 0, 0.001)
    ok('perspective: the position and invView\'s translation times the unit', close(E.camPos.slice(0, 3), CU.camPos.slice(0, 3).map(x => x * 0.001))
        && close([E.invView[12], E.invView[13], E.invView[14]], [CU.invView[12], CU.invView[13], CU.invView[14]].map(x => x * 0.001)), JSON.stringify(E.camPos))
    ok('...its axes and its projection untouched: directions, and tan(fov/2) with the aspect', close([...E.invView].slice(0, 12), [...CU.invView].slice(0, 12))
        && close([...E.invProjection], [...CU.invProjection]))
    ok('...and the camera\'s own arrays never written', close([...CU.invView], before.v) && close([...CU.invProjection], before.p) && close([...CU.camPos], before.c))
    // THE LENS (0.43.0): its radius and the distance in focus, lengths both; a focus of 0 the target's distance
    ok('a pinhole by default: radius 0, focused on the target', close(E.camLens.slice(0, 2), [0, 0.12]), JSON.stringify(E.camLens))
    cam.set({ aperture: 8, focus: 300 })
    const EL = engineCamera(cam.getUniforms(), 0, 0.001)
    ok('a lens of 8 mm at 300 mm: radius 4 mm and 0.3 m in metres', close(EL.camLens.slice(0, 2), [0.004, 0.3]), JSON.stringify(EL.camLens))
    ok('...the settings the camera reports, in its own units', cam.get().aperture === 8 && cam.get().focus === 300)
    cam.set({ camtype: 1, dimensions: 40 })
    ok('an orthographic camera has no lens: radius 0', cam.getUniforms().camLens[0] === 0)
    cam.set({ aperture: 0, focus: 0 })
    const O = cam.getUniforms(), EO = engineCamera(O, 1, 0.01)
    ok('orthographic: the half width, half height and depth times the unit -- lengths there (camera.js orthoInverse)',
        close([EO.invProjection[0], EO.invProjection[5], EO.invProjection[10], EO.invProjection[14]], [O.invProjection[0], O.invProjection[5], O.invProjection[10], O.invProjection[14]].map(x => x * 0.01))
        && Math.abs(O.invProjection[0] - 20) < 1e-9, JSON.stringify([...EO.invProjection]))
    ok('a metre scene: every number as it was', close([...engineCamera(CU, 0, 1).invView], [...CU.invView]) && close(engineCamera(CU, 0, 1).camPos, [...CU.camPos]))
    ok('no camera: none', engineCamera(null, 0, 0.001) === null)
}

// THE LIGHTS' SOURCES (optics/sources.js sourceRecords): places and sizes in metres; axes, angles, the ray set's index not
{
    const rect = { type: 'rectangle', pos: [1, 2, 3], axis: [0, 0, -1], u: [1, 0, 0], size: [0.5, 0.25], flux: 100, halfAngle: 60, n: 2, onSurface: true }
    const raysScene = placeRays(new Float32Array([1, 2, 3, 1, 0, 0, 1, 0, 4, 5, 6, 1, 0, 1, 0, 0]), { origin: [10, 0, 0], scale: 1 })   // two rays, scene units
    const rayset = { type: 'rayset', rays: 'f', flux: 50 }
    const m = sourceRecords([rect, rayset], new Map([['f', raysScene]]), 0.01), one = sourceRecords([rect, rayset], new Map([['f', raysScene]]), 1)
    const rec = i => m.data.subarray(i * SRC_VEC4 * 4, (i + 1) * SRC_VEC4 * 4), rec1 = i => one.data.subarray(i * SRC_VEC4 * 4, (i + 1) * SRC_VEC4 * 4)
    ok('a sheet\'s place times the unit', close([...rec(0)].slice(0, 3), [0.01, 0.02, 0.03]), JSON.stringify([...rec(0)].slice(0, 3)))
    ok('...its half sizes too', close([rec(0)[11], rec(0)[12]], [0.005, 0.0025]), JSON.stringify([rec(0)[11], rec(0)[12]]))
    ok('...everything else as in a metre scene: the cdf, the axis, the tangent, the distribution, the cone, n, the colour', close(
        [...rec(0)].filter((_, i) => ![0, 1, 2, 11, 12].includes(i)), [...rec1(0)].filter((_, i) => ![0, 1, 2, 11, 12].includes(i))))
    ok('a ray set\'s record: its index and count are not lengths', close([...rec(1)], [...rec1(1)]))
    const rpos = k => [...m.rays].slice(k * RAYSET_VEC4 * 4, k * RAYSET_VEC4 * 4 + 3), rdir = (M, k) => [...M.rays].slice(k * RAYSET_VEC4 * 4 + 4, k * RAYSET_VEC4 * 4 + 7)
    ok('...its rays\' places times the unit', close(rpos(0), [0.11, 0.02, 0.03]) && close(rpos(1), [0.14, 0.05, 0.06]), JSON.stringify([rpos(0), rpos(1)]))
    ok('...their directions and weights not', close(rdir(m, 0), rdir(one, 0)) && close(rdir(m, 1), rdir(one, 1)) && m.rays[3] === one.rays[3])
    ok('...and the description handed in is not written', close(raysScene.slice(0, 3), [11, 2, 3]))
    ok('the flux is lumens in any unit', m.flux === 150 && one.flux === 150)
}

// THE DERIVED FACTORS the boundary multiplies by (photometry.js derive): both, exact in f32
for (const [unit, a, b] of [['m', 1, 1], ['cm', 0.01, 100], ['mm', 0.001, 1000]]) {
    const D = derive({}, { unit })
    ok(`${unit}: sceneUnit x perMetre is 1, and perMetre exact in f32`, D.sceneUnit === a && D.perMetre === b && Math.fround(b) === b)
}

console.log(`units: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
