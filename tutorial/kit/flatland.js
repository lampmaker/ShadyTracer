//======================================================================================================================
// FLATLAND -- the small 2D world every figure in the tutorial traces. Pure: numbers in, numbers out, no canvas, so
// tutorial/test/tutorial.test.mjs holds it to closed forms.
//
// It does what ShadyTracer does, in a slice: shapes are signed distance fields (the help's 2D mirrors of sdf.js,
// help/widgets.js), rays find them by sphere tracing, a camera has a 1D film, and a path tracer follows light with or
// without next event estimation. It is a teaching copy, not the renderer: one grey channel, diffuse surfaces only,
// one kind of lamp. Later chapters add what they need (mirrors, glass, MIS, photons, haze) when they are written.
//
// THE FLAT WORLD'S OWN LAWS. Light in a plane spreads around a circle, not a sphere, so several numbers differ from
// 3D, and a figure must never borrow a 3D-normalised formula from the engine for its estimator:
//   a point light of intensity I (per radian) gives  E = I cos(theta) / d          (3D: I cos(theta) / d^2)
//   a diffuse surface of albedo rho has              f = rho / 2                   (3D: rho / pi)
//   cosine-weighted directions have pdf              cos(theta) / 2, theta = asin(2u - 1)   (3D: cos / pi)
//   a point of a lamp seen from x, per unit length   G = cos(theta_x) cos(theta_y) / r      (3D: ... / r^2)
// Dimension-free pieces (Fresnel, Snell, Cauchy, the smooth minimum) are the same in both and may be imported.
//======================================================================================================================

import { circle, box } from '../../help/widgets.js'

/* THE RANDOM NUMBERS: the PCG hash (Jarzynski & Olano 2020, the family the renderer's pcg4d belongs to), one 32-bit
   state stepped per draw. Seeded, so a figure and a test can replay exactly the same rays. noise.js's pcg4d is the
   renderer's own, but it allocates an array per call and is there for its test; this is the inner loop's. */
export function rng(seed = 1) {
    let s = (seed >>> 0) || 1
    return () => {
        s = (Math.imul(s, 747796405) + 2891336453) >>> 0
        let w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0
        w = ((w >>> 22) ^ w) >>> 0
        return w / 4294967296
    }
}

/* THE SHAPES. Each { kind, ..., albedo, emit }:
     circle   c: [x, y], r
     box      c: [x, y], h: [half width, half height], round (corner radius, optional)
     segment  a, b: [x, y], r -- a capsule: everything within r of the line from a to b (lamps, thin walls)
   The circle and box are the help's functions (help/widgets.js, as in sdf.js); the capsule is sdf.js's Ncapsule in a
   plane: the distance to the nearest point of the segment, minus r. */
export function shapeDist(sh, x, y) {
    if (sh.kind === 'circle') return circle(x - sh.c[0], y - sh.c[1], sh.r)
    if (sh.kind === 'box') { const r = sh.round || 0; return box(x - sh.c[0], y - sh.c[1], sh.h[0] - r, sh.h[1] - r) - r }
    if (sh.kind === 'segment') {
        const ax = sh.b[0] - sh.a[0], ay = sh.b[1] - sh.a[1], px = x - sh.a[0], py = y - sh.a[1]
        const t = Math.min(1, Math.max(0, (px * ax + py * ay) / (ax * ax + ay * ay || 1)))
        return Math.hypot(px - ax * t, py - ay * t) - sh.r
    }
    if (sh.kind === 'field') return sh.f(x, y)
    return Infinity
}

/** The scene's distance at (x, y): the nearest shape's, a union (the minimum). `out.i` is which shape. */
export function nearest(world, x, y, out = {}) {
    let d = Infinity, i = -1
    const S = world.shapes
    for (let k = 0; k < S.length; k++) { const e = shapeDist(S[k], x, y); if (e < d) { d = e; i = k } }
    out.d = d; out.i = i
    return out
}

