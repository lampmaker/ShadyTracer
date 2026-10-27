//======================================================================================================================
// ANSWERS ALONG THE RAY (0.next; the user, 2026-10-26: "exact (no stepping) intersection solutions for basic shapes ...
// possibly including relief (check if there is any intersection possible at all)"). A closed-form shape says how far along
// the ray its boundary first is -- entering or leaving -- and the renderer's march and occlusion may go that far at once.
// Counted first (docs/PERFORMANCE.md STATUS 2026-10-26), then built behind the developer setting alongRay (codegen.js
// `along`, wavefront.js prog_march's and prog_occlude's `along` and ALONG_STEP_WGSL; builder/test/along.gpu.mjs).
//
// THE RULE. The step is the nearest answering shape's answer and stepscale times everything else's distance -- the nearest
// only since the user's run of Tests > alongray (ALONG_SUPPORT_WGSL says why). Safe for a hard union: its first crossing
// is no nearer than its shapes' least. So only a shape under plain groups and arrays answers -- a CSG group, a blend, a
// warp or group code bends what "first crossing" means (codegen.js ANSWERS ALONG THE RAY) -- and a culled node's box,
// which the node is inside.
//
// WHERE IT LIVES: in the scene's own text, written by codegen when the setting is on (ALONG_SUPPORT_WGSL below), so the
// engine's preludes are what they were and a scene without answers compiles what it did. AL_ON is false in every kernel
// but the two that set it, where a shape is folded in as ever.
//======================================================================================================================

