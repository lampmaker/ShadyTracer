//======================================================================================================================
// Tests for the sky in code (builder/sky.js; the renderer's lib/pathtracer/core/sdf.js THE SKY IN CODE).
// Run: node builder/test/sky.test.mjs
//
// The block as a document's: none by default, saved and read, refused when it defines no background or reaches into the
// functions block, a node called sky still a node; what toTree hands codegen; codegen's text -- nothing about a sky in a
// scene without one or with comments only, the scene's kernels' text the same with a sky beside it, the block in the
// checked body at its own lines (SKY_ID), and `sky` on the scene; sceneTextOf telling the two apart; the shade kernel's
// text with and without it (withSkyCode); the environment's settings for it (derive, lamps only); the starting block's
// factor against a JS copy of the scattering model; the Insert pane's recipes calling only what exists. That every
// kernel compiles with both starts and every recipe is check-shaders' (pass four, naga); how it looks is the user's.
//======================================================================================================================
import * as M from '../model.js'
import { generate } from '../codegen.js'
import { resolve } from '../emit.js'
import { CODE_BLOCKS, recipeText, preludeSignatures } from '../coderef.js'
import { sceneTextOf, UniformGroups } from '../../lib/pathtracer/core/uniforms.schema.js'
import { SKY_CODE_STUB, SKY_CODE_FN, withSkyCode } from '../../lib/pathtracer/core/sdf.js'
import { SHADE_PRELUDE, SCENE_PRELUDE } from '../../lib/pathtracer/core/scene_api.js'
import { prog_shade } from '../../lib/pathtracer/core/wavefront.js'
import { derive, sunHorizontal } from '../../lib/pathtracer/core/photometry.js'
import { effective } from '../../lib/pathtracer/quality.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const throws = (name, fn, match) => {
    try { fn() } catch (e) { ok(name, !match || match.test(String(e.message)), `threw: ${e.message}`); return }
    ok(name, false, 'did not throw')
}
const scene = sky => {
    const d = M.createDoc()
    M.addObject(d, 'root', { id: 'ball', primitive: 'sphere' })
    if (sky !== undefined) d.sky = sky
    return d
}

//----------------------------------------------------------------------------------------------------------------------
// the block in the document
//----------------------------------------------------------------------------------------------------------------------
{
    ok('the renderer and the builder name one function', M.SKY_FN === SKY_CODE_FN)
    ok('a new document has no sky block', !('sky' in M.createDoc()))
    ok('both starts are sound', M.SKY_PRESETS.every(p => M.skyProblems(p.code).length === 0) && M.SKY_PRESETS.length === 2)
    ok('...and the first is the sun & sky model', M.SKY_PRESETS[0].code === M.SKY_TEMPLATE)
    ok('no block, an empty one and comments only are no sky',
        !M.hasSky(undefined) && !M.hasSky('') && !M.hasSky('// a note\n/* another */') && M.hasSky(M.SKY_TEMPLATE))
    ok('...and nothing wrong with any of them', [undefined, '', '// a note'].every(t => M.skyProblems(t).length === 0))
    ok('a block without background(dir) is refused', /must define fn background/.test(M.skyProblems('fn other(d: VEC3) -> VEC3 { return d; }').join()))
    ok('...and one that is not text', /string/.test(M.skyProblems(42).join()))
    const fns = 'fn glow(d: VEC3) -> VEC3 { return d; }\nconst HALF = 0.5;'
    const calls = 'fn background(dir: VEC3) -> VEC3 { return glow(dir) * HALF; }'
    ok('a name of the functions block the sky reads is refused, by name', (p => p.length === 2 && /'glow'/.test(p[0]) && /'HALF'/.test(p[1]))(M.skyProblems(calls, fns)), M.skyProblems(calls, fns).join(' | '))
    ok('...not one the sky defines itself', M.skyProblems(`${calls}\nfn glow(d: VEC3) -> VEC3 { return d; }\nconst HALF = 0.5;`, fns).length === 0)
    ok('...nor one named only in a comment', M.skyProblems('// glow() and HALF\nfn background(dir: VEC3) -> VEC3 { return dir; }', fns).length === 0)

    const d = scene(M.STARS_TEMPLATE)
    const back = M.parse(M.serialize(d))
    ok('the block is saved and read as it was', back.sky === M.STARS_TEMPLATE)
    throws('a file whose sky defines no background is refused', () => M.parse(M.serialize(scene('fn x() {}'))), /background/)
    const named = M.createDoc()
    M.addObject(named, 'root', { id: 'sky', primitive: 'sphere' })
    ok('a node called sky is still a node (the block\'s lines are #sky\'s)', M.parse(M.serialize(named)).root.children[0].id === 'sky' && M.SKY_ID === '#sky')
    ok('toTree hands the block to codegen', M.toTree(d).sky === M.STARS_TEMPLATE && M.toTree(scene()).sky === '')
}

