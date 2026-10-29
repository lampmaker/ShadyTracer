// node lib/pathtracer/core/test/spectralnoise.test.mjs
//
// WHICH SPECTRAL RAY -- the numbers before one is built (roadmap/PLAN.md C, *the spectral ray*). The user asked
// (2026-10-29) for spectral light sources and phosphor conversion, and whether a ray carrying N colour bands instead of
// one wavelength is the way: one wavelength a ray is colour noise everywhere. Three ways a ray can carry a spectrum
// are compared here on an LED's light, before any of them goes into the kernels:
//
//   ONE WAVELENGTH a path, drawn by p(lambda) ~ x-bar + y-bar + z-bar (what dispersion does today, spectral.js
//     specDraw, but for the clipped Rec.709 weights): unbiased, the most noise.
//   HERO WAVELENGTHS, four a path (Wilkie et al. 2014): one drawn, three riding with it at fixed spacing, so every
//     path sees the whole spectrum at four places. Two ways: Wilkie's, the hero uniform in lambda and the others
//     100 nm on (wrapping in 380-780); and pbrt-v4's, the four stratified in p's CDF (u, u + 1/4, u + 1/2, u + 3/4).
//     Unbiased.
//   N FIXED BANDS, 8, 16 and 40 of 380-780 nm: every path carries every band, so no wavelength noise -- and a bias,
//     because a filter is flat within a band. A light carries its own XYZ per band (the integral of its spectrum
//     times the CMFs over the band), so neutral optics are exact at any N.
//   And TODAY'S RGB: a light its exact XYZ as Rec.709 RGB, a filter averaged per channel against the channels'
//     wavelength weights (spectral.js SPEC_WEIGHTS: what coatEdgeRGB does) -- exact through neutral optics, a bias
//     through a filter.
//
// WHAT IS COMPUTED, AND WHY IT NEEDS NO GPU. The noise a path's wavelength draw adds is a property of the estimator,
// not of the hardware: it is the variance of one path's XYZ over the draw, with the geometry held fixed. So it is
// computed here EXACTLY, by summing over every draw (0.1 nm cells, 4000 of them; for the stratified draws, every
// interval of u in which the four cells stay the same), not sampled -- and a seeded Monte Carlo run of three of them
// checks the sums. Speed is not measured here and could not be (CLAUDE.md): what a wider ray costs is the user's card's
// to say. What is reported, per case and way:
//   - sigma_Y / Y and sigma_u'v' of ONE path (the colour's by the delta method, through u'v''s Jacobian at the true
//     XYZ), and the paths a reading needs before its standard error is 0.001 u'v' (about one MacAdam step) and 1 % of
//     Y -- to set beside a pixel's hundreds of paths, whose geometry is noisy anyway;
//   - for the deterministic ways, the bias: Delta Y in % and Delta u'v' against the 0.1 nm integral.
//
// THE CASES, an LED and what light meets on the way (spectra below; shapes, not a datasheet's -- what matters is a
// narrow blue pump, a broad phosphor and filters with an edge):
//   neutral       a white LED through a grey 0.92: every way but the sampled ones must be exact;
//   dichroic      ...through a long-pass edge at 500 nm, 10 nm wide (the blue reflected away);
//   amber         ...through a smooth amber filter (an edge at 585 nm, 80 nm wide);
//   gather        ...a dichroic on the photon's side and a cyan glass on the camera's: two filters met by two paths,
//                 what the photon map multiplies at a gather. The sampled ways need the photon's wavelengths to be
//                 the camera path's here (one draw a sample shared by both); drawn apart, they cannot be multiplied
//                 at all -- the reason the photon map is the open question for hero wavelengths (PLAN.md C);
//   phosphor      a blue pump through a phosphor layer: absorbed by A(lambda), re-emitted with quantum efficiency QE
//                 into the phosphor's own spectrum (Kasha's rule: whatever blue pumped it), the rest of the blue
//                 passing. The emitted photons are the absorbed ones times QE, so the energy out is the absorbed
//                 photon count times the emission's mean photon energy (the Stokes loss). The sampled ways draw the
//                 pump's wavelengths by A (all the layer knows; Wilkie's uniform, as its camera wavelengths) and the
//                 emission's by the camera's draw; the four hero wavelengths collapse into one absorbed count. Bands
//                 take A as its mean over the band and a photon's energy at the band's centre, which is all a ray
//                 carrying band powers knows -- the first is nearly all of their bias here (A sloping across a band
//                 under a 20 nm pump), the second a few tenths of a % (a scratch run, 2026-10-29). RGB has no way to
//                 do this at all.
//
// It asserts what the arithmetic guarantees (every sampled way's mean the integral, neutral optics exact by bands and
// RGB, the sums against Monte Carlo, the Jacobian) and prints the table; the table is the answer, in PLAN.md C.
import { cmf, SPEC_WEIGHTS, SPEC_LO, SPEC_STEP, SPEC_BINS, edgeScale } from '../spectral.js'
import { XYZtoRGB, rgbToXYZ, XYZtoxy, xyToUpVp, xyToCctDuv } from '../colorimetry.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}

