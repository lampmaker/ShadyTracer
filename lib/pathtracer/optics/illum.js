//======================================================================================================================
// ILLUMINANCE, READ OFF A MAP -- profiles, the radial profile, encircled flux, isolux lines, and a map
// of a plane that was never traced: the far field projected onto it.
//
//   const m = detectorMap(hits, ...)                 // optics/detmap.js: a detector's hits as E per cell
//   const m = virtualPlane(far, R, { h: 3 })          // ...or the far field on a plane 3 m away
//   profile(m, 'a', p)   radial(m, p)   encircled(m, p)   isolux(m, [100, 200])
//
// ONE SHAPE FOR BOTH. A map is E per cell (lx for a source in lm) on a grid of square cells:
//   E (row 0 at the -b edge, index y * nx + x), nx, ny, cell and range { a, b } in the map's length
//   unit, metresPerUnit to make them metres, and the noise -- `count` (hits per cell) for a
//   histogram, `relNoise` for a smoothed map, or `se` per cell for a virtual plane.
// Everything here takes cell CENTRES as where E is: a profile is a row of cells, a ring is the cells
// whose centres fall in it. That blurs by up to a cell, and says so in nothing but the cell size --
// the map's resolution is the resolution.
//
// THE NOISE of a cell, when it has one (cellSe): a histogram's cell is about E / sqrt(hits); a
// smoothed cell carries the map's relNoise; a virtual plane's carries its intensity bin's standard
// error. These are estimates, as detmap.js's are -- equal-weight hits, a kernel's effective area.
//
// THE VIRTUAL PLANE. In the far field a luminaire is a point with intensity I(gamma, C), so a plane
// square to its axis at distance h gets E = I cos(gamma) / d^2 = I cos^3(gamma) / h^2 (d the
// distance to the point, cos(gamma) = h / d for both the fall-off and the tilt). It is exact for a
// point, and wrong by the luminaire's size over h: at 5 sizes off, a few percent. A real detector
// at the same distance is the check (the page draws both the same way).
//======================================================================================================================

/*======================================================================================================================
  WHAT A DETECTOR MAP COVERS (detmap.js `range`): by default the whole detector, from its measured box
  (builder/boxes.js) -- not the hits' extent, which is only where light landed, and
  for a small spot on a large screen was the spot alone. A ZOOM is a rectangle of the map itself.
  Both are known in the world or in what the map shows, and a map's range is in its own frame (about
  the hits' centre, along its axes), which only detectorMap knows: so each is a function of the frame.
======================================================================================================================*/
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
/** Where a map shows its coordinates from: the world's origin when its axes are the world's (a floor
 *  reads x, y), else the hits' centre. What the page adds to a map's range to draw it. */
export const displayOffset = f => f.axisNames ? [dot3(f.centre ?? f.origin, f.u), dot3(f.centre ?? f.origin, f.v)] : [0, 0]
/** The map's range for world points (a box's 8 corners): their extent along the map's axes. */
export const rangeOfPoints = points => f => {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity
    for (const p of points) {
        const d = [p[0] - f.centre[0], p[1] - f.centre[1], p[2] - f.centre[2]]
        const a = dot3(d, f.u), b = dot3(d, f.v)
        a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b)
    }
    return a1 > a0 && b1 > b0 ? { a: [a0, a1], b: [b0, b1] } : null
}
/** The map's range for a rectangle in what the map SHOWS ({ a: [lo, hi], b: [lo, hi] }, display
 *  coordinates: a zoom dragged on it). */
export const rangeOfView = view => f => {
    const [oa, ob] = displayOffset(f)
    return { a: [view.a[0] - oa, view.a[1] - oa], b: [view.b[0] - ob, view.b[1] - ob] }
}

/** The centre of cell (x, y), in the map's length unit. */
export const cellCentre = (m, x, y) => [m.range.a[0] + (x + 0.5) * m.cell, m.range.b[0] + (y + 0.5) * m.cell]

/** The cell a point is in, or null off the map. */
export function cellAt(m, a, b) {
    const x = Math.floor((a - m.range.a[0]) / m.cell), y = Math.floor((b - m.range.b[0]) / m.cell)
    return x < 0 || y < 0 || x >= m.nx || y >= m.ny ? null : { x, y, i: y * m.nx + x }
}

/** A cell's standard error, when the map has one (see THE NOISE above); null when not. */
export function cellSe(m, i) {
    if (m.se) return m.se[i]
    if (m.smooth && m.smooth !== 'none') return m.relNoise != null ? m.E[i] * m.relNoise : null
    if (m.count) return m.count[i] ? m.E[i] / Math.sqrt(m.count[i]) : null
    return null
}

/** The brightest cell's centre. */
export function peak(m) {
    let k = 0
    for (let i = 1; i < m.E.length; i++) if (m.E[i] > m.E[k]) k = i
    return cellCentre(m, k % m.nx, Math.floor(k / m.nx))
}

