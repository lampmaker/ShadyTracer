//======================================================================================================================
// Tests for the import's progress and the dialog's answers (0.next), no GPU and no DOM:
//   - convert's onProgress: a fraction from 0 to 1 that never goes back, each solid of an assembly its own share, its
//     stage said in words, the last report 1; csg.js's stages each in order, done never above total, each ending whole;
//   - the worker's throttle (import/progress.js): the first at once, at most one each PROGRESS_MS after, the latest kept,
//     flush sending what is held and nothing twice;
//   - what the worker sends (resultMessage): each part's name, group id and report, no formulas;
//   - withoutParts and withoutRed (import/asset.js): a part left out of an assembly, its materials and blocks with it,
//     the last part left out nothing; the red taken back to the part's material;
//   - the dialog's words (builder/importdialog.js isClean, partLines): clean only when nothing refused, approximated,
//     disagreeing or warned of; each part's lines.
// Run: node import/test/progress.test.mjs
//======================================================================================================================
import { readFileSync } from 'node:fs'
import * as M from '../../builder/model.js'
import { convert, PROGRESS } from '../index.js'
import { toCSG } from '../csg.js'
import { brep } from '../brep.js'
import { readSTEP } from '../step.js'
import { throttle, resultMessage, PROGRESS_MS } from '../progress.js'
import { withoutParts, withoutRed, APPROX_ID } from '../asset.js'
import { isClean, partLines } from '../../builder/importdialog.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const fixture = n => readFileSync(new URL(`./fixtures/${n}`, import.meta.url))

// CSG.JS'S STAGES, on the bracket
{
    const B = brep(readSTEP(fixture('bracket.step').toString('latin1')).solids[0])
    const seen = []
    toCSG(B, { onProgress: p => seen.push(p) })
    const order = ['surfaces', 'cells', 'cover', 'check']
    const idx = seen.map(p => order.indexOf(p.stage))
    ok('toCSG: every stage reported, in order', order.every(s => seen.some(p => p.stage === s)) && idx.every((x, i) => i === 0 || x >= idx[i - 1]), seen.map(p => p.stage).join(','))
    ok('...done never above total, never negative', seen.every(p => p.done >= 0 && p.done <= p.total))
    ok('...each stage ending whole', order.every(s => { const last = seen.filter(p => p.stage === s).pop(); return last.done === last.total }))
    ok('...PROGRESS covering 0 to 1 in the same order, no gap', PROGRESS.surfaces[0] === 0 && PROGRESS.check[1] === 1
        && order.every((s, i) => i === 0 || PROGRESS[s][0] === PROGRESS[order[i - 1]][1]))
}

// CONVERT'S FRACTION, a part and an assembly
for (const [file, parts] of [['plate.step', 1], ['assembly.step', 2], ['bracket.stl', 1]]) {
    const seen = []
    const r = convert(M, file, fixture(file), { onProgress: p => seen.push(p) })
    ok(`${file}: converted, as before`, r.parts.length === parts && !r.refused.length)
    ok(`...its fraction from 0 to 1, never going back`, seen[0].fraction === 0 && seen[seen.length - 1].fraction === 1
        && seen.every((p, i) => i === 0 || p.fraction >= seen[i - 1].fraction - 1e-12), seen.map(p => p.fraction.toFixed(3)).join(' '))
    ok('...each report in words', seen.every(p => typeof p.label === 'string' && p.label.length > 0))
    if (parts > 1) {
        ok('...an assembly\'s parts each said, k of n', [1, 2].every(k => seen.some(p => p.part === k && p.parts === 2 && p.label.includes(`part ${k} of 2`))))
        const firstOf2 = seen.find(p => p.part === 2)
        ok('...the second part starting where the first left off (its share)', firstOf2 && Math.abs(firstOf2.fraction - (0.05 + 0.95 / 2)) < 1e-9, firstOf2?.fraction)
    }
}

// THE THROTTLE, on a clock of its own
{
    let t = 0
    const got = []
    const f = throttle(p => got.push(p), PROGRESS_MS, () => t)
    f(1); t = 10; f(2); t = 50; f(3)
    ok('throttle: the first at once, the rest held', got.join() === '1')
    t = 100; f(4)
    ok('...one each PROGRESS_MS, the latest', got.join() === '1,4')
    t = 120; f(5); f.flush()
    ok('...flush sending what is held', got.join() === '1,4,5')
    f.flush()
    ok('...and nothing twice', got.join() === '1,4,5')
}

