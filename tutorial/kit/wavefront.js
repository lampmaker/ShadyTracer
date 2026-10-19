//======================================================================================================================
// A WAVEFRONT IN THE FLAT WORLD -- chapter 22's figures run this: ShadyTracer's iteration (raytrace_main.js R.trace,
// wavefront.js) over the flat world's paths, so its queues, its drained tail and its flush can be counted without a
// GPU. Pure.
//
// One sample is every pixel's paths in flight together. Each ITERATION, as ShadyTracer's:
//   march     every ray in the queue takes up to `chunk` (32) sphere-tracing steps; one that reaches a surface,
//             leaves the scene or runs out of steps goes to shade this iteration, one still marching to the next
//             iteration's queue
//   occlude   the shadow rays shade queued in the iteration before are traced (their light counted if unblocked)
//   shade     a hit: its shadow ray towards the sun queued (not on the last pass, whose queue nothing would trace), a
//             new direction, and the next leg into the next iteration's queue; a path that left the scene, or used up
//             its bounces or its steps (maxIter, over the whole path), ends there with what it carries
//   flip      the queues' sides swap
// The budget is ShadyTracer's worst case, (maxBounce + 1) + ceil(maxIter / chunk), unless given. On the LAST pass a ray
// still marching is FLUSHED: it ends there with the light it carries (wavefront.js THE FLUSH); the rest of its path is
// never traced, as a bounce cap cuts one. A path shaded on the last pass is CUT: written for a march that never comes,
// it never ends, so it hands nothing in and is not counted (none at the worst-case budget). The shadow rays left
// queued are traced by extra rounds (the engine's shadow pairs).
//
// The light is the flat world's (kit/flatland.js tracePath): matte surfaces, the sun by shadow rays, the sky by paths
// that leave. A path's own radiance is what it found by hitting light, handed in when it ends (wavefront.js THE PATH
// IS OVER); a shadow ray adds its contribution when it is traced unblocked, to its path's pixel. RESOLVE divides a
// pixel's light by the paths that ended there (its count), and drops a pixel's words when none did.
//======================================================================================================================

import { rng, march, cameraRay, normalAt, cosineDir, inSun } from './flatland.js'

const FAR = 40

/** One sample of `spp` paths a pixel through `world` from `cam`, run as a wavefront. Returns the picture (`img`, a mean
 *  a pixel), the iterations' log, the budget and the worst case, and the march's lanes both ways: `wave` (each
 *  iteration's rays packed in groups of `width`, each group as long as its slowest ray's steps that iteration) and
 *  `mega` (each path one thread from start to end, groups of `width` paths). */
