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
//   TOP LEFT, THE PICTURE   ⌖▾ camera and ◐▾ exposure, menus (a caret: they open a popover), then Draft▾ the
//                           quality, a menu that says the mode in force in a word (the user, 2026-10-11: the one button
//                           here with a word -- five modes cannot be told apart by an icon), and ( ⚡ ) fast while moving,
//                           a switch in a pill of its own: a full picture traced as Draft or Sketch while the camera, a
//                           drag or a live value moves (quality.js effective, interaction.js), lit while on, brighter
//                           while it is doing it. Until 0.59.0 ⚡ flipped the mode itself between full and the last fast
//                           mode seen, which the user found unclear: one of five modes, and a hidden one. Exposure, the
//                           quality and ⚡ only in the photographic view: a false colour is neither exposed nor previewed
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
import { QUALITY_GROUPS, CUSTOM, MODE, MOVE_NAMES, moveModeOf, describe, applyPreset } from './quality.js'

/* THE QUALITY MENU's look: its captions as the drawer's, its choices as small segmented buttons */
const CHOICE = { font: '12px/1 Arial, sans-serif', color: '#b9c4cd', background: 'transparent', border: '0', borderRadius: '4px',
                 padding: '5px 9px', cursor: 'pointer' }
const CHOICE_ON = { background: 'rgba(120,150,175,0.32)', color: '#fff' }
const PRESET_SHORT = Object.fromEntries(QUALITY_GROUPS.flatMap(g => g.presets.map(p => [p.id, p.short])))

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

    /* `content`: an element of the caller's instead of a property table (the quality menu's choices) */
    const popover = (key, iconName, tip, content = null) => {
        const btn = menuButton(iconName, tip)
        const el = document.createElement('div')
        Object.assign(el.style, POP)
        stage.appendChild(el)
        const table = content ? null : new PropertyTable({ container: el })
        if (content) el.appendChild(content)
        else Object.assign(table.element.style, { fontSize: '13px', width: '100%' })
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
            try { table?.refresh?.() } catch { }
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

    /* THE PICTURE, top left: the camera, the exposure and the quality (menus), fast while moving (a switch) */
    const cam = popover('Camera', 'camera', 'Camera')
    const expo = popover('Exposure', 'exposure', 'Exposure')
    /* THE QUALITY MENU (0.59.0): the presets as the Render settings' Quality box has them (quality.js QUALITY_GROUPS), the
       one in force lit, Custom said when it is; the box's line under them; then what a move traces. A choice is the box's
       own (quality.js applyPreset: only what differs, so the mode in force restarts nothing), and every value is a
       setting (RT.set), so the box, the menu bar's commands and a workspace follow. */
    const get = () => { try { return RT.get() || {} } catch { return {} } }
    const set = v => { try { RT.set(v) } catch (err) { console.error('[view] could not set', v, err) } refresh() }
    const menu = document.createElement('div')
    Object.assign(menu.style, { padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '6px' })
    const caption = text => { const c = document.createElement('div'); c.textContent = text; Object.assign(c.style, CAPTION); return c }
    const choice = (text, tip, onclick) => {
        const b = document.createElement('button')
        b.type = 'button'; b.textContent = text; b.title = tip
        Object.assign(b.style, CHOICE)
        b.onclick = e => { e.stopPropagation(); onclick() }
        return b
    }
    const paintChoice = (b, on) => { Object.assign(b.style, on ? CHOICE_ON : { background: CHOICE.background, color: CHOICE.color }); b.setAttribute('aria-pressed', String(on)) }
    const presetBtns = []
    const presetRow = document.createElement('div')
    Object.assign(presetRow.style, { display: 'flex', flexWrap: 'wrap', gap: '10px' })
    for (const g of QUALITY_GROUPS) {
        const col = document.createElement('div')
        Object.assign(col.style, { display: 'flex', flexDirection: 'column', gap: '3px' })
        const pill = iconPill(...g.presets.map(p => {
            const b = choice(p.short, '', () => { applyPreset(p.id, get(), set); close() })
            b.dataset.preset = p.id
            presetBtns.push(b)
            return b
        }))
        col.append(caption(g.title || '\u00a0'), pill)
        presetRow.append(col)
    }
    const qline = document.createElement('div')
    Object.assign(qline.style, { font: '12px/1.35 Arial, sans-serif', color: '#8fa3b3', whiteSpace: 'normal' })
    const moveBox = document.createElement('input')
    moveBox.type = 'checkbox'
    moveBox.onchange = () => set({ moveFast: moveBox.checked ? 1 : 0 })
    const moveLabel = document.createElement('label')
    Object.assign(moveLabel.style, { display: 'flex', alignItems: 'center', gap: '6px', font: '12px Arial, sans-serif', color: '#b9c4cd', cursor: 'pointer' })
    moveLabel.append(moveBox, document.createTextNode('Fast while moving, as'))
    const moveBtns = [MODE.DRAFT, MODE.SKETCH].map(m => {
        const b = choice(MOVE_NAMES[m], m === MODE.DRAFT ? 'Draft: the light and the shadows kept, the picture changes less when it stops'
            : 'Sketch: a flat light, the lightest -- for a heavy scene', () => set({ moveMode: m }))
        b.dataset.move = String(m)
        return b
    })
    const moveRow = document.createElement('div')
    Object.assign(moveRow.style, { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' })
    moveRow.append(moveLabel, iconPill(...moveBtns))
    menu.append(presetRow, qline, caption('While moving'), moveRow)
    const qual = popover('Quality', 'tune', 'Quality', menu)
    /* ...ITS BUTTON SAYS THE MODE IN A WORD (the user, 2026-10-11), the caret after it: the icon taken out */
    const qword = document.createElement('span')
    Object.assign(qword.style, { font: '12px/1 Arial, sans-serif', padding: '0 2px 0 4px', whiteSpace: 'nowrap' })
    qual.btn.replaceChild(qword, qual.btn.firstChild)
    Object.assign(qual.btn.style, { width: 'auto', minWidth: '36px', padding: '0 4px' })

    /* ⚡ FAST WHILE MOVING (moveFast): a switch, lit while on, and brighter while a move is being traced lighter. Its
       tooltip says which mode a move traces in, and that only a full picture is changed by it. */
    const fast = iconButton('bolt', '', e => {
        e.stopPropagation()
        close()
        set({ moveFast: ((get().moveFast ?? 1) | 0) ? 0 : 1 })
    })
    const fastPill = iconPill(fast)
    bar.append(cam.btn, expo.btn, qual.btn, fastPill)
    // a move begun or ended: ⚡ says so at once, not at the next second's refresh
    try { RT.interacting?.onChange?.(() => refresh()) } catch { }

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
        // THE QUALITY: the word on its button, the menu's lit choices and line
        const q = describe(v)
        const word = q.id === CUSTOM ? 'Custom' : PRESET_SHORT[q.id] ?? q.id
        if (qword.textContent !== word) qword.textContent = word
        qual.btn.title = `Quality: ${word}${q.id === CUSTOM ? ' (your own settings: Render settings, Quality)' : ''}. Click to choose.`
        for (const b of presetBtns) paintChoice(b, b.dataset.preset === q.id)
        if (qline.textContent !== q.text) qline.textContent = q.text
        qual.btn.style.display = photo ? '' : 'none'
        if (!photo && qual.el.style.display !== 'none') close()
        // ⚡ AND THE MENU'S WHILE-MOVING ROW
        const moveOn = ((v.moveFast ?? 1) | 0) !== 0, mm = moveModeOf(v)
        moveBox.checked = moveOn
        for (const b of moveBtns) { paintChoice(b, +b.dataset.move === mm); b.disabled = !moveOn; b.style.opacity = moveOn ? '' : '0.45' }
        const full = (v.renderMode | 0) === MODE.FULL
        const moving = moveOn && full && !!RT.interacting?.active?.()
        lit(fast, moveOn)
        if (moving) fast.style.color = '#ffcc33'          // lit() set the plain colours; amber while it is doing it
        fastPill.style.display = photo ? '' : 'none'
        fast.title = !moveOn ? `Fast while moving: off. Click to trace ${MOVE_NAMES[mm]} while the camera or an object moves.`
            : `Fast while moving: ${MOVE_NAMES[mm]}${moving ? ' now' : ''}${full ? '' : ` (only for a full picture: ${word} is light already)`}.`
              + ' The full picture comes back when it stops. Click to switch off.'
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
    return { sections: { Camera: cam.table, Show: show.table, Exposure: expo.table }, quality: qual,
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
