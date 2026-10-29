//======================================================================================================================
// THE SIDE BEYOND, IN JS (0.next; roadmap/DIFFUSERS.md): mirrors of the transmission lobes materials_pbr.js evaluates,
// so a Node test can hold their value, density and draw to each other without a GPU (test/transmission.test.mjs), and
// the WGSL to these on Dawn (test/transmission.gpu.mjs).
//
// WHY A MIRROR. A lobe that is sampled, evaluated and given a density in three places is right only if the three are one
// BSDF: light sampling divides by the density MIS reads, the photon's connection multiplies by the value the camera's
// draw has in expectation. Each mirror here is the WGSL's arithmetic line for line, in the lobe's local frame (z the
// normal turned to the view, the view o with o.z > 0), for the dielectric part of a material that is not metal, uncoated,
// untinted (a white base) -- what the transmission lobes are about. The rest of the layered model (the coat's albedo
// tables, the metal) stays the GPU tests' own.
//======================================================================================================================

export const ALPHA_MIN = 1e-3                  // microfacet.js: below it a lobe is a delta
export const LT_MIN_ALPHA = 0.05               // tracebasics.js: from it up a lobe is EV_EVAL

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l] }

// microfacet.js, line for line
export function mfLambdaJS(w, a) {
    const z2 = Math.max(w[2] * w[2], 1e-12)
    const t2 = (a[0] * a[0] * w[0] * w[0] + a[1] * a[1] * w[1] * w[1]) / z2
    return 0.5 * (-1 + Math.sqrt(1 + t2))
}
export const mfG1JS = (w, a) => 1 / (1 + mfLambdaJS(w, a))
export const mfG2JS = (o, i, a) => 1 / (1 + mfLambdaJS(o, a) + mfLambdaJS(i, a))
export function mfDJS(h, a) {
    if (h[2] <= 0) return 0
    const t = (h[0] * h[0]) / (a[0] * a[0]) + (h[1] * h[1]) / (a[1] * a[1]) + h[2] * h[2]
    return 1 / (Math.PI * a[0] * a[1] * t * t)
}
export function mfSampleVNDFJS(o, a, u) {
    const os = norm([o[0] * a[0], o[1] * a[1], o[2]])
    const phi = 2 * Math.PI * u[0]
    const z = (1 - u[1]) * (1 + os[2]) - os[2]
    const sinT = Math.sqrt(Math.min(1, Math.max(0, 1 - z * z)))
    const hs = [sinT * Math.cos(phi) + os[0], sinT * Math.sin(phi) + os[1], z + os[2]]
    return norm([hs[0] * a[0], hs[1] * a[1], Math.max(hs[2], 1e-7)])
}
export function fresnelDielectricJS(cosIn, eta) {
    const cosI = Math.min(1, Math.max(0, cosIn))
    const sin2T = eta * eta * (1 - cosI * cosI)
    if (sin2T >= 1) return 1
    const cosT = Math.sqrt(1 - sin2T)
    const rs = (eta * cosI - cosT) / (eta * cosI + cosT), rp = (cosI - eta * cosT) / (cosI + eta * cosT)
    return 0.5 * (rs * rs + rp * rp)
}
// WGSL's refract(e1, e2, eta): the zero vector under total internal reflection
export function refractJS(e1, e2, eta) {
    const d = dot(e2, e1), k = 1 - eta * eta * (1 - d * d)
    if (k < 0) return [0, 0, 0]
    const c = eta * d + Math.sqrt(k)
    return [eta * e1[0] - c * e2[0], eta * e1[1] - c * e2[1], eta * e1[2] - c * e2[2]]
}

/* THE LOBES' SHARED STATE (makeLobes) for a white, uncoated, non-metal material: the view o (local), roughness r (alpha
   r^2, isotropic), transmission, specular, eta = n incident / n beyond (etaT the refraction's own: n(lambda)'s). */
