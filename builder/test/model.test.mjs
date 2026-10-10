//======================================================================================================================
// Tests for the document model. Run: node builder/test/model.test.mjs
//
// Every operation the tree offers is a function in model.js, so every one is tested here with
// no DOM and no GPU. Several are the old builder's bugs turned into assertions: selection by
// path, materials bound by label, a loader that regenerated ids, a delete that left dangling
// references.
//======================================================================================================================
import * as M from '../model.js'
import * as S from '../sources.js'
import { beamOf, beamShape } from '../lights.js'
import { toParent, estimateBox as estimateBoxOf } from '../bounds.js'
import { readFileSync } from 'fs'
import { generate, codeOnly, isCsg } from '../codegen.js'
import { vnoise3 } from '../../lib/pathtracer/core/noise.js'

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


//----------------------------------------------------------------------------------------------
// Building a document
//----------------------------------------------------------------------------------------------
const doc = M.createDoc({ title: 'test' })
eq('a new document is sound', M.validate(doc), [])

const mirror = M.addMaterial(doc, { label: 'Mirror', preset: 'mirror' })
const white = M.addMaterial(doc, { label: 'White', preset: 'diffuse' })
const g = M.addGroup(doc, 'root', { label: 'balls' })
const a = M.addObject(doc, g.id, { primitive: 'sphere', material: mirror.id, params: { radius: 1 } })
const b = M.addObject(doc, g.id, { primitive: 'sphere', material: white.id })
const c = M.addObject(doc, 'root', { type: 'code', material: white.id, code: 'C = add_new(C, sdBox(p, VEC3(1.0)), MATERIAL);' })

const ids = [mirror, white, g, a, b, c].map(x => x.id)
eq('ids are unique', new Set(ids).size, ids.length)
ok('ids carry no underscore', ids.every(id => !id.includes('_')), ids.join(' '))
eq('the built document is sound', M.validate(doc), [])
eq('an object takes its type\'s default params when given none', b.params, M.PRIMITIVES.sphere.params)
// a 1-unit sphere, as every + shape fits a 1-unit cube (primitives.js SIZES; the user, 2026-10-02)
eq('...a sphere 1 across', b.params, { radius: 0.5 })
ok('defaults are copied, not shared with the library', (b.params.radius = 2, M.addObject(doc, 'root', { primitive: 'sphere' }).params.radius === 0.5))
M.remove(doc, doc.root.children.at(-1).id)

// A PRIMITIVE IS A CODE NODE that starts as a library entry (primitives.js): named after it, with
// its code, parameters and ranges -- all of them the node's own from then on.
{
    const d = M.createDoc()
    for (const key of Object.keys(M.PRIMITIVES)) {
        const n = M.addObject(d, 'root', { primitive: key })
        ok(`${key}: a code node named ${key}, with the library's code and parameters`,
            n.type === 'code' && n.label === key && M.codeOf(d, n) === M.PRIMITIVES[key].code && M.blockOf(d, n).builtin === `${key}@1`
            && JSON.stringify(n.params) === JSON.stringify(M.PRIMITIVES[key].params))
    }
    const box = M.addObject(d, 'root', { primitive: 'box', params: { rounding: 0.1 } })
    eq('given params go over the primitive\'s', [box.params.size, box.params.rounding], [{ x: 0.5, y: 0.5, z: 0.5 }, 0.1])
    ok('a sphere gets its radius range', !!M.blockOf(d, M.addObject(d, 'root', {})).ranges?.radius)
    ok('every sphere is one block, the built-in', new Set(d.root.children.filter(n => n.label === 'sphere').map(n => n.block)).size === 1)
    /* A BUILT-IN IS READ-ONLY (version 16): a node's code edited is a block of its own first (ownBlock) */
    M.setCode(d, box.id, M.codeOf(d, box) + '\n// mine')
    eq('the library\'s code is a copy: editing a node leaves the next one alone',
        M.codeOf(d, M.addObject(d, 'root', { primitive: 'box' })), M.PRIMITIVES.box.code)
    ok('...the edited one has a block of its own, no longer the built-in', !M.blockOf(d, box).builtin && M.codeOf(d, box).endsWith('// mine'))
    eq('type: \'code\' with no code is blank code, not a sphere', [M.codeOf(d, M.addObject(d, 'root', { type: 'code' }))], [''])
    const blank2 = M.addObject(d, 'root', { type: 'code' })
    ok('two blank code nodes are two blocks: code of one\'s own is never shared by accident', blank2.block !== d.root.children.at(-2).block)
    throws('an unknown primitive is refused', () => M.addObject(d, 'root', { primitive: 'teapot' }), /unknown primitive/)
    throws('an old type name is refused, not turned into a sphere', () => M.addObject(d, 'root', { type: 'box' }), /primitive: 'box'/)
    eq('and the document is sound', M.validate(d), [])
}

throws('unknown object type is refused', () => M.addObject(doc, 'root', { type: 'teapot' }), /teapot/)
throws('a material that does not exist is refused', () => M.addObject(doc, 'root', { material: 'nope' }), /nope/)
throws('an id with an underscore is refused', () => M.addGroup(doc, 'root', { id: 'a_b' }), /valid id/)
throws('an id in use is refused', () => M.addGroup(doc, 'root', { id: a.id }), /in use/)
throws('an object cannot have children', () => M.addObject(doc, a.id, {}), /not a group/)
throws('an unknown preset is refused', () => M.addMaterial(doc, { preset: 'unobtainium' }), /unobtainium/)
throws('a material field of the wrong kind is refused', () => M.addMaterial(doc, { params: { roughness: 'high' } }), /roughness/)
eq('a material starts from its preset', [mirror.params.metallic, mirror.params.roughness], [1, 0])
throws('a parameter name WGSL cannot use is refused',
    () => M.addObject(doc, 'root', { type: 'code', params: { 'bad-name': 1 } }), /bad-name/)

//----------------------------------------------------------------------------------------------
// find, remove, removeMaterial
//----------------------------------------------------------------------------------------------
eq('find reports parent and index', (({ parent, index }) => [parent.id, index])(M.find(doc, b.id)), [g.id, 1])
ok('find of a missing id is null', M.find(doc, 'zzz') === null)
throws('the root cannot be removed', () => M.remove(doc, 'root'), /root/)
throws('a material in use cannot be removed, and the users are named',
    () => M.removeMaterial(doc, white.id), new RegExp(`${b.id}.*${c.id}|${c.id}.*${b.id}`))

//----------------------------------------------------------------------------------------------
// A scene keeps a material, and its first surface is what a new object wears
//----------------------------------------------------------------------------------------------
{
    const d = M.createDoc()
    eq('createDoc stays bare: the studio, the editor and the tests count their own', d.materials.length, 0)
    M.ensureMaterial(d)
    const w = d.materials[0]
    eq('ensureMaterial gives a scene with none a white diffuse, as the built-in grey was',
        [d.materials.length, w.label, w.params.baseColor, w.params.metallic], [1, 'white', { r: 0.8, g: 0.8, b: 0.8 }, 0])
    M.ensureMaterial(d)
    eq('...and a scene with one is left alone', d.materials.length, 1)
    throws('the last material cannot be removed', () => M.removeMaterial(d, w.id), /at least one material/)
    const lamp = M.addMaterial(d, { preset: 'emissive' })
    d.materials.reverse()
    eq('the default is the first SURFACE: not a lamp\'s glow put first', M.defaultMaterial(d)?.id, w.id)
    M.removeMaterial(d, lamp.id)
    eq('any but the last can go', d.materials.map(m => m.id), [w.id])
    // a library item's stage (library/edit.js): its floor's grey is nobody's default
    d.libraryItem = { stageMaterials: [w.id] }
    eq('the stage\'s material is not the default of an item being edited', M.defaultMaterial(d), null)
    delete d.libraryItem
    const g = M.addGroup(d, 'root', {})
    const x = M.addObject(d, g.id, {}), y = M.addObject(d, g.id, { material: w.id }), L = M.addLight(d, g.id, {})
    M.wearDefault(d, g)
    eq('wearDefault: every object without one wears it, a light does not', [x.material, y.material, L.material ?? null], [w.id, w.id, null])
    eq('and the document is sound', M.validate(d), [])
}

//----------------------------------------------------------------------------------------------
// move
//----------------------------------------------------------------------------------------------
{
    const d = M.createDoc()
    const g1 = M.addGroup(d, 'root', { id: 'g1' }), g2 = M.addGroup(d, g1.id, { id: 'g2' })
    const x = M.addObject(d, 'root', { id: 'x' }), y = M.addObject(d, 'root', { id: 'y' })
    const z = M.addObject(d, 'root', { id: 'z' })
    throws('a group cannot move into itself', () => M.move(d, 'g1', 'g1'), /itself/)
    throws('a group cannot move into its own descendant', () => M.move(d, 'g1', 'g2'), /itself/)
    throws('nothing moves under an object', () => M.move(d, 'x', 'y'), /not a group/)
    M.move(d, 'z', 'root', 1)
    eq('moving within a group indexes the list without the node', d.root.children.map(n => n.id), ['g1', 'z', 'x', 'y'])
    M.move(d, 'x', 'g2')
    eq('moving across groups appends by default', g2.children.map(n => n.id), ['x'])
    eq('and the source no longer has it', d.root.children.map(n => n.id), ['g1', 'z', 'y'])
    eq('the moved document is sound', M.validate(d), [])
    void y
}

//----------------------------------------------------------------------------------------------
// duplicate
//----------------------------------------------------------------------------------------------
{
    const before = new Set(); M.walk(doc, n => before.add(n.id))
    const copy = M.duplicate(doc, g.id)
    const copied = []; M.walk({ root: copy }, n => copied.push(n.id))
    ok('a duplicate gets fresh ids for its whole subtree', copied.every(id => !before.has(id)), copied.join(' '))
    eq('it lands right after the original', doc.root.children.indexOf(copy), doc.root.children.indexOf(g) + 1)
    eq('and shares materials rather than copying them', copy.children.map(n => n.material), [mirror.id, white.id])
    ok('its params are a copy, not the same object', copy.children[0].params !== a.params)
    eq('the document is still sound', M.validate(doc), [])
    M.remove(doc, copy.id)
}

//----------------------------------------------------------------------------------------------
// toNodes -- what codegen reads
//----------------------------------------------------------------------------------------------
eq('toNodes is tree order, with material ids',
    M.toNodes(doc).map(n => [n.id, n.type, n.material]),
    [[a.id, 'code', mirror.id], [b.id, 'code', white.id], [c.id, 'code', white.id]])
ok('a code node carries its code', M.toNodes(doc)[2].code.includes('sdBox'))
ok('...its block\'s: the document\'s node has none of its own', M.find(doc, c.id).node.code === undefined && M.codeOf(doc, M.find(doc, c.id).node).includes('sdBox'))

M.setEnabled(doc, g.id, false)
eq('a disabled group drops its whole subtree', M.toNodes(doc).map(n => n.id), [c.id])
M.setEnabled(doc, g.id, true)
M.setEnabled(doc, a.id, false)
eq('a disabled object drops only itself', M.toNodes(doc).map(n => n.id), [b.id, c.id])
M.setEnabled(doc, a.id, true)

// THE OLD BUILDER'S LABEL BUG: renaming a material rebound every object using it.
const beforeRename = JSON.stringify(M.toNodes(doc))
M.rename(doc, mirror.id, 'Chrome')
eq('renaming a material changes nothing the shader sees', JSON.stringify(M.toNodes(doc)), beforeRename)

// And the uniform-name collision the no-underscore rule exists to prevent.
{
    const d = M.createDoc()
    M.addObject(d, 'root', { id: 'c', type: 'code', params: { a_b: 1 } })
    M.addObject(d, 'root', { id: 'bc', type: 'code', params: { a: 2 } })
    const u = Object.keys(generate(M.toNodes(d)).uniforms).filter(k => k.startsWith('a'))
    eq('two nodes cannot mint the same uniform name', u.sort(), ['a_b_c', 'a_bc'])
}
ok('toNodes feeds generate', generate(M.toNodes(doc)).wgsl.includes(`// node ${a.id} (code)`))

//----------------------------------------------------------------------------------------------
// Saving and loading
//----------------------------------------------------------------------------------------------
const text = M.serialize(doc)
const back = M.parse(text)
eq('a document survives a round trip exactly -- ids included', back, doc)
{
    // The old loader regenerated ids on the way in. The counter is saved, so an id minted after
    // loading cannot collide with one the file already holds.
    const fresh = M.newId(back)
    let clash = false; M.walk(back, n => { if (n.id === fresh) clash = true })
    ok('an id minted after loading is new', !clash && !back.materials.some(m => m.id === fresh), fresh)
}

throws('not JSON is refused', () => M.parse('{'), /not JSON/)
throws('another version is refused, not guessed at',
    () => M.parse(JSON.stringify({ ...doc, version: 99 })), /version 99/)
{
    const bad = structuredClone(doc)
    bad.root.children[0].children[1].id = bad.root.children[0].children[0].id    // duplicate id
    bad.root.children[1].material = 'gone'                                       // dangling ref
    bad.materials[0].params.ior = 'thick'                                          // bad field
    try { M.parse(JSON.stringify(bad)); ok('a broken file is refused', false) }
    catch (e) {
        ok('a broken file is refused with every problem at once', e.problems?.length === 3,
            JSON.stringify(e.problems))
    }
}

//----------------------------------------------------------------------------------------------
// Version 2: transforms and blend (the op it brought is each child's join since 14, below)
//----------------------------------------------------------------------------------------------
{
    const d = M.createDoc()
    const g = M.addGroup(d, 'root', { id: 'g', blend: 0.2 })
    const o = M.addObject(d, 'g', { id: 'o' })
    eq('a new object has the identity transform', o.transform, M.identity())
    eq('a group keeps its blend', g.blend, 0.2)
    ok('the root has no transform: it is the world frame', !('transform' in d.root))
    throws('a parameter named like the transform uniform is refused',
        () => M.addObject(d, 'root', { type: 'code', params: { xf: 1 } }), /xf/)
    const bad = structuredClone(d); bad.root.children[0].transform.scale = 0
    ok('a zero scale does not validate', M.validate(bad).some(x => /scale/.test(x)))
    const dup = M.duplicate(d, 'o')
    dup.transform.pos.x = 5
    eq('a duplicate\'s transform is its own', o.transform.pos.x, 0)

    const t = M.toTree(d)
    eq('toTree keeps the group blend and nests the objects', [t.children[0].blend, t.children[0].children.map(c => c.id)],
        [0.2, ['o', dup.id]])
    M.setEnabled(d, 'o', false)
    eq('toTree prunes a disabled object', M.toTree(d).children[0].children.map(c => c.id), [dup.id])
}

