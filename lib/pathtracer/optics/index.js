//======================================================================================================================
// THE OPTICS MODULE -- technical ray tracing over the renderer's scene.
//
//   const O = createOptics(RT, WG)
//   O.setSources(list)            // optics/sources.js: shape, pose, distribution, flux, medium -- each
//   O.setSource(src)              // ...or just the one
//   await O.run({ rays, batches }) // trace every ray to the end, batch after batch; results with +-
//   await O.reset({ rays })       // rays at the source, nothing traced -- then:
//   await O.step()                // every live ray on to its next interaction; statistics so far
//   O.results                      // the last reading: totals, per object, per material, +-
//   O.drawPaths(on)                // the last trace's or step's paths as lines over the picture (optics/paths.js)
//   O.setFar({ mode, material, nC, nG, axis, c0 })  // the far field: what feeds it, its grid, its frame
//   O.far                          // ...its last reading: flux per (C, gamma) bin, +- (optics/farfield.js)
//
// WHY A SEPARATE PASS, and not light tracing. The renderer's photons exist to make a picture: they
// stop at the first diffuse bounce and only count through a camera connection. Here a ray is the
// thing being studied -- where it goes, what it hits, what is left of it -- so it walks through
// every event (TAG_OPTIC), and what is recorded is flux per object, not radiance per pixel.
//
// NOTHING OF THE RENDERER'S IS WRITTEN. The pipelines here are compiled for this module on first use
// (the renderer's are bound to the renderer's buffers, and the render loop may run between two
// steps), the buffers are its own, and `learn` is only read. See optics/kernels.js.
//
// STEPPING. The wavefront advances every ray one march chunk per iteration, and a ray that has
// interacted would carry on to its next interaction while a slower one is still on its way to the
// first. So in a step the shade kernel PARKS every ray that interacted, the iterations run until
// every ray has either interacted or run out, and the parked rays become the next step's input.
// One step is then exactly one interaction for every live ray -- interface to interface.
//
// WHAT IS DRAWN is the last trace's or step's paths: the rays traced to be LOOKED AT. They are copied
// out of the trace's buffer into one the drawer alone reads (O.drawn), because every trace starts by
// clearing that buffer and the drawer used to draw whatever was in it. While the rays were the only
// thing tracing over the picture that was the same thing; the Optics page's Live analysis traces
// between them, and each of its batches -- other rays, traced to the end -- flashed over the view.
// An analysis's own paths (run) are recorded and never drawn.
//
// UNITS. A ray starts with weight 1; results are in the source's flux unit (lm or W): weight times
// flux / rays. Lengths are the scene's own unit.
//======================================================================================================================
import { prog_opt_gen, prog_opt_shade, prog_opt_photons, optDataWords, OPT_TALLY_WORDS, OPT_FX, OPT_TAGS, OPT_MATS,
         O_PARK, O_DETN, O_FLUX, O_COUNT, O_VOL, O_TAG, O_MAT, F_ESCAPED, F_LOST, F_DETECTED, C_ESCAPED, C_LOST,
         C_INTERACTIONS, C_ABSORBED, C_DETECTED, OPT_UNIFORMS, VERT_WORDS, DET_WORDS, pathBase, detBase,
         farBase, FAR_OFF, FAR_ESCAPED, FAR_DETECTOR } from './kernels.js'
import { prog_march, prog_prep_march_indirect, prog_prep_shade_indirect, prog_flip, COUNTER_WORDS, counterWords } from '../core/wavefront.js'
import { sourceRecords, defaultSource, fluxPerRay } from './sources.js'
import { makePathDrawer } from './paths.js'
import { makeEstimate } from './estimate.js'
import { RAY_BYTES, SHADE_ITEM_BYTES as HIT_BYTES } from '../core/tracebasics.js'

const WG_SIZE = 64
// RAY_BYTES and HIT_BYTES (a shade queue item, the hit and the surface beside it): the engine's, from tracebasics.js
const MARCH_STEPS = 32           // wavefront.js prog_march MAX_STEPS

const OPT_KEYS = Object.keys(OPT_UNIFORMS)
const withoutOpt = u => { const r = { ...u }; for (const k of OPT_KEYS) delete r[k]; return r }
const seed4 = () => Array.from({ length: 4 }, () => (Math.random() * 4294967296) >>> 0)

/** Read one lo/hi flux pair out of a tally readback, as ray weight. */
const pair = (a, i) => (a[i + 1] * 4294967296 + a[i]) / OPT_FX

/** Turn a tally readback into numbers, in ray weight (the host scales by flux per ray). */
export function readTallies(a, tags = null) {
    const obj = base => {
        const out = []
        const n = base === O_TAG ? OPT_TAGS : OPT_MATS
        for (let i = 0; i < n; i++) {
            const b = base + i * 5
            const hits = a[b + 4]
            if (!hits) continue
            const incident = pair(a, b), leaving = pair(a, b + 2)
            out.push({ index: i, name: base === O_TAG ? (tags?.[i - 1] ?? (i ? `tag ${i}` : 'untagged')) : `material ${i}`,
                       incident, leaving, absorbed: incident - leaving, hits })
        }
        return out
    }
    return {
        escaped: pair(a, O_FLUX + F_ESCAPED * 2), lost: pair(a, O_FLUX + F_LOST * 2),
        detected: pair(a, O_FLUX + F_DETECTED * 2),
        // what the media took between surfaces (kernels.js O_VOL): in ABSORBED below, and no object's row
        volume: pair(a, O_VOL),
        counts: { escaped: a[O_COUNT + C_ESCAPED], lost: a[O_COUNT + C_LOST],
                  interactions: a[O_COUNT + C_INTERACTIONS], absorbed: a[O_COUNT + C_ABSORBED],
                  detected: a[O_COUNT + C_DETECTED] },
        parked: a[O_PARK], detectorHits: a[O_DETN],
        objects: obj(O_TAG), materials: obj(O_MAT),
    }
}

