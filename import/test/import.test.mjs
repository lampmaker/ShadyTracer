//======================================================================================================================
// Tests for the import end to end (index.js convert, shapes.js addPart) through the real builder: a STEP or STL file
// in, an asset out that the tree pastes into a scene, and a scene that generates. Run: node import/test/import.test.mjs
//
// What is held: the asset is a sound piece of a document (model.js insertAsset takes it whole or refuses it); pasted
// into a scene in metres it is the same size as in one in millimetres (the unit is the asset's, mm); every shape the
// conversion makes is one of the builder's presets sharing its block, or the cone written in shapes.js; the part
// generates (codegen) with its shapes in it; an assembly is one group of its parts; and what cannot be converted is
// refused by name with why. Whether it compiles is check-shaders' (the Imported parts example, scenes/make.mjs), and
// whether it looks right is the user's.
//======================================================================================================================
import { readFileSync } from 'node:fs'
import * as M from '../../builder/model.js'
import { generate } from '../../builder/codegen.js'
import { convert, kindOf } from '../index.js'
import { CONE_CODE, shapeSDF } from '../shapes.js'
import { PRIMITIVES } from '../../builder/primitives.js'

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
