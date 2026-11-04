//======================================================================================================================
// IMPORT -- a STEP or STL file into shapes the builder has: each solid in it converted into a group of boxes,
// cylinders, cones, spheres, tori and rounded prisms joined by union, intersect and subtract (csg.js, shapes.js),
// standing on z = 0 (convert's `place`), handed to the page as an asset (builder/model.js extractAsset's form) that the
// tree pastes into the scene being worked on.
//
// WHAT CAN BE CONVERTED: a solid whose faces all lie on planes, cylinders, cones, spheres and tori -- most machined
// and moulded parts, a spherical lens, a housing with holes, fillets and chamfers. What cannot is refused by name,
// with why: a face on a B-spline (a freeform surface, an asphere exported from CAD), a mesh that is not closed. Those
// need the other route roadmap/IMPORT.md describes (a baked distance grid), which is not built.
//
// IN MILLIMETRES, the unit of the asset: STEP says its unit (step.js), STL says none and every slicer and CAD program
// writes it in millimetres, so that is what it is taken as. The tree converts the asset into the scene's unit as it
// pastes it (model.js insertAsset).
//
// PURE, like everything in import/ (model.js is passed in), so the conversion can run in a Worker (worker.js) and in
// Node (import/test/).
//
//   convert(model, name, bytes, { material, seed, place: 'floor' | 'file', onProgress }) ->
//       { asset | null, parts: [{ name, id, report, ir, csg, box }], refused: [{ name, why }], warnings, kind: 'step' | 'stl' }
//   onProgress({ label, fraction, part, parts }): what it is doing and how far, 0 to 1, for the page's import dialog
//   (builder/importdialog.js) -- csg.js's stages weighted by what they took on the user's 121-face part (PROGRESS)
//   asset.js: withoutParts and withoutRed, what the dialog's answers do to the asset
//======================================================================================================================

import { readSTEP } from './step.js'
import { brep } from './brep.js'
import { toCSG } from './csg.js'
import { shapesOf, addPart, countShapes, shapeSDF } from './shapes.js'
import { readSTL } from './stl.js'
import { meshSolid } from './fit.js'
export { withoutParts, withoutRed, APPROX_ID, MAX_DEVIATION } from './asset.js'

/** Which reader a file is for, by its name and then its first bytes. */
export function kindOf(name, bytes) {
    if (/\.(stp|step|p21)$/i.test(name)) return 'step'
    if (/\.stl$/i.test(name)) return 'stl'
    const head = new TextDecoder('latin1').decode(bytes.slice(0, 80))
    if (/^ISO-10303-21/.test(head)) return 'step'
    return null
}

/* HOW FAR ALONG A SOLID IS, by csg.js's stage: each stage's share of the time it took on the user's 121-face part
   (Node, the container, 2026-11-04: 0.6 s to the half-spaces, 8.6 s classifying the points, 12.4 s covering the
   cells, 0.9 s checking). A guess for any other part, but in the right order of size: the bar moves through the
   slow stages slowly. The cover's `done` is the cells covered, which comes fast at first and slowly at the end. */
export const PROGRESS = { surfaces: [0, 0.03], cells: [0.03, 0.4], cover: [0.4, 0.95], check: [0.95, 1] }
const STAGE_WORDS = { surfaces: 'finding its surfaces', cells: 'classifying points inside and out', cover: 'building the formula',
                      check: 'checking it' }

/** One solid (brep.js's) as a part: its formula, its shapes, and how well they hold to the solid. `onProgress` gets
 *  csg.js's stages as { stage, done, total, fraction (0 to 1 of this solid) }. */
export function convertSolid(B, { seed = 1, onProgress = null, fillets = true } = {}) {
    const tell = onProgress && (({ stage, done, total }) => {
        const [a, b] = PROGRESS[stage]
        onProgress({ stage, done, total, fraction: a + (b - a) * (total ? done / total : 1) })
    })
    const csg = toCSG(B, { seed, onProgress: tell, fillets })
    const ir = shapesOf(csg)
    return { csg, ir, report: { ...csg.report, ...countShapes(ir.root) } }
}

/* WHERE THE IMPORT STANDS (the user's Onshape part, 2026-10-21): kept where the file put it, a part sat at its own
   coordinates -- its group at the middle of its box, which for a part drawn around its origin is half under a floor at
   z = 0. So, `place: 'floor'` (the page's): the whole import moved to stand on z = 0, centred over the origin; its
   parts keep their places in it, so an assembly stays put together. `place: 'file'` leaves it where the file has it.
   The file's axes are kept either way: STEP says nothing of which way is up, and one exporter's up is another's
   front, so a part modelled along y comes in lying along y. */
