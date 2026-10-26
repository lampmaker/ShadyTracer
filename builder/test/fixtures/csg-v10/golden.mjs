//======================================================================================================================
// GOLDEN SHADERS -- what codegen made of every document with a CSG group, frozen before the joins moved from
// the group to its children (roadmap/BUILDER.md, phase 1 of the booleans; 2026-09-30).
//
// WHY TEXT FROZEN FROM THE OLD CODEGEN. The v8 upgrade was proven byte-identical by running a new node and an
// upgraded old one through TODAY's codegen (codegen.test) -- which proves the upgrade builds the right document,
// but cannot prove a CODEGEN change left an old file's shader alone: both sides go through the new code. Only
// output captured before the change can. It also keeps the benchmark's rows comparable: bench.test compares
// scene WGSL byte for byte, and the bench's scenes stay at version 10.
//
// WHAT: cases.json (a version 10 document of every CSG case: hard and smooth subtract, intersect, a smooth
// union of three and of one, an export box, a light and a limiter as first child, CSG inside CSG, code on a CSG
// group, a relief under a blend, a p_local material on a CSG child, a disabled first child, a disabled middle
// one, a disabled group, plain groups for contrast), every scenes/*.json and every bench/scenes/*.json. Each
// with live visibility off and on, fingerprinted: sha256 of the render, pick and optics texts, the uniforms, the
// tags. cases.json's render texts are kept whole (cases.*.wgsl), so a failure can show the first line that moved.
//
// FREEZING (`node golden.mjs --freeze`) rewrites expected.json from the codegen of the moment. Run it only for a
// change to the shaders that has been agreed; that is the whole point of the file.
//
// REFROZEN ONCE, FROM MAIN, when main was merged in (2026-09-30): main had changed codegen (a material's relief)
// and five scenes. So the reference was frozen in a worktree of main itself (e533131) with only the one earlier
// change of this branch that alters shader text applied (7ec673c, a light in a CSG group), and the merged branch
// -- version 14, joins per child -- reproduced it byte for byte: the same proof, against main. cases.*.wgsl did
// not move.
//
// REFROZEN FOR ONE SCENE (2026-10-01), for an agreed change (the user: "fix the noise relief modifier too"): a
// relief's distance now folds through scene_api's foldRelief, and the noise relief template reads READ_REACH and
// DIVIDED_ABOVE, so a relief in a smooth blend keeps its fillet. Only scenes/noise.json moved -- its five relief
// groups take the new template and its one material relief folds through foldRelief, the same arithmetic at the
// root; its uniforms and tags did not move. Checked line by line against main's codegen before freezing; the other
// sixteen documents, cases.*.wgsl among them, are as they were.
//
// REFROZEN FOR THE THREE DOCUMENTS WITH LIGHTS (2026-10-01), for the light work the user directed (PLAN.md, Lights:
// L1, L3, L4, L4b, L7), merged with main. A light's case now marks its face (lightTraced), shows its distribution
// (lightBeam, a beam uniform a light), glows for the camera paths its photons cannot connect to (CLS_LIGHTS), shares
// its direct paths with its photons (Ray.ltMis), and hands its material to one weight after the switch, which light
// sampling towards its face is weighed against (lightFace, lightFaceTotal, lightFacePick). Checked line by line
// against main's codegen (178e91b): every line that left was one of the three a light's case had, and every line
// that came is light code; the tags did not move. A scene without a light is emitted exactly as before -- its
// light code comes from the stub (uniforms.schema.js) -- so the fourteen documents without one, cases.json among
// them (its light sits in a CSG group, not drawn), and cases.*.wgsl are as they were.
//
// ONE SCENE ADDED (2026-10-02): main added scenes/demoscene.json (8611305) without a freeze, so codegen.test failed on
// main itself -- "a scene file added or removed is a refreeze". Frozen when main was merged into the branch with the
// Points mode and the slotted live chains: its fingerprint under main's codegen (a worktree of 8611305) and under the
// merged branch's is the same, both modes -- it has no path or profile, which is all the branch's codegen changes --
// and the freeze added its entry and moved no other: the seventeen documents before it, cases.*.wgsl among them, are
// as they were.
//
// ONE MORE SCENE ADDED (2026-10-02): main added scenes/OpticsBench.json (a959b5c) without a freeze, and codegen.test
// failed on main itself the same way. Frozen when main was merged into the branch with the performance review: the
// freeze added its entry, both modes, and moved no other; and a freeze in a worktree of main itself wrote an
// expected.json identical byte for byte -- that branch changes no codegen.
//
// REFROZEN FOR cases.json ALONE (2026-10-03), for an agreed change (the user: a light inside a CSG group is drawn
// and traced at its transforms, as under a plain group). cases.json's light, `ltlamp`, is the first child of the
// CSG group `lt`, so it is now drawn: its "not drawn" comment left (behind its visibility, live), and the light came
// in -- after `lt`'s combine, in `lt`'s frame -- with everything a scene with a light carries (its material id, its
// face's case in getMaterial2 and the weight after it, lightBeam, LIGHT_FACES and the four light-face functions).
// Every line that came is light code, and no line of any combine moved (cases.*.wgsl, line by line). The other
// eighteen documents -- every scene and bench scene -- have no light under a CSG group and did not move.
//
// A DOCUMENT ADDED (2026-10-04): the user's scenes/OpticsBench2.json, committed to the repository. Frozen with the
// rest; the old expected.json and the new one compared key by key: fourteen keys added, all OpticsBench2's (its
// render, pick and optics texts, uniforms, tags and roles, off and live), none changed and none removed.
//
// TWO DOCUMENTS ADDED (2026-10-03, 0.10.1): bench/scenes/OpticsBench.json and OpticsBench2.json, the scaling
// benchmark's frozen copies (bench/scaling.js). Frozen with the rest: forty lines added, none removed, and each
// copy's fingerprints the same as its original's in scenes/ -- the same document, the same shaders.
//
// REFROZEN FOR SIX DOCUMENTS (2026-10-05, 0.22.0), for the user's step 4 (roadmap/ARCHITECTURE.md: copies compile once),
// which needs codegen's local point under group code to be the scene-as-data's (codegen.js, the children functions). In
// a scene whose materials read p_local, a before group's children function now sets XF_P to the point its code hands
// them, and an after group's counts its Hit as private (XF_SUB). Checked line by line against the codegen of acbb3cc
// (0.21.7, a worktree of it): in every moved text only those lines came -- the optics benches' and OpticsBench2's
// shells and the bench Noise library's six relief groups `XF_SUB += 1u;` / `XF_SUB -= 1u;`, the demo's one before group
// the XF_P pair -- none left, and no uniform or tag moved. scenes/OpticsBench.json, scenes/OpticsBench2.json,
// scenes/demoscene.json and their bench copies, and bench/scenes/noise.json moved; the other documents, cases.*.wgsl
// among them, did not.
//
// REFROZEN FOR EVERY DOCUMENT (2026-10-07, 0.34.0), for an agreed change (the user: "yes, make dear-only the default and
// remove the setting"): the builder makes its scenes with a box test only on the nodes dearer than their box (codegen.js,
// ONLY THE DEAR ONES), no longer on every top-level node. Checked before freezing: with every box (`cull: 'all'`, the
// bench's) all 44 fingerprints were the ones frozen, byte for byte; with the default, the only lines that left any text
// were the box tests of the plain shapes (`{ // id: skipped...`, `let bd_`, its `if`, two closing braces -- re-indented
// whatever was inside) and, where no node kept a box, CULL's; no line came; the only uniforms that left were those
// nodes' bxlo_/bxhi_, and none came; the pick texts, tags and roles did not move. An optics text moved only where it
// is the render text itself (no limiter: codegen.js `optics`), and was that text exactly. Every document moved:
// each has at least one plain shape at its top level.
//
// ONE SCENE ADDED (2026-10-09, 0.40.1): the user's scenes/Prism.json (6f1ba56, a dispersive prism lit by a slit light),
// committed without a freeze. The freeze added its entry, both modes, and moved no other: the 22 documents before it,
// cases.*.wgsl among them, are as they were (compared key by key against the expected.json before).
//
// THE EXAMPLES REPLACED (2026-10-10, 0.54.0): the scenes that were File › Examples moved to test/fixtures/scenes/ and
// their entries were renamed to match, their fingerprints left as they were -- the same files, so the same shaders,
// which this test then confirmed. The new examples in scenes/ were added by a freeze that moved no other entry.
//
// REFROZEN FOR EVERY DOCUMENT WITH A SUBTRACT OR INTERSECT JOIN (2026-10-11, 0.57.2), for an agreed change (the user:
// the die's pips took the die's material; "change it for intersect as well"): each child after the base now picks the
// group's material by its own join's test (codegen.js MAT_WINS), not only a union. Checked before freezing: the only
// lines that came were `km_<g> = select(km_<g>, C.m, -C.s.w > k_<g>.w);` before each csgSubtract and `..., C.s.w >
// k_<g>.w);` before each csgIntersect, and no line left (cases.*.wgsl diffed); the 13 documents with such a join moved
// and the other 33 did not.
//
// A DOCUMENT ADDED (2026-10-16, 0.61.2): bench/scenes/dichroics.json, the dichroics bench's frozen scene (bench/dichroics.js).
// No codegen change: the freeze added its entry and moved no other document's (expected.json's diff is that entry alone).
//
// A DOCUMENT ADDED (2026-10-16, 0.62.0): scenes/dusty-beam.json, the haze box's example (scenes/make.mjs). Codegen learnt
// the haze box (a comment and its transform's uniform, as an export box; the scene's `haze` beside the text), and the
// freeze added that entry and moved no other document's -- every one before it emits what it did.
//
// REFROZEN FOR ONE SCENE (2026-10-17, 0.65.0), for an agreed change (the user: "the checker material, use a smoothstep
// and sin function instead"): the library's checker is a wave with a softness and a level, and scenes/depth-of-field.json
// carries it (scenes/make.mjs). No codegen change. Checked before freezing, its texts old against new, both modes: the
// only lines that left were the old checker's four, the only lines that came were the new checker's and the aliases of
// its two new parameters (`let softness = UB.softness_m1;`, `let level = UB.level_m1;`), and its uniforms gained exactly
// those two. The freeze changed that scene's entries alone, key by key; the other 47 documents did not move.
//
// REFROZEN FOR TWO SCENES (2026-10-20, 0.71.1), for a fix the user asked for (a hard line round a stucco sphere cut from
// a plaster box, both with reliefs, gone when both wore the same one): a CSG chain's outermost group with no code at or
// above it divides by XF_RL only outside a normal's look (scene_api.js NORMAL_LOOK). Checked before freezing, old
// codegen (a worktree of d4f45de) against new, both modes, all four texts: in each exactly one line moved, `C = fold(C,
// VEC4(k_n4.xyz, k_n4.w / XF_RL), km_n4);` to `... / select(XF_RL, 1.0, NORMAL_LOOK)), km_n4);`, and nothing else;
// uniforms and tags did not move. scenes/lighting-room.json and scenes/office-lighting.json moved, the render, pick and
// optics texts of each, off and live; the other 46 documents, cases.*.wgsl among them (its relief under a blend is the
// version 10 modifier's code, which names no XF_RL), did not.
//
// TWO DOCUMENTS ADDED (2026-10-21, 0.73.0): scenes/imported-parts.json, the STEP and STL import's example (scenes/make.mjs,
// made by import/), and bench/scenes/imported.json, its frozen copy for Tests > imported (bench/imported.js). No codegen
// change: the freeze added their two entries and moved no other document's (compared key by key before and after).
// Frozen again the same day for the import's second round (the user's Onshape part): the example remade, with the cup
// added, rounded prisms, cut shapes reaching past the part, every group one fold codegen combines (no plain union as a
// shape of an intersection) and every part standing on the floor. Those two documents' entries moved, every key of both
// modes; no other document's did (key by key).
//
// REFROZEN FOR FOUR DOCUMENTS (2026-10-21, 0.76.0), for a fix the user agreed (a plain group that is one of a CSG group's
// shapes combines its children as a union, an array's copies too: codegen.js combinedGroups). Folded, its children were
// no union's signed distance, and the CSG group above read a wrong operand where they overlap (csgshape.gpu.mjs). Checked
// before freezing, dev's codegen (bbe475c's codegen.js and scenedata.js) against new, both modes, all four texts: with
// whitespace ignored no line left any text; the lines that came are each such group's combine and nothing else -- `var
// k_<g>`, `var km_<g>` (and `var first_<g>`, live), each child's `var C = emptyHit(r);` with its XF_SUB pair, the base's
// `k_<g> = C.s; km_<g> = C.m;` (live, behind first_<g>) and each union's `km_<g> = select(...)` and `k_<g> = csgUnion(k_<g>,
// C.s, UB.blend_<g>);`, and `C = fold(C, k_<g>, km_<g>);` -- the children's own lines re-indented into their blocks off,
// not at all live. The uniforms gained exactly those groups' blend_<g>, at 0; the tags and roles did not move.
// test/fixtures/scenes/OpticsBench.json (the pillars' cylinder and shell, four groups) and OpticsBench2.json (those, and
// the laser rig under its lens holder: six live, three off, the others hidden and pruned) moved, and their bench copies
// exactly as they did; the other 46 documents, cases.*.wgsl and the imported parts among them, did not (key by key).
//
// ONE SCENE REFROZEN (2026-10-21, 0.77.0): scenes/modifiers.json, the Modifiers example, with the circular array the user
// asked for (modifiers.js `circular`) added in a front row (scenes/make.mjs). No codegen change. Checked before freezing,
// its texts old against new, both modes, each line trimmed and counted: in the render and optics texts no line left and
// the lines that came are the two rings' -- their groups, children functions, uniforms and box tests; in the pick texts
// the only lines that left were eleven `XF_TAG = <n>u` with their numbers moved (the rings' children functions, emitted
// before SDF, take tags first). Uniforms: none left; the rings' count, reach, transforms and boxes and their children's
// came. Every key of both modes of that document moved; no other document's did (key by key).
//
// REFROZEN FOR ONE SCENE (2026-10-21, 0.77.0), for a feature the user asked for (a pattern frame per object: model.js
// setPattern, codegen patIn): scenes/lighting-room.json's table top and floor have one, their wood's grain along x. Checked
// before freezing, merged with dev at 8e1137f, the scene with its pattern frames against the same document without them,
// both modes, all four texts: each one's comment gained ", in its pattern frame", and its block the capture's five lines
// after its enter and the one that puts them back before its leave -- nothing else; the uniforms gained pat_n2 and
// pat_n11 alone; the tags did not move. Against dev's expected.json (8e1137f) the other documents did not move (key by key), and
// no document without a pattern frame can: the lines are emitted only for one.
//
// A DOCUMENT ADDED (2026-10-22, 0.78.0): scenes/dichroics.json, the user's Dichroics scene made an example as they saved it
// (scenes/make.mjs lists it, `made: false`). No codegen change: the freeze added its entry and moved no other document's
// (key by key, against the expected.json before).
//
// THE SAME DOCUMENT REFROZEN (2026-10-23, 0.79.0): the user saved scenes/dichroics.json again (f002d0b, "updated dichroics
// example") and dev's codegen.test failed on its two entries. The document moved, not codegen: f002d0b changed that file
// alone, and the freeze moved both modes of its entry and no other document's (key by key, against the expected.json
// before). The user asked for the refreeze.
//
// REFROZEN FOR EVERY DOCUMENT WITH A LIGHT (2026-10-23, 0.79.0), for a fix the user asked for (light sampling off read a
// small face brighter than on: codegen.js ONLY ON THE FACE ITSELF, builder/test/lightface.gpu.mjs). Each light's
// `let MATERIAL = select(<back>, matid_<id>, p.z >= 0.0);` (two-sided: `let MATERIAL = matid_<id>;`) gained the face's
// own extent -- `&& all(abs(p.xy) <= VEC2(width, height) * 0.5)` for a rectangle, `&& dot(p.xy, p.xy) <= radius * radius`
// for a disc -- so the rim past its edge takes the back's material. Checked before freezing, every document in both modes
// against a worktree of the code before (89a8731): 200 texts (render, pick and the optics trace's two) moved, by 340 lines,
// every one a light's MATERIAL line as above; no line count, uniform or tag moved. cases.*.wgsl moved by that line alone.
//
// REFROZEN FOR ONE SCENE (2026-10-23, 0.79.0), for a feature the user chose ("faster large arrays", after Tests >
// lightarray measured 256 copies of a light at 465 ms of march a sample): a row's or a ring's copies evaluated in a
// window around the point (builder/arrays.js). Checked before freezing: generated with arrayWindow false, every one of the
// 51 documents' fingerprints was the one frozen, both modes; with the window, only scenes/parametric-part.json moved (its
// heatsink's fins are a row of 9 copies) -- the one line that left its text was its copies loop's head, every line that
// came the window's (the arrWindow functions, the window's uniforms' reads, the loop over the window), and its uniforms
// gained exactly its content box's two (bxlo_n9_cbx, bxhi_n9_cbx). Its pick texts and tags did not move: the window is
// the render copy's alone.
//
// BOTH, MERGED (2026-10-24): dev's refreeze for the light's face above came into this branch's window; expected.json was
// taken as git merged the two and frozen again. Checked before freezing: generated with arrayWindow false, every document's
// fingerprints were dev's frozen ones, both modes; with the window, scenes/parametric-part.json alone moved from dev's, by
// the window's lines as above.
//
// THE WINDOW'S COPY WORKED OUT (2026-10-25): the first window made the bench's ring slower on the user's Pascal card, with
// about as many steps (arraywindow.gpu.mjs counts them), so a window's copy is now worked out from copy 0 by the pattern
// (arrays.js arrCopy) where a switch picked it. codegen.test failed scenes/parametric-part.json alone, both modes, before
// this freeze: its fins' loop the one windowed array among the documents.
//
// A NODE IN AN ARRAY MEASURED AS ONE COPY (2026-10-25): the pick copies keep which copy is walked (scene_api.js
// XF_COPY, codegen's copies loop and the data walk's ARRAY records), and the window's bounds follow its content's box
// (arrays.js arrWindowOf). codegen.test failed scenes/parametric-part.json alone before this freeze, both modes -- its
// wgsl and opticsWgsl by the window's functions, its pickWgsl and opticsPickWgsl by the copy number -- the one document
// with an array.
//======================================================================================================================
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import * as M from '../../../model.js'
import { generate } from '../../../codegen.js'

