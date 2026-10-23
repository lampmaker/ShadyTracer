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

## Round 3, 2026-10-18 (chapters 0, 3, 4, 12, 13, 15, 16, 17, first read)

One fresh reader a chapter, the brief in `README.md` with each page's questions. Reports:
[reading](reports/2026-10-18-round3/reading.md), [shapes](reports/2026-10-18-round3/shapes.md),
[normals](reports/2026-10-18-round3/normals.md), [montecarlo](reports/2026-10-18-round3/montecarlo.md),
[paths](reports/2026-10-18-round3/paths.md), [mis](reports/2026-10-18-round3/mis.md),
[emitters](reports/2026-10-18-round3/emitters.md), [lens](reports/2026-10-18-round3/lens.md).

**What the round showed.** Every reader could say back each chapter's idea, and the figures carried it; the readers
were lost in the same three places on every page: a step of maths written as if the reader had calculus ("variances
add", "the 2 in 2ℓ", "the gradient"), a number in the text that the figure's readout did not show the working of
(0.48 from a formula giving 0.175, 0.96 from numbers giving 0.98, 10.0 rays against a readout of 9.9), and a word
naming a colour or a line the figure did not draw that way ("bold" for blue, "the line at 1" in the old bars' red).
Two readers also asked what a stamped *measured* number was when it came from a count in node: the card now says.

### Chapter 0, How to read this

| Finding | |
|---|---|
| The first excerpts unreadable (tests.js lines), "the kernel is built" label on JavaScript. | **Fixed.** A short excerpt instead (help/widgets.js `smin`, explained word by word); the "filled in when the kernel is built" note only on WGSL. |
| What to install; "Nothing is built or installed"; section 7 for whom. | **Fixed.** git and Python 3 named first, node for the tests; "nothing of ShadyTracer's own is built"; §7 "for when you change the code", with pull request, CLAUDE.md and Playwright said in a line each. |
| "the next section" pointing at the wrong one; what can be skipped. | **Fixed.** The parts that can wait on a first reading are named. |
| The matte ½ / 1/π sentence. | **Fixed.** Said as "spreads over a half-circle in the flat world, a half-sphere in 3D", the numbers left to chapter 8. |
| Fig. 2's 3D side: no rays reaching the patch; two names for what is dragged. | **Fixed.** The rays to the patch's corners drawn; one name, the handle, with a slider beside it. |
| Who "the user" is, whose card. | **Fixed.** Said once here (the person who works on ShadyTracer and measures it on their own NVIDIA cards, Pascal or Ampere); the chapters use it that way. |

### Chapter 3, Building and bending shapes

| Finding | |
|---|---|
| "many" against "most" normals; the measured card against counts in node; k as divisor or multiplier. | **Fixed**, each: the builder's shapes give a normal, the library's plain ones none; the card covers a count by a program; k is how far the blend reaches. |
| The twist fold-out needed matrices; arc length. | **Fixed.** A move along the axis turns into rθ around it; the largest stretch found by trying every direction (cos θ, sin θ), the algebra left as a check. |
| The blend's gradient step needs calculus. | **Fixed.** Labelled as a step of calculus, with a check a reader can do (equal distances mix the normals half and half). |
| When a march stops; why an overshoot repeats; the plot rescaling. | **Fixed.** §5 says both, and that the plot's scale follows its steps. |
| Two rules for surface and medium shown with one probe position. | **Fixed.** A step with the probe in the water nearest the glass's surface. |
| §6 too long; `.w`, `.xyz`, `dot(a,a)`. | **Fixed.** Each excerpt names its lines to read; the swizzles and the dot product said once. |

### Chapter 4, Which way is up

| Finding | |
|---|---|
| The gradient and h against h² taught with calculus. | **Fixed.** A hill: a step east climbs 3 cm, north 1 cm, the arrow (3, 1) points uphill; "halve the step, forward's error halves, central's quarters", because forward measures half a step off the point; the Taylor series only named. |
| The measured stamp on an emulation; "stall" against "every march ended"; 128 or 128 to 256. | **Fixed.** The card; the comment's "can stall" quoted and set against what the emulation found; 128 to 256 spacings, the figure counting 128. |
| Fig. 2's ring, dashed circle, ticks, log axes; curves named by colour. | **Fixed** in the caption, each; the curves named by their labels, the colour word following the style. |
| Fig. 1's grey rings, h's unit, the dots' legend, a hidden arrow label. | **Fixed.** Lines of equal distance; h in the figure's units against the circle's 0.95; plain and ringed dots; labels kept together where arrows agree. |
| shader, kernel, GPU, frame and sample said once. | **Fixed**, at first use, with their cards. |

### Chapter 12, Dice and averages

| Finding | |
|---|---|
| §3 (the error bar a pixel keeps) unreadable: kernel, why w = 1/cnt, what V and S mean, why √(S·V/(1−S)) is the darts' s/√N. | **Fixed.** The running average by example (2, 4, 9: 2, 3, 5); V as the scatter about the average (8.67 for those three), S as the sum of the squared weights, 1/n for a true mean, so the bar is √(V/(n−1)) = 2.08 for them: the darts' s/√N with the usual n − 1. |
| The old generator's grid: state, f32, "top 24 bits" against "seven-eighths". | **Fixed.** The state a whole number to 4.3 billion; f32 like a calculator showing seven digits; every state below 2²⁴ fits whole, those from 2²⁹ up (7/8 of them) become multiples of 64; 671,040 = 64 × 10,485, so the grid is 1/10,485. |
| Why the sun's window falls elsewhere on the grid for each pixel. | **Fixed**, as the comment says it: each surface turns the numbers into directions about its own normal. |
| "Why √N" never shows why; 4√(p(1−p)) from nowhere; "s² is the spread". | **Fixed.** The variance of a 4-or-0 score worked to 16p(1−p); variances add, so a sum spreads by √N σ and an average by σ/√N; s is the spread. |
| The zero-width error bar at the start of fig. 1; can a bar see loaded dice? | **Fixed.** The first twelve darts all land inside: the bar says ±0 at an estimate of 4; and a bar sees noise, never bias, the bridge to §4. |
| "drawn bold" for blue darts; "twice the darts" for labels ×4; the line at 1 in the old bars' red; PCG4D's 0.995× called fair. | **Fixed.** Colours named (and following the style); the log scale named; the fair-share line dashed in ink over the bars; a 0.00001 window holds 167 or 168 of PCG4D's points, within half a percent. |
| "37 million samples" against the sample card; Pascal, NEE, tone curve, false colour, the window's 21; slot, workgroup, 4,194,240. | **Fixed.** 37 million paths (1188 × 969 pixels, 32 samples); each term said where it is used, 21 from S settling near 1/(2N+1); groups of 64 pixels, 64 × 65,535 = 4,194,240. |
| Cards for standard deviation, kernel, bias. | **Fixed.** A standard deviation card; kernel and bias linked at first use. |
| The comment-against-page box too long. | **Fixed.** Shortened to the two numbers, how they were counted, and why the old code cannot be checked. |

### Chapter 13, Following a path

| Finding | |
|---|---|
| 0.96 cannot be worked out; 10.0 against the readout's 9.9. | **Fixed.** The arithmetic shown (10.0 / 4.7 = 2.1 paths for the rays of one; 0.0028 / √2.1 = 0.0019 against 0.0020: 0.96), with the numbers once all 24,000 paths are in (the reader saw a figure still filling). |
| Rounds, kernel launches, "flushed", "a small win" against "not paid for it". | **Fixed.** Rounds explained (five kernels a round, a bus that drives its whole route for two passengers); rays still going at the last round; rays counted against time. Reading the code for it found the comment's "rounds to shrink" out of date: since 0.10.0 every sample runs the worst case (raytrace_main.js), now said with a stamp. |
| Fig. 2: one path read at every cap?; what the average is; cap 0; "bold line" for a thin red one; the skipped caps; no unit. | **Fixed**, each, in the text and caption. |
| The bounce comment's jargon; PRNG().x; "the flat world"; "extra terms for a coat" not in the excerpt. | **Fixed** in the excerpts' notes; the coat sentence removed. |
| A number example for roulette; the 0.95 ceiling; "pdf" in the firefly card. | **Fixed.** Ten paths at β 0.2; the ceiling stops a path at β ≥ 1 never stopping; the card says probability density. |
| Why the unfair comparison came out brighter. | **Answered**: neither the comment nor the test says, and the code that did it is gone; the page says so. |
| "energy conservation" in the code against the prose. | **Fixed.** The note says it means the same: on average nothing lost. |
| Why from the eye; "ray" against "bounce"; Pascal and "the user". | **Fixed.** |

### Chapter 15, Two ways to the light

| Finding | |
|---|---|
| The fold-out's integral; f, θ, L_e undefined; the code's names not mapped. | **Fixed.** "Adds up the light from every direction"; each symbol defined; NoL, le, pS, dS mapped onto them. |
| How weights summing to 1 count once; how two different directions pair up; why squares. | **Fixed.** Each strategy brings back a direction's whole light on average, so weights adding to 1 count it once; each sample weighed at its own direction with both densities; squares lean harder to the likelier strategy (Veach found them usually the least noisy), worked with the figure's 5.86 and 0.66. |
| Six names for the two strategies. | **Fixed.** "the lamp strategy" (NEE) and "the plate strategy" (BSDF sampling), defined once, used throughout, in the figure too. |
| The third excerpt 34 lines for the sun and sky in a lamp chapter. | **Fixed.** Cut to `above`, `pLout` and `sunmis`, said to be the sun's and sky's half. |
| The measured percentages: against what, what share. | **Fixed.** The setting named (the share of shadow rays aimed at glowing surfaces), the run at the default 0.5 the reference, and why a mismatch moves with the share. |
| Glass ball: its own density 0?; what its shadow should look like; the 10⁹ in the formula. | **Fixed.** Clear glass refracts into one direction, which a density cannot describe, so the code counts 0, and 0² / (0² + p²) = 0; a caustic in the shadow; p² / (p² + (10⁹)²) is 0. |
| Fig. 1: barcode strips, σ labels on the strips, no units, unexplained ticks, "speckled" for streaks. | **Fixed.** The plate is a line, a strip column a point of it; σ beside each row with its degrees; the ticks the side a lamp glows from. |
| Fig. 2: log scale; humps unnamed; colours named by role; both weights 0; "flat-topped". | **Fixed.** Each hump named, a lamp past 80° said to be off the plot; both weights 0 where neither strategy picks the direction (the guard's 0/0). |
| "fast ... counts in full" sounds like counting twice; dS and pS the same. | **Fixed** in the note: the fast mode weighs nothing on the plate side; dS kept apart for other lights. |

### Chapter 16, Every glowing thing is a light

| Finding | |
|---|---|
| "Unbiased from the first sample" not taught; MIS and unbiased without cards; the step showing nothing about before. | **Fixed.** The argument with the weights: before the bar is listed p_lamp is 0, the hit's weight 1; after, between 0 and 1 with the rest from aiming. The code's line cited. |
| Fig. 1: boxes promised, none seen; the grid not drawn; lines and ticks unexplained; the same paths at every step. | **Fixed.** The grid dashed (not the paper's), cells hit shaded, the boxes said to be small, the paths the latest ones that found a glow. |
| Why lines rather than points; which way the light leaves; the circle and the boxes' spheres; normal, matte = cosine. | **Fixed**, each. |
| The fold-out's 2 in 2ℓ; why θ stops at π. | **Fixed.** |cos φ| over a half turn adds up to 2; a line has no front. |
| "capped at 100,000" read as the code's cap; 24 against 32 bits; log and stop; atomics; Fig. 3's labels overlapping; "rising, then flat". | **Fixed.** The brightness is capped; a doubling gets 209,715 codes; why one step for every thread; the labels placed clear of both curves; the old curve's look on a ×10,000 scale. Why 2²⁴: **answered** as inferred (an f32 counts whole numbers exactly to 2²⁴), the comment not saying. |
| Density, solid angle, α; why divide by the line density; the 8 slots; LUM_DECAY. | **Fixed** in the text and the excerpts' notes. |
| §6's "split with the photons" and "two estimates". | **Fixed.** The split explained; the second points to chapter 15's last story. |
| The measured stamp naming no card. | **Answered**: the document names none for that run; the page says so, and names the card of the run before. |

### Chapter 17, The camera's lens

| Finding | |
|---|---|
| 0.48 from a formula giving 0.175. | **Fixed.** 0.175 on a picture one unit away, ÷ tan 20° = 0.364 for the half-height: 0.48; the readout shows both steps. |
| Why random lens points, averaged; sample and grain. | **Fixed.** A lens gathers through all its points at once; a sample takes one for every pixel. |
| The rule "each pixel looks at one point of the focus plane" only implied. | **Fixed**, said in bold, with a focus-plane card. |
| The genrays line opaque. | **Fixed.** Walked through: the bracket goes one unit forward, × F reaches the focus plane, − off starts it at the lens point, normalize. |
| Why a point camera cannot see the floor through glass. | **Fixed.** A paragraph before the lens.js comment: refraction decided, a diffuse floor free, a point never hit by a free choice. |
| "takes no random number" against four drawn. | **Fixed.** The four are drawn either way; at radius 0 the last two go unused. |
| Radius in fig. 1, diameter in fig. 2; ball colours; samples 4 or 48; "dashed" three ways; where the picture column is. | **Fixed**, each (an aperture card; the balls named red, blue, gold; the axis labelled; the column said to be drawn for reading). |
| "no page"; orbiting, orthographic. | **Fixed.** |

## Round 4, 2026-10-18 (chapters 0, 3, 4, 12, 13, 15, 16, 17, after round 3's changes)

A fresh reader a chapter again, the same brief. Reports:
[reading](reports/2026-10-18-round4/reading.md), [shapes](reports/2026-10-18-round4/shapes.md),
[normals](reports/2026-10-18-round4/normals.md), [montecarlo](reports/2026-10-18-round4/montecarlo.md),
[paths](reports/2026-10-18-round4/paths.md), [mis](reports/2026-10-18-round4/mis.md),
[emitters](reports/2026-10-18-round4/emitters.md), [lens](reports/2026-10-18-round4/lens.md).

**What the round showed.** Round 3's fixes held: no reader was lost where the last one was. The new losses were one
level down, in the words the fixes brought (a symbol defined in another chapter, "the user", a step of algebra said
in a clause), and in three figures that did not show what their paragraphs said: chapter 16's tight boxes were drawn
off the canvas (the kit's `pen.rect` takes world units and was handed pixels), chapter 17's streak ran off the top of
its picture, and chapter 0's 3D side could not be counted. Each was found by a reader looking for what the text
promised, which no test of ours looks for.

### Chapter 0, How to read this

| Finding | |
|---|---|
| The key lists camera rays, shadow rays and march steps before anything says how a renderer works. | **Fixed.** The renderer in brief before the key (a ray a pixel from the eye, backwards on purpose, a shadow ray to each lamp, bounces), and "come back to it" said. |
| Fig. 2's rays grey like the key's shadow ray, its piece red like "blocked"; the 3D side not countable. | **Fixed.** Every ray the lamp's colour (faint or bold), the piece a solid shape; the 3D rays 10° apart each way, 16 caught at r = 1 and 4 at r = 2, with a close-up of the patch; tested (`caught3`). |
| A whole circle, then a half-circle. | **Fixed.** A lamp shines every way, a surface to its front only. |
| 2πr and 4πr² only on the figure; counts between the steps. | **Fixed.** Both in the text; the counts jump because a piece catches whole rays. |
| Section 6 for a beginner: terminal, localhost:8000, WebGPU, NVIDIA. | **Fixed**, each. The commands "run together" was the text copy: the page shows them on three lines, now also said. |
| The code examples not to be understood yet; "the user"; "the GPU's numbers"; "loads against a scene". | **Fixed**, each. |
| The irradiance, march, kernel and normal cards. | **Fixed.** |

### Chapter 3, Building and bending shapes

| Finding | |
|---|---|
| The fold excerpt's note said the solid kept is the most negative distance. | **Fixed.** The one nearest zero: the solid the point is least deep in. |
| §5's bound: why each noise layer is as steep, where 1.875 is from, 17.2 meaning two things, why the band is twice the reach. | **Fixed**, each; the second 17.2 said to be the same number by chance. |
| Two families of shape functions against the comment; the fillet's arrows crossing. | **Fixed.** The builder's `N…` functions return a normal, the library's `sd…` ones none; arrows on a hollow cross a little way out. |
| L against L² in the fold-out; "matrix". | **Fixed.** |
| WGSL and shader never said; the `t` line; "round and shell (excerpts above)"; warp's k. | **Fixed**, each. |

### Chapter 4, Which way is up

| Finding | |
|---|---|
| Which differences ShadyTracer uses, and why. | **Fixed.** Forward: three looks instead of six, at a step too small for its error to show. |
| §3 in plain words: the step, why it is the tolerance, 2⁻²³. | **Fixed.** The tolerance is where a ray counts as a hit, a ten-thousandth of the scene (0.1 mm a metre); 2⁻²³ is f32's spacing above 1; the floor is 15 µm a metre out. |
| The rule behind 128. | **Answered**: the document states no threshold; its "below a hundred or so" and 128 the first power of two past it, said as inferred. |
| Fig. 2's axis, the f32 curve, why the small circle is less noisy. | **Fixed.** Both log scales described; the f32 part dashed red; the circle's numbers are millimetre-sized after its first subtraction. |
| The sign(0) story said "box". | **Fixed.** An octahedron's normal, as the code's comment says. |

### Chapter 12, Dice and averages

| Finding | |
|---|---|
| The grid paragraph: why 64, why 1/10,485 survives `fract`, 0.95 and 1.83. | **Fixed**, step by step: from 2²⁹ six binary digits dropped, multiples of 64; 671,040 = 64 × 10,485. |
| V and S through 2, 4, 9; d from the old average. | **Fixed.** Worked a sample at a time to the same 8.67 and ⅓. |
| "Variances add"; "1 in 3 and 1 in 20". | **Fixed.** The cross term averaging to 0 shown; the bell curve's shares to take on trust, checked by the figure. |
| The small contradictions (5% against 10%, a 20-dart try, "no path landed"). | **Fixed.** |
| What a path is, for a reader arriving here. | **Fixed**, a sentence. |

### Chapter 13, Following a path

| Finding | |
|---|---|
| Rounds before §5; what roulette can still save. | **Fixed.** |
| A survivor's β becomes 1. | **Fixed.** With p = β, β/p is 1: the tail of long paths, the unfair curve, the ceiling explained by it. |
| The unfair game's error bar. | **Fixed.** It reads smaller (0.73 of the fair one's): a bar sees disagreement, never bias. |
| The fold-out: ∏, θ, L_e, ρ, f and p. | **Fixed.** f = ρ/π, p = cos θ/π, and the cancellation to ρ shown. |
| The second comment's jargon; "the user's graphics card"; the kernel card's count. | **Fixed** in the notes and the card. |

### Chapter 15, Two ways to the light

| Finding | |
|---|---|
| Fig. 2: where the weights matter. | **Fixed.** The stretches with no lamp shaded; the tiny lamp's spike pointed at. |
| Why MIS removes streaks. | **Fixed.** A lucky find times a weight near 0; the plain ratio's 0.90 beside 0.99. |
| The glass ball and glossy plastic, step by step. | **Fixed.** |
| Which measured brightness was true; how the share enters the weight. | **Fixed**, the first as inferred (the document does not say). |
| The code's names; cards at first use. | **Fixed.** |

### Chapter 16, Every glowing thing is a light

| Finding | |
|---|---|
| p_plate and p_lamp never defined; density only in §4. | **Fixed.** Both defined in §1 as each way's chance per unit of direction, density linked to its card. |
| The tight boxes nowhere; a hit cell not circled at one sample; the bar's dashes; the grid like the paper. | **Fixed.** The boxes were drawn off the canvas: now drawn. The list is made every second sample (`EMIT_EPOCH`, tested against raytrace_main.js), so after one nothing is circled yet, and the readout says so; a one-hit cell's circle is only the margin, drawn solid; the glowing line added to the key; the grid dotted and darker. |
| The fold-out's calculus (|cos| adding up to 2) and 3D notation. | **Fixed.** The lines as a rectangle of choices, |cos φ| averaging 2/π over a half turn (checked by throwing angles, chapter 12's way); the 3D line marked for later, its symbols named. |
| Logarithms. | **Fixed.** log₂ counts doublings; multiplying adds codes, 0.9 takes away 0.15 of a stop. |
| How brighter parts send more light with crossings spread evenly; which way a photon leaves. | **Fixed.** Each photon carries the glow where it started (the comment's flux Le / density); the probe's direction from its comment. |
| Fig. 2's lines (only some drawn), "bar" three ways, the clipped title; Fig. 3's labels. | **Fixed.** The rod, columns, "at most 60 drawn"; the marks' names written along their own lines. |
| The code: the 3D-to-1D index, the cone test, why densities add, why only spheres holding y; WGSL, u32, exp2, select. | **Fixed** in the excerpts' notes. |
| 1.6e9; "0.6%" sounding small; "card"; two estimates. | **Fixed.** 1.5e9 (the comments' 1.6, chapter 5 to work it out); 0.6% is how much of the picture that light was; a graphics card; the two-estimates story told in words, chapter 15 named. |

### Chapter 17, The camera's lens

| Finding | |
|---|---|
| "A free choice cannot hit a point" needs path tracing; SDS. | **Fixed.** Before the excerpt now: a path's random choice at a matte point, glass deciding the rest, a shadow ray that cannot bend, from both ends; SDS spelled out. |
| Why a lens focuses; "an opening". | **Fixed.** Glass bends light so one distance meets again; the renderer runs it backwards. The heading "A lens brings one distance to a point". |
| dirCam; fwd's sign; "less off"; lensDisc. | **Fixed.** dirCam is the pixel's point one unit out, −1 along fwd, which points backwards; "minus off"; the disc's √u. |
| The one-unit picture not shown. | **Fixed.** Drawn, short and grey, "picture, 1 out", the column said to be it drawn larger. |
| Two identical handles; the clipped label; the streak at the top; no ray matched to its spot; the colours. | **Fixed.** Handles labelled F and "the point"; labels right-aligned; the point lowered (the streak stays inside); the lens's top-edge ray and its landing in one colour; colours named per style. |
| The fold-out's division step, 1/2F, why the half-height. | **Fixed**, each worked. |
| Fig. 2 blocky, no grain shown, no units, radius against diameter, "many samples". | **Fixed.** 128 × 80; a step after the first 2 samples, and a control to stop there; metres; the radius R in both figures (the program's aperture said to be its double); 48 or 4. |
| The black-prism story told three times. | **Fixed.** Told once, in §3; §5 points to it. |

## Round 5, 2026-10-18 (chapters 5 to 11, first read)

A fresh reader a chapter, the same brief. Reports:
[photometry](reports/2026-10-18-round5/photometry.md), [colour](reports/2026-10-18-round5/colour.md),
[pixels](reports/2026-10-18-round5/pixels.md), [diffuse](reports/2026-10-18-round5/diffuse.md),
[microfacets](reports/2026-10-18-round5/microfacets.md), [glass](reports/2026-10-18-round5/glass.md),
[dispersion](reports/2026-10-18-round5/dispersion.md).

**What the round showed.** One gap ran through five of the seven: "pick a direction with chance p and divide by p",
which chapter 12 teaches, came up in chapters 5, 8, 9, 10 and 11 as if known. It is now taught where a renderer
first picks a direction, chapter 8 (a pupil asked at random, the answer times 30), and the others point back to it.
Four readers also caught what was wrong, not just unclear, and each was checked before it was changed: the diamond
ball's rays "going round" (impossible: a ray bent in meets the far side at the same angle, below critical), the
diagram's edge crossing the whole map (the fitted curves fold back past 427 and 644 nm, and the edge was drawn from
380 to 700), PBR Neutral's "lift" of the dark tones (it takes 0.04 off them), and the grazing light that "loses more"
(it loses less, 17.76% against 19.88%).

### Chapter 5, Measuring light

| Finding | |
|---|---|
| "Divided by the sky's small chance" and "1 time in 66,111" with nothing behind them. | **Fixed.** The bounce's chance worked (0.0000672 × cos 45° / π); the rim bug said in words: a rare find counts for more. |
| "It has no length in it", against cd/m². | **Fixed.** What is meant: a scene twice as big, seen from twice as far, looks the same pixel for pixel. |
| Sections 2 and 3 lean on a closed fold-out. | **Fixed.** Its two answers, πL and πL sin²α, said in the text; the "pressing down" a glass dome with a light above it; the cap's area and radians said. |
| A quarter as many pixels, "39 whole and 61 at its edge, against 294 and 106". | **Fixed.** The covered area, counting edge pixels by share: 348.2 against 87.1. |
| "That number is both the sun's luminance and the chance of aiming". | **Fixed.** 1 − cos α is the solid angle and the aiming's chance; the luminance needs sin²α; both 64-bit. |
| "To a hundredth of a percent" against a row 0.07% off; the caption's "ten times the last" on a width axis that is not; "34,202 lux = 34,202 lux". | **Fixed**, each. |
| Dot and cross products, 2 sin²(α/2), the 360, "UB", "host". | **Fixed** in the excerpts' notes. |
| The panel's marks pointing away from the eye. | **Fixed.** A glowing line facing it. |
| Radiance and luminance cards defining each other. | **Fixed.** Radiance's card says it in square metres and steradians. |

### Chapter 6, Colour

| Finding | |
|---|---|
| The diagram's outline crossed the map, and the triangle's corners lay outside it. | **Fixed.** The fit's locus runs back on itself past 427 and 644 nm (380 nm landed at (0.028, 0.035)); the edge is drawn between those turning points, closed by the purples, and tested. |
| The 1500 K target "below the line from red to green". | **Fixed.** Past that edge, on the side away from blue. |
| Matrices, M⁻¹, Σ, "linear". | **Fixed.** Three weighted sums written out; the inverse "the table that undoes it"; the mix's three equations shown. |
| Why a mix lies on the line. | **Fixed.** An average of the two points, each counted by its X + Y + Z. |
| RGB above 1, blue's 35, the dashed bar. | **Fixed.** "At luminance 1" fixes the colour only; the 0.0722 check written; bars in the channels' own colours (a style drew green as grey). |
| Why clip only at the end; exactness's condition. | **Fixed.** Two lights clipped first give twice the green; exact through materials that treat the channels alike. |
| CCT and Duv before section 2; "square to"; Rec.709; u′v′ in the readout; "the user's luminaire". | **Fixed**, each. |

### Chapter 7, From light to pixels

| Finding | |
|---|---|
| Neutral's "small lift" of the dark tones, against its own readout (82 against 99). | **Fixed.** It takes 0.04 of white off every channel, less off the darkest. |
| The strip's "220 different values" against "all 256". | **Fixed.** The label counts the codes in the range, as the readout does. |
| "No darker than EV 12.43" when 15.87 is chosen. | **Fixed.** "At least EV 12.43 (no brighter)". |
| Stops, the log average, "18% grey", ISO. | **Fixed**, each: a stop at first use; 1 and 100 average to 10; the grey card, and the meter's 10.4%. |
| "The desk keeps its shape" at 4.4× white; the black step's 5% moving to the walls. | **Fixed.** Still over white, no longer 17×; the desk is 3.0% of a picture 60% black. |
| Why "none" bends; the orange turning yellow. | **Fixed.** The sRGB code on a log axis; one channel clipping before the others. |
| Why saved light needs no sRGB; 518,400; "six" curves; mix, select, acc, kept; the header while black votes. | **Fixed**, each. |

### Chapter 8, Diffuse and mirror

| Finding | |
|---|---|
| Brightness, intensity and luminance used as if their difference were known. | **Fixed.** Luminance (how bright it looks) and intensity (what the patch sends one way) said apart. |
| Throughput, paths, "divided by its own chance". | **Fixed.** A new paragraph: a path starts at the eye; pick at random, divide by the chance (the pupil example); throughput. |
| The fold-out's "must be ρ of 1" when the point gets π. | **Fixed.** Receives π, sends ρπ, looks ρπ/π = ρ; both true, so fπ = ρ. ∫ … dω said in words. |
| Fig. 2: no pixel numbers, which end is up, the dashed and red lines. | **Fixed.** The strip numbered, pixel 1 highest; shadow rays and blocked ones named. |
| Fig. 3: which pixels are the gap; "ground"; ±. | **Fixed.** The gap bracketed (pixels 17 to 19: the eye sees only its mouth), tested; background; the error bar said. |
| The flat world's 2.6; the blue lines the same whatever the lamp; makeMirror's specular; 1 against 1000 cd/m²; the lamp's 1; "march". | **Fixed**, each. |

### Chapter 9, Rough and shiny

| Finding | |
|---|---|
| "The grazing light hits more neighbouring facets", while its loss falls (19.88% to 17.76%). | **Fixed.** Less is lost there, said and tested. |
| "Two errors no straight-down test could see": the old table was wrong straight on too. | **Fixed.** The lede names the two without that claim. |
| Sampling and 1/p pointed at chapter 12, later. | **Fixed.** Chapter 8's rule; "draw" kept for painting, "pick" for the renderer. |
| The rim and the weight 2(1 − v). | **Fixed.** The rim is the most edge-on facets; the top tenth of the range gets ten times the points, each counting a tenth. |
| F₀, G₁, Λ undefined; the code's tan²θ; mfD against D. | **Fixed** in the fold-out and the notes; the anisotropy functions left out of the first excerpt (two excerpts now). |
| Fig. 2's bottom chart without a key; fig. 3's "the view" against "light". | **Fixed.** Keys in both charts; "the light" throughout. |
| The ≤ 1 stamp; roughness 1's warped grid no better; E's shape at 0.3. | **Fixed.** The claim holds before the compensation (up to 3.3× after); at roughness 1 the loss is not at a rim; 0.991 straight on, lowest near 85°. |
| GPU names, "rows", 946 × 1061, "aiming at the sun". | **Fixed**, each said. |

### Chapter 10, Glass

| Finding | |
|---|---|
| Diamond: "rays near its edge go round, reflected". | **Wrong, fixed.** No ray lit from outside is trapped in a ball; why, in two sentences; the rays cross inside at 0.704, marked; tested. |
| (1 − R)/(1 + R) with no working; why the random branch adds up. | **Fixed.** A fold-out sums the passes; each branch's chance divides out to 1. |
| 45.6% with "a depth of one thickness"; "channel". | **Fixed.** The slant makes the path 1.134 thicknesses: 0.5^1.134. |
| The medium excerpt was the opaque rule. | **Fixed.** `mediumBeyond`, the code that asks, with the opaque rule cited after it. |
| s and p unlabelled; Brewster; sunglasses; why r is squared; sin² + cos² = 1. | **Fixed**, each; a key in the chart. |
| The reflect/refract excerpt's names and frame. | **Fixed** in its note. |
| "As the test expected"; "then 0.25"; transTint still per crossing. | **Fixed**, each. |

### Chapter 11, Rainbows

| Finding | |
|---|---|
| "Yellow-green often", while the tallest bars are at 445 nm. | **Wrong, fixed.** Two humps, blue near 445 (its whole response in a few bins) and orange near 590. |
| "Chapter 12's rule again"; why (1, 1, 1) is white. | **Fixed.** Chapter 8's rule; white said. |
| How a reflection is "decided before"; colour noise. | **Fixed.** The reflect-or-refract pick at the yellow index, said; colour noise defined. |
| Red's 0.584 at a 600 nm edge. | **Fixed.** Each channel's response drawn under the strip; 41% of red's lies below 600 nm. |
| The white beam drawn orange; G grey; no key on fig. 2; "exactly, over the draw". | **Fixed**, each. |
| Abbe 0, "exactly F − C", select's order, PRNG, the tag's 32,766. | **Fixed**, each. |

## Round 6, 2026-10-18 (chapters 5 to 11, after round 5's changes)

A fresh reader a chapter again, the same brief. Reports:
[photometry](reports/2026-10-18-round6/photometry.md), [colour](reports/2026-10-18-round6/colour.md),
[pixels](reports/2026-10-18-round6/pixels.md), [diffuse](reports/2026-10-18-round6/diffuse.md),
[microfacets](reports/2026-10-18-round6/microfacets.md), [glass](reports/2026-10-18-round6/glass.md),
[dispersion](reports/2026-10-18-round6/dispersion.md).

**What the round showed.** Round 5's fixes held: the "divide by the chance" gap was gone wherever a reader met it,
though two asked for it worked with numbers, now done. What was left was mostly one step of reasoning said as a
fact (why a patch of sky lights a floor by its shadow's area, why the cosine pick has a π, why both faces of a pane
reflect alike), and three of round 5's own sentences that were wrong: chapter 9's "top tenth" of a range that is
its last hundredth, chapter 7's 18% grey "shown at 0.36" (it shows at 0.46), and chapter 5's "two sky-only rows"
with one listed.

| Chapter | Finding | |
|---|---|---|
| 5 | 348.2 pixels' worth against the readout's 294 + 106. | **Fixed.** The readout gives the covered area too. |
| 5 | Why a patch lights the floor by its shadow's area; why sin α; the small-angle steps. | **Fixed.** The patch's Ω, its slant and its shadow's cos θ match; the edge a ring at height cos α; sin² = (1 − cos)(1 + cos). |
| 5 | "Two edges to one sun" not followable; the /π and the 45°. | **Fixed.** The two ways to reach the sun said, and why the rim's bounce counted 10⁵ too much; the pick's /π; 45° from the ground and from straight up alike. |
| 5 | "Two sky-only rows" with one listed; radians first used before defined; the try-it already answered. | **Fixed**, each (the rows in metres and in millimetres). |
| 6 | What X, Y, Z are; the curves not the cones. | **Fixed.** The 1931 matching, its negative amounts, and what the curves are and are not. |
| 6 | "Only a screen has a ceiling" against a clip that leaves 10.5. | **Fixed.** The clip removes negatives; values over 1 are chapter 7's. |
| 6 | The mix on the line, the maps (xy, uv, u′v′), "far outside", the greenish swatch, two ringed dots, Y as lumens. | **Fixed**, each: a two-line proof in the fold-out, u and v's formulas, "just past its blue corner", yellow-green, D65 labelled. |
| 7 | Logarithms; "the brightest 5%" meaning where they begin; evHi; the fold-out's middle step. | **Fixed**, each: log₂ before the histogram, 541 / 4, the rule's algebra, L_white = 9.6 L. |
| 7 | 18% grey "at 0.36". | **Wrong, fixed.** 10.4% shows at 0.356, 18% at 0.46. |
| 7 | "Changes light little" against 82 and 99; "27" codes; the sun "off the scale"; the swatches' curve; v twice. | **Fixed**, each. The setting's comment also calls Neutral "linear to 0.76", now said beside the 0 to 2 it lists. |
| 8 | Why a matte bounce does not count a lamp it hits. | **Fixed.** The shadow ray already counted it; at a mirror there is none. |
| 8 | Why p = cos θ/π; how the cosine pick is made; the circle is the cosine; "u in the fold-out". | **Fixed.** The pressed disc run backwards (√u), the chances adding to 1, the angle in a semicircle. |
| 8 | "The gap shows (0.9963)", the average; the delta's "1 out of infinitely many"; the luminance and intensity cards. | **Fixed**, each. |
| 9 | "The top tenth … 0.99 to 1". | **Wrong, fixed.** The last hundredth, given a tenth of the points; the squeeze shown with 0.94 to 0.96. |
| 9 | Light against view; the two random numbers and the rim before section 2 uses them. | **Fixed** in section 1. |
| 9 | What E's loss counts; the fold-out's algebra; G₂ ≤ G₁; the lobe's scale; 0.991 against 0.997. | **Fixed**, each; the sphere's average marked inferred. |
| 10 | The branch weights with numbers; both faces the same R; sin θc = 1/n; the 4.5%; "every bounce" adding nothing. | **Fixed**, each. |
| 10 | WGSL's refract "returns nothing"; sin2T; exp and ln; the diamond's 0.852 beside 0.704; "meant to fail". | **Fixed**, each. |
| 11 | Why not three indices, or a wavelength for every ray; one pick worked through. | **Fixed.** Both asked and answered first; the 440-450 nm bin's weights, 0.21, 0, 2.79. |
| 11 | R for the reflectance and for red; §7's green reflections against "stay white"; the tag's formula; the gap's 0.00805 against 0.00806; 0.0029 of what. | **Fixed**, each. |
| 11 | The beam inside the prism orange; the excerpt stopping before acc grows. | **Fixed.** Inside drawn in ink; the excerpt to `acc += p`, read and stamped. |

## Round 7, 2026-10-19 (chapters 18 to 24, first read)

A fresh reader a chapter, the same brief, with each page's questions from `README.md`. Reports:
[caustics](reports/2026-10-19-round7/caustics.md), [photons](reports/2026-10-19-round7/photons.md),
[haze](reports/2026-10-19-round7/haze.md), [gpu](reports/2026-10-19-round7/gpu.md),
[wavefront](reports/2026-10-19-round7/wavefront.md), [accumulate](reports/2026-10-19-round7/accumulate.md),
[codegen](reports/2026-10-19-round7/codegen.md).

**What the round showed.** These chapters lean on earlier ones more than any before them, and every reader said so:
"sample", "NEE", "the flat world", "lane" and "resolve" were used as if known. Each page now says its own words
in a few sentences before it needs them, rather than pointing back. The readers also found five things the pages had
wrong, not only unclear:
- chapter 18 called a caustic seen through glass "missing from both" sides, where the engine's own comment keeps it
  on the camera's side, found by chance (`materials_pbr.js`, THE SPLIT);
- chapter 22 said a short budget only "costs convergence", after the flush's comment, while its own figure showed
  the picture darker;
- chapter 23 read the resolve kernel's `n == 0` return as the bug it once was, and `UB.maxaverages` as the setting
  it is not;
- chapter 24's section numbers were each one off;
- chapter 21's "bad" struct was described otherwise than its figure drew it.

And one bug in the kit: the excerpt locator cut a function whose parameters hold braces (`{ live } = {}`) at those
braces, so "the bake, whole" showed five lines.

| Chapter | Finding | |
|---|---|---|
| all | The excerpt locator stopped at a destructured parameter's brace. | **Fixed.** A `function` or `fn` symbol's body is looked for after its parameter list; a locator test plants the case. `baked` and `planBatches` re-read and stamped. |
| 18 | "Missing from both" against the camera keeping it. | **Wrong, fixed.** The page, figure 2's label and readout say the camera's, by chance, citing the split's comment. |
| 18 | "Nearly twice" against 0.738 / 0.313. | **Fixed.** About 2.4 times, both numbers given. |
| 18 | "Compare the open floor" with no open-floor number; the bracket reading under the open floor. | **Fixed.** The readout gives pixels 41 to 48; the bracket's mean explained (the shadow either side of the spot, the spot itself pixel 25). |
| 18 | Sample, ±, NEE, the flat world, "a rare find counts for more", Fresnel. | **Fixed**, each in a sentence; the second paragraph split in two. |
| 18 | Connections drawn like shadow rays; the dark pixels; "pixel 1 looks highest". | **Fixed.** Connections dashed (`pen.ray` takes a dash); the sky and the ball marked under the strip. |
| 18 | The 20% floor invisible; "learning" reading like "uniform"; 40 times from 0.963 / 0.160. | **Fixed.** The floor dashed across the bars; the readout says the sample was sent evenly; (0.963 ÷ 0.160)² ≈ 36, which the entry calls about 40. |
| 18 | `camFootprint` opaque. | **Fixed.** Annotated line by line in its note. |
| 18 | The narrow and wide screenshots look alike. | **Not changed.** At 400 samples the difference is the ± (0.106 against 0.022), which the readout gives. |
| 19 | The budget paragraph: share, m, 24. | **Fixed.** In steps: share = 512 ÷ 8, m = 32 × share ÷ count, 24 = 32 × 6 ÷ 8. |
| 19 | The double count shown only as its fix. | **Fixed.** Both ways it would happen, then the rule. |
| 19 | Chapter 18 assumed; caustic and photon unmarked. | **Fixed.** A recap paragraph; both marked at first use. |
| 19 | r = 0.06 and pixel 25's 0.72 not in the "with" paragraph; why the pane's mean barely moves; does the old way get there. | **Fixed**, each. |
| 19 | Fold-out 2: ∝, variance, the exponents, the sums. | **Fixed.** Both words defined, exponents bracketed, the noise's 1/r in a line, a table of the radius with α = 2/3. |
| 19 | The gather loop's `continue`s; where ÷πr² happens; `select`; the +1 heads. | **Fixed** in the excerpts' notes. |
| 19 | Fig 3: the orange ticks' meaning; the header over "gather here"; cell −3 against "cells −11, 1". | **Fixed.** A key; the header moved up; the label names the cells with photons. |
| 19 | §5's "checked" numbers; the uniforms.schema sentence; the irradiance card per square metre. | **Fixed.** A table (CHANGELOG 0.61.3's, re-read); the sentence rewritten; the card says per metre in the flat world. |
| 19 | The negative cell's remainder. | **Fixed.** `hashCell` read: the product unsigned, its last bits. |
| 20 | Why free flight works; "not divided by anything". | **Fixed.** 1 − u = e^(−t/mfp) solved; 37% of the rays carrying everything is 37% of the light. |
| 20 | The flat world, leg, sample, ±, MIS, f cos θ. | **Fixed**, each in a sentence. |
| 20 | Every drawn shadow ray red; "the 0.003 elsewhere"; the floor changing between modes; the bracket's label. | **Fixed.** One shadow ray from the beam drawn, reaching the sun; 0.0033 named; the eye's line through lit dust; the label under its bracket. |
| 20 | The furnace's 1 against 1000; "noise 0" as a clue. | **Fixed.** The bench's sky said to be 1000, the stamps as shares of the no-box reading; the clue said. |
| 20 | The ^3/2; g = 0; the 15° peak; the march figure's red step and label. | **Fixed**, each; the peak is 14°, worked out. |
| 20 | The code: hazeC.w, r.n, absLtot, b1 and b2, the shadow's length; the :258 citation. | **Fixed** in the notes; the citation says it is the function's comment. |
| 21 | Lock-step group against workgroup; lane; who decides the width. | **Fixed.** A lane card; the workgroup and lock-step cards say how they relate; the figure's width is "only to show". |
| 21 | Alignment never stated; the "bad" struct's words against its figure. | **Fixed.** A table of sizes and alignments (a new `table.data`, and `extract.mjs` writes tables); the padding as drawn. |
| 21 | "Over a second" hanging under a 2 s limit. | **Fixed.** As PERFORMANCE.md has it: the march rolled up that week may have made it slower, inferred. |
| 21 | "Stopped working at 4,194,240"; 2048² called 4K. | **Fixed.** Worked up to it; 4K said as 3840 × 2160. |
| 21 | Fig 3's rows too short to see; the readout cut off. | **Fixed.** Each bar's number over it, the axis shorter for rows; the readout shorter. |
| 21 | The barrier's why; bind; device; BI and V3U; "five a round". | **Fixed**, each; the kernel card corrected (about eight a round). |
| 21 | The rays-in-flight comment a wall of versions. | **Fixed.** A claim with a citation instead, and the old 4 M rays a story in §6. |
| 22 | Iteration 15: 47 + 1 + 7 = 55, not 56. | **Fixed.** The readout counts the ray that ran out of steps. |
| 22 | "Costs convergence" against a darker picture; what "cut" keeps. | **Fixed, then corrected in round 8.** This round called the flush's comment wrong; the figure's model did not yet follow the engine's resolve (below). |
| 22 | "Nothing measurable" against the tail's 45%. | **Fixed.** The gaps between kernels against the nearly empty kernels themselves: latency, as §10.2 says. |
| 22 | The worst case in one sentence; the drop at 12; 523 from 774; why occlusion lags. | **Fixed**, each: a path of three legs walked; the cap at iteration 11; the sun above the surface; the two sides of the shadow queue. |
| 22 | Prep dispatches are direct; "a few workgroups" for 56. | **Fixed.** |
| 22 | Fig 1: the slider's "0: the worst case"; no picture; the tail step the same as the first. | **Fixed.** The slider in iterations, 24 marked; the picture as a strip; the tail shaded. |
| 22 | Fig 2: the dispatch sizes always empty; no prep step; the flip's shade queue. | **Fixed.** The sizes written so far always shown; a prep step; the shade queue cleared at the flip. |
| 22 | Lanes not explained here. | **Fixed** in a sentence, pointing at chapter 21's figure rather than drawing it again. |
| 23 | What a sample is; the two buffers; resolve never named. | **Fixed.** An opening paragraph, with the running average worked. |
| 23 | Line 418's return against §6; `maxaverages` 0. | **Wrong, fixed.** The excerpt now starts at the comments that say the words are taken first; the note says the host writes the capped count. |
| 23 | 65,535; u32, f32, word, WGSL. | **Fixed.** 2³² − 1 at 65,536 a unit; each word defined. |
| 23 | Batches dividing by the whole count; photons before gathers. | **Fixed.** |
| 23 | Fig 3's clipped title and "the first 1 photons only"; fig 2's "kept to"; e-notation; fig 1's "struck", steps and rounds. | **Fixed**, each (numbers as 4.1 × 10⁻⁵). |
| 23 | "Contention is low" against the crowd; §5's title; 2.3 million against 2,164,802; negative luminance against a negative channel; 537 MB. | **Fixed**, each. |
| 24 | Section references one off; "the bake, whole" five lines. | **Wrong, fixed** (the second by the locator). |
| 24 | Fig 1's counter against its caption; the add step undoing the move. | **Fixed.** Each way counts its own compiles; the steps are one story. |
| 24 | "Two new lines" with one marked. | **Fixed.** One line and two uniforms; the test holds the one. |
| 24 | "At about 151,000"; the curves crossing. | **Fixed.** The model's formula, and where it meets the straight line. |
| 24 | Folding; why data costs a step; uncached; "never" a compile. | **Fixed**, each: the bake's names, ARCHITECTURE's steps and records a step, the browser's cache measured, the loop's kinds. |
| 24 | The 58-line WGSL excerpt. | **Fixed.** Trimmed to the sphere's child and the join, said to be figure 1's line grown up. |
| 24 | Named scenes, 1080 Ti and Pascal, vec4s, 32 twice. | **Fixed**, each. |

**Engine findings from this round**, reported to the user and not edited here:
- PERFORMANCE.md's Noise library sample "over a second" sits beside a hang under a limit of about 2 s, explained
  there only by an inference.
- (This list first named the flush's comment as wrong. Round 8 withdrew that: see there.)

## Round 8, 2026-10-19 (chapters 18 to 24, after round 7's changes)

A fresh reader a chapter again, the same brief. Reports:
[caustics](reports/2026-10-19-round8/caustics.md), [photons](reports/2026-10-19-round8/photons.md),
[haze](reports/2026-10-19-round8/haze.md), [gpu](reports/2026-10-19-round8/gpu.md),
[wavefront](reports/2026-10-19-round8/wavefront.md), [accumulate](reports/2026-10-19-round8/accumulate.md),
[codegen](reports/2026-10-19-round8/codegen.md).

**What the round showed.** Round 7's fixes held where a reader met them: each quiz was answered from the page, the
recaps were used, and no reader asked again what a sample, NEE or the flat world is. What was left was smaller, a step
not shown or a number that did not add up. Following one of those up found a real error, not in the words but in a
model.

**A model that did not follow the engine.** The wavefront reader asked why the shade queue at iteration 15 holds 48
when 49 rays stop. In the engine a ray out of steps goes to shade (RAY_MAXITER), and the figure's model ended it in the
march; fixed. Checking what shade then does with a path on the last pass turned up the larger one: a path hands its
light in only when it ends (wavefront.js, THE PATH IS OVER), so a path cut on the last pass hands in nothing, is not
counted, and resolve leaves its pixel's sample out when no path there ended (chapter 23's n). The model had counted
those paths as darker. With the engine's rule, over 20 runs of the sample, the mean holds at 12 and 10 iterations and
falls 4% at 8, 14% at 6 and 30% at 4: a short budget costs mostly samples, as the flush's comment says, and at very
short budgets light, through the flushed paths' untraced legs. Round 7 had called that comment wrong; the page and the
record now say what the model shows.

| Chapter | Finding | |
|---|---|---|
| 22 | 48 in the shade queue against 47 + 1 + 1 stopped. | **Fixed** in the model: a ray out of steps goes to shade, as the engine's does. |
| 22 | (Found following it.) Cut paths counted as darker. | **Wrong, fixed.** Resolve's rule in the model; the text, the readout (paths counted, pixels with none outlined) and the 20-run averages, held by the test. |
| 22 | How the last pass's extra rounds are decided without counts; why not read the counts back. | **Fixed**, each: a fixed number from the settings; a read waits on everything before it. |
| 22 | "Nothing is cut" at the worst case, though shade skips NEE on the last pass. | **Fixed.** A path needs at most 23 passes; the 24th traces the 23rd's shadow rays. |
| 22 | The clamp said to be in the prep kernel shown; the shadow bars' zig-zag; "18 new legs" from 47 hits; "the user chose". | **Fixed**, each (the occlusion's prep kernel; floor and ceiling in turn; 29 at the bounce cap; ShadyTracer's user). |
| 22 | Pass, iteration and round; 32 lanes and 32 steps; thread, buffer, kernel, workgroup, normal unmarked. | **Fixed.** One word said; the two 32s by chance; each marked. |
| 18 | Light tracing's "nothing else" against 0.007 on the open floor; 0.388 against 0.395. | **Fixed.** The ball's reflection, a caustic of its own; the camera finds it by chance. Held by the test. |
| 18 | 2.4 times unexplained; why a find is worth 85, and 85 once in 220. | **Fixed.** 0.282 on 0.455; 106 × 0.8; 85 ÷ 220 ≈ 0.39, the glass moving light, not adding it. |
| 18 | "The floor of 20%" in a scene with a floor; the line invisible when learned. | **Fixed.** A minimum share; its label says when it is too thin to see. |
| 18 | ρ, the second cos θ, illuminance held, 45° after 75°, "about 40". | **Fixed**, each. |
| 19 | Section 4's WGSL names; the n² excerpt. | **Fixed.** An outline of storing and gathering first; each name glossed; radiance and n² said. |
| 19 | The fold-out's noise algebra and unequal variances; why blur ∝ r². | **Fixed**, each shown. |
| 19 | A worked hash; hashCell and sppmHash; 2 × 2 × 2. | **Fixed.** Cell −3 to list 1 in numbers. |
| 19 | Screenshots at fewer samples than the text; the log axis; faint and walked orange alike; the exact map's 0.894. | **Fixed**, each. |
| 20 | Why exponential; ln; "the us"; the exponent's brackets. | **Fixed.** The same share stopped per unit; ln undoes e. |
| 20 | Bounces only: wrong or slow; surfaces in both modes; pixel 9. | **Fixed.** Slow; both modes aim from surfaces. |
| 20 | Stone and slab; the furnace's black disc red; covered labels; the shadow ray in thick dust. | **Fixed.** Named; the disc in its albedo's grey; labels moved; "dimmed". |
| 20 | "1e-30 … no particle" against the code's −1; hazeAt and r.beta; σ_s, w, heavy tail; the 3D controls against the flat ones. | **Fixed**, each: 0 not drawn, −1 none; different scenes, not meant to match. |
| 21 | Workgroup against lock-step group in the text; [8, 8, 1] against rows of 64. | **Fixed.** A workgroup of 64 as two of 32; resolve's are 64 × 1 (read in code), the 8 × 8 only the library's default. |
| 21 | Card models, "profile", the hang. | **Fixed.** The two machines named; the hang said plainly. |
| 21 | 1.7 GB against today's sizes; 590 MB over 256 MB. | **Fixed.** The sizes of the time; why the program still asks for large buffers. |
| 21 | "Compiled off the page's thread" stamped code but saying a time; the second "thread". | **Fixed.** The time removed (the measured stamp has it); the main thread said. |
| 21 | An index example; vec3 of u32; typeInfo walked; i32, matrix, 1080p, GiB. | **Fixed**, each. |
| 23 | Path, shadow ray, photon, kernel; "card"; the window and EMA; resolve's n. | **Fixed.** An opening paragraph each; "graphics card"; a paragraph on the window, the reset and n = 0. |
| 23 | Figure 1's stores; the average's example; 25,000 exact or not; absolute and relative error; "1 rounds". | **Fixed**, each (S6 written in the box; 3, 5 and 10). |
| 24 | Figure 2's fractions of a second against real builds' seconds. | **Fixed.** What a real kernel carries, and builds in parallel. |
| 24 | SDF, march and step assumed; the matrix; XF_SUB, select's test, hs/hsa/hsb; the blend's three names; "the next record is in this one". | **Fixed**, each (the engine's records nest and skip: `scenedata.js`'s record layout). |
| 24 | Long lines cut; b, c, h, e; kind and join codes; UB; "1 copies"; 6,794 below 6,795; "runs faster" on the card. | **Fixed**, each: the lines wrap. |
| all | Sections 4 to 6 written for a developer. | **Not changed** beyond the glosses: those sections are where the page meets the code, and say so. |

## Round 9, 2026-10-19 (chapters 25 to 33)

The chapters of Part VII, each read twice, by a fresh reader each time, on the same brief. Reports:
chapter 25, [first](reports/2026-10-19-round9/measure-1.md) and [second](reports/2026-10-19-round9/measure-2.md);
chapter 26, [first](reports/2026-10-19-round9/steps-1.md) and [second](reports/2026-10-19-round9/steps-2.md);
chapter 27, [first](reports/2026-10-19-round9/compiles-1.md) and [second](reports/2026-10-19-round9/compiles-2.md);
chapter 28, [first](reports/2026-10-19-round9/feel-1.md) and [second](reports/2026-10-19-round9/feel-2.md);
chapter 29, [first](reports/2026-10-19-round9/checking-1.md) and [second](reports/2026-10-19-round9/checking-2.md);
chapter 30, [first](reports/2026-10-19-round9/precision-1.md) and [second](reports/2026-10-19-round9/precision-2.md);
chapter 31, [first](reports/2026-10-19-round9/optics-1.md) and [second](reports/2026-10-19-round9/optics-2.md);
chapter 32, [first](reports/2026-10-19-round9/yours-1.md) and [second](reports/2026-10-19-round9/yours-2.md);
chapter 33, [first](reports/2026-10-19-round9/open-1.md) and [second](reports/2026-10-19-round9/open-2.md).

### Chapter 25, Measure first

**First read.** The teach-back held the chapter's argument. Two figure steps showed nothing new: *Every scene* came out
as *One scene* in the screenshot, and *readings* was the same state as *separate*. The words a beginner lacks were
"sample" (used for a whole section before its card), the kernels' names, and compute pass. The reader also asked why
rounding averages out, and how the reliefs' rows add up to the scene's time.

| Finding | |
|---|---|
| "Sample" used before it is said. | **Fixed.** Said in section 1's first paragraph, with its card. |
| Kernel names, compute pass, dispatch never explained. | **Fixed.** A sentence each, before the figure. |
| Why one rounded pass is wrong and many are right. | **Fixed.** A fourth view, *One pass, rounded*: a pass dragged across a tick, its two rounded stamps, and 10,000 random placements averaging its length (`oneRounded`, held by the test). |
| *Every scene* screenshot showed one scene; *readings* the same as *separate*. | **Fixed.** The first was not reproduced: nothing in that figure changed, and the next extraction showed every scene (inferred: the extractor's timing). *readings* is a view of its own: the four readings, their range and spread. |
| The reliefs' rows add up to 565 ms, not 736.5. | **Fixed.** The run's own note: alone the six add 484 ms, together 655; it records the difference and does not explain it. Held by the test, and the rows' names by the frozen scene's amount and size. |
| "Chrome documents 100 µs" against the run's 32.768 µs. | **Fixed.** Chrome 154 in run 5 read 32.768; the notes do not explain the difference. |
| The gap 0.4 against the rounded 0.20; "a tenth of a millisecond each over 24 passes"; prep_occlude 0.2. | **Fixed**, each: the rounded gap said; the 24 passes together; what it read and what it took. |
| ±20%, 9.3%, 16%, 38%: four measures; "points". | **Fixed.** Range and spread defined; a point is one percent. |
| Pascal and GTX 1080 Ti. | **Fixed.** Said once, where the card is first named. |
| Figure 3's axis; the 0 line; the readout's 5 points against the text's 2. | **Fixed.** Labelled; the readout gives both. |
| "Free" in the code against "nothing visible". | **Fixed.** The stamp now says the header's "not free" and why it does not show. |
| Opaque words in the excerpts (query set, descriptor, mappable, overflow, schema default, uncached compile, the hash's constants). | **Fixed** in each excerpt's note. |

**Second read.** Clearer: the tick view was "the best figure on the page", and the quiz was answered from it. What was
left was a set of precise objections, each right.

| Finding | |
|---|---|
| "Range" meant highest over lowest in section 3 and highest less lowest over the mean in section 5. | **Fixed.** One meaning, highest over lowest (section 5: 9.7%, the notes' 9.3% of the mean named as theirs). |
| The 16% not reproducible from "the usual distance from the mean". | **Fixed.** The sample standard deviation, said step by step (`driftSpread`). |
| The model's 1.5% within a run against section 5's 9.3% within a run. | **Fixed.** Rows next to each other (0.38%, 1.3%) against rows far apart; how A, B, A, B becomes one number. |
| The 32, 128 and 400 steps never reconciled; budget, worst case, "cut short". | **Fixed.** Said once in the budget story: 400 steps in all, 32 an iteration, 11 legs, the worst case 24, 128 making it 15. |
| *stamps* the same screenshot as *passes*. | **Fixed.** It marks one march pass's two stamps in nanoseconds. |
| Red for genrays and resolve and for "read as 0"; surface's purple not in the caption; occlusion and the prep kernels both grey in some styles. | **Fixed.** Genrays and resolve in ink, the small kernels teal; the caption names every colour. |
| The rounded step's prep_march 0 and prep_occlude 0.2 not shown. | **Fixed.** In the readout, beside what they took. |
| 4.33 against 4. | **Fixed.** Said: an average of random draws wobbles round the truth. |
| Section 2's kernel list too long for a beginner (the first reader wanted it). | **Shortened**, not removed: one sentence, the work kernels named by what they do, the four small ones together. |
| Section 6's stories too dense. | **Partly.** The budget story rewritten with its numbers; the others keep their length and citations, as every chapter's section 6 does. |
| Why a fine clock is dangerous; WebGPU itself. | **Fixed**, briefly: a page timing other code; the browser's way of handing the card work. |

### Chapter 26, Fewer and cheaper steps

**First read.** The teach-back held all three ideas and the quiz was answered from the page. The reader caught two
real contradictions: figure 2's P sat where the box's distance was less than the lens's formula, beside a sentence
saying it could be more; and the step cache's "first fill" meant the lazy fill in one section and the fill from the
copy with boxes in another. Both are fixed, and the first was a finding about the chapter's own claim: writing the
test against the true distance (not the scene's own bounds) is what showed that a box's distance can be more than a
lens's formula, or a relief's divided field, both underestimates, and never more than the truth.

| Finding | |
|---|---|
| Figure 2: the scene answers 1.500 where the formula says 1.524, beside "can be a little more". | **Fixed.** P starts above the lens's tip, where the box answers 0.900, the formula 0.820 and the truth 0.901; the page says why the formula is short there. |
| Two different "first" fills. | **Fixed.** The lazy fill came first, filling from the copy the rays march; 0.33.0 added the fill once, and the fill from the copy without boxes (`CHANGELOG.md`). |
| "A gain on the optics benches only" against the showcase's −10%; "three other scenes 6 to 10%". | **Fixed**, both: each scene named with its number, and which were within the run's resolution. |
| No view of a ray leaving an off-centre ball. | **Fixed.** The *own cell* step draws one jump with its ball, where the ray leaves it, and the 0.9 step. |
| "Card" read as the glossary's card; scene names never introduced; "pass"; "a quarter of its blend"; "1.875"; groups dear without why. | **Fixed**, each: graphics card; the bundled scenes said once; a march pass's 32 steps; the blend's k; the layers' strengths added; a group is several shapes or code. |
| 17.2 called measured, then "a measured bound is not a proved one" for 11.2 only. | **Fixed.** Both are measurements; the proved bound is four times larger. |
| The reliefs look like circles; *shelled* the same as *dear*; the floor's box never mentioned. | **Fixed.** Said that the bumps are too small at that scale; the shell drawn dashed; the floor has no box. |
| Orange glow against grey cells; no visible change around the boxes; the grid larger than its dotted box. | **Fixed.** The renderer's view is orange, this one ink; the cells the copy with boxes shrank marked; the grid drawn as rounded up. |
| codegen's CULL line not shown; cullDist's last line; SC_LOOKS, k, select; "towards its 400". | **Fixed** in the notes; the line written out. |
| "Noise" for the bumps and for a run's scatter. | **Fixed.** A run's resolution, not its noise. |
| *divided*: the 2.6 not visible in the circles. | **Fixed.** A dashed circle shows the room the first step really had. |

**Second read.** The quiz answers were right except one ambiguity left from the first round's fix, and the reader
found the sentence the chapter's argument most depends on misleading: "a box's distance in place of what it holds",
read as putting the box's distance into the join, would make the lens figure impossible. The code does something
else, and the page now says it: a skipped object leaves the union, and the nearest skipped box's distance caps the
answer at the end.

| Finding | |
|---|---|
| Substitution against leaving the join; why min is safe and max is not. | **Fixed.** What the code does, and the two lines of why: leaving a term out of a smallest can only raise it, and the cap brings it back under the box's distance; leaving one out of a largest lowers it to 0 on the other's surface. A subtraction is a largest-of-two too. |
| The intersection card says its distance is the larger of the two. | **Fixed.** The card says it is a formula, never more than the truth and less where the nearest point is a corner. The figure's readout gives the lens's true distance (computed to its outline, its tips exactly; held by the test). |
| 17.2 = 4 × 4.3 needs each layer to be as steep; why ÷ 1.875; can today's relief leave holes? | **Fixed.** Half as tall and twice as fine; the height shared among the layers; both bounds measured, the proved one four times larger, and the test that searches for steeper. |
| "One for every object at every step" against 4,730 = 5 × 946. | **Fixed.** Every boxed object; the floor has none. |
| "Both had" the orange shell, for a fill 0.33.0 introduced and fixed. | **Fixed** (already, after the first read's screenshots were made): 0.33.0 added the fill once and the fill without boxes. |
| 216.6 against 202.3 for the Noise library with boxes. | **Fixed.** The same run's first timing and its timing again beside the shell's row: the drift of chapter 25. |
| "Solid" circle drawn dashed; P's circles leave the frame; the box's label over the tip; the third ray in the blend. | **Fixed**, each (the style's dashes for its colour removed; a taller figure; the label beside the box; the ray named). |
| The shell's edge dashed like the boxes; the cache's jumps dashed like outlines; the shell figure's label over the eye. | **Fixed.** The edge purple and solid; the jumps solid; the label at the foot. |
| "Dear", pass, kernel, uniform, pick and render copy without cards. | **Partly.** "Dear (costly)" said; kernel linked; pass explained in the sentence. Pick and render copy are said where used. |
| Card timings repeated across sections. | **Not changed.** Each section gives the number its argument needs; section 6 gathers them stamped, as every chapter does. |

### Chapter 27, Faster compiles

**First read.** The teach-back held the chapter: compiles off the page's thread, all at once, only what changed, a bar
by the clock. The reader's main gap was the premise: why a scene is text inside a program at all, which the page
pointed to chapter 24 for and did not say. And a number was wrong: the session figure's caption gave the surface
kernel 200,000 characters, where the model has 160,000 in that scene, which is why the reader's own sum (15.2 ms ×
200 = 3.0 s) did not match the figure's 2.48.

| Finding | |
|---|---|
| Why a scene is in a kernel's text; a move only a number. | **Fixed.** Said in the lede. |
| The surface kernel appears from nowhere; 13 kernels, then 16. | **Fixed.** Introduced with 0.20.8; the counts said where they change. |
| The caption's 200,000 against the figure's 2.48 s. | **Fixed.** 160,000 in scene A; under and over 151,000 the model's per-thousand differs (chapter 24). |
| Shade 10.7 s in figure 1 and 11.4 s in the text. | **Fixed.** Two runs of two versions, said. |
| Texts seen before "2.0 and 0.56 s" against the figure's 0.0. | **Fixed.** The builder's whole apply, not a compile. |
| Figure 2's colour key; every column filled at the first step; both toggles in one step. | **Fixed.** The key per colour; steps not reached drawn faint; the cache off has its own step. |
| "At most twice"; the browser's cache against ShadyTracer's. | **Fixed.** At most doubles; the browser keeps compiled kernels across a reload, the pipeline cache lives in the page's memory. |
| Why kernels compile side by side; why all at once is half a second over shade. | **Fixed**, both stamped inferred: several cores; the small kernels sharing the processor. |
| Driver, promise, pipeline used before their notes; "the user"; e. | **Fixed.** Each said at first use; e replaced by "to about a third". |
| "Eight builds" against seven and a reload; the readout's nine tenths of the prediction against the build. | **Fixed**, both. |
| Too many numbers for one scene; section 6 repeats. | **Not changed**: each number is the one its sentence needs, and section 6 is every chapter's record of what went wrong. |

**Second read.** The teach-back held again, and the quiz was answered from the page. The reader's gaps were what the
first read had not reached: what each of the sixteen kernels does, chapter 24's model, which the bar rests on, and the
words of section 5. Checking one paragraph against the code found it wrong: before 0.10.0 only four of the kernels
that hold no scene declared its uniforms (the 0.10.0 entry, `genrays.js`), not all sixteen, and the figure's switch
had modelled every kernel. The reader's own complaint pointed at it: the "before" step had the cache off too, so it
looked the same as the step before and could not show what its paragraph said.

| Finding | |
|---|---|
| The sixteen rows unexplained; which is the photon map. | **Fixed.** A table of every kernel's job, grouped, `sppm` named the photon map; pointing at a row says its job. |
| Chapter 24's model not recapped; why 151,000; the 1.37. | **Fixed.** A note in section 3: the formula, the size where its last factor is 1, twice the size 2.6 times the time. |
| The rate's blend never worked through. | **Fixed.** A fold-out: the table from 15.2 to 30.28, the reload thrown out by the quarter rule (0.51 s is over the 300 ms floor), the doubling cap. The test holds every number. |
| The "before" step looks like "no cache"; the caption's "turn off". | **Fixed**, and the claim under it: the step is the cache on with the four kernels declaring the scene's uniforms, scene B compiling seven, not three; the four are those 0.10.0 changed. The repeated sentence is gone; the caption names the choices. |
| "12 of 13" against the figure's "of 16". | **Fixed.** The old bar is drawn over 0.9.2's 13 kernels, when it counted them: 85% after a second, 12 of 13 at nine tenths. |
| "Nine sequential awaits" against 13 kernels. | **Fixed.** Nine is the comment's count, with no date; figure 1's version built 13. |
| The sixth build within 2% against the readout's seventh. | **Fixed.** The readout gives build 6 (−2%) and build 7. |
| "The user" two ways; the GTX 1080 Ti and Pascal; versions. | **Fixed.** Once, in section 1: ShadyTracer's developer, the 1080 Ti a Pascal card, the middle number counting up. |
| Hiding a node: builder, node, apply; which number is which. | **Fixed.** The builder has a glossary card; the part shown again and hidden again, each with its two times. |
| Section 5's device, row, trace, frame, dispatch, data, node. | **Fixed.** Each said in its item, or the item reworded. |
| Section 1's last paragraph and section 3's learn paragraph overloaded. | **Fixed.** Split, three and three. |
| The bar's words in no screenshot. | **Fixed.** The readout gives them at 7 s and at nine tenths. |
| Excerpts 2 to 5's names (`setResources`, `forCompute`, `finalCode`, `!(…)`, `exp`). | **Fixed.** Each in its note. |

### Chapter 28, Feeling fast

**First read.** The teach-back held sections 1 to 4. The reader found the chapter's first figure at odds with the
code it quoted: the governor settles at 2 samples a frame at 20 ms, but the live view's slice of 30 ms holds a light
scene to the samples that fit it, one at 20 ms and six at 5. The figure had shown the governor alone without saying
so. The excerpts of `makeInteraction`, `effective` and `runSamples` were bare signatures: the locator stopped
`export function` excerpts at the braces of their parameters, a fix round seven had made for `function` alone.

| Finding | |
|---|---|
| Figure 1 against the slice's cap. | **Fixed.** The slice is a choice and a step of its own (6 a frame at 5 ms, the count held at one more); the first steps say they show the governor alone. The test drives the real `render-loop.js` told what each frame traced (`opts.done`) and holds the figure to it, and holds the cap to `raytrace_main.js`'s line. |
| "Iteration" undefined; 150 ms against the figure's 133. | **Fixed.** Chapter 22's rounds, at most 24; the cut every 5 (24 × 150 / 667 = 5.4), about 139 ms each if iterations cost alike, the last 4; the white lines drawn there. |
| "Over a second" hung at "about 2 s". | **Fixed.** A frame was one submission; how long the frame that hung ran was not recorded. |
| The 50–57 ms gap: what is the other 40? | **Fixed.** Not measured; the engine's comment guesses the browser preparing one long submission; the figure models only the recording, so the saving it shows is less than was measured. |
| Why a small batch leaves the card idle; why 0.1 is not exact; why a move resets. | **Fixed**, each in a clause: lanes (chapter 21), a tenth has no binary fraction that ends, a sample of the old view smearing into the new. The guard asked before the step. |
| Section 6 shorthand: the hold, the queue, "the library". | **Fixed.** Rewritten plainly; WEAVESIM named; the builder and the benchmark said. |
| The signatures; `want` → 34 and the floor → 57 not pointed out; no submission code. | **Fixed.** The locator passes the parameters of exported and async functions (a test); the slicing note points at both; the split's lines excerpted. |
| Figure 2's axis "12 s". | **Fixed.** Seen in the screenshot: the hand-lettered style's full stop all but vanishes, so 1.2 s read as 12 s. The ticks are set in the mono face. |
| Rows of figure 2 (chapter 27) clipped at the left; the bar's key over its line. | Found looking at this round's screenshots, not by a reader. **Fixed**: a shorter mark, the key moved below the line. |

**Second read.** The teach-back and quiz held, the cap's step included. The reader then did the arithmetic the page
invites and found two sentences wrong. "No fewer than 16,384 rays": the code caps the batch count at the rays over
16,384 *rounded up*, so 921,600 pixels make 57 batches of about 16,168 rays, a little under the floor (the engine's
own comment says "nor batches under", which its arithmetic does not quite keep: reported, not changed). And "at
most 24 iterations a sample": every batch runs them all, 24 at the default settings ((10 + 1) bounces and
ceil(400 / 32) march chunks) and 38 at High quality; 24 is the most the split spreads a batch's time over.

| Finding | |
|---|---|
| 57 batches of 16,168 rays against "no fewer than 16,384". | **Fixed**, as above; the figure's label gives the rays a batch. A test holds the rounding up to the code. |
| "At most 24 a sample" against 24 a 667 ms frame. | **Fixed**, as above, with 667 / 24 = 28 ms and 150 / 28 = 5.4 written that way round. |
| Kernel, iteration, lane undefined. | **Fixed**: the kernel and lane cards linked, the iteration said where it is used. |
| The cap step: a 30 ms slice and a 35 ms frame; why one more. | **Fixed**: the slice is the samples' time, not the frame's; why near what is traced, in the code's words; why one more, the code does not say. |
| Figure 1's 60 at the start and its 200 fps spikes against the browser's 60. | **Fixed** in the caption: the model's first frame and a 5 ms frame; a browser shows 60 at most. |
| The constants and the nested ternaries of the split's excerpt. | **Fixed** in its note. |
| "In flight", recording against the card; what the Noise library and materials are. | **Fixed**: a washer and a dryer; two of the scenes that come with ShadyTracer. |
| "Gentle where it does not matter…" never unpacked; why today's rule settles. | **Fixed**: one sample more is half again at 2, a fortieth at 40; 22 is inside the band. |
| Dates, card names and "not measured" in every paragraph. | **Not changed**: each says how a number is known, which is the rule these pages keep (CLAUDE.md); the stamps in section 6 carry the rest. |

### Chapter 29, Noise, bias and checking

**First read.** The teach-back held: noise fades and the error bar sees it, bias stays and the error bar cannot; a
check needs a control; the error bar can itself be checked. The reader's gaps were the arithmetic behind section 3
(how V and S make the error bar, why 1/S counts samples, where w/(2 − w) comes from, why squared differences of
neighbours must equal the sum of their squared error bars), and a figure that contradicted its own text: the corner
drawing showed the same orange path, one that finds the lamp after two bounces, as counted whether or not the cap was on.

| Finding | |
|---|---|
| Section 3's arithmetic. | **Fixed**: a fold-out, each of the four worked. |
| The corner drawing the same for every reading. | **Fixed**: a lamp leg drawn as the reading counts it, counted, cut (dashed) or clamped, with a key; a test holds the rule. The eye labelled. |
| Where 7 and 4.9 come from; NEE, MIS, albedo, kernel undefined. | **Fixed**: 0.7 × 10 and 0.7² × 10; the cards linked and each said in a phrase. |
| "Dashed" for the error bars and for the true value. | **Fixed**: the true value is solid. |
| "4 of 4 rows" beside five; no tolerance; why 0.85. | **Fixed**: "the rows above the control"; within 2% (this picture's own noise); 0.25 + 0.75 × 0.8. |
| 1000.000244 against the figure's 1.0000. | **Fixed**: a sky of 1000, a ratio of 1.000000244. |
| "Each row must read 1", then the grey 0.85. | **Fixed**: a row of a white material must read 1. |
| The consistent kind inside the window's paragraph. | **Fixed**: a paragraph of its own. |
| Two error bars and 95 in 100 used in Try it, never said. | **Fixed** in section 1. |
| The check-shaders excerpt out of place. | **Fixed**: introduced as another check that could pass without checking. |
| measure.js's V line; the seRatio excerpt's a, f, w, sen. | **Fixed** in their notes. |
| Rough glass told three times. | **Fixed**: once, in section 6; section 5 points there. |
| 1.0068 passes while metal's +0.02% is called a bias. | **Answered** in the text: this picture's ratio spreads by 0.4% from run to run (computed over 200 runs), so 2% is five of those; ShadyTracer's pictures have a million pixels; a bias is told from noise only against the noise. |

**Second read.** The teach-back and the quiz came out whole. The reader then asked what the first had not: why the
error bar divides by 1 − S, and why a scaled number's variance scales by the square; and checked one claim against
the figure: seRatio's 1.08 "within its own noise (about 3%)" is not within 3%. It is not: over 100 sets of a
thousand pixels seRatio spreads by 3% (computed), and the figure's set is an unlucky one, 2.6 of those high.

| Finding | |
|---|---|
| Why 1 − S; for a plain mean, s/√n. | **Fixed** in the fold-out: the scatter about the samples' own average comes out a little small; 1/n gives chapter 12's √(V / (n − 1)). |
| Variance times w², and of a difference, stated not shown. | **Fixed**: a paragraph of the two rules. |
| seRatio 1.08 against "about 3%". | **Fixed**: its spread measured, 3%; this set 2.6 of those high; *Other pixels* draws another. A test holds both. |
| The corner drawing's paths impossible to follow. | **Fixed**: one path that finds the lamp followed whole, dark. |
| The flat world, the log scale. | **Fixed**: a clause each. |
| The control's noise 0.1455 against the readout's account. | **Fixed**: the black-and-white edges are detail, which the noise counts; the readout says so. |
| The haze story's units. | **Fixed**: the camera aimed at a point given in the wrong unit, so at empty sky. |
| "The furnace 1 for every material". | **Fixed**: every white material, rough glass a little under. |
| ρE/π, Fresnel, critical angle, facets, roulette, the light's sample and chance. | **Fixed**: a clause each, with its chapter. |
| "A third of before" for 2.7. | **Fixed**. |
| 1000.000244 not 1000. | **Fixed**: 32-bit rounding, stamped inferred. |
| The check-shaders excerpt still opaque. | **Not changed**: it is introduced as a check that could pass without checking; its words are chapter 21's and 27's. |

### Chapter 30, Numbers have grain

**First read.** The teach-back held all five ideas. The reader then caught two things the page had wrong. The lamp
was "2 cm across" in the text and "the 1 cm disc" in the readout and section 6: it is a disc of radius 1 cm, as the
bench names it. And reading why the gap reads *exactly* one slab sent me back to the code: the page said a ray
leaving the first slab is moved on ten tolerances past the gap. The decisive length is another: where a ray meets
glass, the medium beyond the face is asked for twenty tolerances across (`tracebasics.js` mediumBeyond; the plan's
"Thin air gaps — open"). Past the gap the answer is the second slab's glass, so the face between reads glass to
glass, no face at all, and the two slabs are traced as one: two faces, one slab's 0.923. The figure now draws that
probe, and a test holds its length to the code.

| Finding | |
|---|---|
| 1 cm against 2 cm. | **Fixed**: radius 1 cm, 2 cm across, everywhere. |
| Steiner face on gives 1.19, not 1.22. | **Fixed**: 1.19 face on, and why 37° raises it (a narrower outline, the same margin). |
| Why more traced area means more light; which of the bench's pair is fattened. | **Fixed**: light in proportion to area; the light's rays start on the disc, the glowing object's are found by rays. |
| Why exactly one slab. | **Fixed**, and the mechanism corrected (above). |
| The readout's "pair reading" against the measured values. | **Fixed**: "predicted to read". |
| "A fixed share" against "one to two steps". | **Fixed**: a step is between 2⁻²⁴ and 2⁻²³ of the number. |
| 0.001 not exact in f32. | **Fixed**: a multiplication rounds by half a step at most; a metre scene's factors are 1. |
| 10 nm in autoEps against the 1 nm minimum. | **Fixed**: two minimums, said. |
| The centimetre bug unrebuildable. | **Fixed**: distances squared in cm², 10,000 times those in m²; the arithmetic stamped inferred. |
| Figure 2's caption ("each mark ten times") against its y labels; the nanometre's colour; Try it at the origin off the axis. | **Fixed**, all three. |
| The lint's text clipped; "a scene global read" with no paragraph; which three functions. | **Fixed**: wrapped shorter; a paragraph and step; SDF, getMaterial2, lightFace. |
| h.s.w; grey rays; "drawn ten times larger". | **Fixed** in the notes and caption. |
| Cards for kernel, engine, host, uniform, bench row. | **Partly**: the bench linked to its card; kernel and uniform have cards linked in earlier chapters; the page is Part VIII, read after them. |

**Second read.** The quiz came out whole, the gap's probe understood at a glance. What the reader needed was order:
section 3 used "the engine" and "the scene" without saying what they are, and "multiplies, never divides" before
saying there are two factors. And three sentences were wrong or seemed so: "always far outside the scene" is false
for a capped scene (its floor passes 1 mm at 65.5 m, inside Menger's 424 m); the bench's card said "a fixed test of
speed" while this page uses it for light; and the predicted 0.998 sat beside a measured 0.994 unremarked.

| Finding | |
|---|---|
| Engine, scene, kernel undefined; the two factors after "never divides". | **Fixed**: section 3 opens with both kinds of code and the two factors. |
| "Always far outside the scene" for capped scenes. | **Fixed**: below the cap; a capped scene's floor can take over inside it, where the numbers are coarser than 1 mm. |
| The bench card says speed. | **Fixed**: a fixed test of speed or of the picture. |
| 0.998 against 0.994. | **Fixed**: the test's other pairs read 0.995. |
| 37° from where; "the light over"; photons. | **Fixed**: the axis drawn, the floor's angle said, a ratio said; photons dropped. |
| The three lengths in one block; the broken nanometre sentence; 128 against 128 to 256; why 23. | **Fixed**: a list; one formula, 128 to 256 steps; a float's 24 binary digits. |
| The table's row for the probe not shown. | **Fixed**: the excerpt runs to the row's why ("the medium beyond is asked this far across"); "across" said as "past the face". |
| Section 5 calling twenty tolerances the shadow ray's; rays on the disc against two tolerances off. | **Fixed**: the row's uses together; the two-tolerance start is the optics trace's lights. |
| Figure 2's lines unlabelled; the flat old floor not pointed out. | **Fixed**: each line named on the plot; the paragraph says the old floor is flat. |
| metres() as the scene's; the unit plant dividing. | **Fixed**: what metres(x) does, and why from the engine it multiplies twice; the plant's division remarked. |
| The lint's messages full of jargon. | **Not changed**: they are the lint's own words; the caption says they are written for the engine's developers. |
| Try it's third question a trick. | **Fixed**: it asks what each complaint names. |

### Chapter 31, The optics bench

**First read.** The teach-back held the chapter whole: bins, the high peak and the narrow beam, the map's noise and
the smoothing's bias, the float's growing steps and the integer pair. The reader caught one thing wrong and one
thing the page could not back. "γ and C in 5° steps" is wrong for C: 24 bins to a turn are 15° each (read in
`farfield.js`). And the Gaussian map's middle, 831 against the true 955, was called the blur's bias, while the reader
saw the neighbouring dots dip and 13% is more than the map's own 10% noise. So I ran it 120 times: the middle cell
averages 913 lux, 4.4% under 955 (computed, 120 runs of 5,000 rays, standard deviation 51); 831 is that bias and
this run's noise together, and the page now says so, with a test holding the 913.

| Finding | |
|---|---|
| C in 5° steps against 24 to a turn. | **Fixed**: γ in 5° steps, C in 15°. |
| 831 called the bias. | **Fixed**: 913 over 120 runs, 4.4% low; 831 the bias and its noise; tested. |
| A ray's weight used before it is said. | **Fixed**: the tally's first paragraph says what a weight is. |
| Solid angle, lumen, candela, lux undefined. | **Fixed**: one clause each where first used. |
| The bins near the axis small: why. | **Fixed**: lines of longitude meeting at a pole; the cap, then rings 5° wide. |
| "Inherits" never says which way. | **Fixed**: a peak too high puts the half level too high, so the beam reads narrow. |
| 318, 955, cos⁸, the beam angle's derivation. | **Fixed**: a maths fold-out; 0.5<sup>1/5</sup> with its root said. |
| Words, wraps, the pair's carry. | **Fixed**: an odometer's two wheels. |
| "Exact" against the readout's 12.8 short. | **Fixed**: exact in units, each weight rounded once, 0.2 units short each. |
| The red curve above 1. | **Fixed**: 0.7 added as 1 between 8 and 16 million. |
| knn's 18% "everywhere" against a smooth fringe. | **Fixed**: 18% of each cell's own light. |
| The legend's C0-C180 plane; rings without values; no 90°. | **Fixed**: "the grid cut through its axis"; rings in cd; ±90° labelled. |
| The detmap excerpt cut mid-sentence; estimate.js opaque. | **Fixed**: detmap ends at the knn bullet's end; estimate.js dropped. |
| Glass, readback, Zemax, 4247 K for insiders. | **Fixed**: polarisation, readback and colour temperature glossed; Zemax called a lens maker's format. |
| Why roulette would spoil the totals. | **Not changed**: chapter 13 says what roulette does; here it is named only as what the optics trace does not do. |
| The dot and cross products in farBin. | **Not changed**: the note names them; the chapter is in Part VIII, after chapter 3's vectors. |

**Second read.** The quiz came out whole, 913 against 955 included. What was missing was how to read the polar
diagram (where the light is, that distance is intensity), and the 0.7 curve's story told too coarsely: the reader
saw its clearest rise above 1 near 2²² rays, which the page did not explain. Computing the curve binade by binade
(`f32Sum`): while the total is 1 to 4 million the step is ⅛ then ¼ and 0.7 is added as 0.75, 4% high at the peak;
4 to 8 million, as 0.5; 8 to 16 million, as 1; past 16 million, as nothing, the total stuck at 2²⁴. The page said
only the middle two, and pointed "the rise above 1" at the smaller bump.

| Finding | |
|---|---|
| The polar diagram unreadable without outside knowledge; the legend's "cut through its axis". | **Fixed**: the light at the bottom point, distance as intensity, cos a circle; labelled on the figure; "the bins in one plane through the axis". |
| The 0.7 curve's bumps; total against rays. | **Fixed**: all four binades, by the total; a test holds the rise, the fall and the stop. |
| Russian roulette not said, so "add up exactly" does not follow. | **Fixed**: two sentences, and "run by run". |
| Compare-and-swap and the retry storm. | **Fixed**: what the loop does and why floats need it (WGSL's atomics are integers only). |
| 0.2 × 67 million is not 12.8. | **Fixed**: a unit is 2⁻²⁰, said with the sum. |
| What one ray carries; a ring's solid angle. | **Fixed**: 1000/N lm; 2π (cos γ₁ − cos γ₂), a 24th each (`farfield.js`). |
| "Follows the true one" against a spiky top. | **Fixed**: spiky only near the axis. |
| The clamp at 4000; `&optData[slot]`, `u`. | **Fixed** in the note: one ray's units under 2³², so one wrap at most. |
| "1.5 cells wide" against sigma and 3 sigma. | **Fixed**: sigma 1.5 cells, cut at three times that. |
| knn's sharp edges on a spot with none. | **Fixed**: an edge would stay sharp; this spot has none. |
| 0.5^1/n ambiguous. | **Fixed**: bracketed. |
| §5 and §6 for insiders; the 58.98 note. | **Not changed**: the tutorial's readers will build renderers, and these are the measurements and mistakes they would meet. |

### Chapter 32, A ray tracer in one page

**Before any reader.** Writing the page found the tutorial's own path tracer wrong: in this chapter's room aiming read
brighter than bouncing (0.1210 ± 0.0005 against 0.1163 ± 0.0010, four bounces), and in chapter 14's, at twelve, darker.
`flatland.js` aimed at the middle line of lamps the bounces hit as capsules, and aimed from a path's last surface;
both fixed, the numbers that moved corrected in chapters 8, 14, 19 and 20, and the page's section 5 tells it (the
0.67.2 entry has the details).

**First read.** The teach-back held the whole program, the mistakes of section 5 included. Where the reader got lost
was arithmetic the code leans on and the page never said: the dot product behind every cosine, why the lamp's pick is
divided by its chance and the bounce seems not to be, and albedo/2. And one sentence was wrong: "within four bounces"
beside a loop of five rounds, which is the eye's leg and one after each of four bounces.

| Finding | |
|---|---|
| The dot product never explained. | **Fixed**: a paragraph before the code, and each place it is used named. |
| Dividing by the chance; `* lamps.length`; albedo/2; the bounce not divided. | **Fixed**: a fold-out on all three, the bounce's cos θ / 2 cancelling to the albedo. |
| Four bounces against five rounds. | **Fixed**: five legs, the eye's and one after each bounce; the code note says so. |
| Why the hit would count twice. | **Fixed**: the shadow ray from that bounce already counted the same light. |
| NEE never named in the text; ray tracer against path tracer. | **Fixed**: NEE named where aiming starts; the lede says what a path tracer adds to a ray tracer. |
| The strip: which end is which; one row; the mirror's looking darker. | **Fixed**: the ends tied to the dashed lines, each strip scaled to its own brightest pixel; that pixel marked and its ray drawn, up to the lamp off the mirror. |
| The circles touching the nearest shape; the grazing steps invisible; the lamp's ends. | **Fixed** in the text: each circle touches the nearest wall or the box, the crowded dots are the steps, the lamp drawn as a line. |
| The normal lying back along the ray. | **Fixed**: its label beside the tip. |
| lampLight's lines 67, 70, 75, 79, 83; segment's t; the bounce's rotation. | **Fixed** in the code notes. |
| "A quarter of the paths" but not of the work. | **Fixed**: up to four shadow rays each, said. |
| ± and 44,800 in section 5. | **Fixed**: the error bar named, eight of them apart. |
| Section 4's jargon. | **Partly**: the table names the chapter for each row's words; the words stay, as pointers. |

**Second read.** The quiz came out whole. What the reader asked for was pictures: of one whole path with its shadow
rays and the surface that does not aim, and of the lamp's outline being picked from; and the last-surface rule as a
count of legs, not words. Following the reader's own question, why section 6's first draft "read darker with aiming"
when the second mistake made aiming brighter, I measured the old kit in this chapter's room: at four bounces aiming
read *brighter*, 0.1210 ± 0.0005 against 0.1163 ± 0.0010, the extra bounce outweighing the thin lamp, so the page
had said the wrong direction. It now gives both numbers and why the two mistakes pull opposite ways.

| Finding | |
|---|---|
| No picture of a whole path, of shadow rays, of the last surface. | **Fixed**: a step drawing one path of pixel 15, legs numbered, shadow rays and a blocked one, "the last surface: no aim". |
| `lampLight`'s point-picking a wall of text; no sketch of the outline. | **Fixed**: `lampPoint` split out of `lampLight` and excerpted as numbered steps; a figure of the capsule drawn large, 28 points picked, the far side never. |
| Which bounce is "the last"; why more light is wrong. | **Fixed**: a table of the five legs, each shadow ray standing for the next leg, the sixth never traced. |
| Fold-outs 2 and 3 need calculus. | **Fixed**: a sum of 1000 cosines for the 2; 87 draws against 8 for the sines' bunching. |
| The strips on their own scales; what each part of the strip sees. | **Fixed**: one scale, white at 0.4; under the strip, the ceiling, the wall or mirror and the box. |
| The red ray of the brightest pixel ending at a wall. | **Fixed**: replaced by the whole path. |
| The mirror's noise rising to 0.39. | **Fixed**: the lamp in the mirror found only by hitting it. |
| "Darker with aiming" against the second mistake. | **Fixed**, and the direction corrected (above). |
| The dot product after its first use; "these six" for seven rows; the cosine law; chapter 8's rule unnamed. | **Fixed**, each. |
| The graze's crowded steps invisible. | **Fixed**: the steps drawn over the ray. |
| `s.emit` as both flag and brightness; `Float64Array`. | **Fixed** in the notes. |
| Sections 4 and 5 full of names. | **Not changed**: pointers to chapters, as the table says. |


### Chapter 33, Open problems

**Before any reader.** The board holds 54 items, every one quoting its file and held to it by the test; writing the
test found one more: docs/TESTING.md's haze row still begins "open" though the same cell records it answered by its
third press, now a card of its own.

**First read.** The teach-back held the board and how it stays true. The reader was lost where the page leaned on
what it never said: why checks go unrun (one clause and a file name), and what the examples meant (a list of five
items in words from other chapters, none explained). And the text and the cards disagreed in small ways the reader
caught: rough glass "0.9440 in every run since" beside a card with a 0.9872 first; "most of the board" for 20 of 54;
"run once" a column the text never named; and the explanation I gave for the furnace's 0.9587 was wrong in its
detail when checked against docs/TESTING.md (the reference program follows the same surface model, not "one bounce").

| Finding | |
|---|---|
| Why checks go unrun: container, repository, CLAUDE.md. | **Fixed**: who writes the code, where, and why that place cannot run the page, in two sentences. |
| Each kind a list of names. | **Fixed**: one card of each kind told whole (the error bar row, the furnace's rough glass, the tolerance per pixel, a limit against a bug, the sun's 0.03 steradian), the rest listed after. |
| Text against cards: 0.9440, "most", run once, ±20%. | **Fixed**: 0.9872 then 0.9440; "the largest group"; the run-once row told, its 76% with what the plan says of it; the drift's own numbers and the document's words. |
| A bug never defined beside a limit. | **Fixed**: both, with one example each. |
| What happens when a quote stops matching. | **Fixed**: the test fails, and CI runs it on every change. |
| Code-like names on the never-run cards. | **Fixed**: each card's title is its question in plain words; the row's id is in the hover. |
| Glossary words unmarked; "control" never used. | **Fixed**: marked where used; the list matches the page. |
| How to open a file at the quoted words. | **Fixed**: search the file, on GitHub or in a copy. |

**Second read.** The quiz came out whole, the closing chain included. The reader's worst stumble was a word: "card"
meant a graphics card in one sentence and a card on the board in the next. And it caught the closing chain overstated:
the test notices a changed file, not a run, so a result nobody writes into docs/TESTING.md never reaches the board, which
is exactly the run-once card's story. One more thing it could not see, a card's whole words, which only pointing shows,
showed a kit bug when given a step that opens one: `pen.tip` said it kept its box inside the canvas and only checked
the right edge, so a wide box beside a point near the left ran off it.

| Finding | |
|---|---|
| "Card" for graphics cards and board cards. | **Fixed**: "graphics card" every time it is one, here and in the board's notes. |
| The furnace example led with what is explained; "a narrower picture … a quarter". | **Fixed**: 0.9440 first; the picture's width and what the quarter is of, said. |
| ±20% against the 38% the numbers give. | **Fixed**: both, and how one becomes the other. |
| Steradian, surface tolerance, light sampling, Pascal and Ampere unexplained where the examples rest on them. | **Fixed**: a clause each where used. |
| "The others:" lists incomplete (the source pick missing). | **Fixed**: "among the others", and the designed list made whole. |
| No screenshot of run once or of a card's whole words. | **Fixed**: run once has its own step; three steps open a card's box as the pointer would. |
| The closing chain claiming more than the test can do. | **Fixed**: run, written into TESTING.md, the test fails, the card changes; the second link is a person's. |
| Where unexplained numbers and wrong comments fall between bug and limit. | **Fixed**: said for both. |
| "One of each kind left open"; the caption's "found wrong". | **Fixed**: the drift card's two stamps; "found saying what the code does not". |
| The "all" readout hard to parse. | **Fixed**: the short names, separated by semicolons. |
| `pen.tip` off the left edge. | **Fixed** in the kit: clamped on both sides. |


## Round 10, 2026-10-19 (0.67.3: chapters 33 and 14, after the comments were corrected)

Reports: [open](reports/2026-10-19-round10/open.md), [nee](reports/2026-10-19-round10/nee.md).

**Why this round.** Version 0.67.3 corrected the twelve comments and document lines chapter 33's board listed as found
by this tutorial, and rewrote the sections that told of them: chapter 33's step on what the tutorial found, and chapter
14's note beside the light-sampling excerpt (the other chapters' changes were a clause each: "until version 0.67.3 the
comment said"). Each rewritten section was read by a new reader. Both understood what was corrected and why (chapter
33's quiz answer 4, chapter 14's closing question). Findings on the rest of either page are answered below, not
changed: they are on sections this change did not touch, and they are the next round's for these chapters.

### Chapter 33, Open problems

| Finding | |
|---|---|
| The twist card: step, step bound and "the distance" never said; c, rate and extent undefined; 3% against 15% never reconciled; "Try it" asks to decide the divisor. | **Fixed**: the step tells the march in a sentence (a step as long as the distance to the nearest surface), what a twist does to it, c in words, the 15% the divisor falls short by, the 0.9 that takes up most of it, the 3% left in the case the test tried, and the cost of closing it. That cost was "up to 15% shorter steps" in chapter 3, here and in the changelog: the divisor is up to 15% larger, so the steps are up to 13% shorter (computed: 1 / 1.1547). Corrected in all three. The card's note says it in the same words; "Try it" asks the trade-off. |
| "A sun twenty times the real one" against "an old sun drawn 21 times too wide": the same thing? | **Fixed** where this change wrote it: the old sun is "its disc once made 21 times as wide". The run-once paragraph's "twenty times" is the documents' "20× sun" (docs/TESTING.md, roadmap/PLAN.md), which do not say whether it was brighter or wider, so the page says no more. |
| The furnace paragraph; the unexplained list's words (compile, kernel, Menger, lavapipe); "the user" before it is said who; "a pass reads 1"; rays assumed. | **Answered, not changed here**: sections this change did not touch, read by round 9's two readers too; the next round's. |
| The board: titles cut in the overview, the hover box over the first rows, the button names against the headings. | **Answered, not changed here**: the figure is as round 9 left it. |
| The drift card's cause as fact; "built on the metres engine" in a not-built card; the metres row's 2.3% on the Ampere left out of the text. | **Answered, not changed here**: card notes this change did not touch; the next round's. |
| The lux check in chapter 5 against a card showing "ch. 1". | **Answered**: the half-hidden card in that screenshot is the coating's ("does a coating do what it says?", which names chapter 11 in kit/open.js); the lux card, ch. 5, is the one under the box. |

### Chapter 14, Aim at the light

| Finding | |
|---|---|
| The note: where 6.28 comes from; "about twice as often" stated, not shown; "drew the sun" read as a picture. | **Fixed**: "the 6.28 steradians of a hemisphere (half the sky's 4π)"; the cosine-weighted chance 0.03 / π, from the margin note in section 2, and π half of 6.28, so twice; "made the sun's disc 21 times as wide". |
| Dividing by π needs outside knowledge. | **Answered**: the margin note in section 2 states it; showing it takes an integral over the hemisphere, past the school maths the page asks for. |
| Section 3's numbers against the screenshots beside it (± 0.001 against ± 0.009; "about 0.21"); "a fifth" in section 4 against "a sixth" in section 8; "0.28" read as a lamp size. | **Answered, not changed here**: sections this change did not touch; the next round's, first. |
| NEE used before it is defined; "last bounce" and "last round" told twice; BSDF and pbrt; the cone's size; a colour meaning three things. | **Answered, not changed here**: as above. |

## Round 11, 2026-10-20 (0.71.1: chapters 3 and 4, a line round a cut)

Reports: [shapes](reports/2026-10-20-round11/shapes.md), [normals](reports/2026-10-20-round11/normals.md).

**Why this round.** Version 0.71.1 stopped a CSG group with reliefs in it from dividing its distance while the renderer
takes a normal (`NORMAL_LOOK`): the divisor jumped where a steep relief's band ended, and the normal's differences drew a
line round a stucco hole cut in plaster. Chapter 3 and chapter 4 each gained a "What went wrong before" item for it, and
their excerpts (`foldRelief`'s comment, `calcNormals_fast`) moved, so each page had a new reader, with a question on the
new item. Both readers answered it: the jump in the divisor, the surface not moving, the normal turned. Findings on the
rest of either page are answered below, not changed: sections this change did not touch, the next round's. The two items
were rewritten for these findings and have not been read again; the next round's readers of these chapters read them
first.

### Chapter 3, Building and bending shapes

| Finding | |
|---|---|
| "The looks a normal takes" read as appearance; the excerpt only declares NORMAL_LOOK, so the fix is not seen working; no number example; why the line is farther out with a wider blend not said; "a group under group code still divides" opaque. | **Fixed**: "when the renderer asks for the distances a normal is made from"; the excerpt's note says the line that reads the flag is the scene builder's and not shown; 0.05 / 1.11 = 0.045 against 0.05 / 4.67 = 0.011; the band is twice the relief's height plus 5/4 of the blend; "a group inside a group with code of its own (a rounding, say) may use the distance away from the surface". |
| Section 6's code comments too long to tell what to read; kernel, NaN, argmax, XF_K, octaves against layers; `k` in `combine` a name, not the blend. | **Answered, not changed here**: excerpts and words this change did not touch (foldRelief's comment grew by NORMAL_LOOK's, which the note above now points to); the next round's. |
| "Takes off up to k/4" for a subtraction, which adds; why a smaller distance moves the surface out; fig 3's overlap and its label; section 5's "1 +", the two 17.2s, "amount high" against 1.386 × amount, why the zigzag never shrinks; "Bumps 1/k too big" rushed. | **Answered, not changed here**: as above. |

### Chapter 4, Which way is up

| Finding | |
|---|---|
| "A line round a cut" lost the reader: relief, the division and stucco lean on chapter 3, and nothing says why the scene divides or why the undivided distance is right for a normal. | **Fixed**: the item says why the scene divides (a rough surface makes the distance change faster than the travel, and the march could step through a bump), gives the jump in numbers (0.045 against 0.011 for a distance of 0.05), and says why the fix is right (one divisor everywhere shrinks every difference alike and leaves the arrow's direction; it is made one unit long anyway). |
| The excerpt: `select(1u, 0u, NORMAL_AT_HIT)` read backwards; why the scene cares about NORMAL_LOOK; r.pos never said to be the hit. | **Fixed** in the excerpt's note: select's order, r.pos the hit point, section 6 for why the scene needs to know. |
| Kernel, shader, unroll, sample never explained; "Why 128" long and the "can stall" comment against the emulation; figure 2's ticks, its f32 bump past 128, a label collision, units; figure 1's labels and the crease from the other side; try-it 2's "smaller"; why a normal is one unit long. | **Answered, not changed here**: sections this change did not touch; the next round's. First to check: try-it 2's "smaller", which the reader read as wrong (central is 0.6° off at a step of 0.3, so its step for 1° would be larger). |

## Round 12, 2026-10-23 (0.next: chapter 14, a lamp's rim)

Reports: [nee](reports/2026-10-23-round12/nee.md), then [nee, the new item read again](reports/2026-10-23-round12/nee-second.md).

**Why this round.** A light's face had glowed on a rim as wide as the surface tolerance beyond its edge, which light
sampling never aimed at, so light sampling off read a small face brighter than on (codegen.js ONLY ON THE FACE ITSELF,
builder/test/lightface.gpu.mjs). Chapter 14's "What went wrong before" gained an item for it, "Two sizes for one lamp",
beside "Two edges for one sun". The first reader read the whole page with a question on the new item. The item was
rewritten for its findings, and a second, fresh reader read the page up to it and reported on the item alone. The item
was rewritten again for the second reader's findings. That version has not been read; the next round's reader of this
chapter reads it first.

### Chapter 14, Aim at the light

| Finding | |
|---|---|
| First reader: "the march" and "tolerance" never met on this page; "a lamp here" read as the flat world's (a capsule); a lamp's back never mentioned; "(section 8)" for weights wrong (section 4 and the next chapter); why black rather than aiming at the rim missing, and section 3's fold-out ("aim at exactly the light the bounces can find") seeming to say the opposite. | **Fixed**: "In ShadyTracer", front and dark back said; stepping and the tolerance in one sentence each, linked to their chapters; the weight's pointer is section 4 and the next chapter; the item now says the two could agree from either side and why they agree on the lamp's size (the ring is the tolerance's, and the brightness is set from the size), and why the flat world's capsule went the other way (its outline is the lamp). |
| Second reader: why rays step; why a small lamp's weight is small and whether "almost nothing" is "right"; "the lamp's own rays" never taught; the brightness reason's consequence left unsaid; "that thick" unclear; what a ray meeting the black rim does; 5 % against a plain area sum of 3 %; "the two halves of the estimate" though NEE off has no shadow rays; a formula though section 2 says a real scene has none. | **Fixed**: stepping linked to *Shapes as distances*; "a random bounce rarely finds a small lamp, so what it finds counts for almost nothing, and the shadow rays, aimed at the true lamp, gave nearly all the light"; the lamp's own rays cut; "a larger lamp glowing as brightly sends out more light than it was given"; "0.02 thick, so its outline is the lamp"; a ray meeting the ring stops, as at the back; the ring adds 3 % face on, and the floor sees the lamp at a slant, which narrows the lamp but not the ring; "the two ways of finding the lamp"; "which a scene this simple has". |
| First reader, on the rest of the page: section 3's ± 0.001 / ± 0.009 against fig 3's screenshot (± 0.003 / ± 0.025 at size 0.20); "a fifth" (section 4) against "a sixth" (section 8); section 4's "Not at the last bounce" and section 8's "Not on the last round" read as one rule twice; section 7's margin note on the stale sun comment long; march, tolerance, BSDF, f32 without cards. | **Answered, not changed here**: sections this change did not touch; the next round's. First to check: section 3's numbers against the figure's size. |

## Next round

The pages stay drafts. Every written chapter has now had two readers (chapters 5 to 11 in rounds 5 and 6); the
second round's changes are smaller than the first's, and most are words. A third read is worth it when a chapter is next rewritten (chapters 16, 17 and 0 had
sections rewritten in round 4, so they come first), or when the user's own reading finds what these readers cannot:
whether a figure feels right to drag, and whether a real student keeps going.
