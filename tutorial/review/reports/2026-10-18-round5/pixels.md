# Blank-reader review: "From light to pixels" (Chapter 7)

## 1. Teach-back
The renderer works out how bright each point is in real units (cd/m²), but a screen can only show 0 to 1. So first you pick an **exposure**: one brightness that counts as white, with everything divided by it. You give it as an **EV**: white = 1.2 × 2^EV, so a higher EV makes the picture darker. ShadyTracer can choose the EV by itself. It sorts the pixels by brightness, throws away the darkest and brightest 10%, takes a "log average" of the rest and turns that into an EV. A second rule stops the brightest 5% from going more than 2 stops above white, and if the two rules disagree the darker EV wins. Black pixels (where nothing is seen) are left out, because they used to drag the average down and blow everything out. A **tone curve** decides what happens to light above white: clip it, or bend it down gently. PBR Neutral keeps colours and AgX makes bright colours go pale like film. Last, **sRGB** stores the result with more of the 256 steps spent on dark tones, because our eyes notice banding there.

## 2. Quiz
1. **EV:** it sets the luminance that shows as white (1.2 × 2^EV cd/m²). The automatic choice: build a histogram, cut 10% at each end, average the rest on a log scale, get v = log₂(L×100/12.5), then apply the highlight rule and keep the darker of the two. *That it eases towards the new value over several frames I learned only from a code note.*
2. **The 10% cuts** throw out deep shadow, the sun and noisy bright pixels. **In the room**, the average is mostly dim walls, so the desk would be 17× white. The second rule keeps the brightest 5% within 2 stops of white. *The page did not teach why it is 5% here and 10% for the cut.*
3. **Black voting:** once black was more than the 10% cut, it got into the average. The average fell (to 0.019), the EV became very low, and everything lit was blown out.
4. **Tone curves** decide what happens to light above white. Neutral leaves light alone up to 0.76, then compresses while keeping the hue. AgX starts bending far below white and turns bright colours white. *The page never says what "shoulder" means.*
5. **sRGB:** with only 256 steps, storing in proportion gives the darkest tenth 27 steps and you see bands. sRGB gives it 90. *Partly taught: section 5 says a saved picture is "kept as light", and the page never explains why that copy does not need sRGB.*

## 3. Where I got lost (worst first)
- **"the mid-grey a camera means by '18% grey'"** (fold-out and stamp). The numbers I am given are 0.104 and 0.356, and neither is 18. Nobody says what 18% is a percentage *of*. The stamp ("By its own two constants it is 12.5 / 120, 10.4%, as its test says; the 18% is…") reads like a note between developers. *Outside knowledge:* I only follow this because I already know about grey cards.
- **"The desk keeps its shape"** at EV 6.82. The desk is still 600/135 ≈ 4.4× white. One sentence earlier, 17× white was "blown out". Why is 4.4× fine? It only works because of tone curves, which come in section 2. The page needs to say that.
- **Fig 1, black step:** "the brightest 5%" suddenly starts at 2^3.33 (the walls) instead of 2^9.08 (the desk). The text never says why: once black counts, 5% of the *whole* picture is a different set of pixels.
- **"averages the rest on the log scale"**, log₂ and "geometric mean". There is no example. Something like "1 and 100 average to 50.5, but their log average is 10" would do it.
- **ISO** means two different things: "ISO 100" is a sensitivity, while "ISO 2720" and "ISO 12232" are standards documents. Neither is explained.
- **Section 5** ("16 bytes a pixel", "518,400 values", "headless on a GTX 1080 Ti, the user's Pascal card"). I could not tell why 480×270 makes 518,400 (×4 channels?), and I did not know who "the user" is.

## 4. Words and symbols used before they were explained
- **stop** (used first in "a third of a stop each"): never defined. I guessed it means ×2 because of the axis label "each stop doubles" in Fig 2, which comes later.
- **histogram, bin, quantile, median.**
- **toe**: explained in passing, which is good. **shoulder**: never explained.
- **hue, desaturating, channel, caustic, firefly, path, shadow ray, gamma, gamut** ("chapter 6"), **Khronos, PBR, WGSL, headless.**
- **The cards:** *EV* helped most, because it says outright that a brighter scene needs a higher EV. *luminance* relies on "Radiance", which is not explained. *tone curve* and *sRGB* were clear. *exposure* is vague ("brightened or darkened") next to the precise text.

## 5. Figures
- **Fig 1** shows a histogram with the cut lines and coloured swatches. The steps show the outdoor scene, the room, the room with headroom 12, and black at 60%, and together they make the point well. Problems:
  - The readout "no darker than EV 12.43 … chosen: EV 15.87" looks backwards: 15.87 *is* darker. The rule actually means "no brighter than".
  - In the room shot, the "average" label sits next to the 90% line, away from its blue line.
  - The header still says "black … does not vote" while Black votes is on.
- **Fig 2** is clear about the curves, and the colour strips show the orange turning pale under AgX nicely. Problems:
  - I did not understand why "none (clip)" is curved and not straight. That is the sRGB step plus the log axis, which section 3 explains only later.
  - Under clip, the orange strip turns *yellow* before white, and the text never mentions it.
- **Fig 3** (dark) shows the banding in the linear strip, and it is convincing. Fig 3 (all) contradicts itself: the strip says **"220 different values"**, while the readout and the text say "256 kept as sRGB".

## 6. Maths fold-out
I followed both formulas. "Put that v back in the first" skips the step 2^(log₂ x) = x, so with shaky logs I would be stuck there. The sentence "a pixel a hundred times brighter weighs no more than one a hundred times darker" is hard to parse.

## 7. Code
- **photometry.js:** the note makes EV_CLIP and METER_K clear. Still unexplained: arrow functions, `export`, the `1e-9` guard, and why text with `${...}` becomes code for the graphics card.
- **autoexposure excerpt:** `acc` and `kept` are never explained, and neither are `UB`. `mix` is not explained, and `select` is explained only in the *next* excerpt's note. The easing between frames appears only here, not in the prose.
- **rendertoscreen excerpt:** `switch` and the sRGB lines are readable. Opaque to me: `1u`, `VEC3`, `centerRGB`, `gamutClip`.

## 8. Too much, too little
- **Too much:** both "READ IN CODE" stamps about code comments, and the history in section 6, assume I know the project.
- **Too little:**
  - the log average;
  - what stops are;
  - how tone curves relate to the "blown out" idea in section 1;
  - why saved light needs no sRGB.

## 9. Wrong or contradictory
- "it leaves light alone up to 0.76 of white (apart from a small **lift** of the darkest tones)". Yet the readout gives 82 under Neutral against 99 under none at 3 stops under, and the Neutral curve lies *below* none at the dark end. That is darkening, not a lift, and not "alone".
- Fig 3: "220 different values" against "both keep all 256 steps".
- "no darker than EV x" contradicts the EV that is actually chosen.
- "ShadyTracer offers six" curves, but the code has cases 0–6 including AgX Punchy, and the figure shows six options with none and without Punchy.

## 10. Five changes, most important first
1. Fix the Neutral "lift" sentence so it matches the figure. Fix Fig 3's 220/256 clash and the "no darker than" wording.
2. Define **stop** at first use, and explain the **log average** with a two-number example.
3. Explain "18% grey" (a card that reflects 18% of light) or drop it, and turn the section 4 stamp into plain words.
4. At "the desk keeps its shape", point ahead to tone curves. In the black step, say why the brightest 5% moved to the walls.
5. Gloss `mix`, `select`, `acc` and `kept` at the autoexposure excerpt. Add one line saying why a picture "kept as light" needs no sRGB.
