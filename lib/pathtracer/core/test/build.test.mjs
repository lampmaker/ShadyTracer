// node lib/pathtracer/core/test/build.test.mjs
//
// A TRACE DURING A BUILD, without a GPU. On a cold load (a new incognito window, 2026-09-30) a redraw asked
// for while R.init compiled the first scene traced with kernels still compiling: "No resources bound" out of
// shade's dispatch, thrown from inside a compute pass that was then never ended, so the frame's command
// buffer was rejected at the next submit ("Command buffer recording ended before [ComputePassEncoder] was
// ended"). The same had been fixed for setScene alone (530a9d7). Two things are checked here, each on a
// device that records instead of drawing:
//   - tinywebgpu opens no pass it cannot bind: the refusal comes before beginComputePass/beginRenderPass,
//     and the frame's finish() finds nothing open;
//   - the engine refuses a trace while any build is in progress or before one has succeeded, before it
//     begins a frame -- whichever build it is, init's or setScene's.
// And tinywebgpu's compute pipeline cache, which every build now goes through: the same text compiled once per
// device (sync, async in flight, a refusal, the bounds, `cache: false`), and the engine's second callers of it --
// a rebuild and setScene's restore all from the cache, the two measurements of what a compile costs never.
// And R.trace over the real tinywebgpu with a builder scene that has uniforms of its own: the four kernels
// that declare only the base uniforms are never handed a scene name, and every program is given the whole bag at
// its first write in a trace and only what moves after it.
import { WEBGPU } from '../../../tinywebgpu/src/tinywebgpu.js'
import { RAYTRACER } from '../raytrace_main.js'
import { sphereScene } from '../profile.js'
import { inlinedSize, kernelMs, DEFAULT_RATE, RATE_KEY, LEARN_MIN_MS } from '../compileprogress.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const threw = (f, re) => { try { f(); return null } catch (e) { return re.test(e.message) ? e : { wrong: e.message } } }
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

//----------------------------------------------------------------------------------------------------------------------
// TINYWEBGPU ON A RECORDING DEVICE (the stub pattern of tinywebgpu's test/layout.test.mjs)
//----------------------------------------------------------------------------------------------------------------------
globalThis.GPUBufferUsage ??= { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 }
globalThis.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 }
globalThis.GPUTextureUsage ??= { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 }

const rec = { open: 0, begun: 0, finishedOpen: [], submitted: 0 }
const passOf = () => {
    rec.open++; rec.begun++
    return { setPipeline() { }, setBindGroup() { }, dispatchWorkgroups() { }, dispatchWorkgroupsIndirect() { }, draw() { }, end() { rec.open-- } }
}
let asyncGate = null
const device = {
    limits: {}, features: new Set(),
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    pushErrorScope() { }, popErrorScope: async () => null,
    createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createComputePipelineAsync: () => asyncGate.promise,
    createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createRenderPipelineAsync: () => asyncGate.promise,
    createBuffer: ({ size, usage }) => ({ size, usage, destroy() { }, mapAsync: async () => { }, getMappedRange: () => new ArrayBuffer(size), unmap() { } }),
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({
        beginComputePass: passOf, beginRenderPass: passOf,
        copyBufferToBuffer() { }, clearBuffer() { },
        finish: () => { rec.finishedOpen.push(rec.open); return {} },
    }),
    queue: { writeBuffer() { }, submit: cbs => { rec.submitted += cbs.length }, onSubmittedWorkDone: async () => { } },
}
const S = WEBGPU()
S.device = device
S.format = 'bgra8unorm'
const view = { createView: () => ({}) }

{
    // a compute kernel that reads a buffer, whose resources nobody set. Each block below has a text of its own:
    // tinywebgpu's pipeline cache hands a text it has compiled back, and whether one block's pipeline reached the
    // next would hang on when a microtask ran (a sync pipeline is entered only once its error scope comes back)
    const p = S.makeCompute('', 'let x = buf[gid.x];', {}, { buf: 'array<f32>' })
    rec.begun = 0; rec.open = 0; rec.finishedOpen.length = 0
    S.beginFrame()
    const e = threw(() => p.dispatch(1, 1, 1), /No resources bound/)
    S.endFrame()
    ok('no resources: the dispatch is refused by name', e && !e.wrong, JSON.stringify(e))
    ok('...before a pass is opened', rec.begun === 0, `${rec.begun} begun`)
    ok('...so the frame finishes with nothing open', rec.finishedOpen.length === 1 && rec.finishedOpen[0] === 0, JSON.stringify(rec.finishedOpen))
}
{
    // the case of the cold load: an async kernel still compiling, its resources set (parked until it arrives)
    asyncGate = deferred()
    const p = S.makeCompute('', 'let still = buf[gid.x];', {}, { buf: 'array<f32>' }, { async: true })
    p.setResources({ buf: S.createStorageBuffer(16) })
    rec.begun = 0; rec.open = 0; rec.finishedOpen.length = 0
    S.beginFrame()
    const e = threw(() => p.dispatchIndirect({ size: 12 }, 0), /No resources bound|still compiling/)
    S.endFrame()
    ok('still compiling: dispatchIndirect is refused', e && !e.wrong, JSON.stringify(e))
    ok('...before a pass is opened, and the frame finishes clean', rec.begun === 0 && rec.finishedOpen[0] === 0, `${rec.begun} begun, open at finish ${rec.finishedOpen}`)
}
{
    // a draw whose resources nobody set: the render pass waits for the check too
    const q = S.makeFrag('fn frag(uv: vec2<f32>) -> vec4<f32> { return vec4<f32>(tex[0u]); }', {}, { tex: 'array<f32>' })
    rec.begun = 0; rec.open = 0; rec.finishedOpen.length = 0
    S.beginFrame()
    const e = threw(() => q.drawTo(view), /No resources bound/)
    S.endFrame()
    ok('a draw with no resources: refused before its render pass, the frame clean', e && !e.wrong && rec.begun === 0 && rec.finishedOpen[0] === 0,
        `${JSON.stringify(e)} ${rec.begun} begun, open at finish ${rec.finishedOpen}`)
}
{
    // and a kernel that can go ahead still does: one pass, begun and ended
    const p = S.makeCompute('', 'let bound = buf[gid.x];', {}, { buf: 'array<f32>' })
    p.setResources({ buf: S.createStorageBuffer(16) })
    rec.begun = 0; rec.open = 0; rec.finishedOpen.length = 0
    S.beginFrame(); p.dispatch(1, 1, 1); S.endFrame()
    ok('a bound kernel: its pass is begun and ended', rec.begun === 1 && rec.finishedOpen[0] === 0, `${rec.begun} begun, open at finish ${rec.finishedOpen}`)
}

//----------------------------------------------------------------------------------------------------------------------
// THE PIPELINE CACHE (tinywebgpu.js makePipeline): the same compute text on the same device compiled once. Every case on
// a device of its own, so each starts with an empty cache; the device counts what a compile costs in WebGPU calls
//----------------------------------------------------------------------------------------------------------------------
const quietly = async f => { const e = console.error, w = console.warn, l = console.log; console.error = console.warn = console.log = () => { }; try { return await f() } finally { console.error = e; console.warn = w; console.log = l } }
const tick = () => new Promise(r => setTimeout(r, 0))     // a sync pipeline is entered once its error scope is back
const countingDevice = () => {
    const n = { modules: 0, sync: 0, async: 0, bindGroups: 0, layouts: [], groupsSet: [] }
    let id = 0
    const pipe = () => { const p = { id: ++id }; p.getBindGroupLayout = () => ({ of: p }); return p }
    const pass = () => ({ setPipeline() { }, setBindGroup: (i, g) => n.groupsSet.push(g), dispatchWorkgroups() { }, dispatchWorkgroupsIndirect() { }, draw() { }, end() { } })
    const dev = {
        // scopeErrors: what a scope of each kind ('validation', 'internal', ...) comes back with; `scopes`, the
        // ones pushed and not yet popped, so a test sees the pushes and pops balance
        n, pipe, gate: null, scopeErrors: {}, scopes: [],
        limits: { maxStorageBufferBindingSize: 2 ** 31, maxBufferSize: 2 ** 32 }, features: new Set(),
        createShaderModule: ({ code }) => (n.modules++, { code, getCompilationInfo: async () => ({ messages: [] }) }),
        pushErrorScope: f => dev.scopes.push(f), popErrorScope: async () => dev.scopeErrors[dev.scopes.pop()] ?? null,
        createComputePipeline: () => (n.sync++, pipe()),
        // a module whose text holds REFUSED_HERE is one the driver refuses; `gate`, when set, holds every async compile
        createComputePipelineAsync: d => (n.async++, /REFUSED_HERE/.test(d.compute.module.code) ? Promise.reject(new Error('refused'))
            : dev.gate ? dev.gate.promise : Promise.resolve(pipe())),
        createRenderPipeline: () => pipe(), createRenderPipelineAsync: async () => pipe(),
        createBuffer: ({ size, usage }) => ({ size, usage, destroy() { }, mapAsync: async () => { }, getMappedRange: () => new ArrayBuffer(size), unmap() { } }),
        createBindGroup: ({ layout }) => (n.bindGroups++, n.layouts.push(layout), {}),
        createCommandEncoder: () => ({ beginComputePass: pass, beginRenderPass: pass, copyBufferToBuffer() { }, clearBuffer() { }, finish: () => ({}) }),
        queue: { writeBuffer() { }, submit() { }, onSubmittedWorkDone: async () => { } },
        destroy() { },
    }
    return dev
}
const onDevice = dev => { const G = WEBGPU(); G.device = dev; G.format = 'bgra8unorm'; return G }
const kernel = (G, tag, opts = {}) => G.makeCompute('', `let v_${tag} = buf[gid.x];`, {}, { buf: 'array<f32>' }, opts)
const made = d => d.n.sync + d.n.async

{
    // 1. the same text twice, sync: one module, one pipeline; each handle still binds and dispatches its own group
    const d = countingDevice(), G = onDevice(d)
    const a = kernel(G, 'same')
    await tick()
    const b = kernel(G, 'same')
    ok('cache, sync: the same text twice is one module and one pipeline', d.n.modules === 1 && d.n.sync === 1, JSON.stringify(d.n))
    ok('...the second handle has the first\'s pipeline, and says it came from the cache', b.pipeline === a.pipeline && b.cached && !a.cached)
    a.setResources({ buf: G.createStorageBuffer(16) }); b.setResources({ buf: G.createStorageBuffer(16) })
    G.beginFrame(); a.dispatch(1); b.dispatch(1); G.endFrame()
    ok('...each handle builds its own bind group, from that one pipeline\'s layout', d.n.bindGroups === 2 && d.n.layouts.every(l => l.of === a.pipeline), `${d.n.bindGroups} groups`)
    ok('...and each dispatch sets its own', d.n.groupsSet.length === 2 && d.n.groupsSet[0] !== d.n.groupsSet[1])
}
{
    // 2. async, the same text asked again while the first compiles: one compile, both handles filled, both replayed
    const d = countingDevice(), G = onDevice(d)
    d.gate = deferred()
    const a = kernel(G, 'inflight', { async: true }), b = kernel(G, 'inflight', { async: true })
    ok('cache, async in flight: one createComputePipelineAsync for two requests', d.n.async === 1 && d.n.modules === 1, JSON.stringify(d.n))
    ok('...the second waits on the first\'s compile, and says so', b.cached && !a.cached && !a.pipeline && !b.pipeline)
    a.setResources({ buf: G.createStorageBuffer(16) }); b.setResources({ buf: G.createStorageBuffer(16) })
    ok('...resources parked on both while it compiles', d.n.bindGroups === 0)
    d.gate.resolve(d.pipe())
    const [pa, pb] = await Promise.all([a.ready, b.ready])
    ok('...both `ready`s resolve to the same pipeline, and both handles hold it', pa === pb && a.pipeline === pa && b.pipeline === pa)
    ok('...and the resources parked on each were replayed onto it', d.n.bindGroups === 2 && d.n.layouts.every(l => l.of === pa), `${d.n.bindGroups} groups`)
    d.gate = null
    const c = kernel(G, 'inflight')
    ok('...once it has arrived a sync request for the text takes it too', c.pipeline === pa && c.cached && d.n.sync === 0)
}
{
    // 3. an async compile the driver refuses: every request waiting on it hears it, and the entry is dropped
    const d = countingDevice(), G = onDevice(d)
    const text = 'let REFUSED_HERE = buf[gid.x];'
    const a = G.makeCompute('', text, {}, { buf: 'array<f32>' }, { async: true })
    const b = G.makeCompute('', text, {}, { buf: 'array<f32>' }, { async: true })
    const ra = await quietly(() => a.ready.then(() => 'resolved', e => e.message)), rb = await b.ready.then(() => 'resolved', e => e.message)
    ok('cache, a refused compile: both requests reject', ra === 'refused' && rb === 'refused', `${ra} ${rb}`)
    const c = G.makeCompute('', text, {}, { buf: 'array<f32>' }, { async: true })
    await quietly(() => c.ready.catch(() => { }))
    ok('...and the next request compiles again (the failure was not kept)', d.n.async === 2 && !c.cached, JSON.stringify(d.n))
}
{
    // 4. cache: false -- never looked up, never entered, and a full cache is left as it was
    const d = countingDevice(), G = onDevice(d)
    G.pipelineCacheMax = 2
    const a = kernel(G, 'A', { async: true }), b = kernel(G, 'B', { async: true })
    const before = made(d)
    const fa = kernel(G, 'A', { async: true, cache: false })
    ok('cache: false on a cached text: compiled again, not from the cache', made(d) === before + 1 && !fa.cached)
    for (const t of ['C', 'D', 'E']) kernel(G, t, { async: true, cache: false })
    const n0 = made(d)
    const a2 = kernel(G, 'A', { async: true }), b2 = kernel(G, 'B', { async: true })
    ok('...three more uncached never pushed out the two cached (room for two)', made(d) === n0 && a2.cached && b2.cached, `${made(d) - n0} compiled`)
    await Promise.all([a.ready, b.ready, fa.ready, a2.ready])
    ok('...and what a cached request gets is the cached pipeline, not the uncached one', a2.pipeline === a.pipeline && fa.pipeline !== a.pipeline)
    const c = kernel(G, 'C', { async: true })
    ok('...nor was an uncached one entered: the same text asked for with the cache is compiled', !c.cached && made(d) === n0 + 1)
}
{
    // 5 and 6. what is not the text but is in the key: G.defines, and the device
    const d = countingDevice(), G = onDevice(d)
    kernel(G, 'k', { async: true })
    G.defines = 'SOMETHING f32'
    const x = kernel(G, 'k', { async: true })
    ok('cache: the same text under other defines is a miss', !x.cached && d.n.async === 2)
    G.defines = ''
    ok('...and under the first defines a hit again', kernel(G, 'k', { async: true }).cached)
    const d2 = countingDevice()
    G.device = d2
    const y = kernel(G, 'k', { async: true })
    ok('cache: another device is a miss (its pipelines are its own)', !y.cached && d2.n.async === 1)
    G.device = d
    ok('...and back on the first device, a hit', kernel(G, 'k', { async: true }).cached && d.n.async === 2)
    const G2 = onDevice(d)
    ok('...which a second instance on the same device shares', kernel(G2, 'k', { async: true }).cached && d.n.async === 2)
    G2.destroy()
    ok('...and destroy() empties it: a request after, on the instance still open, is compiled', !kernel(G, 'k', { async: true }).cached && d.n.async === 3)
}
{
    // 7. the bounds: past pipelineCacheMax the least recently used goes, and a hit makes an entry the most recent
    const d = countingDevice(), G = onDevice(d)
    G.pipelineCacheMax = 3
    for (const t of ['A', 'B', 'C']) kernel(G, t, { async: true })
    ok('cache, LRU: a hit within the bound', kernel(G, 'A', { async: true }).cached)      // now B, C, A
    kernel(G, 'D', { async: true })                                                        // B goes: C, A, D
    const hitA = kernel(G, 'A', { async: true }).cached, hitC = kernel(G, 'C', { async: true }).cached   // D, A, C
    const missB = !kernel(G, 'B', { async: true }).cached                                   // D goes: A, C, B
    ok('...a fourth pushed out the least recently used (B), not the oldest made (A, used since)', hitA && hitC && missB, `${hitA} ${hitC} ${missB}`)
    ok('...and the one entered then pushed out D', !kernel(G, 'D', { async: true }).cached)
    // ...and the characters: room for two keys of this length, so a third pushes the first out
    const d2 = countingDevice(), G2 = onDevice(d2)
    const k1 = kernel(G2, 'P', { async: true })
    G2.pipelineCacheChars = Math.floor(2.5 * `C|main||${k1.wgsl}`.length)
    kernel(G2, 'Q', { async: true }); kernel(G2, 'R', { async: true })
    const q = kernel(G2, 'Q', { async: true }).cached, r = kernel(G2, 'R', { async: true }).cached, pGone = !kernel(G2, 'P', { async: true }).cached
    ok('cache, the characters\' bound: the third key pushed the first out, the other two kept', q && r && pGone, `${q} ${r} ${pGone}`)
    G2.pipelineCacheChars = 10
    ok('...and a key longer than the bound by itself is not kept at all', !kernel(G2, 'S', { async: true }).cached && !kernel(G2, 'S', { async: true }).cached)
}
{
    // 8. a sync pipeline is entered only once its error scope is back clean: one in error never is
    const d = countingDevice(), G = onDevice(d)
    d.scopeErrors = { validation: { message: 'invalid' } }
    await quietly(async () => { kernel(G, 'bad'); await tick() })
    d.scopeErrors = {}
    ok('cache, sync: a pipeline whose error scope reported an error is not kept', !kernel(G, 'bad').cached && d.n.sync === 2)
    // an internal error -- a backend compile that failed -- is no validation error: a validation scope alone
    // came back clean on it, and the invalid pipeline was kept and handed to the next request (review, 2026-10-03)
    for (const kind of ['internal', 'out-of-memory']) {
        d.scopeErrors = { [kind]: { message: kind } }
        const n0 = d.n.sync
        await quietly(async () => { kernel(G, `bad_${kind.replace(/-/g, '_')}`); await tick() })
        d.scopeErrors = {}
        const again = kernel(G, `bad_${kind.replace(/-/g, '_')}`)
        await tick()
        ok(`...nor one whose ${kind} scope reported an error: the next request compiles again`, !again.cached && d.n.sync === n0 + 2, JSON.stringify(d.n))
    }
    ok('...and every scope pushed was popped', d.scopes.length === 0, d.scopes.join(' '))
    const s0 = d.n.sync
    kernel(G, 'fresh')
    const tooSoon = kernel(G, 'fresh')
    await tick()
    ok('...nor one whose scope has not come back yet (compiled again), but after it has, kept', !tooSoon.cached && kernel(G, 'fresh').cached && d.n.sync === s0 + 2, JSON.stringify(d.n))
}

