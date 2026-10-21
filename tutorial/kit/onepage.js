//======================================================================================================================
// A RAY TRACER IN ONE PAGE -- chapter 32. A whole path tracer for the flat world, as short as it can be said and still
// be right: shapes as distances, a march, a normal, a camera, a path that bounces and aims at a lamp. No imports: this
// file is the whole program. The tutorial's flatland.js is this, grown (glass, a sun, dust, photons); the test holds the
// two to the same answers, so what is learned here is what every figure in the tutorial runs.
//
// The flat world's laws (chapter 0): light spreads round a circle, not a sphere, so a matte surface sends back
// albedo / 2 of what reaches it in each direction (3D: albedo / pi), and a lamp's light falls as 1 / distance.
//======================================================================================================================

/* 1. SHAPES AS DISTANCES (chapter 2): how far a point is from each shape, negative inside. Outside a box's corner the
   nearest point is the corner itself, hence the hypot; a segment with a radius is a capsule, the shape the lamps are. */
export const circle = (x, y, s) => Math.hypot(x - s.c[0], y - s.c[1]) - s.r
export function box(x, y, s) {
    const qx = Math.abs(x - s.c[0]) - s.h[0], qy = Math.abs(y - s.c[1]) - s.h[1]
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0)
}
export function segment(x, y, s) {
    const ax = s.b[0] - s.a[0], ay = s.b[1] - s.a[1], px = x - s.a[0], py = y - s.a[1]
    const t = Math.min(1, Math.max(0, (px * ax + py * ay) / (ax * ax + ay * ay)))
    return Math.hypot(px - ax * t, py - ay * t) - s.r
}
const DIST = { circle, box, segment }
/** the scene's distance at (x, y): the nearest shape's, and which shape that is */
export function nearest(shapes, x, y) {
    let d = Infinity, i = -1
    for (let k = 0; k < shapes.length; k++) { const e = DIST[shapes[k].kind](x, y, shapes[k]); if (e < d) { d = e; i = k } }
    return { d, i }
}

/* 2. THE MARCH (chapter 2): step along the ray by the distance to the nearest surface, which can never overshoot one,
   until that distance is tiny (a hit) or the ray is far away (a miss). 0.9 of the distance, as the renderer steps. */
export function march(shapes, x, y, dx, dy, { eps = 1e-3, far = 50, steps = null } = {}) {
    let t = 0
    for (let n = 0; n < 200; n++) {
        const px = x + dx * t, py = y + dy * t, { d, i } = nearest(shapes, px, py)
        if (steps) steps.push({ x: px, y: py, d })
        if (Math.abs(d) < eps) return { x: px, y: py, i, n: n + 1 }
        t += Math.abs(d) * 0.9
        if (t > far) break
    }
    return null
}

/* 3. THE NORMAL (chapter 4): the way the hit shape's distance grows fastest, by central differences (a look a hair to
   each side, across and up) */
export function normal(s, x, y, h = 1e-4) {
    const f = DIST[s.kind], gx = f(x + h, y, s) - f(x - h, y, s), gy = f(x, y + h, s) - f(x, y - h, s), l = Math.hypot(gx, gy) || 1
    return [gx / l, gy / l]
}

/* 4. THE CAMERA (chapter 1): a pinhole at `eye` looking along the angle `dir`, a film of `pixels`; pixel i's ray goes
   through the point u (0 to 1) across it, so a random u spreads a pixel's samples over its width */
export function camera(cam, i, u) {
    const x = ((i + u) / cam.pixels) * 2 - 1, k = x * Math.tan(cam.fov / 2)
    const dx = Math.cos(cam.dir) + Math.sin(cam.dir) * k, dy = Math.sin(cam.dir) - Math.cos(cam.dir) * k, l = Math.hypot(dx, dy)
    return [cam.eye[0], cam.eye[1], dx / l, dy / l]
}

/* 5. AIMING AT A LAMP (chapter 14): a point drawn evenly on the lamp, a shadow ray to it; if nothing is in the way,
   the light it sends here: albedo / 2 x its brightness x the two cosines x the length it was drawn from / the
   distance, the flat world's 1/r, x the number of lamps (one picked of several). The lamp is a capsule glowing from its
   whole outline, which is what a bounce can hit, so the point is drawn on that outline: the long side facing this
   point, or the two round ends. The far side sends nothing here and is left out; a point of an end facing away
   counts 0. (Points of the middle line instead read 0.1213 where the bounces read 0.1326: kit/flatland.js sampleLamp.) */
