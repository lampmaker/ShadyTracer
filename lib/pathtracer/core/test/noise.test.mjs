// node lib/pathtracer/core/test/noise.test.mjs
//
// THE NOISE LIBRARY'S PROMISES, without a GPU (core/noise.js, through its JS mirror): the analytic
// gradients are the gradients; the noises are continuous across cell faces; every Lipschitz bound the
// file states holds under a dense search for the steepest point -- the proved ones, and the MEASURED
// one, which this test is the measurement of; Worley's 27-cell search finds what a 125-cell brute
// force finds; and nothing depends on anything but position and seed.
import { NOISE, vnoise3, gnoise3, fbm3, nzFbmLip, worley3, worley3x, NZ_VALUE_LIP, NZ_GRAD_LIP, NZ_GRAD_LIP_MEASURED, NZ_RELIEF_LIP_MEASURED,
         NZ_GRAD_SCALE, NZ_GRAD_VALUE_BOUND, NZ_JITTER, NZ_X_A, NZ_X_B, NZ_X_TURN } from '../noise.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const info = s => console.log(`      ${s}`)
let rng = 0x2545f491
const rnd = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296 }
const rp = (s = 40) => [rnd() * 2 * s - s, rnd() * 2 * s - s, rnd() * 2 * s - s]
const len = v => Math.hypot(v[0], v[1], v[2])

const NOISES = {
    vnoise3: p => vnoise3(p, 3),
    gnoise3: p => gnoise3(p, 3),
    fbm3: p => fbm3(p, 3, 5, 2.0, 0.5),
}

// 1. THE GRADIENTS ARE THE GRADIENTS: central differences agree with the analytic ones
for (const [name, n] of Object.entries(NOISES)) {
    let worst = 0
    const h = 1e-5
    for (let t = 0; t < 3000; t++) {
        const p = rp(), a = n(p)
        for (let k = 0; k < 3; k++) {
            const q1 = p.slice(), q0 = p.slice(); q1[k] += h; q0[k] -= h
            const fd = (n(q1)[3] - n(q0)[3]) / (2 * h)
            worst = Math.max(worst, Math.abs(fd - a[k]))
        }
    }
    ok(`${name}: the analytic gradient matches differences`, worst < 1e-4, `worst difference ${worst}`)
}

// 2. CONTINUOUS ACROSS CELL FACES: a crease there would be a seam in a bump and a step in a displaced SDF
for (const [name, n] of Object.entries(NOISES)) {
    let worst = 0
    for (let t = 0; t < 3000; t++) {
        const p = rp(), k = t % 3
        const a = p.slice(), b = p.slice()
        a[k] = Math.floor(p[k]) - 1e-9; b[k] = Math.floor(p[k]) + 1e-9
        worst = Math.max(worst, Math.abs(n(a)[3] - n(b)[3]))
    }
    ok(`${name}: continuous across cell faces`, worst < 1e-6, `worst jump ${worst}`)
}

// 3. RANGES
{
    let lo = Infinity, hi = -Infinity, glo = Infinity, ghi = -Infinity
    for (let t = 0; t < 200000; t++) {
        const p = rp()
        const v = vnoise3(p, 3)[3], g = gnoise3(p, 3)[3]
        lo = Math.min(lo, v); hi = Math.max(hi, v); glo = Math.min(glo, g); ghi = Math.max(ghi, g)
    }
    ok('vnoise3 stays in [-1, 1]', lo >= -1 && hi <= 1, `${lo} .. ${hi}`)
    // a corner's term is at most |f - c| <= sqrt 3, and the weights are a convex mix
    ok('gnoise3 stays within +-scale sqrt 3', glo >= -NZ_GRAD_SCALE * Math.sqrt(3) && ghi <= NZ_GRAD_SCALE * Math.sqrt(3), `${glo} .. ${ghi}`)
    ok('...and spans about [-1, 1], which is what its scale is for', ghi > 0.85 && glo < -0.85 && ghi < 1.25 && glo > -1.25, `${glo} .. ${ghi}`)
    info(`gnoise3 range found: ${glo.toFixed(3)} .. ${ghi.toFixed(3)}`)
}

