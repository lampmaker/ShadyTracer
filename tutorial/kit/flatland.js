//======================================================================================================================
// FLATLAND -- the small 2D world every figure in the tutorial traces. Pure: numbers in, numbers out, no canvas, so
// tutorial/test/tutorial.test.mjs holds it to closed forms.
//
// It does what ShadyTracer does, in a slice: shapes are signed distance fields (the help's 2D mirrors of sdf.js,
// help/widgets.js), rays find them by sphere tracing, a camera has a 1D film, and a path tracer follows light with or
// without next event estimation. It is a teaching copy, not the renderer: one grey channel, diffuse surfaces, mirrors
// (a shape with `mirror: true` reflects a share `albedo` of the light, as a metal's F0 does at every angle here), glass
// (`glass: n`, an index: reflect or refract by Fresnel's law, optics/fresnel.js), segment lamps, and a sun (a world's
// `sun`). Light tracing goes the other way, from the sun to the eye (lightTrace, chapter "caustics"). Later chapters
// add what they need (MIS, photons, haze) when they are written.
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
import { fresnel, refract } from '../../lib/pathtracer/optics/fresnel.js'

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
export function tracePath(world, ox, oy, dx, dy, { nee = false, maxBounce = 4, rand, eps = 1e-3, record = null, lampPick, rr = null, info = null, split = false, map = null, hazeNee = nee } = {}) {
    let L = 0, beta = 1, x = ox, y = oy, delta = false
    /* WHETHER THE LAST VERTEX AIMED AT THE LIGHTS: a lamp or the sun met next is then the shadow ray's, not counted again.
       None at the eye or after a mirror or glass; a surface's is `nee`, a point in the dust's `hazeNee` (chapter "haze":
       light sampling from the air on or off on its own). */
    let aimed = false
    const hz = world.haze
    /* THE PHOTON MAP (map: { photons, r }, chapter "photons"), ShadyTracer's class (sppm.js, WHICH PATHS IT OWNS): a path
       that has met only mirrors and glass since the eye (fromEye, at least one: sawDelta) GATHERS at the first surface
       that scatters, the photons stored there within r; from then on it is `armed`, and the sun or a lamp it reaches
       through mirrors and glass alone is the map's, not counted again. */
    let fromEye = true, sawDelta = false, armed = false
    /* THE SPLIT OF PATH SPACE (split: true), ShadyTracer's with light tracing on (materials_pbr.js, THE SPLIT): a path
       whose FIRST hit scatters (cand) and which after it met only mirrors and glass (delta) is light tracing's when it
       reaches the sun or a lamp, so the camera's side does not count it. Light tracing counts exactly those: sun ->
       mirrors and glass -> one scattering surface -> the eye (lightTrace). Together they count every path once. */
    let cand = false
    const lamps = lampsOf(world)                 // asked every time: a figure moves and adds shapes
    if (info) { info.bounces = 0; info.end = 'cap'; info.upTo = [] }
    const done = end => { if (info) { info.end = end; while (info.upTo.length <= maxBounce) info.upTo.push(L) } return L }
    for (let b = 0; b <= maxBounce; b++) {
        march(world, x, y, dx, dy, { eps }, HIT)
        /* DUST (world.haze, chapter "haze"): the leg's collision drawn by free flight on its stretch inside the box,
           before whatever it hits (haze.js hazeDraw), in air only -- a leg starting inside glass never collides. */
        const tc = hz && !inGlass(world, x, y) ? hazeCollide2(hz, x, y, dx, dy, HIT.hit ? HIT.t : 60, rand()) : -1
        if (tc >= 0) {
            const cx = x + dx * tc, cy = y + dy * tc
            if (record) record.push({ kind: b === 0 ? 'eye' : 'bounce', a: [x, y], b: [cx, cy], beta, dust: true })
            beta *= hz.albedo                                                 // the free flight's weight on a collision
            delta = false; cand = b === 0; armed = false; fromEye = false     // a point that scatters, as a surface is
            aimed = hazeNee
            if (hazeNee) L += beta * dustNee(world, cx, cy, dx, dy, rand, record, lamps, lampPick)
            ;[dx, dy] = phaseSample2(dx, dy, hz.g ?? 0, rand())              // its weight 1: drawn exactly
            x = cx; y = cy
            if (info) { info.bounces = b + 1; info.upTo.push(L) }
            continue
        }
        if (record) record.push({ kind: b === 0 ? 'eye' : 'bounce', a: [x, y], b: [HIT.x, HIT.y], beta })
        const lightTracers = (split && cand && delta) || (map && armed && delta)
        if (!HIT.hit) {
            L += beta * (world.sky || 0)
            // the sun, met by a bounce: counted unless NEE counted it at that bounce, or light tracing owns the path
            if (world.sun && inSun(world.sun, dx, dy) && !aimed && !lightTracers) {
                L += beta * world.sun.L; if (record) record[record.length - 1].lamp = true
            }
            return done('sky')
        }
        const sh = world.shapes[HIT.i]
        // lamps glow and reflect nothing; with NEE a lamp met by a bounce was counted by the shadow ray -- unless the
        // bounce was a mirror's, where no shadow ray could aim (a delta: chapter 8), so the hit is the only way
        if (sh.emit > 0) { if (!aimed && !lightTracers) { L += beta * sh.emit; if (record) record[record.length - 1].lamp = true } return done('lamp') }
        let [nx, ny] = normalAt(world, HIT.x, HIT.y, HIT.i)
        /* GLASS: reflect with the chance Fresnel's law gives (always, past the critical angle), refract otherwise, and
           carry all the light either way (the chance divides out: chapter 10). A delta, as a mirror is. */
        if (sh.glass) {
            const g = glassStep(sh.glass, dx, dy, nx, ny, HIT.x, HIT.y, rand(), eps)
            dx = g.dx; dy = g.dy; x = g.x; y = g.y; delta = true; sawDelta = true; aimed = false
            if (info) { info.bounces = b + 1; info.upTo.push(L) }
            continue
        }
        if (nx * dx + ny * dy > 0) { nx = -nx; ny = -ny }                    // the side the ray came from
        const px = HIT.x + nx * 4 * eps, py = HIT.y + ny * 4 * eps
        const rho = sh.albedo ?? 0.7
        /* A MIRROR: one direction out, the incoming one reflected about the normal, carrying rho of the light. No
           shadow ray: a mirror sends light from a lamp only along that one direction, and a random point of the lamp
           lies on it with probability 0. Roulette is not played on a mirror bounce. */
        if (sh.mirror) {
            const dn = dx * nx + dy * ny
            dx -= 2 * dn * nx; dy -= 2 * dn * ny
            beta *= rho; delta = true; sawDelta = true; aimed = false
            if (info) { info.bounces = b + 1; info.upTo.push(L) }
            x = px; y = py
            continue
        }
        delta = false; aimed = nee
        cand = b === 0                                                        // its first hit scatters: a candidate
        armed = false
        if (map && fromEye && sawDelta) { L += beta * gather(world, map, HIT.x, HIT.y, nx, ny, rho); armed = true }
        fromEye = false
        /* NEE TO THE SUN: a direction in its cone, evenly by angle (pdf 1 / (2 half) per radian), and a shadow ray out
           of the scene; anything in the way, glass included, blocks it (chapter 18's whole problem) */
        if (nee && world.sun) {
            const sn = world.sun, a = sn.dir + (2 * rand() - 1) * sn.half, lx = Math.cos(a), ly = Math.sin(a), c = nx * lx + ny * ly
            if (c > 0) {
                march(world, px, py, lx, ly, { eps, far: 60 }, SHADOW)
                if (record) record.push({ kind: SHADOW.hit ? 'blocked' : 'shadow', a: [px, py], b: SHADOW.hit ? [SHADOW.x, SHADOW.y] : [px + lx * 3, py + ly * 3] })
                // beta * f * L * cos / pdf = beta (rho / 2) L cos (2 half), dimmed by the dust it crosses (hazeShadow)
                if (!SHADOW.hit) L += beta * rho * sn.L * c * sn.half * (hz ? hazeTr2(hz, px, py, lx, ly, 60) : 1)
            }
        }
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
                if (ok) L += beta * (rho / 2) * world.shapes[li].emit * cx * cy * lamp.len / r * lamps.length * (hz ? hazeTr2(hz, px, py, lx, ly, r) : 1)
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

/* THE SUN of a world, `world.sun`: { dir, half, L, aim, width, back } -- the direction towards it (radians), its
   angular radius, its radiance, and where its photons start: a line `width` long across its rays, `back` from `aim`
   towards it (ShadyTracer's sun photons start on a square across the scene: THE EMISSION FRAME, sdf.js). Its
   illuminance on a surface facing it is L 2 sin(half), the flat world's E = L x the angle it fills. */
export const inSun = (sun, dx, dy) => dx * Math.cos(sun.dir) + dy * Math.sin(sun.dir) >= Math.cos(sun.half)
export const sunE = sun => sun.L * 2 * Math.sin(sun.half)

/** ONE CROSSING OF GLASS of index n at (hx, hy), the shape's outward normal (nx, ny), a ray going (dx, dy): reflected
 *  with the chance Fresnel gives (1 past the critical angle), refracted otherwise; the new point a hair off the
 *  surface on the side the ray goes to. ShadyTracer's smooth interface (materials_pbr.js), its weight 1 either way. */
export function glassStep(n, dx, dy, nx, ny, hx, hy, u, eps = 1e-3) {
    const entering = dx * nx + dy * ny < 0, fx = entering ? nx : -nx, fy = entering ? ny : -ny, eta = entering ? 1 / n : n
    const R = fresnel(-(dx * fx + dy * fy), eta).unpolarised
    const t = u < R ? null : refract([dx, dy, 0], [fx, fy, 0], eta)
    if (!t) { const d2 = 2 * (dx * fx + dy * fy); return { dx: dx - d2 * fx, dy: dy - d2 * fy, x: hx + fx * 4 * eps, y: hy + fy * 4 * eps, reflected: true, R } }
    const l = Math.hypot(t[0], t[1])
    return { dx: t[0] / l, dy: t[1] / l, x: hx - fx * 4 * eps, y: hy - fy * 4 * eps, reflected: false, R }
}

/** THE PHOTON MAP'S ESTIMATE at a scattering point (x, y), normal n, albedo rho: the stored photons within r on the same
 *  surface (normals within about 25 degrees: sppm.js SPPM_NORMAL_DOT), each times f = rho / 2, over the length they
 *  were gathered from, 2r -- the flat world's disc of area pi r^2 (sppm.js: sum f Phi / (pi r^2)) */
export function gather(world, map, x, y, nx, ny, rho) {
    let sum = 0
    for (const p of map.photons) if ((p.x - x) ** 2 + (p.y - y) ** 2 < map.r * map.r && p.nx * nx + p.ny * ny >= 0.9) sum += p.flux
    return (rho / 2) * sum / (2 * map.r)
}
/** THE RADIUS'S SCHEDULE in the flat world: r_k = r_1 prod_{i<k} (i + alpha) / (i + 1). Knaus and Zwicker shrink the
 *  gather's AREA by that factor each sample; on a surface in 3D the area is pi r^2, so r^2 shrinks (sppm.js
 *  sppmRadius), and on the flat world's line it is 2r, so r itself does. */
export function radiusFlat(r1, k, alpha = 2 / 3) { let s = 1; for (let i = 1; i < Math.max(1, k | 0); i++) s *= (i + alpha) / (i + 1); return r1 * s }

/* DUST (chapter "haze"): world.haze = { c, h, mfp, albedo, g }, an upright box of it, sigma_t = 1 / mfp. haze.js's
   arithmetic in a plane: a leg's stretch inside the box (hazeSpanJS: two slabs where it has three), what survives
   crossing it (hazeTrJS), its collision by free flight (hazeCollideJS), and the flat world's own phase function. */
/** the stretch [t0, t1] of (x, y) + (dx, dy) t, t in [0, len], inside the box; t1 <= t0 when none */
export function hazeSpan2(hz, x, y, dx, dy, len) {
    let t0 = 0, t1 = len
    for (const [o, d, h] of [[x - hz.c[0], dx, hz.h[0]], [y - hz.c[1], dy, hz.h[1]]]) {
        if (Math.abs(d) < 1e-12) { if (Math.abs(o) > h) return [1, 0]; continue }
        const a = (-h - o) / d, b = (h - o) / d
        t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b))
    }
    return [t0, t1]
}
/** what survives of light crossing that segment: exp(-sigma_t times the length inside) */
export function hazeTr2(hz, x, y, dx, dy, len) { const [a, b] = hazeSpan2(hz, x, y, dx, dy, len); return b > a ? Math.exp(-(b - a) / hz.mfp) : 1 }
/** the collision on that segment, u uniform: t = t0 - ln(1 - u) mfp if it falls before t1, else -1 (none) */
export function hazeCollide2(hz, x, y, dx, dy, len, u) {
    const [a, b] = hazeSpan2(hz, x, y, dx, dy, len)
    if (!(b > a)) return -1
    const t = a - Math.log(1 - u) * hz.mfp
    return t < b ? t : -1
}
const inGlass = (world, x, y) => world.shapes.some(s => s.glass && shapeDist(s, x, y) < 0)
/** THE FLAT WORLD'S PHASE FUNCTION: Henyey-Greenstein's circle version, the wrapped Cauchy distribution, per radian of
 *  the angle between the direction travelled and the one scattered into,
 *      p(theta) = (1 - g^2) / (2 pi (1 + g^2 - 2 g cos theta)),
 *  which integrates to 1 round the circle and has mean cosine g, as HG's has over the sphere (haze.js hgEvalJS). */
