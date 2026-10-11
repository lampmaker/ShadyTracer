//======================================================================================================================
// ICONS, and the one look of a strip of buttons over a picture or at the head of a panel.
//
//   const bar = iconBar()                         // the strip: a translucent pill
//   const b = iconButton('camera', 'Camera')      // a square button, the icon, the tooltip
//   lit(b, true)                                  // shown pressed
//   iconPill(a, b, c)                             // toggles that belong together: one outlined group
//   menuButton('camera', 'Camera')                // a button that OPENS something: the icon and a small caret
//
// SWITCHES AND MENUS TELL THEMSELVES APART (the user, 2026-10-02: "separate the groups ... so it's clear what are
// toggles that belong together and what is a menu item"). A switch, or a set of them where one is on, sits in an
// outlined pill of its own; a button that opens a popover carries a caret and no outline. A strip spaces its groups
// apart rather than ruling a line between every one.
//
// WHY ICONS: the user's rule (2026-09-27) -- minimal overlays, icons with tooltips rather than long
// text, and nothing said twice. A button that read "Shows: Photographic ▾" and opened a list whose
// first row was "Show: photographic" said the same thing three times. An icon says which it is; the
// tooltip says the rest, including a value ("EV 9.2, auto") when there is one.
//
// Line icons on a 24 grid, stroked in currentColor so a lit or disabled button colours them. Drawn
// here rather than taken from an icon font: no dependency, no network, and they scale with the text.
//======================================================================================================================

const P = {
    camera: '<path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.5"/>',
    photo: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.5"/>',
    lux: '<circle cx="12" cy="8" r="3"/><path d="M12 2.5v1.5M6.5 4.5l1 1M17.5 4.5l-1 1M4.5 8H6M18 8h1.5M3 20h18M8.5 14.5l-1.5 3M12 14v3.5M15.5 14.5l1.5 3"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    exposure: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>',
    scale: '<rect x="8" y="3" width="8" height="18" rx="1"/><path d="M8 7.5h8M8 12h8M8 16.5h8"/>',
    pin: '<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>',
    area: '<rect x="4" y="6" width="16" height="12" stroke-dasharray="3 2.2"/>',
    clear: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>',
    download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
    open: '<path d="M3 6.5h6l2 2h10V19H3z"/>',
    save: '<path d="M5 3.5h11l3 3V20.5H5z"/><path d="M8.5 3.5v4.5h6.5V3.5M8.5 20.5v-6.5h7v6.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    polar: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 3.5v17M3.5 12h17"/>',
    curve: '<path d="M4 4v16h16"/><path d="M6.5 17c2.5 0 3-10 5.5-10s3 10 5.5 10"/>',
    rotational: '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M17.5 3.5v3.8h-3.8"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 16l-5-5-8 8"/>',
    table: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M3.5 10h17M3.5 14.5h17M9.5 5v14"/>',
    isolines: '<path d="M4 17c3-6 6-9 12-9"/><path d="M8 20c2-4 5-7 12-7"/><path d="M4 11c2-3 4-5 8-6"/>',
    map: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 12h16M12 4v16"/>',
    box: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
    boxes: '<path d="M8 3.5l5 2.8v5.6L8 14.7l-5-2.8V6.3z"/><path d="M16 9.3l5 2.8v5.6l-5 2.8-5-2.8"/><path d="M11 12.1l5-2.8"/>',
    rays: '<path d="M4 18L20 6M4 18l16-4M4 18l12 3"/><circle cx="4" cy="18" r="1.6" fill="currentColor"/>',
    tune: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    zoomOut: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M7.5 10.5h6"/>',
    play: '<path d="M7 4.5v15l12-7.5z"/>',
    // the view's fast while moving (Draft or Sketch while the camera or an object moves): a bolt
    bolt: '<path d="M13.5 3L5.5 13.5h6L10 21l8.5-11h-6z"/>',
    boxOff: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" stroke-dasharray="2.5 2.5"/>',
    // the library's: edit an item, copy it, and leave an item being edited
    edit: '<path d="M4.5 19.5l1-4.5L15.5 5l3.5 3.5-10 10z"/><path d="M13.5 7l3.5 3.5"/>',
    duplicate: '<rect x="8.5" y="8.5" width="11" height="11" rx="1.5"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
    back: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',     // not 'clear', a bin: closing throws nothing away
    // a place up or down a list (once the scene switcher's, now no one's: kept for the next list)
    up: '<path d="M6 14.5l6-6 6 6"/>',
    down: '<path d="M6 9.5l6 6 6-6"/>',
    // the Points mode's legs (builder/pointsmode.js): a dotted staircase from one point to the next
    legs: '<path d="M5 19h7v-7h7V5" stroke-dasharray="2 2.4"/><circle cx="5" cy="19" r="1.8" fill="currentColor"/><circle cx="19" cy="5" r="1.8" fill="currentColor"/>',
    // the Renderer panel's boxes (settingsui.js RENDERER_BOXES): the light sources, a path bouncing, a march's
    // shrinking steps to a surface, the developer's
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
    bounce: '<path d="M3 20.5h18"/><path d="M4 4l5 16.5 5-11 5 6.5"/>',
    march: '<path d="M2.5 12h16M21 4.5v15"/><circle cx="7" cy="12" r="4"/><circle cx="14" cy="12" r="2.5"/><circle cx="18.5" cy="12" r="1.2"/>',
    code: '<path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5"/>',
    // the view's analysis drawer (viewtools.js): a lens over a small bar chart
    analyse: '<circle cx="10.5" cy="10.5" r="7"/><path d="M15.5 15.5L21 21M7.5 13v-2M10.5 13V8M13.5 13v-3.5"/>',
}
// a menu button's caret, drawn smaller than an icon
const CARET = '<path d="M6 9.5l6 6 6-6"/>'
export const ICON_NAMES = Object.keys(P)

