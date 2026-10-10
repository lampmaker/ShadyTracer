//======================================================================================================================
// THE THIN LENS'S MEASUREMENT, no GPU (core/lens.js). Run: node lib/pathtracer/core/test/lens.test.mjs
//
// The three ways a lit point reaches a pixel through the lens must agree, or the lens's photons would add a different
// picture to the one the camera's rays draw: a small Lambertian patch (radiance 1) in front of the camera, imaged
//   by the CAMERA'S RAYS        -- genrays' distribution: uniform over the pixel and over the lens (lensRay);
//   by PHOTONS THROUGH THE LENS -- from the patch, cosine-weighted, each crossing the disc adding
//                                  Phi / (A_px A_L cos^4) where its ray back lands (lensImage, lensWeight);
//   by CONNECTIONS              -- a point of the patch to a point of the lens, adding
//                                  Phi f |n.v| / (dist^2 cos^3 A_px)  (ltConnect's G from the lens point).
// Out of focus (a blurred patch over many pixels) and in focus; and the pinhole's limit: a radius of 0 is the
// pinhole's ray. The images are compared pixel by pixel over the pixels the patch lights, against the counting noise.
//======================================================================================================================
import { lensDisc, lensRay, lensImage, lensWeight } from '../lens.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }

// a seeded generator, so a failure is the same failure every run
const rng = (seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 })(12345)

// the camera: at the origin, looking down -z (fwd, target -> camera, is +z), 40 degrees, 8 x 8 pixels
const W = 8, H = 8, t = Math.tan(20 * Math.PI / 180)
const cam = F => ({ pos: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0], fwd: [0, 0, 1], fx: t, fy: t, F })
const apx = 4 * t * t / (W * H)
const pixelOf = xy => (Math.abs(xy[0]) >= 1 || Math.abs(xy[1]) >= 1) ? -1
    : Math.min(W - 1, Math.floor((xy[0] + 1) / 2 * W)) + W * Math.min(H - 1, Math.floor((xy[1] + 1) / 2 * H))

// the patch: a square of side a at depth D, centred off the axis, facing the camera (+z), radiance 1
const A_SIDE = 0.3, D = 3, CX = 0.2, CY = -0.1
const PHI = Math.PI * A_SIDE * A_SIDE                    // flux of radiance 1 over it: L pi A
const onPatch = (x, y) => Math.abs(x - CX) <= A_SIDE / 2 && Math.abs(y - CY) <= A_SIDE / 2

function cameraImage(C, R, n) {
    const img = new Float64Array(W * H)
    for (let p = 0; p < W * H; p++) {
        const px = p % W, py = (p / W) | 0
        let s = 0
        for (let k = 0; k < n; k++) {
            const x = -1 + (px + rng()) * 2 / W, y = -1 + (py + rng()) * 2 / H
            const r = lensRay(x, y, lensDisc(R, rng(), rng()), C)
            if (r.d[2] >= 0) continue
            const tt = (-D - r.o[2]) / r.d[2]
            if (onPatch(r.o[0] + r.d[0] * tt, r.o[1] + r.d[1] * tt)) s += 1
        }
        img[p] = s / n
    }
    return img
}
const patchPoint = () => [CX + (rng() - 0.5) * A_SIDE, CY + (rng() - 0.5) * A_SIDE, -D]
function photonImage(C, R, n) {
    const img = new Float64Array(W * H)
    for (let k = 0; k < n; k++) {
        const P = patchPoint()
        const u = rng(), phi = 2 * Math.PI * rng(), sr = Math.sqrt(u)
        const d = [sr * Math.cos(phi), sr * Math.sin(phi), Math.sqrt(1 - u)]   // cosine-weighted about +z
        const tt = (C.pos[2] - P[2]) / d[2]                                      // to the lens's plane
        const Y = [P[0] + d[0] * tt, P[1] + d[1] * tt, C.pos[2]]
        if (Math.hypot(Y[0] - C.pos[0], Y[1] - C.pos[1]) > R) continue
        const xy = lensImage(Y, d.map(v => -v), C), p = xy && pixelOf(xy)
        if (p >= 0) img[p] += PHI / n * lensWeight(R, d[2], apx)
    }
    return img
}
function connectImage(C, R, n) {
    const img = new Float64Array(W * H)
    for (let k = 0; k < n; k++) {
        const P = patchPoint(), o = lensDisc(R, rng(), rng())
        const Y = [C.pos[0] + o[0], C.pos[1] + o[1], C.pos[2]]
        const dv = [Y[0] - P[0], Y[1] - P[1], Y[2] - P[2]], dist = Math.hypot(...dv), z = dv[2]
        const v = dv.map(c => c / dist)
        const xy = lensImage(Y, v.map(c => -c), C), p = xy && pixelOf(xy)
        if (p < 0 || p == null) continue
        // f = 1 / pi: a Lambertian emitter's flux per projected solid angle; G = |n.v| dist / z^3, ltConnect's
        img[p] += PHI / n * (1 / Math.PI) * Math.abs(v[2]) * dist / (z * z * z) / apx
    }
    return img
}

