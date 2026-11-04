//======================================================================================================================
// THE IMPORT DIALOG -- a STEP or STL file on its way in: how far the conversion is, and, when anything did not go
// cleanly, what happened to each part and what to bring in (the user, 2026-11-04: "add a popup that contains the
// progress bar and then posts this as a question"; "when importing and certain surfaces fail, is it possible to import
// the rest anyway?").
//
// TWO STAGES IN ONE BOX. While the worker converts (import/worker.js), the file's name, what it is doing and a bar,
// with Cancel. When it ends:
//   - CLEAN -- every solid converted, every face exact, no point of the self-check disagreeing, nothing to warn of: the
//     dialog closes and the part is pasted, as before it existed (the host decides, `isClean`).
//   - OTHERWISE it stays and asks: each part with what happened to it -- its shapes; how many of the check's points
//     disagree (csg.js step 7: the user's part had 6 of 2965 and nobody was told, and those were its black notches);
//     its faces fitted to a regular shape and how far off (import/freeform.js); or why it was refused, and the deviation
//     it would import at -- with a box per part to leave it out, the deviation allowed and Re-convert, whether
//     approximated faces are red, and Import (what converted, less what was left out) or Cancel.
//
// Plain DOM, as unitdialog.js and paramdialog.js are, for their reason: nothing in a panel that is rebuilt under it.
// Nothing here touches the document or the worker: the host's callbacks do. A click elsewhere is not Cancel here, unlike
// the unit's question: a conversion can take half a minute, and a click on the picture meanwhile is not an answer.
//
//   const D = openImportDialog({ name, onCancel })
//   D.progress({ label, fraction })                 the bar
//   D.ask(result, { maxDeviation, markRed, onImport({ leaveOut: [part id], markRed }), onReconvert({ maxDeviation, markRed }) })
//   D.error(message)                                said in the box, which stays until Close
//   D.close()
//======================================================================================================================

let open = null

/** Whether a conversion went cleanly: nothing refused, nothing approximated, every check point agreeing, no warnings.
 *  `r` is the worker's message (import/progress.js resultMessage). */
export function isClean(r) {
    return !!r?.ok && !!r.asset && !r.refused?.length && !r.warnings?.length
        && r.parts.every(p => !(p.report?.mismatches > 0) && !(p.report?.approximated > 0))
}

/** The lines the dialog says of each part: { id, name, ok, lines: [{ text, tone: 'ok' | 'warn' | 'bad' }] }, the parts
 *  converted first in the file's order, then the refused. Pure: the check holds the words to it. */
export function partLines(r) {
    const out = []
    for (const p of r.parts || []) {
        const R = p.report || {}, lines = []
        lines.push({ tone: 'ok', text: `${R.shapes ?? '?'} shape${R.shapes === 1 ? '' : 's'} in ${R.groups ?? '?'} group${R.groups === 1 ? '' : 's'}`
            + (R.fillets ? `, ${R.fillets} fillet${R.fillets === 1 ? '' : 's'} as round joins` : '') })
        if (R.mismatches > 0) lines.push({ tone: 'warn', text: `${R.mismatches} of ${R.checked} check points disagree with the solid: small errors are possible there (a notch or a bump, near an edge)` })
        if (R.approximated > 0) lines.push({ tone: 'warn', text: `${R.approximated} face${R.approximated === 1 ? '' : 's'} fitted to a regular shape, at most ${fmt(R.deviation)} mm off` })
        if (R.filletsKept > 0) lines.push({ tone: 'warn', text: `${R.filletsKept} fillet${R.filletsKept === 1 ? '' : 's'} not a round join (kept as faces)` })
        out.push({ id: p.id, name: p.name, ok: true, lines })
    }
    for (const x of r.refused || [])
        out.push({ id: null, name: x.name, ok: false, lines: [{ tone: 'bad', text: x.why + (x.needs != null ? ` — it would import at a max deviation of ${fmt(x.needs)} mm` : '') }] })
    return out
}
const fmt = x => Number.isFinite(x) ? +x.toPrecision(2) + '' : '?'

