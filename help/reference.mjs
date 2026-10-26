// node help/reference.mjs
//
// THE REFERENCE PAGES, MADE FROM THE PROGRAM'S OWN LISTS: every shape (builder/primitives.js), every modifier
// (builder/modifiers.js), every material field, relief and coating (builder/materials.js), every light setting
// (builder/lights.js), every haze box setting (builder/hazebox.js), and the functions code can call (the scene prelude: CODE_HELP
// below). A shape's or a modifier's text is the comment its code starts with -- what its properties panel
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
import { codeOnly } from '../builder/codegen.js'
import { SCENE_PRELUDE } from '../lib/pathtracer/core/scene_api.js'
import { TOKENS, SHORT_TOKENS } from '../lib/wgsl_shorthand.js'

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

/* THE FUNCTIONS CODE CAN CALL (the user, 2026-10-23: "code block comments and/or help could use an overview of sdf
   functions defined that can be used inside of code blocks"). Every block -- an object's, a group's, a material's, the
   scene's functions -- is compiled after the same prelude (lib/pathtracer/core/scene_api.js SCENE_PRELUDE: sdf.js,
   shapes.js, noise.js, materials.js and the scene API), so all of it is in scope everywhere; these are the parts of it
   written to be called. A function's SIGNATURE IS READ FROM THE PRELUDE, not typed here, so the page cannot disagree
   with the code; the words are below, one a name, and help/test/coverage.test.mjs fails on a name the prelude has not,
   and on a prelude function named like a shape or a join (CODE_SHAPED) with no words and no place in CODE_UNLISTED --
   so a shape added to shapes.js without words fails, as a material field does. Read in each function's own comment
   and code; where it says exact or a bound, so does this. */
