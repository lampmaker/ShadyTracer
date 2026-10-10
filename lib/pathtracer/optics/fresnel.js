//======================================================================================================================
// FRESNEL IN JS -- the known answers the optics-refraction bench compares the trace with.
//
// The shader's fresnelDielectric (core/microfacet.js) is the UNPOLARISED average applied afresh at
// every interface. That is what the trace is supposed to do, so it is what a bench row expects:
// a ratio of 1 means the code does what it claims. Real light is not re-randomised in polarisation
// between two surfaces, so the physically exact answer for a stack of interfaces averages the s and
// p results over the whole stack instead (slabT's `polarised`). The difference is the model's own
// error, and the bench prints it beside the ratio. For a glass slab (n 1.5) in air: none at normal
// incidence (s and p agree there), 0.3% of the transmission at 45 degrees, 3% at 70 (0.708 against
// 0.729) -- which is where carrying polarisation would start to pay.
//
// Pure functions, no GPU: optics/test/optics.test.mjs checks them against textbook values.
//======================================================================================================================

/** Reflectance of one interface, eta = n incident / n transmitted, cosI on the incident side:
 *  { s, p, unpolarised }, all 1 under total internal reflection. The same formula as the shader's. */
export function fresnel(cosI, eta) {
    const c = Math.min(Math.max(cosI, 0), 1)
    const sin2T = eta * eta * (1 - c * c)
    if (sin2T >= 1) return { s: 1, p: 1, unpolarised: 1 }
    const cosT = Math.sqrt(1 - sin2T)
    const rs = (eta * c - cosT) / (eta * c + cosT)
    const rp = (c - eta * cosT) / (c + eta * cosT)
    return { s: rs * rs, p: rp * rp, unpolarised: 0.5 * (rs * rs + rp * rp) }
}

/** A clear slab in air (index n), light arriving at angle theta (degrees) from its normal, every
 *  internal reflection summed incoherently: T = (1 - R)^2 / (1 - R^2) = (1 - R) / (1 + R), and
 *  R_slab = 2R / (1 + R). Both faces see the same angle and the same R (inside, eta is the inverse
 *  and cos the refracted one, which gives the same reflectance). `model` is the unpolarised R put
 *  into that series -- what the trace does; `polarised` the series for s and for p, then averaged. */
export function slabT(thetaDeg, n) {
    const f = fresnel(Math.cos(thetaDeg * Math.PI / 180), 1 / n)
    const t = R => (1 - R) / (1 + R)
    return { model: t(f.unpolarised), polarised: 0.5 * (t(f.s) + t(f.p)), R: f.unpolarised }
}

/** A slab that ABSORBS inside (Beer-Lambert, 0.37.0): t = exp(-a d) the internal transmittance of one pass, d the
 *  path through it at the refracted angle. Every internal reflection crosses again and is absorbed again:
 *  T = (1 - R)^2 t / (1 - R^2 t^2), R the unpolarised Fresnel at each face (the shader's model). t = 1 is slabT's
 *  (1 - R) / (1 + R). `depth` and `colour`: the material's colour depth and colour (one channel), the thickness in
 *  the same unit -- t = colour ^ (thickness / cos(theta inside) / depth). */
export function absorbingSlabT(thetaDeg, n, thickness, colour, depth) {
    const a = thetaDeg * Math.PI / 180
    const f = fresnel(Math.cos(a), 1 / n)
    const cosIn = Math.sqrt(1 - (Math.sin(a) / n) ** 2)
    const t = depth > 0 ? colour ** (thickness / cosIn / depth) : 1
    const R = f.unpolarised
    return (1 - R) ** 2 * t / (1 - R * R * t * t)
}

/** ...and the rule before 0.37.0, which a colour depth of 0 still is: the colour multiplies a ray at every crossing
 *  and nothing with depth -- (1 - R)^2 c^2 / (1 - R^2), whatever the thickness. */
export function tintedSlabT(thetaDeg, n, colour) {
    const R = fresnel(Math.cos(thetaDeg * Math.PI / 180), 1 / n).unpolarised
    return (1 - R) ** 2 * colour * colour / (1 - R * R)
}

/** A COATED slab in air (0.39.0; core/materials.js coat), one channel: R the coating's reflectance on the face the
 *  light enters by, and inside, on both faces, what the material says of a face light leaves by -- `back` 'ar'
 *  (nothing reflects), 'bare' (the glass's own unpolarised Fresnel) or 'coated' (R again: a coating's R depends on
 *  the light's invariant n sin(theta), the same inside as out). The same incoherent series as slabT:
 *  T = (1 - R)(1 - Ri) / (1 - Ri^2), Ri what each face reflects from within -- 1 - R with an AR back,
 *  (1 - R) / (1 + F) bare, (1 - R) / (1 + R) coated. */
export function coatedSlabT(thetaDeg, n, R, back) {
    const Ri = back === 'ar' ? 0 : back === 'bare' ? fresnel(Math.cos(thetaDeg * Math.PI / 180), 1 / n).unpolarised : R
    return (1 - R) * (1 - Ri) / (1 - Ri * Ri)
}

/** Two such slabs one behind the other, parallel, an air gap between: T1^2 / (1 - R1^2), R1 the one
 *  slab's reflectance -- the same incoherent series, one level up. */
export function twoSlabT(thetaDeg, n) {
    const { model } = slabT(thetaDeg, n)
    const R1 = 1 - model
    return model * model / (1 - R1 * R1)
}

/** Refraction of direction d (unit) at a surface of unit normal nrm facing the incoming ray (dot < 0),
 *  eta = n incident / n transmitted. null under total internal reflection. */
export function refract(d, nrm, eta) {
    const c = -(d[0] * nrm[0] + d[1] * nrm[1] + d[2] * nrm[2])
    const k = 1 - eta * eta * (1 - c * c)
    if (k < 0) return null
    const a = eta * c - Math.sqrt(k)
    return [eta * d[0] + a * nrm[0], eta * d[1] + a * nrm[1], eta * d[2] + a * nrm[2]]
}

/** THE WEDGE of the bench (tests.js testScene 'wedge'): a beam straight down, -z, through a top face
 *  tilted by `wedgeDeg` about y (outward normal (sin a, 0, cos a)) and out of a level bottom face.
 *  Returns the angle of the leaving ray from straight down, in degrees, signed as atan2(x, -z) --
 *  the convention the bench measures the detector hits in. */
export function wedgeExitDeg(wedgeDeg, n) {
    const a = wedgeDeg * Math.PI / 180
    const inside = refract([0, 0, -1], [Math.sin(a), 0, Math.cos(a)], 1 / n)
    const out = inside && refract(inside, [0, 0, 1], n)     // bottom face, its normal towards the ray
    return out ? Math.atan2(out[0], -out[2]) * 180 / Math.PI : null
}
