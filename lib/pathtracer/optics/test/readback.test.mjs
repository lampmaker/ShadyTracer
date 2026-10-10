// node lib/pathtracer/optics/test/readback.test.mjs
//
// A RUN'S BATCHES READ BACK TOGETHER, on the real tinywebgpu over a device that keeps every buffer's bytes and carries
// out every copy, clear and write in queue order. Each readback waits for everything submitted before it -- the
// picture's frames too -- and a Live round of four batches waited sixteen times: 1.4 s a round with the picture
// running, 0.2 s with it stopped (measured by the user, 2026-10-04). Now each batch's results are copied on the GPU into
// a slot of their own after its chain, and a group of batches is read back once. What could go wrong is silent: a slot
// read for another batch, an offset off by a layout, a copy before the chain it copies. So the device plays the shade
// here: when a chain is submitted it writes into the trace buffer a result that names its batch -- an escaped flux of
// j, j + 1 detector hits tagged j, a far-field bin of j -- and each batch must read back as its own. It checks:
//   a run of four small batches: one readback; each batch's tallies, hits and far field its own, in order; the mean
//     and error of the four
//   batches with too many hits for one readback: the groups the byte limit makes, one readback each, still each its own
//   the settings changed during a run (the page writes them whenever the person does): the run keeps its own, so every
//     batch is laid out alike and read at the right offsets
//   a run into an estimate it was given: added to it; one of another far-field grid refused
//   a trace, a reset, a step: one readback each, where a trace had two
import { WEBGPU } from '../../../tinywebgpu/src/tinywebgpu.js'
import { RAYTRACER } from '../../core/raytrace_main.js'
import { sphereScene } from '../../core/profile.js'
import { createOptics } from '../index.js'
import { fluxPerRay } from '../sources.js'
import { OPT_FX, O_FLUX, F_ESCAPED, O_DETN, DET_WORDS, detBase, farBase } from '../kernels.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b))
const quietly = async f => { const l = console.log; console.log = () => { }; try { return await f() } finally { console.log = l } }

globalThis.GPUBufferUsage ??= { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 }
globalThis.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 }
globalThis.GPUTextureUsage ??= { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 }

/* THE DEVICE: buffers whose bytes are made when first touched (the ray buffers, which no kernel here touches, never
   are); a command buffer's copies and clears carried out when it is submitted, in order; queue writes at once. A
   submit with five dispatches or more is a chain: `shade` is called then, with the buffer cleared last (generate
   clears the trace buffer first) */
const bytes = b => (b._bytes ??= new Uint8Array(b.size))
let maps = 0, shade = null, lastCleared = null
const pipe = () => { const p = {}; p.getBindGroupLayout = () => ({}); return p }
const device = {
    limits: { maxStorageBufferBindingSize: 2 ** 31, maxBufferSize: 2 ** 32 }, features: new Set(),
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    pushErrorScope() { }, popErrorScope: async () => null,
    createComputePipeline: pipe, createComputePipelineAsync: async () => pipe(),
    createRenderPipeline: pipe, createRenderPipelineAsync: async () => pipe(),
    createBuffer: ({ size, usage }) => ({ size, usage, destroy() { }, unmap() { },
        mapAsync: async () => { maps++ }, getMappedRange(off = 0, n = this?.size) { return bytes(this).buffer.slice(off, off + (n ?? this.size)) } }),
    createBindGroup: () => ({}), createSampler: () => ({}), createTexture: () => ({ createView: () => ({}), destroy() { } }), createQuerySet: () => ({ destroy() { } }),
    createCommandEncoder: () => {
        const ops = []
        const pass = () => ({ setPipeline() { }, setBindGroup() { }, setVertexBuffer() { }, end() { }, draw() { },
                              dispatchWorkgroups: () => ops.push({ op: 'dispatch' }), dispatchWorkgroupsIndirect: () => ops.push({ op: 'dispatch' }) })
        return { beginComputePass: pass, beginRenderPass: pass, copyTextureToBuffer() { },
                 copyBufferToBuffer: (src, so, dst, d0, n) => ops.push({ op: 'copy', src, so, dst, d0, n }),
                 clearBuffer: (b, off = 0, n = b.size - off) => ops.push({ op: 'clear', b, off, n }),
                 finish: () => ({ ops }) }
    },
    queue: {
        writeBuffer(b, off, data, dataOff = 0, size) {
            const el = data.BYTES_PER_ELEMENT ?? 1, src = new Uint8Array(data.buffer ?? data, (data.byteOffset ?? 0) + dataOff * el, size != null ? size * el : undefined)
            bytes(b).set(src, off)
        },
        submit(cbs) {
            for (const { ops } of cbs) {
                if (ops.filter(o => o.op === 'dispatch').length >= 5) shade?.(lastCleared)
                for (const o of ops) {
                    if (o.op === 'copy') bytes(o.dst).set(bytes(o.src).subarray(o.so, o.so + o.n), o.d0)
                    else if (o.op === 'clear') { bytes(o.b).fill(0, o.off, o.off + o.n); if (o.off === 0 && o.n === o.b.size) lastCleared = o.b }
                }
            }
        },
        onSubmittedWorkDone: async () => { },
    },
}
// the copies of a submit go after its chain: a chain writes, then the copy queued behind it reads -- as on a GPU
const G = WEBGPU()
G.device = device
G.format = 'bgra8unorm'
const R = RAYTRACER(G, null, { w: 8, h: 8, resetframecount: 0 }, { ...sphereScene({ uniforms: {} }), id: 'readback', detectors: [2] })
R.hud = () => { }
await quietly(() => R.init())
const RT = { get scene() { return R.scene }, get learn() { return R.learn }, uniformBag: () => ({}), photonSources: [], overlays: [],
             redraw() { }, invalidate() { } }
