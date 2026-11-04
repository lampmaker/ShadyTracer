//======================================================================================================================
// THE CAMERA'S LENS (0.43.0) -- a thin lens: depth of field, and the connections a lit point makes to it.
//
// WHY. The camera was a pinhole, a point. Two things follow from a point. Everything is sharp. And no photon can ever
// arrive at it by itself: a photon that has passed glass, scattered off a diffuse surface and passed glass again
// (light -> glass -> floor -> glass -> eye, "SDS") has no direction left to choose -- the last refraction decides it
// -- and the chance that it is aimed at a point is zero. The camera side cannot find that path either: from the eye
// through the glass to the floor it must then guess the one direction the glass maps onto the light. So the floor
// inside a prism, lit by a lamp through the prism, was black seen through the prism (the user's picture, 2026-10-08).
// A lens is an AREA: a photon that leaves the glass has a real chance of passing through it, and where it lands on
// the picture follows from where and at what angle it passes. (The user's idea, 2026-10-09: "a more realistic camera
// model that has a lens with certain diameter, and that could work in parallel".) That second reason is gone since
// 0.61.0 (below); the depth of field stays.
//
// THE MODEL. A disc of radius R at the camera's position, square to its axis, focused at F along the axis. A camera
// ray of the picture's point xy -- the pinhole's ray, through the focus plane at
//     Pf = camPos + F (right x fx + up y fy - fwd)
// -- starts at a point y drawn uniformly on the disc and is aimed at Pf. Everything at the focus plane is sharp; a
// point at another depth spreads over a circle. R = 0 is the pinhole, exactly: the ray from camPos to Pf is the
// pinhole's, and nothing extra is drawn from the random stream (genrays, ltConnect), so the picture is the one it was.
//
// A PIXEL'S VALUE, written as a measurement: the mean radiance over its rays, uniform over the pixel's patch of the
// image plane at distance 1 (area A_px = 4 fx fy / (w h)) and over the lens (area A_L = pi R^2). From a lens point y,
// the image plane's dA maps to a solid angle dw = cos^3(theta) dA (theta off the axis), so
//     I = 1 / (A_px A_L)  ∫∫ L / cos^3 dw dA_L  =  1 / (A_px A_L) ∫ dPhi / cos^4,     dPhi = L cos dw dA_L.
// Hence how the light side adds to a pixel: A CONNECTION from a surface point P (ltConnect) picks y uniformly on the
// lens and splats
//       flux f |n.v| / (dist^2 cos^3 A_px)     -- the pinhole's own G / A_px, measured from y instead of camPos:
// the 1 / A_L of the measurement and the 1 / A_L of picking y cancel.
//
// WHAT IT WAS ALSO FOR, AND IS NO LONGER (0.61.0). From 0.43.0 a photon that crossed the disc splatted
// Phi / (A_px A_L cos^4) on the pixel its ray back through the lens met (lensHit), and the camera's paths left those
// photons the class light -> delta+ -> D -> delta+ -> eye. That counted the floor behind glass only when a photon
// happened to cross the disc: the white specks in the user's picture of 2026-10-15. The photon map (sppm.js) owns that
// class now, through any aperture or none, and the lens's photons went with it. The class keeps the lens's name in
// Ray.tag (materials_pbr.js lensStep) because the lens owned it first.
//
// A FACELESS LIGHT SEEN THROUGH THE LENS (0.next). A light with no face -- a ray file, or a source that is only a
// description -- is no geometry: no camera ray can meet it, and its photons connect only from the surfaces they land
// on (ltConnect). So the light itself was never in the picture, aperture or not: the user imported a ray file and
// looked at it through a lens, and it was dark (2026-11-04). The way a real camera sees it is the way 0.43.0's lens
// photons saw everything: its rays cross the lens. That came back for these lights alone, which no other strategy
// counts -- the photon map, which owns the light behind glass, stores where photons land, and nothing lands on the
// source. A photon of such a light carries Ray.ltMis LT_FACELESS while nothing but delta events (mirrors, smooth
// glass) has turned it; past anything else its light into the lens is a connection's or the map's, and it is -1.
//   - THE MARCH (lensWatches, lensCrossed below): a step of such a photon, in air, that crosses the plane of the disc
//     (camPos, square to the axis) inside radius R sets TAG_LENS_X. A step is free space -- the scene's distance
//     holds it -- so a step that crosses the disc reached it unblocked, with no shadow ray to ask.
//   - SHADE, where the leg ends however it ends (a surface, the sky, the haze, a flush; lensArrival, materials_pbr.js):
//     the crossing point back along the leg, only if it is still behind where the ray stands (a collision in the dust
//     takes the ray back along its step, perhaps to before the disc), and a camera connection of length 0 there,
//     carrying the measurement's  Phi / (A_px A_L cos^4)  for the pixel lensImage gives it. The occlusion kernel
//     deposits it at once, into the splat buffer, as every photon's light, and never clamps it as a firefly: it is the
//     light itself. Not on a pass's last iteration, as ltConnect: nothing would trace it.
// A pinhole (R = 0) has no disc to cross, an orthographic camera no lens, and the illuminance view no surface there:
// none of them sees such a light. Through a small aperture the light comes as specks that a long render fills in --
// the variance of a photon hitting a target of area A_L; what that looks like is the user's to judge.
//
// Pure functions, no GPU: test/lens.test.mjs holds the JS mirror to the measurement above and to the WGSL's shape;
// check-shaders compiles the WGSL with the kernels.
//======================================================================================================================