export function lobesJS({ o, r, trans = 1, specular = 0.5, eta, etaT = eta, through = true }) {
    const a = Math.max(r * r, ALPHA_MIN)
    const lb = { o: [o[0], o[1], Math.max(o[2], 1e-4)], r, a: [a, a], aMin: r * r, isDelta: r * r < ALPHA_MIN, trans,
                 coatK: (2 * specular) + (1 - 2 * specular) * trans, eta, etaT, through }
    const fo = Math.min(lb.coatK * fresnelDielectricJS(lb.o[2], eta), 1)
    lb.ps = Math.min(fo, fresnelDielectricJS(lb.o[2], eta) >= 1 ? 1 : 0.999)
    return lb
}
const coatFresnelJS = (lb, c) => Math.min(lb.coatK * fresnelDielectricJS(c, lb.eta), 1)
export function interfaceReflectPJS(lb, oh) {
    const fh = coatFresnelJS(lb, oh), den = fh + (1 - fh) * lb.trans
    return den > 1e-6 ? fh / den : 1
}
// the refraction's generalised half vector (throughHalf), or null
export function throughHalfJS(lb, i) {
    let h = [-(lb.etaT * lb.o[0] + i[0]), -(lb.etaT * lb.o[1] + i[1]), -(lb.etaT * lb.o[2] + i[2])]
    const hl = Math.hypot(...h)
    if (hl < 1e-12) return null
    h = h.map(v => v / hl)
    if (h[2] < 0) h = h.map(v => -v)
    if (dot(lb.o, h) <= 0 || dot(i, h) >= 0) return null
    return h
}
/* ROUGH REFRACTION'S VALUE for a direction i below the surface (lobesThroughEval): the sampler's weight times its
   density, over |i.z| -- the derivation is materials_pbr.js THE SIDE BEYOND's */
export function roughThroughEvalJS(lb, i, minAlpha = 0) {
    if (lb.trans <= 0 || lb.isDelta || lb.aMin < minAlpha) return 0
    const h = throughHalfJS(lb, i)
    if (!h) return 0
    const oh = dot(lb.o, h), ih = dot(i, h), den = lb.etaT * oh + ih
    const fc = coatFresnelJS(lb, oh)
    return lb.trans * (1 - fc) * mfDJS(h, lb.a) * mfG2JS(lb.o, i, lb.a) * oh * (-ih) / (lb.o[2] * (-i[2]) * Math.max(den * den, 1e-20))
}
export function roughThroughPdfJS(lb, i) {
    if (lb.trans <= 0 || lb.isDelta) return 0
    const h = throughHalfJS(lb, i)
    if (!h) return 0
    const oh = dot(lb.o, h), ih = dot(i, h), den = lb.etaT * oh + ih
    const pd = (1 - lb.ps) * (1 - lb.trans)
    return (1 - pd) * (1 - interfaceReflectPJS(lb, oh)) * mfG1JS(lb.o, lb.a) * mfDJS(h, lb.a) * oh / lb.o[2] * (-ih) / Math.max(den * den, 1e-20)
}
/* THE DRAW (lobesSample's dielectric half, rnd four uniforms): which lobe, the direction, its weight. 'base' carries no
   weight here (the albedo tables are the GPU's); 'reflect' and 'refract' as the WGSL weighs them. */
export function sampleJS(lb, rnd) {
    const pd = (1 - lb.ps) * (1 - lb.trans)
    const pick = rnd[0]
    if (pick >= 1 - pd) return { kind: 'base', dir: null, w: 0 }
    const sub = pick / Math.max(1 - pd, 1e-6)
    const h = mfSampleVNDFJS(lb.o, lb.a, [rnd[1], rnd[2]])
    const oh = dot(lb.o, h), fc = coatFresnelJS(lb, oh), r = interfaceReflectPJS(lb, oh)
    if (sub < r) {
        const i = [2 * oh * h[0] - lb.o[0], 2 * oh * h[1] - lb.o[1], 2 * oh * h[2] - lb.o[2]]
        const w = i[2] > 0 ? fc * mfG2JS(lb.o, i, lb.a) / mfG1JS(lb.o, lb.a) / ((1 - pd) * r) : 0
        return { kind: 'reflect', dir: i, w, ev: lb.aMin >= LT_MIN_ALPHA ? 'eval' : 'other' }
    }
    const i = refractJS([-lb.o[0], -lb.o[1], -lb.o[2]], h, lb.etaT)
    const w = i[2] < 0 ? lb.trans * (1 - fc) * mfG2JS(lb.o, i, lb.a) / mfG1JS(lb.o, lb.a) / ((1 - pd) * (1 - r)) : 0
    return { kind: 'refract', dir: i, w, ev: lb.aMin >= LT_MIN_ALPHA ? 'eval' : 'other' }
}

