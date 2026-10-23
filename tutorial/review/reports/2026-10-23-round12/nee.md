## Beginner read of ch/nee.html (Aim at the light)

### 1. Teach-back
A picture is an average of random paths, and a path only brings back light if it happens to bump into the lamp. With a small lamp almost every path misses. The few that hit count as hugely bright, so the average is right but jumps around for a long time, and that jumping is the noise. Next event estimation fixes this: at every bounce you also pick a random point on the lamp and send a "shadow ray" to it. If nothing is in the way, you add that point's light, multiplied by the lamp's length (or area) because one point stands in for the whole lamp. That multiplying is "dividing by the probability". Every aimed try gives roughly the same amount, so the result settles fast. Aiming is useless for mirrors and glass, because they send light in only one exact direction. If NEE is on, you must not also count the lamp when a bounce hits it, or you count it twice. In ShadyTracer it costs about a third more time per sample, but it saves many times more samples. Several past bugs came from two parts of the code disagreeing about where a light's edge is.

### 2. Quiz
1. The lamp is small, so most paths miss it and the rare hit is far too bright. Each try is either nothing or far too much (§2).
2. It picks a random point on the lamp and sends a shadow ray there. If the ray is clear, it adds lamp light × cosines / distance × lamp length, times the surface's response and the path's throughput (fold-out).
3. A choice made often has to count less and a rare one more, so the average comes out exactly right. The page's example: "if one is picked half the time, it must count double".
4. A mirror reflects in one exact direction, and a random point on the lamp is never exactly in that direction, so it brings back zero (§6).
5. The shadow ray from the bounce before has already counted all the light coming straight from the lamp to that point.
6. 184.7 ms against 136.9 ms of GPU time per sample (about 1.35×), with shadow rays about a quarter of the work. It is kept because without NEE you would need about 13 to 34 times the samples to match its error bar. The page marks that as inferred, from the flat room only.
7. A random direction inside the cone the ball fills, as seen from the point, divided by the chance of picking that direction.
8. First half: with NEE off, what bouncing rays find counts in full, and bouncing rays saw a lamp a hair too big. With NEE on, a bounce that hits the lamp gets "almost no weight", so the extra rim hardly counted. **Second half: the page does not let me answer it.** It never says why the rim was made black instead of making shadow rays aim at the rim too. Worse, the fold-out in §3 taught the opposite lesson: the flat world was fixed by making aiming match "exactly the light the bounces can find". So I would have guessed the fix was to aim at the rim. The best I can guess is that "25% with a tolerance ten times larger" means the rim is a side effect of the tolerance and not part of the real lamp, but the page never says that.

### 3. Where I got lost (worst first)
- **"Two sizes for one lamp" (§9):**
  - "The march stops as soon as it is closer to a surface than a small tolerance". I have never met "the march" on this page. I only understand it because I know sphere tracing (outside knowledge). Why would a ray stop *before* the surface? It needs one sentence: a ray moves forward in steps and calls it a hit once it is very close.
  - "A lamp here is a flat sheet with no thickness". Here meaning where? The fold-out just told me the flat world's lamp is a capsule 0.02 thick. I had to guess that "here" means ShadyTracer.
  - "gives the rim the material of the lamp's back, which is black". A lamp has a back? Nobody told me lamps shine from one side only, or that an edge can be given a "material".
  - "gets almost no weight (section 8)". Section 8 says nothing about weights. Weights come from §4's "Don't count it twice" and the next chapter (MIS). This is a wrong cross-reference.
  - Why black and not aim at the rim: missing, as above.
- **§9, the sun:** "f32 steps", "1.6e9 cd/m^2", "pdf that thought it was sky", "mixture density". I get the gist (two tests disagreed on a thin ring), but the code comment is opaque.
- **§4, "Not at the last bounce"** and **§8, "Not on the last round"** sound like the same rule twice. I could not tell how a bounce and a round differ.
- **The fold-out's "Which points of the lamp"** paragraph is dense: the outline, the far long side, round ends counting 0. Then "0.1326 ± 0.0014 … nine percent apart". I followed the lesson, not the details.
- **§7:** "Each density carries the share that picked it", "BSDF side's weights", "lightFaceShare; PLAN.md L7". Meaningless to me.

