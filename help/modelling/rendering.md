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
  the camera's own paths almost never do. **Render settings › Lights' rays** switches the light objects' part of it.
- **Paths and noise**: how many bounces a path may take, and the **firefly clamp**, which caps single very bright
  samples (0 = off). A clamp makes the picture less noisy and a little darker than it should be.
- **Render size**: fit the view, or a fixed width and height; and a **resolution** of 100 % down to 25 %, which keeps the picture's size on screen, softer, with a quarter of the pixels to trace at 50 %.

The **Developer** switch at the foot of the Quality box shows the rest: ray marching, performance, diagnostics.
Each row has a tooltip.

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

**File › Save a picture (PNG)…** renders offscreen at its own size, up to 16 384 pixels on a side, with its own
number of samples. You can stop it early. The render is kept as light, so you can choose its exposure, tone curve
and grading on a preview afterwards, and save it as often as you like.

## Animation and video

Mark a value **animated** (◆ beside it in Properties), and it stays live in the baked scene, so the
[Timeline](cmd:view.tools.timeline) can move it without leaving the bake. In the Timeline, **+ track** keys any live
setting over time: the camera, the sun, a light's flux, an object's position. **RECORD** renders every frame offscreen
at the export size, as an MP4 or a ZIP of PNG frames (an animated GIF as well). Try [Animation](example:animation.json).
