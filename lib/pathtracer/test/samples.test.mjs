// node lib/pathtracer/test/samples.test.mjs
//
// THE OFFSCREEN SAMPLE LOOP (lib/pathtracer/samples.js), on fakes: a trace that submits, a GPU whose "done" the test
// resolves in order. What it checks is what a save relies on: one in flight is the loop as it always was; two never
// lets a third wait; progress comes in order as the GPU finishes; and however the loop ends, nothing it submitted is
// still running when it returns.
import { runSamples } from '../samples.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const tick = () => new Promise(r => setTimeout(r, 0))

/* A fake GPU: trace() submits sample k; done() is a promise for "everything submitted so far", resolved by the test
   (finishNext) in submission order. `log` keeps the order of events; `waiting` how many dones are unresolved. */
const fakeGpu = ({ failAt = -1 } = {}) => {
    const log = [], queue = []
    let submitted = 0, maxWaiting = 0
    return {
        log, get maxWaiting() { return maxWaiting }, get waiting() { return queue.length },
        trace: async () => {
            if (submitted === failAt) throw new Error('a trace that fails')
            log.push(`trace ${++submitted}`)
        },
        done: () => {
            let resolve
            const p = new Promise(r => { resolve = r })
            queue.push({ k: submitted, resolve })
            maxWaiting = Math.max(maxWaiting, queue.length)
            return p
        },
        finishNext() { const q = queue.shift(); if (q) { log.push(`done ${q.k}`); q.resolve() } return !!q },
    }
}
// drive a run to its end: the GPU finishes the oldest submission whenever the loop has gone quiet
const drive = async (g, run) => {
    let over = false, err = null
    const p = run.then(() => { over = true }, e => { over = true; err = e })
    for (let n = 0; n < 1000 && !over; n++) { await tick(); if (!over) g.finishNext() }
    await p
    return err
}

{
    const g = fakeGpu(), progress = []
    await drive(g, runSamples(4, { trace: g.trace, done: g.done, onProgress: (k, n) => progress.push(`${k}/${n}`) }))
    ok('inFlight 1: trace and wait strictly alternate, as the loop always did',
        g.log.join(',') === 'trace 1,done 1,trace 2,done 2,trace 3,done 3,trace 4,done 4', g.log.join(','))
    ok('...one waiting at a time, progress per sample in order', g.maxWaiting === 1 && progress.join(',') === '1/4,2/4,3/4,4/4', progress.join(','))
}
{
    const g = fakeGpu(), progress = []
    await drive(g, runSamples(4, { trace: g.trace, done: g.done, inFlight: 2, onProgress: k => progress.push(k) }))
    ok('inFlight 2: the next sample is traced before the one before it is done',
        g.log.indexOf('trace 2') < g.log.indexOf('done 1') && g.log.indexOf('trace 4') < g.log.indexOf('done 3'), g.log.join(','))
    ok('...never more than two waiting, every sample traced once and finished', g.maxWaiting === 2
        && g.log.filter(x => x.startsWith('trace')).length === 4 && g.log.filter(x => x.startsWith('done')).length === 4, g.log.join(','))
    ok('...progress in order, once each, the last when the last is done', progress.join(',') === '1,2,3,4' && g.waiting === 0)
}
{
    const g = fakeGpu({ failAt: 2 })
    const err = await drive(g, runSamples(5, { trace: g.trace, done: g.done, inFlight: 2 }))
    ok('a trace that throws: the error comes back...', /a trace that fails/.test(err?.message ?? ''), String(err))
    ok('...after what was already submitted has finished', g.waiting === 0 && g.log.includes('done 2'), g.log.join(','))
}
{
    const g = fakeGpu(), ac = new AbortController()
    const progress = []
    const err = await drive(g, runSamples(10, { trace: async () => { await g.trace(); if (g.log.length >= 3) ac.abort() },
                                               done: g.done, inFlight: 2, signal: ac.signal, onProgress: k => progress.push(k) }))
    ok('aborted between samples: an AbortError, and nothing left running', err?.name === 'AbortError' && g.waiting === 0, `${err?.name} ${g.waiting}`)
    ok('...and no progress reported for what finished after the abort', progress.every(k => k <= 2), progress.join(','))
}
{
    /* ONE SAMPLE ASKED FOR TWO IN FLIGHT IS ONE AWAITED: what the studio's live tile relies on for its single
       samples (studio.js), and why a caller that asks for 2 cannot change a one-sample call's timing */
    const one = fakeGpu(), two = fakeGpu(), p1 = [], p2 = []
    await drive(one, runSamples(1, { trace: one.trace, done: one.done, inFlight: 1, onProgress: k => p1.push(k) }))
    await drive(two, runSamples(1, { trace: two.trace, done: two.done, inFlight: 2, onProgress: k => p2.push(k) }))
    ok('inFlight 2 with 1 sample is exactly inFlight 1: trace, done, one progress',
        two.log.join(',') === one.log.join(',') && two.log.join(',') === 'trace 1,done 1' && p2.join(',') === p1.join(',') && p2.join(',') === '1'
        && two.maxWaiting === 1 && two.waiting === 0, `${one.log.join(',')} | ${two.log.join(',')}`)
}
{
    /* ...and each call returns with nothing left running: a run of calls (the studio's live tile, 1 1 1 1 2 2 ...)
       never overlaps one call's samples with the next's -- the picture is grabbed between them */
    const g = fakeGpu(), between = []
    for (const k of [1, 1, 2, 2]) {
        await drive(g, runSamples(k, { trace: g.trace, done: g.done, inFlight: 2 }))
        between.push(g.waiting)
    }
    ok('calls one after another: each returns drained, so a grab between them sees all its samples',
        between.every(w => w === 0) && g.log.filter(x => x.startsWith('trace')).length === 6, `${between.join(',')} ${g.log.join(',')}`)
}
{
    const g = fakeGpu()
    await drive(g, runSamples(0, { trace: g.trace, done: g.done, inFlight: 2 }))
    ok('no samples: nothing traced', g.log.length === 0)
}

console.log(`samples: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
