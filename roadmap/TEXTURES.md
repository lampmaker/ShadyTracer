# Images on surfaces: a proposal

**STATUS (2026-11-07).** **T4's relief from an image texture is built (0.84.0), not yet seen on hardware.** The user: *"build
the relief from picture"*. What it is, and what decided each part:
- **A relief made for one image texture** (`materials.js pictureRelief`), not one of the presets. Its code is
  `h = amplitude * raise * heightAt(name, q).x` with its slope from the same call. The presets are each compiled on
  materials with no image texture (check-shaders, the relief tests), where it would not compile. A relief's code now has the
  material's image textures by name (codegen), as its material code does.
- **Planar from the point's x and y, on every face, whatever the image texture's projection.** The height is then a function
  of the point alone, and a bound on its gradient is a property of the image texture and its placement. Box and triplanar
  hand over by the normal, which a relief, evaluated in the SDF, does not have. The cylinder's arc length has a seam,
  and the sphere has poles: neither has a bound.
- **Smooth: a cubic B-spline of the pixels, 16 reads.** Bilinear's gradient jumps at every texel's edge, and a relief's
  normal is taken by differences. Its derivative is a quadratic B-spline of neighbouring differences, so the largest of
  those bounds it (`heightStats`): exact on a ramp, about 2.4 times loose on random noise (read in the test's numbers:
  bound 16, steepest 6.9). Wrap *none* fades to 0 over the texels past the copy, since a step to 0 has no bound.
- **The bound is worked out on import from the pixels** (`builder/images.js statsOf`), with two levels in 255 of room
  for what a canvas's premultiplied read-back rounds (inferred). It is carried in the slot's uniform, so a size dragged
  is still live. An entry made before had none: choosing the relief works it out then (`withHeights`).
- **16-bit grey PNGs** are read by a decoder of their own (`decodePNG16`; the browser gives 8 bits) and kept in the
  atlas as two bytes a texel (`pack16`). Any other PNG, JPEG or WebP has 8 bits.
- **Verified on Dawn over lavapipe:** `heightAt` is its twin's to 1.1e-6, and rays at 12 degrees over a steep relief
  stop on it, never past its first crossing (`builder/test/images.gpu.mjs`). With the bound taken out they do step
  through, so the test can fail. Straight-down rays could not: the field along a vertical is exact whatever the bound,
  and with slopes of 0.6 or 1.7 a march with no bound still landed right.
