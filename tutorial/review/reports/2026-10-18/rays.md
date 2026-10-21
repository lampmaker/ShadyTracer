# Beginner read of "Rays make a picture" (ch/rays.html)

## 1. Teach-back (as the student)
A computer picture is a grid of dots called pixels. To colour each dot, the program puts an imaginary screen in front of an eye and sends a line, a ray, from the eye through each pixel. The pixel takes the colour of whatever that ray hits. Real light goes from the lamp, but very few lamp rays ever reach the eye, so that is wasted work. Light paths work in both directions, so you can start at the eye instead. The field of view is how wide the screen is compared with how far away it is. In 3D the screen is a grid, so doubling the pixels across and down gives four times as many rays. To tell how bright a hit point is, you send a shadow ray to the lamp: if something blocks it, the point is in shadow. A point gets less light when it is further away, and less when the light comes in at a slant (the cosine of the angle from the "normal"). One ray through the exact middle of a pixel sees all ball or all sky, and that makes jagged edges. Jitter sends each try through a random spot in the pixel, and the average comes out right. That's why ShadyTracer's picture starts speckly and gets smoother. Finally, there was a rounding bug that gave some pixels 0 or 2 rays.

## 2. Quiz
1. Hardly any lamp rays go through the pupil ("only one or two" of a few hundred), but every eye ray belongs to a pixel. It works because a path can be walked either way. **Taught.**
2. Which pixel it is (its position x from −1 to 1, at the middle or at a jittered point), the camera's forward and right (and up) directions, and the field of view through tan(fov/2). **Taught, but only inside the closed fold-out.**
3. A ray from the hit point towards the lamp. If it gets there, the point is lit; if not, it is in shadow. **Taught.**
4. A ray through the middle sees only ball or only sky, so the pixel is 0 or 1. Random points inside the pixel average out to the share the ball covers. **Taught for one pixel.** The "stair steps" themselves are never shown (see 3).
5. Four times as many. **Taught.**
6. Slanted light spreads over more surface, by cos θ. **Stated, not shown.** I only half believe it without a picture.
7. sqrt of a floating-point product came out a hair under w, and rounding down gave w−1 tiles. Pixels then got 0, 1 or 2 rays a sample depending on window size, which spoils noise comparisons. **Partly taught.** "Noise" is never explained, and neither is why a tile can miss its pixel. My answer uses outside knowledge.

## 3. Where I got lost (worst first)
- **§9, the bug.** I don't know what N, w and h are, why the number of tiles across is `sqrt(N * w/h)`, or what a "floating-point product" is. And how can a pixel get *two* rays? §7 said "The pixel is called a tile", so how can there be w−1 tiles for w pixels? The missing step: a ray counts for whichever pixel it lands in, and tiles are a separate grid of rays laid over the pixels. The comment block (`trace()`, `build.test.mjs`, `0.22.6`, `1-spp`, "control for") is a wall of jargon to me.
- **§7, the code.** The page says "A few things to notice, all in the lines above". But the step from the ray's index to its pixel (`cellxy`) isn't in the excerpt, and the seed lives in `raytrace_main.js:1822`. `UB`, `invTX`, `invProjection`, the `a` in `a*tan(fov/2)`, `0u`, `.xyz` and `rnd.zw` are never explained. "Matrix" and "inverse of the view matrix" are outside knowledge for me.
- **§5 / fig 5.** The caption says "One pixel's ray hits the ball". The screenshot shows it hitting the **block**, labelled "in shadow". The red dotted shadow ray points towards the lamp but stops in empty air, so I can't see what blocks it. Outside knowledge tells me the block's own corner does. θ is in the caption but not in the drawing, and the purple arrow is never named as the normal.
- **How a ray "finds what it hits"** is never mentioned, not even with "a later chapter shows how". It's the first thing I'd ask.
- **Fig 2, From the lamp.** The readout says "5 bounced into the eye", yet the strip says "the picture: nothing yet". Why nothing? And how do rays "bounce"? My physics says like a mirror. Scattering in every direction is outside knowledge.

## 4. Words and symbols before they were explained
- **ray**: it has a card only in the end list. It isn't marked at first use (§2), and that card ("a starting point and a direction") is the most useful one on the page.
- **sky**: first appears in §6. The faint blue rays and the light-blue pixels in figs 1–3 are never called sky.
- **noise**: in §9 and in the sample card, never defined. The sample card's "each one adds a little less noise" reads as if samples *add* noise.
- **normal card**: "For an SDF…": SDF is unknown. "refracts" is outside my physics.
- **irradiance card**: "illuminance, in lux", and "from all directions together" when the fold-out has one lamp.
- **intensity I**: not defined.
- **WGSL / WebGPU / compile / seed / PRNG**: the cards help a little. "Compiling" (§8) and "seed" (§7) have none.
- **tile**: appears suddenly in §7.
- **[STAMPED "READ IN CODE"]**: means nothing to me.
- The cards for pixel, camera ray, shadow ray, jitter, aliasing and field of view were clear.

