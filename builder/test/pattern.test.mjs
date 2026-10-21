//======================================================================================================================
// A PATTERN FRAME (model.js setPattern, version 23; codegen patterned, patIn): where a node's material lays its pattern
// out, moved and turned in the node's own frame. Run:
//   node builder/test/pattern.test.mjs
//
// What it shows, with no GPU (builder/test/pattern.gpu.mjs runs the text on Dawn):
//   - the model: set, copied, taken away; refused on the root, a light, a box, and with a scale or a bad number; a file
//     of 22 read as 23 with nothing changed, a file of 23 with one read back; toTree, a duplicate, the library's asset
//     and a paste in another unit carrying it; a unit change converting its place by the numbers and not by a scale;
//     whose frame a material is read in (patternOwner);
//   - the text: none where it changes nothing (no material reads its point, no relief), the scene byte for byte what it
//     was; where it does, its uniform and the capture's lines, for an object, for a CSG group's own fold, for a relief
//     alone (its point and nothing else); and the scene as data compiling such a node, and only it;
//   - live, through the real builder over a stand-in renderer: a value moved is its uniform, no compile, codegen's and
//     as data; where it changes nothing, taken with nothing to write.
// What it cannot show is the picture: the user's.
//======================================================================================================================
import * as M from '../model.js'
import * as P from '../project.js'
import { generate, patName, patterned } from '../codegen.js'
import { planOf } from '../scenedata.js'
import { changeUnit } from '../unitchange.js'
import { modifierGroup } from '../modifiers.js'
import { sceneTextOf, SCENE_DATA_KEYS } from '../../lib/pathtracer/core/uniforms.schema.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const throws = f => { try { f(); return false } catch (e) { return e instanceof M.ModelError } }

const T = (x, y, z, rx = 0, ry = 0, rz = 0, s = 1) => ({ pos: { x, y, z }, rot: { x: rx, y: ry, z: rz }, scale: s })
const P1 = { pos: { x: 1, y: -2, z: 0.5 }, rot: { x: 0, y: 90, z: 15 } }
const LOCAL = 'm.baseColor = fract(p_local);'