//----------------------------------------------------------------------------------------------
// Version 14: A JOIN PER CHILD. How a group combines is said by each child -- union, subtract or
// intersect what is above it, the first shape the base -- and a child may have a blend of its own.
//----------------------------------------------------------------------------------------------
{
    const d = M.createDoc()
    throws('a group is refused an op, loudly (a caller still passing one would get a union)',
        () => M.addGroup(d, 'root', { op: 'subtract' }), /no op since version 14/)
    const g = M.addGroup(d, 'root', { id: 'g', blend: 0.1 })
    const a = M.addObject(d, 'g', { id: 'a', primitive: 'box' })
    const b = M.addObject(d, 'g', { id: 'b', primitive: 'sphere', join: 'subtract', joinBlend: 0.02 })
    const c = M.addObject(d, 'g', { id: 'c', primitive: 'cylinder', join: 'union' })
    eq('a join and an own blend are kept; union is stored as nothing', [a.join, b.join, b.joinBlend, 'join' in c], [undefined, 'subtract', 0.02, false])
    throws('an unknown join is refused', () => M.addObject(d, 'g', { join: 'xor' }), /join must be one of/)
    throws('a negative own blend is refused', () => M.addObject(d, 'g', { joinBlend: -1 }), /joinBlend/)
    throws('a join at the top level is refused: it is always a plain union', () => M.addObject(d, 'root', { join: 'subtract' }), /top level/)
    throws('...by setJoin too', () => M.setJoin(d, 'g', 'subtract'), /top level/)
    const lamp = M.addLight(d, 'g', { id: 'lamp', shape: 'disc' })
    throws('a light is no shape of its group: no join', () => M.setJoin(d, lamp.id, 'subtract'), /no join/)
    const box = M.addExportBox(d, 'g', { id: 'box' })
    throws('nor an export box', () => M.setJoinBlend(d, box.id, 0.1), /no join/)
    M.setJoin(d, 'c', 'intersect'); M.setJoin(d, 'b', 'union'); M.setJoinBlend(d, 'b', null)
    eq('setJoin and setJoinBlend: union and null store nothing', [c.join, 'join' in b, 'joinBlend' in b], ['intersect', false, false])
    throws('setJoin refuses an unknown join', () => M.setJoin(d, 'c', 'minus'), /join must be one of/)
    eq('...and leaves what it had', c.join, 'intersect')
    eq('the document is sound', M.validate(d), [])

    const withOp = structuredClone(d); withOp.root.children[0].op = 'subtract'
    ok('a group carrying an op does not validate', M.validate(withOp).some(x => /no op since version 14/.test(x)))
    const badJoin = structuredClone(d); badJoin.root.children[0].children[1].join = 'xor'
    ok('nor a bad join', M.validate(badJoin).some(x => /join must be one of/.test(x)))

    // a join travels with its node; at the top level it is dormant, not wrong
    M.move(d, 'c', 'root')
    eq('move keeps a join, and at the top level the document is still sound', [M.find(d, 'c').node.join, M.validate(d)], ['intersect', []])
    M.move(d, 'c', 'g')
    eq('...and back in a group it joins again', M.toTree(d).children[0].children.map(n => [n.id, n.join ?? 'union']),
        [['a', 'union'], ['b', 'union'], ['lamp', 'union'], ['box', 'union'], ['c', 'intersect']])

    /* whether a group combines is decided on the document: hiding its only non-union child must not turn it
       into a plain union in the tree while params.js, reading the document, still writes its blend live */
    const h = M.createDoc()
    M.addGroup(h, 'root', { id: 'h' })
    M.addObject(h, 'h', { id: 'hbase', primitive: 'box' }); M.addObject(h, 'h', { id: 'hcut', primitive: 'sphere', join: 'subtract' })
    M.setEnabled(h, 'hcut', false)
    eq('toTree: a group\'s csg is its document\'s, whatever is hidden', [isCsg(M.find(h, 'h').node), M.toTree(h).children[0].csg], [true, true])
    ok('...and the root is never one', M.toTree(h).csg === false)
}
{
    /* VERSION 10 -> 14: a group's op becomes the join of every shape after its first -- not a light, not an
       export box (not shapes of it), the first in the document even when hidden -- and goes */
    const v10 = { format: 'raytracer-scene', version: 10, title: 'v10', nextId: 20, unit: 'm', functions: '', materials: [],
        root: { id: 'root', kind: 'group', label: 'v10', enabled: true, op: 'union', blend: 0, children: [] } }
    const T = { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: 1 }
    const obj = (id, extra = {}) => ({ id, kind: 'object', type: 'code', label: id, enabled: true, transform: T, material: null,
        params: {}, code: 'C = add_new(C, Nsphere(p, 1.0), MATERIAL);', ...extra })
    const lampNode = { id: 'lamp', kind: 'object', type: 'light', label: 'lamp', enabled: true, transform: T, material: null,
        params: { radius: 0.5 }, light: { shape: 'disc' } }
    const boxNode = { id: 'ebox', kind: 'object', type: 'export', label: 'ebox', enabled: true, transform: T, material: null,
        params: { size: { x: 1, y: 1, z: 1 } } }
    v10.root.children = [
        { id: 'cut', kind: 'group', label: 'cut', enabled: true, op: 'subtract', blend: 0.1, transform: T,
          children: [boxNode, lampNode, obj('first', { enabled: false }), obj('second'), obj('third')] },
        { id: 'blob', kind: 'group', label: 'blob', enabled: true, op: 'union', blend: 0.2, transform: T, children: [obj('u1'), obj('u2')] },
        { id: 'lonely', kind: 'group', label: 'lonely', enabled: true, op: 'intersect', blend: 0, transform: T, children: [obj('only')] },
    ]
    const u = M.parse(JSON.stringify(v10))
    const j = id => M.find(u, id).node.join
    eq('10 -> 14, and on to the current version', u.version, M.VERSION)
    eq('...every shape after the first takes the op; the first (hidden or not), a light and an export box none',
        ['ebox', 'lamp', 'first', 'second', 'third'].map(j), [undefined, undefined, undefined, 'subtract', 'subtract'])
    ok('...no group keeps an op, the root included', ['root', 'cut', 'blob', 'lonely'].every(id => !('op' in M.find(u, id).node)))
    eq('...a union needs no joins, its blend stays on the group', [j('u1'), j('u2'), M.find(u, 'blob').node.blend], [undefined, undefined, 0.2])
    ok('...and the upgraded document saves and loads as itself', M.serialize(M.parse(M.serialize(u))) === M.serialize(u))
    /* THE ONE DELIBERATE CHANGE: a subtraction or intersection of fewer than two shapes, with no blend, has no
       child to give its op to -- a plain group now, the same shape it was, no longer through the CSG path */
    eq('a one-shape intersection with no blend becomes a plain group', isCsg(M.find(u, 'lonely').node), false)

    // an asset saved before 14 -- a library item, an exported library file, the clipboard -- has no version
    const d = M.createDoc()
    const put = M.insertAsset(d, { kind: 'node', unit: 'm', materials: [], node: structuredClone(v10.root.children[0]) })
    eq('an asset with an op is upgraded as it goes in', [('op' in put), put.children.map(c => c.join)],
        [false, [undefined, undefined, undefined, 'subtract', 'subtract']])
    eq('...and the document is sound', M.validate(d), [])

    /* versions 11 to 13 are the optics branch's alone: this line never saved them */
    const v12 = structuredClone(v10); v12.version = 12; v12.root.children = [obj('plain')]
    eq('a version 12 file is the branch\'s, and reaches the current version', M.parse(JSON.stringify(v12)).version, M.VERSION)
}

// matrixOf: column-major, columns 0-2 are R (local -> parent), column 3 is (pos, scale)
{
    const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9)
    const apply = (m, v) => [0, 1, 2].map(r => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2])
    eq('identity', M.matrixOf(M.identity()), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    const z90 = M.matrixOf({ pos: { x: 1, y: 2, z: 3 }, rot: { x: 0, y: 0, z: 90 }, scale: 2 })
    ok('90 degrees about z takes x to y', close(apply(z90, [1, 0, 0]), [0, 1, 0]), JSON.stringify(apply(z90, [1, 0, 0])))
    eq('position and scale ride in column 3', z90.slice(12), [1, 2, 3, 2])
    // x first, then z: y -> (x 90) -> z -> (z 90) -> z. The other order would give -x.
    const xz = M.matrixOf({ pos: { x: 0, y: 0, z: 0 }, rot: { x: 90, y: 0, z: 90 }, scale: 1 })
    ok('rotation order is x, then y, then z', close(apply(xz, [0, 1, 0]), [0, 0, 1]), JSON.stringify(apply(xz, [0, 1, 0])))
}

// Version 8 files had primitive types. Each becomes the code its type emitted, with the defaults
// codegen used to fill in for a parameter the file left out.
{
    const types = ['sphere', 'box', 'cylinder', 'capsule', 'torus', 'cone', 'plane']
    const v8 = M.createDoc()
    v8.version = 8
    v8.root.children = types.map((t, i) => ({ id: `o${i}`, kind: 'object', type: t, label: t, enabled: true,
        transform: M.identity(), material: null, params: t === 'box' ? { rounding: 0.3 } : {} }))
    const d = M.parse(JSON.stringify(v8))
    eq('a version 8 file is upgraded to the current version', d.version, M.VERSION)
    ok('every object is a code node', d.root.children.every(n => n.type === 'code'))
    eq('with the code its type emitted', d.root.children.map(n => M.codeOf(d, n)), [
        'C = add_new(C, Nsphere(p, radius), MATERIAL);',
        'C = add_new(C, NboxRounded(p, size, rounding), MATERIAL);',
        'C = add_new(C, Ncylinder(p, height * 0.5, radius), MATERIAL);',
        'C = add_new(C, Ncapsule(p, height * 0.5, radius), MATERIAL);',
        'C = add_new(C, Ntorus(p, ring, tube), MATERIAL);',
        'C = add_new(C, sdCappedCone(p, height * 0.5, base, top), MATERIAL);',
        'C = add_new(C, Nplane(p), MATERIAL);',
    ])
    eq('the type\'s defaults under what the file said', d.root.children[1].params, { size: { x: 0.5, y: 0.5, z: 0.5 }, rounding: 0.3 })
    eq('its labels are kept', d.root.children.map(n => n.label), types)
    eq('and it is sound', M.validate(d), [])
}

// Version 1 files -- saved before transforms existed -- load, as the identity and a union
{
    const v1 = {
        format: M.FORMAT, version: 1, title: 'old', nextId: 3, materials: [],
        root: { id: 'root', kind: 'group', label: 'old', enabled: true, children: [
            { id: 'g', kind: 'group', label: 'g', enabled: true, children: [
                { id: 'o', kind: 'object', type: 'sphere', label: 's', enabled: true, material: null, params: { radius: 1 } }] }] },
    }
    const d = M.parse(JSON.stringify(v1))
    eq('a version 1 file is upgraded to the current version', d.version, M.VERSION)
    eq('its nodes get the identity transform', d.root.children[0].children[0].transform, M.identity())
    eq('and its groups are plain unions: no op, no joins, no blend',
        [d.root.children[0].op, d.root.children[0].children[0].join, d.root.children[0].blend, isCsg(d.root.children[0])], [undefined, undefined, 0, false])
    ok('the root is left without a transform', !('transform' in d.root))
    eq('and the upgraded document is sound', M.validate(d), [])
}

// Version 2 spheres had a `centre`, subtracted in the sphere's own frame. On load it moves into
// the position -- rotated and scaled first, or the sphere lands somewhere else.
{
    const v2 = {
        format: M.FORMAT, version: 2, title: 'v2', nextId: 3, materials: [],
        root: { id: 'root', kind: 'group', label: 'v2', enabled: true, op: 'union', blend: 0, children: [
            { id: 's', kind: 'object', type: 'sphere', label: 's', enabled: true, material: null,
              params: { radius: 1, centre: { x: 1, y: 0, z: 0 } },
              transform: { pos: { x: 10, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 90 }, scale: 2 } }] },
    }
    const d = M.parse(JSON.stringify(v2))
    const s = d.root.children[0]
    ok('the centre parameter is gone', !('centre' in s.params))
    const p = s.transform.pos
    // centre (1,0,0), scaled by 2, turned 90 degrees about z -> (0,2,0), plus (10,0,0)
    ok('and the sphere stays where it was', Math.abs(p.x - 10) < 1e-9 && Math.abs(p.y - 2) < 1e-9 && Math.abs(p.z) < 1e-9,
        JSON.stringify(p))
    eq('the upgraded document is sound', M.validate(d), [])
}

