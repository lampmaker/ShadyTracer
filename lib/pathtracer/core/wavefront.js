
import { PRIMITIVES, SKY } from './sdf.js'
import { DEFINITIONS, PROCESSING, EMIT_LIST, LUM_CODE, EPS_WGSL, LT_GRID as LT_GRID_JS, LT_CELLS as LT_CELLS_JS, LT_FLOOR as LT_FLOOR_JS,
         EG as EG_JS, EG_CELLS as EG_CELLS_JS, EMIT_MAX as EMIT_MAX_JS, EV_BASE as EV_BASE_JS,
         EL_TMP as EL_TMP_JS, EL_SNAP as EL_SNAP_JS, FACE_TABLE, FACE_TABLE_WRITE, FACE_MAX } from './tracebasics.js'
import { SCENE_PRELUDE, SCENE_PRELUDE_GIVEN, SHADE_PRELUDE } from './scene_api.js'
import { LUMA } from './photometry.js'
import { ComputeUniformTypes, computeUniformTypes, sceneConstantsWGSL, lightFaceCount } from './uniforms.schema.js'

import { MATERIALS_PBR as PROCESSOR } from './materials_pbr.js'
import { LENS_WGSL } from './lens.js'
import { MANIFOLD_WGSL, MANIFOLD_SHARED_WGSL } from './manifold.js'
import { SPPM_WGSL } from './sppm.js'

/* ONE MATERIAL MODEL. There used to be four -- a legacy non-PBR switch plus Disney1, Keuper1
   and Keuper2 -- selected at runtime by a matModel uniform, with the pipelines rebuilt
   asynchronously in the middle of a trace whenever it changed. They were development
   scaffolding for comparing one against another, that comparison is over, and the cost of
   keeping them was not just the dead code: every kernel compiled the selected one, the shade
   kernel had a branch on matModel, and next-event estimation had to be written three times or
   declared unsupported in three of the four. Keuper2 won; it is materials_pbr.js now.


//===================================================================================================================
// wavefront marching program
// reads anf writes rays to/from marching buffers.  
// only if tge ray intersects a surface, it is written to the shading buffer
//===================================================================================================================


/* `used` and `flushed` once let the host size the iteration budget from what the scene needed instead
   of from the worst case. That controller is gone (raytrace_main.js THE ITERATION BUDGET IS THE WORST
   CASE), and they are readings now, for the HUD and the benchmark: `used` counts iterations that still
   had rays to march; `flushed` counts rays the last pass had to terminate, which says the budget was
   too small for them. */
/* `nonfinite` counts contributions the frame and splat buffers refused: NaN, infinite or of
   negative luminance (a negative CHANNEL is an exact colour outside the gamut, and is kept). They used to vanish -- a negative camera path returned before depositing without
   even counting itself -- and a NaN went straight into the sum and poisoned the pixel for good.
   Now they are dropped at the door, and the count says whether that is happening at all. */
/* `shadowcut` counts shadow rays whose test was CUT SHORT, by maxiter, rather than ended by a surface or by reaching
   their light (prog_occlude says what happens to them). A count for measuring, added when the wavefront log showed
   the benchmark's Menger cubes with 240 k shadow rays still marching in the last pass of a sample (the user's Pascal,
   2026-10-02); since 0.10.0 the last pass gives its shadow rays rounds until each has ended, so those are no longer
   among them. COUNTER_WORDS is the struct's size in words, for every buffer bound as Counters --
   the renderer's and the optics trace's both (optics/index.js), which a struct grown in one place only would leave a
   word short: a binding smaller than its struct is an invalid bind group. */
/* Steps one dispatch of prog_occlude marches a shadow ray (its MAX_STEPS). Exported because R.trace counts the last
   pass's extra occlusion rounds from it (raytrace_main.js THE LAST PASS'S SHADOW ROUNDS): a kernel that stepped
   further than the host assumed would only waste rounds, one that stepped less would leave rays cut again. */
export const OCCLUDE_STEPS = 32

/*===================================================================================================================
  THE STEP CACHE (stepCache, a developer setting; the user's idea, simulated first: roadmap/ARCHITECTURE.md, A lazy step
  cache, simulated). A grid of cells over the scene's box (UB.scLo: its low corner, w the cell size; UB.scDims: its cells),
  each a u32 in the stepCache buffer: 0 empty, else the f32 bits of the scene's distance at the cell's centre. A filled
  cell certifies a BALL -- that centre, that radius -- with no surface in it: the distance there is a lower bound on the
  true one, which is the march's own contract at every point it evaluates. So a ray inside a ball may move to where it
  LEAVES the ball, with no SDF -- not only to its nearest edge -- and any cell's ball serves: 1 looks at the cell the ray
  is in, 2 also at the two cells ahead along the ray, and takes the farthest exit. A step shorter than a cell is not
  taken (crawling through a cell costs more than asking); the march asks the scene as ever, where no ball holds the ray
  far enough.
  FILLED BY A PASS OF ITS OWN, READ-ONLY IN THE MARCH (0.33.0; the user: "writing the cache once and then using it in
  read-only mode during the trace, does that help"): every cell filled before the trace (prog_stepcache_fill below), and
  the march and occlusion kernels only read -- a plain load from a read-only binding. Filled again when what the cells
  were filled for changes (raytrace_main.js R.stepCacheFor): any uniform but the camera's, another scene, its data
  written -- KEPT across camera moves, which a ball does not care about; or before every trace (stepCacheFill 2), what a
  live edit pays. An empty cell (0) is a ball of radius 0, which holds no ray.
  THE LAZY FILL WENT IN 0.41.0 (the user, 2026-10-08: "Remove the stepcache 0 option"): until then the march filled a
  cell on a ray's first visit, through a trip of its loop with a stand-in ray and atomicMax. Measured on the user's
  Pascal (Tests > stepcache, 0.33.1): filled once was 6 to 22% faster than that on every scene, and the lazy fill no
  faster than the cache off on four of six (roadmap/ARCHITECTURE.md).
  COMPILED IN ONLY WHEN ON (0.29.0; the user: "make sure that all these different options, even when turned off, dont
  impose an overhead"): `mode` is the kernel option (raytrace_main.js R.kernelOptions), and with 0 the march and occlusion
  kernels hold none of this -- not the lookups, not a uniform test, not the binding -- so what they compile is what they
  compiled before the cache existed. A change of the setting builds the kernels again (index.js syncKernels). How many
  cells a lookup reads is fixed here too. */
export const stepCacheWGSL = mode => /*wgsl*/`
const SC_LOOKS: u32 = ${mode >= 2 ? 3 : 1}u;           // the own cell's ball; with 2, the two cells' ahead too
/* the step a ball allows from pos along dir, or -1 where none holds the ray as far as a cell */
fn scStep(pos: VEC3, dir: VEC3) -> FLOAT {
    let cs = UB.scLo.w;
    let dims = UB.scDims.xyz;
    if (cs <= 0.0 || dims.x == 0u) { return -1.0; }
    var best = 0.0;
    for (var a = 0u; a < SC_LOOKS; a = a + 1u) {
        let g = (pos + dir * (f32(a) * cs) - UB.scLo.xyz) / cs;
        if (any(g < VEC3(0.0)) || any(g >= vec3<f32>(dims))) { continue; }
        let cell = min(vec3<u32>(g), dims - vec3<u32>(1u));
        let k = cell.x + dims.x * (cell.y + dims.y * cell.z);
        let c = UB.scLo.xyz + (vec3<f32>(cell) + VEC3(0.5)) * cs;
        let r = bitcast<f32>(stepCache[k]);
        let oc = pos - c;
        let c2 = dot(oc, oc) - r * r;
        if (c2 >= 0.0) { continue; }                      // not inside this ball (an empty cell's is none)
        let b = dot(oc, dir);
        best = max(best, -b + sqrt(b * b - c2));          // where the ray leaves it
    }
    return select(-1.0, best, best >= cs);
}
`

/* THE CELLS FILLED BEFORE THE TRACE (stepCacheWGSL): one thread a cell, the scene's distance at its centre.
   THE PICK COPY OF THE SCENE, not the render copy: the same surfaces (codegen.js emitScene and scenedata.js evaluatorWGSL
   differ in the tags and the boxes alone), but no bounding-box culling. In the render copy a node farther than its box's
   margin answers with its box's distance, so a cell just outside a box got a ball that stopped at the box -- the orange
   shell around the boxes in the cells' view (the user, 2026-10-07: "I see orange glow around objects but also around
   their boundingboxes"). A scene with no pick copy (a hand-written one) is its own.
   In CHUNKS of SC_FILL_CHUNK cells, the chunk's first in UB.scDims.w (0 in every other kernel's bag): one dispatch is
   never more than a million evaluations, fewer than a march pass over a picture's rays makes.
   Magnitude: inside a medium the ball is as empty. Kept under 1e18 so its square stays a float -- a
   point no surface is near (an empty fold, 3e38) would otherwise make every ball's test infinite. */
export const SC_FILL_CHUNK = 1 << 20
export const SC_FILL_WG = 64
export let prog_stepcache_fill = async (WG, scene) =>
    await WG.makeCompute(`${SCENE_PRELUDE}${sceneConstantsWGSL(scene)}${scene.pickWgsl ?? scene.wgsl}`,
        /*wgsl*/`
            let dims = UB.scDims.xyz;
            let k = UB.scDims.w + gid.x;
            if (gid.x >= ${SC_FILL_CHUNK}u || k >= dims.x * dims.y * dims.z) { return; }
            let cell = vec3<u32>(k % dims.x, (k / dims.x) % dims.y, k / (dims.x * dims.y));
            let c = UB.scLo.xyz + (vec3<f32>(cell) + VEC3(0.5)) * UB.scLo.w;
            let h = sceneAt(newRay(c, VEC3(0.0, 0.0, 1.0), VEC4(1.0), 1.5), false);
            stepCache[k] = bitcast<u32>(clamp(abs(h.s.w), 1.0e-6, 1.0e18));
            `,
        computeUniformTypes(scene.uniforms),
        {
            stepCache: 'array<u32>',
            ...(scene.resources || {}),
        },
        { async: true, wg: [SC_FILL_WG, 1, 1] }
    )

export let counterstruct = `struct Counters { buf0count : atomic<u32>, buf1count : atomic<u32>, shadeCount : atomic<u32>, readfrom :u32, used : u32, flushed : atomic<u32>, shadow0count : atomic<u32>, shadow1count : atomic<u32>, shadowcap : u32, nonfinite : atomic<u32>, shadowcut : atomic<u32>,}`
// counted from the struct, not written beside it: every field is one u32, atomic or not
export const COUNTER_WORDS = counterstruct.match(/\w+\s*:/g).length
/* A sample's counters as written at its start: every word 0 but the ones given, by index (0 buf0count, 1 buf1count,
   3 readfrom, 8 shadowcap). Sized from COUNTER_WORDS, so a word added to the struct is zeroed too -- the literal
   arrays this replaced each spelled ten zeros, in four places across two files. */
export const counterWords = (set = {}) => {
    const a = new Uint32Array(COUNTER_WORDS)
    for (const [i, v] of Object.entries(set)) a[+i] = v >>> 0
    return a
}