// ---- THE GRID: 0.1 nm cells over 380-780 nm, every spectrum and every draw on it ----
const D = 0.1, SPAN = SPEC_BINS * SPEC_STEP, K = Math.round(SPAN / D)
const LAM = Float64Array.from({ length: K }, (_, i) => SPEC_LO + (i + 0.5) * D)
const CMF = Array.from(LAM, l => cmf(l))
const spec = f => Float64Array.from(LAM, f)
const times = (...s) => spec((_, i) => s.reduce((a, x) => a * x[i], 1))

// ---- THE SPECTRA ----
const pg = (l, mu, s1, s2) => { const t = (l - mu) / (l < mu ? s1 : s2); return Math.exp(-0.5 * t * t) }
const FWHM = 2 * Math.sqrt(2 * Math.log(2))
const PUMP = spec(l => pg(l, 450, 20 / FWHM, 20 / FWHM))       // a blue die: 450 nm, 20 nm FWHM
const EMIT = spec(l => pg(l, 555, 45, 65))                       // a YAG-like phosphor's emission, energy, a long red tail
const LED = spec((_, i) => PUMP[i] + 0.55 * EMIT[i])             // a white LED: the two in proportion
const logistic = (l, edge, width) => 1 / (1 + Math.exp(-(l - edge) / edgeScale(width)))
const GREY = spec(() => 0.92)
const DICHROIC = spec(l => logistic(l, 500, 10))
const AMBER = spec(l => 0.05 + 0.85 * logistic(l, 585, 80))
const CYAN = spec(l => 0.1 + 0.8 * Math.exp(-(((l - 520) / 60) ** 2)))
const ABS = spec(l => 0.9 * pg(l, 455, 25, 20))                 // the phosphor's absorption
const QE = 0.9

// ---- XYZ, u'v' and its Jacobian ----
const add = (a, b) => a.map((v, i) => v + b[i])
const scale = (a, s) => a.map(v => v * s)
const integral = S => S.reduce((acc, s, i) => add(acc, scale(CMF[i], s * D)), [0, 0, 0])
const upvp = xyz => xyToUpVp(...XYZtoxy(xyz))
/** d(u', v') / d(X, Y, Z): u' = 4X / den, v' = 9Y / den, den = X + 15Y + 3Z. */
function jac([X, Y, Z]) {
    const d = X + 15 * Y + 3 * Z, d2 = d * d
    return [[4 / d - 4 * X / d2, -60 * X / d2, -12 * X / d2],
            [-9 * Y / d2, 9 / d - 135 * Y / d2, -27 * Y / d2]]
}
/** One path's sigma_u'v' from its XYZ covariance: the delta method, u' and v' summed. */
const sigmaUv = (cov, xyz) => {
    const J = jac(xyz)
    let v = 0
    for (const r of J) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) v += r[a] * cov[a][b] * r[b]
    return Math.sqrt(v)
}

