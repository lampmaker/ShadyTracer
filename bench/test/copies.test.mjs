// node bench/test/copies.test.mjs
//
// HOW MANY COPIES OF THE SCENE AND OF THE BSDF THE KERNELS HOLD, for every bundled scene and every benchmark scene.
// Every compiler behind WebGPU inlines every call (wgslgraph.js), so each call site of SDF, getMaterial2 or a BSDF
// function is a whole copy of it in what the driver compiles, and the driver's compile time follows that size on
// the user's card (PERFORMANCE_REVIEW.md). 0.9.5 took shade's scene questions down to one site each and 0.10.0 its
// BSDF evaluations and the pick kernel's SDF calls; nothing but this test would see a call site come back -- the
// picture would not change, only the wait for it. So the counts are pinned here, exactly, through the same call
// graph shaderstats.mjs prints, over the kernels as the renderer builds them (a device that records, not compiles).
//
// THE SCENE'S SHARE varies with the scene, and only in one way: a material that reads p_local makes getMaterial2
// evaluate the SDF once more where localPoint is LOOKED (scene_api.js SCENE_PRELUDE), so every getMaterial2 site
// carries that copy too. Those counts are written as what the kernel itself calls plus 'g' SDF per getMaterial2, g
// taken from getMaterial2's own graph in such a kernel. Where it is GIVEN (SCENE_PRELUDE_GIVEN: shade, occlusion) the
// kernel captures the point on a trip of its own SDF call, and g is 0 there for every scene.
//
// WHAT EACH COUNT IS, read in code (0.20.8):
//   surface    SDF 1, getMaterial2 1: the normal's three differences, the capture of the local point and the medium
//              beyond are trips of one loop with one SDF call and one getMaterial2 call in it (prog_surface). They
//              were shade's own until 0.20.8; before 0.20.6, SDF 2 + 2g and getMaterial2 2 there, each a whole copy.
//   shade      SDF 0, getMaterial2 0: it reads the surface kernel's answers and holds no scene.
//              makeLobes 2 (ltConnect, processMaterial_advanced), lobesEval 3 (ltConnect, Sketch's loop, NEE),
//              lobesPdf 3 (ltConnect, NEE, the bounce), misWeight 3 (the emitter hit, NEE, the bounce).
//   occlude    SDF 1, getMaterial2 1: an emitter's point captured on a trip of the march's own call.
//   opt_shade  the same BSDF through processMaterial's wrapper; localPoint looked, two calcNormals_fast, SDF 4 + 2g.
//   pick       SDF 1: the march, the capture and the six central differences are trips of one loop.
//   ..._haze   (0.62.0; core/haze.js, a scene with a haze box) the surface and occlusion kernels as without; shade with
//              misWeight 5: the medium vertex's light sample and its phase function's draw, no BSDF copy of their own.
import { readFileSync, readdirSync } from 'node:fs'
import { inlineStats } from '../wgslgraph.js'
import { prog_surface, prog_shade, prog_occlude } from '../../lib/pathtracer/core/wavefront.js'
import { prog_pick } from '../../lib/pathtracer/core/pick.js'
import { prog_opt_shade } from '../../lib/pathtracer/optics/kernels.js'
import { generate } from '../../builder/codegen.js'
import * as Model from '../../builder/model.js'
import { SCENE_FILES } from '../../scenes/index.js'
import { FIXTURE_SCENES, fixtureUrl } from '../../test/fixtures/scenes/index.js'
import { shorthand, TOKENS, SHORT_TOKENS } from '../../lib/wgsl_shorthand.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }

const rewrite = shorthand(TOKENS, SHORT_TOKENS)
const spy = { makeCompute: (body, main) => ({ body, main }) }
/* sceneAt and materialAt: the engine's only ways to the scene since 0.36.0 (scene_api.js SCENE_BOUNDARY), each one SDF or
   getMaterial2 call -- so every SDF copy a kernel holds is a sceneAt call site, plus what localPoint looks up inside a
   material (g), and a second call site of either is a second copy of the scene */
const TARGETS = ['SDF', 'getMaterial2', 'sceneAt', 'materialAt', 'calcNormals_fast', 'makeLobes', 'lobesEval', 'lobesPdf', 'misWeight', 'ltEvalBsdf',
                 'probeProcess', 'processMaterial']
