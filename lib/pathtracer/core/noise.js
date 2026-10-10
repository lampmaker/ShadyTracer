//======================================================================================================================
// NOISE -- solid (3-D) noise for surfaces: value noise, gradient noise, fBm and Worley cells, each
// with its gradient and a Lipschitz bound (roadmap/SURFACES.md phase 2).
//
// WHY BOUNDS. A noise that displaces an SDF steepens the field: d' = d + A n(p f) has slope up to
// 1 + A f L, where L bounds |grad n|, and a marcher that trusts d' steps through the surface unless
// the distance is divided by that. A bound only asserted in a comment is how this repo's worst bugs
// started, so each one here is either PROVED (the argument is next to it) or MEASURED (a dense search
// in test/noise.test.mjs, with the margin stated) -- and the test checks every one against the
// functions below.
//
// WHY GRADIENTS. A bump (phase 5) is the gradient of a height, and differences of a noise would cost
// three more evaluations and an epsilon to get wrong; these are analytic, and the test checks them
// against differences.
//
// DETERMINISTIC. Every function is a pure function of position and seed: getMaterial2 is asked about
// the same point by the shade kernel, the probe, light tracing, pick and the medium lookup, and the
// SDF by every march step and normal difference -- a noise that differed between them would make
// them see different surfaces. The hash is the renderer's pcg4d (tracebasics.js) fed the lattice cell
// and the seed, never the per-sample PRNG.
//
// UNITS. One lattice cell per unit of whatever p is. A pattern sized in real units multiplies p by
// perMm(cycles per millimetre) -- or divides by metres(size) -- and p_local * S_local in material code
// is in scene units whatever the object's scale.
//
// A JS MIRROR follows the WGSL, function for function, for the no-GPU test. It is only as right as
// that correspondence, so keep the two next to each other and change them together.
//======================================================================================================================

/* THE BOUNDS, on |grad n| for one octave at frequency 1.
   VALUE  PROVED. n = trilinear interpolation, with the quintic fade s, of corner values in [-1, 1].
          d n/dx = s'(fx) * (a fade-weighted mean, over the four y-z corner pairs, of v1 - v0), and
          |v1 - v0| <= 2, max s' = 15/8: each axis <= 3.75, so |grad n| <= 3.75 sqrt 3.
   GRAD   PROVED, and loose. n = NZ_GRAD_SCALE times the sum over corners of w_c(f) g_c . (f - c),
          |g_c| <= 1. The sum's gradient
          is sum w_c g_c -- a convex mix, |.| <= 1 -- plus sum (g_c . (f - c)) grad w_c, whose x part
          is s'(fx) times a fade-weighted mean of g1 . (f - c1) - g0 . (f - c0), each term at most
          sqrt(fx^2 + 2) + sqrt((1 - fx)^2 + 2) (dy, dz within 1); s' times that peaks at 5.625
          (fx = 1/2). So |grad n| <= NZ_GRAD_SCALE (1 + 5.625 sqrt 3).
   GRAD_MEASURED  the largest |grad n| a dense search found (test/noise.test.mjs: 3.437 over three
          seeds, 2026-09-29), times 1.25. A quarter of the proved one, so a marcher that uses it takes
          a quarter the steps -- but it is a measurement, not a proof.
          A LONGER SEARCH FINDS STEEPER (2026-09-30, on this file's JS twin, 3 million points over a
          million cells for each of seven seeds, the relief's four octave seeds among them): 3.854, so for
          ONE OCTAVE ON ITS OWN this is 12% above the steepest found, not 25%. Its one user today is the
          relief (builder/modifiers.js), which uses it only through nzFbmLip over four octaves, 17.2 for
          its fBm, whose own steepest a search finds at 8.90 (4.8 million points): 93% to spare, and the
          test holds 25% there. Code that marches a single octave with it has the 12%; NZ_GRAD_LIP is
          the proof.
   WORLEY F1 and F2 are distances to the nearest and second-nearest feature point: 1-Lipschitz exactly,
          provided the search finds the true nearest -- which the jitter below guarantees for F1 and
          the test measures for F2. F2 - F1 is 2-Lipschitz. */
