//======================================================================================================================
// MATERIALS -- what a builder material is: the fields of Material2 as parameters, plus an optional
// WGSL block for anything procedural.
//
// PARAMETERS FIRST, CODE SECOND, AND SPEED IS WHY. The SDF runs at every march step, for every
// normal difference and every shadow ray -- hundreds of times per ray. getMaterial2 runs about
// once per bounce. So a material never evaluates inside the SDF: the SDF carries a material id
// (as it always has) and the material is looked up at the hit. Each field is a uniform, so
// dragging a colour or a roughness is a uniform write, never a compile; a material with no code
// costs a switch case of plain assignments. THE ONE EXCEPTION IS ITS RELIEF (RELIEFS, at the end):
// a height on the surface is shape, so it is in the SDF, around every object wearing the material --
// and paid there, at every march step near those objects.
//
// THE PALETTE IS GONE. A material used to name an entry of the hand-written switch in
// scenes/common.js. PALETTE_V3 below turns every such entry into the same material as data: the
// plain ones into parameters, reproduced through JS mirrors of the WGSL constructors in
// lib/pathtracer/core/materials.js (so each line here can be checked against the one there),
// the procedural ones into code blocks holding their original WGSL. A version 3 file therefore
// renders as it did.
//======================================================================================================================

/** Every field of Material2 a material sets -- only those the shader reads, since each is a
 *  control in the panel (`model` and `clearcoat` were here and did nothing; model.js 7, 8) -- in
 *  declaration order, with its uniform type and
 *  its default -- makeDefaultMaterial()'s values -- and the range the panel offers. `emissive` is
 *  split into a colour and a LUMINANCE in cd/m^2, because a colour picker is 0..1 and light is
 *  not. The colour is only a hue: codegen divides it by its own luminance, so the number alone
 *  is how bright the surface is -- 300 a monitor, 5000 a frosted bulb, 20 000 a fluorescent tube,
 *  1.6e9 the sun. It was a unitless `emissiveStrength` multiplying the colour, so a blue light
 *  of strength 5 was a fifth as bright as a white one. See lib/pathtracer/core/photometry.js. */
