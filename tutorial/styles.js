//======================================================================================================================
// THE STYLES PAGE: every style in kit/styles.js side by side, each card in its own style (its data-style sets its
// tokens, and the small figure in it is drawn by the same pen as the chapters'), with a button to read in it. The cards
// are made from the list, so a style added there appears here.
//======================================================================================================================

import { boot, setStyle } from './kit/page.js'
import { STYLES } from './kit/styles.js'
import { march } from './kit/flatland.js'

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/* the sample every card draws: a ray from an eye to a ball, its shadow ray to a lamp, the normal, the march's circles */
const WORLD = { shapes: [{ kind: 'box', c: [3, -0.45], h: [4, 0.45], name: 'floor' }, { kind: 'circle', c: [3.6, 0.85], r: 0.85, name: 'ball' }] }
const sample = {
    aspect: 1.9,
    world: { x: [-0.4, 6.4], y: [-0.7, 2.9] },
    state: {},
    draw(pen) {
        for (const sh of WORLD.shapes) pen.flat(sh, { id: sh.name })
        const o = [0.2, 1.7], d = [0.94, -0.34], steps = [], H = {}
        march(WORLD, o[0], o[1], d[0], d[1], { steps, eps: 0.004 }, H)
        for (const st of steps) pen.circle([st.x, st.y], Math.abs(st.d), { role: 'step', w: 0.6, exact: true })
        pen.ray(o, [H.x, H.y], { role: 'cam', w: 1.2 })
        const n = [(H.x - 3.6) / 0.85, (H.y - 0.85) / 0.85], lamp = [1.7, 2.55]
        pen.ray([H.x, H.y], lamp, { role: 'shadow', w: 1.1, exact: false, id: 's' })
        pen.ray([H.x, H.y], [H.x + n[0] * 0.7, H.y + n[1] * 0.7], { role: 'normal', w: 1, exact: false, id: 'n' })
        pen.angle([H.x, H.y], Math.atan2(n[1], n[0]), Math.atan2(lamp[1] - H.y, lamp[0] - H.x), 0.38, 'θ', { role: 'normal' })
        pen.eye(o, Math.atan2(d[1], d[0]), { size: 18 })
        pen.bulb(lamp, { r: 6 })
        pen.label([o[0], o[1] + 0.42], 'eye', { size: 14, role: 'soft' })
        pen.label([lamp[0] + 0.3, lamp[1]], 'lamp', { size: 14, role: 'soft' })
    },
}
export const figures = Object.fromEntries(STYLES.map(st => [`sample-${st.id}`, sample]))

/** the cards' markup, one a style */
export const cardsHTML = () => STYLES.map(st => `
    <article class="card" data-style="${st.id}">
      <h3>${esc(st.name)}</h3>
      <p class="eyebrowish">${esc(st.line)}</p>
      <figure class="fig" data-fig="sample-${st.id}"><figcaption>${esc(st.name)}</figcaption></figure>
      <p>${esc(st.about)}</p>
      <div class="open">
        <button type="button" class="kbtn" data-use-style="${st.id}">Use this style</button>
        <a class="kbtn" data-use-style="${st.id}" href="ch/rays.html?style=${st.id}">Read chapter 1 in it</a>
      </div>
    </article>`).join('')

export function mount() {
    const doc = document
    const cards = doc.getElementById('cards')
    if (cards) cards.innerHTML = cardsHTML()
    for (const el of doc.querySelectorAll('[data-use-style]')) el.addEventListener('click', () => {
        setStyle(doc, el.dataset.useStyle)
        const sel = doc.getElementById('kit-style'); if (sel) sel.value = el.dataset.useStyle
    })
    boot({ figures, allFonts: true })
}
if (typeof document !== 'undefined') mount()
