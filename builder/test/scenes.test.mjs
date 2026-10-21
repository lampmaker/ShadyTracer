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
import { EVERY_SCENE, fixturePath } from '../../test/scenes.mjs'
import { createUniformState, uniformToGPU } from '../../lib/pathtracer/core/uniforms.schema.js'
import { literalsIn } from './literals.mjs'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}

const dir = fileURLToPath(new URL('../../scenes/', import.meta.url))
ok('there are examples', SCENE_FILES.length >= 3)
ok('files are listed once', new Set(SCENE_FILES).size === SCENE_FILES.length)
const titles = []
// every example and every scene that was one (test/fixtures/scenes): titles compared among the examples, which the menu lists
for (const { name, path } of EVERY_SCENE) {
    const s = { file: name }
    const file = path
    if (!existsSync(file)) { ok(`${s.file} exists`, false); continue }
    const text = readFileSync(file, 'utf8')
    let doc
    try { doc = M.parse(text) } catch (e) { ok(`${s.file} loads`, false, e.message); continue }
    ok(`${s.file} is saved at the current version`, JSON.parse(text).version === M.VERSION, `version ${JSON.parse(text).version}`)
    if (SCENE_FILES.includes(name)) titles.push(doc.title)
    const g = generate(M.toTree(doc), { id: 'built', title: doc.title })
    ok(`${s.file} generates an SDF`, g.wgsl.includes('fn SDF(r: Ray) -> Hit'))
    const read = [...g.body.matchAll(/UB\.(\w+)/g)].map(m => m[1]).filter(n => /_/.test(n))
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
ok('the examples\' titles are unique -- they are what the menu and the tree tell scenes apart by', new Set(titles).size === titles.length)
/* THE EXAMPLES' LIST (scenes/examples.js, made by scenes/make.mjs): every one a file here with the title the file has, an
   audience of the two, a group and a line saying what it shows -- and IN ITS FILE (0.66.0) a view and an environment
   that are WHOLE: every camera and exposure setting and every environment setting written, so nothing of the scene shown
   before is left in it (the user, 2026-10-17: "review every single example scene to make sure camera, exposure etc. are
   set correctly there"), and a camera the orbit camera can take -- finite numbers, above the horizon at most straight
   down, some distance away */
{
    const { EXAMPLES, FIRST_VISIT } = await import('../../scenes/index.js')
    const AUDIENCES = ['Modelling and rendering', 'Optical design']
    const docs = {}
    const bad = EXAMPLES.flatMap(e => {
        const p = []
        if (!existsSync(dir + e.file)) return [`${e.file}: no file`]
        const d = docs[e.file] = M.parse(readFileSync(dir + e.file, 'utf8'))
        if (d.title !== e.title) p.push(`${e.file}: title is not the file's`)
        if (!AUDIENCES.includes(e.audience)) p.push(`${e.file}: audience '${e.audience}'`)
        if (!e.group || !/\S/.test(e.description ?? '')) p.push(`${e.file}: no group or description`)
        if ('camera' in e) p.push(`${e.file}: a camera in the list -- it is the file's`)
        const c = d.view?.camera || {}
        const nums = [...(c.target || []), c.azimuth, c.elevation, c.distance]
        if (c.mode !== 'orbit' || c.target?.length !== 3 || !nums.every(Number.isFinite) || !(c.distance > 0) || c.elevation < 0 || c.elevation > 180)
            p.push(`${e.file}: camera ${JSON.stringify(c)}`)
        const lack = (o, keys) => keys.filter(k => !(k in (o || {})))
        const missing = [...lack(d.view?.camera, Object.keys(M.CAMERA_DEFAULTS)), ...lack(d.view?.exposure, Object.keys(M.VIEW_EXPOSURE)),
                         ...lack(d.environment, Object.keys(M.ENVIRONMENT))]
        if (missing.length) p.push(`${e.file}: not whole, no ${missing.join(', ')}`)
        return p
    })
    ok('every example listed has its file, title, audience, group, description, and a usable camera and whole view and environment in its file',
        !bad.length, bad.join('\n      '))
    ok('the first visit is an example', EXAMPLES.some(e => e.file === FIRST_VISIT))
    // THE REVIEW'S FINDINGS (0.66.0), read off each file's own sizes: what was wrong stays put right
    const at = c => { const r = Math.PI / 180, h = c.distance * Math.sin(c.elevation * r)
        return [c.target[0] + h * Math.cos(c.azimuth * r), c.target[1] + h * Math.sin(c.azimuth * r), c.target[2] + c.distance * Math.cos(c.elevation * r)] }
    {
        const d = docs['office-lighting.json'], inside = M.find(d, M.find(d, 'root').node.children.find(n => n.label === 'room').children.find(n => n.label === 'inside').id).node
        const half = inside.params.size, mid = inside.transform.pos, p = at(d.view.camera)
        ok('Office lighting is seen from inside the room, not from behind its wall',
            Math.abs(p[0] - mid.x) < half.x && Math.abs(p[1] - mid.y) < half.y && Math.abs(p[2] - mid.z) < half.z, JSON.stringify(p))
    }
    ok('Depth of field opens with its lens, focused on its target; no other example has one',
        docs['depth-of-field.json'].view.camera.aperture === 8 && docs['depth-of-field.json'].view.camera.focus === 0
        && EXAMPLES.filter(e => e.file !== 'depth-of-field.json').every(e => docs[e.file].view.camera.aperture === 0))
    {
        const d = docs['glass-liquid.json']
        const water = M.find(d, 'root').node.children.find(n => n.label === 'water'), tumbler = M.find(d, 'root').node.children.find(n => n.label === 'tumbler')
        const inner = Math.min(...tumbler.params.outline.filter(q => q[1] > 6 && q[1] < 100).map(q => q[0]))
        const gap = inner - water.params.radius
        ok('Glass and liquid sets a tolerance finer than the water\'s gap to its glass', d.tolerance > 0 && d.tolerance <= gap / 4, `${d.tolerance} against ${gap}`)
    }
    ok('Parabolic reflector sets its tolerance by the reflector (5 um), not by the wall 2 m off',
        docs['parabolic-reflector.json'].tolerance === 0.005 && docs['parabolic-reflector.json'].unit === 'mm')
}
{
    // the Menger sponge's loop bound must reach the shader as a constant, or the loop cannot unroll
    const g = generate(M.toTree(M.parse(readFileSync(fixturePath('menger.json'), 'utf8'))))
    ok('menger: iterations is a u32 const, not a uniform', g.body.includes('const iterations: u32 = 3u;') && !('iterations_sponges' in g.uniforms))
}

// A MATERIAL'S NUMBERS ARE ITS PARAMETERS (literals.mjs): no colour or length in a bundled scene's material code
{
    const held = []
    for (const [file, path] of [...EVERY_SCENE.map(s => [s.name, s.path]), ['fixtures/Menger_cubes.json', fixturePath('Menger_cubes.json')]]) {
        const doc = M.parse(readFileSync(path, 'utf8'))
        for (const m of doc.materials) {
            const l = [...literalsIn(m.code), ...literalsIn(m.relief?.code)]
            if (l.length) held.push(`${file} ${m.label}: ${l.join(' ')}`)
        }
    }
    ok('no bundled scene\'s material code holds a colour or a length: they are its parameters', !held.length, held.join('\n      '))
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
