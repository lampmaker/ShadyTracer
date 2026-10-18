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

## Next round

The pages stay drafts. Every written chapter has now had two readers (chapters 5 to 11 in rounds 5 and 6); the
second round's changes are smaller than the first's, and most are words. A third read is worth it when a chapter is next rewritten (chapters 16, 17 and 0 had
sections rewritten in round 4, so they come first), or when the user's own reading finds what these readers cannot:
whether a figure feels right to drag, and whether a real student keeps going.
