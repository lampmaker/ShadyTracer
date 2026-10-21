//======================================================================================================================
// Tests for the STEP reader (step.js) and the solid it becomes (brep.js). Run: node import/test/step.test.mjs
//
// The parts are OpenCascade's own (fixtures/make.py, CadQuery): the face types it reports for each, and points its
// solid classifier put inside or outside. Every one of those points is held to brep.js's inside() here -- which is
// what the conversion trusts to build and to check its formula (csg.js).
// The Part 21 details are checked on records written here: a ';' inside a string, a comment, a complex entity, an
// escaped name, and the units -- a file in inches and one in metres made from the plate's by changing its unit alone.
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { readSTEP, entities } from '../step.js'
import { brep } from '../brep.js'
import { len, sub } from '../geom.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const fixture = n => new URL(`./fixtures/${n}`, import.meta.url)
const PARTS = ['plate', 'bracket', 'boss', 'lens', 'roundbox']

// PART 21
{
    const text = `ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n` +
        `#1 = PRODUCT('a;b','it''s',' /* not a comment */',(#2));\n` +
        `/* a comment; with a semicolon */\n` +
        `#2 = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );\n` +
        `#3 = CARTESIAN_POINT('',(1.,-2.5E-01,3));\n` +
        `#4 = MEASURE_REPRESENTATION_ITEM('',LENGTH_MEASURE(1.E-07),$);\n` +
        `#5 = PRODUCT('\\X2\\00E9\\X0\\t\\X\\E9','',' ',());\nENDSEC;\nEND-ISO-10303-21;\n`
    const E = entities(text)
    ok('records: five', E.size === 5, E.size)
    const p = E.get(1)
    eqs('a string keeps its semicolon and its quote', p.args.slice(0, 2), ['a;b', "it's"])
    ok('...and what looks like a comment inside it', p.args[2] === ' /* not a comment */')
    ok('a complex entity: its parts by name', E.get(2).type === null && E.get(2).parts.SI_UNIT[0].enum === 'MILLI')
    eqs('numbers in every form', E.get(3).args[1], [1, -0.25, 3])
    ok('a typed value', E.get(4).args[1].type === 'LENGTH_MEASURE' && E.get(4).args[1].args[0] === 1e-7)
    ok('$ is null', E.get(4).args[2] === null)
    ok('escaped characters decoded', E.get(5).args[0] === 'été', JSON.stringify(E.get(5).args[0]))
    let threw = false
    try { E.get(9) } catch { threw = true }
    ok('a reference to nothing is said, not undefined', threw)
}
function eqs(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`) }

// THE FIXTURES: every face's surface as OpenCascade typed it, and every point it classified
for (const n of PARTS) {
    const ref = JSON.parse(readFileSync(fixture(`${n}.json`), 'utf8'))
    const r = readSTEP(readFileSync(fixture(`${n}.step`), 'utf8'))
    ok(`${n}: one solid, in mm, nothing to warn of`, r.solids.length === 1 && r.unitMM === 1 && !r.warnings.length, JSON.stringify(r.warnings))
    const kinds = {}
    for (const f of r.solids[0].faces) kinds[f.surface.type] = (kinds[f.surface.type] || 0) + 1
    eqs(`${n}: the faces OpenCascade reports, by surface`, Object.entries(kinds).sort(), Object.entries(ref.kinds).sort())
    const B = brep(r.solids[0])
    ok(`${n}: every sphere's and torus's side settled by a neighbour, none taken from the file alone`, !B.guessed.length, B.guessed.length)
    let bad = 0
    for (const [x, y, z, c] of ref.points) if ((B.inside([x, y, z]) ? 1 : 0) !== c) bad++
    ok(`${n}: inside() agrees with OpenCascade's classifier at all ${ref.points.length} points`, bad === 0, `${bad} disagree`)
    // the box: OpenCascade's own is loose by its tolerance; ours is the faces', inside it and not far from it
    ok(`${n}: the box inside OpenCascade's, and within 0.3 mm of it`, B.box.lo.every((l, k) => l >= ref.lo[k] - 1e-6 && l - ref.lo[k] < 0.3)
        && B.box.hi.every((h, k) => h <= ref.hi[k] + 1e-6 && ref.hi[k] - h < 0.3), JSON.stringify([B.box, ref.lo, ref.hi]))
}

/* THE BOSS'S INNER FILLET: the face whose loop runs against ISO 10303-42's rule (brep.js says how it was found). Read by
   the rule it would be the other three quarters of the tube; settled by its neighbour it is the quarter there is */
{
    const r = readSTEP(readFileSync(fixture('boss.step'), 'utf8'))
    const B = brep(r.solids[0])
    const inner = B.faces.find(f => f.surface.type === 'torus' && f.surface.R < 10)
    ok('the boss: its inner fillet is on the right of its loop although same_sense is false', inner && inner.uvLeft === 1 && !inner.sense)
    // a point in the corner the fillet fills: material, which only the quarter tube's reading gives
    ok('...and the corner it fills is inside the part', B.inside([6.2, 0, 3.2]))
}

