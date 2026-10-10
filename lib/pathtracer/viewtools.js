//======================================================================================================================
// THE VIEW'S OWN TOOLBAR -- the controls that belong to a view of the scene, on the view.
//
//   const V = installViewToolbar(stage, { PropertyTable, RT, tips: { 1: '...' } })
//   RT.installUI(null, { sections: { ...V.sections, ... }, untitled: V.untitled, omit: V.omit })
//   V.refresh()        // after a setting changed, so the buttons say what the view is doing
//   V.open('Camera')   // show one popover (Camera | Show | Exposure): a host pointing at a setting
//   V.bar              // the strip at the top left: a host may add buttons of its own after the renderer's
//   V.popover(key, icon, tip)  // ...and popovers of its own, closed with the rest: { btn, el, table }
//   V.analyse.add(key, label, ...els)   // a group of the analysis drawer (bottom right): the host's buttons
//   V.analyse.mark(key, { icon } | { text } | null)  // what of it is on, shown on the drawer's button when closed
//   V.analyse.note(key, text | null)    // a line under a group, only when something there needs saying
//
// WHAT BELONGS HERE (roadmap/UI_PLAN.md, section 8: a control lives with what it changes):
// the camera, what the view shows -- the photographic picture, the lux on its surfaces, its luminance --
// and how that is exposed or scaled. Those change THIS view. The sun and sky change the scene, and
// sampling changes how hard the renderer works: they are panels of the host's, not buttons here.
//
// MINIMAL, AND NOTHING SAID TWICE (the user, 2026-09-27): icons with tooltips, no words, no popover repeating its
// button's name. TWO PLACES (the user, 2026-10-02: the controls "need to be grouped better"):
//   TOP LEFT, THE PICTURE   ⌖▾ camera and ◐▾ exposure, menus (a caret: they open a popover), then ( ⚡ ), the
//                           fast preview, a switch in a pill of its own -- Draft, Sketch or Optics (quality.js) and back,
//                           lit while on; which fast mode is the Renderer panel's Quality. Exposure and the fast
//                           preview only in the photographic view: a false colour is neither exposed nor previewed
//                           (quality.js effective traces it in full). A host's switches follow (the boxes).
//   BOTTOM RIGHT, ANALYSE   one button opening a drawer of labelled groups: DISPLAY -- ( ▣ ☀ ◉ ) the three views,
//                           the lit one is the view, and ▤▾ the false-colour range in the false-colour views --
//                           and the host's: MEASURE (measure/tool.js) and RAYS (the raytracer's optics). Closing
//                           the drawer only hides the buttons: what is on stays on (a lux view, pins, rays), and
//                           the drawer's button says so, a badge each -- nothing is on that cannot be seen to be
//                           (the user chose this, 2026-10-02, over an analysis on/off and over one panel).
// The mode is NOT in any popover (V.omit keeps installUI from adding it). A popover whose button is in the lower
// half of the view opens upwards. Each holds a property table the renderer fills with the folder it used to put
// on its View page (installUI's `sections`), flat (V.untitled: no folder title repeating the button's name).
//======================================================================================================================

import { iconBar, iconButton, iconPill, menuButton, icon, lit } from './icons.js'

/* THE FAST MODES BY renderMode (quality.js MODE), as the ⚡ button's tooltip names them: the word before the
   comma when it is off */
const FAST_NAMES = { 1: 'Draft, direct light only', 2: 'Sketch, a fixed light without shadows',
                     3: 'Optics, the lights\' rays over a flat light' }

const MODES = [
    { icon: 'photo', tip: 'Photographic' },
    { icon: 'lux', tip: 'Lux on surfaces (false colour)' },
    { icon: 'eye', tip: 'Luminance, cd/m² (false colour)' },
]
const UNIT = ['', 'lx', 'cd/m²']
const POP = { position: 'absolute', zIndex: '13', width: '300px', maxHeight: 'calc(100% - 56px)', overflow: 'auto',
              background: 'rgba(22,25,28,0.96)', border: '1px solid rgba(160,175,190,0.25)', borderRadius: '6px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)', display: 'none', padding: '2px 0' }

