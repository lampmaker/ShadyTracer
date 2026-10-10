//======================================================================================================================
// The scene-as-data bench (bench/scenedata.js): every row what its label says. Run:
//   node bench/test/scenedata.test.mjs
//
// No GPU: what the rows time is the user's machine's to say. What is checked is that each scene's rows are the same
// document both ways and nothing else -- the camera, the settings, the environment, one box measurer between them --
// that the data row is data (its records, its buffer resource) and the codegen row is not, that the lens row is the
// scaling rows' (their tolerance, their copies), and that the last row is the first again. (The ray's-list rows of 0.21.6
// went in 0.22.5, with the option; the grid and exact-hits rows in 0.41.0, with theirs.)
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sceneDataTest, SCENES } from '../scenedata.js'
import { HEADER } from '../../builder/scenedata.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }

const warn = console.warn; console.warn = () => { }
const t = await sceneDataTest(async url => readFileSync(fileURLToPath(url), 'utf8'))
console.warn = warn
const C = t.cases
ok('a bench test of its own', t.id === 'scenedata' && t.kind === 'bench')
ok('every scene twice, the lens assembly once (no codegen row), and the drift row',
    C.length === 2 * SCENES.length + 1 + 1, `${C.length} rows`)
ok('...and no ray\'s-list, grid or exact-hits row (gone in 0.22.5 and 0.41.0)', !C.some(c => /ray's list|grid|exact/.test(c.label)))
const sameRow = (name, a, b) => {
    ok(`${name}: the same camera, environment, settings and box measurer -- the representation the one change`,
        JSON.stringify(a.camera) === JSON.stringify(b.camera) && JSON.stringify(a.environment) === JSON.stringify(b.environment)
        && JSON.stringify(a.set ?? null) === JSON.stringify(b.set ?? null) && a.measureBoxes === b.measureBoxes && !!a.measureBoxes)
    ok(`${name}: the same nodes, numbered for each (the tags name the same ids)`, [...a.scene.tags].sort().join() === [...b.scene.tags].sort().join())
    ok(`${name}: each text compiled once, uncached`, a.compile === true && b.compile === true && a.scene.wgsl !== b.scene.wgsl)
}
const isData = c => c.scene.data instanceof Float32Array && c.scene.resources?.sceneData === 'read array<vec4<f32>>'
    && new Uint32Array(c.scene.data.buffer, 0, 1)[0] > HEADER && c.data === true
let i = 0
for (const [key] of SCENES) {
    const [a, b] = C.slice(i, i + 2)
    i += 2
    const what = a.label.replace(/, codegen$/, '')
    ok(`${what}: codegen, then as data`, /, codegen$/.test(a.label) && b.label === `${what}, as data`, `${a.label} | ${b.label}`)
    ok(`${what}: the codegen row is codegen`, !a.scene.data && !a.scene.resources?.sceneData && a.data === false)
    ok(`${what}: the data row is data, records and all`, isData(b))
    sameRow(`${what} codegen / data`, a, b)
}
const lensData = C.at(-2)
ok('the lens row: as data alone; no codegen (it never finished compiling)', /lens assembly x 32, as data$/.test(lensData.label)
    && isData(lensData) && !C.some(c => /lens.*codegen/.test(c.label)))
/* the same map as the scaling rows': every node of the 31 copies, not the copies alone (0.22.9; scaling.test.mjs says why) */
ok('the lens row: 32 copies, the scaling rows\' tolerance, their boxes (the stage measured, copy 1\'s for every copy and each of its parts)',
    lensData.copies === 32 && lensData.set?.eps > 0 && lensData.measureBoxes.only?.length > 0
    && [...lensData.measureBoxes.same.values()].filter(v => v === 'n42').length === 31
    && lensData.measureBoxes.same.size > 31 && lensData.measureBoxes.same.size % 31 === 0)
const drift = C.at(-1)
ok('the last row is the first again, not compiled again', drift.scene === C[0].scene && drift.sameTextAs === 0 && !drift.compile && /drift/.test(drift.label))
ok('scene ids differ by text: a data scene is never taken for its codegen twin', new Set(C.slice(0, -1).map(c => c.scene.id)).size === C.length - 1)

console.log(`scenedata bench: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
