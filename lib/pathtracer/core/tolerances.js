//======================================================================================================================
// EVERY TOLERANCE AND FIXED LENGTH THE RENDERER USES, IN ONE TABLE -- what it is, how big, where, and why (0.36.0).
// The quick lookup the user asked for: `node lib/pathtracer/core/tolerances.js` prints it, `RT.tolerances()` in the page
// gives it resolved for the scene showing, and lib/pathtracer/PRECISION.md explains it. It is KEPT TRUE by
// test/tolerances.test.mjs, which counts every use in the engine's source against `sites` below: a new use, or one
// moved, fails it until it is written here -- a table nothing checked would be the comment that asserted an invariant
// (CLAUDE.md).
//
// THE ONE TOLERANCE. Everything is a multiple of the surface tolerance at a point p, in metres:
//     marchTol(p) = max(setting, TOL_MIN_M, TOL_F32_STEPS * 2^-23 * max(|p.x|, |p.y|, |p.z|))
// the setting being UB.eps (metres, the Renderer panel's, in um) or, at 0, the automatic one: 1e-4 of the scene's
// estimated size, never coarser than 1 mm (photometry.js autoEps). THE FLOOR, TOL_F32_STEPS spacings of f32 at the point:
// 2^-23 times the largest coordinate is one to two of them there, so the floor is 128 to 256. Below about a hundred, a
// normal by differences is f32 noise and the march can stall (PLAN.md; test/floor.test.mjs measures it in an f32
// emulation); a point 1 m from the origin cannot be told apart from its neighbour 0.12 um away whatever the setting.
// What the floor is not: a shape's own arithmetic -- a sphere of 10 m through the origin is evaluated with numbers of
// 10 m wherever p is; the setting covers that.
//======================================================================================================================

export const TOL_F32_STEPS = 128
export const F32_STEP = 2 ** -23                  // 1.1920928955078125e-7: exact in f32 and in WGSL's literal
export const TOL_MIN_M = 1e-9                     // never 0: at the origin the f32 floor is
/** The floor at a point, metres (the JS twin of the shader's). */
export const f32Floor = p => TOL_F32_STEPS * F32_STEP * Math.max(Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2]))
/** The surface tolerance at a point, metres: the setting's (eps, or the automatic epsAuto when eps is 0), floored. */
export const marchTolAt = (setting, p = [0, 0, 0]) => Math.max(setting, TOL_MIN_M, f32Floor(p))

/** The shader's, generated from the constants above so the two cannot disagree (tracebasics.js ENGINE_UNITS_WGSL). */
export const MARCH_TOL_WGSL = /*wgsl*/`
        fn marchTol(p: VEC3) -> FLOAT {
            return max(max(tolSetting(), ${TOL_MIN_M}), ${TOL_F32_STEPS}.0 * ${F32_STEP} * max(abs(p.x), max(abs(p.y), abs(p.z))));
        }`

/*
 * THE TABLE. One row a use. `times`: the multiple of the tolerance at the point (marchTol), or null for a fixed length;
 * `metres`: the fixed length, or null; `unit`: the engine's ('m') or the scene's ('scene' -- the scene's own code, which
 * the boundary hands the engine's tolerance at the asked point, SCN_TOL); `sites`: file -> how many times the `pattern`
 * appears in it (comments out) -- what test/tolerances.test.mjs counts.
 */
