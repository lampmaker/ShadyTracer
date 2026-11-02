//======================================================================================================================
// THE STRUCT SIZES THE HOST ALLOCATES BY, against what a real WGSL compiler lays out. Run:
//   node lib/pathtracer/core/test/structs.gpu.mjs
//
// The engine sizes its ray buffers and its shade queue by bytes per item (tracebasics.js RAY_BYTES, SHADE_ITEM_BYTES),
// and the optics module and the GPU tests read and write them by the same numbers. Nothing checked them against the
// structs: they were three copies of a comment saying "MUST match the WGSL structs in tracebasics.js", worked out by
// hand from WGSL's alignment rules each time a field came or went. A wrong one is a buffer too small (rays past its end
// silently dropped) or too large, or a test reading a hit from the middle of the one before it.
//
// HOW: Dawn (Tint, the browser's compiler) on whatever Vulkan driver there is -- in a container, lavapipe. Two buffers a
// struct, as the host counts: exactly ten items, and the same four bytes short; arrayLength() over each as the compiler
// counts them. Ten in the first says the compiler's item is no larger than the host's, nine in the second that it is no
// smaller (sizes are multiples of 4). One buffer alone could not tell: ten items of 256 bytes hold ten of 240 too, and
// the first version of this check passed the old 256 against the compiler's 240.
//
// OPTIONAL, AND LOUD ABOUT IT, as the builder's .gpu tests are: the `webgpu` package (npm i -g webgpu) and a Vulkan
// driver, or it says which is missing and exits 0.
//======================================================================================================================
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(struct sizes check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const { SHADE_PRELUDE } = await import('../scene_api.js')
const { computeUniformTypes, sceneConstantsWGSL } = await import('../uniforms.schema.js')
const { RAY_BYTES, SHADE_ITEM_BYTES } = await import('../tracebasics.js')
const { WEBGPU } = await import('../../../tinywebgpu/src/tinywebgpu.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../../wgsl_shorthand.js')

Object.assign(globalThis, webgpu.globals)
// kept in a global: the Dawn instance must outlive the device (builder/test/scenedata.gpu.mjs says why)
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
    WG.defines = defines(TOKENS, SHORT_TOKENS)
} catch (e) {
    console.log(`(struct sizes check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }

/* what the host says each struct takes: Ray and the shade queue's item as allocated, and the two the item is made of
   (a Hit, then a Surface whose first field is the Material2), so a failure says which one moved */
const N = 10
const SIZES = [['Ray', RAY_BYTES], ['ShadeItem', SHADE_ITEM_BYTES], ['Hit', 144], ['Material2', 112]]
// the shade kernel's own prelude: every struct, and no scene (scene_api.js SHADE_PRELUDE)
const prog = WG.makeCompute(`${SHADE_PRELUDE}${sceneConstantsWGSL({ wgsl: '' })}`,
    `_ = UB.res;
     if (gid.x == 0u) { ${SIZES.map(([s], i) => `out[${2 * i}] = arrayLength(&f${s}); out[${2 * i + 1}] = arrayLength(&s${s});`).join(' ')} }`,
    computeUniformTypes({}), { ...Object.fromEntries(SIZES.flatMap(([s]) => [[`f${s}`, `array<${s}>`], [`s${s}`, `array<${s}>`]])), out: 'array<u32>' },
    { wg: [1, 1, 1], async: false })
const full = SIZES.map(([, bytes]) => WG.createStorageBuffer(N * bytes)), short = SIZES.map(([, bytes]) => WG.createStorageBuffer(N * bytes - 4))
const out = WG.createStorageBuffer(8 * SIZES.length)
prog.resources = { ...Object.fromEntries(SIZES.flatMap(([s], i) => [[`f${s}`, full[i].b], [`s${s}`, short[i].b]])), out: out.b }
prog.uniforms = { res: [1, 1] }
prog.dispatch(1, 1, 1)
const got = await out.r(Uint32Array)
SIZES.forEach(([s, bytes], i) =>
    ok(`${s}: ${bytes} bytes an item, as the compiler lays it out`, got[2 * i] === N && got[2 * i + 1] === N - 1,
        `${N} items of ${bytes} bytes hold ${got[2 * i]} of the compiler's, four bytes fewer ${got[2 * i + 1]}${got[2 * i] ? '' : ' -- the probe did not run'}`))
/* (a Material2 of 112 since 0.next's haze, 96 since 0.39.0's coating, 80 before; and the
   medium beyond's absorption, a vec3 rounded to 16, since
   0.37.0 -- which this line did not follow: it read 240 against 256 from then, an optional check needing lavapipe;
   and the manifold connection's answer, a vec4<u32>, from 0.44.0 until 0.61.0 took it out) */
ok('the shade queue item is the Hit, then the Surface (a Material2, a vec3 and a scalar: 16 more, a vec3: 16)', SHADE_ITEM_BYTES === 144 + 112 + 16 + 16)

console.log(`struct sizes: ${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
