//======================================================================================================================
// EDITING A LIBRARY ITEM -- in the view, with its properties beside it, as a scene of its own.
//
// WHY A SCENE. Everything that makes the builder live -- a slider pushing a uniform, a click in the picture
// picking, the boxes, the Parameters panel -- is gated on the scene the renderer shows being the builder's
// current one (builder/demo.js). An item edited anywhere else would have none of it. So an item opens as a
// scene of the project, marked `doc.libraryItem`, right after the scene that was current; the tree, the
// Properties panel and the view then work on it unchanged. Opening is one undo step, as "+ Scene" is.
//
// ISOLATED (the user, 2026-09-30): while the current scene is a library item the tree shows only it, under
// a "back to ..." row. ONE RULE drives the whole mode: it is on exactly when the current scene is an item.
// Opening, closing, undoing past the open, redoing it -- each only changes which scene is current, and the
// tree, the strip over the view and the camera follow from that.
//
// WHAT IS IN IT: a floor (not saved); for a material, its SAMPLE wearing it (studio.js addSample -- the
// shape and size it is shown on, saved back as the item's `preview`); for anything else, the item itself (an
// empty modifier gets the studio's example F inside it, not saved). Lit by the studio's sun and sky, as its
// picture is. What is saved: the subject (a material by id, or the node) with the stage taken out first --
// so the materials it uses are worked out without the floor's -- and a material's sample, with the
// material taken off it ("the item's material goes here"); none if it is still the default.
//
// SAVE AND CLOSE live where they cannot be closed away: a strip across the top of the view (the viewport is
// the one panel that cannot be closed). Also the item's row in the tree (✓ and ×), the back row, and the
// File menu; Ctrl+S saves the item while one is being edited. Closing the Properties panel or the Library
// loses nothing -- the edit is a document, not a panel. Close with unsaved changes asks, in the strip.
//
// UNSAVED is what the LIBRARY holds against what the scene would save, compared in a canonical form (each
// put into a fresh document and taken out again: insertAsset gives everything fresh ids, so the item was
// "changed" the moment it opened). Kept by the editor, not in the document: an undo past a save would
// otherwise make a saved item look saved when the library holds the newer one, or the reverse.
//
// LEAVING puts back the lighting the user had (a scene without an environment of its own would keep the
// studio's sun otherwise). The camera and the exposure are the scene's (builder/model.js VIEW, 0.65.0): an item's
// scene is made seen as its picture is -- framed on the item from the studio's angle, its exposure metered -- and
// every scene the builder shows comes with its own (demo.js markShown), so going back is going back to how that
// scene was seen. The exposure mode was forced on here and put back on leaving until then, the one scene switch that
// changed the exposure at all. Not the renderer's other settings: what the user changed while editing stays.
//
//   const E = installItemEditor({ BUILDER, RT, SHELL, library, tree, stage, say, thumbs })
//   E.open(item)  E.save()  E.close()  E.active  E.dirty  E.shown() (the builder's onScene)  E.sync() (its onDoc)  E.frame()
//   E.remember() / E.adopt(memory)   kept with a project in the browser, so an item open at a reload is reopened
//
// NOT SEEN ON A GPU YET: the user judges the view.
//======================================================================================================================
import * as Model from '../builder/model.js'
import { STUDIO, sunAzimuthFor, framing, addExampleF, addSample, DEFAULT_PREVIEW, SAMPLE_SHAPE_KEYS, SAMPLE_SIZES, sampleShape } from './studio.js'
import { estimateBox } from '../builder/bounds.js'
import { icon, iconButton } from '../lib/pathtracer/icons.js'

/* THE STUDIO'S LIGHT as a scene's environment: the sun and sky, the sun a key light at the camera's left.
   Given over the environment the renderer has now, so every setting is the scene's own (the Environment
   row then shows them all) and a setting the studio does not name is what it was. */
export function studioEnvironment(base = {}) {
    const env = Object.fromEntries(Object.keys(Model.ENVIRONMENT).filter(k => base[k] !== undefined).map(k => [k, structuredClone(base[k])]))
    return { ...env, envMode: 0, sunIlluminance: 100000, skyIlluminance: 15000, uSkyTurbidity: 1.5,
             uSunElevation: STUDIO.sunElevation, uSunAzimuth: sunAzimuthFor(STUDIO.azimuth) }
}

const GREY = STUDIO.floorGrey
const diag = b => Math.hypot(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2])

/**
 * The scene an item is edited in (pure: the test builds every built-in item's). `environment` is the
 * renderer's now, which the studio's light goes over.
 */