// UNITS: the plate's own file with its unit changed -- the same numbers, in inches and in metres
{
    const text = readFileSync(fixture('plate.step'), 'utf8')
    const mm = readSTEP(text).solids[0]
    const unitLine = /#(\d+) = \( LENGTH_UNIT\(\) NAMED_UNIT\(\*\) SI_UNIT\(\.MILLI\.,\.METRE\.\) \);/.exec(text)
    ok('the plate names its unit as mm (the line changed below)', !!unitLine)
    const id = unitLine[1]
    const inch = text.replace(unitLine[0], `#${id} = ( CONVERSION_BASED_UNIT('INCH',#990001) LENGTH_UNIT() NAMED_UNIT(*) );\n` +
        `#990001 = LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),#990002);\n#990002 = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );`)
    const metre = text.replace(unitLine[0], `#${id} = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT($,.METRE.) );`)
    const size = s => { const B = brep(s); return B.box.hi.map((h, k) => h - B.box.lo[k]) }
    const a = size(mm), b = size(readSTEP(inch).solids[0]), c = size(readSTEP(metre).solids[0])
    ok('in inches: 25.4 times the size', b.every((v, k) => Math.abs(v - 25.4 * a[k]) < 1e-6), JSON.stringify([a, b]))
    ok('in metres: 1000 times', c.every((v, k) => Math.abs(v - 1000 * a[k]) < 1e-6), JSON.stringify([a, c]))
    ok('...and a hole\'s radius with it', readSTEP(inch).solids[0].faces.filter(f => f.surface.type === 'cylinder').every(f => Math.abs(f.surface.r - 2 * 25.4) < 1e-9))
    // a cone's semi-angle is in the file's angle unit: degrees in some files
    const boss = readFileSync(fixture('boss.step'), 'utf8')
    const rad = readSTEP(boss).solids[0].faces.find(f => f.surface.type === 'cone').surface.semi
    const angLine = /#(\d+) = \( NAMED_UNIT\(\*\) PLANE_ANGLE_UNIT\(\) SI_UNIT\(\$,\.RADIAN\.\) \);/.exec(boss)
    ok('the boss names its angle unit (the line changed below)', !!angLine)
    const deg = boss.replace(angLine[0], `#${angLine[1]} = ( CONVERSION_BASED_UNIT('DEGREE',#990003) NAMED_UNIT(*) PLANE_ANGLE_UNIT() );\n` +
        `#990003 = PLANE_ANGLE_MEASURE_WITH_UNIT(PLANE_ANGLE_MEASURE(0.0174532925199433),#990004);\n#990004 = ( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) );`)
        .replace(/(CONICAL_SURFACE\('[^']*',#\d+,[^,]+,)([^)]+)\)/, (_, a, x) => `${a}${(parseFloat(x) * 180 / Math.PI).toFixed(12)})`)
    const d = readSTEP(deg).solids[0].faces.find(f => f.surface.type === 'cone').surface.semi
    ok('a cone\'s semi-angle written in degrees reads as the same angle', Math.abs(d - rad) < 1e-9, `${d} ${rad}`)
}

// AN ASSEMBLY: two parts, each where the assembly puts it
{
    const ref = JSON.parse(readFileSync(fixture('assembly.json'), 'utf8'))
    const r = readSTEP(readFileSync(fixture('assembly.step'), 'utf8'))
    eqs('the assembly: two solids, named by their products', r.solids.map(s => s.name).sort(), ['holder', 'lens'])
    const Bs = r.solids.map(brep)
    let bad = 0
    for (const [x, y, z, c] of ref.points) if ((Bs.some(B => B.inside([x, y, z])) ? 1 : 0) !== c) bad++
    ok(`...each placed where OpenCascade has it: all ${ref.points.length} points agree`, bad === 0, `${bad} disagree`)
    const lens = r.solids.find(s => s.name === 'lens')
    const axis = lens.faces.find(f => f.surface.type === 'cylinder').surface.F.z
    ok('...the lens turned on its side (its axis along y)', Math.abs(Math.abs(axis[1]) - 1) < 1e-9, JSON.stringify(axis))
}

// WHAT IS NOT READ is said
{
    const surfaces = `ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#1 = SHELL_BASED_SURFACE_MODEL('',(#2));\n#2 = OPEN_SHELL('',());\nENDSEC;\n`
    let msg = ''
    try { readSTEP(surfaces) } catch (e) { msg = e.message }
    ok('a file of surfaces and no solid: refused, saying so', /surfaces, not solids/.test(msg), msg)
    try { readSTEP('solid x\nendsolid') } catch (e) { msg = e.message }
    ok('not a STEP file at all: said', /not a STEP file/.test(msg), msg)
    // a face on a B-spline is kept, and named for what it is
    const text = readFileSync(fixture('lens.step'), 'utf8').replace(/SPHERICAL_SURFACE\('',(#\d+),20\.\)/, "B_SPLINE_SURFACE_WITH_KNOTS('',1,1,((#3,#3),(#3,#3)),.UNSPECIFIED.,.F.,.F.,.F.,(2,2),(2,2),(0.,1.),(0.,1.),.UNSPECIFIED.)")
    const s = readSTEP(text).solids[0]
    const B = brep(s)
    ok('a B-spline face: kept as one, typed bspline', s.faces.some(f => f.surface.type === 'bspline') && B.unsupported.length === 1)
    try { B.inside([0, 0, 0]); msg = '' } catch (e) { msg = e.message }
    ok('...and inside() refuses rather than answer without it', /cannot evaluate/.test(msg), msg)
}

// the geometry the faces are read into: a point on each face is on its surface
for (const n of PARTS) {
    const B = brep(readSTEP(readFileSync(fixture(`${n}.step`), 'utf8')).solids[0])
    let worst = 0
    for (const f of B.faces) for (const L of f.loops) for (const p of L.points) worst = Math.max(worst, Math.abs(f.surface.g(p)))
    ok(`${n}: every edge's points on its faces' surfaces, to a micrometre`, worst < 1e-3, worst)
    void len; void sub
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
