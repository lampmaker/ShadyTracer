bump: minor

**Shadow rays can ask the scene for its distance only: a developer switch, off by default, with its bench** (Developer ›
Performance › Shadow rays on distance only; `lib/pathtracer/core/wavefront.js` prog_occlude and prog_occlude_emit). The
march asks only the distance since your run of Tests › marchdist (8-79 % less march time). In that run shadow rays took
6-35 GPU ms a sample, every step asking the scene for its whole answer and reading one number of it.
- **On, a shadow-ray step asks only that number.** The occlusion kernel is built against the same distance-only `fold`
  the march uses.
- **The exception, handled separately.** One shadow ray asks more: one aimed at a glowing surface, when something blocks
  it, takes the emission of what it met.
  - The distance-only kernel cannot answer that. So it marks the ray where it was blocked and leaves it in the queue, in
    the slot it held.
  - A small kernel of its own, holding the whole scene (`occlude_emit`), then asks the material at that ray and adds the
    emission, exactly as before. It runs after every round's preparation and once after the sample's last round.
  - The preparation sizes that kernel at zero when nothing was marked. A scene with no glowing surfaces pays only for
    the empty dispatches.
- **Off is off.** The shadow-ray kernel, its preparation and every other kernel are byte for byte what they were, and the
  extra kernel is not built.
- **What was checked here, on a software GPU** (`builder/test/occludedist.gpu.mjs`; counts and pictures, never times):
  - **The scenes' own shadow rays**, through the full kernel and the distance-only one: every deposit bit for bit. The
    scenes: the optics bench as code and as data, the showcase, the material test, dichroics, Dusty beam.
  - **Glowing-surface shadow rays at panels by hand**, one panel asking for its own point, also inside a haze box: the
    frame bit for bit. Rays were marked and resolved, and none went past the queue's room.
  - **The whole renderer, off against on:** every pixel bit for bit on the scenes without glowing surfaces and on the
    panels by hand.
    - The showcase (7 glowing surfaces found) had 2 pixels of 768 differing in f32's last place (1.5e-7).
    - That is the same light added in another order: a blocked glowing-surface ray's light now lands one round later,
      among atomic float additions.
- **Tests › occludedist** is the bench for it: each bench scene off and on, baked, dichroics first with its light's
  photons and the photon map on. It has a column for the extra kernel's time.
- **Memory:** 16 bytes more, the extra kernel's dispatch arguments.

**What to look at:**
- **The picture.** Switch Developer › Performance › Shadow rays on distance only on and off on your scenes, including
  one with glowing surfaces. It should not change.
- **Run Tests › occludedist on your card and paste the whole report.** Read each scene's occlude down its two rows,
  and occlude_emit beside it. If it pays, it gets hard-coded on and the switch removed, as the march's was.
