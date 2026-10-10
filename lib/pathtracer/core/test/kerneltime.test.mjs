// node lib/pathtracer/core/test/kerneltime.test.mjs
//
// PER-KERNEL GPU TIME (core/kerneltime.js), without a GPU. What only a GPU can say is how long each kernel takes;
// everything that turns its timestamps into the benchmark's columns runs here, on devices that record:
//   - tinywebgpu's timePasses: a dispatch's own compute pass gets the hook's descriptor, the hook is asked with the
//     program itself, a beginCompute() chain keeps its own descriptor, and null stops it;
//   - the timer: a timestamp pair per pass, unique and in range, named; the resolve and the readback; ms summed
//     per kernel; a pass past the query set counted, not timed; no feature, no timer; a failed readback, no number;
//   - the engine: a whole trace on a stub WG, the hook set before its first beginFrame and cleared after its last
//     endFrame (the cut submissions between), every pass named from the kernel table -- and none when off; the
//     frame timer that sizes the cut submissions reading the GPU's busy time with two traces queued;
//   - the benchmark's summary of a row's timed samples: medians per kernel, the median of the totals.
import { WEBGPU } from '../../../tinywebgpu/src/tinywebgpu.js'
import { makeKernelTimer, tally, perIteration, KERNEL_PASSES } from '../kerneltime.js'
import { RAYTRACER, readWavefrontLog } from '../raytrace_main.js'
import { WF_LOG_MAX, WF_LOG_WORDS, COUNTER_WORDS, counterWords, counterstruct } from '../wavefront.js'
import { sphereScene } from '../profile.js'
import { kernelSummary, wavefrontOf } from '../../tests.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}

//----------------------------------------------------------------------------------------------------------------------
// TINYWEBGPU'S HOOK, on a recording device (build.test.mjs's stub)
//----------------------------------------------------------------------------------------------------------------------
globalThis.GPUBufferUsage ??= { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 }
globalThis.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 }
globalThis.GPUTextureUsage ??= { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 }
{
    const opened = []
    const passOf = desc => { opened.push(desc); return { setPipeline() { }, setBindGroup() { }, dispatchWorkgroups() { }, dispatchWorkgroupsIndirect() { }, end() { } } }
    const device = {
        limits: {}, features: new Set(),
        createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
        pushErrorScope() { }, popErrorScope: async () => null,
        createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
        createBuffer: ({ size, usage }) => ({ size, usage, destroy() { }, mapAsync: async () => { }, getMappedRange: () => new ArrayBuffer(size), unmap() { } }),
        createBindGroup: () => ({}),
        createCommandEncoder: () => ({ beginComputePass: passOf, copyBufferToBuffer() { }, finish: () => ({}) }),
        queue: { writeBuffer() { }, submit() { }, onSubmittedWorkDone: async () => { } },
    }
    const S = WEBGPU()
    S.device = device
    const p = S.makeCompute('', 'let x = buf[gid.x];', {}, { buf: 'array<f32>' })
    p.setResources({ buf: S.createStorageBuffer(16) })
    const asked = []
    const D = { timestampWrites: { querySet: 'Q', beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } }

    S.timePasses(prog => { asked.push(prog); return D })
    S.beginFrame(); p.dispatch(1, 1, 1); p.dispatchIndirect({ size: 12 }, 0); S.endFrame()
    ok('timePasses: a dispatch\'s own pass gets the hook\'s descriptor, dispatchIndirect\'s too', opened.length === 2 && opened.every(d => d === D))
    ok('...and the hook is asked with the program itself (what the engine names it by)', asked.length === 2 && asked.every(x => x === p))

    opened.length = 0; asked.length = 0
    S.timePasses(() => undefined)
    S.beginFrame(); p.dispatch(1, 1, 1); S.endFrame()
    ok('a hook that gives nothing: a plain pass', opened.length === 1 && opened[0] === undefined)

    opened.length = 0; asked.length = 0
    S.timePasses(prog => { asked.push(prog); return D })
    const chainOpts = { label: 'chain' }
    S.beginCompute(chainOpts); p.dispatch(1, 1, 1); p.dispatch(1, 1, 1); S.endCompute()
    ok('a beginCompute() chain keeps its own descriptor; the hook is not asked', opened.length === 1 && opened[0] === chainOpts && asked.length === 0,
        JSON.stringify(opened))

    opened.length = 0; asked.length = 0
    S.timePasses(null)
    S.beginFrame(); p.dispatch(1, 1, 1); S.endFrame()
    ok('timePasses(null) stops it', opened.length === 1 && opened[0] === undefined && asked.length === 0)
}

