// node lib/pathtracer/optics/test/drawn.test.mjs
//
// WHAT THE OPTICS MODULE DRAWS, AND WHICH RAYS A TRACE TAKES, on the real tinywebgpu over a device that records
// instead of drawing (the pattern of core/test/build.test.mjs). The drawer used to draw whatever was in the
// trace's buffer, and a run reseeded the trace for good. Both were harmless while the rays were the only thing
// tracing between two frames; the Optics page's Live analysis now runs batches between two of the rays' traces
// (CLAUDE.md: a second caller), and each batch flashed its own paths over the view, and every round drew other
// rays. It checks:
//   a trace publishes its paths: a copy of the start of its buffer into one of their own, of the size the drawer
//     reads, submitted after the trace's own work -- and the overlay and readPaths read that copy
//   a run publishes nothing, though it records paths and makes the trace's buffers again, bigger: what is drawn,
//     its layout and its buffer, is the trace's before it
//   a run gives the trace its seed back, having drawn a seed of its own for every batch
//   a step and a reset publish, as a trace does: step by step, the drawn paths are the step's
//   the picture's photons: every uniform their kernel reads is one their generate() writes (0.33.7: the march
//     tolerance was not, and with exact hits no LED lit the picture); and one kernel for every scene -- a scene
//     swapped in with other uniforms finds it ready, nothing compiled (0.34.2: the lights went off after a bake)
import { WEBGPU } from '../../../tinywebgpu/src/tinywebgpu.js'
import { RAYTRACER } from '../../core/raytrace_main.js'
import { sphereScene } from '../../core/profile.js'
import { createOptics } from '../index.js'
import { detBase } from '../kernels.js'
import { functionsOf } from '../../core/wgslgraph.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const quietly = async f => { const l = console.log; console.log = () => { }; try { return await f() } finally { console.log = l } }

globalThis.GPUBufferUsage ??= { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 }
globalThis.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 }
globalThis.GPUTextureUsage ??= { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 }

/* THE DEVICE: every encoder numbered, and in one log in the order they happen -- its dispatches and draws, its
   copies (source, destination, bytes), and when it is submitted; every buffer destroyed marked; every bind group's
   buffers kept */
const log = [], groups = []
let encoders = 0, pipes = 0
const pipe = () => { const p = { id: ++pipes }; p.getBindGroupLayout = () => ({ of: p }); return p }
const device = {
    limits: { maxStorageBufferBindingSize: 2 ** 31, maxBufferSize: 2 ** 32 }, features: new Set(),
    createShaderModule: ({ code }) => ({ code, getCompilationInfo: async () => ({ messages: [] }) }),
    pushErrorScope() { }, popErrorScope: async () => null,
    createComputePipeline: () => pipe(), createComputePipelineAsync: async () => pipe(),
    createRenderPipeline: () => pipe(), createRenderPipelineAsync: async () => pipe(),
    createBuffer: ({ size, usage }) => { const b = { size, usage, destroyed: false, mapAsync: async () => { }, getMappedRange: () => new ArrayBuffer(size), unmap() { } }; b.destroy = () => { b.destroyed = true }; return b },
    createBindGroup: d => { groups.push((d.entries || []).map(e => e.resource?.buffer).filter(Boolean)); return {} },
    createSampler: () => ({}), createTexture: () => ({ createView: () => ({}), destroy() { } }), createQuerySet: () => ({ destroy() { } }),
    createCommandEncoder: () => {
        const enc = ++encoders
        const pass = () => ({ setPipeline() { }, setBindGroup() { }, setVertexBuffer() { }, end() { },
                              dispatchWorkgroups: () => log.push({ enc, op: 'dispatch' }), dispatchWorkgroupsIndirect: () => log.push({ enc, op: 'dispatch' }),
                              draw: () => log.push({ enc, op: 'draw' }) })
        return { beginComputePass: pass, beginRenderPass: pass, clearBuffer() { }, copyTextureToBuffer() { },
                 copyBufferToBuffer: (src, so, dst, d0, bytes) => log.push({ enc, op: 'copy', src, so, dst, d0, bytes }),
                 finish: () => ({ enc }) }
    },
    queue: { writeBuffer() { }, submit: cbs => { for (const c of cbs) log.push({ op: 'submit', enc: c.enc }) }, onSubmittedWorkDone: async () => { } },
}
const G = WEBGPU()
G.device = device
G.format = 'bgra8unorm'
const R = RAYTRACER(G, null, { w: 8, h: 8, resetframecount: 0 }, { ...sphereScene({ uniforms: {} }), id: 'drawn' })
R.hud = () => { }
await quietly(() => R.init())
/* the host's side of the renderer the module asks for (lib/pathtracer/index.js): its uniforms, the overlays it draws
   after the picture, and a camera for the drawer */