/** The flux-weighted centre (E times the cell's area, which is the same for every cell). */
export function centroid(m) {
    let s = 0, a = 0, b = 0
    for (let y = 0; y < m.ny; y++) for (let x = 0; x < m.nx; x++) {
        const e = m.E[y * m.nx + x]
        if (!(e > 0)) continue
        const [ca, cb] = cellCentre(m, x, y)
        s += e; a += e * ca; b += e * cb
    }
    return s > 0 ? [a / s, b / s] : [(m.range.a[0] + m.range.a[1]) / 2, (m.range.b[0] + m.range.b[1]) / 2]
}

/** THE PROFILE along `axis` ('a' across, 'b' up) through point p: the row (or column) of cells p is
 *  in, as points { x: position, y: E, se }. Empty when p is off the map. */
export function profile(m, axis, p) {
    const c = cellAt(m, p[0], p[1])
    if (!c) return []
    const out = []
    if (axis === 'a') for (let x = 0; x < m.nx; x++) { const i = c.y * m.nx + x; out.push({ x: cellCentre(m, x, c.y)[0], y: m.E[i], se: cellSe(m, i) }) }
    else for (let y = 0; y < m.ny; y++) { const i = y * m.nx + c.x; out.push({ x: cellCentre(m, c.x, y)[1], y: m.E[i], se: cellSe(m, i) }) }
    return out
}

/** Every cell by its distance from p: { r, e, i }, nearest first. */
const byDistance = (m, p) => {
    const list = []
    for (let y = 0; y < m.ny; y++) for (let x = 0; x < m.nx; x++) {
        const [a, b] = cellCentre(m, x, y), i = y * m.nx + x
        list.push({ r: Math.hypot(a - p[0], b - p[1]), e: m.E[i], i })
    }
    return list.sort((u, v) => u.r - v.r)
}

/**
 * THE RADIAL PROFILE about p: E averaged over rings one cell wide, as points { x: r (ring middle),
 * y: E, se, cells }. For a round spot it is the profile with the noise of a whole ring, not one row.
 * Rings that reach past the map's edge average only the cells that are on it -- which is right for
 * E, but the ring is then a part of a circle: `full` is false from the first ring that does.
 */
export function radial(m, p, { width = m.cell } = {}) {
    const rings = []
    const edge = Math.min(p[0] - m.range.a[0], m.range.a[1] - p[0], p[1] - m.range.b[0], m.range.b[1] - p[1])
    for (const c of byDistance(m, p)) {
        if (!Number.isFinite(c.e)) continue          // no value (a colour map's dim cell): not in the ring
        const k = Math.floor(c.r / width)
        const R = rings[k] ??= { sum: 0, n: 0, hits: 0, se2: 0 }
        R.sum += c.e; R.n++
        if (m.count && (!m.smooth || m.smooth === 'none')) R.hits += m.count[c.i]
        const s = cellSe(m, c.i); if (s != null) R.se2 += s * s
    }
    const out = []
    rings.forEach((R, k) => {
        if (!R) return
        const y = R.sum / R.n
        // a histogram's ring is its hits together: E / sqrt(hits in it); otherwise the cells' errors
        // as if independent (a smoothed map's are not: that understates, and the map says it is smoothed)
        const se = R.hits ? y / Math.sqrt(R.hits) : R.se2 ? Math.sqrt(R.se2) / R.n : null
        out.push({ x: (k + 0.5) * width, y, se, cells: R.n, full: (k + 1) * width <= edge })
    })
    return out
}

/**
 * ENCIRCLED FLUX about p: the share of the map's flux within radius r, as points { x: r, y: share }
 * (0..1), cumulative over cells by the distance of their centres; with r50 and r90, the radii that
 * hold half and nine tenths of it, and the map's flux (lm for lx; E times cell area in m^2).
 */
export function encircled(m, p) {
    const area = (m.cell * (m.metresPerUnit ?? 1)) ** 2
    const list = byDistance(m, p)
    const total = list.reduce((s, c) => s + Math.max(0, c.e), 0) * area
    const points = [{ x: 0, y: 0 }]
    let acc = 0
    for (let k = 0; k < list.length; k++) {
        acc += Math.max(0, list[k].e) * area
        // one point per distinct radius: cells at the same distance are one step
        if (k + 1 < list.length && list[k + 1].r === list[k].r) continue
        points.push({ x: list[k].r, y: total > 0 ? acc / total : 0 })
    }
    const radiusAt = f => {
        for (let k = 1; k < points.length; k++) if (points[k].y >= f) {
            const A = points[k - 1], B = points[k]
            return B.y === A.y ? B.x : A.x + (B.x - A.x) * (f - A.y) / (B.y - A.y)
        }
        return null
    }
    return { points, total, r50: radiusAt(0.5), r90: radiusAt(0.9) }
}

/**
 * ISOLUX LINES by marching squares over the cell centres: for each level, the line segments
 * [a0, b0, a1, b1] where E crosses it, interpolated along each square's edges. A saddle (the two
 * diagonals on opposite sides) is split by the square's mean, the usual resolution of the ambiguity.
 */
