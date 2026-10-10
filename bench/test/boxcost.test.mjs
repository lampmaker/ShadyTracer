//======================================================================================================================
// THE BOX-TEST COST BENCH (bench/boxcost.js). Run:
//   node bench/test/boxcost.test.mjs
//
// No GPU: what the box tests cost is the user's card's to say. What is checked: each scene four ways in order -- boxes
// off, boxes that never cull, boxes measured, boxes on the dear nodes only; one camera and environment a scene; the
// first row a scene made without boxes (no box test in its text), the next two one scene object with every top-level
// node's box test, the third not compiled again; the fourth a box test for exactly the scene's dear nodes (counted by
// hand from the frozen scenes, 2026-10-07), every node it leaves untested one plain shape, its own text compiled -- or,
// with no dear node, the first row's scene again; the never-culling measurer writing, over a stand-in renderer, a
// known box holding everything for every box the scene declares and nothing else, without restarting the picture --
// and that box, through the WGSL cullDist written out in f32, never above the margin wherever a march could be; the
// step cache left off; the last row the first again. Since 0.34.0 the dear row is the text the builder makes (codegen's
// default), and the never-culling and measured rows the text with every box (cull 'all') it made until then.
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { boxCostTest, neverCulls, SCENES, WAYS, EVERYWHERE } from '../boxcost.js'
import { boxLoName, boxHiName } from '../../builder/codegen.js'
import { plainShapeOf } from '../../builder/plainshape.js'
import * as Model from '../../builder/model.js'
import { generate } from '../../builder/codegen.js'
import { benchUrl } from '../index.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const warn = console.warn; console.warn = () => { }
const load = async url => readFileSync(fileURLToPath(url), 'utf8')