const RT = { get scene() { return R.scene }, get learn() { return R.learn }, uniformBag: () => ({}), photonSources: [], overlays: [],
             redraw() { }, invalidate() { },
             cam: { getUniforms: () => ({ camPos: [0, 0, 5], invView: new Array(16).fill(0), invProjection: new Array(16).fill(1) }), get: () => ({ camtype: 0 }) } }
const O = createOptics(RT, G)
O.setSources([{ type: 'disc', pos: [0, 0, 1], axis: [0, 0, -1], size: [0.3, 0.3], distribution: 'cosine', halfAngle: 90, n: 1,
                flux: 1000, emitN: 1, twoSided: false }])
O.settings.pathRays = 64

/* the copies into a buffer, after log position `from` */
const copiesInto = (buf, from = 0) => log.slice(from).filter(e => e.op === 'copy' && e.dst === buf)
const submittedAt = enc => log.findIndex(e => e.op === 'submit' && e.enc === enc)

// A TRACE PUBLISHES
let mark = log.length
await O.trace({ rays: 200, steps: 3 })
const drawn = O.drawn
ok('a trace publishes what it drew: its layout -- the paths it recorded, steps + 2 vertices each', drawn?.rays === 64 && drawn?.verts === 5, JSON.stringify(drawn && { rays: drawn.rays, verts: drawn.verts }))
const pub = copiesInto(drawn?.buffer?.b, mark)
const dataBuf = pub[0]?.src
ok('...a copy of the start of its buffer, of the size the drawer reads (the tallies and the paths, to the detector hits)',
    pub.length === 1 && pub[0].so === 0 && pub[0].d0 === 0 && pub[0].bytes === detBase(64, 5) * 4 && drawn.buffer.b.size >= pub[0].bytes,
    JSON.stringify(pub.map(c => ({ so: c.so, d0: c.d0, bytes: c.bytes }))))
const lastDispatch = log.slice(mark).filter(e => e.op === 'dispatch').at(-1)
ok('...submitted after the trace\'s own work', lastDispatch && submittedAt(pub[0]?.enc) > submittedAt(lastDispatch.enc), `${submittedAt(pub[0]?.enc)} vs ${lastDispatch && submittedAt(lastDispatch.enc)}`)
const pathsRead = await O.readPaths()
ok('...and readPaths reads the copy, in its layout', pathsRead?.rays === 64 && pathsRead?.verts === 5)

// THE OVERLAY DRAWS THE COPY
O.drawPaths(true)
groups.length = 0
mark = log.length
RT.overlays[0]({ createView: () => ({}) })
ok('the overlay draws the published paths: its bind group is the copy, not the trace\'s buffer',
    log.slice(mark).some(e => e.op === 'draw') && groups.some(g => g.includes(drawn.buffer.b)) && !groups.some(g => g.includes(dataBuf)),
    JSON.stringify(groups.map(g => g.map(b => b === drawn.buffer.b ? 'copy' : b === dataBuf ? 'trace' : b.size))))