/* GRADIENT NOISE'S SCALE. Its corner gradients lie in the unit ball, not on it (a random cube vector,
   shortened when longer than 1), so the raw sum reaches only about +-0.63; times 1.6 it spans about
   [-1, 1], and an amplitude A means a relief about A high. The bounds carry the same factor. */
export const NZ_GRAD_SCALE = 1.6
/* HOW FAR GRADIENT NOISE CAN REACH -- its VALUE, PROVED (the "about [-1, 1]" above is what a search finds).
   n = NZ_GRAD_SCALE sum_c w_c g_c . (f - c), the fade weights w_c >= 0 summing to 1, |g_c| <= 1 (nzGradAt
   divides by max(|g|, 1)). So |n| / NZ_GRAD_SCALE <= sum w_c |f - c| <= sqrt(sum w_c |f - c|^2) (Cauchy-
   Schwarz, the weights a distribution), and the weights split per axis, so sum w_c |f - c|^2 is
   h(fx) + h(fy) + h(fz) with h(t) = (1 - s(t)) t^2 + s(t) (1 - t)^2, s the quintic fade -- at most 1/4, at
   t = 1/2 (test/noise.test.mjs checks it densely). |n| <= NZ_GRAD_SCALE sqrt(3) / 2 = 1.386.
   fbm3's value is then within this times the sum of its octaves' amplitudes (its `peak`). The relief's
   shell rests on it (builder/modifiers.js): a bound that were only measured would cut the relief off
   wherever the noise reached past it. */
export const NZ_GRAD_VALUE_BOUND = NZ_GRAD_SCALE * Math.sqrt(3) / 2
export const NZ_VALUE_LIP = 3.75 * Math.sqrt(3)
export const NZ_GRAD_LIP = NZ_GRAD_SCALE * (1 + 5.625 * Math.sqrt(3))
export const NZ_GRAD_LIP_MEASURED = 4.3
/* THE RELIEF'S OWN fBm BOUND, MEASURED: |grad fbm3(p, 1, 4 octaves, x2, 0.5)|, the builder's relief's noise
   (builder/modifiers.js). The sum over its octaves of the one-octave bound, nzFbmLip(4, 2, 0.5, NZ_GRAD_LIP_MEASURED)
   = 17.2, has all four octaves at their steepest, pointing the same way, at one point. A search finds 8.905 at most
   (2026-09-30, on this file's JS twin: 14.4 million points over a million first-octave cells; 4.8 million more over
   four other regions of the lattice found 8.84 at most), and this is that times 1.25, rounded up. A measurement for that one configuration --
   seed 1, four octaves, lacunarity 2, gain 0.5 -- not a proof, and for no other fBm; test/noise.test.mjs fails if a
   search finds a slope within 25% of it. The benchmark's row runs it (modifiers.js RELIEF_CODE_FBM_BOUND); the
   modifier does not, until that row has been seen and timed. */
export const NZ_RELIEF_LIP_MEASURED = 11.2
/* WORLEY JITTER: each cell's feature point lies in the middle NZ_JITTER of its cell. Searching the
   27 cells around the query then finds the true nearest when the farthest a same-cell point can be,
   sqrt 3 (1/2 + J/2), is no more than the nearest a point two cells away can be, 1 + (1/2 - J/2):
   J <= (1.5 - sqrt 3 / 2) / (sqrt 3 / 2 + 1/2) = 0.464. PROVED for F1. */
