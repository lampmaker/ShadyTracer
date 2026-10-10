//======================================================================================================================
// Tests for the tree's drop replay. Run: node builder/test/tree.test.mjs
//
// A drop is decided by the widget (TreeView's own moveNode, which moves a clone in its data) and
// then REPLAYED into the model as model.move(id, parent, index) read back from where the widget
// put the row. If the two disagree about an index -- before vs after, same-parent vs across --
// the tree shows one order and the shader gets another, and nothing on screen says so until
// someone notices a CSG group applying to the wrong neighbour. So every kind of drop is run
// through the widget's real moveNode and the model must end up showing the same rows.
//======================================================================================================================
import * as M from '../model.js'
import * as P from '../project.js'
import { rowsFor, placeOf, nodeIndex, CLIP_FORMAT, clipAsset } from '../tree.js'
import { PRIMITIVES, SHAPE_GROUPS, shapeMenu } from '../primitives.js'
import { moveNode } from '../../lib/guistuff/treeview/helpers.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)

// the widget logs every move; this is a test, not a debugging session
const quiet = fn => { const l = console.log; console.log = () => { }; try { return fn() } finally { console.log = l } }

const shape = rows => rows.map(r => r.id + (r.children ? `[${shape(r.children)}]` : '')).join(',')
// what the scene's row holds: the rows under it (the top level is the scene's row, and the back row above an item)
const contents = project => rowsFor(project).find(r => r.type === 'scene' || r.type === 'sceneItem').children
const fresh = () => {
    const d = M.createDoc({ title: 't' })
    M.addMaterial(d, { id: 'mA' }); M.addMaterial(d, { id: 'mB' }); M.addMaterial(d, { id: 'mC' })
    const g = M.addGroup(d, 'root', { id: 'g' })
    for (const id of ['a', 'b', 'c']) M.addObject(d, 'root', { id })
    for (const id of ['x', 'y']) M.addObject(d, g.id, { id })
    return d
}
const pathOf = (rows, id, pre = '') => {
    for (let i = 0; i < rows.length; i++) {
        const p = pre ? `${pre}.${i}` : `${i}`
        if (rows[i].id === id) return p
        const q = rows[i].children && pathOf(rows[i].children, id, p)
        if (q) return q
    }
    return null
}

/** Drop `src` relative to `dst` the way the widget does, replay into the model, compare. */
const drop = (name, src, dst, pos) => {
    const doc = fresh()
    const project = P.createProject([doc])
    const rows = rowsFor(project)
    const rid = id => `s1:${id}`
    const moved = quiet(() => moveNode(rows, pathOf(rows, rid(src)), pathOf(rows, rid(dst)), pos))
    ok(`${name}: the widget accepted it`, moved)
    const place = placeOf(rows, rid(src))
    // every node has a parent row: the scene's own, at the root, for its top level
    const parent = place.parent
    ok(`${name}: rows carry their scene and model id`, parent?.scene === 's1' && typeof parent.mid === 'string')
    if (src.startsWith('m')) {
        const order = parent.children.map(r => r.mid)
        doc.materials.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    } else M.move(doc, src, parent.mid, nodeIndex(parent, place.index))
    const want = shape(rows), got = shape(rowsFor(project))
    ok(`${name}: the model shows what the widget shows`, got === want, `widget ${want}\n      model  ${got}`)
    ok(`${name}: and the document is sound`, M.validate(doc).length === 0, M.validate(doc).join('; '))
}

drop('down, same parent, before', 'a', 'c', 'before')
drop('down, same parent, after', 'a', 'c', 'after')
drop('up, same parent, before', 'c', 'a', 'before')
drop('up, same parent, after', 'c', 'g', 'after')
drop('into a group', 'b', 'g', 'inside')
drop('into a group, before a child', 'a', 'y', 'before')
drop('out of a group, after a root child', 'x', 'c', 'after')
drop('a group, down past siblings', 'g', 'c', 'after')
drop('materials reorder', 'mA', 'mC', 'after')
drop('a top-level node, up to the first place', 'a', 'g', 'before')

{
    // ONE SCENE IN THE TREE (UI_PLAN.md section 10): the current one alone, its ids namespaced by its key -- the
    // others are the project menu's, so no row of theirs can be touched and switch to them -- and ITS ROW AT THE ROOT
    // (the user, 2026-10-05: a click on it shows its settings, its + in the + column), named by its title
    const a = fresh(), b = fresh()
    b.title = 'second'
    const project = P.createProject([a, b])
    const rows = rowsFor(project, { current: 's2' })
    const top = rows[0]
    ok('the root is the current scene\'s row, and nothing beside it', rows.length === 1 && top.type === 'scene' && top.scene === 's2'
        && top.mid === b.root.id && top.id === `s2:${b.root.id}` && top.label === 'second', rows.map(r => r.type).join())
    ok('...open, and folded (by its chevron) like any row: kept so through a rebuild', top.expanded === true
        && rowsFor(project, { current: 's2', collapsed: new Set([top.id]) })[0].expanded === false)
    ok('...with no toggles of its own: its + is its type\'s', top.toggles === undefined)
    ok('...its rows carry its key, and no row of the other scene is there', !!pathOf(rows, 's2:a') && !pathOf(rows, 's1:a'))
    ok('no Environment row (it is in the scene\'s properties since 0.49.0), Materials last', top.children.every(r => r.type !== 'environment') && top.children.at(-1).type === 'materials')
    ok('a current scene that is not there: the first', rowsFor(project, { current: 's9' })[0].scene === 's1')
    eq('...a node\'s place counted among the nodes, Materials not one', nodeIndex(top, top.children.length), top.children.length - 1)
    eq('a top-level node\'s parent row is the scene\'s', placeOf(rows, 's2:a').parent?.id, top.id)
}