// ---- the model
{
    const d = M.createDoc()
    M.addMaterial(d, { id: 'wood', code: LOCAL })
    const o = M.addObject(d, 'root', { primitive: 'box', material: 'wood' })
    const given = structuredClone(P1)
    M.setPattern(d, o.id, given)
    given.pos.x = 99
    ok('setPattern: kept, a copy of what it was given', o.pattern.pos.x === 1 && o.pattern.rot.y === 90 && M.validate(d).length === 0)
    ok('setPattern(null): taken away', (M.setPattern(d, o.id, null), !('pattern' in o)))
    const L = M.addLight(d, 'root', { shape: 'disc' }), E = M.addExportBox(d, 'root', {})
    ok('refused: the root, a light, an export box, a scale, a number that is none, a field it has not',
        throws(() => M.setPattern(d, 'root', P1)) && throws(() => M.setPattern(d, L.id, P1)) && throws(() => M.setPattern(d, E.id, P1))
        && throws(() => M.setPattern(d, o.id, { ...P1, scale: 2 })) && throws(() => M.setPattern(d, o.id, { pos: { x: NaN, y: 0, z: 0 }, rot: P1.rot }))
        && throws(() => M.setPattern(d, o.id, { pos: P1.pos })) && !('pattern' in o))
    ok('a parameter may not be called pat (its uniform is pat_<id>)', M.RESERVED_PARAMS.includes('pat'))
    M.setPattern(d, o.id, P1)
    const back = M.parse(JSON.stringify(d))
    ok('saved and read back whole, at version 23', M.VERSION === 23 && JSON.stringify(M.find(back, o.id).node.pattern) === JSON.stringify(P1))
    const old = structuredClone(d); old.version = 22; delete M.find(old, o.id).node.pattern
    const up = M.upgrade(old)
    ok('a file of 22 is read as 23, nothing else changed', up.version === 23 && JSON.stringify({ ...up, version: 22 }) === JSON.stringify(old))
    const t = M.toTree(d).children.find(n => n.id === o.id)
    ok('toTree carries it', JSON.stringify(t.pattern) === JSON.stringify(P1))
    const copy = M.duplicate(d, o.id)
    ok('a duplicate has its own', JSON.stringify(copy.pattern) === JSON.stringify(P1) && copy.pattern !== o.pattern)
    // the library: an asset of it, pasted into a scene in mm -- its place in the node's own frame, which a paste scales
    const asset = M.extractAsset(d, o.id)
    const mm = M.createDoc(); mm.unit = 'mm'
    const pasted = M.insertAsset(mm, asset)
    ok('an asset carries it; pasted into mm its place stays what it is, in the node\'s own frame, which the paste scales',
        JSON.stringify(pasted.pattern) === JSON.stringify(P1) && pasted.transform.scale === 1000)
}
// ---- a unit change: by a scale the frame is inside what is scaled; by the numbers its place is a position
{
    const make = () => {
        const d = M.createDoc(); d.unit = 'm'
        M.addMaterial(d, { id: 'wood', code: LOCAL })
        const g = M.addGroup(d, 'root', { id: 'g', transform: T(0.1, 0, 0) })
        M.addObject(d, g.id, { id: 'o', primitive: 'box', material: 'wood', transform: T(0.2, 0, 0) })
        M.setPattern(d, 'o', { pos: { x: 0.05, y: 0, z: -0.01 }, rot: { x: 0, y: 90, z: 0 } })
        return d
    }
    const s = make(); changeUnit(s, 'mm', 'scale')
    const n = make(); changeUnit(n, 'mm', 'dimensions')
    const k = make(); changeUnit(k, 'mm', 'keep')
    const at = d => M.find(d, 'o').node.pattern
    ok('unit change by a scale: the place as it was (the top-level scale reaches it)', at(s).pos.x === 0.05 && at(s).pos.z === -0.01 && M.find(s, 'g').node.transform.scale === 1000)
    ok('...by the numbers: its place times the factor, its turn as it was', at(n).pos.x === 50 && at(n).pos.z === -10 && at(n).rot.y === 90)
    ok('...keeping the numbers: as it was', at(k).pos.x === 0.05)
}
// ---- whose frame
{
    const d = M.createDoc()
    M.addMaterial(d, { id: 'wood', code: LOCAL })
    M.addObject(d, 'root', { id: 'lone', primitive: 'box', material: 'wood' })
    M.addGroup(d, 'root', { id: 'cut', blend: 0.1 })
    M.addObject(d, 'cut', { id: 'cb', primitive: 'box', material: 'wood' })
    M.addGroup(d, 'cut', { id: 'inner' })
    M.addObject(d, 'inner', { id: 'deep', primitive: 'sphere', join: 'subtract' })
    M.addGroup(d, 'root', { id: 'plain' })
    M.addObject(d, 'plain', { id: 'kid', primitive: 'box' })
    M.addGroup(d, 'root', { id: 'sh', ...modifierGroup('shell') })
    M.addObject(d, 'sh', { id: 'shelled', primitive: 'sphere' })
    ok('patternOwner: an object its own; a CSG group its own, and every shape in it, however deep, the group\'s',
        M.patternOwner(d, 'lone') === 'lone' && M.patternOwner(d, 'cut') === 'cut' && M.patternOwner(d, 'cb') === 'cut' && M.patternOwner(d, 'deep') === 'cut')
    ok('...a plain group none, its child its own; under a shell (group code on its children\'s result) the shell\'s',
        M.patternOwner(d, 'plain') === null && M.patternOwner(d, 'kid') === 'kid' && M.patternOwner(d, 'shelled') === 'sh')
}

