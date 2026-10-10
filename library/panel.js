//======================================================================================================================
// THE LIBRARY PANEL -- find a thing and put it into the scene (library/store.js holds the items, library/
// thumbs.js their pictures).
//
//   installLibraryPanel(el, { library, insert(asset, name), selection() -> { asset, name } | null, say,
//                             thumbs, live(item, tileElement) -> stop(), edit(item) })
//   .note(text)  a line saying what the pictures wait on ('' hides it)
//   drag(item | null)  told as an item is dragged out of the panel and when the drag ends (the host drops it)
//   edit(item)  open one of the user's items to edit (the host's: library/edit.js); a built-in one is
//               duplicated first, so what reaches it is always the user's own
//
// A search box and a row of chips (what kind; built in or mine), a row of TAGS -- the ones the items left
// by the other filters carry, most used first; several lit means all of them; folded to the most used when
// there are many, a lit one always showing -- then the items by category: as a GRID of
// pictures (the default -- mockup E's, which the user liked) or a LIST, and the tiles' size on a slider.
// A picture is asked for when its tile scrolls into view, rendered once and kept (thumbs.js); until it
// arrives the tile shows its kind's icon. With `live`, pointing at a tile hands it over to the host, which
// draws the item there live (library/studio.js: turn it, zoom it) until the pointer leaves.
//
// A double-click, Enter in the search box (the first match), or the item's ⊕ puts it in where a paste
// would go (the tree's selection). ＋ keeps the tree's selection as an item of one's own -- named in a line
// that opens under the bar, as a tree row is renamed in place, not in a dialog, with its category and
// tags -- and one's own items can be renamed and removed. Any item can be duplicated (⧉: a copy of one's
// own, its name opened for renaming) and edited (✎: a built-in one through a copy). The library of one's
// own goes out and comes back as a file.
//
// Minimal, as the rest (the user, 2026-09-27): icons with tooltips, each item's help is its tooltip, and
// nothing is said twice -- the kind is an icon, not a word beside the name.
//======================================================================================================================
/* global IntersectionObserver -- the browser's; without it every tile asks for its picture at once */
import { icon, iconButton, lit } from '../lib/pathtracer/icons.js'
import { saveText } from '../lib/pathtracer/strip.js'

const KIND_CHIPS = [['', 'All'], ['object', 'Objects'], ['group', 'Groups'], ['light', 'Lights'], ['material', 'Materials']]
// the source is a toggle: neither lit is both -- an "All" here too said the kind row's "All" twice
const SOURCE_CHIPS = [['built-in', 'Built in'], ['mine', 'Mine']]
const KIND_ICON = { object: 'box', group: 'boxes', light: 'lux', material: 'exposure' }
const VIEW_KEY = 'raytracer.library.view'
/* THE TAG ROW FOLDS past this many tags to the most used TAGS_SHOWN (and any lit one): the built-in items
   alone carry about thirty, which as chips is a wall above the list (the user, 2026-09-30: "if there are
   many tags, put them in a collapsible element") */
const TAGS_FOLD = 10, TAGS_SHOWN = 8
const LIVE_AFTER_MS = 300                 // a pointer resting this long on a tile makes it live
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }

