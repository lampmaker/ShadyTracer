// node library/test/edit.test.mjs
//
// EDITING A LIBRARY ITEM (library/edit.js), without a browser. The scene an item is edited in, for every
// built-in item: sound, its subject there, and what saving it would put in the library the same thing the
// library holds -- so nothing reads "unsaved" the moment it opens (insertAsset gives fresh ids, which a
// plain comparison took for a change). A material's sample saved without the material, and not at all
// while it is the default; the stage never saved. Then the editor on the REAL builder (demo.js, whose undo
// and redo are the ones that run), a stand-in renderer and a tree that does what tree.js's sceneEdit does:
// open is one scene after the current one and one undo step; an edit is unsaved and its undo is not; a save
// is kept by the library, and an undo past it is unsaved again; close and an undo past the open both give
// the camera and the lighting back; the last scene can be closed; an item open already is gone back to.
import * as M from '../../builder/model.js'
import * as P from '../../builder/project.js'
import { installBuilder } from '../../builder/demo.js'
import { createLibrary, memoryBackend } from '../store.js'
import { ITEM_FILES, itemUrl } from '../items/index.js'
import { readFileSync } from 'node:fs'
import { itemSceneDoc, extractItem, canonItem, canonScene, installItemEditor, studioEnvironment, canon, SAMPLE_CHOICES, SAMPLE_SIZES, sampleOf, setSample } from '../edit.js'
import { DEFAULT_PREVIEW, SAMPLE_SHAPES, sampleShape } from '../studio.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}

const load = f => JSON.parse(readFileSync(itemUrl(f), 'utf8'))
const L0 = createLibrary({ model: M, backend: memoryBackend(), files: ITEM_FILES, load })
const all = await L0.list()

// EVERY BUILT-IN ITEM: its scene is sound, and saving it unchanged would save what the library holds
for (const it of all) {
    let doc
    try { doc = itemSceneDoc(it) } catch (e) { ok(`an item's scene: ${it.name}`, false, e.message); continue }
    const bad = M.validate(doc)
    const li = doc.libraryItem
    const there = li.kind === 'material' ? !!M.material(doc, li.subject) : !!M.find(doc, li.subject)
    ok(`an item's scene is sound, its subject in it: ${it.name}`, !bad.length && there, JSON.stringify(bad).slice(0, 200))
    let same = false
    try { same = canonScene(doc) === canonItem(it) } catch (e) { ok(`...extracted: ${it.name}`, false, e.message) }
    ok(`...and opened, it is not "unsaved": ${it.name}`, same)
    // + in an item's scene makes an object of the item's material, never of the floor's grey (model.defaultMaterial)
    const dm = M.defaultMaterial(doc)
    ok(`...its default material is not the stage's: ${it.name}`, !dm || !li.stageMaterials.includes(dm.id)
        && (li.kind !== 'material' || M.typeOf(dm) !== 'surface' || dm.id === li.subject), dm?.label)
}