//----------------------------------------------------------------------------------------------------------------------
// THE TIMER, on a device that records and hands back the timestamps it is told to
//----------------------------------------------------------------------------------------------------------------------
const fakeDevice = ({ features = ['timestamp-query'], stamps = () => [], failMap = false } = {}) => {
    const log = { querySets: [], buffers: [], resolves: [], copies: [], submits: 0, maps: [] }
    const device = {
        features: new Set(features),
        createQuerySet: d => (log.querySets.push(d), { ...d, destroy() { } }),
        createBuffer: d => {
            const b = {
                ...d, destroy() { },
                mapAsync: (mode, off, size) => (log.maps.push([mode, off, size]), failMap ? Promise.reject(new Error('lost')) : Promise.resolve()),
                getMappedRange: (off, size) => { const t = new BigUint64Array(size / 8); stamps().forEach((v, i) => { if (i < t.length) t[i] = BigInt(v) }); return t.buffer },
                unmap() { b.mapped = false },
            }
            log.buffers.push(b)
            return b
        },
        createCommandEncoder: () => ({
            resolveQuerySet: (...a) => log.resolves.push(a),
            copyBufferToBuffer: (...a) => log.copies.push(a),
            finish: () => ({}),
        }),
        queue: { submit: () => { log.submits++ } },
    }
    return { device, log }
}
{
    const { device, log } = fakeDevice({ features: [] })
    const t = makeKernelTimer(device)
    ok('no timestamp-query: unavailable, nothing created, no hook, no number',
        t.available === false && log.querySets.length === 0 && t.begin(() => 'x') === null)
    ok('...and end() resolves to null', await t.end() === null)
}
{
    // ns stamps: pass k runs from 10 ms x k for (k + 1) x 0.5 ms
    const stamps = () => Array.from({ length: 16 }, (_, i) => i % 2 === 0 ? (i / 2) * 10e6 : ((i - 1) / 2) * 10e6 + (((i - 1) / 2) + 1) * 0.5e6)
    const { device, log } = fakeDevice({ stamps })
    const t = makeKernelTimer(device, { passes: 4 })
    ok('a query set of two timestamps a pass, the resolve buffer 16 bytes a pass',
        log.querySets.length === 1 && log.querySets[0].type === 'timestamp' && log.querySets[0].count === 8
        && log.buffers[0].size === 64 && log.buffers[0].usage === (0x200 | 0x4))
    const A = {}, B = {}, C = {}
    const hook = t.begin(p => p === A ? 'march' : p === B ? 'shade' : undefined)
    const ds = [hook(A), hook(B), hook(A), hook(C), hook(A)]
    ok('each pass its own pair, in order', ds.slice(0, 4).every((d, k) =>
        d.timestampWrites.beginningOfPassWriteIndex === 2 * k && d.timestampWrites.endOfPassWriteIndex === 2 * k + 1))
    ok('...the query set the timer made', ds.slice(0, 4).every(d => d.timestampWrites.querySet.type === 'timestamp' && d.timestampWrites.querySet.count === 8))
    ok('a pass past the query set: left plain, not timed', ds[4] === undefined)
    const r = await t.end()
    ok('the resolve: the used pairs only, into the resolve buffer at 0', log.resolves.length === 1 && log.resolves[0][1] === 0 && log.resolves[0][2] === 8
        && log.resolves[0][3] === log.buffers[0] && log.resolves[0][4] === 0)
    ok('...copied to a mappable buffer, submitted after the frame, mapped for reading', log.copies.length === 1 && log.copies[0][4] === 64
        && log.buffers[1].usage === (0x1 | 0x8) && log.submits === 1 && log.maps[0][0] === 1 && log.maps[0][2] === 64)
    ok('ms summed per kernel: march passes 0 and 2, shade pass 1, the unknown program as "other"',
        Math.abs(r.ms.march - (0.5 + 1.5)) < 1e-9 && Math.abs(r.ms.shade - 1.0) < 1e-9 && Math.abs(r.ms.other - 2.0) < 1e-9, JSON.stringify(r))
    ok('...with how many passes each, and the one past the set counted as overflow',
        r.count.march === 2 && r.count.shade === 1 && r.count.other === 1 && r.passes === 4 && r.overflow === 1)
    // a second trace: the same readback buffer again, nothing new made
    t.begin(() => 'march')(A)
    await t.end()
    ok('the next trace reuses the readback buffer', log.buffers.length === 2, `${log.buffers.length} buffers`)
    t.begin(() => 'march')
    const none = await t.end()
    ok('a trace with no passes: nothing submitted, an empty result', none.passes === 0 && log.submits === 2)
}
{
    const { device } = fakeDevice({ failMap: true })
    const t = makeKernelTimer(device)
    t.begin(() => 'march')({})
    ok('a readback that fails: null, not a number', await t.end() === null)
}
ok('tally: a pair whose end is not after its start reads 0', tally(['a', 'a'], [5n, 3n, 10n, 12n]).ms.a === 2e-6)
{
    // three passes, 1 ms each, with 0.5 ms between the first two and 2 ms between the last two
    const t = [0n, 1000000n, 1500000n, 2500000n, 4500000n, 5500000n]
    const r = tally(['prep_march', 'march', 'flip'], t)
    ok('tally: the passes in order, each with its ms', JSON.stringify(r.seq) === JSON.stringify([['prep_march', 1], ['march', 1], ['flip', 1]]), JSON.stringify(r.seq))
    ok('tally: the span, the first start to the last end, and the gap no pass ran', r.spanMs === 5.5 && r.gapMs === 2.5, `${r.spanMs} ${r.gapMs}`)
    ok('tally: nothing timed, no span and no gap', tally([], []).spanMs === 0 && tally([], []).gapMs === 0)
}
{
    const seq = [['genrays', 1], ['prep_march', 0.1], ['march', 5], ['shade', 2], ['wf_snap', 0.1], ['flip', 0.1],
                 ['prep_march', 0.1], ['march', 1], ['flip', 0.1], ['resolve', 0.5], ['prep_march', 0.1], ['march', 0.2]]
    const r = perIteration(seq)
    ok('perIteration: an iteration from prep_march to its flip', r.iterations.length === 2 && r.iterations[0].march === 5
        && r.iterations[0].wf_snap === 0.1 && r.iterations[1].march === 1 && r.iterations[1].shade === undefined, JSON.stringify(r.iterations))
    ok('perIteration: generation, resolve and an iteration with no flip are outside',
        r.outside.genrays === 1 && r.outside.resolve === 0.5 && Math.abs(r.outside.march - 0.2) < 1e-12, JSON.stringify(r.outside))
}
{
    // the log's words (wavefront.js prog_wf_snap): count, then per iteration readfrom, buf0, buf1, shade, shadow0, shadow1, cap,
    // flushed, shadowcut
    const w = new Uint32Array([2, 0, 900, 600, 800, 0, 500, 1000, 0, 7, 1, 600, 50, 400, 500, 30, 1000, 3, 19])
    ok('the log is nine words an iteration', WF_LOG_WORDS === 9 && w.length === 1 + 2 * WF_LOG_WORDS)
    const r = readWavefrontLog(w)
    ok('readWavefrontLog: reading buffer 0, what it marched, what goes on, what it shaded, the shadow rays both ways',
        r.logged === 2 && JSON.stringify(r.iterations[0]) === JSON.stringify({ marched: 900, next: 600, shaded: 800, occluded: 0, shadowsNext: 500, flushed: 0, shadowCut: 7 }),
        JSON.stringify(r.iterations[0]))
    ok('readWavefrontLog: reading buffer 1 the sides swap, and the shadow rays it traced are capped at shadowcap',
        JSON.stringify(r.iterations[1]) === JSON.stringify({ marched: 50, next: 600, shaded: 400, occluded: 30, shadowsNext: 500, flushed: 3, shadowCut: 19 }),
        JSON.stringify(r.iterations[1]))
    // ...and beside a timed sample's passes (tests.js wavefrontOf): the running totals as what each iteration added
    const kt = { gapMs: 0.5, seq: [['genrays', 1], ['prep_march', 0.1], ['march', 5], ['occlude', 2], ['flip', 0.1],
                                   ['prep_march', 0.1], ['march', 1], ['flip', 0.1]] }
    const f = wavefrontOf(kt, r)
    ok('wavefrontOf: the sample\'s cut shadow rays and flushed rays, the last iteration\'s running totals', f.shadowCut === 19 && f.flushed === 3, JSON.stringify(f))
    ok('...and per iteration what that one added', f.wavefront[0].cut === 7 && f.wavefront[1].cut === 12 && f.wavefront[1].flushed === 3
        && f.wavefront[0].next === 600 && f.wavefront[1].shadowsNext === 500, JSON.stringify(f.wavefront))
    ok('...the tail: iterations under a tenth of the first one\'s rays, and their GPU ms', f.wavefrontTailIterations === 1
        && Math.abs(f.wavefrontTailMs - 1.2) < 1e-9 && Math.abs(f.wavefrontIterationsMs - 8.4) < 1e-9, JSON.stringify(f))
    ok('...no log: a note', wavefrontOf(kt, null).wavefrontNote && wavefrontOf(kt, null).shadowCut === undefined)
    const over = new Uint32Array(1 + 300 * WF_LOG_WORDS); over[0] = 300
    ok('readWavefrontLog: past the log\'s room the count says how many there were, the iterations stop at the room',
        readWavefrontLog(over).iterations.length === WF_LOG_MAX && readWavefrontLog(over).logged === 300)
}
ok('the query set holds a Noise library sample with room (under 200 passes, see kerneltime.js)', KERNEL_PASSES >= 200)
{
    // THE COUNTERS: every buffer bound as Counters is COUNTER_WORDS long, so it must be the struct's size
    const fields = counterstruct.slice(counterstruct.indexOf('{') + 1, counterstruct.lastIndexOf('}')).split(',').filter(x => x.trim())
    ok('COUNTER_WORDS: one word per field of the struct, each field a u32', COUNTER_WORDS === fields.length && COUNTER_WORDS === 11
        && fields.every(x => /:\s*(atomic<u32>|u32)\s*$/.test(x)), fields.join('|'))
    const a = counterWords({ 0: 5, 8: 7 })
    ok('counterWords: that long, zero but the words given', a.length === COUNTER_WORDS && a[0] === 5 && a[8] === 7
        && a.reduce((x, y) => x + y, 0) === 12 && counterWords().every(x => x === 0))
}