/** The field's slope at (x, y) for shape i alone: central differences, the normal of its surface there. */
export function normalAt(world, x, y, i, h = 1e-4) {
    const sh = world.shapes[i]
    const gx = shapeDist(sh, x + h, y) - shapeDist(sh, x - h, y)
    const gy = shapeDist(sh, x, y + h) - shapeDist(sh, x, y - h)
    const l = Math.hypot(gx, gy) || 1
    return [gx / l, gy / l]
}

const NEAR = {}
/**
 * SPHERE TRACING from (ox, oy) along (dx, dy), a unit vector: step by the distance to the nearest surface (times
 * `stepscale`, 0.9 as the renderer's default) until within `eps` of one or `far` away. The march kernel's loop, a ray
 * at a time. Writes `out` and allocates nothing, so a figure can trace thousands of rays a frame; `steps`, if given,
 * receives every point stepped to and its distance (for drawing the circles).
 * @returns out { hit, t, x, y, i, n (steps taken) }
 */
export function march(world, ox, oy, dx, dy, { eps = 1e-3, far = 50, max = 200, stepscale = 0.9, steps = null, skip = -1 } = {}, out = {}) {
    let t = 0
    out.hit = false; out.i = -1
    for (let n = 0; n < max; n++) {
        const x = ox + dx * t, y = oy + dy * t
        nearest(world, x, y, NEAR)
        let d = NEAR.d, i = NEAR.i
        if (skip >= 0 && i === skip) {     // a shape the ray is to pass through (rarely wanted; a lamp's own body)
            d = Infinity
            for (let k = 0; k < world.shapes.length; k++) if (k !== skip) d = Math.min(d, shapeDist(world.shapes[k], x, y))
        }
        const a = Math.abs(d)
        if (steps) steps.push({ x, y, d })
        if (a < eps) { out.hit = true; out.t = t; out.x = x; out.y = y; out.i = i; out.n = n + 1; return out }
        t += a * stepscale
        if (t > far) break
    }
    out.t = t; out.x = ox + dx * t; out.y = oy + dy * t; out.n = max
    return out
}

/* THE CAMERA: a pinhole at `eye` looking along `dir` (an angle, radians), a film of `pixels` across a field of view
   `fov`. A pixel's ray is the genrays kernel's in a plane: x across the film from -1 to 1, through the pixel at a
   point `u` inside it (0.5 its middle; random for jitter), direction normalize(forward + right * x * tan(fov / 2)). */
export function cameraRay(cam, px, u = 0.5) {
    const x = ((px + u) / cam.pixels) * 2 - 1
    const fx = Math.cos(cam.dir), fy = Math.sin(cam.dir)
    const rx = Math.sin(cam.dir), ry = -Math.cos(cam.dir)          // to the right of forward
    const k = x * Math.tan(cam.fov / 2)
    const dx = fx + rx * k, dy = fy + ry * k, l = Math.hypot(dx, dy)
    return [cam.eye[0], cam.eye[1], dx / l, dy / l]
}

const SHADOW = {}
/** Can the point (x, y) see (lx, ly)? A shadow ray: marched from just off the surface, blocked by anything first. */
export function visible(world, x, y, lx, ly, { eps = 1e-3, skip = -1 } = {}) {
    const vx = lx - x, vy = ly - y, r = Math.hypot(vx, vy)
    march(world, x, y, vx / r, vy / r, { eps, far: r, skip }, SHADOW)
    return !SHADOW.hit || SHADOW.t >= r - 2 * eps
}

/** A point light's illuminance on a surface at (x, y) with normal n: I cos(theta) / d in the plane, 0 if blocked. */
export function pointLightE(world, L, x, y, nx, ny, opts) {
    const vx = L.p[0] - x, vy = L.p[1] - y, d = Math.hypot(vx, vy)
    const c = (vx * nx + vy * ny) / d
    if (c <= 0) return 0
    const off = 4 * (opts?.eps ?? 1e-3)
    if (!visible(world, x + nx * off, y + ny * off, L.p[0], L.p[1], opts)) return 0
    return L.I * c / d
}

