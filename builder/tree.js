//======================================================================================================================
// TREE -- the builder's document, shown in the user's TreeView (lib/guistuff/treeview).
//
// A VIEW OF model.js, NOTHING MORE. The rows are rebuilt from BUILDER.doc after every change;
// a click changes the document through a model operation, by the row's id -- never by the
// tree's index path (the old builder addressed nodes by path, and after a delete its selection
// pointed at whichever node had moved into the gap).
//
// ONE SCENE, THE CURRENT ONE (project.js), AND ITS ROW AT THE ROOT: its groups and objects under it, and its
// Materials last. Its environment (the sun and sky, or the studio light: model.js ENVIRONMENT) had a row of its
// own first until 0.52.0; it is in the scene's own properties now, with the scene's radius beside it (the user,
// 2026-10-10), so a click on the scene's row shows it.
// THE SCENE'S ROW IS THE ROOT (the user, 2026-10-05). It went for three days (0.7.0: "it's kind of duplicated,
// since there is always one scene", the switcher over the tree naming it too), its + and settings moved
// beside the switcher as + and ⚙. Asked for back: a click on it shows the scene's settings in Properties,
// its + is in the + column as a group's is. The row over the tree names the PROJECT now (projectrow.js), so
// the scene is named once, here. The row has nothing else: the scenes' own operations are File's (filemenu.js).
// A CLICK ON A ROW SELECTS IT, AND ONLY ITS CHEVRON FOLDS IT (the user, 2026-10-05: "This makes it easier to edit
// properties"; TreeView's toggleOnClick false). TreeView folded a row with children on any click on it, so a group
// or a modifier picked to edit closed under the pointer, and the scene's row, clicked for its settings, closed the
// whole tree. A click on a chevron folds and changes no selection: Properties keeps what it shows.
// THE TREE NEVER SWITCHES SCENES (UI_PLAN.md section 10). Every scene of the project used to be a row
// here, and touching any row of another one made it current and compiled it -- seconds to twenty, for a
// stray click on something the user does rarely. The project's other scenes are in File now
// (filemenu.js; until 0.45.0 a dropdown over the tree), which uses this module's scene operations (sceneOps below) so each is
// one undo step, the selection kept honest, and a compile when the scene shown changes.
// Row ids are `key:id` (node ids are unique only within a scene); each row also carries its
// scene's key and its model id, and only those are used. Per row:
//   eye        model.setEnabled; a disabled group takes its whole subtree out of the shader
//   lock       model.setLock, both of a node's at once: a click on an open lock locks its position and its parameters,
//              a click on any lock opens both; the properties panel sets each alone, and a node with one shows a
//              dimmer lock. Not the shader's: an undo step and no compile
//   ⧉          model.duplicate -- a deep copy with fresh ids, right after the original; on a
//              material, model.duplicateMaterial
//   +          on the scene, a group, or Materials: TreeView's own child-type menu, then
//              model.addGroup / addObject / addMaterial
//   ×          model.remove / removeMaterial, no question asked -- it undoes; a material still in
//              use is refused, by name
//   drag       model.move (nodes), a reorder (materials)
//   right-click  COPY TO or MOVE TO another scene of the project (sendTo): the node, or the material,
//              goes in as an asset (model.extractAsset + insertAsset) -- fresh ids, with the materials
//              it uses, since ids and materials belong to their scene -- at that scene's top level. The
//              scene it goes to is not shown, so nothing compiles there; a move compiles this one.
//   Ctrl+C / Ctrl+V / Ctrl+D   copy the selected node or material, paste it at the selection
//              (inside a group or scene, after an object, into Materials), duplicate it. The
//              clipboard is an asset -- a snapshot -- so it pastes into any scene, after a switch.
//              It goes through the SYSTEM clipboard too, as JSON (the copy and paste events), so it
//              also pastes in another tab, another project, or after a reload.
//
// THE WIDGET MUTATES ITS OWN COPY, and that copy is thrown away. TreeView's add pushes a
// placeholder row into its data and its drop moves a JSON clone of the row; both would be
// the document's truth in the old builder. Here an add is replayed as a model call and the
// tree rebuilt from the model; a drop is read back -- where did the widget put the row? --
// and replayed as model.move with that parent and index. The widget decides WHERE, which is
// what it is good at (before / after / inside, the insertion line); the model decides WHAT.
//
// A LIBRARY ITEM BEING EDITED (library/edit.js) is a scene of the project marked `doc.libraryItem`. While it
// is the current one the tree shows ONLY it, under a "back to <scene>" row that closes it: the user asked for
// the item isolated until it is saved or closed (2026-09-30). Save and Close are the strip's over the view
// (and the back row's, the host's onItem). Nothing else is special: its nodes and materials are rows like
// any others, which is why an item is edited in a scene at all.
//
// ROW TYPE = WHAT CAN BE DROPPED; addMenu = WHAT + OFFERS. TreeView's allowedChildren is the drop
// rule, and its addMenu (GUISTUFF, grouped entries carrying a value) is the menu. They used to be
// one list, which forced every menu entry -- every material preset -- to be a droppable row type.
// Object rows are typed by object type, and there is one: 'code' -- a sphere is a code node that
// started as one (primitives.js).
//======================================================================================================================

import { TreeView } from '../lib/guistuff/treeview/treeview.js'
import { icons } from '../lib/guistuff/treeview/icons.js'
import { NODE_TYPES as OBJECT_TYPES, OBJECT_CODE_TEMPLATE, codeOnly, isCsg, joinOf, joinSummary } from './codegen.js'
import { GLYPH, handlesOf, baseOf, summaryOf } from './recipe.js'
import { PRESETS } from './materials.js'
import { MODIFIERS, modifierGroup } from './modifiers.js'
import { primitiveObject, shapeMenu } from './primitives.js'
import { LIGHT_SHAPES } from './lights.js'
import { defaultMaterial, lockOf, groupHasCode } from './model.js'
import { estimateBox } from './bounds.js'
import { popupMenu } from '../lib/shell/menu.js'

const CHILDREN = ['group', ...Object.keys(OBJECT_TYPES)]
/* What + on the scene or a group offers. `value` is what onAdd receives. A shape is a code node
   that starts as one of primitives.js's, so every entry makes a row of type 'code'. */
