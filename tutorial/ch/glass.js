//======================================================================================================================
// CHAPTER "Glass": its figures.
//
//   snell  one interface between air and glass, a ray at the angle you drag, from the air or from inside the glass: what
//          reflects and what refracts, by optics/fresnel.js's own fresnel and refract (the shader's formula), and the
//          reflectance at every angle -- s, p and their average, the one the renderer uses -- with total internal
//          reflection past the critical angle
//   slab   a slab of glass, the light bouncing inside it: every pass that leaves, summed to (1 - R) / (1 + R), and with
//          a colour depth, absorbed on the way (Beer-Lambert) -- against fresnel.js's slabT and absorbingSlabT
//   ball   parallel light through a glass ball: refracted in, refracted out, to a focus nearer for the rays further
//          out -- or, past an index of 2, crossing the axis inside the ball. Never totally reflected: a ray meets the far
//          side at the angle it was bent to on the way in, below the critical angle (traceBall keeps the branch anyway)
//
// Fresnel and Snell have no dimension in them, so the flat drawings use the 3D formulas as they are (flatland.js's
// header): every ray here is in the plane of the page.
//======================================================================================================================

import { boot } from '../kit/page.js'
import { plot } from '../kit/plot.js'
import { fresnel, refract, slabT, absorbingSlabT } from '../../lib/pathtracer/optics/fresnel.js'

const DEG = Math.PI / 180, clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const pct = v => `${(100 * v).toFixed(1)}%`

/** one interface: a ray at theta (degrees from the normal) from the air (index 1) into glass of index n, or from inside
 *  the glass out: { R, s, p, t (the refracted direction, or null: total internal reflection), thetaT, eta } */
export function interfaceAt(theta, n, side) {
    const eta = side === 'glass' ? n : 1 / n, s = Math.sin(theta * DEG), c = Math.cos(theta * DEG)
    // in the page's plane: the surface is y = 0, the glass below; a ray from the air goes down, from the glass up
    const d = side === 'glass' ? [s, c, 0] : [s, -c, 0], nrm = side === 'glass' ? [0, -1, 0] : [0, 1, 0]
    const f = fresnel(c, eta), t = refract(d, nrm, eta)
    return { ...f, R: f.unpolarised, t, thetaT: t ? Math.asin(clamp(Math.abs(t[0]), 0, 1)) / DEG : null, eta, d }
}
export const criticalDeg = n => Math.asin(1 / n) / DEG
export const brewsterDeg = (n, side) => Math.atan(side === 'glass' ? 1 / n : n) / DEG

/** THE SLAB'S PASSES: light entering at theta, each pass through the slab absorbed by t; what leaves below and above at
 *  each bounce, in order -- the series slabT and absorbingSlabT sum in closed form */
export function slabPasses(theta, n, colour = 1, depth = 0, passes = 40) {
    const R = fresnel(Math.cos(theta * DEG), 1 / n).unpolarised, cosIn = Math.sqrt(1 - (Math.sin(theta * DEG) / n) ** 2)
    const t = depth > 0 ? colour ** (1 / cosIn / depth) : 1
    const out = { R, t, below: [], above: [R], inside: [] }
    let e = 1 - R                                              // in the glass, just past the top face
    for (let k = 0; k < passes; k++) {
        e *= t; out.inside.push(e)                            // across the slab, absorbed on the way
        if (k % 2 === 0) { out.below.push(e * (1 - R)) } else { out.above.push(e * (1 - R)) }
        e *= R                                                // what the face sends back in
    }
    out.T = out.below.reduce((a, b) => a + b, 0); out.Rall = out.above.reduce((a, b) => a + b, 0)
    return out
}

/* THE BALL: radius 1 at the origin, index n, rays along +x at heights h; each traced in, across, out (or reflected
   inside, up to three times) with the energy it keeps -- (1 - R) at each crossing */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], 0], dot = (a, b) => a[0] * b[0] + a[1] * b[1]
