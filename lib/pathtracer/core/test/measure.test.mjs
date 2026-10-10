// node lib/pathtracer/core/test/measure.test.mjs
//
// THE ERROR BAR, without a GPU: run the kernel's update (stepMoments, the mirror of prog_resolve)
// over many independent pixels and check that the standard error it reports is the spread the
// estimate really has -- for a true mean and for an EMA window, on a skewed distribution like a
// path tracer's. Seeded, so the numbers do not move between runs.
import { stepMoments, standardError, reading, regionReading, fmtChroma } from '../measure.js'
import { rgbFromXy, cctDuvToXy, rgbToXYZ, XYZtoxy } from '../colorimetry.js'
import { LUMA } from '../photometry.js'
import { legendTicks, fmtValue } from '../../measure/tool.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}

// mulberry32: small, seeded, good enough for a spread
let seed = 12345
const rnd = () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
}
// exponential, mean 1 and sd 1: most samples small, a long bright tail
const sample = () => -Math.log(1 - rnd())

const spread = (window, steps, trials = 20000) => {
    const est = [], se2 = []
    for (let t = 0; t < trials; t++) {
        let st = { Y: 0, V: 0, S: 0, cnt: 0 }
        for (let k = 0; k < steps; k++) st = stepMoments(st, sample(), window)
        est.push(st.Y)
        se2.push(standardError(st.V, st.S) ** 2)
    }
    const m = est.reduce((a, b) => a + b) / trials
    const real = Math.sqrt(est.reduce((a, b) => a + (b - m) ** 2, 0) / (trials - 1))
    const predicted = Math.sqrt(se2.reduce((a, b) => a + b) / trials)
    return { real, predicted, ratio: predicted / real }
}

for (const [window, steps] of [[Infinity, 32], [Infinity, 200], [10, 32], [10, 200], [1, 50]]) {
    const r = spread(window, steps)
    ok(`window ${window}, ${steps} samples: the reported error is the real spread (within 3%)`,
        Math.abs(r.ratio - 1) < 0.03, `real ${r.real.toFixed(4)} predicted ${r.predicted.toFixed(4)} ratio ${r.ratio.toFixed(3)}`)
}

// a true mean of n equal-weight samples: S is exactly 1/n
{
    let st = { Y: 0, V: 0, S: 0, cnt: 0 }
    for (let k = 0; k < 16; k++) st = stepMoments(st, sample())
    ok('a true mean of 16 samples is worth 16 (S = 1/16)', Math.abs(st.S - 1 / 16) < 1e-12, `S ${st.S}`)
}
// an EMA window of N settles at 1/(2N+1): the window's real worth, which N is not
{
    let st = { Y: 0, V: 0, S: 0, cnt: 0 }
    for (let k = 0; k < 2000; k++) st = stepMoments(st, sample(), 10)
    // the kernel's weight at the cap is 1/(N+1): S -> w / (2 - w) = 1/(2N+1)
    ok('an EMA window of 10 is worth 21 samples', Math.abs(1 / st.S - 21) < 1e-6, `1/S ${1 / st.S}`)
}
// a reset (window 0 for one step) replaces everything, including the error bar
{
    let st = { Y: 0, V: 0, S: 0, cnt: 0 }
    for (let k = 0; k < 50; k++) st = stepMoments(st, sample())
    st = stepMoments({ ...st, Y: 1e20 }, 3, 0)            // whatever was there, even a huge mean
    ok('a reset leaves one sample: S = 1, V = 0, Y = the sample',
        st.S === 1 && st.V === 0 && st.Y === 3, JSON.stringify(st))
    ok('and one sample has no error bar', standardError(st.V, st.S) === null)
}
// the readout
{
    const r = reading([100, 100, 100], 5, 400, 0.2)
    ok('reading: luminance of a grey is its value', Math.abs(r.L - 100) < 1e-9, `L ${r.L}`)
    ok('reading: se = sqrt(S V / (1 - S))', Math.abs(r.se - Math.sqrt(0.2 * 400 / 0.8)) < 1e-12)
    ok('reading: nEff = 1/S', Math.abs(r.nEff - 5) < 1e-12)
    ok('reading: never-sampled pixel reads nothing', reading([0, 0, 0], 0, 0, 0) === null)
}

