//======================================================================================================================
// THE UNIT QUESTION -- what a change of the scene's unit should do, asked when the scene row's `unit` is changed (the
// user, 2026-10-19: "give the user a choice when switching the scene's units"). Three answers, unitchange.js's ways:
// keep the real size by scaling the objects, keep it by converting their dimensions, or keep the numbers. Each says what
// it does to this scene's numbers and to the camera; converting the dimensions says first, from a trial on a copy, what
// it cannot convert (own code, an expression adding a plain number, a binding that does), so it is chosen knowing.
//
// A small popup of plain DOM beside the row, as paramdialog.js is, and for its reason: the panel is rebuilt after the
// change, and a form inside it would be torn down under the user. Nothing here touches the document: `onChoose(how)`
// does, and returns an error to show (the dialog stays open) or nothing (it closes).
//======================================================================================================================

import { changeUnit, unitFactor } from './unitchange.js'

let open = null
const SHOWN = 6                // the things a trial could not convert, listed; the rest counted

/* the factor as a person says it: x10, /1000 */
const factorText = k => k >= 1 ? `×${+k.toPrecision(6)}` : `÷${+(1 / k).toPrecision(6)}`

/**
 * @param anchor    the element to open beside (the unit row)
 * @param doc       the scene's document, as it is -- read, and tried on a copy, never changed
 * @param to        the unit chosen
 * @param onChoose  (how) => string | void: an error to show, or nothing to close
 * @param onCancel  () => void: the row goes back to the unit the scene has
 */
export function openUnitDialog(anchor, { doc, to, onChoose, onCancel = () => { } }) {
    close()
    const from = doc.unit ?? 'm', k = unitFactor(from, to), f = factorText(k)
    const empty = !(doc.root?.children?.length)
    const box = document.createElement('div')
    box.className = 'unit-dialog'
    box.setAttribute('role', 'dialog')
    Object.assign(box.style, {
        position: 'fixed', zIndex: 2000, background: '#2b2f33', color: '#e0e0e0',
        border: '1px solid #555', borderRadius: '5px', padding: '8px 10px', width: '320px',
        font: '12px/1.4 Arial, sans-serif', boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
    })
    const div = (text, style = {}) => { const e = document.createElement('div'); e.textContent = text; Object.assign(e.style, style); return e }
    box.appendChild(div(`Unit: ${from} → ${to}`, { fontWeight: 'bold', marginBottom: '2px' }))
    box.appendChild(div(empty ? 'No objects yet: the first two keep the camera and the world where they are, in real size.'
        : `What happens to this scene's numbers? 1 ${from} is ${+k.toPrecision(6)} ${to}.`, { color: '#aab', marginBottom: '6px' }))

    /* WHAT CONVERTING THE DIMENSIONS CANNOT, tried on a copy: said under its button, before it is chosen */
    let trial = null
    try { trial = changeUnit(structuredClone(doc), to, 'dimensions') } catch (e) { trial = { error: e.message || String(e) } }
    const caveat = trial?.error ? `It cannot: ${trial.error}`
        : trial?.skipped?.length ? ['Not converted, left as they are:',
            ...trial.skipped.slice(0, SHOWN).map(s => `• ${s.label}: ${s.what}`),
            ...(trial.skipped.length > SHOWN ? [`… and ${trial.skipped.length - SHOWN} more`] : [])].join('\n')
        : null

    const err = div('', { color: '#ff8a80', whiteSpace: 'pre-wrap', margin: '4px 0 0' })
    const choices = [
        { how: 'scale', title: 'Scale the objects (real size kept)',
          says: `Each object at the top of the tree: its position and scale ${f}; its own numbers stay. Exact for any code. The camera, the scene's radius and tolerance are converted too.` },
        { how: 'dimensions', title: 'Convert the dimensions (real size kept)',
          says: `Every position and every length ${f}, scales as they are: a box of 1 ${from} reads ${+k.toPrecision(6)} ${to}. The camera, the radius and the tolerance are converted too.`,
          caveat, disabled: !!trial?.error },
        { how: 'keep', title: `Keep the numbers (the scene ${k > 1 ? `${+k.toPrecision(6)}× smaller` : `${+(1 / k).toPrecision(6)}× bigger`})`,
          says: `1 ${from} becomes 1 ${to}, the camera and the world with it, so the picture looks the same. For numbers that were meant in ${to} all along.` },
    ]
    const buttons = []
    for (const c of choices) {
        const b = document.createElement('button')
        b.type = 'button'
        b.dataset.how = c.how
        b.disabled = !!c.disabled
        Object.assign(b.style, { display: 'block', width: '100%', textAlign: 'left', font: 'inherit', margin: '0 0 6px',
            padding: '5px 8px', cursor: c.disabled ? 'default' : 'pointer', borderRadius: '3px', border: '1px solid #555',
            background: c.how === 'scale' ? '#2f5f95' : '#3a3f44', color: '#fff', opacity: c.disabled ? '0.5' : '' })
        b.append(div(c.title, { fontWeight: 'bold' }), div(c.says, { color: '#d0d4d8' }))
        if (c.caveat) b.appendChild(div(c.caveat, { color: '#ffcc80', whiteSpace: 'pre-wrap', marginTop: '3px' }))
        b.onclick = () => choose(c.how)
        box.appendChild(b); buttons.push(b)
    }
    const row = document.createElement('div')
    Object.assign(row.style, { display: 'flex', justifyContent: 'flex-end' })
    const cancel = document.createElement('button')
    cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.dataset.how = 'cancel'
    Object.assign(cancel.style, { font: 'inherit', padding: '3px 10px', cursor: 'pointer', borderRadius: '3px',
        border: '1px solid #555', background: '#3a3f44', color: '#fff' })
    cancel.onclick = () => dismiss()
    row.appendChild(cancel)
    box.append(err, row)

    const choose = how => {
        const problem = onChoose(how)
        if (problem) err.textContent = String(problem)
        else close()
    }
    const dismiss = () => { close(); onCancel() }
    box.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); dismiss() }
        e.stopPropagation()          // Ctrl+Z here is not the scene's
    })

    document.body.appendChild(box)
    const r = anchor?.getBoundingClientRect?.() ?? { left: 40, bottom: 40 }, bb = box.getBoundingClientRect()
    box.style.left = `${Math.max(4, Math.min(r.left, innerWidth - bb.width - 4))}px`
    box.style.top = `${Math.max(4, Math.min(r.bottom + 4, innerHeight - bb.height - 4))}px`
    buttons[0].focus()

    // a click elsewhere is no answer: the unit stays, as Cancel
    const outside = e => { if (!box.contains(e.target)) dismiss() }
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