export function wavefrontRun(world, cam, { spp = 4, maxBounce = 10, maxIter = 400, chunk = 32, budget = 0, nee = true, seed = 1, width = 32, eps = 1e-3 } = {}) {
    const R = rng(seed), worst = Math.max(2, (maxBounce + 1) + Math.ceil(maxIter / chunk)), its = budget > 0 ? Math.max(2, budget | 0) : worst
    const img = new Float64Array(cam.pixels), H = {}, S = {}, paths = []
    let queue = [], shadows = []
    for (let s = 0; s < spp; s++) for (let p = 0; p < cam.pixels; p++) {
        const [ox, oy, dx, dy] = cameraRay(cam, p, R())
        const r = { pix: p, x: ox, y: oy, dx, dy, beta: 1, L: 0, S: 0, b: 0, steps: 0, legT: 0, aimed: false, legs: [0], shades: 0 }
        paths.push(r); queue.push(r)
    }
    const end = r => { r.done = true; r.ended = true }
    const iters = [], wave = { work: 0, occupied: 0, shadeGroups: 0, shaded: 0 }
    let flushed = 0
    for (let it = 0; it < its; it++) {
        const last = it === its - 1, next = [], queued = []
        const log = { marched: queue.length, hits: 0, escaped: 0, outOfSteps: 0, onward: 0, newLegs: 0, shadowsTraced: 0, shadowsQueued: 0, flushed: 0, ended: 0, capped: 0 }
        // THE MARCH, up to `chunk` steps a ray, its lanes in groups of `width`
        const stepsNow = [], toShade = []
        for (const r of queue) {
            const steps = [], cap = Math.max(1, Math.min(chunk, maxIter + 1 - r.steps))
            march(world, r.x, r.y, r.dx, r.dy, { eps, far: FAR - r.legT, max: cap, steps }, H)
            stepsNow.push(steps.length); r.steps += steps.length; r.legs[r.legs.length - 1] += steps.length
            if (H.hit) { toShade.push({ r, hit: true, x: H.x, y: H.y, i: H.i }); continue }
            r.legT += H.t; r.x = H.x; r.y = H.y
            if (r.legT > FAR) toShade.push({ r, hit: false })                       // left the scene
            else if (r.steps > maxIter) { log.outOfSteps++; toShade.push({ r, out: true }) }   // RAY_MAXITER: to shade, which ends it with what it has
            else if (last) { log.flushed++; flushed++; end(r); log.ended++ }         // THE FLUSH
            else { log.onward++; next.push(r) }
        }
        for (let g = 0; g < stepsNow.length; g += width) { const grp = stepsNow.slice(g, g + width); wave.work += grp.reduce((a, b) => a + b, 0); wave.occupied += width * Math.max(...grp) }
        log.steps = stepsNow
        // OCCLUSION: last iteration's shadow rays
        for (const sr of shadows) { log.shadowsTraced++; march(world, sr.x, sr.y, sr.lx, sr.ly, { eps, far: 60 }, S); if (!S.hit) sr.path.S += sr.c }
        // SHADE
        wave.shaded += toShade.length; wave.shadeGroups += Math.ceil(toShade.length / width); log.shading = toShade.length
        for (const h of toShade) {
            const r = h.r
            if (h.out) { end(r); log.ended++; continue }
            r.shades++
            if (!h.hit) {
                log.escaped++
                r.L += r.beta * (world.sky || 0)
                if (world.sun && inSun(world.sun, r.dx, r.dy) && !r.aimed) r.L += r.beta * world.sun.L
                end(r); log.ended++; continue
            }
            log.hits++
            const sh = world.shapes[h.i]
            if (sh.emit > 0) { if (!r.aimed) r.L += r.beta * sh.emit; end(r); log.ended++; continue }
            let [nx, ny] = normalAt(world, h.x, h.y, h.i)
            if (nx * r.dx + ny * r.dy > 0) { nx = -nx; ny = -ny }
            const px = h.x + nx * 4 * eps, py = h.y + ny * 4 * eps, rho = sh.albedo ?? 0.7
            r.aimed = false
            if (nee && world.sun && !last) {
                const sn = world.sun, a = sn.dir + (2 * R() - 1) * sn.half, lx = Math.cos(a), ly = Math.sin(a), c = nx * lx + ny * ly
                if (c > 0) { queued.push({ path: r, x: px, y: py, lx, ly, c: r.beta * rho * sn.L * c * sn.half }); log.shadowsQueued++ }
                r.aimed = true
            }
            r.beta *= rho
            if (r.b >= maxBounce) { end(r); log.ended++; log.capped++; continue }     // the bounce cap
            r.b++
            ;[r.dx, r.dy] = cosineDir(nx, ny, R()); r.x = px; r.y = py; r.legT = 0; r.legs.push(0)
            if (last) { r.done = true; r.cut = true; log.cut = (log.cut || 0) + 1; continue }   // shaded on the last pass: written for a march that never comes
            log.newLegs++; next.push(r)
        }
        iters.push(log)
        queue = next; shadows = queued
    }
    // the shadow rays left in the queue: the last pass's extra rounds trace them
    for (const sr of shadows) { march(world, sr.x, sr.y, sr.lx, sr.ly, { eps, far: 60 }, S); if (!S.hit) sr.path.S += sr.c }
    if (shadows.length) iters[iters.length - 1].shadowsTraced += shadows.length
    /* RESOLVE, as the engine's: a pixel's sample is what its camera path deposited, its own light at its end and its
       shadow rays' as they are traced, over the paths that ended (the count, n). A path cut on the last pass never ends,
       so it is not counted, and resolve takes the frame's words and drops them (n is 0 for a pixel whose one path was
       cut): the pixel's average leaves that sample out. Each of a pixel's `spp` paths here is one sample of its own. */
    const n = new Float64Array(cam.pixels)
    for (const r of paths) if (r.ended) { img[r.pix] += r.L + r.S; n[r.pix]++ }
    for (let p = 0; p < cam.pixels; p++) img[p] = n[p] ? img[p] / n[p] : 0
    // the same work as one thread a path
    const mega = { work: 0, occupied: 0 }
    for (let g = 0; g < paths.length; g += width) { const grp = paths.slice(g, g + width).map(r => r.steps); mega.work += grp.reduce((a, b) => a + b, 0); mega.occupied += width * Math.max(...grp) }
    return { img, counted: n, iters, budget: its, worst, flushed, wave, mega, paths }
}

/** THE SAME WORK, TIMED AS LANES, in units of one march step, a shading taking `shadeCost` of them (a model's number,
 *  not a measurement). As a wavefront: each iteration's march, groups of `width` as long as their slowest ray's steps,
 *  then its shading, groups of `width` hits each `shadeCost` long. As one big kernel, each path one lane from start to
 *  end, written the plain way, a loop over bounces: march to the next surface, shade it. A group then marches each leg
 *  as long as its slowest lane's leg, and shades whenever any lane has something to shade, lanes whose paths have
 *  ended idle to the last. Returns { busy, time } for both. */
export function laneTimes(run, width = 32, shadeCost = 20) {
    const wave = { busy: 0, time: 0 }
    for (const l of run.iters) {
        for (let g = 0; g < l.steps.length; g += width) { const grp = l.steps.slice(g, g + width); wave.busy += grp.reduce((a, b) => a + b, 0); wave.time += width * Math.max(...grp) }
        wave.busy += l.shading * shadeCost; wave.time += Math.ceil(l.shading / width) * width * shadeCost
    }
    const mega = { busy: 0, time: 0 }
    for (let g = 0; g < run.paths.length; g += width) {
        const grp = run.paths.slice(g, g + width), legs = Math.max(...grp.map(r => r.legs.length))
        for (let k = 0; k < legs; k++) {
            const steps = grp.map(r => r.legs[k] ?? 0), shading = grp.filter(r => k < r.shades).length
            mega.time += width * (Math.max(...steps) + (shading ? shadeCost : 0))
            mega.busy += steps.reduce((x, y) => x + y, 0) + shading * shadeCost
        }
    }
    return { wave, mega }
}
