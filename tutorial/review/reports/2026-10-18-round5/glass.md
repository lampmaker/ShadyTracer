# Blank-reader review: Chapter 10, "Glass"

## 1. Teach-back
Light goes slower in glass than in air. A number called the index n says how much slower: 1 for air, 1.33 for water, 1.5 for glass and 2.42 for diamond. When a ray crosses into a slower material, Snell's law (n₁ sin θ₁ = n₂ sin θ₂) bends it towards the normal. Fresnel's law says what fraction reflects instead: about 4% straight on, rising to all of it near 90°. Light has two vibration directions, s and p, which reflect different amounts; the renderer uses their average. Going out of glass the ray bends away from the normal. Past the critical angle (41.81° for glass) there is no possible angle, because sin would have to be more than 1, so all the light reflects. A pane has two faces and light bounces between them. The renderer doesn't add up those bounces. Instead each ray randomly reflects or passes at each face, and the average comes out right. A glass ball focuses sunlight, but blurrily, because the outer rays cross at a different place. The renderer finds out what is behind a glass surface by checking the scene just past it. Coloured glass absorbs more over a longer path.

## 2. Quiz
1. **Snell / Fresnel:** Snell decides the direction of the light that goes through (how much it bends). Fresnel decides how much reflects and how much goes through. The page taught this well.
2. **Total internal reflection:** Light inside the denser material hits the surface at more than the critical angle. Snell would then need sin θ₂ > 1, so nothing gets out and 100% reflects. The page taught this. The formula asin(1/n) appears only in the figure's readout, never in the prose.
3. **(1 − R)/(1 + R):** The page did not teach why. It only says "which is (1 − R)/(1 + R)". I can't derive it with what's here. The second half was taught: each path randomly reflects with chance R at each face, and the average over many paths equals the sum.
4. **Material on the other side:** The ray remembers the index it is in (Ray.n). A transparent surface "asks the scene, at a point a hair beyond it". The page did not teach how the scene is asked.
5. **Thicker coloured glass:** It absorbs "more the further it goes" (Beer–Lambert). Colour depth is the distance after which the colour's fraction is left. That twice the depth leaves colour² is never said in prose. It is only implied by `exp(-mu d)` in a code caption, which uses ln and exp.

## 3. Where I got lost (worst first)
- **"which is (1 − R)/(1 + R)"**: there is no working. The page doesn't say the first pass is (1 − R)², or that each later pass is ×R² more. I also didn't know what "the series" was.
- **"the slanted path across keeps 45.6%"**: why not 50% if the depth is one thickness? The missing step is that the slanted path is longer than the thickness (I only realised this with *outside knowledge*). "Through it all, 41.1%" is ambiguous. "That much of each channel": which channel?
- **"So a transparent surface asks the scene… :"** then the code shown is `ownMedium`, which the caption says is the *opaque* rule. I never see the asking.
- **"each branch divides by its own chance, so the average is the sum"**: why does dividing make it right? (*outside knowledge*: this is importance sampling.)
- **"the exact answer averages the two series instead: 90.7%"**: I couldn't see what is averaged. Nor do I know what "the optics module's own note" is.
- **Diamond:** "Rays near its edge arrive inside past the critical angle and go round". The screenshot shows no ray going round.
- **"that is why polarising sunglasses cut glare"**: a step is missing. Glare is mostly s, and the glasses block s.
- **The angle θ is never said to be measured from the normal** (only the TIR card says so). "Grazing" is never explained.

