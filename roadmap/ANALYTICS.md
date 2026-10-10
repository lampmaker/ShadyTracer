# Optics analytics: the conventions decided, and what is open (2026-10-02)

The user's request (2026-09-27): better analysis of traced light sources, with **charts and polar
charts of both illuminance and intensity (over angle)**. Most of it is built -- the far field and its
numbers, the polar and I–γ charts, the detector map with isolux lines, profiles, rings and encircled
flux, the far field on a plane, CSV and PNG (FEATURES.md 3.4 and 3.5; `lib/pathtracer/optics/README.md`).
This file keeps the conventions the user decided and what is still open. The first plan's use cases,
requirements and questions were trimmed to these on 2026-10-02; git history has them.

## Decided (the user, 2026-09-27)

1. **γ = 0 along the light's axis** (its +z, where it shines); C = 0 along its +x.
2. **What feeds the far field is a choice**: every escaping ray, or the rays arriving at a specific
   detector made to catch the light of interest.
3. **Resolution adjustable** (γ step, C step).
4. **Unit adjustable** (cd or cd/klm).
5. **The polar plot first.**

A sixth, the charts as tabs over the picture (the viewport's `addTab`), was overtaken by the docked
panels (UI_PLAN.md sections 6 and 9); `addTab` is gone.

## Open

### Use cases not yet served

Numbered as the first plan had them; each says who is asking and what decides something.

2. **Checking a ray file against its datasheet.** Load the OSRAM Zemax file, trace it with no
   optics, and compare its far field with the datasheet's polar curve. That also **settles the ray
   file's rotation convention**, which the optics README still calls unverified: a rotated file shows
   up as a tilted distribution. Needs: a polar plot with a datasheet curve overlaid (typed in or loaded
   from CSV / IES), normalised to the same peak or to cd/klm (C6).
3. **An asymmetric luminaire** (street light, wall washer, a lens that makes an oval). The full C-γ
   grid and several C planes on one polar plot are built; still needed: an **isocandela map** (I over
   C and γ as a false-colour image or contours) (C3).
6. **Near field vs far field.** A real detector close to the lens and the virtual plane at the same
   distance disagree when the luminaire is too big for its distance. Each can be drawn today, one at a
   time (the map's source: a detector, or the far field on a plane); showing both on one profile chart
   is the check, and needs C6. Also: **I = E d²** from a detector at distance d, which is how a real
   goniophotometer measures, as a cross-check of the far-field tally.
8. **Quality of a collimated beam at a surface.** Does the light arrive parallel? Needs: a
   histogram of **arrival angles** on a detector, from the arrival directions already recorded (B6).

IES LM-63 / EULUMDAT export, the rest of the first plan's use case 9, is PLAN.md phase 5.

### Requirements still open

- **A4. Detector maps binned on the GPU**, the same way as the far field, so an analysis is not limited
  to 500 000 hits (`MAP_HITS`, `optics/page.js:1045`) and no batch is left out. The
  per-hit records stay for CSV and for the smoothing methods, which need positions.
- **B4, a tilted plane.** Illuminance from intensity is built for a plane square to the photometric axis
  at a distance h (`virtualPlane`, `lib/pathtracer/optics/illum.js:214-220`, which takes h and nothing
  for a tilt); a wall or a road at an angle is not.
- **B6. Arrival-angle histogram** per detector (use case 8).
- **C3. Isocandela map**: I over (C, γ) in the Turbo colours the detector map already uses, so the
  colours mean the same thing everywhere.
- **C6. Compare**: pin the current result as a reference and draw it dashed under every later one;
  overlay a curve loaded from CSV or IES (use case 2). The reader is also PLAN.md phase 6; the pinned
  reference is UI_PLAN.md section 7's too.
- **Colour against angle** (FEATURES.md 3.4 lists it here): the far-field grid tallies flux alone
  (`optFarAdd`, `lib/pathtracer/optics/kernels.js:223-238`); CCT, x and y over angle need X and Z per
  bin as well.
- **Two GPU benches**, rows in `lib/pathtracer/tests.js` for the user to press: the virtual plane
  agrees with a real detector placed far enough away (use case 6); the OSRAM file against its
  datasheet (use case 2). `optics-farfield` covers the closed forms and a detector-fed grid, not these.

**The order proposed** (2026-09-27, after intensity and illuminance, both built): comparison first (C6,
with its CSV / IES reader), then scale (A4, B6).
