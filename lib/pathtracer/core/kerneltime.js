//======================================================================================================================
// KERNEL TIME -- how long each kernel of a sample ran on the GPU, from timestamps written at its compute pass's
// start and end.
//
// Asked for by the user (2026-09-30) after the benchmark's fourth run: the relief shell took a third of the reliefs'
// cost, and wall clock cannot say whether the 80 ms left is spent marching, shading or tracing shadow rays. The
// wall clock says what a sample costs; this says where.
//
// HOW. R.trace opens a compute pass per dispatch (raytrace_main.js: no beginCompute chain there), so every kernel
// already has a pass of its own. tinywebgpu's timePasses(fn) asks for each such pass's descriptor, and the one this
// hands back writes a timestamp pair into a query set. After the frame's last submit, the pairs are resolved into a
// buffer, copied to a mappable one and read: each pass's end less its start, summed by the kernel's name.
//
// WHAT IT IS NOT:
//   - wall clock: the gaps between passes are left out, and so is everything outside the GPU;
//   - exact: a browser may round timestamps (Chrome documents 100 us without its WebGPU developer features; not
//     checked here), so a pass shorter than that reads 0 or one tick -- right on average over many passes, not per
//     pass;
//   - free: a timestamp pair per pass. The benchmark therefore times kernels in samples of their own, after the
//     wall-clock ones, and reports the wall clock of those too, so the difference is visible.
// Without the device feature 'timestamp-query' (the page asks for it, best effort) it is unavailable and says so.
//======================================================================================================================

/* How many passes one trace may time. A sample is up to 7 passes per wavefront iteration and R.budget iterations
   (the worst case since 0.10.0: 24 at the defaults, 38 at High quality's maxbounce 24, quality.js), plus generation,
   resolve and the occasional rebuild, and since 0.10.0 the last pass's shadow rounds (raytrace_main.js: 3 passes a
   round, 12 extra rounds at maxiter 400): about 210 at the defaults and 310 at High with NEE on, a wf_snap more an
   iteration with the wavefront log, and about 890 at High with maxiter 2000 (arithmetic on those counts, not
   measured). A pass beyond this is left untimed and counted in `overflow`, never guessed at. */
export const KERNEL_PASSES = 1024

// the WebGPU enums as numbers: GPUBufferUsage and GPUMapMode do not exist outside a browser (the tests)
const MAP_READ = 0x0001, COPY_SRC = 0x0004, COPY_DST = 0x0008, QUERY_RESOLVE = 0x0200, MAP_MODE_READ = 1

/**
 * A timer for one trace at a time. begin(nameOf) returns the hook for tinywebgpu's timePasses -- nameOf(program) is
 * a kernel's name, or undefined for a program it does not know ('other'). end(), after the frame's last submit,
 * resolves to { ms: {name: total ms}, count: {name: passes}, passes, overflow, seq, spanMs, gapMs } (tally, below),
 * or null if the readback failed.
 */
export function makeKernelTimer(device, { passes = KERNEL_PASSES } = {}) {
    const available = !!device?.features?.has?.('timestamp-query')
    if (!available) return { available: false, begin: () => null, end: () => Promise.resolve(null), destroy() { } }
    const querySet = device.createQuerySet({ type: 'timestamp', count: 2 * passes })
    const resolved = device.createBuffer({ size: 16 * passes, usage: QUERY_RESOLVE | COPY_SRC })
    const spare = []                          // mappable buffers not being read
    let names = [], nameOf = () => undefined, overflow = 0
    const hook = program => {
        if (names.length >= passes) { overflow++; return undefined }
        const k = names.length
        names.push(nameOf(program) ?? 'other')
        return { timestampWrites: { querySet, beginningOfPassWriteIndex: 2 * k, endOfPassWriteIndex: 2 * k + 1 } }
    }
    return {
        available: true,
        begin(fn) { names = []; overflow = 0; nameOf = fn || (() => undefined); return hook },
        /* Submitted after the frame, so the queue runs it after every pass it reads (queue order); the query set is
           rewritten by the next trace only after that, for the same reason. */
        end() {
            const got = names, over = overflow, n = got.length
            names = []
            if (!n) return Promise.resolve({ ms: {}, count: {}, passes: 0, overflow: over })
            const buf = spare.pop() || device.createBuffer({ size: 16 * passes, usage: MAP_READ | COPY_DST })
            const enc = device.createCommandEncoder()
            enc.resolveQuerySet(querySet, 0, 2 * n, resolved, 0)
            enc.copyBufferToBuffer(resolved, 0, buf, 0, 16 * n)
            device.queue.submit([enc.finish()])
            return buf.mapAsync(MAP_MODE_READ, 0, 16 * n).then(() => {
                const t = new BigUint64Array(buf.getMappedRange(0, 16 * n).slice(0))
                buf.unmap()
                spare.push(buf)
                return tally(got, t, over)
            }, () => null)            // a lost device, a destroyed buffer: no number rather than a wrong one
        },
        destroy() { querySet.destroy?.(); resolved.destroy?.(); for (const b of spare) b.destroy?.() },
    }
}

/** Timestamp pairs (ns, BigUint64) into ms per kernel name. A pair whose end is not after its start reads 0.
 *  Also, in pass order, `seq` ([name, ms] per pass), and the frame's `spanMs` -- the first pass's start to the last
 *  one's end -- with `gapMs`, the part of that span no pass was running: what the GPU spent between kernels
 *  (uniform copies, barriers, launching a dispatch; and waiting for the next submission, if the CPU fell behind).
 *  The gap is the one figure here that grows with the NUMBER of dispatches rather than with their work. */
export function tally(names, t, overflow = 0) {
    const ms = {}, count = {}, seq = []
    let first = null, last = null, busy = 0
    names.forEach((name, k) => {
        const a = t[2 * k], b = t[2 * k + 1]
        const d = b > a ? Number(b - a) / 1e6 : 0
        ms[name] = (ms[name] || 0) + d
        count[name] = (count[name] || 0) + 1
        seq.push([name, d])
        busy += d
        if (b > a) {
            if (first === null || a < first) first = a
            if (last === null || b > last) last = b
        }
    })
    const spanMs = first === null ? 0 : Number(last - first) / 1e6
    return { ms, count, passes: names.length, overflow, seq, spanMs, gapMs: Math.max(0, spanMs - busy) }
}

/** A timed trace's passes (tally's `seq`) by WAVEFRONT ITERATION: an iteration is the passes from a 'prep_march' to
 *  the 'flip' that ends it (raytrace_main.js R.trace), as { name: ms }; whatever runs outside one -- generation,
 *  resolve, the rebuilds, the display's meter -- is summed in `outside`. */
export function perIteration(seq) {
    const iterations = [], outside = {}
    let cur = null
    for (const [name, d] of seq) {
        if (name === 'prep_march') cur = {}
        const into = cur ?? outside
        into[name] = (into[name] || 0) + d
        if (name === 'flip' && cur) { iterations.push(cur); cur = null }
    }
    if (cur) for (const [k, v] of Object.entries(cur)) outside[k] = (outside[k] || 0) + v
    return { iterations, outside }
}