//----------------------------------------------------------------------------------------------
// Version 3 -> 4: palette names become the same materials as data
//----------------------------------------------------------------------------------------------
{
    const { PALETTE_V3 } = await import('../materials.js')
    // Every name a version 3 file could hold is every MAT_ constant the old palette declared,
    // MAT_AIR excepted -- read off scenes/common.js while it existed, and frozen here since it is
    // gone. If one is missing from PALETTE_V3, a file using it would fail to load.
    const declared = ['MAT_PMMA', 'MAT_MIRROR', 'MAT_DIFF_WHITE', 'MAT_DIFF_BLUE', 'MAT_DIFF_RED', 'MAT_DIFF_PETROL',
        'MAT_DIFF_ORANGE', 'MAT_GROUNDPLANE', 'MAT_BASIC_PET', 'MAT_PROC_DIRPOS_CHECKER', 'MAT_CONDITIONAL',
        'MAT_BRONZE', 'MAT_6SIDED', 'MAT_ROUGHGLASS']
    eq('the upgrade covers every palette entry there was', declared.filter(n => !(n in PALETTE_V3)), [])

    const v3 = {
        format: M.FORMAT, version: 3, title: 'v3', nextId: 9,
        materials: [{ id: 'o', label: 'Orange', palette: 'MAT_DIFF_ORANGE' },
                    { id: 'g', label: 'Ground', palette: 'MAT_GROUNDPLANE' }],
        root: { id: 'root', kind: 'group', label: 'v3', enabled: true, op: 'union', blend: 0, children: [
            { id: 's', kind: 'object', type: 'sphere', label: 's', enabled: true, material: 'o',
              params: { radius: 1 }, transform: M.identity() }] },
    }
    const d = M.parse(JSON.stringify(v3))
    eq('a version 3 file loads as the current version', d.version, M.VERSION)
    const o = M.material(d, 'o'), g = M.material(d, 'g')
    eq('ids and labels survive', [o.id, o.label, g.label], ['o', 'Orange', 'Ground'])
    ok('no palette field is left', !('palette' in o) && !('palette' in g))
    // makePlastic(ora, 0.6, 0.5) then clearcoat 0.12, as scenes/common.js had it -- and the
    // clearcoat then dropped by 6 -> 7, since nothing ever read it
    eq('a plain entry becomes its parameters', [o.params.roughness, o.params.specular, o.params.ior],
        [0.6, 0.5, 1.5])
    ok('and the dead clearcoat field does not survive the upgrade', !('clearcoat' in o.params))
    ok('a procedural entry becomes code', /smoothstep/.test(g.code) && /sin\(p\.x \* PI\)/.test(g.code))
    eq('and objects still refer to theirs', d.root.children[0].material, 'o')
    eq('the upgraded document is sound', M.validate(d), [])

    const bad = structuredClone(v3); bad.materials[0].palette = 'MAT_NOPE'
    throws('an unknown palette name is reported, not guessed', () => M.parse(JSON.stringify(bad)), /params/)
}

//----------------------------------------------------------------------------------------------
// Compile-time parameters, parameter management, the functions block
//----------------------------------------------------------------------------------------------
{
    const d = M.createDoc()
    ok('a new document has a functions block of comments', /^\/\/ Functions:/.test(d.functions))
    const o = M.addObject(d, 'root', { id: 'm', type: 'code', params: { iterations: 3, scale: 1.5 },
        constants: { iterations: 'u32' } })
    // its schema is its block's (version 16): read through it
    const S = () => M.blockOf(d, o)
    eq('a constant is recorded by name and type', S().constants, { iterations: 'u32' })
    eq('and the document is sound', M.validate(d), [])
    throws('a constant must be one of the parameters', () => M.setConstant(d, 'm', 'nope', 'u32'), /nope/)
    throws('of a known type', () => M.setConstant(d, 'm', 'scale', 'f64'), /f64/)
    M.setConstant(d, 'm', 'scale', 'i32')
    eq('an integer constant rounds its value', o.params.scale, 2)
    M.setConstant(d, 'm', 'scale', null)
    ok('and a parameter can be live again', !('scale' in S().constants))
    M.addParam(d, 'm', 'tint', { r: 1, g: 0.5, b: 0 })
    eq('a parameter can be added', o.params.tint, { r: 1, g: 0.5, b: 0 })
    throws('but not twice', () => M.addParam(d, 'm', 'tint', 0), /already/)
    throws('nor under a reserved name', () => M.addParam(d, 'm', 'xf', 0), /xf/)
    /* NOR `vis`: with live visibility every node has a uniform vis_<id> (codegen visName), and a parameter
       of that name is the same uniform -- declared twice, the second type winning */
    {
        const v = M.createDoc(); M.setLiveVisibility(v, true)
        const n = M.addObject(v, 'root', { id: 'n', type: 'code', code: 'C = add_new(C, Nsphere(p, 1.0), MATERIAL);' })
        // as a file written by hand would have it: on the block and the node alike
        n.params = { vis: 0.5 }; M.blockOf(v, n).params = { vis: 0.5 }
        ok('(a parameter named vis would be the visibility uniform: its type is no longer u32)',
            generate(M.toTree(v, { keepDisabled: true }), { liveVisibility: true }).uniforms.vis_n?.type !== 'u32')
        ok('a node with a parameter named vis does not validate', M.validate(v).some(x => /vis/.test(x)), JSON.stringify(M.validate(v)))
        throws('...nor can one be added', () => M.addParam(d, 'm', 'vis', 0), /vis/)
        throws('...or renamed to', () => M.renameParam(d, 'm', 'scale', 'vis'), /vis/)
    }
    M.removeParam(d, 'm', 'iterations')
    ok('removing a parameter removes its constant', !S().constants && !('iterations' in o.params))
    throws('no node may take the functions block\'s id', () => M.addGroup(d, 'root', { id: 'functions' }), /reserved/)

    const bad = structuredClone(d)
    M.blockOf(bad, bad.root.children[0]).constants = { scale: 'u32' }; bad.root.children[0].params.scale = -1.5
    ok('a broken constant does not validate', M.validate(bad).some(x => /u32/.test(x)), JSON.stringify(M.validate(bad)))
    eq('toTree carries constants and functions', [M.toTree(M.parse(M.serialize(d))).functions === d.functions], [true])
}

//----------------------------------------------------------------------------------------------
// Editing a parameter: rename, change kind, range
//----------------------------------------------------------------------------------------------
{
    const d = M.createDoc()
    const o = M.addObject(d, 'root', { id: 'n', type: 'code', params: { a: 1, count: 4, tint: { r: 1, g: 0, b: 0 } },
        constants: { count: 'u32' } })
    const S = () => M.blockOf(d, o)
    M.setRange(d, 'n', 'count', { min: 1, max: 8, step: 1 })
    M.renameParam(d, 'n', 'count', 'steps')
    eq('a rename keeps value, place, constant and range', [Object.keys(o.params), o.params.steps, S().constants, S().ranges],
        [['a', 'steps', 'tint'], 4, { steps: 'u32' }, { steps: { min: 1, max: 8, step: 1 } }])
    throws('a rename onto an existing name is refused', () => M.renameParam(d, 'n', 'a', 'tint'), /already/)
    throws('as is one to a reserved name', () => M.renameParam(d, 'n', 'a', 'blend'), /blend/)
    M.setParamKind(d, 'n', 'steps', 'vector')
    eq('a new kind starts from its default and drops what a vector cannot have',
        [o.params.steps, S().constants, S().ranges], [{ x: 0, y: 0, z: 0 }, undefined, undefined])
    eq('paramKind reads all three', ['a', 'steps', 'tint'].map(k => M.paramKind(o.params[k])), ['number', 'vector', 'colour'])
    throws('a range needs min below max', () => M.setRange(d, 'n', 'a', { min: 2, max: 1, step: 0.1 }), /below/)
    M.setRange(d, 'n', 'a', { min: 2, max: 5, step: 0.5 })
    eq('a range pulls the value into it', o.params.a, 2)
    M.setRange(d, 'n', 'a', { min: 0, max: 5, step: 0.5 })
    eq('the document with ranges is sound, and ranges survive a round trip',
        [M.validate(d), (b => M.blockOf(b, b.root.children[0]).ranges)(M.parse(M.serialize(d)))], [[], { a: { min: 0, max: 5, step: 0.5 } }])
    M.removeParam(d, 'n', 'a')
    ok('removing a parameter removes its range', !S().ranges)
}

//----------------------------------------------------------------------------------------------
// A material's own parameters -- the same operations as an object's, refused on its fields
//----------------------------------------------------------------------------------------------
{
    const d = M.createDoc()
    const m = M.addMaterial(d, { id: 'mt' })
    M.addParam(d, 'mt', 'stripe', { r: 1, g: 0, b: 0 })
    M.addParam(d, 'mt', 'width', 0.5)
    eq('a material takes parameters of its own', M.customParams(m), ['stripe', 'width'])
    eq('and stays sound', M.validate(d), [])
    throws('not under a name its code already has', () => M.addParam(d, 'mt', 'p', 0), /not usable/)
    throws('nor under a field\'s name', () => M.addParam(d, 'mt', 'roughness', 0), /already/)
    throws('a field cannot be removed', () => M.removeParam(d, 'mt', 'roughness'), /field/)
    throws('nor renamed', () => M.renameParam(d, 'mt', 'baseColor', 'col'), /field/)
    throws('nor made compile-time', () => M.setConstant(d, 'mt', 'metallic', 'f32'), /field/)
    throws('nor given a range', () => M.setRange(d, 'mt', 'metallic', { min: 0, max: 1, step: 0.1 }), /field/)
    throws('nor renamed onto', () => M.renameParam(d, 'mt', 'width', 'roughness'), /already/)
    M.renameParam(d, 'mt', 'width', 'w')
    M.setConstant(d, 'mt', 'w', 'f32')
    M.setRange(d, 'mt', 'w', { min: 0, max: 2, step: 0.1 })
    const back = M.parse(M.serialize(d)).materials[0]
    eq('rename, constant and range survive a round trip', [M.customParams(back), back.constants, back.ranges],
        [['stripe', 'w'], { w: 'f32' }, { w: { min: 0, max: 2, step: 0.1 } }])
    M.setParamKind(d, 'mt', 'w', 'vector')
    eq('a new kind drops the constant and the range', [m.params.w, m.constants, m.ranges], [{ x: 0, y: 0, z: 0 }, undefined, undefined])
    M.removeParam(d, 'mt', 'w')
    eq('and one can be removed', M.customParams(m), ['stripe'])
    const bad = structuredClone(d); bad.materials[0].params.n = 1; bad.materials[0].params.odd = 'x'
    eq('a file with a bad one is refused, naming both', M.validate(bad).length, 2)
}


{
    // a group's code and parameters
    const d = M.createDoc()
    const g = M.addGroup(d, 'root', { id: 'g', code: 'C = children(C, p);', params: { k: 1 } })
    M.addParam(d, 'g', 'lift', 0.5)
    M.setRange(d, 'g', 'lift', { min: 0, max: 2, step: 0.1 })
    M.setConstant(d, 'g', 'k', 'u32')
    const t = M.toTree(d).children[0]
    eq('codegen sees its code, parameters, constants and ranges', [t.code, t.params, t.constants, t.ranges],
        ['C = children(C, p);', { k: 1, lift: 0.5 }, { k: 'u32' }, { lift: { min: 0, max: 2, step: 0.1 } }])
    eq('and they survive a round trip', M.parse(M.serialize(d)).root.children[0].params, { k: 1, lift: 0.5 })
    throws('a parameter named after what the code has in scope is refused', () => M.addParam(d, 'g', 'p', 1), /not usable/)
    throws('and so is children', () => M.addGroup(d, 'root', { params: { children: 1 } }), /not usable/)
    throws('the scene itself takes none', () => M.addParam(d, 'root', 'x', 1), /no parameters/)
    const bad = structuredClone(d), bB = M.blockOf(bad, bad.root.children[0])
    bB.code = 7; bB.params.C = 1; bad.root.children[0].params.C = 1
    eq('a file with a bad group is refused, naming both', M.validate(bad).length, 2, JSON.stringify(M.validate(bad)))
    const v4 = structuredClone(d); v4.version = 4; delete v4.root.children[0].params; delete v4.root.children[0].block; delete v4.blocks
    eq('a version 4 file loads as the current version', M.parse(JSON.stringify(v4)).version, M.VERSION)
    const dup = M.duplicate(d, 'g')
    eq('a duplicate carries its code', M.codeOf(d, dup), M.codeOf(d, g))
    ok('...the same block: editing it is editing both (version 16)', dup.block === g.block)
}

//----------------------------------------------------------------------------------------------
// VERSION 6: a unit, and light in cd/m^2.
//----------------------------------------------------------------------------------------------
{
    eq('a new scene is in metres', M.createDoc().unit, 'm')
    const d = M.createDoc(); d.unit = 'furlong'
    ok('an unknown unit is refused', M.validate(d).some(p => /unit 'furlong'/.test(p)))
    for (const u of ['m', 'cm', 'mm']) { d.unit = u; eq(`'${u}' is a valid unit`, M.validate(d), []) }
    eq('the tree carries the unit to codegen', generate(M.toTree(d)).unit, 'mm')

    // an old light: colour (1, 0, 0) at strength 5 had luminance Y(red) * 5 = 0.2126 * 5
    const v5 = JSON.parse(M.serialize(M.createDoc()))
    v5.version = 5; delete v5.unit
    const lamp = M.addMaterial(M.createDoc(), { id: 'lamp', preset: 'emissive' }).params
    delete lamp.emissiveLuminance
    v5.materials = [{ id: 'lamp', label: 'lamp', code: '',
                      params: { ...lamp, emissive: { r: 1, g: 0, b: 0 }, emissiveStrength: 5 } }]
    const up = M.parse(JSON.stringify(v5))
    eq('a version 5 file loads as the current version', up.version, M.VERSION)
    eq('and is a metre scene, as every scene before units was read', up.unit, 'm')
    const L = up.materials[0].params
    ok('its emission is a luminance now, and the old field is gone', !('emissiveStrength' in L))
    ok('as bright against the default sky as it was against the old one',
        Math.abs(L.emissiveLuminance - 0.2126 * 5 * M.OLD_EMISSION_TO_CDM2) < 1e-6,
        `got ${L.emissiveLuminance}`)
    eq('and the upgraded document is sound', M.validate(up), [])
}

