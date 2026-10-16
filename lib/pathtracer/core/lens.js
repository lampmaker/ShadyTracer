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
