//======================================================================================================================
// THE STUDIO -- the library's pictures, made by the path tracer itself (library/thumbs.js keeps them).
//
// A SECOND RENDERER, small and quiet: createPathTracer with a canvas that is never in the page and
// `hud: false`, so it renders offscreen beside the view without touching it -- the view's scene is not
// swapped out, and its Render stats are not written to (the view is paused while it works: viewGate).
//
// ONE SCENE PER UNIT holds every item, each behind a visibility uniform (studioBatch): a picture is a few
// uniforms written and some samples, not a compile. Lit by the sun and sky -- the sun a key light at the
// camera's left -- over a mid-grey floor brought to the item's bottom, the camera fitted to the item's box
// (measured when the document's estimate cannot be trusted: builder/boxes.js against this renderer's own
// tagged copy). The glass is the renderer's glass, the metal its metal.
//
// ONE THING AT A TIME: a picture and a live view share the renderer, so each holds it until done.
//
//   const S = await createStudio({ gpu, pauseView })  // compiles its pipelines: once, when first needed
//   S.know(items)                                     // what there is: in scenes of STUDIO.batch per unit
//   S.onStatus(text => ..)                            // what it waits on, for the user: a compile
//   S.onCompile(p => ..)                              // ...and how far it has got, for a progress bar
//   const png = await S.render(item)                  // a Blob -- what thumbs.js's render() is
//   const stop = S.live(item, element)                // draws the item live in `element`: a click and
//                                                     // moving turns it, the wheel zooms; stop() gives it back
//
// NOT SEEN ON A GPU YET (the container has none): the user is the judge of how it looks.
//======================================================================================================================
import { createPathTracer } from '../lib/pathtracer/index.js'
import { CAMERA } from '../lib/camera.js'
import * as Model from '../builder/model.js'
import { generate, xfName, visName, uniformName } from '../builder/codegen.js'
import { createBoxes } from '../builder/boxes.js'
import { estimateBox } from '../builder/bounds.js'
import { framing as frameBox } from '../builder/focus.js'
import { syncSources } from '../builder/sources.js'
import { autoEps } from '../lib/pathtracer/core/photometry.js'

export const STUDIO = {
    size: 192,              // pixels a side: a tile is up to 200 CSS px, and a picture this size is sharp at 1x
    samples: 48,            // per picture: enough for a still that is not noisy at this size
    fov: 30,                // degrees: long enough a lens that shapes do not bulge
    azimuth: -50,           // from the front left...
    elevation: 28,          // ...and above
    margin: 1.12,           // the fitted sphere's radius times this: a little air around it
    /* THE LIGHT: the sun and sky, the sun from the camera's left and above -- a KEY light, so a sphere
       reads as a sphere. The studio's even light (envMode 1) made every sphere a flat grey disc (the user,
       2026-09-28). Azimuth relative to the camera's, so turning the camera keeps the light where it is. */
    sunFromCamera: 70,      // degrees to the camera's left
    sunElevation: 40,
    floorGrey: 0.35,        // the floor's albedo: a mid grey, so the (white) item stands out from it
    white: 0.85,            // an object with no material of its own is this white, not the default grey
    /* ITEMS PER SCENE. All of a unit's items in one scene was one compile per unit, but a compile grows
       faster than the scene does, and forty items took long enough to look hung (the user, 2026-09-28).
       Parts of this many: each compiles in seconds, and a part done is progress seen. */
    batch: 8,
    /* A LIGHT'S FACE, as the studio shows it: bright enough to read as lit beside a sunlit white object
       (0.85 of 100 klx is about 27 000 cd/m2). At its own 1000 cd/m2 a light was black in its picture. */
    lightLuminance: 60000,
}

/* THE SUN'S AZIMUTH for a camera azimuth. The camera measures from +x toward +y (lib/camera.js: pos =
   target + d (cos az, sin az)); the sun from +y toward +x (core/sdf.js sunDirection: (sin a, cos a)). */
export const sunAzimuthFor = camAz => 90 - (camAz + STUDIO.sunFromCamera)

