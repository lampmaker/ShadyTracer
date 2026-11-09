# `lib/` — shared code

Everything here is **project-agnostic**: code that would serve a program that does not exist yet.
The application at the repository's root imports it with a relative path (`./lib/…` from
`app.html`, `../lib/…` from its modules).

Most of it exists **only here**. The rest is somebody else's, held one of two ways: as a **git
submodule** (tinywebgpu, GUISTUFF) or as a **vendored copy** (dockview, the timeline). Nothing else
should ever be either.

## What belongs here

Something belongs in `lib/` when it is useful to a project that does not exist yet: the
WebGPU toolkit, a camera, a timeline, a vendored third-party library. If it knows what a
Disney BSDF is, it belongs in the application, or in `pathtracer/` (see the exception below).

| | |
|---|---|
| `tinywebgpu/` | the WebGPU toolkit — **submodule**, [lampmaker/tinywebgpu](https://github.com/lampmaker/tinywebgpu); the page imports `tinywebgpu/src/tinywebgpu.js` |
| `guistuff/` | property table, tree view, split pane, and Tweakpane inside `propertytable/` — **submodule**, [lampmaker/GUISTUFF](https://github.com/lampmaker/GUISTUFF) |
| `wgsl_shorthand.js` | optional WGSL token expander for `G.defines` |
| `pathtracer/` | the wavefront SDF path tracer as a component — `sample(n)`, an opt-in loop, a scene contract, a viewport it owns. See `pathtracer/README.md`. **The one renderer in here**, and the exception below explains why |
| `render-loop.js` | the rAF loop, queue pacing and the damped sample-count governor, as an OPT-IN driver. A renderer that schedules its own frames cannot be embedded, so the core verb is "render n samples" and this is for hosts that just want the standalone behaviour. |
| `shell/` | an application shell: a menu bar, a dock of panels (drag, float, pop out, maximise, layout kept), a status bar, made from registries of panels, commands and parameters (every setting by a path, the timeline's contract). See `shell/README.md`. |
| `dockview/` | the docking library under `shell/` — **vendored**, dockview 8.3.1 (MIT), see `dockview/README.md` |
| `timeline/` | keyframe timeline, sequencer, MP4 or PNG-ZIP export — **vendored**, canonical copy is `CODE_WOOD/LIBRARIES/TIMELINE` |
| `camera.js` | orbit / fly camera |
| `utils.js` | misc helpers (canvas sizing, GUI state bag). **Off limits to automated edits** (its banner; CLAUDE.md) |
| `render-cost.js` | the render cost instrument and frame pacing — samples/s, ms/sample, cpu ms/frame, queue latency |
| `filename.js` | a saved file's name with the time it was saved, `render-2026-10-19_14-03-22.png`, unique within the page |

## Why this folder is worth being strict about

`tinywebgpu.js` once existed in **three** divergent copies across two repositories, and the
newest of them — the one with the async pipelines, the read-only bindings and the compute
pass batching — was the one nobody was releasing. GUISTUFF went the same way: the copy here
gathered four edits its own repository did not have. Both are submodules now, pinned to a
commit of their own repository, so the copy in use and the one published are the same file.

So: **never copy a file out of here into the application, and never edit a submodule in
place.** A change to tinywebgpu or GUISTUFF is a pull request there; then the pin moves here.

```sh
git submodule update --init                      # after a clone made without --recursive
git -C lib/tinywebgpu fetch && git -C lib/tinywebgpu checkout <commit>   # move a pin; commit the result
```

### The one exception, and what earns it

`pathtracer/` is a renderer, and by the rule above a renderer knows far too much to live
here. It is here anyway because **being usable by a program that does not exist yet is the
entire point of it** — an object builder that wants a preview, a weave editor whose real UI
is 2D and whose render is a button, a flow simulation that owns its own data and frame. It
takes the device, the camera constructor and the scene as arguments and reaches for none of
them; ShadyTracer, the application at this repository's root, is now one host among the ones
to come.

That is the bar. Not "more than one project might want this" — weavesim (in RAYTRACER_WEBGPU) has
its own tracer and is not a candidate — but "this is a service, and the thing importing it is the
application." A module that would have to be edited to serve a second caller has not met
it.

## Vendored copies

Two things here are copies of something kept elsewhere. Both are tracked rather than trusted.

**`dockview/`** — a third-party release, dockview 8.3.1 (MIT), the docking under `shell/`. It is
two files from the npm package, recorded with their hashes in `dockview/README.md`, together with
how to take a newer version. It is vendored rather than loaded from a CDN because the page
must open offline.

**`timeline/`** — canonical at `CODE_WOOD/LIBRARIES/TIMELINE`, where it stays because any
CODE_WOOD project may want it. The copy is here so the page boots without reaching across
repositories. Change it in CODE_WOOD, then:

```sh
node lib/timeline/sync.mjs --check ../CODE_WOOD   # report drift, exit 1 if any
node lib/timeline/sync.mjs        ../CODE_WOOD    # take the canonical version
```

`lib/timeline/PROVENANCE` names the CODE_WOOD commit this copy came from. Editing the copy
is pointless — the next sync reverts it.

This is a weaker rule than the one above, and that is a judgement about this particular
library: the timeline is finished and self-contained, so a stale copy costs little, while a
cross-repo import at boot costs a lot (the page once imported GUISTUFF from a CDN, and would
not load offline). If the timeline ever
starts moving again, the answer is its own repository and a submodule, the way tinywebgpu and GUISTUFF went.
