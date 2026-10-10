// node lib/pathtracer/optics/test/farfield.test.mjs
//
// The far field's arithmetic, without a GPU: the binning (farBin, the JS mirror of the shade kernel's
// optFarAdd), the solid angles, and intensity, beam angles and zones against closed forms -- a
// Lambertian source is I0 cos(gamma) with I0 = flux / pi, and its beam angle is 120 degrees.
import { farGeometry, farBin, intensity, planeCurve, farStats, zoneFlux, intensityCSV } from '../farfield.js'
import { sampleCos, DISTRIBUTIONS } from '../sources.js'
import { optDataWords, farBase, detBase, DET_WORDS } from '../kernels.js'
import { niceStep, polarScale, polarAngleAt, polarStyle } from '../polar.js'
import { angleSpan, angleStep, cartesianAngleAt, ANGLE_SPANS } from '../cartesian.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol
const RAD = Math.PI / 180

/* A FAR FIELD FILLED EXACTLY: the flux of an axially symmetric source in each bin, from its cumulative
   share within gamma, F(g). No sampling noise, so what is tested is the arithmetic alone. */
const exactFar = (F, flux, nC, nG) => {
    const dG = 180 / (nG - 1), f = new Float64Array(nC * nG)
    for (let j = 0; j < nG; j++) {
        const lo = Math.max(0, (j - 0.5) * dG) * RAD, hi = Math.min(180, (j + 0.5) * dG) * RAD
        for (let i = 0; i < nC; i++) f[j * nC + i] = flux * (F(hi) - F(lo)) / nC
    }
    return { nC, nG, flux: f, se: null, emitted: flux }
}
const lambert = g => g >= Math.PI / 2 ? 1 : Math.sin(g) ** 2                 // share within gamma
const cosN = n => g => g >= Math.PI / 2 ? 1 : 1 - Math.cos(g) ** (n + 1)

{
    const { omega, dC, dG } = farGeometry(72, 181)
    ok('the bins tile the sphere: sum of solid angles is 4 pi',
        near(omega.reduce((a, b) => a + b, 0) * 72, 4 * Math.PI, 1e-9))
    ok('widths: 5 degrees in C, 1 in gamma', dC === 5 && dG === 1)
    ok('a pole cap is half a row wide: much less than a middle row', omega[0] < omega[90] / 50)
}

{
    const nC = 72, nG = 181, flux = 1000
    const far = exactFar(lambert, flux, nC, nG)
    const R = intensity(far)
    const I0 = flux / Math.PI
    ok('Lambertian: I(0) = flux / pi (the cap, pooled)', near(R.I[0], I0, I0 * 1e-4), `${R.I[0]} vs ${I0}`)
    let worst = 0
    for (let j = 1; j < 89; j++) worst = Math.max(worst, Math.abs(R.I[j * nC] / (I0 * Math.cos(j * RAD)) - 1))
    ok('Lambertian: I(gamma) = I0 cos gamma to 0.1 % below 89 degrees (bin averages)', worst < 1e-3, `worst ${worst}`)
    ok('...and every C plane the same', near(R.I[40 * nC + 17], R.I[40 * nC], 1e-9))
    ok('nothing behind the source', R.I[120 * nC + 3] === 0)
    const S = farStats(far, R, [0, 90])
    ok('Lambertian: beam angle 120 degrees (50 % at 60 either side)',
        near(S.planes[0].beam.width, 120, 0.05), `${S.planes[0].beam.width}`)
    ok('...field angle 2 acos(0.1) = 168.52 degrees',
        near(S.planes[0].field.width, 2 * Math.acos(0.1) / RAD, 0.05), `${S.planes[0].field.width}`)
    ok('...symmetric: -60 and +60', near(S.planes[1].beam.minus, -60, 0.05) && near(S.planes[1].beam.plus, 60, 0.05))
    ok('I max on the axis', S.max.gamma === 0 && near(S.max.I, I0, I0 * 1e-4))
    ok('sum of I times solid angle is the flux', near(S.flux, flux, 1e-6))
    ok('efficiency 1 when all of it is in the far field', near(S.efficiency, 1, 1e-9))
    // a zone edge inside a bin splits it by solid angle, as if I were flat across the bin: right to
    // about 1e-4 of the flux at a 1-degree grid, not exactly
    ok('zones: 1/4 of a Lambertian source within 30 degrees (sin^2 30)', near(zoneFlux(far, 0, 30), 250, 0.1),
        `${zoneFlux(far, 0, 30)}`)
    ok('...3/4 within 60, all within 90, none above', near(S.zones[1].flux, 750, 0.1) && near(S.zones[2].flux, 1000, 0.1)
        && near(S.zones[3].flux, 0, 0.1), S.zones.map(z => z.flux).join(' '))
    const K = intensity(far, { perKlm: true })
    ok('cd/klm: a 1000 lm source reads the same number', near(K.I[0], R.I[0], 1e-9) && K.unit === 'cd/klm')
    const csv = intensityCSV(R).split('\n')
    ok('CSV: a row per gamma under two header lines, a column per C', csv.length === nG + 2 && csv[1].split(',').length === nC + 1)
}

