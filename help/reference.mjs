// node help/reference.mjs
//
// THE REFERENCE PAGES, MADE FROM THE PROGRAM'S OWN LISTS: every shape (builder/primitives.js), every modifier
// (builder/modifiers.js), every material field, relief and coating (builder/materials.js), every light setting
// (builder/lights.js), every haze box setting (builder/hazebox.js). A shape's or a modifier's text is the comment its code starts with -- what its properties panel
// shows -- so it is written once. Material fields and light settings have no text of their own in the code; theirs is
// below, one a key, and test/coverage.test.mjs fails on a key with none. So a shape, modifier, field or setting
// added to the program without words fails the tests, rather than shipping undocumented -- the "second caller" this
// repository's bugs come from (CLAUDE.md).
//
// Run it after changing any of those lists; the test fails while the pages written are not what it would write.
//======================================================================================================================
import { writeFileSync, mkdirSync } from 'node:fs'
import { PRIMITIVES, SHAPE_GROUPS } from '../builder/primitives.js'
import { MODIFIERS } from '../builder/modifiers.js'
import { FIELDS, FIELD_LABELS, COAT_PRESETS, RELIEFS, PRESETS } from '../builder/materials.js'
import { LIGHT_SHAPES, LIGHT_DEFAULTS } from '../builder/lights.js'
import { HAZE_DEFAULTS, HAZE_G_MAX, KOSCHMIEDER } from '../builder/hazebox.js'

/** WHAT EACH MATERIAL FIELD DOES -- read in builder/materials.js FIELDS and lib/pathtracer/core/materials_pbr.js. */
export const FIELD_HELP = {
    baseColor: 'The surface\'s colour, linear (not sRGB): how much of each of red, green and blue it reflects -- for a metal, its reflectance head-on; for glass, the tint each crossing gives (or, with a colour depth, the colour at that depth).',
    metallic: '0 a dielectric (plastic, paint, stone, glass): white reflections over a coloured body. 1 a metal: no body, the reflection itself coloured. In between is rarely physical.',
    roughness: 'How rough the surface is at a scale too small to model: 0 a mirror-sharp reflection, 1 fully matte.',
    anisotropy: 'Roughness different along and across a direction -- brushed or turned metal. 0 the same every way; the direction is the material code\'s `m.tangent`.',
    specular: 'How strong a dielectric\'s reflection is: 0.5 the physical value for its index of refraction, 0 none at all (a pure diffuse surface), 1 twice.',
    specularTint: 'Tints a dielectric\'s reflection with its base colour: 0 white, as real plastics and paints reflect.',
    transmission: 'How much light passes into the material instead of being scattered off it: 1 glass and clear plastics, 0 everything opaque.',
    ior: 'The index of refraction, at the d line (587.6 nm): 1.5 a typical glass, 1.333 water, 1.49 PMMA, 1.586 polycarbonate. Sets how much a transparent material bends light and how strongly it reflects.',
    abbe: 'The Abbe number V_d -- how much the index changes with colour: 0 none (no dispersion), 64 a crown glass (BK7), 36 a flint, 30 polycarbonate. Lower spreads colours more. Turning it on is a compile.',
    attenuationDistance: 'The colour depth, in real mm whatever the scene\'s unit: light that has travelled this far inside has been filtered to the base colour, so a thick part is darker than a thin one. 0 off: each crossing tints by the colour, whatever the thickness. Turning it on is a compile.',
    coating: 'A thin-film coating whose reflectance replaces the surface\'s own: none, on the faces light enters by (the back anti-reflective, or bare), or on every face. Putting one on is a compile.',
    coatLow: 'The coating\'s reflectance below its edge wavelength (0..1).',
    coatHigh: 'The coating\'s reflectance above its edge wavelength (0..1).',
    coatEdge: 'Where the coating switches, in nm, head-on. At an angle it moves to shorter wavelengths, as real interference filters do.',
    coatWidth: 'How sharp the switch is: nm from 10 % to 90 % of the way.',
    coatIndex: 'The coating stack\'s effective index: how fast the edge moves with the angle -- higher moves it less.',
    emissive: 'An emitter\'s colour. Only its hue counts: the brightness is the luminance.',
    emissiveLuminance: 'An emitter\'s brightness in cd/m²: 300 a monitor, 5000 a frosted bulb, 20 000 a fluorescent tube, 1.6 billion the sun.',
}

