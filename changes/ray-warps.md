bump: minor

**Ray warps: an object whose shape is a region where rays do what its code says.** Any object with code can have a
*ray warp* (Properties › ray warp › Add a ray warp). Its shape becomes a region, and its warp code runs at every march
step a ray takes inside it. The code can turn the ray (`dir`), move it (`pos`), tint what it carries (`tint`, per unit of
length), add light along it (`glow`) and end it (`stop()`). It reads where the ray is (`p` in the object's frame,
`world`), how deep (`dist`), the step (`ds`), `pathLength`, `bounces`, `isPhoton`, `rand()` and the object's own
parameters, which stay live and can be animated. *draw its surface* draws the object as well, in its material, and is off
by default. *step* is the longest step inside the region. It is for pictures, not physics: shadow rays stay straight, so
light reaching something through a warp is found only by paths that happen to find it and is grainier. The Optics page
traces warps too, without the glow. A new example, *Ray warps* (Modelling and rendering › Art), has a twist, a pull, a
shimmer and a glass ball glowing pink inside. Help › Ray warps explains the rest. Files are model version 30. A builder
of 29 refuses them rather than draw a warp's region as a solid.

**What to look at:**
- Open *Ray warps*. You should see:
  - the columns and balls behind the left box turned round about its upright axis;
  - the second region bending them round its middle;
  - the third region blurred, settling as samples add up;
  - the glass ball on the right glowing pink towards its middle.
- Move each warp's parameter (*twist*, *pull*, *amount*, *strength*). Each should change live, with no compile.
- Change a warp's code, its *step* or *draw its surface*. Each is a compile.
- A warp in a scene with the step cache on should look the same as with it off.
- Whether the grain through a warp is acceptable, and how the stepping looks at a coarse *step*, are the user's to judge.
  Nothing here was seen on a screen.
