//======================================================================================================================
// PHOTOMETRY -- the units the renderer's light is in, and the arithmetic that turns a setting into a
// uniform. Plain JS, no GPU, so node can execute every line of it: test/photometry.test.mjs.
//
// THE UNITS. The frame and accumulation buffers hold linear Rec.709 RGB whose luminance
//     Y = 0.2126 R + 0.7152 G + 0.0722 B
// is in candela per square metre. Illuminance is in lux. A colour anywhere in the settings is a
// CHROMATICITY normalised to Y = 1, times a luminance (emitters) or an illuminance (sun, sky) that
// carries the magnitude. Before this, every one of those numbers was calibrated against the one
// before it -- sun "intensity" 1.0, a sky scaled to look like the sky it replaced, emitters at 5 --
// so nothing could be measured, and the sun's disc was 21x the real one.
//
// RADIANCE DOES NOT CARE ABOUT THE SCENE UNIT. A path tracer carries radiance, which is invariant
// along a ray, and illuminance is an integral of it over solid angle -- neither has a length in
// it. So a room modelled in millimetres and the same room in metres give the same lux. The unit
// matters for numerical tolerances (march epsilon, surface offsets, how far is "left the scene"),
// and later for anything specified per length: an emitter given in lumens needs its area, an
// absorbing medium its coefficient per metre. That is why UNITS is here and not only in the
// builder.
//
// WHY THE HOST DERIVES THESE rather than the shader: the solar disc is 0.00465 rad across, and
// 1 - cos(0.00465) = 1.08e-5 is computed in f32 with a relative error near 0.5% -- and that number
// is both the sampling pdf and the disc's radiance. In double precision here it is exact, and one
// function computing it for the shader means one place to be wrong.
//======================================================================================================================

import { UniformSpec } from './uniforms.schema.js'

/** Rec.709 luminance weights. The shader's luma uses the same three numbers. */
export const LUMA = [0.2126, 0.7152, 0.0722]
export const Y = rgb => LUMA[0] * rgb[0] + LUMA[1] * rgb[1] + LUMA[2] * rgb[2]

/** Metres per scene unit. A scene's numbers are IN its unit: radius 1 in a mm scene is 1 mm. */
export const UNITS = { m: 1, cm: 0.01, mm: 0.001 }
export const unitScale = unit => UNITS[unit] ?? 1

/** The sun's tint, normalised to Y = 1 so the illuminance setting alone sets its brightness.
 *  The raw triple is the warm white the renderer has always used; its luminance is 0.964, so the
 *  old sun was that much dimmer than its own number said. */
const SUN_RGB = [1.0, 0.96, 0.9]
export const SUN_TINT = SUN_RGB.map(c => c / Y(SUN_RGB))

/** The real sun: 0.53 degrees across, seen from the ground. */
export const SUN_DIAMETER_DEG = 0.53

/**
 * The solar disc as a cone. Everything the shader needs to sample it, test membership, and
 * divide by its solid angle, in double precision.
 *   oneMinusCos  1 - cos(theta), via 2 sin^2(theta/2) -- no cancellation
 *   sin2         sin^2(theta): the membership test compares |L x S|^2 against this, which is
 *                accurate near the axis where dot(L, S) against cos(theta) is not
 *   solidAngle   2 pi (1 - cos theta), the reciprocal of the uniform-cone pdf
 */
export function sunCone(diameterDeg) {
    const half = Math.max(diameterDeg, 1e-3) * Math.PI / 360
    const s = Math.sin(half / 2)
    const oneMinusCos = 2 * s * s
    return {
        half, oneMinusCos,
        cosHalf: 1 - oneMinusCos,
        sin2: Math.sin(half) ** 2,
        solidAngle: 2 * Math.PI * oneMinusCos,
    }
}

/**
 * Luminance of a uniform disc of angular radius `half` that delivers illuminance `En` (lux) on a
 * surface facing it. Integrating L cos(angle) over the cone gives E = L pi sin^2(half) EXACTLY --
 * not L times the solid angle, which is the small-angle approximation and 0.0005% off at the real
 * sun but 1% off at a 10-degree one.
 */
export const discLuminance = (En, half) => En / (Math.PI * Math.sin(half) ** 2)

/** Illuminance the sun puts on a horizontal surface: En sin(elevation), none below the horizon. */
export const sunHorizontal = (En, elevationDeg) => En * Math.max(0, Math.sin(elevationDeg * Math.PI / 180))

/**
 * EXPOSURE IN EV100, the way a camera means it. The saturation-based sensitivity relation gives the
 * luminance that just clips as 1.2 * 2^EV100 (ISO 12232, with the 78/100 headroom folded in), so a
 * scene luminance L displays as L / that. EV 15 is a sunlit scene ("sunny 16"); EV 7 an office.
 */
export const EV_CLIP = 1.2          // luminance that clips at EV 0 is 1.2 cd/m^2 (ISO 12232 S_sat)
export const METER_K = 12.5         // reflected-light meter calibration constant (ISO 2720)
export const ev100ToScale = ev => 1 / (EV_CLIP * Math.pow(2, ev))

