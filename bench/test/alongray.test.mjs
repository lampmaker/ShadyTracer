//======================================================================================================================
// Tests for the answers-along-the-ray bench (bench/alongray.js, Tests > alongray). Run: node bench/test/alongray.test.mjs
//
// The timing exists only on a card, run by a person. What can be checked is that every row is what its label says: a
// scene's two rows the same document, camera, environment and boxes, the second's text codegen's with answers and nothing
// else changed, each compiled; dichroics lit as Tests > dichroics row 1 is; the prism scene the example frozen; the
// material test's low sun the one environment change; the optics bench answering nothing; the drift row row 1 again.
// What the picture looks like is the user's: BENCH.alongray.view(n).
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { alongRayTest, sceneAlong, SCENES, LOW_SUN } from '../alongray.js'
import { dichroicsTest } from '../dichroics.js'
import { BENCH, BENCH_FILES, CAMERAS, benchUrl } from '../index.js'
import * as Model from '../../builder/model.js'
import { UniformSpec } from '../../lib/pathtracer/core/uniforms.schema.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }

const load = u => readFileSync(u, 'utf8')
const T = await alongRayTest(load)
const N = 4 + SCENES.length         // dichroics, the prism scene, the material test twice, and the rest

// ---- the test as a whole
ok('a bench-kind test at 1280 x 720, the benchmark\'s timing', T.id === 'alongray' && T.kind === 'bench' && T.size === BENCH.size
    && T.timed === BENCH.timed && T.warmup === BENCH.warmup && T.kernels === BENCH.kernels)
ok('every scene found: four more after the material test, each a file and a camera', SCENES.length === 4 && SCENES.every(s => s && s[2] && s[3]))
ok(`two rows a scene and the drift row (${2 * N + 1}), labels unique`, T.cases.length === 2 * N + 1
    && new Set(T.cases.map(c => c.label)).size === T.cases.length)
ok('alongRay is a developer setting, off by default', UniformSpec.alongRay?.def === 0 && UniformSpec.alongRay.gui?.dev === true)

/* the text with answers, made back into the text without: the support block gone, every answering call its plain one, the
   band's two lines as they were -- what is left must be the row without, comments and spacing aside (an answering node's
   code is codegen's own line, its shape's call as plainshape.js reads it, not the comments and spacing the user typed) */
const unanswered = w => w
    .replace(/\n\nconst AL_NEVER[\s\S]*?\}\n\n(?=fn SDF\(r: Ray\))/, '\n')
    // an answering shape: its distance, its answer while the nearest so far, else folded in -- back to its one add_new
    .replace(/let ald_(\w+) = (\w+\(p(?:, [^;]*)?\)); if \(!\(alNearer\(ald_\1\.w \* XF_S\) && alTake\([^;]*\)\)\) \{ C = add_new\(C, ald_\1, MATERIAL\); \}/g, 'C = add_new(C, $2, MATERIAL);')
    // a plane relief's band where it is folded far -- back to the far fold
    .replace(/let alf_(\w+) = (VEC4\([^;]*\)); if \(!\(alNearer\(alf_\1\.w\) && alTake\([^;]*\)\)\) \{ C = fold\(C, alf_\1, (rm_\w+)\); \}/g, 'C = fold(C, $2, $3);')
    // a culled node's box -- back to the skip
    .replace(/if \(!\(alNearer\((bd_\w+)\) && alTake\(alBoxEntry\([^;]*\)\)\) \{ CULL = min\(CULL, \1\); \}/g, 'CULL = min(CULL, $1);')
const bare = w => w.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '')
const sameButAnswers = (on, off) => bare(unanswered(on)) === bare(off)