for (const [label, F] of [['out of focus (focused at 1.2, the patch at 3)', 1.2], ['in focus (at 3)', 3]]) {
    const C = cam(F), R = 0.08
    const ci = cameraImage(C, R, 50000), pi = photonImage(C, R, 1.2e7), ki = connectImage(C, R, 1e6)
    const sum = a => a.reduce((s, v) => s + v, 0)
    const lit = [...ci.keys()].filter(p => ci[p] > 0.05)
    /* about 8 500 photons cross the lens (1.2e7 x its solid angle / pi): the sum is good to about 1 %. Ten times as many
       of each (measured here, 2026-10-09) came to 1.005 and 0.994 of the camera's sum, connections 1.001 and 1.000 */
    const worst = (img, tol) => lit.map(p => Math.abs(img[p] - ci[p]) / Math.max(ci[p], 0.05)).reduce((m, v) => Math.max(m, v), 0)
    ok(`${label}: the patch lights ${lit.length} pixels`, lit.length >= (F === 3 ? 2 : 4), `${lit.length}`)
    ok(`${label}: photons through the lens add the camera's picture -- the sum within 3 %`, Math.abs(sum(pi) / sum(ci) - 1) < 0.03,
        `${sum(pi).toFixed(4)} against ${sum(ci).toFixed(4)}`)
    ok(`${label}: ...and pixel by pixel within 15 %`, worst(pi) < 0.15, `worst ${worst(pi).toFixed(3)}`)
    ok(`${label}: connections from the lens's points add it too -- the sum within 3 %`, Math.abs(sum(ki) / sum(ci) - 1) < 0.03,
        `${sum(ki).toFixed(4)} against ${sum(ci).toFixed(4)}`)
    ok(`${label}: ...and pixel by pixel within 15 %`, worst(ki) < 0.15, `worst ${worst(ki).toFixed(3)}`)
}

// THE PINHOLE'S LIMIT AND THE MAPPING
{
    const C = cam(2)
    const pin = lensRay(0.3, -0.4, [0, 0], C), d0 = [0.3 * t, -0.4 * t, -1], l0 = Math.hypot(...d0)
    ok('a radius of 0: the pinhole\'s ray, from camPos', pin.o.every(v => v === 0) && pin.d.every((v, k) => Math.abs(v - d0[k] / l0) < 1e-15))
    let worstFocus = 0, worstBack = 0
    for (let k = 0; k < 1000; k++) {
        const x = rng() * 2 - 1, y = rng() * 2 - 1, o = lensDisc(0.1, rng(), rng())
        const r = lensRay(x, y, o, C)
        // through the pinhole's point at the focus plane (depth F along -fwd): camPos + F (x fx, y fy, -1)
        const tt = C.F / -r.d[2], Pf = r.o.map((v, i) => v + r.d[i] * tt)
        worstFocus = Math.max(worstFocus, Math.abs(Pf[0] - C.F * x * t), Math.abs(Pf[1] - C.F * y * t), Math.abs(Pf[2] + C.F))
        const back = lensImage(r.o, r.d, C)
        worstBack = Math.max(worstBack, Math.abs(back[0] - x), Math.abs(back[1] - y))
    }
    ok('every ray of a point of the picture crosses the pinhole\'s at the focus plane', worstFocus < 1e-12, `${worstFocus}`)
    ok('lensImage is lensRay\'s inverse, from any point of the lens', worstBack < 1e-12, `${worstBack}`)
    ok('a ray going backwards has no place on the picture', lensImage([0, 0, 0], [0, 0, 1], C) === null)
    let m = 0, inside = true
    for (let k = 0; k < 200000; k++) { const o = lensDisc(2, rng(), rng()); const r2 = o[0] * o[0] + o[1] * o[1]; m += r2 / 200000; inside &&= r2 <= 4 + 1e-12 }
    ok('the disc\'s points are uniform in area: mean r^2 = R^2 / 2, none outside', inside && Math.abs(m - 2) < 0.02, `${m}`)
    ok('the weight: 1 / (A_px pi R^2 cos^4)', Math.abs(lensWeight(0.5, 0.8, 0.01) - 1 / (0.01 * Math.PI * 0.25 * 0.4096)) < 1e-9)
}

console.log(`lens (thin lens): ${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