/** Lambert in the plane: a direction about n at angle theta = asin(2u - 1), pdf cos(theta) / 2. */
export function cosineDir(nx, ny, u) {
    const s = 2 * u - 1, c = Math.sqrt(Math.max(0, 1 - s * s))
    return [nx * c - ny * s, ny * c + nx * s]
}

/* THE LAMP for next event estimation: a shape of kind 'segment' with `emit` > 0 (its radiance, both sides). A point
   on its middle line drawn uniformly -- density 1 / length per unit length -- and turned into a density per radian
   as seen from x by r / (length cos(theta_y)). */
function sampleLamp(sh, u) {
    const ax = sh.a[0], ay = sh.a[1], bx = sh.b[0], by = sh.b[1]
    const len = Math.hypot(bx - ax, by - ay)
    return { x: ax + (bx - ax) * u, y: ay + (by - ay) * u, nx: -(by - ay) / len, ny: (bx - ax) / len, len }
}

const HIT = {}
/** Which shapes are lamps: segments that glow. */
export const lampsOf = world => world.shapes.map((s, i) => s.emit > 0 && s.kind === 'segment' ? i : -1).filter(i => i >= 0)

/**
 * ONE PATH from (ox, oy) along (dx, dy): what radiance comes back along it.
 *   nee: false   light is found only when a bounce happens to hit a lamp
 *   nee: true    at every bounce a shadow ray to a random point of a random lamp; a bounce that hits a lamp after the
 *                first then adds nothing (it was counted by the shadow ray: counting both would count it twice).
 *                ShadyTracer weighs the two instead of choosing (MIS, chapter "mis").
 * `record`, if given, receives the path's pieces for drawing: { kind: 'eye'|'bounce'|'shadow'|'blocked', a, b, beta },
 * with `lamp: true` on the piece that ends on a lamp whose light is counted, and `beta` the throughput the piece carries.
 *   rr: { start, min, max, divide }   Russian roulette as tracebasics.js plays it: from `start` bounces on, the path goes
 *                on with probability p = clamp(beta, min, max) and its survivors carry beta / p. `divide: false` is the
 *                unfair game a chapter shows beside it, survivors keeping beta as it was. Off (null), no number is drawn
 *                for it, so a path without it is the path it always was.
 * `info`, if given, is filled with how the path went: { bounces, end: 'sky'|'lamp'|'cap'|'roulette', upTo }, upTo[b]
 * the light it had gathered by the end of bounce b -- what a cap of b bounces would have returned.
 */
