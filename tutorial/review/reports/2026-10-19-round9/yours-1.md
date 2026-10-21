# Chapter 32, "A ray tracer in one page": read as a beginner

## 1. Teach-back
Every object in a flat room is a formula giving the distance from any point to it. A ray starts at the eye, asks every shape its distance, takes the smallest (an empty circle) and jumps 0.9 of it, stopping under 0.001. The normal at a hit comes from checking the distance a hair to each side. Each of 56 pixels sends rays through random spots across it; they bounce off matte walls in random directions, keeping 70% each time, and bring back light only if they end on the lamp. A pixel averages its paths; noise falls as one over the square root of the samples. Aiming a "shadow ray" at a random lamp point at each bounce cuts the noise, but then a path that hits the lamp itself must not count again. A mirror reflects and doesn't aim. The first draft aimed at the lamp's middle line and from the last bounce, both wrong.

## 2. Quiz
1. Step 0.9 of the smallest distance (an empty circle), repeat until under 0.001 (hit), past 50 (miss) or 200 steps. Skimming: the box is always close, so every step is tiny, yet never under 0.001: 69 steps against 8. Taught; the "close but not close enough to stop" link I made myself.
2. A random path through a random point of the pixel brings back lamp brightness × throughput, or 0; the pixel is the average. The page *states* noise falls as 1/√samples (8× expected, 7× here) but not *why*; that averaging cancels ups and downs is **outside knowledge**.
3. At every bounce but the last, a shadow ray to a random point of the lamp's outline adds, if unblocked, brightness × two cosines ÷ distance × albedo/2, divided by the chance of the pick, times throughput. A path then hitting the lamp adds nothing "or the lamp would count twice". Why twice: never said that both estimate the *same* light.
4. Bounces hit the whole capsule, round ends included; aiming at the middle line aims at a different lamp (read 9% low). The last surface's next bounce is never traced, so aiming there counts light no unaimed path can reach (0.0870 vs 0.0556). Taught in section 5.
5. The right wall reflects 95%: ray reflected about the normal, throughput × 0.95, no shadow ray, `aimed = false` so a lamp seen in it counts fully. A mirror sends the lamp's light one way only, which a random lamp point never lies on. Clear.

## 3. Where I got lost (worst first)
1. "divided by the chance of picking it" / "1 over the length it was drawn from": why divide by a chance, and how is one exact point's chance 1/length? (**Outside knowledge**: a density.) The code's `* lamps.length` is never mentioned.
2. "sends back albedo/2 of it (3D: albedo/π)": no reason given.
3. "more often near the normal where the cosine law says": cosine law unexplained, and the bounce is never divided by *its* chance though the lamp pick is. That the cosine cancels is **outside knowledge**.
4. `cx = nx * ux + ny * uy` "is the cosine": the dot product is never explained (**outside knowledge**); it is also behind segment's `t`, line 99 and the mirror's `dn`.
5. Section 4's table: kernel, wavefront.js, culling boxes, step cache, MIS, forward differences, thread, frame buffer, all bare.
6. Section 5: "± 0.0014", "44,800 paths each", "chapter 30's fattened lamp".

## 4. Words and symbols
- "ray tracer" (title) vs "path tracer" (body): never defined or told apart; no card.
- *march* card helps but adds undefined "Sphere tracing". "(uniforms.schema.js:80)" means nothing to me.
- *normal*, *path*, *throughput* ("calls it beta" unlocked the code), *albedo*, *shadow ray*, *step scale*: helpful.
- *NEE*: only on the button "yes (NEE)" and in the word list; the body never names it. The card's "(the bounce after it is never traced)" is cryptic until section 5.
- No card: cosine law, central/forward differences, Fresnel, Russian roulette, MIS, seed, kernel, GPU.

## 5. Figures
**Fig 1.** The dashed circles each touch the nearest wall or the box; that made "jump as far as the empty circle" click (say so). *Graze*: 69 steps, about 4 circles visible; "too small to see", so the slow-down can't be seen. *Lamp*: an orange line; its round ends, central to section 5, are invisible. In *hit* the red normal lies back along the ray.

**Fig 2.** Good for noise: 1 sample mostly black with a few bright pixels, 64 smooth, 16 aimed like 64. Confusing: the strip's ends aren't matched to the dashed lines; nobody says the picture is one row; with the mirror the average rises to 0.1602 yet the strip looks *darker* (each strip rescaled to "brightest pixel white", consequence unsaid); the blue wall is the mirror, unlabelled; which pixel is the lamp's reflection? No path is drawn.

## 6. The maths fold-outs
None on this page. The "Aiming at the lamp" paragraph (two cosines, 1/r, albedo/2, dividing by the chance) is where one was needed.

## 7. The code
Clear: `nearest`, `march`, `render`, `normal`, `box` (via caption), `camera` (trig checks the right angle).
Opaque:
- segment line 20: the projection.
- lampLight line 67 (why `Math.min`), 70 (why "(-ty, tx)" is left), 75 ("a's half facing back"), 79 (the minus in `cy`), 83 (`len / r * lamps.length`).
- path 109–110: why "sine evenly" is cosine-weighted; `nx*c - ny*v` as a rotation.
- path 107: `aimed = nee` is also set on the last round, when nothing was aimed; harmless, but I had to check.
- Headers run into captions: "lines 11–23JavaScripts is the shape" (possibly this text version only).

## 8. Too much, too little
Rushed: the lamp-light paragraph, the cosine-weighted bounce, 1/√N. Jargon-heavy: section 4 and the "Extend it" list (fine as pointers). Section 5 is a good story; it would land better beside the aiming code.

## 9. Wrong or contradictory
- "within four bounces" and "Each round of the loop is one bounce", yet `b <= bounces` with 4 runs five rounds.
- The lamp pick is divided by its chance; the bounce isn't.
- The mirror strip looks darker though its average rose.
- "at a quarter of the paths": each aimed path also marches up to four shadow rays, so not a quarter of the work (inferred).
- Title "ray tracer", body "path tracer".

## 10. The five changes
1. Explain the dot product once (two 1-long arrows multiplied and added give the cosine between them), then point to it in segment, lampLight, path and the mirror.
2. Unpack "divide by the chance": why a fair average does it, what "1 over the length" means for a point on a line, `* lamps.length`, and albedo/2's source (or "from chapter 8, on trust").
3. Say why the bounce isn't divided by its chance (drawing near the normal already applies the cosine law) and why "sine evenly" does that, or name chapter 8.
4. Fig 2: tie the strip's ends to the dashed lines, say it is one row and rescaled (why the mirror's looks darker), mark the lamp's reflection, draw one path. Fig 1: zoom on the lamp's round ends; make the grazing steps visible.
5. Fix the bounce count (camera ray + 4 bounces = 5 rounds), define path vs ray tracer and NEE in the body, and gloss or mark "for later" section 4's jargon.