## 4. Words and symbols
- **Cards that helped:** index of refraction, normal, total internal reflection and caustic were all good. The caustic card's "camera path" is unexplained.
- **Not explained:**
  - In section 1: grazing, s/p (the chart doesn't say which line is which), Brewster's angle (named only in the fold-out, caption and Try it), η, "luminaire", "optics bench".
  - Renderer words: "path", "branch", "series", "channel", "Beer–Lambert" (no formula in the prose).
  - Code words: WGSL, f32, VEC3, Schlick, F0, dielectric, IOR (never said to be the index), "SDF probe", "march tolerances", "shade kernel", "BSDF", "MIS", "vertex", "absLtot".
  - Sections 5 and 6: "white furnace", "rough glass", "facets", "specular slider", "tolerance", "step off a surface".
- **"The user's Pascal card"** reads as private shorthand.

## 5. Figures
- **Fig 1:** The left drawing and the dot on the chart work well together. The thickness-as-share idea is clear, and the TIR shot is convincing.
  - The caption says "the normal (dotted)", but it is purple and dashed, while the chart's dotted lines are p and the markers.
  - The dashed and dotted curves have no s/p labels.
  - In the "inside" shot the "p = 0" and "critical" labels overlap.
- **Fig 2:** It clearly shows the bounces and their shrinking shares.
  - In the 78° shot the incoming ray is cut off at the left edge.
  - The absorbing shot labels "41%" while the readout says 41.1%.
  - The readout's "(with polarisation kept through the slab: 90.7%)" means nothing to me before the text explains it.
- **Fig 3:** Glass and water work: I can see the blur and the dot moving out.
  - The diamond shot's label "its near-axis focus is inside the ball" sits far off at the bottom right, with no dot visible.
  - It shows no rays "going round".
  - "n / 2(n − 1)" can be read as (n/2)(n − 1).
  - The glass paragraph says the outer rays cross nearer, but the diamond readout says "the outer rays cross further out". The page never says why this reverses.
  - The hatching inside the ball isn't mentioned.

## 6. The maths fold-out
I could check every number with a calculator (9.2%, 0.8%, 5.0%, 0.04), which felt good. Three steps defeated me:
- **c₂ = √(1 − η²(1 − c₁²))** "Snell's law, written for cosines": it needs sin² + cos² = 1, which isn't mentioned.
- **Why r is squared to get R:** not explained.
- **Brewster's tan θ₁ = n₂/n₁:** given with no reason.

There is no fold-out for the pane series or for absorption, which is where I needed one most.

## 7. The code
- **`fresnelDielectric`:** clear. It maps line by line onto the fold-out, and `sin2T >= 1` is TIR.
- **The reflect/refract excerpt:** mostly opaque.
  - `sub`, `lb`, `pd`, `lb.o` and `max(1.0 - pd, 1e-6)` are undefined.
  - Why is `VEC3(-lb.o.x, -lb.o.y, lb.o.z)` a reflection? (*outside knowledge*: in a local frame the normal is z.)
  - Why compute `coatFresnel / lb.ps`? It seems to be R/R.
  - Why "mirror coat" for glass? What are `EV_DELTA` and `isDelta`?
  - The caption helps with `refract` and `i.z`.
- **`ownMedium`:** nine lines of jargon comment for one line of code, and the line is the opaque case.
- **`rayTransmittance`:** I followed "if there's no absorption, return 1". I also followed `exp(-mu·d)` if I already know e and ln. The comment ("as the MIS recovers a vertex") and `absLtot` stayed opaque, and so did why the ray stores length × index.
- The header reads "WGSLWGSL", which looks like a glitch.

## 8. Too much, too little
- **Too much:** sections 5 and 6 are mostly references to tests, files, chapters and versions I can't use. The `ownMedium` comment.
- **Too little:**
  - why light bends at all
  - the pane series
  - the slant in absorption
  - the random-choice weighting
  - how "asking the scene" works
  - the diamond case
- **Rushed:** the polarisation-averaging paragraph in section 2.

## 9. Wrong or contradictory
- **Excerpt and caption disagree:** the medium excerpt is introduced as the transparent surface asking the scene, but the caption says it is the opaque rule.
- **Diamond:** "go round, reflected" isn't in the figure. *Outside knowledge*: in a sphere, the angle at which a ray meets the back equals the angle it refracted to on entry. That is always below critical, so this sentence looks wrong. Please check it.
- **The "Thick and thin glass alike" bug** is listed as fixed. But the caption says `transTint` still tints "per crossing when it has no colour depth".
- **Section 5's "0.9228 where two give 0.857, as the test expected":** I couldn't tell whether the test expected the failure.
- **Try it:** "colour 0.2 and the depth 4 thicknesses, then 0.25". 0.25 of what, the colour or the depth?

## 10. The five changes
1. **A fold-out for the pane:** first pass (1 − R)², each extra pass ×R², summing to (1 − R)/(1 + R). Then a plain example of why random reflect-or-pass, averaged, gives the same answer, and why the weight is divided by the chance. Define "path".
2. **Absorption in prose with numbers:** after one depth, colour is left; after two, colour². The slant makes the path 1/cos 28.13° ≈ 1.13 thicknesses, so 0.5^1.13 = 45.6%. Say what a channel is. Connect this to the `exp`/`ln` in the code.
3. **Fix section 4's medium excerpt:** show the code that asks the scene, or say plainly that the line shown is the opaque rule. Gloss or cut the jargon (SDF probe, IOR, MIS), and explain `sub`/`pd`/`lb.o` and the local frame in the reflect/refract excerpt.
4. **Recheck the diamond paragraph and figure:**
   - the TIR claim
   - the label's position and the missing dot
   - why the outer rays now cross further out
   - write n / (2(n − 1)) with brackets
5. **Section 1 basics:**
   - say angles are measured from the normal
   - define grazing
   - label s and p on the chart
   - name Brewster's angle in the text
   - spell out the sunglasses step
   - in the fold-out, add sin² + cos² = 1 and why r is squared
