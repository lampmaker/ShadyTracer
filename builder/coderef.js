//======================================================================================================================
// WHAT A CODE BLOCK CAN USE (0.next): every name a block of each kind can set, read and call, with recipes -- shown under
// every code box by its Insert pane (builder/codehelper.js), one click a line in the code, and written as Help ›
// Reference › Functions for code by help/reference.mjs. One text, two places, as the script's reference is
// (tools/scriptref.js).
//
// THE USER, 2026-11-07: "material code: set parameters for dichroics, color, roughness, surface normal, etc: there is no
// explanation / tool to easily pick the parameters you want to change, or can change. The comments in the block show a
// few but not all and the syntax is not clear. Same for relief." The comments a block starts with named six of
// Material2's twenty-one fields; a coating's two reflectances are one packed word (coatR) a line `m.coatLow = ...` does
// not compile against; a colour depth written in code is in the scene's unit where the panel's is in mm. So the pane
// says, for each field, the line that sets it -- and what cannot be set at all (the normal), and why.
//
// HELD TO THE CODE (builder/test/coderef.test.mjs): every field of the WGSL struct Material2 is here, as something code
// sets or as something it cannot, and nothing else is; every panel field (materials.js FIELDS) has its line; every
// recipe compiles in a scene, in its kind of block; every function named is the prelude's. A field added to Material2
// without words fails the test -- the "second caller" this repository's bugs come from (CLAUDE.md).
//
// FIELD_HELP and CODE_HELP were help/reference.mjs's (0.79.0); they are here so the page, which cannot import a module
// that imports node:fs, can show them. reference.mjs re-exports them.
//======================================================================================================================
import { SCENE_PRELUDE } from '../lib/pathtracer/core/scene_api.js'

