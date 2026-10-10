//======================================================================================================================
// SPECTRAL -- what a wavelength means to the renderer's three channels, and a coating's reflectance per channel.
//
// WHY THIS EXISTS. A ray carries three linear Rec.709 channels, never a wavelength (roadmap/PLAN.md, *Colour, the
// hybrid*: a white source traced one wavelength at a time is colour noise everywhere). A COATING -- a dichroic, a
// beam splitter, an anti-reflective layer -- is specified by its spectrum: R(lambda), with an edge that moves with
// the angle. To put it on three channels each channel needs to say WHICH WAVELENGTHS IT IS: a weight per wavelength,
// and a channel's reflectance is R averaged against it. This is the "looks right" method the user chose to start with
// (2026-10-08): exact for a constant R (a beam splitter, an AR coat), an approximation of the spectrum for an edge --
// it assumes the light in each channel is spread over that channel's wavelengths as the weights say, whatever the
// source really emits. The exact way (a wavelength per ray, the source's own spectrum, CMFs at the detector) is the
// optics analysis's, planned after the dispersive prism (PLAN.md C).
//
// THE CHANNELS' WAVELENGTHS. The CIE 1931 2-degree colour-matching functions (Wyman, Sloan & Shirley 2013, the
// multi-lobe piecewise-Gaussian fit -- analytic, so no table to transcribe; test/spectral.test.mjs holds it against
// published table values) turned into linear Rec.709 by colorimetry.js's own matrix, each NEGATIVE PART CLIPPED TO 0:
// r-bar is negative from about 440 to 545 nm, and a weight below 0 would make a channel's average of an R in [0, 1]
// leave [0, 1] -- a reflectance above 1 is not something a coating can sample. So the weights are a choice for
// looks, not exactness: red keeps its small violet lobe (what makes violet look reddish), and each channel is
// normalised to sum 1, so a constant R is that R in every channel, exactly.
//
// IN BINS OF 10 nm, 380 to 780 nm: each bin the weight's mean over it. The edge is a logistic in lambda, and a
// logistic integrates exactly over a bin (its integral is a softplus), so a channel's reflectance is 41 softplus
// differences against the bins' weights -- exact for the binned weights at any edge width, a step included, and
// smooth as the edge moves (it would move in 10 nm jumps if sampled at the bins' centres instead).
//
// THE EDGE AND THE ANGLE. R(lambda) = lo + (hi - lo) / (1 + exp(-(lambda - edge) / s)): lo the reflectance well below
// the edge, hi well above. `width` is the 10 % to 90 % transition, in nm: s = width / (2 ln 9). An interference
// stack's edge moves to shorter wavelengths as the light tilts: edge(theta) = edge0 sqrt(1 - (n0 sin theta0 / nEff)^2),
// n0 sin theta0 the light's invariant (the same in every layer, by Snell), nEff the stack's effective index -- the
// usual first-order model of a dichroic's blue shift; it does not split s and p (there is no polarisation).
//
// DISPERSION (0.40.0; the user's prism, after the dichroic): a material's index depends on the wavelength, given as its
// index at the d line and its Abbe number, V_d = (n_d - 1) / (n_F - n_C) -- what a glass catalogue lists. n(lambda) is
// the two-term Cauchy formula A + B / lambda^2 through those two numbers (cauchyN): exact at d, F and C's difference
// exact, and the rest of the curve Cauchy's shape (within 3e-4 of BK7's catalogue n_F and n_C: test/spectral.test.mjs).
// A RAY HAS NO WAVELENGTH until it is refracted INTO a dispersive medium. There one is drawn (specDraw: a bin by the
// channels' summed weights, then uniform in it) and the ray's three channels are weighed by what that wavelength is to
// them -- w_c = W_c[bin] / P(bin), which averages to exactly 1 in each channel over the draw, so white stays white on
// average and each sample is a colour of the rainbow -- and from then on every index it meets is n(its wavelength).
// The pick between reflecting and refracting there is the d line's Fresnel, so a reflection off a prism stays white and
// noiseless; only the refracted light carries the colour noise. THE WAVELENGTH RIDES IN Ray.tag's upper 16 bits (the
// flags use bits 0-11, the lens's class 12-16 since 0.43.0 and 0.44.0; tracebasics.js TAG_*), so the Ray stays 112 bytes: 0 none, else 380 + (code - 1) 400 / 32766 nm,
// in bits 17-31.
//
// Pure functions, no GPU: test/spectral.test.mjs holds the JS mirror to the definitions above, and check-shaders
// compiles the WGSL.
//======================================================================================================================
import { XYZ_TO_RGB709 } from './colorimetry.js'

