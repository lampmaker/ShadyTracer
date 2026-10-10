// node bench/shaderstats.mjs [width height] [--json] [--bench]
//
// THE BENCHMARK'S STATIC HALF: what can be measured without a GPU, and so measured here, exactly. Two tables,
// for every bundled scene (scenes) -- or, with --bench, for the benchmark's own frozen copies
// (bench/scenes), the scenes its compile and GPU columns were measured on:
//
//   1. WHAT EACH KERNEL HOLDS. Its WGSL text and its size with every call inlined (wgslgraph.js says why that is
//      the size a compiler sees), and how many copies of the scene's SDF and getMaterial2 that makes. Every
//      kernel a scene's structural edit compiles is here: the build's three that inline the scene, the probe,
//      and the ones compiled on first use (pick, tagfield, the optics trace's).
//   2. WHAT RECORDING ONE SAMPLE ASKS OF THE CPU: the real engine (raytrace_main.js R.trace) and the real
//      tinywebgpu over a device that records instead of drawing -- compute passes, dispatches, uniform copies
//      and their bytes per sample, and the JavaScript time to record it. The counts are exact. The time is
//      this machine's, node's V8 and not a browser's: compare scenes and commits with it, not computers.
//
// NOTHING HERE IS A GPU TIME. How long the kernels run, and how long the browser takes to compile them, is
// the benchmark's other half (bench, in the page), on real hardware.
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inlineStats } from './wgslgraph.js'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const imp = p => import(pathToFileURL(join(repo, p)).href)
const args = process.argv.slice(2)
const json = args.includes('--json')
const [W, H] = args.filter(a => /^\d+$/.test(a)).map(Number).concat([1280, 720]).slice(0, 2)

// the WebGPU enums as numbers, as the tests' recording devices declare them
globalThis.GPUBufferUsage ??= { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 }
globalThis.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 }
globalThis.GPUTextureUsage ??= { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 }
globalThis.GPUMapMode ??= { READ: 1, WRITE: 2 }

const W_ = await imp('lib/pathtracer/core/wavefront.js')
const G = await imp('lib/pathtracer/core/genrays.js')
const PK = await imp('lib/pathtracer/core/pick.js')
const FD = await imp('lib/pathtracer/core/field.js')
const OPT = await imp('lib/pathtracer/optics/kernels.js')
const U = await imp('lib/pathtracer/core/uniforms.schema.js')
const { derive } = await imp('lib/pathtracer/core/photometry.js')
const { WEBGPU } = await imp('lib/tinywebgpu/src/tinywebgpu.js')
const { RAYTRACER } = await imp('lib/pathtracer/core/raytrace_main.js')
const { PROBE_MAIN } = await imp('builder/validate.js')
const { generate } = await imp('builder/codegen.js')
const Model = await imp('builder/model.js')
const { SCENE_FILES } = await imp('scenes/index.js')
const { defines, shorthand, TOKENS, SHORT_TOKENS } = await imp('lib/wgsl_shorthand.js')
const rewrite = shorthand(TOKENS, SHORT_TOKENS)

const sceneDir = args.includes('--bench') ? 'bench/scenes' : 'scenes'
const sceneFiles = args.includes('--bench') ? readdirSync(join(repo, sceneDir)).filter(f => f.endsWith('.json')).sort() : SCENE_FILES
const scenes = sceneFiles.map(file => {
    const doc = Model.parse(readFileSync(join(repo, sceneDir, file), 'utf8'))
    const t0 = performance.now()
    const scene = generate(Model.toTree(doc), { id: file.replace('.json', ''), title: file })
    return { file, doc, scene, generateMs: performance.now() - t0 }
})

//----------------------------------------------------------------------------------------------------------------------
// 1. WHAT EACH KERNEL HOLDS
//----------------------------------------------------------------------------------------------------------------------
/* A device that compiles nothing and keeps what it was asked to (check-shaders' spy) */
const spy = { makeCompute: (body, main, uniformTypes = {}, resources = {}, opts = {}) => ({ body, main, uniformTypes, resources, opts }) }
const KERNELS = scene => [
    ['march', () => W_.prog_march(spy, scene, 64)],
    ['surface', () => W_.prog_surface(spy, scene, 64)],
    ['shade', () => W_.prog_shade(spy, scene, 64)],
    ['occlude', () => W_.prog_occlude(spy, scene, 64)],
    ['probe', () => spy.makeCompute(scene.body, PROBE_MAIN, U.computeUniformTypes(scene.uniforms), { probe: 'array<f32>' }, {})],
    ['genrays', () => G.genrays_prog(spy, 64, scene)],
    ['genphotons', () => W_.prog_genphotons(spy, 64, scene)],
    ['pick', () => PK.prog_pick(spy, scene)],
    ['tagfield', () => FD.prog_tagfield(spy, scene)],
    ['opt_shade', () => OPT.prog_opt_shade(spy, scene, 64)],
    ['opt_march', () => W_.prog_march(spy, scene.opticsWgsl ? { ...scene, wgsl: scene.opticsWgsl } : scene, 64)],
]
const kernelRows = []
for (const { file, scene } of scenes) {
    for (const [kernel, build] of KERNELS(scene)) {
        const k = await build()
        const s = inlineStats(rewrite(`${k.body}\nfn main() {\n${k.main}\n}`), 'main')
        kernelRows.push({ scene: file, kernel, text: s.text, inlined: s.inlined, sdf: s.copies.SDF, mat: s.copies.getMaterial2,
                          oneSdf: s.one.SDF, oneMat: s.one.getMaterial2 })
    }
}

