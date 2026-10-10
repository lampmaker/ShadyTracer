//======================================================================================================================
// THE BUILDS BENCH (bench/builds.js). Run:
//   node bench/test/builds.test.mjs
//
// No GPU: which build is fastest is the user's card's to say. What is checked: each bench scene five ways in order --
// codegen, baked, baked with the step cache (filled once, own cell), as data, and that with the cache -- the Menger
// cubes without the cache rows; one camera, environment and box measurer a scene; each row compiled (its own kernels);
// the baked rows codegen's text with every value a constant but the culling boxes; the data rows data (with the grid and
// exact hits until 0.41.0); the step cache on in the cache rows alone, through the setting the runner builds the kernels
// from; the last row the first again.
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildsTest, SCENES, WAYS, NO_CACHE } from '../builds.js'
import { liveInBench } from '../bake.js'
import { BAKE_PREFIX } from '../../builder/bake.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const warn = console.warn; console.warn = () => { }
const load = async url => readFileSync(fileURLToPath(url), 'utf8')

const t = await buildsTest(load)
const C = t.cases
ok('a bench test of its own', t.id === 'builds' && t.kind === 'bench')
const expected = SCENES.reduce((n, [key]) => n + WAYS.filter(([, , w]) => !(w.stepCache && NO_CACHE[key])).length, 0)
ok('every scene five ways (the Menger cubes three), and the drift row', C.length === expected + 1 && Object.keys(NO_CACHE).length === 1, `${C.length} rows`)
let at = 0
for (const [key, label] of SCENES) {
    const ways = WAYS.filter(([, , w]) => !(w.stepCache && NO_CACHE[key]))
    const rows = C.slice(at, at + ways.length)
    at += ways.length
    ok(`${label}: its rows in order, each its label`, rows.every((r, i) => r.way === ways[i][0] && r.label === `${label}, ${ways[i][1]}`),
        rows.map(r => r.label).join(' | '))
    ok(`${label}: one camera, environment and box measurer; each compiled`, rows.every(r => r.camera === rows[0].camera && r.measureBoxes === rows[0].measureBoxes
        && JSON.stringify(r.environment) === JSON.stringify(rows[0].environment) && r.compile === true && r.sameTextAs === undefined))
    const by = w => rows.find(r => r.way === w)
    const code = by('codegen'), bk = by('baked'), dt = by('data')
    ok(`${label}: codegen is the page's (no data, not baked, every value a uniform)`, !code.scene.data && !code.scene.baked && !code.scene.wgsl.includes(BAKE_PREFIX))
    const kept = Object.keys(bk.scene.uniforms)
    ok(`${label}: baked -- codegen's document, every value a constant but the culling boxes`, bk.baked && bk.scene.baked && bk.scene.wgsl.includes(BAKE_PREFIX)
        && kept.every(liveInBench) && bk.scene.baked.names.length > 0
        // boxes kept exactly where codegen tests one (none on Surface materials since 0.34.0: no dear node, codegen.js)
        && (kept.length > 0) === /\bcullDist\(/.test(code.scene.wgsl), `${bk.scene.baked?.names.length} baked, ${kept.length} live`)
    ok(`${label}: as data`, dt.data && !!dt.scene.data && !/grid|exact/.test(dt.label))
    const cached = rows.filter(r => /cache/.test(r.way))
    ok(`${label}: the step cache on (filled once, own cell, 4 M cells) in the cache rows alone`, rows.every(r => r.set.stepCacheCells === 4
        && r.set.stepCache === (/cache/.test(r.way) ? 1 : 0) && r.set.stepCacheFill === 1)
        && cached.length === (NO_CACHE[key] ? 0 : 2) && cached.every(r => /filled once/.test(r.label)))
    if (cached.length) ok(`${label}: each cache row the scene of the row it adds the cache to, each its own object`,
        by('baked-cache').scene !== bk.scene && by('baked-cache').scene.wgsl === bk.scene.wgsl
        && by('data-cache').scene !== dt.scene && by('data-cache').scene.wgsl === dt.scene.wgsl)
}
const drift = C.at(-1)
ok('the last row is the first again, not compiled again', drift.scene === C[0].scene && drift.sameTextAs === 0 && !drift.compile && /drift/.test(drift.label))

console.warn = warn
console.log(`builds bench: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
