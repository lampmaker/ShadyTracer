bump: minor

**Image textures on surfaces: a material can show a PNG, JPEG or WebP, as its colour, as what a glowing screen shows, or to its
code** (scene version 29; `roadmap/TEXTURES.md` T1). A material's Properties have an **image textures** box: **+ image texture…**
reads one into the scene (scaled to 4096 pixels on its longer side if larger). The first image texture is the material's
colour:
- on a surface, its base colour;
- on a glowing material, its glow. A white pixel glows at the luminance, a black one not at all, and there a screen's dark
  glass shows: base colour, metallic, roughness, specular and specular tint, which a glowing material with an image texture now
  has.

Another image texture, or one set to *code only*, is read by the material's code: `sample(name)`, `mapped(name)`,
`sampleAt(name, uv)`.

A shape has no texture coordinates, so the image texture is **projected** in the object's pattern frame: planar, box,
triplanar, cylindrical or spherical. It moves and turns with the object and its pattern frame. On top of that it has a
size in real mm, an offset, a turn, a wrap across and up (repeat, mirror, clamp, none), smooth or pixels, its faces, and
colour or data. Every one of these is live; another image texture, its name in code, its use or taking it away is a compile.

The image is kept in the scene by its bytes, so an exported scene or project, a library item, a copy pasted or dragged
to another scene all carry it. A file keeps only the image textures its materials use. No undo step holds an image.

On the GPU every image of a scene is in one atlas texture, read by four `textureLoad`s with wrap and mirror exact and
each tap decoded from sRGB. Each kernel holding the scene is given its own texel read: the atlas where it reaches a
material, a stub where it does not (`core/images.js` `sceneCompute`). A scene without an image texture compiles to the text it
did. A new example, **Image textures**.

Verified on Dawn over lavapipe, not on hardware:
- the WGSL lookup is its JS twin's in every setting;
- the scene's own material reads the twin's, codegen and as data;
- a floor under a glowing checker reads its mean's light, 0.9905 ± 0.0078 with light sampling on and 0.9956 ± 0.0063
  off, against 0.9943.

**What to look at:** File › Examples › **Image textures**.
- The test card's bars should read white, yellow, cyan, green, magenta, red, blue from the left, the right way up, on the
  television, the poster and round the can, with the white ring at its centre. On the ball they are triplanar and
  mirrored.
- The television should glow, its black end of the ramp dark glass reflecting the room. The scene is dimly lit, so the
  screen's light should show on the floor in front of it.
- Then any material's **image textures** box: + image texture… with a photo of your own, and drag its width, offset, turn and wrap.
  Each should move the image texture at once, with no compile. *pixels* should give sharp pixels close up.
- Whether a large image texture costs speed is yours to say: an image texture costs four texel reads and one scene evaluation per hit
  on the material (inferred, not measured).
