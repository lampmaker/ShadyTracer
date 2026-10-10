//======================================================================================================================
// READOUT -- the selection's numbers, in one panel at the top right of the view (the user, 2026-10-02: "a textual
// indication of the parameters (xyz, rotation, scale parameters or dimensions in mm) would be nice. The points picker
// had a popup right next to the control, but maybe a more organized, semi transparent overlay in the upper right
// corner of the viewport is a bit nicer").
//
// ONE PANEL FOR BOTH MODES (overlay.js).
//   TRANSFORM: the node's position, rotation and scale, the numbers the properties panel shows; its LENGTHS, the
//   parameters marked as lengths in the scene's unit (a box's size and rounding, a cylinder's radius and height), and
//   any a stretch cube changes (a light's width, an export box's size); and
//   its BOUNDS, measured; and what of it is LOCKED or bound (model.js heldOf), the reason its handles are missing. While a handle is held, a row for what the drag has done so far, and every number it has
//   changed lit; over a stretch cube, the numbers that cube would change lit more softly.
//   POINTS (pointsmode.js): the selected point's numbers, the step to the one before, its fillet, the grid, and what
//   is wrong -- drawn beside the point until now, on whichever side covered the fewest handles, and it still sat on
//   controls now and then. Enter's typed entry opens here too, in place of the numbers.
//
// A LENGTH IS IN THE SCENE'S UNIT, AS WRITTEN: a box's size is its HALF size (primitives.js), as its slider says; the
// shader has no units, so nothing is converted (model.js, "A LENGTH"). What it measures across is the BOUNDS row: the
// extent along the node's own axes, times every scale above it -- a real length in the scene's unit. Measured on the
// GPU (boxes.js), so good to a cell (the tooltip says how much), marked ≈, and dimmed while the shape has changed
// since it was measured; not shown for an open object (a plane), whose box is only where the search stopped.
//
// IT NEVER TAKES THE MOUSE: pointer events pass through it to the picture, so a handle under it can still be grabbed
// and the camera still orbits through it -- except while the typed entry is open in it, which needs the keys.
//
// UNDER THE LIBRARY'S STRIP: an item being edited puts its Save and Close across the top right (library/edit.js,
// shell.css .shell-edit-strip); the panel moves below it.
//
// transformReadout is pure (test/readout.test.mjs); installReadout is the DOM.
//======================================================================================================================

import { find, isLength, paramKind, heldOf, viewOf } from './model.js'
import { moveFrame, AXES } from './gizmo.js'
import { fmt } from './pointedit.js'
import { stretchOf } from './stretch.js'

export const AXIS_COLOR = { x: '#ff5555', r: '#ff5555', y: '#55dd55', z: '#5599ff' }

/** Degrees, one decimal, never "-0.0". */
export const deg = v => { const s = (Math.abs(v) < 0.05 ? 0 : v).toFixed(1); return s === '-0.0' ? '0.0' : s }
/** A difference, with its sign. */
export const signed = v => { const s = fmt(v); return s.startsWith('-') ? s : `+${s}` }
/** A measured length: three significant figures -- it is good to a cell, not to four decimals. */
const approx = v => (Math.abs(v) >= 1000 || (v !== 0 && Math.abs(v) < 0.001) ? v.toExponential(2) : String(+v.toPrecision(3)))
/** A factor: × 1.250 */
const times = f => `× ${f.toFixed(3)}`

/**
 * The Transform readout of node `id`, or null for one with no transform (the root, a material).
 * @param drag     the overlay's drag while a handle is held: { kind: 'move' | 'rotate' | 'scale' | 'stretch', start
 *                 (the transform at mousedown), deg (rotate: the turn applied), k (rotate: the axis), c (stretch: the
 *                 axis), params0 (stretch: the parameters at mousedown) }
 * @param preview  [{ k, c? }]: parameters a handle under the pointer would change (a stretch cube's), lit softly
 * @param box      the measured bounds ({ lo, hi, cell, open }, boxes.js get), or null; `fresh` whether it is current
 * @param snap     { grid, size }: the grid Ctrl snaps a move to, in the parent's units, and a size to, in the node's
 *                 own (overlay.js gridAt) -- said in a note
 * @returns { title, unit, rows: [{ label, unit?, cells: [{ axis?, text, hot?, lit? }], dim?, tip? }], notes: [] }
 */
