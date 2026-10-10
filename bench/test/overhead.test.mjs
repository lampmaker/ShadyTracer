//======================================================================================================================
// Tests for the data walk's own-cost bench (bench/overhead.js). Run:
//   node bench/test/overhead.test.mjs
//
// The timing exists only on a real GPU. What is checked here is that each row is what its label says:
//   - every scene a pair, codegen then as data, with one document, camera, environment and box measurer;
//   - the Menger cubes without their warps: the same nodes and transforms, no group with code, the warp code gone from
//     both shaders, and from the data shader the frames it kept for them (`astack`); the subtraction still there;
//   - one Menger cube: the depth-4 cube alone at the top level, its own transform, and no array in the data shader;
//   - the reference rows: the warps' and the subtraction's frames both in the data shader;
//   - the last row the first again, not compiled.
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { overheadTest, withoutGroupCode, alone, MENGER_ID, ONE_CUBE_CAMERA } from '../overhead.js'
import { BENCH, CAMERAS } from '../index.js'
import { UniformSpec } from '../../lib/pathtracer/core/uniforms.schema.js'
import * as Model from '../../builder/model.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }

const warn = console.warn
console.warn = () => { }
const load = u => readFileSync(u, 'utf8')
const T = await overheadTest(load)
const menger = Model.parse(load(new URL('../scenes/Menger_cubes.json', import.meta.url)))
console.warn = warn

// ---- the test as a whole
ok('a bench-kind test of its own, at the benchmark\'s size and sample rule', T.kind === 'bench' && T.id === 'overhead'
    && T.size === BENCH.size && T.timed === BENCH.timed && T.warmup === BENCH.warmup && T.kernels === BENCH.kernels)
ok('nine rows', T.cases.length === 9, `${T.cases.length}`)
ok('labels are unique', new Set(T.cases.map(c => c.label)).size === T.cases.length)
for (const c of T.cases) {
    const unknown = Object.keys(c.set || {}).filter(k => !(k in UniformSpec))
    ok(`${c.label}: its settings are renderer settings`, unknown.length === 0, unknown.join(', '))
    ok(`${c.label}: a scene, a camera, a box measurer`, !!c.scene?.wgsl && !!c.camera && typeof c.measureBoxes === 'function')
}

// ---- the pairs: codegen then as data, the representation the one change
const pairs = [0, 2, 4, 6].map(i => [T.cases[i], T.cases[i + 1]])
for (const [g, d] of pairs) {
    ok(`${g.label}: codegen, then ${d.label}: as data`, /, codegen$/.test(g.label) && /, as data$/.test(d.label) && !g.scene.data && !!d.scene.data && !g.data && d.data)
    ok(`${d.label}: the same camera, environment and box measurer as its codegen row`, g.camera === d.camera && g.measureBoxes === d.measureBoxes
        && JSON.stringify(g.environment) === JSON.stringify(d.environment) && JSON.stringify(g.set ?? null) === JSON.stringify(d.set ?? null))
    ok(`${g.label} and ${d.label}: each compiled uncached`, g.compile && d.compile && g.sameTextAs === undefined && d.sameTextAs === undefined)
}
{
    const again = T.cases[8]
    ok('row 9: row 1 again, the same scene object, not compiled, reported as row 1\'s text', again.scene === T.cases[0].scene && again.sameTextAs === 0 && !again.compile)
    ok('the Menger rows on the scene\'s camera, the cube alone on its own nearer one, the material test on its own',
        T.cases[0].camera === CAMERAS.Menger_cubes && T.cases[2].camera === CAMERAS.Menger_cubes && T.cases[4].camera === ONE_CUBE_CAMERA
        && T.cases[6].camera === CAMERAS.materials && ONE_CUBE_CAMERA.distance < CAMERAS.Menger_cubes.distance)
}

// ---- what each data shader keeps: the warps' frames (astack), the subtraction's (stack), the warp code
const has = (w, what) => ({ astack: /var astack/.test(w), stack: /var stack/.test(w), warp: /warp\(/.test(w), twist: /rate \* p\.z/.test(w), bend: /amount \* p\.x/.test(w) })[what]
{
    const [g0, d0] = pairs[0], [g1, d1] = pairs[1], [, d2] = pairs[2]
    ok('the Menger cubes as data keep the warps\' frames and the subtraction\'s', has(d0.scene.wgsl, 'astack') && has(d0.scene.wgsl, 'stack'))
    ok('...and both ways run the bend and the twist', ['twist', 'bend'].every(k => has(g0.scene.wgsl, k) && has(d0.scene.wgsl, k)))
    ok('without their warps: no warp code either way', ['twist', 'bend', 'warp'].every(k => !has(g1.scene.wgsl, k) && !has(d1.scene.wgsl, k)))
    ok('...as data, no warp frames, the subtraction\'s still', !has(d1.scene.wgsl, 'astack') && has(d1.scene.wgsl, 'stack'))
    ok('one cube as data: no array at all', !has(d2.scene.wgsl, 'astack') && !has(d2.scene.wgsl, 'stack'))
}

// ---- the documents
{
    const ids = d => { const out = []; Model.walk(d, n => out.push(n.id)); return out }
    const plain = withoutGroupCode(menger)
    let coded = 0
    Model.walk(plain, n => { if (n !== plain.root && n.kind === 'group' && Model.groupHasCode(plain, n)) coded++ })
    ok('without their warps: no group has code', coded === 0)
    ok('...the same nodes', JSON.stringify(ids(plain)) === JSON.stringify(ids(menger)))
    const same = id => JSON.stringify(Model.find(plain, id).node.transform) === JSON.stringify(Model.find(menger, id).node.transform)
    ok('...each where it was', ids(menger).filter(id => id !== menger.root.id).every(same))
    let before = 0
    Model.walk(menger, n => { if (n !== menger.root && n.kind === 'group' && Model.groupHasCode(menger, n)) before++ })
    ok('...and the original had two (the bend and the twist), untouched', before === 2)

    const one = alone(menger, MENGER_ID)
    const node = Model.find(one, MENGER_ID).node
    ok('one cube: the depth-4 menger, alone at the top level', one.root.children.length === 1 && one.root.children[0] === node
        && node.label === 'menger' && node.params?.depth === 4, JSON.stringify(one.root.children.map(c => c.label)))
    ok('...with its own transform', JSON.stringify(node.transform) === JSON.stringify(Model.find(menger, MENGER_ID).node.transform))
}

console.log(`overhead bench: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