const COLOURS = { ok: '#c8e6c9', warn: '#ffcc80', bad: '#ff8a80' }
const button = (text, primary = false) => {
    const b = document.createElement('button')
    b.type = 'button'; b.textContent = text
    Object.assign(b.style, { font: 'inherit', padding: '3px 10px', cursor: 'pointer', borderRadius: '3px', border: '1px solid #555',
        background: primary ? '#2f5f95' : '#3a3f44', color: '#fff' })
    return b
}
const div = (text, style = {}) => { const e = document.createElement('div'); e.textContent = text; Object.assign(e.style, style); return e }

/**
 * @param name      the file's name, the heading
 * @param onCancel  () => void: the host stops the worker; the dialog is closed already
 */
export function openImportDialog({ name, onCancel = () => { } }) {
    close()
    const box = document.createElement('div')
    box.className = 'import-dialog'
    box.setAttribute('role', 'dialog')
    box.tabIndex = -1
    Object.assign(box.style, {
        position: 'fixed', zIndex: 2000, background: '#2b2f33', color: '#e0e0e0', left: '50%', top: '30%',
        transform: 'translate(-50%, -30%)', border: '1px solid #555', borderRadius: '5px', padding: '10px 12px',
        width: 'min(420px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', boxSizing: 'border-box',
        font: '12px/1.4 Arial, sans-serif', boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
    })
    box.appendChild(div(`Import ${name}`, { fontWeight: 'bold', marginBottom: '6px', overflowWrap: 'anywhere' }))
    const stage = div('starting…', { color: '#aab', marginBottom: '4px', minHeight: '1.4em' })
    stage.dataset.role = 'stage'
    const track = document.createElement('div')
    Object.assign(track.style, { height: '8px', background: '#1d2023', borderRadius: '4px', overflow: 'hidden', marginBottom: '8px' })
    const bar = document.createElement('div')
    bar.dataset.role = 'bar'
    Object.assign(bar.style, { height: '100%', width: '0%', background: '#4f8fd6', transition: 'width 0.1s linear' })
    track.appendChild(bar)
    const body = document.createElement('div')
    const row = document.createElement('div')
    Object.assign(row.style, { display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '8px' })
    const cancel = button('Cancel'); cancel.dataset.role = 'cancel'
    row.appendChild(cancel)
    box.append(stage, track, body, row)

    const dismiss = () => { close(); onCancel() }
    cancel.onclick = dismiss
    box.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); dismiss() }
        e.stopPropagation()          // Ctrl+Z here is not the scene's
    })
    document.body.appendChild(box)
    box.focus()
    open = { box }

    const D = {
        box,
        progress({ label, fraction }) {
            if (open?.box !== box) return
            if (label) stage.textContent = label
            if (Number.isFinite(fraction)) bar.style.width = `${(100 * Math.min(1, Math.max(0, fraction))).toFixed(1)}%`
        },
        error(message) {
            if (open?.box !== box) return
            stage.textContent = 'The import failed.'
            track.style.display = 'none'
            body.replaceChildren(div(message, { color: COLOURS.bad, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }))
            cancel.textContent = 'Close'
            cancel.onclick = () => close()
        },
        ask(r, { maxDeviation = null, markRed = true, onImport, onReconvert = null }) {
            if (open?.box !== box) return
            track.style.display = 'none'
            const lines = partLines(r)
            const converted = lines.filter(p => p.ok)
            stage.textContent = converted.length
                ? (lines.length > converted.length ? `${converted.length} of ${lines.length} parts converted. Import them?` : 'Converted, with something to know first:')
                : 'Nothing in it could be converted.'
            const leaveOut = new Set()
            const items = lines.map(p => {
                const el = document.createElement('div')
                el.dataset.part = p.name
                Object.assign(el.style, { margin: '0 0 6px', padding: '4px 6px', background: '#33383d', borderRadius: '3px' })
                const head = document.createElement('label')
                Object.assign(head.style, { display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'bold' })
                if (p.ok && converted.length > 1) {
                    const cb = document.createElement('input')
                    cb.type = 'checkbox'; cb.checked = true; cb.dataset.role = 'keep'
                    cb.onchange = () => { if (cb.checked) leaveOut.delete(p.id); else leaveOut.add(p.id); go.disabled = leaveOut.size >= converted.length }
                    head.appendChild(cb)
                }
                head.appendChild(document.createTextNode(`${p.ok ? '✓' : '✗'} ${p.name}`))
                el.appendChild(head)
                for (const l of p.lines) el.appendChild(div(l.text, { color: COLOURS[l.tone], marginLeft: '4px', overflowWrap: 'anywhere' }))
                return el
            })
            const extra = []
            if (r.warnings?.length) extra.push(div(r.warnings.map(w => `• ${w}`).join('\n'), { color: COLOURS.warn, whiteSpace: 'pre-wrap', margin: '4px 0' }))
            /* THE DEVIATION ALLOWED, offered when it would change something: a face fitted, or a part refused that would
               import at some deviation (import/freeform.js) */
            const matters = r.parts.some(p => p.report?.approximated > 0) || r.refused.some(x => x.needs != null)
            let red = null
            if (matters && maxDeviation != null) {
                const dev = document.createElement('div')
                Object.assign(dev.style, { display: 'flex', alignItems: 'center', gap: '6px', margin: '6px 0 2px', flexWrap: 'wrap' })
                const input = document.createElement('input')
                input.type = 'number'; input.min = '0'; input.step = 'any'; input.value = String(maxDeviation); input.dataset.role = 'deviation'
                Object.assign(input.style, { width: '70px', font: 'inherit', background: '#1d2023', color: '#fff', border: '1px solid #555' })
                const again = button('Re-convert'); again.dataset.role = 'reconvert'
                again.onclick = () => {
                    const v = Number(input.value)
                    if (!(v >= 0)) { input.style.borderColor = COLOURS.bad; return }
                    onReconvert?.({ maxDeviation: v, markRed: red?.checked ?? markRed })
                }
                dev.append(document.createTextNode('Max surface deviation'), input, document.createTextNode('mm'), again)
                extra.push(dev, div('A face no plane, cylinder, cone, sphere or torus fits exactly is fitted with the closest one, if it is within this; a solid with a face further off is left out.', { color: '#aab', fontSize: '11px' }))
            }
            if (r.parts.some(p => p.report?.approximated > 0)) {
                const l = document.createElement('label')
                Object.assign(l.style, { display: 'flex', alignItems: 'center', gap: '6px', margin: '6px 0 0' })
                red = document.createElement('input')
                red.type = 'checkbox'; red.checked = markRed; red.dataset.role = 'red'
                l.append(red, document.createTextNode('Show the fitted faces in red'))
                extra.push(l)
            }
            body.replaceChildren(...items, ...extra)
            const go = button(lines.length > converted.length || leaveOut.size ? 'Import what converted' : 'Import', true)
            go.dataset.role = 'import'
            go.disabled = !converted.length
            go.onclick = () => { close(); onImport({ leaveOut: [...leaveOut], markRed: red?.checked ?? markRed }) }
            cancel.textContent = 'Cancel'
            cancel.onclick = dismiss
            row.replaceChildren(go, cancel)
            go.focus()
        },
        /** back to the bar: a re-conversion under way */
        restart() {
            if (open?.box !== box) return
            track.style.display = ''
            bar.style.width = '0%'
            stage.textContent = 'converting again…'
            body.replaceChildren()
            row.replaceChildren(cancel)
            cancel.textContent = 'Cancel'
            cancel.onclick = dismiss
        },
        close: () => { if (open?.box === box) close() },
    }
    return D
}

export function close() {
    if (!open) return
    open.box.remove()
    open = null
}