/*===================================================================================================================
  DEPOSIT -- how a finished path, a shadow ray or a photon connection adds itself to this sample.

  F32, ADDED BY COMPARE-AND-SWAP. The frame and splat buffers were u32 fixed point, UB.accumScale
  = 65536 per unit, with a plain atomicAdd -- WGSL has no float atomics, and integer addition
  commutes, which is what made it race-free. It worked while radiance was of order 1. In cd/m^2
  it cannot: the u32 held at most 65535 per pixel per sample, and a sunlit white wall is 25 000,
  the sun's disc 1.6e9. Every contribution was clamped at 1e4 to keep it from wrapping, and
  anything under 1/65536 truncated to zero. Both limits were set by the number format, not by
  anything physical.

  So a word holds the bits of an f32, and adding to it is a load, an add and a compare-exchange
  that retries if another invocation got there first. Still race-free -- a lost race retries on
  the new value rather than overwriting it -- and contention is low: a pixel receives a few
  deposits per sample, spread across a whole wavefront.

  THE COST IS THE ONE THING HERE THAT HAS NOT BEEN MEASURED, and it cannot be on the software
  adapter in the container. It is a row in tests.js ('frame-cost').

  REFUSED, NOT CLAMPED: a NaN, an infinity or a contribution of negative luminance is dropped, and
  counted in counters.nonfinite where the module has the counters. A negative CHANNEL is not refused
  any more (badDeposit says why). NaN is detected by its exponent bits,
  because WGSL lets an implementation assume floats are finite, so `x != x` may fold to false.

  A GENERATOR, NOT A STRING, because WGSL cannot take a storage pointer as a function argument
  and a module may only name the buffers it binds: shade has no splat buffer.
  deposit_<buffer>(pix, rgb, direct) for each buffer asked for. (A `counted` option, for the
  convergence page's kernel, which had no counters, went with the page in 0.22.6.)

  THE FIREFLY CLAMP IS IN MULTIPLES OF THE DISPLAY WHITE -- the luminance the exposure maps to 1.0,
  UB.fireflyWhite, which the host derives each frame from the exposure the display is using (the
  metered one when auto-exposure is on). It was in absolute cd/m^2, and in this renderer that number
  meant nothing on its own: a sunlit white floor is ~2e4 cd/m^2 and arrives as one light sample per
  path, so any clamp under ~1e5 flattened every sunlit surface, not the speckles -- the user saw the
  whole scene go dark and low in contrast at every value they tried. A firefly is "far brighter
  than white", and white is where the exposure puts it, so that is the scale. A uniform and not
  aeState read here: prog_shade already binds eight storage buffers, the default per-stage limit.
  A direct contribution -- the camera looking straight at a lamp or the sky -- is never clamped:
  that is the thing itself, not noise, and clamping it would dim every visible light.
===================================================================================================================*/
export const depositWGSL = buffers => /*wgsl*/`
fn badFloat(x: f32) -> bool {
    let b = bitcast<u32>(x);
    return (b & 0x7f800000u) == 0x7f800000u;                         // inf or NaN
}
/* A NEGATIVE CHANNEL IS ALLOWED, negative LUMINANCE is not. A light given by a chromaticity outside
   the Rec.709 gamut (a royal-blue LED; core/colorimetry.js) is carried as its exact RGB, with a
   negative channel, and must be ADDED as it is: several such lights mixed to white are only white
   if their exact colours are summed -- clipping each deposit to the gamut first shifts the mix. The
   display clips, once per pixel (rendertoscreen.js gamutClip). What stays refused is what no light
   can be: a contribution whose luminance is below zero. */
fn badDeposit(c: vec3<f32>) -> bool {
    return badFloat(c.x) || badFloat(c.y) || badFloat(c.z) || dot(c, vec3<f32>(${LUMA.join(', ')})) < 0.0;
}
${buffers.map(buf => `
fn addF32_${buf}(i: u32, v: f32) {
    var old = atomicLoad(&${buf}[i]);
    loop {
        let r = atomicCompareExchangeWeak(&${buf}[i], old, bitcast<u32>(bitcast<f32>(old) + v));
        if (r.exchanged) { break; }
        old = r.old_value;
    }
}
fn deposit_${buf}(pix: u32, radiance: vec3<f32>, direct: bool) {
    if (badDeposit(radiance)) {
        atomicAdd(&counters.nonfinite, 1u);
        return;
    }
    var c = radiance;
    /* The optional firefly clamp, on LUMINANCE, scaling all three channels together. The old
       one clamped each channel to 1e4 separately, which changes the hue of whatever it touches:
       a white-hot caustic came out as whatever channel was least over. */
    if (UB.fireflyClamp > 0.0 && !direct) {
        // never below white: see the setting's note in uniforms.schema.js on why
        let cap = max(UB.fireflyClamp, 1.0) * UB.fireflyWhite;
        let y = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
        if (y > cap) { c = c * (cap / y); }
    }
    let base = pix * 4u;
    if (c.x != 0.0) { addF32_${buf}(base + 0u, c.x); }
    if (c.y != 0.0) { addF32_${buf}(base + 1u, c.y); }
    if (c.z != 0.0) { addF32_${buf}(base + 2u, c.z); }
}`).join('\n')}
`


//=====================================================================================
// Small prep kernels: compute dispatch-indirect args [x,y,z] from GPU-side counters
//=====================================================================================
const indirectCommon = /*wgsl*/`
fn groups_for(count: u32, wg: u32) -> u32 { return (count + wg - 1u) / wg; }
`;

export let prog_prep_march_indirect = async (WG, wgsize) =>
    await WG.makeCompute(indirectCommon,
        /*wgsl*/`
        let read0 = counters.readfrom == 0u;
        let inCount = select(
            atomicLoad(&counters.buf1count), // when read0 == false
            atomicLoad(&counters.buf0count), // when read0 == true
            read0
        );
        let gx = groups_for(inCount, ${wgsize}u);
        indirectOut[0u] = gx; // x
        indirectOut[1u] = 1u; // y
        indirectOut[2u] = 1u; // z
        `,
        {},
        { counters: counterstruct, indirectOut: 'array<u32>' },
        { wg: [1, 1, 1] }
    );

export let prog_prep_shade_indirect = async (WG, wgsize) =>
    await WG.makeCompute(indirectCommon,
        /*wgsl*/`
        let sc = atomicLoad(&counters.shadeCount);
        let gx = groups_for(sc, ${wgsize}u);
        indirectOut[0u] = gx; // x
        indirectOut[1u] = 1u; // y
        indirectOut[2u] = 1u; // z
        `,
        {},
        { counters: counterstruct, indirectOut: 'array<u32>' },
        { wg: [1, 1, 1] }
    );



export let prog_prep_occlude_indirect = async (WG, wgsize) =>
    await WG.makeCompute(indirectCommon,
        /*wgsl*/`
        let read0 = counters.readfrom == 0u;
        /* CLAMPED, and it is not belt and braces. The queue's appends bound-check the write
           but still increment the counter, so a frame that produces more shadow rays than the
           buffer holds leaves a count larger than the buffer. Sizing a dispatch from that
           unclamped reads off the end AND re-appends more than it consumed, so the count grows
           every iteration -- an unbounded dispatch inside one sample, which is a GPU hang, and
           a hung GPU process is a browser that disappears without an error message. */
        let raw = select(atomicLoad(&counters.shadow1count), atomicLoad(&counters.shadow0count), read0);
        let gx = groups_for(min(raw, counters.shadowcap), ${wgsize}u);
        indirectOut[0u] = gx; // x
        indirectOut[1u] = 1u; // y
        indirectOut[2u] = 1u; // z
        `,
        {},
        { counters: counterstruct, indirectOut: 'array<u32>' },
        { wg: [1, 1, 1] }
    );

/*===================================================================================================================
  THE WAVEFRONT LOG -- how many rays each iteration of a sample actually had, for measuring (R.wavefrontLog).
  Dispatched just before each flip while the log is on, never otherwise: one thread copies the counters as that
  iteration leaves them. The read side's count is still what the march took in, the write side's what goes on,
  shadeCount what was shaded, and the shadow queue's two sides what occlusion traced and what it hands on. The
  host turns them into those numbers (raytrace_main.js readWavefrontLog).

  Why it exists: a sample's iterations are not alike. The first marches every camera ray and photon; the last
  ones a few long paths -- glass, deep interiors -- through the same chain of dispatches. Whether that tail costs
  anything, and so whether keeping the wavefront full is worth building, is this log beside the kernel times of
  the same sample (kerneltime.js perIteration).
===================================================================================================================*/
export const WF_LOG_MAX = 256                     // iterations one log holds; past it the count still grows
export const WF_LOG_WORDS = 9                     // words per iteration
export let prog_wf_snap = async (WG) => await WG.makeCompute(``,
    /*wgsl*/`
    let k = atomicAdd(&wfLog[0], 1u);
    if (k >= ${WF_LOG_MAX}u) { return; }
    let o = 1u + k * ${WF_LOG_WORDS}u;
    atomicStore(&wfLog[o + 0u], counters.readfrom);
    atomicStore(&wfLog[o + 1u], atomicLoad(&counters.buf0count));
    atomicStore(&wfLog[o + 2u], atomicLoad(&counters.buf1count));
    atomicStore(&wfLog[o + 3u], atomicLoad(&counters.shadeCount));
    atomicStore(&wfLog[o + 4u], atomicLoad(&counters.shadow0count));
    atomicStore(&wfLog[o + 5u], atomicLoad(&counters.shadow1count));
    atomicStore(&wfLog[o + 6u], counters.shadowcap);
    atomicStore(&wfLog[o + 7u], atomicLoad(&counters.flushed));
    atomicStore(&wfLog[o + 8u], atomicLoad(&counters.shadowcut));
    `, {},
    { counters: counterstruct, wfLog: 'array<atomic<u32>>' },
    { wg: [1, 1, 1] }
);

/* THE SHADOW QUEUE'S OWN FLIP, for the last pass's extra occlusion rounds (raytrace_main.js THE LAST PASS'S SHADOW
   ROUNDS): the read side swapped and the new write side's shadow count cleared, as prog_flip does -- and nothing else.
   Not prog_flip itself, which also clears a ray buffer's count and the shade count and adds to `used`: the last pass's
   rays are still in their buffers then (the HUD's and the benchmark's readings, the wavefront log), and must be left
   as they were. R.trace dispatches these in PAIRS, so `readfrom` is back where it was before the iteration's own
   prog_wf_snap and prog_flip read it. */
export let prog_shadow_flip = async (WG) => await WG.makeCompute(``,
    /*wgsl*/`
    counters.readfrom = 1u - counters.readfrom;
    if (counters.readfrom == 0u) { atomicStore(&counters.shadow1count, 0u); }
    else { atomicStore(&counters.shadow0count, 0u); }
    `, {},
    { counters: counterstruct },
    { wg: [1, 1, 1] }
);

export let prog_flip = async (WG) => await WG.makeCompute(``,
    /*wgsl*/`
    counters.readfrom = 1u - counters.readfrom;
    atomicStore(&counters.shadeCount, 0u); 
    if (counters.readfrom == 0u) {              // next program will read from buffer0  so buf1 is the output and must be reset
        // what the NEXT march will read: if that is zero, every iteration after this one is
        // five dispatches over an empty buffer (the old adaptive budget existed to stop those)
        if (atomicLoad(&counters.buf0count) > 0u) { counters.used = counters.used + 1u; }
        atomicStore(&counters.buf1count, 0u);
        atomicStore(&counters.shadow1count, 0u);   // the shadow queue rides the same ping-pong
    }    
    else {
        if (atomicLoad(&counters.buf1count) > 0u) { counters.used = counters.used + 1u; }
        atomicStore(&counters.buf0count, 0u);   // next program will read from buffer1 so buf0 is the output and must be reset
        atomicStore(&counters.shadow0count, 0u);
    }      
    `, {},
    { counters: counterstruct },
    { wg: [1, 1, 1] }
);





