import { readFileSync, readdirSync } from 'node:fs'
//======================================================================================================================
// Tests for the generator. Run: node builder/test/codegen.test.mjs
//
// The point of these is not that the WGSL is valid -- only a driver can say that, and the
// container this was written in has no working one. It is that the things the LINE MAPPING
// depends on hold: the user's snippet is emitted byte-identical, and the map points at it.
// Everything else here is the defect list from the previous scene builder, turned into
// assertions so the rebuild cannot quietly reintroduce them.
//======================================================================================================================
import { generate, wgslTypeOf, aliasPrelude, uniformName, NODE_TYPES, xfName, blendName, boxLoName, boxHiName, codeOnly, wgslLiteral,
    renameChildren, GROUP_CODE_TEMPLATE, isProfile, isPath, isCompiledIn, livePointsUpdate, pathPieceName, pathFrameName, pathOkName, pathValuesName, pathCountName, profilePieceName, profileOkName, profileReachName, EDIT_SPARE, combinedGroups } from '../codegen.js'
import { typedColumn } from '../emit.js'
import * as Model from '../model.js'
import { resolve, mapMessages } from '../emit.js'
import { lineOffsetOf, finish, BODY_MARKER } from '../validate.js'
import { uniformToGPU } from '../../lib/pathtracer/core/uniforms.schema.js'
import { carryAcross } from '../../lib/pathtracer/index.js'
import { PRIMITIVES } from '../../lib/pathtracer/core/sdf.js'
import { DEFINITIONS } from '../../lib/pathtracer/core/tracebasics.js'
import { MATERIALS } from '../../lib/pathtracer/core/materials.js'
import { NOISE } from '../../lib/pathtracer/core/noise.js'
import { SCENE_API } from '../../lib/pathtracer/core/scene_api.js'
import { PRIMITIVES as LIBRARY, primitiveObject, SHAPE_GROUPS } from '../primitives.js'
import { modifierGroup } from '../modifiers.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const eq = (name, got, want) =>
    ok(name, JSON.stringify(got) === JSON.stringify(want),
        `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
/** A raw node for generate() that starts as a library primitive, as model.addObject makes one. */
const shape = (key, n = {}) => {
    const s = primitiveObject(key)
    return { type: 'code', code: s.code, ...n, params: { ...s.params, ...(n.params || {}) } }
}

/* A LIVE CHAIN'S LOOP WRITTEN OUT (2026-10-02: a live or edited path or profile is a loop over its slots, each read by
   its index through <name>_slot(i) -- core/shapes.js pathWGSL, profileWGSL): every slot's block with that slot's own
   uniforms, inside its on test, as the chain was written slot by slot before -- so the equivalences below read it as
   they read that. The slots' order and uniforms are the accessor's, case by case. */
const unloop = w => {
    const lines = w.split('\n'), acc = {}, out = []
    for (let i = 0; i < lines.length; i++) {
        const f = /^fn (\w+)_slot\(i: u32\) -> /.exec(lines[i])
        if (!f) continue
        acc[f[1]] = []
        for (i++; lines[i] !== '}'; i++) { const c = /^        case (\d+)u: \{ return (.*); \}$/.exec(lines[i]); if (c) acc[f[1]][+c[1]] = c[2] }
    }
    for (let i = 0; i < lines.length; i++) {
        if (/^fn \w+_slot\(i: u32\)/.test(lines[i])) { while (lines[i] !== '}') i++; continue }
        if (!/^    for \(var i = 0u; i < noUnroll\(u32\(UB\.\w+\)\); i = i \+ 1u\) \{$/.test(lines[i])) { out.push(lines[i]); continue }
        const fn = /^        let sl = (\w+)_slot\(i\);$/.exec(lines[++i])[1]
        const path = /continue/.test(lines[i + 1])
        i += path ? 3 : 2                                   // to the first line of the even slots' block
        const even = [], odd = []
        for (; lines[i] !== '        } else {'; i++) even.push(lines[i])
        for (i++; lines[i] !== '        }'; i++) odd.push(lines[i])
        i++                                                 // the loop's own closing brace
        acc[fn].forEach((x, n) => {
            const body = (n % 2 ? odd : even).map(l => l.slice(4))
            if (!path) { out.push(...body.map(l => l.slice(4).replace(/\bsl\[/g, `${x}[`))); return }     // a profile's: `    if (on) { call }`
            const [, M, F, V] = /^PathSlot\(([^,]+), ([^,]+), (.*)\)$/.exec(x)
            const inner = /^mat2x4<f32>\((\S+), vec4<f32>\(\)\)$/.exec(V)
            const at = l => l.replace(/\bsl\.m\b/g, M).replace(/\bsl\.f\b/g, F).replace(/\bsl\.v\[(\d)\]\.xyz/g, (m, c) => inner ? `${inner[1]}.xyz` : `${V}[${c}].xyz`)
            if (body.length === 1) out.push(`    if (${M}[1].w > 0.5) { ${at(body[0].trim())} }`)
            else out.push(`    if (${M}[1].w > 0.5) {`, ...body.map(at), '    }')
        })
    }
    return out.join('\n')
}

//----------------------------------------------------------------------------------------------
// THE SNIPPET IS EMITTED VERBATIM. Everything else rests on this: if the generator rewrites
// the user's text, the line it quotes back is not the line they wrote, and locating a snippet
// by substring search -- which is how the old remapper worked -- cannot work at all.
//----------------------------------------------------------------------------------------------
const snippet = [
    '// set the radius first',        // a comment mentioning a parameter name
    'let q = p - centre;',            // a bare parameter
    'C = add_new(C, Nsphere(q, radius), MATERIAL);',
].join('\n')

const built = generate([
    { id: 'n1', type: 'code', code: snippet, params: { radius: 2.0, centre: { x: 1, y: 0, z: 0 } } },
])

for (const line of snippet.split('\n'))
    ok(`verbatim: ${JSON.stringify(line.slice(0, 28))}`,
        built.body.split('\n').some(l => l.trim() === line.trim()),
        'not found in generated source')

ok('the comment is NOT namespaced',
    built.body.includes('// set the radius first'),
    'the old builder rewrote parameter names inside comments')
ok('parameters reach the snippet by alias, not rewriting',
    built.body.includes('let radius = UB.radius_n1;'), built.body)
ok('MATERIAL is an alias too -- the default material, for a node with none', built.body.includes('let MATERIAL = MATID_DEFAULT;'))

//----------------------------------------------------------------------------------------------
// The map points at the user's line, counting from 1 within their snippet.
//----------------------------------------------------------------------------------------------
const lineOf = text => built.body.split('\n').findIndex(l => l.trim() === text.trim()) + 1
eq('first snippet line maps to n1:1', resolve(built.map, lineOf('// set the radius first')),
    { node: 'n1', line: 1 })
eq('third snippet line maps to n1:3',
    resolve(built.map, lineOf('C = add_new(C, Nsphere(q, radius), MATERIAL);')),
    { node: 'n1', line: 3 })
eq('the alias line is the generator\'s, not the user\'s',
    resolve(built.map, lineOf('let radius = UB.radius_n1;')), null)
eq('the function header is the generator\'s',
    resolve(built.map, lineOf('fn SDF(r: Ray) -> Hit {')), null)

// and an error on it reads the way a person needs it to
const [msg] = mapMessages(built.map,
    [{ type: 'error', message: "unresolved identifier 'q'", lineNum: lineOf('let q = p - centre;'), linePos: 5 }],
    built.body)
eq('a driver error becomes node + line', [msg.node, msg.line], ['n1', 2])
eq('and quotes what the user actually wrote', msg.text.trim(), 'let q = p - centre;')

//----------------------------------------------------------------------------------------------
// Two nodes, same parameter name: namespaced in the struct, bare in both snippets.
//----------------------------------------------------------------------------------------------
const two = generate([
    shape('sphere', { id: 'a', params: { radius: 1 } }),
    shape('sphere', { id: 'b', params: { radius: 3 } }),
])
ok('both radii exist separately',
    'radius_a' in two.uniforms && 'radius_b' in two.uniforms, Object.keys(two.uniforms).join(', '))
eq('and keep their own defaults', [two.uniforms.radius_a.def, two.uniforms.radius_b.def], [1, 3])
ok('each node aliases its own',
    two.body.includes('let radius = UB.radius_a;') && two.body.includes('let radius = UB.radius_b;'))
eq('the blocks keep them apart', two.body.split('{').length > 2, true)

//----------------------------------------------------------------------------------------------
// Disabled means not emitted -- and contributes no uniforms either. The old builder applied
// the same filter in both places and that consistency is worth keeping: a declared uniform
// with nothing reading it is a warning at best and a wrong binding at worst.
//----------------------------------------------------------------------------------------------
const off = generate([
    shape('sphere', { id: 'on' }),
    shape('sphere', { id: 'gone', enabled: false }),
])
ok('disabled node emits no code', !off.body.includes('UB.radius_gone'), 'leaked into the source')
ok('disabled node declares no uniforms', !('radius_gone' in off.uniforms),
    Object.keys(off.uniforms).join(', '))
ok('enabled sibling is unaffected', 'radius_on' in off.uniforms)

//----------------------------------------------------------------------------------------------
// Type inference, including the ordering bug the old one had: the type came from the SORTED
// keys and the payload from insertion order, so {z,y,x} was typed vec3 and uploaded (z,y,x).
//----------------------------------------------------------------------------------------------
eq('number -> f32', wgslTypeOf(1.5), 'f32')
eq('bool -> u32', wgslTypeOf(true), 'u32')
eq('{x,y} -> vec2', wgslTypeOf({ x: 1, y: 2 }), 'vec2<f32>')
eq('{x,y,z} -> vec3', wgslTypeOf({ x: 1, y: 2, z: 3 }), 'vec3<f32>')
eq('{r,g,b} -> vec3', wgslTypeOf({ r: 1, g: 2, b: 3 }), 'vec3<f32>')
eq('{r,g,b,a} -> vec4', wgslTypeOf({ r: 1, g: 2, b: 3, a: 4 }), 'vec4<f32>')
eq('scrambled keys still infer vec3', wgslTypeOf({ z: 3, y: 2, x: 1 }), 'vec3<f32>')

/* The default stays an OBJECT -- the property table edits {x,y,z} and has no controller for
   an array -- but rebuilt in canonical order, so a scrambled literal is fixed here rather
   than uploaded (z,y,x). uniformToGPU turns it into an array on the way to the GPU. */
const scrambled = generate([{ id: 's', type: 'code', params: { v: { z: 3, y: 2, x: 1 } } }])
eq('the default keeps the GUI shape', scrambled.uniforms.v_s.def, { x: 1, y: 2, z: 3 })
eq('in canonical order, not insertion order',
    Object.keys(scrambled.uniforms.v_s.def), ['x', 'y', 'z'])
eq('and reaches the GPU as an array', uniformToGPU(scrambled.uniforms.v_s.def, 'vec3<f32>'), [1, 2, 3])
eq('rgb too', uniformToGPU({ r: 1, g: 2, b: 3 }, 'vec3<f32>'), [1, 2, 3])
eq('scalars pass through', uniformToGPU(0.5, 'f32'), 0.5)
eq('arrays pass through', uniformToGPU([1, 2], 'vec2<f32>'), [1, 2])

//----------------------------------------------------------------------------------------------
// THE PROBE MUST CARRY THE ENGINE PRELUDE. This is the assertion that was missing, and its
// absence shipped: the first real run came back `unresolved type 'Hit'` at a line inside
// SCENE_COMMON, because the probe was SCENE_COMMON + the SDF with no DEFINITIONS in front of
// it. validate.js's header claimed the probe used the same prelude as prog_march. It did not.
//
// prog_march compiles `${SCENE_PRELUDE}${constants}${scene.wgsl}`, and SCENE_PRELUDE is
// PRIMITIVES, DEFINITIONS, MATERIALS and SCENE_API, so these check the same pieces are
// present, in that order, ending with the scene.
//----------------------------------------------------------------------------------------------
// The prelude strings themselves, not markers inside them: this asserts the probe carries
// the same text the kernel does, so it cannot pass by containing something that merely looks
// like DEFINITIONS.
ok('probe carries PRIMITIVES verbatim', built.body.includes(PRIMITIVES), 'PRIMITIVES missing')
ok('probe carries DEFINITIONS verbatim', built.body.includes(DEFINITIONS), 'DEFINITIONS missing')
ok('probe carries MATERIALS verbatim', built.body.includes(MATERIALS), 'MATERIALS missing')
ok('probe carries NOISE verbatim', built.body.includes(NOISE), 'NOISE missing')
ok('probe carries SCENE_API verbatim', built.body.includes(SCENE_API), 'SCENE_API missing')

const order = [PRIMITIVES, DEFINITIONS, NOISE, MATERIALS, SCENE_API, 'fn getMaterial2('].map(t => built.body.indexOf(t))
ok('and in prog_march\'s order', order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])),
    JSON.stringify(order))
ok('SDF comes last', built.body.indexOf('fn SDF(r: Ray)') > order[order.length - 1])

//----------------------------------------------------------------------------------------------
// The scene contract half is the generated materials onwards -- what the hand-written scenes put in
// `wgsl` -- because the kernels prepend the engine prelude themselves and must not see it
// twice.
//----------------------------------------------------------------------------------------------
ok('scene wgsl carries its own getMaterial2', built.wgsl.includes('fn getMaterial2'),
    'the kernels have no getMaterial2 of their own; stripping it breaks setScene')
ok('scene wgsl does NOT redeclare add_new', !built.wgsl.includes('fn add_new'),
    'add_new is in SCENE_API, which the kernel prepends; a second one is a redefinition error')
ok('scene wgsl does NOT repeat the engine prelude', !built.wgsl.includes('struct Ray'),
    'the kernel prepends DEFINITIONS; declaring it twice is a redefinition error')
ok('scene wgsl defines SDF', built.wgsl.includes('fn SDF(r: Ray) -> Hit'))
ok('body ends with exactly the scene wgsl', built.body.endsWith(built.wgsl))

ok('and none of scenes/common.js\'s override uniforms', !('matColorR' in built.uniforms),
    'a builder scene declares exactly its own materials')

//----------------------------------------------------------------------------------------------
// MATERIALS: a switch case each, every field a uniform, code mapped back to the material, and
// the local point tracked only when some material's code reads p_local.
//----------------------------------------------------------------------------------------------
{
    const d = Model.createDoc()
    const glass = Model.addMaterial(d, { id: 'glass', preset: 'glass' })
    Model.addMaterial(d, { id: 'dots', preset: 'plastic', code: 'm.roughness = fract(p.x);\nm.baseColor = VEC3(bogus);' })
    Model.addObject(d, 'root', { id: 'ball', material: 'glass' })
    const g = generate(Model.toTree(d))
    ok('each material is a case', /case 2u: \{\s+\/\/ material glass/.test(g.wgsl) && /case 3u: \{\s+\/\/ material dots/.test(g.wgsl))
    ok('an object refers to its material by constant', g.body.includes('let MATERIAL = matid_glass;'))
    eq('every field is a uniform with the material\'s value', [g.uniforms.ior_glass?.def, g.uniforms.transmission_glass?.def], [1.5, 1])
    eq('a colour is a vec3 uniform', g.uniforms.baseColor_glass?.type, 'vec3<f32>')
    ok('a surface assigns no emission (model version 10: emission is an emitter\'s)', !g.wgsl.includes('m.emissive = UB.emissive_glass'))
    ok('...but declares it, so switching the type loses nothing', 'emissiveLuminance_glass' in g.uniforms)
    Model.addMaterial(d, { id: 'lamp', preset: 'emissive' })
    const gl = generate(Model.toTree(d))
    ok('an emitter\'s emission is a normalised hue times a luminance',
        gl.wgsl.includes('m.emissive = UB.emissive_lamp / max(dot(UB.emissive_lamp, LUMA_709), 1e-6) * UB.emissiveLuminance_lamp;'))
    ok('...and it assigns nothing else', !gl.wgsl.includes('m.roughness = UB.roughness_lamp'))
    const at = g.body.split('\n').findIndex(l => l === 'm.baseColor = VEC3(bogus);') + 1
    eq('material code maps back to the material and its own line', resolve(g.map, at), { node: 'dots', line: 2 })
    ok('no local-point tracking when no material reads p_local', !g.wgsl.includes('XF_P') && !g.wgsl.includes('localPoint'))

    // the template mentions p_local in a comment; that must neither emit a block nor buy an SDF call
    const tmpl = generate(Model.toTree(d))
    // 'glass' was created with the default code: the template, comments only
    ok('the new-material template is comments only', glass.code.includes('p_local') && !codeOnly(glass.code).trim())
    const glassCase = tmpl.wgsl.slice(tmpl.wgsl.indexOf('// material glass'), tmpl.wgsl.indexOf('return m;', tmpl.wgsl.indexOf('// material glass')))
    ok('a comment-only template emits no code block', !glassCase.includes('Material code'), glassCase)
    ok('and a p_local in a comment does not switch on local points', !tmpl.wgsl.includes('localPoint(C.r)') && !tmpl.wgsl.includes('XF_P'))

    Model.addMaterial(d, { id: 'fixed', code: 'm.baseColor = fract(p_local);' })
    Model.addGroup(d, 'root', { id: 'grp' })
    Model.addObject(d, 'grp', { id: 'box', material: 'fixed' })
    const g2 = generate(Model.toTree(d))
    // once, before the switch, for the materials that read it, and never on the medium lookup
    const fixedId = g2.wgsl.match(/const matid_fixed: u32 = (\d+)u;/)?.[1]
    ok('p_local is captured once, for the material that reads it, not on the medium lookup',
        new RegExp(`if \\(!checkInside && \\(idx == ${fixedId}u\\)\\) \\{\\s+p_local = localPoint\\(C\\.r\\); R_local = HIT_FRAME; S_local = HIT_SCALE;`).test(g2.wgsl))
    ok('...and the material code reads it', /\{\s+m\.baseColor = fract\(p_local\);/.test(g2.wgsl))
    ok('one call to localPoint in all of getMaterial2', (g2.wgsl.match(/localPoint\(C\.r\)/g) || []).length === 1)
    {
        // a grain reads only R_local: the frame is the same capture's, so it must switch it on too
        const dg = Model.createDoc()
        Model.addMaterial(dg, { id: 'brushed', code: 'm.tangent = grainAlong(R_local, VEC3(1.0, 0.0, 0.0));' })
        Model.addObject(dg, 'root', { id: 'plate', material: 'brushed' })
        const gg = generate(Model.toTree(dg))
        ok('R_local alone switches on the local capture', gg.wgsl.includes('R_local = HIT_FRAME;') && gg.wgsl.includes('XF_P = p;'))
    }
    const sets = (g2.wgsl.match(/XF_P = p;/g) || []).length, restores = (g2.wgsl.match(/XF_P = xfp_\w+;/g) || []).length
    // SDF start, then grp, box, ball: every frame entered records its point and restores it
    ok('every frame entered records its point and gives it back', sets === 4 && restores === 3, `${sets} set, ${restores} restored`)
}

//----------------------------------------------------------------------------------------------
// THE LINE A COMPILER REPORTS MUST LAND ON THE LINE THE USER WROTE, through what tinywebgpu
// actually does to the source. This is the test that was missing: validate() measured the
// body's offset by searching for its first line, which was BLANK and so matched at 0, and
// makeCompute trims its source, which stripped those blank lines as well. Errors came back as
// "generated line 1126" instead of "slab:3". Nothing here ran the source through anything
// shaped like makeCompute, so nothing could see it.
//
// The composition below mirrors tinywebgpu.js: makeCompute builds
//   `${body}\n@compute ... {\n${main}\n}\n`.trim()
// and makePipeline prepends `${schema.wgsl}\n`. If either changes, change this with it.
//----------------------------------------------------------------------------------------------
{
    const nodes = [
        shape('sphere', { id: 'first' }),
        { id: 'slab', type: 'code', params: { bevel: 0.1 },
          code: '// comment\nlet q = p;\nC = add_new(C, sdRoundedBox(q, VEC3(1.0), bevell), MATERIAL);' },
    ]
    const g = generate(nodes)
    eq('the probe body starts with the marker', g.body.split('\n')[0], BODY_MARKER)

    const schema = 'struct UB_t { a: f32, }\n@group(0) @binding(0) var<uniform> UB: UB_t;\n// three schema lines'
    const code = `${g.body}\n@compute @workgroup_size(1,1,1)\nfn main() {\nMAIN\n}\n`.trim()
    const final = `${schema}\n${code}`

    const offset = lineOffsetOf(g.body, final)
    eq('the offset is the schema length, measured', offset, schema.split('\n').length)

    // the compiler reports the typo at its line in FINAL, 1-based
    const at = final.split('\n').findIndex(l => l.includes('bevell')) + 1
    const r = finish(g.map, [{ type: 'error', message: "unresolved identifier 'bevell'", lineNum: at, linePos: 40 }], final, offset)
    eq('and it is attributed to the node and line the user wrote', [r.messages[0].node, r.messages[0].line], ['slab', 3])

    ok('a blank first line is refused rather than matched anywhere', lineOffsetOf('\nx', 'a\n\nx') === null)
    ok('a first line that appears twice is refused', lineOffsetOf('dup\nx', 'dup\ny\ndup\nx') === null)
}

//----------------------------------------------------------------------------------------------
// TREES: transforms and CSG groups. What can be checked without a compiler is the bookkeeping --
// names, uniforms, balance -- and that the user's lines still map to the user.
//----------------------------------------------------------------------------------------------
{
    const d = Model.createDoc()
    Model.addGroup(d, 'root', { id: 'cut', blend: 0.1,
        transform: { pos: { x: 1, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 45 }, scale: 2 } })
    Model.addObject(d, 'cut', { id: 'base', primitive: 'sphere' })
    Model.addObject(d, 'cut', { id: 'hole', type: 'code', join: 'subtract', params: { size: 0.5 },
        code: 'let p = p * 1.0;\nC = add_new(C, sdBox(p, VEC3(size)), MATERIAL);' })
    Model.addGroup(d, 'root', { id: 'plain' })
    Model.addObject(d, 'plain', { id: 'lone' })
    const g = generate(Model.toTree(d))

    eq('the transform uniform is xf_<id>', xfName('cut'), 'xf_cut')
    eq('and is a mat4 carrying matrixOf', [g.uniforms.xf_cut?.type, g.uniforms.xf_cut?.def],
        ['mat4x4<f32>', Model.matrixOf(d.root.children[0].transform)])
    ok('every node gets one, objects included', ['base', 'hole', 'plain', 'lone'].every(id => xfName(id) in g.uniforms))
    ok('a CSG group gets a blend uniform', blendName('cut') in g.uniforms && g.uniforms.blend_cut.def === 0.1)
    ok('a plain union does not', !(blendName('plain') in g.uniforms))
    ok('the CSG op is emitted', /k_cut = csgSubtract\(k_cut, C\.s, UB\.blend_cut\);/.test(g.wgsl))
    eq('and its result folds into the scene exactly once', (g.wgsl.match(/C = fold\(C, k_cut, km_cut\);/g) || []).length, 1)

    const pushes = (g.wgsl.match(/XF_M = XF_M \* xfRot/g) || []).length
    const pops = (g.wgsl.match(/XF_M = xfm_\w+; XF_S = xfs_\w+;/g) || []).length
    ok('every transform entered is left', pushes === 5 && pops === 5, `${pushes} in, ${pops} out`)

    // the snippet is flush left, so a compiler's column is the column the user typed
    const at = g.body.split('\n').findIndex(l => l === 'C = add_new(C, sdBox(p, VEC3(size)), MATERIAL);') + 1
    ok('the snippet is emitted unindented', at > 0)
    eq('and a line of it still maps to the user', resolve(g.map, at), { node: 'hole', line: 2 })

    // a smooth union goes the CSG way; a hard one does not
    const d2 = Model.createDoc()
    Model.addGroup(d2, 'root', { id: 'blob', blend: 0.3 })
    Model.addObject(d2, 'blob', { id: 's1' }); Model.addObject(d2, 'blob', { id: 's2' })
    const g2 = generate(Model.toTree(d2))
    ok('a union with a blend is a smooth CSG union', /csgUnion\(k_blob, C\.s, UB\.blend_blob\)/.test(g2.wgsl))
    ok('which takes the nearer child\'s material', /km_blob = select\(km_blob, C\.m, C\.s\.w < k_blob\.w\);/.test(g2.wgsl))

    /* A LIGHT IN A CSG GROUP IS NOT ONE OF ITS SHAPES. When it was not drawn there, as a child of the combine it
       was an empty Hit -- and as the base, the thing everything else is cut from, it emptied the whole group. It
       is left out of the combine, as an export box is: the base is the first shape. (Since 2026-10-03 it is
       drawn, after the combine: the block below this one.) */
    for (const live of [false, true]) {
        const d3 = Model.createDoc()
        Model.addGroup(d3, 'root', { id: 'cut' })
        Model.addLight(d3, 'cut', { id: 'lamp', shape: 'rectangle' })
        Model.addObject(d3, 'cut', { id: 'b', primitive: 'box' })
        Model.addObject(d3, 'cut', { id: 's', primitive: 'sphere', join: 'subtract' })
        const g3 = generate(Model.toTree(d3, { keepDisabled: live }), { liveVisibility: live })
        const how = live ? ' (live visibility)' : ''
        eq(`a light is not a shape of its CSG group: two children combined, not three${how}`,
            (g3.wgsl.match(/var C = emptyHit\(r\);\s+\/\/ this child alone/g) || []).length, 2)
        const w = g3.wgsl, base = live ? /if \(first_cut\) \{ k_cut = C\.s;/ : /k_cut = C\.s; km_cut = C\.m;/
        const at = w.search(base)
        ok(`...the base is the box, the first shape${how}`, at > w.indexOf('// node b (') && at < w.indexOf('// node s ('))
        ok(`...and the light's uniforms are still declared${how}`, ['xf_lamp', 'width_lamp', ...(live ? ['vis_lamp'] : [])].every(k => k in g3.uniforms))
    }
    /* A JOIN PER CHILD (model version 14): each child meets what is above it by its own op, with its own blend or
       the group's -- so "a, b, less c, within d, less the inner pair" is one group */
    {
        const d5 = Model.createDoc()
        Model.addGroup(d5, 'root', { id: 'g', blend: 0.02 })
        Model.addObject(d5, 'g', { id: 'a', primitive: 'box' })
        Model.addObject(d5, 'g', { id: 'b', primitive: 'sphere' })
        Model.addObject(d5, 'g', { id: 'c', primitive: 'cylinder', join: 'subtract', joinBlend: 0.05 })
        Model.addObject(d5, 'g', { id: 'd', primitive: 'torus', join: 'intersect' })
        Model.addGroup(d5, 'g', { id: 'inner', blend: 0.1, join: 'subtract', joinBlend: 0.03 })
        Model.addObject(d5, 'inner', { id: 'x' }); Model.addObject(d5, 'inner', { id: 'y' })
        const g5 = generate(Model.toTree(d5)), w = g5.wgsl
        const combines = [...w.matchAll(/k_g = (csg\w+)\(k_g, C\.s, UB\.(\w+)\);/g)].map(m => `${m[1]} ${m[2]}`)
        eq('each child combined by its own join, with its own blend or the group\'s, in order', combines,
            ['csgUnion blend_g', 'csgSubtract jblend_c', 'csgIntersect blend_g', 'csgSubtract jblend_inner'])
        /* the material of whichever shape makes the surface: a union's nearer, a subtraction's cutter where it carves,
           an intersection's farther -- each picked just before its combine, by its csg* function's own test. Only
           a union switched before 0.57.2, and the die's pips in combining-shapes came out the die's white. */
        eq('each child after the base picks the material by its join\'s test, just before its combine',
            [...w.matchAll(/km_g = select\(km_g, C\.m, (-?C\.s\.w [<>] k_g\.w)\);\s+k_g = (csg\w+)\(k_g/g)].map(m => `${m[2]} ${m[1]}`),
            ['csgUnion C.s.w < k_g.w', 'csgSubtract -C.s.w > k_g.w', 'csgIntersect C.s.w > k_g.w', 'csgSubtract -C.s.w > k_g.w'])
        eq('an own blend is a uniform of its own, declared with its value; a child without one has none',
            [g5.uniforms.jblend_c?.def, g5.uniforms.jblend_inner?.def, 'jblend_b' in g5.uniforms], [0.05, 0.03, false])
        ok('a CSG child that is a CSG group has both: its own children\'s blend, and its join\'s',
            g5.uniforms.blend_inner?.def === 0.1 && /k_inner = csgUnion\(k_inner, C\.s, UB\.blend_inner\);/.test(w))
        ok('the comment says the joins differ', w.includes('// group g (mixed, smooth)'))
        Model.setJoin(d5, 'a', 'subtract')
        eq('the base\'s own join is dormant: the shader is the same', generate(Model.toTree(d5)).wgsl, w)
        const L5 = generate(Model.toTree(d5, { keepDisabled: true }), { liveVisibility: true }).wgsl
        eq('live: every child after the base in its own else, by its own join', [...L5.matchAll(/\} else \{\s+(?:km_g = select[^\n]*\s+)?k_g = (csg\w+)/g)].map(m => m[1]),
            ['csgUnion', 'csgUnion', 'csgSubtract', 'csgIntersect', 'csgSubtract'])
    }
    /* A LIMITER STAYS ONE, DELIBERATELY: the picture leaves it out as an EMPTY shape, not an absent one. A
       limiter plate with a hole cut from it is a limiter aperture: the group takes the plate's material, so
       the picture must show none of it -- which an empty base gives. Left out instead, the hole's cylinder
       would become the base and be drawn. The optics copy has the plate. */
    {
        const d4 = Model.createDoc()
        const lim = Model.addMaterial(d4, { id: 'lim', preset: 'diffuse' }); Model.setMaterialType(d4, lim.id, 'limiter')
        Model.addGroup(d4, 'root', { id: 'ap' })
        Model.addObject(d4, 'ap', { id: 'plate', primitive: 'box', material: 'lim' })
        Model.addObject(d4, 'ap', { id: 'hole', primitive: 'cylinder', join: 'subtract' })
        const g4 = generate(Model.toTree(d4))
        const render = g4.wgsl.slice(g4.wgsl.indexOf('fn SDF('))
        ok('a limiter base is an empty shape in the picture: its block draws nothing, then the base is taken',
            /node plate \(code\): an optics limiter, not in the picture[\s\S]*?k_ap = C\.s; km_ap = C\.m;/.test(render))
        ok('...and the optics copy draws it', /NboxRounded/.test(g4.opticsWgsl.slice(g4.opticsWgsl.indexOf('fn SDF('))))
    }
}

//----------------------------------------------------------------------------------------------
// THE PRIMITIVE LIBRARY (primitives.js): every entry's code calls a function sdf.js declares, and
// no parameter is named after a WGSL builtin -- a parameter is a `let`, and one called `length`
// would hide length(). Whether each one COMPILES is check-shaders' pass four, which builds them all.
//----------------------------------------------------------------------------------------------
{
    const BUILTINS = ['length', 'min', 'max', 'abs', 'mix', 'round', 'dot', 'cross', 'normalize', 'clamp', 'sign', 'step', 'select']
    for (const [key, def] of Object.entries(LIBRARY)) {
        const fn = (codeOnly(def.code).match(/add_new\(C, (\w+)\(/) || [])[1]
        /* extrude, revolve and profile are written per scene when it has a profile (codegen.js), tube when it has a
           path, sweep when it has both: an entry calling one needs those of its own to call it with */
        const vals = Object.values(def.params || {})
        const needs = { extrude: [isProfile], revolve: [isProfile], profile: [isProfile], tube: [isPath], sweep: [isPath, isProfile] }[fn]
        ok(`${key}: its code calls a declared SDF function (${fn})`, fn && (needs ? needs.every(is => vals.some(is)) : new RegExp(`fn ${fn}\\s*\\(`).test(PRIMITIVES)))
        const bad = Object.keys(def.params || {}).filter(k => BUILTINS.includes(k))
        ok(`${key}: no parameter shadows a builtin`, !bad.length, bad.join(', '))
        const unranged = Object.keys(def.ranges || {}).filter(k => typeof def.params[k] !== 'number')
        ok(`${key}: ranges only for numbers`, !unranged.length, unranged.join(', '))
        ok(`${key}: in a group the menu and the library know`, SHAPE_GROUPS.some(g => g.key === def.group), String(def.group))
    }
    eq('code is the only kind of shape; a light, an export box and a haze box are the other object types (their shapes have to stay known)',
        Object.keys(NODE_TYPES).sort(), ['code', 'export', 'haze', 'light'])

    /* A NEW PRIMITIVE AND A VERSION 8 NODE OF THE SAME TYPE COMPILE ALIKE. The upgrade gives an old
       file the code its type emitted (model.js v8to9); the library is where new ones start. Apart
       from the library's comment they are the same shader -- so nothing a user had changes when it
       is loaded, and nothing is slower for being code. If a library entry is deliberately changed,
       this is the row that says an old file now means something else than a new one; that is
       allowed, but it should be a decision.
       ONLY THE SHAPES THAT WERE TYPES: version 8's seven and the optics branch's three sheets (model.js
       V8_TYPES, BRANCH_SHEETS, both frozen). A shape added since never had a type for a file to hold --
       building one as `type: 'round cone'` is refused as unknown, rightly. */
    const WERE_TYPES = ['sphere', 'box', 'cylinder', 'capsule', 'torus', 'cone', 'plane', 'lens', 'rectangle', 'disc']
    ok('every shape that was a type is still in the library', WERE_TYPES.every(k => k in LIBRARY), WERE_TYPES.filter(k => !(k in LIBRARY)).join(', '))
    const v8 = (key, params = {}) => {
        const d = Model.createDoc()
        d.version = 8
        d.root.children.push({ id: 'n1', kind: 'object', type: key, label: key, enabled: true,
            transform: Model.identity(), material: null, params })
        return Model.parse(JSON.stringify(d))
    }
    /* THE LIBRARY'S SIZES CHANGED, DELIBERATELY (2026-10-02, every + shape fits a 1-unit cube: primitives.js SIZES):
       the sphere, capsule, torus and cone start smaller than their types did. So the shader and its uniforms are
       held to a v8 node GIVEN the library's parameters -- the same code, whatever the numbers -- and the decision
       is the row after: an old file that left its parameters out keeps the size its type had (V8_TYPES, frozen). */
    const RESIZED = { sphere: { radius: 1 }, capsule: { radius: 0.3, height: 1 }, torus: { ring: 0.8, tube: 0.2 },
                      cone: { base: 0.6, top: 0, height: 1.2 } }
    for (const key of WERE_TYPES) {
        const fresh = Model.createDoc()
        Model.addObject(fresh, 'root', { id: 'n1', primitive: key })
        const a = generate(Model.toTree(fresh)), b = generate(Model.toTree(v8(key, structuredClone(LIBRARY[key].params))))
        const strip = s => s.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')
        ok(`${key}: a new one and an upgraded v8 one are the same shader but for comments`,
            strip(a.wgsl) === strip(b.wgsl) && strip(a.pickWgsl) === strip(b.pickWgsl))
        eq(`${key}: ... with the same uniforms`, a.uniforms, b.uniforms)
        const old = Model.find(v8(key), 'n1').node.params
        if (RESIZED[key]) eq(`${key}: an old file with no parameters keeps its type's size, not the library's new one`, old, RESIZED[key])
        else eq(`${key}: the library's size is still its type's`, old, LIBRARY[key].params)
    }
}

//----------------------------------------------------------------------------------------------
// COMPILE-TIME PARAMETERS AND THE FUNCTIONS BLOCK
//----------------------------------------------------------------------------------------------
{
    const d = Model.createDoc()
    d.functions = 'fn twice(x: f32) -> f32 {\n    return 2.0 * x;\n}\nfn broken() -> f32 { return bogus; }'
    Model.addObject(d, 'root', { id: 'sponge', type: 'code', params: { iterations: 3, k: 2, size: 1.5 },
        constants: { iterations: 'u32', k: 'f32' },
        code: 'C = add_new(C, Nmenger(p / twice(size), iterations), MATERIAL);' })
    const g = generate(Model.toTree(d))
    ok('a u32 constant is a const with a u32 literal', g.body.includes('const iterations: u32 = 3u;'))
    ok('an f32 constant always carries a point', g.body.includes('const k: f32 = 2.0;'))
    ok('a constant is not a uniform', !('iterations_sponge' in g.uniforms) && !('k_sponge' in g.uniforms))
    ok('a live parameter still is', 'size_sponge' in g.uniforms && g.body.includes('let size = UB.size_sponge;'))
    ok('the functions block comes before the materials and the SDF',
        g.body.indexOf('fn twice(') > 0 && g.body.indexOf('fn twice(') < g.body.indexOf('fn getMaterial2(') )
    const at = g.body.split('\n').findIndex(l => l.includes('return bogus;')) + 1
    eq('an error in it maps to the functions block, at its own line', resolve(g.map, at), { node: 'functions', line: 4 })
    const blank = Model.createDoc()
    ok('a functions block of comments emits nothing', !generate(Model.toTree(blank)).map.spans.some(s => s.node === 'functions'))
    eq('literals: u32 rounds and clamps, i32 rounds, f32 keeps its point', [wgslLiteral(2.6, 'u32'), wgslLiteral(-1, 'u32'), wgslLiteral(-2.4, 'i32'), wgslLiteral(3, 'f32'), wgslLiteral(0.25, 'f32'), wgslLiteral(1e-7, 'f32')],
        ['3u', '0u', '-2i', '3.0', '0.25', '1e-7'])
}

//----------------------------------------------------------------------------------------------
eq('aliasPrelude with no material', aliasPrelude('x', { a: 1 }, null), ['let a = UB.a_x;'])
eq('uniformName', uniformName('n7', 'radius'), 'radius_n7')

//----------------------------------------------------------------------------------------------
// A material's own parameters: uniforms under its id, aliased for its code, consts when compile-time
//----------------------------------------------------------------------------------------------
{
    const d = Model.createDoc()
    Model.addMaterial(d, { id: 'mt', code: 'm.baseColor = mix(m.baseColor, stripe, step(fract(p.x / width), 0.5 * f32(k)));' })
    Model.addParam(d, 'mt', 'stripe', { r: 1, g: 0, b: 0 })
    Model.addParam(d, 'mt', 'width', 0.5)
    Model.addParam(d, 'mt', 'k', 2)
    Model.setConstant(d, 'mt', 'k', 'u32')
    Model.addObject(d, 'root', { id: 'o', material: 'mt' })
    const s = generate(Model.toTree(d))
    eq('its live parameters are uniforms, the constant is not',
        [s.uniforms.stripe_mt?.type, s.uniforms.width_mt?.type, 'k_mt' in s.uniforms], ['vec3<f32>', 'f32', false])
    ok('aliased before its code', /let stripe = UB\.stripe_mt;\s*let width = UB\.width_mt;\s*const k: u32 = 2u;\s*m\.baseColor/.test(s.wgsl), s.wgsl)
    Model.addMaterial(d, { id: 'bare', code: '' })
    Model.addParam(d, 'bare', 'unused', 1)
    const t = generate(Model.toTree(d))
    ok('declared even with no code to read it, so a live edit has a uniform to reach', 'unused_bare' in t.uniforms)
    ok('but no alias is emitted where there is no code', !/let unused/.test(t.wgsl))
}


//----------------------------------------------------------------------------------------------
// A GROUP'S CODE. The children become a function the code calls; the one rename codegen makes to
// what was typed is `children(` to that function's name, and nothing else may change.
//----------------------------------------------------------------------------------------------
{
    const r = renameChildren([
        '// children(C, p) in a comment stays',
        'C = children(C, p); /* children( */ C = children (C, p * 2.0);',
        'let n = x.children(C);   let children = 1.0; let q = mychildren(C);',
        '/* nested /* children( */ still a comment: children( */',
    ].join('\n'), 'g7')
    eq('only the calls are renamed -- not comments, member access, a bare word or a longer name', r.text.split('\n'), [
        '// children(C, p) in a comment stays',
        'C = children_g7(C, p); /* children( */ C = children_g7 (C, p * 2.0);',
        'let n = x.children(C);   let children = 1.0; let q = mychildren(C);',
        '/* nested /* children( */ still a comment: children( */',
    ])
    eq('and where the text grew is recorded, per line, in emitted columns', r.shifts,
        { 1: [{ at: 12, by: 3 }, { at: 51, by: 3 }] })
    eq('an error after both renames is reported at the column typed', typedColumn(62, r.shifts[1]), 56)
    eq('one inside an inserted name, at the name', typedColumn(14, r.shifts[1]), 13)
    eq('one before any, unchanged', typedColumn(5, r.shifts[1]), 5)
}
{
    // a group whose code is only comments has none: the shader is what it was before group code
    const plain = Model.createDoc(), commented = Model.createDoc()
    for (const d of [plain, commented]) {
        Model.addGroup(d, 'root', { id: 'g', blend: 0.2 })
        Model.addObject(d, 'g', { id: 'a' }); Model.addObject(d, 'g', { id: 'b', join: 'subtract' })
    }
    Model.setCode(commented, 'g', GROUP_CODE_TEMPLATE)
    eq('comment-only group code changes nothing', generate(Model.toTree(commented)).wgsl, generate(Model.toTree(plain)).wgsl)

    const d = Model.createDoc()
    const code = 'p.x = abs(p.x);\nwarp(0.5);\nC = children(C, p);\nC = children(C, p + VEC3(0.0, 0.0, lift));'
    Model.addGroup(d, 'root', { id: 'm', code, params: { lift: 1.5 } })
    Model.addObject(d, 'm', { id: 's' })
    Model.addGroup(d, 'm', { id: 'in', code: 'C = children(C, p);' })
    Model.addObject(d, 'in', { id: 't' }); Model.addObject(d, 'in', { id: 'u', join: 'intersect' })
    const s = generate(Model.toTree(d))
    const w = s.wgsl
    ok('each coded group has a children function, before SDF',
        w.indexOf('fn children_m(C_in: Hit, p_in: VEC3) -> Hit {') >= 0 && w.indexOf('fn children_in(') >= 0
        && w.indexOf('fn children_in(') < w.indexOf('fn SDF('), w)
    ok("the nested group's call is inside its parent's function, not in SDF",
        (() => { const f = w.slice(w.indexOf('fn children_m('), w.indexOf('fn SDF(')); return /C = children_in\(C, p\);/.test(f) })(), w)
    ok('a CSG group keeps its op inside its function', /fn children_in\([\s\S]*csgIntersect[\s\S]*fn SDF/.test(w), w)
    ok("each child is emitted once: object s's block appears once", w.split('// node s (code)').length === 2)
    ok('the code gets p as a var, and its parameter by name', /var p = p;\s*let lift = UB\.lift_m;\s*p\.x = abs/.test(w), w)
    eq("the group's parameter is a live uniform", s.uniforms.lift_m, { type: 'f32', def: 1.5 })
    ok("warp() is undone when the group's block ends", /warp\(0\.5\);[\s\S]*XF_M = xfmc_m; XF_S = xfsc_m;/.test(w), w)
    const lines = s.body.split('\n'), at = lines.findIndex(l => l === 'C = children_m(C, p + VEC3(0.0, 0.0, lift));')
    eq('the code is mapped to the group, line for line', resolve(s.map, at + 1)?.line, 4)
    eq('with the column shift of its rename', resolve(s.map, at + 1)?.shifts, [{ at: 12, by: 2 }])
}

//----------------------------------------------------------------------------------------------
// PICKING: a tagged copy for the pick kernel, and the render copy untouched by it
//----------------------------------------------------------------------------------------------
{
    const { demoDoc } = await import('./demo-doc.mjs')
    const doc = demoDoc()
    // a disabled node, and a CSG group in a scene with no p_local material
    const off = Model.addObject(doc, 'root', { primitive: 'sphere', label: 'off' })
    Model.setEnabled(doc, off.id, false)
    const s = generate(Model.toTree(doc))
    const ids = []
    Model.walk(doc, n => { if (n !== doc.root) ids.push(n.id) })
    const enabled = ids.filter(id => id !== off.id)

    ok('the render copy sets no tags', !/XF_TAG/.test(s.wgsl))
    ok('the pick copy does', /XF_TAG/.test(s.pickWgsl))
    eq('every enabled node has one tag, the disabled one none', [...s.tags].sort(), [...enabled].sort())
    ok('tags are unique', new Set(s.tags).size === s.tags.length)
    s.tags.forEach((id, i) => ok(`tag ${i + 1} is entered in ${id}'s block`,
        s.pickWgsl.includes(`let xft_${id} = XF_TAG; XF_TAG = ${i + 1}u;`)))
    const enters = (s.pickWgsl.match(/let xft_\w+ = XF_TAG;/g) || []).length
    const leaves = (s.pickWgsl.match(/XF_TAG = xft_\w+;/g) || []).length
    ok('every tag entered is put back', enters === s.tags.length && leaves === enters, `${enters} in, ${leaves} out`)
    /* the tags are the ONLY difference: the pick copy with every tag line taken out is the render copy --
       the render copy without its culling, which the pick copy never has (the box measurement samples it) */
    const untagged = s.pickWgsl.split('\n').filter(l => !/XF_TAG/.test(l)).join('\n')
    ok('the pick copy is the (unculled) render copy plus its tag lines, and nothing else',
        untagged === generate(Model.toTree(doc), { cull: false }).wgsl)
    // (that the tagged copy compiles against the render copy's uniforms is check-shaders' pick row)
    const a = generate(Model.toTree(doc)), b = generate(Model.toTree(doc))
    ok('the tagged copy is deterministic', a.pickWgsl === b.pickWgsl && JSON.stringify(a.tags) === JSON.stringify(b.tags))
}

//----------------------------------------------------------------------------------------------
// BOUNDING-BOX CULLING, EVERY BOX (cull 'all': the bench's alone since 0.34.0, which the builder makes with its boxes
// on the dear nodes only -- the section on those at the end): every top-level node of the render copy behind a test of
// its box; the pick copy (which the boxes are measured through) without; nothing else in the text changed
//----------------------------------------------------------------------------------------------
{
    const { demoDoc } = await import('./demo-doc.mjs')
    const doc = demoDoc()
    const g = Model.addGroup(doc, 'root', { label: 'cut', blend: 0.1 })
    Model.addObject(doc, g.id, { primitive: 'box', label: 'base' })
    Model.addObject(doc, g.id, { primitive: 'sphere', label: 'hole', join: 'subtract' })
    const x = Model.addExportBox(doc, 'root', { label: 'print' })
    const tree = Model.toTree(doc)
    const s = generate(tree, { cull: 'all' }), plain = generate(tree, { cull: false })
    const top = tree.children.filter(n => n.type !== 'export')
    const tested = [...s.wgsl.matchAll(/let bd_(\w+) = cullDist\(/g)].map(m => m[1])
    eq('one box test per top-level node that draws something, and no deeper', tested.sort(), top.map(n => n.id).sort())
    ok('...not for an export box (it draws nothing)', !tested.includes(x.id))
    ok('...a CSG group tested as a whole, its children not', tested.includes(g.id) && !g.children?.some?.(c => tested.includes(c.id)))
    ok('each tested node\'s box declared, unknown (lo.w 0) until measured', top.every(n =>
        s.uniforms[boxLoName(n.id)]?.type === 'vec4<f32>' && JSON.stringify(s.uniforms[boxLoName(n.id)].def) === '[0,0,0,0]'
        && s.uniforms[boxHiName(n.id)]?.type === 'vec4<f32>'))
    ok('the box is taken in the node\'s own frame, scaled back', top.every(n =>
        s.wgsl.includes(`cullDist(xfPoint(p, UB.${xfName(n.id)}), UB.${boxLoName(n.id)}, UB.${boxHiName(n.id)}) * UB.${xfName(n.id)}[3].w;`)))
    ok('the pick copy has no culling (the boxes are measured through it)', !/cullDist|CULL/.test(s.pickWgsl))
    ok('cull: false emits none', !/cullDist|CULL/.test(plain.wgsl) && !Object.keys(plain.uniforms).some(k => /^bx(lo|hi)_/.test(k)))
    ok('the skipped nodes\' bound is compared with |d|, once, at the end', (s.wgsl.match(/if \(CULL < abs\(C\.s\.w\)\) \{ C\.s\.w = CULL; \}/g) || []).length === 1
        && s.wgsl.indexOf('if (CULL < abs(C.s.w))') > s.wgsl.lastIndexOf('let bd_'))
    /* NOTHING ELSE CHANGED: the culled copy's lines, trimmed, are the plain copy's plus exactly the wrapper's --
       per tested node its three lines and two closing braces, and the CULL declaration and the comparison */
    const count = t => t.split('\n').map(l => l.trim()).reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map())
    const A = count(s.wgsl), B = count(plain.wgsl), extra = new Map()
    for (const [l, n] of A) if (n !== (B.get(l) || 0)) extra.set(l, n - (B.get(l) || 0))
    const gone = [...B].filter(([l, n]) => (A.get(l) || 0) < n)
    const wrapper = l => /^\{   \/\/ \w+: skipped while farther than its box$/.test(l) || /^let bd_\w+ = cullDist\(/.test(l)
        || /^if \(bd_\w+ > cullMargin\(\)\) \{ CULL = min\(CULL, bd_\w+\); \} else \{$/.test(l)
        || /^var CULL: FLOAT = 1\.0e7;/.test(l) || l === 'if (CULL < abs(C.s.w)) { C.s.w = CULL; }' || l === '}'
    ok('...nothing in the plain copy is missing from the culled one', gone.length === 0, JSON.stringify(gone.slice(0, 3)))
    ok('...and everything added is the wrapper', [...extra.keys()].every(wrapper), JSON.stringify([...extra.keys()].filter(l => !wrapper(l)).slice(0, 3)))
    ok('...with two closing braces per tested node', extra.get('}') === 2 * top.length, `${extra.get('}')} for ${top.length}`)
    // with live visibility the box test sits inside the node's visibility test
    const live = generate(tree, { liveVisibility: true, cull: 'all' })
    ok('live visibility: each box test inside its node\'s visibility test', top.every(n =>
        new RegExp(`if \\(UB\\.vis_${n.id} != 0u\\) \\{\\n\\s*\\{   // ${n.id}: skipped`).test(live.wgsl)))
}

//----------------------------------------------------------------------------------------------
// OPTICS AND LIGHT (model version 10): detectors and limiters by MATERIAL id; a limiter only in the
// optics copies; lights drawn as sheets with their own material, glowing for the camera's first look
//----------------------------------------------------------------------------------------------
{
    const at = z => ({ pos: { x: 0, y: 0, z }, rot: { x: 0, y: 0, z: 0 }, scale: 1 })
    const d = Model.createDoc()
    Model.addMaterial(d, { id: 'glass', preset: 'glass' })
    Model.addMaterial(d, { id: 'scr' })
    Model.addMaterial(d, { id: 'cut' })
    Model.addObject(d, 'root', { id: 'lens', primitive: 'lens', material: 'glass' })
    Model.addObject(d, 'root', { id: 'screen', primitive: 'disc', material: 'scr' })
    Model.addObject(d, 'root', { id: 'plane', primitive: 'rectangle', material: 'cut', transform: at(2) })
    const before = generate(Model.toTree(d))
    eq('no roles, no detectors', before.detectors, [])
    ok('no limiter: the optics copies are the render and pick copies',
        before.opticsWgsl === before.wgsl && before.opticsPickWgsl === before.pickWgsl)
    Model.setMaterialType(d, 'scr', 'detector')
    const g = generate(Model.toTree(d))
    eq('a detector is listed by its material id (the document\'s materials from 2)', g.detectors, [3])
    ok('the render kernels compile the same text: a detector only matters to the optics trace', g.wgsl === before.wgsl)
    Model.setMaterialType(d, 'cut', 'limiter')
    const h = generate(Model.toTree(d))
    eq('a limiter is listed too', h.detectors, [3, 4])
    ok('...and is not in the picture', !/Nrectangle/.test(h.wgsl) && /Nrectangle/.test(h.opticsWgsl))
    ok('...nor in the pick copy, so a click never selects what cannot be seen', !h.tags.includes('plane') && h.opticsTags.includes('plane'))
    ok('its transform and parameters are still declared, for the builder to write', 'xf_plane' in h.uniforms && 'width_plane' in h.uniforms)
    ok('the optics copy has the pick tags', /XF_TAG/.test(h.opticsPickWgsl) && !/XF_TAG = /.test(h.opticsWgsl))

    // LIGHTS: ids after the materials, MATID_BLACK and MATID_CLEAR
    Model.addLight(d, 'root', { id: 'die', shape: 'rectangle', params: { width: 0.2, height: 0.1 }, transform: at(5) })
    Model.addLight(d, 'root', { id: 'win', shape: 'disc', transparent: true })
    Model.addLight(d, 'root', { id: 'file', shape: 'rayfile' })
    const L = generate(Model.toTree(d))
    ok('MATID_BLACK and MATID_CLEAR follow the three materials', /const MATID_BLACK: u32 = 5u;/.test(L.wgsl) && /const MATID_CLEAR: u32 = 6u;/.test(L.wgsl))
    ok('each light has its own material id after them', /const matid_die: u32 = 7u;/.test(L.wgsl) && /const matid_win: u32 = 8u;/.test(L.wgsl))
    ok('a one-sided light is black behind and past its edge (0.next: the rim the surface tolerance grows it by), a transparent one clear',
        L.body.includes('let MATERIAL = select(MATID_BLACK, matid_die, p.z >= 0.0 && all(abs(p.xy) <= VEC2(width, height) * 0.5));')
        && L.body.includes('let MATERIAL = select(MATID_CLEAR, matid_win, p.z >= 0.0 && dot(p.xy, p.xy) <= radius * radius);'))
    /* PLAN.md L4: a camera path sees the face glow at its first hit, and at a later one when its first
       surface was not one the light's photons connect from (CLS_LIGHTS); no photon, shadow ray or probe
       ever does, nor a ray that is no path (bounces 0: the field kernel's) */
    ok('its face glows for a camera path: the first hit, or a later one the photons do not own; black otherwise',
        /case 7u: \{     \/\/ light die\s+var m = makeDiffuse\(vec3<f32>\(0\.0\), 1\.0\);\s+let direct = C\.r\.bounces == 2u && C\.r\.ltMis > 0\.0;[^\n]*\s+if \(\(C\.r\.tag & \(TAG_PHOTON \| TAG_EMIT \| TAG_PROBE\)\) == 0u && C\.r\.bounces >= 1u\s+&& \(C\.r\.bounces == 1u \|\| \(\(direct \|\| \(C\.r\.tag & CLS_LIGHTS\) == 0u\) && u32\(UB\.beam_die\.x \+ 0\.5\) != 0u\)\)\) \{/.test(L.wgsl))
    /* PLAN.md L4b: a DIRECT path (the face at bounce 2 after a first surface a photon connects from) is
       shared with the photons by the balance heuristic -- the face keeps 1 / (1 + R), R = le ltMis -- and a
       collimated face (beam kind 0) shows its display glow to the first hit alone */
    ok('...a direct path shared with its photons: 1 / (1 + le ltMis)',
        L.wgsl.includes('let w = select(1.0, 1.0 / (1.0 + le * C.r.ltMis), direct);') && L.wgsl.includes('* le * w;'))
    /* PLAN.md L7: past that, a face a BSDF sample meets is weighed against light sampling at the vertex
       before -- the share there, this face's density, the power heuristic, as misWeight -- ONCE, after
       the switch, for whichever face it was: each case hands its material and its index down */
    const gm = L.wgsl.slice(L.wgsl.indexOf('fn getMaterial2('), L.wgsl.indexOf('const LIGHT_FACES'))
    ok('...and a later hit against light sampling at the vertex before (L7), after the switch for every face',
        /case 7u: \{     \/\/ light die[\s\S]*?fm = m; face = 1u;/.test(gm) && /case 8u: \{     \/\/ light win[\s\S]*?fm = m; face = 2u;/.test(gm)
        && /default: \{ return makeDefaultMaterial\(\); \}\s+\}\s+if \(any\(fm\.emissive != VEC3\(0\.0\)\) && C\.r\.bounces >= 2u && C\.r\.prevPdf >= 0\.0\) \{\s+let pl = lightFaceDensity\(lightFaceShare\(C\.r\.bounces - 1u, C\.r\.tag\), lightFace\(face - 1u\), lightFaceTotal\(\),[\s\S]*?fm\.emissive = fm\.emissive \* \(a \/ max\(a \+ pl \* pl, 1e-20\)\);\s+\}\s+return fm;\s+\}/.test(gm), gm)
    ok('...a collimated face only to the first hit (its later glow needs beam kind != 0)',
        L.wgsl.includes('&& (C.r.bounces == 1u || ((direct || (C.r.tag & CLS_LIGHTS) == 0u) && u32(UB.beam_die.x + 0.5) != 0u))) {'))
    const faceCases = L.wgsl.match(/case [78]u: \{     \/\/ light \w+[\s\S]*?fm = m; face = \d+u;/g) || []
    ok('...the glow added to the face\'s own material, not a material of its own',
        faceCases.length === 2 && faceCases.every(f => !f.includes('makeDefaultMaterial'))
        && /var m = clearSheet\(\);[\s\S]*?let le = [\s\S]*?m\.emissive = [^\n]*\* le \* w;/.test(faceCases[1]), faceCases.join('\n---\n'))
    ok('...and a transparent one a clear sheet otherwise', /case 8u: \{     \/\/ light win\s+var m = clearSheet\(\);/.test(L.wgsl))
    /* PLAN.md L3: the face shows its distribution, from its beam uniform (lights.js beamOf) and the angle
       it is seen at -- the luminance straight out from every side is what it did before */
    ok('the face\'s luminance follows its distribution, by the angle it is seen at',
        L.wgsl.includes('let le = UB.emissiveLuminance_die * lightBeam(UB.beam_die, dot(-C.r.dir, n))') && /fn lightBeam\(beam: vec4<f32>, cosT: f32\) -> f32/.test(L.wgsl))
    /* ...and over n^2 of the medium the path meets it in: its luminance is its radiance in what it emits
       into, and a camera in air sees a die in silicone through its dome at 1/n^2 of it (L4 made that path) */
    ok('the face\'s glow is over n^2 of the medium it is met in',
        /lightBeam\(UB\.beam_die, dot\(-C\.r\.dir, n\)\) \/ max\(C\.r\.n \* C\.r\.n, 1\.0\);/.test(L.wgsl))
    eq('its beam is a vec4 uniform: the kernels\' distribution code, n, cos of the half angle',
        [L.uniforms.beam_die?.type, L.uniforms.beam_die?.def], ['vec4<f32>', [2, 1, Math.cos(Math.PI / 2), 0]])
    /* PLAN.md L1: every variant of a face -- glowing, black, clear -- says it is one, so the renderer never
       discovers it as an emitter; and nothing else says so */
    ok('every variant of a light\'s face says it is one (lightTraced), a transparent one 2: it lets the path through',
        /case 7u: \{     \/\/ light die[\s\S]*?\}\s+m\.lightTraced = 1u;\s+fm = m; face = 1u;/.test(L.wgsl)
        && /case 8u: \{     \/\/ light win[\s\S]*?\}\s+m\.lightTraced = 2u;\s+fm = m; face = 2u;/.test(L.wgsl))
    eq('...and nothing but a face does', (L.wgsl.match(/lightTraced = [12]u/g) || []).length, 2)
    ok('the clear sheet: no coat, fully transmissive, smooth', /fn clearSheet[\s\S]*?m\.roughness = 0\.0; m\.specular = 0\.0; m\.transmission = 1\.0;/.test(L.wgsl))
    ok('its colour, luminance and size are uniforms', ['emissive_die', 'emissiveLuminance_die', 'width_die', 'radius_win'].every(k => k in L.uniforms))
    eq('the optics trace passes through a transparent light, front and back', L.passes, [8, 6])
    ok('a ray file draws nothing, and its transform is still declared', /node file \(light\): a ray file: no geometry/.test(L.body) && 'xf_file' in L.uniforms)
    Model.setLight(d, 'die', { twoSided: true })
    ok('two-sided: both faces are the light, and past its edge black', generate(Model.toTree(d)).body.includes('let MATERIAL = select(MATID_BLACK, matid_die, all(abs(p.xy) <= VEC2(width, height) * 0.5));'))
    // a CSG group: a box, and a sphere cut from it
    Model.addGroup(d, 'root', { id: 'cutter' })
    Model.addObject(d, 'cutter', { primitive: 'box' }); Model.addObject(d, 'cutter', { primitive: 'sphere', join: 'subtract' })
    Model.move(d, 'die', 'cutter')
    /* A LIGHT INSIDE A CSG GROUP IS DRAWN (the user, 2026-10-03): a combine moves nothing, so the light is where
       its transforms say -- drawn after the combine, outside it. It was "not drawn", and OpticsBench2's laser
       had no face and no rays. */
    const inCsg = generate(Model.toTree(d))
    ok('a light inside a CSG group is drawn, after the combine', /\/\/ node die \(light, rectangle\)/.test(inCsg.wgsl)
        && inCsg.wgsl.indexOf('// node die (light, rectangle)') > inCsg.wgsl.indexOf('C = fold(C, k_cutter, km_cutter);'))
}
{
    /* A LIGHT IN A CSG GROUP (the user, 2026-10-03): drawn and traced at its transforms, as under a plain group, and
       the CSG shape exactly what it is without the light. Three places it can sit: a child of the CSG group itself;
       inside a plain group that is one of the CSG group's SHAPES (OpticsBench2's laser: disc light < Laser <
       lensholder) -- emitted where it sits it would go into that shape's own Hit and be unioned into the shape, or
       cut, or cut; inside a CSG group that is itself a shape of another, which hoists it to the outermost. And under
       group code it is still not drawn: code can move it anywhere. Live visibility off and on. */
    const { sourceTable } = await import('../sources.js')
    const at = (x, y, z, rx = 0) => ({ pos: { x, y, z }, rot: { x: rx, y: 0, z: 0 }, scale: 1 })
    /* holder (CSG: a box less a sphere), turned and moved; in it `rig` (a plain group, one of its shapes, moved)
       holding a cylinder and the light; optionally a light straight in holder, and a CSG group `inner` in holder
       with a light of its own */
    const build = ({ light = true, direct = false, inner = false, code = false } = {}) => {
        const d = Model.createDoc()
        Model.addGroup(d, 'root', { id: 'holder', transform: at(1, -2, 3, 30) })
        Model.addObject(d, 'holder', { id: 'hb', primitive: 'box' })
        Model.addObject(d, 'holder', { id: 'hs', primitive: 'sphere', join: 'subtract' })
        Model.addGroup(d, 'holder', { id: 'rig', transform: at(0, 0.5, 0.25) })
        Model.addObject(d, 'rig', { id: 'rc', primitive: 'cylinder' })
        if (light) Model.addLight(d, 'rig', { id: 'lamp', shape: 'disc', transform: at(-0.5, 0, 0, -90) })
        if (direct) Model.addLight(d, 'holder', { id: 'top', shape: 'rectangle', transform: at(0, 0, 1) })
        if (inner) {
            Model.addGroup(d, 'holder', { id: 'inner', transform: at(0.2, 0, 0) })
            Model.addObject(d, 'inner', { id: 'ib', primitive: 'box' })
            Model.addObject(d, 'inner', { id: 'is', primitive: 'sphere', join: 'intersect' })
            Model.addLight(d, 'inner', { id: 'deep', shape: 'disc', transform: at(0, 0, 0.1) })
        }
        if (code) Model.setCode(d, 'rig', 'C = children(C, p);')
        return d
    }
    // every line of the holder's block that is not a comment: the light's comment where it sits is all that may differ
    const holderOf = w => w.slice(w.indexOf('// group holder'), w.indexOf('C = fold(C, k_holder, km_holder);'))
        .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    for (const live of [false, true]) {
        const how = live ? ' (live visibility)' : ''
        const gen = d => generate(Model.toTree(d, { keepDisabled: live }), { liveVisibility: live })
        const d = build(), g = gen(d), w = g.wgsl
        const after = w.indexOf('C = fold(C, k_holder, km_holder);')
        ok(`a light in a shape of a CSG group is drawn after the combine, outside it${how}`,
            w.indexOf('// node lamp (light, disc)') > after && /\/\/ node lamp \(light\): drawn after the combine of group holder/.test(w)
            && w.indexOf('// node lamp (light): drawn after') < after)
        ok(`...in the frame of the group between, entered for it alone${how}`,
            new RegExp(`// light lamp, from inside the combine[^\\n]*\\n\\s*${live ? 'if \\(UB\\.vis_rig != 0u\\) \\{' : '\\{'}     // group rig\\n\\s*let p = xfPoint\\(p, UB\\.xf_rig\\);`).test(w))
        ok(`...with its own material id and face${how}`, /const matid_lamp: u32 = \d+u;/.test(w) && /case 0u: \{     \/\/ light lamp/.test(w)
            && w.includes('C = add_new(C, Ndisc(p, radius), MATERIAL);'))
        eq(`...the CSG shape is the text it is without the light${how}`, holderOf(w), holderOf(gen(build({ light: false })).wgsl))
        const fn = w.slice(w.indexOf('fn lightFace(i: u32)'), w.indexOf('fn lightFaceLe('))
        const chain = [...fn.matchAll(/let T = UB\.(\w+);/g)].map(m => m[1])
        eq(`...its face placed through every frame above it, the CSG group's too${how}`, chain, ['xf_holder', 'xf_rig', 'xf_lamp'])
        const read = [...new Set([...fn.matchAll(/UB\.(\w+)/g)].map(m => m[1]))]
        eq(`...and every uniform its face reads is declared${how}`, read.filter(k => !(k in g.uniforms)), [])
        if (live) ok('...its weight behind every visibility above it', fn.includes('UB.vis_holder != 0u && UB.vis_rig != 0u && UB.vis_lamp != 0u'))
        ok(`...and the pick copy names it${how}`, g.tags.includes('lamp'))
        // the light straight in the CSG group, and one in a CSG group inside it: both after the OUTER combine
        const g2 = gen(build({ direct: true, inner: true })), w2 = g2.wgsl, after2 = w2.indexOf('C = fold(C, k_holder, km_holder);')
        ok(`a light straight in a CSG group is drawn after its combine${how}`, w2.indexOf('// node top (light, rectangle)') > after2)
        ok(`a light in a CSG group inside another is drawn after the outer combine, in both groups' frames${how}`,
            w2.indexOf('// node deep (light, disc)') > after2 && w2.indexOf('C = fold(C, k_inner, km_inner);') < after2
            && /\/\/ node deep \(light\): drawn after the combine of group holder/.test(w2))
        const fn2 = w2.slice(w2.indexOf('fn lightFace(i: u32)'), w2.indexOf('fn lightFaceLe('))
        ok(`...placed through holder and inner${how}`, /case 2u: \{     \/\/ light deep[\s\S]*?UB\.xf_holder;[\s\S]*?UB\.xf_inner;[\s\S]*?UB\.xf_deep;[\s\S]*?f\.centre/.test(fn2))
        eq(`...and the combines' shapes are the ones there are without the lights${how}`, (w2.match(/\/\/ this child alone/g) || []).length,
            (gen(build({ light: false, inner: true })).wgsl.match(/\/\/ this child alone/g) || []).length)
        // under group code: not drawn
        const gc = gen(build({ code: true })).wgsl
        ok(`a light under group code is still not drawn${how}`, /node lamp \(light\): a light inside group code: not drawn/.test(gc) && !/matid_lamp/.test(gc))
    }
    /* THE OPTICS TRACE TAKES THEM THE SAME WAY (sources.js sourceTable): a light in a CSG group traced, at its world
       frame through every group above it -- the same point lightFace composes; under group code skipped, with its
       reason (the Rays view and the Analysis pane say it); disabled, absent. */
    const d = build({ direct: true })
    const T = sourceTable(d)
    eq('sources: both lights in the CSG group are traced, nothing skipped', [T.sources.map(x => x.id), T.skipped], [['lamp', 'top'], []])
    const g = generate(Model.toTree(d))
    const fn = g.wgsl.slice(g.wgsl.indexOf('case 0u: {     // light lamp'), g.wgsl.indexOf('case 1u: {     // light top'))
    const mul = (M, v) => [0, 1, 2].map(r => M[0][r] * v[0] + M[1][r] * v[1] + M[2][r] * v[2])
    let M = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], S = 1, t = [0, 0, 0]
    for (const [, id] of fn.matchAll(/let T = UB\.(\w+);/g)) {
        const U = g.uniforms[id].def, col = c => [U[4 * c], U[4 * c + 1], U[4 * c + 2]]
        const tr = mul(M, col(3).map(x => x * S)); t = t.map((x, i) => x + tr[i])
        M = [0, 1, 2].map(c => mul(M, col(c))); S *= U[15]
    }
    const src = T.sources[0], close = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 1e-9)
    ok('...at the world frame the shader places its face by: the centre and the normal', close(t, src.origin) && close(M[2], src.normal), `${t} vs ${src.origin}`)
    const coded = sourceTable(build({ code: true }))
    ok('sources: a light under group code is skipped, saying why', !coded.sources.length && coded.skipped.length === 1
        && coded.skipped[0].id === 'lamp' && /group code/.test(coded.skipped[0].reason), JSON.stringify(coded.skipped))
    const off = build(); Model.find(off, 'lamp').node.enabled = false
    const offT = sourceTable(off)
    ok('sources: a disabled light is absent, neither traced nor skipped', !offT.sources.length && !offT.skipped.length)
    // a group whose code is comments only HAS no code (codegen hasCode): its light drawn, and traced -- the two agree
    const cm = build(); Model.setCode(cm, 'rig', '// nothing yet')
    ok('sources: a group with only comments for code is no group code: its light traced, as it is drawn',
        sourceTable(cm).sources.length === 1 && /\/\/ node lamp \(light, disc\)/.test(generate(Model.toTree(cm)).wgsl))
}
{
    /* A PLAIN GROUP AS ONE OF A CSG GROUP'S SHAPES (0.76.0, codegen.js combinedGroups): its children combined as a union
       (csgUnion at its blend, 0), not folded -- a fold keeps the nearest boundary by |d|, which is no union's signed
       distance where they overlap, and the CSG group above read it as its operand (csgshape.gpu.mjs says so in numbers:
       this is the text). Plain groups inside one too, and an array's copies, into ONE combine. Not group code, not the top
       level, not a plain group outside any CSG group. */
    const at = (x, y, z) => ({ pos: { x, y, z }, rot: { x: 0, y: 0, z: 0 }, scale: 1 })
    const d = Model.createDoc()
    Model.addGroup(d, 'root', { id: 'part' })
    Model.addObject(d, 'part', { id: 'hb', primitive: 'box' })
    Model.addGroup(d, 'part', { id: 'rig', join: 'subtract' })
    Model.addObject(d, 'rig', { id: 'ra', primitive: 'sphere' })
    Model.addGroup(d, 'rig', { id: 'inner' })
    Model.addObject(d, 'inner', { id: 'ia', primitive: 'sphere' }); Model.addObject(d, 'inner', { id: 'ib', primitive: 'sphere' })
    Model.addGroup(d, 'part', { id: 'row', join: 'subtract' })
    Model.addObject(d, 'row', { id: 'rs', primitive: 'sphere', join: 'subtract' })       // the base: its join dormant
    Model.setCopies(d, 'row', [at(-0.5, 0, 0), at(0.5, 0, 0)])
    Model.addGroup(d, 'part', { id: 'mir', ...modifierGroup('mirror'), join: 'subtract' })
    Model.addGroup(d, 'mir', { id: 'undercode' })
    Model.addObject(d, 'undercode', { id: 'ua', primitive: 'sphere' }); Model.addObject(d, 'undercode', { id: 'ub', primitive: 'sphere' })
    Model.addGroup(d, 'root', { id: 'loose' })
    Model.addGroup(d, 'loose', { id: 'looser' })
    Model.addObject(d, 'looser', { id: 'la', primitive: 'sphere' }); Model.addObject(d, 'looser', { id: 'lb', primitive: 'sphere' })
    eq('combinedGroups: the CSG group, its plain shapes, a plain group in one, an array -- not group code, nor a plain group under it, nor outside any CSG group',
        [...combinedGroups(Model.toTree(d))].sort(), ['inner', 'part', 'rig', 'row'])
    for (const live of [false, true]) {
        const how = live ? ' (live visibility)' : ''
        const g = generate(Model.toTree(d, { keepDisabled: live }), { liveVisibility: live }), w = g.wgsl
        const block = id => w.slice(w.indexOf(`// group ${id} (`), w.indexOf(`C = fold(C, k_${id}, km_${id});`))
        ok(`a plain group that is a shape combines its children: each alone, joined by an exact union${how}`,
            // (live: the base's else too, never taken in a group: the join of the child after it)
            (block('rig').match(/csgUnion\(k_rig, C\.s, UB\.blend_rig\);/g) || []).length === (live ? 2 : 1)
            && (block('inner').match(/csgUnion\(k_inner, C\.s, UB\.blend_inner\);/g) || []).length === (live ? 2 : 1)
            // ...the union folded into the rig's own Hit, which part then subtracts
            && w.indexOf('C = fold(C, k_rig, km_rig);') < w.indexOf('k_part = csgSubtract(k_part, C.s, UB.blend_part);', w.indexOf('// group rig (')))
        eq(`...its blend declared at 0, as a union group's${how}`, ['rig', 'inner', 'row'].map(id => g.uniforms[blendName(id)]?.def), [0, 0, 0])
        const loop = w.indexOf('for (var ci_row = 0u;'), loopEnd = w.indexOf('C = fold(C, k_row, km_row);')
        ok(`an array that is a shape: one combine for its copies, opened before its loop and folded after it${how}`,
            w.indexOf('var k_row = VEC4(') < loop && w.indexOf('var first_row = true;') < loop && loopEnd > loop
            && (w.slice(loop, loopEnd).match(/var k_row|C = fold\(C, k_row/g) || []).length === 0)
        ok(`...its base, at a copy after the first, a union at the group's blend, whatever join it keeps dormant${how}`,
            /if \(first_row\) \{ k_row = C\.s; km_row = C\.m; first_row = false; \} else \{\s+km_row = select\(km_row, C\.m, C\.s\.w < k_row\.w\);\s+k_row = csgUnion\(k_row, C\.s, UB\.blend_row\);/.test(w))
        ok(`group code that is a shape is handed its children as they fold, a plain group under it too${how}`,
            !/k_mir\b|k_undercode\b/.test(w) && /\/\/ group undercode \(union\)/.test(w))
        ok(`a plain group outside any CSG group folds its children into the scene, as ever${how}`, !/k_loose\b|k_looser\b/.test(w))
    }
}
{
    // THE SCENE'S SIZE, an estimate: object positions, padded by the largest parameter
    const d = Model.createDoc()
    Model.addObject(d, 'root', { primitive: 'sphere', params: { radius: 1 } })
    Model.addObject(d, 'root', { primitive: 'sphere', params: { radius: 1 }, transform: { pos: { x: 10, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: 1 } })
    ok('two unit spheres 10 apart: about 12 across (x) by 2 by 2', Math.abs(generate(Model.toTree(d)).extent - Math.hypot(12, 2, 2)) < 1e-9)
    eq('an empty scene has none (the renderer keeps its 1 mm)', generate(Model.toTree(Model.createDoc())).extent, null)
}

// LIVE VISIBILITY: every node behind a uniform, hidden ones kept; off, the shader is what it was
{
    const doc = Model.createDoc()
    const a = Model.addObject(doc, 'root', { primitive: 'sphere' })
    const cut = Model.addGroup(doc, 'root')
    const base = Model.addObject(doc, cut.id, { primitive: 'box' })
    Model.addObject(doc, cut.id, { primitive: 'sphere', join: 'subtract' })
    Model.setEnabled(doc, base.id, false)
    const off = generate(Model.toTree(doc))
    const on = generate(Model.toTree(doc, { keepDisabled: true }), { liveVisibility: true })
    eq('off: no visibility uniforms', Object.keys(off.uniforms).some(k => k.startsWith('vis_')), false)
    eq('off: a disabled node is left out of the shader', off.wgsl.includes(`node ${base.id} `), false)
    eq('on: a uniform per node', [a.id, cut.id, base.id].every(id => off.uniforms && on.uniforms[`vis_${id}`]?.type === 'u32'), true)
    eq('on: the disabled node is in the shader, its uniform 0', on.wgsl.includes(`node ${base.id} `) && on.uniforms[`vis_${base.id}`].def === 0, true)
    eq('on: a shown node\'s uniform is 1', on.uniforms[`vis_${a.id}`].def, 1)
    eq('on: every node\'s block is behind its uniform', on.wgsl.includes(`if (UB.vis_${a.id} != 0u) {`), true)
    eq('on: a CSG group takes its first VISIBLE child as the base', on.wgsl.includes(`var first_${cut.id} = true;`)
        && on.wgsl.includes(`if (first_${cut.id}) {`), true)
    eq('on: the pick copy is gated too (a hidden node is not picked)', on.pickWgsl.includes(`if (UB.vis_${a.id} != 0u) {`), true)
    eq('toTree without keepDisabled still prunes', JSON.stringify(Model.toTree(doc)).includes(`"${base.id}"`), false)
}
// THE DOCUMENT'S SETTING, through generateArgs -- the one place the builder and the page build from: every
// node of a live document declares the uniform BUILDER.live('enabled') writes, disabled ones included
{
    const doc = Model.parse(readFileSync(new URL('../../test/fixtures/scenes/optics-test.json', import.meta.url), 'utf8'))
    Model.setEnabled(doc, 'lens', false)
    const off = generate(...Model.generateArgs(doc, { id: 'built' }))
    eq('a document without the setting: no visibility uniforms', Object.keys(off.uniforms).filter(k => k.startsWith('vis_')).length, 0)
    Model.setLiveVisibility(doc, true)
    eq('the setting is sound to save', Model.validate(doc).length, 0)
    const on = generate(...Model.generateArgs(doc, { id: 'built' }))
    const ids = []; Model.walk(doc, n => { if (n !== doc.root) ids.push(n.id) })
    eq('with it: every node declares vis_<id> (what BUILDER.live writes)', ids.every(id => on.uniforms[`vis_${id}`]), true)
    eq('...the hidden lens with 0', on.uniforms.vis_lens.def, 0)
    Model.setLiveVisibility(doc, false)
    eq('turned off, the field is gone (nothing saved)', 'liveVisibility' in doc, false)
    doc.liveVisibility = 'yes'
    eq('a setting that is not true or false is refused', Model.validate(doc).some(p => p.includes('liveVisibility')), true)
}

// A SCENE SWAP KEEPS NOTHING OF ANOTHER DOCUMENT: ids repeat between documents (the Menger scene's floor
// is at z = -10, the material test's at -2), and the renderer carried a value across setScene by name --
// so the material test showed its ground at the Menger's -10 (the user, 2026-09-28)
{
    const docAt = z => { const d = Model.createDoc(); Model.addObject(d, 'root', { id: 'floor', primitive: 'box', transform: { pos: { x: 0, y: 0, z }, rot: { x: 0, y: 0, z: 0 }, scale: 1 } }); return d }
    const menger = generate(...Model.generateArgs(docAt(-10), { id: 'built' }))
    const mats = generate(...Model.generateArgs(docAt(-2), { id: 'built' }))
    eq('a generated scene says its values are its own', mats.carryUniforms, false)
    const shown = { xf_floor: menger.uniforms.xf_floor.def, exposureComp: 1.5 }
    const fresh = { xf_floor: mats.uniforms.xf_floor.def }
    carryAcross(shown, fresh, { from: menger, to: mats })
    eq('switching documents: the new floor where its document puts it, not the last one\'s', fresh.xf_floor[14], -2)
    const live = { xf_floor: mats.uniforms.xf_floor.def.map((v, i) => i === 14 ? 5 : v) }
    const again = carryAcross(live, { xf_floor: mats.uniforms.xf_floor.def }, { from: mats, to: mats })
    eq('the same scene again (a recompile): what was set live since stays', again.xf_floor[14], 5)
    const plain = carryAcross({ mengerScale: 3 }, { mengerScale: 1 }, { from: null, to: { uniforms: {} } })
    eq('a scene that does not say so still keeps what both declare', plain.mengerScale, 3)
}

{
    /* THE LIGHT BENCH (builder/lightbench.js, the light-vs-emitter row): its rows set the scene's uniforms by
       name, and a name the scene does not declare is only a console warning at run time -- a row that then
       measures the wrong picture. So: every scene-side name a row sets is declared, the light and the
       emissive disc are the same disc, and every emitter row follows its light row (its ratio reads the
       light row's mean). */
    const { lightBench } = await import('../lightbench.js')
    const t = lightBench()
    const sceneSide = k => /^(vis|beam|metallic|specular|roughness|baseColor)_/.test(k)
    const missing = t.cases.flatMap(c => Object.keys({ ...t.pin, ...c.set }).filter(k => sceneSide(k) && !(k in t.scene.uniforms)))
    eq('the light bench sets only uniforms its scene declares', missing, [])
    ok('...under an id of its own: the Optics page lights only the builder\'s scene ("built")', t.scene.id !== 'built')
    const lamp = t.cases[0].opticsLight.sources[0]
    ok('its light is the lamp as the Optics page starts it: a two-sided disc, 1 m up, facing up',
        lamp.type === 'disc' && lamp.twoSided === true && lamp.onSurface === true && lamp.pos[2] === 1 && lamp.axis[2] === 1)
    ok('...of the flux its luminance gives: 2 faces x pi L A', Math.abs(lamp.flux - 2 * Math.PI * 10000 * Math.PI * 0.09) < 1e-6)
    ok('every emitter row directly follows its light row', t.cases.every((c, i) => c.as !== 'emitter' || (t.cases[i - 1]?.as === 'light' && t.cases[i - 1].pair === c.pair)))
    ok('the light and the emissive disc are the same disc', /node benchlamp \(light, disc\)/.test(t.scene.body) && /node benchdisc \(code\)/.test(t.scene.body)
        && t.scene.uniforms.radius_benchlamp.def === t.scene.uniforms.radius_benchdisc.def)
    /* ...and SHARES NO NAME WITH A BUNDLED SCENE that it does not pin: tests.js apply() lays the user's
       values under every row by name, and the bench's floor was once a node `ground`, which would have
       taken the demo scene's transform for it (xf_ground). */
    const pinned = new Set(t.cases.flatMap(c => Object.keys({ ...t.pin, ...c.set })))
    // the examples and the scenes that were the examples (test/fixtures/scenes), every file of both folders
    const shared = ['../../scenes/', '../../test/fixtures/scenes/'].flatMap(d => readdirSync(new URL(d, import.meta.url)).filter(f => f.endsWith('.json')).map(f => d + f)).flatMap(f => {
        const s = generate(...Model.generateArgs(Model.parse(readFileSync(new URL(f, import.meta.url), 'utf8')), { id: 'built' }))
        return Object.keys(s.uniforms).filter(k => k in t.scene.uniforms && !pinned.has(k)).map(k => `${f}: ${k}`)
    })
    eq('the light bench shares no unpinned uniform with a bundled scene', shared, [])
}

{
    /* PLAN.md L7: light sampling places a face by lightFace(i), which codegen composes in WGSL from the xf
       uniforms the SDF reads, root first. Run here, line by line as emitted, on those uniforms' defaults,
       against the builder's own world frame (sources.js, through bounds.js toParent -- a composition of its
       own): a rectangle light, moved, turned and scaled, in a group moved, turned and scaled. The order of
       the frames and the composition rule are what this sees; a wrong one lands the face elsewhere. */
    const { sourceTable } = await import('../sources.js')
    const d = Model.createDoc({})
    Model.addGroup(d, 'root', { id: 'rig', transform: { pos: { x: 1, y: -2, z: 0.5 }, rot: { x: 20, y: -35, z: 50 }, scale: 1.5 } })
    Model.addLight(d, 'rig', { id: 'lamp', shape: 'rectangle', params: { width: 0.4, height: 0.2 },
                               transform: { pos: { x: 0.3, y: 0.1, z: -0.2 }, rot: { x: -10, y: 60, z: 15 }, scale: 0.8 } })
    const g = generate(Model.toTree(d))
    const fn = g.wgsl.slice(g.wgsl.indexOf('fn lightFace(i: u32)'), g.wgsl.indexOf('fn lightFaceLe('))
    const ids = [...fn.slice(0, fn.indexOf('f.centre')).matchAll(/let T = UB\.(\w+);/g)].map(m => m[1])
    eq('lightFace composes the group\'s frame, then the light\'s', ids, ['xf_rig', 'xf_lamp'])
    // ...each by exactly the rule run below, so what the test checks is what the shader does
    eq('...each frame by the rule this test runs', (fn.match(/\{ let T = UB\.\w+; t \+= M \* \(S \* T\[3\]\.xyz\); M = M \* xfRot\(T\); S \*= T\[3\]\.w; \}/g) || []).length, 2)
    const mul = (M, v) => [0, 1, 2].map(r => M[0][r] * v[0] + M[1][r] * v[1] + M[2][r] * v[2])     // M as columns
    let M = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], S = 1, t = [0, 0, 0]
    for (const id of ids) {
        const T = g.uniforms[id].def, col = c => [T[4 * c], T[4 * c + 1], T[4 * c + 2]]
        const tr = mul(M, col(3).map(x => x * S))                        // t += M * (S * T[3].xyz)
        t = t.map((x, i) => x + tr[i])
        M = [0, 1, 2].map(c => mul(M, col(c)))                          // M = M * xfRot(T)
        S *= T[15]                                                      // S *= T[3].w
    }
    const src = sourceTable(d).sources.find(x => x.id === 'lamp')
    const close = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 1e-9)
    ok('...to the builder\'s world frame: the centre', close(t, src.origin), `${t} vs ${src.origin}`)
    ok('...its axes (u along the width, the normal +z)', close(M[0], src.u) && close(M[2], src.normal), `${M[0]} / ${M[2]}`)
    ok('...and its half sizes', close([0.4 * 0.5 * S, 0.2 * 0.5 * S], src.half), `${S} vs ${src.half}`)
    /* ...and a scene WITHOUT lights carries none of it: its text is what it always was (the golden shaders),
       and the stub every kernel puts before the scene (uniforms.schema.js) says it has no faces */
    const { sceneConstantsWGSL } = await import('../../lib/pathtracer/core/uniforms.schema.js')
    const bare = generate(Model.toTree(Model.createDoc({})))
    ok('a light\'s face weighs nothing when hidden or collimated, and a scene without lights has none',
        /f\.weight = select\(0\.0, 1\.0, u32\(UB\.beam_lamp\.x \+ 0\.5\) != 0u\);/.test(fn)
        && !/LIGHT_FACES|lightFace|lightBeam/.test(bare.wgsl) && sceneConstantsWGSL(bare).includes('const LIGHT_FACES: u32 = 0u;')
        && !sceneConstantsWGSL(g).includes('const LIGHT_FACES'))
    /* ...and the BODY -- the prelude and the scene in one text, which the builder compiles before it loads a
       scene (validate.js) with no sceneConstantsWGSL between them -- declares LIGHT_FACES exactly once either
       way: the stub in its prelude part without a light, the scene's own with one. Without the stub every
       scene without a light failed that compile (the user's console, 2026-10-01). */
    const once = t => (t.match(/\bconst\s+LIGHT_FACES\b/g) || []).length === 1
    ok('...and the body the builder compiles declares LIGHT_FACES once, with a light or without',
        once(bare.body) && once(g.body) && bare.body.indexOf('const LIGHT_FACES') < bare.body.indexOf(bare.wgsl.split('\n').find(l => l.trim())))
}

{
    /* A LIGHT INSIDE ARRAYS (0.next; lights.js A LIGHT INSIDE ARRAYS): a face a copy, numbered from the light's own place,
       innermost copy fastest -- and the same faces, in the same order, from the three that enumerate them: codegen's
       lightFace (run here on the uniforms' defaults, line by line as emitted, as the test above runs one light's), the
       scene as data's light table (scenedata.js recordsOf), and the optics' sources (sources.js sourceTable). A light
       before the arrays and one after them keep their places; a light under copies of two scales, or in an array in a
       joining group, is not drawn, and the Optics page is told why. */
    const { sourceTable } = await import('../sources.js')
    const at = (x, y = 0, z = 0, rx = 0, ry = 0, rz = 0, scale = 1) => ({ pos: { x, y, z }, rot: { x: rx, y: ry, z: rz }, scale })
    const d = Model.createDoc({})
    Model.addLight(d, 'root', { id: 'solo', shape: 'disc', transform: at(0, 0, 3) })
    Model.addGroup(d, 'root', { id: 'strip', transform: at(1, -2, 0.5, 20, -35, 50, 1.5) })
    Model.addGroup(d, 'strip', { id: 'pair', transform: at(0.2, 0, 0, 0, 0, 30) })
    Model.addLight(d, 'pair', { id: 'led', shape: 'rectangle', params: { width: 0.4, height: 0.2 }, transform: at(0.3, 0.1, -0.2, -10, 60, 15, 0.8) })
    Model.setCopies(d, 'strip', [at(-1, 0, 0, 0, 0, 0, 1.2), at(0, 0.5, 0, 30, 0, 0, 1.2), at(1, 0, 0.25, 0, 45, 10, 1.2)])
    Model.setCopies(d, 'pair', Model.copiesRing(2, 0.5, 'z'))
    Model.addLight(d, 'root', { id: 'last', shape: 'rectangle', transform: at(0, 2, 1) })
    eq('the scene is sound: a light in a nested array, copies of one scale each', Model.validate(d), [])
    const g = generate(Model.toTree(d))
    const fn = g.wgsl.slice(g.wgsl.indexOf('fn lightFace(i: u32)'), g.wgsl.indexOf('fn lightFaceLe('))
    ok('LIGHT_FACES: 1 + 3 x 2 + 1', /const LIGHT_FACES: u32 = 8u;/.test(g.wgsl))
    /* face i as codegen's lightFace makes it: its case, its copies' indices (`let c_<group> = (j / N) % K`), then the frames
       root first -- a group's own (`let T = UB.xf_...`) or a copy's, picked by its index -- by the composition rule */
    const mul = (M, v) => [0, 1, 2].map(r => M[0][r] * v[0] + M[1][r] * v[1] + M[2][r] * v[2])
    const faceOf = i => {
        const cases = fn.split(/\n(?=        (?:case|default))/)
        const c = cases.find(x => new RegExp(`^        case [^:]*\\b${i}u[,:]`).test(x))
        if (!c) return null
        const first = +(c.match(/let j = i - (\d+)u;/)?.[1] ?? i)
        const idx = {}
        for (const m of c.matchAll(/let (c_\w+) = \(j \/ (\d+)u\) % (\d+)u;/g)) idx[m[1]] = Math.floor((i - first) / +m[2]) % +m[3]
        let M = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], S = 1, t = [0, 0, 0]
        for (const m of c.matchAll(/\{ let T = UB\.(\w+);|switch \((c_\w+)\) \{ ([^\n]*?) default/g)) {
            const name = m[1] ?? [...m[3].matchAll(/case (\d+)u: \{ T = UB\.(\w+); \}/g)].find(x => +x[1] === idx[m[2]])[2]
            const T = g.uniforms[name].def, col = k => [T[4 * k], T[4 * k + 1], T[4 * k + 2]]
            const tr = mul(M, col(3).map(x => x * S))
            t = t.map((x, k) => x + tr[k]); M = [0, 1, 2].map(k => mul(M, col(k))); S *= T[15]
        }
        const half = /f\.shape = 2u/.test(c) ? [0.4 * 0.5 * S, 0.2 * 0.5 * S] : null
        return { origin: t, u: M[0], normal: M[2], S, half }
    }
    const src = sourceTable(d).sources
    const close = (a, b) => a && b && a.every((x, k) => Math.abs(x - b[k]) < 1e-9)
    eq('the sources: a light, six copies in order, a light', src.map(x => x.key ?? x.id),
       ['solo', 'led#1', 'led#2', 'led#3', 'led#4', 'led#5', 'led#6', 'last'])
    ok('...each copy its label and its index', src[3].label === 'rectangle light (copy 3 of 6)' && src[3].copy === 2 && src[3].copies === 6, JSON.stringify(src[3].label))
    const leds = src.filter(x => x.id === 'led')
    ok('lightFace\'s copies are the sources\' copies, face by face: centre, axes, half sizes',
        leds.every((x, j) => { const f = faceOf(1 + j); return close(f?.origin, x.origin) && close(f.u, x.u) && close(f.normal, x.normal) && close(f.half, x.half) }),
        JSON.stringify([faceOf(2), leds[1]]))
    ok('...six places, all different', new Set(leds.map(x => x.origin.map(v => v.toFixed(6)).join())).size === 6)
    ok('...the light after them the eighth face, the one before the first', close(faceOf(7)?.origin, src[7].origin) && close(faceOf(0)?.origin, src[0].origin))
    ok('...every copy the area of the first: the weight a hit on any copy is given (lights.js)', leds.every(x => Math.abs(x.area - leds[0].area) < 1e-12))
    // the material case hands the weight below the light's first face, the pick and the total one line a light
    ok('the light\'s material case: its first face to the weight', /fm = m; face = 2u;/.test(g.wgsl))
    const body = f => { const k = g.wgsl.indexOf(`fn ${f}(`); return g.wgsl.slice(k, g.wgsl.indexOf('\n}', k)) }
    ok('the total: the light\'s weight times its 6 faces, one line a light', (body('lightFaceTotal').match(/t \+= /g) || []).length === 3 && /t \+= select\([^\n]*\) \* 6\.0;/.test(body('lightFaceTotal')))
    /* the pick, run in JS as emitted: every u in [0, total) finds the face a loop over the faces one by one finds (shade's,
       tracebasics.js FACE_TABLE), each a share of 1 */
    const pickLine = body('lightFacePick').split('\n').find(l => /6 copies/.test(l))
    const [, last, lo, , hi] = pickLine.match(/last = (\d+)u; if \(u < acc \+ w \* 6\.0\) \{ return (\d+)u \+ min\(u32\(\(u - acc\) \/ w\), (\d+)u\); \} acc \+= w \* 6\.0;/).slice(0, 5).concat([0])
    ok('the pick within the copies: face 1 + floor(u - 1), the last 6', +lo === 1 && +last === 6 && /min\(u32\(\(u - acc\) \/ w\), 5u\)/.test(pickLine), pickLine)
    // ...and the scene as data: its light table the same faces
    const dg = generate(...Model.generateArgs(d, { id: 'lt', data: true }))
    const D = dg.data, u32 = k => new Uint32Array(D.buffer, 4 * 4 * 0, 4)[k]
    const base = u32(1), n = u32(2)
    const row = (i, k) => [0, 1, 2, 3].map(c => D[4 * (base + 4 * i + k) + c])
    ok('as data: the light table holds the 8 faces', n === 8, `${n}`)
    // (in f32: the buffer's)
    const near = (a, b) => a.every((x, k) => Math.abs(x - b[k]) < 1e-5)
    ok('...each copy where the sources have it, its axes and half sizes', src.every((x, i) => near(row(i, 0).slice(0, 3), x.origin) && near(row(i, 1).slice(0, 3), x.u)
        && near(row(i, 3).slice(0, 3), x.normal) && Math.abs(row(i, 1)[3] - x.half[0]) < 1e-6 && row(i, 3)[3] === 1),
        JSON.stringify([row(2, 0), src[2].origin]))
    const dt = dg.wgsl.slice(dg.wgsl.indexOf('fn lightFaceTotal('), dg.wgsl.indexOf('fn lightFaceLe('))
    ok('...its total and pick one line a light, its first face\'s shown flag the light\'s', /scnLight\(1u\) \+ 3u\]\.w > 0\.5[^\n]*\* 6\.0;/.test(dt)
        && /case 1u, 2u, 3u, 4u, 5u, 6u: \{ f\.le = UB\.emissive_led/.test(dt), dt.slice(0, 600))
    /* NOT DRAWN, AND SAID: copies of two scales (the model refuses them; a tree made by hand can have them), and an array
       in a joining group (not refused: a join above changed would make a saved scene unreadable) */
    const t2 = Model.toTree(d)
    const strip = t2.children.find(x => x.id === 'strip')
    strip.copies = strip.copies.map((c, k) => ({ ...c, scale: k ? 1 : 2 }))
    const g2 = generate(t2)
    ok('copies of two scales: no face, a comment why', /const LIGHT_FACES: u32 = 2u;/.test(g2.wgsl) && /node led \(light\): a light not drawn: the copies of 'strip' differ in scale/.test(g2.wgsl))
    Model.addObject(d, 'root', { id: 'block', primitive: 'box' })
    Model.addGroup(d, 'root', { id: 'joined' })
    Model.move(d, 'block', 'joined'); Model.move(d, 'strip', 'joined')
    Model.setJoin(d, 'strip', 'subtract')
    const g3 = generate(Model.toTree(d))
    ok('an array with a light in a joining group: no face, a comment why', /const LIGHT_FACES: u32 = 2u;/.test(g3.wgsl) && /a light not drawn: inside an array inside a group whose children join \('joined'\)/.test(g3.wgsl))
    ok('...and the Optics page told why', sourceTable(d).skipped.some(x => x.id === 'led' && /group whose children join/.test(x.reason)) && !sourceTable(d).sources.some(x => x.id === 'led'))
    eq('...as data, the same faces left out', generate(...Model.generateArgs(d, { id: 'lt3', data: true })).data && (() => { const D3 = generate(...Model.generateArgs(d, { id: 'lt3', data: true })).data; return new Uint32Array(D3.buffer, 0, 4)[2] })(), 2)
}

{
    /* THE LIGHT-FACE CODE GROWS LINEARLY with the number of lights (PLAN.md L7). A GPU compiler inlines
       every call, so a function the size of every light, called once per light, is code the square of
       their number -- in every kernel that asks for a material. L7 first shipped that: each face's case
       weighed its hit by lightFaceDensity and lightFaceShare, each a loop over lightFace, a switch that
       composes every light's frame. So the calls into those functions must be as many with 8 lights as
       with 2, and the sum of the weights and the pick be one line a light, with no loop. */
    const at = x => ({ pos: { x, y: 0, z: 1 }, rot: { x: 0, y: 0, z: 0 }, scale: 1 })
    const withLights = k => {
        const d = Model.createDoc({})
        Model.setLiveVisibility(d, true)
        Model.addGroup(d, 'root', { id: 'rig', transform: at(1) })
        for (let i = 0; i < k; i++)
            Model.addLight(d, i % 2 ? 'rig' : 'root', { id: `l${i}`, shape: i % 3 ? 'disc' : 'rectangle', transform: at(i) })
        return generate(...Model.generateArgs(d, { id: 'built' })).wgsl
    }
    const FNS = ['lightFace', 'lightFaceTotal', 'lightFaceShare', 'lightFaceDensity', 'lightFacePick', 'lightFaceLe']
    const calls = w => Object.fromEntries(FNS.map(f => [f, (w.match(new RegExp(`(?<!fn )\\b${f}\\(`, 'g')) || []).length]))
    const w2 = withLights(2), w8 = withLights(8)
    eq('the calls into the per-light functions are as many with 8 lights as with 2', calls(w8), calls(w2))
    ok('...and getMaterial2 makes each of them once, after its switch', ['lightFace', 'lightFaceTotal', 'lightFaceShare', 'lightFaceDensity']
        .every(f => calls(w8.slice(w8.indexOf('fn getMaterial2('), w8.indexOf('const LIGHT_FACES')))[f] === 1), JSON.stringify(calls(w8)))
    const body = (w, f) => { const i = w.indexOf(`fn ${f}(`); return w.slice(i, w.indexOf('\n}', i)) }
    ok('...the sum of the weights and the pick are straight-line: no loop, no lightFace, one term a light',
        ['lightFaceTotal', 'lightFacePick'].every(f => !/\b(for|loop|while)\b|lightFace\(/.test(body(w8, f)))
        && (body(w8, 'lightFaceTotal').match(/t \+= select/g) || []).length === 8
        && (body(w8, 'lightFacePick').match(/let w = select/g) || []).length === 8)
    /* ...and light sampling's side (materials_pbr.js) fetches one face and hands it on: no loop over the
       faces, one lightFace -- through the boundary since 0.36.0 (lightFaceAt, the face in engine units) -- and the
       shared functions (scene_api.js) none but that one, the boundary's, which fetches the face it is asked for */
    const pbr = readFileSync(new URL('../../lib/pathtracer/core/materials_pbr.js', import.meta.url), 'utf8')
    const api = readFileSync(new URL('../../lib/pathtracer/core/scene_api.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const apiBody = f => { const i = api.indexOf(`fn ${f}(`); return i < 0 ? '' : api.slice(i, api.indexOf('\n        }', i)) }
    ok('light sampling fetches one face, and the shared functions none but the boundary\'s one',
        !/<\s*LIGHT_FACES/.test(pbr) && (pbr.match(/\blightFace(At)?\(/g) || []).length === 1 && /\blightFaceAt\(/.test(pbr)
        && (api.match(/\blightFace\(/g) || []).length === 1 && /\blightFace\(/.test(apiBody('lightFaceAt')) && !/\b(for|loop|while)\b/.test(apiBody('lightFaceAt')))
}

//----------------------------------------------------------------------------------------------
// A RELIEF ON THE SCENE'S POINT (`world`, materials.js): taken only by a relief that names it, passed as the
// ray's own position in mm -- wherever the object is, in a group's children function too
//----------------------------------------------------------------------------------------------
{
    const d = Model.createDoc({ title: 'world' })
    Model.addMaterial(d, { id: 'pla' }); Model.setRelief(d, 'pla', 'layers')
    Model.addMaterial(d, { id: 'stone' }); Model.setRelief(d, 'stone', 'noise')
    Model.addObject(d, 'root', { id: 'a', primitive: 'box', material: 'pla' })
    Model.addObject(d, 'root', { id: 'b', primitive: 'box', material: 'stone' })
    Model.addGroup(d, 'root', { id: 'tw', code: 'warp(0.5);\nC = children(C, p);' })
    Model.addObject(d, 'tw', { id: 'c', primitive: 'sphere', material: 'pla' })
    const body = generate(Model.toTree(d), { id: 'built' }).body
    ok('a relief that reads world takes it', body.includes('fn relief_pla(q: VEC3, world: VEC3) -> vec2<f32> {'))
    ok('...and every object wearing it passes the ray\'s position in mm, in SDF and in a children function alike',
        body.split('relief_pla(p * (XF_S / XF_K) / mm(1.0), r.pos / mm(1.0))').length === 3
        && body.indexOf('fn children_tw(') < body.lastIndexOf('relief_pla(p * (XF_S / XF_K) / mm(1.0), r.pos / mm(1.0))'))
    ok('a relief that does not keeps its signature and its call', body.includes('fn relief_stone(q: VEC3) -> vec2<f32> {')
        && body.includes('relief_stone(p * (XF_S / XF_K) / mm(1.0));'))
    Model.setStraightMaterial(d, 'tw', true)
    ok('under a straight group: q from the material frame, world still the ray\'s',
        generate(Model.toTree(d), { id: 'built' }).body.includes('relief_pla(XF_Q * XF_QS / mm(1.0), r.pos / mm(1.0))'))
}

//----------------------------------------------------------------------------------------------
// THE MATERIAL FRAME (model.js setStraightMaterial): under a group with code marked straightMaterial, the
// materials of everything inside -- a relief, a p_local -- read a point moved by the transforms and no warp
//----------------------------------------------------------------------------------------------
{
    const make = ({ straight, relief = true, local = false, inner = false } = {}) => {
        const d = Model.createDoc({ title: 'straight' })
        // a relief on q alone (noise): the material frame is what q is; a relief on world reads the ray (below)
        Model.addMaterial(d, { id: 'pla' }); if (relief) Model.setRelief(d, 'pla', 'noise')
        if (local) Model.addMaterial(d, { id: 'wood', code: 'm.baseColor = fract(p_local) * R_local[0] * S_local;' })
        Model.addGroup(d, 'root', { id: 'tw', code: 'let a = p.z;\np = VEC3(cos(a) * p.x - sin(a) * p.y, sin(a) * p.x + cos(a) * p.y, p.z);\nwarp(0.5);\nC = children(C, p);' })
        if (straight) Model.setStraightMaterial(d, 'tw', true)
        let at = 'tw'
        if (inner) { Model.addGroup(d, 'tw', { id: 'bd', code: 'p.x = abs(p.x);\nwarp(1.0);\nC = children(C, p);' }); at = 'bd' }
        Model.addObject(d, at, { id: 'o', primitive: 'box', material: local ? 'wood' : 'pla' })
        Model.addObject(d, 'root', { id: 'out', primitive: 'sphere', material: 'pla' })       // beside it, not in it
        return d
    }
    const text = d => { const g = generate(Model.toTree(d), { id: 'built' }); return [g.body, g.pickWgsl] }
    // what codegen emits for it -- the body also holds scene_api.js's prelude, which declares the globals
    const EMITS = /xfq_|XF_Q = |XF_STRAIGHT = /
    const [plain] = text(make({ straight: false }))
    ok('without the setting: none of it in the shader', !EMITS.test(plain))
    const [body, pick] = text(make({ straight: true }))
    ok('the group starts the material frame from its own frame, before its code bends it',
        body.includes('XF_Q = p; XF_QM = XF_M; XF_QS = XF_S / XF_K; XF_STRAIGHT = true;')
        && body.indexOf('XF_Q = p; XF_QM') < body.indexOf('warp(0.5);'))
    ok('...and gives the old one back after it', body.includes('XF_Q = xfq_tw; XF_QM = xfqm_tw; XF_QS = xfqs_tw; XF_STRAIGHT = xfst_tw;'))
    ok('each transform inside moves it as it moves p', body.includes('XF_Q = xfPoint(XF_Q, UB.xf_o); XF_QM = XF_QM * xfRot(UB.xf_o); XF_QS = XF_QS * UB.xf_o[3].w;')
        && body.includes('XF_Q = xfq_o; XF_QM = xfqm_o; XF_QS = xfqs_o;'))
    ok('the relief inside reads it; the one beside it reads its own warped point, as before',
        body.includes('relief_pla(XF_Q * XF_QS / mm(1.0))') && body.includes('relief_pla(p * (XF_S / XF_K) / mm(1.0))'))
    ok('...the object beside it moves no material frame', !body.includes('xfq_out'))
    ok('SDF starts outside every straight group, and keeps the warps\' factor', body.includes('    XF_STRAIGHT = false;') && body.includes('    XF_K = 1.0;'))
    ok('the pick copy has it too (the capture a material\'s frame comes from)', pick.includes('XF_STRAIGHT = true;') && pick.includes('relief_pla(XF_Q * XF_QS / mm(1.0))'))
    // a material that reads its frame, and no relief: the local point is the straight one, and XF_K is kept for XF_QS
    const [loc] = text(make({ straight: true, relief: false, local: true }))
    ok('p_local under it is the straight point', loc.includes('let xfp_o = XF_P; XF_P = XF_Q;'))
    ok('...and XF_K is kept for its true scale, though no relief reads it', loc.includes('let xfkc_tw = XF_K;') && loc.includes('    XF_K = 1.0;'))
    const [none] = text(make({ straight: true, relief: false, local: false }))
    ok('nothing reads a material frame: nothing emitted, the setting or not', !EMITS.test(none))
    // a coded group inside keeps the frame straight: its own warp is not run on it, and it starts no frame
    const [nest] = text(make({ straight: true, inner: true }))
    ok('straight from there down: a group with code inside starts no frame of its own, and its child still reads it',
        !nest.includes('let xfst_bd') && nest.includes('relief_pla(XF_Q * XF_QS / mm(1.0))') && nest.split('XF_STRAIGHT = true;').length === 2)
    // a group without code has nothing to bend: marked or not, nothing
    const d = make({ straight: false })
    Model.addGroup(d, 'root', { id: 'plain' }); Model.setStraightMaterial(d, 'plain', true)
    Model.addObject(d, 'plain', { id: 'pb', primitive: 'box', material: 'pla' })
    ok('a group without code: the setting does nothing', !EMITS.test(text(d)[0]))
}

//----------------------------------------------------------------------------------------------
// GOLDEN SHADERS (fixtures/csg-v10/golden.mjs): every CSG case, every bundled and bench scene, off and
// live, must give exactly the texts and tables codegen gave when they were frozen -- which is what
// proves a change to how groups combine left old files alone. A difference in cases.json's render
// text is shown at its first line. Refreezing is for an agreed change only (golden.mjs says how).
//----------------------------------------------------------------------------------------------
{
    const G = await import('./fixtures/csg-v10/golden.mjs')
    const want = G.expected()
    const have = G.documents()
    eq('the golden holds the documents there are (a scene file added or removed is a refreeze)',
        have.map(([n]) => n), Object.keys(want))
    for (const [name, text] of have) for (const [mode, live] of Object.entries(G.MODES)) {
        const scene = G.sceneOf(text, live), got = G.fingerprint(scene), exp = want[name]?.[mode] || {}
        const moved = Object.keys(got).filter(k => got[k] !== exp[k])
        let where = ''
        if (name === 'cases.json' && moved.includes('wgsl')) {
            const a = G.casesText(mode).split('\n'), b = scene.wgsl.split('\n')
            const i = a.findIndex((l, k) => l !== b[k])
            where = `\n      first difference at line ${i + 1}:\n      was  ${a[i]}\n      now  ${b[i]}`
        }
        ok(`golden: ${name} (${mode}) is the shader it was`, !moved.length, `moved: ${moved.join(', ')}${where}`)
    }
}

//----------------------------------------------------------------------------------------------
// A MATERIAL'S RELIEF (materials.js RELIEFS): one function per material, a wrapper around every object
// wearing it -- inside its frame, folded before it leaves it -- in real mm at the frame's TRUE scale
//----------------------------------------------------------------------------------------------
{
    const { paramUniform, reliefName } = await import('../codegen.js')
    const d = Model.createDoc({ title: 'relief' })
    Model.addMaterial(d, { id: 'stone' }); Model.setRelief(d, 'stone', 'noise')
    Model.addObject(d, 'root', { id: 'a', primitive: 'box', material: 'stone' })      // a `size` of its own, as the relief has
    Model.addObject(d, 'root', { id: 'b', primitive: 'sphere', material: 'stone' })
    Model.addLight(d, 'root', { id: 'lamp' })
    Model.addGroup(d, 'root', { id: 'tw', code: 'warp(0.5);\nC = children(C, p);' })
    Model.addObject(d, 'tw', { id: 'c', primitive: 'box', material: 'stone' })
    const g = generate(Model.toTree(d), { id: 'built' })
    const body = g.body
    ok('one relief function per material, however many wear it', body.split('fn relief_stone(').length === 2)
    ok('...its parameters uniforms of its own: relief_<name>_<id>, the box\'s size its own',
        'relief_amplitude_stone' in g.uniforms && 'relief_size_stone' in g.uniforms && 'size_a' in g.uniforms)
    eq('paramUniform names a node\'s, a material\'s and a relief\'s alike', [paramUniform('a', 'size'), paramUniform('stone', 'k'), paramUniform('stone#relief', 'size')],
        ['size_a', 'k_stone', reliefName('stone', 'size')])
    ok('every object wearing it is wrapped: the relief called at its true scale in mm', body.split('relief_stone(p * (XF_S / XF_K) / mm(1.0))').length === 4)
    ok('...a light is not (it has no material to wear)', !/node lamp[^\n]*relief/.test(body))
    const blockOf = id => body.slice(body.indexOf(`// node ${id} `), body.indexOf(`XF_M = xfm_${id}; XF_S = xfs_${id};`) + 40)
    const A = blockOf('a')
    const folds = ['C = fold(C, VEC4(0.0, 0.0, 0.0, rs_a.w - sign(rs_a.w) * ra_a), rm_a);', 'C = foldRelief(C, rs_a.w - mm(hs.x) * XF_K, rm_a, 1.0 + hs.y, false);']
    ok('...folded before its frame is left, so a local point recorded is the object\'s (divided here: no CSG above)',
        folds.every(f => A.indexOf(f) > 0 && A.indexOf(f) < A.indexOf('XF_M = xfm_a;')))
    ok('...the object into a Hit of its own first', A.indexOf('var C = emptyHit(r);') > 0 && A.indexOf('var C = emptyHit(r);') < A.indexOf('let size = UB.size_a;'))
    ok('...skipped more than two amplitudes from the surface, towards zero inside or out', A.includes('if (abs(rs_a.w) > 2.0 * ra_a) { C = fold(C, VEC4(0.0, 0.0, 0.0, rs_a.w - sign(rs_a.w) * ra_a), rm_a); }'))
    ok('no XF_SUB around it when nothing reads a local point', !A.includes('XF_SUB'))
    ok('a warp\'s factor is kept and put back by the coded group, and SDF starts with none',
        body.includes('let xfkc_tw = XF_K;') && body.includes('XF_K = xfkc_tw;') && body.includes('    XF_K = 1.0;'))
    ok('the height comes back clamped to the amplitude', body.includes('return vec2<f32>(clamp(h, -UB.relief_amplitude_stone, UB.relief_amplitude_stone), max(slope, 0.0));'))
    const reliefLine = body.split('\n').findIndex(l => l.startsWith('let n = fbm3(q / size')) + 1
    eq('an error in the relief\'s code is reported at its own line, against <id>#relief', resolve(g.map, reliefLine)?.node, 'stone#relief')
    // with a local point read somewhere, XF_SUB goes up around the object's own Hit
    Model.addMaterial(d, { id: 'fixed', code: 'm.baseColor = fract(p_local);' })
    Model.addObject(d, 'root', { id: 'e', primitive: 'box', material: 'fixed' })
    ok('...and with one, XF_SUB goes up and down around the object\'s own Hit', /XF_SUB \+= 1u;[\s\S]*let size = UB.size_a;[\s\S]*XF_SUB -= 1u;/.test(generate(Model.toTree(d), { id: 'built' }).body))
    // a compile-time amplitude: a literal in the clamp and in the skip
    Model.setConstant(d, 'stone#relief', 'amplitude', 'f32')
    const k = generate(Model.toTree(d), { id: 'built' })
    ok('a compile-time amplitude is a literal, and no uniform', k.body.includes('clamp(h, -1.0, 1.0)') && k.body.includes('let ra_a = mm(1.0) * XF_K;')
        && !('relief_amplitude_stone' in k.uniforms))
    // A SCENE WITHOUT ONE is the shader it was: no XF_K anywhere in its own text
    const plain = Model.createDoc(); Model.addGroup(plain, 'root', { id: 'tw', code: 'warp(0.5);\nC = children(C, p);' })
    Model.addObject(plain, 'tw', { primitive: 'box' })
    ok('a scene with no relief has no XF_K of its own (its text is what it was)', !generate(Model.toTree(plain), { id: 'built' }).wgsl.includes('XF_K'))
}

//----------------------------------------------------------------------------------------------
// A RELIEF IN A CSG CHAIN (codegen reliefChain): the band widened by 5/4 of every blend that reads it, through plain
// groups, up to group code; the distance folded undivided (foldRelief, scene_api.js) and divided once, by XF_RL, at
// the chain's outermost group; a capture tagging the object at its own slope. A smooth blend's fillet lies off both
// children's surfaces, and was left bare.
//----------------------------------------------------------------------------------------------
{
    const d = Model.createDoc({ title: 'relief in a blend' })
    Model.addMaterial(d, { id: 'stone' }); Model.setRelief(d, 'stone', 'noise')
    Model.addGroup(d, 'root', { id: 'bu', blend: 0.5 })
    Model.addObject(d, 'bu', { id: 'a', primitive: 'box', material: 'stone' })
    Model.addObject(d, 'bu', { id: 'b', primitive: 'sphere', material: 'stone' })
    Model.addGroup(d, 'bu', { id: 'bi', blend: 0.2 })                                      // a CSG in the chain
    Model.addObject(d, 'bi', { id: 'c', primitive: 'box', material: 'stone' })
    Model.addObject(d, 'bi', { id: 'cc', primitive: 'sphere', join: 'intersect', joinBlend: 0.1 })   // a blend of its own
    Model.addGroup(d, 'bu', { id: 'pg' })                                                  // a plain group in it
    Model.addObject(d, 'pg', { id: 'e', primitive: 'box', material: 'stone' })
    Model.addGroup(d, 'bu', { id: 'tw', code: 'warp(0.5);\nC = children(C, p);' })        // code ends the chain
    Model.addObject(d, 'tw', { id: 'f', primitive: 'box', material: 'stone' })
    Model.addGroup(d, 'root', { id: 'cs', code: 'C = children(C, p);' })                  // a coded CSG starts one
    Model.addObject(d, 'cs', { id: 'g', primitive: 'box' })
    Model.addObject(d, 'cs', { id: 'gg', primitive: 'sphere', material: 'stone', join: 'subtract' })
    Model.addObject(d, 'root', { id: 'h', primitive: 'box', material: 'stone' })          // in no CSG at all
    Model.addGroup(d, 'root', { id: 'nr' })                                                // a CSG with no relief in it
    Model.addObject(d, 'nr', { id: 'n1', primitive: 'box' }); Model.addObject(d, 'nr', { id: 'n2', primitive: 'sphere', join: 'subtract' })
    Model.addGroup(d, 'root', { id: 'cw', code: 'C = children(C, p);' })                  // code above a chain's top
    Model.addGroup(d, 'cw', { id: 'cu' })
    Model.addObject(d, 'cu', { id: 'u1', primitive: 'box', material: 'stone' }); Model.addObject(d, 'cu', { id: 'u2', primitive: 'sphere', join: 'subtract' })
    const g = generate(Model.toTree(d), { id: 'built' })
    const body = g.body, pick = g.pickWgsl
    const skip = (id, reach) => `if (abs(rs_${id}.w) > 2.0 * ra_${id}${reach}) { C = fold(C, VEC4(0.0, 0.0, 0.0, rs_${id}.w - sign(rs_${id}.w) * ra_${id}), rm_${id}); }`
    const up = id => `C = foldRelief(C, rs_${id}.w - mm(hs.x) * XF_K, rm_${id}, 1.0 + hs.y, true); }`
    const divided = id => `C = foldRelief(C, rs_${id}.w - mm(hs.x) * XF_K, rm_${id}, 1.0 + hs.y, false); }`
    // bu's shapes: a, b, bi, pg, tw -- four joins after the base, each on bu's blend, and each reads the base and b
    ok('a smooth union\'s child: the band wider by 5/4 of every join that reads it', body.includes(skip('a', ' + 1.25 * 4.0 * UB.blend_bu')) && body.includes(skip('b', ' + 1.25 * 4.0 * UB.blend_bu')))
    ok('...its distance folded undivided, its slope left to the group', body.includes(up('a')) && body.includes(up('b')) && !body.includes(divided('a')))
    const B = body.slice(body.indexOf('// group bu'), body.indexOf('XF_M = xfm_bu; XF_S = xfs_bu;'))
    // ...outside a normal's look (scene_api.js NORMAL_LOOK, 0.71.1): there the division jumped at a band's edge
    const fin = 'C = fold(C, VEC4(k_bu.xyz, k_bu.w / select(XF_RL, 1.0, NORMAL_LOOK)), km_bu);'
    ok('...the group saves XF_RL and starts it at 1 before its children, divides its result by it once, and puts it back',
        B.indexOf('let xfrl_bu = XF_RL; XF_RL = 1.0;') > 0 && B.indexOf('let xfrl_bu = XF_RL; XF_RL = 1.0;') < B.indexOf('// node a')
        && B.indexOf(fin) > 0 && B.indexOf('XF_RL = xfrl_bu;') > B.indexOf(fin))
    ok('a CSG inside it: the reach is both groups\' joins (bi\'s and the two after it; cc\'s own blend), and the outer group divides',
        body.includes(skip('c', ' + 1.25 * (3.0 * UB.blend_bu + UB.jblend_cc)'))
        && body.includes(up('c')) && !body.includes('xfrl_bi') && body.includes('C = fold(C, k_bi, km_bi);'))
    ok('a plain group inside it: still the blend\'s (its own join and the one after)', body.includes(skip('e', ' + 1.25 * 2.0 * UB.blend_bu')) && body.includes(up('e')))
    ok('group code inside it ends the chain: wrapped as outside any CSG', body.includes(skip('f', '')) && body.includes(divided('f')))
    ok('a coded CSG group starts its own, in its children function', body.includes(skip('gg', ' + 1.25 * UB.blend_cs')) && body.includes(up('gg'))
        && body.indexOf('let xfrl_cs = XF_RL;') > body.indexOf('fn children_cs(') && body.indexOf('let xfrl_cs = XF_RL;') < body.indexOf('fn SDF('))
    ok('...and divides in a normal\'s look too: its code reads the result off the surface', body.includes('C = fold(C, VEC4(k_cs.xyz, k_cs.w / XF_RL), km_cs);'))
    ok('a chain\'s top under group code: divided in a normal\'s look too, as code reads it', body.includes(up('u1'))
        && body.includes('C = fold(C, VEC4(k_cu.xyz, k_cu.w / XF_RL), km_cu);') && (g.wgsl.match(/NORMAL_LOOK/g) || []).length === 1)
    ok('an object in no CSG: the wrapper it had', body.includes(skip('h', '')) && body.includes(divided('h')))
    ok('a CSG with no relief in it: the text it had', !body.includes('xfrl_nr') && body.includes('C = fold(C, k_nr, km_nr);'))
    ok('the pick copy defers and divides as the render copy does', pick.includes(up('a')) && pick.includes(up('c')) && pick.includes(fin))
    const { SCENE_PRELUDE } = await import('../../lib/pathtracer/core/scene_api.js')
    ok('...and foldRelief tags a deferred relief at its own slope under a capture alone (a pick, a local point)',
        SCENE_PRELUDE.includes('if (LOCAL_CAPTURE) { _ = fold(C, VEC4(0.0, 0.0, 0.0, d / slope), m); }')
        && SCENE_PRELUDE.includes('if (!deferred) { return fold(C, VEC4(0.0, 0.0, 0.0, d / slope), m); }'))
}

//----------------------------------------------------------------------------------------------
// PROFILES (BUILDER.md §6 phase 3): a profile parameter is compiled into a function of its own and reached through a
// handle -- never a uniform, the node's code untouched, the same numbering in every copy, and nothing at all in a
// scene without one
//----------------------------------------------------------------------------------------------
{
    const d = Model.createDoc()
    const exCode = 'C = add_new(C, extrude(outline, p, height), MATERIAL);'
    Model.addObject(d, 'root', { id: 'ex', params: { outline: Model.DEFAULT_PROFILE(), height: 0.5 }, code: exCode })
    const g = Model.addGroup(d, 'root', { id: 'g' })
    Model.addObject(d, 'g', { id: 'rv', params: { knob: [[0, -0.5], [0.6, -0.5, 0.1], [0.6, 0.1], [0, 0.6]], other: [[0, 0], [1, 0], [0, 1]] },
        code: 'C = add_new(C, revolve(knob, p), MATERIAL);' })
    const G = generate(Model.toTree(d))
    ok('a profile is no uniform; the number beside it is', !Object.keys(G.uniforms).some(k => /^(outline|knob|other)_/.test(k)) && 'height_ex' in G.uniforms,
        Object.keys(G.uniforms).filter(k => /_ex$|_rv$/.test(k)).join(', '))
    ok('its alias is its handle, in tree order', /const outline: u32 = 0u;/.test(G.wgsl) && /const knob: u32 = 1u;/.test(G.wgsl) && /const other: u32 = 2u;/.test(G.wgsl))
    for (const f of ['prof_ex_outline', 'prof_rv_knob', 'prof_rv_other'])
        ok(`${f}: compiled into its own function`, new RegExp(`fn ${f}\\(q: VEC2, axis: bool\\) -> VEC3 \\{`).test(G.wgsl))
    ok('the three a node calls, once each', ['profile', 'extrude', 'revolve'].every(f => (G.wgsl.match(new RegExp(`fn ${f}\\(id: u32`, 'g')) || []).length === 1))
    ok('...each handle a case of profile and of revolve', [0, 1, 2].every(i => (G.wgsl.match(new RegExp(`case ${i}u: \\{ (return|g =) prof_`, 'g')) || []).length === 2))
    ok('revolve asks for the axis edges left out, profile does not', /case 1u: \{ g = prof_rv_knob\(q, true\); \}/.test(G.wgsl) && /case 1u: \{ return prof_rv_knob\(q, false\); \}/.test(G.wgsl))
    ok('the node\'s code is in the shader as written', G.wgsl.includes(exCode))
    ok('the pick copy has them too, numbered alike', /const knob: u32 = 1u;/.test(G.pickWgsl) && /fn prof_rv_knob\(/.test(G.pickWgsl))
    const plain = Model.createDoc(); Model.addObject(plain, 'root', { primitive: 'box' })
    ok('a scene without a profile has none of it', !/fn (profile|extrude|revolve|prof_)\w*\(/.test(generate(Model.toTree(plain)).wgsl))
    ok('aliasPrelude: a profile without a handle points at none (the dispatchers answer nothing)',
        aliasPrelude('x', { o: [[0, 0], [1, 0], [0, 1]] }, null).includes('const o: u32 = 4294967295u;'))
    ok('isProfile: a list of points, not a list of numbers', isProfile([[0, 0], [1, 0], [0, 1]]) && !isProfile([1, 2, 3]) && !isProfile([]))
}

//----------------------------------------------------------------------------------------------
// PATHS (BUILDER.md §6 phase 4): a path parameter is compiled into two functions of its own and reached through a
// handle numbered apart from the profiles' -- never a uniform, the node's code untouched, the same in every copy;
// tube in any scene with a path, sweep only where there is a profile to sweep; nothing in a scene without one
//----------------------------------------------------------------------------------------------
{
    const d = Model.createDoc()
    const tbCode = 'C = add_new(C, tube(route, p, radius, rounded), MATERIAL);'
    Model.addObject(d, 'root', { id: 'tb', params: { route: { path: [[0, 0, 0], [1, 0, 0, 0.2], [1, 1, 0]] }, radius: 0.1, rounded: 0 }, code: tbCode })
    const g = Model.addGroup(d, 'root', { id: 'g' })
    Model.addObject(d, 'g', { id: 'sw', params: { section: Model.DEFAULT_PROFILE(), lane: { path: [[0, 0, 0], [0, 0, 1], [1, 0, 1]] }, way: Model.DEFAULT_PATH() },
        code: 'C = add_new(C, sweep(lane, section, p), MATERIAL);' })
    const G = generate(Model.toTree(d))
    ok('a path is no uniform; the numbers beside it are', !Object.keys(G.uniforms).some(k => /^(route|lane|way|section)_/.test(k)) && 'radius_tb' in G.uniforms && 'rounded_tb' in G.uniforms,
        Object.keys(G.uniforms).filter(k => /_tb$|_sw$/.test(k)).join(', '))
    ok('its alias is its handle, in tree order, numbered apart from the profile beside it',
        /const route: u32 = 0u;/.test(G.wgsl) && /const lane: u32 = 1u;/.test(G.wgsl) && /const way: u32 = 2u;/.test(G.wgsl) && /const section: u32 = 0u;/.test(G.wgsl))
    for (const f of ['path_tb_route', 'path_sw_lane', 'path_sw_way'])
        ok(`${f}: compiled into its two functions`, new RegExp(`fn ${f}_near\\(p: VEC3\\) -> PathNear \\{`).test(G.wgsl) && new RegExp(`fn ${f}_sweep\\(p: VEC3, prof: u32, r: FLOAT, e: FLOAT\\) -> VEC4 \\{`).test(G.wgsl))
    ok('tube, sweep, pathCross and profileReach, once each', ['tube', 'sweep', 'pathCross', 'profileReach'].every(f => (G.wgsl.match(new RegExp(`fn ${f}\\(`, 'g')) || []).length === 1))
    ok('...tube a case per path, rounded and flat, its flat fold the circle within its radius',
        [0, 1, 2].every(i => new RegExp(`case ${i}u: \\{ A = path_\\w+_near\\(p\\); \\}`).test(G.wgsl) && new RegExp(`case ${i}u: \\{ return path_\\w+_sweep\\(p, 4294967295u, r, r\\); \\}`).test(G.wgsl)))
    ok('...sweep a case per path, the profile within its reach', [0, 1, 2].every(i => new RegExp(`case ${i}u: \\{ return path_\\w+_sweep\\(p, outline, 0\\.0, e\\); \\}`).test(G.wgsl)))
    ok('...pathCross the circle for a tube, a profile otherwise', /if \(prof != 4294967295u\) \{ return profile\(prof, q\); \}/.test(G.wgsl))
    ok('...profileReach the default profile\'s farthest corner', /case 0u: \{ return 0\.7071067811865476; \}/.test(G.wgsl), (G.wgsl.match(/fn profileReach[\s\S]*?\n\}/) || [''])[0])
    ok('the node\'s code is in the shader as written', G.wgsl.includes(tbCode))
    ok('the pick copy has them too, numbered alike', /const lane: u32 = 1u;/.test(G.pickWgsl) && /fn path_sw_lane_sweep\(/.test(G.pickWgsl) && /fn tube\(/.test(G.pickWgsl))
    const onlyTube = Model.createDoc()
    Model.addObject(onlyTube, 'root', { id: 'tb', params: { route: Model.DEFAULT_PATH() }, code: 'C = add_new(C, tube(route, p, 0.1, 1.0), MATERIAL);' })
    const T = generate(Model.toTree(onlyTube)).wgsl
    ok('a scene with a path and no profile: tube, pathCross the circle alone, no sweep and no profileReach',
        /fn tube\(/.test(T) && /fn pathCross\(/.test(T) && !/profile\(prof/.test(T) && !/fn (sweep|profileReach|profile)\(/.test(T))
    const plain = Model.createDoc(); Model.addObject(plain, 'root', { primitive: 'box' })
    ok('a scene without a path has none of it', !/fn (tube|sweep|pathCross|profileReach|path_)\w*\(/.test(generate(Model.toTree(plain)).wgsl))
    ok('aliasPrelude: a path without a handle points at none (the dispatchers answer nothing)',
        aliasPrelude('x', { r: { path: [[0, 0, 0], [1, 0, 0]] } }, null).includes('const r: u32 = 4294967295u;'))
    ok('isPath: { path } and nothing else; isCompiledIn: a profile or a path',
        isPath({ path: [] }) && !isPath([[0, 0, 0]]) && !isPath({ x: 1 }) && !isPath(null) && isCompiledIn([[0, 0], [1, 0], [0, 1]]) && isCompiledIn({ path: [] }) && !isCompiledIn({ x: 1, y: 2, z: 3 }))
}

//----------------------------------------------------------------------------------------------
// LIVE PATHS (2026-10-01): a path's points may name its node's parameters, and a live path's pieces are uniforms the
// builder rewrites as they move. THE EQUIVALENCE: the live text with every uniform read replaced by its default's
// literal IS the compiled text -- the same chain, only where the numbers come from differs. And a live update is
// exactly what a fresh compile of the changed document would declare.
//----------------------------------------------------------------------------------------------
{
    const lit = x => { const s = String(x === 0 ? 0 : x); return /[.eE]/.test(s) ? s : s + '.0' }     // core/shapes.js lit
    const make = (live, extra = {}) => {
        const d = Model.createDoc()
        Model.addObject(d, 'root', { id: 'tb', params: { rise: 0.6, r: 0.2, w: 1, route: { path: [[0, 0, 0], ['w', 0, 0, 'r'], ['w', 1, 0, 'r'], ['w', 1, 'rise']], ...(live ? { live: true } : {}) }, ...extra },
            code: 'C = add_new(C, tube(route, p, 0.1, 0.0), MATERIAL);' })
        return d
    }
    const L = generate(Model.toTree(make(true))), C = generate(Model.toTree(make(false)))
    const names = Object.keys(L.uniforms).filter(k => k.startsWith('_p'))
    eq('a live path declares a mat4 a piece, a vec4 a bend\'s frame, and its ok', names.map(k => `${k}:${L.uniforms[k].type}`), [
        '_pp0_route_tb:mat4x4<f32>', '_pp1_route_tb:mat4x4<f32>', '_pf1_route_tb:vec4<f32>', '_pp2_route_tb:mat4x4<f32>', '_pp3_route_tb:mat4x4<f32>',
        '_pf3_route_tb:vec4<f32>', '_pp4_route_tb:mat4x4<f32>', '_pn_route_tb:f32', '_pok_route_tb:f32'])
    ok('...a compiled one none', !Object.keys(C.uniforms).some(k => k.startsWith('_p')))
    ok('...and the parameters its points name are uniforms as ever', ['rise_tb', 'r_tb', 'w_tb'].every(k => k in L.uniforms))
    const region = w => w.slice(w.indexOf('// THE PATHS'), w.indexOf('fn pathCross'))
    /* THE SLOTS UNDONE (2026-10-02: a live chain is written by position, each slot on or off -- core/shapes.js
       pathSlotsOf): a slot that is off left out, one that is on unwrapped, a segment's first and last read from its
       uniform. What is left must be the compiled chain, its numbers read. */
    const unslot = (w, U) => {
        const out = [], lines = w.split('\n')
        for (let i = 0; i < lines.length; i++) {
            let m = /^    if \(UB\.(_pp\d+_\w+)\[1\]\.w > 0\.5\) \{ (.*) \}$/.exec(lines[i])          // _near: a line a slot
            if (m) { if (U[m[1]].def[7] > 0.5) out.push('    ' + m[2]); continue }
            m = /^    if \(UB\.(_pp\d+_\w+)\[1\]\.w > 0\.5\) \{$/.exec(lines[i])                    // _sweep: a block a slot
            if (m) {
                const on = U[m[1]].def[7] > 0.5
                if (on) out.push('    {')
                for (i++; lines[i] !== '    }'; i++) if (on) out.push(lines[i])
                if (on) out.push('    }')
                continue
            }
            out.push(lines[i])
        }
        return out.join('\n').replace(/UB\.(_pp\d+_\w+)\[([23])\]\.w > 0\.5/g, (m, n, c) => String(U[n].def[4 * c + 3] > 0.5))
    }
    const sub = unslot(unloop(region(L.wgsl)), L.uniforms)
        .replace(/UB\.(_pp\d+_\w+)\[(\d)\]\.(xyz|w)/g, (m, n, col, sw) => {
            const d = L.uniforms[n].def, c = 4 * col
            return sw === 'w' ? lit(d[c + 3]) : `VEC3(${lit(d[c])}, ${lit(d[c + 1])}, ${lit(d[c + 2])})`
        })
        .replace(/UB\.(_pf\d+_\w+)/g, (m, n) => `VEC4(${L.uniforms[n].def.map(lit).join(', ')})`)
        .split('\n').filter(l => !/_pok_/.test(l)).join('\n').replace(/, live: its pieces are uniforms, room for \d+ points/, '')
    ok('THE EQUIVALENCE: the live chain, its slots that are off left out and its reads replaced by their defaults, is the compiled chain line for line',
        sub === region(C.wgsl), sub.split('\n').find((l, i) => l !== region(C.wgsl).split('\n')[i]))
    ok('...and the compiled one has the names read: its last run starts at w, 1, r and is rise - r long',
        /pnSegment\(A, p, VEC3\(1\.0, 1\.0, 0\.2\d*\), VEC3\(0\.0, 0\.0, 1\.0\), 0\.399/.test(C.wgsl))
    ok('the live functions draw nothing while ok is 0', /fn path_tb_route_near\(p: VEC3\) -> PathNear \{\n    if \(UB\._pok_route_tb < 0\.5\) \{ return PathNear/.test(L.wgsl)
        && /if \(UB\._pok_route_tb < 0\.5\) \{ return VEC4\(0\.0, 0\.0, 1\.0, 1\.0e7\); \}/.test(L.wgsl))
    ok('the pick copy reads the same uniforms', L.pickWgsl.includes('case 3u: { return PathSlot(UB._pp3_route_tb, UB._pf3_route_tb, mat2x4<f32>()); }'))
    /* A LOOP, not a copy a slot (2026-10-02: the light guide edited in the picture had its section at 51 places, and
       compiled for 70 s): the cross-section at one place for the segments and four for the bends, whatever the room;
       the loop as far as the last slot on; each case of the accessor its own slot */
    const at = w => (region(w).match(/pathCross\(/g) || []).length
    const roomy = generate(...Model.generateArgs(make(true), { editing: ['tb.route'] }))
    eq('the section at 5 places in the live sweep, at 4 points of room and at 12 alike', [at(L.wgsl), at(roomy.wgsl)], [5, 5])
    eq('...the loop runs to the last slot on: 5 of 5, and of 21', [L.uniforms[pathCountName('tb', 'route')].def, roomy.uniforms[pathCountName('tb', 'route')].def], [5, 5])
    ok('...every case its own slot\'s uniforms', roomy.wgsl.split('\n').filter(l => /^        case \d+u: \{ return PathSlot/.test(l))
        .every(l => { const [, n, m] = /case (\d+)u: \{ return PathSlot\(UB\._pp(\d+)_/.exec(l); return n === m && (n % 2 ? l.includes(`UB._pf${n}_route_tb`) : l.includes('vec4<f32>()')) }))
    eq('the scene says which paths a live change can reach, their room, and their chains', L.pointParams, [{ kind: 'path', id: 'tb', k: 'route', live: true, room: 4, deps: ['w', 'r', 'rise'], signature: 'sbsbs' }])
    eq('...a compiled one that names parameters too (it recompiles when they move)', C.pointParams, [{ kind: 'path', id: 'tb', k: 'route', live: false, deps: ['w', 'r', 'rise'], signature: 'sbsbs' }])

    // A LIVE UPDATE IS A FRESH COMPILE'S DEFAULTS
    const d = make(true), o = d.root.children[0]
    o.params.rise = 0.9; o.params.r = 0.3
    const u = livePointsUpdate(d, 'tb', 'rise', L.pointParams), fresh = generate(Model.toTree(d)).uniforms
    ok('a named parameter moved: no recompile, every piece written', !u.restructure && names.every(k => k in u.set), JSON.stringify(Object.keys(u.set)))
    ok('...each exactly what a fresh compile of the document declares', names.every(k => JSON.stringify(u.set[k]) === JSON.stringify(fresh[k].def)) && u.set[pathOkName('tb', 'route')] === 1)
    ok('...and the path itself edited the same way (a typed edit in live mode)', !livePointsUpdate(d, 'tb', 'route', L.pointParams).restructure)
    eq('a parameter it does not name: nothing', livePointsUpdate(d, 'tb', 'radius', L.pointParams), { set: {}, restructure: false })
    /* A NAME TYPED IN SINCE THE COMPILE (the user, 2026-10-02: "only after I press apply route every time I change the
       slider"): a live path's typed edit compiles nothing, so the scene's list of what it reads is the old one -- what
       it reads NOW is the document's */
    Model.addParam(d, 'tb', 'rad', 0.25)
    o.params.route.path[1] = ['w', 0, 0, 'rad']
    const typed = livePointsUpdate(d, 'tb', 'rad', L.pointParams)
    ok('a parameter named since the compile moves the path too: its pieces written', !typed.restructure && names.every(k => k in typed.set)
        && JSON.stringify(typed.set[pathPieceName('tb', 'route', 1)]) === JSON.stringify(generate(Model.toTree(d)).uniforms[pathPieceName('tb', 'route', 1)].def), JSON.stringify(Object.keys(typed.set)))
    o.params.route.path[1] = ['w', 0, 0, 'r']; delete o.params.rad
    eq('...nor another node\'s', livePointsUpdate(d, 'zz', 'rise', L.pointParams), { set: {}, restructure: false })
    o.params.rise = 0.1                                          // the last edge shorter than its fillet
    eq('unsound now: ok 0, the path draws nothing, no recompile', livePointsUpdate(d, 'tb', 'rise', L.pointParams), { set: { [pathOkName('tb', 'route')]: 0 }, restructure: false })
    o.params.rise = 0.6; o.params.r = 0                          // a fillet 0 is still a bend (a fan): the same chain
    ok('a fillet to 0: the same chain, written', !livePointsUpdate(d, 'tb', 'r', L.pointParams).restructure)
    o.params.route.path[2] = ['w', 0, 0, 'r']; o.params.route.path[1] = ['w / 2', 0, 0, 'r']    // a corner made straight on: one bend less
    const straight = livePointsUpdate(d, 'tb', 'route', L.pointParams), fs = generate(Model.toTree(d)).uniforms
    ok('a corner made straight on: its bend\'s slot off -- written, no recompile (2026-10-02: the chain is slots)', !straight.restructure
        && straight.set[pathPieceName('tb', 'route', 1)][7] === 0 && names.every(k => JSON.stringify(straight.set[k]) === JSON.stringify(fs[k].def)), JSON.stringify(straight))
    o.params.route.path.push([2, 1, 0.6])
    ok('a point more than it has room for: a recompile', livePointsUpdate(d, 'tb', 'route', L.pointParams).restructure)
    const dc = make(false); dc.root.children[0].params.rise = 0.9
    ok('a compiled path that names the parameter: a recompile', livePointsUpdate(dc, 'tb', 'rise', C.pointParams).restructure)
    // A COMPILED PATH UNSOUND AS IT IS: nothing
    const bad = make(false); bad.root.children[0].params.rise = 0.1
    const B = generate(Model.toTree(bad))
    ok('a compiled path unsound at its values draws nothing: two functions that return far', /fn path_tb_route_near\(p: VEC3\) -> PathNear \{ return PathNear\(VEC3\(0\.0, 0\.0, 0\.0\), 1\.0e14/.test(B.wgsl)
        && /fn path_tb_route_sweep\([^)]*\) -> VEC4 \{ return VEC4\(0\.0, 0\.0, 1\.0, 1\.0e7\); \}/.test(B.wgsl) && B.pointParams[0].signature === 'x')
    const badLive = make(true); badLive.root.children[0].params.rise = 0.1
    const BL = generate(Model.toTree(badLive))
    const madeSound = (() => { badLive.root.children[0].params.rise = 0.6; return livePointsUpdate(badLive, 'tb', 'rise', BL.pointParams) })()
    ok('...and a live one too: its slots all off, ok 0; made sound, it is written, no recompile', BL.uniforms[pathOkName('tb', 'route')].def === 0
        && Object.entries(BL.uniforms).filter(([k]) => /^_pp/.test(k)).every(([, u]) => u.def[7] === 0) && BL.pointParams[0].signature === 'x'
        && !madeSound.restructure && madeSound.set[pathOkName('tb', 'route')] === 1, JSON.stringify(madeSound))
}

//----------------------------------------------------------------------------------------------
// VARYING PATHS (2026-10-02): a point's scale x, scale y and twist. A path whose every value is the default is the text
// it was, written out or not; one with a value off them is written in the varying form -- its rounded tube its own
// _tube (round cones), its sweep the V calls (core/shapes.js) -- the values literals, or uniforms when live, and THE
// EQUIVALENCE again; a live one that starts or stops varying outside the picture compiles once, and one edited in the
// picture is varying from the start, so a scale dragged there is written
//----------------------------------------------------------------------------------------------
{
    const lit = x => { const s = String(x === 0 ? 0 : x); return /[.eE]/.test(s) ? s : s + '.0' }     // core/shapes.js lit
    const v3 = d => `VEC3(${lit(d[0])}, ${lit(d[1])}, ${lit(d[2])})`
    const make = (live, values = true, plain = null) => {
        const d = Model.createDoc()
        const route = { path: plain ?? [[0, 0, 0, 0, 1], ['w', 0, 0, 'r', 1.5, 'sy', 30], ['w', 1, 0, 'r'], ['w', 1, 'rise', ...(values ? [0, 1, 1, 90] : [])]],
                        ...(live ? { live: true } : {}) }
        if (!values && !plain) route.path[1] = ['w', 0, 0, 'r']
        Model.addObject(d, 'root', { id: 'tb', params: { rise: 0.6, r: 0.2, w: 1, sy: 0.5, route, outline: [[0, 0], [0.1, 0], [0.1, 0.05], [0, 0.05]] },
            code: 'C = add_new(C, tube(route, p, 0.1, 1.0), MATERIAL);\nC = add_new(C, sweep(route, outline, p), MATERIAL);' })
        return d
    }
    const gen = (d, editing) => generate(...Model.generateArgs(d, editing ? { editing } : {}))
    const region = w => w.slice(w.indexOf('// THE PATHS'), w.indexOf('fn pathCross'))
    // EVERY VALUE THE DEFAULT: the text it was
    const P0 = gen(make(false, false))
    const pts = [[0, 0, 0], [1, 0, 0, 0.2], [1, 1, 0, 0.2], [1, 1, 0.6]]
    ok('a path whose values are all the default, written out, is the text of one without them',
        gen(make(false, false, pts.map(p => [...p, ...(p.length < 4 ? [0] : []), 1, 1, 0]))).wgsl === gen(make(false, false, pts)).wgsl)
    ok('...the form there was: _near and the plain calls, no _tube, no values', /fn path_tb_route_near\(/.test(P0.wgsl) && !/_tube\(|swSegLocalV|swRescale\(path|_pv\d/.test(P0.wgsl)
        && !P0.pointParams[0].vary)
    // COMPILED, VARYING: the values as literals
    const C = gen(make(false))
    ok('a varying path: its _tube and _sweep, and no _near', /fn path_tb_route_tube\(p: VEC3, r: FLOAT\) -> VEC4 \{/.test(C.wgsl) && /fn path_tb_route_sweep\(p: VEC3, prof: u32, r: FLOAT, e: FLOAT\) -> VEC4 \{/.test(C.wgsl)
        && !/fn path_tb_route_near\(/.test(C.wgsl))
    ok('...a round cone a segment, its radii r times each end\'s scale x; a bend\'s ball r times its corner\'s',
        C.wgsl.includes('r * (VEC3(1.0, 1.0, 0.0)).x, r * (VEC3(1.5, 0.5, 0.5235987755982988)).x') && /A = pdBend\([^;]*r \* \(VEC3\(1\.5, 0\.5, 0\.5235987755982988\)\)\.x\);/.test(C.wgsl))
    ok('...its segments the V calls with both ends\' values, its bends the section held, scaled and turned',
        /swSegLocalV\(p, [^;]*VEC3\(1\.0, 1\.0, 0\.0\), VEC3\(1\.5, 0\.5, 0\.5235987755982988\), asTube, e\)/.test(C.wgsl)
        && C.wgsl.includes('let v = swRound(VEC3(1.5, 0.5, 0.5235987755982988), asTube);') && C.wgsl.includes('swRescale(pathCross(prof, r, swUnscale(b.q, v)), v, b.q, e)'))
    ok('...the rounded tube asks it for its own; the flat tube and the sweep call _sweep as ever',
        C.wgsl.includes('case 0u: { return path_tb_route_tube(p, r); }') && C.wgsl.includes('case 0u: { return path_tb_route_sweep(p, 4294967295u, r, r); }')
        && C.wgsl.includes('case 0u: { return path_tb_route_sweep(p, outline, 0.0, e); }'))
    ok('...the pick copy alike', /fn path_tb_route_tube\(/.test(C.pickWgsl) && C.pickWgsl.includes('return path_tb_route_tube(p, r);'))
    ok('...and with every path varying, no closest point and no return after the switch -- Tint called it unreachable (2026-10-02)',
        !/var A = pnStart\(\);/.test(C.wgsl) && !/return VEC4\(safeDir\(p - A\.c, A\.n\)/.test(C.wgsl))
    {
        const mixed = make(false)
        Model.addObject(mixed, 'root', { id: 'pl', params: { route: { path: [[0, 0, 0], [1, 0, 0]] } }, code: 'C = add_new(C, tube(route, p, 0.1, 1.0), MATERIAL);' })
        const X = gen(mixed).wgsl
        ok('...a varying path beside a plain one: the plain one\'s closest point, and the return after the switch, kept',
            X.includes('case 1u: { A = path_pl_route_near(p); }') && /var A = pnStart\(\);/.test(X) && /return VEC4\(safeDir\(p - A\.c, A\.n\), sqrt\(A\.d2\) - r\);/.test(X))
    }
    eq('...and the scene says it varies', C.pointParams.map(P => [P.k, P.vary]), [['route', true]])
    // LIVE, VARYING: the values uniforms -- a mat2x4 a segment slot, a vec4 a bend's
    const L = gen(make(true))
    eq('a live varying path declares its values: (va, 0) (vb, 0) a segment, (v, 0) a bend', Object.keys(L.uniforms).filter(k => k.startsWith('_pv')).map(k => [k, L.uniforms[k].type, L.uniforms[k].def.map(x => +x.toFixed(4))]), [
        ['_pv0_route_tb', 'mat2x4<f32>', [1, 1, 0, 0, 1.5, 0.5, 0.5236, 0]], ['_pv1_route_tb', 'vec4<f32>', [1.5, 0.5, 0.5236, 0]],
        ['_pv2_route_tb', 'mat2x4<f32>', [1.5, 0.5, 0.5236, 0, 1, 1, 0, 0]], ['_pv3_route_tb', 'vec4<f32>', [1, 1, 0, 0]],
        ['_pv4_route_tb', 'mat2x4<f32>', [1, 1, 0, 0, 1, 1, 1.5708, 0]]])
    ok('...and none when it does not vary', !Object.keys(gen(make(true, false)).uniforms).some(k => k.startsWith('_pv')))
    /* THE EQUIVALENCE, varying: the live chain, its slots that are off left out and every read replaced by its default,
       is the compiled chain line for line */
    const unslot = (w, U) => {
        const out = [], lines = w.split('\n')
        for (let i = 0; i < lines.length; i++) {
            let m = /^    if \(UB\.(_pp\d+_\w+)\[1\]\.w > 0\.5\) \{ (.*) \}$/.exec(lines[i])
            if (m) { if (U[m[1]].def[7] > 0.5) out.push('    ' + m[2]); continue }
            m = /^    if \(UB\.(_pp\d+_\w+)\[1\]\.w > 0\.5\) \{$/.exec(lines[i])
            if (m) {
                const on = U[m[1]].def[7] > 0.5
                if (on) out.push('    {')
                for (i++; lines[i] !== '    }'; i++) if (on) out.push(lines[i])
                if (on) out.push('    }')
                continue
            }
            out.push(lines[i])
        }
        return out.join('\n').replace(/UB\.(_pp\d+_\w+)\[([23])\]\.w > 0\.5/g, (m, n, c) => String(U[n].def[4 * c + 3] > 0.5))
    }
    const sub = unslot(unloop(region(L.wgsl)), L.uniforms)
        .replace(/UB\.(_pp\d+_\w+)\[(\d)\]\.(xyz|w)/g, (m, n, col, sw) => {
            const d = L.uniforms[n].def, c = 4 * col
            return sw === 'w' ? lit(d[c + 3]) : v3(d.slice(c, c + 3))
        })
        .replace(/UB\.(_pf\d+_\w+)/g, (m, n) => `VEC4(${L.uniforms[n].def.map(lit).join(', ')})`)
        .replace(/UB\.(_pv\d+_\w+)\[(\d)\]\.xyz/g, (m, n, col) => v3(L.uniforms[n].def.slice(4 * col, 4 * col + 3)))
        .replace(/UB\.(_pv\d+_\w+)\.xyz/g, (m, n) => v3(L.uniforms[n].def))
        .split('\n').filter(l => !/_pok_/.test(l)).join('\n').replace(/, live: its pieces are uniforms, room for \d+ points/, '')
    ok('THE EQUIVALENCE, varying: the live chain, its slots off left out and its reads their defaults, is the compiled chain line for line',
        sub === region(C.wgsl), sub.split('\n').find((l, i) => l !== region(C.wgsl).split('\n')[i]))
    // A LIVE UPDATE: the values written, what a fresh compile declares
    const d = make(true), o = d.root.children[0]
    const same = (u, d2, editing) => { const fresh = gen(d2, editing).uniforms; return !u.restructure && Object.keys(u.set).some(k => k.startsWith('_pv'))
        && Object.entries(u.set).every(([k, v]) => JSON.stringify(v) === JSON.stringify(fresh[k]?.def)) }
    o.params.sy = 0.8
    ok('a parameter a value names, moved: its values written as a fresh compile declares them, no compile', same(livePointsUpdate(d, 'tb', 'sy', L.pointParams), d))
    o.params.route.path[3] = ['w', 1, 'rise', 0, 2, 1, 45]
    ok('...a value typed in: the same', same(livePointsUpdate(d, 'tb', 'route', L.pointParams), d))
    o.params.route.path = [[0, 0, 0], ['w', 0, 0, 'r'], ['w', 1, 0, 'r'], ['w', 1, 'rise']]
    ok('...every value back to the default, outside the picture: a compile (the form it is written in changes)', livePointsUpdate(d, 'tb', 'route', L.pointParams).restructure)
    const N = gen(make(true, false)), dn = make(true, false)
    dn.root.children[0].params.route.path[1] = ['w', 0, 0, 'r', 2]
    ok('a live path that did not vary, given a scale outside the picture: a compile, once', livePointsUpdate(dn, 'tb', 'route', N.pointParams).restructure)
    // EDITED IN THE PICTURE: varying from the start, so the first scale dragged is written
    const E = gen(make(false, false), ['tb.route'])
    eq('a path edited in the picture is varying whatever its values', E.pointParams.map(P => [P.k, P.vary, P.edited, P.forced]), [['route', true, true, true]])
    ok('...its values uniforms, every one the default', Object.entries(E.uniforms).filter(([k]) => k.startsWith('_pv') && !/^_pv\d+_route_tb$/.test(k)).length === 0
        && E.uniforms[pathValuesName('tb', 'route', 0)].def.join() === '1,1,0,0,1,1,0,0')
    const de = make(false, false)
    de.root.children[0].params.route.path[1] = ['w', 0, 0, 'r', 1.4, 0.7, 15]
    ok('...a scale and twist dragged there: written, no compile', same(livePointsUpdate(de, 'tb', 'route', E.pointParams), de, ['tb.route']))
    de.root.children[0].params.route.path[1] = ['w', 0, 0, 'r']
    ok('...and back to the defaults there: still written (it stays varying while edited)', !livePointsUpdate(de, 'tb', 'route', E.pointParams).restructure)
}

//----------------------------------------------------------------------------------------------
// LIVE PROFILES (2026-10-02), as live paths: one mat2x4 a piece, an ok and a reach; THE EQUIVALENCE with the compiled
// text; an update equals a fresh compile; the booleans a compiled profile writes as literals (an axis edge, an arc's
// side) are numbers, written, not recompiled; a fillet appearing changes the chain
//----------------------------------------------------------------------------------------------
{
    const lit = x => { const s = String(x === 0 ? 0 : x); return /[.eE]/.test(s) ? s : s + '.0' }     // core/shapes.js lit
    const make = (live, extra = {}) => {
        const d = Model.createDoc()
        Model.addObject(d, 'root', { id: 'pl', params: { w: 1, h: 1, m: 1.5, r: 0.1, outline: [[0, 0], ['w * 2', 0, 'r'], ['w * 2', 'h'], ['w', 'm', 'r'], [0, 'h']], ...extra },
            code: 'C = add_new(C, extrude(outline, p, 0.2), MATERIAL);' })
        Model.addObject(d, 'root', { id: 'rv', params: { rad: 0.6, x0: 0, knob: [[0, -0.5], ['rad', -0.5, 0.1], ['rad', 0.5], ['x0', 0.5]] },
            code: 'C = add_new(C, revolve(knob, p), MATERIAL);' })
        if (live) { Model.setProfileLive(d, 'pl', 'outline', true); Model.setProfileLive(d, 'rv', 'knob', true) }
        return d
    }
    const L = generate(Model.toTree(make(true))), C = generate(Model.toTree(make(false)))
    const names = Object.keys(L.uniforms).filter(k => k.startsWith('_q'))
    ok('a live profile declares a mat2x4 a piece, its ok and its reach', names.length > 0
        && names.every(k => L.uniforms[k].type === (/^_qp\d/.test(k) ? 'mat2x4<f32>' : 'f32'))
        && ['_qok_outline_pl', '_qre_outline_pl', '_qok_knob_rv', '_qre_knob_rv'].every(k => k in L.uniforms), names.join(', '))
    ok('...a compiled one none', !Object.keys(C.uniforms).some(k => k.startsWith('_q')))
    const region = w => w.slice(w.indexOf('// THE PROFILES'), w.indexOf('fn profile(id'))
    const D = n => L.uniforms[n].def
    // THE SLOTS UNDONE, as a path's: an arc's slot is on while its radius is not negative, a segment's by its [1].y
    const unslot = (w, U) => w.split('\n').flatMap(l => {
        const m = /^    if \((?:UB\.(_qp\d+_\w+)\[0\]\.z >= 0\.0|UB\.(_qp\d+_\w+)\[1\]\.y > 0\.5)\) \{ (.*) \}$/.exec(l)
        if (!m) return [l]
        return (m[1] ? U[m[1]].def[2] >= 0 : U[m[2]].def[5] > 0.5) ? ['    ' + m[3]] : []
    }).join('\n')
    const sub = unslot(unloop(region(L.wgsl)), L.uniforms)
        .replace(/\(!axis \|\| UB\.(_qp\d+_\w+)\[1\]\.x < 0\.5\)/g, (m, n) => D(n)[4] > 0.5 ? '!axis' : 'true')
        .replace(/UB\.(_qp\d+_\w+)\[0\]\.w > 0\.5/g, (m, n) => D(n)[3] > 0.5 ? 'true' : 'false')
        .replace(/UB\.(_qp\d+_\w+)\[(\d)\]\.(xy|zw|z)/g, (m, n, col, sw) => {
            const d = D(n), c = 4 * col
            return sw === 'xy' ? `VEC2(${lit(d[c])}, ${lit(d[c + 1])})` : sw === 'zw' ? `VEC2(${lit(d[c + 2])}, ${lit(d[c + 3])})` : lit(d[c + 2])
        })
        .split('\n').filter(l => !/_qok_/.test(l)).join('\n').replaceAll(/, live: its pieces are uniforms, room for \d+ points/g, '')
    ok('THE EQUIVALENCE: the live outline, its slots that are off left out and its reads replaced by their defaults, is the compiled outline line for line',
        sub === region(C.wgsl), sub.split('\n').find((l, i) => l !== region(C.wgsl).split('\n')[i]))
    ok('...the revolve\'s axis edge is read live: a number, not a literal', /\(!axis \|\| UB\._qp\d+_knob_rv\[1\]\.x < 0\.5\)/.test(unloop(L.wgsl)))
    ok('the live functions draw nothing while ok is 0', /fn prof_pl_outline\(q: VEC2, axis: bool\) -> VEC3 \{\n    if \(UB\._qok_outline_pl < 0\.5\) \{ return VEC3\(1\.0, 0\.0, 1\.0e7\); \}/.test(L.wgsl))
    ok('the pick copy reads them too', L.pickWgsl.includes('case 0u: { return UB._qp0_outline_pl; }'))
    ok('...a loop: each kind\'s call at one place, whatever the room', (L.wgsl.match(/A = pfArc\(/g) || []).length === 2 && (L.wgsl.match(/A = pfSegment\(/g) || []).length === 2)
    eq('the scene lists them with their chains', L.pointParams.map(P => [P.kind, P.k, P.live, P.deps.join(' ')]), [['profile', 'outline', true, 'w r h m'], ['profile', 'knob', true, 'rad x0']])
    // UPDATES
    const d = make(true), pl = d.root.children[0].params, rv = d.root.children[1].params
    pl.w = 1.5; pl.h = 2
    const u = livePointsUpdate(d, 'pl', 'w', L.pointParams), fresh = generate(Model.toTree(d)).uniforms
    const plNames = names.filter(k => k.endsWith('_pl'))
    ok('a named parameter moved: no recompile, every piece and the reach written as a fresh compile declares them', !u.restructure
        && plNames.filter(k => k !== '_qok_outline_pl').every(k => JSON.stringify(u.set[k]) === JSON.stringify(fresh[k].def)) && u.set._qok_outline_pl === 1, JSON.stringify(Object.keys(u.set)))
    // point 4's arc: centred at x = w (1.5), its first column (c, r, convex)
    const fourth = set => Object.entries(set).find(([k, v]) => /^_qp/.test(k) && Math.abs(v[0] - 1.5) < 1e-9 && v[2] === 0.1)?.[1]
    pl.m = 3                                                        // point 4 above its neighbours (h = 2): a peak
    const peak = livePointsUpdate(d, 'pl', 'm', L.pointParams)
    pl.m = 0.5                                                      // ...pushed in below them: a notch, the same pieces
    const notch = livePointsUpdate(d, 'pl', 'm', L.pointParams)
    ok('a corner turned concave: the same chain, written -- its arc\'s side a number that flipped', !peak.restructure && !notch.restructure
        && fourth(peak.set)?.[3] === 1 && fourth(notch.set)?.[3] === 0, JSON.stringify([fourth(peak.set), fourth(notch.set)]))
    rv.x0 = 0.1                                                     // the closing edge off the axis
    const off = livePointsUpdate(d, 'rv', 'x0', L.pointParams)
    const axisOf = set => Object.entries(set).filter(([k, v]) => /^_qp\d*[13579]_/.test(k) && v[4] === 1 && v[5] === 1).length     // a segment's slot, on
    ok('a point off the axis: the same chain, written -- the edge no longer an axis edge', !off.restructure && axisOf(off.set) === 0
        && axisOf(livePointsUpdate(make(true), 'rv', 'x0', L.pointParams).set) === 1, JSON.stringify(off.set))
    pl.r = 0
    const flat = livePointsUpdate(d, 'pl', 'r', L.pointParams), ff = generate(Model.toTree(d)).uniforms
    ok('a fillet to 0: its arcs\' slots off -- written, no recompile (2026-10-02: the chain is slots)', !flat.restructure
        && Object.entries(flat.set).filter(([k]) => /^_qp\d*[02468]_outline_pl$/.test(k)).every(([, v]) => v[2] === -1)
        && plNames.filter(k => k !== '_qok_outline_pl').every(k => JSON.stringify(flat.set[k]) === JSON.stringify(ff[k].def)), JSON.stringify(flat))
    d.root.children[0].params.outline.push([0, 'h / 2'])
    ok('a point more than it has room for: a recompile', livePointsUpdate(d, 'pl', 'outline', L.pointParams).restructure)
    d.root.children[0].params.outline.pop()
    pl.r = 0.1; pl.h = 0; pl.m = 0
    eq('unsound now (no area): ok 0, it draws nothing, no recompile', livePointsUpdate(d, 'pl', 'h', L.pointParams), { set: { [profileOkName('pl', 'outline')]: 0 }, restructure: false })
    const dc = make(false); dc.root.children[0].params.w = 1.5
    ok('a compiled profile that names the parameter: a recompile', livePointsUpdate(dc, 'pl', 'w', C.pointParams).restructure)
    // A SWEEP OF A LIVE PROFILE reads its reach from the uniform: the skip must follow the outline as it grows
    const sw = make(true)
    Model.addObject(sw, 'root', { id: 'gd', params: { route: { path: [[0, 0, 0], [1, 0, 0, 0.3], [1, 1, 0]] } }, code: 'C = add_new(C, sweep(route, outline_ref, p), MATERIAL);' })
    const S = generate(Model.toTree(sw)).wgsl
    ok('profileReach returns a live profile\'s reach from its uniform, a compiled one\'s as a literal', /case 0u: \{ return UB\._qre_outline_pl; \}/.test(S)
        && /fn profileReach/.test(S) && !/case \du: \{ return UB\._qre_\w+; \}/.test(generate(Model.toTree(make(false))).wgsl))
}

//----------------------------------------------------------------------------------------------
// EDITED IN THE PICTURE (2026-10-02, the overlay's Points mode): a compiled path or profile compiled as if the document
// said live -- THE SAME TEXT as one the document has live and is being edited -- with room for EDIT_SPARE points more,
// so a point dragged or added writes uniforms; the scene says it was forced and its room, so a live change is written
// although the document says compiled; one longer than a live one may be is not forced
//----------------------------------------------------------------------------------------------
{
    const make = (live, n = 4) => {
        const d = Model.createDoc()
        const route = { path: [[0, 0, 0], [1, 0, 0, 0.2], [1, 1, 0, 0.2], [1, 1, 'rise'], ...Array.from({ length: n - 4 }, (_, i) => [2 + i, 1, 0.6 + (i % 2) * 0.3])],
                        ...(live ? { live: true } : {}) }
        Model.addObject(d, 'root', { id: 'tb', params: { rise: 0.6, route, outline: [[0, 0], [1, 0, 0.1], [1, 1], [0, 1]] },
            code: 'C = add_new(C, tube(route, p, 0.1, 0.0), MATERIAL);\nC = add_new(C, extrude(outline, p, 0.2), MATERIAL);' })
        if (live) Model.setProfileLive(d, 'tb', 'outline', true)
        return d
    }
    const all = ['tb.route', 'tb.outline']
    const gen = (d, editing) => generate(...Model.generateArgs(d, editing ? { editing } : {}))
    const F = gen(make(false), all), E = gen(make(true), all), L = gen(make(true)), C = gen(make(false))
    ok('a compiled path and profile, edited: exactly the text of the two the document has live, edited', F.wgsl === E.wgsl && F.pickWgsl === E.pickWgsl && F.wgsl !== C.wgsl)
    eq('...the same uniforms, at the same values', Object.fromEntries(Object.entries(F.uniforms).map(([k, u]) => [k, u.def])), Object.fromEntries(Object.entries(E.uniforms).map(([k, u]) => [k, u.def])))
    eq(`...the scene says they were forced, with room for ${EDIT_SPARE} points more`, F.pointParams.map(P => [P.k, P.live, P.forced, P.room]), [['route', true, true, 4 + EDIT_SPARE], ['outline', true, true, 4 + EDIT_SPARE]])
    eq('one the document has live, edited: not forced, given the room too', E.pointParams.map(P => [P.k, P.forced, P.room]), [['route', undefined, 4 + EDIT_SPARE], ['outline', undefined, 4 + EDIT_SPARE]])
    eq('...and not edited: room for its own points only', L.pointParams.map(P => [P.k, P.room]), [['route', 4], ['outline', 4]])
    ok('...the spare room is slots that are off', Object.entries(F.uniforms).filter(([k]) => /^_pp\d+_route_tb$/.test(k)).length === 2 * (4 + EDIT_SPARE) - 3
        && F.uniforms[pathPieceName('tb', 'route', 6)].def[7] === 0)
    eq('another node\'s name edits nothing', gen(make(false), ['zz.route']).wgsl, C.wgsl)
    // A LIVE CHANGE TO A FORCED PATH IS WRITTEN, not compiled -- what a fresh compile of the document, edited, declares
    const d = make(false), o = d.root.children[0]
    const same = (u, d2) => { const fresh = gen(d2, all).uniforms; return !u.restructure && Object.keys(u.set).length > 0 && Object.entries(u.set).every(([k, v]) => JSON.stringify(v) === JSON.stringify(fresh[k]?.def)) }
    o.params.rise = 0.9
    ok('a parameter a forced path names, moved: written as a fresh compile declares it, no compile', same(livePointsUpdate(d, 'tb', 'rise', F.pointParams), d))
    o.params.route.path[1] = [1.2, 0, 0, 0.2]
    ok('...a point of it dragged: the same', same(livePointsUpdate(d, 'tb', 'route', F.pointParams), d))
    o.params.outline[1] = [1.3, 0, 0.1]
    ok('...a point of the forced profile: the same', same(livePointsUpdate(d, 'tb', 'outline', F.pointParams), d))
    // POINTS ADDED within the room (2026-10-02: "adding points now requires recompilation"): written; past it, a compile
    o.params.route.path.splice(1, 0, [0.5, 0, 0])                                  // halfway along: a straight corner
    ok('a point put in the path: written, no compile', same(livePointsUpdate(d, 'tb', 'route', F.pointParams), d))
    o.params.route.path[1] = [0.5, 0.2, 0]                                         // ...dragged off the line: a bend
    ok('...dragged off its line, a bend appearing: written, no compile', same(livePointsUpdate(d, 'tb', 'route', F.pointParams), d))
    o.params.outline.splice(2, 0, [1.4, 0.5, 0.05])
    ok('a point put in the profile, with a fillet: written, no compile', same(livePointsUpdate(d, 'tb', 'outline', F.pointParams), d))
    o.params.route.path.splice(2, 1)
    ok('a point taken out: written, no compile', same(livePointsUpdate(d, 'tb', 'route', F.pointParams), d))
    while (o.params.route.path.length <= 4 + EDIT_SPARE) o.params.route.path.push([3 + o.params.route.path.length, 1, 0.6])
    ok(`past its room (${4 + EDIT_SPARE} points): a compile`, livePointsUpdate(d, 'tb', 'route', F.pointParams).restructure)
    ok('the same path compiled as the document says: a compile', livePointsUpdate(make(false), 'tb', 'route', C.pointParams).restructure)
    // TOO LONG TO BE LIVE: not forced, compiled -- and a drag then pushes once, on release (the overlay)
    eq('a path of 65 points is not forced: compiled as the document says', gen(make(false, 65), all).pointParams.map(P => [P.k, P.live, P.forced, P.room]),
        [['route', false, undefined, undefined], ['outline', true, true, 4 + EDIT_SPARE]])
}

/* THE BOUNDING BOXES OFF IS A SCENE MADE WITHOUT THEM (0.29.0; the renderer's setting `cull` until 0.34.0, the bench's
   generation option since): every way the builder makes a scene -- codegen and as data (exact hits and the grid until 0.41.0) -- has no call to a box
   test in any copy and no box uniform, and says so (`unculled`); on, the same document has them. Until 0.29.0 the box
   tests were in the text whatever the setting, each asking UB.cull at every step: whether "off costs nothing" was a guess. */
{
    const doc = Model.parse(readFileSync(new URL('../../test/fixtures/scenes/demo.json', import.meta.url), 'utf8'))
    const CALLS = /(?<!fn )\bcullDist\(/g
    const calls = s => ['wgsl', 'pickWgsl', 'opticsWgsl', 'opticsPickWgsl'].reduce((n, k) => n + ((s[k] || '').match(CALLS) || []).length, 0)
    for (const [how, o] of [['codegen', {}], ['as data', { data: true }]]) {
        const on = generate(...Model.generateArgs(doc, { id: 'cull', ...o })), off = generate(...Model.generateArgs(doc, { id: 'cull', ...o, cull: false }))
        ok(`boxes off, ${how}: no box test called in any copy, no box uniform, and it says so -- on, the same document has them`,
            calls(off) === 0 && !Object.keys(off.uniforms).some(n => /^bx(lo|hi)_/.test(n)) && off.unculled === true
            && calls(on) > 0 && on.unculled === undefined, `${calls(off)} off, ${calls(on)} on`)
        ok(`...and no uniform test of the setting anywhere (UB.cull), on or off`, ![on, off].some(s => /UB\.cull\b/.test(s.wgsl)))
    }
    ok('...nor in the library every kernel compiles (scene_api.js cullDist)', !/UB\.cull\b/.test(SCENE_API))
    // the candidate grid and exact hits went in 0.41.0: asked for by name, refused, never read as nothing
    for (const k of ['grid', 'exact', 'listMax']) {
        let err = ''
        try { generate(...Model.generateArgs(doc, { id: 'gone', data: true, [k]: true })) } catch (e) { err = e.message }
        ok(`...\`${k}\` asked for: refused by name`, new RegExp(`\\b${k}\\b went in \\d+\\.\\d+\\.\\d+ .*not an option`).test(err), err)
    }
}

/* THE BOXES ON THE DEAR NODES ONLY (cull 'dear': Tests > boxcost's fourth row in 0.33.8, THE BUILDER'S WAY -- codegen's
   default -- since 0.34.0): a box test for a top-level node dearer than its box -- a relief, an outline (revolve walks its
   pieces), code with no answer along the ray, any group -- and none for one plain shape: a sphere, a lens, a light's
   face. The plain ones still drawn, the pick copy untouched; none left dear, the scene made without its boxes, text and
   uniforms; as data, the walk as with every box. And `true`, which the builder passed for every box until then, refused. */
{
    const d = Model.createDoc()
    const rough = Model.addMaterial(d, { id: 'rough' })
    Model.setRelief(d, rough.id, 'noise')
    Model.addObject(d, 'root', { id: 'ball', primitive: 'sphere' })
    Model.addObject(d, 'root', { id: 'glass', primitive: 'lens' })
    Model.addObject(d, 'root', { id: 'bumpy', primitive: 'sphere', material: rough.id })
    Model.addObject(d, 'root', { id: 'turned', primitive: 'revolution' })
    Model.addObject(d, 'root', { id: 'coded', code: 'C = add_new(C, sdBox(p, VEC3(0.5)), MATERIAL);' })
    Model.addGroup(d, 'root', { id: 'pair' })
    Model.addObject(d, 'pair', { primitive: 'sphere' })
    Model.addLight(d, 'root', { id: 'lamp' })
    Model.addExportBox(d, 'root', { id: 'print' })
    const tested = s => [...s.wgsl.matchAll(/let bd_(\w+) = cullDist\(/g)].map(m => m[1]).sort()
    const boxes = s => Object.keys(s.uniforms).filter(n => /^bx(lo|hi)_/.test(n)).sort()
    const on = generate(...Model.generateArgs(d, { id: 'dear', cull: 'all' })), dear = generate(...Model.generateArgs(d, { id: 'dear' }))
    eq('cull \'all\': a box test for every top-level node that draws something', tested(on), ['ball', 'bumpy', 'coded', 'glass', 'lamp', 'pair', 'turned'])
    eq('the default, the dear ones: for the relief, the outline, the code with no answer along the ray and the group -- not the sphere, the lens, the light',
        tested(dear), ['bumpy', 'coded', 'pair', 'turned'])
    ok('...the default is \'dear\', said or not', dear.wgsl === generate(...Model.generateArgs(d, { id: 'dear', cull: 'dear' })).wgsl)
    let refused = null
    try { generate(...Model.generateArgs(d, { id: 'dear', cull: true })) } catch (e) { refused = e.message }
    ok('...and `true` refused, by name: the builder passed it for every box until 0.34.0', /cull is 'dear'.*not true/.test(refused ?? ''), refused)
    eq('...their boxes declared, no other', boxes(dear), ['bumpy', 'coded', 'pair', 'turned'].flatMap(id => [boxHiName(id), boxLoName(id)]).sort())
    ok('...the plain ones still drawn', ['ball', 'glass', 'lamp'].every(id => new RegExp(`// node ${id} \\(`).test(dear.wgsl)))
    ok('...the skipped nodes\' bound folded in once, at the end', (dear.wgsl.match(/if \(CULL < abs\(C\.s\.w\)\) \{ C\.s\.w = CULL; \}/g) || []).length === 1)
    ok('...the pick copy as with every box (it is never culled)', dear.pickWgsl === on.pickWgsl && dear.unculled === undefined)
    // with live visibility, a plain node behind its visibility test alone
    const live = generate(Model.toTree(d, { keepDisabled: true }), { id: 'dear', liveVisibility: true })
    ok('live visibility: a plain node behind its own visibility test, no box test inside', /if \(UB\.vis_ball != 0u\) \{\n\s*\/\/ node ball \(/.test(live.wgsl)
        && !/bd_ball\b/.test(live.wgsl))
    // none dear: the scene without its boxes, the same text and uniforms
    const plain = Model.createDoc()
    Model.addObject(plain, 'root', { id: 'ball', primitive: 'sphere' })
    Model.addObject(plain, 'root', { id: 'glass', primitive: 'lens' })
    Model.addLight(plain, 'root', { id: 'lamp' })
    const a = generate(...Model.generateArgs(plain, { id: 'p' })), b = generate(...Model.generateArgs(plain, { id: 'p', cull: false }))
    ok('no node dear: the text of the scene made without its boxes, its uniforms too, no CULL', a.wgsl === b.wgsl && !/\bCULL\b/.test(a.wgsl)
        && JSON.stringify(Object.keys(a.uniforms).sort()) === JSON.stringify(Object.keys(b.uniforms).sort()))
    // as data: the records' walk tests a box wherever a record has one, as with every box
    const dOn = generate(...Model.generateArgs(d, { id: 'dd', data: true, cull: 'all' })), dDear = generate(...Model.generateArgs(d, { id: 'dd', data: true }))
    ok('as data: the default makes the text every box makes', typeof dDear.writeData === 'function' && dDear.wgsl === dOn.wgsl)
}

//----------------------------------------------------------------------------------------------
// A MATERIAL'S COLOUR DEPTH (0.37.0; materials.js attenuationDistance): in the shader only while above 0, in real mm
//----------------------------------------------------------------------------------------------
{
    const d = Model.createDoc({ title: 'depth' })
    Model.addMaterial(d, { id: 'glass', preset: 'glass' })
    Model.addObject(d, 'root', { id: 'box', primitive: 'box', material: 'glass' })
    eq('a new material has the field, at 0', d.materials.find(m => m.id === 'glass').params.attenuationDistance, 0)
    const off = generate(...Model.generateArgs(d, { id: 'dp' }))
    const u = uniformName('glass', 'attenuationDistance')
    ok('at 0: neither declared nor assigned -- the text a scene had before the field', !(u in off.uniforms) && !off.wgsl.includes('attenuationDistance'))
    d.materials.find(m => m.id === 'glass').params.attenuationDistance = 12.5
    const on = generate(...Model.generateArgs(d, { id: 'dp' }))
    ok('above 0: a uniform with the value, read through mm() (real millimetres whatever the scene\'s unit)',
        on.uniforms[u]?.def === 12.5 && on.wgsl.includes(`m.attenuationDistance = mm(UB.${u});`))
    // an emitter's fields are emission alone: no colour depth assigned there, as no colour
    Model.addMaterial(d, { id: 'lamp', preset: 'emissive' })
    d.materials.find(m => m.id === 'lamp').params.attenuationDistance = 3
    const em = generate(...Model.generateArgs(d, { id: 'dp' }))
    ok('...an emitter declares it (a uniform for every field it has) and never assigns it',
        uniformName('lamp', 'attenuationDistance') in em.uniforms && !em.wgsl.includes(`m.attenuationDistance = mm(UB.${uniformName('lamp', 'attenuationDistance')})`))
    // the file: 18 upgraded to 19, the field at 0, nothing else of the material moved
    const old = JSON.parse(JSON.stringify(d)); old.version = 18
    for (const m of old.materials) delete m.params.attenuationDistance
    const up = Model.upgrade(old)
    eq('a version 18 file is upgraded to 19, and on to the current version', up.version, Model.VERSION)
    ok('...every material with the colour depth at 0, its other fields as they were', up.materials.every(m => m.params.attenuationDistance === 0)
        && up.materials.every((m, i) => Object.entries(old.materials[i].params).every(([k, v]) => JSON.stringify(m.params[k]) === JSON.stringify(v))))
    ok('...and validates', Model.validate(up).length === 0, Model.validate(up).join('; '))
    // an asset from before the field: filled in as it goes in, and the same material as one made since
    const asset = { kind: 'material', material: { ...structuredClone(old.materials[0]) } }
    const into = Model.createDoc()
    const got = Model.insertAsset(into, asset)
    eq('an asset without the field gets it at 0 as it goes in', got.params.attenuationDistance, 0)
    const made = { ...structuredClone(old.materials[0]) }
    made.params = Object.fromEntries(Object.entries(Model.withFieldDefaults(made).params).reverse())
    ok('...and the same material whatever order its fields are in', Model.sameMaterial(Model.withFieldDefaults(old.materials[0]), made))
}

//----------------------------------------------------------------------------------------------
// A COATING (materials.js coating and coat*, core/materials.js coatMaterial; 0.39.0): in the shader only while the
// material has one, written in one call after its fields and before its code; the file is version 20
//----------------------------------------------------------------------------------------------
{
    const d = Model.createDoc({ title: 'coat' })
    Model.addMaterial(d, { id: 'dich', preset: 'glass' })
    Model.addObject(d, 'root', { id: 'plate', primitive: 'box', material: 'dich' })
    const names = ['coating', ...Model.COAT_FIELDS].map(k => uniformName('dich', k))
    const off = generate(...Model.generateArgs(d, { id: 'co' }))
    ok('no coating: none of its six declared, no coatMaterial in the material\'s case', names.every(n => !(n in off.uniforms)) && !off.wgsl.includes('coatMaterial(m,'))
    const mat = d.materials.find(m => m.id === 'dich')
    Object.assign(mat.params, { coating: 1, coatLow: 0.5, coatHigh: 0.5 })
    mat.code = 'm.roughness = 0.0;'
    const on = generate(...Model.generateArgs(d, { id: 'co' }))
    ok('a coating: the six declared with their values', names.every(n => n in on.uniforms) && on.uniforms[uniformName('dich', 'coating')].type === 'u32'
        && on.uniforms[uniformName('dich', 'coating')].def === 1 && on.uniforms[uniformName('dich', 'coatLow')].def === 0.5)
    const call = `m = coatMaterial(m, ${names.map(n => `UB.${n}`).join(', ')});`
    ok('...one coatMaterial call, the values in its order', on.wgsl.split(call).length === 2, on.wgsl.split('\n').filter(l => l.includes('coat')).join(' | '))
    ok('...after the fields and before the material\'s own code', on.wgsl.indexOf(`m.ior = UB.${uniformName('dich', 'ior')};`) < on.wgsl.indexOf(call)
        && on.wgsl.indexOf(call) < on.wgsl.lastIndexOf('m.roughness = 0.0;'))
    ok('...no field of it assigned one by one', !on.wgsl.includes(`m.coatLow = UB.`) && !on.wgsl.includes(`m.coating = UB.`))
    // an emitter has no surface: its coating declared (every field it has is a uniform) and never applied
    Model.setMaterialType(d, 'dich', 'emitter')
    const em = generate(...Model.generateArgs(d, { id: 'co' }))
    ok('...an emitter declares it and never calls coatMaterial', names.every(n => n in em.uniforms) && !em.wgsl.includes('coatMaterial(m,'))
    Model.setMaterialType(d, 'dich', 'surface')
    // where it is: one of the four, checked
    mat.params.coating = 4
    ok('coating 4 is refused, by name', Model.validate(d).some(p => /coating must be one of 0 \(none\)/.test(p)), Model.validate(d).join('; '))
    mat.params.coating = 3
    ok('...3 (every face) is fine', Model.validate(d).length === 0, Model.validate(d).join('; '))
    // its values are fields, not parameters of the material's own
    ok('the coating\'s values are no parameters of the material\'s own', !Model.customParams(mat).some(k => k.startsWith('coat')))
    let refused = false
    try { Model.addParam(d, 'dich', 'coatEdge', 1) } catch { refused = true }
    ok('...and adding one by a coating\'s name is refused', refused)
    // the file: 19 upgraded to 20, the six with coating 0, nothing else moved
    const old = JSON.parse(JSON.stringify(d)); old.version = 19
    for (const m of old.materials) for (const k of ['coating', ...Model.COAT_FIELDS]) delete m.params[k]
    const up = Model.upgrade(old)
    eq('a version 19 file is upgraded to 20, and on to the current version', up.version, Model.VERSION)
    ok('...every material with no coating and the defaults, its other fields as they were', up.materials.every(m => m.params.coating === 0
        && Model.COAT_FIELDS.every(k => m.params[k] === Model.MATERIAL_FIELDS[k].def))
        && up.materials.every((m, i) => Object.entries(old.materials[i].params).every(([k, v]) => JSON.stringify(m.params[k]) === JSON.stringify(v))))
    ok('...and validates', Model.validate(up).length === 0, Model.validate(up).join('; '))
    const asset = { kind: 'material', material: structuredClone(old.materials[0]) }
    eq('an asset without them gets coating 0 as it goes in', Model.insertAsset(Model.createDoc(), asset).params.coating, 0)
}

//----------------------------------------------------------------------------------------------
// DISPERSION (materials.js abbe, 0.40.0): the Abbe number in the shader only while above 0, as the colour depth;
// the file is version 21
//----------------------------------------------------------------------------------------------
{
    const d = Model.createDoc({ title: 'prism' })
    Model.addMaterial(d, { id: 'flint', preset: 'glass' })
    Model.addObject(d, 'root', { id: 'pr', primitive: 'prism', material: 'flint' })
    const u = uniformName('flint', 'abbe')
    const off = generate(...Model.generateArgs(d, { id: 'ab' }))
    ok('Abbe 0: neither declared nor assigned', !(u in off.uniforms) && !off.wgsl.includes(`m.abbe = UB.${u};`))
    d.materials.find(m => m.id === 'flint').params.abbe = 28
    const on = generate(...Model.generateArgs(d, { id: 'ab' }))
    ok('above 0: a uniform with the value, assigned after the index', on.uniforms[u]?.def === 28 && on.wgsl.includes(`m.abbe = UB.${u};`)
        && on.wgsl.indexOf(`m.ior = UB.${uniformName('flint', 'ior')};`) < on.wgsl.indexOf(`m.abbe = UB.${u};`))
    const old = JSON.parse(JSON.stringify(d)); old.version = 20
    for (const m of old.materials) delete m.params.abbe
    const up = Model.upgrade(old)
    eq('a version 20 file is upgraded to 21, and on to the current version', up.version, Model.VERSION)
    ok('...every material with Abbe 0, its other fields as they were', up.materials.every(m => m.params.abbe === 0)
        && up.materials.every((m, i) => Object.entries(old.materials[i].params).every(([k, v]) => JSON.stringify(m.params[k]) === JSON.stringify(v))))
    ok('...and validates', Model.validate(up).length === 0, Model.validate(up).join('; '))
}

//----------------------------------------------------------------------------------------------
// ANSWERS ALONG THE RAY (codegen `along`, core/along.js; 0.next): which shapes answer -- a plain sphere, box, cylinder,
// plane or rectangle under plain groups and arrays, and a plane's relief band -- and that none other does; off, nothing
//----------------------------------------------------------------------------------------------
{
    const d = Model.createDoc({ title: 'along' })
    Model.addMaterial(d, { id: 'bumpy' })
    Model.setRelief(d, 'bumpy', 'noise')
    Model.addObject(d, 'root', { id: 'ball', primitive: 'sphere' })
    Model.addObject(d, 'root', { id: 'floor', primitive: 'plane', material: 'bumpy' })
    Model.addObject(d, 'root', { id: 'ring', primitive: 'torus' })                       // no answer
    Model.addObject(d, 'root', { id: 'bumpyball', primitive: 'sphere', material: 'bumpy' })   // a relief but not a plane's
    Model.addGroup(d, 'root', { id: 'plain' })
    Model.addObject(d, 'plain', { id: 'crate', primitive: 'box' })
    Model.addGroup(d, 'plain', { id: 'row' })
    Model.addObject(d, 'row', { id: 'post', primitive: 'cylinder' })
    Model.setCopies(d, 'row', Model.copiesRow(3, 1))
    Model.addGroup(d, 'root', { id: 'cut' })
    Model.addObject(d, 'cut', { id: 'cutbase', primitive: 'box' })
    Model.addObject(d, 'cut', { id: 'cuthole', primitive: 'sphere', join: 'subtract' })
    Model.addGroup(d, 'root', { id: 'soft', blend: 0.1 })
    Model.addObject(d, 'soft', { id: 'softball', primitive: 'sphere' })
    Model.addGroup(d, 'root', { id: 'warp', code: 'C = children(C, p);' })
    Model.addObject(d, 'warp', { id: 'warpball', primitive: 'sphere' })
    const off = generate(...Model.generateArgs(d, { id: 'al' })), on = generate(...Model.generateArgs(d, { id: 'al', along: true }))
    // a node's block: to the next node's, or the end of the function it is in (group code's children come before the support)
    const block = (S, id) => { const w = S.wgsl, a = w.indexOf(`// node ${id} (`); if (a < 0) return ''; const ends = [w.indexOf('// node ', a + 8), w.indexOf('\nfn ', a)].filter(b => b >= 0); return w.slice(a, ends.length ? Math.min(...ends) : w.length) }
    const answers = (S, id) => /C = add_along\(C, /.test(block(S, id))
    ok('off: no answers anywhere, no `along` said', !off.along && !/AL_ON|add_along|alBand|alFar/.test(off.wgsl + off.pickWgsl))
    ok('on: `along` said, the answers and their support once, before SDF', on.along === true && on.wgsl.split('fn add_along(').length === 2
        && on.wgsl.split('fn Asphere(').length === 2 && on.wgsl.indexOf('fn add_along(') < on.wgsl.indexOf('fn SDF(r: Ray)'))
    ok('...a sphere, a box under a plain group, a cylinder in an array under it answer, in their own frame',
        ['ball', 'crate', 'post'].every(id => answers(on, id)) && /alt_ball = Asphere\(p, transpose\(XF_M\) \* r\.dir, radius\)/.test(block(on, 'ball')))
    ok('...the answer asked only where AL_ON is set (the march and the shadow rays)', /if \(AL_ON\) \{ alt_crate = AboxRounded\(/.test(block(on, 'crate')))
    ok('...a plane under a relief answers for its band, its far fold to the hit test alone',
        /alBand\(AplaneBand\(p, transpose\(XF_M\) \* r\.dir, ra_floor \/ XF_S\)\);/.test(block(on, 'floor')) && /C = alFar\(C, /.test(block(on, 'floor'))
        && !/alBand|alFar/.test(block(off, 'floor')))
    ok('...and none other: a torus, a sphere under a relief, a CSG group\'s shapes, a blended group\'s, group code\'s',
        ['ring', 'bumpyball', 'cutbase', 'cuthole', 'softball', 'warpball'].every(id => !answers(on, id) && !/alBand/.test(block(on, id))))
    ok('the pick copy answers nothing, nor the uniforms move', on.pickWgsl === off.pickWgsl && JSON.stringify(on.uniforms) === JSON.stringify(off.uniforms))
    ok('the scene as data: no answers (its records answer nothing)', !generate(...Model.generateArgs(d, { id: 'al', data: true, along: true })).along)
    const none = Model.createDoc({ title: 'none' })
    Model.addObject(none, 'root', { id: 't', primitive: 'torus' })
    const n1 = generate(...Model.generateArgs(none, { id: 'n' })), n2 = generate(...Model.generateArgs(none, { id: 'n', along: true }))
    ok('a scene where nothing answers: with `along`, the text byte for byte without it', !n2.along && n2.wgsl === n1.wgsl)
}

console.log(fail ? `\n${fail} failed, ${pass} passed.` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
