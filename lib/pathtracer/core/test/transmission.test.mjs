//======================================================================================================================
// THE SIDE BEYOND, no GPU (core/transmission.js, the JS mirrors of materials_pbr.js's transmission lobes). Run:
//   node lib/pathtracer/core/test/transmission.test.mjs
//
// Light sampling divides by the density MIS reads and multiplies by the value; a photon's connection out of glass
// multiplies by the value the camera's draw has in expectation. Both are right only if value, density and draw are one
// BSDF. So, for rough refraction (0.next: evaluated where it was only sampled), at views from straight on to grazing,
// into glass and out of it, rough and less rough, all transmission and half:
//   - THE VALUE: the sampler's mean weight over its refractions equals the integral of f |cos| below the surface,
//     by quadrature -- what lobesThroughEval must be for NEE and the connection to add what BSDF sampling adds;
//   - THE DENSITY: it integrates to how often the sampler refracts, and its histogram is the draws' own;
//   - nothing comes back above the surface, and the interface keeps no more than it is given (R + T <= 1).
// The WGSL against these mirrors is test/transmission.gpu.mjs.
//======================================================================================================================
import { lobesJS, roughThroughEvalJS, roughThroughPdfJS, sampleJS, LT_MIN_ALPHA } from '../transmission.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const rng = (seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 })(9001)

/* THE LOWER HEMISPHERE BY QUADRATURE: g(i) dw summed over a grid in (theta, phi) from straight down, dw = sin theta
   dtheta dphi -- uniform in the angle, not its cosine: a lobe refracted into glass straight on is a few degrees wide,
   and a grid in cos theta puts its whole peak in one cell. Midpoints; a tenth of a degree in theta. */
function lowerIntegral(g, nT = 900, nPhi = 720) {
    let s = 0
    for (let a = 0; a < nT; a++) {
        const t = (a + 0.5) / nT * Math.PI / 2, st = Math.sin(t), mu = Math.cos(t)
        let row = 0
        for (let b = 0; b < nPhi; b++) {
            const ph = 2 * Math.PI * (b + 0.5) / nPhi
            row += g([st * Math.cos(ph), st * Math.sin(ph), -mu])
        }
        s += row * st
    }
    return s * (Math.PI / 2 / nT) * (2 * Math.PI / nPhi)
}

const N = 400000
const cases = []
for (const [label, eta] of [['air into glass', 1 / 1.5], ['glass out to air', 1.5]])
    for (const theta of [0, 35, 60, 80]) for (const r of [0.4, 0.7]) for (const trans of [1, 0.5])
        cases.push({ label, eta, theta, r, trans })

