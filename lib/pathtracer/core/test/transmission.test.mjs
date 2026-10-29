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
//   - nothing comes back above the surface, and the interface keeps no more than it is given (R + T <= 1);
//   - anisotropic too (anisotropy 0.8, alphas 4.5:1 -- how an elliptical diffuser film is made, since the film lobe of
//     B2 went: the user, 2026-10-29);
//   - the library's diffuser film, a thin sheet of rough polycarbonate, spreading a ray head-on by about 10 degrees.
// The WGSL against these mirrors is test/transmission.gpu.mjs.
//======================================================================================================================
import { lobesJS, roughThroughEvalJS, roughThroughPdfJS, sampleJS, LT_MIN_ALPHA, diffThroughEvalJS, diffThroughPdfJS, sheetWalkJS,
    roughSheetJS } from '../transmission.js'
import { readFileSync } from 'node:fs'
import { translucencyForSheet } from '../../../../builder/materials.js'

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
        cases.push({ label, eta, theta, r, trans, an: 0 })
// ...and anisotropic: an elliptical spread, its x the rough axis (mfAnisoAlpha without a grain)
for (const [label, eta] of [['air into glass', 1 / 1.5], ['glass out to air', 1.5]])
    for (const theta of [0, 60]) for (const r of [0.4, 0.7]) cases.push({ label, eta, theta, r, trans: 1, an: 0.8 })

for (const c of cases) {
    const th = c.theta * Math.PI / 180
    // (the view turned 30 degrees off the rough axis, so an anisotropic lobe is asked about both its axes)
    const lb = lobesJS({ o: [Math.sin(th) * Math.cos(0.52), Math.sin(th) * Math.sin(0.52), Math.cos(th)], r: c.r, trans: c.trans,
                         eta: c.eta, anisotropy: c.an })
    const name = `${c.label}, view ${c.theta} deg, roughness ${c.r}${c.an ? `, anisotropy ${c.an}` : ''}, transmission ${c.trans}`
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

/* THE TRANSLUCENT BASE (B1): its value below integrates to its share t, its density to t, and a sheet of two faces --
   each passing t, reflecting 1 - t -- passes t / (2 - t), so translucencyForSheet's 2T / (1 + T) gives the sheet T */
for (const t of [0.2, 0.667, 1]) {
    const T = lowerIntegral(i => diffThroughEvalJS(t, i) * (-i[2])), P = lowerIntegral(i => diffThroughPdfJS(t, i))
    ok(`translucency ${t}: the value below integrates to its share (${T.toFixed(5)}), the density too (${P.toFixed(5)})`,
        Math.abs(T - t) < 2e-4 && Math.abs(P - t) < 2e-4)
}
for (const T of [0.1, 0.5, 0.8]) {
    const t = translucencyForSheet(T), got = sheetWalkJS(t, 400000, rng), se = Math.sqrt(T * (1 - T) / 400000)
    ok(`a sheet of total transmittance ${T}: translucency ${t.toFixed(4)}, and two faces of it walked through pass ${got.toFixed(4)}`,
        Math.abs(got - T) < 4 * se && Math.abs(t / (2 - t) - T) < 1e-12)
}

/* A DIFFUSER FILM AS ROUGH GLASS: the library's, a thin sheet of polycarbonate frosted on both faces, its roughness read
   from the library itself, walked through head-on (roughSheetJS): about 10 degrees FWHM. Two seeds of a million rays
   read 9.72 and 9.81 at 0.36, and the roughness that reads 10 was 0.3621 and 0.3596 (2026-10-29): so 10 within 0.6. */
{
    const LIB = JSON.parse(readFileSync(new URL('../../../../library/items/materials.json', import.meta.url), 'utf8')).items
    const film = LIB.find(it => it.name === 'diffuser film 10\u00b0 (frosted polycarbonate)')?.asset.material.params
    const fw = film ? roughSheetJS(film.roughness, film.ior, { rays: 1000000, seed: 5 }) : NaN
    ok(`the library's diffuser film, roughness ${film?.roughness} and n ${film?.ior}, as a sheet of two rough faces: ${fw.toFixed(2)} degrees FWHM`,
        Math.abs(fw - 10) < 0.6)
    ok('...and rougher spreads wider', roughSheetJS(0.5, 1.586, { rays: 300000, seed: 6 }) > fw + 3)
}

console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
