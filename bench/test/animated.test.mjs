//======================================================================================================================
// THE ANIMATED-VALUES BENCH (bench/animated.js). Run: node bench/test/animated.test.mjs
//
// No GPU: what the rows cost is the user's card's to say. What is checked: each bench scene three ways -- as data, baked,
// baked with four positions animated -- one camera, environment and box measurer, each
// compiled; the second baked row the first with exactly the four objects' matrices kept uniforms (read as UB.xf_<id>,
// declared, no constant of them) and nothing else changed; the four named in its label, read by the scene's text.
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { animatedTest, SCENES, ANIMATED } from '../animated.js'
import { BAKE_PREFIX, BAKED_TEXTS } from '../../builder/bake.js'
import { xfName } from '../../builder/codegen.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const warn = console.warn; console.warn = () => { }
const load = async url => readFileSync(fileURLToPath(url), 'utf8')

const t = await animatedTest(load)
const C = t.cases
ok('a bench test of its own', t.id === 'animated' && t.kind === 'bench')
ok('every scene three times, and the drift row', C.length === 3 * SCENES.length + 1, `${C.length} rows`)
SCENES.forEach(([, label], s) => {
    const [d, b, a] = [C[3 * s], C[3 * s + 1], C[3 * s + 2]]
    ok(`${label}: as data, baked, baked with positions animated`, d.way === 'data' && !!d.scene.writeData && /, as data$/.test(d.label) && !d.scene.baked
        && b.way === 'baked' && !!b.scene.baked && a.way === 'baked-animated' && !!a.scene.baked, [d.label, b.label, a.label].join(' | '))
    ok(`${label}: one camera, environment and box measurer; each compiled, its own text`, d.camera === b.camera && b.camera === a.camera
        && d.measureBoxes === b.measureBoxes && b.measureBoxes === a.measureBoxes
        && JSON.stringify(d.environment) === JSON.stringify(a.environment) && [d, b, a].every(c => c.compile === true)
        && new Set([d.scene.wgsl, b.scene.wgsl, a.scene.wgsl]).size === 3)
    const ids = a.animated, xfs = ids.map(xfName)
    ok(`${label}: ${ANIMATED} objects animated (or as many as it has), named in the label`, ids.length === ANIMATED || ids.length > 0
        && ids.length < ANIMATED, String(ids.length))
    ok(`${label}: their matrices kept uniforms -- declared, read as UB, never a constant`, xfs.every(n => n in a.scene.uniforms && a.scene.baked.kept.includes(n)
        && a.scene.wgsl.includes(`UB.${n}`) && !(BAKE_PREFIX + n in a.scene.constants)) && xfs.every(n => !(n in b.scene.uniforms)), xfs.join())
    const extra = a.scene.baked.kept.filter(n => !b.scene.baked.kept.includes(n)).sort()
    ok(`${label}: and nothing else kept besides`, JSON.stringify(extra) === JSON.stringify([...xfs].sort()), JSON.stringify(extra))
    // the baked-with-animated text is the baked one with exactly those reads renamed back
    const back = txt => txt.replace(new RegExp(`\\b${BAKE_PREFIX}(${xfs.join('|')})\\b`, 'g'), 'UB.$1')
    ok(`${label}: the texts the baked row's with those reads put back as uniforms, nothing else`,
        BAKED_TEXTS.every(k => (b.scene[k] == null && a.scene[k] == null) || back(b.scene[k]) === a.scene[k]))
})
const drift = C.at(-1)
ok('the last row is the first again, not compiled again', drift.scene === C[0].scene && drift.sameTextAs === 0 && !drift.compile && /drift/.test(drift.label))

console.warn = warn
console.log(`animated bench: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