//----------------------------------------------------------------------------------------------------------------------
// THE ENGINE ON A RECORDING WG: every create* a stub buffer, makeCompute a kernel whose `ready` the test holds
//----------------------------------------------------------------------------------------------------------------------
{
    const frames = []
    let gate = deferred()
    const stubBuffer = () => ({ b: {}, w() { }, r: async () => new Float32Array(16), clear() { }, destroy() { }, size: 0 })
    const WG = new Proxy({
        device: { limits: {}, queue: { onSubmittedWorkDone: async () => { } } },
        beginFrame: () => frames.push('begin'), endFrame: () => frames.push('end'),
        makeCompute: () => ({ ready: gate.promise, setResources() { }, set resources(v) { }, set uniforms(v) { } }),
    }, { get: (t, k) => k in t ? t[k] : (typeof k === 'string' && /^create/.test(k) ? stubBuffer : undefined) })
    const Q = { w: 8, h: 8, resetframecount: 0 }
    const R = RAYTRACER(WG, null, Q, sphereScene({ id: 'stub', uniforms: {} }))
    R.rebind = () => { }                 // what the kernels are bound to is not this test's; the window is
    R.hud = () => { }
    const refusal = /trace while the scene's pipelines are being built \(or never were\)/
    const traced = async () => { try { await R.trace(Q, {}, 1); return null } catch (e) { return e.message } }

    ok('before any build: nothing built, nothing building', R._built === false && R._building === 0)
    ok('...a trace is refused by name', refusal.test(await traced() ?? ''))
    ok('...before a frame is begun', frames.length === 0, frames.join(' '))

    const ends = [], stubTold = []
    R.compileListeners.add(p => { if (p.end) ends.push({ building: R._building, built: R._built }) })
    R.compileListeners.add(p => stubTold.push(p))
    const build = R._buildWavefrontPipelines()
    await new Promise(r => setTimeout(r, 0))             // the kernels made, installed, their `ready` held
    ok('during a build: building, not built', R._building === 1 && R._built === false, `${R._building} ${R._built}`)
    ok('...and a trace is refused, before a frame', refusal.test(await traced() ?? '') && frames.length === 0)
    gate.resolve({})
    await build
    ok('once every kernel is ready: built, no longer building', R._building === 0 && R._built === true, `${R._building} ${R._built}`)
    ok('...and the end notice came after the building count fell, with the build done (a redraw on it finds the renderer ready)',
        ends.length === 1 && ends[0].building === 0 && ends[0].built === true, JSON.stringify(ends))
    const after = await traced()
    ok('...a trace is no longer refused (whatever the stub then lacks)', !refusal.test(after ?? ''), after)
    ok('...and no prediction from handles that hold no text (compileprogress.js): the host shows the count, as before',
        stubTold.length > 0 && stubTold.every(p => p.expectMs === undefined), JSON.stringify(stubTold.find(p => p.expectMs !== undefined)))

    gate = deferred()
    const failing = R._buildWavefrontPipelines()
    await new Promise(r => setTimeout(r, 0))
    ok('a second build (setScene\'s): refused again while it runs', R._building === 1 && R._built === false && refusal.test(await traced() ?? ''))
    gate.reject(new Error('a kernel that does not compile'))
    const err = await failing.then(() => null, e => e.message)
    ok('a build that fails: it says so, and leaves nothing built', /does not compile/.test(err ?? '') && R._building === 0 && R._built === false, `${err} ${R._building} ${R._built}`)
    ok('...so a trace is still refused', refusal.test(await traced() ?? ''))

    /* A SCENE THAT WILL NOT BUILD, through setScene (the user, 2026-10-02: a material that would not compile, and the
       program stuck): the scene before is put back and built again, and the failure still reaches the caller */
    gate = deferred(); gate.resolve({})
    await R._buildWavefrontPipelines()                  // a good scene, built
    const good = R.scene
    ok('a good scene built', R._built === true)
    gate = deferred()
    const bad = sphereScene({ id: 'bad', uniforms: {} })
    const swap = R.setScene(bad).then(() => null, e => e)
    await new Promise(r => setTimeout(r, 0))
    const refused = gate
    gate = deferred(); gate.resolve({})                  // the scene before builds: the next kernels made are its
    refused.reject(new Error('a kernel of the bad scene does not compile'))
    const e = await swap
    ok('setScene of a scene that will not build: the caller hears it', /does not compile/.test(e?.message ?? ''), e?.message)
    ok('...marked restored: the scene before is the scene again, and built', e?.restored === true && R.scene === good && R._built === true && R._building === 0,
        `${e?.restored} ${R.scene?.id} ${R._built} ${R._building}`)
    ok('...so a trace is no longer refused', !refusal.test(await traced() ?? ''))
}

// the build's kernels but the shadow flip, as raytrace_main.js wavefrontKernels names their properties
const BUILD_PROPS = ['prog_genrays2', 'prog_wvfmarch', 'prog_wvfsurface', 'prog_wvfshade', 'prog_wvfflip', 'prog_prep_march', 'prog_prep_shade', 'prog_wvfocclude',
    'prog_prep_occlude', 'prog_resolve', 'prog_genphotons', 'prog_lt_build', 'prog_emit_collect', 'prog_emit_publish']

/* THE ENGINE ON THE REAL TINYWEBGPU AND THE CACHE: the build's second callers. A rebuild of the same scene, and setScene's
   restore after a scene that will not build, take every kernel from the cache; the two measurements that exist to
   compile (R.compileUncached for the benchmark's columns, R._profileCompile from the console) still compile all of theirs */
{
    const d = countingDevice(), G = onDevice(d)
    const Q = { w: 8, h: 8, resetframecount: 0 }
    const A = { ...sphereScene({ uniforms: {} }), id: 'A' }
    const R = RAYTRACER(G, null, Q, A)
    R.hud = () => { }
    const first = []
    const firstFn = p => first.push(p)
    R.compileListeners.add(firstFn)
    await quietly(() => R.init())
    R.compileListeners.delete(firstFn)
    ok('engine, cache: the first build compiles every kernel', R._built === true && R._lastCompile?.fromCache === 0 && R._lastCompile?.total === 16,
        JSON.stringify(R._lastCompile))
    /* THE PREDICTION (compileprogress.js), told on the build that compiles: once the kernels are requested, and on every
       notice after; the count itself unchanged -- 0, 0 again with the prediction, then 1 to 16 (15 before the surface kernel) -- for the listeners
       that read only it (index.js's redraw, the studio's bar, the boxes' hold) */
    const firstExpect = first.find(p => p.expectMs !== undefined)
    ok('engine, progress: a build that compiles tells a prediction, in ms, with when it was requested',
        firstExpect?.expectMs > 0 && Number.isFinite(firstExpect?.startedAt) && R._lastCompile?.expectMs === firstExpect?.expectMs, JSON.stringify(firstExpect))
    const sizes = BUILD_PROPS.map(k => inlinedSize(R[k]?.wgsl, G.defines) ?? 0)
    ok('...the inlined size of the biggest kernel at the default rate: the max over the kernels, not their sum',
        sizes.every(n => n > 0) && firstExpect?.expectMs === Math.round(kernelMs(Math.max(...sizes), DEFAULT_RATE)), `${firstExpect?.expectMs} vs ${sizes}`)
    ok('...on every notice after it, the end excepted', first.slice(first.indexOf(firstExpect)).every(p => p.end || p.expectMs === firstExpect.expectMs))
    ok('...and the count as before: 0, 0 with the prediction, 1 to 16, then the end', first.filter(p => !p.end).map(p => p.done).join() === '0,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16'
        && first.at(-1)?.end === true && first.every(p => p.total === 16), JSON.stringify(first.map(p => p.done)))
    const told = []
    R.compileListeners.add(p => told.push(p))
    let before = made(d)
    await quietly(() => R._buildWavefrontPipelines())
    ok('...the same scene again: no pipeline made, all 16 from the cache', made(d) === before && R._lastCompile?.fromCache === 16, `${made(d) - before} made`)
    ok('...and the compile notices still run 0 to 16 and end, with the scene built', told[0]?.done === 0 && told.at(-1)?.end === true
        && told.filter(p => !p.end).map(p => p.done).join() === '0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16' && R._built === true, JSON.stringify(told.map(p => p.done)))
    ok('...with no prediction: nothing compiles, so the host shows the count', told.every(p => p.expectMs === undefined) && R._lastCompile?.expectMs === null,
        JSON.stringify(told.find(p => p.expectMs !== undefined)))

    const B = { ...sphereScene({ uniforms: {} }), id: 'B' }
    B.wgsl += '\n// REFUSED_HERE: the recording device refuses any async kernel holding this\n'
    before = made(d)
    const e = await quietly(() => R.setScene(B).then(() => null, e => e))
    ok('engine, cache: a scene that will not build is refused, and the one before put back', e?.restored === true && R.scene === A && R._built === true, `${e?.message} ${e?.restored}`)
    ok('...rebuilt all from the cache', R._lastCompile?.scene === 'A' && R._lastCompile?.fromCache === 16, JSON.stringify(R._lastCompile))

    before = made(d)
    G.pipelineCacheMax = 16          // room for the live build alone: sixteen more entered would push all of it out
    const u = await quietly(() => R.compileUncached(R.scene))
    ok('engine, cache: compileUncached still compiles all 16, none from the cache', made(d) === before + 16 && u.failed.length === 0, `${made(d) - before} made, failed ${u.failed}`)
    before = made(d)
    await quietly(() => R._buildWavefrontPipelines())
    ok('...and entered none of them: the live build is still all from the cache', made(d) === before && R._lastCompile?.fromCache === 16)
    G.pipelineCacheMax = 48
    /* THE PREDICTION WITHOUT A COMPILE (R.predictCompile, for the benchmark, which does not start a row predicted to take
       minutes): nothing made, and what the build itself predicted for the same scene -- within the schema's and the entry
       point's few characters, which its text leaves out (the rate's fit, shaderstats.mjs, left them out too) */
    before = made(d)
    const guess = await quietly(() => R.predictCompile(R.scene))
    ok('engine, prediction: R.predictCompile compiles nothing', made(d) === before, `${made(d) - before} made`)
    ok('...and predicts what the build predicted for the scene, within 2%', guess?.slowest && Math.abs(guess.expectMs / firstExpect.expectMs - 1) < 0.02,
        `${JSON.stringify(guess)} vs ${firstExpect.expectMs}`)
}

/* THE RATE LEARNED FROM A BUILD (compileprogress.js learnRate), on the engine: a build whose async kernels the device
   holds past the threshold keeps a rate per machine (localStorage, a stand-in here) -- the EMA of the one it predicted
   with and what its slowest uncached kernel took per character; a build all from the cache keeps it as it was; one
   quicker than the threshold too; and a storage that throws stops nothing */
{
    const mem = new Map()
    const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    const setStore = v => Object.defineProperty(globalThis, 'localStorage', { configurable: true, ...v })
    setStore({ value: { getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v)) } })
    try {
        const d = countingDevice(), G = onDevice(d)
        const Q2 = { w: 8, h: 8, resetframecount: 0 }
        const R = RAYTRACER(G, null, Q2, { ...sphereScene({ uniforms: {} }), id: 'L' })
        R.hud = () => { }
        d.gate = deferred()
        const held = setTimeout(() => d.gate.resolve(d.pipe()), LEARN_MIN_MS + 80)
        await quietly(() => R.init())
        clearTimeout(held)
        d.gate = null
        const kept = Number(mem.get(RATE_KEY))
        // the slowest uncached kernel's rate, from the build's own numbers: it lies between the default and what the rate became
        ok('engine, learning: a build held past the threshold keeps a rate, the one it reports', Number.isFinite(kept) && kept > 0 && kept !== DEFAULT_RATE && kept === R._lastCompile?.rate,
            `${mem.get(RATE_KEY)} ${R._lastCompile?.rate}`)
        const sizes = BUILD_PROPS.map(k => inlinedSize(R[k]?.wgsl, G.defines) ?? 0), seen = 2 * kept - DEFAULT_RATE
        ok('...half of it the default, half the time per character of the slowest kernel (at least the hold over the biggest kernel)',
            seen >= (LEARN_MIN_MS + 80) / Math.max(...sizes) * 0.95, `seen ${seen}, sizes ${sizes}`)
        // a stub's kernels are tiny, so the hold is a slow build per character: the step limit (MAX_SEEN) is what bounds it
        ok('...and no more than twice the rate it predicted with: one build moves it no further', kept > DEFAULT_RATE && kept <= 2 * DEFAULT_RATE * (1 + 1e-9),
            `${kept / DEFAULT_RATE} x the default`)
        await quietly(() => R._buildWavefrontPipelines())
        ok('...a rebuild all from the cache keeps it as it was', R._lastCompile?.fromCache === 16 && Number(mem.get(RATE_KEY)) === kept)
        const C = { ...sphereScene({ uniforms: {} }), id: 'C' }
        C.wgsl += '\n// a scene of its own text: compiled, quickly\n'
        await quietly(() => R.setScene(C))
        ok('...a build that compiled, but quicker than the threshold, keeps it too', R._lastCompile?.scene === 'C' && R._lastCompile?.fromCache < 13 && Number(mem.get(RATE_KEY)) === kept,
            JSON.stringify(R._lastCompile))
        /* SHADE HOLDS NO SCENE (0.20.8, roadmap/ARCHITECTURE.md step 2): a scene change compiles march, the surface kernel
           and occlusion, and finds shade in the cache -- its text the same whatever the scene */
        ok('engine, step 2: a scene change takes shade from the cache and compiles the surface kernel',
            R.prog_wvfshade?.cached === true && R.prog_wvfsurface?.cached === false && R.prog_wvfmarch?.cached === false,
            `shade ${R.prog_wvfshade?.cached}, surface ${R.prog_wvfsurface?.cached}, march ${R.prog_wvfmarch?.cached}`)
        // a storage that throws on any access: the build predicts at the default and finishes
        setStore({ get() { throw new Error('SecurityError') } })
        const told = []
        R.compileListeners.add(p => told.push(p))
        const D2 = { ...sphereScene({ uniforms: {} }), id: 'D2' }
        D2.wgsl += '\n// another text\n'
        const e = await quietly(() => R.setScene(D2).then(() => null, e => e))
        ok('...a storage that throws: the build still predicts (at the default) and finishes', e === null && R._built === true && told.some(p => p.expectMs > 0) && told.at(-1)?.end === true,
            `${e?.message} ${R._built}`)
        /* A SCENE COMPILED WITHOUT SHOWING IT (R.precompile: the builder's bake in the background, baker.js): its kernels
           into the pipeline cache while the scene shown stays shown, so its setScene afterwards compiles nothing -- and,
           kept (keepPicture: a baked scene draws the same picture), leaves the samples and the light map alone */
        const E = { ...sphereScene({ uniforms: {} }), id: 'E' }
        E.wgsl += '\n// a text of its own, baked in the background\n'
        const shownBefore = R.scene, progs = BUILD_PROPS.map(k => R[k])
        const pre = await quietly(() => R.precompile(E))
        ok('engine, precompile: every kernel of a scene not shown compiled, its own text new to the cache, and the scene shown untouched',
            pre && pre.total === 18 && pre.compiled > 0 && pre.compiled < pre.total && R.scene === shownBefore && BUILD_PROPS.every((k, i) => R[k] === progs[i]),
            JSON.stringify(pre))
        const again = await quietly(() => R.precompile(E))
        ok('...asked again: none compiled, every one from the cache', again.compiled === 0, JSON.stringify(again))
        R.frame_u32.clear = () => { R._cleared = true }
        Q2.resetframecount = 0
        R._cleared = false
        await quietly(() => R.setScene(E, { keepPicture: true }))
        ok('...shown with keepPicture: all from the cache, the picture not started again (nothing cleared, no reset)', R.scene === E
            && R._lastCompile?.fromCache === R._lastCompile?.total && !R._cleared && Q2.resetframecount === 0, JSON.stringify(R._lastCompile))
        await quietly(() => R.setScene(D2))
        ok('...and a scene swapped in without it starts the picture again, as always', R._cleared === true && Q2.resetframecount === 1)
    } finally {
        if (had) Object.defineProperty(globalThis, 'localStorage', had); else delete globalThis.localStorage
    }
}