// ---- THE DRAWS, each a list of { w: probability, cells: the k cells a path's wavelengths fall in } ----
const pdf = w => { const s = w.reduce((a, v) => a + v, 0); return Float64Array.from(w, v => v / s) }
const cdfOf = p => { const c = new Float64Array(K + 1); for (let i = 0; i < K; i++) c[i + 1] = c[i] + p[i]; c[K] = 1; return c }
/** The cell u falls in under a CDF (binary search; a cell of probability 0 is never returned). */
function cellOf(c, u) {
    let lo = 0, hi = K - 1
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (c[m] <= u) lo = m; else hi = m - 1 }
    return lo
}
const P_CMF = pdf(CMF.map(c => c[0] + c[1] + c[2]))
const P_UNI = pdf(new Float64Array(K).fill(1))
/** One wavelength by p. */
const drawOne = p => ({ p, k: 1, entries: Array.from(p, (w, i) => ({ w, cells: [i] })).filter(e => e.w > 0) })
/** Wilkie's hero: uniform in lambda, the others SPAN / 4 on, wrapping. */
const drawHeroRot = () => ({ p: P_UNI, k: 4, entries: Array.from({ length: K / 4 }, (_, i) => ({ w: 4 / K, cells: [0, 1, 2, 3].map(j => i + j * K / 4) })) })
/** pbrt-v4's: four stratified in p's CDF -- u, u + 1/4, u + 1/2, u + 3/4 (mod 1); every interval of u in [0, 1/4) in
 *  which none of the four changes cell, summed exactly. */
function drawHeroCdf(p) {
    const c = cdfOf(p)
    const cuts = [0, 0.25]
    for (let i = 1; i < K; i++) cuts.push(c[i] % 0.25)
    cuts.sort((a, b) => a - b)
    const entries = []
    for (let j = 0; j + 1 < cuts.length; j++) {
        const a = cuts[j], b = cuts[j + 1]
        if (!(b - a > 1e-15)) continue
        const m = 0.5 * (a + b)
        entries.push({ w: (b - a) * 4, cells: [0, 1, 2, 3].map(s => cellOf(c, m + s * 0.25)) })
    }
    return { p, k: 4, entries }
}

/** A path's estimate under a draw for per-cell contributions h (each a vector, the cell's share of the integral): the
 *  mean over its k wavelengths of h / p. One row per entry. */
const estimates = (draw, h) => draw.entries.map(e => e.cells.reduce((acc, i) => add(acc, scale(h[i], 1 / (draw.k * draw.p[i]))), h[0].map(() => 0)))
/** E[G1 G2^T] over the draw. */
function cross(draw, G1, G2) {
    const d1 = G1[0].length, d2 = G2[0].length
    const M = Array.from({ length: d1 }, () => new Array(d2).fill(0))
    draw.entries.forEach((e, n) => { for (let a = 0; a < d1; a++) for (let b = 0; b < d2; b++) M[a][b] += e.w * G1[n][a] * G2[n][b] })
    return M
}
const meanOf = (draw, G) => draw.entries.reduce((acc, e, n) => add(acc, scale(G[n], e.w)), G[0].map(() => 0))
const covOf = (second, mean) => second.map((r, a) => r.map((v, b) => v - mean[a] * mean[b]))
const madd = (A, B, s = 1) => A.map((r, a) => r.map((v, b) => v + s * B[a][b]))

// ---- THE DETERMINISTIC WAYS ----
/** N bands: a light's XYZ per band exactly, each filter its mean over the band, multiplied. */
function bandsLinear(S, filters, N) {
    const per = K / N
    let xyz = [0, 0, 0]
    for (let b = 0; b < N; b++) {
        let lightXYZ = [0, 0, 0]
        for (let i = b * per; i < (b + 1) * per; i++) lightXYZ = add(lightXYZ, scale(CMF[i], S[i] * D))
        const t = filters.reduce((acc, T) => { let s = 0; for (let i = b * per; i < (b + 1) * per; i++) s += T[i]; return acc * s / per }, 1)
        xyz = add(xyz, scale(lightXYZ, t))
    }
    return xyz
}
/** Today's RGB: the light's exact XYZ as Rec.709, each filter averaged per channel against SPEC_WEIGHTS over its
 *  10 nm bins' means (spectral.js edgeRGB's arithmetic for any filter), multiplied channel by channel. */