/* ONE SCENE PER UNIT, EVERY ITEM IN IT, EACH BEHIND ITS OWN UNIFORM (codegen liveVisibility). A scene per
   picture was a compile per picture, about a second each (the user, 2026-09-28); now a picture is a few
   uniforms written -- which item is shown, where the floor is -- and the compile happens once per unit
   (the library's metre items, its centimetre ones), again only when an item is added.
     a material            on its sample (addSample: its own preview, or a 25 mm sphere) -- real size, so a
                           brush streak 0.6 mm wide is seen, where on the 2 m sphere it was below a pixel
     a shape, a group      as a paste puts it; an object with no material gets the studio's white (the
                           default grey was the floor's grey: "the images all have the same colour as
                           the background"), and an empty group -- a modifier -- an F to act on
     THE FLOOR             a wide thin disc of mid grey, sized and moved to each item's bottom, live
   IDS UNIQUE PER SCENE (nextId from n * 100000): uniforms are named after ids, and the renderer carries a
   value from one scene to the next when both declare the name -- every studio scene's first material was
   'm1', so each new one showed the last one's colour (everything turned red). */
export const floorIdOf = n => `studioFloor${n}`
/* A MODIFIER'S EXAMPLE: an F of three blocks, standing up, on the +x side. A single block said nothing about a
   mirror -- a box mirrored is a box (the user, 2026-09-28) -- where an F has no symmetry at all, so a
   mirror, a twist or a bend each shows which way it went. Kept off x = 0 so a mirror makes two of it. */
// sizes are HALF-sizes, as a box's are (builder/primitives.js): a stem 0.9 tall, x from 0.15 to 0.57
const EXAMPLE_F = [
    { label: 'F stem', size: { x: 0.06, y: 0.06, z: 0.45 }, pos: { x: 0.21, y: 0, z: 0 } },
    { label: 'F top', size: { x: 0.21, y: 0.06, z: 0.06 }, pos: { x: 0.36, y: 0, z: 0.39 } },
    { label: 'F middle', size: { x: 0.15, y: 0.06, z: 0.06 }, pos: { x: 0.30, y: 0, z: 0.06 } },
]
/* WHAT A MODIFIER SHOWS ITS F WITH, where its own parameters suit a real scene and not an F: a repeat's
   2 m pitch left one F in the frame and the next one in front of the camera (the user, 2026-09-28). The
   picture's scene only; the item keeps its own. A pitch of 1.3 holds the F (x 0.15 to 0.57) in its cell. */
const EXAMPLE_PARAMS = { repeat: { spacing: { x: 1.3, y: 0.6, z: 1.2 }, count: { x: 1, y: 1, z: 0 } } }
/* ...and where it goes, known exactly -- not measured, since sampling found the first copy and not the
   rest: the F's box, and for a repeat its copies, for a mirror its reflection */
const F_BOX = { lo: [0.15, -0.06, -0.45], hi: [0.57, 0.06, 0.45] }
const EXAMPLE_BOX = {
    mirror: { lo: [-F_BOX.hi[0], F_BOX.lo[1], F_BOX.lo[2]], hi: F_BOX.hi.slice() },
    repeat: { lo: [F_BOX.lo[0] - 1.3, F_BOX.lo[1] - 0.6, F_BOX.lo[2]], hi: [F_BOX.hi[0] + 1.3, F_BOX.hi[1] + 0.6, F_BOX.hi[2]] },
}
const modifierOf = item => /^builtin:modifier:(.+)$/.exec(item?.id ?? '')?.[1] ?? null
export const addExampleF = (doc, parentId) => {
    const g = Model.addGroup(doc, parentId, { label: 'example F' })
    for (const b of EXAMPLE_F)
        Model.addObject(doc, g.id, { primitive: 'box', label: b.label, params: { size: b.size, rounding: 0.01 },
            transform: { pos: b.pos, rot: { x: 0, y: 0, z: 0 }, scale: 1 } })
    return g
}
/* A MATERIAL'S SAMPLE: what it is shown on -- the item's own `preview` (a node asset: a shape and a size, which
   the item editor saves back, library/edit.js) or this. REAL SIZE, because a material's detail is: brushed
   aluminium's streaks are 0.6 mm wide, and on a sphere two metres across (what a material was shown on) they
   were far below a pixel. A 25 mm radius puts about one streak on a thumbnail's pixel. A sample STANDS ON
   z = 0 -- its centre at z = r -- so a floor under it is at 0 whatever its shape. */
