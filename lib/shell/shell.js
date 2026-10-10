//======================================================================================================================
// THE APPLICATION SHELL -- a menu bar, a docking area and a status bar, made from registries.
//
//   const S = createShell(document.body, { title: 'ShadyTracer', menus: ['File', 'Edit', 'View', 'Window', 'Help'],
//                                          storageKey: 'raytracer.layout' })
//   const el = S.panel({ id: 'viewport', title: 'Viewport', module: 'renderer', renderer: 'always', popout: false })
//   S.command({ id: 'file.save', menu: 'File', label: 'Save all scenes', keys: 'Ctrl S', run: save })
//   S.layout.setDefault(dock => { S.open('viewport'); S.open('tree', { referencePanel: 'viewport', direction: 'left' }, { width: 300 }) })
//   S.layout.restore()                     // the user's last arrangement, or the default
//
// WHY A DOCK. The application is several things at once -- a scene being built, a picture, a trace,
// charts of what it measured -- and which of them matter depends on the stage of the work. One long
// menu of folders made every one of them cost space all the time. Here each is a panel the user can
// place, stack, float, pop out to another monitor, or close (roadmap/UI_PLAN.md).
//
// WHY PANELS KEEP THEIR ELEMENT. A panel's content is made ONCE, by its owner, when it registers --
// a property table, a canvas, a chart -- and the dock only ever moves that element around. Closing a
// panel detaches it; opening it again puts back the same element with its state. So an owner never
// has to rebuild anything because the user rearranged the window, and code written for a fixed page
// (the renderer's settings, the optics page) runs unchanged in a panel.
//
// WHAT IT KNOWS: nothing about the application. The docking is dockview (lib/dockview, MIT), loaded
// with a script tag before this module, as `globalThis.dockview`.
//======================================================================================================================
import { makeRegistries, MODULE_LABELS } from './registry.js'
import { flyout } from './menu.js'

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }

/* How far a job is, 0..1, or null when it only says it is working: its own `fraction` when it gives one (a count
   would be wrong there -- "634 of 1000" of a compile counted in nothing), else done of total */
const jobFraction = ({ done = 0, total = 0, fraction } = {}) =>
    Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : total > 0 ? Math.min(1, done / total) : null

/**
 * A PANEL THAT CANNOT BE USED FOR A WHILE, said over it: the panel dimmed, a card in its middle with what it
 * waits on, a bar (a count, or a running slice without one) and the seconds since it began. The status bar's
 * job alone was too easy to miss while the viewport sat frozen through a compile (the user, 2026-09-28).
 *   const busy = busyOverlay(panelElement)
 *   busy({ label, done, total })   shown -- after `delay` ms, so a wait too short to notice never flashes
 *   busy({ label, fraction })      the same with the bar at `fraction` (0..1) and no count: for a job that knows
 *                                  how far it is by the clock rather than by parts (the path tracer's compile)
 *   busy(null)                     gone
 * It takes the pointer while shown: what is under it would not answer anyway.
 */
export function busyOverlay(host, { delay = 250 } = {}) {
    const root = el('div', 'shell-busy'), card = el('div', 'shell-busy-card')
    const text = el('div', 'shell-busy-text'), bar = el('div', 'shell-job-bar shell-busy-bar'), fill = el('i'), secs = el('div', 'shell-busy-secs')
    bar.appendChild(fill); card.append(text, bar, secs); root.appendChild(card)
    let p = null, t0 = 0, timer = 0, tick = 0
    const draw = () => {
        if (!p) return
        const { label = '', done = 0, total = 0, fraction } = p
        const f = jobFraction(p), count = total > 0 && !Number.isFinite(fraction)
        text.textContent = label
        bar.classList.toggle('busy', f == null)
        fill.style.width = f != null ? `${+(100 * f).toFixed(2)}%` : ''
        const s = Math.round((performance.now() - t0) / 1000)
        secs.textContent = `${count ? `${done} of ${total}` : ''}${count && s ? ' · ' : ''}${s ? `${s} s` : ''}`
    }
    return next => {
        if (!next) {
            p = null; clearTimeout(timer); clearInterval(tick); timer = tick = 0
            root.remove()
            return
        }
        if (!p) {
            t0 = performance.now()
            timer = setTimeout(() => { host.appendChild(root); draw(); tick = setInterval(draw, 1000) }, delay)
        }
        p = next
        draw()
    }
}