/* R.TRACE ON THE REAL TINYWEBGPU WITH A GENERATED SCENE: the uniforms every kernel is handed. Nothing else runs
   R.trace through tinywebgpu with a scene that has uniforms of its own -- the other engine tests use a stub WG
   whose `uniforms` setter takes anything, or the sphere scene with none -- so neither of the two ways this can go
   wrong would be seen without a GPU:
   - genrays, resolve, genphotons and emit_collect declare the base uniforms only (genrays.js), and tinywebgpu
     throws on a name its schema lacks: one call site handing them the whole bag, scene names and all, throws on
     the first frame. (TRACE2, a second flow with two such call sites that ran only when someone switched it on,
     was run here until it was removed in 0.22.2.)
   - each program's first write in a trace is the whole bag and the writes after it only what moves (R.trace, ONE
     WHOLE BAG PER PROGRAM PER TRACE): a field left out of `sample` or `moves`, or a `wrote` kept from one trace to
     the next, keeps a stale value -- the same seed every iteration, lastpass stuck, a slider that does nothing.
   Each program's handle is wrapped to keep what it was told, merged as tinywebgpu merges it (layout.test.mjs holds
   that), and every dispatch records the merged view; the writes still go through tinywebgpu, so it still throws. */
{
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const repo = fileURLToPath(new URL('../../../../', import.meta.url))
    const Model = await import('../../../../builder/model.js')
    const { generate } = await import('../../../../builder/codegen.js')
    const U = await import('../uniforms.schema.js')
    const { derive } = await import('../photometry.js')
    const { EMIT_EPOCH } = await import('../raytrace_main.js')
    const { OCCLUDE_STEPS } = await import('../wavefront.js')
    const { raygenTiles } = await import('../genrays.js')
    const { defines, TOKENS, SHORT_TOKENS } = await import('../../../wgsl_shorthand.js')
    const doc = Model.parse(readFileSync(`${repo}test/fixtures/scenes/demo.json`, 'utf8'))
    const scene = generate(...Model.generateArgs(doc, { id: 'demo', title: 'demo.json' }))
    const sceneNames = Object.keys(scene.uniforms)
    const d = countingDevice(), G = onDevice(d)
    G.context = { getCurrentTexture: () => ({ createView: () => ({}) }), canvas: {} }
    G.defines = defines(TOKENS, SHORT_TOKENS)
    const Q = { w: 8, h: 8, resetframecount: 1 }
    const R = RAYTRACER(G, null, Q, scene)
    R.hud = () => { }
    await quietly(() => R.init())
    ok('trace uniforms: a builder scene with uniforms of its own (demo.json) built', R._built === true && sceneNames.length > 0, `${R._built} ${sceneNames.length}`)

    // the bag the page hands R.trace (index.js buildUniforms, as shaderstats builds it), with NEE, light tracing and
    // the emitter list on, so occlude, genphotons and emit_collect all run
    const ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    const values = { ...U.defaultUniformValues() }
    for (const [k, v] of Object.entries(scene.uniforms)) values[k] = U.uniformToGPU(v.def, v.type)
    for (const [k, v] of Object.entries(doc.environment || {})) if (k in U.UniformSpec) values[k] = v
    const types = U.computeUniformTypes(scene.uniforms)
    const bagOf = over => Object.fromEntries(Object.entries({ ...values, ...derive(values, { unit: scene.unit, extent: scene.extent }),
        invView: ident, invProjection: ident, camPos: [0, -5, 2, 1], camtype: 0,
        nee: 1, lt: 1, ltPhotons: 1, ...over }).filter(([k]) => k in types))
    R.emitCount = 1                         // an emitter "found": photons run with or without a sun

    // ...and another module's photons, as the optics source lights the picture: a whole bag, scene names and all
    const given = []
    // its flux per photon neither 1 nor 0, so the ltLightFlux handed on is told from a flag or a default
    R.photonSources.push({ name: 'stand-in', perPixel: () => 0.5, ready: () => true, why: () => '', fluxPerPhoton: () => 0.75,
                           generate: ({ uniforms, offset, count, total }) => given.push({ ...uniforms, _at: { offset, count, total } }) })

    const PROGS = ['prog_genrays2', 'prog_genphotons', 'prog_wvfmarch', 'prog_wvfsurface', 'prog_wvfshade', 'prog_wvfocclude', 'prog_resolve', 'prog_emit_collect']
    const FREE = ['prog_genrays2', 'prog_genphotons', 'prog_resolve', 'prog_emit_collect']
    // ...and shade, since 0.20.8: no scene in it (wavefront.js prog_surface asks the scene), so the base uniforms alone
    const BASE_ONLY = [...FREE, 'prog_wvfshade']
    const SCENE_KERNELS = ['prog_wvfmarch', 'prog_wvfsurface', 'prog_wvfocclude']
    const plain = v => ArrayBuffer.isView(v) ? [...v] : v
    const same = (a, b) => JSON.stringify(plain(a)) === JSON.stringify(plain(b))
    let log = [], flips = []
    const track = () => {
        log = []; flips = []
        // the last pass's shadow flips, by where they fall among occlude's dispatches (they hold no uniforms)
        { const h = R.prog_shadow_flip, f = h.dispatch; h.dispatch = (...a) => (flips.push(log.filter(e => e.prop === 'prog_wvfocclude').length), f(...a)) }
        for (const prop of PROGS) {
            const h = R[prop], view = {}
            const set = Object.getOwnPropertyDescriptor(h, 'uniforms').set
            Object.defineProperty(h, 'uniforms', { configurable: true, set(v) { set.call(h, v); for (const k in v) view[k] = plain(v[k]) } })
            for (const m of ['dispatch', 'dispatchIndirect', 'run']) { const f = h[m]; h[m] = (...a) => (log.push({ prop, view: { ...view } }), f(...a)) }
        }
    }
    const trace = async (bag, n) => { try { await quietly(() => R.trace(Q, bag, n)); return null } catch (e) { return e.message } }

    ok('...the four scene-free kernels and shade declare the base uniforms, exactly, and no scene name',
        BASE_ONLY.every(p => same(R[p].uniformFields, Object.keys(U.ComputeUniformTypes)) && !sceneNames.some(n => R[p].uniformFields.includes(n))),
        BASE_ONLY.map(p => `${p} ${R[p].uniformFields.length}`).join(', '))
    ok('...and march, the surface kernel and occlude every one of the scene\'s', SCENE_KERNELS.every(p => sceneNames.every(n => R[p].uniformFields.includes(n))))

    track()
    const bag1 = bagOf({})
    const SAMPLES = Math.max(3, EMIT_EPOCH)
    const e1 = await trace(bag1, SAMPLES)
    ok('trace uniforms: a trace of the whole bag, no unknown uniform thrown', e1 === null, e1)
    /* WHAT EACH PROGRAM SHOULD HOLD: the bag R.trace read (with the sky's scale, cached by now) and, over it, the
       frame's own numbers R.trace works out -- res, the raygen tiles, the photon counts and the four light-tracing
       switches -- rebuilt here from what that trace left on R, by R.trace's own rules. These are checked, not
       skipped: they are the fields whose source moved when the scene-free four were handed the base names
       (forCompute of baseUniforms) and march, shade and occlude a bag of their own. Either built from the bag the
       page passed instead would map the rays to the wrong pixels or march none, and an earlier version of this test,
       which skipped these, stayed green under both (tried, 2026-10-03). Only what moves is left to its own checks
       further down: the seed, the window and lastpass, the clock for the four that are handed one, and raycount for
       resolve and emit_collect, which were never handed one. */
    const expected = async bag => {
        const lit = R.photonPlan.sources.filter(s => s.got > 0).length
        return { ...(await R.ensureSky(bag)), res: [Q.w, Q.h], ...raygenTiles(R.raycount, Q.w, Q.h), raycount: R.raycount,
                 photoncount: R.photoncount, emitPhotons: R.emitPhotons,
                 lt: R.photoncount - R.emitPhotons > 0 ? 1 : 0, ltEmit: R.emitPhotons > 0 ? 1 : 0, ltLights: R.extraPhotons > 0 ? 1 : 0,
                 ltLightFlux: lit === 1 ? 0.75 : 0 }
    }
    const ref = await expected(bag1)
    ok('...the frame\'s own numbers are ones a slip would show: sun photons, emitter probes and the other source\'s, raycount not the bag\'s',
        R.photoncount > R.emitPhotons && R.emitPhotons > 0 && R.extraPhotons > 0 && ref.ltLightFlux === 0.75 && ref.raycount !== bag1.raycount,
        `${R.photoncount} ${R.emitPhotons} ${R.extraPhotons} ${ref.ltLightFlux} ${ref.raycount} ${bag1.raycount}`)
    const MOVES = new Set(['seed', 'maxaverages', 'lastpass'])
    const moving = (prop, k) => MOVES.has(k)
                             || ((prop === 'prog_resolve' || prop === 'prog_emit_collect') && k === 'raycount')
    const stale = (e, bag) => Object.keys(bag).filter(k => !moving(e.prop, k) && R[e.prop].uniformFields.includes(k) && !same(e.view[k], bag[k]))
    const of = p => log.filter(e => e.prop === p)
    const march = of('prog_wvfmarch'), surf = of('prog_wvfsurface'), shade = of('prog_wvfshade'), occl = of('prog_wvfocclude'), gen = of('prog_genrays2')
    ok('...every program dispatched: genrays, genphotons, march, surface, shade, occlude, resolve, emit_collect, and the other source',
        PROGS.every(p => of(p).length > 0) && given.length === SAMPLES, PROGS.map(p => `${p} ${of(p).length}`).join(', ') + `, source ${given.length}`)
    const bad = log.map(e => [e.prop, stale(e, ref)]).filter(([, s]) => s.length)
    ok('...at every dispatch each program holds the bag\'s value of every field it declares', bad.length === 0, JSON.stringify(bad.slice(0, 3)))
    ok('...and the scene-free four and shade never a scene name', log.filter(e => BASE_ONLY.includes(e.prop)).every(e => !sceneNames.some(n => n in e.view)))
    const iters = march.length / SAMPLES
    /* THE LAST PASS'S SHADOW ROUNDS (raytrace_main.js): occlude once an iteration, and on the last pass 2 x pairs more,
       enough rounds of OCCLUDE_STEPS for a shadow ray from step 0 to pass maxiter -- 13 at 400 -- with a shadow flip
       before each extra round. Every round but the last requeues (lastpass 0), the last deposits (lastpass 1). */
    const pairs = Math.ceil((Math.ceil(((bag1.maxiter | 0) + 1) / OCCLUDE_STEPS) - 1) / 2)
    const per = iters + 2 * pairs
    ok('...march, surface, shade and occlude dispatched together, the same number of times in every sample', Number.isInteger(iters) && iters >= 2
        && surf.length === march.length && shade.length === march.length && occl.length === SAMPLES * per && gen.length === SAMPLES,
        `${march.length} ${surf.length} ${shade.length} ${occl.length} ${gen.length}`)
    const occlOf = (s, k) => occl[s * per + k]                     // sample s, the k-th occlude dispatch of it
    // shade's fields are the base ones: march's view of those
    const baseOf = v => Object.fromEntries(Object.keys(U.ComputeUniformTypes).filter(k => k in v).map(k => [k, v[k]]))
    const sameFields = (a, b) => { const ka = Object.keys(a).sort(), kb = Object.keys(b).sort(); return same(ka, kb) && ka.every(k => same(a[k], b[k])) }
    ok('...in each iteration all four hold the same values, shade those it declares (the last pass\'s rounds below)',
        march.every((m, i) => same(m.view, surf[i].view) && sameFields(baseOf(m.view), shade[i].view)
        && (i % iters === iters - 1 || same(m.view, occlOf(Math.floor(i / iters), i % iters).view))),
        (() => { const i = march.findIndex((m, i) => !sameFields(baseOf(m.view), shade[i].view)); if (i < 0) return 'surface or occlude'
                 const a = baseOf(march[i].view), b = shade[i].view
                 return `iteration ${i}: ` + [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => !same(a[k], b[k])).map(k => `${k} ${JSON.stringify(a[k])} vs ${JSON.stringify(b[k])}`).join('; ') })())
    ok(`the last pass's shadow rounds: ${2 * pairs} more of occlude a sample at maxiter ${bag1.maxiter} (${1 + 2 * pairs} rounds of ${OCCLUDE_STEPS} steps)`,
        pairs === Math.ceil((Math.ceil((bag1.maxiter + 1) / OCCLUDE_STEPS) - 1) / 2) && 1 + 2 * pairs >= (bag1.maxiter + 1) / OCCLUDE_STEPS && pairs > 0, String(pairs))
    const lastRounds = s => occl.slice(s * per + iters - 1, (s + 1) * per)
    const lastMarch = s => march[s * iters + iters - 1]
    ok('...each the last iteration\'s own values, its seed included, but lastpass 0 on every round but the last and 1 there',
        Array.from({ length: SAMPLES }, (_, s) => lastRounds(s).every((e, k, a) => e.view.lastpass === (k === a.length - 1 ? 1 : 0)
            && same({ ...e.view, lastpass: 1 }, lastMarch(s).view))).every(Boolean),
        Array.from({ length: SAMPLES }, (_, s) => lastRounds(s).map(e => e.view.lastpass).join('')).join(' '))
    /* ...and two after the sample's last round, around the prep and the resolve of what that round marked (shadow rays on
       distance only, 0.79.0): the queue's side back where the march left it */
    const fps = 2 * pairs + 2
    ok('...a shadow flip before each extra round, two after the last, and none anywhere else',
        flips.length === SAMPLES * fps && flips.every((at, j) => { const s = Math.floor(j / fps), k = j % fps
            return at === (k < 2 * pairs ? s * per + iters + k : (s + 1) * per) }),
        flips.join(' '))
    const seeds = new Set([...march, ...gen].map(e => JSON.stringify(e.view.seed)))
    ok('...a new seed every iteration and every sample, none repeated in the trace', seeds.size === march.length + gen.length, `${seeds.size} of ${march.length + gen.length}`)
    ok('...lastpass 1 on the last iteration of each sample, and only there',
        march.every((m, i) => m.view.lastpass === (i % iters === iters - 1 ? 1 : 0)), march.map(m => m.view.lastpass).join(''))
    ok('...the window one more each sample, and march\'s the sample\'s own', gen.every((g, s) => g.view.maxaverages === gen[0].view.maxaverages + s
        && march.slice(s * iters, (s + 1) * iters).every(m => m.view.maxaverages === g.view.maxaverages)), gen.map(g => g.view.maxaverages).join())
    const res = of('prog_resolve')
    ok('...resolve holds its sample\'s seed and window, as genrays did', res.length === SAMPLES
        && res.every((r, s) => same(r.view.seed, gen[s].view.seed) && r.view.maxaverages === gen[s].view.maxaverages))
    ok('...and no clock: the five uniforms no kernel read are gone (0.22.3)', gen.every(g => !('time' in g.view))
        && ['frame', 'time', 'flipbuffer', 'resetframecount', 'invViewProjection'].every(k => !R.prog_genrays2.uniformFields.includes(k)))
    ok('...and the other source is handed the whole bag: the scene\'s names, its sample\'s seed', given.every((u, s) => sceneNames.every(n => n in u)
        && same(u.seed, gen[s].view.seed)))

    // a second trace with a value changed: every program holds the new one at its first dispatch, a scene uniform too
    const sname = sceneNames.find(n => types[n] === 'f32')
    const bag2 = bagOf({ camPos: [1, -4, 3, 1], [sname]: (+bag1[sname] || 0) + 0.25 })
    track()
    const e2 = await trace(bag2, 1)
    const first = p => of(p)[0]
    ok('trace uniforms: a second trace, a camera moved and a scene uniform changed', e2 === null, e2)
    ok('...every program holds the new camera at its first dispatch', PROGS.filter(p => first(p)).every(p => same(first(p).view.camPos, bag2.camPos)),
        PROGS.filter(p => first(p)).map(p => `${p} ${JSON.stringify(first(p).view.camPos)}`).join('; '))
    ok(`...and march, the surface kernel and occlude the scene's new ${sname}`, SCENE_KERNELS.every(p => first(p)?.view[sname] === bag2[sname]))

    // a rebuild: new handles, whose structs start empty. The first trace after it must give each the whole bag
    await quietly(() => R._buildWavefrontPipelines())
    track()
    const e3 = await trace(bag2, 1)
    const ref2 = await expected(bag2)
    const holds = p => { const e = first(p); return e && R[p].uniformFields.filter(k => k in ref2 && !moving(p, k)).every(k => k in e.view) }
    ok('trace uniforms: after a rebuild, every new program holds every field of the bag at its first dispatch',
        e3 === null && PROGS.filter(p => first(p)).every(holds) && log.filter(e => !stale(e, ref2).length).length === log.length, `${e3} ${PROGS.filter(p => first(p) && !holds(p))}`)

    /* THE LIGHTS' RAYS SWITCHED OFF (lightRays 0, the Renderer panel's Light sources): the other source asked for
       none and dispatched never, ltLights 0 so the camera's paths count the faces -- and the sun's and the emitters'
       photons running as before, since that is the caustics' switch, not this one. A mode, so run here. */
    track()
    given.length = 0
    const e5 = await trace(bagOf({ lightRays: 0 }), 1)
    ok('the lights\' rays off: a trace, no unknown uniform thrown', e5 === null, e5)
    ok('...the other source given nothing and never asked to generate, and said why', R.extraPhotons === 0 && given.length === 0
        && R.photonPlan.sources[0].got === 0 && /switched off/.test(R.photonPlan.sources[0].why), JSON.stringify(R.photonPlan.sources))
    ok('...the camera side told so (ltLights 0, no flux to share)', of('prog_wvfmarch').every(e => e.view.ltLights === 0 && e.view.ltLightFlux === 0))
    ok('...and the caustics\' photons still run', R.photoncount > 0 && of('prog_genphotons').length > 0, `${R.photoncount}`)
    track()
    const e6 = await trace(bagOf({ lightRays: 1 }), 1)
    ok('...switched on again, the other source\'s photons are back', e6 === null && R.extraPhotons > 0 && given.length === 1
        && of('prog_wvfmarch').every(e => e.view.ltLights === 1), `${e6} ${R.extraPhotons} ${given.length}`)
    ok('...and the experimental TRACE2 flow is gone (0.22.2): R.trace is the one way a frame is traced', R.TRACE2 === undefined)

    /* A SAMPLE IN BATCHES (core/photons.js planBatches, 0.38.1): more rays and photons than the buffer holds. Until then
       the camera rays took the buffer and light tracing got none -- the save at 2048 x 2048 that lost the light through
       its glass (2026-10-08). A buffer of 64 rays for 64 pixels, one photon a pixel and the stand-in source's half
       stands in for the 2.31 M against 4 Mpx; the buffers are released so ensureBuffers sizes it. A mode, so run here. */
    const maxRays0 = R.maxRays
    // new handles, so the log counts each dispatch once (track() above wrapped these several times)
    await quietly(() => R._buildWavefrontPipelines())
    R.releaseBuffers(); R.maxRays = Q.w * Q.h
    // an emitter "found" again (the traces above read the stand-in device's zeros back into it): probes in the batches too
    await R._emitRead; R.emitCount = 1
    track(); given.length = 0
    const counted = []
    const counterW = R.counters.w
    R.counters.w = (d, ...a) => (counted.push(d[0]), counterW.call(R.counters, d, ...a))
    const e7 = await trace(bagOf({}), 1)
    const K = R.batches, gens = of('prog_genrays2'), phs = of('prog_genphotons')
    ok('a sample in batches: traced, in as many as the buffer needs', e7 === null && R.raybufferSize === 64 && K === Math.ceil((64 + 64 + 32) / 64)
        && R.photonPlan.batches === K, `${e7} ${R.raybufferSize} ${K}`)
    ok('...every pixel its camera ray, once: raygen\'s batches tile 0..63 in order, each its own seed',
        gens.length === K && gens.reduce((a, g) => a + g.view.rayBatch, 0) === 64
        && gens.every((g, k) => g.view.rayFirst === gens.slice(0, k).reduce((a, h) => a + h.view.rayBatch, 0))
        && new Set(gens.map(g => JSON.stringify(g.view.seed))).size === K
        && gens.every(g => g.view.raycount === 64 && g.view.tilesX * g.view.tilesY === 64),
        JSON.stringify(gens.map(g => [g.view.rayFirst, g.view.rayBatch, g.view.tilesX, g.view.tilesY])))
    ok('...every photon asked: light tracing\'s 64 and the source\'s 32, in slices that add up, each divided by the sample\'s count',
        R.photoncount === 64 && R.extraPhotons === 32 && R.emitPhotons > 0 && phs.reduce((a, g) => a + g.view.photonBatch, 0) === 64
        && phs.reduce((a, g) => a + g.view.emitBatch, 0) === R.emitPhotons && phs.every(g => g.view.photoncount === 64 && g.view.emitPhotons === R.emitPhotons)
        && given.length === K && given.every(u => u._at.total === 32) && given.reduce((a, u) => a + u._at.count, 0) === 32,
        `${R.photoncount} ${R.extraPhotons} ${JSON.stringify(phs.map(g => [g.view.photonBatch, g.view.emitBatch]))} ${JSON.stringify(given.map(u => u._at))}`)
    ok('...no batch over the buffer: each one\'s march count its own, the source written after its rays and photons',
        counted.length === K && counted.every(n => n <= 64) && counted.reduce((a, n) => a + n, 0) === 64 + 64 + 32
        && given.every((u, k) => u._at.offset === gens[k].view.rayBatch + phs[k].view.photonBatch), `${counted}`)
    ok('...the whole chain each batch, resolve once a sample after the last, light tracing on',
        of('prog_wvfmarch').length === K * iters && of('prog_resolve').length === 1
        && log.indexOf(of('prog_resolve')[0]) > log.lastIndexOf(of('prog_wvfmarch').at(-1))
        && of('prog_wvfmarch').every(e => e.view.lt === 1 && e.view.ltLights === 1),
        `${of('prog_wvfmarch').length} ${iters} ${of('prog_resolve').length}`)
    R.counters.w = counterW
    R.maxRays = maxRays0; R.releaseBuffers()

    /* A SAMPLE OVER SEVERAL FRAMES (R.trace's `slice`, sliceMs; 0.58.0): the live loop's frames each run a few of a slow
       sample's batches and the last one resolves it, so the GPU is never held for a whole sample. A mode the live loop
       alone turns on, so run here: the batches the slices run are the batches one call would (the same tiling, every
       photon, each its own seed), resolve once; a pending sample dropped by a whole trace or another plan, its part
       cleared from the frame and splat buffers; a reset going on with it, the picture replaced; a timed sample cut by
       its time; a sample that fits not cut, the frame held to what fits; three drops in a row and a whole sample. The
       stand-in device's dones would time these traces as instant, so the per-pixel time is pinned. The handles are wrapped
       once (track, after the build); each step after empties the log. */
    {
        await R._emitRead; R.emitCount = 1
        let pxMs = null
        Object.defineProperty(R, '_pxMs', { configurable: true, get: () => pxMs, set: () => { } })
        R.sliceMinRays = 1
        const sliced = async (bag, n = 1) => { try { await quietly(() => R.trace(Q, bag, n, undefined, { slice: true })); return null } catch (e) { return e.message } }
        const bag = bagOf({ sliceMs: 30 })
        R.ensureBuffers(Q.w, Q.h, 4)                     // released above; rebind (in the build) needs them
        await quietly(() => R._buildWavefrontPipelines())
        R._slice = null; Q.resetframecount = 1; await trace(bag, 1); Q.resetframecount = 0    // a picture to start from (and the buffers)
        const clears = { frame: 0, splat: 0 }
        const fc = R.frame_u32.clear, sc = R.splat_u32.clear
        R.frame_u32.clear = (...a) => (clears.frame++, fc.apply(R.frame_u32, a))
        R.splat_u32.clear = (...a) => (clears.splat++, sc.apply(R.splat_u32, a))

        track(); given.length = 0
        const errs = [], fracs = []
        for (let i = 0; i < 8; i++) { errs.push(await sliced(bag, 5)); fracs.push(R.sampled) }
        const gens = of('prog_genrays2'), phs = of('prog_genphotons')
        ok('sliced: untimed, a sample in SLICE_UNTIMED (8) batches, one a frame whatever the count asked, R.sampled an eighth each',
            errs.every(e => e === null) && gens.length === 8 && fracs.every(f => Math.abs(f - 1 / 8) < 1e-12), `${errs} ${gens.length} ${fracs}`)
        ok('...every pixel its camera ray once, the tiles in order across the frames, each batch its own seed',
            gens.reduce((a, g) => a + g.view.rayBatch, 0) === 64
            && gens.every((g, k) => g.view.rayFirst === gens.slice(0, k).reduce((a, h) => a + h.view.rayBatch, 0))
            && new Set(gens.map(g => JSON.stringify(g.view.seed))).size === 8,
            JSON.stringify(gens.map(g => [g.view.rayFirst, g.view.rayBatch])))
        ok('...every photon of the sample in slices that add up, each divided by the whole sample\'s count',
            phs.reduce((a, g) => a + g.view.photonBatch, 0) === R.photoncount && phs.every(g => g.view.photoncount === R.photoncount)
            && given.length === 8 && given.reduce((a, u) => a + u._at.count, 0) === R.extraPhotons && given.every(u => u._at.total === R.extraPhotons),
            `${JSON.stringify(phs.map(g => g.view.photonBatch))} ${JSON.stringify(given.map(u => u._at))}`)
        ok('...resolve once, in the last frame, after its batch; nothing pending after it, nothing cleared',
            of('prog_resolve').length === 1 && log.indexOf(of('prog_resolve')[0]) > log.indexOf(gens[7]) && R._slice === null
            && clears.frame === 0 && clears.splat === 0, `${of('prog_resolve').length} ${JSON.stringify(R._slice)} ${JSON.stringify(clears)}`)

        // dropped by a trace that is not a slice: its part cleared, then a whole sample
        await sliced(bag); log = []
        const pendingBefore = R._slice
        await trace(bag, 1)
        ok('sliced: a whole trace drops the sample pending, its part cleared from the frame and splat buffers, and traces a whole one',
            pendingBefore?.next === 1 && clears.frame === 1 && clears.splat === 1 && R._slice === null
            && of('prog_genrays2').length === R.batches && of('prog_resolve').length === 1, `${JSON.stringify(pendingBefore)} ${JSON.stringify(clears)} ${R.batches}`)

        // ...and by another photon plan: cleared, a new sample from batch 0
        await sliced(bag); log = []
        await sliced(bagOf({ sliceMs: 30, ltPhotons: 2 }))
        ok('sliced: another photon plan drops it, cleared, a new sample from its first batch',
            clears.frame === 2 && R._slice?.next === 1 && of('prog_genrays2')[0]?.view.rayFirst === 0, `${JSON.stringify(clears)} ${JSON.stringify(R._slice)}`)
        R._slice = null; R._sliceDrops = 0

        // a reset while pending: the sample goes on, resolves replacing the picture, and the window starts again after it
        Q.resetframecount = 1; await trace(bag, 1); Q.resetframecount = 0
        for (let i = 0; i < 8; i++) await sliced(bag)          // a sample, so the window is past 0
        await sliced(bag); log = []
        Q.resetframecount = 1; const er = await sliced(bag); Q.resetframecount = 0
        for (let i = 0; i < 6; i++) await sliced(bag)
        const res1 = of('prog_resolve')
        for (let i = 0; i < 8; i++) await sliced(bag)
        const res2 = of('prog_resolve')
        ok('sliced: a reset mid-sample goes on with it -- nothing cleared, the tiles carried on, resolved with the window at 0 (it replaces)',
            er === null && clears.frame === 2 && res1.length === 1 && res1[0].view.maxaverages === 0
            && of('prog_genrays2')[0].view.rayFirst > 0, `${er} ${JSON.stringify(clears)} ${res1.map(e => e.view.maxaverages)}`)
        ok('...and the sample after it replaces too: the average starts again from the new view alone',
            res2.length === 2 && res2[1].view.maxaverages === 0, `${res2.map(e => e.view.maxaverages)}`)

        // timed: a sample four slices long cut in four, one a frame
        R._slice = null; pxMs = 4 * 30 / 64
        log = []; for (let i = 0; i < 4; i++) await sliced(bag, 3)
        ok('sliced: timed at four times sliceMs, a sample in 4 batches, one a frame, resolved in the fourth',
            R.batches === 4 && of('prog_genrays2').length === 4 && of('prog_resolve').length === 1 && R._slice === null, `${R.batches} ${of('prog_resolve').length}`)
        // a sample that fits: not cut, and the frame holds no more samples than fit in sliceMs
        pxMs = 10 / 64
        log = []; await sliced(bag, 10)
        ok('sliced: a sample of a third of sliceMs is not cut, and a frame asked for 10 traces 3',
            R._slice === null && of('prog_resolve').length === 3 && R.sampled === 3 && !R.hud.slice, `${of('prog_resolve').length} ${R.sampled}`)
        // off: whole samples, all asked
        log = []; await sliced(bagOf({ sliceMs: 0 }), 4)
        ok('sliced: sliceMs 0 traces whole samples, every one asked', of('prog_resolve').length === 4 && R.sampled === 4)

        // three drops in a row, then a whole sample, then slices again
        pxMs = null; R._slice = null; R._sliceDrops = 0
        for (let i = 0; i < 4; i++) await sliced(bagOf({ sliceMs: 30, ltPhotons: 1 + i * 0.25 }))
        log = []; await sliced(bagOf({ sliceMs: 30, ltPhotons: 2 }))
        const wholeOne = of('prog_resolve').length === 1 && R._slice === null
        log = []; await sliced(bagOf({ sliceMs: 30, ltPhotons: 2 }))
        ok('sliced: three samples dropped before their end in a row, then the next traced whole (never a picture that never changes), then slices again',
            wholeOne && R._slice?.next === 1 && of('prog_resolve').length === 0, `${wholeOne} ${JSON.stringify(R._slice)}`)

        R._slice = null; R._sliceDrops = 0; delete R.sliceMinRays
        R.frame_u32.clear = fc; R.splat_u32.clear = sc
        delete R._pxMs; R._pxMs = null
    }

    /* THE STEP CACHE'S BOX (raytrace_main.js R.setStepCacheBox, wavefront.js stepCacheWGSL): the page gives it, and
       nothing else did -- a mode, so run here. COMPILED IN ONLY WHEN ON (0.29.0, R.kernelOptions): off, the march and
       occlusion kernels and the display pass hold none of it -- no lookup, no binding -- and the cells' buffer is a word
       whatever the box; on, built again with it. A box: cells covering it, as many as the setting stepCacheCells says,
       one word each, the new buffer bound to march and occlude (and the display, which shows them), the grid in their
       bags at every dispatch. WHEN A FILL IS OWED (R.stepCacheFor, 0.24.0; counted in R.stepCacheOwed): not by a camera
       move, by anything else handed in changing -- a scene value, the scene, its data written -- and every reset for a
       scene that owns GPU state and cannot say when it changes; built off and on again; another cell count, the box cut
       again. No box, none of that. (Until 0.41.0 these were the times the lazily filled cells were emptied.) The cache's soundness, a camera moved over a full one included, is the GPU test's
       (builder/test/stepcache.gpu.mjs). */
    {
        const cleared = [], bound = { prog_wvfmarch: [], prog_wvfocclude: [], prog_render: [] }
        const enc = d.createCommandEncoder
        d.createCommandEncoder = () => { const e = enc(); e.clearBuffer = b => cleared.push(b); return e }
        // the display pass's bag, as it is handed (it draws the cells: stepCacheView, rendertoscreen.js)
        const shown = {}
        // what the handles in place are bound to and handed: wrapped again after every build (new handles)
        const spy = () => {
            for (const prop of Object.keys(bound)) {
                const h = R[prop], set = Object.getOwnPropertyDescriptor(h, 'resources')?.set
                if (set) Object.defineProperty(h, 'resources', { configurable: true, set(v) { set.call(h, v); bound[prop].push(v.stepCache) } })
            }
            const h = R.prog_render, set = Object.getOwnPropertyDescriptor(h, 'uniforms')?.set
            if (set) Object.defineProperty(h, 'uniforms', { configurable: true, set(v) { set.call(h, v); Object.assign(shown, v) } })
        }
        const build = async over => { R.kernelOptions = R.kernelOptionsOf(over); const b = await quietly(() => R.applyKernelOptions()); spy(); R.rebind(); return b }
        const texts = () => ({ march: R.prog_wvfmarch.wgsl, occlude: R.prog_wvfocclude.wgsl, render: R.prog_render.wgsl })
        // a trace of `over` (a quarter of a million cells, unless it says otherwise): how often a fill of its cells was owed
        const traced = async (over, reset) => { track(); const o0 = R.stepCacheOwed; Q.resetframecount = reset ? 1 : 0
                                               const e = await trace(bagOf({ stepCache: 2, stepCacheCells: 0.25, ...over }), 1); return e ?? R.stepCacheOwed - o0 }
        spy()
        const off = texts()
        ok('the step cache OFF (the default): built without it -- march and occlude hold no lookup and no cells, the display pass no view of them, no fill pass',
            R.builtOptions.stepCache === 0 && R.builtOptions.cacheView === 0 && !R.prog_stepcache_fill
            && [off.march, off.occlude].every(t => !/\bscStep\b|var<storage[^>]*>\s*stepCache\b/.test(t)) && !/\bscView\b|var<storage[^>]*>\s*stepCache\b/.test(off.render),
            JSON.stringify(R.builtOptions))
        // (through the boundary since 0.36.0: sceneAt, scene_api.js -- the same one call, in engine units)
        ok('...the text each kernel had before the cache existed: the scene asked with the ray itself (sceneAt(ray)), not a stand-in',
            /hit = sceneAt\(ray, false\);/.test(off.march) && /let h = sceneAt\(ray, capture\);/.test(off.occlude))
        ok('...the setting alone in the bag changes nothing: no rebuild without the options asked (R.kernelOptions)', R.kernelOptions.stepCache === 0
            && await traced({}, true) === 0 && R.prog_wvfmarch.wgsl === off.march)
        ok('the step cache: no box until the host gives one, and a word bound meanwhile', R.stepCacheGrid === null && R.stepCacheBuf.b.size >= 4)
        const box = { lo: [-1, -2, 0], hi: [1, 2, 1] }
        let g = R.setStepCacheBox(box, R.stepCacheCellsOf({ stepCacheCells: 0.25 }))
        ok('...a box given with the cache built off: the grid, and still a word -- off, the cache holds no memory', !!g && R.stepCacheBuf.b.size === 16
            && Object.values(bound).every(l => l.every(b => b === undefined)), `${R.stepCacheBuf.b.size}`)
        ok('...the options asked: { stepCache 2, cacheView 1 } from the settings, the view only with the cache; the photon map off unless asked (0.60.0)',
            JSON.stringify(R.kernelOptionsOf({ stepCache: 2, stepCacheView: 1 })) === '{"stepCache":2,"cacheView":1,"sppm":0}'
            && JSON.stringify(R.kernelOptionsOf({ stepCache: 0, stepCacheView: 1 })) === '{"stepCache":0,"cacheView":0,"sppm":0}'
            && JSON.stringify(R.kernelOptionsOf({ stepCache: 2, stepCacheFill: 2 })) === '{"stepCache":2,"cacheView":0,"sppm":0}'
            && R.kernelOptionsOf({ stepCache: 7 }).stepCache === 2 && R.kernelOptionsOf({ sppm: 1 }).sppm === 1 && R.kernelSettings.includes('sppm'))
        const built = await build({ stepCache: 2, stepCacheView: 1 })
        const on = texts()
        ok('...built ON: march and occlude read the cells (scStep; two cells ahead: three looks) through a read-only binding, no atomics, no fill; a fill pass built; the display pass draws them',
            built === true && R.builtOptions.stepCache === 2 && R.builtOptions.cacheView === 1 && !!R.prog_stepcache_fill
            && [on.march, on.occlude].every(t => /\bscStep\b/.test(t) && /SC_LOOKS: u32 = 3u/.test(t) && /var<storage,\s*read>\s*stepCache\s*:\s*array<u32>/.test(t)
                && !/\bscLook\b|\bscFill\b|\bSC_NONE\b|atomic/.test(t.match(/stepCache[^\n]*/g).join('\n'))) && /\bscView\b/.test(on.render),
            JSON.stringify(R.builtOptions))
        ok('...and the scene asked with the ray itself, as off: no stand-in ray, no fill trip', /hit = sceneAt\(ray, false\);/.test(on.march) && /let h = sceneAt\(ray, capture\);/.test(on.occlude)
            && ![on.march, on.occlude].some(t => /\bscFill\b|SCN_MARCH/.test(t)))
        ok('...and no uniform test of the setting left in them: whether is the build\'s, not a branch at every step',
            [on.march, on.occlude, on.render].every(t => !/UB\.stepCache\b/.test(t)))
        const size = [2, 4, 1], cells = g ? g.dims[0] * g.dims[1] * g.dims[2] : 0
        ok('...the box: cubes covering it, about as many as the setting says (a quarter of a million), one word each', !!g
            && g.dims.every((n, k) => n * g.cs >= size[k] - 1e-9 && (n - 1) * g.cs < size[k]) && g.cells === 250000
            && cells >= 250000 && cells < 300000 && R.stepCacheBuf.b.size === 4 * cells && JSON.stringify(g.lo) === JSON.stringify(box.lo), JSON.stringify(g))
        ok('...the cells\' buffer bound to march, occlude and the display pass (which shows the cells)', Object.values(bound).every(l => l.at(-1) === R.stepCacheBuf.b), Object.entries(bound).map(([p, l]) => `${p} ${l.length}`).join(', '))
        const n1 = await traced({}, true)
        const grid = { scLo: [...box.lo, g.cs], scDims: [...g.dims, 0] }
        ok('...a first trace with it on: no unknown uniform thrown, a fill owed once, for what it was handed', n1 === 1, String(n1))
        ok('...march and occlude hold the grid at every dispatch', ['prog_wvfmarch', 'prog_wvfocclude'].every(p => of(p).length > 0
            && of(p).every(e => same(e.view.scLo, grid.scLo) && same(e.view.scDims, grid.scDims))),
            JSON.stringify(of('prog_wvfmarch')[0]?.view.scLo) + ' ' + JSON.stringify(of('prog_wvfmarch')[0]?.view.scDims))
        ok('...the display pass handed the grid and the camera, to walk each pixel\'s ray through the cells',
            same(shown.scLo, grid.scLo) && same(shown.scDims, grid.scDims) && 'invView' in shown && 'camPos' in shown,
            JSON.stringify({ scLo: shown.scLo, scDims: shown.scDims }))
        ok('...the cells shown (stepCacheView): KEPT -- switching on the view of them does not fill them again', await traced({ stepCacheView: 1 }, false) === 0 && shown.stepCacheView === 1)
        const moved = { camPos: [2, -3, 1, 1], invView: ident.map((v, k) => k === 12 ? 2 : k === 13 ? -3 : k === 14 ? 1 : v) }
        ok('...the camera moved, the picture started over: the cells KEPT', await traced(moved, true) === 0)
        ok('...the same again, no reset: kept', await traced(moved, false) === 0)
        ok(`...a scene value changed (${sname}), the picture started over: filled again`, await traced({ ...moved, [sname]: (+bag1[sname] || 0) + 0.5 }, true) === 1)
        ok('...and changed even without a reset: filled again (whatever starts the picture over or not, the cells follow what they were filled for)',
            await traced(moved, false) === 1)
        ok('...another setting changed (the step cache\'s own, to 1): filled again', await traced({ ...moved, stepCache: 1 }, true) === 1)
        await traced(moved, true)
        R.scene.dataRev = (R.scene.dataRev ?? 0) + 1                  // the scene's data written (builder/scenedata.js attachData counts it)
        ok('...the scene\'s data written, nothing else changed: filled again', await traced(moved, false) === 1)
        delete R.scene.dataRev
        await traced(moved, false)
        {
            // straight at R.stepCacheFor, the scene swapped round it: another scene, and one with GPU state of its own and no revision
            const bag = bagOf({ stepCache: 2, stepCacheCells: 0.25, ...moved }), S0 = R.scene
            const run = (S, reset) => { const o0 = R.stepCacheOwed; R.scene = S; try { R.stepCacheFor(bag, reset) } finally { R.scene = S0 } return R.stepCacheOwed - o0 }
            const other = { ...S0 }, opaque = { ...S0, init: async () => ({}) }
            ok('...another scene: filled again, and back again: filled again', run(other, false) === 1 && run(S0, false) === 1 && run(S0, false) === 0)
            ok('...a scene with GPU state of its own and no revision: filled again at every reset, and kept without one',
                run(opaque, true) === 1 && run(opaque, true) === 1 && run(opaque, false) === 0)
            run(S0, false)
        }
        const kept = R.stepCacheBuf.b
        await build({ stepCache: 0 })
        ok('...built OFF again: the kernels\' text as before the cache, byte for byte; the cells a word, bound nowhere; no fill pass', R.builtOptions.stepCache === 0 && !R.prog_stepcache_fill
            && JSON.stringify(texts()) === JSON.stringify(off) && R.stepCacheBuf.b !== kept && R.stepCacheBuf.b.size === 16
            && Object.values(bound).every(l => l.at(-1) === undefined), `${R.stepCacheBuf.b.size}`)
        ok('...and traced so: no fill owed (nothing is filled)', await traced(moved, true) === 0)
        await build({ stepCache: 2, stepCacheView: 1 })
        ok('...and ON again, everything else the same: filled again -- what changed while it was off was not looked at', await traced(moved, false) === 1
            && R.stepCacheBuf.b.size === 4 * cells)
        await build({ stepCache: 1, stepCacheView: 1 })
        ok('...the own cell only (1): one look a step, the rest the same', [R.prog_wvfmarch.wgsl, R.prog_wvfocclude.wgsl].every(t => /SC_LOOKS: u32 = 1u/.test(t))
            && R.builtOptions.stepCache === 1)
        ok('...nothing to build when nothing differs', await build({ stepCache: 1, stepCacheView: 1 }) === false)
        const before = R.stepCacheBuf.b
        const n2 = await traced({ ...moved, stepCacheCells: 1 }, false)
        const g2 = R.stepCacheGrid, cells2 = g2.dims[0] * g2.dims[1] * g2.dims[2]
        ok('...another cell count (a million): the box cut again, a new buffer as large, bound to both, a fill owed', n2 === 1 && R.stepCacheBuf.b !== before
            && g2.cells === 1e6 && cells2 >= 1e6 && cells2 < 1.2e6 && R.stepCacheBuf.b.size === 4 * cells2 && same(g2.lo, box.lo)
            && Object.values(bound).every(l => l.at(-1) === R.stepCacheBuf.b)
            && of('prog_wvfmarch').every(e => same(e.view.scDims, [...g2.dims, 0]) && same(e.view.scLo, [...box.lo, g2.cs])), `${n2} ${JSON.stringify(g2)}`)
        ok('...the setting read as the panel allows it: a quarter of a million to sixteen million, four by default',
            R.stepCacheCellsOf({ stepCacheCells: 0.01 }) === 250000 && R.stepCacheCellsOf({ stepCacheCells: 64 }) === 16e6 && R.stepCacheCellsOf({}) === 4e6)
        /* THE FILL (0.33.0; the only way since 0.41.0: wavefront.js prog_stepcache_fill): a pass of its own fills every cell
           before the trace's first sample, in a submission of its own, chunk by chunk (each its first cell in scDims.w, the
           whole bag at the first), from the scene's pick copy: no box culling in it. Owed by the rule above; the setting
           stepCacheFill 2 owes it at every trace without a build. A saved 0 (the lazy fill, gone) fills as 1. */
        {
            const fills = [], fillBound = []
            let submits = 0
            const sub = d.queue.submit
            d.queue.submit = (...a) => { submits++; return sub(...a) }
            const spyFill = () => {
                const h = R.prog_stepcache_fill
                if (!h) return
                const view = {}
                let wrote = []                                      // the names the write before a dispatch named
                const set = Object.getOwnPropertyDescriptor(h, 'uniforms')?.set
                if (set) Object.defineProperty(h, 'uniforms', { configurable: true, set(v) { set.call(h, v); wrote = Object.keys(v); for (const k in v) view[k] = plain(v[k]) } })
                const f = h.dispatch
                h.dispatch = (...a) => (fills.push({ groups: a[0], view: { ...view }, wrote, before: log.length }), f(...a))
                const rs = Object.getOwnPropertyDescriptor(h, 'resources')?.set
                if (rs) Object.defineProperty(h, 'resources', { configurable: true, set(v) { rs.call(h, v); fillBound.push(v.stepCache) } })
            }
            const buildOnce = async over => { const b = await build(over); spyFill(); R.rebind(); return b }
            // a trace of `over`: how many fill passes and submissions it made
            const run = async (over, reset) => { fills.length = 0; submits = 0; const f0 = R.stepCacheFills
                                                 const e = await traced({ stepCacheFill: 1, ...over }, reset)
                                                 return { e, passes: R.stepCacheFills - f0, submits } }
            const b1 = await buildOnce({ stepCache: 2, stepCacheFill: 1, stepCacheView: 1 })
            const m = R.prog_wvfmarch.wgsl, fillText = R.prog_stepcache_fill?.wgsl ?? ''
            ok('...two cells ahead again: built', b1 === true && R.builtOptions.stepCache === 2, JSON.stringify(R.builtOptions))
            ok('...the fill pass built, from the pick copy: the tags in it, no box culling (the march has it), the cells read_write',
                !!R.prog_stepcache_fill && /XF_TAG = xft_/.test(fillText) && !/= cullDist\(/.test(fillText) && /= cullDist\(/.test(m)
                && /var<storage,\s*read_write>\s*stepCache\s*:\s*array<u32>/.test(fillText))
            ok('...the cells bound to march, occlude, the display pass and the fill',
                Object.values(bound).every(l => l.at(-1) === R.stepCacheBuf.b) && fillBound.at(-1) === R.stepCacheBuf.b)
            const r1 = await run({}, true)
            const g3 = R.stepCacheGrid, n3 = g3.dims[0] * g3.dims[1] * g3.dims[2]
            ok('...a first trace: the cells filled -- every cell, one chunk of a quarter of a million, before the first sample',
                r1.passes === 1 && fills.length === 1 && fills[0].groups === Math.ceil(n3 / 64) && fills[0].before === 0
                && same(fills[0].view.scDims, [...g3.dims, 0]) && same(fills[0].view.scLo, [...g3.lo, g3.cs]) && sname in fills[0].view,
                `${JSON.stringify(r1)} ${JSON.stringify(fills.map(f => [f.groups, f.view.scDims, f.before]))}`)
            const r2 = await run({}, false)
            ok('...in a submission of its own: one more than a trace that fills nothing', r2.passes === 0 && fills.length === 0 && r1.submits === r2.submits + 1,
                `${r1.submits} ${r2.submits}`)
            ok('...the camera moved: kept, no fill', (await run(moved, true)).passes === 0)
            const r4 = await run({ ...moved, [sname]: (+bag1[sname] || 0) + 0.5 }, false)
            ok(`...a scene value changed (${sname}): filled again, the new value in its bag`, r4.passes === 1
                && same(fills[0].view[sname], (+bag1[sname] || 0) + 0.5), JSON.stringify(r4))
            const r5 = await run({ ...moved, stepCacheCells: 2 }, false)
            const g5 = R.stepCacheGrid, n5 = g5.dims[0] * g5.dims[1] * g5.dims[2]
            ok('...two million cells: the box cut again, two chunks of up to 2^20, each its own first cell, the whole bag at the first only',
                r5.passes === 1 && fills.length === 2 && n5 > 1 << 20 && fills[0].groups === (1 << 20) / 64 && fills[1].groups === Math.ceil((n5 - (1 << 20)) / 64)
                && n5 <= 2 << 20 && same(fills[0].view.scDims, [...g5.dims, 0]) && same(fills[1].view.scDims, [...g5.dims, 1 << 20])
                && fills[0].wrote.includes(sname) && same(fills[1].wrote, ['scDims']),
                `${n5} ${JSON.stringify(fills.map(f => [f.groups, f.view.scDims]))}`)
            ok('...2 (every trace): no build, the same kernels -- and a fill at every trace, nothing else changed',
                await buildOnce({ stepCache: 2, stepCacheFill: 2, stepCacheView: 1 }) === false
                && (await run({ ...moved, stepCacheFill: 2 }, false)).passes === 1 && (await run({ ...moved, stepCacheFill: 2 }, false)).passes === 1)
            const keptBuf = R.stepCacheBuf.b
            const b0 = await buildOnce({ stepCache: 2, stepCacheFill: 0, stepCacheView: 1 })
            const z1 = await run({ ...moved, stepCacheFill: 0 }, false), z2 = await run({ ...moved, stepCacheFill: 0 }, false)
            ok('...a saved 0 (the lazy fill, gone in 0.41.0): no build, the same cells, filled as 1 -- once for the setting moved, then kept',
                b0 === false && !!R.prog_stepcache_fill && R.stepCacheBuf.b === keptBuf && z1.passes === 1 && z2.passes === 0, JSON.stringify([b0, z1, z2]))
            d.queue.submit = sub
        }
        R.setStepCacheBox(null)
        const e8 = await traced({}, true)
        ok('...no box: none, zero cells in the bags (the kernels read that as off), nothing emptied', e8 === 0 && R.stepCacheGrid === null
            && of('prog_wvfmarch').every(e => same(e.view.scDims, [0, 0, 0, 0])), String(e8))
        await build({})
        d.createCommandEncoder = enc
    }

    /* THE MARCH ON DISTANCE ONLY (0.79.0; wavefront.js prog_march's distOnly, scene_api.js FOLD_DIST), ALWAYS: the
       renderer's march folds the distance alone, and its surface kernel asks for the whole hit at the ray the march
       stopped, on a trip of its loop's one call, and writes it back. Not a setting since the user's run (it was marchDist):
       no option builds anything else. The Optics page's march, prog_march with no option, is the full one. What it does
       to the rays and the picture is marchdist.gpu.mjs's. */
    {
        const DIST_FOLD = /if \(abs\(sdf\.w\) < abs\(H\.s\.w\)\) \{ H\.s\.w = sdf\.w; \}/
        const march = R.prog_wvfmarch.wgsl, surface = R.prog_wvfsurface.wgsl, occlude = R.prog_wvfocclude.wgsl
        ok('the march on distance only: no setting for it, no option', !('marchDist' in U.UniformSpec) && !('distOnly' in R.kernelOptionsOf({ marchDist: 1 }))
            && !R.kernelSettings.includes('marchDist'))
        ok('...the renderer\'s march folds the distance alone: no pass1, no normal turned into the world',
            DIST_FOLD.test(march) && !/let pass1 = /.test(march) && /return fold\(C, VEC4\(0\.0, 0\.0, 0\.0, sdf\.w \* XF_S\), matIndex\);/.test(march))
        ok('...its surface kernel asks for the hit on a trip of its loop\'s one call, and writes it back; occlusion folds the distance alone too (below)',
            /\bQ_HIT\b/.test(surface) && /shadeBuffer\[i\]\.hit = h;/.test(surface) && /noUnroll\(10u\)/.test(surface)
            && (surface.match(/= sceneAt\(/g) || []).length === 1 && !/let pass1 = /.test(occlude) && DIST_FOLD.test(occlude))
        // the march's text as prog_march hands it over, on a device that records it instead of compiling
        const { prog_march } = await import('../wavefront.js')
        const optics = (await prog_march({ makeCompute: async (...a) => a.slice(0, 2).join('\n') }, R.scene, 64))
        ok('...and prog_march with no option, the Optics page\'s, the full fold', /let pass1 = /.test(optics) && !DIST_FOLD.test(optics))
    }

    /* SHADOW RAYS ON DISTANCE ONLY (0.79.0; wavefront.js prog_occlude's distOnly, prog_occlude_emit), always, as the march
       is: the developer setting occludeDist for one run of Tests > occludedist, then the user asked for it on. The
       renderer's occlusion kernel folds the distance alone and hands a blocked emitter ray on; the resolve that asks its
       material is built with every scene; the prep sizes it; a trace dispatches it after every prep -- before that round's
       occlusion -- and once more after the sample's last round, between two flips so the queue's side is where it was.
       prog_occlude with no option is still the full kernel, the reference the GPU tests compare against. What it does to
       the picture is occludedist.gpu.mjs's. */
    {
        await quietly(() => R._buildWavefrontPipelines())
        const DIST_FOLD = /if \(abs\(sdf\.w\) < abs\(H\.s\.w\)\) \{ H\.s\.w = sdf\.w; \}/
        const on = { occlude: R.prog_wvfocclude.wgsl, prep: R.prog_prep_occlude.wgsl, emit: R.prog_occlude_emit?.wgsl ?? '' }
        // the full kernel's text as prog_occlude hands it over, on a device that records it instead of compiling
        const { prog_occlude } = await import('../wavefront.js')
        const ref = (await prog_occlude({ makeCompute: async (...a) => a.slice(0, 2).join('\n') }, R.scene, 64))
        ok('no setting for it: occludeDist is no kernel option and no setting',
            !('occludeDist' in R.kernelOptionsOf({ occludeDist: 1 })) && !R.kernelSettings.includes('occludeDist') && !('occludeDist' in U.UniformSpec))
        ok('the occlusion kernel on distance only, handing a blocked emitter ray on (marked, requeued, the word set); the resolve built, holding the whole scene and asking the material; the prep sizing it',
            DIST_FOLD.test(on.occlude) && !/let pass1 = /.test(on.occlude)
            && !/materialAt\(h, false\)/.test(on.occlude) && /ray\.state = RAY_HIT_TARGET;/.test(on.occlude) && /atomicStore\(&emitArgs\[3u\], 1u\);/.test(on.occlude)
            && /let pass1 = /.test(on.emit) && /materialAt\(h, false\)/.test(on.emit) && /deposit_frame_u32\(ray\.pix, ray\.radiance \* emitted, false\);/.test(on.emit)
            && /emitArgs\[0u\] = select\(0u, gx, emitArgs\[3u\] != 0u\);/.test(on.prep))
        ok('...and prog_occlude with no option still the full kernel, the reference: it folds the whole hit and asks an emitter ray\'s material itself',
            /let pass1 = /.test(ref) && /materialAt\(h, false\)/.test(ref) && !/RAY_HIT_TARGET;/.test(ref) && !/emitArgs/.test(ref))
        // a trace's dispatches: prep, resolve, occlude, round after round, then a flip, a prep, a resolve and a flip
        const seq = []
        const wrap = (prop, name) => { const h = R[prop]; for (const m of ['dispatch', 'dispatchIndirect']) { const f = h[m]; h[m] = (...a) => (seq.push(name), f(...a)) } }
        wrap('prog_prep_occlude', 'prep'); wrap('prog_occlude_emit', 'emit'); wrap('prog_wvfocclude', 'occlude'); wrap('prog_shadow_flip', 'flip')
        const e = await trace(bagOf({}), 1)
        const txt = seq.join(' ')
        const rounds = seq.filter(x => x === 'occlude').length
        ok('...a trace: every occlusion round its prep then the resolve then the round; after the last, flip prep resolve flip; the flips even',
            e == null && rounds > 0 && !/prep occlude|occlude emit/.test(txt) && (txt.match(/prep emit occlude/g) || []).length === rounds
            && txt.endsWith('occlude flip prep emit flip') && seq.filter(x => x === 'flip').length % 2 === 0, `${e ?? ''} ${txt.slice(-120)}`)
    }

    /* THE PHOTON MAP (0.60.0; core/sppm.js, wavefront.js prog_sppm): a kernel option, its kernel and its memory only while
       on. On, a trace runs every one of a sample's photons in batches of their own before its camera rays (photons.js
       planBatches's `first`: a gather reads the sample's own map, whole), empties the map once a sample before its first
       batch, and dispatches the kernel between the surface kernel and shade at every iteration, over the same hits --
       its switch and capacity in every kernel's bag (sppmCtl), its radius the sample's own, the same in every batch and
       iteration of it, smaller the sample after. Not in a view or mode it does not run in. Off again: no kernel, no
       memory, the trace as before. What it draws is sppm.test.mjs's and sppm.gpu.mjs's. */
    {
        await quietly(() => R._buildWavefrontPipelines())     // fresh handles: the log counts each dispatch once
        await R._emitRead; R.emitCount = 1
        R.ensureBuffers(Q.w, Q.h, 4)
        R.kernelOptions = R.kernelOptionsOf({ sppm: 1 })
        const builtMap = await quietly(() => R.applyKernelOptions())
        ok('the photon map: built alone when asked, no memory until a trace runs it', builtMap === true && !!R.prog_sppm
            && R.builtOptions.sppm === 1 && R.sppmHeads === null && R.prog_wvfshade && R.prog_wvfmarch, JSON.stringify(R.builtOptions))
        const cap = R.sppmRoom(1000)
        const clears = []
        { const h = R.sppmHeads, f = h.clear; h.clear = () => (clears.push(log.length), f.call(h)) }
        if (!PROGS.includes('prog_sppm')) PROGS.push('prog_sppm')
        track()
        const em = await trace(bagOf({ sppm: 1, sppmCapacity: 0.001, sppmRadius: 3 }), 2)
        const sp = of('prog_sppm'), gens = of('prog_genrays2'), phs = of('prog_genphotons'), res = of('prog_resolve')
        ok('the photon map: a trace with it on, its buffers at the capacity asked', em === null && cap === 1000 && R.sppmHeads?.b?.size === 4 * (4 + 3 * (1 << 20))     // the header, the heads, the counts, the sub-lists' heads (0.61.2)
            && R.sppmRecs?.b?.size === 1000 * 44, `${em} ${cap} ${R.sppmHeads?.b?.size} ${R.sppmRecs?.b?.size}`)
        const K = R.batches
        ok('...the photons first, in batches of their own: two a sample where one held everything, the camera\'s rays in the last',
            K === 2 && gens.length === 2 && gens.every(g => g.view.rayBatch === 64 && g.view.rayFirst === 0)
            && phs.length === 2 && phs.every(p => p.view.photonBatch === 64) && given.length >= 2
            && phs.every((p, s) => log.indexOf(p) < log.indexOf(gens[s])),
            `${K} ${JSON.stringify(gens.map(g => g.view.rayBatch))} ${phs.length}`)
        const order = log.map(e => e.prop).filter(p => ['prog_wvfsurface', 'prog_sppm', 'prog_wvfshade'].includes(p)).join(' ')
        ok('...at every iteration between the surface kernel and shade, over the same hits', sp.length === of('prog_wvfsurface').length && sp.length > 0
            && !/prog_wvfsurface prog_wvfshade|prog_sppm prog_sppm|prog_wvfsurface prog_wvfsurface/.test(order), order.slice(0, 120))
        ok('...the map emptied once a sample, before its first batch', clears.length === 2
            && clears.every((at, s) => log.slice(at).find(e => e.prop === 'prog_genphotons') === phs[s]
                && log.slice(0, at).filter(e => e.prop === 'prog_resolve').length === s), `${clears}`)
        const geom = sp.map(e => e.view.sppmGeom)
        const half = sp.length / 2
        ok('...its switch and capacity in the bag (shade\'s too: it leaves the class), its radius the sample\'s own, smaller the sample after',
            sp.every(e => same(e.view.sppmCtl, [1, 1000, 0, 0])) && of('prog_wvfshade').every(e => same(e.view.sppmCtl, [1, 1000, 0, 0]))
            && geom.slice(0, half).every(g => same(g, geom[0])) && geom.slice(half).every(g => same(g, geom[half]))
            && geom[half][0] < geom[0][0] && Math.abs(geom[0][1] - 2 * geom[0][0]) < 1e-12 && Math.abs(geom[0][2] * Math.PI * geom[0][0] ** 2 - 1) < 1e-9
            && res.length === 2, JSON.stringify([geom[0], geom[half]]))
        /* THE STORES KEPT (0.61.2; sppm.js NEITHER FULL NOR CUT): 1 while what a sample asks fits the map (here: its photons'
           guess, before any reading), and after a whole sample read back asking more -- 5000 stores of the 1000 the map
           holds -- the fill over that, in every one of the next sample's sppm bags (sppmGeom.w), the same in each; the
           reading after it, of a sample that kept 0.17, asks 5000 again. A new size forgets it. */
        {
            const { SPPM_FILL } = await import('../sppm.js')
            const r0 = R.sppmHeads.r
            let count = 5000
            R.sppmHeads.r = async () => { const a = new Uint32Array(4); a[0] = count; a[2] = 1; return a }
            const settle = async () => { for (let i = 0; i < 4; i++) await tick() }
            const keeps = () => of('prog_sppm').map(e => e.view.sppmGeom?.[3])
            const k0 = geom[0][3]
            await settle()
            R._sppmIdle = null                                // the zeros read back above made it idle: awake, as a gather would
            // a whole sample that reads back asking 5000 (it kept every one: the zeros before asked nothing)
            track(); await trace(bagOf({ sppm: 1, sppmCapacity: 0.001, sppmRadius: 3 }), 1); await settle()
            const kAll = keeps()
            count = Math.round(1000 * SPPM_FILL)              // what the next sample keeps at its share, read back
            track(); await trace(bagOf({ sppm: 1, sppmCapacity: 0.001, sppmRadius: 3 }), 1); await settle()
            const k1 = keeps()
            track(); await trace(bagOf({ sppm: 1, sppmCapacity: 0.001, sppmRadius: 3 }), 1); await settle()
            const k2 = keeps()
            const want = SPPM_FILL * 1000 / 5000
            ok(`...every store kept while the sample fits (keep ${k0}); after a reading asking 5000 of 1000, ${want.toFixed(3)} in every bag of the next`
                + ' sample, and the reading after it asking the same', k0 === 1 && kAll.length > 0 && kAll.every(k => k === 1) && k1.length > 0 && k1.every(k => Math.abs(k - want) < 1e-12)
                && k2.length > 0 && k2.every(k => Math.abs(k - want) < 1e-9), `${k0} ${JSON.stringify(k1.slice(0, 2))} ${JSON.stringify(k2.slice(0, 2))}`)
            R.sppmHeads.r = r0
            await settle()
        }
        for (const [what, over] of [['the illuminance view', { measureMode: 1 }], ['Sketch', { renderMode: 2 }], ['an orthographic camera', { camtype: 1 }]]) {
            track()
            const e = await trace(bagOf({ sppm: 1, sppmCapacity: 0.001, ...over }), 1)
            ok(`...not in ${what}: no dispatch, off in the bag, one batch`, e === null && of('prog_sppm').length === 0 && R.batches === 1
                && of('prog_wvfshade').every(x => x.view.sppmCtl[0] === 0), `${e} ${of('prog_sppm').length} ${R.batches}`)
        }
        // ...and in Draft and Optics, where a camera path ends where it gathers and the map adds what nothing there counts
        for (const [what, over] of [['Draft', { renderMode: 1 }], ['Optics', { renderMode: 3 }]]) {
            track()
            const e = await trace(bagOf({ sppm: 1, sppmCapacity: 0.001, ...over }), 1)
            ok(`...in ${what} too: dispatched between surface and shade, on in the bag, the photons first`, e === null && of('prog_sppm').length > 0
                && of('prog_sppm').length === of('prog_wvfsurface').length && of('prog_wvfshade').every(x => x.view.sppmCtl[0] === 1) && R.batches === 2,
                `${e} ${of('prog_sppm').length} ${R.batches}`)
        }
        /* THE IDLE SKIP (0.61.0, the map on by default; raytrace_main.js THE PHOTON MAP, NOT IDLE): the map's header read
           back after a whole sample says whether a camera ray gathered (sppm.js SPPM_LOOKED); none did, and the traces after
           run without it -- one chain, off in every bag -- but for a probe every SPPM_PROBE-th trace. A reading that saw a
           gather wakes it; so does a new scene; a camera move does not. With no photons it never runs. A sample pending over
           frames keeps the choice it began with, and its partial reading decides nothing. The stand-in device reads back
           zeros, so the reading is handed in here. */
        {
            const { SPPM_PROBE, SPPM_LOOKED } = await import('../sppm.js')
            let looked = 0
            R.sppmHeads.r = async () => { const a = new Uint32Array(4); a[0] = 7; a[SPPM_LOOKED] = looked; return a }
            const settle = async () => { for (let i = 0; i < 4; i++) await tick() }
            const mapBag = over => bagOf({ sppm: 1, sppmCapacity: 0.001, ...over })
            const ran = () => of('prog_sppm').length > 0
            const step = async (over = {}) => { track(); const e = await trace(mapBag(over), 1); await settle(); return e === null ? ran() : e }
            const first = await step()                   // renderMode 0 again after Optics: a new key, so it runs and reads
            track(); const e = await trace(mapBag({}), 1)
            ok('the idle skip: a whole sample no camera ray gathered in, and the next trace runs without the map -- no dispatch,'
                + ' off in the bag, one batch, Render stats saying why', first === true && e === null && !ran() && R.batches === 1
                && of('prog_wvfshade').every(x => x.view.sppmCtl[0] === 0) && /glass or a mirror/.test(R.hud.sppm?.idle ?? ''),
                `${first} ${e} ${ran()} ${R.batches} ${JSON.stringify(R.hud.sppm)}`)
            await settle()
            const runs = [false]                         // that trace the first of the idle ones
            for (let k = 1; k < 2 * SPPM_PROBE; k++) runs.push(await step())
            ok(`...but for a probe every ${SPPM_PROBE}th trace, which reads again`, runs.every((r, k) => r === ((k + 1) % SPPM_PROBE === 0)),
                runs.map(r => r ? 1 : 0).join(''))
            looked = 1
            const woke = []
            for (let k = 0; k < SPPM_PROBE + 2; k++) woke.push(await step())
            ok('...a probe that finds a camera ray gathering wakes it: every trace after runs the map', woke.slice(0, SPPM_PROBE - 1).every(r => !r)
                && woke.slice(SPPM_PROBE - 1).every(r => r) && R._sppmIdle === null, woke.map(r => r ? 1 : 0).join(''))
            looked = 0
            await step()                                 // idle again
            Q.resetframecount = 1
            const moved = await step({ camPos: [0.3, -5, 2, 1] })
            Q.resetframecount = 0
            R.sceneRev++                                 // as R.setScene and every scene compile move it
            const rescene = await step()
            ok('...a camera move (a reset) does not wake it; a new scene does, at once', moved === false && rescene === true, `${moved} ${rescene}`)
            // no photons: light tracing off and no other source -- nothing to gather, nothing owned
            const sources = R.photonSources.splice(0)
            const none = await step({ lt: 0 }), noneSaid = R.hud.sppm?.idle ?? ''
            R.photonSources.push(...sources)
            ok('...with no photons it never runs, and says so', none === false && /no photons/.test(noneSaid) && R.batches === 1, `${none} ${noneSaid}`)
            // a sample pending over frames keeps its choice; its partial reading decides nothing
            R.sceneRev++; R.sliceMinRays = 1; R._slice = null; R._sliceDrops = 0
            const sliced = async () => { track(); const e = await quietly(() => R.trace(Q, mapBag({ sliceMs: 30 }), 1, undefined, { slice: true })).then(() => null, x => x.message); await settle(); return e === null ? ran() : e }
            const s1 = await sliced(), pend1 = R._slice
            R._sppmIdle = { left: SPPM_PROBE - 1 }       // a reading from elsewhere making it idle half way
            const s2 = await sliced(), pend2 = R._slice
            ok('...a sample pending over frames keeps the map it began with, idle or not, and goes on (not dropped)',
                s1 === true && pend1?.map === true && s2 === true && pend2?.map === true && pend2.next > pend1.next, `${s1} ${s2} ${JSON.stringify(pend1)} ${JSON.stringify(pend2)}`)
            R._sppmIdle = null
            const s3 = await sliced()
            ok('...and its reading, a part of a sample, makes nothing idle', s3 === true && R._slice !== null && R._sppmIdle === null, `${s3} ${JSON.stringify(R._sppmIdle)}`)
            R._slice = null; R._sliceDrops = 0; delete R.sliceMinRays
        }
        /* THE ROOM GROWS WITH THE PICTURE (0.79.0; sppm.js sppmCapacityFor): the setting is the room for 1920 x 1080, a
           larger picture gets it in proportion -- a 4K save at a fixed room kept a quarter of 1080p's share of its stores
           and looked darker (the user, 2026-10-25). Never less than the setting. The records grow and are not made again
           for a smaller picture (a panel dragged would make hundreds of MB a frame), but are for another setting, and are
           given back with the other buffers (R.releaseBuffers, after a save larger than the view). The stand-in device
           allocates nothing, so a 4K trace here costs only its recording. */
        {
            const { sppmCapacityFor, SPPM_REF_PIXELS, SPPM_CAPACITY_DEFAULT } = await import('../sppm.js')
            ok('the photon map\'s room: the setting at 1920 x 1080 and below, in proportion above it, the default where unset',
                sppmCapacityFor(2, SPPM_REF_PIXELS) === 2e6 && sppmCapacityFor(2, 3840 * 2160) === 8e6 && sppmCapacityFor(2, 640 * 480) === 2e6
                && sppmCapacityFor(0, 3840 * 2160) === 4e6 * SPPM_CAPACITY_DEFAULT && sppmCapacityFor(0.001, 2560 * 1440) === 1778,
                `${sppmCapacityFor(2, 3840 * 2160)} ${sppmCapacityFor(0.001, 2560 * 1440)}`)
            const w0 = Q.w, h0 = Q.h
            const at = async (w, h, cap = 0.001) => {
                Q.w = w; Q.h = h
                R._sppmKey = null; R._sppmIdle = null           // awake: the stand-in reads back zeros, which would make it idle
                track()
                const e = await trace(bagOf({ sppm: 1, sppmCapacity: cap, sppmRadius: 3 }), 1)
                const ctl = of('prog_sppm').map(x => x.view.sppmCtl?.[1])
                return { e, cap: ctl[0], all: ctl.every(c => c === ctl[0]), recs: R.sppmRecs, size: R.sppmRecs?.b?.size }
            }
            const small = await at(8, 8), big = await at(3840, 2160), mid = await at(2560, 1440), back = await at(8, 8)
            ok('...a trace\'s map that room: 1000 at 8 x 8, 4000 at 3840 x 2160, its records made for it; 1778 at 2560 x 1440 and'
                + ' 1000 back at 8 x 8 from the same records', [small, big, mid, back].every(r => r.e === null && r.all)
                && small.cap === 1000 && big.cap === 4000 && big.size === 4000 * 44 && big.recs !== small.recs
                && mid.cap === 1778 && back.cap === 1000 && mid.recs === big.recs && back.recs === big.recs,
                JSON.stringify([small, big, mid, back].map(r => [r.e, r.cap, r.size])))
            const moved = await at(8, 8, 0.002)
            R.releaseBuffers()
            const freed = R.sppmHeads === null && R.sppmRecs === null
            R.ensureBuffers(8, 8)
            const after = await at(8, 8, 0.002)
            ok('...another setting makes them again at its room; R.releaseBuffers gives them back, and the next trace makes them anew',
                moved.e === null && moved.cap === 2000 && moved.size === 2000 * 44 && moved.recs !== big.recs && freed
                && after.e === null && after.cap === 2000 && after.size === 2000 * 44 && after.recs !== moved.recs,
                JSON.stringify([moved.cap, moved.size, freed, after.cap, after.size]))
            Q.w = w0; Q.h = h0
        }
        R.kernelOptions = R.kernelOptionsOf({})
        await quietly(() => R.applyKernelOptions())
        PROGS.splice(PROGS.indexOf('prog_sppm'), 1)
        track()
        const eo = await trace(bagOf({ sppm: 0 }), 1)
        ok('...switched off: no kernel and no memory, the trace as before (one batch, off in the bag)', eo === null && R.prog_sppm === null
            && R.sppmHeads === null && R.sppmRecs === null && R.builtOptions.sppm === 0 && R.batches === 1
            && of('prog_wvfshade').every(x => x.view.sppmCtl[0] === 0), `${eo} ${R.prog_sppm} ${R.batches}`)
    }
    /* THE HAZE BOX (0.62.0; core/haze.js): the scene's, not a setting. Its code is in the march (since 0.62.2: the
       collision drawn as a leg starts and the ray stopped there), shade and occlusion kernels only for a scene with one -- read from the scene the build is of (raytrace_main.js wavefrontKernels), so a
       swap builds once -- and the kernels without one are the text they were, byte for byte; only the uniform struct,
       which every kernel declares whole, has its five vec4s (DERIVED). Its values ride in the bag, in metres. */
    {
        const { hazeUniforms } = await import('../haze.js')
        const { unitScale } = await import('../photometry.js')
        const { sceneTextOf } = await import('../uniforms.schema.js')
        const texts = () => ({ surface: R.prog_wvfsurface.wgsl, shade: R.prog_wvfshade.wgsl, occlude: R.prog_wvfocclude.wgsl, march: R.prog_wvfmarch.wgsl,
                               genrays: R.prog_genrays2.wgsl, resolve: R.prog_resolve.wgsl })
        const HAZE = /\bhazeLeg\b|\bhazeDraw\b|\bhazeAt\b|\bhazeArrived\b|\bRAY_SCATTER\b|\bmediumVertex\b|\bhazeShadow\b|\bhazeTr\b|UB\.haze/
        const plainScene = R.scene, off = texts()
        ok('the haze: a scene without a box, its march, surface, shade and occlusion kernels without it -- no collision, no point in the dust, no haze on a shadow ray',
            [off.march, off.surface, off.shade, off.occlude].every(t => !HAZE.test(t)))
        const ends = []
        const listen = p => { if (p.end) ends.push(p.scene) }
        R.compileListeners.add(listen)
        const hazy = { ...plainScene, id: 'demo-haze', haze: { centre: [0, 0, 0.5], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], half: [1, 1, 0.5], mfp: 2, albedo: [0.9, 0.8, 0.7], g: 0.6 } }
        ok('...its presence is text to the data path (sceneTextOf): a scene with a box never swapped in for one without, or back, without a build',
            sceneTextOf(hazy) !== sceneTextOf(plainScene) && sceneTextOf({ ...hazy, haze: { ...hazy.haze, mfp: 9 } }) === sceneTextOf(hazy))
        await quietly(() => R.setScene(hazy))
        const on = texts()
        ok('...a scene with one: ONE build, its march drawing a leg\'s collision and stopping there, shade the point in the dust, the shadow rays\' haze and a new leg\'s tmax, occlusion an emitter ray\'s',
            JSON.stringify(ends) === '["demo-haze"]' && /ray = hazeDraw\(ray\)/.test(on.march) && /if \(hazeArrived\(ray\)\) \{\s*hit\.r = hazeAt\(ray\)/.test(on.march)
            && /mediumVertex\(hit\)/.test(on.shade) && /if \(\(ray\.tag & TAG_PROBE\) == 0u\) \{ ray\.tmax = 0\.0; \}/.test(on.shade)
            && /hazeShadow\(NEE_RAY, hit\.r\.pos, select\(hit\.r\.n, NEE_N0, NEE_N0 > 0\.0\)\)/.test(on.shade) && /hazeTr\(ray\.pos - ray\.dir \* hl/.test(on.occlude), JSON.stringify(ends))
        ok('...the kernels that do not see it the text they were: surface, genrays, resolve', on.surface === off.surface && on.genrays === off.genrays && on.resolve === off.resolve)
        const hz = hazeUniforms(hazy.haze, unitScale(hazy.unit), 0)
        track()
        const eh = await trace(bagOf(hz), 1)
        ok('...traced: no unknown uniform thrown, and the march, shade and occlusion hold the haze, in metres, at every dispatch',
            eh === null && ['prog_wvfmarch', 'prog_wvfshade', 'prog_wvfocclude'].every(p => of(p).length > 0 && of(p).every(x => same(x.view.hazeC, hz.hazeC) && same(x.view.hazeA, hz.hazeA))),
            `${eh} ${JSON.stringify(of('prog_wvfshade')[0]?.view.hazeC)} ${JSON.stringify(hz.hazeC)}`)
        ends.length = 0
        await quietly(() => R.setScene(plainScene))
        ok('...the scene without it again: one build, and every kernel the text it had before the haze, byte for byte', JSON.stringify(ends) === `[${JSON.stringify(plainScene.id)}]`
            && JSON.stringify(texts()) === JSON.stringify(off), JSON.stringify(ends))
        R.compileListeners.delete(listen)
    }
}

/* THE FACADE OVER THE ENGINE (lib/pathtracer/index.js createPathTracer), built here on the recording device. It BOLTS its
   methods onto the engine object (Object.assign(RT, api)), so one of the same name REPLACES the engine's: a facade method
   that then calls RT.<its name> calls itself, and an engine function that calls R.<its name> calls the facade's. The
   step cache's setStepCacheBox shipped that way in 0.23.0 and 0.24.0 -- the first box the page or the bench handed in
   ran the stack out -- because every test here drove RAYTRACER alone, and the facade, the only caller the page has, was
   never built in a test. Checked for every method the facade replaces, then the step cache driven through the facade. */
{
    const { readFileSync } = await import('node:fs')
    const { createPathTracer } = await import('../../index.js')
    const { defines, TOKENS, SHORT_TOKENS } = await import('../../../wgsl_shorthand.js')
    globalThis.requestAnimationFrame ??= f => setTimeout(f, 0)
    const made = () => { const G = onDevice(countingDevice()); G.context = { getCurrentTexture: () => ({ createView: () => ({}) }), canvas: {} }
                         G.defines = defines(TOKENS, SHORT_TOKENS); return G }
    const Q = { w: 8, h: 8, resetframecount: 1 }
    const bare = RAYTRACER(made(), null, { w: 8, h: 8, resetframecount: 1 }, sphereScene({ id: 'bare', uniforms: {} }))
    const RT = await quietly(() => createPathTracer({ gpu: made(), ctx: null, Q, scene: sphereScene({ id: 'facade', uniforms: {} }), CAMERA: null, hud: false }))
    await quietly(() => RT.init())
    /* HOOKS the engine calls ON PURPOSE through R, so that a host may replace them: hud (index.js, a quiet renderer's) */
    const HOOKS = new Set(['hud'])
    const replaced = Object.keys(bare).filter(k => !HOOKS.has(k) && typeof bare[k] === 'function' && typeof RT[k] === 'function' && String(RT[k]) !== String(bare[k]))
    // the engine's own text, comments out: a comment may name R.setScene()
    const engineText = readFileSync(new URL('../raytrace_main.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    ok('the facade: built over the recording device, and the engine methods it replaces found (setScene, pick and setStepCacheBox among them)',
        ['setScene', 'pick', 'setStepCacheBox'].every(k => replaced.includes(k)), replaced.join(', '))
    const selfCall = replaced.filter(k => new RegExp(`\\bRT\\.${k}\\s*\\(`).test(String(RT[k])))
    ok('...none of them calls RT.<its own name> (itself): each reaches the engine\'s through a copy taken before the facade replaced it', selfCall.length === 0, selfCall.join(', '))
    const engineCall = replaced.filter(k => new RegExp(`\\bR\\.${k}\\s*\\(`).test(engineText))
    ok('...and the engine calls none of them through R.<name> (the facade\'s, once bolted on): its own local function instead', engineCall.length === 0, engineCall.join(', '))
    const tried = f => { try { return { v: f() } } catch (e) { return { e: e.message } } }
    /* THE KERNELS' OPTIONS FOLLOW THE SETTINGS (index.js syncKernels): asked at once, built by a job after any swap under
       way -- and a swap asked in the same task builds them itself, so the benchmark's "options, then the row's scene"
       compiles the row's scene once, never the scene before with the row's options */
    const builds = []
    RT.compileListeners.add(p => { if (p.end) builds.push(p.scene) })
    const unknown = RT.set({ stepCache: 2, stepCacheCells: 0.25 })
    ok('the kernels\' options: the step cache set, asked at once (RT.kernelOptions), not yet built',
        unknown.length === 0 && RT.kernelOptions.stepCache === 2 && RT.builtOptions.stepCache === 0, JSON.stringify([RT.kernelOptions, RT.builtOptions]))
    await quietly(() => RT.kernelsSettled())
    ok('...settled: built with the cache by the job, the scene the same', RT.builtOptions.stepCache === 2 && /\bscStep\b/.test(RT.prog_wvfmarch.wgsl)
        && JSON.stringify(builds) === JSON.stringify([RT.scene.id]), `${JSON.stringify(RT.builtOptions)} ${JSON.stringify(builds)}`)
    builds.length = 0
    RT.set({ stepCache: 1 })
    const other = { ...sphereScene({ uniforms: {} }), id: 'facade-2' }
    await quietly(() => RT.setScene(other))
    await quietly(() => RT.kernelsSettled())
    ok('...the options changed, then a scene swapped in in the same task: ONE build, of the new scene, with the new options',
        JSON.stringify(builds) === '["facade-2"]' && RT.builtOptions.stepCache === 1 && /SC_LOOKS: u32 = 1u/.test(RT.prog_wvfmarch.wgsl), JSON.stringify(builds))
    builds.length = 0
    RT.set({ stepCache: 1, stepCacheView: 1 })
    await quietly(() => RT.kernelsSettled())
    ok('...the view of the cells switched on: the display pass built again, the scene\'s kernels not', builds.length === 0 && RT.builtOptions.cacheView === 1
        && /\bscView\b/.test(RT.prog_render.wgsl), JSON.stringify(builds))
    RT.set({ stepCache: 2, stepCacheView: 0 })
    await quietly(() => RT.kernelsSettled())
    const r = tried(() => RT.setStepCacheBox({ lo: [-1, -1, -1], hi: [1, 1, 1] }))
    ok('the step cache through the facade: setStepCacheBox gives the grid, cut by the setting (a quarter of a million cells)',
        unknown.length === 0 && !r.e && r.v?.cells === 250000 && RT.stepCacheGrid === r.v, r.e ?? JSON.stringify(r.v))
    const c0 = RT.stepCacheOwed, f0 = RT.stepCacheFills
    let e = null
    try { await quietly(() => RT.step(1)) } catch (x) { e = x.message }
    ok('...a step traced with it on: the cells filled once, for what they were handed', e === null && RT.stepCacheOwed === c0 + 1 && RT.stepCacheFills === f0 + 1,
        `${e} ${RT.stepCacheOwed - c0} ${RT.stepCacheFills - f0}`)
    RT.set({ stepCacheCells: 1 })
    try { await quietly(() => RT.step(1)) } catch (x) { e = x.message }
    ok('...the setting moved to a million: the next step cuts the box again from inside the trace (the engine\'s own function, not the facade\'s)',
        e === null && RT.stepCacheGrid?.cells === 1e6 && RT.stepCacheOwed === c0 + 2, `${e} ${RT.stepCacheGrid?.cells}`)
    /* THE HAZE BOX THROUGH THE FACADE (0.62.0): its values live (RT.updateScene, uniforms in the bag, no build), whether
       there is one not: a patch adding or taking it away is refused, and the scene applied instead is one build */
    {
        const box = { centre: [0, 0, 0.5], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], half: [1, 1, 0.5], mfp: 2, albedo: [1, 1, 1], g: 0.5 }
        builds.length = 0
        ok('the haze through the facade: a box asked live on a scene without one is refused, and nothing built',
            JSON.stringify(RT.updateScene({ haze: box })) === '["haze"]' && !RT.scene.haze && builds.length === 0)
        await quietly(() => RT.setScene({ ...sphereScene({ uniforms: {} }), id: 'facade-haze', haze: box }))
        await quietly(() => RT.kernelsSettled())
        ok('...the scene with one applied: one build, with the haze', JSON.stringify(builds) === '["facade-haze"]' && /\bhazeDraw\b/.test(RT.prog_wvfmarch.wgsl), JSON.stringify(builds))
        builds.length = 0
        const r1 = RT.updateScene({ haze: { ...box, mfp: 4, centre: [0.5, 0, 0.5] } })
        await quietly(() => RT.kernelsSettled())
        ok('...its values changed live: taken, no build, and the bag the new ones (0.25 a metre, the centre moved)', r1.length === 0 && builds.length === 0
            && RT.uniformBag().hazeC[3] === 0.25 && RT.uniformBag().hazeC[0] === 0.5, `${JSON.stringify(r1)} ${JSON.stringify(builds)} ${JSON.stringify(RT.uniformBag().hazeC)}`)
        ok('...and taking it away live: refused, the box kept', JSON.stringify(RT.updateScene({ haze: null })) === '["haze"]' && RT.scene.haze?.mfp === 4)
        RT.set({ renderMode: 2 })
        ok('...in Sketch the bag has no haze (density 0), the kernels the same', RT.uniformBag().hazeC[3] === 0 && /\bhazeDraw\b/.test(RT.prog_wvfmarch.wgsl))
        RT.set({ renderMode: 0 })
    }
}

/* THE FACADE STARTED AS THE PAGE STARTS IT (0.61.1): a real camera, the default settings, and a task's turn before the
   first build. The camera's constructor notifies once (camera.js syncOrbitPose), so the facade's first update runs inside
   createPathTracer -- and since the photon map went on by default (0.61.0) the settings' kernel options differ from the
   engine's starting ones (raytrace_main.js R.kernelOptionsOf({}), the map off), so that update starts the kernel job.
   Its first step read `building`, a const declared further down createPathTracer: "Cannot access 'building' before
   initialization" on every page load (the user's console, 2026-10-16). The block below this one starts the facade too,
   but builds it at once, before node reports the rejection -- so it never saw it. */
{
    const { createPathTracer } = await import('../../index.js')
    const { CAMERA } = await import('../../../camera.js')
    const { defines, TOKENS, SHORT_TOKENS } = await import('../../../wgsl_shorthand.js')
    globalThis.requestAnimationFrame ??= f => setTimeout(f, 0)
    const G = onDevice(countingDevice()); G.context = { getCurrentTexture: () => ({ createView: () => ({}) }), canvas: {} }; G.defines = defines(TOKENS, SHORT_TOKENS)
    const rejected = [], heard = e => rejected.push(e?.message ?? String(e))
    process.on('unhandledRejection', heard)
    try {
        const Q = { w: 8, h: 8, resetframecount: 1, camtype: 0, azimuth: 30, elevation: 20, distance: 5, fov: 40 }
        const RT = await quietly(() => createPathTracer({ gpu: G, ctx: { canvas: null }, Q, scene: sphereScene({ id: 'started', uniforms: {} }), CAMERA, hud: false }))
        await new Promise(r => setTimeout(r, 0))            // the page's turn before its first build
        await quietly(() => RT.init())
        await quietly(() => RT.kernelsSettled())
        await new Promise(r => setTimeout(r, 0))
        ok('the facade started as the page starts it (a real camera, the default settings, a task before the first build): no promise left rejected',
            rejected.length === 0, rejected.join(' | '))
        ok('...the photon map asked by the settings and built (by the first build or the job after it)',
            RT.get().sppm === 1 && RT.kernelOptions.sppm === 1 && RT.builtOptions.sppm === 1 && !!RT.prog_sppm,
            `${RT.get().sppm} ${JSON.stringify(RT.kernelOptions)} ${JSON.stringify(RT.builtOptions)}`)
    } finally { process.off('unhandledRejection', heard) }
}

/* THE ENGINE IN METRES (0.36.0; core/units.js, scene_api.js SCENE_BOUNDARY): a millimetre scene through the facade, with
   a real camera (lib/camera.js) in the scene's unit. What the kernels are handed is in metres -- the camera's position, an
   orthographic camera's extents, the step cache's box -- and what the host is handed back is in the scene's: the pick.
   The GPU's answer to the pick is planted (a device whose readback returns it), so the conversion both ways is seen. */
{
    const { createPathTracer } = await import('../../index.js')
    const { CAMERA } = await import('../../../camera.js')
    const { defines, TOKENS, SHORT_TOKENS } = await import('../../../wgsl_shorthand.js')
    globalThis.requestAnimationFrame ??= f => setTimeout(f, 0)
    const dev = countingDevice(), writes = []
    let planted = null                                            // the next readback's bytes, when set
    dev.queue.writeBuffer = (buf, off, data) => writes.push({ size: buf.size, f: new Float32Array(data.buffer ?? data, data.byteOffset ?? 0, (data.byteLength ?? 0) / 4).slice() })
    const mk = dev.createBuffer
    dev.createBuffer = o => { const b = mk(o); b.getMappedRange = () => { const a = new ArrayBuffer(o.size); if (planted) new Uint8Array(a).set(new Uint8Array(planted).subarray(0, o.size)); return a }; return b }
    const G = onDevice(dev); G.context = { getCurrentTexture: () => ({ createView: () => ({}) }), canvas: {} }; G.defines = defines(TOKENS, SHORT_TOKENS)
    const Q = { w: 8, h: 8, resetframecount: 1, camtype: 0, azimuth: 30, elevation: 20, distance: 50, fov: 40 }
    const mm = { ...sphereScene({ uniforms: {} }), id: 'units-mm', unit: 'mm' }
    const RT = await quietly(() => createPathTracer({ gpu: G, ctx: { canvas: null }, Q, scene: mm, CAMERA, hud: false }))
    await quietly(() => RT.init())
    const close = (a, b, rel = 1e-6) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= rel * Math.max(1e-9, Math.abs(b[i])))
    RT.update?.(); RT.set({})
    let bag = RT.uniformBag(), CU = RT.cam.getUniforms()
    ok('metres: an mm scene hands the kernels sceneUnit 0.001 and perMetre 1000', bag.sceneUnit === 0.001 && bag.perMetre === 1000, JSON.stringify([bag.sceneUnit, bag.perMetre]))
    ok('...the camera\'s position times 0.001, its own left in mm (the camera object is the scene\'s)',
        close([...bag.camPos].slice(0, 3), CU.camPos.slice(0, 3).map(x => x * 0.001)) && close([bag.invView[12], bag.invView[13], bag.invView[14]], CU.camPos.slice(0, 3).map(x => x * 0.001))
        && Math.abs(Math.hypot(...CU.camPos.slice(0, 3)) - 50) < 1e-6, JSON.stringify([[...bag.camPos], [...CU.camPos]]))
    ok('...its directions and a perspective projection as they are: no length in them', close([...bag.invView].slice(0, 12), [...CU.invView].slice(0, 12)) && close([...bag.invProjection], [...CU.invProjection]))
    RT.cam.set({ camtype: 1, dimensions: 20 }); RT.set({})                 // 20 mm wide (camera.js: the width, the height by the aspect)
    bag = RT.uniformBag(); CU = RT.cam.getUniforms()
    ok('an orthographic camera: its half width, height and depth times 0.001 -- lengths there', bag.camtype === 1
        && close([bag.invProjection[0], bag.invProjection[5], bag.invProjection[10], bag.invProjection[14]], [CU.invProjection[0], CU.invProjection[5], CU.invProjection[10], CU.invProjection[14]].map(x => x * 0.001))
        && close([CU.invProjection[0], CU.invProjection[5]], [10, 10]), JSON.stringify([[...bag.invProjection], [...CU.invProjection]]))
    RT.cam.set({ camtype: 0 }); RT.set({})
    // the step cache's box, given in mm: the trace's bag has it in metres, the grid kept in mm
    RT.setStepCacheBox({ lo: [-10, -20, -30], hi: [10, 20, 30] })
    const sc = RT.stepCacheUniforms(RT.uniformBag().sceneUnit), g = RT.stepCacheGrid
    ok('the step cache\'s box: in the bag in metres, the grid in mm', close(sc.scLo, [-0.01, -0.02, -0.03, g.cs * 0.001]) && close(g.lo, [-10, -20, -30]), JSON.stringify([sc, g.lo]))
    // the pick: its ray written in metres, its answer read back in mm
    const words = new ArrayBuffer(48), U = new Uint32Array(words), F = new Float32Array(words)
    U[0] = 1; U[1] = 7; F[2] = 0.004; F[4] = 0.001; F[5] = 0.002; F[6] = -0.003; F[10] = 1
    planted = words; writes.length = 0
    const p = await quietly(() => RT.pick(0, 0))
    planted = null
    const pickIn = writes.find(w => w.size === 32)
    ok('a pick: its ray goes in in metres -- from the camera, 0.05 m out', !!pickIn && close([...pickIn.f].slice(0, 3), RT.cam.getUniforms().camPos.slice(0, 3).map(x => x * 0.001)), JSON.stringify(pickIn && [...pickIn.f]))
    ok('...and its answer comes out in mm: the place and the distance, the tag and the normal as they were', !!p && p.hit && p.tag === 7
        && close(p.pos, [1, 2, -3]) && Math.abs(p.distance - 4) < 1e-5 && close(p.normal, [0, 0, 1]), JSON.stringify(p))
}

console.log(fail ? `build: ${pass} passed, ${fail} FAILED` : `build: ${pass} passed, 0 failed`)
process.exit(fail ? 1 : 0)
