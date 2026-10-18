//======================================================================================================================
// CHAPTER "Measuring light": its figures.
//
//   distance  a glowing panel seen from near and far: every pixel wholly on it reads its luminance whatever the
//             distance (an edge pixel its share); how many pixels it fills falls as 1/d^2, and with it the light it puts
//             at the eye
//   sun       the sun as a disc in the sky, its illuminance held at the renderer's 100,000 lux and its size yours: its
//             luminance by photometry.js's own sunCone and discLuminance, and the chance a random bounce finds it
//   floor     a white floor under the sun and the sky, from the side: the illuminance by the cosine law, the floor's
//             luminance rho E / pi, against what the user's card measured (docs/TESTING.md)
//
// The 3D laws throughout, drawn as a side view where a drawing is needed: these are the renderer's own units.
//======================================================================================================================

import { boot } from '../kit/page.js'
import { plot } from '../kit/plot.js'
import { sunCone, discLuminance, sunHorizontal } from '../../lib/pathtracer/core/photometry.js'

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
// three figures under 10, kept as written: 3.90 stays 3.90, to match the page's words
const fmt = v => v >= 1e4 ? Math.round(v).toLocaleString('en') : v >= 10 ? v.toFixed(1) : v.toPrecision(3)

/* THE PANEL: a square of side a, luminance L, square to the eye's axis at distance d. The eye's picture is W x H pixels
   over a vertical field of view of FOV; a pixel at (u, v) on the picture one unit ahead looks along (u, v, 1), meets the
   panel's plane at (u d, v d), and sees it if both lie within a / 2. */
const W = 60, H = 40, FOV = 30 * Math.PI / 180, T = Math.tan(FOV / 2), TX = T * W / H
export const PANEL_L = 1000
/** the share of pixel (i, j) the panel at distance d covers: what the average of many jittered rays through the pixel
 *  reads, as a share of L (chapter 1's jitter). On the picture one unit ahead the panel spans +-a / 2d each way. */
export function coverage(i, j, d, a) {
    const h = a / (2 * d), du = 2 * TX / W, dv = 2 * T / H, u0 = -TX + i * du, v1 = T - j * dv
    const over = (lo, hi) => Math.max(0, Math.min(hi, h) - Math.max(lo, -h))
    return over(u0, u0 + du) / du * over(v1 - dv, v1) / dv
}
/** the panel as the picture sees it: { whole: pixels wholly on it, part: pixels partly on it, E: the lux the pixels
 *  bring the eye, each its reading times its solid angle times the cosine at the eye } */
export function panelSeen(d, a, L = PANEL_L) {
    const du = 2 * TX / W, dv = 2 * T / H
    let whole = 0, part = 0, E = 0
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const c = coverage(i, j, d, a)
        if (c <= 0) continue
        if (c >= 1) whole++; else part++
        const u = -TX + (i + 0.5) * du, v = T - (j + 0.5) * dv, r2 = 1 + u * u + v * v
        // the pixel's solid angle, du dv / r^3, times the cosine at the eye, 1 / r: what its reading adds to the eye's lux
        E += c * L * du * dv / (r2 * r2)
    }
    return { whole, part, E }
}
/** the exact illuminance on the axis from the square: 4 L s atan(s), s = X / sqrt(1 + X^2), X = a / 2d (a corner
 *  rectangle's form factor, four times); for a panel small beside its distance, L a^2 / d^2 */
export const panelE = (d, a, L = PANEL_L) => { const X = a / (2 * d), s = X / Math.sqrt(1 + X * X); return 4 * L * s * Math.atan(s) }

/* THE SUN, held at the renderer's default illuminance (uniforms.schema.js sunIlluminance) */
export const SUN_E = 100000, SKY_E = 15000
/** the share of a cosine-weighted bounce off a level surface that lands in a disc of half-angle `half` at elevation
 *  `elev` (radians), the whole disc up: its cosine-weighted solid angle over pi, pi sin^2(half) sin(elev) / pi */
export const findChance = (half, elev) => Math.sin(half) ** 2 * Math.sin(elev)
/** the old shortcut, L times the solid angle, against the exact pi sin^2: how far off it is */
export const solidAngleError = half => { const c = sunCone(half * 360 / Math.PI); return c.solidAngle / (Math.PI * Math.sin(half) ** 2) - 1 }

/* THE FLOOR, as the bench measures it (lib/pathtracer/tests.js floorExpected, FLOOR_ALBEDO 0.8) */
export const floorL = (elevDeg, rho, sun = true, sky = true) => rho * ((sun ? sunHorizontal(SUN_E, elevDeg) : 0) + (sky ? SKY_E : 0)) / Math.PI
/* what the user's Pascal card measured, docs/TESTING.md "Physical units: third run" (1188 x 969, 32 samples, the
   floor at albedo 0.8): [mode, elevation, measured meanLuma] */