/** WHAT EACH LIGHT SETTING DOES -- read in builder/lights.js (its header lists them). */
export const LIGHT_HELP = {
    colourBy: 'How the colour is given: as RGB, as a colour temperature (CCT, kelvin, with Duv), or as a CIE 1931 xy chromaticity -- as a datasheet gives it.',
    colour: 'The light\'s colour as linear RGB. Only its hue counts.',
    cct: 'The colour temperature in kelvin: 2700 a warm lamp, 4000 neutral, 6500 daylight.',
    duv: 'How far the colour is from the black-body line: 0 on it, positive greener, negative pinker.',
    xy: 'The CIE 1931 chromaticity, as an LED datasheet gives it.',
    luminance: 'How bright the face is, in cd/m², straight out of it. Set this or the flux: the other follows from the face\'s area.',
    flux: 'The light\'s total output in lumens. When set, the luminance follows from it and the face\'s area, so resizing the face keeps the lumens.',
    distribution: 'How the light leaves the face: cosine (cos^n -- n 1 is a Lambertian, an LED or a diffuser), uniform (the same in every direction), or collimated (one direction: a laser, or a beam from far away).',
    n: 'The cosine distribution\'s exponent: 1 Lambertian, higher a narrower beam.',
    halfAngle: 'The cone the light is limited to, in degrees from the face\'s axis: 90 the whole hemisphere.',
    twoSided: 'Both faces emit; otherwise only the front (+z), and the back is black.',
    transparent: 'Light and the camera pass through the face, which glows over what is behind it -- a sheet of light rather than a lamp\'s body.',
    emitN: 'The index of what the face emits into: 1 in air, about 1.41 for an LED die in silicone. It changes how the light refracts as it leaves.',
}

/** WHAT EACH HAZE BOX SETTING DOES -- read in builder/hazebox.js (its header lists them) and lib/pathtracer/core/haze.js. */
export const HAZE_HELP = {
    mfp: 'The mean free path, in real metres whatever the scene\'s unit: how far light goes, on average, before it meets a particle. Smaller is denser. '
        + `Visibility -- the distance at which a dark object fades to 2 % contrast, a weather report's number -- is ${KOSCHMIEDER.toFixed(2)} of these: `
        + 'clear air\'s is tens of kilometres; the dust a sunbeam shows indoors, or a stage\'s haze, far less (rough figures: '
        + 'the right value is a measurement, or the one that looks right). The panel shows the visibility beside it.',
    albedo: 'What a particle scatters of the light it meets, per channel; the rest it absorbs. 1 is white dust, 0 a black soot that only dims.',
    g: `How the particles scatter (Henyey-Greenstein's g): 0 evenly in every direction, towards 1 forward -- real dust and haze are about 0.6 to 0.8, so a beam looks brightest looking into it -- towards -1 back. Held within ±${HAZE_G_MAX}.`,
}

