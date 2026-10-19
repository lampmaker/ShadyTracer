# Reader report: "From light to pixels" (ch. 7)

## 1. Teach-back
The renderer works out real brightness in cd/m², from 0.6 in a dark corner up to 1.5 billion for the sun. A screen only has 0 to 1, in 256 steps. Three things happen in between. First comes exposure: one brightness is picked to be "white", and everything is divided by it. That brightness comes from an EV, white = 1.2 × 2^EV, so each EV up doubles what counts as white and makes the picture darker. ShadyTracer picks the EV the way a light meter does. It sorts the pixels into a histogram, drops the darkest and brightest 10%, averages the rest "on the log scale" and turns that average into an EV. A second rule stops a small bright patch, like a desk under a lamp, from going too far over white. Pixels that see nothing used to be counted, and that broke the meter. Second, a tone curve decides what happens to light above white: either chop it off, which makes colours change, or bend it down smoothly. Third, sRGB stores the result with more of its 256 steps in the darks, because the eye notices banding there. A saved render keeps the raw light, so its exposure can be changed afterwards.

## 2. Quiz
1. An EV sets which luminance shows as white: 1.2 × 2^EV cd/m². Higher means darker. Auto-exposure works from a histogram: drop the bottom and top 10%, average the logs, then v = log₂(L × 100/12.5). It then takes the higher of that EV and the EV that keeps the brightest 5% within the headroom (2 stops) of white. Each frame it closes a tenth of the gap (a code caption, not the prose).
2. The extremes (deep shadow, the sun, noisy bright pixels) would drag the average. *Why* noisy pixels exist, the page never says. A lamp-lit room is mostly dim walls, so the average alone exposes for the walls and leaves the small desk at 17× white.
3. Black went into the lowest bin. Once there was more than 10% of it, it got past the cut into the average, which fell to 0.019. The exposure then blew out everything lit, and even the 5% rule ended up protecting the walls.
4. A tone curve decides what to do with light over white. Neutral barely changes anything below 0.76 of white, then squeezes the top while keeping the hue. AgX starts bending far below white and fades bright colours to white, like film. It is a "look".
5. With the numbers stored in proportion to the light, the darkest tenth gets only 27 codes and shows bands. sRGB gives it 90.

## 3. Where I got lost (worst first)
- **Logarithms.** "log2 cd/m²" (figure title), "average of their logarithms", "2^log₂ x is x again", "a log scale", "each one's log₂" in the code caption. The "1 and 100 average to 10" example is good. But I need log₂ to follow the axis, the fold-out and the code, and the page never says what it is. That is *outside knowledge*.
- **"the brightest 5% may be at most 2 stops above white … The desk is still over white, 4.4 times."** Two stops is 4×, so did the rule fail? I only worked it out from the readout ("the brightest 5% from 2^9.08"): the rule is about the brightness *where the brightest 5% start*. That one idea is also what makes the black paragraph ("reaches down into the walls") readable, and it is never said.
- **The `evHi` line** (`logHi - log2(EV_CLIP) - aeHeadroom`). This is the heart of rule 2, and nothing derives it.
- **Fold-out step:** "Put that v back in the first … = 0.104 of white". The missing middle line is L_white = 1.2 × L × 8 = 9.6 L.
- **"The exposure setting's comment describes tone curves 0 to 2"**: I have never seen that comment, so this sentence goes nowhere for me.
- **Section 5 and 6 jargon:** "firefly clamp", "what one path may add", "one shadow ray a path", "the deposit", "a 'gamma' of 1.0", "GTX 1080 Ti … Pascal".

