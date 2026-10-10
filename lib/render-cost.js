//======================================================================================================================
// RENDER-COST.JS — what a progressive renderer actually costs, and the frame pacing it needs.
//
// Ported out of WEAVESIM, where every line of it was learned the hard way, and generalised so both
// projects can share one instrument. WEAVESIM's own copy is still inline; this is where it should
// end up.
//
// THE PROBLEM IT EXISTS FOR. A progressive path tracer's render loop is fire-and-forget:
// endFrame() records a submit and returns, nothing waits for the GPU, and a frame counter counts
// SUBMISSIONS rather than finished samples. Time against that and you measure the browser's timer
// clamp -- identically for every configuration -- which is how a renderer ends up with no usable
// cost measurement at all. Worse, requestAnimationFrame keeps firing at 60 Hz whatever the GPU is
// doing, so on a card slower than the frame budget the queue grows without bound (WEAVESIM
// measured seventeen seconds of backlog). That is camera lag you can feel, and it stalls every
// readback behind it. Pacing has to be fixed before cost can even be observed.
//
// THE THREE NUMBERS, cheapest and most reliable first:
//
//   rate  samples per second actually finishing, from the wall clock. The number that decides how
//         long a clean image takes. Capped by rAF at 60 x spp, so on a quick card at spp 1 it
//         measures the loop rather than the card.
//   cpu   milliseconds of JAVASCRIPT per frame spent recording commands. Not in WEAVESIM's
//         version, because WEAVESIM issues one dispatch a sample and cannot be CPU-bound. A
//         wavefront renderer issues hundreds, each of which is several calls across the Dawn
//         wire, and can be entirely CPU-bound while the GPU idles -- a state in which every
//         shader optimisation you try will measure as doing nothing. If cpu is close to the
//         frame interval, THAT is the bottleneck and no amount of shader work will move it.
//   lat   submit -> queue drained, from onSubmittedWorkDone(). Always available. This is
//         latency, not cost: how far behind the GPU is running. Pacing keeps it small.
//
// The fence probe runs one at a time -- a probe per frame would end up timing the probes.
//
// NO GPU TIMESTAMPS HERE ANY MORE (0.22.3). This had a fourth number, the GPU time of one timed pass, which needs a
// sample's work inside ONE pass. A wavefront sample is hundreds of dispatches over many passes, so the raytracer, the
// only host, never armed it: the readout's "per sample" was always the wall clock, while the instrument still made a
// query set and four buffers on every adapter with the feature. What a sample costs on the GPU, kernel by kernel, is
// the benchmark's (lib/pathtracer/core/kerneltime.js). WEAVESIM's inline copy, one dispatch a sample, still has its
// timestamp probe, should it move here.
//======================================================================================================================

const PACEWAIT = 250   // ms to wait on a completion callback before distrusting it -- see pacewait
const RESETMS  = 1000  // minimum gap between honoured reset()s -- see reset()

/**
 * @param {Object} G a tinywebgpu instance, already init()'d
 * @param {{slowMs?: number}} [opts] slowMs: per-frame cost past which the queue depth drops from
 *   2 to 1, halving camera lag on a slow card. Default 50.
 */
