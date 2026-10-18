# Beginner review: contents, glossary and styles pages

I read them as a 16-17-year-old who knows a little JavaScript and school maths. Wherever I understood something only because I already knew it, I've marked it **[outside knowledge]**.

## 1. Contents page (index)

**Teach-back.** This is a tutorial about how ShadyTracer, a program that runs in the browser, turns shapes and lamps into a picture. There are 34 chapters in ten parts, and only three are written so far (1, 2 and 14). Every figure is a 2D slice of a scene with one colour key, and you can drag its handles. Three stamps say how sure a claim is. A menu switches the page style.

**Quiz.**
1. **What will you learn, and what do you need first?** You learn "rays, distances, light, glass, noise, photons, haze, the graphics card and every trick that makes it fast." On what you need first, the page only says what you *don't* need ("No ray tracing, optics or GPU programming"). It never says what you *do* need: JavaScript? Which maths? "The maths in a fold-out" gives no level.
2. **The three stamps.**
   - MEASURED: someone ran it on real hardware, and the page says who, on which card and where it is recorded.
   - READ IN CODE: the code does this, and the line is linked.
   - INFERRED: an untested guess, with what would test it.

   I took "card" to mean graphics card and "never what it costs" to mean time, not money **[outside knowledge]**.
3. **Lines in the figures, and what you can drag.**
   - Blue: camera ray.
   - Orange: lamp or light ray.
   - Grey dashed: "shadow ray that reached its light".
   - Red dotted: blocked or gone wrong.
   - Purple arrow: normal.
   - Hatched: a solid shape.
   - Red ⊕: drag these.

   Paragraphs with a dot move the figure. I could not tell what a "shadow ray" is from this page.
4. **Unknown words.** Hover over a dotted word. On this page only "flat world" is dotted, and the map has no entry for the glossary itself.

**Where I got lost (worst first).**
- **"Start here" points to chapter 0, which is "planned".** The chapter that explains the figures and how to run the app doesn't exist yet. Nothing says whether I can jump from chapter 2 to chapter 14 and skip 3-13 ("Monte Carlo", "importance sampling").
- **"Path tracer" and "renderer" are never explained in plain words.**
- **Many chapter lines are lists of jargon with no hover cards**, for example:
  - "Microfacets, GGX"
  - "Henyey-Greenstein"
  - "No float atomics, one resolve a sample"
  - "the 2 s watchdog"
  - "the plan that was reverted"
  - "metres inside"
  - "JS mirrors"
- **"(this is the first round, for judging the direction)"** is written for reviewers, not readers.
- **"ShadyTracer's own rules"**: I don't know what rules these are.

**Words used before they were explained.**
- In the glossary, but not linked from this page: path tracer, jitter, signed distance fields, sphere tracing, Monte Carlo, shadow ray.
- Not in the glossary at all:
  - photons, haze
  - Snell, Fresnel, Abbe number, sRGB
  - Russian roulette, power heuristic, white furnace
  - codegen, baking, governor
  - "Flatland" (is it the same thing as "flat world"?)

**Screenshot (fig-1).**
- "blocked, or something gone wrong" gives one line style two different meanings.
- "light: a lamp, a light ray" mixes an icon and a line in one entry.
- The text says "circled crosses", but the symbol is a circled *plus* (⊕).
- "The same colour means the same thing in every one" is not true across styles. In Drafting sheet the camera ray and the normal are both black. In Risograph they are the same blue.
- The sun icon and "fig. 1" sit against the left edge and may be clipped.

**Three changes that would help most.**
1. Put on this page what to read first (given that only 1, 2 and 14 exist), and how to open the app and what it needs (browser, graphics card).
2. Add one plain sentence saying what a path tracer is, and state the prerequisites positively.
3. Rewrite each chapter line as the question it answers, or link its words to the glossary.

## 2. Glossary

**Teach-back.** An A-Z list of terms. Each has one or two sentences, the chapter that explains it (written or planned), and "See also" links. The same entries pop up as hover cards inside the chapters.

**Quiz.**

1. **Five entries I'd look up first, and whether each made sense alone.**
   - **path tracing: partly.** "following many random paths from the eye" goes against what I learned in physics (light travels from the lamp to the eye). It doesn't say why going backwards is allowed, or why the paths are random. I don't know the word "converges". I only get it **[outside knowledge]**.
   - **ray: yes**, clear.
   - **GPU: mostly.** In "Each pixel's ray can be one of them", "them" is the processors, but a ray isn't a processor.
   - **signed distance field: yes.** This is the best entry. Small gap: "shapes are all SDFs" makes a shape sound like a function.
   - **sample: no.** "each one adds a little less noise" reads as if samples *add* noise.
