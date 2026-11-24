//======================================================================================================================
// HELP > ADD-INS...: what the page loaded (lib/addins/loader.js), how each went, and the user's own list -- a URL put
// in, one taken out. A change to the list is for the next load: a module cannot be unloaded from a page.
//======================================================================================================================

const STATE_WORDS = {
    waiting: 'not loaded', refused: 'refused', failed: 'failed', registered: 'registered, not started', started: 'started',
}
const FROM_WORDS = { manifest: 'addins.json', address: 'the address', yours: 'your list' }

const CSS = `
.addins { padding: 12px 14px; font: 13px/1.45 var(--sh-sans); color: var(--sh-ink); }
.addins h3 { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--sh-muted); font-weight: 600; margin: 14px 0 6px; }
.addins h3:first-child { margin-top: 0; }
.addins .note { color: var(--sh-muted); margin: 4px 0 8px; }
.addins .row { border-top: 1px solid var(--sh-line); padding: 6px 0; display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; }
.addins .name { font-weight: 600; }
.addins .url { font: 11px var(--sh-mono); color: var(--sh-muted); word-break: break-all; grid-column: 1 / -1; }
.addins .err { color: var(--sh-warn); grid-column: 1 / -1; }
.addins .state-started { color: var(--sh-accent); }
.addins .state-failed, .addins .state-refused { color: var(--sh-warn); }
.addins form { display: flex; gap: 6px; margin-top: 6px; }
.addins input { flex: 1; min-width: 0; font: 12px var(--sh-mono); }
`

/** The panel in `host`: show() redraws it from `ADDINS` (loader.js createAddins). `reload` reloads the page. */
export function installAddinsPanel(host, ADDINS, { reload = () => location.reload(), say = () => { } } = {}) {
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
    if (!document.getElementById('addins-css')) { const s = el('style'); s.id = 'addins-css'; s.textContent = CSS; document.head.appendChild(s) }
    const root = el('div', 'addins')
    host.appendChild(root)

    const show = () => {
        root.innerHTML = ''
        root.append(el('h3', null, 'Loaded'))
        const loaded = ADDINS.list()
        if (ADDINS.safe) root.append(el('p', 'note', 'A safe start: no add-in was loaded. Reload without ?safe to load them.'))
        else if (!loaded.length) root.append(el('p', 'note', 'None. An add-in is a module from outside this page\'s repository: see docs/ADDINS.md.'))
        for (const a of loaded) {
            const r = el('div', 'row')
            r.append(el('span', 'name', `${a.name ?? a.id ?? 'an add-in'}${a.version ? ' ' + a.version : ''}`),
                el('span', `state-${a.state}`, STATE_WORDS[a.state] ?? a.state),
                el('span', 'url', `${a.url} · from ${FROM_WORDS[a.from] ?? a.from}`))
            if (a.error) r.append(el('span', 'err', a.error))
            root.append(r)
        }

        root.append(el('h3', null, 'Your list'))
        root.append(el('p', 'note', 'Loaded at every start in this browser. An add-in runs as this page does, with your projects: add only code you trust. A change takes effect at the next load.'))
        for (const url of ADDINS.yours()) {
            const r = el('div', 'row')
            const b = el('button', null, 'Remove')
            b.onclick = () => { ADDINS.remove(url); show(); say(`removed from your add-ins: ${url} (reload to unload it)`) }
            r.append(el('span', 'url', url), b)
            root.append(r)
        }
        const f = el('form')
        const input = el('input')
        input.placeholder = 'http://localhost:8000/addins/example/index.js'
        const add = el('button', null, 'Add')
        add.type = 'submit'
        f.append(input, add)
        f.onsubmit = e => {
            e.preventDefault()
            try { ADDINS.add(input.value.trim()); input.value = ''; show(); say('added to your add-ins: reload to load it') }
            catch (err) { say(`add-in: ${err.message}`) }
        }
        const again = el('button', null, 'Reload the page')
        again.onclick = () => reload()
        root.append(f, again)
    }
    show()
    return { show }
}
