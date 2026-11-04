bump: minor

**A detector or a ray limiter is an object, not a material, and each object is a detector of its own.** Select an
object: its Properties have an **optics analysis** box with a **role** (none, detector or ray limiter).
- Two objects of the same material can be one detector and one plain screen, or two detectors read apart, each with
  its own map on the Optics page.
- Making an object a **detector** is live, with no compile. The optics trace finds it by the object's tag, so the
  shader does not change.
- Making one a **ray limiter** is a compile, since the picture leaves it out.
- A group cut by CSG whose base is a limiter or a detector takes the role for every shape in it, as it takes the base's
  material. So an aperture's hole wall stops rays too, as before.

**What changed in materials and the Optics page.**
- A material's type is now **surface** or **glowing** only.
- The Optics page's far field "from" now lists the detector objects.
- A script's `optics.setup({ from })` takes a detector's name.

**A new optical feature, *optics analysis*** (the scene's row, *optical features*). It is not part of Basic, Full or
Expert. With it off:
- no object is a detector or a limiter (a role is kept, and does nothing);
- the Optics-Analysis box is not shown;
- the view offers neither the rays drawn over the picture nor the lux and luminance views.

The measure tool and the Analysis pane stay. **New scenes start with it off.** Every example and older file that had
a detector or a limiter opens with it on and the role on each object that wore one. Dropping the library's detector
screen into a scene switches it on. Scene format 27 (`builder/model.js` `OPTICS_ROLES`, v26to27;
`lib/pathtracer/optics/kernels.js` `optIsDetectorTag`; `builder/materials.js` FEATURES `analysis`).

**What to look at:**
- **Open *LED, lens and screen*.** Optics analysis should be on, the screen's optics analysis box should say detector,
  and ▶ Run in the Analysis pane should give the same map and numbers as before.
- **Give a second object the detector role.** The picture should not recompile, and after ▶ Run the map's *of* list
  should have both, each with its own numbers.
- **Make an object a ray limiter:** it should vanish from the picture (a compile) and still stop the rays.
- **Switch optics analysis off.** The optics analysis box, the rays in the view's drawer and the lux and luminance
  buttons should go, and a lux view that was on should go back to the photograph. Switch it on again and everything
  should come back.
- **A new scene:** no optics analysis box on its objects until you switch it on.
