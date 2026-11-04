# Haze settings

> Made by `help/reference.mjs` from the program's own lists: edit that, not this page.

The scene's haze (the scene's row, *environment*, **haze in the air**) fills the air of a box-shaped region with dust that scatters and absorbs light: beams show in it, the sun's shafts, a lamp's glow; what is seen through it is dimmer. Only the air inside scatters -- glass, water and solids inside the region stay clear. Switched on, the region fills the scene; **Fit to scene** fits it again, and **Edit region…** moves, turns and stretches it in the picture (the Transform gizmo and its cubes), its size in the scene's unit. One a scene. It is no material: a material's scattering is inside a solid, whose surface would stop the light sampling a beam in air needs. See [Render settings](../modelling/rendering.md#dust-in-the-air) for how it is drawn and what a small scene can show.

| setting | starts at | does |
|---|---|---|
| mfp | 1 | The mean free path, in real metres whatever the scene's unit: how far light goes, on average, before it meets a particle. Smaller is denser. Visibility -- the distance at which a dark object fades to 2 % contrast, a weather report's number -- is 3.91 of these: clear air's is tens of kilometres; the dust a sunbeam shows indoors, or a stage's haze, far less (rough figures: the right value is a measurement, or the one that looks right). The panel shows the visibility beside it. |
| albedo | 0.9, 0.9, 0.9 | What a particle scatters of the light it meets, per channel; the rest it absorbs. 1 is white dust, 0 a black soot that only dims. |
| g | 0.7 | How the particles scatter (Henyey-Greenstein's g): 0 evenly in every direction, towards 1 forward -- real dust and haze are about 0.6 to 0.8, so a beam looks brightest looking into it -- towards -1 back. Held within ±0.95. |
