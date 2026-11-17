import { XYZtoRGB } from './colorimetry.js'
import { CIE_X, CIE_Y, CIE_Z, CIE_LO } from './cie1931.js'
import { LUMA } from './photometry.js'

/*======================================================================================================================
  THE ENVIRONMENT IS CODE (0.next; the user, 2026-11-17: "everything as physically correct as possible", the background
  model returning cd/m^2; the code block holding "the exact model", only the sun's place and size a parameter that NEE
  and the rest use; "rays that leave the environment get the colour of the background").

  ONE FUNCTION, background(dir: VEC3) -> VEC3: the luminance, in cd/m^2 per channel (linear Rec.709), of what lies
  beyond the scene in the unit direction dir (z up). Everything a ray that leaves sees, and everything the environment
  lights the scene with: the sky, the sun's disc in it, stars, a studio's light, a photograph -- whatever the code says.
  The renderer does not add to it or scale it. It asks it in three places only (sdf.js THE ENVIRONMENT):
    - an escaped ray, and a light sample aimed at the environment (the shade kernel);
    - a sun photon, whose power is the code's light in the sun's cone (genphotons);
    - the map that tells light sampling where the environment is bright (prog_envbake; envmap below).

  THE SUN IS A HINT, NOT A LIGHT OF ITS OWN: a cone, its place (uSunAzimuth, uSunElevation) and its size (sunDiameter),
  with sunHint saying whether there is one to aim at. Light sampling sends a share of its samples into it, its photons
  start in it, and the camera's paths leave it to the photons -- every one of them weighing what background() returns
  there. A code whose sun is elsewhere, or that has none, is still traced right: the cone then holds sky, sampled twice
  as often as it needs. Its place is read by the code too (sunDirection(), inSunDisc()), so the disc the code draws and
  the cone the renderer aims at are one.

  THESE PRESETS ARE THE MODEL. A scene without code of its own (every scene a host other than the builder shows: the
  library's studio, the bench, the Tests panel's) gets ENV_DEFAULT, which is the sun & sky and the studio below with
  envMode choosing; the builder's code block starts from the same text. There is no second copy to drift.
======================================================================================================================*/

/** The function the environment's code defines. */
export const ENV_FN = 'background'

/* IN SIXTEEN BANDS OF THE SPECTRUM, 380 to 730 nm, then to RGB. The atmosphere's colour is a spectral effect -- Rayleigh
   goes as 1 / wavelength^4 -- and doing it at three wavelengths, one a channel, got it wrong both ways: against the same
   model integrated at every nanometre with the CIE 1931 functions (a JS check, 2026-11-17), the zenith at 45 degrees came
   out 8100 K where the spectrum gives 9300, and the sun 5070 K where it gives 4830. Sixteen bands, each its sunlight's
   share in linear Rec.709 (its XYZ integrated over the band through the CIE's own table, cie1931.js), come within 30 K of
   it at the zenith and the sun from 45 degrees down to 5 (the same check; 8 bands were 90 K off, 24 no better than 16). */
export const SKY_BANDS = 16
export const SKY_BAND_LO = 380, SKY_BAND_HI = 730
/** Rayleigh optical depth of the whole atmosphere straight up at a wavelength in micrometres -- Hansen & Travis (1974),
 *  Space Sci. Rev. 16, eq. 2.29: 0.008569 l^-4 (1 + 0.0113 l^-2 + 0.00013 l^-4), at sea level. */
export const rayleighDepth = um => 0.008569 * um ** -4 * (1 + 0.0113 * um ** -2 + 0.00013 * um ** -4)
/* AEROSOL: Angstrom's law, depth proportional to wavelength^-1.3, scaled from 550 nm. The depth at 550 nm is 0.05 + 0.1
   x turbidity -- 0.12 at the default 0.7, a clear day's; 0.45 at 4, hazy. A choice that matches the old slider's range in
   feel, not a measured relation to any other definition of turbidity. */
