bump: minor

**The camera rolls: a `roll` setting turns it about its own line of sight.** The Camera popover (⌖) has a **roll**
row in degrees, for a perspective and an orthographic camera, an orbit and a free one alike; positive turns the
picture clockwise. **Ctrl + drag** on the picture turns it too: that gesture turned the camera's `up` about the
world's z until now, which with the z-up every scene has did nothing. The roll is its own number rather than a turned
`up`, so an orbit still turns level about its target, and it is a Timeline track of its own (`view/camera/roll`, not
part of the ten-number pose). Every kernel and overlay reads the camera's right and up from `invView`, so the roll is
in the picture, the light's connections to the lens, the haze, the optics paths, the gizmo and the measure tool at
once. A scene keeps its roll in its view; a roll of 0 is no key, so a scene never rolled is byte for byte what it was,
and only a rolled one is refused by a builder of 0.84.0 ("not a camera setting").

Fixed beside it: a free (fps) camera given a position, target or `up` through `set` -- a scene's view put back, the
pose track, a script's `camera.set` -- did not move until the next drag or walk, because nothing marked its matrix
dirty (lib/camera.js set).

**What to look at:** open ⌖ and move **roll**: the picture turns about its centre, the horizon tilting clockwise for a
positive roll. Then orbit (drag) with a roll set: it should turn about the target as before, with the picture staying
tilted by the same angle. Ctrl + drag left and right on an empty part of the picture. Switch to another scene and
back: each keeps its own roll. Select an object with a roll set: the gizmo's arrows should sit on the object and turn
with the picture. A free (fps) camera's saved view, put back, should now land at once.