const firstComment = code => String(code ?? '').split('\n').filter(l => /^\s*\/\//.test(l)).map(l => l.replace(/^\s*\/\/\s?/, '')).join(' ')
    .replace(/\s+/g, ' ').trim()
const value = v => typeof v === 'number' ? String(v)
    : Array.isArray(v) ? `${v.length} points` : v && typeof v === 'object' && Array.isArray(v.path) ? `a path of ${v.path.length} points`
    : v && typeof v === 'object' ? Object.values(v).join(', ') : String(v)
const cell = s => String(s).replace(/\|/g, '\\|')
const HEAD = (title, intro) => `# ${title}\n\n> Made by \`help/reference.mjs\` from the program's own lists: edit that, not this page.\n\n${intro}\n`

function shapes() {
    let s = HEAD('Shapes', 'Every shape the **+** menu and the Library offer, by group. Each is a code node that starts as the shape: '
        + 'its parameters are in Properties, in the scene\'s unit; its code can be edited into something else. '
        + 'See [How shapes are made](../modelling/sdf.md) for what a distance function is.')
    for (const g of SHAPE_GROUPS) {
        s += `\n## ${g.label}\n\n`
        for (const [key, P] of Object.entries(PRIMITIVES)) if (P.group === g.key) {
            s += `### ${key}\n\n${firstComment(P.code)}\n\n`
            const ps = Object.entries(P.params || {})
            if (ps.length) s += `| parameter | starts at |\n|---|---|\n${ps.map(([k, v]) => `| ${k} | ${cell(value(v))} |`).join('\n')}\n\n`
        }
    }
    return s
}

function modifiers() {
    let s = HEAD('Modifiers', 'A modifier is a group that changes what is inside it: the space its children are drawn in (twist, bend, '
        + 'repeat, mirror, circular array) or the shape they make (round, shell, displace, relief). Put shapes in it; nest modifiers for more. '
        + 'Its parameters are live: dragging one compiles nothing.')
    for (const M of Object.values(MODIFIERS)) {
        s += `\n## ${M.label}\n\n${firstComment(M.code)}\n\n`
        const ps = Object.entries(M.params || {})
        // a rate or a frequency is per a length (modifiers.js perLength): no length, but a unit's change converts it too
        const len = k => M.lengths?.includes(k) ? 'yes, in the scene\'s unit' : M.perLength?.[k] ? 'no: per the scene\'s unit' : ''
        if (ps.length) s += `| parameter | starts at | a length |\n|---|---|---|\n${ps.map(([k, v]) => `| ${k} | ${cell(value(v))} | ${len(k)} |`).join('\n')}\n`
    }
    return s
}

function materials() {
    let s = HEAD('Material fields', 'What each field of a material does. Every field is live -- a slider moves the picture with no compile -- '
        + 'except where it says a compile. A material can also have code (a pattern, computed where a ray hits) and a relief '
        + '(a height on the surface, which is shape). Lengths in a material are real millimetres whatever the scene\'s unit.')
    s += '\n## Fields\n\n| field | panel label | does |\n|---|---|---|\n'
    for (const k of Object.keys(FIELDS)) s += `| ${k} | ${cell(FIELD_LABELS[k] ?? k)} | ${cell(FIELD_HELP[k] ?? '')} |\n`
    s += `\n## Starting points\n\nThe Properties panel's **+** makes a material from one of these: ${Object.values(PRESETS).map(p => `*${p.label}*`).join(', ')}. `
        + 'The Library has many more, with real values.\n'
    s += '\n## Coating presets\n\n' + Object.entries(COAT_PRESETS).map(([k, v]) => `- **${k}**: ${Object.entries(v).map(([f, x]) => `${FIELD_LABELS[f] ?? f} ${x}`).join(', ')}`).join('\n') + '\n'
    s += '\n## Reliefs\n\nA relief is a height on every object wearing the material, in real mm -- part of the shape, so it shows in the '
        + 'silhouette, and paid for at every march step near the object.\n\n'
    for (const R of Object.values(RELIEFS)) s += `### ${R.label}\n\n${firstComment(R.code)}\n\n`
    return s
}

function lights() {
    let s = HEAD('Light settings', 'A light object is a flat rectangle or disc that emits from its front (+z), or a ray file\'s rays. Its size '
        + 'is its parameters; the rest is here. ' + Object.values(LIGHT_SHAPES).map(v => `*${v.label}*`).join(', ') + '.')
    s += '\n| setting | starts at | does |\n|---|---|---|\n'
    for (const [k, v] of Object.entries(LIGHT_DEFAULTS)) s += `| ${k} | ${cell(v == null ? '(not set)' : value(v))} | ${cell(LIGHT_HELP[k] ?? '')} |\n`
    return s
}

function haze() {
    let s = HEAD('Haze box settings', 'A haze box (the **+** menu, *Haze box*) fills the air inside it with dust that scatters and absorbs light: '
        + 'beams show in it, the sun\'s shafts, a lamp\'s glow; what is seen through it is dimmer. Only the air inside scatters -- glass, '
        + 'water and solids inside the box stay clear. Its size is its `size` parameter, in the scene\'s unit (the Transform gizmo\'s cubes '
        + 'stretch it); one a scene. See [Render settings](../modelling/rendering.md#dust-in-the-air) for how it is drawn and what a small '
        + 'scene can show.')
    s += '\n| setting | starts at | does |\n|---|---|---|\n'
    for (const [k, v] of Object.entries(HAZE_DEFAULTS)) s += `| ${k} | ${cell(value(v))} | ${cell(HAZE_HELP[k] ?? '')} |\n`
    return s
}

/** Every reference page: { file (under help/): text }. */
export const referencePages = () => ({
    'reference/shapes.md': shapes(),
    'reference/modifiers.md': modifiers(),
    'reference/materials.md': materials(),
    'reference/lights.md': lights(),
    'reference/haze.md': haze(),
})

if (import.meta.url === `file://${process.argv[1]}`) {
    const dir = new URL('./', import.meta.url)
    mkdirSync(new URL('reference/', dir), { recursive: true })
    for (const [file, text] of Object.entries(referencePages())) { writeFileSync(new URL(file, dir), text); console.log(file) }
}