export const angstrom = nm => (nm / 550) ** -1.3
/** Planck's law at 5778 K, the sun's effective temperature, in arbitrary units: the sunlight above the air. */
const C2 = 1.438776877e-2
const sun5778 = nm => { const m = nm * 1e-9; return 1 / (m ** 5 * (Math.exp(C2 / (m * 5778)) - 1)) }
/** The bands: { nm, tauR, haze, rgb } -- nm the band's middle weighted by its light, tauR the Rayleigh depth and haze the
 *  Angstrom factor there, rgb its share of the sunlight in linear Rec.709, the sixteen summing to luminance 1. */
export const SKY_BAND_TABLE = (() => {
    const step = (SKY_BAND_HI - SKY_BAND_LO) / SKY_BANDS, out = []
    for (let k = 0; k < SKY_BANDS; k++) {
        let X = 0, Y = 0, Z = 0, wl = 0, ws = 0
        for (let l = SKY_BAND_LO + k * step; l < SKY_BAND_LO + (k + 1) * step; l += 1) {
            const i = Math.round(l) - CIE_LO, w = sun5778(l)
            X += w * CIE_X[i]; Y += w * CIE_Y[i]; Z += w * CIE_Z[i]
            const ww = w * (CIE_X[i] + CIE_Y[i] + CIE_Z[i])
            wl += ww * l; ws += ww
        }
        out.push({ nm: wl / ws, rgb: XYZtoRGB([X, Y, Z]) })
    }
    const total = out.reduce((a, b) => a.map((x, c) => x + b.rgb[c]), [0, 0, 0])
    const Yt = LUMA[0] * total[0] + LUMA[1] * total[1] + LUMA[2] * total[2]
    return out.map(b => ({ nm: b.nm, tauR: rayleighDepth(b.nm / 1000), haze: angstrom(b.nm), rgb: b.rgb.map(x => x / Yt) }))
})()
/** Sunlight above the atmosphere, normalised to luminance 1: the bands' sum, a 5778 K white. */
export const SUN_OUTSIDE_TINT = SKY_BAND_TABLE.reduce((a, b) => a.map((x, c) => x + b.rgb[c]), [0, 0, 0])

const v3 = a => `VEC3(${a.map(x => x.toFixed(6)).join(', ')})`

/* THE SUN AND SKY, PHYSICALLY. Sunlight of sunOutside lux above the atmosphere, a 5778 K white, comes down through
   air (Rayleigh) and aerosol (Mie, Henyey-Greenstein g 0.7, single-scattering albedo 0.9). The disc is what is left of
   it after the air on its way down (Beer-Lambert over the air mass the sun's light crosses), spread over the disc.
   The sky is that light scattered ONCE towards the eye: for a plane-parallel atmosphere in which both kinds of
   scatterer are mixed alike, light scattered at optical depth t on the way down the view's path arrives with
   exp(-t ms - (tau - t) mv), and the sum over the column is

       L = E0 (w P) mv (exp(-tau ms) - exp(-tau mv)) / (mv - ms)       (tau mv exp(-tau mv) where mv = ms)

   with w P the scattering phase per unit optical depth, mixed by the two depths -- the textbook single-scattering
   result. NOT IN IT: multiple scattering (the shadows' sky is a little dark and too blue), ozone (the Chappuis band
   makes the twilight sky bluer), the ground's light coming back, twilight (the sun below the horizon lights nothing
   here: the sky fades out over its last 3 degrees). Below the horizon the "sky" is what the horizon's air gives, as
   the old model had it: a scene brings its own ground.

   AT THE DEFAULTS (sun 45 degrees up, turbidity 0.7, 128 klx outside): 95 klx direct from the sun, 12 klx from the
   sky on a level surface, the sun about 4850 K and the zenith about 9300 K -- a JS copy of this text, integrated on a
   250 x 250 grid (builder/test/sky.test.mjs holds the copy to the text, and its colours to the same model integrated
   at every nanometre). A clear day's measured figures are 80-110
   klx and 10-20 klx. 128 klx is the solar illuminance above the atmosphere (the solar constant times the sun's
   luminous efficacy, about 93 lm/W: CIE and Darula et al. 2005 give 127.5-133.8 klx). */