{
    /* A RECTANGLE: pixels whose means are known and whose error bars are known, laid out as the
       accumulation and moments buffers are, two rows of a picture 4 wide, the rectangle columns 1..2 */
    const width = 4, rows = 2
    const acc = new Uint32Array(width * rows * 4), mom = new Float32Array(width * rows * 2)
    const f = new Float32Array(acc.buffer)
    const put = (x, y, L, V, S) => {
        const i = y * width + x
        f[i * 4] = f[i * 4 + 1] = f[i * 4 + 2] = L          // grey: luminance is L (the LUMA weights sum to 1)
        acc[i * 4 + 3] = 10
        mom[i * 2] = V; mom[i * 2 + 1] = S
    }
    // S = 0.1 is ten equal samples; se = sqrt(S V / (1 - S)) = sqrt(V / 9)
    put(1, 0, 10, 9, 0.1); put(2, 0, 20, 36, 0.1); put(1, 1, 30, 81, 0.1); put(2, 1, 40, 0, 0.1)
    put(0, 0, 1000, 0, 0.1)                                   // outside the rectangle: must not count
    const r = regionReading(acc, mom, width, 1, 2, rows)
    const near = (a, b) => Math.abs(a - b) < 1e-4 * Math.max(1, Math.abs(b))
    ok('LUMA weights sum to 1, so a grey pixel reads its value', near(LUMA[0] + LUMA[1] + LUMA[2], 1))
    ok('region: the mean is over the pixels inside it', near(r.mean, 25), `${r.mean}`)
    // se_i = 1, 2, 3, 0 -> sqrt(1 + 4 + 9) / 4
    ok('region: the errors add in quadrature, over N', near(r.se, Math.sqrt(14) / 4), `${r.se}`)
    ok('region: min, max and U0 = min / mean', near(r.min, 10) && near(r.max, 40) && near(r.uniformity, 0.4))
    ok('region: every pixel counted, all sampled', r.pixels === 4 && r.sampled === 4)
    mom[(1 * width + 2) * 2 + 1] = 1                          // one pixel with a single sample: no error bar
    ok('region: one pixel without an error bar and the mean has none', regionReading(acc, mom, width, 1, 2, rows).se === null)
    acc[(0 * width + 1) * 4 + 3] = 0                          // never sampled: left out of the mean
    const s = regionReading(acc, mom, width, 1, 2, rows)
    ok('region: an unsampled pixel is left out of the mean', s.sampled === 3 && near(s.mean, 30))
    ok('region: nothing sampled reads nothing', regionReading(new Uint32Array(32), new Float32Array(16), 4, 0, 3, 2) === null)
    ok('region: grey pixels read D65 (the Rec.709 white), 6504 K', near(r.colour.x, 0.3127) && Math.abs(r.colour.cct - 6504) < 15,
       JSON.stringify(r.colour))
}
{
    // COLOUR: exact through the readings, a negative channel included, and an area's mix is its sum
    const warm = rgbFromXy(...cctDuvToXy(3000, 0)).map(v => 50 * v), blue = rgbFromXy(0.15, 0.025).map(v => 5 * v)
    const w = reading(warm, 10, 1, 0.1).colour
    ok('reading: a 3000 K pixel reads 3000 K, Duv 0', Math.abs(w.cct - 3000) < 0.5 && Math.abs(w.duv) < 1e-6, JSON.stringify(w))
    const b = reading(blue, 10, 1, 0.1).colour
    ok('reading: a royal blue (a negative channel) reads its xy, and no CCT', Math.abs(b.x - 0.15) < 1e-6 && Math.abs(b.y - 0.025) < 1e-6 && b.cct === null)
    const width = 2, acc = new Uint32Array(width * 4), f = new Float32Array(acc.buffer), mom = new Float32Array(width * 2)
    for (const [x, c] of [[0, warm], [1, blue]]) { f.set(c, x * 4); acc[x * 4 + 3] = 10; mom[x * 2 + 1] = 0.1 }
    const r = regionReading(acc, mom, width, 0, 1, 1)
    const sum = XYZtoxy([0, 1, 2].map(k => rgbToXYZ(warm)[k] + rgbToXYZ(blue)[k]))
    ok("region: the colour of the whole is the pixels' sum", Math.abs(r.colour.x - sum[0]) < 1e-6 && Math.abs(r.colour.y - sum[1]) < 1e-6)
    ok("region: and the spread is each pixel's u'v' distance from it", r.colour.dUpVpMax > 0.05)
    ok('fmtChroma: near white a CCT, else xy', /K Duv/.test(fmtChroma(w)) && /^xy /.test(fmtChroma(b)))
}

{
    // THE LEGEND: band edges for a few bands, so a colour reads as a range; decades for many
    const b = legendTicks(1, 1e5, 10)
    ok('legend: 10 bands have 11 edges, from min to max', b.length === 11 && b[0].v === 1 && Math.abs(b[10].v - 1e5) < 1e-6)
    ok('legend: the edges are even in log -- half a decade each over five', Math.abs(b[2].v - 10) < 1e-9 && Math.abs(b[1].t - 0.1) < 1e-12)
    const d = legendTicks(0.5, 2000, 0)
    ok('legend: smooth -> the ends and the decades between', d.map(k => k.v).join() === '0.5,1,10,100,1000,2000')
    ok('legend: a decade sits at its log position', Math.abs(d[1].t - Math.log10(2) / Math.log10(4000)) < 1e-12)
    ok('format: three significant figures, exponent at the extremes',
        fmtValue(523.44) === '523' && fmtValue(0.1234) === '0.123' && fmtValue(3.18e8) === '3.18e+8' && fmtValue(null) === '–')
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
