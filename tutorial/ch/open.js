//======================================================================================================================
// CHAPTER "Open problems": one figure, the board of kit/open.js, every item held by the test to the document it quotes.
//
//   board   every open item as a card, in columns by kind; one kind alone with its words; point at a card for its
//           source, its words and the chapter that teaches it
//======================================================================================================================

import { boot } from '../kit/page.js'
import { KINDS, ITEMS, itemsOf, counts } from '../kit/open.js'
import { chapter } from '../kit/chapters.js'

/* each kind's colour, by the pen's roles, so every style draws them its own way */
export const ROLE = { never: 'blocked', once: 'shadow', unexplained: 'cam', designed: 'glass', limit: 'normal', found: 'light' }
const kindName = Object.fromEntries(KINDS.map(([k, name]) => [k, name])), shortName = Object.fromEntries(KINDS.map(([k, , short]) => [k, short]))

/* text cut to fit `n` characters, an ellipsis if cut */
const fit = (t, n) => t.length <= n ? t : t.slice(0, Math.max(1, n - 1)) + '…'
/* text in lines of at most `n` characters, broken at spaces */
export function wrap(t, n) {
    const out = []; let line = ''
    for (const w of t.split(/\s+/)) { if (line && (line + ' ' + w).length > n) { out.push(line); line = w } else line = line ? line + ' ' + w : w }
    if (line) out.push(line)
    return out
}
const chOf = it => { const c = chapter(it.ch); return c ? `ch. ${c.number}, ${c.title}` : it.ch }
const wordsOf = it => it.note ? `${it.quote} — ${it.note}` : it.quote

/* WHERE THE CARDS GO: in 'all', a column a kind (the long first kind over two), small cards with the item's name; one
   kind, two columns of wide cards with its words */
export function layout(kind, W, H) {
    const top = 30, cards = []
    if (kind === 'all') {
        const cols = [], perCol = 14
        for (const [k] of KINDS) { const its = itemsOf(k); for (let i = 0; i < Math.max(1, Math.ceil(its.length / perCol)); i++) cols.push({ k, its: its.slice(i * perCol, (i + 1) * perCol), first: i === 0, n: its.length }) }
        const cw = (W - 8 * (cols.length - 1)) / cols.length, ch = Math.min(26, (H - top - 6) / perCol - 4)
        cols.forEach((c, j) => {
            const x = j * (cw + 8)
            c.its.forEach((it, i) => cards.push({ it, x, y: top + i * (ch + 4), w: cw, h: ch }))
            c.head = { x, w: cw }
        })
        return { cards, cols, small: true }
    }
    const its = itemsOf(kind), per = Math.ceil(its.length / 2), cw = (W - 12) / 2, ch = Math.min(64, (H - top - 6) / Math.max(1, per) - 6)
    its.forEach((it, i) => cards.push({ it, x: i < per ? 0 : cw + 12, y: top + (i % per) * (ch + 6), w: cw, h: ch }))
    return { cards, cols: null, small: false }
}

export const figures = {
    board: {
        aspect: 1.45,
        world: { x: [0, 1.45], y: [0, 1] },
        state: { kind: 'all' },
        controls: [
            { type: 'seg', key: 'kind', label: 'show', options: [['all', 'all'], ...KINDS.map(([k, , short]) => [k, short])] },
        ],
        steps: { all: { kind: 'all' }, never: { kind: 'never' }, unexplained: { kind: 'unexplained' }, designed: { kind: 'designed' }, limit: { kind: 'limit' }, found: { kind: 'found' } },
        draw(pen, s) {
            const { W, H } = pen.view, { ctx } = pen, L = layout(s.kind, W, H), n = counts()
            if (L.cols) for (const c of L.cols) if (c.first) pen.labelPx(c.head.x, 4, `${shortName[c.k]} (${n[c.k]})`, { role: ROLE[c.k], size: 11, base: 'top' })
            if (!L.cols) pen.labelPx(0, 4, `${kindName[s.kind]}: ${n[s.kind]}, point at one for its source`, { role: ROLE[s.kind], size: 12, base: 'top' })
            const charW = L.small ? 5.6 : 6.6
            for (const c of L.cards) {
                ctx.save(); ctx.strokeStyle = pen.col(ROLE[c.it.kind]); ctx.lineWidth = 1.2; ctx.fillStyle = pen.col(ROLE[c.it.kind])
                ctx.globalAlpha = 0.08; ctx.fillRect(c.x, c.y, c.w, c.h); ctx.globalAlpha = 1; ctx.strokeRect(c.x + 0.5, c.y + 0.5, c.w - 1, c.h - 1); ctx.restore()
                // the overview: the name alone, as much of it as fits; one kind: the chapter's number and the card's words
                pen.labelPx(c.x + 4, c.y + 4, fit(c.it.title, Math.floor((c.w - (L.small ? 8 : 34)) / charW)), { role: 'ink', size: L.small ? 9 : 11, base: 'top', kind: 'mono' })
                if (!L.small) {
                    const num = chapter(c.it.ch)?.number, room = Math.max(0, Math.floor((c.h - 20) / 13)), lines = wrap(c.it.note ?? c.it.quote, Math.floor((c.w - 10) / 6))
                    pen.labelPx(c.x + c.w - 4, c.y + 4, num != null ? `ch. ${num}` : '', { role: 'soft', size: 10, base: 'top', align: 'right' })
                    lines.slice(0, room).forEach((t, i) => pen.labelPx(c.x + 5, c.y + 19 + i * 13, i === room - 1 && lines.length > room ? t + ' …' : t, { role: 'soft', size: 10.5, base: 'top' }))
                }
            }
            // the card under the pointer: its source, its words, its chapter
            const hp = pen.hover()
            if (hp) {
                const c = L.cards.find(q => hp.x >= q.x && hp.x <= q.x + q.w && hp.y >= q.y && hp.y <= q.y + q.h)
                if (c) pen.tip(hp.x, hp.y, [c.it.title, ...wrap(wordsOf(c.it), 60), `${c.it.src}${c.it.status ? `, row ${c.it.id}: ${c.it.status}` : ''}`, chOf(c.it)])
            }
        },
        readout(s) {
            const n = counts(), all = ITEMS.length
            return s.kind === 'all' ? `${all} open items: ${KINDS.map(([k, name]) => `${n[k]} ${name}`).join(', ')} · point at a card for its source, its words and its chapter`
                : `${n[s.kind]} ${kindName[s.kind]} · point at a card for its document's own words, which the tutorial's test checks against today's file; ch. is the chapter that teaches it`
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
