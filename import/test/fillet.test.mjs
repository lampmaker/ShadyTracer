//======================================================================================================================
// Tests for the fillets found among a part's faces (import/fillet.js, 0.83.0) and what the conversion makes of them:
// each a round join of the two faces it rounds. Run: node import/test/fillet.test.mjs
//
// What is held, no GPU, on OpenCascade's parts (fixtures/make.py):
//   - FOUND: the bracket's two (a concave 3 mm in its bend, a convex 2 mm outside it), the boss's two tori, the
//     holder's 40 (made like the user's Onshape part of 2026-11-04: its rim, its pocket's floor, its U's edges); none
//     on the plate, the lens, the rounded box (its edges rounded rectangles, its corners spheres) or the cup;
//   - EACH CHECKED: its compound zero on its own face, its supports the two faces either side, convex 'and' and concave
//     'or' as the solid is inside or outside its tube;
//   - NOT ONE: the U's bottom (a half cylinder between two parallel walls) kept, with why; a rail an edge along the
//     tube, an end not; a rim cylinder a chain's piece (chained) and a tray's corner not;
//   - ONE HALF-SPACE: the holder's rim around its rounded tray -- four cylinders and four tori -- one compound (its top
//     face and the tray's rounded rectangle), so the formula has far fewer literals and separators than without;
//   - IN THE DOCUMENT: a fillet a group of its two supports, the second joined by a round join of the fillet's radius
//     (model version 28), in the scene's unit.
// That the formula, the shapes and the document hold to OpenCascade's points is csg.test's (the holder is among its
// parts); that the renderer marches them is import.gpu.mjs's.
//======================================================================================================================
import { readFileSync } from 'node:fs'
import * as M from '../../builder/model.js'
import { readSTEP } from '../step.js'
import { brep, mulberry } from '../brep.js'
import { toCSG, roundedRects } from '../csg.js'
import { fillets, isRail, chained, edgeOwners, CHECK } from '../fillet.js'
import { sameSurface, frame, cylinder, torus } from '../geom.js'
import { convert } from '../index.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const fixture = n => new URL(`./fixtures/${n}`, import.meta.url)
const solid = n => brep(readSTEP(readFileSync(fixture(`${n}.step`), 'utf8')).solids[0])
/* the rounded rectangles' claims, as csg.js makes them (without the fillet chains' own) */
const claims = B => {
    const owners = edgeOwners(B), claimed = new Map()
    for (const R of roundedRects(B, 1e-6 * B.scale).filter(R => !R.faces.some(i => chained(B, i, owners)))) for (const i of R.faces) claimed.set(i, { S: R.surface, s: 1 })
    return claimed
}