//----------------------------------------------------------------------------------------------
// VERSION 15: the scene's radius is its own, in its unit -- no longer an environment setting in metres.
//----------------------------------------------------------------------------------------------
{
    const d = M.createDoc()
    ok('createDoc sets no radius: the 400 m default, as every scene before', !('envRadius' in d))
    eq('...which the panel reads in the scene\'s unit', [M.envRadiusOf(d), M.envRadiusOf({ ...d, unit: 'cm' }), M.envRadiusOf({ ...d, unit: 'mm' })],
        [400, 40000, 400000])
    eq('the tree carries no radius then, and codegen hands the renderer null for its default', generate(M.toTree(d)).envRadius, null)
    M.setEnvRadius(d, 25)
    eq('a radius set is the scene\'s own', [d.envRadius, M.envRadiusOf(d), M.validate(d)], [25, 25, []])
    eq('...and codegen carries it, in the scene\'s unit', generate(M.toTree(d)).envRadius, 25)
    throws('zero is refused', () => M.setEnvRadius(d, 0), /envRadius/)
    throws('NaN is refused', () => M.setEnvRadius(d, NaN), /envRadius/)
    eq('...and leaves the radius as it was', d.envRadius, 25)
    M.setEnvRadius(d, null)
    ok('null takes it back to the default', !('envRadius' in d))
    for (const bad of [-1, 'far', null]) ok(`validate refuses a radius of ${JSON.stringify(bad)}`,
        M.validate({ ...d, envRadius: bad }).some(p => /envRadius/.test(p)))

    // a version 14 file: the radius in environment, in metres
    const v14 = (unit, env) => { const o = JSON.parse(M.serialize(M.createDoc())); o.version = 14; o.unit = unit; if (env) o.environment = env; return o }
    const up = o => M.parse(JSON.stringify(o))
    const full = { envMode: 0, sunIlluminance: 90000, envRadius: 400 }
    const a = up(v14('m', full))
    eq('14 -> 15, and on to the current version', a.version, M.VERSION)
    ok('the 400 m default, which every environment copied from the renderer holds, is dropped -- not moved',
        !('envRadius' in a) && !('envRadius' in a.environment))
    eq('...and the rest of the environment stays', a.environment, { envMode: 0, sunIlluminance: 90000 })
    const b = up(v14('mm', { envMode: 0, envRadius: 0.3 }))
    eq('another radius moves to the scene, in its unit (0.3 m in a mm scene), rounded clean', b.envRadius, 300)
    eq('...gone from the environment', b.environment, { envMode: 0 })
    eq('0.3 m in a cm scene is 30, not 29.999999999999996', up(v14('cm', { envRadius: 0.3 })).envRadius, 30)
    const c = up(v14('cm', { envRadius: 400 }))
    ok('an environment left empty goes too: an empty one would stop its next edit copying the renderer\'s set',
        !('environment' in c) && !('envRadius' in c))
    ok('a file with no environment gains nothing', !('envRadius' in up(v14('m', null))) && !('environment' in up(v14('m', null))))
    ok('an upgraded document saves and loads as itself', M.serialize(up(JSON.parse(M.serialize(b)))) === M.serialize(b))
    // the environment refuses the radius now: it is not a Lighting setting any more
    ok('environment.envRadius in a version 15 file is refused', M.validate({ ...M.createDoc(), environment: { envRadius: 10 } })
        .some(p => /environment\.envRadius: not an environment setting/.test(p)))
}

//----------------------------------------------------------------------------------------------
// VERSION 7: clearcoat is gone.
//----------------------------------------------------------------------------------------------
{
    const v6 = JSON.parse(M.serialize(M.createDoc()))
    v6.version = 6
    const lamp = M.addMaterial(M.createDoc(), { id: 'coat', preset: 'plastic' }).params
    v6.materials = [{ id: 'coat', label: 'coat', code: '', params: { ...lamp, clearcoat: 0.4, clearcoatRoughness: 0.05 } }]
    const up = M.parse(JSON.stringify(v6))
    eq('a version 6 file loads as the current version', up.version, M.VERSION)
    ok('without the clearcoat fields', !('clearcoat' in up.materials[0].params) && !('clearcoatRoughness' in up.materials[0].params))
    eq('and is sound', M.validate(up), [])
    eq('the diffuse preset is a pure Lambertian now: no coat', M.addMaterial(M.createDoc(), { id: 'd', preset: 'diffuse' }).params.specular, 0)
}

//----------------------------------------------------------------------------------------------
// VERSION 8: the model field is gone, and every field left is one the panel should offer.
//----------------------------------------------------------------------------------------------
{
    const v7 = JSON.parse(M.serialize(M.createDoc()))
    v7.version = 7
    const lamp = M.addMaterial(M.createDoc(), { id: 'm', preset: 'plastic' }).params
    v7.materials = [{ id: 'm', label: 'm', code: '', params: { ...lamp, model: 1 } }]
    const up = M.parse(JSON.stringify(v7))
    eq('a version 7 file loads as the current version', up.version, M.VERSION)
    ok('without the model field', !('model' in up.materials[0].params))
    eq('and is sound', M.validate(up), [])
    eq('and has no parameters of its own left over', M.customParams(up.materials[0]), [])
    ok('the panel offers neither model nor clearcoat',
        !('model' in M.MATERIAL_FIELDS) && !('clearcoat' in M.MATERIAL_FIELDS))
}

//----------------------------------------------------------------------------------------------
// duplicateMaterial, and assets: copy and paste within a scene and between scenes
//----------------------------------------------------------------------------------------------
{
    const d = M.createDoc()
    const glass = M.addMaterial(d, { label: 'glass', preset: 'glass' })
    const red = M.addMaterial(d, { label: 'red', preset: 'plastic', code: '// stripes' })
    M.addParam(d, red.id, 'width', 0.5)
    const dup = M.duplicateMaterial(d, glass.id)
    eq('a duplicated material lands right after its original', d.materials.map(m => m.id), [glass.id, dup.id, red.id])
    ok('with a fresh id and a label that says so', dup.id !== glass.id && dup.label === 'glass copy')
    ok('and its own params', dup.params !== glass.params && JSON.stringify(dup.params) === JSON.stringify(glass.params))
    const dred = M.duplicateMaterial(d, red.id)
    eq('it carries code and parameters of its own', [dred.code, dred.params.width], ['// stripes', 0.5])
    throws('duplicating a material that is not there is refused', () => M.duplicateMaterial(d, 'nope'), /no material/)
    eq('the document is still sound', M.validate(d), [])

    // a source scene: a group of two spheres of glass and one of red
    const src = M.createDoc({ title: 'src' })
    const sg = M.addMaterial(src, { label: 'glass', preset: 'glass' })
    const sr = M.addMaterial(src, { label: 'red', preset: 'plastic' })
    const sw = M.addMaterial(src, { label: 'unused', preset: 'metal' })
    const grp = M.addGroup(src, 'root', { label: 'balls', transform: { pos: { x: 0.3, y: 0, z: 1 }, rot: { x: 0, y: 0, z: 0 }, scale: 2 } })
    M.addObject(src, grp.id, { primitive: 'sphere', material: sg.id })
    M.addObject(src, grp.id, { primitive: 'sphere', material: sg.id })
    M.addObject(src, grp.id, { primitive: 'sphere', material: sr.id })
    const asset = M.extractAsset(src, grp.id)
    eq('an asset carries only the materials its subtree uses', asset.materials.map(m => m.id), [sg.id, sr.id])
    ok('as a snapshot, not a reference', asset.node !== grp && asset.materials[0] !== sg)
    throws('the scene itself is not an asset', () => M.extractAsset(src, 'root'), /not an asset/)

    // into a scene that already has the same glass, under another name, and a different 'red'
    const dst = M.createDoc({ title: 'dst' })
    const dg = M.addMaterial(dst, { label: 'my glass', preset: 'glass' })
    const dr = M.addMaterial(dst, { label: 'red', preset: 'diffuse' })
    const host = M.addGroup(dst, 'root', { label: 'host' })
    M.addObject(dst, host.id, { primitive: 'sphere' })
    const put = M.insertAsset(dst, asset, host.id, 0)
    eq('an inserted node goes where it was put', host.children[0], put)
    const ids = []; M.walk(dst, n => ids.push(n.id))
    eq('every id in the target is still unique', new Set(ids).size, ids.length)
    const mats = put.children.map(n => n.material)
    eq('an identical material already there is reused, whatever it is called', [mats[0], mats[1]], [dg.id, dg.id])
    const newRed = M.material(dst, mats[2])
    ok('a different one is added', newRed && mats[2] !== dr.id && newRed.params.metallic === sr.params.metallic)
    eq('under a label that does not collide with the one there', newRed.label, 'red copy')
    eq('nothing unused comes along', dst.materials.length, 3)
    eq('the target is sound', M.validate(dst), [])
    const again = M.insertAsset(dst, asset, 'root')
    eq('a second paste adds no materials', [dst.materials.length, again.children[2].material], [3, mats[2]])
    ok('and the source is untouched', src.materials.length === 3 && grp.children.length === 3 && sw)

    // the same asset into a millimetre scene keeps its size in metres
    const mm = M.createDoc(); mm.unit = 'mm'
    const inMm = M.insertAsset(mm, asset)
    eq('a metre asset in a mm scene: position and scale times 1000', [inMm.transform.pos.x, inMm.transform.pos.z, inMm.transform.scale], [300, 1000, 2000])
    const back = M.insertAsset(src, M.extractAsset(mm, inMm.id))
    eq('and back again, exactly', [back.transform.pos.x, back.transform.scale], [0.3, 2])
    eq('its children are untouched by the conversion', inMm.children[0].transform, grp.children[0].transform)
    /* ...BUT EVERY BLEND IS CONVERTED. A CSG group combines distances already taken to the world (codegen
       children(): each child through add_new), so its blend is a world length, which no frame scales: a
       smooth group of 0.1 m pasted into mm kept 0.1, now a tenth of a millimetre on a shape 1000 times
       bigger in its units. Nested groups too, each its own world length. */
    {
        const sm = M.createDoc()
        const outer = M.addGroup(sm, 'root', { blend: 0.1, transform: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: 2 } })
        M.addObject(sm, outer.id, { primitive: 'sphere' })
        const inner = M.addGroup(sm, outer.id, { blend: 0.03 })
        M.addObject(sm, inner.id, { primitive: 'box' }); M.addObject(sm, inner.id, { primitive: 'sphere', join: 'subtract', joinBlend: 0.02 })
        const hard = M.addGroup(sm, outer.id)
        M.addObject(sm, hard.id, { primitive: 'box' })
        const pasted = M.insertAsset(mm, M.extractAsset(sm, outer.id))
        eq('a metre asset in a mm scene: every blend times 1000, nested ones and own join blends too, a zero one stays zero',
            [pasted.blend, pasted.children[1].blend, pasted.children[1].children[1].joinBlend, pasted.children[2].blend], [100, 30, 20, 0])
        const home = M.insertAsset(sm, M.extractAsset(mm, pasted.id))
        eq('...and back again, exactly', [home.blend, home.children[1].blend, home.children[1].children[1].joinBlend], [0.1, 0.03, 0.02])
    }

    // a material on its own is always a new one
    const lone = M.insertAsset(dst, M.extractAsset(src, sg.id), null, 0)
    ok('a material pasted on its own is new even when an identical one is there', lone.id !== dg.id && dst.materials[0] === lone)
    eq('and its label says it is a copy only if the name is taken', lone.label, 'glass')

    // all or nothing
    const n0 = JSON.stringify(dst)
    const broken = structuredClone(asset); broken.node.children[0].params = { 'bad name': 1 }
    throws('an asset that would make the document unsound is refused', () => M.insertAsset(dst, broken, 'root'))
    eq('and leaves it exactly as it was', JSON.stringify(dst), n0)
    throws('into an object, refused', () => M.insertAsset(dst, asset, put.children[0].id), /not a group/)
    eq('also unchanged', JSON.stringify(dst), n0)
    throws('something that is not an asset, refused', () => M.insertAsset(dst, { kind: 'x' }), /not an asset/)

    // and it compiles
    const wgsl = generate(M.toTree(dst)).wgsl
    ok('a scene with pasted nodes generates them with their new materials',
        wgsl.includes(`// node ${put.children[2].id} (code)`) && wgsl.includes(`let MATERIAL = matid_${newRed.id};`))
}

