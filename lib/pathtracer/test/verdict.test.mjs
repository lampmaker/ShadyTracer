// node lib/pathtracer/test/verdict.test.mjs
//
// THE TESTS' VERDICTS AND GROUPS (verdict.js, tests.js GROUPS and each test's `verdict`), no GPU. Asked for when the
// Tests panel was some forty buttons in the order they were written and every report was read by eye (the user,
// 2026-10-22): a pass, a check or a fail a row, and the tests in folders. Pinned here --
//   THE BANDS: PASS within 3 sigma or the floor, CHECK out to 5 sigma or twice the floor, FAIL past it; no error bar
//     never a PASS past the floor; the controls, the zeros, a row that must differ; the worst of several.
//   THE GROUPS: every test in exactly one, every id a test, the top Run all the groups with a known answer and not
//     Speed; "your scene" on exactly the tests that load no scene of their own.
//   THE RULES RUN: the user's 0.77.0 run (Pascal, test/fixtures) replayed through every rule -- each test's verdict
//     what that run deserved (the integrating sphere's solid ball FAIL, the emitters test on a scene with none VOID,
//     the misses read in it: draft-lamps' lamps only, optics-mode's x 0.5), and a miss planted in each kind caught.
//   THE REPORT: a verdict column, no number run into the next (the mm rows' 23730080.540728 was), the summary.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const V = await import('../verdict.js')
const { TESTS, GROUPS, onSceneShown, format, summaryTable } = await import('../tests.js')

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}

// ---- the bands
{
    const n = (v, o) => V.near(v, 1, o).status
    ok('near: inside 3σ a PASS', n(1.0299, { se: 0.01 }) === V.PASS)
    ok('near: past 3σ, inside 5σ, a CHECK', n(1.0301, { se: 0.01 }) === V.CHECK && n(1.0499, { se: 0.01 }) === V.CHECK)
    ok('near: past 5σ a FAIL', n(1.051, { se: 0.01 }) === V.FAIL)
    ok('near: the floor when it is wider than 3σ', n(1.004, { se: 0.0001, floor: 0.005 }) === V.PASS)
    ok('near: past the floor, inside twice it, a CHECK -- however many σ', n(1.009, { se: 0.0001, floor: 0.005 }) === V.CHECK
        && /within twice the floor/.test(V.near(1.009, 1, { se: 0.0001, floor: 0.005 }).why))
    ok('near: past twice the floor and 5σ, a FAIL', n(1.011, { se: 0.0001, floor: 0.005 }) === V.FAIL)
    ok('near: no error bar, past the floor, never a PASS', n(1.02, { floor: 0.005 }) === V.CHECK
        && /no error bar/.test(V.near(1.02, 1, { floor: 0.005 }).why))
    ok('near: no error bar, past ten floors, a FAIL', n(1.06, { floor: 0.005 }) === V.FAIL)
    ok('near: nothing measured is VOID, never a pass', n(null, { floor: 1 }) === V.VOID && n(NaN, { floor: 1 }) === V.VOID)
    ok('agree: the error bars combined', V.agree(102.9, 100, { seA: 0.8, seB: 0.6, floor: 0 }).status === V.PASS
        && V.agree(103.5, 100, { seA: 0.8, seB: 0.6, floor: 0 }).status === V.CHECK)
    ok('agree: 0 against 0 passes, against something fails', V.agree(0, 0).status === V.PASS && V.agree(1, 0).status === V.FAIL)
    ok('below / above / exactly / between', V.below(0.4, 0.5).status === V.PASS && V.below(0.5, 0.5).status === V.FAIL
        && V.above(1, 0).status === V.PASS && V.exactly(0, 0).status === V.PASS && V.exactly(1e-9, 0).status === V.FAIL
        && V.between(0.95, 0.9, 1).status === V.PASS && V.between(1.01, 0.9, 1).status === V.FAIL)
    ok('mustDiffer: a known limit passes by missing', V.mustDiffer(0.923, 0.857, 0.03).status === V.PASS
        && V.mustDiffer(0.86, 0.857, 0.03).status === V.FAIL)
    ok('worst: FAIL over VOID over CHECK over PASS over INFO',
        V.worst([V.pass('a'), V.check('b'), V.info('c')]).status === V.CHECK
        && V.worst([V.check('b'), V.none('d')]).status === V.VOID && V.worst([V.none('d'), V.fail('e')]).status === V.FAIL
        && V.worst([V.info('c')]).status === V.INFO)
    ok('meanSe: relSE x mean over the root of the pixels', Math.abs(V.meanSe({ relSE: 2, meanLuma: 100, pixels: 10000, covered: 1 }) - 2) < 1e-12
        && V.meanSe({ relSE: null, meanLuma: 1, pixels: 1 }) === null)
    const t = { verdict: () => { throw new Error('boom') }, cases: [{}, {}] }
    const rows = [{ case: 'a' }, { case: 'b', skipped: 'too long' }]
    const j = V.judge(t, rows)
    ok('judge: a rule that throws is a CHECK, saying so -- the rule\'s bug, not the renderer\'s',
        rows[0].verdict.status === V.CHECK && /boom/.test(rows[0].verdict.why))
    ok('judge: a row not run is INFO, and counted', rows[1].verdict.status === V.INFO && j.counts.check === 1 && j.counts.info === 1)
}