const O = createOptics(RT, G)
const FLUX = 1000
O.setSources([{ type: 'disc', pos: [0, 0, 1], axis: [0, 0, -1], size: [0.3, 0.3], distribution: 'cosine', halfAngle: 90, n: 1,
                flux: FLUX, emitN: 1, twoSided: false }])
Object.assign(O.settings, { pathRays: 16, pathVerts: 4, bounces: 4, marchSteps: 64 })
O.setFar({ mode: 'escaped', nC: 4, nG: 7 })

/* THE SHADE, played: batch j (counted from 1 over the whole test) escapes a weight of j, leaves j + 1 hits tagged j
   with a weight of 1 each, and puts j into far-field bin 0 -- at the offsets of the layout the batch was made with */
let j = 0, hitsAs = () => j + 1
const pairAt = (u, w, x) => { const v = Math.round(x * OPT_FX); u[w] = v % 4294967296; u[w + 1] = Math.floor(v / 4294967296) }
shade = buf => {
    j++
    const L = O.layout, u = new Uint32Array(bytes(buf).buffer), f = new Float32Array(bytes(buf).buffer)
    pairAt(u, O_FLUX + F_ESCAPED * 2, j)
    const n = hitsAs()
    u[O_DETN] = n
    for (let i = 0; i < Math.min(n, L.detCap); i++) {
        const b = detBase(L.rays, L.verts) + i * DET_WORDS
        f[b] = i; f[b + 1] = 0; f[b + 2] = 0; f[b + 3] = 1; u[b + 7] = j
    }
    if (L.far?.bins) pairAt(u, farBase(L.rays, L.verts, L.detCap), j)
}

// A RUN OF FOUR SMALL BATCHES: one readback, every batch its own
let seen = []
let at = maps, j0 = j
let r = await O.run({ rays: 100, batches: 4, onBatch: (res, b, batch) => { seen.push({ b, escaped: res.escaped.value, hits: batch.hits(), last: batch.last }) } })
const k100 = fluxPerRay(FLUX, 100)
ok('four small batches: ONE readback for the run', maps - at === 1, `${maps - at} readbacks`)
ok('...each batch read as its own: its hits, all tagged with it, as many as it made', seen.length === 4
    && seen.every((s, i) => s.b === i + 1 && s.hits.hits.length === j0 + i + 2 && s.hits.count === j0 + i + 2 && s.hits.hits.every(h => h.tag === j0 + i + 1)),
    JSON.stringify(seen.map(s => [s.b, s.hits.count, s.hits.hits[0]?.tag])))
ok('...each hit\'s flux the batch\'s flux a ray', seen.every(s => s.hits.hits.every(h => near(h.flux, k100, 1e-6))))
ok('...and the running mean after each: of the batches so far', seen.every((s, i) => near(s.escaped, k100 * (j0 + 1 + (j0 + i + 1)) / 2, 1e-6)),
    JSON.stringify(seen.map(s => s.escaped)))