const f6 = x => x.toFixed(6)
const SUNSKY_FN = [
    '// THE SUN AND SKY: sunlight through a clear atmosphere, scattered once by the air (Rayleigh) and by haze (Mie).',
    '// Returns luminance in cd/m^2. Reads sunDirection() and UB.sunSin2 (the sun\'s place and size, the hint light',
    '// sampling aims at), UB.sunOutside (lx above the atmosphere) and UB.uSkyTurbidity. Worked out in 16 bands of the',
    '// spectrum, 380 to 730 nm, and added up as colour: the sky\'s blue and a low sun\'s red are the spectrum\'s.',
    `const SKY_BANDS = ${SKY_BANDS};`,
    '// the bands\' middles (nm, weighted by their light): ' + SKY_BAND_TABLE.map(b => b.nm.toFixed(0)).join(', '),
    '// Rayleigh depth straight up at each (Hansen & Travis 1974)',
    `const SKY_BAND_TAUR = array<f32, ${SKY_BANDS}>(${SKY_BAND_TABLE.map(b => f6(b.tauR)).join(', ')});`,
    '// haze\'s depth at each, per unit of its depth at 550 nm (Angstrom, exponent 1.3)',
    `const SKY_BAND_HAZE = array<f32, ${SKY_BANDS}>(${SKY_BAND_TABLE.map(b => f6(b.haze)).join(', ')});`,
    '// each band\'s share of the 5778 K sunlight above the air, as linear Rec.709 (CIE 1931); the 16 sum to luminance 1',
    `const SKY_BAND_RGB = array<VEC3, ${SKY_BANDS}>(${SKY_BAND_TABLE.map(b => `VEC3(${b.rgb.map(f6).join(', ')})`).join(',\n    ')});`,
    'fn sunSky(dir: VEC3) -> VEC3 {',
    '    var tauR = SKY_BAND_TAUR;                     // copies, so the loop may index them',
    '    var haze = SKY_BAND_HAZE;',
    '    var rgb = SKY_BAND_RGB;',
    '    let s = sunDirection();',
    '    let aerosol = 0.05 + 0.1 * max(UB.uSkyTurbidity, 0.0);   // haze\'s depth at 550 nm',
    '    let mv = airMass(max(dir.z, 0.0));            // how much air the view crosses (1 straight up)',
    '    let ms = airMass(max(s.z, 0.0));              // ...and the sunlight on its way down',
    '    // the disc: the sunlight the air has let through, spread over the disc -- none once the sun has set',
    '    let disc = inSunDisc(dir) && s.z > -sqrt(UB.sunSin2);',
    '    let c = dot(dir, s);',
    '    let g = 0.7;',
    '    let phaseR = 3.0 / (16.0 * PI) * (1.0 + c * c);',
    '    let phaseM = (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * c, 1.5));',
    '    let up = clamp((s.z + 0.05) / 0.05, 0.0, 1.0);   // the sun\'s last 3 degrees below the horizon: fading out',
    '    let dm = mv - ms;',
    '    var L = VEC3(0.0);',
    '    for (var k = 0; k < SKY_BANDS; k++) {',
    '        let tr = tauR[k];',
    '        let ta = aerosol * haze[k];',
    '        let tau = tr + ta;',
    '        var v = 0.0;',
    '        if (disc) {',
    '            v = exp(-tau * ms) / (PI * UB.sunSin2);',
    '        } else {',
    '            // that light scattered once towards us, over the whole depth of the air',
    '            let k1 = select(mv * (exp(-tau * ms) - exp(-tau * mv)) / select(dm, 1.0, abs(dm) < 1e-3),',
    '                            tau * mv * exp(-tau * mv), abs(dm) < 1e-3);',
    '            v = (tr * phaseR + 0.9 * ta * phaseM) / tau * k1 * up;',
    '        }',
    '        L += rgb[k] * v;',
    '    }',
    '    return max(max(UB.sunOutside, 0.0) * L, VEC3(0.0));',
    '}',
].join('\n')