/** The bins: SPEC_BINS of SPEC_STEP nm from SPEC_LO. */
export const SPEC_LO = 380, SPEC_STEP = 10, SPEC_BINS = 40
/** The 10-90 % width of a logistic edge in units of its scale s: 2 ln 9. */
export const SPEC_W1090 = 2 * Math.log(9)
/** The narrowest width the edge takes (nm): 0 asks for a step, and this is one to well under a bin. */
export const SPEC_WIDTH_MIN = 0.01

// a piecewise Gaussian: sigma1 below the mean, sigma2 above it
const g = (x, mu, s1, s2) => { const t = (x - mu) / (x < mu ? s1 : s2); return Math.exp(-0.5 * t * t) }
/** The CIE 1931 2-degree colour-matching functions at lambda (nm): [x-bar, y-bar, z-bar]. Wyman, Sloan & Shirley
 *  (2013), "Simple Analytic Approximations to the CIE XYZ Color Matching Functions", the multi-lobe fit. */
export function cmf(lambda) {
    const x = 1.056 * g(lambda, 599.8, 37.9, 31.0) + 0.362 * g(lambda, 442.0, 16.0, 26.7) - 0.065 * g(lambda, 501.1, 20.4, 26.2)
    const y = 0.821 * g(lambda, 568.8, 46.9, 40.5) + 0.286 * g(lambda, 530.9, 16.3, 31.1)
    const z = 1.217 * g(lambda, 437.0, 11.8, 36.0) + 0.681 * g(lambda, 459.0, 26.0, 13.8)
    return [x, y, z]
}
/** The Rec.709 colour-matching functions at lambda, negative parts clipped to 0 (see the header): not normalised. */
export function rgbBar(lambda) {
    const [x, y, z] = cmf(lambda)
    return XYZ_TO_RGB709.map(r => Math.max(0, r[0] * x + r[1] * y + r[2] * z))
}

/** THE BINS' WEIGHTS: [bin][channel], each channel summing to 1 over the bins. A bin's weight is rgbBar's mean over
 *  it, by the midpoint rule at 0.1 nm (100 points a bin). */
export const SPEC_WEIGHTS = (() => {
    const sub = 100
    const W = Array.from({ length: SPEC_BINS }, (_, k) => {
        const acc = [0, 0, 0]
        for (let j = 0; j < sub; j++) {
            const c = rgbBar(SPEC_LO + (k + (j + 0.5) / sub) * SPEC_STEP)
            for (let i = 0; i < 3; i++) acc[i] += c[i] / sub
        }
        return acc
    })
    const tot = [0, 1, 2].map(i => W.reduce((s, w) => s + w[i], 0))
    return W.map(w => w.map((v, i) => v / tot[i]))
})()

const softplus = x => Math.max(x, 0) + Math.log1p(Math.exp(-Math.abs(x)))

/** The edge's scale s (nm) for a 10-90 % width (nm). */
export const edgeScale = width => Math.max(width, SPEC_WIDTH_MIN) / SPEC_W1090

/** Where the edge is for light whose invariant n0 sin(theta0) is `nSin`, through a stack of effective index nEff:
 *  edge0 sqrt(1 - (nSin / nEff)^2), 0 when the light is past what the stack's index can carry (then every
 *  wavelength is on the edge's long side). */
export const edgeAt = (edge0, nSin, nEff) => edge0 * Math.sqrt(Math.max(0, 1 - (nSin / Math.max(nEff, 1e-6)) ** 2))

/** A coating's reflectance per channel: R(lambda) from lo below `edge` (nm) to hi above it, a logistic of 10-90 %
 *  width `width` (nm), averaged against each channel's weights -- the same arithmetic as the WGSL coatEdgeRGB. */
export function edgeRGB(lo, hi, edge, width) {
    const s = edgeScale(width)
    const acc = [0, 0, 0]
    let prev = softplus((SPEC_LO - edge) / s)
    for (let k = 0; k < SPEC_BINS; k++) {
        const next = softplus((SPEC_LO + (k + 1) * SPEC_STEP - edge) / s)
        for (let i = 0; i < 3; i++) acc[i] += SPEC_WEIGHTS[k][i] * (next - prev)
        prev = next
    }
    return acc.map(a => lo + (hi - lo) * a * (s / SPEC_STEP))
}

