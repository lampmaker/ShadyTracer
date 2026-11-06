bump: minor

**Pictures on surfaces: a material can show a PNG, JPEG or WebP, as its colour, as a glowing screen's picture, or to its
code** (scene version 29; `roadmap/TEXTURES.md` T1). A material's Properties have a **pictures** box: **+ picture…**
reads one into the scene (scaled to 4096 pixels on its longer side if larger). The first picture is the material's
colour:
- on a surface, its base colour;
- on a glowing material, its glow. A white pixel glows at the luminance, a black one not at all, and there a screen's dark
  glass shows: base colour, metallic, roughness, specular and specular tint, which a glowing material with a picture now
  has.

Another picture, or one set to *code only*, is read by the material's code: `sample(name)`, `mapped(name)`,
`sampleAt(name, uv)`.

A shape has no picture coordinates, so the picture is **projected** in the object's pattern frame: planar, box,
triplanar, cylindrical or spherical. It moves and turns with the object and its pattern frame. On top of that it has a
size in real mm, an offset, a turn, a wrap across and up (repeat, mirror, clamp, none), smooth or pixels, its faces, and
colour or data. Every one of these is live; another picture, its name in code, its use or taking it away is a compile.

The picture is kept in the scene by its bytes, so an exported scene or project, a library item, a copy pasted or dragged
to another scene all carry it. A file keeps only the pictures its materials use. No undo step holds a picture.

On the GPU every picture of a scene is in one atlas texture, read by four `textureLoad`s with wrap and mirror exact and
each tap decoded from sRGB. Each kernel holding the scene is given its own texel read: the atlas where it reaches a
material, a stub where it does not (`core/images.js` `sceneCompute`). A scene without a picture compiles to the text it
did. A new example, **Pictures**.

Verified on Dawn over lavapipe, not on hardware:
- the WGSL lookup is its JS twin's in every setting;
- the scene's own material reads the twin's, codegen and as data;
- a floor under a glowing checker reads its mean's light, 0.9905 ± 0.0078 with light sampling on and 0.9956 ± 0.0063
  off, against 0.9943.

**What to look at:** File › Examples › **Pictures**.
- The test card's bars should read white, yellow, cyan, green, magenta, red, blue from the left, the right way up, on the
  television, the poster and round the can, with the white ring at its centre. On the ball they are triplanar and
  mirrored.
- The television should glow, its black end of the ramp dark glass reflecting the room. The scene is dimly lit, so the
  screen's light should show on the floor in front of it.
- Then any material's **pictures** box: + picture… with a photo of your own, and drag its width, offset, turn and wrap.
  Each should move the picture at once, with no compile. *pixels* should give sharp pixels close up.
- Whether a large picture costs speed is yours to say: a picture costs four texel reads and one scene evaluation per hit
  on the material (inferred, not measured).