/** WHAT EACH MATERIAL FIELD DOES -- read in builder/materials.js FIELDS and lib/pathtracer/core/materials_pbr.js. */
export const FIELD_HELP = {
    baseColor: 'The surface\'s colour, linear (not sRGB): how much of each of red, green and blue it reflects -- for a metal, its reflectance head-on; for glass, the tint each crossing gives (or, with a colour depth, the colour at that depth).',
    metallic: '0 a dielectric (plastic, paint, stone, glass): white reflections over a coloured body. 1 a metal: no body, the reflection itself coloured. In between is rarely physical.',
    roughness: 'How rough the surface is at a scale too small to model: 0 a mirror-sharp reflection, 1 fully matte.',
    anisotropy: 'Roughness different along and across a direction -- brushed or turned metal. 0 the same every way; the direction is the material code\'s `m.tangent`.',
    specular: 'How strong a dielectric\'s reflection is: 0.5 the physical value for its index of refraction, 0 none at all (a pure diffuse surface), 1 twice.',
    specularTint: 'Tints a dielectric\'s reflection with its base colour: 0 white, as real plastics and paints reflect.',
    transmission: 'How much of the light the surface does not reflect passes THROUGH it instead of back off a diffuse body: 1 glass and clear plastics, 0 everything opaque, 0.5 an opal sheet that passes half at each face. Haze says how much of what passes is diffused instead of going straight. With roughness it is frosted glass -- and a diffuser film is a thin sheet of it: roughness 0.36 spreads a ray head-on through a polycarbonate sheet by about 10 degrees, anisotropy makes the spread elliptical along the grain, up to 10:1.',
    ior: 'The index of refraction, at the d line (587.6 nm): 1.5 a typical glass, 1.333 water, 1.49 PMMA, 1.586 polycarbonate. Sets how much a transparent material bends light and how strongly it reflects.',
    abbe: 'The Abbe number V_d -- how much the index changes with colour: 0 none (no dispersion), 64 a crown glass (BK7), 36 a flint, 30 polycarbonate. Lower spreads colours more. Turning it on is a compile.',
    attenuationDistance: 'The colour depth, in real mm whatever the scene\'s unit: light that has travelled this far inside has been filtered to the base colour, so a thick part is darker than a thin one. 0 off: each crossing tints by the colour, whatever the thickness. Turning it on is a compile.',
    coating: 'A thin-film coating whose reflectance replaces the surface\'s own: none, on the faces light enters by (the back anti-reflective, or bare), or on every face. On a metal it lies over the metal, which reflects back what the coating passes. Putting one on is a compile.',
    coatLow: 'The coating\'s reflectance below its edge wavelength (0..1).',
    coatHigh: 'The coating\'s reflectance above its edge wavelength (0..1).',
    coatEdge: 'Where the coating switches, in nm, head-on. At an angle it moves to shorter wavelengths, as real interference filters do.',
    coatWidth: 'How sharp the switch is: nm from 10 % to 90 % of the way.',
    coatIndex: 'The coating stack\'s effective index: how fast the edge moves with the angle -- higher moves it less.',
    haze: 'Of the light that passes through (transmission), how much is diffused -- spread evenly on the far side -- instead of going straight on: what a datasheet calls haze (ASTM D1003). 0 clear, 1 all of it (an opal diffuser, paper, a lampshade). Clear acrylic with haze 0.06 keeps a sharp image behind it under a veil; roughness is the other, narrow blur (frosting). Each face a ray crosses scatters it, so a sheet scatters twice. A clear sheet of n 1.49 whose faces have haze 0.01, 0.03, 0.06, 0.1, 0.2, 0.5 has about 1.7, 5, 10, 17, 33, 72 % haze itself, passing 92 to 84 % (a walk of the sheet in core/transmission.js). An opal sheet whose datasheet gives a total transmittance T (white, specular 0) is transmission 2T / (1 + T) a face with haze 1 -- 0.667 for 50 %. Thickness does not change it: it scatters at the faces. Light sampling and the lights\' rays reach through it in Standard and High; Draft follows it as it follows frosted glass. Turning it on is a compile.',
    scatterDistance: 'How far light travels inside the material, on average, before something in it scatters it: in millimetres, whatever the scene\'s unit, as the colour depth. 0 a clear volume. Haze scatters at the faces, whatever the thickness; this scatters inside, so a thick part is milkier than a thin one -- milky or opal glass by the block, a light guide\'s diffusing body, frosted ice. A few millimetres in a part a few centimetres thick is milky; a free path well under the part\'s size makes it glow through, like opal. It only acts where light travels inside, so with transmission. Each scattering is a step of the march, so a dense, thick part walks long: raise Max Iterations if it reads dark. Light sampling cannot reach inside smooth glass, so what the glass scatters -- a beam\'s track, a lamp\'s glow -- shows through the photon map (Light sources), sharpening as samples come in, and without it only by chance; the Optics page\'s rays walk it too. Turning it on is a compile.',
    scatterAnisotropy: 'Which way each scattering inside sends the light (Henyey-Greenstein\'s g): 0 evenly in every direction, towards 0.95 mostly onwards, as large particles do (milk about 0.8, fine particles nearer 0). Forward scattering lets light through deeper, so a forward-scattering part is clearer for the same scatter distance. Only with a scatter distance.',
    emissive: 'An emitter\'s colour. Only its hue counts: the brightness is the luminance.',
    emissiveLuminance: 'An emitter\'s brightness in cd/m²: 300 a monitor, 5000 a frosted bulb, 20 000 a fluorescent tube, 1.6 billion the sun.',
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
        csgRoundUnion: 'A join set to *round* (version 28): both shapes, the concave edge where they meet filled by a fillet of radius `r` -- a circle where they meet at a right angle (two flat faces, a flat face across a cylinder or a prism), a rounded corner at other angles. Its distance reads the two distances alone; its normal is analytic, and with a shape that gives no normal the result has none.',
        csgRoundIntersect: 'Only where both are, the edge rounded by a circle of radius `r`: a convex fillet, as `csgRoundUnion`.',
        csgRoundSubtract: '`a` with `b` cut out, the rim of the cut rounded by radius `r`: a hole\'s filleted edge.',
        csgChamferUnion: 'A join set to *chamfer*: the concave edge filled with the flat cut between the lines a round of radius `r` would touch.',
        csgChamferIntersect: 'Only where both are, the edge cut flat between the lines a round of radius `r` would touch.',
        csgChamferSubtract: '`a` with `b` cut out, the rim of the cut chamfered.',
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
    csgShapedCap: 'the round and chamfer joins\' own cap on how far they go over the hard op',
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
export const typeWords = s => TYPE_WORDS.reduce((t, [re, w]) => t.replace(re, w), s)
const sigOf = (name, args, ret) => `${name}(${args.split(',').map(a => a.trim()).filter(Boolean)
    .map(a => a.replace(/\s*:\s*/, ': ')).join(', ')})${ret ? ` -> ${ret.trim()}` : ''}`
export const preludeSignatures = () => new Map([...SCENE_PRELUDE.matchAll(/\bfn\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*([^{]+?))?\s*\{/g)]
    .map(m => [m[1], typeWords(sigOf(m[1], m[2], m[3]))]))

//----------------------------------------------------------------------------------------------------------------------
// WHAT A MATERIAL'S CODE SETS. Its block runs once where a ray hits, inside getMaterial2's case for the material
// (codegen.js emitMaterials): `m` already holds every setting of the panel, so a line changes one of them there, for that
// hit. Read in lib/pathtracer/core/materials.js (struct Material2, coatMaterial, coatLowHigh) and codegen.js.
//----------------------------------------------------------------------------------------------------------------------
/** A WGSL f32 literal of a number: `1.0`, never `1`, which WGSL reads as an integer. */
export const f32 = v => {
    const x = Number(v)
    if (!Number.isFinite(x)) return '0.0'
    const s = String(+x.toPrecision(6))
    return /[.e]/.test(s) ? s : `${s}.0`
}
/** ...and a colour or a vector, as `VEC3(r, g, b)` */
export const vec3 = c => `VEC3(${(Array.isArray(c) ? c : [c?.r ?? c?.x ?? 0, c?.g ?? c?.y ?? 0, c?.b ?? c?.z ?? 0]).map(f32).join(', ')})`
const num = (P, k, d) => f32(P?.[k] ?? d)

/** Each: the struct field it writes (`field`, or `fields` for one line that writes several), the panel field(s) it is
 *  (`panel`: materials.js FIELDS keys; none for a field only code sets), its line -- written from the material's own
 *  values, so inserting it changes nothing until a number is edited -- and a few words. `group` is the pane's heading. */
export const MATERIAL_SETS = [
    { field: 'baseColor', panel: ['baseColor'], group: 'Surface', code: P => `m.baseColor = ${vec3(P?.baseColor ?? { r: 0.8, g: 0.8, b: 0.8 })};`,
      brief: 'the colour: linear red, green, blue, each 0..1 (not sRGB)' },
    { field: 'metallic', panel: ['metallic'], group: 'Surface', code: P => `m.metallic = ${num(P, 'metallic', 0)};`, brief: '0 a dielectric (paint, plastic, glass), 1 a metal' },
    { field: 'roughness', panel: ['roughness'], group: 'Surface', code: P => `m.roughness = ${num(P, 'roughness', 0.5)};`, brief: '0 a mirror-sharp reflection .. 1 matte' },
    { field: 'specular', panel: ['specular'], group: 'Surface', code: P => `m.specular = ${num(P, 'specular', 0.5)};`, brief: 'a dielectric\'s reflection: 0 none, 0.5 the physical one, 1 twice' },
    { field: 'specularTint', panel: ['specularTint'], group: 'Surface', code: P => `m.specularTint = ${num(P, 'specularTint', 0)};`, brief: 'the reflection tinted by the colour: 0 white .. 1' },
    { field: 'anisotropy', panel: ['anisotropy'], group: 'Surface', code: P => `m.anisotropy = ${num(P, 'anisotropy', 0)};`, brief: '-1..1: rougher along the grain than across it, or the other way (with m.tangent)' },
    { field: 'tangent', group: 'Surface', code: () => 'm.tangent = grainAlong(R_local, VEC3(1.0, 0.0, 0.0));',
      brief: 'the grain\'s direction in the world, for an anisotropy: code only, no panel row. grainAlong, grainAround, grainRadial make one; zero is no grain' },
    { field: 'transmission', panel: ['transmission'], group: 'Glass', code: P => `m.transmission = ${num(P, 'transmission', 0)};`, brief: 'of what is not reflected, the share that passes through: 0 opaque, 1 glass' },
    { field: 'ior', panel: ['ior'], group: 'Glass', code: P => `m.ior = ${num(P, 'ior', 1)};`, brief: 'the index of refraction: 1.5 glass, 1.333 water, 1.49 PMMA' },
    { field: 'haze', panel: ['haze'], group: 'Glass', code: P => `m.haze = ${num(P, 'haze', 0)};`, brief: 'of what passes, the share diffused at the face: 0 clear, 1 opal' },
    { field: 'abbe', panel: ['abbe'], group: 'Glass', code: P => `m.abbe = ${num(P, 'abbe', 0)};`, brief: 'the Abbe number (dispersion): 0 none, 64 BK7, 36 a flint' },
    { field: 'attenuationDistance', panel: ['attenuationDistance'], group: 'Glass', code: P => `m.attenuationDistance = mm(${num(P, 'attenuationDistance', 0)});`,
      brief: 'the colour depth: the depth inside at which light is filtered to the colour. A length in the scene\'s unit here, so mm() it -- the panel\'s number is mm' },
    { field: 'scatterDistance', panel: ['scatterDistance'], group: 'Glass', code: P => `m.scatterDistance = mm(${num(P, 'scatterDistance', 0)});`,
      brief: 'the mean free path inside (milky glass), mm() it. A line naming it compiles the walk inside into the scene, as a scatter distance in the panel does; it acts only with transmission' },
    { field: 'scatterAnisotropy', panel: ['scatterAnisotropy'], group: 'Glass', code: P => `m.scatterAnisotropy = ${num(P, 'scatterAnisotropy', 0)};`, brief: 'each scattering inside: 0 every way, towards 0.95 forward' },
    { fields: ['coat', 'coatR', 'coatEdge', 'coatWidth', 'coatIndex'], label: 'the whole coating', panel: ['coating', 'coatLow', 'coatHigh'], group: 'Coating',
      code: P => `m = coatMaterial(m, ${P?.coating > 0 ? P.coating : 1}u, ${num(P, 'coatLow', 0)}, ${num(P, 'coatHigh', 1)}, ${num(P, 'coatEdge', 600)}, ${num(P, 'coatWidth', 20)}, ${num(P, 'coatIndex', 1.8)});`,
      brief: 'a coating, whole: where (1u the faces light enters by, the back anti-reflective; 2u the back bare; 3u every face), R below the edge, R above it, the edge (nm), its width (nm), the stack\'s index. The way to set R below and above: they are one packed word' },
    { field: 'coatEdge', panel: ['coatEdge'], group: 'Coating', code: P => `m.coatEdge = ${num(P, 'coatEdge', 600)};`, brief: 'the edge, nm head-on -- where the material has a coating (m.coat above 0)' },
    { field: 'coatWidth', panel: ['coatWidth'], group: 'Coating', code: P => `m.coatWidth = ${num(P, 'coatWidth', 20)};`, brief: 'the edge\'s width, nm from 10 % to 90 %' },
    { field: 'coatIndex', panel: ['coatIndex'], group: 'Coating', code: P => `m.coatIndex = ${num(P, 'coatIndex', 1.8)};`, brief: 'the stack\'s effective index: how far the edge moves at an angle' },
    { field: 'coat', group: 'Coating', code: () => 'm.coat = 0u;', brief: 'where the coating is: 0u none -- this line takes the panel\'s off here -- 1u, 2u, 3u as in coatMaterial' },
    { field: 'emissive', panel: ['emissive', 'emissiveLuminance'], group: 'Light', code: P => P?.emissiveLuminance > 0 ? 'm.emissive = m.emissive * 1.0;' : 'm.emissive = VEC3(1.0, 1.0, 1.0) * 1000.0;',
      brief: 'what the surface emits, cd/m² per channel (linear RGB): the panel\'s colour times its luminance. A surface given one here glows where it is set, and every path that reaches it ends there' },
]
/** What a material's code reads of the coating, for the pane: R below and above, unpacked. */
export const MATERIAL_COAT_READ = 'let R = coatLowHigh(m);   // R.x below the edge, R.y above'

/** WHAT A MATERIAL'S CODE CANNOT SET, and why: each struct field not in MATERIAL_SETS, and what is no field at all. */
export const MATERIAL_CANNOT = [
    { name: 'n', field: null, why: 'The surface normal is read-only here: the renderer takes it from the shape -- its own, or by differences of the distance -- before the material is asked, and nothing a material sets changes it. No bump or normal map exists yet. A relief (below the code) changes the shape itself, and so the normal and the silhouette, at a cost at every march step near the object.' },
    { name: 'coatR', field: 'coatR', why: 'A coating\'s two reflectances, packed into one word: set them with coatMaterial, read them with coatLowHigh(m).' },
    { name: 'lightTraced', field: 'lightTraced', why: 'Whether a surface is a light\'s face: the builder\'s own, set for the faces of its lights.' },
    { name: 'p, n, C, p_local', field: null, why: 'The hit\'s point, normal and Hit are inputs: a material cannot move where it was hit. Copy one into a `var` to work on it.' },
    { name: 'the type', field: null, why: 'Surface or glowing is the panel\'s: it says which settings are put into m before the code runs. A surface\'s code may still set m.emissive.' },
]

//----------------------------------------------------------------------------------------------------------------------
// EVERY BLOCK'S KIND: what it reads, what it sets, its recipes, the parts of CODE_HELP it reaches for first, and what it
// cannot do. The reads and sets are read in codegen.js (emitMaterials, the relief's function, OBJECT_CODE_TEMPLATE,
// GROUP_CODE_TEMPLATE) and materials.js (RELIEFS' header). A recipe is code that compiles as it is, in a block of its
// kind with no parameters of its own (coderef.test.mjs compiles each): its numbers are literals to edit.
//----------------------------------------------------------------------------------------------------------------------
/** Each read: `name` as inserted (inline, at the caret), `type`, and words. */
export const CODE_BLOCKS = {
    material: {
        label: 'a material\'s code',
        runs: 'once where a ray hits, after the settings above are put into m',
        reads: [
            { name: 'm', type: 'Material2', text: 'the material so far: every setting above is in it already (m.roughness is the panel\'s roughness)' },
            { name: 'p', type: 'VEC3', text: 'the hit, in the world, in the scene\'s unit' },
            { name: 'n', type: 'VEC3', text: 'the surface normal there, in the world, unit length; read-only' },
            { name: 'C', type: 'Hit', text: 'the hit as the scene folded it' },
            { name: 'p_local', type: 'VEC3', text: 'the hit in the object\'s own frame, so a pattern moves with the object (one more look at the scene a hit, for this material only)' },
            { name: 'R_local', type: 'mat3x3<f32>', text: 'that frame\'s turn to the world: R_local * d is a direction d of the object\'s, in the world' },
            { name: 'S_local', type: 'f32', text: 'that frame\'s scale: p_local * S_local is in the scene\'s unit' },
            { name: 'let q = p_local * S_local / mm(1.0);   // the hit in mm, moving with the object', line: true, type: 'VEC3', text: 'the point in real millimetres, whatever the scene\'s unit: for a pattern of a real size' },
            { name: MATERIAL_COAT_READ, line: true, type: 'VEC2', text: 'a coating\'s reflectance below and above its edge' },
            { name: 'mm(1.0)', type: 'f32', text: 'one millimetre in the scene\'s unit; metres(x) the same for metres' },
        ],
        sets: 'MATERIAL_SETS',
        recipes: [
            { title: 'A dichroic: reflects red, passes the rest', code: 'm = coatMaterial(m, 1u, 0.0, 1.0, 600.0, 20.0, 1.8);   // where, R below, R above, edge nm, width nm, index' },
            { title: 'A dichroic: reflects blue', code: 'm = coatMaterial(m, 1u, 1.0, 0.0, 500.0, 20.0, 1.8);' },
            { title: 'A beam splitter: 30 % reflected', code: 'm = coatMaterial(m, 1u, 0.3, 0.3, 550.0, 20.0, 1.8);' },
            { title: 'A graded filter: its edge moving across 50 mm of the part', code: [
                'let t = clamp(p_local.x * S_local / mm(50.0) + 0.5, 0.0, 1.0);   // 0 .. 1 along the object\'s x',
                'm = coatMaterial(m, 1u, 0.0, 1.0, mix(450.0, 650.0, t), 20.0, 1.8);'] },
            { title: 'An anti-reflective face', code: 'm = coatMaterial(m, 1u, 0.0, 0.0, 550.0, 20.0, 1.8);' },
            { title: 'Roughness from noise, cells 5 mm across', code: 'm.roughness = mix(0.05, 0.6, srfNoise(p_local * S_local / mm(5.0), 1u));' },
            { title: 'A checker fixed in the world', code: 'm.baseColor = mix(m.baseColor, VEC3(0.05), step(0.0, sin(p.x * 3.0) * sin(p.y * 3.0) * sin(p.z * 3.0)));' },
            { title: 'Stripes 2 mm wide, moving with the object', code: [
                'let q = p_local * S_local / mm(1.0);',
                'm.baseColor = select(m.baseColor, VEC3(0.9, 0.1, 0.1), fract(q.x / 4.0) < 0.5);'] },
            { title: 'Brushed along the object\'s x', code: [
                'm.tangent = grainAlong(R_local, VEC3(1.0, 0.0, 0.0));',
                'm.anisotropy = 0.8;',
                'm.roughness = mix(0.15, 0.35, streaksAlong(p_local * S_local / mm(1.0), VEC3(1.0, 0.0, 0.0), 0.02, 2.0));'] },
            { title: 'Turned: circles about the object\'s z', code: [
                'm.tangent = grainAround(R_local, p_local, VEC3(0.0, 0.0, 1.0));',
                'm.anisotropy = 0.8;'] },
            { title: 'Colour by height in the world', code: 'm.baseColor = mix(VEC3(0.1, 0.3, 0.8), VEC3(0.9, 0.9, 0.9), smoothstep(0.0, metres(1.0), p.z));' },
            { title: 'Faces turned up one material, the rest another', code: 'm = mixMaterials(m, makeMetal(VEC3(0.9, 0.7, 0.3), 0.2), smoothstep(0.6, 0.8, n.z));' },
            { title: 'Glowing in stripes (a glowing material)', code: 'm.emissive = m.emissive * step(0.5, fract(p_local.x * 4.0));' },
        ],
        fns: ['Materials', 'Noise', 'Units'],
        cannot: 'MATERIAL_CANNOT',
    },
    relief: {
        label: 'a relief\'s code',
        runs: 'at every march step near an object wearing the material',
        reads: [
            { name: 'q', type: 'VEC3', text: 'the point in mm, in the frame of the object wearing it: the relief moves and turns with the object' },
            { name: 'world', type: 'VEC3', text: 'the same point in mm in the scene\'s frame, for what is level in the scene whichever way the part is turned (naming it costs nothing else)' },
            { name: 'amplitude', type: 'f32', text: 'every relief\'s parameter: the most h reaches either way, mm -- h is clamped to it' },
        ],
        sets: [
            { name: 'h', code: () => 'h = amplitude * sin(q.x * TAU / 2.0);', brief: 'the height there, mm, outward from the surface (negative is in); clamped to ±amplitude' },
            { name: 'slope', code: () => 'slope = amplitude * TAU / 2.0;', brief: 'a bound on how steep h is anywhere (mm per mm): every distance is divided by 1 + slope. Too small and the march steps through bumps; too large only slows it' },
        ],
        recipes: [
            { title: 'Grooves along the object\'s y, 2 mm apart', code: [
                'let k = TAU / 2.0;                     // 2 mm a period',
                'h = amplitude * sin(q.x * k);',
                'slope = amplitude * k;                 // exact: |d/dx sin| is at most 1'] },
            { title: 'Rings about the object\'s z, 1.5 mm apart', code: [
                'let k = TAU / 1.5;',
                'h = amplitude * sin(length(q.xy) * k);',
                'slope = amplitude * k;                 // a distance from the axis grows at most 1 per mm'] },
            { title: 'Knurled: two sets of grooves crossed at 90°, 1.5 mm apart', code: [
                'let k = TAU / 1.5;',
                'let u = (q.x + q.y) * 0.70710678;',
                'let v = (q.x - q.y) * 0.70710678;',
                'h = amplitude * sin(u * k) * sin(v * k);',
                'slope = amplitude * k;                 // |grad| = amplitude k sqrt(cos² sin² + sin² cos²), at most amplitude k'] },
            { title: 'Bumps from noise, about 8 mm across (the noise relief)', code: [
                'let peak = nzFbmLip(4u, 1.0, 0.5, 1.0);',
                'let nz = fbm3(q / 8.0, 1u, 4u, 2.0, 0.5);',
                'h = amplitude * nz.w / peak;',
                'slope = amplitude / 8.0 * nzFbmLip(4u, 2.0, 0.5, NZ_GRAD_LIP_MEASURED) / peak;'] },
            { title: 'Dents in cells 6 mm across (hammered)', code: [
                'let w = worley3(q / 6.0, 7u);',
                'let dent = 1.0 - clamp(w.x, 0.0, 1.0);',
                'h = -amplitude * dent * dent;',
                'slope = 2.0 * amplitude / 6.0;'] },
            { title: 'Layers level in the scene, 0.2 mm each', code: [
                'let s = 2.0 * fract(world.z / 0.2) - 1.0;',
                'h = amplitude * (1.0 - s * s - 2.0 / 3.0);',
                'slope = 4.0 * amplitude / 0.2;'] },
        ],
        fns: ['Noise', 'Units'],
        cannot: [
            { name: 'the material\'s settings', why: 'A relief is shape: it runs in the march, where no material has been asked yet. It reads its own parameters (+ in its parameters header), not the material\'s or its code\'s.' },
            { name: 'n, the normal', why: 'There is none yet: the relief is part of what the normal is taken from (by differences).' },
            { name: 'the object\'s own parameters', why: 'One relief is shared by every object wearing the material.' },
        ],
    },
    object: {
        label: 'an object\'s code',
        runs: 'at every march step',
        reads: [
            { name: 'p', type: 'VEC3', text: 'the point, in the object\'s own frame and the scene\'s unit' },
            { name: 'C', type: 'Hit', text: 'the Hit to fold the shape into' },
            { name: 'MATERIAL', type: 'u32', text: 'the object\'s material' },
        ],
        sets: [
            { name: 'C', code: () => 'C = add_new(C, Nsphere(p, 0.5), MATERIAL);', brief: 'a shape folded in: every object\'s code is this call, with a shape -- any function under Shapes below' },
        ],
        recipes: [
            { title: 'Two spheres melted together', code: 'C = add_new(C, csgUnion(Nsphere(p - VEC3(0.3, 0.0, 0.0), 0.4), Nsphere(p + VEC3(0.3, 0.0, 0.0), 0.4), 0.1), MATERIAL);' },
            { title: 'A box with a hole through it', code: 'C = add_new(C, csgSubtract(NboxRounded(p, VEC3(0.5), 0.02), Ncylinder(p, 1.0, 0.2), 0.0), MATERIAL);' },
            { title: 'A wavy floor', code: 'C = add_new(C, sd((p.z - 0.1 * sin(p.x * 10.0)) / 1.5), MATERIAL);   // the slope reaches 1: divided by 1.5, never more than the distance' },
            { title: 'A ring', code: 'C = add_new(C, Ntorus(p, 0.5, 0.1), MATERIAL);' },
        ],
        fns: ['Shapes with a normal', 'Joining shapes', 'Shapes with a distance only', 'Building shapes in 2D', 'Putting shapes into the scene', 'Noise', 'Units'],
    },
    group: {
        label: 'a group\'s code',
        runs: 'at every march step, around its children',
        reads: [
            { name: 'p', type: 'VEC3', text: 'the point in the group\'s frame: assign it to move what is in it' },
            { name: 'C', type: 'Hit', text: 'the Hit' },
            { name: 'r', type: 'Ray', text: 'the ray' },
            { name: 'XF_S', type: 'f32', text: 'this frame\'s units in world units' },
            { name: 'SURFACE_ONLY', type: 'bool', text: 'true when nothing above reads more than where the surface is' },
            { name: 'READ_REACH', type: 'f32', text: 'how far off the surface anything above reads it' },
            { name: 'DIVIDED_ABOVE', type: 'bool', text: 'for foldRelief in a CSG group' },
        ],
        sets: [
            { name: 'C', code: () => 'C = children(C, p);', brief: 'its children evaluated at p and folded in: call it to show them' },
            { name: 'p', code: () => 'p = p - VEC3(0.0, 0.0, 0.1);', brief: 'where the children are asked; after a change that is not a plain move or turn, warp(k)' },
        ],
        recipes: [
            { title: 'A twist about z', code: ['let a = 2.0 * p.z;', 'p = VEC3(cos(a) * p.x - sin(a) * p.y, sin(a) * p.x + cos(a) * p.y, p.z);', 'warp(0.5);', 'C = children(C, p);'] },
            { title: 'Rounded by 0.1', code: ['var H = children(emptyHit(r), p);', 'H.s.w -= 0.1 * XF_S;', 'C = fold(C, H.s, H.m);'] },
            { title: 'Mirrored across x = 0', code: ['p.x = abs(p.x);', 'warp(1.0);', 'C = children(C, p);'] },
        ],
        fns: ['Putting shapes into the scene', 'Joining shapes', 'Noise', 'Units'],
    },
    functions: {
        label: 'the scene\'s functions',
        runs: 'when the other blocks call them',
        reads: [],
        sets: [],
        recipes: [
            { title: 'A function the other blocks can call', code: ['fn ring(p: VEC3, R: f32, r: f32) -> VEC4 {', '    return Ntorus(p, R, r);', '}'] },
        ],
        fns: ['Putting shapes into the scene', 'Shapes with a normal', 'Joining shapes', 'Noise', 'Units', 'Materials'],
    },
}
/** A block's sets and cannot, the names resolved */
export const setsOf = kind => { const s = CODE_BLOCKS[kind]?.sets; return s === 'MATERIAL_SETS' ? MATERIAL_SETS : s ?? [] }
export const cannotOf = kind => { const s = CODE_BLOCKS[kind]?.cannot; return s === 'MATERIAL_CANNOT' ? MATERIAL_CANNOT : s ?? [] }
/** A recipe's text: its lines joined */
export const recipeText = r => Array.isArray(r.code) ? r.code.join('\n') : r.code
/** A function's call as inserted: its name and its arguments' names, `fbm3(p, seed, octaves, lac, gain)` */
export const callOf = sig => {
    const m = /^(\w+)\(([^)]*)\)/.exec(sig)
    return m ? `${m[1]}(${m[2].split(',').map(a => a.split(':')[0].trim()).filter(Boolean).join(', ')})` : sig
}