export function convert(model, name, bytes, { material = null, seed = 1, place = 'floor', onProgress = null, fillets = true } = {}) {
    const kind = kindOf(name, bytes)
    if (!kind) throw new Error(`${name}: not a STEP or STL file (by its name or its first line)`)
    const base = String(name).replace(/\.[^.]+$/, '') || 'part'
    const warnings = [], refused = [], parts = []
    /* THE BAR: reading the file the first 5 %, each solid an equal share of the rest (one solid's stages: PROGRESS) */
    const READ = 0.05
    const tell = (label, fraction, part = 0, parts = 0) => onProgress?.({ label, fraction: Math.min(1, Math.max(0, fraction)), part, parts })
    tell(`reading the ${kind === 'step' ? 'STEP' : 'STL'} file`, 0)
    let solids
    if (kind === 'step') {
        const text = new TextDecoder(utf8(bytes) ? 'utf-8' : 'latin1').decode(bytes)
        const r = readSTEP(text)
        warnings.push(...r.warnings)
        /* NAMED: a part on its own by its file, which the user chose -- what an exporter writes for its product is often
           its own name ("Open CASCADE STEP translator 7.9 1"); an assembly's parts by their products, the group by the
           file */
        solids = r.solids.map(s => ({ name: r.solids.length === 1 ? base : s.name || base, B: () => brep(s) }))
    } else {
        // an STL's header is the exporter's ("STL Exported by ...", "binary STL"): the file's name
        const mesh = readSTL(bytes)
        warnings.push(...mesh.warnings)
        solids = [{ name: base, B: () => meshSolid(mesh), fits: true }]
    }
    tell('read', READ)

    const doc = model.createDoc({ title: base })
    doc.unit = 'mm'
    let mat = null
    if (material) { mat = { ...structuredClone(material), id: 'mimport' }; doc.materials.push(mat) }
    const holder = solids.length > 1 ? model.addGroup(doc, 'root', { label: base }) : null
    solids.forEach((s, k) => {
        const share = (1 - READ) / solids.length, at = READ + k * share
        const who = solids.length > 1 ? `part ${k + 1} of ${solids.length} (${s.name})` : s.name
        try {
            tell(`${who}: ${s.fits ? 'fitting surfaces to the mesh' : 'its faces'}`, at, k + 1, solids.length)
            const B = s.B()
            warnings.push(...(B.warnings || []))
            const part = convertSolid(B, { seed, fillets, onProgress: p => tell(`${who}: ${STAGE_WORDS[p.stage]}`, at + share * p.fraction, k + 1, solids.length) })
            const g = addPart(model, doc, holder ? holder.id : 'root', part.ir, { unit: 'mm', label: s.name, material: mat?.id ?? null })
            // the shapes and groups as pasted (addPart makes the formula's unions into folds, and may close one with a box)
            const n = { shapes: 0, groups: 0 }
            const count = x => { if (x.kind === 'object') n.shapes++; else { n.groups++; x.children.forEach(count) } }
            count(g)
            parts.push({ name: s.name, id: g.id, report: { ...part.report, ...n }, ir: part.ir, csg: part.csg, box: B.box })
        } catch (e) {
            refused.push({ name: s.name, why: e.message || String(e) })
        }
    })
    const top = holder ?? (parts.length ? model.find(doc, parts[0].id).node : null)
    if (top && parts.length && place === 'floor') {
        /* on the faces' own box, not the shapes' (ir.box): that one is padded, and the plate stood on it floated 0.15 mm
           over the floor */
        const lo = [0, 1, 2].map(k => Math.min(...parts.map(p => p.box.lo[k]))), hi = [0, 1, 2].map(k => Math.max(...parts.map(p => p.box.hi[k])))
        // a part's group is at the middle of its shapes' box (shapes.js addPart); the holder of several at the origin
        const at = holder ? [0, 0, 0] : [0, 1, 2].map(k => 0.5 * (parts[0].ir.box.lo[k] + parts[0].ir.box.hi[k]))
        const r3 = x => Math.round(x * 1e3) / 1e3
        top.transform.pos = { x: r3(at[0] - 0.5 * (lo[0] + hi[0])), y: r3(at[1] - 0.5 * (lo[1] + hi[1])), z: r3(at[2] - lo[2]) }
    }
    const asset = top && parts.length ? model.extractAsset(doc, top.id) : null
    tell('done', 1)
    return { kind, asset, parts, refused, warnings: [...new Set(warnings)] }
}

/* is it UTF-8? STEP is ISO 8859-1 by its standard and UTF-8 in AP242; only names differ, so a wrong guess costs a
   letter in a label */
function utf8(bytes) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(0, 1 << 20)); return true } catch { return false }
}

export { shapeSDF }