{
    // cos^n: beam angle 2 acos(0.5^(1/n)); a narrow one at a fine grid
    for (const n of [5, 40]) {
        const far = exactFar(cosN(n), 500, 36, 721)
        const S = farStats(far, intensity(far), [0])
        const want = 2 * Math.acos(0.5 ** (1 / n)) / RAD
        ok(`cos^${n}: beam angle ${want.toFixed(2)} degrees`, near(S.planes[0].beam.width, want, 0.1), `${S.planes[0].beam.width}`)
    }
}

{
    // THE PLANE CURVE: C0 on the plus side, C180 on the minus side, gamma = 0 once in the middle
    const nC = 4, nG = 5                               // C 0 90 180 270; gamma 0 45 90 135 180
    const flux = new Float64Array(nC * nG)
    flux[2 * nC + 0] = 1                               // light at gamma 90, C 0 only
    const R = intensity({ nC, nG, flux, se: null, emitted: 1 })
    const c = planeCurve(R, 0)
    ok('plane curve: 2 nG - 1 points from -180 to 180', c.points.length === 2 * nG - 1
        && c.points[0].a === -180 && c.points[c.points.length - 1].a === 180)
    ok('...C0 is the plus side', c.points.find(p => p.a === 90).I > 0 && c.points.find(p => p.a === -90).I === 0)
    const h = planeCurve(R, 45)
    ok('...a C between bins is interpolated', near(h.points.find(p => p.a === 90).I, R.I[2 * nC] / 2, 1e-12))
}

{
    // THE BINNING, as the kernel does it: +x is C 0, +y is C 90 (counterclockwise from +z)
    const ax = [0, 0, 1], c0 = [1, 0, 0], nC = 72, nG = 181
    const t = 30 * RAD
    ok('farBin: straight along the axis is bin 0', farBin([0, 0, 1], ax, c0, nC, nG) === 0)
    ok('farBin: 30 degrees towards +x is gamma 30, C 0', farBin([Math.sin(t), 0, Math.cos(t)], ax, c0, nC, nG) === 30 * nC + 0)
    ok('farBin: towards +y is C 90', farBin([0, Math.sin(t), Math.cos(t)], ax, c0, nC, nG) === 30 * nC + 18)
    ok('farBin: towards -y is C 270', farBin([0, -Math.sin(t), Math.cos(t)], ax, c0, nC, nG) === 30 * nC + 54)
    ok('farBin: straight back is the last row', Math.floor(farBin([0, 0, -1], ax, c0, nC, nG) / nC) === nG - 1)
    ok('farBin: C just below 360 wraps to bin 0', farBin([Math.cos(-1 * RAD), Math.sin(-1 * RAD), 0], ax, c0, nC, nG) % nC === 0)

    // SAMPLED like the generator (sampleCos) and binned like the kernel: a Lambertian source's
    // intensity within 3 % of I0 cos gamma: 2 million rays put ~12 000 in the ring at 10 degrees, ~1 % noise
    const N = 2000000, flux = 1000, f = new Float64Array(nC * nG)
    let s = 12345
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
    for (let k = 0; k < N; k++) {
        const c = sampleCos(DISTRIBUTIONS.cosine, rnd(), 0, 1), sn = Math.sqrt(Math.max(0, 1 - c * c)), ph = 2 * Math.PI * rnd()
        f[farBin([sn * Math.cos(ph), sn * Math.sin(ph), c], ax, c0, nC, nG)] += flux / N
    }
    const R = intensity({ nC, nG, flux: f, se: null, emitted: flux }, { symmetry: 'rotational' })
    const I0 = flux / Math.PI
    let worst = 0
    for (const g of [10, 20, 30, 45, 60]) worst = Math.max(worst, Math.abs(R.I[g * nC] / (I0 * Math.cos(g * RAD)) - 1))
    ok('sampled Lambertian, rotational symmetry: within 3 % of I0 cos gamma', worst < 0.03, `worst ${worst}`)
}

