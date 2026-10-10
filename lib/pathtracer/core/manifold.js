//======================================================================================================================
// THE MANIFOLD CONNECTION (0.44.0) -- a photon inside glass connected to the camera through the glass's face.
//
// WHY. The floor inside the user's prism, lit through the glass and seen through the glass, is
//     light -> glass -> D (a diffuse or glossy surface inside the glass) -> the glass's face -> eye.
// A pinhole could not see it at all, and 0.43.0's lens only by chance: a photon off D must happen to leave the glass
// towards the lens (core/lens.js), and the picture was noisy (the user, 2026-10-09: "picture is noisy; I'd like to try
// the manifold"). A photon's connection (ltConnect) is a straight line to the camera, which the face bends. This is
// that connection through ONE refraction: the point x on the face where light from D, bent by Snell, reaches the
// camera point y -- found by Newton's method on the face (Hanika et al. 2015, "Manifold next event estimation", for a
// chain of one vertex) -- every photon at D then lands on the picture, as ltConnect's do in air.
//
// THE SOLVE, from the camera's side: a direction w from y; the ray along it meets the face at x; refracted there into
// the glass (air to n, the photon's own index -- n(lambda) for a dispersive one) it meets D's tangent plane at p.
// Newton drives p to D over w's two angles, the Jacobian dp/dw by central differences. The scene is a distance field
// with no curvature to ask, so a trace off the current x is: the ray met with x's tangent plane, then one step along the
// ray onto the surface (q - w d / (g.w), d the distance and g its gradient by differences at q), the normal there g.
// That is exact for a flat face -- the prism's -- and to second order in the step for a curved one; the step is
// MANIFOLD_SPAN tolerances on the face, wide enough that the normal's f32 noise (PRECISION.md, up to 5 mrad at the
// floor) is a small part of the difference, narrow enough for a curved face's third-order error to be (measured on a
// dome in test/manifold.test.mjs). Converged, the path is checked whole: the march from y along w meets the face first,
// at x, and the march from x along the refracted ray meets D first. Anything else -- no convergence, total reflection,
// another surface in either leg, D facing away -- connects nothing.
//
// WHAT IT ADDS, as ltConnect's splat with the straight line's G replaced by the refraction's:
//     flux f  T / n^2  exp(-mu |x - D|)  G / A_px,       G = 1 / (cos^3(theta_y) |det dp/dw|)
// f the BSDF at D towards x (the evaluable lobes, as a connection's), T the face's Fresnel transmittance, n the glass's
// index, mu its absorption, theta_y the camera ray's angle off the axis. G is the density of the camera's rays at D
// per area -- for a straight line |n.v| / (dist^2 cos^3), ltConnect's -- now through the face: |det dp/dw| is the area
// at D a solid angle at y covers, and cos^3 turns the solid angle into the image plane's area, as lens.js says. 1/n^2:
// radiance leaving glass for air (the camera side's refraction weights leave it out, rightly for a path whose ends are
// both in air -- this connection's photon is a flux, and its end is the radiance the camera sees).
//
// WHICH PATHS IT OWNS: light -> delta+ -> D -> one refraction into air -> the camera (or a point of its lens). The camera
// leaves it those -- its first surface a refraction into the medium D is in, then D, then delta events to the light --
// and the lens's photons leave it the ones they would have counted (tracebasics.js TAG_LENS_ONE). A refraction with more
// than one solution (a curved face can show D twice) is found once: the other images are lost, the picture darker
// there (inferred, not measured). Not through a mirror, nor two faces (a ball's caustic seen through the ball): those
// stay the lens's.
//
// Pure functions, no GPU: this file is the JS mirror the WGSL (wavefront.js prog_surface, its MANIFOLD trips) is
// written from and test/manifold.test.mjs holds to the measurement.
//======================================================================================================================

/** The face's span for the differences, in tolerances (above). 30 first: on the GPU, in f32, a normal by differences
 *  carries a few tenths of a milliradian of rounding, and over 30 tolerances that moved a dome's Jacobian by up to 6 %
 *  against the f64 mirror (test/manifold.gpu.mjs, lavapipe); over 100 its share is a third of that, and a curved face's
 *  own error, (span / radius)^2 / 6, is 0.2 % for a radius a tenth of the scene (the tolerance is 1e-4 of it). */
