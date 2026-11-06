// node lib/pathtracer/core/test/images.gpu.mjs
//
// IMAGES ON SURFACES (core/images.js, 0.next) on Dawn: the WGSL lookup against its JS twin (images.test.mjs checks the
// twin against brute force). Two images packed into one atlas as the renderer packs them (packImages), every
// projection, wrap mode, filter and face setting, at points and normals drawn at random and at the edges -- each result
// the twin's within the rounding of f32. Also the texel read as withImages gives it to a kernel: the atlas where main
// reaches a material, a stub where it does not, both compiling and binding.
//
// No picture: how a picture looks on a surface is the user's to judge (CLAUDE.md). OPTIONAL, AND LOUD ABOUT IT: the
// `webgpu` package (npm i -g webgpu) and a Vulkan driver (lavapipe: apt-get install mesa-vulkan-drivers).
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(images GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const { IMAGES_WGSL, IMAGE_RESOURCE, IMAGE_TYPE, packImages, slotMatrix, SLOT_DEFAULTS, imageSampleJS, imageMappedJS, withImages, PROJECTIONS, WRAPS, FILTERS, FACES } = await import('../images.js')
const { WEBGPU } = await import('../../../tinywebgpu/src/tinywebgpu.js')

Object.assign(globalThis, webgpu.globals)
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
} catch (e) {
    console.log(`(images GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }

// ---- two images, every texel its own (a pseudo-random byte pattern), packed as the renderer packs them
const mkImage = (w, h, seed) => {
    const px = new Uint8Array(w * h * 4)
    let s = seed
    for (let i = 0; i < px.length; i++) { s = (s * 1103515245 + 12345) >>> 0; px[i] = s >>> 24 }
    for (let i = 3; i < px.length; i += 16) px[i] = 255            // some opaque, the rest whatever the pattern says
    return { width: w, height: h, pixels: px }
}
const images = { a: mkImage(7, 5, 3), b: mkImage(13, 9, 11) }
const atlas = packImages(Object.entries(images).map(([key, i]) => ({ key, width: i.width, height: i.height })))
const texels = new Uint8Array(atlas.width * atlas.height * 4)
for (const [key, i] of Object.entries(images)) {
    const r = atlas.rects.get(key)
    for (let y = 0; y < i.height; y++) texels.set(i.pixels.subarray(4 * y * i.width, 4 * (y + 1) * i.width), 4 * ((r.y + y) * atlas.width + r.x))
}
const tex = WG.createTexture(atlas.width, atlas.height, 'rgba8unorm')
WG.writeTexture(tex, texels, {}, [atlas.width, atlas.height], 4)

// ---- the cases: every setting, at random points and normals and at the edges
let seed = 7
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
const cases = []
const KEYS = Object.keys(images)
for (const projection of PROJECTIONS) for (const wrapU of WRAPS) for (const filter of FILTERS) for (const faces of FACES) for (const colour of [true, false]) {
    const key = KEYS[cases.length % 2]
    const slot = { ...SLOT_DEFAULTS, projection, wrapU, wrapV: WRAPS[(WRAPS.indexOf(wrapU) + 1) % 4], filter, faces, colour,
        size: { x: 5 + 20 * rnd(), y: 5 + 20 * rnd() }, offset: { x: 10 * rnd() - 5, y: 10 * rnd() - 5 }, turn: 360 * rnd(), sharpness: 1 + 6 * rnd() }
    const s = slotMatrix(slot, atlas.rects.get(key))
    for (let k = 0; k < 24; k++) {
        const q = [60 * rnd() - 30, 60 * rnd() - 30, 60 * rnd() - 30]
        let n = [2 * rnd() - 1, 2 * rnd() - 1, 2 * rnd() - 1]
        if (k < 6) n = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][k]
        const l = Math.hypot(...n); n = n.map(c => c / l)
        cases.push({ s, key, q, n })
    }
}
const N = cases.length
const slots = new Float32Array(N * 16), pts = new Float32Array(N * 8)
cases.forEach((c, i) => { slots.set(c.s, 16 * i); pts.set([...c.q, 0, ...c.n, 0], 8 * i) })

const body = `${IMAGES_WGSL}\nfn lookup(s: mat4x4<f32>, q: vec3<f32>, n: vec3<f32>) -> vec4<f32> { IMG_Q = q; IMG_N = n; return sample(s); }\n`
const main = /*wgsl*/`
    let i = gid.x;
    if (i >= ${N}u) { return; }
    let q = pts[2u * i].xyz; let n = pts[2u * i + 1u].xyz;
    outs[2u * i] = lookup(slots[i], q, n);
    outs[2u * i + 1u] = vec4<f32>(imageMapped(slots[i], q, n), 0.0);
`
const res = { slots: 'array<mat4x4<f32>>', pts: 'array<vec4<f32>>', outs: 'array<vec4<f32>>', [IMAGE_RESOURCE]: IMAGE_TYPE }
const scene = { resources: { [IMAGE_RESOURCE]: IMAGE_TYPE } }
const prog = WG.makeCompute(withImages(scene, body, main), main, {}, res, { wg: [64, 1, 1] })
const bSlots = WG.createStorageBuffer(slots.byteLength), bPts = WG.createStorageBuffer(pts.byteLength), bOut = WG.createStorageBuffer(N * 32)
bSlots.w(slots); bPts.w(pts)
prog.resources = { slots: bSlots.b, pts: bPts.b, outs: bOut.b, [IMAGE_RESOURCE]: tex }
prog.dispatch(Math.ceil(N / 64), 1, 1)
const got = await bOut.r(Float32Array)

// f32's rounding: positions to a few ulps of 30 mm over a 5 mm copy, a texel's weight the same over 255 levels
let worst = 0, worstMap = 0, at = '', shown = 0, onEdge = 0
cases.forEach((c, i) => {
    const want = imageSampleJS(c.s, images[c.key], c.q, c.n)
    const m = imageMappedJS(c.s, c.q, c.n)
    const g = got.subarray(8 * i, 8 * i + 4), gm = got.subarray(8 * i + 4, 8 * i + 7)
    // a point that is (nearly) on a texel's edge in nearest, or a wrap's boundary, can fall either side in f32: compared
    // only where the twin's own answer does not move by moving the point by f32's step
    const eps = 2e-6 * 30
    const nudged = imageSampleJS(c.s, images[c.key], c.q.map(x => x + eps), c.n)
    const stable = want.every((x, k) => Math.abs(x - nudged[k]) < 0.05)
    if (!stable) { onEdge++; return }
    const d = Math.max(...want.map((x, k) => Math.abs(x - g[k])))
    if (d > worst) { worst = d; at = `${PROJECTIONS[Math.round(c.s[10])]} flags ${c.s[11]}: ${[...g]} vs ${want}` }
    if (m[2] > 0.5 && Math.abs(m[0]) < 1e4) worstMap = Math.max(worstMap, Math.abs(m[0] - gm[0]), Math.abs(m[1] - gm[1]))
    if (want[3] > 0) shown++
})
ok(`the lookup: every case the twin's within 2e-3 (${N - onEdge} of ${N} compared, ${onEdge} on an edge f32 may fall either side of)`, worst < 2e-3, `worst ${worst} at ${at}`)
ok('the position on the picture: the twin\'s within 1e-3 of a copy', worstMap < 1e-3, worstMap)
ok(`the cases are not empty: ${shown} read something`, shown > N / 4)
ok('the cases compared are most of them', onEdge < N / 10, onEdge)

// ---- the stub: a kernel whose main reaches no material compiles and binds with the atlas bound and not declared
{
    const main2 = 'let i = gid.x; if (i >= 1u) { return; } outs[0] = vec4<f32>(f32(i));'
    const text = withImages(scene, body, main2)
    ok('a kernel that reaches no material is given the stub', !new RegExp(`\\b${IMAGE_RESOURCE}\\b`).test(text.replace(/\/\/.*/g, '')))
    const p2 = WG.makeCompute(text, main2, {}, res, { wg: [1, 1, 1] })
    let threw = null
    try { p2.resources = { slots: bSlots.b, pts: bPts.b, outs: bOut.b, [IMAGE_RESOURCE]: tex }; p2.dispatch(1, 1, 1); await bOut.r(Float32Array) } catch (e) { threw = e }
    ok('...and binds with the scene\'s atlas handed to it like every scene resource', !threw, threw?.message)
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