### 4. Words and symbols
- *steradian* (§2 margin): used before the solid-angle card in §5. The card helps once I find it.
- *cosine law*, "chapter 1": assumed. The fold-out's θ_x gloss helps a bit.
- *pdf*: the card's "½ for each metre" example is good.
- *march*, *tolerance*: no card, and both are needed for the new paragraph.
- *variance*: glossed inline, good. *unbiased*: glossed as "still right on average", good.
- *BSDF*, *f32*, *queue*, *Hit record*, *MIS weight*: no card. The MIS card exists but is reached only through the word list.
- *radiance*: the card is hard ("into each bit of direction").
- *delta*: the card helps.

### 5. Figures
- **Fig 1:** the room, paths and noisy strip are clear. The dots-with-error-bars plot needs the caption, which it has.
- **Fig 2:** very clear. Many orange lines at size 1.20; at 0.20 only 3 hit and the error bar jumps from ±0.009 to ±0.025. It makes its point.
- **Fig 3:** the dashed rays all reaching the lamp make the point well. But the text says "here ± 0.001 against ± 0.009", while the fig-3-aim screenshot shows lamp 0.20 with ±0.003 against ±0.025. The text's numbers are fig 2's at size 1.20. The block screenshot (red rays, about 0.05) matches the text.
- **Fig 4:** two strips plus grey and blue dots. In fig-4-small the grey dots scatter visibly and the blue ones do not. Good. The dashed shadow rays are hard to tell from the paths.
- **Fig 5:** the most convincing figure on the page. At size 0.08 the left picture is black with white dots and the right is a room.

### 6. Maths fold-out
The "cut the lamp into ℓ pieces" argument is excellent and I followed it. The formula's terms are explained one by one. "ρ/2 … ρ/π, take on trust" is fair. The cone paragraph is fine. The last paragraph (capsule outline) lost me in its detail.

### 7. Code
- The tracebasics comment (540–546) is readable as prose.
- pick00 / fs / pick0: the caption makes it followable. "max(…, 1e-6)" is explained.
- contrib: the first line is clear thanks to the caption. `select(1e-7, 1e-9, kind == 2u)`, `counts`, `ltot`, `absLtot`, `bounces = 0u`, `RAY_ACTIVE` stayed opaque.
- The occlusion comment is clear.
- envPdf: I see `if inside sun disc then …`, but the `neeSunPick` mixture line is opaque.

### 8. Too much, too little
- **Too much:** §7's long margin note on the stale sun comment (steradians, 441, π versus 6.28) is a detour longer than the idea it serves. The detail in §8's stamped items is also a lot.
- **Too little:** the new paragraph is rushed. It introduces march, tolerance, a lamp's back and weights in six sentences, and skips the "why this fix".

### 9. Wrong or contradictory
- The new paragraph points to "(section 8)" for weights; it should be §4 and the next chapter.
- The new paragraph's fix (shrink what bouncing sees to match the aim) seems to contradict the fold-out's rule (make the aim match what bouncing sees), and the page does not reconcile the two.
- "A lamp here is a flat sheet with no thickness" against the fold-out's capsule lamp.
- §3's ±0.001 / ±0.009 against the fig-3-aim screenshot's ±0.003 / ±0.025.
- §4 says the error bar is "about a fifth" at the smallest lamp, while §8 says "a sixth" for the same case. §8's "0.28" at the starting size against fig-4-both's 3.1/9.6 ≈ 0.32 (the screenshot is still settling, so this one is minor).

### 10. Five changes that would help most
1. In "Two sizes for one lamp", say *why* the rim goes black instead of shadow rays aiming at it (presumably: the lamp's real size is the one typed in, and the rim is an artefact of the tolerance), and tie it explicitly to the fold-out's opposite-looking lesson.
2. Explain "the march" and "tolerance" in one plain sentence each (or give them cards), and say that a ShadyTracer lamp shines from one face and has a dark back.
3. Fix "(section 8)" to point to §4's "Don't count it twice" and the next chapter, and say "weight" there in beginner words.
4. Make §3's numbers match the fig 3 screenshot (or name the lamp size they come from), and make the fifth/sixth figures agree.
5. Merge or cross-link "Not at the last bounce" (§4) and "Not on the last round" (§8), and shorten the §7 stale-comment margin note.
