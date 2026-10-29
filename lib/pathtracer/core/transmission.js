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
export function lobesJS({ o, r, trans = 1, specular = 0.5, eta, etaT = eta, through = true, anisotropy = 0 }) {
    /* the two alphas as makeLobes takes them without a grain (microfacet.js mfAnisoAlpha): x the rough axis, their
       geometric mean r^2, their ratio 1 / (1 - 0.9 |anisotropy|) -- at most 10 */
    const s = Math.sqrt(1 - 0.9 * Math.min(1, Math.abs(anisotropy))), ax = r * r / s, ay = r * r * s
    const lb = { o: [o[0], o[1], Math.max(o[2], 1e-4)], r, a: [Math.min(Math.max(ax, ALPHA_MIN), 1), Math.min(Math.max(ay, ALPHA_MIN), 1)],
                 aMin: Math.min(ax, ay), isDelta: r * r < ALPHA_MIN, trans,
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
  A DIFFUSER FILM AS ROUGH GLASS (the user, 2026-10-29: "remove the film, I'll do it with roughness ... keep the
  properties of materials as realistic / physical as possible"). A thin sheet, both faces rough, walked through by the
  rough interface's own draw (sampleJS): a ray head-on onto the top face from air, refracted in, reflected inside as often
  as the faces send it back, until it leaves -- by the far face (kept, weighed by what it carries) or back out of the
  near one. The sheet is thin and its faces parallel, so where a ray crosses does not matter, only its direction.
  roughSheetJS gives the FWHM in degrees of the intensity that leaves the far face (per steradian, about straight down),
  for a roughness r and an index n, over `rays` rays of its own random numbers from `seed` (one seed for every r: a
  search over r then walks a smooth function). Round only: a face's frame here is its normal's mirror, which keeps x
  on both faces, as an anisotropic lobe without a grain does not promise.
----------------------------------------------------------------------------------------------------------------------*/
export function roughSheetJS(r, n, { rays = 1000000, seed = 1, specular = 0.5 } = {}) {
    let a = seed >>> 0                                      // mulberry32
    const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
    const B = 900, h = new Float64Array(B)
    for (let ray = 0; ray < rays; ray++) {
        let d = [0, 0, -1], w = 1, inside = false
        for (let bounce = 0; bounce < 64 && w > 0; bounce++) {
            /* the face met, and its normal turned to the ray: from outside only the top (+z); from inside the bottom
               (turned +z, into the glass) going down or the top (turned -z) going up */
            const nz = inside ? (d[2] < 0 ? 1 : -1) : 1
            const loc = v => [v[0], v[1], v[2] * nz]
            const lb = lobesJS({ o: loc([-d[0], -d[1], -d[2]]), r, trans: 1, specular, eta: inside ? n : 1 / n })
            const smp = sampleJS(lb, [rnd(), rnd(), rnd(), rnd()])
            if (!(smp.w > 0) || !smp.dir) break
            w *= smp.w
            const dw = loc(smp.dir)
            if (smp.kind === 'refract') {
                if (!inside) { inside = true; d = dw; continue }
                if (dw[2] < 0) {                             // out by the far face: kept
                    const t = Math.acos(Math.min(1, -dw[2])) * 180 / Math.PI
                    h[Math.min(B - 1, Math.floor(t * 10))] += w
                }
                break                                       // ...or back out of the near one
            }
            if (!inside) break                              // reflected off the top: back where it came from
            d = dw                                          // reflected inside: on to the other face
        }
    }
    // per steradian: a ring of 0.1 degree at theta holds 2 pi (cos theta - cos theta') of it; the peak over the first 0.3
    const I = Array.from(h, (c, i) => c / (Math.cos(i / 10 * Math.PI / 180) - Math.cos((i + 1) / 10 * Math.PI / 180)))
    const peak = (I[0] + I[1] + I[2]) / 3
    let j = 0
    while (j < B - 1 && I[j] > peak / 2) j++
    if (j === 0) return 0
    const f = (I[j - 1] - peak / 2) / Math.max(I[j - 1] - I[j], 1e-12)
    return 2 * (j - 1 + 0.5 + f) / 10
}
