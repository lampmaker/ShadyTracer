//======================================================================================================================
// Tests for the scene as data (builder/scenedata.js; codegen.js `data`). Run: node builder/test/scenedata.test.mjs
//
// WHAT IT IS FOR: a structural edit that adds no new code must not change the shader -- that is the whole point (the
// builder then writes the buffer instead of compiling). So, for every bundled scene and the builder's own cases:
//   - the edits that must be DATA ALONE leave every text the kernels compile (render, pick, optics) and every uniform
//     the same, and change the records: a value, a move, a material, a node hidden, a node added that is a copy of
//     one there, a node deleted, a node moved to another group;
//   - the edits that must COMPILE change the text: an object with new code;
//   - dataOf, the records made again for the scene's plan, is what generate made, and null for a tree that needs text;
//   - what is compiled as before (group code, a material's relief, a CSG group over either) and what is data;
//   - the records' own structure: every skip inside the table, a hidden CSG shape skips its join, a light in a CSG group
//     drawn after the outermost one's combine, inside its span.
// What it cannot check is that the evaluator computes what codegen computed: that is test/scenedata.gpu.mjs, on a WebGPU
// in node (optional), and the pictures, which are the user's.
//======================================================================================================================
import { readFileSync } from 'node:fs'
import * as M from '../model.js'
import { generate, isBefore, isAfter, codeOnly } from '../codegen.js'
import { MODIFIERS, modifierGroup } from '../modifiers.js'
import { planOf, KIND, FLAG, REC, HEADER, solidsOf } from '../scenedata.js'
import { EVERY_SCENE, fixturePath } from '../../test/scenes.mjs'
import { computeUniformTypes } from '../../lib/pathtracer/core/uniforms.schema.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
// a scene by its name in EVERY_SCENE (an example's file, or fixtures/<file>), or a fixture's file by name
const load = f => M.parse(readFileSync(EVERY_SCENE.find(s => s.name === f)?.path ?? fixturePath(f), 'utf8'))
const gen = (doc, carry = null) => generate(...M.generateArgs(doc, { id: 'built', data: true, carry }))
/* everything a kernel's text is made of: the four scene texts and the uniform struct */
const textOf = s => JSON.stringify([s.wgsl, s.pickWgsl, s.opticsWgsl, s.opticsPickWgsl, computeUniformTypes(s.uniforms)])
const u32 = (d, i) => new Uint32Array(d.buffer, d.byteOffset + 4 * i, 1)[0]
const recordsIn = d => { const end = u32(d, 0), out = []; for (let i = HEADER; i < end; i += REC) out.push(i); return out }
const kindAt = (d, i) => u32(d, 4 * i)
const nextOf = (d, i) => u32(d, 4 * i + 4)
const flagsOf = (d, i) => u32(d, 4 * i + 3)
const same = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]))

/* the first object of a document whose code is a preset's call and has a material, for the edits below */
const objects = doc => { const out = []; const go = n => { if (n.kind === 'object' && n.type === 'code') out.push(n); (n.children || []).forEach(go) }; go(doc.root); return out }
const topObject = doc => doc.root.children.find(n => n.kind === 'object' && n.type === 'code')

