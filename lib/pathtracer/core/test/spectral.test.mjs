// node lib/pathtracer/core/test/spectral.test.mjs
//
// core/spectral.js: the colour-matching fit against the CIE 1931 table, the channels' wavelength weights, and a
// coating's reflectance per channel -- the JS mirror against brute-force integration, and the shader's arithmetic in
// an f32 emulation against the mirror. No GPU (check-shaders compiles the WGSL).
import { cmf, rgbBar, SPEC_WEIGHTS, SPEC_LO, SPEC_STEP, SPEC_BINS, SPEC_W1090, SPEC_WIDTH_MIN, edgeScale, edgeAt, edgeRGB,
         SPECTRAL_WGSL, cauchyN, LAMBDA_D, LAMBDA_F, LAMBDA_C, SPEC_PICK, specDraw, lambdaCode, lambdaOf } from '../spectral.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol
const maxDiff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])))

{
    /* THE FIT AGAINST THE TABLE: CIE 1931 2-degree x-bar, y-bar, z-bar as tabulated (CIE 15). The fit's own paper
       quotes errors of this order; 0.015 is what it was measured to meet here (worst: z-bar at 450, 0.0095). */
    const TABLE = { 450: [0.3362, 0.0380, 1.7721], 500: [0.0049, 0.3230, 0.2720], 550: [0.4334, 0.9950, 0.0087],
                    555: [0.5121, 1.0000, 0.0057], 600: [1.0622, 0.6310, 0.0008], 650: [0.2835, 0.1070, 0.0000] }
    for (const [l, want] of Object.entries(TABLE)) {
        const d = maxDiff(cmf(+l), want)
        ok(`the CMF fit at ${l} nm is the table's within 0.015`, d <= 0.015, `fit ${cmf(+l).map(v => v.toFixed(4))} table ${want} (off ${d.toFixed(4)})`)
    }
    // equal-energy white: the three integrals equal (the table's sums at 1 nm are 106.865, 106.857, 106.892)
    let X = 0, Y = 0, Z = 0
    for (let l = 360; l <= 830; l += 0.1) { const c = cmf(l); X += c[0] * 0.1; Y += c[1] * 0.1; Z += c[2] * 0.1 }
    ok('the three integrals are the table\'s within 0.2 %', [X, Y, Z].every((v, i) => near(v, [106.865, 106.857, 106.892][i], 0.2)), `${X} ${Y} ${Z}`)
    ok('equal energy is white: xy (1/3, 1/3) within 1e-3', near(X / (X + Y + Z), 1 / 3, 1e-3) && near(Y / (X + Y + Z), 1 / 3, 1e-3))
}
{
    // THE WEIGHTS: three non-negative distributions over the bins, each summing to 1, peaking where the channel is
    ok('40 bins of 10 nm from 380', SPEC_WEIGHTS.length === SPEC_BINS && SPEC_BINS * SPEC_STEP + SPEC_LO === 780)
    ok('every weight >= 0', SPEC_WEIGHTS.every(w => w.every(v => v >= 0)))
    for (let i = 0; i < 3; i++) ok(`channel ${'rgb'[i]} sums to 1`, near(SPEC_WEIGHTS.reduce((s, w) => s + w[i], 0), 1, 1e-12))
    const peak = i => SPEC_LO + SPEC_STEP * (SPEC_WEIGHTS.reduce((b, w, k) => w[i] > SPEC_WEIGHTS[b][i] ? k : b, 0) + 0.5)
    ok('red peaks at 595-615 nm, green at 525-545, blue at 435-455', near(peak(0), 605, 10) && near(peak(1), 535, 10) && near(peak(2), 445, 10),
       `${peak(0)} ${peak(1)} ${peak(2)}`)
    ok('rgbBar is the clipped Rec.709 CMFs: 0 where r-bar is negative (500 nm)', rgbBar(500)[0] === 0 && rgbBar(500)[1] > 0)
    ok('red keeps its violet lobe (420-450 nm), a few % of it', (() => {
        const v = SPEC_WEIGHTS.slice(4, 7).reduce((s, w) => s + w[0], 0); return v > 0.01 && v < 0.1
    })())
}
{
    // A CONSTANT REFLECTANCE is itself in every channel, exactly -- a beam splitter, an AR coat
    for (const [lo, edge, w] of [[0, 550, 20], [0.5, 400, 0], [1, 700, 100], [0.3333, 380, 5]])
        ok(`lo = hi = ${lo} gives ${lo} in every channel`, maxDiff(edgeRGB(lo, lo, edge, w), [lo, lo, lo]) < 1e-12)
    // a long-pass and its complement add to 1, channel by channel
    ok('R(lo 1, hi 0) + R(lo 0, hi 1) = 1', [[455.3, 0], [550, 20], [612.7, 3]].every(([e, w]) =>
        maxDiff(edgeRGB(1, 0, e, w).map((v, i) => v + edgeRGB(0, 1, e, w)[i]), [1, 1, 1]) < 1e-12))
    // well outside the visible: the far side's value
    ok('an edge at 200 nm reflects hi everywhere, at 1000 nm lo', maxDiff(edgeRGB(0.1, 0.9, 200, 10), [0.9, 0.9, 0.9]) < 1e-9
        && maxDiff(edgeRGB(0.1, 0.9, 1000, 10), [0.1, 0.1, 0.1]) < 1e-9)
    // reflect long: more of each channel reflects as the edge moves down
    let mono = true
    for (let e = 360; e < 800; e += 1.3) { const a = edgeRGB(0, 1, e, 15), b = edgeRGB(0, 1, e + 1.3, 15); if (a.some((v, i) => b[i] > v + 1e-12)) mono = false }
    ok('reflecting long, each channel falls as the edge rises', mono)
}
{
    /* THE MIRROR AGAINST BRUTE FORCE: the logistic integrated over each bin at 0.002 nm (the midpoint rule) against the
       bins' weights. The softplus difference is the bin's exact integral, so the two agree to the brute force's own
       error; a step (width 0, the minimum width) included. */
    const brute = (lo, hi, edge, w) => {
        const s = edgeScale(w), h = 0.002, n = SPEC_STEP / h
        const acc = [0, 0, 0]
        for (let k = 0; k < SPEC_BINS; k++) {
            let m = 0
            for (let j = 0; j < n; j++) m += 1 / (1 + Math.exp(-((SPEC_LO + k * SPEC_STEP + (j + 0.5) * h) - edge) / s))
            m /= n
            for (let i = 0; i < 3; i++) acc[i] += SPEC_WEIGHTS[k][i] * m
        }
        return acc.map(a => lo + (hi - lo) * a)
    }
    let worst = 0
    for (const w of [0, 1, 20, 100]) for (const e of [380, 455.3, 550, 612.7, 780]) worst = Math.max(worst, maxDiff(edgeRGB(0, 1, e, w), brute(0, 1, e, w)))
    ok('edgeRGB is each bin\'s exact mean of the edge, within 1e-5 of brute force', worst < 1e-5, `worst ${worst}`)
    ok('the 10-90 % width: s = width / (2 ln 9), and a width of 0 is SPEC_WIDTH_MIN', near(edgeScale(20), 20 / SPEC_W1090, 1e-15)
        && edgeScale(0) === SPEC_WIDTH_MIN / SPEC_W1090 && near(SPEC_W1090, 4.394449, 1e-6))
    /* WHAT THE BINS COST against the weights unbinned (rgbBar itself, normalised, at 0.01 nm), for a step: the edge
       inside a bin sees the bin's mean weight, not the weight's own shape. Measured here (node, 2026-10-08): 0.0092 at
       worst over every edge from 380 to 780 nm in 0.5 nm steps. A bound, so a change to the bins that makes it worse fails. */
    const tot = [0, 0, 0], h = 0.01
    for (let l = SPEC_LO + h / 2; l < SPEC_LO + SPEC_BINS * SPEC_STEP; l += h) rgbBar(l).forEach((v, i) => tot[i] += v * h)
    const exactStep = edge => {   // reflect long, a true step: the weight above the edge
        const acc = [0, 0, 0]
        for (let l = Math.max(edge, SPEC_LO) + h / 2; l < SPEC_LO + SPEC_BINS * SPEC_STEP; l += h) rgbBar(l).forEach((v, i) => acc[i] += v * h)
        return acc.map((a, i) => a / tot[i])
    }
    let bins = 0
    for (let e = 380; e <= 780; e += 0.5) bins = Math.max(bins, maxDiff(edgeRGB(0, 1, e, 0), exactStep(e)))
    ok('the bins put a step within 0.01 of the unbinned weights, at every edge', bins < 0.01, `worst ${bins}`)
}
{
    // THE ANGLE: the edge's blue shift, n0 sin(theta0) against the stack's effective index
    ok('head-on, the edge is where it was', edgeAt(550, 0, 1.8) === 550)
    ok('at 45 degrees in air through nEff 1.8, edge0 sqrt(1 - (sin 45 / 1.8)^2) = 0.9196 edge0',
       near(edgeAt(550, Math.SQRT1_2, 1.8) / 550, Math.sqrt(1 - 0.5 / 3.24), 1e-12) && near(edgeAt(550, Math.SQRT1_2, 1.8) / 550, 0.9196, 1e-4))
    ok('the invariant at the stack\'s index or past it puts the edge at 0', edgeAt(550, 1.8, 1.8) === 0 && edgeAt(550, 2.5, 1.8) === 0)
    ok('it only ever moves the edge down', [0, 0.3, 0.7, 1, 1.4].every((q, i, a) => i === 0 || edgeAt(600, q, 1.6) <= edgeAt(600, a[i - 1], 1.6)))
}
{
    /* THE SHADER'S ARITHMETIC IN f32 (every operation rounded, as the GPU does it; exp and log rounded once each, which
       is what a correctly rounded function would give -- a GPU's may be a few ulp worse), against the mirror in f64.
       The concern is the softplus difference at a step: its two terms are up to (400 nm / s) ~ 1.8e5 apart from 0, so
       f32 keeps their difference to about 1e-2 of a bin's ~4400; times s / step that is ~2e-6 of reflectance. */
    const r = Math.fround
    const sp32 = x => r(r(Math.max(x, 0)) + r(Math.log(r(1 + r(Math.exp(r(-Math.abs(x))))))))
    const W32 = SPEC_WEIGHTS.map(w => w.map(r))
    const edge32 = (lo, hi, edge, w) => {
        const s = r(r(Math.max(r(w), r(SPEC_WIDTH_MIN))) / r(SPEC_W1090))
        const acc = [0, 0, 0]
        let prev = sp32(r(r(r(SPEC_LO) - r(edge)) / s))
        for (let k = 0; k < SPEC_BINS; k++) {
            const next = sp32(r(r(r(r(SPEC_LO) + r(r(k + 1) * r(SPEC_STEP))) - r(edge)) / s))
            const d = r(next - prev)
            for (let i = 0; i < 3; i++) acc[i] = r(acc[i] + r(W32[k][i] * d))
            prev = next
        }
        return acc.map(a => r(r(lo) + r(r(r(hi) - r(lo)) * r(a * r(s / r(SPEC_STEP))))))
    }
    let worst = 0
    for (const w of [0, 0.5, 20, 100]) for (let e = 380; e <= 780; e += 7.3) worst = Math.max(worst, maxDiff(edge32(0, 1, e, w), edgeRGB(0, 1, e, w)))
    ok('in f32 the reflectance is the mirror\'s within 1e-4, a step included', worst < 1e-4, `worst ${worst}`)
}
{
    // THE WGSL holds the same weights and constants
    const nums = [...SPECTRAL_WGSL.slice(SPECTRAL_WGSL.indexOf('array<vec3<f32>'), SPECTRAL_WGSL.indexOf(');', SPECTRAL_WGSL.indexOf('array<vec3<f32>')))
        .matchAll(/vec3<f32>\(([^)]*)\)/g)].map(m => m[1].split(',').map(Number))
    ok('the WGSL\'s weights are the table\'s, to 9 significant digits', nums.length === SPEC_BINS
        && nums.every((w, k) => w.every((v, i) => near(v, SPEC_WEIGHTS[k][i], 1e-8 * Math.max(1, SPEC_WEIGHTS[k][i])))))
    ok('the WGSL declares the bins and both functions', ['const SPEC_LO: f32 = 380.0;', 'const SPEC_BINS: u32 = 40u;',
        'fn coatEdgeRGB(', 'fn coatEdgeAt('].every(s => SPECTRAL_WGSL.includes(s)))
    ok('no backtick in the WGSL (it would end the template literal)', !SPECTRAL_WGSL.includes('`'))
}