for (const c of cases) {
    const th = c.theta * Math.PI / 180
    const lb = lobesJS({ o: [Math.sin(th), 0, Math.cos(th)], r: c.r, trans: c.trans, eta: c.eta })
    const name = `${c.label}, view ${c.theta} deg, roughness ${c.r}, transmission ${c.trans}`
    // the draws
    let sw = 0, sw2 = 0, nRefr = 0, nUp = 0, sumAll = 0
    const NB = 12, hist = new Float64Array(NB * NB)
    for (let k = 0; k < N; k++) {
        const s = sampleJS(lb, [rng(), rng(), rng(), rng()])
        if (s.kind === 'refract') {
            if (s.dir[2] < 0) {
                nRefr++
                const t = Math.acos(Math.min(1, -s.dir[2])), ph = (Math.atan2(s.dir[1], s.dir[0]) + 2 * Math.PI) % (2 * Math.PI)
                hist[Math.min(NB - 1, Math.floor(t / (Math.PI / 2) * NB)) * NB + Math.min(NB - 1, Math.floor(ph / (2 * Math.PI) * NB))]++
            } else if (s.w > 0) nUp++
            sw += s.w; sw2 += s.w * s.w
        }
        sumAll += s.w
    }
    const mean = sw / N, se = Math.sqrt(Math.max(sw2 / N - mean * mean, 0) / N)
    const T = lowerIntegral(i => roughThroughEvalJS(lb, i) * (-i[2]))
    ok(`${name}: the mean refraction weight is the integral of f |cos| below (${mean.toFixed(5)} drawn, ${T.toFixed(5)} by quadrature)`,
        Math.abs(mean - T) <= 4 * se + 2e-3 * T + 1e-5, `se ${se.toExponential(2)}`)
    const P = lowerIntegral(i => roughThroughPdfJS(lb, i))
    const pr = nRefr / N, sp = Math.sqrt(pr * (1 - pr) / N)
    ok(`${name}: the density integrates to how often the sampler refracts (${pr.toFixed(5)} drawn, ${P.toFixed(5)} integrated)`,
        Math.abs(pr - P) <= 4 * sp + 2e-3 * P + 1e-5)
    ok(`${name}: no refraction comes back above the surface with a weight`, nUp === 0)
    ok(`${name}: the interface keeps no more than it is given (R + T = ${(sumAll / N).toFixed(4)} <= 1)`,
        sumAll / N <= 1 + 4 * se + 1e-3)
    // the histogram, bin by bin in (theta, phi), where a bin expects enough draws to say anything
    let worst = 0, checked = 0
    for (let a = 0; a < NB; a++) for (let b = 0; b < NB; b++) {
        const dt = Math.PI / 2 / NB, dp = 2 * Math.PI / NB
        // the row at the horizon finer: a grazing lobe falls off steeply across it, and 40 cells misjudge it by 10 %
        let e = 0; const m = a === NB - 1 ? 160 : 40
        for (let x = 0; x < m; x++) for (let y = 0; y < m; y++) {
            const t = (a + (x + 0.5) / m) * dt, ph = (b + (y + 0.5) / m) * dp, st = Math.sin(t)
            e += roughThroughPdfJS(lb, [st * Math.cos(ph), st * Math.sin(ph), -Math.cos(t)]) * st
        }
        e *= (dt / m) * (dp / m) * N
        if (e < 2000) continue
        checked++
        worst = Math.max(worst, Math.abs(hist[a * NB + b] - e) / Math.sqrt(e))
    }
    // (a view that totally reflects nearly everything back into glass leaves no bin enough draws to judge)
    ok(`${name}: the draws' histogram is the density's (${checked} bins, worst ${worst.toFixed(2)} sigma)`,
        (checked > 0 || nRefr < 0.05 * N) && worst < 5.5)
}

// what is evaluable to light tracing: from LT_MIN_ALPHA up, as glossy reflection
{
    const lb = lobesJS({ o: [0, 0, 1], r: Math.sqrt(LT_MIN_ALPHA) * 0.99, eta: 1 / 1.5 })
    const i = [0.05, 0, -Math.sqrt(1 - 0.0025)]
    ok('below LT_MIN_ALPHA a refraction is drawn EV_OTHER and a connection (floor LT_MIN_ALPHA) evaluates nothing, NEE (floor 0) does',
        sampleJS(lb, [0.5, 0.3, 0.3, 0]).ev === 'other' && roughThroughEvalJS(lb, i, LT_MIN_ALPHA) === 0 && roughThroughEvalJS(lb, i, 0) > 0)
    const lb2 = lobesJS({ o: [0, 0, 1], r: 0.3, eta: 1 / 1.5 })
    ok('...and above it EV_EVAL, evaluated at both floors', sampleJS(lb2, [0.5, 0.3, 0.3, 0]).ev === 'eval'
        && roughThroughEvalJS(lb2, i, LT_MIN_ALPHA) > 0)
    const smooth = lobesJS({ o: [0, 0, 1], r: 0, eta: 1 / 1.5 })
    ok('clear glass (a delta) has no value and no density below', roughThroughEvalJS(smooth, i) === 0 && roughThroughPdfJS(smooth, i) === 0)
}

console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
