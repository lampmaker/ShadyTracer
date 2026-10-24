//======================================================================================================================
// Tests for the over-relaxation bench (bench/relax.js, Tests > relax). Run: node bench/test/relax.test.mjs
//
// The timing exists only on a card, run by a person. What can be checked is that every row is what its label says: a
// scene's three rows the same document, text, camera, environment and boxes with only relax moved; relax 1 its own
// build and 1.3 and 1.6 one; dichroics lit as Tests > dichroics row 1 is; the drift row row 1 again. What the picture
// looks like is the user's: BENCH.relax.view(n).
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { relaxTest, SCENES, FACTORS } from '../relax.js'
import { dichroicsTest } from '../dichroics.js'
import { BENCH, CAMERAS } from '../index.js'
import { UniformSpec } from '../../lib/pathtracer/core/uniforms.schema.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }

const load = u => readFileSync(u, 'utf8')
const T = await relaxTest(load)
const N = 1 + SCENES.length

// ---- the test as a whole
ok('a bench-kind test at 1280 x 720, the benchmark\'s timing', T.id === 'relax' && T.kind === 'bench' && T.size === BENCH.size
    && T.timed === BENCH.timed && T.warmup === BENCH.warmup && T.kernels === BENCH.kernels)
ok('every scene found: dichroics and five more, each a file and a camera', SCENES.length === 5 && SCENES.every(s => s && s[2] && s[3]))
ok(`three rows a scene and the drift row (${3 * N + 1}), labels unique`, T.cases.length === 3 * N + 1
    && new Set(T.cases.map(c => c.label)).size === T.cases.length)
ok('relax is a setting', 'relax' in UniformSpec && UniformSpec.relax.def === 1)

// ---- each scene: relax 1, 1.3, 1.6, nothing else moved; 1 compiles, 1.3 compiles, 1.6 is 1.3's text
for (let s = 0; s < N; s++) {
    const rows = T.cases.slice(3 * s, 3 * s + 3), [a, b, c] = rows
    const label = a.label.replace(/, relax.*$/, '')
    ok(`${label}: relax 1, 1.3, 1.6 in order`, rows.map(r => r.set.relax).join() === FACTORS.join())
    const others = r => JSON.stringify({ ...r.set, relax: undefined })
    ok(`${label}: only relax moves -- the same scene, camera, environment, boxes, light and other settings`,
        rows.every(r => r.scene === a.scene && r.camera === a.camera && JSON.stringify(r.environment) === JSON.stringify(a.environment)
            && r.measureBoxes === a.measureBoxes && r.opticsLight === a.opticsLight && others(r) === others(a)))
    ok(`${label}: relax 1 and 1.3 each compiled, 1.6 said to be 1.3's text`, a.compile === true && b.compile === true
        && c.compile === false && c.sameTextAs === 3 * s + 1)
    ok(`${label}: every setting names a uniform`, rows.every(r => Object.keys(r.set).every(k => k in UniformSpec || k in r.scene.uniforms)))
    ok(`${label}: baked`, rows.every(r => r.baked === true && r.scene.wgsl))
}

// ---- dichroics as Tests > dichroics row 1 has it
{
    const D = (await dichroicsTest(load)).cases[0], [a] = T.cases
    ok('dichroics first: its light\'s photons (one a pixel, its one sheet), the photon map on, its camera, its studio',
        a.set.sppm === 1 && a.opticsLight.perPixel === 1 && JSON.stringify(a.opticsLight.sources) === JSON.stringify(D.opticsLight.sources)
        && a.camera === CAMERAS.dichroics && JSON.stringify(a.environment) === JSON.stringify(D.environment)
        && a.scene.wgsl === D.scene.wgsl)
    ok('...and no other scene lit by a light\'s photons or with the map asked', T.cases.slice(3, -1).every(c => !c.opticsLight && !('sppm' in c.set)))
}

// ---- the drift row
{
    const last = T.cases.at(-1), [a] = T.cases
    ok('the last row is row 1 again', last.scene === a.scene && JSON.stringify(last.set) === JSON.stringify(a.set)
        && last.sameTextAs === 0 && last.compile === false && last.opticsLight === a.opticsLight)
}

console.log(`relax bench: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