- **Not known:** its speed (16 reads at every step near the surface, and the march's steps there grow with the bound),
  and how it looks. Both are the user's.

**STATUS (2026-11-06, later).** **T1 is built (0.84.0), not yet seen on hardware.** The user: *"go with your proposals,
build T1"*, after the four decisions below were put to them, so each is taken as proposed: a surface under the glow
(way 1), image textures in the file, 4096 px and 8-bit, one image texture per material placed by the pattern frame. What was built
differs from the proposal in these places, each for a reason found while building:

- **A slot, not a parameter kind.** A material's image textures are `m.images`, a list of slots beside its parameters
  (`builder/images.js`), not a fifth kind of parameter. The parameter kinds are read in some 40 places
  (`model.js paramKind`), each of which would have had to learn what an image texture is. A slot's uniform is
  `img_<name>_<material>`, and a material's own parameter may not be called `img_...`.
- **The image texture is in the scene document, outside every undo step** (`project.js OUTSIDE_HISTORY`), rather than in a
  store of its own. That makes a file, an export, a copy, a library item and a drag between scenes whole with no code
  of their own. A snapshot does not carry megabytes: no undo step holds an image texture, and a restore carries them across. A
  file keeps only the image textures its materials use (`model.js withUsedPictures`). The document in memory keeps all of
  them, since an undo may bring back a slot that names one.
- **Each kernel gets its own texel read** (`core/images.js withImages`, `sceneCompute`): the atlas where `main`
  reaches a material, a stub where it does not. The renderer's march and shadow rays ask the distance alone, and a
  texture named in a function `main` never calls is an invalid bind group (check-shaders pass 2). Found while planning
  the binding, before anything was run.
- **The screen's surface replaces whatever an emitter held** in base colour, metallic, roughness, specular and specular
  tint, on its first glowing image texture. An emitter never read those fields before (`materials.js fieldsOf`), and a preset's
  roughness is not the field's default, so "only where still the default" left the diffuse preset's roughness 1 under
  the glass (`builder/test/images.gpu.mjs` found it).
- **Not in T1:** a slot's settings as parameters of the registry and the timeline (a scrolling sign is T2), *Fit to
  object* (T2 as planned), HDR image textures (T2), an image texture's bytes freed on the GPU (an atlas no scene holds is the
  browser's to free: `builder/images.js` ATLASES).

**What is verified, and where (Dawn over lavapipe, this container):** the WGSL lookup against its JS twin in every
projection, wrap, filter and face setting (`core/test/images.gpu.mjs`); the scene's own `getMaterial2`, codegen and as
data, against the twin: a glowing image texture's emission times the luminance, the pattern frame moving it, a slot's live
uniform moving it (`builder/test/images.gpu.mjs`); and the whole renderer: a floor under a glowing 8 x 8 checker reads
0.9905 +- 0.0078 of the floor under a uniform grey of its mean with light sampling on, and 0.9956 +- 0.0063 with it
off, against the means' ratio of 0.9943. **Not seen:** any rendered picture, on any screen; its speed. Both are the user's.

**What to look at first:** File › Examples › *Image textures*. The test card's bars should read white, yellow, cyan, green,
magenta, red, blue from the left on the screen, the poster and the can, with the ring round its centre. The
television's black ramp end should look like dark glass. Then a material's **image textures** box: + image texture…, and its
settings dragged.

**STATUS (2026-11-06).** A proposal, nothing built. The user: *"think about textures. how could these be applied.
What I'd like short-term is a texture that can act as an emitting surface as well. So maybe it's a material where
the rgb color is given by the texture image. With code, users can easily convert the texture rgb to basecolor or
roughness or whatever. Of course, alignment, positioning, repeating, mirror, scaling etc is the big question."*

The proposal in one paragraph: **an image is a parameter of a material**, a new parameter kind next to a number and a
colour. It carries its own **mapping**: a projection, a size in real millimetres, an offset, a turn, a wrap mode per
axis and a filter. Every part of the mapping is live. It is laid out in the **pattern frame the engine already has**,
so it moves and turns with its object as wood's rings do. With no code, a glowing material can take its colour from
the image, and a surface its base colour. Code reads it with `sample(name)`. On the GPU every image of a scene sits
in **one atlas texture, read with four `textureLoad`s**, so wrapping is exact and the number of bindings stays the
same whatever the number of images.

The facts below are marked **read in code** (file:line, which says what the code does, not what it costs) or
**inferred** (a hypothesis, with what would test it). Nothing here has been measured.

---

## 1. What the engine has already

### No UVs, but a frame per object

- **An SDF has no surface parametrisation.** Every shape is distance code (FEATURES.md §1), so there are no UVs to
  read. A position on an image has to come from **projecting the hit point**.
- **Material code runs once per hit and sees the point in its object's frame:** `p_local`, `R_local` (that frame's
  rotation to the world) and `S_local` (its scale). Read in code: `builder/materials.js:167-187` (the code
  template), `builder/codegen.js:660-680` (getMaterial2).
- **The local point costs one SDF evaluation per hit**, only on a material that reads it, and never on the medium
  lookup. Read in code: `builder/codegen.js:663-680`, `builder/codegen.js:340` (`readsLocal`).
- **The pattern frame (model version 24, 0.77.0)** moves and turns where a node's material lays its pattern out:
  `pattern: { pos, rot }` on the node, live after its first compile. In a CSG group the group's frame is used.
  Read in code: `builder/model.js:135-140, 2073-2090`; user's view: `help/modelling/materials.md` *Turning a pattern*.
- **A pattern's sizes are in real millimetres whatever the scene's unit** (`p_local * S_local / mm(1.0)`). Read in
  code: `builder/materials.js:174-177`.

**So placement mostly exists.** A texture is one more pattern: the pattern frame places and turns it per object,
and the image's own mapping only adds what an image texture needs and a noise does not: a size, an aspect, a wrap mode.

### Emission that varies over a surface is already right

- **Light sampling asks the scene what it hits.** NEE toward a discovered emitter fires a shadow ray (`TAG_EMIT`)
  that asks `getMaterial2` what the first thing it meets emits, *"so emission that varies over the surface is
  evaluated where it is"*. Read in code: `lib/pathtracer/README.md` *Emissive surfaces as lights*; the calls in
  `core/wavefront.js:1541` (`prog_occlude`) and `:1699` (`prog_occlude_emit`).