for (const { name: file } of EVERY_SCENE) {
    const doc = load(file)
    const s = gen(doc)
    const d0 = s.data
    ok(`${file}: a data scene: a buffer resource, records, init and dataOf`, s.resources?.sceneData === 'read array<vec4<f32>>'
        && d0 instanceof Float32Array && typeof s.init === 'function' && typeof s.dataOf === 'function' && u32(d0, 0) > HEADER - 1)
    ok(`${file}: dataOf makes the same records again, and the same tags`, same(s.dataOf(M.toTree(doc, { keepDisabled: true })).data, d0)
        && JSON.stringify(s.dataOf(M.toTree(doc, { keepDisabled: true })).tags) === JSON.stringify(s.tags))

    // ---- the records' structure
    const recs = recordsIn(d0)
    ok(`${file}: every skip inside the table`, recs.every(i => kindAt(d0, i) === KIND.END || (nextOf(d0, i) >= HEADER && nextOf(d0, i) <= u32(d0, 0))))
    ok(`${file}: every END names a CSG record`, recs.filter(i => kindAt(d0, i) === KIND.END).every(i => kindAt(d0, nextOf(d0, i)) === KIND.CSG))

    /* ---- the solids (scenedata.js solidsOf, the step cache's box: stepbox.js): every member of the root's union, each
       its first record -- no box when none is known, and its box in the world when it is (a unit box on every node here:
       worldBoxOf carried by each record's frame). The table of them that followed the records went with exact hits'
       ray list in 0.41.0: the records now end where the light table does. */
    {
        const S0 = solidsOf(d0)
        ok(`${file}: the records end at the light table's end, no table after them`,
            d0.length === 4 * (u32(d0, 1) + 4 * u32(d0, 2)), `${d0.length} floats`)
        ok(`${file}: every solid a record that starts a walk, no box with none known`, S0.every(x => x.start >= HEADER && x.start < u32(d0, 0) && x.box === null))
        const unit = new Map()
        const all = n => { unit.set(n.id, { lo: [-1, -1, -1], hi: [1, 1, 1] }); (n.children || []).forEach(all) }
        all(doc.root)
        const db = s.dataOf(M.toTree(doc, { keepDisabled: true }), unit)?.data
        const S1 = db ? solidsOf(db) : []
        ok(`${file}: ...and with boxes, each solid's box in the world`, !!db && S1.length === S0.length
            && S1.every(x => !x.box || [0, 1, 2].every(k => x.box.lo[k] < x.box.hi[k])), `${S1.length} solids, ${S1.filter(x => x.box).length} boxed`)
    }

    // ---- edits that are data alone
    const o = topObject(doc) || objects(doc)[0]
    if (o) {
        /* a parameter that a scaling changes: a number other than zero, or a vector's x other than zero (a box's
           rounding is 0 in menger and RGBW_mixer, and 0 * 1.5 is no edit) */
        const scalable = n => Object.keys(n.params || {}).find(k => typeof n.params[k] === 'number' && n.params[k] !== 0)
            ?? Object.keys(n.params || {}).find(k => typeof n.params[k]?.x === 'number' && n.params[k].x !== 0)
        const edits = {
            'a parameter': d => { const n = M.find(d, o.id).node; const k = scalable(n); if (k === undefined) return
                if (typeof n.params[k] === 'number') n.params[k] *= 1.5; else n.params[k].x *= 1.5 },
            'a move': d => { const n = M.find(d, o.id).node; n.transform ??= { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: 1 }; n.transform.pos.x += 0.25; n.transform.rot.z += 30 },
            'hidden': d => { M.find(d, o.id).node.enabled = false },
            'a copy of it added': d => { M.duplicate(d, o.id) },
            'it deleted': d => { M.remove(d, o.id) },
        }
        /* ANOTHER MATERIAL, one with no relief: a relief is shape, in the SDF, so putting one on is a compile (the examples
           since 0.54.0 have relief materials beside plain ones, which the scenes before never had) */
        const plainOther = n => doc.materials.find(m => m.id !== n.material && !m.relief)
        if (plainOther(o)) edits['another material'] = d => { const n = M.find(d, o.id).node; n.material = plainOther(n).id }
        /* A GROUP'S MATERIAL (model.js version 23): worn by what is below it, resolved in toTree -- another material for
           each, so data alone too, between plain materials: a surface with no code (code may read p_local, which is
           text) and no relief (shape), worn by nothing below that is not one -- on a top-level group with no group code
           in it, which is compiled text, the objects under it with it */
        const plainMat = m => m && M.typeOf(m) === 'surface' && !m.relief && !codeOnly(m.code ?? '').trim()
        const mats = doc.materials.filter(plainMat)
        let groupEdit = null
        M.walk(doc, (n, parent) => {
            if (groupEdit || parent !== doc.root || n.kind !== 'group') return
            const worn = []
            let code = false
            M.walk({ root: n }, x => {
                if (x.kind === 'object' && x.type === 'code') worn.push(M.material(doc, x.material))
                if (x.kind === 'group' && M.groupHasCode(doc, x)) code = true
            })
            const m = !code && worn.length && worn.every(plainMat) ? mats.find(m => worn.some(w => w.id !== m.id)) : null
            if (m) groupEdit = [n.id, m.id]
        })
        if (groupEdit) edits['a group\'s material'] = d => M.setMaterial(d, ...groupEdit)
        /* A COPY OR A DELETE of a shape whose points are compiled in (a path or profile not live) adds those points to the
           text or takes them out: a compile, as a new block is (model.js "A PATH"). Seen first on the light guide example
           (0.54.0); the carried blocks (gen's second argument) do not carry points, so a delete is a compile too. */
        const compiledPoints = Object.values(o.params || {}).some(v => ['path', 'profile'].includes(M.paramKind(v)) && !v?.live)
        if (compiledPoints) { delete edits['a copy of it added']; delete edits['it deleted'] }
        for (const [what, edit] of Object.entries(edits)) {
            const d = structuredClone(doc)
            edit(d)
            // the next scene carries the blocks of the one shown (call 2: deleting the last node of some code compiles nothing)
            const t = gen(d, s.blocks)
            ok(`${file}: ${what} is data alone: the same texts and uniforms`, textOf(t) === textOf(s), what)
            ok(`${file}: ...and different records`, !same(t.data, d0) || what === 'a parameter' && scalable(o) === undefined)
            const again = s.dataOf(M.toTree(d, { keepDisabled: true }))
            ok(`${file}: ...which dataOf of the scene shown makes too, with the new tree's tags`, !!again && same(again.data, t.data)
                && JSON.stringify(again.tags) === JSON.stringify(t.tags))
        }
        // ---- an edit that must compile: an object with code no block has
        {
            const d = structuredClone(doc)
            M.setCode(d, o.id, M.codeOf(d, M.find(d, o.id).node) + '\n// edited: a different block\nC = add_new(C, Nsphere(p - VEC3(0.0, 0.0, 9.0), 0.1), MATERIAL);')
            const t = gen(d)
            ok(`${file}: new code is new text`, t.wgsl !== s.wgsl)
            ok(`${file}: ...and the scene shown cannot make its records`, s.dataOf(M.toTree(d, { keepDisabled: true })) === null)
        }
    }
}

