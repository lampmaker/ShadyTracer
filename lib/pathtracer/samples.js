//======================================================================================================================
// SAMPLES -- the loop renderFrame (index.js) runs offscreen: trace a sample, wait for the GPU, report progress.
//
// WHY IT HAS A MODULE OF ITS OWN. Offscreen, every sample waited for the GPU before the next was recorded, so the
// CPU's part of a sample and the GPU's ran one after the other. The benchmark measures exactly that loop, and its
// first two runs (the user's Pascal card, 2026-10-02) put a sample's wall clock 50-57 ms above its GPU time at 24
// iterations, of which the JavaScript recording was 6-12 ms. The live loop does not wait (render-loop.js), so there
// the two overlap. `inFlight` lets the offscreen loop record the next sample while the GPU runs this one. The
// benchmark's `pipelined` column measured what that buys (the user's Pascal, run 3: 13-25% off a sample,
// PERFORMANCE_REVIEW.md §10.6), and the save, the timeline's frames and the studio's pictures now ask for 2; a
// call for one sample is the same whatever it asks (tested), so the benchmark's own samples stay one at a time.
// Here, apart from index.js, so the order of traces, waits and progress can be tested without a GPU
// (lib/pathtracer/test/samples.test.mjs).
//======================================================================================================================

/**
 * Run `samples` samples. `trace()` records and submits one (it resolves once submitted, not once done); `done()`
 * resolves when everything submitted so far has finished on the GPU (queue.onSubmittedWorkDone). With
 * `inFlight` 1 every sample is waited for before the next is traced -- the loop as it always was. With 2, the next
 * sample is traced while the GPU still runs the one before; no more than `inFlight` are ever waiting.
 * `onProgress(k, samples)` reports each sample as the GPU finishes it, in order. An AbortSignal stops it between
 * samples. However it ends -- finished, aborted, stopped, or a trace that throws -- it returns only after the GPU has
 * finished every sample it was given, so a caller's cleanup never runs under work still in flight. It returns how
 * many samples were traced.
 *
 * THE DARKROOM'S RENDER WATCHED AS IT GOES (0.next), three more things, none of which changes the loop above for a caller
 * that does not ask:
 *   `samples` a function     the target read again before every sample: raised during the render, it renders further;
 *                            lowered under what is traced, it ends there
 *   `stop()`                 true: trace no more, finish what is in flight, and return -- no error, unlike the signal:
 *                            what was traced is the result ("good enough, keep it")
 *   `between(traced)`        awaited after each sample is traced and waited for as `inFlight` says, before the next
 *                            (never after the last): a picture copied there is queued behind every sample traced, so
 *                            it holds `traced` of them -- one more than finished with two in flight, which the queue's
 *                            order puts in the copy too
 */
export async function runSamples(samples, { trace, done, inFlight = 1, onProgress = null, signal = null, stop = null, between = null }) {
    const depth = Math.max(1, inFlight | 0)
    const target = typeof samples === 'function' ? samples : () => samples
    const pending = []
    let finished = 0, traced = 0
    // the total said is the target as it is now, and never less than what is done
    const settle = async () => { await pending.shift(); ++finished; onProgress?.(finished, Math.max(finished, target() | 0)) }
    try {
        while (traced < (target() | 0) && !stop?.()) {
            signal?.throwIfAborted()
            await trace()
            traced++
            pending.push(done())
            while (pending.length >= depth) await settle()
            // ...only between samples: after the last one the caller copies the whole render anyway
            if (between && traced < (target() | 0) && !stop?.()) await between(traced)
        }
        while (pending.length) await settle()
    } finally {
        // on the way out with an error: still wait for what was submitted, but report nothing more
        while (pending.length) { try { await pending.shift() } catch { } }
    }
    return traced
}