export const FIELDS = {
    baseColor:          { type: 'vec3<f32>', def: { r: 0.8, g: 0.8, b: 0.8 } },
    metallic:           { type: 'f32', def: 0.0, gui: { min: 0, max: 1, step: 0.001 } },
    roughness:          { type: 'f32', def: 0.5, gui: { min: 0, max: 1, step: 0.001 } },
    anisotropy:         { type: 'f32', def: 0.0, gui: { min: -1, max: 1, step: 0.001 } },
    specular:           { type: 'f32', def: 0.5, gui: { min: 0, max: 1, step: 0.001 } },
    specularTint:       { type: 'f32', def: 0.0, gui: { min: 0, max: 1, step: 0.001 } },
    transmission:       { type: 'f32', def: 0.0, gui: { min: 0, max: 1, step: 0.001 } },
    ior:                { type: 'f32', def: 1.0, gui: { min: 1, max: 2.5, step: 0.001 } },
    /* DISPERSION (0.40.0; core/materials.js abbe, core/spectral.js cauchyN): the Abbe number V_d, ior being the index
       at the d line (587.6 nm) -- the two numbers a glass catalogue gives: BK7 1.517 and 64.2, a dense flint 1.75 and
       28. 0 = none, the default. Lower is more dispersive. ONLY IN THE SHADER WHILE ABOVE 0 (`only`, as the colour
       depth): a file without it compiles to the text it did, and the first value is a compile. */
    abbe:               { type: 'f32', def: 0.0, gui: { min: 0, max: 100, step: 0.1 }, only: v => v > 0 },
    /* ABSORPTION INSIDE (0.37.0; core/materials.js attenuationDistance): the depth, in REAL MILLIMETRES whatever the
       scene's unit (as a material's lengths are), at which light inside has been filtered to the colour. 0 = none:
       the colour tints a ray at each crossing, whatever the thickness, as before. ONLY IN THE SHADER WHILE IT IS
       ABOVE 0 (codegen `only`): every file before it compiles to the text it did (the golden shaders), and the first
       value above 0 is a compile (demo.js live); after that it is a uniform like any field. */
    attenuationDistance: { type: 'f32', def: 0.0, gui: { min: 0, step: 0.01 }, only: v => v > 0 },
    /* A COATING (0.39.0; core/materials.js coat, core/spectral.js): a thin-film stack whose reflectance replaces the
       surface's Fresnel -- a dichroic, a beam splitter, an anti-reflective layer. `coating` says where it is (COATING
       below; 0 none), and the rest what it is: R from coatLow below the edge to coatHigh above it, the edge at
       coatEdge nm head-on, coatWidth nm from 10 % to 90 %, moving to shorter wavelengths with the angle through the
       stack's effective index coatIndex. Each channel reflects R averaged over that channel's wavelengths (the "looks"
       method: exact for an R that is the same at every wavelength, an approximation of the spectrum for an edge).
       ALL SIX ONLY IN THE SHADER WHILE coating IS ABOVE 0 (`only`, as the colour depth): a material without one
       compiles to the text it did, and putting one on is a compile (demo.js live); after that each is a uniform. The
       defaults, once on: a dichroic that reflects red, above 600 nm, and passes the rest. On a metal (0.next) the
       stack lies over the metal, which reflects what the coating passes (core/materials_pbr.js metalFresnel). */
    coating:            { type: 'u32', def: 0, gui: { options: { 'none': 0, 'entry faces (AR back)': 1, 'entry faces (bare back)': 2, 'every face': 3 } },
                          only: v => v > 0, onlyHelp: 'a compile to put on or take off a coating (from none); between the others it is live' },
    coatLow:            { type: 'f32', def: 0.0, gui: { min: 0, max: 1, step: 0.001 }, coat: true },
    coatHigh:           { type: 'f32', def: 1.0, gui: { min: 0, max: 1, step: 0.001 }, coat: true },
    coatEdge:           { type: 'f32', def: 600.0, gui: { min: 380, max: 780, step: 0.5 }, coat: true },
    coatWidth:          { type: 'f32', def: 20.0, gui: { min: 0, max: 200, step: 0.5 }, coat: true },
    coatIndex:          { type: 'f32', def: 1.8, gui: { min: 1, max: 3, step: 0.01 }, coat: true },
    /* HAZE (0.81.0; core/materials.js haze, roadmap/DIFFUSERS.md B1): of what passes through the surface (transmission),
       the share diffused -- Lambertian on the far side -- instead of going straight, as ASTM D1003 defines a sheet's haze.
       Clear acrylic with a veil is transmission 1 and haze 0.1; an opal sheet, paper or a lampshade haze 1, with
       transmission what passes. Roughness is the other, narrow blur (a datasheet's clarity). Every face a ray crosses
       scatters it: for a sheet's datasheet numbers, faceForSheet (below). 0 = all that passes refracts, the default and
       every material before it. It was `translucency`, a share of the diffuse base, which transmission 1 leaves none of
       -- "translucency only works when transmission is < 1" (the user, 2026-10-30). ONLY IN THE SHADER WHILE ABOVE 0
       (`only`, as the colour depth): a file without it compiles to the text it did, and the first value is a compile.
       Shown whatever transmission is (its help says it is a share of it): showing it only above 0 would rebuild the
       panel under a transmission slider being dragged up from 0. */
    haze:               { type: 'f32', def: 0.0, gui: { min: 0, max: 1, step: 0.001 }, only: v => v > 0 },
    /* SCATTER INSIDE (0.82.0; core/materials.js scatterDistance, core/haze.js THE MEDIUM'S WALK, roadmap/DIFFUSERS.md A):
       the mean free path between scatterings in the material's volume, in REAL MILLIMETRES whatever the scene's unit (as
       the colour depth), and each scattering's asymmetry (Henyey-Greenstein's g: 0 evenly, towards 0.95 forward). Haze
       scatters at the faces, whatever the thickness; this in the volume, so a thick part is milkier than a thin one --
       milky glass, a light guide's diffusing body. It acts where light travels inside, so only with transmission. 0 =
       a clear volume, the default. ONLY IN THE SHADER WHILE ABOVE 0 (`only`, as the colour depth), and the asymmetry
       only with it: a file without it compiles to the text it did, and its first value is a compile -- the march has
       the walk only for a scene that has one (codegen's scene.scatter). */
    scatterDistance:    { type: 'f32', def: 0.0, gui: { min: 0, step: 0.01 }, only: v => v > 0 },
    scatterAnisotropy:  { type: 'f32', def: 0.0, gui: { min: -0.95, max: 0.95, step: 0.01 }, only: (v, P) => P?.scatterDistance > 0 },
    emissive:           { type: 'vec3<f32>', def: { r: 1, g: 1, b: 1 } },
    emissiveLuminance:  { type: 'f32', def: 0.0, gui: { min: 0, step: 1 } },
}

