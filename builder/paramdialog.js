//======================================================================================================================
// PARAMETER DIALOG -- add or edit one parameter of a code node: name, kind, live or compile-time,
// and for a number the range its slider offers.
//
// A small popup of plain DOM next to the icon that opened it, not a Tweakpane folder: the panel
// is rebuilt after every structural change, and a form living inside it would be torn down under
// the user mid-edit. Nothing here touches the document -- `onApply` gets the values and returns
// an error message (shown in the dialog, which stays open) or nothing (the dialog closes). The
// model decides what is valid; this only collects.
//======================================================================================================================

const KINDS = { number: 'number', vector: 'vector (x, y, z)', colour: 'colour (r, g, b)', profile: 'profile (points to extrude or revolve)',
    path: 'path (points to sweep along)' }
const MODES = { '': 'live uniform', u32: 'compile-time u32', i32: 'compile-time i32', f32: 'compile-time f32' }

let open = null

/**
 * @param anchor   the element to open beside
 * @param values   { name, kind, mode, range: {min,max,step} | null, length } -- the current ones, or a
 *                 new parameter's defaults; `length` is whether it is in the scene's unit
 * @param title    the dialog's heading
 * @param unit     what a length is in, for the note: the scene's unit, or 'mm' for a material's (real size)
 * @param onApply  (values) => string | void -- an error to show, or nothing to close
 * @param kinds    the kinds offered (a profile or a path is a code object's only: model.js setParamKind)
 */
