//======================================================================================================================
// THE PROJECT PANEL -- the projects kept in this browser, this one's scenes large with their pictures, and the examples
// (0.63.0; UI_PLAN.md section 11). It replaces the Projects list over the page (workspace/dialog.js, 0.7.0-0.62) and
// File › Examples ▸.
//
// A DOCK PANEL OF ITS OWN (the user, 2026-10-17: "project view is a dockable panel of its own. if it isnt open, open it
// in the same pane as the viewport, as these will rarely have to be viewed side by side"): the host opens it as a tab
// beside the picture, and brings the picture back (showWork) once a scene or an example is chosen.
//
// ANOTHER PROJECT OPENED HERE STAYS HERE (the user, 2026-10-29: "when switching projects, it immediately switches to
// viewport. I'd rather stay in the project view and be able to chose which scene to open"): its scenes become this
// panel's cards and nothing compiles until one is chosen -- a compile of seconds for the scene it was last left on, which
// may not be the one wanted. Until then the picture is the last project's, shown as nobody's (demo.js replace); the
// host compiles the chosen one (`compile`), and the scene worked on if the picture is brought back without a choice.
//
//   PROJECTS     the column at its side: each with its scenes and when it changed, the one open here and one another
//                tab has marked. A click opens one (what this tab has is saved first) and shows its scenes, compiling
//                none; ⋯ renames, duplicates,
//                downloads as a file, deletes -- deleting asks, in the row: it is the one thing here no undo brings
//                back. The project open here and one another tab has cannot be deleted. + New project, Import from
//                file…, and where they live (the browser's storage, which clearing site data empties).
//   THIS PROJECT its name (renamed in place), Export project file…, and a card per scene: its picture, what is in it,
//                how long it took to open. A click opens it (a compile) and goes back to the picture; ⋯ as on the cards
//                over the tree (scenestrip.js sceneMenuItems); dragged, they reorder; + New scene.
//   EXAMPLES     by audience and group (filemenu.js exampleGroups), each with what it shows: a copy goes into this
//                project and is opened. An example is never edited, so opening one twice gives two.
// While a library item is edited (library/edit.js) nothing here opens or adds: it stays isolated until saved or closed.
//
// FOLLOWS BY LOOKING while it is shown (visible(true)), as the cards over the tree do: this project's scenes, the
// pictures, the list of projects (read again every few seconds: another tab may have changed it).
//
//   const V = installProjectView(element, { session, BUILDER, ops, picture, examples, importFile, exportProject, exportScene,
//                                           download, app, showWork, compile, item, onRemoved, say })
//   V.visible(true | false)   V.at('examples')   V.refresh()
//======================================================================================================================
import { popupMenu } from '../lib/shell/menu.js'
import { sceneCards, sceneMenuItems, seconds } from '../builder/scenestrip.js'
import { exampleGroups } from '../builder/filemenu.js'

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
const MIME = 'application/x-shady-scene'

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
/** A project's name as a file's: what is not a word character, a dot or a dash becomes `_`. */
export const fileName = name => `${String(name || 'project').replace(/[^\w.-]+/g, '_')}.json`

/**
 * @param host          the panel's element
 * @param session       workspace/session.js's: info, list, open, create, rename, duplicate, remove, exportText
 * @param BUILDER       demo.js's: project, current, revision, projectModel
 * @param ops           tree.js's sceneOps: enter, add, duplicate, remove, move
 * @param picture       key => { url, openMs } | null (workspace/scenepics.js, for this project)
 * @param examples      { list: [{ id, title, audience, group, description }], open: id => Promise }, or null
 * @param importFile    () => void: File › Import from file… (the host reads, asks and routes)
 * @param exportProject () => void: this project as a file
 * @param exportScene   key => void: a scene as a file
 * @param download      (filename, text) => void
 * @param app           () => the application's stamp for a file written
 * @param showWork      () => void: the picture brought forward again
 * @param compile       key => Promise | null: scene `key` made the one worked on and compiled -- the host's, which after a
 *                      project opened here also puts the empty scene in if it does not compile (app.html openChosen)
 * @param item          () => bool: a library item is being edited
 * @param onRemoved     id => void: a project deleted (its pictures go too)
 * @param say           a status line
 */
