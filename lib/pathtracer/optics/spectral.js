//======================================================================================================================
// THE SPECTRAL OPTICS TRACE (0.next; roadmap/LIGHT_MODEL.md S0 + S2) -- the Optics page's rays at three wavelengths each,
// instead of as a colour, for a scene with its `spectral` feature on (builder/model.js setFeatures). The picture stays RGB.
//
// WHY THREE, IN beta. A Ray is 112 bytes with nothing to spare (tracebasics.js struct Ray), and every kernel shares it:
// a fourth wavelength would have grown the renderer's rays too. beta already has three channels, and everything the
// material code does to it is channel by channel -- a colour multiplied, a coating's reflectance, an absorption's
// exponential -- so the three channels can just as well be three WAVELENGTHS: the user's choice (2026-11-04). Their noise,
// computed exactly before any of this was built (core/test/spectralnoise.test.mjs, "hero 3"): 1 200-2 700 rays for the
// wavelength draw to leave 0.001 u'v', against 20 000-90 000 for one wavelength a ray.
//
// THE WAVELENGTHS. A ray carries u in [0, 1) in its tag's wavelength code (bits 17-31, spectral.js lambdaCode's place:
// code = 1 + u 32766); its three wavelengths are where u, u + 1/3 and u + 2/3 (mod 1) fall in the CDF of p(lambda) =
// x-bar + y-bar + z-bar (the CIE 1931 table, 360-830 nm) -- stratified in what the eye sees, pbrt-v4's draw. Bit 16 (the
// picture's TAG_LENS_X too, never on one of these rays: tracebasics.js BIT 16) says a ray has COLLAPSED to its first wavelength: what dispersion does at the first dispersive glass,
// since the refracted direction depends on the wavelength (beta becomes 3 beta.x, 0, 0; pbrt-v4's terminating of the
// secondary wavelengths).
//
// WHAT A SOURCE GIVES A RAY: beta_k = S(lambda_k) / (3 p(lambda_k)), S the source's spectrum normalised to luminance 1 --
// so sum_k beta_k y-bar(lambda_k) is 1 on average, a ray's weight as the colour trace has it (optWeight), and every flux
// figure means what it meant. A light given by its spectrum (builder/lights.js colourBy 'spectrum') gives its own; a
// blackbody CCT its Planck curve; any other colour (RGB, xy, a CCT off the locus, a ray file's) a STAND-IN of exactly its
// XYZ, made of the three basis spectra below -- its colour is exact, its spectrum invented, and the Spectrum chart says so.
//
// WHAT A MATERIAL IS AT A WAVELENGTH. Materials are RGB. Each colour is turned into reflectance at a ray's three
// wavelengths at the one place the engine asks the scene for a material (scene_api.js materialAt), as
// R(lambda) = sum_c rgb_c B_c(lambda): B_r, B_g, B_b the Rec.709 colour-matching functions of the CIE's table, clipped at
// 0 and divided by their sum -- a partition of unity, so a grey or white material is spectrally flat and so exact, and a
// coloured one a plausible smooth spectrum (an approximation, as the colour trace's three channels are). Everything after
// is channel by channel and so wavelength by wavelength: Fresnel, the BSDF's lobes, absorption (materials.js mediumMu of
// the converted colour). A COATING is evaluated at each wavelength, exactly (the colour trace averages it per channel:
// 6-10 % off in Y on an LED through an edge filter, PLAN.md C 4).
//
// THE TEXT. The spectral kernels' WGSL is the colour trace's with a few lines changed, each at an anchor that must be
// there exactly once (specialise below throws otherwise: a refactor of the text the anchors are in fails loudly, never
// quietly). The renderer's text is never touched -- these are new strings for the optics kernels alone.
// Pure JS here: the tables, their JS mirrors (core/test and optics/test hold the WGSL to them), and the WGSL.
//======================================================================================================================
import { CIE_LO, CIE_N, CIE_X, CIE_Y, CIE_Z } from '../core/cie1931.js'
import { XYZ_TO_RGB709, RGB709_TO_XYZ, XYZtoRGB } from '../core/colorimetry.js'
import { LAMBDA_STEPS, LAMBDA_SHIFT } from '../core/spectral.js'
import { spdAt, C2 } from '../core/spd.js'

