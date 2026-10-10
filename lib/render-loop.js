//======================================================================================================================
// RENDER-LOOP -- an optional driver for a progressive renderer.
//
// WHY IT IS OPTIONAL. A path tracer embedded in another program must not own the frame. An
// erosion sim steps its own simulation and then asks for a picture; a 2D weave editor renders
// only when a button is pressed; a save path wants N samples at a fixed size and nothing else.
// A renderer that schedules its own requestAnimationFrame fights all three. So the core verb is
// `sample(n)` -- the host decides when -- and this file is the loop for hosts that just want the
// standalone behaviour.
//
// It is not a toy version of the loop it replaces. Everything measured in this project lives
// here: the pacing that stops the queue growing without bound, the damped governor that settles
// the sample count instead of oscillating, and the deterministic stepping the test bench needs.
// Lifted out of index.html unchanged -- same arithmetic, same constants,
// same behaviour -- because the point of the move is that the picture does not change.
//======================================================================================================================

/**
 * @param render  (spp) => Promise|void  -- records and submits one frame of `spp` samples
 * @param cost    lib/render-cost.js instrument; supplies pacing and the rate measurement
 * @param opts.minfps      the governor's target loop rate (default 20)
 * @param opts.maxSamples  ceiling on samples per frame (default 64)
 * @param opts.start       samples per frame to begin at (default 3)
 * @param opts.onReset     called once per frame when the host has flagged an accumulation reset
 * @param opts.consumeReset  () => boolean -- true if the accumulation was reset this frame
 * @param opts.held    () => boolean -- while true the loop submits nothing but keeps running (below)
 * @returns { start, stop, running, step, samplesPerFrame }
 */
export function makeRenderLoop(render, cost, opts = {}) {
    const minfps = opts.minfps ?? 20
    const maxSamples = opts.maxSamples ?? 64
    let count = opts.start ?? 3
    let prevtime = performance.now()
    let loopRunning = false

    const LOOP = () => {
        if (!loopRunning) return
        /* HELD: running, but submitting nothing. A structural apply in the builder probes the new
           scene's module and then compiles its pipelines; with the loop running, a revisit apply of
           the Noise library took 1.4-6.8 s, and 0.2 s with it paused (measured on the user's GTX
           1080 Ti, headless Chrome, 2026-10-03; the main thread idle throughout, so the time is
           waits -- behind the frames the loop goes on queueing, inferred). stop() would do it too,
           but then running() says paused, the play/pause control follows, and a stop nested in
           another -- setScene's, inside the apply -- sees the loop paused and never starts it again.
           So the loop stays running and only asks again next frame. The clock follows, so the first
           frame after measures one frame, not the whole hold, and the governor does not read the
           hold as a slow scene. */
        if (opts.held?.()) { prevtime = performance.now(); requestAnimationFrame(LOOP); return }
        // PACING. Never let more than cost.inflight frames sit in the queue. Without it the loop
        // submits every rAF regardless of what the GPU managed, the backlog grows without bound,
        // and that backlog IS the camera lag.
        if (cost.paced()) { requestAnimationFrame(LOOP); return }

        const ct = performance.now()
        const fps = 1000 / (ct - prevtime)
        prevtime = ct
        /* The adaptive sample count. `count > 1` as the floor guard let floating point walk
           straight through it -- 1.0999... - 0.1 lands on 1.0000000000000002, which is still
           > 1, and the next step takes it to 0.9. Math.floor then hands the renderer a count of
           0 and the frame presents an image it did not add a single sample to, while the HUD
           cheerfully reports 60 fps. Clamped instead of guarded.

           NOTE what this governor is steering by. `fps` is the loop interval, so while the loop
           is CPU-bound on command recording, raising count raises the RECORDING cost and the
           governor settles wherever JS runs out of frame -- buying no extra GPU work at all.
           cost.cpu is what says whether that is happening; see the instrument's header.

           ...and it oscillated, which is the other half of why the HUD was unreadable. Two
           reasons, both fixed here. The step was ABSOLUTE (+/-0.1), so at count 2 a whole-sample
           change is +50% of the workload while at count 40 it is +2.5%: gentle where it does not
           matter and violent where it does. And the deadband was +/-1 fps around a target the
           workload itself moves, so it hunted -- count 2 -> 3 -> 2 -> 3, the frame rate swinging
           with it. Relative steps keep the adjustment proportional, and a deadband in percentage
           terms is wide enough to settle in. */
        if (fps > minfps * 1.15) count = Math.min(maxSamples, count * 1.03)
        else if (fps < minfps * 0.9) count = Math.max(1, count / 1.03)

        const spp = Math.floor(count)
        cost.frame(spp)
        // record() brackets the command recording so `cpu` measures exactly that
        Promise.resolve(cost.record(() => render(spp)))
            .then(() => { cost.submitted(); if (loopRunning) requestAnimationFrame(LOOP) })
        if (opts.consumeReset?.()) cost.reset()
    }

    return {
        start() { if (loopRunning) return; loopRunning = true; requestAnimationFrame(LOOP) },
        stop() { loopRunning = false },
        running: () => loopRunning,
        samplesPerFrame: () => Math.floor(count),

        /* DETERMINISTIC STEPPING, ported from WEAVESIM's PT.pause()/PT.step().

           Two things need it. A buffer readback while the loop is hammering may never resolve on
           some adapters (SwiftShader will sit on it indefinitely) -- pausing first is what makes
           an imageStats() reliable. And comparing two builds, or a toggle on against off, is only
           meaningful at the same sample count, which a free-running loop cannot give you.

           It resolves when the GPU has actually finished, not when the submit was recorded --
           the distinction this whole instrument exists to make. */
        async step(n = 1, one, drain) {
            if (loopRunning) { console.warn('[render-loop] step: stop the loop first'); return 0 }
            for (let i = 0; i < n; i++) await one()
            await drain()
            return n
        },
    }
}

/** HOLDS ON A LOOP, counted: hold() returns its release, held() says whether any is out -- the predicate
 *  makeRenderLoop's opts.held takes. A count, not a flag, because holds nest (two applies overlapping, each
 *  letting go of its own) and the loop must stay held until the last is released. A release runs once however
 *  often it is called, so a finally that runs after a release already made lets go of nothing more -- a second
 *  decrement would free another caller's hold while it still needs it. */
export function makeHolds() {
    let holds = 0
    return {
        hold() {
            holds++
            let out = true
            return () => { if (out) { out = false; holds-- } }
        },
        held: () => holds > 0,
    }
}

/** THE PICTURE'S RESETS, COUNTED on the settings bag the loop consumes them from: Q.resetframecount made an accessor
 *  that counts every truthy write, and the count returned as a function. A reset is how anything says the picture is
 *  of something else now, and it is written in many places (the host's, the engine's setScene, a test's); counted
 *  where it is written, a new place that writes it is counted too. Every 1 counts, a 1 over a 1 not yet consumed as
 *  well: the picture restarts once for both, but something that began between them -- a round of the Optics page's
 *  Live analysis, which adds to one estimate while this stands still -- saw only the first. */
export function countResets(Q) {
    let n = 0, flag = Q.resetframecount
    Object.defineProperty(Q, 'resetframecount', { enumerable: true, configurable: true, get: () => flag,
        set: v => { if (v) n++; flag = v } })
    return () => n
}
