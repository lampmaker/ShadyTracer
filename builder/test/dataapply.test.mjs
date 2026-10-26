//======================================================================================================================
// The builder with the scene as data (demo.js dataMode, swapData, pushData): what compiles and what is written. Run:
//   node builder/test/dataapply.test.mjs
//
// Over a stand-in renderer that does what lib/pathtracer/index.js does with a scene -- setScene makes its buffer
// (scene.init) and swaps its uniforms in; updateSceneData takes a scene of the same text (uniforms.schema.js
// sceneTextOf, the engine's own rule) into the one it holds, its records written and its tags and values taken -- and
// a stand-in device that records what is written into the buffer. What it shows:
//   - the developer setting off, or a device with the spec's 8 storage bindings: codegen, as before;
//   - on: a copy added, a node deleted, moved, hidden, given another material -- applied with no compile, the records
//     written, the scene's tags the new tree's; new code compiles; a scene not shown compiles;
//   - a live value is written into the records (a node's frame is no uniform there), with no compile;
//   - undo of a copy added is the same text: the records written back, no compile;
//   - the culling boxes the host gives go into the records.
// What it cannot show is the picture, or the speed: the user's.
//======================================================================================================================
import * as M from '../model.js'
import * as P from '../project.js'
import { HEADER, REC, KIND } from '../scenedata.js'
import { sceneTextOf, SCENE_DATA_KEYS } from '../../lib/pathtracer/core/uniforms.schema.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }

const { installBuilder } = await import('../demo.js')

/* a device that records: each buffer's last write -- and, in order, every write of the scene's buffer and of its records'
   uniform copy (scenedata.js RECORDS_IN_UNIFORM), which must follow each with the same records */
const writes = [], order = []
const WG = {
    createStorageBuffer(bytes) {
        const b = { size: bytes, destroyed: false, destroy() { this.destroyed = true }, last: null }
        return { b, w(d) { b.last = new Float32Array(d); writes.push(b); order.push(['data', b.last]) } }
    },
    createBuffer(bytes, usage) {
        const b = { size: bytes, usage, destroyed: false, destroy() { this.destroyed = true }, last: null }
        return { b, w(d) { b.last = new Float32Array(d); order.push(['recs', b.last, b]) } }
    },
}
const gpu = { makeCompute: (b, m) => ({ wgsl: `${b}\n${m}`, module: { getCompilationInfo: async () => ({ messages: [] }) }, ready: Promise.resolve() }),
              makeShader: () => ({ getCompilationInfo: async () => ({ messages: [] }) }), device: { limits: { maxStorageBuffersPerShaderStage: 16 } } }

function standIn() {
    let state = { sceneData: 1 }
    const RT = {
        scene: null, compiles: 0, swaps: 0, invalidated: 0,
        set(values) { const unknown = []; for (const [k, v] of Object.entries(values)) { if (k in state) state[k] = structuredClone(v); else unknown.push(k) } return unknown },
        get: () => structuredClone(state),
        settings: () => ({}), applySettings: () => [],
        invalidate() { RT.invalidated++ },
        // lib/pathtracer/index.js updateScene, as it is there: what a scene says of itself that is no text, taken live
        updateScene(patch = {}) {
            const LIVE = ['envRadius', 'unit', 'extent']
            if (!RT.scene) return Object.keys(patch)
            for (const k of LIVE) if (k in patch) RT.scene[k] = patch[k]
            return Object.keys(patch).filter(k => !LIVE.includes(k))
        },
        updateScene(p) { for (const [k, v] of Object.entries(p)) RT.scene[k] = v; return [] },
        async setScene(s) {
            RT.compiles++
            const before = RT.scene
            if (s.init) s.buffers = await s.init(WG)
            if (before && before !== s) before.dispose?.()
            RT.scene = s
            state = { sceneData: state.sceneData, ...Object.fromEntries(Object.entries(s.uniforms).map(([k, u]) => [k, structuredClone(u.def)])) }
            return 1
        },
        // lib/pathtracer/index.js updateSceneData, as it is there
        updateSceneData(next) {
            const S = RT.scene
            if (!S?.writeData || !(next?.data instanceof Float32Array)) return false
            if (sceneTextOf(S) !== sceneTextOf(next)) return false
            if (!S.writeData(next.data)) return false
            for (const k of SCENE_DATA_KEYS) if (k in next) S[k] = next[k]
            for (const [k, u] of Object.entries(next.uniforms || {})) if (k in state) state[k] = structuredClone(u.def)
            RT.swaps++
            return true
        },
    }
    return RT
}
const u32 = (d, i) => new Uint32Array(d.buffer, d.byteOffset + 4 * i, 1)[0]
const records = d => { const out = []; for (let i = HEADER; i < u32(d, 0); i += REC) out.push(i); return out }
const objectsIn = d => records(d).filter(i => u32(d, 4 * i) === KIND.OBJECT).length
const lastWrite = () => writes.at(-1)?.last