/* THE SCENE'S OPTICAL FEATURES (0.83.0; roadmap/LIGHT_MODEL.md S0a): which of the fields above a scene has at all. The
   user, 2026-10-30: "I'd rather not have automatic rules -- a choice somewhere that shows extra properties per material.
   Dispersion is a trace parameter now, but it could be a scene setting: no dispersion, and the materials' Abbe numbers
   are not shown either. More or fewer options, depending on what the user knows." A feature OFF is the scene compiled
   as if no material had its fields (model.js toTree puts them at their defaults, so `only` leaves them out of the
   shader, byte for byte), and the panels, the parameter registry and the timeline do not offer them. Their values stay
   in the file: switching it on again brings them back. The picture and the Optics page alike, since both trace the
   scene's own code (the user, 2026-11-02: "follows the scene"). Every feature on is every scene before it, and the
   default. Switching one is a compile, as the first coating always was ("everything through the compile", the user,
   2026-11-02: dispersion was a live render setting, `dispersionOff`, 0.74.0 -- gone).
   A material's OWN CODE that writes one of these fields itself is not stopped: a feature hides the fields, not code. */
/** Each: its label, its material fields, what a material keeps when it is off (the panel's line), and its help. */
export const FEATURES = {
    dispersion: { label: 'Dispersion', fields: ['abbe'], hides: 'an Abbe number',
        help: 'Glass with an Abbe number splits white light into its colours where it refracts: prisms, a lens\'s colour fringes. '
            + 'Off, every glass bends all colours alike, at its index, and its Abbe number is not shown -- no fringes, and none of the '
            + 'colour noise they take to settle.' },
    absorption: { label: 'Absorption inside', fields: ['attenuationDistance'], hides: 'a colour depth',
        help: 'A material\'s colour depth: light inside glass or a liquid filtered to its colour over that depth, so a thick part '
            + 'is deeper in colour than a thin one. Off, the colour tints a ray at each crossing, whatever the thickness, and the '
            + 'colour depth is not shown.' },
    coatings: { label: 'Coatings', fields: ['coating', ...Object.keys(FIELDS).filter(k => FIELDS[k].coat)], hides: 'a coating',
        help: 'Thin-film coatings in place of a surface\'s own reflection: dichroics, beam splitters, anti-reflective layers. '
            + 'Off, every surface reflects as its index says, and the coating box is not shown.' },
    /* THE OPTICS TRACE BY WAVELENGTH (0.83.0; roadmap/LIGHT_MODEL.md S2; the user, 2026-11-04: "a feature 'spectral', off by
       default", over an always-spectral trace). No material field of its own: it compiles the Optics page's trace
       spectral (optics/kernels.js), and the picture stays RGB. OFF BY DEFAULT, the one feature that is: every scene
       before it measured in RGB, and Full keeps it so; Expert is Full with it. */
    spectral: { label: 'Spectral optics trace', fields: [], hides: null, def: false,
        help: 'The Optics page traces each ray at three wavelengths of its light\'s spectrum, instead of as a colour: coatings '
            + 'and coloured glass act by wavelength, and a detector records the spectrum it receives -- its Spectrum chart, its '
            + 'colour rendering index. The picture is unchanged. Each ray\'s brightness is now a draw of its wavelengths, so a '
            + 'reading takes more rays to settle (1 200 to 2 700 rays for a colour within 0.001 u\'v\', on the cases worked out), where '
            + 'the colour trace was off by 6 to 10 % through a sharp filter; off, the trace is the colour trace it always was.' },
    /* OPTICS ANALYSIS (0.83.0; the user, 2026-11-04: detectors and ray limiters "should be an object property ... Maybe make
       a new scene setting 'optical features -> analysis' that hides or shows these. Maybe it also hides the rays overlay
       and illuminance, luminance views"). No material field: it is whether the scene's objects may be detectors and ray
       limiters (model.js OPTICS_ROLES) -- off, every role is kept and does nothing, and the Optics-Analysis box, the rays
       in the view's drawer and the illuminance and luminance views are not offered. OFF FOR A NEW SCENE (the user's
       choice), on for an older one that had a detector or a limiter (model.js v26to27). NOT IN THE PRESETS (`preset:
       false`): Basic, Full and Expert are about the physics traced, and leave it as it is. */
    analysis: { label: 'Optics analysis', fields: [], hides: null, def: false, preset: false,
        help: 'Objects can be detectors and ray limiters for the Optics page (each object\'s Optics-Analysis box), and the view '
            + 'offers the rays drawn over it and the illuminance and luminance views. Off, none of it is shown and a role an '
            + 'object has does nothing, though it is kept. The picture is unchanged.' },
}
/** A feature's default: on, but for one that says otherwise (spectral). */
export const featureDefault = k => FEATURES[k]?.def ?? true
/** The presets, in the order shown: Basic is none of them; Full every feature at its default -- every material field, the
 *  colour trace -- the default and every scene before the features; Expert all of them (0.83.0: Full and the spectral
 *  trace). "Optics" is Quality's word already (lib/pathtracer/quality.js). */