// 3b. THE PROVED VALUE BOUND (noise.js NZ_GRAD_VALUE_BOUND), which the relief's shell rests on. Its one step
//     that is not algebra -- h(t) = (1 - s) t^2 + s (1 - t)^2 at most 1/4 -- checked densely; then the bound
//     against a scatter and a climb toward the largest |n|, and fbm3 against the bound times its amplitudes.
//     WITH A GENERATOR OF ITS OWN: sharing the one above moved every later search's starting points, and the
//     Lipschitz search below then found a different steepest slope (3.581 against 3.437) -- the checks after
//     this one must see the points they always saw.
{
    let rng = 0x6d2b79f5
    const rnd = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296 }
    const rp = (s = 40) => [rnd() * 2 * s - s, rnd() * 2 * s - s, rnd() * 2 * s - s]
    const s = t => t * t * t * (t * (t * 6 - 15) + 10)
    let hmax = 0
    for (let i = 0; i <= 200000; i++) { const t = i / 200000; hmax = Math.max(hmax, (1 - s(t)) * t * t + s(t) * (1 - t) * (1 - t)) }
    ok('h(t) = (1 - s) t^2 + s (1 - t)^2 peaks at 1/4 (the proof\'s one numeric step)', Math.abs(hmax - 0.25) < 1e-12, `${hmax}`)
    ok('NZ_GRAD_VALUE_BOUND is scale * sqrt(3 * 1/4)', Math.abs(NZ_GRAD_VALUE_BOUND - NZ_GRAD_SCALE * Math.sqrt(0.75)) < 1e-12)
    // a scatter, then a climb on |n| from the largest hundred
    const v = (p, seed) => Math.abs(gnoise3(p, seed)[3])
    let worst = 0
    for (const seed of [3, 17, 91]) {
        const seeds = []
        for (let t = 0; t < 10000; t++) { const p = rp(); seeds.push([v(p, seed), p]) }
        seeds.sort((a, b) => b[0] - a[0])
        for (const [, p0] of seeds.slice(0, 40)) {
            let p = p0, cur = v(p, seed), step = 0.05
            for (let it = 0; it < 200 && step > 1e-6; it++) {
                let moved = false
                for (let k = 0; k < 3; k++) for (const sg of [1, -1]) {
                    const q = p.slice(); q[k] += sg * step
                    const c = v(q, seed)
                    if (c > cur) { cur = c; p = q; moved = true }
                }
                if (!moved) step /= 2
            }
            worst = Math.max(worst, cur)
        }
    }
    ok('gnoise3: the largest |n| a climb finds is within the proved bound', worst <= NZ_GRAD_VALUE_BOUND, `${worst} > ${NZ_GRAD_VALUE_BOUND}`)
    info(`gnoise3 largest |n| found ${worst.toFixed(3)}, proved bound ${NZ_GRAD_VALUE_BOUND.toFixed(3)}`)
    let fw = 0
    for (let t = 0; t < 20000; t++) fw = Math.max(fw, Math.abs(fbm3(rp(), 1, 4, 2.0, 0.5)[3]))
    ok('fbm3 (the relief\'s: 4 octaves, x2, 0.5): within the bound times its amplitudes summed', fw <= NZ_GRAD_VALUE_BOUND * nzFbmLip(4, 1.0, 0.5, 1.0), `${fw}`)
}