export function itemSceneDoc(item, { environment = {} } = {}) {
    const isMat = item?.asset?.kind === 'material'
    const doc = Model.createDoc({ title: item.name })
    // a material's sample is in its own unit (mm, the default's); a node in the unit it was kept in
    doc.unit = isMat ? (item.preview?.unit ?? DEFAULT_PREVIEW.unit) : (item.asset.unit ?? 'm')
    Model.setEnvironment(doc, studioEnvironment(environment))
    // named for what it is: the floor's row reads "floor (not saved) · studio grey"
    const floorMat = Model.addMaterial(doc, { label: 'studio grey', preset: 'diffuse' })
    floorMat.params.baseColor = { r: GREY, g: GREY, b: GREY }
    // a plane: no parameters, so the scene's size -- and its surface tolerance -- is the item's, not a floor's
    const floor = Model.addObject(doc, 'root', { primitive: 'plane', label: 'floor (not saved)', material: floorMat.id })
    const stage = [floor.id]
    let subject, sample = null, box
    if (isMat) {
        subject = Model.insertAsset(doc, item.asset).id
        const s = addSample(doc, item, subject)
        sample = s.id
        floor.transform.pos.z = floorUnder(doc, s, Model.material(doc, subject))
    } else {
        const n = Model.insertAsset(doc, item.asset, 'root')
        subject = n.id
        if (n.kind === 'group' && !n.children.length) stage.push(addExampleF(doc, n.id).id)
        box = estimateBox({ kind: 'group', children: [n] }, null, doc)
        /* the estimate's bottom (bounds.js): right for the + menu's shapes, a guess for code -- the floor is a
           node like any other, to be moved if it guessed wrong */
        if (box) floor.transform.pos.z = box.lo[2] - 0.004 * diag(box)
    }
    doc.libraryItem = { id: item.id, kind: isMat ? 'material' : 'node', unit: item.asset.unit ?? null,
        subject, sample, stage, stageMaterials: [floorMat.id],
        details: { category: item.category ?? 'Mine', tags: [...(item.tags || [])], help: item.help ?? '' } }
    /* SEEN AS ITS PICTURE IS (0.65.0, builder/model.js VIEW): framed on the item from the studio's angle, the exposure
       metered -- the view the editor gave it the first time it was shown, now the scene's own from the start */
    const f = itemView(doc)
    Model.setView(doc, { camera: f ? studioCamera(f) : undefined, exposure: { autoExposure: 1 } })
    return doc
}
/** The studio's camera on a framing (studio.js framing: { target, distance }): its angle and field, a pinhole. */
export const studioCamera = f => ({ mode: 'orbit', camtype: 0, fov: STUDIO.fov, target: f.target, azimuth: STUDIO.azimuth,
    elevation: STUDIO.elevation, distance: f.distance, dimensions: f.distance, aperture: 0, focus: 0 })

/* A sample stands on z = 0 (studio.js): the floor a hair below, not in its bottom face -- and below the
   deepest its material's relief reaches (materials.js: its amplitude, in mm) */
function floorUnder(doc, sample, material) {
    const box = estimateBox({ kind: 'group', children: [sample] }, null, doc)
    const A = material?.relief?.params?.amplitude ?? 0
    return -0.004 * (box ? diag(box) : 1) - A * 0.001 / (Model.UNITS[doc.unit] ?? 1)
}

/* A MATERIAL'S SAMPLE, as the item would save it: the sample node taken out, the item's material taken
   off it ("the item's material goes here") and out of its materials. Null when there is none. */
function sampleAsset(d, li) {
    if (li.sample == null || !Model.find(d, li.sample)) return null
    const preview = Model.extractAsset(d, li.sample)
    Model.walk({ root: preview.node }, x => { if (x.material === li.subject) x.material = null })
    preview.materials = preview.materials.filter(m => m.id !== li.subject)
    return preview
}

/** WHAT A MATERIAL ITEM CAN BE SHOWN ON (studio.js sampleShape), for the Properties panel's choice: a shape,
 *  and a size in mm. */
export const SAMPLE_CHOICES = SAMPLE_SHAPE_KEYS
export { SAMPLE_SIZES }
/** Which of them its sample is now: { shape, size }, 'own' when it was changed by hand (a radius dragged, a
 *  shape of the user's), or null when there is none -- deleted, or not a material item. */
