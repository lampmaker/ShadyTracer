# Blank reader: "Faster compiles"

## 1. Teach-back
The browser has to compile ShadyTracer's GPU programs (kernels) from text, and for a big scene that took over a minute. The old way compiled on the page's own thread, so the page froze and could not even show "recompiling…". The async way compiles on another thread, so the page keeps drawing. Ask for all kernels at once and wait for the last: the build then takes about as long as the slowest kernel, not the sum, so the slow kernel is the one to shrink. Only three kernels have the scene's shapes in their text (march, surface, occlusion). Adding a shape recompiles only those. The rest have the same text as before and come from a cache looked up by the whole text, so going back to a scene compiles nothing. The bar used to count finished kernels, so it jumped almost to full and then stuck. Now it predicts the time from the slowest kernel's size and moves by the clock. It also learns how fast the machine is, but ignores builds too fast to tell it anything.

## 2. Quiz
1. **Freeze:** the plain call waits "on the page's own thread" until the driver finishes, so nothing paints and no click is answered. `createComputePipelineAsync` (`async: true`) compiles off-thread and returns a promise. *Taught well.*
2. **Slowest, not sum:** started together, they compile side by side on several cores, and you wait only for the last. The page labels the cores reason *inferred*. Measured: 11.2 s against 13.4 s, half a second over shade alone, because the small kernels share the processor with it. *Taught*, honestly hedged.
3. **Adding a shape:** march, surface and occlusion recompile (plus "the step cache's fill" when it is on, which I can't place), because their text holds the shapes. The other thirteen hold no scene and, since 0.10.0, declare only the base uniforms. Their text is unchanged, so the pipeline cache returns them. *Taught.*
4. **Bar:** the tiny kernels finished in a few hundred ms, so the kernel count jumped to "12 of 13" and waited there for the big one. The new bar predicts the time from the size of the slowest kernel that actually compiles. It runs straight to 90% at that time, eases towards 99%, and finishes only with the build. *Taught.*
5. **Learning:** after each build, the slowest kernel's time against its size is blended in, half old and half new, and kept in the browser. Builds whose slowest kernel took under 300 ms are ignored, and so are builds 4× faster than the kept rate (the browser's own cache after a reload). One build can at most double the rate. *Taught.* Not taught: how one "rate" is pulled out when time grows as size to the power 1.37.

## 3. Where I got lost (worst first)
- **Figure 2's rows:** `genrays, flip, prep_march, shadow_flip, lt_build, emit_publish, sppm`… none is explained. The text says "the photon map" is among them, but I can't tell which row it is.
- **"kernel sizes that are a model's"** and **"under 151,000 characters chapter 24's model predicts less than 15.2 ms a thousand, over it more"**. Why 151,000? I only connected it to section 5's "power 1.37" through *outside knowledge*.
- **"hiding a node ... texts seen before, went from 4.2 and 3.0 seconds to 2.0 and 0.56: the builder's whole apply"**. Builder, node and apply are never defined. Hiding makes *new* text, so how is it "seen before"? Which number belongs to which action?
- **"nine sequential awaits"**, when there were 13 kernels.
- **Section 5's terms:** "a device that records", "a row", "trace", "frame", "dispatched", "chapter 24's third way", "records, not text", "in node" (Node.js is *outside knowledge*, and "node" already meant something else in section 2).
- **Hardware and versions:** "GTX 1080 Ti", "Pascal" and "Ampere" are never linked; only *outside knowledge* tells me the 1080 Ti is the Pascal card. Version numbers are never explained (0.10 could look smaller than 0.9).

## 4. Words and symbols
- **Cards that helped:** compile, pipeline cache, uniform, the stamps. The kernel card helped too, but it adds "sample", "rounds" and "chapter 22", which I didn't need.
- **Explained well in the text:** driver, pipeline, thread, promise, unroll, inlining.
- **Never explained:** GPU, distance function, "rays march", shade, occlusion, normal, uniform buffer, builder, step cache, photon map, schema, `Promise.all`, `Math.exp`, the `? :` operator, "fitted".

## 5. Figures
- **Fig 1** (compile bars, three ways): clear: red page bar frozen, ticks painting, "all at once" stacks bars from zero and the dashed line moves to 11.2 s; the materials screenshot repeats the pattern.
- **Fig 2** (session grid): open, add and back read well (13 blue and 3 red, then all blue). But **fig-2-before** has the cache *off*, so it looks exactly like fig-2-nocache, and the "scene's uniforms" point (Open B recompiling all 16) never shows. The caption also says "turn ... the scene-free kernels off", but that control is a choice between two declarations, not an on/off switch.
- **Fig 3 left:** the red jump against the blue straight line is very clear, and so is the 2.5× creep. The words "about 3 s left / taking longer than usual" appear in no screenshot.
- **Fig 3 right:** grey and blue bars converge, with the orange reload stub. I had to work out myself that the repeated 29.4 in the readout is the reload.

## 6. Maths fold-outs
There are none. The easing appears only as a code note and uses `exp`, which I don't know from school. "Size to the power 1.37" gets no formula. I checked the blend myself, (15.2 + 30.4)/2 = 22.8, then 26.6 and 28.5, but the page never says the true rate is 30.4. That worked example would make a good fold-out.

## 7. The code
- **Excerpt 1** (sync/async): clear with its note.
- **Excerpt 2:** "SUM of nine ... the longest one" lands. `rebind()`, `setResources` and "parks the values and replays them" stayed opaque.
- **Excerpt 3:** I got the gist only from the "before" paragraph. `computeUniformTypes`, `R.trace`, `forCompute` and "check-shaders pass two" stayed opaque.
- **Excerpt 4:** the first two lines are clear (text, not hash, because of collisions). From `finalCode` on, it is opaque.
- **Excerpt 5:** readable with the note, except `!(expectMs > 0)` and the `exp` line.

## 8. Too much, too little
- **Too much:** the last paragraph of section 1 crams five facts together (0.10.0, 38–48%, 11.4 vs 10.7 with a disclaimer, inlining, the 0.20.8 surface kernel). Section 3's "learn" paragraph is overloaded the same way.
- **Repeated:** "With no cache, a revisit is a compile like any other", twice in a row.
- **Rushed:** section 5's last three items.
- **Too little:** what each kernel does, and chapter 24's size-to-time model, which the whole chapter rests on.

## 9. Wrong or contradictory
- The text says the old bar showed "12 of 13"; fig 3's label says "kernels ready of 16".
- "Nine sequential awaits" against 13 kernels.
- The text says "the sixth is within 2%"; the readout reports build 7 (20.3 against 20.5 s).
- Section 1 calls "the user" "the person ShadyTracer is built for"; the *measured* card calls them "ShadyTracer's developer".
- fig-2-before cannot show what its paragraph describes (see 5).

## 10. Five changes
1. Give each of the 16 kernels a one-line job (or group them), and name the photon map's row.
2. Add a box recapping chapter 24's model (15.2 ms per 1000 characters, the 1.37 power, why 151,000), plus a fold-out working the rate blend through (15.2 → 22.8 → … → 30.4).
3. Fix fig 2's "before" step: cache on and the scene's uniforms declared, so Open B recompiles all 16. Remove the repeated sentence and match the caption to the controls.
4. Make the counts agree (9, 13 or 16 kernels; "of 13" against "of 16"; sixth against seventh build). Explain the version numbers once and say the GTX 1080 Ti is the Pascal card.
5. Define builder, node, trace, frame, dispatch and device, and "data instead of code", before section 5 uses them, or cut those items. Split the overloaded paragraphs.
