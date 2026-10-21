//======================================================================================================================
// NOISE, BIAS AND CHECKING -- chapter 29's figures run this. Pure.
//
//   ONE PIXEL, FOUR READINGS  a pixel of the flat world's floor in a corner lit by a small lamp, its paths traced once
//                             without NEE (the lamp found only by chance, so the samples are heavy-tailed) and read four
//                             ways: the whole path (unbiased), cut after one bounce (a bounce cap: biased), each sample
//                             clamped (a firefly clamp: biased), and averaged over a moving window of 10 (the live
//                             view's EMA: unbiased, its error bar stuck). Every running mean and error bar by the
//                             engine's own measure.js stepMoments and standardError.
//   A CHECK AND ITS CONTROL   the white furnace with one disc, ShadyTracer's furnace test in a plane: rows that must
//                             read 1, a row that must read less, a control that must fail; and the page broken the two
//                             ways ShadyTracer's was, where every row reads 1 and the control with them.
//   AN ERROR BAR CHECKED      many pixels of one brightness, each a sample count of skewed draws (measure.test.mjs's own
//                             experiment): the spread their means really have against the spread they report, and
//                             raytrace_main.js's seRatio over neighbours, with the error bar right and with a mistake
//                             the engine's comment warns of (an EMA window's N taken for its worth).
//======================================================================================================================

import { rng, tracePath } from './flatland.js'
import { stepMoments, standardError } from '../../lib/pathtracer/core/measure.js'

/* THE CORNER: a floor, a wall, a ceiling, and a thin lamp high in the corner; no sky. The camera looks down at one
   point of the floor, so every path starts with the same first hit and its light depends only on where it goes next. */
export const CORNER = {
    sky: 0,
    shapes: [
        { kind: 'box', c: [3, -0.3], h: [4, 0.3], albedo: 0.7, name: 'floor' },
        { kind: 'box', c: [-0.7, 2], h: [0.3, 2.6], albedo: 0.7, name: 'wall' },
        { kind: 'box', c: [3, 4.3], h: [4, 0.3], albedo: 0.7, name: 'ceiling' },
        { kind: 'segment', a: [0, 3.4], b: [1.2, 3.4], r: 0.006, emit: 10, name: 'lamp' },
    ],
}
export const EYE = [5.5, 2.2], LOOK = [2.2, 0]
/* THE READINGS' SETTINGS: a path is followed for up to MAX_BOUNCE bounces, the whole path near enough (computed, on
   the same 200,000 paths followed to 60: a cap of 8 loses 0.28% of the light, 12 0.016%, 16 0.001%); the cap keeps
   what a path found by its first bounce's end; the clamp holds each sample to CLAMP (the lamp found by the first
   bounce brings 0.7 x 10 = 7); the window is the EMA's N. */
export const MAX_BOUNCE = 16, CAP = 1, CLAMP = 4, WINDOW = 10
/* THE PIXEL'S TRUE VALUE: the whole path's long-run mean over a million paths (computed: TRUTH_SE its standard error;
   the cap's reads 0.926 there, the clamp's 1.183). The test holds a fresh run to it. */
export const TRUTH = 1.6440, TRUTH_SE = 0.0025

/** `n` paths through the pixel, seeded: each sample's value read the four ways. */
export function cornerSamples(n, seed = 1) {
    const R = rng(seed * 7919 + 13), info = {}
    const dir = Math.atan2(LOOK[1] - EYE[1], LOOK[0] - EYE[0]), dx = Math.cos(dir), dy = Math.sin(dir)
    const whole = new Float64Array(n), cap = new Float64Array(n)
    for (let i = 0; i < n; i++) {
        whole[i] = tracePath(CORNER, EYE[0], EYE[1], dx, dy, { rand: R, maxBounce: MAX_BOUNCE, info })
        cap[i] = info.upTo[CAP]
    }
    return { whole, cap, clamp: whole.map(v => Math.min(v, CLAMP)) }
}

/** A running mean and its error bar as ShadyTracer keeps them (stepMoments; `window` the EMA's N, Infinity a true
 *  mean): [{ k, Y, se, S }] after each of the samples. */
export function running(values, window = Infinity) {
    let st = { Y: 0, V: 0, S: 0, cnt: 0 }
    const out = []
    for (let k = 0; k < values.length; k++) {
        st = stepMoments(st, values[k], window)
        out.push({ k: k + 1, Y: st.Y, se: standardError(st.V, st.S), S: st.S })
    }
    return out
}
/** The four readings of one seeded run: { whole, cap, clamp, window } each a running() */
export function readings(n = 4096, seed = 1) {
    const s = cornerSamples(n, seed)
    return { whole: running(s.whole), cap: running(s.cap), clamp: running(s.clamp), window: running(s.whole, WINDOW) }
}

/* THE FURNACE: one disc of radius 1 in a sky of brightness 1 everywhere, seen from 3 away by a film of 56 pixels whose
   view the disc fills three quarters of, as ShadyTracer's unit sphere fills about 3/4 of its furnace picture. A matte
   disc's light is found two ways when NEE is on, as the engine's rows have it: a direction drawn evenly over the half
   circle (the sky's own sample) and the bounce's cosine-weighted one, each weighted by the balance heuristic (chapter
   15). Every direction from a convex disc reaches the sky, so each sample is exact but for those weights. */
