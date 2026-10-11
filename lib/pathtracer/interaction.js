//======================================================================================================================
// INTERACTION -- whether the user is moving something now: the camera, a drag in the picture, a live value.
//
// The view traces a full picture lighter while this says so (quality.js effective, `moving`; the moveFast setting, the
// view's ⚡), and goes back once it has been quiet for idleMs (the user, 2026-10-11: "when panning / moving the
// viewport, objects etc ... switch back to the selected preview mode").
//
// TOLD, NEVER GUESSED FROM THE PICTURE'S RESETS. A reset is written by a scene swap, a kernel build, a resize -- and by
// the switch to the lighter mode itself, which would then keep itself on for ever. So only what the user moves pokes:
// the camera's onChange (index.js), the builder's live values (builder/demo.js live, through RT.interacting), and a
// drag in the picture holds it for as long as the button is down (builder/overlay.js), so a drag that pauses without
// letting go does not go back to the full picture under the pointer.
//
//   const I = makeInteraction({ idleMs: 400 })
//   I.poke()                 something moved; active from now until idleMs of quiet (and no hold out)
//   const release = I.hold() active until released (a release runs once, however often called), then idleMs more
//   I.active()               moving now
//   I.onChange(fn)           fn(active) once when a move starts and once when it ends; returns the unsubscribe
//
// `now` and `schedule` (setTimeout's shape, returning a cancel) are injected so test/interaction.test.mjs drives the
// clock by hand.
//======================================================================================================================

export function makeInteraction({ idleMs = 400, now = () => performance.now(),
                                  schedule = (f, ms) => { const t = setTimeout(f, ms); return () => clearTimeout(t) } } = {}) {
    let active = false, last = -Infinity, holds = 0, cancel = null
    const listeners = new Set()
    const set = on => {
        if (on === active) return
        active = on
        for (const fn of [...listeners]) { try { fn(on) } catch (e) { console.error('[interaction]', e) } }
    }
    /* THE END, checked when the quiet should be over: a poke since then moves it on, a hold keeps it */
    const arm = () => {
        cancel?.()
        cancel = schedule(check, Math.max(0, last + idleMs - now()))
    }
    const check = () => {
        cancel = null
        if (holds > 0) return                                  // a release arms it again
        if (now() - last >= idleMs) set(false)
        else arm()
    }
    const poke = () => {
        last = now()
        set(true)
        if (!cancel && holds === 0) arm()
    }
    return {
        poke,
        hold() {
            holds++
            poke()
            let out = true
            return () => { if (!out) return; out = false; holds--; last = now(); if (holds === 0) arm() }
        },
        active: () => active,
        onChange(fn) { listeners.add(fn); return () => listeners.delete(fn) },
        idleMs,
    }
}
