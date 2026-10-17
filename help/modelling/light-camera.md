# Light, environment and camera

## The environment

What surrounds the scene is in the **scene's own Properties**: click the scene's row at the top of the tree. Two
choices:

- **Sun & sky**: daylight. The sun is a disc of real size (0.53°) whose light is given in lux (a clear noon is about
  100 000), placed by its azimuth (a compass bearing: 0 towards +y, 90 towards +x) and its elevation. The sky's own
  light is given in lux on a level surface (about 15 000), and its haze by the turbidity.
- **Studio**: an even light from every direction, brighter from above by a share you set. There is no sun and no hard shadow,
  which is good for showing an object as it is. Its level is in lux, and its colour is a tint.

Every setting has a tooltip. The scene's **environment radius** sits next to them: how far the scene reaches. Anything
beyond it is not drawn, and a ray that passes it sees the sky. Keep it larger than everything in the scene.

**Render settings › Lamps only** turns the environment off without changing it, to see what the scene's own lights do.

## Light objects

**+ › Lights** adds a **rectangle** or a **disc** that emits from its front face (its +z): a lamp, a window, an
LED, a softbox. Its settings in Properties:

- **how bright**: a **flux** in lumens, or a **luminance** in cd/m². Set one and the other follows from the face's
  area. With a flux set, resizing the face keeps the lumens;
- **colour**: as RGB, as a colour temperature (2700 K warm, 4000 K neutral, 6500 K daylight), or as a CIE xy
  chromaticity from a datasheet;
- **distribution**: cosine (Lambertian: a diffuser, a panel, an LED), a narrower cosⁿ, uniform, or collimated,
  limited to a cone if you like;
- **two-sided**, **transparent** (a sheet of light that does not block the view), and the index it emits into.

The [Light settings](../reference/lights.md) reference has them all. A **glowing material** on any shape is also a
light, set by its luminance ([Materials](materials.md#glowing)).

[Lighting a room](example:lighting-room.json) uses both kinds: sunlight through a window, and a 1500 lm lamp over a
table.

## How bright the picture is: exposure

Light is in real units, so a room is hundreds of times darker than a sunny street. The camera adjusts, as a real one
does. **◐** in the view's toolbar has the **exposure**: metered automatically by default, with a compensation, or set
by hand in EV. The **tone curve** turns the light into the picture's colours: PBR Neutral by default, or AgX, ACES,
Reinhard, Hable, clip.

The exposure belongs to the scene, as the camera does (below): a sunlit street and a dim room in one project each keep
their own.

A picture that is all white or all black usually means one of these:

- a light far too bright or too dim;
- lamps that are tiny next to the sun, with exposure metered for the sun;
- the sun below the horizon.

## The camera

**⌖** in the view's toolbar opens the camera:

- **orbit** (drag to turn about a target) or **walk** (W A S D, Space, Q and the arrows);
- **perspective** or **orthographic**, with its field of view or width;
- its position and target as numbers you can type;
- **the lens**: an **aperture** (its diameter, in the scene's unit) and a **focus** distance (0 is focused on the
  target). An aperture above 0 gives depth of field: what is nearer or farther than the focus blurs, more for a
  larger aperture.

[Depth of field](example:depth-of-field.json) is a row of pawns, focused on the third.

Each scene keeps its own **camera and exposure**, saved in its file. Switching scenes brings each one's view back
whole, with nothing left over from the scene before: no open lens, field of view or exposure. An example, a duplicate
and a scene sent to someone open with the view they were saved with. Moving the camera or changing the exposure is
not an undo step: looking is not editing.

The same settings are in the **scene's own Properties** (click the scene's row at the top of the tree), in two folders,
**camera** and **exposure**, folded until you open them. There, a **◇** before a value flags it for the
[Timeline](cmd:view.tools.timeline): a flagged camera or exposure value is offered by the Timeline's **+ track** alongside
the scene's own flagged values.

## The surface tolerance

How close a ray must come to a surface to count as hitting it is the scene's too: **surface tolerance** in the scene's
Properties, after its radius, in the scene's unit. At 0, the default, it is automatic: 1e-4 of the scene's size, at
most 1 mm. Set it finer when a thin gap matters (a liquid against its glass, a coating on a lens) or a small part sits
in a large scene. Render stats › Picture says the one in use. The optics trace uses it too.

## Looking at the light itself

The **analysis drawer** at the view's bottom right has three ways to see the picture:

- **photographic**, the picture;
- **lux on surfaces**: every visible surface's illuminance, whatever its colour;
- **luminance**: the picture as cd/m².

In the last two, the cursor reads the value under it with its error bar, and the **measure** tool places pins and
areas that read lux, uniformity and colour. This is useful for any interior: is the desk bright enough?
