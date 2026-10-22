//======================================================================================================================
// VERDICT.JS -- does a test's row pass? (tests.js runs it; no DOM, no GPU, so Node tests it)
//
// WHY. Every test's note says what to compare and the user compared it by eye, thirty reports at a time. The 0.77.0
// run (the user's Pascal, 2026-10-22) had three misses in it that reading had to find: draft-lamps' lamps-only row 3%
// low, optics-mode's x 0.5 sensor 5 sigma off its baseline, and an emitters test that measured a black picture. So
// each test now carries a rule (tests.js `verdict`), and this file is what the rules are written in.
//
// THE BANDS. A row's miss against its answer is judged against two allowances, whichever is wider:
//   3 sigma   its own error bar -- the noise it reports, so a noisy row is not failed for being noisy;
//   floor     what its note says the code is allowed (a few 1e-3 for the optics trace, 0.5% for a floor's lux) --
//             THE FLOORS ARE CHOICES, read from the notes and the 0.77.0 run, not measurements of anything.
// PASS within that; CHECK out to 5 sigma or twice the floor (worth a rerun: one row in a few hundred lands there by
// chance); FAIL beyond. INFO: no known answer (a speed, Sketch's fixed light). VOID: nothing was measured (a test on
// the scene shown, and the scene had nothing for it), which is never a pass.
//
// THE ERROR BAR OF A PICTURE'S MEAN (meanSe) assumes its pixels' errors independent. They are not wherever pixels
// share light: light tracing's photons, the photon map, an emitter found partway through. There it is too small, and
// the floor is what keeps such a row from failing on its own noise -- or, where a shared error is the bug (an
// emitter found late), what lets it fail.
//======================================================================================================================

export const PASS = 'PASS', CHECK = 'CHECK', FAIL = 'FAIL', INFO = 'INFO', VOID = 'VOID'
// worst first: what a test reads when its rows differ
const RANK = { [FAIL]: 4, [VOID]: 3, [CHECK]: 2, [PASS]: 1, [INFO]: 0 }

const fin = v => typeof v === 'number' && Number.isFinite(v)
const g = v => {
    if (!fin(v)) return String(v)
    const a = Math.abs(v)
    return a !== 0 && (a < 1e-3 || a >= 1e6) ? v.toExponential(2) : +v.toPrecision(5) + ''
}
const label = what => what ? `${what} ` : ''

export const info = why => ({ status: INFO, why })
export const none = why => ({ status: VOID, why })
export const pass = why => ({ status: PASS, why })
export const fail = why => ({ status: FAIL, why })
export const check = why => ({ status: CHECK, why })

/** A reading against its answer. `se`: the reading's standard error (null: none known), `floor`: the allowance its
 *  note gives, in the reading's own units. With no error bar a miss past the floor is never a PASS: CHECK out to ten
 *  floors (sppm's map-off rows, which report none), FAIL past that. */
export function near(v, expected, { se = null, floor = 0, what = '' } = {}) {
    if (!fin(v)) return none(`${label(what)}not measured (${v})`)
    const miss = Math.abs(v - expected)
    const s = fin(se) && se > 0 ? se : null
    const tol = Math.max(s ? 3 * s : 0, floor), wide = Math.max(s ? 5 * s : 0, 2 * floor)
    const by = s && 3 * s >= floor ? '3σ' : 'floor'
    const say = `${label(what)}${g(v)}, expected ${g(expected)} ± ${g(tol)} (${by})`
    if (miss <= tol) return pass(say)
    if (!s) return miss <= 10 * floor ? check(`${say}; no error bar to judge by`) : fail(say)
    const sig = `${(miss / s).toFixed(1)}σ`
    if (miss > wide) return fail(`${say}: ${sig}`)
    // inside 5 sigma it may be noise, and a rerun says; past it, it is the floor that is in question, not the noise
    return check(miss <= 5 * s ? `${say}: ${sig}, rerun` : `${say}: ${sig}, but within twice the floor`)
}

/** Two readings that must agree: a / b against 1, the error bars combined, the floor relative. */
export function agree(a, b, { seA = null, seB = null, floor = 0, what = '' } = {}) {
    if (!fin(a) || !fin(b)) return none(`${label(what)}not measured (${a} against ${b})`)
    if (b === 0) return a === 0 ? pass(`${label(what)}0 and 0`) : fail(`${label(what)}${g(a)} against 0`)
    const se = fin(seA) && fin(seB) ? Math.hypot(seA, seB) / Math.abs(b) : null
    return near(a / b, 1, { se, floor, what: `${label(what)}ratio` })
}

/** A control or a bound: v below `limit` (above it, with `above`). */
export const below = (v, limit, what = '') => !fin(v) ? none(`${label(what)}not measured`)
    : v < limit ? pass(`${label(what)}${g(v)} < ${g(limit)}`) : fail(`${label(what)}${g(v)}, must be below ${g(limit)}`)
