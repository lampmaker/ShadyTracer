//======================================================================================================================
// THE MANIFOLD CONNECTION'S MEASUREMENT, no GPU (core/manifold.js). Run: node lib/pathtracer/core/test/manifold.test.mjs
//
// A white diffuse floor under glass, lit by a square lamp above it through the glass, seen through the glass from a
// pinhole camera: light -> glass -> floor -> glass -> eye. Drawn two ways, which must agree:
//   by the CAMERA'S RAYS, the renderer's own estimator: refracted in (weight T), the floor, a cosine-weighted bounce
//     (weight rho), refracted out (weight T), the lamp found or not -- the camera side's refractions leave n^2 out;
//   by PHOTONS from the lamp, refracted in, each connected at the floor to the camera through the glass's face by the
//     solve (manifoldSolve) and weighed by manifoldWeight -- flux f T / n^2 / (cos^3 |det J| A_px).
// Under a FLAT face (a slab: the prism's case) and a CURVED one (a dome: the Jacobian's curvature). The scene is its
// distance field, the solver's only view of it, as on the GPU. Then the solver's own refusals.
//======================================================================================================================
import { manifoldSolve, manifoldWeight, refract, fresnelR, MANIFOLD_SPAN } from '../manifold.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const rng = (seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 })(4242)
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = a => { const l = Math.hypot(...a); return a.map(v => v / l) }
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

// the camera: a pinhole at Y looking at the origin, 8 x 8 pixels over 30 degrees
const Y = [0.17, 0.06, 0.55], W = 8, H = 8, tf = Math.tan(15 * Math.PI / 180)
const fwd = norm(Y), right = norm(cross([0, 0, 1], fwd)), up = cross(fwd, right)
const apx = 4 * tf * tf / (W * H)
const image = d => { const c = -dot(d, fwd); return c > 0 ? [dot(d, right) / (c * tf), dot(d, up) / (c * tf)] : null }
const pixelOf = xy => !xy || Math.abs(xy[0]) >= 1 || Math.abs(xy[1]) >= 1 ? -1
    : Math.min(W - 1, Math.floor((xy[0] + 1) / 2 * W)) + W * Math.min(H - 1, Math.floor((xy[1] + 1) / 2 * H))
// the lamp: a square, side 0.16, at height 0.45 beside the axis, facing down, radiance 1; the floor's albedo 0.8
const LZ = 0.45, LC = [-0.08, 0.03], LS = 0.16, RHO = 0.8, N_GLASS = 1.5, TOL = 2e-5
const PHI = Math.PI * LS * LS                         // the lamp's flux at radiance 1: L pi A
const onLamp = (o, d) => { if (d[2] <= 0) return false; const t = (LZ - o[2]) / d[2], p = add(o, d, t)
    return Math.abs(p[0] - LC[0]) <= LS / 2 && Math.abs(p[1] - LC[1]) <= LS / 2 }

/* THE GLASS: where a ray from outside meets it, and from inside where it leaves; its distance field */
const SLAB_H = 0.08
const slab = {
    name: 'a slab (flat face)',
    sdf: p => { const g = Math.max(-p[2], p[2] - SLAB_H), f = p[2]; return Math.abs(g) < Math.abs(f) ? g : f },
    enter: (o, d) => d[2] < 0 && o[2] > SLAB_H ? { p: add(o, d, (SLAB_H - o[2]) / d[2]), n: [0, 0, 1] } : null,
    leave: (o, d) => d[2] > 0 ? { p: add(o, d, (SLAB_H - o[2]) / d[2]), n: [0, 0, -1] } : null,
    inside: p => p[2] >= 0 && p[2] <= SLAB_H,
}
const RD = 0.11
const sphereHit = (o, d, outside) => {               // the sphere |p| = RD, from outside (nearest) or inside (far)
    const b = dot(o, d), c = dot(o, o) - RD * RD, disc = b * b - c
    if (disc < 0) return null
    const t = outside ? -b - Math.sqrt(disc) : -b + Math.sqrt(disc)
    return t > 0 ? add(o, d, t) : null
}
const dome = {
    name: 'a dome (curved face)',
    sdf: p => { const g = Math.max(Math.hypot(...p) - RD, -p[2]), f = p[2]; return Math.abs(g) < Math.abs(f) ? g : f },
    enter: (o, d) => { const p = sphereHit(o, d, true); return p && p[2] > 0 ? { p, n: norm(p) } : null },
    leave: (o, d) => { const p = sphereHit(o, d, false); return p && p[2] > 0 ? { p, n: norm(p).map(v => -v) } : null },
    inside: p => p[2] >= 0 && Math.hypot(...p) <= RD,
}

