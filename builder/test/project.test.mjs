//======================================================================================================================
// Tests for the project: several scenes in one file. Run: node builder/test/project.test.mjs
//======================================================================================================================
import * as M from '../model.js'
import * as P from '../project.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const eq = (name, got, want) =>
    ok(name, JSON.stringify(got) === JSON.stringify(want),
        `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
const throws = (name, fn, match) => {
    try { fn() } catch (e) {
        ok(name, e instanceof M.ModelError && (!match || match.test(e.message)), `threw: ${e.message}`)
        return
    }
    ok(name, false, 'did not throw')
}

const a = M.createDoc({ title: 'A' }), b = M.createDoc({ title: 'B' })
M.addObject(a, 'root', { id: 'x' })
M.addObject(b, 'root', { id: 'x' })          // the same id in another scene is fine
const p = P.createProject([a, b])
eq('scenes get keys in order', p.scenes.map(s => s.key), ['s1', 's2'])
eq('and the project is sound', P.validate(p), [])

const c = P.newScene(p)
eq('a new scene is empty and named', [c.doc.title, c.doc.root.children.length], ['New scene', 0])
// the user, 2026-09-30: a scene always has a material, a white diffuse -- and a new one had none
eq('...and has its white', c.doc.materials.map(m => [m.label, m.params.baseColor.r]), [['white', 0.8]])
eq('blankScene is the same document, for the page\'s and the builder\'s empty starts', P.blankScene('X').materials.length, 1)
// the user, 2026-10-02: a new scene is in centimetres, 25 cm to the sky; createDoc stays the metre scene with 400 m
eq('a new scene is in cm, its radius 25 cm', [c.doc.unit, c.doc.envRadius, M.envRadiusOf(c.doc)], ['cm', 25, 25])
eq('...and is sound', M.validate(c.doc), [])
eq('createDoc is not a new scene: metres, the default radius', [M.createDoc().unit, 'envRadius' in M.createDoc()], ['m', false])
eq('a second new one gets a title of its own', P.newScene(p).doc.title, 'New scene 2')
const d = P.duplicateScene(p, 's1')
eq('a duplicate goes right after its original', p.scenes.map(s => s.key), ['s1', 's5', 's2', 's3', 's4'])
eq('with its own title, on the root too', [d.doc.title, d.doc.root.label], ['A copy', 'A copy'])
M.addObject(d.doc, 'root', { id: 'y' })
ok('and is a copy, not the same object', !M.find(a, 'y'))

P.moveScene(p, 's4', 0)
eq('a scene can move', p.scenes.map(s => s.key), ['s4', 's1', 's5', 's2', 's3'])
P.removeScene(p, 's3')
eq('and be removed', p.scenes.map(s => s.key), ['s4', 's1', 's5', 's2'])
const again = P.newScene(p)
ok('a removed key is never handed out again', again.key === 's6')
throws('a missing scene is named', () => P.removeScene(p, 's99'), /s99/)
{
    const one = P.createProject([M.createDoc()])
    throws('the last scene cannot go', () => P.removeScene(one, 's1'), /last/)
}

const back = P.parse(P.serialize(p))
ok('a project round-trips', back.project && P.serialize(back.project) === P.serialize(p))
const single = P.parse(P.serializeScene(p, 's1'))
ok('one scene saves in the scene format and reads back as a scene', single.doc && single.doc.title === 'A')
{
    // a scene saved while a library item was being edited (library/edit.js) is the user's scene: no editor on reopening
    const q = P.createProject([M.createDoc({ title: 'item' })])
    q.scenes[0].doc.libraryItem = { id: 'x', kind: 'node', stage: [], stageMaterials: [] }
    const saved = P.serializeScene(q, q.scenes[0].key)
    ok('a scene saved alone carries no library item mark', !('libraryItem' in JSON.parse(saved)), saved.slice(0, 200))
    ok('...and the open scene keeps its mark', !!q.scenes[0].doc.libraryItem)
}
throws('anything else is refused', () => P.parse('{"format":"other"}'), /not a scene, a project or a workspace/)
throws('and so is broken JSON', () => P.parse('{'), /JSON/)
{
    const bad = JSON.parse(P.serialize(p))
    bad.scenes[1].key = bad.scenes[0].key
    bad.scenes[2].doc.root.children.push({ id: 'z', kind: 'object' })
    const e = (() => { try { P.parse(JSON.stringify(bad)) } catch (e) { return e } })()
    ok('a bad project lists every problem, naming the scene', e?.problems?.length >= 2
        && e.problems.some(x => /twice/.test(x)) && e.problems.some(x => /scene 'A copy'/.test(x)), e?.message)
}
{
    // a scene saved by an older builder, inside a project, is upgraded like a lone one
    const old = JSON.parse(P.serialize(p))
    const doc = old.scenes[0].doc
    doc.version = 1
    for (const n of doc.root.children) { delete n.transform }
    const r = P.parse(JSON.stringify(old))
    eq('an older scene inside a project is upgraded', r.project.scenes[0].doc.version, M.VERSION)
}

{
    // a workspace: the project, the current scene, and the renderer's settings, whatever they are -- but what each
    // scene has of its own (0.66.0): the camera, the exposure and the tolerance are in the scenes (model.js VIEW)
    const settings = { values: { sunIlluminance: 90000, tint: [1, 0.9, 0.8], exposureEV: 9, eps: 0 }, camera: { mode: 'orbit', azimuth: 12 }, size: { mode: 'fit' } }
    const w = P.parse(P.serializeWorkspace(p, p.scenes[1].key, settings)).workspace
    ok('a workspace round-trips its project', w && P.serialize(w.project) === P.serialize(p))
    eq('and which scene was current', w.current, p.scenes[1].key)
    eq('and the renderer settings, without the camera, the exposure or the tolerance', w.renderer,
        { size: { mode: 'fit' }, values: { sunIlluminance: 90000, tint: [1, 0.9, 0.8] } })
    const lost = JSON.parse(P.serializeWorkspace(p, 's999', {}))
    eq('a current scene it does not have falls back to the first', P.parse(JSON.stringify(lost)).workspace.current, p.scenes[0].key)
    const noRenderer = JSON.parse(P.serializeWorkspace(p, 's1')); noRenderer.renderer = 3
    throws('renderer settings that are not an object are refused', () => P.parse(JSON.stringify(noRenderer)), /renderer settings/)
    const badInside = JSON.parse(P.serializeWorkspace(p, 's1')); badInside.project.scenes[0].doc.nextId = 0
    throws('and so is a workspace whose project is unsound', () => P.parse(JSON.stringify(badInside)), /nextId/)
    ok('...and writes no cameras beside the scenes: each scene\'s is in it', !('cameras' in JSON.parse(P.serializeWorkspace(p, 's1', settings))))
    /* A WORKSPACE WRITTEN BEFORE 0.66.0: each scene's camera beside the project, one exposure and one tolerance in its
       renderer settings -- read into the scenes (project.js adoptViews) */
    const before = JSON.parse(P.serializeWorkspace(P.createProject([M.createDoc({ title: 'P' }), Object.assign(M.createDoc({ title: 'Q' }), { unit: 'mm' })]), 's2', {}))
    before.cameras = { s1: { mode: 'orbit', distance: 7, aspect: 1.5 }, s999: { distance: 1 }, s2: 3 }
    before.renderer = { values: { exposureEV: 9, autoExposure: 0, toneMap: 2, eps: 2e-6, maxbounce: 12 }, camera: { mode: 'orbit', distance: 20 } }
    const ow = P.parse(JSON.stringify(before)).workspace
    const [op, oq] = ow.project.scenes.map(s => s.doc)
    eq('an old workspace\'s camera goes into its scene, with only a camera\'s own settings', op.view?.camera, { mode: 'orbit', distance: 7 })
    ok('...none for a scene it gave none (or no object)', !oq.view?.camera)
    eq('...its exposure into every scene: it was every scene\'s', [op.view?.exposure, oq.view?.exposure],
        [{ exposureEV: 9, autoExposure: 0, toneMap: 2 }, { exposureEV: 9, autoExposure: 0, toneMap: 2 }])
    eq('...its typed tolerance into the scene being worked on, in its unit (2 um in mm)', [op.tolerance, oq.tolerance], [undefined, 0.002])
    eq('...and the renderer\'s settings are what is left', ow.renderer, { values: { maxbounce: 12 } })
    ok('...no cameras left beside them', !('cameras' in ow))
    // A SESSION'S VIEWS (workspace/store.js workspaceText): newer than the documents, so they win
    const sess = JSON.parse(P.serializeWorkspace(P.createProject([M.setView(M.createDoc({ title: 'R' }), { camera: { distance: 3 } })]), 's1', {}))
    sess.views = { s1: { camera: { distance: 5 }, exposure: { exposureEV: 4 } } }
    eq('a session\'s view is the one a scene comes back with', P.parse(JSON.stringify(sess)).workspace.project.scenes[0].doc.view,
        { camera: { distance: 5 }, exposure: { exposureEV: 4 } })
    sess.views = { s1: { camera: { distance: -1 } } }
    eq('...one that is not sound is left out, and the project still opens', P.parse(JSON.stringify(sess)).workspace.project.scenes[0].doc.view, { camera: { distance: 3 } })
}
{
    // THE HISTORY'S TEXT holds no view: looking is not an edit (project.js historyText)
    const h = P.createProject([M.setView(M.createDoc({ title: 'H' }), { camera: { distance: 3 }, exposure: { exposureEV: 4 } })])
    ok('the history\'s text has no view', !P.historyText(h).includes('"view"') && P.serialize(h).includes('"view"'))
    const back = P.carryViews(P.parse(P.historyText(h)).project, h)
    eq('...and a snapshot restored gets each scene\'s view back by its key', back.scenes[0].doc.view, h.scenes[0].doc.view)
    const dup = P.duplicateScene(h, 's1')
    eq('a duplicate comes with the view', dup.doc.view, h.scenes[0].doc.view)
    ok('...and a scene file too', JSON.parse(P.serializeScene(h, 's1')).view?.camera?.distance === 3)
    eq('a new scene comes with the close view, whole', M.sceneViewOf(P.blankScene()).camera,
        { ...M.CAMERA_DEFAULTS, ...P.NEW_SCENE_CAMERA })
    eq('the renderer\'s settings as a project keeps them', P.rendererSettings({ values: { exposureEV: 1, contrast: 0.2, eps: 1e-5, maxbounce: 3 }, camera: {}, size: { scale: 1 } }),
        { size: { scale: 1 }, values: { maxbounce: 3 } })
}
{
    // importing: scenes from a file join the open project, after a given scene, with titles kept apart
    const open = P.createProject([M.createDoc({ title: 'Menger cubes' }), M.createDoc({ title: 'B' })])
    const file = P.createProject([M.createDoc({ title: 'Menger cubes' }), M.createDoc({ title: 'C' })])
    const added = P.importScenes(open, file.scenes.map(s => s.doc), 1)
    eq('imported scenes go where they were put, in their order', open.scenes.map(s => s.doc.title), ['Menger cubes', 'Menger cubes 2', 'C', 'B'])
    eq('under fresh keys', added.map(e => e.key), ['s3', 's4'])
    eq('a renamed scene\'s root row says the same', open.scenes[1].doc.root.label, 'Menger cubes 2')
    ok('the file\'s documents are not shared with the project', open.scenes[1].doc !== file.scenes[0].doc && file.scenes[0].doc.title === 'Menger cubes')
    eq('and the result is sound', P.validate(open), [])
}

{
    /* UNDO STAYS PUT (0.63.0; the user, 2026-10-17): a change to the list of scenes -- committed as tree.js's sceneEdit
       and sendTo commit it, with `scenes` in the step's meta -- is undone and redone on the scene being worked on.
       Until then each switched to the scene it changed: a compile of seconds for a scene nobody asked to see. */
    const { installBuilder } = await import('../demo.js')
    const RT = { settings: () => ({}), applySettings: () => [] }
    const log = console.log; console.log = () => { }
    try {
        const B = installBuilder({}, { RT, project: P.createProject(['A', 'B', 'C'].map(title => M.createDoc({ title }))) })
        const key = t => B.project.scenes.find(s => s.doc.title === t)?.key
        const edit = (what, fn) => { const was = B.current; const next = fn(); if (next) B.use(next); B.commit(null, { scenes: what, was }) }
        B.use(key('B')); B.markShown()
        const titles = () => B.project.scenes.map(s => s.doc.title).join(' ')
        edit('delete scene', () => { P.removeScene(B.project, key('C')) })
        let r = B.undo()
        ok('another scene deleted and undone: it is back, and the scene worked on stays', titles() === 'A B C' && B.doc.title === 'B', titles())
        eq('...nothing to compile, nothing pushed: the picture goes on', r, 'live')
        r = B.redo()
        ok('...redone: gone again, still here', titles() === 'A B' && B.doc.title === 'B' && r === 'live', `${titles()} ${r}`)
        B.undo()
        // copy to another scene (tree.js sendTo): this one is unchanged, that one gets the copy
        const { primitiveObject } = await import('../primitives.js')
        const C = P.scene(B.project, key('C')).doc
        const ball = M.addObject(B.doc, B.doc.root.id, { ...primitiveObject('sphere'), label: 'ball' })
        B.commit()
        edit('copy to', () => { M.insertAsset(C, M.extractAsset(B.doc, ball.id), C.root.id) })
        B.undo()
        ok('a copy to another scene undone: taken out of it, and no switch to it', B.doc.title === 'B'
            && !P.scene(B.project, key('C')).doc.root.children.some(n => n.label === 'ball'))
        B.undo()                                                    // the ball added here
        edit('rename scene', () => { P.scene(B.project, key('A')).doc.title = 'A2' })
        B.undo()
        ok('another scene renamed and undone: still here', B.doc.title === 'B' && titles() === 'A B C', titles())
        edit('reorder scenes', () => { P.moveScene(B.project, key('C'), 0) })
        B.undo()
        ok('scenes reordered and undone: still here', B.doc.title === 'B' && titles() === 'A B C', titles())
        // the scene worked on deleted: the one before it is shown; its undo brings it back as a card and stays there
        edit('delete scene', () => { const i = P.indexOf(B.project, key('B')); P.removeScene(B.project, key('B')); return B.project.scenes[i - 1].key })
        ok('the scene worked on deleted: the one before it worked on', B.doc.title === 'A' && titles() === 'A C')
        B.undo()
        ok('...undone: back in the list, and the undo stays on the one before', B.doc.title === 'A' && titles() === 'A B C', `${B.doc.title} ${titles()}`)
        // a new scene made and worked on: undoing it takes away the scene worked on, so back where the step began
        B.use(key('C'))
        edit('new scene', () => P.newScene(B.project, 'D', P.indexOf(B.project, key('C')) + 1).key)
        ok('a new scene is worked on', B.doc.title === 'D')
        B.undo()
        ok('...undone: gone, and back to the scene it was made from', B.doc.title === 'C' && titles() === 'A B C', `${B.doc.title} ${titles()}`)
        B.redo()
        ok('...redone: made again, and still on that one (it stays put)', B.doc.title === 'C' && titles() === 'A B C D', `${B.doc.title} ${titles()}`)
        // a file loaded: its scene worked on; undone, back where the load began
        B.load(M.serialize(M.createDoc({ title: 'Lamp' })))
        B.undo()
        ok('a load undone: its scene gone, back on the scene it was loaded from', B.doc.title === 'C' && !titles().includes('Lamp'), `${B.doc.title} ${titles()}`)
        // AN EDIT INSIDE A SCENE keeps the rule it had: its undo shows the scene it changed
        B.use(key('A'))
        M.addObject(B.doc, B.doc.root.id, { ...primitiveObject('sphere'), label: 'pip' }); B.commit()
        B.use(key('B'))
        B.undo()
        ok('an edit inside another scene undone: shown, as before', B.doc.title === 'A')
    } finally { console.log = log }
}

{
    /* WHAT OPEN DOES WITH EACH KIND OF FILE -- demo.js load, driven here with a stand-in renderer,
       since this is page code that otherwise only ever runs in a browser. */
    const { installBuilder } = await import('../demo.js')
    let given = null
    const RT = { settings: () => ({ values: { exposure: 2 } }), applySettings: s => { given = s; return ['gone'] } }
    const warn = console.warn, log = console.log
    console.warn = console.log = () => { }
    try {
        const B = installBuilder({}, { RT, project: P.createProject([M.createDoc({ title: 'A' }), M.createDoc({ title: 'B' })]) })
        const sceneFile = M.serialize(M.createDoc({ title: 'Lamp' }))
        B.load(sceneFile)
        eq('a scene file joins the open scenes, after the current one', B.project.scenes.map(s => s.doc.title), ['A', 'Lamp', 'B'])
        eq('and becomes current', B.doc.title, 'Lamp')
        B.load(P.serialize(P.createProject([M.createDoc({ title: 'A' }), M.createDoc({ title: 'C' })])))
        eq('a project file ADDS its scenes, titles kept apart', B.project.scenes.map(s => s.doc.title), ['A', 'Lamp', 'A 2', 'C', 'B'])
        eq('the first of them current', B.doc.title, 'A 2')
        ok('each is an undo step', B.undo() && B.project.scenes.length === 3 && B.undo() && B.project.scenes.length === 2)
        const ws = P.serializeWorkspace(P.createProject([M.createDoc({ title: 'X' }), M.createDoc({ title: 'Y' })]), 's2', { values: { exposure: 3 } })
        B.load(ws)
        eq('a workspace replaces the scenes', B.project.scenes.map(s => s.doc.title), ['X', 'Y'])
        eq('with its current scene current', B.doc.title, 'Y')
        eq('and hands the renderer its settings', given, { values: { exposure: 3 } })
        let bad = null
        try { B.load('{"format":"raytracer-scene"}') } catch (e) { bad = e }
        ok('a bad file is refused and changes nothing', bad?.problems && B.project.scenes.length === 2)
    } finally { console.warn = warn; console.log = log }
}

/* A STAND-IN RENDERER WITH A VIEW (0.66.0, lib/pathtracer/index.js view, applyView, watchView): it puts a camera back
   ONLY IN THE FIELDS IT IS GIVEN, as the real one does (applyCamera) -- the stand-in these tests had replaced the whole
   camera, so a camera put back without its field of view, which kept the last scene's, could not fail them. A drag
   (move) tells its watchers, as the camera's onChange does. */
const standIn = (cam0, exposure0 = { exposureEV: 15, autoExposure: 1 }) => {
    const R = { cam: structuredClone(cam0), exposure: structuredClone(exposure0), fresh: 0 }
    const watchers = new Set(), tell = () => watchers.forEach(f => f())
    R.RT = {
        view: () => ({ camera: structuredClone(R.cam), exposure: structuredClone(R.exposure) }),
        applyView: ({ camera, exposure } = {}, { fresh = false } = {}) => {
            if (camera) Object.assign(R.cam, structuredClone(camera))
            if (exposure) Object.assign(R.exposure, exposure)
            if (fresh) R.fresh++
            tell()
        },
        watchView: f => (watchers.add(f), () => watchers.delete(f)),
        settings: () => ({ values: { maxbounce: 10, eps: 0, ...R.exposure }, camera: structuredClone(R.cam), size: { mode: 'fit' } }),
        applySettings: () => [],
    }
    R.move = patch => { Object.assign(R.cam, patch); tell() }
    return R
}
{
    /* EACH SCENE ITS OWN VIEW (the user, 2026-09-30 and 2026-10-17): its camera and its exposure, in its document,
       written as they change into the scene shown, put back whole when it is shown again (demo.js markShown, which
       apply() calls after setScene) */
    const { installBuilder } = await import('../demo.js')
    const R = standIn({ mode: 'orbit', distance: 5, azimuth: 30, fov: 25, aperture: 8, focus: 0 })
    let saved = null
    const realDoc = globalThis.document
    globalThis.document = { createElement: () => ({ click() { } }) }
    const realURL = URL.createObjectURL
    URL.createObjectURL = blob => { saved = blob; return 'blob:x' }
    const log = console.log; console.log = () => { }
    try {
        // B: an example's camera as examples.js had it -- no field of view, no lens; C none at all
        const docB = M.setView(M.createDoc({ title: 'B' }), { camera: { mode: 'orbit', target: [0, 0, 0], azimuth: -60, elevation: 65, distance: 330, dimensions: 330 },
                                                            exposure: { exposureEV: 9, autoExposure: 0 } })
        const B = installBuilder({}, { RT: R.RT, project: P.createProject([M.createDoc({ title: 'A' }), docB, M.createDoc({ title: 'C' })]) })
        const [a, b, c] = B.project.scenes.map(s => s.key)
        eq('the scene the renderer starts on keeps the view there is, and has it now', B.cameraOf(a)?.distance, 5)
        R.move({ distance: 6 })
        eq('a move is written into the scene shown, as it happens', B.cameraOf(a)?.distance, 6)
        ok('...and is no edit: nothing to undo, no revision', !B.canUndo && B.revision === 0)
        ok('...an edit after it records no move either', !B.commit() && !B.canUndo)
        B.use(b); B.markShown()
        eq('B shown: its camera', [R.cam.distance, R.cam.azimuth], [330, -60])
        eq('...WHOLE: what it leaves out is the default, not what A was seen with (A\'s field of view, its open lens)',
            [R.cam.fov, R.cam.aperture, R.cam.camtype], [40, 0, 0])
        eq('...and its exposure', [R.exposure.exposureEV, R.exposure.autoExposure], [9, 0])
        ok('...the meter started again: another picture', R.fresh === 1)
        R.move({ distance: 150 })                       // looked at B from elsewhere
        B.use(a); B.markShown()
        eq('back to A: the camera A was left with, its own field and lens', [R.cam.distance, R.cam.fov, R.cam.aperture], [6, 25, 8])
        eq('...and A\'s exposure, the defaults: it set none', [R.exposure.exposureEV, R.exposure.autoExposure], [15, 1])
        B.use(b); B.markShown()
        eq('back to B: B\'s', R.cam.distance, 150)
        eq('...which the builder can say', [B.cameraOf(a)?.distance, B.cameraOf(b)?.distance, B.cameraOf(c)], [6, 150, null])
        const n = R.fresh
        B.markShown()
        ok('marking the scene already showing changes nothing', R.cam.distance === 150 && R.fresh === n)
        // an undo is no move of the camera
        M.addObject(B.doc, 'root', { primitive: 'sphere' }); B.commit()
        R.move({ distance: 77 })
        B.undo()
        eq('an undo leaves the camera where it is, and the scene keeps it', [R.cam.distance, B.cameraOf(b)?.distance], [77, 77])
        B.saveWorkspace('w.json')
        const text = await saved.text(), file = JSON.parse(text)
        eq('a workspace has each scene\'s view in it, the one showing as it is', file.project.scenes.map(s => s.doc.view?.camera?.distance), [6, 77, undefined])
        ok('...and no camera or exposure among the renderer\'s settings', !file.renderer.camera && !('exposureEV' in file.renderer.values) && !('eps' in file.renderer.values)
            && file.renderer.values.maxbounce === 10, JSON.stringify(file.renderer))
        eq('the views the session keeps', Object.keys(B.views()), [a, b])
        R.move({ distance: 1 })
        B.load(text); B.markShown()
        eq('opened again, its current scene is seen from where it was', R.cam.distance, 77)
        B.use(a); B.markShown()
        eq('...and so is the other', R.cam.distance, 6)
    } finally { globalThis.document = realDoc; URL.createObjectURL = realURL; console.log = log }
}
{
    /* A SCENE DELETED AND BROUGHT BACK BY UNDO keeps its view (a card's "Delete (Ctrl+Z brings it back)"): the history's
       text holds no view, so the project restored from it takes each scene's from the one before (carryViews) -- and a
       scene the step had taken out from the builder's memory of it, by key, as the cameras kept beside the documents
       until this branch were kept until a restore pruned them */
    const { installBuilder } = await import('../demo.js')
    const R = standIn({ mode: 'orbit', distance: 5, azimuth: 30 })
    const log = console.log; console.log = () => { }
    try {
        const kept = M.setView(M.createDoc({ title: 'kept' }), { camera: { mode: 'orbit', distance: 42, azimuth: -10 }, exposure: { exposureEV: 7 } })
        const B = installBuilder({}, { RT: R.RT, project: P.createProject([M.createDoc({ title: 'A' }), kept]) })
        const [a, k] = B.project.scenes.map(s => s.key)
        // a scene never shown, deleted from its card: a change to the list of scenes, which stays on A
        P.removeScene(B.project, k); B.commit(null, { scenes: 'delete', was: a })
        ok('deleted', !P.scene(B.project, k))
        B.undo()
        eq('undone: it is back, with its camera and its exposure', [B.cameraOf(k)?.distance, P.scene(B.project, k)?.doc.view?.exposure?.exposureEV], [42, 7])
        eq('...and A still the one worked on (undo stays put)', B.current, a)
        B.use(k); B.markShown()
        eq('shown, it is seen from its own camera', R.cam.distance, 42)
        // shown and moved, then deleted and brought back: the camera it was left with
        R.move({ distance: 43 })
        B.use(a); B.markShown()
        P.removeScene(B.project, k); B.commit(null, { scenes: 'delete', was: a })
        B.undo()
        eq('one moved before it was deleted comes back as it was left', B.cameraOf(k)?.distance, 43)
    } finally { console.log = log }
}
{
    /* A SCENE WITH NO CAMERA OF ITS OWN (a scene file written before 0.66.0): seen from the camera there is, SAID IN ITS
       UNIT -- 330 mm from a mm scene is 0.33 m in a metre scene, not 330 m */
    const { installBuilder } = await import('../demo.js')
    const R = standIn({ mode: 'orbit', target: [0, -20, 25], distance: 330, dimensions: 330, azimuth: 30 })
    const log = console.log; console.log = () => { }
    try {
        const mm = Object.assign(M.createDoc({ title: 'mm' }), { unit: 'mm' })
        const B = installBuilder({}, { RT: R.RT, project: P.createProject([mm, M.createDoc({ title: 'm' })]) })
        const [, m] = B.project.scenes.map(s => s.key)
        B.use(m); B.markShown()
        eq('a metre scene with no camera, after a millimetre one: the same place, in metres', [R.cam.distance, R.cam.dimensions, R.cam.target], [0.33, 0.33, [0, -0.02, 0.025]])
        eq('...and that is its camera now', B.cameraOf(m)?.distance, 0.33)
    } finally { console.log = log }
}
{
    /* A NEW SCENE IS SEEN FROM CLOSE BY (the user, 2026-10-02): its document comes with the close view (project.js
       blankScene, 0.66.0) -- an empty scene loaded keeps the view, as above */
    const { installBuilder } = await import('../demo.js')
    const R = standIn({ mode: 'orbit', distance: 150, azimuth: 30 })
    const log = console.log; console.log = () => { }
    try {
        const B = installBuilder({}, { RT: R.RT, project: P.createProject([M.createDoc({ title: 'A' })]) })
        const a = B.project.scenes[0].key
        const n = P.newScene(B.project).key
        B.use(n); B.markShown()
        eq('a new scene starts at the new scene\'s camera', [R.cam.distance, R.cam.azimuth, R.cam.elevation, R.cam.target],
            [P.NEW_SCENE_CAMERA.distance, 40, 70, [0, 0, 0]])
        R.move({ distance: 9 })
        B.use(a); B.markShown()
        eq('A keeps its own', R.cam.distance, 150)
        B.use(n); B.markShown()
        eq('back to the new one: the camera it was left with, not the start again', R.cam.distance, 9)
    } finally { console.log = log }
}
{
    /* THE SCENE'S RADIUS, LIVE (model.js envRadius): no uniform but a value of the scene object the renderer
       holds, written by RT.updateScene -- pushed by BUILDER.live(root, 'envRadius'), after an undo (sync), and,
       set during a compile, into the scene that compiled. Over a stand-in renderer whose updateScene writes into
       the scene it has, as index.js does. */
    const { installBuilder } = await import('../demo.js')
    let state = {}, hold = false, release = null
    const RT = {
        scene: null,
        set(values) { const unknown = []; for (const [k, v] of Object.entries(values)) { if (k in state) state[k] = structuredClone(v); else unknown.push(k) } return unknown },
        get: () => structuredClone(state),
        settings: () => ({}), applySettings: () => [],
        updateScene(p) { for (const [k, v] of Object.entries(p)) RT.scene[k] = v; return [] },
        async setScene(s) {
            if (hold) await new Promise(r => { release = r })
            RT.scene = s
            state = Object.fromEntries(Object.entries(s.uniforms).map(([k, u]) => [k, structuredClone(u.def)]))
            return 1
        },
    }
    const gpu = { makeCompute: (b, m) => ({ wgsl: `${b}
${m}`, module: { getCompilationInfo: async () => ({ messages: [] }) }, ready: Promise.resolve() }), makeShader: () => ({ getCompilationInfo: async () => ({ messages: [] }) }) }
    const got = {}
    const log = console.log; console.log = () => { }
    try {
        const d0 = P.blankScene('R')
        M.addObject(d0, 'root', { id: 'ball', primitive: 'sphere' })
        const B = installBuilder({}, { RT, gpu, project: P.createProject([d0]) })
        await B.apply()
        got.compiled = RT.scene.envRadius
        const root = B.doc.root.id
        const scene = RT.scene
        M.setEnvRadius(B.doc, 40)
        got.took = B.live(root, 'envRadius')
        got.live = RT.scene.envRadius
        got.same = RT.scene === scene
        B.commit('root.envRadius')
        got.sync = B.undo()
        got.undone = RT.scene.envRadius
        // set during a compile: written into the old scene, then replayed into the one that compiled
        M.setEnvRadius(B.doc, 12)
        hold = true
        const compiling = B.apply()
        while (!release) await new Promise(r => setTimeout(r, 0))
        M.setEnvRadius(B.doc, 7)
        B.live(root, 'envRadius')
        hold = false; release()
        await compiling
        got.replayed = RT.scene.envRadius
        /* ...AND ITS SURFACE TOLERANCE (0.66.0, model.js setTolerance): the same road, and an undo is the same shader */
        got.tolCompiled = RT.scene.tolerance
        M.setTolerance(B.doc, 0.002)
        got.tolTook = B.live(root, 'tolerance')
        got.tolLive = RT.scene.tolerance
        B.commit('root.tolerance')
        got.tolSync = B.undo()
        got.tolUndone = RT.scene.tolerance
    } finally { console.log = log }
    eq('a scene that sets no tolerance compiles with none: the automatic one', got.tolCompiled, null)
    eq('a tolerance set live reaches the scene the renderer holds, without a compile', [got.tolTook, got.tolLive], [true, 0.002])
    eq('...and an undone one goes back live: the automatic one again', [got.tolSync, got.tolUndone], ['live', null])
    eq('the compiled scene carries the new scene\'s radius', got.compiled, 25)
    eq('a radius set live reaches the scene the renderer holds, without a compile', [got.took, got.live, got.same], [true, 40, true])
    eq('an undone radius is the same shader, and goes back live', [got.sync, got.undone], ['live', 25])
    eq('a radius set during a compile ends up in the scene that compiled', got.replayed, 7)
}
{
    /* A LIVE VALUE SET WHILE A COMPILE RUNS IS NOT LOST (the user, 2026-10-01: an own blend ticked on "does not
       get applied until I set it to some value and then back to 0"). A compile's uniforms are the document's
       when it began, and the renderer swaps them in only when it ends (lib/pathtracer/index.js setScene,
       carryUniforms false) -- so a slider dragged meanwhile was lost: refused, for a uniform the old scene does
       not declare, or written to the old state the swap throws away. Over a stand-in renderer that does both,
       as index.js does, and a stand-in device that compiles clean. */
    const { installBuilder } = await import('../demo.js')
    let state = {}, hold = false, release = null
    const RT = {
        scene: null,
        set(values) { const unknown = []; for (const [k, v] of Object.entries(values)) { if (k in state) state[k] = structuredClone(v); else unknown.push(k) } return unknown },
        get: () => structuredClone(state),
        settings: () => ({}), applySettings: () => [],
        async setScene(s) {
            if (hold) await new Promise(r => { release = r })
            RT.scene = s
            state = Object.fromEntries(Object.entries(s.uniforms).map(([k, u]) => [k, structuredClone(u.def)]))
            return 1
        },
    }
    const gpu = { makeCompute: (b, m) => ({ wgsl: `${b}
${m}`, module: { getCompilationInfo: async () => ({ messages: [] }) }, ready: Promise.resolve() }), makeShader: () => ({ getCompilationInfo: async () => ({ messages: [] }) }) }
    const got = {}
    const log = console.log; console.log = () => { }
    try {
        const one = M.createDoc({ title: 'joins' }), two = M.createDoc({ title: 'other' })
        for (const d of [one, two]) {
            M.addGroup(d, 'root', { id: 'g' })
            M.addObject(d, 'g', { id: 'box', primitive: 'box' })
            M.addObject(d, 'g', { id: 'ball', primitive: 'sphere', join: 'subtract' })
        }
        const B = installBuilder({}, { RT, gpu, project: P.createProject([one, two]) })
        const [a, b] = B.project.scenes.map(s => s.key)
        await B.apply()
        const d = B.doc, node = id => M.find(d, id).node
        // the own blend ticked on: structural, a compile -- held while the slider moves and the box is dragged
        M.setJoinBlend(d, 'ball', 0)
        hold = true
        const compiling = B.apply()
        while (!release) await new Promise(r => setTimeout(r, 0))
        node('ball').joinBlend = 0.3
        const took = B.live('ball', 'jblend')
        node('box').transform.pos.x = 2
        B.live('box', 'transform')
        hold = false; release()
        await compiling
        got.took = took; got.jblend = state.jblend_ball; got.box = state.xf_box?.[12]
        /* SWITCHED TO ANOTHER SCENE DURING THE COMPILE, and left there: its box (the same id -- ids repeat
           between documents) moved live. What compiled is the first scene's; the other's value must not be
           pushed into it -- the tree's apply loop compiles the scene now current next, from its own document */
        M.setJoinBlend(d, 'ball', null)
        hold = true; release = null
        const again = B.apply()
        while (!release) await new Promise(r => setTimeout(r, 0))
        B.use(b); M.find(B.doc, 'box').node.transform.pos.x = 7; B.live('box', 'transform')
        hold = false; release()
        await again
        got.boxAfterSwitch = state.xf_box?.[12]
    } finally { console.log = log }
    eq('(the old scene refused the own blend: it had no such uniform)', got.took, false)
    eq('after the compile the renderer holds what the slider says, not what it said when the compile began', got.jblend, 0.3)
    eq('...and a value both scenes declare, moved meanwhile, is not thrown away with the old state', got.box, 2)
    eq('a scene switched to during a compile: its value is not pushed into the scene that compiled', got.boxAfterSwitch, 2)
}

{
    /* A LIVE PATH (2026-10-01), over the real builder and the stand-in renderer above: a parameter its points name
       moves it with NO COMPILE -- the pieces written are what a fresh compile of the document declares; a change
       of its chain of pieces asks the host for a compile; a value that makes it unsound writes ok = 0; and one
       made while a compile runs is written into the new scene after it. */
    const { installBuilder } = await import('../demo.js')
    const { generate, pathOkName } = await import('../codegen.js')
    let state = {}, hold = false, release = null, compiles = 0
    const RT = {
        scene: null,
        set(values) { const unknown = []; for (const [k, v] of Object.entries(values)) { if (k in state) state[k] = structuredClone(v); else unknown.push(k) } return unknown },
        get: () => structuredClone(state),
        settings: () => ({}), applySettings: () => [],
        async setScene(s) {
            compiles++
            if (hold) await new Promise(r => { release = r })
            RT.scene = s
            state = Object.fromEntries(Object.entries(s.uniforms).map(([k, u]) => [k, structuredClone(u.def)]))
            return 1
        },
    }
    const gpu = { makeCompute: (b, m) => ({ wgsl: `${b}
${m}`, module: { getCompilationInfo: async () => ({ messages: [] }) }, ready: Promise.resolve() }), makeShader: () => ({ getCompilationInfo: async () => ({ messages: [] }) }) }
    const got = {}
    const log = console.log, warn = console.warn; console.log = () => { }
    const pieces = st => Object.fromEntries(Object.entries(st).filter(([k]) => k.startsWith('_p')))
    const freshPieces = d => Object.fromEntries(Object.entries(generate(...M.generateArgs(d, { id: 'built' })).uniforms).filter(([k]) => k.startsWith('_p')).map(([k, u]) => [k, u.def]))
    try {
        const doc = M.createDoc({ title: 'live path' })
        M.addObject(doc, 'root', { id: 'tb', params: { rise: 0.6, r: 0.2, route: { path: [[0, 0, 0], [1, 0, 0, 'r'], [1, 1, 0, 'r'], [1, 1, 'rise']], live: true } },
            code: 'C = add_new(C, tube(route, p, 0.1, 0.0), MATERIAL);' })
        const B = installBuilder({}, { RT, gpu, project: P.createProject([doc]) })
        let asked = 0
        B.onRestructure = () => asked++
        await B.apply()
        const node = () => M.find(B.doc, 'tb').node
        const before = compiles
        node().params.rise = 0.9; node().params.r = 0.3
        got.took = B.live('tb', 'rise')
        got.same = JSON.stringify(pieces(state)) === JSON.stringify(freshPieces(B.doc))
        got.noCompile = compiles === before && asked === 0
        M.setPath(B.doc, 'tb', 'route', [[0, 0, 0], [1, 0, 0, 'r'], [1, 1, 0], [1, 1, 'rise']])   // typed: the same chain
        B.live('tb', 'route')
        got.typed = JSON.stringify(pieces(state)) === JSON.stringify(freshPieces(B.doc)) && asked === 0
        // a parameter added and named in the path with no compile since: its slider moves the path (2026-10-02)
        M.addParam(B.doc, 'tb', 'rad', 0.1)
        M.setPath(B.doc, 'tb', 'route', [[0, 0, 0], [1, 0, 0, 'rad'], [1, 1, 0], [1, 1, 'rise']])
        B.live('tb', 'route')
        const compilesNow = compiles
        node().params.rad = 0.35
        B.live('tb', 'rad')
        got.named = JSON.stringify(pieces(state)) === JSON.stringify(freshPieces(B.doc)) && compiles === compilesNow && asked === 0
        node().params.rise = 0                                                              // point 4 on point 3
        B.live('tb', 'rise')
        got.unsound = state[pathOkName('tb', 'route')]
        node().params.rise = 0.9
        B.live('tb', 'rise')
        got.back = state[pathOkName('tb', 'route')]
        M.setPath(B.doc, 'tb', 'route', [[0, 0, 0], [0.5, 0, 0], [1, 0, 0, 'r'], [1, 1, 0], [1, 1, 'rise']])   // a point more
        got.tookShape = B.live('tb', 'route')
        got.asked = asked
        // DURING A COMPILE
        await B.apply()
        hold = true; release = null
        const compiling = B.apply()
        while (!release) await new Promise(r => setTimeout(r, 0))
        node().params.rise = 1.4
        B.live('tb', 'rise')
        hold = false; release()
        await compiling
        got.replayed = JSON.stringify(pieces(state)) === JSON.stringify(freshPieces(B.doc))
        // NO HOOK: said, not silent
        B.onRestructure = null
        let warned = ''; console.warn = m => { warned += m }
        M.setPath(B.doc, 'tb', 'route', [[0, 0, 0], [0.3, 0, 0], [0.6, 0, 0], [1, 0, 0, 'r'], [1, 0.5, 0], [1, 1, 0], [1, 1, 'rise']])   // more than its room
        B.live('tb', 'route')
        got.warned = /needs a compile/.test(warned)
    } finally { console.log = log; console.warn = warn }
    ok('a named parameter moved: the renderer took it, and NO compile ran', got.took === true && got.noCompile)
    ok('...the pieces written are exactly what a fresh compile of the document declares', got.same)
    ok('...and so are a typed edit\'s, when it keeps the chain', got.typed)
    ok('...and a parameter named since the last compile moves it as well, with no compile', got.named)
    eq('a value that makes it unsound: ok 0, it draws nothing', got.unsound, 0)
    eq('...and back: ok 1', got.back, 1)
    ok('a point added: the chain changed, the host asked for a compile (and the value not taken live)', got.asked === 1 && got.tookShape === false, JSON.stringify(got))
    ok('a value moved while a compile ran is written into the new scene after it', got.replayed)
    ok('with no host hook, a needed compile is said, not silent', got.warned)
}

{
    /* A LIVE PROFILE (2026-10-02), over the real builder and a stand-in renderer as above: a parameter its outline names
       changes it with no compile, the pieces and the reach those a fresh compile declares; a fillet appearing (an arc
       more) is written too, into its slot (2026-10-02); a point more than it has room for asks the host for a compile */
    const { installBuilder } = await import('../demo.js')
    const { generate, profileOkName } = await import('../codegen.js')
    let state = {}, compiles = 0
    const RT = {
        scene: null,
        set(values) { const unknown = []; for (const [k, v] of Object.entries(values)) { if (k in state) state[k] = structuredClone(v); else unknown.push(k) } return unknown },
        get: () => structuredClone(state), settings: () => ({}), applySettings: () => [],
        async setScene(s) { compiles++; RT.scene = s; state = Object.fromEntries(Object.entries(s.uniforms).map(([k, u]) => [k, structuredClone(u.def)])); return 1 },
    }
    const gpu = { makeCompute: (b, m) => ({ wgsl: `${b}
${m}`, module: { getCompilationInfo: async () => ({ messages: [] }) }, ready: Promise.resolve() }), makeShader: () => ({ getCompilationInfo: async () => ({ messages: [] }) }) }
    const got = {}
    const log = console.log; console.log = () => { }
    const qs = st => Object.fromEntries(Object.entries(st).filter(([k]) => k.startsWith('_q')))
    const fresh = d => Object.fromEntries(Object.entries(generate(...M.generateArgs(d, { id: 'built' })).uniforms).filter(([k]) => k.startsWith('_q')).map(([k, u]) => [k, u.def]))
    try {
        const doc = M.createDoc({ title: 'live profile' })
        M.addObject(doc, 'root', { id: 'pl', params: { w: 1, r: 0, outline: [[0, 0], ['w', 0, 'r'], ['w', 0.5], [0, 0.5]] },
            code: 'C = add_new(C, extrude(outline, p, 0.2), MATERIAL);' })
        M.setProfileLive(doc, 'pl', 'outline', true)
        const B = installBuilder({}, { RT, gpu, project: P.createProject([doc]) })
        let asked = 0
        B.onRestructure = () => asked++
        await B.apply()
        const node = () => M.find(B.doc, 'pl').node
        const before = compiles
        node().params.w = 1.7
        got.took = B.live('pl', 'w')
        got.same = JSON.stringify(qs(state)) === JSON.stringify(fresh(B.doc)) && compiles === before && asked === 0
        node().params.w = 0                                          // no area
        B.live('pl', 'w')
        got.unsound = state[profileOkName('pl', 'outline')]
        node().params.w = 1.2
        B.live('pl', 'w')
        got.back = state[profileOkName('pl', 'outline')]
        node().params.r = 0.1                                        // a fillet appears: an arc more, in its slot
        got.tookArc = B.live('pl', 'r')
        got.arc = JSON.stringify(qs(state)) === JSON.stringify(fresh(B.doc)) && asked === 0
        M.setProfile(B.doc, 'pl', 'outline', [[0, 0], ['w', 0, 'r'], ['w', 0.5], [0.5, 0.7], [0, 0.5]])   // a point more than its room
        got.tookPoint = B.live('pl', 'outline')
        got.asked = asked
    } finally { console.log = log }
    ok('a parameter the live outline names: taken, the pieces and reach a fresh compile declares, NO compile', got.took === true && got.same)
    eq('a value that makes it unsound: ok 0, it draws nothing', got.unsound, 0)
    eq('...and back: ok 1', got.back, 1)
    ok('a fillet appearing: written into its slot, NO compile', got.tookArc === true && got.arc, JSON.stringify(got))
    ok('a point more than it has room for: the host asked for a compile', got.asked === 1 && got.tookPoint === false, JSON.stringify(got))
}

{
    /* A PATH EDITED IN THE PICTURE (2026-10-02, the overlay's Points mode), over the real builder and a stand-in renderer
       as above: compiled LIVE while it is edited although the document says compiled -- one compile in -- so a point
       dragged and a name moved write uniforms and compile nothing; an undo meanwhile is values only; and compiled as
       the document says once the editing stops -- one compile out. With room for points more (codegen EDIT_SPARE), a
       point put in and dragged off its line compiles nothing either; a path the document has live is given that room,
       one compile, and compiled back to its own. */
    const { installBuilder } = await import('../demo.js')
    const { generate } = await import('../codegen.js')
    let state = {}, compiles = 0
    const RT = {
        scene: null,
        set(values) { const unknown = []; for (const [k, v] of Object.entries(values)) { if (k in state) state[k] = structuredClone(v); else unknown.push(k) } return unknown },
        get: () => structuredClone(state),
        settings: () => ({}), applySettings: () => [],
        async setScene(s) {
            compiles++
            RT.scene = s
            state = Object.fromEntries(Object.entries(s.uniforms).map(([k, u]) => [k, structuredClone(u.def)]))
            return 1
        },
    }
    const gpu = { makeCompute: (b, m) => ({ wgsl: `${b}
${m}`, module: { getCompilationInfo: async () => ({ messages: [] }) }, ready: Promise.resolve() }), makeShader: () => ({ getCompilationInfo: async () => ({ messages: [] }) }) }
    const got = {}
    const log = console.log; console.log = () => { }
    const pieces = st => Object.fromEntries(Object.entries(st).filter(([k]) => k.startsWith('_p')))
    const fresh = (d, editing) => Object.fromEntries(Object.entries(generate(...M.generateArgs(d, { id: 'built', editing })).uniforms)
        .filter(([k]) => k.startsWith('_p')).map(([k, u]) => [k, u.def]))
    try {
        const doc = M.createDoc({ title: 'edited' })
        M.addObject(doc, 'root', { id: 'tb', params: { rise: 0.6, route: { path: [[0, 0, 0], [1, 0, 0, 0.2], [1, 1, 0, 0.2], [1, 1, 'rise']] } },
            code: 'C = add_new(C, tube(route, p, 0.1, 0.0), MATERIAL);' })
        const B = installBuilder({}, { RT, gpu, project: P.createProject([doc]) })
        const asked = []
        B.onRestructure = () => { asked.push(B.apply()) }
        await B.apply()
        got.compiledFirst = RT.scene.pointParams[0].live === false
        const c0 = compiles
        got.on = B.editPoints('tb', 'route')
        await Promise.all(asked)
        got.onCompiles = compiles - c0
        got.forced = RT.scene.pointParams[0].live === true && RT.scene.pointParams[0].forced === true
        got.editing = B.editingPoints
        got.again = B.editPoints('tb', 'route')
        const c1 = compiles
        M.setPath(B.doc, 'tb', 'route', [[0, 0, 0], [1.3, 0, 0, 0.2], [1, 1, 0, 0.2], [1, 1, 'rise']])
        got.took = B.live('tb', 'route')
        B.commit('tb.route')
        got.dragged = JSON.stringify(pieces(state)) === JSON.stringify(fresh(B.doc, ['tb.route']))
        M.find(B.doc, 'tb').node.params.rise = 0.9
        B.live('tb', 'rise')
        B.commit('tb.rise')
        got.named = JSON.stringify(pieces(state)) === JSON.stringify(fresh(B.doc, ['tb.route']))
        /* A POINT PUT IN halfway along an edge (a straight corner), then dragged off its line (a bend): no compile. A
           fresh compile of the document now gives it more room (its points and 8), so the slots compared are the ones
           the scene shown has -- and the fresh compile's beyond them are off */
        const asFresh = () => {
            const f = fresh(B.doc, ['tb.route']), mine = pieces(state)
            return Object.entries(mine).every(([k, v]) => JSON.stringify(v) === JSON.stringify(f[k]))
                && Object.entries(f).filter(([k]) => !(k in mine)).every(([k, v]) => !/^_pp\d+_/.test(k) || v[7] === 0)
        }
        M.setPath(B.doc, 'tb', 'route', [[0, 0, 0], [0.6, 0, 0], [1.3, 0, 0, 0.2], [1, 1, 0, 0.2], [1, 1, 'rise']])
        got.putIn = B.live('tb', 'route') && asFresh()
        M.setPath(B.doc, 'tb', 'route', [[0, 0, 0], [0.6, 0.3, 0], [1.3, 0, 0, 0.2], [1, 1, 0, 0.2], [1, 1, 'rise']])
        got.offLine = B.live('tb', 'route') && asFresh()
        // A SCALE AND TWIST typed into a point there (2026-10-02): values only -- a path edited in the picture is compiled
        // in its varying form from the start (codegen.js), so the first one compiles nothing
        M.setPath(B.doc, 'tb', 'route', [[0, 0, 0], [0.6, 0.3, 0, 0, 1.5, 0.5, 30], [1.3, 0, 0, 0.2], [1, 1, 0, 0.2], [1, 1, 'rise']])
        got.scaled = B.live('tb', 'route') && asFresh() && Object.keys(pieces(state)).some(k => k.startsWith('_pv'))
        M.setPath(B.doc, 'tb', 'route', [[0, 0, 0], [1.3, 0, 0, 0.2], [1, 1, 0, 0.2], [1, 1, 'rise']])
        B.live('tb', 'route')
        B.commit('tb.route')
        got.noCompile = compiles === c1 && asked.length === 1
        got.undo = B.undo()
        got.undone = M.find(B.doc, 'tb').node.params.rise === 0.6 && JSON.stringify(pieces(state)) === JSON.stringify(fresh(B.doc, ['tb.route']))
        const c2 = compiles
        got.off = B.editPoints(null, null)
        await Promise.all(asked)
        got.offCompiles = compiles - c2
        got.back = RT.scene.pointParams[0].live === false && !Object.keys(RT.scene.uniforms).some(k => k.startsWith('_p')) && B.editingPoints === null
        M.setPathLive(B.doc, 'tb', 'route', true)
        await B.apply()
        const n = asked.length, c3 = compiles
        got.liveOn = [B.editPoints('tb', 'route'), asked.length - n]
        await Promise.all(asked)
        got.liveRoom = RT.scene.pointParams[0].room
        got.liveOff = B.editPoints(null, null)
        await Promise.all(asked)
        got.liveCompiles = compiles - c3
        got.liveRoomAfter = RT.scene.pointParams[0].room
    } finally { console.log = log }
    ok('a compiled path, edited in the picture: one compile in, and it is live (forced) in the renderer', got.compiledFirst && got.on === true && got.onCompiles === 1 && got.forced, JSON.stringify(got))
    eq('...the builder says what is being edited, and saying it again asks for nothing', [got.editing, got.again], ['tb.route', false])
    ok('a point dragged and a name moved: taken, the pieces those of a fresh compile, and NO compile', got.took === true && got.dragged && got.named && got.noCompile, JSON.stringify(got))
    ok('a point put in, and dragged off its line: taken, the pieces those of a fresh compile, NO compile (2026-10-02: room for more)', got.putIn && got.offLine && got.noCompile, JSON.stringify(got))
    ok('...a scale and twist typed into a point there: taken, the values those of a fresh compile, NO compile', got.scaled && got.noCompile, JSON.stringify(got))
    ok('an undo while it is edited: values only, the pieces written', got.undo === 'live' && got.undone, JSON.stringify(got))
    ok('editing stopped: one compile out, compiled as the document says again', got.off === true && got.offCompiles === 1 && got.back, JSON.stringify(got))
    eq('a path the document has live: editing it asks for one compile, for its room, and one back', [got.liveOn, got.liveRoom, got.liveOff, got.liveCompiles, got.liveRoomAfter],
        [[true, 1], 12, true, 2, 4])
}

{
    /* A SCENE THE RENDERER REFUSES, after the probe passed it (the user, 2026-10-02: a material that would not compile,
       and the program stuck): apply() says it does not compile, as a probe's refusal would, and the scene shown is
       still the one that was -- the renderer put it back (lib/pathtracer/index.js setScene, `restored`). And a page
       that starts the renderer on no scene of the project says so (unshow), so nothing is pushed live to it. */
    const { installBuilder } = await import('../demo.js')
    let refuse = false, compiles = 0
    const RT = { scene: null, set: () => [], settings: () => ({ camera: null }), applySettings: () => [],
        async setScene(sc) {
            compiles++
            if (refuse) { const e = new Error('shade: a kernel does not compile'); e.restored = true; throw e }
            RT.scene = sc; return 1
        } }
    const gpu = { makeCompute: (b, m) => ({ wgsl: `${b}
${m}`, module: { getCompilationInfo: async () => ({ messages: [] }) }, ready: Promise.resolve() }), makeShader: () => ({ getCompilationInfo: async () => ({ messages: [] }) }) }
    const log = console.log, err = console.error; console.log = () => { }; console.error = () => { }
    try {
        const a = M.createDoc({ title: 'A' }), b = M.createDoc({ title: 'B' })
        M.addObject(b, 'root', { id: 'ball', primitive: 'sphere' })
        const B = installBuilder({}, { RT, gpu, project: P.createProject([a, b]) })
        const [ka, kb] = B.project.scenes.map(s => s.key)
        ok('a scene that compiles: shown', (await B.apply()).ok && B.showing)
        refuse = true
        B.use(kb)
        const r = await B.apply()
        ok('refused by the renderer: apply says it does not compile, with why', !r.ok && /a kernel did not compile: shade/.test(r.report ?? ''), r.report)
        ok('...and the scene shown is still the one before: B is not showing, nothing is pushed live to it', !B.showing && B.live('ball', 'radius') === false)
        refuse = false
        ok('compiled once it does: shown', (await B.apply()).ok && B.showing && B.current === kb)
        B.unshow()
        ok('unshow: no scene of the project showing, nothing live -- until the next apply', !B.showing && B.live('ball', 'radius') === false)
        ok('...which shows it again', (await B.apply()).ok && B.showing && compiles === 4)
        void ka
    } finally { console.log = log; console.error = err }
}

{
    /* THE LOOP HELD FOR THE WHOLE APPLY (demo.js applyNow, lib/pathtracer/index.js RT.hold): from the probe through
       setScene and the replay of what was set live meanwhile, and let go however the apply ends -- a probe that says
       no, a kernel the renderer refuses, a throw out of the apply. Left held, the picture would never move again;
       let go early, the probe runs beside the loop's frames again (1.4-6.8 s against 0.2 s paused, measured on the
       user's card, 2026-10-03). The stand-in's hold is the real counter (lib/render-loop.js makeHolds), as index.js's. */
    const { installBuilder } = await import('../demo.js')
    const { makeHolds } = await import('../../lib/render-loop.js')
    const H = makeHolds()
    let mode = 'ok', gate = false, opened = null, throwOnScene = false
    const seen = []
    const RT = { scene: null, settings: () => ({ camera: null }), applySettings: () => [],
        hold: () => H.hold(),
        set() { seen.push(['set', H.held()]); return [] },
        async setScene(sc) {
            seen.push(['setScene', H.held()])
            if (gate) await new Promise(r => { opened = r })
            if (mode === 'refuse') { const e = new Error('shade: a kernel does not compile'); e.restored = true; throw e }
            RT.scene = sc; return 1
        } }
    const gpu = { makeCompute: (b, m) => {
        seen.push(['probe', H.held()])
        if (mode === 'no') throw new Error('the probe refused')
        return { wgsl: `${b}
${m}`, module: { getCompilationInfo: async () => ({ messages: [] }) }, ready: Promise.resolve() }
    }, makeShader: () => ({ getCompilationInfo: async () => ({ messages: [] }) }) }
    const until = async f => { while (!f()) await new Promise(r => setTimeout(r, 0)) }
    const log = console.log, err = console.error; console.log = () => { }; console.error = () => { }
    const got = {}
    try {
        const d = M.createDoc({ title: 'H' })
        M.addObject(d, 'root', { id: 'ball', primitive: 'sphere' })
        const B = installBuilder({}, { RT, gpu, project: P.createProject([d]),
            onScene: () => { if (throwOnScene) throw new Error('the host hook threw') } })
        got.ok = (await B.apply()).ok
        got.okSeen = seen.splice(0)
        got.okAfter = H.held()
        // a value set live during the compile: replayed into the new scene while still held
        gate = true; opened = null
        const compiling = B.apply()
        await until(() => opened)
        got.duringCompile = H.held()
        B.live('ball', 'radius')
        seen.splice(0)
        gate = false; opened()
        await compiling
        got.replaySeen = seen.splice(0).filter(([k]) => k === 'set').map(([, h]) => h)
        got.replayAfter = H.held()
        mode = 'no'
        got.no = (await B.apply()).ok
        got.noSeen = seen.splice(0)
        got.noAfter = H.held()
        mode = 'refuse'
        got.refused = (await B.apply()).ok
        got.refusedAfter = H.held()
        mode = 'ok'; throwOnScene = true
        try { await B.apply(); got.threw = false } catch { got.threw = true }
        throwOnScene = false
        got.threwAfter = H.held()
        // two applies overlapping: held until the second is over, not the first
        gate = true; opened = null
        const first = B.apply()
        await until(() => opened)
        const openFirst = opened; opened = null
        const second = B.apply()
        await until(() => opened)
        const openSecond = opened
        gate = false
        openFirst(); await first
        got.nestedAfterFirst = H.held()
        openSecond(); await second
        got.nestedAfterBoth = H.held()
    } finally { console.log = log; console.error = err }
    eq('an apply: the probe and setScene both run held, and it is let go after', [got.ok, got.okSeen, got.okAfter],
        [true, [['probe', true], ['setScene', true]], false])
    eq('...still held while the compile runs; a value set live meanwhile replayed held, then let go',
        [got.duringCompile, got.replaySeen.length > 0 && got.replaySeen.every(h => h), got.replayAfter], [true, true, false])
    eq('a probe that says no: held for it, no setScene, let go', [got.no, got.noSeen, got.noAfter], [false, [['probe', true]], false])
    eq('a kernel the renderer refuses: let go', [got.refused, got.refusedAfter], [false, false])
    eq('a throw out of the apply: let go', [got.threw, got.threwAfter], [true, false])
    eq('two applies overlapping: held until the last ends', [got.nestedAfterFirst, got.nestedAfterBoth], [true, false])
}
console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
