//======================================================================================================================
// PRINT DIALOG -- File > Export > 3D print...: what to print, the box it is cut by, and the export (0.next).
//
// THE EXPORT USED TO NEED AN OBJECT IN THE SCENE, an "export box" added from the + menu, whose panel held the buttons
// (the user, 2026-11-04: such things "feel like add-ons ... and are not always properly placed"). Now nothing is added:
// this asks WHAT -- the selected object, or the whole scene -- and offers the box fitted to it (exportbox.js fittedBox,
// from the measured boxes), which can be typed over. Its outline is drawn in the picture while the dialog is open
// (overlay.js outline) and goes with it.
//
// Plain DOM, not a Tweakpane folder, as paramdialog.js and unitdialog.js are and for their reason: the panel is rebuilt
// after every edit. NOT MODAL: the camera can be turned to look at the box, so a click elsewhere leaves it open; Close
// or Escape shuts it. The cell, the colour count and the format are remembered per browser -- an export's settings,
// not the scene's, so not in its file or its undo history -- and the box is not remembered at all.
//======================================================================================================================

import { EXPORT_DEFAULTS, FORMATS, fittedBox, exportGrid, gridProblem, settingsProblems, boxProblems, corners, centreOf, sizeOf, boxOf } from './exportbox.js'

const STORE = 'shadytracer.print'
const remembered = () => {
    try { const o = JSON.parse(localStorage.getItem(STORE) || '{}'); return o && typeof o === 'object' ? o : {} } catch { return {} }
}
const remember = o => { try { localStorage.setItem(STORE, JSON.stringify(o)) } catch { /* a browser that refuses storage forgets */ } }

let open = null

/**
 * @param doc        () => the document worked on (BUILDER.doc)
 * @param selected   the selected node's id, or null: what "Selected object" means. The root, a light, a haze box or nothing
 *                   leaves only the whole scene.
 * @param boxes      the page's measured boxes (boxes.js: get, request), for the fitted box
 * @param estimate   (id | null) => { lo, hi } in the WORLD, or null: the guess while nothing is measured
 * @param outline    (cornersFn | null) => void: draws the box in the picture (overlay.js outline)
 * @param onExport   ({ subject, box, format, cell, colours }, say) => Promise<{ triangles, bytes, palette, open }>
 * @returns the dialog's element
 */