export function transformReadout(doc, id, { drag = null, preview = null, box = null, fresh = true, snap = null } = {}) {
    const found = id != null ? find(doc, id)?.node : null
    if (!found?.transform || found === doc.root) return null
    // with its block's schema -- which parameters are lengths, the code a stretch is read from (model.js viewOf)
    const node = viewOf(doc, found)
    const t = node.transform, s = drag?.start ?? null, unit = doc.unit ?? 'm'
    const cell = (axis, text, hot = false, lit = false) => ({ ...(axis ? { axis } : {}), text, ...(hot ? { hot } : {}), ...(lit ? { lit } : {}) })
    const rows = [
        { label: 'position', unit, cells: AXES.map(a => cell(a, fmt(t.pos[a]), !!s && t.pos[a] !== s.pos[a])) },
        { label: 'rotation', unit: '°', cells: AXES.map(a => cell(a, deg(t.rot[a]), !!s && t.rot[a] !== s.rot[a])) },
        { label: 'scale', cells: [cell(null, fmt(t.scale), !!s && t.scale !== s.scale)] },
    ]
    /* THE LENGTHS, in the order the node has them: numbers and vectors (a profile or a path has its own mode) -- and
       what a stretch cube changes, a length or not (a light's width, an export box's size: neither is marked one) */
    const p0 = drag?.kind === 'stretch' ? drag.params0 : null
    const lit = (k, c) => !!preview?.some(r => r.k === k && (r.c ?? null) === (c ?? null))
    const stretchy = new Set(Object.values(stretchOf(node) || {}).flat().map(r => r.k))
    for (const [k, v] of Object.entries(node.params || {})) {
        if (!isLength(node, k) && !stretchy.has(k)) continue
        const kind = paramKind(v)
        if (kind === 'number' && Number.isFinite(v))
            rows.push({ label: k, unit, cells: [cell(null, fmt(v), !!p0 && k in p0 && p0[k] !== v, lit(k))] })
        else if (kind === 'vector') {
            const comps = AXES.filter(c => typeof v[c] === 'number')
            rows.push({ label: k, unit, cells: comps.map(c => cell(c, fmt(v[c]), !!p0?.[k] && p0[k][c] !== v[c], lit(k, c))) })
        }
    }
    // THE BOUNDS: the measured box along the node's own axes, times the scales above it and its own
    if (box && !box.open && box.lo && box.hi) {
        const S = (moveFrame(doc, id)?.scale ?? 1) * t.scale
        rows.push({ label: 'bounds ≈', unit, dim: !fresh,
            tip: `measured on the GPU, to within ${approx(box.cell * S)} ${unit}${fresh ? '' : ' -- the shape has changed since'}`,
            cells: [0, 1, 2].map(n => cell(AXES[n], approx((box.hi[n] - box.lo[n]) * S))) })
    }
    // WHAT THE DRAG HAS DONE so far
    if (drag && s) {
        if (drag.kind === 'move') rows.push({ label: 'moved', unit, cells: AXES.map(a => cell(a, signed(t.pos[a] - s.pos[a]), true)) })
        else if (drag.kind === 'rotate') rows.push({ label: 'turned', unit: '°', cells: [cell(AXES[drag.k], (drag.deg < 0 ? '' : '+') + deg(drag.deg ?? 0), true)] })
        else if (drag.kind === 'scale') rows.push({ label: 'scaled', cells: [cell(null, times(t.scale / s.scale), true)] })
        else if (drag.kind === 'stretch') {
            // the factor applied, read back from a size that was more than nothing (a range or a snap may hold it)
            const r = (drag.refs || []).find(r => { const v0 = r.c ? p0?.[r.k]?.[r.c] : p0?.[r.k]; return v0 > 0 })
            const v0 = r && (r.c ? p0[r.k][r.c] : p0[r.k]), v = r && (r.c ? node.params[r.k][r.c] : node.params[r.k])
            if (r) rows.push({ label: 'stretched', cells: [cell(AXES[drag.c], times(v / v0), true)] })
        }
    }
    // WHAT IS LOCKED, first: it is why handles are missing (overlay.js, LOCKED)
    const notes = [], lock = heldOf(node)
    // what the user locked, and what is held by its bindings (model.js heldOf, version 18): two reasons, two remedies
    const own = { position: node.lockPosition === true, params: node.lockParams === true }
    const what = which => which === 'position' ? 'position and rotation' : 'parameters and scale'
    const locked = ['position', 'params'].filter(w => own[w]).map(what), bound = ['position', 'params'].filter(w => !own[w] && lock.bound?.[w]).map(what)
    if (locked.length) notes.push({ tone: 'lock', text: `locked: ${locked.join(', ')} -- unlock in the properties panel or the tree` })
    if (bound.length) notes.push({ tone: 'lock', text: `from parameters: ${bound.join(', ')} -- bound in the properties panel, "from parameters"` })
    // WHAT CTRL SNAPS TO: one grid for moves and sizes unless the node's own scale makes them two
    if (snap) notes.push({ tone: 'note', text: snap.size === snap.grid
        ? `grid ${snap.grid} -- Ctrl snaps moves and sizes to it; turns to 15\u00b0, scale to 0.1`
        : `grid ${snap.grid} -- Ctrl snaps moves to it, sizes to ${snap.size}; turns to 15\u00b0, scale to 0.1` })
    return { title: node.label || node.id, unit, rows, notes }
}

