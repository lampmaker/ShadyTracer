bump: minor

**The dust in the air is the scene's, set in its environment; the haze box node is gone.** The scene's row,
*environment*, has a **haze in the air** switch.
- **Switched on**, the haze fills the scene: the box its objects measure, with lights and an endless floor left out.
- Below the switch are the dust's mean free path, colour and g, as before, and the region's size and place.
- **Fit to scene** fits the region again.
- **Edit region…** selects it: its outline shows, and the Transform gizmo moves, turns and stretches it, with live
  values and undo, as the haze box had.
- **On or off is a compile;** everything else is live.
- It is no longer in the **+** menu or the tree.

**Why it is not a material**, as you asked whether it could be. A material can already scatter inside (its *scatter
distance*), and a box of index-1 material that scatters walks its rays correctly. But its walls are surfaces, and every
shadow ray stops at a surface. Inside a material a collision samples no light and connects no photon, because the walk
assumes the solid's own wall blocks them. A beam in such "air" would show only by chance, or through the photon map.
The haze has no surface, which is exactly why light sampling works in it (`roadmap/DIFFUSERS.md`, Option A). So it
stays its own thing, and is the scene's, like the environment.

**Older files.** A scene with a haze box opens with its haze where the box was in the world: turned and scaled groups
and an array's first copy are folded in, and its settings, animated flags, locks and a timeline track on it come along.
The renderer is handed exactly what it was. A script that named the haze box's id cannot be rewritten: it names
`#haze` now. Scene format 27 (`builder/hazebox.js`, `builder/model.js` `setHazeOn`, `fitHaze`, v26to27).

**What to look at:**
- **Open *Beam in dusty air*.** It should look as it did. There should be no haze row in the tree, and the scene's
  environment should have haze in the air on, with the dust's settings.
- **Edit region…:** the dashed outline should show, and the gizmo should move it and its cubes stretch it, the dust
  following live. Undo should put it back.
- **Switch haze off and on (a compile each)**, then **Fit to scene**, in a scene of your own.
- **A project saved with a haze box** should have its dust in the same place.