export function tracePath(world, ox, oy, dx, dy, { nee = false, maxBounce = 4, rand, eps = 1e-3, record = null, lampPick, rr = null, info = null } = {}) {
    let L = 0, beta = 1, x = ox, y = oy
    const lamps = lampsOf(world)                 // asked every time: a figure moves and adds shapes
    if (info) { info.bounces = 0; info.end = 'cap'; info.upTo = [] }
    const done = end => { if (info) { info.end = end; while (info.upTo.length <= maxBounce) info.upTo.push(L) } return L }
    for (let b = 0; b <= maxBounce; b++) {
        march(world, x, y, dx, dy, { eps }, HIT)
        if (record) record.push({ kind: b === 0 ? 'eye' : 'bounce', a: [x, y], b: [HIT.x, HIT.y], beta })
        if (!HIT.hit) { L += beta * (world.sky || 0); return done('sky') }
        const sh = world.shapes[HIT.i]
        if (sh.emit > 0) { if (b === 0 || !nee) { L += beta * sh.emit; if (record) record[record.length - 1].lamp = true } return done('lamp') }   // lamps glow and reflect nothing
        let [nx, ny] = normalAt(world, HIT.x, HIT.y, HIT.i)
        if (nx * dx + ny * dy > 0) { nx = -nx; ny = -ny }                    // the side the ray came from
        const px = HIT.x + nx * 4 * eps, py = HIT.y + ny * 4 * eps
        const rho = sh.albedo ?? 0.7
        if (nee && lamps.length) {
            const pick = lampPick ? lampPick(rand()) : Math.min(lamps.length - 1, Math.floor(rand() * lamps.length))
            const li = lamps[pick], lamp = sampleLamp(world.shapes[li], rand())
            const vx = lamp.x - px, vy = lamp.y - py, r = Math.hypot(vx, vy)
            const lx = vx / r, ly = vy / r
            const cx = nx * lx + ny * ly, cy = Math.abs(lamp.nx * lx + lamp.ny * ly)
            if (cx > 0 && cy > 1e-6) {
                march(world, px, py, lx, ly, { eps, far: r + 1 }, SHADOW)
                const ok = SHADOW.hit && SHADOW.i === li          // the first thing the shadow ray meets is that lamp
                if (record) record.push({ kind: ok ? 'shadow' : 'blocked', a: [px, py], b: ok ? [lamp.x, lamp.y] : [SHADOW.x, SHADOW.y] })
                // beta * f * Le * cos_x / pdf, pdf per radian = r / (len cos_y), divided again by the lamp's pick
                if (ok) L += beta * (rho / 2) * world.shapes[li].emit * cx * cy * lamp.len / r * lamps.length
            }
        }
        // the bounce: cosine-weighted, so f cos / pdf = (rho / 2) cos / (cos / 2) = rho
        beta *= rho
        if (info) { info.bounces = b + 1; info.upTo.push(L) }
        if (rr && b < maxBounce && b + 1 >= rr.start) {
            const p = Math.min(rr.max, Math.max(rr.min, beta))
            if (rand() > p) return done('roulette')
            if (rr.divide !== false) beta /= p
        }
        ;[dx, dy] = cosineDir(nx, ny, rand())
        x = px; y = py
    }
    return done('cap')
}
/** tracebasics.js's roulette: from the third bounce, p clamped to [0.1, 0.95] (uRRStart, RR_MIN_P, RR_MAX_P) */
export const ENGINE_RR = { start: 3, min: 0.1, max: 0.95 }

/** Irradiance at (x, y) with normal n from the scene's light, estimated by one direction: what NEE (`nee`) or a
 *  bounce (not) finds. The two estimators the path tracer chooses between, alone, for the test's closed forms. */
export function directE(world, x, y, nx, ny, { nee, rand, eps = 1e-3 }) {
    if (nee) {
        // a point of a lamp: Le cos_x / pdf, the pdf per radian r / (len cos_y), divided again by the lamp's pick
        const lamps = lampsOf(world)
        const li = lamps[Math.min(lamps.length - 1, Math.floor(rand() * lamps.length))], lamp = sampleLamp(world.shapes[li], rand())
        const vx = lamp.x - x, vy = lamp.y - y, r = Math.hypot(vx, vy), lx = vx / r, ly = vy / r
        const cx = nx * lx + ny * ly, cy = Math.abs(lamp.nx * lx + lamp.ny * ly)
        if (!(cx > 0 && cy > 1e-6)) return 0
        march(world, x + nx * 4 * eps, y + ny * 4 * eps, lx, ly, { eps, far: r + 1 }, SHADOW)
        return SHADOW.hit && SHADOW.i === li ? world.shapes[li].emit * cx * cy * lamp.len / r * lamps.length : 0
    }
    // a cosine-weighted direction: L cos / pdf = L cos / (cos / 2) = 2 L, when it meets a lamp
    const [dx, dy] = cosineDir(nx, ny, rand())
    march(world, x + nx * 4 * eps, y + ny * 4 * eps, dx, dy, { eps }, HIT)
    if (!HIT.hit) return 2 * (world.sky || 0)
    const sh = world.shapes[HIT.i]
    return sh.emit > 0 ? 2 * sh.emit : 0
}