/*===================================================================================================================
  RESOLVE — fold one sample's frame buffer into the accumulated picture.

  One invocation per PIXEL, run once per sample after the whole bounce chain has drained. That
  is what makes it safe to do a read-modify-write here at all: every racing writer has already
  finished, and no two invocations touch the same pixel. See THE PATH IS OVER in prog_shade for
  why the shade kernel cannot do this itself.

  The exponential moving average is the one this renderer has always used. Nothing ever clears
  the accumulation: after a reset the host passes a window of 0, so the first sample REPLACES
  each pixel it reaches and there is no black flash while it re-converges. (It used to pass 2,
  a re-weight that left bright spots from before a move visible for thousands of samples once
  light was in cd/m^2 -- see R.trace.) UB.maxaverages caps the window; the caller passes the
  running sample count, clamped.

  atomicExchange both reads the frame value and zeroes it for the next sample, so there is no
  separate clear pass and no buffer-wide clearBuffer between samples.
===================================================================================================================*/
/* `scene` unused: resolve, like genrays, genphotons and emit_collect, declares the BASE uniforms only, so its text is
   the same for every scene and a scene change never compiles it again (genrays.js says why, and what it asks of the
   callers) */
export let prog_resolve = async (WG, wgsize, scene = {}) =>
    await WG.makeCompute(``,
        /*wgsl*/`
        /* DISPATCHED 2D, and it has to be. This was run(w*h, 1, 1) over a flat pixel index,
           which is ceil(pixels/64) workgroups in x -- and maxComputeWorkgroupsPerDimension is
           65535 on effectively every adapter, so it ran out of x at 4,194,240 pixels. Under
           that ceiling: 1920x1080 and 2560x1440. Over it: 2048x2048 (by one workgroup), 4K,
           and a fit-to-panel render on a 4K monitor. Not a slowdown -- a validation error.
           One row per y instead, so x is ceil(w/64) and y is h. */
        if (gid.x >= UB.res.x || gid.y >= UB.res.y) { return; }
        let idx = gid.x + gid.y * UB.res.x;
        let base = idx * 4u;

        /* The light tracer's estimate for this pixel, taken and cleared FIRST -- before the
           early return below, or a pixel no camera path reached this sample would carry its
           splats into the next one. Dropping them for that sample is unbiased: whether a
           camera path landed here does not depend on what the photons did. */
        let lt = VEC3(bitcast<f32>(atomicExchange(&splat_u32[base + 0u], 0u)),
                      bitcast<f32>(atomicExchange(&splat_u32[base + 1u], 0u)),
                      bitcast<f32>(atomicExchange(&splat_u32[base + 2u], 0u)));

        /* take this sample's contributions and reset the slot in the same operation -- ALL
           FOUR WORDS, whatever the count says. This returned on n == 0 before reading the
           colour, so a shadow deposit that landed on a pixel whose camera path then did not
           count stayed in the frame buffer and was added to the NEXT sample's. f32 bits since
           the units change (DEPOSIT above), so nothing to divide by but the paths. */
        let n = atomicExchange(&frame_u32[base + 3u], 0u);
        let fr = VEC3(bitcast<f32>(atomicExchange(&frame_u32[base + 0u], 0u)),
                      bitcast<f32>(atomicExchange(&frame_u32[base + 1u], 0u)),
                      bitcast<f32>(atomicExchange(&frame_u32[base + 2u], 0u)));
        if (n == 0u) { return; }                       // no path landed on this pixel this sample
        /* camera paths are averaged over the n that landed; the light tracer's estimate is
           already one per sample and is added as it is */
        let s = fr / f32(n) + lt;

        // ... and fold it in as one EMA step, whatever landed on the pixel
        let prevn = f32(min(atomicLoad(&accumulation_u32[base + 3u]), UB.maxaverages));
        let cnt = prevn + 1.0;
        atomicStore(&accumulation_u32[base + 3u], u32(cnt));
        // signed: an exact colour outside the gamut has a negative channel (badDeposit above)
        let prev = clamp(VEC3(bitcast<f32>(atomicLoad(&accumulation_u32[base + 0u])),
                              bitcast<f32>(atomicLoad(&accumulation_u32[base + 1u])),
                              bitcast<f32>(atomicLoad(&accumulation_u32[base + 2u]))),
                         VEC3(-1e20), VEC3(1e20));
        let next = (prev * prevn + s) / cnt;
        atomicStore(&accumulation_u32[base + 0u], bitcast<u32>(next.x));
        atomicStore(&accumulation_u32[base + 1u], bitcast<u32>(next.y));
        atomicStore(&accumulation_u32[base + 2u], bitcast<u32>(next.z));

        /* THE ERROR BAR, kept beside the mean with the same weight w = 1/cnt. Two numbers per
           pixel: V, the weighted variance of this pixel's samples about their weighted mean, and
           S = the sum of w^2 over the samples still in the average. Updated as
             d = y - Yprev,   V <- (1-w)(V + w d^2),   S <- (1-w)^2 S + w^2
           (the exponentially weighted variance, Finch 2009 -- exact for any weights, and stable:
           M2 - mean^2 would cancel to nothing in f32 wherever the noise is small beside the
           mean). From them:
             variance of one sample   s^2 = V / (1 - S)
             standard error of Y      se  = sqrt(S s^2)
           S = 1/n for a true mean (maxaverages 0), and it settles near 1/(2N+1) for an EMA window
           of N -- the window's real sample count, which "N" is not. A reset needs nothing:
           prevn is 0 there, so w = 1, V = 0 and S = 1. Luminance only: it is what a meter reads. */
        let lw = VEC3(${LUMA.join(', ')});
        let y = dot(s, lw);
        let w = 1.0 / cnt;
        // zero at a reset: prev is then whatever was left (up to 1e20), d^2 overflows to inf,
        // and (1 - w) = 0 times inf is NaN
        let d = select(0.0, y - dot(prev, lw), prevn > 0.0);
        let v0 = clamp(moments[idx * 2u + 0u], 0.0, 1e38);
        let s0 = clamp(moments[idx * 2u + 1u], 0.0, 1.0);
        moments[idx * 2u + 0u] = (1.0 - w) * (v0 + w * d * d);
        moments[idx * 2u + 1u] = (1.0 - w) * (1.0 - w) * s0 + w * w;
        `,
        ComputeUniformTypes,                // the base only: no scene uniform (above)
        {
            frame_u32: 'array<atomic<u32>>',
            accumulation_u32: 'array<atomic<u32>>',
            splat_u32: 'array<atomic<u32>>',
            moments: 'array<f32>',              // per pixel {V, S}: the error bar (above)
        },
        { wg: [wgsize, 1, 1] }
    );


/*===================================================================================================================
  GENPHOTONS -- the light tracer's rays, appended after the camera rays in the same march buffer.

  Each photon is a direction w drawn uniformly from the solar cone and a crossing point q on the
  square of half-size ltHalf through the scene (THE EMISSION FRAME in sdf.js), and it starts
  back along its own line at the plane dot(p, s) = envRadius. Its flux is the disc radiance
  times what the draw stands for -- cos to the plane's normal, the cone's solid angle -- over
  the photon count and the AREA DENSITY q was drawn with.

  THE DENSITY IS LEARNED. q is not uniform: a row is drawn from the row CDF and a column from
  that row's conditional CDF, both out of ltCDF, which prog_lt_build rebuilds every few samples
  from how often photons from each cell ended in a camera connection. So photons pile up on the
  cells whose light goes through glass and lands in view, and the floor LT_FLOOR keeps every
  cell reachable. Whatever the map says, dividing by the density it was drawn with keeps the
  estimate unbiased; the map only decides the noise.

  Every photon counts itself into ltEmit for its cell, and carries the cell in `pix` -- a photon
  has no pixel -- so the shade kernel can credit the cell when the photon connects.

  Seeded with a trailing constant so no photon shares a random stream with the camera ray of
  the same index, which genrays seeds from the same UB.seed.
===================================================================================================================*/
const LT_SAMPLING = /*wgsl*/`
/* Binary search of one CDF segment of LT_GRID entries; the last entry is exactly 1. */
fn ltSearch(base: u32, u: f32) -> u32 {
    var lo = 0u;
    var hi = LT_GRID - 1u;
    loop {
        if (lo >= hi) { break; }
        let mid = (lo + hi) / 2u;
        if (u < ltCDF[base + mid]) { hi = mid; } else { lo = mid + 1u; }
    }
    return lo;
}
/* The probability MASS of entry i -- its step in the CDF. */
fn ltMass(base: u32, i: u32) -> f32 {
    var below = 0.0;
    if (i > 0u) { below = ltCDF[base + i - 1u]; }
    return max(ltCDF[base + i] - below, 0.0);
}
`
export let prog_genphotons = async (WG, wgsize, scene = {}) =>
    await WG.makeCompute(`${PRIMITIVES};${DEFINITIONS}${LT_SAMPLING}${EMIT_LIST}`,
        /*wgsl*/`
        /* THIS BATCH'S PHOTONS (core/photons.js planBatches): photonBatch of them after its rayBatch camera rays, the
           first emitBatch emitter probes. Each is divided by the SAMPLE's count (photoncount, emitPhotons), not the
           batch's: the batches' splats add up in one buffer and resolve takes them once. */
        let i = gid.x;
        if (i >= UB.photonBatch) { return; }
        SEED_uvec4(UB.seed); SEED_u32(i); SEED_u32(0x5A17u);

        /* EMITTER PROBES FIRST: indices below UB.emitBatch. A listed box by its probability,
           a direction w uniform on the sphere, a point uniform on the disc across the box's
           bounding sphere perpendicular to w -- a uniformly random line through that sphere --
           and the probe starts at the line's far end, heading back. See THE PROBE in
           tracebasics.js for how it becomes a photon, and why its flux is exact. */
        if (i < UB.emitBatch) {
            let up = PRNG();
            let up2 = PRNG();
            let K = emitCount();
            var probe = newRay(VEC3(0.0), VEC3(0.0, 0.0, 1.0), VEC4(1.0), 1.0);
            probe.tag = TAG_PROBE;
            probe.pix = 0xFFFFFFFFu;
            probe.tmax = -1.0;                                // finds nothing unless set below
            if (K > 0u) {
                let b = emitPick(up.x);
                let c = emitCentre(b);
                let rb = emitF(b, 3u);
                let z = 1.0 - 2.0 * up.y;
                let rz = sqrt(max(0.0, 1.0 - z * z));
                let phw = 2.0 * PI * up.z;
                let w = VEC3(rz * cos(phw), rz * sin(phw), z);
                var ta = VEC3(1.0, 0.0, 0.0);
                if (abs(w.x) > 0.9) { ta = VEC3(0.0, 1.0, 0.0); }
                let e1 = normalize(cross(ta, w));
                let e2 = cross(w, e1);
                let rho = rb * sqrt(up.w);
                let phd = 2.0 * PI * up2.x;
                let q = c + e1 * (rho * cos(phd)) + e2 * (rho * sin(phd));
                let hl = sqrt(max(rb * rb - rho * rho, 0.0));   // half the chord
                probe = newRay(q + w * hl, -w, VEC4(1.0), 1.0);
                probe.tag = TAG_PROBE;
                probe.pix = 0xFFFFFFFFu;
                probe.tmax = 2.0 * hl;
            }
            rayBuffer0[UB.rayBatch + i] = probe;
            return;
        }
        let sunCount = UB.photoncount - UB.emitPhotons;

        let frm = ltFrame();   // not F: that is a shorthand token for f32
        let s = frm[2];
        let u = PRNG();
        let u2 = PRNG();
        let w = sampleSunCone(u.xy);                      // towards the sun

        // the cell: a row from the row CDF (stored after the LT_CELLS column entries), then
        // a column from that row's conditional CDF
        let row = ltSearch(LT_CELLS, u.z);
        let col = ltSearch(row * LT_GRID, u.w);
        let pCell = ltMass(LT_CELLS, row) * ltMass(row * LT_GRID, col);
        let R = UB.ltHalf;                                 // engine units: ltRadius, capped at the radius
        let cellSize = 2.0 * R / f32(LT_GRID);
        let pdfArea = pCell / (cellSize * cellSize);       // per unit area of the square
        let x = -R + (f32(col) + u2.x) * cellSize;         // x along b1, y along b2 --
        let y = -R + (f32(row) + u2.y) * cellSize;         // ltPlaneCoords reads them back

        let cosW = max(dot(w, s), 1e-4);
        let q = frm[0] * x + frm[1] * y;
        let origin = q + w * ((UB.envRadius - dot(q, s)) / cosW);   // back along the line

        let flux = sunDiscRadiance(w) * cosW * sunSolidAngle()
                   / (f32(sunCount) * max(pdfArea, 1e-30));
        let cell = row * LT_GRID + col;
        atomicAdd(&ltEmit[cell], 1u);

        var ray = newRay(origin, -w, VEC4(1.0), 1.0);
        ray.radiance = flux;                               // a photon's radiance field is its flux
        ray.tag = TAG_PHOTON;
        ray.pix = cell;                                    // a photon's pix is its emission cell
        rayBuffer0[UB.rayBatch + i] = ray;
        `,
        ComputeUniformTypes,                // the base only, like resolve: no scene uniform (genrays.js)
        { rayBuffer0: 'array<Ray>', ltCDF: 'array<f32>', ltEmit: 'array<atomic<u32>>', learn: 'array<atomic<u32>>' },
        { wg: [wgsize, 1, 1] }
    );

