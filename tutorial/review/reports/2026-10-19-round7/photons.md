# Blank-reader report: Photon mapping (chapter 19)

## 1. Teach-back
Sometimes the camera can't find the light. That happens with a bright spot that glass focuses onto the floor, when you look at it through another pane of glass. A photon map fixes this. First, light packets ("photons") are sent from the sun. Wherever one lands on a matte surface after passing glass, it is stored. Then each camera ray that reaches the floor through glass "gathers": it adds up the photons within a radius r and divides by the length 2r (or the area πr² in 3D) to get the brightness. A big r blurs the bright spot, and that error never averages away (bias). A small r gives too few photons, so the result is noisy. If you keep r fixed, the average settles on the blurred value. If each sample uses a smaller r by a rule with α, the average climbs towards the true value (consistent). To find nearby photons fast, the floor is cut into cells 2r wide, so a gather only needs to check 2 cells (8 in 3D). The cells sit in a hash table: cell number × big constant, mod table size. Two cells can share a list, but each photon remembers its position, so it is only counted for its own cell. If a cell holds too many photons, the gather walks only some of its 32 random sub-lists and multiplies what it finds by 32/m. That is right on average.

## 2. Quiz
1. **Stored:** photons that have passed glass or a mirror, kept where they land on a scattering surface: the position, the light it carries, its direction and the surface's facing. **When:** a camera path that has met only glass since the eye, when it lands on such a surface. *Taught.*
2. **Large r:** the peak spreads out (0.72 drops to 0.48), and that is bias. **Small r:** only one or two photons per gather, so the error bar roughly doubles. *Taught.*
3. **Fixed r:** every sample makes the same blur, so the average settles on the floor's light averaged over 2r (0.623, not 0.938). **Shrinking r:** later samples are sharper, so the blurred early samples count for less and less of the average. *Taught.* The *why* is in the fold-out, which I could only partly follow.
4. A cell is 2r wide, and the stretch you search is 2r wide, so it overlaps your own cell plus at most the neighbour on the side of the cell's middle you are on. In 3D that is 2 cells per axis, so 2×2×2. *Taught.* The page does not write "2×2×2" out.
5. **Collision:** two different cells whose numbers give the same list. **Not counted twice:** a record is only counted while the gather is visiting its own cell. **Not taught:** *how* a double count could happen in the first place. I guessed that if both cells the gather visits used the same list, that list would be walked twice.
6. Each record is on m of the 32 starts' walks and counts 32/m each time, so its average weight is 1. The rule only works because m depends on the count alone. *Taught well, with the figure.*

## 3. Where I got lost (worst first)
- **The budget paragraph (§3).** Too much in one block: "the code bounds a thread's time", "until version 0.61.3", "its share of the budget". "Share" is only defined in the code note for §4 ("512 over the 8 cells"). And "list 1 holds 8 records and is walked by 24 of its sub-lists": where does 24 come from? I guessed 6/8 × 32. The page never says it.
- **The opening relies on chapter 18:** "light tracing", "shadow rays", "each find worth 85" (why 85?), and "chapter 18's rule, one more owner". I didn't understand "owner" at all.
- **"Each record keeps where it is… so none is counted twice."** The double count is never shown as a danger before the fix is given.
- **Fold-out 2:** see §6.
- **§4's last excerpt (n²):** "a gather made inside glass divides by n² itself" comes out of nowhere. Gathering inside glass was never mentioned before.
- **"(3, the setting's default, which its comment calls uniforms.schema.js:151)".** I can't parse this.
- **§5's "Neither full nor cut, checked":** "0.965 and 1.000 (two seeds), and 0.884 to 0.903 (three), where the exact map's own second run read 0.978 and 0.894". I couldn't tell which number belongs to which resolution, or what a "seed" is.

## 4. Words and symbols
- **Cards that helped:** bias, consistent and hash table (it gives "collision"), gather, photon map. **Irradiance** says "each square metre", but the flat world measures per length.
- **No mark where first used:** "caustic" (first sentence), "photon" and "atomic operation" have cards only in the end list. I met "caustic" with no help.
- **Undefined:** f, ρ and L in fold-out 1, ∝, variance, "sample", "error bar"/±, "thread", "kernel", "word" (4 bytes?), "scatters", "trace" vs "sample", "delta event", "evaluable lobe", "BSDF", "throughput", "radiance", "Dawn", "seeds", "Russian roulette". The code notes cover some of these. *Outside knowledge* is how I understood f, L, variance and radiance.