/** The EV100 a reflected-light meter reads for average luminance L (K = 12.5, ISO 100). It puts
 *  that luminance at about 18% of the clipping point, which is what "middle grey" means. */
export const meterEV100 = L => Math.log2(Math.max(L, 1e-9) * 100 / METER_K)

/** THE SAME TWO RELATIONS IN WGSL, generated from the constants above so the auto-exposure the GPU
 *  computes and the Meter button the host runs cannot disagree about what an EV is. */
export const EXPOSURE_WGSL = `
fn ev100ToScale(ev: f32) -> f32 { return 1.0 / (${EV_CLIP} * exp2(ev)); }
fn meterEV100(L: f32) -> f32 { return log2(max(L, 1e-9) * 100.0 / ${METER_K}); }
`

/**
 * Every derived uniform, from the settings and the two things the settings do not contain: the
 * scene's unit and the sky's raw irradiance as measured on the GPU (see prog_skynorm). `skyRaw` is
 * null until the first measurement lands; the sky is dark until then rather than wrongly bright.
 *
 * @param v  the UI state: sunIlluminance, sunDiameter, uSunElevation, skyIlluminance, exposureEV
 * @param extent  the scene's size in its own units (scene.extent), for the automatic tolerance
 * @param envRadius  the scene's radius in its own units (scene.envRadius), or nothing for 400 m
 */
/* THE AUTOMATIC SURFACE TOLERANCE, in metres: this share of the scene's size (its extent, in scene
   units, from the scene -- the builder's bounds), and NEVER COARSER THAN THE OLD FIXED 1 mm. 1e-4 of
   a 10 cm LED optic is 10 microns; a room keeps its millimetre. The cap is not caution for its own
   sake: a scene's box includes whatever big ground slab it has (Menger's is 424 m across), and 1e-4
   of that is 4 cm -- coarser than anything rendered before. So size only ever makes it finer, and
   every scene over about 10 m renders exactly as it did. A scene that does not say how big it is
   keeps the 1 mm. */
export const EPS_SHARE = 1e-4
export const EPS_FALLBACK = 1e-3
export const autoEps = (extent, unit = 'm') =>
    extent > 0 && Number.isFinite(extent) ? Math.min(Math.max(EPS_SHARE * extent * unitScale(unit), 1e-8), EPS_FALLBACK) : EPS_FALLBACK

/* WHERE THE SCENE STOPS AND THE ENVIRONMENT BEGINS (UB.envRadius, in metres, the engine's unit, as every length
   the shader takes): the SCENE's own radius, in its own units (scene.envRadius, the builder's Scene
   properties), or this when it gives none. It was a renderer setting in the Lighting group until 0.9.0 -- one
   number for every scene, so an LED optic a few centimetres big and a room shared 400 m, and the builder kept it
   in each scene's environment beside the sun. The user asked for it among the scene's own properties. 400 is
   what every scene used before (the dome sphere each declared, then the setting's default). */
export const ENV_RADIUS_DEFAULT_M = 400
export const envRadiusMetres = (envRadius, unit = 'm') =>
    envRadius > 0 && Number.isFinite(envRadius) ? envRadius * unitScale(unit) : ENV_RADIUS_DEFAULT_M

/* THE SUN'S PHOTON SQUARE AND THE EMITTER SEARCH, in METRES (the engine's unit since 0.36.0; in scene units before,
   which is what a third argument, the unit, was for): their
   settings (ltRadius, emitRadius, metres, 15 m by default), NEVER WIDER THAN THE SCENE'S RADIUS. Nothing lies beyond the radius (envRadius above), so a
   square or a grid reaching past it only spends photons and cells on nothing: a 25 cm scene inside the fixed 15 m
   square got a few of its 128 x 128 learned cells, each 23 cm, and a photon aimed at the right cell met a 1 cm lens
   about one time in 500 (0.9.0's changelog; inferred, not measured). Capped, a cell is 4 mm. EXACT EITHER WAY: the
   camera side keeps every path a photon could not have taken (ltCovers, emitCovers), so the size only moves the
   noise -- and since every scene before 0.9.0 had 400 m, the 15 m settings still decide every one of them.
   Here, in double precision, ONCE: the photon generator and the camera side's test read one number, as they must
   (THE EMISSION FRAME in sdf.js: "they must agree to the last bit"), and so do the grid's writer and its reader. */
export const photonHalf = (settingM, envRadiusM) =>
    Math.max(Math.min(Math.max(+settingM || 0, 1e-3), envRadiusM), 1e-6)

/* a colour setting as [r, g, b]: the panel's state holds {r, g, b}, a script may pass an array */
const toRGB = c => Array.isArray(c) ? c.slice(0, 3) : c && typeof c === 'object' ? [c.r ?? 0, c.g ?? 0, c.b ?? 0] : [1, 1, 1]

/** THE STUDIO LIGHT'S L0 (sdf.js skyRadiance, envMode 1): L(d) = L0 (1 + top d.z) puts
 *  E = integral over the upper hemisphere of L cos = L0 pi (1 + 2 top / 3) on a level surface
 *  facing up, so L0 = E / (pi (1 + 2 top / 3)). Per channel: the tint normalised to luminance 1. */
