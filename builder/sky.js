//======================================================================================================================
// THE SKY IN CODE (0.next; the renderer's side is lib/pathtracer/core/sdf.js THE SKY IN CODE).
//
// The user (2026-11-16): "Could the sun-sky be shown and edited as a code block too? Say I want a completely different
// background -- for instance the star fractal" of an old shader of theirs.
//
// SO IT IS THE SCENE'S, as its functions block is: `doc.sky`, WGSL text that defines `fn background(dir: VEC3) -> VEC3`,
// edited under the scene row's environment when its source is 'sky in code' (envMode 2). It starts as the scattering
// model the 'sun & sky' source draws (SKY_TEMPLATE), written out to be read and changed; SKY_PRESETS has it and the
// stars. The sun is not in it: the disc stays its own light, set by the sun's rows as before.
//
// WHERE IT IS COMPILED. In the scene's text for the builder's check (codegen.js THE SKY), after everything the kernels
// compile, so its errors are listed at its own lines and the scene's kernels never see it; and into the shade kernel
// alone (scene.sky), which holds no scene -- so it reaches only the prelude's functions and the environment's settings
// (UB.uSkyTurbidity, sunDirection()), never the functions block or a parameter (skyProblems says so before a compile).
// A change to it compiles shade alone; the other kernels come from the pipeline cache.
//
// NO FILE VERSION: as `environment` (model.js THE ENVIRONMENT), a top-level key a builder that predates it passes through
// untouched; such a builder refuses the file's envMode 2 by its own options, which is a refusal and not a wrong picture.
//======================================================================================================================
import { helpersOf, withoutComments } from './helpers.js'

/** Whose lines the block's are, in the check's messages (codegen.js THE SKY): no id a node can have (ids are letters
 *  and digits), as the environment's row '#environment' is not -- so a node called sky is still a node. */
export const SKY_ID = '#sky'

/** The function the block defines (the renderer's sdf.js SKY_CODE_FN: the two must agree). */
export const SKY_FN = 'background'

/** The 'sun & sky' source's scattering model, written out (sdf.js skyRadianceRaw), scaled so the default sun -- 45
 *  degrees up, turbidity 0.7 -- puts the setting's lux on a level surface: its raw sky gives 0.1193 lx there (the
 *  integral prog_skynorm takes, done in a double-precision JS copy of the model on a 512 x 512 grid; not measured on a
 *  GPU), and 1.0 everywhere gives pi, so the factor is pi / 0.1193 = 26.33. At another sun it is not re-measured, as the
 *  'sun & sky' source is: there the lux follow the code. */
export const SKY_TEMPLATE = [
    '// The sky in code: what a ray that leaves the scene sees, and what lights it from beyond it.',
    '// Define  fn background(dir: VEC3) -> VEC3 :  dir a unit direction, z up; the sun\'s azimuth is from +y towards +x.',
    '// It returns light: 1.0 in every direction would put the "Sky (lx at 1.0)" setting\'s lux on a level surface.',
    '// The sun\'s disc is not in it -- it is its own light (the Sun rows above; 0 lx turns it off).',
    '// Read: sunDirection() (towards the sun), UB.uSkyTurbidity (the slider) and the prelude\'s functions (noise and more).',
    '// Not: the scene\'s functions block or its parameters -- the sky is compiled without them.',
    '// Changing this compiles one kernel (Apply); the sliders are live.',
    '//',
    '// Below: the sun & sky model itself -- single scattering, Rayleigh and Mie -- as the "sun & sky" source draws it.',
    'fn background(dir: VEC3) -> VEC3 {',
    '    let betaR = VEC3(0.175, 0.410, 1.0);   // Rayleigh scattering per channel, ~ 1 / wavelength^4: why the sky is blue',
    '    let betaM = VEC3(0.06 * (0.5 + max(UB.uSkyTurbidity, 0.0)));   // Mie: the haze, grey, more with turbidity',
    '    let g = 0.76;                          // Mie\'s forward scattering: the glow round the sun',
    '    let s = sunDirection();',
    '    let cosT = clamp(dot(dir, s), -1.0, 1.0);   // the angle between where we look and the sun',
    '    let phaseR = 3.0 / (16.0 * PI) * (1.0 + cosT * cosT);',
    '    let phaseM = (1.0 - g * g) / (4.0 * PI * pow(max(1.0 + g * g - 2.0 * g * cosT, 1e-4), 1.5));',
    '    // how much air the view and the sunlight cross: more near the horizon, which whitens it and reddens a low sun',
    '    let air = airMass(max(dir.z, 0.0)) + airMass(max(s.z, 0.0));',
    '    let betaT = betaR + betaM;',
    '    let scattered = (betaR * phaseR + betaM * phaseM) / betaT * (VEC3(1.0) - exp(-betaT * air * 0.35));',
    '    return scattered * 26.33;              // at the default sun, the setting\'s lux: 15000, the "sun & sky" default',
    '}',
    '',
].join('\n')