// ---- the text
const textOf = d => generate(...M.generateArgs(d, { id: 'built' }))
{
    // a material that reads no point: the frame changes nothing, the text is what it was
    const d = M.createDoc()
    M.addMaterial(d, { id: 'plain', code: 'm.roughness = 0.3;' })
    const o = M.addObject(d, 'root', { primitive: 'box', material: 'plain' })
    const before = textOf(d)
    M.setPattern(d, o.id, P1)
    const after = textOf(d)
    ok('where it changes nothing (no point read, no relief): the scene\'s text byte for byte, no uniform',
        after.wgsl === before.wgsl && !(patName(o.id) in after.uniforms))
    // the same object, its material reading its point
    M.addMaterial(d, { id: 'wood', code: LOCAL })
    M.setMaterial(d, o.id, 'wood')
    const S = textOf(d)
    const U = S.uniforms[patName(o.id)]
    ok('where it does: its uniform, a mat4 of its place and turn with scale 1', U?.type === 'mat4x4<f32>' && JSON.stringify(U.def) === JSON.stringify(M.matrixOf({ ...P1, scale: 1 })))
    ok('...the capture\'s lines: only while capturing, XF_P moved and XF_QM turned by it, XF_STRAIGHT, put back after',
        S.wgsl.includes('if (LOCAL_CAPTURE) {     // its pattern frame') && S.wgsl.includes(`XF_P = xfPoint(XF_P, UB.${patName(o.id)}); XF_QM = XF_QM * xfRot(UB.${patName(o.id)}); XF_STRAIGHT = true;`)
        && S.wgsl.includes(`XF_P = xfpp_${o.id}; XF_QM = xfpm_${o.id}; XF_QS = xfps_${o.id}; XF_STRAIGHT = xfpst_${o.id};`))
    ok('...and the pick copy and the optics copies the same lines (they record what the material reads)', (S.pickWgsl ?? '').includes(`XF_P = xfPoint(XF_P, UB.${patName(o.id)})`))
}
{
    // a CSG group: its own fold; a frame on one of its shapes changes nothing a material reads
    const d = M.createDoc()
    M.addMaterial(d, { id: 'wood', code: LOCAL })
    M.addGroup(d, 'root', { id: 'cut', blend: 0.1 })
    M.addObject(d, 'cut', { id: 'cb', primitive: 'box', material: 'wood' })
    M.addObject(d, 'cut', { id: 'cs', primitive: 'sphere', material: 'wood', join: 'subtract' })
    const before = textOf(d).wgsl
    /* a frame on one of its shapes is in the text (the rule is the scene's: something reads a point), and records nothing:
       inside the combine XF_SUB is above zero, so fold records no point at all -- pattern.gpu.mjs shows it, bit for bit */
    M.setPattern(d, 'cs', P1)
    const shape = textOf(d).wgsl, at = shape.indexOf('XF_P = xfPoint(XF_P, UB.pat_cs)')
    ok('a frame on a CSG group\'s shape: its lines inside the shape\'s own Hit (XF_SUB up), where fold records nothing',
        at > 0 && shape.lastIndexOf('XF_SUB += 1u;', at) > shape.lastIndexOf('XF_SUB -= 1u;', at))
    M.setPattern(d, 'cs', null)
    // an after group (a shell): its code's fold, the frame round it
    M.addGroup(d, 'root', { id: 'sh', ...modifierGroup('shell') })
    M.addObject(d, 'sh', { id: 'ss', primitive: 'sphere', material: 'wood' })
    M.setPattern(d, 'sh', P1)
    const sh = textOf(d).wgsl, code = sh.indexOf('// the children of group sh')
    const wrapAt = sh.indexOf('XF_P = xfPoint(XF_P, UB.pat_sh)'), back = sh.indexOf('XF_P = xfpp_sh;')
    ok('an after group (a shell): the capture moved round its code, which folds its children\'s Hit into the scene',
        wrapAt > 0 && back > wrapAt && (sh.match(/XF_P = xfPoint\(XF_P, UB\.pat_sh\)/g) || []).length === 1 && sh.slice(wrapAt, back).includes('children_sh(') && code >= 0)
    M.setPattern(d, 'sh', null)
    M.setPattern(d, 'cut', P1)
    const S = textOf(d).wgsl
    const fold = S.indexOf('C = fold(C, k_cut, km_cut);')
    ok('a CSG group: the capture moved around its own fold, and only there', fold > 0 && S.lastIndexOf('XF_P = xfPoint(XF_P, UB.pat_cut)', fold) > S.indexOf('km_cut = select')
        && S.indexOf('XF_P = xfpp_cut;', fold) > fold && (S.match(/XF_P = xfPoint\(XF_P, UB\.pat_cut\)/g) || []).length === 1 && S !== before)
}
{
    // a relief alone: its point in the frame, no capture lines (nothing reads p_local)
    const d = M.createDoc()
    M.addMaterial(d, { id: 'rel' }); M.setRelief(d, 'rel', 'noise')
    const o = M.addObject(d, 'root', { primitive: 'sphere', material: 'rel' })
    M.setPattern(d, o.id, P1)
    const S = textOf(d).wgsl
    ok('a relief alone: read at xfPoint(p, pat) in the node\'s true scale, and no capture lines',
        S.includes(`relief_rel(xfPoint(p, UB.${patName(o.id)}) * (XF_S / XF_K) / mm(1.0))`) && !S.includes('xfpp_'))
}
{
    // the scene as data: such a node compiled as before, and nothing else
    const d = M.createDoc()
    M.addMaterial(d, { id: 'wood', code: LOCAL }); M.addMaterial(d, { id: 'plain' })
    M.addObject(d, 'root', { id: 'a', primitive: 'box', material: 'wood' })
    M.addObject(d, 'root', { id: 'b', primitive: 'box', material: 'wood' })
    M.addObject(d, 'root', { id: 'c', primitive: 'box', material: 'plain' })
    M.setPattern(d, 'a', P1); M.setPattern(d, 'c', P1)
    const plan = planOf(M.toTree(d, { keepDisabled: true }), { wantLocal: true })
    ok('as data: a node in its pattern frame is a compiled subtree (its frame a uniform); one without, a record',
        plan.sub.has('a') && !plan.sub.has('b'))
    ok('...and one whose frame changes nothing is a record (patterned: its material reads no point, has no relief)',
        !patterned(M.toTree(d).children.find(n => n.id === 'c'), { wantLocal: false, relief: false }))
}

