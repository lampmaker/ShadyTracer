//======================================================================================================================
// CHAPTER "How to read this": its figures.
//
//   key      the key to every figure's colours and lines (kit/legend.js, the same one the contents page draws)
//   spread   why the flat world's laws differ from 3D's: a lamp's light spreads around a circle in the flat world and
//            over a sphere in 3D, so what reaches one piece of surface falls as 1/r in one and 1/r^2 in the other
//======================================================================================================================

import { boot } from '../kit/page.js'
import { legend } from '../kit/legend.js'

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const RAYS = 36, PATCH = 0.6               // rays drawn from the flat lamp; the length of the surface piece that catches them
const FLAT = [-2.15, -0.15], BALL = [2.2, -0.15]

/** how many of the lamp's RAYS equally spaced rays cross a piece PATCH long at distance r, straight above it */
export function caught(r) {
    let n = 0
    for (let k = 0; k < RAYS; k++) {
        const a = (k + 0.5) / RAYS * 2 * Math.PI                     // offset by half a step, so none runs along an edge
        if (Math.abs(a - Math.PI / 2) <= PATCH / 2 / r) n++
    }
    return n
}

export const figures = {
    key: legend,

    spread: {
        aspect: 1.75,
        world: { x: [-4.4, 4.4], y: [-2.55, 2.45] },
        state: { r: 1.0 },
        controls: [{ type: 'slider', key: 'r', label: 'distance r', min: 0.5, max: 2.0, step: 0.05, fmt: v => v.toFixed(2) }],
        steps: { near: { r: 1.0 }, far: { r: 2.0 } },
        drag: { r: (s, p) => { s.r = Math.round(clamp(p[1] - FLAT[1], 0.5, 2.0) * 20) / 20 } },
        draw(pen, s) {
            // THE FLAT WORLD: a lamp, its rays out to the circle r away, and a piece of surface PATCH long at the top
            for (let k = 0; k < RAYS; k++) {
                const a = (k + 0.5) / RAYS * 2 * Math.PI, hit = Math.abs(a - Math.PI / 2) <= PATCH / 2 / s.r
                pen.ray(FLAT, [FLAT[0] + Math.cos(a) * s.r, FLAT[1] + Math.sin(a) * s.r], { role: hit ? 'light' : 'faint', w: hit ? 1.3 : 0.7, arrow: false })
            }
            pen.circle(FLAT, s.r, { role: 'soft', w: 0.9, dash: [5, 5], id: 'flatring' })
            const h = PATCH / 2 / s.r
            pen.arc(FLAT, s.r, Math.PI / 2 - h, Math.PI / 2 + h, { role: 'accent', w: 3.2, exact: true })
            pen.bulb(FLAT, { r: 6 })
            pen.handle('r', [FLAT[0], FLAT[1] + s.r], { label: 'drag' })
            pen.label([FLAT[0], -2.35], 'flat world: around a circle, 2πr long', { align: 'center', role: 'soft', size: 14 })
            // 3D: the same lamp's light over a sphere r away, the same piece of surface on it (a square, PATCH a side)
            const R = s.r
            pen.circle(BALL, R, { role: 'soft', w: 0.9, dash: [5, 5], id: 'sphere' })
            const eq = []
            for (let i = 0; i <= 48; i++) { const t = i / 48 * 2 * Math.PI; eq.push([BALL[0] + R * Math.cos(t), BALL[1] + 0.32 * R * Math.sin(t)]) }
            pen.poly(eq, { role: 'faint', w: 0.8, exact: true })
            const top = [BALL[0], BALL[1] + R], q = PATCH / 2
            const patch = [[top[0] - q, top[1] - 0.06], [top[0] + q, top[1] - 0.06], [top[0] + q * 0.8, top[1] + 0.1], [top[0] - q * 0.8, top[1] + 0.1]]
            // the rays from the lamp to the patch's corners: the cone of light it catches, narrower as it moves away
            for (const c of patch) pen.ray(BALL, c, { role: 'light', w: 1.1, arrow: false })
            pen.poly([...patch, patch[0]], { role: 'accent', w: 2, exact: true })
            pen.bulb(BALL, { r: 6 })
            pen.label([BALL[0], -2.35], '3D: over a sphere, 4πr² of area', { align: 'center', role: 'soft', size: 14 })
        },
        readout(s) {
            const n = caught(s.r)
            return `r = ${s.r.toFixed(2)} · flat: ${n} of ${RAYS} rays reach the piece, its light falls as 1/r (×${(1 / s.r).toFixed(2)} of r = 1) · 3D: as 1/r² (×${(1 / (s.r * s.r)).toFixed(2)} of r = 1)`
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