// WHAT THE WORKER SENDS, AND THE ANSWERS
{
    const r = convert(M, 'assembly.step', fixture('assembly.step'))
    const msg = resultMessage(r)
    ok('resultMessage: each part its name, group id and report, nothing that is a function', msg.ok && msg.parts.length === 2
        && msg.parts.every(p => p.name && p.id && p.report && Object.keys(p).length === 3) && !JSON.stringify(msg).includes('"sdf"'))
    ok('...structured-clonable (what postMessage needs)', (() => { try { structuredClone(msg); return true } catch { return false } })())
    const [a, b] = msg.parts
    const left = withoutParts(msg.asset, [a.id])
    ok('withoutParts: the other part kept, the one left out gone', left.node.children.length === 1 && left.node.children[0].id === b.id)
    const doc = M.ensureMaterial(M.createDoc()); doc.unit = 'mm'
    M.insertAsset(doc, left, 'root')
    ok('...and what is left pastes soundly', !M.validate(doc).length, M.validate(doc).join('; '))
    const used = new Set(); const walk = n => { if (n.block) used.add(n.block); (n.children || []).forEach(walk) }; walk(left.node)
    ok('...its blocks only those still used', left.blocks.every(x => used.has(x.id)) && left.blocks.length <= msg.asset.blocks.length)
    ok('...both left out: nothing', withoutParts(msg.asset, [a.id, b.id]) === null)
    ok('...none left out: the asset itself', withoutParts(msg.asset, []) === msg.asset)
    const one = convert(M, 'plate.step', fixture('plate.step')).asset
    ok('...a part on its own left out: nothing', withoutParts(one, [one.node.id]) === null)
    ok('...the asset given unchanged', msg.asset.node.children.length === 2)
}
{
    const white = M.addMaterial(M.createDoc(), { label: 'white', preset: 'diffuse' })
    const asset = convert(M, 'plate.step', fixture('plate.step'), { material: white }).asset
    // a red material on one shape, as a fitted face's (freeform.js), by hand
    const red = { ...structuredClone(asset.materials[0]), id: APPROX_ID, label: 'approximated face' }
    const a = structuredClone(asset)
    a.materials.push(red)
    a.node.children[1].material = APPROX_ID
    const b = withoutRed(a)
    ok('withoutRed: the red shape in the part\'s material', b.node.children[1].material === asset.materials[0].id && !b.materials.some(m => m.id === APPROX_ID))
    ok('...an asset with no red the same', withoutRed(asset) === asset)
}
{
    const part = (id, report) => ({ name: id, id, report: { shapes: 3, groups: 1, mismatches: 0, checked: 100, ...report } })
    const clean = { ok: true, asset: {}, parts: [part('a')], refused: [], warnings: [] }
    ok('isClean: a clean conversion', isClean(clean))
    ok('...not with a point disagreeing', !isClean({ ...clean, parts: [part('a', { mismatches: 6 })] }))
    ok('...not with a face fitted', !isClean({ ...clean, parts: [part('a', { approximated: 1, deviation: 0.02 })] }))
    ok('...not with a part refused', !isClean({ ...clean, refused: [{ name: 'b', why: 'B-spline' }] }))
    ok('...not with a warning', !isClean({ ...clean, warnings: ['an edge taken as straight'] }))
    ok('...not with nothing to paste', !isClean({ ...clean, asset: null }))
    const L = partLines({ ...clean, parts: [part('a', { mismatches: 6, checked: 2965 })], refused: [{ name: 'b', why: 'a face on a B-spline', needs: 0.12 }] })
    ok('partLines: the converted first, then the refused', L.map(p => `${p.name}:${p.ok}`).join() === 'a:true,b:false')
    ok('...the disagreement said with its count', L[0].lines.some(l => l.tone === 'warn' && l.text.startsWith('6 of 2965')))
    ok('...the refusal with the deviation it would need', L[1].lines[0].tone === 'bad' && L[1].lines[0].text.includes('0.12 mm'))
}

console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
