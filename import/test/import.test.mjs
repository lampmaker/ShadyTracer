//======================================================================================================================
// Tests for the import end to end (index.js convert, shapes.js addPart) through the real builder: a STEP or STL file
// in, an asset out that the tree pastes into a scene, and a scene that generates. Run: node import/test/import.test.mjs
//
// What is held: the asset is a sound piece of a document (model.js insertAsset takes it whole or refuses it); pasted
// into a scene in metres it is the same size as in one in millimetres (the unit is the asset's, mm); every shape the
// conversion makes is one of the builder's presets sharing its block, or the cone written in shapes.js; the part
// generates (codegen) with its shapes in it; an assembly is one group of its parts; it stands on the floor, centred
// over the origin, or where the file has it; and what cannot be converted is refused by name with why. Whether it
// compiles is check-shaders' (the Imported parts example, scenes/make.mjs), and whether it looks right is the user's.
//======================================================================================================================
import { readFileSync } from 'node:fs'
import * as M from '../../builder/model.js'
import { generate, isCsg } from '../../builder/codegen.js'
import { convert, kindOf } from '../index.js'
import { CONE_CODE, shapeSDF, addPart } from '../shapes.js'
import { frame, sphere } from '../geom.js'
import { mulberry } from '../brep.js'
import { PRIMITIVES } from '../../builder/primitives.js'
import { nodeSDF } from './docsdf.mjs'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const fixture = n => readFileSync(new URL(`./fixtures/${n}`, import.meta.url))
const walk = (n, f) => { f(n); for (const c of n.children || []) walk(c, f) }

// WHICH READER: by the name, then the first line
ok('kindOf: .step, .stp and .stl by name', kindOf('a.STEP', new Uint8Array()) === 'step' && kindOf('b.stp', new Uint8Array()) === 'step' && kindOf('c.stl', new Uint8Array()) === 'stl')
ok('...a STEP file with another name by its first line', kindOf('part.txt', new TextEncoder().encode('ISO-10303-21;\nHEADER;')) === 'step')
let msg = ''
try { convert(M, 'notes.txt', new TextEncoder().encode('hello')) } catch (e) { msg = e.message }
ok('...and anything else refused, saying so', /not a STEP or STL file/.test(msg), msg)