function rgbLinear(S, filters) {
    const per = Math.round(SPEC_STEP / D)
    let rgb = XYZtoRGB(integral(S))
    for (const T of filters) {
        const t = [0, 0, 0]
        for (let k = 0; k < SPEC_BINS; k++) {
            let m = 0
            for (let i = k * per; i < (k + 1) * per; i++) m += T[i] / per
            for (let c = 0; c < 3; c++) t[c] += SPEC_WEIGHTS[k][c] * m
        }
        rgb = rgb.map((v, c) => v * t[c])
    }
    return rgbToXYZ(rgb)
}

// ---- THE PHOSPHOR: out(l) = S(l) (1 - A(l)) + QE N' EMIT(l) / LE, N' = int S A l dl (photons, times hc), LE = int EMIT l dl ----
const N_ABS = PUMP.reduce((a, s, i) => a + s * ABS[i] * LAM[i] * D, 0)
const L_EMIT = EMIT.reduce((a, e, i) => a + e * LAM[i] * D, 0)
const C_EMIT = QE / L_EMIT
const H_PASS = Array.from(LAM, (_, i) => scale(CMF[i], PUMP[i] * (1 - ABS[i]) * D))   // the pump passing, per cell
const H_EMIT = Array.from(LAM, (_, i) => scale(CMF[i], EMIT[i] * D))                  // the emission's shape, per cell
const H_ABS = Array.from(LAM, (_, i) => [PUMP[i] * ABS[i] * LAM[i] * D])               // the absorbed photons, per cell
const PHOS_REF = add(H_PASS.reduce(add), scale(H_EMIT.reduce(add), C_EMIT * N_ABS))
const P_ABS = pdf(ABS)
/** A sampled way through the layer: the camera's wavelengths by `draw`, the pump's by `drawIn` (on A), independent:
 *  g = Gpass(u) + C N^(v) Gemit(u), so E[g g^T] = E[Gp Gp^T] + C N' (E[Gp Ge^T] + E[Ge Gp^T]) + C^2 E[N^2] E[Ge Ge^T]. */
function phosphorMoments(draw, drawIn) {
    const Gp = estimates(draw, H_PASS), Ge = estimates(draw, H_EMIT), Gn = estimates(drawIn, H_ABS)
    const n1 = meanOf(drawIn, Gn)[0], n2 = cross(drawIn, Gn, Gn)[0][0]
    const mean = add(meanOf(draw, Gp), scale(meanOf(draw, Ge), C_EMIT * n1))
    let second = cross(draw, Gp, Gp)
    second = madd(second, cross(draw, Gp, Ge), C_EMIT * n1)
    second = madd(second, cross(draw, Ge, Gp), C_EMIT * n1)
    second = madd(second, cross(draw, Ge, Ge), C_EMIT * C_EMIT * n2)
    return { mean, cov: covOf(second, mean) }
}
function bandsPhosphor(N) {
    const per = K / N
    let pass = [0, 0, 0], n = 0
    for (let b = 0; b < N; b++) {
        let lightXYZ = [0, 0, 0], power = 0, a = 0
        for (let i = b * per; i < (b + 1) * per; i++) { lightXYZ = add(lightXYZ, scale(CMF[i], PUMP[i] * D)); power += PUMP[i] * D; a += ABS[i] / per }
        pass = add(pass, scale(lightXYZ, 1 - a))
        n += a * power * (SPEC_LO + (b + 0.5) * per * D)      // the band's absorbed power as photons at its centre
    }
    return add(pass, scale(H_EMIT.reduce(add), C_EMIT * n))
}

