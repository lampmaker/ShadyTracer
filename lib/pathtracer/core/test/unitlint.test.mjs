// node lib/pathtracer/core/test/unitlint.test.mjs
//
// THE UNIT LINT FIRES (core/unitlint.js). check-shaders runs it over every kernel and every scene, and it saying nothing
// there is only worth something if it says something where it should: so here the real kernels, built on a recording
// device against a builder scene, are first clean -- and then each has a violation planted in it, one kind at a time, in
// main and one level down, and each must be named. A lint nothing has seen fire is not evidence (CLAUDE.md).
import { readFileSync } from 'node:fs'
import { unitLint, structFields, SCENE_UNIT_KERNELS } from '../unitlint.js'
import * as SA from '../scene_api.js'
import * as TB from '../tracebasics.js'
import { NOISE } from '../noise.js'
import { MATERIALS } from '../materials.js'
import { sceneConstantsWGSL } from '../uniforms.schema.js'
import * as W from '../wavefront.js'
import { prog_pick } from '../pick.js'
import { prog_opt_shade } from '../../optics/kernels.js'
import { generate } from '../../../../builder/codegen.js'
import * as Model from '../../../../builder/model.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }

const spy = { makeCompute: (body, main, uniformTypes = {}, resources = {}, opts = {}) => ({ body, main, uniformTypes, resources, opts }) }
const scene = generate(...Model.generateArgs(Model.parse(readFileSync(new URL('../../../../test/fixtures/scenes/RGBW_mixer.json', import.meta.url), 'utf8')),
    { id: 'lint-rgbw', title: 'RGBW mixer' }))
const sides = { sceneSide: [NOISE, MATERIALS, SA.SCENE_API, SA.LOCAL_POINT_LOOKED, SA.LOCAL_POINT_GIVEN, TB.SCENE_UNITS_WGSL, sceneConstantsWGSL(scene)],
                boundary: [SA.SCENE_BOUNDARY, SA.SCENE_BOUNDARY_GIVEN] }
const kernels = {
    march: await W.prog_march(spy, scene, 64),
    surface: await W.prog_surface(spy, scene, 64),
    shade: await W.prog_shade(spy, scene, 64),
    occlude: await W.prog_occlude(spy, scene, 64),
    // ...with the haze compiled in (core/haze.js): its lengths are the engine's, metres, like the rest
    surface_haze: await W.prog_surface(spy, scene, 64, { haze: 1 }),
    shade_haze: await W.prog_shade(spy, scene, 64, { haze: 1 }),
    occlude_haze: await W.prog_occlude(spy, scene, 64, { haze: 1 }),
    stepcache_fill: await W.prog_stepcache_fill(spy, scene),
    genphotons: await W.prog_genphotons(spy, 64, scene),
    emit_collect: await W.prog_emit_collect(spy, scene),
    pick: await prog_pick(spy, scene),
    opt_shade: await prog_opt_shade(spy, scene, 64),
}
for (const [name, k] of Object.entries(kernels)) {
    const p = unitLint(k, scene, name, sides)
    ok(`${name}: clean as built`, p.length === 0, p.join('\n      '))
}

/* PLANTED: each a line put into main, or a helper main calls, of a real kernel -- and what the report must name */
const plant = (k, { main = '', helper = '' }) => ({ ...k, body: `${k.body}\n${helper}`, main: `${main}\n${k.main}` })
const cases = [
    ['a direct SDF call in main', { main: 'let hh = SDF(newRay(VEC3(0.0), VEC3(0.0, 0.0, 1.0), VEC4(1.0), 1.0));' }, /main calls the scene's side directly \(SDF\)/],
    ['getMaterial2 one level down', { helper: 'fn plantedAsk(h: Hit) -> Material2 { return getMaterial2(h, false); }', main: '' }, /plantedAsk calls the scene's side directly \(getMaterial2\)/],
    ['a length in metres the scene\'s way (metres)', { main: 'let far = metres(1000.0);' }, /main calls the scene's side directly \(metres\)/],
    ['the scene\'s tolerance (marchEps)', { main: 'let e = marchEps();' }, /calls the scene's side directly \(marchEps\)/],
    ['a scene-side helper that reaches one (perMm calls metres)', { main: 'let c = perMm(2.0);' }, /calls the scene's side directly \(perMm\)/],
    ['SCN_TOL read raw', { main: 'let t = SCN_TOL;' }, /reads the scene's globals \(SCN_TOL\)/],
    ['HIT_TAG read raw', { main: 'let g = HIT_TAG;' }, /reads the scene's globals \(HIT_TAG\)/],
    ['a frame of the scene\'s (XF_S)', { main: 'let s = XF_S;' }, /reads the scene's globals \(XF_S\)/],
    ['UB.sceneUnit outside the unit functions', { main: 'let u = 1.0 / UB.sceneUnit;' }, /reads UB\.sceneUnit/],
]
for (const kname of ['march', 'shade', 'pick']) for (const [what, p, re] of cases) {
    if (kname === 'shade' && /SDF|getMaterial2/.test(what)) continue          // shade holds no scene: those do not exist there
    const got = unitLint(plant(kernels[kname], p), scene, kname, sides)
    ok(`${kname}: ${what} -- named`, got.some(l => re.test(l)), got.join(' | ') || '(nothing reported)')
}
// ...and the flags the engine may touch are not violations
{
    const got = unitLint(plant(kernels.march, { main: 'let rd = LOCAL_READY; let wt = LOCAL_WANTED;' }), scene, 'march', sides)
    ok('the scene\'s flags (LOCAL_READY, LOCAL_WANTED) are the engine\'s to touch', got.length === 0, got.join(' | '))
}
// ...the scene-unit kernels are not checked, by name, and say why
ok('field, tagfield and the probe are scene-unit kernels, with a reason each', ['field', 'tagfield', 'probe'].every(n => SCENE_UNIT_KERNELS[n]?.length > 20)
    && unitLint(plant(kernels.march, { main: 'let hh = SDF(newRay(VEC3(0.0), VEC3(0.0, 0.0, 1.0), VEC4(1.0), 1.0));' }), scene, 'field', sides).length === 0)
// ...a boundary with a second SDF call (a second copy of the scene) is named
{
    const two = { ...sides, boundary: [SA.SCENE_BOUNDARY.replace('var h = SDF(rs);', 'var h = SDF(rs); _ = SDF(rs);')] }
    ok('a boundary calling SDF twice is named', unitLint(kernels.march, scene, 'march', two).some(l => /calls SDF 2 times/.test(l)))
}

// THE RAY AND THE HIT: every field sorted into a length or not (scene_api.js), as check-shaders checks
{
    const ray = structFields(TB.DEFINITIONS, 'Ray'), hit = structFields(TB.DEFINITIONS, 'Hit')
    const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
    ok('struct Ray: its fields are RAY_LENGTHS and RAY_NOT_LENGTHS, exactly', same(ray, [...SA.RAY_LENGTHS, ...SA.RAY_NOT_LENGTHS]), JSON.stringify(ray))
    ok('struct Hit: its fields are HIT_LENGTHS and HIT_NOT_LENGTHS, exactly', same(hit, [...new Set([...SA.HIT_LENGTHS, ...SA.HIT_NOT_LENGTHS].map(f => f.split('.')[0]))]),
        JSON.stringify(hit))
    ok('...and a field added to the Ray would not be', !same([...ray, 'tFar'], [...SA.RAY_LENGTHS, ...SA.RAY_NOT_LENGTHS]))
}

console.log(`unit lint: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
