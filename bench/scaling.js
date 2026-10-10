//======================================================================================================================
// THE SCALING BENCHMARK -- how a sample's time grows with the number of objects in the scene (PERFORMANCE.md P3, step 0).
//
// A second bench test beside the benchmark (bench/index.js), with its own button: a few minutes, where the benchmark is
// twenty-five. Its question decides the order of P3's work: if march and occlusion grow about linearly with the number
// of objects, a BVH over them is worth its code; if they stay flat, the time is elsewhere and P3 is about edits alone.
//
// THE ROWS:
//   the optics bench as it is, and with its boxes off      the scene P3 was weighed on, never timed (8 top-level nodes,
//                                                         93 in all); the boxes-off row says what culling buys there
//   OpticsBench2 as it is                                 the user's newest and heaviest scene (2026-10-03)
//   its lens assembly x 1, 4, 16, 32, as data             the same picture each time: copy 1 framed, the others in a
//                                                         grid BEHIND THE CAMERA, so nothing changes on screen but the
//                                                         number of objects every step tests
//   x 1 as data again                                     the drift check: the card's clock moves over a run
//
// WHY THE COPY ROWS ARE AS DATA (since 0.22.8). Until then they were codegen, whose x 16 and x 32 were predicted at
// minutes to compile and never ran (tests.js, NO ROW WHOSE COMPILE WOULD TAKE MINUTES). As data every count is one text
// since 0.22.0 (scaling.test.mjs), so x 1 compiles and the others reuse it. The question they answer now
// (roadmap/ARCHITECTURE.md, step 4): in the user's scenedata run of 0.22.6, x 32 as data spent most of its time in
// iterations of a few thousand rays at about 50 ms each, and every step of the records' walk visits every top-level
// node, at least its box (builder/scenedata.js, the culled walk) -- so does that time grow with the count? (The candidate
// grid's rows, which said whether a structure naming a point's solids takes it away, went with the grid in 0.41.0: it
// was flat from 4 to 32 copies but slower than the plain walk under about 20, roadmap/ARCHITECTURE.md step 4.)
// x 32 with its boxes off is no longer a row: as data, every step would evaluate all 32 copies whole, and a dispatch that
// long risks the GPU being lost, which ends the run (the Menger cubes' did in 0.20.8). It was codegen's, and never ran.
//
// WHAT IS HELD FIXED ACROSS THE COPY ROWS, and why each would otherwise move with N:
//   the TOLERANCE   the automatic march tolerance follows the scene's size (photometry.js autoEps), and the grid makes
//                   the scene bigger with every copy -- so every copy row sets `eps` to the value x 1 has on its own
//   the RADIUS      300 cm for every copy row: the grid's far corner is 275 cm out, and a radius that grew with N
//                   would lengthen every escaping ray's march (PERFORMANCE_REVIEW.md, finding 4)
//   the CAMERA      one, framing copy 1 (the grid is behind it: bench/test/scaling.test.mjs checks no corner of any
//                   copy is in front of it)
// 32 is where codegen stopped: each copy is 20 nodes, and its uniforms must stay under 64 KiB (PERFORMANCE.md P3, *Two
// ceilings*; scaling.test.mjs computes the struct with tinywebgpu's own layout, and how many copies would fill it). As
// data the copies are records, not uniforms; 32 is kept so the rows compare with the scenedata bench's x 32.
//
// THE BOXES. The renderer culls each top-level node by a box measured on the GPU (builder/boxes.js), and measuring
// every node of 32 copies is 640 nodes, each over a lattice of the whole unculled scene -- minutes, inferred from the
// benchmark's 1.2 s for the Noise library's 20. So a copy row measures the stage and copy 1 only, and gives every
// other copy copy 1's box, and each of its parts its counterpart's (lensCopies `same`): a box is in its node's own frame
// (boxes.js), and the copies differ only in where they are.
//
// THE LIGHTS' PHOTONS are not in these rows. A builder light's photons come from the optics module, which takes its
// lights from the document open in the builder and lights only the builder's own scene (optics/page.js: the picture
// applies while RT.scene.id is 'built'; a row's scene is 'scaling-...'). So a row times its own scene and nothing of
// the page. What a light does here is its face: seen directly, and aimed at by light sampling (codegen LIGHTS), both
// of which the scene carries itself.
//======================================================================================================================

import * as Model from '../builder/model.js'
import { autoEps } from '../lib/pathtracer/core/photometry.js'
import { BENCH, benchUrl, sceneOf, boxesFor } from './index.js'