/*----------------------------------------------------------------------------------------------------------------------
  THE TRANSLUCENT BASE (B1): of the diffuse base, a share t passes through, Lambertian on the far side. For a white base
  under no coat (specular 0: Ec = 0, ps = 0) its value below is t / pi and its draw a cosine below, weighing 1.
----------------------------------------------------------------------------------------------------------------------*/
export const diffThroughEvalJS = (t, i) => (i[2] < 0 ? t / Math.PI : 0)
export const diffThroughPdfJS = (t, i) => (i[2] < 0 ? t * -i[2] / Math.PI : 0)
/** A SHEET OF TWO SUCH FACES walked through (no absorption, nothing else in the way): each face passes t and reflects
 *  1 - t back the way the ray came. What leaves by the far face, over n light rays -- the closed form t / (2 - t). */
export function sheetWalkJS(t, n, rnd) {
    let through = 0
    for (let k = 0; k < n; k++) {
        let face = 0, inside = false                       // at the near face, from outside
        for (;;) {
            const pass = rnd() < t
            if (!inside) { if (!pass) break; inside = true; face = 1; continue }      // reflected back out, or in
            if (pass) { if (face === 1) through++; break }                           // out by the far face, or back out the near
            face = 1 - face                                                          // back across to the other face
        }
    }
    return through / n
}

/*----------------------------------------------------------------------------------------------------------------------
  THE DIFFUSER FILM (B2): a lobe about the straight-through direction t = -o, no net deviation, as a thin film has.
  Slopes s = (sx, sy) drawn from a 2-D Gaussian of deviations sigma (along b1, the grain projected across t, and b2 =
  t x b1), the direction normalize(t + sx b1 + sy b2): its density over solid angle p_s(s) (1 + |s|^2)^{3/2}, since
  dw = cos^3 theta d^2 s. A direction that lands above the surface is folded back below it (mirrored in the surface's
  plane), and the value sums both preimages -- nothing lost at grazing views.
----------------------------------------------------------------------------------------------------------------------*/
/** THE FWHM IN DEGREES (of the intensity a ray head-on spreads into, along one axis) TO THE SLOPES' SIGMA, exactly at
 *  normal incidence: half the peak where exp(-tau^2 / (2 sigma^2)) (1 + tau^2)^{3/2} = 1/2, tau = tan(FWHM / 2). */
export function filmSigmaJS(fwhmDeg) {
    const f = Math.min(Math.max(+fwhmDeg || 0, 0), 170)
    if (!(f > 0)) return 0
    const tau = Math.tan(f * Math.PI / 360)
    return tau / Math.sqrt(2 * (Math.LN2 + 1.5 * Math.log(1 + tau * tau)))
}


