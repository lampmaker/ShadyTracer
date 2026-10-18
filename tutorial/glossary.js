//======================================================================================================================
// THE GLOSSARY PAGE: every entry of kit/glossary.js, A to Z, each with the chapter that explains it and its related
// entries; a filter box narrows the list as you type. Terms link here from every page (data-g, page.js).
//======================================================================================================================

import { boot, chapterHref } from './kit/page.js'
import { GLOSSARY } from './kit/glossary.js'
import { chapter } from './kit/chapters.js'

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

export function listHTML() {
    const sorted = [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term, 'en', { sensitivity: 'base' }))
    let letter = ''
    return sorted.map(g => {
        const L = g.term[0].toUpperCase(), head = L !== letter ? `<h3 class="letter">${(letter = L)}</h3>` : ''
        const c = chapter(g.ch)
        const where = c ? `<a class="where${c.file ? '' : ' planned'}" href="${chapterHref(c.id)}">${c.file ? 'Explained in' : 'Planned:'} chapter ${c.number}, “${esc(c.title)}”</a>` : ''
        const see = g.see.length ? `<span class="see">See also: ${g.see.map(id => { const t = GLOSSARY.find(x => x.id === id); return t ? `<a href="#${id}">${esc(t.term)}</a>` : '' }).join(', ')}</span>` : ''
        return `${head}<dl class="entry" id="${g.id}" data-text="${esc((g.term + ' ' + g.short).toLowerCase())}"><dt>${esc(g.term)}</dt><dd><p>${esc(g.short)}</p>${where}${see}</dd></dl>`
    }).join('')
}

export function mount() {
    const doc = document
    const list = doc.getElementById('terms')
    if (list) {
        list.innerHTML = listHTML()
        const box = doc.getElementById('filter')
        box?.addEventListener('input', () => {
            const q = box.value.trim().toLowerCase()
            for (const e of list.querySelectorAll('.entry')) e.hidden = q && !e.dataset.text.includes(q)
            for (const h of list.querySelectorAll('.letter')) {
                let n = h.nextElementSibling, any = false
                while (n && !n.classList.contains('letter')) { if (!n.hidden) any = true; n = n.nextElementSibling }
                h.hidden = !any
            }
        })
        // arriving at #term: mark it
        const mark = () => { for (const e of list.querySelectorAll('.entry.on')) e.classList.remove('on'); const id = decodeURIComponent(location.hash.slice(1)); doc.getElementById(id)?.classList.add('on') }
        window.addEventListener('hashchange', mark); mark()
    }
    boot({ figures: {} })
}
if (typeof document !== 'undefined') mount()