export function traceBall(h, n, maxInside = 4) {
    if (Math.abs(h) >= 1) return null
    const p0 = [-Math.sqrt(1 - h * h), h, 0], d0 = [1, 0, 0], R0 = fresnel(-dot(d0, p0), 1 / n).unpolarised
    let p = p0, d = refract(d0, p0, 1 / n), e = 1 - R0
    const segs = [{ a: [-3.1, h], b: [p0[0], h], e: 1 }], reflected = { a: p0, d: [d0[0] - 2 * dot(d0, p0) * p0[0], d0[1] - 2 * dot(d0, p0) * p0[1], 0], e: R0 }
    for (let k = 0; k < maxInside; k++) {
        const q = [p[0] - 2 * dot(p, d) * d[0], p[1] - 2 * dot(p, d) * d[1], 0]    // the chord to the far side (|p| = 1)
        segs.push({ a: [p[0], p[1]], b: [q[0], q[1]], e, inside: true })
        const nIn = [-q[0], -q[1], 0], c = -dot(d, nIn), f = fresnel(c, n), out = refract(d, nIn, n)
        if (out) return { segs, out: { a: [q[0], q[1]], d: out, e: e * (1 - f.unpolarised) }, reflected, tir: k > 0 }
        d = [d[0] + 2 * c * nIn[0], d[1] + 2 * c * nIn[1], 0]; p = q            // totally reflected: on round the inside
    }
    return { segs, out: null, reflected, tir: true }
}
/** where a leaving ray crosses the axis (y = 0), or null */
const crossAxis = o => o && Math.abs(o.d[1]) > 1e-12 ? o.a[0] - o.a[1] * o.d[0] / o.d[1] : null
/** the paraxial focus of a ball lens, from its centre: n R / (2 (n - 1)) */
export const ballFocus = n => n / (2 * (n - 1))
/** where rays near the axis cross it after the front face alone, from the centre: the front's own focus, n R / (n - 1)
 *  behind it -- inside the ball when the index is over 2 */
export const frontFocus = n => n / (n - 1) - 1
export const axisCross = (h, n) => { const b = traceBall(h, n); return b ? crossAxis(b.out) : null }