/*===================================================================================================================
  LT BUILD -- turn what the photons learned into the density the next ones are drawn from.

  TWO KINDS OF BUFFER, AND THE SNAPSHOT CANNOT BE THE ACCUMULATOR. ltEmit and ltHit are written
  continuously (genphotons counts every photon a cell sends, shade counts every connection it
  makes); ltCDF is what genphotons samples from and must not move while a sample is being drawn,
  or the density a photon is divided by is not the density it came from. Guiding learned that the
  expensive way; this is the same arrangement. The host runs this between samples only.

  WHAT A CELL IS WORTH: connections per photon sent, hits / emitted. Not hits alone -- a cell the
  map already favours is sent more photons and would collect more hits for that reason only, and
  the map would then feed on itself. The ratio asks "how likely is a photon from here to be
  useful", which does not depend on how many were sent.

  AND IT FORGETS. Both counts are halved at every rebuild, so the map follows a moving sun, a
  moving camera and an edited scene within a few rebuilds, with no reset to get wrong.

  One workgroup of LT_GRID invocations, one per row: each sums and builds its own row's
  conditional CDF, then invocation 0 builds the row CDF. The mixture with the uniform floor is
  applied HERE, so the CDF and the pdf genphotons reads back come out of one computation.
===================================================================================================================*/
export let prog_lt_build = async (WG, scene = {}) =>
    /* ITS OWN THREE CONSTANTS, NOT ${DEFINITIONS}. It used to take DEFINITIONS for them, which
       also brought marchEps -- a helper that names UB. tinywebgpu, which decides what to bind by
       searching the text, then declared and bound the uniform buffer; layout:'auto', which keeps
       only what main can reach, left it out of the pipeline. The bind group was invalid, and
       with it every frame's command buffer, from the first sample with light tracing on.
       check-shaders now looks for exactly this (UNREACHABLE). */
    await WG.makeCompute(`
        const LT_GRID: u32 = ${LT_GRID_JS}u;
        const LT_CELLS: u32 = ${LT_CELLS_JS}u;
        const LT_FLOOR: f32 = ${LT_FLOOR_JS};
        var<workgroup> ltRowW: array<f32, LT_GRID>;
        var<workgroup> ltRowP: array<f32, LT_GRID>;
        var<workgroup> ltTotal: f32;`,
        /*wgsl*/`
        let r = lid.x;
        let base = r * LT_GRID;
        var sum = 0.0;
        for (var c = 0u; c < LT_GRID; c++) {
            let e = atomicLoad(&ltEmit[base + c]);
            let h = atomicLoad(&learn[base + c]);
            let w = select(0.0, f32(h) / f32(max(e, 1u)), e > 0u);
            ltCDF[base + c] = w;                          // scratch: the raw worth, for a moment
            sum += w;
            atomicStore(&ltEmit[base + c], e / 2u);       // forget half
            atomicStore(&learn[base + c], h / 2u);
        }
        ltRowW[r] = sum;
        workgroupBarrier();
        if (r == 0u) {
            var t = 0.0;
            for (var k = 0u; k < LT_GRID; k++) { t += ltRowW[k]; }
            ltTotal = t;
        }
        workgroupBarrier();
        let T = ltTotal;
        let learned = T > 0.0;
        let n = f32(LT_CELLS);
        let rowP = select(1.0 / f32(LT_GRID),
                          (1.0 - LT_FLOOR) * ltRowW[r] / max(T, 1e-30) + LT_FLOOR / f32(LT_GRID),
                          learned);
        ltRowP[r] = rowP;
        var acc = 0.0;
        for (var c = 0u; c < LT_GRID; c++) {
            let p = select(1.0 / n, (1.0 - LT_FLOOR) * ltCDF[base + c] / max(T, 1e-30) + LT_FLOOR / n, learned);
            acc += p;
            ltCDF[base + c] = acc / rowP;                 // conditional on the row
        }
        ltCDF[base + LT_GRID - 1u] = 1.0;                 // exact, not merely very close
        workgroupBarrier();
        if (r == 0u) {
            var racc = 0.0;
            for (var k = 0u; k < LT_GRID; k++) {
                racc += ltRowP[k];
                ltCDF[LT_CELLS + k] = racc;
            }
            ltCDF[LT_CELLS + LT_GRID - 1u] = 1.0;
        }
        `,
        {},                                               // no uniforms: see above
        { ltEmit: 'array<atomic<u32>>', learn: 'array<atomic<u32>>', ltCDF: 'array<f32>' },
        { wg: [LT_GRID_JS, 1, 1] }
    );



/*===================================================================================================================
  EMIT COLLECT / PUBLISH -- turn what camera paths discovered into the list NEE and the probes sample.

  COLLECT, one invocation per voxel of the emitter grid: a voxel with hits becomes a box -- the
  tight bounds of its hits, as a bounding sphere with a small margin -- scored by its brightest
  emission times its size squared (a proxy for power), appended to the scratch list. The hit
  count decays by a tenth each build (and the brightness with it), so an emitter no path sees any
  more fades out of the list and its voxel resets; one that is still hit stays.
  PUBLISH, one invocation: normalises the scores to probabilities, writes the CDF and the Crofton
  factor per box into the snapshot, and clears the scratch count for the next build.
  Between samples only, like prog_lt_build: a snapshot that moved inside a sample would make the
  density NEE drew from differ from the one a later bounce is weighted by.
  At most EMIT_MAX boxes; past that, voxels simply are not listed, and their emitters are counted
  by the paths that hit them, as before -- noisier, never wrong.
===================================================================================================================*/
const EMIT_CONSTS = () => `
const EG: u32 = ${EG_JS}u;
const EG_CELLS: u32 = ${EG_CELLS_JS}u;
const EMIT_MAX: u32 = ${EMIT_MAX_JS}u;
const EV_BASE: u32 = ${EV_BASE_JS}u;
const EL_TMP: u32 = ${EL_TMP_JS}u;
const EL_SNAP: u32 = ${EL_SNAP_JS}u;
const PI_E: f32 = 3.14159265359;
${LUM_CODE}`
export let prog_emit_collect = async (WG, scene = {}) =>
    // ...and the tolerances (EPS_WGSL), for the margin: only here -- prog_emit_publish binds no uniforms
    await WG.makeCompute(EMIT_CONSTS() + EPS_WGSL,
        /*wgsl*/`
        let cell = gid.x;
        if (cell >= EG_CELLS) { return; }
        let base = EV_BASE + cell * 8u;
        let w = atomicLoad(&learn[base + 6u]);
        let n = atomicLoad(&learn[base + 7u]);
        if (n == 0u) { return; }
        let n2 = n - n / 10u;
        // the brightness fades by the same tenth, in its log code (LUM_CODE): never below 1,
        // which would read as "never seen" while the voxel still has hits
        let w2 = max(w, LUM_DECAY + 1u) - LUM_DECAY;
        atomicStore(&learn[base + 6u], w2);
        atomicStore(&learn[base + 7u], n2);
        if (n2 == 0u) {                                 // faded out: forget its bounds too
            atomicStore(&learn[base + 0u], 0xFFFFFFFFu); atomicStore(&learn[base + 1u], 0xFFFFFFFFu);
            atomicStore(&learn[base + 2u], 0xFFFFFFFFu);
            atomicStore(&learn[base + 3u], 0u); atomicStore(&learn[base + 4u], 0u); atomicStore(&learn[base + 5u], 0u);
            return;
        }
        let R = UB.emitHalf;                              // engine units, as emitDeposit wrote them
        let mn = vec3<f32>(f32(atomicLoad(&learn[base + 0u])), f32(atomicLoad(&learn[base + 1u])),
                           f32(atomicLoad(&learn[base + 2u]))) / 16777215.0 * (2.0 * R) - vec3<f32>(R);
        let mx = vec3<f32>(f32(atomicLoad(&learn[base + 3u])), f32(atomicLoad(&learn[base + 4u])),
                           f32(atomicLoad(&learn[base + 5u]))) / 16777215.0 * (2.0 * R) - vec3<f32>(R);
        let c = (mn + mx) * 0.5;
        /* margin: the quantisation step, the march's hit distance, and a little of the size. The hit distance
           was a fixed 2 cm -- round a 1 cm emitter, a sphere four times its size, most of whose cone missed it.
           A hit is within one march tolerance of the surface, so the step off a surface covers it (0.9.1;
           UB.emitMargin, metres, puts a fixed one back for the bench) */
        let pad = select(offsetTol(c), UB.emitMargin, UB.emitMargin > 0.0);
        let r = length(mx - mn) * 0.5 * 1.05 + pad + 4.0 * (2.0 * R) / 16777215.0;
        let score = lumDecode(w2) * r * r;             // brightest emission x size^2 ~ power
        let slot = atomicAdd(&learn[EL_TMP], 1u);
        if (slot >= EMIT_MAX) { return; }
        let o = EL_TMP + 1u + slot * 8u;
        atomicStore(&learn[o + 0u], bitcast<u32>(c.x));
        atomicStore(&learn[o + 1u], bitcast<u32>(c.y));
        atomicStore(&learn[o + 2u], bitcast<u32>(c.z));
        atomicStore(&learn[o + 3u], bitcast<u32>(r));
        atomicStore(&learn[o + 4u], bitcast<u32>(score));
        `,
        ComputeUniformTypes,                // the base only, like resolve: no scene uniform (genrays.js)
        { learn: 'array<atomic<u32>>' },
        { wg: [64, 1, 1] }
    );
