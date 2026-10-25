//======================================================================================================================
// THE DARKROOM'S VIEWER (0.next) -- the kept render, as large as its tab, panned and zoomed.
//
// WHY. Save picture developed its render on a preview at most 320 CSS pixels high, beside its rows in a floating
// panel: a 4K picture's noise, a firefly or a soft edge could not be seen before the file was written. The viewer is
// the picture where the viewport is (the Darkroom tab, index.html), drawn by the develop pass (develop.js preview)
// told by view.js which part to show: Fit, 100 % (one picture pixel on one screen pixel, drawn as a square, not
// blurred), or anything between 1/32 and 64 times, about the cursor.
//
//   const V = makeViewer(host, { darkroom, settings: () => DV, before: () => pic.view, context: canvas => gpuContext })
//   V.picture(pic)   a picture kept (darkroom.picture), or null: shown fitted, or kept where it was when the size is the same
//   V.redraw()       after a setting changed (one draw a frame, however many changes)
//   V.say(text)      a line over the picture (the render's progress); '' takes it away
//
// WHAT IT DRAWS WITH: two canvases stacked. The top one is the picture as developed now; the one under it, drawn only
// while comparing, is the picture as the view showed it (`before`), shown left of the split line by a CSS clip -- so
// a comparison costs a second draw and nothing in the shader. Held `\` (or the Before button) shows `before` alone.
//
// What it reads back: one pixel's light under the cursor (darkroom.pixel, 16 bytes), one read in flight at a time.
// `context` makes a canvas's drawing context: WebGPU on the page, a stand-in in the headless check
// (lib/pathtracer/test/darkroom.check.mjs), which drives everything here but the pixels.
//======================================================================================================================

import { viewFit, viewAt, zoomAt, stepZoom, panBy, toUniform, fromCss, pictureAt, imageXY, zoomLabel } from './view.js'

const BTN = { font: '12px/1 Arial, sans-serif', color: '#b9c4cd', background: 'transparent', border: '0', borderRadius: '4px',
              padding: '5px 8px', cursor: 'pointer', whiteSpace: 'nowrap' }
const BTN_ON = { background: 'rgba(120,150,175,0.32)', color: '#fff' }
const TAG = { position: 'absolute', font: '11px/1.35 var(--sh-mono, ui-monospace, monospace)', color: '#dfe6ec',
              background: 'rgba(16,18,20,0.78)', borderRadius: '4px', padding: '3px 7px', pointerEvents: 'none' }
const NOTHING = 'Nothing rendered yet: set the size and samples on the right, then Render.'

// a number at about four significant figures, without an exponent a person has to decode below a million
const fig = v => !Number.isFinite(v) ? String(v) : Math.abs(v) >= 1e6 || (v !== 0 && Math.abs(v) < 1e-3) ? v.toExponential(2)
    : String(+v.toPrecision(4))

