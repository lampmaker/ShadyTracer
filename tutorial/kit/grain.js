//======================================================================================================================
// NUMBERS HAVE GRAIN -- chapter 30's figures run this. Pure.
//
//   A TOLERANCE FATTENS    a ray has hit a surface once it is within the tolerance of it, so every shape is traced as
//                          if it were that much bigger all round: a small lamp's face, in the flat world and by the
//                          3D formula for the disc that showed it; and a thin gap between two slabs of glass, lost
//                          when the probe of the medium beyond a surface (twenty tolerances across) reaches past it.
//   THE THREE TERMS        the tolerance at a point, marchTol: the setting (or the automatic share of the scene's size),
//                          a nanometre, and f32's floor, by the engine's own tolerances.js and photometry.js.
//   THE BOUNDARY, LINTED   a few lines of the engine's code with one planted, through the real unitlint.js, against
//                          the real boundary between engine and scene (scene_api.js) and the scene's unit functions.
//======================================================================================================================

import { f32Floor, marchTolAt, TOL_MIN_M, TOL_F32_STEPS, F32_STEP } from '../../lib/pathtracer/core/tolerances.js'
import { autoEps, EPS_SHARE, EPS_FALLBACK } from '../../lib/pathtracer/core/photometry.js'
import { slabT, twoSlabT } from '../../lib/pathtracer/optics/fresnel.js'
import { unitLint } from '../../lib/pathtracer/core/unitlint.js'
import { SCENE_BOUNDARY } from '../../lib/pathtracer/core/scene_api.js'
import { SCENE_UNITS_WGSL } from '../../lib/pathtracer/core/tracebasics.js'

export { f32Floor, marchTolAt, TOL_MIN_M, TOL_F32_STEPS, F32_STEP, autoEps, EPS_SHARE, EPS_FALLBACK }

/* THE LAMP THAT A TOLERANCE FATTENED (docs/TESTING.md, light-vs-emitter, finding 7): a disc of radius 1 cm, the
   scene's automatic tolerance 0.91 mm, the floor seeing it 37 degrees off its axis. */
export const LAMP_R = 0.01, LAMP_EPS = 0.00091, LAMP_TILT = 37
/** In the flat world: a lamp's face, a segment of half length r, seen `tilt` degrees off its normal, is 2 r cos(tilt)
 *  across; every point within eps of it counts as a hit, so it is 2 r cos(tilt) + 2 eps across: this many times. */
export const flatFatten = (r, eps, tilt) => 1 + eps / (r * Math.cos(tilt * Math.PI / 180))
/* In 3D: the disc seen `tilt` off its axis is an ellipse of half axes r and r cos(tilt); grown by eps all round, its
   outline's area grows by eps times its perimeter plus pi eps^2 (Steiner's formula, exact for a convex outline). The
   ellipse's perimeter is Ramanujan's approximation, good to far better than these digits. */
const ellipsePerimeter = (a, b) => Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)))
export function discFatten(r, eps, tilt) {
    const b = r * Math.cos(tilt * Math.PI / 180), A = Math.PI * r * b
    return 1 + eps * ellipsePerimeter(r, b) / A + Math.PI * eps * eps / A
}

/* THE THIN GAP (docs/TESTING.md, optics-refraction; roadmap/PLAN.md, "Thin air gaps -- open"): two glass slabs, index
   1.5, a gap of 0.5 mm. At a surface the index beyond is probed twenty tolerances across (tracebasics.js mediumBeyond,
   offsetTol x 2; the table's "two steps off": "the medium beyond is asked this far across"). Past the gap the probe
   finds the second slab's glass, so the first slab's back face reads glass to glass, no face at all, and the pair is
   traced as one slab. (A ray leaving a surface is also moved on ten tolerances, LEAVE: the probe is the first to
   fail.) */
export const GAP = 0.0005, IOR = 1.5, PROBE = 20, LEAVE = 10
export function gapSeen(gap, eps) { return PROBE * eps < gap }
/** what straight-through light the pair lets pass, as traced: two slabs, or one when the gap is stepped over */
export const gapT = (gap, eps) => gapSeen(gap, eps) ? twoSlabT(0, IOR) : slabT(0, IOR).model

/** THE TOLERANCE AT A POINT, its three terms (metres): the scene's setting (`typed`, or the automatic share of its
 *  size `extent`), the never-zero minimum, f32's floor at `dist` from the origin; which one wins. */
export function terms({ extent, dist, typed = 0 }) {
    const setting = typed > 0 ? typed : autoEps(extent, 'm')
    const floor = f32Floor([dist, 0, 0]), tol = marchTolAt(setting, [dist, 0, 0])
    const wins = tol === floor && floor > setting ? 'the floor' : tol === TOL_MIN_M && TOL_MIN_M > setting ? 'the minimum' : typed > 0 ? 'the setting' : 'the automatic tolerance'
    return { setting, floor, min: TOL_MIN_M, tol, wins, beyond: setting / (TOL_F32_STEPS * F32_STEP) }
}
/** The floor before 0.36.0: 1e-7 of a scene unit, in metres */
export const oldFloor = unitMetres => 1e-7 * unitMetres

/* THE BOUNDARY, LINTED. A few lines of an engine kernel: the scene asked through the boundary, the engine's own
   tolerance; then one line planted, of the kinds the lint's own test plants (core/test/unitlint.test.mjs). The scene is
   a stand-in whose three functions are the scene's side; its unit functions (metres, marchEps, ...) are the real
   SCENE_UNITS_WGSL. */
export const KERNEL = [
    'let h = sceneAt(ray, false);           // the scene, asked through the boundary',
    'let eps = marchTol(ray.pos);           // the engine\'s tolerance, in metres',
    'if (h.s.w < eps) { hit(h); }',
]
export const PLANTS = {
    none: { label: 'nothing planted', line: '', helper: '' },
    sdf: { label: 'the scene asked directly', line: 'let d = SDF(ray);                      // in the scene\'s unit, not metres', helper: '' },
    eps: { label: 'the scene\'s own tolerance', line: 'let e = marchEps();                    // a length in the scene\'s unit', helper: '' },
    tol: { label: 'a scene global read', line: 'let t = SCN_TOL;                       // what the boundary hands the scene', helper: '' },
    unit: { label: 'the unit read outside', line: 'let k = 1.0 / UB.sceneUnit;            // the unit, read by hand', helper: '' },
    deep: { label: 'one level down', line: 'let far = farAway();                   // a helper of the engine\'s...', helper: 'fn farAway() -> f32 { return metres(1000.0); }   // ...that asks the scene\'s side' },
}
const STAND_IN = /* wgsl */`
    fn SDF(r: Ray) -> Hit { var h: Hit; return h; }
    fn getMaterial2(h: Hit, inside: bool) -> Material2 { var m: Material2; return m; }
    fn lightFace(i: u32) -> LightFace { var f: LightFace; return f; }`
/** The lint's verdict on the kernel with `plant` in it: its lines of complaint, none when clean */
export function lint(plant) {
    const p = PLANTS[plant] ?? PLANTS.none
    const k = { body: p.helper, main: [...KERNEL, p.line].filter(Boolean).join('\n') }
    return unitLint(k, { wgsl: STAND_IN }, 'kernel', { sceneSide: [SCENE_UNITS_WGSL], boundary: [SCENE_BOUNDARY] })
}
