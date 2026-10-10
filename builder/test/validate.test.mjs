// node builder/test/validate.test.mjs
//
// THE BUILDER'S PROBE (builder/validate.js) through the real tinywebgpu, over a device that compiles nothing: a module
// whose compilation info the test writes, and pipeline creation counted. What it checks is what 0.9.5 changed: the
// probe makes a MODULE and never a pipeline (the pipeline was the seconds; PERFORMANCE_REVIEW.md #2); an error still
// lands on the node and line the user wrote, through what tinywebgpu really does to the source; a warning alone is
// clean; and a compiler that gives no answer is never read as a clean one.
import { WEBGPU } from '../../lib/tinywebgpu/src/tinywebgpu.js'
import { validate, BODY_MARKER } from '../validate.js'
import { generate } from '../codegen.js'
import { primitiveObject } from '../primitives.js'
import { computeUniformTypes } from '../../lib/pathtracer/core/uniforms.schema.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}

// the WebGPU enums as numbers: they do not exist outside a browser
globalThis.GPUBufferUsage ??= { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 }
globalThis.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 }
globalThis.GPUMapMode ??= { READ: 1, WRITE: 2 }

/* A device that compiles nothing: every module's compilation info is `answer(code)` (an array of messages, or a
   thrown error for a lost device), and every pipeline asked for is counted. */
const fakeGpu = answer => {
    const made = { modules: [], pipelines: 0 }
    const device = {
        limits: { maxStorageBufferBindingSize: 2 ** 31, maxBufferSize: 2 ** 32 }, features: new Set(),
        createShaderModule: ({ code }) => {
            const m = { code, getCompilationInfo: async () => ({ messages: answer(code) }) }
            made.modules.push(m)
            return m
        },
        createComputePipeline: () => { made.pipelines++; return { getBindGroupLayout: () => ({}) } },
        createComputePipelineAsync: async () => { made.pipelines++; return { getBindGroupLayout: () => ({}) } },
        pushErrorScope() { }, popErrorScope: async () => null,
        createBuffer: ({ size, usage }) => ({ size, usage, destroy() { } }),
        createBindGroup: () => ({}),
        queue: { writeBuffer() { }, submit() { }, onSubmittedWorkDone: async () => { } },
    }
    const S = WEBGPU()
    S.device = device
    S.format = 'bgra8unorm'
    return { gpu: S, made }
}
/* tinywebgpu logs every module's messages with a window of source (its DIAG compile log): right in a page, noise
   here, where the messages are the test's own. Muted while a probe runs, and only then. */
const quietly = async f => {
    const { error, warn } = console
    console.error = console.warn = () => { }
    try { const r = await f(); await new Promise(r => setTimeout(r, 0)); return r } finally { Object.assign(console, { error, warn }) }
}
// the compiler's line for the first line of `code` holding `text`, 1-based, as a real one reports it
const lineOf = (code, text) => code.split('\n').findIndex(l => l.includes(text)) + 1

const sphere = () => { const s = primitiveObject('sphere'); return { type: 'code', code: s.code, id: 'first', params: { ...s.params } } }
const slab = code => ({ id: 'slab', type: 'code', params: { bevel: 0.1 }, code })
const scene = nodes => {
    const g = generate(nodes)
    return { g, types: computeUniformTypes(g.uniforms) }
}

{
    // A TYPO in a code node: the compiler names line N of the source it was given; the user is told slab:3
    const { g, types } = scene([sphere(), slab('// comment\nlet q = p;\nC = add_new(C, sdRoundedBox(q, VEC3(1.0), bevell), MATERIAL);')])
    const { gpu, made } = fakeGpu(code => code.includes('bevell')
        ? [{ type: 'error', message: "unresolved identifier 'bevell'", lineNum: lineOf(code, 'bevell'), linePos: 40 }] : [])
    const r = await quietly(() => validate(gpu, g.body, g.map, types))
    ok('the probe makes a module and NO pipeline', made.pipelines === 0 && made.modules.length === 1, `${made.pipelines} pipelines, ${made.modules.length} modules`)
    const src = made.modules[0].code
    ok('...from the source tinywebgpu assembles: the schema in front, the body, the probe entry point',
        src.includes(BODY_MARKER) && /@compute @workgroup_size\(1,1,1\)/.test(src) && /var<uniform>/.test(src)
        && src.indexOf('var<uniform>') < src.indexOf(BODY_MARKER) && r.wgsl.includes(BODY_MARKER), src.slice(0, 300))
    ok('an error is not ok, and lands on the node and the line the user wrote', !r.ok && r.messages[0]?.node === 'slab' && r.messages[0]?.line === 3,
        JSON.stringify(r.messages[0]))
    ok('...the offset measured: the schema lines in front of the body', r.offset > 0 && r.wgsl.split('\n')[r.offset] === BODY_MARKER, String(r.offset))
}
{
    // CLEAN, and clean with a warning: both ok, the warning kept
    const { g, types } = scene([sphere()])
    const quiet = fakeGpu(() => [])
    const r = await quietly(() => validate(quiet.gpu, g.body, g.map, types))
    ok('a scene the compiler accepts is ok, still with no pipeline', r.ok && r.messages.length === 0 && quiet.made.pipelines === 0, r.report)
    const warned = fakeGpu(code => [{ type: 'warning', message: 'unused variable', lineNum: lineOf(code, BODY_MARKER) + 2, linePos: 1 }])
    const w = await quietly(() => validate(warned.gpu, g.body, g.map, types))
    ok('a warning alone is ok, and reported', w.ok && w.messages.length === 1 && w.messages[0].type === 'warning', JSON.stringify(w.messages))
}
{
    // NO ANSWER (the device lost while it was asked): never ok
    const { g, types } = scene([sphere()])
    const lost = fakeGpu(() => { throw new Error('device lost') })
    const r = await quietly(() => validate(lost.gpu, g.body, g.map, types))
    ok('a compiler that gives no answer is not a clean one', r.ok === false && /no answer/.test(r.report), r.report)
}

console.log(`validate: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
