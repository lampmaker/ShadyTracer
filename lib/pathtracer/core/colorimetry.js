//======================================================================================================================
// COLORIMETRY -- chromaticity, the Planckian locus, CCT and Duv, and the renderer's RGB.
//
// WHY THIS EXISTS. A light used to be a Rec.709 RGB hue and a luminance. That is fine for a picture
// and wrong for LED work, where a light is specified the way a datasheet gives it: a chromaticity
// (CIE xy, or a CCT and a Duv) and a flux. Additive mixing is EXACT in XYZ -- no spectrum needed --
// so a light given by xy or CCT is carried exactly as long as the optics are neutral, which clear
// PMMA, white reflectors and aluminium are.
//
// THE RENDERER'S CHANNELS STAY Rec.709 linear RGB (photometry.js LUMA is its Y row). A saturated LED
// -- a royal blue, a 525 nm green -- lies outside that gamut, and its exact RGB has a negative
// channel. That is allowed on a ray: every material multiplies channels by numbers >= 0, which is
// linear, so the XYZ a detector computes back from the channels is still exact for neutral optics.
// Only a DISPLAY has to clip, and does (gamutClip, luminance kept).
//
// THE PLANCKIAN LOCUS is Krystek's rational approximation (1985) in CIE 1960 uv, valid 1000-15000 K,
// within about 3e-4 of the true locus in xy -- the formulas of the user's own colour tool (an older
// luminaire project), checked here against the CIE's Planckian values. DUV is the signed distance from
// the locus in CIE 1960 uv, positive above it (towards green), as ANSI C78.377 defines it. (The old
// tool offset in u'v', where v' = 1.5 v, so its "0.02" was not a Duv of 0.02.)
//
// Pure functions, no GPU: core/test/colorimetry.test.mjs.
//======================================================================================================================
import { LUMA } from './photometry.js'

/** Linear Rec.709 / sRGB (D65) to CIE XYZ, rows X, Y, Z: IEC 61966-2-1's four-decimal matrix, whose Y
 *  row is exactly LUMA -- so the luminance everything else weighs by is this matrix's Y. */
export const RGB709_TO_XYZ = [
    [0.4124, 0.3576, 0.1805],
    LUMA.slice(),
    [0.0193, 0.1192, 0.9505],
]
const inv3 = m => {
    const [[a, b, c], [d, e, f], [g, h, i]] = m
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
    const det = a * A + b * B + c * C
    return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
            [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
            [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]]
}
export const XYZ_TO_RGB709 = inv3(RGB709_TO_XYZ)
const mul = (m, v) => m.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2])

export const rgbToXYZ = rgb => mul(RGB709_TO_XYZ, rgb)
export const XYZtoRGB = xyz => mul(XYZ_TO_RGB709, xyz)

/** xy and a luminance Y to XYZ. */
export const xyToXYZ = (x, y, Y = 1) => y > 0 ? [x / y * Y, Y, (1 - x - y) / y * Y] : [0, 0, 0]
/** XYZ to xy; null for no light. */
export const XYZtoxy = ([X, Y, Z]) => { const s = X + Y + Z; return s > 0 ? [X / s, Y / s] : null }
/** xy to CIE 1960 uv (what CCT and Duv are defined in). */
export const xyToUv = (x, y) => { const d = -2 * x + 12 * y + 3; return [4 * x / d, 6 * y / d] }
/** CIE 1960 uv to xy. */
export const uvToXy = (u, v) => { const d = 2 * u - 8 * v + 4; return [3 * u / d, 2 * v / d] }
/** xy to CIE 1976 u'v' (what colour differences are given in: v' = 1.5 v). */
export const xyToUpVp = (x, y) => { const [u, v] = xyToUv(x, y); return [u, 1.5 * v] }

export const CCT_MIN = 1000, CCT_MAX = 15000
/** The Planckian locus at T kelvin, CIE 1960 uv (Krystek 1985). */
export function planckUv(T) {
    const t = Math.min(CCT_MAX, Math.max(CCT_MIN, T))
    const u = (0.860117757 + 1.54118254e-4 * t + 1.28641212e-7 * t * t) / (1 + 8.42420234e-4 * t + 7.08145163e-7 * t * t)
    const v = (0.317398726 + 4.22806245e-5 * t + 4.20481691e-8 * t * t) / (1 - 2.89741816e-5 * t + 1.61456053e-7 * t * t)
    return [u, v]
}
export const planckXy = T => uvToXy(...planckUv(T))