// ---- live, through the real builder over a stand-in renderer (as dataapply.test.mjs's)
const { installBuilder } = await import('../demo.js')
const WG = {
    createStorageBuffer(bytes) { const b = { size: bytes, destroy() { } }; return { b, w() { } } },
    createBuffer(bytes, usage) { const b = { size: bytes, usage, destroy() { } }; return { b, w() { } } },
}
const gpu = { makeCompute: (b, m) => ({ wgsl: `${b}\n${m}`, module: { getCompilationInfo: async () => ({ messages: [] }) }, ready: Promise.resolve() }),
              makeShader: () => ({ getCompilationInfo: async () => ({ messages: [] }) }), device: { limits: { maxStorageBuffersPerShaderStage: 16 } } }
function standIn(sceneData) {
    let state = { sceneData }
    const RT = {
        scene: null, compiles: 0, writes: [],
        set(values) { const unknown = []; for (const [k, v] of Object.entries(values)) { if (k in state) { state[k] = structuredClone(v); RT.writes.push(k) } else unknown.push(k) } return unknown },
        get: () => structuredClone(state),
        settings: () => ({}), applySettings: () => [], invalidate() { },
        updateScene(p) { for (const [k, v] of Object.entries(p)) RT.scene[k] = v; return [] },
        async setScene(s) {
            RT.compiles++
            if (s.init) s.buffers = await s.init(WG)
            RT.scene = s
            state = { sceneData: state.sceneData, ...Object.fromEntries(Object.entries(s.uniforms).map(([k, u]) => [k, structuredClone(u.def)])) }
            return 1
        },
        updateSceneData(next) {
            const S = RT.scene
            if (!S?.writeData || !(next?.data instanceof Float32Array) || sceneTextOf(S) !== sceneTextOf(next) || !S.writeData(next.data)) return false
            for (const k of SCENE_DATA_KEYS) if (k in next) S[k] = next[k]
            return true
        },
        value: k => state[k],
    }
    return RT
}
const log = console.log, warn = console.warn
console.log = () => { }; console.warn = () => { }
const got = {}
try {
    const builder = async (d, sceneData) => {
        const RT = standIn(sceneData)
        const B = installBuilder({}, { RT, gpu, project: P.createProject([d]) })
        await B.apply()
        return { RT, B }
    }
    for (const sceneData of [0, 1]) {
        const d = P.blankScene('pattern')
        M.addMaterial(d, { id: 'wood', code: LOCAL })
        M.addObject(d, 'root', { id: 'top', primitive: 'box', material: 'wood' })
        M.setPattern(d, 'top', P1)
        const { RT, B } = await builder(d, sceneData)
        const compiled = RT.compiles
        const n = M.find(B.doc, 'top').node
        n.pattern.rot.y = 45
        const took = B.live('top', 'pattern')
        const v = RT.value(patName('top'))
        // a scene where nothing reads a point and nothing has a relief: no uniform, and nothing to do
        const e = P.blankScene('none')
        M.addMaterial(e, { id: 'plain' })
        M.addObject(e, 'root', { id: 'leg', primitive: 'box', material: 'plain' })
        M.setPattern(e, 'leg', P1)
        const L = await builder(e, sceneData), before = L.RT.compiles
        M.find(L.B.doc, 'leg').node.pattern.pos.x = 5
        got[sceneData] = { data: !!RT.scene.data, took, noCompile: RT.compiles === compiled, value: JSON.stringify(v) === JSON.stringify(M.matrixOf({ ...n.pattern, scale: 1 })),
                           compiledTop: sceneData ? RT.scene.compiledIds?.has('top') : true,
                           leg: L.B.live('leg', 'pattern'), legUniform: patName('leg') in L.RT.scene.uniforms, legCompiles: L.RT.compiles === before }
    }
} finally { console.log = log; console.warn = warn }
for (const [k, g] of Object.entries(got)) {
    const how = k === '1' ? 'as data' : 'codegen'
    ok(`live (${how}): a value moved is its uniform, written, no compile`, g.took && g.noCompile && g.value && g.data === (k === '1'), JSON.stringify(g))
    if (k === '1') ok('live (as data): the node is in a compiled subtree, so its uniform is what reaches it', g.compiledTop)
    ok(`live (${how}): where it changes nothing, taken with nothing to write (no uniform, no compile)`, g.leg && !g.legUniform && g.legCompiles, JSON.stringify(g))
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
