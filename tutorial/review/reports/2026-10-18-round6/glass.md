# Blank-reader review: "Glass" (ch/glass.html)

## 1. Teach-back
Light goes slower in glass than in air, and the index n says how much slower: 1 for air, 1.33 for water, 1.5 for glass, 2.42 for diamond. When a ray goes into glass it bends towards the normal, the line sticking straight out of the surface. Snell's law, n₁ sin θ₁ = n₂ sin θ₂, says how far it bends. Some light also bounces off. Fresnel's law gives that share: about 4% straight on, rising to 100% when the light skims the surface. Light has two "vibrations", s and p, which reflect differently, and a renderer uses their average. Going from glass out into air, past about 42° no angle works any more, so all the light reflects. That is total internal reflection. In a pane, light bounces back and forth between the two faces, and adding up every pass gives (1−R)/(1+R). The renderer doesn't add them up. It flips a weighted coin at each face and counts where the rays end up. Coloured glass keeps the same fraction of the light per equal stretch, so a longer path keeps less. A glass ball focuses sunlight to a blurry spot about half a radius behind it, and a diamond ball makes the rays cross inside it.

## 2. Quiz
1. **Snell's law** decides the direction the ray bends to. **Fresnel's law** decides how much of the light reflects and how much goes through. The page taught both.
2. Light inside the denser material hits the surface at more than the critical angle (41.81° for glass), so all of it reflects. The page explains it in words. The formula sin θc = 1/n appears only in the figure readout, written as "asin(1/1.50)". I could rebuild it from Snell with θ₂ = 90°, but the prose never states it.
3. Each pass is R² times the one before. A shrinking series "adds up to its first term over (1 − that factor)", which gives (1−R)²/(1−R²) = (1−R)/(1+R). The renderer sends many paths, and each one reflects with chance R or passes with chance 1−R. The share of paths that come out below is the answer. I could repeat *why* each branch "divides by its chance" (R/R = 1), but I don't understand it: it is "chapter 8's rule".
4. The ray carries the index of the material it is in. At a transparent surface the renderer asks the scene which material is at a point a tiny step past the surface, and reads that material's index. The page taught this well.
5. Each equal stretch keeps the same share, so after d it keeps colour^(d/depth) for each channel. A thicker pane or a slanted path is longer, so less light survives. I followed the code's form exp(−mu·d) only through *outside knowledge* of ln and exp.

## 3. Where I got lost (worst first)
1. **"By chapter 8's rule it divides what each branch carries by that branch's chance."** This is the heart of the "renderer never adds them up" idea. I don't know what a path "carries" or why you divide. I'd like one small worked example: 100 paths, 5 reflect, 95 pass.
2. **The second code excerpt (materials_pbr.js 338–347).** Too many names are new: sub, pd, "matte base", "coat", "coloured coat", s.w, transTint, EV_DELTA, "delta". I only got "random number < ps → reflect" because I know the `Math.random() < p` idiom.
3. **rayTransmittance.** "−ln(colour) / colour depth" and "exp(−mu d) = colour^(d/depth)" use ln and exp, which I haven't learnt (*outside knowledge*). "ltot is the ray's optical length, the length travelled times the index" doesn't say why the ray stores length × n. The comment's "as the MIS recovers a vertex" means nothing to me.
4. **"each face reflects 5.0%"** in section 2. The bottom face is hit from inside at 28.13°, not 45°. Why is its reflection the same R? Figure 1 from inside at 30° says 5.5%, so I expected a different number.
5. **"An opaque surface … uses its own index, and never less than the material the ray is in."** Why does something you can't see through have an index? And what does "never less than" protect against?
6. **Section 3, "the two radii to its ends make an isosceles triangle".** This only works if the normal on a ball points along the radius, and the page never says so (*outside knowledge*). "The axis" is never drawn or defined.
7. **Sections 5 and 6** rely on "white furnace", "rough glass", "tilted facets", "lobesSample", "chapter 15's two ways" and "automatic tolerance". None of them are explained here.
8. In the first fold-out, **"which works out to tan θ₁ = n₂/n₁"** skips the algebra.

## 4. Words and symbols
- **index of refraction**: explained where it is first used, and the card helps.
- **normal**: the card helps. Its second half (distance formula, "straight uphill") is noise at this point.
- **path**: the card is fine, but "chapter 8's rule" carries the meaning.
- **caustic**: the card is good.
- **total internal reflection**: the card is good.
- **s, p, unpolarised, Brewster's angle**: explained adequately. Nothing says why the letters are s and p.
- **critical angle**: named but never given a formula in prose. "asin" is programming notation, not the sin⁻¹ I know from school.
- **η, c₁, c₂, amplitude**: defined in the fold-out. "With η = …, the cosine of the incoming angle c₁, and of the refracted one c₂ = …" reads awkwardly.
- **Never explained**: WGSL (only "(chapter 21)"), f32, VEC3, clamp, Schlick, F0, "the bench", IOR (section 6), SDFd, offsetTol, "march tolerances", Material2, "(Shading n1, mu1)", MIS, "closed form" (figure 2 readout), "luminaire", "optics bench", "specular", "Pascal card" (the "measured" card does explain this one).
- **sin2T**: I first read it as sin(2T), not sin²θ_T.