//----------------------------------------------------------------------------------------------------------------------
// 2. WHAT RECORDING ONE SAMPLE ASKS OF THE CPU
//----------------------------------------------------------------------------------------------------------------------
const C = { passes: 0, dispatches: 0, copies: 0, copyBytes: 0, submits: 0 }
const pass = () => { C.passes++; return { setPipeline() { }, setBindGroup() { }, dispatchWorkgroups() { C.dispatches++ }, dispatchWorkgroupsIndirect() { C.dispatches++ }, draw() { }, end() { } } }
const stubPipeline = () => ({ getBindGroupLayout: () => ({}) })
const device = {
    limits: { maxStorageBufferBindingSize: 2 ** 31, maxBufferSize: 2 ** 32 }, features: new Set(),
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    pushErrorScope() { }, popErrorScope: async () => null,
    createComputePipeline: stubPipeline, createComputePipelineAsync: async () => stubPipeline(),
    createRenderPipeline: stubPipeline, createRenderPipelineAsync: async () => stubPipeline(),
    createBuffer: ({ size, usage }) => ({ size, usage, destroy() { }, mapAsync: async () => { }, getMappedRange: () => new ArrayBuffer(size), unmap() { } }),
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({
        beginComputePass: pass, beginRenderPass: pass, clearBuffer() { },
        copyBufferToBuffer(a, b, c, d, n) { C.copies++; C.copyBytes += n },
        finish: () => ({}),
    }),
    queue: { writeBuffer() { }, submit: cbs => { C.submits += cbs.length }, onSubmittedWorkDone: async () => { } },
}
const S = WEBGPU()
S.device = device
S.format = 'bgra8unorm'
S.context = { getCurrentTexture: () => ({ createView: () => ({}) }), canvas: {} }
S.defines = defines(TOKENS, SHORT_TOKENS)
const ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const quiet = async f => { const l = console.log, w = console.warn; console.log = console.warn = () => { }; try { return await f() } finally { console.log = l; console.warn = w } }
const frameRows = []
for (const { file, doc, scene } of scenes) {
    const Q = { w: W, h: H, resetframecount: 1 }
    const R = RAYTRACER(S, null, Q, scene)
    R.hud = () => { }
    await quiet(() => R.init())
    /* the bag the page hands R.trace: the schema's defaults, the scene's own, its environment, what photometry
       derives -- the uniforms every kernel is handed whole (index.js buildUniforms) */
    const values = { ...U.defaultUniformValues() }
    for (const [k, v] of Object.entries(scene.uniforms)) values[k] = U.uniformToGPU(v.def, v.type)
    for (const [k, v] of Object.entries(doc.environment || {})) if (k in U.UniformSpec) values[k] = v
    const types = U.computeUniformTypes(scene.uniforms)
    const bag = Object.fromEntries(Object.entries({ ...values, ...derive(values, { unit: scene.unit, extent: scene.extent }),
        invView: ident, invProjection: ident, invViewProjection: ident, camPos: [0, -5, 2, 1], camtype: 0, resetframecount: 1 })
        .filter(([k]) => k in types))
    const times = []
    let counts = null
    for (let i = 0; i < 23; i++) {
        for (const k in C) C[k] = 0
        const t0 = performance.now()
        await quiet(() => R.trace(Q, bag, 1))
        if (i >= 3) times.push(performance.now() - t0)      // three to warm up
        counts = { ...C }
    }
    times.sort((a, b) => a - b)
    frameRows.push({ scene: file, uniforms: Object.keys(types).length, sceneUniforms: Object.keys(scene.uniforms).length,
                     iterations: R.budget, ...counts, jsMs: times[times.length >> 1], generateMs: scenes.find(s => s.file === file).generateMs })
}

//----------------------------------------------------------------------------------------------------------------------
if (json) { console.log(JSON.stringify({ kernels: kernelRows, frame: { width: W, height: H, rows: frameRows } }, null, 1)); process.exit(0) }
const K = n => `${(n / 1024).toFixed(0)}K`
const pad = (s, w) => String(s).padStart(w)
console.log('1. WHAT EACH KERNEL HOLDS -- comment-free WGSL characters; "inlined" with every call inlined; copies of the')
console.log('   scene\'s SDF and getMaterial2 in it (static call sites: an upper bound)\n')
for (const { file } of scenes) {
    const rows = kernelRows.filter(r => r.scene === file)
    console.log(`${file}   one SDF ${K(rows[0].oneSdf)}, one getMaterial2 ${K(rows[0].oneMat)}`)
    console.log('   kernel        text  inlined   SDF  getMaterial2')
    for (const r of rows) console.log(`   ${r.kernel.padEnd(11)} ${pad(K(r.text), 6)} ${pad(K(r.inlined), 8)} ${pad(r.sdf, 5)} ${pad(r.mat, 13)}`)
}
console.log(`\n2. WHAT RECORDING ONE SAMPLE ASKS OF THE CPU -- ${W}x${H}, the defaults; JS ms is this machine's (node ${process.version}), median of 20\n`)
console.log('   scene              uniforms  iterations  passes  dispatches  uniform copies  copied KB  submits  JS ms  generate ms')
for (const r of frameRows)
    console.log(`   ${r.scene.padEnd(18)} ${pad(r.uniforms, 8)} ${pad(r.iterations, 11)} ${pad(r.passes, 7)} ${pad(r.dispatches, 11)} ${pad(r.copies, 15)} ${pad((r.copyBytes / 1024).toFixed(0), 10)} ${pad(r.submits, 8)} ${pad(r.jsMs.toFixed(1), 6)} ${pad(r.generateMs.toFixed(1), 12)}`)