ok('...the last of the readback said so', seen.map(s => s.last).join() === 'false,false,false,true')
const mean = k100 * (j0 + 2.5), sd = k100 * Math.sqrt(5 / 3)
ok('the run\'s escaped flux: the mean of the four, its standard error from their spread', near(r.escaped.value, mean, 1e-6) && near(r.escaped.se, sd / 2, 1e-6) && r.batches === 4 && r.rays === 400,
    JSON.stringify(r.escaped))
ok('...and the far field\'s bin 0 the same way', near(O.far.flux[0], mean, 1e-6) && near(O.far.se[0], sd / 2, 1e-6) && O.far.batches === 4 && O.far.nC === 4 && O.far.nG === 7,
    JSON.stringify([O.far.flux[0], O.far.se?.[0]]))

// BATCHES WITH TOO MANY HITS FOR ONE READBACK: a slot holds as many hits as the batch has rays, so 250 000 rays a batch
// is 10 MB of hits a slot, and a group is what fits in 32 MB
seen = []; at = maps; j0 = j
hitsAs = () => 3
r = await O.run({ rays: 250000, batches: 7, onBatch: (res, b, batch) => { seen.push({ b, hits: batch.hits(), last: batch.last }) } })
ok('seven batches of 250 000 rays: in groups of three, one readback each', maps - at === 3 && seen.map(s => s.last).join() === 'false,false,true,false,false,true,true',
    `${maps - at} readbacks, last ${seen.map(s => s.last)}`)
ok('...each batch still its own', seen.length === 7 && seen.every((s, i) => s.hits.hits.length === 3 && s.hits.hits.every(h => h.tag === j0 + i + 1)),
    JSON.stringify(seen.map(s => s.hits.hits.map(h => h.tag))))

// THE SETTINGS CHANGED DURING A RUN: a later group made with them would be laid out otherwise and read at the old offsets
seen = []; j0 = j
hitsAs = () => 2
let refused = null
r = await O.run({ rays: 250000, batches: 6, onBatch: (res, b, batch) => {
    seen.push(batch.hits().hits.map(h => h.tag))
    if (b === 1) { O.settings.pathVerts = 9; O.settings.pathRays = 5; O.setFar({ nG: 13 }) }
} }).catch(e => { refused = e; return null })
ok('the settings changed in the middle of a run: the run keeps its own, every batch read as its own', !refused && seen.length === 6
    && seen.every((t, i) => t.length === 2 && t.every(x => x === j0 + i + 1)) && O.far?.nG === 7, `${refused?.message} ${JSON.stringify(seen)}`)
ok('...and the next trace takes the new ones', (await O.trace({ rays: 50, steps: 2 }), O.layout.far.nG === 13 && O.settings.pathRays === 5))
O.setFar({ nG: 7 }); Object.assign(O.settings, { pathRays: 16, pathVerts: 4 })

// A RUN INTO AN ESTIMATE: it adds to it; one of another grid is refused
const E = O.estimate()
hitsAs = () => 1
await O.run({ rays: 100, batches: 2, into: E })
await O.run({ rays: 100, batches: 3, into: E })
ok('a run into an estimate it was given: added to what is there', E.batches === 5 && E.results().batches === 5 && E.farField().batches === 5)
O.setFar({ nG: 13 })
const e = await O.run({ rays: 100, batches: 2, into: E }).then(() => null, e => e)
ok('...one of another far-field grid refused, loudly', /another far-field grid/.test(e?.message ?? ''), e?.message)
O.setFar({ nG: 7 })

// A TRACE, A RESET, A STEP: one readback each
at = maps
const tr = await O.trace({ rays: 100, steps: 3 })
ok('a trace: one readback, where it took two', maps - at === 1 && near(tr.escaped.value, k100 * j, 1e-6) && tr.escaped.se === null, `${maps - at} readbacks`)
at = maps
await O.reset({ rays: 100 })
ok('a reset: one readback', maps - at === 1, `${maps - at}`)
at = maps
await O.step()
ok('a step: one readback', maps - at === 1, `${maps - at}`)
ok('...and readHits still reads the trace buffer as it stands', (await O.readHits())?.count === 1)

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
