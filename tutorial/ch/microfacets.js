//======================================================================================================================
// CHAPTER "Rough and shiny": its figures.
//
//   lobe    a rough metal seen from a view you drag, in the plane of incidence: the GGX lobe of reflected light, and
//           directions drawn as the renderer draws them (visible normals, Dupuy & Benyoub's spherical caps), the ones
//           that go below the surface lost
//   albedo  how much light one reflection off a white rough metal keeps, E, at every view: integrated the way the
//           renderer's tables are (a 32 x 32 grid, warped towards the rim) against the plain grid it used to use and a
//           fine reference -- and what a white metal then reads in a furnace, E_true / E_table
//   oldpdf  the old sampler's density against the true one, over the reflected directions: equal straight on, wrong
//           everywhere else
//
// THE GGX HERE IS A TEACHING MIRROR of core/microfacet.js's WGSL, isotropic, line for line: the renderer keeps its one
// GGX on the GPU on purpose ("a JS copy of GGX would be a second model", its header), and this copy is not used by it.
// The test holds it to closed forms (D integrates to 1, the visible-normal draw's density, Smith's G1 <= 1) and to the
// number the renderer's own comment records for its old grid (0.97850 at roughness 0.3).
//======================================================================================================================

import { boot } from '../kit/page.js'
import { plot } from '../kit/plot.js'
import { rng } from '../kit/flatland.js'

const PI = Math.PI, DEG = PI / 180
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l] }
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/* THE MIRROR, isotropic (a.x = a.y = alpha), in the surface's frame, z the normal */
export const lambda = (w, a) => { const z2 = Math.max(w[2] * w[2], 1e-12), t2 = a * a * (w[0] * w[0] + w[1] * w[1]) / z2; return 0.5 * (-1 + Math.sqrt(1 + t2)) }
export const G1 = (w, a) => 1 / (1 + lambda(w, a))
export const G2 = (o, i, a) => 1 / (1 + lambda(o, a) + lambda(i, a))
export const D = (h, a) => { if (h[2] <= 0) return 0; const t = (h[0] * h[0] + h[1] * h[1]) / (a * a) + h[2] * h[2]; return 1 / (PI * a * a * t * t) }
/** a visible normal for view o, by spherical caps (mfSampleVNDF) */
export function vndf(o, a, u) {
    const os = norm([o[0] * a, o[1] * a, o[2]]), phi = 2 * PI * u[0], z = (1 - u[1]) * (1 + os[2]) - os[2]
    const st = Math.sqrt(clamp(1 - z * z, 0, 1)), hs = [st * Math.cos(phi) + os[0], st * Math.sin(phi) + os[1], z + os[2]]
    return norm([hs[0] * a, hs[1] * a, Math.max(hs[2], 1e-7)])
}
export const reflect = (o, h) => { const d = 2 * dot(o, h); return [d * h[0] - o[0], d * h[1] - o[1], d * h[2] - o[2]] }
/** the density of reflect(o, h) with h drawn by vndf: G1(o) D(h) / (4 o.z) (mfPdfReflect) */
export const pdfReflect = (o, i, a) => (o[2] <= 0 || i[2] <= 0) ? 0 : G1(o, a) * D(norm([o[0] + i[0], o[1] + i[1], o[2] + i[2]]), a) / (4 * o[2])
/** the old one: D G1 (n.h) / (4 o.h) -- the microfacet.js comment's "D Gv NoH / (4 VoH)" */
export const pdfOld = (o, i, a) => { if (o[2] <= 0 || i[2] <= 0) return 0; const h = norm([o[0] + i[0], o[1] + i[1], o[2] + i[2]]); return D(h, a) * G1(o, a) * h[2] / (4 * dot(o, h)) }

/** E: the share of light a white metal (F = 1) keeps in one reflection seen from cos theta = mu, roughness r -- the
 *  table's integrand F G2 / G1 over a grid of n x n draws, warped towards the rim as prog_mf_lut does, or plain */
export function albedo(mu, r, n = 32, warp = true) {
    const a = r * r, st = Math.sqrt(Math.max(0, 1 - mu * mu)), o = [st, 0, mu]
    let acc = 0
    for (let sy = 0; sy < n; sy++) for (let sx = 0; sx < n; sx++) {
        const v0 = (sx + 0.5) / n, v1 = (sy + 0.5) / n, u = warp ? [v0, 1 - (1 - v1) * (1 - v1)] : [v0, v1], w = warp ? 2 * (1 - v1) : 1
        const i = reflect(o, vndf(o, a, u))
        if (i[2] > 0) acc += w * G2(o, i, a) / G1(o, a)
    }
    return acc / (n * n)
}
const ALB = new Map()
const albedoCached = (mu, r, n, warp) => { const k = `${mu}|${r}|${n}|${warp}`; if (!ALB.has(k)) { if (ALB.size > 4000) ALB.clear(); ALB.set(k, albedo(mu, r, n, warp)) } return ALB.get(k) }