/** The grid every spectral table is on: CIE_N nodes, 1 nm apart, from CIE_LO (360-830 nm). */
export const SP_N = CIE_N, SP_LO = CIE_LO
/** Offsets in the optSpectral buffer, in floats: the CDF, the CMFs (x, y, z), the basis (r, g, b), then the sources'
 *  spectra, SP_N floats each. */
export const SP_CDF = 0, SP_CMF = SP_N, SP_BASIS = 4 * SP_N, SP_SRC = 7 * SP_N
/** The tag bit of a ray collapsed to its first wavelength: bit 16, which the picture's kernels use as TAG_LENS_X (a
 *  faceless light's photon that crossed the lens, 0.next) -- never on the same ray: tracebasics.js BIT 16 says why. */
export const TAG_SPEC_ONE = 1 << 16

/* p(lambda) = x + y + z at the nodes, its cells (node i to i + 1) each carrying the mean of its two ends, and the CDF over
   them: lambda is uniform within a cell, so p is constant in it -- the density the draw has (spLambda) */
const P_NODE = Float64Array.from({ length: SP_N }, (_, i) => CIE_X[i] + CIE_Y[i] + CIE_Z[i])
export const SP_CDF_TABLE = (() => {
    const c = new Float64Array(SP_N)
    for (let i = 1; i < SP_N; i++) c[i] = c[i - 1] + 0.5 * (P_NODE[i - 1] + P_NODE[i])
    for (let i = 1; i < SP_N; i++) c[i] /= c[SP_N - 1]
    c[SP_N - 1] = 1
    return c
})()
/** THE DRAW, in JS: u in [0, 1] to { lambda, pdf } (pdf per nm), as the WGSL spLambda. */
export function spLambda(u) {
    const c = SP_CDF_TABLE
    let lo = 0, hi = SP_N - 1
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= u) lo = m; else hi = m }
    const mass = c[hi] - c[lo]
    const t = mass > 0 ? Math.min(1, Math.max(0, (u - c[lo]) / mass)) : 0.5
    return { lambda: SP_LO + lo + t, pdf: mass }
}
/** The three wavelengths of a ray's u: u, u + 1/3, u + 2/3 (mod 1) through the draw. */
export const spLambdas = u => [0, 1, 2].map(k => spLambda((u + k / 3) % 1))
/** u as the tag holds it (LAMBDA_STEPS steps: spectral.js lambdaCode's place), and back. */
export const uCode = u => 1 + Math.round(Math.min(Math.max(u, 0), 1) * LAMBDA_STEPS)
export const uOf = code => (Math.max(code, 1) - 1) / LAMBDA_STEPS
/** A ray's three wavelengths from the bits its tag carries (a detector hit keeps them: kernels.js optRecordHit). */
export function lambdasOfTag(tag) {
    const one = (tag & TAG_SPEC_ONE) !== 0
    const ls = spLambdas(uOf(tag >>> LAMBDA_SHIFT)).map(q => q.lambda)
    return { lambdas: ls, one }
}

/* THE BASIS a material's RGB becomes a spectrum by: the Rec.709 colour-matching functions (the CIE's table through
   colorimetry.js's matrix), each clipped at 0, divided by their sum -- 1/3 each where all three are 0 */
export const SP_BASIS_TABLE = (() => {
    const B = [new Float64Array(SP_N), new Float64Array(SP_N), new Float64Array(SP_N)]
    for (let i = 0; i < SP_N; i++) {
        const rgb = XYZtoRGB([CIE_X[i], CIE_Y[i], CIE_Z[i]]).map(v => Math.max(0, v))
        const s = rgb[0] + rgb[1] + rgb[2]
        for (let c = 0; c < 3; c++) B[c][i] = s > 0 ? rgb[c] / s : 1 / 3
    }
    return B
})()
const at = (A, off, l) => { const f = l - SP_LO, i = Math.min(Math.max(Math.floor(f), 0), SP_N - 2), t = Math.min(Math.max(f - i, 0), 1); return A[off + i] + t * (A[off + i + 1] - A[off + i]) }
/** A material's RGB at a wavelength, as the WGSL specOfRGB: sum_c rgb_c B_c(lambda). */
export const reflectanceAt = (rgb, l) => [0, 1, 2].reduce((a, c) => a + rgb[c] * at(SP_BASIS_TABLE[c], 0, l), 0)

