//======================================================================================================================
// THE PROJECTS LIST (File › Projects…) -- every project kept in this browser: open one, start a new one, rename,
// duplicate, download as a workspace file, delete, import a file as a project. UI_PLAN.md section 10.
//
// A DIALOG OVER THE PAGE, not a panel: it is occasional, like opening a file, and nothing else is done while it
// is up. Each row says how many scenes and which, when it last changed, and whether it is the one open here
// or one another tab has (tabs.js) -- that one opens here as a copy, as a second tab's does (session.js).
//
// DELETING ASKS, in the row: it is the one thing here no undo brings back (the project's undo history is the
// project's, and this removes the project). The project open here, and one another tab has, cannot be deleted.
//
// WHERE THEY LIVE is said at the foot: the browser's storage, which "clear site data" empties and a browser
// short of disk may clear on its own unless asked to keep it (navigator.storage.persist).
//
//   const D = installProjectsDialog({ session, say, download, pickFile, app })
//   D.show()
//======================================================================================================================
import { icon } from '../lib/pathtracer/icons.js'

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", else the date. */
export function ago(t, now = Date.now()) {
    const s = Math.max(0, (now - t) / 1000)
    if (s < 45) return 'just now'
    if (s < 3600) return `${Math.round(s / 60)} min ago`
    if (s < 86400) return `${Math.round(s / 3600)} h ago`
    if (s < 172800) return 'yesterday'
    if (s < 86400 * 14) return `${Math.round(s / 86400)} days ago`
    return new Date(t).toLocaleDateString()
}

/**
 * @param session   workspace/session.js's: list, open, create, rename, duplicate, remove, exportText, importText
 * @param download  (filename, text) => void
 * @param pickFile  async () => { name, text } | null: a file the user chooses
 * @param app       () => the application's stamp for a file written (version.js stamp)
 */