/* THE SAMPLE SHAPES (the user, 2026-09-30: "allow to pick an example shape -- cube, sphere, cylinder, F. That
   makes the library more consistent"). ONE TABLE for the pictures, the item editor's choice and the built-in
   items' previews, so "the cube" is the same cube everywhere. All in mm, all standing on z = 0, all about
   one size, so one framing and one floor serve each. Sizes are the primitives' own: a box's and an F
   block's are HALF-sizes (builder/primitives.js). The F is the modifiers' example F, centred on x, since
   here it is shown, not mirrored.
   TWO SIZES OF EACH (the user, 2026-09-30, choosing "a large size option" for every material): 50 mm, and
   200 mm for a pattern that is large in life -- marble's veins centimetres apart, concrete's stains --
   which a 50 mm ball shows a piece of. BUILT at the size, its own numbers multiplied, NOT a transform
   scale: a scale is in S_local and XF_S, which is right for a pattern but puts a factor into every length
   read off the node (its radius slider, the sample's box). */
const at = z => ({ pos: { x: 0, y: 0, z }, rot: { x: 0, y: 0, z: 0 }, scale: 1 })
/* the sliders' ranges grow with it; at 50 mm they are exactly what they were, so a sample saved before the
   sizes existed still reads as the shape it was and not as "its own" */
const MM = (k, max = 200) => ({ min: 1, max: max * k, step: 0.5 })
const shapeAsset = build => {
    const d = Model.createDoc({ title: 'sample' })
    d.unit = 'mm'
    return Model.extractAsset(d, build(d).id)
}
/** The sizes a sample comes in, mm: about its height and width. */
export const SAMPLE_SIZES = [50, 200]
const BUILD = {
    sphere: k => d => Model.addObject(d, 'root', { primitive: 'sphere', label: 'sample', params: { radius: 25 * k },
        ranges: { radius: MM(k) }, transform: at(25 * k) }),
    cube: k => d => Model.addObject(d, 'root', { primitive: 'box', label: 'sample',
        params: { size: { x: 20 * k, y: 20 * k, z: 20 * k }, rounding: 2 * k }, ranges: { rounding: { min: 0, max: 20 * k, step: 0.1 } }, transform: at(20 * k) }),
    cylinder: k => d => Model.addObject(d, 'root', { primitive: 'cylinder', label: 'sample',
        params: { radius: 20 * k, height: 40 * k }, ranges: { radius: MM(k), height: MM(k, 400) }, transform: at(20 * k) }),
    F: k => d => {
        const g = Model.addGroup(d, 'root', { label: 'sample' })
        // at 50 mm: a stem 50 tall, strokes 7 wide and 10 deep, the F 25 across (x -12.5 .. 12.5)
        for (const [label, size, x, z] of [['F stem', { x: 3.5, y: 5, z: 25 }, -9, 25], ['F top', { x: 12.5, y: 5, z: 3.5 }, 0, 46.5],
                                             ['F middle', { x: 10, y: 5, z: 3.5 }, -2.5, 28]])
            Model.addObject(d, g.id, { primitive: 'box', label, params: { size: { x: size.x * k, y: size.y * k, z: size.z * k }, rounding: k },
                transform: { pos: { x: x * k, y: 0, z: z * k }, rot: { x: 0, y: 0, z: 0 }, scale: 1 } })
        return g
    },
}
/** The shapes, in the order the Properties panel offers them. */
export const SAMPLE_SHAPE_KEYS = Object.keys(BUILD)
const made = new Map()
/** Shape `key` at `size` mm (one of SAMPLE_SIZES), as a node asset; the same object every time asked. */
export function sampleShape(key, size = SAMPLE_SIZES[0]) {
    if (!BUILD[key]) throw new Error(`no sample shape '${key}' (one of ${SAMPLE_SHAPE_KEYS.join(', ')})`)
    if (!SAMPLE_SIZES.includes(size)) throw new Error(`no sample size ${size} (one of ${SAMPLE_SIZES.join(', ')} mm)`)
    const id = `${key}@${size}`
    if (!made.has(id)) made.set(id, shapeAsset(BUILD[key](size / SAMPLE_SIZES[0])))
    return made.get(id)
}
/** The 50 mm ones, by shape. */
export const SAMPLE_SHAPES = Object.fromEntries(SAMPLE_SHAPE_KEYS.map(k => [k, sampleShape(k)]))
/** A material item with no preview of its own is shown on the sphere. */
export const DEFAULT_PREVIEW = SAMPLE_SHAPES.sphere
/** Put a material item's sample into `doc` under `parentId` (at `index`, the end if omitted), wearing
 *  `materialId` wherever the sample has no material of its own. Returns its node. */
