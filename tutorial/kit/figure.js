//======================================================================================================================
// A FIGURE -- one live drawing on a page, from a SPEC a chapter module exports:
//
//   { aspect,                    width / height of the drawing (e.g. 1.4)
//     world: { x: [x0, x1], y: [y0, y1] },   what part of the plane it shows, y up; fitted, never stretched
//     state: { ... },            plain values; controls, handles and steps change them
//     controls: [ ... ],         controls.js builds them (slider, toggle, seg, button)
//     steps: { name: patch },    a paragraph with data-step="figure:name" applies its patch as it scrolls past
//     drag: { id(state, p) },    what dragging the handle `id` (pen.handle) to world point p does
//     draw(pen, state, t),       the picture; depends on state alone, so a redraw is always safe
//     work: { reset(state), add(state, ms) -> more? },   progressive figures: a path tracer adding samples
//     changed(state, key),       optional: a control or handle moved `key` (to rebuild derived things)
//     keep: [key, ...],          keys whose change redraws without restarting `work`
//     readout(state) -> text }   a line under the figure, read out to screen readers
//
// Drawing runs only when something changed, or while `work` has work left and the figure is on screen and the tab is
// visible. Each frame of work gets a budget in milliseconds rather than a ray count: nobody has measured what a ray
// costs on the reader's machine, and a budget does not need to know.
//======================================================================================================================

import { makePen } from './pen.js'
import { buildControls } from './controls.js'

const ROLES = ['paper', 'ink', 'soft', 'faint', 'accent', 'cam', 'light', 'shadow', 'blocked', 'solid', 'fill', 'glass', 'normal', 'hit', 'step', 'grid']
const VARS = { paper: '--paper', ink: '--ink', soft: '--ink-soft', faint: '--ink-faint', accent: '--accent', cam: '--c-cam', light: '--c-light',
    shadow: '--c-shadow', blocked: '--c-blocked', solid: '--c-solid', fill: '--c-fill', glass: '--c-glass', normal: '--c-normal', hit: '--c-hit', step: '--c-step', grid: '--grid' }

/* THE STYLE AS THE CANVAS NEEDS IT. A canvas cannot read var(), so each role's colour is resolved by a hidden probe
   element's computed `color`; the pen's numbers and the faces come from getComputedStyle. */
export function readTheme(el) {
    const doc = el.ownerDocument, probe = doc.createElement('span')
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none'
    el.appendChild(probe)
    const colors = {}
    const cs0 = doc.defaultView.getComputedStyle
    for (const r of ROLES) { probe.style.color = `var(${VARS[r]})`; colors[r] = cs0(probe).color }
    probe.remove()
    const cs = cs0(el)
    const num = (k, d) => { const v = parseFloat(cs.getPropertyValue(k)); return Number.isFinite(v) ? v : d }
    const str = k => cs.getPropertyValue(k).trim()
    return {
        colors, rough: num('--pen-rough', 0), double: num('--pen-double', 0) > 0, width: num('--pen-width', 1.5),
        misreg: num('--pen-misreg', 0), fill: str('--pen-fill') || 'wash',
        fonts: { hand: str('--f-hand') || 'cursive', mono: str('--f-mono') || 'monospace', body: str('--f-body') || 'serif' },
    }
}

const clone = v => JSON.parse(JSON.stringify(v))