const log = console.log, warn = console.warn
console.log = () => { }; console.warn = () => { }
const got = {}
try {
    const scene = () => {
        const d = P.blankScene('data')
        M.addObject(d, 'root', { id: 'ball', primitive: 'sphere' })
        M.addObject(d, 'root', { id: 'cube', primitive: 'box' })
        const g = M.addGroup(d, 'root', { id: 'grp' })
        M.addObject(d, g.id, { id: 'inner', primitive: 'sphere' })
        M.addMaterial(d, { id: 'red', preset: 'diffuse' })
        return d
    }
    // ---- off: codegen as before
    {
        const RT = standIn(); RT.set({ sceneData: 0 })
        const B = installBuilder({}, { RT, gpu, project: P.createProject([scene()]) })
        await B.apply()
        got.off = [!!RT.scene.data, RT.compiles, B.dataMode]
        M.duplicate(B.doc, 'ball'); await B.apply()
        got.offCopy = RT.compiles
    }
    // ---- on, on a device with the spec's 8 storage bindings a stage: codegen
    {
        const RT = standIn()
        const B = installBuilder({}, { RT, gpu: { ...gpu, device: { limits: { maxStorageBuffersPerShaderStage: 8 } } }, project: P.createProject([scene()]) })
        await B.apply()
        got.eight = [!!RT.scene.data, B.dataMode]
    }
    // ---- on
    {
        const RT = standIn()
        const B = installBuilder({}, { RT, gpu, project: P.createProject([scene()]) })
        await B.apply()
        const S = RT.scene
        got.first = [!!S.data, RT.compiles, objectsIn(lastWrite())]
        B.commit('start')
        // a copy added: same text, written, no compile
        const copy = M.duplicate(B.doc, 'ball')
        const r = await B.apply()
        got.copy = [r.ok, r.data, RT.compiles, RT.swaps, RT.scene === S, objectsIn(lastWrite()), RT.scene.tags.includes(copy.id ?? copy)]
        B.commit('copy')
        // moved into the group, hidden, another material, deleted: each written, none compiled
        M.move(B.doc, 'cube', 'grp'); await B.apply(); got.move = RT.compiles
        M.find(B.doc, 'inner').node.enabled = false; await B.apply(); got.hide = RT.compiles
        // another material the scene has: its id is in the record
        const matBefore = (() => { const d = lastWrite(); const i = records(d).find(i => u32(d, 4 * i) === KIND.OBJECT); return u32(d, 4 * i + 2) })()
        M.setMaterial(B.doc, 'ball', 'red'); await B.apply()
        const matAfter = (() => { const d = lastWrite(); const i = records(d).find(i => u32(d, 4 * i) === KIND.OBJECT); return u32(d, 4 * i + 2) })()
        got.mat = [RT.compiles, matBefore !== matAfter]
        // a material added: new text (getMaterial2 has a case for it), a compile
        M.addMaterial(B.doc, { id: 'blue', preset: 'diffuse' }); await B.apply(); got.newMat = RT.compiles
        M.remove(B.doc, 'cube'); await B.apply(); got.del = [RT.compiles, objectsIn(lastWrite())]
        B.commit('edits')
        // a live value: the frame is in the records, no uniform -- written, no compile
        const n = M.find(B.doc, 'ball').node
        n.transform.pos.x = 3
        const before = writes.length, compiled = RT.compiles
        got.live = [B.live('ball', 'transform'), writes.length > before, RT.compiles === compiled]
        B.commit('live')
        // the culling boxes from the host go into the records
        B.cullBoxes = () => new Map([['ball', { lo: [-1, -1, -1], hi: [1, 1, 1] }]])
        got.box = B.pushData({ reset: false })
        const d = lastWrite(), ballRec = records(d).find(i => u32(d, 4 * i) === KIND.OBJECT)
        got.boxIn = [d[4 * (ballRec + 5) + 3], d[4 * (ballRec + 6)]]
        // new code: compiled
        M.setCode(B.doc, 'ball', M.codeOf(B.doc, M.find(B.doc, 'ball').node) + '\n// another block')
        await B.apply()
        got.code = RT.compiles
        B.commit('code')
        // undo the code: the blocks carried (call 2) keep the text, so it is written back, not compiled
        got.undoCode = B.undo()
        got.undoCompiles = RT.compiles
    }
    // ---- undo of a copy added: the same text, written back
    {
        const RT = standIn()
        const B = installBuilder({}, { RT, gpu, project: P.createProject([scene()]) })
        await B.apply()
        M.duplicate(B.doc, 'ball'); B.commit('copy'); await B.apply()
        const n0 = objectsIn(lastWrite())
        got.undo = [B.undo(), RT.compiles, objectsIn(lastWrite()), n0, RT.scene.tags.length]
    }
    /* ---- THE UNIT REACHES THE ENGINE (0.36.0): a scene's numbers in every unit are the same text, so a unit change is
       taken without a compile as data (updateSceneData) and its undo and redo without one either way (sync's
       updateScene) -- and each left the engine in the unit it had: the key list lacked it, and sync passed the radius
       alone. As data, then in codegen (where the change itself compiles: setScene carries the new scene object). */
    for (const data of [1, 0]) {
        const RT = standIn(); RT.set({ sceneData: data })
        const B = installBuilder({}, { RT, gpu, project: P.createProject([scene()]) })
        await B.apply(); B.commit('start')
        const u0 = RT.scene.unit
        B.doc.unit = 'mm'; await B.apply(); B.commit('unit')
        const changed = RT.scene.unit
        const undo = B.undo(), afterUndo = RT.scene.unit
        const redo = B.redo(), afterRedo = RT.scene.unit
        got[`unit${data}`] = [u0, changed, undo, afterUndo, redo, afterRedo]
    }
    // ---- an array's copies: as data, another count is a write; in codegen, the same count is live and another a compile
    {
        const RT = standIn()
        const d = scene()
        const B = installBuilder({}, { RT, gpu, project: P.createProject([d]) })
        M.setCopies(B.doc, 'grp', M.copiesRow(3, 2)); await B.apply()
        const c0 = RT.compiles
        M.setCopies(B.doc, 'grp', M.copiesRow(5, 1)); await B.apply()
        got.arrData = [RT.compiles - c0, RT.swaps > 0]
        B.doc.root.children.find(n => n.id === 'grp').copies[0].pos.x = 7
        got.arrDataLive = B.live('grp', 'copies')
        const C = standIn(); C.set({ sceneData: 0 })
        const BC = installBuilder({}, { RT: C, gpu, project: P.createProject([scene()]) })
        /* a list that is no row: its copy moved, live. A row's copy moved off it (arrays.js, 0.79.0): refused, a compile --
           the row's window would leave copies out */
        const odd = M.copiesRow(3, 2); odd[2].pos.y = 1
        M.setCopies(BC.doc, 'grp', odd); await BC.apply()
        BC.doc.root.children.find(n => n.id === 'grp').copies[1].pos.y = 4
        got.arrCodeLive = [BC.live('grp', 'copies'), C.get()['cp1_grp']?.[13]]
        M.setCopies(BC.doc, 'grp', M.copiesRow(3, 2)); await BC.apply()
        const rowWindow = BC.live && C.scene?.arrayWindows?.get('grp')
        BC.doc.root.children.find(n => n.id === 'grp').copies[1].pos.y = 4
        got.arrCodeOff = [rowWindow, BC.live('grp', 'copies')]
        M.setCopies(BC.doc, 'grp', M.copiesRow(4, 2))
        got.arrCodeCount = BC.live('grp', 'copies')
    }
} finally { console.log = log; console.warn = warn }