// the camera's rays: in, the floor, a cosine bounce, out, the lamp
function cameraImage(G, n) {
    const img = new Float64Array(W * H)
    for (let pix = 0; pix < W * H; pix++) {
        const px = pix % W, py = (pix / W) | 0
        let s = 0
        for (let k = 0; k < n; k++) {
            const x = -1 + (px + rng()) * 2 / W, y = -1 + (py + rng()) * 2 / H
            const d = norm(add(add(scaleV(right, x * tf), up, y * tf), fwd, -1))
            const e = G.enter(Y, d); if (!e) continue
            const T1 = 1 - fresnelR(-dot(d, e.n), 1 / N_GLASS), t1 = refract(d, e.n, 1 / N_GLASS)
            if (t1[2] >= 0) continue
            const D = add(e.p, t1, -e.p[2] / t1[2])
            if (!G.inside(D)) continue
            const u = rng(), ph = 2 * Math.PI * rng(), r = Math.sqrt(u)
            const b = [r * Math.cos(ph), r * Math.sin(ph), Math.sqrt(1 - u)]
            const l = G.leave(D, b); if (!l) continue
            const t2 = refract(b, l.n, N_GLASS); if (!t2) continue      // total reflection: not this path
            const T2 = 1 - fresnelR(-dot(b, l.n), N_GLASS)
            if (onLamp(l.p, t2)) s += T1 * RHO * T2
        }
        img[pix] = s / n
    }
    return img
}
const scaleV = (a, s) => a.map(v => v * s)

// photons from the lamp, connected at the floor through the face
function manifoldImage(G, n) {
    const img = new Float64Array(W * H)
    let tried = 0, solved = 0, iters = 0
    for (let k = 0; k < n; k++) {
        const P = [LC[0] + (rng() - 0.5) * LS, LC[1] + (rng() - 0.5) * LS, LZ]
        const u = rng(), ph = 2 * Math.PI * rng(), r = Math.sqrt(u)
        const d = [r * Math.cos(ph), r * Math.sin(ph), -Math.sqrt(1 - u)]
        const e = G.enter(P, d); if (!e) continue
        const T = 1 - fresnelR(-dot(d, e.n), 1 / N_GLASS), t = refract(d, e.n, 1 / N_GLASS)
        if (t[2] >= 0) continue
        const D = add(e.p, t, -e.p[2] / t[2])
        if (!G.inside(D)) continue
        tried++
        const sol = manifoldSolve({ D, nD: [0, 0, 1], nMed: N_GLASS, y: Y, sdf: G.sdf, tol: TOL })
        if (!sol) continue
        solved++; iters += sol.iters
        const pix = pixelOf(image(sol.w)); if (pix < 0) continue
        const cosY = -dot(sol.w, fwd)
        img[pix] += PHI / n * T * (RHO / Math.PI) * manifoldWeight(sol, N_GLASS, cosY, apx)
    }
    return { img, tried, solved, iters }
}

