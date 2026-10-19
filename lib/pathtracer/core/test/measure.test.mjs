// node lib/pathtracer/core/test/measure.test.mjs
//
// THE ERROR BAR, without a GPU: run the kernel's update (stepMoments, the mirror of prog_resolve)
// over many independent pixels and check that the standard error it reports is the spread the
// estimate really has -- for a true mean and for an EMA window, on a skewed distribution like a
// path tracer's. Seeded, so the numbers do not move between runs.
import { stepMoments, standardError, reading, regionReading, fmtChroma } from '../measure.js'
import { rgbFromXy, cctDuvToXy, rgbToXYZ, XYZtoxy } from '../colorimetry.js'
import { LUMA } from '../photometry.js'
import { legendTicks, fmtValue, pointName, lengthDecimals, fmtLength, rulerOf, legsOf } from '../../measure/tool.js'

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

{
    // THE RULER (measure/tool.js, 0.68.0): points named as spreadsheet columns, each joined to the last of its line
    ok('ruler: points named A..Z, then AA, AB, ..., AZ, BA', [0, 1, 25, 26, 27, 51, 52, 701, 702].map(pointName).join()
        === 'A,B,Z,AA,AB,AZ,BA,ZZ,AAA')
    ok('ruler: the decimals are the tolerance\'s first digit -- 0.01 two, 0.005 three, 1 none, 0.5 m\'s 1e-4 four',
        lengthDecimals(0.01) === 2 && lengthDecimals(0.005) === 3 && lengthDecimals(1) === 0 && lengthDecimals(5e-4) === 4
        && lengthDecimals(20) === 0 && lengthDecimals(1e-12) === 6 && lengthDecimals(null) === 3 && lengthDecimals(0) === 3)
    ok('ruler: a length to its decimals, never -0', fmtLength(12.345, 2) === '12.35' && fmtLength(-0.001, 2) === '0.00'
        && fmtLength(-0.4, 0) === '0' && fmtLength(-1.5, 1) === '-1.5' && fmtLength(NaN, 2) === '–')
    const P = (name, line, world, unit = 'mm', tol = 0.01) => ({ name, line, world, unit, tol })
    const pts = [P('A', 1, [0, 0, 0]), P('B', 1, [3, 4, 0]), P('C', 2, [10, 10, 10]), P('D', 1, [3, 4, 12]),
                 { name: 'E', line: 1, world: null, unit: null, tol: null }, P('F', 2, [10, 10, 11], 'mm', 0.001)]
    const R = rulerOf(pts)
    ok('ruler: each point joined to the last of ITS line, in order; one still picked skipped',
        R.stretches.map(s => s.a.name + s.b.name).join() === 'AB,BD,CF', R.stretches.map(s => s.a.name + s.b.name).join())
    ok('ruler: a stretch\'s length and its step b - a', R.stretches[0].length === 5 && R.stretches[1].length === 12
        && R.stretches[1].delta.join() === '0,0,12' && R.stretches[0].unit === 'mm')
    ok('ruler: a stretch shown to its coarser end\'s tolerance', R.stretches[2].dec === 2)
    ok('ruler: a line of two stretches or more has a total, at its last point; one of one has none',
        R.lines.get(1)?.total === 17 && R.lines.get(1).last.name === 'D' && !R.lines.has(2))
    const mixed = rulerOf([P('A', 1, [0, 0, 0], 'm', 1e-5), P('B', 1, [0, 0, 0.1], 'm', 1e-5), P('C', 1, [0, 0, 300], 'mm', 0.01)])
    ok('ruler: points picked in scenes of different units -- each stretch in its second point\'s unit, the total in the last\'s',
        Math.abs(mixed.stretches[0].length - 0.1) < 1e-12 && mixed.stretches[0].unit === 'm'
        && Math.abs(mixed.stretches[1].length - 200) < 1e-9 && mixed.stretches[1].unit === 'mm'
        && Math.abs(mixed.lines.get(1).total - 300) < 1e-9 && mixed.lines.get(1).unit === 'mm' && mixed.lines.get(1).dec === 2,
        JSON.stringify(mixed.stretches.map(s => [s.length, s.unit, s.dec])))
    // THE LEGS: x, then y, then z, from the first point to the second; a step that rounds to 0 left out
    const legs = legsOf(rulerOf([P('A', 1, [1, 2, 3]), P('B', 1, [4, 2.004, -1])]).stretches[0])
    const same = (u, v) => u.every((x, i) => Math.abs(x - v[i]) < 1e-12)
    ok('ruler: a stretch\'s legs x then z, end to end from A to B; y\'s 0.004 at two decimals not drawn, but stepped',
        legs.map(l => l.axis).join() === '0,2' && same(legs[0].from, [1, 2, 3]) && same(legs[0].to, [4, 2, 3]) && legs[0].d === 3
        && same(legs[1].from, [4, 2.004, 3]) && same(legs[1].to, [4, 2.004, -1]) && legs[1].d === -4, JSON.stringify(legs))
    const legsM = legsOf(mixed.stretches[1])
    ok('ruler: legs in the stretch\'s unit, from its first point converted', legsM.length === 1 && legsM[0].axis === 2
        && legsM[0].from.join() === '0,0,100' && Math.abs(legsM[0].d - 200) < 1e-9, JSON.stringify(legsM))
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