// A RUN DOES NOT, AND GIVES THE SEED BACK
const seed = O.seed.join()
const seeds = []
const reseed = O.reseed
O.reseed = () => { reseed(); seeds.push(O.seed.join()) }
mark = log.length
await O.run({ rays: 4000, batches: 3 })            // more rays than the trace: the trace's buffers are made again
O.reseed = reseed
ok('a run publishes nothing: what is drawn is the trace\'s, its layout and its buffer', O.drawn === drawn && copiesInto(drawn.buffer.b, mark).length === 0,
    `${copiesInto(drawn.buffer.b, mark).length} copies`)
ok('...though it recorded paths of its own (the readbacks are of its buffer) and made the trace\'s buffers again',
    log.slice(mark).some(e => e.op === 'copy' && e.src !== dataBuf && e.src !== drawn.buffer.b) && dataBuf?.destroyed === true && drawn.buffer.b.destroyed === false)
ok('...each batch on a seed of its own', seeds.length === 3 && new Set(seeds).size === 3 && !seeds.includes(seed), JSON.stringify(seeds))
ok('...and the trace\'s seed is given back: the rays traced next are the rays drawn before', O.seed.join() === seed, `${O.seed} vs ${seed}`)
const after = await O.readPaths()
ok('...and readPaths still reads the trace\'s', after?.rays === 64 && after?.verts === 5, JSON.stringify(after && { rays: after.rays, verts: after.verts }))
/* tinywebgpu keeps a bind group while its resources are the same, so a draw makes one only if something else was
   bound: none may name a storage buffer but the copy */
groups.length = 0
mark = log.length
RT.overlays[0]({ createView: () => ({}) })
ok('...and the overlay still draws the copy: no storage buffer but it bound', log.slice(mark).some(e => e.op === 'draw')
    && groups.every(g => g.every(b => !(b.usage & GPUBufferUsage.STORAGE) || b === drawn.buffer.b)), JSON.stringify(groups.map(g => g.map(b => b.size))))

// A TRACE AFTER IT publishes again, into the same copy when it fits
mark = log.length
await O.trace({ rays: 200, steps: 2 })
ok('a trace after the run publishes again, into the same copy (it fits)', O.drawn !== drawn && O.drawn.buffer === drawn.buffer && O.drawn.verts === 4
    && copiesInto(drawn.buffer.b, mark).length === 1)
/* a run that throws gives the seed back too: a source table with nothing in it is refused in its first generate */
const seed2 = O.seed.join()
O.setSources([])
const e = await O.run({ rays: 100, batches: 2 }).then(() => null, e => e)
ok('a run refused part way gives the seed back as well', /no sources/.test(e?.message ?? '') && O.seed.join() === seed2, e?.message)
O.setSources([{ type: 'disc', pos: [0, 0, 1], axis: [0, 0, -1], size: [0.3, 0.3], distribution: 'cosine', halfAngle: 90, n: 1,
                flux: 1000, emitN: 1, twoSided: false }])

// STEP BY STEP: a reset and each step publish
mark = log.length
await O.reset({ rays: 300 })
const atReset = O.drawn
ok('a reset publishes: the rays at the source', atReset !== null && atReset.rays === 64 && copiesInto(atReset.buffer.b, mark).length === 1)
mark = log.length
await O.step()
ok('...and a step publishes its paths', O.drawn !== atReset && copiesInto(O.drawn.buffer.b, mark).length === 1)

