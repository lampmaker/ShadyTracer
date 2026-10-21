//======================================================================================================================
// CHAPTER "Numbers have grain": its figures.
//
//   fatten   a ray has hit once it is within the tolerance: a small lamp traced fatter than it is (parallel rays at
//            its face, those that count only by the tolerance marked), and two slabs of glass whose gap a ray leaving
//            the first steps over; the 3D numbers by kit/grain.js discFatten, the light let through by fresnel.js
//   terms    the tolerance at a point, its three terms against the distance from the origin, for a scene's size, by
//            tolerances.js and photometry.js; and the floor before 0.36.0, in a millimetre scene
//   lint     a few lines of engine code with one planted, linted by the real unitlint.js against the real boundary
//======================================================================================================================

import { boot } from '../kit/page.js'
import { plot } from '../kit/plot.js'
import * as G from '../kit/grain.js'

const fmtLen = m => m >= 1 ? `${+m.toPrecision(3)} m` : m >= 1e-3 ? `${+(m * 1e3).toPrecision(3)} mm` : m >= 1e-6 ? `${+(m * 1e6).toPrecision(3)} µm` : `${+(m * 1e9).toPrecision(3)} nm`
export { fmtLen }

/* THE LAMP, in millimetres for the drawing: its face a segment of half length 10 at the middle, turned `tilt` from
   facing the rays, which come from the left */
export function lampRays(eps, tilt, n = 57) {
    const r = G.LAMP_R * 1e3, e = eps * 1e3, t = tilt * Math.PI / 180
    const ux = Math.sin(t), uy = Math.cos(t)                 // along the face
    const out = []
    for (let i = 0; i < n; i++) {
        const y = -14 + 28 * i / (n - 1)
        // the ray y = const meets the face's line at s (along it) when uy s = y; nearest distance to the segment
        const s = y / uy, sc = Math.max(-r, Math.min(r, s)), d = Math.abs(y - uy * sc) * (Math.abs(s) > r ? 1 : 0)
        // distance from the line y to the segment's nearest point, measured across the ray (parallel to y)
        const dist = Math.abs(s) <= r ? 0 : Math.min(Math.hypot(0, y - uy * r) , Math.hypot(0, y + uy * r))
        out.push({ y, face: Math.abs(s) <= r, fat: Math.abs(s) > r && dist < e + 1e-12 && d >= 0, x: ux * sc })
    }
    return out
}

