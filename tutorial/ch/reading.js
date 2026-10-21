//======================================================================================================================
// CHAPTER "How to read this": its figures.
//
//   key      the key to every figure's colours and lines (kit/legend.js, the same one the contents page draws)
//   spread   why the flat world's laws differ from 3D's: a lamp's light spreads around a circle in the flat world and
//            over a sphere in 3D, so what reaches one piece of surface falls as 1/r in one and 1/r^2 in the other --
//            counted in both: the flat rays 10 degrees apart, the 3D ones 10 degrees apart each way
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
/* 3D: rays STEP apart each way near the top, as the flat world's are round its circle; a square patch PATCH a side at
   distance r is crossed by those within PATCH/2/r of straight up each way, so it catches the square of the count
   across: the same law, squared. (A grid in angle is not even over the whole sphere; over a patch this small it is.) */
const STEP = 2 * Math.PI / RAYS
/** the rays' offsets across the patch, in units of its side (-1/2 to 1/2), at distance r */
export const across3 = r => { const out = []; for (let k = -6; k < 6; k++) { const u = (k + 0.5) * STEP * r / PATCH; if (Math.abs(u) <= 0.5) out.push(u) } return out }
export const caught3 = r => across3(r).length ** 2

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
                // every ray the lamp's light, as the key draws it: the caught ones bold, the others faint (they were
                // grey once, which a reader took for the key's shadow rays)
                pen.ray(FLAT, [FLAT[0] + Math.cos(a) * s.r, FLAT[1] + Math.sin(a) * s.r], { role: 'light', w: hit ? 1.4 : 0.6, alpha: hit ? 1 : 0.35, arrow: false, exact: true })
            }
            pen.circle(FLAT, s.r, { role: 'soft', w: 0.9, dash: [5, 5], id: 'flatring' })
            const h = PATCH / 2 / s.r
            pen.arc(FLAT, s.r, Math.PI / 2 - h, Math.PI / 2 + h, { role: 'solid', w: 3.6, exact: true })
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
            // the rays the patch catches, each to the point it crosses: the square patch seen at a slant, u across it and
            // v into the page (its near edge wider)
            const at = (u, v) => { const w = 0.5 + v, half = q * (1 - 0.2 * w); return [top[0] + 2 * u * half, top[1] - 0.06 + 0.16 * w] }
            const us = across3(R)
            pen.poly([...patch, patch[0]], { role: 'solid', w: 2.2, exact: true })
            for (const u of us) for (const v of us) { const p = at(u, v); pen.ray(BALL, p, { role: 'light', w: 0.9, alpha: 0.7, arrow: false, exact: true }); pen.dot(p, { role: 'light', r: 2.4 }) }
            // ...and the patch close up, seen square on, in the corner: its dots counted at a glance (on the slanted
            // patch they were too small to count)
            const { W } = pen.view, Z = 66, zx = W - Z - 10, zy = 10
            pen.labelPx(zx + Z, zy + Z + 4, 'the patch, close up', { role: 'soft', size: 11, align: 'right' })
            const { ctx } = pen
            ctx.save(); ctx.strokeStyle = pen.col('solid'); ctx.lineWidth = 2; ctx.strokeRect(zx, zy, Z, Z); ctx.restore()
            ctx.save(); ctx.fillStyle = pen.col('light')
            for (const u of us) for (const v of us) { ctx.beginPath(); ctx.arc(zx + (u + 0.5) * Z, zy + (v + 0.5) * Z, 3.6, 0, 2 * Math.PI); ctx.fill() }
            ctx.restore()
            pen.bulb(BALL, { r: 6 })
            pen.label([BALL[0], -2.35], '3D: over a sphere, 4πr² of area', { align: 'center', role: 'soft', size: 14 })
        },
        readout(s) {
            const n = caught(s.r), m = across3(s.r).length
            return `r = ${s.r.toFixed(2)} · flat: ${n} of ${RAYS} rays reach the piece, its light falls as 1/r (×${(1 / s.r).toFixed(2)} of r = 1) · 3D: ${m} × ${m} = ${m * m} rays reach the patch, its light falls as 1/r² (×${(1 / (s.r * s.r)).toFixed(2)} of r = 1)`
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