export const CODE_HELP = [
    { title: 'Putting shapes into the scene', intro: 'What an object\'s code calls once a shape, and what a group\'s code works with.', fns: {
        add_new: 'Folds a shape into `C`: `sdf` is (normal, distance) in this node\'s own frame, taken to the world here; `matIndex` its material -- `MATERIAL` for the node\'s own. Every shape\'s code is this call.',
        fold: '`add_new` without the transform: for a result already in world units, such as the `s` of a Hit its children were folded into (`fold(C, H.s, H.m)`).',
        emptyHit: 'A Hit with nothing in it yet: what a group folds its children into when it works on their result before it reaches `C` (`var H = children(emptyHit(r), p);`).',
        warp: 'Call after changing `p` in a way that is not a plain move or turn: every distance folded in from here on is multiplied by `k` (below 1 for a warp that stretches space, so the march does not step through), and normals are taken by differences.',
        foldRelief: 'A distance steepened by up to `slope` -- a noise added to it -- folded in: divided by `slope` here, so the march stays safe, or, passed `DIVIDED_ABOVE` in a CSG group, once after the blend.',
    } },
    { title: 'Joining shapes', intro: 'Each takes two (normal, distance) results and gives one; `k` is the blend\'s width, in the frame\'s units. The `csg` three are what a CSG group compiles to, and the ones to use: `k = 0` is a hard join, and the result has a normal only when both shapes have one -- otherwise the renderer takes it by differences, which is right for any shapes. The older ones, below, are kept for the code that calls them.', fns: {
        csgUnion: 'Both shapes; `k` above 0 melts them together where they come within `k` of each other.',
        csgIntersect: 'Only where both are.',
        csgSubtract: '`a` with `b` cut out of it.',
    } },
    { title: 'Older joins', intro: 'Kept for the code that calls them; new code is better off with the `csg` three above.', fns: {
        Nsmin: 'A smooth union with the normals blended. `k` must be above 0 (it is divided by), and both shapes need a normal: an `sd` shape\'s zero normal can make it NaN, and a NaN normal deletes the surface. `csgUnion` has neither problem.',
        Nsmax: 'A smooth intersection, as `Nsmin` with its caveats.',
        NopSmoothUnion: '`Nsmin` by another name.',
        NopSmoothIntersect: '`Nsmax` by another name.',
        NopSmoothSubtract: '`a` with `b` cut out, smoothly: `Nsmax` of `a` and `b` turned inside out.',
        opSmoothUnion: 'A smooth union of the distances alone: no normal. `k` above 0.',
        opSmoothIntersect: 'A smooth intersection of the distances alone. `k` above 0.',
        opSmoothSubtract: '`d1` with `d2` cut out, smoothly, distances alone. `k` above 0.',
        opUninion: 'The smaller distance (a union), no normal. Spelled as it is in the code.',
        opIntersection: 'The larger distance, no normal.',
        opSubtraction: '`d1` with `d2` cut out, no normal.',
        opScale: 'The distance times `s`, no normal: what a shape drawn at `p / s` needs, `s` times its distance.',
    } },
    { title: 'Shapes with a normal', intro: 'Each returns `VEC4(normal, distance)` with the normal worked out exactly, which saves the renderer three more evaluations of the whole scene at every hit (`tracebasics.js` `hitNormal`). All are centred on the origin with z up, unless it says otherwise; sizes are in the frame\'s units.', fns: {
        Nsphere: 'A sphere of radius `r`.',
        NboxRounded: 'A box of half-sizes `b`, its edges rounded by `r` within that size (`r = 0` sharp).',
        Nroundedbox: 'A box of half-sizes `b` rounded by `r` outside it: `b + r` in all.',
        Nbox: 'A box of half-sizes `b`, rounded by 0.01 outside them -- kept for the code that calls it; `NboxRounded` is the box shape\'s.',
        Ncylinder: 'A cylinder along z: `h` its half-height, `r` its radius.',
        Ncapsule: 'A segment from z = -`h` to +`h`, swept by radius `r`: a pill.',
        Ntorus: 'A ring in the xy plane: `R` from the axis to the tube\'s centre, `r` the tube\'s radius.',
        NcappedTorus: 'An arc of a ring: radius `R` in the xy plane, `angle` degrees of it, symmetric about +y, swept by a tube of radius `r`. 360 is a whole ring.',
        Nlink: 'A chain link: a ring of radius `R` pulled apart along y by `span`, swept by a tube of radius `r`.',
        Nplane: 'Everything below z = 0, its surface facing +z. Infinite.',
        Nrectangle: 'A flat rectangle of half-sizes `h` in the xy plane, no thickness: seen from both sides.',
        Ndisc: 'A flat disc of radius `r` in the xy plane, no thickness.',
        NroundCone: 'A sphere of radius `r1` at z = -`h`/2 and one of `r2` at +`h`/2, and the cone that touches both. Exact.',
        Noctahedron: 'A regular octahedron, `s0` from its centre to each corner. Exact.',
        Npyramid: 'A square pyramid: base side `base` on z = -`height`/2, apex on +`height`/2. Exact.',
        Nfrustum: 'A rectangular base `base.x` by `base.y` on z = -`height`/2 and a rectangular top `top` on +`height`/2; a top of 0 by 0 is a pyramid. Exact.',
        Nprism: 'A regular polygon of `sides` sides (3 to 64), `radius` to its corners, a flat side facing -y, extruded `height` along z. Exact.',
        Ntriprism: 'A triangle in the xz plane, base `width` on z = -`height`/2, its top at `apex` along the base (0 over its -x end, 0.5 the middle, 1 its +x end), extruded `depth` along y. Exact.',
        Ndome: 'The part of a sphere of radius `R0` above z = 0, `height` tall: its base sits on z = 0. Exact.',
        Ntube: 'A hollow cylinder: radii `outer` and `inner`, `height` tall. `inner` of 0 or less is solid. Exact.',
        Ndish: 'A parabolic mirror of focal length `f`, its focus at the origin, opening to +z, out to radius `aperture`, with a wall `wall` thick behind the mirror. Exact inside, a bound outside near the rim.',
        Nlens: 'A spherical lens along z: diameter `D`, centre thickness `t`, face radii `r1` (+z) and `r2` (-z) -- positive bulges out, negative is hollowed, 0 flat. A bound, exact near the face that wins.',
        Nasphere: 'An aspheric lens along z: diameter `D`, centre thickness `t`, and each face\'s radius, conic constant and coefficients a4..a10 (`R1, k1, a1` the +z face, `R2, k2, a2` the -z). A bound both sides.',
        Nmenger: 'A Menger sponge `ITER` levels deep in a cube of half-size 1. Make `ITER` a compile-time parameter so its loop can be unrolled.',
    } },
    { title: 'Shapes with a distance only', intro: 'These return a zero normal, so wherever one of them is the surface the renderer takes the normal by differences: three more evaluations of the whole scene at each hit. Use the `N` one where there is one.', fns: {
        sd: 'Wraps a bare distance as a result: `sd(length(p) - 0.5)` is a sphere. For a shape of your own.',
        sdSphere: 'A sphere of radius `r`.',
        sdBox: 'A sharp box of half-sizes `b`.',
        sdRoundedBox: 'A box of half-sizes `b` rounded by `r` outside it.',
        sdCylinder: 'A cylinder along z: `h` its half-height, `r` its radius.',
        sdCappedCylinder: 'A cylinder of radius `r` from point `a` to point `b`.',
        sdCappedCone: 'A cone along z: radius `r1` at z = -`h`, `r2` at +`h` (0 for a point). Exact; its normal is left to the renderer on purpose.',
        sdMenger: 'A Menger sponge `ITER` levels deep in a cube of half-size 1.',
    } },
    { title: 'Building shapes in 2D', intro: 'A shape of revolution is a 2D shape in the half-plane `q = VEC2(length(p.xy), p.z)`, and an extrusion one in `p.xy`. These return `VEC3(gradient.xy, distance)` there, and `g2Revolve` and `g2Extrude` lift that into 3D with its normal -- how the dish, the dome and the round cone are made.', fns: {
        g2Circle: 'A circle of radius `r` around `c`.',
        g2Box: 'A rectangle of half-sizes `b` around `c`. Exact.',
        g2RegularPolygon: 'A regular polygon of `sides` sides, `R0` to its corners, a flat side facing -y. Exact.',
        g2Triangle: 'The triangle `a`, `b`, `c`, counter-clockwise. Exact.',
        g2Parabola: 'The parabola y = `k` x^2 (`k` above 0), positive below it. Exact.',
        g2Max: 'The larger of two: an intersection.',
        g2Neg: 'Inside and outside swapped.',
        g2Offset: 'Grown by `t` (shrunk, for `t` below 0).',
        g2Revolve: 'A 2D result at `q = VEC2(length(p.xy), p.z)` turned around the z axis.',
        g2Extrude: 'A 2D result at `p.xy`, extruded `h` either side of z = 0.',
        g2Dir: '`v` made unit length, or `fallback` where `v` is zero.',
        safeDir: 'The same in 3D: `v` unit length, or `fallback` where it has no direction -- a normal that must never be NaN.',
    } },
    { title: 'Noise', intro: 'Solid noise: one cell per unit of the point it is given, a pure function of the point and the `seed` (a `u32`, such as `3u`). Each returns its gradient with it, `VEC4(gradient, value)`, so a bump has a normal. A noise added to a distance makes the field steeper than 1, and the march then steps through the surface: divide by the steepness, or fold it with `foldRelief` as the *noise relief* modifier does. In a material, where it runs once a hit, nothing needs dividing.', fns: {
        vnoise3: 'Value noise: (gradient, value), the value in -1 to 1. Blockier than gradient noise.',
        gnoise3: 'Gradient (Perlin) noise: (gradient, value), the value about -1 to 1. Smoother and less tied to the grid.',
        fbm3: '`octaves` of gradient noise added up, each at `lac` times the last one\'s frequency and `gain` times its amplitude: (gradient, value).',
        nzFbmLip: 'How steep `fbm3` with those settings can be, given `L` for one octave: `NZ_GRAD_LIP` (proved) or `NZ_GRAD_LIP_MEASURED` (a quarter of it, measured). What a distance with `fbm3` added is divided by.',
        worley3: 'Cells: `VEC4(F1, F2, id1, id2)` -- the distances to the nearest and second-nearest point, and a number from 0 to 1 for each of their cells. `F2 - F1` is 0 on a border: cracks, leather, grains.',
        worley3x: '`worley3` of two point sets at once, the second turned and of another size, so no grid shows. Twice the cost.',
        perMm: 'Cycles per millimetre in cycles per scene unit: `gnoise3(p * perMm(2.0), 1u)` has two cells a millimetre.',
    } },
    { title: 'Units', intro: 'Code\'s numbers are in the scene\'s unit. These give a real size whatever that is.', fns: {
        metres: '`x` metres in the scene\'s unit.',
        mm: '`x` millimetres in the scene\'s unit.',
    } },
    { title: 'Materials', intro: 'For a material\'s code, which changes `m` -- or returns a material of its own -- where a ray hits.', fns: {
        makeDefaultMaterial: 'A light grey dielectric: the starting point of every material.',
        makeDiffuse: 'A pure diffuse surface of colour `color`, no reflection. `roughness` changes nothing.',
        makePlastic: 'A coloured dielectric with a reflection: `specular` 0.5 the physical one.',
        makeMetal: 'A metal, `color` its reflectance.',
        makeMirror: 'A perfect mirror, tinted `color`.',
        makeGlassSmooth: 'Clear glass of index `ior`, tinted `color`.',
        makeGlassRough: 'Frosted glass: `makeGlassSmooth` with a `roughness`.',
        makeEmissive: 'A surface emitting `color`.',
        mixMaterials: 'Part way from `m1` to `m2`, `t` 0 to 1. A coating is one or the other, never half of each: `m2`\'s past 0.5.',
        grainAlong: 'A brushed grain, for `m.tangent` (with an anisotropy above 0): straight along `axis` in the object\'s frame. Pass `R_local` as `R`.',
        grainAround: 'A turned grain: circles about `axis` through the origin of `q` (usually `p_local`).',
        grainRadial: 'Spokes out from `axis`, as on a sunburst dial.',
        srfNoise: 'Smooth value noise from 0 to 1, one cell per unit of `x`.',
        streaksAlong: 'Brush lines along `axis`: a value from 0 to 1 per line, about `len` long and `width` across, for varying `m.roughness`. `q`, `width` and `len` in one unit.',
        streaksAround: 'The same as circles about `axis`, for a turned part.',
    } },
]