const here = new URL('./', import.meta.url)
const raytracer = new URL('../../../../', import.meta.url)

/** Every document the golden holds, by a name that says where it is: [name, text]. */
export function documents() {
    const dir = (rel, filter = f => f.endsWith('.json')) => readdirSync(fileURLToPath(new URL(rel, raytracer))).filter(filter).sort()
        .map(f => [`${rel}${f}`, readFileSync(new URL(`${rel}${f}`, raytracer), 'utf8')])
    return [['cases.json', readFileSync(new URL('cases.json', here), 'utf8')], ...dir('scenes/'), ...dir('test/fixtures/scenes/'), ...dir('bench/scenes/')]
}

const sha = s => createHash('sha256').update(String(s)).digest('hex')
const sorted = o => JSON.stringify(Object.keys(o || {}).sort().map(k => [k, o[k]]))

/** A document's scene as the builder makes it (model generateArgs, as demo.js and the bench call it), with live
 *  visibility off or on. */
export function sceneOf(text, live) {
    const doc = M.parse(text)
    doc.liveVisibility = live
    return generate(...M.generateArgs(doc, { id: 'golden', title: 'golden' }))
}

/** What is compared: every text and table the renderer is handed. */
export function fingerprint(scene) {
    return {
        wgsl: sha(scene.wgsl), pickWgsl: sha(scene.pickWgsl), opticsWgsl: sha(scene.opticsWgsl), opticsPickWgsl: sha(scene.opticsPickWgsl),
        uniforms: sha(sorted(scene.uniforms)), tags: sha(JSON.stringify([scene.tags, scene.opticsTags])),
        roles: sha(JSON.stringify([scene.detectors, scene.passes])),
    }
}

export const MODES = { off: false, live: true }
export const expected = () => JSON.parse(readFileSync(new URL('expected.json', here), 'utf8'))
export const casesText = mode => readFileSync(new URL(`cases.${mode}.wgsl`, here), 'utf8')

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--freeze')) {
    const out = {}
    for (const [name, text] of documents()) {
        out[name] = {}
        for (const [mode, live] of Object.entries(MODES)) {
            const scene = sceneOf(text, live)
            out[name][mode] = fingerprint(scene)
            if (name === 'cases.json') writeFileSync(new URL(`cases.${mode}.wgsl`, here), scene.wgsl)
        }
    }
    writeFileSync(new URL('expected.json', here), JSON.stringify(out, null, 1) + '\n')
    console.log(`froze ${Object.keys(out).length} documents`)
}