export const figures = {
    fatten: {
        aspect: 2,
        world: { x: [-30, 30], y: [-15, 15] },
        state: { what: 'lamp', lv: Math.log10(G.LAMP_EPS), tilt: G.LAMP_TILT },
        controls: [
            { type: 'seg', key: 'what', options: [['lamp', 'A small lamp'], ['gap', 'A thin gap']] },
            { type: 'slider', key: 'lv', label: 'the tolerance', min: -6, max: -2.5, step: 0.05, fmt: v => fmtLen(10 ** v) },
            { type: 'slider', key: 'tilt', label: 'seen off its axis', min: 0, max: 75, step: 1, fmt: v => `${v}°`, when: s => s.what === 'lamp' },
        ],
        steps: {
            lamp: { what: 'lamp', lv: Math.log10(G.LAMP_EPS), tilt: G.LAMP_TILT }, fine: { what: 'lamp', lv: -5, tilt: G.LAMP_TILT },
            gap: { what: 'gap', lv: -4 }, gapfine: { what: 'gap', lv: -5 },
        },
        draw(pen, s) {
            const eps = 10 ** s.lv
            if (s.what === 'lamp') {
                const t = s.tilt * Math.PI / 180, r = 10, e = eps * 1e3, ux = Math.sin(t), uy = Math.cos(t)
                const a = [-ux * r, -uy * r], b = [ux * r, uy * r]
                // the rays from the left, to the face or past it
                for (const q of lampRays(eps, s.tilt)) {
                    const end = q.face || q.fat ? q.x : 28
                    pen.line([-28, q.y], [end, q.y], { role: q.fat ? 'accent' : q.face ? 'cam' : 'faint', w: q.fat ? 1.6 : 0.9, dash: [] })
                }
                // the tolerance's band round the face: what a ray need only come within
                const band = []
                for (let k = 0; k <= 24; k++) { const ang = Math.atan2(uy, ux) + Math.PI / 2 + Math.PI * k / 24; band.push([b[0] + e * Math.cos(ang), b[1] + e * Math.sin(ang)]) }
                for (let k = 0; k <= 24; k++) { const ang = Math.atan2(uy, ux) - Math.PI / 2 + Math.PI * k / 24; band.push([a[0] + e * Math.cos(ang), a[1] + e * Math.sin(ang)]) }
                band.push(band[0])
                pen.poly(band, { role: 'accent', w: 1, dash: [3, 2] })
                pen.line(a, b, { role: 'light', w: 3.5, dash: [] })
                // the disc's axis, square to its face: the angle the rays come in at is measured from it
                pen.line([-uy * 12, ux * 12], [uy * 12, -ux * 12], { role: 'soft', w: 1, dash: [2, 3] })
                pen.label([uy * 12 + 1, -ux * 12 - 1], `its axis, ${s.tilt}° off the rays`, { role: 'ink', size: 11, align: 'left', bg: true })
                pen.label([b[0] + 1.5, b[1] + 1], 'the lamp\'s face, 2 cm across', { role: 'light', size: 12 })
                pen.label([-28, 13.5], 'rays from the camera', { role: 'soft', size: 11 })
                pen.label([12, -12.5], `dashed: within ${fmtLen(eps)} of the face`, { role: 'accent', size: 11 })
            } else {
                // two slabs, 0.5 mm apart, drawn in tenths of a millimetre (x 10): the world is 6 mm wide
                const k = 10, gap = G.GAP * 1e3 * k / 2, e = eps * 1e3 * k
                pen.shape([[-28, -12], [-gap, -12], [-gap, 12], [-28, 12]], { role: 'glass', fill: 'fill', w: 1 })
                pen.shape([[gap, -12], [28, -12], [28, 12], [gap, 12]], { role: 'glass', fill: 'fill', w: 1 })
                pen.label([-27, 13.5], 'glass', { role: 'glass', size: 11 })
                pen.label([gap + 1, 13.5], 'glass', { role: 'glass', size: 11 })
                pen.label([0, -13.5], 'a gap of 0.5 mm', { role: 'soft', size: 11, align: 'center' })
                // the ray reaches the first slab's back face, and the medium beyond is asked twenty tolerances across
                const y = 4, probe = G.PROBE * e, land = -gap + probe, seen = G.gapSeen(G.GAP, eps)
                pen.line([-28, y], [-gap, y], { role: 'cam', w: 1.6, dash: [] })
                pen.line([-gap, y], [Math.min(land, 28), y], { role: seen ? 'cam' : 'blocked', w: 2.2, dash: [4, 3] })
                pen.dot([Math.min(land, 28), y], { role: seen ? 'cam' : 'blocked', r: 4 })
                pen.label([Math.min(land, 26), y + 2.5], seen ? 'air beyond: a face, as it should be' : 'glass beyond: no face here, one slab', { role: seen ? 'cam' : 'blocked', size: 11, align: land > 10 ? 'right' : 'left' })
                pen.label([-gap + 1, y - 3.5], `the medium beyond, asked 20 tolerances (${fmtLen(G.PROBE * eps)}) across`, { role: 'soft', size: 11, align: 'left' })
            }
        },
        readout(s) {
            const eps = 10 ** s.lv
            if (s.what === 'lamp') {
                const d3 = G.discFatten(G.LAMP_R, eps, s.tilt)
                return `tolerance ${fmtLen(eps)} · in the flat world the face is traced ${G.flatFatten(G.LAMP_R, eps, s.tilt).toFixed(3)} × as wide · the disc of radius 1 cm in 3D, seen ${s.tilt}° off its axis, ${d3.toFixed(3)} × its area, so ${d3.toFixed(3)} × the light · the bench's pair predicted to read ${(1 / d3).toFixed(3)}`
            }
            const seen = G.gapSeen(G.GAP, eps)
            return `tolerance ${fmtLen(eps)}, the medium beyond asked ${fmtLen(G.PROBE * eps)} across · the gap ${seen ? 'seen: two slabs' : 'lost: one slab'} · light let straight through ${G.gapT(G.GAP, eps).toFixed(3)} (two slabs ${G.gapT(G.GAP, 0).toFixed(3)}, one ${G.gapT(G.GAP, 1).toFixed(3)})`
        },
    },

    terms: {
        aspect: 1.8,
        world: { x: [0, 1.8], y: [0, 1] },
        state: { ext: Math.log10(0.105), dist: Math.log10(0.05), typed: 'auto', rule: 'now' },
        controls: [
            { type: 'slider', key: 'ext', label: 'the scene\'s size', min: -2, max: 3, step: 0.05, fmt: v => fmtLen(10 ** v) },
            { type: 'slider', key: 'dist', label: 'the point, from the origin', min: -3, max: 4, step: 0.05, fmt: v => fmtLen(10 ** v) },
            { type: 'seg', key: 'typed', label: 'the setting', options: [['auto', 'automatic'], ['10nm', '10 nm typed']] },
            { type: 'seg', key: 'rule', label: 'the floor', options: [['now', 'today\'s'], ['old', 'before 0.36.0, a mm scene']] },
        ],
        steps: {
            optic: { ext: Math.log10(0.105), dist: Math.log10(0.05), typed: 'auto', rule: 'now' },
            far: { ext: Math.log10(0.105), dist: Math.log10(2), typed: 'auto', rule: 'now' },
            room: { ext: 1, dist: Math.log10(5), typed: 'auto', rule: 'now' },
            old: { ext: 1, dist: 1, typed: '10nm', rule: 'old' },
        },
        draw(pen, s) {
            const { W, H } = pen.view, box = { x: W * 0.1, y: H * 0.1, w: W * 0.86, h: H * 0.72 }
            const typed = s.typed === '10nm' ? 1e-8 : 0, E = 10 ** s.ext, D = 10 ** s.dist
            const setting = typed || G.autoEps(E, 'm'), xs = []
            for (let v = -3; v <= 4.0001; v += 0.05) xs.push(v)
            const lg = Math.log10
            const floorAt = x => s.rule === 'old' ? G.oldFloor(1e-3) : G.f32Floor([x, 0, 0])
            const tolAt = x => Math.max(setting, s.rule === 'old' ? 0 : G.TOL_MIN_M, floorAt(x))
            const series = [
                { name: 'one f32 step', pts: xs.map(v => [v, lg(G.F32_STEP * 10 ** v)]), role: 'soft', w: 1, dash: [2, 3] },
                { name: s.rule === 'old' ? 'the old floor, 1e-7 mm' : 'the floor, 128 steps', pts: xs.map(v => [v, lg(floorAt(10 ** v))]), role: 'blocked', w: 1.2 },
                { name: typed ? 'the setting, 10 nm' : 'the automatic tolerance', pts: [[-3, lg(setting)], [4, lg(setting)]], role: 'light', w: 1.2 },
                { name: 'the tolerance in use', pts: xs.map(v => [v, lg(tolAt(10 ** v))]), role: 'cam', w: 3 },
            ]
            if (s.rule !== 'old') series.splice(2, 0, { name: 'the minimum, 1 nm', pts: [[-3, -9], [4, -9]], role: 'faint', w: 1 })
            pen.labelPx(box.x - 30, box.y - 22, 'lengths against the distance from the origin, both on log scales', { role: 'soft', size: 12 })
            plot(pen, box, {
                x: [-3, 4], y: [-10.5, -0.5], xticks: [-3, -2, -1, 0, 1, 2, 3, 4], yticks: [-10, -9, -6, -3, -1],
                fmt: v => fmtLen(10 ** v), hoverX: v => `${fmtLen(10 ** v)} from the origin`, hoverY: v => fmtLen(10 ** v), series,
            })
            const X = v => box.x + (v + 3) / 7 * box.w, Y = v => box.y + box.h - (v + 10.5) / 10 * box.h
            // each line named on the plot, at its left end (the tolerance in use at its right)
            const at = (v, y, text, role, align = 'left') => pen.labelPx(X(v), Y(y) - 3, text, { role, size: 10, align, base: 'bottom' })
            at(-2.9, lg(G.F32_STEP * 10 ** -2.9), '2^-23 × distance', 'soft')
            at(-2.9, lg(floorAt(10 ** -2.9)), s.rule === 'old' ? 'the old floor' : 'the floor', 'blocked')
            if (s.rule !== 'old') at(-1.2, -9, 'a nanometre', 'soft')
            at(3.0, lg(setting), typed ? 'the setting' : 'the automatic tolerance', 'light', 'right')
            at(3.95, lg(tolAt(10 ** 3.95)), 'in use', 'cam', 'right')
            pen.ctx.save(); pen.ctx.fillStyle = pen.col('accent'); pen.ctx.beginPath(); pen.ctx.arc(X(s.dist), Y(lg(tolAt(D))), 5, 0, 7); pen.ctx.fill(); pen.ctx.restore()
        },
        readout(s) {
            const typed = s.typed === '10nm' ? 1e-8 : 0, E = 10 ** s.ext, D = 10 ** s.dist
            if (s.rule === 'old') {
                const tol = Math.max(typed || G.autoEps(E, 'm'), G.oldFloor(1e-3)), step = G.F32_STEP * D
                return `before 0.36.0, in a mm scene: the floor 1e-7 mm = ${fmtLen(G.oldFloor(1e-3))} · the tolerance ${fmtLen(tol)} at ${fmtLen(D)} from the origin, where 2^-23 × the distance, one to two f32 steps, is ${fmtLen(step)}: ${tol < step ? `${Math.round(step / tol)} times finer than that` : 'coarser than that'}`
            }
            const t = G.terms({ extent: E, dist: D, typed })
            return `a scene ${fmtLen(E)} across, its automatic tolerance ${fmtLen(G.autoEps(E, 'm'))}${typed ? ', 10 nm typed instead' : ''} · at ${fmtLen(D)} from the origin the floor is ${fmtLen(t.floor)}, so ${t.wins} wins: ${fmtLen(t.tol)} · the floor passes the setting beyond ${fmtLen(t.beyond)}`
        },
    },

    lint: {
        aspect: 1.9,
        world: { x: [0, 1.9], y: [0, 1] },
        state: { plant: 'none' },
        controls: [
            { type: 'seg', key: 'plant', options: Object.entries(G.PLANTS).map(([k, v]) => [k, v.label]) },
        ],
        steps: { clean: { plant: 'none' }, direct: { plant: 'sdf' }, eps: { plant: 'eps' }, tol: { plant: 'tol' }, deep: { plant: 'deep' }, unit: { plant: 'unit' } },
        draw(pen, s) {
            const { W, H } = pen.view, p = G.PLANTS[s.plant], found = G.lint(s.plant)
            const lines = [...(p.helper ? [p.helper, ''] : []), 'fn main() {', ...G.KERNEL.map(l => '    ' + l), ...(p.line ? ['    ' + p.line] : []), '}']
            let y = H * 0.08
            pen.labelPx(W * 0.04, y, 'an engine kernel (a few lines of one), as WGSL', { role: 'soft', size: 11, base: 'top' }); y += 22
            // the code in a frame, a band behind the planted line
            const { ctx } = pen, top = y - 4
            for (const l of lines) {
                const planted = (p.line && l.trim() === p.line.trim()) || (p.helper && l === p.helper)
                if (planted) { ctx.save(); ctx.fillStyle = pen.col('accent'); ctx.globalAlpha = 0.12; ctx.fillRect(W * 0.04, y - 2, W * 0.93, 17); ctx.restore() }
                pen.labelPx(W * 0.05, y, l, { role: planted ? 'accent' : 'ink', size: 11, base: 'top', kind: 'mono' })
                y += 17
            }
            ctx.save(); ctx.strokeStyle = pen.col('faint'); ctx.lineWidth = 1; ctx.strokeRect(W * 0.035, top, W * 0.94, y - top + 2); ctx.restore()
            y += 14
            // the verdict's mark: a dot, the colour of clean or of a complaint
            ctx.save(); ctx.fillStyle = pen.col(found.length ? 'blocked' : 'cam'); ctx.beginPath(); ctx.arc(W * 0.04 + 4, y + 7, 4, 0, 7); ctx.fill(); ctx.restore()
            pen.labelPx(W * 0.04 + 14, y, 'unitlint.js says:', { role: 'soft', size: 11, base: 'top' }); y += 20
            if (!found.length) pen.labelPx(W * 0.05, y, 'nothing: the engine meets the scene only through the boundary', { role: 'cam', size: 11, base: 'top', kind: 'mono' })
            for (const f of found) {
                // wrapped at about 90 characters a line
                const words = f.split(' '), rows = ['']
                for (const w of words) { if ((rows[rows.length - 1] + ' ' + w).length > 76) rows.push(''); rows[rows.length - 1] += (rows[rows.length - 1] ? ' ' : '') + w }
                for (const r of rows) { pen.labelPx(W * 0.05, y, r, { role: 'blocked', size: 11, base: 'top', kind: 'mono' }); y += 16 }
            }
        },
        readout(s) {
            const f = G.lint(s.plant)
            return `${G.PLANTS[s.plant].label}: ${f.length ? `${f.length} complaint${f.length > 1 ? 's' : ''}, and check-shaders fails` : 'clean, as every real kernel is against every scene'}`
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
