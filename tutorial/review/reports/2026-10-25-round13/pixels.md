# Beginner's review of "From light to pixels"

*Round 13, 2026-10-25: the whole page, with a question on two sentences the Darkroom's light tools added (section 11).*

## 1. Teach-back
The renderer produces light in cd/m² (candela per square metre). Those numbers run from under 1 to billions, and a screen only takes 0 to 1 in 256 steps. First you pick an exposure, the brightness that counts as white, and divide everything by it. The exposure is written as an EV, and each EV step halves the light let in, so a higher EV gives a darker picture. ShadyTracer picks the EV itself with a meter. The meter averages the pixels on a log scale after dropping the darkest and brightest 10%. A second rule stops the brightest 5% from being more than 2 stops over white. Light still above white goes through a tone curve. "None" clips it. PBR Neutral keeps colours and only bends the brightest tones. AgX bends early and pushes bright colours towards white. Last, the values are stored through the sRGB curve so the 256 steps go mostly to dark tones, where the eye sees small differences.

## 2. Quiz
1. **EV.** It sets the luminance that shows as white: 1.2 × 2^EV cd/m². The page says what the meter does (a histogram, trimmed, averaged in log₂), and the maths fold-out says it aims the average at about a tenth of white. The text never says that in plain words.
2. **The two rules.** The cuts drop deep shadow, the sun and noisy bright pixels. The page lists these reasons but does not say why they would hurt an average. A lamp-lit room needs a second rule because the average alone makes the small bright desk 17 times white, blown out. The second rule makes white at least 541/4. Answered.
3. **Black pixels.** They fell in the lowest bin and voted. Once black passed 10% the cut did not remove it, the average dropped to 0.019, and everything lit was blown out. Answered, but the paragraph is confusing (see section 3).
4. **Tone curves.** A tone curve is what the screen does with light over white. Neutral stays nearly linear to 0.76 and then compresses the brightest channel gently. AgX bends far below white and turns saturated colours pale. Answered, though "keeping the hue" and "desaturating" are not explained.
5. **Why sRGB.** Linear storage gives the darkest tenth only 27 codes and the eye sees bands. sRGB gives it 90. Answered by figure 3.

## 3. Where I got lost (worst first)
- **The black paragraph.** It says "Black is not part of the scene… does not vote. It used to count… Here 60% of the picture is black and voting, as it used to". It flips between "does not vote" and "voting" in one paragraph, and a first-time reader cannot tell which meter is on screen. The default state of the figure (black votes off) and the toggle state should be stated up front.
- **"the brightest 5% begin at 541 cd/m²", "within 2 stops", "evHi" and "a higher EV is darker".** I had to turn "darker of the two, the higher EV" into "white must be at least X" myself. A one-line worked sequence would have helped: average gives EV a, highlight rule gives EV b, take the larger.
- **Percentile and quantile ideas.** "Drops the darkest 10% and the brightest 10%" and "the brightest 5% begin at" assume the reader knows what a percentile is. The idea is never introduced.
- **"cd/m²" and "luminance".** The opening gives the units, but "candela" is meaningless to me. The card helps only partly ("candles' worth").
- **The log scale.** The "A word first" paragraph is good, but it comes after "EV" and "stop" are already in use.
- **Gamut and "the contrast, saturation and brightness settings on the encoded picture".** These appear in the pipeline sentence before section 4's code. "Gamut" is pointed at chapter 6, which I have not read.
- **The sentence "1 and 100 average to 10, not 50.5".** I got it, but "geometric mean" is dropped in parentheses.
- **ISO 12232, ISO 2720, "ISO 100", "sunny 16", "18% grey".** All appear without enough explanation.

## 4. Words and symbols used early
- **EV and stop:** "stop" is introduced mid-sentence ("called a stop"), which is OK. The card helps.
- **Histogram, bin, quantile/percentile, geometric mean, gamut, highlight headroom, channel, hue, desaturate, toe, shoulder:** no cards. "Caustic" appears with no explanation. "Firefly" and "noisy pixels" are never defined.
- **Words that are not set in a defined sense:** "blown out" and "clipped" are used loosely.
- **Cards that help:** exposure, EV, sRGB. The tone curve card is clear. The luminance card is dense ("into each bit of direction").

## 5. Figures
- **Figure 1 (meter).** The histogram plus swatches does make the point once I know what to look at. In the room screenshot the red white line sits left of the orange "brightest 5%" line, which shows the headroom rule biting. Problems:
  - the x-axis is labelled 2^-10, 2^5 and so on, and "each mark is 32 times the last" is only in the caption;
  - the labels "average", "brightest 5%" and "white" overlap the dotted lines in the outdoors view;
  - the text promises the sun at "near 2^30.5", but no bar is visible in the outdoors screenshot, so I could not find it;
  - the readout is a long line of "2^12.87 = 7.46e+3 ... EV 15.87", which is heavy;
  - the black-voting screenshot shows a huge bar at the left edge, and the swatch rows change (the corner goes grey), which is clear.