export function installProjectsDialog({ session, say = () => { }, download, pickFile, app = () => null }) {
    let root = null, asking = null, renaming = null
    const close = () => { root?.remove(); root = null; asking = renaming = null; window.removeEventListener('keydown', esc, true) }
    const esc = e => { if (e.key === 'Escape' && root) { e.preventDefault(); e.stopPropagation(); if (renaming || asking) { renaming = asking = null; draw() } else close() } }
    const button = (text, title, run, cls = '') => {
        const b = el('button', `shell-proj-btn${cls ? ' ' + cls : ''}`, text)
        b.type = 'button'; b.title = title
        b.onclick = async e => {
            e.stopPropagation()
            try { await run() } catch (err) {
                console.error('[projects]', err)
                say(err.problems ? `${err.problems[0]}${err.problems.length > 1 ? ` (+${err.problems.length - 1} more, see console)` : ''}` : err.message)
            }
        }
        return b
    }
    const fileName = name => `${String(name || 'project').replace(/[^\w.-]+/g, '_')}.json`

    const draw = async () => {
        if (!root) return
        const box = root.querySelector('.shell-proj-list')
        let list
        try { list = await session.list() } catch (e) { box.replaceChildren(el('div', 'shell-proj-empty', `cannot read the projects: ${e.message}`)); return }
        box.replaceChildren()
        if (!list.length) box.appendChild(el('div', 'shell-proj-empty', 'No project kept yet.'))
        for (const m of list) {
            const r = el('div', `shell-proj-row${m.here ? ' here' : ''}`)
            r.dataset.id = m.id
            const main = el('div', 'shell-proj-main')
            if (renaming === m.id) {
                const input = el('input', 'shell-proj-rename')
                input.value = m.name
                const done = async ok => {
                    if (renaming !== m.id) return
                    renaming = null
                    if (ok && input.value.trim() && input.value.trim() !== m.name) {
                        try { await session.rename(m.id, input.value.trim()) } catch (e) { say(e.message) }
                    }
                    draw()
                }
                input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); done(true) } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false) } }
                input.onblur = () => done(true)
                main.appendChild(input)
                requestAnimationFrame(() => { input.focus(); input.select() })
            } else {
                const name = el('div', 'shell-proj-name', m.name)
                if (m.here) name.appendChild(el('span', 'shell-proj-badge', 'open here'))
                if (m.elsewhere) name.appendChild(el('span', 'shell-proj-badge other', 'open in another tab'))
                main.appendChild(name)
            }
            const titles = (m.titles || []).slice(0, 6).join(', ') + ((m.titles || []).length > 6 ? ', …' : '')
            main.appendChild(el('div', 'shell-proj-sub', `${m.scenes} scene${m.scenes === 1 ? '' : 's'}${titles ? ': ' + titles : ''} · changed ${ago(m.modified)}`))
            r.appendChild(main)
            const acts = el('div', 'shell-proj-acts')
            if (asking === m.id) {
                acts.append(el('span', 'shell-proj-q', 'Delete it from this browser? No undo.'),
                    button('Delete', `Delete '${m.name}'`, async () => { asking = null; await session.remove(m.id); say(`deleted ${m.name}`); draw() }, 'danger'),
                    button('Keep', 'Keep it', () => { asking = null; draw() }))
            } else {
                const open = button('Open', m.here ? 'It is the one open here'
                    : m.elsewhere ? 'Open a copy here: another tab has it, and keeps saving it' : 'Work on it here', async () => {
                    if (m.here) return close()
                    close()
                    await session.open(m.id)
                }, 'main')
                if (m.here) open.disabled = true
                const iconBtn = (name, title, run) => { const b = button('', title, run, 'icon'); b.appendChild(icon(name, 15)); return b }
                acts.append(open,
                    iconBtn('edit', 'Rename', () => { renaming = m.id; draw() }),
                    iconBtn('duplicate', 'Duplicate: a copy kept beside it', async () => { const c = await session.duplicate(m.id); say(`kept a copy: ${c.name}`); draw() }),
                    iconBtn('download', 'Download as a workspace file (File › Open reads it back as a project)', async () => {
                        download(fileName(m.name), await session.exportText(m.id, { app: app() }))
                    }))
                const del = iconBtn('clear', m.here ? 'It is the one open here: open another to delete it'
                    : m.elsewhere ? 'Another tab has it open: close it there to delete it' : 'Delete it (asks first)', () => { asking = m.id; draw() })
                if (m.here || m.elsewhere) del.disabled = true
                acts.append(del)
            }
            r.appendChild(acts)
            r.ondblclick = async () => { if (!m.here && renaming !== m.id && asking !== m.id) { close(); try { await session.open(m.id) } catch (e) { say(e.message) } } }
            box.appendChild(r)
        }
    }
    const foot = async el2 => {
        const st = globalThis.navigator?.storage
        let kept = null
        try { kept = await st?.persisted?.() } catch { }
        el2.replaceChildren(el('span', null, kept
            ? 'Kept in this browser until its site data is cleared. Download keeps a file.'
            : 'Kept in this browser\'s storage, which clearing site data empties -- and which the browser may clear on its own when the disk runs low. Download keeps a file.'))
        if (kept === false && st?.persist) el2.appendChild(button('Ask the browser to keep them', 'navigator.storage.persist(): the browser decides, and may ask', async () => {
            const ok = await st.persist()
            say(ok ? 'the browser will keep the projects until its site data is cleared' : 'the browser did not agree to keep them for good')
            foot(el2)
        }))
    }

    const show = () => {
        if (root) return draw()
        root = el('div', 'shell-proj')
        const card = el('div', 'shell-proj-box')
        const top = el('div', 'shell-proj-top')
        top.append(el('div', 'shell-proj-title', 'Projects'),
            button('+ New project', 'A new project of one empty scene, opened here', async () => { close(); await session.create() }),
            button('Import a file…', 'A workspace or project file, kept as a project and opened here', async () => {
                const f = await pickFile()
                if (!f) return
                close()
                await session.importText(f.text, f.name.replace(/\.json$/i, ''))
            }),
            button('', 'Close (Escape)', close, 'icon close'))
        top.lastChild.appendChild(icon('close', 15))
        const list = el('div', 'shell-proj-list')
        const footer = el('div', 'shell-proj-foot')
        card.append(top, list, footer)
        root.appendChild(card)
        root.onmousedown = e => { if (e.target === root) close() }
        document.body.appendChild(root)
        window.addEventListener('keydown', esc, true)
        draw()
        foot(footer)
    }
    return { show, close, get isOpen() { return !!root }, refresh: draw }
}