/** An icon as an <svg> element, `size` px square. */
export function icon(name, size = 16) {
    if (!(name in P)) throw new Error(`no icon '${name}'`)
    return drawn(P[name], size)
}
/** A drawing on the 24 grid as an <svg> element: an icon's, or the caret's. */
function drawn(inner, size) {
    const ns = 'http://www.w3.org/2000/svg'
    const s = document.createElementNS(ns, 'svg')
    s.setAttribute('viewBox', '0 0 24 24')
    s.setAttribute('width', size); s.setAttribute('height', size)
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor')
    s.setAttribute('stroke-width', '1.7'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round')
    s.style.display = 'block'
    s.innerHTML = inner
    return s
}

const BAR = { display: 'flex', alignItems: 'center', gap: '1px', padding: '2px', borderRadius: '6px',
              background: 'rgba(18,21,24,0.62)', border: '1px solid rgba(160,175,190,0.18)', backdropFilter: 'blur(3px)' }
const BTN = { width: '26px', height: '26px', display: 'grid', placeItems: 'center', padding: '0', color: '#b9c4cd',
              background: 'transparent', border: '0', borderRadius: '4px', cursor: 'pointer' }
const ON = { background: 'rgba(120,150,175,0.32)', color: '#fff' }
const PILL = { display: 'inline-flex', alignItems: 'center', gap: '1px', padding: '1px', borderRadius: '5px',
               background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(160,175,190,0.28)' }
const OFF = { background: 'transparent', color: '#b9c4cd' }

/** The strip: a translucent pill. Position it yourself (absolute over a picture, or in a panel's head). */
export function iconBar(style = {}) {
    const bar = document.createElement('div')
    Object.assign(bar.style, BAR, style)
    return bar
}
/** A thin divider between groups in a strip. */
export function iconGap() {
    const s = document.createElement('span')
    Object.assign(s.style, { width: '1px', alignSelf: 'stretch', margin: '4px 3px', background: 'rgba(160,175,190,0.22)' })
    return s
}
/** Toggles that belong together -- the view's modes, a switch on its own -- as one outlined group: what reads as a
 *  set of switches, apart from the menu buttons beside it. */
export function iconPill(...buttons) {
    const s = document.createElement('span')
    Object.assign(s.style, PILL)
    s.append(...buttons)
    return s
}
/** A button that opens a popover or a menu: the icon and a small caret, no outline -- not a switch. */
export function menuButton(name, tip, onclick) {
    const b = iconButton(name, tip, onclick)
    const c = drawn(CARET, 10)
    c.style.marginLeft = '-1px'
    Object.assign(b.style, { width: '36px', gridAutoFlow: 'column', gap: '0', alignItems: 'center' })
    b.appendChild(c)
    b.dataset.menu = '1'
    return b
}
/** A square icon button with a tooltip. Hover lightens it unless it is lit or disabled. */
export function iconButton(name, tip, onclick) {
    const b = document.createElement('button')
    b.type = 'button'
    b.title = tip
    b.appendChild(icon(name))
    Object.assign(b.style, BTN)
    b.onmouseenter = () => { if (!b.dataset.on && !b.disabled) b.style.color = '#fff' }
    b.onmouseleave = () => { if (!b.dataset.on) b.style.color = OFF.color }
    if (onclick) b.onclick = onclick
    return b
}
/** Show a button pressed (a mode that is on, a popover that is open) or not. */
export function lit(b, on) {
    if (on) b.dataset.on = '1'; else delete b.dataset.on
    Object.assign(b.style, on ? ON : OFF)
}
/** Grey a button out (nothing to undo) or back. */
export function enable(b, ok) {
    b.disabled = !ok
    b.style.opacity = ok ? '1' : '0.35'
    b.style.cursor = ok ? 'pointer' : 'default'
}
