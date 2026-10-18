//======================================================================================================================
// THE CONTENTS: the map of parts and chapters, drawn from kit/chapters.js -- so the map, the pages' prev / next and the
// chapter links can never disagree -- and the legend of what the figures draw, drawn with the figures' own pen.
//======================================================================================================================

import { boot, chapterHref } from './kit/page.js'
import { PARTS, CHAPTERS } from './kit/chapters.js'
import { makePen } from './kit/pen.js'
import { readTheme } from './kit/figure.js'
import { legend } from './kit/legend.js'

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']

/** The map's markup: a block per part, a station per chapter, written ones as links. */
export function mapHTML() {
    return PARTS.map((p, pi) => {
        const cs = CHAPTERS.filter(c => c.part === p.id)
        return `<section class="district" id="part-${p.id}">
            <h3><span class="pn">${pi ? ROMAN[pi] : '·'}</span>${esc(p.title)}</h3>
            <ol class="stations">${cs.map(c => {
                const inner = `<span class="dot">${c.number}</span><span class="t">${esc(c.title)}</span><span class="l">${esc(c.line)}</span>${c.file ? '' : '<span class="st">planned</span>'}`
                return `<li id="ch-${c.id}" class="${c.file ? 'live' : 'planned'}">${c.file ? `<a class="stn" href="${chapterHref(c.id)}">${inner}</a>` : `<span class="stn">${inner}</span>`}</li>`
            }).join('')}</ol></section>`
    }).join('')
}

/* THE ROUTE: each part's stations joined in reading order, drawn by the pen behind the map so it takes the style */
function route(doc, map, canvas) {
    const draw = () => {
        const r = map.getBoundingClientRect(), dpr = Math.min(2, doc.defaultView.devicePixelRatio || 1)
        canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr)
        canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px'
        const ctx = canvas.getContext('2d'); if (!ctx) return
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, r.width, r.height)
        const pen = makePen(ctx, { s: 1, ox: 0, oy: 0, W: r.width, H: r.height }, readTheme(map))
        // a spine down each part, station to station: a line from one part's last to the next part's first would cross
        // the text of whatever lies between them in the grid
        for (const part of map.querySelectorAll('.district')) {
            const lis = [...part.querySelectorAll('li')]
            const pts = lis.map(li => { const b = li.querySelector('.dot').getBoundingClientRect(); return [b.left + b.width / 2 - r.left, -(b.top + b.height / 2 - r.top)] })
            for (let i = 0; i < pts.length - 1; i++) {
                const live = lis[i].classList.contains('live') && lis[i + 1].classList.contains('live')
                pen.line(pts[i], pts[i + 1], { role: live ? 'accent' : 'faint', w: live ? 2.2 : 1.2, id: part.id + i, dash: live ? [] : [4, 6] })
            }
        }
    }
    new doc.defaultView.ResizeObserver(draw).observe(map)
    doc.addEventListener('kit:theme', draw)
    doc.fonts?.ready?.then(draw)
    return draw
}

/* THE LEGEND: what each colour and line means in every figure (kit/legend.js: the styles page draws it too) */
export const figures = { legend }

export function mount() {
    const doc = document
    const map = doc.getElementById('map')
    if (map) {
        map.innerHTML = mapHTML()
        const cv = doc.createElement('canvas'); cv.className = 'route'; cv.setAttribute('aria-hidden', 'true')
        map.prepend(cv)
        route(doc, map, cv)
    }
    boot({ figures })
}
if (typeof document !== 'undefined') mount()
