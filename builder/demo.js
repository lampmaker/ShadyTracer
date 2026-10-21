//======================================================================================================================
// DEMO -- two hardcoded nodes and a console, which is the whole of step one.
//
// No tree, no property panel, no editor. The previous scene builder had all three sitting on
// top of a generator whose output could not compile, and none of them could say so. So the
// order is inverted this time: the loop first, proved end to end, and the interface only once
// there is something for it to be an interface TO.
//
//   BUILDER.wgsl()    the generated source, to read
//   BUILDER.check()   generate and compile-check, WITHOUT touching the render
//   BUILDER.apply()   check, and on success hand it to the renderer
//   BUILDER.break()   introduce a typo, so the error path can be seen working
//   BUILDER.fix()     undo it
//   BUILDER.doc       the current scene's document (model.js); edit it with the model's operations
//   BUILDER.tree      what codegen sees: model.toTree(doc), read-only
//   BUILDER.live(id, k)  push parameter k of node id -- or its 'transform', or a group's
//                     'blend', or setting k of the scene's environment (id model.ENVIRONMENT_ID),
//                     or the scene's radius (the root's id, 'envRadius') -- to the renderer; no recompile
//   BUILDER.commit(key)  record an undo step after an edit (same key within a moment = one step)
//   BUILDER.setUnit(to, how)  the current scene's unit changed one of unitchange.js's three ways, one undo step,
//                     its camera and timeline converted with it -- to the renderer once the scene is (and back across
//                     an undo)
//   BUILDER.editPoints(id, k)  path or profile k of node id is being edited in the picture: compiled live
//                     until editPoints(null), so a dragged point compiles nothing
//   BUILDER.undo() / redo()  step through them; return what the renderer then needs
//   BUILDER.project   every scene (project.js); BUILDER.current the key of the one being edited,
//                     BUILDER.use(key) to change it (the next apply() shows it)
//   BUILDER.replace({ project, current })  another project altogether (one kept in the browser,
//                     workspace/): its own history from here, nothing to undo into the last
//   BUILDER.revision  raised by every recorded edit, undo, redo, load and replace: what the bake waits
//                     to see stand still (baker.js); BUILDER.saveRevision, it and a timeline kept, what the
//                     browser's autosave looks at (workspace/autosave.js)
//   BUILDER.saveScene()      download the current scene (the format of scenes/*.json)
//   BUILDER.save()           download every scene, as a project
//   BUILDER.saveWorkspace()  every scene, which is current, and the renderer's own settings
//                            (quality, sampling, size; each scene's camera and exposure are its own)
//   BUILDER.views()   every scene's view { key: view } (model.js VIEW): what the browser's session keeps
//   BUILDER.timeline()   the scene shown's timeline, whole (model.js TIMELINE); keepTimeline(t) writes it,
//                     and BUILDER.onTimeline(t), the host's, is told the next scene's as it is shown
//   BUILDER.exportPrint(id, '3mf' | 'stl')  export box `id`'s contents for a printer (exportbox.js)
//   BUILDER.open()    pick a file, any of the three -- it says which it is: a scene or a project
//                     is ADDED to the open scenes, a workspace replaces everything;
//                     BUILDER.load(text) does the same from text, loadFile(file) from a File
//
// The one that matters is break(). A builder whose happy path works proves very little -- the
// last one's happy path "worked" all the way to a page that rendered nothing. What has to be
// demonstrated is that a mistake produces `n2:2 -- unresolved identifier 'radiuss'` and not
// `error at line 431 of a file you never saw`.
//======================================================================================================================

import { generate, uniformName, xfName, blendName, joinBlendName, visName, paramUniform, livePointsUpdate, copyName } from './codegen.js'
import { validate } from './validate.js'
import { computeUniformTypes } from '../lib/pathtracer/core/uniforms.schema.js'
import * as M from './model.js'
import { createHistory } from './history.js'
import * as P from './project.js'
import { syncSources } from './sources.js'
import { lightRGBObject, beamOf } from './lights.js'
import { runExport } from './exportbox.js'
import { hazeOf } from './hazebox.js'
import { stamp } from '../version.js'
import { baked } from './bake.js'
import { animatedKeys, keptUniforms, liveUniformsOf } from './animate.js'
import { changeUnit, outsideAcross, unitFactor, cameraTimes } from './unitchange.js'

/* THE DEMO SCENE IS A FILE, scenes/demo.json, loaded with the other bundled scenes. It was built
   here in code once, the one scene that was not a file -- so it could not be opened, saved over
   or copied like the rest, and check-shaders compiled a second copy of it by a road of its own.
   It is here still in one sense: break() and fix() below edit its node `slab`. */

/**
 * @param project  the project to start with (project.js) -- the one kept in the browser, or a first
 *                 visit's (workspace/session.js); one empty scene if omitted
 * @param current  the key of its scene to start on (the first if omitted or not there) -- the one the
 *                 renderer was made with, so it counts as shown
 * @param onScene  the host's "the scene changed" hook. The builder swaps the scene from
 *                 outside the Scene page, so without this the panel keeps showing the
 *                 previous scene's sliders -- controls bound to uniforms that no longer
 *                 exist. Which panel to refresh is the host's business, not the builder's.
 * @param onDoc    called when the project is replaced -- loaded, undone, redone -- so a view of
 *                 the old one (the tree) can rebuild. Edits made through BUILDER.doc do not call it.
 */
