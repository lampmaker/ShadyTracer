//======================================================================================================================
// PANEL -- the properties of whatever is selected in the builder's tree.
//
// ONE EDITOR PER VALUE. A node's parameters used to arrive on the Scene page as well, as
// generic scene-uniform sliders -- which wrote the uniform and never the document, so a scene
// tuned there and then saved came back as it was before. codegen no longer gives builder
// parameters a `gui`, and this panel is the one place they are edited: the document first,
// then the renderer.
//
// TWO KINDS OF EDIT, and the difference is the same one the renderer draws between a uniform
// and a constant:
//   LIVE        a parameter value. It is a uniform (codegen names it p_id), so BUILDER.live
//               pokes it and the next frame uses it -- no compile.
//   STRUCTURAL  an object's material, a material's code, the enable toggle. The shader text changes, so it
//               goes through apply(): probe compile, then setScene.
//   and a label is neither -- it only redraws the tree.
//
// LOCKED ROWS (model.js lockOf, setLock): "lock position" and "lock parameters" sit above the position, and a row a lock
// holds is drawn disabled, a vector without the + that opens its sliders -- so it shows its number and nothing here
// moves it. Its definition (the pencil, the cross, the +) and the code stay editable: a lock is against the slip of a
// hand on a value, and those are deliberate.
//
// THE SAME VALUES ARE PARAMETERS (builder/params.js, lib/shell/params.js): the timeline, a script,
// the command palette reach them by path. What happens after a value changes is makeAfter's, for
// this panel and those alike, so an edit here and an edit from a timeline cannot differ. Each row
// tells the registry when it changed a value, so everything else that shows it follows. It does NOT
// show the path: a tooltip on every row was too much for something wanted now and then (the user);
// the Parameters panel copies it on a right-click.
//======================================================================================================================

/**
 * @param table     a PropertyTable (the Builder page's) to put a folder in
 * @param BUILDER   installBuilder's object
 * @param onLabel   () => void -- a label changed; redraw the tree
 * @param onStructure () => void -- the shader changed; re-apply if the builder scene is showing
 * @param onApply   () => void -- compile and show the builder scene now (the code editor's apply)
 * @param params    the parameter registry (lib/shell/params.js), optional: told of each edit made here
 * @param environment () => the renderer's settings now (RT.get) -- what a scene without an environment of
 *                  its own shows, and takes with it when first edited (model.js ENVIRONMENT)
 */
import { openParamDialog } from './paramdialog.js'
import { sourceTable } from './sources.js'
import { shapesOf, isCsg } from './codegen.js'
import { recipeOf, parseRecipe, applyRecipe } from './recipe.js'
import { RAYFILES, rayBox } from '../optics/rayfiles.js'
import { UNITS } from '../lib/pathtracer/core/photometry.js'
import { exportGrid, gridProblem, EXPORT_DEFAULTS } from './exportbox.js'
import { visibilityOf, HAZE_G_MAX } from './hazebox.js'
import { makeAfter } from './params.js'
import { codeOnly } from './codegen.js'
const EXPORT_CELL = EXPORT_DEFAULTS.cell

/** WHAT EACH ENVIRONMENT SETTING DOES (model.js ENVIRONMENT, the renderer's Lighting schema), said on its row. Every key
 *  has one (test/panel.check.mjs): a setting added to the schema with none fails there. Numbers are typical values, not
 *  measurements of this renderer. */
export const ENVIRONMENT_HELP = {
    envMode: 'What surrounds the scene. Sun & sky: daylight, a sun you can move and the sky it lights. Studio: an even light '
        + 'from every direction, brighter above, with no sun and no shadows to speak of -- for showing an object as it is.',
    studioIlluminance: 'How much light the studio gives, in lux on a level surface facing up. An office is about 500 lx, '
        + 'an overcast day outdoors 10 000.',
    studioColor: 'The studio light\'s colour. Only its hue counts: the brightness is the lux above, whatever colour is chosen.',
    studioTop: 'How much more light comes from above than from the horizon: 0 the same from every direction, 1 twice as much '
        + 'straight up as at the horizon, and none from straight below.',
    sunIlluminance: 'The sun\'s light in lux on a surface facing it. A clear day\'s noon sun is about 100 000 lx.',
    sunDiameter: 'How big the sun looks, in degrees: 0.53 is the real sun. Larger gives softer shadow edges, as a hazy sun does.',
    skyIlluminance: 'The sky\'s own light, without the sun, in lux on a level surface: about 15 000 on a clear day, more under '
        + 'thin cloud. It lights the shadows.',
    uSunAzimuth: 'Which way the sun is, as a compass bearing in degrees: 0 towards the scene\'s +y, 90 towards +x, -90 '
        + 'towards -x.',
    uSunElevation: 'How high the sun is, in degrees above the horizon: 90 overhead, 0 on the horizon, below 0 it has set.',
    // the sun's own colour is fixed (sdf.js sunRadiance, SUN_TINT): only the sky's scattering reads this
    uSkyTurbidity: 'Haze in the sky: 0 the clearest; higher scatters more, for a hazier, paler sky. The sun\'s own colour does not change.',
}

