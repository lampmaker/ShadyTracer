//======================================================================================================================
// SAVED VIEWS (0.84.0; builder/model.js VIEW, demo.js saveView ...): a scene's named cameras, kept in its document's
// view -- outside the history, as its camera is -- and the builder's verbs over a stand-in renderer that, as the real
// one does (lib/pathtracer/index.js applyCamera), puts a camera back only in the fields it is given.
// Run: node builder/test/views.test.mjs
//======================================================================================================================
import * as M from '../model.js'
import * as P from '../project.js'
import { changeUnit, outsideAcross } from '../unitchange.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
/* refused with the model's error, and the document as it was */
const refused = (name, doc, fn, match) => {
    const before = M.serialize(doc)
    try { fn() } catch (e) {
        ok(name, e instanceof M.ModelError && (!match || match.test(e.message)) && M.serialize(doc) === before, `threw: ${e.message}`)
        return
    }
    ok(name, false, 'did not throw')
}

const FRONT = { mode: 'orbit', camtype: 0, fov: 30, dimensions: 10, target: [1, 2, 0], azimuth: 90, elevation: 80, distance: 12,
                up: [0, 0, 1], aperture: 0.5, focus: 0, pos: [1, 14, 2] }

// ---- THE MODEL ----
{
    const d = M.createDoc({ title: 'V' })
    const plain = M.serialize(d)
    eq('a scene with none has none, and its first is View 1', [M.savedViewsOf(d), M.nextViewName(d)], [[], 'View 1'])
    M.saveView(d, 'Front', { ...FRONT, aspect: 1.7, near: 0.01, far: 4000 })
    eq('saved: the camera\'s settings, not the canvas\'s (aspect, planes)', M.savedViewsOf(d), [{ name: 'Front', camera: M.cameraSettings(FRONT) }])
    ok('...a copy: changing what was handed in changes nothing kept', (FRONT.target[0] = 1, M.savedViewsOf(d)[0].camera.target[0] === 1))
    eq('the next is View 1 still (Front is not one)', M.nextViewName(d), 'View 1')
    M.saveView(d, 'View 1', { ...FRONT, distance: 3 })
    eq('...then View 2', M.nextViewName(d), 'View 2')
    refused('a name taken is refused', d, () => M.saveView(d, 'Front', FRONT), /saved already/)
    refused('an empty name is refused', d, () => M.saveView(d, '  ', FRONT), /name/)
    refused('a name with a space at its end is refused', d, () => M.saveView(d, 'Side ', FRONT), /space/)
    refused('a name too long is refused', d, () => M.saveView(d, 'x'.repeat(M.VIEW_NAME_MAX + 1), FRONT), /at most/)
    refused('a camera the scene could not keep is refused', d, () => M.saveView(d, 'Bad', { ...FRONT, distance: 0 }), /distance/)

    M.setView(d, { camera: { ...FRONT, distance: 99 } })
    eq('the camera moved (keepView): the saved views stay', M.savedViewsOf(d).map(s => s.name), ['Front', 'View 1'])
    M.updateView(d, 'Front', { ...FRONT, azimuth: 10 })
    eq('updated: the new camera, in its place', M.savedViewsOf(d).map(s => [s.name, s.camera.azimuth]), [['Front', 10], ['View 1', 90]])
    refused('updating one there is not is refused', d, () => M.updateView(d, 'Back', FRONT), /no saved view 'Back'/)
    M.renameView(d, 'View 1', 'Close')
    eq('renamed, in its place', M.savedViewsOf(d).map(s => s.name), ['Front', 'Close'])
    refused('renamed to a name taken is refused', d, () => M.renameView(d, 'Close', 'Front'), /saved already/)
    ok('renamed to its own name is nothing', M.serialize(M.renameView(d, 'Close', 'Close')) === M.serialize(d))

    const back = P.parse(M.serialize(d)).doc
    eq('saved and opened again: the same views', M.savedViewsOf(back), M.savedViewsOf(d))
    const bad = JSON.parse(M.serialize(d))
    bad.view.saved.push({ name: 'Front', camera: { fov: 400 } })
    let e = null
    try { P.parse(JSON.stringify(bad)) } catch (x) { e = x }
    ok('a file whose views are unsound is refused, each problem said', e?.problems?.some(p => /taken by another view/.test(p))
        && e?.problems?.some(p => /fov/.test(p)), e?.message)

    M.removeView(d, 'Front')
    refused('taking away one there is not is refused', d, () => M.removeView(d, 'Front'), /no saved view/)
    M.removeView(d, 'Close')
    M.setView(d, { camera: null })
    ok('every view taken away: the scene byte for byte as it was', M.serialize(d) === plain, M.serialize(d).slice(0, 300))

    for (let i = 0; i < M.SAVED_VIEWS_MAX; i++) M.saveView(d, M.nextViewName(d), FRONT)
    refused(`at most ${M.SAVED_VIEWS_MAX}`, d, () => M.saveView(d, 'One more', FRONT), /at most/)
}

