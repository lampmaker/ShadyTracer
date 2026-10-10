//======================================================================================================================
// AUTO-EXPOSURE -- meter the picture on the GPU, the way a camera's meter would, and never read it back.
//
// WHY A HISTOGRAM OF LOG LUMINANCE, and not of pixel values. The accumulation holds cd/m^2
// (core/photometry.js), so the question "how bright is this scene" has an answer before anything
// is displayed -- no feedback loop through clipped pixels, and the result does not depend on the
// exposure it is about to set. A path tracer's picture is heavy-tailed on purpose: a visible sun is
// 1.6e9 cd/m^2 and a caustic can be anything, so a plain mean is dragged wherever the brightest
// handful of pixels go. The histogram lets both tails be cut: the middle AE_LOW..AE_HIGH of the
// pixels, averaged in log space, is the "average scene luminance" the meter is calibrated for.
//
// TWO KERNELS, both inside the frame, after resolve and before the display pass:
//   histogram  one invocation per pixel; a workgroup-local histogram, flushed to aeHist with one
//              atomic per non-empty bin, so contention is per workgroup, not per pixel.
//   update     one invocation. Reads aeHist, clears it for the next frame, computes the target EV
//              and eases aeState.ev towards it -- the display reads aeState, so nothing crosses to
//              the CPU on the way to the screen. The host reads aeState back only for the HUD,
//              never awaited.
//
// EASED, NOT JUMPED, except the very first time. The picture is progressive: right after a move it
// is one noisy sample, and a meter that followed every frame exactly would make the exposure
// shimmer with the noise. aeSpeed is the share of the gap closed per frame.
//======================================================================================================================
import { LUMA, EXPOSURE_WGSL, EV_CLIP } from './photometry.js'

export const AE_BINS = 128
/* log2 cd/m^2 the histogram spans: 2^-10 (1e-3, a moonless night) to 2^34 (1.7e10, above the
   sun's disc). 44 stops over 128 bins, about a third of a stop each. Outside is clamped into the
   end bins -- the tails are cut anyway. */
export const AE_LOG_MIN = -10
export const AE_LOG_MAX = 34
/* The share of pixels, darkest first, below and above which the average ignores them. The low cut
   drops deep shadow and black background; the high cut the sun, speculars and fireflies. */
export const AE_LOW = 0.10
export const AE_HIGH = 0.90
/* HIGHLIGHT PROTECTION: the luminance at this quantile may sit at most UB.aeHeadroom stops above
   white. An average meter exposes a lamp-lit room for its dim corners -- a large area of little
   light (a 1 lx sky on the ground, the far walls) outvotes the small bright part, and everything
   the lamp reaches blows out. Cameras answer with highlight-weighted metering; this is the same
   idea as a limit: the exposure is the average's, or darker if the bright 5% would clip by more
   than the headroom. It never brightens. */
export const AE_PROTECT = 0.95

const CONSTS = `
const AE_BINS: u32 = ${AE_BINS}u;
const AE_LOG_MIN: f32 = ${AE_LOG_MIN}.0;
const AE_LOG_MAX: f32 = ${AE_LOG_MAX}.0;
`

/** Bytes of the two buffers the host allocates. aeState: ev, initialised, pad, pad. */
export const AE_HIST_BYTES = AE_BINS * 4
export const AE_STATE_BYTES = 16

