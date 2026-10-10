//======================================================================================================================
// PROJECT -- several scene documents in one file, so working on another scene is a click in the
// tree rather than a save, an open and a lost undo history.
//
// PURE, like model.js: plain objects, no DOM, tested in test/project.test.mjs. A scene inside a
// project is exactly a model.js document -- the project only orders them and names each with a
// KEY. The key is fixed for the scene's lifetime, like a node id, for the same reason: the tree
// addresses a scene's rows by it, and an index would point at the wrong scene after a delete or
// a reorder. Node ids are unique only within their scene (each document counts its own), so the
// tree's row ids are `key:id` -- see tree.js.
//
// THREE FILES, one reader. parse() takes any of them and says which it was:
//   a SCENE      one document in the scene format (scenes/*.json)           serializeScene
//   a PROJECT    every scene, in order ("all scenes")                        serialize
//   a WORKSPACE  a project, which scene was current, and the renderer's own  serializeWorkspace
//                settings -- lighting, exposure, camera, size -- as the host hands them over
// What a file MEANS is the caller's (demo.js load): a scene or a project is added to the open
// one (importScenes), a workspace replaces it. This module does not know what the renderer's
// settings are; it carries them as an object and checks only that.
//======================================================================================================================

import * as M from './model.js'

export const FORMAT = 'raytracer-project'
export const VERSION = 1

const KEY = /^s[0-9]+$/

/** A project holding these documents, in order. */
export function createProject(docs = []) {
    const p = { format: FORMAT, version: VERSION, nextKey: 1, scenes: [] }
    for (const d of docs) addScene(p, d)
    return p
}

export const scene = (p, key) => p.scenes.find(s => s.key === key) || null
export const indexOf = (p, key) => p.scenes.findIndex(s => s.key === key)

const must = (p, key) => {
    const s = scene(p, key)
    if (!s) throw new M.ModelError(`no scene '${key}'`)
    return s
}

/** Add a document at `index` (the end if omitted); returns its entry { key, doc }. */
export function addScene(p, doc, index) {
    const entry = { key: `s${p.nextKey++}`, doc }
    p.scenes.splice(index == null ? p.scenes.length : Math.max(0, Math.min(index, p.scenes.length)), 0, entry)
    return entry
}

/** A NEW SCENE'S DOCUMENT: the functions template, a white material (model.ensureMaterial), nothing
 *  in it. One helper for every place a scene is made from nothing -- + Scene, closing the last one, a
 *  page or a builder that starts with no project -- so none of them is the one left without the white.
 *  IN CENTIMETRES, 25 cm ACROSS TO THE SKY (the user, 2026-10-02): a new scene is a workbench for an optic
 *  or a lamp, and its + shapes are 1 unit across (primitives.js), so a 1 cm sphere. createDoc stays in
 *  metres with the 400 m default: it is what every test, bench and library document is built on. */
export const NEW_SCENE = Object.freeze({ unit: 'cm', envRadius: 25 })
/* ...and seen from close by, the first time it is shown (demo.js markShown): the page's start angle (index.html
   camera), 4 units off -- a 1-unit shape a third of the view's height at the 40 degree field -- rather than
   wherever the scene before left the camera, 20 m off or 150 mm. dimensions is the parallel view's width. */
export const NEW_SCENE_CAMERA = Object.freeze({ mode: 'orbit', target: [0, 0, 0], azimuth: 40, elevation: 70, distance: 4, dimensions: 3 })
/* WHICH DOCUMENTS blankScene MADE, and have not been shown yet: only those get the camera above. Not "an empty
   scene": one loaded from a file or put back by an undo keeps the view as it is, as every scene shown for the
   first time does (demo.js; test/project.test.mjs). Held here, not in the document -- nothing to save, and a
   document copied (an undo, a load) is a new object that was never made from nothing. */
const fresh = new WeakSet()
export const blankScene = (title = 'New scene') => {
    const doc = M.ensureMaterial(Object.assign(M.createDoc({ title }), NEW_SCENE))
    fresh.add(doc)
    return doc
}
/** True once for a document blankScene made: the first time it is shown. */
export const takeFresh = doc => fresh.delete(doc)