export let prog_emit_publish = async (WG) =>
    await WG.makeCompute(EMIT_CONSTS(),
        /*wgsl*/`
        let K = min(atomicLoad(&learn[EL_TMP]), EMIT_MAX);
        var tot = 0.0;
        for (var b = 0u; b < K; b++) { tot += bitcast<f32>(atomicLoad(&learn[EL_TMP + 1u + b * 8u + 4u])); }
        var acc = 0.0;
        for (var b = 0u; b < K; b++) {
            let t = EL_TMP + 1u + b * 8u;
            let o = EL_SNAP + 1u + b * 8u;
            let sc = bitcast<f32>(atomicLoad(&learn[t + 4u]));
            let P = select(1.0 / f32(max(K, 1u)), sc / tot, tot > 0.0);
            acc += P;
            let r = bitcast<f32>(atomicLoad(&learn[t + 3u]));
            atomicStore(&learn[o + 0u], atomicLoad(&learn[t + 0u]));
            atomicStore(&learn[o + 1u], atomicLoad(&learn[t + 1u]));
            atomicStore(&learn[o + 2u], atomicLoad(&learn[t + 2u]));
            atomicStore(&learn[o + 3u], bitcast<u32>(r));
            atomicStore(&learn[o + 4u], bitcast<u32>(P));
            atomicStore(&learn[o + 5u], bitcast<u32>(select(acc, 1.0, b + 1u == K)));   // exact 1 at the end
            atomicStore(&learn[o + 6u], bitcast<u32>(1.0 / (4.0 * PI_E * PI_E * r * r)));
        }
        atomicStore(&learn[EL_SNAP], K);
        atomicStore(&learn[EL_TMP], 0u);
        `,
        {},
        { learn: 'array<atomic<u32>>' },
        { wg: [1, 1, 1] }
    );

export let prog_march = async (WG, scene, wgsize, { stepCache = 0 } = {}) =>
    /* GEOMETRY ONLY, like the occlusion pass below. Marching calls SDF and moveBy and nothing
       else -- it does not shade, so it has no use for the BSDF model or the light sampling
       that now comes with it. It was compiling all of it anyway, which is pure compile time
       on every material-model switch and, on a software adapter, the difference between a
       page that boots and a GPU process that dies. */
    await WG.makeCompute(`${SCENE_PRELUDE}${sceneConstantsWGSL(scene)}${scene.wgsl}${stepCache ? stepCacheWGSL(stepCache) : ''}`,
        /*wgsl*/`
            // administration, indices and counters-------------------------------------------------
            let rayindex=gid.x;
            let read0 = counters.readfrom == 0u;
            let inCount = select(               // !! select order is counterintuitive!  select(whenfalse, whentrue, condition)
                atomicLoad(&counters.buf1count),   // when read0 == false
                atomicLoad(&counters.buf0count),   // when read0 == true
                read0
            );
            if (rayindex >= inCount) {return;} // geen werk voor deze thread
            var ray: Ray;
            if ( read0 ) {ray = marchBuffer0[rayindex];} else {ray = marchBuffer1[rayindex];}
            
            SEED_uvec4(UB.seed);
            SEED_u32(rayindex); // use pixel index and bounce count to seed RNG
            SEED_u32(ray.steps);
            //--------------------------------------------------------------------------------------------------------

            
            var ea: FLOAT;          // absolute distance to closest surface
            var d = 0.0;            // travel distance
            
            let lmax = 1000.0;                       // maximum distance to trace
            const MAX_STEPS: u32 = 32u;                      // maximum steps per march

            // hit is declared out here so the flush below can reuse the last one the loop
            // computed instead of paying for another SDF evaluation. MAX_STEPS >= 1, so it is
            // always assigned by the time anything reads it.
            var hit: Hit;
            /* NOT UNROLLED (noUnroll, tracebasics.js): this bound was a constant so the compiler
               would unroll it, which put 32 copies of the scene in this kernel. */
            for (var i:u32 = 0u; i < noUnroll(MAX_STEPS); i++) {
                ${stepCache ? /*wgsl*/`/* THE STEP CACHE (stepCacheWGSL, filled before the trace): a ball that holds the ray far
                   enough moves it with no SDF. Never on the pass's last iteration: the loop has to end on the ray's own
                   SDF, whose hit the flush below hands to shade. */
                if (i + 1u < MAX_STEPS) {
                    let sc = scStep(ray.pos, ray.dir);
                    if (sc > 0.0) {
                        ray.steps += 1;
                        ray = moveBy(ray, ray.dir * (sc * UB.stepscale));
                        continue;
                    }
                }` : ''}
                hit = sceneAt(ray, false);                                  // the scene there (Hit)
                ea = abs(hit.s.w);
                /* THE HIT TEST'S TOLERANCE HERE, AT THIS STEP (0.36.0): the setting, never finer than what f32 can
                   resolve at this point (marchTol, tracebasics.js ENGINE_UNITS_WGSL) -- the same number the scene was
                   just given as its own (sceneAt, SCN_TOL), so its culling agrees with this test */
                let eps = marchTol(ray.pos);
                if ((ray.ltot > lmax) || (ray.steps > UB.maxiter)) {hit.r.state = RAY_MAXITER  ;}// if we reached the maximum distance or steps, we set the ray state to MAXITER                                    
                /* LEFT THE SCENE. Outside the environment radius and still heading outward,
                   so nothing is ahead but the sky. Shade turns this into envRadiance.

                   This replaces a sphere of the same radius that every scene declared as its
                   first piece of geometry, with a reserved MAT_SKY material whose shading
                   returned the sky. A predicate is strictly cheaper than that dome was: the
                   dome was an sdSphere plus an add_new in EVERY SDF evaluation -- 32 of them
                   per march iteration per ray, in all three kernels -- and this is two dots
                   once per step.

                   NOT ray.ltot: that accumulates across bounces and is only reset when a ray
                   is created, so a long path inside the scene would be declared escaped and
                   handed sky light it never saw. The test has to be about WHERE the ray is,
                   not how far it has gone. */
                if (dot(ray.pos, ray.dir) > 0.0 && dot(ray.pos, ray.pos) > UB.envRadius * UB.envRadius) {
                    hit.r.state = RAY_ESCAPED;
                }
                if (ea < eps || hit.r.state == RAY_MAXITER || hit.r.state == RAY_ESCAPED) {   // hit a surface, ran out, or left
                    var pos = atomicAdd(&counters.shadeCount, 1u);          // increment shading counter
                    shadeBuffer[pos].hit = hit;                           // the hit, for the surface kernel and shade
                    return;
                }
                ray.steps += 1;                                             // increment steps
                d = ea * UB.stepscale;                                      // scale distance to travel by distance to surface
                ray = moveBy(ray, ray.dir * d);                              // move forward
            }
            
            if (ray.state == RAY_ACTIVE) {                      // ray is still active
                /* THE FLUSH.  On the last wavefront iteration of a sample nothing will march
                   this ray again, so writing it back to the ping-pong buffer would simply
                   lose it: the next sample overwrites the buffer and the radiance the ray had
                   already gathered never reaches the accumulator. That is an energy leak, and
                   it is silent -- the picture is just darker than it should be, most visibly
                   in scenes with long paths, which are exactly the ones that run out of
                   iterations. So the last pass terminates its survivors instead and hands
                   them to shade, which accumulates what they have. Same treatment a ray that
                   exhausts UB.maxiter already gets, for the same reason.
                   This is also what makes the iteration budget in raytrace_main.js a genuine
                   quality/speed dial rather than a correctness cliff: lowering it now costs
                   convergence in the long-path corners instead of quietly stealing light. */
                if (UB.lastpass != 0u) {
                    ray.state = RAY_MAXITER;
                    hit.r = ray;
                    var pos = atomicAdd(&counters.shadeCount, 1u);
                    shadeBuffer[pos].hit = hit;
                    // the budget was too small for this ray: counted, for the HUD and the benchmark
                    atomicAdd(&counters.flushed, 1u);
                } else if (read0) {
                    var rpos = atomicAdd(&counters.buf1count, 1u);
                    marchBuffer1[rpos] = ray;
                } else {                        
                    var rpos = atomicAdd(&counters.buf0count, 1u);
                    marchBuffer0[rpos] = ray;
                }
            }
            //--------------------------------------------------------------------------------------------------------------          
            `,
        computeUniformTypes(scene.uniforms),
        {
            marchBuffer0: 'array<Ray>',                 // marchinbg buffer 0
            marchBuffer1: 'array<Ray>',                 // marching buffer 1
            shadeBuffer: 'array<ShadeItem>',           // the shade queue: the hit, and room for the scene's answers
            counters: counterstruct,
            // stepCacheWGSL's cells, when it is compiled in: read-only, filled before the trace
            ...(stepCache ? { stepCache: 'read array<u32>' } : {}),
            ...(scene.resources || {}),                // whatever GPU state the scene owns
        }
        , {
            /* OFF-THREAD, and it is not an optimisation. createComputePipeline hands the
               module to the driver and BLOCKS the calling thread until it comes back
               compiled -- tinywebgpu says so in makePipeline's header, "seconds to a minute
               in which the page cannot paint". The scene's SDF is inlined here, its loop
               bounds are constants so that the compiler CAN unroll them, and that SDF is
               called from a 32-step march loop whose bound is also a constant. Raise the
               Menger iteration count and the unrolled size grows faster than the number
               does; compiled synchronously, that is a frozen tab with no error in it -- not
               a hang, just a browser doing arithmetic where it cannot also draw.
               `ready` is what the builder awaits instead. */
            async: true,
            wg: [wgsize, 1, 1],
        }
    );