export function makeViewer(host, { darkroom, settings, before, context, clipping = false } = {}) {
    Object.assign(host.style, { position: host.style.position || 'relative', display: 'flex', flexDirection: 'column',
                                overflow: 'hidden', background: '#151719', userSelect: 'none' })

    //------------------------------------------------------------------------------------------------------------------
    // THE BAR: zoom, then the comparisons, then what is kept
    //------------------------------------------------------------------------------------------------------------------
    const bar = document.createElement('div')
    Object.assign(bar.style, { display: 'flex', alignItems: 'center', gap: '2px', padding: '3px 6px', flex: '0 0 auto',
                               borderBottom: '1px solid rgba(160,175,190,0.15)', overflow: 'hidden' })
    const button = (text, tip, key) => {
        const b = document.createElement('button')
        b.type = 'button'; b.textContent = text; b.title = tip; b.dataset.dr = key
        Object.assign(b.style, BTN)
        bar.append(b)
        return b
    }
    const paint = (b, on) => { Object.assign(b.style, on ? BTN_ON : { background: BTN.background, color: BTN.color }); b.setAttribute('aria-pressed', String(on)) }
    const fitB = button('Fit', 'The whole picture (0, or double-click)', 'fit')
    const oneB = button('100 %', 'One picture pixel on one screen pixel (1; 2 for 200 %)', '100')
    const outB = button('−', 'Zoom out (-, or the wheel)', 'out')
    const inB = button('+', 'Zoom in (+, or the wheel)', 'in')
    const zoomT = document.createElement('span')
    Object.assign(zoomT.style, { font: '11px/1 var(--sh-mono, ui-monospace, monospace)', color: '#8a949d', minWidth: '58px',
                                 textAlign: 'center' })
    zoomT.dataset.dr = 'zoom'
    bar.append(zoomT)
    const sep = () => { const s = document.createElement('span'); Object.assign(s.style, { width: '1px', height: '16px', background: 'rgba(160,175,190,0.2)', margin: '0 6px' }); bar.append(s) }
    sep()
    const beforeB = button('Before', 'Hold to see the picture as the view showed it (hold \\)', 'hold')
    const splitB = button('Split', 'Before on the left, now on the right; drag the line', 'split')
    const clipB = button('Clipping', 'Stripe what clips: red reaches white, blue is black', 'clip')
    const caption = document.createElement('span')
    Object.assign(caption.style, { marginLeft: 'auto', font: '11px/1 var(--sh-mono, ui-monospace, monospace)', color: '#8a949d',
                                   overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: '8px' })
    caption.dataset.dr = 'caption'
    bar.append(caption)

    //------------------------------------------------------------------------------------------------------------------
    // THE STAGE: the two canvases, the split line, the readout, the message
    //------------------------------------------------------------------------------------------------------------------
    const stage = document.createElement('div')
    stage.tabIndex = 0
    stage.dataset.dr = 'stage'
    Object.assign(stage.style, { position: 'relative', flex: '1 1 auto', minHeight: '0', outline: 'none', cursor: 'grab', touchAction: 'none' })
    const canvas = () => { const c = document.createElement('canvas'); Object.assign(c.style, { position: 'absolute', left: '0', top: '0', display: 'none' }); return c }
    const nowC = canvas(), beforeC = canvas()
    nowC.dataset.dr = 'now'; beforeC.dataset.dr = 'before'
    const line = document.createElement('div')
    Object.assign(line.style, { position: 'absolute', top: '0', bottom: '0', width: '11px', marginLeft: '-5px', cursor: 'ew-resize', display: 'none',
                                background: 'linear-gradient(to right, transparent 5px, rgba(255,255,255,0.85) 5px, rgba(255,255,255,0.85) 6px, transparent 6px)' })
    line.dataset.dr = 'line'
    const readout = document.createElement('div')
    Object.assign(readout.style, TAG, { left: '8px', bottom: '8px', display: 'none' })
    readout.dataset.dr = 'readout'
    const message = document.createElement('div')
    Object.assign(message.style, TAG, { left: '50%', top: '50%', transform: 'translate(-50%, -50%)', font: '13px/1.4 var(--sh-sans, Arial, sans-serif)',
                                        padding: '8px 12px', maxWidth: '80%', textAlign: 'center' })
    message.dataset.dr = 'message'
    stage.append(beforeC, nowC, line, readout, message)
    host.append(bar, stage)

    //------------------------------------------------------------------------------------------------------------------
    // STATE
    //------------------------------------------------------------------------------------------------------------------
    let pic = null, view = null, said = ''
    let held = false, split = false, splitAt = 0.5, clip = !!clipping
    const ctxs = new Map()
    const ctxOf = c => { if (!ctxs.has(c)) ctxs.set(c, context(c)); return ctxs.get(c) }
    const dpr = () => window.devicePixelRatio || 1
    // the output's size in device pixels: the stage's box, whole pixels
    const res = () => [Math.max(1, Math.round(stage.clientWidth * dpr())), Math.max(1, Math.round(stage.clientHeight * dpr()))]
    const src = () => [pic.w, pic.h]
    const setView = v => { view = v; zoomT.textContent = zoomLabel(v.z); paint(fitB, !!v.fit); paint(oneB, !v.fit && Math.abs(v.z - 1) < 1e-9); redraw() }

    let failed = null
    // a failed draw said over the picture, as the old preview said it in its status: the user is the only one who sees
    /* A PICK (0.next): the next click on the picture, as a picture pixel -- the spot meter's and the eyedropper's. A
       click without a drag picks; a drag still pans; Esc, or another picture, gives null. */
    let picking = null                          // { prompt, resolve }
    const endPick = at => {
        const p = picking
        if (!p) return
        picking = null
        stage.style.cursor = 'grab'
        showMessage()
        p.resolve(at)
    }
    const showMessage = () => {
        const text = picking?.prompt || said || (pic ? (failed ? `The picture could not be drawn: ${failed}` : '') : NOTHING)
        message.textContent = text
        message.style.display = text ? '' : 'none'
    }

    //------------------------------------------------------------------------------------------------------------------
    // DRAWING: one a frame, none while the stage has no size (its tab hidden); a failed draw said once, not every frame
    //------------------------------------------------------------------------------------------------------------------
    let queued = false
    const size = c => {
        const [w, h] = res()
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
        c.style.width = `${w / dpr()}px`; c.style.height = `${h / dpr()}px`
    }
    function redraw() {
        if (queued) return
        queued = true
        requestAnimationFrame(async () => {
            queued = false
            if (!pic || !stage.clientWidth || !stage.clientHeight) return
            const r = res()
            // Fit follows the stage: a splitter dragged or the window resized refits it
            if (view.fit) { view = viewFit(src(), r); zoomT.textContent = zoomLabel(view.z) }
            const u = toUniform(view)
            const comparing = split && !held
            size(nowC); nowC.style.display = ''
            beforeC.style.display = comparing ? '' : 'none'
            line.style.display = comparing ? '' : 'none'
            try {
                await darkroom.preview(ctxOf(nowC), held ? before() : settings(), { view: u, clipWarn: clip })
                if (comparing) {
                    size(beforeC)
                    await darkroom.preview(ctxOf(beforeC), before(), { view: u, clipWarn: clip })
                    // the "now" canvas is on top: cut away its left part to show "before" under it
                    nowC.style.clipPath = `inset(0 0 0 ${splitAt * 100}%)`
                    line.style.left = `${splitAt * 100}%`
                } else nowC.style.clipPath = ''
                if (failed) { failed = null; showMessage() }
            } catch (e) {
                if (failed !== String(e?.message ?? e)) console.error('[darkroom] the picture could not be drawn', e)
                failed = String(e?.message ?? e)
                showMessage()
            }
        })
    }
    try { new ResizeObserver(redraw).observe(stage) } catch { }

    //------------------------------------------------------------------------------------------------------------------
    // THE READOUT: the pixel under the cursor, its light. One read at a time; the latest position read after it.
    //------------------------------------------------------------------------------------------------------------------
    let pointer = null, reading = false
    const readPixel = async () => {
        if (reading || !pointer || !pic || !view) return
        const p = pictureAt(view, pointer, res(), src())
        if (!p) { readout.style.display = 'none'; return }
        reading = true
        const at = pointer
        try {
            const v = await darkroom.pixel(p[0], p[1])
            if (pointer && v) {
                const [x, y] = imageXY(p, src())
                readout.textContent = `x ${x}  y ${y} · ${fig(v.Y)} cd/m² · RGB ${v.rgb.map(fig).join(' ')}`
                readout.style.display = ''
            }
        } catch (e) { console.error('[darkroom] pixel read failed', e) }
        finally {
            reading = false
            if (pointer && pointer !== at) readPixel()
        }
    }

    //------------------------------------------------------------------------------------------------------------------
    // THE HAND: wheel, drag, double-click, the split line, keys
    //------------------------------------------------------------------------------------------------------------------
    const local = e => { const b = stage.getBoundingClientRect(); return fromCss(e.clientX - b.left, e.clientY - b.top, b.height, dpr()) }
    stage.addEventListener('wheel', e => {
        if (!pic) return
        e.preventDefault()
        const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1)
        setView(zoomAt(view, 2 ** (-dy / 500), local(e), res(), src()))
    }, { passive: false })

    let drag = null
    stage.addEventListener('pointerdown', e => {
        if (!pic || (e.button !== 0 && e.button !== 1)) return
        stage.focus({ preventScroll: true })
        drag = { kind: e.target === line ? 'split' : 'pan', last: [e.clientX, e.clientY], from: [e.clientX, e.clientY] }
        try { stage.setPointerCapture(e.pointerId) } catch { }
        if (drag.kind === 'pan' && !picking) stage.style.cursor = 'grabbing'
        e.preventDefault()
    })
    stage.addEventListener('pointermove', e => {
        if (drag?.kind === 'pan') {
            const d = [(e.clientX - drag.last[0]) * dpr(), -(e.clientY - drag.last[1]) * dpr()]
            drag.last = [e.clientX, e.clientY]
            setView(panBy(view, d, res(), src()))
        } else if (drag?.kind === 'split') {
            const b = stage.getBoundingClientRect()
            splitAt = Math.min(1, Math.max(0, (e.clientX - b.left) / Math.max(1, b.width)))
            redraw()
        }
        if (pic && view) { pointer = local(e); readPixel() }
    })
    const endDrag = e => {
        if (!drag) return
        const d = drag
        drag = null
        stage.style.cursor = picking ? 'crosshair' : 'grab'
        try { stage.releasePointerCapture(e.pointerId) } catch { }
        // a pick is a click: let go within a few pixels of where it went down, on the picture
        if (picking && e.type === 'pointerup' && d.kind === 'pan' && Math.hypot(e.clientX - d.from[0], e.clientY - d.from[1]) < 4) {
            const at = pictureAt(view, local(e), res(), src())
            if (at) endPick(at)
        }
    }
    stage.addEventListener('pointerup', endDrag)
    stage.addEventListener('pointercancel', endDrag)
    stage.addEventListener('pointerleave', () => { if (!drag) { pointer = null; readout.style.display = 'none' } })
    // double-click: 100 % at that point, or back to the whole picture
    stage.addEventListener('dblclick', e => {
        if (!pic || e.target === line) return
        if (!view.fit && Math.abs(view.z - 1) < 1e-9) setView(viewFit(src(), res()))
        else setView(zoomAt(view, 1 / view.z, local(e), res(), src()))
    })

    const fit = () => pic && setView(viewFit(src(), res()))
    const zoomTo = z => pic && setView(viewAt(src(), res(), z, view.fit ? undefined : [view.cx, view.cy]))
    const step = dir => pic && setView(stepZoom(view, dir, res(), src()))
    /* BEFORE, held by the key or by the button: each lets go of its own. Pressing the button takes the focus from the
       stage, and the stage's blur used to let go of the button's hold as it began. */
    const holders = new Set()
    const hold = (by, on) => {
        if (on) holders.add(by); else holders.delete(by)
        if (held === holders.size > 0) return
        held = holders.size > 0; paint(beforeB, held); redraw()
    }
    fitB.onclick = fit
    oneB.onclick = () => zoomTo(1)
    inB.onclick = () => step(1)
    outB.onclick = () => step(-1)
    beforeB.addEventListener('pointerdown', () => hold('button', true))
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) beforeB.addEventListener(ev, () => hold('button', false))
    splitB.onclick = () => { split = !split; paint(splitB, split); redraw() }
    clipB.onclick = () => { clip = !clip; paint(clipB, clip); redraw() }
    paint(clipB, clip)

    stage.addEventListener('keydown', e => {
        if (!pic || e.ctrlKey || e.metaKey || e.altKey) return
        const r = res(), pan = d => setView(panBy(view, d, r, src()))
        const k = e.key
        if (k === 'Escape' && picking) endPick(null)
        else if (k === '0') fit()
        else if (k === '1') zoomTo(1)
        else if (k === '2') zoomTo(2)
        else if (k === '+' || k === '=') step(1)
        else if (k === '-' || k === '_') step(-1)
        else if (k === 'ArrowLeft') pan([r[0] * 0.1, 0])
        else if (k === 'ArrowRight') pan([-r[0] * 0.1, 0])
        else if (k === 'ArrowUp') pan([0, -r[1] * 0.1])
        else if (k === 'ArrowDown') pan([0, r[1] * 0.1])
        else if (k === '\\') hold('key', true)
        else return
        e.preventDefault()
    })
    stage.addEventListener('keyup', e => { if (e.key === '\\') hold('key', false) })
    stage.addEventListener('blur', () => hold('key', false))       // the key let go elsewhere is never heard here

    //------------------------------------------------------------------------------------------------------------------
    for (const b of [fitB, oneB, outB, inB, beforeB, splitB, clipB]) b.disabled = true
    zoomT.textContent = ''
    showMessage()

    return {
        element: host,
        /** the view as it is now (view.js's numbers), or null with nothing kept */
        get view() { return view && { ...view } },
        get clipping() { return clip },
        picture(next) {
            endPick(null)                       // a pick was for the picture before
            const same = pic && next && next.w === pic.w && next.h === pic.h
            pic = next
            for (const b of [fitB, oneB, outB, inB, beforeB, splitB, clipB]) b.disabled = !pic
            if (!pic) {
                view = null; zoomT.textContent = ''; caption.textContent = ''
                nowC.style.display = beforeC.style.display = line.style.display = readout.style.display = 'none'
                showMessage()
                return
            }
            caption.textContent = `${pic.w}×${pic.h} · ${pic.samples} samples · ${Math.ceil(pic.bytes / 1e6)} MB kept`
            showMessage()
            // the same size again (a render with more samples, say): the same place, to compare
            setView(same && view ? view : viewFit(src(), res()))
        },
        redraw,
        say(text) { said = text || ''; showMessage() },
        /** The next click on the picture: [x, y] as the buffer numbers its pixels (row 0 the bottom), or null when
         *  cancelled (Esc, another picture, another pick). The prompt shows over the picture meanwhile. */
        pick(prompt) {
            endPick(null)
            if (!pic) return Promise.resolve(null)
            return new Promise(resolve => {
                picking = { prompt: `${prompt} · Esc to cancel`, resolve }
                stage.style.cursor = 'crosshair'
                stage.focus({ preventScroll: true })
                showMessage()
            })
        },
    }
}