/* THE EXACT INTEGRAL of the product of two functions linear between the nodes, over the grid: per cell
   (a0 b0 + a1 b1) / 3 + (a0 b1 + a1 b0) / 6 -- what the trace's estimate averages to, for a spectrum and a CMF at the
   nodes (the WGSL interpolates both linearly), so a source normalised by it has luminance 1 exactly, on average */
function integralLin(a, b) {
    let s = 0
    for (let i = 0; i + 1 < SP_N; i++) s += (a[i] * b[i] + a[i + 1] * b[i + 1]) / 3 + (a[i] * b[i + 1] + a[i + 1] * b[i]) / 6
    return s
}
const CMF_NODES = [CIE_X, CIE_Y, CIE_Z]
/** A spectrum's XYZ as the trace sees it: its values at the nodes, linear between, against the table. */
export const nodesXYZ = s => CMF_NODES.map(c => integralLin(s, c))
/** A stand-in spectrum of exactly the XYZ of a Rec.709 colour (the colour trace's, a negative channel allowed): a sum of
 *  the three basis spectra, its weights solved from the 3 x 3 their XYZ make. */
const BASIS_XYZ = SP_BASIS_TABLE.map(b => nodesXYZ(b))             // [basis c] -> XYZ
const inv3 = m => {
    const [[a, b, c], [d, e, f], [g, h, i]] = m
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C
    return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, -(a * f - c * d) / det], [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]]
}
const M_BASIS = inv3([0, 1, 2].map(r => [0, 1, 2].map(c => BASIS_XYZ[c][r])))   // XYZ = M w, so w = M^-1 XYZ
export function standInOf(rgb) {
    const xyz = RGB709_TO_XYZ.map(r => r[0] * rgb[0] + r[1] * rgb[1] + r[2] * rgb[2])
    const w = M_BASIS.map(r => r[0] * xyz[0] + r[1] * xyz[1] + r[2] * xyz[2])
    return Float64Array.from({ length: SP_N }, (_, i) => w[0] * SP_BASIS_TABLE[0][i] + w[1] * SP_BASIS_TABLE[1][i] + w[2] * SP_BASIS_TABLE[2][i])
}
/** A light's spectrum at the nodes, normalised to luminance 1, and whether it is its own (not a stand-in): from its
 *  description (builder/sources.js: `spectrum` when it is given by one, `planck` T for a CCT on the locus, else `colour`). */
export function sourceSpectrum(desc) {
    let s, own = true
    if (desc?.spectrum) s = Float64Array.from({ length: SP_N }, (_, i) => spdAt(desc.spectrum, SP_LO + i))
    else if (desc?.planck > 0) s = Float64Array.from({ length: SP_N }, (_, i) => { const m = (SP_LO + i) * 1e-9; return 1e-30 / (m ** 5 * Math.expm1(C2 / (m * desc.planck))) })
    else { s = standInOf(desc?.colour ?? [1, 1, 1]); own = false }
    const Y = integralLin(s, CIE_Y)
    if (!(Y > 0)) { s = standInOf([1, 1, 1]); own = false }
    const k = 1 / integralLin(s, CIE_Y)
    return { values: s.map(v => v * k), own }
}
/** THE BUFFER the spectral kernels read (optSpectral): CDF, CMFs, basis, then each spectrum. */
export function spectralBuffer(spectra = []) {
    const out = new Float32Array(SP_SRC + Math.max(1, spectra.length) * SP_N)
    out.set(SP_CDF_TABLE, SP_CDF)
    CMF_NODES.forEach((c, k) => out.set(c, SP_CMF + k * SP_N))
    SP_BASIS_TABLE.forEach((b, k) => out.set(b, SP_BASIS + k * SP_N))
    spectra.forEach((s, k) => out.set(s, SP_SRC + k * SP_N))
    return out
}

