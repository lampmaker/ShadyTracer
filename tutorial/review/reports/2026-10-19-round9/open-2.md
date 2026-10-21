# Chapter 33 "Open problems": a beginner's read

## 1. Teach-back

This last chapter lists what is still unknown or unfinished about ShadyTracer, as a board of 54 cards in six columns. The biggest column, 20 cards, is checks that were written but never run. They were never run because most of the code is written by an AI on a rented computer with a fake graphics card, so only the developer, who has a real card, can press them and paste the numbers back. One check was run once, but its answer was not written down. Nine cards are numbers measured on real cards that nobody can explain yet, for example rough glass reading 0.944 when 0.9587 had been explained. Seven are fixes that were planned and agreed but not built, and four are limits the program admits to. Thirteen are comments that the people writing the tutorial found disagreeing with the code, like a comment whose sun is 441 times too big. None of the comments was fixed, because that is the owner's call. Every card quotes a file, and a test checks that the quote still matches the file. So when a check gets run or a comment gets fixed, that test fails until the board is updated. When you write an answer down, you have to say whether it was measured, read in the code, or guessed.

## 2. Quiz

1. **Never run:** the AI writing the code works in a "container" whose graphics card "is a software imitation that cannot run the page". To run one, "someone with a real card presses it and pastes the numbers back", with "the version line that names the build". The row's status in docs/TESTING.md then changes. I worked out on my own that "pressed" means clicking a row in the Tests menu. I got that from the bench card.
2. **Unexplained number:** the furnace's rough glass read 0.9872 and then 0.9440 on the Ampere card, when 0.9587 (on the Pascal) is explained. Another one is drift: the same kernels read 184.7 to 255.5 ms. Why it matters: "each is a number that should be one thing and is another", and drift makes comparisons across runs only "good to about ±20%". The page never says what an unexplained number might be hiding.
3. **Limit vs bug:** a bug is "the program doing what nobody meant, unknown until someone finds it". A limit is "known, measured or bounded, and says where the picture cannot be trusted".
4. **Comments:** it found 13 comments and documents that say something the code, or their own numbers, does not. One is the sun "about 0.03 steradian" that is really 0.000067. Nothing was changed. Each chapter notes its find beside the quote, and they are on the board as cards.
5. **Board stays true:** each card's quote is checked against today's file by the tutorial's test, and CI runs that test on every proposed change. A fixed comment or an updated row breaks the match, so "the change cannot pass until the board is brought up to date in the same change".

## 3. Where I got lost (worst first)

- **"card" means two things.** "on the Pascal card", "The same question is on the other cards", "its cause, the card's clocks". In the unexplained paragraph I had to reread to tell whether "other cards" meant graphics cards or board cards. I decided it was board cards.
- **"a narrower picture accounting for at most a quarter of the difference"**: a quarter of which difference? I don't know what a narrower picture has to do with it.
- **"The drift card holds one of each kind left open"**: one of each what? I guessed it meant the stamp kinds (the times are measured, the cause is inferred), but "nobody has measured them" seems to contradict "measured".
- **Surface tolerance**: the first "not built" example and the first "limit" both depend on it, and it is never described here. "eps" and why "the engine's move to metres" makes per-pixel tolerance possible are opaque too.
- **Steradian**: the one worked example of the "found" column depends on it. I followed "21 times too wide, covering 441 times the sky" only because I know that area goes with the square (*outside knowledge*).
- **The run-once item**: "a glowing object of its own, which light sampling does not cover". I don't know what light sampling is, so I don't know why that matters.

## 4. Words and symbols

