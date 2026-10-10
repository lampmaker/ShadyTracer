//======================================================================================================================
// THE HELP'S WIDGETS -- small live pictures in a page, made from a ```widget block (markdown.js). One for now:
//
//   sdf   A distance field in 2D, as the program's shapes are in 3D (lib/pathtracer/core/sdf.js has the same functions
//         in WGSL): the shape filled, a line every `step` of distance outside it and inside, the zero line -- the
//         surface -- bold. A ray marched across it, step by step: at each point the distance says how far it may go
//         without touching anything, a circle of that radius drawn there -- sphere tracing, which is all the renderer
//         does to find a surface. Drag the ray's start; sliders for what the mode has.
//         settings: mode (one of MODES), ray (on / off), step (the contour spacing)
//
// No GPU: a canvas and the CPU, a few hundred thousand distance calls a picture. The fields are pure and exported for
// test/widgets.test.mjs, which holds them to their exact values.
//======================================================================================================================

const len = (x, y) => Math.hypot(x, y)

/** 2D distances, as in sdf.js: negative inside. */
export const circle = (x, y, r) => len(x, y) - r
export const box = (x, y, hx, hy) => {
    const dx = Math.abs(x) - hx, dy = Math.abs(y) - hy
    return len(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0)
}
/** The smooth minimum a CSG group's blend is (lib/pathtracer/core/scene_api.js csgUnion): within k of each other the
 *  two distances melt, by h^2 / 4k; 0 is a plain min. smax is csgIntersect, a subtraction smax(a, -b). */
export const smin = (a, b, k) => {
    if (k <= 0) return Math.min(a, b)
    const h = Math.max(k - Math.abs(a - b), 0)
    return Math.min(a, b) - h * h * 0.25 / k
}
export const smax = (a, b, k) => {
    if (k <= 0) return Math.max(a, b)
    const h = Math.max(k - Math.abs(a - b), 0)
    return Math.max(a, b) + h * h * 0.25 / k
}

/** THE MODES: each a field over its parameters, the parameters' sliders, and what the page says under the picture. */
export const MODES = {
    circle: { params: {}, field: (x, y) => circle(x, y, 1),
        note: 'A circle of radius 1: the distance to it is the distance to its centre, minus 1. One subtraction for an exact shape.' },
    box: { params: { round: [0, 0, 0.8] }, field: (x, y, p) => box(x, y, 1.2 - p.round, 0.7 - p.round) - p.round,
        note: 'A box. Subtracting a number from any distance grows the shape by it: its corners come out rounded.' },
    union: { params: {}, field: (x, y) => Math.min(circle(x + 0.6, y, 0.8), box(x - 0.6, y, 0.6, 0.6)),
        note: 'Two shapes together: the nearer of the two distances. Union is min.' },
    blend: { params: { k: [0.5, 0, 1.5] }, field: (x, y, p) => smin(circle(x + 0.6, y, 0.8), box(x - 0.6, y, 0.6, 0.6), p.k),
        note: 'A smooth minimum melts the two together where they come within k of each other: a fillet, for one formula.' },
    subtract: { params: { k: [0, 0, 0.6] }, field: (x, y, p) => smax(box(x, y, 1.1, 0.7), -circle(x - 0.5, y - 0.3, 0.6), p.k),
        note: 'Subtract: the larger of the box\'s distance and the circle\'s turned inside out. Intersect is the plain max.' },
    shell: { params: { thickness: [0.15, 0.02, 0.5] }, field: (x, y, p) => Math.abs(circle(x, y, 1)) - p.thickness,
        note: 'A shell: the absolute distance, less a thickness -- any shape made hollow, its wall that thick.' },
    repeat: { params: { spacing: [1, 0.5, 2] }, field: (x, y, p) => {
        const s = p.spacing, qx = x - s * Math.round(x / s), qy = y - s * Math.round(y / s)
        return circle(qx, qy, 0.25 * s)
    }, note: 'Repeat: fold space into one cell and draw one shape there -- endless copies for the price of one.' },
}

/**
 * SPHERE TRACING from (x, y) along (dx, dy): the points stepped to and the distance at each, until within `eps` of a
 * surface or `far` away. What the renderer's march kernel does in 3D, a pixel at a time.
 * @returns { steps: [{ x, y, d }], hit }
 */
export function trace(field, x, y, dx, dy, { eps = 1e-3, far = 8, max = 64 } = {}) {
    const l = len(dx, dy) || 1, ux = dx / l, uy = dy / l
    const steps = []
    let t = 0
    for (let i = 0; i < max; i++) {
        const px = x + ux * t, py = y + uy * t, d = field(px, py)
        steps.push({ x: px, y: py, d })
        if (Math.abs(d) < eps) return { steps, hit: true }
        t += Math.abs(d)
        if (t > far) break
    }
    return { steps, hit: false }
}