export const NZ_JITTER = 0.46
/* WORLEY3X: TWO LATTICES CROSSED (the user, 2026-09-30, of galvanised steel: "it still feels like it's on a
   grid"). The price of NZ_JITTER is that worley3's cells are nudged cubes, in rows. worley3x takes the nearest
   points of two worley3 point sets at once -- the second turned by NZ_X_TURN and its cells NZ_X_RATIO the size
   -- so its cells are the Voronoi cells of both sets together, which line up with neither grid and vary in
   size. Each set's cell is scaled so the two together have one point per unit volume, as worley3 has, and a
   size written for worley3 means the same here: 1 / A^3 + 1 / B^3 = 1. */
export const NZ_X_RATIO = 1.37
export const NZ_X_A = Math.cbrt(1 + 1 / NZ_X_RATIO ** 3)
export const NZ_X_B = NZ_X_A * NZ_X_RATIO
// a rotation (orthonormal; columns, as WGSL's mat3x3 takes them) that aligns no axis of one lattice with the other's
export const NZ_X_TURN = [[0.36, 0.48, -0.8], [-0.8, 0.6, 0.0], [0.48, 0.64, 0.6]]

export const NOISE = /* wgsl */ `
const NZ_VALUE_LIP: f32 = ${NZ_VALUE_LIP};
const NZ_GRAD_LIP: f32 = ${NZ_GRAD_LIP};
const NZ_GRAD_LIP_MEASURED: f32 = ${NZ_GRAD_LIP_MEASURED};
const NZ_RELIEF_LIP_MEASURED: f32 = ${NZ_RELIEF_LIP_MEASURED};
const NZ_GRAD_SCALE: f32 = ${NZ_GRAD_SCALE};
const NZ_GRAD_VALUE_BOUND: f32 = ${NZ_GRAD_VALUE_BOUND};
const NZ_JITTER: f32 = ${NZ_JITTER};

// a lattice cell and a seed, hashed: four independent u32
fn nzHash(i: vec3<f32>, seed: u32) -> vec4<u32> {
    return pcg4d(vec4<u32>(bitcast<vec3<u32>>(vec3<i32>(i)), seed));
}
// ...as numbers in [0, 1) (24 bits each)
fn nzUnit(h: vec4<u32>) -> vec4<f32> { return vec4<f32>(h >> vec4<u32>(8u)) * (1.0 / 16777216.0); }
// the corner's gradient: a random vector, |g| <= 1, never NaN
fn nzGradAt(i: vec3<f32>, seed: u32) -> vec3<f32> {
    let g = nzUnit(nzHash(i, seed)).xyz * 2.0 - 1.0;
    return g / max(length(g), 1.0);
}
fn nzFade(f: vec3<f32>) -> vec3<f32> { return f * f * f * (f * (f * 6.0 - 15.0) + 10.0); }
fn nzFadeD(f: vec3<f32>) -> vec3<f32> { return 30.0 * f * f * (f - 1.0) * (f - 1.0); }

/* EVERY LOOP HERE IS ONE THE COMPILER CANNOT UNROLL. These functions are inlined into the SDF, and
   the SDF into a march loop the compiler unrolls 32 times on purpose (wavefront.js prog_march); an
   fBm written out as octaves x 8 corners, or a Worley search as 27 cells, then became hundreds of
   copies per kernel, and the Noise library scene took over a minute to compile (2026-09-29). So the
   corners, the octaves and the cells are LOOPS, and each bound goes through noUnroll (tracebasics.js),
   which adds a uniform that is always 0: the compiler cannot know the trip count, so each call
   compiles to one body. The cost at run time is a loop counter. test/noise.test.mjs checks that no
   loop in this file has a bound that does not go through noUnroll. */
// corner c (0..7) of a cell: x is bit 0, y bit 1, z bit 2
fn nzCorner(c: u32) -> vec3<f32> { return vec3<f32>(f32(c & 1u), f32((c >> 1u) & 1u), f32((c >> 2u) & 1u)); }

/* VALUE NOISE: (grad, value), value in [-1, 1]. Blockier than gradient noise; its bound is tight
   enough to march by without a measurement. Trilinear with the quintic fade: corner c weighs the
   product over the axes of u or 1 - u, and the gradient of that product is the fade's slope on
   one axis times the others. */
fn vnoise3(p: vec3<f32>, seed: u32) -> vec4<f32> {
    let i = floor(p); let f = p - i;
    let u = nzFade(f); let du = nzFadeD(f);
    var acc = vec4<f32>(0.0);
    for (var c = 0u; c < noUnroll(8u); c++) {
        let o = nzCorner(c);
        let hi = o > vec3<f32>(0.5);
        let w = select(1.0 - u, u, hi);
        let dw = select(-du, du, hi);
        let v = nzUnit(nzHash(i + o, seed)).x * 2.0 - 1.0;
        acc += v * vec4<f32>(dw.x * w.y * w.z, w.x * dw.y * w.z, w.x * w.y * dw.z, w.x * w.y * w.z);
    }
    return acc;
}

/* GRADIENT NOISE (Perlin's construction, quintic fade): (grad, value), value about [-1, 1] (the test
   reports the range it finds; NZ_GRAD_SCALE above). Smoother and less grid-aligned than value noise.
   Corner c contributes w_c (g_c . (f - c)): its gradient is w_c g_c plus (g_c . (f - c)) grad w_c. */
fn gnoise3(p: vec3<f32>, seed: u32) -> vec4<f32> {
    let i = floor(p); let f = p - i;
    let u = nzFade(f); let du = nzFadeD(f);
    var acc = vec4<f32>(0.0);
    for (var c = 0u; c < noUnroll(8u); c++) {
        let o = nzCorner(c);
        let hi = o > vec3<f32>(0.5);
        let w = select(1.0 - u, u, hi);
        let dw = select(-du, du, hi);
        let g = nzGradAt(i + o, seed);
        let v = dot(g, f - o);
        let wc = w.x * w.y * w.z;
        acc += vec4<f32>(wc * g + v * vec3<f32>(dw.x * w.y * w.z, w.x * dw.y * w.z, w.x * w.y * dw.z), wc * v);
    }
    return acc * NZ_GRAD_SCALE;
}

/* FRACTAL SUM of gradient noise: octaves at frequency lac^k and amplitude gain^k, each with its own
   seed so they do not line up. (grad, value). Its bound is nzFbmLip's. */
fn fbm3(p: vec3<f32>, seed: u32, octaves: u32, lac: f32, gain: f32) -> vec4<f32> {
    var acc = vec4<f32>(0.0);
    var fr = 1.0;
    var am = 1.0;
    for (var k = 0u; k < noUnroll(octaves); k++) {
        let n = gnoise3(p * fr, seed + k * 7919u);
        acc += vec4<f32>(n.xyz * (am * fr), n.w * am);
        fr *= lac;
        am *= gain;
    }
    return acc;
}
/* |grad fbm3| <= L sum (gain lac)^k: pass NZ_GRAD_LIP (proved) or NZ_GRAD_LIP_MEASURED. */
fn nzFbmLip(octaves: u32, lac: f32, gain: f32, L: f32) -> f32 {
    var s = 0.0;
    var t = 1.0;
    for (var k = 0u; k < noUnroll(octaves); k++) { s += t; t *= gain * lac; }
    return L * s;
}

/* WORLEY CELLS: (F1, F2, id1, id2) -- the distances to the nearest and second-nearest feature point,
   and a number in [0, 1) for each of those two cells (a grain's own colour, say). F1 is 1-Lipschitz;
   F2 - F1 is 0 on a cell border and grows into the cell (creases, cracks, leather). The 27 cells
   around the query, as one loop: x fastest, then y, then z. */
fn worley3(p: vec3<f32>, seed: u32) -> vec4<f32> {
    let i = floor(p);
    var f1 = 1e9; var f2 = 1e9; var id1 = 0.0; var id2 = 0.0;
    for (var n = 0u; n < noUnroll(27u); n++) {
        let c = i + vec3<f32>(f32(n % 3u), f32((n / 3u) % 3u), f32(n / 9u)) - 1.0;
        let h = nzUnit(nzHash(c, seed));
        let q = c + 0.5 + (h.xyz - 0.5) * NZ_JITTER;
        let d = length(p - q);
        if (d < f1) { f2 = f1; id2 = id1; f1 = d; id1 = h.w; }
        else if (d < f2) { f2 = d; id2 = h.w; }
    }
    return vec4<f32>(f1, f2, id1, id2);
}

/* WORLEY3X (NZ_X_RATIO says why): (F1, F2, id1, id2) of two worley3 point sets together, in units of p. Each
   set's F1 and F2 are exact (worley3's search), so the union's are the smallest two of those four -- and
   being the nearest and second-nearest of a set of points, F1 and F2 are 1-Lipschitz, as worley3's are: an
   SDF can use it on the same bounds. Twice worley3's cost: in material code (once a hit) nothing, in a
   relief (every march step near it) worth weighing. */
const NZ_X_A: f32 = ${NZ_X_A};
const NZ_X_B: f32 = ${NZ_X_B};
fn worley3x(p: vec3<f32>, seed: u32) -> vec4<f32> {
    let turn = mat3x3<f32>(${NZ_X_TURN.flat().map(x => x.toFixed(2)).join(', ')});
    let a = worley3(p / NZ_X_A, seed) * vec4<f32>(NZ_X_A, NZ_X_A, 1.0, 1.0);
    let b = worley3(turn * p / NZ_X_B, seed + 1013u) * vec4<f32>(NZ_X_B, NZ_X_B, 1.0, 1.0);
    // the nearest two of four, given a.x <= a.y and b.x <= b.y
    if (a.x <= b.x) { return vec4<f32>(a.x, min(a.y, b.x), a.z, select(b.z, a.w, a.y <= b.x)); }
    return vec4<f32>(b.x, min(b.y, a.x), b.z, select(a.z, b.w, b.y <= a.x));
}

/* cycles per millimetre -> per scene unit: noise3(p * perMm(2.0)) has two cells to the mm */
fn perMm(cyclesPerMm: f32) -> f32 { return cyclesPerMm / metres(0.001); }
`

