//======================================================================================================================
// SPACE -- 3D for the figures where a slice shows less than the whole: a camera to look at a 3D drawing from any side,
// and a small renderer that makes real 3D pictures the way ShadyTracer does, on the CPU. Pure: no canvas, no DOM, so the
// test holds it to closed forms as it holds flatland.js.
//
// Z IS UP, as in ShadyTracer's world (the sun's elevation, the studio light's d.z). The flat world's laws do not apply
// here: light spreads over spheres again, a point light's illuminance falls as 1/d^2, a diffuse surface is rho/pi --
// so the engine's own 3D-normalised functions may be used in an estimator here, where flatland.js forbids them.
//
//   orbit(view)              a camera turning about a target: project(p) -> [x, y, depth] for line drawings
//   march3, normal3, ...     sphere tracing in 3D, as the march kernel does it
//   trace3(world, o, d, ...) one path's radiance [r, g, b], with or without next event estimation
//   shade3(world, o, d, ...) what the cheap views show: steps taken, normals, or direct sunlight with its shadow
//   cameraRay3, cameraRayLens  a picture's rays: through a pinhole, or from a lens with depth of field (lens.js's own)
//======================================================================================================================

import { lensDisc, lensRay } from '../../lib/pathtracer/core/lens.js'

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
export const v3 = { dot, sub, add, scl, cross, norm }

/* AN ORBITING CAMERA for drawings: `yaw` around the vertical, `pitch` above the horizon (radians), `dist` from the
   target, `fov` the vertical field of view. project() gives the point on a screen one unit wide per tan(fov / 2), x right
   and y up -- the figure's world coordinates, so the pen draws it -- and how far in front of the camera it is. */
export function orbit({ yaw = 0.6, pitch = 0.35, dist = 6, target = [0, 0, 0], fov = 0.8 } = {}) {
    const eye = add(target, [dist * Math.cos(pitch) * Math.cos(yaw), dist * Math.cos(pitch) * Math.sin(yaw), dist * Math.sin(pitch)])
    const f = norm(sub(target, eye)), r = norm(cross(f, [0, 0, 1])), u = cross(r, f)
    const k = 1 / Math.tan(fov / 2)
    return {
        eye, f, r, u, k,
        project(p) { const v = sub(p, eye), z = dot(v, f); return [dot(v, r) / z * k, dot(v, u) / z * k, z] },
    }
}

/* THE SHAPES, each { kind, ..., rgb (albedo per channel), emit (radiance, 0 for none) }:
     sphere  c, r            box  c, h (half sizes), round        plane  z (a floor: everything below it is solid)
     torus   c, R, r (lying flat, axis z: sdf.js's Ntorus)
     wall    n (unit), d: the half-space n.p < d is solid -- a room's walls, cheaper than boxes
   Distances written out without arrays, so a march allocates nothing. */
export function dist3(sh, x, y, z) {
    // written with sqrt, not Math.hypot: hypot guards against overflow these sizes never reach, and costs several times more
    if (sh.kind === 'sphere') { const a = x - sh.c[0], b = y - sh.c[1], c = z - sh.c[2]; return Math.sqrt(a * a + b * b + c * c) - sh.r }
    if (sh.kind === 'plane') return z - sh.z
    if (sh.kind === 'wall') return sh.n[0] * x + sh.n[1] * y + sh.n[2] * z - sh.d
    if (sh.kind === 'box') {
        const r = sh.round || 0
        const qx = Math.abs(x - sh.c[0]) - sh.h[0] + r, qy = Math.abs(y - sh.c[1]) - sh.h[1] + r, qz = Math.abs(z - sh.c[2]) - sh.h[2] + r
        const ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0, oz = qz > 0 ? qz : 0
        return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - r
    }
    if (sh.kind === 'torus') { const a = x - sh.c[0], b = y - sh.c[1], q = Math.sqrt(a * a + b * b) - sh.R, c = z - sh.c[2]; return Math.sqrt(q * q + c * c) - sh.r }
    return Infinity
}
export function nearest3(world, x, y, z, out = {}) {
    let d = Infinity, i = -1
    for (let k = 0; k < world.shapes.length; k++) { const e = dist3(world.shapes[k], x, y, z); if (e < d) { d = e; i = k } }
    out.d = d; out.i = i
    return out
}
export function normal3(world, p, i, h = 1e-4) {
    const s = world.shapes[i], [x, y, z] = p
    return norm([dist3(s, x + h, y, z) - dist3(s, x - h, y, z), dist3(s, x, y + h, z) - dist3(s, x, y - h, z), dist3(s, x, y, z + h) - dist3(s, x, y, z - h)])
}

