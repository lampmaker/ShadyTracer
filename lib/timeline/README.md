# TIMELINE — keyframes and video export for a browser renderer

> **Canonical home: `CODE_WOOD/LIBRARIES/TIMELINE`** — it lives there so any CODE_WOOD
> project can reach it. RAYTRACER_WEBGPU carries a **vendored copy** at `lib/timeline/`,
> because WEAVESIM moved into that repository and should not have to reach across
> repositories to boot.
>
> Change the timeline in CODE_WOOD, never in the copy — the copy's own sync tool will
> silently revert you. Refresh it with `node lib/timeline/sync.mjs <path-to-CODE_WOOD>`,
> and check for drift with the same command plus `--check` (exit 1 if they differ). The
> copy carries a `PROVENANCE` file naming the CODE_WOOD commit it was taken from, so a
> difference is always attributable to a range of commits rather than a mystery.
>
> (This note is in the file itself, so you are reading it from whichever copy you opened.)

A small, dependency-free library (ES modules, no build step) that gives any page with a canvas a
**keyframe timeline** with a **video exporter**: tracks of properties interpolated over time, a
scrollable/zoomable editor at the bottom of the window with its own export menu, and an offline
recorder that renders every frame with as many passes as you like and writes an MP4, an animated
GIF or a ZIP of PNGs. Written for WEAVESIM (a slow, progressive path tracer) but nothing in it knows about
WebGPU or weaving; `example.html` is a plain 2D canvas.

    example.html        open over http:// -- the whole integration is one marked block
    sequencer.js        makeSequencer(): the one call that mounts everything (start here)
    registry.js         makeRegistry(): the properties a host lets the timeline drive
    timeline.js         the model: tracks, keys, interpolation, JSON (pure; runs in node)
    timeline-ui.js      the editor: transport, track headers, lane canvas
    export-ui.js        the export menu: size, renders per frame, format, RECORD, SAVE/LOAD
    recorder.js         the frame stepper: apply -> render -> grab -> encode, per frame
    encoders.js         MP4 (WebCodecs + mp4-muxer), PNG-sequence ZIP and GIF, one contract
    zip.js              a stored ZIP writer (streams)
    gif.js              an animated GIF writer: palette, dithering, LZW (streams; pure, runs in node)
    mp4-muxer.mjs       vendored, MIT -- https://github.com/Vanilagy/mp4-muxer
    timeline.css        the panel's style; override the variables on `.tl` to retheme
    test/               node tests for the model and the GIF writer

## Using it

```js
import { makeRegistry } from './registry.js'
import { makeSequencer } from './sequencer.js'

let reg = makeRegistry()
reg.add({ id: 'size', label: 'disc size', min: 5, max: 200, get: _ => S.size, set: v => { S.size = v } })
reg.add({ id: 'count', label: 'discs', min: 1, max: 12, step: 1, get: _ => S.count, set: v => { S.count = v } })
reg.add({ id: 'shape', label: 'shape', options: { disc: 0, square: 1 }, get: _ => S.shape, set: v => { S.shape = v } })
reg.add({ id: 'pos', label: 'centre', dims: 2, min: 0, max: 960, get: _ => S.pos, set: v => { S.pos = v } })

let seq = makeSequencer({
    host: document.querySelector('#panel'),   // any element; give it a height
    registry: reg,
    onSeek: (values, t) => draw(1),           // the timeline moved: show that state
    render: async samples => draw(samples),   // an export frame: render, resolve when finished
    grab: _ => canvas,                        // the finished picture: canvas, OffscreenCanvas, ImageBitmap or VideoFrame
    begin: ({ width, height, samples, fps }) => { /* switch to the export size, stop a live loop */ },
    end: _ => { /* back to the live size and loop */ },
    storageKey: 'myapp.timeline',             // autosave; omit for none
    defaults: { timeline: { fps: 30, duration: 8 }, export: { width: 1920, height: 1080, samples: 16 } },
})
```

The three hooks are the whole contract with a renderer:

- **onSeek** — the registry has just written the values for time `t` into your state; redraw.
- **render(samples)** — draw the current state with `samples` passes and resolve when the picture
  is complete. A path tracer accumulates that many samples and awaits the GPU; a 2D scene may
  just draw once and ignore the number.
