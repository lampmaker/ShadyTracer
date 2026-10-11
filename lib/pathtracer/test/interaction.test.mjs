// node lib/pathtracer/test/interaction.test.mjs
//
// THE USER MOVING SOMETHING (lib/pathtracer/interaction.js), on a clock the test moves: a poke starts a move and it ends
// idleMs after the last one; pokes within the window carry it on; a hold keeps it through any quiet and its release
// lets it end idleMs later; a release runs once; holds nest; the listeners hear once each way. What the view's ⚡ (fast
// while moving, quality.js effective) rests on: nothing else runs this without a browser.

import { makeInteraction } from '../interaction.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}

// a clock and a timer queue moved by hand
let clock = 0
let timers = []
const schedule = (f, ms) => { const t = { at: clock + ms, f }; timers.push(t); return () => { timers = timers.filter(x => x !== t) } }
const advance = ms => {
    const end = clock + ms
    for (;;) {
        const due = timers.filter(t => t.at <= end).sort((a, b) => a.at - b.at)[0]
        if (!due) break
        timers = timers.filter(t => t !== due)
        clock = Math.max(clock, due.at)
        due.f()
    }
    clock = end
}

{
    const I = makeInteraction({ idleMs: 400, now: () => clock, schedule })
    const heard = []
    I.onChange(on => heard.push(on))
    ok('quiet at first, nothing heard', !I.active() && heard.length === 0)
    I.poke()
    ok('a poke starts a move, heard once', I.active() && heard.join() === 'true')
    advance(200); I.poke(); advance(200); I.poke(); advance(399)
    ok('...pokes within the window carry it on, unheard', I.active() && heard.join() === 'true', `${I.active()} ${heard}`)
    advance(1)
    ok('...and it ends idleMs after the last poke, heard once', !I.active() && heard.join() === 'true,false', `${heard}`)
    advance(5000)
    ok('...nothing more without a poke, and no timer left behind', heard.length === 2 && timers.length === 0, `${heard} ${timers.length}`)
}
{
    const I = makeInteraction({ idleMs: 400, now: () => clock, schedule })
    const heard = []
    I.onChange(on => heard.push(on))
    const release = I.hold()
    ok('a hold starts a move', I.active() && heard.join() === 'true')
    advance(10000)
    ok('...and keeps it through any quiet (a drag paused without letting go)', I.active() && heard.length === 1)
    release()
    advance(399)
    ok('...released, it stays idleMs more', I.active())
    advance(1)
    ok('...then ends', !I.active() && heard.join() === 'true,false', `${heard}`)
    release(); release()
    const r2 = I.hold(), r3 = I.hold()
    r2(); r2()
    advance(1000)
    ok('a release runs once: a second call does not let go of another hold', I.active())
    r3(); advance(400)
    ok('...holds nest: the last release lets it end', !I.active() && heard.join() === 'true,false,true,false', `${heard}`)
}
{
    const I = makeInteraction({ idleMs: 100, now: () => clock, schedule })
    let n = 0
    const off = I.onChange(() => n++)
    off()
    I.poke(); advance(200)
    ok('an unsubscribed listener hears nothing', n === 0)
    const throws = makeInteraction({ idleMs: 100, now: () => clock, schedule })
    let after = 0
    const err = console.error; console.error = () => { }
    throws.onChange(() => { throw new Error('a listener that fails') })
    throws.onChange(() => after++)
    throws.poke()
    console.error = err
    ok('...a listener that throws does not stop the next', after === 1)
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `interaction: ${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
