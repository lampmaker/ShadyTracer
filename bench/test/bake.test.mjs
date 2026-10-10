//======================================================================================================================
// THE BAKE BENCH AND THE BAKE (bench/bake.js, builder/bake.js). Run:
//   node bench/test/bake.test.mjs
//
// No GPU: whether a baked scene is faster is the user's card's to say, and whether it draws what codegen draws the GPU
// test's (builder/test/bake.gpu.mjs). What is checked: each bench scene twice, codegen then baked,
// one camera, environment and box measurer, each compiled; the baked text is codegen's with the values' reads renamed
// and nothing else (un-baked, byte for byte); every value a constant with the value the uniform had, but the culling
// boxes; the constants written as WGSL (vectors and matrices too), scalars as they always were; a value no literal can
// hold kept a uniform; the scene baked from untouched.
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bakeTest, SCENES, liveInBench } from '../bake.js'
import { baked, BAKE_PREFIX, BAKED_TEXTS, bakeable } from '../../builder/bake.js'
import { sceneConstantsWGSL, uniformToGPU } from '../../lib/pathtracer/core/uniforms.schema.js'
import { benchUrl, sceneOf } from '../index.js'
import * as Model from '../../builder/model.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const warn = console.warn; console.warn = () => { }
const load = async url => readFileSync(fileURLToPath(url), 'utf8')

const t = await bakeTest(load)
const C = t.cases
ok('a bench test of its own', t.id === 'bake' && t.kind === 'bench')
ok('every scene twice, and the drift row', C.length === 2 * SCENES.length + 1, `${C.length} rows`)
SCENES.forEach(([, label], s) => {
    const [a, b] = [C[2 * s], C[2 * s + 1]]
    ok(`${label}: codegen, then baked`, a.label === `${label}, codegen` && b.label === `${label}, baked` && !a.scene.baked && !!b.scene.baked && b.bakedOf === 2 * s)
    ok(`${label}: one camera, environment and box measurer; each compiled (its own text)`, a.camera === b.camera && a.measureBoxes === b.measureBoxes
        && JSON.stringify(a.environment) === JSON.stringify(b.environment) && a.compile === true && b.compile === true && a.scene.wgsl !== b.scene.wgsl)
})
const drift = C.at(-1)
ok('the last row is the first again, not compiled again', drift.scene === C[0].scene && drift.sameTextAs === 0 && !drift.compile && /drift/.test(drift.label))