/* THE STUDIO: L0 (1 + top z), L0 chosen so a level surface facing up receives studioIlluminance lux --
   E = integral of L cos over the upper hemisphere = L0 pi (1 + 2 top / 3) -- in the studio colour, normalised to
   luminance 1 so the colour does not change the lux. No sun: the hint is off with it. */
const STUDIO_FN = [
    '// THE STUDIO: an even light from every direction, brighter above. A level surface facing up receives',
    '// UB.studioIlluminance lux whatever UB.studioTop is (0 flat, 1 none from straight below), in UB.studioColor.',
    'fn studioLight(dir: VEC3) -> VEC3 {',
    '    let top = clamp(UB.studioTop, 0.0, 1.0);',
    '    let L0 = max(UB.studioIlluminance, 0.0) / (PI * (1.0 + 2.0 * top / 3.0));',
    '    let tint = max(UB.studioColor, VEC3(0.0)) / max(dot(max(UB.studioColor, VEC3(0.0)), LUMA_709), 1e-6);',
    '    return tint * L0 * max(1.0 + top * dir.z, 0.0);',
    '}',
].join('\n')

/* STARS: the Kali set (p -> |p| / |p|^2 - 0.53) sampled ten steps along each direction -- the user's 2D shader of 2022
   (KABOOM), whose rays were the screen's: here they are the sky's own directions, so it wraps the sphere without a
   seam and stays put as the camera turns. Its 1.0 is STAR_CD cd/m^2: the brightest stars' luminance, an artistic
   choice (the real night sky is about 1e-3 cd/m^2 between the stars). The peaks are held at STAR_PEAK: a few
   directions near the set's poles give up to 1e10 (a JS copy over 4000 directions), a light no map can find. */
const STARS_FN = [
    '// STARS: a fractal (the Kali set, p -> |p| / |p|^2 - 0.53) sampled ten steps deep along each direction.',
    'const STAR_DEPTH = 17;                   // the fractal\'s iterations: more is finer and brighter, and slower',
    'const STAR_ZOOM = 2.0;                   // how far into the fractal a direction reaches: more is smaller stars',
    'const STAR_SHIFT = VEC3(0.0, 0.0, 0.0);  // move through the fractal: another sky',
    'const STAR_CD = 5000.0;                  // cd/m^2 of the brightest stars (1.0 below)',
    'const STAR_PEAK = 20.0;                  // the few singular points held to this, x STAR_CD',
    'fn kaliStars(q: VEC3) -> f32 {',
    '    var p = q;',
    '    var a = 0.0;',
    '    var b = 0.0;',
    '    for (var i = 0; i < STAR_DEPTH; i++) {',
    '        p = abs(p) / dot(p, p) - 0.53;',
    '        let l = length(p);',
    '        a += abs(l - b);',
    '        b = l;',
    '    }',
    '    return pow(a, 5.0);',
    '}',
    'fn stars(dir: VEC3) -> VEC3 {',
    '    let d = dir * STAR_ZOOM;',
    '    let start = VEC3(0.1, 1.1, 0.05) + STAR_SHIFT;',
    '    var v = VEC3(0.0);',
    '    for (var r = 0.0; r < 10.0; r += 1.0) {',
    '        // each step deeper is dimmer and redder',
    '        v += pow(0.7, r) * (0.5 + VEC3(1.0, r * 0.4, r * r * 0.1) * kaliStars(start + r * d * 0.05));',
    '    }',
    '    v = mix(VEC3(length(v)), v, 0.7) / 1e8;   // a little less colour; the brightest stars near 1',
    '    return clamp(pow(v, VEC3(3.0)), VEC3(0.0), VEC3(STAR_PEAK)) * STAR_CD;',
    '}',
].join('\n')

