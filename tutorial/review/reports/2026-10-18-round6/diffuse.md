# Beginner read: "Diffuse and mirror" (ch/diffuse.html)

## 1. Teach-back
A material is what a surface does with light. Its rule is the BSDF, f. A matte surface such as paper has a constant f, so it looks equally bright wherever you stand. Its albedo ρ is the share of the light it sends back. Its brightness per bit you see (luminance) is the same in every direction. The light a whole patch sends one way (intensity) still falls with cos θ, because from a slant the patch looks narrower. A renderer can't try every direction at a bounce, so it picks one at random and divides by the chance of picking it, like the pocket-money guess. If it picks matte directions more often near the normal, following the cosine, each bounce multiplies the path by exactly ρ. A mirror sends all its light one way, so a shadow ray aimed at the lamp is useless there; the path just carries on and counts the lamp if it hits it. A white furnace (a sky of 1 in every direction) checks this: with albedo 1 everything reads 1 and disappears, and anything that shows is lost light, even light lost by stopping paths too early. A black object is needed too, to prove the test is drawing anything. Below roughness 0.0316 a surface counts as a perfect mirror.

## 2. Quiz
1. Each bit of the surface you see is equally bright from every side (same luminance). Intensity is luminance × the area you see, and a slanted patch looks narrower by cos θ, so it falls with the cosine. Taught. But "a circle through the point is exactly the cosine" I understood only from *outside knowledge* (a chord through a circle's point is d cos θ).
2. In a sky of 1 the point receives π, so the formula says it looks fπ. It sends back ρπ, and a surface looking L everywhere sends out πL, so it looks ρ. That gives fπ = ρ. With p = cos θ/π, the weight f cos θ/p = ρ. Partly taught: I accepted "receives π" and "πL out" without seeing why, and the page never says why p has /π (the chances must add up to 1).
3. The mirror reflects only along one direction, and a shadow ray to a random lamp point almost never lies along it. So the path carries on along the reflection and counts the lamp if it hits it. "Nothing found it twice" was not taught (see 3.1).
4. It is a sky of brightness 1 every way and nothing else. Albedo 1 should read 1 everywhere, so the shapes vanish. The black control proves something was drawn: ShadyTracer once passed with no sphere drawn at all. Taught well.

## 3. Where I got lost (worst first)
1. "since aiming could never have found that light, nothing found it twice". Twice? The page never says that at a matte bounce, a lamp hit by chance is *not* counted because the shadow ray already counted it. Without that, "counts what it finds in full" contrasts with nothing. *Outside knowledge.*
2. "passes on f cos θ divided by its own chance". Why f cos θ? In the main text the cosine has only appeared for intensity; the incoming cosine is in the fold-out's formula. "Passes on" is vague.
3. "p = cos θ/π". Why /π? Never said.
4. "a direction with chance 1 out of infinitely many". This reads as 1/∞ = 0. The delta card says it better.
5. "A circle through the point is exactly the cosine." No reason is given.
6. Section 5, "A smooth surface used to get a density of 10⁹ instead, which also switched aiming off…". Opaque; it needs chapter 15.
7. Section 6, "the energy a rough coat loses was given back to nobody". Coats, and rough coats losing energy, were never taught.

## 4. Words and symbols
- The **luminance** card says "Radiance as the eye sees it", and radiance is never explained, so the card didn't help. The page's own sentence was better.
- The **intensity** card says "how strongly a small lamp shines". The page uses the word for a patch of floor.
- The **roughness** card uses "microfacets", and the **march** card uses "sphere tracing" and "kernel", all unexplained.
- **E** appears in the readout ("E = cos 75° / 2.6") and is never named in the text.
- Not marked at all: Schlick, metallic, specular, coat, plastic, transmission, ior/index, WGSL, MIS, GGX, conductors.
- "96 samples a pixel" next to "96 paths a pixel": are they the same thing?
- Helpful cards: probability density (½ per metre), delta, white furnace, shadow ray, measured.

## 5. Figures
**Fig 1** (point, lamp, 48 blue directions, dashed circle). The slant/grazing pair works: the circle shrinks but keeps its shape, and the blue lines are identical in both, which shows "they do not depend on where the lamp is". Problems:
- I can't see the lines "crowded near the normal": one runs almost along the floor.
- The pointer readout appears in no screenshot.
- The caption says the circle is "cos θ times … albedo times the light arriving" (ρE cos θ). The text says it is luminance × the area seen (ρE/2 · cos θ). Which is it?

**Fig 2** (room). The white patch near pixel 26 makes the mirror point. Problems:
- A box on the floor is never mentioned.
- The strip's label "pixel 1 … highest" is almost unreadable.
- The caption says "faint lines are a few … paths" twice.
- I don't know what "the glass colour" is.
- The lines are a tangle.
- I can't tell whether the readout numbers are brightened 2.5× too (0.950 suggests they are not).

**Fig 3**. The four screenshots match their paragraphs well. Problems:
- I can't tell which side of the scene pixel 1 sees.
- In the grey picture the gap is barely darker than the discs.

## 6. Maths fold-out
I could follow the final algebra (the cos and the π cancel) and the flat world's "line 2 long". I could not see:
- why the point receives π;
- what "(the same disc, turned round)" means;
- why p has /π.

The integral as "adding up" is fine. The figure is flat, but the flat world's p (cos θ/2?) is never given.

## 7. Code
- **makeDiffuse/makeMirror**: readable (it sets fields). The comments' "photometry bench", "rho E / pi" and "glossy lobe" are opaque, and the header shows "WGSLWGSL".
- **Metal branch**: `pick < lb.metallic` is never explained. I guessed pick is a random number from 0 to 1, so metallic 1 always takes this branch. `lb`, `lb.cm` and `VEC3` stay opaque. I could check the reflection (−o.x, −o.y, o.z) with a sketch, which was good.
- **Diffuse base**: the caption says "(u in the fold-out)", but the fold-out has no u. Why √ is used stays opaque, and `phi` (the angle round the normal) is never named. Following the caption, s.w reduces to lb.base, which was satisfying. `ps` is unexplained.
- **Schlick**: the best excerpt. I checked cos = 1 → f0 and cos = 0 → 1 myself.
- **ALPHA_MIN**: √0.001 = 0.0316 is clear. The comment's "MIS pdf", "light-tracing split", "GGX lobe" and "march epsilon" are opaque. "As the structure's own comment says": which structure?

## 8. Too much, too little
- **Too much**:
  - The history in sections 5–6 (10⁹, coat coupling) is too much for a first read.
  - The Schlick/metal-colour paragraph drops into section 2 from nowhere.
  - Forward references (chapters 9, 10, 12, 13, 14, 15, 21) pile up.
- **Too little**:
  - The double-counting rule.
  - How the cosine pick works.
  - Why a renderer follows light backwards.

## 9. Wrong or contradictory
- "(u in the fold-out)": there is no u in the fold-out.
- "the gap shows (0.9963)": that is the picture's average. The gap pixels read 0.8333.
- "chance 1 out of infinitely many" reads as zero.
- The circle's size: the caption and the text disagree (see Fig 1).
- "every path ends in the sky" with a limit of 40, while the next step shows a limit losing light. Why is 40 safe?
- "within 0.04%, but rough glass": "but" means except? By how much?

## 10. Five changes
1. In section 2, state the rule: at a matte bounce, a lamp hit by chance isn't counted because the shadow ray already counted it. Then "in full" and "twice" make sense.
2. Explain the cosine pick: a point picked evenly in a disc (√u keeps it even), lifted straight up onto the half-sphere, which is the "pressed disc" backwards. Say why p = cos θ/π, and fix the "u in the fold-out" reference.
3. Add one sentence and a sketch for why a circle through the point is the cosine. Fix the luminance and intensity cards to match how the page uses the words.
4. Reword the delta as "all the chance on one direction: per bit of direction, infinite density".
5. Move the Schlick paragraph to section 4. Fold away the 10⁹ and coat-coupling history (send them to chapter 15). In the captions, explain `pick`, `lb.cm` and `ps`.