export const SCALING_FILES = { bench: 'OpticsBench.json', bench2: 'OpticsBench2.json' }
/** The lens assembly the copy rows multiply: 'LENS 1' in the optics bench, its pillar and its holder, 20 nodes. */
export const LENS_ID = 'n42'
/** The copy counts: the last fits the uniform buffer (scaling.test.mjs). */
export const COUNTS = [1, 4, 16, 32]
/** The copy rows' scene radius, cm: the grid's far corner is 275 cm from the origin (scaling.test.mjs). */
export const COPY_RADIUS = 300
/** The grid: copies SPACING cm apart, the first row START cm behind the camera's foot, COLUMNS across. */
export const GRID = { spacing: 25, start: 60, columns: 6 }

const VIEW = { mode: 'orbit', camtype: 0, fov: 40, azimuth: -50, elevation: 65 }
/* Each at the shortest distance that keeps the boxes inside 90% of a 1280 x 720 frame, computed with lib/camera.js
   (2026-10-03) over the documents' own estimates (builder/bounds.js estimateBox), in cm:
     the lens assembly    -10..10, -20..0, -2.5..26
     the optics bench     it, its copy 15 to -x, the prism -10..10, 0..20, -2.5..22.8 and its copy, the floor disc
     OpticsBench2         the lens assembly, the laser -10..10, -35.1..-15.1, -2.5..22.8, the floor disc
   Constants, as the benchmark's are, so nothing that changes those functions can move them. */
export const CAMERAS = {
    bench: { ...VIEW, target: [-7.5, 0, 8], distance: 83.76 },
    bench2: { ...VIEW, target: [0, -12.55, 8], distance: 77.35 },
    lens: { ...VIEW, target: [0, -10, 11.75], distance: 64.66 },
}

/** Where copy k (1-based; copy 1 is the original, where it is) stands: its group's position, cm. Rows of GRID.columns
 *  going away from the camera, behind it, at the original's height. */
export function copyPosition(k) {
    if (k === 1) return { x: 0, y: -10, z: 0 }
    const i = k - 2, row = Math.floor(i / GRID.columns), col = i % GRID.columns
    const c = CAMERAS.lens, az = c.azimuth * Math.PI / 180
    /* the camera's foot, horizontally, from its target: lib/camera.js puts an orbit camera at azimuth a, the
       horizontal direction (cos a, sin a) from the target (scaling.test.mjs checks it against the camera itself) */
    const u = [Math.cos(az), Math.sin(az)], v = [-u[1], u[0]]
    const foot = c.distance * Math.sin(c.elevation * Math.PI / 180)
    const along = foot + GRID.start + row * GRID.spacing, side = (col - (GRID.columns - 1) / 2) * GRID.spacing
    const r = x => +x.toFixed(3)
    return { x: r(c.target[0] + u[0] * along + v[0] * side), y: r(c.target[1] + u[1] * along + v[1] * side), z: 0 }
}

/**
 * The optics bench's stage -- its table, its floor disc, its two lights -- with `n` copies of its lens assembly (the
 * original and n - 1 duplicates, model.js duplicate: fresh ids, the same materials) and nothing else. Returns
 * { doc, copies: Map(copy id -> LENS_ID), same: Map(id -> id) }: `same` maps every node of every copy, its parts as well
 * as itself, to its counterpart in the original -- the box each is given (the header, THE BOXES). Until 0.22.9 only the
 * copy itself was mapped, so its parts had no box: the records' walk culled the copy whole and never noticed, but the
 * candidate grid walks a part with no box everywhere outside its volume, and its rows timed that (the user's scaling
 * run of 0.22.8: 62 such parts at x 32). Pure: the document given is not touched.
 */
export function lensCopies(base, n) {
    const doc = structuredClone(base)
    for (const c of [...doc.root.children]) {
        const keep = c.id === LENS_ID || (c.kind === 'object' && (c.type === 'light' || c.label === 'disc')) || c.label === 'Table'
        if (!keep) Model.remove(doc, c.id)
    }
    const original = Model.find(doc, LENS_ID).node
    const copies = new Map(), same = new Map()
    // a duplicate is the original's tree with fresh ids (model.js duplicate), so the two are walked side by side
    const pair = (c, o) => {
        if (c.kind !== o.kind || c.type !== o.type || (c.children || []).length !== (o.children || []).length)
            throw new Error(`lensCopies: ${c.id} is not a copy of ${o.id}`)
        same.set(c.id, o.id)
        ;(c.children || []).forEach((k, j) => pair(k, o.children[j]))
    }
    for (let k = 2; k <= n; k++) {
        const copy = Model.duplicate(doc, LENS_ID)
        copy.label = `LENS 1 #${k}`
        copy.transform.pos = copyPosition(k)
        copies.set(copy.id, LENS_ID)
        pair(copy, original)
    }
    doc.envRadius = COPY_RADIUS
    return { doc: Model.parse(Model.serialize(doc)), copies, same }
}