//----------------------------------------------------------------------------------------------------------------------
// THE ENGINE: a whole trace on a stub WG (every program records its dispatch and asks the hook, as tinywebgpu does)
//----------------------------------------------------------------------------------------------------------------------
const engineOn = async features => {
    const log = []
    let hook = 0, failAt = -1
    const stubBuffer = () => ({ b: {}, w() { }, r: async () => new Float32Array(64), clear() { }, destroy() { }, size: 0 })
    const prog = () => {
        const p = { ready: Promise.resolve({}), setResources() { }, set resources(v) { }, set uniforms(v) { },
            dispatch() { if (failAt-- === 0) throw new Error('a dispatch that fails'); log.push(hook ? hook(p) : null) },
            dispatchIndirect() { log.push(hook ? hook(p) : null) },
            run() { log.push(hook ? hook(p) : null) }, drawTo() { log.push('draw') } }
        return p
    }
    const { device } = fakeDevice({ features, stamps: () => Array.from({ length: 64 }, (_, i) => i * 1e6) })
    device.limits = {}
    device.queue.onSubmittedWorkDone = async () => { }
    const WG = new Proxy({
        device,
        beginFrame: () => log.push('begin'), endFrame: () => log.push('end'),
        timePasses: f => { hook = f || 0; log.push(f ? 'hook on' : 'hook off') },
        makeCompute: prog,
    }, { get: (t, k) => k in t ? t[k] : (typeof k === 'string' && /^create/.test(k) ? stubBuffer : undefined) })
    const Q = { w: 8, h: 8, resetframecount: 0 }
    const say = console.log
    console.log = () => { }                    // the build's own log line
    const R = RAYTRACER(WG, null, Q, sphereScene({ id: 'stub', uniforms: {} }))
    R.rebind = () => { }
    R.hud = () => { }
    await R._buildWavefrontPipelines()
    console.log = say
    R.prog_render = prog()                     // made at init, not by a build
    return { R, Q, log, prog, device, failAfter: n => { failAt = n } }
}
{
    const { R, Q, log, failAfter } = await engineOn(['timestamp-query'])
    ok('timeKernels(true): on, with the feature', R.timeKernels(true) === true)
    await R.trace(Q, {}, 1)
    ok('a trace says how long it took to record (R.recordMs)', typeof R.recordMs === 'number' && R.recordMs >= 0, String(R.recordMs))
    const on = log.indexOf('hook on'), off = log.indexOf('hook off')
    const firstBegin = log.indexOf('begin'), lastEnd = log.lastIndexOf('end')
    ok('the hook set before the frame\'s first beginFrame, cleared after its last endFrame', on >= 0 && on < firstBegin && off > lastEnd,
        log.map(x => typeof x === 'string' ? x : 'pass').join(' '))
    ok('...across the cut submissions between (a new scene: one per iteration)', log.filter(x => x === 'begin').length > 1)
    const passes = log.filter(x => x && typeof x === 'object')
    ok('every dispatch in the frame timed, each its own pair', passes.length > 0 && passes.every((d, k) => d.timestampWrites.beginningOfPassWriteIndex === 2 * k))
    const r = await R.kernelTimes()
    const names = Object.keys(r.ms).sort()
    ok('...each named by the kernel table, none unknown', names.includes('march') && names.includes('shade') && names.includes('genrays')
        && names.includes('resolve') && !names.includes('other') && r.passes === passes.length, JSON.stringify(r.count))
    // a timed trace that throws in the middle of its frame: no numbers, not the last trace's
    failAfter(3)
    const threw = await R.trace(Q, {}, 1).then(() => null, e => e.message)
    ok('a timed trace that fails before its readback leaves no kernel times, not the previous ones',
        /a dispatch that fails/.test(threw ?? '') && await R.kernelTimes() === null, threw)
    log.length = 0
    ok('timeKernels(false): off, and the hook cleared (a failed trace had left it set)', R.timeKernels(false) === false && log.includes('hook off'))
    log.length = 0
    await R.trace(Q, {}, 1)
    ok('...a trace then sets no hook and times nothing', !log.includes('hook on') && log.every(x => x === null || typeof x === 'string'))
}
{
    const { R } = await engineOn([])
    ok('without the feature: timeKernels(true) says it cannot', R.timeKernels(true) === false)
}
{
    // R.submitEvery: a fast frame is one submission; forced, one per iteration (NO SUBMIT LONG ENOUGH TO BE KILLED)
    const { R, Q, log } = await engineOn([])
    R.frameMs = 100; R._frameMsShape = undefined   // timed (by hand: no shape) and under SPLIT_OVER_MS: not cut
    log.length = 0
    await R.trace(Q, {}, 1)
    const one = log.filter(x => x === 'begin').length
    R.submitEvery = 1; R.frameMs = 100; R._frameMsShape = undefined; log.length = 0
    await R.trace(Q, {}, 1)
    const per = log.filter(x => x === 'begin').length
    ok('submitEvery 1: a submission per iteration where the frame would have been one', one === 1 && per === R.budget + 1 && per > one, `${one} ${per} ${R.budget}`)
    R.submitEvery = 0
}
{
    /* R.frameMs IS THE GPU'S BUSY TIME, not the queue's wait as well (raytrace_main.js, HOW LONG THE GPU WAS BUSY):
       two traces queued, as renderFrame's inFlight 2 queues them, on a clock and a queue the test moves by hand */
    const { R, Q, device } = await engineOn([])
    const dones = [], realNow = performance.now
    let clock = 0
    performance.now = () => clock
    device.queue.onSubmittedWorkDone = () => new Promise(r => dones.push(r))
    const finish = async (k, at) => { clock = at; dones[k](); await new Promise(r => setTimeout(r, 0)) }
    try {
        clock = 0; await R.trace(Q, {}, 1)                     // recorded at 0
        clock = 50; await R.trace(Q, {}, 1)                    // recorded at 50, queued behind the first
        ok('two traces queued: each one timed', dones.length === 2, String(dones.length))
        await finish(0, 100)
        ok('...the first busy from its recording to its end: 100', R.frameMs === 100, String(R.frameMs))
        await finish(1, 200)
        ok('...the second from the first\'s end, not its own recording: 100, not 150', R.frameMs === 100 && R.hud.frameMs === 100, String(R.frameMs))
        clock = 300; await R.trace(Q, {}, 1)
        clock = 310; await R.trace(Q, {}, 1)
        await finish(3, 400)
        ok('...a later frame\'s done first: it reads from its own recording (the other ended at 200)', R.frameMs === 90, String(R.frameMs))
        await finish(2, 410)
        ok('...and the earlier one, back after it, is dropped rather than read near zero', R.frameMs === 90, String(R.frameMs))
        const before = dones.length
        for (let i = 0; i < 6; i++) { clock = 500 + i; await R.trace(Q, {}, 1) }
        ok('no more than four timings outstanding: past them a frame goes untimed', dones.length - before === 4, String(dones.length - before))
        for (let k = before; k < dones.length; k++) await finish(k, 600 + k)
        ok('...and every one settled lets the next frame be timed again', (await R.trace(Q, {}, 1), dones.length === before + 5), String(dones.length))
        await finish(dones.length - 1, 900)
    } finally { performance.now = realNow }
}
{
    /* THE ITERATION BUDGET IS THE WORST CASE (raytrace_main.js, 0.10.0): what the adaptive controller it replaced got
       wrong, each on the real R.trace. The iterations a trace ran are counted, not just R.budget read: with a
       submission per iteration, a trace is iterations + 1 'begin's (as the submitEvery test above). The counters
       readback is a stub whose readings the test decides, landing before the next trace as an awaited sample's does. */
    const { R, Q, log } = await engineOn([])
    let reads = 0, reading = { used: 0, flushed: 0 }
    R.counters.r = async () => { reads++; const a = new Uint32Array(COUNTER_WORDS); a[4] = reading.used; a[5] = reading.flushed; return a }
    const ran = async uniforms => {
        R.submitEvery = 1; R.frameMs = 100; R._frameMsShape = undefined; log.length = 0
        await R.trace(Q, uniforms, 1)
        await new Promise(r => setTimeout(r, 0))          // the readback lands
        return log.filter(x => x === 'begin').length - 1
    }
    const U = { maxbounce: 10, maxiter: 400 }               // worst case (10 + 1) + ceil(400 / 32) = 24
    const HIGH = { maxbounce: 24, maxiter: 400 }            // High quality's maxbounce (quality.js): 25 + 13 = 38
    try {
        // the accident: from the start state (budget 0) a stale `used` under worstCase - 3 sent the first sample to 4
        R.budget = 0; R.used = 8; R.flushed = 0
        const first = await ran(U)
        ok('budget: from budget 0 with a stale used of 8, the first trace runs the worst case, 24, not 4', first === 24 && R.budget === 24, `${first} ${R.budget}`)
        // ...and a reading below the budget, which once shrank it by one a sample, moves nothing
        reading = { used: 8, flushed: 0 }
        const seq = []
        for (let i = 0; i < 4; i++) seq.push(await ran(U))
        ok('budget: readings of used 8 and nothing flushed, four traces on: all at 24', seq.every(n => n === 24) && R.used === 8, seq.join(' '))
        // a rise in the worst case, which a nonzero budget never followed: High quality ran at 24
        const high = await ran(HIGH)
        ok('budget: the worst case rising 24 -> 38 (maxbounce 24) runs 38 at once', high === 38 && R.hud.iterations === 38, `${high} ${R.hud.iterations}`)
        ok('...and falling again runs 24', await ran(U) === 24)
        // flushing, which once grew it, cannot take it past the worst case either
        reading = { used: 24, flushed: 1e6 }
        ok('budget: every ray flushed, still the worst case', await ran(U) === 24)
        // budgetOverride wins, either way, and lets go
        R.budgetOverride = 6
        ok('budgetOverride 6 wins over the worst case', await ran(U) === 6 && R.budget === 6)
        R.budgetOverride = 40
        ok('...over it too: 40 where the worst case is 24', await ran(U) === 40)
        R.budgetOverride = 0
        ok('...and 0 gives the worst case back', await ran(U) === 24)
        // the counters read back every frame (the old autobudget switch skipped it)
        reading = { used: 17, flushed: 5 }
        const before = reads
        const again = await ran(U)
        ok('the counters read back every frame: used and flushed this frame\'s, not left from before', again === 24 && reads === before + 1
            && R.used === 17 && R.flushed === 5, `${again} ${reads - before} ${R.used} ${R.flushed}`)
        ok('...and the old controller\'s properties are gone (0.22.3)', !('autobudget' in R) && !('flushTolerance' in R))
    } finally { R.budgetOverride = 0; R.submitEvery = 0 }
}
{
    /* NO SUBMIT LONG ENOUGH TO BE KILLED, with the budget exact (raytrace_main.js): a frame's time spread over at most
       SPLIT_ITERS (24) iterations, so High quality's 38 is cut no coarser than 24 would have been; and the last pass's
       shadow rounds (THE LAST PASS'S SHADOW ROUNDS) able to end a submission a pair at a time, as an iteration can. */
    const { R, Q, log } = await engineOn([])
    const begins = async (uniforms, frameMs, every = 0, shape = undefined) => {
        R.submitEvery = every; R.frameMs = frameMs; R._frameMsShape = shape; log.length = 0
        await R.trace(Q, uniforms, 1)
        return log.filter(x => x === 'begin').length
    }
    try {
        const HIGH = { maxbounce: 24, maxiter: 400 }               // 38 iterations
        const n = await begins(HIGH, 600)
        ok('split: 38 iterations at 600 ms cut every 6 (24 x 150 / 600), not every 9 (38 x 150 / 600): 7 submissions',
            R.budget === 38 && R.hud.splitEvery === 6 && n === 7, `${R.budget} ${R.hud.splitEvery} ${n}`)
        const m = await begins({ maxbounce: 10, maxiter: 400 }, 600)
        ok('...24 iterations at 600 ms as before: every 6, 5 submissions', R.hud.splitEvery === 6 && m === 5, `${R.hud.splitEvery} ${m}`)
        const few = await begins({ maxbounce: 4, maxiter: 128 }, 600)  // 5 + 4 = 9 iterations: under 24, the count itself
        ok('...under 24 iterations, the frame over its own count: 9 at 600 ms every 2', R.budget === 9 && R.hud.splitEvery === 2 && few === 5,
            `${R.budget} ${R.hud.splitEvery} ${few}`)
        // the shadow rounds: 6 pairs at maxiter 400 (13 rounds of 32 steps), each pair a place to cut
        const NEE = { maxbounce: 10, maxiter: 400, nee: 1 }
        const each = await begins(NEE, 100, 1)
        ok('split: with NEE, a submission per iteration and per pair of the last pass\'s shadow rounds: 24 + 6 + 1', each === 31, String(each))
        ok('...and a fast frame still one submission, rounds and all', await begins(NEE, 100) === 1)
        /* A TIMING COUNTS ONLY FOR A FRAME OF ITS OWN SHAPE: a fast frame's time, measured at 24 iterations, must not
           send High quality's 38 (and its shadow rounds) as one submission; it is cut every iteration until timed */
        const DEF = { maxbounce: 10, maxiter: 400 }
        const other = await begins(HIGH, 100, 0, '24|400|1')
        ok('shape: 100 ms timed on a 24-iteration frame does not decide a 38-iteration frame: cut every iteration', R.hud.splitEvery === 1 && other === 39,   // its first begin, and one after each of 38 cuts
            `${R.hud.splitEvery} ${other}`)
        const same = await begins(DEF, 100, 0, '24|400|1')
        ok('...100 ms timed on the same shape does: one submission', R.hud.splitEvery === Infinity && same === 1, `${R.hud.splitEvery} ${same}`)
        const raised = await begins({ maxbounce: 10, maxiter: 2000 }, 100, 0, '24|400|1')
        ok('...maxiter raised (400 -> 2000): not the shape timed, cut every iteration', R.hud.splitEvery === 1, String(R.hud.splitEvery))
        R.frameMs = null; R._frameMsShape = undefined; await R.trace(Q, DEF, 1); await new Promise(r => setTimeout(r, 0))
        ok('...and the timer records the shape of the frame it timed, its batches with it', R._frameMsShape === '24|400|1', String(R._frameMsShape))
        /* A SAMPLE IN BATCHES (core/photons.js planBatches, 0.38.1): each batch the whole chain, so the frame's time is
           spread over its batches first -- 600 ms in 2 batches is 300 a batch, cut every 12 (24 x 150 / 300), 4 cuts in
           48 iterations. And a time taken at one batch decides nothing at two: cut every iteration until timed. */
        R.releaseBuffers(); const maxRays0 = R.maxRays; R.maxRays = Q.w * Q.h / 2
        try {
            const two = await begins(DEF, 600, 0, '24|400|2')
            ok('batches: 2 at 600 ms, each cut as a 300 ms frame: every 12, 5 submissions', R.batches === 2 && R.hud.splitEvery === 12 && two === 5,
                `${R.batches} ${R.hud.splitEvery} ${two}`)
            const once = await begins(DEF, 100, 0, '24|400|1')
            ok('...a time taken at one batch does not decide two: cut every iteration, 48 cuts', R.hud.splitEvery === 1 && once === 49, `${R.hud.splitEvery} ${once}`)
        } finally { R.maxRays = maxRays0; R.releaseBuffers() }
    } finally { R.submitEvery = 0 }
}
{
    // THE WAVEFRONT LOG on the engine: a snapshot pass before every flip, named, the log reset first and read after
    const { R, Q, log } = await engineOn(['timestamp-query'])
    ok('wavefrontLog(true): on', await R.wavefrontLog(true) === true && !!R.prog_wf_snap)
    R.timeKernels(true)
    await R.trace(Q, {}, 1)
    const r = await R.kernelTimes()
    const flips = r.count.flip, snaps = r.count.wf_snap
    ok('...one snapshot an iteration, named wf_snap, each just before its flip', snaps > 0 && snaps === flips
        && r.seq.every(([n], i) => n !== 'wf_snap' || r.seq[i + 1][0] === 'flip'), JSON.stringify(r.count))
    ok('...and its counts read after the frame', (await R.wavefrontCounts())?.iterations !== undefined)
    ok('wavefrontLog(false): off, and a trace then takes no snapshot', await R.wavefrontLog(false) === false
        && (await R.trace(Q, {}, 1), (await R.kernelTimes()).count.wf_snap === undefined))
    R.timeKernels(false)
    ok('...and no counts left from before it was turned off', await R.wavefrontCounts() === null)
}

