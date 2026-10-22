// node lib/pathtracer/test/runwatch.test.mjs
//
// THE RUN'S WATCH (lib/pathtracer/runwatch.js) and the test runner that uses it (tests.js makeTestBench), on fakes. Asked
// for when the scenedata benchmark lost the user's GPU at row 19 (Windows' DXGI_ERROR_DEVICE_HUNG, 2026-10-04) and sat
// on "...running": a run must end when the device is lost or a sample never comes back, keep what it measured, say
// where and why, and put back only what does not need the GPU. And no row whose compile is predicted to take minutes.
// A lost device and a hung GPU cannot be made here; a device whose `lost` the test resolves, and a renderFrame that never
// returns, are what the runner sees of them.
import { watchRun, Stopped, lostSays } from '../runwatch.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))
const never = () => new Promise(() => { })
const fakeDevice = () => {
    let lose
    const lost = new Promise(r => { lose = r })
    return { lost, lose: (reason, message) => lose({ reason, message }), queue: { onSubmittedWorkDone: async () => { } }, adapterInfo: { vendor: 'test' } }
}
// Dawn's message on the user's machine, first lines (the console, 2026-10-04)
const HUNG = 'ID3D12Device::GetDeviceRemovedReason failed with DXGI_ERROR_DEVICE_HUNG (0x887A0006)\n - While handling unexpected error type Internal when allowed errors are Validation.\n\nBackend messages:\n * Device removed reason: DXGI_ERROR_DEVICE_HUNG (0x887A0006)'

/* ---- the watch alone */
{
    ok('lostSays: the reason and the first line of the message only',
        lostSays({ reason: undefined, message: HUNG }) === 'the GPU was lost (unknown): ID3D12Device::GetDeviceRemovedReason failed with DXGI_ERROR_DEVICE_HUNG (0x887A0006)',
        lostSays({ message: HUNG }))
    ok('lostSays: no message, no colon', lostSays({ reason: 'destroyed', message: '' }) === 'the GPU was lost (destroyed)')

    const D = fakeDevice(), W = watchRun(D)
    ok('a step resolves as it does', await W.within(async () => 7) === 7 && W.why === null)
    let threw = null
    try { await W.within(async () => { throw new Error('its own') }) } catch (e) { threw = e }
    ok('a step\'s own error is its own, and stops nothing', threw?.message === 'its own' && !(threw instanceof Stopped) && W.why === null)

    const pending = W.within(never, Infinity, 'a sample')
    D.lose(undefined, HUNG)
    let e1 = null
    try { await pending } catch (e) { e1 = e }
    ok('a lost device ends the step waiting on it, with Stopped and why', e1 instanceof Stopped && /DXGI_ERROR_DEVICE_HUNG/.test(e1.why) && W.lost && W.why === e1.why, String(e1))
    let started = false, e2 = null
    try { await W.within(async () => { started = true }) } catch (e) { e2 = e }
    ok('...and every later step is refused without being started', e2 instanceof Stopped && !started)

    let tidied = false
    const t0 = Date.now(), r = await W.tidy(() => { tidied = true; return never() }, 60000)
    ok('tidy on a lost device: the step runs, and is not waited for', tidied && r === null && Date.now() - t0 < 1000)
}
{
    const W = watchRun(null)
    let e = null
    try { await W.within(never, 30, 'timed sample 2') } catch (x) { e = x }
    ok('a step past its time stops the run, saying which step and how long', e instanceof Stopped && /^timed sample 2 did not finish in /.test(W.why), W.why)
    ok('...no device is a device never lost', W.lost === null)
    const r = await W.tidy(async () => 3)
    ok('tidy after a stop that was not a loss still runs and waits for its step', r === null)
    const r2 = await W.tidy(async () => { throw new Error('restore failed') })
    ok('tidy resolves to a step\'s error, never throws', r2?.message === 'restore failed')
    const r3 = await W.tidy(never, 20)
    ok('tidy waits at most its time', /did not finish/.test(r3?.message ?? ''), String(r3))
}
{
    const W = watchRun(null)
    W.stop('by hand')
    let e = null
    try { await W.within(async () => 1) } catch (x) { e = x }
    ok('stop by hand refuses what follows', e instanceof Stopped && e.why === 'by hand')
}