export const phase2 = (cosT, g) => (1 - g * g) / (2 * Math.PI * (1 + g * g - 2 * g * cosT))
/** ...a direction drawn from it about (dx, dy), exactly: tan(theta / 2) = (1 - g) / (1 + g) tan(pi (u - 1/2)) */
export function phaseSample2(dx, dy, g, u) {
    const th = 2 * Math.atan((1 - g) / (1 + g) * Math.tan(Math.PI * (u - 0.5))), c = Math.cos(th), s = Math.sin(th)
    return [dx * c - dy * s, dx * s + dy * c]
}
/* LIGHT SAMPLING FROM A POINT IN THE DUST (haze.js mediumNee): the sun, a direction in its cone evenly by angle, or a
   point of a lamp, as a surface aims; the phase function where a surface has f cos, no normal (there is no surface, and
   nothing to start a hair off); the shadow ray dimmed by the dust it crosses. The sun's and a lamp's halves both, each
   as tracePath's own. */
function dustNee(world, x, y, dx, dy, rand, record, lamps, lampPick) {
    const hz = world.haze, g = hz.g ?? 0
    let L = 0
    if (world.sun) {
        const sn = world.sun, a = sn.dir + (2 * rand() - 1) * sn.half, lx = Math.cos(a), ly = Math.sin(a)
        march(world, x, y, lx, ly, { far: 60 }, SHADOW)
        if (record) record.push({ kind: SHADOW.hit ? 'blocked' : 'shadow', a: [x, y], b: SHADOW.hit ? [SHADOW.x, SHADOW.y] : [x + lx * 3, y + ly * 3] })
        // p L / pdf = p L (2 half), per radian
        if (!SHADOW.hit) L += phase2(dx * lx + dy * ly, g) * sn.L * 2 * sn.half * hazeTr2(hz, x, y, lx, ly, 60)
    }
    if (lamps.length) {
        const pick = lampPick ? lampPick(rand()) : Math.min(lamps.length - 1, Math.floor(rand() * lamps.length))
        const li = lamps[pick], lamp = sampleLamp(world.shapes[li], rand())
        const vx = lamp.x - x, vy = lamp.y - y, r = Math.hypot(vx, vy), lx = vx / r, ly = vy / r, cy = Math.abs(lamp.nx * lx + lamp.ny * ly)
        if (cy > 1e-6) {
            march(world, x, y, lx, ly, { far: r + 1 }, SHADOW)
            const ok = SHADOW.hit && SHADOW.i === li
            if (record) record.push({ kind: ok ? 'shadow' : 'blocked', a: [x, y], b: ok ? [lamp.x, lamp.y] : [SHADOW.x, SHADOW.y] })
            if (ok) L += phase2(dx * lx + dy * ly, g) * world.shapes[li].emit * cy * lamp.len / r * lamps.length * hazeTr2(hz, x, y, lx, ly, r)
        }
    }
    return L
}