// A MATERIAL: on its sample, which is saved without the material and only when it is not the default
{
    const gold = all.find(i => i.name === 'gold')
    const doc = itemSceneDoc(gold)
    const li = doc.libraryItem
    const sample = M.find(doc, li.sample).node
    ok('a material is edited on its sample, wearing it, standing on the floor', sample.material === li.subject && doc.unit === 'mm'
        && M.find(doc, li.stage[0]).node.transform.pos.z < 0 && sample.transform.pos.z === sample.params.radius)
    ok('...lit by the studio: its sun and sky are the scene\'s', doc.environment.envMode === 0 && doc.environment.sunIlluminance === 100000)
    let got = extractItem(doc)
    ok('its sample saved as nothing while it is the default', got.preview === null && got.asset.kind === 'material')
    sample.params.radius = 12
    got = extractItem(doc)
    ok('...and as a node once it is not, without the material ("the item\'s goes here")',
        got.preview?.kind === 'node' && got.preview.node.material === null && got.preview.materials.length === 0 && got.preview.node.params.radius === 12)
    ok('the floor and its material are not in what is saved', !JSON.stringify(got).includes('floor') && !JSON.stringify(got).includes('studio grey'))
    doc.materials.find(m => m.id === li.subject).params.roughness = 0.77
    ok('a change to the material is in what is saved', extractItem(doc).asset.material.params.roughness === 0.77)
}
// THE SAMPLE SHAPES (the user, 2026-09-30): each, at each size, swapped in where the sample was, wearing the
// material, saved as the item's preview (the 50 mm sphere as none), and read back as that shape and size
{
    ok('the four shapes at 50 and 200 mm, the 50 mm sphere the default', JSON.stringify(SAMPLE_CHOICES) === '["sphere","cube","cylinder","F"]'
        && JSON.stringify(SAMPLE_SIZES) === '[50,200]' && DEFAULT_PREVIEW === SAMPLE_SHAPES.sphere && sampleShape('sphere', 50) === DEFAULT_PREVIEW)
    /* EACH STANDS ON z = 0, from its own sizes (the primitives' code: a sphere about its origin, a box and a
       cylinder centred, a box's size a HALF-size) -- estimateBox is a padded guess and cannot say */
    const bottom = n => n.kind === 'group' ? Math.min(...n.children.map(c => bottom(c) + n.transform.pos.z))
        : n.transform.pos.z - (n.params.radius !== undefined && n.params.height === undefined ? n.params.radius
            : n.params.height !== undefined ? n.params.height / 2 : n.params.size.z)
    const top = n => n.kind === 'group' ? Math.max(...n.children.map(c => top(c) + n.transform.pos.z))
        : n.transform.pos.z + (n.params.radius !== undefined && n.params.height === undefined ? n.params.radius
            : n.params.height !== undefined ? n.params.height / 2 : n.params.size.z)
    const all4 = SAMPLE_SIZES.flatMap(size => SAMPLE_CHOICES.map(shape => ({ shape, size, a: sampleShape(shape, size) })))
    ok('every sample shape at every size stands on z = 0, in mm, built at its size (no scale)',
        all4.every(({ a }) => a.unit === 'mm' && Math.abs(bottom(a.node)) < 1e-9 && a.node.transform.scale === 1),
        JSON.stringify(all4.map(({ shape, size, a }) => [shape, size, bottom(a.node)])))
    ok('...and is about its size tall', all4.every(({ size, a }) => top(a.node) >= 0.8 * size && top(a.node) <= size + 1e-9),
        JSON.stringify(all4.map(({ shape, size, a }) => [shape, size, top(a.node)])))
    const gold = all.find(i => i.name === 'gold')
    const doc = itemSceneDoc(gold), li = doc.libraryItem
    ok('a material item opens on the 50 mm sphere', JSON.stringify(sampleOf(doc)) === '{"shape":"sphere","size":50}')
    const where = () => { const f = M.find(doc, li.sample); return [f.parent.id, f.index] }
    const at = where()
    for (const { shape: k, size } of [...all4.slice(1), all4[0]]) {
        setSample(doc, k, size)
        const n = M.find(doc, li.sample).node, worn = []
        M.walk({ root: n }, x => { if (x.kind === 'object') worn.push(x.material) })
        const floorZ = M.find(doc, li.stage[0]).node.transform.pos.z
        ok(`${k} ${size} mm: in the sample's place, wearing the material, over the floor`,
            JSON.stringify(where()) === JSON.stringify(at) && worn.length && worn.every(m => m === li.subject)
            && floorZ < 0 && floorZ > -size * 0.05 && !M.validate(doc).length, JSON.stringify({ at: where(), worn, floorZ }))
        const { preview } = extractItem(doc)
        const dflt = k === 'sphere' && size === 50
        ok(`${k} ${size} mm: saved as the item's preview${dflt ? ' -- none, the default' : ''}, and read back as it`,
            (dflt ? preview === null : canon(preview) === canon(sampleShape(k, size))) && sampleOf(doc)?.shape === k && sampleOf(doc)?.size === size,
            JSON.stringify(preview)?.slice(0, 200))
    }
    ok('only one sample in the scene after all that', doc.root.children.length === 2, doc.root.children.map(c => c.label).join(', '))
    setSample(doc, 'cube', 200)
    const reopened = itemSceneDoc({ ...gold, preview: extractItem(doc).preview })
    ok('an item saved on the 200 mm cube opens on it', JSON.stringify(sampleOf(reopened)) === '{"shape":"cube","size":200}')
    M.find(doc, li.sample).node.params.rounding = 5
    ok('...and a sample changed by hand is its own', sampleOf(doc) === 'own')
    let threw = 0; try { setSample(doc, 'teapot') } catch { threw++ }; try { setSample(doc, 'cube', 120) } catch { threw++ }
    ok('an unknown shape, or size, is refused', threw === 2)
    const brushed = all.find(i => i.name === 'brushed aluminium')
    ok('a built-in item with a preview of its own says so', !brushed?.preview || sampleOf(itemSceneDoc(brushed)) !== null, brushed?.name)
}
// A NODE: the item itself; an empty modifier's F is the stage's, not saved; "no size of its own" stays so
{
    const twist = all.find(i => i.id === 'builtin:modifier:twist')
    const doc = itemSceneDoc({ ...twist, asset: { ...twist.asset, unit: null } })
    const n = M.find(doc, doc.libraryItem.subject).node
    ok('an empty modifier is edited with an F inside it', n.children.length === 1 && doc.libraryItem.stage.includes(n.children[0].id))
    const got = extractItem(doc)
    ok('...which is not saved', got.asset.node.children.length === 0)
    ok('an item with no size of its own (unit null) is saved with none', got.asset.unit === null && doc.unit === 'm')
    const lens = all.find(i => i.name.startsWith('PMMA lens'))
    ok('an item kept in centimetres is edited in centimetres', itemSceneDoc(lens).unit === lens.asset.unit && lens.asset.unit === 'cm')
}
ok('the studio\'s light keeps the settings it does not name', studioEnvironment({ sunDiameter: 2, envMode: 1, notOne: 5 }).sunDiameter === 2
    && studioEnvironment({ envMode: 1 }).envMode === 0 && !('notOne' in studioEnvironment({ notOne: 5 })))