/* ---- THE RUNNER on a stand-in renderer: makeTestBench's 'bench' path, which is where the loss happened */
const { makeTestBench } = await import('../tests.js')
const makeRig = ({ device = fakeDevice(), renderFrame, predict, limits } = {}) => {
    const log = []
    const user = { id: 'user', uniforms: {} }
    let off = null
    const RT = {
        scene: user, cam: { get: () => ({}), set: () => { } },
        settings: () => ({ values: { maxiter: 400 }, camera: { mode: 'orbit' }, size: { mode: 'fit' } }),
        applySettings: () => [], get: () => ({ maxiter: 400 }), set: () => [],
        setScene: async s => { log.push(`scene ${s.id}`); RT.scene = s },
        running: () => true, pause: () => log.push('pause'), resume: () => log.push('resume'),
        size: () => ({ mode: 'fit' }), setSize: () => { },
        beginOffscreen: async () => { off = { scene: RT.scene.id }; log.push(`begin ${RT.scene.id}`) },
        renderFrame: (n, p, s, o = {}) => { log.push(`frame ${RT.scene.id} x${n}${o.inFlight === 2 ? ' inflight' : ''} submitEvery=${RT.submitEvery}`); return renderFrame ? renderFrame(RT, n, o) : Promise.resolve() },
        endOffscreen: async () => { log.push(`end ${off?.scene}`); off = null },
        predictCompile: async s => (predict ? predict(s) : { expectMs: 1000, slowest: 'shade' }),
    }
    const ctx = { RT, Q: { w: 64, h: 64 }, COST: { lat: 0 }, WG: { device }, limits }
    return { RT, log, device, user, runner: makeTestBench(ctx) }
}
const S = ['a', 'b', 'c'].map(id => ({ id, uniforms: {} }))
const benchTest = (over = {}) => ({
    id: 'watch', title: 'the watch', kind: 'bench', size: { width: 64, height: 64 },
    warmup: { samples: 2, ms: 0 }, timed: { samples: 3, ms: 0, max: 8 }, pipelined: { samples: 4 },
    cases: S.map(s => ({ label: `row ${s.id}`, scene: s })), ...over,
})
const quiet = async f => { const l = console.log, e = console.error; console.log = () => { }; console.error = () => { }; try { return await f() } finally { console.log = l; console.error = e } }