2. **Entries that need words I'd have to look up again.**
   - error bar: "standard error"
   - irradiance and radiance: "illuminance", "lux", "luminance", "candela"
   - solid angle: "steradians", and "a ball" (of what size? It has to be radius 1 **[outside knowledge]**)
   - f32: "its steps get coarse" (numbers have steps?)
   - Lipschitz bound: "changes faster than the real distance does" and "Divide by how much faster" are rates of change, which is calculus. Divide what?
   - mirror-like (delta) direction: "delta", "light sampling" (no entry for it)
   - escape: "marching", "the scene's radius", "gives it the sky"
   - kernel: "frame"
   - wavefront: "queues", "march, shade", "workers"
   - firefly: "divided by a tiny pdf" (why divide?)
   - BSDF: spelling out the name adds four more unknown words
   - normal: "refracts"

   No entry at all for: photon, scene, material, renderer.
3. **Disagreements and circular definitions.**
   - **throughput vs albedo.** Throughput "multiplies it by what the surface *keeps*". Albedo says the surface "sends back out" a share and "the rest is absorbed". So "keeps" sounds like *absorbed*, the opposite of what's meant.
   - **CSG vs union.** CSG says "union (both)", but "both" sounds like intersection. The union entry says "the distance to either".
   - **sphere tracing vs step scale and Lipschitz bound.** Sphere tracing says moving the full distance is safe ("nothing can be skipped"). Step scale moves only 0.9 of it, and Lipschitz bound says "a step can jump over a surface". Two fixes are given (0.9, and "divide") and it doesn't say which is used.
   - **Monte Carlo** is nearly circular: "Working out an average by ... averaging them". An average of what?
   - **noise and sample** are each defined using the other.
   - **lens** calls the blur "depth of field" (normally that word means the range that is sharp **[outside knowledge]**).
   - One thing checks out: "Four times the samples halve it" matches "one over the square root". I verified that.

**Where I got lost (worst first).**
1. Lipschitz bound.
2. pdf: "How likely ... to land at each value", then "divides by it".
3. mirror-like (delta) direction: "A random direction never hits it".
4. MIS: "weighting each by how good it is".

**Screenshots.** There are none. In the text, the definition runs straight into the chapter note ("absorbed.Planned: chapter 8"); if the real page looks like that, it needs a break. Words inside definitions aren't linked, so looking one up means scrolling.

**Three changes that would help most.**
1. Fix the three wordings that point the wrong way: throughput's "keeps", CSG's "union (both)" and sample's "adds a little less noise".
2. Add entries for the words definitions rely on (light sampling, luminance/lux/candela, standard error, march, frame, photon, scene), and link words inside definitions.
3. Rewrite Lipschitz bound, pdf, delta direction and path tracing for a reader without calculus. In path tracing, say why tracing from the eye gives the same answer.

## 3. Styles page

**Teach-back.** You can pick how the tutorial looks: Lab notebook, Blueprint, Drafting sheet or Risograph, each with a light and a dark version. The same sample figure is shown in each style.

**Quiz.**
1. **What is the page for, and how do you change the style?** It lets you choose a look. The menu at the top right of every page changes the style, "the button beside it" switches light and dark, and the choice is "kept on this device".
2. **Anything I didn't understand?**
   - Print and design words: cyanotype, whiteprint, Prussian blue, vellum, vermilion, patent drawing, zone marks, small-capital, Risograph, zine, grotesque, "out of register", stock, book face, body face. They're not essential, but from the names alone I couldn't choose.
   - The figure itself is never explained.

**Where I got lost.**
- **The figure:** what the two big faint circles are, what the ring with **θ** at the hit point is, and which two lines θ measures between. I only guessed the circles are sphere-tracing steps and θ belongs to the cosine law **[outside knowledge]**.
- **"the button beside it"**: beside what?
- The contents page says this page shows the styles "side by side", but here they are stacked.

**Words used before they were explained.** θ and the purple normal arrow; the arrow is only known if you've seen the contents page's key.

**Screenshots.**
- Only light versions are shown; the dark versions are described but never seen.
- "Title block", "ruled border", "zone marks" and "FIG. numbers" don't appear in any figure.
- **Drafting sheet (fig-3):** camera ray, shadow ray and normal are all black, which breaks the contents page's "same colour means the same thing".
- **Risograph (fig-4):** the camera ray, normal and θ ring are all the same blue. The shadow ray is green/teal, a third ink that isn't in "fluorescent pink and blue".
- **Blueprint (fig-2):** the blue ray and the violet normal are hard to tell apart.
- **Lab notebook (fig-1):** no red is visible, despite "red pencil".
- **Handles:** none of the four figures shows a ⊕, so I can't tell what is draggable in an "interactive drawing".
- **θ:** the label sits inside the solid ball.

**Three changes that would help most.**
1. Label the sample figure: say which chapter it's from, and what the circles and θ are.
2. Show the colour key in every style, and fix the styles where the camera ray and normal share a colour (or tell readers to go by line shape instead).
3. Give plain hints for the print words (for example, "white lines on blue, like an architect's plan"), and show the dark versions.