export const TOLERANCES = [
    // ---- the engine's, at a point, in metres
    { name: 'hit test', times: 1, unit: 'm', pattern: /\blet eps = marchTol\(|\bea < marchTol\(/g,
      sites: { 'core/wavefront.js': 2, 'core/pick.js': 1 },
      why: 'A ray this near a surface has hit it: the march and the shadow rays, every step (the tolerance where the ray is); the pick, the same.' },
    { name: 'normal step', times: 1, unit: 'm', pattern: /\bnormalTol\(/g,
      sites: { 'core/wavefront.js': 1, 'core/tracebasics.js': 2, 'core/pick.js': 1 },
      why: 'The step of a normal by differences (forward in the surface kernel, central in the pick). Larger: the curvature shows; smaller than the floor: f32 noise.' },
    { name: 'leaving a surface', times: 10, unit: 'm', pattern: /\boffsetTol\([^()]*\)(?!\s*\*)/g,
      sites: { 'core/materials_pbr.js': 1, 'core/tracebasics.js': 2, 'core/wavefront.js': 1 },
      why: 'A bounce sets off along its new direction this far (and a ray leaving a surface is moved on): the next march must not find the surface it left.' },
    { name: 'two steps off', times: 20, unit: 'm', pattern: /\boffsetTol\([^()]*\)\s*\*\s*2\.0/g,
      sites: { 'core/materials_pbr.js': 4, 'core/tracebasics.js': 3, 'core/wavefront.js': 1, 'optics/kernels.js': 1 },
      why: 'Shadow rays start this far off the surface along its normal and stop this short of a light\'s face; the camera connection is lifted this high; the medium beyond is asked this far across; an emitter\'s photon starts, and a probe passes through, this far. Twice the bounce\'s: a shadow ray starts from an estimated normal.' },
    { name: 'optics source start', times: 2, unit: 'm', pattern: /2\.0 \* marchTol\(/g,
      sites: { 'optics/kernels.js': 1 },
      why: 'A light\'s ray starts this far off its own exact flat face: two hit tests, never closer at any angle (twenty put rays inside a lightguide 0.2 mm in front of a die).' },
    { name: 'emitter aim margin', times: 10, unit: 'm', pattern: /select\(offsetTol\(c\), UB\.emitMargin/g,
      sites: { 'core/wavefront.js': 1 },
      why: 'The sphere light sampling aims at round an emitter the paths found: a hit is within one tolerance of the surface, so the step off a surface covers it (emitMargin, metres, puts a fixed one back for the bench).' },
    // ---- the scene's, in its units: the engine's tolerance at the asked point (SCN_TOL), or the setting's outside a march
    { name: 'scene: its tolerance', times: 1, unit: 'scene', pattern: /\bmarchEps\(\)/g,
      // tracebasics.js: its definition and the two built on it (normalEps, offsetEps)
      sites: { 'core/tracebasics.js': 3, 'core/scene_api.js': 0, '../../builder/scenedata.js': 0,
               '../../builder/modifiers.js': 1 },
      why: 'What a scene\'s own code calls: a relief\'s band, and anything a user\'s code asks for. (Exact hits\' acceptance and the data walk\'s list and grid steps used it until 0.41.0.)' },
    { name: 'scene: culling margin', times: 10, unit: 'scene', pattern: /\bcullMargin\(\)/g,
      // scene_api.js: its definition (offsetEps); scenedata.js: the walk's culling
      sites: { 'core/scene_api.js': 1, '../../builder/codegen.js': 1, '../../builder/scenedata.js': 1 },
      why: 'A node farther than this from its box answers with the box\'s distance: always above the hit test, so the march never takes a box for a surface.' },
    // ---- fixed lengths, metres (the engine's)
    { name: 'longest march', metres: 1000, unit: 'm', pattern: /lmax = 1000\.0|ray\.ltot > 1000\.0/g,
      sites: { 'core/wavefront.js': 2, 'core/pick.js': 1 },
      why: 'A ray that has travelled 1 km of optical path has left: the march, the shadow rays, the pick.' },
    { name: 'connection overshoot', metres: 1e-4, unit: 'm', pattern: /\+ 1e-4\)/g,
      sites: { 'core/wavefront.js': 2 },
      why: 'A shadow ray that ends at a point (the camera, a light\'s face) is let past it by 0.1 mm so its last step reaches it; it is never tested there (the reached test comes first).' },
    { name: 'camera too near', metres: 1e-4, unit: 'm', pattern: /<= 1e-4/g,
      sites: { 'core/materials_pbr.js': 5 },
      why: 'A point within 0.1 mm of the camera sends it nothing through light tracing: the footprint divides by its depth.' },
    { name: 'step cache ball floor', metres: 1e-6, unit: 'm', pattern: /1\.0e-6/g,
      sites: { 'core/wavefront.js': 1 },
      why: 'A cell\'s ball is never written below 1 um; a ball moves a ray only when it holds it a whole cell ahead, so this never decides a step.' },
    { name: 'the scene\'s radius', metres: null, unit: 'm', pattern: /UB\.envRadius/g,
      sites: { 'core/wavefront.js': 5, 'core/pick.js': 2 },
      why: 'Where the scene stops and the sky begins: the scene\'s own (Scene properties), 400 m when it gives none. Sun photons start on it.' },
]

/**
 * THE TABLE RESOLVED for a scene: each row in metres and in the scene's unit, at the point `at` (metres; the origin by
 * default, where the floor is nothing) -- what RT.tolerances() returns.
 * @param u   { eps, epsAuto, sceneUnit, extent?, unit? } -- the uniform bag, or as much of it
 */
export function resolveTolerances(u, at = [0, 0, 0]) {
    const setting = (+u.eps > 0 ? +u.eps : +u.epsAuto) || 0, tol = marchTolAt(setting, at), su = +u.sceneUnit || 1
    return {
        setting: +u.eps > 0 ? 'set' : 'automatic', tolerance: tol, floorHere: f32Floor(at), at,
        rows: TOLERANCES.map(t => {
            const m = t.metres ?? (t.times != null ? t.times * tol : null)
            return { name: t.name, times: t.times ?? null, metres: m, inSceneUnits: m == null ? null : m / su, why: t.why }
        }),
    }
}

/** A length in metres as a person reads it: nm, um, mm or m. */
export const formatLength = m => !(m > 0) ? String(m)
    : m < 1e-6 ? `${+(m * 1e9).toPrecision(3)} nm` : m < 1e-3 ? `${+(m * 1e6).toPrecision(3)} µm`
    : m < 1 ? `${+(m * 1e3).toPrecision(3)} mm` : `${+m.toPrecision(4)} m`

/**
 * THE TOLERANCE IN USE, SAID: for the Render stats (core/utilities.js, a row of the Picture) and the Renderer panel's Ray
 * marching box (settingsui.js, its line) -- what it is and how it was chosen. { metres, set, v, u, n, line }: v and u
 * the number and its unit as the readout's cells take them, n what qualifies it, line the whole of it for the panel.
 * @param u      the uniform bag (eps, epsAuto, sceneUnit)
 * @param scene  the scene showing (its extent, in its unit), or null
 * @param cap    the automatic tolerance's cap, metres (photometry.js EPS_FALLBACK -- passed, not imported: photometry
 *               reaches this module through the schema, and a cycle would leave one of them half made)
 */
export function toleranceInUse(u, scene = null, cap = 1e-3) {
    const set = +u.eps > 0, m = set ? +u.eps : (+u.epsAuto || cap)
    const [v, unit] = formatLength(m).split(' ')
    const sizeM = scene?.extent > 0 ? scene.extent * (+u.sceneUnit || 1) : null
    const n = set ? 'set by hand'
        : !sizeM ? `automatic: ${formatLength(cap)}, the scene gives no size`
        : m >= cap * (1 - 1e-9) ? `automatic: the ${formatLength(cap)} cap (1e-4 of the scene's ${formatLength(sizeM)} is more)`
        : `automatic: 1e-4 of the scene's ${formatLength(sizeM)}`
    const line = `In use: ${v} ${unit}, ${n}. Never finer than f32 resolves where the ray is: ${formatLength(f32Floor([1, 0, 0]))} at 1 m from`
        + ` the origin, ${formatLength(f32Floor([0.1, 0, 0]))} at 10 cm (lib/pathtracer/PRECISION.md).`
    return { metres: m, set, v, u: unit, n, line }
}

/* RUN DIRECTLY, it prints the table: node lib/pathtracer/core/tolerances.js [tolerance in metres] */
const argv = globalThis.process?.argv
if (argv?.[1] && import.meta.url === new URL(`file://${argv[1]}`).href) {
    const tol = +argv[2] || 1e-3
    console.log(`Every tolerance and fixed length, at a tolerance of ${formatLength(tol)} (pass another in metres):\n`)
    for (const t of TOLERANCES) {
        const m = t.metres ?? (t.times != null ? t.times * tol : null)
        console.log(`${t.name.padEnd(32)} ${t.times != null ? `${t.times} x`.padEnd(7) : 'fixed  '} ${(m == null ? 'the scene\'s' : formatLength(m)).padEnd(12)} ${t.unit === 'scene' ? '(scene code)' : ''}`)
        console.log(`${''.padEnd(32)} ${t.why}`)
    }
    console.log(`\nThe tolerance at a point p is max(that, ${TOL_MIN_M} m, ${TOL_F32_STEPS} x 2^-23 x max|p|): ${formatLength(f32Floor([1, 0, 0]))} at 1 m from the origin, ${formatLength(f32Floor([10, 0, 0]))} at 10 m.`)
}