export function sampleOf(doc) {
    const li = doc?.libraryItem
    if (li?.kind !== 'material') return null
    const a = sampleAsset(doc, li)
    if (!a) return null
    const c = canon(a)
    for (const size of SAMPLE_SIZES) for (const shape of SAMPLE_CHOICES)
        if (canon(sampleShape(shape, size)) === c) return { shape, size }
    return 'own'
}
/** Show the material on `shape` at `size` mm instead: the old sample out, the new one in its place (its
 *  parent, its position among its siblings), wearing the item's material; the floor just under it. What is
 *  saved as the item's preview follows (extractItem) -- none for the 50 mm sphere, the default. Mutates
 *  `doc`: the caller makes it an undo step. */
export function setSample(doc, shape, size = SAMPLE_SIZES[0]) {
    const li = doc?.libraryItem
    if (li?.kind !== 'material') throw new Error('only a material item has a sample')
    const asset = sampleShape(shape, size)          // throws, naming the choices, for one that is not
    const old = li.sample != null ? Model.find(doc, li.sample) : null
    if (old) Model.remove(doc, li.sample)
    const n = addSample(doc, { preview: asset }, li.subject, old?.parent.id ?? 'root', old ? old.index : undefined)
    li.sample = n.id
    const floor = li.stage?.[0] != null ? Model.find(doc, li.stage[0])?.node : null
    if (floor) floor.transform.pos.z = floorUnder(doc, n, Model.material(doc, li.subject))
    return n
}

/** Where the camera looks at the subject from, in the scene's units: the studio's view of its box. */
export function itemView(doc) {
    const li = doc.libraryItem
    const id = li.kind === 'material' ? li.sample : li.subject
    const f = id != null ? Model.find(doc, id) : null
    const box = f ? estimateBox({ kind: 'group', children: [f.node] }, null, doc) : null
    return box ? framing(box.lo, box.hi) : null
}

/**
 * What saving the scene would put in the library: { asset, preview } -- the subject with the stage taken
 * out, and for a material its sample without the material (null when it is the default one). Throws, with
 * why, when the subject is no longer there.
 */
export function extractItem(doc) {
    const d = structuredClone(doc)
    const li = d.libraryItem
    // the stage out FIRST, so the materials the subject uses are worked out without the floor's
    for (const id of li.stage || []) if (Model.find(d, id)) Model.remove(d, id)
    const unitOf = a => ({ ...a, unit: li.unit })       // what it was kept in: null stays "no size of its own"
    if (li.kind === 'material') {
        if (!Model.material(d, li.subject)) throw new Error('its material is no longer in the scene')
        const asset = unitOf(Model.extractAsset(d, li.subject))
        let preview = sampleAsset(d, li)
        if (preview && canon(preview) === canon(DEFAULT_PREVIEW)) preview = null
        return { asset, preview }
    }
    if (!Model.find(d, li.subject)) throw new Error('it is no longer in the scene')
    return { asset: unitOf(Model.extractAsset(d, li.subject)), preview: null }
}

/* AN ASSET, CANONICAL: put into a fresh document of its own unit and taken out again, as JSON -- ids fresh
   in the same order both times, so two assets that are the same thing read the same. Its unit is said
   beside it (null and 'm' are not the same: null is "no size of its own"). */
export function canon(asset) {
    if (asset == null) return 'null'
    try {
        const d = Model.createDoc({ title: 'canon' })
        d.unit = asset.unit ?? 'm'
        const x = Model.insertAsset(d, asset, 'root')
        return JSON.stringify({ unit: asset.unit ?? null, asset: Model.extractAsset(d, x.id) })
    } catch { return JSON.stringify(asset) }
}
/** An item's saved state, canonical: what the unsaved check compares. */
export const canonItem = ({ name, category, tags, help, asset, preview }) =>
    JSON.stringify({ name: String(name ?? ''), category: String(category ?? ''), tags: [...(tags || [])], help: String(help ?? ''),
                     asset: canon(asset), preview: canon(preview ?? null) })
/** The same of what the scene would save now. */
export function canonScene(doc) {
    const li = doc.libraryItem
    const { asset, preview } = extractItem(doc)
    return canonItem({ name: doc.title, ...li.details, asset, preview })
}

/**
 * @param BUILDER  builder/demo.js's (project, current, doc, commit)
 * @param RT       the renderer: get, set, applyView (the camera framed on an item), and the lighting on the way in and out
 * @param SHELL    the shell: open, isOpen, dock (the panels brought forward, and back) -- optional
 * @param library  library/store.js's (update, add)
 * @param tree     builder/tree.js's: openScene, closeScene, enterScene, select
 * @param stage    the view's element, for the strip (none in a test)
 */
