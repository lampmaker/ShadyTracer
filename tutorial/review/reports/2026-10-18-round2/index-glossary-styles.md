# Beginner read-through: contents, glossary, styles (round 2)

## 1. Contents page (index)

**Teach-back.** ShadyTracer makes a picture in the browser. It sends rays backwards from the camera, bounces them around the scene at random and averages what comes back. The tutorial will have 34 chapters in ten parts. Only 1, 2 and 14 are written so far. I need basic JavaScript and school maths, and the harder maths is in "The maths" fold-outs. The figures are mostly a 2D "flat world" with ⊕ handles to drag. Claims about speed carry a stamp saying how sure they are.

**Quiz.**
1. I'll learn how the renderer works: "rays, distances, light, glass, noise, photons, haze and the graphics card". I need "variables, loops, functions and arrays" and school maths, "No calculus". Start with chapter 1, then 2, then 14 if I like. All of this was taught clearly.
2. The stamps are MEASURED (someone ran it on real hardware), READ IN CODE (the code does it, with a link to the line) and INFERRED (a guess, with what would test it). Clear.
3. From the key (fig. 1): solid blue is a camera ray, solid orange is a lamp's ray, dashed grey is a shadow ray that reached its light, dotted red is a blocked ray, a purple arrow is a normal, a small circle is "a step of the march", and a hatched disc is a solid shape. You drag ⊕, and 3D figures turn when dragged. The page did not teach what a shadow ray or "the march" is. I know that the circle's radius is the distance to the nearest surface only from **outside knowledge**.
4. The glossary: hover or tap a dotted-underlined word. Taught.

**Where I got lost (worst first).**
- **"card" means three things.** The pop-up is a "card". The MEASURED stamp says "on what card", meaning graphics card. On the styles page, "Each card shows a small scene". The stamp's "on what card" is where I tripped.
- **"cost".** READ IN CODE says "never what it costs", and chapter 4 talks about "what it costs to find out". Money? It means computer time, but the page never says so.
- **The map's titles use words that are never defined:** "shader" (ch. 24 "From scene tree to shader"; not in the glossary at all), "scene tree", "next event estimation", "Caustics", "Photon mapping", "Wavefront", "bias", "exposure and tone", "colour temperature", "ray files". That's fine for a list of planned chapters, but it looks like a wall.
- **"Paragraphs with a dot beside them"** and "filled stations" describe graphics I couldn't see in the text.
- "Dark / Light button beside it the light": in a tutorial about light, "the light" reads oddly for light/dark mode.

**Words used before they were explained:** noise, photons and WebGPU in the first paragraphs, none of them underlined. "Shadow ray", "normal" and "march" appear in the key.

**Figure.** The key is clear for the line styles. Two flaws: the hatched circle cuts through "light" in "reached its light", and "⊕ a handle: drag it" is crammed under "surface". "A step of the march (chapter 2)" is a pale circle with no hint of what the circle measures.

**Wrong or contradictory.** Nothing outright wrong. Chapter 0 "How to read this" is listed as planned, yet this page already does that job, which is fine.

**Three changes.**
1. Define or underline what the key uses: shadow ray, normal, and "march" (add it as its own glossary headword).
2. Say "graphics card", not "card", in the MEASURED stamp, and say once that "cost" means time on the graphics card.
3. Underline noise, photons and WebGPU in the opening, and add "shader" to the glossary.

## 2. Glossary

**Teach-back.** There are 74 entries, A to W. Each has a sentence or two, a pointer to the chapter that explains it, and see-also links. About two-thirds of the pointers say "Planned", so for most words the definition is all there is for now.

**Q1: the five a beginner would look up first.**
- **ray**: "A starting point and a direction: a line that goes one way for ever." Clear. But it uses "ray tracer", which has no entry.
- **path tracing**: Clear, and the why is explained ("starting there wastes no work on light nobody sees"). "A light path can be walked either way" is a big claim taken on trust.
- **sample**: "One try: one ray (or path) per pixel." Ambiguous. Is a sample one ray in one pixel, or one ray in every pixel? The kernel entry ("Each of ShadyTracer's samples is a dozen kernels") and the tile entry suggest the second. "The average wanders" is vague.
- **GPU**: Clear, but "thousands of small processors… Each ray, or each pixel, gets one of them" doesn't add up against **pixel**'s "about two million". The entry doesn't say how 2 million pixels fit on thousands of processors.
- **signed distance field (SDF)**: Clear, and the best entry of the five ("positive outside, negative inside, zero on the surface").
- (Runner-up: **noise** is clear, and "Four times the samples halve it" is concrete.)