const NEAR = {}
/** SPHERE TRACING in 3D: the march kernel's loop for one ray. `out.n` is the steps it took (the steps view). */
export function march3(world, o, d, { eps = 1e-3, far = 40, max = 160, stepscale = 0.9 } = {}, out = {}) {
    let t = 0
    out.hit = false; out.i = -1
    for (let n = 0; n < max; n++) {
        const x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t
        nearest3(world, x, y, z, NEAR)
        const a = Math.abs(NEAR.d)
        if (a < eps) { out.hit = true; out.t = t; out.p = [x, y, z]; out.i = NEAR.i; out.n = n + 1; return out }
        t += a * stepscale
        if (t > far) { out.n = n + 1; out.t = t; return out }
    }
    out.n = max; out.t = t
    return out
}

/* THE CAMERA OF A PICTURE: a pinhole at `eye` looking at `target`, `fov` the vertical field of view, a W x H film.
   Pixel (i, j) at (u, v) inside it, j counted from the top: genrays's direction, forward + right x fx + up y fy. */
export function cameraRay3(cam, i, j, W, H, u = 0.5, v = 0.5) {
    const f = norm(sub(cam.target, cam.eye)), r = norm(cross(f, [0, 0, 1])), up = cross(r, f)
    const fy = Math.tan(cam.fov / 2), fx = fy * W / H
    const x = ((i + u) / W) * 2 - 1, y = 1 - ((j + v) / H) * 2
    return norm(add(f, add(scl(r, x * fx), scl(up, y * fy))))
}

/* ...THROUGH A LENS: the same picture point's ray from a point of a disc of radius R round the eye, aimed at where the
   pinhole's ray meets the plane F along the axis -- lens.js's own lensDisc and lensRay, the engine's arithmetic. R = 0
   is the pinhole's ray. Returns { o, d }. */
export function cameraRayLens(cam, i, j, W, H, u, v, R, F, l1, l2) {
    const f = norm(sub(cam.target, cam.eye)), r = norm(cross(f, [0, 0, 1])), up = cross(r, f)
    const fy = Math.tan(cam.fov / 2), fx = fy * W / H
    const x = ((i + u) / W) * 2 - 1, y = 1 - ((j + v) / H) * 2
    return lensRay(x, y, lensDisc(R, l1, l2), { pos: cam.eye, right: r, up, fwd: scl(f, -1), fx, fy, F })
}

/** A cosine-weighted direction about n (pdf cos / pi): Lambert's own, which makes a diffuse bounce's weight rho. */
export function cosine3(n, u1, u2) {
    const r = Math.sqrt(u1), phi = 2 * Math.PI * u2
    const t = Math.abs(n[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0]
    const b1 = norm(cross(t, n)), b2 = cross(n, b1)
    return norm(add(add(scl(b1, r * Math.cos(phi)), scl(b2, r * Math.sin(phi))), scl(n, Math.sqrt(Math.max(0, 1 - u1)))))
}

/* A SPHERE LAMP SEEN FROM x: a direction uniform in the cone it fills, and that cone's density per steradian,
   1 / (2 pi (1 - cos theta_max)). ShadyTracer aims at a discovered emitter the same way: into its bounding sphere's cone
   (materials_pbr.js, emitter NEE; tracebasics.js coneOneMinusCos). */
export function sampleCone(x, lamp, u1, u2) {
    const dc = sub(lamp.c, x), d2 = dot(dc, dc), d = Math.sqrt(d2)
    if (d <= lamp.r) return null
    const sin2 = lamp.r * lamp.r / d2, oneMinusCos = sin2 / (1 + Math.sqrt(1 - sin2))   // 1 - cos, without cancellation
    const cosT = 1 - u1 * oneMinusCos, sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT)), phi = 2 * Math.PI * u2
    const axis = scl(dc, 1 / d), t = Math.abs(axis[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0]
    const b1 = norm(cross(t, axis)), b2 = cross(axis, b1)
    const dir = norm(add(add(scl(b1, Math.cos(phi) * sinT), scl(b2, Math.sin(phi) * sinT)), scl(axis, cosT)))
    return { dir, pdf: 1 / (2 * Math.PI * oneMinusCos) }
}