/** Mount `spec` into the <figure> `el`. Returns { state, set, step, render, reset, dispose }. */
export function mountFigure(el, spec, { name = '' } = {}) {
    const doc = el.ownerDocument, win = doc.defaultView
    const state = clone(spec.state ?? {})
    const box = doc.createElement('div'); box.className = 'fig-canvas'
    const canvas = doc.createElement('canvas')
    canvas.tabIndex = 0
    canvas.setAttribute('role', 'img')
    canvas.setAttribute('aria-label', el.querySelector('figcaption')?.textContent?.trim() || name)
    box.appendChild(canvas)
    const readout = doc.createElement('p'); readout.className = 'fig-readout'; readout.setAttribute('aria-live', 'polite')
    const cap = el.querySelector('figcaption')
    el.insertBefore(box, cap)
    const controls = buildControls(doc, spec.controls ?? [], state, (key) => { changed(key); }, name)
    if (controls) el.insertBefore(controls.el, cap)
    el.insertBefore(readout, cap)

    let theme = readTheme(el), W = 0, H = 0, dpr = 1, view = null, handles = [], dirty = true, raf = 0, visible = true, t0 = performance.now()
    const aspect = spec.aspect ?? 1.5

    /* sized to its box; true if the size changed. Setting a canvas's width clears it, so an unchanged size is left alone
       (the first ResizeObserver callback comes right after mounting, and used to wipe the first drawing) */
    function fit() {
        const w = box.clientWidth || 600
        const h = Math.round(w / aspect)
        const d = Math.min(2, win.devicePixelRatio || 1)
        if (view && w === W && h === H && d === dpr) return false
        box.style.height = h + 'px'
        dpr = d
        W = w; H = h
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr)
        const [x0, x1] = spec.world?.x ?? [-1, 1], [y0, y1] = spec.world?.y ?? [-1, 1]
        const s = Math.min(w / (x1 - x0), h / (y1 - y0))
        view = { s, ox: w / 2 - s * (x0 + x1) / 2, oy: h / 2 + s * (y0 + y1) / 2, W: w, H: h }
        dirty = true
        return true
    }
    function render() {
        dirty = false
        const ctx = canvas.getContext('2d')
        if (!ctx || !view) return
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, W, H)
        handles = []
        const pen = makePen(ctx, view, theme, handles)
        try { spec.draw(pen, state, (performance.now() - t0) / 1000) }
        catch (e) { console.error(`figure ${name}:`, e); ctx.fillStyle = theme.colors.blocked; ctx.font = '13px monospace'; ctx.fillText('this figure failed: ' + e.message, 10, 20) }
        if (spec.readout) readout.textContent = spec.readout(state) ?? ''
    }
    let more = false
    function loop() {
        raf = 0
        if (!visible || doc.hidden) return
        if (spec.work && more) {
            more = !!spec.work.add(state, 9)
            dirty = true
        }
        if (dirty || spec.animate) render()
        if ((spec.work && more) || spec.animate) raf = win.requestAnimationFrame(loop)
    }
    const kick = () => { if (!raf) raf = win.requestAnimationFrame(loop) }
    function reset() { if (spec.work) { spec.work.reset(state); more = true } dirty = true; kick() }
    /* a change restarts the figure's work, except for keys the spec lists in `keep` (choosing which pixel's paths to
       show should not throw away a thousand samples) */
    function changed(key) {
        spec.changed?.(state, key); controls?.sync()
        if (spec.keep?.includes(key)) { dirty = true; kick() } else reset()
    }

    /* POINTER: the nearest handle within 22 px is grabbed; anywhere else the page scrolls as usual (touch-action pan-y
       on the canvas, and preventDefault only once a handle is held) */
    let held = null
    const at = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }
    const nearestHandle = ([x, y]) => {
        let best = null, bd = 22
        for (const h of handles) { const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = h } }
        return best
    }
    const toWorld = ([x, y]) => [(x - view.ox) / view.s, (view.oy - y) / view.s]
    canvas.addEventListener('pointerdown', e => {
        const h = nearestHandle(at(e))
        if (!h || !spec.drag?.[h.id]) return
        held = h.id; canvas.setPointerCapture?.(e.pointerId); e.preventDefault()
        canvas.style.cursor = 'grabbing'
    })
    canvas.addEventListener('pointermove', e => {
        if (held) { spec.drag[held](state, toWorld(at(e))); changed(held); e.preventDefault(); return }
        canvas.style.cursor = nearestHandle(at(e)) ? 'grab' : ''
    })
    const drop = () => { held = null; canvas.style.cursor = '' }
    canvas.addEventListener('pointerup', drop); canvas.addEventListener('pointercancel', drop)
    canvas.addEventListener('touchstart', e => { if (nearestHandle(at(e.touches[0]))) e.preventDefault() }, { passive: false })
    // the keyboard: arrows move the first handle a little
    canvas.addEventListener('keydown', e => {
        const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key]
        const h = handles.find(h => spec.drag?.[h.id])
        if (!k || !h) return
        e.preventDefault()
        const p = toWorld([h.x, h.y]), d = 6 / view.s
        spec.drag[h.id](state, [p[0] + k[0] * d, p[1] + k[1] * d]); changed(h.id)
    })

    const ro = new win.ResizeObserver(() => { if (fit()) render(); kick() })      // drawn at once, seen or not: a resize clears it
    ro.observe(box)
    const io = new win.IntersectionObserver(es => { visible = es.some(e => e.isIntersecting); if (visible) kick() })
    io.observe(el)
    const onTheme = () => { theme = readTheme(el); dirty = true; kick() }
    doc.addEventListener('kit:theme', onTheme)
    doc.fonts?.addEventListener?.('loadingdone', onTheme)
    doc.addEventListener('visibilitychange', kick)
    win.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', onTheme)

    // drawn once now, wherever it is on the page, so a page is whole at rest; work waits until the figure is seen
    fit(); render(); reset()
    return {
        state, render: () => { dirty = true; kick() }, reset,
        set(k, v) { state[k] = v; changed(k) },
        step(nameOfStep) {
            const patch = spec.steps?.[nameOfStep]
            if (!patch) return false
            Object.assign(state, clone(patch)); changed('step:' + nameOfStep)
            return true
        },
        dispose() { ro.disconnect(); io.disconnect(); doc.removeEventListener('kit:theme', onTheme); if (raf) win.cancelAnimationFrame(raf) },
    }
}