/*---- THE WGSL ------------------------------------------------------------------------------------------------------*/
const f = v => { const t = String(+v); return /[.e]/.test(t) ? t : t + '.0' }
/** What both spectral kernels add: the tables' reads, the draw, a ray's wavelengths and its XYZ. */
export const SPECTRAL_CORE_WGSL = /*wgsl*/`
// ---- THE SPECTRAL OPTICS TRACE (optics/spectral.js says why and how) ----
const SP_N: u32 = ${SP_N}u;
const SP_LO: f32 = ${f(SP_LO)};
const SP_CDF: u32 = ${SP_CDF}u;
const SP_CMF: u32 = ${SP_CMF}u;
const SP_BASIS: u32 = ${SP_BASIS}u;
const SP_SRC: u32 = ${SP_SRC}u;
const TAG_SPEC_ONE: u32 = ${TAG_SPEC_ONE}u;
const SP_STEPS: f32 = ${f(LAMBDA_STEPS)};
// a table at lambda, linear between its 1 nm nodes (optics/spectral.js at)
fn spNode(off: u32, l: f32) -> f32 {
    let x = l - SP_LO;
    let i = u32(clamp(floor(x), 0.0, f32(SP_N - 2u)));
    let t = clamp(x - f32(i), 0.0, 1.0);
    return mix(optSpectral[off + i], optSpectral[off + i + 1u], t);
}
fn spCmf(l: f32) -> vec3<f32> { return vec3<f32>(spNode(SP_CMF, l), spNode(SP_CMF + SP_N, l), spNode(SP_CMF + 2u * SP_N, l)); }
fn spBasis(l: f32) -> vec3<f32> { return vec3<f32>(spNode(SP_BASIS, l), spNode(SP_BASIS + SP_N, l), spNode(SP_BASIS + 2u * SP_N, l)); }
// THE DRAW: u to (lambda, pdf per nm) through the CDF of x + y + z (optics/spectral.js spLambda)
fn spLambda(u: f32) -> vec2<f32> {
    var lo = 0u;
    var hi = SP_N - 1u;
    for (var it = 0u; it < 10u; it++) {
        if (hi - lo <= 1u) { break; }
        let m = (lo + hi) >> 1u;
        if (optSpectral[SP_CDF + m] <= u) { lo = m; } else { hi = m; }
    }
    let c0 = optSpectral[SP_CDF + lo];
    let mass = optSpectral[SP_CDF + hi] - c0;
    let t = select(0.5, clamp((u - c0) / mass, 0.0, 1.0), mass > 0.0);
    return vec2<f32>(SP_LO + f32(lo) + t, mass);
}
fn specU(r: Ray) -> f32 { return f32(max(r.tag >> ${LAMBDA_SHIFT}u, 1u) - 1u) / SP_STEPS; }
// a ray's three wavelengths: u, u + 1/3, u + 2/3 (mod 1) through the draw
fn specLams(r: Ray) -> vec3<f32> {
    let u = specU(r);
    return vec3<f32>(spLambda(u).x, spLambda(fract(u + 1.0 / 3.0)).x, spLambda(fract(u + 2.0 / 3.0)).x);
}
fn specOne(r: Ray) -> bool { return (r.tag & TAG_SPEC_ONE) != 0u; }
// what a ray carries, as XYZ: each wavelength's weight times the CMFs there
fn specXYZ(r: Ray, c: vec3<f32>) -> vec3<f32> {
    let l = specLams(r);
    return c.x * spCmf(l.x) + c.y * spCmf(l.y) + c.z * spCmf(l.z);
}
`
/** ...and the shade's: a material at a ray's wavelengths, and the redefinitions of the colour trace's coating and
 *  dispersion functions the anchors below renamed out of the way. */