/** ...of the features a preset sets: not one that says `preset: false` (analysis), which the presets leave alone */
export const PRESET_FEATURES = Object.keys(FEATURES).filter(k => FEATURES[k].preset !== false)
export const FEATURE_PRESETS = {
    basic:  { label: 'Basic',  values: Object.fromEntries(PRESET_FEATURES.map(k => [k, false])) },
    full:   { label: 'Full',   values: Object.fromEntries(PRESET_FEATURES.map(k => [k, featureDefault(k)])) },
    expert: { label: 'Expert', values: Object.fromEntries(PRESET_FEATURES.map(k => [k, true])) },
}
const FEATURE_OF_FIELD = Object.fromEntries(Object.entries(FEATURES).flatMap(([f, d]) => d.fields.map(k => [k, f])))
/** The feature a material field belongs to, or null for one every scene has. */
export const featureOfField = k => FEATURE_OF_FIELD[k] ?? null
/** Whether a field is part of a scene with these features (model.js featuresOf: every key there). */
export const fieldOn = (features, k) => { const f = FEATURE_OF_FIELD[k]; return !f || (features?.[f] ?? featureDefault(f)) !== false }
/* ...the coating's values are in the shader exactly while it has one: a value of theirs is `only` its material's
   coating being on (codegen passes the material's params, demo.js and params.js ask the same) */
for (const f of Object.values(FIELDS)) if (f.coat) f.only = (v, P) => P?.coating > 0
/** The coating's values, without `coating` itself: codegen writes them in one call (core/materials.js coatMaterial),
 *  and the panel shows them only while there is a coating. */
export const COAT_FIELDS = Object.keys(FIELDS).filter(k => FIELDS[k].coat)
/** Whether a material's params have a coating on. */
export const hasCoating = P => P?.coating > 0

/** What a new material's code block starts as: comments only, so it costs nothing until
 *  something is written (codegen skips a block with no code left once comments are removed --
 *  and it looks for p_local only there too, so mentioning it here does not switch it on). */
export const MATERIAL_CODE_TEMPLATE = [
    '// Material code: runs once where a ray hits, after the settings above are put into m.',
    '// It changes m, the material at that hit, a field at a time: WGSL, each line ending in ;',
    '// e.g. a number, a colour (linear red, green, blue), a coating (a dichroic reflecting red):',
    '//   m.roughness = 0.2;',
    '//   m.baseColor = VEC3(1.0, 0.5, 0.0);',
    '//   m = coatMaterial(m, 1u, 0.0, 1.0, 600.0, 20.0, 1.8);',
    '// It reads p and n, the hit and its normal in the world; p_local, the hit in the object\'s',
    '// own frame, so a pattern moves with it; and its parameters (+ above) by name -- one marked',
    '// as a length is in real mm. n cannot be changed: a relief (below) changes the shape.',
    '// INSERT, under this box, lists every field of m with the line that sets it, all it can read',
    '// and call, and recipes: click one to put it here. Ctrl+Enter applies.',
    '',
].join('\n')

const rgb = (r, g, b) => ({ r, g, b })
const clamp01 = v => Math.min(1, Math.max(0, v))

/** makeDefaultMaterial(): the field defaults, as a fresh object. */
export const defaults = () => Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, structuredClone(f.def)]))