//----------------------------------------------------------------------------------------------
// VERSION 10: material types, lights, and the optics trace's reach
//----------------------------------------------------------------------------------------------
{
    const d = M.createDoc()
    M.addMaterial(d, { id: 'scr' })
    eq('a new material is a surface, stored as no field', [M.typeOf(M.material(d, 'scr')), 'type' in M.material(d, 'scr')], ['surface', false])
    M.setMaterialType(d, 'scr', 'detector')
    eq('setMaterialType sets it', M.material(d, 'scr').type, 'detector')
    M.setMaterialType(d, 'scr', 'emitter')
    ok('an emitter gets a glow if it had none', M.material(d, 'scr').params.emissiveLuminance > 0)
    M.setMaterialType(d, 'scr', 'surface')
    ok('surface removes the field', !('type' in M.material(d, 'scr')))
    throws('an unknown type is refused', () => M.setMaterialType(d, 'scr', 'source'), /type/)
    ok('the glowing preset is an emitter', M.typeOf(M.addMaterial(d, { preset: 'emissive' })) === 'emitter')
    ok('the fields each type shows: an emitter its emission, a limiter nothing',
        M.MATERIAL_FIELDS_OF.emitter.join() === 'emissive,emissiveLuminance' && M.MATERIAL_FIELDS_OF.limiter.length === 0)

    const L = M.addLight(d, 'root', { id: 'die', shape: 'rectangle', params: { width: 0.2, height: 0.1 }, flux: 100 })
    eq('a light: its own type, no material, its size as parameters', [L.type, L.material, L.params.width], ['light', null, 0.2])
    eq('and the document stays sound', M.validate(d), [])
    M.setLight(d, 'die', { twoSided: true, emitN: 1.41 })
    eq('setLight sets its settings', [M.lightOf(M.find(d, 'die').node).twoSided, M.find(d, 'die').node.light.emitN], [true, 1.41])
    M.setLight(d, 'die', { twoSided: false })
    ok('a setting back at its default is dropped', !('twoSided' in M.find(d, 'die').node.light))
    throws('a collimated light needs a flux', () => M.setLight(d, 'die', { flux: null, distribution: 'collimated' }), /flux/)
    throws('a light needs a size', () => M.addLight(d, 'root', { shape: 'disc', params: { radius: 0 } }), /radius/)
    throws('only a light has light settings', () => M.setLight(d, 'scr', {}), /./)
    // A LIGHT'S COLOUR three ways: RGB, CCT + Duv, xy -- exact, and the camera's copy in the display gamut
    const near = (a, b, t) => Math.abs(a - b) <= t
    M.setLight(d, 'die', { colourBy: 'cct', cct: 3000, duv: 0.002 })
    const ch = M.lightChromaticity(M.lightOf(M.find(d, 'die').node))
    ok('a light by CCT reads that CCT and Duv back', near(ch.cct, 3000, 0.5) && near(ch.duv, 0.002, 1e-6), JSON.stringify(ch))
    M.setLight(d, 'die', { colourBy: 'xy', xy: { x: 0.15, y: 0.025 } })
    const blueRGB = M.lightRGB(M.lightOf(M.find(d, 'die').node))
    ok('a royal blue by xy: exact, a negative channel, luminance 1', Math.min(...blueRGB) < 0
        && near(0.2126 * blueRGB[0] + 0.7152 * blueRGB[1] + 0.0722 * blueRGB[2], 1, 1e-12))
    const disp = M.lightDisplayRGB(M.lightOf(M.find(d, 'die').node))
    ok('...its face as the camera shows it: in the gamut', Math.min(disp.r, disp.g, disp.b) >= 0)
    const face = S.sourceTable(d).sources.find(x => x.id === 'die')
    ok('...and the optics source carries the exact colour', face.colour.every((v, i) => v === blueRGB[i]))
    throws('a CCT past the locus is refused', () => M.setLight(d, 'die', { colourBy: 'cct', cct: 20000 }), /cct/)
    throws('an xy outside the diagram is refused', () => M.setLight(d, 'die', { colourBy: 'xy', xy: { x: 0.7, y: 0.5 } }), /xy/)
    throws('an unknown colourBy is refused', () => M.setLight(d, 'die', { colourBy: 'hsv' }), /colourBy/)
    M.setLight(d, 'die', { colourBy: 'rgb', xy: { x: 0.3127, y: 0.329 } })
    ok('back to RGB at the defaults: nothing stored', !('colourBy' in M.find(d, 'die').node.light) && !('xy' in M.find(d, 'die').node.light))
    const bad = JSON.parse(M.serialize(d)); bad.root.children[0].material = 'scr'
    ok('a light with a material is refused', M.validate(bad).some(p => /no material/.test(p)))
    const rf = M.addLight(d, 'root', { shape: 'rayfile' })
    eq('a ray file starts with no file', rf.light.file, '')
    M.setLight(d, rf.id, { file: 'ZEMAXRAYFILE.DAT', box: [[-2, -2, 0], [2, 2, 1.4]] })
    ok('...and round-trips with one', M.parse(M.serialize(d)).root.children.find(n => n.id === rf.id).light.file === 'ZEMAXRAYFILE.DAT')
    M.setOpticsMaxDist(d, 15)
    ok('the optics maximum distance saves with the scene', M.parse(M.serialize(d)).optics.maxDist === 15)
    throws('a negative maximum distance is refused', () => M.setOpticsMaxDist(d, -1), /maxDist/)
    const old = JSON.parse(M.serialize(d)); old.optics.source = {}
    ok('an Optics page source in a version 10 file is refused', M.validate(old).some(p => /builder lights/.test(p)))

    // the table: a face with its frame and flux, a ray file with its frame
    const t = S.sourceTable(d)
    const die = t.sources.find(x => x.id === 'die')
    ok('the table: the light\'s face, its area and its flux', die.kind === 'face' && Math.abs(die.area - 0.02) < 1e-12 && die.flux === 100)
    eq('syncSources derives a light\'s luminance from its flux: flux / (pi A in m^2)', S.syncSources(d), ['die'])
    ok('...(a metre scene: 0.02 m^2)', Math.abs(M.find(d, 'die').node.light.luminance - 100 / (Math.PI * 0.02)) < 1e-9)
    eq('...and reports nothing when nothing changed', S.syncSources(d), [])
    ok('a ray file is in the table as a ray set', t.sources.some(x => x.id === rf.id && x.kind === 'rayset'))
    ok('fluxFactor: Lambertian pi, cos^n 2pi/(n+1), collimated none',
        Math.abs(S.fluxFactor({ distribution: 'cosine', n: 1 }) - Math.PI) < 1e-12 && Math.abs(S.fluxFactor({ distribution: 'cosine', n: 4 }) - 2 * Math.PI / 5) < 1e-12
        && S.fluxFactor({ distribution: 'collimated' }) === null)
    /* THE FACE SHOWS THE LIGHT IT EMITS (PLAN.md L3): its radiance over its luminance straight out,
       beamShape (the JS twin of codegen's lightBeam), integrated as g cos over the hemisphere, is
       fluxFactor -- so the luminance the camera sees at every angle carries exactly the flux the
       photons do. Midpoint rule in the angle; the cone's edge costs it a bin. */
    const faceFlux = s => {
        const beam = beamOf({ n: 1, halfAngle: 90, ...s }), N = 20000, dt = Math.PI / 2 / N
        let I = 0
        for (let i = 0; i < N; i++) { const t = (i + 0.5) * dt; I += beamShape(beam, Math.cos(t)) * Math.cos(t) * 2 * Math.PI * Math.sin(t) * dt }
        return I
    }
    for (const s of [{ distribution: 'cosine', n: 1 }, { distribution: 'cosine', n: 0 }, { distribution: 'cosine', n: 4 },
                     { distribution: 'cosine', n: 20 }, { distribution: 'cosine', n: 1, halfAngle: 7.5 },
                     { distribution: 'cosine', n: 4, halfAngle: 30 }, { distribution: 'uniform', halfAngle: 30 },
                     { distribution: 'uniform', halfAngle: 90 }]) {
        const want = S.fluxFactor({ n: 1, halfAngle: 90, ...s }), got = faceFlux(s)
        ok(`the face's radiance carries its flux: ${JSON.stringify(s)}`, Math.abs(got - want) < 2e-3 * want, `${got} vs ${want}`)
    }
    ok('a collimated face shows its Lambertian equivalent (syncSources: flux / (pi A))', Math.abs(faceFlux({ distribution: 'collimated' }) - Math.PI) < 1e-6)
    ok('outside the cone the face is dark, and at 56 degrees cos^4 shows cos^3',
        beamShape(beamOf({ distribution: 'cosine', n: 1, halfAngle: 30 }), Math.cos(56 * Math.PI / 180)) === 0
        && Math.abs(beamShape(beamOf({ distribution: 'cosine', n: 4, halfAngle: 90 }), 0.5) - 0.125) < 1e-12)
    for (const ax of [[0, 0, -1], [1, 0, 0], [0.3, -0.5, 0.8]]) {
        const l = Math.hypot(...ax), want = ax.map(c => c / l)
        const p = toParent({ pos: { x: 0, y: 0, z: 0 }, rot: S.rotationTowards(ax), scale: 1 }, [0, 0, 1])
        ok(`rotationTowards [${ax}] turns +z onto it`, p.every((c, k) => Math.abs(c - want[k]) < 1e-9))
    }
}
{
    // 9 -> 10: a material that emits becomes an emitter
    const v9 = JSON.parse(M.serialize(M.createDoc()))
    v9.version = 9
    v9.materials = [{ id: 'lamp', label: 'lamp', params: { ...JSON.parse(M.serialize(M.createDoc())).materials, ...Object.fromEntries(Object.entries(M.MATERIAL_FIELDS).map(([k, f]) => [k, structuredClone(f.def)])), emissiveLuminance: 5000 }, code: '' }]
    eq('9 -> 10: an emissive material becomes an emitter', M.typeOf(M.parse(JSON.stringify(v9)).materials[0]), 'emitter')

    /* A FILE FROM THE OPTICS BRANCH (its version 13): its optics test scene. Its LED -- a rectangle
       with a source material -- becomes a light; its lens and screen become code nodes; the source
       material, on nothing else, goes */
    const u = M.parse(readFileSync(new URL('./fixtures/branch-v13-optics-test.json', import.meta.url), 'utf8'))
    const die = u.root.children.find(n => n.id === 'die')
    ok('branch 13 -> 10: the LED sheet is a light with its flux, facing down', die?.type === 'light' && die.light.shape === 'rectangle'
        && Math.abs(die.light.flux - 100) < 1e-9 && die.params.width === 0.2 && die.transform.rot.x === 180)
    ok('branch 13 -> 10: the lens is a code node calling Nlens', u.root.children.some(n => n.type === 'code' && /Nlens\(/.test(M.codeOf(u, n))))
    ok('branch 13 -> 10: the screen\'s material is still a detector', u.materials.some(m => m.type === 'detector'))
    ok('branch 13 -> 10: the LED\'s source material is gone, nothing else used it', !u.materials.some(m => m.type === 'source' || m.source))
    ok('branch 13 -> 10: its maximum distance kept', u.optics?.maxDist === 20)

    /* ...and one from its version 9: an object-level detector flag, a sphere type, a ray set */
    const b9 = { format: 'raytracer-scene', version: 9, title: 'b9', nextId: 10, unit: 'm', functions: '',
        materials: [{ ...JSON.parse(M.serialize((() => { const x = M.createDoc(); M.addMaterial(x, { id: 'w' }); return x })())).materials[0] }],
        root: { id: 'root', kind: 'group', label: 'b9', enabled: true, op: 'union', blend: 0, children: [
            { id: 'ball', kind: 'object', type: 'sphere', label: 'ball', enabled: true, material: 'w', params: { radius: 2 },
              transform: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: 1 }, detector: true },
            { id: 'rs', kind: 'object', type: 'rayfile', label: 'rs', enabled: true, material: null, params: {},
              transform: { pos: { x: 0, y: 0, z: 1 }, rot: { x: 0, y: 0, z: 0 }, scale: 1 }, rayfile: { file: 'LED.DAT', flux: 10 } } ] } }
    const v = M.parse(JSON.stringify(b9))
    const ball = v.root.children.find(n => n.id === 'ball'), rs = v.root.children.find(n => n.id === 'rs')
    ok('branch 9 -> 10: the flagged sphere is a code node with a detector material',
        ball.type === 'code' && /Nsphere/.test(M.codeOf(v, ball)) && M.typeOf(M.material(v, ball.material)) === 'detector' && !('detector' in ball))
    ok('branch 9 -> 10: the ray set is a ray-file light', rs.type === 'light' && rs.light.shape === 'rayfile' && rs.light.file === 'LED.DAT' && rs.light.flux === 10)
    ok('a file of this line\'s version 9 is not taken for one from the branch', M.typeOf(M.parse(JSON.stringify(v9)).materials[0]) === 'emitter')

    /* ...NOR ONE OF ITS VERSION 10. A material's type and the optics reach are this line's version 10;
       the branch's 10 had neither (its types came at its 11). They were taken for branch evidence, and
       the branch's step made anything emitting a source and dropped the unused ones: an emitter not
       yet on an object, and a detector made from the emissive preset, vanished on save and open, and a
       detector in use came back an emitter (found 2026-09-30, reproduced in node). */
    const d10 = M.createDoc()
    const used = M.addMaterial(d10, { label: 'used', preset: 'diffuse' })
    M.addMaterial(d10, { label: 'lamp, unused', preset: 'emissive', type: 'emitter' })
    const glowDet = M.addMaterial(d10, { label: 'detector with emission', preset: 'emissive', type: 'emitter' })
    M.setMaterialType(d10, glowDet.id, 'detector')
    const glowDetUsed = M.addMaterial(d10, { label: 'used detector with emission', preset: 'emissive', type: 'emitter' })
    M.setMaterialType(d10, glowDetUsed.id, 'detector')
    const lim = M.addMaterial(d10, { label: 'limiter', preset: 'diffuse' })
    M.setMaterialType(d10, lim.id, 'limiter')
    M.addObject(d10, 'root', { primitive: 'sphere', material: used.id })
    M.addObject(d10, 'root', { primitive: 'box', material: glowDetUsed.id })
    M.setOpticsMaxDist(d10, 12)
    /* STAMPED 10: createDoc makes the current version, which never takes the version 10 path -- this test
       passed without testing anything from the move to 14 until the merge with main showed it (2026-09-30) */
    const text10 = M.serialize(d10), as10 = JSON.parse(text10); as10.version = 10
    const back10 = M.parse(JSON.stringify(as10))
    const mats = d => d.materials.map(m => `${m.id} ${M.typeOf(m)}`)
    eq('a version 10 file of this line keeps its typed materials, used or not', mats(back10), mats(d10))
    ok('...and loads exactly as it was saved, at the current version', M.serialize(back10) === text10)
    /* ...NOR ONE OF ITS VERSION 10: a material type and optics settings are this line's there. Taken for
       the branch's, an unused glowing material was turned into a source and dropped on every parse --
       every undo and redo -- and a detector with any emission became one too */
    const own = M.createDoc({ title: 'own 10' })
    M.addObject(own, 'root', { primitive: 'sphere' })
    M.addMaterial(own, { id: 'glow', preset: 'emissive' })
    M.addMaterial(own, { id: 'det', type: 'detector' })
    M.setOpticsMaxDist(own, 5)
    const own10 = JSON.parse(M.serialize(own)); own10.version = 10          // as a version 10 file (createDoc makes 14)
    const back = M.parse(JSON.stringify(own10))
    eq('this line\'s version 10 reads back as it was: an unused glowing material, a detector, optics settings',
        M.serialize(back), M.serialize(own))
    /* and the branch's 10 (roles, not types) still goes the branch's way */
    const b10 = JSON.parse(M.serialize(M.createDoc({ title: 'b10' })))
    b10.materials = [{ ...JSON.parse(M.serialize(own)).materials[1], id: 'scr', optics: 'detector' }]
    delete b10.materials[0].type
    b10.version = 10
    eq('the branch\'s version 10: a detector role becomes a detector type', M.typeOf(M.parse(JSON.stringify(b10)).materials[0]), 'detector')
}

//----------------------------------------------------------------------------------------------
// DOES THE MATERIAL FOLLOW THE WARP (setStraightMaterial): true or absent on a group, reaching codegen and files
//----------------------------------------------------------------------------------------------
{
    const d = M.createDoc()
    const g = M.addGroup(d, 'root', { id: 'tw', code: 'warp(0.5);\nC = children(C, p);' })
    M.addObject(d, 'tw', { id: 'o', primitive: 'box' })
    ok('a group starts following its warp (no field)', !('straightMaterial' in g))
    M.setStraightMaterial(d, 'tw', true)
    ok('set: true, and sound', g.straightMaterial === true && M.validate(d).length === 0, JSON.stringify(M.validate(d)))
    ok('...it reaches codegen: toTree copies it', M.toTree(d).children[0].straightMaterial === true)
    ok('...and a file, an asset and a copy', M.parse(M.serialize(d)).root.children[0].straightMaterial === true
        && M.extractAsset(d, 'tw').node.straightMaterial === true && M.find(d, M.duplicate(d, 'tw').id).node.straightMaterial === true)
    M.setStraightMaterial(d, 'tw', false)
    ok('off: the field gone, as a group that never had it', !('straightMaterial' in g) && !('straightMaterial' in M.toTree(d).children[0]))
    const refused = f => { try { f(); return null } catch (e) { return e.message } }
    ok('only a group bends space: an object refused', /not a group/.test(refused(() => M.setStraightMaterial(d, 'o', true)) ?? ''))
    const bad = structuredClone(d); bad.root.children[0].straightMaterial = false
    ok('a stored false is refused (the default has one spelling)', M.validate(bad).some(x => /straightMaterial/.test(x)), JSON.stringify(M.validate(bad)))
}

