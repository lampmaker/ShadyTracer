bump: patch

**Render stats: the numbers averaged over the picture's samples, so they settle instead of jittering**
(`lib/pathtracer/core/utilities.js`, `lib/render-cost.js`). You asked for the readout averaged over the samples, since
its values jittered a lot.
- **Why they jittered:**
  - The Speed numbers (samples a second, per sample, CPU, queue, loop) were short moving averages, spanning about the
    last five frames.
  - A frame's interval swings with two frames in flight and a sample split over several.
  - The photon map's photons were its last sample's.
- **What they are now:** once the picture is about a second and eight frames old, each is the mean over the picture's
  own samples, since it last started again.
  - A camera move or an edit starts the averages again with the picture.
  - Until then, and all through a drag, you see the short averages as before.
  - A new row under Speed, **Averaged over**, says how many samples and seconds the means are over, or "settling".
- **The photon map's radius** stays the current one: it shrinks on purpose as the picture converges.
- **`RTSTATS()`** in the console gains the means too (meanSamplesPerSec, meanMsPerSample, meanCpuMs, meanSamples).

**What to look at:** the Render stats panel while a picture converges.
- The Speed numbers and the photon map's photons should settle, and Averaged over count up.
- Move the camera: they should start again, showing "settling" for about a second.
