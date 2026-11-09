//======================================================================================================================
// DUST IN THE AIR (0.62.0): one box of haze, a homogeneous participating medium in the air inside it.
//
// WHY. The user (2026-10-16): "dust particles in the air. Should be realistic and a way to visualise rays ... it could be
// inside a certain box only, so it does not add scattering in transparent materials". Decided with them: a haze box node
// in the builder (builder/hazebox.js), physical units, the full renderer first. roadmap/MEDIA.md has the phases after it.
//
// WHAT IT IS. Grey extinction sigma_t = 1 / mfp (the mean free path, real metres), an albedo per channel (sigma_s =
// albedo sigma_t), and the Henyey-Greenstein phase function of asymmetry g. Only AIR inside the box scatters: a ray whose
// medium has an index other than 1 never sees it, so glass and water inside the box stay clear -- the user's condition.
//
// HOW IT FITS THIS ENGINE: THE USER'S OWN SKETCH. "If a ray has moved XX, random chance it met a particle; if so move back
// some random YY distance and scatter." That is free-flight sampling, exactly: on a leg whose overlap with the box is
// [t0, t1], t = t0 - ln(1 - u) / sigma_t, a collision iff t < t1 (probability 1 - exp(-sigma_t (t1 - t0))). Weighed by
// the albedo when it collides and by 1 when it does not (its probability IS the transmittance), it is exact. THE MARCH
// DECIDES (0.62.2), with the distance drawn as the leg starts: a path ray's tmax was free (a shadow ray's and a probe's
// field), so it carries the ltot at which the leg meets a particle (hazeDraw), and the march stops the ray there, moved
// back along its last step and given the state RAY_SCATTER (hazeAt). A surface met first ends the leg as it would have.
// (0.62.0 decided after the march, in the surface kernel, from the leg made again from where it ended -- which lost
// paths: hazeDraw says why.) The photon map's kernel takes only RAY_ACTIVE rays, so a photon that collided is never
// stored at a surface it did not reach, nor does a camera ray gather there. Shade then makes the point a vertex
// (mediumVertex): the phase function where a surface has its BSDF.
//
// FROM A MEDIUM VERTEX, as from a surface (README, How light gets found):
//   - a PHOTON connects to the camera (ltConnectMedium): the user's "scatter towards the camera" is light tracing's
//     connection, through the phase function. What a lamp behind a lens shows in dust -- its beam -- is that.
//   - a CAMERA PATH samples a light (mediumNee: a face, an emitter, the environment) and weighs it by the power heuristic
//     against the phase function's own draw, as a surface does against its BSDF.
//   - every SHADOW RAY and connection is dimmed by the haze it crosses (hazeShadow, in shade, over the true segment from
//     the vertex; an emitter ray's in prog_occlude, where its length is known).
//
// THE SPLITS. A medium vertex is EVALUABLE (EV_EVAL) to every rule that classifies by the first scatter: the lights' split
// (CLS_LIGHTS: a camera path whose first vertex is one leaves the light's face to the photons, which connect from there
// with weight 1; its ltMis is 0, so the face's direct-path share (codegen LIGHTS) does not apply), the sun's (CLS_CAND,
// TAG_PASSED). It is NOT the photon map's D (lensStep with EV_OTHER): the map stores no photons in the air yet, so a camera
// path that handed what it reaches past a medium vertex to the map would lose it. Both fields go out instead, and the
// camera keeps that light. A volume photon map is the next phase (roadmap/MEDIA.md).
//
// WHERE IT IS OFF. Sketch and the Optics view (renderMode 2, 3): density 0 (hazeUniforms). The illuminance view: the
// camera's first leg does not collide and its photons' connections are not dimmed -- the camera there is a pointer at a
// surface, not an eye in the dust -- but light reaching that surface is. The Optics page's trace (optics/kernels.js) has
// a chain of its own and does not see the haze yet: its run bar says so.
//
// THE KERNELS' TEXT WITHOUT A HAZE BOX is the text it was (wavefront.js pastes this only for a scene that has one:
// raytrace_main.js wavefrontKernels); the uniforms below are declared for every kernel (DERIVED), as the step cache's
// grid and the photon map's are.
//
// SCALE, said plainly (inferred, the arithmetic is the help's): a 1 cm beam seen side on in dust with mfp 10 m and g 0.7
// reads about 7e-5 of the white floor it lights; dust dense enough to show it at that size dims it over 25 cm. Physical
// dust shows beams at room scale, looking into the light, or against a dark surround.
//======================================================================================================================

/** THE ASYMMETRY'S LIMIT: Henyey-Greenstein at |g| -> 1 is a delta, which light sampling cannot weigh (README: NEE cannot
 *  apply to a delta lobe); 0.95 keeps the phase function a lobe NEE and its MIS can both handle. */
import { SPPM_STORE_WGSL } from './sppm.js'

export const HAZE_G_MAX = 0.95

/** THE UNIFORMS (uniforms.schema.js DERIVED; photometry.js derive), in metres, from the scene's haze record (builder
 *  codegen: scene.haze, in the scene's unit but for the mean free path, real metres) and the unit's metres:
 *    hazeC  centre, sigma_t (1 / m; 0: off)          hazeU, hazeV, hazeW  the box's unit axes, half-sizes (m)
 *    hazeA  albedo per channel, g
 *  Off (density 0) with no haze, or in Sketch and the Optics view (renderMode 2, 3). */