export const above = (v, limit, what = '') => !fin(v) ? none(`${label(what)}not measured`)
    : v > limit ? pass(`${label(what)}${g(v)} > ${g(limit)}`) : fail(`${label(what)}${g(v)}, must be above ${g(limit)}`)
export const exactly = (v, x, what = '') => !fin(v) ? none(`${label(what)}not measured`)
    : v === x ? pass(`${label(what)}exactly ${g(x)}`) : fail(`${label(what)}${g(v)}, must be exactly ${g(x)}`)
export const between = (v, lo, hi, what = '') => !fin(v) ? none(`${label(what)}not measured`)
    : v >= lo && v <= hi ? pass(`${label(what)}${g(v)} in [${g(lo)}, ${g(hi)}]`) : fail(`${label(what)}${g(v)}, outside [${g(lo)}, ${g(hi)}]`)

/** A row that must NOT match -- the failure a change removed, kept visible (a known limit, an old setting): a / b
 *  off 1 by more than `by`. */
export function mustDiffer(a, b, by, what = '') {
    if (!fin(a) || !fin(b) || b === 0) return none(`${label(what)}not measured`)
    const off = Math.abs(a / b - 1)
    const say = `${label(what)}${g(a)} against ${g(b)}: ${(off * 100).toFixed(2)}% apart`
    return off > by ? pass(`${say}, as it must be`) : fail(`${say}, must differ by over ${(by * 100).toFixed(1)}%`)
}

/** Several results as one: the worst status, the reasons of the results that have it. */
export function worst(results) {
    const rs = results.filter(Boolean)
    if (!rs.length) return info('nothing to judge')
    const top = rs.reduce((m, r) => RANK[r.status] > RANK[m.status] ? r : m)
    return { status: top.status, why: rs.filter(r => r.status === top.status).map(r => r.why).join('; ') }
}

/** The standard error of an image row's meanLuma, from what the row already carries: relSE is the rms of the
 *  pixels' own errors over the mean (raytrace_main.js imageStats), so the mean of n of them has relSE mean / sqrt(n)
 *  -- if they are independent (see the header). null without an error bar. */
export const meanSe = r => fin(r?.relSE) && fin(r?.meanLuma) && r.pixels > 0
    ? r.relSE * Math.abs(r.meanLuma) / Math.sqrt(r.pixels * (fin(r.covered) ? r.covered : 1)) : null

/** The standard error of an optics share p over n rays: exact for rays of one weight, roughly right for coloured. */
export const shareSe = (p, n) => fin(p) && n > 0 && p >= 0 && p <= 1 ? Math.sqrt(p * (1 - p) / n) : null

/** Image rows that must agree with a reference row on meanLuma (nee, lt, rr-bias...): each its own error bar. No
 *  reference is INFO, not VOID: a running report has not reached it yet (lt's is its third row), and a run of chosen
 *  rows (the console's) may leave it out on purpose. */
export const agreeMean = (r, ref, floor, what = 'meanLuma') => ref
    ? agree(r.meanLuma, ref.meanLuma, { seA: meanSe(r), seB: meanSe(ref), floor, what }) : info('its reference row has not run')

/** Every sensor of a row against 1 (disc-light's rho columns, optics-mode's x columns): one error bar, the worst. */
export const sensors = (ratios, se, floor, names = []) => worst((ratios || []).map((v, i) =>
    v === null || v === undefined ? null : near(v, 1, { se, floor, what: names[i] ?? `sensor ${i + 1}` })))

/** A test's rows judged: each row gets `verdict`, and the test its status and counts. A rule that throws is a bug in
 *  the rule, not the renderer: CHECK, with what it threw. */
export function judge(test, rows) {
    const counts = { pass: 0, check: 0, fail: 0, info: 0, void: 0 }
    for (const [i, r] of rows.entries()) {
        let v
        if (r.skipped) v = info(`not run: ${r.skipped}`)
        else if (r.stopped) v = check(`stopped part way: ${r.stopped}`)
        else if (!test.verdict) v = info('no known answer: the numbers are for reading')
        else {
            try { v = test.verdict(r, i, rows, test.cases?.[i]) ?? info('no known answer') }
            catch (e) { v = check(`the rule threw: ${e?.message ?? e}`) }
        }
        r.verdict = v
        counts[v.status.toLowerCase()]++
    }
    const status = rows.length ? worst(rows.map(r => r.verdict)).status : VOID
    return { status, counts }
}

/** One line for a test: `FAIL · 9 pass · 1 check · 1 fail`. */
export const summarize = ({ status, counts }) => [status,
    ...Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`)].join(' · ')