export function lampPoint(L, x, y, u) {
    const seg = Math.hypot(L.b[0] - L.a[0], L.b[1] - L.a[1]), tx = (L.b[0] - L.a[0]) / seg, ty = (L.b[1] - L.a[1]) / seg
    const side = (x - L.a[0]) * -ty + (y - L.a[1]) * tx >= 0 ? 1 : -1      // which long side faces (x, y)
    const len = seg + 2 * Math.PI * L.r, d = u * len                      // that side, then the two round ends
    if (d < seg) { const mx = -ty * side, my = tx * side; return { x: L.a[0] + tx * d + mx * L.r, y: L.a[1] + ty * d + my * L.r, mx, my, len } }
    const phi = (d - seg) / L.r, mx = Math.cos(phi), my = Math.sin(phi)   // a round end: a's half faces back along the lamp
    const e = mx * tx + my * ty < 0 ? L.a : L.b
    return { x: e[0] + mx * L.r, y: e[1] + my * L.r, mx, my, len }
}
export function lampLight(shapes, x, y, nx, ny, albedo, rand) {
    const lamps = shapes.filter(s => s.emit), L = lamps[Math.min(lamps.length - 1, Math.floor(rand() * lamps.length))]
    if (!L) return 0
    const q = lampPoint(L, x, y, rand())                                 // the point drawn, and the outline's normal there
    const vx = q.x - x, vy = q.y - y, r = Math.hypot(vx, vy), ux = vx / r, uy = vy / r
    const cx = nx * ux + ny * uy, cy = -(q.mx * ux + q.my * uy)
    if (cx <= 0 || cy < 1e-6) return 0                                     // behind the surface, or a point facing away
    const hit = march(shapes, x, y, ux, uy, { far: r + 1 })
    if (!hit || shapes[hit.i] !== L) return 0                              // something else in the way: in shadow
    return (albedo / 2) * L.emit * cx * cy * q.len / r * lamps.length
}

/* 6. A PATH (chapters 8, 13, 14): from the eye, bounce off matte surfaces in cosine-weighted directions (so each bounce
   just multiplies by the albedo), aim at a lamp at every bounce but the last, and stop at the bounce limit or in the
   dark. A lamp the eye sees directly counts; one a bounce happens to hit counts only without NEE, or it would be
   counted twice. The last surface does not aim: the bounce from it is never traced, so its shadow ray would count light
   one bounce further than a path without NEE can reach. */
export function path(shapes, x, y, dx, dy, rand, { nee = true, bounces = 4 } = {}) {
    let light = 0, beta = 1, aimed = false
    for (let b = 0; b <= bounces; b++) {
        const hit = march(shapes, x, y, dx, dy)
        if (!hit) return light                                 // out into the dark
        const s = shapes[hit.i]
        if (s.emit) return aimed ? light : light + beta * s.emit
        let [nx, ny] = normal(s, hit.x, hit.y)
        if (nx * dx + ny * dy > 0) { nx = -nx; ny = -ny }       // the side the ray came from
        x = hit.x + nx * 4e-3; y = hit.y + ny * 4e-3            // just off the surface (chapter 30)
        if (s.mirror) {                                        // THE EXTENSION: a mirror, the ray reflected, no lamp aimed at
            const dn = dx * nx + dy * ny
            dx -= 2 * dn * nx; dy -= 2 * dn * ny; beta *= s.albedo; aimed = false
            continue
        }
        if (nee && b < bounces) light += beta * lampLight(shapes, x, y, nx, ny, s.albedo, rand)
        aimed = nee
        beta *= s.albedo
        const v = 2 * rand() - 1, c = Math.sqrt(1 - v * v)     // a cosine-weighted direction: sin of its angle evenly
        dx = nx * c - ny * v; dy = ny * c + nx * v
    }
    return light
}

/** A PICTURE: every pixel the average of `samples` paths, the random numbers from `rand` */
export function render(shapes, cam, samples, rand, opts) {
    const film = new Float64Array(cam.pixels)
    for (let i = 0; i < cam.pixels; i++) {
        let sum = 0
        for (let k = 0; k < samples; k++) { const [x, y, dx, dy] = camera(cam, i, rand()); sum += path(shapes, x, y, dx, dy, rand, opts) }
        film[i] = sum / samples
    }
    return film
}