/*----------------------------------------------------------------------------------------------------------------------
  THE ANSWERS: how far along a unit direction ld, from p, a shape's boundary first is, in the shape's own frame.
  A crossing t >= 0, NEVER (1e30) when the ray never meets it, NONE (-1) when this shape cannot say (its distance then).
----------------------------------------------------------------------------------------------------------------------*/
export const NEVER = 1e30, NONE = -1
export const ALONG_WGSL = /* wgsl */ `
const AL_NEVER: f32 = 1.0e30;
const AL_NONE: f32 = -1.0;
/* the ray's interval in a slab lo..hi along one axis: (t0, t1), empty as t0 > t1 */
fn alSlab(o: f32, d: f32, lo: f32, hi: f32) -> vec2<f32> {
    if (abs(d) < 1.0e-30) { return select(vec2<f32>(1.0, -1.0), vec2<f32>(-AL_NEVER, AL_NEVER), o >= lo && o <= hi); }
    let a = (lo - o) / d; let b = (hi - o) / d;
    return vec2<f32>(min(a, b), max(a, b));
}
/* the first crossing of a solid's interval along the ray: its entry ahead, or its exit from inside, or never */
fn alFirst(i: vec2<f32>) -> f32 {
    if (i.x > i.y) { return AL_NEVER; }
    if (i.x > 0.0) { return i.x; }
    if (i.y > 0.0) { return i.y; }
    return AL_NEVER;
}
fn alBox(p: VEC3, ld: VEC3, b: VEC3) -> vec2<f32> {
    let x = alSlab(p.x, ld.x, -b.x, b.x); let y = alSlab(p.y, ld.y, -b.y, b.y); let z = alSlab(p.z, ld.z, -b.z, b.z);
    return vec2<f32>(max(x.x, max(y.x, z.x)), min(x.y, min(y.y, z.y)));
}
fn Aplane(p: VEC3, ld: VEC3) -> f32 {
    if (abs(ld.z) < 1.0e-30) { return AL_NEVER; }
    let t = -p.z / ld.z;
    return select(AL_NEVER, t, t > 0.0);
}
fn AboxRounded(p: VEC3, ld: VEC3, b: VEC3, r: FLOAT) -> f32 {
    if (r <= 0.0) { return alFirst(alBox(p, ld, b)); }
    // rounded: its outer box from outside (an entry no later than the shape's), and nothing to say from inside it
    if (all(abs(p) <= b)) { return AL_NONE; }
    let i = alBox(p, ld, b);
    return select(AL_NEVER, i.x, i.x <= i.y && i.x > 0.0);
}
fn Asphere(p: VEC3, ld: VEC3, r: FLOAT) -> f32 {
    let b = dot(p, ld); let c = dot(p, p) - r * r; let disc = b * b - c;
    if (disc < 0.0) { return AL_NEVER; }
    let s = sqrt(disc);
    return alFirst(vec2<f32>(-b - s, -b + s));
}
fn Acylinder(p: VEC3, ld: VEC3, h: FLOAT, r: FLOAT) -> f32 {
    let z = alSlab(p.z, ld.z, -h, h);
    let a = dot(ld.xy, ld.xy);
    var c2 = vec2<f32>(-AL_NEVER, AL_NEVER);
    if (a < 1.0e-30) {
        if (dot(p.xy, p.xy) > r * r) { return AL_NEVER; }
    } else {
        let b = dot(p.xy, ld.xy); let c = dot(p.xy, p.xy) - r * r; let disc = b * b - a * c;
        if (disc < 0.0) { return AL_NEVER; }
        let s = sqrt(disc);
        c2 = vec2<f32>((-b - s) / a, (-b + s) / a);
    }
    return alFirst(vec2<f32>(max(z.x, c2.x), min(z.y, c2.y)));
}
fn Arectangle(p: VEC3, ld: VEC3, h: VEC2) -> f32 {
    if (abs(ld.z) < 1.0e-30) { return AL_NEVER; }
    let t = -p.z / ld.z;
    if (t <= 0.0) { return AL_NEVER; }
    return select(AL_NEVER, t, all(abs(p.xy + t * ld.xy) <= h));
}
/* A CULLING BOX, lo..hi (codegen.js culled; the node's measured box, in its own frame), where the ray first enters it, from
   outside -- the only place it is asked: a node is skipped only while its box is farther than the margin */
fn alBoxEntry(p: VEC3, ld: VEC3, lo: vec4<f32>, hi: vec4<f32>) -> f32 {
    let c = 0.5 * (lo.xyz + hi.xyz);
    let i = alBox(p - c, ld, 0.5 * (hi.xyz - lo.xyz));
    return select(AL_NEVER, i.x, i.x <= i.y && i.x > 0.0);
}
/* A PLANE RELIEF'S BAND, |z| <= a: its entry ahead; NONE inside it (the relief steps by its own bound there) */
fn AplaneBand(p: VEC3, ld: VEC3, a: FLOAT) -> f32 {
    if (abs(p.z) <= a) { return AL_NONE; }
    let i = alSlab(p.z, ld.z, -a, a);
    return select(AL_NEVER, i.x, i.x <= i.y && i.x > 0.0);
}
`
/* ...their JS twins, the same arithmetic in doubles */
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const slab = (o, d, lo, hi) => {
    if (Math.abs(d) < 1e-30) return o >= lo && o <= hi ? [-NEVER, NEVER] : [1, -1]
    const a = (lo - o) / d, b = (hi - o) / d
    return [Math.min(a, b), Math.max(a, b)]
}
const first = ([t0, t1]) => t0 > t1 ? NEVER : t0 > 0 ? t0 : t1 > 0 ? t1 : NEVER
const boxI = (p, d, b) => { const s = [0, 1, 2].map(k => slab(p[k], d[k], -b[k], b[k])); return [Math.max(...s.map(x => x[0])), Math.min(...s.map(x => x[1]))] }
export const JS = {
    plane: (p, d) => { if (Math.abs(d[2]) < 1e-30) return NEVER; const t = -p[2] / d[2]; return t > 0 ? t : NEVER },
    box: (p, d, b, r) => {
        if (r <= 0) return first(boxI(p, d, b))
        if ([0, 1, 2].every(k => Math.abs(p[k]) <= b[k])) return NONE
        const i = boxI(p, d, b); return i[0] <= i[1] && i[0] > 0 ? i[0] : NEVER
    },
    sphere: (p, d, r) => { const b = dot3(p, d), c = dot3(p, p) - r * r, disc = b * b - c; if (disc < 0) return NEVER; const s = Math.sqrt(disc); return first([-b - s, -b + s]) },
    cylinder: (p, d, h, r) => {
        const z = slab(p[2], d[2], -h, h), a = d[0] ** 2 + d[1] ** 2
        let c2 = [-NEVER, NEVER]
        if (a < 1e-30) { if (p[0] ** 2 + p[1] ** 2 > r * r) return NEVER }
        else { const b = p[0] * d[0] + p[1] * d[1], c = p[0] ** 2 + p[1] ** 2 - r * r, disc = b * b - a * c; if (disc < 0) return NEVER; const s = Math.sqrt(disc); c2 = [(-b - s) / a, (-b + s) / a] }
        return first([Math.max(z[0], c2[0]), Math.min(z[1], c2[1])])
    },
    rectangle: (p, d, h) => { if (Math.abs(d[2]) < 1e-30) return NEVER; const t = -p[2] / d[2]; if (t <= 0) return NEVER; return Math.abs(p[0] + t * d[0]) <= h[0] && Math.abs(p[1] + t * d[1]) <= h[1] ? t : NEVER },
    boxEntry: (p, d, lo, hi) => {
        const c = [0, 1, 2].map(k => 0.5 * (lo[k] + hi[k])), h = [0, 1, 2].map(k => 0.5 * (hi[k] - lo[k]))
        const i = boxI(p.map((v, k) => v - c[k]), d, h); return i[0] <= i[1] && i[0] > 0 ? i[0] : NEVER
    },
    band: (p, d, a) => { if (Math.abs(p[2]) <= a) return NONE; const i = slab(p[2], d[2], -a, a); return i[0] <= i[1] && i[0] > 0 ? i[0] : NEVER },
}
/** The closed-form shapes that answer, by their sdf.js call (plainshape.js PLAIN_SHAPES), and their answers' names. */
export const ANSWER_OF = Object.freeze({ Nplane: 'Aplane', NboxRounded: 'AboxRounded', Nsphere: 'Asphere', Ncylinder: 'Acylinder', Nrectangle: 'Arectangle' })

