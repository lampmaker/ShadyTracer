# Surface modifiers — the plan

## STATUS (2026-10-02)

Replaces the handoff of 2026-09-29. **Built** -- each phase's section says how it was checked:
- **Phase 1**, grain: measured on hardware, the grained metals' `bsdf-parity` pairs agree to 0.1%.
- **1b**, anisotropic energy: measured, every metal `furnace` row within 0.1% of 1, where the table grid
  predicted it.
- **1c**, visible streaks: the roughness part (library *brushed* and *turned aluminium*); not yet
  confirmed seen.
- **Phase 2**, the noise library and the builder's noise relief: Node-tested; rendered on hardware as the
  benchmark's main scene (PERFORMANCE.md).
- **A material's relief** (2026-09-30): library *rough stone*, *leather*, *hammered metal*; *A relief
  belongs to the material*, below.
- **Phase 6**, the shell for the noise relief: measured (-22.9%), the pictures identical to the user's eye.
- Demo scenes: `scenes/surfaces.json` (*Surface materials*), `scenes/noise.json` (*Noise library*).

**Open:**
- **Rough glass** read 0.9587 on the Pascal after its sampling fix, which a CPU single-scatter
  reference explains (TESTING.md, *furnace*); then 0.9872 in the phase 1 furnace runs (Ampere, 1092 px
  wide) and 0.9440 in every run since (946 wide), the rows taking twice as long. Its sampling reads none
  of the tables phase 1b changed and builds its lobe as before, and a narrower frame accounts for at most
  a quarter of the change (by coverage). Not explained yet. Next: the same row at the same size on code
  from before phase 1 (the handoff said `main`, which has since merged it).
- A small positive bias, +0.02-0.09%, on metal (1b): the rows slightly CREATE energy, about one standard
  error each. The largest (anisotropy 0.8) is the u axis's interpolation -- 16 cells instead of 8 would
  take it to ~1.0003 at twice the anisotropic tables' memory.
- **Speed.** The handoff made phases 3-6 wait for PERFORMANCE.md P5 (a fraction of the image's rays per
  frame) and bounding volumes, the *Noise library* being too heavy to work in. The volumes and the shell
  have landed -- on the Ampere the Noise library is 988.9 GPU ms a sample with its boxes off, 229.0
  culled, 166.3 with its reliefs in a shell (run 5's rows 8, 9 and 10, each at 15 iterations a sample;
  PERFORMANCE.md STATUS); P5 is not built. Whether the scene is now light enough to work in, the user has
  not said.

**Next, for whoever continues the materials:** phase 3 (masks from the field: cavity, curvature,
exposure), then 4 (mixtures: rust, edge wear, dust, wet). Each phase adds `furnace` / `bsdf-parity`
rows that exercise it, and its objects to one of the demo scenes.

Leather, brushed metal, rough stone, rust, dust, wet, hair: what a surface looks like below the
shape of the object. This file is the phased plan and where it stands. The design reasoning is
summarised first because every phase rests on it.

## The rule every phase follows: one detail, three scales

The same physical relief belongs in a different place depending on its size against what the
renderer resolves:

| scale | what it is | where it lives | cost |
|---|---|---|---|
| **macro** — changes the silhouette | chipped stone, hammered dents, flaking rust | the SDF: a distance modifier on the object | every march step of every ray |
| **meso** — changes the shading, not the silhouette | leather grain, pores, orange peel | a perturbed shading normal at the hit | once per hit |
| **micro** — below a pixel | polish, brushing, oxide | BSDF parameters: roughness, anisotropy, sheen | nothing |

The macro/meso line is set by the code, not taste: normals are taken by differences at
`normalEps()`, which is `marchEps()` (about 1 mm, `lib/pathtracer/core/tracebasics.js`). Relief
finer than a few of those is averaged away by the difference and only slows the march, so it
must be a normal or a roughness. Unresolved slope variance becomes roughness (alpha^2 += sigma^2,
LEAN/Toksvig). A path tracer integrates over the pixel, so meso detail smaller than a pixel is not
biased; folding it into roughness is only noise reduction.