/* THE FRAUNHOFER LINES a glass catalogue's n_d and V_d are given at (nm): d (helium), F and C (hydrogen). */
export const LAMBDA_D = 587.56, LAMBDA_F = 486.13, LAMBDA_C = 656.27
/** n(lambda) of a glass of index nd at the d line and Abbe number vd: Cauchy's A + B / lambda^2 through n_d and
 *  (n_F - n_C) = (n_d - 1) / V_d. vd <= 0 is no dispersion: nd at every wavelength. */
export function cauchyN(nd, vd, lambda) {
    if (!(vd > 0)) return nd
    const B = (nd - 1) / (vd * (1 / LAMBDA_F ** 2 - 1 / LAMBDA_C ** 2))
    return nd - B / LAMBDA_D ** 2 + B / lambda ** 2
}

/** THE WAVELENGTH DRAW: bin k with probability the channels' summed weights there over 3 (each channel sums to 1, so
 *  these sum to 1) -- no draw wasted where no channel sees anything -- then uniform in the bin. */
export const SPEC_PICK = SPEC_WEIGHTS.map(w => (w[0] + w[1] + w[2]) / 3)
/** A draw u in [0, 1): { lambda, w } -- the wavelength, and what it is to each channel, W_c / P, mean 1 over u. */
export function specDraw(u) {
    let acc = 0
    for (let k = 0; k < SPEC_BINS; k++) {
        const p = SPEC_PICK[k]
        if (u < acc + p || k === SPEC_BINS - 1) {
            const t = p > 0 ? Math.min(Math.max((u - acc) / p, 0), 1) : 0.5
            return { lambda: SPEC_LO + (k + t) * SPEC_STEP, k, w: SPEC_WEIGHTS[k].map(c => p > 0 ? c / p : 0) }
        }
        acc += p
    }
}
/** The wavelength as Ray.tag's upper 15 bits carry it (bits 17-31 since 0.44.0, which took bit 16 for the manifold's
 *  class, tracebasics.js TAG_LENS_ONE): 0 none, else 1 + its place in 380-780 nm in LAMBDA_STEPS steps, 0.012 nm. */
export const LAMBDA_SPAN = SPEC_BINS * SPEC_STEP, LAMBDA_STEPS = 32766, LAMBDA_SHIFT = 17
export const lambdaCode = l => 1 + Math.round(Math.min(Math.max((l - SPEC_LO) / LAMBDA_SPAN, 0), 1) * LAMBDA_STEPS)
export const lambdaOf = code => code ? SPEC_LO + (code - 1) * LAMBDA_SPAN / LAMBDA_STEPS : 0

const f = v => { const t = String(parseFloat((+v).toPrecision(9))); return /[.e]/.test(t) ? t : t + '.0' }
/** WGSL: the bins and coatEdgeRGB, for the shade kernel's module (materials_pbr.js). The weights are a const array
 *  indexed in a loop -- one copy of the numbers, however many places call it. */
