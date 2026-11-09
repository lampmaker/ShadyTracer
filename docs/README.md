# The documents

ShadyTracer is the LED and luminaire tool built on `lib/pathtracer`, at the root of this repository: open
`app.html` through a local server, or at <https://shadytracer.com/app.html> (its front page,
`index.html`, says what it is and links there). What the
program does is the repository's `README.md`; what is built, feature by feature, with its evidence, is
`FEATURES.md` at the root.

## The documents

They are in two folders. A plan says where something stands and what comes next. A reference says how
something works, or what was measured.

**`roadmap/`**: the plans.
- **`PLAN.md`** is where the path tracer stands, and the place to start. It covers what is built but
  not yet seen on hardware, the open work on lights and optics, and the scene builder's look-at list.
- `BUILDER.md`: where the scene builder goes next, and the speed rule its features are judged by.
- `SURFACES.md`: surface modifiers (grain, noise, relief, wear, hair), phase by phase.
- `UI_PLAN.md`: the UI decisions the user made, why, and what is still open.
- `ANALYTICS.md`: the optics charts' conventions, and the analyses still to build.
- `IMPORT.md`: CAD and mesh import, and what each file format would take. Investigated, not built.

**`docs/`**: the reference.
- **`TESTING.md`**: the in-page test bench, how to write a test, and the results pasted back from real
  hardware.
- **`PERFORMANCE.md`**: compile and render time, every benchmark run, and the performance plan (P1-P6).
- `PERFORMANCE_REVIEW.md`: a review of render and compile speed from the architecture down (2026-10-01,
  brought up to date with 0.9.1, then measured on a Pascal card on 2026-10-02): what each kernel holds, what a
  sample costs the CPU and the GPU, and twenty-seven improvements ranked on ease and gain, set against P1-P6.

Each of these files opens with its own status and date. Code comments cite their sections by name or
number, so a section that is cut leaves a stub rather than renumbering the rest.

## The code

| | |
|---|---|
| `app.html` | the application: the shell, the view, the menus, every panel |
| `version.js`, `CHANGELOG.md` | the version (semver 0.x, set by the release from the PRs' change notes) and the git revision the page reads from `.git`; one changelog entry per version, with what to look at |
| `release.mjs`, `changes/` | the release: the change notes merged into `dev` made one version, and `dev` pushed to `main` (CLAUDE.md, *Versions*; VS Code's *Release dev → main* task) |
| `builder/` | the scene builder: the document model, codegen to WGSL, the tree, the properties panel, the gizmo, export for 3D printing |
| `library/` | objects and materials kept in the browser: the store, the panel, the thumbnail studio, editing an item |
| `workspace/` | the projects kept in the browser: the store, which tab has which project, the autosave, the session (which project a page starts on, opening another), the Projects list |
| `optics/` | the Optics page (`page.js`) and the ray files kept in the browser (`rayfiles.js`) |
| `tools/` | the timeline |
| `scenes/` | the bundled scenes, as builder documents: File › Examples, and a first visit's scene |
| `bench/` | the benchmark's fixed scenes and variants (TESTING.md, *The benchmark*) |
| `test/`, `*/test/` | Node and headless checks; the full list is in `CLAUDE.md` at the root |
| `diagnose.js` | Help › Report: a report to paste back, for faults the page cannot see itself |
| `popout.html` | the empty window a popped-out panel moves into |
| `ui-mockups/` | the UI study of 2026-09-27 (UI_PLAN.md §6). `optics/test/page.html` still imports its `mock.js` |
| `tutorial/` | *ShadyTracer, inside out*, the developer tutorial: its plan (`tutorial/PLAN.md`), its pages and the figure kit they share (`tutorial/kit/`). Not part of the application; served beside it |