// the analysis drawer: open or not, per browser; its groups in this order, a host's after
const DRAWER_KEY = 'pathtracer.view.analyse'
const ORDER = { display: 0, measure: 1, rays: 2 }
const CAPTION = { font: '9px/1 Arial, sans-serif', letterSpacing: '0.07em', textTransform: 'uppercase', color: '#8a949d', paddingLeft: '2px' }

const num = v => Math.abs(v) >= 1e4 ? Math.round(v).toLocaleString('en').replace(/,/g, ' ') : +(+v).toPrecision(3) + ''

/**
 * @param stage          the view's element (positioned): the toolbar and its popovers go in it
 * @param PropertyTable  the property table class (passed in: this file imports no UI of its own)
 * @param RT             the renderer: RT.get() for the state the buttons show, RT.set() to switch the
 *                       mode, RT.autoEV
 * @param tips           optional { [mode]: text } -- a host's line added to a mode's tooltip (the
 *                       raytracer says there where its detector map is)
 * @returns { sections: { Camera, Show, Exposure }, untitled, omit, refresh(), open(key), bar, close() }
 */
export function installViewToolbar(stage, { PropertyTable, RT, tips = {} } = {}) {
    const bar = iconBar({ position: 'absolute', left: '8px', top: '8px', zIndex: '12', gap: '6px' })
    stage.appendChild(bar)
    /* THE ANALYSE DOCK, bottom right: the drawer of groups, hidden when closed, then its button */
    const dock = document.createElement('div')
    Object.assign(dock.style, { position: 'absolute', right: '8px', bottom: '8px', zIndex: '12', display: 'flex',
        alignItems: 'flex-end', gap: '6px', maxWidth: 'calc(100% - 16px)' })
    // in a narrow view its groups wrap onto rows rather than run off the picture's left edge
    const drawer = iconBar({ gap: '8px 12px', alignItems: 'flex-end', padding: '4px 6px', flexWrap: 'wrap', justifyContent: 'flex-end', minWidth: '0' })
    const masterBar = iconBar()
    const master = iconButton('analyse', '', e => { e.stopPropagation(); setDrawer(!drawerOpen) })
    const badges = document.createElement('span')
    Object.assign(badges.style, { display: 'none', alignItems: 'center', gap: '4px', padding: '0 6px 0 2px', color: '#ffcc33',
        font: '11px Arial, sans-serif', cursor: 'pointer' })
    badges.onclick = e => { e.stopPropagation(); setDrawer(true) }
    masterBar.append(master, badges)
    dock.append(drawer, masterBar)
    stage.appendChild(dock)

    const pops = []
    const close = () => { for (const p of pops) { p.el.style.display = 'none'; lit(p.btn, false) } }

    const popover = (key, iconName, tip) => {
        const btn = menuButton(iconName, tip)
        const el = document.createElement('div')
        Object.assign(el.style, POP)
        stage.appendChild(el)
        const table = new PropertyTable({ container: el })
        Object.assign(table.element.style, { fontSize: '13px', width: '100%' })
        const p = { key, btn, el, table }
        btn.onclick = e => {
            e.stopPropagation()
            const open = el.style.display !== 'none'
            close()
            if (open) return
            const r = btn.getBoundingClientRect(), s = stage.getBoundingClientRect()
            // a button in the lower half -- the drawer's -- opens its popover upwards, over the picture
            const up = r.top - s.top > s.height / 2
            Object.assign(el.style, { display: 'block', left: `${Math.max(8, Math.min(r.left - s.left, s.width - 308))}px`,
                                      top: up ? '' : `${r.bottom - s.top + 6}px`, bottom: up ? `${s.bottom - r.top + 6}px` : '' })
            lit(btn, true)
            // a pane laid out while hidden comes back with zero-width controls: nudge it once seen
            try { table.refresh?.() } catch { }
        }
        pops.push(p)
        return p
    }

    /* THE DRAWER'S GROUPS: a caption over a row, in ORDER; and what of each is on, for the button while closed */
    const groups = new Map()
    const group = (key, label) => {
        if (groups.has(key)) return groups.get(key).row
        const col = document.createElement('div')
        Object.assign(col.style, { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '3px' })
        const cap = document.createElement('div')
        cap.textContent = label
        Object.assign(cap.style, CAPTION)
        const row = document.createElement('div')
        Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '4px' })
        /* A NOTE, under the row: none unless the host has something it must say -- the rays that cannot be traced,
           and why (the user, 2026-10-03: the rays showed nothing for a light the trace had skipped, and nothing in
           the view said so). Words, against "icons with tooltips": an empty picture is not something a tooltip
           nobody hovers over can explain. */
        const note = document.createElement('div')
        Object.assign(note.style, { display: 'none', maxWidth: '260px', font: '11px/1.3 Arial, sans-serif', color: '#ffcc33',
            whiteSpace: 'pre-wrap', paddingLeft: '2px' })
        col.append(cap, row, note)
        groups.set(key, { col, row, note, order: ORDER[key] ?? 9 })
        drawer.replaceChildren(...[...groups.values()].sort((a, b) => a.order - b.order).map(g => g.col))
        return row
    }
    const marks = new Map()
    const paintBadges = () => {
        const on = [...marks.entries()].sort(([a], [b]) => (ORDER[a] ?? 9) - (ORDER[b] ?? 9))
        badges.replaceChildren(...on.map(([, w]) => {
            if (w.icon) return icon(w.icon, 13)
            const t = document.createElement('span'); t.textContent = w.text; return t
        }))
        badges.style.display = !drawerOpen && on.length ? 'inline-flex' : 'none'
        master.title = (drawerOpen ? 'Analyse: close (what is on stays on)' : 'Analyse: what the view shows, measuring, rays')
            + (on.length ? `\nOn: ${on.map(([, w]) => w.tip).join(', ')}` : '')
    }
    const mark = (key, what) => { if (what) marks.set(key, what); else marks.delete(key); paintBadges() }
    let drawerOpen = false
    try { drawerOpen = localStorage.getItem(DRAWER_KEY) === 'open' } catch { }
    const setDrawer = on => {
        drawerOpen = on
        try { localStorage.setItem(DRAWER_KEY, on ? 'open' : 'closed') } catch { }
        drawer.style.display = on ? 'flex' : 'none'
        lit(master, on)
        if (!on) for (const p of pops) if (drawer.contains(p.btn) && p.el.style.display !== 'none') close()
        paintBadges()
    }

    /* THE PICTURE, top left: the camera and the exposure (menus), the fast preview (a switch) */
    const cam = popover('Camera', 'camera', 'Camera')
    const expo = popover('Exposure', 'exposure', 'Exposure')
    /* THE FAST PREVIEW: renderMode between full and the last fast mode used, Draft until Sketch or
       Optics has been. A setting like any other (RT.set), so the Quality row and the HUD follow it. */
    let lastFast = 1
    const fast = iconButton('bolt', '', e => {
        e.stopPropagation()
        close()
        let m = 0
        try { m = RT.get().renderMode | 0 } catch { }
        try { RT.set({ renderMode: m ? 0 : lastFast }) } catch (err) { console.error('[view] could not switch the fast preview:', err) }
        refresh()
    })
    const fastPill = iconPill(fast)
    bar.append(cam.btn, expo.btn, fastPill)

    /* DISPLAY, the drawer's first group ("Shows" until the user renamed it, 2026-10-02): one icon per mode, the lit
       one is the view; the false-colour range */
    const modeBtns = MODES.map((m, i) => iconButton(m.icon, m.tip + (tips[i] ? `\n${tips[i]}` : ''), e => {
        e.stopPropagation()
        close()
        try { RT.set({ measureMode: i }) } catch (err) { console.error('[view] could not switch the view:', err) }
        refresh()
    }))
    const show = popover('Show', 'scale', 'False-colour range')
    group('display', 'Display').append(iconPill(...modeBtns), show.btn)

    /* CLOSING: a press outside the toolbar, the drawer and their popovers -- but not one that starts inside a
       popover, which is a slider being dragged, and a drag that ends outside must not close its own page */
    stage.ownerDocument.addEventListener('pointerdown', e => {
        if (!(pops.some(p => p.el.contains(e.target)) || bar.contains(e.target) || dock.contains(e.target))) close()
    }, true)
    stage.ownerDocument.addEventListener('keydown', e => { if (e.key === 'Escape') close() })

    const refresh = () => {
        let v = {}
        try { v = RT.get() } catch { }
        const mode = v.measureMode | 0
        modeBtns.forEach((b, i) => lit(b, i === mode))
        // exposure does nothing to a false colour, and the range nothing to a photograph: one of the two
        const photo = mode === 0
        expo.btn.style.display = photo ? '' : 'none'
        show.btn.style.display = photo ? 'none' : ''
        if (photo && show.el.style.display !== 'none') close()
        if (!photo && expo.el.style.display !== 'none') close()
        const fm = v.renderMode | 0
        if (fm) lastFast = fm
        lit(fast, fm !== 0)
        fastPill.style.display = photo ? '' : 'none'
        fast.title = fm ? `Fast preview: ${FAST_NAMES[fm] ?? FAST_NAMES[1]}. Click for the full picture.`
            : `Fast preview: ${(FAST_NAMES[lastFast] ?? FAST_NAMES[1]).split(',')[0]} (Renderer panel: Quality). Click to switch it on.`
        const auto = (v.autoExposure | 0) === 1
        const ev = auto ? RT.autoEV : v.exposureEV
        expo.btn.title = `Exposure: EV ${ev == null ? '–' : (+ev).toFixed(1)}${auto ? ', auto' : ''}`
        show.btn.title = `False-colour range: ${num(v.measureMin)} – ${num(v.measureMax)} ${UNIT[mode] ?? ''}, `
            + `${(v.measureBands | 0) ? `${v.measureBands | 0} bands` : 'smooth'}`
        // a false-colour view is on, whether the drawer is open or not: its unit on the drawer's button
        const was = marks.get('display')?.text
        if (was !== (photo ? undefined : UNIT[mode])) mark('display', photo ? null : { text: UNIT[mode], tip: MODES[mode].tip })
    }
    // a change in a popover moves a value a tooltip reports
    for (const p of pops) for (const ev of ['input', 'change', 'click']) p.el.addEventListener(ev, () => requestAnimationFrame(refresh), true)
    setDrawer(drawerOpen)
    refresh()
    // the metered EV moves on its own while auto exposure is on
    setInterval(refresh, 1000)

    /** Show one popover (Camera | Show | Exposure), open or not: for a host that points at a setting. One in the
     *  closed drawer opens the drawer first. */
    const open = key => {
        const p = pops.find(q => q.key === key)
        if (!p) return
        if (drawer.contains(p.btn) && !drawerOpen) setDrawer(true)
        if (p.el.style.display === 'none' && p.btn.style.display !== 'none') p.btn.click()
    }
    return { sections: { Camera: cam.table, Show: show.table, Exposure: expo.table },
             untitled: ['Camera', 'Show', 'Exposure'], omit: ['measureMode'], refresh, open, bar, close,
             /** A popover of the host's (the optics rays' settings), opened by its own button -- which the
              *  host places, in `bar` or in a drawer group -- and closed with the others; its table is the host's. */
             popover: (key, iconName, tip) => popover(key, iconName, tip),
             /** THE ANALYSIS DRAWER: a host's group in it (created on first use, in ORDER), what of it is on
              *  ({ icon } or { text }, and a `tip`, or null) for the drawer's button, and the drawer itself. */
             analyse: {
                 add: (key, label, ...els) => { group(key, label).append(...els) },
                 mark,
                 /** A group's note: `text` under its row (null: none), for what a host must say there. A group that
                  *  is not there yet has none -- add it first. */
                 note: (key, text) => {
                     const g = groups.get(key)
                     if (!g) return
                     g.note.textContent = text ?? ''
                     g.note.title = text ?? ''
                     g.note.style.display = text ? 'block' : 'none'
                 },
                 setOpen: on => setDrawer(!!on),
                 get isOpen() { return drawerOpen },
                 el: dock,
             } }
}
