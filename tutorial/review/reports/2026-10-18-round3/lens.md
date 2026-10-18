# Beginner's review: "The camera's lens" (Chapter 17)

## 1. Teach-back
A pinhole camera starts every ray at one point, the eye, so everything is sharp. A real camera has a lens, which is an opening with a width, so only things at one distance (the focus, F) are sharp. To make a ray for a pixel, ShadyTracer picks a random point on a disc of radius R around the eye. It then aims the ray at the spot where the pinhole's ray for that pixel would cross the focus plane. A point on the focus plane is hit by rays that all belong to one pixel, so it shows as a dot. A nearer point is crossed by rays that belong to different pixels, so it becomes a smear. The smear is 2R|1/F − 1/D| wide. A bigger lens gives more blur, and so does being further from the focus. With R = 0 the ray is exactly the pinhole's ray. A pixel's colour is the average of many such rays, which is why lens pictures look grainy at first. The lens was also meant to let light that went through glass reach the camera, but a "photon map" now does that job.

## 2. Quiz
1. The ray starts at a random point on the lens disc and is aimed at the point where the pixel's pinhole ray meets the focus plane. Many of these rays are averaged.
2. Every lens ray that passes through a point on the focus plane belongs to one pixel. Rays through a nearer point carry on to different heights on the focus plane, which means different pixels. The size is 2R|1/F − 1/D|. **However**, with the figure's numbers (R = 0.6, F = 6, D = 3.2) I get 0.175, not the "0.48" the page gives. I only matched it by dividing by the readout's unexplained "tan(fov/2)". I needed *outside knowledge* that fov is the field of view.
3. It makes the blur larger and the sharp range shallower, and the picture takes longer to settle.
4. A point camera can never receive light that went lamp → glass → floor → glass → eye, so a floor inside a prism looked black. A lens has an area, so light could pass through it. That reason is gone since 0.61.0: the photon map handles it. Only depth of field remains. I was unsure what "first added" means, though, because §5 also says depth-of-field controls existed before 0.22.6.

## 3. Where I got lost (worst first)
- **"Its size is 2R |1/F − 1/D| (over the picture's half-height): here 0.48."** The formula gives 0.175. The missing step is the "/ tan(fov/2)" in the readout, and "fov" is never explained.
- **The code note on lens.js and the comment itself:** "scattered off a diffuse surface", "SDS", "the last refraction decides it", "the chance that it is aimed at a point is zero", "guess the one direction the glass maps onto the light". I don't know refraction well, what "diffuse" means, or that the lamp is (presumably) a point. Without that last fact, "the one direction" makes no sense.
- **§4 "The lens's area cancels":** "connected to the camera", "one divides by the lens's area, the other's chance of picking that point carries the same area", "the connection's weight". I could not follow any of this.
- **"Now the rays ... are the rays of different pixels":** this needs the rule "a pixel is one point on the focus plane", which the page only implies in ¶1. I had to piece it together.
- **"each pixel averages many rays":** why average, and why random? "samples a pixel" and "lose its grain" are never explained (*outside knowledge*: Monte Carlo).
- **"The camera hands the kernels half its aperture ... so an orbiting view stays focused on its target":** I don't know what kernels, an orbiting view or an orthographic camera are.
- **"Focal length and aperture with no page":** I don't know what "no page" means.

## 4. Words and symbols
- Never explained, and no card: aperture (first used in §2, only glossed in the depth-of-field card), focus plane, sample, grain, fov, kernel, WGSL, `normalize`, jitter, `right`/`up`/`fwd`, `dirCam`, `UB`, random stream, weight, diffuse, refraction, SDS, photon map (it says "chapter 19", a later chapter), orthographic, path tracing (in the part title), and "the user" (who is that?).
- "blur°" has a dotted underline, but no card called blur is listed. Presumably it opens "circle of confusion", which says *disc*, while the figure shows a streak; the fold-out reconciles this only at its end.
- The pinhole camera, camera ray, photon and depth-of-field cards helped. The photon card was essential for the code comment but not enough on its own.

