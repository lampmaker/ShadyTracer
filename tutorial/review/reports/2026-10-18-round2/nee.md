## 1. Teach-back
A path tracer works out each pixel by sending many random paths from the eye. Each path bounces around until it happens to hit the lamp, and the pixel is the average of what those paths bring back. If the lamp is small, almost every path misses it and gets 0. The few paths that hit it get a huge value, so the average jumps around for a long time; that jumping is the speckle, the "noise". Next event estimation (NEE) adds one extra ray at every bounce, the "shadow ray". It goes to a random point on the lamp, and if nothing blocks it, that light is added. The answer on average stays the same, but the error bar shrinks a lot, most of all for small, bright lamps. You divide by the chance of your random choice, so that rare choices count for more and the average comes out right. Aiming at the lamp is useless for mirrors and glass, because they only send light one exact way. NEE makes each sample slower, about 1.35 times on one GPU, but you would need many more samples without it.

## 2. Quiz
1. Most random paths miss a small lamp, and the few that hit it bring back far too much. Each try is "nothing or far too much", so the average settles slowly. **Taught.**
2. It picks a random point on the lamp and sends a shadow ray to it. If the ray is not blocked, it adds the lamp's light × the surface's share × the throughput. **Taught.**
3. One picked point stands in for the whole lamp, so you multiply by ℓ, which is the same as dividing by the pdf 1/ℓ. The two-lamps example ("count double") made it click. **Taught.**
4. A mirror sends light on in only one exact direction, and a random lamp point is never exactly that one, so the shadow ray brings back 0. **Taught.**
5. The shadow ray from the bounce before already counted that light, so adding it again would count it twice. A camera ray had no shadow ray before it, so it counts. **Taught, but only in a margin note.** I worked out the reason ("the shadow ray already estimated all the direct light") myself.
6. In the Noise library scene: 184.7 ms against 136.9 ms of GPU time per sample, which is ×1.35. Shadow rays were about a quarter of the work, mostly the occlusion kernel (45.5 ms). It is kept because matching NEE's error bar without it would take about 13–34× the samples in the flat room. **Taught**, though the page says itself that the second half is inferred.
7. It picks a random direction inside the cone the ball fills, seen from the point, and divides by the chance of that direction. **Taught as a sentence only.** *How* you pick evenly inside a cone, or what that chance is, is left to the PBR link.

## 3. Where I got lost (worst first)
- **Section 7 and 9 code.** `res.r`, `select(1e-7, 1e-9, kind == 2u)`, `NEE_RAY.ltot/absLtot/steps`, "mixture density", `dot(L, S)`, `|L x S|^2`, "~180 f32 steps below 1". I can't find the fold-out's formula inside `contrib`. Where are cos θ_y, r² and A? Probably inside `le` or `dS`, but nothing says so.
- **Fold-out:** "spread evenly over every direction out, which works out to ρ/2 in the flat world and ρ/π in 3D". I have no way to see why it is 2 or π (*outside knowledge*). Section 2 said a diffuse floor favours "close to straight up", so "spread evenly" seems to disagree with it.
- **Section 2 margin:** "(0.000067 / π)". Why divide by π? It is explained only later and partly, in the stale-number note ("twice as often") (*outside knowledge*).
- **Why aiming is so quiet.** The page says "every one that is not blocked counts". It never says the real reason: every aimed try gives nearly the *same* number. That is the opposite of "nothing or far too much".
- **Section 9, "divided by the probability of hitting sky".** This only makes sense if you already know that a direction's chance mixes the sun's half and the sky's half.
- **Section 1.** Paths start at the eye, but my physics says light goes from the lamp to the eye. Why random bounces at all? The page leans on two chapters that are not written yet.

## 4. Words and symbols
- **steradian** is used in section 2, but solid angle is explained only in section 5. The card helps.
- **shadow ray** is in the figure 2 caption before section 3 introduces it.
- **pdf** is never spelled out in the text. The card's "lamp 2 long, ½ per unit" example does help.
- **radiance**: the card adds *luminance* and *candela per square metre*, which makes it worse.
- **normal**: the card talks about "an SDF … height lines", which I have never met.
- **MIS**: the card uses "firefly", which is not defined anywhere.
- **WGSL**: the card mentions WebGPU, which is not explained.
- Never explained at all: f32, dot and cross product, buffer, queue, "march", "Hit record", "occlusion", "converges", and BSDF (only glossed in §8).
- Helpful: albedo (explained inline), throughput, delta, caustic, kernel, the error-bar card, and the stamp cards.