export function createOptics(RT, WG) {
    const O = {
        /* THE SOURCES: in the app, every sheet carrying a source material (the page asks the
           builder -- builder/sources.js); a bench writes them by hand. */
        sources: [defaultSource()],
        /* eps: the trace's surface tolerance, in METRES like the renderer's (core/tolerances.js
           marchTol, with its f32 floor; the offset off a surface is ten times it). 0 follows the renderer's automatic
           one, a share of the scene's size -- microns for an LED optic; anything else overrides. */
        /* maxDist: the longest optical path traced, in scene units (0 = none; the kernels get it in
           metres, optMaxDist): a ray stops where it
           reaches it, escaping ones are drawn up to it, and the page's path slider is a share of it */
        settings: { bounces: 64, marchSteps: 2000, pathRays: 2000, pathVerts: 32, escLen: 2, detCap: 262144, eps: 0,
                    maxDist: 200,
                    /* THE FAR FIELD (kernels.js FAR_*): mode 'off', 'escaped' (every ray that leaves the
                       scene) or 'detector' (every ray arriving at the detector MATERIAL id `material`);
                       nC C bins, nG gamma bins from 0 to 180 degrees; axis (gamma = 0) and c0 (C = 0)
                       in world space -- a light's +z and +x, for the photometric convention */
                    far: { mode: 'off', material: 0, nC: 72, nG: 181, axis: [0, 0, 1], c0: [1, 0, 0] } },
        results: null, compiling: false, stepIndex: 0, rays: 0,
        far: null,
        /* THE PATHS DRAWN: { rays, verts, buffer } -- the layout of the last trace or step and the copy of its
           paths the drawer reads (publish below); null until one has run */
        drawn: null,
        /* ONE SEED PER TRACE, not per dispatch: the shade seeds each ray by its id and bounce count
           (kernels.js), so the same seed retraces the same rays -- a longer trace extends them. */
        seed: seed4(),
    }
    /** New rays for the next trace (Run draws new ones per batch on its own). */
    O.reseed = () => { O.seed = seed4() }
    /* METRES PER SCENE UNIT, the scene showing's (the bag's sceneUnit): the trace runs in the engine's unit, metres, since
       0.36.0, and its settings and what it hands back are the scene's -- the reach and the escape length go in times
       this, the sources' places and sizes (sourceRecords), and the hits and the paths come back divided by it */
    const metresPer = () => +RT.uniformBag?.()?.sceneUnit || 1
    let P = null                     // pipelines, for one scene
    let B = null                     // buffers, for one capacity
    let busy = false
    /* THE SETTINGS IN FORCE: O.settings, except during a run, which takes a copy at its start and keeps it. A run
       submits its batches without waiting between them and reads them back together (O.run), at offsets worked out
       from the first one's layout; the page writes O.settings whenever the person changes one, and a batch laid out
       by a newer grid would have been read at the old offsets -- someone else's numbers, silently. */
    let frozen = null
    const cfg = () => frozen ?? O.settings

    const uniforms = extra => ({
        ...RT.uniformBag(),
        optSrcCount: table().count,
        seed: O.seed,
        // the trace's own caps: a lens with total internal reflection needs far more bounces than
        // a picture, and no Russian roulette -- the tallies read absorption as in minus out
        maxbounce: cfg().bounces, maxiter: cfg().marchSteps, rr: 0, nee: 0, lt: 0,
        eps: cfg().eps,
        /* renderMode 0: the picture's Draft or Sketch is a way of LOOKING. The kernels already leave
           every photon out of it (materials_pbr.js FAST MODES), and an optics ray is a photon; this
           says so where the trace's settings are, so it does not rest on the shader's gate alone. */
        ltEmit: 0, measureMode: 0, renderMode: 0,
        /* ...and dispersion as each material sets it (0.65.0): the picture's switch (uniforms.schema.js dispersionOff) is
           a way of looking too, and a measurement must not change with it (the user: "picture only"). The picture's own
           photons from these sources are shaded by the renderer's kernels with its bag, so they follow the switch. */
        dispersionOff: 0,
        // the layout the current trace was generated with (generate sets it first)
        optPathRays: O.layout?.rays ?? Math.min(cfg().pathRays, O.rays),
        optPathVerts: O.layout?.verts ?? cfg().pathVerts,
        optEscLen: cfg().escLen * metresPer(), optMaxDist: Math.max(0, +cfg().maxDist || 0) * metresPer(), optRays: O.rays,
        optDetCap: O.layout?.detCap ?? cfg().detCap,
        ...farUniforms(O.layout?.far ?? farLayout()),
        ...detectorMask(),
        ...extra,
    })
    /* THE FAR FIELD'S LAYOUT for the next trace, from the settings: nothing when it is off, so a
       trace that does not ask for it pays nothing -- not a word of buffer, not a bin in the shade.
       The axis and C = 0 are made a right-angled unit pair here, whatever was given: the kernel's
       C = 90 is axis x C0, and a C0 with some of the axis in it would tilt every C plane. */
    const farLayout = () => {
        const f = cfg().far || {}
        const mode = f.mode === 'escaped' ? FAR_ESCAPED : f.mode === 'detector' ? FAR_DETECTOR : FAR_OFF
        if (mode === FAR_OFF) return { mode, nC: 0, nG: 0, bins: 0 }
        const nC = Math.max(1, Math.min(1440, f.nC | 0)), nG = Math.max(2, Math.min(1441, f.nG | 0))
        const unit = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l) }
        const axis = unit(f.axis || [0, 0, 1])
        let c0 = f.c0 || [1, 0, 0]
        const along = c0[0] * axis[0] + c0[1] * axis[1] + c0[2] * axis[2]
        c0 = [c0[0] - along * axis[0], c0[1] - along * axis[1], c0[2] - along * axis[2]]
        if (Math.hypot(...c0) < 1e-6) c0 = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
        const a2 = c0[0] * axis[0] + c0[1] * axis[1] + c0[2] * axis[2]
        c0 = unit([c0[0] - a2 * axis[0], c0[1] - a2 * axis[1], c0[2] - a2 * axis[2]])
        return { mode, material: f.material | 0, nC, nG, bins: nC * nG, axis, c0 }
    }
    const farUniforms = f => ({ optFar: [f.nC, f.nG, f.mode, f.material | 0],
                                optFarAxis: [...(f.axis || [0, 0, 1]), 0], optFarC0: [...(f.c0 || [1, 0, 0]), 0] })
    /** What feeds the far field, its grid and its frame, for the next trace (see settings.far). */
    O.setFar = far => { O.settings.far = { ...O.settings.far, ...far } }

    /* The scene's detectors (codegen: `detectors`, MATERIAL ids) as the kernel's 256-bit mask. */
    const mask = ids => {
        const w = new Array(8).fill(0)
        for (const t of ids || []) if (t >= 0 && t < 256) w[t >> 5] = (w[t >> 5] | (1 << (t & 31))) >>> 0
        return [w.slice(0, 4), w.slice(4, 8)]
    }
    /* ...and what the trace passes through, transparent sources (codegen `passes`), the same way */
    const detectorMask = () => {
        const [a, b] = mask(RT.scene?.detectors), [pa, pb] = mask(RT.scene?.passes)
        return { optDetA: a, optDetB: b, optPassA: pa, optPassB: pb }
    }

    /* COMPILED ON FIRST USE, per scene: the shade inlines the scene (its pick copy) like the
       renderer's kernels, so it cannot be built before there is one, and building it with the
       renderer's would cost every setScene a compile the optics page may never ask for. */
    /* THE OPTICS TRACE SEES LIMITERS, the picture does not: codegen's optics copy of the scene has
       them, the render copy leaves them out (model version 10). Without one they are the same. */
    const marchScene = scene => scene.opticsWgsl ? { ...scene, wgsl: scene.opticsWgsl } : scene
    const ensurePipelines = async () => {
        const scene = RT.scene
        if (P && P.scene === scene) return P
        O.compiling = true
        try {
            const [gen, shade, march, prepMarch, prepShade, flip] = await Promise.all([
                prog_opt_gen(WG, scene), prog_opt_shade(WG, scene, WG_SIZE), prog_march(WG, marchScene(scene), WG_SIZE),
                prog_prep_march_indirect(WG, WG_SIZE), prog_prep_shade_indirect(WG, WG_SIZE), prog_flip(WG)])
            await Promise.all([shade.ready, march.ready].filter(Boolean))
            P = { scene, gen, shade, march, prepMarch, prepShade, flip }
            B = null                                  // rebind to the new pipelines
            return P
        } finally { O.compiling = false }
    }

    const ensureBuffers = rays => {
        const words = optDataWords(Math.min(cfg().pathRays, rays), cfg().pathVerts, cfg().detCap, farLayout().bins)
        if (B && B.rays >= rays && B.words >= words) {
            /* the scene's own buffers can be made again with the scene kept (setScene of the same scene: its init),
               and these pipelines are kept with it: bind what it has now (tinywebgpu merges, and compares by value) */
            if (B.scene !== RT.scene.buffers) {
                B.scene = RT.scene.buffers
                if (B.scene) { P.march.resources = { ...B.scene }; P.shade.resources = { ...B.scene } }
            }
            return B
        }
        for (const b of Object.values(B || {})) b?.b?.destroy?.()
        const cap = Math.max(rays, B?.rays || 0)
        B = {
            rays: cap, words,
            a: WG.createStorageBuffer(cap * RAY_BYTES), b: WG.createStorageBuffer(cap * RAY_BYTES),
            park: WG.createStorageBuffer(cap * RAY_BYTES), hits: WG.createStorageBuffer(cap * HIT_BYTES),
            counters: WG.createStorageBuffer(COUNTER_WORDS * 4), data: WG.createStorageBuffer(words * 4),
            indMarch: WG.createIndirectBuffer(), indShade: WG.createIndirectBuffer(),
        }
        // not a buffer of these (the loop above destroys B's): which of the scene's are bound
        Object.defineProperty(B, 'scene', { enumerable: false, writable: true, value: RT.scene.buffers })
        P.gen.resources = { rayBuffer0: B.a.b, optData: B.data.b, optSources: traceSrc.buffers().src.b, optRays: traceSrc.buffers().rays.b }
        P.march.resources = { marchBuffer0: B.a.b, marchBuffer1: B.b.b, shadeBuffer: B.hits.b, counters: B.counters.b,
                              ...(RT.scene.buffers || {}) }
        P.shade.resources = { marchBuffer0: B.a.b, marchBuffer1: B.b.b, shadeBuffer: B.hits.b, counters: B.counters.b,
                              learn: RT.learn.b, optData: B.data.b, parked: B.park.b, ...(RT.scene.buffers || {}) }
        P.prepMarch.resources = { counters: B.counters.b, indirectOut: B.indMarch.b }
        P.prepShade.resources = { counters: B.counters.b, indirectOut: B.indShade.b }
        P.flip.resources = { counters: B.counters.b }
        return B
    }

    /* THE PATHS A PERSON LOOKS AT, published: the start of the trace's buffer -- the tallies and the paths, at the
       offsets the drawer reads them at (kernels.js detBase: the detector hits come next) -- copied into a buffer of
       their own, after the chain that wrote them (the queue keeps the order). A trace or a step publishes; a run
       does not, so an analysis traced between two of them leaves the view as it was. The copy outlives the
       trace's buffers (ensureBuffers may make them again, bigger) and grows only when it must. */
    let view = null
    const publish = () => {
        const { rays, verts } = O.layout
        const bytes = detBase(rays, verts) * 4
        if (!view || view.bytes < bytes) {
            view?.buf?.b?.destroy?.()
            view = { buf: WG.createStorageBuffer(bytes), bytes }
            paths?.bind(view.buf)
        }
        const enc = WG.device.createCommandEncoder()
        enc.copyBufferToBuffer(B.data.b, 0, view.buf.b, 0, bytes)
        WG.device.queue.submit([enc.finish()])
        O.drawn = { rays, verts, buffer: view.buf }
    }

    /* ONE CHAIN of wavefront iterations over whatever is in buffer a. `last` flushes survivors on
       the final iteration (a full run); a step leaves them, and parks what interacted. */
    const chain = (iterations, u, last) => {
        for (let it = 0; it < iterations; it++) {
            const fu = { ...u, lastpass: last && it === iterations - 1 ? 1 : 0 }
            // the march is the renderer's kernel and declares none of the optics uniforms, and
            // tinywebgpu refuses a name a pipeline does not declare. WITHOUT THE STEP CACHE (wavefront.js stepCacheWGSL,
            // compiled in only when asked, and this module never asks): its balls are the render copy's, and this copy
            // draws limiters that one leaves out -- a ball can hold one
            P.march.uniforms = withoutOpt(fu)
            P.shade.uniforms = fu
            P.prepMarch.dispatch(1, 1, 1)
            P.march.dispatchIndirect(B.indMarch.b, 0)
            P.prepShade.dispatch(1, 1, 1)
            P.shade.dispatchIndirect(B.indShade.b, 0)
            P.flip.dispatch(1, 1, 1)
        }
    }

    /* Rays at the source: generated into buffer a, the counters pointing at them. */
    const generate = (n, step) => {
        if (!table().count) throw new Error('no sources: give a rectangle or disc a source material with some light')
        B.data.clear()
        const tb = traceSrc.buffers()
        P.gen.resources = { ...P.gen.resources, optSources: tb.src.b, optRays: tb.rays.b }
        // the layout the paths are recorded with: the readbacks and the copy that is drawn (publish) read
        // it, not the settings, which the page may change before the next trace
        O.layout = { rays: Math.min(cfg().pathRays, n), verts: cfg().pathVerts, detCap: cfg().detCap,
                     far: farLayout(), flux: table().flux }
        P.gen.uniforms = uniforms({ optRays: n, optStep: step ? 1 : 0 })
        WG.beginFrame()
        P.gen.run(n, 1, 1)
        B.counters.w(counterWords({ 0: n }))
        WG.endFrame()
    }

    /* What a reading means, in the source's unit: every weight times the flux one ray carries -- of the source table
       the batch was GENERATED from (`flux`, kept in its layout), not the one there now: the page sets the sources
       before every trace and a light edited meanwhile would have rescaled a batch traced before it. */
    const scaled = (t, rays, flux = table().flux) => {
        const k = fluxPerRay(flux, rays)
        const s = o => ({ ...o, incident: o.incident * k, leaving: o.leaving * k, absorbed: o.absorbed * k })
        /* ABSORBED is what the materials took; what the detectors caught is DETECTED, and is in
           the detectors' own rows as arriving-and-not-leaving, so it comes out of the sum here. What
           the media took on the way between surfaces (VOLUME, 0.37.0) is in no row, and goes in. */
        const volume = t.volume ?? 0
        return { ...t, unit: 'lm', rays, emitted: rays * k, escaped: t.escaped * k, lost: t.lost * k,
                 detected: t.detected * k, volume: volume * k,
                 absorbed: (t.objects.reduce((a, o) => a + o.absorbed, 0) - t.detected + volume) * k,
                 objects: t.objects.map(s), materials: t.materials.map(s) }
    }
    /* the far field's bins, lo/hi pairs, as flux per bin; and the frame and grid they are of (estimate.js) */
    const farOf = (f, a, k, flux) => {
        const out = new Float64Array(f.bins)
        for (let i = 0; i < f.bins; i++) out[i] = pair(a, 2 * i) * k
        return { mode: f.mode === FAR_ESCAPED ? 'escaped' : 'detector', material: f.material, nC: f.nC, nG: f.nG,
                 axis: f.axis, c0: f.c0, flux: out, emitted: flux, unit: 'lm' }
    }
    /* detector records as hits: position (back in the scene's unit: the trace's is metres), flux, the direction they
       arrived along, the object, the colour as XYZ */
    const hitsOf = (f, u, n, k) => {
        const hits = [], m = metresPer()
        for (let i = 0; i < n; i++) {
            const b = i * DET_WORDS
            // xyz: the hit's colour as flux in X, Y (= flux) and Z, the source's unit
            hits.push({ pos: [f[b] / m, f[b + 1] / m, f[b + 2] / m], flux: f[b + 3] * k, dir: [f[b + 4], f[b + 5], f[b + 6]], tag: u[b + 7],
                        xyz: [f[b + 8] * k, f[b + 3] * k, f[b + 9] * k] })
        }
        return hits
    }

    /* WHAT A BATCH LEFT, READ BACK IN ONE GO. A batch was read four times -- its tallies, its far field, its detector
       hits' count, its hits -- and each readback waits for everything submitted before it, the picture's frames too,
       which keep coming while a script waits. A Live round of four batches took 1.4 s with the picture running and
       0.2 s with it stopped, at 1 000 rays as at 100 000 (measured by the user, 2026-10-04): sixteen waits of about a
       picture frame each. Now each batch's results are COPIED, on the GPU, into a slot of a buffer of their own right
       after its chain -- the tallies (they hold the hits' count), the far field's bins, and the hits up to as many as
       the batch has rays (a ray stops at the first detector it reaches: kernels.js has one optRecordHit, and the shade
       returns after it) -- and a run reads a group of batches back with ONE readback. The queue keeps each copy after
       its batch's chain and before the next batch's clear, so the batches go one after another with nothing waiting.
       The readback is of the same size round after round: tinywebgpu pools a staging buffer per SIZE, and a read of
       each batch's own number of hits made a new size, kept, almost every batch. */
    const SNAP_GROUP_BYTES = 32 << 20     // a group's readback at most: three batches of 250 000 rays with their hits
    let snap = null
    const ensureSnap = bytes => {
        if (snap && snap.bytes >= bytes) return snap
        snap?.buf?.b?.destroy?.()
        return (snap = { buf: WG.createStorageBuffer(bytes), bytes })
    }
    /* a slot's layout, from the batch just generated: the tallies, then 2 words a far-field bin, then the hits */
    const slotOf = (rays, withHits) => {
        const L = O.layout, bins = L.far?.bins || 0
        const hitCap = withHits && RT.scene?.detectors?.length ? Math.min(L.detCap, rays) : 0
        const far0 = OPT_TALLY_WORDS, hit0 = far0 + 2 * bins
        return { L, bins, hitCap, far0, hit0, words: hit0 + hitCap * DET_WORDS, rays,
                 tags: RT.scene?.opticsTags ?? RT.scene?.tags }
    }
    /* the batch just traced into slot i, queued after its chain */
    const copyOut = (S, i) => {
        const enc = WG.device.createCommandEncoder(), at = i * S.words * 4, L = O.layout
        enc.copyBufferToBuffer(B.data.b, 0, snap.buf.b, at, OPT_TALLY_WORDS * 4)
        if (S.bins) enc.copyBufferToBuffer(B.data.b, farBase(L.rays, L.verts, L.detCap) * 4, snap.buf.b, at + S.far0 * 4, S.bins * 8)
        if (S.hitCap) enc.copyBufferToBuffer(B.data.b, detBase(L.rays, L.verts) * 4, snap.buf.b, at + S.hit0 * 4, S.hitCap * DET_WORDS * 4)
        WG.device.queue.submit([enc.finish()])
    }
    /* slot i of a readback: the tallies as read, the reading in the source's unit, the far field, and the hits on
       demand (decoding them is the page's cost, and only while it keeps them) */
    const decode = (ab, S, i, flux) => {
        const off = i * S.words * 4, u = new Uint32Array(ab, off, S.words), f = new Float32Array(ab, off, S.words)
        const k = fluxPerRay(flux, S.rays)
        const t = readTallies(u.subarray(0, OPT_TALLY_WORDS), S.tags)
        const count = u[O_DETN], n = Math.min(count, S.hitCap)
        return { t, reading: scaled(t, S.rays, flux), far: S.bins ? farOf(S.L.far, u.subarray(S.far0, S.far0 + 2 * S.bins), k, flux) : null,
                 hits: () => ({ hits: hitsOf(f.subarray(S.hit0), u.subarray(S.hit0), n, k), count, missed: count - n, unit: 'lm' }) }
    }
    /* one batch read back on its own, right after it: a trace, a reset, a step -- one wait, where there were two */
    const readNow = async rays => {
        const S = slotOf(rays, false), flux = O.layout.flux
        ensureSnap(S.words * 4)
        copyOut(S, 0)
        return decode(await snap.buf.r(S.words * 4, 0, null), S, 0, flux)
    }
    /* ...as the module's reading and far field: one batch, so no error bars */
    const single = (d, extra) => {
        const E = makeEstimate().add(d.reading, d.far)
        O.far = E.farField()
        return { ...E.results(), ...extra }
    }

    const guard = async fn => {
        if (busy) throw new Error('[optics] a trace is already running')
        if (!RT.scene) throw new Error('[optics] no scene')
        busy = true
        try { await ensurePipelines(); return await fn() } finally { busy = false }
    }
    const fullIterations = () => (cfg().bounces + 1) + Math.ceil(cfg().marchSteps / MARCH_STEPS)
    const stepIterations = () => Math.ceil(cfg().marchSteps / MARCH_STEPS) + 1

    /** Trace `rays` rays to the end, `batches` times; the reading averages the batches -- into `into` when given (an
     *  estimate.js estimate: a run goes on adding to it), else a new one. onBatch(results, b, batch) after each, with
     *  batch.hits() its detector hits and batch.last whether it ended a readback. */
    O.run = ({ rays = 100000, batches = 4, onBatch, into = null } = {}) => guard(async () => {
        O.rays = rays
        const E = into ?? makeEstimate()
        /* THE TRACE'S SEED IS GIVEN BACK at the end: each batch draws its own, and the last one used to stay, so the
           rays a trace draws were other rays after every analysis -- once per ▶ Run, unseen; every round of a Live
           analysis, a view that changed with nothing moved */
        const seed = O.seed
        frozen = { ...O.settings, far: { ...O.settings.far } }          // the run's settings (cfg)
        try {
            ensureBuffers(rays)
            let S = null, group = 1
            for (let b = 0; b < batches;) {
                // A GROUP: its batches one after another, each copied out after its chain, nothing waited for between
                const first = b, fluxes = []
                for (; b < batches && b - first < group; b++) {
                    O.reseed()                     // independent batches, or their spread would say nothing
                    generate(rays, false)
                    const s = slotOf(rays, true)
                    if (!S) {
                        S = s
                        group = Math.max(1, Math.min(batches, Math.floor(SNAP_GROUP_BYTES / (S.words * 4))))
                        ensureSnap(group * S.words * 4)
                    } else if (s.words !== S.words || s.bins !== S.bins) throw new Error('[optics] a batch laid out unlike the run\'s first')
                    fluxes.push(O.layout.flux)
                    WG.beginFrame()
                    chain(fullIterations(), uniforms({ optStep: 0 }), true)
                    WG.endFrame()
                    copyOut(S, b - first)
                }
                const k = b - first
                const ab = await snap.buf.r(k * S.words * 4, 0, null)        // the group's one wait
                for (let i = 0; i < k; i++) {
                    const d = decode(ab, S, i, fluxes[i])
                    E.add(d.reading, d.far)
                    O.results = { ...E.results(), mode: 'run' }
                    O.far = E.farField()
                    await onBatch?.(O.results, first + i + 1, { hits: d.hits, last: i === k - 1 })
                }
            }
        } finally { O.seed = seed; frozen = null }
        O.stepIndex = null
        RT.redraw?.()
        return O.results
    })
    /** A new, empty estimate for O.run's `into`: the Optics page's Live adds round after round to one (estimate.js). */
    O.estimate = makeEstimate

    /** Rays at the source and nothing traced: step 0 of a step-by-step trace. */
    O.reset = ({ rays = 10000 } = {}) => guard(async () => {
        O.rays = rays
        ensureBuffers(rays)
        generate(rays, true)
        publish()
        O.stepIndex = 0
        O.alive = rays
        O.results = single(await readNow(rays), { mode: 'step', step: 0, alive: rays })
        RT.redraw?.()
        return O.results
    })

    /** Every live ray on to its next interaction. */
    O.step = () => guard(async () => {
        if (O.stepIndex == null) throw new Error('[optics] reset before stepping')
        if (!O.alive) return O.results
        // last step's parked rays are this step's input: copy them to the front of buffer a
        if (O.stepIndex > 0) {
            const enc = WG.device.createCommandEncoder()
            enc.copyBufferToBuffer(B.park.b, 0, B.a.b, 0, O.alive * RAY_BYTES)
            WG.device.queue.submit([enc.finish()])
            B.counters.w(counterWords({ 0: O.alive }))
        }
        B.data.w(new Uint32Array([0]), O_PARK * 4)          // nothing parked yet this step
        WG.beginFrame()
        chain(stepIterations(), uniforms({ optStep: 1 }), false)
        WG.endFrame()
        publish()
        // the far field read is everything so far: the grid is cleared only at the source
        const d = await readNow(O.rays)
        O.stepIndex++
        O.alive = d.t.parked
        O.results = single(d, { mode: 'step', step: O.stepIndex, alive: d.t.parked })
        RT.redraw?.()
        return O.results
    })

    /** TRACE N STEPS in one go: rays from the source, each through at most `steps` interactions,
     *  the same rays every time (O.seed) -- so N+1 draws the N-step paths plus one more leg. One
     *  chain and one readback, which is what makes it cheap enough to repeat on every change of the
     *  page's step slider and continuously in Live mode. The bounce cap does the stopping: a ray
     *  that would interact again is cut there and counted under `lost`, which in this mode means
     *  "still going after N steps" (plus anything the march limits stopped). */
    O.trace = ({ rays = 10000, steps = 8 } = {}) => guard(async () => {
        O.rays = rays
        const verts = steps + 2                     // the source, N interactions, an escape
        const keep = O.settings.pathVerts
        O.settings.pathVerts = verts
        try {
            ensureBuffers(rays)
            generate(rays, false)
            if (steps > 0) {
                WG.beginFrame()
                // the cap is checked after an interaction: maxbounce N-1 ends a ray AT its N-th
                chain(fullIterationsFor(steps), uniforms({ optStep: 0, maxbounce: steps - 1 }), true)
                WG.endFrame()
            }
            publish()
        } finally { O.settings.pathVerts = keep }
        O.stepIndex = null
        O.results = single(await readNow(rays), { mode: 'trace', steps })
        RT.redraw?.()
        return O.results
    })
    const fullIterationsFor = steps => (steps + 1) + Math.ceil(cfg().marchSteps / MARCH_STEPS)

    /** LIVE: trace N steps again and again, so moving an object in the Builder shows its effect on
     *  the rays at once. `get` is asked each time for { rays, steps } -- the page's current values.
     *  A trace that throws (a scene mid-compile) stops the loop and says why. */
    O.live = (on, get, onResult) => {
        O.living = !!on
        if (!on || O._liveLoop) return
        O._liveLoop = (async () => {
            try {
                while (O.living) {
                    const r = await O.trace(get())
                    // awaited: a result handler that reads the buffers back (the detector map)
                    // must be done before the next trace clears them
                    await onResult?.(r)
                    await new Promise(res => requestAnimationFrame(res))
                }
            } catch (e) { O.living = false; onResult?.(null, e) }
            finally { O._liveLoop = null }
        })()
    }

    /** THE PATHS AS DATA: every DRAWN ray's vertices (O.drawn: the last trace's or step's), and the longest
     *  optical path among them -- what the page's path-length slider needs for its range. */
    O.readPaths = async () => {
        if (!O.drawn) return null
        const { rays, verts, buffer } = O.drawn
        if (!rays) return { rays: 0, verts, counts: new Uint32Array(0), vertices: new Float32Array(0), maxOpl: 0 }
        const n = await buffer.r(rays * 4, O_PATHS_BYTES(), Uint32Array)
        const v = await buffer.r(rays * verts * VERT_WORDS * 4, pathBase(rays) * 4, Float32Array)
        // back in the scene's unit: a vertex's xyz and its optical path length (the trace's are metres)
        const m = metresPer()
        for (let i = 0; i < v.length; i += VERT_WORDS) { v[i] /= m; v[i + 1] /= m; v[i + 2] /= m; v[i + 4] /= m }
        let maxOpl = 0
        for (let i = 0; i < rays; i++) {
            const k = Math.min(n[i], verts)
            if (k) maxOpl = Math.max(maxOpl, v[(i * verts + k - 1) * VERT_WORDS + 4])
        }
        return { rays, verts, counts: n, vertices: v, maxOpl }
    }
    const O_PATHS_BYTES = () => pathBase(0) * 4

    /** THE FAR FIELD AS IT STANDS: flux per bin in the source's unit (lm), gamma-major (bin
     *  ig * nC + ic), for the layout the last trace ran with -- null when it had none. */
    O.readFar = async () => {
        const f = O.layout?.far
        if (!B || !f?.bins) return null
        const a = await B.data.r(f.bins * 2 * 4, farBase(O.layout.rays, O.layout.verts, O.layout.detCap) * 4, Uint32Array)
        return farOf(f, a, fluxPerRay(O.layout.flux, O.rays), O.layout.flux).flux
    }

    /** WHAT THE DETECTORS CAUGHT: one record per ray that stopped on a detector -- position, flux
     *  (the source's unit), arriving direction, the object's tag and the colour as xyz (flux in X, Y,
     *  Z; Y is the flux) -- up to the capacity; `missed`
     *  counts what did not fit. For analysis outside this module: a spot diagram, an irradiance
     *  map, a ray file of the light leaving an optic. */
    O.readHits = async () => {
        if (!B || !O.layout) return null
        const { rays, verts, detCap } = O.layout
        const head = await B.data.r(8, 0, Uint32Array)
        const count = head[O_DETN], n = Math.min(count, detCap)
        const raw = n ? await B.data.r(n * DET_WORDS * 4, detBase(rays, verts) * 4, null) : new ArrayBuffer(0)
        const hits = hitsOf(new Float32Array(raw), new Uint32Array(raw), n, fluxPerRay(O.layout.flux, O.rays))
        return { hits, count, missed: count - n, unit: 'lm' }
    }

    /* THE TABLES, packed once per change (optics/sources.js sourceRecords) and uploaded to storage
       buffers of their own: one for the trace, one for the picture's photons. They differ: the
       trace starts from every sheet source, the picture light-traces only the sources the renderer
       leaves to it (builder/codegen.js lightTracedSources) -- any other is an
       ordinary emitter there already, and its light would count twice. */
    /* RAY SETS (Zemax files): the host places each file's rays and registers them under a key
       (setRayData); a description { type: 'rayset', rays: key } names them. Changing one repacks. */
    const rayData = new Map()
    let rayEpoch = 0
    O.setRayData = (key, rays) => {
        if (rayData.get(key) === rays) return
        rayData.set(key, rays); rayEpoch++
        if (O.picture.on) RT.invalidate?.()
    }
    O.dropRayData = key => { if (rayData.delete(key)) rayEpoch++ }
    const makeTable = initial => {
        let list = initial, packed = null, packedEpoch = -1, packedUnit = 0, bufs = null, uploaded = null
        const storage = (old, arr) => {
            if (old && old.floats >= arr.length) return old
            old?.b?.b?.destroy?.()
            return { b: WG.createStorageBuffer(arr.byteLength), floats: arr.length }
        }
        const T = {
            get list() { return list },
            set(next) {
                next = structuredClone(next || [])
                const changed = JSON.stringify(next) !== JSON.stringify(list)
                list = next
                if (changed) packed = null
                return changed
            },
            table: () => {
                // keyed by the unit too: a source's place and size go in in metres (sourceRecords)
                const m = metresPer()
                if (!packed || packedEpoch !== rayEpoch || packedUnit !== m) { packed = sourceRecords(list, rayData, m); packedEpoch = rayEpoch; packedUnit = m }
                return packed
            },
            /** { src, rays }: the table's two storage buffers, uploaded */
            buffers() {
                const t = T.table()
                bufs = { src: storage(bufs?.src, t.data), rays: storage(bufs?.rays, t.rays) }
                if (uploaded !== packed) { bufs.src.b.w(t.data); bufs.rays.b.w(t.rays); uploaded = packed }
                return { src: bufs.src.b, rays: bufs.rays.b }
            },
            buffer: () => T.buffers().src,
        }
        return T
    }
    const traceSrc = makeTable(O.sources), pictureSrc = makeTable([])
    const table = () => traceSrc.table()
    const sourceBuffer = () => traceSrc.buffer()
    /** The sources the next trace starts from, and -- if given -- the ones the picture takes photons
     *  from (the same, when left out). */
    O.setSources = (list, pictureList = list) => {
        traceSrc.set(list)
        O.sources = traceSrc.list
        /* the picture it lights is of a different light now: start it over -- but only on a real
           change, since the page sets the sources before every trace, every frame in Live mode,
           and a picture restarted every frame never converges */
        if (pictureSrc.set(pictureList) && O.picture.on) RT.invalidate?.()
    }
    O.setSource = src => O.setSources([{ ...defaultSource(), ...src }])
    /** The total flux, lm, and how many sources carry it. */
    O.sourceFlux = () => ({ flux: table().flux, count: table().count })

    /* THE SOURCE LIGHTING THE PICTURE. Registered with the renderer as a photon source
       (R.photonSources): every sample, `perPixel` photons per pixel from this source ride with the
       renderer's own and connect to the camera at every surface they land on (kernels.js
       prog_opt_photons). The source's flux is shared over the photons of one sample, so each
       sample is a complete estimate and the picture's average converges to the real brightness.
       Its flux is taken as lumens: a source given in watts lights the picture as if its watts were
       lumens (there is no wavelength to convert with). */
    /* how many photons: the renderer's own light-tracing budget (Light sources: photons per pixel), so
       the page needs no second one -- the source's flux is what sets the brightness, the count only
       how fast it converges */
    /* applies: whether the scene showing is the one the sources belong to -- a host that takes them
       from its own scene says so (the Optics page: the builder's), or the test bench, which loads
       scenes of its own into the same renderer, would have them shining into its floor */
    O.picture = { on: false, perPixel: null, applies: () => true }
    /* ITS KERNEL, ONE FOR EVERY SCENE (kernels.js prog_opt_photons: no scene in it, 0.34.2). It was made again for each
       scene shown, and ready() said no until it was: a frame or two of every scene change without the lights' photons
       -- after the builder's bake, into the picture it keeps, the light-traced lights flickering off. */
    let photons = null, photonsCompiling = null
    /* A KERNEL THAT DID NOT COMPILE is remembered, with the scene showing then: ready() asked again every frame, and
       a failure became a compile attempt -- and an unhandled rejection -- per frame, with the light quietly missing.
       It is said by why() instead, and tried again when another scene is shown. */
    let photonsFailed = null
    const compilePhotons = () => {
        const scene = RT.scene
        if (photons || photonsCompiling || (photonsFailed && photonsFailed.scene === scene)) return photonsCompiling
        photonsCompiling = prog_opt_photons(WG).then(p => { photons = p; photonsFailed = null })
            .catch(e => { photonsFailed = { scene, message: e?.message ?? String(e) }; console.error('[optics] the picture\'s photon kernel:', e) })
            .finally(() => { photonsCompiling = null })
        return photonsCompiling
    }
    const pictureSource = {
        name: 'optics sources',
        /* WHY IT ADDS NOTHING, when it does not: for the renderer's plan (R.photonPlan), the HUD and a
           report -- the light missing from the picture was otherwise indistinguishable from a light
           that is not there */
        why: () => !O.picture.on ? 'off'
            : !pictureSrc.table().count ? 'no light-traced sources in the scene'
            : !O.picture.applies() ? 'the scene showing is not the one the sources belong to'
            : photonsFailed && photonsFailed.scene === RT.scene ? `kernel failed: ${photonsFailed.message}`
            : !photons ? 'kernel compiling' : '',
        // none while there is nothing to light the picture with
        // none while there is nothing to light the picture with, or the scene is not the sources' own
        perPixel: () => (O.picture.on && pictureSrc.table().count && O.picture.applies()
            ? (O.picture.perPixel ?? (+RT.uniformBag?.()?.ltPhotons || 1)) : 0),
        ready: () => {
            if (!photons) { compilePhotons(); return false }
            return true
        },
        /* its kernel, for the renderer's per-kernel timing (raytrace_main.js R.timeKernels), under this name */
        kernelName: 'opt_photons',
        programs: () => photons ? [photons] : [],
        /* ITS FLUX PER PHOTON for `count` photons: generate() below gives each this, and the renderer
           hands the same number to the camera's paths, which share the light's direct paths with
           these photons by MIS and must weigh them by what the photons carry (Ray.ltMis).
           PLAIN LUMENS since 0.36.0: the camera connection divides by distances in the engine's unit,
           metres (ltConnect: G = cos dist / z^3), as the sun's photons' areas are. It was lumens per scene
           unit squared while the engine worked in the scene's unit -- and before that it divided by
           nothing, and in a centimetre scene the lit spot came out 10 000 times too dark, invisible,
           while a metre scene was right: the bug a unit kept in the engine invites. */
        fluxPerPhoton: count => pictureSrc.table().flux / count,
        /* `count` this batch's photons, `total` the sample's (core/photons.js planBatches): each carries the flux over
           the sample's total, as the batches add up to one sample. A caller with no batches gives no total. */
        generate: ({ buffer, offset, count, total = count, uniforms: u }) => {
            const pb = pictureSrc.buffers()
            photons.resources = { rayBuffer0: buffer.b, optSources: pb.src.b, optRays: pb.rays.b }
            /* EVERY UNIFORM ITS KERNEL READS (test/drawn.test.mjs walks it from main and checks): the seed, and the two
               marchTol() is made of (eps, epsAuto: core/tolerances.js; with sceneUnit, marchEps() until 0.36.0, when the
               engine went to metres), by which optSourceRay steps a photon off its light's face (kernels.js). They
               were not written here until 0.33.7, so this kernel's tolerance
               was its floor (inferred: 0 / 0 under max(.., 1e-7)) and every photon started on its face. Marching by
               distance hid it -- a hit moving away from its surface is nudged on (scene_api.js pathFacing, leaving) --
               but exact hits (sceneExact, gone in 0.41.0) found the face a hair behind, moved the photon back across it, and its black
               back took every one: the LEDs' light gone from the picture (the user, 2026-10-07, RGBW_mixer as data).
               On the container's software GPU: every photon's first hit that black back; the picture's mean 3.6, 22.3
               without exact hits, 22.9 with these written. The optics trace never had it: its generator is handed the
               whole bag (uniforms() above). */
            photons.uniforms = { seed: u.seed, eps: u.eps, epsAuto: u.epsAuto,
                                 optSrcCount: pictureSrc.table().count, optOffset: offset, optCount: count, optTotal: total,
                                 optFluxPerPhoton: pictureSource.fluxPerPhoton(total, u) }
            photons.dispatch(Math.ceil(count / 64), 1, 1)
        },
    }
    /** Light the picture with the source (on). `perPixel` overrides the photon count (the bench
     *  pins it); left out, the renderer's own light-tracing budget is used. Resolves once its kernel
     *  is compiled for the scene showing. */
    O.lightPicture = async (on, perPixel) => {
        O.picture.on = !!on
        O.picture.perPixel = perPixel == null ? null : Math.max(0, +perPixel || 0)
        if (on && !RT.photonSources.includes(pictureSource)) RT.photonSources.push(pictureSource)
        if (on) await compilePhotons()
        RT.invalidate?.()
        RT.redraw?.()
    }

    /* THE PATHS, drawn over the picture every frame the renderer presents (R.overlays): the last trace's or step's,
       from their copy (publish) -- never the trace buffer, which a run between two traces fills with its own */
    let paths = null
    O.drawPaths = (on = true, style = {}) => {
        if (!paths) {
            paths = makePathDrawer(WG, RT)
            if (view) paths.bind(view.buf)
            RT.overlays = RT.overlays || []
            RT.overlays.push(target => {
                if (!paths.on || !O.drawn) return
                paths.draw(target, O.drawn)
            })
        }
        paths.on = on
        Object.assign(paths.style, style)
        RT.redraw?.()
    }

    return O
}