//----------------------------------------------------------------------------------------------
// JS mirrors of the WGSL constructors in lib/pathtracer/core/materials.js -- same names, same
// arguments, same assignments, in the same order. They exist for the presets and for the
// palette upgrade, and are only as right as that correspondence, so keep them next to it.
//----------------------------------------------------------------------------------------------
export const make = {
    default: () => defaults(),
    // a pure Lambertian now -- specular 0, no coat (see makeDiffuse in core/materials.js)
    diffuse: (color, roughness) => ({ ...defaults(), baseColor: color, roughness: clamp01(roughness),
        metallic: 0, specular: 0, transmission: 0, ior: 1.5 }),
    /* makeDiffuse as it was when version 3 files were written: a 4% coat. Only the palette upgrade
       uses it, so a version 3 file still renders as it did. */
    diffuseV3: (color, roughness) => ({ ...defaults(), baseColor: color, roughness: clamp01(roughness),
        metallic: 0, specular: 0.5, transmission: 0, ior: 1.5 }),
    mirror: (color) => ({ ...defaults(), baseColor: color, metallic: 1, roughness: 0, specular: 1, transmission: 0 }),
    plastic: (color, roughness, specular) => ({ ...defaults(), baseColor: color, metallic: 0,
        roughness: clamp01(roughness), specular: clamp01(specular), transmission: 0, ior: 1.5 }),
    metal: (color, roughness) => ({ ...defaults(), baseColor: color, metallic: 1, roughness: clamp01(roughness),
        specular: 1, transmission: 0 }),
    glassSmooth: (color, ior) => ({ ...defaults(), baseColor: color, metallic: 0, roughness: 0, specular: 0.5,
        transmission: 1, ior: Math.max(ior, 1) }),
    glassRough: (color, ior, roughness) => ({ ...make.glassSmooth(color, ior), roughness: clamp01(roughness) }),
    // makeEmissive sets emissive = color; here that is a hue and a luminance in cd/m^2
    emissive: (color, luminance = 1000) => ({ ...defaults(), emissive: color, emissiveLuminance: luminance, ior: 1 }),
}

/** A SHEET'S FACES FROM ITS DATASHEET (0.81.0): a sheet whose every transmitted ray is diffused (haze 1: an opal sheet,
 *  paper) and whose datasheet gives a total transmittance T (0..1, both faces, no absorption). Each face passes t and
 *  reflects 1 - t, diffusely, and the light between the two adds up to T = t^2 / (1 - (1 - t)^2) = t / (2 - t), so the
 *  face's transmission is t = 2 T / (1 + T), its haze 1. For a white base with specular 0 (no gloss on top, which would
 *  reflect a few % more at each face); core/test/transmission.test.mjs walks it. A clear sheet's haze compounds over its
 *  two faces about as 1 - (1 - h)^2 (the help's table, from the same walk: hazeOfSheetJS). */
export const faceForSheet = T => { const t = Math.min(1, Math.max(0, +T || 0)); return { transmission: 2 * t / (1 + t), haze: 1 } }

/** What + under Materials offers: a label and the parameters it starts from. */
export const PRESETS = {
    diffuse: { label: 'diffuse', params: () => make.diffuse(rgb(0.8, 0.8, 0.8), 1.0) },
    plastic: { label: 'plastic', params: () => make.plastic(rgb(0.8, 0.2, 0.2), 0.4, 0.5) },
    metal:   { label: 'metal',   params: () => make.metal(rgb(0.9, 0.9, 0.9), 0.2) },
    mirror:  { label: 'mirror',  params: () => make.mirror(rgb(0.9, 0.9, 0.9)) },
    glass:   { label: 'glass',   params: () => make.glassSmooth(rgb(1, 1, 1), 1.5) },
    emissive:{ label: 'glowing',  type: 'emitter', params: () => make.emissive(rgb(1, 0.95, 0.9), 20000) },
}

/** WHICH FIELDS EACH MATERIAL TYPE USES (model.js MATERIAL_TYPES): what the panel shows and what
 *  codegen assigns. Every field is still a uniform for every material, so switching the type
 *  back and forth loses nothing and never writes to a uniform that is not there. An emitter is
 *  emission alone -- a surface that emits ends every path that reaches it (materials_pbr.js), so
 *  its other fields never did anything; a surface has no emission. (A detector and a limiter were types too until 0.83.0:
 *  an object's optics role now, model.js OPTICS_ROLES.) */
const SURFACE_FIELDS = ['baseColor', 'metallic', 'roughness', 'anisotropy', 'specular', 'specularTint', 'transmission', 'haze', 'ior',
    'abbe', 'attenuationDistance', 'scatterDistance', 'scatterAnisotropy', 'coating', 'coatLow', 'coatHigh', 'coatEdge', 'coatWidth', 'coatIndex']