Three things hold for every modifier:

- **Solid, local, in real units.** An SDF has no UVs, so patterns are 3-D functions of `p_local`
  (the hit in its object's frame, so it moves with the object and the timeline), sized in REAL
  units -- `p_local * S_local` with `mm()` / `metres()` -- whatever the scene's unit or the object's
  scale (see *Scale* below). Triplanar only for image data.
- **Deterministic.** `getMaterial2` is called by the shade kernel, the emitter probe, light
  tracing's connection, `field.js`, pick and the medium lookup (`checkInside`, where `n` is zero).
  Anything random inside it makes those callers disagree — the second-caller bug this repo keeps
  repeating. Masks are pure functions of position; expensive ones are skipped on `checkInside`.
- **Energy is checked, not argued.** Every phase adds rows to `furnace` and `bsdf-parity`
  (`lib/pathtracer/tests.js`) that exercise it. A mode nothing executes is code that has never run.

## A relief belongs to the material (the user, 2026-09-30)

"Surface modifiers sit above the object. Ideally a material can or cannot contain a surface modifier, and
when a material is used for an object, the surface modifier gets applied." From a user's side, what a
surface IS -- rough stone, hammered metal -- is its material's to say; wrapping each object in a group to
make it rough put a property of the stuff in the tree's structure, once per object.

So a material may carry a RELIEF (`builder/materials.js RELIEFS`: noise, ripple, hammered, or code of one's
own): a height field, `h` in mm at `q`, the point in the wearer's frame in mm, with `slope` a bound on its
gradient and `amplitude` a bound on `h` that every relief must have. It is the one part of a material in
the SDF: codegen puts it around every object wearing the material (`object()`):

- the object into a Hit of its own (XF_SUB up where local points are read), then `d' = (d - h) / (1 + slope)`
  in the distance's units, folded in BEFORE the object's frame is left -- so `p_local` is the object's;
- in real mm at the frame's TRUE scale: `XF_S / XF_K`, where `XF_K` (scene_api.js) is the product of the
  warp factors in force -- a twist's step factor is not a size, and with XF_S alone the bumps were 1/k big;
- the height clamped to the amplitude in the generated code, so the step bound rests on something true;
- SKIPPED more than two amplitudes from the surface, where `d - amplitude` (towards zero, inside or out) is
  already a safe distance: the noise is paid only near the surface -- phase 6's shell in its simplest form;
- one WGSL function per material (errors at its own lines, once), called at every wearer. Cost: its
  noise per march step near each wearer -- N objects, N evaluations, where one group over them is one;
- its code sees `q` (the wearer's frame) and, if it names it, `world`: the scene's point in mm, the ray's own
  position -- for what is fixed to the scene, not the object. The 3D-print layers read `world.z`, so turned or
  joined parts keep their layers level and lined up, as one print's are (the user, 2026-10-01).
- IN A CSG GROUP, carried through the blend (the user, 2026-10-01: "the blended area does not show lines").
  A smooth blend's fillet lies up to 5/4 of the blend off each child's own surface (csgUnion's `h^2/4k`), so
  the skip above left it bare; and `d'` divided inside the blend made the fillet `1 + slope` times the blend
  set (`smin(x/c, y/c, k) = smin(x, y, kc) / c`). So for an object whose CSG ancestors -- through plain
  groups, up to group code -- form a chain, the band is wider by 5/4 of every blend that reads it (in each group, its
  own join's and every join's after it: version 14 joins in order), the distance goes up
  undivided, and the chain's outermost group divides its result once by the steepest relief evaluated. The
  fillet is the blend set, the relief on it; the pick copy tags the object at its own slope, so a click still
  finds it. Group code ends a chain (it may offset or rescale the field): a twisted part blended with another
  still loses the relief on its side of the fillet. Cost (inferred, not measured): the relief evaluated within
  that wider band, and smaller steps there. `relief.test.mjs` checks it against the true surface in a mirror.
  The division is `foldRelief` (scene_api.js), with the slope collected in `XF_RL`; the noise relief and
  displace modifiers fold through it too (below, phase 6).
- ...AND NOT IN A NORMAL'S LOOKS (0.71.1; the user, 2026-10-20: a hard line on white plaster round a knockdown stucco
  sphere cut from it, gone when both wore one relief). "The steepest relief evaluated" is the steepest within its
  band: the divisor was the stucco's 4.67 within its band and the plaster's 1.11 beyond, and the normal's
  differences across that step turned it by up to 86° (relief.test.mjs; reliefnormal.gpu.mjs on Dawn). A normal
  needs only the field's direction, so its looks read the chain's result undivided (`NORMAL_LOOK`), with one more
  look at the hit for their base in such a scene (`normalAtHitWGSL`; its cost not measured). Not under group code,
  which reads the value off the surface: a line can still show there.

Its parameters are live uniforms (`relief_<name>_<id>`) owned by `<id>#relief`, so the model's parameter
operations, the Properties panel and the parameter registry reach them unchanged. No version change: an
optional field. The groups stay, tagged `surface`, for a relief over a whole assembly or a CSG result.

**Under a modifier the material bends with the shape -- unless it is told not to** (the user, 2026-09-30: a
3D print's layers twisted with its shape). Everything inside a group whose code bends space is evaluated in the
bent space: the object, its relief and its colour code's `p_local`. A group with code can be marked
`straightMaterial` ("material follows the warp", unchecked, in its Properties): the materials of everything in
it are then laid out as if it, and every group inside it, had not bent space, while the shape still bends. A
print's layers stay level, and wood stays put as the shape moves through it. codegen tracks a second frame for
it, `XF_Q` / `XF_QM` / `XF_QS` (scene_api.js), moved by every transform inside and by no warp; the relief and
`p_local` read it, and `R_local` / `S_local` come from it -- so under such a group a grain has its direction
again (a warp zeroes `XF_M`) and `S_local` its true scale. Straight from there down: a warp is code on `p`,
which the generator cannot run on a second point. Emitted only where it is set and something reads a
material's frame; every other scene is the text it was.

## Scale: one rule for the whole program (the user, 2026-09-30)

"Brushed aluminium does not show if the sample sphere is 1 m" -- the library showed every material on a
sphere two metres across, where 0.6 mm streaks are thirty to a pixel. The fix was not a bigger streak but a
rule about what has a size:

| thing | its size | so |
|---|---|---|
| an object from the library (an LED, a lens, one's own) | real: the unit it was kept in | it keeps it in any scene (`insertAsset` converts) |
| a generic shape, modifier or light (the + menu's, in the library) | none of its own (`unit: null`) | 1 unit of the scene it goes into, as + makes it |
| a material's detail (streaks, grain, a relief) | real millimetres: its own parameters marked as lengths, its code reading the point in mm (`p_local * S_local / mm(1.0)`) | the same on a watch and on a door -- and on the door seen whole, below a pixel, as in life; nothing to convert across units |
| a group modifier (twist, repeat, round) | its own frame | scales with what it holds: shaping, not stuff |
| a material's SAMPLE (what it is shown on) | real: `item.preview`, default a 25 mm sphere | its picture and its editor show detail at the size it is |

Built: the sample (`library/studio.js addSample`; brushed aluminium on a 20 mm sphere, turned aluminium on
the face of a 25 mm disc), `unit: null` for the generic items, `mm()` beside `metres()`, and the studio's
surface tolerance taken from each item's own box rather than its batch's (a metre floor and eight items made
it 0.35 mm, an offset of 3.5 mm off a 25 mm sample).

A MATERIAL'S NUMBERS ARE ITS PARAMETERS (the user, 2026-09-30): a colour and a size are sliders and
uniforms, not numbers in its code -- live, no compile. A material's lengths read "(mm)" in the panel and the
Parameters list whatever the scene's unit; the code template shows the idiom. Every built-in material and
every bundled scene's is written so, and `builder/test/literals.mjs` (store.test, scenes.test) fails on a
colour or a length written into one. The sample is one of the studio's shapes (`sampleShape`: a sphere, a
cube, a cylinder, the modifiers' F) at 50 or 200 mm, picked while the item is edited.

THE DEFAULTS ARE REAL SIZES, not the Noise scene's (the user, 2026-09-30: "marble is much too small"). Those
were sized to show each noise on a 40 mm sphere: marble had a vein every 21 mm and detail down to 1 mm. Each
built-in material's size was set against the thing itself -- marble's veins 5 cm apart wandering over 20 cm,
terrazzo's chips 10 mm set close, concrete's stains 30 cm, rust's patches a few cm, granite's crystals 4 mm,
wood's rings 3 mm about a heart 15 cm to one side -- and checked by eye on a flat swatch of each pattern at
50 mm, 200 mm and 1 m (the base colour only, drawn from the noise library's JS mirror). The large ones are
shown on the 200 mm samples. The Noise library scene keeps its own: it shows the noises, on 40 mm spheres.

The other half, not built: detail below a pixel. The path tracer averages it over the pixel -- unbiased --
so a door in brushed aluminium seen whole shows the anisotropic sheen (a BSDF property, scale-free) and not
the streaks, which is right. What phase 5 adds is the same height function turned into a bump when it is
finer than the march resolves, so one pattern is geometry, bump or roughness by its size against the view.

## Phases

### Phase 1 — Grain: anisotropy with a direction  *(built; frame verified on hardware)*

Anisotropy existed (`Material2.anisotropy`, the anisotropic GGX with exact pdfs) but had no
direction: `makeLobes` built its frame from `mtlOrthonormalBasis(n)`, whose tangent is
`cross(n, z)` — horizontal in the WORLD, so rotating an object never turned its brushing, and it
switched to `cross(n, y)` where |n.z| >= 0.999, a seam on the cap of a sphere.

- `Material2.tangent` (world space; zero = no preferred direction, the old frame exactly).
  `makeLobes` projects it onto the surface and builds the frame from it. Every consumer — eval,
  pdf, sample, light tracing's connection (`ltConnect`; `ltEvalBsdf` once) — goes through `makeLobes` with the same material, so they agree by
  construction.
- With a tangent, **anisotropy has a physical sign**: the tangent is the direction the grain runs
  (the grooves, the brush strokes); positive is smoother along it and rougher across it, which is
  what brushing does, and draws the highlight out across the grooves. Negative is the other way.
  Without a tangent the old formula stands untouched, so no existing material changes.
- The frame of the hit: `localPoint()` also records `HIT_FRAME`, the rotation local -> world of
  the surface that won (zero under a warp, which falls back to the old frame). Material code gets
  it as `R_local` next to `p_local`.
- Helpers (`core/materials.js`): `grainAlong(R, axis)` (linear brushing), `grainAround(R, q, axis)`
  (turned / spun metal, circles about an axis), `grainRadial(R, q, axis)` (spokes).
- Library: *brushed aluminium* becomes brushed (it had anisotropy 0); *turned aluminium* added.
- Verified here: check-shaders (a grained material under CSG and a warp in its coverage scene).
- **Measured** (Ampere, 32 samples, 2026-09-29). `bsdf-parity`: brushed metal 3077.2 / 3074.5
  (NEE on / off, 0.09%), turned metal 4889.8 / 4893.5 (0.08%), brushed plastic 18570 / 18456
  (0.6%, the same as the isotropic plastic pair's 0.84% on the same run) — the frame is one frame.
  `furnace`: turned metal, rough 0.5, anisotropy 0.8 reads **0.988** with NEE on and off alike.
  Not the frame: see 1b.

**The demo scene** is `scenes/surfaces.json` (*Surface materials*): a product shot in millimetres,
so every pattern is at its real size -- a row of 40 mm spheres and a row of rounded 70 mm boxes in
the library's materials (brushed at the library's 0.6 mm and at a coarse 2.5 mm, turned, glass,
frosted, metals, plastics), under a 500 x 300 mm glowing panel. The panel is an EMITTER material,
not a light node: a light node's face is seen only by the camera directly, so a chrome sphere would
reflect it dark; an emitter is found by every path. Each new surface phase adds its objects here.

**1b — anisotropic energy compensation** *(built; measured, below)*. The multiple-scattering
tables (`mfE1`, `mfEc`, `microfacet.js`) were indexed by one roughness, so an anisotropic lobe was
compensated as the isotropic one with the same geometric-mean alpha. Integrated directly (JS, this
GGX, 2026-09-29), the true albedo differs from that by up to 0.10 absolute at roughness 0.5,
anisotropy 0.8, and it depends on the view's AZIMUTH: about 0.82 against 0.91 head-on, 0.84 against
0.93 at grazing along the rough axis. No single effective roughness fits -- the geometric mean is off
by 0.10, the alpha projected on the view's azimuth by 0.15 -- and the dielectric coat is off as much
(0.11, mostly at grazing where Fresnel is large), which in the Kulla-Conty coupling would hand the
base light the coat reflected: energy created.

So the tables gained two dimensions, for anisotropic materials only: u = log10(alpha_rough /
alpha_smooth), 0..1, and phi, the direction's azimuth from the rough axis, 0..90 degrees. E1
[r][u][mu][phi], Ec [ior][r][u][mu][phi] and its mean over every direction [ior][r][u]; 8 x 8 in
(u, phi), u log-spaced because the ratio changes fastest near |anisotropy| 1, which interpolates to
0.0012 mean / 0.009 worst -- as well as 12 x 12 evenly spaced. 4.5 MB in the `learn` buffer, computed
at init by the same kernel as the rest (one dispatch, 1.1 M entries of 1024 samples). The alphas
come from one function (`mfAnisoAlpha`) that both the lobe and the tables use. Isotropic materials
read the old tables through the old code. Checked here: every table word is written exactly once
and read where it was written (a scratch mirror of the index arithmetic), naga compiles the kernels.

**Measured** (Ampere, 946 x 1061, the sphere 81% of the frame by the control row, 2026-09-29):
anisotropic metal 0.5 / 0.8 read 1.0009 and 1.0008 (NEE off), -0.8 1.0008, 0.7 / 0.95 1.0001;
anisotropic plastic 1.0000, 1.0000 (NEE off), ior 2.4 1.0000 -- from 0.9878. But metal 0.3 / 0.5
with no grain read **0.9966**, six standard errors low. A white metal on a convex sphere in a uniform
world shows exactly E_true / E_table per pixel, so each row can be PREDICTED from the table grid
without a GPU; the prediction gave 0.9998, 1.0006, 0.9971, 0.9999 for the four metal rows measured
at 0.9996, 1.0009, 0.9966, 1.0001 -- the shading is right, the tables are what is off. Doubling any
interpolation axis left 0.9971 where it was; the ENTRIES were wrong: a regular 32 x 32 grid resolves
badly the sliver of reflections lost below the horizon, and overstated the albedo by 0.3-0.7% at
roughness 0.3, isotropic tables included (a white isotropic metal of roughness 0.3 predicts 0.998;
the furnace had no row there). The grid is now warped toward that rim (microfacet.js prog_mf_lut):
worst entry error 0.0010 from 0.0073 at the same cost, and every predicted row within 0.1% of 1
(0.3 / 0.5: 1.0005; 0.3: 1.0002; 0.15: 1.0003; 0.15 / 0.8: 1.0002; 0.5 / 0.8: 1.0009, the u axis's
interpolation). The furnace gains isotropic metal 0.3 and 0.15 rows.

**Measured after the warp** (same machine and size): every metal row within 0.1% of 1 and each where
the grid predicted it -- isotropic 0.5 / 0.3 / 0.15 read 1.0003 / 1.0002 / 1.0002 (predicted 1.0003 /
1.0002 / 1.0003), 0.3 / 0.5 no grain 1.0004 (1.0005), 0.5 / +-0.8 1.0008-1.0009 (1.0009), 0.7 / 0.95
1.0002; anisotropic plastic 1.0000-1.0001. Phase 1b is done. What is left is a small positive bias,
+0.02-0.09%: the metal rows now slightly CREATE energy, at about one standard error each. The largest,
+0.09% at anisotropy 0.8, is the u axis's interpolation; 16 u cells predict 1.0003 there, at twice the
anisotropic tables' memory (9 MB) and start-up integration.

**Rough glass** reads none of these tables, yet read lower in every run since them: open, see STATUS.

**1c — visible streaks** *(the roughness part built; not yet confirmed seen)*. Real brushed and
turned metal shows individual lines, not only a stretched highlight: the abrasive or the tool leaves
grooves of different depths, and the deeper ones read separately. Streaks exist at every scale of the
rule above, and each scale has its own phase:

- **as roughness and brightness per line** — built: `streaksAlong` / `streaksAround`
  (`core/materials.js`) give a value per line from solid value noise (`srfNoise`, a pure function
  of position), constant along the grain for a length and changing across it every width, both in
  real mm (`p_local * S_local / mm(1.0)` in the library's code; `S_local` is the object's scale,
  captured with the frame). The library's brushed and turned aluminium use it, with `streakWidth`,
  `streakLength` (mm) and `streaks` (contrast) as live parameters. Each point is still a sound BSDF,
  so energy is untouched.
- **as a normal tilted across each groove** — how a single deep scratch catches the light, and what
  makes streaks read at a glance: phase 5, driven by the same streak field as a height.
- **as geometry** — grooves resolved by the SDF: a turned part's feed marks, knurling, a record's
  spiral: phase 6. (Diffraction by fine grooves — the rainbow on a CD — is wave optics and outside
  this renderer.)

### Phase 2 — A noise library with known bounds  *(built; checked without a GPU; rendered on hardware, STATUS)*

`lib/pathtracer/core/noise.js`, in the scene prelude, so the SDF and material code both have it. Each
function returns its analytic gradient with its value (vec4: grad, value), is a pure function of
position and seed (pcg4d on the cell, never the PRNG), and has a JS mirror next to it for the test:

- `vnoise3` value noise, [-1, 1]. Bound PROVED: 3.75 per axis (the quintic fade's 15/8 times a corner
  difference of 2), 6.50 in all. Steepest found 3.73.
- `gnoise3` gradient noise (Perlin, quintic), scaled by 1.6 to span about [-1, 1] (-0.98 .. 1.00
  found): corner gradients lie in the unit ball, so the raw sum reached only +-0.63, and an amplitude
  should mean a height. Bound PROVED 17.19 (loose: a convex mix of gradients plus the fade's slope
  times the corner terms' spread); MEASURED 4.3 -- the steepest a scatter-then-climb search found
  over three seeds, 3.437, times 1.25. A quarter of the proved one, so a quarter the march steps. A
  longer search finds steeper (2026-09-30): 3.581 from other starts, 3.854 over a million cells for each
  of seven seeds -- so for ONE octave 4.3 is 12% above the steepest found, not 25%, and the test claims
  no margin there, only that its search stays within it (`noise.js` GRAD_MEASURED). The 25% is held
  where the bound is used, the relief's four octaves: their summed bound is 17.2 against a steepest found
  of 8.905, and a bound measured for that fBm itself, 11.2 (`NZ_RELIEF_LIP_MEASURED`), keeps 25% over it
  too -- the benchmark's row 11 only, not yet timed or seen (PERFORMANCE.md STATUS).
- `fbm3` octaves of gradient noise, own seed each; `nzFbmLip` sums the bound over them (and, at
  lacunarity 1, the amplitudes: the peak). 5 octaves: steepest 9.1, bound 21.5.
- `worley3` F1, F2 and a number per cell. Feature points in the middle 0.46 of their cells, which
  PROVES the 27-cell search finds the true nearest (farthest same-cell point sqrt 3 (1/2 + J/2) <=
  nearest two-cells-away 1.5 - J/2); F2 also agreed with a 125-cell brute force at all 100 000
  points. F1 and F2 are 1-Lipschitz. The price of 0.46 is a visibly regular cell layout; a
  full-jitter variant needs 125 cells and belongs in material code, not an SDF.
- `worley3x` the same four numbers from two worley3 point sets at once, the second turned and its
  cells 1.37 the size, each scaled so together they have one point per unit volume (a size means
  what it did). The cells are the Voronoi cells of both sets, so they keep to no grid and vary in
  size -- galvanised steel's spangles sat in rows (the user, 2026-09-30). Each set's F1 and F2 are
  exact, so the union's are the smallest two of four: still 1-Lipschitz, agreeing with a sorted
  125-cell search at every point tested. Twice worley3's cost: the library's cell materials use it
  (granite, rough stone, leather, terrazzo, cork, concrete, galvanised steel); the hammered relief,
  which pays it at every march step, does not yet.
- `perMm(cycles per mm)`: frequencies in real units.

**The demo scene** is `scenes/noise.json` (*Noise library*), on the same stage as *Surface materials*:
spheres whose material is each function in turn (value and gradient noise, fbm marble, Worley spots,
leather creases from F2 - F1, granite grains from the cell number), and a row of **noise relief**
modifiers -- 1 mm at 10 mm, 3 mm at 25 mm, 0.3 mm at 2 mm on grey spheres, and on boxes of leather
and marble, beside a box of *rough stone* whose material carries its relief (granite, 1.5 mm / 8 mm)
-- so a pattern and the relief it would sit on are seen together.

**Compile time** (2026-09-29): the *Noise library* compiled for over a minute, and the cost was not the
noise but the copies of the scene each kernel held -- each SDF() call is the whole scene, inlined: 32 in
the march, 38 in occlusion, about 32 in shade, now about 1, 2 and 6 (`noUnroll`, and the local point
captured once per getMaterial2). The noise library's loops are opaque too (the test fails on a loop whose
bound the compiler can see). The story is `lib/pathtracer/README.md`'s *Every call to SDF() is a whole
copy of the scene*; what a compile is made of since, PERFORMANCE.md.

`test/noise.test.mjs`: gradients against differences, continuity across cell faces, ranges, every
bound under a dense search, Worley against brute force, determinism. The builder's **noise relief**
modifier displaces with `fbm3`, dividing by the measured bound (the old `displace` guessed from its
sines); check-shaders compiles it and a material using every function through every kernel, and was
shown to catch a broken noise function. Streaks (phase 1c) use `srfNoise` (bound 15/8 per axis), now a
thin wrapper over `vnoise3` mapped to [0, 1]: the same hash, channel and fade its own copy had
(`core/materials.js`).

### Phase 3 — Masks from the field

Where weathering actually goes, computed from the SDF at the hit — the one thing SDFs give for
free that meshes do not:

- **cavity** — `SDF(p + n k) < k`: crevices, where dirt and rust start;
- **curvature** — the Laplacian of the field (6 evaluations): convex edges wear, concave collect;
- **exposure** — `n . z`, optionally an upward occlusion march: dust settles, streaks run down.

Material-code helpers; skipped on the medium lookup. Test: the masks on the bench's known shapes
(a sphere's curvature is 2/r) through the pick kernel or a no-GPU mirror.

### Phase 4 — Mixtures: patches, edge wear, dust coverage, wet

A material that is two materials and a mask. At meso scale the mask is sharp and one material is
CHOSEN per point — exact, and `mixMaterials`' parameter blend (which is not a mixture of BSDFs) is
not used. Library: patchy rust (noise x cavity x downward streaks), edge-worn paint (curvature),
dust (exposure), wet (a water film: a smooth n = 1.33 coat that darkens the base by trapping).
Rows: a 50/50 checker of two materials must read the mean of the two alone.

### Phase 5 — Meso normals: bump that conserves energy

The one core change with real risk. Material code gets a height (or its gradient) and the shading
normal follows it — through BOTH `processMaterial_advanced` and `ltConnect`, or the two sides of
light tracing shade different surfaces. A naive shading normal loses or creates energy and breaks
reciprocity; the method is microfacet-based normal mapping (Schüssler et al. 2017), which the
`furnace` and `bsdf-parity` rows can then hold to the same standard as every other lobe. The same
height function as Phase 6, so one pattern is geometry or bump by its scale.

### Phase 6 — Macro relief: displacement in a shell

The `displace` modifier made general and affordable: march the base SDF (conservative at
`d - A`) until within the relief's amplitude A, only then evaluate the noise, with the step scale
from Phase 2's bound instead of a guess. Library: rough stone, hammered metal, leather at macro
scale, flaking rust.

**The shell is built for the noise relief (2026-09-30, `builder/modifiers.js`; measured in the benchmark's
fourth run, 156.0 ms a sample against 202.3, -22.9%, and the pictures identical to the user's eye --
PERFORMANCE.md STATUS).** Its height is not A. The noise reaches about 1.05 A in a search and is PROVED
to stay within 1.386 A (`noise.js` NZ_GRAD_VALUE_BOUND), so `d - A` would have cut its peaks off. It is
used only where nothing above the relief reads its field away from the surface (codegen `SURFACE_ONLY`: not
under a smooth blend or group code, where the flat field out there would change the shape).
`builder/test/relief.test.mjs` checks it on the real noise.

**Through a smooth blend (the user, 2026-10-01: "fix the noise relief modifier too").** Under a blend the shell
was off, so the fillet had the noise -- but the code divided by its slope before the blend, and
`smin(x/c, y, k)` is not `smin(x, y, k) / c`: the fillet on the relief's side came out the wrong size. The
template now reads two names codegen gives a group's code, as it gives `SURFACE_ONLY`: `READ_REACH`, how far
off its surface anything above reads it (0 at the root and under plain unions, 5/4 of the blends above in a CSG
group, unbounded under group code), which moves the shell's edge out rather than turning it off; and
`DIVIDED_ABOVE`, passed to `foldRelief`, which then folds the distance undivided and leaves the division to the
outermost CSG group, once, after the blend -- as for a material's relief. Displace folds through it the same
way. At the root both are what the code did before (the Noise library's five relief groups; the benchmark's
frozen copy, from before rough stone carried its own, has six). Code saved before keeps
`SURFACE_ONLY` and its old behaviour: a modifier is the document's code, and nothing rewrites it.

### Phase 7 — The missing lobes

- **Sheen** (velvet, peach fuzz, the grazing brightening of dust) — commented out of `Material2`.
- **A coat over anything** — a clear dielectric over a metal (lacquer, car paint), gone with
  `clearcoat`.
- **Thin film** — tarnish, heat-tinted steel, anodised titanium, anti-reflection coatings on
  lenses: interference, not a colour. RGB per channel until the planned spectral bands.
- **Dust as a layer** of optical depth tau: base seen through exp(-tau/mu_o) exp(-tau/mu_i),
  reciprocal, and brighter at grazing as real dust is.

### Phase 8 — Optical textures as geometry

For this tool the case where a BSDF shortcut is wrong: the optics trace measures flux, so etched
glass, microlens arrays, prism films and corner-cube retroreflectors are domain-repeated SDF
geometry, verified against known answers (a retroreflector returns light to its source; a lens
array's far field). PLAN.md already notes a textured lens reads a little too absorbing.

### Phase 9 — Hair and fur  *(a project of its own)*

Not a surface modifier: fibres with their own scattering (R, TT, TRT — Marschner, d'Eon, Chiang).
With SDFs: strands by domain repetition in a shell (simple shapes only), or fur as a volume with a
fibre phase function (SGGX), which is the physical route. Peach fuzz and velvet only need Phase 7's
sheen.
