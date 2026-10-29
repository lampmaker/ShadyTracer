bump: patch

**Translucent and scattering materials, investigated: `roadmap/DIFFUSERS.md`.** Nothing built. The document weighs
three routes against the engine as it is. One is a translucent surface lobe, for opal sheets. Another is a
forward-peaked transmission lobe, for narrow-angle diffuser films. The third is the haze box's free flight made a
material's own medium, for light guides and thick milky glass. Each is weighed for what it costs, how accurate it is,
and where light can be found from. The deciding fact: a scatter inside smooth glass can never sample a light, because
the glass's own wall blocks every shadow ray. Such a volume is exact on the Optics page, but in the picture it is lit
only by chance until there is a volume photon map. Pointers are in `MEDIA.md` Phase 3, `PLAN.md` and `SURFACES.md`
Phase 7.

**What to look at:** read `roadmap/DIFFUSERS.md`, its table and its suggested order, and pick what to build first.
