//======================================================================================================================
// The step cache's bench (bench/stepcache.js): every row what its label says. Run:
//   node bench/test/stepcache.test.mjs
//
// No GPU: what the rows time is the user's card's to say (and whether the cache is sound there, the GPU test's:
// builder/test/stepcache.gpu.mjs). What is checked: each scene's six rows are one scene, text, camera,
// environment and box measurer, the settings the one difference (0, 1, 2; the cells 1, 4, 16 million; filled once, every
// frame), each kind of kernels compiled once (off, 1, 2); the scenes are codegen's, but the last, the optics bench as
// data; the step cache's box for each, made from boxes as the bench makes it, covers the scene; the last row is the
// first again. (The lazy fill's rows, and the last scene's grid and exact hits, went in 0.41.0.)
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { stepCacheTest, SCENES, MODES, kernelsOf } from '../stepcache.js'
import { UniformSpec } from '../../lib/pathtracer/core/uniforms.schema.js'
import { stepCacheBox, unionBox } from '../../builder/stepbox.js'
import * as Model from '../../builder/model.js'
import { benchUrl } from '../index.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }

const warn = console.warn; console.warn = () => { }
const load = async url => readFileSync(fileURLToPath(url), 'utf8')
const t = await stepCacheTest(load)
console.warn = warn
const C = t.cases
ok('a bench test of its own', t.id === 'stepcache' && t.kind === 'bench')
ok('every scene six times, and the drift row', C.length === SCENES.length * MODES.length + 1 && MODES.length === 6, `${C.length} rows`)
ok('the setting exists, a developer\'s, 0 by default, up to 2', UniformSpec.stepCache?.def === 0 && UniformSpec.stepCache.gui?.dev === true
    && UniformSpec.stepCache.gui.max === 2)
ok('...and its cells, a developer\'s, 4 million by default, a quarter to 16 million', UniformSpec.stepCacheCells?.def === 4
    && UniformSpec.stepCacheCells.gui?.dev === true && UniformSpec.stepCacheCells.gui.min === 0.25 && UniformSpec.stepCacheCells.gui.max === 16)
ok('...and how often its cells are filled, a developer\'s, 1 (when the scene changes) by default, 2 every frame, no 0 (the lazy fill, gone), only with the cache',
    UniformSpec.stepCacheFill?.def === 1 && UniformSpec.stepCacheFill.gui?.dev === true && UniformSpec.stepCacheFill.gui.min === 1
    && UniformSpec.stepCacheFill.gui.max === 2 && JSON.stringify(UniformSpec.stepCacheFill.gui.requires) === '["stepCache"]')
ok('the rows: off, own cell, then cells ahead at 1, 4 and 16 million cells, all filled once; then cells ahead filled every frame, at 4 million',
    JSON.stringify(MODES.map(m => [m[0], m[1], m[3]])) === '[[0,4,1],[1,4,1],[2,1,1],[2,4,1],[2,16,1],[2,4,2]]')
SCENES.forEach(([key, label, , , way], s) => {
    const rows = C.slice(MODES.length * s, MODES.length * (s + 1))
    ok(`${label}: off, own cell, cells ahead at three counts, every frame, in that order`, rows.every((r, k) => r.set?.stepCache === MODES[k][0]
        && r.set.stepCacheCells === MODES[k][1] && r.set.stepCacheFill === MODES[k][3] && r.label === `${label}, ${MODES[k][2]}`), rows.map(r => r.label).join(' | '))
    ok(`${label}: one scene, camera, environment and box measurer -- the setting the one difference`,
        rows.every(r => r.scene === rows[0].scene && r.camera === rows[0].camera && JSON.stringify(r.environment) === JSON.stringify(rows[0].environment)
            && r.measureBoxes === rows[0].measureBoxes && Object.keys(r.set).join() === 'stepCache,stepCacheCells,stepCacheFill'))
    /* 0.29.0: each mode its own kernels (the cache compiled in only when on) -- off, 1 and the first 2 compile, the other
       cell counts and every frame are that 2's text (the fill's frequency is the host's) */
    const firstOf = m => MODES.findIndex(x => kernelsOf(x) === kernelsOf(m)) + MODES.length * s
    ok(`${label}: each kind of kernels compiled once (off, 1, 2), the other rows its text`, rows.every((r, i) => {
        const at = MODES.length * s + i, f = firstOf(MODES[i])
        return at === f ? r.compile === true && r.sameTextAs === undefined : !r.compile && r.sameTextAs === f
    }) && rows.filter(r => r.compile).length === 3 && kernelsOf(MODES[5]) === kernelsOf(MODES[3]), JSON.stringify(rows.map(r => [r.compile, r.sameTextAs])))
    if (!way) ok(`${label}: codegen's scene, not data's`, !rows[0].scene.data && !rows[0].scene.resources?.sceneData)
    else ok(`${label}: as data, and the row says so`, !!rows[0].scene.resources?.sceneData && rows.every(r => r.data === true))
})
ok('the codegen scenes, then the optics bench as data', SCENES.filter(s => s[4]).length === 1
    && JSON.stringify(SCENES.at(-1)[4]) === JSON.stringify({ data: true }) && SCENES.at(-1)[2] === SCENES[0][2])
const drift = C.at(-1)
ok('the last row is the first again, not compiled again', drift.scene === C[0].scene && drift.sameTextAs === 0 && !drift.compile && /drift/.test(drift.label))
ok('no Menger cubes (their marble\'s box would spread the cells over half a kilometre)', !C.some(c => /Menger/.test(c.label)))

/* THE BOX (builder/stepbox.js) from boxes as a measurer gives them: a stand-in that knows every node's box as a unit cube
   round its own origin -- the solids' world boxes joined, padded a tenth of the largest side */
{
    const unit = { fresh: () => true, get: () => ({ lo: [-1, -1, -1], hi: [1, 1, 1], cell: 0.1 }), missing: () => [] }
    for (const [, label, file] of SCENES) {
        const doc = Model.parse(await load(benchUrl(file)))
        console.warn = () => { }
        const box = stepCacheBox(doc, unit)
        console.warn = warn
        ok(`${label}: a box, larger than nothing, finite`, !!box && [0, 1, 2].every(k => Number.isFinite(box.lo[k]) && Number.isFinite(box.hi[k]) && box.hi[k] > box.lo[k]),
            JSON.stringify(box))
    }
    const u = unionBox([{ lo: [0, 0, 0], hi: [1, 2, 3] }, { lo: [-1, 1, 1], hi: [0, 4, 2] }], 0.1)
    ok('joined and padded a tenth of the largest side (4) each way', JSON.stringify(u) === JSON.stringify({ lo: [-1.4, -0.4, -0.4], hi: [1.4, 4.4, 3.4] }), JSON.stringify(u))
    ok('...none for no box', unionBox([]) === null)
}

console.log(`stepcache bench: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