/** Prelude functions named like a shape or a join (N..., sd..., op..., csg..., g2...): each has words above or a reason here. */
export const CODE_SHAPED = /^(N[a-z]|sd[A-Z]?|op[A-Z]|csg[A-Z]|g2[A-Z])/
export const CODE_UNLISTED = {
    csgNormal: 'the csg joins\' own blended normal',
    sheetNormal: 'Nrectangle\'s and Ndisc\'s own',
    lensFace: 'Nlens\'s own, one face',
}

/** WHAT A SCENE MAKES FOR ITS OWN PROFILES AND PATHS (codegen.js emits them when a scene has one): not in the prelude, so
 *  their signatures are written here as codegen writes them, and the coverage test finds each in codegen.js. */
export const CODE_MADE = {
    'extrude(id: u32, p: VEC3, height: FLOAT) -> VEC4': 'The node\'s profile parameter `id` (its name) in xy, extruded `height` along z, centred.',
    'revolve(id: u32, p: VEC3) -> VEC4': 'The profile, as (radius, z), turned around the z axis.',
    'profile(id: u32, q: VEC2) -> VEC3': 'The profile in 2D: (gradient, distance) at `q`, for use with the 2D functions.',
    'tube(id: u32, p: VEC3, radius: FLOAT, rounded: FLOAT) -> VEC4': 'A tube of `radius` along the path parameter `id`; `rounded` above 0.5 gives it round ends.',
    'sweep(id: u32, outline: u32, p: VEC3) -> VEC4': 'The profile `outline` swept along the path `id`, its ends flat.',
}