/** A fresh, empty scene (blankScene). */
export function newScene(p, title = 'New scene', index) {
    return addScene(p, blankScene(uniqueTitle(p, title)), index)
}

/** The last scene cannot go: the builder always has one to show and edit. */
export function removeScene(p, key) {
    const i = indexOf(p, must(p, key).key)
    if (p.scenes.length === 1) throw new M.ModelError('the last scene cannot be removed')
    return p.scenes.splice(i, 1)[0]
}

/** A copy right after the original. Node ids are kept -- they only need to be unique within a
 *  scene -- so the copy's uniforms carry the same names, which is harmless: one scene is compiled
 *  at a time. */
export function duplicateScene(p, key) {
    const src = must(p, key)
    const doc = structuredClone(src.doc)
    // a copy of a library item being edited (library/edit.js) is a scene of the user's, not a second editor
    delete doc.libraryItem
    doc.title = uniqueTitle(p, `${src.doc.title} copy`)
    doc.root.label = doc.title
    return addScene(p, doc, indexOf(p, key) + 1)
}

/** Add documents from a file after `index` (the end if omitted), in their order; returns their
 *  entries. A title already in the project gets a number -- opening Menger twice gives
 *  "Menger cubes" and "Menger cubes 2", which the tree can tell apart. The documents are
 *  cloned: a project read once and imported twice must not share scenes. */
export function importScenes(p, docs, index) {
    let at = index == null ? p.scenes.length : index
    return docs.map(d => {
        const doc = structuredClone(d)
        doc.title = uniqueTitle(p, doc.title)
        doc.root.label = doc.title
        return addScene(p, doc, at++)
    })
}

/** Move a scene to `index` of the list after it has been taken out. */
export function moveScene(p, key, index) {
    const e = must(p, key)
    p.scenes.splice(indexOf(p, key), 1)
    p.scenes.splice(Math.max(0, Math.min(index, p.scenes.length)), 0, e)
    return e
}

const uniqueTitle = (p, t) => {
    const used = new Set(p.scenes.map(s => s.doc.title))
    if (!used.has(t)) return t
    let i = 2
    while (used.has(`${t} ${i}`)) i++
    return `${t} ${i}`
}

//----------------------------------------------------------------------------------------------
// Saving and loading
//----------------------------------------------------------------------------------------------

/* `app`, the version of the application writing a FILE (model.js withApp): given only by the File menu's saves
   (demo.js), never by undo's snapshots or the start-up copy, which are the project itself */
export const serialize = (p, { app } = {}) => JSON.stringify(M.withApp(p, app), null, 2)

export const WORKSPACE_FORMAT = 'raytracer-workspace'
export const WORKSPACE_VERSION = 1
/** The project, the key of the scene being worked on, the renderer's settings, and each scene's camera
 *  ({ key: camera }, as the renderer's settings hold one: demo.js keeps one per scene). */
export const serializeWorkspace = (p, current, renderer = {}, cameras = {}, { app } = {}) => JSON.stringify(
    M.withApp({ format: WORKSPACE_FORMAT, version: WORKSPACE_VERSION, current, renderer, cameras, project: p }, app), null, 2)
/** THE PROJECT AS A FILE HOLDS IT: without the scenes of library items being edited (library/edit.js) --
 *  they are the library's, saved there -- and with a current scene it still has: the one the item was opened
 *  from, else the first. Returns { project, current }; the same project when it has no such scene. Two
 *  callers: the builder's saves (demo.js) and a project kept in the browser exported as a file
 *  (workspace/store.js), which does keep the item, to reopen it after a reload. */
export function withoutItems(p, current) {
    const scenes = p.scenes.filter(s => !s.doc.libraryItem)
    if (scenes.length === p.scenes.length || !scenes.length) return { project: p, current }
    const from = scene(p, current)?.doc.libraryItem?.from
    const cur = scenes.some(s => s.key === current) ? current : scenes.some(s => s.key === from) ? from : scenes[0].key
    return { project: { ...p, scenes }, current: cur }
}

