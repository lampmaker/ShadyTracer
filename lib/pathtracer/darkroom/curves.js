//======================================================================================================================
// THE DARKROOM'S CURVES (0.next) -- a curve through points, the way an image editor draws it, baked into the table the
// develop pass reads.
//
// MONOTONE CUBIC (Fritsch and Carlson, 1980). A curve through points has to be smooth, and a plain cubic spline is,
// but it overshoots: two points close together and steep make it swing above 1 or dip below the points between them,
// and a curve meant to lift the shadows darkens a band beside them. Fritsch-Carlson limits each point's slope so that
// between two points the curve never leaves the range they span -- monotone data stays monotone, a flat run stays flat.
// Below the first point the curve holds its height, above the last the same, as an image editor's does.
//
// FOUR CURVES: master (on every channel, or on the luma alone in the luminance mode), then red, green and blue, each a
// list of [x, y] in 0..1 from the black point to the white. bakeLut makes them one table of 4 x 1024 values, the order
// the develop pass samples it (core/rendertoscreen.js lutAt): master, red, green, blue. A straight curve bakes to i/1023
// exactly, so a curve put back is the table it was.
//======================================================================================================================

export const LUT_SIZE = 1024
export const MAX_POINTS = 16
export const CHANNELS = ['m', 'r', 'g', 'b']
const STRAIGHT = () => [[0, 0], [1, 1]]
export const CURVE_DEFAULTS = () => ({ m: STRAIGHT(), r: STRAIGHT(), g: STRAIGHT(), b: STRAIGHT() })
/* two points closer than this along x are one: a slope through them would be a cliff */
export const MIN_GAP = 1 / 256

/** Points as a curve can hold them: in 0..1, sorted, no two at one x, at most MAX_POINTS, at least the two ends. */
export function normalizeCurve(points) {
    const ok = (Array.isArray(points) ? points : [])
        .filter(p => Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1]))
        .map(([x, y]) => [Math.min(1, Math.max(0, +x)), Math.min(1, Math.max(0, +y))])
        .sort((a, b) => a[0] - b[0])
    const out = []
    for (const p of ok) if (!out.length || p[0] - out.at(-1)[0] >= MIN_GAP) out.push(p)
    if (out.length < 2) return STRAIGHT()
    return out.length > MAX_POINTS ? [out[0], ...out.slice(1, MAX_POINTS - 1), out.at(-1)] : out
}

/** Every curve's points normalised; a curve missing is straight. */
export function normalizeCurves(curves) {
    const c = curves && typeof curves === 'object' ? curves : {}
    return Object.fromEntries(CHANNELS.map(k => [k, normalizeCurve(c[k] ?? STRAIGHT())]))
}

/** A curve that changes nothing: the two ends where they started. */
export const curveIdentity = pts => pts.length === 2 && pts[0][0] === 0 && pts[0][1] === 0 && pts[1][0] === 1 && pts[1][1] === 1
export const curvesIdentity = curves => CHANNELS.every(k => curveIdentity(normalizeCurve(curves?.[k] ?? STRAIGHT())))

/** The curve through `points` (normalised) as a function of x in 0..1. */
export function curveFunction(points) {
    const p = normalizeCurve(points), n = p.length
    const xs = p.map(q => q[0]), ys = p.map(q => q[1])
    const d = []                                 // the secants
    for (let k = 0; k < n - 1; k++) d.push((ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]))
    const m = new Array(n)
    m[0] = d[0]; m[n - 1] = d[n - 2]
    for (let k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2
    // Fritsch-Carlson: where a secant is flat, both ends flat; where the slopes are too steep for it, scaled down
    for (let k = 0; k < n - 1; k++) {
        if (d[k] === 0) { m[k] = 0; m[k + 1] = 0; continue }
        const a = m[k] / d[k], b = m[k + 1] / d[k], s = a * a + b * b
        if (s > 9) { const t = 3 / Math.sqrt(s); m[k] = t * a * d[k]; m[k + 1] = t * b * d[k] }
    }
    return x => {
        if (x <= xs[0]) return ys[0]
        if (x >= xs[n - 1]) return ys[n - 1]
        let k = 0
        while (k < n - 2 && x > xs[k + 1]) k++
        const h = xs[k + 1] - xs[k], t = (x - xs[k]) / h, t2 = t * t, t3 = t2 * t
        const y = (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1]
        return Math.min(1, Math.max(0, y))
    }
}

/** The four curves as the develop pass's table: master, red, green, blue, LUT_SIZE values each. */
export function bakeLut(curves) {
    const c = normalizeCurves(curves)
    const lut = new Float32Array(4 * LUT_SIZE)
    CHANNELS.forEach((k, ch) => {
        const straight = curveIdentity(c[k]), f = straight ? null : curveFunction(c[k])
        for (let i = 0; i < LUT_SIZE; i++) {
            const x = i / (LUT_SIZE - 1)
            lut[ch * LUT_SIZE + i] = straight ? x : f(x)
        }
    })
    return lut
}

/** One channel of the table at x, as the develop pass samples it: linear between the two entries x falls between. */
export function lutSample(lut, ch, x) {
    const t = Math.min(1, Math.max(0, x)) * (LUT_SIZE - 1)
    const i = Math.min(Math.floor(t), LUT_SIZE - 2)
    const a = lut[ch * LUT_SIZE + i], b = lut[ch * LUT_SIZE + i + 1]
    return a + (b - a) * (t - i)
}