//----------------------------------------------------------------------------------------------
// A MATERIAL'S RELIEF (materials.js RELIEFS): a height field in mm, its parameters owned by <id>#relief
//----------------------------------------------------------------------------------------------
{
    /* THE 3D-PRINT LAYERS PRESET (on the scene's z, `world`): its code is the mirror below, line for line, and on the real value noise
       (noise.js's JS twin of the WGSL) its height stays within the amplitude, is continuous across the grooves --
       a difference quotient across a jump would be huge -- and never slopes more than the bound it declares,
       which the march divides its distances by */
    const L = M.RELIEFS.layers
    const MIRROR = [
        'let s = 2.0 * fract(world.z / layer) - 1.0;',
        'let k = 1.0 + variation * vnoise3(vec3<f32>(0.0, 0.0, floor(world.z / layer)), 61u).w;',
        'h = amplitude * (k * (1.0 - s * s) - 2.0 / 3.0);',
        'slope = 4.0 * (1.0 + variation) * amplitude / layer;',
    ]
    const lines = codeOnly(L.code).split('\n').map(l => l.trim()).filter(Boolean)
    ok('the layers relief is the mirror below, line for line', JSON.stringify(lines) === JSON.stringify(MIRROR), lines.join('\n      '))
    const fract = x => x - Math.floor(x)
    const relief = (z, { amplitude, layer, variation }) => {
        const s = 2 * fract(z / layer) - 1
        const k = 1 + variation * vnoise3([0, 0, Math.floor(z / layer)], 61)[3]
        return { h: amplitude * (k * (1 - s * s) - 2 / 3), slope: 4 * (1 + variation) * amplitude / layer }
    }
    const worst = { over: 0, steep: 0 }
    for (const P of [L.params, { amplitude: 0.1, layer: 0.05, variation: L.ranges.variation.max }, { amplitude: 0.5, layer: 2, variation: 0 }]) {
        const dz = P.layer / 256
        for (let z = -40 * P.layer; z < 40 * P.layer; z += dz) {
            const a = relief(z, P), b = relief(z + dz, P)
            worst.over = Math.max(worst.over, Math.abs(a.h) / P.amplitude)
            worst.steep = Math.max(worst.steep, Math.abs(b.h - a.h) / dz / a.slope)
        }
    }
    ok('...its height within the amplitude, up to the most variation its range allows (no clamp flattens a bead)', worst.over <= 1, `${worst.over}`)
    ok('...continuous, and no steeper than its slope bound anywhere, the grooves included', worst.steep <= 1 + 1e-9, `${worst.steep}`)
    const d = M.createDoc()
    M.addMaterial(d, { id: 'pla' })
    M.setRelief(d, 'pla', 'layers')
    ok('...and a material takes it as any preset: sound, its layer a length in mm', M.validate(d).length === 0 && M.material(d, 'pla').relief.lengths.includes('layer')
        && M.reliefPresetOf(M.material(d, 'pla').relief) === 'layers', JSON.stringify(M.validate(d)))
}
{
    const d = M.createDoc()
    M.addMaterial(d, { id: 'stone' })
    M.setRelief(d, 'stone', 'noise')
    const R = () => M.material(d, 'stone').relief
    ok('a preset gives a material a relief: its code, an amplitude and its own parameters', /fbm3/.test(R().code) && R().params.amplitude === 1 && R().params.size === 8)
    ok('...which the model reads back as sound', M.validate(d).length === 0, JSON.stringify(M.validate(d)))
    M.addParam(d, 'stone#relief', 'twist', 0.5)
    M.renameParam(d, 'stone#relief', 'twist', 'turn')
    M.setRange(d, 'stone#relief', 'turn', { min: 0, max: 2, step: 0.1 })
    M.setConstant(d, 'stone#relief', 'turn', 'f32')
    ok('its parameters take the parameter operations, owned by <id>#relief', R().params.turn === 0.5 && R().ranges.turn.max === 2 && R().constants.turn === 'f32' && !('twist' in R().params))
    const refused = f => { try { f(); return null } catch (e) { return e.message } }
    ok('...but its amplitude stays: not removed, renamed or made a vector', [
        refused(() => M.removeParam(d, 'stone#relief', 'amplitude')), refused(() => M.renameParam(d, 'stone#relief', 'amplitude', 'a')),
        refused(() => M.setParamKind(d, 'stone#relief', 'amplitude', 'vector'))].every(m => /amplitude bounds/.test(m ?? '')))
    ok('...and a parameter cannot be called q, h or slope (the relief\'s own names)', /not usable/.test(refused(() => M.addParam(d, 'stone#relief', 'q', 1)) ?? ''))
    ok('...nor world, the scene\'s point a relief may read', /not usable/.test(refused(() => M.addParam(d, 'stone#relief', 'world', 1)) ?? ''))
    ok('a material\'s own parameter cannot be relief_... (the relief\'s uniforms are)', /not usable/.test(refused(() => M.addParam(d, 'stone', 'relief_turn', 1)) ?? ''))
    const bad = structuredClone(d); bad.materials[0].relief.params.amplitude = -1; bad.materials[0].relief.extra = 1
    const why = M.validate(bad).join(' | ')
    ok('a relief with a negative amplitude, or a key it does not have, is refused, saying why', /amplitude/.test(why) && /'extra'/.test(why), why)
    const again = M.parse(M.serialize(d))
    ok('it is saved and read back as it was (no version change: an optional field)', JSON.stringify(M.material(again, 'stone').relief) === JSON.stringify(R()) && again.version === d.version)
    const smooth = structuredClone(M.material(d, 'stone')); delete smooth.relief
    ok('two materials that differ only by a relief are not the same material', !M.sameMaterial(M.material(d, 'stone'), smooth))
    const mm = M.createDoc(); mm.unit = 'mm'
    const moved = M.insertAsset(mm, M.extractAsset(d, 'stone'))
    ok('a relief is real size: into a millimetre scene its numbers are as they were', JSON.stringify(moved.relief) === JSON.stringify(R()))
    M.setRelief(d, 'stone', null)
    ok('...and none takes it away', R() === undefined && M.validate(d).length === 0)
    ok('an unknown preset is refused', /unknown relief/.test(refused(() => M.setRelief(d, 'stone', 'bumpy')) ?? ''))
}

//----------------------------------------------------------------------------------------------
// LENGTHS: parameters in the scene's unit, which the panel labels "radius (cm)" (the user, 2026-09-28)
//----------------------------------------------------------------------------------------------
{
    const d = M.createDoc()
    // which are lengths is the block's (version 16), read through the node's view
    const V = n => M.viewOf(d, n)
    const s = M.addObject(d, 'root', { primitive: 'sphere' })
    eq('a shape\'s parameters are lengths from the start', V(s).lengths, ['radius'])
    const b = M.addObject(d, 'root', { primitive: 'box' })
    eq('...all of a box\'s: its half-size and its rounding', V(b).lengths, ['size', 'rounding'])
    const c = M.addObject(d, 'root', { code: 'C = C;' })
    ok('a blank code node has none', V(c).lengths === undefined)
    M.addParam(d, c.id, 'reach', 1)
    M.setLength(d, c.id, 'reach', true)
    ok('marked as one', M.isLength(V(c), 'reach') && M.validate(d).length === 0, JSON.stringify(M.validate(d)))
    M.renameParam(d, c.id, 'reach', 'span')
    eq('renamed, it stays one under its new name', V(c).lengths, ['span'])
    M.setParamKind(d, c.id, 'span', 'vector')
    ok('a vector can be one', M.isLength(V(c), 'span'))
    M.setParamKind(d, c.id, 'span', 'colour')
    ok('a colour cannot: turned into one, it is no longer a length', !M.isLength(V(c), 'span') && V(c).lengths === undefined)
    throws('a colour is refused as a length', () => M.setLength(d, c.id, 'span', true), /colour/)
    M.setParamKind(d, c.id, 'span', 'number'); M.setLength(d, c.id, 'span', true)
    M.removeParam(d, c.id, 'span')
    ok('removed, its marking goes with it', V(c).lengths === undefined)
    M.addParam(d, c.id, 'w', 1); M.setLength(d, c.id, 'w', true); M.setLength(d, c.id, 'w', false)
    ok('unmarked', V(c).lengths === undefined)
    M.blockOf(d, c).lengths = ['nothere']
    ok('a length that is not a parameter is reported', M.validate(d).some(p => p.includes("length 'nothere'")))
    delete M.blockOf(d, c).lengths
    const g = M.addGroup(d, 'root', { label: 'twist', params: { rate: 1, extent: 1 }, lengths: ['extent'] })
    ok('a group takes them too (a modifier\'s extent)', M.isLength(V(g), 'extent') && !M.isLength(V(g), 'rate') && M.validate(d).length === 0)
    // a label only: the shader is the same with or without
    const plain = M.createDoc(), marked = M.createDoc()
    M.addObject(plain, 'root', { id: 'q', primitive: 'sphere', lengths: [] })
    M.addObject(marked, 'root', { id: 'q', primitive: 'sphere' })
    ok('...and it changes nothing the shader says', generate(M.toTree(plain)).wgsl === generate(M.toTree(marked)).wgsl)
}