/* the view as a direction in the plane of incidence (x, z): theta from the normal, positive towards +x */
const dirAt = th => [Math.sin(th * DEG), 0, Math.cos(th * DEG)]
/** f cos theta_i for a white metal, in the plane: what the lobe draws (D G2 / (4 o.z)) */
const lobeAt = (o, thI, a) => { const i = dirAt(thI); if (i[2] <= 0) return 0; const h = norm([o[0] + i[0], o[1] + i[1], o[2] + i[2]]); return D(h, a) * G2(o, i, a) / (4 * o[2]) }

export const figures = {
    lobe: {
        aspect: 1.7,
        world: { x: [-2.75, 2.75], y: [-0.45, 2.75] },
        state: { view: -40, r: 0.4, seed: 2 },
        controls: [
            { type: 'slider', key: 'r', label: 'roughness', min: 0.05, max: 1, step: 0.05, fmt: v => v.toFixed(2) },
            { type: 'button', label: 'New directions', act: s => { s.seed++ } },
        ],
        steps: { smooth: { view: -40, r: 0.15, seed: 2 }, rough: { view: -40, r: 0.6, seed: 2 }, grazing: { view: -78, r: 0.6, seed: 2 } },
        drag: { view: (s, p) => { s.view = Math.round(clamp(Math.atan2(p[0], Math.max(p[1], 0.05)) / DEG, -85, 85)) } },
        draw(pen, s) {
            const a = s.r * s.r, o = dirAt(s.view), R = rng(s.seed * 7919 + 3)
            pen.flat({ kind: 'box', c: [0, -0.2], h: [2.6, 0.2] }, { id: 'surface' })
            // the reflected directions as the renderer draws them, seen flattened onto the page; below the surface, lost
            for (let k = 0; k < 60; k++) {
                const i = reflect(o, vndf(o, a, [R(), R()])), l = Math.hypot(i[0], i[2]) || 1
                pen.ray([0, 0], [i[0] / l * 1.9, i[2] / l * 1.9], { role: i[2] > 0 ? 'cam' : 'blocked', w: 0.7, alpha: 0.5, arrow: false, exact: true })
            }
            // the lobe: f cos theta_i over the plane's directions, scaled so its peak reaches 2.3
            const ths = Array.from({ length: 181 }, (_, k) => -90 + k), vals = ths.map(t => lobeAt(o, t, a)), peak = Math.max(...vals, 1e-9)
            pen.poly(ths.map((t, k) => { const d = dirAt(t), r = 2.3 * vals[k] / peak; return [d[0] * r, d[2] * r] }), { role: 'accent', w: 2, exact: true, id: 'lobe' })
            const m = dirAt(-s.view)
            pen.line([0, 0], [m[0] * 2.5, m[2] * 2.5], { role: 'soft', w: 1, dash: [3, 4], exact: true })
            pen.label([m[0] * 2.55, m[2] * 2.55], 'mirror', { role: 'soft', size: 11, align: 'center' })
            pen.ray([o[0] * 2.4, o[2] * 2.4], [0, 0], { role: 'light', w: 1.6, id: 'in' })
            pen.handle('view', [o[0] * 2.45, o[2] * 2.45], { role: 'light', label: 'light in' })
        },
        readout(s) {
            const E = albedoCached(Math.cos(s.view * DEG), s.r, 32, true)
            return `roughness ${s.r.toFixed(2)} (α = ${(s.r * s.r).toFixed(4)}), light ${Math.abs(s.view)}° from the normal · one reflection off a white metal keeps E = ${E.toFixed(4)} of it; ${(100 * (1 - E)).toFixed(2)}% goes into the surface between the facets and is lost to a single reflection`
        },
    },

    albedo: {
        aspect: 1.75,
        world: { x: [0, 1], y: [0, 1] },
        state: { r: 0.3 },
        controls: [{ type: 'slider', key: 'r', label: 'roughness', min: 0.1, max: 1, step: 0.05, fmt: v => v.toFixed(2) }],
        steps: { r03: { r: 0.3 }, rough: { r: 1 } },
        draw(pen, s) {
            const { W, H } = pen.view, rect = { x: W * 0.1, y: H * 0.07, w: W * 0.86, h: H * 0.42 }, rect2 = { x: W * 0.1, y: H * 0.62, w: W * 0.86, h: H * 0.26 }
            const mus = Array.from({ length: 33 }, (_, k) => 0.02 + 0.98 * k / 32)
            const fine = mus.map(m => albedoCached(m, s.r, 160, true)), plain = mus.map(m => albedoCached(m, s.r, 32, false)), warp = mus.map(m => albedoCached(m, s.r, 32, true))
            const ang = m => Math.acos(m) / DEG, lo = Math.min(...fine) - 0.03
            plot(pen, rect, {
                x: [0, 90], y: [Math.max(0, Math.floor(lo * 20) / 20), 1], xticks: [], fmt: v => v.toFixed(2), hoverX: v => `${v.toFixed(0)}° from the normal`, hoverY: v => v.toFixed(5),
                series: [
                    { name: 'fine (160 × 160)', pts: mus.map((m, k) => [ang(m), fine[k]]), role: 'ink', w: 1.6 },
                    { name: 'the old plain 32 × 32', pts: mus.map((m, k) => [ang(m), plain[k]]), role: 'blocked', kind: 'dots', r: 2.6 },
                    { name: 'the warped 32 × 32', pts: mus.map((m, k) => [ang(m), warp[k]]), role: 'cam', kind: 'dots', r: 2.6, ring: true },
                ],
            })
            pen.labelPx(rect.x - 30, rect.y - 18, 'E: the share one reflection keeps, by the view\'s angle from the normal', { role: 'soft', size: 12 })
            // what a white metal reads in a furnace when the table is the plain or the warped grid: E_true / E_table
            plot(pen, rect2, {
                // one fmt serves both axes, so the angles leave out 0 (it would print as 0.00)
                x: [0, 90], y: [0.99, 1.01], xticks: [30, 60, 90], yticks: [0.99, 1, 1.01], fmt: v => v >= 2 ? `${v}°` : v.toFixed(2),
                hoverX: v => `${v.toFixed(0)}°`, hoverY: v => v.toFixed(4),
                series: [
                    { name: 'with the plain table', pts: mus.map((m, k) => [ang(m), fine[k] / plain[k]]), role: 'blocked', w: 1.4 },
                    { name: 'with the warped table', pts: mus.map((m, k) => [ang(m), fine[k] / warp[k]]), role: 'cam', w: 1.4 },
                ],
            })
            pen.labelPx(rect2.x - 30, rect2.y - 18, 'a white metal in a furnace, where the table compensates: E_true / E_table', { role: 'soft', size: 12 })
        },
        readout(s) {
            const f = albedoCached(0.5, s.r, 160, true), p = albedoCached(0.5, s.r, 32, false), w = albedoCached(0.5, s.r, 32, true)
            return `roughness ${s.r.toFixed(2)}, the view 60° from the normal: E = ${f.toFixed(5)} (fine), the plain 32 × 32 grid ${p.toFixed(5)}, the warped one ${w.toFixed(5)} · a white metal compensated by each reads ${(f / p).toFixed(4)} and ${(f / w).toFixed(4)}`
        },
    },

    oldpdf: {
        aspect: 1.9,
        world: { x: [0, 1], y: [0, 1] },
        state: { view: 0, r: 0.4 },
        controls: [
            { type: 'slider', key: 'view', label: 'the view', min: 0, max: 85, step: 1, fmt: v => `${v}° from the normal` },
            { type: 'slider', key: 'r', label: 'roughness', min: 0.1, max: 1, step: 0.05, fmt: v => v.toFixed(2) },
        ],
        steps: { straight: { view: 0, r: 0.4 }, slant: { view: 60, r: 0.4 }, grazing: { view: 80, r: 0.4 } },
        draw(pen, s) {
            const { W, H } = pen.view, rect = { x: W * 0.1, y: H * 0.1, w: W * 0.86, h: H * 0.72 }, a = s.r * s.r, o = dirAt(-s.view)
            const ths = Array.from({ length: 171 }, (_, k) => -85 + k)
            const pts = ths.map(t => { const i = dirAt(t), p = pdfReflect(o, i, a); return [t, p > 1e-9 ? pdfOld(o, i, a) / p : null] }).filter(p => p[1] != null)
            plot(pen, rect, {
                x: [-85, 85], y: [0, 2], xticks: [-80, -40, 40, 80], yticks: [0, 0.5, 1, 1.5, 2], fmt: v => Math.abs(v) >= 3 ? `${v}°` : v.toFixed(1),
                hoverX: v => `reflected ${v.toFixed(0)}° from the normal`, hoverY: v => `old / true = ${v.toFixed(3)}`,
                series: [
                    { name: 'old / true', pts, role: 'blocked', w: 1.8 },
                    { name: 'right', pts: [[-85, 1], [85, 1]], role: 'soft', w: 1, dash: [4, 4], tip: false },
                ],
            })
            pen.labelPx(rect.x - 30, rect.y - 18, 'the old density over the true one, for each reflected direction (in the plane of incidence)', { role: 'soft', size: 12 })
            pen.labelPx(rect.x + rect.w / 2, rect.y + rect.h + 22, `the reflected direction from the normal; the mirror direction is ${s.view}°`, { role: 'soft', size: 12, align: 'center' })
        },
        readout(s) {
            const a = s.r * s.r, o = dirAt(-s.view), rs = []
            for (let t = -85; t <= 85; t++) { const i = dirAt(t), p = pdfReflect(o, i, a); if (p > 1e-9) rs.push(pdfOld(o, i, a) / p) }
            return `light ${s.view}° from the normal: the old density was ${Math.min(...rs).toFixed(3)} to ${Math.max(...rs).toFixed(3)} times the true one over the reflected directions (right only where it is 1); the estimate's weight is f cos / density, so wrong by the inverse`
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