ok('the setting off: codegen, and every structural edit a compile', got.off[0] === false && got.off[1] === 1 && got.off[2] === false && got.offCopy === 2, JSON.stringify(got))
ok('on, but a device with 8 storage bindings a stage: codegen', got.eight[0] === false && got.eight[1] === false, JSON.stringify(got.eight))
ok('on: the first apply compiles a scene of records', got.first[0] === true && got.first[1] === 1 && got.first[2] === 3, JSON.stringify(got.first))
ok('a copy added: applied as data -- no compile, the records written, the scene kept, its tags the new tree\'s',
    got.copy[0] && got.copy[1] && got.copy[2] === 1 && got.copy[3] === 1 && got.copy[4] && got.copy[5] === 4 && got.copy[6], JSON.stringify(got.copy))
ok('moved into a group, hidden, given another material: no compile', got.move === 1 && got.hide === 1 && got.mat[0] === 1 && got.mat[1], JSON.stringify([got.move, got.hide, got.mat]))
ok('a material added compiles (its case is text); a node deleted after it does not', got.newMat === 2 && got.del[0] === 2 && got.del[1] === 3, JSON.stringify([got.newMat, got.del]))
ok('a live value: written into the records, no compile', got.live[0] === true && got.live[1] && got.live[2], JSON.stringify(got.live))
ok('the host\'s culling box in the record (w = 1 known, hi.x)', got.box === true && got.boxIn[0] === 1 && got.boxIn[1] === 1, JSON.stringify([got.box, got.boxIn]))
ok('new code: a compile', got.code === 3, JSON.stringify(got.code))
ok('...and undone, its block still in the text (carried): written back, not compiled', got.undoCode === 'live' && got.undoCompiles === 3, JSON.stringify([got.undoCode, got.undoCompiles]))
ok('undo of a copy added: the same text, written back, no compile', got.undo[0] === 'live' && got.undo[1] === 1 && got.undo[2] === got.undo[3] - 1, JSON.stringify(got.undo))