export function installLibraryPanel(host, { library, insert, selection = () => null, say = () => { }, thumbs = null, live = null, drag = null, edit = null }) {
    const root = el('div', 'shell-lib')
    host.appendChild(root)
    const F = { q: '', kind: '', source: '', tags: new Set() }
    /* THE VIEW: grid or list, the tiles' size, the tag row unfolded -- remembered per browser, a convenience only */
    const V = { mode: 'grid', size: 112, tagsOpen: false }
    try { Object.assign(V, JSON.parse(localStorage.getItem(VIEW_KEY)) || {}) } catch { }
    const keepView = () => { try { localStorage.setItem(VIEW_KEY, JSON.stringify(V)) } catch { } }
    let items = [], shown = []

    // THE BAR: search, keep the selection, export, import
    const bar = el('div', 'shell-lib-bar')
    const q = el('input'); q.type = 'search'; q.placeholder = 'Search the library'
    q.title = 'Every word must match a name, category, tag or help text. Enter puts the first match in.'
    const keep = iconButton('plus', 'Keep the selected object, group, light or material in the library')
    const exp = iconButton('download', 'Export your items to a file')
    const imp = iconButton('open', 'Import items from a library file')
    bar.append(q, keep, exp, imp)
    const form = el('div', 'shell-lib-form'); form.hidden = true
    const chips = el('div', 'shell-lib-chips')
    const list = el('div', 'shell-lib-list')
    root.append(bar, form, chips, list)

    const chipRow = (defs, key) => {
        const row = el('div', 'shell-lib-chiprow')
        for (const [v, label] of defs) {
            const b = el('button', 'shell-lib-chip', label); b.type = 'button'; b.dataset.v = v; b.dataset.k = key
            b.onclick = () => { F[key] = key === 'source' && F[key] === v ? '' : v; draw() }
            row.appendChild(b)
        }
        return row
    }
    const kindRow = chipRow(KIND_CHIPS, 'kind'), sourceRow = chipRow(SOURCE_CHIPS, 'source')
    kindRow.appendChild(el('span', 'shell-lib-sep'))
    kindRow.append(...sourceRow.children)
    /* THE TAGS, redrawn with the list: what the other filters leave carries these (tagCounts), and a lit
       tag stays even when nothing left carries it -- or it could not be switched off again */
    const tagRow = el('div', 'shell-lib-chiprow shell-lib-tags')
    const tagChip = (label, title, onclick, cls = '') => {
        const b = el('button', `shell-lib-chip shell-lib-tag${cls}`, label); b.type = 'button'; b.title = title
        b.onclick = onclick
        return b
    }
    const drawTags = base => {
        const counts = library.tagCounts(base)
        for (const t of F.tags) if (!counts.some(([k]) => k === t)) counts.push([t, 0])
        tagRow.innerHTML = ''
        tagRow.hidden = !counts.length
        const folds = counts.length > TAGS_FOLD
        const visible = !folds || V.tagsOpen ? counts : counts.filter(([t], i) => i < TAGS_SHOWN || F.tags.has(t))
        for (const [t, n] of visible) {
            const b = tagChip(t, `${n} item${n === 1 ? '' : 's'}${F.tags.size && !F.tags.has(t) ? ' (with the lit ones)' : ''}`, () => {
                F.tags.has(t) ? F.tags.delete(t) : F.tags.add(t); draw()
            })
            b.dataset.tag = t
            b.classList.toggle('on', F.tags.has(t))
            tagRow.appendChild(b)
        }
        if (folds) tagRow.appendChild(tagChip(V.tagsOpen ? 'less' : `+${counts.length - visible.length}`,
            V.tagsOpen ? 'Show only the most used tags' : 'Show every tag', () => { V.tagsOpen = !V.tagsOpen; keepView(); draw() }, ' more'))
    }
    // grid or list, and in the grid the tiles' size
    const viewRow = el('div', 'shell-lib-viewrow')
    const gridBtn = iconButton('image', 'Pictures'), listBtn = iconButton('table', 'A list')
    const size = el('input'); size.type = 'range'; size.min = 72; size.max = 200; size.step = 4; size.title = 'The pictures\' size'
    /* MAKE THE PICTURES NOW: every one listed (the filters narrow it), made again, not waiting for the view to
       be left alone -- the background makes them only then, which is slow to watch (the user, 2026-09-28) */
    const again = iconButton('rotational', 'Make the pictures of everything listed again, now')
    const done = el('span', 'shell-lib-progress')
    viewRow.append(gridBtn, listBtn, size, again, done)
    if (!thumbs) again.style.display = 'none'
    again.onclick = async () => {
        if (again.disabled) return
        again.disabled = true; again.style.opacity = '0.5'
        const off = thumbs.onProgress(p => { done.textContent = p.total ? `${p.done} / ${p.total}` : '' })
        try { await thumbs.all(shown, { force: true }); say(`made ${shown.length} picture${shown.length === 1 ? '' : 's'}`) }
        finally { off(); done.textContent = ''; again.disabled = false; again.style.opacity = '' }
    }
    /* A LINE FOR WHAT THE PICTURES ARE WAITING ON (note()): the studio's start and its one compile per unit
       take seconds, and a grid of icons that does nothing for that long looks broken (the user, 2026-09-28) */
    const noteEl = el('div', 'shell-lib-wait'); noteEl.hidden = true
    chips.append(kindRow, tagRow, viewRow, noteEl)
    const setView = mode => { V.mode = mode; keepView(); draw() }
    gridBtn.onclick = () => setView('grid'); listBtn.onclick = () => setView('list')
    size.oninput = () => { V.size = +size.value; list.style.setProperty('--tile', `${V.size}px`); keepView() }

    /* DRAGGED OUT, onto the picture or the tree (the host's drop: drag(item) as it starts, drag(null) as it
       ends). The item itself goes by the host, not through dataTransfer, which a page can read only on
       the drop; the type is set so a drop target can tell a library item from a file while it hovers. A
       tile turning its live view (a click on it, library/studio.js) is not dragged: the pointer is its. */
    const DRAG_TYPE = 'application/x-raytracer-library'
    const draggable = (node, it) => {
        if (!drag) return
        node.draggable = true
        node.addEventListener('dragstart', e => {
            if (node.querySelector('.shell-lib-live.turning')) { e.preventDefault(); return }
            e.dataTransfer.setData(DRAG_TYPE, it.id)
            e.dataTransfer.setData('text/plain', it.name)
            e.dataTransfer.effectAllowed = 'copy'
            node.dispatchEvent(new Event('pointerleave'))       // its live view stops: the renderer is wanted
            drag(it)
        })
        node.addEventListener('dragend', () => drag(null))
    }
    const put = it => {
        try { insert(structuredClone(it.asset), it.name) } catch (e) { say(`library: ${e.message}`) }
    }

    /* THE PICTURES: asked for as a tile comes into view (the ones on screen first), put in when they arrive */
    const tiles = new Map()                       // item id -> { item, pic }
    const seen = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
        for (const e of entries) if (e.isIntersecting) {
            const t = tiles.get(e.target.dataset.id)
            if (t && thumbs) thumbs.want(t.item).then(url => { if (url) showPic(t, url) })
            seen.unobserve(e.target)
        }
    }, { root: list, rootMargin: '200px' }) : null
    const showPic = (t, url) => {
        if (t.pic.querySelector('img')?.src === url) return
        const img = el('img'); img.alt = ''; img.draggable = false; img.src = url
        // under a live view, if the tile has one: the picture arriving must not take the live canvas away
        for (const c of [...t.pic.children]) if (!c.classList.contains('shell-lib-live')) c.remove()
        t.pic.prepend(img)
        t.pic.classList.add('has')
    }
    thumbs?.on(() => { for (const t of tiles.values()) { const url = thumbs.url(t.item); if (url) showPic(t, url) } })

    /* THE ITEMS, by category, as tiles or rows; an empty result says what would find something */
    const draw = () => {
        for (const b of kindRow.querySelectorAll('.shell-lib-chip'))
            b.classList.toggle('on', b.dataset.k === 'source' ? b.dataset.v === F.source : b.dataset.v === F.kind)
        lit(gridBtn, V.mode === 'grid'); lit(listBtn, V.mode === 'list')
        size.style.display = V.mode === 'grid' ? '' : 'none'
        size.value = V.size
        list.style.setProperty('--tile', `${V.size}px`)
        list.classList.toggle('grid', V.mode === 'grid')
        const base = library.search(items, F.q, { kind: F.kind || null, source: F.source || null })
        drawTags(base)
        shown = F.tags.size ? library.search(base, '', { tags: [...F.tags] }) : base
        seen?.disconnect()
        tiles.clear()
        list.innerHTML = ''
        if (!shown.length) {
            list.appendChild(el('div', 'shell-lib-empty', F.source === 'mine' && !items.some(i => i.source === 'mine')
                ? 'Nothing of your own yet: select something in the scene and press ＋.' : 'Nothing matches.'))
            return
        }
        let cat = null, box = null
        for (const it of shown) {
            if (it.category !== cat) {
                cat = it.category
                list.appendChild(el('div', 'shell-lib-cat', cat))
                box = list.appendChild(el('div', 'shell-lib-group'))
            }
            box.appendChild(V.mode === 'grid' ? tile(it) : row(it))
        }
    }
    /* what every item offers, on hover: put it in, edit it, duplicate it; one's own, rename and remove */
    const actions = (it, nameEl, holder) => {
        const acts = el('span', 'shell-lib-acts')
        acts.appendChild(iconButton('plus', 'Put it in the scene (or double-click)', e => { e.stopPropagation(); put(it) }))
        if (edit) acts.appendChild(iconButton('edit', it.source === 'mine' ? 'Edit it: in the view, its properties beside it'
            : 'Edit a copy of your own (built-in items stay as they are)', e => { e.stopPropagation(); editItem(it) }))
        acts.appendChild(iconButton('duplicate', 'Duplicate: a copy of your own', e => { e.stopPropagation(); duplicate(it) }))
        if (it.source === 'mine') {
            acts.appendChild(iconButton('tune', 'Rename', e => { e.stopPropagation(); rename(it, holder, nameEl) }))
            acts.appendChild(iconButton('clear', 'Remove from the library', async e => {
                e.stopPropagation()
                try { await library.remove(it.id); say(`removed ${it.name} from the library`) } catch (err) { say(`library: ${err.message}`) }
            }))
        }
        return acts
    }
    /* the tooltip: its help, and its tags -- they are not shown anywhere else on the item */
    const tipOf = it => [it.help || it.name, (it.tags || []).length ? it.tags.map(t => `#${t}`).join(' ') : ''].filter(Boolean).join('\n')
    const row = it => {
        const r = el('div', 'shell-lib-item')
        r.title = tipOf(it)
        r.dataset.id = it.id
        const ic = el('span', 'shell-lib-icon'); ic.appendChild(icon(KIND_ICON[it.kind] ?? 'box', 14))
        const name = el('span', 'shell-lib-name', it.name)
        r.append(ic, name)
        if (it.source === 'mine') r.appendChild(el('span', 'shell-lib-mine', 'mine'))
        r.appendChild(actions(it, name, r))
        r.ondblclick = () => put(it)
        draggable(r, it)
        return r
    }
    const tile = it => {
        const t = el('div', 'shell-lib-item shell-lib-tile')
        t.title = tipOf(it)
        t.dataset.id = it.id
        // the picture, or until it comes its kind's icon
        const pic = el('div', 'shell-lib-pic')
        pic.appendChild(icon(KIND_ICON[it.kind] ?? 'box', 28))
        const kind = el('span', 'shell-lib-kind'); kind.appendChild(icon(KIND_ICON[it.kind] ?? 'box', 12))
        const name = el('div', 'shell-lib-name', it.name)
        t.append(pic, kind, name)
        if (it.source === 'mine') t.appendChild(el('span', 'shell-lib-mine', 'mine'))
        t.appendChild(actions(it, name, t))
        t.ondblclick = () => put(it)
        draggable(t, it)
        const entry = { item: it, pic }
        tiles.set(it.id, entry)
        const url = thumbs?.url(it)
        if (url) showPic(entry, url)
        else if (seen) seen.observe(t)
        else thumbs?.want(it).then(u => { if (u) showPic(entry, u) })
        /* LIVE: pointing at a tile hands it to the host until the pointer leaves (library/studio.js) */
        /* after a moment's pause on it, not at once: a pointer swept across the grid would otherwise start
           (and compile a scene for) every tile it crossed */
        if (live) {
            let stop = null, timer = 0
            t.addEventListener('pointerenter', () => {
                timer = setTimeout(() => { try { stop = live(it, pic) } catch (e) { console.warn('[library] live:', e) } }, LIVE_AFTER_MS)
            })
            t.addEventListener('pointerleave', () => { clearTimeout(timer); try { stop?.() } catch { } stop = null })
        }
        return t
    }
    const rename = (it, holder, name) => {
        const inp = el('input', 'shell-lib-rename'); inp.value = it.name
        name.replaceWith(inp); inp.focus(); inp.select()
        const done = async ok => {
            inp.onblur = null
            if (ok && inp.value.trim() && inp.value.trim() !== it.name) { try { await library.rename(it.id, inp.value) } catch (e) { say(`library: ${e.message}`) } }
            else inp.replaceWith(name)
        }
        inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false) }
        inp.ondblclick = e => e.stopPropagation()
        inp.onblur = () => done(true)
    }
    /* DUPLICATE: the copy is one's own, and its name is opened for renaming where it is listed -- found
       after the list is redrawn with it. A filter hiding it (Built in lit, a tag it lacks) is said. */
    const duplicate = async it => {
        let dup
        try { dup = await library.duplicate(it.id) } catch (e) { return say(`library: ${e.message}`) }
        await refresh()
        thumbs?.want(dup)
        const holder = [...list.querySelectorAll('.shell-lib-item')].find(n => n.dataset.id === dup.id)
        const shownDup = shown.find(i => i.id === dup.id)
        if (!holder || !shownDup) return say(`duplicated as ${dup.name}, under ${dup.category} (hidden by the filters)`)
        holder.scrollIntoView?.({ block: 'nearest' })
        rename(shownDup, holder, holder.querySelector('.shell-lib-name'))
    }
    /* EDIT: the host opens it (library/edit.js). Only one's own is edited: a built-in item through a copy */
    const editItem = async it => {
        let mine = it
        if (it.source !== 'mine') {
            try { mine = await library.duplicate(it.id) } catch (e) { return say(`library: ${e.message}`) }
            say(`editing a copy of your own: ${mine.name}`)
        }
        try { await edit(mine) } catch (e) { say(`library: ${e.message}`) }
    }
    const refresh = async () => { items = await library.list(); draw() }
    library.on(refresh)

    q.addEventListener('input', () => { F.q = q.value; draw() })
    q.addEventListener('keydown', e => { if (e.key === 'Enter' && shown[0]) put(shown[0]) })

    /* KEEP THE SELECTION: a line under the bar, the name first (the selection's own), then a category */
    keep.onclick = () => {
        const sel = selection()
        if (!sel) return say('library: select an object, group, light or material in the scene first')
        form.innerHTML = ''
        const n = el('input'); n.value = sel.name ?? ''; n.placeholder = 'name'; n.title = 'Its name in the library'
        const c = el('input'); c.value = 'Mine'; c.placeholder = 'category'; c.title = 'Its category: items are listed under it'
        const tg = el('input'); tg.placeholder = 'tags'; tg.title = 'Its tags, separated by commas: the tag row finds it by them'
        const ok = iconButton('plus', 'Keep it (Enter)'), no = iconButton('clear', 'Cancel (Esc)')
        form.append(n, c, tg, ok, no); form.hidden = false; n.focus(); n.select()
        const close = () => { form.hidden = true; form.innerHTML = '' }
        const save = async () => {
            try {
                const it = await library.add({ name: n.value, category: c.value, tags: tg.value, asset: sel.asset })
                close(); say(`kept ${it.name} in the library`)
                F.q = ''; q.value = ''
                // its picture now, while what it is is fresh -- not when it is next scrolled to
                thumbs?.want(it)
            } catch (e) { say(e.message) }
        }
        ok.onclick = save; no.onclick = close
        for (const i of [n, c, tg]) i.onkeydown = e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') close() }
    }
    exp.onclick = async () => {
        const text = await library.exportLibrary()
        const n = JSON.parse(text).items.length
        if (!n) return say('library: nothing of your own to export yet')
        saveText(text, 'library.json', 'application/json')
        say(`exported ${n} item${n === 1 ? '' : 's'}`)
    }
    imp.onclick = () => {
        const f = el('input'); f.type = 'file'; f.accept = '.json,application/json'
        f.onchange = async () => {
            const file = f.files?.[0]
            if (!file) return
            try {
                const r = await library.importLibrary(await file.text())
                say(`imported ${r.added} item${r.added === 1 ? '' : 's'}${r.skipped.length ? `; skipped ${r.skipped.map(s => `${s.name} (${s.why})`).join(', ')}` : ''}`)
            } catch (e) { say(`library: ${e.message}`) }
        }
        f.click()
    }

    refresh()
    const note = text => { noteEl.textContent = text || ''; noteEl.hidden = !text }
    return { refresh, focus: () => q.focus(), get items() { return items }, setView, note }
}
