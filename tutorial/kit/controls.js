//======================================================================================================================
// A FIGURE'S CONTROLS, from its spec (figure.js):
//
//   { type: 'slider', key, label, min, max, step, unit, fmt(v) }   a range; fmt for the number shown beside it
//   { type: 'toggle', key, label }                                   a button that flips a boolean
//   { type: 'seg', key, options: [[value, label], ...] }             one of a few
//   { type: 'button', label, act(state) }                            does something once (reset, add samples)
//   ...any of them with when(state) -> bool                         shown only while it is true (a blend's radius
//                                                                     only when the shapes are blended)
//
// Each changes `state` and calls back with the key; sync() puts the controls back in line with the state after a
// scroll step changed it. Ids are stable (figure name + key) so a reload keeps what a browser restores.
//======================================================================================================================

export function buildControls(doc, specs, state, onChange, fig = 'fig') {
    if (!specs.length) return null
    const el = doc.createElement('div'); el.className = 'fig-controls'
    const syncs = [], nodes = []          // nodes: each control's elements, in the spec's order (for `when`)
    for (const c of specs) {
        const id = `${fig}-${c.key ?? c.label}`.replace(/[^\w-]/g, '-')
        if (c.type === 'slider') {
            const label = doc.createElement('label'), input = doc.createElement('input'), out = doc.createElement('output')
            Object.assign(input, { type: 'range', id, min: c.min, max: c.max, step: c.step ?? (c.max - c.min) / 100 })
            const show = () => { out.textContent = c.fmt ? c.fmt(state[c.key]) : `${+(+state[c.key]).toFixed(3)}${c.unit ?? ''}` }
            input.addEventListener('input', () => { state[c.key] = +input.value; show(); onChange(c.key) })
            label.append(c.label + ' ', input, out)
            el.appendChild(label); nodes.push([label])
            syncs.push(() => { input.value = state[c.key]; show() })
        } else if (c.type === 'toggle') {
            const b = doc.createElement('button'); b.type = 'button'; b.className = 'kbtn'; b.id = id; b.textContent = c.label
            b.addEventListener('click', () => { state[c.key] = !state[c.key]; onChange(c.key); sync() })
            el.appendChild(b); nodes.push([b])
            syncs.push(() => b.setAttribute('aria-pressed', state[c.key] ? 'true' : 'false'))
        } else if (c.type === 'seg') {
            const g = doc.createElement('div'); g.className = 'seg'; g.setAttribute('role', 'group'); if (c.label) g.setAttribute('aria-label', c.label)
            const bs = c.options.map(([v, l]) => {
                const b = doc.createElement('button'); b.type = 'button'; b.textContent = l; b.id = `${id}-${v}`
                b.addEventListener('click', () => { state[c.key] = v; onChange(c.key); sync() })
                g.appendChild(b); return [v, b]
            })
            const l = c.label ? doc.createElement('span') : null
            if (l) { l.textContent = c.label; el.append(l) }
            el.appendChild(g); nodes.push(l ? [l, g] : [g])
            syncs.push(() => bs.forEach(([v, b]) => b.setAttribute('aria-pressed', state[c.key] === v ? 'true' : 'false')))
        } else if (c.type === 'button') {
            const b = doc.createElement('button'); b.type = 'button'; b.className = 'kbtn'; b.id = id; b.textContent = c.label
            b.addEventListener('click', () => { c.act(state); onChange(c.key ?? c.label) })
            el.appendChild(b); nodes.push([b])
        }
    }
    // `when`: each control's element, shown only while its condition holds
    const shown = specs.map((c, i) => [c.when, nodes[i]]).filter(([w]) => w)
    const sync = () => { syncs.forEach(f => f()); for (const [w, ns] of shown) for (const n of ns) n.hidden = !w(state) }
    sync()
    return { el, sync }
}
