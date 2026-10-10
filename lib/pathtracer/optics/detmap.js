//======================================================================================================================
// THE DETECTOR MAP -- the recorded hits on a detector as an illuminance map.
//
//   const m = detectorMap(hits, { cells: 64, metresPerUnit: 0.01, unit: 'lm' })
//   m.E            nx * ny values, row 0 at the -v edge, in lx (or W/m^2 for a source in watts)
//   m.max, m.meanLit, m.minLit, m.total, m.uniformity ...
//
// THE PLANE is fitted to the hits, not read from the object: the hits are all the map has, and a
// detector is whatever surface they landed on. Their principal axes (a 3x3 eigen-decomposition of
// the positions' covariance) give the normal as the direction they spread least along; when that
// normal is within a degree of a world axis the map is laid out along the other two world axes, so a
// floor reads in x and y rather than in whatever diagonal the scatter happened to favour. A detector
// that is not flat (a sphere, a cylinder's side) still maps, as a projection onto that plane:
// `flatness` (the rms distance off the plane over the map's extent) says how far that is from true.
//
// ILLUMINANCE PER CELL is the flux that landed in it over its area, in square METRES: the scene's
// lengths are in its unit, so metresPerUnit (photometry UNITS) converts. Square cells over the hits'
// bounding box, or over `range` ({ a: [min, max], b: [min, max] } in the map's coordinates, about
// the hits' centre) when given -- or a function ({ centre, u, v, normal, axisNames }) => that range,
// for a range known in the world (a detector's measured box, a zoom) that has to be put in the map's
// frame, which is only known here; `cells` is the count along the longer side. The hits' own box is a
// little short of the lit area -- by about a hit spacing -- so its edge cells read a little high:
// fine for a spot, and what `range` is for when a known extent is being measured.
//
// THE NOISE of a cell is about 1 / sqrt(its hits), so a map of 10 000 hits over 64 x 64 cells is a
// picture of noise in its dim parts. `hitsPerLitCell` is there to say so.
//
// SMOOTHING (`smooth`), for when more hits are not to be had. Each is an estimate of the same
// illuminance from the same hits, evaluated at the cell centres, trading noise for a blur of known
// size -- `bandwidth` in CELLS, so it follows the map's own resolution, and reported back in metres:
//   'none'    the histogram above: each hit counts in its own cell only
//   'gauss'   KERNEL DENSITY ESTIMATION with a Gaussian of sigma = bandwidth: every hit spreads
//             over its neighbourhood by distance. Smooth, and it never quite stops (cut at 3 sigma)
//   'epan'    the same with the Epanechnikov kernel, 1 - r^2/h^2 out to h = bandwidth and nothing
//             beyond: the kernel with the least error for a given blur, and a hard edge to its reach
//   'knn'     THE PHOTON-MAP ESTIMATE (Jensen): at each cell centre, the flux of the k nearest hits
//             over the disc they fill, pi r_k^2. ADAPTIVE: where hits are dense r_k is small and edges
//             stay sharp; where they are sparse it reaches further and the dim parts stop being noise.
//             Its noise is about 1/sqrt(k) everywhere. Reach capped at KNN_MAX_CELLS; a centre with
//             fewer than k hits inside that reads 0.
// 'gauss' and 'epan' conserve flux exactly: each hit's kernel is normalised over the cells it
// reaches (smoothMap says why). 'knn' conserves it only on average, and reads low within about r_k
// of the map's edge, where part of the disc it divides by lies off the map. `relNoise` estimates a lit cell's relative
// noise for whichever was used -- the kernels' effective area is 1 / integral(K^2): 4 pi h^2 for the
// Gaussian, 3 pi h^2 / 4 for Epanechnikov. The lit cells -- the ones min, mean and U0 are taken over
// -- are the cells hits landed in, whatever the smoothing, so the statistics compare.
//
// COLOUR (`m.colour`, when the hits carry xyz -- optics readHits does). The X and Z of the hits are
// mapped exactly as their flux (Y) is, same cells, same smoothing, so each cell has an XYZ and so a
// chromaticity. Reported: the detector's whole colour (x, y, u'v', CCT, Duv) from every hit's XYZ
// summed -- exact, since light adds in XYZ -- and its COLOUR UNIFORMITY as the distance in CIE 1976
// u'v' of each cell's colour from that whole: the largest, and the flux-weighted rms. Only cells at
// COLOUR_FLOOR of the peak illuminance or more take part, the beam and not its dim fringe; a cell's
// colour is as noisy as its illuminance, so the largest distance also reads the noise of the
// dimmest cells counted -- more rays, or smoothing, bring it down to the colour itself.
//======================================================================================================================
import { XYZtoxy, xyToUpVp, xyToCctDuv, XYZtoRGB, gamutClip } from '../core/colorimetry.js'