//----------------------------------------------------------------------------------------------------------------------
// codegen's text
//----------------------------------------------------------------------------------------------------------------------
{
    const plain = generate(M.toTree(scene()), { id: 'x' })
    const notes = generate(M.toTree(scene('// only a note')), { id: 'x' })
    const withSky = generate(M.toTree(scene(M.SKY_TEMPLATE)), { id: 'x' })
    ok('a scene without a block has no sky, and its text is what it was', !('sky' in plain) && !/THE SKY BLOCK/.test(plain.body))
    ok('...nor does one whose block is comments only', !('sky' in notes) && notes.body === plain.body)
    ok('with one, the scene carries it for the shade kernel', withSky.sky === M.SKY_TEMPLATE)
    ok('...and the scene\'s kernels\' text is the one without it', withSky.wgsl === plain.wgsl && !/background/.test(withSky.wgsl))
    ok('...while the checked body has it, and calls it as skyCode will', withSky.body.includes(M.SKY_TEMPLATE.trim())
        && /fn skyBlockCalled\(d: VEC3\) -> VEC3 \{ return background\(d\); \}/.test(withSky.body))
    // its lines are its own: the body's line of `fn background` resolves to the block's, under SKY_ID
    const lines = withSky.body.split('\n')
    const at = lines.findIndex(l => l.startsWith('fn background(')) + 1
    const own = M.SKY_TEMPLATE.split('\n').findIndex(l => l.startsWith('fn background(')) + 1
    const r = resolve(withSky.map, at)
    ok('an error in the block is reported at its own line, as #sky\'s', r?.node === M.SKY_ID && r?.line === own, JSON.stringify(r))
    ok('sceneTextOf tells a scene with a sky from one without, and one sky from another',
        sceneTextOf(plain) !== sceneTextOf(withSky)
        && sceneTextOf(withSky) !== sceneTextOf(generate(M.toTree(scene(M.STARS_TEMPLATE)), { id: 'x' }))
        && sceneTextOf(plain) === sceneTextOf(notes))
}

//----------------------------------------------------------------------------------------------------------------------
// the renderer's side: the stub, the shade kernel's text
//----------------------------------------------------------------------------------------------------------------------
{
    const count = (s, x) => s.split(x).length - 1
    ok('every prelude has the stub once', count(SHADE_PRELUDE, SKY_CODE_STUB) === 1 && count(SCENE_PRELUDE, SKY_CODE_STUB) === 1)
    ok('no block: the prelude as it was', withSkyCode(SHADE_PRELUDE, null) === SHADE_PRELUDE && withSkyCode(SHADE_PRELUDE, '') === SHADE_PRELUDE)
    const code = 'fn background(dir: VEC3) -> VEC3 { return VEC3(1.0); }   // $& $1 stay as typed'
    const w = withSkyCode(SHADE_PRELUDE, code)
    ok('with one: the stub calls it, and the block follows as typed', !w.includes(SKY_CODE_STUB)
        && /fn skyCode\(dir: VEC3\) -> VEC3 \{ return background\(dir\); \}/.test(w) && w.includes(code))
    throws('a prelude with no stub is refused, not left calling nothing', () => withSkyCode('fn x() {}', code), /no sky stub/)

    const WG = { makeCompute: async body => body }
    const without = await prog_shade(WG, { wgsl: '' }, 64)
    const sky = await prog_shade(WG, { wgsl: '', sky: M.STARS_TEMPLATE }, 64)
    ok('the shade kernel without a sky block is the stub\'s', without.includes(SKY_CODE_STUB) && !/kaliStars/.test(without))
    ok('...and with one, the block\'s', !sky.includes(SKY_CODE_STUB) && sky.includes(M.STARS_TEMPLATE))
}

