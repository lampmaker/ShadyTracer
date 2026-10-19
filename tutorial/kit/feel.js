//======================================================================================================================
// FEELING FAST -- chapter 28's figures run this. Pure.
//
//   THE GOVERNOR  lib/render-loop.js's rule for how many samples a frame traces, mirrored: it calls
//                 requestAnimationFrame and performance.now itself, so a page cannot drive it; the test drives the
//                 real one with those stubbed and holds this mirror to it. Beside it, the rule its comment says it
//                 replaced: steps of 0.1, a deadband of one frame a second, a floor guard that floating point walked
//                 through. Frames modelled as a fixed cost plus the samples' (a model, not a measurement).
//   A MOVE        the real lib/pathtracer/interaction.js on a clock run by hand, and quality.js effective(): which mode
//                 each frame of a drag traces in.
//   A HEAVY SAMPLE the live loop's slicing and the frame's submissions, the rules of raytrace_main.js R.trace with its
//                 constants copied (the module reaches GPU code; the test holds the copies to its exports).
//   IN FLIGHT     lib/pathtracer/samples.js runSamples' rule on a clock: one sample waited for before the next is
//                 recorded, or two.
//======================================================================================================================

import { makeInteraction } from '../../lib/pathtracer/interaction.js'
import { effective, MODE } from '../../lib/pathtracer/quality.js'

/* THE GOVERNOR, as render-loop.js LOOP writes it: the loop's rate is the time since its last call; above 1.15 x minfps the
   count grows by 3%, below 0.9 x it shrinks by 3%, held to 1..maxSamples; the frame traces floor(count). */
export const governNow = (count, fps, { minfps = 20, maxSamples = 64 } = {}) =>
    fps > minfps * 1.15 ? Math.min(maxSamples, count * 1.03) : fps < minfps * 0.9 ? Math.max(1, count / 1.03) : count
/* THE RULE BEFORE, as the comment describes it: absolute steps of 0.1, a deadband of +-1 fps round the target, and
   `count > 1` as the floor guard (which floating point walked through, to a floor of 0). A reconstruction from the
   comment: the code itself is not in the repository's history, which starts at 0.46.0. */
export const governBefore = (count, fps, { minfps = 20, maxSamples = 64 } = {}) =>
    fps > minfps + 1 ? Math.min(maxSamples, count + 0.1) : fps < minfps - 1 && count > 1 ? count - 0.1 : count

/** `frames` frames of a loop whose frame takes `overheadMs` plus `sampleMs` a sample, the loop's rate the last frame's:
 *  [{ count, spp, ms, fps }] */
export function governor({ sampleMs = 20, overheadMs = 5, frames = 240, rule = 'now', start = 3, minfps = 20, maxSamples = 64 } = {}) {
    const step = rule === 'now' ? governNow : governBefore, out = []
    let count = start, lastMs = 1000 / 60                 // the first frame's interval: a browser's 60 a second
    for (let k = 0; k < frames; k++) {
        const fps = 1000 / lastMs
        count = step(count, fps, { minfps, maxSamples })
        const spp = Math.floor(count), ms = overheadMs + spp * sampleMs
        out.push({ count, spp, ms, fps })
        lastMs = ms
    }
    return out
}

/* A DRAG: the camera moved from `from` to `to` ms, a poke every frame (16 ms), held still without letting go from
   `pauseAt` to `pauseTo` with the button down when `held`. The real makeInteraction on a hand-run clock: each frame
   asks active() and traces in effective()'s mode. */
export function dragTimeline({ from = 300, to = 1700, pauseAt = 700, pauseTo = 1300, held = true, moveFast = 1, moveMode = MODE.DRAFT, renderMode = MODE.FULL, until = 2600, idleMs = 400 } = {}) {
    let now = 0
    const timers = []
    const I = makeInteraction({ idleMs, now: () => now, schedule: (f, ms) => { const t = { at: now + ms, f }; timers.push(t); return () => { t.f = null } } })
    let release = null
    const out = []
    for (now = 0; now <= until; now += 16) {
        // the clock's timers first, as the browser would run them
        for (const t of timers.splice(0).sort((a, b) => a.at - b.at)) if (t.at <= now) t.f?.(); else timers.push(t)
        const inDrag = now >= from && now <= to, paused = now >= pauseAt && now < pauseTo
        if (inDrag && !release && held) release = I.hold()
        if (inDrag && !paused) I.poke()
        if (!inDrag && release) { release(); release = null }
        for (const t of timers.splice(0).sort((a, b) => a.at - b.at)) if (t.at <= now) t.f?.(); else timers.push(t)
        const v = effective({ renderMode, moveFast, moveMode }, { moving: I.active() })
        out.push({ t: now, moving: I.active(), mode: v.renderMode, dragging: inDrag && !paused })
    }
    return out
}