const t = await boxCostTest(load)
const C = t.cases
ok('a bench test of its own', t.id === 'boxcost' && t.kind === 'bench')
ok('every scene four ways, and the drift row', C.length === SCENES.length * WAYS.length + 1 && WAYS.length === 4, `${C.length} rows`)
const boxNames = S => Object.keys(S.uniforms).filter(n => /^bx(lo|hi)_/.test(n))
const tested = S => [...S.wgsl.matchAll(/let bd_(\w+) = cullDist\(/g)].map(m => m[1]).sort()
/* THE DEAR NODES OF EACH SCENE, read off the frozen scenes by hand (2026-10-07): every top-level node that is not one plain
   shape -- the Noise library's six relief groups; none of Surface materials' fourteen; the demo's ground (a plane in code
   of its own), its slab (code that offsets its box), its three groups and its template box (sdBox, no answer along the
   ray); the showcase's carved box and sponge */
const DEAR = { noise: ['n18', 'n20', 'n22', 'n24', 'n26', 'n28'], surfaces: [], demo: ['carved', 'ground', 'n6', 'shapes', 'slab', 'twisted'],
               showcase: ['carved', 'sponge'] }
for (const [i, [key, label]] of SCENES.entries()) {
    const W = WAYS.length, rows = C.slice(i * W, i * W + W)
    ok(`${label}: its rows in order, each its label`, rows.every((r, j) => r.way === WAYS[j][0] && r.label === `${label}, ${WAYS[j][1]}`),
        rows.map(r => r.label).join(' | '))
    ok(`${label}: one camera and environment`, rows.every(r => r.camera === rows[0].camera && JSON.stringify(r.environment) === JSON.stringify(rows[0].environment)))
    const [off, never, measured, dear] = rows
    ok(`${label}: boxes off -- made without them, no box test in its text, compiled`, off.unculled && off.scene.unculled === true
        && !/cullDist\(/.test(off.scene.wgsl) && boxNames(off.scene).length === 0 && off.compile === true && off.sameTextAs === undefined)
    const n = (never.scene.wgsl.match(/cullDist\(/g) || []).length
    ok(`${label}: never cull and measured -- one scene object, a box test a top-level node, compiled once`, never.scene === measured.scene
        && !never.scene.unculled && n > 0 && boxNames(never.scene).length === 2 * n && never.compile === true && never.sameTextAs === undefined
        && measured.compile === false && measured.sameTextAs === i * W + 1, `${n} box tests`)
    ok(`${label}: boxes off and measured measure the boxes; never cull writes its own`, off.measureBoxes === measured.measureBoxes
        && typeof never.measureBoxes === 'function' && never.measureBoxes !== off.measureBoxes)
    /* THE DEAR NODES ONLY: a box test for exactly those, each declared; every node the measured row tests and this one
       does not, one plain shape (one call of a shape with an answer along the ray, its material without a relief) */
    ok(`${label}: dear only -- a box test for exactly the dear nodes, each box declared`,
        JSON.stringify(tested(dear.scene)) === JSON.stringify(DEAR[key]) && boxNames(dear.scene).length === 2 * DEAR[key].length,
        `${tested(dear.scene).join(',')} against ${DEAR[key].join(',')}`)
    const doc = Model.parse(readFileSync(fileURLToPath(benchUrl(SCENES[i][2])), 'utf8')), tree = Model.toTree(doc)
    const relief = new Set((tree.materials || []).filter(m => m.relief).map(m => m.id))
    const left = tested(never.scene).filter(id => !DEAR[key].includes(id))
    ok(`${label}: dear only -- every node left untested one plain shape`, left.every(id => {
        const nd = tree.children.find(c => c.id === id)
        return nd?.kind === 'object' && (nd.type === 'light' || (!relief.has(nd.material) && !!plainShapeOf(nd.code)))
    }) && left.length + DEAR[key].length === n, left.join(','))
    const made = o => generate(...Model.generateArgs(doc, { id: `check-${key}`, title: 'check', ...o })).wgsl
    ok(`${label}: dear only -- the text the builder makes; never cull and measured, every box's (cull 'all')`,
        dear.scene.wgsl === made({}) && never.scene.wgsl === made({ cull: 'all' }) && made({}) !== made({ cull: 'all' }))
    ok(`${label}: dear only -- the boxes measured as the others', the pick copy as theirs`, dear.measureBoxes === off.measureBoxes
        && dear.scene.pickWgsl === measured.scene.pickWgsl)
    if (DEAR[key].length) ok(`${label}: dear only -- its own text, compiled`, dear.scene !== off.scene && dear.scene !== measured.scene
        && !dear.scene.unculled && dear.compile === true && dear.sameTextAs === undefined && /CULL < abs\(C\.s\.w\)/.test(dear.scene.wgsl))
    else ok(`${label}: dear only, no dear node -- the scene without its boxes again, its text the first row's, not compiled again`,
        dear.scene === off.scene && dear.compile === false && dear.sameTextAs === i * W)
    ok(`${label}: the step cache left off (no row sets it, nor its environment)`, rows.every(r => !r.set && !('stepCache' in r.environment)))

    /* THE NEVER-CULLING MEASURER over a stand-in renderer: the scene's uniforms, and what RT.set is handed */
    const writes = []
    const RT = { scene: never.scene, set: (vals, reset) => writes.push({ vals, reset }) }
    const r = await never.measureBoxes(RT)
    const names = boxNames(never.scene)
    const w = writes[0]?.vals ?? {}
    ok(`${label}: never cull -- one write, the picture not restarted`, writes.length === 1 && writes[0].reset === false)
    ok(`${label}: never cull -- every box the scene declares written, and nothing else`, names.length === Object.keys(w).length && names.every(m => m in w),
        `${Object.keys(w).length} written of ${names.length}`)
    const ids = names.filter(m => m.startsWith('bxlo_')).map(m => m.slice(5))
    ok(`${label}: never cull -- each known (lo.w 1) and holding everything`, ids.length === n && ids.every(id => {
        const lo = w[boxLoName(id)], hi = w[boxHiName(id)]
        return lo.length === 4 && hi.length === 4 && lo[3] === 1 && hi[3] === 0 && [0, 1, 2].every(k => lo[k] === -EVERYWHERE && hi[k] === EVERYWHERE)
    }))
    ok(`${label}: never cull -- every node counted as having a box, none unknown`, r.known === n && r.total === n && r.unknown.length === 0)
}

/* THE BOX THROUGH cullDist AS THE KERNEL HAS IT (scene_api.js), every step in f32: negative wherever a march could be
   -- the origin, a point a kilometre and a light year (in mm) out -- and at any scale, so never above the margin */
const f = Math.fround
const cullDist = (q, lo, hi) => {
    if (lo[3] === 0) return -1
    const c = [0, 1, 2].map(k => f(f(0.5) * f(f(lo[k]) + f(hi[k])))), h = [0, 1, 2].map(k => f(f(0.5) * f(f(hi[k]) - f(lo[k]))))
    const d = [0, 1, 2].map(k => f(f(Math.abs(f(f(q[k]) - c[k]))) - h[k]))
    const out = f(Math.hypot(...d.map(x => Math.max(x, 0))))
    return f(out + Math.min(Math.max(...d), 0))
}
const lo = [-EVERYWHERE, -EVERYWHERE, -EVERYWHERE, 1], hi = [EVERYWHERE, EVERYWHERE, EVERYWHERE, 0]
const points = [[0, 0, 0], [1e6, -1e6, 3e5], [9.46e18, 0, -9.46e18], [-3.4e20, 2e20, 1e20]]
const ds = points.flatMap(q => [1e-6, 1, 1e6].map(s => f(cullDist(q, lo, hi) * s)))
ok('the box holding everything is never culled: its distance negative everywhere, at any scale', ds.every(d => Number.isFinite(d) || d === -Infinity) && ds.every(d => d < 0),
    ds.join(', '))
ok('...and its width a finite f32', Number.isFinite(f(hi[0] - lo[0])))

const drift = C.at(-1)
ok('the last row is the first again, not compiled again', drift.scene === C[0].scene && drift.sameTextAs === 0 && !drift.compile && /drift/.test(drift.label))

console.warn = warn
console.log(`boxcost bench: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
