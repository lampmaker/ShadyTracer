bump: minor

**A light inside an array is a light at every copy.** Until now a group's copies refused a light ("not drawn more than
once yet"). Now a rectangle, disc or ray-file light inside a group with copies is a whole light at each copy, in the
picture and as an Optics source. Arrays can nest.
- Each copy keeps the light's settings and has **its own flux**: a 10 lm light in 12 copies is 120 lm.
- A group's copies box can now make **a ring** (*Make them a ring*: count, ring radius, about the axis), as well as a
  row. A ring of LEDs is one LED in a ring of copies. The *circular array* modifier is group code, so it still draws no
  light.

How it works:
- Every copy is a face of its own: light sampling, the face table, the scene as data's light table and the photons'
  sources each hold one row per copy, in one order (`builder/lights.js`, *A LIGHT INSIDE ARRAYS*).
- The shader text stays one light's whatever the count: the pick and the total are one line per light, and `lightFace`
  is one case per light listing every copy.
- A hit on any copy is weighed by the light's first face. That is exact because the copies of an array with a light
  in it **share one scale**, which the model now holds: setting copies, adding a light, moving a node and loading a
  scene are all checked.
- An array with a light inside a joining group (CSG) is not drawn, and the Optics page lists the light as skipped
  with the reason. This is not refused, so that a join changed above cannot make a saved scene unreadable.

Also: `roadmap/LIGHT_CONTROL.md` is the investigation of programmable lights, with what this phase does and the next
two phases.
- Phase 2: a colour and intensity per copy.
- Phase 3: emission over angle and position, written as code and baked into a map.

There is a new benchmark, **Tests › Benchmarks › lightarray**: one light against 16 and 256 copies of it at the same
lumens, and 16 copies against the same 16 lights placed by hand.

**What to look at:**
- A row of LEDs: one rectangle light in a group, with *Make it an array: a row of copies* in the group's Properties.
  Every copy should glow and light the floor under it, the same as the same lights placed by hand.
- A ring: the same group, *Make them a ring*. With a ring radius of 0, the copies turn about the group's axis, as the
  circular array's do.
- The Optics page: each copy is a source ("… (copy 3 of 12)"), and the flux in the analysis is the copies' sum.
- Give two copies different scales: the panel refuses it and names the light.
- Run **Tests › Benchmarks › lightarray** and paste the report. It says whether picking among 256 faces costs anything
  on your card (`roadmap/LIGHT_CONTROL.md`, *Speed*).