## 5. Figures
- **Fig 1.** The idea is clear: rays fan out and the strip is the picture. Unexplained:
  - which end of the strip is the top ray;
  - why the ball has three shades (peach, salmon, brown) and why the block is dark navy (I'd think it's a dark block, not one in shadow);
  - what the red circled cross on the screen does;
  - why "From the lamp" and "Throw 400 more" appear on figures 1, 3 and 5.
- **Fig 2.** The orange burst makes the point well. The red floor-to-eye rays need a word.
- **Fig 3.** Clear. Unexplained: the medium-blue pixels mid-strip in fig-3-pixels, and why the screen's cross moved to the top end in fig-3-fov.
- **Fig 4.** The fan from one point is convincing, and "8 × 5 pixels, 40 rays" lands the square rule. Unexplained: why 5 down; hit dots are hard to place in depth.
- **Fig 5.** See 3: it contradicts its caption, θ is missing, and the normal is unlabelled.
- **Fig 6.** The best figure. The wedge, the 0.5 line and the wobbling average make the point. Two gaps:
  - Blue rays (hits) and grey rays (misses) have no legend.
  - At 35 samples it reads 0.343 against 0.500. A beginner may doubt it "settles" without being told it takes many samples.

## 6. Maths fold-outs
- **Direction:** I can follow it.
  - Say that i starts at 0. Otherwise x won't reach −1.
  - A small triangle showing tan(fov/2) = half-width ÷ 1 would turn the gloss into something I can check.
  - Say that "normalise" means divide by √(x²+y²).
  - The letter x clashes with a vector's x, which is what I know.
- **Brightness:** The circle-versus-sphere argument is good. I can't see *why* cos θ, though: a beam of width w on a slant covers w/cos θ. "Colour times E" assumes colour is a number.

## 7. The code
- **genrays:** The caption maps `uv0`, `rnd.xy`, `xy`, `fx`, `fy` well. `xy = uv*2 - 1` matches the formula only if I opened the fold-out. Still opaque:
  - `clamp`, and why it's there;
  - `isPersp`, `origin`, `UB.*`;
  - `invView[0]` as "columns";
  - "Stable method only".
- **raygenTiles:** I understand `Math.round` vs `floor`, but not the formula. `tilesY = ceil(N / tilesX)` is unmentioned.

## 8. Too much / too little
- **Too much:**
  - §8's three stamped notes (compiling, lens radius) for a first chapter;
  - file:line references;
  - §9's full comment;
  - the margin note's links to unwritten chapters.
- **Too little:**
  - how a hit is found;
  - a picture of stair steps (the flat world can't show them, so fig 4's grid could);
  - the slant-spread picture;
  - why a wide field of view stretches the edges.

## 9. Wrong or contradictory
- Fig 5 caption "hits the ball" vs the screenshot (block, in shadow); θ is named but not drawn.
- §2 "one or two" of "every few hundred" vs readout "5 … (1.3%)".
- §7 "all in the lines above" vs the index step and seed not shown.
- "The pixel is called a tile" vs §9, where tiles ≠ pixels.
- §3 "stretched" at the edges vs Try it "squeezed".
- Fig 2: rays reached the eye, but "the picture: nothing yet".

## 10. Five changes, most important first
1. Fix fig 5: make the ray hit the ball (or change the caption), draw and label θ and the normal, and end the shadow ray at what blocks it or at the lamp.
2. Rewrite §9 for a beginner: what N, w and h are, why `sqrt(N·w/h)`, that tiles are a ray grid laid over pixels and a ray counts for the pixel it lands in, and what noise is. Drop "The pixel is called a tile".
3. Mark **ray** at first use, and say what a ray that hits nothing becomes (sky). Explain the colours in fig 1's strip, and which end of the strip is which.
4. Add one sentence saying how a ray finds what it hits is a later chapter, and a small drawing for the cosine law.
5. Trim §7–8 to what the caption explains (cut or gloss `UB`, matrices, `a`, the "READ IN CODE" stamp), and fix the small mismatches (1.3% vs "one or two"; stretched vs squeezed; "nothing yet").