const graph = async build => { const k = await build(); return inlineStats(rewrite(`${k.body}\nfn main() {\n${k.main}\n}`), 'main', TARGETS) }

const BSDF = { makeLobes: 2, lobesEval: 3, lobesPdf: 3, misWeight: 3, ltEvalBsdf: 0 }
const NONE = { makeLobes: 0, lobesEval: 0, lobesPdf: 0, misWeight: 0, ltEvalBsdf: 0, probeProcess: 0, processMaterial: 0 }
const expected = g => ({
    // shade reaches neither one-call wrapper (they ask all three questions again); the optics trace calls processMaterial
    surface: { SDF: 1, getMaterial2: 1, sceneAt: 1, materialAt: 1, calcNormals_fast: 0, ...NONE },
    shade: { SDF: 0, getMaterial2: 0, sceneAt: 0, materialAt: 0, calcNormals_fast: 0, ...BSDF, probeProcess: 0, processMaterial: 0 },
    occlude: { SDF: 1, getMaterial2: 1, sceneAt: 1, materialAt: 1, calcNormals_fast: 0, ...NONE },
    opt_shade: { SDF: 4 + 2 * g, getMaterial2: 2, sceneAt: 4, materialAt: 2, calcNormals_fast: 2, ...BSDF, probeProcess: 0, processMaterial: 1 },
    pick: { SDF: 1, getMaterial2: 0, sceneAt: 1, materialAt: 0, calcNormals_fast: 0, makeLobes: 0, lobesEval: 0, lobesPdf: 0, misWeight: 0, ltEvalBsdf: 0 },
    surface_haze: { SDF: 1, getMaterial2: 1, sceneAt: 1, materialAt: 1, calcNormals_fast: 0, ...NONE },
    shade_haze: { SDF: 0, getMaterial2: 0, sceneAt: 0, materialAt: 0, calcNormals_fast: 0, ...BSDF, misWeight: 5, probeProcess: 0, processMaterial: 0 },
    occlude_haze: { SDF: 1, getMaterial2: 1, sceneAt: 1, materialAt: 1, calcNormals_fast: 0, ...NONE },
})

const benchFiles = readdirSync(new URL('../scenes/', import.meta.url)).filter(f => f.endsWith('.json')).sort()
const sets = [['scenes', SCENE_FILES, f => new URL(`../../scenes/${f}`, import.meta.url)], ['fixtures', FIXTURE_SCENES, fixtureUrl],
              ['bench', benchFiles, f => new URL(`../scenes/${f}`, import.meta.url)]]
const gs = new Set()
for (const [set, files, url] of sets) {
    for (const file of files) {
        const scene = generate(Model.toTree(Model.parse(readFileSync(url(file), 'utf8'))), { id: file.replace('.json', ''), title: file })
        // g: the SDF copies one getMaterial2 holds where localPoint is looked -- 0, or 1 where a material reads p_local
        const g = inlineStats(rewrite(`${(await prog_opt_shade(spy, scene, 64)).body}`), 'getMaterial2', ['SDF']).copies.SDF
        gs.add(g)
        const got = { surface: await graph(() => prog_surface(spy, scene, 64)), shade: await graph(() => prog_shade(spy, scene, 64)), occlude: await graph(() => prog_occlude(spy, scene, 64)),
                      opt_shade: await graph(() => prog_opt_shade(spy, scene, 64)), pick: await graph(() => prog_pick(spy, scene)),
                      surface_haze: await graph(() => prog_surface(spy, scene, 64, { haze: 1 })), shade_haze: await graph(() => prog_shade(spy, scene, 64, { haze: 1 })),
                      occlude_haze: await graph(() => prog_occlude(spy, scene, 64, { haze: 1 })) }
        for (const [kernel, want] of Object.entries(expected(g))) {
            const have = Object.fromEntries(Object.keys(want).map(t => [t, got[kernel].copies[t]]))
            ok(`${set}/${file} ${kernel}: the copies are what they are meant to be (g ${g})`,
                Object.keys(want).every(t => have[t] === want[t]), `have ${JSON.stringify(have)}\n      want ${JSON.stringify(want)}`)
        }
    }
}
// both shapes of scene seen, or the 2g term is checked against nothing
ok('scenes with and without a p_local material are both among them', gs.has(0) && gs.has(1), [...gs].join())

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
