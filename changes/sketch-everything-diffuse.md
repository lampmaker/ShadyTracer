bump: minor

**Sketch can show every surface as plain diffuse paint (Everything diffuse).** A new switch in the Render settings'
Quality box, shown while Sketch is chosen (`sketchDiffuse`): each surface a camera path meets is shaded as a
Lambertian of its material's own colour -- mirrors, metal, gloss and glass included, coatings and colour depth gone --
so a reflector or a lens reads as its shape in Sketch's flat light, and not as what it reflects or what is behind it.
Lamps, glowing surfaces and a light's faces keep their material. It is one swap of the material in the shade kernel
(materials_pbr.js sketchFlat, called from tracebasics.js pathMiddle); the scene is not recompiled. It applies only to a
Sketch the user chose (quality.js effective): a Standard picture traced as Sketch while moving keeps its glass, since
the row is hidden there. Off by default, so nothing changes until it is ticked.

**What to look at:** a scene with a mirror and a glass part (Office lighting, a lens example) in Sketch: tick
**Everything diffuse** and the mirror and the glass turn matte in their own colour, a lamp still glows; untick it and
they reflect and refract again. With Standard chosen and ⚡ set to Sketch, a move keeps the glass. Tests ›
render-modes' three new rows at the end: the mirror and the clear glass floor with the switch must read the
Lambertian sketch row (PASS), the mirror without it is reported beside them.