const NODE_MENU = [
    { label: 'Add group', type: 'group', value: 'group' },
    /* in their groups (primitives.js SHAPE_GROUPS): Primitives, Optics, From points -- a submenu each */
    { label: 'Shapes', items: [
        ...shapeMenu().map(g => ({ label: g.label, items: g.keys.map(k => ({ label: k, type: 'code', value: `prim:${k}` })) })),
        { label: 'code (WGSL)', type: 'code', value: 'code' },
    ] },
    /* a modifier is a group whose code starts as one of modifiers.js's; put shapes in it */
    { label: 'Modifiers', items: Object.entries(MODIFIERS).map(([k, m]) => ({ label: m.label, type: 'group', value: `mod:${k}` })) },
    /* a light is not a code node (lights.js): its shape has to stay known */
    { label: 'Lights', items: Object.entries(LIGHT_SHAPES).map(([k, s]) => ({ label: s.label, type: 'light', value: `light:${k}` })) },
    /* the part of the scene a 3MF / STL export takes (exportbox.js): draws nothing */
    { label: 'Export box (3MF / STL)', type: 'export', value: 'export' },
    /* dust in the air inside it (hazebox.js, the renderer's core/haze.js): draws nothing; one a scene */
    { label: 'Haze box (dust in the air)', type: 'haze', value: 'haze' },
    /* everything above and more -- a lens in its glass, an LED, one's own -- in the Library panel */
    { label: 'From the library…', type: 'library', value: 'library' },
]
const MATERIAL_MENU = [
    { label: 'Add material', items: Object.entries(PRESETS).map(([k, p]) => ({ label: p.label, type: 'material', value: k })) },
]
const objectRow = { default: icons.component, allowedChildren: [], svgStyle: { color: '#AAF' },
    defaultToggles: { enabled: true, duplicate: true, delete: true } }

/* THE SCENE'S ROW: its + alone, in the + column as a group's (TreeView keeps a column empty where a row has no
   toggle). No eye, lock, duplicate or delete: the scenes' own operations are File's (filemenu.js), with the
   other scenes listed -- a × on the only scene the tree shows would delete it out of sight of the ones left. A
   library item's row is the same (its Save and Close are the strip's over the view). */
const sceneType = (icon, color) => ({ default: icon, allowedChildren: CHILDREN, addMenu: NODE_MENU, svgStyle: { color },
    defaultToggles: { add: true } })
const NODE_TYPES = {
    // the widget's own top level: the scene's row (and the back row above an item, which no drop moves)
    root: { allowedChildren: ['scene', 'sceneItem'] },
    scene: sceneType(icons.folder, '#ff8f00'),
    sceneItem: sceneType(icons.component, '#81c784'),      // a library item being edited (library/edit.js)
    // the row above an item being edited: a click closes it (asking first if it is not saved)
    back: { default: icons.chevronRight, allowedChildren: [], svgStyle: { color: '#bdbdbd', transform: 'rotate(180deg)' }, defaultToggles: {} },
    group: { default: icons.folder, allowedChildren: CHILDREN, addMenu: NODE_MENU, svgStyle: { color: '#ffb74d' },
        defaultToggles: { enabled: true, duplicate: true, add: true, delete: true } },
    ...Object.fromEntries(Object.keys(OBJECT_TYPES).map(t => [t, objectRow])),
    materials: { default: icons.layer, allowedChildren: ['material'], addMenu: MATERIAL_MENU, svgStyle: { color: '#9e9e9e' },
        defaultToggles: { add: true } },
    material: { default: icons.document, allowedChildren: [], svgStyle: { color: '#81c784' },
        defaultToggles: { duplicate: true, delete: true } },
}

const TOGGLES = {
    /* ACTION toggles have no values: the tree calls onToggleClick with 'action' -- except
       'add', which TreeView handles itself (its addMenu, then onNodeAdd with the entry's value). */
    enabled: {
        label: 'Enabled', icons: { true: icons.eye, false: icons.eyeSlash }, values: [true, false],
        styles: { true: { color: '#2196f3' }, false: { color: '#757575' } },
    },
    /* WHAT A HAND MAY CHANGE (model.js setLock). TreeView cycles `values` itself: from an open lock to both locked, and
       from both -- or from one alone, which is in no list and so goes back to the first -- to open */
    lock: {
        label: 'Lock against edits by hand (a click locks its position and parameters, or opens both; the properties panel sets each)',
        values: ['unlocked', 'locked'],
        icons: { unlocked: icons.lockOpen, locked: icons.lock, 'position locked': icons.lock, 'parameters locked': icons.lock },
        styles: { unlocked: { color: '#5f6368' }, locked: { color: '#ffcc33' },
                  'position locked': { color: '#a68a3c' }, 'parameters locked': { color: '#a68a3c' } },
    },
    duplicate: { label: 'Duplicate', icons: '⧉', values: [], styles: { default: { color: '#bdbdbd' } } },
    add: { label: 'Add…', icons: icons.plus, values: [], styles: { default: { color: '#fff' } } },
    delete: { label: 'Delete', icons: icons.xMark, values: [], styles: { default: { color: '#e57373' } } },
    /* HOW A CHILD JOINS THE OTHERS IN ITS GROUP (model version 14), read top to bottom: a click cycles it --
       TreeView cycles a toggle's values itself (treeview.js _handleToggleClick) and onToggleClick writes the
       model. On every shape of a group, a plain one's too: a click there is how a plain group becomes a
       boolean one. The base shows ● and joins nothing (a click on it is refused); hidden (null) at the top
       level, which is always a plain union, and on a light or an export box, which are not shapes of it. */
    join: {
        label: 'How it joins the others in its group (click: union, subtract, intersect)', values: ['union', 'subtract', 'intersect'],
        icons: { union: GLYPH.union, subtract: GLYPH.subtract, intersect: GLYPH.intersect, base: GLYPH.base },
        styles: { union: { color: '#90caf9', fontWeight: '600' }, subtract: { color: '#ff8a65', fontWeight: '600' },
                  intersect: { color: '#80cbc4', fontWeight: '600' }, base: { color: '#9e9e9e' } },
    },
}
const TOGGLE_ORDER = ['join', 'enabled', 'lock', 'duplicate', 'add', 'delete']
/** A node's lock as its toggle shows it (TOGGLES.lock). */
export const lockToggle = n => {
    const L = lockOf(n)
    return L.position && L.params ? 'locked' : L.position ? 'position locked' : L.params ? 'parameters locked' : 'unlocked'
}

/* WHAT THE TREE PUTS ON THE SYSTEM CLIPBOARD: an asset (model.extractAsset), marked so a paste knows its own from
   any other text there. clipAsset reads one back: an asset, or null for anything else. */
export const CLIP_FORMAT = 'raytracer-asset'
export function clipAsset(text) {
    if (!text || text[0] !== '{') return null
    try {
        const o = JSON.parse(text)
        const a = o?.format === CLIP_FORMAT ? o.asset : null
        return a && ((a.kind === 'node' && a.node?.kind) || (a.kind === 'material' && a.material)) ? a : null
    } catch { return null }
}

/** A code node starts with how to use it and something that compiles and shows. */
const NEW_CODE = OBJECT_CODE_TEMPLATE

/** Tree rows for the CURRENT scene of a project: its row, always open, holding its Environment, its nodes
 *  and then its Materials. `collapsed` holds the row ids the user folded, so a rebuild does not unfold them
 *  again. While it is a library item being edited, under a row back to the scene it came from. */
