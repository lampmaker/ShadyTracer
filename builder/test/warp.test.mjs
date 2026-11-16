//======================================================================================================================
// Tests for a ray warp on an object (builder/warp.js, model version 30; the renderer's lib/pathtracer/core/warp.js).
// Run: node builder/test/warp.test.mjs
//
// The warp as a document's: set, refused, taken away, saved and read, a file of 29 read; what toTree hands codegen (the
// warps with their frames, a warp not drawn out of the tree, a hidden one none); codegen's text -- nothing about a warp in
// a scene without one, the scene's own text the same with a warp beside it, the functions and their uniforms, the warp's
// code mapped to `<id>#warp`, codegen, as data and baked; every line and recipe the Insert pane offers in the shader as
// written; the frames' JS twin (a point into a warp's frame and back); a unit change scaling the step. What a warp does
// to a ray on a GPU is builder/test/warp.gpu.mjs's; how it looks is the user's to judge.
//======================================================================================================================
import * as M from '../model.js'
import { generate } from '../codegen.js'
import { baked } from '../bake.js'
import { changeUnit } from '../unitchange.js'
import { matrixOf } from '../transform.js'
import { CODE_BLOCKS, recipeText } from '../coderef.js'
import { warpOwner, warpProblems, WARP_TEMPLATE, warpStepFor } from '../warp.js'
import { sceneTextOf } from '../../lib/pathtracer/core/uniforms.schema.js'
import { WARP_BOUNDARY, warpMarchWGSL, WARP_FLAGS } from '../../lib/pathtracer/core/warp.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
const throws = (name, fn, match) => {
    try { fn() } catch (e) { ok(name, !match || match.test(String(e.message)), `threw: ${e.message}`); return }
    ok(name, false, 'did not throw')
}
const T = (pos = [0, 0, 0], rot = [0, 0, 0], scale = 1) => ({ pos: { x: pos[0], y: pos[1], z: pos[2] }, rot: { x: rot[0], y: rot[1], z: rot[2] }, scale })
const WARP_LIB_MARK = "THE RAY WARPS' OWN"

//----------------------------------------------------------------------------------------------------------------------
// the warp in the document
//----------------------------------------------------------------------------------------------------------------------
{
    const d = M.createDoc()
    M.addObject(d, 'root', { id: 'ball', primitive: 'sphere' })
    M.addLight(d, 'root', { id: 'lamp', shape: 'disc' })
    ok('the model is version 30', M.VERSION === 30)
    ok('an object can carry a warp, a light cannot', M.canWarp(M.find(d, 'ball').node) && !M.canWarp(M.find(d, 'lamp').node))
    M.setWarp(d, 'ball', M.newWarp(0.02))
    eq('a new warp is the template, not drawn, with its step', M.find(d, 'ball').node.warp, { code: WARP_TEMPLATE, draw: false, step: 0.02 })
    ok('...and the document is sound', M.validate(d).length === 0, M.validate(d).join('; '))
    M.setWarp(d, 'ball', { draw: true })
    ok('a patch keeps what it does not name', M.find(d, 'ball').node.warp.draw === true && M.find(d, 'ball').node.warp.step === 0.02)
    throws('a step of 0 is refused', () => M.setWarp(d, 'ball', { step: 0 }), /step/)
    throws('a field a warp has not is refused', () => M.setWarp(d, 'ball', { speed: 2 }), /speed/)
    throws('a light has no warp', () => M.setWarp(d, 'lamp', M.newWarp(1)), /no ray warp/)
    ok('...and a refusal changes nothing', M.find(d, 'ball').node.warp.step === 0.02 && !M.find(d, 'lamp').node.warp)
    ok('warpProblems says what is wrong', warpProblems({ id: 'x', kind: 'object', type: 'code', warp: { code: 1, draw: 'yes', step: -1 } }).length === 3)
    const back = M.parse(M.serialize(d))
    eq('saved and read back whole', back.root.children[0].warp, M.find(d, 'ball').node.warp)
    const old = JSON.parse(M.serialize(d)); delete old.root.children[0].warp; old.version = 29
    const up = M.parse(JSON.stringify(old))
    ok('a file of 29 is read, with no warp', up.version === 30 && !up.root.children[0].warp && M.validate(up).length === 0)
    M.setWarp(d, 'ball', null)
    ok('taken away', !('warp' in M.find(d, 'ball').node))
    ok('the step to start with: a fiftieth of the size, a twentieth of a unit when nothing is known', warpStepFor(100) === 2 && warpStepFor(null) === 0.05 && warpStepFor(0) === 0.05)
}