export function addSample(doc, item, materialId, parentId = 'root', index) {
    const n = Model.insertAsset(doc, item?.preview ?? DEFAULT_PREVIEW, parentId, index)
    Model.walk({ root: n }, x => {
        if (x.kind === 'object' && x.type !== 'light' && x.type !== 'export' && x.material == null) x.material = materialId
    })
    return n
}

export function studioBatch(items, unit = 'm', n = 1) {
    const doc = Model.createDoc({ title: `studio (${unit})` })
    doc.unit = unit
    doc.nextId = n * 100000 + 1
    Model.setLiveVisibility(doc, true)
    const white = Model.addMaterial(doc, { id: `studioWhite${n}`, label: 'studio white', preset: 'diffuse' })
    white.params.baseColor = { r: STUDIO.white, g: STUDIO.white, b: STUDIO.white }
    const g = STUDIO.floorGrey
    const floorMat = Model.addMaterial(doc, { id: `studioFloorMat${n}`, label: 'studio floor', preset: 'diffuse' })
    floorMat.params.baseColor = { r: g, g, b: g }
    const floor = Model.addObject(doc, 'root', { primitive: 'cylinder', id: floorIdOf(n), label: 'floor', material: floorMat.id,
        params: { radius: 1, height: 0.02 } })
    const entries = new Map()
    for (const item of items) {
        let node, exact = null
        /* ONE ITEM THAT CANNOT GO IN is that item's failure, not its part's: since 0.15 an asset brings the helpers its
           code calls (model.js insertAsset), and two items from two scenes may each bring their own of one name -- the
           second refused, as the builder refuses it. Its entry says why; its neighbours are drawn. */
        try {
            if (item.asset?.kind === 'material') {
                const m = Model.insertAsset(doc, item.asset)
                node = addSample(doc, item, m.id)
                node.label = `swatch: ${item.name}`
            } else {
                node = Model.insertAsset(doc, item.asset, 'root')
                if (node.kind === 'group' && !node.children.length) {
                    addExampleF(doc, node.id)
                    const mod = modifierOf(item)
                    if (EXAMPLE_PARAMS[mod]) Object.assign(node.params, structuredClone(EXAMPLE_PARAMS[mod]))
                    exact = EXAMPLE_BOX[mod] ?? null
                }
                Model.walk({ root: node }, x => {
                    if (x.kind === 'object' && x.type !== 'light' && x.type !== 'export' && x.material == null) x.material = white.id
                    // a light shown lit, whatever it was given as: its colour kept, its brightness the studio's
                    if (x.type === 'light' && x.light) { x.light.luminance = STUDIO.lightLuminance; x.light.flux = null }
                })
            }
        } catch (e) { entries.set(itemKey(item), { failed: e?.message ?? String(e) }); continue }
        const estimate = estimateBox({ kind: 'group', children: [node] }) ?? { lo: [-1, -1, -1], hi: [1, 1, 1] }
        node.enabled = false
        entries.set(itemKey(item), { id: node.id, estimate, measure: !exact && !estimateIsRight(item), ...(exact ? { box: exact } : {}) })
    }
    return { doc, entries, floorId: floor.id, n, unit }
}
/** What the studio knows an item by: what it is (its asset, and what a material is shown on), not its name. */
export const itemKey = item => JSON.stringify([item?.asset ?? null, item?.preview ?? null])