export function hazeUniforms(haze, metresPerUnit = 1, renderMode = 0) {
    const off = { hazeC: [0, 0, 0, 0], hazeU: [1, 0, 0, 0], hazeV: [0, 1, 0, 0], hazeW: [0, 0, 1, 0], hazeA: [1, 1, 1, 0] }
    const mode = renderMode | 0
    // ...and while the box is hidden (`on` false: kept by live visibility or the scene as data, builder/hazebox.js)
    if (!haze || haze.on === false || mode === 2 || mode === 3 || !(haze.mfp > 0) || !Number.isFinite(haze.mfp)) return off
    const s = +metresPerUnit || 1
    const c = haze.centre ?? [0, 0, 0], ax = haze.axes ?? [[1, 0, 0], [0, 1, 0], [0, 0, 1]], h = haze.half ?? [0, 0, 0]
    const a = haze.albedo ?? [1, 1, 1]
    const clamp01 = v => Math.min(1, Math.max(0, +v || 0))
    return {
        hazeC: [c[0] * s, c[1] * s, c[2] * s, 1 / haze.mfp],
        hazeU: [...ax[0].slice(0, 3), Math.max(0, h[0] * s)],
        hazeV: [...ax[1].slice(0, 3), Math.max(0, h[1] * s)],
        hazeW: [...ax[2].slice(0, 3), Math.max(0, h[2] * s)],
        hazeA: [clamp01(a[0]), clamp01(a[1]), clamp01(a[2]), Math.min(HAZE_G_MAX, Math.max(-HAZE_G_MAX, +haze.g || 0))],
    }
}

/*----------------------------------------------------------------------------------------------------------------------
  JS MIRRORS (test/haze.test.mjs), the same arithmetic as the WGSL below. `u` is the uniforms above.
----------------------------------------------------------------------------------------------------------------------*/
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
function slabJS(o, dd, h, t) {
    if (Math.abs(dd) < 1e-12) return Math.abs(o) > h ? [1, 0] : t
    const a = (-h - o) / dd, b = (h - o) / dd
    return [Math.max(t[0], Math.min(a, b)), Math.min(t[1], Math.max(a, b))]
}
/** The stretch [t0, t1] of the segment A + d t, t in [0, len] (d a unit vector), inside the box and the scene's radius
 *  R; t1 <= t0 when none. */
