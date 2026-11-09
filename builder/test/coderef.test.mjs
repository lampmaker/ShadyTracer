// node builder/test/coderef.test.mjs
//
// WHAT A CODE BLOCK CAN USE (builder/coderef.js, 0.84.0), held to the code it describes, no GPU: every field of the WGSL
// struct Material2 either a line the Insert pane offers or a reason it cannot be set, and nothing named that the struct
// has not; every panel field (materials.js FIELDS) with its line; each line written from the material's own values, so
// inserting it changes nothing; every function named the prelude's; and every recipe and line in a scene's shader as it
// was written, its uniforms declared. That they COMPILE is check-shaders.mjs's (its builder-insert scene, every kernel,
// naga); where a line goes in the code, placeInsert's (builder/codehelper.js) cases below.
import * as M from '../model.js'
import { generate } from '../codegen.js'
import { FIELDS, defaults, make } from '../materials.js'
import { MATERIALS } from '../../lib/pathtracer/core/materials.js'
import { MATERIAL_SETS, MATERIAL_CANNOT, CODE_BLOCKS, CODE_HELP, preludeSignatures, setsOf, cannotOf, recipeText, callOf, f32, vec3 } from '../coderef.js'
import { placeInsert } from '../codehelper.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}

// THE STRUCT, read from the WGSL: its fields' names, comments taken out
const body = /struct Material2\s*\{([\s\S]*?)\n\}/.exec(MATERIALS)[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
const struct = [...body.matchAll(/^\s*(\w+)\s*:/gm)].map(m => m[1])
ok('the struct is read (at least the twenty fields it had)', struct.length >= 20 && struct.includes('baseColor') && struct.includes('scatterAnisotropy'), struct.join(' '))
const set = new Set(MATERIAL_SETS.flatMap(s => s.fields ?? [s.field]))
const cannot = new Set(MATERIAL_CANNOT.map(c => c.field).filter(Boolean))
ok('every field of Material2 is a line the pane offers or a reason it cannot be set',
    struct.every(f => set.has(f) || cannot.has(f)), struct.filter(f => !set.has(f) && !cannot.has(f)).join(', '))
ok('...and nothing is named that the struct has not', [...set, ...cannot].every(f => struct.includes(f)),
    [...set, ...cannot].filter(f => !struct.includes(f)).join(', '))
ok('...none both', [...cannot].every(f => !MATERIAL_SETS.some(s => s.field === f)), [...cannot].filter(f => MATERIAL_SETS.some(s => s.field === f)).join(', '))
const panel = new Set(MATERIAL_SETS.flatMap(s => s.panel ?? []))
ok('every panel field has its line', Object.keys(FIELDS).every(k => panel.has(k)), Object.keys(FIELDS).filter(k => !panel.has(k)).join(', '))
ok('...and every panel field a line names is one', [...panel].every(k => k in FIELDS), [...panel].filter(k => !(k in FIELDS)).join(', '))
ok('the normal is said not to be settable', MATERIAL_CANNOT.some(c => c.name === 'n' && /read-only/.test(c.why)))

// EACH LINE FROM THE MATERIAL'S OWN VALUES: the number it writes is the panel's
const P = { ...defaults(), roughness: 0.35, baseColor: { r: 1, g: 0.5, b: 0 }, attenuationDistance: 12.5, coating: 3, coatEdge: 550, coatLow: 0.25, ior: 1.517 }
const line = f => MATERIAL_SETS.find(s => s.field === f && !s.fields).code(P)
ok('a number written as the panel has it', line('roughness') === 'm.roughness = 0.35;', line('roughness'))
ok('...an integer value with its decimal point (WGSL\'s f32)', f32(1) === '1.0' && f32(0) === '0.0' && f32(1.517) === '1.517' && f32(1e-7) === '1e-7')
ok('a colour as VEC3', line('baseColor') === 'm.baseColor = VEC3(1.0, 0.5, 0.0);' && vec3([1, 2, 3]) === 'VEC3(1.0, 2.0, 3.0)', line('baseColor'))
ok('a colour depth in mm, through mm() -- code\'s lengths are the scene\'s unit', line('attenuationDistance') === 'm.attenuationDistance = mm(12.5);', line('attenuationDistance'))
const coat = MATERIAL_SETS.find(s => s.fields?.includes('coatR')).code(P)
ok('a coating whole through coatMaterial, where and every value the panel\'s', coat === 'm = coatMaterial(m, 3u, 0.25, 1.0, 550.0, 20.0, 1.8);', coat)
ok('...and with none in the panel, entry faces (1u)', MATERIAL_SETS.find(s => s.fields?.includes('coatR')).code(defaults()).startsWith('m = coatMaterial(m, 1u,'))
// codegen writes the panel's colour depth as mm(UB...) and a coating by coatMaterial: the pane's lines are the same shape
{
    const d = M.createDoc()
    M.addMaterial(d, { id: 'g', params: { ...make.glassSmooth({ r: 1, g: 1, b: 1 }, 1.5), attenuationDistance: 5, coating: 1 } })
    M.addObject(d, 'root', { primitive: 'sphere', material: 'g' })
    const w = generate(M.toTree(d), { id: 'x' }).wgsl
    ok('codegen writes the colour depth as mm() and the coating by coatMaterial, as the lines do',
        /m\.attenuationDistance = mm\(UB\.\w+\);/.test(w) && /m = coatMaterial\(m, UB\./.test(w))
}

// A SCATTER DISTANCE SET IN CODE compiles the walk inside, as the panel's does (codegen scene.scatter, 0.84.0): it did not,
// and the line the pane offers did nothing. A comment naming it does not; neither does a glowing material, which has none.
{
    const scat = (code, type) => {
        const d = M.createDoc()
        M.addMaterial(d, { id: 's', code, ...(type ? { type } : {}) })
        M.addObject(d, 'root', { primitive: 'sphere', material: 's' })
        return !!generate(M.toTree(d), { id: 'x' }).scatter
    }
    ok('a material whose code sets m.scatterDistance makes the scene scatter', scat('m.transmission = 1.0;\nm.scatterDistance = mm(5.0);'))
    ok('...one whose comment names it does not, nor one with no code', !scat('// m.scatterDistance = mm(5.0);') && !scat(''))
    ok('...nor a glowing material\'s code', !scat('m.scatterDistance = mm(5.0);', 'emitter'))
}

// THE FUNCTIONS each kind lists are CODE_HELP's sections, every one of them the prelude's
const S = preludeSignatures()
for (const [kind, B] of Object.entries(CODE_BLOCKS)) {
    ok(`${kind}: its function sections are CODE_HELP's`, B.fns.every(t => CODE_HELP.some(s => s.title === t)), B.fns.filter(t => !CODE_HELP.some(s => s.title === t)).join(', '))
    ok(`${kind}: says where it runs and what it is`, !!B.label && !!B.runs)
    for (const s of setsOf(kind)) ok(`${kind}: a line it sets is a statement`, /;\s*$/.test(s.code(defaults()).split('\n')[0]) || /;\s*(\/\/.*)?$/.test(s.code(defaults())), s.code(defaults()))
    for (const c of cannotOf(kind)) ok(`${kind}: what it cannot do says why`, c.name && c.why?.length > 20, c.name)
}
ok('a call is inserted with its arguments\' names', callOf(S.get('coatMaterial')) === 'coatMaterial(m_in, coat, lo, hi, edge, width, nEff)'
    && callOf(S.get('fbm3')) === 'fbm3(p, seed, octaves, lac, gain)', callOf(S.get('fbm3')))
ok('coatMaterial and coatLowHigh, which the lines call, are the prelude\'s', S.has('coatMaterial') && S.has('coatLowHigh'))

// EVERY RECIPE AND LINE IN A SCENE, as written: in the shader, its uniforms declared (check-shaders compiles the same)
{
    const d = M.createDoc()
    const lines = [...MATERIAL_SETS.map(x => x.code(P)), ...CODE_BLOCKS.material.recipes.map(recipeText)]
    lines.forEach((code, i) => { M.addMaterial(d, { id: `i${i}`, code }); M.addObject(d, 'root', { primitive: 'sphere', material: `i${i}` }) })
    CODE_BLOCKS.relief.recipes.forEach((r, i) => {
        M.addMaterial(d, { id: `r${i}` }); M.setRelief(d, `r${i}`, 'noise'); M.material(d, `r${i}`).relief.code = recipeText(r)
        M.addObject(d, 'root', { primitive: 'sphere', material: `r${i}` })
    })
    for (const r of CODE_BLOCKS.object.recipes) M.addObject(d, 'root', { code: recipeText(r) })
    CODE_BLOCKS.group.recipes.forEach((r, i) => { M.addGroup(d, 'root', { id: `g${i}`, code: recipeText(r) }); M.addObject(d, `g${i}`, { primitive: 'sphere' }) })
    d.functions = CODE_BLOCKS.functions.recipes.map(recipeText).join('\n')
    const g = generate(M.toTree(d), { id: 'ins' })
    const all = [...lines, ...CODE_BLOCKS.relief.recipes.map(recipeText), ...CODE_BLOCKS.object.recipes.map(recipeText),
        ...CODE_BLOCKS.group.recipes.map(recipeText), d.functions]
    // a group's children(...) is its own function by name in the shader (codegen: children_<id>)
    const text = g.wgsl.replace(/\bchildren_\w+\(/g, 'children(')
    const missing = all.filter(t => !t.split('\n').every(l => text.includes(l.trim())))
    ok('every line and recipe is in the shader as written', !missing.length, missing.slice(0, 3).join(' | '))
    const read = [...new Set([...g.body.matchAll(/UB\.(\w+)/g)].map(m => m[1]).filter(n => /_/.test(n)))]
    ok('...and every uniform it reads is declared', read.every(n => n in g.uniforms), read.filter(n => !(n in g.uniforms)).join(', '))
    const fns = [...all.join('\n').replace(/\/\/.*$/gm, '').matchAll(/\b([a-z]\w*)\s*\(/g)].map(m => m[1])
    const wgsl = new Set(['mix', 'clamp', 'step', 'smoothstep', 'sin', 'cos', 'fract', 'length', 'abs', 'select', 'floor', 'max', 'min', 'normalize', 'dot', 'cross', 'pow', 'vec3', 'ring', 'fn', 'children'])
    ok('every function a recipe calls is the prelude\'s, WGSL\'s or the block\'s own', fns.every(f => S.has(f) || wgsl.has(f)), fns.filter(f => !S.has(f) && !wgsl.has(f)).join(', '))
}

// WHERE A LINE GOES (placeInsert)
{
    const T = '// a comment\n// another\n'
    let r = placeInsert(T, null, 'm.roughness = 0.2;')
    ok('a box never clicked into: at its end, under the comments', (T.slice(0, r.start) + r.text + T.slice(r.end)) === T + 'm.roughness = 0.2;' && r.caret === T.length + 18, JSON.stringify(r))
    const U = 'm.metallic = 1.0;\nm.ior = 1.5;'
    r = placeInsert(U, 3, 'm.roughness = 0.2;')
    const out = U.slice(0, r.start) + r.text + U.slice(r.end)
    ok('a caret inside a line: the line after it, the line not split', out === 'm.metallic = 1.0;\nm.roughness = 0.2;\nm.ior = 1.5;', JSON.stringify(out))
    const V = 'a;\n   \nb;'
    r = placeInsert(V, 4, 'c;')
    ok('a caret on a blank line: that line', V.slice(0, r.start) + r.text + V.slice(r.end) === 'a;\nc;\nb;', JSON.stringify(V.slice(0, r.start) + r.text + V.slice(r.end)))
    r = placeInsert('m.roughness = x;', 14, 'size', { line: false })
    ok('a name at the caret, as it is', r.start === 14 && r.end === 14 && r.text === 'size' && r.caret === 18)
    r = placeInsert('a;', 99, 'b;')
    ok('a caret past the end is the end', r.start === 2 && r.text === '\nb;')
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