## 5. Figures
- **Fig 1 (flat room).** The idea is clear. But the screenshot has a ball and a box that the text never mentions. No orange segment is visible, although the text promises one. The ⊕ on the lamp, ball and box look draggable, but only the pixel's ⊕ is described. The "one row of pixels" at the eye is not visibly drawn.
- **Fig 2 (one point).** It works well: 24 of 70 versus 3 of 70 makes the point. But the readout shows an "aiming" estimate before aiming has been explained.
- **Fig 3.** "Aim" (70 of 70) and "block" (red rays stopping at the box) are both clear.
- **Fig 4.** The red/blue dots and the two strips are clear. But colours are reused: red means *blocked* in fig 3, *without NEE* here, and the selected pixel. A red dotted line in the room (a blocked shadow ray?) looks like it belongs to "without NEE". Blue means a bouncing path and also "with NEE".
- **Fig 5.** Very convincing: black-with-dots against a smooth picture. Nothing to drag except the slider, which is fine.

## 6. Maths fold-outs
- I could follow the "ℓ pieces of length 1" argument (it assumes ℓ is a whole number) and the two-lamps rule.
- I could not follow "1/ℓ per unit of length": what is the chance of *one* point?
- The formula's parts list is readable. Why there is a cos θ_y and r rather than 2πr is taken on trust.
- The ρ/2 and ρ/π step stays opaque.

## 7. The code
- **Excerpts 1 and 4** (comments): readable. One snag in excerpt 4: a shadow ray "reaches the sky and deposits". What about a lamp indoors?
- **Excerpt 2:** the note explains pick00, fs, pick0 and es, but not `uL`, `.x`/`.xy`, or `max(…, 1e-6)`. The actual choice and the division ("the branches that follow") are not shown, so I never *see* "divide by its probability". The comment above it is impenetrable ("the camera owns what they light", "sunmis", "codegen LIGHTS").
- **Excerpt 3:** the `contrib` line is clear thanks to the note. The other nine lines are not.
- **Excerpt 5:** too dense to follow. The prose around it carries the story.

## 8. Too much, too little
- **Too much:** the "stale number" note is a long detour for a beginner. Section 8 has four stamped items plus the memory and last-round details. Section 9's first story needs mixtures and f32.
- **Too little:** why aiming gives similar tries; the double-counting rule (only a margin note, though it is a quiz-level idea); how to pick in a cone.

## 9. Wrong or contradictory
- **Excerpt labels:** the text says "The code is WGSL, the GPU's language" just before an excerpt labelled **JavaScript** (`materials_pbr.js` 864–875). The next excerpt from the same file is labelled WGSL.
- **"Ignore such hits" against section 6.** If every bounce that hits the lamp is ignored with NEE on, a mirror could never show the lamp. Yet section 6 says that through mirrors "the path has to find the light … by bouncing". The page should say the rule applies only after a bounce that sent a useful shadow ray.
- **§8, "about a quarter … (about 13 times the samples)":** by the page's own k² rule, a quarter gives 16. Thirteen matches the screenshot's 3.2/11.3 ≈ 0.28. "Quarter" is also used for the GPU share in the paragraph before it.
- **Fig 2 "small":** 0.237 ± 0.025 against 0.208 is about 1.2 error bars off, so "within about one" is slightly generous. The fence remark covers it.
- **Numbers that check out:** 0.53° → 0.000067 sr; /π → 1 in 47,000; ×441 ≈ 0.03; 184.7/136.9 = 1.35; 45.5/184.7 ≈ ¼; sixth (3.6/21.2), half (2.6/5.6), fifth (13.4/69.8); the error bars falling as 1/√N between the screenshot and the readout (11.4% at 543 → 8.7% at 941).
- **Try it:** "before you can tell where the ball is" is ambiguous. Is it the flat room's circle or the 3D lamp?

## 10. The five changes
1. Say plainly why aiming is quiet: each aimed try returns nearly the same amount. Put that next to "nothing or far too much".
2. Move "Don't count it twice" into the main text, and say it applies only after a bounce that sent a useful shadow ray (not after a mirror).
3. In the fold-out, show in one line where ρ/π comes from, or say outright "taken on trust here". Square it with "straight up more likely". Explain the /π in the sun margin note at its first use.
4. Fix the excerpt 2 label (WGSL). Show the branch that divides by the share. Trim or gloss the comment jargon. Point to where cos θ_y, r² and A live in `contrib`.
5. Fix the figures: mention the ball and box in fig 1, say which ⊕ can be dragged, and stop reusing red and blue for different meanings in figs 1, 3 and 4. Also fix "a quarter → 13".