// 4. THE BOUNDS. A random scatter, then gradient ascent on |grad n| from the steepest hundred: a
//    steep spot a scatter misses, the climb finds. The measured bound must hold with room to spare.
function steepest(n, samples, radius = 40) {
    const g = p => len(n(p))
    const seeds = []
    for (let t = 0; t < samples; t++) { const p = rp(radius); seeds.push([g(p), p]) }
    seeds.sort((a, b) => b[0] - a[0])
    let best = seeds[0][0]
    for (const [, p0] of seeds.slice(0, 100)) {
        let p = p0.slice(), cur = g(p), step = 0.05
        for (let it = 0; it < 200 && step > 1e-5; it++) {
            let moved = false
            for (let k = 0; k < 3; k++) for (const s of [1, -1]) {
                const q = p.slice(); q[k] += s * step
                const v = g(q)
                if (v > cur) { cur = v; p = q; moved = true }
            }
            if (!moved) step *= 0.5
        }
        best = Math.max(best, cur)
    }
    return best
}
{
    const v = steepest(p => vnoise3(p, 3).slice(0, 3), 60000)
    ok('vnoise3: steepest found is within the proved bound', v <= NZ_VALUE_LIP, `${v} > ${NZ_VALUE_LIP}`)
    info(`vnoise3 steepest ${v.toFixed(3)}, proved bound ${NZ_VALUE_LIP.toFixed(3)}`)
    let g = 0
    for (const seed of [3, 17, 91]) g = Math.max(g, steepest(p => gnoise3(p, seed).slice(0, 3), 60000))
    ok('gnoise3: steepest found is within the proved bound', g <= NZ_GRAD_LIP, `${g} > ${NZ_GRAD_LIP}`)
    /* ONE OCTAVE: within the measured bound, with no margin claimed. This asserted 25% to spare, which held only
       for these starting points (3.437 x 1.25 = 4.296): from others the search found 3.581, and a search of seven
       million cells 3.854 (noise.js GRAD_MEASURED). */
    ok('gnoise3: steepest found is within the MEASURED bound', g <= NZ_GRAD_LIP_MEASURED, `steepest ${g.toFixed(4)} > ${NZ_GRAD_LIP_MEASURED}`)
    ok('...and the measured bound is below the proved one, or it is pointless', NZ_GRAD_LIP_MEASURED < NZ_GRAD_LIP)
    info(`gnoise3 steepest ${g.toFixed(3)}, measured bound ${NZ_GRAD_LIP_MEASURED}, proved ${NZ_GRAD_LIP.toFixed(3)}`)
    /* THE MARGIN WHERE THE BOUND IS USED: the relief (builder/modifiers.js) marches fbm3(p, 1, 4 octaves, x2, 0.5)
       and divides by nzFbmLip over those four octaves -- its one user. 25% to spare there, or the relief can step
       through its own surface. */
    const f = steepest(p => fbm3(p, 1, 4, 2.0, 0.5).slice(0, 3), 40000)
    const fb = nzFbmLip(4, 2.0, 0.5, NZ_GRAD_LIP_MEASURED)
    ok('the relief\'s fbm3 (seed 1, 4 octaves, x2, 0.5): steepest found within its step bound, with 25% to spare',
        f * 1.25 <= fb, `steepest ${f.toFixed(3)}: the bound must be at least ${(f * 1.25).toFixed(3)}, is ${fb.toFixed(3)}`)
    info(`the relief's fbm3 steepest ${f.toFixed(3)}, its bound nzFbmLip ${fb.toFixed(3)}`)
    /* ...and the bound MEASURED for that fBm itself (noise.js NZ_RELIEF_LIP_MEASURED, the benchmark's row): the
       same search, the same 25% to spare, and below the octave sum it replaces or it is pointless */
    ok('the relief\'s fbm3: steepest found within NZ_RELIEF_LIP_MEASURED, with 25% to spare',
        f * 1.25 <= NZ_RELIEF_LIP_MEASURED, `steepest ${f.toFixed(3)}: the bound must be at least ${(f * 1.25).toFixed(3)}, is ${NZ_RELIEF_LIP_MEASURED}`)
    ok('...and below the octave sum it replaces', NZ_RELIEF_LIP_MEASURED < fb)
    ok('nzFbmLip sums the octaves', Math.abs(nzFbmLip(3, 2, 0.5, 1) - 3) < 1e-12 && Math.abs(nzFbmLip(3, 2, 0.25, 1) - 1.75) < 1e-12)
}

// 5. WORLEY: the kernel's 27 cells find what 125 find
{
    let f1bad = 0, f2bad = 0, order = 0, ids = 0
    const N = 100000
    for (let t = 0; t < N; t++) {
        const p = rp(), a = worley3(p, 5), b = worley3(p, 5, 2)
        if (Math.abs(a[0] - b[0]) > 1e-12) f1bad++
        if (Math.abs(a[1] - b[1]) > 1e-12) f2bad++
        if (!(a[0] <= a[1])) order++
        if (!(a[2] >= 0 && a[2] < 1 && a[3] >= 0 && a[3] < 1)) ids++
    }
    ok(`worley3 F1 is the true nearest (jitter ${NZ_JITTER}, proved)`, f1bad === 0, `${f1bad} of ${N} differ from the 125-cell search`)
    ok('worley3 F2 is the true second nearest', f2bad === 0, `${f2bad} of ${N} differ`)
    ok('F1 <= F2, and the ids are in [0, 1)', order === 0 && ids === 0)
    // 1-Lipschitz, which is what lets it be a distance
    let worst = 0
    for (let t = 0; t < 50000; t++) {
        const p = rp(), q = p.map(x => x + (rnd() - 0.5) * 0.2)
        const d = len(p.map((x, k) => x - q[k]))
        const a = worley3(p, 5), b = worley3(q, 5)
        worst = Math.max(worst, Math.abs(a[0] - b[0]) / d, Math.abs(a[1] - b[1]) / d)
    }
    ok('F1 and F2 are 1-Lipschitz', worst <= 1 + 1e-9, `ratio ${worst}`)
}