- **Figure 2 (tone curves).** The left plot has six curves, one bold, and it is not obvious which grey one is which. The colour ramps on the right are the clearest part. Section 2's text says it compares orange and blue, but the "orange turns yellow before white" claim is not visible in the "none" screenshot as I can tell. The y-axis says "what the screen shows (0 to 1)" but not whether it is before or after sRGB, although the caption says after.
- **Figure 3 (sRGB).** The clearest figure: two strips, "27 of 256 codes" against "90". The visible banding of the linear strip is subtle in the screenshot.

## 6. Maths fold-out
- I could follow L_white = 1.2 × 2^v and the substitution to 9.6 L, which gives "a tenth of white".
- I got lost at "0.104 lifts to 0.356 on the screen" because sRGB is only explained later.
- "ISO 100 sensitivity" and "calibration constant" are opaque.
- The highlight-rule derivation (v = h − log₂ 1.2 − H) is fine only if I accept 2^h − H meaning white is H stops under. The text writes 2^h − H where it means 2^(h−H), which is a typo that confuses.

## 7. Code
- **photometry.js excerpt:** the surrounding text explains the two constants, but the ISO comments and "78/100 headroom folded in" are opaque. The line numbers pasted into the code are noise.
- **autoexposure.js excerpt:** the gloss on `acc`, `kept`, `mix` and `select` helps. `aeSpeed` and the easing are explained. `logL`, `logHi` and `evHi` do not connect to the earlier sections until I re-read the fold-out. `UB.` and `aeState` stayed opaque.
- **rendertoscreen.js excerpt:** "switch" with unnamed case numbers is easy enough, and `select(hi, lo, rgb <= ...)` has an argument order that is easy to misread. `VEC3`, `gamutClip` and `centerRGB` stay unexplained.

## 8. Too much, too little
- **Too much:** the "black" paragraph (long, with 2^3.33, 7.4% and 3.0% numbers), and the stamped "read in code" aside on the 18% comment.
- **Too little:** a plain statement of what the exposure value is a standard for, why sRGB uses a 12.92 linear part, and what a firefly clamp is. The stamped trade-offs (section 5) assume a lot.
- **Section 6** is a list of bugs a beginner cannot follow ("emitter benchmark's median pixel").

## 9. Wrong or contradictory
- **Opening sentence versus the figure:** it says the dark corner is 0.6 cd/m². The figure's room swatch shows the same 0.6, so that is fine.
- **PBR Neutral, "up to 0.76 changes light only a little", but "3 stops under white, 82 against 99".** This is explained, but it reads as a contradiction.
- **The room paragraph:** "the meter takes the darker of the two, the higher EV", yet the figure readout calls the choice "darker". Consistent, but confusing.
- **"The brightest 5% … within 2 stops of white"** versus "at most 2 stops above white". Same meaning, different wording.
- **Figure 2 readout:** at white, AgX shows 202 and Neutral 240, so "grey at white" is not 255 under either, which a beginner will not expect.
- **The exposure card says 15 for sunny, 7 for an office.** The sunny-outdoors figure says EV 15.87, which is consistent.

## 10. Five changes that would help most
1. Rewrite the black paragraph: say which meter is on screen, define "voting" in one sentence, and use fewer numbers.
2. Add a short worked example of the two-rule meter (average gives EV a, highlight rule gives EV b, take the larger, which is darker), before the room numbers.
3. Define percentile, histogram and bin in plain words with a tiny example, and give cards to "histogram", "stop" and "gamut".
4. Fix and annotate figure 1: label the axis in plain words, make "average", "brightest 5%" and "white" not overlap, and show where the sun is.
5. Put sRGB before the maths fold-out or give a one-line forward explanation, and fix the `2^h − H` typo.

## 11. The two sentences
- **"Tools that change the light itself before the tone curve, a white balance among them, run in a copy of that function with the tools put in, used only once one of them is moved (…grade.js)."** A beginner would not understand it. "White balance" is never explained. "A copy of that function with the tools put in" is jargon, and so is "used only once one of them is moved". It also arrives right after dense talk of 16 bytes and displayPixel. It needs a plain version: "Editing tools such as white balance work on the light before the tone curve, using a separate copy of the display code that only runs once you touch one."
- **"ShadyTracer offers six curves besides none (… a saved picture has a seventh, Hable's with its white, toe and shoulder to set)."** Partly understood. Counting six besides none (Neutral, AgX, AgX Punchy, ACES, Reinhard, Hable) is not possible from the figure, which shows five besides none and leaves out Punchy, as the parenthetical says. "A saved picture has a seventh, Hable's" is confusing, because Hable is already in the list. I take it to mean a second variant with settings, but the page never says so. "White, toe and shoulder" are unexplained, since "toe" and "shoulder" are only glossed earlier in the AgX paragraph. Rewrite: "…six curves besides none; for saved pictures there is also a version of Hable's curve whose white point, toe and shoulder you can adjust."
