# Blank-reader review: Chapter 11 "Rainbows" (dispersion)

## 1. Teach-back
Glass bends short wavelengths (blue) a bit more than long ones (red), so a prism spreads white light into a fan. That spreading is called dispersion. A glass catalogue describes a glass with two numbers. n_d is the index at a yellow line (588 nm). The Abbe number V_d says how little the glass spreads colours: high means little spreading, and 0 is ShadyTracer's switch for "no spreading". From those two numbers ShadyTracer works out the index at any wavelength with Cauchy's formula n = A + B/λ². A ray normally carries three numbers (red, green, blue). When it refracts into a dispersive glass, it is given one random wavelength, picked more often where the channels respond more. Each channel is then multiplied by its response divided by the chance of that pick, so on average each channel stays 1 and white stays white. Any single path is coloured and noisy, though. Reflections skip all this and stay white. A colour-sorting coating needs no wavelength: its reflectance is averaged over each channel's range of wavelengths. Tilting the light moves the coating's edge towards blue.

## 2. Quiz
1. **Prism, n_d, Abbe:** the index is larger for shorter wavelengths, so blue bends more at each face and the colours fan out. n_d is the index at the yellow d line. V_d = (n_d−1)/(n_F−n_C) measures how little the glass disperses (28 for flint, 64 for BK7, 0 means off). *Why* the index depends on wavelength is not taught (fine).
2. **When a wavelength is given:** when a ray with no wavelength meets a dispersive glass (V_d > 0) and refracts. A bin is drawn with chance P(k), and each channel is multiplied by W_c(k)/P(k). The ray keeps that wavelength afterwards, stored in its tag. That the channels are *multiplied* is said only in §5, and that line is not shown.
3. **Average 1:** Σ P·(W/P) = Σ W = 1, because each channel's responses add up to 1. So (1,1,1) comes back on average. *Why* the responses are made to add to 1 is only half-explained ("so that a white light … is made of them exactly"). That relies on chapter 6.
4. **White reflections:** the reflect-or-refract choice uses n_d for all colours, and a reflected ray never gets a wavelength. The *physical* reason this is allowed (a mirror bounce doesn't sort colours, and reflectance changes only by about 0.003) I had to piece together. §6 gives the number, but it is never connected to this question. *Outside knowledge.*
5. **Coating:** average the coating's reflectance over each channel's curve and reflect that fraction of the channel, passing the rest. It is exact for a flat coating and approximate at an edge (the 650 nm laser example).

## 3. Where I got lost (worst first)
1. **The stamped asides in §3 and §5.** "past about 700 nm its ȳ outlasts its x̄", "CIE", "worked out from spectral.js in node", "41 softplus differences", "red's response is negative". None of these is explained, and a *negative* response is baffling. I could not tell what is being guessed in the "INFERRED" one.
2. **§5's WGSL and the tag paragraph.** "shading kernel", `rayLambda(res.r)`, `res.r.n`, `var spec: SpecDraw`, "a 32-bit word of flags, in its top 15 bits". Bits and flags are *outside knowledge*. Worse, the text points to "the line that multiplies the ray's three channels by the weights … (materials_pbr.js:1003)", but that line is not on the page.
3. **§3 never shows one pick end to end.** "weighted by how much it responds" leaves open what the ray looks like afterwards: (0.2, 0.1, 2.7)? Figure 3 hides the weights behind a hover, and no screenshot shows one. "Responses" are only drawn in Figure 4, a section later.
4. **The opening premise.** "has no blue and red to bend apart". But it *has* a blue number! My first question was "why not bend R, G and B at three indices?" It is never asked. The real reason (each channel is a spread of wavelengths, and one wavelength for every ray means noise everywhere) appears only in §6's "Looks right" stamp.
5. **"R" means two things:** the "Fresnel reflectance R" and the red channel R ("reflected R 0.948", "averaging 1 − R"). The word "Fresnel" is not explained either (chapter 10).
6. "a white ray splits into one colour per path". It doesn't split, and "path" versus "ray" is never distinguished.

## 4. Words and symbols
- **Cards that helped:** index of refraction, dispersion, Abbe number (though "the index at yellow less 1 over the spread" reads awkwardly), spectrum, total internal reflection. That last card's "41.8 degrees … for glass" is for n≈1.5, not the 1.75 flint shown.
- **Explained in the text, fine:** bins, colour noise, dichroic, Fraunhofer lines, Σ.
- **Used without explanation, no card:** Snell, Fresnel, channel/response (chapter 6), path, weight, kernel, PRNG, tag/flags/bits, CIE, x̄/ȳ, "fit", softplus, Dawn, "software driver", "optics view", caustics, rough glass, facet, photon (half-explained in a note), "first-order rule", n_eff.
- **"Draw" means three things:** compute ("draws the index at every wavelength"), pick at random ("the draw") and draw a line in a figure.

## 5. Figures
- **Fig 1 (prism):** clear. The three screenshots show the fan narrowing from flint to BK7 to none, and the readout's "blue bent 3.24° / 0.71° / 0.00°" nails it. Confusing: inside the prism the beam is one *red/orange* line, as if the light turned red. The text says each wavelength refracts "both into the prism and out", but no fan is visible inside. The ⊕ handle is visible.
- **Fig 2 (index curves):** clear. The F line is drawn *cyan* while the text calls it blue. The rings are too small to judge the 5e-5 difference, which is fine because the readout gives it.
- **Fig 3 (bins and averages):** the two humps and the averages approaching the dashed 1 read well. The blue hump's bars are drawn purple. No screenshot shows a bin's weights, which is the key number.
- **Fig 4 (coating):** strong. Straight-on versus tilted shows the edge moving and the green bar growing. Unexplained: the red channel curve has a small bump near 440 nm, and the colour strip turns back to *orange* past 700 nm. I guess that strip is the "fit's red end", but nothing says so.

## 6. Maths fold-out
I could follow it: Σ is defined, and P·W/P = W cancels. Missing: why P has "/3" (the code comment says it, the fold-out doesn't), and why "the average is each value times its chance, added up". A two-bin example would make it concrete. I checked "at most 3" myself and it holds. I also checked the tilt formula with sin 45°: 551.8 nm, correct.

## 7. Code
- **cauchyN:** the note's algebra for B and A is followable. `**` and `!(vd > 0)` are not explained (why not `vd <= 0`?).
- **specDraw:** the "chances laid end to end" note is excellent. However, the excerpt ends before `acc` is ever increased, so the "adding up" the note describes isn't visible. `.map`, `=>`, `? :` and `Math.min(Math.max(…))` are beyond "a little JS".
- **WGSL:** `select` is well explained. `rayLambda`, `SpecDraw` and `lambdaCoded`'s "what the ray can store" stay opaque.

## 8. Too much / too little
- **Too much:** "Numbers in the comments, checked", "The fit's red end", the dispersion.gpu.mjs details, section 7's test crash. These are for developers, not learners.
- **Too little:** a worked pick, why reflection needs no wavelength, and the design choice (three channels versus all-spectral), which should open the chapter rather than close it.

## 9. Wrong or contradictory
- §3: "The reflections stay white" versus §7: "the prism's reflections, where the colours overlap again, came out green". Presumably these are inner reflections of already-split light, but that is not said.
- §2: "their gap is right". Subtracting gives 0.00805 from the formula against 0.00806 from the catalogue.
- Tag: "380 nm plus the code times 400/32,766" makes code 1 = 380.012 nm and code 32,767 = 780.012 nm. Is it really (code − 1)?
- "Each of the two is a little off": "the two" is unclear right after "n_d … and the gap".
- §6 "What it leaves out" is stamped READ IN CODE yet says "computed from the formula". Its "0.0029" has no stated meaning (a change between which wavelengths?).

## 10. Five changes, most important first
1. Open with the design question: why not three indices for R, G, B, and why not one wavelength for every ray. Move "Looks right" up and explain that a channel is a spread of wavelengths.
2. In §3, walk one pick through with numbers: the bin, its chance, the three weights, the ray's colour after. Show the channel curves in Figure 3, or add a hover screenshot.
3. Rename the Fresnel R (or the channels), say plainly why a reflection can stay white, and reconcile it with §7's green reflections.
4. Put the developer-facing stamps (red end, comment checks, test machinery) into a closed "for developers" fold-out, or define x̄/ȳ/CIE/softplus where they appear.
5. Show the channel-multiplying line and `acc += p`. Add one sentence each on `.map`/`=>`/`?:` and on what a tag and bits are, and give a card for Snell and Fresnel.