export const MEASURED = [['both', 45, 21827.2], ['sun', 45, 18006.2], ['sky', 45, 3817.1], ['sun', 20, 8709.3]]

export const figures = {
    distance: {
        aspect: 2.15,
        world: { x: [-0.7, 18.2], y: [-3.6, 3.6] },
        state: { d: 2, a: 0.5 },
        controls: [
            { type: 'slider', key: 'd', label: 'distance d (m)', min: 1, max: 10, step: 0.1, fmt: v => v.toFixed(1) },
            { type: 'slider', key: 'a', label: 'panel side a (m)', min: 0.2, max: 1, step: 0.05, fmt: v => v.toFixed(2) },
        ],
        steps: { near: { d: 2, a: 0.5 }, far: { d: 4, a: 0.5 }, farther: { d: 8, a: 0.5 } },
        drag: { d: (s, p) => { s.d = Math.round(clamp(p[0], 1, 10) * 10) / 10 } },
        draw(pen, s) {
            // the side view: the eye, its field of view, the panel at d (a metre a unit)
            const e = [0, 0], reach = 10.4
            pen.line([-0.5, 0], [10.6, 0], { role: 'faint', w: 0.6, dash: [2, 5], exact: true })
            for (const sg of [1, -1]) pen.line(e, [reach, sg * reach * T], { role: 'faint', w: 0.8, exact: true })
            // the glowing panel, a bright line facing the eye (a lamp's bar drew its marks on the side away from it)
            pen.line([s.d, -s.a / 2], [s.d, s.a / 2], { role: 'light', w: 4, id: 'panel' })
            for (const sg of [1, -1]) pen.line(e, [s.d, sg * s.a / 2], { role: 'cam', w: 0.9, exact: true })
            pen.eye([-0.25, 0], 0, { size: 16 })
            pen.handle('d', [s.d, -s.a / 2 - 0.45], { role: 'light' })
            pen.label([s.d, s.a / 2 + 0.4], `${s.d.toFixed(1)} m`, { role: 'soft', size: 13, align: 'center' })
            pen.label([5, -3.1], 'from the side: the eye, its view (faint), the panel', { role: 'soft', size: 12, align: 'center' })
            // the picture: each pixel's luminance, the panel's L where it sees the panel and nothing elsewhere
            const x0 = pen.X(11.2), y0 = pen.Y(2.3), w = pen.X(17.9) - x0, h = w * H / W
            pen.image(x0, y0, w, h, W, H, (i, j) => {
                const c = coverage(i, j, s.d, s.a)
                return [0.04 + c * 0.96, 0.045 + c * 0.885, 0.06 + c * 0.74]
            })
            pen.labelPx(x0, y0 + h + 6, 'the eye\'s picture, 60 × 40 pixels', { role: 'soft', size: 12 })
            // THE POINTER on the picture: the pixel's own reading
            const q = pen.hover({ x: x0, y: y0, w, h })
            if (q) {
                const i = Math.floor((q.x - x0) / w * W), j = Math.floor((q.y - y0) / h * H)
                const c = coverage(Math.min(W - 1, i), Math.min(H - 1, j), s.d, s.a)
                pen.tip(q.x, q.y, [`pixel ${i + 1}, ${j + 1}`, c >= 1 ? `wholly on the panel: ${PANEL_L} cd/m²` : c > 0 ? `${Math.round(100 * c)}% on the panel: ${Math.round(c * PANEL_L)} cd/m²` : 'sees nothing: 0'])
            }
        },
        readout(s) {
            const p = panelSeen(s.d, s.a), ex = panelE(s.d, s.a)
            return `a pixel wholly on the panel reads ${PANEL_L} cd/m², at any distance · ${p.whole} pixels wholly on it, ${p.part} at its edge (each reading its share) · the light they bring the eye, Σ reading × the pixel's solid angle × cos: ${fmt(p.E)} lux · exact for this square: ${fmt(ex)} lux${s.a / (2 * s.d) > T ? ' (the panel is wider than the view: the picture sees only part of it, so its sum is short)' : ''} · L a²/d² = ${fmt(PANEL_L * s.a * s.a / (s.d * s.d))} lux`
        },
    },

    sun: {
        aspect: 2.0,
        world: { x: [-4.8, 15.6], y: [-0.9, 4.9] },
        state: { lgD: Math.log10(0.53), elev: 45 },
        controls: [
            { type: 'slider', key: 'lgD', label: 'the disc across', min: -1, max: Math.log10(20), step: 0.01, fmt: v => `${(10 ** v).toFixed(2)}°` },
            { type: 'slider', key: 'elev', label: 'elevation', min: 5, max: 90, step: 1, fmt: v => `${v}°` },
            { type: 'button', label: 'The real sun', act: s => { s.lgD = Math.log10(0.53) } },
        ],
        steps: { real: { lgD: Math.log10(0.53), elev: 45 }, wide: { lgD: 1, elev: 45 } },
        draw(pen, s) {
            const D = 10 ** s.lgD, c = sunCone(D), el = s.elev * Math.PI / 180, R = 3.6
            // the ground and the sky over a point of it; the sun drawn at its true size where it can be seen, never
            // smaller than a dot (at 0.53 degrees it is a fortieth of a unit across here)
            pen.line([-4.5, 0], [4.5, 0], { role: 'solid', w: 1.6, exact: true })
            const arc = Array.from({ length: 61 }, (_, k) => [R * Math.cos(Math.PI * k / 60), R * Math.sin(Math.PI * k / 60)])
            pen.poly(arc, { role: 'faint', w: 0.8, dash: [4, 4], exact: true })
            pen.label([-3.9, 3.4], 'the sky', { role: 'soft', size: 13 })
            const sp = [R * Math.cos(Math.PI - el), R * Math.sin(Math.PI - el)]
            for (const sg of [1, -1]) {
                const a = Math.PI - el + sg * c.half
                pen.line([0, 0], [R * Math.cos(a), R * Math.sin(a)], { role: 'light', w: 0.8, exact: true })
            }
            pen.circle(sp, Math.max(R * Math.sin(c.half), pen.world(3)), { role: 'light', fill: 'light', w: 1 })
            pen.dot([0, 0], { role: 'accent', r: 4 })
            pen.label([0.15, -0.45], 'a point of the ground', { role: 'soft', size: 12 })
            // the sun's luminance against its size, at the same illuminance: log scales both ways
            const { W: VW, H: VH } = pen.view, rect = { x: pen.X(6.6), y: VH * 0.1, w: pen.X(15.2) - pen.X(6.6), h: VH * 0.68 }
            const lgL = d => Math.log10(discLuminance(SUN_E, sunCone(d).half))
            const xs = Array.from({ length: 121 }, (_, k) => -1 + k / 120 * (Math.log10(20) + 1))
            pen.labelPx(rect.x - 30, rect.y - 20, 'its luminance for 100,000 lux, cd/m² (log scales)', { role: 'soft', size: 12 })
            const { X } = plot(pen, rect, {
                // the axis starts under 1e6, so its lowest label clears the width labels beneath it
                x: [-1, Math.log10(20)], y: [5.6, 11], xticks: [], yticks: [6, 7, 8, 9, 10, 11], fmt: v => `1e${v}`,
                hoverX: v => `${(10 ** v).toFixed(2)}° across`, hoverY: v => `${(10 ** v).toPrecision(3)} cd/m²`,
                series: [
                    { name: 'luminance', pts: xs.map(x => [x, lgL(10 ** x)]), role: 'light', w: 1.6 },
                    { name: 'this disc', pts: [[s.lgD, lgL(D)], [s.lgD, lgL(D)]], role: 'accent', kind: 'dots', r: 4.5 },
                ],
            })
            for (const d of [0.1, 0.53, 2, 10]) pen.labelPx(X(Math.log10(d)) - 10, rect.y + rect.h + 10, `${d}°`, { role: 'soft', size: 11, kind: 'mono' })
            pen.labelPx(rect.x + rect.w / 2 - 50, rect.y + rect.h + 26, 'the disc across', { role: 'soft', size: 12 })
            void VW
        },
        readout(s) {
            const D = 10 ** s.lgD, c = sunCone(D), L = discLuminance(SUN_E, c.half), p = findChance(c.half, s.elev * Math.PI / 180)
            return `a disc ${D.toFixed(2)}° across: half-angle ${c.half.toPrecision(3)} rad, solid angle ${c.solidAngle.toPrecision(3)} sr · to give 100,000 lux its luminance is E / (π sin² half) = ${L.toPrecision(4)} cd/m² (L × solid angle is off by ${(100 * Math.abs(solidAngleError(c.half))).toPrecision(2)}%) · a random bounce off the ground at ${s.elev}° finds it 1 time in ${Math.round(1 / p).toLocaleString('en')}`
        },
    },

    floor: {
        aspect: 2.0,
        world: { x: [-4.8, 15.6], y: [-0.9, 4.9] },
        state: { elev: 45, rho: 0.8, mode: 'both' },
        controls: [
            { type: 'slider', key: 'elev', label: 'sun\'s elevation', min: 0, max: 90, step: 1, fmt: v => `${v}°` },
            { type: 'slider', key: 'rho', label: 'floor\'s albedo ρ', min: 0.1, max: 1, step: 0.05, fmt: v => v.toFixed(2) },
            { type: 'seg', key: 'mode', options: [['both', 'Sun and sky'], ['sun', 'Sun only'], ['sky', 'Sky only']] },
        ],
        steps: { noon: { elev: 45, rho: 0.8, mode: 'both' }, low: { elev: 20, rho: 0.8, mode: 'sun' } },
        draw(pen, s) {
            const el = s.elev * Math.PI / 180, sun = s.mode !== 'sky', sky = s.mode !== 'sun'
            // the floor, the sun's parallel rays at its elevation, the sky over it, and an eye looking at the floor
            pen.shape([[-4.4, 0], [4.4, 0], [4.4, -0.4], [-4.4, -0.4]], { role: 'solid', fill: 'fill', w: 1.2, id: 'floor' })
            if (sky) pen.poly(Array.from({ length: 61 }, (_, k) => [3.8 * Math.cos(Math.PI * k / 60), 3.8 * Math.sin(Math.PI * k / 60)]), { role: 'cam', w: 0.9, dash: [3, 4], exact: true })
            if (sun) for (let k = -3; k <= 3; k++) {
                const x = k * 1.1, len = 3.4
                pen.ray([x - len * Math.cos(el), len * Math.sin(el)], [x, 0], { role: 'light', w: 1, exact: true })
            }
            // the eye at the right, out of the sun's rays, which come from the left
            pen.eye([4.1, 2.6], Math.atan2(-2.6, -4.1), { size: 15 })
            pen.label([-2.6, -0.75], `the floor, ρ = ${s.rho.toFixed(2)}`, { role: 'soft', size: 13 })
            // the floor's luminance against the sun's elevation, and the measured points
            const { H: VH } = pen.view, rect = { x: pen.X(6.6), y: VH * 0.1, w: pen.X(15.2) - pen.X(6.6), h: VH * 0.68 }
            const top = 30000
            pen.labelPx(rect.x - 30, rect.y - 20, 'the floor\'s luminance ρE/π, cd/m²', { role: 'soft', size: 12 })
            const series = [
                { name: 'ρE/π', pts: Array.from({ length: 91 }, (_, k) => [k, floorL(k, s.rho, sun, sky)]), role: 'ink', w: 1.6 },
                { name: 'this elevation', pts: [[s.elev, floorL(s.elev, s.rho, sun, sky)], [s.elev, floorL(s.elev, s.rho, sun, sky)]], role: 'accent', kind: 'dots', r: 4.5 },
            ]
            const meas = s.rho === 0.8 ? MEASURED.filter(m => m[0] === s.mode) : []
            if (meas.length) series.push({ name: 'measured', pts: meas.length === 1 ? [[meas[0][1], meas[0][2]], [meas[0][1], meas[0][2]]] : meas.map(m => [m[1], m[2]]), role: 'shadow', kind: 'dots', r: 8, ring: true })
            const { X } = plot(pen, rect, {
                x: [0, 90], y: [0, top], xticks: [], yticks: [0, 10000, 20000, 30000], fmt: v => v.toLocaleString('en'),
                hoverX: v => `the sun at ${Math.round(v)}°`, hoverY: v => `${v.toFixed(1)} cd/m²`, series,
            })
            // the elevations a little below the axis, clear of its lowest number
            for (const d of [0, 20, 45, 90]) pen.labelPx(X(d) - 8, rect.y + rect.h + 10, `${d}°`, { role: 'soft', size: 11, kind: 'mono' })
            pen.labelPx(rect.x + rect.w / 2 - 50, rect.y + rect.h + 26, 'the sun\'s elevation', { role: 'soft', size: 12 })
            if (s.rho !== 0.8) pen.labelPx(rect.x + 8, rect.y + 4, 'measured only at ρ 0.8', { role: 'soft', size: 11 })
        },
        readout(s) {
            const sun = s.mode !== 'sky', sky = s.mode !== 'sun', Es = sun ? sunHorizontal(SUN_E, s.elev) : 0, E = Es + (sky ? SKY_E : 0)
            const m = s.rho === 0.8 ? MEASURED.find(r => r[0] === s.mode && (s.mode === 'sky' || r[1] === s.elev)) : null
            const sum = sun && sky ? `the sun's 100,000 × sin ${s.elev}° = ${fmt(Es)} lux + the sky's 15,000 = ${fmt(E)} lux` : sun ? `the sun's 100,000 × sin ${s.elev}° = ${fmt(E)} lux` : `the sky's ${fmt(E)} lux`
            return `on the floor: ${sum} · its luminance ρE/π = ${s.rho.toFixed(2)} × ${fmt(E)} / π = ${fmt(floorL(s.elev, s.rho, sun, sky))} cd/m²${m ? ` · measured on the user's card: ${m[2].toLocaleString('en')}` : ''}`
        },
    },
}

export const mount = () => boot({ figures })
if (typeof document !== 'undefined') mount()