const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
/** The film's frame about t (unit): b1 the grain x = (1,0,0) of the local frame made perpendicular to t, b2 = t x b1. */
export function filmFrameJS(t) {
    let b1 = [1 - t[0] * t[0], -t[0] * t[1], -t[0] * t[2]]
    if (Math.hypot(...b1) < 1e-6) b1 = [-t[1] * t[0], 1 - t[1] * t[1], -t[1] * t[2]]
    b1 = norm(b1)
    return [b1, cross(t, b1)]
}
/** The density over solid angle of a direction d about t, unfolded. */
export function filmPdfRawJS(t, sig, d) {
    const c = dot(d, t)
    if (c <= 1e-6) return 0
    const [b1, b2] = filmFrameJS(t)
    const sx = dot(d, b1) / c, sy = dot(d, b2) / c
    const ps = Math.exp(-0.5 * (sx * sx / (sig[0] * sig[0]) + sy * sy / (sig[1] * sig[1]))) / (2 * Math.PI * sig[0] * sig[1])
    return ps / (c * c * c)
}
/** ...folded into the lower hemisphere (z < 0): both preimages. */
export function filmPdfJS(t, sig, i) {
    if (i[2] >= 0) return 0
    return filmPdfRawJS(t, sig, i) + filmPdfRawJS(t, sig, [i[0], i[1], -i[2]])
}
export function filmSampleJS(t, sig, u) {
    const r = Math.sqrt(-2 * Math.log(Math.max(1 - u[0], 1e-12))), ph = 2 * Math.PI * u[1]
    const [b1, b2] = filmFrameJS(t)
    const sx = sig[0] * r * Math.cos(ph), sy = sig[1] * r * Math.sin(ph)
    let d = norm([t[0] + sx * b1[0] + sy * b2[0], t[1] + sx * b1[1] + sy * b2[1], t[2] + sx * b1[2] + sy * b2[2]])
    if (d[2] > 0) d = [d[0], d[1], -d[2]]
    return d
}

/** THE FILM AS THE LOBES CARRY IT (lobesThroughEval, lobesThroughPdf, lobesSample's film branch) for a white, uncoated,
 *  all-transmitting film (wd 1, trans 1): (1 - F) of the view, F taken from the thinner side (eta <= 1), spread by the
 *  folded density; drawn where a smooth interface refracts, (1 - ps) of the time. o local, i local below. */
export function filmEvalJS(o, sig, eta, i) {
    const e = Math.min(eta, 1 / eta), F = fresnelDielectricJS(o[2], e)
    return (1 - F) * filmPdfJS([-o[0], -o[1], -o[2]], sig, i) / Math.max(-i[2], 1e-6)
}
export function filmLobePdfJS(o, sig, eta, i) {
    const e = Math.min(eta, 1 / eta), ps = Math.min(fresnelDielectricJS(o[2], e), 0.999)
    return (1 - ps) * filmPdfJS([-o[0], -o[1], -o[2]], sig, i)
}
/** A SHEET OF TWO FILM FACES, head-on: a ray through the first face about straight down, then the second about the way it
 *  now goes (the film keeps no deviation, so nothing else turns it); the FWHM of the intensity that leaves, along x and
 *  along y, each read in a thin slab of directions about its plane. faceX, faceY the faces' spreads in degrees; n rays
 *  from u, a list of 4 n uniforms (common numbers, so a search over the spreads is smooth). */
export function filmSheetJS(faceX, faceY, u) {
    const sig = [filmSigmaJS(faceX), filmSigmaJS(faceY)], n = Math.floor(u.length / 4)
    const fw = axis => {
        const other = axis === 0 ? faceY : faceX, B = 900, h = new Float64Array(B)
        for (let k = 0; k < n; k++) {
            const d = filmSampleJS(filmSampleJS([0, 0, -1], sig, [u[4 * k], u[4 * k + 1]]), sig, [u[4 * k + 2], u[4 * k + 3]])
            const along = axis === 0 ? d[0] : d[1], across = axis === 0 ? d[1] : d[0]
            const a = Math.atan2(Math.abs(along), -d[2]) * 180 / Math.PI, b = Math.atan2(Math.abs(across), -d[2]) * 180 / Math.PI
            if (b > Math.max(0.05, other / 8)) continue
            h[Math.min(B - 1, Math.floor(a * 10))]++
        }
        let peak = 0; for (let i = 0; i < 3; i++) peak += h[i] / 3
        let k = 0; while (k < B - 1 && h[k] > peak / 2) k++
        if (k === 0) return 0
        const f = (h[k - 1] - peak / 2) / Math.max(h[k - 1] - h[k], 1e-12)
        return 2 * (k - 1 + 0.5 + f) / 10
    }
    return [fw(0), fw(1)]
}