/** The unit normal to the locus at T in uv, pointing ABOVE it (positive Duv: towards green). */
function locusNormal(T) {
    const h = Math.max(1e-3, T * 1e-5)
    const [u0, v0] = planckUv(T - h), [u1, v1] = planckUv(T + h)
    const du = u1 - u0, dv = v1 - v0, l = Math.hypot(du, dv) || 1
    // T up moves the locus down and left in uv (both du, dv < 0), so (dv, -du) points up and left
    return [dv / l, -du / l]
}

/** A CCT and a Duv to xy. */
export function cctDuvToXy(T, duv = 0) {
    const [u, v] = planckUv(T), [nu, nv] = locusNormal(T)
    return uvToXy(u + duv * nu, v + duv * nv)
}

/** xy to { cct, duv }: the nearest point of the locus in CIE 1960 uv, found by a scan in mired (where
 *  the locus is spaced evenly enough) and a golden-section refinement. `inRange` is false when the
 *  nearest point is at an end of 1000-15000 K, i.e. the colour is past it. Duv is the signed distance. */
export function xyToCctDuv(x, y) {
    const [u, v] = xyToUv(x, y)
    const d2 = T => { const [a, b] = planckUv(T); return (a - u) ** 2 + (b - v) ** 2 }
    const M0 = 1e6 / CCT_MAX, M1 = 1e6 / CCT_MIN, N = 200
    let best = 0, bd = Infinity
    for (let i = 0; i <= N; i++) { const d = d2(1e6 / (M0 + (M1 - M0) * i / N)); if (d < bd) { bd = d; best = i } }
    let lo = M0 + (M1 - M0) * Math.max(0, best - 1) / N, hi = M0 + (M1 - M0) * Math.min(N, best + 1) / N
    const g = (Math.sqrt(5) - 1) / 2
    for (let k = 0; k < 80; k++) {
        const a = hi - g * (hi - lo), b = lo + g * (hi - lo)
        if (d2(1e6 / a) < d2(1e6 / b)) hi = b; else lo = a
    }
    const T = 1e6 / ((lo + hi) / 2)
    const [pu, pv] = planckUv(T), [nu, nv] = locusNormal(T)
    const duv = (u - pu) * nu + (v - pv) * nv
    return { cct: T, duv, inRange: T > CCT_MIN * 1.001 && T < CCT_MAX * 0.999 }
}

/** The linear Rec.709 RGB of chromaticity xy at luminance 1 (Y = 1): EXACT, so a channel is negative
 *  for a colour outside the gamut. */
export const rgbFromXy = (x, y) => XYZtoRGB(xyToXYZ(x, y, 1))

/** For a display: an RGB with a negative channel desaturated towards the grey of its own luminance
 *  until that channel is 0 -- luminance kept, hue kept as far as the gamut allows. In gamut: unchanged. */
export function gamutClip(rgb) {
    const lo = Math.min(rgb[0], rgb[1], rgb[2])
    if (lo >= 0) return rgb.slice()
    const Y = LUMA[0] * rgb[0] + LUMA[1] * rgb[1] + LUMA[2] * rgb[2]
    if (!(Y > 0)) return [0, 0, 0]
    const t = Y / (Y - lo)
    return rgb.map(c => Math.max(0, Y + (c - Y) * t))
}

/** THREE LIGHTS MIXED TO A COLOUR: the fluxes (lm) of three lights of chromaticities `primaries`
 *  ([[x, y], ...]) whose sum has chromaticity `target` ([x, y]) and luminous flux `total`. Exact:
 *  additive mixing is linear in XYZ, so it is one 3 x 3 solve -- the matrix of the user's colour tool
 *  (an older luminaire project), which drove an RGB fixture's channels the same way. `reachable` is
 *  false when a flux would have to be negative: the target lies outside the triangle the three span. */
export function mixToTarget(primaries, target, total = 1) {
    const cols = primaries.map(([x, y]) => xyToXYZ(x, y, 1))            // XYZ per lumen of each
    const M = [0, 1, 2].map(r => cols.map(c => c[r]))
    const t = xyToXYZ(target[0], target[1], total)
    const flux = mul(inv3(M), t)
    return { flux, reachable: flux.every(f => f >= -1e-9) }
}

/** WGSL, for a kernel that deposits into an RGB picture: the same clip. */
export const GAMUT_CLIP_WGSL = /*wgsl*/`
fn gamutClip(c: vec3<f32>) -> vec3<f32> {
    let lo = min(c.x, min(c.y, c.z));
    if (lo >= 0.0) { return c; }
    let Y = dot(c, vec3<f32>(${LUMA.join(', ')}));
    if (Y <= 0.0) { return vec3<f32>(0.0); }
    return max(vec3<f32>(Y) + (c - vec3<f32>(Y)) * (Y / (Y - lo)), vec3<f32>(0.0));
}
`