export function installBuilderPanel(table, BUILDER, { onLabel = () => { }, onStructure = () => { }, onApply = () => { }, params = null,
                                                      environment = () => ({}), itemSample = null } = {}) {
    const M = BUILDER.model
    let folder = null, shownId = null

    /* A BINDING WHOSE CHANGE REACHES US FROM EVERY CONTROL IT HAS. PropertyTable gives a vec3
       a '+' that opens per-component sliders, and those report through binding._onChange --
       which only its own bindControls() sets. A plain addBinding().on('change') never sees
       them: the sliders moved the value in the document and nothing told the renderer, so
       dragging them did nothing on screen while the text field worked. Setting _onChange
       here, before PropertyTable's zero-timeout reads it, closes that; the refresh makes the
       vec3's own text follow the popup. */
    /* EVERY EDIT IS AN UNDO STEP, keyed by the control that made it: a drag on one slider, or
       a burst of typing in one field, coalesces into one step (history.js). */
    const A = makeAfter({ live: (id, k) => BUILDER.live(id, k), commit: key => BUILDER.commit?.(key), structure: () => onStructure(),
                          syncSources: () => BUILDER.syncSources?.(), onLabel: () => onLabel() })
    const live = (id, k) => A.live(id, k)
    const edited = key => BUILDER.commit?.(key)
    /* A ROW AS A PARAMETER: the registry told when it changed a value. The path is builder/params.js's
       spelling; a row with no entry there (a label, a choice) says nothing. */
    const said = path => { try { params?.changed(path, 'panel') } catch { } }
    /** A row's tooltip, on its label: what it is and what it does (the user, 2026-10-10: the scene's properties "make
     *  sure it has tooltips & explanations"). */
    const rowTip = (b, text) => { const l = b?.element?.querySelector?.('.tp-lblv_l'); if (l) l.title = text; return b }

    /* A NUMBER STAYS A NUMBER. Tweakpane's number field evaluates what is typed, and 0/0 is NaN; a NaN then made the
       field's own range NaN (propertytable.js widens a range to hold the value), so nothing typed after could put it
       right, and Tweakpane cannot draw one with no step -- the panel stopped at that row (the user, 2026-10-02). A
       change that is not a finite number is put back to the last one that was. */
    const keepFinite = (obj, key, b, last) => {
        if (typeof obj[key] !== 'number' || Number.isFinite(obj[key])) return false
        obj[key] = Number.isFinite(last) ? last : 0
        try { b.refresh() } catch { }
        return true
    }
    const bind = (folder, obj, key, opts, handler, path) => {
        const b = folder.addBinding(obj, key, opts)
        let last = obj[key]
        const h = ev => { if (keepFinite(obj, key, b, last)) return; last = obj[key]; handler(ev); if (path) said(path) }
        b._onChange = ev => { h(ev); try { b.refresh() } catch { } }
        b.on('change', h)
        if (path) flagRow(b, path)
        return b
    }

    /* ANIMATED (model.js setAnimated; the user, 2026-10-08): a ◇ before a value's name flags it as one to animate, ◆
       unflags it. A flagged value stays a uniform in the bake, so a timeline playing it keeps the baked scene shown;
       the scene's row lists the flagged values first, and the Parameters panel and the timeline's + track offer only
       those while any are. Offered where the registry has the value as LIVE (builder/params.js) -- not a compile-time
       one, nor one bound to its component's parameters (the registry has neither): there is no uniform to keep. One
       undo step; the tree is redrawn for its mark. The registry's entries are read once per panel drawn. */
    let entries = null
    const entryOf = path => {
        if (!entries) { entries = new Map(); try { for (const e of params?.list?.('scene') || []) entries.set(e.path, e) } catch { } }
        return entries.get(path)
    }
    const FLAG_TIP = {
        on: 'Animated: kept a uniform when the scene is baked, listed first on the scene row, and offered alone by the timeline\'s + track. Click to unflag.',
        off: 'Flag as animated: kept a uniform when the scene is baked, so a timeline moving it does not leave the bake',
    }
    const flagIcon = (path, onToggle = () => { }) => {
        const doc = BUILDER.doc
        const on = M.isAnimated(doc, path)
        const transform = /\/transform\//.test(path) ? '\nPosition, rotation and scale are one uniform: all three stay live.' : ''
        const i = icon(on ? '\u25C6' : '\u25C7', (on ? FLAG_TIP.on : FLAG_TIP.off) + transform, el => {
            const now = !M.isAnimated(BUILDER.doc, path)
            try { M.setAnimated(BUILDER.doc, path, now) } catch (e) { console.warn('[panel]', e.message); return }
            edited(null)
            onLabel()
            el.textContent = now ? '\u25C6' : '\u25C7'
            el.title = (now ? FLAG_TIP.on : FLAG_TIP.off) + transform
            el.style.opacity = now ? '1' : '0.55'
            onToggle(now)
        })
        Object.assign(i.style, { marginLeft: '0', marginRight: '4px' })
        if (on) { i.style.opacity = '1'; i.onmouseleave = () => { i.style.opacity = M.isAnimated(BUILDER.doc, path) ? '1' : '0.55' } }
        else i.onmouseleave = () => { i.style.opacity = M.isAnimated(BUILDER.doc, path) ? '1' : '0.55' }
        i.className = 'builder-animate'
        return i
    }
    /* THE SCENE'S ANIMATED VALUES, at the top of the scene's row (the user, 2026-10-08: "these appear at the top of the
       scene in a list of adjustable properties"): each flagged value's control, through its registry entry -- so a
       change here is what the same change anywhere else is (makeAfter: the uniform, the undo step) -- with ⌖ to show
       where it lives and ◆ to unflag it. A vector is its numbers, x y z (a colour's r g b among them). A flag that
       names nothing any more (a node removed by hand from a file), or a value that is no longer live (made
       compile-time: model.js drops the flag then, a file may not), is listed so, to be unflagged. */
    function animatedFolder(parent, doc) {
        const paths = M.animatedPaths(doc)
        if (!paths.length) return
        const af = parent.addFolder({ title: `animated · ${paths.length}` })
        { const t = af.element?.querySelector?.('.tp-fldv_t'); if (t) t.title = 'The values marked animated (◆), wherever they are in the scene: each stays a live value in the baked scene, so the Timeline can move it without a compile' }
        const redraw = () => { const at = shownId; setTimeout(() => { if (shownId === at) show(at) }) }
        const XYZ = ['x', 'y', 'z', 'w']
        for (const path of paths) {
            const e = entryOf(path)
            let b
            if (!e || e.kind === 'structural') {
                b = af.addBinding({ v: e ? `${e.label}: compile-time now` : `${path}: not in the scene` }, 'v', { readonly: true, label: '' })
            } else {
                const dims = e.dims | 0 || 1
                const r = dims === 1 && !e.options ? fitRange({ min: e.min, max: e.max }, e.get()) : e
                const opts = { label: String(e.label ?? path), ...(e.options ? { options: e.options } : {}),
                               ...(dims === 1 && r.min != null ? { min: r.min } : {}), ...(dims === 1 && r.max != null ? { max: r.max } : {}),
                               ...(dims === 1 && e.step != null ? { step: e.step } : {}),
                               // no range: open, as typedOpts says why (a range of PropertyTable's own clamps a negative to 0)
                               ...(dims === 1 && !e.options && e.min == null && e.max == null ? { min: -Infinity } : {}) }
                const H = dims === 1
                    ? { get v() { return e.get() }, set v(x) { e.set(x); said(path) } }
                    : { v: Object.fromEntries(e.get().map((x, i) => [XYZ[i], x])) }
                b = af.addBinding(H, 'v', opts)
                if (dims > 1) b.on('change', () => { e.set(XYZ.slice(0, dims).map(c => +H.v[c])); said(path) })
                { const l = b.element.querySelector('.tp-lblv_l'); if (l) l.title = `${e.label}${e.unit ? ` (${e.unit})` : ''}${e.help ? '\n' + e.help : ''}\nAnimated: kept live in the baked scene, for the Timeline to move` }
            }
            const label = b.element.querySelector('.tp-lblv_l')
            if (!label) continue
            label.prepend(flagIcon(path, on => { if (!on) redraw() }))
            if (!label.title) label.title = `${path}: flagged animated, but no live value carries it here -- a compile moves it`
            if (e?.reveal) label.appendChild(icon('\u2316', 'Show where this is set', () => { try { e.reveal() } catch (x) { console.warn('[panel]', x.message) } }))
        }
    }
    function flagRow(b, path) {
        const e = entryOf(path)
        if (!e || e.kind === 'structural') return
        const label = b?.element?.querySelector?.('.tp-lblv_l')
        if (label) label.prepend(flagIcon(path))
    }

    /* A PATH'S VERDICT FOLLOWS ITS NODE'S PARAMETERS: a slider on `rise` can make a path that names it unsound (it then
       draws nothing), so each path editor's check runs again when one of its node's values changes here */
    const rechecks = new Map()          // node id -> [check]
    const recheck = id => { for (const f of rechecks.get(id) || []) try { f() } catch { } }
    /* A SLIDER DRAGGED WHILE THE PANEL IS REDRAWN went on following the mouse -- Tweakpane listens on the document --
       on its element, detached and 0 wide, and wrote NaN into the document (measured headless: 0.33 became NaN). So a
       redraw ends a drag begun in the panel first, with the mouse released where the pointer is: released at (0, 0)
       it set the slider to its minimum. */
    const doc0 = table.container?.ownerDocument ?? globalThis.document
    let pointer = { x: 0, y: 0 }, dragIn = false
    doc0?.addEventListener('mousemove', e => { pointer = { x: e.clientX, y: e.clientY } }, true)
    doc0?.addEventListener('mousedown', e => { dragIn = !!folder?.element?.contains(e.target) }, true)
    doc0?.addEventListener('mouseup', () => { dragIn = false }, true)
    const endDrag = () => {
        if (!dragIn) return
        dragIn = false
        try { doc0.dispatchEvent(new MouseEvent('mouseup', { clientX: pointer.x, clientY: pointer.y, bubbles: true })) } catch { }
    }
    const clear = () => { endDrag(); try { folder?.dispose() } catch { } folder = null; rechecks.clear(); entries = null }

    /* WHAT A MATERIAL ITEM IS SHOWN ON, while it is edited (library/edit.js): one of the studio's sample
       shapes at one of its sizes, or "its own" once changed by hand. The host hands the hook in --
       { choices, sizes, of(doc) -> { shape, size } | 'own' | null, set(doc, shape, size) } -- because the
       shapes are the library's, and the builder does not import it. Structural (a different shape is a
       different shader) and one undo step; saved as the item's preview. Choosing one keeps the other; the
       size is offered only for one of the shapes (pick a shape first, for a sample of its own). */
    const sampleRow = (folder, doc) => {
        if (!itemSample || doc.libraryItem?.kind !== 'material') return
        const now = itemSample.of(doc)
        const std = now && typeof now === 'object' ? now : null
        const opts = Object.fromEntries(itemSample.choices.map(k => [k, k]))
        if (now === 'own') opts['its own'] = 'own'
        if (now == null) opts['(none)'] = ''
        /* the size as TEXT: a number binding with options is still a number to PropertyTable, which gives one
           with no range of its own a maximum of max(value, 100) -- 200 was clamped, snapped back to 50, and
           no change was ever reported */
        const S = { sample: std?.shape ?? (now === 'own' ? 'own' : ''), size: String(std?.size ?? itemSample.sizes[0]) }
        const pick = (shape, size) => {
            const id = shownId
            try { itemSample.set(doc, shape, size) } catch (e) { console.warn('[builder] sample:', e.message); return }
            edited(null)
            onLabel(); onStructure()
            // after this change event has finished: the binding that fired it is disposed
            setTimeout(() => { if (shownId === id) show(id) })
        }
        const tip = (b, text) => { const l = b.element.querySelector('.tp-lblv_l'); if (l) l.title = text }
        const b = folder.addBinding(S, 'sample', { label: 'sample', options: opts })
        tip(b, 'The shape the material is shown on, here and in its picture -- real size, in mm')
        b.on('change', ev => { if (itemSample.choices.includes(ev.value)) pick(ev.value, +S.size) })
        if (!std) return
        const z = folder.addBinding(S, 'size', { label: 'sample size',
            options: Object.fromEntries(itemSample.sizes.map(v => [`${v} mm`, String(v)])) })
        tip(z, 'How big it is: a pattern that is large in life -- marble\'s veins, concrete\'s stains -- shows on the larger one')
        z.on('change', ev => pick(std.shape, +ev.value))
    }

    const show = id => {
        clear()
        shownId = id ?? null
        if (shownId == null) return
        const doc = BUILDER.doc
        // the environment is the scene's since 0.52.0: its old id (a parameter revealed, a saved selection) shows the scene
        if (shownId === M.ENVIRONMENT_ID) shownId = doc.root.id
        const mat = M.material(doc, shownId)
        const found = mat ? null : M.find(doc, shownId)
        if (!mat && !found) return
        const node = mat || found.node

        const title = mat ? 'Material' : node.id === doc.root.id ? 'Scene'
            : node.kind === 'group' ? 'Group' : 'Object'
        // the kind, not the id: the id is internal, and the label -- the name -- is the first row
        folder = table.addFolder({ title })
        if (node.id === doc.root.id) {
            const t = folder.element?.querySelector?.('.tp-fldv_t')
            if (t) t.title = 'The scene\'s own settings: its name, its unit and how far it reaches, what lights it from outside, and '
                + 'what every object and material in it can call'
        }

        // ---- label: redraws the tree, nothing else
        const L = { label: node.label }
        rowTip(folder.addBinding(L, 'label', { label: 'label' }), node.id === doc.root.id
            ? 'The scene\'s name: the tree\'s top row, File \u203a Switch to scene, and the file it saves as'
            : 'Its name in the tree. Only a name: nothing refers to it, so it can be anything').on('change', ev => {
            M.rename(doc, node.id, ev.value)
            if (node.id === doc.root.id) doc.title = ev.value
            edited(`${node.id}.label`)
            onLabel()
        })

        // ---- how it joins the others in its group (model version 14): right under the name
        if (!mat) joinControls(folder, doc, node, found.parent)

        if (mat) {
            // the item being edited is this material: what it is shown on, first
            if (mat.id === doc.libraryItem?.subject) sampleRow(folder, doc)
            /* EVERY FIELD IS LIVE: each is a uniform (codegen, <field>_<id>), so a colour or a
               roughness changes the next frame without a compile. Only the code is structural,
               and it applies on request like a code node's. */
            /* ---- ITS TYPE (model version 11), and then only the settings that type uses
               (materials.js FIELDS_OF): a surface has no emission, a glowing surface (emitter) is its emission alone,
               a detector is a surface the optics trace stops on and records, a ray limiter is
               invisible and stops it too -- to cut the rays off where a cross-section is wanted.
               Structural: the shader assigns only the type's fields, and the optics kernels are
               built knowing the detectors. The panel is rebuilt so the list follows the type. */
            const Ty = { type: M.typeOf(mat) }
            const tyB = folder.addBinding(Ty, 'type', { label: 'type', options: {
                'surface': 'surface', 'glowing': 'emitter', 'detector': 'detector', 'ray limiter': 'limiter' } })
            // the long explanations were the option names; they are the tooltip now
            const tyL = tyB.element.querySelector('.tp-lblv_l')
            if (tyL) tyL.title = 'glowing: emits light\ndetector: the optics trace stops on it and records the rays\nray limiter: a detector the picture does not show'
            tyB.on('change', ev => {
                M.setMaterialType(doc, mat.id, ev.value)
                edited(null)
                onStructure()
                // after this change event has finished: the binding that fired it is disposed
                setTimeout(() => { if (shownId === mat.id) show(mat.id) })
            })
            const all = M.MATERIAL_FIELDS_OF[M.typeOf(mat)] || []
            // the coating's fields in a folder of their own, below (coatingFolder)
            const fields = all.filter(k => k !== 'coating' && !M.MATERIAL_FIELDS[k].coat)
            if (fields.length) {
                for (const k of fields)
                    bind(folder, mat.params, k, { label: M.MATERIAL_FIELD_LABELS[k] ?? k, ...(M.MATERIAL_FIELDS[k].gui || {}) }, () => live(mat.id, k), `scene/${mat.id}/${k}`)
            }
            if (all.includes('coating')) coatingFolder(folder, mat)
            if (M.typeOf(mat) === 'limiter') return          // nothing of it is drawn: no code either
            // and its own, for its code to read: added, edited and deleted like a code node's
            paramsFolder(folder, mat, M.customParams(mat), {}, true)
            // an empty block shows how to use one; comments alone compile to nothing
            if (!String(mat.code || '').trim()) mat.code = M.MATERIAL_CODE_TEMPLATE
            codeEditor(folder, mat, { kind: 'material', title: 'material code', names: 'm, p, n, C, p_local, R_local, S_local, and its parameters' })
            // its relief LAST (the user, 2026-09-30): the shape it gives, after what the surface is
            reliefFolder(folder, doc, mat)
            return
        }
        if (node.kind === 'group') {
            if (node.id !== doc.root.id) {
                groupBlend(folder, node)
                recipeEditor(folder, doc, node)
                transform(folder, node)
                copiesFolder(folder, doc, node)
                /* DOES THE MATERIAL FOLLOW THE WARP (model.js setStraightMaterial; the user, 2026-09-30: a print's
                   layers twisted with its shape): for a group whose code can bend space. Structural -- it changes
                   what the shader reads -- and one undo step. */
                if (M.groupHasCode(doc, node)) {
                    const S = { follows: !node.straightMaterial }
                    const b = folder.addBinding(S, 'follows', { label: 'material follows the warp' })
                    const l = b.element.querySelector('.tp-lblv_l')
                    if (l) l.title = 'Unchecked: the materials of everything in this group -- their colour code and their relief -- are laid out'
                        + ' as if it, and every group inside it, had not bent space. The shape still bends: a print\'s layers stay level on a'
                        + ' twisted shape, wood stays put as the shape moves through it.'
                    b.on('change', ev => { M.setStraightMaterial(doc, node.id, !ev.value); edited(null); onStructure() })
                }
                /* ITS CODE, AND PARAMETERS FOR IT: added and edited like a code node's. The editor
                   shows the template while there is no code, through a holder -- writing the
                   template into the group would put a block of comments into every group anyone
                   ever clicked, and into the saved file with it. */
                /* ITS BLOCK (model.js version 16): the code and the parameters' schema, which every group using it shares --
                   so the parameters are read through the node's view, and the code written to the block (setCode: a
                   built-in modifier's is copied for this group first, a group without code gets a block of its own) */
                if (node.block) blockRow(folder, doc, node)
                paramsFolder(folder, M.viewOf(doc, node), Object.keys(node.params || {}), {}, true)
                bindFolder(folder, doc, node)
                const holder = { id: node.id,
                    get code() { const c = M.codeOf(doc, node); return String(c || '').trim() ? c : M.GROUP_CODE_TEMPLATE },
                    set code(v) { M.setCode(doc, node.id, v) } }
                const sharers = () => { const b = M.blockOf(doc, node); return b ? M.usersOf(doc, b.id).map(n => n.id) : [] }
                codeEditor(folder, holder, { kind: 'group', title: 'group code', names: 'C = children(C, p) calls what is in it; p, C, r, and its parameters', same: sharers })
            } else {
                // the values flagged as animated, first: what a timeline moves, in one place
                animatedFolder(folder, doc)
                /* A LIBRARY ITEM BEING EDITED (library/edit.js): its name is the label above; what the library
                   lists and finds it by is here -- its category, its tags, its help (the tooltip). Kept in the
                   scene until it is saved, and each an undo step, as any edit. */
                const li = doc.libraryItem
                if (li?.details) {
                    const D = li.details
                    const H = {
                        get category() { return D.category ?? '' }, set category(v) { D.category = v },
                        get tags() { return (D.tags || []).join(', ') }, set tags(v) { D.tags = String(v).split(',').map(t => t.trim()).filter(Boolean) },
                        get help() { return D.help ?? '' }, set help(v) { D.help = v },
                    }
                    const tips = { category: 'The library lists it under this', tags: 'Separated by commas: the tag row finds it by them',
                                   help: 'Its tooltip in the library' }
                    for (const k of ['category', 'tags', 'help']) {
                        const b = folder.addBinding(H, k, { label: k })
                        b.on('change', () => edited(`libraryItem.${k}`))
                        const l = b.element.querySelector('.tp-lblv_l')
                        if (l) l.title = tips[k]
                    }
                    sampleRow(folder, doc)
                }
                /* THE SCENE'S UNIT. Every number in the scene is in it -- radius 1 is a metre,
                   a centimetre or a millimetre -- and changing it REINTERPRETS those numbers
                   rather than converting them, so the scene shrinks or grows by the factor.
                   Structural, because it reaches the renderer with the scene object (codegen's
                   `unit`), which is where the march epsilon and the surface offsets are
                   rescaled from. Light does not change: radiance has no length in it. */
                const U = { unit: BUILDER.doc.unit ?? 'm' }
                rowTip(folder.addBinding(U, 'unit', { label: 'unit',
                    options: Object.fromEntries(Object.keys(M.UNITS).map(u => [u, u])) }),
                    'What 1 means in every length of this scene: a metre, a centimetre or a millimetre. Changing it does not '
                    + 'convert: a sphere of radius 1 stays 1, so the whole scene grows or shrinks by the factor. Light needs no '
                    + 'change -- a luminance has no length in it. A material\'s own lengths are real mm whatever this is. A compile.')
                    .on('change', ev => {
                        BUILDER.doc.unit = ev.value; edited(null); onStructure()
                        // the radius row's label says the unit (and a default radius is 400 m said in it)
                        setTimeout(() => { if (shownId === node.id) show(shownId) })
                    })
                /* THE SCENE'S RADIUS (model.js envRadius, version 15): where it stops and the sky begins -- in
                   the Environment folder until 0.9.0, as a renderer setting in metres; the user wanted it here,
                   with the unit it is in. Live: the renderer reads it off the scene object (RT.updateScene), so a
                   drag shows at once and compiles nothing; one undo step per drag (makeAfter live). A number
                   field, not a slider: from a 25 cm optic to a 400 m street, no one range fits. */
                const R = { get radius() { return M.envRadiusOf(BUILDER.doc) },
                            // what the model refuses (0, NaN typed) is not written; keepFinite puts the field back
                            set radius(v) { if (Number.isFinite(v) && v > 0) M.setEnvRadius(BUILDER.doc, v) } }
                const rb = bind(folder, R, 'radius', { label: `environment radius (${unitName()})`, min: 1e-6 },
                    () => A.live(BUILDER.doc.root.id, 'envRadius'))
                const rl = rb.element?.querySelector?.('.tp-lblv_l')
                if (rl) rl.title = 'Where the scene stops: a ray beyond it sees the sky, and anything placed beyond it is not drawn. In the scene\'s unit.'
                // ...and what it sees there: the sun and sky, or the studio (a row of the tree of its own until 0.52.0)
                environmentFolder(folder, doc)
                /* HIDE WITHOUT RECOMPILING (model.js setLiveVisibility): the eye becomes a uniform
                   written. Changing it recompiles once, so the shader has (or drops) the hidden nodes. */
                const LV = { live: !!BUILDER.doc.liveVisibility }
                rowTip(folder.addBinding(LV, 'live', { label: 'instant hide / show' }),
                    'On: the eye in the tree hides and shows a thing at once, every object staying in the shader behind a '
                    + 'switch -- a little slower to draw. Off: hiding one compiles the scene without it, and it costs nothing '
                    + 'while hidden. Turning this on or off is a compile.')
                    .on('change', ev => { M.setLiveVisibility(BUILDER.doc, ev.value); edited(null); onStructure() })
                /* The scene's functions block, edited through a holder whose `code` IS
                   doc.functions -- so the code editor, its error box and its undo keying work
                   unchanged, with errors reported against the reserved id 'functions'. */
                if (!String(doc.functions || '').trim()) doc.functions = M.FUNCTIONS_TEMPLATE
                const holder = { id: 'functions',
                    get code() { return BUILDER.doc.functions }, set code(v) { BUILDER.doc.functions = v } }
                codeEditor(folder, holder, { kind: 'functions', title: 'functions', names: 'WGSL helpers any code node or material in this scene can call', owner: node.id })
            }
            return
        }

        // ---- a light has no material: its placement, its size, and how it emits
        if (node.type === 'light') {
            transform(folder, node)
            if (M.hasFace(node.light)) paramsFolder(folder, node, Object.keys(node.params || {}), {}, false)
            bindFolder(folder, doc, node)
            lightFolder(folder, node)
            return
        }

        // ---- an export box: where it is, how big, and the export it drives (exportbox.js)
        if (node.type === 'export') {
            transform(folder, node)
            paramsFolder(folder, node, ['size'], {}, false)
            exportFolder(folder, node)
            return
        }
        // ---- a haze box: where it is, how big, and its dust (hazebox.js; the renderer's core/haze.js)
        if (node.type === 'haze') {
            transform(folder, node)
            paramsFolder(folder, node, ['size'], {}, false)
            hazeFolder(folder, node)
            return
        }

        // ---- material: structural
        // not a material: the shader's built-in grey for an object wearing none (model.ensureMaterial says why it was renamed)
        const NONE = '(none: the built-in grey)'
        const opts = { [NONE]: '' }
        for (const m of doc.materials) opts[`${m.label} (${m.id})`] = m.id
        const Mt = { material: node.material ?? '' }
        folder.addBinding(Mt, 'material', { label: 'material', options: opts }).on('change', ev => {
            M.setMaterial(doc, node.id, ev.value || null)
            edited(null)
            onLabel(); onStructure()
        })

        // ---- placement right under the material, then the parameters
        transform(folder, node)

        // ---- parameters: live. Bound to the document's own values, so the document IS what
        //      the slider edits; the renderer is told afterwards.
        /* ITS BLOCK (model.js version 16): its code and its parameters' names, kinds, ranges and constants are the
           block's, shared by every object that uses it -- an edit here reaches them all, as the row above says; a
           built-in (a primitive's) is copied for this object at its first edit, so a sphere edited is that sphere.
           The values are this object's own. */
        blockRow(folder, doc, node)
        paramsFolder(folder, M.viewOf(doc, node), Object.keys(node.params || {}), {}, true)
        bindFolder(folder, doc, node)
        const holder = { id: node.id, get code() { return M.codeOf(doc, node) }, set code(v) { M.setCode(doc, node.id, v) } }
        const sharers = () => { const b = M.blockOf(doc, node); return b ? M.usersOf(doc, b.id).map(n => n.id) : [] }
        codeEditor(folder, holder, { kind: 'object', title: 'code', names: 'p, C, MATERIAL, and its parameters: C = add_new(C, <shape>, MATERIAL)', same: sharers })
    }

    /* AN ARRAY (model.js copies, version 17): the group's children drawn at each of its copies -- one copy of their code
       in the shader however many places. Made a row (n along an axis, a pitch apart), then each copy's place typed, one a
       line: x, y, z, and rx, ry, rz, scale after them for a copy turned or scaled. The same count is live -- a uniform a
       copy, or the records of a scene as data -- and another count a compile in codegen. A plain group's only: one with
       code or joins has none (setCopies says why). One undo step each. */
    function copiesFolder(folder, doc, node) {
        // a block with no code is the group's parameters alone (model.js version 18): an LED strip's count is its own
        if (M.groupHasCode(doc, node) || isCsg(node)) return
        /* MADE BY ITS BINDINGS (copies.count, copies.pitch): said, and nothing here to type -- a resolve makes the row
           again from them, and would undo what was typed */
        const rowBound = Object.keys(node.bind || {}).filter(t => t.startsWith('copies.'))
        if (rowBound.length && node.copies) {
            const cf = folder.addFolder({ title: `copies · ${node.copies.length} · from parameters`, expanded: false })
            cf.addBinding({ note: rowBound.map(t => `${t} = ${node.bind[t]}`).join('\n') }, 'note', { readonly: true, label: 'bound', multiline: true, rows: rowBound.length })
            return
        }
        const cf = folder.addFolder({ title: node.copies ? `copies · ${node.copies.length}` : 'copies (an array)', expanded: !!node.copies })
        const box = document.createElement('div')
        Object.assign(box.style, { font: '12px/1.35 monospace', whiteSpace: 'pre-wrap', padding: '4px 6px', margin: '2px 4px 6px',
            borderRadius: '3px', background: 'rgba(0,0,0,0.25)' })
        box.className = 'builder-copies-said'
        const say = (text, color = '#ff8a80') => { box.textContent = text; box.style.color = color }
        const again = () => { const at = shownId; setTimeout(() => { if (shownId === at) show(at) }) }
        const put = list => {
            const before = node.copies?.length ?? 0
            try { M.setCopies(doc, node.id, list) } catch (e) { say(e.message); return false }
            // the same count: live; another, or none, changes the text (codegen: a uniform a copy)
            if (!(list && list.length === before && BUILDER.live(node.id, 'copies'))) onStructure()
            edited(null)
            again()
            return true
        }
        const R = { n: node.copies?.length ?? 3, pitch: 1, axis: 'x' }
        cf.addBinding(R, 'n', { label: 'count', min: 1, max: M.ARRAY_MAX, step: 1 })
        cf.addBinding(R, 'pitch', { label: `pitch (${unitName()})` })
        cf.addBinding(R, 'axis', { label: 'along', options: { x: 'x', y: 'y', z: 'z' } })
        cf.addButton({ title: node.copies ? 'Make them a row' : 'Make it an array: a row of copies' })
            .on('click', () => put(M.copiesRow(Math.max(1, Math.min(M.ARRAY_MAX, R.n | 0)), +R.pitch || 0, R.axis)))
        if (!node.copies) { cf.element.append(box); return }
        const num = v => +(+v).toPrecision(9)
        const text = t => {
            const more = [t.rot.x, t.rot.y, t.rot.z, t.scale]
            return [t.pos.x, t.pos.y, t.pos.z, ...(more.some((v, i) => i < 3 ? v !== 0 : v !== 1) ? more : [])].map(num).join(', ')
        }
        const draft = { text: node.copies.map(text).join('\n') }
        const b = cf.addBinding(draft, 'text', { label: 'places', multiline: true, lineNumbers: true, rows: Math.max(3, Math.min(17, node.copies.length + 1)) })
        const l = b.element.querySelector('.tp-lblv_l')
        if (l) l.title = `one copy a line: x, y, z in the group's frame (${unitName()}) -- and rx, ry, rz (degrees) and scale after them to turn or scale it. At most ${M.ARRAY_MAX}.`
        b.element.after(box)
        const read = () => {
            const lines = draft.text.split('\n').map(x => x.trim()).filter(Boolean), out = [], bad = []
            lines.forEach((x, i) => {
                const v = x.split(/[\s,]+/).filter(Boolean).map(Number)
                if (!(v.length === 3 || v.length === 7) || !v.every(Number.isFinite)) bad.push(`line ${i + 1}: "${x}" is not x, y, z (or x, y, z, rx, ry, rz, scale)`)
                else out.push({ pos: { x: v[0], y: v[1], z: v[2] }, rot: { x: v[3] ?? 0, y: v[4] ?? 0, z: v[5] ?? 0 }, scale: v[6] ?? 1 })
            })
            return bad.length ? (say(bad.join('\n')), null) : out
        }
        const apply = () => { const list = read(); if (list) put(list) }
        cf.addButton({ title: 'Apply places  (Ctrl+Enter)' }).on('click', apply)
        cf.addButton({ title: 'No copies: a plain group' }).on('click', () => put(null))
        setTimeout(() => {
            const ta = b.element.querySelector('textarea')
            ta?.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); apply() } })
        }, 0)
    }

    /* THE BLOCK A NODE USES (model.js version 16), in one folder: which it is and how many use it -- so it is plain that
       editing the code below edits them all -- its name, another of the scene's blocks to use instead, and a copy
       of its own for this node (a variant: the user, "duplicate the block and edit the new one"). Each structural,
       one undo step, and the panel drawn again a tick later (a control's own event must not dispose it). */
    function blockRow(folder, doc, node) {
        const B = M.blockOf(doc, node)
        if (!B) return
        const users = M.usersOf(doc, B.id).length
        const bf = folder.addFolder({ title: `block: ${B.label}${users > 1 ? ` · ${users} use it` : ''}`, expanded: false })
        const again = () => { edited(null); onStructure(); const at = shownId; setTimeout(() => { if (shownId === at) show(at) }) }
        const note = B.builtin ? `built in (${B.builtin}): read-only -- editing this object's code or parameters gives it a copy of its own`
            : users > 1 ? `shared: editing its code or its parameters changes all ${users} that use it`
            : 'this object\'s alone'
        bf.addBinding({ note }, 'note', { readonly: true, label: '' })
        if (!B.builtin) {
            const H = { get name() { return B.label }, set name(v) { M.renameBlock(doc, B.id, v) } }
            bf.addBinding(H, 'name', { label: 'name' }).on('change', () => { edited(`${B.id}.label`); const at = shownId; setTimeout(() => { if (shownId === at) show(at) }) })
        }
        // another block of the scene's, of its kind: values kept for the parameters both have
        const others = (doc.blocks || []).filter(b => b.kind === B.kind)
        if (others.length > 1) {
            const opts = Object.fromEntries(others.map(b => [`${b.label}${b.builtin ? ' (built in)' : ''} · ${M.usersOf(doc, b.id).length}`, b.id]))
            bf.addBinding({ block: B.id }, 'block', { label: 'use', options: opts }).on('change', ev => {
                if (ev.value === B.id) return
                try { M.useBlock(doc, node.id, ev.value) } catch (e) { console.warn('[builder] use block:', e.message); return }
                again()
            })
        }
        if (users > 1 || B.builtin) bf.addButton({ title: 'Make a copy for this one alone' }).on('click', () => {
            try { M.splitBlock(doc, node.id) } catch (e) { console.warn('[builder] split block:', e.message); return }
            again()
        })
    }

    /* THE SCENE'S ENVIRONMENT (model.js ENVIRONMENT): the renderer's own sun-and-sky settings, by its
       own schema -- the labels, ranges and options its Environment panel had -- but kept in the scene.
       Only the chosen source's settings (gui.showIf); choosing another source redraws the folder. Each
       control writes through a holder, so the change goes where the registry's does (makeAfter).
       A folder of the Scene's since 0.52.0, marked ◆ when one of its values is animated, as its tree row was. */
    function environmentFolder(parent, doc) {
        const animated = (doc.root.animate || []).some(k => String(k).startsWith('environment/'))
        const folder = parent.addFolder({ title: `environment${animated ? '  \u25C6' : ''}` })
        const t = folder.element?.querySelector?.('.tp-fldv_t')
        if (t) t.title = 'What lights the scene from beyond its radius, and what a ray that leaves it sees: the sun and sky, or a '
            + 'studio\'s even light. Kept in the scene\'s file; every value live, never a compile.'
        const base = () => { try { return environment() || {} } catch { return {} } }
        const now = k => doc.environment?.[k] ?? base()[k] ?? M.ENVIRONMENT[k].def
        const mode = now('envMode') | 0
        /* LAMPS ONLY (the renderer's, lib/pathtracer/quality.js): the view is lit by the scene's own lights
           and this environment is set aside -- kept, not changed. Said here, where moving the sun would
           otherwise do nothing visible. environment() is the renderer's whole state (RT.get), so it has it. */
        if ((base().lampsOnly | 0) === 1)
            folder.addBinding({ note: 'Lamps only is on (Render settings): this environment is not lighting the view' }, 'note', { readonly: true, label: '' })
        for (const [k, sp] of Object.entries(M.ENVIRONMENT)) {
            const { showIf, ...gui } = sp.gui
            if (showIf && !Object.entries(showIf).every(([key, vals]) => vals.includes(now(key) | 0))) continue
            const vec = String(sp.type).startsWith('vec3')
            const put = x => {
                if (!A.environment(doc, k, vec ? { r: +x.r, g: +x.g, b: +x.b } : x, {}, base)) return
                said(`scene/environment/${k}`)
                if (k === 'envMode' && (x | 0) !== mode) setTimeout(() => { if (shownId === doc.root.id) show(shownId) })
            }
            /* A COLOUR IS BOUND TO AN OBJECT THAT STAYS, and written on 'change' -- as a light's colour is. Tweakpane sets
               an object colour's r, g and b on the object the binding reads, and never assigns it: through a getter
               that handed out a copy each time, the studio colour was changed on the copy and thrown away, and the row
               went back to white (the user, 2026-10-10). A number is assigned, so its setter is called. */
            const H = vec ? { v: { ...now(k) } } : { get v() { return now(k) }, set v(x) { put(x) } }
            const b = rowTip(folder.addBinding(H, 'v', { ...gui }), ENVIRONMENT_HELP[k])
            if (vec) b.on('change', () => put(H.v))
            flagRow(b, `scene/environment/${k}`)
        }
    }

    /* A LIGHT (model version 10, lights.js): a rectangle, a disc or a Zemax ray file. Its size is its
       parameters (live, like any node's); then how it looks to the camera -- colour, and luminance or
       flux, the other shown as it follows -- and how it emits, which is the optics module's and the
       picture's photons' (read when they run). Both faces and transparency change the shader (what
       its back is), so they re-apply. A ray file shows what its file holds; where its rays start
       becomes its box, so the selection shows where it is. */
    function lightFolder(folder, node) {
        const doc = BUILDER.doc
        const L = M.lightOf(node)
        const set = (patch, how = 'quiet') => {
            if (how === 'structure') {
                try { M.setLight(doc, node.id, patch) } catch (e) { console.warn('[builder]', e.message); return }
                edited(`${node.id}.light`)
                onStructure()
            } else if (!A.light(doc, node, patch)) return
            for (const k of Object.keys(patch)) said(`scene/${node.id}/light/${k}`)
            if (how !== 'quiet') setTimeout(() => { if (shownId === node.id) show(node.id) })
        }
        const f = folder.addFolder({ title: L.shape === 'rayfile' ? 'ray file' : `${L.shape} light` })
        if (L.shape === 'rayfile') {
            const parsed = L.file ? RAYFILES.get(L.file) : null
            if (L.file && !parsed) RAYFILES.restore(L.file).then(p => { if (p && shownId === node.id) show(node.id) })
            const info = { text: !L.file ? 'no file chosen'
                : !parsed ? `${L.file}: not loaded in this browser -- choose it again`
                : [`${L.file}: ${parsed.header.description || '(no description)'}`,
                   `${parsed.header.count.toLocaleString()} rays, ${parsed.total.toPrecision(4)} ${parsed.header.fluxUnit}`
                   + `${parsed.header.fluxUnit === 'W' ? ' (taken as lm)' : ''}, units ${parsed.header.units}`
                   + `${parsed.header.wavelength ? `, ${(parsed.header.wavelength * 1000).toFixed(0)} nm` : ''}`,
                   ...(parsed.header.rotated ? ['the file\'s rotation applied (x, y, z order: unverified)'] : [])].join('\n') }
            f.addBinding(info, 'text', { readonly: true, label: '', multiline: true, rows: 3 })
            f.addButton({ title: 'Choose ray file (.DAT)...' }).on('click', () => {
                const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.dat,.DAT' })
                input.onchange = async () => {
                    const file = input.files?.[0]
                    if (!file) return
                    try {
                        const p = await RAYFILES.load(file)
                        const mpu = UNITS[doc.unit] ?? 1
                        const [lo, hi] = rayBox(p)
                        set({ file: file.name, box: [lo.map(v => v / mpu), hi.map(v => v / mpu)] }, 'reshow')
                    } catch (e) { info.text = `could not read ${file.name}: ${e.message}`; try { table.refresh?.() } catch { } }
                }
                input.click()
            })
            const V = { own: L.flux != null, flux: L.flux ?? parsed?.total ?? 0, emitN: L.emitN }
            f.addBinding(V, 'own', { label: 'set the flux' }).on('change', ev => set({ flux: ev.value ? (V.flux || 1) : null }, 'reshow'))
            const lp = k => `scene/${node.id}/light/${k}`
            if (V.own) flagRow(f.addBinding(V, 'flux', { label: 'flux (lm)', min: 0 }).on('change', ev => set({ flux: Math.max(0, +ev.value || 0) })), lp('flux'))
            flagRow(f.addBinding(V, 'emitN', { label: 'emits into n', min: 1, max: 3, step: 0.001 }).on('change', ev => set({ emitN: ev.value })), lp('emitN'))
            return
        }
        const V = { colour: { ...L.colour }, by: L.flux != null ? 'flux' : 'luminance', luminance: L.luminance, flux: L.flux ?? 0,
                    distribution: L.distribution, n: L.n, halfAngle: L.halfAngle, twoSided: L.twoSided, transparent: L.transparent, emitN: L.emitN }
        const flux = () => sourceTable(doc).sources.find(x => x.id === node.id)?.flux ?? 0
        colourBindings(f, node, L, set)
        f.addBinding(V, 'by', { label: 'brightness by', options: { 'luminance (cd/m\u00b2)': 'luminance', 'flux (lm)': 'flux' } })
            .on('change', ev => set({ flux: ev.value === 'flux' ? (flux() || 100) : null }, 'reshow'))
        const lp = k => `scene/${node.id}/light/${k}`
        if (V.by === 'flux') flagRow(f.addBinding(V, 'flux', { label: 'flux (lm)', min: 0 }).on('change', ev => set({ flux: Math.max(0, +ev.value || 0) })), lp('flux'))
        else flagRow(f.addBinding(V, 'luminance', { label: 'luminance (cd/m\u00b2)', min: 0 }).on('change', ev => set({ luminance: Math.max(0, +ev.value || 0) })), lp('luminance'))
        const info = { text: V.by === 'flux' ? `luminance ${(+L.luminance || 0).toPrecision(4)} cd/m\u00b2 (from the flux)`
                                             : `flux ${flux().toPrecision(4)} lm (from the luminance)` }
        f.addBinding(info, 'text', { readonly: true, label: '' })
        f.addBinding(V, 'distribution', { label: 'distribution', options: { 'cos^n (1 = Lambertian)': 'cosine',
            'uniform cone': 'uniform', 'collimated': 'collimated' } })
            .on('change', ev => set({ distribution: ev.value, ...(ev.value === 'collimated' && V.by !== 'flux' ? { flux: flux() || 100 } : {}) }, 'reshow'))
        if (V.distribution === 'cosine') flagRow(f.addBinding(V, 'n', { label: 'n (cos^n)', min: 0, max: 200, step: 0.1 }).on('change', ev => set({ n: ev.value })), lp('n'))
        if (V.distribution !== 'collimated') flagRow(f.addBinding(V, 'halfAngle', { label: 'cone half angle (deg)', min: 0.5, max: 90, step: 0.5 })
            .on('change', ev => set({ halfAngle: ev.value })), lp('halfAngle'))
        f.addBinding(V, 'twoSided', { label: 'both faces' }).on('change', ev => set({ twoSided: ev.value }, 'structure'))
        f.addBinding(V, 'transparent', { label: 'transparent (other light passes)' }).on('change', ev => set({ transparent: ev.value }, 'structure'))
        flagRow(f.addBinding(V, 'emitN', { label: 'emits into n', min: 1, max: 3, step: 0.001 }).on('change', ev => set({ emitN: ev.value })), lp('emitN'))
    }

    /* A LIGHT'S COLOUR, three ways (lights.js colourBy): an RGB hue, a CCT and Duv, or CIE xy -- the
       last two as a datasheet gives an LED, and exact however far outside the display's gamut. Below
       them, what it comes to in the other terms. Switching the way keeps the colour: the new fields
       start at the current colour's own values. */
    function colourBindings(f, node, L, set) {
        const ch = M.lightChromaticity(L)
        const C = { by: L.colourBy, colour: { ...L.colour }, cct: L.cct, duv: L.duv, x: L.xy.x, y: L.xy.y }
        f.addBinding(C, 'by', { label: 'colour by', options: { 'RGB': 'rgb', 'CCT + Duv': 'cct', 'CIE xy': 'xy' } })
            .on('change', ev => {
                const patch = { colourBy: ev.value }
                if (ev.value === 'cct' && ch.inRange) Object.assign(patch, { cct: Math.round(ch.cct), duv: +Math.max(-0.05, Math.min(0.05, ch.duv)).toFixed(4) })
                if (ev.value === 'xy') patch.xy = { x: +ch.x.toFixed(4), y: +ch.y.toFixed(4) }
                if (ev.value === 'rgb') patch.colour = M.lightDisplayRGB(L)
                set(patch, 'reshow')
            })
        // what the colour comes to, re-read from the document after every change
        const text = c => `x ${c.x.toFixed(4)} y ${c.y.toFixed(4)}`
            + (c.inRange ? ` · ${Math.round(c.cct)} K, Duv ${c.duv >= 0 ? '+' : ''}${c.duv.toFixed(4)}` : '')
            + (c.outOfGamut ? ' · outside the display gamut: traced exactly, shown desaturated' : '')
        const info = { text: text(ch) }
        let infoB = null
        const put = patch => {
            set(patch)
            info.text = text(M.lightChromaticity(M.lightOf(M.find(BUILDER.doc, node.id)?.node)))
            try { infoB?.refresh() } catch { }
        }
        const lp = k => `scene/${node.id}/light/${k}`
        if (C.by === 'rgb') flagRow(f.addBinding(C, 'colour', { label: 'colour', color: { type: 'float' } }).on('change', () => put({ colour: { ...C.colour } })), lp('colour'))
        if (C.by === 'cct') {
            flagRow(f.addBinding(C, 'cct', { label: 'CCT (K)', min: 1000, max: 15000, step: 10 }).on('change', ev => put({ cct: ev.value })), lp('cct'))
            flagRow(f.addBinding(C, 'duv', { label: 'Duv', min: -0.05, max: 0.05, step: 0.0005 }).on('change', ev => put({ duv: ev.value })), lp('duv'))
        }
        if (C.by === 'xy') {
            const xy = () => ({ x: C.x, y: C.y })
            f.addBinding(C, 'x', { label: 'x', min: 0.001, max: 0.8, step: 0.0001 }).on('change', () => { if (C.x + C.y < 1) put({ xy: xy() }) })
            f.addBinding(C, 'y', { label: 'y', min: 0.001, max: 0.9, step: 0.0001 }).on('change', () => { if (C.x + C.y < 1) put({ xy: xy() }) })
        }
        infoB = f.addBinding(info, 'text', { readonly: true, label: '' })
    }

    /* AN EXPORT BOX (exportbox.js): its settings, what the grid comes to, and the two exports. The
       grid line is a getter the monitor re-reads, so it follows a size or a scale dragged anywhere.
       The export runs against the renderer (BUILDER.exportPrint), which has to be showing this
       scene; it downloads the file and says what it made. One at a time. */
    let exporting = false
    /* A HAZE BOX'S DUST (hazebox.js): its mean free path in real metres whatever the scene's unit, its albedo, its g --
       live, as the renderer's own uniforms (makeAfter's haze, demo.js pushHaze). The visibility beside the mean free path
       is the number a weather report gives (Koschmieder), and the scale note is why a small scene shows little. */
    function hazeFolder(folder, node) {
        const doc = BUILDER.doc
        const S = M.hazeSettings(node)
        const V = { mfp: S.mfp, albedo: { ...S.albedo }, g: S.g }
        const f = folder.addFolder({ title: 'dust in the air' })
        const vis = { get text() { const m = M.hazeSettings(node).mfp
            return `visibility ${visibilityOf(m) < 1 ? `${(visibilityOf(m) * 100).toPrecision(3)} cm` : `${visibilityOf(m).toPrecision(3)} m`}; `
                + 'only the air inside scatters (not glass or solids). Real room dust is tens of metres; a small scene shows a beam '
                + 'best looking into the light, or with less other light.' } }
        let visLine = null
        const put = patch => {
            if (!A.haze(doc, node, patch)) return
            for (const k of Object.keys(patch)) said(`scene/${node.id}/haze/${k}`)
            try { visLine?.refresh() } catch { }
        }
        f.addBinding(V, 'mfp', { label: 'mean free path (m)', min: 0.001, max: 1000, step: 0.001 })
            .on('change', ev => put({ mfp: Math.max(0.001, +ev.value || S.mfp) }))
        visLine = f.addBinding(vis, 'text', { readonly: true, label: '', multiline: true, rows: 3 })
        f.addBinding(V, 'albedo', { label: 'albedo (colour)', color: { type: 'float' } })
            .on('change', () => put({ albedo: { r: Math.min(1, Math.max(0, V.albedo.r)), g: Math.min(1, Math.max(0, V.albedo.g)), b: Math.min(1, Math.max(0, V.albedo.b)) } }))
        f.addBinding(V, 'g', { label: 'g (forward scattering)', min: -HAZE_G_MAX, max: HAZE_G_MAX, step: 0.01 })
            .on('change', ev => put({ g: Math.min(HAZE_G_MAX, Math.max(-HAZE_G_MAX, +ev.value || 0)) }))
    }

    function exportFolder(folder, node) {
        const doc = BUILDER.doc
        const E = M.exportOf(node)
        const V = { cell: E.cell, colours: E.colours }
        const f = folder.addFolder({ title: 'export for printing' })
        const set = patch => {
            try { M.setExport(doc, node.id, patch) } catch (e) { console.warn('[builder]', e.message); return }
            edited(`${node.id}.export`)
        }
        f.addBinding(V, 'cell', { label: 'cell (mm)', min: 0.05, max: 5, step: 0.01 }).on('change', ev => set({ cell: Math.max(0.01, +ev.value || EXPORT_CELL) }))
        f.addBinding(V, 'colours', { label: 'colours (3MF)', min: 1, max: 16, step: 1 }).on('change', ev => set({ colours: Math.max(1, Math.round(+ev.value || 1)) }))
        const grid = { get text() {
            try {
                const g = exportGrid(BUILDER.doc, node.id)
                const cells = g.n.map(k => k - 2)
                return `${g.sizeMm.map(v => v.toPrecision(4)).join(' x ')} mm, ${cells.join(' x ')} cells of ~${g.spacing[0].toPrecision(3)} mm`
                    + (gridProblem(g) ? `\n${gridProblem(g)}` : '')
            } catch (e) { return e.message }
        } }
        f.addBinding(grid, 'text', { readonly: true, label: '', multiline: true, rows: 2 })
        const status = { text: 'everything solid inside the box, cut by it; z up, in mm' }
        const line = f.addBinding(status, 'text', { readonly: true, label: '', multiline: true, rows: 2 })
        const say = t => { status.text = t; try { line.refresh() } catch { } }
        const run = format => async () => {
            if (exporting) return say('an export is already running')
            exporting = true
            const t0 = performance.now()
            try {
                const r = await BUILDER.exportPrint(node.id, format, say)
                say(`${format.toUpperCase()}: ${r.triangles.toLocaleString()} triangles, ${(r.bytes.length / 1048576).toFixed(1)} MB`
                    + (r.palette ? `, ${r.palette.length} colour(s)` : '')
                    + (r.open ? `, ${r.open}+ OPEN EDGES (a mesher bug: please report)` : '')
                    + `, ${((performance.now() - t0) / 1000).toFixed(1)} s`)
            } catch (e) {
                console.error('[builder] export failed:', e)
                say(`export failed: ${e.message}`)
            } finally { exporting = false }
        }
        f.addButton({ title: 'Export 3MF (with colour)' }).on('click', run('3mf'))
        f.addButton({ title: 'Export STL (no colour)' }).on('click', run('stl'))
    }

    /* THE PARAMETERS FOLDER, an object's or a material's: bound to the document's own values,
       so the document IS what the slider edits and the renderer is told afterwards. `editable`
       adds the + and each row's pencil and cross. */
    function paramsFolder(folder, owner, keys, typeGui, editable) {
        if (!keys.length && !editable) return
        const consts = owner.constants || {}
        const pf = folder.addFolder({ title: 'parameters' })
        if (editable) headerPlus(pf, owner)
        /* ONE ROW THAT CANNOT BE DRAWN DOES NOT TAKE THE REST WITH IT: a NaN stopped show() at its row -- every
           parameter after it missing, and a pick, which shows the panel, failing (the user, 2026-10-02) */
        for (const k of keys) {
            try { paramRow(pf, owner, k, typeGui, editable, consts) } catch (e) { console.error(`[panel] parameter '${k}' could not be shown:`, e) }
        }
    }
    /* A NUMBER WITH NO RANGE is typed, not slid -- an aspheric lens's a4 of 1.6e-5, its a10 of 2e-13 (primitives.js) --
       and Tweakpane shows a number to the decimals of its first value, at least two: 0.00 for both, and for any that
       started at 0, a value a person would type over. Shown here in as many digits as it has, in exponent form when
       small or large. */
    const asTyped = v => !Number.isFinite(v) ? String(v) : v === 0 ? '0'
        : Math.abs(v) < 1e-3 || Math.abs(v) >= 1e7 ? v.toExponential() : String(+v.toPrecision(10))
    /* ...AND NOT HELD TO [0, 100]: the property table gives a number with no range one of its own, 0 to 100 widened to
       its value (propertytable.js bindingPrepper), so a negative a4 typed in became 0 -- as did any parameter a person
       added without a range. A minimum of -Infinity alone is a range given, and an open one: a field, no slider. */
    const typedOpts = range => range.step != null ? {} : range.min == null && range.max == null ? { min: -Infinity, format: asTyped } : { format: asTyped }
    /* A RANGE WIDENED TO HOLD ITS VALUE: a range is a slider's reach, not a limit on the value. The RGBW mixing
       example's screen is 60 mm wide on a rectangle whose range stops at 10 (its block's), and the property table
       widens a range only when none is given (propertytable.js bindingPrepper) -- so the slider stood at its end and
       the first drag wrote 10 over the 60 (the user, 2026-10-12). Widened as drawn, never written back: the block's
       range stays what it says. A vector widens by its largest and smallest component. */
    function fitRange(range, v) {
        const nums = typeof v === 'number' ? [v] : v && typeof v === 'object' ? Object.values(v).filter(x => typeof x === 'number') : []
        const finite = nums.filter(Number.isFinite)
        if (!finite.length) return range
        const lo = Math.min(...finite), hi = Math.max(...finite)
        return { ...range, ...(range.min != null && lo < range.min ? { min: lo } : {}), ...(range.max != null && hi > range.max ? { max: hi } : {}) }
    }
    function paramRow(pf, owner, k, typeGui, editable, consts) {
        /* the range: the owner's own, else its type's -- so parameters are sliders, not
           bare numbers -- widened to hold the value (fitRange) */
        const range = fitRange(owner.ranges?.[k] || typeGui[k] || {}, owner.params[k])
        const name = `${k}${unitSuffix(owner, k)}`
        // a node's "lock parameters" (LOCKED ROWS above); a material or a relief has none
        /* ...and a value BOUND to its component's parameters (model.js version 18): held, its expression on the label --
           a drag would be undone by the next resolve */
        const bound = Object.entries(owner.bind || {}).filter(([t]) => t === k || t.startsWith(k + '.'))
        const locked = M.lockOf(owner).params || bound.length > 0
        let b
        const v = owner.params[k], pk = M.paramKind(v)
        if (pk === 'profile' || pk === 'path') {
            b = pointsEditor(pf, owner, k, name, pk, locked)
            if (editable) rowIcons(b, owner, k)
            return
        }
        /* NOT A NUMBER (NaN, or null, which is what JSON keeps of one): a text to type a number into, and its pencil
           and cross -- a slider over NaN could not be drawn, nor moved off it */
        if (v === null || (typeof v === 'number' && !Number.isFinite(v))) {
            b = brokenNumber(pf, owner, k, name, locked)
            held(b, locked, 'lock parameters')
            if (editable) rowIcons(b, owner, k)
            return
        }
        if (consts[k]) {
            /* COMPILE-TIME: the value is in the shader text, so a change is structural --
               and it waits for the control to settle, since every step is a compile. */
            b = pf.addBinding(owner.params, k, { label: `${name} ⚙`, ...range,
                ...(consts[k] !== 'f32' ? { step: 1 } : {}), ...lockedOpts(locked) })
            const l = b.element.querySelector('.tp-lblv_l')
            if (l) l.title = `compile-time (${consts[k]}): every change recompiles`
            let last = v
            b.on('change', ev => {
                if (keepFinite(owner.params, k, b, last)) return
                last = owner.params[k]
                if (ev.last === false) return
                A.structure(); said(`scene/${owner.id}/${k}`); recheck(owner.id)
            })
        } else b = bind(pf, owner.params, k, { label: bound.length ? `${name} =` : name, ...range, ...(pk === 'number' ? typedOpts(range) : {}),
                                               ...lockedOpts(locked, pk === 'vector') },
                        () => { live(owner.id, k); recheck(owner.id) }, `scene/${owner.id}/${k}`)
        held(b, locked, 'lock parameters')
        if (bound.length) { const l = b?.element?.querySelector('.tp-lblv_l'); if (l) l.title = `from parameters: ${bound.map(([t, e]) => `${t} = ${e}`).join(', ')}` }
        if (editable) rowIcons(b, owner, k)
    }
    function brokenNumber(pf, owner, k, name, locked = false) {
        const t = { text: String(owner.params[k]) }
        const b = pf.addBinding(t, 'text', { label: `${name} ⚠`, ...lockedOpts(locked) })
        const l = b.element.querySelector('.tp-lblv_l')
        if (l) l.title = `${k} is not a number: type one`
        b.on('change', ev => {
            const text = String(ev.value).trim(), n = Number(text)
            if (!text || !Number.isFinite(n)) return
            owner.params[k] = n
            if (owner.constants?.[k]) A.structure(); else live(owner.id, k)
            said(`scene/${owner.id}/${k}`); recheck(owner.id)
            const at = shownId; setTimeout(() => { if (shownId === at) show(at) })
        })
        return b
    }

    /* A PROFILE (model.js setProfile) or A PATH (setPath): its points as text, one a line -- x, y for a profile, x, y,
       z for a path, and a fillet radius if it has one -- checked as it is typed (core/shapes.js profilePieces and
       pathPieces, through the model: every problem by its point number) and applied with Apply or Ctrl+Enter, one
       undo step and a compile: the points are the shader's own text. The recipe editor's pattern (recipeEditor): a
       draft, a verdict under it, nothing touched until applied.
         A PATH's entries may name the node's parameters (builder/expr.js: `0.5, 0.5, rise`), and a path may be LIVE
       (model.js setPathLive): its pieces uniforms, so Apply writes them with no compile, and a slider on a name moves
       it -- the user's way to try values, then switch back to compiled once it is right (2026-10-01). */
    /* A PROFILE the same way since 2026-10-02 ("do the same live mode for profiles"): its live mark is the node's
       (model.js liveProfiles), since its value is a bare list. A PATH's point may carry three numbers more after its
       fillet (2026-10-02): its cross-section's scale x, scale y and twist -- `more` says what may follow the form,
       `most` how many a point may have. */
    const POINTS = {
        profile: { form: 'x, y', more: 'fillet', most: 3, points: v => v, set: M.setProfile, exprs: true,
            isLive: (owner, k) => !!owner.liveProfiles?.includes(k), setLive: M.setProfileLive, names: v => M.pointNames(v),
            title: (k, live) => 'a closed outline, one point per line: x, y -- and a fillet radius to round that corner -- each a number or an expression of this object\'s parameters (w, -w/2, corner.x). The code turns it into a shape: extrude(' + k + ', p, height) or revolve(' + k + ', p). '
                + (live ? 'LIVE: Apply (Ctrl+Enter) and a slider on a name change it with no compile, unless a point is added or a fillet appears or goes; untick live once it is right'
                    : 'Compiled in: Apply (Ctrl+Enter) recompiles, and so does a slider on a name it reads') },
        path: { form: 'x, y, z', more: 'fillet, scale x, scale y, twist', most: 7, points: v => v.path, set: M.setPath, exprs: true,
            isLive: (owner, k) => owner.params[k].live === true, setLive: M.setPathLive, names: v => M.pathNames(v),
            title: (k, live) => 'an open path, one point per line: x, y, z -- then a fillet radius to round that corner, and the cross-section\'s scale x, scale y and twist in degrees there, as many as it needs (0, 1, scale x and 0 when left off; they change evenly along a straight and hold round a bend; a tube reads scale x alone, its diameter) -- each a number or an expression of this object\'s parameters (rise, -w/2, corner.x). The code sweeps along it: tube(' + k + ', p, radius, rounded) or sweep(' + k + ', outline, p). '
                + (live ? 'LIVE: Apply (Ctrl+Enter) and a slider on a name move it with no compile, unless a point is added, or a scale or twist first appears or every one goes back to its default; untick live once it is right'
                    : 'Compiled in: Apply (Ctrl+Enter) recompiles, and so does a slider on a name it reads') },
    }
    const pointsText = pts => pts.map(p => p.join(', ')).join('\n')
    const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/
    function parsePoints(text, { form, more, most, exprs }) {
        const lines = text.split('\n').map(l => l.trim()), errors = [], points = []
        const n = form.split(',').length              // numbers a point has, before its fillet
        while (lines.length && !lines.at(-1)) lines.pop()
        lines.forEach((l, i) => {
            // an expression may hold spaces (w / 2): where entries can be expressions, commas part them when there are any
            const parts = (exprs && l.includes(',') ? l.split(',') : l.split(/[\s,]+/)).map(x => x.trim()).filter(Boolean)
            const vals = parts.map(x => NUMBER.test(x) ? Number(x) : exprs ? x : NaN)
            if (!l) errors.push(`line ${i + 1}: empty -- a point is ${form} (and ${most > n + 1 ? `then ${more}` : `a ${more}`})`)
            else if (parts.length < n || parts.length > most || !vals.every(v => typeof v === 'string' || Number.isFinite(v)))
                errors.push(most > n + 1 ? `line ${i + 1}: "${l}" is not ${form}, then ${more} if it has them`
                    : `line ${i + 1}: "${l}" is not ${form} or ${form}, ${more}`)
            else points.push(vals)
        })
        return { points, errors }
    }
    function pointsEditor(pf, owner, k, name, kind, locked = false) {
        const P = POINTS[kind], now = () => P.points(owner.params[k])
        const isLive = P.isLive(owner, k)
        const draft = { text: pointsText(now()) }
        {
            /* LIVE OR COMPILED: structural either way (the shader changes), one undo step */
            const mode = { live: isLive }
            const lb = pf.addBinding(mode, 'live', { label: `${k}: live` })
            const ll = lb.element.querySelector('.tp-lblv_l')
            if (ll) ll.title = `live: the ${kind}'s pieces are uniforms -- Apply and a slider on a name it reads change it with no compile. Untick once it is right: compiled, its numbers are the shader's text`
            lb.on('change', ev => {
                try { P.setLive(BUILDER.doc, owner.id, k, ev.value) } catch (e) { console.warn('[panel] live:', e.message); return }
                A.structure()
                const at = shownId; setTimeout(() => { if (shownId === at) show(at) })
            })
        }
        const b = pf.addBinding(draft, 'text', { label: isLive ? name : `${name} ⚙`, multiline: true, lineNumbers: true,
            rows: Math.max(4, Math.min(14, now().length + 1)) })
        const l = b.element.querySelector('.tp-lblv_l')
        if (l) l.title = locked ? `locked: untick "lock parameters" to change its points` : P.title(k, isLive)
        const box = document.createElement('div')
        Object.assign(box.style, { font: '12px/1.35 monospace', whiteSpace: 'pre-wrap', padding: '4px 6px',
            margin: '2px 4px 6px', borderRadius: '3px', background: 'rgba(0,0,0,0.25)' })
        box.className = `builder-${kind}-said`          // what the check said, for the headless check to read
        b.element.after(box)
        const say = (text, color) => { box.textContent = text; box.style.color = color }
        const check = () => {
            const r = parsePoints(draft.text, P)
            if (r.errors.length) { say(r.errors.join('\n'), '#ff8a80'); return null }
            const trial = structuredClone(BUILDER.doc), same = pointsText(r.points) === pointsText(now())
            try { P.set(trial, owner.id, k, r.points) } catch (e) {
                const problems = (e.problems || [e.message]).join('\n')
                /* the path as it is, unsound at today's values: a slider took it there, and it draws nothing */
                const names = P.names(owner.params[k])
                say(same && names.length ? `draws nothing now -- ${problems}\n(with ${names.map(n => `${n} = ${JSON.stringify(owner.params[n])}`).join(', ')})` : problems, '#ff8a80')
                return null
            }
            say(same ? `as it is: ${r.points.length} points` : 'reads clean: Apply to make it so', '#81c784')
            return r.points
        }
        rechecks.set(owner.id, [...(rechecks.get(owner.id) || []), check])
        const apply = () => {
            // LOCKED: shown, read-only, and Apply (or Ctrl+Enter) changes nothing (LOCKED ROWS above)
            if (locked) return
            const pts = check()
            if (!pts) return
            try { P.set(BUILDER.doc, owner.id, k, pts) } catch (e) { say(e.message, '#ff8a80'); return }
            /* live: written as uniforms, no compile (demo.js liveValue asks the host for one if it now has more points
               than its room, codegen.js livePointsUpdate); one undo step either way */
            if (isLive) { A.live(owner.id, k, { quiet: true }); edited(null) } else A.structure()
            said(`scene/${owner.id}/${k}`)
            const at = shownId; setTimeout(() => { if (shownId === at) show(at) })
        }
        pf.addButton({ title: `Apply ${k}  (Ctrl+Enter)`, disabled: locked }).on('click', apply)
        let timer = 0
        // the textarea is Tweakpane's, rewired by PropertyTable on a zero timeout: attach after that (recipeEditor)
        setTimeout(() => {
            const ta = b.element.querySelector('textarea')
            if (!ta) return say('(editor not found -- PropertyTable changed?)', '#ff8a80')
            // PropertyTable has just made it writable (it starts as Tweakpane's read-only monitor)
            if (locked) ta.readOnly = true
            ta.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(check, 300) })
            ta.addEventListener('keydown', e => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); clearTimeout(timer); apply() }
            })
        }, 0)
        check()
        return b
    }

    /* THE SCENE'S UNIT beside a length: " (cm)" after a parameter marked as one (model.js setLength), after
       a light's size (always a length), and after the position -- a reminder that radius 1 is a metre in
       one scene and a centimetre in the next (the user, 2026-09-28). */
    const unitName = () => BUILDER.doc.unit ?? 'm'
    /* a relief's lengths are real millimetres whatever the scene's unit (its owner says so), and so are a
       material's own: its code reads the point in mm (MATERIAL_CODE_TEMPLATE), because a material has no
       size of its own -- the leather is the same on a sofa in metres and a strap in millimetres */
    const unitOf = owner => owner.unit ?? (M.material(BUILDER.doc, owner.id) ? 'mm' : unitName())
    const unitSuffix = (owner, k) => (owner.type === 'light' || M.isLength(owner, k)) ? ` (${unitOf(owner)})` : ''

    /* A MATERIAL'S COATING (materials.js coating, 0.39.0): a dichroic, a beam splitter, an AR layer -- what the surface
       reflects instead of its Fresnel. Where it is, then a preset, then its values, shown only while it has one (none
       of them is in the shader otherwise). Putting one on is a compile (demo.js live: `coating` is `only`); the rest is
       live. A preset is one undo step, and turns the coating on (entry faces, AR back) when it was off. */
    function coatingFolder(folder, mat) {
        const cf = folder.addFolder({ title: 'coating' })
        const redraw = () => setTimeout(() => { if (shownId === mat.id) show(mat.id) })     // its values come or go
        const cb = bind(cf, mat.params, 'coating', { label: 'coating', ...M.MATERIAL_FIELDS.coating.gui },
                        () => { live(mat.id, 'coating'); redraw() }, `scene/${mat.id}/coating`)
        const cl = cb.element.querySelector('.tp-lblv_l')
        if (cl) cl.title = 'A thin-film stack whose reflectance replaces the surface\'s Fresnel: on the faces light enters the material by,'
            + ' and on those it leaves by nothing (AR back), the bare surface, or the same coating (every face).'
            + '\nA plate with "entry faces (AR back)" is a real dichroic or plate beam splitter.'
            + '\nEach colour channel reflects R averaged over its wavelengths; transmitted is 1 - R.'
        const P = { preset: '' }
        cf.addBinding(P, 'preset', { label: 'preset', options: { '(choose)': '', ...Object.fromEntries(Object.keys(M.COAT_PRESETS).map(k => [k, k])) } })
            .on('change', ev => {
                if (!ev.value) return
                const was = M.hasCoating(mat.params)
                Object.assign(mat.params, M.COAT_PRESETS[ev.value])
                if (!was) mat.params.coating = 1
                /* off before: the compile builds from the document, values and all; on: each value is a uniform. One
                   undo step either way. */
                for (const k of was ? M.COAT_FIELDS : ['coating']) A.live(mat.id, k, { quiet: true })
                edited(null)
                redraw()
            })
        if (!M.hasCoating(mat.params)) return
        for (const k of M.COAT_FIELDS)
            bind(cf, mat.params, k, { label: M.MATERIAL_FIELD_LABELS[k] ?? k, ...(M.MATERIAL_FIELDS[k].gui || {}) }, () => live(mat.id, k), `scene/${mat.id}/${k}`)
    }

    /* A MATERIAL'S RELIEF (materials.js RELIEFS): a height on every object wearing it -- in the shape, the
       silhouette too -- in real millimetres. The choice is structural (a function and a wrapper in the
       shader); its parameters are live, owned by `<id>#relief`, so the + and each row's pencil and cross
       are the model's own parameter operations; its code is checked as the material's is, its errors
       reported at its own lines. Choosing a preset over code of one's own replaces it: an undo step. */
    function reliefFolder(folder, doc, mat) {
        const rf = folder.addFolder({ title: 'relief' })
        const preset = M.reliefPresetOf(mat.relief)
        const OWN = '#own'
        const options = { none: '', ...Object.fromEntries(Object.entries(M.RELIEFS).map(([k, r]) => [r.label, k])) }
        if (mat.relief && !preset) options['code of its own'] = OWN
        const R = { relief: mat.relief ? (preset ?? OWN) : '' }
        const b = rf.addBinding(R, 'relief', { label: 'relief', options })
        const l = b.element.querySelector('.tp-lblv_l')
        if (l) l.title = 'A height on the surface of every object wearing this material, in real millimetres -- in the shape itself,'
            + ' the silhouette too. Its noise is paid at every march step near those objects.'
        b.on('change', ev => {
            if (ev.value === OWN) return
            try { M.setRelief(doc, mat.id, ev.value || null) } catch (e) { console.error('[panel] relief:', e); return }
            edited(null)
            onStructure()
            setTimeout(() => { if (shownId === mat.id) show(mat.id) })
        })
        if (!mat.relief) return
        const owner = { id: M.reliefOwner(mat.id), unit: 'mm', get params() { return mat.relief.params },
            get constants() { return mat.relief.constants }, get ranges() { return mat.relief.ranges }, get lengths() { return mat.relief.lengths } }
        paramsFolder(rf, owner, Object.keys(mat.relief.params || {}), {}, true)
        const holder = { id: M.reliefOwner(mat.id), get code() { return mat.relief.code }, set code(v) { mat.relief.code = v } }
        codeEditor(rf, holder, { kind: 'relief', title: 'relief code', names: 'q (mm, in the frame of the object wearing it) -> h (mm, outward), slope (a bound on its gradient)', owner: mat.id })
    }

    /* A CODE NODE'S (OR A MATERIAL'S) PARAMETERS are edited where they are shown: a + in the folder's header adds
       one, and a pencil and a cross after each name edit or delete it. Each change alters what
       the shader declares, so it is structural, one undo step, and redraws the panel -- a tick
       later, because these run inside a control's own event and disposing it mid-dispatch
       raises a TpError. */
    const iconCss = { cursor: 'pointer', marginLeft: '5px', opacity: '0.55', fontSize: '12px', userSelect: 'none' }
    const icon = (text, title, onClick) => {
        const i = document.createElement('span')
        i.textContent = text; i.title = title
        Object.assign(i.style, iconCss)
        i.onmouseenter = () => { i.style.opacity = '1' }
        i.onmouseleave = () => { i.style.opacity = '0.55' }
        i.onclick = e => { e.stopPropagation(); e.preventDefault(); onClick(i) }
        return i
    }
    /* the row shown, redrawn -- not `node.id`: a holder (a material's relief, the functions block) has an
       id of its own that is no row */
    const restructured = () => { edited(null); onStructure(); const at = shownId; setTimeout(() => show(at), 0) }
    // which code folders are open, per kind and per whether they hold code: a convenience, per browser
    const FOLD_KEY = 'raytracer.properties.codeOpen'
    const foldState = () => { try { return JSON.parse(localStorage.getItem(FOLD_KEY)) || {} } catch { return {} } }
    const keepFold = (key, open) => { try { localStorage.setItem(FOLD_KEY, JSON.stringify({ ...foldState(), [key]: open })) } catch { } }

    /* The + sits INSIDE the folder's header bar, left of the fold mark. Appended plainly it
       wrapped onto a second line, under the header and behind the first row -- in the page,
       clickable by a script, invisible to a person. */
    function headerPlus(pf, node) {
        const header = pf.element.querySelector('.tp-fldv_b') || pf.element
        header.style.position = 'relative'
        const plus = icon('+', 'Add a parameter', el => editParam(el, node, null))
        Object.assign(plus.style, { position: 'absolute', right: '28px', top: '50%', transform: 'translateY(-50%)',
            margin: '0', fontSize: '15px', fontWeight: 'bold', lineHeight: '1', padding: '0 4px', opacity: '0.8' })
        plus.onmouseleave = () => { plus.style.opacity = '0.8' }
        header.appendChild(plus)
    }

    function rowIcons(b, node, k) {
        const label = b.element.querySelector('.tp-lblv_l')
        if (!label) return
        label.appendChild(icon('\u270E', `Edit ${k}: name, kind, live or compile-time, range`, el => editParam(el, node, k)))
        label.appendChild(icon('\u00D7', `Delete ${k}`, () => {
            /* REFUSED, SAID: a parameter a path names stays (model.js removeParam), and the refusal went nowhere but an
               uncaught error -- the cross did nothing, as far as anyone could see (the user, 2026-10-02) */
            try { M.removeParam(BUILDER.doc, node.id, k) } catch (e) { rowNote(b, e.message); console.warn('[panel]', e.message); return }
            restructured()
        }))
    }
    /* a line under a row, in red, until the panel is next drawn: what an operation on it refused, and why */
    const rowNote = (b, text) => {
        b.element.parentElement?.querySelector?.('.builder-param-said')?.remove()
        const box = document.createElement('div')
        Object.assign(box.style, { font: '12px/1.35 monospace', whiteSpace: 'pre-wrap', padding: '4px 6px', margin: '2px 4px 6px',
            borderRadius: '3px', background: 'rgba(0,0,0,0.25)', color: '#ff8a80' })
        box.className = 'builder-param-said'
        box.textContent = text
        b.element.after(box)
    }

    /** The dialog, for a new parameter (k null) or an existing one. Applied as model
     *  operations in an order that cannot half-fail: every one is checked on a copy first. */
    function editParam(anchor, node, k) {
        const cur = k == null ? { name: '', kind: 'number', mode: '', range: null, length: false }
            : { name: k, kind: M.paramKind(node.params[k]), mode: node.constants?.[k] || '', range: node.ranges?.[k] || null,
                length: M.isLength(node, k) }
        openParamDialog(anchor, cur, {
            title: k == null ? 'New parameter' : `Parameter ${k}`, unit: unitOf(node),
            // a profile or a path is a code object's (model.js setParamKind): not offered to a group, a material or a relief
            kinds: node.kind === 'object' && node.type === 'code' ? undefined : ['number', 'vector', 'colour'],
            onApply: v => {
                if (!v.name) return 'a name is needed'
                // try everything on a copy, so a refusal leaves the document as it was
                const trial = structuredClone(BUILDER.doc)
                const run = doc => {
                    let key = k
                    if (key == null) { M.addParam(doc, node.id, v.name, 0); key = v.name }
                    else if (v.name !== key) { M.renameParam(doc, node.id, key, v.name); key = v.name }
                    M.setParamKind(doc, node.id, key, v.kind)
                    M.setConstant(doc, node.id, key, v.kind === 'number' ? (v.mode || null) : null)
                    M.setRange(doc, node.id, key, v.kind === 'number' ? v.range : null)
                    M.setLength(doc, node.id, key, !!v.length)
                }
                try { run(trial) } catch (e) { return e.message || String(e) }
                run(BUILDER.doc)
                restructured()
            },
        })
    }

    /* THE TRANSFORM: live. It is one mat4 uniform per node (codegen xf_<id>), so moving,
       turning or scaling anything is a uniform write, never a compile -- the same as a
       parameter. Rotation is in degrees, applied about x, then y, then z. */
    function transform(folder, node) {
        const t = node.transform
        if (!t) return
        const tf = folder     // placement sits in the node's own list, not a folder of its own
        const push = () => live(node.id, 'transform')
        const at = `scene/${node.id}/transform/`
        /* ITS LOCKS, above what they hold: one undo step each and nothing compiled (a lock is not the shader's); the
           tree is redrawn for its lock, and this panel, a tick later as elsewhere, for the rows a lock disables */
        const L = M.lockOf(node)
        for (const [k, label, tip] of LOCK_ROWS) {
            const b = tf.addBinding(L, k, { label })
            const l = b.element.querySelector('.tp-lblv_l')
            if (l) l.title = tip
            b.on('change', ev => {
                M.setLock(BUILDER.doc, node.id, k, ev.value)
                edited(null)
                onLabel()
                const was = shownId; setTimeout(() => { if (shownId === was) show(was) })
            })
        }
        /* ...and its bindings (model.js heldOf, version 18): a value from its component's parameters is held as a lock
           holds it, the binding on the label's tooltip */
        const Hd = M.heldOf(node), bt = which => Object.entries(node.bind || {}).filter(([x]) => x.startsWith(which)).map(([x, e]) => `${x} = ${e}`)
        const boundRow = (b, which) => { const w = bt(which); if (!w.length) return; const l = b?.element?.querySelector('.tp-lblv_l'); if (l) l.title = `from parameters: ${w.join(', ')}` }
        const pb = bind(tf, t, 'pos', { label: `position (${unitName()})`, ...lockedOpts(Hd.position, true) }, push, at + 'position')
        held(pb, L.position, 'lock position'); boundRow(pb, 'pos.')
        const rb = bind(tf, t, 'rot', { label: 'rotation °', ...lockedOpts(Hd.position, true) }, push, at + 'rotation')
        held(rb, L.position, 'lock position'); boundRow(rb, 'rot.')
        const sb = tf.addBinding(t, 'scale', { label: 'scale', min: 0.01, max: 10, step: 0.01, ...lockedOpts(Hd.params) })
        sb.on('change', () => {
            // a zero or negative scale divides the point by nothing or mirrors the field
            if (!(t.scale > 0)) t.scale = 0.01
            push()
            said(at + 'scale')
        })
        flagRow(sb, at + 'scale')
        held(sb, L.params, 'lock parameters'); boundRow(sb, 'scale')
    }
    const LOCK_ROWS = [
        ['position', 'lock position', 'Its position and rotation stay as they are: no arrows, squares, centre or arcs in the picture, '
            + 'and their rows here cannot be changed. The timeline and an undo still move it'],
        ['params', 'lock parameters', 'Its parameters\' values and its scale stay as they are: no stretch cubes, scale circle or Points '
            + 'mode in the picture, and their rows here cannot be changed. Its code, and what its parameters are, can still be '
            + 'edited; the timeline and an undo still change them'],
    ]
    /** What a row a lock holds is given: disabled, and a vector without the + whose sliders would still move it. */
    const lockedOpts = (on, vector = false) => on ? { disabled: true, ...(vector ? { sliders: false } : {}) } : {}
    /** A row a lock holds says so on its label. */
    const held = (b, on, which) => {
        if (!on) return
        const l = b?.element?.querySelector('.tp-lblv_l')
        if (l) l.title = `locked: untick "${which}" to change it`
    }

    /* A GROUP'S BLEND: the smoothness of every join among its children that has none of its own (model
       version 14 -- the op that sat beside it is each child's join now, in the child's panel). A uniform
       and live, EXCEPT where it decides whether the group combines at all: a group whose children all
       join by union with no blend folds them into the scene one by one, and one with a blend combines
       them into a single shape first (codegen isCsg), which is different code. */
    function groupBlend(folder, g) {
        /* The rule (live, or a compile) is makeAfter's blend. The control writes through a holder, so the
           rule sees the value before the change -- bound to g.blend, the control had already written it,
           and the rule had to be kept here as well, a copy. */
        const H = { get blend() { return g.blend }, set blend(v) { A.blend(g, v); said(`scene/${g.id}/blend`) } }
        const b = folder.addBinding(H, 'blend', { label: 'blend', min: 0, max: 2, step: 0.001 })
        const l = b.element.querySelector('.tp-lblv_l')
        if (l) l.title = 'how smoothly its children join, where one has no blend of its own'
        flagRow(b, `scene/${g.id}/blend`)
    }

    /* A GROUP'S RECIPE (recipe.js): how its children combine, as text -- `union a, b, c` / `subtract d` -- in the
       letters the tree shows. It edits a DRAFT the panel holds, never the document: checked on a pause, its
       errors listed at their lines under it; Apply (or Ctrl+Enter) replays it through the model's own operations
       as ONE undo step, then the panel is drawn afresh from the document -- so what the recipe says and what the
       document holds can never be two things. The look and the keys are the code editor's; folded or open is
       remembered for boolean groups and for plain ones apart, and is open for a boolean one never set. */
    /* COMPONENT PARAMETERS (model.js version 18; builder/bind.js): this node's values as expressions of the parameters
       of the groups above it -- a holder's height from its lens's diameter, an array's copies from its own count. As
       text, one `target = expression` a line, checked as typed (by line and column) and applied with Apply or
       Ctrl+Enter: the recipe editor's pattern, below. Applying writes the values and pushes them live
       (BUILDER.pushBound); one only a compile can make (an array's count in codegen) asks for it. One undo step. Shown
       where there is something to bind to -- a group above with parameters, a group's own for its placement and copies
       -- or bindings already there. */
    function bindFolder(folder, doc, node) {
        const scope = M.bindNames(doc, node.id)
        if (!scope.length && !node.bind) return
        const n = Object.keys(node.bind || {}).length
        const draft = { text: M.bindingsOf(doc, node.id) }
        const bf = folder.addFolder({ title: n ? `from parameters · ${n}` : 'from parameters', expanded: n > 0 })
        const head = bf.element.querySelector('.tp-fldv_b')
        if (head) head.title = 'its values as expressions of the parameters of the groups above it, one a line -- radius = diameter / 2,  pos.z = height + gap,  size.x = w,  copies.count = n'
        const names = scope.map(s => `${s.names.join(', ')}  (${s.own ? 'its own: for its placement and copies' : s.label})`).join('\n') || 'no group above has parameters'
        bf.addBinding({ names }, 'names', { readonly: true, label: 'names', multiline: true, rows: Math.max(1, Math.min(4, scope.length)) })
        const b = bf.addBinding(draft, 'text', { label: 'bindings', multiline: true, lineNumbers: true,
            rows: Math.max(3, Math.min(12, draft.text.split('\n').length + 1)) })
        const l = b.element.querySelector('.tp-lblv_l')
        if (l) l.title = `what it can bind: ${M.bindTargets(doc, node.id).join(', ')}`
        const box = document.createElement('div')
        Object.assign(box.style, { font: '12px/1.35 monospace', whiteSpace: 'pre-wrap', padding: '4px 6px',
            margin: '2px 4px 6px', borderRadius: '3px', background: 'rgba(0,0,0,0.25)' })
        box.className = 'builder-bind-said'          // what the check said, for test/panel.check.mjs to read
        b.element.after(box)
        const say = (text, color) => { box.textContent = text; box.style.color = color }
        const check = () => {
            const r = M.readBindings(doc, node.id, draft.text)
            if (r.errors.length) say(r.errors.map(e => `line ${e.line}:${e.col}  ${e.message}`).join('\n'), '#ff8a80')
            else say(draft.text.trim() === M.bindingsOf(doc, node.id).trim() ? (n ? 'as it is' : 'nothing bound') : 'reads clean: Apply to make it so', '#81c784')
            return r
        }
        const apply = () => {
            if (check().errors.length) return
            let r
            try { r = M.setBindings(doc, node.id, draft.text) } catch (e) { say(e.message, '#ff8a80'); return }
            edited(null)
            BUILDER.pushBound?.(r.changed)
            const mine = r.problems.filter(m => m.startsWith(`'${node.id}' `))
            if (mine.length) say(mine.join('\n'), '#ffb74d')
            const at = shownId
            setTimeout(() => { if (shownId === at) show(at) })
        }
        bf.addButton({ title: 'Apply  (Ctrl+Enter)' }).on('click', apply)
        let timer = 0
        setTimeout(() => {
            const ta = b.element.querySelector('textarea')
            if (!ta) return say('(editor not found -- PropertyTable changed?)', '#ff8a80')
            ta.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(check, 300) })
            ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); clearTimeout(timer); apply() } })
        }, 0)
        check()
    }

    function recipeEditor(folder, doc, g) {
        const draft = { text: recipeOf(g) }
        const key = `recipe:${isCsg(g) ? 'csg' : 'plain'}`
        const rf = folder.addFolder({ title: 'recipe', expanded: foldState()[key] ?? isCsg(g) })
        const head = rf.element.querySelector('.tp-fldv_b')
        if (head) head.title = 'how its children combine, top to bottom: union a, b, c / subtract d  blend 0.02 -- the letters are the tree\'s; "a label" and @id work too'
        rf.on('fold', ev => keepFold(key, ev.expanded))
        const verdict = text => { try { rf.title = text ? `recipe · ${text}` : 'recipe' } catch { } }
        const b = rf.addBinding(draft, 'text', { label: 'recipe', multiline: true, lineNumbers: true,
            rows: Math.max(3, Math.min(12, draft.text.split('\n').length + 1)) })
        const box = document.createElement('div')
        Object.assign(box.style, { font: '12px/1.35 monospace', whiteSpace: 'pre-wrap', padding: '4px 6px',
            margin: '2px 4px 6px', borderRadius: '3px', background: 'rgba(0,0,0,0.25)' })
        box.className = 'builder-recipe-said'          // what the check said, for test/panel.check.mjs to read
        b.element.after(box)
        const say = (text, color) => { box.textContent = text; box.style.color = color }
        const check = () => {
            const r = parseRecipe(draft.text, g)
            verdict(r.errors.length ? `${r.errors.length} error${r.errors.length === 1 ? '' : 's'}` : '')
            if (r.errors.length) say(r.errors.map(e => `line ${e.line}:${e.col}  ${e.message}`).join('\n'), '#ff8a80')
            else say(draft.text === recipeOf(g) ? 'as the group is' : 'reads clean: Apply to make it so', '#81c784')
            return r
        }
        const apply = () => {
            const r = check()
            if (!r.plan) return
            try { applyRecipe(doc, g.id, r.plan) } catch (e) { say(e.message, '#ff8a80'); return }
            edited(null); onLabel(); onStructure()
            setTimeout(() => { if (shownId === g.id) show(g.id) })
        }
        rf.addButton({ title: 'Apply recipe  (Ctrl+Enter)' }).on('click', apply)
        let timer = 0
        // the textarea is Tweakpane's, rewired by PropertyTable on a zero timeout: attach after that (codeEditor)
        setTimeout(() => {
            const ta = b.element.querySelector('textarea')
            if (!ta) return say('(editor not found -- PropertyTable changed?)', '#ff8a80')
            ta.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(check, 300) })
            ta.addEventListener('keydown', e => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); clearTimeout(timer); apply() }
                if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault()
                    ta.setRangeText('    ', ta.selectionStart, ta.selectionEnd, 'end')
                    ta.dispatchEvent(new Event('input'))
                }
            })
        }, 0)
        check()
    }

    /* HOW A NODE JOINS THE OTHERS IN ITS GROUP (model version 14): union, subtract or intersect what is
       above it, top to bottom -- the first shape is the base and its join waits unused until it is not
       first. Structural: another join is other shader text. Its own blend is a checkbox (structural: the
       combine then reads another uniform) and a slider, live by makeAfter's joinBlend. Nothing at the top
       level, which is always a plain union, nor for a light or an export box, which are not shapes of it. */
    function joinControls(folder, doc, node, parent) {
        if (!parent || parent === doc.root || node.type === 'light' || node.type === 'export' || node.type === 'haze') return
        const base = shapesOf(parent)[0] === node
        const again = () => setTimeout(() => { if (shownId === node.id) show(node.id) })
        const J = { join: node.join ?? 'union' }
        const jb = folder.addBinding(J, 'join', { label: base ? 'join (base)' : 'join',
            options: { 'union  ∪': 'union', 'subtract  −': 'subtract', 'intersect  ∩': 'intersect' } })
        const jl = jb.element.querySelector('.tp-lblv_l')
        if (jl) jl.title = base ? 'the first shape of its group is what the others join: this applies only once it is not first'
                                : 'how it meets what is above it in its group'
        jb.on('change', ev => {
            try { M.setJoin(doc, node.id, ev.value) } catch (e) { console.warn('[builder]', e.message); return }
            edited(null); onLabel(); onStructure()
        })
        const O = { own: node.joinBlend != null }
        folder.addBinding(O, 'own', { label: 'own blend' }).on('change', ev => {
            try { M.setJoinBlend(doc, node.id, ev.value ? parent.blend : null) } catch (e) { console.warn('[builder]', e.message); return }
            edited(null); onLabel(); onStructure(); again()
        })
        if (node.joinBlend == null) return
        const H = { get v() { return node.joinBlend }, set v(x) { A.joinBlend(parent, node, x); said(`scene/${node.id}/join/blend`) } }
        flagRow(folder.addBinding(H, 'v', { label: 'join blend', min: 0, max: 2, step: 0.001 }), `scene/${node.id}/join/blend`)
    }

    /* THE CODE EDITOR. PropertyTable's own multiline binding -- line numbers and the GLSL
       highlighter, which is close enough for WGSL's comments, numbers and operators -- bound
       straight to node.code, so its input handler writes the document itself.

       What it does not do is announce an edit: it is a readonly monitor underneath with the
       ticker disposed, so no 'change' ever fires. The editor therefore listens to the same
       textarea's input events for its own purposes.

       CHECK ON A PAUSE, APPLY ON REQUEST. Typing pauses run the probe compile, which does not
       touch the render, and the errors that belong to this node are listed under the editor
       at the line numbers in its gutter -- that mapping is the whole reason emit.js exists.
       Only Ctrl+Enter or the button applies, because setScene is seconds and a half-typed
       line should not cost them. */
    /* `owner` is the row the editor is shown on. It is not always the holder's id: the functions block's
       errors are reported against 'functions' while the scene's row shows it, and comparing the shown row
       with the holder's id stopped every check of the functions block at "checking..." -- its errors were
       never listed. */
    /* A FOLDER OF ITS OWN, WHICH FOLDS (the user, 2026-09-30): a new material's code block is fifteen lines of
       help, and a panel of three editors is mostly code. Folded or open is remembered per kind of code AND
       per whether it has any beyond comments -- one fold of an object's code must not hide every object's
       from then on -- and, never set, it is open when there is code and folded when there are only
       comments. The folder's title carries the check's verdict, so a folded one still says it is broken;
       the names in scope are the header's tooltip (a title is one line and would be cut). */
    /* `same`: the other nodes whose errors are this code's -- a block's other users (model.js version 16): the scene as
       data compiles a block once, its errors reported against the first node that uses it */
    function codeEditor(folder, node, { kind = 'object', title = 'code', names = '', owner = node.id, same = () => [] } = {}) {
        const lines = s => String(s || '').split('\n').length
        if (typeof node.code !== 'string') node.code = ''
        const key = `${kind}:${codeOnly(node.code).trim() ? 'code' : 'comments'}`
        const open = foldState()[key] ?? !!codeOnly(node.code).trim()
        const cf = folder.addFolder({ title, expanded: open })
        const head = cf.element.querySelector('.tp-fldv_b'), headText = cf.element.querySelector('.tp-fldv_t')
        if (head && names) head.title = names
        if (headText && names) headText.title = names
        cf.on('fold', ev => keepFold(key, ev.expanded))
        // a stale check may finish after the folder is gone: the title then is nobody's
        const verdict = text => { try { cf.title = text ? `${title} · ${text}` : title } catch { } }
        const b = cf.addBinding(node, 'code', {
            label: title, multiline: true, rows: Math.max(8, Math.min(24, lines(node.code) + 2)),
            highlighting: 'glsl', lineNumbers: true,
        })
        if (names) rowTip(b, `WGSL: ${names}. Ctrl+Enter applies it.`)
        const box = document.createElement('div')
        Object.assign(box.style, {
            font: '12px/1.35 monospace', whiteSpace: 'pre-wrap', padding: '4px 6px',
            margin: '2px 4px 6px', borderRadius: '3px', background: 'rgba(0,0,0,0.25)',
        })
        b.element.after(box)
        cf.addButton({ title: 'Apply code  (Ctrl+Enter)' }).on('click', () => onApply())

        let seq = 0, timer = 0
        const say = (text, color) => { box.textContent = text; box.style.color = color }
        const run = async () => {
            const mine = ++seq
            say('checking…', '#9e9e9e')
            let r
            try { r = await BUILDER.check({ quiet: true }) }
            catch (e) { if (mine === seq) say('check failed: ' + (e.message || e), '#ff8a80'); return }
            if (mine !== seq || shownId !== owner) return         // a newer edit, or moved on
            const ours = new Set([node.id, ...same()])
            const own = r.messages.filter(m => ours.has(m.node))
            const other = r.messages.filter(m => !ours.has(m.node) && m.type === 'error')
            const ownErrors = own.filter(m => m.type === 'error').length
            verdict(ownErrors ? `${ownErrors} error${ownErrors === 1 ? '' : 's'}` : own.length ? 'warnings' : '')
            if (!own.length && !other.length) return say('compiles clean', '#81c784')
            const out = own.map(m => `${m.type} line ${m.line}:${m.col}  ${m.message}`)
            /* Someone else's error still blocks the apply, so say where it is rather than
               letting "compiles clean" and a refused apply contradict each other. */
            if (other.length) out.push(`(and ${other.length} error(s) elsewhere: ` +
                other.slice(0, 2).map(m => m.node ? `${m.node}:${m.line}` : `generated line ${m.generatedLine}`).join(', ') + ')')
            say(out.join('\n'), own.some(m => m.type === 'error') || other.length ? '#ff8a80' : '#ffd54f')
        }

        /* The textarea is Tweakpane's and exists as soon as the binding does; PropertyTable
           rewires it on a zero timeout, so attach after that to see the final element. */
        setTimeout(() => {
            const ta = b.element.querySelector('textarea')
            if (!ta) return say('(editor not found -- PropertyTable changed?)', '#ff8a80')
            ta.addEventListener('input', () => {
                edited(`${node.id}.code`)       // a burst of typing is one undo step
                clearTimeout(timer); timer = setTimeout(run, 500)
            })
            ta.addEventListener('keydown', e => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onApply() }
                // a tab key that indents instead of leaving the field
                if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault()
                    ta.setRangeText('    ', ta.selectionStart, ta.selectionEnd, 'end')
                    ta.dispatchEvent(new Event('input'))
                }
            })
        }, 0)
        run()
    }

    return { show, shown: () => shownId, refresh: () => show(shownId) }
}