/** WHERE A POINT LANDS ON THE FILM: the pixel the eye sees (x, y) in, its direction's cosine with the camera's forward
 *  (cf) and the film's width per pixel in tan-space (du) -- cameraRay turned round -- or null if it is off the film */
export function pixelOf(cam, x, y) {
    const vx = x - cam.eye[0], vy = y - cam.eye[1], d = Math.hypot(vx, vy), ux = vx / d, uy = vy / d
    const fx = Math.cos(cam.dir), fy = Math.sin(cam.dir), rx = Math.sin(cam.dir), ry = -Math.cos(cam.dir)
    const cf = ux * fx + uy * fy
    if (cf <= 1e-6) return null
    const T = Math.tan(cam.fov / 2), fxm = (ux * rx + uy * ry) / cf / T
    if (fxm <= -1 || fxm >= 1) return null
    return { px: Math.min(cam.pixels - 1, Math.floor((fxm + 1) / 2 * cam.pixels)), cf, du: 2 * T / cam.pixels, d }
}

/* THE LEARNED EMISSION MAP, ShadyTracer's for its sun photons (wavefront.js prog_lt_build) on a line of K cells: a
   cell's worth is connections per photon sent, hits / emitted (not hits alone, or a cell already favoured would earn
   more by being favoured); a share LT_FLOOR of the photons goes evenly, so no cell is ever out of reach; and both
   counts are halved at every rebuild, so it forgets. It is rebuilt between samples only: a photon must be divided by
   the density it was drawn from. */