export function rowsFor(project, { current = project.scenes[0]?.key, collapsed = new Set() } = {}) {
    const cur = project.scenes.find(s => s.key === current) ?? project.scenes[0]
    const item = cur?.doc.libraryItem
    const rows = (cur ? [cur] : []).map(({ key, doc }) => {
        const rid = id => `${key}:${id}`
        const at = (id, rest) => ({ id: rid(id), mid: id, scene: key, ...rest })
        // an object wearing none is on the shader's built-in grey -- not "default", which is now a material's mark
        const matLabel = id => doc.materials.find(m => m.id === id)?.label || 'no material'
        const dflt = defaultMaterial(doc)?.id
        /* a group's row says how it combines, if not plainly -- `a ∪ b ∪ c − d`, the recipe in one line, by the
           letters its children show (recipe.js) -- and that it has code */
        const groupNote = n => [isCsg(n) ? `${summaryOf(n)}${joinSummary(n).smooth ? ' (smooth)' : ''}` : null,
            groupHasCode(doc, n) ? 'code' : null, n.copies?.length ? `× ${n.copies.length}` : null].filter(Boolean).join(', ')
        /* A CHILD OF A GROUP (model version 14): its join as a toggle (TOGGLES.join) on every shape of a group;
           and in a boolean group, read top to bottom in the label too -- `● a  Plate`, `− d  Hole · blend 0.02`
           -- with the letter the recipe and the group's row call it by. The base is the first SHOWN shape:
           what codegen takes once hidden nodes are pruned. */
        const handles = new Map()
        const handleIn = (g, id) => { if (!handles.has(g)) handles.set(g, handlesOf(g)); return handles.get(g).get(id) }
        const joinOn = (n, parent) => {
            if (!parent || parent === doc.root || n.type === 'light' || n.type === 'export' || n.type === 'haze') return { toggle: null, mark: '', own: '' }
            const base = baseOf(parent)?.id === n.id, how = base ? 'base' : joinOf(n)
            if (!isCsg(parent)) return { toggle: how, mark: '', own: '' }
            return { toggle: how, mark: `${GLYPH[how]} ${handleIn(parent, n.id)}  `, own: !base && n.joinBlend != null ? `  · blend ${n.joinBlend}` : '' }
        }
        /* ◆ AFTER A ROW WITH A VALUE FLAGGED ANIMATED (model.js setAnimated): where to look for it, from the tree */
        const anim = o => Array.isArray(o?.animate) && o.animate.length ? '  \u25C6' : ''
        const row = (n, parent) => {
            const j = joinOn(n, parent)
            return n.kind === 'group'
                ? at(n.id, { label: `${j.mark}${groupNote(n) ? `${n.label}  · ${groupNote(n)}` : n.label}${j.own}${anim(n)}`,
                    type: 'group', expanded: !collapsed.has(rid(n.id)),
                    toggles: { enabled: n.enabled, lock: lockToggle(n), join: j.toggle }, children: n.children.map(c => row(c, n)) })
                : at(n.id, { label: `${j.mark}${n.label}  · ${n.type === 'export' ? 'export' : n.type === 'haze' ? 'haze' : matLabel(n.material)}${j.own}${anim(n)}`,
                    type: n.type, toggles: { enabled: n.enabled, lock: lockToggle(n), join: j.toggle } })
        }
        return at(doc.root.id, {
            label: doc.title, type: doc.libraryItem ? 'sceneItem' : 'scene', expanded: !collapsed.has(rid(doc.root.id)),
            children: [
                ...doc.root.children.map(c => row(c, doc.root)),
                at('#materials', { label: 'Materials', type: 'materials', expanded: !collapsed.has(rid('#materials')),
                    children: doc.materials.map(m => at(m.id, {
                        /* what it has beyond its fields: code, and a relief -- which is shape, on everything wearing it;
                           and whether it is what + makes a new object of (model.defaultMaterial) */
                        label: [m.label, [m.id === dflt ? 'default' : null, codeOnly(m.code).trim() ? 'code' : null,
                            m.relief ? 'relief' : null].filter(Boolean).join(', ')]
                            .filter(Boolean).join('  · ') + anim(m), type: 'material' })) }),
            ],
        })
    })
    if (!item) return rows
    const from = project.scenes.find(s => s.key === item.from && !s.doc.libraryItem)
    return [{ id: '#back', mid: null, scene: current, type: 'back', label: `back to ${from ? from.doc.title : 'the scenes'}` }, ...rows]
}

/** A position among a row's children in the WIDGET -- where a drop landed, where a paste goes -- as a
 *  position among its NODES, which is what model.move and insertAsset count. A scene's row holds a
 *  row that is not a node, Materials, last -- and until 0.52.0 the Environment first; counted in, every
 *  node dropped at a scene's top level would land one place further down than it was shown (the drop
 *  test caught this the moment the Environment row appeared). The back row above an item is not one either. */
const NOT_NODES = new Set(['materials', 'back'])
export const nodeIndex = (parentRow, index) => index == null ? index
    : parentRow.children.slice(0, index).filter(r => !NOT_NODES.has(r.type)).length

/** Where a row ended up in the widget's data after a drop: its parent row and its index. */
export function placeOf(rows, id, parent = null) {
    for (let i = 0; i < rows.length; i++) {
        if (rows[i].id === id) return { parent, index: i }
        const q = rows[i].children ? placeOf(rows[i].children, id, rows[i]) : null
        if (q) return q
    }
    return null
}

/**
 * @param container   the element to put the tree in
 * @param BUILDER     installBuilder's object: project, current, use(), doc, model, apply()
 * @param onStatus    (text) => void, for a one-line status the host shows somewhere
 * @param onSelect    (id | null) => void, the model id of the row clicked (null for a header), in
 *                    BUILDER.doc -- which is that row's scene by the time this is called
 * @param onStructure () => void, the shader text changed; defaults to apply()
 * @param onLibrary   () => void, the + menu's "From the library…": the host shows its Library panel
 * @param onItem      (what, key) => void, a library item's scene asked to 'close' (its back row; library/edit.js)
 * @param onFocus     (id) => void, a node's row double-clicked: the host brings the camera to it (focus.js)
 * @returns { apply, rebuild, newScene, select, insertAsset, selectedAsset, dropAsset, acceptLibrary,
 *            openScene, closeScene, enterScene, sceneOps, sendTo } -- rebuild() after the project changes or
 *          is replaced; select(id) selects a node of the current scene as a click on its row would (the
 *          scene's root id: its own row); insertAsset(asset) puts an asset where a paste would go;
 *          selectedAsset() is the selected row as { asset, name }, or null; sceneOps File's
 *          (filemenu.js); sendTo(id, key, { move }) copies or moves a node or material of the current scene
 *          to scene `key`
 */