## 5. Figures
- **Fig 1** (the ball, the pane, and the eye's strip). The screenshots show the photon ticks and the gather circles clearly. The circles grow at r = 0.4 and shrink at 0.012. Problems:
  - In the strip, the blur and the noise are hard to see at screenshot size.
  - The label "pixel 1 looks highest, 48 lowest" reads as "brightest", but pixel 1 is black.
  - Pixel 25's 0.72 is never given in the "with" paragraph, and the default r = 0.06 only shows up in the "narrow" paragraph.
  - The pane average hardly moves (0.364 → 0.352 → 0.362), so "wrong" and "noisy" don't show up in the readout. Why? (*Inferred:* blur moves light around rather than removing it.)
  - Without the map the pane reads 0.248 ± 0.063, against 0.366. Does the old method reach 0.366 eventually? The page doesn't say.
  - The screenshots show 161–200 samples, while the text says 300.
- **Fig 2** (the brightness at the peak against samples, plus the radius). Clear: red settles on the dotted line, blue climbs to the dashed one, and at α = 0.25 blue wobbles over it. Problems:
  - The lower panel's x-axis has no labels. Is it logarithmic like the upper one?
  - "Each mark ten times the last", but the last mark is 300.
  - The "shrinking" text doesn't say its α is 0.67. I read that off the screenshot.
- **Fig 3** (cells, ticks and four lists). It works well, and the list labels and "×1.33 / ×2.00" lines help a lot. Problems:
  - The legend has no entry for the **bold orange ticks** inside the shaded cells. I guess they are walked, own cell, outside r. That would explain 20 walked − 3 − 10 = 7.
  - The text says "cell −3 shares list 1 with cell 1", but the label reads "list 1: cells −11, 1". (*Inferred:* empty cells aren't listed.)
  - In the budget shot, the two red header lines overlap "gather here".

## 6. The maths fold-outs
- **Fold-out 1:** I followed it ("photons per length = light per length"). But ρ, f and L are only names to me, and "in 3D f depends on the direction" seems odd for a matte floor.
- **Fold-out 2:** I lost it at "behaves like a power", "variance grows as 1/r_k" (why?), "Σ i^1−α ∝ k^−α" (that needs sums/integrals I haven't done) and "error grows as r²". "k^α−1" without brackets is ambiguous. The last paragraph (what α trades) I did follow.

## 7. The code
- **`sppmRadius`:** readable. I matched it to §2's product, and the `sqrt` matches "area shrinks". `k | 0` is opaque.
- **`sppmGeomFor`:** `?.`, unary `+` and `pixelFootprint` are opaque. The note rescues the meaning.
- **`sppmStore`:** the note on atomicAdd/atomicExchange is good. Opaque:
  - `bitcast`, `sppmOct`
  - the `|`/`<<` packing on line 327
  - `select`'s argument order
  - why `idx + 1u` (I later guessed that 0 means "end of list")
- **The gather loop:** no prose walks through it. I worked out that each `continue` is a reason not to count. Lines 377 and 380 (`SPPM_ALL`, `LT_MIN_ALPHA`) stayed opaque. Line 360 *is* the m formula the prose left out. Where is the ÷πr²?

## 8. Too much, too little
- **Too much:** §4 has eight excerpts, two of them long WGSL. §5's numbers and the version history (0.61.2/0.61.3, mentioned three times) get in the way.
- **Too little:**
  - why the hash multiplies by a big constant
  - how a negative cell number gives a remainder (in JS, −3 % 4 is −3, but the figure puts −3 on list 1)
  - why bounding a thread's time is needed

## 9. Wrong or contradictory
- "Cell −3 … list 1" vs the label "cells −11, 1" (above).
- Fig 3's legend leaves out the orange ticks.
- "Each mark ten times the last" vs the 300 mark.
- The code comment says 0.61.2 and the note says 0.61.3. The page flags this itself, but it is noise for me.
- "About twice as large" error bar (per pixel), while the pane readout only goes 0.003 → 0.004.
- The irradiance card is per square metre, but the flat world is per length.

## 10. The five changes
1. **Rewrite the budget paragraph into steps.** Define "share" (512 ÷ 8 cells = 64). State m = 32 × share ÷ count, so 24 = 32 × 6 ÷ 8. Before giving the fix, show how a double count could happen.
2. **Open with a short recap of chapter 18.** Cover light tracing, shadow rays, a sample, the error bar, why a find is "worth 85", and the "owner" rule. Put cards on caustic and photon where they first appear.
3. **Fix Fig 1's story.**
   - Give r = 0.06 and pixel 25 = 0.72 in the "with" paragraph.
   - Say why the pane average barely moves with r.
   - Say whether the old method reaches the same value.
   - Reword "looks highest".
4. **Make fold-out 2 reachable.**
   - Define ∝ and variance.
   - Show in one line why noise ∝ 1/r (photons in 2r ∝ r).
   - Bracket the exponents, as in k^(α−1).
   - Swap the Σ asymptotics for a small table of numbers.
5. **Tidy §4–5 for a beginner.**
   - Walk through the gather loop in prose, one `continue` per reason, and say where ÷πr² happens.
   - Explain `select` and the `+1` heads.
   - Put §5's "checked" numbers in a table.
   - Fix the garbled uniforms.schema sentence.
   - In Fig 3, add the orange ticks to the legend and move the header lines off the gather label.