// 5b. WORLEY3X: two point sets crossed. Checked against the same sets searched over 125 cells each and their
//     four distances SORTED -- another way to the same answer than the kernel's branches
{
    const T = NZ_X_TURN
    const cols = [0, 1, 2].map(i => [T[i][0], T[i][1], T[i][2]])
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    ok('the turn is a rotation (orthonormal, not a mirror)', cols.every((c, i) => cols.every((d, j) => Math.abs(dot(c, d) - (i === j ? 1 : 0)) < 1e-12))
        && Math.abs(dot(cols[0], [cols[1][1] * cols[2][2] - cols[1][2] * cols[2][1], cols[1][2] * cols[2][0] - cols[1][0] * cols[2][2], cols[1][0] * cols[2][1] - cols[1][1] * cols[2][0]]) - 1) < 1e-12)
    ok('one point per unit volume between them, as worley3 has, so a size means the same', Math.abs(1 / NZ_X_A ** 3 + 1 / NZ_X_B ** 3 - 1) < 1e-12)
    let bad = 0, order = 0, ids = 0, fromB = 0
    const N = 40000
    for (let t = 0; t < N; t++) {
        const p = rp(), w = worley3x(p, 5)
        const turned = [0, 1, 2].map(i => T[0][i] * p[0] + T[1][i] * p[1] + T[2][i] * p[2])
        const a = worley3(p.map(x => x / NZ_X_A), 5, 2), b = worley3(turned.map(x => x / NZ_X_B), 5 + 1013, 2)
        const four = [[a[0] * NZ_X_A, a[2]], [a[1] * NZ_X_A, a[3]], [b[0] * NZ_X_B, b[2]], [b[1] * NZ_X_B, b[3]]].sort((x, y) => x[0] - y[0])
        if (Math.abs(w[0] - four[0][0]) > 1e-12 || Math.abs(w[1] - four[1][0]) > 1e-12 || w[2] !== four[0][1] || w[3] !== four[1][1]) bad++
        if (!(w[0] <= w[1])) order++
        if (!(w[2] >= 0 && w[2] < 1 && w[3] >= 0 && w[3] < 1)) ids++
        if (b[0] * NZ_X_B < a[0] * NZ_X_A) fromB++
    }
    ok('worley3x: F1, F2 and both ids are the nearest two of both sets', bad === 0, `${bad} of ${N} differ`)
    ok('...F1 <= F2, the ids in [0, 1)', order === 0 && ids === 0)
    const share = fromB / N
    ok('...and both sets take part, the smaller-celled one about its share of the points', share > 0.2 && share < 0.4, `${share}`)
    info(`worley3x: the turned set is nearest at ${(share * 100).toFixed(1)}% of points (it has ${(100 / NZ_X_B ** 3).toFixed(1)}% of them)`)
    let worst = 0
    for (let t = 0; t < 30000; t++) {
        const p = rp(), q = p.map(x => x + (rnd() - 0.5) * 0.2)
        const d = len(p.map((x, k) => x - q[k]))
        const a = worley3x(p, 5), b = worley3x(q, 5)
        worst = Math.max(worst, Math.abs(a[0] - b[0]) / d, Math.abs(a[1] - b[1]) / d)
    }
    ok('worley3x F1 and F2 are 1-Lipschitz, as worley3\'s: an SDF can use it on the same bounds', worst <= 1 + 1e-9, `ratio ${worst}`)
    ok('...and the WGSL has it, turned by the same rotation', NOISE.includes('fn worley3x(') && NOISE.includes(`mat3x3<f32>(${T.flat().map(x => x.toFixed(2)).join(', ')})`))
}

// 6. NO LOOP THE COMPILER CAN UNROLL: each for-loop's bound goes through noUnroll, a uniform the compiler
//    cannot see. Inlined into an SDF the march loop is unrolled over, an unrolled noise made a scene
//    compile for over a minute (noise.js says so where noUnroll is).
{
    const loops = NOISE.match(/for \([^)]*\)/g) || []
    const bad = loops.filter(l => !/<\s*noUnroll\(/.test(l))
    ok('every loop in the noise WGSL has an opaque bound (noUnroll)', loops.length >= 5 && bad.length === 0,
        `${loops.length} loops; not through noUnroll: ${bad.join(' | ')}`)
    ok('...and no corner is written out by hand', !/e\.xyy|e\.xxx/.test(NOISE))
}

// 7. DETERMINISTIC, and the seed matters
{
    const p = [1.3, -2.7, 5.1]
    ok('the same point and seed give the same value', gnoise3(p, 9)[3] === gnoise3(p, 9)[3] && worley3(p, 9)[0] === worley3(p, 9)[0])
    ok('a different seed gives a different field', gnoise3(p, 9)[3] !== gnoise3(p, 10)[3])
    ok('negative cells hash like any other (no mirror symmetry about 0)',
        Math.abs(vnoise3([0.3, 0.4, 0.5], 1)[3] - vnoise3([-0.3, -0.4, -0.5], 1)[3]) > 1e-6)
}

console.log(fail ? `noise: ${pass} passed, ${fail} FAILED` : `noise: ${pass} passed, 0 failed`)
process.exit(fail ? 1 : 0)