export const FIELDS_OF = {
    surface: SURFACE_FIELDS,
    emitter: ['emissive', 'emissiveLuminance'],
}
/** What the panel calls a field, where its name says too little */
export const FIELD_LABELS = { emissive: 'colour', emissiveLuminance: 'luminance (cd/m\u00b2)',
    attenuationDistance: 'colour depth (mm)', abbe: 'Abbe number (dispersion)', coating: 'coating', coatLow: 'R below edge', coatHigh: 'R above edge',
    coatEdge: 'edge (nm)', coatWidth: 'edge width (nm)', coatIndex: 'stack index', haze: 'haze',
    scatterDistance: 'scatter distance (mm)', scatterAnisotropy: 'scatter forward (g)' }
/** What a coating is for, put on in one click (the panel's coating presets): values for the coating fields. A beam
 *  splitter and an AR layer are the same at every wavelength, so their edge does nothing. */
export const COAT_PRESETS = {
    'dichroic: reflects red': { coatLow: 0, coatHigh: 1, coatEdge: 600, coatWidth: 20, coatIndex: 1.8 },
    'dichroic: reflects blue': { coatLow: 1, coatHigh: 0, coatEdge: 500, coatWidth: 20, coatIndex: 1.8 },
    'beam splitter 50/50': { coatLow: 0.5, coatHigh: 0.5 },
    'anti-reflective': { coatLow: 0, coatHigh: 0 },
}

//----------------------------------------------------------------------------------------------
// The palette, as data. Each entry transcribes its case in scenes/common.js getMaterial2.
//----------------------------------------------------------------------------------------------
const pet = rgb(33 / 255, 100 / 255, 119 / 255)
const ora = rgb(255 / 255, 127 / 255, 0 / 255)
const WGSL_PET = 'VEC3(33.0/255.0, 100.0/255.0, 119.0/255.0)'
const WGSL_ORA = 'VEC3(255.0/255.0, 127.0/255.0, 0.0/255.0)'

export const PALETTE_V3 = {
    MAT_PMMA:        { params: { ...make.glassSmooth(rgb(0.8, 0.79, 1.0), 1.5), specularTint: 0.1 } },
    MAT_MIRROR:      { params: make.mirror(rgb(0.9, 0.9, 0.9)) },
    MAT_DIFF_WHITE:  { params: make.diffuseV3(rgb(0.95, 0.95, 0.95), 0.3) },
    MAT_DIFF_BLUE:   { params: make.diffuseV3(rgb(0, 0, 1), 1.0) },
    MAT_DIFF_RED:    { params: make.diffuseV3(rgb(1, 0, 0), 1.0) },
    MAT_DIFF_PETROL: { params: { ...make.plastic(pet, 0.5, 0.6) } },
    MAT_DIFF_ORANGE: { params: { ...make.plastic(ora, 0.6, 0.5) } },
    MAT_BASIC_PET:   { params: { ...make.plastic(pet, 0.35, 0.55) } },
    MAT_BRONZE:      { params: { ...make.metal(rgb(0.8, 0.6, 0.2), 0.1), specularTint: 0.3 } },
    MAT_ROUGHGLASS:  { params: make.glassRough(rgb(1.0, 0.95, 0.9), 1.5, 0.3) },
    // procedural: the parameters are the constant part, the code the part that varies
    MAT_GROUNDPLANE: {
        params: { ...make.plastic(pet, 0.4, 0.6), specularTint: 0.3 },
        code: [
            '// the old palette\'s ground: a petrol / orange checker in world space',
            `let pet = ${WGSL_PET};`,
            `let ora = ${WGSL_ORA};`,
            'm.baseColor = mix(pet, ora, smoothstep(-0.001, 0.001, sin(p.x * PI) * sin(p.y * PI) * sin(p.z * PI)));',
        ].join('\n'),
    },
    MAT_PROC_DIRPOS_CHECKER: {
        params: make.glassRough(rgb(0.95, 1.0, 0.95), 1.5, 0.0),
        code: [
            '// sandblasted checker: rough glass on alternate cells',
            'm.roughness = step(0.0, sin(p.y * 4.0) * sin(p.x * 4.0) * sin(p.z * 4.0)) * 0.4;',
        ].join('\n'),
    },
    MAT_CONDITIONAL: {
        /* in the OLD field, because this table is the 3 -> 4 step: v5to6 then converts it to a
           luminance like any other old light (model.js) */
        params: (({ emissiveLuminance, ...p }) => ({ ...p, emissive: rgb(1, 1, 1), emissiveStrength: 10, ior: 1 }))(defaults()),
        code: [
            '// petrol for x < 0, orange for x > 0, as a light',
            `m.emissive = select(${WGSL_PET}, ${WGSL_ORA}, p.x > 0.0) * 10.0;`,
        ].join('\n'),
    },
    MAT_6SIDED: {
        params: make.diffuseV3(rgb(1, 1, 1), 0.3),
        code: [
            '// a different material per face direction, blended sharply at the edges',
            'let xmin = makeDiffuse(VEC3(1.0, 1.0, 1.0), 0.3);',
            'let xmax = makeMetal(VEC3(0.99, 0.5, 0.4), 0.2);',
            'let ymin = makeDiffuse(VEC3(0.0, 0.5, 1.0), 0.3);',
            'let ymax = makeDiffuse(VEC3(0.0, 0.5, 1.0), 0.3);',
            'let zmin = makeDiffuse(VEC3(1.0, 1.0, 1.0), 0.3);',
            'let zmax = makeDiffuse(VEC3(1.0, 1.0, 1.0), 0.3);',
            'let e = 1.0 / 0.010;',
            'let nn = normalize(n);',
            'let wxmin = pow(clamp(-nn.x, 0.0, 1.0), e); let wxmax = pow(clamp(nn.x, 0.0, 1.0), e);',
            'let wymin = pow(clamp(-nn.y, 0.0, 1.0), e); let wymax = pow(clamp(nn.y, 0.0, 1.0), e);',
            'let wzmin = pow(clamp(-nn.z, 0.0, 1.0), e); let wzmax = pow(clamp(nn.z, 0.0, 1.0), e);',
            'let wsum = wxmin + wxmax + wymin + wymax + wzmin + wzmax + 1e-6;',
            'm = xmin;',
            'm = mixMaterials(m, xmax, wxmax / wsum);',
            'm = mixMaterials(m, ymin, wymin / wsum);',
            'm = mixMaterials(m, ymax, wymax / wsum);',
            'm = mixMaterials(m, zmin, wzmin / wsum);',
            'm = mixMaterials(m, zmax, wzmax / wsum);',
        ].join('\n'),
    },
}