export const MANIFOLD_SPAN = 100
/** The gradient's step, in tolerances. 1, the surface kernel's own normal step, first: in f32 the distance's rounding at
 *  a tenth of a metre from the origin is about 1e-8 m, half a milliradian of a normal over 2e-5 m, and the Jacobian's
 *  differences read it (test/manifold.gpu.mjs, lavapipe: 60 % off at a dome's rim). Over 8 tolerances that is an eighth,
 *  and the forward difference's own error, h / 2R on a face of radius R, is smooth -- the same at neighbouring points --
 *  so the differences take it out; at the answer it tilts the refraction by under a milliradian on that dome. */
export const MANIFOLD_GRAD = 8
/** How many times the span may be cut to a third where a perturbed ray falls off the face. */
export const MANIFOLD_NARROW = 2
/** Newton's iterations at most (a halving counts as one), and the step's largest angle: this share of the angle the
 *  glass leg subtends at y, |x - D| / |y - x| -- about the most refraction can move the answer. A fixed angle (0.2 rad)
 *  stepped off a 11 cm dome seen from 55 cm and lost the rim's photons (measured in test/manifold.test.mjs). */
export const MANIFOLD_ITERS = 24, MANIFOLD_MAXSTEP = 0.5
/** A trace's steps onto the surface at most: one near the answer, a few from a reference centimetres away. */
export const MANIFOLD_PROJECT = 6
/** Converged when p is this many tolerances from D. */
export const MANIFOLD_CONVERGE = 1
/** The checks' slack, in tolerances: the march's hit on the face within this of x, its hit inside within this of D. */
export const MANIFOLD_CHECK = 20