/** A prelude function's signature, as the page shows it: the long vector types as the short words code writes. */
const TYPE_WORDS = [[/vec2<f32>/g, 'VEC2'], [/vec3<f32>/g, 'VEC3'], [/vec4<f32>/g, 'VEC4'], [/\bFLOAT\b/g, 'f32']]
const typeWords = s => TYPE_WORDS.reduce((t, [re, w]) => t.replace(re, w), s)
const sigOf = (name, args, ret) => `${name}(${args.split(',').map(a => a.trim()).filter(Boolean)
    .map(a => a.replace(/\s*:\s*/, ': ')).join(', ')})${ret ? ` -> ${ret.trim()}` : ''}`
export const preludeSignatures = () => new Map([...SCENE_PRELUDE.matchAll(/\bfn\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*([^{]+?))?\s*\{/g)]
    .map(m => [m[1], typeWords(sigOf(m[1], m[2], m[3]))]))

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
        + '| a material\'s relief | at every march step near an object wearing it | `q` the point in mm in that object\'s frame, '
        + '`world` the same in the scene\'s; it sets `h`, the height in mm outward, and `slope`, a bound on how steep `h` is |\n'
        + '| the scene\'s functions | -- | its functions are called from any of the others |\n'
        + '\nThe comments a new block starts with say the same, with examples; **Functions you can call…** under a block opens this page.\n'
    s += '\n## Words the page rewrites\n\nBefore it compiles, every whole word below is replaced -- in your code too, so do not name '
        + 'a variable or a parameter one of them: a variable `X` becomes `vec4<f32>`.\n\n| word | becomes |\n|---|---|\n'
        + Object.entries({ ...TOKENS, ...SHORT_TOKENS }).map(([k, v]) => `| \`${k}\` | \`${cell(v)}\` |`).join('\n') + '\n'
    s += '\n## What a shape is\n\nA shape is a `VEC4`: `xyz` its outward normal, unit length, and `w` its signed distance -- negative '
        + 'inside. A zero normal means *none*, and the renderer then takes the normal by differences. A distance must never be '
        + 'more than the true distance to the surface, or the march steps through it. `C = add_new(C, Nsphere(p, 0.5), MATERIAL);` '
        + 'is a sphere. `C = add_new(C, sd((p.z - 0.1 * sin(p.x * 10.0)) / 1.5), MATERIAL);` is a wavy floor: the height\'s slope '
        + 'reaches 1, so the field\'s reaches √2, and divided by 1.5 it is never more than the distance.\n'
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
})

if (import.meta.url === `file://${process.argv[1]}`) {
    const dir = new URL('./', import.meta.url)
    mkdirSync(new URL('reference/', dir), { recursive: true })
    for (const [file, text] of Object.entries(referencePages())) { writeFileSync(new URL(file, dir), text); console.log(file) }
}