{
    /* DISPERSION: Cauchy through a catalogue's n_d and V_d. Exact at d, and F minus C exact (that is what V_d says); the
       rest Cauchy's shape -- against Schott N-BK7's catalogue, n_d 1.51680, V_d 64.17, n_F 1.52238, n_C 1.51432 */
    ok('n(lambda_d) is n_d', cauchyN(1.5168, 64.17, LAMBDA_D) === 1.5168 || near(cauchyN(1.5168, 64.17, LAMBDA_D), 1.5168, 1e-15))
    ok('(n_d - 1) / (n_F - n_C) is V_d', near((1.75 - 1) / (cauchyN(1.75, 28, LAMBDA_F) - cauchyN(1.75, 28, LAMBDA_C)), 28, 1e-9))
    ok('BK7\'s n_F and n_C within 1e-4 of its catalogue (Cauchy\'s shape: 5e-5 and 6e-5 measured here)',
        near(cauchyN(1.5168, 64.17, LAMBDA_F), 1.52238, 1e-4) && near(cauchyN(1.5168, 64.17, LAMBDA_C), 1.51432, 1e-4),
        `${cauchyN(1.5168, 64.17, LAMBDA_F)} ${cauchyN(1.5168, 64.17, LAMBDA_C)}`)
    ok('blue bends more: n falls with the wavelength', [400, 450, 500, 600, 700, 780].every((l, i, a) => i === 0 || cauchyN(1.6, 40, l) < cauchyN(1.6, 40, a[i - 1])))
    ok('Abbe 0 is no dispersion: n_d everywhere', [380, 587.56, 780].every(l => cauchyN(1.5, 0, l) === 1.5))
    // THE DRAW: each bin by the channels' summed weights; a wavelength's weight per channel W_c / P, mean exactly 1
    ok('the draw\'s bins sum to 1', near(SPEC_PICK.reduce((a, b) => a + b, 0), 1, 1e-12))
    const E = [0, 0, 0]
    for (let k = 0; k < SPEC_BINS; k++) if (SPEC_PICK[k] > 0) specDraw(SPEC_PICK.slice(0, k).reduce((a, b) => a + b, 0) + SPEC_PICK[k] / 2).w
        .forEach((v, c) => E[c] += SPEC_PICK[k] * v)
    ok('the mean weight is exactly 1 in every channel (each bin times its probability)', E.every(v => near(v, 1, 1e-12)), E.join(' '))
    let big = 0, inBin = true
    for (let i = 0; i < 20000; i++) {
        const d = specDraw((i + 0.5) / 20000)
        big = Math.max(big, ...d.w)
        if (!(d.lambda >= SPEC_LO + d.k * SPEC_STEP && d.lambda <= SPEC_LO + (d.k + 1) * SPEC_STEP)) inBin = false
    }
    ok('no weight above 3, each wavelength inside its bin', big <= 3 + 1e-12 && inBin, `${big}`)
    // THE WAVELENGTH IN A TAG: 0 none, 0.012 nm a step (15 bits since 0.44.0), the ends held
    ok('a wavelength in the tag\'s code, back within half a step (0.0061 nm)', [380, 412.345, 550, 699.999, 780].every(l => Math.abs(lambdaOf(lambdaCode(l)) - l) <= 400 / 32766 / 2 + 1e-9))
    ok('...code 0 is none, the ends 1 and 32767, outside clamped', lambdaOf(0) === 0 && lambdaCode(380) === 1 && lambdaCode(780) === 32767
        && lambdaCode(200) === 1 && lambdaCode(900) === 32767)
    ok('the WGSL has the dispersion: cauchyN, specDraw, the tag\'s wavelength', ['fn cauchyN(', 'fn specDraw(', 'fn rayLambda(', 'fn withLambda(',
        'fn lambdaCoded(', 'const SPEC_PICK = array<f32, 40>('].every(t => SPECTRAL_WGSL.includes(t)))
}

console.log(`${fail ? 'FAILED' : 'ok'}: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
