//======================================================================================================================
// THE SCENES THAT WERE THE EXAMPLES until 0.51.0, KEPT AS TEST FIXTURES. File › Examples has a new set (scenes/), made
// to show the program to someone new to it (the user, 2026-10-10: "replace all example scenes"). These stay because
// the tests were written against them: a relief group counted in noise.json, the optics test's lens, the RGBW
// mixer's units, the demo's build -- and because every scene the tests compile is one more shape of scene that has to
// keep compiling. Nothing in the page loads them.
//
// FIXTURE_SCENES is the list that was scenes/index.js SCENE_FILES, in its order: the tests that went over "every
// bundled scene" go over these and the examples both (test/scenes.mjs). The other files here (Menger_cubes.json,
// OpticsBench2.json, Optics_test_3 LED.json, Prism.json) were never listed; the tests that read the whole folder
// (the golden shaders, codegen's uniform names, the recipes) read them too, as before.
//======================================================================================================================

export const FIXTURE_SCENES = ['demoscene.json', 'menger.json', 'showcase.json', 'materials.json', 'demo.json', 'optics-test.json',
    'RGBW_mixer.json', 'surfaces.json', 'noise.json', 'OpticsBench.json']

/** Where a fixture scene's file is. */
export const fixtureUrl = file => new URL(`./${file}`, import.meta.url)