export const SPECTRAL_MATERIAL_WGSL = /*wgsl*/`
// an RGB colour as reflectance at three wavelengths (sum_c rgb_c B_c(lambda): optics/spectral.js reflectanceAt)
fn specOfRGB(c: vec3<f32>, l: vec3<f32>) -> vec3<f32> { return vec3<f32>(dot(c, spBasis(l.x)), dot(c, spBasis(l.y)), dot(c, spBasis(l.z))); }
/* THE WAVELENGTHS THE MATERIAL CODE WORKS AT: the ray's whose material was asked last (materialAt), which is the ray it
   shades -- the coating and the dispersion below read them */
var<private> SPEC_LAM: vec3<f32>;
fn specMaterial(m_in: Material2, r: Ray) -> Material2 {
    var m = m_in;
    SPEC_LAM = specLams(r);
    m.baseColor = specOfRGB(m.baseColor, SPEC_LAM);
    m.emissive = specOfRGB(m.emissive, SPEC_LAM);
    return m;
}
/* A COATING AT EACH WAVELENGTH, exactly: R(lambda) the logistic edge itself (spectral.js), not its average per channel */
fn coatEdgeRGB(lo: f32, hi: f32, edge: f32, w: f32) -> vec3<f32> {
    let s = max(w, SPEC_WIDTH_MIN) / SPEC_W1090;
    return vec3<f32>(lo) + (hi - lo) / (vec3<f32>(1.0) + exp(-(SPEC_LAM - vec3<f32>(edge)) / s));
}
/* DISPERSION: a ray has a wavelength of its own (rayLambda > 0) once it has collapsed to its first one; collapsing is
   the draw (specDraw: the first wavelength, its weight 3 and the others' 0), and the tag says so (withLambda) */
fn rayLambda(r: Ray) -> f32 { return select(0.0, specLams(r).x, specOne(r)); }
fn specDraw(u: f32) -> SpecDraw {
    var d: SpecDraw;
    d.lambda = SPEC_LAM.x;
    d.w = vec3<f32>(3.0, 0.0, 0.0);
    return d;
}
fn lambdaCoded(lambda: f32) -> f32 { return lambda; }
fn withLambda(r_in: Ray, lambda: f32) -> Ray { var r = r_in; r.tag = r.tag | TAG_SPEC_ONE; return r; }
`
/* ...and the optics' own weights, by wavelength: a ray's luminance is sum_k c_k y-bar(lambda_k), its hue the XYZ of its
   three through the Rec.709 matrix */
const OPT_SPECTRAL_LAYOUT = /*wgsl*/`
fn optWeight(r: Ray) -> f32 { return specXYZ(r, r.beta * r.radiance).y; }
fn optHue(r: Ray) -> VEC3 {
    let xyz = specXYZ(r, r.beta * r.radiance);
    let M = mat3x3<f32>(${[0, 1, 2].map(c => XYZ_TO_RGB709.map(r => f(r[c])).join(', ')).join(', ')});
    return select(VEC3(1.0), (M * xyz) / xyz.y, xyz.y > 0.0);
}
/* A DETECTOR HIT BY WAVELENGTH: the colour trace's ten words, X and Z by the CMFs at its wavelengths, then its three
   wavelengths' weights and the bits of its tag that say what they are (kernels.js DET_WORDS) */
fn optRecordHitSpec(p: VEC3, w: f32, d: VEC3, tag: u32, r: Ray) {
    let k = atomicAdd(&optData[O_DETN], 1u);
    if (k >= UB.optDetCap) { return; }
    let b = O_PATHS + UB.optPathRays + UB.optPathRays * UB.optPathVerts * VERT_WORDS + k * DET_WORDS;
    let c = r.beta * r.radiance;
    let xyz = specXYZ(r, c);
    atomicStore(&optData[b + 0u], bitcast<u32>(p.x));
    atomicStore(&optData[b + 1u], bitcast<u32>(p.y));
    atomicStore(&optData[b + 2u], bitcast<u32>(p.z));
    atomicStore(&optData[b + 3u], bitcast<u32>(w));
    atomicStore(&optData[b + 4u], bitcast<u32>(d.x));
    atomicStore(&optData[b + 5u], bitcast<u32>(d.y));
    atomicStore(&optData[b + 6u], bitcast<u32>(d.z));
    atomicStore(&optData[b + 7u], tag);
    atomicStore(&optData[b + 8u], bitcast<u32>(xyz.x));
    atomicStore(&optData[b + 9u], bitcast<u32>(xyz.z));
    atomicStore(&optData[b + 10u], bitcast<u32>(c.x));
    atomicStore(&optData[b + 11u], bitcast<u32>(c.y));
    atomicStore(&optData[b + 12u], bitcast<u32>(c.z));
    atomicStore(&optData[b + 13u], r.tag & (TAG_LAMBDA_MASK | TAG_SPEC_ONE));
}
`
/* A SOURCE'S RAY BY WAVELENGTH (the generator's alone: the picture's photons stay RGB): u drawn and kept in the tag, and
   beta its spectrum at the three over three times their density -- times what the colour trace's beta carried beyond its
   hue (a ray set's own weight: the hue has luminance 1) */
