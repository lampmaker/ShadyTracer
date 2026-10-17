//======================================================================================================================
// THE EXAMPLES: documents in the scene format the builder reads (builder/model.js), listed under File › Examples
// (builder/filemenu.js) by who they are for and what they show, where one opens as a COPY in the project being worked
// on, seen as its file says (its view: the camera and the exposure, builder/model.js VIEW). They are not loaded at
// start: a page comes back to the project kept in the browser (workspace/); a first visit's project is FIRST_VISIT alone.
//
// MADE IN CODE (0.54.0; the user, 2026-10-10: "replace all example scenes ... SDF's may be new to people and I want to
// be able to demonstrate all the features. consider correct dimensions"): scenes/make.mjs builds each one through the
// model's API with its sizes and their reasons written out, and writes them and examples.js. The examples before
// these are test fixtures now (test/fixtures/scenes): the tests were written against them.
//
// TWO AUDIENCES, BY GROUPING ONLY (the user's choice): Modelling and rendering, for anyone making pictures and shapes,
// and Optical design, for whoever measures light. Nothing is hidden from either.
//
// check-shaders, codegen and the scene tests compile and check every one of them (test/scenes.mjs).
//======================================================================================================================

import { EXAMPLES } from './examples.js'
export { EXAMPLES }

/** Every example's file, in the menu's order. */
export const SCENE_FILES = EXAMPLES.map(e => e.file)

/** The menu as data: audiences in order, each its groups in order, each its examples. */
export const exampleMenu = () => {
    const out = []
    for (const e of EXAMPLES) {
        let a = out.find(x => x.audience === e.audience)
        if (!a) out.push(a = { audience: e.audience, groups: [] })
        let g = a.groups.find(x => x.group === e.group)
        if (!g) a.groups.push(g = { group: e.group, examples: [] })
        g.examples.push(e)
    }
    return out
}

/** An example by its file, or null. */
export const example = file => EXAMPLES.find(e => e.file === file) ?? null

/* A FIRST VISIT'S SCENE -- nothing kept in the browser yet: a project of this one alone. A LIGHTWEIGHT one (the
   user, 2026-10-02), since it is the first compile anyone waits for: five shapes, one group, no relief, no code. */
export const FIRST_VISIT = 'first-steps.json'

/** Where a scene's file is, relative to this module -- so it resolves wherever the page is. */
export const urlOf = file => new URL(`./${file}`, import.meta.url)