// ---- THE CASES ----
const CASES = [
    { name: 'neutral', S: LED, filters: [GREY] },
    { name: 'dichroic', S: LED, filters: [DICHROIC] },
    { name: 'amber', S: LED, filters: [AMBER] },
    { name: 'gather', S: LED, filters: [DICHROIC, CYAN] },
    { name: 'phosphor', phosphor: true },
]
const DRAWS = [
    ['1 lambda', drawOne(P_CMF), drawOne(P_ABS)],
    ['hero 4, Wilkie', drawHeroRot(), drawHeroRot()],
    ['hero 4, pbrt-v4', drawHeroCdf(P_CMF), drawHeroCdf(P_ABS)],
]

{
    // the draws are distributions, and the stratified one's every wavelength has p's marginal
    for (const [name, d, dIn] of DRAWS) for (const x of [d, dIn]) ok(`${name}: its probabilities sum to 1`, Math.abs(x.entries.reduce((a, e) => a + e.w, 0) - 1) < 1e-9)
    const hc = DRAWS[2][1], marg = new Float64Array(K)
    for (const e of hc.entries) for (const i of e.cells) marg[i] += e.w / 4
    ok('pbrt-v4\'s four: each cell drawn with p\'s probability', marg.every((m, i) => Math.abs(m - P_CMF[i]) < 1e-12 + 1e-9 * P_CMF[i]))
    // the Jacobian against finite differences
    const x = integral(LED), J = jac(x), h = 1e-6
    let worst = 0
    for (let a = 0; a < 3; a++) {
        const xp = x.slice(), xm = x.slice(); xp[a] += h; xm[a] -= h
        const fp = upvp(xp), fm = upvp(xm)
        for (let r = 0; r < 2; r++) worst = Math.max(worst, Math.abs((fp[r] - fm[r]) / (2 * h) - J[r][a]))
    }
    ok('the Jacobian of u\'v\' is its finite difference within 1e-7', worst < 1e-7, `off ${worst}`)
}

const rows = []
const fmt = (v, d = 3) => v === null ? '-' : v === 0 ? '0' : Math.abs(v) >= 1e4 || Math.abs(v) < 1e-3 ? v.toExponential(1) : v.toFixed(d)
for (const c of CASES) {
    const O = c.phosphor ? null : times(c.S, ...c.filters)
    const ref = c.phosphor ? PHOS_REF : integral(O)
    const refUv = upvp(ref)
    const H = c.phosphor ? null : Array.from(LAM, (_, i) => scale(CMF[i], O[i] * D))
    // the sampled ways: exact moments
    for (const [name, d, dIn] of DRAWS) {
        let mean, cov
        if (c.phosphor) ({ mean, cov } = phosphorMoments(d, dIn))
        else { const G = estimates(d, H); mean = meanOf(d, G); cov = covOf(cross(d, G, G), mean) }
        ok(`${c.name}, ${name}: the mean is the integral (unbiased)`, mean.every((v, a) => Math.abs(v - ref[a]) <= 1e-9 * ref[1]), `${mean} vs ${ref}`)
        const sY = Math.sqrt(cov[1][1]) / ref[1], sUv = sigmaUv(cov, ref)
        rows.push([c.name, name, fmt(sY), fmt(sUv, 4), fmt(Math.ceil(sUv * sUv / 1e-6), 0), fmt(Math.ceil(sY * sY / 1e-4), 0), '-', '-'])
        c[name] = { cov, sY, sUv }
    }
    // the deterministic ways: bias
    const det = [8, 16, 40].map(N => [`bands ${N}`, c.phosphor ? bandsPhosphor(N) : bandsLinear(c.S, c.filters, N)])
    det.push(['RGB (today)', c.phosphor ? null : rgbLinear(c.S, c.filters)])
    for (const [name, xyz] of det) {
        if (!xyz) { rows.push([c.name, name, '-', '-', '-', '-', 'cannot', 'cannot']); continue }
        const dY = (xyz[1] - ref[1]) / ref[1], dUv = Math.hypot(...upvp(xyz).map((v, r) => v - refUv[r]))
        rows.push([c.name, name, '0', '0', '-', '-', fmt(100 * dY, 3), fmt(dUv, 4)])
        if (c.name === 'neutral') ok(`neutral optics: ${name} exact`, Math.abs(dY) < 1e-9 && dUv < 1e-9, `dY ${dY} du'v' ${dUv}`)
        c[name] = { dY, dUv }
    }
}

