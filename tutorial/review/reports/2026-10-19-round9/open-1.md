# Chapter 33, "Open problems": a beginner's reading

## 1. Teach-back

This chapter is a list of things nobody has finished in ShadyTracer, shown as a board of 54 cards sorted by kind and coloured by kind. The biggest group is 20 tests that were written but never run. They can't be run where the code is written, because the graphics card there is only a software imitation. Someone with a real card has to press the test and paste the numbers back. The second group is 9 numbers measured on a real card that nobody can explain, like the same glass test giving 0.9587 on one card and 0.9440 on another. Then come 7 fixes that are designed but not built, 4 "limits" the documents admit to, and 13 places where a comment in the code says something the code doesn't do, which the tutorial found. To close a card you run its test and write down the answer, saying whether the number was measured, read in the code or guessed. Every card quotes a file, and a test checks the quotes, so the board can't quietly go out of date.

## 2. Quiz

1. **Why never run, and what it takes.** The code is written "in a container whose graphics card is a software imitation that cannot run the page", and the numbers "need a real one". To run a check, "the person who has one" presses that row of the bench (the Tests menu, says the card) on a real card and pastes the result back "with the version line that names the build". The page never says what a container is or why the code is written in one.
2. **A number measured and not explained.** The furnace's rough glass "read 0.9587 on the Pascal ... then 0.9440 on the Ampere". It matters because the same test on the same code should give the same answer, so "a number that should be one thing and is another" means something is going on that nobody understands. The page never says what a furnace is or what it *should* read. I guessed 1, but that's *outside knowledge*.
3. **Limit vs bug.** A limit "is known, measured or bounded, and says where the picture cannot be trusted." The page never defines a bug. I took it to mean an error nobody knows about or intended, but that's my guess from the contrast.
4. **What the comments showed, and what was done.** The tutorial found 13 comments or documents that disagree with the code or their own numbers: the sun "441 times its real share of the sky", "line numbers the code has moved past", depth of field called "not built" when it was. Nothing was changed: "Each chapter that found one says so beside the quote; none is changed here." The code's owner decides whether to fix each one.
5. **How the board stays true.** Each card quotes its document, and "the tutorial's test checks each quote against today's files". If a comment is fixed, or a row's status in docs/TESTING.md changes, the quote stops matching and the test catches it. The page doesn't say what "catches" means (does the test fail? does someone get told?). I filled that in myself.

## 3. Where I got lost (worst first)

- **"in a container whose graphics card is a software imitation ... (the repository's CLAUDE.md)"**: I don't know what a container, a repository or CLAUDE.md is, or who writes the code. This is the main reason for the whole board, and it's one clause long.
- **The never-run paragraph** lists five checks in words I mostly don't know: "error bar", "illuminance view", "lux", "surface tolerance", "far field", "photon map", "compare-and-swap", "occlusion queue". I could only follow by chapter number, and I haven't read those chapters in my head.
- **"The furnace's rough glass ... which a model of one scattering explains"**: furnace, rough glass and "one scattering" are all unexplained. This is the page's best example and I can't tell why 0.9587 counts as "explained".
- **"the user's own request"**: which user? The *measured* card explains "the user's card", but this sentence comes first.
- **"Four more ask only what something costs, two of them saying they need a real card"**: hadn't the page just said they *all* need a real card?
- **"Several of the cards above began as an inference written as a finding"**: which ones? An example would help.

## 4. Words and symbols

- **bench°** is the only word marked in the text. Its card ("benchmark") helped a lot: a fixed test, one change a row.
- **drift, bias, measured / read in code / inferred**: these have cards in "Words from this chapter" but aren't marked where they're used ("drift by about ±20%", "the biases the wavefront keeps", section 2). The cards are clear once found.
- **control (a check's)**: has a card but never appears in the chapter. Its card mentions "a black ball" in the furnace test, which raised more questions.
- Used and never explained: container, repository, kernel, compile, profile, "re-authored in metres", probe, slabs, shadow rays, frosted glass, wavefront, polarisation, steradian (on a card), depth of field, Pascal/Ampere (the *measured* card helps here), "0.43.0", "version line", "stamped".

## 5. Figures

**Figure 1 (the board).** Clear as a picture: one column per kind, one colour per kind, and the counts in the readout ("54 open items: 20 built, never run ... 13 found by this tutorial"). The step screenshots switch to a two-column grid with a title, a short description and "ch. n", and that works well.
- In "all" the titles are cut off ("the sun "abo…", "optics-farfi…"), so it's only an overview.
- The never-run cards have code-like names ("sppm", "nee-cost", "optics-farfield") that mean nothing to me. The other kinds have readable titles ("rough glass reads 0.944").
- Descriptions end in "…" and the rest is behind pointing, which I can't do. The handwritten small font on the grid paper is hard to read.
- **"run once (1)"** is a whole column ("nee-split") that the text never mentions and no screenshot shows.
- The buttons say "not built", "limits" and "found here" while the paragraphs say "designed", "limit" and "found". Close enough, but the column next to the text it describes is worth matching.

## 6. Maths fold-outs

None on this page. The twist card ("(c + √(c² + 4)) / 2") and the "cos⁵" card show formulas with no explanation, but they're only quoted.

## 7. Code

No excerpts. Only file names (lib/pathtracer/tests.js, docs/TESTING.md, tutorial/kit/open.js, materials_pbr.js). "Try it" asks me to "open its file at the quoted words", but I don't know where those files are or how to open them.

## 8. Too much, too little

- **Too little:** each kind gets one dense paragraph that lists items without explaining any. One card per kind fully explained (what was tested, what was expected, what happened) would teach more than five half-named ones.
- **Too much:** the found-here paragraph packs five unrelated examples into one sentence.
- Section 2 is short and clear, the best part for me.

## 9. Wrong or contradictory

- The text says the rough glass read "0.9440 on the Ampere in every run since", but the card says "then 0.9872 and 0.9440 on the Ampere".
- The text says drift is "about ±20%", but the drift card says "moved up to 38%". These may agree (±20% ≈ a 40% spread), but the page doesn't say.
- The text says one scene "runs 10% faster", but its card adds "(2.3% on the Ampere)".
- "Most of the board is the first kind": 20 of 54 is the biggest column, not most.
- The intro names three kinds plus the found comments, while the board has six (limits and run once are missing from the intro).
- "two of them saying they need a real card" versus the earlier claim that all checks need one.

## 10. The five changes

1. Explain in two plain sentences who writes the code, where, and why that place can't run the page, without pointing at CLAUDE.md.
2. Fully explain one card per kind, starting with the furnace: what a furnace test is, what it should read, and why 0.9587 vs 0.9440 is a puzzle.
3. Make the text and the cards agree (0.9440 "every run", ±20% vs 38%, 10% vs 2.3%, "most"), and mention "run once" in the text.
4. Define "bug" next to "limit", with one example of each from the board, and say what happens when a quote stops matching.
5. Mark the glossary words where they're used, use "control" in the text or drop its card, and give the never-run cards readable titles.