export function makeCostInstrument(G, opts = {}) {
    const slowMs = opts.slowMs ?? 50
    const max = Math.max

    const S = {
        cpu: 0,      // EMA, ms of JS per frame spent recording
        lat: 0,      // EMA, ms to drain the queue -- how far behind the GPU is
        rate: 0,     // EMA, samples per second finishing
        busy: false, // a fence probe is in flight
        tlast: 0,    // previous loop entry, for the rate
        queued: 0,   // frames submitted and not yet known complete
        blocked: 0,  // when the loop first had to wait, 0 = not waiting
        n: {},       // readings so far per statistic, for the warm-up EMA
        treset: -1e9,// when the last honoured reset() landed
        held: 0,     // rAF turns pacing has withheld since the last read
        ran: 0,      // frames actually rendered since the last read -- held/ran says whether
                     // pacing is shaping the loop at all, which the other numbers cannot
        lastSpp: 1,  // samples the previous loop entry queued, so the rate counts samples
        t0: 0,       // start of the current record() span
    }

    /* WARM-UP EMA. A plain a=0.15 EMA needs about seven readings to settle, and a reading only
       lands once per queue drain -- seconds, on a slow frame. Weighting the first readings fully
       makes it a running mean at first and an EMA after, settling in two or three instead. */
    const ema = (v, x, k) => (S.n[k] = (S.n[k] || 0) + 1, v + (x - v) * max(1 / S.n[k], 0.2))

    const wallMs = () => S.rate ? 1000 / S.rate : 0

    /* Pacing must never be able to STOP the render: some adapters resolve onSubmittedWorkDone long
       after the work is really finished, and gating on that alone can drop the render to a crawl.
       But a fixed window cannot tell "the callback is slow" from "the frame genuinely takes
       900 ms", so on a slow frame it fires every time and lets the queue grow again -- pacing
       defeating itself exactly where it is needed. The window therefore WIDENS once real drain
       times are known, and only stays at PACEWAIT while nothing has ever come back. */
    const pacewait = () => max(PACEWAIT, S.lat * 3)
    /* ONE IN FLIGHT ONLY WHEN THE FRAME IS SLOW TOO. A frame is at least one sample, so the frame's time was the sample's or
       more and the sample's alone decided. A frame that holds part of one (done(); the pathtracer's samples over several
       frames, 0.58.0) is short however slow its sample: held to one in flight, the GPU would idle between those short
       frames for a frame's turn each (inferred, not measured). Two of them queued is still under two frames' time ahead. */
    const inflight = () => wallMs() > slowMs && wallMs() * S.lastSpp > slowMs ? 1 : 2

    return {
        /** True when the loop should yield this frame instead of submitting another. */
        paced() {
            if (S.queued >= inflight()) {
                S.blocked = S.blocked || performance.now()
                if (performance.now() - S.blocked < pacewait()) { S.held++; return true }
                S.queued = 0                          // callbacks are lagging; stop trusting them
            }
            S.blocked = 0
            return false
        },
        /** Call at the top of a loop iteration that WILL render, with the samples it is about to
         *  queue. Closes the rate measurement for the previous iteration. */
        frame(spp = 1) {
            const t = performance.now()
            if (S.tlast) S.rate = ema(S.rate, S.lastSpp * 1000 / max(1, t - S.tlast), 'rate')
            S.tlast = t
            S.lastSpp = spp
            S.ran++
        },
        /** The samples the frame frame() opened really traced, when not what it was told: part of one (a sample over
         *  several frames) counts as that part, so the rate stays samples finishing per second. */
        done(n) { S.lastSpp = Math.max(0, +n || 0) },
        /** Wrap the command-recording span -- everything from beginFrame() to endFrame(). This is
         *  the `cpu` number, and on a wavefront renderer it is the one that decides whether any
         *  shader work you do next will be visible at all. */
        record(fn) {
            S.t0 = performance.now()
            try { return fn() }
            finally { S.cpu = ema(S.cpu, performance.now() - S.t0, 'cpu') }
        },
        /** Call straight after endFrame(). */
        submitted() {
            S.queued++
            if (S.busy) return                        // one fence at a time; more would time itself
            S.busy = true
            const t0 = performance.now()
            G.device.queue.onSubmittedWorkDone().then(() => {
                S.queued = 0                          // queue empty: everything submitted is done
                S.lat = ema(S.lat, performance.now() - t0, 'lat')
                S.busy = false
            }).catch(() => { S.busy = false })
        },
        /** Call on every parameter change. Clears the reading COUNTS but keeps the values: with n
         *  back at zero the next reading gets weight 1 and replaces the estimate outright, so
         *  nothing decays in from the old figure, while there is still something to show.
         *
         *  DEBOUNCED, and that is not a detail. A renderer resets its accumulation on every
         *  camera nudge, and a camera with damping goes on emitting those for as long as it is
         *  settling -- so an undebounced reset clears the counts every frame, every reading
         *  lands with weight 1, and the HUD becomes an unreadable flicker of instantaneous
         *  values. Which is the exact opposite of what the reset is for. A settings change
         *  still gets its fresh estimate; a stream of them gets one, not hundreds. Cost does
         *  not really change because the camera moved, anyway. */
        reset() {
            const t = performance.now()
            if (t - S.treset < RESETMS) return
            S.treset = t
            S.n = {}
        },

        get ms() { return wallMs() },                 // per sample, from the rate
        get cpu() { return S.cpu },
        get rate() { return S.rate },
        get lat() { return S.lat },
        get queued() { return S.queued },
        /** Fraction of rAF turns pacing withheld since the last call, and resets the counters.
         *  0 means pacing never engages and the loop is free-running at vsync; near 1 means the
         *  GPU is a long way behind and the loop is mostly waiting. Without it, a low frame rate
         *  and a paced frame rate look identical from outside. */
        takePaced() { const h = S.held, r = S.ran; S.held = 0; S.ran = 0; return r + h ? h / (r + h) : 0 },
        get inflight() { return inflight() },

        /** One line for a HUD. `interval` is the frame interval in ms, so cpu can be shown as a
         *  fraction of it -- which is what makes "you are CPU-bound" legible at a glance. */
        line(interval = 0) {
            const pct = interval > 0 ? ` (${(S.cpu / interval * 100).toFixed(0)}% of frame)` : ''
            return `${S.rate.toFixed(1)} samples/s · ${this.ms.toFixed(2)} ms/sample`
                + ` · cpu ${S.cpu.toFixed(1)} ms${pct}`
                + (S.lat > 1 ? ` · queue ${S.lat.toFixed(0)} ms` : '')
        },
    }
}
