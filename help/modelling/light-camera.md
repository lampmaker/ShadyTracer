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

**Sun, sky or studio**, unticked in Render settings › Light sources (*lamps only*), turns the environment off without changing it, to see what the scene's own lights do.

## Light objects

**+ › Lights** adds a **rectangle** or a **disc** that emits from its front face (its +z): a lamp, a window, an
LED, a softbox. Its settings in Properties:

- **how bright**: a **flux** in lumens, or a **luminance** in cd/m². Set one and the other follows from the face's
  area. With a flux set, resizing the face keeps the lumens;
- **colour**: as RGB, as a colour temperature (2700 K warm, 4000 K neutral, 6500 K daylight), as a CIE xy
  chromaticity from a datasheet, or by its **spectrum**: a blackbody, an LED's peaks, or a measured table from a CSV
  ([Light in numbers](../optics/units.md#colour));
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
- its **roll**: the camera turned about its own line of sight, in degrees (positive turns the picture clockwise).
  **Ctrl + drag** on the picture turns it too. It is its own number, so an orbit still turns level about its target;
- **the lens**: an **aperture** (its diameter, in the scene's unit) and a **focus** distance (0 is focused on the
  target). An aperture above 0 gives depth of field: what is nearer or farther than the focus blurs, more for a
  larger aperture.
- **Pick focus**, under the lens's numbers: the popover closes, and a press on the picture focuses the lens on the
  surface under the mouse. Hold the button and move to try other surfaces: the focus follows. Let go, and it stays
  focused there. Esc, or a press anywhere else, cancels. Nothing changes in the picture until the aperture is above 0.

[Depth of field](example:depth-of-field.json) is a row of pawns, focused on the third.

Each scene keeps its own **camera and exposure**, saved in its file. Switching scenes brings each one's view back
whole, with nothing left over from the scene before: no open lens, field of view or exposure. An example, a duplicate
and a scene sent to someone open with the view they were saved with. Moving the camera or changing the exposure is
not an undo step: looking is not editing.

The same settings are in the **scene's own Properties** (click the scene's row at the top of the tree), in two folders,
**camera** and **exposure**, folded until you open them. There, a **◇** before a value flags it for the
[Timeline](cmd:view.tools.timeline): a flagged camera or exposure value is offered by the Timeline's **+ track** alongside
the scene's own flagged values.

### Saved views

At the foot of the camera popover, **Saved views** keeps cameras you want to come back to. Move about the scene, change
what you like, and go back to a view with one click.

- **Save view** keeps the camera as it is now: where it stands, what it looks at, which way is up, perspective or
  orthographic, its field of view or width, and its lens. It gets the next name, *View 1*, *View 2* ..., ready to type
  over. Enter keeps the name.
- **Click a name** to put the camera back there at once. The row of the view the camera is at now is lit (●).
- **Double-click a name** to rename it. Enter or clicking elsewhere keeps the new name, Esc does not. Each name is used
  once in a scene.
- **↻** keeps the camera as it is now under that name.
- **✕** takes a view away. It asks for a second click, because no undo brings a view back.

A saved view keeps the camera only, not the exposure: going back to one leaves the picture's brightness as it is. The
views are the scene's, saved in its file with its camera, and go with a duplicate and a scene sent to someone. Like
moving the camera, saving, renaming or deleting a view is not an undo step. A change of the scene's unit converts them
as it converts the camera.

### The camera as one Timeline value

The Timeline's **+ track** offers **Camera › pose (position, target, up, fov)**: the whole camera as one value. One key
holds where the camera is, what it looks at, which way is up and the field of view, so a camera move is one track rather
than one for each number. Put the camera where you want it (a saved view is a quick way), key it, move the playhead,
put the camera somewhere else, and key again.

Between keys each of the ten numbers moves on its own. With **linear** or **smooth** the camera and what it looks at
each travel in a straight line. With **spline** they follow a curve through the keys, which suits a path through
several. An orbit camera stays an orbit, turning about the target the key gives it. The lens (aperture and focus) and
an orthographic view's width keep their own tracks. In the scene's camera folder, **◇** before *pose* flags it, so it is
still offered while the Timeline shows only animated values.

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

The measure tool's **ruler** works in any of the three views. Click surfaces to place points: each says where it is,
(x, y, z) in the scene's unit, and joins the one before it, with the length of each stretch and the total of the line.
Each stretch also shows its steps along the axes as dashed legs, **Δx** red, **Δy** green and **Δz** blue.
**Shift**-click starts a new line, and a click on a point removes it. **Drag a point** to move it over the surfaces,
and **drag anywhere else** to turn the view between points; pins work the same way. The digits shown are the surface tolerance's at that point, the precision the pick
finds the surface to. **Save as CSV** writes each point and each distance.