//----------------------------------------------------------------------------------------------------------------------
// THE EDITOR ON THE REAL BUILDER
//----------------------------------------------------------------------------------------------------------------------
{
    const library = createLibrary({ model: M, backend: memoryBackend(), files: ITEM_FILES, load })
    const brushed = (await library.list()).find(i => i.name === 'brushed aluminium')
    const mine = await library.duplicate(brushed.id)
    // a scene of the user's, lit their way and looked at their way
    const home = M.createDoc({ title: 'my scene' })
    M.addObject(home, 'root', { primitive: 'box' })
    const other = M.createDoc({ title: 'lit' })
    M.setEnvironment(other, { envMode: 1 })
    const R = { values: { envMode: 1, sunIlluminance: 3, skyIlluminance: 4, autoExposure: 0 }, camera: { mode: 'orbit', distance: 99, fov: 60 } }
    const RT = {
        scene: { id: 'built' },
        get: () => structuredClone(R.values),
        set: v => { Object.assign(R.values, structuredClone(v)); return [] },
        settings: () => ({ camera: structuredClone(R.camera) }),
        applySettings: ({ camera }) => { if (camera) R.camera = structuredClone(camera); return [] },
    }
    let E = null
    // apply(), as the real one ends: the scene marked shown (its camera back), its environment pushed, the host's onScene
    const applied = () => { B.markShown(); if (B.doc.environment) RT.set(B.doc.environment); E.shown() }
    const B = installBuilder({}, { RT, gpu: null, project: P.createProject([home, other]) })
    // THE TREE'S SCENE VERBS, as tree.js's sceneEdit does them: change, current, one undo step, compiled
    const T = { selected: null }
    const tree = {
        openScene(doc) { const e = P.addScene(B.project, doc, P.indexOf(B.project, B.current) + 1); B.use(e.key); B.commit(); applied() },
        closeScene(key, goTo) {
            const p = B.project
            if (p.scenes.length === 1) P.newScene(p, 'New scene')
            const i = P.indexOf(p, key)
            const next = goTo && goTo !== key && P.scene(p, goTo) ? goTo : p.scenes[i > 0 ? i - 1 : i + 1].key
            P.removeScene(p, key); B.use(next); B.commit(); applied()
        },
        enterScene(key) { B.use(key); applied() },
        select(id) { T.selected = id },
    }
    E = installItemEditor({ BUILDER: B, RT, library, tree })
    const homeKey = B.current, scenesBefore = B.project.scenes.length
    E.shown()                                                   // the page's first scene, shown
    await E.open(mine)
    ok('open: one scene, right after the current one, and current', B.project.scenes.length === scenesBefore + 1
        && P.indexOf(B.project, B.current) === P.indexOf(B.project, homeKey) + 1 && B.doc.libraryItem?.id === mine.id)
    ok('...one undo step', B.canUndo)
    ok('...its material selected', T.selected === B.doc.libraryItem.subject)
    ok('...not unsaved', E.active && !E.dirty)
    ok('...the view framed on it with the studio\'s field of view, exposure metered, the studio\'s sun',
        // in the scene's millimetres: the studio's framing of its sample (a 20 mm sphere, its own) is 7.5 radii away
        R.camera.fov === 30 && Math.abs(R.camera.distance - 7.5 * mine.preview.node.params.radius) < 1 && R.values.autoExposure === 1 && R.values.envMode === 0, JSON.stringify([R.camera, R.values]))
    {
        // a sample made larger is framed again (the page's hook calls frame() when the size changes)
        const was = structuredClone(B.doc)
        setSample(B.doc, 'sphere', 200); E.frame()
        ok('frame(): the 200 mm sample seen whole, 7.5 of its radii away', Math.abs(R.camera.distance - 7.5 * 100) < 1, JSON.stringify(R.camera))
        P.scene(B.project, B.current).doc = was; E.frame()
    }

    const mat = () => B.doc.materials.find(m => m.id === B.doc.libraryItem.subject)
    mat().params.roughness = 0.9; B.commit()
    ok('an edit is unsaved', E.dirty)
    B.undo(); applied()
    ok('...its undo is not', E.active && !E.dirty)
    B.redo(); applied()
    ok('...its redo is again', E.dirty)
    const item = await E.save()
    const kept = (await library.list()).find(i => i.id === mine.id)
    ok('save: the library holds it, and it is saved', item && kept.asset.material.params.roughness === 0.9 && !E.dirty)
    ok('...without the floor, its own sample kept as it was', !/floor|studio grey/.test(JSON.stringify(kept))
        && canon(kept.preview) === canon(mine.preview) && kept.preview.node.material === null)
    B.undo(); applied()
    ok('an undo past the save is unsaved (the library holds the newer one)', E.dirty)
    B.redo(); applied()
    B.doc.libraryItem.details.tags = ['metal', 'mine']; B.doc.title = 'my brushed'; B.commit()
    ok('its name and details are the item\'s too', E.dirty)
    await E.save()
    const renamed = (await library.list()).find(i => i.id === mine.id)
    ok('...saved with it', renamed.name === 'my brushed' && renamed.tags.join() === 'metal,mine' && !E.dirty)

    await E.open(renamed)
    ok('an item open already is gone back to, not opened twice', B.project.scenes.filter(s => s.doc.libraryItem).length === 1)
    B.doc.title = 'not saved'; B.commit()
    E.close()
    ok('with no strip to ask in, close leaves unsaved work open rather than discard it', E.active && B.doc.title === 'not saved')
    B.undo(); applied()

    E.close()
    ok('close: back to the scene it came from, the item\'s scene gone', B.current === homeKey && !B.project.scenes.some(s => s.doc.libraryItem) && !E.active)
    ok('...the camera, the lighting and the exposure mode given back', R.camera.distance === 99 && R.camera.fov === 60
        && R.values.envMode === 1 && R.values.sunIlluminance === 3 && R.values.autoExposure === 0, JSON.stringify([R.camera, R.values]))
    B.undo(); applied()
    ok('an undo of the close opens it again, as it was', E.active && B.doc.title === 'my brushed' && !E.dirty)
    B.undo(); applied()                                       // the details
    B.undo(); applied()                                       // the roughness
    B.undo(); applied()                                       // the open
    ok('an undo past the open leaves it: the camera and lighting given back', !E.active && B.current === homeKey && R.camera.distance === 99 && R.values.envMode === 1)

    // CLOSING THE LAST SCENE: an empty one is made, the project always has one
    const solo = installBuilder({}, { RT, gpu: null, project: P.createProject([M.createDoc({ title: 'only' })]) })
    const doc = itemSceneDoc(renamed)
    const p = solo.project
    P.addScene(p, doc); P.removeScene(p, p.scenes[0].key); solo.use(p.scenes[0].key)
    const B2 = solo
    const tree2 = { ...tree, closeScene(key, goTo) {
        const pp = B2.project
        if (pp.scenes.length === 1) P.newScene(pp, 'New scene')
        const i = P.indexOf(pp, key)
        const next = goTo && goTo !== key && P.scene(pp, goTo) ? goTo : pp.scenes[i > 0 ? i - 1 : i + 1].key
        P.removeScene(pp, key); B2.use(next); B2.commit()
    } }
    const E2 = installItemEditor({ BUILDER: B2, RT, library, tree: tree2 })
    E2.discard()
    ok('closing an item that is the last scene leaves an empty scene, not an error', p.scenes.length === 1 && !p.scenes[0].doc.libraryItem)

    // A FILE OF THE PROJECT LEAVES THE ITEM OUT: it is the library's
    await E.open(renamed)
    let text = null
    const realCreate = globalThis.document
    // BUILDER.save downloads through the DOM; read what it would write instead
    const saved = []
    globalThis.URL.createObjectURL = b => { saved.push(b); return 'blob:' }
    globalThis.document = { createElement: () => ({ click() { } }) }
    try {
        B.save(); B.saveWorkspace()
        text = await saved[0].text()
        const ws = JSON.parse(await saved[1].text())
        ok('saving the scenes leaves the item being edited out', !text.includes('libraryItem') && JSON.parse(text).scenes.length === scenesBefore)
        ok('...and a workspace\'s current scene is the one the edit goes back to', ws.current === homeKey && !JSON.stringify(ws).includes('libraryItem'))
    } catch (e) { ok('saving files while an item is edited', false, e.stack) }
    finally { globalThis.document = realCreate }
    ok('...while the project itself still holds it (the history does)', B.project.scenes.some(s => s.doc.libraryItem))
    // a copy of the item's scene is the user's, not a second editor
    ok('a duplicated item scene is a scene of the user\'s', !P.duplicateScene(B.project, B.current).doc.libraryItem)
    ok('the default sample is a 25 mm sphere standing on z = 0', DEFAULT_PREVIEW.unit === 'mm' && DEFAULT_PREVIEW.node.params.radius === 25
        && DEFAULT_PREVIEW.node.transform.pos.z === 25)
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