export let prog_ae_histogram = async (WG) =>
    await WG.makeCompute(`${CONSTS}
var<workgroup> aeLocal: array<atomic<u32>, ${AE_BINS}>;
`,
        /*wgsl*/`
        let li = lid.x + lid.y * 16u;
        if (li < AE_BINS) { atomicStore(&aeLocal[li], 0u); }
        workgroupBarrier();

        /* NO EARLY RETURN before the barriers: every invocation of the workgroup has to reach
           them, so an out-of-range or unsampled pixel simply does not vote. */
        if (gid.x < UB.res.x && gid.y < UB.res.y) {
            let base = (gid.x + gid.y * UB.res.x) * 4u;
            if (atomicLoad(&accumulation_u32[base + 3u]) > 0u) {           // sampled at least once
                let c = vec3<f32>(bitcast<f32>(atomicLoad(&accumulation_u32[base + 0u])),
                                  bitcast<f32>(atomicLoad(&accumulation_u32[base + 1u])),
                                  bitcast<f32>(atomicLoad(&accumulation_u32[base + 2u])));
                let Y = dot(c, vec3<f32>(${LUMA.join(', ')}));
                /* BLACK DOES NOT VOTE. Below the histogram's floor (1e-3 cd/m^2) a pixel is not a
                   dark part of the scene but no scene at all: the void behind an object, a sky
                   that is switched off. It used to count in the darkest bin, and a scene lit only
                   by its own emitter -- more than half of it black (the emitters bench's median
                   is 0) -- then metered at the floor whenever the black passed the low cut, and
                   the exposure blew out whatever was lit. The meter now averages what light
                   there is. */
                if (Y >= exp2(AE_LOG_MIN)) {
                    let t = (log2(Y) - AE_LOG_MIN) / (AE_LOG_MAX - AE_LOG_MIN);
                    let bin = u32(clamp(t * f32(AE_BINS), 0.0, f32(AE_BINS - 1u)));
                    atomicAdd(&aeLocal[bin], 1u);
                }
            }
        }
        workgroupBarrier();
        if (li < AE_BINS) {
            let n = atomicLoad(&aeLocal[li]);
            if (n > 0u) { atomicAdd(&aeHist[li], n); }
        }
        `,
        { res: 'vec2<u32>' },
        { accumulation_u32: 'array<atomic<u32>>', aeHist: 'array<atomic<u32>>' },
        { wg: [16, 16, 1] }
    )

export let prog_ae_update = async (WG) =>
    await WG.makeCompute(`${CONSTS}${EXPOSURE_WGSL}
const EV_CLIP: f32 = ${EV_CLIP};
const AE_LOW: f32 = ${AE_LOW};
const AE_HIGH: f32 = ${AE_HIGH};
const AE_PROTECT: f32 = ${AE_PROTECT};
`,
        /*wgsl*/`
        if (gid.x != 0u) { return; }
        var total = 0u;
        for (var i = 0u; i < AE_BINS; i++) { total += atomicLoad(&aeHist[i]); }
        if (total == 0u) { return; }                     // nothing sampled yet: keep what we have

        /* The trimmed log-average: walk the bins darkest first, keep the part of each that lies
           between the AE_LOW and AE_HIGH quantiles -- partial bins partially -- and average the
           bin centres in log2, weighted by what was kept. */
        let lo = AE_LOW * f32(total);
        let hi = AE_HIGH * f32(total);
        let w = (AE_LOG_MAX - AE_LOG_MIN) / f32(AE_BINS);
        let q = AE_PROTECT * f32(total);
        var below = 0.0;
        var kept = 0.0;
        var acc = 0.0;
        var logHi = AE_LOG_MAX;
        var foundHi = false;
        for (var i = 0u; i < AE_BINS; i++) {
            let n = f32(atomicLoad(&aeHist[i]));
            let a = max(below, lo);
            let b = min(below + n, hi);
            if (b > a) {
                kept += b - a;
                acc += (b - a) * (AE_LOG_MIN + (f32(i) + 0.5) * w);
            }
            // the protected quantile, placed within its bin by where the count crosses it
            if (!foundHi && n > 0.0 && below + n >= q) {
                logHi = AE_LOG_MIN + (f32(i) + clamp((q - below) / n, 0.0, 1.0)) * w;
                foundHi = true;
            }
            below += n;
            atomicStore(&aeHist[i], 0u);                  // ready for the next frame
        }
        let logL = acc / max(kept, 1e-9);
        /* the average's EV, or darker: the EV at which the protected quantile lands aeHeadroom
           stops above white, white being the luminance that clips, EV_CLIP * 2^EV (photometry.js) */
        let evHi = logHi - log2(EV_CLIP) - max(UB.aeHeadroom, 0.0);
        let evTarget = max(meterEV100(exp2(logL)), evHi);

        // first time: jump; afterwards: ease, so a noisy frame does not make the exposure shimmer
        let first = aeState[1] == 0.0;
        let ev = select(mix(aeState[0], evTarget, clamp(UB.aeSpeed, 0.0, 1.0)), evTarget, first);
        aeState[0] = ev;
        aeState[1] = 1.0;
        `,
        { aeSpeed: 'f32', aeHeadroom: 'f32' },
        { aeHist: 'array<atomic<u32>>', aeState: 'array<f32>' },
        { wg: [1, 1, 1] }
    )