export function installBuilderTree(container, BUILDER, { onStatus = () => { }, onSelect = () => { }, onStructure, onLibrary = null, onItem = null, onFocus = null } = {}) {
    const M = BUILDER.model

    /* ONE COMPILE AT A TIME. A second click while setScene is still building would start a
       second rebuild over the first; the later state wins anyway, so remember that one more
       is wanted and run it once the current one lands. */
    let busy = false, again = false
    const apply = async () => {
        if (busy) { again = true; return }
        busy = true
        try {
            do {
                again = false
                onStatus(`compiling ${BUILDER.doc.title}…`)
                const r = await BUILDER.apply()
                /* what is wrong, in the status itself -- its first line names the node and the line (validate.js) --
                   and the picture stays the last scene that compiled */
                const why = String(r.report ?? '').split('\n').find(l => l.trim())
                onStatus(r.ok ? BUILDER.doc.title : `${BUILDER.doc.title} does NOT compile${why ? `: ${why.trim()}` : ''} -- the picture is the last that did (console: all of it)`)
            } while (again)
        } catch (e) {
            console.error('[builder tree]', e)
            onStatus('FAILED: ' + (e.message || e))
        } finally { busy = false }
    }
    const structure = onStructure || apply

    /* SELECTION IS KEPT BY ROW ID. TreeView keys its selection by index path and forgets it on
       a rebuild; a label edit rebuilds, and losing the highlight on every keystroke in the
       label field would be absurd. So the id is remembered here and its current path looked
       up after each rebuild -- which also means a selection survives a move. */
    let selectedId = null
    const collapsed = new Set()
    const midOf = rowId => rowId == null ? null : rowId.slice(rowId.indexOf(':') + 1)
    const here = id => id == null ? null : `${BUILDER.current}:${id}`
    const pathOf = (rows, id, prefix = '') => {
        for (let i = 0; i < rows.length; i++) {
            const p = prefix ? `${prefix}.${i}` : `${i}`
            if (rows[i].id === id) return p
            const q = rows[i].children ? pathOf(rows[i].children, id, p) : null
            if (q) return q
        }
        return null
    }

    const rowAt = (rows, path) => String(path).split('.').map(Number)
        .reduce((r, i, k) => (k === 0 ? rows : r?.children)?.[i], null)

    /** Make a scene current. True if that changed anything -- the caller then owes a compile. */
    const enter = key => {
        if (!key || BUILDER.current === key) return false
        BUILDER.use(key)
        return true
    }
    const selectedMid = () => { const m = midOf(selectedId); return m === '#materials' ? null : m }

    /** Run a model operation on a row's scene; on success redraw and recompile, on refusal say
     *  why and redraw anyway, since the widget may already be showing what it wished had
     *  happened. `select` is a model id in the (now current) scene, or a function of the result
     *  giving one. */
    const edit = (what, fn, { scene, select, shader = true } = {}) => {
        const switched = enter(scene)
        try {
            const out = fn()
            BUILDER.commit?.()                      // one undo step per tree operation
            if (select !== undefined) selectedId = here(typeof select === 'function' ? select(out) : select)
            rebuild()
            onSelect(selectedMid())
            if (shader || switched) structure()
            return out
        } catch (e) {
            if (!e?.problems) console.error('[builder tree]', e)
            onStatus(`${what}: ${e.message || e}`)
            rebuild()
            if (switched) { onSelect(selectedMid()); structure() }
        }
    }
    /* "leave the selection alone" -- if it is in the scene being edited; one in another scene
       would name a node of the wrong document once the edit has switched to this one */
    const keep = scene => selectedId?.startsWith(`${scene}:`) ? selectedMid() : null

    const onAdd = (parentRow, placeholder, action, type, value) => {
        const doc = () => BUILDER.doc               // after enter(), the row's scene
        const scene = parentRow.scene
        /* the library is a panel of its own (library/panel.js): open it, and drop the row the widget
           made for what was about to be added */
        if (value === 'library') { rebuild(); if (onLibrary) onLibrary(); else onStatus('no library in this page'); return }
        /* a new material is used by nothing yet, so the shader does not change until an
           object picks it -- which is structural and applies then */
        if (parentRow.type === 'materials')
            return edit('add material', () => M.addMaterial(doc(), { preset: PRESETS[value] ? value : 'diffuse' }),
                { scene, select: m => m.id, shader: false })
        /* a modifier has code, so it changes the shader even with no children to call */
        const mod = typeof value === 'string' && value.startsWith('mod:') ? modifierGroup(value.slice(4)) : null
        if (mod)
            return edit(`add ${mod.label}`, () => M.addGroup(doc(), parentRow.mid, mod), { scene, select: n => n.id })
        if (type === 'group')
            return edit('add group', () => M.addGroup(doc(), parentRow.mid, { label: 'group' }),
                { scene, select: n => n.id, shader: false })          // an empty group emits nothing
        /* a light draws a sheet (a ray file nothing), so the shader changes */
        if (typeof value === 'string' && value.startsWith('light:'))
            return edit(`add ${value.slice(6)} light`, () => M.addLight(doc(), parentRow.mid, { shape: value.slice(6) }),
                { scene, select: n => n.id })
        /* an export box draws nothing, but declares uniforms (its transform, its size), so it applies */
        if (value === 'export')
            return edit('add export box', () => M.addExportBox(doc(), parentRow.mid), { scene, select: n => n.id })
        /* a haze box draws nothing either, but its presence is the kernels' text (core/haze.js): it applies */
        if (value === 'haze')
            return edit('add haze box', () => M.addHazeBox(doc(), parentRow.mid), { scene, select: n => n.id })
        const prim = typeof value === 'string' && value.startsWith('prim:') ? primitiveObject(value.slice(5)) : null
        // wearing the scene's default material (model.defaultMaterial: the first surface in its list)
        edit(`add ${prim ? prim.label : 'code'}`, () => M.addObject(doc(), parentRow.mid,
            { ...(prim ?? { label: 'code', code: NEW_CODE }), material: M.defaultMaterial(doc())?.id }),
            { scene, select: n => n.id })
    }

    /* SCENES. Removing the current one moves to the one before; duplicating one moves to the copy,
       which is what a copy is made for -- unless asked not to (a scene card's Duplicate of another scene).
       Each is one undo step, like any other edit, committed as a change to the list of scenes: its undo stays on
       the scene being worked on (demo.js restore; the user, 2026-10-17: "undo stays put"). */
    // a library item's scene is a scene too: pasting into it, copying out of it, dropping on it
    const isScene = row => row?.type === 'scene' || row?.type === 'sceneItem'
    // the scene being worked on: its row, the one at the root (the back row above an item is not it)
    const sceneRow = () => tree.options.data.find(isScene)
    const P = BUILDER.projectModel
    const sceneEdit = (what, fn, { follow = false } = {}) => {
        const was = BUILDER.current
        try {
            const next = fn()
            if (next && next !== BUILDER.current) BUILDER.use(next)
            BUILDER.commit?.(null, { scenes: what, was, ...(follow ? { follow } : {}) })
            if (BUILDER.current !== was) selectedId = here(BUILDER.doc.root.id)
            rebuild()
            onSelect(selectedMid())
            if (BUILDER.current !== was) structure()
        } catch (e) {
            if (!e?.problems) console.error('[builder tree]', e)
            onStatus(`${what}: ${e.message || e}`)
            rebuild()
        }
    }
    const newScene = () => sceneEdit('new scene', () => P.newScene(BUILDER.project, 'New scene',
        P.indexOf(BUILDER.project, BUILDER.current) + 1).key)
    /* A LIBRARY ITEM'S SCENE (library/edit.js), in and out through sceneEdit as any scene: one undo step
       each, the selection kept honest, compiled. Closing one that is the last scene first adds an empty
       one -- the project always has one to show -- and goes to the scene it came from if that is still
       there, else the one before it. */
    /* ...and, a mode entered or left rather than a list changed, its undo follows it (`follow`): undoing a close opens
       the item again, as it was */
    const openScene = doc => sceneEdit(`open ${doc.title}`, () => P.addScene(BUILDER.project, doc, P.indexOf(BUILDER.project, BUILDER.current) + 1).key, { follow: true })
    const closeScene = (key, goTo = null) => sceneEdit('close', () => {
        const p = BUILDER.project
        if (p.scenes.length === 1) P.newScene(p, 'New scene')
        const i = P.indexOf(p, key)
        const next = goTo && goTo !== key && P.scene(p, goTo) ? goTo : p.scenes[i > 0 ? i - 1 : i + 1].key
        P.removeScene(p, key)
        return next
    }, { follow: true })
    const enterScene = key => { if (enter(key)) { selectedId = here(BUILDER.doc.root.id); rebuild(); onSelect(selectedMid()); apply() } }
    /* THE SCENES' OPERATIONS (the scene cards', builder/scenestrip.js, and the Project panel's), each through
       sceneEdit: one undo step, and a compile when the scene being worked on changes. A rename touches no shader;
       it is the scene row's label, as Properties renames it. */
    const sceneOps = {
        enter: enterScene,
        add: newScene,
        // { go: false }: the copy is made beside its original and the scene being worked on stays (a card's ⋯)
        duplicate: (key, { go = true } = {}) => sceneEdit('duplicate scene', () => {
            const c = P.duplicateScene(BUILDER.project, key)
            return go ? c.key : null
        }),
        /* no confirmation, as for any delete: it is one undo step. The current one gone, the one before it
           is shown (for a copy, its original); the last scene is refused, by the project */
        remove: key => sceneEdit('delete scene', () => {
            const p = BUILDER.project, i = P.indexOf(p, key)
            P.removeScene(p, key)
            return key === BUILDER.current ? p.scenes[Math.max(0, i - 1)].key : null
        }),
        move: (key, index) => sceneEdit('reorder scenes', () => { P.moveScene(BUILDER.project, key, index) }),
        rename: (key, title) => sceneEdit('rename scene', () => {
            const d = P.scene(BUILDER.project, key)?.doc
            const t = String(title ?? '').trim()
            if (!d || !t) return
            M.rename(d, d.root.id, t)
            d.title = t
        }),
    }

    /* NO CONFIRMATION: a delete is one undo step (Ctrl+Z, or Undo on the Builder page), which
       is better than a question asked every time -- it was asked only because there was no
       undo. A material still in use is still refused, by the model, naming its users. */
    const onDelete = row => {
        if (isScene(row)) return                    // File's (sceneOps.remove)
        const scene = row.scene, keepSel = selectedId === row.id ? null : keep(scene)
        if (row.type === 'material')
            return edit('delete material', () => M.removeMaterial(BUILDER.doc, row.mid),
                { scene, select: keepSel, shader: false })
        edit('delete', () => M.remove(BUILDER.doc, row.mid), { scene, select: keepSel })
    }

    /* A DROP IS READ BACK, NOT TRUSTED. By the time onNodeDrop fires the widget has already
       moved a clone of the row in its own data; where it put it -- which parent, which index
       -- is the whole of what the drop means, and the model is told exactly that. */
    /* A ROW BEING DRAGGED, for a drop outside the tree (a scene card, builder/scenestrip.js: copied into that scene,
       moved with Shift). TreeView tells its start and end and carries only the row's index path in the drag's data,
       so the row is kept here and asked for (draggedRow). Only a row Copy to would take; cleared at the end, and by
       the taker (its drop runs before a dragend, which a rebuild may leave without its source). */
    let dragging = null
    const onDrop = (from, to, action, draggedRow) => {
        if (action === 'dragstart') { dragging = copyable(draggedRow) && draggedRow.scene === BUILDER.current ? draggedRow : null; return }
        if (action === 'dragend') { dragging = null; return }
        if (action === 'drop_failed') return onStatus('cannot drop there')
        if (action !== 'drop' || !draggedRow?.id) return
        const place = placeOf(tree.options.data, draggedRow.id)
        if (!place) return rebuild()
        /* the Environment, Materials and the back row are not nodes: they stay where they are; the scene's row has
           nowhere to go (the menu orders scenes), and nothing goes beside it */
        if (NOT_NODES.has(draggedRow.type) || isScene(draggedRow) || !place.parent) return rebuild()
        const parent = place.parent
        const scene = draggedRow.scene
        if (draggedRow.type === 'material') {
            // materials are a flat list: adopt the widget's order, nothing else can have changed
            const order = parent.children.map(r => r.mid)
            return edit('reorder materials', () => {
                BUILDER.doc.materials.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
            }, { scene, select: keep(scene) })
        }
        /* a material is only ever among Materials (the widget's rule), so a parent that is not Materials is a node's */
        if (parent.type === 'materials') return rebuild()
        edit('move', () => M.move(BUILDER.doc, draggedRow.mid, parent.mid, nodeIndex(parent, place.index)), { scene, select: keep(scene) })
    }

    /* ONE PASTE FOR EVERYTHING: Ctrl+V, the library's put-in. `at` is the row it goes under
       (a scene, a group, or Materials) in the scene that receives it. A material changes no
       shader until something uses it; a node's materials ride along without compiling anything
       either, but the node itself does. */
    // `index` is the widget's, among `at`'s rows
    const paste = (asset, at, index) => edit(`paste into ${P.scene(BUILDER.project, at.scene)?.doc.title}`,
        () => generic(asset, M.insertAsset(BUILDER.doc, asset, at.type === 'materials' ? null : at.mid, nodeIndex(at, index))),
        { scene: at.scene, select: x => x.id, shader: asset.kind === 'node' })
    /* A SHAPE OF NO SIZE OF ITS OWN (the library's generic shapes and modifiers, unit null) is what +
       makes, from the library: it wears the scene's default as + does. A copy of the user's -- a
       paste, an item of their own -- keeps what it had, no material included. */
    const generic = (asset, n) => asset.kind === 'node' && asset.unit === null ? M.wearDefault(BUILDER.doc, n) : n
    const duplicate = row => row.type === 'material'
        ? edit('duplicate material', () => M.duplicateMaterial(BUILDER.doc, row.mid), { scene: row.scene, select: m => m.id, shader: false })
        : edit('duplicate', () => M.duplicate(BUILDER.doc, row.mid), { scene: row.scene, select: n => n.id })

    /* THE CLIPBOARD holds an asset, not a row: a snapshot of what was copied, so it pastes as it
       was when copied, into any scene, even after the original has been edited or deleted. It is
       ALSO on the system clipboard, as JSON marked with CLIP_FORMAT, so it pastes in another tab or
       after a reload (UI_PLAN.md section 10); what is there wins at a paste, being the newer. */
    let clipboard = null
    const selectedRow = () => {
        const p = selectedId == null || !tree ? null : pathOf(tree.options.data, selectedId)
        return p == null ? null : rowAt(tree.options.data, p)
    }
    /** Where a paste of `kind` goes, given the selected row: [row it goes under, index]. */
    const pasteTarget = kind => {
        const sel = selectedRow()
        const top = sceneRow()
        const materialsRow = top.children.find(r => r.type === 'materials')
        if (kind === 'material') {
            const at = sel?.type === 'material' ? placeOf(tree.options.data, sel.id) : null
            return [materialsRow, at ? at.index + 1 : undefined]
        }
        if (!sel || NOT_NODES.has(sel.type) || sel.type === 'material') return [top, undefined]
        if (isScene(sel) || sel.type === 'group') return [sel, undefined]
        const at = placeOf(tree.options.data, sel.id)          // an object: right after it
        return [at.parent, at.index + 1]
    }
    const typing = t => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
    const copyable = row => !!row && !isScene(row) && row.type !== 'materials' && row.type !== 'back'
    /* whether a Ctrl+C / V / D is the tree's: not while typing, and not while the Scene panel is not the one showing
       -- a duplicate nobody can see is no edit */
    const ours = e => !typing(e.target) && !!tree && !!container.offsetParent
    /* COPY AND PASTE ARE THE BROWSER'S EVENTS, not keys: only in them may a page write and read the system clipboard
       without asking for permission. A Ctrl+C or Ctrl+V with its default prevented never makes the event -- which
       is why their keys are let through (the keydown below only keeps a copy for this page as well). */
    window.addEventListener('copy', e => {
        if (!ours(e)) return
        // text selected on the page is what Ctrl+C means then, not the tree's row
        if (String(window.getSelection?.() ?? '')) return
        const row = selectedRow()
        if (!copyable(row)) return
        try {
            clipboard = M.extractAsset(BUILDER.doc, row.mid)
            e.clipboardData?.setData('text/plain', JSON.stringify({ format: CLIP_FORMAT, asset: clipboard }))
            e.preventDefault()
            onStatus(`copied ${clipboard.kind === 'material' ? clipboard.material.label : clipboard.node.label}`)
        } catch (err) { onStatus(`copy: ${err.message || err}`) }
    })
    window.addEventListener('paste', e => {
        if (!ours(e)) return
        const asset = clipAsset(e.clipboardData?.getData('text/plain')) ?? clipboard
        if (!asset) return
        e.preventDefault()
        clipboard = asset
        paste(structuredClone(asset), ...pasteTarget(asset.kind))
    })
    window.addEventListener('keydown', e => {
        if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || !ours(e)) return
        const k = e.key.toLowerCase(), row = selectedRow()
        if (!copyable(row)) return
        /* Ctrl+C: the copy here too, NOT prevented -- the copy event still comes, and writes the system clipboard; a
           browser that sends none without a text selection still has the copy for this page */
        if (k === 'c' && !String(window.getSelection?.() ?? '')) { try { clipboard = M.extractAsset(BUILDER.doc, row.mid) } catch { } }
        if (k !== 'd') return
        e.preventDefault()                      // the browser's bookmark, otherwise
        duplicate(row)
    })

    /* COPY TO, MOVE TO ANOTHER SCENE without seeing it (UI_PLAN.md section 10): what the drag between scenes did
       when every scene was in the tree. Into that scene's top level -- or its materials, for a material -- as an
       asset, so with fresh ids and the materials it uses. That scene is not shown, so nothing compiles for it; a
       move takes the node out of this one, which does compile. ONE undo step, both scenes together, committed as a
       change to the list of scenes: its undo takes the copy back out of that scene and stays on this one (demo.js
       restore; until 0.63.0 it switched to that scene, a compile). A material still worn here cannot move. */
    const sendTo = (id, key, { move = false } = {}) => {
        const p = BUILDER.project, to = P.scene(p, key), from = P.scene(p, BUILDER.current)
        if (!to || key === BUILDER.current) return null
        // nothing half done: on a refusal both scenes go back to these, as an undo would put them
        const was = { to: structuredClone(to.doc), from: structuredClone(from.doc) }
        const isMat = !!M.material(from.doc, id)
        try {
            const asset = M.extractAsset(from.doc, id)
            if (move) isMat ? M.removeMaterial(from.doc, id) : M.remove(from.doc, id)
            const n = M.insertAsset(to.doc, asset, isMat ? null : to.doc.root.id)
            BUILDER.commit?.(null, { scenes: move ? 'move to' : 'copy to', was: BUILDER.current })
            const name = asset.kind === 'material' ? asset.material.label : asset.node.label
            onStatus(`${move ? 'moved' : 'copied'} ${name} to ${to.doc.title}`)
            if (move && selectedMid() === id) selectedId = null
            rebuild()
            onSelect(selectedMid())
            if (move && !isMat) structure()
            return n
        } catch (e) {
            to.doc = was.to; from.doc = was.from
            if (!e?.problems) console.error('[builder tree]', e)
            onStatus(`${move ? 'move' : 'copy'} to ${to.doc.title}: ${e.message || e}`)
            rebuild()
            return null
        }
    }
    /* A DOUBLE-CLICK ON A NODE'S ROW BRINGS THE CAMERA TO IT (the user, 2026-10-02; the host's onFocus, focus.js). The
       first click has selected it. NOT A 'dblclick' LISTENER: TreeView drew the rows anew when one with children was
       clicked (it opened or closed; the second click put it back -- before toggleOnClick false, and still on a
       chevron), and Chromium sends no dblclick when the element of the second click is not the first's -- a group's
       double-click did nothing (tree.check.mjs). The second CLICK
       says it is one (detail 2), and is seen here, on the way down: TreeView stops each row's click from going up.
       THE SAME ROW BOTH TIMES, by its id, not its place: a first click that rebuilds the tree (the back row out of a
       library item) leaves another row under the pointer for the second. Not on the eye, the lock or the other marks:
       a double-click there is two toggles. Not on a material, a scene or the back row: nothing to see. */
    const presses = [null, null]
    container.addEventListener('pointerdown', e => {
        const el = e.target.closest?.('[data-path]')
        presses.shift(); presses.push(el && tree ? rowAt(tree.options.data, el.dataset.path)?.id ?? null : null)
    }, true)
    container.addEventListener('click', e => {
        // not on a chevron either: a double-click there is a fold and an unfold
        if (e.detail !== 2 || !onFocus || e.target.closest?.('.treeview-property-toggle, .treeview-expand-icon')) return
        const el = e.target.closest?.('[data-path]')
        const row = el && tree ? rowAt(tree.options.data, el.dataset.path) : null
        if (!row?.mid || row.scene !== BUILDER.current || presses[0] !== row.id || presses[1] !== row.id) return
        const f = M.find(BUILDER.doc, row.mid)
        if (!f || f.node === BUILDER.doc.root) return
        try { window.getSelection?.()?.removeAllRanges() } catch { }       // a double-click selects the label's word
        onFocus(row.mid)
    }, true)
    container.addEventListener('contextmenu', e => {
        const el = e.target.closest?.('[data-path]')
        const row = el && tree ? rowAt(tree.options.data, el.dataset.path) : null
        if (!copyable(row)) return
        e.preventDefault()
        const others = BUILDER.project.scenes.filter(s => s.key !== BUILDER.current && !s.doc.libraryItem)
        const name = (M.material(BUILDER.doc, row.mid) ?? M.find(BUILDER.doc, row.mid)?.node)?.label ?? 'it'
        const to = move => others.length
            ? others.map(s => ({ label: s.doc.title, run: () => sendTo(row.mid, s.key, { move }) }))
            : [{ label: 'no other scene in this project', off: true }]
        popupMenu([
            { label: `Copy ${name} to`, header: true }, ...to(false),
            { separator: true },
            { label: `Move ${name} to`, header: true }, ...to(true),
        ], { x: e.clientX, y: e.clientY })
    })

    /* THE LOOK OF THE SHELL AROUND IT (lib/shell/shell.css tokens, the mockups' workbench): the panel's
       own background -- the tree kept a grey of its own (#2d2d2d), a box within the panel -- a
       lighter proportional face instead of monospace, and a translucent selection in the accent. */
    const STYLES = {
        CONTAINER: { fontFamily: 'var(--sh-sans, system-ui, sans-serif)', fontSize: '12.5px', lineHeight: '1.5',
                     color: 'var(--sh-ink, #dde3e8)', backgroundColor: 'transparent', padding: '4px 2px' },
        NODE: { padding: '1px 6px', borderRadius: '3px' },
        NODE_HOVER: { backgroundColor: 'rgba(120,150,175,0.10)' },
        NODE_SELECTED: { backgroundColor: 'var(--sh-accent-bg, rgba(120,150,175,0.22))', color: '#fff' },
        MENU: { background: '#20262b', color: 'var(--sh-ink, #dde3e8)', border: '1px solid #36404a', borderRadius: '5px',
                fontFamily: 'var(--sh-sans, system-ui, sans-serif)', fontSize: '12.5px' },
        MENU_HOVER: { backgroundColor: 'rgba(120,150,175,0.22)' },
        TOGGLE_HOVER: { backgroundColor: 'rgba(120,150,175,0.22)' },
    }

    let tree = null
    const rebuild = () => {
        try { tree?.destroy() } catch { }
        container.innerHTML = ''
        tree = new TreeView({
            container, data: rowsFor(BUILDER.project, { current: BUILDER.current, collapsed }),
            nodeTypes: NODE_TYPES, toggleDefinitions: TOGGLES, toggleOrder: TOGGLE_ORDER,
            showIcons: true, multiSelect: false, enableDragDrop: true, styles: STYLES,
            toggleOnClick: false,          // a click selects, the chevron folds (the header above)
            onSelectionChange: (paths, row) => {
                // the row back out of a library item: it is a button, not a place to stay
                if (row?.type === 'back') { rebuild(); return onItem ? onItem('close', BUILDER.current) : onStatus('no library editor in this page') }
                selectedId = row?.id ?? null
                // every row is the current scene's: selecting never switches (File › Switch to scene does, filemenu.js)
                onSelect(selectedMid())
            },
            onNodeExpand: (path, expanded) => {
                const row = rowAt(tree.options.data, path)
                if (!row?.id) return
                if (expanded) collapsed.delete(row.id)
                else collapsed.add(row.id)
            },
            onNodeAdd: onAdd,
            onNodeDrop: onDrop,
            onToggleClick: (path, key, value, old, row, kind) => {
                if (kind === 'action' && key === 'delete') return onDelete(row)
                if (kind === 'action' && key === 'duplicate' && !isScene(row)) return duplicate(row)
                /* A JOIN (TOGGLES.join): the model's, one undo step and a compile, like the eye's hiding. TreeView has
                   already cycled the value it shows; a refusal rebuilds from the document, which puts it back. */
                if (key === 'join' && row?.mid) {
                    if (old === 'base') { rebuild(); return onStatus('the base is what the others join: it joins nothing until it is not first') }
                    return edit('join', () => M.setJoin(BUILDER.doc, row.mid, value), { scene: row.scene, select: keep(row.scene) })
                }
                /* A LOCK (TOGGLES.lock): both of the node's to what TreeView has cycled it to; a lock is nothing the shader
                   reads, so an undo step and no compile */
                if (key === 'lock' && row?.mid) {
                    const on = value === 'locked'
                    return edit('lock', () => { for (const k of ['position', 'params']) M.setLock(BUILDER.doc, row.mid, k, on) },
                        { scene: row.scene, select: keep(row.scene), shader: false })
                }
                /* THE EYE: a uniform written when the scene keeps hidden nodes compiled (liveVisibility),
                   else a recompile -- the node leaves or rejoins the shader */
                if (key === 'enabled' && row?.mid) {
                    const live = !!P.scene(BUILDER.project, row.scene)?.doc?.liveVisibility
                    edit('enable', () => M.setEnabled(BUILDER.doc, row.mid, value), { scene: row.scene, select: keep(row.scene), shader: !live })
                    if (live && !BUILDER.live(row.mid, 'enabled')) structure()
                }
            },
        })
        const p = selectedId == null ? null : pathOf(tree.options.data, selectedId)
        if (p) { tree.selectedNodes.add(p); tree._render() }   // no public select(); see above
        else if (selectedId != null) { selectedId = null; onSelect(null) }   // it is gone
    }
    /* SELECTED FROM OUTSIDE THE TREE -- a click in the picture (overlay.js). A model id in the
       current scene, or null for nothing. Every group on the way down is unfolded, or the row
       would be selected where it cannot be seen, and the row is scrolled to: the tree scrolls
       on its own, and a pick deep in a long scene would otherwise highlight something off the
       bottom of it. The same onSelect a click on the row gives, so the panel and the overlay
       follow exactly as they do then. */
    /* A MATERIAL OR THE ENVIRONMENT TOO: the parameter registry reveals any of them (the palette, the
       Parameters panel's ⌖). Only nodes were accepted, and a material asked for did nothing. The environment
       has no row of its own since 0.52.0 (the user, 2026-10-10: "move the contents of that to the scene's
       properties"): its id selects the scene's row, whose properties hold it. */
    const select = id => {
        const doc = BUILDER.doc
        if (id === M.ENVIRONMENT_ID) id = doc.root.id
        const isMat = id != null && !!M.material(doc, id)
        if (id != null && !isMat && !M.find(doc, id)) return
        if (isMat) collapsed.delete(here('#materials'))
        collapsed.delete(here(doc.root.id))             // the scene's row, folded by its chevron
        if (id != null)
            for (let f = M.find(doc, id); f?.parent; f = M.find(doc, f.parent.id)) collapsed.delete(here(f.parent.id))
        selectedId = here(id)
        rebuild()
        onSelect(selectedMid())
        const p = selectedId == null ? null : pathOf(tree.options.data, selectedId)
        if (p != null) container.querySelector(`[data-path="${p}"]`)?.scrollIntoView({ block: 'nearest' })
    }

    rebuild()
    /* THE LIBRARY'S TWO WAYS IN (library/panel.js): an item put in where a paste would go -- one undo
       step, as a paste is -- and the selected row given out as an asset, to keep */
    const insertAsset = asset => paste(asset, ...pasteTarget(asset.kind))
    const selectedAsset = () => {
        const row = selectedRow()
        if (!row || isScene(row) || row.type === 'materials') return null
        try {
            const asset = M.extractAsset(BUILDER.doc, row.mid)
            return { asset, name: asset.kind === 'material' ? asset.material.label : asset.node.label }
        } catch { return null }
    }
    /* A LIBRARY ITEM DROPPED (library/panel.js drags it; the host routes the drop): on a row of the tree, or
       on the picture -- `mid` the object under the pointer, `pos` the point it hit (the host picks it). One
       undo step, selecting what it made or changed.
         a material on an object       used by it; on a group, by every object in it (not its lights)
         a material anywhere else      kept in the scene's materials, as a paste
         a node on a group or scene    into it; on an object, after it; on the picture, into the scene,
                                       standing on the point hit */
    const rowOf = (scene, mid) => { const p = pathOf(tree.options.data, `${scene}:${mid}`); return p == null ? null : rowAt(tree.options.data, p) }
    const dropAsset = (asset, { scene = BUILDER.current, mid = null, row = null, pos = null } = {}) => {
        asset = structuredClone(asset)
        row ??= mid != null ? rowOf(scene, mid) : null
        if (row?.type === 'back') row = null         // not a place: into the item's scene, as on nothing
        if (row) scene = row.scene
        if (scene !== BUILDER.current) return null      // the tree holds the scene being worked on, no other
        const top = sceneRow()
        // a row that is a node of its scene (a group or any object), not a header or a material
        const isNode = r => !!r && !isScene(r) && r.type !== 'material' && r.mid != null && !!M.find(P.scene(BUILDER.project, scene).doc, r.mid)
        if (asset.kind === 'material') {
            if (!isNode(row)) return paste(asset, top.children.find(r => r.type === 'materials'), undefined)
            return edit('material dropped', () => {
                const doc = BUILDER.doc
                const targets = []
                M.walk({ root: M.find(doc, row.mid).node }, x => {
                    if (x.kind === 'object' && x.type !== 'light' && x.type !== 'export' && x.type !== 'haze') targets.push(x.id)
                })
                if (!targets.length) throw new Error('nothing there takes a material (a light has its own)')
                // the one already there if it is the same: a material dropped on five objects is one material
                const m = doc.materials.find(d => M.sameMaterial(d, asset.material)) ?? M.insertAsset(doc, asset)
                for (const id of targets) M.setMaterial(doc, id, m.id)
                return m
            }, { scene, select: row.mid })
        }
        let at = top, index
        if (row && (row.type === 'group' || isScene(row))) at = row
        else if (isNode(row)) {
            const place = placeOf(tree.options.data, row.id)
            if (place?.parent) { at = place.parent; index = place.index + 1 }
        }
        return edit('put in', () => {
            const n = generic(asset, M.insertAsset(BUILDER.doc, asset, at.mid, nodeIndex(at, index)))
            /* STANDING ON WHAT WAS HIT: its box's middle over the point, its bottom on it -- a node put in at
               the scene's top level, so its transform is the world's */
            const box = pos && at === top ? estimateBox({ kind: 'group', children: [n] }, null, BUILDER.doc) : null
            if (box) {
                n.transform.pos.x += pos[0] - (box.lo[0] + box.hi[0]) / 2
                n.transform.pos.y += pos[1] - (box.lo[1] + box.hi[1]) / 2
                n.transform.pos.z += pos[2] - box.lo[2]
            }
            return n
        }, { scene, select: n => n.id })
    }
    /* THE TREE AS A DROP TARGET for the library: `dragged()` is what is being dragged, null for anything
       else -- the widget's own drags of its rows go on as they were (it ignores what it did not start) */
    const acceptLibrary = dragged => {
        let marked = null
        const mark = e => { if (marked !== e) { marked?.classList.remove('shell-drop-target'); marked = e; e?.classList.add('shell-drop-target') } }
        const rowEl = e => e.target.closest?.('[data-path]') ?? null
        container.addEventListener('dragover', e => {
            if (!dragged()) return
            e.preventDefault(); e.dataTransfer.dropEffect = 'copy'
            mark(rowEl(e))
        })
        container.addEventListener('dragleave', e => { if (!container.contains(e.relatedTarget)) mark(null) })
        container.addEventListener('drop', e => {
            const it = dragged()
            if (!it) return
            e.preventDefault()
            const el = rowEl(e); mark(null)
            dropAsset(it.asset, { row: el ? rowAt(tree.options.data, el.dataset.path) : null })
        })
    }
    /** The tree row being dragged, if Copy to would take it: { mid, scene, label } -- and done(), for the taker's drop. */
    const draggedRow = () => dragging && { mid: dragging.mid, scene: dragging.scene, label: dragging.label }
    draggedRow.done = () => { dragging = null }
    return { apply, rebuild, newScene, select, insertAsset, selectedAsset, dropAsset, acceptLibrary, openScene, closeScene, enterScene, sceneOps, sendTo, draggedRow }
}
