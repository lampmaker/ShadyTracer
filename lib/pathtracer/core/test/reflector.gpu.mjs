// node lib/pathtracer/core/test/reflector.gpu.mjs
//
// THE PARABOLIC REFLECTORS' WGSL on Dawn (core/shapes.js, 0.84.0): Nparaboloid, Nparabolic and NfacetedReflector run in
// a compute kernel against their JS twins (shapes.test.mjs holds the twins to brute force: the faceted mesh, the
// paraboloid's cross-section). Every mode -- faceted solid and with a wall, halving, a ridge where minWidth is past a
// ring's width (0.next: the heightfield's bound, solid and walled), an odd count, round (facets 0),
// troughs (rings 0), both 0, counts past their clamps -- at points drawn round each, distance and normal the twin's
// within f32's rounding. And with the focus off the axis (0.next: NparabolicOffset, NfacetedReflectorOffset), out and
// across, smooth, faceted, round and in troughs -- the heightfield where a band falls -- and offset 0 the old calls'. The loop's bound goes through noUnroll as the renderer's (tracebasics.js); here a zero read
// from a buffer stands in for UB.opaqueZero.
//
// No picture: what the facets look like is the user's to judge (CLAUDE.md). OPTIONAL, AND LOUD ABOUT IT: the `webgpu`
// package (npm i -g webgpu) and a Vulkan driver (lavapipe: apt-get install mesa-vulkan-drivers).
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(reflector GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const S = await import('../shapes.js')
const { WEBGPU } = await import('../../../tinywebgpu/src/tinywebgpu.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../../wgsl_shorthand.js')

Object.assign(globalThis, webgpu.globals)
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
    WG.defines = defines(TOKENS, SHORT_TOKENS)
} catch (e) {
    console.log(`(reflector GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
let seed = 11
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }

// [f, aperture, wall, solid, facets, rings, minWidth, offset] -- which function: 0 faceted, 1 parabolic, 2 paraboloid,
// 3 faceted with its focus off the axis, 4 parabolic so ([f, aperture, wall, solid, offset])
const SETS = [
    [0, 0.125, 0.5, 0.01, 1, 24, 6, 0.06], [0, 0.125, 0.5, 0.01, 0, 24, 6, 0.06],      // the preset, solid and walled
    [0, 0.25, 1, 0.05, 1, 48, 8, 0.12], [0, 0.1, 0.6, 0.02, 0, 7, 4, 0.5],             // minWidth past a ring, convex; odd
    [0, 0.25, 1, 0.05, 1, 48, 8, 0.3], [0, 0.125, 0.5, 0.01, 0, 24, 16, 0.1],          // a ridge (0.next): solid, walled
    [0, 0.2, 0.6, 0.02, 1, 6, 0, 0], [0, 0.2, 0.6, 0.02, 0, 6, 0, 0],                  // troughs
    [0, 0.3, 1, 0.02, 1, 0, 5, 0], [0, 0.3, 1, 0.02, 0, 0, 5, 0],                      // round
    [0, 0.125, 0.5, 0.02, 1, 0, 0, 0], [0, 0.125, 0.5, 0.02, 0, 0, 0, 0],              // neither: the smooth reflector
    [0, 0.2, 1, 0.02, 1, 5000, 200, 0.001], [0, -1, 0, -1, 0.7, 12.5, 3.5, -1],        // past the clamps; nonsense
    [1, 0.125, 0.5, 0.01, 1], [1, 0.125, 0.5, 0.01, 0], [2, 0.25, 0.8],
    [3, 0.125, 0.5, 0.01, 1, 24, 6, 0.06, 0.1], [3, 0.125, 0.5, 0.01, 0, 24, 6, 0.06, -0.1],   // out (a heightfield), across
    [3, 0.25, 1, 0.05, 0, 48, 8, 0.3, 0.4], [3, 0.3, 1, 0.02, 1, 0, 5, 0, 0.3],                // a ridge and falling; round
    [3, 0.2, 0.6, 0.02, 0, 6, 0, 0, 0.2], [3, 0.2, 0.6, 0.02, 1, 7, 0, 0, -0.2],               // troughs out, across
    [3, 0.125, 0.5, 0.02, 0, 0, 0, 0, 0.15], [3, 0.125, 0.5, 0.01, 1, 24, 6, 0.06, 0],         // smooth; offset 0
    [4, 0.125, 0.5, 0.01, 0, 0.15], [4, 0.125, 0.5, 0.01, 1, -0.15], [4, 0.1, 0.6, 0.05, 0, 0.6],
]
const NAMES = ['NfacetedReflector', 'Nparabolic', 'Nparaboloid', 'NfacetedReflectorOffset', 'NparabolicOffset']
const twin = (s, p) => S[NAMES[s[0]]](p, ...s.slice(1))
const pts = [], cases = []
for (const [si, s] of SETS.entries()) {
    const A = Math.max(s[2], 0.1), f = Math.max(s[1], 0.05), h = A * A / (4 * f)
    for (let i = 0; i < 400; i++) {
        pts.push((rnd() * 2 - 1) * 1.3 * A, (rnd() * 2 - 1) * 1.3 * A, -f - 0.2 * h + rnd() * 1.4 * h, si)
        cases.push(si)
    }
}
const N = cases.length
const params = new Float32Array(SETS.length * 12)
SETS.forEach((s, i) => params.set(s.concat(Array(12 - s.length).fill(0)), 12 * i))

/* what SHAPES calls from sdf.js, cut out of sdf.js's own text (so never a copy that drifts): each function by its
   braces. PRIMITIVES whole would need the renderer's uniforms. */
const { PRIMITIVES } = await import('../sdf.js')
const fnText = name => {
    const at = PRIMITIVES.search(new RegExp(`fn ${name}\\s*\\(`))
    if (at < 0) throw new Error(`no fn ${name} in sdf.js`)
    let i = PRIMITIVES.indexOf('{', at), depth = 0
    for (; i < PRIMITIVES.length; i++) { if (PRIMITIVES[i] === '{') depth++; else if (PRIMITIVES[i] === '}' && --depth === 0) break }
    return PRIMITIVES.slice(at, i + 1)
}
const prelude = ['safeDir', 'Ntorus'].map(fnText).join('\n') + `
fn noUnroll(n: u32) -> u32 { return n + zero[0]; }
`
const main = /* wgsl */`
    let i = gid.x;
    if (i >= ${N}u) { return; }
    let q = pts[i];
    let si = u32(q.w);
    let a = prm[3u * si]; let b = prm[3u * si + 1u]; let c = prm[3u * si + 2u];
    var r: VEC4;
    if (a.x < 0.5) { r = NfacetedReflector(q.xyz, a.y, a.z, a.w, b.x, b.y, b.z, b.w); }
    else if (a.x < 1.5) { r = Nparabolic(q.xyz, a.y, a.z, a.w, b.x); }
    else if (a.x < 2.5) { r = Nparaboloid(q.xyz, a.y, a.z); }
    else if (a.x < 3.5) { r = NfacetedReflectorOffset(q.xyz, a.y, a.z, a.w, b.x, b.y, b.z, b.w, c.x); }
    else { r = NparabolicOffset(q.xyz, a.y, a.z, a.w, b.x, b.y); }
    outs[i] = r;
`
// SHAPES carries every shape; only the reflectors are called, and the compiler drops the rest
const res = { prm: 'array<vec4<f32>>', pts: 'array<vec4<f32>>', outs: 'array<vec4<f32>>', zero: 'array<u32>' }
let prog = null, threw = null
try { prog = WG.makeCompute(prelude + S.SHAPES, main, {}, res, { wg: [64, 1, 1] }) } catch (e) { threw = e }
ok('the reflectors\' WGSL compiles on Dawn (Tint), the loop through noUnroll', prog && !threw, threw?.message)
if (prog) {
    const bP = WG.createStorageBuffer(params.byteLength), bX = WG.createStorageBuffer(N * 16), bO = WG.createStorageBuffer(N * 16), bZ = WG.createStorageBuffer(16)
    bP.w(params); bX.w(new Float32Array(pts)); bZ.w(new Uint32Array(4))
    prog.resources = { prm: bP.b, pts: bX.b, outs: bO.b, zero: bZ.b }
    prog.dispatch(Math.ceil(N / 64), 1, 1)
    const got = await bO.r(Float32Array)
    const worst = SETS.map(() => ({ d: 0, n: 0, compared: 0 }))
    for (let i = 0; i < N; i++) {
        const s = SETS[cases[i]], p = pts.slice(4 * i, 4 * i + 3).map(Math.fround)
        const want = twin(s, p)
        const g = got.subarray(4 * i, 4 * i + 4), w = worst[cases[i]]
        w.d = Math.max(w.d, Math.abs(g[3] - want[3]))
        // a normal compared away from its seams: where moving the point by f32's step does not change the twin's
        const e = 1e-5, near = [[e, 0, 0], [0, e, 0], [0, 0, e], [-e, 0, 0], [0, -e, 0], [0, 0, -e]].every(o => {
            const q = p.map((x, k) => x + o[k])
            const v = twin(s, q)
            return Math.hypot(v[0] - want[0], v[1] - want[1], v[2] - want[2]) < 1e-3     // a curved face turns ~4e-5 over e
        })
        if (near) { w.n = Math.max(w.n, Math.hypot(g[0] - want[0], g[1] - want[1], g[2] - want[2])); w.compared++ }
    }
    SETS.forEach((s, i) => {
        const tag = `${NAMES[s[0]]}(${s.slice(1).join(', ')})`, w = worst[i]
        ok(`${tag}: the distance the twin's within f32 (1e-5)`, w.d < 1e-5, `off by ${w.d}`)
        ok(`...its normal the twin's (${w.compared} of 400 off a seam)`, w.n < 1e-4 && w.compared > 200, `off by ${w.n}`)
    })
}
console.log(`reflector GPU: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
