//======================================================================================================================
// THE PROJECT AND ITS SCENES, OVER THE TREE -- one line for the project and the scenes, and a card per scene under it
// (0.63.0; mockup H, C′, the user's choice, 2026-10-17: "go with C -> but combine the 'My project' line and Scenes
// header into one line"). UI_PLAN.md section 11.
//
//   ▾  ▦ Lamp study · 6 scenes                    ＋        ▾ folds the cards (folded, the line names the open scene);
//   [pic] Spot lens v1        mm · 4 objects · 6 s  ▶ ⋯       the name opens the Project panel; ＋ a new scene
//   [pic] Spot lens v2        open                     ⋯
//
// WHY CARDS. Until now a project's scenes were names in File › Switch to scene ▸, seen only by opening it; before that,
// a dropdown over the tree (0.7.0-0.45.0), and before that every scene in the tree, where a click on another scene's
// row compiled it -- 4-23 s on the user's card for a mis-click (section 10). The cards show every scene, with the
// picture it last had, and keep the rule that came out of that: SWITCHING IS A DELIBERATE ACT. A click on a card only
// selects it (its card in Properties, nothing compiled); ▶ or a double-click opens it.
//
// WHAT A CARD DOES
//   click            selects it: onSelect(key) -- the host shows it in Properties (panel.js showScene)
//   ▶, double-click  opens it: ops.enter (a compile)
//   ⋯, right-click   Open · Duplicate (another scene's copy is made beside it, and you stay) · Export scene file… · Delete
//   drag a card      reorders the scenes (ops.move)
//   drop a tree row  copies it into that scene; with Shift, moves it (tree.js sendTo -- as the row's right-click Copy to)
// The open scene's card says so, and carries the ▶ when the picture is not that scene (a safe start, a scene that did
// not compile: what the row over the tree carried until now). A library item being edited (library/edit.js) has no
// card -- it is the library's, kept out of files too -- and while one is edited the cards wait: greyed, saying why.
//
// IT FOLLOWS BY LOOKING, four times a second, as the row before it did: the project, its scenes (counted again only
// when the builder's revision moves), the open one, its picture, whether it is compiled. An undo, a project opened from
// the Project panel, a picture arriving -- each reaches it without a hook. refresh() for at once. Never under the mouse:
// from a press on a card until it is let go, the redraw waits (0.67.1, `held`).
//
//   const S = installSceneStrip(host, { BUILDER, ops: tree.sceneOps, tree, project, picture, onSelect, openProject, examples, item, compile, exportScene, say })
//   S.refresh()    S.select(key | null)    S.selected()
//======================================================================================================================
import * as M from './model.js'
import { icon } from '../lib/pathtracer/icons.js'
import { popupMenu } from '../lib/shell/menu.js'

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
const FOLD_KEY = 'raytracer.scenes.folded'
const MIME = 'application/x-shady-scene'           // a card being dragged, not a tree row nor a file

/** A card per scene of the project, a library item's left out: { key, title, unit, objects, lights, here }, in order.
 *  Objects are what draws (an export or haze box does not), lights the light objects; a group is neither. */
export function sceneCards(project, current) {
    const out = []
    for (const s of project.scenes) {
        if (s.doc.libraryItem) continue
        let objects = 0, lights = 0
        M.walk(s.doc, n => {
            if (n.kind !== 'object') return
            if (n.type === 'light') lights++
            else if (!M.BOX_TYPES.includes(n.type)) objects++
        })
        out.push({ key: s.key, title: s.doc.title, unit: s.doc.unit ?? 'm', objects, lights, here: s.key === current })
    }
    return out
}

/** A SCENE'S MENU, the card's ⋯ here and in the Project panel (workspace/projectview.js): Open · Duplicate · Export scene
 *  file… · Delete. Another scene's copy is made beside it and the scene being worked on stays; the last scene cannot go.
 *  `open` and `exportScene` are the caller's (key => void); `off`: everything that adds, opens or deletes greyed. */
