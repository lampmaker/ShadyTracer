# Light, environment and camera

## The environment

What surrounds the scene is in the **scene's own Properties**: click the scene's row at the top of the tree. It is
**code**: one function, `fn background(dir: VEC3) -> VEC3`, which returns the luminance in cd/m² seen in the
direction `dir` (a unit vector, z up). That is both what a ray leaving the scene sees and all the light the
surroundings cast on it, so stars, a second sun or a bright window in a photograph light the scene as they look.
The **environment code** box shows what the scene is lit by, and the first edit makes it the scene's own. **start
from** puts in one of four, each the renderer's own text, to read and change:

- **Sun & sky**: daylight, physically. Sunlight of **Sun above the air** lux (128 000 is the real sun's) comes down
  through the air and its haze (**Sky Turbidity**) and is scattered once on the way: the disc is what gets through,
  and the sky is what is scattered towards you. The sun is placed by its azimuth (a compass bearing: 0 towards +y,
  90 towards +x) and its elevation. The ozone high up takes some orange out. With the sun 45° up it gives about
  91 000 lux from the sun and 11 500 from the sky, the sun about 5000 K; a low sun is dimmer and redder, and the sky
  darker. Sunlight is warmer than the screen's white, so under the sun & sky **White from the environment** (below) is
  on by default and a white floor in the sun looks white.
- **Studio**: an even light from every direction, brighter from above by a share you set. There is no sun and no
  hard shadow, which is good for showing an object as it is. Its level is in lux, and its colour is a tint.
- **Stars**: a fractal night sky, after Star Nest by Kali (Pablo Andrioli). Its depth, zoom, shift, brightness and
  peak are parameters (below). Turn the exposure up, or leave auto exposure on.
- **Image…**: a panorama of the surroundings, as CAD and render programs light with: a Radiance `.hdr`, or a PNG,
  JPEG or WebP, 360° across and 180° up (equirectangular). It is kept in the scene's file. **Image (cd/m² at 1.0)**
  sets its brightness: 179 for a calibrated `.hdr` (Radiance's own lumens per watt), and a daylight sky's 5000 at a
  photograph's white, as it is loaded. **Image turn** turns it about the vertical.

The rows above the box are the settings the code reads: change the code and they change with it. **Sun sampled
directly** says whether the environment has a sun that light sampling and the sun's photons should aim at: a cone at
the sun's azimuth and elevation, of the sun's diameter. The code says what is in it (the sun & sky draws its disc
there); turn it off for an environment with no sun. A bright spot it does not mark is still found, through a map of
where the environment is bright, only with more grain.

The code can call `sunDirection()`, `inSunDisc(dir)`, `envImage(dir)`, `UB.` and the name of any environment setting,
and the functions of Help › Reference › Functions for code (noise among them). It cannot reach the scene's functions
block or its parameters: it is compiled into the kernels that hold no scene. A change to it is a compile of those
alone; every row is live.

**Parameters of its own**: **+ number…** and **+ colour…** under the box add a value the code reads by its name, as
`starZoom` in the stars. A row each, live: moving one changes the picture without a compile, and its **◇** flags it
for the [Timeline](cmd:view.tools.timeline). **rename / remove** renames one, in the code too, or takes it away with
an empty name. Up to 16; a name the code declares itself (a `let`, a function's argument) is refused.

**Environment from a texture** (on by default) runs the code once after each change into a picture of the whole sky,
**Texture width** pixels across, and every ray reads that instead of running the code. A heavy code, such as the
stars, then costs a short pause after a change rather than slowing every frame. The sun's disc is still asked of the
code, so it stays sharp. Turn it off for detail finer than the texture.

Every setting has a tooltip. The scene's **environment radius** sits next to them: how far the scene reaches. Anything
beyond it is not drawn, and a ray that passes it sees the environment. Keep it larger than everything in the scene.

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

**White balance (K)** and **White tint** in the same popover say which light should look white, as on a camera: a
temperature in kelvin and a tint (green to magenta). 6506 K and tint 0 is the screen's own white, D65, and changes
nothing. With **White from the environment** ticked, the white is what the environment puts on a level white surface, the sun's and the sky's light together, so
a sunlit white floor looks white at any sun height. It is on by default in a scene lit by the sun & sky, and off
under the stars, the studio and an image, whose colour is the point; choosing a start in **start from** sets it that
way again. It changes only what you see: the light in the picture, readings
in lux and cd/m², and the false-colour views are untouched.

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
