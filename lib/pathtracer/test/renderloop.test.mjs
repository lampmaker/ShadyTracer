// node lib/pathtracer/test/renderloop.test.mjs
//
// THE LIVE LOOP HELD (lib/render-loop.js, opts.held and makeHolds), on fakes: a requestAnimationFrame the test runs
// by hand, a clock it moves, a cost instrument that never paces. What the builder's apply relies on: held, the loop
// submits nothing and stays running -- running() unchanged, the next frame asked for -- and submits again when let
// go; the governor does not read the hold as one very slow frame; a stop while held still stops it; holds nest and a
// release lets go once however often it runs. Nothing else ran this loop without a browser.

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}

// before the import: the module reads neither at load, but the loop reads both on every frame
let clock = 0, frames = []
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true, writable: true })
globalThis.requestAnimationFrame = f => { frames.push(f) }
const { makeRenderLoop, makeHolds, countResets } = await import('../../render-loop.js')

const tick = async (ms = 16) => {
    clock += ms
    const due = frames; frames = []
    for (const f of due) f()
    await new Promise(r => setTimeout(r, 0))       // the loop asks again after render()'s promise settles
}
const cost = () => ({ paced: () => false, frame() { }, record: f => f(), submitted() { }, reset() { } })

{
    const H = makeHolds()
    let submitted = 0
    const L = makeRenderLoop(() => { submitted++ }, cost(), { held: H.held, start: 3 })
    L.start()
    await tick(); await tick()
    ok('not held: a frame each tick', submitted === 2, `submitted ${submitted}`)
    const release = H.hold()
    const before = submitted
    for (let i = 0; i < 5; i++) await tick()
    ok('held: nothing submitted', submitted === before, `submitted ${submitted - before} while held`)
    ok('...still running, and the next frame asked for', L.running() && frames.length === 1, `running ${L.running()}, frames ${frames.length}`)
    release()
    await tick()
    ok('let go: it submits again, without a start', submitted === before + 1, `submitted ${submitted - before}`)
    L.stop()
}
{
    /* THE GOVERNOR: at 16 ms a frame the rate is over minfps * 1.15, so the count grows (3 -> 3.09, still 3 a frame).
       A frame measured across a 5 s hold would read 0.2 fps and shrink it (3 -> 2.91, 2 a frame): the hold taken for
       a slow scene. The held ticks move the clock on, so the first frame after measures one tick. */
    const H = makeHolds()
    const L = makeRenderLoop(() => { }, cost(), { held: H.held, start: 3, minfps: 20 })
    const release = H.hold()
    L.start()
    await tick(16); await tick(5000); await tick(16)
    release()
    await tick(16)
    ok('a long hold is not read as a slow frame: the count does not fall', L.samplesPerFrame() === 3, `samplesPerFrame ${L.samplesPerFrame()}`)
    L.stop()
}
{
    const H = makeHolds()
    let submitted = 0
    const L = makeRenderLoop(() => { submitted++ }, cost(), { held: H.held })
    L.start()
    const release = H.hold()
    await tick()
    L.stop()
    await tick()
    ok('a stop while held stops it: nothing asked for any more', !L.running() && frames.length === 0, `frames ${frames.length}`)
    release()
    await tick()
    ok('...and a release after does not start it', submitted === 0 && !L.running() && frames.length === 0)
}
{
    const H = makeHolds()
    const a = H.hold(), b = H.hold()
    a()
    ok('two holds, one let go: still held', H.held())
    a()
    ok('...that release run again lets go of nothing more', H.held())
    b()
    ok('...the second let go: free', !H.held())
    b()
    const c = H.hold()
    ok('a stale release never goes below nothing: a new hold holds', H.held())
    c()
    ok('...and its own release frees it', !H.held())
}
{
    // no `held` given: the loop as it always was
    let submitted = 0
    const L = makeRenderLoop(() => { submitted++ }, cost())
    L.start()
    await tick(); await tick(); await tick()
    ok('without opts.held: a frame each tick, as before', submitted === 3, `submitted ${submitted}`)
    L.stop()
}

{
    /* THE RESETS COUNTED (countResets): every truthy write of Q.resetframecount, the value still read and written as
       before -- the engine reads it before its first await, the loop consumes it -- and a 1 over a 1 counted too */
    const Q = { w: 8, resetframecount: 1 }
    const n = countResets(Q)
    ok('counted from now: the 1 the bag came with is not a reset seen', n() === 0 && Q.resetframecount === 1)
    Q.resetframecount = 0
    ok('consumed: no reset, the flag 0', n() === 0 && Q.resetframecount === 0)
    Q.resetframecount = 1
    ok('asked for: one, the flag 1', n() === 1 && Q.resetframecount === 1)
    Q.resetframecount = 1
    ok('asked for again before it was consumed: two', n() === 2)
    const L = makeRenderLoop(() => { }, cost(), { consumeReset: () => (Q.resetframecount ? (Q.resetframecount = 0, true) : false) })
    L.start()
    await tick()
    ok('the loop consumes it as before: 0, and the count kept', Q.resetframecount === 0 && n() === 2)
    L.stop()
    ok('...the bag still reads and spreads as a plain one', JSON.stringify({ ...Q }) === '{"w":8,"resetframecount":0}')
}

{
    /* WHAT A FRAME REALLY TRACED (opts.done; the pathtracer's sliced samples, 0.58.0): the rate counts that, part of a
       sample as that part; and a count the governor grew on the fast loop the renderer held back stays within one of it,
       so it is not handed whole to a frame the renderer would not hold back */
    let did = 1 / 8, asked = []
    const counted = []
    const c = { ...cost(), frame(n) { asked.push(n) }, done(n) { counted.push(n) } }
    const L = makeRenderLoop(n => { }, c, { start: 40, maxSamples: 64, minfps: 20, done: () => did })
    L.start()
    for (let i = 0; i < 5; i++) await tick(16)
    ok('the frame\'s share counted: an eighth of a sample each', counted.length === 5 && counted.every(n => n === 1 / 8), JSON.stringify(counted))
    ok('...and the count, fast loop or not, held at the sample and one: 2, not the 40 it started from', L.samplesPerFrame() === 2 && asked.at(-1) === 2, `${L.samplesPerFrame()} ${asked}`)
    did = 3
    for (let i = 0; i < 3; i++) await tick(16)
    ok('...a frame that traced 3 lets it be 4 at most', L.samplesPerFrame() <= 4 && L.samplesPerFrame() >= 2, `${L.samplesPerFrame()}`)
    L.stop()
    const L2 = makeRenderLoop(() => { }, cost(), { start: 5 })
    L2.start(); await tick(16); await tick(16)
    ok('...and without done, the count is the governor\'s alone, as before', L2.samplesPerFrame() === 5, `${L2.samplesPerFrame()}`)
    L2.stop()
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
