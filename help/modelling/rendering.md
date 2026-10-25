# Render settings and saving pictures

The picture is **path traced**: every pixel follows light back through the scene, bouncing, refracting and
reflecting as it really would. It starts noisy and gets cleaner the longer it stands still. Any change starts it over.

## Quality

The view's toolbar names the preset in force in a word, at the top left (**Standard ▾**). Click it to choose another.
The [Render settings](show:renderer) panel's **Quality** box has the same presets as buttons:

| preset | traces | for |
|---|---|---|
| **Sketch** | shapes only: a fixed flat light, no shadows. Mirrors and glass still show what they reflect and what is behind them | modelling, fastest |
| **Draft** | light straight from the sun, sky and lamps, with shadows; no bounce light | placing lights |
| **Standard** | full path tracing: up to 10 bounces, caustics and the lights' rays on | the picture |
| **High** | up to 24 bounces and twice the photons, for long chains through glass and quieter caustics | a final render; slower per sample |
| **Optics** | flat light, with the lights' rays traced through lenses and reflectors to the first diffuse surface | seeing what optics do |

The line under the buttons says what the preset in force traces. If you change a setting by hand, it reads
**Custom** and says what differs.

**What each one traces, side by side.** A camera path is a ray followed from the camera into the scene. *Stops at the
first matte surface* means it ends at the first diffuse or glossy surface it meets, after any mirrors, clear or frosted
glass and near-mirror metal on the way.

| | Sketch | Draft | Standard | High | Optics |
|---|---|---|---|---|---|
| camera paths | stop at the first matte surface | stop at the first matte surface | up to 10 bounces | up to 24 bounces | stop at the first matte surface |
| light there | a fixed flat light, no shadows | sun, sky and lamps, with shadows | everything, bounce light too | everything, bounce light too | the flat light, dimmed |
| caustics (sun, glowing surfaces) | off | as set | on | on, twice the photons | off |
| lights' rays | off | as set | on | on, twice the photons | on, to the first matte surface |
| seen through glass (photon map) | off | as set | on | on | as set |
| dust in the air | off | light scattered once | in full | in full | off |
| dispersion | as set | as set | on | on | as set |
| diffuse bounces | — | — | all | all | — |

**Why Draft can be little faster than Standard.** Draft leaves out only the camera's bounce light. The photons of the
caustics and of the lights' rays, and the photon map, still run in full, and on a scene with lamps behind lenses
they can be most of a sample. Turn them off in **Light sources** to see what they cost, or run Tests ›
render-modes-cost on the scene.

**⚡ Fast while moving**, beside it, is on by default. While you orbit the camera, drag an object or a point, or
move a value, a Standard, High or Custom picture is traced as **Draft**. The full picture comes back a moment after
you stop.
- **Sketch instead:** choose it in the same menu, under *While moving*. It is lighter on a heavy scene, but the
  picture changes more when you stop.
- **Already light:** Draft, Sketch and Optics are not changed by it.
- **Saved pictures:** a save is always traced as set.
- **Turning it off:** click ⚡.

## The other boxes

- **Light sources**: the environment, and the two kinds of light tracing. Light tracing carries light from the
  lights to the camera, through glass and off mirrors. It finds caustics and lamps hidden behind lenses, which
  the camera's own paths almost never do. **Lights' rays** (Render settings › Light sources) switches the light objects' part of it.
- **Paths and noise**: how many bounces a path may take, and the **firefly clamp**, which caps single very bright
  samples (0 = off). A clamp makes the picture less noisy and a little darker than it should be.
  **Max Diffuse Bounces** (40, all, by default): how often light may bounce between matte or glossy surfaces on its
  way to the camera. Mirrors, glass and near-mirror gloss do not count, so light can still run down a long chain of
  lenses while the bounces between walls are cut short. Dust in the air counts as matte.
  - **0** is the direct light alone, but through lenses, mirrors and glass, caustics included: what Draft shows, done
    exactly. **1** adds one bounce off a wall, and so on.
  - Fewer reads as Custom; Standard and High put all of them back. At or above Max Bounces it changes nothing.
  **Dispersion** (ticked by default): glass with an Abbe number splits white light into its colours where it
  refracts. Untick it and every glass bends all colours alike: no colour fringes, and none of the colour noise they
  take to settle. Standard and High tick it again. The Optics page always traces dispersion.
- **Render size**: fit the view, or a fixed width and height; and a **resolution** of 100 % down to 25 %, which keeps the picture's size on screen, softer, with a quarter of the pixels to trace at 50 %.

The **Developer** switch at the foot of the Quality box shows the rest: ray marching, performance, diagnostics.
Each row has a tooltip.

## Dust in the air

A **haze box** (the **+** menu, *Haze box*) fills the air inside it with dust. Light that crosses it is partly
scattered and partly absorbed, as in a dusty room, fog or a stage's haze. Beams from lamps and lenses show in it, and
so do the sun's shafts and a lamp's glow. Whatever is seen through it, or lit through it, is dimmer. The example
*Beam in dusty air* (an example: the Project panel) shows an LED's beam through a lens.

- **Only the air inside scatters.** Glass, water and solids inside the box stay clear, so a lens in a dusty box
  still looks like glass.
- **Real units.** The **mean free path** is in metres, whatever the scene's unit: how far light goes, on average,
  before it meets a particle. The **albedo** is the share a particle scatters rather than absorbs. **g** sets the
  direction: real dust scatters mostly forward, so a beam is brightest when you look into it. The panel shows the
  **visibility** beside the mean free path. See [Haze box settings](../reference/haze.md).