/**
 * The panel, on `stage` (the view's element).
 * @returns { show(model | null), form(el | null), get element, get model }
 *   model: { title, sub?, unit?, rows: [{ label, unit?, cells: [{ axis?, text, hot?, lit? }], dim?, tip? }],
 *            notes: [{ text, tone?: 'note' | 'bad' | 'fillet' | 'lock' }] }
 */
export function installReadout(stage) {
    const el = document.createElement('div')
    el.className = 'edit-readout'
    Object.assign(el.style, { position: 'absolute', top: '8px', right: '8px', zIndex: '11', display: 'none',
        pointerEvents: 'none', boxSizing: 'border-box', minWidth: '200px', maxWidth: 'min(380px, calc(100% - 16px))',
        maxHeight: 'calc(100% - 60px)', overflow: 'hidden', padding: '6px 9px 7px', borderRadius: '5px',
        font: '12px Arial, sans-serif', color: '#ccd4db', background: 'rgba(18,21,24,0.55)',
        border: '1px solid rgba(160,175,190,0.25)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)' })
    stage.appendChild(el)
    const TONE = { note: '#9aa5ae', bad: '#ff6b6b', fillet: '#ff9f43', lock: '#ffcc33' }
    /* A HEAD AND A BODY: the head (the name) follows the model every time; the body is the numbers or the typed entry.
       While the entry is open the body is left alone -- taking a focused input out of the page and putting it back
       blurs it, and the model changes under it (a refusal said, its time running out). */
    const head = document.createElement('div'), body = document.createElement('div')
    Object.assign(head.style, { display: 'flex', gap: '8px', alignItems: 'baseline' })
    el.append(head, body)
    let model = null, key = null, form = null, strip

    /* below the library's strip while it is there: its height read only when it comes or goes */
    const place = () => {
        const s = stage.querySelector('.shell-edit-strip')
        if (s === strip) return
        strip = s
        el.style.top = s ? `${s.offsetTop + s.offsetHeight + 6}px` : '8px'
    }
    const span = (text, style = {}) => { const e = document.createElement('span'); e.textContent = text; Object.assign(e.style, style); return e }
    function numbers(m) {
        const out = []
        const grid = document.createElement('div')
        Object.assign(grid.style, { display: 'grid', gridTemplateColumns: 'auto repeat(3, auto) auto', columnGap: '8px', rowGap: '2px',
            alignItems: 'baseline', fontVariantNumeric: 'tabular-nums', marginTop: '4px' })
        for (const r of m.rows || []) {
            const label = span(r.label, { color: TONE.note, whiteSpace: 'nowrap' })
            if (r.tip) label.title = r.tip
            const row = [label]
            for (let n = 0; n < 3; n++) {
                const c = r.cells[n]
                const e = document.createElement('span')
                Object.assign(e.style, { textAlign: 'right', whiteSpace: 'nowrap', minWidth: '5.6em', borderRadius: '3px', padding: '0 2px' })
                if (c) {
                    if (c.axis) e.append(span(c.axis + ' ', { color: AXIS_COLOR[c.axis] ?? TONE.note, fontSize: '10px' }))
                    e.append(span(c.text, c.hot ? { color: '#fff', fontWeight: 'bold' } : c.lit ? { color: '#fff' } : {}))
                    if (c.lit && !c.hot) e.style.background = 'rgba(255,255,255,0.12)'
                    if (c.hot) e.dataset.hot = '1'
                }
                row.push(e)
            }
            row.push(span(r.unit ?? '', { color: TONE.note }))
            if (r.dim) for (const e of row) e.style.opacity = '0.5'
            grid.append(...row)
        }
        if (m.rows?.length) out.push(grid)
        for (const n of m.notes || []) out.push(span(n.text, { display: 'block', marginTop: '3px', color: TONE[n.tone] ?? '#ccd4db' }))
        return out
    }
    function render() {
        const m = model
        if (!m && !form) { el.style.display = 'none'; return }
        el.style.display = 'block'
        el.style.pointerEvents = form ? 'auto' : 'none'
        head.replaceChildren(...(m ? [span(m.title, { color: '#fff', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1' }),
            ...(m.sub ? [span(m.sub, { color: TONE.note })] : []), ...(m.unit ? [span(m.unit, { color: TONE.note })] : [])] : []))
        if (form) { if (body.firstChild !== form || body.childNodes.length !== 1) { body.replaceChildren(form); form.style.marginTop = '4px' } }
        else body.replaceChildren(...(m ? numbers(m) : []))
    }
    return {
        /** What to show, or null for nothing; the same model again changes nothing in the page. */
        show(next) {
            place()
            const k = next ? JSON.stringify(next) : null
            if (k === key) return
            key = k; model = next
            render()
        },
        /** The typed entry, in place of the numbers (it takes the mouse and the keys while open); null closes it. */
        form(f) {
            if (f === form) return
            form = f
            place()
            render()
        },
        get element() { return el },
        /** The model last shown, for the checks. */
        get model() { return model },
    }
}