// ---- the groups
{
    const ids = TESTS.map(t => t.id)
    const grouped = GROUPS.flatMap(g => g.ids)
    ok('every test in exactly one group', ids.every(id => grouped.filter(x => x === id).length === 1),
        ids.filter(id => grouped.filter(x => x === id).length !== 1).join(', '))
    ok('every id a group lists is a test', grouped.every(id => ids.includes(id)), grouped.filter(id => !ids.includes(id)).join(', '))
    ok('the top Run all: every group with a known answer, not Speed and not the benchmarks',
        GROUPS.filter(g => g.inRunAll).map(g => g.id).join() === 'units,lights,materials,estimators,modes,optics')
    ok('the speed tests are the cost tests, every one', GROUPS.find(g => g.id === 'speed').ids.sort().join()
        === TESTS.filter(t => t.kind === 'cost').map(t => t.id).sort().join())
    const shown = TESTS.filter(onSceneShown).map(t => t.id).sort().join()
    ok('"your scene" on the tests that load none of their own', shown
        === ['cost-sweep', 'emitters', 'frame-cost', 'iteration-cost', 'lt', 'nee', 'nee-cost', 'nee-split', 'render-modes-cost', 'rr-bias'].join(), shown)
    ok('a rule on every test with a known answer, none on a speed', TESTS.every(t => (t.kind === 'cost') === !t.verdict),
        TESTS.filter(t => (t.kind === 'cost') === !!t.verdict).map(t => t.id).join(', '))
}