/*===================================================================================================================
  THE SURFACE KERNEL (0.20.8): everything shade asks the scene, asked here, between the march and shade, and left beside
  each hit in the shade queue (scene_api.js Surface, ShadeItem) -- so shade holds no scene, compiles once, and a scene
  change compiles this instead of it. On the optics bench, measured in node from the kernels' text (inlined, the
  defines expanded, as the build sizes them): shade's 356 000 characters became this kernel's 252 000 and shade's own
  113 000 (roadmap/ARCHITECTURE.md, step 2).
  THE QUESTIONS, IN ONE LOOP WITH ONE SDF CALL AND ONE getMaterial2 CALL (0.20.6: every call is a whole copy of the
  scene once the compiler inlines it), asked as shade asked them, with the same arguments:
    the normal: the SDF's own if it gives one, else three differences (calcNormals_fast's), a trip each;
    the material of the hit as the path will shade it (pathFacing; a probe's hit as it is) -- and where it reads its
      object's own point, a trip that captures that point first (localPoint is GIVEN here, scene_api.js) and asks again;
    the medium beyond, where the material asks it (asksMedium; probeAsksMedium): the SDF a hair across the surface,
      then its material, from inside.
  Asked for every hit shade will shade, and only those: an escaped ray, one out of steps or a probe that has run out
  asks nothing. The medium is asked wherever shade MIGHT read it -- a seek ray, an emitter that ends the path and the
  illuminance view's first hit decide not to in shade -- because an answer shade does not read costs only time, and
  one it reads that was not asked would be wrong. The scene draws no random numbers (materials.js hashes its own),
  so where a question is asked moves nothing in the sample.
  AND THE LIGHTS' FACES, for shade's light sampling: one invocation copies the scene's faces into the learn buffer
  (tracebasics.js FACE_TABLE) every iteration, before shade reads them. Uniforms move a light between frames; within
  one, every copy is the same.
===================================================================================================================*/
export let prog_surface = async (WG, scene, wgsize) => {
    const faces = lightFaceCount(scene)
    if (faces > FACE_MAX) throw new Error(`this scene has ${faces} lights; the renderer's light table holds ${FACE_MAX} (tracebasics.js FACE_MAX)`)
    return await WG.makeCompute(`${SCENE_PRELUDE_GIVEN}${sceneConstantsWGSL(scene)}${scene.wgsl}${FACE_TABLE_WRITE}${LENS_WGSL}${MANIFOLD_SHARED_WGSL}${MANIFOLD_WGSL}`,
        /*wgsl*/`
            let i = gid.x;
            if (i >= atomicLoad(&counters.shadeCount)) { return; }
            if (i == 0u) { writeFaceTable(); }
            let hit = shadeBuffer[i].hit;
            let probe = (hit.r.tag & TAG_PROBE) != 0u;
            if (select(hit.r.state != RAY_ACTIVE, probeEnds(hit.r), probe)) { return; }   // shade asks it nothing

            const Q_MATERIAL: u32 = 3u;     // trips 0-2 are the normal's differences
            const Q_CAPTURE: u32 = 4u;
            const Q_MEDIUM: u32 = 5u;
            const Q_DONE: u32 = 6u;
            /* THE MANIFOLD CONNECTION'S WALK (0.44.0; manifold.js MANIFOLD_WGSL), after the hit's own questions, for a
               photon at D inside glass: its trips look through this loop's one look, so the scene is in the kernel once */
            const Q_MANIFOLD: u32 = 7u;
            var mfAsked = false;
            var mfOff = VEC3(0.0);          // the camera point's offset from camPos: a point of the lens, or none
            var sf: Surface;
            var q = 0u;
            var g = VEC3(0.0);
            var face: Facing;               // the hit as the material question takes it
            var asked = hit;                // the Hit the material question is about
            var beyond = false;             // ...asked from inside: the medium beyond
            var mediumFrom = hit.r;         // the medium question: a hair from this ray's point...
            var mediumDir = VEC3(0.0);      // ...this way
            if (length(hit.s.xyz) > 0.0 && UB.fastnormals > 0) { sf.nrm = hit.s.xyz; q = Q_MATERIAL; }
            for (var trip = 0u; trip < noUnroll(8u + MF_TRIPS + 2u); trip++) {
                /* THE NORMAL KNOWN (q is Q_MATERIAL once, on the trip after it): the hit as shade will shade it --
                   a probe's as it is, a path's as pathPrelude leaves it, or none if the path is leaving the surface */
                if (q == Q_MATERIAL) {
                    if (probe) { face.res = hit; }
                    else { face = pathFacing(hit, sf.nrm); if (face.leaving) { break; } }
                    asked = face.res;
                }
                if (q == Q_DONE) {
                    /* ...then, once, the manifold's walk -- if this is a photon it is for, on a surface with a lobe a
                       connection evaluates (manifold.js; shade connects by the same manifoldOn and manifoldPhoton) */
                    if (mfAsked || probe || !manifoldOn()) { break; }
                    mfAsked = true;
                    let r = face.res.r;
                    let m = sf.m;
                    let evalLobe = (1.0 - m.metallic) * (1.0 - m.transmission) > 0.0 || m.roughness > 0.05;
                    if (!manifoldPhoton(r) || !evalLobe || max(m.emissive.x, max(m.emissive.y, m.emissive.z)) > 0.0) { break; }
                    if (UB.camLens.x > 0.0) {               // a point of the lens, drawn as ltConnect draws one (lens.js)
                        SEED_uvec4(UB.seed); SEED_u32(i); SEED_u32(hit.r.steps); SEED_u32(0x4d464c44u);
                        mfOff = lensDisc(UB.invView[0].xyz, UB.invView[1].xyz, UB.camLens.x, PRNG().xy);
                    }
                    mfBegin(UB.camPos.xyz + mfOff, r.pos, face.nrm, r.n, marchTol(r.pos));
                    q = Q_MANIFOLD;
                }
                // THE ONE LOOK AT THE SCENE: a difference for the normal, the capture, a hair beyond, or the manifold's
                var at = hit.r;
                var look = true;
                if (q < 3u) { at.pos = hit.r.pos + VEC3(f32(q == 0u), f32(q == 1u), f32(q == 2u)) * normalTol(hit.r.pos); }
                else if (q == Q_CAPTURE) { at = asked.r; }
                else if (q == Q_MEDIUM) { at = mediumFrom; at.pos = at.pos + mediumDir * offsetTol(mediumFrom.pos) * 2.0; }
                else if (q == Q_MANIFOLD) { let lk = mfLook(); look = lk.w > 0.5; at.pos = lk.xyz; at.dir = MF.md; }
                else { look = false; }
                var h = asked;
                if (look) { h = sceneAt(at, q == Q_CAPTURE); }      // the capture on its own trip (sceneAt, scene_api.js)
                if (q == Q_MANIFOLD) {
                    mfTake(h.s.w, look);
                    if (MF.phase == MF_OK || MF.phase == MF_FAIL) { break; }
                    continue;
                }
                if (q < 3u) {
                    g[q] = h.s.w - hit.s.w;
                    q = q + 1u;
                    if (q == 3u) { sf.nrm = normalize(g); }
                    continue;
                }
                if (q == Q_MEDIUM) { asked = h; beyond = true; LOCAL_READY = false; }
                // THE ONE MATERIAL QUESTION
                LOCAL_WANTED = false;
                let m = materialAt(asked, beyond);
                if (LOCAL_WANTED && !LOCAL_READY) { q = Q_CAPTURE; continue; }    // its own point first, then again
                if (beyond) {
                    sf.n1 = m.ior;
                    sf.mu1 = mediumMu(m);               // what the medium beyond absorbs (0.37.0)
                    sf.v1 = m.abbe;                     // ...and how it disperses (0.40.0)
                    q = Q_DONE;
                } else {
                    sf.m = m;
                    /* the medium, where shade may read it: from the hit as the material saw it, beyond the surface
                       (pathMiddle: against the turned normal) or, for a probe's emitter, back out (probeMiddle) */
                    let ask = select(asksMedium(m), probeAsksMedium(asked, sf.nrm, m), probe);
                    mediumFrom = asked.r;
                    mediumDir = select(-face.nrm, sf.nrm, probe);
                    q = select(Q_DONE, Q_MEDIUM, ask);
                }
            }
            sf.mf = mfAnswer(mfOff);                // zero unless the walk ended in MF_OK
            shadeBuffer[i].sf = sf;
        `,
        computeUniformTypes(scene.uniforms),
        {
            shadeBuffer: 'array<ShadeItem>',
            counters: counterstruct,
            learn: 'array<atomic<u32>>',               // the lights' faces, for shade (FACE_TABLE)
            ...(scene.resources || {}),
        },
        { async: true, wg: [wgsize, 1, 1] }            // off-thread: it holds the scene (prog_march says why)
    )
}

/*===================================================================================================================
  THE PHOTON MAP'S KERNEL (0.60.0; core/sppm.js says what and why): between the surface kernel and shade, over the same
  hits. A photon that has passed glass or a mirror is STORED where it lands; a camera ray that has seen only glass or
  mirrors since the eye GATHERS the stored photons round where it lands, into its radiance, which shade carries on to the
  path's deposit. A sample's photons all run before its camera rays (photons.js planBatches's `first`), so a gather
  reads this sample's map, whole. Its own kernel because shade is at the eight-storage-binding floor; no scene in it
  (the material is the surface kernel's answer), so it compiles once, like shade. Built only while the setting is on
  (raytrace_main.js kernelOptionsOf), so off it is not in the frame at all.
  THE MEDIUM'S ABSORPTION on the last leg is not yet on the ray here -- shade applies it on arrival (absorbAlong) -- so
  both halves apply it themselves (rayTransmittance). A GATHER IN A MEDIUM is over n^2: the photons' density gives the
  radiance in the glass, and the camera's refractions weigh by T alone (their n^2 left out, the path's ends both in air),
  so what the camera may carry is the radiance over n^2 -- what the manifold connection's 1/n^2 is (manifold.js), and
  test/sppm.test.mjs plants its absence.
===================================================================================================================*/
export let prog_sppm = async (WG, scene, wgsize) =>
    await WG.makeCompute(`${SHADE_PRELUDE}${PROCESSOR}${FACE_TABLE}${PROCESSING}${SPPM_WGSL}`,
        /*wgsl*/`
            let i = gid.x;
            if (i >= atomicLoad(&counters.shadeCount)) { return; }
            if (!sppmOn()) { return; }
            let hit = shadeBuffer[i].hit;
            let r = hit.r;
            if (r.state != RAY_ACTIVE || (r.tag & TAG_PROBE) != 0u) { return; }
            let sf = shadeBuffer[i].sf;
            let face = pathFacing(hit, sf.nrm);       // the side the ray is on, as shade will take it
            if (face.leaving) { return; }
            let m = sf.m;                              // ...and the material asked of the hit so taken
            if (max3(m.emissive) > 0.0 || !sppmEvaluable(m)) { return; }
            let luma = VEC3(0.2126, 0.7152, 0.0722);
            if ((r.tag & TAG_PHOTON) != 0u) {
                if (!sppmStores(r)) { return; }
                let power = r.radiance * r.beta * rayTransmittance(r);
                if (dot(power, luma) <= 0.0) { return; }
                sppmStore(r, face.nrm, power);
                return;
            }
            if (!sppmGathers(r)) { return; }
            let L = sppmGather(r, face.nrm, m) / (r.n * r.n);
            if (dot(L, luma) == 0.0) { return; }
            shadeBuffer[i].hit.r.radiance = r.radiance + r.beta * rayTransmittance(r) * L;
        `,
        ComputeUniformTypes,                           // the base uniforms: no scene's (prog_shade's header)
        {
            shadeBuffer: 'array<ShadeItem>',           // the hits and the surface kernel's answers
            counters: counterstruct,
            learn: 'array<atomic<u32>>',               // the BSDF's albedo tables (microfacet.js), past LEARN_WORDS
            sppmHeads: 'array<atomic<u32>>',           // the count, the gathers cut short, then a head a list (sppm.js)
            sppmRecs: 'array<u32>',                    // the photons' records
        },
        { async: true, wg: [wgsize, 1, 1] }
    );

//===================================================================================================================
// wavefront shading program
// processes the rays in the shading buffer
// if the ray is still active, it is written to the marching buffer
// if the ray is not active, it is accumulated in the accumulation buffer
//===================================================================================================================

/* NO SCENE IN IT (0.20.8): the scene's answers come beside the hit (prog_surface), the lights' faces from the table it
   wrote (FACE_TABLE). Its text is the same for every scene -- `scene` is not read; it is a parameter so every wavefront
   kernel is made alike -- and its uniforms are the base ones (ComputeUniformTypes), so a scene change finds it in the
   pipeline cache. */