- **bench°**: the card helped ("its Tests menu, each test a set of rows"). Its title says "benchmark" but the word on the page is "bench".
- **error bar°**: clear and useful.
- **drift°**: helped. "clocks" was not explained (*outside knowledge*: GPU clock speed).
- **bias°**: clear.
- **measured / read in code / inferred°**: clear. But the measured card is the only place that says Pascal and Ampere are NVIDIA cards, and those names are used a whole section earlier (*outside knowledge*).
- **Used with no card**: furnace (explained in the text, good), light sampling, NEE (on a figure card only), shadow rays, wavefront, photon map, kernel, compare-and-swap, occlusion queue, caustic, steradian, lux/illuminance, far field, u′v′, Snell and Cauchy, firefly clamp, roulette, albedo, microfacet, "version line". Most come with a chapter number, which is fine for a last chapter. The steradian, tolerance and light-sampling ones are the worst gaps, because the main examples rest on them.
- "container" and "CI" are explained in the text. That was good.

## 5. The figure

It shows the board. In "all" you get colour-coded columns with truncated titles, and choosing a kind shows each card's title, the start of its quote and "ch. N".
- The screenshots make each kind clear, and their counts add up (20+1+9+7+4+13 = 54).
- There is **no screenshot of the "run once" kind**. The only one I see is "which half o…".
- There is **no screenshot of a card being pointed at**, so I never saw a full quote or its source.
- The "all" readout runs on as one list ("1 run once, still open, 9 measured, not explained, …"). The commas inside each label make it hard to parse.
- Mostly the quotes end in "…" before the interesting part ("finds it about once in …").

## 6. Maths fold-outs

There are none. The inline maths I could follow: 5.3% × 0.78 ≈ 4.1%, and 1 − 0.9587 = 0.0413. The page doesn't state the second step, and I did it myself. 21² = 441 I could follow too. The ±20% next to the drift card's "up to 38%" only fits once you see that ±20% is a spread of about 40%, and the page doesn't say so.

## 7. The code

There are no excerpts, only file names (tests.js, TESTING.md, open.js, materials_pbr.js, microfacet.js). I only found out what TESTING.md holds from the surrounding text. The other names mean nothing to me.

## 8. Too much, too little

- **Too much:** the furnace example spends most of its length on the part that *is* explained before reaching the unexplained part. On first read I thought 0.9587 was the mystery.
- **Too little:** no column says why it matters to a newcomer who wants to help. The "found" paragraph gets one example and then rushes through four more in a single sentence.
- The "Try it" list is good, but it needs the repository, and the page names that only in passing ("on GitHub").

## 9. Wrong or contradictory

- **"The others:" reads as a complete list but isn't.** In "not built" it names 6, while the figure shows 7: "a stratified source pick" is missing. "never run" names 9 of 20.
- **±20% vs 38%** are both presented, never reconciled.
- **The caption says "the comments this tutorial found wrong"**, but the text is careful to say only that they "say something the code … does not" and that fixing them is the owner's call.
- **"without anyone remembering to update it"**: the test catches a *file* change, not a run. A run only reaches the board if someone edits TESTING.md, and the run-once card ("its answer is not recorded") is exactly the case where nobody did.
- The page defines bug and limit but doesn't say which one the "unexplained" and "found here" cards are. It also doesn't say what happens to a card once it is closed.

## 10. Five changes, most important first

1. Use "card" only for the board, or only for hardware ("graphics card"/"GPU" every time), and rewrite "on the other cards" and "the card's clocks".
2. Add a one-line reminder for each term a worked example rests on: surface tolerance, steradian (whole sky = 4π), light sampling, and Pascal/Ampere at first use.
3. Restructure the furnace example to lead with what is unexplained (0.9440 vs an explained 0.9587). Either explain "a narrower picture … a quarter of the difference" or cut it, and reconcile ±20% with 38%.
4. Make each "The others:" list either complete (add the stratified source pick) or "among them". Add screenshots of the "run once" kind and of a card being pointed at.
5. Say where unexplained numbers and wrong comments fall between bug and limit. Spell out the closing chain: run → someone edits TESTING.md → the test fails → the card changes or goes. Rephrase "one of each kind left open".