// FOUND, part by part
const WANT = { plate: 0, lens: 0, roundbox: 0, cup: 0, onshape: 0, bracket: 2, boss: 2, holder: 40 }
const F = {}
for (const [n, want] of Object.entries(WANT)) {
    const B = solid(n)
    F[n] = { B, ...fillets(B, claims(B), { tol: 1e-6 * B.scale, scale: B.scale }) }
    ok(`${n}: ${want} fillet${want === 1 ? '' : 's'} found`, F[n].found.length === want, `${F[n].found.length}: ${F[n].found.map(x => `${x.face} ${x.op} r${x.r}`).join(', ')}`)
}
{
    const { B, found } = F.bracket
    const by = found.map(x => `${x.op} ${x.r}`).sort().join(', ')
    ok('the bracket: a convex 2 mm (and) and a concave 3 mm (or)', by === 'and 2, or 3', by)
    ok('...each between two planes', found.every(x => x.S.A.type === 'plane' && x.S.B.type === 'plane'))
    const rnd = mulberry(3)
    ok(`...each zero on its own face (to ${CHECK} of the part)`, found.every(x => B.faces[x.face].sample(32, rnd).every(p => Math.abs(x.S.g(p)) < CHECK * B.scale)))
}
{
    const { B, found } = F.boss
    ok('the boss: its two tori, each between a plane and a cylinder', found.every(x => B.faces[x.face].surface.type === 'torus'
        && [x.S.A.type, x.S.B.type].sort().join() === 'cylinder,plane'), found.map(x => `${x.S.A.type}/${x.S.B.type}`).join(' '))
}
{
    const { B, found, kept } = F.holder
    const ops = { and: found.filter(x => x.op === 'and').length, or: found.filter(x => x.op === 'or').length }
    ok('the holder: its pocket\'s floor concave (or: four along its sides, four round its corners), the rest convex (and)', ops.or === 8 && ops.and === 32, JSON.stringify(ops))
    // ONE COMPOUND for the rim around the rounded tray: the top face and the tray's prism, cylinders and tori alike
    const distinct = []
    for (const x of found) if (!distinct.some(S => sameSurface(S, x.S, 1e-6 * B.scale))) distinct.push(x.S)
    ok('...its 40 fillet faces fewer half-spaces, a chain round a corner one', distinct.length < 25, distinct.length)
    const rim = found.filter(x => [x.S.A.type, x.S.B.type].includes('rrect'))
    ok('...its rim\'s pieces, cylinders and tori, on the tray\'s rounded rectangle', rim.some(x => B.faces[x.face].surface.type === 'torus') && rim.some(x => B.faces[x.face].surface.type === 'cylinder'))
    const U = B.faces.findIndex(f => f.surface.type === 'cylinder' && Math.abs(f.surface.r - 7.5) < 1e-6)
    ok('...the U\'s bottom, between two parallel walls, no fillet', U >= 0 && !found.some(x => x.face === U))
    ok('...and every face kept said with why', kept.every(k => typeof k.why === 'string' && k.why.length > 10))
    // a fillet on a fillet: the U's mouth rounded 3 mm, its edges 1 mm along it
    ok('...a 1 mm fillet along the 3 mm one, its support that fillet\'s compound', found.some(x => x.r === 1 && [x.S.A.type, x.S.B.type].includes('rounded')))
    // a rim cylinder is a chain's piece, the tray's corner is not
    const owners = edgeOwners(B)
    const rimCyl = B.faces.findIndex((f, i) => f.surface.type === 'cylinder' && Math.abs(f.surface.r - 1) < 1e-6 && chained(B, i, owners))
    const corner = B.faces.findIndex(f => f.surface.type === 'cylinder' && Math.abs(f.surface.r - 5) < 1e-6)
    ok('chained: a 1 mm rim cylinder meeting a torus of its tube yes, the tray\'s 5 mm corner no', rimCyl >= 0 && corner >= 0 && !chained(B, corner, owners))
}
// RAILS AND ENDS
{
    const C = cylinder(frame([0, 0, 0], [0, 0, 1], [1, 0, 0]), 2)
    ok('isRail: a cylinder\'s edge along its axis', isRail(C, [[2, 0, -1], [2, 0, 0], [2, 0, 3]]))
    ok('...not a circle round it', !isRail(C, [[2, 0, 1], [0, 2, 1], [-2, 0, 1]]))
    const T = torus(frame([0, 0, 0], [0, 0, 1], [1, 0, 0]), 5, 1)
    ok('...a torus\'s circle at one tube angle', isRail(T, [[6, 0, 0], [0, 6, 0], [-6, 0, 0]]))
    ok('...not its circle across the tube', !isRail(T, [[6, 0, 0], [5, 0, 1], [4, 0, 0]]))
}
// THE FORMULA: fewer literals and separators with them than without
{
    const B = F.holder.B
    const a = toCSG(B), b = toCSG(B, { fillets: false })
    ok('the holder\'s formula: the fillets round joins, a quarter of the literals and fewer separators', a.report.fillets === 40
        && a.report.literals * 4 <= b.report.literals && a.report.separators < b.report.separators,
        JSON.stringify([a.report.literals, b.report.literals, a.report.separators, b.report.separators]))
}
// IN THE DOCUMENT
{
    const r = convert(M, 'holder.step', readFileSync(fixture('holder.step')))
    const groups = []
    const walk = n => { if (n.kind === 'group' && /^fillet R/.test(n.label)) groups.push(n); (n.children || []).forEach(walk) }
    walk(r.asset.node)
    ok('the document: each fillet a group of its two supports', groups.length > 0 && groups.every(g => g.children.length === 2))
    ok('...the second joined by a round join of the fillet\'s radius, in mm', groups.every(g => g.children[1].joinShape === 'round' && g.children[1].joinBlend > 0)
        && groups.some(g => g.label === 'fillet R1' && g.children[1].joinBlend === 1))
    const doc = M.ensureMaterial(M.createDoc()); doc.unit = 'm'
    const g = M.insertAsset(doc, r.asset, 'root')
    let r1 = null
    const find = n => { if (!r1 && n.kind === 'group' && n.label === 'fillet R1') r1 = n; (n.children || []).forEach(find) }
    find(g)
    ok('...pasted into a metre scene, its radius a world length, converted', r1 && Math.abs(r1.children[1].joinBlend - 0.001) < 1e-12, r1?.children[1].joinBlend)
    ok('...and the document sound', !M.validate(doc).length, M.validate(doc).join('; '))
    ok('the report: the fillets found and kept', r.parts[0].report.fillets === 40 && r.parts[0].report.filletsKept >= 0)
}

console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
