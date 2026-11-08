//======================================================================================================================
// SAVED VIEWS -- the Camera popover's list of the scene's saved cameras (0.84.0; the user, 2026-11-07: "I would like a
// way to store camera settings ... so i can move around a scene, change things and move back to the camera view I
// want").
//
//   installViewList({ el, BUILDER, RT })   el: the Camera popover's element (viewtools.js popoverEl('Camera'))
//
// The views are the scene's (builder/model.js VIEW: `doc.view.saved`), kept through the builder's verbs (demo.js
// saveView, goToView, updateView, renameView, removeView), which act on the scene the renderer shows; this file is only
// their rows. Save view keeps the camera as it is now under the next "View N" and opens its name for typing. A row's
// name is the view: a click puts the camera back there at once (the user's choice: a jump, not a glide), a
// double-click renames it (Enter or leaving the box keeps it, Escape does not). ↻ keeps the camera as it is now under
// that name. ✕ takes it away -- on a second click, since no undo brings a view back (it is the view's, outside the
// history, as the camera is: model.js VIEW). A row whose camera the camera is at now is lit.
//
// The camera only, not the exposure (the user's choice): going back to a view leaves the picture's brightness alone.
// While no scene of the project is shown -- its compile has not ended -- the list says so and offers nothing: the
// camera over the picture is not yet the scene's.
//
// Plain DOM, styled as the popover is (viewtools.js POP), under its table. builder/test/viewlist.check.mjs drives it.
//======================================================================================================================

const C = { text: '#d4dade', dim: '#8a949d', lit: '#ffcc33', line: 'rgba(160,175,190,0.25)', hover: 'rgba(255,255,255,0.07)', bad: '#ff8a7a' }
const FONT = '12px Arial, sans-serif'

/* THE CAMERA AT A VIEW: every setting the view keeps the same as the camera's now, to a part in a million of the
   scene's size (the target's distance); the angles to a millionth of a degree. Only what the view's mode puts back
   (lib/pathtracer/index.js applyCamera): an orbit's angles and distance, not its up; a free camera's position and up,
   not the orbit numbers it carries from before (lib/camera.js leaves them as they were while it moves) */
const NOT_READ = { orbit: ['pos', 'up'], fps: ['azimuth', 'elevation', 'distance'] }
export function atView(camera, saved) {
    if (!camera || !saved) return false
    const mode = saved.mode ?? 'orbit'
    if ((camera.mode ?? 'orbit') !== mode) return false
    const scale = Math.max(1e-9, Math.abs(saved.distance ?? camera.distance ?? 1))
    const same = (a, b, s) => typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 1e-6 * s : a === b
    for (const [k, v] of Object.entries(saved)) {
        if ((NOT_READ[mode] ?? []).includes(k)) continue
        const c = camera[k]
        const s = k === 'azimuth' || k === 'elevation' || k === 'fov' ? 1 : scale
        if (Array.isArray(v)) { if (!Array.isArray(c) || c.length !== v.length || !v.every((x, i) => same(x, c[i], s))) return false }
        else if (k === 'azimuth') { if (!(Math.abs((((c - v) % 360) + 540) % 360 - 180) <= 1e-6)) return false }
        else if (!same(v, c, s)) return false
    }
    return true
}