{
    /* THE USER'S CASE: the GPU lost during row 2's "one sample in flight", its timed samples done */
    const rig = makeRig({ renderFrame: (RT, n, o) => {
        if (RT.scene.id === 'b' && o.inFlight === 2) { setTimeout(() => rig.device.lose(undefined, HUNG), 5); return never() }
        return Promise.resolve()
    } })
    const out = await quiet(() => rig.runner.run(benchTest()))
    ok('a lost device ends the run instead of hanging, and run() returns', !!out?.stopped)
    ok('...saying the row, its number and why', out.stopped.row === 2 && out.stopped.of === 3 && out.stopped.label === 'row b' && out.stopped.lost === true
        && /DXGI_ERROR_DEVICE_HUNG/.test(out.stopped.why), JSON.stringify(out.stopped))
    ok('...row 1 whole, row 2 with the samples it had timed, row 3 never begun',
        out.rows.length === 2 && out.rows[0].timedSamples === 3 && !out.rows[0].stopped
        && out.rows[1].case === 'row b (stopped)' && out.rows[1].timedSamples === 3 && out.rows[1].warmupSamples === 2 && Number.isFinite(out.rows[1].msPerSample)
        && !rig.log.some(l => /^(scene|begin) c/.test(l)), JSON.stringify(out.rows.map(r => [r.case, r.timedSamples])))
    ok('...the report says STOPPED, where, the first line of the loss, and to reload',
        /STOPPED at row 2 of 3 \(row b\): the GPU was lost \(unknown\): ID3D12Device/.test(out.text) && !/While handling/.test(out.text)
        && /reloaded/.test(out.text) && /STOPPED part way/.test(out.text) && /"stopped": \{/.test(out.text), out.text.split('\n').filter(l => /STOP/.test(l)).join(' | '))
    ok('...nothing that needs the GPU put back: no scene compiled, the loop not resumed; the offscreen target let go',
        !rig.log.includes('scene user') && !rig.log.includes('resume') && rig.log.includes('end b'), rig.log.slice(-6).join(', '))
    ok('...the offscreen target let go before the run puts anything back', rig.log.indexOf('end b') < rig.log.lastIndexOf('pause'), rig.log.slice(-4).join(', '))

    /* ...and a run after it on the same lost device stops at its first step, starting nothing */
    const n = rig.log.length
    const again = await quiet(() => rig.runner.run(benchTest()))
    ok('a run on a device already lost stops at once, compiling and rendering nothing',
        again.stopped?.row === 1 && again.stopped.lost && again.rows.length === 0 && !rig.log.slice(n).some(l => /^(scene|begin|frame)/.test(l)), rig.log.slice(n).join(', '))
}
{
    /* A SAMPLE THAT NEVER COMES BACK, the device not lost (a hang no reset reports): stopped after its time */
    const rig = makeRig({ limits: { sampleMs: 40 }, renderFrame: (RT, n, o) => {
        if (RT.scene.id === 'b' && rig.log.filter(l => l.startsWith('frame b')).length === 4) return never()   // 2 warm-up, timed 1, then 2 never
        return Promise.resolve()
    } })
    const out = await quiet(() => rig.runner.run(benchTest()))
    ok('a sample past its time stops the run, naming the sample', out.stopped?.row === 2 && out.stopped.lost === false && /^timed sample 2 did not finish in /.test(out.stopped.why), JSON.stringify(out.stopped))
    ok('...row 2 kept with its one timed sample', out.rows.length === 2 && out.rows[1].timedSamples === 1, JSON.stringify(out.rows.map(r => r.timedSamples)))
    ok('...the device not lost, so the user\'s scene is put back and the loop resumed', rig.log.includes('scene user') && rig.log.at(-1) === 'resume', rig.log.slice(-4).join(', '))
    ok('...after the offscreen target is let go, never while it is still set', rig.log.indexOf('end b') >= 0 && rig.log.indexOf('end b') < rig.log.indexOf('scene user'), rig.log.slice(-4).join(', '))
    ok('...and the report does not tell anyone to reload', /STOPPED at row 2 of 3/.test(out.text) && !/reloaded/.test(out.text))
}
{
    /* A ROW PREDICTED OVER THE LIMIT is not run: its scene never set, the rows around it run */
    const rig = makeRig({ predict: s => ({ expectMs: s.id === 'b' ? 11 * 60000 : 4000, slowest: 'shade' }) })
    const out = await quiet(() => rig.runner.run(benchTest()))
    ok('a row predicted at 11 minutes is not run, and says why', !out.stopped && out.rows.length === 3 && /predicted 11\.0 min to compile \(shade\)/.test(out.rows[1].skipped ?? '')
        && out.rows[1].compileMs === '~11.0 min' && out.rows[1].timedSamples === undefined, JSON.stringify(out.rows[1]))
    ok('...its scene never compiled, nor rendered', !rig.log.some(l => /^(scene|begin|frame) b/.test(l)) && rig.log.includes('scene a') && rig.log.includes('scene c'))
    ok('...the report marks it NOT RUN, with no NaN anywhere', /row b .*NOT RUN: predicted 11\.0 min/.test(out.text) && !/NaN/.test(out.text.split('JSON')[0]))
}
{
    /* THE PIN: one submission a sample only where every timed sample is under the engine's split (250 ms) */
    const real = performance.now
    let clock = 0
    performance.now = () => clock
    try {
        const rig = makeRig({ renderFrame: (RT, n) => { clock += n * (RT.scene.id === 'b' ? 300 : 20); return Promise.resolve() } })
        const out = await quiet(() => rig.runner.run(benchTest()))
        const inflight = rig.log.filter(l => / inflight /.test(l))
        ok('a sample of 20 ms: its in-flight stretch one submission a sample, as before', /^frame a x4 inflight submitEvery=1000000$/.test(inflight[0]) && out.rows[0].pipelinedSubmits === 'one a sample', inflight[0])
        ok('a sample of 300 ms: the engine\'s own submissions, never one a sample', /^frame b x4 inflight submitEvery=undefined$/.test(inflight[1]) && out.rows[1].pipelinedSubmits === 'the engine\'s', inflight[1])
        ok('...and the setting put back after', rig.RT.submitEvery === undefined)
    } finally { performance.now = real }
}

/* ---- EVERY TEST'S CAMERA NAMES ITS TARGET (0.62.1). The runner sets a test's camera, and a row's, over the view's: one
   without a target orbits the view's own, in the view's scene's unit -- a builder scene's 40 mm read as 40 m by a metre
   test scene. The first press of `haze` (the user, 2026-10-16) looked at sky that way, every row exactly the environment,
   its control with them. Only the tests that name a camera: one that names none runs on the view by design. */
{
    const { TESTS } = await import('../tests.js')
    const targeted = cam => Array.isArray(cam.target) && cam.target.length === 3 && cam.target.every(Number.isFinite)
    const loose = TESTS.filter(t => t.kind !== 'bench').flatMap(t => [
        ...(t.camera && !targeted(t.camera) ? [t.id] : []),
        ...(t.cases || []).filter(c => c.camera && !targeted(c.camera)).map(c => `${t.id}: ${c.label}`),
    ])
    ok('every test camera, and every row\'s, names its target', loose.length === 0, loose.join(' | '))
    ok('...the haze test\'s too, at the origin its furnace is built around', TESTS.find(t => t.id === 'haze')?.camera?.target?.join() === '0,0,0')
}

/* ---- RUN SEVERAL (0.next): a group's Run all on the stand-in -- the summary first, one line a test, then the reports;
   a run stopped by a lost device ends the list there and says so */
{
    const rig = makeRig()
    const two = [benchTest(), benchTest({ id: 'watch-2', title: 'the watch again' })]
    const out = await quiet(() => rig.runner.runAll(two))
    ok('runAll(tests): every test run, a result each', out.results?.length === 2 && out.results.every(r => r.verdict))
    ok('...the summary first, a line a test, the reports after', /^=== SUMMARY · 2 of 2 tests/.test(out.text)
        && /\nwatch +INFO/.test(out.text) && /\nwatch-2 +INFO/.test(out.text) && out.text.indexOf('=== watch ·') > out.text.indexOf('=== SUMMARY'))
    const lost = makeRig({ renderFrame: (RT, n, o) => {
        if (RT.scene.id === 'b' && o.inFlight === 2) { setTimeout(() => lost.device.lose(undefined, HUNG), 5); return never() }
        return Promise.resolve()
    } })
    const cut = await quiet(() => lost.runner.runAll(two))
    ok('...a lost device stops the list after its test, saying so', cut.results.length === 1 && /Run all stopped after watch:/.test(cut.text)
        && /SUMMARY · 1 of 2 tests/.test(cut.text))
}

/* ---- THE TESTS PANEL (0.next): a folder a group, its Run all first and its tests in order, "your scene" where a test
   loads none of its own, a host's test in the group it names -- on a stand-in property table */
{
    const { installTestMenu, GROUPS, TESTS: ALL } = await import('../tests.js')
    const folder = (title, into) => {
        const f = { title, folders: [], buttons: [], clicks: {} }
        f.addFolder = ({ title }) => { const c = folder(title); f.folders.push(c); return c }
        f.addButton = ({ title }) => { f.buttons.push(title); return { on: (_, fn) => { f.clicks[title] = fn } } }
        return f
    }
    const menu = folder('menu')
    globalThis.window ??= {}
    const rig = makeRig()
    const bench = installTestMenu(menu, { RT: rig.RT, Q: { w: 64, h: 64 }, COST: { lat: 0 }, WG: { device: fakeDevice() } })
    const top = menu.folders[0]
    ok('the panel: Tests, its Run all first, then a folder a group in order', top.title === 'Tests' && top.buttons[0] === 'Run all (6 groups, not Speed or Benchmarks)'
        && top.folders.map(f => f.title).join() === GROUPS.map(g => g.title).join())
    const units = top.folders[0]
    ok('...a group\'s own Run all first, its tests after in the group\'s order', units.buttons[0] === 'Run all — Light & units'
        && units.buttons.slice(1).map(b => b.split(' — ')[0]).join() === GROUPS[0].ids.join())
    const flat = top.folders.flatMap(f => f.buttons.filter(b => !b.startsWith('Run all')))
    ok('...every test once', flat.length === ALL.length && ALL.every(t => flat.some(b => b.startsWith(`${t.id} — `) || b.startsWith(`${t.id} (your scene) — `))))
    ok('...a test on the scene shown says so, one with its own does not', flat.some(b => b.startsWith('lt (your scene) — '))
        && flat.some(b => b.startsWith('photometry — ') && !b.includes('(your scene)')))
    ok('...the benchmarks\' folder empty until the page adds them, with no Run all', top.folders.at(-1).buttons.length === 0)
    bench.addTest({ id: 'light-vs-emitter', title: 'a host test', group: 'lights', prepare: async () => ({}) })
    bench.addTest({ id: 'bench', title: 'a benchmark', prepare: async () => ({}) })
    ok('...a host\'s test in the group it names, a benchmark in the benchmarks\'', top.folders[1].buttons.at(-1) === 'light-vs-emitter — a host test'
        && top.folders.at(-1).buttons.join() === 'bench — a benchmark')
}

console.log(`runwatch: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
