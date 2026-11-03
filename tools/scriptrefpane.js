//======================================================================================================================
// THE SCRIPT PANEL'S REFERENCE PANE (0.82.0): tools/scriptref.js shown beside the editor -- found by words, a section
// a fold, each name's signature, what it does and gives back, and an example that one click puts in the editor (the
// user, 2026-11-03: "the analysis needs more extensive help ... a help pane at the script").
//
//   const R = referencePane({ insert: code => ..., names: SCRIPT_NAMES })   // R.el, R.find(words)
//======================================================================================================================

import { SCRIPT_REF } from './scriptref.js'
import { highlightJS } from './scripthighlight.js'

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
const esc = s => String(s).replace(/[&<>]/g, c => c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;')
/** the reference's text as HTML: `code` and **bold**, nothing else (it is ours, but escaped all the same) */
export const refHTML = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')

/**
 * @param insert  (code) => put an example in the editor
 * @param names   the API's names, coloured in the signatures and examples
 */
export function referencePane({ insert, names = [] }) {
    const G = new Set(names)
    const root = el('div', 'rt-script-ref')
    const q = el('input')
    q.type = 'search'; q.placeholder = 'Find in the reference…'
    const list = el('div', 'rt-script-ref-list')
    const none = el('div', 'rt-script-ref-none', 'Nothing matches.')
    root.append(q, list, none)
    const sections = []
    for (const s of SCRIPT_REF) {
        const d = el('details', 'sec')
        d.dataset.id = s.id
        d.append(el('summary', null, s.title))
        if (s.intro) { const p = el('div', 'intro'); p.innerHTML = refHTML(s.intro); d.append(p) }
        const items = []
        for (const i of s.items) {
            const it = el('div', 'item')
            const sig = el('div', 'sig'); sig.innerHTML = highlightJS(i.sig, { globals: G })
            const tx = el('div', 'text'); tx.innerHTML = refHTML(i.text)
            it.append(sig, tx)
            if (i.returns) { const r = el('div', 'ret'); r.innerHTML = `gives ${refHTML(i.returns)}`; it.append(r) }
            if (i.example) {
                const ex = el('div', 'ex'), pre = el('pre'), b = el('button', null, 'insert')
                pre.innerHTML = highlightJS(i.example, { globals: G })
                b.title = 'Put this example in the editor, at the caret'
                b.onclick = () => insert(i.example)
                ex.append(pre, b)
                it.append(ex)
            }
            // what a search reads: every word the item shows
            it.dataset.hay = [i.sig, i.text, i.returns ?? '', i.example ?? '', ...i.names, s.title].join(' ').toLowerCase()
            items.push(it)
            d.append(it)
        }
        sections.push({ d, items })
        list.append(d)
    }
    sections[0].d.open = true
    let opened = null                    // the folds as they were before a search opened every match
    const find = words => {
        const w = String(words ?? '').toLowerCase().split(/\s+/).filter(Boolean)
        if (w.length && !opened) opened = sections.map(s => s.d.open)
        let any = false
        sections.forEach((s, k) => {
            let n = 0
            for (const it of s.items) { const hit = w.every(x => it.dataset.hay.includes(x)); it.hidden = !hit; if (hit) n++ }
            s.d.hidden = !n
            if (w.length) s.d.open = n > 0
            else if (opened) s.d.open = opened[k]
            any ||= n > 0
        })
        if (!w.length) opened = null
        none.hidden = any
        return sections.reduce((a, s) => a + s.items.filter(i => !i.hidden).length, 0)
    }
    q.addEventListener('input', () => find(q.value))
    // the page's shortcuts are not for this box either
    for (const k of ['keydown', 'keyup', 'keypress']) q.addEventListener(k, e => e.stopPropagation())
    find('')
    return { el: root, find: words => { q.value = words; return find(words) }, open: id => { const s = sections.find(x => x.d.dataset.id === id); if (s) { s.d.open = true; s.d.scrollIntoView?.({ block: 'nearest' }) } } }
}