export const FPIX = 56
const FEYE = [0, -3], FHALF = Math.atan(Math.tan(Math.asin(1 / 3)) / 0.75)
export const FURNACE_ROWS = [
    { id: 'matte', label: 'matte, albedo 1', rho: 1, nee: true, expect: 'reads 1' },
    { id: 'matte-off', label: 'matte, albedo 1, NEE off', rho: 1, nee: false, expect: 'reads 1' },
    { id: 'mirror', label: 'mirror, albedo 1', rho: 1, mirror: true, expect: 'reads 1' },
    { id: 'grey', label: 'matte, albedo 0.8', rho: 0.8, nee: true, expect: 'reads less: a loss it must see' },
    { id: 'control', label: 'CONTROL: black', rho: 0, nee: true, expect: 'must read well below 1' },
]
/** The furnace's film for one row: each pixel the mean of `spp` samples. `page`: 'working'; 'empty', the disc never
 *  drawn (a scene that did not load); 'sky', the camera turned away from it (a target in the wrong unit). */
export function furnaceFilm(row, page = 'working', { spp = 32, seed = 1 } = {}) {
    const R = rng(seed * 104729 + row.rho * 1000 + (row.mirror ? 7 : 0) + (row.nee ? 3 : 0))
    const turn = page === 'sky' ? Math.PI : 0, film = new Float64Array(FPIX)
    for (let i = 0; i < FPIX; i++) {
        let sum = 0
        for (let s = 0; s < spp; s++) {
            const x = ((i + R()) / FPIX) * 2 - 1, k = x * Math.tan(FHALF)
            // the camera looks along +y (or, turned, along -y)
            let dx = k, dy = 1
            if (turn) { dx = -dx; dy = -dy }
            const l = Math.hypot(dx, dy); dx /= l; dy /= l
            sum += page === 'empty' ? 1 : furnaceSample(row, FEYE[0], FEYE[1], dx, dy, R)
        }
        film[i] = sum / spp
    }
    return film
}
/* one sample along a ray: the sky's 1 if it misses the disc, else what the disc sends back */
function furnaceSample(row, ox, oy, dx, dy, R) {
    const b = ox * dx + oy * dy, c = ox * ox + oy * oy - 1, D = b * b - c
    if (D <= 0 || -b - Math.sqrt(D) <= 0) return 1                       // the sky
    const t = -b - Math.sqrt(D), nx = ox + dx * t, ny = oy + dy * t      // the normal of a unit disc is the point
    if (row.mirror) return row.rho                                        // reflected, out to the sky (convex)
    if (!row.nee) return row.rho                                          // cosine-weighted: f cos / pdf = rho, then the sky
    // NEE on: a sky direction drawn evenly over the half circle (pdf 1/pi a radian) and the bounce's (cos / 2), each
    // weighted by the balance heuristic; f = rho / 2 (the flat world's), the sky 1
    const base = Math.atan2(ny, nx)
    const al = base + (R() - 0.5) * Math.PI, cl = Math.cos(al - base)
    const ab = base + Math.asin(2 * R() - 1), cb = Math.cos(ab - base)
    const pl = 1 / Math.PI, f = row.rho / 2
    const light = f * cl / pl * (pl / (pl + cl / 2))
    const bounce = cb > 0 ? row.rho * ((cb / 2) / (pl + cb / 2)) : 0
    return light + bounce
}
/** A row's reading, as raytrace_main.js computes the bench's: the mean over the film against the sky's 1, and its
 *  noise, the mean difference between neighbouring pixels over the mean */
export function furnaceReading(film) {
    let sum = 0, d = 0
    for (let i = 0; i < film.length; i++) { sum += film[i]; if (i + 1 < film.length) d += Math.abs(film[i + 1] - film[i]) }
    const mean = sum / film.length
    return { ratio: mean, noise: mean ? (d / (film.length - 1)) / mean : 0 }
}

/* THE ERROR BAR CHECKED: `pixels` pixels, every one of the same true brightness 1, each a sample count of draws from
   an exponential distribution (mean 1 and spread 1: most samples small, a long bright tail, as a path tracer's are),
   averaged as resolve averages them. `wrongS` puts in the engine's formula a mistake its comment names: an EMA of
   window N taken to be worth its count, N + 1 samples, where it is worth about 2N + 1. */
export function errorBars({ samples = 32, window = Infinity, wrongS = false, pixels = 400, seed = 1 } = {}) {
    const R = rng(seed * 31337 + samples * 17 + (window === Infinity ? 0 : window) * 3)
    const px = []
    for (let p = 0; p < pixels; p++) {
        let st = { Y: 0, V: 0, S: 0, cnt: 0 }
        for (let k = 0; k < samples; k++) st = stepMoments(st, -Math.log(1 - R()), window)
        const S = wrongS ? 1 / Math.min(st.cnt, window + 1) : st.S
        px.push({ Y: st.Y, se: standardError(st.V, S), S: st.S })
    }
    const mean = px.reduce((a, q) => a + q.Y, 0) / pixels
    const real = Math.sqrt(px.reduce((a, q) => a + (q.Y - mean) ** 2, 0) / (pixels - 1))
    const ok = px.filter(q => q.se != null)
    const reported = ok.length ? Math.sqrt(ok.reduce((a, q) => a + q.se ** 2, 0) / ok.length) : null
    // raytrace_main.js seRatio: neighbours of a flat, evenly lit picture differ only by noise
    let d2 = 0, e2 = 0
    for (let p = 0; p + 1 < pixels; p++) if (px[p].se != null && px[p + 1].se != null) { d2 += (px[p].Y - px[p + 1].Y) ** 2; e2 += px[p].se ** 2 + px[p + 1].se ** 2 }
    return { px, mean, real, reported, seRatio: e2 > 0 ? Math.sqrt(d2 / e2) : null, worth: 1 / px[0].S }
}