/** A point of the disc of radius R, uniform in area, from two uniforms in [0, 1): [a, b] along right and up. */
export const lensDisc = (R, u, v) => {
    const r = R * Math.sqrt(u), phi = 2 * Math.PI * v
    return [r * Math.cos(phi), r * Math.sin(phi)]
}

/** The camera ray of the picture's point (x, y) in [-1, 1] from the lens point o = [a, b] (along right, up, in metres
 *  from camPos): { o, d } in world space, d of unit length. C = { pos, right, up, fwd, fx, fy, F }. */
export function lensRay(x, y, o, C) {
    const off = [0, 1, 2].map(k => C.right[k] * o[0] + C.up[k] * o[1])
    const toF = [0, 1, 2].map(k => (C.right[k] * x * C.fx + C.up[k] * y * C.fy - C.fwd[k]) * C.F - off[k])
    const l = Math.hypot(...toF) || 1
    return { o: [0, 1, 2].map(k => C.pos[k] + off[k]), d: toF.map(v => v / l) }
}

/** Where on the picture a ray from the lens point Y (world) along d (into the scene) is: [x, y], or null where it
 *  goes backwards. The focus plane's point Y + d F / cos, seen through the pinhole -- lensRay's inverse. */
export function lensImage(Y, d, C) {
    const c = -(d[0] * C.fwd[0] + d[1] * C.fwd[1] + d[2] * C.fwd[2])
    if (!(c > 0)) return null
    const P = [0, 1, 2].map(k => Y[k] + d[k] * C.F / c - C.pos[k])
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    return [dot(P, C.right) / (C.F * C.fx), dot(P, C.up) / (C.F * C.fy)]
}

/** A FACELESS LIGHT'S RAY THROUGH THE LENS (the header): does the ray from P along d (towards the camera, unit length)
 *  cross the disc of radius R within `len` of P? { off, cos, t } -- the crossing's offset from C.pos, the cosine with
 *  the axis, the distance from P -- or null. lensCrossed and lensArrival in one, as the kernels split it. */
