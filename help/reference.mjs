// node help/reference.mjs
//
// THE REFERENCE PAGES, MADE FROM THE PROGRAM'S OWN LISTS: every shape (builder/primitives.js), every modifier
// (builder/modifiers.js), every material field, relief and coating (builder/materials.js), every light setting
// (builder/lights.js), every haze box setting (builder/hazebox.js), the functions code can call (the scene prelude: CODE_HELP
// below), and the functions a scene's script can call (tools/scriptref.js, which tools/test/script.test.mjs holds to the API). A shape's or a modifier's text is the comment its code starts with -- what its properties panel
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
import { FIELDS, FIELD_LABELS, COAT_PRESETS, RELIEFS, PRESETS, FEATURES, pictureRelief, PICTURE_RELIEF_LABEL } from '../builder/materials.js'
import { LIGHT_SHAPES, LIGHT_DEFAULTS } from '../builder/lights.js'
import { HAZE_DEFAULTS, HAZE_G_MAX, KOSCHMIEDER } from '../builder/hazebox.js'
import { codeOnly } from '../builder/codegen.js'
import { SLOT_DEFAULTS, SLOT_HELP, IMAGE_TYPES } from '../builder/images.js'
import { IMAGE_MAX_EDGE } from '../lib/pathtracer/core/images.js'
import { referenceMarkdown as scriptReference } from '../tools/scriptref.js'
import { TOKENS, SHORT_TOKENS } from '../lib/wgsl_shorthand.js'

export { FIELD_HELP, CODE_HELP, CODE_SHAPED, CODE_UNLISTED, CODE_MADE, preludeSignatures } from '../builder/coderef.js'
import { FIELD_HELP, CODE_HELP, CODE_MADE, preludeSignatures, typeWords, CODE_BLOCKS, MATERIAL_SETS, MATERIAL_CANNOT, recipeText } from '../builder/coderef.js'

/** WHAT EACH LIGHT SETTING DOES -- read in builder/lights.js (its header lists them). */
export const LIGHT_HELP = {
    colourBy: 'How the colour is given: as RGB, as a colour temperature (CCT, kelvin, with Duv), as a CIE 1931 xy chromaticity -- as a datasheet gives it -- or by its spectrum. A ray file has two more, the first its default: from the file (a file with a wavelength on every ray lights the picture in each ray\'s own colour; one without is white) and at its header\'s wavelength (every ray at that one wavelength: outside what the eye sees, such as an 850 nm infrared LED, it lights nothing in the picture). Any of the other four colours every ray of the file alike.',
    colour: 'The light\'s colour as linear RGB. Only its hue counts.',
    cct: 'The colour temperature in kelvin: 2700 a warm lamp, 4000 neutral, 6500 daylight.',
    duv: 'How far the colour is from the black-body line: 0 on it, positive greener, negative pinker.',
    xy: 'The CIE 1931 chromaticity, as an LED datasheet gives it.',
    spectrum: 'The light\'s spectrum, for colour by spectrum: a blackbody at a temperature, Gaussian peaks (one line each: nm, FWHM in nm, share of the power -- one for a single-colour LED, a blue die and a broad phosphor hump for a white one), or a measured table of nm against relative power, pasted or loaded from a CSV. Its colour is exactly what the CIE 1931 observer\'s table makes of it, carried as a chromaticity is; the panel also says its luminous efficacy of radiation (lm per radiated W). The presets are models, not datasheets.',
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
    s += '\n## Optical features\n\nThe scene\'s [optical features](../modelling/materials.md#optical-features) decide which of these a '
        + 'scene has. With one off, its fields are not shown or traced, and their values are kept.\n\n| feature | fields | does |\n|---|---|---|\n'
    for (const f of Object.values(FEATURES)) s += `| ${cell(f.label)} | ${f.fields.map(k => cell(FIELD_LABELS[k] ?? k)).join(', ') || '(none: the trace itself)'} | ${cell(f.help)} |\n`
    s += `\n## Starting points\n\nThe Properties panel's **+** makes a material from one of these: ${Object.values(PRESETS).map(p => `*${p.label}*`).join(', ')}. `
        + 'The Library has many more, with real values.\n'
    s += '\n## Coating presets\n\n' + Object.entries(COAT_PRESETS).map(([k, v]) => `- **${k}**: ${Object.entries(v).map(([f, x]) => `${FIELD_LABELS[f] ?? f} ${x}`).join(', ')}`).join('\n') + '\n'
    s += '\n## Image textures\n\nA material can show image textures (' + IMAGE_TYPES.map(t => t.slice(6).toUpperCase()).join(', ') + ', up to '
        + `${IMAGE_MAX_EDGE} pixels on the longer side; a larger one is scaled down), each placed on every object wearing it by a projection in `
        + 'the object\'s [pattern frame](../modelling/materials.md#turning-a-pattern-the-pattern-frame). One can be the material\'s colour; '
        + 'the others are for its code (`sample(name)`: [Functions for code](code.md#a-materials-image-textures)). Every setting is live but the '
        + 'image itself, its name and its use: a compile. See [Image textures](../modelling/materials.md#image-textures).\n\n'
        + '| setting | starts at | does |\n|---|---|---|\n'
    for (const [k, v] of Object.entries(SLOT_DEFAULTS)) s += `| ${k} | ${cell(value(v))} | ${cell(SLOT_HELP[k] ?? '')} |\n`
    s += '\n## Reliefs\n\nA relief is a height on every object wearing the material, in real mm -- part of the shape, so it shows in the '
        + 'silhouette, and paid for at every march step near the object.\n\n'
    for (const R of Object.values(RELIEFS)) s += `### ${R.label}\n\n${firstComment(R.code)}\n\n`
    // ...and the one made for a picture (materials.js pictureRelief, 0.84.0): not a preset, it names the picture it reads
    s += `### ${PICTURE_RELIEF_LABEL}\n\n${firstComment(pictureRelief('texture').code)}\n\n`
    return s
}

