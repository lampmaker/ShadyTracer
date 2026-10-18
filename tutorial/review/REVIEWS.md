# What the blank readers found, and what changed

Each round: the pages extracted (`extract.mjs`), one fresh reader a page with the brief in [`README.md`](README.md),
its report kept verbatim in `reports/<date>/`. Every finding below is **fixed** (and how) or **answered** (why it
stays). Findings are grouped as the reader gave them, worst first.

## Round 1, 2026-10-18

Reports: [rays](reports/2026-10-18/rays.md), [distances](reports/2026-10-18/distances.md),
[nee](reports/2026-10-18/nee.md), [contents, glossary, styles](reports/2026-10-18/index-glossary-styles.md).

**What the round showed.** All four readers could say what their page taught, and answered most of the quiz from the
page alone. The worst findings were the same kind on every chapter: **a figure that did not show what its paragraph
said it showed**, four times (chapter 1's shadow ray "hits the ball" while the screenshot showed the block; chapter 2's
squeezed circle that "lands inside" while the ray in fact stepped right over it and the readout said "stopped at the
surface"; chapter 2's overshoot that "goes on to hit the ball" while it went through the ball too; chapter 14's
blocked lamp, hidden entirely). Next: words used before they were explained, and the code sections written for the
project's own developers. Two were real bugs in the kit: a control hidden by `when` still showed (CSS beat the
`hidden` attribute), and an angle mark went the long way round, a ring with its θ inside the ball.

### Chapter 1, Rays make a picture