const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = a => scl(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1))
/** Two unit vectors square to n and to each other. */
export const basis = n => {
    const a = Math.abs(n[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0]
    const t = norm(cross(a, n))
    return [t, cross(n, t)]
}
/** Snell: w arriving (unit) at a face of normal n (facing w's side), eta = n_from / n_to; null in total reflection. */
export const refract = (w, n, eta) => {
    const c = -dot(w, n), k = 1 - eta * eta * (1 - c * c)
    return k < 0 ? null : norm(add(scl(w, eta), n, eta * c - Math.sqrt(k)))
}
/** Unpolarised Fresnel reflectance, cosI on the incident side, eta = n_i / n_t (optics/fresnel.js's formula). */
export const fresnelR = (cosI, eta) => {
    const c = Math.min(Math.max(cosI, 0), 1), s2 = eta * eta * (1 - c * c)
    if (s2 >= 1) return 1
    const ct = Math.sqrt(1 - s2), rs = (eta * c - ct) / (eta * c + ct), rp = (c - eta * ct) / (c + eta * ct)
    return 0.5 * (rs * rs + rp * rp)
}

/**
 * The connection from D, inside a medium of index nMed, to the camera point y in air, through one face.
 * @param D, nD   the photon's point and its surface's normal, turned to the side the photon came from
 * @param y       the camera's point (camPos, or a point of the lens)
 * @param sdf     the scene's signed distance at a point (positive outside a solid)
 * @param tol     the surface tolerance there (the march's hit test, the normal's step)
 * @returns null, or { w (from y), x, nx (the face's normal there), toX (from D), T, dist (|x - D|), detJ, iters }
 */
export function manifoldSolve({ D, nD, nMed, y, sdf, tol }) {
    const h = MANIFOLD_GRAD * tol
    const grad = q => {
        const d = sdf(q)
        return { d, g: norm([sdf(add(q, [h, 0, 0])) - d, sdf(add(q, [0, h, 0])) - d, sdf(add(q, [0, 0, h])) - d]) }
    }
    const march = (o, w, tmax) => {                     // the first hit along o + t w, or null before tmax
        let t = 0
        for (let k = 0; k < 2000 && t < tmax; k++) {
            const d = Math.abs(sdf(add(o, w, t)))
            if (d < tol) return { p: add(o, w, t), t }
            t += d
        }
        return null
    }
    const toD = Math.hypot(...sub(D, y))
    let w = norm(sub(D, y))
    const first = march(y, w, toD)
    if (!first) return null
    let x = first.p, n = grad(x).g
    if (dot(n, w) >= 0) return null                     // the first thing met from y is not a glass's outside
    const [s1, s2] = basis(nD)
    /* one trace off the face at (x, n): to its tangent plane, one step along the ray onto the surface, refracted there
       into the glass, to D's tangent plane */
    const trace = wt => {
        const den = dot(wt, n)
        if (den >= 0) return null
        /* ONTO THE SURFACE ALONG THE RAY, Newton's steps q - w d / (g.w), until within a tenth of a tolerance -- and the
           normal THERE: the gradient anywhere else is the normal where that point's own perpendicular meets the
           surface, not where the ray does. On a 11 cm dome, from a reference a few centimetres away, two steps left
           the normal 3 mrad off; the trace then depended on where it started and Newton stalled (measured). */
        let q1 = add(y, wt, dot(sub(x, y), n) / den), gq = null
        for (let k = 0; k < MANIFOLD_PROJECT; k++) {
            gq = grad(q1)
            const hn = dot(gq.g, wt)
            /* THE GLASS'S OWN SIDE, never turned: a point whose outward normal faces away from the camera is the far
               side of the glass, which y cannot see -- turned to face it, Newton wandered there round a dome (measured) */
            if (hn > -1e-6) return null
            if (Math.abs(gq.d) < 0.1 * tol) break
            q1 = sub(q1, scl(wt, gq.d / hn))
            if (k === MANIFOLD_PROJECT - 1) return null
        }
        const nn = gq.g
        const t = refract(wt, nn, 1 / nMed)
        if (!t) return null
        const dn = dot(t, nD)
        if (dn >= 0) return null                        // going away from D's plane
        const s = dot(sub(D, q1), nD) / dn
        if (!(s > 0)) return null
        return { p: add(q1, t, s), q: q1, n: nn, t }
    }
    /* A DAMPED NEWTON WITH BACKTRACKING: a step whose trace fails, or lands farther from D than the last, is halved
       from the last good point instead (its direction, face point and residual kept in `good`) */
    let good = null
    for (let it = 0; it < MANIFOLD_ITERS; it++) {
        const c = trace(w)
        const r0 = c && [dot(sub(c.p, D), s1), dot(sub(c.p, D), s2)]
        if (!c || (good && Math.hypot(r0[0], r0[1]) >= good.res)) {
            if (!good) return null
            good.step = good.step.map(v => v * 0.5)
            w = norm(add(add(good.w, good.t1, good.step[0]), good.t2, good.step[1]))
            x = good.x; n = good.n
            continue
        }
        const [t1, t2] = basis(w)
        /* THE DIFFERENCES, over MANIFOLD_SPAN -- or, where a perturbed ray falls off the face (a dome's rim), over a
           third of it, then a third again (MANIFOLD_NARROW times at most): the wide span's rounding is the GPU's
           reason, and it is no reason to lose a path the narrow one can take */
        let delta = MANIFOLD_SPAN * tol / Math.hypot(...sub(c.q, y)), j1 = null, j2 = null
        const col = k => {
            const a = trace(norm(add(w, k, delta))), b = trace(norm(add(w, k, -delta)))
            if (!a || !b) return null
            const dp = sub(a.p, b.p)
            return [dot(dp, s1) / (2 * delta), dot(dp, s2) / (2 * delta)]
        }
        for (let narrow = 0; narrow <= MANIFOLD_NARROW; narrow++, delta /= 3) {
            j1 = col(t1); j2 = col(t2)
            if (j1 && j2) break
        }
        if (!j1 || !j2) return null
        const r = r0
        const det = j1[0] * j2[1] - j2[0] * j1[1]
        if (!(Math.abs(det) > 0)) return null
        if (Math.hypot(r[0], r[1]) < MANIFOLD_CONVERGE * tol) {
            // THE CHECKS: nothing before the face from y, nothing between the face and D
            const hit = march(y, w, Math.hypot(...sub(c.q, y)) + MANIFOLD_CHECK * tol)
            if (!hit || Math.hypot(...sub(hit.p, c.q)) > MANIFOLD_CHECK * tol) return null
            const dist = Math.hypot(...sub(D, c.q))
            const off = MANIFOLD_CHECK * tol
            const back = march(add(c.q, c.t, off), c.t, dist + off)
            if (!back || Math.hypot(...sub(back.p, D)) > MANIFOLD_CHECK * tol) return null
            const toX = norm(sub(c.q, D))
            if (dot(toX, nD) <= 0) return null
            return { w, x: c.q, nx: c.n, toX, T: 1 - fresnelR(-dot(w, c.n), 1 / nMed), dist, detJ: Math.abs(det), iters: it }
        }
        // the Newton step, damped: J [da db] = -r
        let da = -(r[0] * j2[1] - j2[0] * r[1]) / det, db = -(j1[0] * r[1] - r[0] * j1[1]) / det
        const big = Math.hypot(da, db), most = MANIFOLD_MAXSTEP * Math.hypot(...sub(c.q, D)) / Math.hypot(...sub(c.q, y))
        if (big > most) { da *= most / big; db *= most / big }
        good = { w, t1, t2, x: c.q, n: c.n, res: Math.hypot(r[0], r[1]), step: [da, db] }
        w = norm(add(add(w, t1, da), t2, db))
        x = c.q; n = c.n
    }
    return null
}

/** The connection's weight but for f and the absorption: T / n^2 / (cos^3(theta_y) |det J| A_px). */
export const manifoldWeight = (sol, nMed, cosY, apx) => sol.T / (nMed * nMed) / (cosY * cosY * cosY * sol.detJ * apx)

/* THE SAME SOLVE IN WGSL, as a walk the surface kernel steps one look at a time (wavefront.js prog_surface: every call of
   the scene is a whole copy of it once inlined, and a kernel's compile time is its inlined size, so the kernel keeps its
   ONE look and this asks it, trip by trip, where to look: mfLook, then mfTake with the distance there). Every step above
   is here in that order: the march from y, the face's normal, Newton's centre trace and its four differences, the
   halving, the two checks. Its tolerance is one number, marchTol at D, as manifoldSolve's `tol`. The walk ends in MF_OK
   or MF_FAIL; MF_TRIPS bounds it, so a thread that never converges costs a known most.
   NO FUNCTION CALLS BACK: WGSL refuses any cycle in the call graph, and a trace that fails at once would have called
   back into the iteration that started it. So each step only names the next phase, and mfAdvance runs the phases that
   need no look until one does. No one-letter capital for a name: the page's shorthands make F, V, W, X, I and U types
   (lib/wgsl_shorthand.js). */
export const MANIFOLD_TRIPS = 2048, MANIFOLD_MARCH = 512
export const MANIFOLD_WGSL = /*wgsl*/`
const MF_SPAN: f32 = ${MANIFOLD_SPAN}.0;
const MF_ITERS: u32 = ${MANIFOLD_ITERS}u;
const MF_MAXSTEP: f32 = ${MANIFOLD_MAXSTEP};
const MF_PROJECT: u32 = ${MANIFOLD_PROJECT}u;
const MF_NARROW: u32 = ${MANIFOLD_NARROW}u;
const MF_GRAD_STEP: f32 = ${MANIFOLD_GRAD}.0;
const MF_CONVERGE: f32 = ${MANIFOLD_CONVERGE}.0;
const MF_CHECK: f32 = ${MANIFOLD_CHECK}.0;
const MF_MARCH_STEPS: u32 = ${MANIFOLD_MARCH}u;
const MF_TRIPS: u32 = ${MANIFOLD_TRIPS}u;
// the walk's phases: those that look at the scene...
const MF_MARCH0: u32 = 1u;      // from y towards D, to the face
const MF_GRAD: u32 = 2u;        // a gradient's four looks (the distance, then three differences)
const MF_MARCHY: u32 = 3u;      // the check from y: the face first
const MF_MARCHIN: u32 = 4u;     // the check inside: D first
// ...those that only think (mfAdvance)...
const MF_X0DONE: u32 = 5u;      // the face's normal where the march met it
const MF_STARTITER: u32 = 6u;   // a Newton iteration: its centre trace
const MF_STARTTRACE: u32 = 7u;  // a trace along MF.wt
const MF_PROJDONE: u32 = 8u;    // a trace's gradient taken: onto the surface, or done
const MF_TRACEDONE: u32 = 9u;   // a trace's answer (MF.tdOk, MF.q, MF.tdN)
// ...and the two ends
const MF_FAIL: u32 = 14u;
const MF_OK: u32 = 15u;
const MF_FOR_X0: u32 = 0u;      // what a gradient is for
const MF_FOR_TRACE: u32 = 1u;
struct MfWalk {
    phase: u32, trips: u32,
    y: vec3<f32>, d: vec3<f32>, nd: vec3<f32>, s1: vec3<f32>, s2: vec3<f32>, nmed: f32, tol: f32,
    w: vec3<f32>, x: vec3<f32>, xn: vec3<f32>, t1: vec3<f32>, t2: vec3<f32>, it: u32, delta: f32,
    hasGood: bool, gw: vec3<f32>, gt1: vec3<f32>, gt2: vec3<f32>, gx: vec3<f32>, gxn: vec3<f32>, gres: f32, gstep: vec2<f32>,
    tk: u32, wt: vec3<f32>, q: vec3<f32>, pk: u32, tdOk: bool, tdN: vec3<f32>, narrow: u32,
    gfor: u32, gp: vec3<f32>, gi: u32, gd: f32, gv: vec3<f32>,
    cq: vec3<f32>, cn: vec3<f32>, ct: vec3<f32>, cres: vec2<f32>, pp: array<vec2<f32>, 4>,
    mo: vec3<f32>, md: vec3<f32>, mt: f32, mtmax: f32, msteps: u32,
    detj: f32, toX: vec3<f32>, tr: f32, dist: f32,
}
var<private> MF: MfWalk;

fn mfRefract(w: vec3<f32>, n: vec3<f32>, eta: f32) -> vec4<f32> {
    let c = -dot(w, n);
    let k = 1.0 - eta * eta * (1.0 - c * c);
    if (k < 0.0) { return vec4<f32>(0.0); }
    return vec4<f32>(normalize(w * eta + n * (eta * c - sqrt(k))), 1.0);
}
fn mfFresnelR(cosI: f32, eta: f32) -> f32 {
    let c = clamp(cosI, 0.0, 1.0);
    let s2 = eta * eta * (1.0 - c * c);
    if (s2 >= 1.0) { return 1.0; }
    let ct = sqrt(1.0 - s2);
    let rs = (eta * c - ct) / (eta * c + ct);
    let rp = (c - eta * ct) / (c + eta * ct);
    return 0.5 * (rs * rs + rp * rp);
}
// one of two unit vectors square to n and to each other, the other cross(n, it) (manifold.js basis)
fn mfBasisA(n: vec3<f32>) -> vec3<f32> {
    let a = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), abs(n.x) > 0.9);
    return normalize(cross(a, n));
}
// the perturbed directions of the differences, in order: +t1, -t1, +t2, -t2
fn mfPerturbed(k: u32) -> vec3<f32> {
    let t = select(MF.t2, MF.t1, k <= 2u);
    let s = select(-1.0, 1.0, k == 1u || k == 3u);
    return normalize(MF.w + t * (s * MF.delta));
}

/* THE WALK BEGUN: D and its normal turned to the photon's side, the medium's index, the camera's point */
fn mfBegin(y: vec3<f32>, d: vec3<f32>, nd: vec3<f32>, nmed: f32, tol: f32) {
    MF.phase = MF_MARCH0; MF.trips = 0u;
    MF.y = y; MF.d = d; MF.nd = nd; MF.nmed = nmed; MF.tol = tol;
    MF.s1 = mfBasisA(nd); MF.s2 = cross(nd, MF.s1);
    MF.w = normalize(d - y);
    MF.mo = y; MF.md = MF.w; MF.mt = 0.0; MF.mtmax = length(d - y); MF.msteps = 0u;
}

/* WHERE THIS TRIP LOOKS: xyz, and w 1 to look (0: nothing to look at) */
fn mfLook() -> vec4<f32> {
    if (MF.phase == MF_MARCH0 || MF.phase == MF_MARCHY || MF.phase == MF_MARCHIN) { return vec4<f32>(MF.mo + MF.md * MF.mt, 1.0); }
    if (MF.phase == MF_GRAD) {
        let e = vec3<f32>(f32(MF.gi == 1u), f32(MF.gi == 2u), f32(MF.gi == 3u));
        return vec4<f32>(MF.gp + e * (MF_GRAD_STEP * MF.tol), 1.0);
    }
    return vec4<f32>(0.0);
}

/* THE PHASES THAT ONLY THINK, run until one looks or the walk ends */
fn mfAdvance() {
    for (var k = 0u; k < 32u; k++) {
        let ph = MF.phase;
        if (ph == MF_X0DONE) {
            MF.xn = normalize(MF.gv);
            // the first thing met from y must be a glass's outside
            if (dot(MF.xn, MF.w) >= 0.0) { MF.phase = MF_FAIL; return; }
            MF.it = 0u; MF.hasGood = false;
            MF.phase = MF_STARTITER;
        } else if (ph == MF_STARTITER) {
            if (MF.it >= MF_ITERS) { MF.phase = MF_FAIL; return; }
            MF.tk = 0u; MF.wt = MF.w;
            MF.phase = MF_STARTTRACE;
        } else if (ph == MF_STARTTRACE) {
            let den = dot(MF.wt, MF.xn);
            if (den >= 0.0) { MF.tdOk = false; MF.phase = MF_TRACEDONE; continue; }
            MF.q = MF.y + MF.wt * (dot(MF.x - MF.y, MF.xn) / den);
            MF.pk = 0u;
            MF.gp = MF.q; MF.gi = 0u; MF.gfor = MF_FOR_TRACE; MF.phase = MF_GRAD;
            return;
        } else if (ph == MF_PROJDONE) {
            // A TRACE'S STEP ONTO THE SURFACE ALONG THE RAY, the normal taken there (manifoldSolve's trace)
            let g = normalize(MF.gv);
            let hn = dot(g, MF.wt);
            if (hn > -1e-6) { MF.tdOk = false; MF.phase = MF_TRACEDONE; continue; }    // the glass's far side, or grazing
            if (abs(MF.gd) < 0.1 * MF.tol) { MF.tdOk = true; MF.tdN = g; MF.phase = MF_TRACEDONE; continue; }
            MF.q = MF.q - MF.wt * (MF.gd / hn);
            MF.pk = MF.pk + 1u;
            if (MF.pk >= MF_PROJECT) { MF.tdOk = false; MF.phase = MF_TRACEDONE; continue; }
            MF.gp = MF.q; MF.gi = 0u; MF.gfor = MF_FOR_TRACE; MF.phase = MF_GRAD;
            return;
        } else if (ph == MF_TRACEDONE) {
            var ok = MF.tdOk;
            var p = vec3<f32>(0.0);
            var t = vec3<f32>(0.0);
            if (ok) {
                let rf = mfRefract(MF.wt, MF.tdN, 1.0 / MF.nmed);
                t = rf.xyz;
                let dn = dot(t, MF.nd);
                ok = rf.w > 0.5 && dn < 0.0;
                if (ok) {
                    let s = dot(MF.d - MF.q, MF.nd) / dn;
                    ok = s > 0.0;
                    p = MF.q + t * s;
                }
            }
            if (MF.tk == 0u) {
                let r0 = vec2<f32>(dot(p - MF.d, MF.s1), dot(p - MF.d, MF.s2));
                // A DAMPED NEWTON WITH BACKTRACKING: a failed trace, or one farther from D, halves the last step
                if (!ok || (MF.hasGood && length(r0) >= MF.gres)) {
                    if (!MF.hasGood) { MF.phase = MF_FAIL; return; }
                    MF.gstep = MF.gstep * 0.5;
                    MF.w = normalize(MF.gw + MF.gt1 * MF.gstep.x + MF.gt2 * MF.gstep.y);
                    MF.x = MF.gx; MF.xn = MF.gxn;
                    MF.it = MF.it + 1u;
                    MF.phase = MF_STARTITER;
                    continue;
                }
                MF.cq = MF.q; MF.cn = MF.tdN; MF.ct = t; MF.cres = r0;
                MF.t1 = mfBasisA(MF.w); MF.t2 = cross(MF.w, MF.t1);
                MF.delta = MF_SPAN * MF.tol / length(MF.q - MF.y);
                MF.narrow = 0u;
                MF.tk = 1u; MF.wt = mfPerturbed(1u);
                MF.phase = MF_STARTTRACE;
                continue;
            }
            if (!ok) {
                // a perturbed ray off the face: the span cut to a third, the four again (manifoldSolve's NARROW)
                if (MF.narrow >= MF_NARROW) { MF.phase = MF_FAIL; return; }
                MF.narrow = MF.narrow + 1u;
                MF.delta = MF.delta / 3.0;
                MF.tk = 1u; MF.wt = mfPerturbed(1u);
                MF.phase = MF_STARTTRACE;
                continue;
            }
            MF.pp[MF.tk - 1u] = vec2<f32>(dot(p, MF.s1), dot(p, MF.s2));
            MF.tk = MF.tk + 1u;
            if (MF.tk <= 4u) { MF.wt = mfPerturbed(MF.tk); MF.phase = MF_STARTTRACE; continue; }
            let j1 = (MF.pp[0] - MF.pp[1]) / (2.0 * MF.delta);
            let j2 = (MF.pp[2] - MF.pp[3]) / (2.0 * MF.delta);
            let r = MF.cres;
            let det = j1.x * j2.y - j2.x * j1.y;
            if (!(abs(det) > 0.0)) { MF.phase = MF_FAIL; return; }
            if (length(r) < MF_CONVERGE * MF.tol) {
                // THE CHECKS: nothing before the face from y, nothing between the face and D
                MF.detj = abs(det);
                MF.mo = MF.y; MF.md = MF.w; MF.mt = 0.0; MF.mtmax = length(MF.cq - MF.y) + MF_CHECK * MF.tol; MF.msteps = 0u;
                MF.phase = MF_MARCHY;
                return;
            }
            var da = -(r.x * j2.y - j2.x * r.y) / det;
            var db = -(j1.x * r.y - r.x * j1.y) / det;
            let big = length(vec2<f32>(da, db));
            let most = MF_MAXSTEP * length(MF.cq - MF.d) / length(MF.cq - MF.y);
            if (big > most) { da = da * most / big; db = db * most / big; }
            MF.hasGood = true;
            MF.gw = MF.w; MF.gt1 = MF.t1; MF.gt2 = MF.t2; MF.gx = MF.cq; MF.gxn = MF.cn; MF.gres = length(r);
            MF.gstep = vec2<f32>(da, db);
            MF.w = normalize(MF.w + MF.t1 * da + MF.t2 * db);
            MF.x = MF.cq; MF.xn = MF.cn;
            MF.it = MF.it + 1u;
            MF.phase = MF_STARTITER;
        } else {
            return;                     // a phase that looks, or the end
        }
    }
    MF.phase = MF_FAIL;                 // thinking without end: never, but bounded
}

/* WHAT THIS TRIP'S LOOK FOUND: the scene's distance there (looked: whether mfLook asked for it) */
fn mfTake(dist: f32, looked: bool) {
    MF.trips = MF.trips + 1u;
    if (MF.trips > MF_TRIPS) { MF.phase = MF_FAIL; return; }
    if (looked) {
        if (MF.phase == MF_GRAD) {
            if (MF.gi == 0u) { MF.gd = dist; } else { MF.gv[MF.gi - 1u] = dist - MF.gd; }
            MF.gi = MF.gi + 1u;
            if (MF.gi == 4u) { MF.phase = select(MF_PROJDONE, MF_X0DONE, MF.gfor == MF_FOR_X0); }
        } else {
            // a march's step (MF_MARCH0, MF_MARCHY, MF_MARCHIN): one tolerance from a surface is a hit
            let p = MF.mo + MF.md * MF.mt;
            let ad = abs(dist);
            if (ad < MF.tol) {
                if (MF.phase == MF_MARCH0) {
                    MF.x = p; MF.gp = p; MF.gi = 0u; MF.gfor = MF_FOR_X0; MF.phase = MF_GRAD;
                } else if (MF.phase == MF_MARCHY) {
                    if (length(p - MF.cq) > MF_CHECK * MF.tol) { MF.phase = MF_FAIL; return; }
                    MF.dist = length(MF.d - MF.cq);
                    MF.mo = MF.cq + MF.ct * (MF_CHECK * MF.tol); MF.md = MF.ct; MF.mt = 0.0;
                    MF.mtmax = MF.dist + MF_CHECK * MF.tol; MF.msteps = 0u;
                    MF.phase = MF_MARCHIN;
                } else {
                    if (length(p - MF.d) > MF_CHECK * MF.tol) { MF.phase = MF_FAIL; return; }
                    MF.toX = normalize(MF.cq - MF.d);
                    if (dot(MF.toX, MF.nd) <= 0.0) { MF.phase = MF_FAIL; return; }
                    MF.tr = 1.0 - mfFresnelR(-dot(MF.w, MF.cn), 1.0 / MF.nmed);
                    MF.phase = MF_OK;
                }
                return;
            }
            MF.mt = MF.mt + ad;
            MF.msteps = MF.msteps + 1u;
            if (MF.mt > MF.mtmax || MF.msteps > MF_MARCH_STEPS) { MF.phase = MF_FAIL; return; }
        }
    }
    mfAdvance();
}

/* THE CONNECTION'S ANSWER, as the surface kernel hands it to shade beside the hit (scene_api.js Surface.mf): x the
   pixel, y the weight but for f and the absorption -- T / n^2 / (cos^3 |det J| A_px), bits of an f32, 0 none -- z the
   direction from D towards the face (mfOct's pair, two 16-bit numbers), w the length in the glass (bits of an f32).
   off is the camera point's offset from camPos (a point of the lens, or none). */
fn mfAnswer(off: vec3<f32>) -> vec4<u32> {
    if (MF.phase != MF_OK) { return vec4<u32>(0u); }
    let right = UB.invView[0].xyz;
    let up    = UB.invView[1].xyz;
    let fwd   = UB.invView[2].xyz;
    let fx = UB.invProjection[0][0];
    let fy = UB.invProjection[1][1];
    let cosY = -dot(MF.w, fwd);
    if (cosY <= 0.0) { return vec4<u32>(0u); }
    let im = lensImage(off, MF.w, right, up, fwd, fx, fy, max(UB.camLens.y, 1e-6));
    if (abs(im.x) >= 1.0 || abs(im.y) >= 1.0) { return vec4<u32>(0u); }
    let fres = vec2<f32>(UB.res);
    let apx = 4.0 * fx * fy / (fres.x * fres.y);
    let wgt = MF.tr / (MF.nmed * MF.nmed) / (cosY * cosY * cosY * MF.detj * apx);
    if (!(wgt > 0.0)) { return vec4<u32>(0u); }
    let p = vec2<u32>(clamp((im.xy + vec2<f32>(1.0)) * 0.5 * fres, vec2<f32>(0.0), fres - vec2<f32>(1.0)));
    return vec4<u32>(p.x + p.y * UB.res.x, bitcast<u32>(wgt), pack2x16snorm(mfOct(MF.toX)), bitcast<u32>(MF.dist));
}
`

/* WHAT BOTH KERNELS ASK, so the one that solves (prog_surface) and the one that connects (shade) agree on which photons:
   the full renderer, the photographic or luminance view, a perspective camera, the setting on -- manifoldSplit, which
   the camera's side of the split reads too (materials_pbr.js lensOwned); and a photon of the picture (the sun's, an
   emitter's, a light's -- never the Optics page's own rays, nor a probe) that has passed a delta event and nothing else
   (TAG_PASSED, its lens field 0), inside a medium, within the bounce cap: manifoldPhoton, of the hit as pathFacing left
   it. The connection is made only off the last pass (manifoldOn), as ltConnect's. */
export const MANIFOLD_SHARED_WGSL = /*wgsl*/`
fn manifoldSplit() -> bool {
    return UB.manifold != 0u && UB.camtype == 0u && UB.measureMode != 1u && UB.renderMode == 0u;
}
fn manifoldOn() -> bool { return manifoldSplit() && UB.lastpass == 0u; }
fn manifoldPhoton(r: Ray) -> bool {
    let picture = (r.tag & TAG_OPTIC) == 0u || (r.tag & TAG_LTALL) != 0u;
    return (r.tag & TAG_PHOTON) != 0u && (r.tag & TAG_PROBE) == 0u && picture && (r.tag & TAG_PASSED) != 0u
        && ((r.tag >> LENS_PH_SHIFT) & 3u) == 0u && r.n > 1.001 && r.bounces <= UB.maxbounce;
}
// the octahedral pair the answer's direction travels in (scene_api.js Surface.mf)
fn mfOct(v: vec3<f32>) -> vec2<f32> {
    let a = v / (abs(v.x) + abs(v.y) + abs(v.z));
    if (a.z >= 0.0) { return a.xy; }
    return (vec2<f32>(1.0) - abs(a.yx)) * select(vec2<f32>(-1.0), vec2<f32>(1.0), a.xy >= vec2<f32>(0.0));
}
fn mfUnoct(e: vec2<f32>) -> vec3<f32> {
    var v = vec3<f32>(e, 1.0 - abs(e.x) - abs(e.y));
    if (v.z < 0.0) { v = vec3<f32>((vec2<f32>(1.0) - abs(v.yx)) * select(vec2<f32>(-1.0), vec2<f32>(1.0), v.xy >= vec2<f32>(0.0)), v.z); }
    return normalize(v);
}
`
