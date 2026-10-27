//======================================================================================================================
// THE BENCHMARK -- one scene, one resolution, one camera, one set of settings, one change per row.
//
// Asked for by the user (2026-09-29): a performance test that renders a complex scene -- rough materials,
// reflection, refraction, light sources -- at a fixed resolution and camera position, to be run on another
// computer. It is a row in the existing test bench (lib/pathtracer/tests.js, kind 'bench'), not a harness of
// its own: the Tests menu has its button, and the report is the bench's, with a Copy button.
//
// WHAT IS FIXED, and why each is (every one of them moved a number before):
//   the SCENES      frozen copies in bench/scenes/, not the demo files, which people edit
//   the SIZE        1280 x 720, rendered offscreen (lib/pathtracer/index.js beginOffscreen): the window's size
//                   plays no part
//   the CAMERA      a constant per scene (CAMERAS below), target included
//   the SETTINGS    every renderer setting at its schema default, then the scene's own environment, then the
//                   row's change -- nothing of the session it is run from
//   the TIMING      one sample per trace, each awaited, wall clock: no governor, no pacing, no queue
// and, once per distinct scene text, an UNCACHED COMPILE of the build's own kernels (RT.compileUncached).
//
// THE ROWS. The base is the NOISE LIBRARY: the scene with the longest compile and the slowest render, "1 s a
// frame while the others are 6x faster" (the user, 2026-09-29 -- first said of Surface materials, then
// corrected: "I meant noise"). Each row after it changes ONE thing, so the row that moves the time most says
// where the difference lives. The rows on the base come first, so it is swapped in once for them, then row 1
// again as a drift check. Then scenes of their own: its reliefs in a shell (the relief as the builder now writes
// it), the same with a step bound measured for their fBm, its materials plain, its reliefs removed, each relief alone;
// the SAME physical scene in cm and m (re-authored, and converted the way a paste converts), which must render
// as the mm original does, and 20x larger; row 1 again. Then Surface materials, and the four fast scenes: other
// scenes, not a comparison, a check that the difference shows on the machine it runs on. No anisotropy or
// glass rows: the Noise library has neither.
//
// THE CAMERAS: `elevation` is degrees OFF VERTICAL (lib/camera.js:113 puts the camera at distance x
// cos(elevation) above its target; tests.js's OBLIQUE_CAMERA says "70 degrees off vertical"). The first version
// of this file took it as degrees above the horizon, which put the camera 969 mm over Surface materials'
// objects, looking down THROUGH its softbox (at 420 mm; the Noise library's is the same) -- the user saw the
// light blocking the view. Now: 65 off vertical (25 degrees down), azimuth -50, fov 40, each at the shortest
// distance that keeps every object (the objects' estimated boxes, builder/bounds.js, minus anything over 4x the
// median size: a floor, a slab) inside 90% of a 1280 x 720 frame, computed with lib/camera.js itself
// (2026-09-29). For the Noise library and Surface materials -- one layout, the same floor, softbox and rows --
// that is 850 mm, the camera 359 mm up, with the softbox out of the frame and in front of no object;
// bench/test/bench.test.mjs checks both through the same camera module, with the objects' exact corners. They
// are constants so that nothing that changes those functions can move them. What they look like is the user's
// to judge: BENCH.view(n) in the page shows row n's.
//======================================================================================================================

import * as Model from '../builder/model.js'
import { generate, uniformName, boxLoName, boxHiName } from '../builder/codegen.js'
import { createBoxes, cullBoxes, cullUniforms, cullReport } from '../builder/boxes.js'
import { stepCacheBox } from '../builder/stepbox.js'
import { MODIFIERS, RELIEF_CODE_FBM_BOUND } from '../builder/modifiers.js'
import { withoutMaterialCode, withoutGroupCode, withReliefCode, codedGroups, rescaled, converted, lengthScale, scaledCamera } from './variants.js'

export const BENCH = {
    size: { width: 1280, height: 720 },
    warmup: { samples: 3, ms: 2000 },          // discarded: emitter discovery, the first frame's timing, the photon map
    timed: { samples: 4, ms: 5000, max: 64 },  // at least 4 samples AND at least 5 s, at most 64 samples
    /* then the kernels timed on the GPU, in samples of their own (lib/pathtracer/core/kerneltime.js): at least 4
       and 1 s, at most 16 -- after the timed samples, so their timestamps cannot move the wall clock */
    kernels: { samples: 4, ms: 1000, max: 16 },
    /* then a stretch with one sample in flight (tests.js measureBench, `pipelined`): a throughput, after the timed
       samples, before the kernel-timed ones */
    pipelined: { samples: 8 },
}