- **Discovery** records camera hits on emitters in a 16³ grid with the brightest emission seen per voxel
  (`core/tracebasics.js:856`, `emitDeposit`).
- **Emitter photons** start by Crofton probes, which need no knowledge of the shape (README, same section).

So a glowing image needs **no new light-sampling code** to be unbiased (inferred, from the estimator's form: every
strategy evaluates the emission at the point it reaches). §7 lists the test that would show it.

### "An emitter" is a point whose emission is above zero

- Every place that asks reads `max3(m.emissive) > 0.0` **at the point**: the emitter hit
  (`core/materials_pbr.js:972`), the probe's start (`core/scene_api.js:142`), discovery
  (`core/tracebasics.js:856`), the photon map's store (`core/wavefront.js:1186`).
- **A glowing material assigns its emission and nothing else** (`builder/materials.js:248-251`, `FIELDS_OF.emitter`).
  The rest of its fields are `makeDefaultMaterial`'s: base colour 0.8, roughness 0.5 (`core/materials.js:168-180`).

**Consequence (inferred from those lines):** wherever an image is exactly black, a glowing material stops being an
emitter there and becomes a 0.8 grey plastic. A black pixel on a screen would look light grey under room light. §4
deals with it.

### A scene can already bind a resource of its own

- **`scene.resources` and `scene.buffers`** carry what a scene reads besides its uniforms (the scene as data's
  buffer today) to every kernel that sees geometry: pick, field, tagfield (`core/raytrace_main.js:1194, 1238,
  1264`), the march's count (`:503`).
- **Textures and samplers already do not count as storage buffers**, in the renderer (`raytrace_main.js:499`,
  `storageCount`) and in check-shaders (`core/check-shaders.mjs:923`). (`roadmap/IMPORT.md` *Binding limits* says
  check-shaders counts every resource as storage. That was true when it was written and is not any more.)
- **The builder's compile probe declares the scene's resources** (`builder/validate.js:62-71`).
- **tinywebgpu creates and fills 2D textures**, from pixels or from an ImageBitmap through
  `copyExternalImageToTexture`, and generates mipmaps (`lib/tinywebgpu/src/tinywebgpu.js:527-600, 640-653`). It
  binds a texture's default view to a `texture_2d<...>` declaration (`:1261-1279`).
- **The shade kernel uses 8 storage bindings** (IMPORT.md, `core/wavefront.js`). A sampled texture is a separate
  limit, 16 per stage by default (the WebGPU spec).

### What not to repeat: ray files

- **A ray file's data is kept by name, per browser, in its own IndexedDB store** (`optics/rayfiles.js:16, 57-73`;
  `builder/lights.js:34`: "the data is the host's, by name"). Only `optics/page.js`, `optics/rayfiles.js` and
  `builder/panel.js` read it. So a project exported and opened elsewhere has the light without its rays (inferred
  from those being its only readers; worth a check on its own).
- **An image must travel with the scene**: in the exported project, the library item and the shared link.

---

## 2. The image: an asset of the project

- **Kept by its content**: the SHA-256 of its bytes is its key. The scene stores `images: { <hash>: { name, width,
  height, colour } }` and the bytes go into the project's own store in IndexedDB, beside its scenes. Two scenes and
  two materials using one image texture keep it once.
- **Carried in every file that leaves the browser.** An exported project or scene holds the bytes as base64 (or a
  ZIP, if the files get large). A library item holds its own. A file is whole on its own.
- **Its colour space is the image's, chosen once:** *colour* (sRGB-encoded: decoded to linear on read, for a base
  colour or an emission) or *data* (read as it is, for a roughness map or a mask). Blender's *Non-Color* is the same
  choice. The default is guessed from use: colour if first used for a colour.
- **8-bit PNG, JPEG and WebP first**, through `createImageBitmap`. Their alpha is kept. **HDR images later** (.hdr,
  .exr: the Darkroom already writes both and its test has readers, `lib/pathtracer/test/export.test.mjs`), in a
  second, `rgba16float` atlas, for an image texture given in absolute luminance.