const sum = a => a.reduce((s, v) => s + v, 0)
for (const G of [slab, dome]) {
    const ci = cameraImage(G, 200000), m = manifoldImage(G, G === slab ? 300000 : 1500000)    // a twentieth of the lamp's photons reach the dome
    /* THE INTERIOR: pixels at half the brightest or more. The dome's rim pixels are dim, few photons land there and their
       weights vary most (a grazing exit): at ten times these samples (measured here, 2026-10-09) the dome's sum was
       0.9990 of the camera's, its interior within 2 %, its rim pixels 0.84 to 1.09 */
    /* ...compared in blocks of 2 x 2 pixels: the camera's rays find the lamp through the glass one time in about 70, and a
       pixel's own count of them is the noise the per-pixel comparison would read */
    const block = img => Array.from({ length: (W / 2) * (H / 2) }, (_, b) => {
        const bx = (b % (W / 2)) * 2, by = ((b / (W / 2)) | 0) * 2
        return img[bx + W * by] + img[bx + 1 + W * by] + img[bx + W * (by + 1)] + img[bx + 1 + W * (by + 1)]
    })
    const cb = block(ci), mb = block(m.img)
    const lit = [...cb.keys()].filter(b => cb[b] > 0.5 * Math.max(...cb))
    const worst = lit.map(b => Math.abs(mb[b] / cb[b] - 1)).reduce((a, b) => Math.max(a, b), 0)
    console.log(`  ${G.name}: camera ${sum(ci).toFixed(5)}, manifold ${sum(m.img).toFixed(5)} (${(sum(m.img) / sum(ci)).toFixed(4)});`
        + ` ${m.solved} of ${m.tried} photons connected, ${(m.iters / Math.max(m.solved, 1)).toFixed(2)} Newton steps each; ${lit.length} blocks inside, worst ${worst.toFixed(3)}`)
    /* THE SHARE CONNECTED: under the slab every point in view has its path and is found (the few refused landed far
       out of the picture); under the dome the rim's grazing exits are refused or not found -- 6 % of its photons,
       under a percent of its light by the sum below */
    ok(`${G.name}: the photons under the glass connect (${(100 * m.solved / m.tried).toFixed(1)} %)`,
        m.solved >= (G === slab ? 0.995 : 0.9) * m.tried, `${m.solved} of ${m.tried}`)
    ok(`${G.name}: the manifold's picture is the camera's -- the sum within 2 %`, Math.abs(sum(m.img) / sum(ci) - 1) < 0.02)
    ok(`${G.name}: ...and block by block within 6 % inside it`, lit.length >= 3 && worst < 0.06, `${lit.length} blocks, worst ${worst}`)
}

// THE SOLVER'S OWN: a converged path obeys Snell at x and passes the face first; what it refuses
{
    const D = [0.02, -0.01, 0]
    const s = manifoldSolve({ D, nD: [0, 0, 1], nMed: N_GLASS, y: Y, sdf: slab.sdf, tol: TOL })
    const t = refract(s.w, [0, 0, 1], 1 / N_GLASS)
    ok('a slab: the path from y bends at x by Snell onto D', !!s && Math.abs(s.x[2] - SLAB_H) < 2 * TOL
        && Math.hypot(...sub(add(s.x, t, -s.x[2] / t[2]), D)) < 2 * TOL, JSON.stringify(s))
    ok('a ball in the air between the camera and the face: nothing', manifoldSolve({ D, nD: [0, 0, 1], nMed: N_GLASS, y: Y,
        sdf: p => { const a = slab.sdf(p), b = Math.hypot(p[0] - 0.093, p[1] - 0.025, p[2] - 0.3) - 0.03; return Math.abs(a) < Math.abs(b) ? a : b }, tol: TOL }) === null)
    ok('a ball in the glass between the face and D: nothing', manifoldSolve({ D, nD: [0, 0, 1], nMed: N_GLASS, y: Y,
        sdf: p => { const a = slab.sdf(p), b = Math.hypot(p[0] - 0.03, p[1] - 0.0, p[2] - 0.04) - 0.012; return Math.abs(a) < Math.abs(b) ? a : b }, tol: TOL }) === null)
    ok('D facing away from the camera: nothing', manifoldSolve({ D, nD: [0, 0, -1], nMed: N_GLASS, y: Y, sdf: slab.sdf, tol: TOL }) === null)
    ok('the span is a few tens of tolerances', MANIFOLD_SPAN >= 10 && MANIFOLD_SPAN <= 100)
}

console.log(`manifold: ${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