//----------------------------------------------------------------------------------------------
// A MATERIAL'S RELIEF (the user, 2026-09-30: "a material can or cannot contain a surface modifier,
// and when a material is used for an object, the surface modifier gets applied"). The one part of a
// material that is in the SDF: a HEIGHT FIELD, which codegen puts around every object wearing the
// material. Its code sees `q`, the point in that object's frame IN MILLIMETRES -- real size, whatever
// the object's scale or the scene's unit (SURFACES.md, Scale) -- and, if it names it, `world`, the same
// point in the SCENE's frame in mm: for what is fixed to the scene, not the object, as a print's layers
// are level in the build volume whichever way its parts are turned. It sets
//   h      the height there, mm, outward; codegen clamps it to +-amplitude
//   slope  a bound on |grad h| (mm per mm): distances are divided by 1 + slope, so the march does
//          not step through a bump -- the same rule as the modifier groups' warp()
// `amplitude` is every relief's: the most its height reaches, which makes the clamp and the step
// bound true by construction, and lets codegen skip the whole relief more than two amplitudes away
// from the surface (where d - amplitude is already a safe distance). Its parameters are uniforms,
// live like a material's own; they are its, not the material's, so a relief's `size` and the
// material's own `size` never meet.
//----------------------------------------------------------------------------------------------
/** A relief's parameters are owned by `<material id>#relief`: the model's parameter operations, the
 *  panel and the parameter registry address it by that id (ids have no '#', so it names no node). */
export const RELIEF_SUFFIX = '#relief'
export const reliefOwner = matId => `${matId}${RELIEF_SUFFIX}`
/** The material id a relief owner names, or null for any other id. */
export const reliefMaterialId = id => typeof id === 'string' && id.endsWith(RELIEF_SUFFIX) ? id.slice(0, -RELIEF_SUFFIX.length) : null
/** Names the relief's code has in scope already: a parameter by one of them would shadow it. */
export const RELIEF_SCOPE = ['q', 'world', 'h', 'slope']

