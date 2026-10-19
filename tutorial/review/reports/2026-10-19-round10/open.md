# Beginner review: Chapter 33, "Open problems"

## 1. Teach-back
This chapter is a list of everything in ShadyTracer that is still unfinished, laid out as cards on a board. The biggest group is 20 checks that were written but never run. The code is written by an AI on a hired computer whose graphics card is only a software imitation, so someone with a real card has to run each check and paste the numbers back. Some numbers were measured and nobody can explain them yet. The main one is glass in the "furnace" test reading 0.9440 when it should be just under 1. Some fixes have been designed but not built. A "limit" is a weakness that is known and measured, and a "bug" is the program doing something nobody meant. Writing the tutorial turned up 13 places where a comment said something the code didn't do. Twelve have been fixed, and one real code question about twists is left for the owner to decide. Every card quotes a file, and a test checks the quotes, so the board can't quietly go out of date. The last idea is to label every claim as measured, read in code, or inferred.

## 2. Quiz
1. The code is written on a computer with an imitation graphics card that "cannot run the page". To run a check, someone with a real card presses its row in the Tests menu (the bench) and pastes the result back with the version line. Then someone updates its status in docs/TESTING.md.
2. On the Ampere card, rough glass in the furnace reads 0.9440 "in every run since one set that read 0.9872". It matters because a surface that loses no light should read exactly 1. Until someone finds the cause, nobody knows whether it's a bug or a limit.
3. A bug is "the program doing what nobody meant, unknown until someone finds it". A limit is "known, measured or bounded, and says where the picture cannot be trusted". An example is small lamps coming out too bright.
4. It found 13 things. Twelve were comments or document lines that disagreed with the code, for example a sun cone "about 0.03 steradian" that was really 441 times too big. Version 0.67.3 corrected them and their cards were removed. One is code (the twist's step bound) and is left to the owner.
5. Each card quotes its file, and the tutorial's test compares the quotes on every proposed change (CI). Changing a row's status or fixing a comment breaks the quote, so the change can't pass until the card moves or is removed. The one step the test can't do is someone writing the result into TESTING.md.

## 3. Where I got lost (worst first)
1. **The twist card.** "the twist's step bound (chapter 3) divides by less than the most a twist can stretch a move, so a step can be about 3% longer than the distance." The page never says what a step, a step bound or "the distance" is. I only understood it from *outside knowledge* of sphere tracing. The card uses `c`, `rate` and `extent` without defining them, and "a plate at 45° keeps a slope of 1.14" means nothing to me. Then "Try it" asks me to "decide what the divisor should be".
2. **The furnace paragraph.** I couldn't parse "Between the Ampere's two sets of runs the glass's sampling read nothing the code's changes touched". The page also doesn't say why a narrower picture (946 vs 1092 pixels) could change the reading at all. The card adds "a single-scatter reference" without explaining it.
3. **"a sun twenty times the real one"**: twenty times brighter or bigger? The text also says "whether the sun's disc or the sky is wrong", but I wasn't told the sky counts as a light.
4. **The "unexplained" list**: "the Noise library's compile", "the same kernels", "one profile", "re-authored in metres". I don't know what compiling or a kernel is. The cards add "Menger cubes", "lavapipe", "learned map" and "photometry test".
5. **"the user"** appears ("the user measures on", "the user asked for") before the measured° card at the very end says it means the developer. I first thought it meant me.
6. **"A pass reads 1"**: 1 of what? I guessed it's a ratio of real noise to claimed noise.
7. **"shadow rays", "ray"**: I'm assumed to know what rays are and where they start (*outside knowledge*).

## 4. Words and symbols
- **bench°**: the "benchmark" card helped ("its Tests menu, each test a set of rows"), and "pressed" is explained. Small slip: the text says bench but the card's heading says benchmark.
- **error bar°**: helped ("About two times in three...").
- **drift°**: helped, but see section 9.
- **biases°**: the card helped, but "the wavefront" in the same sentence is never explained.
- **measured / read in code / inferred**: clear, and the drift example in section 2 is good.
- Explained in the text itself, which worked well: surface tolerance, eps, steradian, container, CI, furnace, Pascal/Ampere (though only after first use).
- Never explained: kernel, compile, illuminance/lux, far field, photon map, polarisation, facets (half-explained), NEE (a card title, which I couldn't link to "shadow rays weighed through frosted glass"), probe, stratified, u,v, LED, "0.922 B", repository, .md.

## 5. Figures
There is one figure, the board. The "all" screenshot works well: coloured columns with counts in the headers, and a readout "42 open items: 20 never run; 1 run once; 9 unexplained..." that adds up. Problems:
- In "all" view the titles are cut off ("is each erro...", "does the tol..."), so that view shows how many cards there are but not what they say.
- In "never run" and "unexplained" the hover box covers the cards under it, so I couldn't read the first two rows.
- The "run once" view is mostly empty space.
- The button names ("not built", "found here") differ a little from the section headings ("Designed", "found").
- The hover box is useful: source file, status, chapter.
- There's nothing to drag, only things to point at, and the caption says so.

## 6. Maths fold-outs
There aren't any. I could follow the inline arithmetic:
- 5.3% × 0.78 ≈ 4.1%, so 1 − 0.041 = 0.9587.
- 21 × 21 = 441, and 0.000067 × 441 ≈ 0.03. I worked out myself that area goes with width squared; the page doesn't say so.
- 38% → "±20%" I could roughly see (half of 38).
- "4π of them" for the whole sky I took on trust, and "sky" sounds like only half of everything.
- The twist formula: putting in c = 1 gives 1.618 / 1.414 ≈ 1.14, but only because I guessed c = rate × extent.

## 7. The code
The only code is in the twist card: `warp(1.0 / sqrt(1.0 + rate * rate * extent * extent));`. I can read it as JavaScript, 1 divided by √(1 + rate²·extent²). Still opaque: what `warp` does, what `rate` and `extent` are, and why dividing makes a step "safe".

## 8. Too much, too little
- The opening paragraph tries to summarise everything in four long sentences.
- The furnace example is long and dense, while the "Among the others" lists are rushed: chapter numbers with no explanation.
- The six designed fixes get one clause each.
- Section 2 tells the chain from result to board twice (first and second paragraphs).
- The reading box ("albedo tables", "microfacet", SIGGRAPH) is far beyond me.

## 9. Wrong or contradictory
- The **drift card** gives the cause as fact ("its heat, its power state"), but section 2 says the cause "is only inferred, since nobody has measured the clocks".
- The **twist**: the text says a step is "about 3% longer", the card says the stretch is "up to 15% more", and the fix makes steps "up to 15% shorter". These are never reconciled.
- "a sun **twenty** times the real one" vs "an old sun drawn **21** times too wide". Are these the same thing?
- The "a tolerance per pixel" card, filed under *not built*, says "agreed, built on the metres engine of 0.36.0". It reads as "it was built".
- The text puts the lux check in chapter 5. In the never-run screenshot the card in that position ("…hat it says?") seems to show "ch. 1". I'm not sure that's the same card.
- The text says the metres scene was "10% faster", but its card adds "(2.3% on the Ampere)". The text leaves that out.

## 10. The five changes
1. **Rewrite the twist item for a beginner.** Recap in one or two sentences what a step and its bound are, define c, reconcile 3% with 15%, and spell out the trade-off. "Try it" asks me to judge it.
2. **Make the cards readable.** Replace jargon on them (NEE, kernel, compile, probe, stratified, lavapipe, Menger, wavefront, learned map, single-scatter) with the words the text uses, or give them ° cards. Stop the "all" view truncating titles and the hover box hiding cards in the screenshots.
3. **Untangle the furnace paragraph.** Give a timeline (Pascal 0.9587, explained → Ampere 0.9872 → 0.9440), rewrite the "read nothing the code's changes touched" sentence, and say why picture width could matter.
4. **Introduce "the user" and the basics early.** Say up front that "the user" is the developer with the two NVIDIA cards. Add one sentence recalling what a ray, a shadow ray and the graphics card do in this program, for a reader landing here.
5. **Fix the inconsistencies.** These are the drift card vs "only inferred", 20× vs 21× sun, "built on" in a not-built card, and the lux chapter number. Also say what "a pass reads 1" is a ratio of.