//----------------------------------------------------------------------------------------------------------------------
// what toTree hands codegen
//----------------------------------------------------------------------------------------------------------------------
{
    const d = M.createDoc()
    M.addGroup(d, 'root', { id: 'g', transform: T([1, 2, 3], [0, 0, 30], 2) })
    M.addGroup(d, 'g', { id: 'h' })                                   // no transform: not in the chain
    M.addObject(d, 'h', { id: 'w', primitive: 'sphere', transform: T([0, 0, 1]) })
    M.addObject(d, 'root', { id: 'floor', primitive: 'box' })
    M.setWarp(d, 'w', M.newWarp(0.05))
    let t = M.toTree(d)
    eq('the warp listed, its chain every frame above it outermost first and its own', t.warps.map(w => [w.id, w.chain.map(c => c.id)]), [['w', ['g', 'h', 'w']]])
    ok('...its region the object\'s code and values', /Nsphere/.test(t.warps[0].code) && t.warps[0].params.radius === 0.5)
    ok('a warp not drawn is out of the tree everything else reads', JSON.stringify(t).split('"warps"')[0].indexOf('"id":"w"') < 0)
    M.setWarp(d, 'w', { draw: true })
    t = M.toTree(d)
    ok('a drawn one is in it too', t.children[0].children[0].children[0]?.id === 'w' && t.warps.length === 1)
    M.setEnabled(d, 'g', false)
    ok('a hidden group\'s warp is none, kept disabled or not', !M.toTree(d).warps && !M.toTree(d, { keepDisabled: true }).warps)
}

