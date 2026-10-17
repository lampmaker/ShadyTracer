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
//                settings -- quality, sampling, size -- as the host hands them over. Not the camera, the
//                exposure or the surface tolerance since 0.66.0: each scene has its own (model.js VIEW,
//                setTolerance), in its document; a workspace written before is read into the scenes
//                (workspaceOf, adoptViews).
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
/* ...and seen from close by (model.js VIEW): the page's start angle (index.html camera), 4 units off -- a 1-unit shape
   a third of the view's height at the 40 degree field -- rather than wherever the scene before left the camera, 20 m
   off or 150 mm. dimensions is the parallel view's width. In the document since 0.66.0, as every scene's camera is: it
   was held beside it, for the first time the scene was shown, and a new scene saved before it was shown had none. */
export const NEW_SCENE_CAMERA = Object.freeze({ mode: 'orbit', target: [0, 0, 0], azimuth: 40, elevation: 70, distance: 4, dimensions: 3 })
export const blankScene = (title = 'New scene') => {
    const doc = M.ensureMaterial(Object.assign(M.createDoc({ title }), NEW_SCENE))
    return M.setView(doc, { camera: { ...M.CAMERA_DEFAULTS, ...NEW_SCENE_CAMERA } })
}

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

/* THE HISTORY'S TEXT (demo.js): the project without any scene's view (model.js VIEW). Looking is not an edit: a
   snapshot that held the camera would make an undo move it back to where it was at that edit, and a commit after an
   orbit -- harmless by history.js's rule, nothing changed -- would record the orbit as a step. restore() gives each
   scene the view it has now back (carryViews). */
export const historyText = p => serialize({ ...p, scenes: p.scenes.map(s => {
    const { view: _, ...doc } = s.doc
    return { ...s, doc }
}) })
/** Each scene of `next` with the view the scene of the same key has in `from` -- or, for a scene `from` does not have
 *  (one an undo brings back), the one `memory` (Map by key) kept for it; or none (shown from the camera there is,
 *  converted, as a scene without one is). */
export function carryViews(next, from, memory = null) {
    for (const s of next.scenes) {
        const v = scene(from, s.key)?.doc.view ?? memory?.get?.(s.key)
        if (v) s.doc.view = structuredClone(v)
        else delete s.doc.view
    }
    return next
}

/* THE RENDERER'S SETTINGS AS A PROJECT KEEPS THEM (0.66.0): everything the renderer hands over (RT.settings) but what
   the scenes have of their own now -- the camera, the exposure (model.js VIEW_EXPOSURE) and the surface tolerance
   (`eps`). Saved, they were put back over the scene shown at every start (index.html applySettings), one scene's
   camera over another's, and one exposure and one tolerance for all. */
export function rendererSettings(s) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return {}
    const { camera: _, values = {}, ...rest } = s
    return { ...rest, values: Object.fromEntries(Object.entries(values || {}).filter(([k]) => !(k in M.VIEW_EXPOSURE) && k !== 'eps')) }
}
/**
 * WHAT A PROJECT KEPT BESIDE ITS SCENES, PUT INTO THEM (0.66.0): `views` { key: view } -- the browser's session, newer
 * than the documents it was written beside (the project's record is written only when an edit moves the revision; the
 * session every second: workspace/autosave.js) -- and, from a project or a workspace written before, `cameras`
 * { key: camera }, each scene's kept camera, and `renderer`, whose exposure was every scene's and whose tolerance
 * (eps, metres) was set while `current` was being worked on. A scene's own view comes first; a kept view that is not
 * sound is left out, never the reason a project does not open. Changes `p`; returns it.
 */
export function adoptViews(p, { views = null, cameras = null, renderer = null, current = null } = {}) {
    const obj = o => o && typeof o === 'object' && !Array.isArray(o)
    const exposure = M.exposureSettings(obj(renderer?.values) ? renderer.values : null)
    const tryView = (d, v) => { try { M.setView(d, v) } catch (e) { console.warn(`[project] a kept view of '${d.title}' left out: ${e.message}`) } }
    for (const s of p.scenes) {
        const d = s.doc, v = obj(views) ? views[s.key] : null
        if (obj(v)) tryView(d, { camera: obj(v.camera) ? v.camera : undefined, exposure: obj(v.exposure) ? v.exposure : undefined })
        const c = obj(cameras) ? cameras[s.key] : null
        if (!d.view?.camera && obj(c)) tryView(d, { camera: c })
        if (!d.view?.exposure && exposure && Object.keys(exposure).length) tryView(d, { exposure })
    }
    const eps = +renderer?.values?.eps, cur = scene(p, current)?.doc
    if (eps > 0 && cur && !cur.tolerance) {
        try { M.setTolerance(cur, Number((eps / (M.UNITS[cur.unit] ?? 1)).toPrecision(12))) }
        catch (e) { console.warn(`[project] the tolerance kept left out: ${e.message}`) }
    }
    return p
}
/** Every scene's view, { key: view }: what the browser's session keeps between the project's writes (adoptViews). */
export const viewsOf = p => Object.fromEntries(p.scenes.filter(s => s.doc.view).map(s => [s.key, structuredClone(s.doc.view)]))

export const WORKSPACE_FORMAT = 'raytracer-workspace'
export const WORKSPACE_VERSION = 1
/** The project, the key of the scene being worked on, and the renderer's settings -- without what the scenes have of
 *  their own (rendererSettings): each scene's camera and exposure are in its document (model.js VIEW). A workspace
 *  written before 0.66.0 had `cameras` beside the project; workspaceOf still reads them into the scenes. */
export const serializeWorkspace = (p, current, renderer = {}, { app } = {}) => JSON.stringify(
    M.withApp({ format: WORKSPACE_FORMAT, version: WORKSPACE_VERSION, current, renderer: rendererSettings(renderer), project: p }, app), null, 2)
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
 * The scenes inside are upgraded like any scene; a workspace's views and its old cameras, exposure and
 * tolerance are put into its scenes, and its renderer settings are what is left (adoptViews).
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
    /* WHAT IT KEPT BESIDE ITS SCENES, into them (adoptViews): the browser session's views (store.js workspaceText), and a
       workspace's from before 0.66.0 -- each scene's camera (optional: one written before 0.7.0 had none), and the
       exposure and tolerance its renderer settings held for every scene. What is left of those is the renderer's. */
    adoptViews(project, { views: raw.views, cameras: raw.cameras, renderer: raw.renderer, current })
    return { project, current, renderer: rendererSettings(raw.renderer) }
}