//----------------------------------------------------------------------------------------------
// A PROFILE PARAMETER (BUILDER.md §6 phase 3): a list of points a code object's code extrudes or revolves -- its own
// kind, a code object's only, a length, and never set to an outline that is not sound
{
    const d = M.createDoc()
    const o = M.addObject(d, 'root', { primitive: 'box', id: 'p' })
    M.addParam(d, 'p', 'outline', M.DEFAULT_PROFILE())
    eq('paramKind reads a list of points as a profile, and a flat list of numbers as nothing it knows',
        [M.paramKind(o.params.outline), M.paramKind([1, 2, 3]), M.paramKind([])], ['profile', 'other', 'other'])
    ok('an object with a profile is sound, and it survives a round trip', M.validate(d).length === 0
        && JSON.stringify(M.parse(M.serialize(d)).root.children[0].params.outline) === JSON.stringify(o.params.outline), JSON.stringify(M.validate(d)))
    throws('a profile with edges that cross is refused when added, by its points', () => M.addParam(d, 'p', 'bad', [[0, 0], [2, 2], [2, 0], [0, 1]]), /profile 'bad': edges 1-2 and 3-4 cross/)
    M.setProfile(d, 'p', 'outline', [[0, 0], [1, 0, 0.2], [1, 1], [0, 1]])
    eq('setProfile sets it', o.params.outline, [[0, 0], [1, 0, 0.2], [1, 1], [0, 1]])
    throws('...and refuses one too short', () => M.setProfile(d, 'p', 'outline', [[0, 0], [1, 0]]), /at least three/)
    throws('...or a fillet too big, by its point', () => M.setProfile(d, 'p', 'outline', [[0, 0], [1, 0, 5], [1, 1], [0, 1]]), /point 2/)
    eq('...leaving it as it was', o.params.outline, [[0, 0], [1, 0, 0.2], [1, 1], [0, 1]])
    throws('...or something that is not a list of points', () => M.setProfile(d, 'p', 'outline', [1, 2, 3]), /list of points/)
    throws('setProfile on a number refuses', () => M.setProfile(d, 'p', 'rounding', [[0, 0], [1, 0], [0, 1]]), /not a profile/)
    M.addParam(d, 'p', 'shape', 1)
    M.setParamKind(d, 'p', 'shape', 'profile')
    eq('a number turned into a profile starts as the default outline', o.params.shape, M.DEFAULT_PROFILE())
    const g = M.addGroup(d, 'root', { id: 'g' }); M.addParam(d, 'g', 'k', 1)
    throws('a group cannot have one', () => M.setParamKind(d, 'g', 'k', 'profile'), /code object's/)
    const m = M.addMaterial(d, { id: 'mat' }); M.addParam(d, 'mat', 'k', 1)
    throws('nor a material', () => M.setParamKind(d, 'mat', 'k', 'profile'), /code object's/)
    M.setLength(d, 'p', 'outline', true)
    ok('a profile can be a length (its points are in the scene\'s unit)', M.isLength(M.viewOf(d, o), 'outline') && M.validate(d).length === 0, JSON.stringify(M.validate(d)))
    const t = JSON.parse(M.serialize(d)); t.root.children[0].params.outline = [[0, 0], [1, 1], [2, 2]]
    throws('a file with an unsound profile is refused on load, saying which and why', () => M.parse(JSON.stringify(t)), /'p': profile 'outline': the outline encloses no area/)
}

//----------------------------------------------------------------------------------------------
// A PATH PARAMETER (BUILDER.md §6 phase 4): { path: [[x, y, z], [x, y, z, fillet], ...] }, an open line a code object
// sweeps along -- wrapped, because a list of [x, y, z] would read as a profile with fillets. Its own kind, a code
// object's only, a length, and never set to a path that is not sound
{
    const d = M.createDoc()
    const o = M.addObject(d, 'root', { primitive: 'box', id: 'p' })
    M.addParam(d, 'p', 'route', M.DEFAULT_PATH())
    eq('paramKind reads { path } as a path; a bare list of [x, y, z] is still a profile; { path } not a list is nothing',
        [M.paramKind(o.params.route), M.paramKind([[0, 0, 0], [1, 0, 0], [1, 1, 0]]), M.paramKind({ path: 3 })], ['path', 'profile', 'other'])
    ok('the default path is sound, and an object with it survives a round trip', M.validate(d).length === 0
        && JSON.stringify(M.parse(M.serialize(d)).root.children[0].params.route) === JSON.stringify(o.params.route), JSON.stringify(M.validate(d)))
    throws('a path folding back is refused when added, by its point', () => M.addParam(d, 'p', 'bad', { path: [[0, 0, 0], [1, 0, 0], [0, 0, 0]] }), /path 'bad': the path turns back on itself at point 2/)
    M.setPath(d, 'p', 'route', [[0, 0, 0], [1, 0, 0, 0.2], [1, 1, 0], [1, 1, 1]])
    eq('setPath sets it, wrapped', o.params.route, { path: [[0, 0, 0], [1, 0, 0, 0.2], [1, 1, 0], [1, 1, 1]] })
    throws('...and refuses one too short', () => M.setPath(d, 'p', 'route', [[0, 0, 0]]), /at least two/)
    throws('...or a fillet too big, by its point', () => M.setPath(d, 'p', 'route', [[0, 0, 0], [1, 0, 0, 5], [1, 1, 0]]), /point 2/)
    throws('...or a point with two numbers, by its number', () => M.setPath(d, 'p', 'route', [[0, 0, 0], [1, 0]]), /point 2: x, y, z/)
    throws('...or a fillet on an end', () => M.setPath(d, 'p', 'route', [[0, 0, 0, 0.1], [1, 0, 0]]), /point 1: an end has no corner/)
    // A POINT'S SCALE AND TWIST (2026-10-02): entries 5 to 7, and a builder from before refuses them by the point
    M.setPath(d, 'p', 'route', [[0, 0, 0, 0, 2], [1, 0, 0, 0.2, 1.5, 0.5, 30], [1, 1, 0]])
    eq('...and takes a point\'s scale x, scale y and twist', o.params.route.path[1], [1, 0, 0, 0.2, 1.5, 0.5, 30])
    ok('...a document with them is valid', M.validate(d).length === 0, JSON.stringify(M.validate(d)))
    throws('...but not a scale of 0, by its point', () => M.setPath(d, 'p', 'route', [[0, 0, 0], [1, 0, 0, 0, 0], [1, 1, 0]]), /point 2: a scale is more than 0/)
    M.setPath(d, 'p', 'route', [[0, 0, 0], [1, 0, 0, 0.2], [1, 1, 0], [1, 1, 1]])
    eq('...leaving it as it was', o.params.route, { path: [[0, 0, 0], [1, 0, 0, 0.2], [1, 1, 0], [1, 1, 1]] })
    throws('...or something that is not a list of points', () => M.setPath(d, 'p', 'route', [1, 2, 3]), /list of points/)
    throws('setPath on a number refuses', () => M.setPath(d, 'p', 'rounding', [[0, 0, 0], [1, 0, 0]]), /not a path/)
    M.addParam(d, 'p', 'outline', M.DEFAULT_PROFILE())
    throws('...and on a profile', () => M.setPath(d, 'p', 'outline', [[0, 0, 0], [1, 0, 0]]), /not a path/)
    throws('setProfile on a path refuses', () => M.setProfile(d, 'p', 'route', [[0, 0], [1, 0], [0, 1]]), /not a profile/)
    M.addParam(d, 'p', 'line', 1)
    M.setParamKind(d, 'p', 'line', 'path')
    eq('a number turned into a path starts as the default', o.params.line, M.DEFAULT_PATH())
    M.setParamKind(d, 'p', 'line', 'profile')
    eq('...and a path into a profile as the default outline', o.params.line, M.DEFAULT_PROFILE())
    const g = M.addGroup(d, 'root', { id: 'g' }); M.addParam(d, 'g', 'k', 1)
    throws('a group cannot have one', () => M.setParamKind(d, 'g', 'k', 'path'), /a path is a code object's/)
    throws('...nor be given one outright', () => M.addParam(d, 'g', 'r2', M.DEFAULT_PATH()))
    const m = M.addMaterial(d, { id: 'mat' }); M.addParam(d, 'mat', 'k', 1)
    throws('nor a material', () => M.setParamKind(d, 'mat', 'k', 'path'), /a path is a code object's/)
    M.setLength(d, 'p', 'route', true)
    ok('a path can be a length (its points and fillets are in the scene\'s unit)', M.isLength(M.viewOf(d, o), 'route') && M.validate(d).length === 0, JSON.stringify(M.validate(d)))
    const t = JSON.parse(M.serialize(d)); t.root.children[0].params.route = { path: [[0, 0, 0], [0, 0, 0], [1, 0, 0]] }
    throws('a file with an unsound path is refused on load, saying which and why', () => M.parse(JSON.stringify(t)), /'p': path 'route': points 1 and 2 are the same point/)
}

//----------------------------------------------------------------------------------------------
// A PATH THAT NAMES PARAMETERS, AND A LIVE ONE (2026-10-01): `0.5, 0.5, rise` reads the node's own numbers; what no
// value could put right is refused, what a slider can reach (a fillet too big) is allowed and draws nothing; what
// is TYPED is checked at today's values; a rename rewrites the path, a removal or a re-kind of a named one is refused
//----------------------------------------------------------------------------------------------
{
    const d = M.createDoc()
    const o = M.addObject(d, 'root', { id: 'p', params: { rise: 0.6, r: 0.2, route: { path: [[0, 0, 0], [1, 0, 0, 'r'], [1, 1, 0], [1, 1, 'rise']] } },
        code: 'C = add_new(C, tube(route, p, 0.1, 0.0), MATERIAL);' })
    ok('a path naming the node\'s numbers is sound', M.validate(d).length === 0, JSON.stringify(M.validate(d)))
    eq('resolvePath reads it against the node', M.resolvePath(o.params, o.params.route).points, [[0, 0, 0], [1, 0, 0, 0.2], [1, 1, 0], [1, 1, 0.6]])
    throws('a name the node does not have is refused, by its point', () => M.addParam(d, 'p', 'other', { path: [[0, 0, 0], [0, 0, 'h']] }), /path 'other': point 2, z: no parameter 'h'/)
    o.params.rise = 0.1                                         // as a slider would: the last edge shorter than its fillet
    ok('...but a value a slider can reach is allowed: it draws nothing, and the file still loads', M.validate(d).length === 0
        && M.parse(M.serialize(d)).root.children[0].params.rise === 0.1, JSON.stringify(M.validate(d)))
    throws('...while TYPING such a path is refused, at today\'s values', () => M.setPath(d, 'p', 'route', [[0, 0, 0], [1, 0, 0, 'r'], [1, 1, 0, 'r'], [1, 1, 'rise']]), /fillet/)
    o.params.rise = 0.6
    M.setPath(d, 'p', 'route', [[0, 0, 0], ['rise', 0, 0, 'r'], ['rise', 1, 0]])
    eq('setPath takes expressions, kept as written', o.params.route, { path: [[0, 0, 0], ['rise', 0, 0, 'r'], ['rise', 1, 0]] })
    throws('...and refuses one that does not read, at its column', () => M.setPath(d, 'p', 'route', [[0, 0, 0], ['rise +', 0, 0]]), /point 2, x: "rise \+": the expression ends too soon \(column 7\)/)
    const numeric = { path: [[0, 0, 0], [1, 0, 0, 5], [1, 1, 0]] }
    throws('a path naming nothing is still refused when its numbers are unsound', () => M.addParam(d, 'p', 'fixed', numeric), /point 2/)
    // LIVE
    M.setPathLive(d, 'p', 'route', true)
    eq('setPathLive marks it live', o.params.route.live, true)
    M.setPath(d, 'p', 'route', [[0, 0, 0], ['rise', 0, 0, 'r'], ['rise', 1, 0], ['rise', 1, 1]])
    ok('...setPath keeps it live', o.params.route.live === true && o.params.route.path.length === 4)
    ok('...and it survives a round trip', JSON.stringify(M.parse(M.serialize(d)).root.children[0].params.route) === JSON.stringify(o.params.route))
    M.setPathLive(d, 'p', 'route', false)
    ok('...and back to compiled, the flag gone', !('live' in o.params.route))
    const long = { path: Array.from({ length: M.LIVE_PATH_MAX + 1 }, (_, i) => [i, i % 2, 0]) }
    M.addParam(d, 'p', 'long', long)
    throws(`live is refused over ${M.LIVE_PATH_MAX} points`, () => M.setPathLive(d, 'p', 'long', true), /at most 64 points/)
    const t = JSON.parse(M.serialize(d)); t.root.children[0].params.long.live = true
    throws('...and on load', () => M.parse(JSON.stringify(t)), /a live path has at most 64 points/)
    M.removeParam(d, 'p', 'long')
    // NAMES FOLLOW A RENAME; A NAMED PARAMETER STAYS
    M.renameParam(d, 'p', 'rise', 'lift')
    eq('renaming a parameter rewrites the path\'s points that name it', o.params.route.path, [[0, 0, 0], ['lift', 0, 0, 'r'], ['lift', 1, 0], ['lift', 1, 1]])
    throws('removing a named parameter is refused, saying where it is named', () => M.removeParam(d, 'p', 'lift'), /'lift' is named by path 'route' \(point 2\)/)
    throws('...and so is changing its kind', () => M.setParamKind(d, 'p', 'r', 'vector'), /'r' is named by path 'route' \(point 2\)/)
    ok('...the document as it was', o.params.lift === 0.6 && o.params.r === 0.2 && M.validate(d).length === 0)
}

//----------------------------------------------------------------------------------------------
// A PROFILE THAT NAMES PARAMETERS, AND A LIVE ONE (2026-10-02): as a path -- what no value could put right refused,
// what a slider can reach drawn as nothing; live is the node's (`liveProfiles`), since the value is a bare list, and
// TOTREE CARRIES IT: codegen sees the node only through toTree, which copies its fields by name
//----------------------------------------------------------------------------------------------
{
    const d = M.createDoc()
    const o = M.addObject(d, 'root', { id: 'pl', params: { w: 1, h: 0.5, r: 0.1, outline: [[0, 0], ['w', 0, 'r'], ['w', 'h'], [0, 'h']] },
        code: 'C = add_new(C, extrude(outline, p, 0.2), MATERIAL);' })
    ok('an outline naming the node\'s numbers is sound', M.validate(d).length === 0, JSON.stringify(M.validate(d)))
    eq('resolveProfile reads it against the node', M.resolveProfile(o.params, o.params.outline).points, [[0, 0], [1, 0, 0.1], [1, 0.5], [0, 0.5]])
    throws('a name the node does not have is refused, by its point', () => M.addParam(d, 'pl', 'other', [[0, 0], ['q', 0], [0, 1]]), /profile 'other': point 2, x: no parameter 'q'/)
    o.params.h = 0                                              // as a slider would: the outline flat, no area
    ok('...a value a slider can reach is allowed (it draws nothing) and the file still loads', M.validate(d).length === 0 && M.parse(M.serialize(d)).root.children[0].params.h === 0)
    throws('...while TYPING such an outline is refused, at today\'s values', () => M.setProfile(d, 'pl', 'outline', [[0, 0], ['w', 0], ['w', 'h'], [0, 'h']]), /points 2 and 3 are the same point/)
    o.params.h = 0.5
    M.setProfile(d, 'pl', 'outline', [[0, 0], ['w', 0, 'r'], ['w', 'h * 2'], [0, 'h * 2']])
    eq('setProfile takes expressions, kept as written', o.params.outline, [[0, 0], ['w', 0, 'r'], ['w', 'h * 2'], [0, 'h * 2']])
    throws('...and refuses one that does not read, at its column', () => M.setProfile(d, 'pl', 'outline', [[0, 0], ['w *', 0], [0, 1]]), /point 2, x: "w \*": the expression ends too soon \(column 4\)/)
    throws('an outline naming nothing is still refused when unsound', () => M.addParam(d, 'pl', 'flat', [[0, 0], [1, 1], [2, 2]]), /no area/)
    // LIVE
    M.setProfileLive(d, 'pl', 'outline', true)
    eq('setProfileLive lists it on the node', o.liveProfiles, ['outline'])
    ok('...the value stays a bare list', Array.isArray(o.params.outline) && M.paramKind(o.params.outline) === 'profile')
    eq('...TOTREE CARRIES IT to codegen', M.toTree(d).children[0].liveProfiles, ['outline'])
    ok('...it survives a round trip', JSON.stringify(M.parse(M.serialize(d)).root.children[0].liveProfiles) === '["outline"]')
    M.setProfile(d, 'pl', 'outline', [[0, 0], ['w', 0, 'r'], ['w', 'h'], [0, 'h']])
    eq('...setProfile keeps it live', o.liveProfiles, ['outline'])
    M.setProfileLive(d, 'pl', 'outline', false)
    ok('...and back to compiled, the list gone', !('liveProfiles' in o))
    const N = M.LIVE_PROFILE_MAX + 1
    M.addParam(d, 'pl', 'big', Array.from({ length: N }, (_, i) => [Math.cos(2 * Math.PI * i / N), Math.sin(2 * Math.PI * i / N)]))
    throws(`live is refused over ${M.LIVE_PROFILE_MAX} points`, () => M.setProfileLive(d, 'pl', 'big', true), /at most 64 points/)
    M.removeParam(d, 'pl', 'big')
    const t = JSON.parse(M.serialize(d)); t.root.children[0].liveProfiles = ['w']
    throws('a live list naming something not a profile is refused on load', () => M.parse(JSON.stringify(t)), /live profile 'w' is not one of its profiles/)
    // RENAME, REMOVE, RE-KIND
    M.setProfileLive(d, 'pl', 'outline', true)
    M.renameParam(d, 'pl', 'h', 'height')
    eq('renaming a parameter rewrites the outline\'s points that name it', o.params.outline, [[0, 0], ['w', 0, 'r'], ['w', 'height'], [0, 'height']])
    M.renameParam(d, 'pl', 'outline', 'shape')
    eq('renaming the profile renames it in the live list', o.liveProfiles, ['shape'])
    throws('removing a named parameter is refused, saying where', () => M.removeParam(d, 'pl', 'w'), /'w' is named by profile 'shape' \(point 2\)/)
    throws('...and so is changing its kind', () => M.setParamKind(d, 'pl', 'r', 'vector'), /'r' is named by profile 'shape' \(point 2\)/)
    M.addParam(d, 'pl', 'spare', [[0, 0], [1, 0], [0, 1]]); M.setProfileLive(d, 'pl', 'spare', true)
    M.setParamKind(d, 'pl', 'spare', 'number')
    eq('a live profile made a number leaves the live list', o.liveProfiles, ['shape'])
    M.setParamKind(d, 'pl', 'spare', 'profile'); M.setProfileLive(d, 'pl', 'spare', true); M.removeParam(d, 'pl', 'spare')
    eq('...and so does a removed one', o.liveProfiles, ['shape'])
    ok('...the document sound', M.validate(d).length === 0, JSON.stringify(M.validate(d)))
}

//----------------------------------------------------------------------------------------------
// LOCKS (setLock): against the hand, saved with the node, nothing the shader sees
//----------------------------------------------------------------------------------------------
{
    const d = M.createDoc({ title: 'locks' })
    M.addGroup(d, 'root', { id: 'g' })
    const o = M.addObject(d, 'g', { id: 'o', primitive: 'box' })
    M.addLight(d, 'root', { id: 'lamp' })
    const shader = () => generate(...M.generateArgs(d)).wgsl
    const before = shader()
    eq('a node starts unlocked, with no field', [M.lockOf(o), 'lockPosition' in o, 'lockParams' in o], [{ position: false, params: false }, false, false])
    M.setLock(d, 'o', 'position', true)
    eq('lock position: that one, stored as true', [M.lockOf(o), o.lockPosition, 'lockParams' in o], [{ position: true, params: false }, true, false])
    M.setLock(d, 'o', 'params', true)
    eq('...and lock parameters beside it', M.lockOf(o), { position: true, params: true })
    for (const id of ['g', 'lamp']) M.setLock(d, id, 'params', true)
    ok('a group and a light lock too, and the document is sound', M.lockOf(M.find(d, 'g').node).params && M.lockOf(M.find(d, 'lamp').node).params
        && M.validate(d).length === 0, JSON.stringify(M.validate(d)))
    eq('nothing the shader sees: the same text locked as unlocked', shader() === before, true)
    ok('...toTree copies neither', !/"lock(Position|Params)"/.test(JSON.stringify(M.toTree(d))))
    ok('a file keeps them', M.lockOf(M.find(M.parse(M.serialize(d)), 'o').node).position)
    ok('...a copy keeps them', M.lockOf(M.find(d, M.duplicate(d, 'o').id).node).params)
    {
        const e = M.createDoc({ title: 'into' }), n = M.insertAsset(e, M.extractAsset(d, 'o'))
        eq('...and an asset, pasted or from the library', M.lockOf(n), { position: true, params: true })
    }
    M.setLock(d, 'o', 'position', false)
    eq('unlocked: the field gone, as a node that never had it', ['lockPosition' in o, M.lockOf(o)], [false, { position: false, params: true }])
    throws('the root has nothing to lock', () => M.setLock(d, 'root', 'position', true), /root has nothing to lock/)
    throws('a lock that is not one is refused, by name', () => M.setLock(d, 'o', 'scale', true), /no lock 'scale': it is position or params/)
    throws('a material is not a node', () => M.setLock(d, M.addMaterial(d).id, 'position', true), /no node/)
    eq('lockOf anything without them: unlocked', [M.lockOf(null), M.lockOf(d.root), M.lockOf(d.materials[0])],
        [{ position: false, params: false }, { position: false, params: false }, { position: false, params: false }])
    const bad = structuredClone(d)
    M.find(bad, 'o').node.lockParams = false
    bad.root.lockPosition = true
    const problems = M.validate(bad)
    ok('a stored false is refused (the default has one spelling), and a lock on the root',
        problems.some(x => /'o': lockParams is true or absent/.test(x)) && problems.some(x => /root has no lockPosition/.test(x)), JSON.stringify(problems))
}

//----------------------------------------------------------------------------------------------
// BLOCKS (version 16): code and its parameters' schema, which nodes use -- the user's design, PERFORMANCE.md P3
//----------------------------------------------------------------------------------------------
{
    const CUSTOM = 'C = add_new(C, Nsphere(p, r * 2.0), MATERIAL);'
    // ---- a version 15 file: each distinct code with its schema one block, the nodes with it its users
    const v15 = JSON.parse(M.serialize(M.createDoc()))
    v15.version = 15; delete v15.blocks
    const obj = (id, code, params, extra = {}) => ({ id, kind: 'object', type: 'code', label: id, enabled: true, transform: M.identity(),
        material: null, params, code, ...extra })
    v15.root.children = [
        obj('a', CUSTOM, { r: 1 }), obj('b', CUSTOM, { r: 3 }),                         // the same code: one block
        obj('c', CUSTOM, { r: 1 }, { ranges: { r: { min: 0, max: 9, step: 1 } } }),    // the same code, another schema
        obj('s', M.PRIMITIVES.sphere.code, { radius: 2 }, { lengths: ['radius'], ranges: { radius: M.blockOf(M.createDoc(), null)?.ranges ?? undefined } }),
        { id: 'g', kind: 'group', label: 'g', enabled: true, blend: 0, transform: M.identity(), code: 'C = children(C, p);', params: { k: 1 }, children: [] },
    ]
    // the sphere as + makes it, so it is the built-in: its ranges and lengths the primitive's
    { const t = M.createDoc(), n = M.addObject(t, 'root', { primitive: 'sphere' }); v15.root.children[3] = obj('s', M.codeOf(t, n), { radius: 2 },
        { lengths: [...M.blockOf(t, n).lengths], ranges: structuredClone(M.blockOf(t, n).ranges) }) }
    const d = M.parse(JSON.stringify(v15))
    const n = id => M.find(d, id).node, B = id => M.blockOf(d, n(id))
    eq('15 -> 16: the version, and every node names a block and holds no code', [d.version, ['a', 'b', 'c', 's', 'g'].every(id => n(id).block && n(id).code === undefined)], [M.VERSION, true])
    ok('...the same code and schema are one block, its users keeping their own values', B('a') === B('b') && n('a').params.r === 1 && n('b').params.r === 3)
    ok('...the same code with another schema is another block', B('c') !== B('a') && B('c').ranges.r.max === 9)
    eq('...a primitive\'s code and schema is its built-in, named as it', [B('s').builtin, B('s').label], ['sphere@1', 'sphere'])
    ok('...a group\'s code is a block of its kind', B('g').kind === 'group' && B('g').code === 'C = children(C, p);' && n('g').params.k === 1)
    eq('...and the scene is sound', M.validate(d), [])
    // ---- editing a block: every user changes with it
    M.setCode(d, 'a', CUSTOM.replace('2.0', '3.0'))
    ok('a shared block\'s code edited through one node: both have it', M.codeOf(d, n('b')).includes('3.0') && B('a') === B('b'))
    M.addParam(d, 'a', 'gain', 0.5)
    eq('...a parameter added: every user has it, at the value given', [n('a').params.gain, n('b').params.gain, Object.keys(B('a').params)], [0.5, 0.5, ['r', 'gain']])
    n('b').params.gain = 0.9
    M.renameParam(d, 'a', 'gain', 'g2')
    eq('...renamed: each keeps its own value under the new name', [n('a').params.g2, n('b').params.g2, 'gain' in n('b').params], [0.5, 0.9, false])
    M.setRange(d, 'b', 'g2', { min: 0, max: 0.6, step: 0.1 })
    eq('...a range set through either: the block\'s, every value pulled into it', [B('a').ranges.g2.max, n('b').params.g2], [0.6, 0.6])
    M.removeParam(d, 'b', 'g2')
    ok('...removed through either: from the block and both', !('g2' in n('a').params) && !('g2' in n('b').params) && !('g2' in B('a').params))
    M.setConstant(d, 'a', 'r', 'u32')
    ok('...a constant is the block\'s, its value still each node\'s (two values, two functions)', B('b').constants.r === 'u32' && n('a').params.r === 1 && n('b').params.r === 3)
    M.setConstant(d, 'a', 'r', null)
    // ---- a built-in is read-only: an edit through one node is that node's alone
    const s2 = M.addObject(d, 'root', { primitive: 'sphere' })
    ok('a sphere added shares the built-in', s2.block === n('s').block)
    M.addParam(d, 's', 'wobble', 0)
    ok('a parameter added to one sphere: a copy of its own, the other still the built-in', B('s') !== M.blockOf(d, s2) && !B('s').builtin
        && M.blockOf(d, s2).builtin === 'sphere@1' && !('wobble' in s2.params) && B('s').label !== 'sphere')
    // ---- a variant, another block, a block nothing uses
    const own = M.splitBlock(d, 'b')
    M.setCode(d, 'b', CUSTOM)
    ok('splitBlock: a copy for that node alone -- editing it leaves the other', n('b').block === own.id && M.codeOf(d, n('a')).includes('3.0') && !M.codeOf(d, n('b')).includes('3.0'))
    M.useBlock(d, 'c', B('a').id)
    ok('useBlock: another of the scene\'s blocks, its value for a parameter both have kept', B('c') === B('a') && n('c').params.r === 1)
    throws('useBlock: not a group\'s block on an object', () => M.useBlock(d, 'a', B('g').id), /group/)
    const unused = d.blocks.find(b => !M.usersOf(d, b.id).length && !b.builtin)
    ok('a block no node uses stays in the scene\'s list (its code is the user\'s)', !!unused)
    throws('removeBlock refuses one in use, naming the users', () => M.removeBlock(d, B('a').id), /used by/)
    M.removeBlock(d, unused.id)
    ok('...and removes one nothing uses', !M.block(d, unused.id))
    // ---- a duplicate shares; an asset carries its blocks, reused where the scene has the same
    const dup = M.duplicate(d, 'a')
    ok('a duplicate uses the same block', dup.block === n('a').block)
    const other = M.createDoc()
    const ins = M.insertAsset(other, M.extractAsset(d, 'a'))
    const again = M.insertAsset(other, M.extractAsset(d, 'a'))
    ok('an asset brings its block, and a second paste reuses it', ins.block === again.block && other.blocks.length === 1 && M.codeOf(other, ins).includes('3.0'))
    const clash = M.createDoc()
    M.addObject(clash, 'root', { code: 'C = C;', label: other.blocks[0].label })
    M.renameBlock(clash, clash.blocks[0].id, other.blocks[0].label)
    const put = M.insertAsset(clash, M.extractAsset(d, 'a'))
    ok('...a block of the same name and other code is added beside it, never over it', M.blockOf(clash, put).label === `${other.blocks[0].label} 2`
        && M.codeOf(clash, clash.root.children[0]) === 'C = C;')
    // an asset from before 16 (a library item, the clipboard): code on its nodes, blocks made as it goes in
    const old = { kind: 'node', unit: 'm', materials: [], node: { id: 'x', kind: 'object', type: 'code', label: 'x', enabled: true,
        transform: M.identity(), material: null, params: { r: 1 }, code: CUSTOM } }
    const fromOld = M.insertAsset(M.createDoc(), old)
    ok('an asset from before version 16 gets its block as it goes in', !!fromOld.block && fromOld.code === undefined)
    // ---- what validate refuses
    const bad = structuredClone(d)
    bad.root.children[0].params.extra = 1
    ok('a node with a parameter its block has not', M.validate(bad).some(x => /extra is not a parameter of block/.test(x)), JSON.stringify(M.validate(bad)))
    const bad2 = structuredClone(d); bad2.root.children[0].block = 'nope'
    ok('a node naming no block of the scene', M.validate(bad2).some(x => /no block 'nope'/.test(x)))
    const bad3 = structuredClone(d); bad3.root.children[0].code = 'C = C;'
    ok('a node with code of its own (a version 16 file says it is its block\'s)', M.validate(bad3).some(x => /its code is its block's/.test(x)))
    const bad4 = structuredClone(d); bad4.root.children[0].block = M.blockOf(d, n('g')).id
    ok('an object naming a group\'s block', M.validate(bad4).some(x => /a group's code/.test(x)))
    // ---- the shader: a document and its version 15 self compile to the same text
    ok('the shader is the same from the version 15 file and from its upgrade saved and read again',
        generate(M.toTree(M.parse(JSON.stringify(v15)))).wgsl === generate(M.toTree(M.parse(M.serialize(M.parse(JSON.stringify(v15)))))).wgsl)
}

//----------------------------------------------------------------------------------------------
// ARRAYS (version 17): a plain group's children drawn at each of its copies
//----------------------------------------------------------------------------------------------
{
    const d = M.createDoc()
    const g = M.addGroup(d, 'root', { id: 'arr' })
    M.addObject(d, 'arr', { id: 'ball', primitive: 'sphere' })
    eq('a row of copies: n along an axis, centred, a pitch apart', M.copiesRow(3, 2).map(t => t.pos.x), [-2, 0, 2])
    M.setCopies(d, 'arr', M.copiesRow(3, 2, 'y'))
    ok('set: three copies, and the scene is sound', g.copies.length === 3 && g.copies[2].pos.y === 2 && M.validate(d).length === 0, JSON.stringify(M.validate(d)))
    ok('the tree carries them to codegen', M.toTree(d).children[0].copies.length === 3)
    throws(`at most ${M.ARRAY_MAX}`, () => M.setCopies(d, 'arr', M.copiesRow(M.ARRAY_MAX + 1, 1)), /at most 16 copies/)
    throws('a copy is a transform', () => M.setCopies(d, 'arr', [{ pos: { x: 0, y: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: 1 }]), /copy '1'.*pos/)
    throws('not on a group with code', () => { M.addGroup(d, 'root', { id: 'tw', code: 'C = children(C, p);' }); M.setCopies(d, 'tw', M.copiesRow(2, 1)) }, /code has no copies/)
    throws('not on a group whose children join', () => {
        M.addGroup(d, 'root', { id: 'cut' }); M.addObject(d, 'cut', { primitive: 'box' }); M.addObject(d, 'cut', { primitive: 'sphere', join: 'subtract' })
        M.setCopies(d, 'cut', M.copiesRow(2, 1))
    }, /join.*no copies/)
    throws('not over a light: light sampling needs each face where it is', () => {
        M.addGroup(d, 'root', { id: 'lamps' }); M.addLight(d, 'lamps', { id: 'lp', shape: 'disc' }); M.setCopies(d, 'lamps', M.copiesRow(2, 1))
    }, /light inside an array/)
    throws('the root has none', () => M.setCopies(d, 'root', M.copiesRow(2, 1)), /not a group of the scene/)
    M.setCopies(d, 'arr', null)
    ok('null: a plain group again', g.copies === undefined && M.validate(d).length === 0)
    // a version 16 file: nothing to change, and a version 17 file is refused by the version before it
    const v16 = JSON.parse(M.serialize(d)); v16.version = 16
    eq('16 -> 17: the version, nothing else', [M.parse(JSON.stringify(v16)).version, M.serialize(M.parse(JSON.stringify(v16))) === M.serialize(d)], [M.VERSION, true])
    // the bounds see every copy
    M.setCopies(d, 'arr', M.copiesRow(3, 4))
    const b = estimateBoxOf(M.toTree(d))
    ok('the scene\'s estimate holds every copy', b && b.lo[0] <= -4.4 && b.hi[0] >= 4.4, JSON.stringify(b))
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