const header = lines => lines.map(l => `// ${l}`).join('\n')
const COMMON = [
    'The environment: fn background(dir: VEC3) -> VEC3 returns the luminance (cd/m^2, linear RGB) seen in the unit',
    'direction dir (z up; the sun\'s azimuth is from +y towards +x). It is both what a ray leaving the scene sees and the',
    'light the environment casts. The sun rows place a cone light sampling aims at (sunDirection(), inSunDisc(dir));',
    'the code says what is in it. Reads: UB.<setting> for the environment\'s rows, and the prelude\'s functions (noise,',
    'airMass ...): Help > Reference > Functions for code. Not the scene\'s functions block or its parameters.',
]

/** A preset: { id, label, sunHint, text } -- `text` the whole block, as the builder's code box starts. */
const preset = (id, label, sunHint, intro, fn, body) => ({
    id, label, sunHint,
    text: `${header([...intro, '', ...COMMON])}\n\n${fn}\n\nfn ${ENV_FN}(dir: VEC3) -> VEC3 {\n${body}\n}\n`,
})
/* AN IMAGE (core/envimage.js): the scene's equirectangular picture, its numbers times UB.envImageLuminance cd/m^2, turned
   by UB.envImageTurn. No sun hint: a sun in the picture is found by the map light sampling draws from (core/envmap.js);
   one who wants its shadows sharper sets the hint where the picture's sun is. */
const IMAGE_FN = [
    '// THE IMAGE: the scene\'s picture of its surroundings, equirectangular (360 x 180 degrees), its middle towards +x and',
    '// its top straight up; envImage(dir) gives its own numbers, linear, in direction dir (turned by UB.envImageTurn).',
    '// 1.0 is UB.envImageLuminance cd/m^2: 179 for a calibrated Radiance .hdr (its lm/W), a daylight sky\'s 5000 at a',
    '// photograph\'s white.',
]
export const ENV_PRESETS = [
    preset('sunsky', 'sun & sky', 1, ['SUN & SKY: daylight, the sun where the sun rows put it.'], SUNSKY_FN, '    return sunSky(dir);'),
    preset('studio', 'studio', 0, ['STUDIO: an even light, brighter above, no sun.'], STUDIO_FN, '    return studioLight(dir);'),
    preset('stars', 'stars', 0, ['STARS: a fractal night sky (a 2022 KABOOM shader). Set no sun: the sun rows\' "sampled" off.'], STARS_FN, '    return stars(dir);'),
    preset('image', 'image…', 0, ['IMAGE: a panorama of the surroundings, as CAD and render programs light with (HDRI).'], IMAGE_FN.join('\n'),
        '    return envImage(dir) * UB.envImageLuminance;'),
]
export const envPreset = id => ENV_PRESETS.find(p => p.id === id)

/** WHAT A SCENE WITHOUT CODE OF ITS OWN IS LIT BY: the sun & sky, or with envMode 1 the studio -- the presets' own
 *  functions, so the default and the code box's starts are one text. */
export const ENV_DEFAULT = [
    '// THE DEFAULT ENVIRONMENT (core/environment.js): the sun & sky, or with envMode 1 the studio.',
    SUNSKY_FN, '', STUDIO_FN, '',
    `fn ${ENV_FN}(dir: VEC3) -> VEC3 {`,
    '    if (UB.envMode == 1u) { return studioLight(dir); }',
    '    return sunSky(dir);',
    '}',
    '',
].join('\n')

/** The code a scene is lit by: its own, or the default. */
export const envCodeOf = scene => (typeof scene?.sky === 'string' && scene.sky.trim()) ? scene.sky : ENV_DEFAULT