function lights() {
    let s = HEAD('Light settings', 'A light object is a flat rectangle or disc that emits from its front (+z), or a ray file\'s rays. Its size '
        + 'is its parameters; the rest is here. ' + Object.values(LIGHT_SHAPES).map(v => `*${v.label}*`).join(', ') + '. Inside an array '
        + '(a group\'s copies), it is a light at every copy, each with these settings: see [Arrays](../modelling/parameters.md#arrays).')
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

function code() {
    const sigs = preludeSignatures()
    const users = name => {
        const re = new RegExp(`\\b${name}\\s*\\(`)
        return [...Object.entries(PRIMITIVES).filter(([, P]) => re.test(codeOnly(P.code))).map(([k]) => `*${k}*`),
                ...Object.values(MODIFIERS).filter(M => re.test(codeOnly(M.code))).map(M => `*${M.label}*`)]
    }
    const entry = (sig, words, name) => {
        const u = name ? users(name) : []
        // a list of every shape says nothing: a few, then how many more
        const named = u.length > 6 ? `${u.slice(0, 5).join(', ')} and ${u.length - 5} more` : u.join(', ')
        return `- \`${sig}\` -- ${words}${u.length ? ` Used by ${named}.` : ''}\n`
    }
    let s = HEAD('Functions for code', 'What the code of an object, a group, a material or the scene\'s functions can call. Code is WGSL, '
        + 'the graphics card\'s language, and every block is compiled after the same library, so everything here is in scope in '
        + 'every block -- along with WGSL\'s own functions: `length`, `abs`, `min`, `max`, `clamp`, `mix`, `smoothstep`, `dot`, '
        + '`cross`, `normalize`, `sin`, `cos`, `fract`, `floor` and the rest ([the WGSL standard\'s list](https://www.w3.org/TR/WGSL/#builtin-functions)). '
        + 'See [Parameters and code](../modelling/parameters.md#writing-code) for how to write and apply code, and the '
        + '[Shapes](shapes.md) and [Modifiers](modifiers.md) for code that uses these.')
    s += '\n## What each block has\n\n| block | runs | has, besides its own parameters by name |\n|---|---|---|\n'
        + '| an object\'s | at every march step | `p` the point in the node\'s own frame, `C` the Hit to fold into, `MATERIAL` its material |\n'
        + '| a group\'s | at every march step, around its children | `p` (which it may change), `C`, `r` the ray, `children(C, p)`, '
        + '`XF_S` this frame\'s units in world units, `SURFACE_ONLY`, `READ_REACH`, `DIVIDED_ABOVE` |\n'
        + '| a material\'s | once where a ray hits | `m` the material to change, `p` and `n` the hit and its normal in the world, `C`, '
        + 'and `p_local`, `R_local`, `S_local` the hit in the object\'s frame, its turn and its scale |\n'
        + '| a material\'s image textures | -- | `sample(name)`, `mapped(name)` and `sampleAt(name, uv)` in its code: [below](#a-materials-image-textures) |\n'
        + '| a material\'s relief | at every march step near an object wearing it | `q` the point in mm in that object\'s frame, '
        + '`world` the same in the scene\'s, the material\'s image textures by name for `heightAt`; it sets `h`, the height in mm outward, and `slope`, a bound on how steep `h` is |\n'
        + '| the scene\'s functions | -- | its functions are called from any of the others |\n'
        + '\nUnder every code box, **Insert** lists what that block can set, read and call, with recipes -- a click puts one in the '
        + 'code at the caret -- and what it cannot do; **Functions you can call…** opens this page.\n'
    /* WHAT A MATERIAL'S CODE SETS, and a relief's (builder/coderef.js, which the Insert pane shows): every field of
       Material2, its line, and what cannot be set at all */
    s += '\n## What a material\'s code sets\n\nA material\'s code changes `m`, which holds every setting of its panel when the code '
        + 'starts. Each field, as the line that sets it (here from a new material\'s values; the Insert pane writes the material\'s own):\n\n'
        + '| field | the line | what it is |\n|---|---|---|\n'
    const D = Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, structuredClone(f.def)]))
    for (const x of MATERIAL_SETS) s += `| ${x.label ?? `\`${x.field}\``} | \`${cell(x.code(D))}\` | ${cell(x.brief)} |\n`
    s += '\nWhat it cannot set:\n\n' + MATERIAL_CANNOT.map(c => `- \`${c.name}\` -- ${c.why}\n`).join('')
    s += '\n## What a relief\'s code sets\n\nA relief\'s code runs in the march, at every step near an object wearing its material. '
        + 'It reads `q` and `world` and its own parameters, and sets two numbers:\n\n'
        + CODE_BLOCKS.relief.sets.map(x => `- \`${x.name}\` -- ${x.brief}. For example \`${x.code()}\`\n`).join('')
        + '\nIts recipes, each with its slope worked out:\n\n'
        + CODE_BLOCKS.relief.recipes.map(r => `**${r.title}**\n\n\`\`\`\n${recipeText(r)}\n\`\`\`\n\n`).join('')
        + 'What it cannot read:\n\n' + CODE_BLOCKS.relief.cannot.map(c => `- ${c.name} -- ${c.why}\n`).join('')
    s += '\n## Words the page rewrites\n\nBefore it compiles, every whole word below is replaced -- in your code too, so do not name '
        + 'a variable or a parameter one of them: a variable `X` becomes `vec4<f32>`.\n\n| word | becomes |\n|---|---|\n'
        + Object.entries({ ...TOKENS, ...SHORT_TOKENS }).map(([k, v]) => `| \`${k}\` | \`${cell(v)}\` |`).join('\n') + '\n'
    s += '\n## What a shape is\n\nA shape is a `VEC4`: `xyz` its outward normal, unit length, and `w` its signed distance -- negative '
        + 'inside. A zero normal means *none*, and the renderer then takes the normal by differences. A distance must never be '
        + 'more than the true distance to the surface, or the march steps through it. `C = add_new(C, Nsphere(p, 0.5), MATERIAL);` '
        + 'is a sphere. `C = add_new(C, sd((p.z - 0.1 * sin(p.x * 10.0)) / 1.5), MATERIAL);` is a wavy floor: the height\'s slope '
        + 'reaches 1, so the field\'s reaches √2, and divided by 1.5 it is never more than the distance.\n'
    /* A MATERIAL'S PICTURES (0.84.0; lib/pathtracer/core/images.js): not in the scene prelude -- a scene without a picture has
       none of them -- so written here, not in CODE_HELP, whose every name the prelude must have */
    s += '\n## A material\'s image textures\n\nIn a material whose **image textures** box has any, each is in its code by its name, and three '
        + 'functions read them. The point is the hit\'s in the object\'s pattern frame, in mm.\n\n'
        + '- `sample(texture) -> vec4<f32>` -- the image texture at the hit by its own projection, size, offset, turn, wrap and filter: linear '
        + 'rgb (a colour image decoded from sRGB) and alpha; 0 where it does not show (outside a copy that does not wrap, a face it is not on).\n'
        + '- `mapped(texture) -> vec2<f32>` -- where on the image texture the hit is, in copies of it: (0, 0) its bottom left, (1, 1) its top right.\n'
        + '- `sampleAt(texture, uv: vec2<f32>) -> vec4<f32>` -- the image texture at a position of your own, in copies, with its wrap and filter.\n'
        + '\nFor instance a data image texture as the roughness, `m.roughness = sample(rough).r;`, or one twice as small, '
        + '`m.baseColor = sampleAt(texture, mapped(texture) * 2.0).rgb;`.\n'
        + '\nIn the material\'s **relief** code its image textures are in scope by name too, with one more:\n\n'
        + '- `heightAt(texture, q) -> vec2<f32>` -- the image texture as a height at `q`: its luminance times its alpha, 0 to 1, read planar '
        + 'from `q.xy` at its own size, offset, turn and wrap, smooth (a cubic B-spline of its pixels, 16 reads); and, second, the '
        + 'bound on how steep it is per mm, from its own pixels. A relief from an image texture is `h = amplitude * raise * t.x; '
        + 'slope = amplitude * abs(raise) * t.y;` with `t` this.\n'
    for (const sec of CODE_HELP) {
        s += `\n## ${sec.title}\n\n${sec.intro}\n\n`
        for (const [name, words] of Object.entries(sec.fns)) {
            if (!sigs.has(name)) throw new Error(`help/reference.mjs CODE_HELP: ${name} is not a function of the scene prelude`)
            s += entry(sigs.get(name), words, name)
        }
    }
    s += '\n## A scene\'s outlines and paths\n\nA shape from points -- an outline or a path parameter, which the Points mode edits -- '
        + 'is given to these by its parameter\'s name, which is a handle for it. They exist in a scene that has such a parameter.\n\n'
    for (const [sig, words] of Object.entries(CODE_MADE)) s += entry(typeWords(sig), words, sig.slice(0, sig.indexOf('(')))
    return s
}

/** Every reference page: { file (under help/): text }. */
export const referencePages = () => ({
    'reference/shapes.md': shapes(),
    'reference/modifiers.md': modifiers(),
    'reference/materials.md': materials(),
    'reference/lights.md': lights(),
    'reference/haze.md': haze(),
    'reference/code.md': code(),
    // a script's functions (0.82.0): tools/scriptref.js, which the Script panel's Reference pane shows too
    'reference/script.md': scriptReference(),
})

if (import.meta.url === `file://${process.argv[1]}`) {
    const dir = new URL('./', import.meta.url)
    mkdirSync(new URL('reference/', dir), { recursive: true })
    for (const [file, text] of Object.entries(referencePages())) { writeFileSync(new URL(file, dir), text); console.log(file) }
}