export function sceneMenuItems({ BUILDER, ops, key, open, exportScene, off = false }) {
    const c = BUILDER.projectModel.scene(BUILDER.project, key)
    if (!c) return []
    const here = key === BUILDER.current
    const others = BUILDER.project.scenes.filter(s => !s.doc.libraryItem).length
    return [
        { label: c.doc.title, header: true },
        ...(here ? [] : [{ label: 'Open', off, run: () => open(key), title: 'Work on it: a compile' }]),
        { label: here ? 'Duplicate this scene' : 'Duplicate', off, run: () => ops.duplicate(key, { go: here }),
          title: here ? 'A copy right after it, worked on' : 'A copy right after it; you stay on the scene you are working on' },
        { label: 'Export scene file…', run: () => exportScene(key), title: 'This scene alone, as a file' },
        { separator: true },
        { label: here ? 'Delete this scene' : 'Delete', off: off || others < 2, run: () => ops.remove(key),
          title: others < 2 ? 'The last scene cannot be deleted' : 'Ctrl+Z brings it back' },
    ]
}

/** "6 s", "0.8 s", "1 min 12 s": how long a scene took to open. */
export function seconds(ms) {
    const s = ms / 1000
    return s < 1 ? `${s.toFixed(1)} s` : s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`
}

/**
 * @param host         the Scene panel's place over the tree
 * @param BUILDER      demo.js's: project, current, revision, showing, applying, projectModel
 * @param ops          tree.js's sceneOps: enter, add, duplicate, remove, move
 * @param tree         tree.js's: draggedRow (with .done), sendTo -- a tree row dropped on a card
 * @param project      () => { name, copy } -- the project this tab works on (workspace/session.js info), or null
 * @param picture      key => { url, openMs } | null: the scene's last picture and how long it took to open (workspace/scenepics.js)
 * @param onSelect     key => void: a card chosen (or null), for Properties
 * @param openProject  (section) => void: the Project panel, at 'examples' when asked
 * @param item         () => bool: a library item is being edited
 * @param compile      () => void: compile and show the scene being worked on (the ▶)
 * @param exportScene  key => void: download that scene's file
 * @param say          a status line
 */
export function installSceneStrip(host, { BUILDER, ops, tree = null, project = () => null, picture = () => null, onSelect = () => { },
                                          openProject = () => { }, item = () => false, compile = null, exportScene = () => { }, say = () => { } }) {
    const P = BUILDER.projectModel
    const root = el('div', 'shell-scenes')
    const line = el('div', 'shell-scenes-line')
    const fold = el('button', 'shell-sw-act shell-scenes-fold'); fold.type = 'button'
    const name = el('button', 'shell-scenes-project'); name.type = 'button'
    const grid = el('span', 'shell-scenes-grid'); for (let i = 0; i < 4; i++) grid.appendChild(el('i'))
    const nameText = el('span', 'shell-sw-name'), note = el('span', 'shell-sw-note')
    name.append(grid, nameText, note)
    name.title = 'The Project panel: the projects kept in this browser, this one\'s scenes large, the examples'
    const count = el('span', 'shell-scenes-count')
    const plus = el('button', 'shell-sw-act shell-scenes-plus'); plus.type = 'button'
    plus.appendChild(icon('plus', 15)); plus.title = 'A new scene: empty, a copy of this one, or an example'
    line.append(fold, name, count, el('span', 'shell-spacer'), plus)
    const cards = el('div', 'shell-scenes-cards')
    root.append(line, cards)
    host.appendChild(root)

    let folded = false
    try { folded = localStorage.getItem(FOLD_KEY) === '1' } catch { }
    let selected = null
    const blocked = () => { if (!item()) return false; say('close the library item first (Save or Close, over the view)'); return true }
    const open = key => {
        if (blocked()) return
        if (key === BUILDER.current) return say('that is the scene being worked on')
        ops.enter(key)
    }

    // ---- THE LINE
    fold.onclick = () => {
        folded = !folded
        try { localStorage.setItem(FOLD_KEY, folded ? '1' : '0') } catch { }
        sig = ''; refresh()
    }
    name.onclick = () => openProject()
    plus.onclick = () => {
        const off = item()
        popupMenu([
            { label: 'Empty scene', off, run: () => ops.add(), title: 'An empty scene after this one, worked on' },
            { label: 'Duplicate this scene', off, run: () => ops.duplicate(BUILDER.current), title: 'A copy right after it, worked on' },
            { label: 'From an example…', off, run: () => openProject('examples'), title: 'The examples, in the Project panel: a copy of one goes into this project' },
        ], { under: plus })
    }

    // ---- A CARD'S MENU
    const menu = (key, at) => {
        const items = sceneMenuItems({ BUILDER, ops, key, open, exportScene, off: item() })
        if (items.length) popupMenu(items, at)
    }

    // ---- THE CARDS: drawn when what they show changes; a selection only moves a class
    let sig = '', counted = '', list = []
    /* NOT WHILE A CARD IS HELD (0.67.1): the cards are replaced when what they show changes -- a picture taken, a compile
       begun or ended, any edit, found by the 250 ms look below -- and a card replaced under the mouse lost what the mouse
       was doing with it. Measured headless in Chromium: a card dragged onto another with the cards redrawn between the
       move and the release, 0 of 6 reordered, each on a fresh page (not redrawn, 6 of 6); a click on another card
       redrawn between its press and its release, 6 of 6 chose nothing. The check's drags right after an edit failed about
       one run in two on redraws like these (and on one of the test tool's own: projects.check.mjs). So from a press on a
       card the redraw waits -- until the release, once its click is made; when the press started a drag, until the drag
       is over, since a drag swallows the release -- and is made then: 6 of 6 of each. A press whose release never came (a
       drag the browser lost) is let go by the next release anywhere. */
    let held = false
    const release = () => { if (held) { held = false; refresh() } }
    const card = c => {
        const d = el('div', `shell-scene-card${c.here ? ' here' : ''}`)
        d.dataset.key = c.key
        d.draggable = true
        const pic = el('div', 'shell-scene-pic'), shot = picture(c.key)
        if (shot?.url) { const img = el('img'); img.src = shot.url; img.alt = ''; img.draggable = false; pic.appendChild(img) }
        else pic.appendChild(icon('image', 16))
        const tx = el('div', 'shell-scene-tx')
        const t = el('div', 'shell-scene-title', c.title)
        const notShown = c.here && !!compile && !BUILDER.showing && !BUILDER.applying
        const m = el('div', 'shell-scene-meta', c.here
            ? (BUILDER.applying ? 'opening…' : notShown ? 'open · not compiled' : 'open')
            : `${c.unit} · ${c.objects} object${c.objects === 1 ? '' : 's'}${c.lights ? ` · ${c.lights} light${c.lights === 1 ? '' : 's'}` : ''}${shot?.openMs ? ` · ${seconds(shot.openMs)}` : ''}`)
        tx.append(t, m)
        const acts = el('div', 'shell-scene-acts')
        const btn = (name, tip, run, cls = '') => { const b = el('button', `shell-sw-act${cls}`); b.type = 'button'; b.title = tip; b.appendChild(icon(name, 14)); b.onclick = e => { e.stopPropagation(); run(e) }; acts.appendChild(b); return b }
        if (!c.here) btn('play', `Open it (a compile${shot?.openMs ? `; ${seconds(shot.openMs)} last time` : ''})`, () => open(c.key), ' shell-scene-go')
        else if (notShown) btn('play', 'Not compiled: the picture is not this scene. Click to compile and show it', () => compile(), ' shell-sw-play')
        const more = el('button', 'shell-sw-act shell-scene-more', '⋯'); more.type = 'button'; more.title = 'More: open, duplicate, export, delete'
        more.onclick = e => { e.stopPropagation(); menu(c.key, { under: more }) }
        acts.appendChild(more)
        d.append(pic, tx, acts)
        d.title = c.here ? 'The scene being worked on' : `Click: show it in Properties (nothing compiles) · ▶ or a double-click: open it`
        return d
    }
    const marks = () => {
        const off = item()
        for (const d of cards.children) {
            d.classList.toggle('sel', d.dataset.key === selected)
            d.classList.toggle('off', off)
            if (off) d.title = 'A library item is being edited: close it first (Save or Close, over the view)'
        }
    }
    const refresh = () => {
        const p = project?.() ?? null
        nameText.textContent = p?.name || 'This project'
        note.textContent = p?.copy ? ' · not saved yet' : ''
        name.title = p?.copy ? `This tab works on a copy of '${p.copy}', which another tab has open: it is kept as '${p.name}' once something is changed here.`
            : 'The Project panel: the projects kept in this browser, this one\'s scenes large, the examples'
        // counted again only when the project may have changed (the builder's revision) or another is open
        const c0 = `${BUILDER.revision}|${BUILDER.current}|${BUILDER.project.scenes.length}`
        if (c0 !== counted) { counted = c0; list = sceneCards(BUILDER.project, BUILDER.current) }
        if (selected && !list.some(c => c.key === selected && !c.here)) selected = null
        const shots = list.map(c => { const s = picture(c.key); return `${s?.url ?? ''}:${s?.openMs ?? ''}` }).join(',')
        const now = `${JSON.stringify(list)}|${shots}|${folded}|${BUILDER.showing}|${BUILDER.applying}|${!!compile}`
        const here = list.find(c => c.here)
        fold.textContent = folded ? '▸' : '▾'
        fold.title = folded ? 'Show the scenes' : 'Fold the scenes away'
        count.textContent = `· ${list.length} scene${list.length === 1 ? '' : 's'}${folded && here ? ` · ${here.title}` : ''}`
        if (now !== sig && !held) {
            sig = now
            cards.hidden = folded
            cards.replaceChildren(...(folded ? [] : list.map(card)))
        }
        marks()
    }
    setInterval(refresh, 250)

    // ---- CLICKS: one selects, two open (a 'dblclick': a selection redraws nothing, so both land on one card)
    cards.addEventListener('click', e => {
        const d = e.target.closest('.shell-scene-card')
        if (!d || e.target.closest('.shell-scene-acts')) return
        if (item()) return blocked()
        const key = d.dataset.key
        selected = key === BUILDER.current ? null : key
        marks()
        onSelect(key)
    })
    cards.addEventListener('dblclick', e => {
        const d = e.target.closest('.shell-scene-card')
        if (d && !e.target.closest('.shell-scene-acts')) open(d.dataset.key)
    })
    cards.addEventListener('contextmenu', e => {
        const d = e.target.closest('.shell-scene-card')
        if (!d) return
        e.preventDefault()
        menu(d.dataset.key, { x: e.clientX, y: e.clientY })
    })

    // ---- DRAGS: a card among the cards reorders; a tree row on a card is copied there (Shift: moved)
    const clearMarks = () => { for (const d of cards.querySelectorAll('.drop, .dropline')) d.classList.remove('drop', 'dropline') }
    cards.addEventListener('mousedown', e => {
        if (!e.target.closest?.('.shell-scene-card')) return
        held = true
        // the release: in the press's own document (the panel may be in a window of its own), let go once its click is made
        e.target.ownerDocument.addEventListener('mouseup', () => setTimeout(release, 0), { capture: true, once: true })
    })
    cards.addEventListener('dragstart', e => {
        const d = e.target.closest?.('.shell-scene-card')
        if (!d || item()) { e.preventDefault(); return }
        e.dataTransfer.setData(MIME, d.dataset.key)
        e.dataTransfer.effectAllowed = 'move'
    })
    /* the tree's rows allow only 'move' (TreeView sets effectAllowed), so a drop on a card asks for 'move' too -- a
       'copy' would be refused by the browser and no drop come; Shift is read on the drop, and says which it is */
    cards.addEventListener('dragover', e => {
        const d = e.target.closest?.('.shell-scene-card')
        clearMarks()
        if (!d || item()) return
        const row = tree?.draggedRow?.()
        if (e.dataTransfer.types.includes(MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; d.classList.add('dropline') }
        else if (row && d.dataset.key !== BUILDER.current) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; d.classList.add('drop') }
    })
    cards.addEventListener('dragleave', e => { if (!cards.contains(e.relatedTarget)) clearMarks() })
    // the drag over, dropped anywhere: the redraw it held made now -- dropped on a card, in the order the drop has made
    cards.addEventListener('dragend', () => { clearMarks(); release() })
    cards.addEventListener('drop', e => {
        const d = e.target.closest?.('.shell-scene-card')
        clearMarks()
        if (!d || item()) return
        e.preventDefault()
        const to = d.dataset.key
        const from = e.dataTransfer.getData(MIME)
        if (from) {
            if (from === to) return
            const i = P.indexOf(BUILDER.project, from), j = P.indexOf(BUILDER.project, to)
            // before the card dropped on: its index once the dragged one is taken out (project.js moveScene)
            return ops.move(from, i < j ? j - 1 : j)
        }
        const row = tree?.draggedRow?.()
        if (!row || to === BUILDER.current) return
        tree.draggedRow.done?.()
        const move = e.shiftKey
        // after the drag has ended: sendTo rebuilds the tree, and TreeView's own dragend is owed to the row it started from
        setTimeout(() => tree.sendTo(row.mid, to, { move }), 0)
    })

    refresh()
    return {
        element: root,
        refresh: () => { sig = ''; counted = ''; refresh() },
        /** Mark a card chosen elsewhere (a tree row chosen clears it), without telling onSelect. */
        select: key => { selected = key && key !== BUILDER.current ? key : null; marks() },
        selected: () => selected,
    }
}