export function installViewList({ el, BUILDER, RT }) {
    if (!el) return null
    const doc = el.ownerDocument
    const make = (tag, style = {}, text = '') => { const e = doc.createElement(tag); Object.assign(e.style, style); if (text) e.textContent = text; return e }
    const root = make('div', { borderTop: `1px solid ${C.line}`, margin: '4px 0 0', padding: '6px 8px 4px', font: FONT, color: C.text })
    root.className = 'rt-viewlist'
    const head = make('div', { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' })
    const title = make('span', { flex: '1', font: '9px/1 Arial, sans-serif', letterSpacing: '0.07em', textTransform: 'uppercase', color: C.dim }, 'Saved views')
    const save = make('button', { font: FONT, color: C.text, background: 'rgba(255,255,255,0.08)', border: `1px solid ${C.line}`,
        borderRadius: '4px', padding: '2px 8px', cursor: 'pointer' }, 'Save view')
    save.className = 'rt-viewlist-save'
    save.title = 'Keep the camera as it is now -- where it is, where it looks, its field of view and its lens -- with the scene'
    head.append(title, save)
    const rows = make('div', { display: 'flex', flexDirection: 'column', gap: '1px' })
    const note = make('div', { color: C.dim, padding: '2px 0', fontSize: '11px' })
    root.append(head, rows, note)
    el.appendChild(root)

    let list = [], editing = null, confirming = null, confirmTimer = 0, problem = null

    const say = e => { problem = e?.message ?? String(e); draw() }
    const act = fn => { try { problem = null; return fn() } catch (e) { say(e); return undefined } }
    // the scene the camera is over is one of the project's (demo.js viewsShown; `showing` for a builder without it)
    const showing = () => { try { return 'viewsShown' in BUILDER ? !!BUILDER.viewsShown : BUILDER.showing !== false } catch { return false } }
    const camera = () => { try { return RT.view?.()?.camera ?? null } catch { return null } }

    const iconBtn = (text, tip, onclick) => {
        const b = make('button', { font: FONT, color: C.dim, background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px' }, text)
        b.title = tip
        b.onclick = e => { e.stopPropagation(); onclick() }
        return b
    }

    const rename = (from, to) => {
        editing = null
        to = String(to ?? '').trim()
        if (to && to !== from) act(() => BUILDER.renameView(from, to))
        draw()
    }

    function draw() {
        rows.replaceChildren()
        const on = showing()
        save.disabled = !on
        save.style.opacity = on ? '1' : '0.5'
        const cam = camera()
        for (const v of list) {
            const row = make('div', { display: 'flex', alignItems: 'center', gap: '2px', borderRadius: '3px', padding: '1px 2px' })
            row.className = 'rt-viewlist-row'
            row.dataset.name = v.name
            row.onmouseenter = () => { row.style.background = C.hover }
            row.onmouseleave = () => { row.style.background = '' }
            const lit = on && atView(cam, v.camera)
            if (editing === v.name) {
                const box = make('input', { flex: '1', minWidth: '0', font: FONT, color: C.text, background: 'rgba(0,0,0,0.35)',
                    border: `1px solid ${C.line}`, borderRadius: '3px', padding: '1px 4px' })
                box.className = 'rt-viewlist-name'
                box.value = v.name
                let done = false
                const finish = keep => { if (done) return; done = true; if (keep) rename(v.name, box.value); else { editing = null; draw() } }
                box.onkeydown = e => {
                    // the popover's Escape closes it (viewtools.js): here it only stops the rename
                    if (e.key === 'Enter') { e.preventDefault(); finish(true) }
                    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false) }
                }
                box.onblur = () => finish(true)
                row.append(box)
                rows.append(row)
                requestAnimationFrame(() => { box.focus(); box.select() })
                continue
            }
            const name = make('button', { flex: '1', minWidth: '0', textAlign: 'left', font: FONT, color: lit ? C.lit : C.text,
                background: 'none', border: 'none', padding: '2px 4px', cursor: on ? 'pointer' : 'default',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, (lit ? '● ' : '') + v.name)
            name.className = 'rt-viewlist-go'
            name.title = `Go to "${v.name}" (double-click to rename)`
            name.disabled = !on
            name.onclick = e => { e.stopPropagation(); act(() => BUILDER.goToView(v.name)); draw() }
            name.ondblclick = e => { e.stopPropagation(); editing = v.name; draw() }
            const update = iconBtn('↻', `Keep the camera as it is now as "${v.name}"`, () => { act(() => BUILDER.updateView(v.name)); draw() })
            update.className = 'rt-viewlist-update'
            const del = confirming === v.name
                ? iconBtn('Delete?', `Click again to take "${v.name}" away: no undo brings it back`, () => {
                    confirming = null; clearTimeout(confirmTimer); act(() => BUILDER.removeView(v.name)); draw() })
                : iconBtn('✕', `Take "${v.name}" away`, () => {
                    confirming = v.name; clearTimeout(confirmTimer)
                    confirmTimer = setTimeout(() => { confirming = null; draw() }, 3000)
                    draw() })
            del.className = 'rt-viewlist-delete'
            if (confirming === v.name) del.style.color = C.bad
            for (const b of [update, del]) { b.disabled = !on; if (!on) b.style.opacity = '0.5' }
            row.append(name, update, del)
            rows.append(row)
        }
        note.style.color = problem ? C.bad : C.dim
        note.textContent = problem ? problem
            : !on ? 'Shown once a scene of the project is: its compile has not ended'
            : list.length ? '' : 'None yet: Save view keeps the camera as it is now'
        note.style.display = note.textContent ? '' : 'none'
    }

    save.onclick = e => {
        e.stopPropagation()
        const n = act(() => BUILDER.saveView())
        if (n) editing = n
        draw()
    }

    const show = l => { list = Array.isArray(l) ? l : []; if (editing && !list.some(v => v.name === editing)) editing = null; draw() }
    BUILDER.onSavedViews = show
    /* WHICH ROW IS LIT follows the camera, however it moved (index.js watchView): once a frame at most, and not while a
       name is typed (a redraw would take the box away) */
    let pending = 0
    try { RT.watchView?.(() => { if (pending || editing || el.style.display === 'none') return; pending = requestAnimationFrame(() => { pending = 0; if (!editing) draw() }) }) } catch { }
    /* ...and whether a scene is shown, which nothing tells: asked again as the popover opens (its display set by
       viewtools.js; the camera's moves are not drawn while it is closed) and whenever it is looked at */
    try {
        new MutationObserver(() => { if (el.style.display !== 'none' && !editing) draw() })
            .observe(el, { attributes: true, attributeFilter: ['style'] })
    } catch { }
    el.addEventListener('pointerenter', () => { if (!editing) draw() })
    show((() => { try { return BUILDER.savedViews() } catch { return [] } })())
    return { refresh: () => show(BUILDER.savedViews()), root }
}