/** The share of the peak illuminance a cell needs to count in the colour uniformity. */
export const COLOUR_FLOOR = 0.1

/** Eigenvectors of a symmetric 3x3 matrix (Jacobi), as { values, vectors } sorted by value, largest
 *  first; vectors[k] is the k-th unit vector. */
export function eigenSym3(A) {
    const a = A.map(r => r.slice())
    const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    for (let sweep = 0; sweep < 50; sweep++) {
        const off = a[0][1] ** 2 + a[0][2] ** 2 + a[1][2] ** 2
        if (off < 1e-30) break
        for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
            if (Math.abs(a[p][q]) < 1e-300) continue
            const th = (a[q][q] - a[p][p]) / (2 * a[p][q])
            const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1))
            const c = 1 / Math.sqrt(t * t + 1), s = t * c
            for (let k = 0; k < 3; k++) {             // columns p, q of a
                const akp = a[k][p], akq = a[k][q]
                a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq
            }
            for (let k = 0; k < 3; k++) {             // rows p, q of a
                const apk = a[p][k], aqk = a[q][k]
                a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk
            }
            for (let k = 0; k < 3; k++) {             // and the rotation into V's columns
                const vkp = V[k][p], vkq = V[k][q]
                V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq
            }
        }
    }
    return [0, 1, 2].map(i => ({ value: a[i][i], vector: [V[0][i], V[1][i], V[2][i]] }))
        .sort((x, y) => y.value - x.value)
        .reduce((o, e) => (o.values.push(e.value), o.vectors.push(e.vector), o), { values: [], vectors: [] })
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
/** The furthest a 'knn' estimate reaches for its k hits, in cells. */
export const KNN_MAX_CELLS = 16
export const MAP_SMOOTHING = ['none', 'gauss', 'epan', 'knn']
const AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
const AXIS_NAMES = ['x', 'y', 'z']

/** The map. `hits` as optics readHits returns them: { pos, flux, dir, tag }, flux in the source's
 *  unit. Returns null for fewer than 3 hits (no plane). */