export const LT_FLOOR_FLAT = 0.2
export function newLearn(K) { return { K, hits: new Float64Array(K), emitted: new Float64Array(K), p: new Float64Array(K).fill(1 / K) } }
export function learnRebuild(learn) {
    const w = Array.from(learn.emitted, (e, k) => e > 0 ? learn.hits[k] / e : 0), T = w.reduce((a, b) => a + b, 0)
    for (let k = 0; k < learn.K; k++) {
        learn.p[k] = T > 0 ? (1 - LT_FLOOR_FLAT) * w[k] / T + LT_FLOOR_FLAT / learn.K : 1 / learn.K
        learn.hits[k] = Math.floor(learn.hits[k] / 2); learn.emitted[k] = Math.floor(learn.emitted[k] / 2)
    }
}

/**
 * LIGHT TRACING (chapter "caustics"): `n` photons from the world's sun, each followed through mirrors and glass to
 * the first surface that scatters, and connected from there to the eye, as ShadyTracer's sun photons are (wavefront.js
 * prog_genphotons; materials_pbr.js ltConnect). A photon connects only once it has passed glass or a mirror -- the
 * camera's own paths count the rest -- unless `all`; it then ends: going on would count light twice.
 * What a connection adds to its pixel is the photon's light times what the camera's pixel would have read of it:
 *   flux x f x cos(theta_x) / (d x cos^2(theta_c) x du)
 * f = rho / 2 the surface's, theta_x at the surface towards the eye, d the distance, theta_c the direction's angle
 * off the camera's axis and du a pixel's width on the film (pixelOf): the film is flat, so a pixel covers less angle
 * towards its edge, and the cos^2 turns the angle the surface fills into film. The same quantity the camera's own
 * rays estimate, so the two pictures add.
 * Returns the pixels' sums for this batch, { img, sent, connected }; `record` receives a few photons' pieces, `store` (an
 * array) every photon that passed glass or a mirror where it lands, for the photon map (chapter "photons").
 */
