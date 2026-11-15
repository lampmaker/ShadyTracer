bump: patch

**The photon map's radii go below a pixel.** *Photon map: radius (pixels)* now goes down to 0.05 (was 0.5), and
*radius inside glass* down to 0.1 (was 1), in Render settings' developer rows. A gather that small finds one photon or
none, so light through glass shows as separate dots at first and fills in as samples come in -- a look, not a speed-up.

**What to look at:** a glass object over a floor with the photon map on, the radius at 0.05: the floor behind the glass
grainy with dots, settling as samples add up. Whether it also reads darker than at 3 (a radius under the surface
tolerance may miss photons stored just off the surface -- not checked) is the thing to compare after a few hundred
samples.