// THE SYSTEM CLIPBOARD: what the tree puts there reads back as the asset, and nothing else does
{
    const d = fresh()
    const asset = M.extractAsset(d, 'a')
    const text = JSON.stringify({ format: CLIP_FORMAT, asset })
    eq('an asset copied reads back from the clipboard\'s text', clipAsset(text), asset)
    ok('...and plain text, other JSON, or a scene file do not', clipAsset('hello') === null && clipAsset('{"a":1}') === null
        && clipAsset(M.serialize(d)) === null && clipAsset(JSON.stringify({ format: CLIP_FORMAT, asset: { kind: 'node' } })) === null)
}


{
    const d = M.createDoc()
    M.addGroup(d, 'root', { id: 'a', code: 'C = children(C, p);' })
    M.addGroup(d, 'root', { id: 'b', code: '// only a comment' })
    M.addObject(d, 'b', { primitive: 'box' }); M.addObject(d, 'b', { primitive: 'sphere', join: 'subtract' })
    M.addGroup(d, 'root', { id: 'c', blend: 0.1, code: 'C = children(C, p);' })
    M.addObject(d, 'c', { primitive: 'box' }); M.addObject(d, 'c', { primitive: 'sphere', join: 'intersect' })
    // version 14: a join per child, so a group can mix them -- and a plain group says nothing
    M.addGroup(d, 'root', { id: 'm' })
    M.addObject(d, 'm', { primitive: 'box' }); M.addObject(d, 'm', { primitive: 'sphere' })
    M.addObject(d, 'm', { primitive: 'sphere', join: 'subtract', joinBlend: 0.05 })
    M.addGroup(d, 'root', { id: 'q' })
    M.addObject(d, 'q', { primitive: 'box' }); M.addObject(d, 'q', { primitive: 'sphere' })
    const all = contents(P.createProject([d]))
    ok('a scene\'s first row is a node: no Environment row', !!M.find(d, all[0].mid) && all.every(r => r.mid !== M.ENVIRONMENT_ID))
    const rows = all
    ok('a group with code says so', rows[0].label.endsWith('· code'), rows[0].label)
    {
        const d = M.createDoc(); M.addMaterial(d, { id: 'st' }); M.setRelief(d, 'st', 'noise')
        const mats = contents(P.createProject([d])).find(r => r.type === 'materials').children
        ok('a material with a relief says so', mats[0].label.endsWith('relief'), mats[0].label)
    }
    {
        // THE DEFAULT MARK (model.defaultMaterial): the first surface -- not a lamp's glow before it
        const d = M.createDoc()
        M.addMaterial(d, { id: 'lamp', preset: 'emissive' }); M.addMaterial(d, { id: 'w', label: 'white' }); M.addMaterial(d, { id: 'k', label: 'black' })
        const labels = () => contents(P.createProject([d])).find(r => r.type === 'materials').children.map(r => r.label)
        eq('the first surface is marked the default, and only it', labels(), ['glowing', 'white  · default', 'black'])
        d.materials.reverse()
        eq('...reordered, the new first surface is', labels(), ['black  · default', 'white', 'glowing'])
        M.addObject(d, 'root', { id: 'o' })
        const obj = contents(P.createProject([d])).find(r => r.mid === 'o')
        eq('an object wearing none says so, not "default"', obj.label, 'sphere  · no material')
    }
    ok('comments are not code; a boolean group says how, in its children\'s letters', rows[1].label.endsWith('· a − b'), rows[1].label)
    ok('with how its children join too', rows[2].label.endsWith('· a ∩ b (smooth), code'), rows[2].label)
    ok('joins that differ, read top to bottom, and an own blend is smooth', rows[3].label.endsWith('· a ∪ b − c (smooth)'), rows[3].label)
    ok('a plain group says nothing', rows[4].label === 'group', rows[4].label)

    /* ITS CHILDREN (model version 14): in a boolean group the mark, the letter and an own blend before and after
       the name; the join as a toggle on every shape of any group but the top level */
    const kids = rows[3].children
    eq('a boolean group\'s children: ● the base, then each one\'s join and letter, an own blend after',
        kids.map(r => r.label), ['● a  box  · no material', '∪ b  sphere  · no material', '− c  sphere  · no material  · blend 0.05'])
    eq('...and their join toggles: the base, then each one\'s', kids.map(r => r.toggles.join), ['base', 'union', 'subtract'])
    const plain = rows[4].children
    eq('a plain group\'s children: names as they were, but the toggle there to make it one', [plain.map(r => r.label), plain.map(r => r.toggles.join)],
        [['box  · no material', 'sphere  · no material'], ['base', 'union']])
    ok('the top level has no join: it is always a plain union', rows.filter(r => r.mid).every(r => r.toggles?.join == null))
    {
        const d = M.createDoc()
        M.addGroup(d, 'root', { id: 'g' })
        M.addLight(d, 'g', { id: 'lamp' }); M.addObject(d, 'g', { id: 'a', primitive: 'box' }); M.addExportBox(d, 'g', { id: 'out' })
        M.addObject(d, 'g', { id: 'b', primitive: 'sphere', join: 'intersect' })
        M.setEnabled(d, 'a', false)
        const k = contents(P.createProject([d])).find(r => r.mid === 'g').children
        eq('a light and an export box: no join, no letter; a hidden first shape keeps its letter, the next shown is the base',
            k.map(r => [r.mid, r.toggles.join, r.label.split('  ')[0]]),
            [['lamp', null, 'rectangle light'], ['a', 'union', '∪ a'], ['out', null, 'export box'], ['b', 'base', '● b']])
        eq('...and the group\'s row counts the shown shapes only', contents(P.createProject([d])).find(r => r.mid === 'g').label, 'group  · b')
    }
}

