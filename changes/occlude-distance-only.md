bump: minor

**Shadow rays ask the scene for its distance only, as the march does: the occlusion kernel 8-83 % less GPU time on five
of six bench scenes, the same picture** (`lib/pathtracer/core/wavefront.js` prog_occlude and prog_occlude_emit). Every
shadow-ray step asked the scene for its whole answer and read one number of it, whether anything is in the way.
- **Now a step asks only that number.** The occlusion kernel is built against the same distance-only `fold` the march
  uses.
- **The exception, handled separately.** One shadow ray asks more: one aimed at a glowing surface, when something blocks
  it, takes the emission of what it met.
  - The distance-only kernel cannot answer that. So it marks the ray where it was blocked and leaves it in the queue, in
    the slot it held.
  - A small kernel of its own, holding the whole scene (`occlude_emit`), then asks the material at that ray and adds the
    emission, exactly as before. It runs after every round's preparation and once after the sample's last round.
  - The preparation sizes that kernel at zero when nothing was marked, so a scene with no glowing surfaces pays only
    for the empty dispatches.
- **Measured on your Pascal**, Tests › occludedist (`ShadyTracer 0.78.0 · 64535ad (ccr-0f3a020a-590jz2) · nvidia
  pascal`, 2026-10-25), GPU ms a sample, before → now:

  | scene | occlude (+ occlude_emit) | the whole sample |
  |---|---|---|
  | dichroics, its light's photons | 34.6 → 31.5 + 0.5 | 324.3 → 327.8 |
  | the Noise library | 40.9 → 50.1 + 2.3 | 165.4 → 196.0 |
  | the Menger cubes | 22.6 → 17.4 + 0.3 | 96.2 → 91.0 |
  | the showcase | 6.5 → 3.5 + 1.8 | 51.8 → 48.4 |
  | the material test | 4.9 → 4.1 + 0.2 | 46.7 → 43.5 |
  | the optics bench | 29.3 → 4.7 + 0.2 | 69.2 → 43.1 (−38 %) |

  Its drift row read −1.2 %.
  - **The Noise library's row is not understood.** Everything in its second row was slower, the march included (72.1
    → 87.4), and this change does not touch the march. The likely cause is the card's state during that row, not the
    change, but that is not shown.
  - **The shadow queue looked slower to drain** on the Menger cubes and the Noise library, with more shadow rays cut at
    the end of the sample. The two rows logged different samples: the shadow-ray counts already differed before any
    occlusion ran. On a software GPU both scenes' shadow rays go through every round the same both ways (below).
  - **Always on, as you asked:** it was the developer setting Shadow rays on distance only for that run, and the
    setting is gone, with Tests › occludedist. A workspace that saved it has it ignored.
- **The same picture.** You saw it identical. On a software GPU (`builder/test/occludedist.gpu.mjs`):
  - **The scenes' own shadow rays** (the optics bench as code and as data, the showcase, the material test, dichroics,
    the Noise library, the Menger cubes, Dusty beam), through the full kernel and this one: every deposit bit for bit,
    and every round's queue the same, with as many cut.
  - **Glowing-surface shadow rays at panels by hand**, one panel asking for its own point, also inside a haze box: the
    frame bit for bit.
  - **The whole renderer**, as built and with the full occlusion kernel put in its place: every pixel bit for bit, but 2
    of the showcase's 768 in f32's last place (1.5e-7). That is the same light added in another order: a blocked
    glowing-surface ray's light now lands one round later, among atomic float additions.
  - The march's own test now has the Noise library and the Menger cubes too, bit for bit.
- **Memory and compiling:** one more kernel a scene (16 where there were 15), and 16 bytes.

**What to look at:** your scenes, a glowing surface among them and the Menger cubes: nothing in the picture should
differ, now that there is no switch to compare with. The Performance box has one row fewer, and Tests has no
occludedist.
