//======================================================================================================================
// Tests for the lights-in-an-array bench (bench/lightarray.js, Tests > lightarray). Run: node bench/test/lightarray.test.mjs
//
// The timing exists only on a card, run by a person. What can be checked is that every row is what its label says: the
// same floor, camera and environment, the same lumens in every row, the faces the label counts -- in the scene's text and
// in the photons' sources -- and the 16 by hand the 16 of the array, light for light.
//======================================================================================================================
import { lightArrayTest, lightArrayDoc, lightsOf, TOTAL_LM, CAMERA } from '../lightarray.js'
import { BENCH } from '../index.js'
import * as Model from '../../builder/model.js'
import { sourceTable } from '../../builder/sources.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }

const T = await lightArrayTest()
ok('a bench-kind test at 1280 x 720, the benchmark\'s timing', T.kind === 'bench' && T.size === BENCH.size && T.timed === BENCH.timed && T.warmup === BENCH.warmup)
ok('seven rows, labels unique', T.cases.length === 7 && new Set(T.cases.map(c => c.label)).size === 7)
// rows 5 and 6 rows 2 and 4 with the window off (builder/arrays.js): the same document, the window's text the difference
ok('rows 2 and 4 walk a window of the copies, rows 5 and 6 every copy', [1, 3].every(i => /fn arrWindow/.test(T.cases[i].scene.wgsl))
    && [4, 5].every(i => !/fn arrWindow/.test(T.cases[i].scene.wgsl)) && T.cases[4].kind === 'row' && T.cases[5].kind === 'ring'
    && T.cases[4].scene.wgsl.replace(/lightarray-row-all/g, '') !== T.cases[1].scene.wgsl)
ok('every row the one camera and environment, no setting changed', T.cases.every(c => c.camera === CAMERA && JSON.stringify(c.environment) === JSON.stringify(T.cases[0].environment) && !Object.keys(c.set).length))
ok('rows 1-6 baked and compiled, row 7 row 1 again', T.cases.slice(0, 6).every(c => c.baked && c.compile) && T.cases[6].scene === T.cases[0].scene && T.cases[6].sameTextAs === 0)

const faces = { one: 1, row: 16, hand: 16, ring: 256 }
for (const c of T.cases.slice(0, 6)) {
    const doc = lightArrayDoc(c.kind)
    const src = sourceTable(doc)
    ok(`${c.kind}: a sound scene`, Model.validate(doc).length === 0, JSON.stringify(Model.validate(doc)))
    ok(`${c.kind}: ${faces[c.kind]} faces in the text and as sources, none skipped`, new RegExp(`const LIGHT_FACES: u32 = ${faces[c.kind]}u;`).test(c.scene.wgsl)
        && src.sources.length === faces[c.kind] && !src.skipped.length && c.opticsLight.sources.length === faces[c.kind])
    ok(`${c.kind}: ${TOTAL_LM} lm in all`, Math.abs(src.sources.reduce((s, x) => s + x.flux, 0) - TOTAL_LM) < 1e-9 * TOTAL_LM)
    ok(`${c.kind}: the lights face down, onto the floor`, src.sources.every(x => Math.abs(x.normal[2] + 1) < 1e-9))
    ok(`${c.kind}: the floor the same`, JSON.stringify(doc.root.children[0]) === JSON.stringify(lightArrayDoc('one').root.children[0]))
}
// the 16 by hand are the 16 of the array, light for light; the ring's 256 all at different places
const near = (a, b) => a.every((x, k) => Math.abs(x - b[k]) < 1e-9)
const row = sourceTable(lightArrayDoc('row')).sources, hand = sourceTable(lightArrayDoc('hand')).sources
ok('the 16 placed by hand where the array puts its copies', row.length === 16 && row.every((x, i) => near(x.origin, hand[i].origin) && near(x.normal, hand[i].normal) && Math.abs(x.flux - hand[i].flux) < 1e-12))
// the text: a light's lines are its `// light <id>` comments -- the array as many as the one light, the 16 by hand 16 times
const lines = c => (c.scene.wgsl.match(/\/\/ light \w+/g) || []).length
ok('...the array as many lines of light code as one light, the 16 by hand sixteen times them', lines(T.cases[1]) === lines(T.cases[0])
    && lines(T.cases[2]) === 16 * lines(T.cases[0]), `${lines(T.cases[0])} ${lines(T.cases[1])} ${lines(T.cases[2])}`)
const ring = sourceTable(lightArrayDoc('ring')).sources
ok('the ring\'s 256 faces each in a place of its own, on the floor\'s side', new Set(ring.map(x => x.origin.map(v => v.toFixed(6)).join())).size === 256
    && ring.every(x => x.origin[2] > 1 && Math.hypot(x.origin[0], x.origin[1]) < 1.6))
ok('the photons\' sources the sources\' faces', JSON.stringify(lightsOf(lightArrayDoc('ring'))[17].pos) === JSON.stringify(ring[17].origin))

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
