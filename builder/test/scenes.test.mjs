//======================================================================================================================
// Tests for the builder's scene files. Run: node builder/test/scenes.test.mjs
//
// Each bundled scene (scenes/index.js) must exist, load at the current format version (a file saved
// by an older builder would still load, but then upgrades every time; re-save it), and generate a
// scene whose uniforms are all declared -- what check-shaders then compiles.
//======================================================================================================================
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as M from '../model.js'
import { generate } from '../codegen.js'
import { SCENE_FILES } from '../../scenes/index.js'
import { createUniformState, uniformToGPU } from '../../lib/pathtracer/core/uniforms.schema.js'
import { literalsIn } from './literals.mjs'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}

const dir = fileURLToPath(new URL('../../scenes/', import.meta.url))
ok('there are scenes', SCENE_FILES.length >= 3)
ok('files are listed once', new Set(SCENE_FILES).size === SCENE_FILES.length)
const titles = []
for (const name of SCENE_FILES) {
    const s = { file: name }
    const file = dir + s.file
    if (!existsSync(file)) { ok(`${s.file} exists`, false); continue }
    const text = readFileSync(file, 'utf8')
    let doc
    try { doc = M.parse(text) } catch (e) { ok(`${s.file} loads`, false, e.message); continue }
    ok(`${s.file} is saved at the current version`, JSON.parse(text).version === M.VERSION, `version ${JSON.parse(text).version}`)
    titles.push(doc.title)
    const g = generate(M.toTree(doc), { id: 'built', title: doc.title })
    ok(`${s.file} generates an SDF`, g.wgsl.includes('fn SDF(r: Ray) -> Hit'))
    const read = [...g.body.matchAll(/UB\.(\w+)/g)].map(m => m[1]).filter(n => /_/.test(n) && !/^(normallimit)$/.test(n))
    const missing = [...new Set(read)].filter(n => !(n in g.uniforms))
    ok(`${s.file}: every node or material uniform it reads is declared`, !missing.length, missing.join(', '))
    /* AND EVERY DEFAULT REACHES THE GPU AS ITSELF, through the renderer's own state and writer.
       A transform's mat4 once left createUniformState as {0:1, 1:0, ...} and was written as a
       zero matrix: every builder scene rendered black while every check here passed. */
    const st = createUniformState(g.uniforms)
    const bad = Object.entries(g.uniforms).filter(([k, u]) => {
        const want = uniformToGPU(u.def, u.type), got = uniformToGPU(st.values[k], u.type)
        return JSON.stringify(got) !== JSON.stringify(want) || (typeof u.def === 'object' && !Array.isArray(got))
    }).map(([k]) => k)
    ok(`${s.file}: every uniform default reaches the GPU unchanged`, !bad.length, bad.join(', '))
}
ok('titles are unique -- they are what the tree tells scenes apart by', new Set(titles).size === titles.length)
{
    // the Menger sponge's loop bound must reach the shader as a constant, or the loop cannot unroll
    const g = generate(M.toTree(M.parse(readFileSync(dir + 'menger.json', 'utf8'))))
    ok('menger: iterations is a u32 const, not a uniform', g.body.includes('const iterations: u32 = 3u;') && !('iterations_sponges' in g.uniforms))
}

// A MATERIAL'S NUMBERS ARE ITS PARAMETERS (literals.mjs): no colour or length in a bundled scene's material code
{
    const dir = new URL('../../scenes/', import.meta.url)
    const held = []
    for (const file of [...SCENE_FILES, 'Menger_cubes.json']) {
        const doc = M.parse(readFileSync(new URL(file, dir), 'utf8'))
        for (const m of doc.materials) {
            const l = [...literalsIn(m.code), ...literalsIn(m.relief?.code)]
            if (l.length) held.push(`${file} ${m.label}: ${l.join(' ')}`)
        }
    }
    ok('no bundled scene\'s material code holds a colour or a length: they are its parameters', !held.length, held.join('\n      '))
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