//======================================================================================================================
// THE JS MIRROR -- for test/noise.test.mjs only. Same names, same arithmetic (in doubles).
//======================================================================================================================
const u32 = x => x >>> 0
/** pcg4d, as tracebasics.js has it */
export function pcg4d([x, y, z, w]) {
    let v = [x, y, z, w].map(a => u32(Math.imul(a, 1664525) + 1013904223))
    const mix = () => {
        v[0] = u32(v[0] + Math.imul(v[1], v[3])); v[1] = u32(v[1] + Math.imul(v[2], v[0]))
        v[2] = u32(v[2] + Math.imul(v[0], v[1])); v[3] = u32(v[3] + Math.imul(v[1], v[2]))
    }
    mix()
    v = v.map(a => u32(a ^ (a >>> 16)))
    mix()
    return v
}
const nzHash = (i, seed) => pcg4d([u32(i[0] | 0), u32(i[1] | 0), u32(i[2] | 0), u32(seed)])
const nzUnit = h => h.map(a => (a >>> 8) / 16777216)
function nzGradAt(i, seed) {
    const g = nzUnit(nzHash(i, seed)).slice(0, 3).map(a => a * 2 - 1)
    const l = Math.max(Math.hypot(...g), 1)
    return g.map(a => a / l)
}
const fade = f => f * f * f * (f * (f * 6 - 15) + 10)
const fadeD = f => 30 * f * f * (f - 1) * (f - 1)
const add = (a, b) => a.map((x, k) => x + b[k])
const sub = (a, b) => a.map((x, k) => x - b[k])
const scl = (a, s) => a.map(x => x * s)
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const corner = c => [c & 1, (c >> 1) & 1, (c >> 2) & 1]
/* the per-corner weight and its gradient, as the WGSL loops compute them */
function weights(f, o) {
    const u = f.map(fade), du = f.map(fadeD)
    const w = o.map((b, k) => b ? u[k] : 1 - u[k]), dw = o.map((b, k) => b ? du[k] : -du[k])
    return { wc: w[0] * w[1] * w[2], gw: [dw[0] * w[1] * w[2], w[0] * dw[1] * w[2], w[0] * w[1] * dw[2]] }
}
export function vnoise3(p, seed) {
    const i = p.map(Math.floor), f = p.map((x, k) => x - i[k])
    const acc = [0, 0, 0, 0]
    for (let c = 0; c < 8; c++) {
        const o = corner(c), { wc, gw } = weights(f, o)
        const v = nzUnit(nzHash(i.map((x, k) => x + o[k]), seed))[0] * 2 - 1
        for (let k = 0; k < 3; k++) acc[k] += v * gw[k]
        acc[3] += v * wc
    }
    return acc
}
export function gnoise3(p, seed) {
    const i = p.map(Math.floor), f = p.map((x, k) => x - i[k])
    const acc = [0, 0, 0, 0]
    for (let c = 0; c < 8; c++) {
        const o = corner(c), { wc, gw } = weights(f, o)
        const g = nzGradAt(i.map((x, k) => x + o[k]), seed)
        const v = dot3(g, f.map((x, k) => x - o[k]))
        for (let k = 0; k < 3; k++) acc[k] += wc * g[k] + v * gw[k]
        acc[3] += wc * v
    }
    return acc.map(x => x * NZ_GRAD_SCALE)
}
export function fbm3(p, seed, octaves, lac, gain) {
    const acc = [0, 0, 0, 0]
    let fr = 1, am = 1
    for (let k = 0; k < octaves; k++) {
        const n = gnoise3(scl(p, fr), u32(seed + k * 7919))
        for (let j = 0; j < 3; j++) acc[j] += n[j] * am * fr
        acc[3] += n[3] * am
        fr *= lac; am *= gain
    }
    return acc
}
export function nzFbmLip(octaves, lac, gain, L) {
    let s = 0, t = 1
    for (let k = 0; k < octaves; k++) { s += t; t *= gain * lac }
    return L * s
}
/** reach: 1 is the kernel's 27 cells; the test passes 2 for a brute-force 125 */
export function worley3(p, seed, reach = 1, jitter = NZ_JITTER) {
    const i = p.map(Math.floor)
    let f1 = 1e9, f2 = 1e9, id1 = 0, id2 = 0
    for (let z = -reach; z <= reach; z++) for (let y = -reach; y <= reach; y++) for (let x = -reach; x <= reach; x++) {
        const c = add(i, [x, y, z]), h = nzUnit(nzHash(c, seed))
        const q = c.map((a, k) => a + 0.5 + (h[k] - 0.5) * jitter)
        const d = Math.hypot(...sub(p, q))
        if (d < f1) { f2 = f1; id2 = id1; f1 = d; id1 = h[3] } else if (d < f2) { f2 = d; id2 = h[3] }
    }
    return [f1, f2, id1, id2]
}
/** worley3x, as the WGSL: two point sets, the nearest two of their four; reach as worley3's */
export function worley3x(p, seed, reach = 1) {
    const T = NZ_X_TURN, turned = [0, 1, 2].map(i => T[0][i] * p[0] + T[1][i] * p[1] + T[2][i] * p[2])
    const a = worley3(p.map(x => x / NZ_X_A), seed, reach), b = worley3(turned.map(x => x / NZ_X_B), u32(seed + 1013), reach)
    const [a1, a2, b1, b2] = [a[0] * NZ_X_A, a[1] * NZ_X_A, b[0] * NZ_X_B, b[1] * NZ_X_B]
    if (a1 <= b1) return [a1, Math.min(a2, b1), a[2], a2 <= b1 ? a[3] : b[2]]
    return [b1, Math.min(b2, a1), b[2], b2 <= a1 ? b[3] : a[2]]
}