/* THE PARTS: the items known, in the order given, STUDIO.batch to a part per unit -- the grid's neighbours
   share one -- and an item added later joins its unit's last part (or starts one). know(list) is the whole
   library: what it no longer lists is FORGOTTEN -- an item saved after an edit is a new item (it is known
   by what it is), and its old self stayed in its part, compiled into every scene of it, for good. add(list)
   only adds (one item asked for before the library's list arrived). Both return the parts that changed:
   their scenes are stale. Pure, so the test runs it. */
export function studioParts(batch = STUDIO.batch) {
    const items = new Map(), partOf = new Map(), perUnit = new Map()
    const add = list => {
        const changed = new Set()
        for (const it of list) {
            const key = itemKey(it)
            if (items.has(key)) continue
            const unit = it.asset?.unit ?? 'm', c = perUnit.get(unit) ?? 0
            const part = `${unit}:${Math.floor(c / batch)}`
            items.set(key, it); partOf.set(key, part); perUnit.set(unit, c + 1)
            changed.add(part)
        }
        return changed
    }
    return {
        add,
        know(list) {
            const listed = new Set(list.map(itemKey)), gone = new Set()
            for (const key of [...items.keys()]) if (!listed.has(key)) {
                gone.add(partOf.get(key))
                items.delete(key); partOf.delete(key)
            }
            return new Set([...gone, ...add(list)])
        },
        has: key => items.has(key),
        partOf: key => partOf.get(key),
        members: part => [...items.keys()].filter(k => partOf.get(k) === part).map(k => items.get(k)),
        /** "part 2 of 5": which scene a part is, for the user waiting on its compile */
        label(part) { const all = [...new Set(partOf.values())]; return `part ${all.indexOf(part) + 1} of ${all.length}` },
    }
}
/* WHETHER TO MEASURE: the document's estimate (bounds.js) is right for the + menu's own shapes and lights,
   and a material's default sample is a sphere -- measuring costs a sampling pass, so it is kept for what code
   may have reshaped: a modifier (it moves space: a mirror doubles its F, a repeat copies it), assemblies, one's
   own items, imports -- and a material's own sample, which the estimate pads to a cube of its largest
   parameter (a 25 x 10 mm cylinder would float 20 mm over the floor) */
// ...and a material with a relief, whose bumps reach past the sphere the estimate is
const estimateIsRight = item => (item.asset?.kind === 'material' && !item.preview && !item.asset.material?.relief)
    || /^builtin:(shape|light):/.test(item.id ?? '')

/** A camera that frames a box: its centre, and a distance at which the sphere around it fills the view. The builder's
 *  (focus.js, which the tree's double-click frames a node with), at the studio's field of view and margin. */
export const framing = (lo, hi, { fov = STUDIO.fov, margin = STUDIO.margin } = {}) => frameBox(lo, hi, { fov, margin })

/* THE VIEW PAUSED WHILE THE STUDIO WORKS: taken with the first task, given back `after` ms after the last --
   so a run of pictures pauses the view once, not once per picture -- or at once by release() (the user is
   working in the view again). pauseView() -> resume() is the host's. */
export function viewGate(pauseView, after = 400) {
    let tasks = 0, resume = null, timer = 0
    const give = () => { if (resume) { const r = resume; resume = null; try { r() } catch { } } }
    return {
        pause() {
            clearTimeout(timer)
            if (tasks++ === 0 && !resume && pauseView) { try { resume = pauseView() } catch (e) { console.warn('[studio] pausing the view:', e) } }
        },
        unpause() {
            if (--tasks > 0) return
            timer = setTimeout(() => { if (tasks === 0) give() }, after)
        },
        release() { clearTimeout(timer); give() },
        get tasks() { return tasks },
    }
}

/**
 * @param pauseView  () => resume(): stop the host's own view rendering, and a function that starts it again
 *                   -- the studio shares the GPU with it, and the two rendering at once made both slow
 *                   (the user, 2026-09-28). Held from the first picture of a run to shortly after the last.
 */