for (const data of [1, 0]) {
    const g = got[`unit${data}`]
    ok(`the unit reaches the engine ${data ? 'as data' : 'in codegen'}: changed, undone and redone, each live`,
        g[0] === 'cm' && g[1] === 'mm' && g[2] === 'live' && g[3] === 'cm' && g[4] === 'live' && g[5] === 'mm', JSON.stringify(g))
}
ok('arrays as data: another count compiles nothing', got.arrData[0] === 0 && got.arrData[1], JSON.stringify(got.arrData))
ok('...a copy moved, live: written', got.arrDataLive === true)
ok('arrays in codegen: a copy moved, live -- its uniform written', got.arrCodeLive[0] === true && got.arrCodeLive[1] === 4, JSON.stringify(got.arrCodeLive))
ok('...but a row\'s copy moved off its row: not live, its window compiled for a row', got.arrCodeOff[0] === 1 && got.arrCodeOff[1] === false, JSON.stringify(got.arrCodeOff))
ok('...another count is no live write (the caller compiles)', got.arrCodeCount === false)

/* THE RECORDS' UNIFORM COPY (scenedata.js RECORDS_IN_UNIFORM): every write of a data scene's buffer -- made, an edit, a
   live value, undo -- followed by one of its copy, holding the header and the records exactly, a uniform buffer of the
   whole room (64 KiB) */
{
    const pairs = order.map((e, k) => [e, order[k + 1]]).filter(([e]) => e[0] === 'data')
    const bad = pairs.filter(([d, r]) => {
        if (!r || r[0] !== 'recs') return true
        const end = new Uint32Array(d[1].buffer, 0, 1)[0]
        return r[1].length !== 4 * end || !r[1].every((v, k) => Object.is(v, d[1][k]))
    })
    const recBuffers = new Set(order.filter(e => e[0] === 'recs').map(e => e[2]))
    ok('every write of the scene\'s buffer followed by its records\' copy, the same records', pairs.length > 5 && bad.length === 0, `${bad.length} of ${pairs.length}`)
    ok('...a uniform buffer (UNIFORM | COPY_DST) of 64 KiB', recBuffers.size > 0 && [...recBuffers].every(b => b.size === 65536 && b.usage === (0x40 | 0x08)))
}
console.log(`data apply: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