// ---- each scene: off, then on, nothing else moved, each its own build
for (let s = 0; s < N; s++) {
    const rows = T.cases.slice(2 * s, 2 * s + 2), [a, b] = rows
    const label = a.label.replace(/, as it is$/, '')
    ok(`${label}: off, then on`, /as it is$/.test(a.label) && /answers along the ray$/.test(b.label))
    ok(`${label}: the same camera, environment, boxes, light and settings`,
        rows.every(r => r.camera === a.camera && JSON.stringify(r.environment) === JSON.stringify(a.environment)
            && r.measureBoxes === a.measureBoxes && r.opticsLight === a.opticsLight && JSON.stringify(r.set) === JSON.stringify(a.set)))
    ok(`${label}: no alongRay in its settings (the scene's text is the switch here; the page's would rebuild the builder's)`,
        rows.every(r => !('alongRay' in r.set)))
    ok(`${label}: both compiled`, a.compile === true && b.compile === true && a.sameTextAs === undefined && b.sameTextAs === undefined)
    ok(`${label}: every setting names a uniform`, rows.every(r => Object.keys(r.set).every(k => k in UniformSpec || k in r.scene.uniforms)))
    ok(`${label}: baked`, rows.every(r => r.baked === true && r.scene.wgsl && r.scene.baked))
    const optics = /optics bench/.test(label), shapes = t => (t.match(/alTake\(A\w+\(/g) || []).length, boxes = t => (t.match(/alTake\(alBoxEntry\(/g) || []).length
    ok(`${label}: off answers nothing, on answers`, !a.scene.along && b.scene.along === true && !/AL_ON/.test(a.scene.wgsl)
        && (optics ? shapes(b.scene.wgsl) === 0 && boxes(b.scene.wgsl) > 0 : shapes(b.scene.wgsl) > 0),
        `${shapes(b.scene.wgsl)} shapes, ${boxes(b.scene.wgsl)} boxes answering`)
    ok(`${label}: on, the answers and nothing else changed`, sameButAnswers(b.scene.wgsl, a.scene.wgsl)
        && b.scene.pickWgsl === a.scene.pickWgsl && JSON.stringify(Object.keys(b.scene.uniforms)) === JSON.stringify(Object.keys(a.scene.uniforms)))
}

// ---- dichroics as Tests > dichroics row 1 has it, and the prism scene lit the same way
{
    const D = (await dichroicsTest(load)).cases[0], [a] = T.cases
    ok('dichroics first: its light\'s photons (one a pixel, its one sheet), the photon map on, its camera, its studio',
        a.set.sppm === 1 && a.opticsLight.perPixel === 1 && JSON.stringify(a.opticsLight.sources) === JSON.stringify(D.opticsLight.sources)
        && a.camera === CAMERAS.dichroics && JSON.stringify(a.environment) === JSON.stringify(D.environment)
        && a.scene.wgsl === D.scene.wgsl)
    ok('dichroics: its relief floor\'s band answers on', /alTake\(AplaneBand\(/.test(T.cases[1].scene.wgsl))
    const p = T.cases[2]
    ok('the prism scene second: its light\'s photons, the map on, 5 degrees over its table',
        /prism/.test(p.label) && p.set.sppm === 1 && p.opticsLight?.perPixel === 1 && p.opticsLight.sources.length >= 1
        && p.camera === CAMERAS.prism && CAMERAS.prism.elevation === 5)
    const frozen = Model.parse(load(benchUrl(BENCH_FILES.prism))), example = Model.parse(load(new URL('../../scenes/prism-dispersion.json', import.meta.url)))
    ok('...frozen from the example: the same document', JSON.stringify(frozen) === JSON.stringify(example))
    ok('...and its table and its light\'s rectangle answering', (T.cases[3].scene.wgsl.match(/alTake\(A\w+\(/g) || []).length >= 2)
    ok('no other scene lit by a light\'s photons or with the map asked', T.cases.slice(4, -1).every(c => !c.opticsLight && !('sppm' in c.set)))
}

// ---- the material test's low sun: its environment and LOW_SUN, nothing else
{
    const [a, , low] = T.cases.slice(4, 7)
    ok('the material test, then again with the sun at 5 degrees: the one environment change', /material test/.test(a.label) && /sun at 5 degrees/.test(low.label)
        && JSON.stringify(low.environment) === JSON.stringify({ ...a.environment, ...LOW_SUN }) && LOW_SUN.uSunElevation === 5
        && low.camera === a.camera && low.measureBoxes === a.measureBoxes && UniformSpec.envMode.def === 0 && !('envMode' in low.environment))
}

// ---- generated as the page generates it: the off row is bench/index.js sceneOf's, the on row the same with `along`
{
    const doc = Model.parse(load(benchUrl(BENCH_FILES.materials)))
    const { sceneOf } = await import('../index.js')
    ok('off is sceneOf\'s scene; on adds `along` and nothing else', sceneAlong(doc, 'x', false).wgsl === sceneOf(doc, 'x').wgsl
        && sameButAnswers(sceneAlong(doc, 'x', true).wgsl, sceneOf(doc, 'x').wgsl))
}

// ---- the drift row
{
    const last = T.cases.at(-1), [a] = T.cases
    ok('the last row is row 1 again', last.scene === a.scene && JSON.stringify(last.set) === JSON.stringify(a.set)
        && last.sameTextAs === 0 && last.compile === false && last.opticsLight === a.opticsLight)
}

console.log(`alongray bench: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