**Q2: entries that send me to look up again.**
- **BSDF**: the expansion "bidirectional scattering distribution function" explains none of its words.
- **firefly → probability density (pdf)**: "½ for each unit of its length", "a lamp 2 long" (2 what?), and "divides what it found by it". I follow this only with **outside knowledge** of densities.
- **mirror-like (delta) direction**: "in maths, a delta". I understood this only from outside knowledge (Dirac delta).
- **multiple importance sampling**: "nothing is counted twice". Why would anything be counted twice? I know only from outside knowledge.
- **radiance**: "luminance… in candela per square metre". Neither luminance nor "per square metre" is explained. **irradiance** says "illuminance", which has no entry.
- **wavefront**: "marches rays", "shades them". There is no entry for march or shade.
- **solid angle**: steradian, 4π sr. Fine if you remember the area of a sphere.
- **tile**: "lays a sample's rays over the picture with: one ray a tile". I couldn't parse it, or see why tiles differ from pixels.
- **matrix**: "right, up and backward directions". Why backward? I know only from outside knowledge of camera conventions.
- **normal**: "straight uphill, on the height lines". Uphill runs *across* contour lines, not along them, so this reads wrong.
- **f32**: "far from the origin". The origin of what?
- **Lipschitz bound**: hard but readable, and the best of the hard entries.

**Q3: disagreements and circles.**
- sample, kernel and tile disagree on what a sample is (above).
- GPU's "each pixel gets one" against two million pixels (above).
- mirror-like says "clear glass sends light on in exactly one direction", but chapter 10's line says glass both bends and reflects, which is two directions.
- Near-circular pairs: path and bounce define each other. **candela** is "how strongly a light shines in one direction", and **intensity** is that same thing "measured in candela". **lux** and **irradiance** do the same. In those two pairs, one side adds nothing.
- Missing headwords that the tutorial uses: ray tracing/ray tracer, shader, march/ray marching (only an alias inside sphere tracing), shade, luminance, illuminance, exposure, bias.

**Three changes.**
1. Add the missing headwords above, especially **march** (the figures' key uses it) and **shader**.
2. Fix sample (per pixel or per picture?), GPU against pixel count, normal's "on the height lines", and tile's sentence.
3. Give pdf, MIS, delta, radiance and BSDF one concrete everyday example each, the way the f32 ruler and the noise "four times, halve it" do.

## 3. Styles page

**Q1.** The page shows the same small scene and key in four looks: Lab notebook, Blueprint, Drafting sheet and Risograph. Pick one with the **Style menu at the top right**. The **Dark / Light button beside it** switches light and dark, and the choice is "kept on this device". Clear. I couldn't see the Dark/Light button in the screenshots, though. Figs 3 and 7 show only "Contents" and "Style: Lab notebook" at the right edge.

**Q2: things I didn't understand.**
- In every scene: "the march's steps" (big pale circles), "θ" (an arc between the normal and the dashed shadow ray) and "normal". The page explains none of them. That the circles are distances to the nearest surface, and that θ feeds the cosine law, I know only from **outside knowledge**.
- "Cyanotype", "stencil lettering", "small capitals", "drawings in a patent". These are general words a 16-year-old may not know, though "risograph" is explained.
- The dark versions are described ("white pen on a slate-grey page") but not shown.

**Figures.** Figs 1, 3, 5 and 7 show an eye, a blue camera ray to a ball, a dashed shadow ray to a draggable lamp, a normal arrow, θ, and step circles. They are readable. Figs 2, 4, 6 and 8 are the keys.

**Colours shared between meanings:**
- **Lab notebook**: the dotted "blocked" ray and the ⊕ handle are both red. In the scene, the lamp's ⊕ is orange, not the key's red.
- **Blueprint**: blocked ray and handle are both crimson. The navy dashed shadow ray is close in hue to the blue camera ray on blue paper; only the dashes separate them.
- **Drafting sheet**: orange-red marks three things: the lamp's ray, the blocked ray and the handle. Black marks two: the camera ray (solid) and the shadow ray (dashed). Grey marks both the normal and the step circle. This contradicts the page's own text, "one colour, orange-red, for light".
- **Risograph**: pink marks the lamp's ray, the blocked ray and the handle. Teal marks both the shadow ray and the normal.

In Drafting sheet and Risograph, a lamp ray and a blocked ray differ only by solid against dotted.

**Layout faults I could see.**
- In figs 4, 6 and 8, the hatched circle overlaps "its light" on two rows, and "a solid shape" touches the circle.
- "⊕ a handle: drag it" collides with "surface" in figs 4, 6 and 8.
- In figs 3 and 7, the page's sticky "Contents / Style: Lab notebook" bar covers the top right of the figure. It names Lab notebook while I'm looking at the Blueprint and Risograph cards, which is confusing.

**Three changes.**
1. Give the blocked ray and the handle a colour of their own in every style, or at least in Drafting sheet and Risograph. Otherwise change the Drafting sheet text so it no longer says orange-red is only for light.
2. Fix the overlaps: move the key's disc away from the text, separate the handle row, and keep the header bar off the figures.
3. Add one line under the first scene: "the circles are the steps a ray takes (chapter 2); θ is the angle between the normal and the shadow ray". Also show at least one dark card.
