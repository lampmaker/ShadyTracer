bump: minor

**Saved camera views, and the whole camera as one Timeline value.** You can now keep the cameras you want to come
back to. Move about the scene, change things, then return to a view with one click. For animation, one Timeline track
can hold the whole camera.

**Saved views.** They sit at the foot of the camera popover (⌖), under Pick focus.
- **Save view** keeps the camera as it is now: its mode, perspective or orthographic, position and target, up, field
  of view or width, aperture and focus. It does not keep the exposure, so going back to a view leaves the brightness
  as it is.
- A new view is named *View 1*, *View 2* and so on, with the name selected so you can type over it.
- **Click a name** to put the camera back there at once. The row the camera is at now is lit (●).
- **Double-click a name** to rename it. Each name can be used once in a scene.
- **↻** saves the current camera under that name.
- **✕** deletes the view. It asks for a second click, because no undo brings a view back.

**Where they are kept.** The views belong to the scene: `doc.view.saved`, next to its camera (`builder/model.js` VIEW).
- They are saved in the scene's file and go with a duplicate.
- Like moving the camera, saving, renaming or deleting a view is not an undo step. An undo of an edit neither removes
  a view nor brings one back.
- A change of the scene's unit converts them, as it converts the camera (`builder/unitchange.js convertOutside`).
- A scene with no views is byte for byte what it was, and there is no file version change. A file that does have
  views is refused by a 0.83.0 builder ("view.saved: not part of a view").

**The camera as one value.** The Timeline's + track offers *Camera › pose (position, target, up, fov)*
(`view/camera/pose`, `lib/pathtracer/params.js` CAMERA POSE). It is ten numbers, so one key holds the whole camera.
- lib/timeline moves each number on its own between keys. A linear or smooth track moves the camera and its target
  in straight lines; a spline track follows a curve through the keys.
- An orbit camera stays an orbit, turning about the target the key gives it. A free (fps) camera takes the position as
  it is. Before this change a free camera could not be animated at all, because the azimuth, elevation and distance
  tracks move only an orbit.
- A unit change scales the eye and target of a pose key, never its up or field of view.
- **◇** before *pose* in the scene's camera folder flags it as animated.

**What to look at:**
- **Saved views:** in the camera popover, Save view, orbit away, then click the view: the picture should be exactly as
  it was. Save two views and check the lit row follows the camera. Reload the page and the views should still be
  there. Switch to another scene and it should have its own list.
- **The pose track:** in the Timeline, + track *Camera › pose*. Go to one view and key it, move the playhead, go to
  another view and key again, then play. The camera should move from the first view to the second.

**Checked here** (no picture seen):
- `builder/test/views.test.mjs` (new): the model's verbs and their refusals; a file there and back; a unit change and
  its undo; the real builder over a stand-in renderer.
- `lib/pathtracer/test/campose.test.mjs` (new): the pose on the real `lib/camera.js`, and a track halfway between two
  keys.
- `builder/test/viewlist.check.mjs` (new): the popover's list in headless Chromium.
- `unitchange.test.mjs`, `model.test.mjs` and `lib/shell/test/params.test.mjs` (extended).
- `builder/test/panel.check.mjs`.