/** One scene alone, in the scene format -- the file model.parse reads. Not a library item's mark:
 *  a scene saved while an item was being edited is a scene of the user's, and reopening the file
 *  must not open an editor over it (duplicateScene says the same of a copy). */
export const serializeScene = (p, key, { app } = {}) => {
    const { libraryItem: _, ...doc } = must(p, key).doc
    return M.serialize(M.withApp(doc, app))
}

/** Every problem with a project, as strings; each scene's are model.validate's, prefixed. */
export function validate(p) {
    if (!p || typeof p !== 'object') return ['not an object']
    const out = []
    if (p.format !== FORMAT) out.push(`format is '${p.format}', expected '${FORMAT}'`)
    if (p.version !== VERSION) out.push(`version ${p.version} is not one this builder reads (it reads ${VERSION})`)
    if (!Number.isInteger(p.nextKey) || p.nextKey < 1) out.push('nextKey must be a positive integer')
    if (!Array.isArray(p.scenes) || !p.scenes.length) out.push('scenes must be a list of at least one')
    if (out.length) return out
    const seen = new Set()
    p.scenes.forEach((s, i) => {
        if (!s || typeof s !== 'object') return out.push(`scene ${i}: not an object`)
        if (typeof s.key !== 'string' || !KEY.test(s.key)) out.push(`scene ${i}: '${s.key}' is not a scene key`)
        else if (seen.has(s.key)) out.push(`scene ${i}: key '${s.key}' appears twice`)
        else if (+s.key.slice(1) >= p.nextKey) out.push(`scene ${i}: key '${s.key}' is not below nextKey`)
        seen.add(s.key)
        out.push(...M.validate(s.doc).map(x => `scene '${s.doc?.title ?? i}': ${x}`))
    })
    return out
}

/**
 * Text in: { doc } for a scene file, { project } for a project file, { workspace: { project,
 * current, renderer } } for a workspace -- each sound, or a ModelError listing everything wrong.
 * The scenes inside are upgraded like any scene.
 */
export function parse(text) {
    let raw
    try { raw = M.withoutApp(JSON.parse(text)) } catch (e) { throw new M.ModelError(`not JSON: ${e.message}`) }
    if (raw?.format === M.FORMAT) return { doc: M.parse(text) }
    if (raw?.format === WORKSPACE_FORMAT) return { workspace: workspaceOf(raw) }
    if (raw?.format !== FORMAT) throw new M.ModelError(`not a scene, a project or a workspace (format '${raw?.format}')`)
    return { project: projectOf(raw) }
}

function projectOf(raw) {
    raw = M.withoutApp(raw)          // a project inside a workspace is not stamped, but a hand-made one may be
    if (Array.isArray(raw?.scenes)) raw.scenes = raw.scenes.map(s => s && typeof s === 'object' ? { ...s, doc: M.upgrade(s.doc) } : s)
    const problems = validate(raw)
    if (problems.length) throw new M.ModelError(problems)
    return raw
}

function workspaceOf(raw) {
    const p = []
    if (raw.version !== WORKSPACE_VERSION) p.push(`workspace version ${raw.version} is not one this builder reads (it reads ${WORKSPACE_VERSION})`)
    if (raw.project?.format !== FORMAT) p.push('a workspace must hold a project')
    if (!raw.renderer || typeof raw.renderer !== 'object' || Array.isArray(raw.renderer)) p.push('renderer settings must be an object')
    if (p.length) throw new M.ModelError(p)
    const project = projectOf(raw.project)
    /* a current scene the project does not have is the first one: the file is still worth opening */
    const current = scene(project, raw.current) ? raw.current : project.scenes[0].key
    /* each scene's camera: optional (a workspace written before had none), and only objects for scenes it has */
    const cameras = raw.cameras && typeof raw.cameras === 'object' && !Array.isArray(raw.cameras)
        ? Object.fromEntries(Object.entries(raw.cameras).filter(([k, c]) => scene(project, k) && c && typeof c === 'object')) : {}
    return { project, current, renderer: raw.renderer, cameras }
}