const VIEW = { mode: 'orbit', camtype: 0, fov: 40, azimuth: -50, elevation: 65 }
export const CAMERAS = {
    noise: { ...VIEW, target: [0, 0, 0], distance: 850 },                    // mm
    surfaces: { ...VIEW, target: [0, 0, 0], distance: 850 },                 // mm, the same layout
    showcase: { ...VIEW, target: [-2.505, 0, 2.995], distance: 24.958 },     // m
    demo: { ...VIEW, target: [-1.939, 2.721, 0.681], distance: 30.877 },     // m
    Menger_cubes: { ...VIEW, target: [-0.042, 0.309, 0.091], distance: 50.229 },   // m
    materials: { ...VIEW, target: [-3.5, -1.5, 1.25], distance: 6.729 },     // m
    /* mm: from the front, where its light sheet comes from, 28 degrees down onto the plates, the prism and the floor
       behind them (bench/dichroics.js, 0.61.2; BENCH.dichroics.view(1) shows it) */
    dichroics: { mode: 'orbit', camtype: 0, fov: 40, azimuth: -100, elevation: 62, target: [70, 220, 25], distance: 400 },
    /* mm: the Imported parts example's own view (scenes/make.mjs imported: 35 degrees down, 330 mm off; bench/imported.js) */
    imported: { mode: 'orbit', camtype: 0, fov: 40, azimuth: -70, elevation: 55, target: [-20, 0, 8], distance: 330 },
}

export const BENCH_FILES = {
    noise: 'noise.json', surfaces: 'surfaces.json', showcase: 'showcase.json', demo: 'demo.json',
    Menger_cubes: 'Menger_cubes.json', materials: 'materials.json', dichroics: 'dichroics.json', imported: 'imported.json',
}
/** Where a frozen scene is, relative to this module: a URL in the page, a file URL in node. */
export const benchUrl = file => new URL(`./scenes/${file}`, import.meta.url)

/** The scene object the renderer takes, generated exactly as the page generates its scenes (app.html) -- or, `data`,
 *  as the builder does with its developer setting sceneData on (builder/scenedata.js). (`grid` and `exact` were the two
 *  arguments after it until 0.41.0, when the candidate grid and exact hits went.)
 *  `cull` 'dear', the default: a box test only for the top-level nodes dearer than their box, as the builder makes
 *  every scene since 0.34.0 (codegen.js, ONLY THE DEAR ONES). The bench's alone: `cull` false, made without its
 *  bounding boxes (the "bounding boxes off" rows; the renderer's `cull` off until 0.34.0), and 'all', a box test for
 *  every top-level node that draws something, as the builder made them before (Tests > boxcost). */
export const sceneOf = (doc, id, data = false, cull = 'dear') =>
    generate(...Model.generateArgs(doc, { id, title: doc.title || id, ...(data ? { data: true } : {}), ...(cull === 'dear' ? {} : { cull }) }))

/* THE BOXES A ROW CULLS WITH (builder/codegen.js: each top-level node skipped while farther than its box). The
   page measures the builder's own document; a bench scene is another document, so without this every box would
   stay unknown and the benchmark would time the renderer with its culling never on -- the second caller of the
   boxes. Measured once per document (builder/boxes.js, over the renderer's tagged field), written on every row:
   a swap resets a scene's uniforms to their defaults, which are "unknown". Written without restarting the
   picture (RT.set's reset false). Resolves to how many of the top-level nodes have a box.
     `only` (top-level ids) measures those nodes alone, and `same` (Map: id -> another id) gives a node the box
   of another: the scaling benchmark's copies (bench/scaling.js), each in its own frame the box of the original it
   was duplicated from, where measuring 32 x 20 nodes over the whole unculled scene would take minutes. */