//----------------------------------------------------------------------------------------------------------------------
// codegen's text
//----------------------------------------------------------------------------------------------------------------------
const plain = () => {
    const d = M.createDoc()
    M.addObject(d, 'root', { id: 'floor', primitive: 'plane' })
    M.addObject(d, 'root', { id: 'ball', primitive: 'sphere', transform: T([0, 0, 1]) })
    return d
}
{
    const a = generate(M.toTree(plain()), { id: 's' })
    ok('a scene without a warp says nothing about one', !('warp' in a) && !a.wgsl.includes('sceneWarp') && !a.wgsl.includes(WARP_LIB_MARK))
    const d = plain()
    M.addGroup(d, 'root', { id: 'g', transform: T([0.5, 0, 0], [10, 20, 30], 1.5) })
    M.addObject(d, 'g', { id: 'w', code: 'C = add_new(C, sdBox(p, size * 0.5), MATERIAL);', params: { size: { x: 1, y: 1, z: 1 }, twist: 0.5 } })
    M.setWarp(d, 'w', { ...M.newWarp(0.05), code: 'dir = rotZ(twist * ds) * dir;' })
    for (const data of [false, true]) {
        const s = generate(M.toTree(d), { id: 's', data })
        const how = data ? 'as data' : 'codegen'
        ok(`${how}: a scene with a warp says so (the march's text, sceneTextOf)`, s.warp === true && sceneTextOf(s) !== sceneTextOf({ ...s, warp: false }))
        ok(`${how}: one region and one code function, sceneWarp and sceneWarpDist`, ['fn warpRegion_w(', 'fn warpCode_w(', 'fn sceneWarp(', 'fn sceneWarpDist('].every(x => s.wgsl.includes(x)))
        ok(`${how}: its frames and values are uniforms, declared`, ['xf_g', 'size_w', 'twist_w'].every(n => n in s.uniforms) && s.wgsl.includes('UB.xf_g') && s.wgsl.includes('let twist = UB.twist_w;'))
        const read = [...new Set([...s.wgsl.matchAll(/UB\.(\w+)/g)].map(m => m[1]))]
        ok(`${how}: every uniform the text reads is declared`, read.every(n => n in s.uniforms), read.filter(n => !(n in s.uniforms)).join(', '))
        // ...beside the same scene with the group the warp is in, empty
        const e = plain(); M.addGroup(e, 'root', { id: 'g', transform: T([0.5, 0, 0], [10, 20, 30], 1.5) })
        ok(`${how}: the scene's own text is what it was without the warp`, s.wgsl.split(`// ${WARP_LIB_MARK}`)[0].trimEnd()
            === generate(M.toTree(e), { id: 's', data }).wgsl.trimEnd())
        ok(`${how}: the step a literal, the flags the engine's`, s.wgsl.includes('step = min(step, 0.05)') && s.wgsl.includes(`| ${WARP_FLAGS.STOPPED}u`))
    }
    const s = generate(M.toTree(d), { id: 's' })
    const own = s.map.spans?.filter?.(x => x.node === warpOwner('w')) ?? []
    const mapped = JSON.stringify(s.map).includes(warpOwner('w'))
    ok('the warp\'s code is mapped to <id>#warp, its region to the object', mapped && JSON.stringify(s.map).includes('"w"'), JSON.stringify(own).slice(0, 200))
    const line = s.body.split('\n').findIndex(l => l === 'dir = rotZ(twist * ds) * dir;')
    ok('...and put in as typed, flush left', line > 0)
    const b = baked(s)
    ok('baked: the warp kept, its uniforms constants, none of its reads left', b.warp === true && !/UB\.(xf_g|twist_w|size_w)\b/.test(b.wgsl) && b.wgsl.includes('bk_twist_w'))
    // the engine's side reads the scene's names only through the boundary (core/unitlint.js; check-shaders runs it)
    ok('the boundary calls sceneWarp once', (WARP_BOUNDARY.match(/\bsceneWarp\(/g) || []).length === 1)
    ok('the march adds no glow on the Optics page', warpMarchWGSL({ glow: true }).includes('wo.add') && !warpMarchWGSL({ glow: false }).includes('wo.add'))
}

//----------------------------------------------------------------------------------------------------------------------
// every line and recipe the Insert pane offers, in the shader as written (check-shaders compiles the same)
//----------------------------------------------------------------------------------------------------------------------
{
    const d = plain()
    const lines = [...CODE_BLOCKS.warp.sets.map(x => x.code()), ...CODE_BLOCKS.warp.recipes.map(recipeText)]
    lines.forEach((code, i) => {
        M.addObject(d, 'root', { id: `w${i}`, primitive: 'sphere' })
        M.setWarp(d, `w${i}`, { ...M.newWarp(0.05), code })
    })
    const s = generate(M.toTree(d), { id: 's' })
    const missing = lines.filter(t => !t.split('\n').every(l => s.wgsl.includes(l.trim())))
    ok('every warp line and recipe is in the shader as written', !missing.length, missing.join(' | '))
    const fns = [...lines.join('\n').replace(/\/\/.*$/gm, '').matchAll(/\b([a-z]\w*)\s*\(/g)].map(m => m[1])
    const known = new Set(['rotX', 'rotY', 'rotZ', 'rotAxis', 'rand', 'stop', 'normalize', 'dot', 'max', 'min', 'exp', 'fract', 'abs', 'if'])
    ok('...each call one the warp\'s library has, or WGSL\'s', fns.every(f => known.has(f) || s.wgsl.includes(`fn ${f}(`)), fns.filter(f => !known.has(f)).join(', '))
}

//----------------------------------------------------------------------------------------------------------------------
// the frames' JS twin: xfPoint down the chain and warpUp back up it (codegen.js emitWarps) give back the point
//----------------------------------------------------------------------------------------------------------------------
{
    // a mat4 as WGSL reads it: column c is m[4c..4c+3]; xfRot the first three columns' xyz, T[3].xyz the place, T[3].w the scale
    const col = (m, c) => [m[4 * c], m[4 * c + 1], m[4 * c + 2], m[4 * c + 3]]
    const rotOf = m => [0, 1, 2].map(c => col(m, c).slice(0, 3))             // columns
    const mul = (R, v) => [0, 1, 2].map(i => R[0][i] * v[0] + R[1][i] * v[1] + R[2][i] * v[2])
    const mulT = (R, v) => R.map(c => c[0] * v[0] + c[1] * v[1] + c[2] * v[2])
    const xfPoint = (p, m) => { const t = col(m, 3); return mulT(rotOf(m), [p[0] - t[0], p[1] - t[1], p[2] - t[2]]).map(x => x / t[3]) }
    const warpUp = (q, m) => { const t = col(m, 3); const r = mul(rotOf(m), q.map(x => x * t[3])); return [t[0] + r[0], t[1] + r[1], t[2] + r[2]] }
    const chain = [T([1, 2, 3], [10, 20, 30], 2), T([-0.5, 0, 0.25], [0, 45, -60], 0.5), T([0, 0, 1], [90, 0, 0], 3)].map(t => Array.from(matrixOf(t)))
    let worst = 0
    for (let i = 0; i < 50; i++) {
        const p = [Math.sin(i) * 5, Math.cos(i * 1.3) * 5, i * 0.1 - 2]
        let q = p
        for (const m of chain) q = xfPoint(q, m)
        let b = q
        for (const m of [...chain].reverse()) b = warpUp(b, m)
        worst = Math.max(worst, Math.hypot(b[0] - p[0], b[1] - p[1], b[2] - p[2]))
    }
    ok('a point into a warp\'s frame and back is where it was', worst < 1e-12, `worst ${worst}`)
    // a direction into the frame by transpose(R) and back by R, R the product of the chain's turns, outermost first
    const R = chain.reduce((A, m) => { const B = rotOf(m); return [0, 1, 2].map(c => mul(A, B[c])) }, [[1, 0, 0], [0, 1, 0], [0, 0, 1]])
    const dir = [0.3, -0.5, 0.81], loc = mulT(R, dir), there = mul(R, loc)
    ok('...and a direction', Math.hypot(...there.map((x, i) => x - dir[i])) < 1e-12)
    // the local direction is the one the frame sees: a step along it moves the frame's point by it, times the scale
    const s = chain.reduce((k, m) => k * col(m, 3)[3], 1)
    let p0 = [0.2, 0.1, -0.3], p1 = p0.map((x, i) => x + dir[i] * 0.01), q0 = p0, q1 = p1
    for (const m of chain) { q0 = xfPoint(q0, m); q1 = xfPoint(q1, m) }
    ok('...the same one the frame sees, its length divided by the scale', Math.hypot(...q1.map((x, i) => x - q0[i] - loc[i] * 0.01 / s)) < 1e-12)
}

//----------------------------------------------------------------------------------------------------------------------
// a unit change: the step is a length in the world
//----------------------------------------------------------------------------------------------------------------------
{
    for (const how of ['scale', 'dimensions']) {
        const d = plain()
        M.setWarp(d, 'ball', M.newWarp(0.05))
        changeUnit(d, 'mm', how)
        ok(`a unit change m -> mm (${how}) multiplies the step by 1000`, M.find(d, 'ball').node.warp.step === 50, JSON.stringify(M.find(d, 'ball').node.warp))
    }
    const d = plain()
    M.setWarp(d, 'ball', M.newWarp(0.05))
    changeUnit(d, 'mm', 'keep')
    ok('...and keeping the numbers keeps it', M.find(d, 'ball').node.warp.step === 0.05)
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
