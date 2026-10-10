//======================================================================================================================
// THE LIBRARY'S BUILT-IN ASSEMBLIES: files of items (library/store.js), loaded with the library. The + menu's
// shapes, modifiers, lights and materials are built in too, but made from the tables the menu reads; these
// are the things that are more than one entry -- a lens in its glass, an LED, a whole bench.
//
// ADDING ONE: build it in a scene, keep it in the library (the Library panel's +), export the library,
// and put the item in a file here (a file is one item or { items: [...] }), with a line below.
//======================================================================================================================

export const ITEM_FILES = ['materials.json', 'optics.json']

/** Where an item file is, relative to this module -- so it resolves wherever the page is. */
export const itemUrl = file => new URL(`./${file}`, import.meta.url)
