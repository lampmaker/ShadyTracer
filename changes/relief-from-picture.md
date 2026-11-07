bump: minor

**A material's image texture can be its relief: a height in the shape itself, from a 16-bit height map too.** In the relief box,
**from an image texture:** and the image texture's name.
- **The height:** luminance times alpha, so white is `amplitude` mm up, black the surface, and *raise* -1 engraves.
- **Placement:** the image texture's own size, offset, turn and wrap, read planar along the object's z on every face, whatever
  the image texture's projection.
- **Smooth:** a cubic B-spline of the pixels, sixteen reads at every march step near the surface.
- **The slope bound:** worked out from the image's pixels when it is read, so the march never steps through.
- **16 bits:** a 16-bit greyscale PNG keeps its 65 536 heights (read by a decoder of its own: the browser gives 8 bits);
  any other image has 256.
- **In code:** a relief's code has the material's image textures by name, with `heightAt(texture, q)` returning the height and
  its bound.
- **Its image texture:** renaming the image texture renames it in the relief, and taking the image texture away takes its relief too.

Verified on Dawn over lavapipe, not on hardware: `heightAt` is its JS twin's to 1.1e-6 at 8 and 16 bits. Rays at 12° over
a steep relief stop on it and never past where they first meet it, codegen and as data, raised and engraved. With the
bound taken out, the same rays step through, so the test can fail.

**What to look at:** File › Examples › **Image textures** has an embossed plaque in front, lying on the floor.
- It should show a raised ring with a rounded shoulder, ripples inside it and a dome at the centre, 3 mm high in the
  low studio light, with no texel grid in its shading and no holes.
- Then put a height map of your own on a material (its **use** *code only* if it should not colour it) and choose the
  relief from it.
- Whether it costs speed near the surface is yours to say. Each step there is sixteen reads, and a steep image texture (small
  and high) makes the march take more steps: inferred, not measured.
