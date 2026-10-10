//======================================================================================================================
// THE RUN'S WATCH -- a test run that ends when the GPU is lost or a step never comes back, and says which.
//
// WHY. The scenedata benchmark lost the user's GPU at its 19th row (Pascal, Windows, 0.20.0, 2026-10-04): the console
// had DXGI_ERROR_DEVICE_HUNG, Windows resetting a GPU that stayed busy too long, then tinywebgpu's "GPU device lost".
// It happened during the row's "one sample in flight" step. The run then showed "...running" with nothing to say it had
// ended or why. Nothing in the raytracer listened for a lost device (tinywebgpu's onDeviceLost slot was unset). A sample
// waits for the GPU's "done" (samples.js), and after the loss that wait never ended -- inferred from the run not moving
// on; what Chrome does with queue.onSubmittedWorkDone on a lost device was not read in its code.
//   So every GPU step a run awaits goes through within(). It ends with the step, or with Stopped as soon as the device
// is lost, or once the step has taken longer than the caller allows. Once stopped, every later step is refused at once,
// so a run ends at its next await instead of starting another row on a dead device. The run keeps the rows it finished
// and says where it stopped and why (tests.js run).
//   GPUDevice.lost is a promise, awaited here directly: any number of watchers can await it, where tinywebgpu's
// onDeviceLost is one slot that a second caller would take from the first.
//   A step that times out is not cancelled -- nothing can recall work on a GPU queue -- only no longer waited for.
// Separate from tests.js so it runs without a GPU (test/runwatch.test.mjs).
//======================================================================================================================

export class Stopped extends Error {
    constructor(why) { super(why); this.name = 'Stopped'; this.why = why }
}

/** What a lost device says, in one line: the reason the browser gives, and the first line of its message (Dawn's runs
 *  to a dozen lines of backend detail). */
export const lostSays = info => {
    const first = String(info?.message ?? '').split('\n').find(l => l.trim())?.trim() ?? ''
    return `the GPU was lost (${info?.reason || 'unknown'})${first ? `: ${first}` : ''}`
}

const secs = ms => ms >= 60000 && ms % 60000 === 0 ? `${ms / 60000} min` : `${+(ms / 1000).toFixed(1)} s`

/**
 * Watch one run on `device` (a GPUDevice, or anything with a `lost` promise; none at all is a device never lost).
 *   within(step, ms, what): `step` is a function returning a promise, not started once the run has stopped. Resolves as
 *     the step does; rejects with Stopped when the device is lost, or after `ms` (Infinity: never), which stops the run.
 *   stop(why): stops the run by hand.
 *   tidy(step, ms): for putting things back. The step runs whatever has happened, is waited for at most `ms` and not at
 *     all once the device is lost, and never throws: it resolves to the step's error, or null.
 *   why: null while the run goes on, else why it stopped. lost: the device's loss info once it is lost, else null.
 */
export function watchRun(device, { setTimeout: later = globalThis.setTimeout, clearTimeout: cancel = globalThis.clearTimeout } = {}) {
    let why = null, lost = null, wakeEnd, wakeGone
    const ended = new Promise(r => { wakeEnd = r }), gone = new Promise(r => { wakeGone = r })
    const stop = reason => { if (why === null) { why = String(reason); wakeEnd() } }
    device?.lost?.then?.(info => { lost = info ?? {}; stop(lostSays(info)); wakeGone() }, () => { })
    const stopped = ended.then(() => { throw new Stopped(why) })
    stopped.catch(() => { })                    // awaited only inside a race

    const race = (p, end, ms, onTime) => {
        let t = null
        const racers = [p, end]
        if (Number.isFinite(ms)) racers.push(new Promise((_, no) => { t = later(() => no(onTime()), ms) }))
        return Promise.race(racers).finally(() => { if (t !== null) cancel(t) })
    }
    const start = step => {
        const p = Promise.resolve().then(step)
        p.catch(() => { })                      // a step left behind by a stop may fail later, with nobody waiting
        return p
    }

    const within = async (step, ms = Infinity, what = 'a step') => {
        if (why !== null) throw new Stopped(why)
        return race(start(step), stopped, ms, () => { stop(`${what} did not finish in ${secs(ms)}`); return new Stopped(why) })
    }

    const tidy = async (step, ms = 30000) => {
        const p = start(step)
        if (lost) return null
        try { await race(p, gone, ms, () => new Error(`did not finish in ${secs(ms)}`)); return null }
        catch (e) { return e }
    }

    return {
        within, stop, tidy,
        get why() { return why },
        get lost() { return lost },
    }
}