// ---- what is compiled as before, and what is data
{
    const doc = load('noise.json')
    const plan = planOf(M.toTree(doc, { keepDisabled: true }), { reliefMaterials: new Set(doc.materials.filter(m => m.relief).map(m => m.id)) })
    const coded = []; const go = n => { if (n.kind === 'group' && M.groupHasCode(doc, n) && n !== doc.root) coded.push(n.id); (n.children || []).forEach(go) }; go(doc.root)
    // ...and the one object outside them with a relief material (n25): a material's relief is compiled as before too
    const relief = new Set(doc.materials.filter(m => m.relief).map(m => m.id))
    ok('noise: every group with code is compiled as before, and every other compiled subtree an object with a relief material',
        coded.length > 0 && coded.every(id => plan.sub.has(id))
        && plan.subs.filter(n => !coded.includes(n.id)).every(n => n.kind === 'object' && relief.has(n.material)),
        JSON.stringify([coded, plan.subs.map(n => n.id)]))
    const free = objects(doc).filter(n => !coded.some(g => M.find(doc, g) && JSON.stringify(M.find(doc, g).node).includes(`"id":"${n.id}"`)))
    ok('noise: the objects outside them are data, in fewer blocks than objects', plan.blocks.length > 0 && plan.blocks.length < free.length,
        `${plan.blocks.length} blocks, ${free.length} objects`)
}
{
    const doc = load('OpticsBench.json')
    const s = gen(doc)
    const plan = planOf(M.toTree(doc, { keepDisabled: true }))
    // the table's repeat is a before group, its four shells after groups: functions, and everything under them data
    ok('OpticsBench: a block for each code its objects have, one function for the table\'s repeat, one for its shells', plan.blocks.length > 4
        && plan.befores.length === 1 && plan.afters.length === 1, `${plan.blocks.length} blocks, ${plan.befores.length} befores, ${plan.afters.length} afters`)
    ok('OpticsBench: nothing compiled as before', plan.subs.length === 0, `${plan.subs.length}`)
    ok('OpticsBench: the text is shorter than codegen\'s', s.wgsl.length < generate(...M.generateArgs(doc, { id: 'built' })).wgsl.length)
}
{
    // a CSG group with group code below it is compiled whole: its rules read the group's blend (SURFACE_ONLY, READ_REACH)
    const d = M.createDoc()
    const g = M.addGroup(d, 'root', { id: 'cut', blend: 0.1 })
    M.addObject(d, g.id, { id: 'base', primitive: 'box' })
    const round = M.addGroup(d, g.id, { id: 'rd', code: MODIFIERS.displace.code, params: structuredClone(MODIFIERS.displace.params) })
    M.addObject(d, round.id, { primitive: 'sphere', join: 'subtract' })
    const plan = planOf(M.toTree(d, { keepDisabled: true }))
    ok('a CSG group over group code is compiled whole', plan.sub.has('cut') && plan.subs.length === 1 && plan.blocks.length === 0)
    // ...but not over a before or an after group, which read nothing of it: the CSG group, the group and its sphere records
    M.setCode(d, 'rd', 'p.x = abs(p.x);\nwarp(1.0);\nC = children(C, p);')
    const plan2 = planOf(M.toTree(d, { keepDisabled: true }))
    ok('...over a before group it is data, the before group too', plan2.subs.length === 0 && plan2.befores.length === 1 && plan2.blocks.length === 2)
    M.setCode(d, 'rd', MODIFIERS.round.code)
    const plan3 = planOf(M.toTree(d, { keepDisabled: true }))
    ok('...over an after group too, and the CSG stack a level deeper for its Hit', plan3.subs.length === 0 && plan3.afters.length === 1 && plan3.depth === 2)
}

/* THE FRAMES' ARRAYS INDEXED ONLY WHERE A GROUP OPENS OR ENDS (0.22.16): every join, every answer folded in, every next
   copy works on the innermost frame in a variable of its own, top or atop (scenedata.js says why, and what measured it).
   A new read of stack[...] in the walk's per-shape path is the cost 0.22.16 took out, back. */