//----------------------------------------------------------------------------------------------------------------------
// the environment's settings
//----------------------------------------------------------------------------------------------------------------------
{
    const L = UniformGroups.Lighting
    ok('the source offers the sky in code as 2', L.envMode.gui.options['sky in code'] === 2)
    ok('...with its scale shown only there, and the sun\'s rows there too', L.skyCodeIlluminance.gui.showIf.envMode.join() === '2'
        && ['sunIlluminance', 'sunDiameter', 'uSunAzimuth', 'uSunElevation', 'uSkyTurbidity'].every(k => L[k].gui.showIf.envMode.includes(2))
        && L.skyIlluminance.gui.showIf.envMode.join() === '0')
    const v = { envMode: 2, sunIlluminance: 100000, uSunElevation: 30, skyCodeIlluminance: 2000, skyIlluminance: 15000 }
    const D = derive(v)
    ok('in it the sun shines as in sun & sky', D.sunL > 0 && D.sunL === derive({ ...v, envMode: 0 }).sunL && D.neeSunPick > 0)
    ok('...and the Sketch light is the sun\'s share plus the code\'s scale', Math.abs(D.sketchE - (sunHorizontal(100000, 30) + 2000)) < 1e-6, D.sketchE)
    ok('lamps only puts the sky in code out too', effective({ ...v, lampsOnly: 1 }).skyCodeIlluminance === 0)
}

//----------------------------------------------------------------------------------------------------------------------
// the starting block's factor: 26.33 takes the model's raw sky at the default sun to pi, so 1.0's lux. Against a JS copy
// of skyRadianceRaw (sdf.js) integrated as prog_skynorm does -- the test's copy, so a change to the model in sdf.js that
// is not made here and in the template's text fails here.
//----------------------------------------------------------------------------------------------------------------------
{
    const BR = [0.175, 0.410, 1.0], LUMA = [0.2126, 0.7152, 0.0722]
    const airMass = c => { c = Math.min(Math.max(c, 0), 1); const z = Math.acos(c) * 180 / Math.PI; return 1 / (c + 0.15 * Math.pow(Math.max(93.885 - z, 0.1), -1.253)) }
    const e = 45 * Math.PI / 180, a = 45 * Math.PI / 180, sd = [Math.cos(e) * Math.sin(a), Math.cos(e) * Math.cos(a), Math.sin(e)]
    const bM = 0.06 * (0.5 + 0.7), g = 0.76
    let acc = 0
    const N = 256
    for (let i = 0; i < N * N; i++) {
        const u = [((i % N) + 0.5) / N, (Math.floor(i / N) + 0.5) / N], r = Math.sqrt(u[0]), phi = 2 * Math.PI * u[1]
        const d = [r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(Math.max(0, 1 - u[0]))]
        const cosT = Math.max(-1, Math.min(1, d[0] * sd[0] + d[1] * sd[1] + d[2] * sd[2]))
        const pR = 3 / (16 * Math.PI) * (1 + cosT * cosT), pM = (1 - g * g) / (4 * Math.PI * Math.pow(Math.max(1 + g * g - 2 * g * cosT, 1e-4), 1.5))
        const air = airMass(Math.max(d[2], 0)) + airMass(Math.max(sd[2], 0))
        acc += BR.reduce((s, b, k) => { const bT = b + bM; return s + LUMA[k] * (b * pR + bM * pM) / bT * (1 - Math.exp(-bT * air * 0.35)) }, 0)
    }
    const raw = Math.PI * acc / (N * N)
    const factor = +/return scattered \* ([0-9.]+);/.exec(M.SKY_TEMPLATE)[1]
    ok('the template\'s factor takes the default sun\'s sky to 1.0\'s lux, within 0.5 %', Math.abs(factor * raw / Math.PI - 1) < 0.005, `${factor} x ${raw} / pi`)
    ok('...at the schema\'s default sun', UniformGroups.Lighting.uSunElevation.def === 45 && UniformGroups.Lighting.uSkyTurbidity.def === 0.7)
}

//----------------------------------------------------------------------------------------------------------------------
// the Insert pane's recipes: lines of background's body, each a return, calling only the prelude's functions or WGSL's
//----------------------------------------------------------------------------------------------------------------------
{
    const S = preludeSignatures()
    const B = CODE_BLOCKS.sky
    ok('the sky has an Insert pane of its own', !!B && B.recipes.length > 0 && B.fns.includes('Noise'))
    ok('...each recipe a whole answer', B.recipes.every(r => /\breturn\b/.test(recipeText(r))))
    const fns = [...B.recipes.map(recipeText).join('\n').matchAll(/\b([a-z]\w*)\s*\(/g)].map(m => m[1])
    const wgsl = new Set(['mix', 'smoothstep', 'select', 'pow', 'max', 'dot'])
    ok('...calling only the prelude\'s functions or WGSL\'s', fns.every(f => S.has(f) || wgsl.has(f)), fns.filter(f => !S.has(f) && !wgsl.has(f)).join(', '))
    ok('...and sunDirection, which the template and a recipe call, is the prelude\'s', S.has('sunDirection') && S.has('airMass'))
}

console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