export const boxesFor = (doc, { only = null, same = null } = {}) => {
    let B = null, V = null
    const measure = async RT => {
        B ??= createBoxes({ sample: input => RT.sampleTags(input), doc: () => doc, ...(only ? { wanted: () => only } : {}) })
        await B.update()
        /* the boxes as cullBoxes and cullReport read them: a node in `same` answers with its original's -- all three
           questions. Without `missing` (until 0.35.3) every box here was culled by as if no part had gone unfound, so
           a group whose part found no surface was culled by the rest of it: the safety net of 0.33.1 off on the very
           bench (OpticsBench, the lens pillars) it was made for */
        V ??= same ? { fresh: id => B.fresh(same.get(id) ?? id), get: id => B.get(same.get(id) ?? id), missing: id => B.missing(same.get(id) ?? id) } : B
        /* THE STEP CACHE'S BOX (builder/stepbox.js), from the same boxes, as the page sets it: inert unless the row turns
           the developer setting stepCache on (Tests > stepcache), and set for every row, so no row depends on another's */
        RT.setStepCacheBox?.(stepCacheBox(doc, V))
        /* A SCENE AS DATA (builder/scenedata.js) carries its boxes in its records, every node's under plain groups (the
           records cull each): made again with them and written, as the page does (app.html pushCull) */
        if (RT.scene?.dataOf && RT.scene.writeData) {
            const C = cullBoxes(doc, V, { nested: true })
            const r = RT.scene.dataOf(Model.toTree(doc, { keepDisabled: true }), C)
            if (r) RT.scene.writeData(r.data)
            const known = [...C.values()].filter(Boolean).length
            const unknown = r ? cullReport(doc, V).map(u => `${u.label} (${u.id}): ${u.why}`) : ['the records could not be made again for this document']
            return { known, total: C.size, unknown }
        }
        const U = RT.scene?.uniforms || {}, vals = {}
        let known = 0, total = 0
        for (const [id, b] of cullBoxes(doc, V)) {
            if (!(boxLoName(id) in U)) continue                   // draws nothing: no box test emitted
            total++; if (b) known++
            const { lo, hi } = cullUniforms(b)
            vals[boxLoName(id)] = lo; vals[boxHiName(id)] = hi
        }
        if (total) RT.set(vals, false)
        // and which went without, and why: a node never culled shows nowhere else
        const unknown = cullReport(doc, V).filter(u => boxLoName(u.id) in U).map(u => `${u.label} (${u.id}): ${u.why}`)
        return { known, total, unknown }
    }
    // what it measures and maps, for bench/test/scaling.test.mjs (only a GPU can run it)
    return Object.assign(measure, { only, same })
}

/** A document's own environment -- its light -- as renderer settings (model.js ENVIRONMENT); {} when it has none. */
const environmentOf = doc => doc.environment ? structuredClone(doc.environment) : {}

/**
 * The benchmark as a bench test. `load(url)` returns a file's text: fetch in the page, readFileSync in node.
 * Each case carries its scene, camera and environment, so a row depends on nothing but itself. `compile: true`
 * marks the rows whose scene gets an uncached compile timed (one per distinct text: the unit rows generate the
 * base's text byte for byte, and the single-relief rows would be six more long compiles of little news).
 */