export function lensCross(P, d, C, R, len = Infinity) {
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    const c = dot(d, C.fwd)
    if (!(c > 0) || !(R > 0)) return null
    const s0 = dot([P[0] - C.pos[0], P[1] - C.pos[1], P[2] - C.pos[2]], C.fwd)
    if (s0 >= 0 || s0 + len * c < 0) return null
    const t = -s0 / c
    const off = [0, 1, 2].map(k => P[k] + d[k] * t - C.pos[k])
    return dot(off, off) < R * R ? { off, cos: c, t } : null
}
/** ...and what that crossing adds to its pixel, per unit of flux: 1 / (A_px A_L cos^4) (the measurement, above), with
 *  A_px the pixel's patch of the image plane at distance 1 (4 fx fy / (w h)). */
export const lensSplat = (cos, R, apx) => 1 / (apx * Math.PI * R * R * cos ** 4)

/* THE SAME IN WGSL, as pure functions of what they are handed: the kernels read the camera from UB themselves
   (genrays, ltConnect), so this text compiles in any kernel whatever its uniforms. No one-letter capital
   for a name: the page's shorthands make F a type (lib/wgsl_shorthand.js SHORT_TOKENS), and check-shaders' naga
   pass caught it. */
export const LENS_WGSL = /*wgsl*/`
/* a point of the lens's disc, uniform in area: its offset from camPos along right and up (lens.js lensDisc) */
fn lensDisc(right: vec3<f32>, up: vec3<f32>, R: f32, u: vec2<f32>) -> vec3<f32> {
    let r = R * sqrt(u.x);
    let phi = 6.28318530718 * u.y;
    return right * (r * cos(phi)) + up * (r * sin(phi));
}
/* where on the picture, in [-1, 1], a ray from the lens point camPos + off along d (into the scene) is: the focus
   plane's point off + d F / cos, through the pinhole (lens.js lensImage). z is cos: <= 0, it goes backwards. */
fn lensImage(off: vec3<f32>, d: vec3<f32>, right: vec3<f32>, up: vec3<f32>, fwd: vec3<f32>,
             fx: f32, fy: f32, focus: f32) -> vec3<f32> {
    let c = -dot(d, fwd);
    let P = off + d * (focus / max(c, 1e-30));
    return vec3<f32>(dot(P, right) / (focus * fx), dot(P, up) / (focus * fy), c);
}
`

/* A FACELESS LIGHT'S PHOTON AND THE LENS (the header): these read UB and the Ray, so they go only where both are -- the
   march kernel (wavefront.js prog_march), which asks lensWatches once a dispatch and lensCrossed before each step, and
   the BSDF's text (materials_pbr.js, for shade's lensArrival: a photon that left the scene still watched). No kernel
   holds both. */
export const LENS_RAY_WGSL = /*wgsl*/`
/* whether this ray's steps could cross the lens: a light's photon (TAG_LTALL) of a light with no face, turned by delta
   events alone (Ray.ltMis LT_FACELESS), in clear air -- not in a material that scatters, where a collision turns it in
   the march itself -- not already across, through a lens with an aperture, the photographic or the luminance view */
fn lensWatches(r: Ray) -> bool {
    return (r.tag & (TAG_LTALL | TAG_LENS_X)) == TAG_LTALL && r.ltMis < LT_FACELESS + 0.5
        && abs(r.n - 1.0) <= 1e-3 && rayScatter(r).x <= 0.0
        && UB.camtype == 0u && UB.camLens.x > 0.0 && UB.measureMode != 1u;
}
/* whether a step of length s from r.pos along r.dir crosses the plane of the lens (camPos, square to the axis) inside
   its disc. fwd points from the target to the camera, so the scene is at dot(p - camPos, fwd) < 0. */
fn lensCrossed(r: Ray, s: f32) -> bool {
    let fwd = UB.invView[2].xyz;
    let c = dot(r.dir, fwd);
    if (c <= 0.0) { return false; }
    let s0 = dot(r.pos - UB.camPos.xyz, fwd);
    if (s0 >= 0.0 || s0 + s * c < 0.0) { return false; }
    let q = r.pos + r.dir * (-s0 / c) - UB.camPos.xyz;
    return dot(q, q) < UB.camLens.x * UB.camLens.x;
}
`