export const figures = {
    snell: {
        aspect: 2.4,
        world: { x: [-3.2, 8.7], y: [-2.5, 2.45] },
        state: { theta: 45, n: 1.5, side: 'air' },
        controls: [
            { type: 'seg', key: 'side', options: [['air', 'From the air'], ['glass', 'From inside the glass']] },
            { type: 'slider', key: 'n', label: 'index n', min: 1, max: 2.5, step: 0.01, fmt: v => v.toFixed(2) },
        ],
        steps: { air: { theta: 45, n: 1.5, side: 'air' }, inside: { theta: 30, n: 1.5, side: 'glass' }, tir: { theta: 50, n: 1.5, side: 'glass' } },
        drag: { theta: (s, p) => { s.theta = Math.round(clamp(Math.atan2(-p[0], Math.abs(p[1])) / DEG, 0, 89)) } },
        draw(pen, s) {
            const f = interfaceAt(s.theta, s.n, s.side), L = 2.2, sg = s.side === 'glass' ? -1 : 1
            const { ctx } = pen
            ctx.save(); ctx.fillStyle = pen.col('glass'); ctx.globalAlpha = 0.13; ctx.fillRect(pen.X(-3), pen.Y(0), pen.X(3) - pen.X(-3), pen.Y(-2.4) - pen.Y(0)); ctx.restore()
            pen.line([-3, 0], [3, 0], { role: 'glass', w: 1.6, exact: true })
            pen.label([-2.9, -2.2], `glass, n = ${s.n.toFixed(2)}`, { role: 'glass', size: 12 }); pen.label([-2.9, 2.2], 'air, n = 1', { role: 'soft', size: 12 })
            pen.line([0, -2.3], [0, 2.3], { role: 'normal', w: 1, dash: [2, 3], exact: true })
            const src = [-L * Math.sin(s.theta * DEG), sg * L * Math.cos(s.theta * DEG)]
            pen.ray(src, [0, 0], { role: 'light', w: 2.2, id: 'in' })
            pen.ray([0, 0], [-src[0], src[1]], { role: 'light', w: 0.6 + 3 * f.R, alpha: 0.4 + 0.6 * f.R, id: 'refl' })
            pen.label([-src[0] * 1.05 + 0.1, src[1] * 1.08], `reflected ${pct(f.R)}`, { role: 'light', size: 12 })
            if (f.t) {
                pen.ray([0, 0], [f.t[0] * L, f.t[1] * L], { role: 'light', w: 0.6 + 3 * (1 - f.R), alpha: 0.4 + 0.6 * (1 - f.R), id: 'refr' })
                pen.label([f.t[0] * L * 1.05 + 0.1, f.t[1] * L * 1.06], `refracted ${pct(1 - f.R)}`, { role: 'light', size: 12 })
            } else pen.label([0.3, -sg * 1.2], 'no refraction: total internal reflection', { role: 'blocked', size: 12 })
            pen.handle('theta', src, { role: 'light' })
            // the reflectance at every angle, from this side
            const { W, H } = pen.view, rect = { x: pen.X(3.9), y: pen.Y(2.05), w: pen.X(8.4) - pen.X(3.9), h: pen.Y(-1.85) - pen.Y(2.05) }
            const ths = Array.from({ length: 179 }, (_, k) => k * 0.5), at = th => interfaceAt(th, s.n, s.side)
            const { X } = plot(pen, rect, {
                x: [0, 90], y: [0, 1], xticks: [30, 60, 90], yticks: [0, 0.5, 1], fmt: v => v > 1 ? `${v}°` : v.toFixed(1),
                hoverX: v => `${v.toFixed(1)}° from the normal`, hoverY: v => pct(v),
                series: [
                    { name: 's', pts: ths.map(t => [t, at(t).s]), role: 'soft', w: 1, dash: [4, 3] },
                    { name: 'p', pts: ths.map(t => [t, at(t).p]), role: 'soft', w: 1, dash: [1, 3] },
                    { name: 'unpolarised', pts: ths.map(t => [t, at(t).R]), role: 'accent', w: 2 },
                    { name: 'this ray', pts: [[s.theta, f.R], [s.theta, f.R]], role: 'light', kind: 'dots', r: 4.5 },
                ],
            })
            pen.labelPx(rect.x - 20, rect.y - 18, `reflected share, ${s.side === 'glass' ? 'from inside the glass' : 'from the air'}`, { role: 'soft', size: 12 })
            // which curve is which (a reader could not tell): a key in the chart's top left, where no curve is
            const key = (k, dash, w, role, text) => { const y = rect.y + 10 + 14 * k; ctx.save(); ctx.strokeStyle = pen.col(role); ctx.lineWidth = w; ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(rect.x + 8, y); ctx.lineTo(rect.x + 28, y); ctx.stroke(); ctx.restore()
                pen.labelPx(rect.x + 32, y, text, { role, size: 10, base: 'middle' }) }
            key(0, [4, 3], 1, 'soft', 's'); key(1, [1, 3], 1, 'soft', 'p'); key(2, [], 2, 'accent', 'their average')
            const mark = (deg, label, up = 0) => { ctx.save(); ctx.strokeStyle = pen.col('soft'); ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(X(deg), rect.y); ctx.lineTo(X(deg), rect.y + rect.h); ctx.stroke(); ctx.restore(); pen.labelPx(X(deg) + 3, rect.y + rect.h - 30 - up, label, { role: 'soft', size: 10 }) }
            mark(brewsterDeg(s.n, s.side), 'p = 0')
            // from inside the two marks are a few degrees apart (33.7 and 41.8 at 1.5): the second one higher
            if (s.side === 'glass' && s.n > 1) mark(criticalDeg(s.n), 'critical', 16)
            void W; void H
        },
        readout(s) {
            const f = interfaceAt(s.theta, s.n, s.side), [ni, nt] = s.side === 'glass' ? [s.n, 1] : [1, s.n]
            const snell = f.t ? `θ = ${s.theta}° bends to ${f.thetaT.toFixed(2)}° (${ni.toFixed(2)} sin ${s.theta}° = ${nt.toFixed(2)} sin ${f.thetaT.toFixed(2)}°)` : `θ = ${s.theta}° is past the critical angle, ${criticalDeg(s.n).toFixed(2)}°: no refracted ray`
            return `${snell} · reflected: s ${pct(f.s)}, p ${pct(f.p)}, unpolarised ${pct(f.R)} · the rest, ${pct(1 - f.R)}, refracts${s.side === 'glass' ? ` · critical angle asin(1/${s.n.toFixed(2)}) = ${criticalDeg(s.n).toFixed(2)}°` : ''}`
        },
    },

    slab: {
        aspect: 1.7,
        world: { x: [-3.5, 3.5], y: [-2.35, 1.75] },
        state: { theta: 45, n: 1.5, colour: 1, depth: 1 },
        controls: [
            { type: 'slider', key: 'theta', label: 'angle', min: 0, max: 85, step: 1, fmt: v => `${v}°` },
            { type: 'slider', key: 'n', label: 'index n', min: 1.05, max: 2.5, step: 0.01, fmt: v => v.toFixed(2) },
            { type: 'slider', key: 'colour', label: 'colour (1 = clear)', min: 0.05, max: 1, step: 0.05, fmt: v => v.toFixed(2) },
            { type: 'slider', key: 'depth', label: 'colour depth', min: 0.25, max: 4, step: 0.25, fmt: v => `${v} × the thickness`, when: s => s.colour < 1 },
        ],
        steps: { clear: { theta: 45, n: 1.5, colour: 1, depth: 1 }, steep: { theta: 78, n: 1.5, colour: 1, depth: 1 }, absorbing: { theta: 45, n: 1.5, colour: 0.5, depth: 1 } },
        draw(pen, s) {
            const P = slabPasses(s.theta, s.n, s.colour, s.colour < 1 ? s.depth : 0, 12), { ctx } = pen
            ctx.save(); ctx.fillStyle = pen.col('glass'); ctx.globalAlpha = 0.13 + 0.25 * (1 - s.colour); ctx.fillRect(pen.X(-3.3), pen.Y(0), pen.X(3.3) - pen.X(-3.3), pen.Y(-1) - pen.Y(0)); ctx.restore()
            pen.line([-3.3, 0], [3.3, 0], { role: 'glass', w: 1.4, exact: true }); pen.line([-3.3, -1], [3.3, -1], { role: 'glass', w: 1.4, exact: true })
            const th = s.theta * DEG, thT = Math.asin(Math.sin(th) / s.n), dx = Math.tan(thT), x0 = -2.6 + (s.theta > 60 ? -0.4 : 0)
            const out = 1.1, w = e => 0.4 + 4 * e, a = e => clamp(0.25 + 0.75 * Math.sqrt(e), 0, 1)
            // the incoming ray, as long as fits: at 78 degrees a fixed length ran off the left edge
            const inLen = Math.min(1.3, (x0 + 3.45) / (out * Math.sin(th) || 1))
            pen.ray([x0 - out * Math.sin(th) * inLen, out * Math.cos(th) * inLen], [x0, 0], { role: 'light', w: w(1), id: 'in' })
            pen.ray([x0, 0], [x0 + out * Math.sin(th), out * Math.cos(th)], { role: 'light', w: w(P.R), alpha: a(P.R), id: 'r0' })
            let x = x0, y = 0
            for (let k = 0; k < P.inside.length; k++) {
                const nx = x + dx, ny = y === 0 ? -1 : 0
                if (nx > 3.3) break
                pen.line([x, y], [nx, ny], { role: 'glass', w: w(P.inside[k]), alpha: a(P.inside[k]), exact: true })
                const e = P.inside[k] * (1 - P.R), dir = ny === -1 ? -1 : 1
                pen.ray([nx, ny], [nx + out * Math.sin(th), ny + dir * out * Math.cos(th)], { role: 'light', w: w(e), alpha: a(e), arrow: e > 0.01, exact: true })
                if (k < 3) pen.label([nx + out * Math.sin(th) + 0.05, ny + dir * (out * Math.cos(th) + 0.15)], (100 * e).toFixed(1) + '%', { role: 'light', size: 11, align: 'center' })
                x = nx; y = ny
            }
            pen.label([x0 + out * Math.sin(th) + 0.05, out * Math.cos(th) + 0.15], pct(P.R), { role: 'light', size: 11, align: 'center' })
        },
        readout(s) {
            const depth = s.colour < 1 ? s.depth : 0, P = slabPasses(s.theta, s.n, s.colour, depth), closed = depth > 0 ? absorbingSlabT(s.theta, s.n, 1, s.colour, depth) : slabT(s.theta, s.n).model
            const pol = depth > 0 ? '' : ` (with polarisation kept through the slab: ${pct(slabT(s.theta, s.n).polarised)})`
            return `each face reflects R = ${pct(P.R)}${depth > 0 ? `, and a pass keeps t = ${pct(P.t)}` : ''} · through it: ${pct(P.below[0])} the first time, ${pct(P.T)} with every bounce (the closed form: ${pct(closed)}${pol}) · reflected ${pct(P.Rall)}${depth > 0 ? ` · absorbed ${pct(1 - P.T - P.Rall)}` : ''}`
        },
    },

    ball: {
        aspect: 2.0,
        world: { x: [-3.3, 4.6], y: [-1.98, 1.98] },
        state: { n: 1.5, rays: 13, refl: false },
        controls: [
            { type: 'slider', key: 'n', label: 'index n', min: 1.05, max: 2.5, step: 0.01, fmt: v => v.toFixed(2) },
            { type: 'seg', key: 'rays', options: [[13, '13 rays'], [31, '31']] },
            { type: 'toggle', key: 'refl', label: 'Show what reflects' },
        ],
        steps: { glass: { n: 1.5, rays: 13, refl: false }, water: { n: 1.33, rays: 13, refl: false }, diamond: { n: 2.42, rays: 13, refl: false } },
        draw(pen, s) {
            pen.circle([0, 0], 1, { role: 'glass', fill: 'fill', w: 1.6, id: 'ball' })
            pen.line([-3.2, 0], [4.5, 0], { role: 'faint', w: 0.6, dash: [2, 5], exact: true })
            const w = e => 0.4 + 1.8 * e, a = e => clamp(0.3 + 0.7 * e, 0, 1)
            for (let k = 0; k < s.rays; k++) {
                const h = (2 * k / (s.rays - 1) - 1) * 0.94, b = traceBall(h, s.n)
                if (!b) continue
                for (const g of b.segs) pen.line(g.a, g.b, { role: g.inside ? 'glass' : 'light', w: w(g.e), alpha: a(g.e), exact: true })
                if (b.out) { const L = 6; pen.line(b.out.a, [b.out.a[0] + b.out.d[0] * L, b.out.a[1] + b.out.d[1] * L], { role: 'light', w: w(b.out.e), alpha: a(b.out.e), exact: true }) }
                if (s.refl) pen.line(b.reflected.a, [b.reflected.a[0] + b.reflected.d[0] * 1.2, b.reflected.a[1] + b.reflected.d[1] * 1.2], { role: 'light', w: 0.8, alpha: clamp(0.2 + 3 * b.reflected.e, 0, 1), exact: true })
            }
            const f = ballFocus(s.n)
            if (f > 1) { pen.dot([f, 0], { role: 'accent', r: 4 }); pen.label([f, -0.28], 'focus near the axis', { role: 'accent', size: 11, align: 'center' }) }
            else {
                // the label below the ball with a leader, clear of the rays (on the dot it sat under them)
                const c = frontFocus(s.n); pen.dot([c, 0], { role: 'accent', r: 4 })
                pen.line([c, -0.06], [0.35, -1.18], { role: 'accent', w: 0.8, exact: true }); pen.label([0.35, -1.32], 'the rays cross here, inside the ball', { role: 'accent', size: 11, align: 'center' })
            }
        },
        readout(s) {
            const f = ballFocus(s.n), near = axisCross(0.02, s.n), far = axisCross(0.9, s.n)
            if (f <= 1) return `index ${s.n.toFixed(2)}: rays near the axis cross it inside the ball, ${frontFocus(s.n).toFixed(3)} past the centre (n / (n − 1) − 1), and leave spreading apart: no focus behind the ball (n / (2(n − 1)) = ${f.toFixed(3)} is under 1)`
            return `index ${s.n.toFixed(2)}: rays near the axis meet ${f.toFixed(3)} from the centre (n / (2(n − 1))) · traced, a ray 0.02 off the axis crosses it at ${near == null ? '—' : near.toFixed(3)}, one 0.9 off at ${far == null ? '— (it never leaves)' : far.toFixed(3)}${far != null && near != null ? (far < near ? ': the outer rays focus nearer' : ': here the outer rays cross further out') : ''}`
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
