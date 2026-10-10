//======================================================================================================================
// THE PARAMETERS PANEL -- every entry of the parameter registry (params.js) in one searchable list.
//
//   installParamsPanel(el, PARAMS, { reveal: p => ..., say: text => ... })
//   SHELL.searchIn(paramsSearch(PARAMS, { reveal, say }))      // the palette finds settings too
//
// What the timeline and a future optimiser see, shown to a person: each setting's name and value,
// grouped by what it belongs to. It is NOT the place settings are edited day to day -- the
// properties panel, the Environment and the view's toolbar are, beside what they change (UI_PLAN.md
// section 8). It is where a person compares values across the scene at a glance and types one exactly.
//
// LESS IS MORE (the user, on the first version): a row is a name, a value and its unit. The path, the
// range and "this recompiles" were a line and three columns on every row, for information wanted now
// and then. The range and the recompile note are the row's tooltip; the path -- what a script or a
// timeline calls it -- is copied by right-clicking the row, and nowhere on screen.
//
// Values are edited as typed text, written on Enter or when the field is left, through PARAMS.write:
// the same route as the palette's "name = value", coerced to the entry's range the same way.
//
// ANIMATED ONLY (params.js shown): while any entry is animated, a box in the top bar -- ticked by default -- keeps the
// list to those. Unticked, everything, as before. The timeline's + track follows the same choice.
//
// KEPT CURRENT CHEAPLY: the list is rebuilt only when the entries or the filter change; the values
// are re-read twice a second while the panel is on screen, and never into a field being typed in.
//======================================================================================================================

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
const MAX_ROWS = 400

/**
 * @param host    the panel's element
 * @param P       the registry (makeParams)
 * @param reveal  p => void: show the control that edits it (the ⌖ on each row), optional
 * @param say     text => void: a status line (a refused value says why), optional
 */
