bump: patch

**A node inside an array is measured as one copy, not as all of them.** The boxes the culling uses are measured by
sampling, at a grid of points, which object's surface is nearest. Every copy of an object has the same tag, and each
point was put into the object's frame through its first copy. So a node inside an array was measured as all its copies
at once, and its group then put that box at every copy again:
- In Tests › Benchmarks › lightarray's ring of 16 rows of 16 lights, a 4 cm light measured 2.22 × 2.22 m. The ring's
  culling box measured 5.25 m across, where the ring is 2.2 m.
- Too big, never too small: nothing was cut off, but arrays were culled late.

Now the pick copy of the scene keeps which copy it is walking (`XF_COPY`, in codegen's copies loop and in the data
walk's ARRAY records), and the tag field returns it with each tag. `builder/boxes.js` puts each point into its own
copy's frame.
- The same light now measures 0.133 m, and the ring's box 2.44 m (2.20 m estimated).
- Where the copy number cannot be believed, a point goes through the first copy, as before. That happens when it says
  another count of arrays than the node is inside, or when the copies multiply past a u32.

The tag field is four words a point instead of two, read by one function (`core/field.js` `tagSample`) where the page
and five GPU tests each had their own. `builder/test/boxes.test.mjs` measures a ring of rows of beads with a sampler that
draws every copy. `builder/test/arraywindow.gpu.mjs` checks on Dawn that the pick copy names each face of the bench's
ring by its own copy, codegen and as data. The golden shaders: `scenes/parametric-part.json`'s pick texts, the one
document with an array.

**What to look at:**
- **Any scene with copies:** nothing should look different. Turn on the bounds overlay and select something inside an
  array: its box should be one copy's, not the whole array's.
- **Tests › Benchmarks › lightarray:** rows 5 and 6 (the window off) may be a little faster, their culling boxes being
  the array's true size now.