const lampsOf = world => world.shapes.map((s, i) => s.emit > 0 && s.kind === 'sphere' ? i : -1).filter(i => i >= 0)
const H1 = {}, H2 = {}
/**
 * ONE PATH's radiance, [r, g, b]: flatland's tracePath in 3D. Diffuse surfaces (f = rho / pi), glowing spheres as
 * lamps, a sky of `world.sky` ([r, g, b]) for what escapes. With `nee`, a shadow ray at every bounce but the last into
 * the cone of a random lamp, and a bounce that then hits a lamp adds nothing (the shadow ray counted it; ShadyTracer
 * weighs both, MIS).
 */
export function trace3(world, o, d, { nee = false, maxBounce = 4, rand, eps = 1e-3, far = 40 } = {}) {
    const L = [0, 0, 0], beta = [1, 1, 1], lamps = lampsOf(world)
    let x = o
    for (let b = 0; b <= maxBounce; b++) {
        march3(world, x, d, { eps, far }, H1)
        if (!H1.hit) { const s = world.sky ?? [0, 0, 0]; for (let k = 0; k < 3; k++) L[k] += beta[k] * s[k]; break }
        const sh = world.shapes[H1.i]
        if (sh.emit > 0) { if (b === 0 || !nee) for (let k = 0; k < 3; k++) L[k] += beta[k] * sh.emit; break }
        let n = normal3(world, H1.p, H1.i)
        if (dot(n, d) > 0) n = scl(n, -1)
        const p = add(H1.p, scl(n, 4 * eps)), rho = sh.rgb ?? [0.7, 0.7, 0.7]
        // no aiming from the last surface: the bounce from it is never traced (flatland.js tracePath says why)
        if (nee && b < maxBounce && lamps.length) {
            const li = lamps[Math.min(lamps.length - 1, Math.floor(rand() * lamps.length))], s = sampleCone(p, world.shapes[li], rand(), rand())
            if (s) {
                const c = dot(n, s.dir)
                if (c > 0) {
                    march3(world, p, s.dir, { eps, far }, H2)
                    if (H2.hit && H2.i === li) {
                        const w = world.shapes[li].emit * c / s.pdf * lamps.length / Math.PI   // f = rho / pi
                        for (let k = 0; k < 3; k++) L[k] += beta[k] * rho[k] * w
                    }
                }
            }
        }
        for (let k = 0; k < 3; k++) beta[k] *= rho[k]                  // f cos / pdf = (rho / pi) cos / (cos / pi)
        d = cosine3(n, rand(), rand())
        x = p
    }
    return L
}

/** The light arriving at x (normal n) from the scene's lamps, by one direction: aimed (nee) or a cosine bounce. */
export function directE3(world, x, n, { nee, rand, eps = 1e-3 }) {
    const lamps = lampsOf(world)
    if (nee) {
        const li = lamps[Math.min(lamps.length - 1, Math.floor(rand() * lamps.length))], s = sampleCone(x, world.shapes[li], rand(), rand())
        if (!s) return 0
        const c = dot(n, s.dir)
        if (c <= 0) return 0
        march3(world, add(x, scl(n, 4 * eps)), s.dir, { eps }, H2)
        return H2.hit && H2.i === li ? world.shapes[li].emit * c / s.pdf * lamps.length : 0
    }
    const dir = cosine3(n, rand(), rand())                      // L cos / (cos / pi) = pi L, when it meets a lamp
    march3(world, add(x, scl(n, 4 * eps)), dir, { eps }, H2)
    return H2.hit && world.shapes[H2.i].emit > 0 ? Math.PI * world.shapes[H2.i].emit : 0
}

