
/* THE MATERIAL: one struct every material's code fills, and the makers it starts from. The model that turns it into
   light is materials_pbr.js (one GGX, core/microfacet.js). (0.22.3: the commented-out sheen, sheenTint and thin
   fields, and a header describing a Disney model this no longer is, went from here.) */

export let MATERIALS = /*wgsl*/`


//------------------------------------------------------------------------------------------------------------
// Material definitions for a physically based rendering system

struct Material2 {
  // (0.22.4: a 'model' field went from the front of this struct -- written, read by nothing since there has been one
  // GGX (core/microfacet.js), and old files lose it on loading (model.js v7to8). 16 bytes a shade queue item.)
  // Base albedo/tint in linear space. Range: [0,1].
  // Metals use this as specular tint; dielectrics use it as diffuse color.
  baseColor: vec3<f32>,
  // 0 = dielectric, 1 = metal. Range: [0,1].
  // Interpolates between diffuse+spec (dielectric) and colored spec only (metal).
  metallic: f32,
  // Perceptual roughness. Range: [0,1]. alpha = roughness^2; below alpha 1e-3 (roughness 0.0316)
  // the lobe is a perfect mirror / perfect refraction (ALPHA_MIN in core/microfacet.js).
  roughness: f32,
  anisotropy: f32, // Optional anisotropy parameter
  // Strength of a dielectric's reflective coat, as a scale on the EXACT Fresnel of its IOR:
  // 0.5 = the physical interface (ior 1.5 reflects 4% head-on), 0 = no coat at all -- a pure
  // Lambertian -- 1 = twice the physical. Transmissive materials always use the physical value.
  // (It used to set F0 = 0.08 * specular and ignore the IOR.)
  specular: f32,
  // Tints dielectric specular toward baseColor. Range: [0,1].
  // 0 = white specular, 1 = full tint by baseColor (for highly saturated dielectrics).
  specularTint: f32,
  // (clearcoat and clearcoatRoughness were here: declared, set by scenes, read by nothing.)
  // Fraction of light transmitted (glass/plastic). Range: [0,1].
  // Pair with the IOR for refraction.
  transmission: f32,
  // Index of refraction: Snell's law for transmission AND the exact Fresnel of the coat.
  // Typical: 1.3–1.7 (air = 1.0, water 1.33, glass 1.5, diamond 2.42). 1.0 means no coat.
  ior: f32,
  // ABSORPTION INSIDE (Beer-Lambert): the depth at which light travelling through this material has
  // been filtered to baseColor, in the SCENE'S unit as getMaterial2 writes it (metres once through the
  // boundary: scene_api.js materialAt). 0 = none, and then baseColor tints a transmitted ray at every
  // crossing, whatever the thickness -- what every material did before 0.37.0, and still does unless
  // this is set. Above 0 the crossing is untinted (makeLobes, transTint) and the ray loses
  // exp(-mu d) per channel over the d it travels inside, mu = -ln(baseColor) / attenuationDistance
  // (mediumMu, below): two slabs of one material, one twice as thick, now transmit t and t^2. In the
  // padding after ior: Material2 stays 80 bytes.
  attenuationDistance: f32,
  // A COATING (0.39.0; spectral.js, materials_pbr.js makeLobes): a thin-film stack on the surface whose reflectance
  // REPLACES the interface's Fresnel -- a dichroic, a beam splitter, an anti-reflective layer. R(lambda) runs from
  // R low below coatEdge (nm, at normal incidence) to R high above it, a logistic edge of 10-90 % width
  // coatWidth (nm); the edge moves to shorter wavelengths with the angle through the stack's effective index
  // coatIndex. A channel's reflectance is R averaged over that channel's wavelengths (spectral.js coatEdgeRGB). coat
  // says where it is: 0 none (the default: exact Fresnel, as always); otherwise on every face the light ENTERS the
  // material by, and on the faces it LEAVES by: 1 nothing (anti-reflective: no reflection but total internal), 2 the
  // bare interface (exact Fresnel), 3 the same coating. A plate coated on one face with an AR back -- a real dichroic
  // or plate beam splitter -- is 1: a lossless stack reflects alike from either side, so which face carries it does
  // not change what passes. specular and specularTint do nothing where a coating is. coatR is the two reflectances,
  // low and high, packed as two 16-bit unorms (pack2x16unorm: 1.5e-5 a step) -- since 0.40.0, when the dispersion's
  // abbe took coatHigh's word; coatR and coat sit in the padding after attenuationDistance and tangent, the other four
  // are the 16 bytes 0.39.0 added: Material2 is 96. Read them with coatLowHigh (below).
  coatR: u32,
  // Emitted luminance, linear Rec.709 in cd/m^2 (lib/pathtracer/core/photometry.js). Range: [0, +inf).
  // If non-zero, acts as a light emitter. The simple integrator here treats emitters as terminal events.
  emissive: vec3<f32>,
  // 1 on a LIGHT'S FACE (a builder light: codegen LIGHTS), whose light reaches the picture through its
  // own photons and the camera paths they do not own (CLS_LIGHTS): never discovered as an emitter,
  // never handed to the emitter photons, never weighted against emitter light sampling
  // (materials_pbr.js, the emissive branch says why). 2 on a TRANSPARENT light's face, which lets the
  // path through as it glows. 0 otherwise; only codegen sets it.
  lightTraced: u32,
  // THE GRAIN: the direction, world space, that the surface's grooves or brush strokes run in --
  // what anisotropy is measured against. Any length; makeLobes projects it onto the surface.
  // Zero (the default) is no grain: the frame is the old one built from the normal alone, whose
  // tangent is horizontal in the WORLD and jumps near the poles, and anisotropy keeps its old,
  // unsigned meaning there, so no material written before this changes. See grainAlong below.
  tangent: vec3<f32>,
  coat: u32,               // where the coating is: 0 none, 1 entering (AR leaving), 2 entering (bare leaving), 3 both
  /* DISPERSION (0.40.0; spectral.js cauchyN): the Abbe number V_d = (n_d - 1) / (n_F - n_C), ior being n_d. 0 = none,
     the default: one index at every wavelength, as always. Above 0 a ray refracted into this material is given a
     wavelength (materials_pbr.js processMaterial_advanced) and every index it meets is n(its wavelength). Read on the
     medium beyond (the Surface's v1), as ior is. */
  abbe: f32,
  coatEdge: f32,           // nm, where R is halfway, at normal incidence
  coatWidth: f32,          // nm, the edge's 10-90 % width; 0 a step
  coatIndex: f32,          // the stack's effective index: how far the edge moves with the angle
}



/* WHETHER A MATERIAL ASKS THE SCENE WHAT IS BEYOND IT (materials_pbr.js THE MEDIA ON EITHER SIDE says why):
   here, beside the struct, since 0.20.8 -- the surface kernel, which holds no BSDF model, asks the question
   (wavefront.js prog_surface) and shade, which holds no scene, decides it was asked (pathMiddle). */
fn asksMedium(matrl: Material2) -> bool { return matrl.transmission > 0.0 && matrl.metallic < 1.0; }

/* THE ABSORPTION COEFFICIENT OF A MEDIUM, per channel, per unit of length of its attenuationDistance -- per metre for
   a material through the boundary (materialAt), which is the only way the engine asks. 0 where the material sets no
   distance. A channel of baseColor at 0 is held at 1e-6 (a millionth left at the distance), not infinity; one above 1
   absorbs nothing rather than amplifying. */
fn mediumMu(m: Material2) -> vec3<f32> {
  if (!(m.attenuationDistance > 0.0)) { return vec3<f32>(0.0); }
  return -log(clamp(m.baseColor, vec3<f32>(1e-6), vec3<f32>(1.0))) / m.attenuationDistance;
}

/* A COATING PUT ON A MATERIAL (the fields above), as the builder's codegen writes it from the material's coating
   fields -- a material's own code may call it too. coat as the field: 0 none, 1 entering (AR leaving), 2 entering
   (bare leaving), 3 both; anything above 3 is 3. */
fn coatMaterial(m_in: Material2, coat: u32, lo: f32, hi: f32, edge: f32, width: f32, nEff: f32) -> Material2 {
  var m = m_in;
  m.coat = min(coat, 3u);
  m.coatR = pack2x16unorm(vec2<f32>(lo, hi));          // clamped to [0, 1] by the packing
  m.coatEdge = edge;
  m.coatWidth = max(width, 0.0);
  m.coatIndex = max(nEff, 1.0);
  return m;
}
// a coating's reflectance below its edge and above it (coatR, packed)
fn coatLowHigh(m: Material2) -> vec2<f32> { return unpack2x16unorm(m.coatR); }

//======================================================================================================
// Material constructors (convenience) ---------------------------------------------------------------
// These helpers simplify creating common materials without specifying every parameter.
// Defaults follow a Disney-like model with reasonable ranges.

fn makeDefaultMaterial() -> Material2 {
  return Material2(
    vec3<f32>(0.8, 0.8, 0.8), // baseColor
    0.0,                       // metallic
    0.5,                       // roughness
    0.0,                       // anisotropy
    0.5,                       // specular
    0.0,                       // specularTint
    0.0,                       // transmission
    1.0,                       // ior
    0.0,                       // attenuationDistance: no absorption inside
    0u,                        // coatR: low and high 0, packed
  vec3<f32>(0.0),            // emissive
  0u,                        // lightTraced
  vec3<f32>(0.0),            // tangent: no grain
  0u,                        // coat: none
  0.0,                       // abbe: no dispersion
  550.0, 0.0, 1.8            // coatEdge, coatWidth, coatIndex: read only where coat != 0
  );
}

// Pure diffuse: a Lambertian of albedo color, exactly. No coat -- specular 0 -- so the
// photometry bench's white floor reads rho E / pi and a white one passes a furnace. It used to
// carry a 4% coat, which made it a plastic and cost 2.5% of its light. the roughness no longer does
// anything here (there is no glossy lobe to be rough); the argument stays for existing scenes.
fn makeDiffuse(color: vec3<f32>, roughness: f32) -> Material2 {
  var m = makeDefaultMaterial();
  m.baseColor = color;
  m.roughness = clamp(roughness, 0.0, 1.0);
  m.metallic = 0.0;
  m.specular = 0.0;
  m.transmission = 0.0;
  m.ior=1.5;
  return m;
}

// Idealized mirror (very smooth metallic)
fn makeMirror(color: vec3<f32>) -> Material2 {
  var m = makeDefaultMaterial();
  m.baseColor = color;       // tint for colored mirror; use vec3(1) for silver-like
  m.metallic = 1.0;
  m.roughness = 0.0;         // use a tiny value (e.g., 0.02) if you want a tiny blur
  m.specular = 1.0;
  m.transmission = 0.0;
  return m;
}

// Plastic (dielectric with some specular)
fn makePlastic(color: vec3<f32>, roughness: f32, specular: f32) -> Material2 {
  var m = makeDefaultMaterial();
  m.baseColor = color;
  m.metallic = 0.0;
  m.roughness = clamp(roughness, 0.0, 1.0);
  m.specular = clamp(specular, 0.0, 1.0);
  m.transmission = 0.0;
  m.ior=1.5;
  return m;
}

// Colored metal (uses baseColor as specular F0)
fn makeMetal(color: vec3<f32>, roughness: f32) -> Material2 {
  var m = makeDefaultMaterial();
  m.baseColor = color;
  m.metallic = 1.0;
  m.roughness = clamp(roughness, 0.0, 1.0);
  m.specular = 1.0;
  m.transmission = 0.0;
  return m;
}

// Smooth glass (dielectric transmission with near-zero roughness)
fn makeGlassSmooth(color: vec3<f32>, ior: f32) -> Material2 {
  var m = makeDefaultMaterial();
  m.baseColor = color;        // tint; for clear use vec3(1)
  m.metallic = 0.0;
  m.roughness = 0.0;
  m.specular = 0.5;           // (a transmissive material's Fresnel is always the physical one)
  m.transmission = 1.0;
  m.ior = max(ior, 1.0);
 
  return m;
}

// Rough glass (dielectric transmission with GGX roughness)
fn makeGlassRough(color: vec3<f32>, ior: f32, roughness: f32) -> Material2 {
  var m = makeGlassSmooth(color, ior);
  m.roughness = clamp(roughness, 0.0, 1.0);
  return m;
}



fn makeEmissive(color: vec3<f32>) -> Material2 {
  var m = makeDefaultMaterial();
  m.emissive = color ;
  m.ior=1f;   // emissive material-> air
  return m;
}


fn mixMaterials(m1: Material2, m2: Material2, t: f32) -> Material2 {
  var mt = Material2(
    mix(m1.baseColor, m2.baseColor, t),
    mix(m1.metallic, m2.metallic, t),
    mix(m1.roughness, m2.roughness, t),
    mix(m1.anisotropy, m2.anisotropy, t),
    mix(m1.specular, m2.specular, t),
    mix(m1.specularTint, m2.specularTint, t),
    mix(m1.transmission, m2.transmission, t),
    mix(m1.ior, m2.ior, t),
    mix(m1.attenuationDistance, m2.attenuationDistance, t),
    select(m1.coatR, m2.coatR, t > 0.5),
    mix(m1.emissive, m2.emissive, t),
    select(m1.lightTraced, m2.lightTraced, t > 0.5),
    mix(m1.tangent, m2.tangent, t),
    // a coating is one stack or the other, never half of each
    select(m1.coat, m2.coat, t > 0.5),
    mix(m1.abbe, m2.abbe, t),
    select(m1.coatEdge, m2.coatEdge, t > 0.5),
    select(m1.coatWidth, m2.coatWidth, t > 0.5),
    select(m1.coatIndex, m2.coatIndex, t > 0.5)
  );
  return mt;
}

//======================================================================================================
// GRAIN FIELDS: what to put in Material2.tangent. R is the rotation from the object's frame to the
// world's -- R_local in the scene builder's material code, captured by localPoint() with the
// point -- so the grain turns with its object; q is the point it is measured from, usually p_local
// minus a centre; axis is in the object's frame and need not be unit length. Each may return
// zero (on the axis of a turned part, or under a warp, where R is zero): that is no grain, the old
// frame, never a NaN.
// Brushed: straight strokes along axis.
fn grainAlong(R: mat3x3<f32>, axis: vec3<f32>) -> vec3<f32> { return R * axis; }
// Turned or spun (a lathe, a polished pan bottom): circles about axis through the origin of q.
fn grainAround(R: mat3x3<f32>, q: vec3<f32>, axis: vec3<f32>) -> vec3<f32> { return R * cross(axis, q); }
// Radial: spokes out from axis, as on a sunburst dial.
fn grainRadial(R: mat3x3<f32>, q: vec3<f32>, axis: vec3<f32>) -> vec3<f32> {
  return R * (q - axis * dot(q, axis) / max(dot(axis, axis), 1e-30));
}

//======================================================================================================
// SURFACE NOISE: value noise on the integer lattice, smooth (quintic fade), in [0, 1], one cell per
// unit. A pure function of position and seed -- getMaterial2 is asked about the same point by the
// shade kernel, the probe, light tracing's connection, pick and the medium lookup, and a pattern that
// differed between them would make them shade different surfaces (SURFACES.md). The hash is the
// renderer's pcg4d, fed the cell and the seed, never the per-sample PRNG. Its slope is at most
// 15/8 per axis (the fade's), which Phase 2 of SURFACES.md turns into a checked bound for displacement.
/* A thin wrapper now: the same value noise as core/noise.js vnoise3 (same hash, same channel, same
   fade), mapped to [0, 1]. It had its own copy with the eight corners written out, which the
   compiler cannot fold into one body (noise.js says why that matters). */
fn srfNoise(x: vec3<f32>, seed: u32) -> f32 { return 0.5 + 0.5 * vnoise3(x, seed).w; }

/* BRUSH STREAKS: the lines you see on brushed and turned metal. Brushing is not one uniform
   roughness: the abrasive leaves grooves of different depths, and the deeper, wider ones read as
   separate lines. These give a value in [0, 1] per line -- constant along the grain for about
   "len", changing across it every "width" -- for material code to vary roughness (and a little
   brightness) by. Each point is still a sound BSDF, so energy is untouched. What this does NOT do
   is tilt the normal across a groove, which is how a single deep scratch catches the light: that is
   SURFACES.md phase 5. q, width and len in the same units (p_local * S_local, and metres()). */
fn srfStreaks(g: vec3<f32>) -> f32 {
  // two octaves, the second finer across the grain than along it, so lines come in bundles
  return 0.62 * srfNoise(g, 11u) + 0.38 * srfNoise(g * vec3<f32>(1.7, 3.3, 3.3) + vec3<f32>(17.0), 12u);
}
fn srfAcross(a: vec3<f32>) -> mat2x3<f32> {
  let b = normalize(select(cross(a, vec3<f32>(0.0, 0.0, 1.0)), cross(a, vec3<f32>(0.0, 1.0, 0.0)), abs(a.z) > 0.9));
  return mat2x3<f32>(b, cross(a, b));
}
// Straight strokes along axis (grainAlong's).
fn streaksAlong(q: vec3<f32>, axis: vec3<f32>, width: f32, len: f32) -> f32 {
  let a = normalize(axis);
  let bc = srfAcross(a);
  return srfStreaks(vec3<f32>(dot(q, a) / len, dot(q, bc[0]) / width, dot(q, bc[1]) / width));
}
/* Circles about axis through the origin of q (grainAround's): rings across the radius on a face and
   along the axis on a turned cylinder. Along the circle the pattern varies with the point's position
   in the plane, not its angle, which has a seam where it wraps. */
fn streaksAround(q: vec3<f32>, axis: vec3<f32>, width: f32, len: f32) -> f32 {
  let a = normalize(axis);
  let bc = srfAcross(a);
  let h = dot(q, a);
  let rv = q - a * h;
  return srfStreaks(vec3<f32>((dot(rv, bc[0]) + dot(rv, bc[1])) / len, length(rv) / width, h / width));
}
`