export async function benchTest(load) {
    const docs = {}
    for (const [key, file] of Object.entries(BENCH_FILES)) docs[key] = Model.parse(await load(benchUrl(file)))
    const base = docs.noise
    const own = { scene: sceneOf(base, 'bench-noise'), camera: CAMERAS.noise, environment: environmentOf(base), measureBoxes: boxesFor(base) }
    /* a setting on every material that has it: the uniform codegen names after the material (uniformName) */
    const zero = (field, has) => Object.fromEntries((base.materials || []).filter(has).map(m => [uniformName(m.id, field), 0]))
    const variant = (doc, id, k = 1) => ({ scene: sceneOf(doc, id), camera: scaledCamera(CAMERAS.noise, k), environment: environmentOf(base),
                                           measureBoxes: boxesFor(doc) })
    /* ANOTHER SCENE, and the same made without its boxes right after it (0.29.0: a scene of its own, no box test in its
       text -- it was the same scene with the uniform `cull` 0, every box still tested against it at every step) */
    const other = (key, label) => {
        const row = { label: `${label} (another scene)`, scene: sceneOf(docs[key], `bench-${key}`), camera: CAMERAS[key],
                      environment: environmentOf(docs[key]), compile: true, measureBoxes: boxesFor(docs[key]) }
        return [row, { ...row, label: `${label}, bounding boxes off`, compile: false, unculled: true,
                       scene: sceneOf(docs[key], `bench-${key}-unculled`, false, false) }]
    }
    /* ONE RELIEF ALONE, named by what it is: its label in the document ("relief 1 mm / 10 mm") */
    const materials = other('materials', 'materials')
    const reliefs = codedGroups(base).map(g => ({
        label: `only ${String(g.label || g.id).replace(/^rough stone: /, '')}`,
        ...variant(withoutGroupCode(base, g.id), `bench-noise-only-${g.id}`),
    }))
    const cases = [
        { label: 'Noise library, as it is', ...own, compile: true },
        { label: 'light tracing off', ...own, set: { lt: 0 } },
        { label: 'NEE off', ...own, set: { nee: 0 } },
        { label: 'sun and sky, not the studio light', ...own, set: { envMode: 0 } },
        { label: 'softbox emission 0', ...own, set: zero('emissiveLuminance', m => (m.params?.emissiveLuminance ?? 0) > 0) },
        { label: 'maxiter 128', ...own, set: { maxiter: 128 } },
        { label: 'maxbounce 4', ...own, set: { maxbounce: 4 } },
        /* WHAT THE BOXES BUY: every object evaluated at every step again, as before the culling (2026-09-30) -- the scene
           made without them (0.29.0), so a swap before it and after it (from the pipeline cache after the first run) */
        { label: 'bounding boxes off', ...own, unculled: true, scene: sceneOf(base, 'bench-noise-unculled', false, false) },
        /* DRIFT CHECKS: row 1 again, unchanged. In the first full run (1080 Ti, 2026-09-29) lowering maxiter
           (400 -> 128) and maxbounce (10 -> 4) both read about 6% SLOWER, and the softbox dark 12% slower. A GPU
           that warms up and clocks down over the run would do that too, and without a repeat of row 1 nothing
           tells the two apart. One here, after the settings rows (the same scene object: no swap), and one
           after the unit rows, whose -2% to -11% are read against row 1. */
        { label: 'Noise library, again (drift check)', ...own, sameTextAs: 0 },
        // from here each row is a scene of its own (a swap, maybe a compile, before it -- not timed)
        /* THE RELIEF IN A SHELL (2026-09-30): its noise evaluated only within twice its reach of the plain shape
           (modifiers.js). The frozen scene keeps the relief it was frozen with, so row 1 stays what earlier runs
           measured and this row, next to the drift check above it, is what the shell changes. */
        { label: 'reliefs in a shell (as the builder writes them now)', ...variant(withReliefCode(base, MODIFIERS.relief.code), 'bench-noise-shell'), compile: true },
        /* THE RELIEF'S OWN STEP BOUND (2026-09-30): the same shell, its distances near the surface divided by a bound
           measured for its fBm itself, not the one-octave bound summed over the octaves (modifiers.js
           RELIEF_CODE_FBM_BOUND, noise.js NZ_RELIEF_LIP_MEASURED). The fifth run put the reliefs' remaining cost in
           march and occlude, the steps inside the band this lengthens: read it against the row above. What it looks
           like, against that row: BENCH.view(11) and BENCH.view(10). */
        { label: 'reliefs in a shell, step bound measured for their fBm', ...variant(withReliefCode(base, RELIEF_CODE_FBM_BOUND), 'bench-noise-shell-fbmlip'), compile: true },
        /* NOT ONLY THE CODE: a material reading p_local makes codegen track XF_P in every node block of the SDF
           (codegen.js wantLocal), at every march step; without the code that goes too. This row cannot tell the
           code, its localPoint and that bookkeeping apart -- a large delta here says "one of the three". */
        { label: 'noise materials plain (and no p_local tracking)', ...variant(withoutMaterialCode(base), 'bench-noise-plainmat'), compile: true },
        { label: 'reliefs removed (plain shapes)', ...variant(withoutGroupCode(base), 'bench-noise-noreliefs'), compile: true },
        ...reliefs,
        { label: 'in cm, re-authored', ...variant(rescaled(base, 'cm'), 'bench-noise-cm', lengthScale(base, 'cm')), sameTextAs: 0 },
        { label: 'in m, re-authored', ...variant(rescaled(base, 'm'), 'bench-noise-m', lengthScale(base, 'm')), sameTextAs: 0 },
        { label: 'in m, converted (as a paste)', ...variant(converted(base, 'm'), 'bench-noise-m-converted', lengthScale(base, 'm')), sameTextAs: 0 },
        { label: 'physically x20 (m)', ...variant(rescaled(base, 'm', 20), 'bench-noise-x20', lengthScale(base, 'm', 20)), sameTextAs: 0 },
        { label: 'Noise library, again after the unit rows (drift check)', ...own, sameTextAs: 0 },
        ...other('surfaces', 'Surface materials'),
        ...other('showcase', 'showcase'),
        ...other('demo', 'demo'),
        ...other('Menger_cubes', 'Menger cubes'),
        ...materials,
        /* A SUBMISSION PER ITERATION (raytrace_main.js R.submitEvery), on the scene where the time outside the GPU
           is the largest share (materials, 2026-10-02: 50 ms of 86) and on row 1. If the browser prepares a whole
           submission before the GPU may start, cutting it into 24 lets the GPU begin on the first while the rest
           are prepared, and these read lower than the rows they repeat; if not, they read the same or higher.
           Appended, so every row before keeps its number. */
        { ...materials[0], label: 'materials, a submission per iteration', compile: false, sameTextAs: 0, rt: { submitEvery: 1 } },
        { label: 'Noise library, a submission per iteration', ...own, sameTextAs: 0, rt: { submitEvery: 1 } },
    ]
    // the materials repeat's "= row N" is the materials row's own number
    cases[cases.length - 2].sameTextAs = cases.indexOf(materials[0])
    /* A SCENE WITH NO DEAR NODE has no box test made either way (0.34.0, codegen.js ONLY THE DEAR ONES: Surface materials,
       fourteen plain shapes): its "bounding boxes off" row is the row before's text, and says so ("= row N") */
    cases.forEach((c, i) => { if (c.unculled && i > 0 && cases[i - 1].scene.wgsl === c.scene.wgsl) c.sameTextAs = i - 1 })
    return {
        id: 'bench', kind: 'bench',
        title: 'Performance benchmark: the Noise library, 1280 x 720, fixed camera',
        note: 'One sample per trace, each awaited; wall clock. Each row after the first changes one thing on the'
            + ' frozen Noise library; the "in cm" and "in m" rows are the same physical scene and should read the'
            + ' same as the first; "physically x20" is it 20x larger. The two "again (drift check)" rows are the first'
            + ' row repeated: if they differ from it, so may every row between. "compile ms" is the build\'s kernels'
            + ' compiled uncached, all at once as a scene change compiles them, until all are ready ("= row 1": the'
            + ' same scene text; "1 failed": a kernel did not compile, named in the JSON). "boxes" is how many top-level'
            + ' nodes had a measured box to cull with (measured before the clock); each "bounding boxes off" row is the'
            + ' row above it with culling off. "gpu ms" is the GPU time of a sample\'s kernels, from timestamps on each'
            + ' kernel\'s pass, and "march", "shade" and "occlude" three of them (the JSON has every kernel): medians over'
            + ' samples of their own, after the timed ones, so they leave the wall clock alone; the gaps between'
            + ' passes are not in them, and a browser may round each timestamp. Rows 25-34 are five other scenes, each with and without its boxes:'
            + ' a check that the difference shows on this machine, not a comparison (Surface materials has no box test since 0.34.0 --'
            + ' fourteen plain shapes -- so its two rows are one text, "= row 25"). The last two rows repeat the materials'
            + ' row and row 1 with a submission per wavefront iteration. "record ms" is the JavaScript that records a'
            + ' sample; "pipelined" is ms a sample with the next one recorded while the GPU runs this one. The JSON carries each row\'s camera'
            + ' and a code fingerprint (a hash of the march, shade and occlude kernels as compiled). Save the whole text'
            + ' with the machine\'s name.'
            + ' (bench, PERFORMANCE.md.)',
        size: BENCH.size, warmup: BENCH.warmup, timed: BENCH.timed, kernels: BENCH.kernels, pipelined: BENCH.pipelined,
        cases,
    }
}
