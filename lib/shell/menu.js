//======================================================================================================================
// A POPUP MENU -- a right-click menu, or a button's: the menu bar's own look (shell.css .shell-dropdown), at a
// point or under an element, gone on a choice, a click elsewhere or Escape.
//
//   const close = popupMenu([{ label: 'Copy to', header: true }, { label: 'Lens v1', run }, { separator: true },
//                            { label: 'Shapes', items: [ ...entries ] }, { label: 'nothing to move to', off: true }], { x, y })
//
// An entry: { label, run, off, title, keys } -- `off` greys it out and leaves it inert; { header: true } a muted
// heading; { separator: true } a rule; { label, items } a SUBMENU, opening to the side when pointed at or clicked
// (and to the other side when there is no room), any depth. Knows nothing about what it lists.
//
//   flyout(row, items, { onClose })   one submenu beside `row`, for a menu of someone else's (the menu bar's
//                                     submenu rows, shell.js): the same look and rules; returns a function that closes it
//======================================================================================================================

let open = null

const make = (items, level, stack, done) => {
    const d = document.createElement('div')
    d.className = 'shell-dropdown'
    d.setAttribute('role', 'menu')
    d.style.zIndex = String(10000 + level)
    // pointing at an entry closes any deeper submenu a sibling left open
    const deeper = () => { while (stack.length > level + 1) stack.pop().remove() }
    for (const it of items) {
        if (it.separator) { d.appendChild(document.createElement('hr')); continue }
        const row = document.createElement('div')
        row.className = it.header ? 'shell-item shell-item-head off' : `shell-item${it.off ? ' off' : ''}${it.items ? ' shell-item-sub' : ''}`
        const label = document.createElement('span')
        label.className = 'shell-label'
        label.textContent = it.label
        row.appendChild(label)
        if (it.items) { const k = document.createElement('kbd'); k.textContent = '▸'; row.appendChild(k) }
        else if (it.keys) { const k = document.createElement('kbd'); k.textContent = it.keys; row.appendChild(k) }
        if (it.title) row.title = it.title
        if (it.header || it.off) { d.appendChild(row); continue }
        if (it.items) {
            const sub = () => {
                deeper()
                const m = make(it.items, level + 1, stack, done)
                beside(m, row)
            }
            row.setAttribute('aria-haspopup', 'menu')
            row.onmouseenter = sub
            row.onmouseup = e => { if (e.button === 0 && stack.length <= level + 1) sub() }
        } else {
            row.setAttribute('role', 'menuitem')
            row.onmouseenter = deeper
            /* the LEFT button only: a right-click menu opens under the pointer on the button's press (Linux, macOS),
               and its release would otherwise choose the first entry */
            if (it.run) row.onmouseup = e => { if (e.button !== 0) return; e.stopPropagation(); done(); it.run() }
        }
        d.appendChild(row)
    }
    document.body.appendChild(d)
    stack.push(d)
    return d
}
/* a menu at (x, y), moved in from the window's right and bottom edges */
const at = (d, x, y) => {
    Object.assign(d.style, { left: `${x}px`, top: `${y}px` })
    const r = d.getBoundingClientRect()
    if (r.right > innerWidth) d.style.left = `${Math.max(0, innerWidth - r.width - 4)}px`
    if (r.bottom > innerHeight) d.style.top = `${Math.max(0, innerHeight - r.height - 4)}px`
}
/* a submenu beside its row: to the right, or to the left when the right has no room */
const beside = (d, row) => {
    const r = row.getBoundingClientRect(), w = d.getBoundingClientRect().width
    at(d, r.right + w > innerWidth ? Math.max(0, r.left - w) : r.right, r.top - 5)
}

/** Show a menu; returns a function that closes it. One at a time: a new one closes the last. */
export function popupMenu(items, { x = 0, y = 0, under = null, className = '' } = {}) {
    open?.()
    const stack = []
    const close = () => {
        for (const m of stack) m.remove()
        stack.length = 0
        window.removeEventListener('mousedown', outside, true)
        window.removeEventListener('keydown', esc, true)
        if (open === close) open = null
    }
    const d = make(items, 0, stack, close)
    if (className) d.classList.add(...className.split(/\s+/).filter(Boolean))
    if (under) { const r = under.getBoundingClientRect(); x = r.left; y = r.bottom + 2 }
    at(d, x, y)
    const outside = e => { if (!stack.some(m => m.contains(e.target))) close() }
    const esc = e => { if (e.key === 'Escape') { e.preventDefault(); close() } }
    window.addEventListener('mousedown', outside, true)
    window.addEventListener('keydown', esc, true)
    open = close
    return close
}

/** One submenu beside `row` of a menu that is not one of popupMenu's: `onChoose` is called before an entry runs (the
 *  owner closes its own menu then). Returns { element, close }. */
export function flyout(row, items, { onChoose = () => { } } = {}) {
    const stack = []
    const close = () => { for (const m of stack) m.remove(); stack.length = 0 }
    // level 0 of its own stack (the depth is counted from it); later in the page than its owner's menu, so above it
    const d = make(items, 0, stack, () => { close(); onChoose() })
    beside(d, row)
    return { element: d, close, contains: el => stack.some(m => m.contains(el)) }
}