/* EACH BENCH SCENE BAKED, against the codegen scene it was baked from (the same object, so the same id) */
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
for (const [key, label, file] of SCENES) {
    const doc = Model.parse(await load(benchUrl(file)))
    const S = sceneOf(doc, `t-${key}`)
    const before = JSON.stringify([S.uniforms, S.constants ?? null, ...BAKED_TEXTS.map(k => S[k] ?? null), S.body])
    const B = baked(S, { live: liveInBench })
    const names = B.baked.names, kept = B.baked.kept
    const all = Object.keys(S.uniforms)
    ok(`${label}: the scene baked from untouched`, JSON.stringify([S.uniforms, S.constants ?? null, ...BAKED_TEXTS.map(k => S[k] ?? null), S.body]) === before)
    ok(`${label}: every value baked but the culling boxes (${names.length} baked, ${kept.length} live)`, names.length + kept.length === all.length
        && kept.every(liveInBench) && all.filter(liveInBench).every(n => kept.includes(n)) && names.length > 0
        /* boxes kept exactly where codegen tests one: none on Surface materials since 0.34.0, its fourteen nodes plain
           shapes (codegen.js ONLY THE DEAR ONES) */
        && (kept.length > 0) === /\bcullDist\(/.test(S.wgsl),
        `${names.length} + ${kept.length} of ${all.length}`)
    ok(`${label}: its uniforms the live ones alone`, JSON.stringify(Object.keys(B.uniforms).sort()) === JSON.stringify([...kept].sort()))
    const reads = BAKED_TEXTS.filter(k => typeof B[k] === 'string').flatMap(k => names.filter(n => new RegExp(`\\bUB\\.${esc(n)}\\b`).test(B[k])))
    ok(`${label}: no text reads a baked value from the uniforms`, reads.length === 0, reads.slice(0, 5).join(' '))
    const unbake = txt => txt.replace(new RegExp(`\\b${BAKE_PREFIX}(${names.map(esc).join('|')})\\b`, 'g'), 'UB.$1')
    ok(`${label}: un-baked, every text is codegen's byte for byte (the reads renamed, nothing else)`,
        BAKED_TEXTS.every(k => (S[k] == null && B[k] == null) || unbake(B[k]) === S[k]), BAKED_TEXTS.filter(k => S[k] != null && unbake(B[k]) !== S[k]).join())
    ok(`${label}: every baked value a constant holding the uniform's value`, names.every(n => {
        const c = B.constants[BAKE_PREFIX + n], u = S.uniforms[n], v = uniformToGPU(u.def, u.type)
        return c && c.type === u.type && JSON.stringify(Array.isArray(v) || ArrayBuffer.isView(v) ? Array.from(v) : v) === JSON.stringify(c.def)
    }))
    const decl = sceneConstantsWGSL(B)
    ok(`${label}: each declared at the head of every kernel, once`, names.every(n => decl.split(`const ${BAKE_PREFIX}${n}: `).length === 2))
    ok(`${label}: no body (the code editor's probe is codegen's, never a baked scene's)`, B.body === undefined && S.body !== undefined)
}

/* THE LITERALS (uniforms.schema.js wgslLiteral): scalars as they always were, vectors and matrices whole */
{
    const lit = (type, def) => sceneConstantsWGSL({ wgsl: 'const LIGHT_FACES: u32 = 0u;', constants: { k: { type, def } } }).trim()
    ok('f32 whole and not, u32, i32: as before', lit('f32', 1) === 'const k: f32 = 1.0;' && lit('f32', 0.5) === 'const k: f32 = 0.5;'
        && lit('u32', 3) === 'const k: u32 = 3u;' && lit('i32', -2) === 'const k: i32 = -2;', [lit('f32', 1), lit('f32', 0.5), lit('u32', 3)].join(' | '))
    ok('...an f32 at 1e21 or more without the ".0" a number in exponent form cannot take', lit('f32', 1e30) === 'const k: f32 = 1e+30;' && lit('f32', -2e21) === 'const k: f32 = -2e+21;', lit('f32', 1e30))
    ok('a vector', lit('vec3<f32>', [1, 0.5, -2]) === 'const k: vec3<f32> = vec3<f32>(1.0, 0.5, -2.0);', lit('vec3<f32>', [1, 0.5, -2]))
    ok('a matrix, its numbers in order', lit('mat4x4<f32>', [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 3.5, 0, 1])
        === 'const k: mat4x4<f32> = mat4x4<f32>(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 2.0, 3.5, 0.0, 1.0);')
    ok('a u32 vector', lit('vec4<u32>', [1, 2, 3, 4]) === 'const k: vec4<u32> = vec4<u32>(1u, 2u, 3u, 4u);')
}
/* A VALUE NO LITERAL CAN HOLD stays a uniform: not finite, past f32's range, below its normal range */
{
    const S = { wgsl: 'fn f() -> f32 { return UB.a + UB.b + UB.c + UB.d + UB.e + UB.ab; }', uniforms: {
        a: { type: 'f32', def: Infinity }, b: { type: 'f32', def: 2 }, c: { type: 'f32', def: 1e39 }, d: { type: 'vec3<f32>', def: [1, NaN, 0] },
        e: { type: 'f32', def: 1e-40 }, ab: { type: 'f32', def: 3 } } }
    const B = baked(S)
    ok('kept a uniform: Infinity, 1e39, a vector with a NaN, 1e-40; baked: the rest', JSON.stringify(B.baked.kept) === '["a","c","d","e"]'
        && JSON.stringify(B.baked.names) === '["b","ab"]', JSON.stringify(B.baked))
    ok('...and the text reads each where it now is, a name never mistaken for one it begins (ab, not a + b)',
        B.wgsl === 'fn f() -> f32 { return UB.a + bk_b + UB.c + UB.d + UB.e + bk_ab; }', B.wgsl)
    ok('bakeable: a number, finite, in range; a vector of them', bakeable('f32', 2) && !bakeable('f32', NaN) && bakeable('vec3<f32>', [1, 2, 3])
        && !bakeable('vec3<f32>', [1, Infinity, 3]) && !bakeable('array<f32, 4>', [1, 2, 3, 4]))
}

console.warn = warn
console.log(`bake bench: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