//----------------------------------------------------------------------------------------------------------------------
// THE BENCHMARK'S SUMMARY of a row's kernel-timed samples
//----------------------------------------------------------------------------------------------------------------------
{
    const per = [
        { ms: { march: 10, shade: 5 }, count: { march: 24, shade: 24 }, passes: 48, overflow: 0 },
        { ms: { march: 12, shade: 7, lt_build: 3 }, count: { march: 24, shade: 24, lt_build: 1 }, passes: 49, overflow: 0 },
        { ms: { march: 11, shade: 6 }, count: { march: 24, shade: 24 }, passes: 48, overflow: 2 },
    ]
    const s = kernelSummary(per, [30, 31, 29])
    ok('per kernel the median over the samples', s.kernelMs.march === 11 && s.kernelMs.shade === 6, JSON.stringify(s.kernelMs))
    ok('...a kernel absent from a sample counts 0 there (a rebuild every few samples)', s.kernelMs.lt_build === 0)
    ok('gpu ms: the median of each sample\'s total, not the sum of the medians', s.gpuMs === 17 && s.kernelMs.march + s.kernelMs.shade === 17
        && kernelSummary([per[1], per[0], { ms: { march: 1, shade: 30 }, count: {} }]).gpuMs === 22)
    ok('...the samples\' wall clock and count, and an overflow reported', s.kernelWallMs === 30 && s.kernelSamples === 3 && s.kernelOverflow === 2)
    ok('no sample came back: a note, no numbers', kernelSummary([]).kernelsNote && kernelSummary([]).gpuMs === undefined)
    const spans = per.map((r, i) => ({ ...r, spanMs: 20 + i, gapMs: 3 - i }))
    ok('the span and the gaps: medians over the samples, absent when no sample had them',
        kernelSummary(spans).gpuSpanMs === 21 && kernelSummary(spans).gpuGapMs === 2 && kernelSummary(per).gpuGapMs === undefined)
}

console.log(fail ? `kerneltime: ${pass} passed, ${fail} FAILED` : `kerneltime: ${pass} passed, 0 failed`)
process.exit(fail ? 1 : 0)
