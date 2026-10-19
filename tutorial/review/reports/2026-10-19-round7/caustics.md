# Caustics: a beginner's reading

## 1. Teach-back
A caustic is the bright patch that glass or a mirror focuses onto a surface. The renderer normally works backwards from the eye: for each floor point it sees, it sends a shadow ray straight at the sun. Under a glass ball that ray hits the glass and counts it as "in the way", because the real light came along a bent line that only Snell's law gives, and a randomly chosen direction never lands exactly on it. So the floor under the ball looks like a shadow with random bright specks, and the picture settles slowly. The cure is light tracing. You shoot photons from the sun and let them bend through the glass exactly. Where one lands on a surface the eye can see, you draw a straight line to the eye and add its light to that pixel. Each kind of path belongs to exactly one side so nothing is counted twice: "sun → glass → floor seen directly → eye" goes to the photons, everything else to the camera. Photons start from cells across the sun's beam. The renderer learns which cells' photons reach the eye, sends more from those, still spreads 20% evenly, and divides each photon by its chance so the total stays right. On one card this costs about 31% of the time.

## 2. Quiz
1. Through glass the light comes along one bent line (Snell, a "delta"). A shadow ray aimed straight at the sun meets the glass and counts it as blocking, and a random direction lies on the bent line "with chance 0". Taught well.
2. Light tracing means following photons from the light, through glass by Snell and Fresnel, then connecting the landing point to the eye. ShadyTracer gives it only light that has passed glass or a mirror and lands on a point the eye sees directly. Direct sunlight stays with the camera's shadow rays. The light source is the sun (section 6 also mentions "glowing objects' photons"). Taught, though "Fresnel" never was.
3. The caustic is counted twice: under the ball it reads too bright ("nearly twice"), and the open floor is unchanged. Taught.
4. A caustic seen through glass: eye, glass, floor, glass, sun. The shadow ray meets the ball and the photon's connection meets the pane. But whether it is *missing* or only *noisy* is unclear (see 9).
5. Each cell counts photons sent and connections made, and its worth is the ratio. A raw connection count would favour cells already favoured, so "the map would feed on itself". Taught well.
6. It protects against a caustic the map hasn't found yet, which is "still found, slowly, and the picture is never wrong while it learns". *Why* a cell with no chance would make the picture wrong (you would divide by zero, or its light would never be counted) was not taught. I filled that in from outside knowledge.

## 3. Where I got lost (worst first)
- **Section 1, paragraph 2** packs Snell, delta, "chance 0", "the floor's bounce", "picked at random (chapter 8)", "the flat world", "1 in 220", "85 against 0.39", "a rare find counts for more" and "1 in 66,111 with the sun 45° up" into one paragraph. "The flat world" is never explained. I guessed it means a 2D version, from outside knowledge. "A rare find counts for more" is the key idea behind the specks, but here it is only a pointer to chapter 8.
- **"sample"**: "from the first sample", "400 samples", "settles only slowly". The word is never defined and has no card. The ± in "0.455 ± 0.106" isn't explained either. The text says "noise read 0.963" and "equal noise about 40 times sooner", but 0.963/0.160 is 6. I only see 40 by squaring it, which is outside knowledge.
- **NEE**: it appears in section 5 ("paired with NEE"), section 6 and the code, and is never expanded. I guessed that it means the shadow rays.
- **"the camera's side tags a path as it forms, and when a path of that class reaches the sun it adds nothing"**: how does a camera path "reach the sun" if not by a shadow ray? The bounce idea from paragraph 2 is needed here, and the text doesn't connect them.
- **The code captions add new ideas the text never had**: the photon square may not cover everything ("outside the square… the camera keeps the sun"), and the "photon square" is 128 × 128.

## 4. Words and symbols
- **Cards that helped:** *caustic*, *shadow ray*, *path*, *photon* and *light tracing*. *Delta* helped too ("all of the light at one point").
- **Undefined, no card:** sample, flat world, illuminance, Snell's law (I half-know it from physics), Fresnel, radiance, ρ, Φ, solid angle, flux, lobe ("evaluable lobes", "a needle of a lobe"), NEE, MIS, BSDF, GGX alpha, luminance, vertex, "on escape", path space, Jacobian, firefly, WGSL, and Ampere/Pascal. The *measured* card partly explains the last two.
- **"Chapter N"** pointers stand in for explanations at least eight times (chapters 0, 1, 5, 8, 9, 10, 14, 19). As a reader of this page alone, I can't follow them.

## 5. Figures
**Figure 1.**
- **What it does:** it compares the camera alone, photons alone, both split, and both unsplit, with the strip as the picture. The four buttons and readouts make the point.
- **The strip:**
  - The label "pixel 1 looks highest, 48 lowest" took me a while: pixel 1 is at the left and is black (sky?).
  - Nobody says why pixels 13–17 are dark. I guess they are rays that hit the ball.
  - "A shadow… with bright specks" is hard to see at 400 samples. Under the ball the readout is 0.455, *higher* than the whole picture's 0.330.
  - The narrow and wide screenshots look almost identical. Only the ± drops (0.106 to 0.022).