/** STARS: the Kali set (p -> |p| / |p|^2 - 0.53) sampled ten steps along each direction -- the user's 2D shader of
 *  2022 (KABOOM), whose rays were the screen's: here they are the sky's own directions, so it wraps the sphere without
 *  a seam and stays put as the camera turns. Its output clamped to 1, as the original's was by the screen: unclamped, a
 *  direction near the set's poles gives up to 1e10 (a JS copy over 4000 directions), every one a firefly in what the
 *  sky lights. */
export const STARS_TEMPLATE = [
    '// Stars: a fractal (the Kali set, p -> |p| / |p|^2 - 0.53) sampled ten steps along each direction.',
    '// Define  fn background(dir: VEC3) -> VEC3 :  dir a unit direction, z up. 1.0 is the "Sky (lx at 1.0)" setting.',
    '// For a night sky, set the Sun to 0 lx above. Changing this compiles one kernel (Apply); the sliders are live.',
    'const STAR_DEPTH = 17;                     // the fractal\'s iterations: more is finer and brighter, and slower',
    'const STAR_ZOOM = 2.0;                     // how far into the fractal a direction reaches: more is smaller stars',
    'const STAR_SHIFT = VEC3(0.0, 0.0, 0.0);    // move through the fractal: another sky',
    '',
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
    '',
    'fn background(dir: VEC3) -> VEC3 {',
    '    let d = dir * STAR_ZOOM;',
    '    let start = VEC3(0.1, 1.1, 0.05) + STAR_SHIFT;',
    '    var v = VEC3(0.0);',
    '    for (var r = 0.0; r < 10.0; r += 1.0) {',
    '        // each step deeper is dimmer and redder',
    '        v += pow(0.7, r) * (0.5 + VEC3(1.0, r * 0.4, r * r * 0.1) * kaliStars(start + r * d * 0.05));',
    '    }',
    '    v = mix(VEC3(length(v)), v, 0.7) / 1e8;   // a little less colour, and to about 0..1',
    '    // clamped as a screen clamps: unclamped a few directions reach 1e10, and each would be a firefly in the scene',
    '    return clamp(pow(v, VEC3(3.0)), VEC3(0.0), VEC3(1.0));',
    '}',
    '',
].join('\n')

/** What the panel offers to start the block from. */
export const SKY_PRESETS = [
    { id: 'sunsky', label: 'sun & sky (the model)', code: SKY_TEMPLATE },
    { id: 'stars', label: 'stars (Kali fractal)', code: STARS_TEMPLATE },
]

/** Whether the block has code beyond comments: a scene without is the text it was (codegen.js THE SKY). */
export const hasSky = text => !!withoutComments(text ?? '').trim()

/** What is wrong with a sky block as text, as lines (none: it is sound). `functions` is the scene's functions block:
 *  the sky is compiled without it (shade holds no scene), so a name of it the sky reads and does not define itself
 *  would compile in the builder's check and fail in the kernel -- said here instead. */
export function skyProblems(text, functions = '') {
    if (text == null) return []
    if (typeof text !== 'string') return ['sky must be a string of WGSL']
    if (!hasSky(text)) return []
    const own = helpersOf(text)
    const p = []
    if (!own.some(x => x.kind === 'fn' && x.name === SKY_FN)) p.push(`sky: the block must define fn ${SKY_FN}(dir: VEC3) -> VEC3`)
    const mine = new Set(own.map(x => x.name))
    const body = withoutComments(text)
    for (const h of helpersOf(functions)) {
        if (mine.has(h.name) || !new RegExp(`\\b${h.name}\\b`).test(body)) continue
        p.push(`sky: '${h.name}' is the functions block's, and the sky is compiled without it -- copy it into the sky's block`)
    }
    return p
}
