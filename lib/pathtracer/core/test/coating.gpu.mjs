//======================================================================================================================
// A COATING THROUGH THE SHADE KERNEL'S OWN BSDF, on a real WebGPU in node. Run:
//   node lib/pathtracer/core/test/coating.gpu.mjs
//
// What 0.39.0 put in the shader (core/materials.js coatMaterial, materials_pbr.js makeLobes, coatPick, coatFresnel,
// core/spectral.js coatEdgeRGB) compiled by Dawn (Tint, the browser's compiler) from the very text prog_shade compiles --
// the shade prelude, the BSDF, the processing -- with a main of its own: one surface a case, its lobes built as
// processMaterial_advanced builds them, sampled 200 000 times. What must come out:
//   - the coating's reflectance per channel, as the GPU computes it, is the JS mirror's (spectral.js edgeRGB), within
//     the f32 bound the Node test proves for its arithmetic -- here with Tint's own exp and log, and the weights as a
//     const array indexed in a loop, which naga accepted and only a Tint run can say Tint does;
//   - the mean weight a reflection carries is R per channel and a transmission's 1 - R (the material is white, clear):
//     the pick (reflectPick, coatPick) splits rays however it likes, the expectation must not move;
//   - a ray of one channel reflects off a coating with weight exactly 1 in that channel (coatPick: by what it carries),
//     never the up-to-1000 the largest-channel rule gave;
//   - where it is: an AR face leaving reflects nothing but total internal reflection; a bare one the glass's Fresnel;
//     every face the coating, its edge moved by the invariant n0 sin(theta0) inside; and an uncoated glass its Fresnel,
//     as before -- the control that the uncoated path did not move.
//   - on an opaque base (a plastic): the coating's mirror R, the white base under it 1 - R: nothing made or lost.
//
// No picture: what a coating looks like is the user's to judge (CLAUDE.md). OPTIONAL, AND LOUD ABOUT IT, as the other
// .gpu tests are: the `webgpu` package (npm i -g webgpu) and a Vulkan driver (lavapipe: apt-get install mesa-vulkan-drivers).
//======================================================================================================================
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(coating GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const { SHADE_PRELUDE } = await import('../scene_api.js')
const { MATERIALS_PBR } = await import('../materials_pbr.js')
const { FACE_TABLE, PROCESSING, LEARN_WORDS } = await import('../tracebasics.js')
const { counterstruct } = await import('../wavefront.js')
const { MF_WORDS } = await import('../microfacet.js')
const { ComputeUniformTypes } = await import('../uniforms.schema.js')
const { edgeRGB, edgeAt } = await import('../spectral.js')
const { fresnel } = await import('../../optics/fresnel.js')
const { WEBGPU } = await import('../../../tinywebgpu/src/tinywebgpu.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../../wgsl_shorthand.js')

Object.assign(globalThis, webgpu.globals)
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])            // kept: the Dawn instance must outlive the device (scenedata.gpu.mjs)
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
    WG.defines = defines(TOKENS, SHORT_TOKENS)
} catch (e) {
    console.log(`(coating GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const maxDiff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])))

const deg = d => d * Math.PI / 180
/* THE CASES: the material (coat, lo, hi, edge, width, nEff; transmission; specular), where the view is (inside the
   material or not, the angle, the index on its side and beyond), and what the ray carries */
const DICH = { lo: 0, hi: 1, edge: 600, width: 20, nEff: 1.8 }
const CASES = [
    { name: 'a 50/50 beam splitter, entering, 0 deg', coat: 1, lo: 0.5, hi: 0.5, a: 0 },
    { name: 'a dichroic (> 600 nm), entering, 0 deg', coat: 1, ...DICH, a: 0 },
    { name: 'the dichroic entering at 45 deg: its edge moved', coat: 1, ...DICH, a: 45 },
    { name: 'the dichroic, a red ray', coat: 1, ...DICH, a: 0, beta: [1, 0, 0] },
    { name: 'the dichroic, a blue ray (it passes blue)', coat: 1, ...DICH, a: 0, beta: [0, 0, 1] },
    /* WHERE THE LARGEST-CHANNEL RULE GOES WRONG: an edge at 500 nm reflects 95 % of red, so a pick by the largest channel
       reflects 95 % of every ray, and a passing blue ray weighs 1 / (1 - 0.95). Measured with that rule put back
       (lavapipe, 2026-10-08): 21.3 -- and four rows here missed their expected values at 200 000 picks. As red's R
       reaches 1 the pick's clamp (0.999) lets it reach 1000. Here it must pass with weight 1 */
    { name: 'a dichroic reflecting > 500 nm, a blue ray', coat: 1, ...DICH, edge: 500, a: 0, beta: [0, 0, 1], passOne: true },
    { name: 'a dichroic reflecting > 500 nm, white', coat: 1, ...DICH, edge: 500, a: 0 },
    { name: 'leaving by an AR face at 30 deg inside', coat: 1, ...DICH, a: 30, inside: true },
    { name: 'leaving by an AR face at 50 deg inside: total internal reflection', coat: 1, ...DICH, a: 50, inside: true },
    { name: 'leaving by a bare face at 20 deg inside', coat: 2, ...DICH, a: 20, inside: true },
    { name: 'leaving by a coated face at 20 deg inside: the edge moved by 1.5 sin 20', coat: 3, ...DICH, a: 20, inside: true },
    { name: 'uncoated glass, 0 deg (the control)', coat: 0, a: 0 },
    { name: 'a plastic under the dichroic, 30 deg', coat: 1, ...DICH, a: 30, opaque: true },
]
// what each must give: the coating's R per channel, as the JS mirror says
const expectR = c => {
    const n0 = c.inside ? 1.5 : 1, s = Math.sin(deg(c.a))
    if (c.inside && n0 * s >= 1) return [1, 1, 1]                                           // past the critical angle
    if (!c.coat) return Array(3).fill(fresnel(Math.cos(deg(c.a)), 1 / 1.5).unpolarised)
    if (c.inside && c.coat === 1) return [0, 0, 0]
    if (c.inside && c.coat === 2) return Array(3).fill(fresnel(Math.cos(deg(c.a)), 1.5).unpolarised)
    return edgeRGB(c.lo, c.hi, edgeAt(c.edge ?? 600, n0 * s, c.nEff ?? 1.8), c.width ?? 20)
}

const N = 200000
const P = 4                                  // vec4s of parameters a case
const params = new Float32Array(CASES.length * P * 4)
CASES.forEach((c, i) => {
    const o = i * P * 4
    params.set([c.coat ?? 0, c.lo ?? 0, c.hi ?? 0, c.edge ?? 600], o)
    params.set([c.width ?? 20, c.nEff ?? 1.8, c.opaque ? 0 : 1, c.inside ? 1 : 0], o + 4)
    params.set([Math.sin(deg(c.a)), 0, Math.cos(deg(c.a)), 0], o + 8)
    params.set([...(c.beta ?? [1, 1, 1]), 0], o + 12)
})
const OUT = 16                               // floats a case: reflected rgb, transmitted rgb, diffuse rgb, coatR rgb, the largest reflected weight
const prog = WG.makeCompute(`${SHADE_PRELUDE}${MATERIALS_PBR}${FACE_TABLE}${PROCESSING}`,
    /*wgsl*/`
    // every binding the text names reached from main, as tinywebgpu binds them (check-shaders pass two says why)
    if (gid.x == 0xffffffffu) {
        _ = &marchBuffer0; _ = &marchBuffer1; _ = &shadeBuffer; _ = &frame_u32; _ = &shadowBuffer0; _ = &shadowBuffer1;
        _ = &counters; _ = UB.res;
    }
    let ci = gid.x;
    if (ci >= ${CASES.length}u) { return; }
    let q0 = cases[ci * 4u]; let q1 = cases[ci * 4u + 1u]; let q2 = cases[ci * 4u + 2u]; let q3 = cases[ci * 4u + 3u];
    var m = makeDefaultMaterial();
    m.baseColor = VEC3(1.0);
    m.roughness = 0.0;
    m.metallic = 0.0;
    m.ior = 1.5;
    m.transmission = q1.z;
    m.specular = 0.5;
    m = coatMaterial(m, u32(q0.x + 0.5), q0.y, q0.z, q0.w, q1.x, q1.y);
    let inside = q1.w > 0.5;
    let n0 = select(1.0, 1.5, inside);
    let n1 = select(1.5, 1.0, inside);
    // as processMaterial_advanced builds them: the normal turned to the view's side, the medium on each
    let lb = coatPick(makeLobes(VEC3(0.0, 0.0, 1.0), q2.xyz, m, n0 / n1, n0, inside), q3.xyz);
    SEED_uvec4(vec4<u32>(17u, 29u, 31u, 37u));
    SEED_u32(ci);
    var refl = VEC3(0.0); var trans = VEC3(0.0); var diff = VEC3(0.0); var wmax = 0.0; var tmax = 0.0;
    let one = select(VEC3(1.0), q3.xyz, max3(q3.xyz) > 0.0);     // the channels the ray carries
    for (var k = 0u; k < ${N}u; k++) {
        let s = lobesSample(lb, PRNG());
        let w = s.w * q3.xyz;                              // what the ray carries, scaled
        if (s.transmitted) { trans += w; tmax = max(tmax, max3(s.w * one)); }
        else if (s.diffuse) { diff += w; }
        else { refl += w; wmax = max(wmax, max3(s.w * one)); }
    }
    let b = ci * ${OUT}u;
    let inv = 1.0 / f32(${N}u);
    out[b] = refl.x * inv; out[b + 1u] = refl.y * inv; out[b + 2u] = refl.z * inv;
    out[b + 3u] = trans.x * inv; out[b + 4u] = trans.y * inv; out[b + 5u] = trans.z * inv;
    out[b + 6u] = diff.x * inv; out[b + 7u] = diff.y * inv; out[b + 8u] = diff.z * inv;
    out[b + 9u] = lb.coatR.x; out[b + 10u] = lb.coatR.y; out[b + 11u] = lb.coatR.z;
    out[b + 12u] = wmax;
    out[b + 13u] = tmax;
    `,
    ComputeUniformTypes,
    { marchBuffer0: 'array<Ray>', marchBuffer1: 'array<Ray>', shadeBuffer: 'array<ShadeItem>', frame_u32: 'array<atomic<u32>>',
      shadowBuffer0: 'array<Ray>', shadowBuffer1: 'array<Ray>', learn: 'array<atomic<u32>>', counters: counterstruct,
      cases: 'array<vec4<f32>>', out: 'array<f32>' },
    { wg: [64, 1, 1], async: false })
const buf = n => WG.createStorageBuffer(Math.max(n, 256))
const out = buf(CASES.length * OUT * 4)
const cases = WG.createStorageBuffer(params)
prog.resources = { marchBuffer0: buf(112).b, marchBuffer1: buf(112).b, shadeBuffer: buf(288).b, frame_u32: buf(16).b,
    shadowBuffer0: buf(112).b, shadowBuffer1: buf(112).b, learn: buf(4 * (LEARN_WORDS + MF_WORDS)).b, counters: buf(64).b,
    cases: cases.b, out: out.b }
prog.uniforms = { res: [1, 1] }
prog.dispatch(1, 1, 1)
const got = await out.r(Float32Array)

/* the counting noise of N picks: a channel's mean of a two-valued weight has a standard error of at most
   max weight / (2 sqrt N); 0.005 is over 4 of them at the worst pick here (a white ray's ps of 1/3: weights up to 3) */
const TOL = 0.005
CASES.forEach((c, i) => {
    const g = got.slice(i * OUT, i * OUT + OUT), R = expectR(c), beta = c.beta ?? [1, 1, 1]
    const refl = [...g.slice(0, 3)], trans = [...g.slice(3, 6)], diff = [...g.slice(6, 9)], coatR = [...g.slice(9, 12)]
    if (c.coat && !(c.inside && c.coat !== 3)) ok(`${c.name}: the coating's R per channel is the JS mirror's within 1e-4`, maxDiff(coatR, R) < 1e-4,
        `GPU ${coatR.map(v => v.toFixed(5))} JS ${R.map(v => v.toFixed(5))}`)
    const wantR = R.map((r, k) => r * beta[k])
    ok(`${c.name}: reflected R per channel`, maxDiff(refl, wantR) < TOL, `GPU ${refl.map(v => v.toFixed(4))} want ${wantR.map(v => v.toFixed(4))}`)
    if (c.opaque) ok(`${c.name}: the white base under it 1 - R, and nothing passes`, maxDiff(diff, R.map((r, k) => (1 - r) * beta[k])) < TOL
        && maxDiff(trans, [0, 0, 0]) === 0, `diffuse ${diff.map(v => v.toFixed(4))} passed ${trans.map(v => v.toFixed(4))}`)
    else ok(`${c.name}: passed 1 - R per channel`, maxDiff(trans, R.map((r, k) => (1 - r) * beta[k])) < TOL,
        `GPU ${trans.map(v => v.toFixed(4))} want ${R.map((r, k) => ((1 - r) * beta[k]).toFixed(4))}`)
    // (where that channel reflects at all: the dichroic passes blue, so a blue ray's reflections are ~1e-9 of its picks)
    if (beta.filter(b => b > 0).length === 1 && R[beta.findIndex(b => b > 0)] > 0.01)
        ok(`${c.name}: a ray of one channel reflects with weight 1 in it, never more`, Math.abs(g[12] - 1) < 1e-5, `largest weight ${g[12]}`)
    if (c.passOne) ok(`${c.name}: passes with weight 1 in its channel (the largest-channel pick gave 21.3)`, Math.abs(g[13] - 1) < 1e-5, `largest weight ${g[13]}`)
})

console.log(`coating GPU: ${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
