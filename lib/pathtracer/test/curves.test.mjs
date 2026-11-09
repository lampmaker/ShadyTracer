// node lib/pathtracer/test/curves.test.mjs
//
// THE DARKROOM'S CURVES (lib/pathtracer/darkroom/curves.js, 0.79.0), no GPU: the curve passes through its points and
// holds its ends; on monotone points it is monotone and never overshoots them (Fritsch-Carlson's promise, which a plain
// cubic spline breaks); points normalised (clamped, sorted, merged, at most 16, at least the two ends); a straight
// curve bakes to i/1023 exactly; the table's layout and its sampling.
import { LUT_SIZE, MAX_POINTS, CHANNELS, CURVE_DEFAULTS, normalizeCurve, normalizeCurves, curveIdentity, curvesIdentity,
         curveFunction, bakeLut, lutSample } from '../darkroom/curves.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const near = (a, b, tol = 1e-12) => Math.abs(a - b) <= tol

{
    const pts = [[0, 0], [0.25, 0.15], [0.5, 0.5], [0.75, 0.85], [1, 1]]      // an S-curve
    const f = curveFunction(pts)
    ok('through every point', pts.every(([x, y]) => near(f(x), y, 1e-12)))
    let mono = true, prev = -1
    for (let i = 0; i <= 2000; i++) { const y = f(i / 2000); if (y < prev - 1e-12) mono = false; prev = y }
    ok('monotone points: a monotone curve', mono)
    // steep then flat: a plain spline overshoots the flat part; this one stays within each pair's range
    const g = curveFunction([[0, 0], [0.1, 0.9], [0.2, 0.92], [1, 1]])
    let over = 0
    for (let i = 0; i <= 2000; i++) {
        const x = i / 2000, y = g(x)
        const seg = x <= 0.1 ? [0, 0.9] : x <= 0.2 ? [0.9, 0.92] : [0.92, 1]
        if (y < seg[0] - 1e-12 || y > seg[1] + 1e-12) over++
    }
    ok('steep then flat: never outside the range of the two points it lies between (no overshoot)', over === 0, `${over}`)
    const h = curveFunction([[0.2, 0.1], [0.8, 0.9]])
    ok('below the first point and above the last: held', h(0) === 0.1 && h(0.1) === 0.1 && h(1) === 0.9)
    ok('two points: a straight line between them', near(h(0.5), 0.5, 1e-12))
    const flat = curveFunction([[0, 0.3], [0.4, 0.3], [0.6, 0.3], [1, 0.8]])
    ok('a flat run stays flat', [0.05, 0.2, 0.35, 0.5].every(x => near(flat(x), 0.3, 1e-12)))
}
{
    ok('normalised: clamped into 0..1 and sorted', JSON.stringify(normalizeCurve([[1.5, 2], [0.5, 0.4], [-1, -1]])) === '[[0,0],[0.5,0.4],[1,1]]')
    ok('...two points nearer than a 256th along x are one', normalizeCurve([[0, 0], [0.5, 0.4], [0.501, 0.9], [1, 1]]).length === 3)
    ok('...fewer than two: the straight curve', JSON.stringify(normalizeCurve([[0.5, 0.5]])) === '[[0,0],[1,1]]' && JSON.stringify(normalizeCurve(null)) === '[[0,0],[1,1]]')
    const many = Array.from({ length: 40 }, (_, i) => [i / 39, i / 39])
    const n = normalizeCurve(many)
    ok(`...at most ${MAX_POINTS} points, the two ends kept`, n.length === MAX_POINTS && n[0][0] === 0 && n.at(-1)[0] === 1)
    ok('...garbage left out', normalizeCurve([[0, 0], ['a', 1], [0.5], [1, 1]]).length === 2)
    ok('the straight curve is the identity; a moved end is not', curveIdentity([[0, 0], [1, 1]]) && !curveIdentity([[0, 0.1], [1, 1]]))
    ok('curves at their defaults change nothing; one moved does', curvesIdentity(CURVE_DEFAULTS()) && curvesIdentity(undefined)
        && !curvesIdentity({ ...CURVE_DEFAULTS(), g: [[0, 0], [0.5, 0.6], [1, 1]] }))
    ok('normalizeCurves fills a missing channel straight', JSON.stringify(normalizeCurves({ r: [[0, 0.2], [1, 1]] }).b) === '[[0,0],[1,1]]')
}
{
    const lut = bakeLut(CURVE_DEFAULTS())
    let exact = true
    for (let ch = 0; ch < 4; ch++) for (let i = 0; i < LUT_SIZE; i++) if (lut[ch * LUT_SIZE + i] !== Math.fround(i / (LUT_SIZE - 1))) exact = false
    ok('the straight curves bake to i/1023 exactly, every channel', exact && lut.length === 4 * LUT_SIZE)
    const c = { ...CURVE_DEFAULTS(), r: [[0, 0], [0.5, 0.7], [1, 1]] }
    const l2 = bakeLut(c), f = curveFunction(c.r)
    ok('the table is master, red, green, blue: red holds its curve, the others straight', CHANNELS.join() === 'm,r,g,b'
        && near(l2[1 * LUT_SIZE + 512], f(512 / 1023), 1e-7) && l2[0 * LUT_SIZE + 512] === Math.fround(512 / 1023))
    ok('sampled between entries: linear', near(lutSample(l2, 1, 0.5), f(0.5), 2e-6) && lutSample(lut, 2, 0.3) === lut[2 * LUT_SIZE + Math.floor(0.3 * 1023)]
        + (lut[2 * LUT_SIZE + Math.floor(0.3 * 1023) + 1] - lut[2 * LUT_SIZE + Math.floor(0.3 * 1023)]) * (0.3 * 1023 - Math.floor(0.3 * 1023)))
    ok('...clamped outside 0..1', lutSample(lut, 0, -1) === 0 && lutSample(lut, 0, 2) === 1)
}

console.log(`curves: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
