
import { genrays_prog, raygenTiles } from './genrays.js'
import { LT_GRID, LT_CELLS, EG_CELLS, EV_BASE, EL_SNAP, LEARN_WORDS, RAY_BYTES, SHADE_ITEM_BYTES } from './tracebasics.js'
import { rendertoscreen_prog } from './rendertoscreen.js'

import { DisplayUniformTypes, ComputeUniformTypes, computeUniformTypes, sceneConstantsWGSL } from './uniforms.schema.js'
import { SCENE_PRELUDE } from './scene_api.js'
import { showFPS, seed_vec4u32 } from './utilities.js'


import { prog_march, prog_surface, prog_shade, prog_flip, prog_prep_march_indirect, prog_prep_shade_indirect, prog_prep_occlude_indirect, prog_occlude, prog_resolve, prog_genphotons, prog_lt_build, prog_emit_collect, prog_emit_publish, prog_skynorm, prog_wf_snap, prog_shadow_flip, prog_stepcache_fill, prog_sppm, prog_occlude_emit, EMIT_ARGS_WORDS, SC_FILL_CHUNK, SC_FILL_WG, OCCLUDE_STEPS, WF_LOG_MAX, WF_LOG_WORDS, COUNTER_WORDS, counterWords } from './wavefront.js'
import { LUMA, EV_CLIP } from './photometry.js'
import { reading, standardError, regionReading } from './measure.js'
import { prog_ae_histogram, prog_ae_update, AE_HIST_BYTES, AE_STATE_BYTES } from './autoexposure.js'
import { prog_mf_lut, prog_mf_lut_avg, MF_WORDS, MF_LUT_ENTRIES, MF_AVG_ENTRIES } from './microfacet.js'
import { profileWG } from './profile.js'
import { prog_pick, readPick, PICK_WORDS } from './pick.js'
import { prog_field, prog_tagfield, TAG_FIELD_WORDS } from './field.js'
import { planBatches } from './photons.js'
import { SPPM_HEAD_WORDS, SPPM_REC, sppmCapacityFor, SPPM_LOOKED, SPPM_PROBE, sppmRadius, pixelFootprint, sppmKeep } from './sppm.js'
import { makeKernelTimer } from './kerneltime.js'
import { inlinedSize, predictCompile, learnRate, readRate, writeRate } from './compileprogress.js'

/* The display pass declares a SUBSET of the uniforms the compute passes do, and the call
   sites below hand it `{...uniforms}` — the whole UI state. tinywebgpu rejects a name its
   schema does not declare (it used to ignore them silently), which is the better behaviour:
   a typo in a uniform name is otherwise a value that never reaches the shader. So filter to
   what the display pass actually declares, rather than loosening the library. */
const RENDERKEYS = Object.keys(DisplayUniformTypes)     // the live display's: the step cache's view too
const forRender = vals => Object.fromEntries(
    RENDERKEYS.filter(k => vals[k] !== undefined).map(k => [k, vals[k]]))
/* ...and the same for the compute kernels that declare the BASE uniforms only -- genrays,
   resolve, genphotons, emit_collect, and shade since 0.20.8 -- so that their text is the same whatever the scene
   (genrays.js says why). The bag R.trace builds carries the scene's own uniforms too;
   handed whole to one of these, tinywebgpu would throw on the first scene name. A loop over the
   schema's keys rather than the bag's: the bag can hold a few hundred names and this runs once
   per program per trace. */
const COMPUTEKEYS = Object.keys(ComputeUniformTypes)
const forCompute = vals => {
    const o = {}
    for (const k of COMPUTEKEYS) if (vals[k] !== undefined) o[k] = vals[k]
    return o
}



/* How many march steps one wavefront iteration advances a ray. MUST match MAX_STEPS in the
   march kernel (wavefront.js) -- the iteration budget below is derived from it. */
const MARCH_STEPS = 32

/* Samples between rebuilds of light tracing's emission map (prog_lt_build). */
const LT_EPOCH = 4
/* Samples between rebuilds of the emitter list (prog_emit_collect / publish). Cheap -- a pass over
   4096 voxels and one thread -- so often: a newly seen emitter should be aimed at quickly.
   Exported for the bench, which lets discovery run this many samples twice before it measures. */
export const EMIT_EPOCH = 2

/* A FRAME'S SUBMISSIONS (R.trace, NO SUBMIT LONG ENOUGH TO BE KILLED): about SUBMIT_MS each, a frame under
   SPLIT_OVER_MS not cut, its time spread over at most SPLIT_ITERS iterations. Exported for the bench, whose
   "one sample in flight" step pins one submission a sample only where the engine would not have cut it. */
export const SUBMIT_MS = 150, SPLIT_OVER_MS = 250, SPLIT_ITERS = 24

/* A SAMPLE OVER SEVERAL FRAMES (R.trace's `slice`, the live loop's; 0.58.0): a sample of an untimed scene is cut into
   SLICE_UNTIMED batches until one is timed; never more than SLICE_MAX, nor (the batches the buffer forces aside) more
   than the sample's rays and photons over SLICE_MIN_RAYS, rounded up (a batch much smaller leaves most of the card
   idle, inferred) -- so a batch can fall a little under it: 921,600 camera rays and no photons (1280 x 720) make 57
   batches of about 16,168. Until 0.67.3 this said "nor batches under SLICE_MIN_RAYS", which rounding up does not keep.
   The timing is kept per pixel, as an EMA weighted SLICE_EMA to the newest: a slice is a band of the picture (genrays: a
   batch's tiles are consecutive), and a band of sky costs far less than a band of the object, so one slice alone says
   little about the sample. */
export const SLICE_UNTIMED = 8, SLICE_MAX = 256, SLICE_MIN_RAYS = 1 << 14, SLICE_EMA = 0.3   // R.sliceMinRays overrides the floor: the tests' 64-pixel picture

/* THE PHOTON MAP (0.60.0; core/sppm.js): the modes it runs in -- the full renderer, where it owns the class seen through glass; Draft
   and Optics, where a camera path ends at the surface it gathers on and the map adds what nothing there counts; not
   Sketch, which traces no photons -- and
   its geometry for a sample: r_1 the setting sppmRadius in pixels of the picture at the distance in focus (camLens.y in
   metres, the target's when no focus is set: camera.js; invProjection[5] is tan(fov/2), a perspective camera's), shrunk
   for the k-th sample since the reset, k = frames + 1 (sppmRadius); the cell 2r, so a gather's sphere meets eight lists;
   and 1 / (pi r^2). In metres, the engine's unit. */
export const SPPM_MODES = new Set([0, 1, 3])
export const sppmGeomFor = (u, frames, rows) => {
    const px = pixelFootprint(Math.max(1e-6, +u?.camLens?.[1] || 1), Math.abs(+u?.invProjection?.[5] || 1), rows)
    const r = Math.max(1e-7, sppmRadius((+u?.sppmRadius > 0 ? +u.sppmRadius : 3) * px, (frames | 0) + 1))
    return [r, 2 * r, 1 / (Math.PI * r * r), 0]
}

/* THE WAVEFRONT LOG's words (wavefront.js prog_wf_snap: per iteration readfrom, buf0, buf1, shadeCount, shadow0,
   shadow1, shadowcap, flushed, shadowcut, as the iteration left them) as what each iteration did: `marched` the rays
   its march took in (camera rays and photons alike), `next` those going on to the next one, `shaded` the hits it
   shaded, `occluded` the shadow rays and connections it traced, `shadowsNext` those queued for the next; and, so far
   in the sample, `flushed` the camera rays the last pass cut short and `shadowCut` the shadow rays (prog_occlude).
   Pure. */
export const readWavefrontLog = words => {
    const logged = words[0] >>> 0, iterations = []
    for (let k = 0; k < Math.min(logged, WF_LOG_MAX); k++) {
        const o = 1 + k * WF_LOG_WORDS
        const read0 = words[o] === 0
        const [b0, b1, shaded, s0, s1, cap, flushed, shadowCut] = Array.from(words.slice(o + 1, o + WF_LOG_WORDS), x => x >>> 0)
        iterations.push({ marched: read0 ? b0 : b1, next: read0 ? b1 : b0, shaded,
                          occluded: Math.min(read0 ? s0 : s1, cap), shadowsNext: read0 ? s1 : s0, flushed, shadowCut })
    }
    return { iterations, logged }
}

/* THE SCENE IS A PARAMETER NOW, not a literal in three places. It is an object -- see
   scenes/ -- carrying the WGSL, and optionally uniforms of its own and GPU
   resources it created. Everything the renderer knows about geometry arrives through it. */
