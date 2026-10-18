## 1. Teach-back
A pinhole camera sends every ray from one point, so everything is sharp. A lens is a disc of radius R around that point, focused at a distance F. For each pixel the renderer finds where the pinhole ray would cross the "focus plane" at distance F. It then starts the ray from a random point on the disc and aims it at that spot. Something on the focus plane is hit by all of one pixel's rays, so it stays one dot. Something nearer or farther is reached by rays that belong to different pixels, so it spreads into a blur of size 2R|1/F − 1/D|. Bigger lens means more blur, and being farther from the focus means more blur. Each sample uses one random lens point, so the blur only shows up after many samples are averaged, and it looks grainy at first. A wider aperture makes the range that looks sharp ("depth of field") shallower. With R = 0 the renderer skips the lens code and you get exactly the old pinhole. The lens was also added once to help light through glass reach the camera, but a "photon map" took over that job later.

## 2. Quiz
1. Pick a random point on the lens disc. Find where the pinhole ray for this pixel reaches the focus plane (the pinhole direction × F). Aim from the lens point to that spot (subtract the offset, then normalize). I could follow this, except that `dirCam` was never explained.
2. All of a pixel's rays meet at one point on the focus plane, so a thing there lands in one pixel. A nearer point is crossed by rays of several pixels. The blur is 2R|1/F − 1/D| on a picture one unit away; divide by tan(fov/2) to get it as a share of the half-height. Example: 0.175 → 0.48 → about 240 px out of 1000.
3. It blurs whatever is out of focus more, so less looks sharp. It also needs more samples to settle (Try it, item 3).
4. With a pinhole, a floor seen through a prism came out black, because light → glass → floor → glass → eye can't hit a single point, and a lens is an area. Since 0.61.0 the photon map handles that light (photons going through the lens had caused white specks), so only depth of field is left. *Why* the photon map can do it is not taught here (chapter 19).

## 3. Where I got lost (worst first)
1. **"a free choice at the floor has no chance of hitting a single point"** and the comment's **"The camera side cannot find that path either… guess the one direction the glass maps onto the light"**. In real life a floor behind glass isn't black, so why is it here? This only makes sense if you already know that the renderer picks *one random direction* at each matte bounce, and that it tries to aim straight at the lamp from the camera side. That is *outside knowledge* (path sampling, next-event estimation). "SDS" is never explained.
2. **The genrays code.** `dirCam` is never explained. The text says "fwd points backwards", but the code *adds* `fwd * dirCam.z`. I only guessed that dirCam.z must be −1 because the bracket "goes exactly one unit forward". "**Less off**" reads like a typo for "minus off".
3. **"the renderer has no film, a pixel is a direction"** and **"measured on a picture one unit in front of the eye"**. Why one unit? Where is that picture in the figure? (Not at the column, the page says.) This leans on chapter 1.
4. **"A lens is an opening with a focus"** / **"a lens, an opening with a width"**. An opening alone doesn't focus anything. Nothing says that glass bends light so that light from one distance meets again. I knew a convex lens converges light (*outside knowledge*). School physics as described here covers only reflection, and refraction first appears in section 3.
5. **"each by its own 1/D from the focus"** is cryptic. It means "by how far its 1/D is from 1/F".
6. **Order:** the lens.js excerpt comes *before* the paragraph that ends "**The lens's own file says so:**". What follows that colon is the paragraph about the kernel, not the file's comment.

## 4. Words and symbols
- *thin lens*: the card helps, but it says rays "meet again" without saying why.
- *focus plane*: the card says "The distance a lens is focused at". A plane isn't a distance, though it still helped.
- *fov*: the card helps; working out tan(fov/2) from a right triangle was up to me.
- *sample*: the card is good.
- *kernel*: the card helps.
- *WGSL*: never explained.
- *SDS*, *photon map*, *connection's weight*: no card.
- *jitter*: one clause; OK.
- `rnd.zw` / `.xy`: the caption explains it enough.
- `lensImage`, `lensDisc`, `lensRay`: named in captions with no explanation.
- *pinhole*: not marked ° in the text, though it has a card at the end.
- No units anywhere: 0.6, 6.22, and so on, of what?