export const SPECTRAL_WGSL = /*wgsl*/`
const SPEC_LO: f32 = ${f(SPEC_LO)};
const SPEC_STEP: f32 = ${f(SPEC_STEP)};
const SPEC_BINS: u32 = ${SPEC_BINS}u;
const SPEC_W1090: f32 = ${f(SPEC_W1090)};
const SPEC_WIDTH_MIN: f32 = ${f(SPEC_WIDTH_MIN)};
// each channel's weight per 10 nm bin from 380 nm, summing to 1 (spectral.js SPEC_WEIGHTS)
const SPEC_WEIGHTS = array<vec3<f32>, ${SPEC_BINS}>(
${SPEC_WEIGHTS.map(w => `    vec3<f32>(${w.map(f).join(', ')})`).join(',\n')}
);
fn specSoftplus(x: f32) -> f32 { return max(x, 0.0) + log(1.0 + exp(-abs(x))); }
/* A COATING'S REFLECTANCE PER CHANNEL (spectral.js edgeRGB): lo below the edge (nm), hi above it, a logistic of
   10-90 % width w (nm), each bin's mean of it exactly (a softplus difference), against the channels' weights. */
fn coatEdgeRGB(lo: f32, hi: f32, edge: f32, w: f32) -> vec3<f32> {
    let s = max(w, SPEC_WIDTH_MIN) / SPEC_W1090;
    var acc = vec3<f32>(0.0);
    var prev = specSoftplus((SPEC_LO - edge) / s);
    for (var k = 0u; k < SPEC_BINS; k++) {
        let next = specSoftplus((SPEC_LO + f32(k + 1u) * SPEC_STEP - edge) / s);
        acc += SPEC_WEIGHTS[k] * (next - prev);
        prev = next;
    }
    return vec3<f32>(lo) + (hi - lo) * acc * (s / SPEC_STEP);
}
// where the edge is for light of invariant n0 sin(theta0) through a stack of effective index nEff (spectral.js edgeAt)
fn coatEdgeAt(edge0: f32, nSin: f32, nEff: f32) -> f32 {
    let q = nSin / max(nEff, 1e-6);
    return edge0 * sqrt(max(0.0, 1.0 - q * q));
}

// ---- DISPERSION (spectral.js cauchyN, specDraw, lambdaCode) ----
const LAMBDA_D: f32 = ${f(LAMBDA_D)};
const CAUCHY_FC: f32 = ${f(1 / LAMBDA_F ** 2 - 1 / LAMBDA_C ** 2)};   // 1 / lambda_F^2 - 1 / lambda_C^2, nm^-2
// each bin's probability in the wavelength draw: the channels' weights summed, over 3
const SPEC_PICK = array<f32, ${SPEC_BINS}>(${SPEC_PICK.map(f).join(', ')});
// n(lambda) of a glass of index nd at the d line and Abbe number vd (Cauchy through both); vd <= 0: nd
fn cauchyN(nd: f32, vd: f32, lambda: f32) -> f32 {
    if (!(vd > 0.0)) { return nd; }
    let B = (nd - 1.0) / (vd * CAUCHY_FC);
    return nd + B * (1.0 / (lambda * lambda) - 1.0 / (LAMBDA_D * LAMBDA_D));
}
struct SpecDraw { lambda: f32, w: vec3<f32> }
// a wavelength for u in [0, 1), and what it is to each channel (W_c / P: mean 1 in each over u)
fn specDraw(u: f32) -> SpecDraw {
    var d: SpecDraw;
    var acc = 0.0;
    for (var k = 0u; k < SPEC_BINS; k++) {
        let p = SPEC_PICK[k];
        if (u < acc + p || k == SPEC_BINS - 1u) {
            let t = select(0.5, clamp((u - acc) / p, 0.0, 1.0), p > 0.0);
            d.lambda = SPEC_LO + (f32(k) + t) * SPEC_STEP;
            d.w = select(vec3<f32>(0.0), SPEC_WEIGHTS[k] / p, p > 0.0);
            return d;
        }
        acc += p;
    }
    return d;
}
/* THE RAY'S WAVELENGTH, in Ray.tag's upper 15 bits (the flags and the lens's class are bits 0-16): 0 none, else 1 + its place in
   380-780 nm in 32766 steps -- 0.012 nm (16 bits and 0.006 nm until 0.44.0). Every write of a whole tag that a wavelength must outlive keeps these bits
   (tracebasics.js TAG_LAMBDA_MASK, beside the flags). */
fn rayLambda(r: Ray) -> f32 {
    let c = r.tag >> ${LAMBDA_SHIFT}u;
    return select(0.0, SPEC_LO + f32(c - 1u) * (SPEC_STEP * f32(SPEC_BINS) / ${LAMBDA_STEPS}.0), c != 0u);
}
// a wavelength as the tag will hold it: the index a ray refracts at and every later one read the same lambda
fn lambdaCoded(lambda: f32) -> f32 {
    var r: Ray;
    return rayLambda(withLambda(r, lambda));
}
fn withLambda(r_in: Ray, lambda: f32) -> Ray {
    var r = r_in;
    let c = 1u + u32(round(clamp((lambda - SPEC_LO) / (SPEC_STEP * f32(SPEC_BINS)), 0.0, 1.0) * ${LAMBDA_STEPS}.0));
    r.tag = (r.tag & ~TAG_LAMBDA_MASK) | (c << ${LAMBDA_SHIFT}u);
    return r;
}
`