export function studioLuminance(E, top, rgb = [1, 1, 1]) {
    const k = Math.min(1, Math.max(0, +top || 0))
    const L0 = Math.max(0, +E || 0) / (Math.PI * (1 + 2 * k / 3))
    const y = Y(rgb)
    return y > 0 ? rgb.map(c => Math.max(0, c) / y * L0) : [0, 0, 0]
}

/* THE SKETCH LIGHT'S LEVEL when the environment gives none (lamps only, the sun down and no sky):
   a bright room's worth, so an auto-exposed Sketch looks like any other and a manual one is not black. */
export const SKETCH_FALLBACK_LX = 1000
/* THE OPTICS VIEW'S FLAT LIGHT (renderMode 3; uniforms.schema.js opticsFlat): Sketch's level times
   2^stops, and none at all from this stop down -- the lights alone. The slider's leftmost stop, so
   "off" is a place on it rather than a second control. */
export const OPTICS_FLAT_OFF = -12
export const opticsFlatShare = stops => {
    const s = Math.min(0, +stops || 0)
    return s <= OPTICS_FLAT_OFF ? 0 : Math.pow(2, s)
}

export function derive(v, { unit = 'm', skyRaw = null, extent = null, envRadius = null } = {}) {
    const cone = sunCone(v.sunDiameter ?? SUN_DIAMETER_DEG)
    /* BELOW THE HORIZON THE SUN IS OFF. It used to keep shining, with its air mass clamped at the
       horizon value, through the ground plane of any scene that did not model one. The whole disc
       has to be below, so a setting sun goes out as its top edge does, not its centre. */
    // ...and off in the furnace test's uniform environment, which replaces sun and sky alike
    // ...and in the studio environment, which has no sun
    const studio = (v.envMode | 0) === 1
    const up = (v.uSunElevation ?? 45) * Math.PI / 180 + cone.half > 0 && !((v.envUniform ?? 0) > 0) && !studio
    const En = up ? Math.max(0, v.sunIlluminance ?? 0) : 0
    const skyE = Math.max(0, v.skyIlluminance ?? 0)
    /* WHAT THE ENVIRONMENT PUTS ON A LEVEL SURFACE FACING UP, lux: the furnace's pi L, the studio's
       setting, or the sun's horizontal share plus the sky's. The Sketch view's fixed light is scaled
       to it (materials_pbr.js sketchLight), so a manual exposure set for this scene exposes Sketch too. */
    const furnace = (v.envUniform ?? 0) > 0
    const envE = furnace ? Math.PI * v.envUniform
        : studio ? Math.max(0, v.studioIlluminance ?? 1000)
        : sunHorizontal(En, v.uSunElevation ?? 45) + skyE
    return {
        /* the boundary's two factors (scene_api.js SCENE_BOUNDARY), both in double here: 1 / 0.001 is 1000 exactly */
        sceneUnit: unitScale(unit),
        perMetre: 1 / unitScale(unit),
        sunL: discLuminance(En, cone.half),
        sunOneMinusCos: cone.oneMinusCos,
        sunSin2: cone.sin2,
        sunSolidAngle: cone.solidAngle,
        skyScale: skyRaw > 0 ? skyE / skyRaw : 0,
        exposureScale: ev100ToScale(v.exposureEV ?? 15),
        /* the firefly clamp's unit (DEPOSIT in wavefront.js): the luminance the display maps to 1.0.
           This is the manual exposure's; with auto-exposure on the engine replaces it with the
           metered one each frame (R.ensureSky), since only the GPU knows that. */
        fireflyWhite: EV_CLIP * Math.pow(2, v.exposureEV ?? 15),
        epsAuto: autoEps(extent, unit),
        envRadius: envRadiusMetres(envRadius, unit),
        ltHalf: photonHalf(v.ltRadius ?? UniformSpec.ltRadius.def, envRadiusMetres(envRadius, unit)),
        emitHalf: photonHalf(v.emitRadius ?? UniformSpec.emitRadius.def, envRadiusMetres(envRadius, unit)),
        studioL: studio ? studioLuminance(v.studioIlluminance ?? 1000, v.studioTop ?? 0.5, toRGB(v.studioColor)) : [0, 0, 0],
        /* NO SUN, NO SUN SAMPLES: light sampling sends neeSunPick of its environment samples at the
           disc, and with the sun off (studio, below the horizon, the furnace) every one of those
           was a wasted shadow ray. The mixture pdf reads the same number, so this stays unbiased. */
        neeSunPick: En > 0 ? (v.neeSunPick ?? 0.5) : 0,
        /* ...dimmed in the Optics view by its own setting, so a lamp's beam is not lost in the daylight
           (v is the bag AS TRACED, quality.js effective: a measuring view is mode 0 there, and Sketch
           is never dimmed by a setting it does not show) */
        sketchE: (envE > 0 ? envE : SKETCH_FALLBACK_LX) * ((v.renderMode | 0) === 3 ? opticsFlatShare(v.opticsFlat) : 1),
    }
}