/** The sdf widget, into `host` (a div of the page). Settings as the block's; returns { redraw, dispose }. */
export function sdfWidget(host, settings = {}) {
    const doc = host.ownerDocument
    const mode = MODES[settings.mode] ? settings.mode : 'circle'
    const M = MODES[mode]
    const p = Object.fromEntries(Object.entries(M.params).map(([k, [v]]) => [k, v]))
    const showRay = settings.ray !== 'off'
    const step = +settings.step > 0 ? +settings.step : 0.25
    const W = 360, H = 240, S = 70            // pixels, and pixels per unit: the picture is about 5 x 3.4 units
    const canvas = doc.createElement('canvas')
    canvas.width = W; canvas.height = H
    canvas.className = 'help-sdf'
    const ray = { x: -2.4, y: 1.1, dx: 1, dy: -0.35 }
    const controls = doc.createElement('div')
    controls.className = 'help-sdf-controls'
    for (const [k, [, lo, hi]] of Object.entries(M.params)) {
        const label = doc.createElement('label')
        const input = doc.createElement('input')
        Object.assign(input, { type: 'range', min: lo, max: hi, step: (hi - lo) / 100, value: p[k] })
        const val = doc.createElement('span')
        val.textContent = p[k].toFixed(2)
        input.oninput = () => { p[k] = +input.value; val.textContent = p[k].toFixed(2); draw() }
        label.append(`${k} `, input, val)
        controls.append(label)
    }
    const note = doc.createElement('p')
    note.className = 'help-sdf-note'
    note.textContent = M.note + (showRay ? ' Drag the ray\'s start (the white dot) to march it from elsewhere.' : '')
    host.append(canvas, controls, note)

    const toWorld = (px, py) => [(px - W / 2) / S, -(py - H / 2) / S]
    const toPix = (x, y) => [W / 2 + x * S, H / 2 - y * S]
    const ctx = canvas.getContext('2d')
    function draw() {
        if (!ctx) return
        const f = (x, y) => M.field(x, y, p)
        const img = ctx.createImageData(W, H)
        for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
            const [x, y] = toWorld(i + 0.5, j + 0.5)
            const d = f(x, y)
            // inside warm, outside cool, a band at every `step`, the surface white
            const band = Math.abs(d / step - Math.round(d / step)) < 0.04 ? 0.55 : 1
            const fade = Math.exp(-Math.abs(d) * 0.6)
            const k = (j * W + i) * 4
            const [r, g, b] = d < 0 ? [200, 120, 70] : [70, 110, 160]
            const edge = Math.abs(d) < 1.2 / S
            img.data[k] = edge ? 255 : r * fade * band
            img.data[k + 1] = edge ? 255 : g * fade * band
            img.data[k + 2] = edge ? 255 : b * fade * band
            img.data[k + 3] = 255
        }
        ctx.putImageData(img, 0, 0)
        if (!showRay) return
        const { steps, hit } = trace(f, ray.x, ray.y, ray.dx, ray.dy)
        ctx.lineWidth = 1
        for (const s of steps) {
            const [px, py] = toPix(s.x, s.y)
            ctx.strokeStyle = 'rgba(255,255,255,0.35)'
            ctx.beginPath(); ctx.arc(px, py, Math.abs(s.d) * S, 0, 2 * Math.PI); ctx.stroke()
            ctx.fillStyle = '#ffd34d'
            ctx.beginPath(); ctx.arc(px, py, 2, 0, 2 * Math.PI); ctx.fill()
        }
        const [ax, ay] = toPix(ray.x, ray.y), last = steps.at(-1), [bx, by] = toPix(last.x, last.y)
        ctx.strokeStyle = '#ffd34d'
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke()
        ctx.fillStyle = '#fff'
        ctx.beginPath(); ctx.arc(ax, ay, 4, 0, 2 * Math.PI); ctx.fill()
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(4, H - 20, 210, 16)
        ctx.fillStyle = '#fff'; ctx.font = '11px sans-serif'
        ctx.fillText(`${steps.length} steps -- ${hit ? 'surface found' : 'missed: nothing ahead'}`, 8, H - 8)
    }
    let dragging = false
    canvas.onpointerdown = e => { dragging = true; canvas.setPointerCapture?.(e.pointerId); move(e) }
    canvas.onpointerup = () => { dragging = false }
    const move = e => {
        if (!dragging || !showRay) return
        const r = canvas.getBoundingClientRect()
        const [x, y] = toWorld((e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height)
        ray.x = x; ray.y = y
        // aimed at the middle, a little off it, so it can miss
        ray.dx = -x + 0.3; ray.dy = -y - 0.2
        draw()
    }
    canvas.onpointermove = move
    draw()
    return { redraw: draw, dispose: () => host.replaceChildren(), params: p }
}

/** Every widget, by the name a page gives it. */
export const WIDGETS = { sdf: sdfWidget }
