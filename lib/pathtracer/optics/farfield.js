//======================================================================================================================
// THE FAR FIELD -- the traced flux per direction as luminous intensity, and the numbers read off it.
//
//   const I = intensity(O.far, { symmetry: 'none', perKlm: false })   // cd per (C, gamma) bin, +-
//   const c = planeCurve(I, 0)            // the C0-C180 plane: gamma -180..180, C180 on the minus side
//   const s = farStats(O.far, I, [0, 90]) // I max and where, beam and field angles per plane, zones
//
// WHAT FEEDS IT (optics/index.js settings.far, kernels.js FAR_*): every ray that leaves the scene, or
// every ray arriving at one detector material, binned by DIRECTION alone. Position is ignored, so this
// is the luminaire seen from infinitely far away -- which is what intensity means, and what a real
// goniophotometer approximates by standing 5 to 10 luminaire sizes off. A detector feeding it is the
// user's way of saying which rays count (the ones through the lens, not the ones off the mount).
//
// THE GRID is the lighting convention's type C: gamma from the photometric axis (a light's +z), C about
// it from its +x, counterclockwise seen from where the light shines. nG gamma bins centred on 0, dG,
// ..., 180 degrees, the first and last half as wide -- CAPS round the poles -- and nC C bins centred on
// 0, dC, ... A bin's solid angle is exact: dC (cos lo - cos hi), lo and hi its gamma edges.
//
// AT A POLE every C bin is the same direction, and each holds a sliver of the cap: noisy for no
// reason. intensity() pools them -- the cap's flux over the cap's solid angle -- so gamma = 0 reads
// the same in every plane, as it must.
//
// ERRORS. The grid arrives with a standard error per bin from the spread over batches (index.js
// farAccumulator). Where bins are pooled (the caps, rotational symmetry) the pooled error is taken as
// sqrt(sum of se^2): bins of one batch are close to independent (the multinomial correlation between
// them is -p_i p_j, negligible for bins that each hold a small share), so this is a close
// approximation, not an exact one.
//======================================================================================================================

const RAD = Math.PI / 180

/** The grid's geometry: bin widths in degrees and each gamma row's solid angle PER C BIN (sr). */
export function farGeometry(nC, nG) {
    const dC = 360 / nC, dG = 180 / (nG - 1)
    const omega = new Float64Array(nG)
    for (let j = 0; j < nG; j++) {
        const lo = Math.max(0, (j - 0.5) * dG) * RAD, hi = Math.min(180, (j + 0.5) * dG) * RAD
        omega[j] = (2 * Math.PI / nC) * (Math.cos(lo) - Math.cos(hi))
    }
    return { dC, dG, omega }
}

/** THE KERNEL'S BINNING, in JS (kernels.js optFarAdd) -- change both or neither. d, axis, c0 unit
 *  vectors (c0 square to the axis). Returns the bin index ig * nC + ic. */
export function farBin(d, axis, c0, nC, nG) {
    const c90 = [axis[1] * c0[2] - axis[2] * c0[1], axis[2] * c0[0] - axis[0] * c0[2], axis[0] * c0[1] - axis[1] * c0[0]]
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    const g = Math.acos(Math.min(1, Math.max(-1, dot(d, axis))))
    let c = Math.atan2(dot(d, c90), dot(d, c0))
    if (c < 0) c += 2 * Math.PI
    const ig = Math.min(Math.floor(g / Math.PI * (nG - 1) + 0.5), nG - 1)
    const ic = Math.floor(c / (2 * Math.PI) * nC + 0.5) % nC
    return ig * nC + ic
}

/**
 * LUMINOUS INTENSITY per bin, from a far field ({ nC, nG, flux, se, emitted } as index.js O.far).
 *   symmetry  'none', or 'rotational': every C bin of a gamma row pooled -- for a round beam, far less
 *             noise near the axis, where bins are smallest and the peak usually is
 *   perKlm    true: cd per 1000 lm of what the sources emitted, the datasheet's normalisation
 * Returns { nC, nG, dC, dG, I, se (or null), unit }, I gamma-major like the grid.
 */
export function intensity(far, { symmetry = 'none', perKlm = false } = {}) {
    const { nC, nG } = far
    const { dC, dG, omega } = farGeometry(nC, nG)
    const scale = perKlm ? (far.emitted > 0 ? 1000 / far.emitted : 0) : 1
    const I = new Float64Array(nC * nG), se = far.se ? new Float64Array(nC * nG) : null
    const pooled = j => {
        let f = 0, e2 = 0
        for (let i = 0; i < nC; i++) { f += far.flux[j * nC + i]; if (far.se) e2 += far.se[j * nC + i] ** 2 }
        const w = omega[j] * nC
        for (let i = 0; i < nC; i++) { I[j * nC + i] = scale * f / w; if (se) se[j * nC + i] = scale * Math.sqrt(e2) / w }
    }
    for (let j = 0; j < nG; j++) {
        if (j === 0 || j === nG - 1 || symmetry === 'rotational') { pooled(j); continue }
        for (let i = 0; i < nC; i++) {
            const k = j * nC + i
            I[k] = scale * far.flux[k] / omega[j]
            if (se) se[k] = scale * far.se[k] / omega[j]
        }
    }
    return { nC, nG, dC, dG, I, se, unit: perKlm ? 'cd/klm' : 'cd', symmetry }
}

