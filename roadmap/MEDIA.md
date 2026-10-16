# Media: dust in the air, and what comes after it

**STATUS (2026-10-16).** Phase 1 (a haze box, physical dust in the full renderer) is **built, 0.62.0, and seen working
on hardware by the user** ("the dust works in the images. I tried various scenes", 2026-10-16). Its `haze` bench row's
first press measured nothing: the test's camera orbited the view's own target and looked at sky (fixed in 0.62.1). The
second press (0.62.1) measured: both controls well below 1, and the dust's rows 0.03-0.08 % under the box hidden -- paths
lost to a collision placed inside the sphere, which 0.62.2 fixes (the collision drawn as a leg starts, in the march). The third
press (0.62.2) answers it: the dust with NEE off within 0.002 % of no box, with NEE on within 0.024 %, both controls well
below 1 (docs/TESTING.md has the row). Phases 2 to 4 are open. How phase 1 works is `lib/pathtracer/README.md` § *Dust in the air*, and
`lib/pathtracer/core/haze.js`'s header.

## The ask

The user (2026-10-16): "dust particles in the air. Should be realistic and a way to visualise rays. If it helps, it
could be inside a certain box only, so it does not add scattering in transparent materials. On the other hand, maybe
it could be a feature of a material as well. If a ray has moved XX, random chance it has met a scattering particle;
if so, move back some random YY distance and scatter towards the camera? Or use photon mapping so scattered rays are
also visible through glass?"

Decided with the user (2026-10-16), from three options each:
- **Where:** a haze box node in the builder, not the whole scene's air (the default 400 m radius would fog everything
  far away), and not a material property first.
- **First:** physical dust in the full renderer, not the Optics view's beam visualisation.
- **Density:** physical, real units: mean free path in metres, albedo, g.

## The physics, and the user's sketch

Each part of the sketch is a standard estimator, and the engine uses each as it is:
- **"Moved XX, a random chance it met a particle, move back YY" is free-flight sampling.** On a leg crossing the dust
  over [t0, t1], t = t0 − ln(1 − u)/σ_t, a collision if t < t1. Weighed by the albedo when it collides, by 1 when it
  does not. Exact.
- **"Scatter towards the camera" is light tracing's connection,** from a point in the dust (`ltConnectMedium`).
- **The camera's dual is light sampling from the point, against the phase function's own draw by MIS** (`mediumNee`).
- **"Photon mapping, so it is visible through glass" is a volume photon map:** phase 2.

## The scale, said plainly

Inferred, the arithmetic not measured. A beam w across, of irradiance E, seen side on in dust has a luminance of about
σ_s p(90°) E w. The white floor it lights has E/π. The ratio is π σ_s p(90°) w. For w = 1 cm, mfp 10 m and g = 0.7
(p(90°) ≈ 0.022/sr) that is about 7e-5. Dust dense enough to show the beam (mfp of centimetres) dims it over 25 cm.

So physical dust shows beams:
- at room scale;
- looking into the light (forward scattering);
- against a dark surround.

This is why a thin-limit "beam view" for the Optics view is phase 4, a visualisation rather than physics. The example
*Beam in dusty air* uses a mean free path of 0.3 m in a dim room.

## Phase 1 — a haze box (0.62.0, built)

What is in it, briefly (the README has the rest):
- **Builder:** a `haze` node (`builder/hazebox.js`, scene format 22), one a scene, a box like the export box.
- **Scene:** codegen hands it over as `scene.haze`, in the world, in the scene's unit.
- **Engine:** DERIVED uniforms, and the kernels' code only for a scene with a box.
- **The collision:** drawn as a leg starts and kept in the ray's `tmax`; the march stops the ray there (`RAY_SCATTER`).
  0.62.0 decided it after the march, from the leg made again from its far end, which lost light (0.62.2: see below).
- **The vertex:** made in shade, with the photon's connection, the camera's light sample by MIS, and the phase draw.
- **Shadow rays:** dimmed by the haze from their vertex.
- **The photon map:** to it a point in the dust is EV_OTHER.

**What to look at (the user, on hardware):**
1. File › Examples › *Beam in dusty air*, in Standard. The beam from the lens is visible in the dust, brighter from
   the side the camera looks into it from, and dimmer along its length. The PMMA block in the beam is clear inside, and
   the spot on the screen is dimmer than with the box hidden.
2. The same in Draft: the beam, without the dust's own glow around it (single scattering only).
3. Drag the box, stretch it with the gizmo's cubes, and change its mean free path, colour and g in Properties: live,
   no compile. Hide it with the eye: a compile (as any node, unless live visibility is on).
4. Press `haze` (Tests) and paste it back: ratio 1 on every row but the control. The `secs` say what the dust costs.

**Not done in phase 1:**
- The Optics page's numbers do not include the dust.
- Light scattered in dust is seen through glass only by the camera's own paths.
- The builder lights' photons in dust are untested on their own. The GPU test's photons are the sun's, off a mirror.
  A light's photon leaving its face starts a leg like any other (newRay: ltot and absLtot 0), so it collides as one;
  that is inferred from the code. The example puts its LED inside the box.

## Phase 2 — a volume photon map (open)

The class light → delta+ → M → delta+ → eye: a beam seen through a lens or a window, or in a mirror. Photons would be
stored at their medium vertices after TAG_PASSED, with a volume flag in the record (the record's normal unused). A
camera's medium vertex with lens field 1 would gather in a sphere:

    L += β α p(ω_p, ω_c) Φ_p / (σ_t · 4/3 π r³)

with the camera's free-flight weight. The medium vertex becomes the map's D in `lensStep`. The radius schedule in 3D
is to derive and test: Knaus & Zwicker's for volumes, inferred to be r_{i+1}³/r_i³ = (i + α)/(i + 1), which is to be
checked. A JS mirror against a closed form would come first (`sppm.test.mjs`'s style): a beam in dust seen through a
glass slab. A beam radiance estimate along camera rays (Jarosz 2008) is far less noisy, but walks the hash grid along a
ray. It is a later choice, measured.

## Phase 3 — scattering inside materials (open)

Milky glass, smoke in a dome, an opal diffuser at low density. The ray has to carry σ_s and g as well as the absorption
it carries now (`muR/G/B`). That takes the Ray from 112 to 128 bytes: (2·112 + 272) = 496 → 544 bytes a ray, about 9 %
fewer rays a batch at the cap (read in code, not timed). The collision would read the ray's own medium instead of the
box. From outside, such glass glows only through phase 2: light reaches the inside through a refraction, and gets out
to the camera through another. A dense diffuser (hundreds of scatters) is a surface's job, not a random walk's.

## Phase 4 — beams in the Optics view, and less noise (open)

- **The thin-dust limit:** in-scatter without extinction or deflection, brightened by a setting in stops, for the
  lights' photons only. The very-thin limit is physics, exposed up: a way to see rays that physical dust at lamp scale
  cannot give. A photon's leg through the box would connect at a point drawn on it, every leg, sharing the one shadow
  ray a vertex with the surface's connection by a fair coin.
- **Forced collisions** (a photon made to collide on a leg with a probability above 1 − T, weighed back) and
  **equiangular sampling** towards a light's face for camera legs. Each one only with a bench row that measures the
  noise at equal time.