/* THE PICTURE'S PHOTONS (R.photonSources, the source lighting the picture): EVERY UNIFORM THEIR KERNEL READS IS ONE
   generate() WRITES. That kernel is handed a few names, not the renderer's bag, and the three marchEps() is made of
   were not among them until 0.33.7: optSourceRay stepped every photon off its face by a tolerance of nothing, and with
   exact hits each one was taken by the black back of its own light (optics/index.js says how). Walked from main through
   every function it calls (core/wgslgraph.js), in the kernel's text as tinywebgpu assembled it. */
{
    const made = []
    const makeCompute = G.makeCompute
    G.makeCompute = (...a) => {
        const keep = h => { if (h) made.push(h); return h }
        const p = makeCompute.apply(G, a)
        return p?.then ? p.then(keep) : keep(p)
    }
    await O.lightPicture(true)
    G.makeCompute = makeCompute
    const src = RT.photonSources.find(s => s.name === 'optics sources')
    const k = made.find(h => /\boptFluxPerPhoton\b/.test(h.wgsl ?? ''))
    ok('the picture\'s photons: a source registered with the renderer, its kernel compiled', !!src && !!k && src.ready())
    // what generate() hands the kernel, recorded on the way in (a handle's uniforms are a setter: tinywebgpu.js)
    const writes = []
    const set = Object.getOwnPropertyDescriptor(k, 'uniforms')?.set
    Object.defineProperty(k, 'uniforms', { configurable: true, set(v) { writes.push(v); set.call(k, v) } })
    const bag = { seed: [1, 2, 3, 4], eps: 0, epsAuto: 0.02, sceneUnit: 0.001 }
    src.generate({ buffer: R.raybuffer0, offset: 8, count: 32, uniforms: bag })
    const fns = functionsOf(k.wgsl), seen = new Set(), reads = new Set()
    const walk = n => {
        if (seen.has(n) || !fns.has(n)) return
        seen.add(n)
        for (const m of fns.get(n).body.matchAll(/\bUB\.(\w+)/g)) reads.add(m[1])
        fns.get(n).calls.forEach(walk)
    }
    walk('main')
    const written = new Set(writes.flatMap(w => Object.keys(w)))
    const missing = [...reads].filter(n => !written.has(n))
    ok('...every uniform its kernel reads, from main down, written by generate()', writes.length === 1 && reads.size > 0 && missing.length === 0,
        `reads ${[...reads].join(', ')}; not written: ${missing.join(', ')}`)
    ok('...the march tolerance\'s two among them (optSourceRay steps a photon off its face by it), with the bag\'s values',
        ['eps', 'epsAuto'].every(n => reads.has(n) && writes[0]?.[n] === bag[n]), JSON.stringify(writes[0]))
    // ...and no unit: the kernel is the engine's, in metres since 0.36.0 (its sources come in metres, sourceRecords)
    ok('...and not the scene\'s unit: the engine is in metres', !reads.has('sceneUnit') && !reads.has('perMetre'), [...reads].join(', '))

    /* ...AND ONE KERNEL FOR EVERY SCENE (0.34.2). It took the scene's uniforms into its struct, so each scene shown was a
       compile of its own, and ready() said no until it ended: the frames between, no lights' photons. The builder's bake
       swaps in a scene whose uniforms are its boxes alone, keeping the picture -- the light-traced lights went off once
       or twice right after every bake (the user, 2026-10-07). A scene swapped in with other uniforms, the picture kept as
       the bake keeps it: ready at the first ask, nothing compiled, the same kernel generating, none of the scene's
       uniforms in it. */
    const before = made.length
    G.makeCompute = (...a) => {
        const keep = h => { if (h) made.push(h); return h }
        const p = makeCompute.apply(G, a)
        return p?.then ? p.then(keep) : keep(p)
    }
    await quietly(() => R.setScene({ ...sphereScene({ uniforms: { bxlo_baked: { type: 'vec4<f32>', def: [0, 0, 0, 0] } } }), id: 'drawn-baked' }, { keepPicture: true }))
    const photonKernels = () => made.slice(before).filter(h => /\boptFluxPerPhoton\b/.test(h.wgsl ?? ''))
    ok('...a scene swapped in, other uniforms and the picture kept: ready at the first ask, no photon kernel compiled',
        R.scene.id === 'drawn-baked' && src.ready() === true && photonKernels().length === 0, `${photonKernels().length} compiled`)
    writes.length = 0
    src.generate({ buffer: R.raybuffer0, offset: 8, count: 32, uniforms: bag })
    await new Promise(r => setTimeout(r, 0))
    G.makeCompute = makeCompute
    ok('...the same kernel generating, and none of the scene\'s uniforms in its text', writes.length === 1 && photonKernels().length === 0
        && !/\bbxlo_baked\b/.test(k.wgsl), `${writes.length} writes`)
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