| Finding | |
|---|---|
| Fig. 5: the caption says the ray hits the ball; the screenshot shows the block, "in shadow"; the shadow ray stops in empty air; θ named but not drawn, the normal unnamed. | **Fixed.** The step now chooses its pixel when drawn: one whose ray meets the lit ball (θ and the normal drawn and labelled). A second step shows a pixel in another shape's shadow, chosen to face the lamp; its shadow ray is drawn to where it is blocked, crossed out there, and only faint beyond. |
| §9, the tile bug: N, w, h, `sqrt(N·w/h)` and "floating point" unexplained; "the pixel is called a tile" contradicts w−1 tiles. | **Fixed.** Rewritten (now §10): what the tile grid is and that a ray counts for the pixel its point lands in; why √(N·w/h) is w; a real case worked (809 × 395 gives 808.9999999999999, computed, and a line to type into a browser console); why it mattered (the noise depended on the window's size). §8 now says tiles are a grid of rays laid over the picture, and the excerpt starts at the line that turns the index into a tile. |
| §7's code: `UB`, `invTX`, `invView`, matrices, `a`, `.xyz`, `rnd.zw`, the seed's line not shown, "all in the lines above" untrue. | **Fixed.** The excerpt now starts at `let tile`; the list beneath glosses `UB` (uniforms), `invTX`, `PRNG` and the seed, `.xy` and `.xyz`, `invView` as a matrix whose columns are the arrows, the comment's `a`, `isPersp`; "comments are notes to the authors". Glossary entries for tile, uniform, PRNG, seed and matrix. |
| How a ray finds what it hits is never mentioned. | **Fixed.** §2: "the whole of the next chapter; for now, take it that it can". |
| Fig. 2: "5 bounced into the eye" yet "the picture: nothing yet"; how a ray "bounces". | **Fixed.** The strip says "still empty", the readout "too few to give any pixel a value", the text why; a bounce is explained (a matte surface scatters every way, not like a mirror). |
| `ray` not marked at first use; `sky`, `noise`, `intensity`, `tile`, `seed`, `compile` unexplained; the irradiance card's "lux", the normal card's "SDF" and "refracts". | **Fixed.** `ray` marked in §1; sky defined there and in the glossary; noise named in §7; new glossary entries for sky, intensity, tile, uniform, PRNG, seed, matrix, compile; the irradiance and normal cards reworded, lux and candela given entries. |
| Fig. 1: which end of the strip is the top; why three shades on the ball and a dark block; what the red cross on the screen does; why "From the lamp" and "Throw 400 more" on every copy of the figure. | **Fixed.** The strip is labelled top and bottom and the text says it is the screen on its side; §1 says faces turned from the lamp are dark; the pixel handle appears only where §5 uses it; "Throw 400 more" only in lamp mode. The mode switch stays: it is the same figure throughout the chapter. |
| The cosine law is stated, not shown; the fold-out's cos θ unexplained. | **Fixed.** A new figure and section (§6, Light at a slant): a beam w wide lights w / cos θ of floor, with a slider and a draggable lamp; the fold-out moved there and explains cos θ from it. |
| "one or two of every few hundred" against the readout's 1.3%; "stretched" against Try it's "squeezed". | **Fixed.** "one or two of every hundred"; "stretched" in both, and §3 says why the ends stretch. |
| Fig. 6: blue and grey rays have no legend; 0.343 against 0.5 at 35 samples. | **Fixed.** The caption names them; the text says the average wobbles and takes many samples. |
| Fold-out: i from 0; a triangle for tan; what normalise is; x clashing with a vector's x. | **Fixed.** Counting from 0; tan as across over along; normalise as dividing by √(a² + b²); x "a place on the screen, not a coordinate of the room". |
| §8's stamps mean nothing; the margin note's links to unwritten chapters; file:line references. | **Fixed** for the stamps: each is now a link with a glossary card (claim-measured, claim-code, claim-inferred), and §9 says so. **Answered** for the rest: links to planned chapters say they are planned, and the line references are for the developers this tutorial is also for. |

### Chapter 2, Shapes as distances

| Finding | |
|---|---|
| §5's "changes faster than a real distance" needs the fact that a true distance changes by at most 1 a unit moved; slope is calculus. | **Fixed.** §5 opens with that fact in walking terms, the squeezed formula's "2 for each 1" given, and a fold-out ("Dividing by the slope") works it with no calculus. |
| Fig. 5 shows no red circles and reads "stopped at the surface" though the text says the ray lands inside. | **Fixed.** It was a bug: the squeeze of 0.3 sent the first step clean over the ellipse, out of view, and the readout only knew "inside" or "not". Now squeezed by ½ from nearer: the first step lands inside, red circle and all. Squeezed harder, the figure marks where it should have stopped and reads "stepped right over the shape". The fixed version: one more step, every circle empty. |
| §3 says why not above 1, not why 0.9 rather than 1; why the distance never quite reaches 0. | **Fixed.** §3 now opens with why a march creeps (the nearest surface is off to one side, and 0.9 leaves a tenth), and the step scale's paragraph says what the margin is for. |
| Fig. 3 overshoot: the text says the ray hits the ball, the screenshot shows it through the ball too. | **Fixed** in the text: the first long step jumps the wall, after which every step lands a little inside what it approaches, so it goes through the ball as well and out. |
| Fig. 3 tolerance: stopping short is invisible at 0.25. | **Fixed.** The step uses the grazing ray at 0.1: it stops at the block's corner, which it really passes, and the figure says "a near miss, counted as a hit". |
| Fig. 4: sky and floor the same beige; the reddest band unexplained; the ball vanishes at 1.6; no Normals screenshot, how a direction is a colour. | **Fixed.** The camera is lowered so the sky shows; §4 names sky and floor, says the reddest band is the far floor below the horizon (checked: 123 steps there against 17 to 34 in the sky above), why the ball vanishes at 1.6, and that 0.9 costs nearly twice the steps (32.4 against 18.5, computed). The caption says how a normal becomes a colour. |
| The blend slider shows, live, in modes where it does nothing. | **Fixed.** A kit bug: `.fig-controls label { display: inline-flex }` beat the `hidden` attribute. kit.css now makes `[hidden]` win. |
| The probe's circle drawn open like a C. | **Fixed.** The pen's wobble did not meet itself on a closed line; it now blends to the noise a loop back, so every circle closes. |
| A bump under the box after blending. | **Answered** in the text: the blend adds material wherever both shapes are close, not only in the corner; the bump is that. |
| "aim" reads as a destination; "the scene's rad…" cut off. | **Fixed.** "aim, which only sets the ray's direction"; the label moved inside the figure. |
| The fold-out's k unnamed and h²/4k from nowhere; \|d₁ − d₂\| as absolute value. | **Fixed.** k is the blend slider; h²/4k explained by what it does at each end; the bars over one number named. |
| The box's code unexplained, `len` undefined; `hit.s.w`, `maxiter`, the atomicAdd block opaque; "thread", "dot products", "fillet". | **Fixed.** The box in words in the excerpt's caption; `hit.s.w` and `maxiter` glossed; the list the hit goes on said in one line; thread and fillet in the glossary; "a few multiplications (two dot products)". |
| §6–8 written for the project's developers. | **Answered**, partly fixed: the audience includes developers who will work on this code, so the excerpts stay, each now with its lines explained. |
| "Bright outlines" drawn dark; "largest squeeze" ambiguous. | **Fixed.** "dark outlines"; "strongest squeeze (the smallest number)". |

### Chapter 14, Aim at the light

| Finding | |
|---|---|
| The fold-out: E unnamed; 1/r against 1/r²; the cosines; albedo/2; "what the path has kept"; why dividing by the pdf is fair. | **Fixed.** Rewritten: one point stands for the whole lamp (cut it into ℓ pieces); "picked half the time, counts double"; E named as irradiance from chapter 1; 1/r and 1/r² and both cosines tied back to chapter 1; albedo/2 and /π said; throughput in §1 and the glossary. |
| The sun's numbers: 470, 430 and 235 do not agree. | **Fixed.** They did not: "470" was wrong. Now from the code's own 0.53° (photometry.js): 0.000067 sr; a sun 21 times wider covers 441 times the sky, the 0.03 sr of the old comment; the comment's "once in two hundred" is the chance for a direction picked evenly (0.03 / 2π), while a cosine-weighted bounce (tracebasics.js) finds a sun overhead about once in a hundred (0.03 / π); the real sun, once in 47,000. |
| Fig. 2 small: 0.237 ± 0.025 against an exact 0.208 is outside the error bar the text promises. | **Fixed.** The text says "within about one error bar" and what an error bar promises (about two estimates in three within one). |
| §6: "a shadow ray asks a surface" contradicts the card's "is anything in the way?" | **Fixed.** The shadow ray asks only that; what the surface sends on is said as the other half. |
| "Not on the last round": is the bounce traced either? | **Fixed** by quoting the code's comment ("falls back to BSDF sampling alone there -- noisier, still unbiased") and glossing it, instead of explaining past what the code says. |
| The second excerpt (three lights) unreadable; it stops before the choice; pS against dS; WGSL; `max3`, `select`. | **Fixed.** Its caption now walks the five lines with a worked share; pS and dS said to be one number (dS kept above zero: `max(pS, 1e-30)`, read in code); WGSL marked; `max3` glossed. |
| Legends: which paths found the lamp; orange and grey; dashed shadow rays; red and blue dots; the "pixel" marker; what "light here" is; ±0.000. | **Fixed.** The flat path tracer now marks the piece that ends on a counted lamp (`lamp: true`), drawn orange; every colour named in its caption or paragraph; the handle relabelled "whose paths" and explained; the readout says "the light reaching this point"; ±0.000 explained. |
| Fig. 3: the blocked lamp is hidden entirely (0 of 70). | **Fixed.** The block now covers part of the lamp: 14 of 70 get past, the estimate drops from 0.21 to 0.05. |
| Fig. 5 "the two come closer" is not what the readout shows (90/17 against 70/13). | **Fixed.** The text now says what it shows: the picture without NEE improves, NEE still about a fifth of its error bar. The flat room's "much closer" is given its numbers (a sixth at the smallest lamp, a half at the largest, from a 300-sample run). |
| The cost is given, not whether it pays at equal time. | **Fixed**, stamped *inferred*: k times smaller error needs k² the samples; the flat room's ratios (13 and 34 times the samples) against the measured 1.35 times the time; what would test it in ShadyTracer. |
| What happens when the camera sees the lamp directly with NEE on. | **Fixed.** The note says it is counted: no shadow ray came before it (as flatland.js does, `b === 0`). |
| "the user's NVIDIA Pascal card"; "Noise library scene". | **Fixed.** "ShadyTracer's developer measured it on their NVIDIA Pascal graphics card"; "the Noise library example scene". |
| §10's "tell where the ball is"; "the same total light" while the exact value moves 0.206 → 0.208. | **Fixed.** "gives off the same total light … so the exact light at the point hardly changes". The Try it line stays: the room it names has one ball. |
| Words: diffuse, radiance, normal, cosine law, variance, BSDF … used without cards; "Monte Carlo" and "direct light" in the word list but not where used. | **Fixed** where the page uses them: diffuse, radiance, normal, throughput marked; the variance glossed in place; the word list now the words the page marks. |

### The contents, the glossary, the styles page

| Finding | |
|---|---|
| Contents: what you need is said only negatively; what to read first; how to open the app; "path tracer" never said plainly. | **Fixed.** Two new boxes, What you need and Where to start, and a plain sentence on what a path tracer is. |
| Chapter lines on the map are lists of jargon. | **Fixed.** Every line rewritten in plain words (`kit/chapters.js`); the detailed lines stay in this plan. |
| "(this is the first round, for judging the direction)"; "ShadyTracer's own rules". | **Fixed.** Both rewritten for a reader. |
| "The same colour means the same thing" is false across styles: Drafting's camera ray and normal both black, Riso's both blue, Blueprint's blue and violet too close. | **Fixed.** The normal has its own colour in all three (grey in Drafting, teal in Riso, green in Blueprint); the text says "within a style"; a rule in this plan says no two roles a figure puts side by side share a colour. |
| "circled crosses" but the symbol is ⊕; "blocked, or something gone wrong" two meanings. | **Fixed.** "Circled crosses (⊕)"; the key says "blocked: a ray stopped short", and gains the march's step circle and a draggable handle. |
| Glossary: throughput's "keeps", CSG's "union (both)", sample's "adds a little less noise", Monte Carlo and noise/sample circular, lens's "depth of field", GPU's "them". | **Fixed**, each reworded. |
| Glossary: Lipschitz, pdf, delta and path tracing need calculus or more words. | **Fixed.** Rewritten: Lipschitz with "one unit for every unit you move"; pdf with a lamp 2 long; delta saying what the word means; path tracing why from the eye and why random. |
| Glossary: missing photon, scene, material, renderer, lux, candela, standard error. | **Fixed.** Entries added (standard error inside error bar); 74 entries now, some with outside sources to read more. |
| The definition runs into the chapter note ("absorbed.Planned"). | **Answered**: on the page they are separate lines; the extraction ran them together. `extract.mjs` now separates them. |
| Styles: the sample figure unexplained; θ inside the ball; no handle; the dark versions never shown; "the button beside it"; "side by side" but stacked; print words. | **Fixed.** The θ was a kit bug (the angle mark went the long way round, `pen.angle` now takes the short one), fixed in every figure. The sample is captioned and labelled, its lamp draggable; each card shows the style's key; the descriptions are in plain words; the button named (Dark / Light) and said to switch the cards too; "side by side" gone. |

## Round 2, 2026-10-18 (after round 1's changes)

Fresh readers, the same brief, the questions with one added a page (light at 60°, where to read more, a camera ray at
the lamp). Reports: [rays](reports/2026-10-18-round2/rays.md), [distances](reports/2026-10-18-round2/distances.md),
[nee](reports/2026-10-18-round2/nee.md), [contents, glossary, styles](reports/2026-10-18-round2/index-glossary-styles.md).

**What the round showed.** Round 1's worst findings did not come back: every reader answered every quiz question from
the page, and chapter 14's reader checked the page's numbers against each other and found them consistent (the sun's,
the costs, the error bars falling as 1/√N between a screenshot and a readout). What came instead was the next layer:
the reasons behind statements ("why is one eye ray enough?", "why is aiming quiet?", "why doesn't a ray inside the
ball stop?"), figures and steps that still did not match their words in smaller ways, a code label that was wrong, and
colours shared between meanings in the styles.

### Chapter 1

| Finding | |
|---|---|
| Fig. 3's pixels and field-of-view screenshots identical. | **Fixed.** Each step now sets everything it shows (a step patches the figure's state, and the pixels step did not set the field of view); the extractor also clicks a step again if a paragraph scrolling through took the figure back. |
| Why one eye ray is enough when the lamp needed many. | **Fixed.** §2: it asks the lamp directly, with the shadow ray of §5; from the lamp nothing is aimed. |
| §10: why √(N·w/h); why wider tiles give a pixel two rays; tilesY. | **Fixed.** Derived (tilesX × tilesY = N, tilesX / tilesY = w / h); a 4-pixel, 3-tile example of a pixel catching two rays or none; tilesY's 396 rows; and the code line that turns a ray's point into its pixel, quoted. |
| "the floor behind the block", though the point is in front of it. | **Fixed.** "just in front of the block, on the side away from the lamp". |
| Fig. 7's still view: three dark lines, no blue or grey, and at 50% the middle ray is a tie. | **Fixed.** The wedge's sides are faint, the ray labelled "every try: the same ray", the edge starts at 40% (the middle ray misses, the ball covers 40%), and Try it asks why 50% is the tie. |
| No stair steps shown; "one direction" against "a wedge". | **Fixed.** §7 says §1 simplified, and points at the staircase in the 3D figure's corner picture. |
| Fold-out: u's range, which end is −1, "right" in a side view, a worked example, the 3D field of view vertical. | **Fixed**, all five, with the example worked (N = 12, 52°: 24° from ahead). |
| d and w each with two meanings; θ printed as ϑ. | **Fixed.** Distance is r and the beam's width b; θ out of the italic that drew it as ϑ. |
| `fwd` pointing backwards; `rayFirst`, `max(1u…)`, `clamp`, `invProjection[0][0]`; the excerpt stopping before `origin`. | **Fixed.** Glossed, and the excerpt now ends at `origin = camPos`: the eye. |
| "draws no extra random numbers" against `PRNG()` giving four, `zw` the lens's. | **Fixed.** Said exactly: the lens uses the other half of the four one call already gives, so it changes no other random choice (read in code, genrays.js). |
| "Point at a stamp for what the others mean", with one kind of stamp; what ShadyTracer is. | **Fixed.** |
| The normal card's "For an SDF". | **Fixed.** "For shapes made of distances (chapter 2)". |

### Chapter 2

| Finding | |
|---|---|
| "Stops when the distance is below a small number", yet rays inside the ball march on. | **Fixed.** §3 says the march goes by the distance's size, as it must to march through glass, so a ray that has stepped inside marches on, out of the far side; the tolerance is on the size. |
| "Where the ray is, not how far it has gone" against the code's `ray.ltot > lmax`. | **Fixed.** The excerpt's caption: that is a safety limit with its own state (RAY_MAXITER), not an escape. |
| The dot products and the scene's middle. | **Fixed.** §3 says the middle is (0, 0, 0) and spells both sums out (read in code: `dot(ray.pos, ray.pos) > UB.envRadius²`, `dot(ray.pos, ray.dir) > 0`). |
| §5's leap from "never faster than you move" to "never more room than there is". | **Fixed.** The sentence that joins them; the fold-out works along y = 0 instead of "far from the middle". |
| Handles on rays: the aim on the ball's handle, the wall's on the overshoot ray; the escape clipped. | **Fixed.** New start and aim points for the march, overshoot and escape steps, each checked (it hits; it escapes through the wall and the ball; it escapes inside the frame). |
| Fig. 1's red dashed inside circle; "holds nothing else". | **Fixed.** The caption says both. |
| Fig. 4: "the ball is gone" though a rim remains; blue in the step colours; Normals never mentioned. | **Fixed.** |
| Fig. 5's steps invisible in the fix; step scale 1 against §2's 0.9. | **Fixed.** The text says the last steps are tiny, at the surface, and that this figure steps the whole distance on purpose. |
| "Most rays need only a handful of steps" against 32.4 on average. | **Fixed.** "A ray aimed straight at a surface". |
| The box's code (one side outside), `hx`, `=>`; `hit.s.w`, `UB`, `atomicAdd`, `shadeBuffer`, `moveBy`; the two 32s; WGSL unexplained; "normals of the wrong length". | **Fixed.** Glossed in the captions; the comment's 32 said to be the same 32; WGSL marked at first use; a normal "meant to be exactly one unit long". |
| The shapes.js header and §6–8 written for developers. | **Answered** as in round 1: they stay, glossed, for the readers who will work on this code. |

### Chapter 14

| Finding | |
|---|---|
| Why aiming is quiet. | **Fixed.** §3: every aimed try brings back nearly the same amount; bouncing gives nothing, nothing, then far too much. |
| "Don't count it twice" only a margin note, and wrong for a mirror. | **Fixed.** In the main text, with the condition: it holds after a bounce whose shadow ray could find the lamp; a camera ray and a mirror's reflection count. |
| ρ/2 and ρ/π from nowhere; "spread evenly" against "straight up more likely". | **Fixed.** Said to be taken on trust here, what they make true (the light leaving adds up to ρ), and chapter 8 named; §2 says the surface is equally bright every way and the bounce favours straight up because those directions carry more light, then divides by that choice. |
| The sun's /π unexplained where it first appears. | **Fixed** there. |
| An excerpt of WGSL labelled JavaScript. | **Fixed** in the kit: `languageOf` now asks whether the excerpt lies inside the file's template string, by a small scanner (code, comments, quoted strings, nested templates), and the test holds it to a file built to fool a count of backticks. It also stopped calling shapes.js's JavaScript header WGSL because it mentions f32. |
| The division by the share never shown; where cos θ_y, r², A live. | **Fixed.** A citation of the emitter's `(1.0 - fs) * es * …` and of `lightFaceDensity` (scene_api.js), whose r² / (A cos θ_y) is what dividing by it undoes (read in code). |
| Red and blue reused: red for blocked and "without NEE", blue for paths and "with NEE". | **Fixed** for red: the without-NEE dots are grey. Blue stays the colour of the eye's paths, which the with-NEE picture is made of. |
| "about a quarter (13 times)" against k² = 16. | **Fixed.** "a little over a quarter (0.28)", which squares to 13. |
| The occlusion comment's "reaches the sky and deposits" with a lamp indoors. | **Fixed** in its caption: written when the sky was the only light; a shadow ray to a face, and one to a glowing surface, said as the code's comments say. |
| The pdf of one point; ℓ a whole number. | **Fixed** in the fold-out. |
| Fig. 1's ball and box unmentioned, which ⊕ drag, the orange segment not in the screenshot. | **Fixed** in the text ("when one does": the drawn paths are the last few, which need not include one that found the lamp). |
| Excerpt 2's comment jargon, the occlusion excerpt's density, §9 needing mixtures and f32, the stale-number note a detour. | **Answered**: glossed where a beginner needs it, kept for developers, as in round 1. |

### The contents, the glossary, the styles page

| Finding | |
|---|---|
| The key's shape and handle ran into its words; the circle unexplained. | **Fixed.** One column, a row a meaning, a solid shape and a handle each a row; the caption links camera ray, shadow ray, normal and march, and says the circle reaches the nearest surface. |
| Colours shared: Risograph's shadow ray and normal both teal (round 1's fix made that), its lamp and blocked rays both pink; Drafting's three meanings in orange-red; Blueprint's shadow ray close to its camera ray. | **Fixed.** Risograph: normal purple, blocked orange. Drafting: blocked black and dotted, its description saying its lines are told apart by their dashes and its one colour is for light and handles. Blueprint: shadow ray slate. The rule in the plan now says roles side by side must not look alike, by colour or by dash. |
| "card" for a graphics card; "cost" unexplained. | **Fixed.** "graphics card"; the read-in-code stamp says cost means time and memory, only ever measured. |
| noise, photons, WebGPU not linked; "the light" for light and dark mode. | **Fixed.** |
| Glossary: sample per pixel or per picture; GPU against two million pixels; normal "on the height lines"; tile unparseable; matrix's "backward"; f32's origin; delta and glass's two directions; MIS's "counted twice"; candela/intensity and lux/irradiance circular; radiance's chain of units. | **Fixed**, each. |
| Glossary: missing ray tracing, shader, march, shade, luminance, illuminance, exposure, bias. | **Fixed.** 82 entries now. |
| The styles sample's circles and θ unexplained. | **Fixed** in each card's caption. |
| The page's sticky bar over the figures in screenshots, naming the page's style above another style's card; no dark card shown. | **Answered**: the bar stays at the top while a reader scrolls, and names the style the page is read in, which is the menu's job; the Dark / Light button shows every card dark, as the page says. |

## Next round

The pages stay drafts. Round 2's changes are smaller than round 1's, and most are words; a third read is worth it when
a chapter is next rewritten, or when the user's own reading finds what these readers cannot: whether a figure feels
right to drag, and whether a real student keeps going.