export function openParamDialog(anchor, values, { title = 'Parameter', unit = null, onApply, kinds = Object.keys(KINDS) }) {
    close()
    const v = { name: '', kind: 'number', mode: '', range: null, ...values }
    const box = document.createElement('div')
    Object.assign(box.style, {
        position: 'fixed', zIndex: 2000, background: '#2b2f33', color: '#e0e0e0',
        border: '1px solid #555', borderRadius: '5px', padding: '8px 10px', width: '240px',
        font: '12px/1.4 Arial, sans-serif', boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
    })
    const row = (label, el) => {
        const r = document.createElement('label')
        Object.assign(r.style, { display: 'flex', alignItems: 'center', gap: '6px', margin: '4px 0' })
        const t = document.createElement('span'); t.textContent = label
        Object.assign(t.style, { width: '62px', color: '#aab' })
        Object.assign(el.style, { flex: '1', minWidth: '0', background: '#1e2124', color: '#e0e0e0',
            border: '1px solid #444', borderRadius: '3px', padding: '2px 4px', font: 'inherit' })
        r.append(t, el); box.appendChild(r); return el
    }
    const input = (value, type = 'text') => Object.assign(document.createElement('input'), { type, value })
    const select = (options, value) => {
        const s = document.createElement('select')
        for (const [k, label] of Object.entries(options)) s.appendChild(Object.assign(document.createElement('option'), { value: k, textContent: label }))
        s.value = value; return s
    }

    const h = document.createElement('div'); h.textContent = title
    Object.assign(h.style, { fontWeight: 'bold', marginBottom: '4px' }); box.appendChild(h)
    const name = row('name', input(v.name))
    const kind = row('kind', select(Object.fromEntries(Object.entries(KINDS).filter(([k]) => kinds.includes(k) || k === v.kind)), v.kind))
    const mode = row('value is', select(MODES, v.mode))
    const rMin = row('min', input(v.range?.min ?? '', 'number'))
    const rMax = row('max', input(v.range?.max ?? '', 'number'))
    const rStep = row('step', input(v.range?.step ?? '', 'number'))
    /* A LENGTH, in the scene's unit: the panel then shows it beside the name, "radius (cm)", as the
       position has it (the user, 2026-09-28). A label only -- the shader has numbers, not units. */
    /* ...and a MATERIAL'S length is real millimetres, whatever the scene's unit: a material has no unit of its
       own and the same leather goes on a metre sofa and a millimetre watch strap (SURFACES.md, Scale) */
    const where = unit === 'mm' ? 'in real mm (a material\'s lengths are)' : 'in the scene\'s unit'
    const len = row('length', Object.assign(input('', 'checkbox'), { checked: !!v.length, title: `${where}: shown beside its name` }))
    Object.assign(len.style, { flex: '0 0 auto', width: 'auto' })
    const lenNote = document.createElement('span'); lenNote.textContent = unit === 'mm' ? 'in mm, real size' : 'show the scene\'s unit'
    Object.assign(lenNote.style, { color: '#8a8f96', fontSize: '11px' })
    len.parentElement.appendChild(lenNote)
    const note = document.createElement('div')
    Object.assign(note.style, { color: '#8a8f96', fontSize: '11px', margin: '4px 0' })
    const err = document.createElement('div')
    Object.assign(err.style, { color: '#ff8a80', minHeight: '0', margin: '4px 0', whiteSpace: 'pre-wrap' })
    box.append(note, err)

    /* Only a number can be compile-time or have a range; the rest hides rather than lies. */
    const sync = () => {
        const num = kind.value === 'number'
        for (const el of [mode, rMin, rMax, rStep]) el.parentElement.style.display = num ? 'flex' : 'none'
        len.parentElement.style.display = kind.value === 'colour' ? 'none' : 'flex'     // a colour has no length
        note.textContent = kind.value === 'profile' ? 'a closed outline, one point per line: x, y (and a fillet radius), each a number or an expression of this object\'s parameters (w, -w/2); the code calls extrude(name, p, height) or revolve(name, p). Compiled in, or live (its panel): live, a slider on a name changes it with no compile'
            : kind.value === 'path' ? 'an open path, one point per line: x, y, z (and a fillet radius), each a number or an expression of this object\'s parameters (rise, -w/2); the code calls tube(name, p, radius, rounded) or sweep(name, outline, p). Compiled in, or live (its panel): live, a slider on a name moves it with no compile'
            : !num ? 'a vector or colour is always a live uniform'
            : mode.value ? 'in the shader as a const: loops over it unroll; a change recompiles'
            : 'a uniform: dragging it is live, no compile'
    }
    kind.onchange = mode.onchange = sync

    const buttons = document.createElement('div')
    Object.assign(buttons.style, { display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '6px' })
    const btn = (label, primary) => {
        const b = document.createElement('button'); b.textContent = label
        Object.assign(b.style, { font: 'inherit', padding: '3px 10px', cursor: 'pointer', borderRadius: '3px',
            border: '1px solid #555', background: primary ? '#2f6db5' : '#3a3f44', color: '#fff' })
        buttons.appendChild(b); return b
    }
    const cancel = btn('Cancel'), ok = btn('Apply', true)
    box.appendChild(buttons)

    const apply = () => {
        const num = kind.value === 'number'
        const hasRange = num && [rMin, rMax, rStep].some(x => x.value !== '')
        const out = {
            name: name.value.trim(), kind: kind.value, mode: num ? mode.value : '',
            range: hasRange ? { min: +rMin.value, max: +rMax.value, step: +(rStep.value || 0.01) } : null,
            length: kind.value !== 'colour' && len.checked,
        }
        const problem = onApply(out)
        if (problem) err.textContent = String(problem)
        else close()
    }
    ok.onclick = apply
    cancel.onclick = close
    box.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); apply() }
        if (e.key === 'Escape') { e.preventDefault(); close() }
        e.stopPropagation()          // Ctrl+Z inside the dialog is the field's, not the scene's
    })

    document.body.appendChild(box)
    const r = anchor.getBoundingClientRect(), b = box.getBoundingClientRect()
    box.style.left = `${Math.max(4, Math.min(r.left, innerWidth - b.width - 4))}px`
    box.style.top = `${Math.max(4, Math.min(r.bottom + 4, innerHeight - b.height - 4))}px`
    sync()
    name.focus(); name.select()

    // a click elsewhere closes it, as a menu would; one inside does not
    const outside = e => { if (!box.contains(e.target) && e.target !== anchor) close() }
    setTimeout(() => document.addEventListener('mousedown', outside), 0)
    open = { box, outside }
    return box
}

export function close() {
    if (!open) return
    open.box.remove()
    document.removeEventListener('mousedown', open.outside)
    open = null
}
