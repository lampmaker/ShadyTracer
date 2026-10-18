# Beginner read: "Dice and averages" (Chapter 12)

## 1. Teach-back
You can work out a hard number by trying random things and averaging. Throw darts at a square. The share that lands inside a quarter circle is π/4, so 4 × (share inside) estimates π. More darts make the estimate wander less, but slowly: four times the darts only halves the spread, because the spread falls like 1/√N. You can also say how far off you probably are (the error bar) using only how much the tries disagree with each other. The error bar is a "typical" distance, not a guarantee: about a third of the time you are further off than that. A pixel works the same way: each sample is one random path, the pixel is their average, and noise is that average still wandering. The renderer keeps two extra numbers per pixel so it knows each pixel's error bar. All of this needs fair random numbers. ShadyTracer's old generator put its numbers on a coarse grid, so tiny targets like a small sun were hit too often or too rarely, and averaging cannot fix that. It now uses PCG4D, which is fair down to very small windows.

## 2. Quiz
1. **π from darts:** the chance of landing inside is π/4. Score 4 for in and 0 for out, so the average score is π. The page taught this.
2. **Error bar:** it says how far the estimate typically is from the true answer, worked out from the tries alone. It does not promise the answer is inside it: about 1 in 3 lands more than one bar away, 1 in 20 more than two. I also *inferred* from section 4 that it cannot catch loaded dice, but the page never says this about error bars directly.
3. **Halve the noise:** four times the samples, because spread = σ/√N and √4 = 2. The page states the rule. The fold-out called "Why √N" asserts it and does not show why.
4. **Error bar without the answer:** it keeps V (how much the samples scatter) and S (the sum of the squared weights), updated each sample, and the error bar is √(S·V/(1−S)). I could only link this to s/√N because the code comment says "S = 1/n for a true mean". The page text never makes that link.
5. **Old generator:** `fract(f32(state)/671040)` threw away bits, so its outputs sat on a grid about 1/10,485 apart, and small windows got the wrong share. More samples cannot help because the unfairness is the same every time: the average settles on the wrong value. I could not follow *why* throwing bits away makes a grid (see section 3 below).
6. **Disagreement:** it is about the size of the bias. The comment says 0.08–3.2× at 0.0001 windows, 0.96–1.29× at 0.001 windows, and a grid of 1/2600. The page says 0.95–1.83×, 0.96–1.04× and 1/10,485. The page is sure of its maths, since it counted all 2³² states and checked against 63 million random ones. It cannot rule out that the old code did something the comment's formula leaves out, because that code is not in the history. Both agree the bias was real.

## 3. Where I got lost (worst first)
- **Section 3, all of it.** "a kernel called resolve folds the sample into each pixel's average". Kernel is never explained. I don't know why w = 1/cnt, what V and S *mean* in plain words, or why √(S·V/(1−S)) is the same thing as the darts' s/√N. "would cancel to nothing in 32-bit numbers" assumes I know how computers store numbers.
- **Section 4: "f32(state) keeps only the top 24 of the state's 32 bits, so seven-eighths of all states become multiples of 64 or more, and after the division those land only on a grid of points 1/10,485 apart."** "State", "f32", "fract", bits and "top 24 bits" were never introduced. I can't get from one clause to the next. Also, if it *always* keeps the top 24 bits, why does this apply to only seven-eighths of the states?
- **"which is different for every pixel"** (the sun window). Why does the sun's window land somewhere else on the grid for each pixel? That needs outside knowledge of how a random number becomes a direction.
- **Fold-out: "4√(p(1 − p)) = 1.642"** appears from nowhere.
- **Section 6:** "With aiming at the light switched off", "Pascal card", "BSDF parity", "tone curve", "false-colour view", and "a window of 10, worth about 21 samples" with no reason given for 21.
- **Section 7:** "shadow ray", "slot", "workgroups". I can't check "4,194,240 pixels" without knowing there are 64 pixels per workgroup (outside knowledge).

## 4. Words and symbols
- **Monte Carlo°, error bar°, noise°:** the cards helped. The error-bar card's "two times in three" matched the text.
- **estimate°:** the card is for "estimator". That's close enough, but a different word.
- **standard deviation°:** marked, but there is no card for it in the list. The text's "how far they spread" carries it.
- **sample°:** the card says "one try at the whole picture", but section 6 counts "37 million samples", meaning per pixel.
- **No card, never explained:** kernel, GPU state, f32, fract, bits, `>>`, `^=`, `u`, WGSL (in the code label), host, NEE, avalanche, lane, luminance, EMA, workgroup, shadow ray, bias (used once, in the stamped box).
- **Notation:** "[0, 1)" (the half-open bracket) is new to me. In "s² is the spread", s² is the square of the spread, while σ was called "the spread".
- **The "measured" card** says "on which graphics card", but the stamped box in section 5 was "measured" in node, by counting. Is that a measurement or a calculation?