export let prog_shade = async (WG, scene, wgsize) =>
    await WG.makeCompute(`${SHADE_PRELUDE}${PROCESSOR}${FACE_TABLE}${PROCESSING}${depositWGSL(['frame_u32'])}`,
            /*wgsl*/`
                // administration, indices and counters-------------------------------------------------
                let rayindex=gid.x;                 // let: constant
                let shadeCount = atomicLoad(&counters.shadeCount);
                if (rayindex >=  shadeCount) { return; } // guard for out-of-range threads
                var hit = shadeBuffer[rayindex].hit;    // read hit from shading buffer
                /* THE MEDIUM'S ABSORPTION SINCE IT WAS LAST APPLIED (tracebasics.js absorbAlong), on arrival and
                   before anything reads beta: the sky an escaped ray sees, an emitter's glow, a bounce's weight and
                   its light sampling. Every ray that left a medium boundary does so through here, so every leg is
                   counted once, whatever number of march passes it took. 1 in air: mu is 0 there. */
                hit.r = absorbAlong(hit.r);
                var ray = hit.r;                // ray stored inside Hit

                SEED_uvec4(UB.seed);
                SEED_u32(rayindex); // use pixel index and bounce count to seed RNG
                SEED_u32(ray.steps);
                //--------------------------------------------------------------------------------------------------------

                /* THE ENVIRONMENT, and it belongs to the renderer rather than to the scene.
                   An escaped ray gets exactly what the MAT_SKY dome used to give it through
                   the material path -- beta * skyLuminance(dir, sunmis), the MIS weight
                   included, so a sun sampled by NEE is still not counted twice. The
                   difference is that no scene has to declare a dome to make it happen, and
                   the occlusion kernel no longer has to know a material id to tell "reached
                   the sky" from "hit something". */
                let isPhoton = (ray.tag & (TAG_PHOTON | TAG_PROBE)) != 0u;   // light-side rays
                let probe = (ray.tag & TAG_PROBE) != 0u;
                /* A PHOTON THROUGH THE LENS on the segment it arrived by (materials_pbr.js lensHit), before anything moves it */
                if (ray.state == RAY_ACTIVE || ray.state == RAY_ESCAPED) { lensHit(ray, ray.state == RAY_ESCAPED); }
                var st: Shading;                          // zero: nothing to shade, nothing asked
                var shaded = false;
                if (probe) {
                    st = probeBegin(hit);                 // may come back as a photon (probeEnd)
                    shaded = true;
                } else if (ray.state == RAY_ESCAPED) {
                    /* A photon that leaves has nothing to give: it only ever contributes
                       through a camera connection. A camera path in the light tracer's class
                       gets the sky but NOT the disc -- the disc along that path is exactly
                       what the photons deliver (LIGHT TRACING in materials_pbr.js). */
                    if (!isPhoton) {
                        /* ...nor a path armed for the lens (lens.js): its disc is the sun photons' through the lens */
                        let ltOwned = UB.lt != 0u
                                      && ((ray.tag & (CLS_CAND | CLS_SPEC)) == (CLS_CAND | CLS_SPEC) || lensOwned(ray.tag))
                                      && ltCovers(ray.pos, ray.dir);   // see THE EMISSION FRAME, sdf.js
                        let env = select(skyLuminance(ray.dir, ray.sunmis),
                                         skyRadiance(ray.dir) * ray.sunmis, ltOwned);
                        /* the illuminance view: a camera ray that hit nothing has no surface to
                           measure on, and the sky's radiance is not an illuminance -- it shows 0 */
                        let noSurface = UB.measureMode == 1u && ray.bounces == 0u;
                        ray.radiance += ray.beta * select(env, VEC3(0.0), noSurface);
                    }
                } else if (ray.state == RAY_ACTIVE) {
                    st = pathBegin(hit);                  // the path's hit: processMaterial, in phases
                    shaded = true;
                }
                /* THE SCENE'S ANSWERS, beside the hit (prog_surface asked them, with these phases' own arguments):
                   the normal, then which side the path is on (pathPrelude), the material, the path's or the probe's
                   middle, the medium beyond if that asks, the end. In the order the questions were asked here before
                   0.20.8, each answer where its question was. */
                if (st.go) {
                    let sf = shadeBuffer[rayindex].sf;
                    st.nrm = sf.nrm;
                    if (!probe) { st = pathPrelude(st); }
                    if (st.go) {
                        st.m = sf.m;
                        st.mf = sf.mf;
                        if (probe) { st = probeMiddle(st); } else { st = pathMiddle(st); }
                        if (st.go && st.askMedium) { st.n1 = sf.n1; st.mu1 = sf.mu1; st.v1 = sf.v1; }
                    }
                }
                if (st.go) { if (probe) { st.ray = probeEnd(st); } else { st.ray = pathEnd(st); } }
                if (shaded) { ray = st.ray; }       // pathEnd may change the ray state

                /* The shadow ray the material asked for, if it asked for one. It goes into the
                   side of the queue this iteration is WRITING, same as a bounced ray, so the
                   flip hands it to the next iteration's occlusion pass. Capped at raycount:
                   the queue also carries last iteration's survivors, so the two producers
                   together could in principle outrun a buffer sized for one. Dropping past the
                   cap loses a little light in a pathological frame, which is the right failure
                   next to writing off the end of a buffer. */
                if (NEE_VALID) {
                    let sread0 = counters.readfrom == 0u;
                    if (sread0) {
                        let sp = atomicAdd(&counters.shadow1count, 1u);
                        if (sp < counters.shadowcap) { shadowBuffer1[sp] = NEE_RAY; }
                    } else {
                        let sp = atomicAdd(&counters.shadow0count, 1u);
                        if (sp < counters.shadowcap) { shadowBuffer0[sp] = NEE_RAY; }
                    }
                }
                // ...and a photon's crossing of the lens, the same way (lensHit; a second ray, under the same cap)
                if (LENS_VALID) {
                    if (counters.readfrom == 0u) {
                        let sp = atomicAdd(&counters.shadow1count, 1u);
                        if (sp < counters.shadowcap) { shadowBuffer1[sp] = LENS_RAY; }
                    } else {
                        let sp = atomicAdd(&counters.shadow0count, 1u);
                        if (sp < counters.shadowcap) { shadowBuffer0[sp] = LENS_RAY; }
                    }
                }

                //--------------------------------------------------------------------------------------------------------------
                // ray has been processed, is still active, write to marching buffer
                if (ray.state == RAY_ACTIVE) {
                     let read0 = counters.readfrom == 0u;
                     if (!read0) {         // reading from buffer1 -> write to buffer0
                         var rpos=atomicAdd(&counters.buf0count, 1u);
                        marchBuffer0[rpos] = ray;
                    } else {
                         var rpos=atomicAdd(&counters.buf1count, 1u);
                        marchBuffer1[rpos] = ray;
                    }
                }
                //--------------------------------------------------------------------------------------------------------------
                // write to accumulation buffer
                /*--------------------------------------------------------------------------
                  THE PATH IS OVER: hand its radiance to the frame buffer, not to the picture.

                  This used to fold the sample straight into the accumulation as an
                  exponential moving average, with atomicLoad -> arithmetic -> atomicStore on
                  four separate words. That is not an atomic read-modify-write: two paths
                  landing on one pixel lose an update, and the count word can be read between
                  another invocation's load and store, so the EMA weights go wrong as well as
                  the sum. One ray per pixel hid it. More than one does not, and neither does
                  any renderer that puts several contributions on a pixel per sample -- a
                  next-event-estimation build puts a shadow contribution and a bounce
                  contribution on the same pixel every bounce.

                  So the terminal write is an atomicAdd into a per-sample FRAME buffer
                  (f32 by compare-and-swap, plus a count: DEPOSIT at the top), which is race-free by
                  construction because addition commutes. prog_resolve then folds that frame
                  into the EMA once per sample, one invocation per pixel, where there is no
                  race left to lose. The EMA itself is unchanged -- same weighting, same
                  "never clear, just re-weight" behaviour a camera move relies on.

                  It also fixes the weighting the race was hiding: a pixel that happened to
                  terminate three paths in one sample used to take three EMA steps and count
                  triple. One sample is now one step, whatever landed on it.
                --------------------------------------------------------------------------*/
                else {
                    // a photon (or probe) is not a camera path: no pixel, no count -- its light
                    // went out through its connections, and its radiance field is flux
                    if (isPhoton) { return; }
                    /* The path counts even when its radiance is refused: it was a sample, and
                       leaving it out of the count would weight the pixel toward the paths that
                       happened to come out finite. It used to return before counting. */
                    /* SEEN DIRECTLY -- the sky with no surface on the way (bounces 0), or an
                       emitter as the first hit (bounces counts that hit, so 1) -- is exempt from
                       the firefly clamp: a camera path deposits once, the one emission it ended
                       on, so this is exactly the light the camera looks at. */
                    let direct = (ray.state == RAY_ESCAPED && ray.bounces == 0u)
                                 || (ray.state == RAY_SOURCE && ray.bounces == 1u);
                    deposit_frame_u32(ray.pix, ray.radiance, direct);
                    atomicAdd(&frame_u32[ray.pix * 4u + 3u], 1u);
                //--------------------------------------------------------------------------------------------------------------
                }

            `,
        ComputeUniformTypes,                           // the base uniforms: no scene's (prog_shade's header)
        {
            marchBuffer0: 'array<Ray>',                 // marchinbg buffer 0
            marchBuffer1: 'array<Ray>',                 // marching buffer 1
            shadeBuffer: 'array<ShadeItem>',           // the hits, and the scene's answers (prog_surface)
            frame_u32: 'array<atomic<u32>>',           // THIS SAMPLE's contributions, f32 bits
            shadowBuffer0: 'array<Ray>',               // occlusion queue, ping
            shadowBuffer1: 'array<Ray>',               // occlusion queue, pong
            learn: 'array<atomic<u32>>',               // photon connections, emitter discovery/list, the lights' faces (LEARN_WORDS)
            counters: counterstruct,
        }
        , {
            /* OFF-THREAD, and it is not an optimisation. createComputePipeline hands the
               module to the driver and BLOCKS the calling thread until it comes back
               compiled -- tinywebgpu says so in makePipeline's header, "seconds to a minute
               in which the page cannot paint". It held the scene until 0.20.8 and is still the
               BSDF and the light sampling, the largest text left without one. */
            async: true,
            wg: [wgsize, 1, 1],
        }
    );

