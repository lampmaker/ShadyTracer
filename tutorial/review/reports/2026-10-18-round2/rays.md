# Beginner read of "Rays make a picture" (ch/rays.html)

## 1. Teach-back
A picture is a grid of dots (pixels). Each pixel's colour is whatever you would see looking out through it. You could copy nature and throw rays out of the lamp, but only about 1 in 100 ever reach the eye, so that wastes work. Instead you start a ray at the eye and send it through each pixel. This is allowed because light paths work in both directions. The ray stops at the first thing it hits, or it shows the sky. Its direction comes from where the pixel sits on a flat screen in front of the eye, and from how wide the field of view is. To find out whether the hit point is lit, you send a shadow ray to the lamp: if it gets there the point is lit, and if something blocks it the point is in shadow. Light that arrives at a slant spreads over a patch 1/cos θ longer, so each bit gets cos θ as much. A ray through the exact middle of a pixel is all-or-nothing, which makes jagged edges. Jitter sends each sample through a random point in the pixel and averages the results, which gives the true covered share but leaves speckle (noise) that fades as samples add up. On the GPU, a program called genrays makes all these rays at once. A rounding bug once gave some pixels 0 or 2 rays per sample.

## 2. Quiz
1. From the lamp, only about 1–2% of rays reach the eye (fig 2 says 1.3%), so most of the work is wasted. From the eye, every ray belongs to a pixel. *Not taught:* why a pixel needs "many rays to arrive" from the lamp but only one from the eye. I guessed it from *outside knowledge* (the shadow ray does the lamp's job).
2. The pixel's place on the screen (i of N, the point u inside it), the field of view, and the camera's forward and right (and up) arrows: d = normalise(forward + right·x·tan(fov/2)). This is only in the fold-out.
3. A ray from the hit point towards the lamp. If it arrives unblocked the point is lit; if not, it is in shadow.
4. A ray through the middle sees all ball or all sky, so whole pixels flip and an edge becomes steps. Jitter averages random points, so the pixel settles on the covered share. The page never *shows* a stair-stepped edge.
5. Four times as many (section 4).
6. The same beam covers w/cos θ of floor, so each bit gets cos θ as much. At 60°: ½.
7. Floating point made √ come out as 808.999…, and rounding down gave 808 tiles for 809 pixels. The tiles drifted off the pixel grid, so pixels got 0, 1 or 2 rays per sample. The picture still converged, but the noise depended on the window size, which spoils noise comparisons. I could *not* work out why wider tiles give some pixel *two* rays (see 9).

## 3. Where I got lost (worst first)
- **Section 10:** "the number across is √(N × w / h)". Why this formula, and why not simply w? It is never derived (tilesX·tilesY = N, tilesX/tilesY = w/h). Then "tiles … a little wider than pixels … some pixels got two rays": fewer, wider tiles sound like fewer rays. tilesY = ceil(N/tilesX) (396 rows for 395) is never mentioned.
- **Section 2:** "a pixel needs many rays to arrive before it has a value". Why many? The backward method gets away with one, and the page doesn't connect that to the shadow ray of section 5.
- **Section 3:** "a pixel near its end sees a narrower slice of angle … covers more pixels". It is one dense sentence, and no figure shows it (see 5).
- **Section 8:** "fwd points backwards". A variable called forward that points backward needs more than one clause.
- **Section 9:** "Point at a stamp for what the others mean". I only ever see one kind of stamp. Also, "its program text is the same for every scene" assumes I know that other kernels change with the scene. *Outside knowledge.*
- **The opening:** "ShadyTracer asks one question". What ShadyTracer *is* (a program that makes pictures) is never said.

## 4. Words and symbols
- **normal:** the card says "For an SDF … on the height lines". SDF is never explained, so the card hurt more than it helped.
- **bounce, sample:** both cards say "path", which isn't taught yet.
- **intensity, irradiance:** "candela", "lux" and "illuminance" are extra unexplained words. "How much light lands" never says per how much surface.
- **d** means *direction* in section 3 and *distance* in section 6. **w** means beam width (section 6) and picture width (section 10).
- **In the code:** VEC2, u32/f32, `1u`, `UB`, `inv` in invView/invProjection, "1-spp" and "floating point" are all unexplained. ".xyz", "%" and "rounded down" were explained well.
- **θ vs ϑ:** fig 6's caption prints "ϑ" while the readout and text use "θ".
- **File references** (raytrace_main.js:1822, genrays.js:64, lens.js:42) mean nothing to me.

## 5. Figures
- **Fig 1:** clear. Twelve rays, the strip coloured 3 sky / 3 ball / 5 block / 1 floor. "Left end is the top" is needed and given. The objects' own colours aren't visible (they are hatched), so I couldn't tell whether the dark navy is the block's colour or its shade.
- **Fig 2:** the point lands, thanks to the readout "5 bounced into the eye (1.3%)". But the bounces themselves aren't visible: the orange rays look straight. The red legs are the only bounced segments I can see. The pupil isn't labelled.
- **Fig 3:** fig-3-pixels.png and fig-3-fov.png are **identical** (28 pixels, 104°). So the pixels step already shows a changed field of view, and there is no before/after for either idea. The stretching at the ends isn't visible.
- **Fig 4:** good. The fan, the 8×5 grid and the corner picture match. This would be the natural place to show stair steps.
- **Fig 5:** the normal, θ and "blocked here ✕" are clear. The text says "meets the floor **behind** the block", but the hit point is between the eye and the block.
- **Fig 6:** the clearest figure: 1.10 → 2.20, and 1.00 → 0.50. The labels "w = 1.10" and "normal" overlap in the straight view. "1.10" has no unit.
- **Fig 7:** in the still view there are three dark lines. Which one is the ray and which are the wedge edges? The caption promises blue and grey rays, but there are none. At edge 50% the middle ray grazes the ball and reads 0.000, which is a confusing tie case. The jitter view works (0.361 creeping toward 0.5). The claim about 400 samples isn't shown.

## 6. Maths fold-outs
- **Ray direction:** I followed most of it, and the tan triangle explanation is good. Missing:
  - u's range (0 to 1);
  - which end of the screen is −1;
  - that "right across the screen" is *up* in the side view;
  - a worked example (N = 12, 52°).
  
  The 3D line introduces f_x, f_y as "half-widths". The code then says fx = a·tan(fov/2), which reveals that fov in 3D is the vertical angle. That is never said.
- **Brightness:** cos θ was fine. d versus d² was fine via circle and sphere. The step from E to "pixel = colour × E" was fine.

## 7. The code
- **genrays:** the caption made lines 53–61 readable once I matched uv = (cell + rnd)/tilesX to x = 2(i+u)/N − 1. The page should state that match. Lines that stayed opaque:
  - `max(1u, UB.tilesX)`;
  - `UB.rayFirst` (where does it come from?);
  - `fres` (declared, never used);
  - `clamp`;
  - `invProjection[0][0]`.
  
  The excerpt also stops mid-`if`: `origin` is declared but never set, and `camPos` is never used. So "from the eye" isn't visible in the code.
- **raygenTiles:** the caption helped. The comment is developer history ("trace()", "build.test.mjs", "0.22.6", "1-spp"). `Math.ceil`, tilesY and the `Math.max(1, …)` guards are unexplained.

## 8. Too much, too little
- **Too much:** section 9's stamps, the file:line references, and the long code comment. The first code excerpt is 34 lines when about 10 carry the idea.
- **Too little:**
  - why one eye ray suffices;
  - a stair-step picture;
  - the field-of-view stretch;
  - the derivation in section 10.
- **Repeated:** "more pixels, finer detail, more work" appears three times, which is fine.

## 9. Wrong or contradictory
- Section 1 says "one pixel per direction"; section 7 says "A pixel covers a small wedge of directions, not one direction". The second is never flagged as a correction.
- "Behind the block" disagrees with fig-5-shadowed.png.
- Fig 3's two screenshots are the same.
- Fig 7's caption describes blue and grey rays that the still view doesn't show.
- Section 9 says the lens "draws no extra random numbers", but the code always calls `PRNG()` for four numbers, "zw the lens point".
- "Tiles wider than pixels" seems to contradict "some pixels got two rays".
- d and w each have two meanings; θ and ϑ are both used.

## 10. The five changes
1. **Make the figures match the text.**
   - Give fig 3 distinct pixels and field-of-view states.
   - Fix "behind the block".
   - In fig 7's still view, label the ray versus the wedge, colour it per the caption, and avoid the 50% tie.
2. **Section 2: say why one eye ray is enough.** It asks the lamp directly (the shadow ray, section 5), while lamp rays must pile up by chance. Make the bounces visible in fig 2.
3. **Show aliasing, and reconcile "one direction" with "wedge".**
   - Show a stair-stepped edge, for example fig 4 with jitter off and on.
   - Say plainly that section 1 simplified.
4. **Ray-direction fold-out:**
   - Add a worked numeric example.
   - Give u's range and which end is −1.
   - Say "right" is up in the side view.
   - Rename one of the two d's.
   - Tie the formula to the code (u = rnd, N = tilesX).
5. **Cut or explain the developer layer:**
   - file:line references and the stamps;
   - the opaque lines (`rayFirst`, `fres`, `max(1u…)`, `inv`, the missing `origin`);
   - in section 10, derive √(N·w/h) and show a tiny example of how tiles that don't line up give a pixel 0 or 2 rays (mention tilesY).
   
   Also say in the first line what ShadyTracer is, and drop "SDF" from the normal card.