export function detectorMap(hits, { cells = 64, metresPerUnit = 1, unit = 'lm', range = null,
                                    smooth = 'none', bandwidth = 1.5, k: kNear = 32 } = {}) {
    const n = hits.length
    if (n < 3) return null
    const c = [0, 0, 0]
    for (const h of hits) for (let k = 0; k < 3; k++) c[k] += h.pos[k] / n
    const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
    for (const h of hits) {
        const d = [h.pos[0] - c[0], h.pos[1] - c[1], h.pos[2] - c[2]]
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j] / n
    }
    const { vectors, values } = eigenSym3(C)
    let u = vectors[0], v = vectors[1], nrm = vectors[2]
    // squared up to the world when the plane is (a floor, a wall): within about a degree
    const k = [0, 1, 2].reduce((b, i) => Math.abs(nrm[i]) > Math.abs(nrm[b]) ? i : b, 0)
    let names = null
    if (Math.abs(nrm[k]) > 0.9998) {
        const [i, j] = [0, 1, 2].filter(q => q !== k)
        u = AXES[i]; v = AXES[j]; nrm = AXES[k]
        names = [AXIS_NAMES[i], AXIS_NAMES[j]]
    }
    // the in-plane coordinates of every hit, and their extent
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity
    const ab = hits.map(h => {
        const d = [h.pos[0] - c[0], h.pos[1] - c[1], h.pos[2] - c[2]]
        const a = dot(d, u), b = dot(d, v)
        if (a < a0) a0 = a; if (a > a1) a1 = a
        if (b < b0) b0 = b; if (b > b1) b1 = b
        return [a, b]
    })
    const R = typeof range === 'function' ? range({ centre: c, u, v, normal: nrm, axisNames: names }) : range
    if (R) { [a0, a1] = R.a; [b0, b1] = R.b }
    const span = Math.max(a1 - a0, b1 - b0) || 1e-9
    const size = span / Math.max(1, cells | 0)
    const nx = Math.max(1, Math.ceil((a1 - a0) / size - 1e-9)), ny = Math.max(1, Math.ceil((b1 - b0) / size - 1e-9))
    const flux = new Float64Array(nx * ny), count = new Uint32Array(nx * ny)
    const hasColour = hits.every(h => Array.isArray(h.xyz))
    const fX = hasColour ? new Float64Array(nx * ny) : null, fZ = hasColour ? new Float64Array(nx * ny) : null
    const sum = [0, 0, 0]
    let total = 0, inside = 0
    ab.forEach(([a, b], i) => {
        if (a < a0 || a > a1 || b < b0 || b > b1) return        // outside a given range
        inside++
        const x = Math.min(nx - 1, Math.floor((a - a0) / size)), y = Math.min(ny - 1, Math.floor((b - b0) / size))
        flux[y * nx + x] += hits[i].flux; count[y * nx + x]++
        total += hits[i].flux
        if (hasColour) {
            fX[y * nx + x] += hits[i].xyz[0]; fZ[y * nx + x] += hits[i].xyz[2]
            for (let k = 0; k < 3; k++) sum[k] += hits[i].xyz[k]
        }
    })
    const areaM2 = (size * metresPerUnit) ** 2
    const hist = Float64Array.from(flux, f => f / areaM2)
    const sm = MAP_SMOOTHING.includes(smooth) ? smooth : 'none'
    const smoothOpts = { a0, b0, a1, b1, nx, ny, size, metresPerUnit, h: Math.max(0.1, +bandwidth || 1.5), k: Math.max(1, kNear | 0) }
    const E = sm === 'none' ? hist : smoothMap(sm, ab, hits, smoothOpts)
    /* X and Z the same way: the histogram, or the same smoothing of hits carrying X or Z as their flux */
    const colourMap = (f, c) => sm === 'none' ? Float64Array.from(f, v => v / areaM2)
        : smoothMap(sm, ab, hits.map(h => ({ flux: h.xyz[c] })), smoothOpts)
    const EX = hasColour ? colourMap(fX, 0) : null, EZ = hasColour ? colourMap(fZ, 2) : null
    let max = 0, minLit = Infinity, sumLit = 0, lit = 0
    for (let i = 0; i < E.length; i++) {
        if (E[i] > max) max = E[i]
        if (count[i]) { lit++; sumLit += E[i]; if (E[i] < minLit) minLit = E[i] }
    }
    const meanLit = lit ? sumLit / lit : 0
    const bw = Math.max(0.1, +bandwidth || 1.5)
    /* the hits IN THE MAP: with a range (a zoom) the rest are not in any cell, and counting them made
       every cell look better sampled -- and less noisy -- than it is */
    const hpc = lit ? inside / lit : 0
    const relNoise = !hpc ? null
        : sm === 'knn' ? 1 / Math.sqrt(Math.max(1, kNear | 0))
        : 1 / Math.sqrt(hpc * (sm === 'gauss' ? 4 * Math.PI * bw * bw : sm === 'epan' ? 0.75 * Math.PI * bw * bw : 1))
    const colour = hasColour ? colourStats(sum, E, EX, EZ, count, max) : null
    return {
        E, hist, count, nx, ny, cell: size, origin: c, u, v, normal: nrm, axisNames: names, EX, EZ, colour,
        metresPerUnit,                                          // cell and range are in scene units: this makes them m
        smooth: sm, bandwidth: sm === 'gauss' || sm === 'epan' ? bw : null, k: sm === 'knn' ? Math.max(1, kNear | 0) : null,
        bandwidthM: sm === 'gauss' || sm === 'epan' ? bw * size * metresPerUnit : null,   // the blur, in metres
        relNoise,
        range: { a: [a0, a1], b: [b0, b1] },
        unit: unit === 'W' ? 'W/m²' : 'lx',
        total, max, meanLit, minLit: lit ? minLit : 0, litCells: lit,
        litArea: lit * areaM2,                                  // m^2
        uniformity: meanLit > 0 ? (lit ? minLit : 0) / meanLit : null,
        hitsPerLitCell: hpc, hits: inside,
        flatness: Math.sqrt(Math.max(values[2], 0)) / span,
    }
}