export function hazeSpanJS(u, A, d, len, R) {
    const o = [A[0] - u.hazeC[0], A[1] - u.hazeC[1], A[2] - u.hazeC[2]]
    let t = [0, len]
    for (const ax of [u.hazeU, u.hazeV, u.hazeW]) t = slabJS(dot3(o, ax), dot3(d, ax), ax[3], t)
    const b = dot3(A, d), c = dot3(A, A) - R * R, disc = b * b - c
    if (disc <= 0) return [1, 0]
    const s = Math.sqrt(disc)
    return [Math.max(t[0], -b - s), Math.min(t[1], -b + s)]
}
/** What survives of light crossing that segment: exp(-sigma_t times the length inside). */
export function hazeTrJS(u, A, d, len, R) {
    if (!(u.hazeC[3] > 0)) return 1
    const s = hazeSpanJS(u, A, d, len, R)
    return s[1] > s[0] ? Math.exp(-u.hazeC[3] * (s[1] - s[0])) : 1
}
/** Henyey-Greenstein, per steradian, of the cosine between the direction travelled and the direction scattered into. */
export function hgEvalJS(cosT, g) {
    const d = 1 + g * g - 2 * g * cosT
    return (1 - g * g) / (4 * Math.PI * Math.pow(Math.max(d, 1e-12), 1.5))
}
/** ...its cosine drawn exactly (u in [0, 1)): the inverse of its cumulative distribution in cos. */
export function hgCosJS(g, u) {
    if (Math.abs(g) < 1e-3) return 1 - 2 * u
    const s = (1 - g * g) / (1 - g + 2 * g * u)
    return Math.min(1, Math.max(-1, (1 + g * g - s * s) / (2 * g)))
}
/** A direction about d (unit) drawn from the phase function: u = [u0, u1]. */
export function hgSampleJS(d, g, u) {
    const c = hgCosJS(g, u[0]), s = Math.sqrt(Math.max(0, 1 - c * c)), ph = 2 * Math.PI * u[1]
    const t = Math.abs(d[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0]
    const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    let b1 = cr(t, d); const l = Math.hypot(...b1); b1 = b1.map(v => v / l)
    const b2 = cr(d, b1)
    return [0, 1, 2].map(k => b1[k] * Math.cos(ph) * s + b2[k] * Math.sin(ph) * s + d[k] * c)
}
/** THE MEDIUM'S WALK IN JS (0.82.0; THE MEDIUM'S WALK below, the march's): a slab of optical depth tau -- thickness tau mean
 *  free paths, its faces index-matched (no reflection, no refraction: the volume alone) -- lit head-on, walked as the march
 *  walks it: a free flight -ln(1 - u) a leg, Henyey-Greenstein's turn of asymmetry g at each collision, every collision of
 *  weight 1. What leaves by the far face (T), of it what never collided (ballistic), and what leaves by the near one (R),
 *  over `rays` rays of mulberry32 from `seed`; and the mean cosine of the far face's exit about its normal (through, the
 *  intensity's shape), and the collisions a ray took on average (steps). */
export function slabWalkJS({ tau = 1, g = 0, rays = 200000, seed = 1, cap = 100000 } = {}) {
    let a = seed >>> 0
    const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
    let T = 0, ball = 0, R = 0, mu = 0, coll = 0
    for (let k = 0; k < rays; k++) {
        let z = 0, d = [0, 0, 1], n = 0
        for (; n < cap; n++) {
            const t = -Math.log(1 - rnd())
            const zn = z + d[2] * t
            if (zn >= tau) { T++; mu += d[2]; if (n === 0) ball++; break }
            if (zn <= 0) { R++; break }
            z = zn
            d = hgSampleJS(d, g, [rnd(), rnd()])
            const l = Math.hypot(...d); d = d.map(v => v / l)
        }
        coll += n
    }
    return { T: T / rays, ballistic: ball / rays, R: R / rays, through: T > 0 ? mu / T : 0, steps: coll / rays }
}
/** f16 as WGSL's pack2x16float stores it (round to nearest even, subnormals kept): the value read back. */
export function f16JS(x) {
    if (!Number.isFinite(x)) return x
    const s = x < 0 ? -1 : 1, v = Math.abs(x)
    if (v >= 65520) return s * Infinity
    if (v < 2 ** -24 / 2) return s * 0
    let e = Math.floor(Math.log2(v))
    if (e < -14) e = -14                                     // subnormal: the step 2^-24
    const step = 2 ** (e - 10)
    let q = v / step, r = Math.round(q)
    if (Math.abs(q - Math.trunc(q) - 0.5) < 1e-12) r = Math.trunc(q) % 2 === 0 ? Math.trunc(q) : Math.trunc(q) + 1   // ties to even
    return s * r * step
}
/** THE MEDIUM AS A RAY CARRIES IT (tracebasics.js packMedium), in JS: what comes back of an absorption (per metre, per
 *  channel), a scattering coefficient (per metre) and g once packed, per millimetre, into f16 and read again. */
export function packMediumJS(mu, sigma, g) {
    const c = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
    return { mu: mu.map(m => f16JS(c(m * 1e-3, 0, 65000)) * 1e3), sigma: f16JS(c(sigma * 1e-3, 0, 65000)) * 1e3,
             g: f16JS(c(g, -HAZE_G_MAX, HAZE_G_MAX)) }
}
/** THE COLLISION ON A LEG (hazeDraw's arithmetic): the leg from A along d for len, uniform u; the distance along it of
 *  the collision, or -1 for none. */
export function hazeCollideJS(u, A, d, len, R, rnd) {
    if (!(u.hazeC[3] > 0)) return -1
    const s = hazeSpanJS(u, A, d, len, R)
    if (!(s[1] > s[0])) return -1
    const t = s[0] - Math.log(1 - rnd) / u.hazeC[3]
    return t < s[1] ? t : -1
}

/*======================================================================================================================
  THE WGSL. HAZE_WGSL in every kernel that sees the haze (surface, shade, occlude): the box, the transmittance, the phase
  function and the collision. HAZE_SHADE_WGSL in shade alone, after PROCESSOR and PROCESSING: the vertex, its light
  sampling and its photons' connection, which call what those define.
======================================================================================================================*/
/* HENYEY-GREENSTEIN (0.62.0), the haze's phase function -- and the walk's in a scattering material (0.82.0: THE MEDIUM'S
   WALK, below), which may be compiled without a haze box: one text, pasted by each */
export const HG_WGSL = /*wgsl*/`// Henyey-Greenstein, per steradian, of the cosine between the direction travelled and the one scattered into
fn hgEval(cosT: f32, g: f32) -> f32 {
    let d = 1.0 + g * g - 2.0 * g * cosT;
    return (1.0 - g * g) / (4.0 * PI * pow(max(d, 1e-12), 1.5));
}
// ...a direction about d drawn from it, exactly (the inverse of its distribution in the cosine)
fn hgSample(d: vec3<f32>, g: f32, u: vec2<f32>) -> vec3<f32> {
    var c = 1.0 - 2.0 * u.x;
    if (abs(g) >= 1e-3) {
        let s = (1.0 - g * g) / (1.0 - g + 2.0 * g * u.x);
        c = clamp((1.0 + g * g - s * s) / (2.0 * g), -1.0, 1.0);
    }
    let sn = sqrt(max(0.0, 1.0 - c * c));
    let ph = 2.0 * PI * u.y;
    var t = vec3<f32>(1.0, 0.0, 0.0);
    if (abs(d.x) > 0.9) { t = vec3<f32>(0.0, 1.0, 0.0); }
    let b1 = normalize(cross(t, d));
    let b2 = cross(d, b1);
    return normalize(b1 * (cos(ph) * sn) + b2 * (sin(ph) * sn) + d * c);
}
`
export const HAZE_WGSL = /*wgsl*/`
/* A RAY THE HAZE STOPPED: the march moved it back to where it met a particle (hazeAt), and shade makes that point a
   vertex (mediumVertex). One past the states tracebasics.js declares (0..8): the photon map's kernel takes only
   RAY_ACTIVE, so it passes such a ray by. */
const RAY_SCATTER: u32 = 9u;
const HAZE_G_MAX: f32 = ${HAZE_G_MAX};
fn hazeOn() -> bool { return UB.hazeC.w > 0.0; }
// one slab of the box: the parameter range in it, intersected with t; parallel to it, all or nothing
fn hazeSlab(o: f32, dd: f32, h: f32, t: vec2<f32>) -> vec2<f32> {
    if (abs(dd) < 1e-12) { return select(t, vec2<f32>(1.0, 0.0), abs(o) > h); }
    let a = (-h - o) / dd;
    let b = (h - o) / dd;
    return vec2<f32>(max(t.x, min(a, b)), min(t.y, max(a, b)));
}
/* THE STRETCH of A + d t, t in [0, len], inside the box -- and inside the scene's radius: nothing scatters beyond it,
   which keeps the sun's photons (they start on the plane at the radius: sdf.js THE EMISSION FRAME) and a camera path
   escaping along the same line seeing the same haze. t.y <= t.x when there is none. */
fn hazeSpan(A: vec3<f32>, d: vec3<f32>, len: f32) -> vec2<f32> {
    let o = A - UB.hazeC.xyz;
    var t = vec2<f32>(0.0, len);
    t = hazeSlab(dot(o, UB.hazeU.xyz), dot(d, UB.hazeU.xyz), UB.hazeU.w, t);
    t = hazeSlab(dot(o, UB.hazeV.xyz), dot(d, UB.hazeV.xyz), UB.hazeV.w, t);
    t = hazeSlab(dot(o, UB.hazeW.xyz), dot(d, UB.hazeW.xyz), UB.hazeW.w, t);
    let R = UB.envRadius;
    let b = dot(A, d);
    let disc = b * b - (dot(A, A) - R * R);
    if (disc <= 0.0) { return vec2<f32>(1.0, 0.0); }
    let s = sqrt(disc);
    return vec2<f32>(max(t.x, -b - s), min(t.y, -b + s));
}
// what survives of light crossing that segment
fn hazeTr(A: vec3<f32>, d: vec3<f32>, len: f32) -> f32 {
    if (!hazeOn()) { return 1.0; }
    let s = hazeSpan(A, d, len);
    if (s.y <= s.x) { return 1.0; }
    return exp(-UB.hazeC.w * (s.y - s.x));
}
/* A LEG'S COLLISION, DRAWN AS THE LEG STARTS: the user's "move back YY" (the header), as free-flight sampling. The march
   (wavefront.js prog_march, in a scene with a box) asks this every pass, and it draws once a leg: a leg starts with
   tmax 0 -- newRay's, and shade's as it writes a ray on to the march -- and this leaves in tmax the ltot at which the leg
   meets a particle, or -1: none on this leg. (tmax is a shadow ray's and a probe's; a path ray had no use for it.) The
   march stops the ray there (hazeAt). Only a ray in air, neither a probe (it looks for an emitter's surface, carrying
   nothing; its tmax is its own) nor a seek ray (Draft's: it only discovers lamps), and not the illuminance view's camera
   on its first leg. Its own random numbers -- the march's seed and a constant of its own -- so shade draws exactly what
   it drew before.
   WHY AT THE START (0.62.2). In 0.62.0 the surface kernel decided after the march, the leg made again from where it
   ended: A = pos - dir len. A leg that escaped ends at the scene's radius, 400 m unless the scene gives one, where f32's
   steps are 30 um, so A came out a few of them off -- and a collision just past a start on a surface landed inside the
   solid the leg left, the path scattered from in there lost. The haze furnace with a sphere in it (tests.js 'haze')
   lost 4e-4 of its light so on the user's card (2026-10-16: the dust's rows 0.9990-0.9994, the box hidden 0.9998), and
   as much in node: 3.5e-4 at the 400 m radius, 0.08e-4 at 5 m; the bounce cap and the step budget did not move it, and a
   smaller surface tolerance made it worse (0.1 mm: 7.8e-4), as the error grew against it. Here the start is where the
   ray is, less the step off its vertex already taken, and the collision is on the line the march travelled. */
fn hazeDraw(r: Ray) -> Ray {
    if (r.tmax != 0.0 || (r.tag & TAG_PROBE) != 0u || r.state != RAY_ACTIVE) { return r; }
    var c = r;
    c.tmax = -1.0;
    if (!hazeOn() || (r.tag & TAG_SEEK) != 0u || abs(r.n - 1.0) > 1e-3) { return c; }
    if (UB.measureMode == 1u && (r.tag & TAG_PHOTON) == 0u && r.bounces == 0u) { return c; }
    let A = r.pos - r.dir * (max(r.ltot - r.absLtot, 0.0) / max(r.n, 1e-4));
    let s = hazeSpan(A, r.dir, 1.0e30);
    if (s.y <= s.x) { return c; }
    SEED_u32(0x48415A45u);
    let t = s.x - log(1.0 - PRNG().x) / UB.hazeC.w;
    if (t < s.y) { c.tmax = max(r.absLtot + t * r.n, 1e-30); }
    return c;
}
/* ...WHERE THE MARCH HAS PASSED IT: the ray stepped past the collision on its last step, a step the march took in free
   space; moved back to it along the line it travelled, its ltot the drawn one, as RAY_SCATTER -- the march hands it to
   shade as a hit, and the surface kernel and the photon map's pass it by (they take RAY_ACTIVE). */
fn hazeArrived(r: Ray) -> bool { return r.tmax > 0.0 && r.ltot >= r.tmax; }
fn hazeAt(r: Ray) -> Ray {
    var c = r;
    c.pos = r.pos - r.dir * ((r.ltot - r.tmax) / max(r.n, 1e-4));
    c.ltot = r.tmax;
    c.state = RAY_SCATTER;
    return c;
}
${HG_WGSL}`

export const HAZE_SHADE_WGSL = /*wgsl*/`
/* THE ENVIRONMENT FROM A POINT IN THE AIR: the sun's cone with neeSunPick, else a uniform sphere -- not the cosine
   hemisphere a surface draws the sky from, since there is no surface; and the sky is not 0 below the horizon (the studio
   light, the furnace: sdf.js skyRadiance). The density the mixture has, for MIS from either end. */
fn envSampleDirM(pick: f32, u: vec2<f32>) -> vec3<f32> {
    if (pick < UB.neeSunPick) { return sampleSunCone(u); }
    let z = 1.0 - 2.0 * u.x;
    let s = sqrt(max(0.0, 1.0 - z * z));
    let ph = 2.0 * PI * u.y;
    return vec3<f32>(s * cos(ph), s * sin(ph), z);
}
fn envPdfM(L: vec3<f32>) -> f32 {
    var pSun = 0.0;
    if (inSunDisc(L)) { pSun = 1.0 / sunSolidAngle(); }
    return UB.neeSunPick * pSun + (1.0 - UB.neeSunPick) / (4.0 * PI);
}

/* LIGHT SAMPLING FROM A POINT IN THE AIR: processMaterial_advanced's three-way pick (materials_pbr.js), its own copy
   because that one is the surface's -- every call site is a whole inlined copy anyway (bench/test/copies.test.mjs), and
   a shared helper would change the kernels' text without the haze. The same helpers, so both halves of every MIS weight
   come from one function: a face (lightFaceDensity has no vertex normal in it; the face's own side still counts), an
   emitter (emitConePdf), the environment (above). No NoL: the phase function is per steradian of the sphere. Draft's at
   weight 1, as a surface's. The shadow ray starts at the point: there is no surface to leave. */
fn mediumNee(r: Ray, g: f32) {
    let fast = fastCamera(r.tag);
    let P = r.pos;
    let pick00 = PRNG().x;
    let fs = lightFaceShare(r.bounces, r.tag);
    let pick0 = (pick00 - fs) / max(1.0 - fs, 1e-6);
    let es = emitShare();
    let uL = PRNG().xy;
    var kind = 0u;
    var L = VEC3(0.0);
    var pS = 0.0;
    var dS = 1.0;
    var le = VEC3(1.0);
    var y = VEC3(0.0);
    if (pick00 < fs) {
        let tot = lightFaceTotal();
        let face = lightFaceAt(lightFacePick(PRNG().x * tot));
        y = face.centre;
        if (face.shape == 1u) {
            let rr = face.half.x * sqrt(uL.x);
            let ph = 2.0 * PI * uL.y;
            y += (face.u * cos(ph) + face.v * sin(ph)) * rr;
        } else {
            y += face.u * ((2.0 * uL.x - 1.0) * face.half.x) + face.v * ((2.0 * uL.y - 1.0) * face.half.y);
        }
        let dy = y - P;
        let dist = length(dy);
        L = dy / max(dist, 1e-20);
        let cosY = dot(face.n, -L);
        if (dist > 0.0 && abs(cosY) > 1e-6 && (cosY > 0.0 || face.twoSided != 0u)) {
            pS = lightFaceDensity(fs, face, tot, dist, cosY);
            dS = max(pS, 1e-30);
            le = lightFaceLe(face, abs(cosY));          // in air: over n^2 = 1
            kind = 1u;
        }
    } else if (pick0 < es) {
        let b = emitPick(pick0 / es);
        let dc = emitCentre(b) - P;
        let d2 = dot(dc, dc);
        let rad = emitF(b, 3u);
        if (d2 > rad * rad) {
            let d = sqrt(d2);
            let axis = dc / d;
            let omc = coneOneMinusCos(rad, d2);
            let cosT = 1.0 - uL.x * omc;
            let sinT = sqrt(max(0.0, 1.0 - cosT * cosT));
            let phi = 2.0 * PI * uL.y;
            var tt = VEC3(1.0, 0.0, 0.0);
            if (abs(axis.x) > 0.9) { tt = VEC3(0.0, 1.0, 0.0); }
            let b1 = normalize(cross(tt, axis));
            let b2 = cross(axis, b1);
            L = normalize(b1 * (cos(phi) * sinT) + b2 * (sin(phi) * sinT) + axis * cosT);
            let pE = (1.0 - fs) * es * emitConePdf(P, L);
            if (pE > 0.0) { pS = pE; dS = pE; kind = 2u; }
        }
    } else {
        let pick = (pick0 - es) / max(1.0 - es, 1e-6);
        L = envSampleDirM(pick, uL);
        let pL = (1.0 - fs) * (1.0 - es) * envPdfM(L);
        if (pL > 0.0) { pS = pL; dS = pL; le = envRadiance(L); kind = 3u; }
    }
    if (kind == 0u) { return; }
    let f = hgEval(dot(r.dir, L), g);
    let w = select(misWeight(pS, f), 1.0, fast);
    let contrib = r.beta * f * le * (w / dS);
    if (pS > 0.0 && max3(contrib) > select(1e-7, 1e-9, kind == 2u)) {
        NEE_RAY = r;
        NEE_RAY.pos = P;
        NEE_RAY.dir = L;
        NEE_RAY.radiance = contrib;
        NEE_RAY.beta = VEC3(1.0);
        NEE_RAY.counts = 0u;
        NEE_RAY.ltot = 0.0;
        NEE_RAY.absLtot = 0.0;
        NEE_RAY.bounces = 0u;
        NEE_RAY.state = RAY_ACTIVE;
        NEE_RAY.tag = select(0u, TAG_EMIT, kind == 2u);
        if (kind == 1u) {
            NEE_RAY.n = 1.0;
            NEE_RAY.tmax = length(y - P) - offsetTol(P) * 2.0;
            NEE_RAY.tag = TAG_FNEE;
        }
        NEE_VALID = true;
    }
}

/* A PHOTON SCATTERED TOWARDS THE CAMERA (the user's sketch): ltConnect (materials_pbr.js) with the phase function where a
   surface has its BSDF. The camera's density for a point in a volume is dist / z^3 per unit volume -- the surface's
   footprint without its |n.v| (du dt = (t / z^3) dV for a pinhole; dA dt = dV for an orthographic camera) -- so the
   splat is flux x beta (the albedo is in it) x p x G / A_px. No surface, so no side to be behind and no lift: the
   shadow ray starts at the point and stops h short of the camera, as ltConnect's does. Never shared with the camera's
   paths: a camera path whose first vertex is in the air leaves the light to these (CLS_LIGHTS, ltMis 0). */
fn ltConnectMedium(ray: Ray, g: f32) {
    if (UB.lastpass != 0u) { return; }
    let P = ray.pos;
    let right = UB.invView[0].xyz;
    let up    = UB.invView[1].xyz;
    let fwd   = UB.invView[2].xyz;
    let fx = UB.invProjection[0][0];
    let fy = UB.invProjection[1][1];
    let fres = VEC2(UB.res);
    let apx = 4.0 * fx * fy / (fres.x * fres.y);
    let R = select(0.0, UB.camLens.x, UB.camtype == 0u);
    var off = VEC3(0.0);
    if (R > 0.0) { off = lensDisc(right, up, R, PRNG().xy); }
    let camPos = UB.camPos.xyz + off;
    let d = camPos - P;
    var v: VEC3;
    var dist: f32;
    var xy: VEC2;
    var G = 1.0;
    if (UB.camtype == 0u) {
        dist = length(d);
        let z = dot(d, fwd);
        if (z <= 1e-4 || dist <= 1e-4) { return; }
        v = d / dist;
        xy = VEC2(-dot(d, right) / (z * fx), -dot(d, up) / (z * fy));
        if (R > 0.0) { xy = lensImage(off, -v, right, up, fwd, fx, fy, UB.camLens.y).xy; }
        G = dist / (z * z * z);
    } else {
        dist = dot(d, fwd);
        if (dist <= 1e-4) { return; }
        v = fwd;
        xy = VEC2(-dot(d, right) / fx, -dot(d, up) / fy);
    }
    if (abs(xy.x) >= 1.0 || abs(xy.y) >= 1.0) { return; }
    let f = hgEval(dot(ray.dir, v), g);
    let contrib = ray.radiance * ray.beta * (f * G / apx);
    if (dot(contrib, VEC3(0.2126, 0.7152, 0.0722)) <= 0.0) { return; }
    let uv = (xy + VEC2(1.0)) * 0.5;
    let p = vec2<u32>(clamp(uv * fres, VEC2(0.0), fres - VEC2(1.0)));
    NEE_RAY = ray;
    NEE_RAY.pos = P;
    NEE_RAY.dir = v;
    NEE_RAY.radiance = contrib;
    NEE_RAY.beta = VEC3(1.0);
    NEE_RAY.counts = 0u;
    NEE_RAY.ltot = 0.0;
    NEE_RAY.absLtot = 0.0;
    NEE_RAY.n = 1.0;
    NEE_RAY.bounces = 0u;
    NEE_RAY.state = RAY_ACTIVE;
    NEE_RAY.tag = TAG_CONN;
    NEE_RAY.tmax = dist - offsetTol(P) * 2.0;
    NEE_RAY.pix = p.x + p.y * UB.res.x;
    NEE_VALID = true;
    if (ray.pix < LT_CELLS) { atomicAdd(&learn[ray.pix], 1u); }
}

/* THE HAZE A SHADOW RAY CROSSES, put on what it carries before it is queued: over the true segment from the vertex P --
   to the face's point or the camera (a face ray's and a connection's tmax stop 2 offsets short of it: materials_pbr.js,
   ltConnect, above), or to the scene's radius for the environment. Exact for every one but an emitter ray, whose length
   is only known where it lands (prog_occlude). Only from a vertex in AIR (vn, the vertex's medium: a face ray's own n is
   1 wherever it starts), and not a connection in the illuminance view, where the camera is a pointer. */
fn hazeShadow(s: Ray, P: vec3<f32>, vn: f32) -> Ray {
    if (!hazeOn() || abs(vn - 1.0) > 1e-3 || (s.tag & TAG_EMIT) != 0u) { return s; }
    if (UB.measureMode == 1u && (s.tag & TAG_CONN) != 0u) { return s; }
    var dir = s.dir;
    var len = 2.0 * UB.envRadius + length(P);
    if ((s.tag & (TAG_FNEE | TAG_CONN)) != 0u) {
        let e = s.pos + s.dir * (s.tmax + offsetTol(P) * 2.0) - P;
        len = length(e);
        dir = e / max(len, 1e-30);
    }
    var o = s;
    o.radiance = s.radiance * hazeTr(P, dir, len);
    return o;
}

/* A POINT IN THE AIR WHERE THE RAY MET A PARTICLE (the march put it there: hazeAt): a vertex, as pathBegin..pathEnd make one of a
   surface, with the phase function for the material and no normal. The albedo is the free flight's weight; the photon
   connects, or the camera path samples a light; then the phase function's own draw, whose weight is 1, and the MIS
   halves it leaves for what the ray meets next (prevPdf, vtxLtot: emitterHit and the faces' MIS recover this point from
   them). The rest is pathEnd's tail, for an event that is EV_EVAL to the splits and EV_OTHER to the photon map (the
   header says why). */
fn mediumVertex(h: Hit) -> Ray {
    NEE_VALID = false;
    NEE_N0 = -1.0;                                    // its shadow rays start in the air it is in (hazeShadow)
    LAST_EVENT = EV_EVAL;
    LAST_DIFFUSE = false;
    var r = h.r;
    r.state = RAY_ACTIVE;
    r.bounces += 1u;
    let isPhoton = (r.tag & TAG_PHOTON) != 0u;
    let isOptic = (r.tag & TAG_OPTIC) != 0u;
    let connectAll = (r.tag & TAG_LTALL) != 0u;
    let g = clamp(UB.hazeA.w, -HAZE_G_MAX, HAZE_G_MAX);
    let din = r.dir;
    let fast = fastCamera(r.tag);
    /* MAX DIFFUSE BOUNCES (0.75.0; pathEnd THE DIFFUSE CAP): a point in the dust is an EV_EVAL event and nothing else, so a
       camera path arriving with no diffuse bounce left (diffuseLeft) has nothing here it may count -- no light sample, no
       way on -- and ends */
    if (!isPhoton && !diffuseLeft(r)) { r.state = RAY_TERMINATED; return r; }
    r.beta = r.beta * UB.hazeA.xyz;
    if (isPhoton) {
        // pathMiddle's rule: a sun's or an emitter's photon once it has passed a delta event, a light's always
        let connects = ((!isOptic && (r.tag & TAG_PASSED) != 0u) || connectAll) && r.bounces <= UB.maxbounce && diffuseLeft(r);
        if (connects && UB.measureMode != 1u) { ltConnectMedium(r, g); }
    } else if (UB.nee != 0u && UB.lastpass == 0u) {
        mediumNee(r, g);
    }
    let dout = hgSample(din, g, PRNG().xy);
    r.dir = dout;
    r.counts += DIFFUSE_ONE;                          // the phase function's draw: a diffuse bounce (Ray.counts)
    let misOut = UB.nee != 0u && UB.lastpass == 0u && !isPhoton && !fast;
    if (misOut) {
        let pB = hgEval(dot(din, dout), g);
        let pL = (1.0 - lightFaceShare(r.bounces, r.tag)) * (1.0 - emitShare()) * envPdfM(dout);
        r.sunmis = select(misWeight(pB, pL), 1.0, pL <= 0.0);
        r.prevPdf = pB;
    } else {
        r.sunmis = 1.0;
        r.prevPdf = -1.0;
    }
    r.vtxLtot = r.ltot;
    if (!isPhoton && r.bounces == 1u) { r.ltMis = 0.0; }
    // a faceless light's photon scattered: its ray into the lens is ltConnectMedium's light now, not the lens's (lens.js)
    if (isPhoton && r.ltMis < LT_FACELESS + 0.5) { r.ltMis = -1.0; }

    // the photon map's class: out, both fields (the header: the map holds no photons in the air)
    let lensPh = isPhoton && (!isOptic || connectAll);
    if (sppmOn() && (lensPh || !isPhoton)) { r.tag = lensStep(r.tag, lensPh, r.bounces, EV_OTHER); }
    if (isOptic) {
        // a light's photon walks on, as through any evaluable lobe outside the Optics view (which has no haze)
    } else if (isPhoton) {
        r.state = RAY_TERMINATED;                     // a sun's or an emitter's photon ends at its first real scatter
    } else {
        // THE LIGHTS' SPLIT and THE CAMERA SIDE OF THE SUN'S (pathEnd), the vertex in air by construction
        if (r.bounces == 1u) {
            r.tag = (r.tag & (TAG_LAMBDA_MASK | (3u << LENS_CAM_SHIFT))) | select(0u, CLS_LIGHTS, UB.ltLights != 0u);
        }
        if (UB.lt != 0u || UB.ltEmit != 0u) {
            if (r.bounces == 1u) { r.tag = r.tag | CLS_CAND; }
            else if ((r.tag & CLS_CAND) != 0u) { r.tag = r.tag & ~(CLS_CAND | CLS_SPEC); }
        }
    }
    // THE FAST MODES' STOP (Draft here: Sketch and the Optics view have no haze), and its seek rays
    if (fast && r.state == RAY_ACTIVE) {
        if (UB.renderMode == 1u && UB.lastpass == 0u && PRNG().x < UB.draftSeek) {
            r.tag = r.tag | TAG_SEEK;
            r.beta = VEC3(0.0);
        } else {
            r.state = RAY_TERMINATED;
        }
    }
    if (r.bounces > UB.maxbounce) { r.state = RAY_TERMINATED; }
    // ...and a light's photon with no diffuse bounce left lights nothing more (pathEnd); a camera path's arrived above
    if (connectAll && UB.diffuseCap != 0u && rayDiffuse(r) >= UB.diffuseCap) { r.state = RAY_TERMINATED; }
    if (UB.rr != 0u && r.bounces >= uRRStart && r.state == RAY_ACTIVE) {
        let p = clamp(max3rgb(r.beta), RR_MIN_P, RR_MAX_P);
        if (PRNG().x > p) { r.state = RAY_TERMINATED; } else { r.beta /= p; }
    }
    return r;
}
`

/*======================================================================================================================
  THE MEDIUM'S WALK (0.82.0; roadmap/DIFFUSERS.md A): scattering inside a material -- milky glass, a light guide --
  whose mean free path is the material's (materials.js scatterDistance) and whose phase function is Henyey-Greenstein
  of its asymmetry, the haze's. The user (2026-10-30): a transmissive material with "a bit of scatter", realistic; haze
  (materials_pbr.js) scatters at the faces whatever the thickness, and this in the volume, so a thick part is milkier.
  WHERE: IN THE MARCH, NOT A SHADE VERTEX. Inside a solid every shadow ray and every photon's connection is stopped by the
  solid's own wall, so a collision there has nothing to sample and nothing to connect: it only turns the ray. So the
  march turns it and marches on -- the cost a collision is a march step against UB.maxiter, not a wavefront round and a
  bounce, and a dense medium is not cut by maxbounce or the diffuse cap. (A haze box's collision is a vertex because in
  air light sampling works: haze.js above.)
  WHAT IT IS: free-flight sampling, exact. Pure scattering -- each collision weighs 1 -- and the absorption stays the
  material's colour depth, applied along the whole walk where the ray arrives (tracebasics.js absorbAlong: ltot counts
  every step walked). A leg's flight is drawn as it starts (mediumDraw: tmax 0, which a crossing into the medium sets,
  tracebasics.js enterMedium), the next at each collision; a surface met first ends the leg as it would have, and what
  is left of the flight past it is the same exponential (an internal reflection keeps the draw). A shadow ray inside
  takes the scattering as extinction instead (tracebasics.js shadowTransmittance).
  AND THE MIS AFTER IT: a ray that collided goes on as one light sampling could not have made -- prevPdf -1, sunmis 1 --
  so the light it meets takes its whole weight; light sampling's own shadow ray is the no-collision half, dimmed by
  exp(-sigma d), which is exactly the chance a drawn ray has of crossing without one.
  COMPILED IN ONLY FOR A SCENE WITH A SCATTERING MATERIAL (scene.scatter, the builder's codegen; raytrace_main.js
  wavefrontKernels): every other scene's march is the text it was.
======================================================================================================================*/
const MEDIUM_WGSL = /*wgsl*/`
// a ray this walks: a path's or a photon's, in a scattering medium (a probe's tmax and a connection's are their own)
fn mediumWalks(r: Ray) -> bool {
    return rayScatter(r).x > 0.0 && (r.tag & (TAG_PROBE | TAG_CONN)) == 0u && r.state == RAY_ACTIVE;
}
// ...a free flight from the optical length start: the ltot at which it collides, distance -ln(1 - u) / sigma
fn mediumFlight(r: Ray, start: f32, u: f32) -> f32 { return max(start - log(1.0 - u) / rayScatter(r).x * r.n, 1e-30); }
/* A LEG'S, drawn as it starts (tmax 0: enterMedium, or a ray made), FROM ITS VERTEX (absLtot, where the ray arrived), not
   from where it is: shade moves every ray off its surface first, ten surface tolerances along its way (materials_pbr.js
   offsetTol), and a flight drawn after that step could never collide within it: a wide slab of optical depth 6 (g 0.5)
   passed 0.3952 where the walk passes 0.3813, 3.6 % too much, and at depth 1 0.6640 against 0.6580 (Dawn, volume.gpu.mjs,
   2026-11-02: 2 mm of a 10 cm slab skipped at its entry). Drawn from the vertex, 0.3809 and 0.6594. A collision within the
   step is then behind the ray, and the march's first check moves it back to it along the line it came (mediumCollide),
   as the haze's draw does (hazeDraw). NOT MODELLED, the hit tolerance: a wall is met up to a tolerance short of it, so
   the medium's edge is that much uncertain -- 1/80 of a free path there, within the error bars; a free path near the
   tolerance itself is not traced right (inferred, not measured). */
fn mediumDraw(r: Ray) -> Ray {
    if (r.tmax != 0.0 || !mediumWalks(r)) { return r; }
    var c = r;
    SEED_u32(0x4D454449u);
    c.tmax = mediumFlight(r, min(r.absLtot, r.ltot), PRNG().x);
    return c;
}
// the collision passed on the step just taken
fn mediumArrived(r: Ray) -> bool { return r.tmax > 0.0 && r.ltot >= r.tmax && mediumWalks(r); }
// ...the ray back to it along the line it travelled, as it arrived there
fn mediumBack(r: Ray) -> Ray {
    var c = r;
    c.pos = r.pos - r.dir * ((r.ltot - r.tmax) / max(r.n, 1e-4));
    c.ltot = r.tmax;
    return c;
}
// ...and turned by the phase function, its next flight drawn
fn mediumCollide(r: Ray) -> Ray {
    var c = mediumBack(r);
    c.dir = hgSample(r.dir, rayScatter(r).y, PRNG().xy);
    c.tmax = mediumFlight(c, c.ltot, PRNG().x);
    c.prevPdf = -1.0;                   // light sampling's shadow ray could not have made this path
    c.sunmis = 1.0;
    // a faceless light's photon turned: what it carries into the lens past here is the map's (lens.js), not the lens's
    if (c.ltMis < LT_FACELESS + 0.5) { c.ltMis = -1.0; }
    return c;
}
`
/*======================================================================================================================
  THE BEAM SEEN INSIDE (0.82.0; roadmap/MEDIA.md phase 2, sppm.js): the photon map in the volume. The user (2026-11-02): a
  collimated beam through slightly milky glass, which should show its track "just like you'd see when using a laser and
  very slightly hazy acrylic" -- and nothing did: a collision only turns a ray, so the light a beam scatters in smooth
  glass had no way to the camera (a shadow ray and a photon's connection both stop at the glass's own face, and a
  collimated light no camera path can meet at all). Now:
    - A PHOTON STORES A RECORD WHERE IT COLLIDES (mediumStore, in the march): its point, the way it came, its power, the
      flag SPPM_VOL -- by the surface map's own rules for who stores (sppm.js sppmStores): past a delta event with its
      lens field 0, or every one of a light no camera path can meet. A collision is no event to the fields, so a photon
      that walks keeps storing.
    - A CAMERA RAY GATHERS AT ITS FIRST COLLISION while its lens field is 1 (delta events only since the eye: it came in
      through a smooth face): the march hands that collision to the shade queue as RAY_GATHER, the map's kernel gathers
      (sppm.js sppmGatherVolume), and shade turns the ray there as the march would have (mediumGathered). That collision
      is the map's D: the camera's path then leaves the class (lensStep, EV_EVAL), so the light it reaches from it
      through the walk and delta events alone is the map's, as at a surface.
  Compiled in only for a scene that scatters with the map on, and only where the march has room for the map's two
  buffers (raytrace_main.js volumeOf); with neither, nothing stores and nothing gathers, as before.
======================================================================================================================*/
/** The state a camera ray's collision is handed to the shade queue in, for the map's kernel to gather and shade to turn */
export const RAY_GATHER_WGSL = /*wgsl*/`
const RAY_GATHER: u32 = 10u;
`
const MEDIUM_MAP_WGSL = /*wgsl*/`
// a photon that stores where it collides: the surface map's rules (sppm.js sppmStores), in the march's own terms
fn mediumStores(r: Ray) -> bool {
    if (UB.sppmCtl.x == 0u || (r.tag & TAG_PHOTON) == 0u || (r.tag & TAG_PROBE) != 0u) { return false; }
    let optic = (r.tag & TAG_OPTIC) != 0u;
    let lights = optic && (r.tag & TAG_LTALL) != 0u;
    if (optic && !lights) { return false; }
    if (r.bounces + 2u > UB.maxbounce) { return false; }
    if (UB.diffuseCap != 0u && rayDiffuse(r) + 1u > UB.diffuseCap) { return false; }
    if (UB.renderMode == 3u || sppmUnmet(r)) { return lights; }
    return (r.tag & TAG_PASSED) != 0u && ((r.tag >> LENS_PH_SHIFT) & 3u) == 0u;
}
// a camera ray that gathers at this collision: delta events only since the eye (its lens field 1)
fn mediumGathers(r: Ray) -> bool {
    return UB.sppmCtl.x != 0u && (r.tag & (TAG_PHOTON | TAG_PROBE | TAG_SEEK)) == 0u && ((r.tag >> LENS_CAM_SHIFT) & 3u) == 1u;
}
// ...the photon's record, at the collision it arrived at (mediumBack), its power with the absorption since its vertex
fn mediumStore(r: Ray) {
    let power = r.radiance * r.beta * rayTransmittance(r);
    if (dot(power, VEC3(0.2126, 0.7152, 0.0722)) <= 0.0) { return; }
    SEED_u32(0x564F4C53u);
    sppmPut(r.pos, -r.dir, 0u, (r.bounces + 1u) | SPPM_VOL | select(0u, SPPM_ALL, sppmUnmet(r)), power);
}
`
/** ...and in shade: the camera ray the map gathered for at its collision, turned there as the march would have turned it
 *  -- a vertex now, the map's D: a bounce and a diffuse bounce counted, its lens field moved (lensStep, EV_EVAL), its
 *  next flight drawn by the march from here (tmax 0, absLtot the collision: shade's absorbAlong), light sampling's MIS
 *  halves cleared (prevPdf -1, sunmis 1). In a fast mode the path ends here, as it ends at its first evaluable event. */
const MEDIUM_GATHERED_WGSL = /*wgsl*/`
fn mediumGathered(h: Hit) -> Ray {
    var r = h.r;
    r.state = RAY_ACTIVE;
    r.bounces += 1u;
    r.counts += DIFFUSE_ONE;
    r.tag = lensStep(r.tag, false, r.bounces, EV_EVAL);
    r.dir = hgSample(r.dir, rayScatter(r).y, PRNG().xy);
    r.tmax = 0.0;
    r.prevPdf = -1.0;
    r.sunmis = 1.0;
    r.vtxLtot = r.ltot;
    if (fastCamera(r.tag) || r.bounces > UB.maxbounce) { r.state = RAY_TERMINATED; }
    return r;
}
`
/** The walk for the march kernel, with Henyey-Greenstein unless the haze's text (which has it) is pasted too; with
 *  `map`, the photon map's store and the camera's hand-off (THE BEAM SEEN INSIDE). */
export const mediumMarchWGSL = (withHaze, map = false) =>
    (withHaze ? '' : HG_WGSL) + MEDIUM_WGSL + (map ? SPPM_STORE_WGSL + RAY_GATHER_WGSL + MEDIUM_MAP_WGSL : '')
/** ...for shade: the turn after a gather */
export const mediumShadeWGSL = withHaze => (withHaze ? '' : HG_WGSL) + RAY_GATHER_WGSL + MEDIUM_GATHERED_WGSL
