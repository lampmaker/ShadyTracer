//======================================================================================================================
// THE PEN -- everything a figure draws goes through here, so every figure in every chapter looks the same and a style
// changes them all: its colours (by role, never by value), its faces, how much the line wobbles, whether solids are
// washed, hatched or dotted, and (risograph) how far the second ink is out of register.
//
// A figure's draw(pen, state) works in WORLD units, y up; the pen turns them into the canvas's pixels.
//
// THE WOBBLE is smooth noise along the line's length, seeded by the line's id (or its rounded end points), never by
// how many lines were drawn before it: a seed from a counter would change whenever the drawing order did, and every
// line would shimmer on each redraw. Plotted data and the many rays of a path tracer are drawn straight (`exact`): a
// wobble there would be a lie about where they are.
//
// ROLES (colours from the page's tokens, resolved by figure.js): ink, soft, faint, accent, cam (camera rays),
// light (lamps and light rays), shadow (shadow rays), blocked, solid (a shape's outline), fill, glass, normal, step.
//======================================================================================================================

/* smooth 1D value noise in [-1, 1], from an integer hash */
const hash1 = n => { let h = Math.imul(n | 0, 0x27d4eb2d) ^ 0x165667b1; h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h ^= h >>> 13; return ((h >>> 0) / 4294967296) * 2 - 1 }
const noise1 = (x, seed) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash1(i * 7919 + seed) * (1 - u) + hash1((i + 1) * 7919 + seed) * u }
const seedOf = (id, pts) => {
    if (id != null) { let h = 2166136261; for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }
    let h = 0; for (const [x, y] of pts) h = Math.imul(h ^ Math.round(x * 2), 31) ^ Math.round(y * 2)
    return h >>> 0
}

const DASH = { shadow: [5, 4], blocked: [2, 3], faint: [3, 4] }

/**
 * A pen over `ctx` for one draw. `view` maps world to CSS pixels ({ s, ox, oy, W, H }); `theme` is figure.js's
 * resolved style; `handles` collects the drag handles drawn.
 */