## 4. Words and symbols before they were explained
- **exposure:** the card helped. It calls exposure "brightened or darkened" while the text calls it "the luminance that will show as white"; I had to join the two.
- **EV:** the card helped (the candle-lit room's 2 was useful).
- **tone curve:** the card is the clearest thing on the page.
- **sRGB:** the card helped, but the word is used in section 2 and the fold-out before section 3 explains it.
- **luminance:** the card's "candles' worth" helped. Its "Radiance as the eye sees it" assumes I know radiance.
- **No card:**
  - "clipped" (section 1) is explained only in section 2.
  - "toe" is used one paragraph before its definition.
  - Also undefined: hue, desaturating, PBR, Khronos, filmic, gamut (sent to chapter 6), WGSL, ISO (only half-explained), firefly, gamma.
  - The 4th of "four 32-bit numbers" is never named.
- **Symbols:** **v** is the EV in the fold-out and the light value in section 3. Unexplained notation: `1e-9`, `=>`, `${EV_CLIP}`, `UB.`, `VEC3`, `1u`, `centerRGB`.

## 5. Figures
- **Figure 1** (histogram plus swatches) works well. The dotted cuts, the average, white and "brightest 5%" lines match the text in all four screenshots. The black screenshot makes the point clearly: a big bar at 2^-10 and every swatch white.
  - Confusing: the sun is said to be "far off the right of the scale", but the axis runs to 2^30+ and 1.5e9 ≈ 2^30.5 sits on it.
  - The text never says which tone curve the swatches use. The desk at 4.4× white is cream, not white.
  - The "e+4" numbers and "EV -3.18 at least (no brighter)" were hard to read, and no one told me an EV can be negative.
- **Figure 2:** the bold red curve and the colour strips make the orange→yellow→white and AgX-fades-early points visible. Only clicking tells me which thin grey curve is which, and white's position on the right-hand strips isn't marked. I couldn't see *why* the "none" line bends. I could only take the text's word.
- **Figure 3** is very clear: the banding at the left of the top strip at 10% is obvious, and at 100% both look the same, which fits "only where they put them differs". The readout "sRGB of 0.1: 0.349" goes unexplained.

## 6. The maths fold-outs
I followed the formulas. I could not follow the "put v back" step without the missing middle line. "ISO 100", "ISO 2720" and "film or sensor's standard sensitivity" assume I know cameras. It says 10.4% is "a little darker" than 18%, which is nearly half the light.

## 7. The code
- **photometry.js:** readable once the caption names EV_CLIP and METER_K. The backtick string with `${…}` inside, "as WGSL text", stayed opaque: I can't see that it builds GPU code.
- **autoexposure.js:** the caption is good (acc/kept, mix, select, max, aeSpeed). The `evHi` line stays opaque (see section 3), and so does `aeState[1] == 0.0` meaning "first time".
- **rendertoscreen.js:** the switch and the select are clear. The lead-in promises contrast, saturation and brightness, but the excerpt doesn't show them, and it cites line 210 while showing lines 243–256.

## 8. Too much, too little
- **Too much:** the MEASURED stamp (518,400 values, "the EV turned into a multiplier on the main processor", the hardware) and most of section 6. These are history I can't use yet.
- **Too little:** the 5% rule's meaning, logs, and why sRGB's power of 1/2.4 lifts the darks. The black paragraph packs four ideas into one.

## 9. Wrong or contradictory
- **The 18% / 0.36 clash.** The stamp says "the 18% is the mid-grey … which sRGB shows at about 0.36". The fold-out says 0.104 is lifted to 0.356. Using the page's own section 3 formula, 0.18 gives about 0.46. Both can't show at 0.36.
- **Neutral "changes light little"**, but the page's own numbers give 82 against 99 at 3 stops under white, and 0.04 of white off a 0.125 grey is about a third.
- **"darkest tenth … 27 of them"**: 256 × 0.1 = 25.6. I guess it counts 0 to 26, but a student will wonder.
- **"the sun, far off the right of the scale"** against the histogram's axis (see section 5).

## 10. The five changes, most important first
1. One sentence and a tiny table on log₂ ("how many doublings": log₂ 8 = 3), before the histogram.
2. Say plainly that "the brightest 5%" means the brightness where the top 5% begin, so a desk at 4.4× doesn't break a "2 stops" rule. Derive `evHi` in the fold-out in one line.
3. Fix the 18% / 0.36 sentence. Drop or explain the "tone curves 0 to 2" remark.
4. Define or card the cold words (firefly, path, shadow ray, gamma, WGSL, PBR, filmic, hue, toe), and use a different letter than v for light.
5. Write out the fold-out's middle step (L_white = 9.6 L). Say which tone curve figure 1's swatches use, and why the "none" curve bends.