export function installBuilder(window, { RT, gpu, project: initial, current: initialCurrent = null,
                                          onScene = () => { }, onDoc = () => { } }) {
    /* A PROJECT, and one scene of it CURRENT: `doc` below is always that scene, so everything
       written against a single document -- the panel, the model calls, live(), the console --
       works on whichever scene is being edited without knowing there are others. */
    let project = initial || P.createProject([P.blankScene()])
    const startup = P.serialize(project)          // what reset() goes back to
    let current = P.scene(project, initialCurrent) ? initialCurrent : project.scenes[0].key
    const doc = () => P.scene(project, current).doc
    const slab = () => M.find(doc(), 'slab')?.node
    let broken = null             // what break() replaced, for fix()
    /* ONE HISTORY FOR THE PROJECT, so deleting a whole scene is as undoable as moving a sphere.
       The current scene is not part of a snapshot: selecting is not an edit. Nor is any scene's view (its camera
       and exposure, model.js VIEW): looking is not an edit either (project.js historyText). */
    const history = createHistory(P.historyText(project))
    /* WHAT THE AUTOSAVE LOOKS AT (workspace/autosave.js): one more for every state of the project there has been
       -- a recorded edit, an undo, a redo, a load, another project -- so it serializes the scenes only when they
       may have changed, and never misses a change made through any of the places that edit */
    let revision = 0
    /* ...AND A TIMELINE KEPT (keepTimeline): written with the project as an edit is, but no undo step and nothing the
       bake waits out -- a key set changes no shader -- so counted apart from `revision`, which those two read */
    let timelineKept = 0

    /* A RESTORED PROJECT, and what the renderer needs to follow it. AN EDIT INSIDE A SCENE: the scene the step
       changed becomes current -- undoing an edit made in another scene shows that scene, rather than changing
       something off screen. A CHANGE TO THE LIST OF SCENES (a step committed with `scenes` in its meta: added,
       duplicated, deleted, reordered, renamed, copied or moved to, loaded) STAYS ON THE SCENE BEING WORKED ON
       (the user, 2026-10-17: "undo stays put") -- a deleted scene comes back as a card, a copy is taken back out of
       the scene it went to, and nothing compiles; until 0.63.0 each of those switched to the scene it changed, a
       compile of 4-23 s for a scene the user had not asked to see. Only where the step took the scene being worked
       on away (undoing a + Scene) does it go back where the step began. A library item opened or closed is a mode
       entered or left, not a list changed (`follow`): its undo goes back with it.
       If the scene ends up the one already showing and it generates the same shader text, only values differ --
       undoing a slider drag or a transform -- so every uniform is pushed and nothing compiles; and when a list
       change left it untouched, not even that (a push restarts the picture). Otherwise the caller has to apply.
       Returns 'live' or 'structural'. */
    /* WHAT A SCENE SAYS ABOUT ITSELF THAT IS NOT TEXT and the engine takes live (RT.updateScene) */
    /* ...its haze box too (hazebox.js; core/haze.js): its values; whether there is one is text, which the engine refuses
       to change here (an undo that adds or takes one away compiles: its comment is in the shader) */
    /* ...and its surface tolerance (0.66.0, model.js setTolerance): an undone tolerance is the scene's again */
    const sceneSelf = scene => ({ envRadius: scene.envRadius, unit: scene.unit, extent: scene.extent, haze: scene.haze ?? null,
                                  tolerance: scene.tolerance ?? null })
    const sync = () => {
        const scene = build()
        if (RT.scene?.id !== 'built' || scene.wgsl !== RT.scene.wgsl) return 'structural'
        /* A SCENE SHOWN AS DATA: undoing a node added, moved or deleted is the same text and other records -- written,
           with the values, by the engine (updateSceneData); refused, it is a compile */
        if (RT.scene.writeData) {
            if (!swapData(scene)) return 'structural'
            pushEnvironment()
            RT.updateScene?.(sceneSelf(scene))
            flushUnit()
            return 'live'
        }
        const values = {}
        for (const [k, u] of Object.entries(scene.uniforms)) {
            /* NOT THE CULLING BOXES: their defaults are "unknown", and the host keeps what it last sent (index.html
               pushCull), so a box written back to unknown here was never sent again -- undo left the scene unculled
               until a box changed. The host is asked to send them again below, from the document as it is now. */
            if (/^bx(lo|hi)_/.test(k)) continue
            values[k] = u.def && typeof u.def === 'object' ? (Array.isArray(u.def) ? u.def.slice() : { ...u.def }) : u.def
        }
        RT.set(values)
        try { BUILDER.afterLive?.(null, null) } catch (e) { console.warn('[builder] afterLive', e) }
        pushEnvironment()
        /* the radius, the unit and the extent are no uniforms but the scene's own (codegen): an undone drag of the radius,
           an undone unit change, a move that changes the scene's size -- each the same shader. The unit and the extent
           were left out until 0.36.0, so an undone unit change left the engine in the old one. */
        RT.updateScene?.(sceneSelf(scene))
        flushUnit()                   // a unit changed back or on by an undo: the camera with it, in the same moment
        return 'live'
    }
    let shown = current           // the scene RT is showing, whatever is current
    /* THE VIEW AND THE TIMELINE OF A SCENE TAKEN OUT, by its key: what an undo that brings it back gives it (a card's
       Delete, "Ctrl+Z brings it back"). The history's text holds neither (historyText, OUTSIDE_HISTORY), and a project
       restored from it gets those of the scenes it shares with the one before (carryOutside) -- not of one the step had
       taken out. The cameras kept beside the documents until 0.66.0, by the same key, were kept until a restore pruned
       them, so an undone delete had its camera back; this keeps that. Every scene's, as it is: at each commit, load,
       restore, view kept and timeline kept. Each part over what was kept of it: a scene with no timeline yet keeps the
       one it had. */
    const outsideMemory = new Map()
    const memorize = (key, d) => {
        const o = P.outsideOf(d)
        if (Object.keys(o).length) outsideMemory.set(key, { ...outsideMemory.get(key), ...o })
    }
    const remember = () => { for (const s of project.scenes) memorize(s.key, s.doc) }
    remember()
    /* EACH SCENE ITS OWN VIEW: its camera and its exposure (model.js VIEW; the user, 2026-09-30: "switching between
       scenes stores and restores camera setting", and 2026-10-17: "the information should belong to the scenes").
       IN THE DOCUMENT since 0.66.0: kept beside the documents until then, in a map saved only with a workspace and the
       browser's project -- a scene file, a duplicate and an example had none -- and with the camera alone, put back
       only in the fields it had: an example's has no field of view, so the next one opened kept the last one's, and
       a scene shown after Depth of field kept its open lens. The exposure was one for every scene.
       WRITTEN AS IT CHANGES (RT.watchView), into the scene the renderer SHOWS -- not the current one: during the
       compile of the next, the picture is still the last one's, and so is the camera moving over it. No commit and no
       revision: looking is not an edit (history), the bake waits for edits to stand still (baker.js), and a tab only
       looked through makes no copy (workspace/autosave.js). The browser's session keeps the views each second
       (BUILDER.views), so a reload comes back to them without an edit having written the project. */
    /* The camera and the exposure each on its own: one the model refuses (an EV a script set past its range) does not
       stop the other being kept. Said once a reason, not at every step of an orbit. */
    let viewRefused = null
    /* A UNIT CHANGE NOT SHOWN YET (setUnit, and its undo and redo in restore): { key, k }. The scene's document has its
       view in the new unit already; the renderer still shows the scene in the old one, its camera's numbers k times
       smaller, until the scene in the new unit is swapped in -- then the document's view goes to it (flushUnit), in the
       same moment, so the picture does not jump. Handed over at once, the old scene would be seen from 10 times as far
       for the whole compile (inferred from this order, never seen: it did not ship). Until then a camera kept from the renderer is converted on its way in: an orbit made during the
       compile is kept, and the meter's changes of the exposure write no camera in the old numbers over the new. */
    let unitPending = null
    const keepView = () => {
        const d = shown != null ? P.scene(project, shown)?.doc : null
        const v = d && RT.view?.()
        if (!v) return
        const camera = v.camera && unitPending?.key === shown ? cameraTimes(v.camera, unitPending.k) : v.camera
        for (const part of [{ camera: camera ?? undefined }, { exposure: v.exposure }]) {
            try { M.setView(d, part) }
            catch (e) {
                const why = `[builder] the view of '${d.title}' not kept: ${e.message}`
                if (why !== viewRefused) console.warn(viewRefused = why)
            }
        }
        memorize(shown, d)
    }
    RT.watchView?.(keepView)
    /* THE UNIT OF THE SCENE THE CAMERA WAS LAST IN: what a scene with no camera of its own converts it from (markShown) */
    let cameraUnit = doc().unit ?? 'm'
    /* ...AND THE SCENE THE RENDERER STARTS ON TOO. markShown puts a view back only when the scene shown changes, and at
       the start it does not: the renderer was made on `current`, so `shown` starts as it. A first visit's example camera
       was once handed in and never applied -- the page opened 20 mm into a tabletop scene (the user, 2026-10-13: "the
       camera is not right on a first open, it must be further away"). */
    {
        const v = M.sceneViewOf(doc())
        RT.applyView?.({ camera: v.camera ?? undefined, exposure: v.exposure })
    }
    /** The renderer shows the current scene now: this one's view comes back, whole -- every setting it leaves out the
     *  default, never the last scene's (model.js sceneViewOf). One with no camera of its own (a scene file written before
     *  0.66.0, a scene an undo brought back) is seen from the camera there is, said in its unit: 330 mm from a mm scene
     *  is 0.33 m in a metre scene, not 330 m. The meter starts again: another picture (RT.applyView fresh). */
    const markShown = () => {
        if (shown === current) { flushUnit(); return }      // the scene again, compiled: in its new unit if it changed
        keepView()                    // the scene left, as it is now (in its new unit, if one waits: unitPending)
        unitPending = null            // what is shown now is a document's view, whole, in its own unit
        shown = current
        const d = doc(), v = M.sceneViewOf(d)
        const live = RT.view?.()?.camera
        const camera = v.camera ?? (live ? M.cameraInUnit(live, cameraUnit, d.unit ?? 'm') : undefined)
        cameraUnit = d.unit ?? 'm'
        RT.applyView?.({ camera, exposure: v.exposure }, { fresh: true })
        /* ...AND ITS TIMELINE (model.js TIMELINE), whole too: the host's panel loads it (tools/timeline.js showScene).
           Said here, where the view changes hands, so the keys and the camera they move always belong to one scene. */
        try { BUILDER.onTimeline?.(M.sceneTimelineOf(d)) } catch (e) { console.warn('[builder] onTimeline', e) }
    }
    /* THE TIMELINE KEPT, into the scene the renderer SHOWS, as its view is (keepView): the one the panel was handed
       (markShown) and whose picture the keys move. Refused as one reason is said once, not at every key. */
    let timelineRefused = null
    const keepTimeline = t => {
        const d = shown != null ? P.scene(project, shown)?.doc : null
        if (!d) return false
        try { M.setTimeline(d, t) }
        catch (e) {
            const why = `[builder] the timeline of '${d.title}' not kept: ${e.message}`
            if (why !== timelineRefused) console.warn(timelineRefused = why)
            return false
        }
        memorize(shown, d)
        timelineKept++
        return true
    }
    /* THE VIEW AND THE TIMELINE OF A UNIT CHANGE, into the renderer and the Timeline panel, once the scene in its new
       unit is the one shown (unitPending above): from markShown after its setScene, and from sync and a swap of data,
       which change the unit without one */
    const flushUnit = () => {
        if (!unitPending || unitPending.key !== shown) return
        unitPending = null
        const d = P.scene(project, shown)?.doc
        if (!d) return
        cameraUnit = d.unit ?? 'm'
        const v = M.sceneViewOf(d)
        if (v.camera) RT.applyView?.({ camera: v.camera })
        try { BUILDER.onTimeline?.(M.sceneTimelineOf(d)) } catch (e) { console.warn('[builder] onTimeline', e) }
    }
    /* ...waiting for it: the renderer's numbers times k are the document's (a second change before the first is shown
       multiplies; a factor of 1 again, an undo before the swap, waits for nothing) */
    const unitWaits = (key, k) => {
        const was = unitPending?.key === key ? unitPending.k : 1
        unitPending = Math.abs(was * k - 1) < 1e-12 ? null : { key, k: was * k }
    }
    /* a scene's text as the history holds it: without its view or its timeline, which a snapshot does not have
       (historyText) */
    const editText = d => M.serialize(P.withoutOutside(d))
    const restore = (text, step = null, dir = 'undo') => {
        if (text == null) return null
        const before = new Map(project.scenes.map(s => [s.key, editText(s.doc)]))
        const at = P.indexOf(project, current), was = current
        remember()
        // each scene's view is the one it has now, or had when it was taken out: an undo is no move of the camera
        project = P.carryOutside(P.parse(text).project, project, outsideMemory)
        revision++
        /* ...BUT A UNIT CHANGE MOVED IT (unitchange.js): the camera and the timeline were converted with the scene, and
           are no part of the snapshot -- so they go back to the old unit across its undo, and on again across its redo,
           as they are now (a look around since kept). Into the renderer below, if the scene is the one it shows. */
        const unitScene = step?.unit ? P.scene(project, step.current)?.doc : null
        if (unitScene && outsideAcross(unitScene, step.unit, { undo: dir === 'undo' })) {
            memorize(step.current, unitScene)
            const k = unitFactor(step.unit.from, step.unit.to)
            if (step.current === shown) unitWaits(step.current, dir === 'undo' ? 1 / k : k)
        }
        const differs = s => before.get(s.key) !== editText(s.doc)
        const here = P.scene(project, current)
        const before1 = () => project.scenes[Math.max(0, Math.min(at - 1, project.scenes.length - 1))].key
        if (step?.scenes) {
            // where the step began (an undo goes back across it) or ended (a redo goes across it again)
            const there = dir === 'undo' ? step.was : step.current
            const exists = k => k != null && !!P.scene(project, k)
            if (step.follow && exists(there)) current = there
            else if (!here) current = exists(there) ? there : before1()
        } else {
            /* the scene being worked on, if the step changed it -- a Move to another scene (tree.js) changes this one
               and that one, and undoing it should not leave the one on screen */
            const changed = here && differs(here) ? here : project.scenes.find(differs)
            if (changed) current = changed.key
            // the current scene was the step (undoing "+ Scene"): go to the one before it
            else if (!here) current = before1()
        }
        onDoc(doc())
        if (step?.scenes && current === was && current === shown && !differs(P.scene(project, current))) return 'live'
        return current === shown ? sync() : 'structural'
    }

    /* a source given by flux has its luminance derived from the area of its sheets (sources.js
       syncSources), so the shader text is built from a document where that is current */
    /* A PATH OR PROFILE BEING EDITED IN THE PICTURE (the overlay's Points mode, pointsmode.js) is compiled LIVE
       whatever the document says, with room for codegen's EDIT_SPARE points more (codegen emitScene editing), so a
       point dragged or added writes uniforms and compiles nothing; once the editing stops it compiles as the document
       says again -- the user's "once it's finalized switch to compile mode" (2026-10-01), made for them. Kept here, in
       the one build, so a compile, an undo's sync() and the probe all see the same text. Keyed by scene: ids repeat
       between documents. */
    let editing = null          // { scene, key: 'id.k' }
    const editedNow = () => editing && editing.scene === current ? [editing.key] : []
    /* THE SCENE AS DATA (scenedata.js, PERFORMANCE.md P3) while the renderer's developer setting says so (sceneData) and
       the device has a ninth storage binding a stage: shade had nine with the scene's buffer (check-shaders' note), and
       tinywebgpu asks for what the adapter offers, which can be the spec's 8. Since 0.20.8 shade holds no scene and no
       kernel has more than 8 (check-shaders notes none); the gate is kept until data mode is run on an adapter of 8. Off: codegen, as before. On by
       default since 0.74.0 (the user: "Scene as data -> normally on"); the bake below still compiles codegen's text. */
    const dataMode = () => (RT.get?.()?.sceneData | 0) === 1 && (gpu?.device?.limits?.maxStorageBuffersPerShaderStage ?? 8) >= 9
    /* (The candidate grid and exact hits, sceneGrid and sceneExact, went in 0.41.0: roadmap/ARCHITECTURE.md, Removed in
       0.41.0. As data, every record is walked, culled by its box.) */
    /* ...AND THE BOUNDING BOXES: codegen's own way, a box test only on the nodes dearer than their box (codegen.js, ONLY
       THE DEAR ONES; 0.34.0). The renderer's setting `cull` that switched every box on or off is gone. */
    /* ...and the blocks of the scene shown, while it is this one: kept in the text (codegen `carry`), so deleting the
       last node with some code compiles nothing (call 2) */
    const carried = () => current === shown && RT.scene?.id === 'built' && RT.scene.blocks ? RT.scene.blocks : null
    const build = () => {
        /* COMPONENT PARAMETERS (model.js version 18): every bound value as its expression gives it now -- a node moved
           into a component, or pasted with its bindings, takes its values from the groups it is under at this compile. A
           name none of them has keeps the value it had (resolveBindings). BEFORE the light's derived luminance below,
           which reads what they write: a light's flux or size from its component's parameters (0.69.0; a size since
           version 18) was resolved after it, and the shader compiled with the luminance of the values before. */
        M.resolveBindings(doc())
        syncSources(doc())
        const data = dataMode()
        return generate(...M.generateArgs(doc(), { id: 'built', title: doc().title || 'Scene builder', editing: editedNow(), data,
                                                   carry: data ? carried() : null }))
    }
    /* THE CULLING BOXES the records carry (scenedata.js recordsOf `boxes`), from the host (BUILDER.cullBoxes: index.html,
       boxes.js cullBoxes nested) -- none known is never culled, as a codegen scene's unknown boxes are not */
    const boxesNow = () => { try { return BUILDER.cullBoxes?.() ?? null } catch (e) { console.warn('[builder] cullBoxes', e); return null } }
    const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
    /* THE RECORDS AGAIN, for the scene shown when it is data -- after a value changed, or a box was measured -- written
       into its buffer. Only while its nodes are numbered as they are (the tags the same): a structural edit not applied
       yet waits for its apply, which swaps the scene's tags too (updateSceneData). Returns whether it wrote them. */
    const pushData = ({ reset = true } = {}) => {
        const S = RT.scene
        if (current !== shown || S?.id !== 'built' || !S.dataOf || !S.writeData) return false
        const r = S.dataOf(M.toTree(doc(), { keepDisabled: true }), boxesNow())
        if (!r || !same(r.tags, S.tags || []) || !S.writeData(r.data)) return false
        if (reset) RT.invalidate?.()
        return true
    }
    /* A SCENE OF THE SAME TEXT AS THE ONE SHOWN, IN ITS PLACE: its records (with the boxes) written, nothing compiled --
       the engine checks the text (updateSceneData). False when it is not the same, or not data: the caller compiles. */
    const swapData = scene => {
        if (current !== shown || RT.scene?.id !== 'built' || !RT.scene.writeData || !scene.data || !RT.updateSceneData) return false
        const boxed = scene.dataOf(M.toTree(doc(), { keepDisabled: true }), boxesNow())
        if (boxed) scene.data = boxed.data
        if (!RT.updateSceneData(scene)) return false
        return true
    }
    /* ...and after a live edit -- a sheet resized or scaled, a flux typed -- the luminance of every
       source that changed goes to the renderer too, or 100 lm on a sheet made twice as big would
       quietly become 200 */
    /* THE SCENE'S ENVIRONMENT (model.js ENVIRONMENT) is renderer settings by their own names: set whenever the scene
       showing is (re)applied or restored -- WHOLE (0.66.0, model.js environmentOf): what it leaves out is the default,
       not what the scene shown before had (an example names three settings). A scene without one leaves the
       renderer's as they were. */
    const pushEnvironment = () => {
        const env = M.environmentOf(doc())
        if (env && current === shown) RT.set(env)
    }
    /* THE HAZE BOX (hazebox.js; the renderer's core/haze.js), from the document, after any live value -- its own, or a
       group's above it, which moves it -- into the scene the engine holds (RT.updateScene): uniforms, no compile.
       Whether, and taken: true when there is nothing to change. Only for a scene shown with one: whether there is one is
       the shader's text, a compile, which the caller makes when this is refused. */
    let hazeShown = null
    const pushHaze = d => {
        if (!RT.scene?.haze || !RT.updateScene) return false
        const h = hazeOf(d)
        const sig = JSON.stringify(h)
        if (sig === hazeShown && sig === JSON.stringify(RT.scene.haze)) return true
        const ok = !!h && RT.updateScene({ haze: h }).length === 0
        if (ok) hazeShown = sig
        return ok
    }
    const pushSources = () => {
        const d = doc()
        for (const id of syncSources(d))
            RT.set({ [uniformName(id, 'emissiveLuminance')]: M.find(d, id).node.light.luminance })
    }

    /* quiet: the code editor checks on every pause in typing, and a console line per
       keystroke-pause would bury anything worth reading there. */
    const check = async ({ quiet = false } = {}) => {
        const scene = build()
        const types = computeUniformTypes(scene.uniforms)
        const r = await validate(gpu, scene.body, scene.map, types, scene.resources || {})
        if (!quiet) console.log(r.ok ? '[builder] compiles clean'
            : '[builder] does NOT compile:\n' + r.report)
        return { scene, ...r }
    }

    /* WHAT A FILE MEANS is decided by what it is, not by asking. A SCENE or a PROJECT (all
       scenes) JOINS the open scenes, after the current one, and the first of them becomes
       current -- a project used to replace everything, which made "bring that scene over from
       last week's file" a matter of losing this week's. A WORKSPACE is the whole state of the
       work, so it REPLACES the scenes and puts the renderer's settings back. Each is one undo
       step for the scenes; the renderer's settings are not in the history (they never were --
       a slider on the Light page is not an undo step either). Returns a line saying what
       happened, for the status. */
    /* A scene file brings its view in its document (model.js VIEW), a workspace each scene's (project.js workspaceOf). */
    const load = text => {
        const r = P.parse(text)          // throws a ModelError listing every problem; nothing changed
        const loadedFrom = current
        let said
        /* A SCENE KEEPS A MATERIAL (model.ensureMaterial): one written before that, or by hand, gets the
           white as it comes in -- here, not in parse, which is also undo's format */
        if (r.workspace) {
            project = r.workspace.project; current = r.workspace.current
            for (const s of project.scenes) M.ensureMaterial(s.doc)
            /* its scenes' views are in them, and none of the old project's: the keys are the file's now. What the
               renderer shows is the old project's scene until the next apply, so nothing is "shown" */
            shown = null
            outsideMemory.clear()
            const unknown = RT.applySettings?.(r.workspace.renderer) || []
            if (unknown.length) console.warn(`[builder] workspace settings this renderer does not have, ignored: ${unknown.join(', ')}`)
            said = `opened a workspace of ${project.scenes.length} scene(s)`
        } else {
            const docs = r.project ? r.project.scenes.map(s => s.doc) : [r.doc]
            const added = P.importScenes(project, docs, P.indexOf(project, current) + 1)
            for (const s of added) M.ensureMaterial(s.doc)
            current = added[0].key
            said = added.length === 1 ? `added '${doc().title}'` : `added ${added.length} scenes`
        }
        // a change to the list of scenes: its undo takes them out and stays where it can (restore)
        history.commit(P.historyText(project), null, { scenes: 'load', was: loadedFrom, current })
        remember()
        revision++
        onDoc(doc())
        console.log(`[builder] ${said}`)
        return said
    }
    const download = (name, text) => {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
        const a = Object.assign(document.createElement('a'), { href: url, download: name })
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 0)
    }
    const fileName = t => String(t || 'scene').replace(/[^\w.-]+/g, '_') + '.json'
    /* A LIBRARY ITEM BEING EDITED (library/edit.js) is a scene of the project while it is open -- so the
       history holds it and an undo reaches into it -- but it is the library's, saved there, not one of the
       user's scenes. A file of the project or the workspace leaves it out (and a workspace's current scene
       is the one the edit goes back to). P.serialize itself keeps it: it is also the history's format. */
    const forFile = () => { const f = P.withoutItems(project, current); return { p: f.project, cur: f.current } }
    const saveBytes = (name, bytes, type) => {
        const url = URL.createObjectURL(new Blob([bytes], { type }))
        const a = Object.assign(document.createElement('a'), { href: url, download: name })
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 0)
    }

    let applying = 0
    /* THE BAKED SCENE'S SWAP AND AN APPLY NEVER AT ONCE (baker.js, showBaked below): each ends in the renderer's setScene,
       and two of those at once would install their kernels over each other. The bake's swap is not begun while an
       apply runs or waits (it is dropped: the next quiet moment bakes again), and an apply waits for a swap under way --
       from the pipeline cache, so a short wait. Applies among themselves are as they were (the tree queues them). */
    let bakeSwap = null
    /* ...and the live values pushed (live() below), counted: with `revision`, what says the edits have stopped */
    let liveEdits = 0
    /* ...but not an ANIMATED value's (model.js setAnimated): the bake keeps it a uniform (bakeScene), so a timeline
       playing it is no edit the bake must wait out -- counted apart, or the edits would never stand still while it
       plays and no bake would ever start, or one under way be shown (baker.js still()). `animatedAtBake`: the count
       when the scene being baked was made, its kept uniforms' values the document's then; moved by the time it is
       swapped in, they are pushed again (showBaked). */
    let animatedEdits = 0, animatedAtBake = 0
    /* WHY THE BAKED SCENE WAS LEFT, last time (the user, 2026-10-08: "it's hard to see any difference"): { at, why,
       scene } -- the baked scene it left -- for the status bar's tooltip (modeline.js), and said once in the console */
    let lastLeave = null
    const leaving = why => {
        if (!RT.scene?.baked || lastLeave?.scene === RT.scene) return
        lastLeave = { at: Date.now(), why, scene: RT.scene }
        console.log(`[bake] left for the editing build: ${why}`)
    }
    /* WHAT WAS CHANGED LIVE WHILE A COMPILE RAN, to push again once the new scene is in. A compile's uniforms are
       the document as it was when it began (check() -> build()), and the renderer swaps them in only when it ends
       (lib/pathtracer/index.js setScene; a builder scene carries nothing across, carryUniforms false). So a slider
       moved meanwhile was lost: refused, for a uniform only the new scene declares -- an own join blend just
       ticked on, whose slider the panel shows at once -- or written into the old state the swap throws away. The
       picture kept the value from the moment the compile began until the slider was touched again (the user,
       2026-10-01). Keyed by scene, node and key, so a drag is one entry; replayed through liveValue, which reads
       the document NOW. */
    const missed = new Map()
    /* THE LOOP HELD FOR THE WHOLE APPLY (lib/pathtracer/index.js RT.hold), from before the probe: setScene stops the
       loop only for its own part, and the probe ran with it still submitting. With it running, a revisit apply of the
       Noise library took 1.4-6.8 s -- the probe up to 3.4 s, then setScene's drain of what had queued meanwhile --
       and 0.2 s with it paused (measured on the user's GTX 1080 Ti, headless Chrome, 2026-10-03). Held, not
       stopped: the loop is still running when the apply ends, and the play/pause control never changed. The
       picture does not move while held: for the probe (the module alone, 9-59 ms in the demo scene, measured the
       same day with another window rendering) and then the compile, which setScene stopped the loop for already.
       Released in a finally: a probe that throws or says no leaves a loop that draws again. A renderer without
       hold (a test's stand-in) is not held. */
    const applyNow = async () => {
        const release = RT.hold?.() ?? (() => { })
        try { return await applyHeld() } finally { release() }
    }
    const applyHeld = async () => {
        const t0 = performance.now()
        const compiled = current          // check() builds the scene current now; it may not be by the end
        /* AN EDIT THAT ADDS NO CODE, to a scene shown as data -- a node added that is a copy, deleted, moved, hidden, given
           another material: the same text, other records. Written into its buffer: no probe, no compile (PERFORMANCE.md
           P3). Anything else -- new code, a new material, a scene not shown -- compiles as before. */
        if (dataMode()) {
            const scene = build()
            if (swapData(scene)) {
                missed.clear()                // nothing waited: no compile ran
                flushUnit()                   // its unit with it, if that changed (the scene's own, swapped in as data)
                pushEnvironment()
                onScene(RT.scene, 0)
                console.log(`[builder] scene applied as data: no compile, ${(performance.now() - t0).toFixed(0)} ms`)
                return { ok: true, scene: RT.scene, data: true }
            }
        }
        const r = await check()
        const probeMs = performance.now() - t0
        if (!r.ok) { missed.clear(); return r }     // the old scene stays, and the writes went to it
        /* Only now is setScene worth paying for: it rebuilds three kernels that inline
           the scene, which is seconds. The probe has already answered the question those
           seconds would answer -- for the SDF and the materials, not for every kernel: one the
           driver still refuses comes back here as a scene that does not compile, as the probe's
           would. The renderer has put back what it showed (its setScene, `restored`), so nothing
           changes hands: the scene shown is still the one it was. */
        let ms
        try { ms = await RT.setScene(r.scene) }
        catch (e) {
            missed.clear()
            console.error('[builder] does NOT compile: a kernel the probe passed was refused:', e)
            return { ...r, ok: false, report: `a kernel did not compile: ${e?.message ?? e}${e?.restored ? '' : ' (and the scene before could not be put back)'}` }
        }
        markShown()
        /* ONLY INTO THE SCENE THAT COMPILED, and only while it is still the one being edited: ids repeat between
           documents (another's box_3 is not this one's), and liveValue reads the current document. Switched away
           during the compile, the tree's apply loop compiles the scene now current next, from its own document. */
        if (current === compiled) for (const [scene, id, k] of missed.values()) if (scene === compiled) BUILDER.liveValue(id, k)
        missed.clear()
        pushEnvironment()
        onScene(r.scene, ms)
        // each part of a structural edit, for PERFORMANCE.md: the probe, then setScene's pipelines
        console.log(`[builder] scene applied: probe ${probeMs.toFixed(0)} ms, pipelines ${ms.toFixed(0)} ms, total ${(performance.now() - t0).toFixed(0)} ms`)
        return r
    }
    /* A NODE'S VALUE AS UNIFORMS: what liveValue did for every node before the scene could be data. `liveVis`: hidden
       nodes are compiled behind a uniform (the document's liveVisibility; always, in a scene as data). */
    const nodeLive = (doc, f, id, k, liveVis) => {
        /* A LIGHT's look: its colour, luminance and beam, the uniforms codegen declares for its
           face (LIGHTS there) -- the rest of its settings are the optics module's, read when it
           runs. The beam is how the face looks from an angle, so a distribution, n or cone edited
           changes what the camera sees of the light without a compile. */
        if (k === 'light' && f.node.type === 'light') {
            const L = M.lightOf(f.node)
            if (!M.hasFace(f.node.light)) return true
            return RT.set({ [uniformName(id, 'emissive')]: lightRGBObject(L),
                            [uniformName(id, 'emissiveLuminance')]: L.luminance,
                            [uniformName(id, 'beam')]: beamOf(L) }).length === 0
        }
        if (k === 'transform' && f.node.transform)
            return RT.set({ [xfName(id)]: M.matrixOf(f.node.transform) }).length === 0
        // AN ARRAY'S COPIES (model.js version 17): a uniform each -- refused when the count is not the one compiled
        if (k === 'copies') return !!f.node.copies && RT.set(Object.fromEntries(f.node.copies.map((t, i) => [copyName(id, i), M.matrixOf(t)]))).length === 0
            && !(copyName(id, f.node.copies.length) in (RT.scene?.uniforms || {}))
        /* SHOWN OR HIDDEN, live: only when the scene keeps hidden nodes compiled (liveVisibility);
           otherwise hiding is structural and the caller recompiles */
        if (k === 'enabled') return liveVis && RT.set({ [visName(id)]: f.node.enabled === false ? 0 : 1 }).length === 0
        if (k === 'blend' && f.node.kind === 'group')
            return RT.set({ [blendName(id)]: f.node.blend }).length === 0
        // a child's own join blend (model version 14): declared while its group combines one shape
        if (k === 'jblend') return f.node.joinBlend != null && RT.set({ [joinBlendName(id)]: f.node.joinBlend }).length === 0
        // an object's parameters, or a group's (for its code)
        if (!(k in (f.node.params || {}))) return false
        /* A PATH OR A PROFILE this reaches (codegen.js livePointsUpdate): a live one -- itself typed in, or a
           parameter its points name -- has its pieces written, or ok = 0 when unsound now; one whose chain of
           pieces changed, or a compiled one naming k, needs a compile, which only the host can run in its queue */
        const paths = livePointsUpdate(doc, id, k, RT.scene.pointParams)
        if (paths.restructure) {
            if (BUILDER.onRestructure) { try { BUILDER.onRestructure() } catch (e) { console.warn('[builder] onRestructure', e) } }
            else console.warn(`[builder] a path or profile of '${id}' changed its pieces: it needs a compile, and the host set no onRestructure`)
        }
        const pathsTook = !paths.restructure && (!Object.keys(paths.set).length || RT.set(paths.set).length === 0)
        let v = f.node.params[k]
        if (M.paramKind(v) === 'path' || M.paramKind(v) === 'profile') return pathsTook   // not a uniform itself: its pieces are
        if (typeof v === 'boolean') v = v ? 1 : 0          // codegen declares booleans u32
        else if (v && typeof v === 'object') v = Array.isArray(v) ? v.slice() : { ...v }
        return RT.set({ [uniformName(id, k)]: v }).length === 0 && pathsTook
    }
    const BUILDER = {
        get doc() { return doc() },
        get tree() { return M.toTree(doc()) },
        get project() { return project },
        /** One more for every state the project has been in (see `revision` above). */
        get revision() { return revision },
        /** WHAT THE AUTOSAVE LOOKS AT (workspace/autosave.js): `revision`, and one more for every timeline kept -- saved
         *  as an edit is, so a key set is in the project within the second and makes a second tab's copy, without
         *  being an undo step or an edit the bake waits out (`timelineKept` above). */
        get saveRevision() { return `${revision}.${timelineKept}` },
        /** Every scene's view: { key: view }, what the browser's session keeps between the project's writes. The one
         *  shown is written as it changes (keepView), so this is it as it is now. */
        views: () => P.viewsOf(project),
        /** THE TIMELINE OF THE SCENE SHOWN, whole (model.js sceneTimelineOf): the one the panel holds, as the camera is.
         *  The defaults while the renderer shows none of the project's (a workspace just opened, the safe start), when
         *  nothing is kept (keepTimeline). */
        timeline() {
            const d = shown != null ? P.scene(project, shown)?.doc : null
            return M.sceneTimelineOf(d ?? null)
        },
        /** Keep `t` (lib/timeline's { fps, duration, tracks, export }) as the scene shown's timeline: whole, the film's
         *  export settings only (model.js setTimeline). False when none is shown or the model refused it. */
        keepTimeline,
        /** The host's: told the timeline of each scene as it is shown (markShown), whole. */
        onTimeline: null,
        /** ANOTHER PROJECT ALTOGETHER -- one kept in the browser, opened from the list (workspace/session.js): its
         *  scenes, each with its view, and the one to work on. Its own undo history from here: undoing into the
         *  project before would write that one's scenes into this one. The renderer still shows the last
         *  project's scene until the caller applies; nothing counts as shown meanwhile. */
        replace({ project: next, current: cur = null }) {
            for (const s of next.scenes) M.ensureMaterial(s.doc)
            project = next
            current = P.scene(project, cur) ? cur : project.scenes[0].key
            shown = null; editing = null; missed.clear()
            outsideMemory.clear(); remember()       // another project's keys: none of the last one's views or timelines
            history.reset(P.historyText(project))
            revision++
            onDoc(doc())
            return doc()
        },
        /** The key of the scene being edited, and the way to change it. Changing it compiles
         *  nothing: the caller applies when it wants the picture to follow. */
        get current() { return current },
        use(key) {
            if (!P.scene(project, key)) throw new M.ModelError(`no scene '${key}'`)
            current = key
        },
        /** The camera scene `key` keeps (model.js VIEW), or null for one that has none. */
        cameraOf: key => structuredClone(P.scene(project, key)?.doc.view?.camera ?? null),
        /** Say the renderer shows the current scene now -- apply() does, after setScene: the view the scene it
         *  showed had is kept, and this one's put back. A host that shows a scene itself calls it. */
        markShown,
        /** SAY THE RENDERER SHOWS NO SCENE OF THE PROJECT: the page started it on an empty one, because the
         *  scene being worked on did not compile or was not to be compiled at start (index.html, safe start).
         *  Live edits then wait for the next apply, which shows the current scene; the camera stays as it is. */
        unshow() { shown = null },
        model: M,
        projectModel: P,
        generate: build,
        wgsl: () => { const s = build(); console.log(numbered(s.body)); return s.body },
        check,
        /** True from the probe to the new pipelines: what else would compete with it waits (the boxes). */
        get applying() { return applying > 0 },
        async apply() {
            // the baked scene shown and nothing said why it goes: an undo, a structural edit, a mode switch
            if (current === shown) leaving('an apply (an undo, a structural edit, or a mode switch)')
            applying++
            try {
                if (bakeSwap) { try { await bakeSwap } catch { } }
                return await applyNow()
            } finally { applying-- }
        },
        /** THE SCENE SHOWN, BAKED (bake.js; baker.js bakes it in the background once the edits stop): codegen's scene of
         *  the document as it is, every value a constant, the culling boxes kept uniforms (the host measures and sends
         *  them: index.html pushCull). Null when the scene being edited is not the one shown. */
        bakeScene() {
            if (current !== shown) return null
            M.resolveBindings(doc())         // first: the luminance syncSources derives reads what they write (build above)
            syncSources(doc())
            const S = generate(...M.generateArgs(doc(), { id: 'built', title: doc().title || 'Scene builder' }))
            /* the culling boxes, and every value flagged animated (animate.js): those stay uniforms, written live */
            const keep = keptUniforms(doc(), S)
            animatedAtBake = animatedEdits
            return baked(S, { live: n => /^bx(lo|hi)_/.test(n) || keep.has(n) })
        },
        /** ...SHOWN, unless an apply runs or waits, or `still()` says it is no longer what was baked: false then, nothing
         *  done. The picture is kept: the baked scene draws what the edit build drew. Resolves to whether it was shown;
         *  throws what setScene threw (the edit build is back then). Counts as applying while it runs. */
        async showBaked(scene, still = () => true) {
            if (applying > 0 || bakeSwap || !still() || current !== shown) return false
            applying++
            const p = RT.setScene(scene, { keepPicture: true })
            bakeSwap = p
            try { await p } finally { applying--; if (bakeSwap === p) bakeSwap = null }
            /* AN ANIMATED VALUE MOVED SINCE THE BAKE BEGAN (a timeline playing): the scene came in with the values it was
               made from, and what was written meanwhile went to the scene it replaced -- pushed again. Only then: a
               write restarts the picture the swap kept. */
            if (animatedEdits !== animatedAtBake && current === shown)
                for (const { id, k } of animatedKeys(doc()).values()) BUILDER.liveValue(id, k)
            return true
        },
        /** The last time the baked scene was left for the editing build: { at (ms since 1970), why, scene }, or null. */
        get lastLeave() { return lastLeave },
        /** One more at every live value pushed (live()): with `revision`, what the bake waits to see stand still. */
        get liveEdits() { return liveEdits },

        /** Push one parameter of one node to the renderer, without recompiling: it is a
         *  uniform. Only meaningful while the builder's scene is the one showing -- otherwise
         *  the document holds the value and the next apply() carries it. Returns whether the
         *  renderer took it (false for a disabled node too: its uniforms are not declared). */
        live(id, k) {
            const animated = animatedKeys(doc()).has(`${id}\n${k}`)
            if (animated) animatedEdits++; else liveEdits++
            // A MOVE (lib/pathtracer/interaction.js): a value pushed live -- a gizmo, a point, a slider -- traces a full picture
            // lighter until it stops (moveFast). An animated one too: a timeline playing is a move as long as it plays.
            try { RT.interacting?.poke?.() } catch { }
            if (applying > 0) missed.set(`${current}\n${id}\n${k}`, [current, id, k])     // see `missed`
            /* THE BAKED SCENE SHOWN (baker.js): its values are constants, so no value can be pushed to it -- the editing
               build back first, through the host's queue (an apply: from the pipeline cache), which builds from the
               document as it is now, this value with it; one moved while that runs is replayed (`missed`). The rest goes
               on as for any scene: the hook below still hears of it (a box no longer to be trusted).
               EXCEPT AN ANIMATED VALUE whose every uniform the bake kept (animate.js): written to the baked scene as to
               any other. Asked of the scene, not assumed from the flag: one flagged since the bake was made is a
               constant in it still, and goes the old way. */
            if (RT.scene?.baked && current === shown) {
                const U = RT.scene.uniforms || {}
                const stays = animated && liveUniformsOf(doc(), id, k, RT.scene).every(n => n in U)
                if (!stays) {
                    const what = M.material(doc(), id)?.label ?? M.find(doc(), id)?.node.label ?? id
                    leaving(`${what} ${k} moved: ${animated ? 'animated, but a constant in this bake (flagged after it was made)' : 'not animated'}`)
                }
                if (!stays && BUILDER.onRestructure) { try { BUILDER.onRestructure() } catch (e) { console.warn('[builder] onRestructure', e) } }
            }
            const took = BUILDER.liveValue(id, k)
            /* A MATERIAL FIELD ONLY IN THE SHADER WHILE IN USE (materials.js `only`: the colour depth) that the compiled
               scene does not declare yet: its first value in use is a compile, asked as pushBound asks one. Back to
               unused is no compile -- the uniform stays declared and its 0 means none until the next one. */
            if (!took && current === shown && applying === 0 && M.MATERIAL_FIELDS[k]?.only && M.material(P.scene(project, current).doc, id)
                && BUILDER.onRestructure) {
                try { BUILDER.onRestructure() } catch (e) { console.warn('[builder] onRestructure', e) }
            }
            /* AFTER EVERY LIVE CHANGE, whoever made it (the properties panel, the parameter registry, the
               timeline -- all come here): the host's hook, the culling boxes (index.html), which must stop
               trusting a box in the same call that changed its shape -- not at the boxes' next look half a
               second later, when an object grown by a slider would have been cut off by its old box. */
            try { BUILDER.afterLive?.(id, k) } catch (e) { console.warn('[builder] afterLive', e) }
            // ...and every value bound to what changed (model.js version 18), each pushed as if it had been dragged
            return BUILDER.pushBound() && took
        },
        /** COMPONENT PARAMETERS (model.js resolveBindings): resolve every binding of the current scene and push each
         *  value that moved, live -- a uniform, or the scene's records -- with the hook live() calls. One that only a
         *  compile can make (an array's count in codegen, a compile-time constant) asks the host for it, as a path's
         *  new pieces do (onRestructure): the panel and the registry do not read live()'s answer. `changed`: what a
         *  resolve already done changed (model.js setBindings returns it). Returns whether every one was taken. */
        pushBound(changed = null) {
            const d = P.scene(project, current).doc
            let all = true
            for (const { id, key } of changed ?? M.resolveBindings(d).changed) {
                if (applying > 0) missed.set(`${current}\n${id}\n${key}`, [current, id, key])
                // a hidden node's uniforms are not declared without live visibility: the next compile has its value
                if (M.find(d, id)?.node.enabled === false) continue
                if (!BUILDER.liveValue(id, key)) all = false
                try { BUILDER.afterLive?.(id, key) } catch (e) { console.warn('[builder] afterLive', e) }
            }
            if (!all && current === shown && applying === 0) {
                if (BUILDER.onRestructure) { try { BUILDER.onRestructure() } catch (e) { console.warn('[builder] onRestructure', e) } }
                else console.warn('[builder] a bound value needs a compile, and the host set no onRestructure')
            }
            return all
        },
        /** Set by the host: called after every live() (above), with its id and key. */
        afterLive: null,
        /** live() without the hook: the value pushed, and whether the renderer took it. */
        liveValue(id, k) {
            const doc = P.scene(project, current).doc
            if (current !== shown) return false      // its uniforms are not the ones compiled
            // the environment's settings are the renderer's own, not the scene's uniforms
            if (id === M.ENVIRONMENT_ID) {
                const env = doc.environment
                return !!env && k in env && RT.set({ [k]: structuredClone(env[k]) }).length === 0
            }
            /* THE SCENE'S RADIUS (model.js envRadius): a value of the scene object the renderer holds, not a
               uniform -- updateScene writes it there, no compile. Here, not in the panel, so the writes made
               during a compile are replayed into the scene that compiled (`missed`), as a parameter's are. */
            if (id === doc.root.id && k === 'envRadius')
                return RT.scene?.id === 'built' && !!RT.updateScene && RT.updateScene({ envRadius: doc.envRadius ?? null }).length === 0
            // ...AND ITS SURFACE TOLERANCE (0.66.0, model.js setTolerance), the same way
            if (id === doc.root.id && k === 'tolerance')
                return RT.scene?.id === 'built' && !!RT.updateScene && RT.updateScene({ tolerance: doc.tolerance ?? null }).length === 0
            if (RT.scene?.id === 'built') pushSources()
            /* A MATERIAL'S RELIEF: its parameters are owned by `<id>#relief` (materials.js) and are uniforms of
               their own (codegen paramUniform), live as a material's own are */
            const rm = M.reliefMaterialId(id)
            if (rm != null) {
                const R = M.material(doc, rm)?.relief
                if (RT.scene?.id !== 'built' || !R || !(k in (R.params || {})) || R.constants?.[k]) return false
                const v = R.params[k]
                return RT.set({ [paramUniform(id, k)]: v && typeof v === 'object' ? { ...v } : v }).length === 0
            }
            const mat = M.material(doc, id)
            if (mat) {
                if (RT.scene?.id !== 'built' || !(k in (mat.params || {}))) return false
                const v = mat.params[k]
                return RT.set({ [uniformName(id, k)]: v && typeof v === 'object' ? { ...v } : v }).length === 0
            }
            const f = M.find(doc, id)
            if (!f || RT.scene?.id !== 'built') return false
            /* THE HAZE BOX: moved and sized with whatever moved or sized it (its size uniform is declared as an export
               box's is, and written below like any parameter); its settings are no uniform of the scene's -- the
               engine's own (core/haze.js) -- so they are taken here or not at all */
            const hazeTook = pushHaze(doc)
            if (f.node.type === 'haze' && k === 'haze') return hazeTook
            if (!RT.scene.writeData) return nodeLive(doc, f, id, k, !!doc.liveVisibility)
            /* THE SCENE SHOWN IS DATA: a node's frame, visibility, parameters and joins are in its records, made again
               whole and written (pushData); what is still a uniform -- a light's look, everything in a compiled subtree --
               is set as before, and a name the scene does not declare is no failure here, the records have it */
            const viaUniforms = nodeLive(doc, f, id, k, true)
            /* ...but a node inside a compiled subtree is drawn by its code: only a uniform written reaches it (the
               records are written all the same: a light face's frame is in them), and a value no uniform takes -- an
               array's count -- needs the compile the caller makes on false */
            const wrote = pushData()
            return RT.scene.compiledIds?.has(id) ? viaUniforms : wrote || viaUniforms
        },
        /** Set by the host: the culling boxes the records carry, () => Map(id -> { lo, hi } | null) (boxes.js cullBoxes,
         *  nested). Read when the records are made: an apply as data, a live value, pushData(). */
        cullBoxes: null,
        /** Write the scene shown's records again (a box measured): whether it did -- false when it is not data, or its
         *  nodes are no longer numbered as shown. `reset` false: the picture is the same (a box that holds its node). */
        pushData: (opts) => pushData(opts),
        /** Whether the builder makes its scenes as data now (the renderer's sceneData, and a device that can). */
        get dataMode() { return dataMode() },
        /** Set by the host: run a compile in its own queue -- a live change to a path that only a compile can make
         *  (liveValue). The tree's apply() in the page (index.html). */
        onRestructure: null,
        /** Path or profile `k` of node `id` is being edited in the picture: compile it live, with room for more
         *  points, until this is called with null (see `editing` above). Asks the host for a compile (onRestructure)
         *  only when the shader the renderer shows would change. Returns whether it asked. */
        editPoints(id, k) {
            const next = id != null && k != null ? { scene: current, key: `${id}.${k}` } : null
            if ((editing?.scene ?? null) === (next?.scene ?? null) && (editing?.key ?? null) === (next?.key ?? null)) return false
            editing = next
            if (current !== shown || RT.scene?.id !== 'built' || build().wgsl === RT.scene.wgsl) return false
            if (BUILDER.onRestructure) { try { BUILDER.onRestructure() } catch (e) { console.warn('[builder] onRestructure', e) } }
            return true
        },
        /** What editPoints last said, as `'id.k'` in the current scene, or null. */
        get editingPoints() { return editing && editing.scene === current ? editing.key : null },
        /** The node a pick's tag names (lib/pathtracer/core/pick.js), or null. Only while the
         *  scene the renderer shows is the current one: tags are numbered per compiled scene, so a
         *  tag from a scene still showing while another is current would name a node of the wrong
         *  document -- ids are unique only within a scene. After an edit that has not recompiled
         *  yet the tags are the last compile's; a node deleted since is refused by the find. */
        nodeOfTag(tag) {
            if (current !== shown || RT.scene?.id !== 'built' || !(tag > 0)) return null
            const id = RT.scene.tags?.[tag - 1]
            return id != null && M.find(P.scene(project, current).doc, id) ? id : null
        },
        /** EXPORT FOR PRINTING (exportbox.js): everything solid inside export box `id`, as a 3MF with
         *  colour or an STL, downloaded. The field is the renderer's, so the scene has to be the one
         *  showing -- its uniforms are the ones the export kernel is compiled against. Resolves to
         *  what runExport says (triangles, palette, bytes). */
        async exportPrint(id, format = '3mf', onProgress = () => { }) {
            if (current !== shown || RT.scene?.id !== 'built') throw new Error('this scene is not the one showing: show it first (its \u25B6 in the tree)')
            const d = doc()
            const r = await runExport({ sample: (input, n) => RT.sampleField(input, n), doc: d, id, format, onProgress })
            const label = M.find(d, id)?.node.label
            const stem = fileName(`${d.title || 'scene'}${label && label !== 'export box' ? '-' + label : ''}`).replace(/\.json$/, '')
            saveBytes(`${stem}.${format}`, r.bytes, format === '3mf' ? 'model/3mf' : 'model/stl')
            return r
        },
        /** Call after any edit. Cheap when nothing changed -- the text is compared, and an
         *  identical one records nothing -- so a handler may call it unconditionally. `meta`: what the step
         *  was, for undo -- `{ scenes: what, was }` for a change to the list of scenes (tree.js), `follow: true`
         *  for a library item opened or closed; the scene current after it is added here. */
        commit(key = null, meta = null) {
            const recorded = history.commit(P.historyText(project), key, meta ? { ...meta, current } : null)
            remember()
            if (recorded) revision++
            return recorded
        },
        /** THE CURRENT SCENE'S UNIT SET TO `to`, `how` one of unitchange.js's UNIT_CHANGES: keep the numbers, or keep the
         *  real size by a scale or by the numbers. One undo step -- the step says what it was, so the camera and the
         *  timeline, which no snapshot holds, are converted back across its undo (restore). Returns the report
         *  ({ from, to, how, factor, skipped }), or null for the unit it has; a refusal throws and changes nothing.
         *  The caller compiles (the unit is the scene's own: codegen `unit`). */
        setUnit(to, how = 'keep') {
            const d = doc()
            if (current === shown) keepView()         // the camera as it is this moment, which is what is converted
            const r = changeUnit(d, to, how)
            if (!r) return null
            BUILDER.commit(null, { unit: { from: r.from, to: r.to, how: r.how } })
            memorize(current, d)
            // the camera and the keys go to the renderer and the panel with the scene in its new unit (flushUnit)
            if (current === shown) { if (how !== 'keep') unitWaits(current, r.factor); else if (!unitPending) cameraUnit = r.to }
            return r
        },
        /** A source's settings changed (the panel): derive and push its luminance, no compile. */
        syncSources() { if (current === shown && RT.scene?.id === 'built') pushSources() },
        undo: () => { const t = history.undo(); return restore(t, history.step, 'undo') },
        redo: () => { const t = history.redo(); return restore(t, history.step, 'redo') },
        /** Whether the renderer shows the current scene, compiled -- what anything reading the compiled
         *  scene about the document needs (its tags name this document's nodes only then). */
        get showing() { return current === shown && RT.scene?.id === 'built' },
        get canUndo() { return history.canUndo },
        get canRedo() { return history.canRedo },
        /** Download every scene as one project file. */
        save(filename) { download(filename || 'raytracer-scenes.json', P.serialize(forFile().p, { app: stamp() })) },
        /** Download a scene alone (the current one unless `key` names another), in the scene format (what scenes/ holds). */
        saveScene(filename, key = current) {
            const d = P.scene(project, key)?.doc
            if (d) download(filename || fileName(d.title), P.serializeScene(project, key, { app: stamp() }))
        },
        /** Download the workspace: every scene, which one is current, and the renderer's settings. */
        saveWorkspace(filename) {
            const { p, cur } = forFile()
            // each scene's view is in it; the renderer's settings are what is left (project.js rendererSettings)
            download(filename || 'raytracer-workspace.json', P.serializeWorkspace(p, cur, RT.settings?.() ?? {}, { app: stamp() }))
        },
        load,
        loadFile: async file => load(await file.text()),
        /** A file picker; resolves with what load() said, or rejects with what was wrong. */
        open() {
            return new Promise((res, rej) => {
                const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' })
                input.onchange = async () => {
                    const f = input.files?.[0]
                    if (!f) return rej(new Error('no file chosen'))
                    try { res(await BUILDER.loadFile(f)) } catch (e) { rej(e) }
                }
                input.click()
            })
        },
        /** Back to the project the page started with -- one undo step, like a load. */
        reset() {
            const was = current
            project = P.parse(startup).project; current = project.scenes[0].key
            outsideMemory.clear()          // the startup project's keys are handed out again from here
            history.commit(P.historyText(project), null, { scenes: 'reset', was, current }); revision++; remember(); onDoc(doc()); return doc()
        },
        /** Break it on purpose. This is the demonstration, not a convenience. */
        break() {
            if (!slab()) return console.log('[builder] break() needs the demo scene current (it edits node `slab`)')
            // its code is its block's (model.js version 16)
            const code = M.codeOf(doc(), slab())
            if (!code.includes('size, bevel')) return console.log('[builder] break(): the slab no longer says `size, bevel`; nothing to break')
            broken = { key: current, code }
            M.setCode(doc(), 'slab', code.replace('size, bevel', 'size, bevell'))
            console.log('[builder] typo inserted in node `slab` (bevel -> bevell); run BUILDER.check()')
        },
        fix() {
            if (broken?.key === current && slab()) M.setCode(doc(), 'slab', broken.code)
            broken = null
            console.log('[builder] restored')
        },
    }
    window.BUILDER = BUILDER
    return BUILDER
}

/** The generated source with line numbers, since every error report speaks in them. */
const numbered = src => src.split('\n')
    .map((l, i) => `${String(i + 1).padStart(4, ' ')} | ${l}`).join('\n')
