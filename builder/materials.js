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
       defaults, once on: a dichroic that reflects red, above 600 nm, and passes the rest. */
    coating:            { type: 'u32', def: 0, gui: { options: { 'none': 0, 'entry faces (AR back)': 1, 'entry faces (bare back)': 2, 'every face': 3 } },
                          only: v => v > 0, onlyHelp: 'a compile to put on or take off a coating (from none); between the others it is live' },
    coatLow:            { type: 'f32', def: 0.0, gui: { min: 0, max: 1, step: 0.001 }, coat: true },
    coatHigh:           { type: 'f32', def: 1.0, gui: { min: 0, max: 1, step: 0.001 }, coat: true },
    coatEdge:           { type: 'f32', def: 600.0, gui: { min: 380, max: 780, step: 0.5 }, coat: true },
    coatWidth:          { type: 'f32', def: 20.0, gui: { min: 0, max: 200, step: 0.5 }, coat: true },
    coatIndex:          { type: 'f32', def: 1.8, gui: { min: 1, max: 3, step: 0.01 }, coat: true },
    /* TRANSLUCENCY (0.next; core/materials.js translucency, roadmap/DIFFUSERS.md B1): the share of the diffuse base that
       passes THROUGH the surface instead of back off it, Lambertian on the far side -- an opal sheet, paper, a lampshade.
       Every face a ray crosses scatters it. 0 = an opaque base, the default. ONLY IN THE SHADER WHILE ABOVE 0 (`only`, as
       the colour depth): a file without it compiles to the text it did, and the first value is a compile. For a sheet
       whose datasheet gives a total transmittance T: translucencyForSheet (below). */
    translucency:       { type: 'f32', def: 0.0, gui: { min: 0, max: 1, step: 0.001 }, only: v => v > 0 },
    /* A DIFFUSER FILM (0.next; core/materials.js spreadX/spreadY, roadmap/DIFFUSERS.md B2): what the material transmits
       is spread about the straight-through direction instead of refracted, by this FWHM in degrees along the grain
       (x: the material code's m.tangent, else the frame's own) and across it (y), at EACH face a ray crosses -- so a
       film modelled as a thin sheet spreads twice: a 10 degree sheet is about 7 per face (F / sqrt 2 below about 30
       degrees; wider, and one axis much narrower than the other, it takes more: the library's films say what theirs
       are). 0 both: refraction, as always. BOTH IN THE SHADER WHILE EITHER IS ABOVE 0 (`only`): a file without them
       compiles to the text it did, and the first value is a compile. */
    spreadX:            { type: 'f32', def: 0.0, gui: { min: 0, max: 170, step: 0.1 }, only: (v, P) => P?.spreadX > 0 || P?.spreadY > 0 },
    spreadY:            { type: 'f32', def: 0.0, gui: { min: 0, max: 170, step: 0.1 }, only: (v, P) => P?.spreadX > 0 || P?.spreadY > 0 },
    emissive:           { type: 'vec3<f32>', def: { r: 1, g: 1, b: 1 } },
    emissiveLuminance:  { type: 'f32', def: 0.0, gui: { min: 0, step: 1 } },
}
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
    '// Material code: runs once per hit (cheap), after the fields above are put into m.',
    '//   m        the Material2 to change -- m.baseColor, m.roughness, m.metallic, m.emissive, ...',
    '//   p, n     the hit point and surface normal, world space;  C  the Hit',
    '//   p_local  the hit in the object\'s own frame, so a pattern moves with the object',
    '//            (costs one extra SDF evaluation per hit on this material)',
    '//   R_local  that frame\'s rotation to the world, for a direction written in it',
    '//   S_local  its scale: p_local * S_local is in scene units; metres(x) is x m in them, mm(x) x mm',
    '//   your own parameters (+ in the parameters header) by name, e.g. a colour stripe; one marked',
    '//            as a length is in real mm, whatever the scene\'s unit -- read the point in mm too:',
    '//   let q = p_local * S_local / mm(1.0);   // the point in mm, moving with the object',
    '// e.g. a checker fixed in the world:',
    '//   m.baseColor = mix(m.baseColor, VEC3(0.05), step(0.0, sin(p.x * 3.0) * sin(p.y * 3.0) * sin(p.z * 3.0)));',
    '// e.g. stripes that travel with the object:',
    '//   m.roughness = step(0.5, fract(p_local.x * 4.0)) * 0.6;',
    '// e.g. brushed along the object\'s x, for an anisotropy above 0 (or turned: grainAround):',
    '//   m.tangent = grainAlong(R_local, VEC3(1.0, 0.0, 0.0));',
    '// e.g. with a length width (mm) and a colour stripe added with +, and q as above:',
    '//   m.baseColor = mix(m.baseColor, stripe, step(fract(q.x / width), 0.5));',
    '// every function there is to call -- noise, grains, streaks: Help > Reference > Functions for code',
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

/** A SHEET'S TRANSLUCENCY FROM ITS TOTAL TRANSMITTANCE (the datasheet's T, 0..1, both faces, no absorption): each face
 *  passes t of the light and reflects 1 - t, diffusely, and the light between the two adds up to
 *  T = t^2 / (1 - (1 - t)^2) = t / (2 - t), so t = 2 T / (1 + T). For a white base with specular 0 (no gloss on top,
 *  which would reflect a few % more at each face); core/test/transmission.test.mjs walks it. */
export const translucencyForSheet = T => { const t = Math.min(1, Math.max(0, +T || 0)); return 2 * t / (1 + t) }

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
 *  its other fields never did anything; a surface and a detector have no emission; a limiter is
 *  not in the picture at all. */
const SURFACE_FIELDS = ['baseColor', 'metallic', 'roughness', 'anisotropy', 'specular', 'specularTint', 'transmission', 'ior',
    'abbe', 'attenuationDistance', 'coating', 'coatLow', 'coatHigh', 'coatEdge', 'coatWidth', 'coatIndex', 'translucency',
    'spreadX', 'spreadY']
export const FIELDS_OF = {
    surface: SURFACE_FIELDS,
    detector: SURFACE_FIELDS,
    emitter: ['emissive', 'emissiveLuminance'],
    limiter: [],
}
/** What the panel calls a field, where its name says too little */
export const FIELD_LABELS = { emissive: 'colour', emissiveLuminance: 'luminance (cd/m\u00b2)',
    attenuationDistance: 'colour depth (mm)', abbe: 'Abbe number (dispersion)', coating: 'coating', coatLow: 'R below edge', coatHigh: 'R above edge',
    coatEdge: 'edge (nm)', coatWidth: 'edge width (nm)', coatIndex: 'stack index', translucency: 'translucency',
    spreadX: 'film spread x (\u00b0 FWHM)', spreadY: 'film spread y (\u00b0 FWHM)' }
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
