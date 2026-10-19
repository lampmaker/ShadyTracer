//======================================================================================================================
// TIMING, MODELLED -- chapter 25's figures run this. Pure.
//
// The engine times each kernel by a pair of GPU timestamps around its compute pass (core/kerneltime.js), and reads
// them back with `tally` and `perIteration`. No figure here runs a GPU, so the passes are a MODEL: one sample of the
// flat world run as a wavefront (kit/wavefront.js), its counts turned into times by the costs below, the passes laid
// end to end with a gap between each, and their timestamps made the way a card's are, in nanoseconds, rounded down to
// the browser's tick when asked. What the engine's own functions then read from them is real; the times are not.
//
// And DRIFT, modelled too: the same code read 184.7, 184.8, 216.6 and 255.5 ms on the user's Pascal card over one
// evening (docs/PERFORMANCE_REVIEW.md); `driftTrials` draws comparisons of two builds under a run-to-run factor of that
// spread, either in separate runs or interleaved in one.
//======================================================================================================================

import { rng } from './flatland.js'

/* THE MODEL'S COSTS, in ms: chosen so a sample is tens of ms with its first iterations' march the biggest pass, as the
   measured samples are (chapter 22: the Noise library's march 102.8 of 184.7 ms). A model's numbers, not a measurement. */
export const COST = {
    launch: 0.004,          // any pass, however little it does
    marchStep: 0.004,       // a lane-step of the march: a group's slowest ray sets it (chapter 21)
    surface: 0.001,         // a hit's scene answers
    shade: 0.002,           // a hit shaded
    shadow: 0.0025,         // a shadow ray traced
    gap: 0.002,             // between two passes: launching the next, its barrier
}

/** One sample's compute passes in the engine's order (raytrace_main.js R.trace): genrays, then for each iteration
 *  prep_march, march, prep_shade, surface, shade, prep_occlude, occlude, flip, then resolve. `run` is
 *  kit/wavefront.js wavefrontRun's result; each pass { name, ms }. The march's time is its groups' slowest rays'
 *  steps, lanes in groups of `width` (the occupied lane-steps of chapter 21), since a group is as slow as its slowest. */
export function modelPasses(run, width = 32) {
    const P = [{ name: 'genrays', ms: COST.launch + 0.0005 * run.paths.length }]
    for (const l of run.iters) {
        let lanes = 0
        for (let g = 0; g < l.steps.length; g += width) lanes += Math.max(0, ...l.steps.slice(g, g + width))
        P.push({ name: 'prep_march', ms: COST.launch },
            { name: 'march', ms: COST.launch + COST.marchStep * lanes },
            { name: 'prep_shade', ms: COST.launch },
            { name: 'surface', ms: COST.launch + COST.surface * l.shading },
            { name: 'shade', ms: COST.launch + COST.shade * l.shading },
            { name: 'prep_occlude', ms: COST.launch },
            { name: 'occlude', ms: COST.launch + COST.shadow * l.shadowsTraced },
            { name: 'flip', ms: COST.launch })
    }
    P.push({ name: 'resolve', ms: COST.launch + 0.0003 * run.img.length })
    return P
}

/** The passes' timestamp pairs as a card writes them: ns, as BigUint64, each pass starting `gap` ms after the last
 *  ended, every stamp rounded DOWN to `tickUs` microseconds (0: not rounded) -- a browser's quantization. */
export function timestamps(passes, { gap = COST.gap, tickUs = 0 } = {}) {
    const t = new BigUint64Array(2 * passes.length), tick = BigInt(Math.round(tickUs * 1000))
    let now = 1e6                                       // 1 ms in, in ns
    const q = ns => { const v = BigInt(Math.round(ns)); return tick > 0n ? (v / tick) * tick : v }
    passes.forEach((p, k) => { t[2 * k] = q(now); now += p.ms * 1e6; t[2 * k + 1] = q(now); now += gap * 1e6 })
    return t
}

/* DRIFT. The four readings of one fingerprint over an evening (docs/PERFORMANCE_REVIEW.md, the card's speed drifts):
   their spread, as a share of their mean, is the model's run-to-run factor; within one run, rows next to each other
   read about 1-2% apart (a row repeated: +0.38%, 1.3% in later runs, docs/PERFORMANCE.md), the model's 1.5%. */
export const DRIFT_READINGS = [184.7, 184.8, 216.6, 255.5]
const mean = a => a.reduce((s, v) => s + v, 0) / a.length
export const driftSpread = (a = DRIFT_READINGS) => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)) / m }
export const WITHIN = 0.015

/** `n` comparisons of build A against build B, B truly `diff` faster (0.1: 10% less time). 'separate': each build
 *  timed in a run of its own, each run's speed its own factor; 'interleaved': A, B, A, B in one run, sharing it.
 *  Returns each comparison's measured change of B against A (negative: B faster). */
export function driftTrials(diff, mode, { n = 40, seed = 1, between = driftSpread(), within = WITHIN } = {}) {
    const R = rng(seed), normal = () => { const u = Math.max(1e-12, R()), v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
    const out = []
    for (let k = 0; k < n; k++) {
        if (mode === 'separate') {
            const a = Math.exp(between * normal()) * (1 + within * normal()), b = (1 - diff) * Math.exp(between * normal()) * (1 + within * normal())
            out.push(b / a - 1)
        } else {
            const run = Math.exp(between * normal()), A = [], B = []
            for (let r = 0; r < 2; r++) { A.push(run * (1 + within * normal())); B.push(run * (1 - diff) * (1 + within * normal())) }
            out.push(mean(B) / mean(A) - 1)
        }
    }
    return out
}