// ---- the 0.77.0 run replayed
const fx = JSON.parse(readFileSync(join(here, 'fixtures/run-0.77.0-pascal.json'), 'utf8')).tests
const replay = (id, edit = rows => rows) => {
    const test = TESTS.find(t => t.id === id), f = fx[id]
    const rows = edit(f.rows.map(r => ({ pixels: f.pixels, covered: 1, ...structuredClone(r) })))
    return { test, rows, verdict: V.judge(test, rows) }
}
{
    const want = {
        photometry: V.PASS, 'error-bar': V.PASS, illuminance: V.PASS, 'cosine-law': V.PASS, scale: V.PASS,
        'disc-light': V.PASS, 'small-emitter': V.PASS, emitters: V.VOID,
        furnace: V.CHECK, haze: V.PASS, 'bsdf-parity': V.PASS,
        nee: V.PASS, 'nee-split': V.PASS, lt: V.PASS, 'small-caustic': V.CHECK, sppm: V.CHECK, 'rr-bias': V.PASS,
        'render-modes': V.PASS, 'draft-lamps': V.FAIL, 'optics-mode': V.FAIL, 'optics-light': V.PASS,
        'optics-balance': V.FAIL, 'optics-refraction': V.PASS, 'optics-absorption': V.PASS, 'optics-coating': V.PASS,
        'optics-dispersion': V.PASS, 'optics-colour': V.PASS, 'optics-farfield': V.PASS,
        'cost-sweep': V.INFO, 'nee-cost': V.INFO,
    }
    const results = []
    for (const id of Object.keys(want)) {
        const test = TESTS.find(t => t.id === id)
        ok(`${id}: the fixture's rows are the test's, in order`, test && fx[id].rows.length === test.cases.length
            && fx[id].rows.every((r, i) => r.case === test.cases[i].label))
        const r = replay(id)
        results.push(r)
        ok(`${id}: the 0.77.0 run reads ${want[id]}`, r.verdict.status === want[id],
            `${V.summarize(r.verdict)} -- ${r.rows.filter(x => x.verdict.status !== V.PASS).map(x => `${x.case}: ${x.verdict.status} ${x.verdict.why}`).join(' | ')}`)
        ok(`${id}: every row judged by its rule`, test.kind === 'cost'
            || r.rows.every(x => !/no known answer/.test(x.verdict.why)))
    }
    const not = (id, rows) => results.find(r => r.test.id === id).rows.flatMap((x, i) => x.verdict.status === V.PASS || x.verdict.status === V.INFO ? [] : [i + 1])
    ok('...the failing rows are the ones read in the run: the solid sphere\'s two', not('optics-balance').join() === '10,11')
    ok('...draft-lamps\' lamps only, 3% under Draft', not('draft-lamps').join() === '4')
    ok('...optics-mode\'s 2 stops down, x 0.5 at 5σ', not('optics-mode').join() === '3'
        && /x 0\.5/.test(results.find(r => r.test.id === 'optics-mode').rows[2].verdict.why))
    ok('...the furnace\'s dichroic on every face, NEE on and off', not('furnace').join() === '27,28')
    ok('...sppm\'s map rows against a reference with no error bar', not('sppm').join() === '2,3,5')

    // the summary: one line a test, a reason given once for rows that share it
    const sum = summaryTable(results, TESTS.length)
    ok('summary: one line a test, then the total', results.every(r => sum.includes(`${r.test.id.padEnd(17)}  ${V.summarize(r.verdict)}`))
        && /\nall +FAIL · /.test(sum), sum.split('\n').slice(0, 3).join(' / '))
    ok('summary: six rows out for one reason said once', /rows 1, 2, 3, 4, 5, 6 VOID: no emitter found/.test(sum)
        && (sum.match(/no emitter found/g) || []).length === 1)

    // the report: a verdict column, and no number running into the next
    const om = results.find(r => r.test.id === 'optics-mode'), txt = format(om.test, om.rows, true)
    ok('report: a verdict column and a summary line', /  verdict\n/.test(txt) && /verdict: FAIL · 4 pass · 1 fail/.test(txt)
        && txt.split('\n').some(l => /^Optics, flat light 2 stops down.*  FAIL   x 0\.5/.test(l)))
    ok('report: the mm row\'s meanLuma and Δ in cells of their own', /\s4476524\.105696\s/.test(txt) && /\s\+93307461\.56%\s/.test(txt))
    ok('report: the verdict in the JSON, the test\'s and each row\'s', /"verdict": \{\n\s+"status": "FAIL"/.test(txt))
}

// ---- a miss planted in each kind is caught, and the shell's rows pass as the arithmetic says
{
    const at = (id, i, patch) => replay(id, rows => (Object.assign(rows[i], patch), rows))
    ok('planted: a floor 3% dark fails photometry', at('photometry', 0, { meanLuma: 21826 * 0.97 }).verdict.status === V.FAIL)
    ok('planted: an albedo-1 sphere 1% bright fails the furnace', at('furnace', 0, { meanLuma: 1010 }).verdict.status === V.FAIL)
    ok('planted: a slab 1% dark fails the optics trace', at('optics-refraction', 0, { measured: 0.923 * 0.99 }).verdict.status === V.FAIL)
    ok('planted: flux lost between the tallies fails the optics trace', at('optics-absorption', 0, { balance: 1e-3 }).verdict.status === V.FAIL)
    ok('planted: a sensor 30% off (6σ) fails disc-light', at('disc-light', 0, { discRatio: [1.3, 1, 1, 1] }).verdict.status === V.FAIL)
    ok('planted: NEE on 10% off NEE off, with its tiny error bar, fails nee', at('nee', 3, { meanLuma: 15618 * 1.1 }).verdict.status === V.FAIL)
    ok('planted: a control reading 1 fails the furnace -- the sphere was never drawn', at('furnace', 33, { meanLuma: 1000 }).verdict.status === V.FAIL)
    ok('planted: the known limit read right fails -- the gap would no longer be jumped', at('optics-refraction', 8, { measured: 0.8571 }).verdict.status === V.FAIL)
    const shell = replay('optics-balance', rows => {
        Object.assign(rows[9], { measured: 5 * (1 - 0.8 ** 65) }); Object.assign(rows[10], { measured: 2 * (1 - 0.5 ** 65) }); return rows })
    ok('the shell: arrived 1 / (1 - rho) cut at the bounce cap passes', shell.verdict.status === V.PASS, V.summarize(shell.verdict))
    const lit = replay('emitters', rows => rows.map((r, i) => ({ ...r, meanLuma: 100 + (i === 2 ? 2 : 0), relSE: 1, emitters: 1 })))
    ok('emitters: on a scene with an emitter, judged, not VOID', lit.verdict.status === V.PASS, V.summarize(lit.verdict))
    // a report while lt runs: its first rows judged against its third, which has not run yet -- INFO, not VOID
    const early = replay('lt', rows => rows.slice(0, 2))
    ok('a reference row not run yet: INFO, not VOID', early.rows.every(r => r.verdict.status === V.INFO), V.summarize(early.verdict))
}

// ---- the light bench's rule (builder/lightbench.js), a host test with a rule of its own
{
    const { lightBench } = await import('../../../builder/lightbench.js')
    const t = lightBench()
    const rows = t.cases.map(c => ({ case: c.label, meanLuma: 100, relSE: 0.5, pixels: 424502, covered: 1,
        emitters: c.as === 'emitter' ? 1 : 0, ...(c.sensors ? { discRatio: [1, 1, 1], discSe: 0.02 } : {}),
        ...(c.faceWant != null ? { faceL: c.faceWant } : {}) }))
    // the automatic tolerance's pair reads its known 0.82
    const auto = t.cases.findIndex(c => c.as === 'light' && c.pair.includes('the automatic eps'))
    rows[auto].meanLuma = 82
    ok('light-vs-emitter: agreeing pairs, the known limit at 0.82, the faces as wanted -- PASS', V.judge(t, rows).status === V.PASS,
        rows.filter(r => r.verdict.status !== V.PASS && r.verdict.status !== V.INFO).map(r => `${r.case}: ${r.verdict.why}`).join(' | '))
    rows[0].meanLuma = 90
    ok('...a light 10% under its emitter fails', V.judge(t, rows).status === V.FAIL && rows[1].verdict.status === V.FAIL)
    rows[0].meanLuma = 100; rows[auto].meanLuma = 100
    ok('...the automatic tolerance reading 1 fails: the limit it shows is gone, or the pair no longer tests it', V.judge(t, rows).status === V.FAIL)
}

console.log(`verdict: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