/* THE LIVE LOOP'S SLICES AND A FRAME'S SUBMISSIONS (raytrace_main.js: A SAMPLE OVER SEVERAL FRAMES, NO SUBMIT LONG
   ENOUGH TO BE KILLED), the constants copied */
export const SUBMIT_MS = 150, SPLIT_OVER_MS = 250, SPLIT_ITERS = 24, SLICE_MAX = 256, SLICE_MIN_RAYS = 1 << 14, SLICE_UNTIMED = 8
/** A timed sample of `sampleMs` over a picture of `px` pixels (`planned` batches already, the rays it fits), the
 *  live loop's slice of `sliceMs`: { K (batches), perCall (batches a frame), frameMs, frames, splitEvery (iterations a
 *  submission), submissions (a frame's) }. Untimed (sampleMs null): SLICE_UNTIMED batches, one a frame, each iteration
 *  its own submission. */
export function slicing({ sampleMs, px, sliceMs = 30, planned = 1, iterations = 24 }) {
    const want = sampleMs == null ? SLICE_UNTIMED : Math.ceil(sampleMs / sliceMs)
    const K = sliceMs > 0 ? Math.max(planned, Math.min(want, SLICE_MAX, Math.ceil(px / SLICE_MIN_RAYS))) : planned
    const sliced = sliceMs > 0 && K > 1 && (sampleMs == null || sampleMs > sliceMs)
    const perCall = !sliced ? K : sampleMs == null ? 1 : Math.max(1, Math.floor(sliceMs / (sampleMs / K)))
    const batchMs = sampleMs == null ? null : sampleMs / K
    const splitEvery = batchMs == null ? 1 : (sliced ? batchMs : sampleMs) <= SPLIT_OVER_MS ? Infinity
        : Math.max(1, Math.floor(Math.min(iterations, SPLIT_ITERS) * SUBMIT_MS / batchMs))
    const frameMs = batchMs == null ? null : sliced ? perCall * batchMs : sampleMs
    const subsPerBatch = splitEvery === Infinity ? 1 : Math.ceil(iterations / splitEvery)
    return { K, sliced, perCall, batchMs, frameMs, frames: sliced ? Math.ceil(K / perCall) : 1, splitEvery, submissions: (sliced ? perCall : K) * subsPerBatch }
}

/** SAMPLES OFFSCREEN on a clock: runSamples' rule (lib/pathtracer/samples.js; the test holds this to it), recording a
 *  sample `cpuMs` of the main thread, the card running it `gpuMs` once it and the card are both free, and the loop
 *  waiting for the oldest sample whenever `depth` are pending. Returns { ms (until all are done), cpu: [[from, to]],
 *  gpu: [[from, to]], order: the trace and done events in turn }. */
export function inFlight(n, { cpuMs, gpuMs, depth = 1 }) {
    let t = 0, gpuFree = 0
    const cpu = [], gpu = [], pend = [], order = []
    for (let i = 0; i < n; i++) {
        cpu.push([t, t + cpuMs]); t += cpuMs; order.push(`trace ${i + 1}`)
        const start = Math.max(t, gpuFree); gpu.push([start, start + gpuMs]); gpuFree = start + gpuMs; pend.push([gpuFree, i + 1])
        while (pend.length >= depth) { const [end, k] = pend.shift(); t = Math.max(t, end); order.push(`done ${k}`) }
    }
    while (pend.length) { const [end, k] = pend.shift(); t = Math.max(t, end); order.push(`done ${k}`) }
    return { ms: t, cpu, gpu, order }
}