## 5. Figures
- **Figure 1:**
  - The focused → near → pinhole sequence is clear. The fan of rays meeting at the dot, then spreading (dashed) into a tall orange bar, makes the point very well.
  - "Dashed" means three different things: the red focus plane, the carried-on blue rays, and a grey horizontal line nobody explains.
  - I wasn't sure where the "picture" column really is. It is drawn beyond the focus plane, and my school pinhole camera puts an inverted image *behind* the hole.
  - The eye icon sits left of the bar, not "round" it, and the pinhole ray starts at the bar, not at the eye.
- **Figure 2:**
  - Near vs. wide is convincing: the yellow and blue balls go fuzzy.
  - Pinhole vs. middle is hard to see, because the low-resolution blocky pixels make "sharp" look rough anyway.
  - Nothing says which colour is which ball. I worked out that red is near from its size and the 3.62/6.22/10.03 readout.
  - The samples count changes (4, 45, 48, 45) with no word on why. Is the pinhole done at 4?
  - Figure 1's slider is a **radius** (0.60) and Figure 2's is a **diameter** (0.60). They look identical but are not.

## 6. The maths fold-out
- The first step, "a + (h − a) F/D", is a straight line through two points. I could check it with similar triangles, but the page doesn't say that, or draw a and h.
- "which through the pinhole is the picture position" hides the step "divide by F". I only got it by guessing.
- "(in units of the distance to a picture one unit away)" reads as circular.
- "measured in 1/D" is opaque.
- The fold-out stops before the "/ tan(fov/2)" that turns its answer into the 0.48.

## 7. The code
- The note above genrays.js helped: R is camLens.x, the focus is camLens.y, and rnd.zw picks the lens point. `if (R > 0.0)` is clear, and `origin = camPos + off` is clear.
- `dir = normalize((right*dirCam.x + up*dirCam.y + fwd*dirCam.z) * UB.camLens.y - off)` stayed opaque. Nobody says that the bracket is the pinhole direction, that multiplying by F lands on the focus plane, or that "− off" makes it start from the lens point. I don't know `normalize`, `lensDisc`'s arguments or `UB`.
- The lens.js excerpt is prose, but too dense for me (see §3 above).

## 8. Too much, too little
- **Too much:** "radius 0 = pinhole, no extra random number" is said three times (§1, the code note, §4). The black prism floor is told three times (the code note, the comment, §5). Version numbers and dates mean nothing to me.
- **Too little:** why we average random rays, the focus-plane-equals-pixel rule, what the code's vectors are, and why a point camera can't receive the light (the lamp being a point).
- **Rushed:** §4.

## 9. Wrong or contradictory
- The formula gives 0.175 with the shown values, but the text says 0.48.
- "takes no random number" vs. "rnd is one draw of four random numbers": if all four are drawn anyway, what does the lens not take?
- "the far balls are much softer": the button is "The far ball" (singular). I took it to mean the middle and far balls.
- "Why first added": §5 says the lens came in 0.43.0 "partly for that", but also that depth-of-field controls existed before 0.22.6.
- Radius in Figure 1 vs. diameter in Figure 2 (above).

## 10. Five changes, most important first
1. Make the blur number add up. Either explain field of view and the tan(fov/2) step in text and fold-out, or quote 0.175 and convert it explicitly. Add the "divide by F" step, with a little labelled sketch of a, h, D and F.
2. Say in two sentences why rays start at *random* lens points and are averaged. Define "sample" and "grain", and why the blur itself is that average.
3. State the rule outright: "each pixel is one point on the focus plane; all its rays aim there." Then the near-point streak follows.
4. Walk through the genrays line piece by piece (pinhole direction × F = focus-plane point; − off; normalize). For the photon reason, put a plain-words paragraph *before* the lens.js comment that glosses refraction, diffuse and "the lamp is a point". Also mark §4 as advanced.
5. Tidy the labels:
   - one word for radius vs. aperture (diameter)
   - colours or distances on the balls
   - one meaning for "dashed", and a label for the grey axis
   - a sentence on where the "picture" column sits and why it isn't upside down
   - a card for aperture and focus plane, and a card or rename for "blur"