## 5. Figures
- **Figure 1** shows how a ray bends and splits, with the reflected share plotted against angle. The screenshots work well: line thickness matches the percentages, and the readout "(1.00 sin 45° = 1.50 sin 28.13°)" lets me check Snell myself. Problems:
  - No angle arcs are drawn, so I can't see 45° or 28.13° on the picture.
  - The orange dot on the chart is never named as "the current angle".
  - In fig-1-tir, the red "no refraction: total internal reflection" label overlaps the legend's "their average".
  - In fig-1-inside, the "critical" and "p = 0" labels crowd together.
- **Figure 2** shows a pane's repeated bounces. Clear, and the labels add up (90.2 + 0.2 = 90.4). Problems:
  - The top's "4.5%" in fig-2-clear isn't mentioned in the text. I had to work out that it is (1−R)²R.
  - In fig-2-absorbing, the first pass and "every bounce" both read 41.1%. The text says "Counting every bounce, 41.1%" as if the extra bounces mattered.
  - The readout's "closed form: 41.1%" includes absorption, but the fold-out's formula doesn't, so I can't check it.
- **Figure 3** shows a ball focusing parallel light. The dot and its labels work. Problems:
  - No axis line is drawn.
  - The readout's formulas, n/(2(n−1)) and n/(n−1) − 1, are never derived or explained.
  - Teal rays inside the ball versus orange outside are only hinted at by "(in the glass colour)".

## 6. The maths fold-outs
- **Fresnel**: I could follow the cos θ₂ derivation step by step. I took the Fresnel equations on trust, which is fine, and I checked "((n−1)/(n+1))² = 0.04". I could not do the Brewster step ("works out to").
- **Pane**: I could follow it, but only because I already know the geometric-series sum. It is stated, not shown (*outside knowledge* for many students). The difference of squares step was fine.

## 7. The code
- **fresnelDielectric**: readable next to the fold-out. cosI = c₁, cosT = c₂, and the `if` is total internal reflection. Two opaque bits: "Schlick with a fixed F0" in the comment, and `f32`.
- **Reflect/refract branch**: mostly opaque (see §3.2). Unexplained: `max(1.0 - pd, 1e-6)`, why `VEC3(1.0) - …` is a vector, which way round `etaT` is, and "the weight stays 0" when nothing shown sets it to 0.
- **mediumBeyond**: the idea is clear. `materialAt(…, true)`: the `true` is unexplained.
- **rayTransmittance**: the early return ("no absorption → keep all") is readable. The last line needs ln/exp and the optical-length idea.

## 8. Too much, too little
- **Too much**: sections 5 and 6 are full of test ratios (0.9991, 0.9966…) and history that needs chapters 8, 9 and 15. The polarisation "shortcut" paragraph is interesting but dense. The intro's "LED and luminaire design" is jargon.
- **Too little**: the branch-weight rule, the critical-angle formula, why both faces have the same R, and the ball's geometry (normal along the radius).

## 9. Wrong or contradictory
- **Diamond**: the text says the rays cross at 0.704 radii, but the readout's focus formula gives 0.852, "under 1". Two different "inside" points, and the page doesn't say that the 0.852 formula no longer applies once the rays cross inside the ball.
- **Section 5's third stamp**: "the test fails there, and is meant to show…" sounds like a test meant to fail, which confused me.
- **"returns nothing"** for refract under total internal reflection: but then `i.z` is still read, so it must return *something*.
- **Code header formatting**: it reads "lines 123–133WGSLWGSL (chapter 21)", with the tag doubled and no spaces.

## 10. The five changes most worth making
1. **Explain the branch weight** with a worked example in section 2, for instance 1000 paths, 50 reflected and 950 passed, each carrying its full weight, so the counts *are* the shares. Don't lean on "chapter 8's rule".
2. **Cut down or rewrite the second code excerpt** for clear glass (pd = 0, no coat), and gloss every name left. Warn that `sin2T` means sin²θ_T.
3. **Give a one-line bridge for exp/ln**, such as "exp(−mu d) is colour^(d/depth) written another way". Either explain why the ray stores length × n, or drop the MIS aside.
4. **Section 3**: draw the axis, say the ball's normal points along the radius, explain or remove the readout formulas, and resolve 0.704 against 0.852.
5. **State the missing basics in prose**: sin θc = 1/n, and why the bottom face reflects the same R. Mark sections 5 and 6 as needing chapters 8, 9 and 15, or gloss "furnace", "rough glass" and "facets" in a line each.
