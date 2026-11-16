# Ray warps: rays that do what you write

A **ray warp** turns an object into a region of space where rays follow your code instead of a straight line. Inside it,
at every step a ray takes, your code can turn the ray, move it somewhere else, tint it, make the space glow, or stop the
ray. It is meant for pictures, not physics: space that twists, a lens of gravity, heat shimmer, a portal, glowing fog.

Open [the Ray warps example](example:ray-warps.json) to see four of them: a twist, a pull towards a point, a shimmer and
a glass ball glowing pink inside.

## Making one

1. Make or pick any object with code (a box, a sphere, your own code). Its **shape is the region**.
2. In Properties, open **ray warp** under its code and press **Add a ray warp**.
3. Edit the **warp code** and press **Apply code** (or Ctrl+Enter). It starts as the ordinary straight step, so nothing
   changes until you write something.

Options:

| | |
|---|---|
| **draw its surface** | off: the shape is only the region and is invisible, so you see what is behind it, warped. On: the shape is drawn as well, in its material: a glass ball whose inside twists |
| **step** | the longest step a ray takes inside the region, in the scene's unit. Smaller follows a bend more smoothly and costs more steps. Larger looks stepped |

The object's **parameters** can be used by name in the warp code, so you can add your own (a `twist`, a `strength`).
They change live, and you can animate them on the Timeline. Moving the object moves its warp. Changing the code, the
step or *draw* recompiles.

## What the code can read and set

The code runs at every step a ray takes inside the region. Lengths are in the object's own frame and units, so a warp
scaled with its object stays the same warp.

| read | |
|---|---|
| `p` | where the ray is, in the object's frame |
| `world` | where the ray is, in the scene |
| `dist` | the shape's distance there: negative inside, more negative deeper in |
| `ds` | the length of this step |
| `pathLength` | how far the ray has come since the camera or the lamp (read only) |
| `bounces` | how many surfaces the ray has met: 0 is what the camera sees directly |
| `isPhoton` | true for light from a lamp travelling outwards, false for a camera's ray |
| `rand()` | a random number in [0, 1), a different one every call and every sample, so it averages out into a blur |

| set | |
|---|---|
| `dir` | the direction of this step, in the object's frame |
| `pos` | move the ray there (the object's frame) before it goes on |
| `tint` | the colour kept per unit of length: `VEC3(1.0, 0.5, 0.5)` halves green and blue in each unit |
| `glow` | light added per unit of length (cd/m² per unit): glowing fog |
| `stop()` | end the ray here. What it gathered so far is kept, nothing more |

For turning, use `rotX(a)`, `rotY(a)`, `rotZ(a)` and `rotAxis(axis, a)` (angles in radians). Noise and the unit helpers
work as in any code block: **Functions you can call…** under the editor lists them, and the **Insert** pane has every
name above and a set of recipes.

Examples:

```
dir = rotZ(twist * ds) * dir;                                   // a twist about z, "twist" radians per unit
dir = normalize(dir - normalize(p) * pull * ds / dot(p, p));    // pulled towards the middle
dir = normalize(dir + (VEC3(rand(), rand(), rand()) - 0.5) * 0.3 * ds);   // a shimmer
tint = VEC3(0.9, 0.6, 0.8); glow = VEC3(1.0, 0.2, 0.6) * exp(dist * 8.0); // pink fog, glowing at the core
if (p.z > 0.45) { pos = VEC3(p.x, p.y, -0.45); }                // a portal: out at the top, in at the bottom
```

## What stays straight, and other things to know

- **Shadows stay straight.** Light sampling aims straight at a lamp, and shadow rays are not warped. Light that reaches
  something *through* a warp is found only by paths that happen to find it, so it is grainier and takes more samples.
  A tinted region does not cast a tinted shadow that way.
- **Light from lamps is warped too**, but a warp need not work the same both ways. A twist turns a ray walking
  backwards the other way. So caustics seen through a warp can disagree with what the camera sees. For art that is
  allowed.
- **Small steps cost.** A ray that runs out of steps stops (Render settings > Ray marching > Max Iterations, a developer
  setting). A very small *step* across a large region can run out, and the picture goes dark there.
- **Dust and milky glass** (a haze box, a material that scatters inside) are worked out as if the ray went straight, so
  through a warp they scatter close to, not exactly at, where they should.
- **Moving a ray (`pos`) into a solid object** puts it inside without its knowing. Expect black or strange colours.
- A warp follows its object's transform and the transforms of the groups above it. It does **not** follow an array's
  copies (it sits where the first copy's group puts it) or a group's code above it (a twist or bend group).
- Clicking in the picture through a warp selects what is straight behind it. Select a warp in the tree.
- The **Optics page** traces warps too: they bend, move, tint and stop its rays. Glow, which is a camera's light, is left
  out.