const MM = (min, max, step) => ({ min, max, step })
export const RELIEFS = {
    noise: {
        label: 'noise relief',
        params: { amplitude: 1.0, size: 8.0 },
        ranges: { amplitude: MM(0, 20, 0.01), size: MM(0.1, 200, 0.1) },
        lengths: ['amplitude', 'size'],
        code: [
            '// Noise relief: bumps up to "amplitude" mm high and deep, about "size" mm across -- four octaves',
            '// of gradient noise (lib/pathtracer/core/noise.js), in real millimetres on the object. Four noises',
            '// per march step near the surface. slope is the MEASURED gradient bound (a quarter of the proved',
            '// one, NZ_GRAD_LIP, and a quarter the steps); the normal is taken by differences.',
            'let peak = nzFbmLip(4u, 1.0, 0.5, 1.0);                 // the octaves\' amplitudes summed',
            'let n = fbm3(q / size, 1u, 4u, 2.0, 0.5);',
            'h = amplitude * n.w / peak;',
            'slope = amplitude / size * nzFbmLip(4u, 2.0, 0.5, NZ_GRAD_LIP_MEASURED) / peak;',
        ].join('\n'),
    },
    ripple: {
        label: 'ripple',
        params: { amplitude: 0.3, wavelength: 4.0 },
        ranges: { amplitude: MM(0, 20, 0.01), wavelength: MM(0.1, 200, 0.1) },
        lengths: ['amplitude', 'wavelength'],
        code: [
            '// Ripple: three crossed waves "amplitude" mm high, "wavelength" mm apart. Three sines per step.',
            'let k = 6.2831853 / wavelength;',
            'let s = sin(q * k);',
            'h = amplitude * s.x * s.y * s.z;',
            'slope = amplitude * k * 1.7320508;',
        ].join('\n'),
    },
    hammered: {
        label: 'hammered',
        params: { amplitude: 0.4, size: 6.0 },
        ranges: { amplitude: MM(0, 20, 0.01), size: MM(0.1, 200, 0.1) },
        lengths: ['amplitude', 'size'],
        code: [
            '// Hammered: a dent "amplitude" mm deep in every cell of a Worley pattern "size" mm across, with',
            '// the ridges between them sharp, as a hammer leaves them. F1 grows at most 1 per cell, so the',
            '// dent\'s slope is at most 2 amplitude / size.',
            'let w = worley3(q / size, 7u);',
            'let dent = 1.0 - clamp(w.x, 0.0, 1.0);',
            'h = -amplitude * dent * dent;',
            'slope = 2.0 * amplitude / size;',
        ].join('\n'),
    },
    /* 3D-PRINT LAYERS (the user, 2026-09-30: "a material that resembles 3d printed stuff -- horizontal ridges,
       adjustable height of the layers"). A fused-filament print is laid down in layers along its build axis,
       and each layer's bead of plastic is rounded: the side of a print is a stack of ridges with a groove where
       two beads meet. THE SCENE'S z, not the object's (the user, 2026-10-01: turned or joined parts turned their
       layers with them): a print's layers are level in the build volume, and line up across the parts of one
       print. A parabola across each layer, PINNED AT THE GROOVES -- a layer's
       own fullness scales its bead but not its ends -- so the height is continuous everywhere and its slope
       bound exact (test/model.test.mjs samples it). The groove is a crease, as between two real beads. */
    layers: {
        label: '3D-print layers',
        params: { amplitude: 0.05, layer: 0.2, variation: 0.3 },
        ranges: { amplitude: MM(0, 0.5, 0.005), layer: MM(0.02, 2, 0.01), variation: { min: 0, max: 0.6, step: 0.01 } },
        lengths: ['amplitude', 'layer'],
        code: [
            '// 3D-print layers: a bead of plastic every "layer" mm up the SCENE\'s z -- the build plate is its z = 0,',
            '// so the layers stay level and line up across parts however they are turned or joined; for a part',
            '// printed lying another way than it is shown, read the object\'s own z, q.z, in place of world.z.',
            '// Each bead rounded -- a parabola across it -- with a groove "amplitude" mm deep where it meets the',
            '// next, and a little fuller or flatter than the next, by up to "variation" of it, as a printer\'s',
            '// extrusion is never quite even; pinned at the grooves, so the height is continuous and its slope is',
            '// at most 4 (1 + variation) amplitude / layer, at a groove.',
            'let s = 2.0 * fract(world.z / layer) - 1.0;           // -1 .. 1 across one layer',
            '// this layer\'s own number: value noise at a lattice point is that point\'s value, in [-1, 1]',
            'let k = 1.0 + variation * vnoise3(vec3<f32>(0.0, 0.0, floor(world.z / layer)), 61u).w;',
            'h = amplitude * (k * (1.0 - s * s) - 2.0 / 3.0);',
            'slope = 4.0 * (1.0 + variation) * amplitude / layer;',
        ].join('\n'),
    },
}
/** The relief preset a relief is, by its code; null for code of one's own. */
export const reliefPresetOf = relief => relief ? Object.keys(RELIEFS).find(k => RELIEFS[k].code === relief.code) ?? null : null