/**
 * @param host        the element to fill (the page's body, or a box in it)
 * @param title       shown at the right of the menu bar
 * @param menus       the menu bar's menus, in order; a command naming another menu appends it
 * @param storageKey  localStorage key for the arrangement; null keeps nothing
 * @param popoutUrl   a same-origin page for popped-out panels (an empty page linking the styles)
 */
export function createShell(host, { title = '', menus = [], storageKey = null, popoutUrl = 'popout.html' } = {}) {
    const DV = globalThis.dockview
    if (!DV?.createDockview) throw new Error('[shell] load lib/dockview/dockview.min.js (a script tag) before the shell')
    const R = makeRegistries({ menus })
    const elements = new Map()                  // panel id -> its element, made once
    const visibility = new Map()                // panel id -> [fn(visible)]

    //------------------------------------------------------------------------------------------------------------------
    // THE FRAME: menu bar, dock, status bar
    //------------------------------------------------------------------------------------------------------------------
    const root = el('div', 'shell')
    const bar = el('div', 'shell-menubar')
    const menusEl = el('div', 'shell-menus')
    const titleEl = el('span', 'shell-title', title)
    const presetsEl = el('div', 'shell-presets')
    bar.append(menusEl, el('span', 'shell-spacer'), presetsEl, titleEl)
    const dockEl = el('div', 'shell-dock dockview-theme-dark')
    const status = el('div', 'shell-status')
    const statusLeft = el('span', 'shell-status-left'), statusRight = el('span', 'shell-status-right')
    const statusJobs = el('span', 'shell-status-jobs')
    status.append(statusLeft, el('span', 'shell-spacer'), statusJobs, statusRight)
    root.append(bar, dockEl, status)
    host.appendChild(root)

    //------------------------------------------------------------------------------------------------------------------
    // THE DOCK
    //------------------------------------------------------------------------------------------------------------------
    const popoutPath = new URL(popoutUrl, location.href).pathname
    const say = t => { statusLeft.textContent = t; statusLeft.title = t }
    /* JOBS IN THE STATUS BAR: a compile that takes half a minute and says nothing looks like a hang (the
       user, 2026-09-28). One bar per key, with its label, how far (when there is a total) and the seconds
       since it began, ticking, so even a count that sits still shows the page is alive. */
    const jobs = new Map()
    const progress = (key, p) => {
        let J = jobs.get(key)
        if (!p) { if (J) { clearInterval(J.timer); J.el.remove(); jobs.delete(key) } return }
        if (!J) {
            J = { el: el('span', 'shell-job'), bar: el('span', 'shell-job-bar'), fill: el('i'), text: el('span'), t0: performance.now() }
            J.bar.appendChild(J.fill); J.el.append(J.text, J.bar)
            statusJobs.appendChild(J.el)
            J.timer = setInterval(() => J.show(), 1000)
            jobs.set(key, J)
        }
        J.p = p
        J.show = () => {
            const { label = '', done = 0, total = 0, fraction } = J.p
            const f = jobFraction(J.p), count = total && !Number.isFinite(fraction)
            const secs = Math.round((performance.now() - J.t0) / 1000)
            J.text.textContent = `${label}${count ? ` ${done}/${total}` : ''}${secs ? ` · ${secs} s` : ''}`
            J.bar.classList.toggle('busy', f == null)
            J.fill.style.width = f != null ? `${+(100 * f).toFixed(2)}%` : ''
        }
        J.show()
    }
    const dock = DV.createDockview(dockEl, {
        theme: DV.themeDark,
        popoutUrl: popoutPath,
        createComponent: ({ name }) => {
            const e = elements.get(name) ?? el('div', 'shell-missing', `No panel called '${name}'.`)
            return { element: e, init: () => { } }
        },
        /* EVERY GROUP'S HEADER: float, pop out to its own window, maximise. Pop-out is refused for a
           group holding a panel that cannot leave the page (the renderer's view: a WebGPU canvas
           belongs to the document that made it, and moving it to another window is untested). */
        createRightHeaderActionComponent: group => {
            const box = el('div', 'shell-gact')
            const b = (glyph, tip, run) => { const x = el('button', '', glyph); x.title = tip; x.onclick = run; box.appendChild(x); return x }
            let api = null
            const stuck = () => group.panels.map(p => R.panels.get(p.id)).find(d => d && d.popout === false)
            b('⧉', 'Float', () => api?.addFloatingGroup(group, { width: 560, height: 420 }))
            const pop = b('⇱', 'Pop out to its own window (another monitor)', () => {
                const s = stuck()
                if (s) return say(`${s.title} cannot be popped out yet: it stays in this window. Move the other panels out of its group first.`)
                api?.addPopoutGroup(group, { popoutUrl: popoutPath })
            })
            pop.onmouseenter = () => { const s = stuck(); pop.title = s ? `${s.title} cannot be popped out yet` : 'Pop out to its own window (another monitor)' }
            b('⤢', 'Maximise (again to restore)', () => (group.api.isMaximized() ? group.api.exitMaximized() : group.api.maximize()))
            return { element: box, init: ({ containerApi }) => { api = containerApi }, dispose: () => { } }
        },
    })

    /* THE MODULE ON EVERY TAB: whose panel it is -- the renderer's, the optics module's, the
       application's. The split between them is the point of the layout, so it is shown -- as a dot in
       the module's colour, its name and the panel's help in the tooltip. It was a word ("RENDER") on
       every tab; the user's rule is icons over text, and the colour alone tells them apart. */
    const byTitle = () => new Map([...R.panels.values()].map(p => [p.title, p]))
    const markTabs = () => requestAnimationFrame(() => {
        const titles = byTitle()
        for (const doc of [document, ...popoutDocs()]) for (const t of doc.querySelectorAll('.dv-tab')) {
            const content = t.querySelector('.dv-default-tab-content') ?? t
            if (content.querySelector('.shell-mod')) continue
            const p = titles.get(content.textContent.trim())
            if (!p) continue
            // a panel that must stay (the renderer's view) has no close button on its tab
            if (p.closable === false) t.querySelector('.dv-default-tab-action')?.style.setProperty('display', 'none')
            const m = el('span', `shell-mod shell-mod-${p.module}`)
            m.title = [MODULE_LABELS[p.module] ?? p.module, p.help].filter(Boolean).join(': ')
            content.prepend(m)
        }
    })
    const popoutDocs = () => { try { return dock.groups.map(g => g.element?.ownerDocument).filter(d => d && d !== document) } catch { return [] } }

    /* VISIBILITY, for owners that draw only while seen (a chart). Wired to every panel as it is
       added -- by open(), and by a restored layout, which adds them itself. */
    const tell = (id, v) => { for (const f of visibility.get(id) ?? []) { try { f(v) } catch (e) { console.error(`[shell] ${id}:`, e) } } }
    dock.onDidAddPanel(p => {
        const def = R.panels.get(p.id)
        if (def?.renderer && p.api.renderer !== def.renderer) { try { p.api.setRenderer(def.renderer) } catch { } }
        /* a saved layout carries each tab's title as it was when saved: a panel renamed since (Renderer became Render
           settings, 0.57.0) would keep its old name, and markTabs, which finds a panel by its title, would miss it */
        if (def && p.title !== def.title) { try { p.api.setTitle(def.title) } catch { } }
        p.api.onDidVisibilityChange(e => tell(p.id, e.isVisible))
        tell(p.id, p.api.isVisible)
        markTabs()
    })
    dock.onDidRemovePanel(p => tell(p.id, false))

    //------------------------------------------------------------------------------------------------------------------
    // PANELS
    //------------------------------------------------------------------------------------------------------------------
    /** Register a panel and get its element, to fill once. `renderer: 'always'` keeps the element in
     *  the page while another tab covers it (a canvas that must not be detached); `popout: false`
     *  keeps it in this window; `closable: false` hides its close button. */
    const panel = def => {
        const p = R.panel(def)
        const e = def.element ?? el('div')
        e.classList.add('shell-panel')
        e.dataset.panel = p.id
        elements.set(p.id, e)
        return e
    }
    const isOpen = id => !!dock.getPanel(id)
    /** Open a panel, or bring it to the front when it is open. `position` as dockview's
     *  ({ referencePanel, direction } or { direction }); `size` { width } or { height } for its group;
     *  `floating` { width, height } opens it as a floating group instead (a dialog-like panel). */
    const open = (id, position, size, { floating } = {}) => {
        const def = R.panels.get(id)
        if (!def) throw new Error(`[shell] no panel '${id}'`)
        const existing = dock.getPanel(id)
        if (existing) { existing.api.setActive(); return existing }
        const where = position && (!position.referencePanel || dock.getPanel(position.referencePanel)) ? position : undefined
        const p = dock.addPanel({ id, component: id, title: def.title, ...(floating ? { floating } : where ? { position: where } : {}),
                                  ...(def.renderer ? { renderer: def.renderer } : {}), ...(def.inactive ? { inactive: true } : {}) })
        if (size) { try { p.group.api.setSize(size) } catch { } }
        markTabs()
        return p
    }
    const close = id => dock.getPanel(id)?.api.close()
    /** Let go of a panel registered at run time (a chart the user added, then removed): closed if open,
     *  its element, its listeners and its View entry gone, its id free to be registered again. A saved
     *  layout that still names it leaves it out, as it does any panel not registered. */
    const forget = id => {
        close(id)
        R.dropPanel(id)
        R.dropCommand(`view.${id}`)
        elements.delete(id)
        visibility.delete(id)
        markTabs()
    }
    /** Be told when a panel is seen or hidden -- and, a frame later, whether it is seen NOW: a panel
     *  the restored layout already shows would otherwise never say so to an owner registering after
     *  the restore (the optics charts). A frame later, not at once: the owner is usually still being
     *  set up when it asks, and its draw function may not exist yet. */
    const onVisible = (id, fn) => {
        if (!visibility.has(id)) visibility.set(id, [])
        visibility.get(id).push(fn)
        requestAnimationFrame(() => { const p = dock.getPanel(id); if (p?.api.isVisible) { try { fn(true) } catch (e) { console.error(`[shell] ${id}:`, e) } } })
    }

    //------------------------------------------------------------------------------------------------------------------
    // THE LAYOUT: the user's own, kept; a default to fall back on and to reset to
    //------------------------------------------------------------------------------------------------------------------
    let makeDefault = () => { for (const id of R.panels.keys()) open(id) }
    let onApply = () => { }
    /* POPPED-OUT WINDOWS ARE NOT SAVED. Reopening one at load is a window.open the browser was not
       asked for by a click, and popup blockers refuse it; its panels would be lost with it. Saved
       without them, they are simply closed next time -- the View menu opens them again. */
    const save = () => {
        if (!storageKey) return
        try {
            const j = dock.toJSON()
            if (j.popoutGroups?.length) {
                // a window of one group saves it as `data`, of several as a nested `grid`: every
                // `views` list anywhere inside names a panel that was in it
                const viewsIn = o => !o || typeof o !== 'object' ? [] : [...(Array.isArray(o.views) ? o.views : []), ...Object.values(o).flatMap(viewsIn)]
                const gone = new Set(j.popoutGroups.flatMap(viewsIn))
                j.popoutGroups = []
                for (const id of gone) delete j.panels[id]
            }
            localStorage.setItem(storageKey, JSON.stringify(j))
        } catch { }
    }
    let saving = 0
    dock.onDidLayoutChange(() => { markTabs(); if (!saving) saving = setTimeout(() => { saving = 0; save() }, 400) })
    /* PRESETS: layouts made by the application for a stage of the work (Design, Analyse, Render), and
       layouts the user saved. Applying one replaces the arrangement; the user can change it from there,
       and that change is what is kept between visits -- a preset is where to start, not a mode. */
    const presets = new Map()                   // name -> { build, help }
    const customKey = storageKey ? `${storageKey}.saved` : null
    const customs = () => { try { return customKey ? JSON.parse(localStorage.getItem(customKey)) ?? {} : {} } catch { return {} } }
    let current = null
    const drawPresets = () => {
        presetsEl.innerHTML = ''
        const names = [...presets.keys(), ...Object.keys(customs())]
        for (const n of names) {
            const b = el('button', `shell-preset${n === current ? ' on' : ''}`, n)
            b.title = presets.get(n)?.help || 'A layout you saved (View > Delete a saved layout… removes it)'
            b.onclick = () => layout.apply(n)
            presetsEl.appendChild(b)
        }
        if (customKey) {
            const add = el('button', 'shell-preset', '＋')
            add.title = 'Save this arrangement as a layout of your own'
            add.onclick = () => layout.saveAs()
            presetsEl.appendChild(add)
        }
    }
    const layout = {
        setDefault: fn => { makeDefault = () => fn(dock) },
        reset: () => { dock.clear(); makeDefault(); current = null; drawPresets(); save() },
        /** A layout for a stage of the work: `build(dock)` opens its panels, as setDefault's does. */
        preset: (name, build, help = '') => { presets.set(name, { build, help }); drawPresets() },
        /** Replace the arrangement with a preset, or with a layout the user saved. */
        apply: name => {
            const p = presets.get(name), saved = customs()[name]
            if (!p && !saved) return false
            dock.clear()
            if (p) p.build(dock)
            else {
                try {
                    for (const id of Object.keys(saved.panels ?? {})) if (!R.panels.has(id)) delete saved.panels[id]
                    dock.fromJSON(saved)
                } catch (e) { console.warn(`[shell] the layout '${name}' did not load:`, e); makeDefault() }
            }
            current = name
            drawPresets()
            onApply(name)
            save()
            return true
        },
        /** Keep the current arrangement under a name (asked for when not given). */
        saveAs: (name = window.prompt('Name this layout:', `My layout ${Object.keys(customs()).length + 1}`)) => {
            if (!name || !customKey) return
            try {
                const all = customs()
                const j = dock.toJSON()
                j.popoutGroups = []
                all[name] = j
                localStorage.setItem(customKey, JSON.stringify(all))
            } catch (e) { say(`The layout could not be saved: ${e.message}`); return }
            current = name
            drawPresets()
            say(`Layout '${name}' saved`)
        },
        remove: name => {
            const all = customs()
            if (!(name in all)) return false
            delete all[name]
            try { localStorage.setItem(customKey, JSON.stringify(all)) } catch { }
            if (current === name) current = null
            drawPresets()
            return true
        },
        names: () => [...presets.keys(), ...Object.keys(customs())],
        /** Called after a layout is applied, with its name: the host puts back what must always be open. */
        onApply: fn => { onApply = fn },
        /** The last arrangement, or the default when there is none or it will not load (a panel it
         *  names that no longer exists is simply left out). */
        restore: () => {
            let j = null
            try { j = storageKey ? JSON.parse(localStorage.getItem(storageKey)) : null } catch { }
            if (j) {
                try {
                    for (const id of Object.keys(j.panels ?? {})) if (!R.panels.has(id)) delete j.panels[id]
                    dock.fromJSON(j)
                    if (dock.panels.length) return 'restored'
                } catch (e) { console.warn('[shell] the saved layout did not load, using the default:', e) }
                dock.clear()
            }
            makeDefault()
            return 'default'
        },
    }

    //------------------------------------------------------------------------------------------------------------------
    // THE MENU BAR, made from the commands each time a menu opens -- so a command registered late,
    // or one whose `when` has changed, is always shown as it is now
    //------------------------------------------------------------------------------------------------------------------
    let openMenu = null, sub = null
    const closeSub = () => { sub?.close(); sub = null }
    const closeMenus = () => { closeSub(); openMenu?.remove(); openMenu = null; for (const b of menusEl.children) b.classList.remove('on') }
    const buildMenus = () => {
        menusEl.innerHTML = ''
        for (const name of R.menus()) {
            const b = el('button', 'shell-menu', name)
            b.onmousedown = e => {
                e.preventDefault()
                const was = b.classList.contains('on')
                closeMenus()
                if (!was) showMenu(name, b)
            }
            // moving along the bar with a menu open switches to the menu under the pointer
            b.onmouseenter = () => { if (openMenu && !b.classList.contains('on')) { closeMenus(); showMenu(name, b) } }
            menusEl.appendChild(b)
        }
    }
    const showMenu = (name, b) => {
        const m = R.menuModel().find(x => x.name === name)
        if (!m) return
        const d = el('div', 'shell-dropdown')
        for (const it of m.items) {
            if (it.separator) { d.appendChild(el('hr')); continue }
            const c = it.command
            const row = el('div', c.items ? 'shell-item shell-item-sub' : 'shell-item')
            const enabled = (() => { try { return c.when() !== false } catch { return false } })()
            row.append(el('span', 'shell-label', c.label), el('kbd', '', c.items ? '▸' : c.keys))
            if (c.help) row.title = c.help
            if (!enabled) { row.classList.add('off'); row.onmouseenter = closeSub }
            else if (c.items) {
                /* A SUBMENU ROW (registry.js `items`): its entries asked for now, beside it (menu.js flyout, the
                   look of every other submenu); an entry that throws is said, as a command that throws is */
                const show = () => {
                    if (sub?.row === row) return
                    closeSub()
                    let entries = []
                    try { entries = c.items() || [] } catch (e) { console.error(`[shell] ${c.id}:`, e); say(`${c.label} failed: ${e.message}`) }
                    if (!entries.length) entries = [{ label: 'nothing', off: true }]
                    const wrap = entries.map(x => x.run ? { ...x, run: () => { try { x.run() } catch (e) { console.error(`[shell] ${c.id}:`, e); say(`${x.label} failed: ${e.message}`) } } } : x)
                    sub = { row, ...flyout(row, wrap, { onChoose: closeMenus }) }
                }
                row.onmouseenter = show
                row.onmouseup = show
            } else {
                row.onmouseenter = closeSub
                row.onmouseup = () => { closeMenus(); try { c.run() } catch (e) { console.error(`[shell] ${c.id}:`, e); say(`${c.label} failed: ${e.message}`) } }
            }
            d.appendChild(row)
        }
        const r = b.getBoundingClientRect()
        Object.assign(d.style, { left: `${r.left}px`, top: `${r.bottom}px` })
        document.body.appendChild(d)
        openMenu = d
        b.classList.add('on')
    }
    window.addEventListener('mousedown', e => { if (openMenu && !openMenu.contains(e.target) && !menusEl.contains(e.target) && !sub?.contains(e.target)) closeMenus() }, true)
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && openMenu) { e.preventDefault(); closeMenus() } }, true)

    const command = def => { const c = R.command(def); buildMenus(); return c }

    /* THE COMMAND PALETTE (Ctrl K, or Ctrl Shift P): every command by name -- the menus' and the View
       entries, so a panel opens by typing its name. For the user who knows what they want and not
       where it is. Only enabled commands are offered.
       AND WHATEVER ELSE AN OWNER SEARCHES (searchIn): the application's parameters, found by name and
       set by "name = value". Each source answers a query with rows { label, where, run }; the
       commands come first, since a person typing a verb means the verb. */
    const sources = []
    const palEl = el('div', 'shell-palette')
    const palBox = el('div', 'shell-palette-box')
    const palIn = el('input')
    palIn.placeholder = 'Type a command, a panel or a setting…'
    const palList = el('div', 'shell-palette-list')
    palBox.append(palIn, palList)
    palEl.appendChild(palBox)
    palEl.hidden = true
    root.appendChild(palEl)
    let palItems = [], palSel = 0
    const palDraw = () => {
        const on = c => { try { return c.when() !== false } catch { return false } }
        const q = palIn.value
        palItems = R.find(q).filter(on).slice(0, 14)
            .map(c => ({ label: c.label, where: `${c.menu ?? ''}${c.keys ? ' · ' + c.keys : ''}`, run: c.run, id: c.id }))
        for (const src of sources) {
            if (palItems.length >= 20) break
            let rows = []
            try { rows = src(q) || [] } catch (e) { console.error('[shell] a palette source failed:', e) }
            palItems.push(...rows.slice(0, 20 - palItems.length))
        }
        palSel = Math.min(palSel, Math.max(0, palItems.length - 1))
        palList.innerHTML = ''
        palItems.forEach((c, i) => {
            const row = el('div', `shell-palette-item${i === palSel ? ' on' : ''}`)
            row.append(el('span', '', c.label), el('span', 'shell-palette-where', c.where ?? ''))
            row.onmousedown = e => { e.preventDefault(); palRun(i) }
            palList.appendChild(row)
        })
        if (!palItems.length) palList.appendChild(el('div', 'shell-palette-item none', 'Nothing matches.'))
    }
    const palRun = i => { const c = palItems[i]; palClose(); if (c) { try { c.run() } catch (e) { console.error(`[shell] ${c.id ?? c.label}:`, e); say(`${c.label} failed: ${e.message}`) } } }
    const palClose = () => { palEl.hidden = true }
    const palette = (q = '') => { closeMenus(); palEl.hidden = false; palIn.value = q; palSel = 0; palDraw(); palIn.focus() }
    palIn.oninput = () => { palSel = 0; palDraw() }
    palIn.onkeydown = e => {
        if (e.key === 'Escape') { e.preventDefault(); palClose() }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            palSel = (palSel + (e.key === 'ArrowDown' ? 1 : palItems.length - 1)) % Math.max(1, palItems.length)
            palDraw()
        } else if (e.key === 'Enter') { e.preventDefault(); palRun(palSel) }
    }
    palEl.onmousedown = e => { if (e.target === palEl) palClose() }
    window.addEventListener('keydown', e => {
        const k = e.key.toLowerCase()
        if ((e.ctrlKey || e.metaKey) && (k === 'k' || (e.shiftKey && k === 'p'))) { e.preventDefault(); palEl.hidden ? palette() : palClose() }
    }, true)

    /* THE COMMANDS EVERY APPLICATION OF THIS SHELL HAS: a View entry per panel, the window verbs. A panel
       registered with `menu: false` has none (one another menu opens: the raytracer's Save picture is
       File's); one the owner registered `view.<id>` for itself keeps the owner's (opened its own way). */
    const standard = () => {
        for (const p of R.panels.values()) if (p.menu !== false && !R.commands.has(`view.${p.id}`))
            R.command({ id: `view.${p.id}`, menu: 'View', group: `panels.${p.module}`, label: p.title, help: p.help, run: () => open(p.id, p.position, p.size) })
        const active = () => dock.activePanel
        const add = def => { if (!R.commands.has(def.id)) R.command(def) }
        for (const n of presets.keys()) add({ id: `view.layout.${n}`, menu: 'View', group: 'layout', label: `Layout: ${n}`, help: presets.get(n).help, run: () => layout.apply(n) })
        add({ id: 'view.saveLayout', menu: 'View', group: 'layout', label: 'Save this layout as…', run: () => layout.saveAs() })
        add({ id: 'view.deleteLayout', menu: 'View', group: 'layout', label: 'Delete a saved layout…', when: () => Object.keys(customs()).length > 0,
              run: () => { const n = window.prompt(`Delete which layout? (${Object.keys(customs()).join(', ')})`); if (n && !layout.remove(n)) say(`No saved layout called '${n}'`) } })
        add({ id: 'view.reset', menu: 'View', group: 'layout', label: 'Reset the layout', run: layout.reset })
        add({ id: 'help.palette', menu: 'Help', group: 'find', label: 'Find a command…', keys: 'Ctrl K', run: () => palette() })
        add({ id: 'window.float', menu: 'Window', label: 'Float the active panel', when: () => !!active(), run: () => dock.addFloatingGroup(active().group, { width: 560, height: 420 }) })
        add({ id: 'window.popout', menu: 'Window', label: 'Pop out the active panel', when: () => !!active() && R.panels.get(active().id)?.popout !== false,
              run: () => dock.addPopoutGroup(active().group, { popoutUrl: popoutPath }) })
        add({ id: 'window.maximize', menu: 'Window', label: 'Maximise the active panel', when: () => !!active(),
              run: () => { const g = active().group.api; g.isMaximized() ? g.exitMaximized() : g.maximize() } })
        add({ id: 'window.close', menu: 'Window', label: 'Close the active panel', when: () => !!active() && R.panels.get(active().id)?.closable !== false, run: () => active().api.close() })
        buildMenus()
    }

    buildMenus()
    return {
        root, dock, registries: R,
        panel, open, close, isOpen, onVisible, forget,
        command, layout, palette,
        /** Another thing the palette searches: fn(query) -> [{ label, where, run }], after the commands. */
        searchIn: fn => { sources.push(fn); return () => sources.splice(sources.indexOf(fn), 1) },
        /** Add the View entries for every registered panel and the window commands; call once the
         *  panels are registered (a later panel can call it again). */
        standardCommands: standard,
        /** The status bar: a line of text at the left, an element of the owner's at the right. */
        status: say,
        statusRight: e => { statusRight.innerHTML = ''; if (e) statusRight.appendChild(e) },
        /** A job's bar in the status bar: progress(key, { label, done, total }) shows or moves it -- with no
         *  total it only says it is working; with `fraction` (0..1) instead, the bar is at that and no count is
         *  shown -- and progress(key, null) takes it away. */
        progress,
    }
}