export function installParamsPanel(host, P, { reveal = null, say = () => { } } = {}) {
    const root = el('div', 'shell-params')
    const top = el('div', 'shell-params-top')
    const q = el('input')
    q.type = 'search'
    q.placeholder = 'Filter…'
    top.append(q)
    // the animated-only box: shown only while there is something animated to keep the list to
    const only = el('label', 'shell-params-only')
    const onlyBox = el('input')
    onlyBox.type = 'checkbox'
    only.append(onlyBox, el('span', '', ' animated only'))
    only.title = 'Only the values flagged as animated (◆ beside a value in the properties panel). The timeline\'s + track follows this too.'
    onlyBox.onchange = () => { P.setOnlyAnimated?.(onlyBox.checked); tick() }
    top.append(only)
    const list = el('div', 'shell-params-list')
    root.append(top, list)
    host.appendChild(root)

    let shown = []                  // [{ p, fields: [input|select], value: span }]
    let signature = ''

    const valueOf = p => { try { return p.get() } catch { return undefined } }
    const text = (p, v) => {
        if (p.options) return v
        const one = x => typeof x === 'number' ? +x.toPrecision(6) + '' : String(x ?? '')
        return Array.isArray(v) ? v.map(one).join(', ') : one(v)
    }
    const write = (p, raw) => {
        try { P.write(p.path, P.parse(p, raw), { source: 'parameters' }) }
        catch (e) { say(e.message); console.warn('[params]', e.message) }
        update()
    }

    const row = p => {
        const r = el('div', 'shell-param')
        const range = p.min != null && p.max != null && !p.options ? `${+(+p.min).toPrecision(4)} … ${+(+p.max).toPrecision(4)}` : null
        r.title = [p.help, range, p.kind === 'structural' ? 'changing it recompiles the shader' : null, 'right-click: copy its name for a script']
            .filter(Boolean).join('\n')
        r.oncontextmenu = e => {
            e.preventDefault()
            navigator.clipboard?.writeText(p.path).then(() => say(`copied ${p.path}`), () => say(p.path))
        }
        // under its group's heading, the label's last part says enough ("Show › Bands" is "Bands" under Show)
        const lab = el('span', 'shell-param-label', String(p.label ?? p.path).split(' › ').pop())
        let field
        if (p.options) {
            field = el('select')
            for (const [k, v] of Object.entries(p.options)) { const o = el('option', '', k); o.value = String(v); field.appendChild(o) }
            field.onchange = () => write(p, field.value)
        } else {
            field = el('input')
            field.spellcheck = false
            field.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); field.blur() } if (e.key === 'Escape') { field.dataset.cancel = '1'; field.blur() } }
            field.onblur = () => {
                if (field.dataset.cancel) { delete field.dataset.cancel; update(); return }
                if (field.value !== field.dataset.was) write(p, field.value)        // leaving a field is not an edit
            }
        }
        field.className = 'shell-param-value'
        r.append(lab, field, el('span', 'shell-param-unit', p.unit ?? ''))
        if (reveal || p.reveal) {
            const b = el('button', 'shell-param-go', '⌖')
            b.title = 'Show where this is set'
            b.onclick = () => { try { (p.reveal || (() => reveal(p)))() } catch (e) { say(e.message) } }
            r.appendChild(b)
        }
        return { p, field, r }
    }

    const build = () => {
        const every = P.list(), any = every.some(p => p.animated), keep = any && !!P.onlyAnimated?.(any)
        only.style.display = any ? '' : 'none'
        onlyBox.checked = keep
        const found = q.value.trim() ? P.find(q.value, MAX_ROWS) : every
        const all = (keep ? found.filter(p => p.animated) : found).slice(0, MAX_ROWS)
        const sig = `${keep}\n${q.value}\n${all.map(p => p.path).join('\n')}`
        if (sig === signature) return false
        signature = sig
        list.innerHTML = ''
        shown = []
        // headed by what the settings belong to, in words: the label's first part ("Lens" of "Lens › radius")
        const heading = p => String(p.label ?? '').includes(' › ') ? p.label.split(' › ')[0] : (p.group ?? '')
        let group = null
        for (const p of all) {
            if (heading(p) !== group) { group = heading(p); list.appendChild(el('div', 'shell-params-group', group)) }
            const x = row(p)
            shown.push(x)
            list.appendChild(x.r)
        }
        return true
    }
    const update = () => {
        for (const x of shown) {
            if (document.activeElement === x.field) continue            // never under the typist's cursor
            // the entry itself may be gone (a node deleted): the next build drops the row
            const t = String(text(x.p, valueOf(x.p)))
            if (x.field.value !== t) x.field.value = t
            x.field.dataset.was = t
        }
    }
    const tick = () => { build(); update() }
    q.oninput = tick
    // re-read while seen: values move from everywhere (a slider, the timeline, undo, a file opened)
    const timer = setInterval(() => { if (root.isConnected && root.offsetParent !== null) tick() }, 500)
    tick()
    return { refresh: tick, dispose: () => { clearInterval(timer); root.remove() } }
}

/**
 * THE PALETTE'S SOURCE OF SETTINGS (shell.searchIn): a name finds where a setting is set and shows its
 * value; "name = value" sets it, through PARAMS.write like everything else -- coerced to its range, an
 * undo step where the entry keeps them. A value it cannot take is refused with the reason, in the status.
 */
export function paramsSearch(P, { reveal = () => { }, say = () => { } } = {}) {
    return q => {
        const m = /^(.+?)\s*=\s*(.*)$/.exec(q)
        const words = (m ? m[1] : q).trim()
        if (words.length < 2) return []           // one letter matches everything: the commands first
        const value = m ? m[2].trim() : ''
        return P.find(words, 8).map(p => value ? {
            label: `Set ${p.label} to ${value}`,
            run: () => say(`${p.label} = ${P.format(p, P.write(p.path, P.parse(p, value), { source: 'palette' }))}`),
        } : { label: p.label, where: P.format(p), run: () => reveal(p) })
    }
}