/** A point light's illuminance at x (normal n): I cos(theta) / d^2 in 3D, 0 if something is in the way. */
export function pointLightE3(world, light, x, n, eps = 1e-3) {
    const v = sub(light.p, x), d = Math.hypot(...v), l = scl(v, 1 / d), c = dot(n, l)
    if (c <= 0) return 0
    march3(world, add(x, scl(n, 4 * eps)), l, { eps, far: d }, H2)
    return H2.hit && H2.t < d - 2 * eps ? 0 : light.I * c / (d * d)
}

/**
 * THE CHEAP VIEWS of one camera ray, deterministic, one pass:
 *   'steps'   how many march steps it took (the march's cost, pixel by pixel)
 *   'normal'  the normal where it hit, as a colour (0.5 + n / 2)
 *   'sun'     a diffuse surface under a sun of direction `sun`: rho (cos + ambient), black where the sun is blocked
 * Returns { rgb, steps, hit }.
 */
export function shade3(world, o, d, { view = 'sun', sun = norm([0.4, -0.3, 0.85]), stepscale = 0.9, eps = 1e-3, ambient = 0.18 } = {}) {
    march3(world, o, d, { eps, stepscale }, H1)
    const steps = H1.n
    if (!H1.hit) return { rgb: world.sky ?? [0.62, 0.72, 0.85], steps, hit: false }
    const sh = world.shapes[H1.i]
    let n = normal3(world, H1.p, H1.i)
    if (dot(n, d) > 0) n = scl(n, -1)
    if (view === 'normal') return { rgb: n.map(v => 0.5 + v / 2), steps, hit: true }
    if (sh.emit > 0) return { rgb: [1, 1, 1], steps, hit: true }
    const c = Math.max(0, dot(n, sun))
    let lit = c
    if (c > 0) { march3(world, add(H1.p, scl(n, 4 * eps)), sun, { eps, far: 30 }, H2); if (H2.hit) lit = 0 }
    const rho = sh.rgb ?? [0.7, 0.7, 0.7]
    return { rgb: rho.map(r => r * (lit + ambient)), steps, hit: true }
}

/* DRAWING IN 3D WITH THE PEN: points projected by the orbiting camera, then drawn as any figure draws, so a 3D drawing
   takes the style's lines like the flat ones. Faces are not hidden: draw the far ones first (by `depth`). */
export function draw3(pen, cam) {
    const P = p => { const q = cam.project(p); return [q[0], q[1]] }
    const front = p => cam.project(p)[2] > 1e-3
    return {
        P, depth: p => cam.project(p)[2],
        line: (a, b, o) => { if (front(a) && front(b)) pen.line(P(a), P(b), o) },
        ray: (a, b, o) => { if (front(a) && front(b)) pen.ray(P(a), P(b), o) },
        dot: (p, o) => { if (front(p)) pen.dot(P(p), o) },
        label: (p, t, o) => { if (front(p)) pen.label(P(p), t, o) },
        shape: (pts, o) => { if (pts.every(front)) pen.shape(pts.map(P), o) },
        poly: (pts, o) => { if (pts.every(front)) pen.poly(pts.map(P), o) },
        /** a sphere: its outline (a circle as wide as it looks from here), and its equator, the far half faint */
        sphere(c, r, o = {}) {
            const q = cam.project(c)
            if (q[2] <= r) return
            pen.circle([q[0], q[1]], r * cam.k / Math.sqrt(q[2] * q[2] - r * r), { role: 'solid', w: 1.25, fill: o.fill ?? 'fill', id: o.id })
            const ring = [...Array(49)].map((_, i) => { const a = i / 48 * Math.PI * 2; return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a), c[2]] })
            for (let i = 0; i < 48; i++) {
                const m = scl(add(ring[i], ring[i + 1]), 0.5), near = dot(sub(m, c), sub(cam.eye, c)) > 0
                pen.line(P(ring[i]), P(ring[i + 1]), { role: near ? 'soft' : 'faint', w: 0.6, exact: true, alpha: near ? 0.8 : 0.35 })
            }
        },
    }
}
