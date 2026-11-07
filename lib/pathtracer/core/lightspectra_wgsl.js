//======================================================================================================================
// A LIGHT'S OWN SPECTRUM AT A PRISM, ON THE GPU (0.next): where lightspectra.js's tables sit in the learn buffer, and the
// WGSL that draws from them -- lightspectra.js says what and why. Apart from it because the place is past the microfacet
// tables (MF_WORDS), and microfacet.js holds a kernel: the tutorial's pages run lightspectra.js's draw and may reach no
// GPU code (tutorial/test/tutorial.test.mjs).
//======================================================================================================================
import { LEARN_WORDS } from './tracebasics.js'
import { MF_WORDS } from './microfacet.js'
import { LS_HEAD, LS_STRIDE, LS_CELLS, LS_LO, LS_MAX, LS_CAM } from './lightspectra.js'

/** The region's first word in the learn buffer: past learn's own words and the microfacet tables. */
export const LS_BASE = LEARN_WORDS + MF_WORDS

const fl = v => { const t = String(+v); return /[.e]/.test(t) ? t : t + '.0' }
/* THE WGSL, for the shade kernel's module (materials_pbr.js, beside SPECTRAL_WGSL): a photon's table, the draw, and
   what it makes of beta. Only for a kernel that binds learn. */
export const LIGHT_SPECTRA_WGSL = /*wgsl*/`
// ---- A LIGHT'S OWN SPECTRUM AT A PRISM (core/lightspectra.js) ----
const LS_BASE: u32 = ${LS_BASE}u;
const LS_HEAD: u32 = ${LS_HEAD}u;
const LS_STRIDE: u32 = ${LS_STRIDE}u;
const LS_CELLS: u32 = ${LS_CELLS}u;
const LS_LO: f32 = ${fl(LS_LO)};
const LS_MAX: u32 = ${LS_MAX}u;
const LS_CAM: u32 = ${LS_CAM}u;
fn lsF(k: u32) -> f32 { return bitcast<f32>(atomicLoad(&learn[LS_BASE + k])); }
// which table a photon carries, + 1: 0 for any other ray (pix a sun-map cell, 0xFFFFFFFF, a pixel or an optics ray)
fn lsOf(r: Ray) -> u32 {
    if ((r.tag & TAG_PHOTON) == 0u || r.pix < PIX_LS || r.pix == 0xFFFFFFFFu) { return 0u; }
    let k = r.pix & 0xFFFFu;
    return select(0u, k + 1u, k < min(atomicLoad(&learn[LS_BASE]), LS_MAX));
}
// THE DRAW from the table whose CDF is at o in the region (lightspectra.js lsDraw): the first cell whose CDF passes u,
// uniform in it; w its colour over q
fn lsDrawAt(o: u32, u: f32) -> SpecDraw {
    var lo = 0u;
    var hi = LS_CELLS - 1u;
    for (var it = 0u; it < 10u; it++) {
        if (lo >= hi) { break; }
        let m = (lo + hi) >> 1u;
        if (lsF(o + m) > u) { hi = m; } else { lo = m + 1u; }
    }
    let c0 = select(0.0, lsF(o + max(lo, 1u) - 1u), lo > 0u);
    let mass = lsF(o + lo) - c0;
    let t = select(0.5, clamp((u - c0) / mass, 0.0, 1.0), mass > 0.0);
    var d: SpecDraw;
    d.lambda = LS_LO + f32(lo) + t;
    let c = o + LS_CELLS + 3u * lo;
    d.w = vec3<f32>(lsF(c), lsF(c + 1u), lsF(c + 2u));
    return d;
}
// ...from a light's table s
fn lsDraw(s: u32, u: f32) -> SpecDraw { return lsDrawAt(LS_HEAD + s * LS_STRIDE + 4u, u); }
/* THE CHANNELS' OWN DRAW (CAMERA_TABLE, the header): every ray that carries no light's table -- a wavelength for u in
   [0, 1), and what it is to each channel (mean 1 in each over u, at most 3). spectral.js's 40 bins of 10 nm until 0.next. */
fn specDraw(u: f32) -> SpecDraw { return lsDrawAt(LS_CAM + 4u, u); }
// ...and a photon's beta after it: the cell's colour times what met it before, channel by channel (lightspectra.js lsBeta)
fn lsBeta(beta: VEC3, s: u32, col: VEC3) -> VEC3 {
    let o = LS_HEAD + s * LS_STRIDE;
    let h = vec3<f32>(lsF(o), lsF(o + 1u), lsF(o + 2u));
    let big = max(abs(h.x), max(abs(h.y), abs(h.z)));
    let L = vec3<f32>(${fl(0.2126)}, ${fl(0.7152)}, ${fl(0.0722)});
    let lum = dot(beta, L) / dot(h, L);
    let keep = abs(h) > vec3<f32>(1e-3 * big);
    return col * select(vec3<f32>(lum), beta / select(vec3<f32>(1.0), h, keep), keep);
}
`