- **A size limit, said when applied**: the long edge scaled down to 4096 px on import (a proposal; the user's call).
- **A version bump of the scene file**: `bump: minor`.

## 3. On the GPU: one atlas, read by hand

### One texture for every image

- **The atlas is one `texture_2d<f32>`** (`rgba8unorm`), every image of the scene packed into it by shelves, each
  with a gutter. Each image's rectangle in it, its size in texels and its colour flag are uniforms.
- **Why one texture:** the number of bindings does not depend on the number of images. A second image texture is an
  upload and a uniform write, not a new declaration in every kernel that reaches `getMaterial2`. One binding also
  keeps clear of the 16-texture limit.
- **Its size follows the images**, repacked when one is added. It is not allocated at the 8192² the WebGPU default
  allows (256 MiB at 4 bytes a texel). An image too large to fit is refused and the reason said.
- **Bound only in a scene that has an image.** A scene without one compiles to the text it does today, byte for
  byte, as the colour depth's and the haze box's code does (the golden shaders, `test/fixtures/csg-v10`).

### Four loads, not a sampler

The lookup is bilinear interpolation of four `textureLoad`s, computed in the shader:

- **Wrapping and mirroring are exact.** Repeat, mirror and clamp are integer arithmetic on the texel index. Hardware
  addressing would wrap the whole atlas, not the image in it, and hardware filtering at an image's edge would blend
  in its neighbour's texels.
- **The position inside a texel is f32.** Hardware filtering quantises it to 1/256 (IMPORT.md *A dense 3D texture*,
  with its reference).
- **The decoding happens before the mix**: each of the four taps is decoded from sRGB to linear first. That is the
  correct order, and what an `-srgb` format would do in hardware.
- **No sampler.** No sampler binding is needed, and none is plumbed through tinywebgpu's binding of a scene's
  resources.
- **Nearest is the same code**, with one tap: the *pixels* filter, for an LED wall or a pixel-art sign whose pixels
  should stay sharp.

**Cost (inferred):** four loads and a few multiplies per lookup, once per hit on a material that has an image. That
is small next to the one SDF evaluation the local point already costs per hit (§1). To test it: a `tests.js` row
with a screen in a dark room, the same scene with the image and with a plain emission of its mean colour, ms per
sample measured on the user's hardware.

### No mipmaps at first

- **Compute shaders have no derivatives**: `textureSample` is fragment-only, so a mip level would come from a ray
  cone carried by the ray. The Ray has no word to spare (`core/materials.js:135-136` says so, for the medium).
- **The estimate does not need them (inferred, from the estimator's form).** Every sample jitters its pixel, so the
  mean of point lookups over a pixel converges to the image filtered over that pixel's footprint. A minified image
  is then noisier per sample, not wrong.
- **What would test it:** the same far-off, finely checkered image at 1 and at 1000 samples, against its mean
  colour. A ray cone becomes a step only if a measured case shows the noise or the cache misses cost too much.

## 4. A glowing image

**Without code, a glowing material's colour can come from an image.** Then, at each hit:

`m.emissive = image.rgb × luminance`

- **The luminance on the panel is a white pixel's.** A white pixel (linear 1, 1, 1) glows at the luminance typed;
  a pixel half as bright, half as much; a black one, not at all. It is a monitor showing the image texture at that
  brightness: 300 cd/m² for an office screen, 1000 for a phone in the sun.
- **This differs from a plain glowing colour.** For a plain colour, codegen divides the colour by its own luminance,
  so the number alone sets the brightness (`builder/codegen.js:707`). An image texture's pixels are kept relative to its
  white instead, or every pixel would come out equally bright.
- **Its alpha** gives the material's own colour where it is transparent, so a logo on a glowing panel is one image.

### The dark pixels

Where a pixel is black, the point is not an emitter (§1), and the surface underneath shows. Today that surface is
0.8 grey plastic. Two ways out:

1. **A glowing material with an image keeps a surface underneath** (proposed for the first step). It gets a base
   colour and a roughness, default a near-black gloss: a screen's glass. A black pixel then looks like a switched-off
   screen, reflecting the room. A pixel that glows ends the path, as every emitter does
   (`core/materials_pbr.js:972`), so a lit pixel reflects nothing. On a real screen the reflection is small next to
   the glow, so the cut between the two should not show (inferred: to look at on the user's screen, a dark scene
   with one bright lamp facing the screen).
2. **A surface that glows and reflects at once.** Emission added on top of the BSDF, the path going on. It is the
   physical answer, but the engine treats an emitter as the end of a path in several places: the emitter hit, the
   probe's start ("anything further back emits into this emitter, which absorbs it", README), discovery and the
   photon map's stores. It is a change of its own, with its own tests. Not in the first step.

### Probes through black pixels

**A probe passes through anything that is not emitting** (`core/scene_api.js:139-143`). With an image, a probe
whose line meets a black pixel on a panel's front goes on into the panel. A line through a black pixel carries
nothing (emission 0), so the estimate should stay exact (inferred). But the probe was written for surfaces that glow
everywhere or nowhere. **What would test it:** the GPU test in §7, the emitter photons on and off over a floor lit
by an image that is half black.

## 5. The mapping

An image parameter has these settings, each a uniform and so **live** (the timeline can scroll a sign). Only the
first image in a scene is a compile.

| setting | what it does |
|---|---|
| **projection** | how the point becomes a position on the image (below) |
| **size** | one copy of the image, width × height in real mm. The height follows the aspect unless unlocked |
| **offset** | where the image's centre is, in mm, in the projection's plane |
| **turn** | degrees in the image's plane |
| **wrap**, per axis | **repeat**, **mirror** (every other copy flipped, so the edges meet with no seam), **clamp** (the edge pixels go on), **none** (outside one copy the image is transparent and the material's own field stands: a decal, a poster) |
| **filter** | **smooth** (bilinear) or **pixels** (nearest) |
| **faces** | for planar: the front only, front and back, or every face (below) |

**The projections**, all in the object's pattern frame:

- **Planar** along the frame's z. The image's x along the frame's x, its top towards +y, read the right way round
  seen from +z. For a screen, a sign, a poster, a floor. Projected straight through, an image smears along the
  sides of a box. *Faces: front* keeps it only where the normal faces +z (the side faces show the material's
  fields), *front and back* mirrors it on the back, as a slide seen from behind is.
- **Box**: six planar projections, one picked by the axis the normal is closest to. For tiles or a label on every
  face of a box. A hard seam at a 45° edge.
- **Triplanar**: the three planar projections blended by the normal, with a sharpness. For stone, bark or concrete
  on any shape with no visible seam: three lookups.
- **Cylindrical** around the frame's z: the image wrapped round, its width the circumference given by *size*. A
  label on a bottle, a lampshade.
- **Spherical**: longitude and latitude. A globe, or an equirectangular image texture seen from inside.
- **Code**: none. The material's code passes its own position (below).

**Fit to object** sets size and offset from the object's box in its pattern frame, one undo step, so an image texture
covers a panel in one click. The boxes are measured already (`builder/bounds.js`, `builder/boxes.js`).

**Why in the pattern frame and not on a field of its own:** the frame already moves and turns a pattern per object,
live, with its rules for CSG groups (§1), and every pattern on the object then lines up with the image texture. An image texture
is laid out the same way as every other pattern.

## 6. In code

A material's image parameters are in scope by name, as its other parameters are, with three functions:

```wgsl
let c = sample(texture);                  // vec4: linear rgb (if colour) and alpha, at the hit, by its mapping
let uv = mapped(texture);                 // the projection's position, in copies of the image (0..1 is one)
let d = sampleAt(texture, uv * 2.0);// a lookup at a position of one's own, with the wrap and filter

m.baseColor  = mix(m.baseColor, c.rgb, c.a);
m.roughness  = sample(roughmap).r;                  // a data image
m.emissive   = c.rgb * 500.0;                       // 500 cd/m^2 for a white pixel
```

- `texture` names the slot (a `u32`); the functions read its rectangle and mapping from the
  uniforms.
- **What code cannot do with it yet:** bend the normal (a normal map). Material2 has no normal: the shading normal
  is the SDF's (`core/materials.js` `struct Material2`). A height image as a **relief** is possible, since a relief is
  shape (`builder/materials.js` RELIEFS), but it is evaluated at every march step near the surface. That is a later
  step with its own measurement.

## 7. Everything that calls `getMaterial2` (the second callers)

CLAUDE.md's warning: *something that was true for the only caller that existed became false when a second one
appeared.* The image's binding and uniforms reach every kernel whose text reaches `getMaterial2`. check-shaders
pass 2 already refuses a binding `main` cannot reach:

- `prog_surface`, `prog_occlude` and `prog_occlude_emit` (`core/wavefront.js:1105, 1541, 1699`), the photon map's
  `prog_sppm` (`:1186`), and shade through `materialAt` (`core/tracebasics.js:1321-1344`); the emitter probes;
- field and tagfield (`core/field.js:83`), pick;
- **the Optics page's march and shade** (`lib/pathtracer/optics/kernels.js`). A base-colour image changes what the
  Optics page's rays reflect. A glowing image is not a source there: a glowing material is not one
  (`builder/sources.js:7-8`);
- **the scene as data** (`builder/scenedata.js`) and **the bake** (`builder/bake.js`). The mapping's uniforms bake
  into constants like any other; the atlas stays a binding, as the culling boxes stay uniforms;
- the library's thumbnails and its studio, which must have the item's images;
- the spectral optics trace. It turns a material's colour into a smooth spectrum (`roadmap/LIGHT_MODEL.md` S2), so a
  pixel's colour becomes one with no extra code (inferred);
- a unit change: the sizes are real mm, so nothing to convert (as a pattern's parameters, `builder/unitchange.js`);
- the script API: an image's mapping is a setting like any other.

### Tests (what can be verified here)

- **The lookup in JS** (a twin of the WGSL), against brute force: every wrap mode at and past the edges, mirror's
  seamless edges, bilinear and nearest, the sRGB decode before the mix, every projection's position (planar both
  ways round, box's pick, triplanar's weights summing to 1, cylindrical's seam, spherical's poles).
- **On Dawn**: the WGSL lookup against the twin, the atlas packed and unpacked with images of odd sizes.
- **The whole renderer on Dawn:** a floor lit by a glowing panel showing an image, against the same panel glowing
  uniformly at the image's mean. Far from the panel the floor's light depends on the mean alone (inferred from the
  inverse-square law over a small panel). Light sampling on and off, the emitter photons on and off, each within its
  error bar of the others. An image half black, for the probes (§4).
- **codegen**: a scene without an image, byte for byte the text it was. A scene with one: the binding declared on
  exactly the kernels that reach `getMaterial2`.
- **The file**: an image saved, exported, imported elsewhere and still there; two materials with one image texture keep
  it once.
- **The panel** in headless Chromium: an image chosen, its mapping's fields, Fit to object.
- **For the user to look at** (what the container cannot judge): an image texture on a screen in a dark room, the right way
  round, sharp with *pixels*; a tiled floor with *mirror* and no seam; a label on a cylinder.

## 8. Steps

| step | what | why first or later |
|---|---|---|
| **T1** | Images as project assets (§2). The atlas and the four-load lookup (§3). The image parameter with every projection, wrap and filter (§5). A glowing material's colour from an image with a surface underneath (§4, way 1). A surface's base colour from an image. `sample`, `mapped`, `sampleAt` in code (§6). | The short-term request: an image texture that glows, and everything else through code |
| **T2** | Any field from an image's channel without code (roughness from R, metallic from G, ...). Fit to object. Library items carrying their images. HDR images in absolute luminance. | Each is small once T1 is there; HDR needs a second atlas format |
| **T3** | **A light object showing an image**: a rectangle light whose face glows by the image texture, with exact lumens, a source on the Optics page, its photons drawn by the image's brightness (a table of its pixels' cumulative sums). Also a **gobo**: a light's beam masked by an image. | A rectangle light's face already has exact coordinates, its own xy (`builder/lights.js`), so it needs no projection. The best long-term home for a backlit sign whose flux matters. A larger change: the sources, the optics trace and the photons each change |
| **T4** | A height image as a relief. A surface that glows and reflects (§4, way 2). An equirectangular HDR as the environment. | Each a change to the engine with its own cost to measure |

## 9. Decisions for the user

1. **The dark pixels:** a surface under the glow (way 1, proposed for T1), or glow and reflection together (way 2,
   an engine change) before anything ships?
2. **Images inside the project file** (proposed: a file is whole wherever it goes, and larger) or kept per browser by
   name, as ray files are?
3. **The size limit** on import: 4096 px on the long edge? 8-bit images only in T1?
4. **One image per material, placed per object by its pattern frame** (proposed), or an image setting on the
   object as well? With the proposal, two screens showing different image textures are two materials.
