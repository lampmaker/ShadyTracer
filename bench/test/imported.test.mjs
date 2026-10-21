//======================================================================================================================
// Tests for the imported-parts bench (bench/imported.js, Tests > imported). Run: node bench/test/imported.test.mjs
//
// The timing exists only on a card, run by a person. What can be checked is that every row is what its label says: the
// frozen scene is the Imported parts example as it was made, row 2 changes the two rounded boxes and the lens into one
// shape each and nothing else, row 3 is the floor alone, the camera is the example's, and the one shape each stands
// for is the part it replaces (the same solid, at points through it).
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { importedTest, oneShapeEach, floorAlone, ONE_SHAPE } from '../imported.js'
import { BENCH, CAMERAS, BENCH_FILES, benchUrl } from '../index.js'
import * as Model from '../../builder/model.js'
import { convert } from '../../import/index.js'
import { shapeSDF } from '../../import/shapes.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }

const load = u => readFileSync(u, 'utf8')
const T = await importedTest(load)
const doc = Model.parse(load(benchUrl(BENCH_FILES.imported)))
const [base] = T.cases

ok('a bench-kind test at 1280 x 720, the benchmark\'s timing', T.kind === 'bench' && T.size === BENCH.size && T.timed === BENCH.timed && T.warmup === BENCH.warmup)
ok('five rows, labels unique', T.cases.length === 5 && new Set(T.cases.map(c => c.label)).size === 5)
ok('the frozen scene is the Imported parts example as it was made', doc.title === 'Imported parts' && doc.unit === 'mm'
    && JSON.stringify(doc.root) === JSON.stringify(Model.parse(readFileSync(new URL('../../scenes/imported-parts.json', import.meta.url), 'utf8')).root))
ok('every row the example\'s camera and environment, no setting changed', T.cases.every(c => c.camera === CAMERAS.imported && c.environment === base.environment && !Object.keys(c.set).length))
ok('row 1 baked and compiled; row 5 row 1 again', base.baked && base.compile && T.cases[4].scene === base.scene && T.cases[4].sameTextAs === 0)
ok('row 4 the editing build: codegen\'s text, not baked', !T.cases[3].baked && T.cases[3].scene.wgsl !== base.scene.wgsl)

// row 2: the three parts, one shape each, and nothing else changed
const one = oneShapeEach(doc)
const parts = d => d.root.children.filter(n => n.kind === 'group')
const count = n => n.kind === 'object' ? 1 : n.children.reduce((a, c) => a + count(c), 0)
ok('row 2: the same parts, in the same places', parts(one).map(g => g.label + JSON.stringify(g.transform)).join() === parts(doc).map(g => g.label + JSON.stringify(g.transform)).join())
ok('...the rounded boxes and the lens one shape each', parts(one).filter(g => ONE_SHAPE[g.label]).every(g => g.children.length === 1 && count(g) === 1)
    && parts(doc).filter(g => ONE_SHAPE[g.label]).every(g => count(g) > 1))
ok('...the others as imported', JSON.stringify(parts(one).filter(g => !ONE_SHAPE[g.label])) === JSON.stringify(parts(doc).filter(g => !ONE_SHAPE[g.label])))
ok('...and its own scene, compiled', T.cases[1].scene.wgsl !== base.scene.wgsl && T.cases[1].compile && Model.validate(one).length === 0)
const bare = floorAlone(doc)
ok('row 3: the floor alone', bare.root.children.length === 1 && bare.root.children[0].label === 'floor' && T.cases[2].compile)

/* THE ONE SHAPE IS THE PART: the preset's own distance (written here as sdf.js has it) against the imported shapes', at
   points through each -- the same side everywhere off the surface */
const boxRounded = (p, b, r) => { const q = p.map((x, k) => Math.abs(x) - (b[k] - r)); return Math.hypot(...q.map(x => Math.max(x, 0))) + Math.min(Math.max(...q), 0) - r }
const lens = (p, D, t, r1, r2) => {
    const face = (vz, R, s) => { const c = [0, 0, s * (vz - R)]; return Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - R }
    return Math.max(Math.hypot(p[0], p[1]) - D / 2, face(t / 2, r1, 1), face(t / 2, r2, -1))
}
for (const [file, f] of [['roundbox.step', p => boxRounded(p, [10, 7, 5], 2)], ['lens.step', p => lens(p, 12, 4, 20, 30)]]) {
    const r = convert(Model, file, readFileSync(new URL(`../../import/test/fixtures/${file}`, import.meta.url)))
    const ir = r.parts[0].ir, c = ir.box.lo.map((l, k) => 0.5 * (l + ir.box.hi[k]))
    let bad = 0, n = 0
    for (let i = 0; i < 4000; i++) {
        const p = ir.box.lo.map((l, k) => l - 1 + (ir.box.hi[k] - l + 2) * ((i * [0.618, 0.414, 0.732][k] * 7.31) % 1))
        const q = p.map((x, k) => x - c[k])
        const a = f(q), b = shapeSDF(ir.root, p)
        if (Math.abs(a) < 1e-6) continue
        n++
        if ((a < 0) !== (b < 0)) bad++
    }
    ok(`${file}: the preset row 2 puts in its place is the same solid (${n} points)`, bad === 0, `${bad} differ`)
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