const framesAtEnds = w => {
    const all = w.match(/\ba?stack\[[^\]]*\]/g) || []
    const ends = w.match(/if \(depth > 0u\) \{ (?:stack\[depth - 1u\] = top|top = stack\[depth - 1u\]); \}|if \(ad > 0u\) \{ (?:astack\[ad - 1u\] = atop|atop = astack\[ad - 1u\]); \}/g) || []
    return all.length > 0 && all.length === ends.length
}

// ---- CSG deeper than the evaluator's stack: compiled as before, and said
{
    const d = M.createDoc()
    let parent = 'root'
    for (let k = 0; k < 9; k++) {
        const g = M.addGroup(d, parent, { id: `cut${k}`, blend: 0 })
        M.addObject(d, g.id, { id: `base${k}`, primitive: 'box' })
        M.addObject(d, g.id, { id: `hole${k}`, primitive: 'sphere', join: 'subtract' })
        parent = g.id
    }
    const s = gen(d)
    ok('CSG nine deep: made as before (no records), and the scene says why', !s.data && !s.resources?.sceneData && /room for 8/.test(s.dataRefused || ''), s.dataRefused)
    M.remove(d, 'cut8')
    const t = gen(d)
    ok('...eight deep: data, with a stack of 8', !!t.data && /array<ScnFrame, 8>/.test(t.wgsl))
    ok('...indexed only where a group opens or ends, the innermost frame in top', framesAtEnds(t.wgsl) && /var top: ScnFrame;/.test(t.wgsl))
}