// ---- A UNIT CHANGE converts them as the camera (unitchange.js convertOutside), and back across its undo ----
{
    const d = M.createDoc({ title: 'U' })                    // metres
    M.setView(d, { camera: FRONT })
    M.saveView(d, 'Front', FRONT)
    const r = changeUnit(d, 'mm', 'scale')
    const c = M.savedViewsOf(d)[0].camera
    eq('to mm: the saved camera\'s lengths a thousand times, its angles and field as they were',
        [c.distance, c.target, c.pos, c.aperture, c.dimensions, c.azimuth, c.fov], [12000, [1000, 2000, 0], [1000, 14000, 2000], 500, 10000, 90, 30])
    ok('...as the scene\'s own camera', d.view.camera.distance === 12000 && r.factor === 1000)
    outsideAcross(d, { from: 'm', to: 'mm', how: 'scale' }, { undo: true })
    eq('...and back across its undo', M.savedViewsOf(d)[0].camera.distance, 12)
    changeUnit(d, 'cm', 'keep')
    eq('a change that keeps the numbers keeps the views\' too', M.savedViewsOf(d)[0].camera.distance, 12)
}

// ---- THROUGH THE REAL BUILDER (demo.js) over a stand-in renderer ----
{
    const { installBuilder } = await import('../demo.js')
    const R = { cam: { mode: 'orbit', camtype: 0, fov: 40, dimensions: 10, target: [0, 0, 0], azimuth: 40, elevation: 70, distance: 5,
                       up: [0, 0, 1], aperture: 0, focus: 0, pos: [1, 1, 1] }, exposure: { exposureEV: 15 } }
    const watchers = new Set(), tell = () => watchers.forEach(f => f())
    const RT = { view: () => ({ camera: structuredClone(R.cam), exposure: structuredClone(R.exposure) }),
        applyView: ({ camera, exposure } = {}) => { if (camera) Object.assign(R.cam, structuredClone(camera)); if (exposure) Object.assign(R.exposure, exposure); tell() },
        watchView: f => (watchers.add(f), () => watchers.delete(f)), settings: () => ({ values: {} }), applySettings: () => [] }
    const move = patch => { Object.assign(R.cam, patch); tell() }
    const log = console.log; console.log = () => { }
    try {
        const B = installBuilder({}, { RT, project: P.createProject([P.blankScene('A'), P.blankScene('B')]) })
        const [a, b] = B.project.scenes.map(s => s.key)
        const told = []
        B.onSavedViews = l => told.push(l.map(v => v.name))
        eq('none to begin with', B.savedViews(), [])
        ok('a scene of the project is the one shown: the list offers its verbs', B.viewsShown === true)
        const rev = B.revision, save = B.saveRevision
        move({ azimuth: 120, distance: 7, fov: 25, aperture: 0.3 })
        const kept = structuredClone(R.cam)
        eq('Save view: the next View N, told', [B.saveView(), told.at(-1)], ['View 1', ['View 1']])
        ok('...no undo step and no edit the bake waits out, but saved within the second (saveRevision)',
            !B.canUndo && B.revision === rev && B.saveRevision !== save, `${B.saveRevision} ${save}`)
        eq('...the camera as it is now', B.savedViews()[0].camera.distance, 7)
        move({ azimuth: 300, distance: 50, fov: 60, aperture: 0, target: [5, 5, 5] })
        ok('Go to: the camera back at once, every setting as it was saved', B.goToView('View 1')
            && JSON.stringify(R.cam) === JSON.stringify(kept), JSON.stringify([R.cam, kept]))
        eq('...and kept as the scene\'s camera (keepView)', B.doc.view.camera.azimuth, 120)
        ok('a view there is not: nothing', B.goToView('Nowhere') === false && R.cam.azimuth === 120)
        move({ distance: 9 })
        B.updateView('View 1')
        eq('↻: kept as the camera is now', B.savedViews()[0].camera.distance, 9)
        eq('a name given', B.saveView('Top'), 'Top')
        let threw = null
        try { B.saveView('Top') } catch (e) { threw = e }
        ok('...a name taken: refused, as the model refuses it', threw instanceof M.ModelError && B.savedViews().length === 2)
        B.renameView('Top', 'Overhead')
        eq('renamed', B.savedViews().map(v => v.name), ['View 1', 'Overhead'])

        B.use(b); B.markShown()
        eq('B shown: B\'s list, told', [B.savedViews(), told.at(-1)], [[], []])
        B.saveView('Only B')
        B.use(a); B.markShown()
        eq('back to A: A\'s', [B.savedViews().map(v => v.name), told.at(-1)], [['View 1', 'Overhead'], ['View 1', 'Overhead']])

        M.addObject(B.doc, 'root', { primitive: 'sphere' }); B.commit()
        B.removeView('Overhead')
        B.undo()
        eq('an undo of an edit takes away no view and brings none back: they are the view\'s, outside the history',
            B.savedViews().map(v => v.name), ['View 1'])
        const file = P.parse(P.serialize(B.project)).project
        eq('the project saved: each scene its own', file.scenes.map(s => M.savedViewsOf(s.doc).map(v => v.name)), [['View 1'], ['Only B']])

        // a unit change waiting to be shown: the renderer's numbers are the old unit's (cm -> mm, x10)
        B.setUnit('mm', 'scale')
        move({ distance: 2 })                  // 2 cm in the scene still shown
        B.saveView('During')
        eq('saved during the compile: in the new unit', B.savedViews().find(v => v.name === 'During').camera.distance, 20)
        move({ distance: 6 })
        B.goToView('During')
        eq('...gone to before the swap: in the old unit\'s numbers, the same place', R.cam.distance, 2)
        B.markShown()
        eq('...the scene in mm shown: 20 mm', R.cam.distance, 20)
    } finally { console.log = log }
}

console.log(`views (saved cameras): ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
