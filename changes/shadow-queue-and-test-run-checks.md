bump: patch

**A light's rays no longer go dimmer while the photon map runs.** With the photon map on, a sample's photons run first
in batches of their own. Each batch capped its shadow queue at its own ray count. But the queue also carries the
shadow rays the rounds before have not finished, and a light's photons connect to the camera at every surface they land
on. A batch of camera rays and photons together had room to spare, from the camera rays' unused places. A batch of
photons alone had none, and a connection past the cap was dropped with its light. Measured on Dawn over lavapipe, in
the `optics-mode` scene (a 1000 lm point source over a floor) with the map running every sample, the floor seen
directly read 0.94-0.97 of the picture with the map off. With the cap set to what the queue's buffers hold
(`raytrace_main.js`, shadowcap), it reads 1.000 +- 0.005. That this was the user's `optics-mode` full row reading under
the illuminance view at all six sensors in the 0.77.0 and 0.78.0 runs is inferred; the illuminance view is the one mode
the map never runs in.

**The optics trace no longer loses a ray on the last pass.** A ray that was going back to the march on a run's last
pass was written to a buffer nothing read, with nothing tallied. That was a grazing reflection still inside the hit
band of the floor it had left, declined there pass after pass. It is now counted lost, as the march's own flush counts
its rays (`optics/kernels.js` onward). `optics-balance` row 3 read a balance of 2.0e-6 for this, one ray in 400,000. On
Dawn 20 runs in 100 of that row did, and 0 in 100 after.

**The furnace's dichroic-on-every-face rows run at maxbounce 100 and maxiter 6000.** A coating that reflects nearly all
of a channel traps that light inside the sphere, and the furnace's caps cut those paths: maxiter 400 is the march's
steps over a whole path. That cut is what those rows' 0.9976 was (0.9971 in 0.77.0), not the coating. On Dawn the
sphere read 0.9960 at the old pins and 0.9999 +- 0.0006 at the new ones. The beam splitter's few 1e-4 under 1 is
different and stays: rays entering within the surface tolerance of the sphere's rim are trapped by total internal
reflection, and the shortfall moves with the tolerance (the furnace's note).

**Three test rules that failed on noise or on the wrong comparison, from the second 0.78.0 run.**
- **draft-lamps** warms each row up before it counts. The emitter list is found and published first, then the picture
  is cleared (the `clearLearned` block, which no test was using). Each row starts from a fresh list, and a Draft path finds
  the disc only by its seek rays, so the first samples of a Draft row were black. How many depended on timing: 0, 1 or
  2 of the 64 in the user's three runs (each 1/64 = 1.6 %). The lamps-only row's 0.984 against draft was one row's
  start-up against the other's. On Dawn a fresh Draft row read 0.971-0.981 of full and a warmed one 0.9994.
- **optics-colour's two mix rows** trace 250,000 rays a batch instead of 100,000. Each ray picks one LED, and that
  pick's noise alone went past their 0.002 in 7 runs of 40 on Dawn, and none of 40 at 250,000.
- **rr-bias** judges each RR-on row against the RR-off row at its own maxbounce. It judged every row against
  maxbounce 10, so the light past the tenth bounce counted as bias: 0.5 % on the user's scene.

**What to look at:** Tests > furnace: rows 27 and 28 should read about 1.000, and take longer than before. The extra
cost is not measured: 289 wavefront iterations a sample against 54. Tests > optics-mode: the full row should read with
the illuminance-view row at every sensor, x 1 about 1.1 or more. Tests > optics-balance: balance 0 on every row, run as
often as you like. Tests > draft-lamps: draft and lamps only about 1 of full, and the same as each other.
Tests > optics-colour: du'v' under 0.002 on both mix rows nearly every run. In the picture, a scene with lamps and
glass in view: the lamps' light on surfaces seen directly should no longer dim when the photon map wakes, which may
show as a few percent brighter than before.