## 5. Figures
**Fig. 1 (side view):**
- *focused*: the rays fan from the lens bar to one point and make one orange dot. Clear.
- *near*: dashed rays spread across the focus plane, and an orange streak shows on the picture. Clear, and the readout matches the text (0.4808, 240 px).
- *pinhole*: one ray. Clear.

Problems:
- Two identical ⊕ handles (the point, and the focus plane's foot), so it's not obvious which is which.
- The label "the picture (where it land…" is clipped.
- In *near* the streak touches the top of the picture column, so I wasn't sure whether part of it is cut off.
- Nothing links a dashed ray's height on the focus plane to a spot in the streak. One ray drawn in a matching colour would help.
- The point is red but its image is orange, and the colour isn't explained.

**Fig. 2 (3D balls):** the point (sharp vs blurred) comes across in *near* and especially *wide*. But:
- The picture is very low resolution and blocky. The "sharp" pinhole has jagged edges, so blockiness and blur are hard to tell apart.
- *middle* at 0.25 vs *pinhole* is a subtle difference.
- The text promises "grainy at first", but no screenshot shows grain.
- The caption says "many samples a pixel", while the pinhole readout says 4.

## 6. Maths fold-out
Mostly followable with similar triangles. Where it got harder:
- The step from the height a + (h − a)F/D to y = h/D + a(1/F − 1/D) is skipped ("divide by F"). I had to do the algebra myself.
- "|1/F − 1/2F|" can be read as (1/2)·F. Write 1/(2F), and say that half as far means D = F/2, so 1/D = 2/F.
- "that ray rises its height over F" is awkward wording.
- "the share of the half-height": why the *half*-height is used isn't said. The 240 px only works out if you know the half-height is 500 px.

## 7. The code
- **lens.js comment:** the argument depends on photons and on "SDS". "could work in parallel" and "(below)" point to things not shown.
- **genrays:** `R > 0` and "skip at 0" are clear, and so are `origin = camPos + off` and `normalize`. These stayed unclear: `dirCam`, the sign of `fwd`, the fact that `UB.camLens.y` is F (the caption does say so), and how `lensDisc` turns two numbers into a disc point.

## 8. Too much, too little
- **Too much:** the black-prism story is told three times (the code comment, section 3, section 5). Version numbers and dates (0.22.6, 0.43.0, 0.61.0, 2026-10-08…) are noise for a beginner. The first "near" paragraph packs five numbers and two divisions into a few sentences.
- **Too little:** why a lens focuses, how the pixel/picture set-up works, `dirCam`, and the SDS argument. The "area cancels" trick is opaque, but it is honestly flagged as being for chapters 18–19.

## 9. Wrong or contradictory
- "0.6" is the **radius** in Fig. 1 but the **diameter** in Fig. 2. The text warns about this, but it still trips you up.
- "fwd points backwards" next to `+ fwd * dirCam.z` looks like a contradiction until you know that dirCam.z is negative.
- The heading "a lens is an opening" vs. real glass.
- "The lens's own file says so:" comes after the excerpt it refers to.
- Fig. 2's caption says "many samples" but the pinhole uses 4.

## 10. Five changes
1. **Rewrite the "beyond depth of field" argument** for someone with no path-tracing background. Say plainly that the renderer picks one random direction at each matte bounce. Say why it can't simply aim at the lamp through glass. Define or drop "SDS". Put that paragraph before the excerpt it introduces.
2. **Explain why a lens focuses** (glass bends light, so light from one point at distance F meets again). Say that the renderer runs this backwards: each pixel aims at one point. Fix "an opening".
3. **Explain `dirCam`**: it is the pixel's spot on the picture one unit ahead, with z = −1 because fwd points backwards. Replace "Less off" with "minus off". Show that one-unit picture in Fig. 1, or say plainly where it would be.
4. **Fig. 2:**
   - Use a higher resolution or a zoomed crop.
   - Add an early screenshot that shows the grain.
   - Give units.
   - Use the same quantity (radius or diameter) in both figures.
5. **Fold-out:**
   - Show the division step.
   - Write 1/(2F) and spell out that D = F/2 gives 1/D = 2/F.
   - State that the half-height is 500 px for 1000 px.
   - Make the two ⊕ handles look different.