{
    /* THE SUMS AGAINST MONTE CARLO: 400 000 seeded paths of three ways, their sample sigma_Y and sigma_u'v' within 3 %
       of the exact ones (a variance's own standard error at this count is well under 1 % for these light-tailed
       estimates). */
    let s = 0x2545F491
    const rnd = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
    const n = 400000
    const runMC = (est) => {
        const m = [0, 0, 0], M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
        for (let j = 0; j < n; j++) { const x = est(); for (let a = 0; a < 3; a++) { m[a] += x[a] / n; for (let b = 0; b < 3; b++) M[a][b] += x[a] * x[b] / n } }
        return { mean: m, cov: covOf(M, m) }
    }
    const cP = cdfOf(P_CMF), cA = cdfOf(P_ABS)
    const dic = CASES[1], Odic = times(dic.S, ...dic.filters)
    const hDic = i => scale(CMF[i], Odic[i] * D / P_CMF[i])
    const checks = [
        ['dichroic, 1 lambda', dic['1 lambda'], integral(Odic), () => hDic(cellOf(cP, rnd()))],
        ['dichroic, hero 4, pbrt-v4', dic['hero 4, pbrt-v4'], integral(Odic), () => {
            const u = rnd(); return [0, 1, 2, 3].reduce((acc, k) => add(acc, scale(hDic(cellOf(cP, (u + k / 4) % 1)), 0.25)), [0, 0, 0])
        }],
        ['phosphor, hero 4, pbrt-v4', CASES[4]['hero 4, pbrt-v4'], PHOS_REF, () => {
            const u = rnd(), v = rnd()
            let nAbs = 0
            for (let k = 0; k < 4; k++) { const i = cellOf(cA, (v + k / 4) % 1); nAbs += H_ABS[i][0] / P_ABS[i] / 4 }
            let x = [0, 0, 0]
            for (let k = 0; k < 4; k++) {
                const i = cellOf(cP, (u + k / 4) % 1)
                x = add(x, scale(add(H_PASS[i], scale(H_EMIT[i], C_EMIT * nAbs)), 1 / (4 * P_CMF[i])))
            }
            return x
        }],
    ]
    for (const [name, exact, ref, est] of checks) {
        const { cov } = runMC(est)
        const sY = Math.sqrt(cov[1][1]) / ref[1], sUv = sigmaUv(cov, ref)
        ok(`${name}: Monte Carlo's sigma_Y and sigma_u'v' the sums' within 3 %`, Math.abs(sY / exact.sY - 1) < 0.03 && Math.abs(sUv / exact.sUv - 1) < 0.03,
           `MC ${sY} ${sUv}, exact ${exact.sY} ${exact.sUv}`)
    }
}

{
    // THE TABLE: the answer, as roadmap/PLAN.md C quotes it
    const cct = xyz => { const [x, y] = XYZtoxy(xyz); const r = xyToCctDuv(x, y); return `${Math.round(r.cct ?? r[0])} K, Duv ${(r.duv ?? r[1]).toFixed(4)}` }
    console.log(`the LED: ${cct(integral(LED))}; the phosphor layer's light: ${cct(PHOS_REF)}`)
    const head = ['case', 'way', 'sigma_Y/Y', "sigma_u'v'", "paths 0.001 u'v'", 'paths 1 % Y', 'bias Y %', "bias u'v'"]
    const w = head.map((h, j) => Math.max(h.length, ...rows.map(r => String(r[j]).length)))
    const line = r => r.map((v, j) => String(v).padEnd(w[j])).join('  ')
    console.log(line(head))
    for (const r of rows) console.log(line(r))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