// A LIBRARY ITEM BEING EDITED (library/edit.js): while it is current the tree shows only it, under a row
// back to the scene it came from; its row is an item's (its + alone: Save and Close are the strip's over the view)
{
    const a = M.createDoc({ title: 'mine' }), b = M.createDoc({ title: 'other' }), item = M.createDoc({ title: 'gold' })
    const p = P.createProject([a, b])
    const e = P.addScene(p, item, 1)
    item.libraryItem = { id: 'mine:x', kind: 'material', from: p.scenes[0].key, stage: [], details: {} }
    let rows = rowsFor(p, { current: e.key })
    ok('while an item is current the tree shows only it, under a row back', rows.length === 2 && rows[0].type === 'back' && rows[0].label === 'back to mine'
        && rows[1].type === 'sceneItem' && rows[1].label === 'gold' && rows[1].children.at(-1).type === 'materials'
        && rows.every(r => r.scene === e.key), rows.map(r => r.type).join())
    eq('...the back row is not counted as a node', nodeIndex({ children: [{ type: 'back' }, { type: 'code' }, { type: 'code' }] }, 2), 1)
    rows = rowsFor(p, { current: p.scenes[0].key })
    ok('...and the scene being worked on otherwise, alone', rows.length === 1 && rows[0].type === 'scene' && rows[0].label === 'mine'
        && rows[0].children.every(r => r.scene === p.scenes[0].key))
    item.libraryItem.from = 'gone'
    ok('the back row names no scene that is not there', rowsFor(p, { current: e.key })[0].label === 'back to the scenes')
}

// THE SHAPES IN GROUPS (the user, 2026-10-01): the + menu's Shapes is Primitives, Optics, From points, in that order,
// every shape in exactly one, none left out
{
    const menu = shapeMenu()
    eq('the Shapes submenus, in order', menu.map(g => g.label), SHAPE_GROUPS.map(g => g.label))
    const listed = menu.flatMap(g => g.keys)
    ok('every shape listed once', listed.length === Object.keys(PRIMITIVES).length && new Set(listed).size === listed.length
        && Object.keys(PRIMITIVES).every(k => listed.includes(k)), JSON.stringify(menu))
    ok('none of them empty', menu.every(g => g.keys.length > 0))
    ok('the lenses and the reflector in Optics; the extrusion in From points', ['lens', 'fresnel lens', 'reflector'].every(k => menu[1].keys.includes(k)) && menu[2].keys.includes('extrusion'))
}

// A LOCK PER NODE ROW (TOGGLES.lock, model.js setLock): open, both, or one alone; none on what is not a node
{
    const d = M.createDoc()
    M.addGroup(d, 'root', { id: 'g' })
    for (const id of ['a', 'b', 'c']) M.addObject(d, 'g', { id, primitive: 'box' })
    M.addLight(d, 'root', { id: 'lamp' })
    M.setLock(d, 'a', 'position', true); M.setLock(d, 'b', 'params', true)
    for (const k of ['position', 'params']) { M.setLock(d, 'c', k, true); M.setLock(d, 'lamp', k, true) }
    const top = contents(P.createProject([d])), g = top.find(r => r.mid === 'g')
    eq('every node row has its lock: a group, its objects, a light', [g.toggles.lock, ...g.children.map(r => r.toggles.lock), top.find(r => r.mid === 'lamp').toggles.lock],
        ['unlocked', 'position locked', 'parameters locked', 'locked', 'locked'])
    ok('...and nothing else has one: the materials', top.filter(r => !['g', 'lamp'].includes(r.mid)).every(r => r.toggles?.lock === undefined))
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