export function isolux(m, levels) {
    const out = []
    for (const L of levels) {
        const segs = []
        for (let y = 0; y + 1 < m.ny; y++) for (let x = 0; x + 1 < m.nx; x++) {
            // corners counterclockwise from the bottom left: (x, y) (x+1, y) (x+1, y+1) (x, y+1)
            const P = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]]
            const v = P.map(([i, j]) => m.E[j * m.nx + i])
            // a corner with no value (a colour map's dim cell) has no crossing to interpolate
            if (!v.every(Number.isFinite)) continue
            const idx = v.reduce((s, e, k) => s | ((e >= L ? 1 : 0) << k), 0)
            if (idx === 0 || idx === 15) continue
            // the crossing on edge k (corner k to corner k+1)
            const cross = k => {
                const [i0, j0] = P[k], [i1, j1] = P[(k + 1) % 4], a = v[k], b = v[(k + 1) % 4]
                const t = a === b ? 0.5 : (L - a) / (b - a)
                return cellCentre(m, i0 + (i1 - i0) * t, j0 + (j1 - j0) * t)
            }
            // edges whose ends are on opposite sides of the level, in order round the square
            const edges = [0, 1, 2, 3].filter(k => ((idx >> k) & 1) !== ((idx >> ((k + 1) % 4)) & 1))
            if (edges.length === 2) { const [p, q] = edges.map(cross); segs.push([...p, ...q]); continue }
            // a saddle: four crossings; pair them so the side the centre is on stays connected
            const centreAbove = (v[0] + v[1] + v[2] + v[3]) / 4 >= L
            const pairs = (((idx & 1) === 1) === centreAbove) ? [[0, 1], [2, 3]] : [[3, 0], [1, 2]]
            for (const [e0, e1] of pairs) { const p = cross(e0), q = cross(e1); segs.push([...p, ...q]) }
        }
        out.push({ level: L, segs })
    }
    return out
}

/** The intensity at (gamma, C) in degrees, bilinear on the grid (C wraps; the poles are pooled). */
export function intensityAt(R, gamma, C) {
    const g = Math.min(180, Math.max(0, gamma)) / R.dG, c = (((C % 360) + 360) % 360) / R.dC
    const j0 = Math.min(R.nG - 1, Math.floor(g)), j1 = Math.min(R.nG - 1, j0 + 1), tg = g - Math.floor(g)
    const i0 = Math.floor(c) % R.nC, i1 = (i0 + 1) % R.nC, tc = c - Math.floor(c)
    const v = (A, j) => A[j * R.nC + i0] * (1 - tc) + A[j * R.nC + i1] * tc
    return { I: v(R.I, j0) * (1 - tg) + v(R.I, j1) * tg, se: R.se ? v(R.se, j0) * (1 - tg) + v(R.se, j1) * tg : null }
}

/**
 * THE FAR FIELD ON A PLANE square to the photometric axis, h metres from the luminaire (taken as a
 * point), `cells` across a square of half-width `half` metres -- or, with half 0, wide enough for
 * everything above 1 % of I max, to 80 degrees off the axis at most. a runs along C = 0, b along
 * C = 90. R must be in cd (intensity() with perKlm false) for the result to be lux.
 */
export function virtualPlane(far, R, { h = 1, half = 0, cells = 64 } = {}) {
    if (!(half > 0)) {
        let reach = 0, max = 0
        for (let k = 0; k < R.I.length; k++) max = Math.max(max, R.I[k])
        for (let j = 0; j < R.nG; j++) for (let i = 0; i < R.nC; i++)
            if (R.I[j * R.nC + i] > 0.01 * max) reach = Math.max(reach, j * R.dG)
        half = h * Math.tan(Math.min(80, Math.max(1, reach * 1.15)) * Math.PI / 180)
    }
    const n = Math.max(2, cells | 0), cell = 2 * half / n
    const E = new Float64Array(n * n), se = R.se ? new Float64Array(n * n) : null
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const a = -half + (x + 0.5) * cell, b = -half + (y + 0.5) * cell
        const rho = Math.hypot(a, b), cg = h / Math.hypot(h, rho)
        const gamma = Math.atan2(rho, h) * 180 / Math.PI, C = Math.atan2(b, a) * 180 / Math.PI
        const { I, se: s } = intensityAt(R, gamma, C)
        const k = cg ** 3 / (h * h)
        E[y * n + x] = I * k
        if (se) se[y * n + x] = s * k
    }
    let max = 0, sum = 0, lit = 0, min = Infinity
    for (const e of E) { if (e > max) max = e; if (e > 0) { sum += e; lit++; if (e < min) min = e } }
    const mean = lit ? sum / lit : 0
    return {
        E, se, count: null, nx: n, ny: n, cell, range: { a: [-half, half], b: [-half, half] }, metresPerUnit: 1,
        axisNames: ['C0', 'C90'], unit: far.unit === 'W' ? 'W/m²' : 'lx', h, virtual: true,
        max, meanLit: mean, minLit: lit ? min : 0, uniformity: mean > 0 ? (lit ? min : 0) / mean : null,
        total: sum * cell * cell, litCells: lit,
    }
}