export function openPrintDialog({ doc, selected = null, boxes = null, estimate = () => null, outline = () => { }, onExport }) {
    close()
    const d0 = doc()
    const node = selected != null ? findNode(d0.root, selected) : null
    const canObject = !!node && node !== d0.root && !(node.kind === 'object' && (node.type === 'light' || node.type === 'haze'))
    const unit = d0.unit ?? 'm'
    const R = remembered()
    const S = {
        subject: canObject ? 'object' : 'scene',
        format: FORMATS.includes(R.format) ? R.format : '3mf',
        cell: Number.isFinite(R.cell) && R.cell > 0 ? R.cell : EXPORT_DEFAULTS.cell,
        colours: Number.isInteger(R.colours) && R.colours >= 1 && R.colours <= 64 ? R.colours : EXPORT_DEFAULTS.colours,
        box: null, fitted: 'none', typed: false, busy: false,
    }

    const el = document.createElement('div')
    el.setAttribute('role', 'dialog')
    el.setAttribute('aria-label', '3D print')
    el.className = 'print-dialog'
    Object.assign(el.style, {
        position: 'fixed', zIndex: 2000, background: '#2b2f33', color: '#e0e0e0',
        border: '1px solid #555', borderRadius: '5px', padding: '8px 10px', width: '300px',
        font: '12px/1.4 Arial, sans-serif', boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
    })
    const add = (tag, props = {}, style = {}) => { const e = Object.assign(document.createElement(tag), props); Object.assign(e.style, style); return e }
    const fieldStyle = { flex: '1', minWidth: '0', background: '#1e2124', color: '#e0e0e0', border: '1px solid #444',
        borderRadius: '3px', padding: '2px 4px', font: 'inherit' }
    const row = (label, ...els) => {
        const r = add('label', {}, { display: 'flex', alignItems: 'center', gap: '6px', margin: '4px 0' })
        r.append(add('span', { textContent: label }, { width: '70px', color: '#aab', flex: '0 0 auto' }), ...els)
        el.appendChild(r); return r
    }

    el.appendChild(add('div', { textContent: '3D print (3MF / STL)' }, { fontWeight: 'bold', marginBottom: '4px' }))

    // ---- what
    const what = add('div', {}, { margin: '4px 0' })
    const radio = (value, text, enabled) => {
        const l = add('label', {}, { display: 'flex', alignItems: 'center', gap: '6px', opacity: enabled ? '1' : '0.45' })
        const r = add('input', { type: 'radio', name: 'print-what', value, checked: S.subject === value, disabled: !enabled })
        r.dataset.what = value
        r.onchange = () => { if (r.checked) { S.subject = value; S.typed = false; fit(); refresh() } }
        l.append(r, add('span', { textContent: text }))
        what.appendChild(l); return r
    }
    radio('object', canObject ? `Selected object: ${node.label || node.id}` : 'Selected object (select one in the tree or the picture)', canObject)
    radio('scene', 'Whole scene', true)
    el.appendChild(what)

    // ---- the box, its size in the scene's unit, in its own frame
    const sizes = [0, 1, 2].map(k => add('input', { type: 'number', step: 'any', min: '0' }, fieldStyle))
    sizes.forEach((inp, k) => { inp.dataset.axis = 'xyz'[k]; inp.oninput = () => typedSize() })
    const fitBtn = add('button', { textContent: 'Fit', title: 'The box fitted to what is printed again' },
        { font: 'inherit', padding: '1px 6px', cursor: 'pointer', borderRadius: '3px', border: '1px solid #555', background: '#3a3f44', color: '#fff' })
    fitBtn.onclick = e => { e.preventDefault(); S.typed = false; fit(); refresh() }
    row(`size (${unit})`, ...sizes, fitBtn)
    const boxNote = el.appendChild(add('div', {}, { color: '#8a8f96', fontSize: '11px', margin: '2px 0 4px' }))

    // ---- the settings
    const cell = row('cell (mm)', add('input', { type: 'number', step: '0.01', min: '0.01', value: S.cell }, fieldStyle)).querySelector('input')
    const colours = row('colours', add('input', { type: 'number', step: '1', min: '1', max: '64', value: S.colours }, fieldStyle)).querySelector('input')
    const format = row('format', add('select', {}, fieldStyle)).querySelector('select')
    for (const [v, t] of [['3mf', '3MF (with colour)'], ['stl', 'STL (no colour)']]) format.appendChild(add('option', { value: v, textContent: t }))
    format.value = S.format
    cell.oninput = () => { S.cell = +cell.value; refresh() }
    colours.oninput = () => { S.colours = Math.round(+colours.value); refresh() }
    format.onchange = () => { S.format = format.value; refresh() }

    const grid = el.appendChild(add('div', {}, { color: '#8a8f96', fontSize: '11px', margin: '4px 0', whiteSpace: 'pre-wrap' }))
    const status = el.appendChild(add('div', {}, { minHeight: '1.4em', margin: '4px 0', whiteSpace: 'pre-wrap' }))
    const say = (t, bad = false) => { status.textContent = t; status.style.color = bad ? '#ff8a80' : '#e0e0e0' }

    const buttons = add('div', {}, { display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '6px' })
    const btn = (label, primary) => {
        const b = add('button', { textContent: label }, { font: 'inherit', padding: '3px 10px', cursor: 'pointer', borderRadius: '3px',
            border: '1px solid #555', background: primary ? '#2f6db5' : '#3a3f44', color: '#fff' })
        buttons.appendChild(b); return b
    }
    const closeBtn = btn('Close'), go = btn('Export', true)
    el.appendChild(buttons)

    /* THE FITTED BOX: measured if it is (fittedBox), else the world estimate the host gives and the measure asked for --
       refitted once the measure comes, unless a size was typed meanwhile */
    function fit() {
        const id = S.subject === 'object' ? node.id : null
        const d = doc()
        const b = boxes ? fittedBox(d, boxes, id) : null
        if (b) { S.box = b; S.fitted = 'measured'; return }
        boxes?.request?.(id ?? d.root.id)
        const e = estimate(id)
        S.box = e ? { frames: [], lo: e.lo.slice(), hi: e.hi.slice() } : null
        S.fitted = e ? 'estimated' : 'none'
    }
    function typedSize() {
        const v = sizes.map(i => +i.value)
        if (!S.box || !v.every(x => Number.isFinite(x) && x > 0)) return refresh(false)
        S.box = boxOf(S.box.frames, centreOf(S.box), v)
        S.typed = true
        refresh(false)
    }
    function refresh(writeSizes = true) {
        if (writeSizes) sizes.forEach((inp, k) => { inp.value = S.box ? +sizeOf(S.box)[k].toPrecision(6) : '' })
        boxNote.textContent = !S.box ? 'nothing measured yet: waiting for the boxes, or type a size'
            : (S.typed ? 'typed; Fit takes the fitted box again. ' : S.fitted === 'estimated' ? 'a first guess, while the box is measured. ' : 'fitted to it. ')
              + (S.subject === 'object' && S.box.frames.length ? 'In the object\'s own frame, its z up on the bed.' : 'In the world, z up on the bed.')
        let text = '', problem = null
        const bad = [...settingsProblems({ cell: S.cell, colours: S.colours }), ...(S.box ? boxProblems(S.box) : ['no box'])]
        if (bad.length) problem = bad[0]
        else {
            try {
                const g = exportGrid(doc().unit, S.box, { cell: S.cell })
                text = `${g.sizeMm.map(v => v.toPrecision(4)).join(' x ')} mm, ${g.n.map(k => k - 2).join(' x ')} cells of ~${g.spacing[0].toPrecision(3)} mm`
                problem = gridProblem(g)
            } catch (e) { problem = e.message }
        }
        grid.textContent = text + (problem ? `${text ? '\n' : ''}${problem}` : '')
        grid.style.color = problem ? '#ff8a80' : '#8a8f96'
        go.disabled = !!problem || S.busy
        go.style.opacity = go.disabled ? '0.5' : ''
        colours.parentElement.style.display = S.format === '3mf' ? 'flex' : 'none'
    }

    async function run() {
        if (S.busy || go.disabled) return
        S.busy = true; refresh(false)
        remember({ cell: S.cell, colours: S.colours, format: S.format })
        const t0 = performance.now()
        try {
            const r = await onExport({ subject: S.subject === 'object' ? node.id : null, box: S.box, format: S.format, cell: S.cell, colours: S.colours }, t => say(t))
            say(`${S.format.toUpperCase()}: ${r.triangles.toLocaleString()} triangles, ${(r.bytes.length / 1048576).toFixed(1)} MB`
                + (r.palette ? `, ${r.palette.length} colour(s)` : '')
                + (r.open ? `, ${r.open}+ OPEN EDGES (a mesher bug: please report)` : '')
                + `, ${((performance.now() - t0) / 1000).toFixed(1)} s`)
        } catch (e) {
            console.error('[print] export failed:', e)
            say(`export failed: ${e.message}`, true)
        } finally { S.busy = false; refresh(false) }
    }
    go.onclick = run
    closeBtn.onclick = close
    el.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); close() }
        if (e.key === 'Enter' && e.target?.tagName !== 'BUTTON') { e.preventDefault(); run() }
        e.stopPropagation()          // Ctrl+Z inside the dialog is the field's, not the scene's
    })

    fit()
    document.body.appendChild(el)
    const b = el.getBoundingClientRect()
    el.style.left = `${Math.max(4, (innerWidth - b.width) / 2)}px`
    el.style.top = `${Math.max(4, Math.min(80, innerHeight - b.height - 4))}px`
    refresh()
    say(S.subject === 'object' ? 'the selected object alone, cut by the box' : 'everything solid in the box, as the picture shows it')
    outline(() => S.box ? corners(S.box) : null)
    // a measure that was not there yet: the fitted box once it is, unless the user typed one
    const poll = setInterval(() => {
        if (S.typed || S.fitted === 'measured' || !boxes) return
        const was = S.fitted
        fit()
        if (S.fitted !== was || S.fitted === 'measured') refresh()
    }, 400)
    open = { el, outline, poll }
    return el
}

const findNode = (n, id) => n.id === id ? n : (n.children || []).reduce((r, c) => r || findNode(c, id), null)

/** Whether the dialog is open (for the host and the checks). */
export const isOpen = () => !!open

export function close() {
    if (!open) return
    clearInterval(open.poll)
    open.outline(null)
    open.el.remove()
    open = null
}