export function makePen(ctx, view, theme, handles = []) {
    const { s, ox, oy } = view
    const X = x => ox + x * s, Y = y => oy - y * s
    const P = p => [X(p[0]), Y(p[1])]
    const col = role => theme.colors[role] ?? theme.colors.ink
    const rough = theme.rough, lw = theme.width

    /* a polyline in PIXELS, wobbled and stroked; `close` for a loop */
    function strokePx(pts, { role = 'ink', w = 1, dash, id, exact = false, close = false, alpha = 1, cap = 'round' } = {}) {
        if (pts.length < 2) return
        ctx.save()
        ctx.strokeStyle = col(role); ctx.lineWidth = lw * w; ctx.lineCap = cap; ctx.lineJoin = 'round'; ctx.globalAlpha = alpha
        const d = dash ?? DASH[role]
        if (d) ctx.setLineDash(d.map(v => v * Math.max(1, w * 0.8)))
        const passes = exact || !rough ? 1 : (theme.double ? 2 : 1)
        const seed = seedOf(id, pts)
        for (let k = 0; k < passes; k++) {
            if (k === 1) ctx.globalAlpha = alpha * 0.45
            ctx.beginPath()
            const amp = exact ? 0 : rough * (k ? 0.9 : 1)
            const ring = close ? [...pts, pts[0]] : pts
            // a closed line's wobble must meet itself: blended towards the noise a whole loop back, so it ends where it
            // began (without that, a circle in a rough style was left open like a C where its two ends missed)
            let total = 0
            if (close) for (let i = 0; i < ring.length - 1; i++) total += Math.hypot(ring[i + 1][0] - ring[i][0], ring[i + 1][1] - ring[i][1])
            const wob = a => noise1(a / 38, seed + k * 101) * amp + noise1(a / 9, seed + 7 + k * 31) * amp * 0.35
            let along = 0
            for (let i = 0; i < ring.length - 1; i++) {
                const [ax, ay] = ring[i], [bx, by] = ring[i + 1]
                const L = Math.hypot(bx - ax, by - ay)
                const n = amp ? Math.max(1, Math.ceil(L / 7)) : 1
                const nx = L ? -(by - ay) / L : 0, ny = L ? (bx - ax) / L : 0
                for (let j = (i ? 1 : 0); j <= n; j++) {
                    const t = j / n, a = along + L * t
                    const o = !amp ? 0 : close && total ? wob(a) * (1 - a / total) + wob(a - total) * (a / total) : wob(a)
                    const x = ax + (bx - ax) * t + nx * o, y = ay + (by - ay) * t + ny * o
                    if (i === 0 && j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
                }
                along += L
            }
            ctx.stroke()
        }
        ctx.restore()
    }
    const arcPts = (c, r, a0, a1) => {
        const n = Math.max(12, Math.ceil(Math.abs(a1 - a0) * r * s / 6))
        const out = []
        for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push([X(c[0] + r * Math.cos(a)), Y(c[1] + r * Math.sin(a))]) }
        return out
    }
    /* a closed outline in pixels, filled by the style: a wash, hatching, or risograph dots */
    function fillPx(pts, { role = 'fill', angle = Math.PI / 4, gap = 6, alpha = 1 } = {}) {
        if (pts.length < 3) return
        ctx.save()
        ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath()
        ctx.clip()
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
        for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
        const c = col(role)
        if (theme.fill === 'hatch') {
            ctx.strokeStyle = c; ctx.lineWidth = Math.max(0.8, lw * 0.6); ctx.globalAlpha = alpha * 0.75
            const R = Math.hypot(x1 - x0, y1 - y0), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
            const dx = Math.cos(angle), dy = Math.sin(angle)
            ctx.beginPath()
            for (let o = -R; o <= R; o += gap) {
                const px = cx - dy * o, py = cy + dx * o
                ctx.moveTo(px - dx * R, py - dy * R); ctx.lineTo(px + dx * R, py + dy * R)
            }
            ctx.stroke()
        } else if (theme.fill === 'dots') {
            ctx.fillStyle = c; ctx.globalAlpha = alpha * 0.85
            const g = 4.2
            for (let y = Math.floor(y0 / g) * g; y <= y1; y += g) {
                const odd = Math.round(y / g) & 1
                for (let x = Math.floor(x0 / g) * g + (odd ? g / 2 : 0); x <= x1; x += g) { ctx.beginPath(); ctx.arc(x, y, 1.05, 0, 6.2832); ctx.fill() }
            }
        } else {
            ctx.fillStyle = c; ctx.globalAlpha = alpha * 0.22
            ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
        }
        ctx.restore()
    }
    const font = (kind, size) => `${kind === 'bold' ? 700 : 500} ${size}px ${kind === 'mono' ? theme.fonts.mono : kind === 'body' ? theme.fonts.body : theme.fonts.hand}`

    const pen = {
        view, theme, ctx, X, Y, P, col,
        /** world length in pixels, and back */
        px: l => l * s, world: p => p / s,
        /** the style's word for a role's colour ('blue' in the notebook, 'black' in a drafting sheet), for a label */
        say: role => theme.say?.[role] || role,

        /* THE POINTER, for what answers it without a handle (a chart's values under it). figure.js sets `pointer` to
           { x, y } in CSS pixels, or null, before each draw, and redraws on a move only if the last draw asked:
           hover() is the asking, so a figure that never calls it is never redrawn by a mouse passing over it. */
        pointer: null, usedPointer: false,
        /** the pointer if it is inside `rect` ({ x, y, w, h } pixels, or the whole canvas), else null */
        hover(rect = { x: 0, y: 0, w: view.W, h: view.H }) {
            pen.usedPointer = true
            const p = pen.pointer
            return p && p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h ? p : null
        },
        /** a small box of text lines beside the pixel point (x, y), kept inside the canvas: what the pointer is on */
        tip(x, y, lines, { size = 12 } = {}) {
            if (!lines.length) return
            ctx.save(); ctx.font = font('mono', size); ctx.textBaseline = 'top'
            const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12, h = lines.length * (size + 4) + 8
            // right of the point if it fits, else left of it, and either way inside the canvas (a wide box left of a
            // point near the left edge ran off it: chapter 33's board)
            const bx = Math.max(2, Math.min(view.W - w - 2, x + 14 + w > view.W ? x - 14 - w : x + 14)), by = Math.max(2, Math.min(view.H - h - 2, y - h / 2))
            ctx.fillStyle = col('paper'); ctx.globalAlpha = 0.92; ctx.fillRect(bx, by, w, h); ctx.globalAlpha = 1
            ctx.strokeStyle = col('soft'); ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1)
            ctx.fillStyle = col('ink'); lines.forEach((l, i) => ctx.fillText(l, bx + 6, by + 5 + i * (size + 4)))
            ctx.restore()
        },

        line(a, b, o = {}) { strokePx([P(a), P(b)], o) },
        poly(pts, o = {}) { strokePx(pts.map(P), o) },
        shape(pts, o = {}) { const q = pts.map(P); if (o.fill) fillPx(q, { role: o.fill, angle: o.angle, gap: o.gap }); strokePx(q, { ...o, close: true }) },
        circle(c, r, o = {}) {
            const q = arcPts(c, r, 0, Math.PI * 2)
            if (o.fill) fillPx(q, { role: o.fill, angle: o.angle, gap: o.gap })
            strokePx(q, { ...o, close: true })
        },
        arc(c, r, a0, a1, o = {}) { strokePx(arcPts(c, r, a0, a1), o) },
        /** a dot: always exact, a filled disc of `r` pixels */
        dot(p, { role = 'ink', r = 3, ring = false } = {}) {
            ctx.save(); const [x, y] = P(p)
            ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2)
            if (ring) { ctx.strokeStyle = col(role); ctx.lineWidth = lw; ctx.stroke() } else { ctx.fillStyle = col(role); ctx.fill() }
            ctx.restore()
        },
        /** a ray from a to b with an arrowhead (at b, or at the middle with `mid`), in its role's colour and dash */
        ray(a, b, { role = 'cam', w = 1, arrow = true, mid = false, exact = true, alpha = 1, id, dash } = {}) {
            const pa = P(a), pb = P(b)
            if (theme.misreg && !exact) {
                ctx.save(); ctx.translate(theme.misreg, -theme.misreg * 0.6)
                strokePx([pa, pb], { role, w, exact, alpha: alpha * 0.35, id, dash })
                ctx.restore()
            }
            strokePx([pa, pb], { role, w, exact, alpha, id, dash })
            if (!arrow) return
            const L = Math.hypot(pb[0] - pa[0], pb[1] - pa[1])
            if (L < 10) return
            const ux = (pb[0] - pa[0]) / L, uy = (pb[1] - pa[1]) / L
            const t = mid ? 0.55 : 1
            const hx = pa[0] + (pb[0] - pa[0]) * t, hy = pa[1] + (pb[1] - pa[1]) * t, h = 4.5 + 2.2 * w
            ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = col(role)
            ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx - ux * h * 1.6 - uy * h * 0.75, hy - uy * h * 1.6 + ux * h * 0.75)
            ctx.lineTo(hx - ux * h * 1.6 + uy * h * 0.75, hy - uy * h * 1.6 - ux * h * 0.75); ctx.closePath(); ctx.fill()
            ctx.restore()
        },
        /** many straight rays at once, faint: a path tracer's bulk, one stroke call */
        rays(segs, { role = 'cam', w = 0.7, alpha = 0.25 } = {}) {
            if (!segs.length) return
            ctx.save(); ctx.strokeStyle = col(role); ctx.lineWidth = Math.max(0.6, lw * w); ctx.globalAlpha = alpha
            const d = DASH[role]; if (d) ctx.setLineDash(d)
            ctx.beginPath()
            for (const [a, b] of segs) { ctx.moveTo(X(a[0]), Y(a[1])); ctx.lineTo(X(b[0]), Y(b[1])) }
            ctx.stroke(); ctx.restore()
        },
        /** text at a world point; `dx`/`dy` nudge in pixels; kind 'hand' (labels), 'mono' (numbers), 'body', 'bold' */
        label(p, text, { role = 'ink', size = 15, align = 'left', base = 'middle', dx = 0, dy = 0, kind = 'hand', bg = false } = {}) {
            ctx.save(); ctx.font = font(kind, size); ctx.textAlign = align; ctx.textBaseline = base
            const [x, y] = P(p)
            if (bg) {
                const m = ctx.measureText(text), w = m.width + 8, h = size + 4
                const bx = align === 'center' ? x + dx - w / 2 : align === 'right' ? x + dx - w + 4 : x + dx - 4
                ctx.fillStyle = col('paper'); ctx.globalAlpha = 0.86; ctx.fillRect(bx, y + dy - h / 2 - (base === 'top' ? -h / 2 : base === 'bottom' ? h / 2 : 0), w, h); ctx.globalAlpha = 1
            }
            ctx.fillStyle = col(role); ctx.fillText(text, x + dx, y + dy)
            ctx.restore()
        },
        /** text at a point in PIXELS, for what sits on the figure rather than in its world (a chart's title, a strip) */
        labelPx(x, y, text, { role = 'ink', size = 13, align = 'left', base = 'top', kind = 'hand', angle = 0 } = {}) {
            // angle turns the text about (x, y): -pi/2 writes it upwards, along a vertical line
            ctx.save(); ctx.font = font(kind, size); ctx.textAlign = align; ctx.textBaseline = base; ctx.fillStyle = col(role)
            ctx.translate(x, y); ctx.rotate(angle); ctx.fillText(text, 0, 0); ctx.restore()
        },
        /**
         * A PICTURE: W x H pixels in the rectangle (x, y, w, h) of the canvas, in CSS pixels; rgbAt(i, j) gives pixel
         * (i, j)'s linear colour, j from the top, shown as sRGB after multiplying by `exposure`. Blocky on purpose: each
         * pixel is one square, which is what a pixel is. A picture is the scene's, so it is not in the style's colours.
         */
        image(x, y, w, h, W, H, rgbAt, { exposure = 1, frame = true } = {}) {
            const enc = v => Math.round(255 * Math.pow(Math.min(1, Math.max(0, v * exposure)), 1 / 2.2))
            const cw = w / W, ch = h / H
            ctx.save()
            for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
                const c = rgbAt(i, j)
                ctx.fillStyle = `rgb(${enc(c[0])},${enc(c[1])},${enc(c[2])})`
                ctx.fillRect(x + i * cw, y + j * ch, cw + 0.6, ch + 0.6)
            }
            if (frame) { ctx.strokeStyle = col('ink'); ctx.lineWidth = 1.2; ctx.strokeRect(x, y, w, h) }
            ctx.restore()
        },
        /** a dimension line between a and b with end ticks and its text in the middle */
        dim(a, b, text, { role = 'soft', off = 0 } = {}) {
            const pa = P(a), pb = P(b), L = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) || 1
            const nx = -(pb[1] - pa[1]) / L * off, ny = (pb[0] - pa[0]) / L * off
            const qa = [pa[0] + nx, pa[1] + ny], qb = [pb[0] + nx, pb[1] + ny]
            strokePx([qa, qb], { role, w: 0.7, exact: true })
            for (const q of [qa, qb]) strokePx([[q[0] - (pb[1] - pa[1]) / L * 5, q[1] + (pb[0] - pa[0]) / L * 5], [q[0] + (pb[1] - pa[1]) / L * 5, q[1] - (pb[0] - pa[0]) / L * 5]], { role, w: 0.7, exact: true })
            if (text) { ctx.save(); ctx.font = font('mono', 12); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillStyle = col(role); ctx.fillText(text, (qa[0] + qb[0]) / 2, (qa[1] + qb[1]) / 2 - 3); ctx.restore() }
        },
        /** an angle mark at c from direction a0 to a1 (radians, world), with its text */
        angle(c, a0, a1, r, text, { role = 'accent' } = {}) {
            // the angle between two directions is the short way round: from -170 degrees to +120 is 70, not 290 (the
            // long way drew a ring round the point and put the label on its far side, inside the shape)
            let d = a1 - a0
            while (d > Math.PI) d -= 2 * Math.PI
            while (d < -Math.PI) d += 2 * Math.PI
            a1 = a0 + d
            strokePx(arcPts(c, r, a0, a1), { role, w: 0.8 })
            if (text) pen.label([c[0] + (r + 0.12 * Math.abs(r) + pen.world(10)) * Math.cos((a0 + a1) / 2), c[1] + (r + pen.world(10)) * Math.sin((a0 + a1) / 2)], text, { role, size: 14, align: 'center' })
        },
        /** a rectangle in world units (corner, size), straight-edged, for frames and film cells */
        rect(x, y, w, h, { role = 'ink', fillStyle = null, alpha = 1, line = true, lineW = 0.8 } = {}) {
            const px = X(x), py = Y(y + h), pw = w * s, ph = h * s
            if (fillStyle) { ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = fillStyle; ctx.fillRect(px, py, pw, ph); ctx.restore() }
            if (line) strokePx([[px, py], [px + pw, py], [px + pw, py + ph], [px, py + ph]], { role, w: lineW, close: true, exact: true })
        },

        /* GLYPHS */
        /** an eye at p looking along angle `dir`: two lids and a pupil, the scale in pixels */
        eye(p, dir, { size = 16, role = 'ink', id = 'eye' } = {}) {
            const [x, y] = P(p), c = Math.cos(-dir), sn = Math.sin(-dir)
            const T = (u, v) => [x + u * c - v * sn, y + u * sn + v * c]
            const lid = k => { const out = []; for (let i = 0; i <= 14; i++) { const t = i / 14, u = -size * 0.2 + size * 1.2 * t; out.push(T(u - size * 0.5, k * Math.sin(Math.PI * t) * size * 0.42)) } return out }
            strokePx(lid(1), { role, w: 1.1, id: id + 'a' }); strokePx(lid(-1), { role, w: 1.1, id: id + 'b' })
            const [ex, ey] = T(size * 0.22, 0)
            ctx.save(); ctx.fillStyle = col(role); ctx.beginPath(); ctx.arc(ex, ey, size * 0.16, 0, Math.PI * 2); ctx.fill(); ctx.restore()
        },
        /** a point lamp: a small disc and short rays around it */
        bulb(p, { r = 7, role = 'light', id = 'bulb' } = {}) {
            const [x, y] = P(p)
            ctx.save(); ctx.fillStyle = col(role); ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, Math.PI * 2); ctx.fill(); ctx.restore()
            for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + 0.2; strokePx([[x + Math.cos(a) * r, y + Math.sin(a) * r], [x + Math.cos(a) * r * 1.75, y + Math.sin(a) * r * 1.75]], { role, w: 1, id: id + i }) }
        },
        /** a lamp along a segment: a heavy bar and short strokes off its face */
        bar(a, b, { role = 'light', id = 'bar', both = true } = {}) {
            strokePx([P(a), P(b)], { role, w: 3.2, id, cap: 'round' })
            const pa = P(a), pb = P(b), L = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) || 1
            const nx = -(pb[1] - pa[1]) / L, ny = (pb[0] - pa[0]) / L, n = Math.max(2, Math.round(L / 16))
            for (let i = 0; i <= n; i++) {
                const t = (i + 0.5) / (n + 1), x = pa[0] + (pb[0] - pa[0]) * t, y = pa[1] + (pb[1] - pa[1]) * t
                for (const sgn of both ? [1, -1] : [1]) strokePx([[x + nx * 6 * sgn, y + ny * 6 * sgn], [x + nx * 12 * sgn, y + ny * 12 * sgn]], { role, w: 0.9, id: id + i + sgn })
            }
        },
        /** a drag handle at p, registered for figure.js's pointer: a ring the style draws its own way */
        handle(id, p, { role = 'accent', label } = {}) {
            const [x, y] = P(p)
            handles.push({ id, x, y })
            ctx.save()
            ctx.strokeStyle = col(role); ctx.fillStyle = col('paper'); ctx.lineWidth = 1.6
            ctx.beginPath(); ctx.arc(x, y, 7.5, 0, Math.PI * 2); ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke()
            ctx.beginPath(); ctx.moveTo(x - 3.5, y); ctx.lineTo(x + 3.5, y); ctx.moveTo(x, y - 3.5); ctx.lineTo(x, y + 3.5); ctx.stroke()
            ctx.restore()
            if (label) pen.label(p, label, { role, size: 14, dx: 12, dy: -12 })
        },

        /* SHAPES OF THE FLAT WORLD (flatland.js), outlined and filled the style's way */
        flat(sh, { role = 'solid', fill = 'fill', id } = {}) {
            if (sh.kind === 'circle') return pen.circle(sh.c, sh.r, { role, fill, w: 1.25, id })
            if (sh.kind === 'box') {
                const [cx, cy] = sh.c, [hx, hy] = sh.h, r = Math.min(sh.round || 0, hx, hy)
                const pts = []
                const corner = (x, y, a) => { for (let i = 0; i <= 6; i++) { const t = a + i * Math.PI / 12; pts.push([x + r * Math.cos(t), y + r * Math.sin(t)]) } }
                if (r > 0) { corner(cx + hx - r, cy + hy - r, 0); corner(cx - hx + r, cy + hy - r, Math.PI / 2); corner(cx - hx + r, cy - hy + r, Math.PI); corner(cx + hx - r, cy - hy + r, 1.5 * Math.PI) }
                else pts.push([cx + hx, cy + hy], [cx - hx, cy + hy], [cx - hx, cy - hy], [cx + hx, cy - hy])
                return pen.shape(pts, { role, fill, w: 1.25, id })
            }
            if (sh.kind === 'segment') {
                if (sh.emit > 0) return pen.bar(sh.a, sh.b, { id })
                const ax = sh.b[0] - sh.a[0], ay = sh.b[1] - sh.a[1], L = Math.hypot(ax, ay) || 1, a0 = Math.atan2(ay, ax)
                const pts = []
                for (let i = 0; i <= 10; i++) { const t = a0 - Math.PI / 2 - i * Math.PI / 10; pts.push([sh.a[0] + sh.r * Math.cos(t), sh.a[1] + sh.r * Math.sin(t)]) }
                for (let i = 0; i <= 10; i++) { const t = a0 + Math.PI / 2 - i * Math.PI / 10; pts.push([sh.b[0] + sh.r * Math.cos(t), sh.b[1] + sh.r * Math.sin(t)]) }
                return pen.shape(pts, { role, fill: sh.r * s > 3 ? fill : null, w: 1.25, id })
            }
        },

        /**
         * A DISTANCE FIELD drawn as the help's widget draws it, in the style's colours: the inside filled, an iso-line
         * every `step` of distance (marching squares on a grid of `cell` pixels), the zero line -- the surface -- bold.
         */
        field(f, { step = 0.25, cell = 4, inside = 'fill', lines = 'faint', zero = 'solid', insideLines = true } = {}) {
            const W = view.W, H = view.H, nx = Math.ceil(W / cell) + 1, ny = Math.ceil(H / cell) + 1
            const v = new Float32Array(nx * ny)
            for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) v[j * nx + i] = f((i * cell - ox) / s, (oy - j * cell) / s)
            // the inside, as a polygon set would be awkward: cells coloured in at a coarse grid, then clipped by nothing
            ctx.save(); ctx.fillStyle = col(inside); ctx.globalAlpha = theme.fill === 'hatch' ? 0.14 : theme.fill === 'dots' ? 0.2 : 0.16
            for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) if (v[j * nx + i] + v[j * nx + i + 1] + v[(j + 1) * nx + i] + v[(j + 1) * nx + i + 1] < 0) ctx.fillRect(i * cell, j * cell, cell + 0.5, cell + 0.5)
            ctx.restore()
            const iso = (level, role, wdt, alpha) => {
                ctx.save(); ctx.strokeStyle = col(role); ctx.lineWidth = wdt; ctx.globalAlpha = alpha; ctx.beginPath()
                for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
                    const a = v[j * nx + i] - level, b = v[j * nx + i + 1] - level, c = v[(j + 1) * nx + i + 1] - level, d = v[(j + 1) * nx + i] - level
                    const k = (a > 0) | ((b > 0) << 1) | ((c > 0) << 2) | ((d > 0) << 3)
                    if (k === 0 || k === 15) continue
                    const x = i * cell, y = j * cell
                    const e = [[x + cell * a / (a - b), y], [x + cell, y + cell * b / (b - c)], [x + cell * d / (d - c), y + cell], [x, y + cell * a / (a - d)]]
                    const segs = { 1: [3, 0], 2: [0, 1], 3: [3, 1], 4: [1, 2], 5: [3, 0, 1, 2], 6: [0, 2], 7: [3, 2], 8: [2, 3], 9: [0, 2], 10: [0, 1, 2, 3], 11: [1, 2], 12: [1, 3], 13: [0, 1], 14: [0, 3] }[k]
                    for (let q = 0; q < segs.length; q += 2) { ctx.moveTo(...e[segs[q]]); ctx.lineTo(...e[segs[q + 1]]) }
                }
                ctx.stroke(); ctx.restore()
            }
            if (step > 0) {
                let lo = Infinity, hi = -Infinity
                for (const x of v) { if (x < lo) lo = x; if (x > hi) hi = x }
                for (let l = step; l < hi; l += step) iso(l, lines, 0.8, 0.55)
                if (insideLines) for (let l = -step; l > lo; l -= step) iso(l, lines, 0.8, 0.4)
            }
            iso(0, zero, lw * 1.5, 1)
        },
    }
    return pen
}