const OPT_SPECTRAL_GEN = /*wgsl*/`
var<private> OPT_SRC: u32;
fn specStart(r_in: Ray) -> Ray {
    var r = r_in;
    let code = 1u + u32(round(PRNG().x * SP_STEPS));
    r.tag = (r.tag & ~TAG_LAMBDA_MASK) | (code << ${LAMBDA_SHIFT}u);
    let u = specU(r);
    let off = SP_SRC + u32(optSources[OPT_SRC * SRC_VEC4 + 5u].w + 0.5) * SP_N;
    var w = vec3<f32>(0.0);
    for (var k = 0u; k < 3u; k++) {
        let q = spLambda(fract(u + f32(k) / 3.0));
        w[k] = select(0.0, spNode(off, q.x) / (3.0 * q.y), q.y > 0.0);
    }
    r.beta = w * dot(r.beta, VEC3(${RGB709_TO_XYZ[1].map(f).join(', ')}));
    return r;
}
`

/** Each anchor replaced exactly once, or a throw naming it: the spectral text follows the colour trace's or fails. */
export function specialise(text, edits, what) {
    let out = text
    for (const [from, to] of edits) {
        const n = out.split(from).length - 1
        if (n !== 1) throw new Error(`the spectral ${what}: '${from.slice(0, 60)}' is in its text ${n} times, not once`)
        out = out.replace(from, () => to)
    }
    return out
}
/* the colour trace's definitions the spectral text redefines (SPECTRAL_OPT_WGSL), renamed out of the way */
const RENAMES = [
    ['fn coatEdgeRGB(lo: f32, hi: f32, edge: f32, w: f32) -> vec3<f32> {', 'fn coatEdgeRGB_rgb(lo: f32, hi: f32, edge: f32, w: f32) -> vec3<f32> {'],
    ['fn rayLambda(r: Ray) -> f32 {', 'fn rayLambda_rgb(r: Ray) -> f32 {'],
    ['fn specDraw(u: f32) -> SpecDraw {', 'fn specDraw_rgb(u: f32) -> SpecDraw {'],
    ['fn lambdaCoded(lambda: f32) -> f32 {', 'fn lambdaCoded_rgb(lambda: f32) -> f32 {'],
    ['fn withLambda(r_in: Ray, lambda: f32) -> Ray {', 'fn withLambda_rgb(r_in: Ray, lambda: f32) -> Ray {'],
]
/** THE SHADE'S MODULE TEXT, spectral: the material at the ray's wavelengths where the scene is asked for one, the
 *  colour trace's coating, dispersion and weights replaced, and a detector hit recorded by wavelength. */
export function spectralShade(moduleText, mainText) {
    const module = specialise(moduleText, [
        ...RENAMES,
        ['m.scatterDistance = m.scatterDistance * engPerScene();', 'm.scatterDistance = m.scatterDistance * engPerScene();\n            m = specMaterial(m, h.r);    // at the ray\'s wavelengths (optics/spectral.js)'],
        ['fn optWeight(r: Ray) -> f32 {', 'fn optWeight_rgb(r: Ray) -> f32 {'],
        ['fn optHue(r: Ray) -> VEC3 {', 'fn optHue_rgb(r: Ray) -> VEC3 {'],
    ], 'shade') + SPECTRAL_CORE_WGSL + SPECTRAL_MATERIAL_WGSL + OPT_SPECTRAL_LAYOUT
    const main = specialise(mainText, [
        ['optRecordHit(hit.r.pos, wIn, hit.r.dir, tag, hit.r.beta * hit.r.radiance);', 'optRecordHitSpec(hit.r.pos, wIn, hit.r.dir, tag, hit.r);'],
    ], 'shade\'s main')
    return { module, main }
}
/** THE GENERATOR'S, spectral: the source's index kept, the wavelengths drawn as the ray is tagged. */
export function spectralGen(moduleText, mainText) {
    const module = specialise(moduleText, [
        ['let b = k * SRC_VEC4;', 'let b = k * SRC_VEC4;\n    OPT_SRC = k;'],
        ['fn optWeight(r: Ray) -> f32 {', 'fn optWeight_rgb(r: Ray) -> f32 {'],
        ['fn optHue(r: Ray) -> VEC3 {', 'fn optHue_rgb(r: Ray) -> VEC3 {'],
    ], 'generator') + SPECTRAL_CORE_WGSL + OPT_SPECTRAL_LAYOUT + OPT_SPECTRAL_GEN
    const main = specialise(mainText, [
        ['ray.pix = id;                         // which ray it is, for its path', 'ray.pix = id;                         // which ray it is, for its path\n        ray = specStart(ray);                 // its three wavelengths (optics/spectral.js)'],
    ], 'generator\'s main')
    return { module, main }
}