/**
 * The scaling benchmark as a bench test. `load(url)` returns a file's text: fetch in the page, readFileSync in node.
 */
export async function scalingTest(load) {
    const docs = {}
    for (const [key, file] of Object.entries(SCALING_FILES)) docs[key] = Model.parse(await load(benchUrl(file)))
    const environmentOf = doc => doc.environment ? structuredClone(doc.environment) : {}
    const asIs = (key, label) => ({ label, scene: sceneOf(docs[key], `scaling-${key}`), camera: CAMERAS[key],
                                    environment: environmentOf(docs[key]), compile: true, measureBoxes: boxesFor(docs[key]) })
    const bench = asIs('bench', 'the optics bench, as it is')
    /* THE COPY ROWS' TOLERANCE: what x 1 gets on its own, metres (the `eps` setting's unit; 0 is automatic) */
    const one = lensCopies(docs.bench, 1)
    const eps = autoEps(sceneOf(one.doc, 'scaling-lens-1').extent, one.doc.unit)
    /* one document per count, its data row made from it with its box measurer */
    const counts = COUNTS.map(n => {
        const { doc, copies, same } = n === 1 ? one : lensCopies(docs.bench, n)
        // the stage and copy 1 measured; every other copy, and each of its parts, given copy 1's (the header, THE BOXES)
        const stage = doc.root.children.filter(c => !copies.has(c.id)).map(c => c.id)
        return { n, doc, boxes: boxesFor(doc, { only: stage, same }) }
    })
    const first = 3   // the first copy row's index, after the three optics-bench rows
    const data = counts.map(({ n, doc, boxes }, k) => ({
        label: `lens assembly x ${n}, as data`,
        scene: sceneOf(doc, `scaling-lens-${n}-data`, true), camera: CAMERAS.lens,
        environment: environmentOf(doc), set: { eps }, copies: n, data: true, measureBoxes: boxes,
        // every count is x 1's text (the header): x 1 compiles uncached, the others say "= row" (sameTextAs: an index)
        ...(k === 0 ? { compile: true } : { compile: false, sameTextAs: first }),
    }))
    const cases = [
        bench,
        // made without its boxes (0.29.0: a generation option, no longer the uniform `cull`)
        { ...bench, label: 'the optics bench, bounding boxes off', compile: false, unculled: true,
          scene: sceneOf(docs.bench, 'scaling-bench-unculled', false, false) },
        asIs('bench2', 'OpticsBench2, as it is'),
        ...data,
        { ...data[0], label: 'lens assembly x 1, as data, again (drift check)', compile: false, sameTextAs: first },
    ]
    return {
        id: 'scaling', kind: 'bench',
        title: 'Scaling benchmark: the optics benches, and 1 to 32 lens assemblies, 1280 x 720, fixed camera',
        note: 'One sample per trace, each awaited; wall clock, then GPU time per kernel. Rows 1-3 are the optics benches as'
            + ' they are, codegen (row 2: the first with its culling off). Rows 4-7 are the same picture each time -- one'
            + ' lens assembly framed -- with 1, 4, 16 and 32 copies of it in the scene as data, the others behind the'
            + ' camera. If "march", "occlude" and "tail ms" grow with the'
            + ' count, copies none of which is on screen cost time: roadmap/ARCHITECTURE.md, step 4, says how the JSON\'s'
            + ' per-iteration log tells the walk (a BVH\'s case) from longer paths. The copy rows share one march'
            + ' tolerance and one scene radius, so the count is the only change, and one text: x 1 compiles, the others'
            + ' say "= row". Row 8 is row 4 again: if it'
            + ' differs from row 4, so may every row between. The lights\' photons are not in these rows (the optics'
            + ' module\'s, from the page). Save the whole text, JSON included, with the machine\'s name.'
            + ' (bench/scaling.js, PERFORMANCE.md.)',
        size: BENCH.size, warmup: BENCH.warmup, timed: BENCH.timed, kernels: BENCH.kernels, pipelined: BENCH.pipelined,
        cases,
    }
}