export function lightTrace(world, cam, { n = 256, rand, maxBounce = 8, eps = 1e-3, all = false, learn = null, record = null, recordEvery = 16, store = null, connect = true } = {}) {
    const sun = world.sun, img = new Float64Array(cam.pixels)
    const cx = Math.cos(sun.dir), cy = Math.sin(sun.dir), perpX = -cy, perpY = cx
    const ox = sun.aim[0] + cx * sun.back, oy = sun.aim[1] + cy * sun.back
    let connected = 0
    for (let i = 0; i < n; i++) {
        // where on the start line: evenly, or by the learned cells (divided by that density)
        let t, dens = 1, cell = -1
        if (learn) {
            let u = rand(), k = 0
            while (k < learn.K - 1 && u >= learn.p[k]) { u -= learn.p[k]; k++ }
            cell = k; t = (k + rand()) / learn.K; dens = learn.p[k] * learn.K; learn.emitted[k]++
        } else t = rand()
        const off = (2 * rand() - 1) * sun.half, a = sun.dir + off
        let x = ox + perpX * (t - 0.5) * sun.width, y = oy + perpY * (t - 0.5) * sun.width, dx = -Math.cos(a), dy = -Math.sin(a)
        // the sun's light through the line: L cos(off) per radian and unit length, over 2 half radians and the width
        let flux = sun.L * Math.cos(off) * 2 * sun.half * sun.width / dens / n, passed = false
        // recorded: every recordEvery-th photon that reaches glass or a mirror (the ones a figure is about), 12 at most
        const rec = record && record.length < 12 && i % recordEvery === 0 ? [] : null
        for (let b = 0; b <= maxBounce; b++) {
            march(world, x, y, dx, dy, { eps, far: 2 * sun.back + 20 }, HIT)
            if (rec) rec.push({ kind: 'photon', a: [x, y], b: HIT.hit ? [HIT.x, HIT.y] : [x + dx * 30, y + dy * 30] })
            if (!HIT.hit) break
            const sh = world.shapes[HIT.i]
            if (sh.emit > 0) break
            let [nx, ny] = normalAt(world, HIT.x, HIT.y, HIT.i)
            if (sh.glass) { const g = glassStep(sh.glass, dx, dy, nx, ny, HIT.x, HIT.y, rand(), eps); dx = g.dx; dy = g.dy; x = g.x; y = g.y; passed = true; continue }
            if (nx * dx + ny * dy > 0) { nx = -nx; ny = -ny }
            const rho = sh.albedo ?? 0.7
            if (sh.mirror) { const dn = dx * nx + dy * ny; dx -= 2 * dn * nx; dy -= 2 * dn * ny; flux *= rho; x = HIT.x + nx * 4 * eps; y = HIT.y + ny * 4 * eps; passed = true; continue }
            // a scattering surface: stored for the photon map (store: chapter "photons"), connected to the eye, then end
            if (store && passed) store.push({ x: HIT.x, y: HIT.y, nx, ny, flux })
            if (connect && (passed || all)) {
                const px = HIT.x + nx * 4 * eps, py = HIT.y + ny * 4 * eps, f = pixelOf(cam, px, py)
                if (f) {
                    const vx = cam.eye[0] - px, vy = cam.eye[1] - py, cosx = (vx * nx + vy * ny) / f.d
                    if (cosx > 0 && visible(world, px, py, cam.eye[0], cam.eye[1], { eps })) {
                        img[f.px] += flux * (rho / 2) * cosx / (f.d * f.cf * f.cf * f.du)
                        connected++; if (learn) learn.hits[cell]++
                        if (rec) rec.push({ kind: 'connect', a: [px, py], b: [cam.eye[0], cam.eye[1]] })
                    }
                }
            }
            break
        }
        if (rec && passed) record.push(rec)
    }
    return { img, sent: n, connected }
}

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
