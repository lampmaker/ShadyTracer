//======================================================================================================================
// THE STYLE HUB (mockup round only): each card carries data-style, so its tokens -- and the small figure in it, drawn by
// the same pen as the chapters -- are that style's whatever the page's own. "Open" stores the style first: the preview
// of a claude.ai artifact drops a link's query, so ?style= alone would not carry it.
//======================================================================================================================

import { boot, setStyle, STYLES } from '../kit/page.js'
import { march } from '../kit/flatland.js'

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

export const figures = Object.fromEntries(Object.keys(STYLES).map(n => [`sample-${n}`, sample]))

export function mount() {
    const doc = document
    for (const a of doc.querySelectorAll('[data-open-style]')) {
        a.addEventListener('click', () => setStyle(doc, a.dataset.openStyle))
    }
    boot({ figures, allFonts: true })
}
if (typeof document !== 'undefined') mount()