## 5. Figures
- **Fig 1 (darts):** clear and the best part of the page. Problems:
  - The caption says inside darts are "drawn bold", but the screenshots show them blue and the outside ones grey.
  - "each step right is twice the darts", but the axis labels go 1, 4, 16 and later 1, 16, 256. It is a log scale that is never named.
  - In fig-1-few the line sits at 4.0 with **no width to its error bar** for about the first 14 darts, which is far from π. The page never says that a bar worked out from a handful of tries can itself be wrong. That is what the student would ask first.
- **Fig 2 (spreads):** the point lands: each column's spread halves. I had to work out for myself why the N = 4 dots sit only on 1, 2, 3, 4. At N = 256 the measured 0.093 is 10% off the predicted 0.103, and nothing says the measured spread also wanders.
- **Fig 3 (windows):** the shrinking-window sequence makes the point well. Blue stays flat; red goes from ±4% to one 1.83 spike to spikes near 9. Problems:
  - Colours are not named; the caption says only "left/right".
  - The red line at 1 is the same colour as the old bars.
  - The y-axis says "share of the draws" while the caption says "share of all 2³² states".
  - PCG4D reads 0.995–1.001× in the tiny-window screenshot, while the text says simply "fair".

## 6. Maths fold-out
I could follow X = 4 or 0 and "average = 4p = π". I could not follow:
- the standard-deviation formula;
- why the spread of an average divides by √N (the fold-out is titled "Why √N" but never shows why);
- "Nothing in it depends on how many dimensions the problem has". Dimensions of what, and why would they matter for other methods? Outside knowledge.

## 7. Code
- **resolve:** the caption explains cnt and w, and the comment gives the formulas. Opaque to me: `lw`/LUMA/`dot` (luminance), `select(...)`, `clamp(... 1e38)`, `moments[idx * 2u + 0u]`, and the NaN/inf comment.
- **PRNG:** the caption's "keeps each lane's top 24 bits, divided by 2^24" helped me read line 342. Lines 333–336 stay fully opaque: the magic constants, XOR and shifts. "Multiplications mix bits upward" means nothing without knowing binary.
- The long comment (NEE, SEED_, avalanche, 128 bits) is mostly lost on me.

## 8. Too much, too little
- **Too little:** section 3 (the chapter's promise of "how the renderer knows") and the bit-level reason in section 4.
- **Too much:** the stamped disagreement box is long and expert-level, and would sit better in a fold-out. Sections 6 and 7 read like a changelog full of jargon.
- **Sections 1 and 2** are well paced.

## 9. Wrong or contradictory
- "sample" means a whole-picture pass in its card but a per-pixel try in section 6.
- "drawn bold" vs the blue/grey dots in the screenshots.
- "each step is twice the darts" vs the ×4 and ×16 axis labels.
- The "measured" card (real hardware, graphics card) vs a count done in node.
- "keeps only the top 24 bits" vs "seven-eighths of all states".
- "4K pictures" illustrated with 2048 × 2048.
- "fair" vs the 0.995× reading.

## 10. Five changes
1. **Rewrite section 3 for a beginner.** Explain kernel and the running average (w = 1/cnt). Give V and S in plain words with a 3-sample worked example, and show that with S = 1/n the formula becomes the darts' s/√N.
2. **Explain the old generator's grid from scratch.** Say what the state is, use an analogy like a calculator that keeps only 7 digits, explain why that makes a grid, and add a sketch. Say why the sun's window sits at a different place for each pixel.
3. **Make "Why √N" actually show why,** and where 4√(p(1−p)) comes from. Fix "s² is the spread".
4. **Address the zero-width error bar at the start of fig 1,** and say outright that an error bar cannot detect loaded dice (bias). That is the bridge between sections 1 and 4.
5. **Fix the vocabulary:**
   - use "sample" one way throughout;
   - add cards for standard deviation, kernel and bias;
   - gloss "aiming at the light", shadow ray and workgroup (64 pixels);
   - name the log scale;
   - make the "measured" card fit a computed count.