/* ---- THE RECORDS' UNIFORM COPY (scenedata.js RECORDS_IN_UNIFORM, 0.22.19): every record the walk reads is read through
   scnRec -- the uniform copy below its room, the scene's buffer past it -- and nothing else is (the grid and exact hits, the
   scene's buffer alone, went in 0.41.0). One text whatever the number of records: 700 spheres are the text of 3, and the
   copy holds the first 4096 vec4s of them, written with the scene's buffer */
{
    const UNIFORM = 'uniform array<vec4<f32>, 4096>'
    const REC_READ = /sceneData\[(?:i|g|s0)\b/
    const d = M.createDoc()
    for (let k = 0; k < 3; k++) M.addObject(d, 'root', { id: `s${k}`, primitive: 'sphere' })
    const s = gen(d)
    const texts = [s.wgsl, s.pickWgsl, s.opticsWgsl, s.opticsPickWgsl]
    ok('the plain walk: a uniform copy of the records beside the scene\'s buffer', s.resources?.scnRecs === UNIFORM && s.resources?.sceneData === 'read array<vec4<f32>>')
    ok('...every copy reads a record through scnRec: the copy below 4096, the scene\'s buffer past it',
        texts.every(t => /fn scnRec\(k: u32\) -> vec4<f32> \{ if \(k < 4096u\) \{ return scnRecs\[k\]; \} return sceneData\[k\]; \}/.test(t)))
    ok('...and never straight from the scene\'s buffer', texts.every(t => !REC_READ.test(t)) && /let v0 = scnRec\(i\);/.test(s.wgsl))
    const big = structuredClone(d)
    for (let k = 3; k < 700; k++) M.addObject(big, 'root', { id: `s${k}`, primitive: 'sphere' })
    const b = gen(big, s.blocks)
    const end = u32(b.data, 0)
    ok('700 spheres: more records than the copy holds, and the text of 3', end > 4096 && textOf(b) === textOf(s) && b.resources?.scnRecs === UNIFORM, `${end} vec4s`)
    ok('...which dataOf of the 3\'s scene makes too (a data edit, no compile)', same(s.dataOf(M.toTree(big, { keepDisabled: true })).data, b.data))
    /* the buffers as init makes them, on a device that records */
    const made = []
    const WG = {
        createStorageBuffer: bytes => { const h = { b: { size: bytes }, w: x => { h.last = new Float32Array(x) } }; made.push(['storage', h]); return h },
        createBuffer: (bytes, usage) => { const h = { b: { size: bytes, usage }, w: x => { h.last = new Float32Array(x) } }; made.push(['uniform', h]); return h },
    }
    const bound = await b.init(WG)
    const U = made.find(m => m[0] === 'uniform')?.[1], St = made.find(m => m[0] === 'storage')?.[1]
    ok('init: the scene\'s buffer and the copy, 64 KiB, UNIFORM | COPY_DST, both bound', !!U && !!St && U.b.size === 65536 && U.b.usage === (0x40 | 0x08)
        && bound.scnRecs === U.b && bound.sceneData === St.b)
    ok('...the copy holding the first 4096 vec4s of the records, the scene\'s buffer all of them', U.last?.length === 4 * 4096
        && same(U.last, b.data.subarray(0, 4 * 4096)) && same(St.last.subarray(0, b.data.length), b.data))
    const small = s.dataOf(M.toTree(d, { keepDisabled: true })).data
    const rev0 = b.dataRev
    ok('...written again with the scene\'s buffer: the records alone', b.writeData(small) && same(U.last, small.subarray(0, 4 * u32(small, 0))))
    /* ITS DATA'S REVISION (attachData dataRev), which the renderer's step cache keeps its cells for (raytrace_main.js
       R.stepCacheFor): one more at every write that reached the GPU, by init or writeData, and none for a refused one */
    const tooBig = new Float32Array(St.b.size / 4 + 4)
    ok('the data\'s revision: one at init, one more a write, none for a write refused, and not a property a copy carries',
        rev0 === 1 && b.dataRev === 2 && b.writeData(tooBig) === false && b.dataRev === 2 && !Object.keys(b).includes('dataRev'),
        `${rev0} ${b.dataRev}`)
    await b.init(WG)
    ok('...and one more for init again (a recompile writes the buffer it has)', b.dataRev === 3, String(b.dataRev))
    const c = generate(...M.generateArgs(d, { id: 'built' }))
    ok('codegen: neither', !c.resources?.scnRecs && !/scnRec/.test(c.wgsl))
}

// ---- ARRAYS (model.js copies): the children once in the text, walked once a copy; the count is data
{
    const d = M.createDoc()
    M.addGroup(d, 'root', { id: 'arr' })
    M.addObject(d, 'arr', { id: 'ball', primitive: 'sphere' })
    M.addObject(d, 'root', { id: 'other', primitive: 'box' })
    const plain = gen(d)
    M.setCopies(d, 'arr', M.copiesRow(3, 2))
    const s3 = gen(d, plain.blocks)
    ok('an array: an ARRAY record, its child, an ARRAY_END naming it', (() => {
        const r = recordsIn(s3.data), a = r.find(i => kindAt(s3.data, i) === KIND.ARRAY), e = r.find(i => kindAt(s3.data, i) === KIND.ARRAY_END)
        return a !== undefined && e !== undefined && nextOf(s3.data, e) === a && nextOf(s3.data, a) === e + REC && u32(s3.data, 4 * a + 1) === 3
    })())
    ok('...the first array in a scene is new text (the evaluator\'s array stack)', textOf(s3) !== textOf(plain))
    const d5 = structuredClone(d); M.setCopies(d5, 'arr', M.copiesRow(5, 1, 'z'))
    const s5 = gen(d5, s3.blocks)
    ok('another count, other places: data alone -- the same text', textOf(s5) === textOf(s3) && !same(s5.data, s3.data))
    ok('...which dataOf of the scene shown makes too', same(s3.dataOf(M.toTree(d5, { keepDisabled: true })).data, s5.data))
    const nested = structuredClone(d); M.addGroup(nested, 'arr', { id: 'in' }); M.addObject(nested, 'in', { primitive: 'box' }); M.setCopies(nested, 'in', M.copiesRow(2, 1))
    ok('an array in an array: still four deep of room, the same text with one more record', textOf(gen(nested, s3.blocks)) === textOf(s3) || /array<ScnArray, 4>/.test(gen(nested, s3.blocks).wgsl))
    // in codegen: the children once, in a loop over a uniform a copy
    const c = generate(...M.generateArgs(d, { id: 'built' }))
    ok('codegen: the child\'s code once, in a loop over three copies, a uniform each', (c.wgsl.match(/\/\/ node ball/g) || []).length === 1
        && /for \(var ci_arr = 0u; ci_arr < 3u;/.test(c.wgsl) && ['cp0_arr', 'cp1_arr', 'cp2_arr'].every(k => k in c.uniforms) && !('cp3_arr' in c.uniforms))
}

// ---- BEFORE GROUPS (codegen isBefore): code that only moves the point its children see is a record, its children too
{
    const isB = code => isBefore({ kind: 'group', code })
    ok('the four space modifiers are before groups; round, shell, displace and the relief are not',
        ['twist', 'bend', 'repeat', 'mirror'].every(k => isB(MODIFIERS[k].code)) && ['round', 'shell', 'displace', 'relief'].every(k => !isB(MODIFIERS[k].code)))
    ok('...nor code that names C before its call, calls it twice, returns, or reads the relief\'s words',
        ['let d = C.s.w;\nC = children(C, p);', 'C = children(C, p);\nC = children(C, p + VEC3(1.0));', 'if (p.x > 9.0) { return C; }\nC = children(C, p);',
         'let k = select(1.0, 0.5, SURFACE_ONLY);\nC = children(C, p);', 'C = children(C, p);\np.x = 1.0;', 'C = children(emptyHit(r), p);'].every(c => !isB(c)))
    ok('...and comments do not count, nested ones either, nor a code\'s line breaks',
        isB('/* a /* nested */ comment naming C */ p.x = abs(p.x); // C too\nC = children( C , p ) ;  // the end\n'))
    ok('...nor its straightMaterial mark, unless that frame is in force (a material with a relief, or reading p_local)',
        isBefore({ kind: 'group', code: MODIFIERS.twist.code, straightMaterial: true }, { straight: false })
        && !isBefore({ kind: 'group', code: MODIFIERS.twist.code, straightMaterial: true }))

    const d = M.createDoc()
    M.addGroup(d, 'root', { id: 'tw', ...modifierGroup('twist') })
    M.addObject(d, 'tw', { id: 'ball', primitive: 'sphere' })
    M.addObject(d, 'tw', { id: 'cube', primitive: 'box' })
    M.addObject(d, 'root', { id: 'other', primitive: 'box' })
    const s = gen(d), data = s.data, recs = recordsIn(data)
    const b = recs.find(i => kindAt(data, i) === KIND.BEFORE), e = recs.find(i => kindAt(data, i) === KIND.BEFORE_END)
    ok('a twist: a BEFORE record, its two children, a BEFORE_END naming it, nothing compiled',
        b !== undefined && e === b + 3 * REC && nextOf(data, e) === b && nextOf(data, b) === e + REC && !/fn sub_/.test(s.wgsl) && /fn bef_0\(/.test(s.wgsl))
    ok('...its children not culled alone (the code moves them), the twist itself at the top level is',
        (flagsOf(data, b) & FLAG.CULLABLE) !== 0 && (flagsOf(data, b + REC) & FLAG.CULLABLE) === 0)
    const edits = {
        'its rate': x => { M.find(x, 'tw').node.params.rate = 2.5 },
        'a child moved': x => { const n = M.find(x, 'ball').node; n.transform ??= { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: 1 }; n.transform.pos.z = 0.75 },
        'a child added': x => { M.duplicate(x, 'cube') },
        'a child deleted': x => { M.remove(x, 'cube') },
        'a node moved into it': x => { M.move(x, 'other', 'tw') },
        'a second twist': x => { M.duplicate(x, 'tw') },
        'the twist hidden': x => { M.setEnabled(x, 'tw', false) },
    }
    for (const [what, edit] of Object.entries(edits)) {
        const x = structuredClone(d)
        edit(x)
        const t = gen(x, s.blocks)
        ok(`a twist: ${what} is data alone`, textOf(t) === textOf(s) && !same(t.data, data), what)
        const again = s.dataOf(M.toTree(x, { keepDisabled: true }))
        ok(`...which dataOf of the scene shown makes too (${what})`, !!again && same(again.data, t.data))
    }
    {
        const x = structuredClone(d)
        M.setCode(x, 'tw', MODIFIERS.twist.code.replace('warp(', 'p.z = p.z * 1.0;\nwarp('))
        ok('a twist: its code edited is new text', textOf(gen(x, s.blocks)) !== textOf(s) && s.dataOf(M.toTree(x, { keepDisabled: true })) === null)
    }
    {
        /* a material reading p_local: data too since 0.22.0, codegen's local point under a warp the records' (its children
           function sets XF_P; scenedata.gpu.mjs compares the two). Until then it was compiled, and every copy of a lens
           assembly with a shell in it was code of its own (roadmap/ARCHITECTURE.md step 4) */
        const x = structuredClone(d)
        const m = M.addMaterial(x, { code: 'm.albedo = VEC3(fract(p_local.x));' })
        M.find(x, 'ball').node.material = m.id
        const t = gen(x)
        ok('a twist in a scene that reads p_local: data, a BEFORE record, nothing compiled', !!t.data && /fn bef_0\(/.test(t.wgsl) && !/fn sub_/.test(t.wgsl)
            && recordsIn(t.data).some(i => kindAt(t.data, i) === KIND.BEFORE))
        ok('...codegen\'s children function hands its children the point the twist gives them, XF_P too',
            /fn children_tw\([^]*?let xfp_children_in = XF_P; XF_P = p;[^]*?XF_P = xfp_children_in;\s*return C;/.test(generate(M.toTree(x, { keepDisabled: true }), { id: 'built' }).wgsl))
        M.find(x, 'tw').node.straightMaterial = true
        ok('...but marked straightMaterial it is compiled: the material frame is in force there', /fn sub_0\(/.test(gen(x).wgsl) && !/fn bef_0\(/.test(gen(x).wgsl))
    }
    {
        // a twist in an array, an array in a twist: one base-frame stack, each a level
        const x = structuredClone(d)
        M.addGroup(x, 'tw', { id: 'row' }); M.move(x, 'ball', 'row'); M.setCopies(x, 'row', M.copiesRow(3, 1))
        const t = gen(x)
        ok('an array inside a twist: two levels of base frames, data', !!t.data && /array<ScnArray, 4>/.test(t.wgsl) && /fn bef_0\(/.test(t.wgsl))
        ok('...indexed only where one opens or ends, the innermost in atop', framesAtEnds(t.wgsl) && /var atop: ScnArray;/.test(t.wgsl))
    }
}

// ---- AFTER GROUPS (codegen isAfter): code that only works on what its children gave is a record, its children too
{
    const isA = code => isAfter({ kind: 'group', code })
    ok('round and shell are after groups; displace and the relief (they read the CSG chain above them) and the space ones not',
        ['round', 'shell'].every(k => isA(MODIFIERS[k].code)) && ['displace', 'relief', 'twist', 'bend', 'repeat', 'mirror'].every(k => !isA(MODIFIERS[k].code)))
    ok('...nor code that moves p first, warps after, calls children again, or returns',
        ['p.x = abs(p.x);\nvar H = children(emptyHit(r), p);\nC = fold(C, H.s, H.m);', 'var H = children(emptyHit(r), p);\nwarp(0.5);\nC = fold(C, H.s, H.m);',
         'var H = children(emptyHit(r), p);\nlet G = children(emptyHit(r), p * 2.0);\nC = fold(C, H.s, H.m);', 'var H = children(emptyHit(r), p);\nif (H.s.w > 1.0) { return C; }\nC = fold(C, H.s, H.m);',
         'var H = children(C, p);\nC = fold(C, H.s, H.m);'].every(c => !isA(c)))
    ok('...but a let, another name and comments are one', isA('// a shell\nlet Kids = children( emptyHit( r ), p ); /* then */\nC = fold(C, Kids.s, Kids.m);'))

    const d = M.createDoc()
    M.addGroup(d, 'root', { id: 'sh', ...modifierGroup('shell') })
    M.addObject(d, 'sh', { id: 'ball', primitive: 'sphere' })
    M.addObject(d, 'sh', { id: 'cube', primitive: 'box' })
    M.addObject(d, 'root', { id: 'other', primitive: 'box' })
    const s = gen(d), data = s.data, recs = recordsIn(data)
    const a = recs.find(i => kindAt(data, i) === KIND.AFTER), e = recs.find(i => kindAt(data, i) === KIND.AFTER_END)
    ok('a shell: an AFTER record, its two children, an AFTER_END naming it, nothing compiled, a Hit of its own on the stack',
        a !== undefined && e === a + 3 * REC && nextOf(data, e) === a && nextOf(data, a) === e + REC && !/fn sub_/.test(s.wgsl)
        && /fn aft_0\(/.test(s.wgsl) && /array<ScnFrame, 4>/.test(s.wgsl))
    ok('...that stack indexed only where a group opens or ends', framesAtEnds(s.wgsl))
    ok('...its children not culled alone (its code changes their distances), the shell itself at the top level is',
        (flagsOf(data, a) & FLAG.CULLABLE) !== 0 && (flagsOf(data, a + REC) & FLAG.CULLABLE) === 0)
    const edits = {
        'its thickness': x => { M.find(x, 'sh').node.params.thickness = 0.2 },
        'a child added': x => { M.duplicate(x, 'cube') },
        'a child deleted': x => { M.remove(x, 'cube') },
        'a node moved into it': x => { M.move(x, 'other', 'sh') },
        'a second shell': x => { M.duplicate(x, 'sh') },
    }
    for (const [what, edit] of Object.entries(edits)) {
        const x = structuredClone(d)
        edit(x)
        const t = gen(x, s.blocks)
        ok(`a shell: ${what} is data alone`, textOf(t) === textOf(s) && !same(t.data, data), what)
        const again = s.dataOf(M.toTree(x, { keepDisabled: true }))
        ok(`...which dataOf of the scene shown makes too (${what})`, !!again && same(again.data, t.data))
    }
    {
        const x = structuredClone(d)
        M.addGroup(x, 'root', { id: 'rd', ...modifierGroup('round') })
        M.move(x, 'sh', 'rd')
        ok('a shell in a round: new text (a second after code, a deeper stack), both data', (() => { const t = gen(x, s.blocks); return textOf(t) !== textOf(s) && !/fn sub_/.test(t.wgsl) && /fn aft_1\(/.test(t.wgsl) })())
    }
}

// ---- a hidden CSG shape skips its join; a light in a CSG group is drawn after the combine, inside the group's span
{
    const d = M.createDoc()
    const g = M.addGroup(d, 'root', { id: 'cut', blend: 0 })
    M.addObject(d, g.id, { id: 'base', primitive: 'box' })
    M.addObject(d, g.id, { id: 'hole', primitive: 'sphere', join: 'subtract' })
    M.addLight?.(d, g.id, { id: 'lamp', shape: 'disc' })
    M.setEnabled(d, 'hole', false)
    const s = gen(d), data = s.data, recs = recordsIn(data)
    const at = k => recs.filter(i => kindAt(data, i) === k)
    const [csg] = at(KIND.CSG), joins = at(KIND.JOIN), [end] = at(KIND.END)
    const hole = recs.filter(i => kindAt(data, i) === KIND.OBJECT)[1]
    ok('the CSG group: two joins, one END', joins.length === 2 && end !== undefined)
    ok('a hidden shape is not shown, and skips past its join', (flagsOf(data, hole) & FLAG.VISIBLE) === 0 && nextOf(data, hole) === joins[1] + REC)
    if (M.addLight) {
        const [lamp] = at(KIND.LIGHT)
        ok('a light in a CSG group comes after its END, inside the group\'s span', lamp > end && nextOf(data, csg) > lamp)
    }
}

/* ---- A PLAIN GROUP AS ONE OF A CSG GROUP'S SHAPES (0.next, codegen.js combinedGroups), as codegen emits it: a CSG record
   of its own, each child a JOIN of a union, an END -- not a GROUP whose children's records fold one by one. An array's
   copies one combine: a CSG record around the ARRAY, a JOIN after every shape (the base's a union at the group's blend,
   whatever join it keeps dormant: at the copies after the first it is taken), the END after the ARRAY_END. And GROUP
   CODE WHOSE OWN CHILDREN JOIN is compiled as before: its children function combines them, which a BEFORE's or an
   AFTER's records, folding its children's in, did not (a mirror of a box less a sphere was the box and the sphere). */
{
    const at = (x, y, z) => ({ pos: { x, y, z }, rot: { x: 0, y: 0, z: 0 }, scale: 1 })
    const d = M.createDoc()
    M.addGroup(d, 'root', { id: 'part' })
    M.addObject(d, 'part', { id: 'hb', primitive: 'box' })
    M.addGroup(d, 'part', { id: 'rig', join: 'subtract' })
    M.addObject(d, 'rig', { id: 'ra', primitive: 'sphere' }); M.addObject(d, 'rig', { id: 'rb', primitive: 'sphere' })
    M.addGroup(d, 'part', { id: 'row', join: 'subtract' })
    M.addObject(d, 'row', { id: 'rs', primitive: 'sphere', join: 'intersect' })        // the base: its join dormant
    M.setCopies(d, 'row', [at(-0.5, 0, 0), at(0.5, 0, 0)])
    const s = gen(d), data = s.data, recs = recordsIn(data)
    const NAME = Object.fromEntries(Object.entries(KIND).map(([k, v]) => [v, k]))
    ok('a plain group and an array as shapes: each its own CSG record, a JOIN after each of its shapes, an END',
        recs.map(i => NAME[kindAt(data, i)]).join(' ') === 'CSG OBJECT JOIN CSG OBJECT JOIN OBJECT JOIN END JOIN CSG ARRAY OBJECT JOIN ARRAY_END END JOIN END',
        recs.map(i => NAME[kindAt(data, i)]).join(' '))
    const joinOp = i => u32(data, 4 * i + 1), blendAt = i => data[4 * i + 7]
    const joins = recs.filter(i => kindAt(data, i) === KIND.JOIN)
    ok('...every JOIN inside them a union at 0, the array\'s base too; the part\'s their subtractions',
        same(joins.map(joinOp), [0, 0, 0, 1, 0, 1]) && joins.every(i => blendAt(i) === 0), JSON.stringify(joins.map(joinOp)))
    const [, , rowCsg] = recs.filter(i => kindAt(data, i) === KIND.CSG)
    const ends = recs.filter(i => kindAt(data, i) === KIND.END)
    ok('...the array\'s END closes the CSG record around it, and that record skips past it', nextOf(data, ends[1]) === rowCsg
        && nextOf(data, rowCsg) === ends[1] + REC && kindAt(data, rowCsg + REC) === KIND.ARRAY)
    ok('...the evaluator has a stack for the two levels', s.wgsl.includes('array<ScnFrame, 4>'))

    for (const mod of ['mirror', 'round']) {
        const x = M.createDoc()
        M.addGroup(x, 'root', { id: 'g', ...modifierGroup(mod) })
        M.addObject(x, 'g', { id: 'b', primitive: 'box' })
        M.addObject(x, 'g', { id: 'h', primitive: 'sphere', join: 'subtract' })
        const plan = planOf(M.toTree(x, { keepDisabled: true }))
        ok(`a ${mod} whose own children join is compiled as before, its children function the combine`,
            plan.sub.has('g') && plan.befores.length + plan.afters.length === 0, JSON.stringify([...plan.sub.keys()]))
        M.setJoin(x, 'h', 'union')
        const plain = planOf(M.toTree(x, { keepDisabled: true }))
        ok(`...and with its children a plain union, data as before`, plain.subs.length === 0 && plain.befores.length + plain.afters.length === 1)
    }
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