export async function createStudio({ gpu, size = STUDIO.size, samples = STUDIO.samples, pauseView = null } = {}) {
    // a canvas never put in the page: the camera wants an element to listen to, and this one hears nothing
    const canvas = document.createElement('canvas')
    const Q = { s: size, a: 1, fov: STUDIO.fov, azimuth: STUDIO.azimuth, elevation: STUDIO.elevation, distance: 10,
                dimensions: 10, camtype: 0, resetframecount: 1 }
    // an empty scene to start: each item brings its own
    const RT = await createPathTracer({ gpu, ctx: { canvas }, Q, CAMERA, hud: false,
        scene: generate(Model.toTree(Model.createDoc({ title: 'studio' })), { id: 'studio', title: 'studio' }) })
    await RT.init()
    // THE LIGHT: the sun and sky, the sun a key light beside the camera; exposure metered, so a dark item and
    // a glowing one both read
    RT.set({ envMode: 0, sunIlluminance: 100000, skyIlluminance: 15000, uSkyTurbidity: 1.5,
             uSunElevation: STUDIO.sunElevation, uSunAzimuth: sunAzimuthFor(STUDIO.azimuth), autoExposure: 1 }, false)

    /* ONE AT A TIME: a picture and a live view share the renderer */
    let chain = Promise.resolve()
    const gate = viewGate(pauseView)
    const pause = gate.pause, unpause = gate.unpause
    const hold = fn => {
        const task = async () => { pause(); try { return await fn() } finally { unpause() } }
        const p = chain.then(task, task); chain = p.catch(() => { }); return p
    }

    /* THE ITEMS IT KNOWS (know()), in PARTS of STUDIO.batch per unit, in the order they were given (the
       library's, so the grid's neighbours share a part), and a scene per part -- made again when an item
       joins it. SHOW AN ITEM: its part's scene compiled if it is not the one showing (or is stale), the item
       made visible and the last one hidden, its box measured if its estimate cannot be trusted, the floor
       brought to its bottom, the camera fitted. Uniforms, all of it, but for that compile. */
    const statusFns = new Set()
    const tell = text => { for (const f of statusFns) { try { f(text) } catch { } } }
    const parts = studioParts()
    const batches = new Map()           // part id -> { doc, entries, floorId, n, scene, shown, stale, part }
    let batchNo = 0, current = null
    const know = items => { for (const part of parts.know(items)) { const b = batches.get(part); if (b) b.stale = true } }
    const partLabel = part => parts.label(part)
    const batchFor = item => {
        const unit = item.asset?.unit ?? 'm', key = itemKey(item)
        // one the library's list has not brought yet: added, not the whole list, or the rest would be forgotten
        if (!parts.has(key)) { for (const p of parts.add([item])) { const b = batches.get(p); if (b) b.stale = true } }
        const part = parts.partOf(key)
        let b = batches.get(part)
        if (b && !b.stale && b.entries.has(key)) return b
        b = studioBatch(parts.members(part), unit, ++batchNo)
        syncSources(b.doc)                // a light given by flux gets its luminance, as the builder's build() does
        b.scene = generate(...Model.generateArgs(b.doc, { id: `studio-${unit}-${b.n}`, title: `studio (${unit})` }))
        b.shown = null; b.part = part
        batches.set(part, b)
        return b
    }
    /* THE COMPILE, told on: the renderer's count of pipelines ready (RT.onCompile), with which part it is */
    let compiling = null
    const compileFns = new Set()
    RT.onCompile(p => { if (compiling) for (const f of compileFns) { try { f(p.end ? null : { ...p, label: compiling }) } catch { } } })
    const show = async item => {
        const b = batchFor(item)
        const e = b.entries.get(itemKey(item))
        if (e?.failed) throw new Error(`this item cannot be shown with its neighbours: ${e.failed}`)
        if (current !== b) {
            /* A PART THAT DID NOT COMPILE is not compiled again for each of its items -- seconds each, the view paused
               for every one -- until it is made again (an item added or changed: batchFor, stale), when it may */
            if (b.failed) throw b.failed
            /* THE ONE SLOW STEP, said so: a compile of every item of the unit at once -- seconds, where each
               picture after it is a fraction of one */
            compiling = `library pictures, ${partLabel(b.part)}`
            tell(`Preparing the pictures: compiling ${partLabel(b.part)} (${b.entries.size} items). Once; its pictures come quickly after.`)
            try { await RT.setScene(b.scene) }
            catch (e) {
                b.failed = new Error(`${partLabel(b.part)} does not compile (an item's code, or its material's): ${e?.message ?? e}`)
                throw b.failed
            } finally { tell(''); compiling = null }
            current = b; b.shown = null
        }
        const vis = {}
        if (b.shown && b.shown !== e.id) vis[visName(b.shown)] = 0
        vis[visName(e.id)] = 1
        const floor = Model.find(b.doc, b.floorId).node
        let box = e.box ?? null
        if (!box && e.measure) {
            // the floor out of the way first: a point near both would be counted the floor's
            floor.transform.pos.z = e.estimate.lo[2] - 1e3 * Math.max(1e-6, e.estimate.hi[2] - e.estimate.lo[2])
            RT.set({ ...vis, [xfName(b.floorId)]: Model.matrixOf(floor.transform) })
            try {
                // the sampler's view of the document: this item alone (the rest are hidden, the floor far below)
                const view = { ...b.doc, root: { ...b.doc.root, children: [Model.find(b.doc, e.id).node] } }
                const B = createBoxes({ sample: input => RT.sampleTags(input), doc: () => view, ready: () => true })
                await B.update()
                const c = B.corners(view, e.id)
                if (c) box = { lo: [0, 1, 2].map(k => Math.min(...c.map(p => p[k]))), hi: [0, 1, 2].map(k => Math.max(...c.map(p => p[k]))) }
            } catch (err) { console.warn('[studio] measuring:', err?.message ?? err) }
        }
        box ??= e.estimate
        e.box = box                       // measured once per scene
        const size = Math.max(1e-6, ...[0, 1, 2].map(k => box.hi[k] - box.lo[k]))
        /* THE TOLERANCE THIS ITEM'S OWN: the automatic one is a share of the compiled scene's size, and a part
           holds a metre floor and eight items -- about 3.5 m, so 0.35 mm, and an offset of 3.5 mm off a 25 mm
           sample. The item's own box sets it (eps is a live setting, in metres, photometry.js autoEps). */
        RT.set({ eps: autoEps(Math.hypot(box.hi[0] - box.lo[0], box.hi[1] - box.lo[1], box.hi[2] - box.lo[2]), b.unit) })
        const h = size * 0.02
        /* a hair below the item, not at it: a flat light's face on the floor's top was the floor's grey, or
           flickered between the two -- two surfaces in one place */
        floor.transform.pos.z = box.lo[2] - size * 0.004 - h / 2
        RT.set({ ...vis, [xfName(b.floorId)]: Model.matrixOf(floor.transform),
                 [uniformName(b.floorId, 'radius')]: size * 40, [uniformName(b.floorId, 'height')]: h })
        b.shown = e.id
        return framing(box.lo, box.hi)
    }
    /* the sun turns with the camera, so the light stays at the camera's left as the item is turned */
    const aim = (view, { azimuth = STUDIO.azimuth, elevation = STUDIO.elevation, zoom = 1 } = {}) => {
        RT.set({ uSunAzimuth: sunAzimuthFor(azimuth) })
        // a pinhole: a thumbnail is sharp all through (the lens, 0.43.0, is the page camera's, and this one has its own)
        RT.applySettings({ camera: { mode: 'orbit', camtype: 0, fov: STUDIO.fov, target: view.target, azimuth, elevation, distance: view.distance * zoom,
                                     aperture: 0, focus: 0 } })
    }

    const S = {
        RT,
        /** Tell it the items there are, so a unit's scene holds them all and is compiled once: the library's
         *  list, and again when it changes (an added item makes its unit's scene stale). */
        know,
        /** Be told what it is waiting on, as a line for the user ('' when nothing): its scene compiling. */
        onStatus(fn) { statusFns.add(fn); return () => statusFns.delete(fn) },
        /** Be told how far a part's compile has got: fn({ label, done, total }), fn(null) when it is over --
         *  what a status bar's progress takes (lib/shell progress). */
        onCompile(fn) { compileFns.add(fn); return () => compileFns.delete(fn) },
        /** The item's picture as a PNG Blob. */
        render: item => hold(async () => {
            const view = await show(item)
            aim(view)
            await RT.beginOffscreen({ width: size, height: size })
            try {
                // one sample in flight: the next recorded while the GPU runs this one (lib/pathtracer/samples.js)
                await RT.renderFrame(samples, null, null, { inFlight: 2 })
                const c = await RT.grabFrame()
                return await c.convertToBlob({ type: 'image/png' })
            } finally { await RT.endOffscreen() }
        }),
        /** Draw the item live in `el` until the returned stop() is called: it converges while it is looked
         *  at; a click and it turns as the pointer moves over it (azimuth, elevation), a click stops that;
         *  the wheel zooms. A double-click is the panel's (it puts the item in). */
        live(item, el) {
            let on = true
            const cv = document.createElement('canvas'); cv.width = cv.height = size
            cv.className = 'shell-lib-live'
            const g = cv.getContext('2d')
            const A = { azimuth: STUDIO.azimuth, elevation: STUDIO.elevation, zoom: 1 }
            let view = null, last = null
            const reaim = () => { if (view) aim(view, A) }
            /* TURNED BY HOVERING, AFTER A CLICK: a press and drag on a tile is the library's drag into the
               scene (library/panel.js), so turning cannot be a drag as well (the user, 2026-09-28). A click
               starts turning -- the pointer's moves over the picture turn it, no button held -- and a second
               click stops it; the wheel zooms either way. `turning` on the canvas tells the panel. */
            let turning = false
            cv.addEventListener('click', () => { turning = !turning; last = null; cv.classList.toggle('turning', turning) })
            cv.addEventListener('pointermove', e => {
                if (!turning) return
                if (last) {
                    A.azimuth -= (e.clientX - last[0]) * 0.8
                    A.elevation = Math.max(-85, Math.min(85, A.elevation + (e.clientY - last[1]) * 0.8))
                    reaim()
                }
                last = [e.clientX, e.clientY]
            })
            cv.addEventListener('pointerleave', () => { last = null })
            cv.addEventListener('wheel', e => { e.preventDefault(); A.zoom = Math.max(0.3, Math.min(4, A.zoom * Math.exp(e.deltaY * 0.001))); reaim() }, { passive: false })
            hold(async () => {
                if (!on) return
                view = await show(item)
                if (!on) return
                reaim()
                await RT.beginOffscreen({ width: size, height: size })
                try {
                    el.appendChild(cv)
                    /* DRAWN ON SAMPLES 1, 2, 3, 4, THEN EVERY OTHER ONE (6, 8, ...), as when this rendered one
                       sample a call: a readback each frame is most of the cost at this size. The pairs between
                       draws go as one call with the second sample in flight (lib/pathtracer/samples.js), which a
                       sample a call could not do. A stop is seen between calls, so after one it can take up to
                       the two samples of a pair to give the view back, where it was one. */
                    let n = 0
                    while (on) {
                        const k = n < 4 ? 1 : 2
                        await RT.renderFrame(k, null, null, { inFlight: 2 })
                        n += k
                        g.drawImage(await RT.grabFrame(), 0, 0)
                    }
                } finally { await RT.endOffscreen(); cv.remove() }
            }).catch(e => console.warn('[studio] live:', e?.message ?? e))
            return () => { on = false }
        },
        /** GIVE THE VIEW BACK NOW: the user is working in it again. The studio's current picture goes on beside
         *  it (the background queue waits for the view to be left alone before it starts another). */
        releaseView: () => gate.release(),
        /** Whether a picture or a live view is being made now. */
        get busy() { return busyCount > 0 },
    }
    let busyCount = 0
    const wrap = f => (...a) => { busyCount++; const p = f(...a); Promise.resolve(p).finally(() => busyCount--); return p }
    S.render = wrap(S.render)
    return S
}
