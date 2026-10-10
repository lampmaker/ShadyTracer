//======================================================================================================================
// THE HELP'S CONTENTS -- every page, in the order the Help panel lists them, by track. The pages are markdown files
// beside this one (help/<file>), read by the panel (panel.js) and as they are on GitHub.
//
// TWO AUDIENCES, BY GROUPING ONLY (the user, 2026-10-10): Modelling and rendering, for anyone making shapes and
// pictures, who has little use for photometry or analysis; Optical design, for whoever measures light. Start and
// Reference are for both. Nothing is hidden from either.
//
// A page's title here is the one its first heading has (test/coverage.test.mjs holds the two together): the list is
// drawn before any page is fetched.
//======================================================================================================================

export const HELP = [
    { track: 'Start', pages: [
        { id: 'welcome', file: 'start/welcome.md', title: 'Welcome to ShadyTracer' },
    ] },
    { track: 'Modelling and rendering', pages: [
        { id: 'sdf', file: 'modelling/sdf.md', title: 'How shapes are made: distance functions' },
    ] },
    { track: 'Optical design', pages: [] },
    { track: 'Reference', pages: [
        { id: 'ref-shapes', file: 'reference/shapes.md', title: 'Shapes' },
        { id: 'ref-modifiers', file: 'reference/modifiers.md', title: 'Modifiers' },
        { id: 'ref-materials', file: 'reference/materials.md', title: 'Material fields' },
        { id: 'ref-lights', file: 'reference/lights.md', title: 'Light settings' },
    ] },
]

/** Every page, in order, each with its track. */
export const PAGES = HELP.flatMap(t => t.pages.map(p => ({ ...p, track: t.track })))
/** A page by id or by file, or null. */
export const page = key => PAGES.find(p => p.id === key || p.file === key) ?? null
/** The page a first visit to the panel opens. */
export const HOME = 'welcome'
/** Where a page's file is, relative to this module -- so it resolves wherever the app is served. */
export const urlOfPage = file => new URL(`./${file}`, import.meta.url)