/*===================================================================================================================
  THE OCCLUSION PASS -- the other half of next-event estimation.

  A shadow ray is not a path. It carries a contribution that has already been computed and asks
  one question: is anything in the way? So it never shades, never bounces and never needs a Hit
  record; it either dies against geometry or reaches the sky and deposits. That is why it is a
  separate kernel and a separate queue rather than a flag on the march: giving it the shade
  kernel's machinery would cost the machinery and use none of it.

  It rides the same ping-pong and the same readfrom as the rays, so a shadow ray that needs more
  than one 32-step chunk is simply picked up by the next iteration, exactly like a march
  survivor. The budget that sizes the chain therefore sizes this too.

  REACHING THE LIGHT IS THE SUCCESS CONDITION, and it now means what it sounds like: nothing was
  in the way. It used to mean "hit the dome", because the sky was real geometry with a reserved
  material id, which made this the one place a visibility query knew the scene's material enum --
  and the first thing the scene contract would have had to name. The dome is gone, so a surface
  hit blocks and running past lmax reaches. A shadow ray's ltot is reset when it is created, so
  unlike the march kernel this one can read that exit as "travelled its full length through
  nothing".

  The deposit does NOT touch the count word. That word counts PATHS, and resolve divides by it;
  a shadow ray is a second contribution to a path that will report itself when it terminates.
===================================================================================================================*/
export let prog_occlude = async (WG, scene, wgsize, { stepCache = 0 } = {}) =>
    /* GEOMETRY ONLY -- no ${PROCESSOR}, no ${PROCESSING}. A visibility query needs the SDF and
       nothing else: no processMaterial, no BSDF sampling, no light sampling. Including them
       made this a fourth full scene kernel to compile, and compile time grows faster than
       linearly with inlining depth -- pulled in whole, this kernel took the software adapter
       from booting to killing the browser outright.
       The scene only needs MATERIALS (makeDiffuse, makeMirror and friends, in SCENE_PRELUDE) to answer
       getMaterial2; the BSDF model (materials_pbr.js) is not in that path. */
    await WG.makeCompute(`${SCENE_PRELUDE_GIVEN}${sceneConstantsWGSL(scene)}${scene.wgsl}${depositWGSL(['frame_u32', 'splat_u32'])}${stepCache ? stepCacheWGSL(stepCache) : ''}`,
        /*wgsl*/`
            let i = gid.x;
            let read0 = counters.readfrom == 0u;
            let raw = select(atomicLoad(&counters.shadow1count),
                             atomicLoad(&counters.shadow0count), read0);
            if (i >= min(raw, counters.shadowcap)) { return; }   // see CLAMPED in prep_occlude
            var ray: Ray;
            if (read0) { ray = shadowBuffer0[i]; } else { ray = shadowBuffer1[i]; }

            /* 32 steps a dispatch on every pass, the last included: what every dispatch has always had, so none
               marches further than before under Windows's 2 s limit for a submission (TDR). A version that let
               the last pass march up to maxiter + 1 steps in one dispatch was running when the user's page lost
               its GPU (DXGI_ERROR_DEVICE_HUNG, a heavy scene, 2026-10-03; not established as the cause). The last
               pass's shadow rays still get to the end: R.trace gives it extra rounds of this kernel, each of
               these steps (THE LAST PASS'S SHADOW ROUNDS, raytrace_main.js). OCCLUDE_STEPS is the count, shared
               with R.trace's arithmetic so the two cannot disagree. */
            const MAX_STEPS: u32 = ${OCCLUDE_STEPS}u;
            let lmax = 1000.0;
            var blocked = false;
            var reached = false;
            var cut = false;                      // out of steps (maxiter): counted in shadowcut, below
            let isConn = (ray.tag & TAG_CONN) != 0u;
            /* ...and LIGHT SAMPLING TOWARDS A LIGHT'S FACE (TAG_FNEE, PLAN.md L7) ends at the point
               it aims at, short of the face's own sheet, as a connection ends at the camera; what it
               carries goes into the frame, as any light sampling's does. */
            let stopsAt = isConn || (ray.tag & TAG_FNEE) != 0u;
            /* AN EMITTER SHADOW RAY does not ask "is anything in the way" but "what is the first
               thing here, and what does it emit" -- so it stops at the first surface like any
               other, and then asks the scene's material. The scene's getMaterial2 was already
               compiled in here for SDF's sake; this is its first caller in this kernel. */
            let isEmit = (ray.tag & TAG_EMIT) != 0u;
            var emitted = VEC3(0.0);
            /* THE EMITTER'S OWN POINT, ON A TRIP OF THIS LOOP'S ONE SDF CALL: a material that reads it asks localPoint,
               which is GIVEN here (scene_api.js), so the hit is looked at once more, capturing, and the material asked
               again -- where it ran the SDF inside getMaterial2, a second copy of the scene in this kernel. That trip is
               one more than the steps, never one of them: a hit on the last step that asks for its point would
               otherwise leave the loop neither blocked nor reached, and on the last round be deposited as unshadowed. */
            var capture = false;
            for (var k: u32 = 0u; k < noUnroll(MAX_STEPS + 1u); k++) {      // not unrolled: see prog_march
                if (k == MAX_STEPS && !capture) { break; }
                /* A CAMERA CONNECTION ENDS AT THE CAMERA. Tested before the surface test, so
                   geometry behind the eye cannot block it -- which, with every other shadow ray
                   running until it leaves the scene, it otherwise would. */
                if (stopsAt && ray.ltot >= ray.tmax) { reached = true; break; }
                ${stepCache ? /*wgsl*/`/* THE STEP CACHE (stepCacheWGSL, prog_march): a ball that holds the ray far enough moves it
                   with no SDF -- never past where a connection ends, as the step below. Not on a capture's trip, which
                   asks the hit's own point again. */
                if (!capture) {
                    let sc = scStep(ray.pos, ray.dir);
                    if (sc > 0.0) {
                        ray.steps += 1u;
                        if (ray.ltot > lmax || ray.steps > UB.maxiter) { reached = true; cut = ray.steps > UB.maxiter; break; }
                        var cstep = sc * UB.stepscale;
                        if (stopsAt) { cstep = min(cstep, max(ray.tmax - ray.ltot, 0.0) + 1e-4); }
                        ray = moveBy(ray, ray.dir * cstep);
                        continue;
                    }
                }` : ''}
                let h = sceneAt(ray, capture);   // capturing on its trip (scene_api.js)
                let ea = abs(h.s.w);
                let eps = marchTol(ray.pos);       // here, at this step (prog_march says why)
                /* Any surface blocks. It used to read "if h.m == MAT_SKY then reached
                   else blocked", because the sky was real geometry and so "unoccluded" had to mean
                   "hit the dome" rather than "hit nothing" -- the one place a visibility query
                   knew the scene's material enum. With the dome gone a hit is a hit, and
                   reaching the light is the ltot/maxiter exit below: a shadow ray's ltot IS
                   reset when it is created (materials_pbr.js), so for this kernel, unlike the
                   march, running past lmax genuinely means nothing was in the way. */
                if (ea < eps) {
                    if (isEmit) {
                        LOCAL_WANTED = false;
                        let m = materialAt(h, false);
                        if (LOCAL_WANTED && !LOCAL_READY) { capture = true; continue; }   // the same point, capturing
                        emitted = m.emissive;
                    }
                    blocked = true; break;
                }
                /* Same definition of "left the scene" the march kernel uses, and for the same
                   reason it is worth having here: the dome used to end a shadow ray at 400
                   units, and without a stand-in the only exit left is lmax at 1000 -- two and
                   a half times the marching for every unoccluded shadow ray. Checked after
                   the surface test, so geometry near the boundary still blocks. */
                if (dot(ray.pos, ray.dir) > 0.0 && dot(ray.pos, ray.pos) > UB.envRadius * UB.envRadius) {
                    reached = true; break;
                }
                ray.steps += 1u;
                if (ray.ltot > lmax || ray.steps > UB.maxiter) { reached = true; cut = ray.steps > UB.maxiter; break; }
                // never step past the camera: the next iteration's test must see it
                var stepLen = ea * UB.stepscale;
                if (stopsAt) { stepLen = min(stepLen, max(ray.tmax - ray.ltot, 0.0) + 1e-4); }
                ray = moveBy(ray, ray.dir * stepLen);
            }

            /* THROUGH THE MEDIUM IT TRAVELLED IN (tracebasics.js rayTransmittance): a shadow ray carries what it will
               deposit, from a vertex in that medium (materials_pbr.js NEE_RAY, ltConnect). Applied to what it carries and
               marked applied (absLtot), so one queued for another round (below) is not absorbed twice; 1 in air. */
            ray.radiance = ray.radiance * rayTransmittance(ray);
            ray.absLtot = ray.ltot;
            if (isEmit && blocked) {
                // it hit something: count what that emits, if anything
                if (max(emitted.x, max(emitted.y, emitted.z)) <= 0.0) { return; }
                deposit_frame_u32(ray.pix, ray.radiance * emitted, false);
                return;
            }
            if (blocked) { return; }              // in shadow: the contribution is simply dropped
            if (!reached) {
                /* Out of steps for this round: queued for the next one. UB.lastpass is 1 only for the
                   last pass's LAST round (R.trace), which comes after enough rounds for any ray to end
                   by maxiter, so nothing should get here then; if one does, nothing would march it
                   again, so it is counted below and deposited rather than lost -- the same call THE
                   FLUSH makes in the march kernel, and for the same reason: a budget that runs out
                   should cost convergence, not light. */
                if (UB.lastpass == 0u) {
                    if (read0) {
                        let sp = atomicAdd(&counters.shadow1count, 1u);
                        if (sp < counters.shadowcap) { shadowBuffer1[sp] = ray; }
                    } else {
                        let sp = atomicAdd(&counters.shadow0count, 1u);
                        if (sp < counters.shadowcap) { shadowBuffer0[sp] = ray; }
                    }
                    return;
                }
            }
            /* NOT ENDED BY A SURFACE OR BY ITS LIGHT, BUT CUT SHORT: out of maxiter. (Still marching on the last
               pass was the other way, until the last pass got its rounds, 0.10.0.) What follows
               counts it as unoccluded (an emitter ray as finding nothing), so it is counted -- how many there are
               says whether that rule can move the picture. Counting them occluded instead would bias dark: a
               separate decision, not taken. */
            if (cut || !reached) { atomicAdd(&counters.shadowcut, 1u); }
            // an emitter ray that escaped, or ran out of maxiter, found no emitter
            if (isEmit) { return; }

            /* A connection goes to the SPLAT buffer, not the frame buffer: resolve divides the
               frame buffer by the number of camera paths on the pixel, and a photon's estimate
               is already per sample -- it must be added once, not averaged with the paths. */
            if (isConn) {
                deposit_splat_u32(ray.pix, ray.radiance, false);
                /* The fourth word counts connections and is NEVER taken by resolve, so it
                   builds up over the render: a map of which pixels light tracing reaches.
                   imageStats measures noise inside it, because image-wide noise cannot see a
                   caustic that covers a few percent of the view. Cleared with the picture. */
                atomicAdd(&splat_u32[ray.pix * 4u + 3u], 1u);
                return;
            }
            deposit_frame_u32(ray.pix, ray.radiance, false);
            `,
        computeUniformTypes(scene.uniforms),
        {
            shadowBuffer0: 'array<Ray>',
            shadowBuffer1: 'array<Ray>',
            frame_u32: 'array<atomic<u32>>',
            splat_u32: 'array<atomic<u32>>',          // light tracing's camera connections
            counters: counterstruct,
            // stepCacheWGSL's cells, when it is compiled in: read-only, filled before the trace
            ...(stepCache ? { stepCache: 'read array<u32>' } : {}),
            ...(scene.resources || {}),
        }
        , {
            /* OFF-THREAD, and it is not an optimisation. createComputePipeline hands the
               module to the driver and BLOCKS the calling thread until it comes back
               compiled -- tinywebgpu says so in makePipeline's header, "seconds to a minute
               in which the page cannot paint". The scene's SDF is inlined here, its loop
               bounds are constants so that the compiler CAN unroll them, and that SDF is
               called from a 32-step march loop whose bound is also a constant. Raise the
               Menger iteration count and the unrolled size grows faster than the number
               does; compiled synchronously, that is a frozen tab with no error in it -- not
               a hang, just a browser doing arithmetic where it cannot also draw.
               `ready` is what the builder awaits instead. */
            async: true,
            wg: [wgsize, 1, 1],
        }
    );

/*===================================================================================================================
  SKY NORMALISATION -- how bright the scattering model is, measured rather than assumed.

  The sky's shape comes from skyRadianceRaw (sdf.js); its magnitude is a setting, UB.skyIlluminance,
  the lux it puts on a horizontal surface. This kernel measures what the raw model delivers,
      E_raw = integral over the upper hemisphere of Y(L_raw) cos(theta) d(omega)
            = pi * E[ Y(L_raw(d)) ]   with d cosine-distributed,
  on a stratified 128 x 128 grid, and the host sets UB.skyScale = skyIlluminance / E_raw.

  ON THE GPU, calling the same function the tracer calls, rather than as a JS copy of the sky.
  Two copies of a model are two models the first time one of them is edited; this way there is
  one, and a change to it is measured the next frame. The cost is a readback, awaited before a
  frame that needs it (R.ensureSky), and only when a field the sky reads has changed.

  The disc is not included: it is a separate light with its own setting, and the sky measured
  here is exactly what skyRadiance returns, which is everything except the disc.

  One workgroup, 256 threads, 64 directions each, then a tree reduction in workgroup memory.
===================================================================================================================*/
export let prog_skynorm = async (WG) =>
    await WG.makeCompute(`${SKY}
var<workgroup> skyPart: array<f32, 256>;
`,
        /*wgsl*/`
        let t = lid.x;
        var acc = 0.0;
        for (var k = 0u; k < 64u; k = k + 1u) {
            let i = t * 64u + k;                                   // 0 .. 16383
            let u = (vec2<f32>(f32(i % 128u), f32(i / 128u)) + 0.5) / 128.0;
            let r = sqrt(u.x);
            let phi = 2.0 * PI * u.y;
            let d = VEC3(r * cos(phi), r * sin(phi), sqrt(max(0.0, 1.0 - u.x)));
            acc = acc + dot(skyRadianceRaw(d), LUMA_709);
        }
        skyPart[t] = acc;
        workgroupBarrier();
        for (var s = 128u; s > 0u; s = s >> 1u) {
            if (t < s) { skyPart[t] = skyPart[t] + skyPart[t + s]; }
            workgroupBarrier();
        }
        if (t == 0u) { skyOut[0] = PI * skyPart[0] / 16384.0; }
        `,
        computeUniformTypes({}),
        { skyOut: 'array<f32>' },
        { wg: [256, 1, 1] }
    );
