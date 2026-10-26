bump: minor

**Save picture is the Darkroom: a tab beside the picture, the render shown as large as the tab.** File › Save picture…
used to open a floating panel whose preview was at most 320 pixels high, so a 4K render's noise, a firefly or a soft
edge could not be seen before the file was written. It now opens a tab in the viewport's place
(`lib/pathtracer/darkroom/viewer.js`): the kept render fills it, with Fit, 100 % (one picture pixel on one screen pixel,
drawn as a square, not blurred) and anything from 1/32 to 64 times, zoomed about the cursor by the wheel, moved by
dragging, double-click for 100 % and back; the keys 0, 1, 2, + and − and the arrows. **Before** (held, or `\`) shows the
picture as the view showed it, **Split** shows it left of a line you drag; **Clipping** stripes what is white in red and
black in blue; under the cursor, the pixel's place and its light in cd/m². The develop pass is told which part of the
picture to draw by four numbers (`rendertoscreen.js` `develop_prog`'s `view`), and a save and a scene's card still pass
the whole picture: run on Dawn, a save is byte for byte what the pass drew before (`lib/pathtracer/test/develop.gpu.mjs`).
Beside the picture, three boxes: **Render** (size, samples, Render, Abort), **Develop** (with a histogram of what a save
writes on top, counted on the GPU by `develop_histogram_prog`, and how much is at white and at black) and **Save**. While
the Darkroom covers the picture the live view is held, so the two do not share the GPU; a Darkroom floated beside the
picture, from a layout saved before, leaves it running. The rest of the editor -- export as EXR and HDR, white balance,
curves, levels -- is planned in `roadmap/DARKROOM.md`.

**What to look at:** File › Save picture… opens a tab beside Viewport. Render a picture: it appears fitted. Wheel over a
detail: it stays under the cursor. 400 %: the pixels are squares. Drag to move, double-click, the keys. Hold Before or `\`;
Split and drag its line. Clipping on a picture with a blown sky. The readout's cd/m² against the view's own readout. The
histogram moving with EV. A saved PNG as before. And whether the Develop sliders feel smoother now that the live view
waits while the Darkroom is in front.