- **Colours:** shadow rays and photon connections are *both* grey and dashed.

**Figure 2.** This one is clear: one path per kind, with the pane and the label at the top ("Counted by light tracing", "Counted by neither"). The caption's "blue as far as the first point the eye's own path reaches without glass" is hard to parse. The readouts count each glass surface ("glass → glass") while the text says "eye, glass, floor, sun". At first I thought there were two panes.

**Figure 3.** The bars dropping from 24 equal cells to 4 tall ones makes the point well, and so does 176 rising to 919. But:
- The other 20 cells show *no* visible bar, which seems to contradict "a fifth of them still go evenly".
- The "learning" screenshot reads "learned · sample 1 … 176 connected", the same as before. It doesn't say the map was rebuilt but no new photons were sent yet.
- "Drawn closer than it really is" is helpful.

## 6. The maths fold-out
I could follow the *shape* of the formula: each factor gets a sentence. The *why* depends on chapter 0's "1/d", on "f = ρ/2" (ρ is never said) and on "radiance". "Towards its edge the same angle spreads over more film" gives one cos, and I couldn't see where the second one comes from. The jump to 3D ("solid angle", "1/cos³θ_c", "|n·v| d / z³") is one sentence. n·v assumes dot products, which I don't have. In my copy, the three factor explanations run together on one line, so it was hard to see where each ended. "The test holds this page's version…": which test?

## 7. The code
- **The split comment (387–406):** readable as prose and mostly repeats sections 1–2. "DELTA+", "EVAL part", "on escape leaves out the solar disc" and "CLS_CAND|CLS_SPEC" stay opaque.
- **The photon walk (853–859):** with its caption I understood it: mark the photon if the last event was glass/mirror, otherwise stop it. Opaque: `|` (I know `||`), `res.r`, and the comment "walked on past D, from 0.43.0 to 0.60.0" (what is D?).
- **`camFootprint`:** the hardest. I matched `dist / (z*z*z)` and `apx` to the fold-out. But `UB.invView[2].xyz`, `invProjection[0][0]` and returning `VEC2(0.0, apx)` stayed opaque. Nobody tells me that `dot(nrm, d/dist)` is the cos θ_x of the fold-out. The intro points at line 537, which isn't shown.
- **`LT_MIN_ALPHA`:** the caption helps (roughness 0.22). The comment's maths doesn't.
- **The learned map (607–613):** this repeats section 3 almost word for word.

## 8. Too much, too little
- **Too much:**
  - Section 4 has five excerpts, two of which restate the text.
  - Section 5's stamps are dense with numbers whose units I don't know.
  - Section 6's bug history assumes NEE and "weights".
- **Too little:**
  - What a sample is and why averages wobble.
  - Why dividing by a chance keeps the picture right.
  - The tag mechanism in plain words.

## 9. Wrong or contradictory
- Section 1 says "Each path is counted by exactly one side, and the picture is all there". Section 2 says the caustic seen through glass is "missing from both". Figure 2's readout says "Neither side makes this path *except by chance*", which suggests the camera does make it, noisily. The code says the camera side "counts everything else". So is that light missing, or just noisy?
- "Nearly twice as bright": the readouts give 0.738 unsplit against 0.313 split, which is 2.4×.
- "Compare the readout's numbers with Both, split" to see that the open floor is unchanged: the readout shows no open-floor number, and "the whole picture" *does* change (0.309 to 0.384). "The open floor reads 0.39" isn't shown anywhere either.
- "The floor under it should show a bright spot", but the bracket averages less than the open floor (0.313 against 0.39). Nothing explains that the bracket includes the dark ring around the focused spot.

## 10. The five changes
1. **Settle the caustic-through-glass case.** Say plainly whether the camera still counts it by chance or it's missing, and make section 1's "the picture is all there", section 2 and figure 2 agree.
2. **Define "sample", the ± and "a rare find counts for more"** in a sentence each on this page, and replace "NEE" with "shadow rays" or define it.
3. **Split section 1's second paragraph** into the shadow-ray failure and the bounce's lucky finds. Explain or drop "the flat world" and the 3D figures.
4. **Fix figure 1's readout and drawing.** Give the open floor its own number so "compare" works, and correct "nearly twice". Draw connections differently from shadow rays, and label what the dark pixels are.
5. **Fix figure 3.** Make the 20% floor visible on the bars, and label the "rebuilt, not yet sent" state. In section 4, keep the photon-walk and map excerpts and annotate `camFootprint` line by line, or move it to the fold-out.
