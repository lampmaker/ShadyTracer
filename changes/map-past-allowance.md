bump: patch

**The detector map no longer stops converging under Live with Σ.** The map is made from a list of detector hits, and
the Analysis page keeps at most 500 000 of them; Live's rounds added up stopped adding to the map once the list was
full, while the totals and the far field went on (the user: "the 2d Map stops converging after a little while"). Past
the list each batch's hits are now binned as they come into the map's own cells (`lib/pathtracer/optics/detmap.js`
`mapSum`, the list's frame) and the map adds the sum in, every batch weighed alike -- exactly the map of all the hits,
for no smoothing, Gaussian and Epanechnikov (`illum.test.mjs`). A single ▶ Run with more hits than the list holds gets
the same. What reads the hits themselves stays at the list: the k-nearest smoothing (not linear in the hits), the
spectrum of a place, the hits' CSV and a script's map. Changing the map's cells, smoothing, detector or zoom during
Live starts the binned part over (the map is the list's alone until the next batch).

**What to look at:** Analysis, a detector map, Live with Σ on and a ray count that fills the list in a few rounds
(e.g. 1M a round on a scene that sends most rays to the detector): the map's note "about N hits per lit cell" should keep
rising round after round instead of stopping, and the map's grain keep fading. The map's flux and E max should not jump
when the list fills. With k nearest the map stays as it was at the list. Rounds past the list now read each batch's hits
back to bin them, so a round there may take a little longer than before (not measured).