/** THE COLOUR of a map (see COLOUR above): the whole detector's from the summed XYZ, and the u'v'
 *  distance of each cell counted from it. */
function colourStats(sum, E, EX, EZ, count, max) {
    const xy = XYZtoxy(sum)
    if (!xy) return null
    const [u0, v0] = xyToUpVp(xy[0], xy[1])
    const { cct, duv, inRange } = xyToCctDuv(xy[0], xy[1])
    let dMax = 0, s2 = 0, sw = 0, cells = 0
    for (let i = 0; i < E.length; i++) {
        if (!count[i] || !(E[i] >= COLOUR_FLOOR * max) || !(E[i] > 0)) continue
        const cxy = XYZtoxy([EX[i], E[i], EZ[i]])
        if (!cxy) continue
        const [u, v] = xyToUpVp(cxy[0], cxy[1])
        const d = Math.hypot(u - u0, v - v0)
        if (d > dMax) dMax = d
        s2 += E[i] * d * d; sw += E[i]; cells++
    }
    return { x: xy[0], y: xy[1], u: u0, v: v0, cct, duv, cctInRange: inRange,
             dUpVpMax: cells ? dMax : null, dUpVpRms: sw > 0 ? Math.sqrt(s2 / sw) : null, cells, floor: COLOUR_FLOOR }
}

/** A cell's colour for display: its XYZ as linear Rec.709, luminance scaled to `Y`, clipped into the
 *  gamut. null where the map has no colour. */
export function cellColour(m, i, Y = 1) {
    if (!m.EX || !(m.E[i] > 0)) return null
    return gamutClip(XYZtoRGB([m.EX[i] / m.E[i], 1, m.EZ[i] / m.E[i]])).map(v => v * Y)
}

/** THE SMOOTHED MAP (see SMOOTHING above): illuminance at every cell centre from the in-plane hit
 *  coordinates `ab`, in lux (flux per square metre). Hits outside [a0, a1] x [b0, b1] do not count,
 *  as in the histogram. Binned by cell first, so each hit or each centre only looks at the cells
 *  its kernel can reach. */