- **grab()** — hand back the picture. It is copied straight into a `VideoFrame` (MP4) or drawn
  onto an OffscreenCanvas (PNG), so a canvas of the export size is all it needs to be.

`begin`/`end` bracket a recording so the host can render at the export size rather than the
window's, and stop and restart a live render loop. Between them the recorder drives everything:
for every frame it moves the playhead (which applies the timeline through the registry and calls
`onSeek`), awaits `render`, grabs, encodes, yields to the event loop, and repeats. STOP finishes
the file with the frames so far.

A property is `{ id, label, group, get, set, min, max, step, options, dims }`. `min/max` are
what the lane curve is drawn against, `step` rounds at apply time (`1` = integer), `options`
makes an enum that holds instead of blending, `dims > 1` animates an array (a camera pose as six
numbers, a position as two) with every component interpolated on its own.

## The editor

Tracks are one per property; **+ track** lists what is not tracked yet and keys the current value
at the playhead. Each header has **●** (key the current value here), the interpolation
(`linear`, `smooth`, `spline`, `step`) and **✕**. On the lanes: wheel zooms about the cursor,
shift+wheel pans, drag on the ruler or an empty lane scrubs, drag a key moves it (snapped to
frames; alt for free), double-click a lane keys the current value there, double-click a key edits
its value and time, right-click a key sets its ease-out (`in`, `out`, `inout`) or deletes it,
shift-click extends the selection, delete removes it. Space plays, arrows step a frame.

**⚙ export** opens the menu: size (presets or any even numbers), **renders / frame**, format,
bitrate, file name, the range in seconds, and — where the browser has `showSaveFilePicker` —
**to disk**, which streams the file while it records instead of holding it in memory (use it
for 4K or long sequences). **RECORD** runs it with a progress bar and ETA; **SAVE…/LOAD…** move
the timeline and the export settings as one JSON file:

```json
{ "app": "timeline", "version": 1,
  "timeline": { "fps": 30, "duration": 6, "tracks": [
      { "prop": "size", "interp": "smooth", "keys": [ { "t": 0, "v": 20 }, { "t": 3, "v": 90, "ease": "out" } ] },
      { "prop": "pos", "interp": "spline", "keys": [ { "t": 0, "v": [200, 270] } ] } ] },
  "export": { "width": 1280, "height": 720, "samples": 8, "format": "mp4", "bitrate": 12, "filename": "example", "from": 0, "to": 0, "stream": false } }
```

## Formats and browsers

- **MP4 (H.264)** uses the browser's own encoder through WebCodecs, muxed by the vendored
  `mp4-muxer`. Chromium-based browsers (Chrome, Edge, Brave, Opera). The profile/level is
  negotiated per resolution; 4K needs a machine whose encoder offers level 5.1 or above.
- **PNG sequence (ZIP)** works in every browser and is the lossless master for an editor or
  `ffmpeg -framerate 30 -i frame_%05d.png -c:v libx264 -pix_fmt yuv420p out.mp4`.
- **GIF** works in every browser; no browser can encode one, so `gif.js` does. Each frame gets
  its own 256-colour palette (median cut) and Floyd-Steinberg dithering, and the file loops for
  ever. GIF times frames in hundredths of a second: 30 fps plays as 3, 3, 4 cs and keeps time;
  above 50 fps frames are dropped, since browsers play a delay under 2 cs as 10 cs. It is for
  short clips at a small size: the encoding is on the CPU, about 0.3-0.4 s a 1920x1080 frame
  (node on a cloud container, 2026-10-09), and a frame that size was about 1 MB for a smooth
  gradient. The bitrate field does not apply. For the best GIF of a long or large film, record
  the PNG sequence and use `ffmpeg -framerate 30 -i frame_%05d.png -vf "split[a][b];[a]palettegen[p];[b][p]paletteuse" out.gif`.
- Pages must be served over http(s); `file://` blocks ES module imports, and WebGPU hosts need
  a secure context anyway.

## Using the pieces separately

`timeline.js` + `registry.js` alone give you `timeline.sample(t)` → `registry.apply(values)`
with no UI, for a scripted render. `recorder.js` + `encoders.js` alone turn any
`render/grab` pair into a file. `makeTimelineUI` and `makeExportUI` are what `makeSequencer`
wires together; use them directly to put the pieces in different places on the page.