// THE PLATE, into a scene in mm and one in m
{
    const white = M.addMaterial(M.createDoc(), { label: 'white', preset: 'diffuse' })
    const r = convert(M, 'plate.step', fixture('plate.step'), { material: white })
    ok('plate.step: one part, nothing refused, nothing to warn of', r.kind === 'step' && r.parts.length === 1 && !r.refused.length && !r.warnings.length, JSON.stringify(r.refused) + r.warnings)
    ok('...an asset in mm, its top node the part', r.asset?.kind === 'node' && r.asset.unit === 'mm' && r.asset.node.kind === 'group')
    const shapes = []
    walk(r.asset.node, n => { if (n.kind === 'object') shapes.push(n) })
    ok('...six shapes: a box, four holes and a pocket', shapes.length === 6 && shapes.filter(n => n.label.startsWith('hole')).length === 4
        && shapes.filter(n => n.join === 'subtract').length === 5, shapes.map(n => `${n.label}:${n.join ?? 'base'}`).join(' '))
    // every shape a preset's block (or the cone's): the same code, the same parameters
    const blocks = new Map(r.asset.blocks.map(b => [b.id, b]))
    ok('...each shape a preset\'s code', shapes.every(n => Object.values(PRIMITIVES).some(p => p.code === blocks.get(n.block)?.code)))
    ok('...each made of the material given', shapes.every(n => n.material === r.asset.materials[0]?.id) && r.asset.materials.length === 1 && M.sameMaterial(r.asset.materials[0], white))

    const docMM = M.ensureMaterial(M.createDoc({ title: 'mm' })); docMM.unit = 'mm'
    const docM = M.ensureMaterial(M.createDoc({ title: 'm' })); docM.unit = 'm'
    const a = M.insertAsset(docMM, r.asset, 'root'), b = M.insertAsset(docM, r.asset, 'root')
    ok('pasted into a mm scene: at scale 1', a.transform.scale === 1)
    ok('...into a metre scene: the same part, its frame scaled to metres', Math.abs(b.transform.scale - 0.001) < 1e-15 && Math.abs(b.transform.pos.x - a.transform.pos.x / 1000) < 1e-12)
    ok('...and both documents sound', !M.validate(docMM).length && !M.validate(docM).length, [...M.validate(docMM), ...M.validate(docM)].join('; '))
    ok('...the material the scene had, used rather than copied', docM.materials.filter(m => m.label.startsWith('white')).length === 1)
    const g = generate(...M.generateArgs(docMM, { id: 'imported', title: 'imported' }))
    ok('...the scene generates, its holes in the shader', typeof g.wgsl === 'string' && (g.wgsl.match(/Ncylinder\(/g) || []).length >= 4, g.wgsl?.length)
    // and survives a save and a load
    const again = M.parse(M.serialize(docMM))
    ok('...and a save and a load', JSON.stringify(again.root) === JSON.stringify(docMM.root))
}

// THE BOSS: its chamfer the cone of shapes.js, with its normal
{
    const r = convert(M, 'boss.step', fixture('boss.step'))
    const blocks = new Map(r.asset.blocks.map(b => [b.id, b]))
    const cones = []
    walk(r.asset.node, n => { if (n.kind === 'object' && blocks.get(n.block)?.code === CONE_CODE) cones.push(n) })
    ok('boss.step: its chamfer a cone, written with its own normal (not the preset\'s, which has none)', cones.length === 1 && !/sdCappedCone/.test(CONE_CODE), cones.length)
    const doc = M.ensureMaterial(M.createDoc()); doc.unit = 'mm'
    M.insertAsset(doc, r.asset, 'root')
    const g = generate(...M.generateArgs(doc, { id: 'boss', title: 'boss' }))
    ok('...the scene generates with the cone\'s code in it', g.wgsl.includes('let caps = abs(p.z) - 0.5 * height;'))
}

// AN ASSEMBLY: one group, a part each, where the assembly has them
{
    const r = convert(M, 'assembly.step', fixture('assembly.step'))
    ok('assembly.step: two parts in one group named after the file', r.parts.length === 2 && r.asset.node.label === 'assembly'
        && r.asset.node.children.map(c => c.label).sort().join() === 'holder,lens', r.asset.node.children?.map(c => c.label).join())
    const lens = r.parts.find(p => p.name === 'lens')
    ok('...the lens where the assembly put it (its centre at x = 5, z = 8)', lens && Math.abs(0.5 * (lens.ir.box.lo[0] + lens.ir.box.hi[0]) - 5) < 0.2
        && Math.abs(0.5 * (lens.ir.box.lo[2] + lens.ir.box.hi[2]) - 8) < 0.2, JSON.stringify(lens?.ir.box))
}

/* WHERE IT STANDS (the user's Onshape part was half under the floor, 2026-10-21): by default on z = 0, centred over the
   origin, on its faces and not on the padded box its shapes are cut to; with place: 'file', where the file has it. Held
   on the document as the shader computes it (docsdf.mjs), against the parts' sizes as made (make.py), not against what
   index.js computed them to be */
{
    const at = (r, p) => nodeSDF(r.asset.node, p, r.asset.blocks)
    const floor = convert(M, 'plate.step', fixture('plate.step')), file = convert(M, 'plate.step', fixture('plate.step'), { place: 'file' })
    // the plate is 40 x 30 x 5 about its origin, its holes at (±15, ±10) and its pocket in its top
    ok('plate.step on the floor: its bottom face is z = 0', Math.abs(at(floor, [10, 5, 0])) < 1e-6 && Math.abs(at(floor, [10, 5, -0.5]) - 0.5) < 1e-6,
       `${at(floor, [10, 5, 0])} ${at(floor, [10, 5, -0.5])}`)
    ok('...centred over the origin: its sides at x = ±20 and y = ±15', [[20, 0, 1], [-20, 0, 1], [0, 15, 1], [0, -15, 1]].every(p => Math.abs(at(floor, p)) < 1e-6),
       [[20, 0, 1], [-20, 0, 1], [0, 15, 1], [0, -15, 1]].map(p => at(floor, p)).join())
    const ref = JSON.parse(readFileSync(new URL('./fixtures/plate.json', import.meta.url), 'utf8'))
    let worst = 0
    for (const [x, y, z] of ref.points) worst = Math.max(worst, Math.abs(at(floor, [x, y, z + 2.5]) - at(file, [x, y, z])))
    ok('...and with place: \'file\', the same part where its file has it, 2.5 mm lower', worst < 1e-9, worst)
    // an assembly: the whole stands on the floor, its parts where they are in it (the boss's base at z = -11)
    const a = convert(M, 'assembly.step', fixture('assembly.step')), b = convert(M, 'assembly.step', fixture('assembly.step'), { place: 'file' })
    const aref = JSON.parse(readFileSync(new URL('./fixtures/assembly.json', import.meta.url), 'utf8'))
    worst = 0
    for (const [x, y, z] of aref.points) worst = Math.max(worst, Math.abs(at(a, [x, y, z + 11]) - at(b, [x, y, z])))
    ok('the assembly on the floor: both parts moved together, 11 mm up', worst < 1e-9, worst)
    ok('...the parts in their group where they were', JSON.stringify(a.asset.node.children.map(c => c.transform.pos)) === JSON.stringify(b.asset.node.children.map(c => c.transform.pos)))
}

/* EVERY GROUP ONE SHAPE (shapes.js addPart says why): a group whose children all join by union is a plain group to
   codegen, folded by the nearest boundary either way, which cut holes in four of the six parts as shapes of an
   intersection (import.gpu.mjs, 2026-10-21; since 0.next codegen combines such a shape, but a part's own group, outside
   any CSG group, still folds). Every group an import makes combines its children into one shape */
{
    const plain = []
    const files = ['plate', 'bracket', 'boss', 'lens', 'roundbox', 'cup'].flatMap(n => [`${n}.step`, `${n}.stl`]).concat('onshape.step')
    for (const f of files) {
        const r = convert(M, f, fixture(f)), n = f
        walk(r.asset.node, g => { if (g.kind === 'group' && g.children.length > 1 && !isCsg(g)) plain.push(`${n} › ${g.label}`) })
    }
    ok('every group of every fixture, STEP and STL, and of the user\'s Onshape part, combined into one shape by codegen (none folded as a plain union)', !plain.length, plain.join(', '))
    const r = convert(M, 'cup.step', fixture('cup.step'))
    const cup = []; walk(r.asset.node, g => { if (g.kind === 'group') cup.push(`${g.label}:${g.children.length}`) })
    ok('the cup: two groups, its union the start of its intersection\'s fold, not a group of its own', cup.length === 2 && r.parts[0].report.groups === 2, cup.join(' '))
}
/* ...AND WHAT NO FIXTURE HAS, written as formulas by hand: two unions intersected (the second closed with the part's box),
   a union that is the whole part (closed the same way), a union cut away (cut shape by shape). The document, as
   codegen combines it (docsdf.mjs), is the formula's own value everywhere */
{
    const F0 = frame([0, 0, 0], [0, 0, 1], [1, 0, 0])
    const box = (lo, hi) => ({ n: { kind: 'box', F: F0, lo, hi }, neg: false })
    const ball = (c, r, neg = false) => ({ n: { kind: 'sphere', S: sphere(frame(c, [0, 0, 1], [1, 0, 0]), r) }, neg })
    const or = (...kids) => ({ n: { kind: 'or', kids }, neg: false })
    const CASES = {
        'two unions intersected': { kind: 'and', kids: [or(box([-10, -10, -10], [2, 10, 10]), box([-2, -6, -10], [10, 6, 10])), or(ball([0, 0, -4], 8), ball([0, 0, 5], 7))] },
        'a union as the whole part': { kind: 'or', kids: [box([-10, -10, -3], [10, 10, 3]), ball([6, 0, 0], 5), ball([-6, 0, 0], 5)] },
        'a union cut away': { kind: 'and', kids: [box([-10, -10, -10], [10, 10, 10]), { ...or(ball([0, 0, 10], 6), ball([0, 0, 4], 5)), neg: true }] },
    }
    const rnd = mulberry(5)
    for (const [label, root] of Object.entries(CASES)) {
        const doc = M.ensureMaterial(M.createDoc()); doc.unit = 'mm'
        const g = addPart(M, doc, 'root', { root, box: { lo: [-12, -12, -12], hi: [12, 12, 12] } }, { unit: 'mm', label })
        const groups = []; walk(g, n => { if (n.kind === 'group') groups.push(n) })
        let worst = 0
        for (let i = 0; i < 4000; i++) {
            const p = [0, 1, 2].map(() => -15 + 30 * rnd())
            worst = Math.max(worst, Math.abs(nodeSDF(g, p, doc.blocks) - shapeSDF(root, p)))
        }
        ok(`${label}: every group combined into one shape, and the document the formula's value at 4000 points`,
            groups.every(n => n.children.length < 2 || isCsg(n)) && worst < 1e-6, `${groups.map(n => `${n.label}:${isCsg(n)}`).join(' ')} worst ${worst}`)
        if (label !== 'a union cut away') ok(`...closed with the part's box`, groups.some(n => n.children.some(c => c.label === 'the part\'s box')))
        else ok('...cut shape by shape, no box', !groups.some(n => n.children.some(c => c.label === 'the part\'s box')) && groups.length === 1)
    }
}

/* THE USER'S ONSHAPE PART (onshape.step, their own file, 2026-10-21: "did not convert/import too well"): 44 shapes in 29
   groups and half under the floor then. In metres in the file, a 56 mm cylinder along y: as pasted, 7 shapes in 2 groups,
   in mm, lying on its circle on z = 0 centred over the origin (the file's axes kept) */
{
    const r = convert(M, 'onshape.step', fixture('onshape.step'))
    const R = r.parts[0]?.report
    ok('the user\'s Onshape part: one part, 7 shapes in 2 groups, nothing refused or warned of', r.parts.length === 1 && R.shapes === 7 && R.groups === 2 && !r.refused.length && !r.warnings.length,
        JSON.stringify([R, r.refused, r.warnings]))
    const at = p => nodeSDF(r.asset.node, p, r.asset.blocks)
    ok('...56 mm across, lying on its circle on z = 0, its top at 56, centred over the origin',
        [[0, 0, 0], [0, 0, 56], [28, 0, 28], [-28, 0, 28]].every(p => Math.abs(at(p)) < 1e-5) && Math.abs(at([0, 0, -0.5]) - 0.5) < 1e-5,
        [[0, 0, 0], [0, 0, 56], [28, 0, 28], [-28, 0, 28], [0, 0, -0.5]].map(at).join())
}

// THE STL OF THE SAME PART: the same shapes as its STEP
{
    const a = convert(M, 'plate.stl', fixture('plate.stl')), b = convert(M, 'plate.step', fixture('plate.step'))
    const labels = r => { const out = []; walk(r.asset.node, n => { if (n.kind === 'object') out.push(n.label) }); return out.sort().join() }
    ok('plate.stl: the shapes plate.step gives', labels(a) === labels(b), `${labels(a)} | ${labels(b)}`)
    const ref = JSON.parse(readFileSync(new URL('./fixtures/plate.json', import.meta.url), 'utf8'))
    let bad = 0
    for (const [x, y, z, c, d] of ref.points) if (d > 0.01 && (shapeSDF(a.parts[0].ir.root, [x, y, z]) < 0 ? 1 : 0) !== c) bad++
    ok('...on OpenCascade\'s side of the surface wherever the STL knows it', bad === 0, bad)
}

// REFUSED, BY NAME, WITH WHY -- and the rest of the file still converted
{
    const step = readFileSync(new URL('./fixtures/assembly.step', import.meta.url), 'utf8')
        .replace(/SPHERICAL_SURFACE\('',(#\d+),20\.\)/, "B_SPLINE_SURFACE_WITH_KNOTS('',1,1,((#3,#3),(#3,#3)),.UNSPECIFIED.,.F.,.F.,.F.,(2,2),(2,2),(0.,1.),(0.,1.),.UNSPECIFIED.)")
    const r = convert(M, 'freeform.step', new TextEncoder().encode(step))
    ok('a solid with a B-spline face: refused by name, saying why', r.refused.length === 1 && r.refused[0].name === 'lens' && /B-spline|bspline/.test(r.refused[0].why), JSON.stringify(r.refused))
    ok('...the other part still converted and in the asset', r.parts.length === 1 && r.parts[0].name === 'holder' && !!r.asset)
    const stl = fixture('lens.stl')
    const open = new Uint8Array(stl.length - 50)
    open.set(stl.slice(0, 84)); open.set(stl.slice(134), 84)
    new DataView(open.buffer).setUint32(80, (stl.length - 84) / 50 - 1, true)
    const o = convert(M, 'holed.stl', open)
    ok('an STL with a hole in it: refused, no asset, the reason the mesh being open', !o.asset && /not closed/.test(o.refused[0]?.why), JSON.stringify(o.refused))
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