- **One box a scene.** Its outline shows when it is selected; stretch it with the Transform gizmo's cubes.

**What a small scene can show.** Physical dust is faint at the size of a lamp. A beam a centimetre or two across,
seen from the side in dust with a 10 m mean free path, is thousands of times dimmer than the spot it lights on a white
wall. Dust dense enough to show the beam brightly also dims it over a short distance. That is physics, not a setting
to fix. Beams show best:
- looking into the light, or close to it;
- in a dim room;
- with denser dust: try a mean free path of a fraction of a metre.

**Where it is traced.**
- **Standard and High:** in full. Light can scatter many times, and the lights' rays light the dust.
- **Draft:** light scattered once, straight from the sun, sky and lamps.
- **Sketch and Optics:** leave the dust out.
- **Light seen through glass:** a beam in dust seen *through* a lens or a window is only found by the camera's own
  paths, so it is noisy.
- **The Optics page's numbers** do not include the dust yet; its run bar says so.

Each time light meets a particle it counts as one bounce. A very dense box makes paths that run out of bounces, which
shows as dimming. Raise **Paths and noise › max bounces** if it matters.

## How fast it is

[Render stats](show:stats) shows the samples per second and what a sample costs. What makes a scene slow:

- **Shapes that are costly to ask**: reliefs, noise, deep code, a high Menger sponge;
- **Rays that pass close to surfaces** without hitting them: they take many small steps;
- **Glass, and long chains of reflections**: more bounces to follow;
- **Resolution**: more pixels, more rays to trace for every sample.

A new shape, or turning on a feature, means a **compile**: the program the graphics card runs is rebuilt. A bar
over the picture shows how far it has got. The picture waits, but the rest of the page does not. The first compile of a scene
takes longest; one seen before comes from a cache. Once your edits stop, the scene is compiled once more in the
background with its values fixed (**baked**), which renders faster, and the status bar says so. Your next edit
goes straight back to the editable build.

## Saving a picture

**File › Save picture…** opens the **Darkroom**, a tab beside the picture. Its boxes on the right: **Render** renders
offscreen at its own size, up to 16 384 pixels on a side, with its own number of samples (you can stop it early);
**Develop** shows a histogram of what will be saved, and the boxes under it develop the picture; **Save** writes the
file. The render is kept as light, so you can develop it and save it as often as you like. Each save is a file of its
own: the name you give, with the date and time it was saved after it (`render-2026-10-19_14-03-22.png`).

**Save** offers the developed picture -- **PNG** at 8 or 16 bits a channel, **JPEG**, **WebP** -- or the light itself:
**OpenEXR**, **Radiance HDR** and **PFM**. These hold the render as the renderer made it, in cd/m² (or multiplied by your
exposure, so 1.0 is white), with no tone curve, grading or rays drawn over it: for another program to develop, or for
measuring. EXR keeps everything, the sun and colours no screen can show included; HDR clips into the screen's colours;
PFM is only the numbers. The line under the format says what the file will hold and how large it can be. PNG and EXR
files say how they were made: the version, the size, the samples, the settings.

The developing boxes run in the order the picture is made. **Exposure**: the EV, Meter, and **Spot meter**:
click the picture where middle grey should be. **White balance**: the temperature of the light that should look white,
and a tint. **Pick a white** takes them from a surface you click. Then red, green and blue gains. **Tone**: the tone curve,
with **Hable, adjustable** offering its white, toe and shoulder, and under it a gain for each band of light, from 7 stops
below white up to white: raise the dark bands to open the shadows. **Colour**: saturation, vibrance (it raises dull
colours more than vivid ones) and hue. **Grading**: contrast, saturation and brightness of the finished picture. Each
box has a Reset. The light files (EXR, HDR, PFM) are saved without these.

The render fills the rest of the tab. Turn the mouse wheel to zoom where the cursor is, drag to move, double-click for
100 % (one pixel of the picture on one pixel of the screen) and again for the whole picture. The keys, with the picture
clicked: **0** the whole picture, **1** 100 %, **2** 200 %, **+** and **−**, the arrows to move. Under the cursor: the
pixel's place and its light in cd/m². **Before** (or holding the `\` key) shows the picture as the view showed it;
**Split** shows that on the left and yours on the right, with a line to drag. **Clipping** stripes what is white in red
and what is black in blue. While the Darkroom covers the picture, the picture stops rendering, and goes on when you
come back to it.

## Animation and video

Mark a value **animated** (◆ beside it in Properties), and it stays live in the baked scene, so the
[Timeline](cmd:view.tools.timeline) can move it without leaving the bake. In the Timeline, **+ track** keys any live
setting over time: the camera, the sun, a light's flux, an object's position. **RECORD** renders every frame offscreen
at the export size, as an MP4 or a ZIP of PNG frames (an animated GIF as well), named with the date and time the
recording started after the name you give (`raytracer-2026-10-19_14-03-22.mp4`). Try [Animation](example:animation.json).

Each scene has its own timeline, saved in its file: its tracks and keys, the frame rate and length, and the video's
size, renders per frame, range and name. Opening another scene shows that scene's timeline. The format, the bitrate and
writing to disk are your own settings, the same in every scene. Keys are not undo steps: Ctrl+Z leaves them as they are.
