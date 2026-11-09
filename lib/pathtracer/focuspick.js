//======================================================================================================================
// PICK FOCUS -- the lens focused on the surface under the mouse, from the Camera popover.
//
//   const F = installFocusPick({ canvas, RT, toolbar })   // after RT.installUI: its button goes in the Camera popover
//   F.arm()  F.disarm()  F.armed                          // what the button does; whether it is waiting or held
//
// THE USER'S WAY (2026-10-28): "click pick -> menu collapses -> mouse down focuses -> mouse up stops the focus mode".
// The button closes the popover and arms the mode: the cursor a cross over the picture. A press on the picture is the
// mode's and nobody else's -- no orbit, no builder selection, no measure pin -- and focuses the lens on the surface
// under it; held, the focus follows the mouse over the surfaces; released, it is focused where the mouse let go and
// the mode is over. Escape, or a press anywhere else, lets it go: the focus stays as the last pick left it.
//
// WHAT "FOCUS" IS (lib/camera.js getUniforms camLens, core/genrays.js): the distance of the focus PLANE along the
// camera's axis, square to it -- not along the ray. So the picked point P sets focus = (P - eye) . axis, and is sharp
// wherever it is in the picture, a corner as well as the middle (focusDepth). In the scene's unit, as the pick
// answers (index.js pick) and as the camera holds it.
//
// A pick that finds nothing (the sky, the letterbox, the pick kernel still compiling) leaves the focus where it was.
// Each focus written is a camera change (cam.set): the picture restarts and, with Fast while moving on, a held drag
// is traced light as an orbit is (index.js onChange pokes the interaction). One pick in flight, then the newest place
// the mouse has reached, as the measure tool's drag does.
//
// Nothing to focus with an orthographic camera (getControlVisibility hides the lens): the button goes with it. With
// an aperture of 0 the focus is kept but nothing in the picture changes; the button's tooltip says so.
//======================================================================================================================

/** The focus distance that puts world point `P` in the focus plane: its depth along the camera's axis, from the
 *  camera's uniforms as the kernels read them (invView's third column is the eye's backwards axis, camPos the eye).
 *  Null for a point on or behind the eye's plane, which no lens can focus. */
export function focusDepth(U, P) {
    const v = U.invView, e = U.camPos
    const d = -((P[0] - e[0]) * v[8] + (P[1] - e[1]) * v[9] + (P[2] - e[2]) * v[10])
    return d > 0 && Number.isFinite(d) ? d : null
}

/** Where a client point is on the picture, in the pick's [-1, 1] with y up, or null on the letterbox: the canvas is
 *  object-fit: contain (index.js cursorPixel says the same). */
export function pictureAt(rect, bufW, bufH, clientX, clientY) {
    const s = Math.min(rect.width / (bufW || 1), rect.height / (bufH || 1)), dw = (bufW || 1) * s, dh = (bufH || 1) * s
    const u = (clientX - rect.left - (rect.width - dw) / 2) / dw
    const v = (clientY - rect.top - (rect.height - dh) / 2) / dh
    if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return null
    return [u * 2 - 1, 1 - v * 2]
}

const TIP = 'Pick focus: then press on the picture -- the lens focuses on the surface under the mouse while it is '
    + 'held, and stays focused where it is let go. Esc cancels. Shows only with an aperture above 0.'

/**
 * @param canvas   the picture's canvas: a press on it is the mode's
 * @param RT       the renderer: RT.cam (the camera), RT.pick(x, y), RT.watchView(fn)
 * @param toolbar  installViewToolbar's: its Camera table holds the button, close() collapses the popover
 */
export function installFocusPick({ canvas, RT, toolbar }) {
    const table = toolbar.sections?.Camera
    const btn = table?.addButton?.({ title: 'Pick focus' }) ?? null
    if (btn?.element) btn.element.title = TIP

    let armed = false, pressed = false, cursor = ''
    const persp = () => { try { return (RT.cam?.get().camtype ?? 0) === 0 } catch { return false } }

    const arm = () => {
        if (!RT.cam || !persp()) return
        toolbar.close?.()
        if (!armed) cursor = canvas.style.cursor
        armed = true
        // on the canvas, not the stage: the builder's overlay sets the stage's cursor on its own hover
        canvas.style.cursor = 'crosshair'
    }
    const disarm = () => {
        if (!armed) return
        armed = false; pressed = false
        canvas.style.cursor = cursor
    }
    btn?.on?.('click', arm)

    /* the button only where there is a lens: a perspective camera (lib/camera.js getControlVisibility), told of every
       camera change however it came (index.js watchView) */
    const follow = () => {
        const p = persp()
        if (btn && btn.hidden !== !p) btn.hidden = !p
        if (!p) disarm()
    }
    try { RT.watchView?.(follow) } catch { }
    follow()

    /* THE FOCUS AT A CLIENT POINT: one pick in flight, then the newest point asked meanwhile -- so the answers come in
       the order they were asked, and the release's is the last written */
    let busy = false, want = null
    const focusAt = async () => {
        if (busy || !want) return
        busy = true
        const [x, y] = want
        want = null
        let res = null
        try { res = await RT.pick?.(x, y) } catch { }
        busy = false
        if (res?.hit && res.pos?.every(Number.isFinite)) {
            const cam = RT.cam
            const f = cam && focusDepth(cam.getUniforms(), res.pos)
            if (f != null && f !== cam.get().focus) cam.set({ focus: f })
        }
        if (want) focusAt()
    }
    const ask = ev => {
        const at = pictureAt(canvas.getBoundingClientRect(), canvas.width, canvas.height, ev.clientX, ev.clientY)
        if (!at) return
        want = at
        focusAt()
    }

    /* ON THE WINDOW, IN THE CAPTURE PHASE, before anyone (the measure tool's reasoning: the builder's selection hears
       mousedown on the stage, the camera on the canvas). stopImmediatePropagation as well: the measure tool listens on
       the window too, and a pin must not be placed by a press that was the focus's. */
    window.addEventListener('mousedown', e => {
        if (!armed) return
        if (e.target !== canvas) { disarm(); return }             // a press elsewhere: the mode let go, the press its own
        if (e.button !== 0) return                                 // the middle button still pans
        e.stopImmediatePropagation(); e.preventDefault()
        pressed = true
        ask(e)
        // Escape during the press (disarm) ends it: nothing more is asked
        const move = ev => { if (pressed) { ev.preventDefault(); ask(ev) } }
        const up = ev => {
            window.removeEventListener('mousemove', move, true)
            window.removeEventListener('mouseup', up, true)
            if (pressed) ask(ev)                                   // focused where it was let go
            disarm()
        }
        window.addEventListener('mousemove', move, true)
        window.addEventListener('mouseup', up, true)
    }, true)
    // while armed the cursor is the mode's: the builder's hover leaves a marked move alone (builder/overlay.js)
    window.addEventListener('mousemove', e => { if (armed && !pressed && e.target === canvas) e.preventDefault() }, true)
    window.addEventListener('keydown', e => { if (e.key === 'Escape') disarm() })

    return { arm, disarm, get armed() { return armed }, button: btn }
}
