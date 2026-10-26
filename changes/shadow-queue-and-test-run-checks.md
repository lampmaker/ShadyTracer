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

**What to look at:** Tests > furnace: rows 27 and 28 should read about 1.000, and take longer than before. The extra
cost is not measured: 289 wavefront iterations a sample against 54. Tests > optics-mode: the full row should read with
the illuminance-view row at every sensor, x 1 about 1.1 or more. Tests > optics-balance: balance 0 on every row, run as
often as you like. In the picture, a scene with lamps and glass in view: the lamps' light on surfaces seen directly
should no longer dim when the photon map wakes, which may show as a few percent brighter than before.
