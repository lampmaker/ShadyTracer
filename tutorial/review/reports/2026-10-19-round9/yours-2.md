# Beginner read: "A ray tracer in one page" (ch. 32)

## 1. Teach-back
Each shape is known only by a formula for "how far is my nearest bit" from any point. To find what a ray hits, the program asks every shape, takes the smallest answer, and jumps 0.9 of it, since a circle that size around the point is empty. It stops when the distance is tiny. Each of the 56 pixels sends rays through random points of itself. They bounce off matte walls in random directions, keeping 70% of the light each time, and bring back light only if they happen to hit the lamp. One try a pixel is very noisy, and averaging more makes it quieter: 64 tries is about 8 times quieter. A smarter trick is to also aim a "shadow ray" at the lamp from each bounce. Then a bounce that hits the lamp must not count it again. A mirror reflects instead of bouncing at random, and does not aim.

## 2. Quiz
1. **The march:** ask every shape its distance and jump 0.9 of the smallest. A hit is a distance under 0.001, a miss is 50 away, and it gives up at 200 steps. Skimming the box, the box is always close, so every circle is tiny and it takes many steps (69 against 8).
2. **A pixel's value** is the average of its samples. Each sample is lamp brightness × throughput if the path hits the lamp, else 0. Noise falls as 1/√samples. The page states this but does not say *why* (chapter 12).
3. **Aiming:** at each bounce but the last, a shadow ray goes to a random lamp point. If nothing blocks it, it adds that point's light (brightness × two cosines / distance × albedo/2), divided by the chance of the pick, times throughput. A later hit on the lamp adds nothing because that light was already counted.
4. **The outline and the last surface:** bounces can hit the whole capsule, round ends included. Aiming at the middle line counted a smaller lamp and read 9% darker. The last surface's shadow ray would count light one bounce further than a non-aiming path reaches (0.0870 vs 0.0556). I can repeat this but don't fully *see* it (§3).
5. **The mirror:** it reflects about the normal and keeps 95%, with no shadow ray (`aimed = false`). It sends lamp light along one exact direction, which a random lamp point never lies on, so a lamp seen in it counts in full.

## 3. Where I got lost (worst first)
- **`lampLight`'s point-picking.** The note ("side says which long side faces the point... On the circle the two round ends make...") is a wall of text with no picture. That two half-circles make one 2πr circle, and why one long side suffices, I knew from *outside knowledge*.
- **"One bounce too many."** The page mixes "bounce" and "surface". The NEE card says "every bounce but the last (the bounce after it is never traced)", but with 5 legs and 4 bounces, which is "the last"? I had to read `b < bounces` to find out. Also, why is *more* light wrong? The page never says that both methods must add up the same limited bounces.
- **"times the two cosines... over the distance: the flat world's 1/r (chapter 0)".** The reasons live elsewhere (*outside knowledge*).
- **"where the cosine law says more light comes from"**: the cosine law is never explained.
- **"the same rule as chapter 8's room"**: what rule?

## 4. Words and symbols
- **dot product** is used in §1's `segment` note but explained only in §2.
- **No cards:** cosine law, central differences, seed, error bar, radian, θ, ℓ.
- **Sphere tracing** appears inside the *march* card, unexplained.
- **§3–4 are mostly unknown to me:** kernel, GPU, thread, MIS, culling boxes, step cache, frame buffer, Fresnel, Russian roulette.
- **File references** (`uniforms.schema.js:80`) mean nothing to me.
- **Cards that helped:** albedo, throughput (it links to `beta`), shadow ray, normal, pdf (the "½ for each metre" example). NEE's card does not say why it is called "next event".

## 5. Figures
**Fig 1** (march): the hit and lamp shots work. I could check that each circle touches a wall, the floor or the box. In the graze shot the "dots crowded along the top" are invisible under the thick line, so 69 steps is a number to trust, not something I can see. A zoomed inset would help.

**Fig 2** (picture):
- In "one", the red ray for the brightest pixel just ends at the right wall. Why is it the brightest? Its bounce isn't drawn, yet the mirror shot draws both legs.
- Each strip is scaled to its own brightest pixel, so "the same picture as 64 without aiming" can't be seen. The "many" strip has a near-white block at pixels ~33–48; "nee" is flatter, with one white pixel.
- Nothing says which part of the strip looks at the ceiling, box or floor.
- The teal mirror wall isn't named in the caption.
- "Neighbours' difference over the average" is not defined exactly.

No figure shows a shadow ray or the lamp's outline, which is what §5 is about.

## 6. The maths fold-out
- **Paragraph 1** (pick a point, multiply by ℓ): followed.
- **Paragraph 2:** "the cosine over a half circle adds up to 2" needs calculus; I took it on trust.
- **Paragraph 3:** lost at "evenly spread sines bunch the angles near the normal exactly as their cosine". I could check (albedo/2·cosθ)/(cosθ/2) = albedo, but not where cosθ/2 comes from.

## 7. The code
- **Clear:** the notes for `circle`, `nearest`, `march`, `normal`, `camera` and `render` worked; the `tan` explanation was good.
- **Opaque to a little-JS student:** `{ eps = 1e-3, ... } = {}`, `|| 1`, `Float64Array`.
- **`path`:** `dx = nx * c - ny v...` ("turns it into the room's") is a rotation I haven't met. That `s.emit` is both "glows?" and "how bright" is implied, not said.
- **`lampLight`:** lines 70–77 stayed opaque.

## 8. Too much, too little
- **Too much:** §4's table and §3's list: names I can't use yet.
- **Too little:** any picture of aiming, and why the mirror shot's noise rose to 0.390 from 0.261.
- **Rushed:** §2's first paragraph packs camera, bouncing, cosine law, throughput, albedo, legs, the strip and a noise figure into one paragraph.

## 9. Wrong or contradictory
- "the questions a path asks are these six", but the table has seven rows.
- §5 opens with "read darker with aiming", yet the second mistake made aiming *brighter* (0.0870 vs 0.0556). How the two mistakes combined is not said.
- "the same picture... within their noise" vs the strips, which look different.
- Fig 2's ray shows one leg for matte and two for the mirror, unexplained.

## 10. The five changes
1. **Add a Fig 2 step drawing one whole path:** every leg, each bounce's shadow ray to a point on the lamp's *outline*, and the last surface marked "does not aim".
2. **Rewrite the `lampLight` note as numbered steps with a capsule sketch:** one side plus two half-circles = `len`.
3. **Make the last-surface rule concrete:** a table of legs 1–5 and which shadow ray stands for which leg. State the goal: both methods must add up the same bounces. Use "surface" and "bounce" consistently.
4. **Give fold-out paragraphs 2–3 a no-calculus version** (a numeric sum, a sketch of evenly spaced sines), or say "take this on trust".
5. **Fix the small things:** draw the strips on one shared scale; move the dot-product paragraph before §1's code; fix "these six"; explain the cosine law.