/** I and its error at gamma row j and a C angle in degrees, linear between the two nearest C bins. */
function atC(R, j, C) {
    const x = ((C % 360) + 360) % 360 / R.dC
    const i0 = Math.floor(x) % R.nC, i1 = (i0 + 1) % R.nC, t = x - Math.floor(x)
    const a = j * R.nC
    return { I: R.I[a + i0] * (1 - t) + R.I[a + i1] * t,
             se: R.se ? R.se[a + i0] * (1 - t) + R.se[a + i1] * t : null }
}

/**
 * THE C PLANE THROUGH C and C + 180, as the polar diagram draws it: points { a, I, se } with a the
 * signed angle in degrees, -180..180 -- plus for the C half-plane, minus for C + 180 -- gamma = 0
 * once, in the middle. A C between bins is interpolated.
 */
export function planeCurve(R, C) {
    const pts = []
    for (let j = R.nG - 1; j >= 1; j--) pts.push({ a: -j * R.dG, ...atC(R, j, C + 180) })
    for (let j = 0; j < R.nG; j++) pts.push({ a: j * R.dG, ...atC(R, j, C) })
    return { C, points: pts }
}

/** Where a curve falls to `level` walking out from index p in steps of `dir`, interpolated: the
 *  signed angle, or null when it never does within the curve. */
function crossing(pts, p, dir, level) {
    for (let k = p; k + dir >= 0 && k + dir < pts.length; k += dir) {
        const A = pts[k], Bp = pts[k + dir]
        if (Bp.I < level) {
            const t = A.I === Bp.I ? 0 : (A.I - level) / (A.I - Bp.I)
            return A.a + (Bp.a - A.a) * t
        }
    }
    return null
}

/** Flux in the gamma zone [z0, z1] degrees: each bin's share by the part of its solid angle inside. */
export function zoneFlux(far, z0, z1) {
    const { nC, nG } = far, dG = 180 / (nG - 1)
    let f = 0
    for (let j = 0; j < nG; j++) {
        const lo = Math.max(0, (j - 0.5) * dG), hi = Math.min(180, (j + 0.5) * dG)
        const a = Math.max(lo, z0), b = Math.min(hi, z1)
        if (b <= a) continue
        const share = (Math.cos(a * RAD) - Math.cos(b * RAD)) / (Math.cos(lo * RAD) - Math.cos(hi * RAD))
        let row = 0
        for (let i = 0; i < nC; i++) row += far.flux[j * nC + i]
        f += row * share
    }
    return f
}

/**
 * THE NUMBERS a luminaire is judged by, from the far field and its intensity grid:
 *   max       { I, se, gamma, C }: the brightest bin
 *   planes    per C plane asked for: its curve's peak, and the BEAM angle (where I falls to 50 % of
 *             I max) and FIELD angle (10 %) -- each the full width, and each side on its own, since
 *             an asymmetric beam is not one number. I max is the WHOLE grid's, not the plane's: a
 *             plane that never reaches half of it has no beam angle, and says so (null)
 *   flux      what the far field holds, lm; efficiency its share of what the sources emitted
 *   zones     the flux in 0-30, 0-60, 0-90 and 90-180 degrees
 */
export function farStats(far, R, planes = [0, 90]) {
    let m = 0
    for (let k = 1; k < R.I.length; k++) if (R.I[k] > R.I[m]) m = k
    const max = { I: R.I[m], se: R.se ? R.se[m] : null, gamma: Math.floor(m / R.nC) * R.dG, C: (m % R.nC) * R.dC }
    const flux = far.flux.reduce((a, b) => a + b, 0)
    const widths = C => {
        const { points } = planeCurve(R, C)
        let p = 0
        for (let k = 1; k < points.length; k++) if (points[k].I > points[p].I) p = k
        const at = f => {
            const lvl = f * max.I
            if (!(max.I > 0) || points[p].I < lvl) return null
            const lo = crossing(points, p, -1, lvl), hi = crossing(points, p, +1, lvl)
            return { minus: lo, plus: hi, width: lo != null && hi != null ? hi - lo : null }
        }
        return { C, peak: points[p], beam: at(0.5), field: at(0.1) }
    }
    return {
        max, flux, emitted: far.emitted, efficiency: far.emitted > 0 ? flux / far.emitted : null,
        planes: planes.map(widths),
        zones: [[0, 30], [0, 60], [0, 90], [90, 180]].map(([a, b]) => ({ from: a, to: b, flux: zoneFlux(far, a, b) })),
    }
}

/** The grid as CSV: one row per gamma, one column per C (and its error), in the unit of R. */
export function intensityCSV(R) {
    const head = ['gamma']
    for (let i = 0; i < R.nC; i++) head.push(`C${+(i * R.dC).toFixed(4)}`, ...(R.se ? [`se_C${+(i * R.dC).toFixed(4)}`] : []))
    const rows = [`# luminous intensity, ${R.unit}; type C, gamma from the light's +z, C from its +x`, head.join(',')]
    for (let j = 0; j < R.nG; j++) {
        const r = [+(j * R.dG).toFixed(4)]
        for (let i = 0; i < R.nC; i++) r.push(R.I[j * R.nC + i], ...(R.se ? [R.se[j * R.nC + i]] : []))
        rows.push(r.join(','))
    }
    return rows.join('\n')
}