{
    // THE BUFFER: the far field sits after the detector hits
    ok('farBase is past the detector hits', farBase(10, 4, 5) === detBase(10, 4) + 5 * DET_WORDS)
    ok('optDataWords makes room for two words a bin', optDataWords(10, 4, 5, 7) === farBase(10, 4, 5) + 14)
    ok('...and none when there is no far field', optDataWords(10, 4, 5) === farBase(10, 4, 5))
}

{
    // THE POLAR DIAGRAM'S ARITHMETIC (polar.js; the drawing itself needs a browser)
    ok('niceStep: 318 over four rings steps by 100', niceStep(318) === 100)
    ok('niceStep: 0.9 over four rings steps by 0.25', near(niceStep(0.9), 0.25, 1e-12))
    const L = polarScale(318)
    ok('linear scale: rings 100..400, top 400, r(200) = 0.5', L.top === 400 && L.rings.length === 4 && near(L.r(200), 0.5, 1e-12))
    const G = polarScale(318, { log: true, decades: 3 })
    ok('log scale: top 1000, three decade rings, r(10) = 1/3, nothing below shown at the centre',
        G.top === 1000 && G.rings.length === 3 && near(G.r(10), 1 / 3, 1e-9) && G.r(0.5) === 0)
    const lay = { cx: 100, cy: 100, R: 50, aMax: 180 }
    ok('angle under the pointer: straight down is 0, right is +90, left -90',
        near(polarAngleAt(lay, 100, 140), 0, 1e-9) && near(polarAngleAt(lay, 140, 100), 90, 1e-9) && near(polarAngleAt(lay, 60, 100), -90, 1e-9))
    ok('...and nothing outside the diagram', polarAngleAt(lay, 100, 190) === null
        && polarAngleAt({ ...lay, aMax: 90 }, 100, 60) === null)
    ok('a fourth plane repeats a colour, but dashed', polarStyle(3).colour === polarStyle(0).colour && polarStyle(3).dash.length > 0
        && polarStyle(0).dash.length === 0)
}

{
    // THE CARTESIAN CHART'S ARITHMETIC (cartesian.js): the zoom, the ticks, the pointer
    const beam = w => [{ points: Array.from({ length: 361 }, (_, i) => { const a = i - 180; return { a, I: Math.abs(a) <= w ? 100 : 0 } }) }]
    ok('auto span: a +-3 degree beam is shown +-5 (the next span 10 % past it)', angleSpan(beam(3)) === 5, `${angleSpan(beam(3))}`)
    ok('...a +-60 beam +-90, a +-170 one the full +-180', angleSpan(beam(60)) === 90 && angleSpan(beam(170)) === 180)
    ok('...nothing lit: the full range', angleSpan([{ points: [{ a: 0, I: 0 }] }]) === 180)
    // a Lambertian curve falls to 0.5 % of its peak at 89.7 degrees: linear shows it to +-120
    const lam = [{ points: Array.from({ length: 361 }, (_, i) => { const a = i - 180; return { a, I: Math.max(0, Math.cos(a * RAD)) } }) }]
    ok('...a Lambertian source: +-120, just past 90 where it ends', angleSpan(lam) === 120, `${angleSpan(lam)}`)
    ok('...on a log scale the floor is lower, so the span is never narrower',
        angleSpan(beam(3), { log: true }) >= angleSpan(beam(3)))
    ok('spans are sorted and end at 180', ANGLE_SPANS.every((v, i, a) => !i || v > a[i - 1]) && ANGLE_SPANS.at(-1) === 180)
    ok('tick steps: three to six a side for every span', ANGLE_SPANS.every(s => { const n = s / angleStep(s); return n >= 2 && n <= 6 }),
        ANGLE_SPANS.map(s => `${s}:${angleStep(s)}`).join(' '))
    const lay = { x0: 50, x1: 250, y0: 20, y1: 220, span: 10 }
    ok('pointer: the plot\'s left edge is -span, the middle 0, the right +span',
        near(cartesianAngleAt(lay, 50, 100), -10, 1e-12) && near(cartesianAngleAt(lay, 150, 100), 0, 1e-12)
        && near(cartesianAngleAt(lay, 250, 100), 10, 1e-12))
    ok('...and nothing outside the plot', cartesianAngleAt(lay, 20, 100) === null && cartesianAngleAt(lay, 150, 300) === null)
}

console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
