//======================================================================================================================
// ONE QUESTION OVER THE PAGE, with a few answers -- what Import from file… asks of a project file: a project of its own,
// or its scenes added to this one (app.html; UI_PLAN.md section 11). A card over the page in the Projects list's
// look (shell.css .shell-proj): a title, a line, a button per answer with what it does under it, and Cancel.
// Escape, or a click beside the card, is Cancel.
//
//   const v = await ask({ title: 'desk-lamp.json holds 3 scenes', text: '…',
//                         choices: [{ value: 'new', label: 'Open as a project of its own', note: '…' }, …] })
//   v           the chosen value, or null
//======================================================================================================================

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }

export function ask({ title, text = '', choices = [], cancel = 'Cancel' }) {
    return new Promise(resolve => {
        const root = el('div', 'shell-proj shell-ask')
        const card = el('div', 'shell-proj-box')
        const top = el('div', 'shell-proj-top'); top.appendChild(el('div', 'shell-proj-title', title))
        const body = el('div', 'shell-ask-body', text)
        const list = el('div', 'shell-ask-choices')
        const done = v => { window.removeEventListener('keydown', esc, true); root.remove(); resolve(v) }
        const esc = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null) } }
        for (const c of choices) {
            const b = el('button', 'shell-ask-choice'); b.type = 'button'
            b.append(el('span', 'shell-ask-label', c.label))
            if (c.note) b.append(el('span', 'shell-ask-note', c.note))
            b.onclick = () => done(c.value)
            list.appendChild(b)
        }
        const foot = el('div', 'shell-proj-foot')
        const no = el('button', 'shell-proj-btn', cancel); no.type = 'button'; no.onclick = () => done(null)
        foot.append(el('span'), no)
        card.append(top, body, list, foot)
        root.appendChild(card)
        root.onmousedown = e => { if (e.target === root) done(null) }
        document.body.appendChild(root)
        window.addEventListener('keydown', esc, true)
        list.querySelector('button')?.focus()
    })
}