/* THE SCENE'S SIDE (codegen writes it after ALONG_WGSL, when a node answers). The renderer's march and occlusion set
   AL_ON and reset the rest before each scene call, and read them after it (wavefront.js along):
     AL_T     the NEAREST answering shape's answer, scene units -- how far the ray may go before its boundary
     AL_DANS  that shape's distance, scene units, for the hit test
     AL_DREST the least distance of the answering shapes it overtook as the nearest, scene units: those bound the step by
              their distance, as every shape that never answers does through C
   THE NEAREST ONLY (the user, 2026-10-26: "try nearest only"). The first build had every answering shape work out its
   answer at every step, and on the user's Ampere the march of the scenes with many answering shapes took longer for
   fewer steps (Tests > alongray: the showcase +28 %, dichroics +15 %; docs/PERFORMANCE.md). A shape's answer is now
   worked out only when it is nearer than every answering shape before it in the scene's text -- WGSL's && does not
   evaluate its right side when the left is false -- and the one it overtakes falls back to its distance. Safe as before:
   an answer is never nearer than its shape's distance, and every other shape bounds the step by its own.
   Everywhere else (AL_ON false) alNearer is false at once and a shape is folded in as ever. */
export const ALONG_SUPPORT_WGSL = /* wgsl */ `
var<private> AL_ON: bool = false;
var<private> AL_T: f32 = 1.0e30;
var<private> AL_DANS: f32 = 1.0e30;
var<private> AL_DREST: f32 = 1.0e30;
/* dw, a scene-unit distance: is this shape nearer than every answering shape so far (and is anyone asking)? */
fn alNearer(dw: FLOAT) -> bool { return AL_ON && abs(dw) < AL_DANS; }
/* tw, its answer in scene units (NONE, below 0, when it cannot say: it is folded in by its distance then); dw its distance */
fn alTake(tw: f32, dw: FLOAT) -> bool {
    if (tw < 0.0) { return false; }
    AL_DREST = min(AL_DREST, AL_DANS);
    AL_DANS = abs(dw);
    AL_T = tw;
    return true;
}
`
