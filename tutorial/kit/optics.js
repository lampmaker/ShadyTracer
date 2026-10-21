//======================================================================================================================
// THE OPTICS BENCH -- chapter 31's figures run this. Pure.
//
//   A BEAM FROM FAR AWAY   rays from a point source whose intensity falls as cos^n of the angle off its axis, binned by
//                          direction with optics/farfield.js's own farBin, turned into intensity by its intensity() and
//                          read by its farStats(): the peak and the beam angle against their closed forms.
//   LIGHT ON A FLOOR       the same kind of source 1 m above a floor, its rays' hits mapped by optics/detmap.js's
//                          detectorMap, plain or smoothed, against the closed form E = I0 cos^(n+3)(gamma) / h^2.
//   COUNTING EXACTLY       a ray's weight added again and again to a 32-bit float sum, and to the optics kernels'
//                          integer pair (OPT_FX copied: kernels.js reaches GPU code; the test holds the copy to it).
//======================================================================================================================

import { rng } from './flatland.js'
import { farBin, intensity, farStats, planeCurve } from '../../lib/pathtracer/optics/farfield.js'
import { detectorMap } from '../../lib/pathtracer/optics/detmap.js'

export { intensity, farStats, planeCurve }

/* A cos^n SOURCE of flux PHI lumens: I(gamma) = I0 cos^n gamma over the hemisphere it faces, I0 = (n + 1) PHI / (2 pi)
   (the integral of cos^n over a hemisphere is 2 pi / (n + 1)). Drawn exactly: cos gamma = u^(1/(n+1)). */
export const PHI = 1000
export const I0 = n => (n + 1) * PHI / (2 * Math.PI)
/** the closed-form beam angle, full width where I falls to half its peak: 2 acos(0.5^(1/n)), degrees */
export const beamAngle = n => 2 * Math.acos(0.5 ** (1 / n)) * 180 / Math.PI
export function sourceRay(n, R) {
    const c = R() ** (1 / (n + 1)), s = Math.sqrt(Math.max(0, 1 - c * c)), phi = 2 * Math.PI * R()
    return [s * Math.cos(phi), s * Math.sin(phi), c]
}

/** THE FAR FIELD of `rays` rays of a cos^n source on an nC x nG grid (type C, 5 degree steps by default) */
export function farOf(n, rays, { nC = 24, nG = 37, seed = 1 } = {}) {
    const R = rng(seed * 7477 + n * 31 + rays), flux = new Float64Array(nC * nG), w = PHI / rays
    for (let i = 0; i < rays; i++) flux[farBin(sourceRay(n, R), [0, 0, 1], [1, 0, 0], nC, nG)] += w
    return { nC, nG, flux, se: null, emitted: PHI }
}

/** THE FLOOR: the source H metres up, pointing down; each ray's hit on the floor carries PHI / rays lumens. Rays more
 *  than 85 degrees off the axis would land kilometres away and are left out of the map (not of its flux). */
export const H = 1
export function floorHits(n, rays, seed = 1) {
    const R = rng(seed * 104729 + n * 7 + rays), hits = [], w = PHI / rays
    for (let i = 0; i < rays; i++) {
        const [x, y, c] = sourceRay(n, R)
        if (c < Math.cos(85 * Math.PI / 180)) continue
        hits.push({ pos: [H * x / c, H * y / c, 0], flux: w })
    }
    return hits
}
/** the exact illuminance on the floor at distance r from the spot's centre, lx */
export function floorE(n, r) { const c = H / Math.hypot(H, r); return I0(n) * c ** (n + 3) / (H * H) }
/** the map over a square of half width `half` metres, `cells` across, smoothed as asked */
export function floorMap(n, rays, { smooth = 'none', half = 1, cells = 40, seed = 1, k = 32, bandwidth = 1.5 } = {}) {
    const hits = floorHits(n, rays, seed)
    return detectorMap(hits, { cells, metresPerUnit: 1, range: { a: [-half, half], b: [-half, half] }, smooth, k, bandwidth })
}

/* COUNTING EXACTLY. The optics kernels' tally (kernels.js optAdd): a weight w becomes u32(f32(w) * OPT_FX + 0.5)
   fixed-point units, added to a 64-bit pair of u32 words, the carry done by hand. */
export const OPT_FX = 1 << 20
export const fixedUnits = w => Math.floor(Math.fround(Math.fround(Math.min(4000, Math.max(0, w))) * OPT_FX + 0.5))
/** the pair after `n` adds of the same weight: { units, read (back in weights), hi (carries) } */
export function intSum(w, n) { const units = fixedUnits(w) * n; return { units, read: units / OPT_FX, hi: Math.floor(units / 2 ** 32) } }

/** A 32-bit float sum after `n` adds of `w`, as Math.fround does each add. Jumps through a run of equal steps (each
 *  checked: the step after the jump must be the same step), so 2^25 adds take a moment, not 2^25 of them. */
export function f32Sum(w, n) {
    w = Math.fround(w)
    let S = 0, k = 0
    while (k < n) {
        const next = Math.fround(S + w), d = next - S
        if (d === 0) return S                                  // stalled: every further add rounds back
        let m = 1
        if (S > 0) {
            // S's binade ends at top: below it the spacing is one, so the step stays the same -- unless a tie rounds to
            // even and the steps alternate, which two steps in a row being equal rules out
            const top = 2 ** (Math.floor(Math.log2(S)) + 1)
            m = Math.floor((top - S) / d)
            if (S + m * d >= top) m--
            if (m >= 2 && Math.fround(next + w) - next !== d) m = 1
            m = Math.max(1, Math.min(m, n - k))
        }
        S += m * d; k += m
    }
    return S
}
/** the same, one add at a time (the test holds f32Sum to it) */
export function f32SumSlow(w, n) { let S = 0; w = Math.fround(w); for (let k = 0; k < n; k++) S = Math.fround(S + w); return S }

/** The same random weights added in two orders: in f32 the two sums differ, in the integer pair they cannot. */
export function twoOrders(count = 100000, seed = 1) {
    const R = rng(seed * 9973 + count), ws = Array.from({ length: count }, () => R())
    let a = 0, b = 0, ia = 0, ib = 0, exact = 0
    for (let i = 0; i < count; i++) { a = Math.fround(a + Math.fround(ws[i])); ia += fixedUnits(ws[i]); exact += ws[i] }
    for (let i = count - 1; i >= 0; i--) { b = Math.fround(b + Math.fround(ws[i])); ib += fixedUnits(ws[i]) }
    return { forward: a, backward: b, intForward: ia / OPT_FX, intBackward: ib / OPT_FX, exact }
}