export function installProjectView(host, { session, BUILDER, ops, picture = () => null, examples = null, importFile = () => { },
                                           exportProject = () => { }, exportScene = () => { }, download = () => { }, app = () => null,
                                           showWork = () => { }, compile = key => ops.enter(key), item = () => false, onRemoved = () => { }, say = () => { } }) {
    const P = BUILDER.projectModel
    host.classList.add('shell-pv')
    const side = el('div', 'shell-pv-side'), main = el('div', 'shell-pv-main')
    host.append(side, main)
    const blocked = () => { if (!item()) return false; say('close the library item first (Save or Close, over the view)'); return true }
    const guard = fn => async (...a) => {
        try { await fn(...a) } catch (err) {
            console.error('[projects]', err)
            say(err.problems ? `${err.problems[0]}${err.problems.length > 1 ? ` (+${err.problems.length - 1} more, see console)` : ''}` : err.message)
        }
    }
    const button = (text, title, run, cls = '') => {
        const b = el('button', `shell-proj-btn${cls ? ' ' + cls : ''}`, text); b.type = 'button'; b.title = title
        b.onclick = e => { e.stopPropagation(); guard(run)() }
        return b
    }

    // ---- THE PROJECTS, at the side
    const plist = el('div', 'shell-proj-list shell-pv-projects')
    const pfoot = el('div', 'shell-pv-foot')
    const where = el('div', 'shell-pv-where')
    side.append(el('div', 'shell-pv-h', 'Projects in this browser'), plist, pfoot)
    pfoot.append(
        button('+ New project', 'A new project of one empty scene, opened here; this one stays in the list', async () => {
            if (blocked()) return
            await session.create(); showWork()
        }),
        button('Import from file…', 'A .json file from disk: a project file opens as a project of its own (or adds its scenes here), a scene file joins this project', () => {
            if (!blocked()) importFile()
        }),
        where)
    let renaming = null, asking = null, projects = []
    const drawProjects = async () => {
        try { projects = await session.list() } catch (e) { plist.replaceChildren(el('div', 'shell-proj-empty', `cannot read the projects: ${e.message}`)); return }
        plist.replaceChildren()
        if (!projects.length) plist.appendChild(el('div', 'shell-proj-empty', 'No project kept yet.'))
        for (const m of projects) {
            const r = el('div', `shell-proj-row${m.here ? ' here' : ''}`)
            r.dataset.id = m.id
            const box = el('div', 'shell-proj-main')
            if (renaming === m.id) {
                const input = el('input', 'shell-proj-rename')
                input.value = m.name
                const done = async ok => {
                    if (renaming !== m.id) return
                    renaming = null
                    if (ok && input.value.trim() && input.value.trim() !== m.name) await guard(() => session.rename(m.id, input.value.trim()))()
                    drawProjects(); drawTop()
                }
                input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); done(true) } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false) } }
                input.onblur = () => done(true)
                box.appendChild(input)
                requestAnimationFrame(() => { input.focus(); input.select() })
            } else {
                const name = el('div', 'shell-proj-name', m.name)
                if (m.here) name.appendChild(el('span', 'shell-proj-badge', 'this tab'))
                if (m.elsewhere) name.appendChild(el('span', 'shell-proj-badge other', 'another tab'))
                box.appendChild(name)
            }
            box.appendChild(el('div', 'shell-proj-sub', `${m.scenes} scene${m.scenes === 1 ? '' : 's'} · ${ago(m.modified)}`))
            const titles = (m.titles || []).slice(0, 8).join(', ') + ((m.titles || []).length > 8 ? ', …' : '')
            r.title = m.here ? `Open here${titles ? ': ' + titles : ''}` : `${m.elsewhere ? 'Another tab has it: it opens here as a copy, and that tab keeps saving it' : 'Click to work on it here (this one is saved first)'}${titles ? '\n' + titles : ''}`
            r.appendChild(box)
            if (asking === m.id) {
                const q = el('div', 'shell-proj-acts')
                q.append(el('span', 'shell-proj-q', 'Delete it? No undo.'),
                    button('Delete', `Delete '${m.name}'`, async () => { asking = null; await session.remove(m.id); onRemoved(m.id); say(`deleted ${m.name}`); drawProjects() }, 'danger'),
                    button('Keep', 'Keep it', () => { asking = null; drawProjects() }))
                r.appendChild(q)
            } else {
                const more = el('button', 'shell-proj-btn icon shell-pv-more', '⋯'); more.type = 'button'; more.title = 'Rename, duplicate, download, delete'
                more.onclick = e => {
                    e.stopPropagation()
                    popupMenu([
                        { label: m.name, header: true },
                        ...(m.here ? [] : [{ label: 'Open', off: item(), run: () => openProject(m) }]),
                        { label: 'Rename…', run: () => { renaming = m.id; drawProjects() } },
                        { label: 'Duplicate', run: guard(async () => { const c = await session.duplicate(m.id); say(`kept a copy: ${c.name}`); drawProjects() }), title: 'A copy kept beside it' },
                        { label: 'Download as a file', run: guard(async () => download(fileName(m.name), await session.exportText(m.id, { app: app() }))),
                          title: 'A project file: File › Import from file… reads it back' },
                        { separator: true },
                        { label: 'Delete…', off: m.here || m.elsewhere, run: () => { asking = m.id; drawProjects() },
                          title: m.here ? 'It is the one open here: open another to delete it' : m.elsewhere ? 'Another tab has it open: close it there to delete it' : 'Asks first: no undo' },
                    ], { under: more })
                }
                r.appendChild(more)
                r.onclick = () => { if (renaming !== m.id) openProject(m) }
            }
            plist.appendChild(r)
        }
    }
    // ...and stays here, its scenes the cards, none compiled (above)
    const openProject = guard(async m => {
        if (m.here || blocked()) return
        await session.open(m.id, { compile: false })
        sig = ''; lastList = 0; look()
    })
    const drawWhere = async () => {
        const st = globalThis.navigator?.storage
        let kept = null
        try { kept = await st?.persisted?.() } catch { }
        where.replaceChildren(el('span', null, kept
            ? 'Kept in this browser until its site data is cleared. A file is the backup: Export project file.'
            : 'Kept in this browser\'s storage, which clearing site data empties -- and which the browser may clear on its own when the disk runs low. A file is the backup: Export project file.'))
        if (kept === false && st?.persist) where.appendChild(button('Ask the browser to keep them', 'navigator.storage.persist(): the browser decides, and may ask', async () => {
            const ok = await st.persist()
            say(ok ? 'the browser will keep the projects until its site data is cleared' : 'the browser did not agree to keep them for good')
            drawWhere()
        }))
    }

    // ---- THIS PROJECT
    const top = el('div', 'shell-pv-top')
    const nameIn = el('input', 'shell-pv-name')
    const meta = el('span', 'shell-pv-meta')
    const back = button('', 'Back to the picture', () => showWork(), 'main')
    top.append(nameIn, meta, el('span', 'shell-spacer'), button('Export project file…', 'Every scene, their cameras and the render settings, as one file', () => exportProject()), back)
    nameIn.onchange = guard(async () => {
        const i = session.info(), v = nameIn.value.trim()
        if (!i?.id) { nameIn.value = i?.name ?? ''; return say('this tab\'s copy is kept once something in it changes: rename it then') }
        if (v && v !== i.name) { await session.rename(i.id, v); drawProjects() }
        drawTop()
    })
    nameIn.onkeydown = e => { if (e.key === 'Enter') nameIn.blur(); else if (e.key === 'Escape') { nameIn.value = session.info()?.name ?? ''; nameIn.blur() } }
    const grid = el('div', 'shell-pv-grid')
    const exHead = el('div', 'shell-pv-h', 'Examples')
    const exBox = el('div', 'shell-pv-examples')
    main.append(top, el('div', 'shell-pv-h', 'Scenes'), grid, exHead, exBox)
    const drawTop = () => {
        const i = session.info()
        if (document.activeElement !== nameIn) nameIn.value = i?.name || 'This project'
        nameIn.title = i?.id ? 'Rename the project' : 'This tab\'s copy of another tab\'s project: kept, and renamed, once something in it changes'
        const n = BUILDER.project.scenes.filter(s => !s.doc.libraryItem).length
        meta.textContent = `${n} scene${n === 1 ? '' : 's'} · ${i?.copy ? 'not saved yet' : 'saved in this browser as it changes'}`
        back.replaceChildren(document.createTextNode(`Back to ${P.scene(BUILDER.project, BUILDER.current)?.doc.title ?? 'the picture'}`))
    }
    /* the scene worked on is shown already -- or being compiled; when it is neither (a project just opened here, or
       its last compile failed), a click compiles it */
    const openScene = key => {
        if (key === BUILDER.current && (BUILDER.showing || BUILDER.applying)) return showWork()
        if (blocked()) return
        guard(() => compile(key))()
        showWork()
    }
    const drawScenes = () => {
        const off = item(), shown = BUILDER.showing || BUILDER.applying
        grid.replaceChildren(...sceneCards(BUILDER.project, BUILDER.current).map(c => {
            const shot = picture(c.key)
            const d = el('div', `shell-pv-card${c.here ? ' here' : ''}${off && !c.here ? ' off' : ''}`)
            d.dataset.key = c.key
            d.draggable = !off
            const pic = el('div', 'shell-pv-pic')
            if (shot?.url) { const img = el('img'); img.src = shot.url; img.alt = ''; img.draggable = false; pic.appendChild(img) }
            else pic.appendChild(el('span', 'shell-pv-nopic', 'no picture yet: it is taken while the scene is shown'))
            if (c.here) pic.appendChild(el('span', 'shell-pv-badge', 'open'))
            const more = el('button', 'shell-pv-more', '⋯'); more.type = 'button'; more.title = 'Open, duplicate, export, delete'
            more.onclick = e => { e.stopPropagation(); popupMenu(sceneMenuItems({ BUILDER, ops, key: c.key, open: openScene, exportScene, off }), { under: more }) }
            const b = el('div', 'shell-pv-cardb')
            b.append(el('div', 'shell-pv-title', c.title),
                el('div', 'shell-pv-cmeta', `${c.unit} · ${c.objects} object${c.objects === 1 ? '' : 's'} · ${c.lights} light${c.lights === 1 ? '' : 's'}`),
                el('div', 'shell-pv-cmeta faint', c.here && !shown ? 'not compiled yet: a click opens it'
                    : shot?.openMs ? `opened in ${seconds(shot.openMs)} last time` : c.here ? 'being worked on' : 'not opened here yet'))
            d.append(pic, b, more)
            d.title = c.here && shown ? `The scene being worked on: back to it` : `Open it (a compile${shot?.openMs ? `; ${seconds(shot.openMs)} last time` : ''})`
            d.onclick = () => openScene(c.key)
            return d
        }), (() => {
            const add = el('div', `shell-pv-card add${off ? ' off' : ''}`)
            add.append(el('div', 'shell-pv-addl', '+ New scene'), el('div', 'shell-pv-cmeta', 'empty, or a copy of the open one'))
            add.title = 'A new scene after the one being worked on'
            add.onclick = () => {
                if (blocked()) return
                popupMenu([{ label: 'Empty scene', run: () => { ops.add(); showWork() } },
                           { label: 'Duplicate this scene', run: () => { ops.duplicate(BUILDER.current); showWork() } }], { under: add })
            }
            return add
        })())
    }
    // dragged, the cards reorder (as over the tree)
    grid.addEventListener('dragstart', e => {
        const d = e.target.closest?.('.shell-pv-card[data-key]')
        if (!d || item()) { e.preventDefault(); return }
        e.dataTransfer.setData(MIME, d.dataset.key); e.dataTransfer.effectAllowed = 'move'
    })
    const unmark = () => { for (const d of grid.querySelectorAll('.dropline')) d.classList.remove('dropline') }
    grid.addEventListener('dragover', e => {
        const d = e.target.closest?.('.shell-pv-card[data-key]')
        unmark()
        if (d && e.dataTransfer.types.includes(MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; d.classList.add('dropline') }
    })
    grid.addEventListener('dragend', unmark)
    grid.addEventListener('drop', e => {
        const d = e.target.closest?.('.shell-pv-card[data-key]')
        unmark()
        const from = e.dataTransfer.getData(MIME)
        if (!d || !from || from === d.dataset.key) return
        e.preventDefault()
        const i = P.indexOf(BUILDER.project, from), j = P.indexOf(BUILDER.project, d.dataset.key)
        ops.move(from, i < j ? j - 1 : j)
    })

    // ---- THE EXAMPLES
    const drawExamples = () => {
        exHead.hidden = exBox.hidden = !examples?.list?.length
        if (!examples?.list?.length) return
        exBox.replaceChildren()
        for (const a of exampleGroups(examples.list)) {
            if (a.audience) exBox.appendChild(el('div', 'shell-pv-aud', a.audience))
            for (const g of a.groups) {
                if (g.group && g.group !== a.audience) exBox.appendChild(el('div', 'shell-pv-grp', g.group))
                const row = el('div', 'shell-pv-exgrid')
                for (const x of g.items) {
                    const b = el('button', 'shell-pv-ex'); b.type = 'button'
                    b.append(el('span', 'shell-pv-title', x.title), el('span', 'shell-pv-cmeta', x.description ?? ''))
                    b.title = 'A copy goes into this project and is opened'
                    b.onclick = guard(async () => { if (blocked()) return; await examples.open(x.id); showWork() })
                    row.appendChild(b)
                }
                exBox.appendChild(row)
            }
        }
    }

    // ---- FOLLOWING, while shown
    let shown = false, sig = '', lastList = 0, timer = 0
    const look = () => {
        if (!shown) return
        drawTop()
        const cards = sceneCards(BUILDER.project, BUILDER.current)
        const now = `${BUILDER.revision}|${BUILDER.current}|${item()}|${BUILDER.showing || BUILDER.applying}|${cards.map(c => { const s = picture(c.key); return `${c.key}:${s?.url ?? ''}:${s?.openMs ?? ''}` }).join(',')}`
        if (now !== sig) { sig = now; drawScenes() }
        // the list of projects: another tab may change it, and reading it is a store's read -- every few seconds
        if (Date.now() - lastList > 4000 && !renaming && !asking) { lastList = Date.now(); drawProjects() }
    }
    const visible = v => {
        shown = !!v
        clearInterval(timer)
        if (!shown) return
        sig = ''; lastList = 0
        look(); drawWhere()
        timer = setInterval(look, 500)
    }
    drawExamples()

    return {
        element: host,
        visible,
        /** Scrolled to a part of it: 'examples' (+ New scene › From an example…), or the top. */
        at: section => (section === 'examples' ? exHead : top).scrollIntoView({ block: 'start' }),
        refresh: () => { sig = ''; lastList = 0; look() },
    }
}
