bump: minor

**A scene can hold a script: JavaScript that drives the scene and reads what it measures.** View › Script opens its
panel: an editor with JavaScript's colours and line numbers (an error's line marked), ▶ Run (Ctrl Enter), ■ Stop, Examples… and what the script prints. The script is the scene's, saved
with it and in its file (`script` in the document, outside the undo history as the view and the timeline are; no
format version change). It never runs on its own -- not when a scene is opened, shown or loaded -- because a scene is a
file people pass around and a script has the page's whole reach. What it is handed (tools/scriptapi.js): a setting as a
variable (`const pos = param(path)`: `pos.value = [1, 2, 4]`, `pos[0]`, `pos.z = 4`, a number in arithmetic as itself --
dragged in from the Parameters panel by its name, as that line on an empty line or the call inside code), every setting
by its path (`params.list`, `get`, `set`, `apply`, the animated ones alone; a mistyped path an error naming what is near;
`settled()` waits out a compile), the camera and the exposure, the live picture's samples and readings
(`picture.wait`, `measure`, `region`), `render()` into the Darkroom and `.save()` in any of its formats with the view's
look, the Darkroom's or settings of its own, the Analysis pane's run (`optics.run`, shown in the pane and the charts as
▶ Run's) and the numbers its charts show (I max, intensity in a direction, beam and field angles, flux in a cone, a
detector's illuminance map with its uniformity and encircled flux, the far field on a plane), files saved as CSV, JSON
or text. Five examples: settings read and written, a generative series of renders, the analysis's numbers, a lens's
setting searched by golden section for the highest peak, a turntable. **? Reference** in the panel opens every function a script can call beside the editor -- what each does and gives back, how
the analysis's numbers are made and how far to trust them, an example each that **insert** puts in at the caret -- and
the same text is Help › Reference › Script functions (help/reference.mjs writes it from tools/scriptref.js; a function
without words fails the test). Help › Scripts is the overview.

The Parameters panel's rows have a ⧉ that copies the path (right-clicking did, unseen).

**What to look at:** View › Script. Drag a setting's name from the Parameters panel onto an empty line and into
`const r = `. Open ? Reference, search "beam", insert an example. The colours should sit exactly under the caret, scrolling included. Run each example on a scene of yours -- the generative one needs a few settings
flagged animated (★) with a range; the lens one a setting flagged or its path typed, and a light. A render should show
in the Darkroom and download; an analysis should fill the pane and the charts as ▶ Run does, and the numbers the
script prints should be the ones the cards show. ■ Stop during a render or an analysis should end it.