function smoothMap(sm, ab, hits, { a0, b0, a1, b1, nx, ny, size, metresPerUnit, h, k }) {
    const E = new Float64Array(nx * ny)
    const m2 = metresPerUnit * metresPerUnit                  // scene units^2 -> m^2
    const inRange = i => { const [a, b] = ab[i]; return a >= a0 && a <= a1 && b >= b0 && b <= b1 }
    if (sm === 'gauss' || sm === 'epan') {
        /* EACH HIT DEPOSITS EXACTLY ITS FLUX: its kernel, sampled at the cell centres it reaches,
           is divided by its own sum rather than by the kernel's analytic integral. At a bandwidth
           of a cell or two the centres are too few for the two to agree -- an Epanechnikov of 1.5
           cells touches about seven -- and the map would make or lose light by where each hit fell
           within its cell. Near the edge of the range this also keeps a hit's flux on the map
           instead of spreading part of it off. A hit whose kernel reaches no centre (a bandwidth
           well under a cell) counts in its own cell, as the histogram does. */
        const hs = h * size                                   // the bandwidth in scene units
        const reach = sm === 'gauss' ? 3 * h : h              // in cells
        const R = Math.ceil(reach) + 1
        const cellM2 = size * size * m2
        const wx = [], wc = []
        for (let i = 0; i < ab.length; i++) {
            if (!inRange(i)) continue
            const [a, b] = ab[i]
            const cx = Math.min(nx - 1, Math.floor((a - a0) / size)), cy = Math.min(ny - 1, Math.floor((b - b0) / size))
            wx.length = 0; wc.length = 0
            let ws = 0
            for (let y = Math.max(0, cy - R); y <= Math.min(ny - 1, cy + R); y++) {
                const db = (b0 + (y + 0.5) * size - b) / hs
                for (let x = Math.max(0, cx - R); x <= Math.min(nx - 1, cx + R); x++) {
                    const da = (a0 + (x + 0.5) * size - a) / hs
                    const r2 = da * da + db * db
                    const w = sm === 'gauss' ? (r2 < 9 ? Math.exp(-0.5 * r2) : 0) : (r2 < 1 ? 1 - r2 : 0)
                    if (w > 0) { wx.push(y * nx + x); wc.push(w); ws += w }
                }
            }
            const f = hits[i].flux / cellM2
            if (!(ws > 0)) { E[cy * nx + cx] += f; continue }
            for (let j = 0; j < wx.length; j++) E[wx[j]] += f * wc[j] / ws
        }
        return E
    }
    // 'knn': bin the hits, then grow a square of cells around each centre until it holds k. Those k
    // are within (r + 1/2) sqrt 2 cells of the centre (a corner of the square), so the k NEAREST are
    // too -- and a cell further out than that, in Chebyshev rings, holds none of them
    const bins = Array.from({ length: nx * ny }, () => [])
    for (let i = 0; i < ab.length; i++) {
        if (!inRange(i)) continue
        const [a, b] = ab[i]
        bins[Math.min(ny - 1, Math.floor((b - b0) / size)) * nx + Math.min(nx - 1, Math.floor((a - a0) / size))].push(i)
    }
    const d2 = [], idx = []
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        const ca = a0 + (x + 0.5) * size, cb = b0 + (y + 0.5) * size
        let r = 0, got = 0
        const countRing = rr => {
            let s = 0
            for (let yy = y - rr; yy <= y + rr; yy++) {
                if (yy < 0 || yy >= ny) continue
                for (let xx = x - rr; xx <= x + rr; xx++) {
                    if (xx < 0 || xx >= nx) continue
                    if (Math.max(Math.abs(xx - x), Math.abs(yy - y)) !== rr) continue
                    s += bins[yy * nx + xx].length
                }
            }
            return s
        }
        got = countRing(0)
        while (got < k && r < KNN_MAX_CELLS) { r++; got += countRing(r) }
        if (got < k) continue                                 // too few within reach: left at 0
        const R = Math.min(Math.ceil((r + 0.5) * Math.SQRT2), KNN_MAX_CELLS * 2)
        d2.length = 0; idx.length = 0
        for (let yy = Math.max(0, y - R); yy <= Math.min(ny - 1, y + R); yy++)
            for (let xx = Math.max(0, x - R); xx <= Math.min(nx - 1, x + R); xx++)
                for (const i of bins[yy * nx + xx]) {
                    const da = ab[i][0] - ca, db = ab[i][1] - cb
                    d2.push(da * da + db * db); idx.push(i)
                }
        const order = d2.map((_, j) => j).sort((p, q) => d2[p] - d2[q])
        const rk2 = d2[order[k - 1]]
        if (!(rk2 > 0)) continue
        let f = 0
        for (let j = 0; j < k; j++) f += hits[idx[order[j]]].flux
        E[y * nx + x] = f / (Math.PI * rk2 * m2)
    }
    return E
}

/** Google's Turbo, the same polynomial fit the display pass uses (core/rendertoscreen.js), as
 *  0..255 RGB, so the map's colours mean what the picture's false colour means. */
export function turbo(t) {
    const x = Math.min(1, Math.max(0, t)), x2 = x * x, x3 = x2 * x, x4 = x2 * x2, x5 = x4 * x
    const r = 0.13572138 + 4.61539260 * x - 42.66032258 * x2 + 132.13108234 * x3 - 152.94239396 * x4 + 59.28637943 * x5
    const g = 0.09140261 + 2.19418839 * x + 4.84296658 * x2 - 14.18503333 * x3 + 4.27729857 * x4 + 2.82956604 * x5
    const b = 0.10667330 + 12.64194608 * x - 60.58204836 * x2 + 110.36276771 * x3 - 89.90310912 * x4 + 27.34824973 * x5
    const q = v => Math.round(255 * Math.min(1, Math.max(0, v)))
    return [q(r), q(g), q(b)]
}