export function installItemEditor({ BUILDER, RT, SHELL = null, library, tree, stage = null, say = () => { }, thumbs = null }) {
    const saved = new Map()                 // item id -> canonItem of what the library holds
    const envKeys = Object.keys(Model.ENVIRONMENT)
    const envNow = () => { const v = RT.get?.() ?? {}; return Object.fromEntries(envKeys.filter(k => v[k] !== undefined).map(k => [k, structuredClone(v[k])])) }
    let home = { env: envNow() }
    let inItem = null                       // the item id of the item scene last shown, or null
    let libraryWasShowing = false

    const itemDoc = () => BUILDER.doc?.libraryItem ? BUILDER.doc : null
    const dirtyOf = doc => {
        if (!doc?.libraryItem) return false
        try { return canonScene(doc) !== saved.get(doc.libraryItem.id) } catch { return true }
    }

    /* THE STRIP over the view: the item's name, a dot while unsaved, Save and Close -- or the question */
    let strip = null, asking = false
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
    const drawStrip = () => {
        if (!stage) return
        const doc = itemDoc()
        if (!doc) { strip?.remove(); strip = null; asking = false; return }
        if (!strip) { strip = el('div', 'shell-edit-strip'); stage.appendChild(strip) }
        strip.replaceChildren()
        if (asking) {
            const b = (text, title, fn) => { const x = el('button', 'shell-edit-btn', text); x.type = 'button'; x.title = title; x.onclick = fn; return x }
            strip.append(el('span', 'shell-edit-q', 'Unsaved changes:'),
                b('Save', 'Save to the library, then close', async () => { asking = false; if (await E.save()) finish() }),
                b('Discard', 'Close without saving', () => { asking = false; finish() }),
                b('Keep editing', 'Back to the item', () => { asking = false; drawStrip() }))
            return
        }
        const name = el('span', 'shell-edit-name')
        name.append(icon('edit', 14), el('span', null, doc.title))
        name.title = 'A library item, edited in a scene of its own: the tree shows only it until it is closed'
        const dot = el('span', 'shell-edit-dot', '●'); dot.title = 'Not saved to the library'
        dot.hidden = !dirtyOf(doc)
        strip.append(name, dot, iconButton('save', 'Save to the library (Ctrl+S)', () => E.save()),
                     iconButton('close', 'Close: back to the scene before (asks if not saved)', () => E.close()))
    }
    // the dot follows edits from anywhere -- a slider, the code, an undo -- by looking, as the toolbar's
    // undo button does; compared only when the scene's text has changed
    let lastText = null
    if (stage) setInterval(() => {
        const doc = itemDoc()
        if (!doc || !strip || asking) return
        const text = JSON.stringify(doc)
        if (text === lastText) return
        lastText = text
        const dot = strip.querySelector('.shell-edit-dot')
        if (dot) dot.hidden = !dirtyOf(doc)
    }, 300)

    /* CLOSE, once it has been decided: back to the scene it came from (or the one beside it), the Library tab
       forward again if it was showing when the item opened */
    const finish = () => {
        const doc = itemDoc()
        if (!doc) return drawStrip()
        const key = BUILDER.current
        tree.closeScene(key, doc.libraryItem.from)
        asking = false
        drawStrip()
        if (libraryWasShowing && SHELL?.isOpen?.('library')) SHELL.open('library')
    }

    const E = {
        /** Whether a library item is the scene being edited. */
        get active() { return !!itemDoc() },
        /** Whether it differs from what the library holds. */
        get dirty() { return dirtyOf(itemDoc()) },
        /** Open one of the user's items in a scene of its own (the panel duplicates a built-in one first). An
         *  item already open is gone back to, not opened twice. */
        async open(item) {
            if (!String(item?.id).startsWith('mine:')) throw new Error('only one\'s own items are edited: duplicate a built-in one')
            const open = BUILDER.project.scenes.find(s => s.doc.libraryItem?.id === item.id)
            libraryWasShowing = !!SHELL?.dock?.getPanel?.('library')?.api?.isVisible
            if (open) {
                if (BUILDER.current !== open.key) tree.enterScene(open.key)
            } else {
                const doc = itemSceneDoc(item, { environment: envNow() })
                doc.libraryItem.from = BUILDER.current
                saved.set(item.id, canonItem(item))
                tree.openScene(doc)
            }
            tree.select(BUILDER.doc.libraryItem.subject)
            SHELL?.open?.('scene'); SHELL?.open?.('properties')
            drawStrip()
            say(`editing ${item.name}: Save or Close are over the view`)
        },
        /** Save the scene to its item. Resolves to the item, or null if it could not be (said why). */
        async save() {
            const doc = itemDoc()
            if (!doc) return null
            const li = doc.libraryItem
            let got
            try { got = extractItem(doc) } catch (e) { say(`not saved: ${e.message}`); return null }
            const patch = { name: doc.title, category: li.details.category, tags: li.details.tags, help: li.details.help,
                            asset: got.asset, preview: got.preview }
            let item
            try { item = await library.update(li.id, patch) }
            catch (e) {
                if (!/no such item/.test(e?.message ?? '')) { say(`not saved: ${e.message}`); return null }
                // removed from the library while it was being edited: kept as a new one, and this scene is its
                item = await library.add(patch)
                li.id = item.id
                BUILDER.commit?.()
                say(`${doc.title} was no longer in the library: kept as a new item`)
            }
            saved.set(item.id, canonItem(item))
            lastText = null
            thumbs?.want?.(item)
            drawStrip()
            say(`saved ${item.name} to the library`)
            return item
        },
        /** Close the item being edited: at once when saved, else the strip asks -- and with no strip to ask in,
         *  not at all (discard() is the explicit way): unsaved work is never thrown away unasked. */
        close() {
            const doc = itemDoc()
            if (!doc) return
            if (dirtyOf(doc)) {
                if (!stage) return say('not closed: it is not saved (save it, or discard it)')
                asking = true
                return drawStrip()
            }
            finish()
        },
        /** Close without asking (the strip's Discard). */
        discard: () => finish(),
        /* THE MODE FOLLOWS THE SCENE SHOWN (the builder's onScene): entering an item's scene takes the lighting
           the user had; leaving puts it back. Called after every apply -- which is also how an undo past the open,
           or a redo of it, arrives. The camera and the exposure the builder has already dealt with: they are the
           scene's (demo.js markShown), the item's made as its picture is (itemSceneDoc). A camera kept here as well
           was the item editor's own "home" -- which went back to where the item was opened from even when the scene
           shown next was another, and was the only scene switch that did. */
        shown() {
            const doc = BUILDER.doc
            const now = doc?.libraryItem?.id ?? null
            if (now === inItem) return drawStrip()
            // a scene with an environment of its own has had it pushed already; one without gets the user's
            if (inItem && !doc?.environment) RT.set?.(structuredClone(home.env))
            if (!now) home.env = envNow()          // a scene of the user's: its lighting is what leaving an item puts back
            inItem = now
            drawStrip()
        },
        /** The camera to the studio's view of the item: on opening it, and when its sample changes size (a
         *  200 mm sample seen from where the 50 mm one was is a wall). */
        frame() {
            const doc = itemDoc(), view = doc ? itemView(doc) : null
            // the renderer's camera, which the builder keeps as the scene's (demo.js keepView)
            if (view) RT.applyView?.({ camera: studioCamera(view) })
        },
        /** The project was replaced or restored (the builder's onDoc): the strip follows. */
        sync() { if (!itemDoc()) asking = false; lastText = null; drawStrip() },
        /** WHAT LEAVING THE ITEM PUTS BACK -- the lighting the user had before it opened -- for a project
         *  kept in the browser (workspace/), so an item open at a reload is reopened as it was (the user, 2026-10-02).
         *  Null when no item is open. */
        remember() { return itemDoc() ? { home: structuredClone(home), libraryWasShowing } : null },
        /** A PROJECT READ BACK from the browser, or another one opened (workspace/session.js): the mode taken up as the
         *  project has it -- on when its current scene is an item, what leaving puts back from `memory` (remember's),
         *  the library's copy of every item open in it for the unsaved dot -- WITHOUT framing the camera, which the
         *  project kept. An item gone from the library since stays unsaved: Save keeps it as a new one. */
        async adopt(memory = null) {
            asking = false; lastText = null
            // a memory kept before 0.65.0 has an exposure mode too: the item's scene has its own now
            home = { env: memory?.home?.env ? structuredClone(memory.home.env) : envNow() }
            libraryWasShowing = !!memory?.libraryWasShowing
            inItem = itemDoc()?.libraryItem?.id ?? null
            const ids = BUILDER.project.scenes.map(s => s.doc.libraryItem?.id).filter(Boolean)
            if (ids.length) {
                const all = await library.list()
                for (const id of ids) { const it = all.find(i => i.id === id); if (it) saved.set(id, canonItem(it)) }
            }
            drawStrip()
        },
    }
    return E
}