export let RAYTRACER = (WG, _U, Q, scene) => {
    let R = {
        /* WHERE THIS RENDERER'S READOUT GOES: the page's Render stats (utilities.js showFPS), unless the
           host makes a quiet one (createPathTracer's `hud: false` -- the library's studio, which renders
           thumbnails beside the view). Every write below goes through it; they went straight to the
           one global readout, which was right only while a page had one renderer. */
        hud: showFPS,
        trace_wgsize: 64, // keep in sync with WGSL workgroup_size
        // WGSL struct sizes (16B alignment):
        // Ray: 4x vec3<f32> (64B, the last ending at 60), a scalar in each of the first three's padding, + 13 scalars
        // to byte 112 (0.37.0: the medium's absorption, muR/muG/muB and absLtot, took the last free words)
        // Hit: Ray(112) + vec4<f32>(16) + 3 scalars = 140, rounded up to 144 bytes
        // a shade queue item (scene_api.js ShadeItem, 0.20.8): the Hit, then the Surface the surface kernel writes
        // beside it -- a Material2 (96 since 0.39.0, a coating's four more fields; 80 from 0.22.4, when its unread
        // `model` went; 96 before), a vec3 and a scalar (16), and the medium beyond's absorption, a vec3 rounded to 16
        // (0.37.0) -- 144 + 128 = 272 bytes (288 from 0.44.0 to 0.61.0, the manifold connection's answer beside them)
        // tracebasics.js RAY_BYTES and SHADE_ITEM_BYTES, which test/structs.gpu.mjs holds to the WGSL compiler's strides
        scene,                  // swapped with R.setScene(); see _buildWavefrontPipelines
        rayStuctSize: RAY_BYTES,
        wvf_wg: 64,
        hitStructSize: SHADE_ITEM_BYTES,       // the shade queue's item, not the Hit alone (above)
        raycount: 0,
        raybufferSize: 0,       // rays the buffers can currently hold; set by ensureBuffers
        /* The ceiling on rays in flight, expressed as the memory they may occupy rather than
           as a ray count -- a count hides what it costs, which is how the old one came to be
           what it was. A ray is rayStuctSize (112) bytes in each of the two ping-pong buffers
           plus a hitStructSize (272) shade queue item: 496 bytes, so this budget is ~2.16 M rays
           (R.maxRays, below; 512 and ~2.10 M between 0.44.0 and 0.61.0, while the manifold connection's answer
           rode beside the hit; 480 and ~2.24 M between 0.37.0 and 0.39.0, which put a coating in the material;
           464 and ~2.31 M between 0.22.4 and 0.37.0, which put the medium beyond's absorption
           beside the hit; 480 and ~2.24 M before 0.22.4 took the material's unread `model` out of
           the item, 368 bytes and ~2.92 M before 0.20.8 put the scene's answers beside the
           hit, 320 bytes and ~3.35 M before the Ray grew six fields: sunmis, tag,
           tmax, prevPdf, vtxLtot, ltMis), enough to cover 1080p at one ray per pixel (2.07 M)
           outright; a sample with more rays and photons than this runs in batches (core/photons.js
           planBatches, 0.38.1), so the cap costs time, never coverage or light.

           What it replaces: a flat 4 M rays allocated unconditionally at every resolution,
           in THREE ray buffers plus the hit buffer -- ~1.7 GB whether the canvas was 4K or
           256 px. It only ever validated because init() asks the adapter for its maximum
           maxBufferSize / maxStorageBufferBindingSize; on a device reporting the spec
           defaults (256 MB / 128 MB) every one of those allocations fails outright. */
        rayBudgetBytes: 1024 * 1024 * 1024,
        // ---- the iteration budget (see THE ITERATION BUDGET IS THE WORST CASE in R.trace) ----------
        budget: 0,          // iterations the last trace ran (written by R.trace; setting it has no effect)
        used: 0,            // iterations the GPU reported it needed last frame (the HUD, the benchmark)
        flushed: 0,         // rays the last pass had to terminate last frame (the HUD, the benchmark)
        /* Pin the chain to exactly N iterations instead of the worst case. 0 = off. This is
           the only way to ask what an ITERATION costs with everything else held still:
           maxbounce and maxiter both change the iteration count AND the work inside it, so
           neither can separate the two, and the reading that justified the old adaptive
           controller was taken with maxiter for exactly that reason. Safe to
           set too low -- THE FLUSH means a short budget costs convergence, not light. */
        budgetOverride: 0,
        /* The photon map's gather budget, in records walked a gather (core/sppm.js SPPM_VISIT, its default at 0). For the
           tests only: a small one makes every cell a full one, so the sub-lists' path runs (sppm.gpu.mjs). */
        sppmVisit: 0,
        /* Submit every N wavefront iterations, whatever NO SUBMIT LONG ENOUGH TO BE KILLED (R.trace) would choose.
           0 = off. For measuring only: the benchmark's first two runs put a sample's wall clock 50-57 ms above its
           GPU time at 24 iterations with the JavaScript at 6-12 ms, yet its fastest sample within 5-16 ms of it
           (the user's Pascal card, 2026-10-02). If the rest is the browser preparing one long submission before the
           GPU may start, cutting it lets the GPU start on the first part while the rest is prepared -- the
           benchmark's "a submission per iteration" rows ask. */
        submitEvery: 0,
        _reading: false,    // a counter readback is in flight
    }
    R.maxRays = Math.floor(R.rayBudgetBytes / (2 * R.rayStuctSize + R.hitStructSize))
    /* ...AND WHAT ONE BUFFER MAY HOLD ON THIS DEVICE. The budget above is a total across four
       buffers; the device limits each one, and the hit buffer is the largest (hitStructSize, 272
       bytes a ray since 0.61.0, as above; 288 from 0.44.0 to 0.61.0, 272 from 0.39.0, 256 from 0.37.0, 240 from 0.22.4,
       256 from 0.20.8, 144 before: on a device at the spec's 128 MiB a binding, 493 k rays in flight, 466 k at 288, 524 k
       at 256, 559 k at 240 and 932 k at 144 -- fewer rays a pass, never an error. Until 0.67.3 this said 288 "since
       0.44.0").
       Light tracing's photons ride the same buffers, so turning it on can double what they must
       hold -- past a per-buffer limit the allocation or its binding fails, and what surfaces is
       an invalid bind group pages away from here. Capped instead: fewer rays, never an error. */
    {
        const lim = WG.device?.limits
        const perBuffer = Math.min(lim?.maxStorageBufferBindingSize ?? Infinity, lim?.maxBufferSize ?? Infinity)
        if (Number.isFinite(perBuffer)) R.maxRays = Math.min(R.maxRays, Math.floor(perBuffer / R.hitStructSize))
    }

    // {buf0, buf1, shade, readfrom, used, flushed, shadow0, shadow1, shadowcap} as u32
    R.counters = WG.createStorageBuffer(COUNTER_WORDS * 4);   // see counterstruct in wavefront.js
    /* THE STEP CACHE'S CELLS (wavefront.js stepCacheWGSL), bound to the march and occlusion kernels when they were built
       with the cache (R.builtOptions below): a word until the host gives a box (R.setStepCacheBox), then one a cell. */
    R.stepCacheBuf = WG.createStorageBuffer(16);
    R.stepCacheGrid = null;                                   // { lo, cs, dims } in scene units, or none
    R.indirect_march = WG.createIndirectBuffer(); // 3*u32
    R.indirect_shade = WG.createIndirectBuffer(); // 3*u32
    R.indirect_occlude = WG.createIndirectBuffer(); // 3*u32
    /* prog_occlude_emit's dispatch arguments and its pending word (wavefront.js EMIT_ARGS_WORDS), for the emitter shadow
       rays the distance-only occlusion kernel hands on: tinywebgpu's indirect buffers are three words, so one of four with
       the same usage (INDIRECT 256, STORAGE 128, COPY_DST 8: the spec's values, as tinywebgpu spells them) -- 16 bytes */
    R.emitArgs = WG.createBuffer(4 * EMIT_ARGS_WORDS, 256 | 128 | 8, 'emitArgs');

    /*==================================================================================
      BUFFERS SIZED FROM THE PICTURE, not from a constant.

      Two things made this necessary. The ray buffers were a fixed 4 M rays whatever the
      canvas (see maxRays above). And the accumulation buffer was sized ONCE, at
      construction, from Q.w/Q.h -- so resizing the window grew the pixel count past the
      buffer and the shaders indexed off the end of it.

      Called at the top of every trace, and cheap: it returns immediately unless the
      requirement actually grew. It never shrinks, so dragging a window smaller does not
      churn allocations.
    ==================================================================================*/
    let bufRays = 0, bufPixels = 0
    /* `photons` is light tracing's photons per pixel: they ride the same ray buffers, after the
       camera rays, so the buffers must hold both. */
    R.ensureBuffers = (w, h, photons = 0) => {
        const pixels = Math.max(1, w * h)
        const rays = Math.min(R.maxRays, pixels + Math.ceil(pixels * Math.max(0, photons)))
        if (rays <= bufRays && pixels <= bufPixels) { R.raybufferSize = bufRays; return false }

        if (rays > bufRays) {
            for (const k of ['raybuffer0', 'raybuffer1', 'shadebuffer'])
                R[k]?.b?.destroy?.()
            R.raybuffer0 = WG.createStorageBuffer(rays * R.rayStuctSize)   // rays, ping
            R.raybuffer1 = WG.createStorageBuffer(rays * R.rayStuctSize)   // rays, pong
            R.shadebuffer = WG.createStorageBuffer(rays * R.hitStructSize) // hits waiting to be shaded
            bufRays = rays
        }
        if (pixels > bufPixels) {
            for (const k of ['accumulation_u32', 'frame_u32', 'splat_u32', 'moments']) R[k]?.b?.destroy?.()
            R.accumulation_u32 = WG.createStorageBuffer(pixels * 16)  // the picture: EMA {r,g,b,count}
            // its error bar, {V, S} per pixel as f32 -- see THE ERROR BAR in prog_resolve
            R.moments = WG.createStorageBuffer(pixels * 8)
            R.frame_u32 = WG.createStorageBuffer(pixels * 16)         // THIS sample: fixed point {r,g,b,count}
            /* THIS sample's light-tracing connections, fixed point {r,g,b,-}. Its own buffer
               because resolve divides the frame buffer by the number of camera paths on the
               pixel, and a photon's estimate must be added once, not averaged in. */
            R.splat_u32 = WG.createStorageBuffer(pixels * 16)
            // WebGPU zero-fills a new buffer, so this is belt and braces -- but prog_resolve
            // reads the count word to decide whether a pixel got anything this sample, and
            // that invariant is worth stating where it is established.
            R.frame_u32.clear()
            R.splat_u32.clear()
            bufPixels = pixels
            R._slice = null                                   // a sample over frames: its part done went with the buffers
        }
        R.raybufferSize = bufRays
        if (shadowRays > 1 && shadowRays < bufRays) { shadowRays = 0; R.ensureShadow(true) }
        R.rebind()
        return true
    }

    /* GIVE THE MEMORY BACK. ensureBuffers is grow-only on purpose -- dragging a window smaller
       should not churn allocations -- but "never shrinks" is the wrong answer after a one-off
       render at a size the session will never use again. A 4096x4096 save allocates 16.8 M
       pixels of accumulation plus the same of frame buffer, 537 MB, and holds it for as long as
       the page is open while the live view goes back to using a twentieth of it.

       So: drop the high-water marks and destroy what they were holding. The next ensureBuffers
       -- the top of the very next trace -- allocates at whatever size is current. The caller
       must invalidate the accumulation, which it is doing anyway: everything here is destroyed,
       including the picture. */
    R.releaseBuffers = () => {
        for (const k of ['raybuffer0', 'raybuffer1', 'shadebuffer',
                         'accumulation_u32', 'frame_u32', 'splat_u32', 'moments'])
            R[k]?.b?.destroy?.()
        R.raybuffer0 = R.raybuffer1 = R.shadebuffer = null
        R.accumulation_u32 = R.frame_u32 = R.splat_u32 = R.moments = null
        bufRays = 0; bufPixels = 0; R.raybufferSize = 0
        R._slice = null
        /* The occlusion queue goes back to its one-element placeholders rather than to nothing.
           rebind() dereferences shadowBuffer0.b unconditionally, and the next ensureBuffers
           calls rebind BEFORE trace's own `ensureShadow(nee)` gets a chance to regrow them --
           so leaving them null here is a null dereference one frame later. Allocated inline
           instead of through ensureShadow, which would rebind against the buffers this
           function has just destroyed. */
        for (const k of ['shadowBuffer0', 'shadowBuffer1']) R[k]?.b?.destroy?.()
        R.shadowBuffer0 = WG.createStorageBuffer(R.rayStuctSize)
        R.shadowBuffer1 = WG.createStorageBuffer(R.rayStuctSize)
        shadowRays = 1
        /* ...and the photon map's records, grown with the picture (sppmRoom): a 4K save's are 352 MB at the default. The
           next trace that runs the map makes them again at its own size. */
        sppmRoom(0)
    }

    /* The occlusion queue, allocated the first time NEE actually runs and grown with the rest.
       Two more ray-sized buffers -- at 1024x1024 that is another ~200 MB -- which is why
       they are not in the unconditional budget: with NEE off they stay one element and cost
       nothing but a binding. Placeholders rather than nothing, because a binding still has to
       exist for the kernels that declare it. */

    /* LIGHT TRACING'S EMISSION MAP -- see prog_lt_build. Small (LT_CELLS words each, 64 KB), so
       allocated outright rather than on first use. The CDF starts UNIFORM, not zero: a zero CDF
       is not a distribution (every cell has mass 0, the search walks off the end and the density
       divided by is 0), and uniform is exactly what the build writes when nothing is learned. */
    const ltUniformCDF = () => {
        const a = new Float32Array(LT_CELLS + LT_GRID)
        for (let r = 0; r < LT_GRID; r++) {
            for (let c = 0; c < LT_GRID; c++) a[r * LT_GRID + c] = (c + 1) / LT_GRID
            a[LT_CELLS + r] = (r + 1) / LT_GRID
        }
        return a
    }
    R.ltEmit = WG.createStorageBuffer(LT_CELLS * 4)
    /* The learn buffer (layout in tracebasics.js): photon connection counts, emitter discovery
       and the emitter list. Initialised with every voxel's box EMPTY (min = all ones, max = 0),
       which atomicMin/atomicMax need to start from; zero would pin every box to the corner. */
    const learnInit = () => {
        const a = new Uint32Array(LEARN_WORDS)
        for (let c = 0; c < EG_CELLS; c++) { const o = EV_BASE + c * 8; a[o] = a[o + 1] = a[o + 2] = 0xFFFFFFFF }
        return a
    }
    /* ...and past it, the material albedo tables (microfacet.js), computed once at init by
       prog_mf_lut. Sized for both; clearLight writes only the first LEARN_WORDS, so the tables
       outlive every clear. */
    R.learn = WG.createStorageBuffer((LEARN_WORDS + MF_WORDS) * 4)
    R.learn.w(learnInit())
    R.emitCount = 0                                // emitters listed, read back a frame late
    R.ltCDF = WG.createStorageBuffer(ltUniformCDF())
    let ltBuilt = 0                                // samples since the map was last rebuilt
    let emitBuilt = 0                              // ...and since the emitter list was
    /* Forget the map. Not needed for correctness -- it forgets on its own -- but a new scene
       should not spend its first samples unlearning the last one's glass. */
    R.clearLight = () => {
        try { R.ltEmit.clear(); R.learn.w(learnInit()); R.ltCDF.w(ltUniformCDF()); ltBuilt = 0; R.emitCount = 0 } catch { }
    }
    /* THE EMITTER COUNT, READ AND WAITED FOR. R.emitCount comes from one unawaited readback a
       trace, which lands only when the page yields to its event loop: the render loop does between
       frames, step() does not between samples. So through a whole bench row the count stayed what
       it was when the row began -- 0 after clearLight -- and light tracing's split sent no photon
       to an emitter the row had long since discovered (light-vs-emitter's first press read 0
       emitters on its emitter rows, 2026-09-29). A caller that needs the count now reads it here.
       The loop's own read, older, lands first, so it cannot overwrite this one. */
    R.readEmitCount = async () => {
        await R._emitRead
        const a = await R.learn.r(4, EL_SNAP * 4, Uint32Array)
        return (R.emitCount = a[0] >>> 0)
    }

    /* THE PHOTON MAP'S MEMORY (core/sppm.js): its heads (the count, the gathers cut short, a head a list, a count a list,
       the sub-lists' heads: 12 MiB) and its records,
       SPPM_REC words a photon. Made at the first trace that runs the map, made again when the capacity asked changes,
       freed when the map is switched off (R.applyKernelOptions). Never more than one binding holds on this device: past
       it a sample's photons are dropped and counted (R.sppmStats), never an invalid bind group. Returns the capacity.
       GROWN, NOT SHRUNK, AS THE PICTURE'S SIZE CHANGES (0.next): the capacity follows the pixels above the reference
       (sppm.js sppmCapacityFor), so a panel dragged larger asks a new one every frame -- hundreds of MB made again each
       time. So a smaller capacity is served from the records already there (sppmCap the capacity in use, sppmAlloc what
       the buffer holds), and they are made again only when more is asked, when the setting itself (`asked`) changes, or
       after R.releaseBuffers has given them back (index.js endOffscreen, after a save larger than the view). */
    let sppmCap = 0, sppmAlloc = 0, sppmAsked = null;
    R.sppmHeads = R.sppmRecs = null;
    R.sppmStats = null;
    const sppmRoom = (cap, asked = cap) => {
        const lim = WG.device?.limits
        const perBuffer = Math.min(lim?.maxStorageBufferBindingSize ?? Infinity, lim?.maxBufferSize ?? Infinity)
        cap = Math.max(0, Math.floor(Math.min(cap, perBuffer / (SPPM_REC * 4))))
        if (cap === sppmCap && (cap === 0) === !R.sppmHeads) return cap
        if (cap > 0 && R.sppmHeads && cap <= sppmAlloc && asked === sppmAsked) { sppmCap = cap; R.sppmStats = null; return cap }
        R.sppmHeads?.b?.destroy?.(); R.sppmRecs?.b?.destroy?.()
        R.sppmHeads = R.sppmRecs = null; R.sppmStats = null
        sppmCap = sppmAlloc = cap
        sppmAsked = asked
        if (cap > 0) {
            R.sppmHeads = WG.createStorageBuffer(SPPM_HEAD_WORDS * 4)      // the header, the heads, the counts, the sub-lists' heads
            R.sppmRecs = WG.createStorageBuffer(cap * SPPM_REC * 4)
        }
        if (R.raybuffer1) R.rebind()
        return cap
    }
    R.sppmRoom = sppmRoom

    let shadowRays = 0
    R.ensureShadow = (want) => {
        const n = want ? bufRays : 1
        if (n <= shadowRays) return false
        for (const k of ['shadowBuffer0', 'shadowBuffer1']) R[k]?.b?.destroy?.()
        R.shadowBuffer0 = WG.createStorageBuffer(n * R.rayStuctSize)
        R.shadowBuffer1 = WG.createStorageBuffer(n * R.rayStuctSize)
        shadowRays = n
        R.rebind()
        return true
    }

    ///======================================================================================================================================
    /*
                                        
                                88  888b      88  88  888888888888  
                                88  8888b     88  88       88       
                                88  88 `8b    88  88       88       
                                88  88  `8b   88  88       88       
                                88  88   `8b  88  88       88       
                                88  88    `8b 88  88       88       
                                88  88     `8888  88       88       
                                88  88      `888  88       88       
                                    
                                    
    */
    // small helper to build all wavefront pipelines
    /* BUILT IN PARALLEL, AND THE BIG FOUR OFF-THREAD.

       This was nine sequential awaits, and every one of them awaited nothing: the pipeline
       calls underneath were synchronous, so each blocked the thread that paints until the
       driver had finished compiling. The four kernels that inline the scene are now built
       with `async: true` (see prog_march in wavefront.js for why that matters so much here),
       which means the compile happens off-thread and the handle arrives with an empty
       `pipeline` and a `ready` promise.

       Promise.all rather than a chain, because even off-thread nine in sequence costs the
       SUM of nine compiles and this costs the longest one. Then every `ready` is awaited
       before returning, so the contract is exactly what it was: when this resolves, every
       pipeline can be dispatched. Anything less would surface as tinywebgpu's "Pipeline is
       still compiling" error at the first dispatch rather than as a wrong picture.

       rebind() before the awaits is deliberate and supported: setResources on a pipeline
       that is still compiling parks the values and replays them when it arrives. */
    /* HOW FAR A COMPILE HAS GOT, for a host that shows it (R.compileListeners; index.js onCompile): told
       { done, total } as each pipeline becomes ready, and { end: true } when all are or one failed. The
       pipelines compile in parallel, so the count moves in steps, mostly toward the end -- the scene's own
       kernels are the slow ones -- but "3 of 14, 14 s" still says it is working, which silence did not.
       AND HOW LONG IT WILL TAKE, once the kernels are requested: { ..., expectMs, startedAt } on every notice
       after that (compileprogress.js says what predicts it), so a host can move its bar by the clock instead
       of a count that sits at 12 of 13 for most of the build (the user, 2026-10-03). No expectMs when nothing
       compiles -- a build all from the cache -- or nothing could be measured (a device whose handles hold no
       text): such a host shows the count, as before. startedAt is performance.now() at the request. */
    R.compileListeners = new Set();
    const toldCompile = p => { for (const f of R.compileListeners) { try { f(p); } catch { } } };
    /* THE WAVEFRONT KERNELS, ONE TABLE: [name, the R property it lives in, how to make it]. The build below
       uses it, and so does the benchmark's uncached compile (R.compileUncached), so that what is timed there
       is what a scene change builds -- an earlier profile kept its own list, five of whose kernels were the
       live text byte for byte and came back in 0-3 ms (most likely cached). `G` is the device: the renderer's, or
       profile.js profileWG's, which makes every text one no cache has seen. */
    /* THE KERNELS' OWN OPTIONS (0.29.0; the user, 2026-10-07: "make sure that all these different options, even when
       turned off, dont impose an overhead"). A feature that was a uniform tested at every step -- the step cache -- is
       compiled into the kernels only when on, so off they are the text they were before it existed (check-shaders and
       build.test.mjs compare). `R.kernelOptions` is what is asked -- the facade sets it from the settings (index.js
       syncKernels: R.kernelOptionsOf) -- and every build reads it; `R.builtOptions` what the kernels in place were built
       with, which the bindings and the cache's fill follow. A change of it is a build (R.applyKernelOptions):
       - stepCache: 0 off, 1 the own cell's ball, 2 the cells ahead too (the march and occlusion kernels, which only
         read the cells; prog_stepcache_fill fills them before the trace -- the march's own lazy fill, the kernel option
         cacheOnce's other side, went in 0.41.0);
       - cacheView: the cells drawn over the picture (the display pass), only with the cache;
       - sppm: the photon map's kernel (core/sppm.js, wavefront.js prog_sppm) and its buffers, only while it is on. It
         holds no scene, so it is built alone (R.applyKernelOptions), as the display pass is.
       (THE MARCH ON DISTANCE ONLY is not an option: it was, as marchDist, until the user's run of Tests > marchdist, and
       the renderer's march is always it now -- wavefront.js prog_march's distOnly, prog_surface's THE HIT ITSELF. Nor are
       SHADOW RAYS ON DISTANCE ONLY: occludeDist until the user's run of Tests > occludedist (0.next), and the renderer's
       occlusion kernel is always it now, with the resolve for the emitter rays it hands on -- wavefront.js prog_occlude's
       distOnly, prog_occlude_emit.) */
    R.kernelOptionsOf = u => {
        const stepCache = Math.max(0, Math.min(2, (u?.stepCache | 0)));
        return { stepCache, cacheView: stepCache && (u?.stepCacheView | 0) ? 1 : 0, sppm: (u?.sppm | 0) ? 1 : 0 };
    };
    R.kernelSettings = ['stepCache', 'stepCacheView', 'sppm'];  // the settings R.kernelOptionsOf reads
    R.kernelOptions = R.kernelOptionsOf({});
    R.builtOptions = { ...R.kernelOptions };
    const sameOptions = (a, b) => !!a && !!b && a.stepCache === b.stepCache && a.cacheView === b.cacheView && !!a.sppm === !!b.sppm;
    R.sameKernelOptions = sameOptions;
    const cacheOf = opts => ({ stepCache: opts.stepCache });
    /* THE HAZE (0.62.0; core/haze.js) IS THE SCENE'S, NOT A SETTING: the march, shade and occlusion kernels have its code
       only for a scene with a haze box (scene.haze, the builder's), read here from the scene each build is OF -- so every
       path that builds (a scene swapped in, the bench's uncached compile) builds what that scene needs, in one build. A
       setting (R.kernelOptions) reaches a build only after the facade's syncKernels: a scene swap would build twice. Its
       values are uniforms (DERIVED: RT.updateScene moves them); only its presence is text (sceneTextOf). */
    const hazeOf = scene => ({ haze: scene?.haze ? 1 : 0 });
    /* ANSWERS ALONG THE RAY (0.next; core/along.js) ARE THE SCENE'S TOO, as the haze is: codegen writes them into a scene's
       text when the developer setting alongRay is on and a shape answers (scene.along), and the march and occlusion read
       them only then -- so a scene's text and its kernels change together, in one build */
    const alongOf = scene => ({ along: scene?.along ? 1 : 0 });
    const wavefrontKernels = (G, scene, opts = R.kernelOptions) => [
        ['genrays', 'prog_genrays2', () => genrays_prog(G, R.trace_wgsize, scene)],
        // the renderer's march asks the scene for its distance alone, the surface kernel for the whole hit (wavefront.js)
        ['march', 'prog_wvfmarch', () => prog_march(G, scene, R.wvf_wg, { ...cacheOf(opts), ...hazeOf(scene), ...alongOf(scene), distOnly: 1 })],
        // the scene's answers about each hit (normal, material, medium), then shade, which holds no scene (0.20.8)
        ['surface', 'prog_wvfsurface', () => prog_surface(G, scene, R.wvf_wg)],
        ['shade', 'prog_wvfshade', () => prog_shade(G, scene, R.wvf_wg, hazeOf(scene))],
        ['flip', 'prog_wvfflip', () => prog_flip(G)],
        ['prep_march', 'prog_prep_march', () => prog_prep_march_indirect(G, R.wvf_wg)],
        ['prep_shade', 'prog_prep_shade', () => prog_prep_shade_indirect(G, R.wvf_wg)],
        // shadow rays ask the scene for its distance alone too, an emitter's blocked one handed to its resolve (wavefront.js)
        ['occlude', 'prog_wvfocclude', () => prog_occlude(G, scene, R.wvf_wg, { ...cacheOf(opts), ...hazeOf(scene), ...alongOf(scene), distOnly: 1 })],
        ['prep_occlude', 'prog_prep_occlude', () => prog_prep_occlude_indirect(G, R.wvf_wg, { emit: 1 })],
        ['occlude_emit', 'prog_occlude_emit', () => prog_occlude_emit(G, scene, R.wvf_wg, hazeOf(scene))],
        ['shadow_flip', 'prog_shadow_flip', () => prog_shadow_flip(G)],
        ['resolve', 'prog_resolve', () => prog_resolve(G, R.trace_wgsize, scene)],
        ['genphotons', 'prog_genphotons', () => prog_genphotons(G, R.trace_wgsize, scene)],
        ['lt_build', 'prog_lt_build', () => prog_lt_build(G, scene)],
        ['emit_collect', 'prog_emit_collect', () => prog_emit_collect(G, scene)],
        ['emit_publish', 'prog_emit_publish', () => prog_emit_publish(G)],
        // the step cache's cells filled before the trace, which the march and occlusion kernels only read
        ...(opts.stepCache ? [['stepcache_fill', 'prog_stepcache_fill', () => prog_stepcache_fill(G, scene)]] : []),
        // the photon map's store and gather, between surface and shade, only while it is on (core/sppm.js)
        ...(opts.sppm ? [['sppm', 'prog_sppm', () => prog_sppm(G, scene, R.wvf_wg)]] : []),
    ];
    /* PER-KERNEL GPU TIME (core/kerneltime.js), off unless asked for -- the benchmark asks. A pass is named by
       the table above: its program looked up among this build's kernels (R[prop]), 'other' for anything
       else. */
    const KERNEL_PROPS = wavefrontKernels(null, null, { stepCache: 1, sppm: 1 }).map(([name, prop]) => [name, prop]);   // every kernel a build can have
    R._kt = null; R._ktOn = false; R._ktLast = null;
    R.timeKernels = (on = true) => {
        if (on && !R._kt) R._kt = makeKernelTimer(WG.device);
        R._ktOn = !!on && !!R._kt?.available;
        if (!R._ktOn) WG.timePasses?.(null);     // a trace that threw between begin and end left the hook set
        return R._ktOn;
    };
    /** The last timed trace's kernels: { ms, count, passes, overflow, seq, spanMs, gapMs }, or null. */
    R.kernelTimes = () => R._ktLast ?? Promise.resolve(null);
    /* THE WAVEFRONT LOG (wavefront.js prog_wf_snap), off unless asked for -- the benchmark asks, for one sample a row.
       While on, every iteration of a trace leaves its counters in R.wfLog, one thread and one pass an iteration;
       R.wavefrontCounts() reads the last trace's (readWavefrontLog, above RAYTRACER). */
    R._wfOn = false; R._wfLast = null;
    R.wavefrontLog = async (on = true) => {
        if (on && !R.prog_wf_snap) {
            R.wfLog = WG.createStorageBuffer(4 * (1 + WF_LOG_MAX * WF_LOG_WORDS));
            R.prog_wf_snap = await prog_wf_snap(WG);
            await R.prog_wf_snap.ready;
            R.prog_wf_snap.resources = { counters: R.counters.b, wfLog: R.wfLog.b };
        }
        R._wfOn = !!on;
        if (!on) R._wfLast = null;              // read it before turning the log off: no stale counts after
        return R._wfOn;
    };
    /** The last logged trace's iterations ({ iterations: [...], logged }, readWavefrontLog), or null. */
    R.wavefrontCounts = () => R._wfLast ?? Promise.resolve(null);
    /* WHETHER THERE IS ANYTHING TO TRACE WITH. From the start of a build until every kernel is ready, the
       new pipelines are installed (above: rebind before the awaits) but some are still compiling, and a
       dispatch on one throws "No resources bound" from inside its compute pass -- the pass left open, the
       frame's command buffer rejected at the next submit. A redraw asked for during the FIRST build (R.init,
       on a cold load: the user, 2026-09-30) did exactly that, after the same thing had been fixed for
       setScene alone (530a9d7). So the state lives here, where every build passes, and R.trace refuses on
       it: _building counts builds in progress; _built is true only once a build has had every kernel ready,
       false before the first and after one that failed. */
    R._building = 0;
    R._built = false;
    R._buildWavefrontPipelines = async () => {
        const opts = { ...R.kernelOptions };          // as asked when the build began: what the handles are built with
        const table = wavefrontKernels(WG, R.scene, opts);
        const total = table.length;
        let done = 0;
        R._building++;
        R._built = false;
        let expect = {};                           // { expectMs, startedAt } once predicted, on every notice after
        toldCompile({ done, total, scene: R.scene?.id ?? null });
        try {
            const startedAt = performance.now();
            const made = await Promise.all(table.map(([, , make]) => make()));
            table.forEach(([, prop], i) => { R[prop] = made[i]; });
            if (!opts.stepCache) R.prog_stepcache_fill = null;   // not in this build: none left from the last
            if (!opts.sppm) R.prog_sppm = null;
            R.builtOptions = { ...R.builtOptions, ...cacheOf(opts), sppm: opts.sppm ? 1 : 0 };   // the bindings follow the handles in place
            stepCacheRoom();                       // the cells' buffer as these kernels need it (none without the cache)
            R.rebind();
            /* THE PREDICTION, after the requests. Its cost, measured in node on the development machine's CPU
               (2026-10-03, the bench scenes' handle text with G.defines expanded): 4-18 ms a big kernel, about
               30-40 ms for all of the Noise library's -- under 1% of its 5-7 s build. Whether that is spent
               while the kernels compile or before they start is INFERRED, not known: it overlaps only if Chrome
               has already sent the createComputePipelineAsync calls to the GPU process, and nothing read here
               says it sends them before this task's microtasks drain (the await above yields only to those).
               A yield to a task first would not settle it either, and a timer in a hidden tab waits up to a
               second -- holding the build's end, since the readiness below is awaited after it. What would
               test it: the console's 'ready at' for shade with this line skipped, against with it, interleaved.
               Only the kernels not from the cache: a cached one is ready at once whatever its size.
               A handle with no text (a stub device's) has no size and is left out; none at all, no expectMs. */
            const sized = made.map((p, i) => ({ name: table[i][0], cached: !!p.cached, size: p.cached ? null : inlinedSize(p.wgsl, WG.defines) }));
            const rate = readRate();
            const guess = predictCompile(sized, rate);
            if (guess) {
                expect = { expectMs: guess.expectMs, startedAt };
                toldCompile({ done, total, scene: R.scene?.id ?? null, ...expect });
            }
            /* WHEN EACH WAS READY, logged once per build (R._lastCompile): in parallel, so this is the
               order they finished in and the wait for each, not what each cost alone --
               RT.profileCompile() measures that. */
            const t0 = performance.now(), readyAt = {};
            await Promise.all(made.map((p, i) => Promise.resolve(p.ready).then(() => {
                readyAt[table[i][0]] = Math.round(performance.now() - t0);
                sized[i].ms = performance.now() - startedAt;   // from the request, as the rate was fitted (compileSeqEach)
                toldCompile({ done: ++done, total, scene: R.scene?.id ?? null, ...expect });
            })));
            R._built = true;                       // every kernel ready: something to trace with
            /* LEARNED FROM A BUILD THAT COMPILED SOMETHING: the slowest uncached kernel's time over its size, half
               into the kept rate (compileprogress.js learnRate: nothing from a build whose slowest took < 300 ms,
               nor from one under a quarter of the rate -- the browser's own cache answering after a reload, which
               tinywebgpu's `cached` cannot see -- and no build moves it more than twice).
               Only a build that succeeded: a failed one's times are of a refusal, not a compile. */
            const learned = learnRate(rate, sized);
            if (learned !== rate) writeRate(learned);
            /* HOW MANY CAME FROM TINYWEBGPU'S PIPELINE CACHE (its `cached`): text this device had compiled before --
               a scene switched back to, an undo, the studio building what the main renderer has. A build all from
               the cache compiled nothing -- no shader module, no pipeline; only each handle's own buffers and bind
               groups were made -- so its time says nothing about what the scene costs to compile; the count says
               which kind of build a time is. */
            const fromCache = made.filter(p => p.cached).length;
            /* TWO INTERVALS, kept apart: `ms` and `readyAt` from t0, after the handles were made and sized -- as
               they always were, for whoever compares builds across versions -- and `fromRequestMs` from startedAt,
               before make(), which is what the prediction and the learned rate are of. The console line gives
               the second beside the prediction, so the two numbers it shows are of the same interval. */
            R._lastCompile = { scene: R.scene?.id ?? null, ms: Math.round(performance.now() - t0), readyAt, fromCache, total,
                               fromRequestMs: Math.round(performance.now() - startedAt), expectMs: guess?.expectMs ?? null, rate: learned };
            console.log(`[pathtracer] compiled '${R._lastCompile.scene}' in ${(R._lastCompile.fromRequestMs / 1000).toFixed(1)} s from the request (${fromCache} of ${total} from the cache${guess ? `; predicted ${(guess.expectMs / 1000).toFixed(1)} s` : ''}); ready at (ms after the handles were made):`,
                Object.entries(readyAt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
        } finally {
            /* _building falls BEFORE the end notice: a listener that redraws on it (index.js, a redraw asked
               for during the build) must find the renderer ready, not still building */
            R._building--;
            toldCompile({ done: total, total, end: true, scene: R.scene?.id ?? null });
        }
    };

    /* WHAT A SCENE COSTS TO COMPILE, UNCACHED: the build's own kernels for `scene` (the table above), every one
       with a guard line no cache has seen at the top of its entry point (profile.js profileWG), all requested
       at once as a scene change requests them, timed from the first request until all are ready -- and then
       thrown away: nothing live changes. For the benchmark (tests.js, kind 'bench'), which calls it with the
       render loop paused and the GPU drained, and says so. { ms, slowest, readyAt, failed }.
       A kernel that FAILS is named, not timed: the first uncached run's guard broke lt_build, and because
       that kernel was sync its failure reached only the console while the table showed a time. Every kernel
       is async on profileWG's device, so a failure rejects its `ready`, caught here per kernel. */
    /* { sequential: true } builds the same kernels ONE AT A TIME, each awaited before the next, and adds `each`, what
       every kernel took alone, and `moduleMs`, what the march's text costs to parse and validate with no pipeline
       made of it -- the probe's near twin (builder/validate.js checks prelude + scene the same way since 0.9.5: a module, no pipeline). Two
       questions the parallel build cannot answer: whether compiling at once is faster than in turn at all (one
       at a time took 4.6 s in all on the Noise library, a real scene change 18-33 s: 2026-09-29, raytrace_main.js
       _profileCompile), and how much of a probe is the browser's backend rather than WGSL's checks. */
    R.compileUncached = async (scene, { sequential = false } = {}) => {
        const table = wavefrontKernels(profileWG(WG), scene);
        const t0 = performance.now(), readyAt = {}, failed = [], each = {}, made = {};
        const one = async ([name, , make]) => {
            const t1 = performance.now();
            try {
                const k = await make();
                await k.ready;
                readyAt[name] = Math.round(performance.now() - t0);
                each[name] = Math.round(performance.now() - t1);
                made[name] = k;
            } catch (e) {
                readyAt[name] = 'failed';
                failed.push(name);
                console.error(`[pathtracer] uncached compile: ${name} failed:`, e?.message ?? e);
            }
        };
        if (sequential) { for (const k of table) await one(k); }
        else await Promise.all(table.map(one));
        const ms = Math.round(performance.now() - t0);
        const top = o => Object.entries(o).filter(([, v]) => typeof v === 'number').sort((a, b) => b[1] - a[1])[0];
        const slowest = top(sequential ? each : readyAt);
        let moduleMs = null;
        if (sequential && made.march?.wgsl && WG.makeShader) {
            try {
                const t2 = performance.now();
                // a comment no cache has seen: the module is keyed by its text
                const m = WG.makeShader(`// uncached ${Math.random()}\n${made.march.wgsl}`);
                await m.getCompilationInfo?.();
                moduleMs = Math.round(performance.now() - t2);
            } catch { }
        }
        return { ms, slowest: slowest ? `${slowest[0]} ${slowest[1]}` : null, readyAt, failed,
                 ...(sequential ? { each, moduleMs } : {}) };
    };

    /* A SCENE'S KERNELS COMPILED WITHOUT SHOWING IT, into tinywebgpu's pipeline cache (keyed by their text), so that a
       setScene of it afterwards finds every one there and swaps in at once: the builder's bake in the background
       (builder/baker.js). The build's own kernels (the table above, with the kernel options as asked
       now) and the two a page asks of a scene shown -- the pick, and the tagged field the boxes are measured over --
       all async, so compiled off the thread that paints while the picture goes on; then let go: nothing live changes.
       Resolves to { ms, compiled, total } (compiled: how many were not in the cache already); throws what a compile
       threw. Whether a compile in the GPU process slows the frames drawn meanwhile is the card's to say (inferred: it
       may, a little; nothing here measures it). */
    R.precompile = async scene => {
        const t0 = performance.now();
        const made = await Promise.all([...wavefrontKernels(WG, scene).map(([, , make]) => make()), prog_pick(WG, scene), prog_tagfield(WG, scene)]);
        await Promise.all(made.map(k => k.ready));
        return { ms: Math.round(performance.now() - t0), compiled: made.filter(k => !k.cached).length, total: made.length };
    };

    /* HOW LONG `scene` WOULD TAKE TO COMPILE, UNCACHED -- WITHOUT COMPILING IT. The build's kernels (the table above)
       are made on a device that keeps their text and compiles nothing, the way check-shaders' spy does, and each is
       sized as the rate was fitted (compileprogress.js; bench/shaderstats.mjs: body and main in one text, the defines
       expanded). Then the build's prediction from this machine's learned rate: { expectMs, slowest }, or null when
       nothing could be sized. For the benchmark, which does not start a row whose compile would run for minutes: the
       scaling bench's lens assembly x 32 as codegen was still compiling after ten minutes (the user, 2026-10-03).
       A prediction, with the fit's error (compileprogress.js: rms 11%, worst 28% over 16 builds of 2-46 s, beyond them
       an extrapolation), never a measurement. */
    R.predictCompile = async scene => {
        const textOnly = { makeCompute: (body, main) => ({ wgsl: `${body}\nfn main() {\n${main}\n}`, cached: false }) };
        const table = wavefrontKernels(textOnly, scene);
        const made = await Promise.all(table.map(([, , make]) => make()));
        return predictCompile(made.map((k, i) => ({ name: table[i][0], cached: false, size: inlinedSize(k?.wgsl, WG.defines) })), readRate());
    };

    /* Every pipeline's bindings in one place. ensureBuffers calls it after reallocating and
       _buildWavefrontPipelines after rebuilding, so neither has to remember what the other
       owns -- which is what the three separate copies of this list used to be for, one of
       them a defensive "did we forget?" check that could only ever paper over the bug. */
    R.rebind = () => {
        const b1 = R.raybuffer1.b;
        R.prog_genrays2 && (R.prog_genrays2.resources = { rayBuffer0: R.raybuffer0.b });
        R.prog_genphotons && (R.prog_genphotons.resources = {
            rayBuffer0: R.raybuffer0.b, ltCDF: R.ltCDF.b, ltEmit: R.ltEmit.b, learn: R.learn.b });
        R.prog_lt_build && (R.prog_lt_build.resources = {
            ltEmit: R.ltEmit.b, learn: R.learn.b, ltCDF: R.ltCDF.b });
        R.prog_emit_collect && (R.prog_emit_collect.resources = { learn: R.learn.b });
        R.prog_emit_publish && (R.prog_emit_publish.resources = { learn: R.learn.b });
        /* THE CELLS, ONLY WHERE A KERNEL WAS BUILT WITH THEM (R.builtOptions): tinywebgpu refuses a name a pipeline does
           not declare, and off they declare none */
        const cells = on => on ? { stepCache: R.stepCacheBuf.b } : {};
        R.prog_render && (R.prog_render.resources = { accumulation_u32: R.accumulation_u32.b, aeState: R.aeState.b, ...cells(R.builtOptions.cacheView) });
        R.prog_ae_histogram && (R.prog_ae_histogram.resources = { accumulation_u32: R.accumulation_u32.b, aeHist: R.aeHist.b });
        if (!R.prog_wvfmarch) return;
        /* Whatever the scene created in its init() is bound to the three kernels that compile
           its WGSL. The renderer never looks inside these -- it only has to keep them attached
           when the buffers around them are reallocated. IN THE SAME OBJECT as the renderer's own:
           this was an Object.assign onto `resources`, which tinywebgpu has as a setter alone, so
           the first scene with buffers (the builder's scene as data, 0.10.2) threw here -- no
           scene had had any until then. And bound at once, not in a second call: a bind group is
           made from what the first call gives, and one without the scene's would be refused. */
        const sb = R.scene?.buffers || {};
        R.prog_wvfmarch.resources = {
            marchBuffer0: R.raybuffer0.b,
            marchBuffer1: b1,
            counters: R.counters.b,
            shadeBuffer: R.shadebuffer.b,
            ...cells(R.builtOptions.stepCache),
            ...sb,
        };
        R.prog_wvfsurface.resources = {
            shadeBuffer: R.shadebuffer.b,
            counters: R.counters.b,
            learn: R.learn.b,
            ...sb,
        };
        // no scene's buffers: shade holds no scene (0.20.8)
        R.prog_wvfshade.resources = {
            marchBuffer0: R.raybuffer0.b,
            marchBuffer1: b1,
            counters: R.counters.b,
            shadeBuffer: R.shadebuffer.b,
            frame_u32: R.frame_u32.b,
            shadowBuffer0: R.shadowBuffer0.b,
            shadowBuffer1: R.shadowBuffer1.b,
            learn: R.learn.b,
        };
        R.prog_stepcache_fill && (R.prog_stepcache_fill.resources = { stepCache: R.stepCacheBuf.b, ...sb });
        R.prog_wvfocclude.resources = {
            shadowBuffer0: R.shadowBuffer0.b,
            shadowBuffer1: R.shadowBuffer1.b,
            frame_u32: R.frame_u32.b,
            splat_u32: R.splat_u32.b,
            counters: R.counters.b,
            ...cells(R.builtOptions.stepCache),
            emitArgs: R.emitArgs.b,                // where it marks an emitter ray for the resolve (EMIT_PENDING)
            ...sb,
        };
        R.prog_prep_occlude.resources = { counters: R.counters.b, indirectOut: R.indirect_occlude.b, emitArgs: R.emitArgs.b };
        // the emitter rays' resolve (wavefront.js prog_occlude_emit)
        R.prog_occlude_emit && (R.prog_occlude_emit.resources = {
            shadowBuffer0: R.shadowBuffer0.b,
            shadowBuffer1: R.shadowBuffer1.b,
            frame_u32: R.frame_u32.b,
            counters: R.counters.b,
            ...sb,
        });
        // the photon map's kernel, once its buffers exist (sppmRoom, at its first trace)
        R.prog_sppm && R.sppmHeads && (R.prog_sppm.resources = {
            shadeBuffer: R.shadebuffer.b, counters: R.counters.b, learn: R.learn.b,
            sppmHeads: R.sppmHeads.b, sppmRecs: R.sppmRecs.b,
        });
        R.prog_wvfflip.resources = { counters: R.counters.b };
        R.prog_shadow_flip.resources = { counters: R.counters.b };
        R.prog_prep_march.resources = { counters: R.counters.b, indirectOut: R.indirect_march.b };
        R.prog_prep_shade.resources = { counters: R.counters.b, indirectOut: R.indirect_shade.b };
        R.prog_resolve.resources = {
            frame_u32: R.frame_u32.b,
            accumulation_u32: R.accumulation_u32.b,
            splat_u32: R.splat_u32.b,
            moments: R.moments.b,
        };
    };

    /* Mean luminance of the accumulated image, and how many pixels have any samples at all.
       LUMINANCE IN cd/m^2 since the units change -- Rec.709 Y, the units' own definition
       (core/photometry.js). It was (r+g+b)/3, which is not a luminance of anything: a pure-blue
       sky read three times brighter than its Y. Every statistic below is in those units, so the
       median is what a spot meter pointed at the middle of the distribution would say.

       The renderer had no image-level check of any kind, which makes a whole class of change
       unverifiable: the adaptive iteration budget (gone in 0.10.0) was safe only if it never truncated
       paths that the worst-case budget would have finished, and "the picture did not get darker" is the
       observable form of that. Path truncation shows up here before the eye catches it. */
    /* WHERE LIGHT TRACING MATTERS, as a mask -- pixels whose connection count (word 3 of the
       splat buffer, built up since the last clear) is at least `frac` of the 99th percentile.
       Not "any connection at all": that version measured each bench row over the pixels its
       own photons happened to reach, 9% of the image with a uniform map and 60% with a learned
       one, so a learned map was measured over a larger, dimmer, harder region and read NOISIER.
       A mask taken once and frozen puts every row -- lt off included -- on the same pixels. */
    R.ltMask = async (frac = 0.1) => {
        const np = Q.w * Q.h
        const sp = await R.splat_u32.r(np * 16, 0, Uint32Array)
        const counts = []
        for (let i = 0; i < np; i++) if (sp[i * 4 + 3]) counts.push(sp[i * 4 + 3])
        if (!counts.length) return { mask: new Uint8Array(np), reach: 0, w: Q.w, h: Q.h }
        counts.sort((x, y) => x - y)
        const cut = frac * counts[Math.floor(0.99 * (counts.length - 1))]
        const mask = new Uint8Array(np)
        let k = 0
        for (let i = 0; i < np; i++) if (sp[i * 4 + 3] >= cut && sp[i * 4 + 3] > 0) { mask[i] = 1; k++ }
        return { mask, reach: k / np, w: Q.w, h: Q.h }
    }

    /* `ltMask`: an optional mask from R.ltMask(); with one, ltNoise is the noise inside it. */
    R.imageStats = async (ltMask = null) => {
        /* SNAPSHOT THE SIZE BEFORE THE AWAIT. The readback is sized from Q.w*Q.h here and the
           loops below used to read Q.w/Q.h again afterwards -- so a resize landing in that
           window (a ResizeObserver fires on a splitter drag, which nothing here blocks) walked
           the loops past the end of the array and returned NaN, or read the new stride over
           the old pixels and returned a plausible number for a sheared image. */
        const w = Q.w, h = Q.h, np = w * h
        const a = await R.accumulation_u32.r(np * 16, 0, Uint32Array)
        const mo = R.moments ? await R.moments.r(np * 8, 0, Float32Array) : null
        // each pixel's own squared standard error, from the moments resolve keeps (measure.js)
        const se2 = i => { const e = mo ? standardError(mo[i * 2], mo[i * 2 + 1]) : null; return e == null ? null : e * e }
        // only a mask taken at this size means anything here
        const m = ltMask && ltMask.w === w && ltMask.h === h ? ltMask.mask : null
        const lit = i => m ? m[i] === 1 : false
        const f = new Float32Array(a.buffer, a.byteOffset, a.length)
        const lum = []
        for (let i = 0; i < np; i++) {
            if (a[i * 4 + 3] === 0) continue                 // never sampled
            lum.push(LUMA[0] * f[i * 4] + LUMA[1] * f[i * 4 + 1] + LUMA[2] * f[i * 4 + 2])
        }
        const n = lum.length
        if (!n) return { meanLuma: 0, trimmedLuma: 0, median: 0, covered: 0, pixels: np }
        const mean = lum.reduce((s, v) => s + v, 0) / n
        /* A plain mean is the wrong instrument for comparing two unbiased estimators at a
           low sample count: path tracing's distribution is heavy-tailed, so a handful of
           fireflies move it by percent even when both builds are converging to the same
           picture. Russian roulette makes this worse on purpose -- its 1/p compensation
           is exactly a rare-large-value mechanism. The trimmed mean drops the brightest
           0.1% of pixels, which is where the tail lives, and settles far sooner; a
           difference that survives trimming is a real difference. */
        const sorted = Float64Array.from(lum).sort()
        const keep = Math.max(1, Math.floor(n * 0.999))
        let t = 0
        for (let i = 0; i < keep; i++) t += sorted[i]

        /* A NOISE ESTIMATE, because for anything that changes the VARIANCE rather than the
           mean -- next-event estimation above all -- the mean is exactly the statistic that
           must not move, and on its own it cannot show the improvement at all.

           Measured as the mean absolute difference between horizontally adjacent pixels,
           relative to the mean. Monte Carlo noise is per-pixel independent, so it lives
           entirely in that high-frequency difference; real image detail contributes too,
           which is why this is only ever compared between two renders of the SAME scene at
           the SAME sample count. Halving it at equal samples is a 4x speedup in the only
           currency that matters, since variance falls as 1/samples. */
        let dsum = 0, dn = 0
        /* ...and the same inside the light-tracing mask (both pixels of the pair). The
           image-wide figure could not see the learned photon map at all: it made 70x more of
           the photons useful, and the caustic it improved covered too few pixels to move an
           average over the whole view. Relative to the MEAN OF THAT REGION, not the image. */
        let lsum = 0, ln = 0, lmean = 0, lpx = 0
        /* THE ERROR BAR, CHECKED against the picture itself. Two neighbouring pixels of a flat,
           evenly lit surface differ only by noise, so the mean of (La - Lb)^2 must equal the mean
           of (se_a^2 + se_b^2) that the pixels report: seRatio = sqrt of the one over the other
           should read 1. Only on such a picture -- real detail adds to the differences and
           reads above 1. Pixels with one sample have no error bar and are left out. */
        let d2 = 0, e2 = 0, sen = 0, seSum = 0
        for (let y = 0; y < h; y++) {
            const row = y * w
            for (let x = 0; x + 1 < w; x++) {
                const i = (row + x) * 4, j = (row + x + 1) * 4
                if (a[i + 3] === 0 || a[j + 3] === 0) continue
                const la = LUMA[0] * f[i] + LUMA[1] * f[i + 1] + LUMA[2] * f[i + 2]
                const lb = LUMA[0] * f[j] + LUMA[1] * f[j + 1] + LUMA[2] * f[j + 2]
                const ea = se2(row + x), eb = se2(row + x + 1)
                if (ea != null && eb != null) { d2 += (la - lb) ** 2; e2 += ea + eb; seSum += ea; sen++ }
                dsum += Math.abs(la - lb); dn++
                if (lit(row + x) && lit(row + x + 1)) { lsum += Math.abs(la - lb); ln++; lmean += la }
            }
        }
        if (m) for (let i = 0; i < np; i++) if (lit(i)) lpx++
        lmean = ln ? lmean / ln : 0
        return { meanLuma: mean, trimmedLuma: t / keep, median: sorted[n >> 1],
                 noise: dn && mean ? (dsum / dn) / mean : 0,
                 ltNoise: ln && lmean ? (lsum / ln) / lmean : null,
                 ltReach: lpx / np,
                 // the pixels' own error bars: their rms relative to the mean, and the check above
                 relSE: sen && mean ? Math.sqrt(seSum / sen) / mean : null,
                 seRatio: e2 > 0 ? Math.sqrt(d2 / e2) : null,
                 covered: n / np, pixels: np }
    }

    /* WHAT THE EMISSION MAP HAS LEARNED, for judging it rather than trusting it. A map that has
       found the glass gives its busiest 1% of cells far more than 1% of the photons; a map stuck
       at uniform gives them 1%. Neither changes the picture's mean -- only its noise. */
    R.ltStats = async () => {
        if (!R.ltCDF) return {}
        const cdf = await R.ltCDF.r((LT_CELLS + LT_GRID) * 4, 0, Float32Array)
        const hit = await R.learn.r(LT_CELLS * 4, 0, Uint32Array)
        const emit = await R.ltEmit.r(LT_CELLS * 4, 0, Uint32Array)
        const p = new Float64Array(LT_CELLS)
        for (let r = 0; r < LT_GRID; r++) {
            const rowP = cdf[LT_CELLS + r] - (r ? cdf[LT_CELLS + r - 1] : 0)
            for (let c = 0; c < LT_GRID; c++)
                p[r * LT_GRID + c] = rowP * (cdf[r * LT_GRID + c] - (c ? cdf[r * LT_GRID + c - 1] : 0))
        }
        const sorted = Float64Array.from(p).sort().reverse()
        let top = 0; for (let i = 0; i < LT_CELLS / 100; i++) top += sorted[i]
        let hits = 0, emitted = 0, useful = 0
        for (let i = 0; i < LT_CELLS; i++) { hits += hit[i]; emitted += emit[i]; if (hit[i]) useful++ }
        return {
            cells: LT_CELLS, emittedSinceRebuild: emitted, connectionsSinceRebuild: hits,
            connPerPhoton: emitted ? hits / emitted : 0,  // how many photons were worth sending
            usefulShare: useful / LT_CELLS,              // cells whose photons connected at all
            topCellShare: top,                           // photons the busiest 1% of cells get
            uniformWouldBe: 0.01,
        }
    }

    /* THE STEP CACHE'S BOX (wavefront.js stepCacheWGSL): `box` { lo, hi } in scene units -- the host's, from the boxes it
       measured (the builder: the solids' boxes, padded) -- or null for none, which leaves the cache inert whatever the
       setting says. Cut into about `cells` cubes (the setting stepCacheCells, in millions: R.stepCacheCellsOf), made
       empty. Returns the grid, or null. */
    R.STEP_CACHE_CELLS = 4e6;
    let stepCacheFilledFor = null, stepCacheScene = null;      // what the cells were filled for: R.stepCacheFor below
    /* the setting's cells: a quarter of a million to sixteen million (64 MiB), as the panel's slider allows */
    R.stepCacheCellsOf = u => Math.round(Math.min(16, Math.max(0.25, Number(u?.stepCacheCells) || R.STEP_CACHE_CELLS / 1e6)) * 1e6);
    /* A LOCAL FUNCTION, and R.setStepCacheBox a name for it: the facade bolts its own setStepCacheBox onto this object
       (lib/pathtracer/index.js, Object.assign(RT, api)), so R.setStepCacheBox called from here would be the facade's --
       which calls the engine's through RT and, captured too late, called itself until the stack ran out (0.23.0 and
       0.24.0 shipped that: the first box the page or the bench handed the renderer threw). R.stepCacheFor calls this. */
    const setStepCacheBox = (box, cells = R.STEP_CACHE_CELLS) => {
        const ok = box && [0, 1, 2].every(k => Number.isFinite(box.lo[k]) && Number.isFinite(box.hi[k]) && box.hi[k] > box.lo[k]);
        const size = ok ? [0, 1, 2].map(k => box.hi[k] - box.lo[k]) : null;
        const cs = ok ? Math.cbrt(size[0] * size[1] * size[2] / Math.max(1, cells)) : 0;
        const dims = ok ? size.map(s => Math.max(1, Math.ceil(s / cs))) : [0, 0, 0];
        R.stepCacheGrid = ok ? { lo: [...box.lo], cs, dims, cells, box: { lo: [...box.lo], hi: [...box.hi] } } : null;
        stepCacheRoom(true);                                        // made zero: every cell empty
        return R.stepCacheGrid;
    };
    R.setStepCacheBox = setStepCacheBox;
    /* THE CELLS' BUFFER: a word a cell while the kernels in place were built with the cache (R.builtOptions) and there is
       a box; one word otherwise, so the cache switched off holds no memory either (64 MiB at sixteen million cells).
       Made again -- zero, every cell empty -- when its size changes or `fresh` (a new box); bound again with it. */
    let stepCacheWords = 4;
    const stepCacheRoom = (fresh = false) => {
        const g = R.stepCacheGrid;
        const words = g && R.builtOptions.stepCache ? Math.max(4, g.dims[0] * g.dims[1] * g.dims[2]) : 4;
        if (!fresh && words === stepCacheWords && R.stepCacheBuf) return;      // own cell or cells ahead read the same cells
        R.stepCacheBuf?.b?.destroy?.();
        R.stepCacheBuf = WG.createStorageBuffer(4 * words);
        stepCacheWords = words;
        stepCacheFilledFor = null;                                  // filled for nothing yet
        if (R.raybuffer1) R.rebind();                               // before the first buffers, ensureBuffers binds it
    };
    /* WHAT THE CELLS WERE FILLED FOR, AND KEPT WHILE IT HOLDS (0.24.0; the user: "keep the cache across camera moves"). A
       cell holds a distance of the scene's shape, which a camera move does not change; until 0.24.0 every reset of the
       picture emptied the cells, so an orbit paid every fill again. Now a trace fills them again only when something
       else it is handed may have changed:
       - any uniform but the camera's (index.js buildUniforms: invView, invProjection, camPos, camLens, camtype) -- the scene's
         own values, codegen's culling boxes, and every setting too. More than the shape, but nothing is guessed about
         which uniforms a scene's distance reads, and none of those changes while the camera moves: the page's bag is
         rebuilt on an edit (index.js update), never a frame, and holds the camera's arrays by reference;
       - another scene;
       - the scene's data written (scene.dataRev: builder/scenedata.js attachData counts every write -- the facade's two
         paths, the builder's and the bench's all go through the scene's own writeData or init, so a count there sees
         every writer, where a count in one caller sees one).
       A scene with GPU state of its own (init) and no dataRev cannot say when that changes: its cells are filled again
       with every reset of the picture. And the cells are kept only while the setting is on, so one switched off and on
       again is filled afresh: what changed meanwhile was not looked at.
       The setting's cell count is read here as well: a different count cuts the box again (empty, a fill owed).
       FILLED BY A PASS (wavefront.js prog_stepcache_fill) that R.trace puts before its first sample. The setting
       stepCacheFill 2 fills them before every trace whatever changed: what a live drag pays at every frame, for the
       bench to time (Tests > stepcache). Pending until a trace has put the pass in its frame, so a trace that stops
       before that leaves the next one to fill them. (Until 0.41.0 the setting's 0 had the march fill a cell on a ray's
       first visit, and this emptied the cells instead: wavefront.js THE LAZY FILL WENT.) */
    /* the camera's, and stepCacheView, which only the display pass reads (rendertoscreen.js): switching on the
       view of the cells must not empty the cells it is there to show */
    const CAMERA_UNIFORMS = new Set(['invView', 'invProjection', 'camPos', 'camLens', 'camtype', 'stepCacheView']);
    R.stepCacheFills = 0;                                           // the fill passes put in a frame, counted for the tests
    R.stepCacheOwed = 0;                                            // ...and the times one was owed (R.stepCacheFor)
    let stepCacheFill = false;                                      // a fill pass owed
    R.stepCacheFor = (uniforms, reset) => {
        if (!R.stepCacheGrid) return;
        // by the kernels in place, not the setting: they fill the cells only when built with the cache
        if (!R.builtOptions.stepCache) { stepCacheFilledFor = null; stepCacheFill = false; return; }
        const cells = R.stepCacheCellsOf(uniforms);
        if (cells !== R.stepCacheGrid.cells) setStepCacheBox(R.stepCacheGrid.box, cells);
        const S = R.scene;
        const opaque = typeof S?.init === 'function' && S.dataRev === undefined;
        const key = JSON.stringify([S?.dataRev ?? 0, Object.entries(uniforms).filter(([k]) => !CAMERA_UNIFORMS.has(k))]);
        const everyTrace = (uniforms.stepCacheFill | 0) >= 2;
        if (key === stepCacheFilledFor && S === stepCacheScene && !(opaque && reset) && !everyTrace) return;
        stepCacheFilledFor = key; stepCacheScene = S;
        stepCacheFill = true;
        R.stepCacheOwed++;
    };
    /* THE FILL PASS, into the frame R.trace has open, before its first sample: SC_FILL_CHUNK cells a dispatch, each
       written its chunk's first cell (scDims.w) with the trace's whole bag at the first -- the scene's values, which the
       distance reads. Then the frame is submitted, so the fill is never in the same submission as a sample's passes
       (inferred to matter only for the 2 s a submission may take on Windows: sixteen million cells of a heavy scene are
       sixteen dispatches of a million evaluations). */
    const stepCacheFillPass = bag => {
        const g = R.stepCacheGrid, p = R.prog_stepcache_fill;
        if (!stepCacheFill || !g || !p || !R.builtOptions.stepCache) return false;
        stepCacheFill = false;
        const n = g.dims[0] * g.dims[1] * g.dims[2];
        for (let from = 0; from < n; from += SC_FILL_CHUNK) {
            const at = { scDims: [...g.dims, from] };
            p.uniforms = from === 0 ? { ...bag, ...at } : at;
            p.dispatch(Math.ceil(Math.min(SC_FILL_CHUNK, n - from) / SC_FILL_WG), 1, 1);
        }
        R.stepCacheFills++;
        return true;
    };
    /* ...its uniforms, in every trace's bag: no box is 0 cells, which the kernels read as off. IN METRES (`u`, metres per
       scene unit: the engine's unit since 0.36.0) -- the grid itself stays in the scene's, where its box came from, so a
       unit changed under it cannot leave it stale; the cells are filled again on that change anyway (R.stepCacheFor: any
       uniform but the camera's, sceneUnit among them). */
    R.stepCacheUniforms = (u = 1) => {
        const g = R.stepCacheGrid;
        return g ? { scLo: [...g.lo.map(x => x * u), g.cs * u], scDims: [...g.dims, 0] } : { scLo: [0, 0, 0, 0], scDims: [0, 0, 0, 0] };
    };

    /* THE KERNELS BUILT AGAIN FOR R.kernelOptions where they differ from those in place (R.builtOptions): the wavefront
       kernels for the cache, then the display pass for the view -- the scene the same and its state untouched (no init,
       no light map cleared, no sceneRev: a pick or a box measurement under way is still of this scene). Drained first,
       as setScene. A build that fails puts back the options in place, built again, marks the ones asked
       R.kernelOptionsRefused (so the facade does not ask again at every update) and throws, `restored`, as setScene
       does a scene. Resolves to whether anything was built. The caller holds the loop: index.js syncKernels. */
    R.kernelOptionsRefused = null;
    R.applyKernelOptions = async () => {
        const want = { ...R.kernelOptions }, had = { ...R.builtOptions };
        if (sameOptions(want, had)) return false;
        try { await WG.device.queue.onSubmittedWorkDone(); } catch { }
        // the scene's kernels' own option (the step cache): a build of them, the rest cached
        if (want.stepCache !== had.stepCache) {
            try { await R._buildWavefrontPipelines(); }
            catch (e) {
                R.kernelOptionsRefused = want;
                R.kernelOptions = had;
                try { await R._buildWavefrontPipelines(); e.restored = true; }
                catch (e2) { console.error('[pathtracer] the kernels before could not be built again either:', e2?.message ?? e2); }
                throw e;
            }
        }
        if (want.cacheView !== R.builtOptions.cacheView) {
            R.prog_render = await rendertoscreen_prog(WG, { cacheView: want.cacheView });
            R.builtOptions = { ...R.builtOptions, cacheView: want.cacheView };
            R.rebind();
        }
        /* THE PHOTON MAP'S KERNEL, alone: it holds no scene (wavefront.js prog_sppm), so nothing else is built again. Off,
           its handle goes and so does its memory. */
        if (!!want.sppm !== !!R.builtOptions.sppm) {
            if (want.sppm) { const p = await prog_sppm(WG, R.scene, R.wvf_wg); await p.ready; R.prog_sppm = p; }
            else { R.prog_sppm = null; sppmRoom(0); }
            R.builtOptions = { ...R.builtOptions, sppm: want.sppm ? 1 : 0 };
            R.rebind();
        }
        R.kernelOptionsRefused = null;
        return true;
    };

    R.clearAccums = async () => {
        R._slice = null;                   // a sample over frames: what it had put in the frame and splat buffers is cleared here
        try {
            R.accumulation_u32.clear();
            R.frame_u32.clear();
            R.splat_u32.clear();
        } catch { /* fallback if clear not supported on platform */ }
    };

    /* Swap the scene. Three kernels recompile, which is not free -- compile time here grows
       faster than linearly with inlining depth -- so this is a deliberate act, not something to
       do from a slider. Returns the milliseconds it took, because that number is worth seeing.
       `keepPicture`: a scene that draws the same picture as the one shown -- the builder's scene baked, its values
       constants (builder/baker.js) -- keeps the samples so far and the light map; any other starts both again. */
    R.setScene = async (s, { keepPicture = false } = {}) => {
        const t0 = performance.now();
        /* Drain first. The caller pauses the loop, but pausing only clears a flag the loop
           checks on entry -- frames already submitted are still referencing the pipelines
           about to be replaced. */
        try { await WG.device.queue.onSubmittedWorkDone(); } catch { }
        const before = R.scene;
        R.scene = s;
        R.sceneRev++;
        R.frameMs = null;                          // a new scene: nothing known about its frames (see NO SUBMIT...)
        R._pxMs = null;                            // ...nor what its sample costs (A SAMPLE OVER SEVERAL FRAMES)
        try {
            if (s.init) s.buffers = await s.init(WG);
            await R._buildWavefrontPipelines();
            /* THE SCENE BEFORE GIVES ITS BUFFERS BACK, once this one is built (not before: a failed build puts it back,
               below). A scene that is set again later makes them again in its init. */
            if (before && before !== s) before.dispose?.();
        } catch (e) {
            /* A SCENE THAT WILL NOT BUILD -- a kernel the driver refused -- PUTS THE ONE BEFORE IT BACK, built again
               (from the browser's cache, as a rule), and the failure is still thrown, marked `restored`. Left as it
               was, the renderer held a scene it could not draw: every kernel of it broken, nothing to trace with,
               until something else was asked of it -- and the builder's apply, whose probe compiles the SDF and the
               materials but not every kernel, could hand it exactly that (the user, 2026-10-02: a material that
               would not compile, and the program stuck). Nothing of the scene before was thrown away: its buffers
               are its own (s.init made the new scene's), and the caller's uniform state is still its. */
            if (before && before !== s) {
                R.scene = before;
                try { await R._buildWavefrontPipelines(); e.restored = true; }
                catch (e2) { console.error('[pathtracer] the scene before could not be built again either:', e2?.message ?? e2); }
            }
            throw e;
        }
        if (!keepPicture) {
            await R.clearAccums();
            R.clearLight();
            Q.resetframecount = 1;
        }
        return performance.now() - t0;
    };

    /* WHAT IS UNDER THE MOUSE: one ray, from `o` along `d` (world space, d of unit length), marched
       by core/pick.js. { hit, tag, distance, pos, normal }; the tag is the scene's (see pick.js).

       COMPILED ON FIRST USE, per scene. A pick kernel inlines the scene like the march does, so
       building it with the others would add its compile to every setScene for a feature most
       scene changes never use. It is built here instead, the first time a pick asks for this
       scene, and kept until the scene changes. A setScene while it compiles leaves it for the
       old scene: the check after the await throws it away rather than dispatching it with the
       new scene's uniforms, which it does not declare.

       NOT INSIDE A FRAME: trace() opens and closes its frame with no await between, so a pick
       started from an event handler always records and reads back on its own encoder. */
    /* WHICH SCENE, BY MORE THAN ITS OBJECT: one more for every scene set, and for every in-place change of a scene's data
       that renumbers its nodes (index.js updateSceneData: the builder's scene as data, an edit that compiles nothing).
       The object stays the same then, so `R.scene !== scene` no longer says whether a tag read back names what it did
       when the work began; the revision does. */
    R.sceneRev = 0;
    R.pick = async (uniforms, o, d) => {
        const scene = R.scene, rev = R.sceneRev
        if (R._pickScene !== scene) {
            R._pickScene = scene
            R._pickProg = prog_pick(WG, scene)
            R.pickIn ??= WG.createStorageBuffer(32)
            R.pickOut ??= WG.createStorageBuffer(PICK_WORDS * 4)
        }
        const prog = await R._pickProg
        await prog.ready
        if (R.scene !== scene || R.sceneRev !== rev) return null      // the scene changed while it compiled
        prog.resources = { pickIn: R.pickIn.b, pickOut: R.pickOut.b, ...(scene.buffers || {}) }
        prog.uniforms = { res: [Q.w, Q.h], ...uniforms }
        R.pickIn.w(new Float32Array([o[0], o[1], o[2], 0, d[0], d[1], d[2], 0]))
        prog.dispatch(1, 1, 1)
        const out = readPick(await R.pickOut.r(PICK_WORDS * 4, 0, Uint32Array))
        return R.sceneRev === rev ? out : null            // ...or its nodes were renumbered while it ran
    };

    /* THE FIELD AT MANY POINTS, for an export to a mesh (core/field.js): `input` is fieldInput()'s
       header (and point list), `outFloats` how many f32 to read back. Resolves to a Float32Array,
       or null if the scene changed while the kernel compiled. Compiled on first use and kept per
       scene, exactly as the pick is, for the same reasons; its buffers grow to the largest request
       and stay. Not inside a frame: each call is its own submit and readback. */
    R.field = async (uniforms, input, outFloats) => {
        const scene = R.scene
        if (R._fieldScene !== scene) {
            R._fieldScene = scene
            R._fieldProg = prog_field(WG, scene)
        }
        const grow = (buf, bytes) => {
            if (buf && buf.b.size >= bytes) return buf
            buf?.b.destroy()
            return WG.createStorageBuffer(Math.max(bytes, 256))
        }
        R.fieldIn = grow(R.fieldIn, input.byteLength)
        R.fieldOut = grow(R.fieldOut, outFloats * 4)
        const prog = await R._fieldProg
        await prog.ready
        if (R.scene !== scene) return null                // the scene changed while it compiled
        prog.resources = { fieldIn: R.fieldIn.b, fieldOut: R.fieldOut.b, ...(scene.buffers || {}) }
        prog.uniforms = { res: [Q.w, Q.h], ...uniforms }
        R.fieldIn.w(input)
        prog.run(new Uint32Array(input.buffer, input.byteOffset, 4)[3], 1, 1)
        return await R.fieldOut.r(outFloats * 4, 0, Float32Array)
    };
    /* WHICH TAGGED SURFACE IS NEAREST, over a grid (core/field.js prog_tagfield): the builder's bounds.
       Its own program and buffers, compiled on first use per scene like the field's; TAG_FIELD_WORDS f32
       out per point (distance, then tag, copy and arrays as bits). Null when the scene changed while it compiled. */
    R.tagField = async (uniforms, input) => {
        const scene = R.scene, rev = R.sceneRev
        if (R._tagScene !== scene) {
            R._tagScene = scene
            R._tagProg = prog_tagfield(WG, scene)
        }
        const count = new Uint32Array(input.buffer, input.byteOffset, 4)[3]
        const grow = (buf, bytes) => {
            if (buf && buf.b.size >= bytes) return buf
            buf?.b.destroy()
            return WG.createStorageBuffer(Math.max(bytes, 256))
        }
        R.tagIn = grow(R.tagIn, input.byteLength)
        R.tagOut = grow(R.tagOut, count * 4 * TAG_FIELD_WORDS)
        const prog = await R._tagProg
        await prog.ready
        if (R.scene !== scene || R.sceneRev !== rev) return null
        prog.resources = { fieldIn: R.tagIn.b, fieldOut: R.tagOut.b, ...(scene.buffers || {}) }
        prog.uniforms = { res: [Q.w, Q.h], ...uniforms }
        R.tagIn.w(input)
        prog.run(count, 1, 1)
        const out = await R.tagOut.r(count * 4 * TAG_FIELD_WORDS, 0, Float32Array)
        return R.sceneRev === rev ? out : null            // tags: the ones the scene had when it began
    };

    R.init = async () => {
        R.ensureBuffers(Q.w, Q.h);               // allocate before anything is bound to them
        R.ensureShadow(false);                     // placeholder bindings; grown when NEE runs
        R.prog_render = await rendertoscreen_prog(WG, { cacheView: R.kernelOptions.cacheView })
        R.builtOptions = { ...R.builtOptions, cacheView: R.kernelOptions.cacheView }
        R.prog_skynorm = await prog_skynorm(WG)
        R.prog_skynorm.resources = { skyOut: R.skyOut.b }
        R.prog_ae_histogram = await prog_ae_histogram(WG)
        R.prog_ae_update = await prog_ae_update(WG)
        R.prog_ae_update.resources = { aeHist: R.aeHist.b, aeState: R.aeState.b }
        R.rebind()                                 // the display and the histogram read the picture
        /* THE MATERIAL TABLES, once: the coat's albedo and a white metal's, integrated on the GPU
           from the same GGX the shade kernel evaluates (microfacet.js). Two one-shot submits, in
           order -- the averages read the first table -- and done before any trace can shade. */
        const lut = await prog_mf_lut(WG), lutAvg = await prog_mf_lut_avg(WG)
        lut.resources = { learn: R.learn.b }
        lutAvg.resources = { learn: R.learn.b }
        lut.run(MF_LUT_ENTRIES, 1, 1)
        lutAvg.run(MF_AVG_ENTRIES, 1, 1)
        /* THE FIRST SCENE'S OWN GPU STATE, as setScene makes a later one's: R.init never called it, and no scene had
           an init() until the builder's scene as data -- whose kernels then had no buffer to bind on a page that
           opened on one */
        if (R.scene?.init) R.scene.buffers = await R.scene.init(WG);
        await R._buildWavefrontPipelines();
    }

    //======================================================================================================================================
    /*
                                                                             
            888888888888  88888888ba          db         ,ad8888ba,   88888888888     
                88       88      "8b        d88b       d8"'    `"8b  88              
                88       88      ,8P       d8'`8b     d8'            88              
                88       88aaaaaa8P'      d8'  `8b    88             88aaaaa         
                88       88""""88'       d8YaaaaY8b   88             88"""""         
                88       88    `8b      d8""""""""8b  Y8,            88              
                88       88     `8b    d8'        `8b  Y8a.    .a8P  88              
                88       88      `8b  d8'          `8b  `"Y8888Y"'   88888888888     
                                                                                    
                                                                                                                                                                                 
    */
    //============================================================================================================================

    /*==================================================================================
      THE SKY'S SCALE, measured before any frame that needs it.

      UB.skyScale turns the scattering model into a sky that delivers UB.skyIlluminance lux
      (see prog_skynorm in wavefront.js), and the raw model changes whenever a field it reads
      changes. So every trace -- live, offscreen or bench -- calls this first, and it only does
      anything when that happens: a readback of four bytes, awaited BEFORE beginFrame, so no
      sample is ever traced with the scale of a different sky. That is the property a save
      needs: re-measuring after the fact and restarting the EMA would leave the stale sample in
      a picture that is never cleared.

      Keyed on the fields skyRadianceRaw reads. sdf.js names them at the function; a field read
      there and missing here is a sky that changes without being re-measured.

      Returns the uniforms with skyScale filled in. photometry.derive() leaves it at 0 because
      the host building the bag cannot know it; this is the one place that can.
    ==================================================================================*/
    R.skyOut = WG.createStorageBuffer(4)
    /* AUTO-EXPOSURE's two buffers (core/autoexposure.js): the histogram the meter fills and
       empties each frame, and the metered EV the display reads. Zero-filled, which is exactly
       "nothing metered yet" -- the display falls back to the manual EV until the first frame. */
    R.aeHist = WG.createStorageBuffer(AE_HIST_BYTES)
    R.aeState = WG.createStorageBuffer(AE_STATE_BYTES)
    R.autoEV = null
    let aeReading = false
    /* THE METER STARTED AGAIN (0.66.0): another scene shown is another picture to meter, and the meter EASES (aeSpeed a
       frame), so a dim room shown after a sunlit street faded up from the street's EV over a second or two. Zeroed, the
       update kernel takes the first frame's reading at once, as at the start (core/autoexposure.js). The builder asks
       for it when the scene shown changes (RT.applyView fresh); a compile of the same scene keeps the meter easing. */
    R.resetMeter = () => {
        try { R.aeState.clear() } catch (e) { console.warn('[pathtracer] meter not reset', e?.message ?? e) }
        R.autoEV = null; R.hud.autoEV = null
    }
    /* Meter the picture for the display, inside the frame, after resolve and before the draw.
       Only when auto-exposure is on: off, the display ignores aeState and the pass is waste. */
    const meterForDisplay = (uniforms) => {
        if (!(uniforms.autoExposure | 0) || !R.prog_ae_histogram) return
        R.prog_ae_histogram.uniforms = { res: [Q.w, Q.h] }
        R.prog_ae_histogram.run(Q.w, Q.h, 1)
        R.prog_ae_update.uniforms = { aeSpeed: +uniforms.aeSpeed || 0.1,
            // 0 is a real setting here (no stop above white), so no || default
            aeHeadroom: Number.isFinite(+uniforms.aeHeadroom) ? +uniforms.aeHeadroom : 2 }
        R.prog_ae_update.run(1, 1, 1)
    }
    /* ...and read the metered EV back for the HUD only, never awaited, one in flight: the
       display already has it on the GPU. */
    const readAutoEV = (uniforms) => {
        if (!(uniforms.autoExposure | 0) || aeReading) return
        aeReading = true
        R.aeState.r(8, 0, Float32Array)
            .then(a => { R.autoEV = a[1] ? a[0] : null; R.hud.autoEV = R.autoEV })
            .catch(() => { })
            .finally(() => { aeReading = false })
    }
    /* WHAT ONE PIXEL MEASURES: its mean luminance in cd/m^2 and the standard error of that mean,
       from the accumulation and the moments resolve keeps beside it (core/measure.js). px, py in
       accumulation pixels -- row 0 is the BOTTOM of the picture, as the display pass draws it
       (tinywebgpu's uv is 0 at the bottom). null for a pixel outside the picture or never
       sampled. Two 16- and 8-byte reads: cheap enough to run every frame the cursor is still. */
    R.readPixel = async (px, py) => {
        const w = Q.w, h = Q.h
        if (!R.moments || !(px >= 0 && py >= 0 && px < w && py < h)) return null
        const i = (px | 0) + (py | 0) * w
        const [a, m] = await Promise.all([R.accumulation_u32.r(16, i * 16, Uint32Array),
                                          R.moments.r(8, i * 8, Float32Array)])
        if (Q.w !== w || Q.h !== h) return null            // resized while reading: another pixel now
        const f = new Float32Array(a.buffer, a.byteOffset, 4)
        const r = reading([f[0], f[1], f[2]], a[3], m[0], m[1])
        return r && { ...r, px: px | 0, py: py | 0 }
    }
    /* WHAT A RECTANGLE MEASURES (core/measure.js regionReading): columns x0..x1 and rows y0..y1,
       inclusive, in accumulation pixels (row 0 at the bottom, as readPixel). The rows are read
       whole -- one contiguous read of each buffer rather than one per row, since a readback's
       cost is the round trip, not the bytes -- and the columns picked out here. */
    R.readRegion = async (x0, y0, x1, y1) => {
        const w = Q.w, h = Q.h
        if (!R.moments) return null
        x0 = Math.max(0, Math.min(x0, x1) | 0); x1 = Math.min(w - 1, Math.max(x0, x1) | 0)
        y0 = Math.max(0, Math.min(y0, y1) | 0); y1 = Math.min(h - 1, Math.max(y0, y1) | 0)
        if (x0 > x1 || y0 > y1) return null
        const rows = y1 - y0 + 1
        const [a, m] = await Promise.all([R.accumulation_u32.r(rows * w * 16, y0 * w * 16, Uint32Array),
                                          R.moments.r(rows * w * 8, y0 * w * 8, Float32Array)])
        if (Q.w !== w || Q.h !== h) return null            // resized while reading
        const r = regionReading(a, m, w, x0, x1, rows)
        return r && { ...r, x0, y0, x1, y1 }
    }
    /* THE CURSOR READOUT for the HUD: the host sets R.probeAt ([px, py], or null to stop), and
       every frame -- and every cursor move, so it works with the loop paused -- reads it again,
       one read in flight. A read that comes back for a position the cursor has since left is
       dropped, and the new position read at once. */
    R.probeAt = null
    // drawn over the picture after the display pass, every frame -- see the render step
    R.overlays = []
    /* PHOTONS FROM OTHER MODULES, traced with the renderer's own every sample (the optics source
       lighting the picture). Each is { perPixel(): photons per pixel wanted, ready(): its kernel
       compiled, generate({buffer, offset, count, uniforms}): write `count` photons into `buffer`
       from `offset`, inside the frame }. They get what the camera rays and the renderer's own
       photons leave, and connect to the camera through the occlusion pass like light tracing's. */
    R.photonSources = []
    R.extraPhotons = 0
    let probeReading = false
    R.readProbe = () => {
        const at = R.probeAt
        if (!at) { R.hud.probe = R.probe = null; return }
        if (probeReading) return
        probeReading = true
        R.readPixel(at[0], at[1])
            .then(r => {
                if (R.probeAt !== at) return
                R.hud.probe = R.probe = r
                R.hud.refresh?.()
            })
            .catch(() => { })
            .finally(() => {
                probeReading = false
                if (R.probeAt && R.probeAt !== at) R.readProbe()
            })
    }
    R.skyRaw = 0
    let skyKey = '', skyPending = null, skyPendingKey = ''
    R.ensureSky = async (uniforms) => {
        const sky = { uSunElevation: uniforms.uSunElevation, uSunAzimuth: uniforms.uSunAzimuth,
                      uSkyTurbidity: uniforms.uSkyTurbidity }
        const key = Object.values(sky).join()
        if (key !== skyKey && R.prog_skynorm) {
            /* SHARED, not repeated: the render loop keeps two frames in flight, so a second trace
               can arrive while the first is still waiting on this readback. Both wait on the one
               measurement rather than dispatching two. Only the sky's own fields are written --
               the bag also carries the scene's uniforms, which this kernel does not declare. */
            if (!skyPending || skyPendingKey !== key) {
                skyPendingKey = key
                skyPending = (async () => {
                    R.prog_skynorm.uniforms = sky
                    R.prog_skynorm.dispatch(1, 1, 1)
                    const a = await R.skyOut.r(4, 0, Float32Array)
                    R.skyRaw = a[0]
                    skyKey = key
                })().finally(() => { if (skyPendingKey === key) skyPending = null })
            }
            await skyPending
        }
        return { ...uniforms, skyScale: R.skyRaw > 0 ? (uniforms.skyIlluminance || 0) / R.skyRaw : 0,
                 fireflyWhite: displayWhite(uniforms) }
    }
    /* THE FIREFLY CLAMP'S UNIT, the luminance the display maps to 1.0 -- what rendertoscreen.js
       computes from aeState, from the copy the HUD reads back (a frame or two late; the meter
       eases, so that is nothing). Here because every trace path passes through ensureSky. Not
       metered yet, or auto off: the manual exposure's, as derive() already put in the bag. */
    const displayWhite = (uniforms) =>
        (uniforms.autoExposure | 0) && Number.isFinite(R.autoEV)
            ? EV_CLIP * Math.pow(2, R.autoEV - (+uniforms.exposureComp || 0))
            : uniforms.fireflyWhite

    /* THE PHOTONS A SAMPLE WANTS, a pixel: light tracing's and every other source's. Its own function since 0.38.1 so the
       save's size note (index.js sizeVerdict) asks what R.trace will, rather than a copy of the rule. */
    const photonWants = (uniforms) => {
        // the DERIVED luminance, not the setting: it is also 0 with the sun below the horizon
        const sunOn = (+uniforms.sunL || 0) > 0;
        /* NOTHING TO SEND PHOTONS FROM: no sun (the studio light, night, lamps only) and no emitter
           found yet. Every photon would be a sun photon carrying sunL = 0 -- ray buffer, a march and
           a connection each, for nothing (below: with no emitter listed, emitShareLT is 0). Off until
           a camera path finds an emitter; R.emitCount is read back a frame late, which costs a frame
           of photons, never light. */
        const ltWant = (uniforms.lt | 0) !== 0 && (sunOn || R.emitCount > 0) ? Math.max(0, +uniforms.ltPhotons || 0) : 0;
        /* OTHER MODULES' PHOTONS (R.photonSources -- the optics source lighting the picture):
           per pixel, like ltPhotons, and sized into the same buffers after them. NONE IN SKETCH, whose
           light is a fixed one (quality.js effective): no light of the scene's is traced there, and
           these would add the optics source's on top of it. Draft keeps them -- they are how that
           source's light reaches the picture at all -- and so does Optics (renderMode 3), whose
           picture they are: the lights' rays over Sketch's flat light (materials_pbr.js FAST MODES). */
        const sketch = (uniforms.renderMode | 0) === 2;
        /* ...AND NONE WITH THE LIGHTS' RAYS SWITCHED OFF (lightRays, the Renderer panel's Light sources): the same
           as Sketch here, without its flat light -- ltLights is then 0 and the camera's paths count the faces */
        const raysOff = ((uniforms.lightRays ?? 1) | 0) === 0;
        const perPixel = src => sketch || raysOff ? 0 : Math.max(0, +src.perPixel() || 0);
        const extraWant = R.photonSources.reduce((a, s) => a + perPixel(s), 0);
        return { sunOn, sketch, raysOff, ltWant, perPixel, extraWant };
    };
    R.photonsPerPixel = (uniforms) => { const w = photonWants(uniforms); return w.ltWant + w.extraWant; };

    /* `frames` is NOT the number of samples in the picture: it is the EMA window handed to
       resolve, restarts at 2 and is clamped to maxaverages. `samples` is the plain count of
       samples folded in since the last reset, for the HUD -- "is it still converging" cannot
       be judged without knowing how many samples a picture is. */
    let warned = '', frames = 0, samples = 0;
    /* `target` is an optional render target for the PRESENT step -- a GPUTexture or view to
       draw the tone-mapped picture into instead of the swapchain. Left undefined (every live
       frame) the behaviour is exactly what it was: drawTo() resolves to the canvas.
       It is the whole offscreen path: a save at 4096x4096 is this argument plus a texture,
       because nothing else in here knows or cares what it is drawing onto. */
    /* `slice`: the live loop's frames only (index.js LOOP) -- a sample may take several calls (A SAMPLE OVER SEVERAL
       FRAMES, below), and R.sampled says how much of one this call did. Every other caller (step, a save, the bench, a
       redraw) traces whole samples as before, and drops a sample left half done. */
    R.trace = async (Q, uniforms, count = 1, target = undefined, { slice = false } = {}) => {
        /* NOTHING TO TRACE WITH, NOTHING BEGUN: refused while a build is in progress or before one has
           succeeded (R._building / R._built above), before any frame or pass is opened -- so the refusal
           leaves no encoder behind, which the throw from inside a dispatch did. The host's redraw waits
           for the build instead of arriving here (index.js present()); this is for every other caller. */
        if (R._building || !R._built)
            throw new Error(`[pathtracer] trace while the scene's pipelines are being built (or never were): wait for init/setScene`);
        /* THE RESET IS READ BEFORE THE FIRST AWAIT, and has to be: the host clears
           Q.resetframecount right after calling this (traceOnce in index.js), trusting that it
           was read synchronously. ensureSky awaits, so the flag is captured first and only the
           capture is read below. */
        const reset = Q.resetframecount == 1;
        /* THE STEP CACHE, EMPTIED WHEN WHAT IT WAS FILLED FOR CHANGED (R.stepCacheFor): not by a camera move. Cleared
           before this trace's frame, in queue order; a step ahead of the clear never runs. Before RECORDING TIME below,
           so its key is not timed as recording. */
        R.stepCacheFor(uniforms, reset);
        uniforms = await R.ensureSky(uniforms);   // before beginFrame -- see THE SKY'S SCALE
        /* RECORDING TIME, from here (nothing below awaits) to the last endFrame: the JS that sets every
           uniform and records every dispatch, plus the submits, which hand the work over without waiting
           for it. R.recordMs is the last trace's. Measured because the benchmark's first timed run (the
           user's Pascal, 2026-10-02) put a sample's wall clock 21 to 58 ms above its GPU time with the
           gaps between passes under 0.2 ms: this says how much of that is the CPU recording. */
        const tRecord = performance.now();

        /* ONE CAMERA RAY PER PIXEL PER SAMPLE -- there is no spp setting any more (see the note
           where the Test group was, uniforms.schema.js). Grow the buffers to fit, up to
           R.maxRays; photons ride after the camera rays. */
        const { sunOn, sketch, raysOff, ltWant, perPixel, extraWant } = photonWants(uniforms);
        R.ensureBuffers(Q.w, Q.h, ltWant + extraWant);
        /* THE PHOTON MAP THIS TRACE (core/sppm.js): its kernel built (the setting, R.kernelOptions), a mode it runs in, a
           perspective camera, not the illuminance view. Then its buffers at the capacity asked, before the frame opens.
           Whether it runs is decided below, once the photons are known (NOT IDLE). */
        const sppmWant = !!R.prog_sppm && (uniforms.sppm | 0) !== 0 && SPPM_MODES.has(uniforms.renderMode | 0)
                         && (uniforms.camtype | 0) === 0 && (uniforms.measureMode | 0) !== 1
                         && sppmRoom(sppmCapacityFor(uniforms.sppmCapacity, Q.w * Q.h), +uniforms.sppmCapacity) > 0;
        /* EVERY PIXEL ITS CAMERA RAY AND EVERY SOURCE ALL IT ASKED, AT ANY SIZE (0.38.1): what does not fit the buffer in
           one go runs in batches (core/photons.js planBatches, which says why). Until then the camera rays came first
           and the photons shared what they left: at the ray cap (about 2.3 Mpx) light tracing got none and switched
           itself off, and a large save lost the light through its glass. Each photon is still divided by its source's
           count for the WHOLE sample, so the batches add up to the one estimate a single fill would have made.
           A source not ready (its kernel compiling) sends none. R.photonPlan says what was asked and sent, in how
           many batches, and why a source adds none, for the HUD and RT.lightReport(). */
        const px = Q.w * Q.h;
        const ltAsk = ltWant > 0 ? Math.round(ltWant * px) : 0;
        const asks = R.photonSources.map(src => {
            const ask = Math.round(perPixel(src) * px);
            return { src, ask, ready: ask > 0 ? !!src.ready() : true };
        });
        R.raycount = px;
        R.photoncount = ltAsk;
        const ltOn = R.photoncount > 0;
        const extra = asks.map(e => ({ src: e.src, n: e.ready ? e.ask : 0 })).filter(e => e.n > 0);
        R.extraPhotons = extra.reduce((a, e) => a + e.n, 0);
        // anything that connects to the camera needs the occlusion pass and its queue
        const connects = ltOn || R.extraPhotons > 0;
        /* SUN AND EMITTERS SHARE THE PHOTONS: emitPhotons of them are emitter probes (the first of each batch), the
           rest sun. Probes only once something has been discovered (emitCount, read back a
           frame late -- a stale count costs a frame of wasted probes, never correctness: the
           camera side hands over only emitter hits the GPU's own list covers). Each side hands
           its caustic paths over only if it actually has photons this frame. */
        const emitShareLT = R.emitCount > 0 ? (sunOn ? Math.min(0.95, Math.max(0.05, +uniforms.ltEmitShare || 0.5)) : 1) : 0;
        R.emitPhotons = ltOn ? Math.round(R.photoncount * emitShareLT) : 0;
        const sunPhotons = R.photoncount - R.emitPhotons;
        /* THE BATCHES: the streams in this order -- camera rays, emitter probes, sun photons, each source's photons --
           and the fewest batches whose largest fits the buffer. One, as before, whenever everything fits. */
        const streams = [R.raycount, R.emitPhotons, sunPhotons, ...extra.map(e => e.n)];
        /* THE PHOTON MAP, NOT IDLE (0.61.0, when it went on by default): it runs only where it can add something. With no
           photons (the caustics and the lights' rays off, or none ready) it has nothing to gather and owns nothing (the
           camera hands a source's part over only while that source's photons run: materials_pbr.js lensOwned's callers).
           And a view in which no camera ray looks through glass or a mirror at a surface it could gather on -- most
           scenes, with no glass at all -- would pay its second wavefront chain a sample for nothing: prog_sppm marks the
           map's header when a camera ray gathers (sppm.js SPPM_LOOKED), the readback below brings it home, and a whole
           sample that marked nothing makes the map IDLE. Idle, the traces run without it -- one chain, the camera keeping
           the class, exact as with the setting off -- and every SPPM_PROBE-th trace runs it once to look again. A camera
           move does not wake it: a drag in a scene without glass would pay the map every frame of the drag; glass coming
           into view is found by the next probe, the picture exact (and noisier) until then. A new size, mode or scene
           (sceneRev) starts it again at once. A sample pending over frames keeps the choice it began with, or its
           photons and its camera rays would be counted by different owners. Exact in every mode: in Draft and Optics a
           camera ray reaches a surface through glass or not by the view alone (their paths stop where they gather). */
        const sppmKey = sppmWant ? `${Q.w}x${Q.h}|${uniforms.renderMode | 0}|${R.sceneRev}` : null;
        if (sppmKey !== R._sppmKey) { R._sppmKey = sppmKey; R._sppmIdle = null; R._sppmGen = (R._sppmGen | 0) + 1; R._sppmDemand = null; }
        const sppmPhotons = streams.slice(1).some(n => n > 0);
        let sppmRuns = sppmWant && sppmPhotons;
        /* ...AND HOW MANY OF ITS STORES IT KEEPS (0.61.2; core/sppm.js NEITHER FULL NOR CUT): all while a sample fits the
           capacity, else each with probability keep and its power over keep -- exact in expectation, where a store past the
           capacity was dropped and the picture through glass read dark (a third of them at 1920 x 1080 on the dichroics
           bench, the user's card, 2026-10-16). What a sample asks is the sample before's (R._sppmDemand, read back below),
           and before any, twice its photons (a photon of a light no camera path can meet is stored at every surface it
           lands on: 1.44 times a photon on that bench). Chosen once a sample, before it starts, so its every store is
           kept alike; a sample asking more than the one before can still overfill it, and is counted (overflow). */
        R.sppmRan = sppmRuns;              // whether this trace ran the map: R.sppmStats is the last sample's that did
        const sppmKeepNow = sppmRuns ? sppmKeep(sppmCap, R._sppmDemand ?? 2 * streams.slice(1).reduce((a, b) => a + b, 0)) : 1;
        if (sppmRuns && typeof R._slice?.map === 'boolean') sppmRuns = R._slice.map;
        else if (sppmRuns && R._sppmIdle) {
            if (R._sppmIdle.left > 0) { R._sppmIdle.left--; sppmRuns = false; }
            else R._sppmIdle.left = SPPM_PROBE - 1;       // a probe, every SPPM_PROBE-th: its reading keeps the map idle or wakes it
        }
        /* ...THE PHOTONS FIRST while the photon map runs (core/sppm.js, WHY PHOTONS FIRST): every one of the sample's
           photons has landed before its first camera ray gathers */
        const order = sppmRuns ? { first: streams.map((_, s) => s).slice(1) } : {};
        const planned = planBatches(R.raybufferSize, streams, 1, order);
        /* A SAMPLE OVER SEVERAL FRAMES (0.58.0; the user, 2026-10-10: "when renders take very long the whole UI becomes
           unresponsive"). A frame was at least one whole sample (render-loop.js's floor of one), and its submissions,
           cut against the device-hung watchdog (NO SUBMIT LONG ENOUGH, below), all went in one task: a 500 ms sample was
           500 ms of GPU in one burst, and the browser's own drawing waited behind it (inferred: the page froze, the user's
           report; PERFORMANCE.md P5, 2026-09-29, the Noise library). So in the live loop a sample slower than sliceMs is
           cut into K batches -- the batches the buffer already forces past its cap (planBatches), more of them -- and a
           frame runs one or a few, enough for about sliceMs; the sample stays PENDING in R._slice between frames, and the
           frame that runs its last batch resolves it. The batches are the same estimate whether they run in one frame or
           in K (each its share of every stream, each photon divided by the whole sample's count); in between, every frame
           still presents the picture as it last was. Off (0) or any other caller: whole samples, exactly as before.
           WHAT DROPS A PENDING SAMPLE: anything that makes its part done mean something else -- another size or photon
           plan or scene (the key), the buffers reallocated or cleared (ensureBuffers, releaseBuffers, clearAccums set
           R._slice null), or a trace that is not a slice. Dropped, the frame and splat buffers are cleared here, or that
           part would be added to the next sample's: resolve is what empties them.
           NOT A RESET: a camera move or an edit while a sample is pending goes on with it under the new uniforms (below,
           where the reset is read), and the sample, part old view and part new, REPLACES the picture when it ends; the
           sample after starts the average again. Dropping it instead would show nothing at all for as long as a drag
           lasted, since every frame of a drag resets. */
        const starved = slice && !!R._sliceStarved;              // NEVER FINISHING, below: this one whole, then slices again
        if (starved) R._sliceStarved = false;
        const sliceMs = slice && target === undefined && !starved ? Math.max(0, +uniforms.sliceMs || 0) : 0;
        const sliceKey = `${Q.w}x${Q.h}|${streams.join(',')}|${R.sceneRev}|${sppmRuns ? 'map' : ''}`;
        let pending = R._slice || null;
        if (pending && (!sliceMs || pending.key !== sliceKey)) {
            try { R.frame_u32.clear(); R.splat_u32.clear(); } catch { /* as clearAccums */ }
            /* NEVER FINISHING: a key that moves every frame would drop every sample before its end and the picture would
               never change. Three drops in a row and the next sample runs whole; a sample that ends clears the count. */
            if (sliceMs) R._sliceDrops = (R._sliceDrops | 0) + 1;
            if ((R._sliceDrops | 0) >= 3) { R._sliceStarved = true; R._sliceDrops = 0; }
            R._slice = pending = null;
        }
        const sampleMs = R._pxMs != null ? R._pxMs * px : null;    // the last timed sample's cost at this size
        let K = planned.batches;
        if (pending) K = pending.K;
        else if (sliceMs) {
            const want = sampleMs == null ? SLICE_UNTIMED : Math.ceil(sampleMs / sliceMs);
            K = Math.max(K, Math.min(want, SLICE_MAX, Math.ceil(planned.total / Math.max(1, R.sliceMinRays ?? SLICE_MIN_RAYS))));
        }
        const batching = K > planned.batches ? planBatches(R.raybufferSize, streams, K, order) : planned;
        const batches = batching.batches;
        /* HOW MUCH OF IT THIS FRAME: batches for about sliceMs (one at least) of a sample over frames; and of a sample that
           fits in sliceMs, no more samples than fit -- the governor's count (render-loop.js) climbs on a fast loop and
           was never reset, so a light scene's 64 a frame were once handed to the heavy scene opened next. */
        const sliced = sliceMs > 0 && batches > 1 && !!(pending || sampleMs == null || sampleMs > sliceMs);
        const perCall = !sliced ? batches : sampleMs == null ? 1 : Math.max(1, Math.floor(sliceMs / (sampleMs / batches)));
        if (sliceMs > 0) count = sliced || sampleMs == null ? 1 : Math.max(1, Math.min(count, Math.floor(sliceMs / Math.max(1e-3, sampleMs))));
        R.hud(count, reset, R.cost);
        R.batches = R.hud.batches = batches;
        R.photonPlan = R.hud.photonPlan = { pixels: px, rays: R.raycount, buffer: R.raybufferSize, batches, lt: { ask: ltAsk, got: R.photoncount },
            sources: asks.map((e, i) => ({ name: e.src.name ?? `source ${i + 1}`, ask: e.ask, ready: e.ready, got: e.ready ? e.ask : 0,
                                           why: sketch && +e.src.perPixel() > 0 ? 'none in Sketch'
                                               : raysOff && +e.src.perPixel() > 0 ? 'the lights\' rays are switched off (Light sources)'
                                               : e.src.why?.() ?? '' })) };
        /* Learning switched off: back to a uniform map, once, before the frame opens -- a map
           left over from learning would otherwise keep steering photons with nothing
           updating it. */
        const ltLearn = (uniforms.ltLearn ?? 1) !== 0;
        if (!ltLearn && R._ltLearnt) { R.clearLight(); R._ltLearnt = false }
        /* THE GRIDS MOVED -- the sun's photon square or the emitter search (ltHalf, emitHalf: their settings, capped
           at the scene's radius since 0.9.1): what was learned is in the old coordinates. The emitter grid's boxes
           are quantised over +-emitHalf, so they would decode to the wrong places, and a box's bounds never fade
           while hits keep coming -- a radius dragged once would have aimed light sampling wrong for good (still
           exact: the camera side checks the same list; only noisier). A scene swap clears anyway (setScene); this
           is the radius edited live (RT.updateScene) and the settings moved. Forgotten once, before the frame. */
        const grids = `${uniforms.ltHalf}|${uniforms.emitHalf}`;
        if (R._grids !== undefined && R._grids !== grids) R.clearLight();
        R._grids = grids;

        /* Said once per size and batch count: a sample in batches takes that many times the wavefront chain. It was
           "ray cap reached", when the cap cut the camera rays and the photons. */
        const said = `${px}|${batches}`;
        if (batches > 1 && warned !== said) {
            console.info(`[RAYTRACER] ${Q.w} x ${Q.h} with ${R.photoncount + R.extraPhotons} photons: a sample runs in ${batches} batches of at most ${R.raybufferSize} rays`);
            warned = said;
        }


        // Precompute raygen tiling grid (aspect-preserving) on CPU
        const fresx = Q.w, fresy = Q.h;
        const N = R.raycount >>> 0;
        // tilesX estimated to cover N while preserving aspect -- see raygenTiles for why rounded
        const { tilesX, tilesY, invTilesX, invTilesY } = raygenTiles(N, fresx, fresy);



        /* A RESET STARTS THE WINDOW AT ZERO: the first sample after it REPLACES each pixel it
           lands on (resolve: prevn = min(count, 0) = 0), and the average builds from there.
           It used to start at 2, so the old picture kept a 2/3 share of the first sample and
           faded as about 2/(n+2) -- a re-weight rather than a restart, chosen so a move would
           not flash black. That was invisible while radiance was of order 1. In cd/m^2 a
           highlight from before the move can be 1e9 against a white point of 4e4, and at
           2/(n+2) it is still far above white after thousands of samples: bright spots stayed
           where they had been. Replacing does not flash black either -- every pixel a ray
           reaches shows the new sample at once, and every sample reaches every pixel (in batches
           past the ray cap since 0.38.1; before, a sample there covered part of the picture and
           a pixel it missed kept the old value until a later one landed).
           UB.moveAverages put the old behaviour back as a choice, a window of N kept through a
           reset, until 0.74.0 (the user: "may be removed"): always 0 now. */
        if (reset) frames = 0;
        if (reset) samples = 0;
        /* ...AND A SAMPLE PENDING OVER FRAMES (A SAMPLE OVER SEVERAL FRAMES) goes on, marked: it resolves with the window
           just started (it replaces the picture, as the first sample after a reset does), and the window starts again
           after it, so the samples averaged from then on are all of the new view. */
        if (reset && pending) pending = R._slice = { ...pending, mixed: true, sample: { ...pending.sample, maxaverages: frames } };

        /* `maxaverages` caps the EMA window. The GUI calls 0 "unlimited", and this used to
           read Math.min(frames, maxaverages) -- which at 0 pins the window to 0, i.e. every
           sample REPLACES the picture instead of never being forgotten. Exactly backwards
           from the label. 0 now means what it says. */
        if (uniforms.maxaverages > 0) frames = Math.min(frames, uniforms.maxaverages)

        /* HOW MANY WAVEFRONT ITERATIONS A SAMPLE GETS.

           One iteration advances every live ray by up to MARCH_STEPS and shades whatever
           arrived, so a path needs one iteration per MARCH_STEPS it marches, plus one per
           bounce (a shaded ray is re-marched on the NEXT iteration). `ray.counts`' march half (raySteps) is
           cumulative over the whole path and capped by UB.maxiter, which bounds the marching
           half; UB.maxbounce bounds the other.

           This used to be `maxbounce + 2`, one number serving as both budgets. At the
           defaults (maxbounce 10, maxiter 400) that is 12 iterations to cover 10 bounces and
           up to ceil(400/32) = 13 chunks of marching -- about half what a path can need, and
           the shortfall was invisible because rays still in flight were simply dropped. With
           THE FLUSH in the march kernel they are no longer dropped, so a low budget now costs
           convergence rather than light, and this number can be tuned honestly. */
        const nee = (uniforms.nee | 0) !== 0
        R.ensureShadow(nee || connects)            // no-op after the first frame that needs it
        const chunks = Math.ceil((uniforms.maxiter | 0) / MARCH_STEPS)
        const worstCase = Math.max(2, ((uniforms.maxbounce | 0) + 1) + chunks)

        /*==============================================================================
          THE ITERATION BUDGET IS THE WORST CASE (0.10.0), unless budgetOverride pins it.

          It used to be adaptive: the GPU reported the iterations it used (`used`, counted
          by prog_flip whenever rays remain) and the rays the last pass had to terminate
          (`flushed`), and the host sized the next frame from them -- grow by 2 while over
          flushTolerance of the rays were flushed, shrink by 1 while `used + 3` was under
          the budget, floor 4. It was removed because it never did what it was for, and what
          it did instead was an accident:
          - THE SHRINK NEVER FIRED LEGITIMATELY. `used` is a max over a million paths, and
            shade writes a bounce on the last pass, so it reads the budget itself whenever
            one path is still going: used == budget in every configuration measured (24/24,
            18/18, 15/15 before; every row of the benchmark's second run, the user's Pascal,
            2026-10-02, PERFORMANCE_REVIEW.md §10.5).
          - IT FIRED BY ACCIDENT. It tested `R.used + 3 < (R.budget || worstCase)` but set
            `R.budget - 1`, so from the start state (budget 0, which the benchmark set at
            every row) any stale `used` under worstCase - 3 sent the first sample to the
            floor of 4; growth then climbed by 2 and stopped at the first budget flushing
            under 1%. The benchmark's materials row ran 8, 24 and 8 iterations in three runs
            (measured by the user, §10.6); the same climb was reproduced in node on the real
            R.trace with a stub WG and an assumed flush curve.
          - A RISE IN THE WORST CASE NEVER LIFTED IT. High quality's maxbounce 24 makes the
            worst case 25 + 13 = 38, and a live page that had run at 24 stayed at 24 unless
            over 1% of rays were flushed (read in code; quality.js).
          What the accident cost and bought (the user's Pascal, 2026-10-02, §10.5-10.6):
          materials at 8 iterations against 24 was 53.7 against 85.6 ms a sample of wall
          clock (runs 1 and 2) for 33.0 against 35.1 ms of GPU; an added near-empty iteration
          cost 0.13 ms (materials) to 0.42 ms (Menger) of GPU and about 2 ms off it, before
          this version's uniform writes cut the recording. At 8, 0.32% of the paths were cut
          short and 1,282 shadow rays a sample were counted lit for lack of steps (run 3).
          The user chose exact (2026-10-03, option A2 of the plan for #27): every path gets
          the bounces and the steps it is allowed. A light scene pays the off-GPU cost of its
          extra iterations, whatever that is now -- not measured since.

          The counters readback below stays, every frame: `used`, `flushed`, `nonfinite` and
          `shadowCut` feed the HUD and the benchmark's columns. The controller's two properties,
          autobudget and flushTolerance, did nothing after it went and were removed in 0.22.3.
        ==============================================================================*/
        R.budget = R.budgetOverride > 0 ? Math.max(2, R.budgetOverride | 0) : worstCase
        const iterations = R.budget
        // on the HUD, because it is the multiplier on the dispatch count per frame
        R.hud.iterations = iterations
        R.hud.used = R.used
        R.hud.flushed = R.flushed
               //------------------------------------------------------------------------------------------------------------//
        // run total renderer (generate rays, trace) 'count' times to average out noise
        // One frame encoder for everything: uniform writes are staged by the toolkit
        // (copyBufferToBuffer between passes), so each dispatch sees its own uniforms
        // within a single submit.
        /* NO SUBMIT LONG ENOUGH TO BE KILLED. Windows resets the GPU when one submission runs about 2 s
           (TDR: DXGI_ERROR_DEVICE_HUNG, device lost), and a frame here was ONE submission -- a whole
           sample, every wavefront iteration. The Noise library takes over a second a sample, and it
           hung (2026-09-29). So a heavy frame is cut into submissions of about SUBMIT_MS each: how many
           iterations that is comes from how long the GPU was busy with the last frame (R.frameMs, timed
           below: not the queue's wait before it). A frame under SPLIT_OVER_MS is not cut -- a fast scene
           pays nothing -- and with no timing yet (a new scene) every iteration is its own submission until
           there is. One dispatch longer than the limit would still be killed; that is a march over too many
           rays of too heavy a scene.
           THE FRAME'S TIME IS SPREAD OVER AT MOST SPLIT_ITERS ITERATIONS. The count assumes the iterations
           cost alike, and they do not: the first few carry nearly all the rays (the wavefront log), the tail
           almost none (0.13-0.42 ms of GPU an added iteration, the user's Pascal, 2026-10-02). So raising the
           iteration count adds iterations without adding time, lowers the time an iteration seems to take,
           and would put more of the heavy first iterations in one submission. Since 0.10.0 the budget is
           always the worst case -- High quality's 38 where a live page had been held at 24 -- so the frame is
           divided by no more than 24, the count every heavy scene ran at the defaults before: no submission
           is coarser than a 24-iteration frame of the same time would have been. (Against a frame the old
           adaptive budget had shrunk below 24, a heavy one is cut up to 24/that coarser -- inferred safe from
           the rule's margin, SUBMIT_MS 150 against about 2000, but not measured.)
           A TIMING COUNTS ONLY FOR A FRAME OF ITS OWN SHAPE: the same iterations and maxiter (frameShape). Raise
           maxiter or maxbounce and the next frame is the new worst case at once -- 74 iterations and 31 pairs of
           shadow rounds at maxiter 2000 -- while R.frameMs still says the old frame's time; under SPLIT_OVER_MS it
           would go uncut, as one submission several times as long (a review of 0.10.0: inferred, not seen). The
           old adaptive budget grew 2 a frame and so was timed on the way; the worst case at once is not. So a
           frame whose shape no timing has measured is cut every iteration, as a new scene's first is, and the
           shape travels with its timing (below), since with two frames in flight the next is recorded before
           this one's time is known. A frameMs with no shape beside it was set by hand (the tests), and is taken
           as it is. */
        /* A SAMPLE IN BATCHES (0.38.1, planBatches above) runs the chain once a batch, so the frame's time is spread over
           its batches before its iterations: each batch's chain is cut as a frame of that share would be. The batch
           count is part of the shape, so a frame of another count is untimed and cut every iteration until it is. */
        /* A SLICE IS TIMED AS PART OF ITS SAMPLE (A SAMPLE OVER SEVERAL FRAMES): its frame's time is the time of the
           batches it ran, so its shape says so, and a whole frame after it is untimed until timed itself. A slice's
           batch is cut by the sample's time spread over its batches -- the same rule, per batch. */
        const frameShape = `${iterations}|${uniforms.maxiter | 0}|${batches}${sliced ? '|slice' : ''}`;
        const untimed = R.frameMs == null || (R._frameMsShape != null && R._frameMsShape !== frameShape);
        const batchMs = sampleMs != null ? sampleMs / batches : null;
        const splitEvery = R.submitEvery > 0 ? Math.max(1, R.submitEvery | 0)
            : sliced ? (batchMs == null ? 1 : batchMs <= SPLIT_OVER_MS ? Infinity
                        : Math.max(1, Math.floor(Math.min(iterations, SPLIT_ITERS) * SUBMIT_MS / batchMs)))
            : untimed ? 1 : R.frameMs <= SPLIT_OVER_MS ? Infinity
            : Math.max(1, Math.floor(Math.min(iterations, SPLIT_ITERS) * SUBMIT_MS / (R.frameMs / batches)));
        /* THE LAST PASS'S SHADOW ROUNDS. A shadow ray still marching when the last pass's occlusion ends its 32
           steps was counted unoccluded -- nothing traces it again -- a bright bias: 3,945 of the Menger cubes' last
           6,253 shadow rays (the wavefront log, the user's Pascal, 2026-10-02). So the last pass runs occlusion
           again on what is left, round after round, until every ray has ended: blocked, at its light, or out of
           maxiter. A shadow ray starts at step 0 and the kernel ends it once its steps pass maxiter, so
           ceil((maxiter + 1) / OCCLUDE_STEPS) rounds always suffice (13 at the default 400): the first is the
           iteration's own occlusion, the rest come in PAIRS, each round reading the queue the one before wrote,
           with prog_shadow_flip between, so the queue's side is back where the iteration's own snapshot and
           flip expect it (wavefront.js). The pairs only mean a 14th round where an odd count would do. The
           wavefront log's last iteration therefore shows the last round's shadow queue, not the first's, and
           its shadowcut total includes every round.
           NOT ONE LONG DISPATCH: a draft of this change marched the last pass up to maxiter + 1 steps in one,
           and the user's page lost its GPU while it ran (DXGI_ERROR_DEVICE_HUNG, a heavy scene, 2026-10-03; not
           established as the cause). Each round is the kernel's usual 32 steps over a queue no larger than the
           round before's, and a pair may end a submission like an iteration (below): no dispatch and no
           submission longer than before. What the rounds cost is three dispatches each, over an empty queue
           almost always (12 rounds at the defaults; not measured). */
        const shadowPairs = Math.ceil((Math.ceil(((uniforms.maxiter | 0) + 1) / OCCLUDE_STEPS) - 1) / 2);
        let sinceSubmit = 0;
        const tFrame = performance.now();
        R.hud.splitEvery = splitEvery;
        /* PER-KERNEL TIME, when asked (R.timeKernels): every compute pass of this frame, the cut submissions
           included, gets a timestamp pair and the name of its kernel; read after the last submit. Nothing
           between here and endFrame awaits, so no other caller's pass can fall inside. */
        const kt = R._ktOn ? R._kt : null;
        if (kt) {
            R._ktLast = null;                  // a trace that fails before its readback leaves none, not the last one's
            const byProgram = new Map(KERNEL_PROPS.map(([name, prop]) => [R[prop], name]));
            if (R.prog_wf_snap) byProgram.set(R.prog_wf_snap, 'wf_snap');
            /* ...and another module's photon kernels (R.photonSources: the optics module's prog_opt_photons), by the name
               the source gives them: timed as 'other' until 0.61.2, so a light's photons had no line of their own */
            for (const src of R.photonSources) for (const p of src.programs?.() ?? []) byProgram.set(p, src.kernelName ?? 'photons');
            WG.timePasses(kt.begin(p => byProgram.get(p)));
        }
        WG.beginFrame();
        const wf = R._wfOn && R.prog_wf_snap;
        if (wf) { R._wfLast = null; R.wfLog.w(new Uint32Array(1)); }      // the log's count back to 0
        /* Everything the kernels share, hoisted OUT of the sample loop. Only the seed, the
           clock and the frame count belong inside. (Path guiding's rebuild once read a const
           scoped to one iteration of this loop from outside it -- a ReferenceError that fired
           only with guiding on. Guiding is gone; the lesson is why this is hoisted.) */
        const baseUniforms = { res: [Q.w, Q.h], tilesX, tilesY, invTilesX, invTilesY, ...uniforms,
                               lt: sunPhotons > 0 ? 1 : 0, ltEmit: R.emitPhotons > 0 ? 1 : 0,
                               /* the lights' photons (R.photonSources), by the same rule: 1 only in a frame
                                  that runs them. Without them the camera side counts every light's face on
                                  every path (codegen LIGHTS) -- a kernel still compiling, no room left --
                                  a noisy picture instead of a dark one. */
                               ltLights: R.extraPhotons > 0 ? 1 : 0,
                               /* ...and when they are ONE source that says what each photon carries, the
                                  camera's paths share the lights' direct paths with it by MIS (Ray.ltMis),
                                  weighing them by that same number. With two, whose photons would meet a
                                  face is not one number: 0, and both sides keep the hard split. In a fast
                                  mode the kernels share nothing whatever this says (materials_pbr.js FAST
                                  MODES): the camera's path stops where the sharing would begin. */
                               ltLightFlux: extra.length === 1 && extra[0].src.fluxPerPhoton
                                   ? Math.max(0, +extra[0].src.fluxPerPhoton(extra[0].n, uniforms) || 0) : 0,
                               photoncount: R.photoncount, emitPhotons: R.emitPhotons, ...R.stepCacheUniforms(uniforms.sceneUnit || 1),
                               /* the photon map: on this trace or not, and how many photons it holds (core/sppm.js) */
                               sppmCtl: [sppmRuns ? 1 : 0, sppmRuns ? sppmCap : 0, Math.max(0, R.sppmVisit | 0), 0] };
        /* ONE WHOLE BAG PER PROGRAM PER TRACE, THEN ONLY WHAT MOVES. tinywebgpu merges a write into the
           program's own CPU copy of its uniform struct and stages the whole struct (tinywebgpu.js
           uniformWrite; tinywebgpu's test/layout.test.mjs holds the merge), so a field not named keeps the value
           last written. This handed march, shade and occlude a fresh copy of the whole bag every wavefront
           iteration, and the others one every sample, each of up to 457 fields (OpticsBench) packed one by
           one: 93% of R.trace's JavaScript in a CPU profile (measured in node 22.17 on the user's Windows
           machine over a recording device, 200 samples of the noise scene, by the agent session that planned
           this, 2026-10-03; PERFORMANCE_REVIEW.md's appendix has it beside an older profile that said 74%).
           The bytes the GPU receives are the same either way.
           So each program's FIRST write in a trace is the whole bag -- whatever wrote it between traces
           (a rebuild's new program, another value of any field) cannot leave a stale one -- and
           every write after it names only what moves: the clock, the seed and the averaging window per
           sample, and the seed and lastpass per iteration. `wrote` is per trace, never kept on R, and
           nothing from here to endFrame awaits, so no other caller can write these programs in between.
           A FIELD THAT STARTS TO MOVE INSIDE A TRACE has to go into `sample` or `moves` below: one left
           out keeps its first value for the rest of the trace, every sample of it.
           The kernels that declare the base uniforms only (forCompute, above) get the base names: the four
           scene-free ones, and shade since 0.20.8. */
        const ownBase = forCompute(baseUniforms);
        // the step cache's cells filled first, where they are filled once and owed (R.stepCacheFor), in a submission of their own
        if (stepCacheFillPass(baseUniforms)) { WG.endFrame(); WG.beginFrame(); }
        const wrote = new Set();
        const setU = (p, whole, few) => {
            if (wrote.has(p)) p.uniforms = few;
            else { wrote.add(p); p.uniforms = whole(); }
        };
        let sampled = 0;                          // how much of a sample this call traced: R.sampled, for the loop's rate
        while (count-- > 0) {
            // this sample's seed and averaging cap (EMA reset when frames==0). No clock: no kernel read UB.time, and it
            // went from the schema in 0.22.3 with frame, flipbuffer, resetframecount and invViewProjection.
            // A sample pending over frames keeps its own, and goes on from its next batch.
            /* ...AND ITS PHOTON MAP'S RADIUS (core/sppm.js): r_1, sppmRadius pixels at the distance in focus, shrunk for the
               frames-th sample since the reset; the same in every batch of the sample, the photons' cells and the
               gathers' alike */
            const sample = pending ? pending.sample
                : { seed: seed_vec4u32(), maxaverages: frames, sppmGeom: [...sppmGeomFor(uniforms, frames, Q.h).slice(0, 3), sppmKeepNow] };
            R._sppmKeepLast = sample.sppmGeom[3];
            const own = () => ({ ...ownBase, ...sample });
            const firstBatch = pending ? pending.next : 0;
            const endBatch = Math.min(batches, firstBatch + perCall);

            /* THE SAMPLE'S BATCHES (planBatches above): each generates its share of every stream and runs the whole
               chain; resolve folds them in once, below. One batch, as everything fits at most sizes, is the sample as
               it always was -- the sample's own seed for its rays, rayFirst 0. Every batch after it a seed of its own,
               or its photons and rays would repeat the first's: the kernels seed by their index in the batch. */
            for (let bi = firstBatch; bi < endBatch; bi++) {
                const gen = { ...sample, seed: bi === 0 ? sample.seed : seed_vec4u32(),
                              rayFirst: batching.first(0, bi), rayBatch: batching.part(0, bi),
                              emitBatch: batching.part(1, bi), photonBatch: batching.part(1, bi) + batching.part(2, bi) };
                const genOwn = () => ({ ...own(), raycount: R.raycount, ...gen });

                // 0) a sample's photon map starts empty (core/sppm.js): its count and its lists, in the frame's order
                if (sppmRuns && bi === 0) R.sppmHeads.clear();
                // 1) Ray generation
                setU(R.prog_genrays2, genOwn, gen);
                // (none in a batch of photons alone: the photon map's, below -- a dispatch of no workgroups is legal, and logged)
                if (gen.rayBatch > 0) R.prog_genrays2.dispatch(Math.ceil(gen.rayBatch / R.trace_wgsize), 1, 1);
                // ...and the light tracer's photons, straight after them in the same buffer
                if (ltOn && gen.photonBatch > 0) {
                    setU(R.prog_genphotons, genOwn, gen);
                    R.prog_genphotons.dispatch(Math.ceil(gen.photonBatch / R.trace_wgsize), 1, 1);
                }
                /* ...and the other sources' after those: each writes its own at the offset it is given, `count` this
                   batch's and `total` the sample's (what each photon's flux is divided by). A whole bag, scene names and
                   all, built only when there is one: a source reads what it likes from it (the optics source, u.seed and
                   u.sceneUnit) into kernels of its own that declare the scene's uniforms */
                let at = gen.rayBatch + gen.photonBatch;
                if (extra.length) {
                    const all = { ...baseUniforms, ...sample, seed: gen.seed };
                    extra.forEach((e, i) => {
                        const n = batching.part(3 + i, bi);
                        if (n > 0) e.src.generate({ buffer: R.raybuffer0, offset: at, count: n, total: e.n, uniforms: all });
                        at += n;
                    });
                }

                // 2) Wavefront: reset counters for this iteration
                const marchInCount = at >>> 0;                  // this batch's rays and photons
                // {buf0, buf1, shade, readfrom, used, flushed, shadow0, shadow1, shadowcap}
                // shadowcap is what the occlusion queue can hold: one entry per ray, no more --
                // a camera ray's NEE ray or a photon's camera connection, never both
                R.counters.w(counterWords({ 0: marchInCount, 8: (nee || connects) ? marchInCount : 0 }));

                // 3) The wavefront chain. Once the buffers drain the indirect dispatches are
                //    zero workgroups, so the tail of the budget costs dispatch overhead and no
                //    shader time -- which is what makes it safe to size `iterations` for the
                //    worst case rather than the typical one.
                for (let it = 0; it < iterations; it++) {
                    // one seed an iteration, the same for march, shade and occlude, as it always was
                    const moves = { seed: seed_vec4u32(), maxaverages: frames, lastpass: it === iterations - 1 ? 1 : 0 };
                    const whole = () => ({ ...baseUniforms, raycount: R.raycount, ...moves });
                    setU(R.prog_wvfmarch, whole, moves);
                    setU(R.prog_wvfsurface, whole, moves);
                    // the base names only, as the four above: shade declares no scene uniform since 0.20.8
                    setU(R.prog_wvfshade, () => ({ ...ownBase, raycount: R.raycount, ...moves }), moves);

                    // Prepare march indirect args → dispatch march
                    R.prog_prep_march.dispatch(1, 1, 1);
                    R.prog_wvfmarch.dispatchIndirect(R.indirect_march.b, 0);

                    // Prepare shade indirect args → the scene's answers about each hit (surface), then shade, over the same hits
                    R.prog_prep_shade.dispatch(1, 1, 1);
                    R.prog_wvfsurface.dispatchIndirect(R.indirect_shade.b, 0);
                    // ...the photon map's store and gather on those hits, before shade moves them (core/sppm.js)
                    if (sppmRuns) {
                        const at = { ...moves, sppmGeom: sample.sppmGeom };
                        setU(R.prog_sppm, () => ({ ...ownBase, raycount: R.raycount, ...at }), at);
                        R.prog_sppm.dispatchIndirect(R.indirect_shade.b, 0);
                    }
                    R.prog_wvfshade.dispatchIndirect(R.indirect_shade.b, 0);

                    /* The occlusion pass, after shade so it sees last iteration's shadow rays in
                       the read side while shade fills the write side. Skipped only when NOTHING
                       queues shadow rays -- and light tracing does: its camera connections are
                       shadow rays. This read `if (nee)`, so with NEE off every connection was
                       queued and never traced, while the camera side had still handed those paths
                       over: glass cast a plain shadow with lt on and NEE off. */
                    if (nee || connects) {
                        // on the last pass, every round but the last requeues what it did not finish (lastpass 0)
                        const pairs = it === iterations - 1 ? shadowPairs : 0;
                        const requeue = pairs ? { ...moves, lastpass: 0 } : moves;
                        setU(R.prog_wvfocclude, () => ({ ...whole(), ...requeue }), requeue);
                        /* SHADOW RAYS ON DISTANCE ONLY (wavefront.js prog_occlude, prog_occlude_emit): after each prep, the
                           emitter rays a round before marked are resolved, before this round's occlusion skips them --
                           zero groups when none was (the prep sizes it) */
                        const emitRound = () => R.prog_occlude_emit.dispatchIndirect(R.emitArgs.b, 0);
                        setU(R.prog_occlude_emit, () => ({ ...whole(), ...moves }), moves);
                        R.prog_prep_occlude.dispatch(1, 1, 1);
                        emitRound();
                        R.prog_wvfocclude.dispatchIndirect(R.indirect_occlude.b, 0);
                        for (let k = 0; k < pairs; k++) {
                            /* A PAIR MAY END A SUBMISSION, as an iteration does: its two rounds run over the
                               survivors of the round before, never a larger queue than the iteration's own
                               occlusion, which is lighter than its march and its shade (materials, 1280x720: 5.5
                               against 13.4 and 15.8 ms, GTX 1080 Ti, 2026-10-03, one run) -- so counted as one
                               iteration, a pair cuts no coarser (inferred for other scenes, not measured). */
                            if (++sinceSubmit >= splitEvery) { sinceSubmit = 0; WG.endFrame(); WG.beginFrame(); }
                            for (let h = 0; h < 2; h++) {
                                R.prog_shadow_flip.dispatch(1, 1, 1);
                                if (k === pairs - 1 && h === 1) R.prog_wvfocclude.uniforms = moves;   // the last round: lastpass 1
                                R.prog_prep_occlude.dispatch(1, 1, 1);
                                emitRound();
                                R.prog_wvfocclude.dispatchIndirect(R.indirect_occlude.b, 0);
                            }
                        }
                        /* ...and what the sample's last round marked, after it: a flip to read it, its resolve, and a flip
                           back -- two, as a pair of rounds has, so the queue's side (which the march shares) is where it was */
                        if (it === iterations - 1) {
                            R.prog_shadow_flip.dispatch(1, 1, 1);
                            R.prog_prep_occlude.dispatch(1, 1, 1);
                            emitRound();
                            R.prog_shadow_flip.dispatch(1, 1, 1);
                        }
                    }

                    if (wf) R.prog_wf_snap.dispatch(1, 1, 1);          // this iteration's counts, before the flip resets half
                    // Flip ping/pong and reset opposite counters
                    R.prog_wvfflip.dispatch(1, 1, 1);
                    // the cut (see NO SUBMIT LONG ENOUGH above): uniforms are staged per dispatch and
                    // flushed at endFrame, so work goes on in the next submission exactly as it would have
                    if (++sinceSubmit >= splitEvery) { sinceSubmit = 0; WG.endFrame(); WG.beginFrame(); }
                }
            }

            // 4) Fold this sample into the picture. ONCE per sample, after the chain has
            //    drained -- not per bounce: paths terminate at different iterations, so
            //    resolving per bounce would give a pixel an EMA step every time one of its
            //    paths happened to finish, which is the weighting bug the old per-ray
            //    accumulation had. See RESOLVE in wavefront.js.
            //    No raycount: resolve was never handed one, and is not now.
            sampled += (endBatch - firstBatch) / batches;
            R.hud.slice = sliced ? `${endBatch}/${batches}` : '';
            if (endBatch < batches) {             // A SAMPLE OVER SEVERAL FRAMES: the rest in the frames after this one
                R._slice = { key: sliceKey, K: batches, sample, next: endBatch, mixed: !!pending?.mixed, map: sppmRuns };
                break;
            }
            const mixed = !!pending?.mixed;
            R._slice = pending = null; R._sliceDrops = 0;
            setU(R.prog_resolve, own, sample);
            R.prog_resolve.run(Q.w, Q.h, 1);   // 2D: x alone runs out of workgroups at 4.19 Mpx
            frames++; samples++;
            // a sample part old view and part new has replaced the picture: the average starts again after it (above)
            if (mixed) { frames = 0; samples = 0; }

            /* REBUILD THE EMISSION MAP between samples, never inside one -- the photons of a
               sample must all be drawn from, and divided by, the same density. Every
               LT_EPOCH samples: often enough to follow a moving camera, rare enough that each
               rebuild has a few million photons behind it. */
            if (sunPhotons > 0 && ltLearn && ++ltBuilt >= LT_EPOCH) {
                ltBuilt = 0;
                R._ltLearnt = true;
                R.prog_lt_build.run(LT_GRID, 1, 1);
            }
            /* ...and the emitter list, from what camera paths have discovered: every
               EMIT_EPOCH samples, between samples for the same reason. Built whether or not
               NEE is on -- discovery never stops, and switching NEE on should find a list. */
            if (++emitBuilt >= EMIT_EPOCH) {
                emitBuilt = 0;
                setU(R.prog_emit_collect, own, sample);
                R.prog_emit_collect.run(EG_CELLS, 1, 1);
                R.prog_emit_publish.run(1, 1, 1);
            }
        }

        R.sampled = sampled;
        R.hud.samples = samples; R.hud.window = uniforms.maxaverages > 0 ? uniforms.maxaverages : 0;   // HUD
        R.hud.photons = R.photoncount || 0;
        // the photon map's last sample read back (Render stats), or why it does not run while it is on
        R.hud.sppm = sppmRuns ? R.sppmStats : !sppmWant ? null
            : !sppmPhotons ? { idle: 'no photons (the caustics and the lights\' rays are off)' }
            : R._sppmIdle ? { idle: 'nothing seen through glass or a mirror' } : R.sppmStats;

        //---------------------------------------------------------------------------------------------------------//
        // STEP 4: Render the accumulated image to screen (same submit as the trace work)
        //---------------------------------------------------------------------------------------------------------//
        meterForDisplay(uniforms);
        R.prog_render.uniforms = forRender({
            ...uniforms,
            res: [Q.w, Q.h],
            ...R.stepCacheUniforms(uniforms.sceneUnit || 1),          // its grid, for stepCacheView
        });
        R.prog_render.drawTo(target);
        /* WHAT OTHER MODULES DRAW OVER THE PICTURE, into the same target in the same frame, so
           it is on every frame the picture is: the optics trace's ray paths (optics/paths.js). */
        for (const o of R.overlays) o(target);
        WG.endFrame();
        R.recordMs = performance.now() - tRecord;
        if (kt) { WG.timePasses(null); R._ktLast = kt.end(); }
        if (wf) R._wfLast = R.wfLog.r(4 * (1 + WF_LOG_MAX * WF_LOG_WORDS), 0, Uint32Array).then(readWavefrontLog, () => null);
        /* HOW LONG THE GPU WAS BUSY WITH THIS FRAME, to size the next one's submissions; never awaited.
           It was the time from recording to done, one frame timed at a time -- which, with a frame queued
           behind another (renderFrame's inFlight 2 offscreen, the live loop's two in flight), is the queue's
           wait as well: a 200 ms sample behind another would read about 400, over SPLIT_OVER_MS, and be cut
           into submissions it did not need (#26 by the back door; the benchmark pinned submitEvery for it).
           So the busy time starts when this frame could start: its recording, or the frame before it
           finishing, whichever is later (R._doneAt). That needs the frames' dones in submission order,
           which the queue's order should give (inferred, not seen on a card); one that came back after a
           later frame's is dropped, since a later frame's end would make it read near zero -- uncut, the
           unsafe side. Several timings may be outstanding, since two in flight needs each frame's done;
           past the cap a frame goes untimed, and the next then also counts that one's time: a reading too
           long, which cuts finer -- the safe side of the TDR limit, never the other. */
        if ((R._timing | 0) < 4) {
            R._timing = (R._timing | 0) + 1;
            const seq = R._frameSeq = (R._frameSeq | 0) + 1;
            WG.device.queue.onSubmittedWorkDone()
                .then(() => {
                    if (seq < (R._doneSeq | 0)) return;
                    const t = performance.now();
                    R.frameMs = R.hud.frameMs = t - Math.max(tFrame, R._doneAt || 0);
                    R._frameMsShape = frameShape;          // what this time is the time OF (the split, above)
                    /* ...and what a whole sample costs a pixel, from it: the share of a sample this frame traced
                       (A SAMPLE OVER SEVERAL FRAMES sizes its slices by it). A frame with a step cache fill in it
                       reads long once: the EMA lets it pass. */
                    if (sampled > 0 && px > 0) {
                        const x = R.frameMs / (sampled * px);
                        R._pxMs = R._pxMs == null ? x : R._pxMs + (x - R._pxMs) * SLICE_EMA;
                    }
                    R._doneAt = t; R._doneSeq = seq;
                })
                .catch(() => { })
                .finally(() => { R._timing--; });
        }
        readAutoEV(uniforms);
        R.readProbe();

        /* One readback a frame, deliberately not awaited: awaiting it here would stall the
           pipeline every frame. The values are a frame old by the time they are read, and
           nothing steers by them any more (the iteration budget is the worst case): they are
           the HUD's and the benchmark's readings. Guarded so only one is ever in flight. */
        /* The photon map's count and the gathers it cut short, its last sample's (core/sppm.js): Render stats' lines.
           ...AND WHETHER A CAMERA RAY LOOKED (NOT IDLE, above): read from a sample this trace ended whole (one pending over
           frames has run its photons first and perhaps no camera ray yet), and only while nothing has started the map
           again since (its generation) -- a reading from before a new scene must not make the new one idle. */
        if (sppmRuns && !R._readingSppm) {
            R._readingSppm = true
            const cap = sppmCap, r = sppmGeomFor(uniforms, Math.max(0, frames - 1), Q.h)[0]
            const whole = !R._slice, gen = R._sppmGen | 0, keep = R._sppmKeepLast ?? 1
            R.sppmHeads.r(16, 0, Uint32Array)
                .then(a => {
                    R.sppmStats = { stored: Math.min(a[0] >>> 0, cap), overflow: Math.max(0, (a[0] >>> 0) - cap), cut: a[1] >>> 0, capacity: cap, radius: r, keep }
                    /* what a whole sample asked: the stores it kept (the count, the overflow in it) over the share it kept */
                    if (whole && gen === (R._sppmGen | 0)) R._sppmDemand = (a[0] >>> 0) / Math.max(keep, 1e-9)
                    if (whole && gen === (R._sppmGen | 0) && R._sppmKey) R._sppmIdle = a[SPPM_LOOKED] ? null : (R._sppmIdle ?? { left: SPPM_PROBE - 1 })
                })
                .catch(() => { })
                .finally(() => { R._readingSppm = false })
        } else if (!sppmWant) R.sppmStats = null
        /* The emitter count, for the host's photon split only (see SUN AND EMITTERS SHARE). */
        if (!R._readingEmit) {
            R._readingEmit = true
            R._emitRead = R.learn.r(4, EL_SNAP * 4, Uint32Array)          // R.readEmitCount waits for it
                .then(a => { R.emitCount = a[0] >>> 0 })
                .catch(() => { })
                .finally(() => { R._readingEmit = false })
        }
        /* EVERY FRAME. It was skipped with the old autobudget switch off, which left `used` and
           `flushed` holding whatever the frames before had read. */
        if (!R._reading) {
            R._reading = true
            R.counters.r(COUNTER_WORDS * 4, 0, Uint32Array)
                .then(a => { R.used = a[4] >>> 0; R.flushed = a[5] >>> 0; R.hud.nonfinite = R.nonfinite = a[9] >>> 0; R.shadowCut = a[10] >>> 0 })
                .catch(() => { })
                .finally(() => { R._reading = false })
        }
    }

    //====================================================================================================================

    return R;

}

