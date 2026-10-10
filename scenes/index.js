//======================================================================================================================
// THE BUNDLED SCENES, THE EXAMPLES: documents in the scene format the builder reads (builder/model.js),
// listed in this order under File › Examples (builder/filemenu.js), where one opens as a
// COPY in the project being worked on. They are no longer loaded at start: a page comes back to the
// project kept in the browser (workspace/), and the nine of them in every project's tree, every visit,
// were clutter (the user, 2026-10-02; UI_PLAN.md section 10). check-shaders, codegen and the scene
// tests still compile and check every one of them from this list.
// The builder's demo is one of them (demo.json); it was built in code once, the only scene that
// was not a file.
//
// Menger cubes, Material showcase and Material test were hand-written WGSL scenes once
// (menger.js, showcase.js, materials.js, on scenes/common.js's palette), and these are their exact
// conversions: an offset `p + v` became a position -v (the same arithmetic), the old Nbox --
// rounded 0.01 OUTSIDE its size -- became a box primitive of size + 0.01 with rounding 0.01, which
// is the same Nroundedbox call, and the old smooth operators stayed in code nodes because the
// builder's CSG blends are a different polynomial. Menger's iteration count is a compile-time u32
// parameter, as its loop bound has to be. The hand-written files are gone; git has them.
//
// Adding a scene: select it in the Builder, Save > Current scene, put the file in this folder and
// add a line here. Its title is the document's own.
//======================================================================================================================

export const SCENE_FILES = ['demoscene.json','menger.json', 'showcase.json', 'materials.json', 'demo.json', 'optics-test.json', 'RGBW_mixer.json', 'surfaces.json', 'noise.json','OpticsBench.json']

/* A FIRST VISIT'S SCENE -- nothing kept in the browser yet: a project of this one alone. A LIGHTWEIGHT one (the
   user, 2026-10-02), since it is the first compile anyone waits for: Builder demo took 5.4-6.2 s on the user's
   Ampere card (PERFORMANCE.md runs 3-4), against 3.7-4.1 s for Material test, which is a test chart rather than a
   demo; Demo scene (demoscene.json) has a relief and was never measured. */
export const FIRST_VISIT = 'demo.json'

/** Where a scene's file is, relative to this module -- so it resolves wherever the page is. */
export const urlOf = file => new URL(`./${file}`, import.meta.url)
