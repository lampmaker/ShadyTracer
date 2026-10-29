//======================================================================================================================
// MODEL -- the scene builder's document: what the tree shows, what is saved, what codegen reads.
//
// PURE ON PURPOSE, like emit.js: plain objects, no DOM, no device. Every operation the tree
// will offer (add, delete, move, duplicate, rename, enable) is a function here with a test in
// test/model.test.mjs, so the interface can only ever be a way of calling them. The last
// builder put its operations in the tree widget's callbacks, where nothing could test them --
// which is how "add a scene" came to wrap its data twice and drop the folders it was meant to
// create.
//
// THREE DECISIONS THE OLD BUILDER GOT WRONG, made here once:
//
//   IDENTITY IS AN ID, NEVER A PATH OR A LABEL. The old tree addressed nodes by index path
//   ("0.1.2"), so after a delete its selection pointed at whichever node had moved into the
//   gap. And objects named their material by its display label, so renaming a material
//   silently rebound every object using it. Here every node and material has an id that is
//   fixed for its lifetime; the label is only something to show.
//
//   IDS ARE WGSL-SAFE AND HAVE NO UNDERSCORE. A parameter `p` of node `id` becomes the uniform
//   `p_id` (codegen.uniformName). Parameter names may contain underscores; ids may not, so the
//   id is always what follows the LAST underscore and two nodes can never mint the same uniform
//   name -- `a_b` of node `c` and `a` of node `b_c` would otherwise both be `a_b_c`.
//
//   A SAVED FILE IS CHECKED ON THE WAY IN. parse() validates everything and reports every
//   problem at once, rather than loading half a document and failing later at a line of WGSL.
//   The old loader rebuilt nodes field by field, regenerated their ids, and quietly dropped
//   what it did not know about.
//
// MATERIALS ARE A LIST ON THE DOCUMENT, objects refer to one by id. A material is the fields of
// Material2 as parameters plus an optional WGSL block -- see materials.js for what that costs
// and why the palette of scenes/common.js it replaced is gone.
//======================================================================================================================

import { FIELDS, defaults as materialDefaults, PALETTE_V3, PRESETS, MATERIAL_CODE_TEMPLATE, RELIEFS, RELIEF_SCOPE, reliefMaterialId, reliefOwner } from './materials.js'
import { NODE_TYPES, GROUP_SCOPE, isCsg, hasCode, isAfter } from './codegen.js'
import { PRIMITIVES, primitiveObject } from './primitives.js'
import { MODIFIERS, modifierGroup } from './modifiers.js'

export const FORMAT = 'raytracer-scene'
/* 2: every group and object has a transform, and groups have a CSG op and a blend. Version 1
   files -- saved before either existed -- are upgraded on load by filling in the identity and
   a plain union, which is exactly what they meant. */
/* 3: a sphere is a radius and nothing else -- its old `centre` parameter duplicated the
   transform's position. Version 2 files move a sphere's centre into its transform on load. */
/* 4: a material is parameters and optional code, not a palette name. Version 3 files turn each
   palette entry into the same material as data (materials.js PALETTE_V3). */
/* 5: a group may carry code and parameters of its own (codegen, "A group's code"). Nothing in a
   version 4 file changes; the number moves so a builder that does not know group code refuses
   a file that has some, rather than loading it without and saving the loss. */
/* 6: a scene has a UNIT -- 'm', 'cm' or 'mm' -- and its numbers are in it: radius 1 in a mm scene
   is a millimetre. And light is physical: a material's emission is a hue and a luminance in cd/m^2
   (emissiveLuminance) instead of a colour times a unitless strength. Version 5 files become metre
   scenes, and their lights keep their brightness RELATIVE TO THE SKY they were made under -- see
   v5to6 for the factor and why it is that one. */
/* 7: clearcoat and clearcoatRoughness are gone from a material's fields -- declared in Material2,
   set by the scenes, read by nothing in the shader. Version 6 files drop them on load, rather
   than carry them on as parameters of the material's own that its code never uses. */
/* 8: `model` goes the same way. It chose between shading models once; since the material review
   every material takes the one layered model and nothing reads the field, so the panel offered a
   slider that did nothing. Version 7 files drop it on load. */
/* 9: there is one kind of object, a code node. A sphere, a box and the rest are code nodes that
   START as one of primitives.js's, and their code is the user's to change. Version 8 files turn
   each primitive node into the code its type emitted -- see v8to9. */
/* 10: OPTICS AND LIGHT. A material has a TYPE (absent = surface): `emitter`, a glowing surface -- what
   an emissive material always was, now said -- `detector`, a surface the optics trace stops on and
   records, `limiter`, a detector the picture does not show. A LIGHT is an object of its own type
   (lights.js): a rectangle, a disc or a Zemax ray file, known exactly, so the optics trace can start
   from it and the picture can light-trace it. And a scene may say how far the optics trace reaches
   (`optics: { maxDist }`). Version 9 files: a material that emits becomes an emitter (v9to10).
   FILES FROM A PARALLEL LINE OF THIS FORMAT, saved as versions 9 to 13 while the optics work was on
   a branch of its own, carried node types and lights of their own; they are told apart by what
   they hold (fromBranch) and converted (branchToV10). */
/* 14: A JOIN PER CHILD. How a group combines its children is said by each child, not by the group:
   `join` -- union, subtract or intersect, absent = union -- is how a child meets what is above it in
   its group, read top to bottom, the first child the base; `joinBlend` its own smoothness, absent =
   the group's `blend`, which stays as the default for all of them. So "a, b and c, less d" is one
   group rather than a subtraction holding a union (the user, 2026-09-30). The group's `op` is gone:
   version 10 files give its op to every child after the first (upgradeJoins) and compile to exactly
   the shader they did (test/fixtures/csg-v10). 11 to 13 are skipped: the optics branch used them, and
   from here on a file's number alone says whose it is. */
/* 15: THE SCENE'S RADIUS IS ITS OWN PROPERTY. `envRadius`, in the scene's unit, optional (absent = the
   renderer's 400 m whatever the unit): where the scene stops and the environment begins. It was a
   renderer setting in metres, kept in `environment` with the sun and sky; the user wanted it among the
   scene's own properties (the Scene folder: unit, radius), and a new scene starts at 25 cm in a cm scene.
   Version 14 files move a radius they set out of the environment (v14to15) -- or drop it when it is the
   400 m default, which every environment holds that was copied whole from the renderer on its first edit. */
/* 16: BLOCKS (PERFORMANCE.md P3, the user's design: "a scene contains both scene geometry and building blocks ... a
   scene geometry element does not contain or generate code anymore"). The scene keeps a list of BLOCKS -- code and
   its parameters' schema: their names, kinds and defaults, which are compile-time constants, their ranges, which are
   lengths -- and an object or a group with code names one (`block`) and holds only its values. Editing a block's code
   or schema changes every node that uses it (agreed: a variant is the block duplicated, splitBlock); a BUILT-IN block
   (a primitive's or a modifier's, `builtin: 'sphere@1'`) is read-only, so an edit through a node first gives that node
   a copy of its own (ownBlock) -- editing a preset sphere changes that sphere, as it always did. A constant's VALUE is
   still each node's: two values are two functions compiled, which the scene as data does anyway (scenedata.js).
   Version 15 files: each distinct code with its schema becomes a block (v15to16), the nodes with it its users, and
   every scene compiles to the shader it did (codegen.test's frozen shaders). */
/* 17: ARRAYS (PERFORMANCE.md P3, call 4; the user: "a group of components placed at positions defined by an array"). A
   plain group may hold `copies`: up to ARRAY_MAX transforms, in its own frame, and its children are drawn once at each
   -- one copy of their code in the shader however many places, and in the scene as data, one set of records walked
   once a copy. Version 16 files have none: nothing to change. A builder of 16 refuses a file of 17, rather than draw
   one copy where there are many and save that. */
/* 18: COMPONENT PARAMETERS (PERFORMANCE.md P3; builder/bind.js). A node may hold `bind`: { target: expression }, each
   one of its values -- a parameter or a component of one, its transform's, a group's blend, its own join blend, a plain
   group's copies as a row -- as an expression of the parameters of the groups above it (and a group's own, for all
   but its parameters). Resolved on the CPU and written into the values, so everything that reads a value reads a
   number as before. Version 17 files have none: nothing to change. A builder of 17 refuses a file of 18, rather than
   lose the bindings on its first save. An array may now be a group with parameters (a block with no code): an LED
   strip's count is its own. */
/* 19: ABSORPTION INSIDE A MATERIAL (0.37.0; materials.js attenuationDistance, the panel's "colour depth"). Every
   material has the field; version 18 files get it at 0, which is what they did: the colour tints a crossing, and
   nothing is absorbed with depth (v18to19). A builder of 18 refuses a file of 19, which would otherwise read the field
   as a parameter of the material's own and render the glass without it. An ASSET (a library item, the clipboard)
   carries no version: one from before has its missing fields filled in as it goes in (withFieldDefaults). */
/* 20: A COATING ON A MATERIAL (0.39.0; materials.js coating and coat*, core/spectral.js): a dichroic, a beam splitter,
   an anti-reflective layer, replacing the surface's Fresnel. Every material has the six fields; version 19 files get
   them with coating 0, none, which is what they rendered (v19to20). A builder of 19 refuses a file of 20, which would
   otherwise read the fields as parameters of the material's own and render the coated glass bare. */
/* 21: DISPERSION (0.40.0; materials.js abbe, core/spectral.js): a material's Abbe number. Every material has the field;
   version 20 files get it at 0, one index at every wavelength, which is what they rendered (v20to21). A builder of 20
   refuses a file of 21 rather than render the prism without its rainbow. */
/* 22: A HAZE BOX (0.62.0; hazebox.js, lib/pathtracer/core/haze.js): an object of type 'haze', dust in the air inside
   it -- a size, and `haze` over HAZE_DEFAULTS (mean free path, albedo, g). One a scene. Version 21 files have none:
   nothing to change. A builder of 21 refuses a file of 22 (an object type it does not know), rather than drop the box
   on its first save. */
/* 23: A GROUP'S MATERIAL (0.76.0; the user, 2026-10-21: "often shapes are all made of the same material. Dragging a
   material onto a child only changes that child. A similar approach to the blend could be used where certain children
   can still override the parent's material"). A group (not the root) may hold `material`: every object below it wears
   that one instead of its own -- the nearest such group winning, as a nested group's blend is its own -- unless the
   object holds `ownMaterial: true`, as a child with its own join blend keeps it (wornMaterial). The object's own
   `material` is kept under the group's, so taking the group's away gives each back what it had. Resolved in toTree:
   codegen, the scene as data and the bake see each object's worn material and nothing else, so a scene without a
   group material compiles to the text it did. Version 22 files have none: nothing to change. A builder of 22 refuses
   a file of 23, rather than show every object in its own material and save the scene without the group's. */
/* 24: A PATTERN FRAME (0.77.0; codegen.js THE PATTERN FRAME): an object, or a group that makes its children one shape (a
   CSG group, a round, a shell: patternOwner), may hold `pattern` -- { pos, rot }, a place and a turn in its own frame, as
   a child's transform would be, without a scale -- where its material's
   pattern is laid out: a material's p_local and R_local (wood's rings, brushed metal's strokes, a checker's squares)
   and its relief are read in that frame instead of the object's own. The user, 2026-10-21: the grain of a table's top
   and of its legs, one wood, ran the same way in each, so the top showed end grain. Version 23 files have none:
   nothing to change. A builder of 23 refuses a file of 24 rather than lose every pattern turned on its first save. */
/* 25: TRANSLUCENCY AND A DIFFUSER FILM ON A MATERIAL (0.next; roadmap/DIFFUSERS.md, materials_pbr.js THE SIDE BEYOND):
   `translucency`, the share of the diffuse base that passes through the surface, Lambertian (an opal sheet), and
   `spreadX` / `spreadY`, a transmission spread about the straight-through direction by that FWHM in degrees (a diffuser
   film). Every material has the fields; version 24 files get them at 0, which is what they rendered: an opaque base,
   glass that refracts (v24to25). A builder of 24 refuses a file of 25 rather than read the fields as parameters of the
   material's own and render the diffuser opaque. */
export const VERSION = 25
/** The most copies an array has: each is a walk of its children at every step near them, until a BVH can tell which
 *  copies are near (call 4: chosen, not measured). */
export const ARRAY_MAX = 16

/** What a material can be (version 10). 'surface' is stored as no field at all. */
export const MATERIAL_TYPES = ['surface', 'emitter', 'detector', 'limiter']
/** The type of a material, with the default filled in. */
export const typeOf = m => m?.type ?? 'surface'
export { LIGHT_SHAPES, LIGHT_DEFAULTS, lightOf, hasFace, lightRGB, lightDisplayRGB, lightChromaticity } from './lights.js'
import { LIGHT_SHAPES, LIGHT_DEFAULTS, lightOf, lightProblems, rotationTowards } from './lights.js'
export { EXPORT_PARAMS, EXPORT_DEFAULTS, exportOf } from './exportbox.js'
import { EXPORT_PARAMS, EXPORT_DEFAULTS, exportProblems } from './exportbox.js'
export { HAZE_PARAMS, HAZE_DEFAULTS, hazeSettings } from './hazebox.js'
import { HAZE_PARAMS, HAZE_DEFAULTS, hazeProblems, hazeNode } from './hazebox.js'
/** The object types that are boxes rather than shapes (an export box, a haze box): no material, no code, no join -- a
 *  size in their own frame and settings of their own. */
export const BOX_TYPES = Object.freeze(['export', 'haze'])
const isBoxType = t => BOX_TYPES.includes(t)
const BOX_WORDS = { export: 'export box', haze: 'haze box' }

/** The units a scene may be in -- the renderer's own table, so the two cannot disagree. */
export { UNITS, ENV_RADIUS_DEFAULT_M } from '../lib/pathtracer/core/photometry.js'
import { UniformGroups } from '../lib/pathtracer/core/uniforms.schema.js'
import { UNITS, Y, ENV_RADIUS_DEFAULT_M } from '../lib/pathtracer/core/photometry.js'
import { profilePieces, pathPieces } from '../lib/pathtracer/core/shapes.js'
import { resolvePath, resolveProfile, pathNames, pathUses, pointNames, pointUses, renameIn, parseExpr, namesOf, LIVE_PATH_MAX, LIVE_PROFILE_MAX } from './expr.js'
import { helpersOf, helpersFor, sameHelper } from './helpers.js'
import { targetsOf, lookupIn, parseBindings, bindingsText as bindText, applyBindings, bindingsProblems, boundOf, isParamTarget, liveKeyOf, TRANSFORM_TARGETS, COPIES_TARGETS } from './bind.js'

/** How a child joins what is above it in its group (`join`, version 14; a group's `op` before). A
 *  group whose children all join by union with no blend folds each into the scene separately, which
 *  is what every group did before there were others. Any other join, or any blend, and the group
 *  combines its children into ONE shape first, top to bottom from the first (the base), which takes
 *  the material of whichever shape makes the surface there: a union's nearer, an intersection's
 *  farther, a subtraction's cutter where it carves (codegen isCsg, children(), MAT_WINS). The base's
 *  own join is kept but dormant, as is a join at the top level, which is always a plain union. */
export const OPS = ['union', 'subtract', 'intersect']

export { identity, matrixOf } from './transform.js'
import { identity, matrixOf } from './transform.js'
import { INTERPS, EASES } from '../lib/timeline/timeline.js'

/** Parameter names that would collide with what codegen declares for every node:
 *  `xf_<id>` (the transform), `blend_<id>` (a group's blend), `bxlo_<id>` / `bxhi_<id>` (a top-level
 *  node's bounding box, for culling), `vis_<id>` (its visibility under liveVisibility -- missing here
 *  until 2026-09-30, when a parameter `vis` would have been declared over it), `jblend_<id>` (its
 *  own join blend, version 14), and `pat_<id>` (its pattern frame, version 24). */
export const RESERVED_PARAMS = ['xf', 'blend', 'bxlo', 'bxhi', 'vis', 'jblend', 'pat']

/** Ids codegen uses for things that are not nodes -- the functions block maps its lines to
 *  'functions' -- so no node or material may take them. */
export const RESERVED_IDS = ['root', 'functions']

/** The WGSL types a compile-time parameter may have. A constant is a scalar: it exists to be a
 *  loop bound or a switch the compiler folds, and those are scalars. */
export const CONSTANT_TYPES = ['u32', 'i32', 'f32']

/** What a new document's functions block starts as: comments only, which compile to nothing. */
export const FUNCTIONS_TEMPLATE = [
    '// Functions: WGSL helpers any code node or material in this scene can call.',
    '// Compiled once, before the materials and the SDF; errors show here at their own lines.',
    '// e.g. a gyroid, usable in a code node as  C = add_new(C, sd(gyroid(p, 4.0)), MATERIAL);',
    '//   fn gyroid(p: VEC3, s: f32) -> f32 {',
    '//       let q = p * s;',
    '//       return abs(dot(sin(q), cos(q.zxy))) / s - 0.03;',
    '//   }',
    '// what is already there to call: Help > Reference > Functions for code',
    '',
].join('\n')

export { NODE_TYPES as OBJECT_TYPES, GROUP_CODE_TEMPLATE } from './codegen.js'
export { PRIMITIVES } from './primitives.js'
export { FIELDS as MATERIAL_FIELDS, PRESETS as MATERIAL_PRESETS, MATERIAL_CODE_TEMPLATE, FIELDS_OF as MATERIAL_FIELDS_OF, FIELD_LABELS as MATERIAL_FIELD_LABELS,
         COAT_FIELDS, COAT_PRESETS, hasCoating,
         RELIEFS, reliefOwner, reliefMaterialId, reliefPresetOf } from './materials.js'

const ID = /^[A-Za-z][A-Za-z0-9]*$/            // no underscore -- see the header
const PARAM = /^[A-Za-z][A-Za-z0-9_]*$/

export class ModelError extends Error {
    constructor(problems) {
        const list = [].concat(problems)
        super(list.length === 1 ? list[0] : `${list.length} problems:\n  ` + list.join('\n  '))
        this.problems = list
    }
}

//----------------------------------------------------------------------------------------------
// Creating and finding
//----------------------------------------------------------------------------------------------

export function createDoc({ title = 'Untitled scene' } = {}) {
    return {
        format: FORMAT, version: VERSION, title, nextId: 1, unit: 'm',
        materials: [],
        blocks: [],
        // the root is a union with no transform of its own: it IS the world frame
        root: { id: 'root', kind: 'group', label: title, enabled: true, blend: 0, children: [] },
        functions: FUNCTIONS_TEMPLATE,
    }
}

/** A fresh id, never one in use. The counter is saved with the document so ids stay unique
 *  across save and load, and a deleted node's id is not handed to the next one. */
export function newId(doc, prefix = 'n') {
    const used = allIds(doc)
    let id
    do { id = `${prefix}${doc.nextId++}` } while (used.has(id))
    return id
}

const allIds = doc => {
    const s = new Set(doc.materials.map(m => m.id))
    for (const b of doc.blocks || []) s.add(b?.id)
    walk(doc, n => s.add(n.id))
    return s
}

/** Pre-order over every node, root first. fn(node, parent, depth) */
export function walk(doc, fn) {
    const go = (node, parent, depth) => {
        fn(node, parent, depth)
        if (node.kind === 'group') for (const c of node.children) go(c, node, depth + 1)
    }
    go(doc.root, null, 0)
}

/** { node, parent, index } or null. The root has parent null and index -1. */
export function find(doc, id) {
    if (doc.root.id === id) return { node: doc.root, parent: null, index: -1 }
    let out = null
    walk(doc, n => {
        if (out || n.kind !== 'group') return
        const i = n.children.findIndex(c => c.id === id)
        if (i >= 0) out = { node: n.children[i], parent: n, index: i }
    })
    return out
}

const must = (doc, id) => {
    const f = find(doc, id)
    if (!f) throw new ModelError(`no node '${id}'`)
    return f
}
const groupOf = (doc, id) => {
    const { node } = must(doc, id)
    if (node.kind !== 'group') throw new ModelError(`'${id}' is not a group; only groups have children`)
    return node
}
const insert = (list, item, index) =>
    list.splice(index == null ? list.length : Math.max(0, Math.min(index, list.length)), 0, item)

export const material = (doc, id) => doc.materials.find(m => m.id === id) || null

//----------------------------------------------------------------------------------------------
// Blocks (version 16) -- code and its parameters' schema, which nodes use
//----------------------------------------------------------------------------------------------
/* A BLOCK: { id, label, kind, code, params, constants?, ranges?, lengths?, builtin? }
     kind      'object' -- code that folds a shape into C (C = add_new(C, ..., MATERIAL)) -- or 'group': code around
               a group's children (C = children(C, p)). The contracts every node had until now; the scene as data
               (scenedata.js) compiles an object's block once for every node that uses it.
     params    the parameters, in order, each with its DEFAULT -- what a node that starts to use the block gets, and
               the kind of value it holds (a number, a vector, a colour, a profile or a path). A node's own `params`
               has the same names, in any order, with its values.
     constants which of them are compile-time, and as what type; ranges, lengths: the panel's sliders and units.
     builtin   'sphere@1': the primitive (primitives.js) or modifier (modifiers.js) it is, at that version -- read-only.
               The code is in the file all the same: a file is complete, and keeps the shader it had when a built-in
               changes (the version moves then, and an old file's block no longer matches it).
   Ids are in the scene's one id space (newId 'b'), so an error can name a block as it names a node. */
export const BLOCK_KINDS = ['object', 'group']
export const BUILTIN_VERSION = 1
/** The block with id `id`, or null. */
export const block = (doc, id) => (doc?.blocks || []).find(b => b.id === id) || null
/** The block a node uses, or null (a light, an export box, a group without code). */
export const blockOf = (doc, node) => node?.block != null ? block(doc, node.block) : null
/** A node's code: its block's ('' for none). */
export const codeOf = (doc, node) => blockOf(doc, node)?.code ?? ''
/** Whether a group of the document has code (codegen hasCode, on its block's: comments alone are none). */
export const groupHasCode = (doc, node) => hasCode({ kind: node?.kind, code: codeOf(doc, node) })
/** The nodes that use block `id`, in tree order. */
export function usersOf(doc, id) {
    const out = []
    walk(doc, n => { if (n.block === id) out.push(n) })
    return out
}
/* WHAT MAKES TWO BLOCKS THE SAME: kind, code, the parameters' names and kinds in order, and the schema around them --
   never the default values, which are only where a new user starts */
const SCHEMA = ['constants', 'ranges', 'lengths']
const blockSig = b => JSON.stringify([b.kind, b.code ?? '', Object.entries(b.params || {}).map(([k, v]) => [k, paramKind(v)]),
    ...SCHEMA.map(f => b[f] && (Array.isArray(b[f]) ? b[f].length : Object.keys(b[f]).length) ? b[f] : null)])
/** Two blocks with the same code and schema, whatever their ids, labels and defaults: one block. */
export const sameBlock = (a, b) => blockSig(a) === blockSig(b)
/* the built-ins as blocks would be, by name@version: the primitives' and the modifiers' */
let BUILTINS = null
const builtins = () => BUILTINS ??= new Map([
    ...Object.keys(PRIMITIVES).map(k => [`${k}@${BUILTIN_VERSION}`, { kind: 'object', ...primitiveObject(k) }]),
    ...Object.keys(MODIFIERS).map(k => [`${k}@${BUILTIN_VERSION}`, { kind: 'group', ...modifierGroup(k) }]),
].map(([name, b]) => [name, { ...b, sig: blockSig(b) }]))
/** The built-in a block's code and schema are (`sphere@1`), or null. */
export const builtinOf = b => { const sig = blockSig(b); for (const [name, B] of builtins()) if (B.sig === sig) return name; return null }
/** A built-in by name, as a block's fields would be (label, kind, code, params, ranges, lengths), or null. */
export const builtinBlock = name => { const B = builtins().get(name); if (!B) return null; const { sig: _, ...b } = B; return structuredClone(b) }

/* A new block from `spec` ({ kind, label, code, params, constants, ranges, lengths }), added to the scene's list --
   after `after` when given. Marked built-in when it is one. */
function makeBlock(doc, spec, after = null) {
    const B = { id: newId(doc, 'b'), label: String(spec.label ?? (spec.kind === 'group' ? 'group code' : 'code')), kind: spec.kind,
                code: String(spec.code ?? ''), params: structuredClone(spec.params || {}) }
    for (const f of SCHEMA) {
        const v = spec[f]
        if (v && (Array.isArray(v) ? v.length : Object.keys(v).length)) B[f] = structuredClone(v)
    }
    /* a built-in is named as the built-in, and starts a new user at the built-in's defaults -- whichever node first
       used it, with whatever values (a library item's floor is a plane too; a 200 mm sample's boxes are boxes) */
    const name = builtinOf(B)
    if (name) { const b = builtins().get(name); B.builtin = name; B.label = b.label ?? B.label; B.params = structuredClone(b.params) }
    doc.blocks ??= []
    const at = after ? doc.blocks.indexOf(after) : -1
    if (at >= 0) doc.blocks.splice(at + 1, 0, B)
    else doc.blocks.push(B)
    return B
}
/* THE BLOCK FOR A NEW NODE's code and schema: a built-in the scene has already (every sphere shares sphere@1), or --
   `share` -- any identical block it has (an upgrade, a paste: the same code is one block); otherwise a new one. A new
   object with code of its own is a block of its own: two blank code objects must not be one block. */
function blockFor(doc, spec, { share = false } = {}) {
    const sig = blockSig(spec), name = builtinOf(spec)
    const same = (doc.blocks || []).find(B => blockSig(B) === sig && (share || (name && B.builtin === name)))
    return same ?? makeBlock(doc, spec)
}
/* a label not yet among the scene's blocks: 'sphere' -> 'sphere 2' */
const freshBlockLabel = (doc, label) => {
    const have = new Set((doc.blocks || []).map(b => b.label))
    const base = String(label).replace(/ \d+$/, '')
    let k = 2
    while (have.has(`${base} ${k}`)) k++
    return have.has(base) ? `${base} ${k}` : base
}
/** GIVE NODE `id` A BLOCK OF ITS OWN: a copy of the one it uses, which only it uses from now on -- a variant, to edit
 *  without changing the others (the user: "you can duplicate the block and edit the new one"). Not built-in. */
export function splitBlock(doc, id) {
    const { node } = must(doc, id)
    const B = blockOf(doc, node)
    if (!B) throw new ModelError(`'${id}' has no code: nothing to make its own`)
    const label = freshBlockLabel(doc, B.label)
    const C = makeBlock(doc, structuredClone(B), B)
    // the same code as the built-in, but its own now: what is edited next is the user's -- named so, after makeBlock,
    // which names a block that matches a built-in as the built-in
    delete C.builtin
    C.label = label
    node.block = C.id
    return C
}
/** The block a node's edit goes to: the one it uses, or -- for a built-in, which is read-only -- a copy of its own
 *  first (splitBlock), so editing one sphere's code does not reach every sphere. */
export function ownBlock(doc, id) {
    const { node } = must(doc, id)
    const B = blockOf(doc, node)
    if (!B) throw new ModelError(`'${id}' has no code`)
    return B.builtin ? splitBlock(doc, id) : B
}
/** A node's code, written to its block (ownBlock: a built-in's is copied for it first). Every node using that block
 *  changes with it -- the point of a block. Structural: the shader's text. */
export function setCode(doc, id, code) {
    const { node, parent } = must(doc, id)
    // a group's first code: a block of its own, with no parameters yet
    if (node.kind === 'group' && parent && node.block === undefined) {
        const B = makeBlock(doc, { kind: 'group', label: node.label, code: String(code), params: {} })
        node.block = B.id
        node.params = {}
        return B
    }
    const B = ownBlock(doc, id)
    B.code = String(code)
    return B
}
/** Rename a block (what the panel and the library show; its id stays). */
export function renameBlock(doc, id, label) {
    const B = block(doc, id)
    if (!B) throw new ModelError(`no block '${id}'`)
    B.label = String(label)
    return B
}
/** Remove a block nothing uses. */
export function removeBlock(doc, id) {
    const i = (doc.blocks || []).findIndex(b => b.id === id)
    if (i < 0) throw new ModelError(`no block '${id}'`)
    const users = usersOf(doc, id)
    if (users.length) throw new ModelError(`block '${doc.blocks[i].label}' is used by ${users.map(n => n.id).join(', ')}`)
    return doc.blocks.splice(i, 1)[0]
}
/** Make node `id` use block `blockId` (one of the scene's, of its kind): its values for the parameters both have are
 *  kept, the others start at the block's defaults. Structural. */
export function useBlock(doc, id, blockId) {
    const { node } = must(doc, id)
    const B = block(doc, blockId)
    if (!B) throw new ModelError(`no block '${blockId}'`)
    if (!node.block) throw new ModelError(`'${id}' has no code to change`)
    if (B.kind !== node.kind) throw new ModelError(`block '${B.label}' is ${B.kind === 'group' ? 'a group\'s' : 'an object\'s'} code, and '${id}' is ${node.kind === 'group' ? 'a group' : 'an object'}`)
    const params = Object.fromEntries(Object.entries(B.params).map(([k, v]) =>
        [k, k in (node.params || {}) && paramKind(node.params[k]) === paramKind(v) ? node.params[k] : structuredClone(v)]))
    const trial = { ...node, block: B.id, params }
    const bad = userProblems(trial, B)
    if (bad.length) throw new ModelError(bad)
    node.block = B.id
    node.params = params
    if (node.liveProfiles) { node.liveProfiles = node.liveProfiles.filter(k => paramKind(params[k]) === 'profile'); if (!node.liveProfiles.length) delete node.liveProfiles }
    return node
}
/** WHAT THE PANEL, THE REGISTRY AND THE TOOLS IN THE PICTURE READ A NODE THROUGH: a shallow copy of it with its
 *  block's code and schema -- code, constants, ranges, lengths -- as a node had them before version 16, and the
 *  block itself (`blockOf`). Its params, transform and the rest are the node's own objects, so a write INTO them
 *  (view.params[k] = v, view.transform.pos.x = v) is a write to the node; a write OF a field (view.label = v) is not,
 *  and nothing that reads through a view does one. A plain copy, not a proxy: { ...view } is still all of it. Made
 *  again after a schema edit, which replaces the users' params (onBlock). A node without a block is itself. */
export function viewOf(doc, node) {
    const B = blockOf(doc, node)
    if (!B) return node
    return { ...node, code: B.code, constants: B.constants, ranges: B.ranges, lengths: B.lengths, blockOf: B }
}
/* EVERYTHING WRONG WITH A BLOCK, as strings: its fields, its parameters as a node of its kind would have them (names,
   kinds, the defaults' values, profiles and paths sound), its constants, ranges and lengths */
const BLOCK_KEYS = ['id', 'label', 'kind', 'code', 'params', 'builtin', ...SCHEMA]
function blockProblems(B) {
    const at = `block '${B?.id}'`
    if (!B || typeof B !== 'object' || Array.isArray(B)) return [`${at}: not an object`]
    const p = []
    for (const k of Object.keys(B)) if (!BLOCK_KEYS.includes(k)) p.push(`${at} has '${k}', which a block does not (${BLOCK_KEYS.join(', ')})`)
    if (!BLOCK_KINDS.includes(B.kind)) p.push(`${at}: kind must be ${BLOCK_KINDS.join(' or ')}`)
    if (typeof B.label !== 'string') p.push(`${at}: label must be a string`)
    if (typeof B.code !== 'string') p.push(`${at}: code must be a string`)
    if (B.builtin !== undefined && !(typeof B.builtin === 'string' && /^[^@]+@\d+$/.test(B.builtin)))
        p.push(`${at}: builtin is a name@version, or absent`)
    if (!B.params || typeof B.params !== 'object' || Array.isArray(B.params)) return [...p, `${at}: params must be an object`]
    const as = { ...B, id: B.id, kind: B.kind, type: 'code' }
    if (B.kind === 'group') {
        const { code: _c, ...g } = as
        p.push(...groupParamProblems(g))
    } else {
        const bad = Object.keys(B.params).filter(k => !PARAM.test(k) || RESERVED_PARAMS.includes(k))
        if (bad.length) p.push(`${at}: parameter name(s) not valid in WGSL: ${bad.join(', ')}`)
        p.push(...profileProblems(as))
        p.push(...constantProblems(as), ...rangesProblems(as), ...lengthsProblems(as))
    }
    return p
}
/* EVERYTHING WRONG WITH A NODE AS A USER OF BLOCK B: the same parameter names as the block, each of its kind; its
   values sound (a profile, a path, a constant's value for its type) */
function userProblems(n, B) {
    const p = []
    const P = n.params || {}
    if (!n.params || typeof n.params !== 'object' || Array.isArray(n.params)) return [`'${n.id}': params must be an object`]
    const missing = Object.keys(B.params).filter(k => !(k in P)), extra = Object.keys(P).filter(k => !(k in B.params))
    if (missing.length) p.push(`'${n.id}': no value for ${missing.join(', ')} (block '${B.label}' has ${missing.length === 1 ? 'it' : 'them'})`)
    if (extra.length) p.push(`'${n.id}': ${extra.join(', ')} ${extra.length === 1 ? 'is' : 'are'} not a parameter of block '${B.label}'`)
    for (const k of Object.keys(B.params)) if (k in P && paramKind(P[k]) !== paramKind(B.params[k]))
        p.push(`'${n.id}': '${k}' holds a ${paramKind(P[k])}, and block '${B.label}' says ${paramKind(B.params[k])}`)
    if (p.length) return p
    const as = { ...n, constants: B.constants }
    if (B.kind === 'group') {
        for (const [k, v] of Object.entries(P)) if (!['number', 'vector', 'colour'].includes(paramKind(v)) || !finiteValue(v))
            p.push(`'${n.id}': parameter '${k}' must be a number, {x, y, z} or {r, g, b}`)
    } else p.push(...profileProblems(as))
    p.push(...constantProblems(as))
    return p
}

//----------------------------------------------------------------------------------------------
// Operations -- everything the tree will offer
//----------------------------------------------------------------------------------------------

/** A material from a preset (materials.js PRESETS) or from explicit parameters -- any field not
 *  given takes makeDefaultMaterial()'s value -- with optional WGSL. */
export function addMaterial(doc, { label, preset = 'diffuse', params, code = MATERIAL_CODE_TEMPLATE, id, type } = {}) {
    if (!PRESETS[preset]) throw new ModelError(`unknown material preset '${preset}'`)
    id = id ?? newId(doc, 'm')
    if (!ID.test(id)) throw new ModelError(`'${id}' is not a valid id (letters and digits, starting with a letter)`)
    if (allIds(doc).has(id)) throw new ModelError(`id '${id}' is already in use`)
    const m = { id, label: label ?? PRESETS[preset].label,
                params: { ...materialDefaults(), ...(params ? structuredClone(params) : PRESETS[preset].params()) },
                code: String(code) }
    // the preset's type (the light preset is an emitter), unless one is given; surface is no field
    const t = type ?? PRESETS[preset].type
    if (t && t !== 'surface') m.type = t
    const bad = materialProblems(m)
    if (bad.length) throw new ModelError(bad)
    doc.materials.push(m)
    return m
}

/** Everything wrong with one material, as strings. */
function materialProblems(m) {
    const p = []
    const P = m?.params
    if (!P || typeof P !== 'object') return [`material '${m?.id}': params must be an object`]
    for (const [k, f] of Object.entries(FIELDS)) {
        const v = P[k]
        const ok = f.type.startsWith('vec3') ? v && ['r', 'g', 'b'].every(c => Number.isFinite(v[c]))
            : Number.isFinite(v) && (f.type !== 'u32' || (Number.isInteger(v) && v >= 0))
        if (!ok) p.push(`material '${m.id}': ${k} must be ${f.type.startsWith('vec3') ? '{r, g, b} numbers' : f.type === 'u32' ? 'a whole number >= 0' : 'a number'}`)
    }
    // where a coating is (materials.js coating): one of its four
    const C = FIELDS.coating.gui.options
    if (Number.isInteger(P.coating) && !Object.values(C).includes(P.coating))
        p.push(`material '${m.id}': coating must be one of ${Object.entries(C).map(([k, v]) => `${v} (${k})`).join(', ')}`)
    /* ANY OTHER KEY IS A PARAMETER OF ITS OWN, for the material's code -- a stripe width, a
       second colour -- declared and aliased exactly like a code node's (codegen). */
    /* ...and not relief_<anything>: a relief's parameters are uniforms `relief_<name>_<id>` (codegen
       paramUniform), so an own parameter by that name would be the same uniform */
    const bad = customParams(m).filter(k => !PARAM.test(k) || RESERVED_PARAMS.includes(k) || MATERIAL_SCOPE.includes(k) || k.startsWith('relief_'))
    if (bad.length) p.push(`material '${m.id}': parameter name(s) not usable: ${bad.join(', ')}`
        + ` (a WGSL name, not relief_..., and not one of ${MATERIAL_SCOPE.join(', ')})`)
    for (const k of customParams(m)) if (!['number', 'vector', 'colour'].includes(paramKind(P[k])) || !finiteValue(P[k]))
        p.push(`material '${m.id}': parameter '${k}' must be a number, {x, y, z} or {r, g, b}`)
    p.push(...constantProblems(m), ...rangesProblems(m), ...lengthsProblems(m))
    for (const k of [...Object.keys(m.constants || {}), ...Object.keys(m.ranges || {}), ...(m.lengths || [])])
        if (k in FIELDS) p.push(`material '${m.id}': '${k}' is a field; only its own parameters can be compile-time or ranged`)
    if (typeof m.code !== 'string') p.push(`material '${m.id}': code must be a string`)
    p.push(...reliefProblems(m))
    if (m.type !== undefined && !MATERIAL_TYPES.slice(1).includes(m.type))
        p.push(`material '${m.id}': type must be one of ${MATERIAL_TYPES.slice(1).join(', ')} (or absent: surface)`)
    return p
}

/** The names a material's code already has in scope (codegen emitMaterials): a parameter by one
 *  of these would shadow it, and `m` or `p` silently meaning something else is worse than an error. */
export const MATERIAL_SCOPE = ['m', 'p', 'n', 'C', 'p_local', 'R_local', 'S_local', 'idx', 'checkInside', 'MATERIAL']

/* A MATERIAL'S RELIEF (materials.js RELIEFS): { code, params, constants?, ranges?, lengths? } -- a height
   field in mm that codegen puts around every object wearing the material. `amplitude` it must have, a
   number >= 0: the most its height reaches, which the generated code clamps it to. Its parameters are
   owned by `<id>#relief` for the operations below (addParam, renameParam, setRange, ...), which is how the
   panel and the parameter registry reach them without a second set of operations. */
const RELIEF_KEYS = ['code', 'params', 'constants', 'ranges', 'lengths']
function reliefProblems(m) {
    const R = m?.relief
    if (R === undefined) return []
    const at = `material '${m.id}': its relief`
    if (!R || typeof R !== 'object' || Array.isArray(R)) return [`${at} must be an object`]
    const p = []
    for (const k of Object.keys(R)) if (!RELIEF_KEYS.includes(k)) p.push(`${at} has '${k}', which a relief does not (${RELIEF_KEYS.join(', ')})`)
    if (typeof R.code !== 'string') p.push(`${at}: code must be a string`)
    if (!R.params || typeof R.params !== 'object' || Array.isArray(R.params)) return [...p, `${at}: params must be an object`]
    const A = R.params.amplitude
    if (!(typeof A === 'number' && Number.isFinite(A) && A >= 0))
        p.push(`${at} needs an amplitude, a number >= 0 (mm): the most its height reaches -- it is what bounds it`)
    for (const [k, v] of Object.entries(R.params)) {
        if (!PARAM.test(k) || RESERVED_PARAMS.includes(k) || RELIEF_SCOPE.includes(k))
            p.push(`${at}: parameter name '${k}' not usable (a WGSL name, and not one of ${RELIEF_SCOPE.join(', ')})`)
        else if (!['number', 'vector', 'colour'].includes(paramKind(v)) || !finiteValue(v))
            p.push(`${at}: parameter '${k}' must be a number, {x, y, z} or {r, g, b}`)
    }
    const owner = { id: reliefOwner(m.id), params: R.params, constants: R.constants, ranges: R.ranges, lengths: R.lengths }
    p.push(...constantProblems(owner), ...rangesProblems(owner), ...lengthsProblems(owner))
    return p
}

/** Give a material a relief from a preset (materials.js RELIEFS), or take it away (null). */
export function setRelief(doc, id, preset) {
    const mat = material(doc, id)
    if (!mat) throw new ModelError(`no material '${id}'`)
    // its relief's animated flags (setAnimated: kept on the material) go with the relief they named
    const dropReliefFlags = () => { if (Array.isArray(mat.animate)) { mat.animate = mat.animate.filter(k => !String(k).startsWith(RELIEF_FLAG)); if (!mat.animate.length) delete mat.animate } }
    if (preset == null) { delete mat.relief; dropReliefFlags(); return mat }
    const R = RELIEFS[preset]
    if (!R) throw new ModelError(`unknown relief '${preset}' (one of ${Object.keys(RELIEFS).join(', ')})`)
    const relief = { code: R.code, params: structuredClone(R.params), ranges: structuredClone(R.ranges), lengths: [...R.lengths] }
    const bad = reliefProblems({ ...mat, relief })
    if (bad.length) throw new ModelError(bad)
    mat.relief = relief
    dropReliefFlags()
    return mat
}

/** A material's own parameters: everything in its params that is not a Material2 field. */
export const customParams = m => Object.keys(m?.params || {}).filter(k => !(k in FIELDS))

const finiteValue = v => typeof v === 'number' ? Number.isFinite(v)
    : Object.values(v).every(Number.isFinite)

/** A group: its children combined by their joins (and `blend`, the default smoothness of those),
 *  optionally with code of its own around them and parameters for that code -- see codegen's "A
 *  group's code". `join` / `joinBlend` are how the group itself joins its parent's other children.
 *
 *  `op` is refused, as addObject refuses `type`: a group has had none since version 14, and a caller
 *  still passing op: 'subtract' would otherwise get a union without a word. */
export function addGroup(doc, parentId, opts = {}, index) {
    if ('op' in opts) throw new ModelError(`a group has no op since version 14: each child's join says how it combines (setJoin, or join: in addObject / addGroup)`)
    const { label = 'group', id, blend = 0, transform, code, params, constants, ranges, lengths, join, joinBlend, block: blockId } = opts
    const parent = groupOf(doc, parentId)
    const node = { id: checkNewId(doc, id), kind: 'group', label, enabled: true, blend,
                   transform: structuredClone(transform ?? identity()), children: [] }
    /* ITS CODE IS A BLOCK (version 16): one given by id, or the one its code and parameters are -- a modifier's
       built-in when they are a modifier's (modifiers.js), else a new one. Checked before anything is added. */
    let spec = null, B = blockId != null ? block(doc, blockId) : null
    if (blockId != null && (!B || B.kind !== 'group')) throw new ModelError(`no group block '${blockId}'`)
    if (B) node.params = structuredClone(params ?? B.params)
    else if (code != null || params) {
        spec = { kind: 'group', label, code: String(code ?? ''), params: structuredClone(params ?? {}), constants, ranges, lengths }
        node.params = structuredClone(spec.params)
    }
    const bad = [...joinOnto(node, join, joinBlend, parent === doc.root),
                 ...(spec ? blockProblems({ ...spec, id: node.id }).map(m => m.replace(`block '${node.id}'`, `'${node.id}'`)) : []),
                 ...(B ? userProblems(node, B) : [])]
    if (!(Number.isFinite(blend) && blend >= 0)) bad.push(`'${node.id}': blend must be a number >= 0`)
    if (bad.length) throw new ModelError(bad)
    if (spec) B = blockFor(doc, spec)
    if (B) node.block = B.id
    insert(parent.children, node, index)
    return node
}

/* A new node's join, given at its creation: set if sound, and the problems otherwise. Union and no
   own blend are stored as no field, like a surface material's type. */
function joinOnto(node, join, joinBlend, atTop) {
    if (join != null && join !== 'union') node.join = join
    if (joinBlend != null) node.joinBlend = joinBlend
    const p = joinProblems(node)
    if (atTop && (node.join !== undefined || node.joinBlend !== undefined)) p.push(TOP_LEVEL(node.id))
    return p
}
const TOP_LEVEL = id => `'${id}' is at the top level, which is always a plain union: put it in a group to join it`
/** Everything wrong with a node's join and own blend. A light and an export box are not shapes of
 *  their group (codegen leaves them out of the combine), so they have neither. */
function joinProblems(n) {
    const p = []
    if (n.join !== undefined && !OPS.includes(n.join)) p.push(`'${n.id}': join must be one of ${OPS.join(', ')}`)
    if (n.joinBlend !== undefined && !(Number.isFinite(n.joinBlend) && n.joinBlend >= 0)) p.push(`'${n.id}': joinBlend must be a number >= 0`)
    if ((n.join !== undefined || n.joinBlend !== undefined) && (n.type === 'light' || isBoxType(n.type)))
        p.push(`'${n.id}': a ${n.type === 'light' ? 'light' : BOX_WORDS[n.type]} is not one of its group's shapes, so it has no join`)
    return p
}
/** How a node joins what is above it in its group: union, subtract or intersect (version 14). Refused
 *  at the top level, which is always a plain union, and on a light or an export box. */
export function setJoin(doc, id, join) {
    const { node, parent } = must(doc, id)
    if (!parent) throw new ModelError('the root joins nothing')
    if (parent === doc.root) throw new ModelError(TOP_LEVEL(id))
    const next = { ...node }
    if (join === 'union') delete next.join
    else next.join = join
    const bad = joinProblems(next)
    if (bad.length) throw new ModelError(bad)
    if (next.join === undefined) delete node.join
    else node.join = next.join
    return node
}
/** A group's blend: the smoothness of every join among its children that has none of its own. The
 *  panel's slider and the registry go through params.js makeAfter, which also decides live or compile;
 *  this is the checked write the recipe (recipe.js) replays. */
export function setBlend(doc, id, x) {
    const { node, parent } = must(doc, id)
    if (node.kind !== 'group' || !parent) throw new ModelError(`'${id}' is not a group of the scene; only a group has a blend`)
    if (!(Number.isFinite(x) && x >= 0)) throw new ModelError(`'${id}': blend must be a number >= 0`)
    node.blend = x
    return node
}
/** A node's own join blend, or null to take its group's `blend` again. Refused where setJoin is. */
export function setJoinBlend(doc, id, x) {
    const { node, parent } = must(doc, id)
    if (!parent) throw new ModelError('the root joins nothing')
    if (parent === doc.root) throw new ModelError(TOP_LEVEL(id))
    const next = { ...node }
    if (x == null) delete next.joinBlend
    else next.joinBlend = x
    const bad = joinProblems(next)
    if (bad.length) throw new ModelError(bad)
    if (next.joinBlend === undefined) delete node.joinBlend
    else node.joinBlend = next.joinBlend
    return node
}

/** Everything wrong with a group's code and parameters, as strings. A parameter may not take a
 *  name the code already has in scope (GROUP_SCOPE): `p` or `C` silently meaning something else
 *  is worse than an error, and `children` would read as the call it is not. */
function groupProblems(n) {
    const p = []
    // true or absent (setStraightMaterial): a false would be a second way of saying the default
    if (n.straightMaterial !== undefined && n.straightMaterial !== true) p.push(`'${n.id}': straightMaterial is true or absent`)
    // version 16: a group's code and its parameters' schema are its block's; its values are its own (userProblems)
    for (const k of ['code', 'constants', 'ranges', 'lengths']) if (n[k] !== undefined)
        p.push(`'${n.id}': a group's ${k} is its block's since version 16, not its own`)
    if (n.block === undefined && n.params !== undefined) p.push(`'${n.id}': parameters without code (a block)`)
    return p
}
/* A group block's parameters (blockProblems): names its code can take, numbers, vectors and colours */
function groupParamProblems(n) {
    const p = []
    if (n.params === undefined) {
        if (n.constants !== undefined || n.ranges !== undefined || n.lengths !== undefined) p.push(`'${n.id}': constants, ranges or lengths without parameters`)
        return p
    }
    if (!n.params || typeof n.params !== 'object' || Array.isArray(n.params)) return [...p, `'${n.id}': params must be an object`]
    const bad = Object.keys(n.params).filter(k => !PARAM.test(k) || RESERVED_PARAMS.includes(k) || GROUP_SCOPE.includes(k))
    if (bad.length) p.push(`'${n.id}': parameter name(s) not usable: ${bad.join(', ')}`
        + ` (a WGSL name, and not one of ${[...RESERVED_PARAMS, ...GROUP_SCOPE].join(', ')})`)
    for (const [k, v] of Object.entries(n.params)) if (!['number', 'vector', 'colour'].includes(paramKind(v)) || !finiteValue(v))
        p.push(`'${n.id}': parameter '${k}' must be a number, {x, y, z} or {r, g, b}`)
    p.push(...constantProblems(n), ...rangesProblems(n), ...lengthsProblems(n))
    return p
}

/**
 * An object: a code node. Given `code` (or type: 'code', which is blank code), it is that code with
 * `params`; otherwise it starts as the primitive named by `primitive` (primitives.js, a sphere by
 * default) -- its code, its label, its parameters with `params` over them, and its ranges.
 *
 * `type` is refused unless it is 'code': it used to name the primitive, and a caller still saying
 * type: 'box' would otherwise get a sphere without a word.
 */
export function addObject(doc, parentId, { primitive, type, label, material: mat, params, code, id, transform, constants, ranges, lengths, join, joinBlend, block: blockId } = {}, index) {
    const parent = groupOf(doc, parentId)
    if (type === 'light') throw new ModelError('a light is added with addLight')
    if (type === 'export') throw new ModelError('an export box is added with addExportBox')
    if (type === 'haze') throw new ModelError('a haze box is added with addHazeBox')
    if (type !== undefined && !NODE_TYPES[type])
        throw new ModelError(`unknown object type '${type}' (a shape is a primitive now: { primitive: '${type}' })`)
    let B = blockId != null ? block(doc, blockId) : null
    if (blockId != null && (!B || B.kind !== 'object')) throw new ModelError(`no object block '${blockId}'`)
    let start = { label: 'code', params: {} }
    if (B) start = { label: B.label, params: B.params }
    else if (code == null && type !== 'code') {
        start = primitiveObject(primitive ?? 'sphere')
        if (!start) throw new ModelError(`unknown primitive '${primitive}' (one of ${Object.keys(PRIMITIVES).join(', ')})`)
    }
    if (mat != null && !material(doc, mat)) throw new ModelError(`no material '${mat}'`)
    const node = {
        id: checkNewId(doc, id), kind: 'object', type: 'code', label: label ?? start.label, enabled: true,
        transform: structuredClone(transform ?? identity()),
        material: mat ?? null,
        params: { ...structuredClone(start.params), ...structuredClone(params ?? {}) },
    }
    /* ITS CODE IS A BLOCK (version 16): the one given by id; or the one its code and schema are -- a primitive's
       built-in (every sphere shares sphere@1), else a new block of its own. The schema is checked on the block-to-be,
       the values on the node, before anything is added. */
    let spec = null
    if (!B) {
        const r = ranges ?? start.ranges
        spec = { kind: 'object', label: node.label, code: String(code ?? start.code ?? ''), params: node.params, constants,
                 ranges: r ? Object.fromEntries(Object.entries(structuredClone(r)).filter(([k]) => k in node.params)) : undefined,
                 lengths: (lengths ?? start.lengths ?? []).filter(k => k in node.params) }
    }
    checkParams(node)
    const bad = [...(spec ? blockProblems({ ...spec, id: node.id }).map(m => m.replace(`block '${node.id}'`, `'${node.id}'`)) : []),
                 ...userProblems(node, B ?? spec), ...joinOnto(node, join, joinBlend, parent === doc.root)]
    if (bad.length) throw new ModelError(bad)
    node.block = (B ?? blockFor(doc, spec)).id
    insert(parent.children, node, index)
    return node
}

const checkNewId = (doc, id) => {
    if (id == null) return newId(doc)
    if (RESERVED_IDS.includes(id)) throw new ModelError(`'${id}' is reserved`)
    if (!ID.test(id)) throw new ModelError(`'${id}' is not a valid id (letters and digits, starting with a letter)`)
    if (allIds(doc).has(id)) throw new ModelError(`id '${id}' is already in use`)
    return id
}
const checkParams = node => {
    const bad = Object.keys(node.params || {}).filter(k => !PARAM.test(k) || RESERVED_PARAMS.includes(k))
    if (bad.length) throw new ModelError(`'${node.id}': parameter name(s) not valid in WGSL: ${bad.join(', ')}`)
    const wrong = profileProblems(node)
    if (wrong.length) throw new ModelError(wrong)
}
/* A PROFILE (roadmap/BUILDER.md §6 phase 3): a closed outline, [[x, y], [x, y, fillet], ...] in the node's own frame
   and the scene's unit, that the node's code turns into a shape -- extrude(name, p, height), revolve(name, p),
   profile(name, q) (codegen.js). Always compile-time: it is the shader's own text, so editing it recompiles. A code
   OBJECT's only (a group's, a material's and a relief's parameters are numbers, vectors and colours). Everything
   wrong with one is said by the user's own point numbers (core/shapes.js profilePieces). */
/* A PATH (phase 4): an open line of points in 3D, { path: [[x, y, z], [x, y, z, fillet], ...] } -- the wrapper
   because [x, y, z] would read as a profile point with a fillet -- that the node's code sweeps a cross-section along:
   tube(name, p, radius, rounded), sweep(name, outline, p). A code object's only, refused by the user's own point
   numbers (core/shapes.js pathPieces). A point may go on, after its fillet, with the cross-section's scale x, scale y
   and twist in degrees there (2026-10-02; a tube reads scale x as its diameter's) -- 3 to 7 entries, the ones left off
   at the end their defaults. NO FORMAT VERSION FOR IT: a builder from before refuses such a point by its own number
   (resolvePath, through validate), so a file cannot be loaded without them and saved with them lost.
     AN ENTRY MAY NAME THE NODE'S PARAMETERS (expr.js: `0.5, 0.5, rise`), and the path may be LIVE ({ ..., live:
   true }): its pieces then are uniforms the builder rewrites as a parameter moves, with no compile (codegen.js
   livePathUpdate); compiled, they are the shader's text, and a parameter it names recompiles when it moves. What
   no value could put right -- an entry that does not read, a name the node has no number for -- is refused. What
   a value can -- a fillet too big for its edge, a point on its neighbour -- is refused only in a path that names
   nothing: one that names a parameter can be dragged there by a slider, and then DRAWS NOTHING (the user's choice,
   2026-10-01), so a file saved so still loads. */
export { LIVE_PATH_MAX, LIVE_PROFILE_MAX }     // expr.js: codegen reads them too
export function pathProblems(node, v) {
    const r = resolvePath(node.params, v)
    if (r.problems.length) return r.problems
    if (v.live !== undefined && v.live !== true) return ['live is true, or absent']
    if (v.live && v.path.length > LIVE_PATH_MAX) return [`a live path has at most ${LIVE_PATH_MAX} points (this one has ${v.path.length}): make it compiled`]
    return pathNames(v).length ? [] : pathPieces(r.points).problems
}
/* A PROFILE likewise (2026-10-02, "do the same live mode for profiles"): its points may name the node's parameters,
   with the same split between what is refused and what draws nothing. Its value is a bare list -- a list of lists is
   what a profile is to the model, codegen, the bounds, the bench and the panel alike -- so whether it is live is the
   NODE's, `liveProfiles`, a list of names as `lengths` is. */
export function outlineProblems(node, k, v) {
    const r = resolveProfile(node.params, v)
    if (r.problems.length) return r.problems
    if (node.liveProfiles?.includes(k) && v.length > LIVE_PROFILE_MAX)
        return [`a live profile has at most ${LIVE_PROFILE_MAX} points (this one has ${v.length}): make it compiled`]
    return pointNames(v).length ? [] : profilePieces(r.points).problems
}
function profileProblems(n) {
    const p = []
    for (const [k, v] of Object.entries(n.params || {})) {
        if (paramKind(v) === 'profile') for (const m of outlineProblems(n, k, v)) p.push(`'${n.id}': profile '${k}': ${m}`)
        if (paramKind(v) === 'path') for (const m of pathProblems(n, v)) p.push(`'${n.id}': path '${k}': ${m}`)
    }
    return p
}
/** The first path or profile of the node that names `key`, as "path 'route' (point 3)", or null. */
const namedBy = (node, key) => {
    for (const [k, v] of Object.entries(node.params || {})) {
        if (paramKind(v) === 'path') { const at = pathUses(v, key); if (at) return `path '${k}' (point ${at})` }
        if (paramKind(v) === 'profile') { const at = pointUses(v, key); if (at) return `profile '${k}' (point ${at})` }
    }
    return null
}
/** Everything wrong with a node's `liveProfiles`: each names one of its profiles, once. */
function liveProfilesProblems(n) {
    if (n.liveProfiles === undefined) return []
    if (!Array.isArray(n.liveProfiles)) return [`'${n.id}': liveProfiles must be a list of profile parameter names`]
    const p = []
    for (const k of n.liveProfiles) if (paramKind(n.params?.[k]) !== 'profile') p.push(`'${n.id}': live profile '${k}' is not one of its profiles`)
    if (new Set(n.liveProfiles).size !== n.liveProfiles.length) p.push(`'${n.id}': a live profile is listed twice`)
    return p
}
const dropLive = (node, key) => {
    if (!node.liveProfiles) return
    node.liveProfiles = node.liveProfiles.filter(k => k !== key)
    if (!node.liveProfiles.length) delete node.liveProfiles
}

/** Everything wrong with a node's `constants`: each names one of its parameters, holds a number,
 *  and has a type from CONSTANT_TYPES -- an unsigned or signed one a whole number. */
function constantProblems(n) {
    const p = []
    if (n.constants === undefined) return p
    if (!n.constants || typeof n.constants !== 'object' || Array.isArray(n.constants))
        return [`'${n.id}': constants must be an object of name -> type`]
    for (const [k, t] of Object.entries(n.constants)) {
        const v = n.params?.[k]
        if (!(k in (n.params || {}))) p.push(`'${n.id}': constant '${k}' is not one of its parameters`)
        else if (!CONSTANT_TYPES.includes(t)) p.push(`'${n.id}': constant '${k}' has type '${t}', not one of ${CONSTANT_TYPES.join(', ')}`)
        else if (typeof v !== 'number' || !Number.isFinite(v)) p.push(`'${n.id}': constant '${k}' must be a number`)
        else if (t !== 'f32' && !Number.isInteger(v)) p.push(`'${n.id}': constant '${k}' is ${t}, so it must be a whole number`)
        else if (t === 'u32' && v < 0) p.push(`'${n.id}': constant '${k}' is u32, so it cannot be negative`)
    }
    return p
}

/* WHAT OWNS A PARAMETER: an object, a group (for its code), or a material. A material's params hold its Material2
   fields as well, which are not parameters in this sense -- they cannot be renamed, removed,
   re-kinded, made compile-time or given a range -- so `key` is refused when it is one. The
   parameter operations below go through this, which is what lets the panel's +, pencil and
   cross serve both without knowing which it is looking at. */
const paramOwner = (doc, id, key) => {
    // a material's relief: its own parameters, owned by `<material id>#relief`
    const rm = reliefMaterialId(id)
    if (rm != null) {
        const m = material(doc, rm)
        if (!m?.relief) throw new ModelError(`no relief '${id}': material '${rm}' has none`)
        return m.relief
    }
    const mat = material(doc, id)
    if (mat) {
        if (key != null && key in FIELDS) throw new ModelError(`'${key}' is a field of every material, not a parameter of '${id}'`)
        return mat
    }
    const { node, parent } = must(doc, id)
    // the root's code is the functions block, which is not in any frame and has no children
    if (!parent) throw new ModelError(`the scene itself has no parameters; put them on a group, an object or a material`)
    return node
}
const checkOwner = (doc, owner, id = owner.id) => {
    const rm = reliefMaterialId(id)
    if (rm != null) {
        const bad = reliefProblems({ ...material(doc, rm), relief: owner })
        if (bad.length) throw new ModelError(bad)
        return
    }
    const bad = material(doc, owner.id) ? materialProblems(owner) : owner.kind === 'group' ? groupProblems(owner)
        : owner.type === 'export' ? exportProblems(owner) : owner.type === 'haze' ? hazeProblems(owner) : null
    if (bad) { if (bad.length) throw new ModelError(bad) }
    else checkParams(owner)
}

/* A NODE WHOSE PARAMETERS' SCHEMA IS A BLOCK'S (version 16): a code object, or a group (one without code gets a block
   with none the first time it is given a parameter). Lights and export boxes keep theirs: their parameters are the
   model's own, not a block's. */
const schemaNode = (doc, id) => {
    if (reliefMaterialId(id) != null || material(doc, id)) return null
    const f = find(doc, id)
    return f && f.parent && (f.node.kind === 'group' || f.node.type === 'code') ? f.node : null
}
/* A SCHEMA EDIT ON A NODE'S BLOCK: what addParam, removeParam, renameParam, setParamKind, setLength, setRange and
   setConstant do to a node's parameters, done to its block -- and every node that uses the block changes with it,
   values included: a parameter added is its default in each, renamed each keeps its value under the new name. A
   built-in is copied for the node first (ownBlock). `change(b, users)` changes b -- a copy of the block, its id the
   node's so a message names what was edited -- and users, copies of each user's { id, params, liveProfiles }, in
   place. All of it is checked before anything is written: a refusal changes nothing. */
function onBlock(doc, id, change) {
    const node = schemaNode(doc, id)
    let B = blockOf(doc, node)
    const fresh = !B
    const users = !B || B.builtin ? [node] : usersOf(doc, B.id)
    const b = B ? { id, label: B.label, kind: B.kind, code: B.code, params: structuredClone(B.params),
                    ...Object.fromEntries(SCHEMA.filter(f => B[f] !== undefined).map(f => [f, structuredClone(B[f])])) }
                : { id, label: node.label, kind: node.kind, code: '', params: {} }
    const vals = users.map(u => ({ id: u.id, kind: u.kind, type: u.type, params: structuredClone(u.params || {}),
                                   ...(u.liveProfiles ? { liveProfiles: [...u.liveProfiles] } : {}) }))
    change(b, vals)
    for (const f of SCHEMA) if (b[f] !== undefined && !(Array.isArray(b[f]) ? b[f].length : Object.keys(b[f]).length)) delete b[f]
    const bad = [...blockProblems(b).map(m => m.replace(`block '${id}'`, `'${id}'`)), ...vals.flatMap(v => userProblems(v, b))]
    if (bad.length) throw new ModelError([...new Set(bad)])
    if (fresh) { const { id: _, ...spec } = b; B = makeBlock(doc, spec); node.block = B.id }
    else if (B.builtin) B = splitBlock(doc, id)
    B.params = b.params
    for (const f of SCHEMA) { if (b[f] !== undefined) B[f] = b[f]; else delete B[f] }
    users.forEach((u, i) => {
        u.params = vals[i].params
        if (vals[i].liveProfiles?.length) u.liveProfiles = vals[i].liveProfiles; else delete u.liveProfiles
    })
    return node
}
const hasParam = (b, id, key) => { if (!(key in b.params)) throw new ModelError(`'${id}' has no parameter '${key}'`) }
/* ...and refused while a path or a profile names it, in the block's defaults or in any user's values */
const notNamed = (b, users, key) => {
    // the node's own values first: what the user is looking at, then the others', then the block's default
    for (const u of [...users.filter(x => x.id === b.id), ...users.filter(x => x.id !== b.id), b]) {
        const by = namedBy(u, key)
        if (by) throw new ModelError(`'${key}' is named by ${by}${u === b ? ' (the block\'s default)' : u.id !== b.id ? ` of '${u.id}', which uses the same block` : ''}: change the path first`)
    }
}

/** Add a parameter to an object or a material -- a number, {x,y,z} or {r,g,b}. An object's or a group's goes to its
 *  block (version 16): every node that uses it gets it, at `value`. */
export function addParam(doc, id, key, value = 0) {
    if (schemaNode(doc, id)) return onBlock(doc, id, (b, users) => {
        if (key in b.params) throw new ModelError(`'${id}' already has a parameter '${key}'`)
        b.params[key] = structuredClone(value)
        for (const u of users) u.params[key] = structuredClone(value)
    })
    const node = paramOwner(doc, id)
    if (key in (node.params || {})) throw new ModelError(`'${id}' already has a parameter '${key}'`)
    const next = { ...node, params: { ...node.params, [key]: structuredClone(value) } }
    checkOwner(doc, next, id)
    node.params = next.params
    return node
}

/* A RELIEF'S AMPLITUDE STAYS: it bounds the height -- the clamp and the step bound rest on it -- so it is
   not removed, renamed or made a vector */
const keepAmplitude = (id, key) => {
    if (reliefMaterialId(id) != null && key === 'amplitude') throw new ModelError('a relief\'s amplitude bounds its height: it stays, a number')
}
/** Remove a parameter, and its constant marking with it -- refused while a binding reads it; a binding of it goes
 *  with it (version 18). */
export function removeParam(doc, id, key) {
    const node = find(doc, id)?.node
    if (node) notBound(doc, id, key)
    const users = node ? schemaUsers(doc, id) : []
    const owners = flagOwners(doc, id)
    const out = removeParamOf(doc, id, key)
    dropBound(users, key)
    owners.forEach(o => dropFlag(o)(key))
    return out
}
function removeParamOf(doc, id, key) {
    keepAmplitude(id, key)
    if (schemaNode(doc, id)) return onBlock(doc, id, (b, users) => {
        hasParam(b, id, key)
        notNamed(b, users, key)
        delete b.params[key]
        for (const f of ['constants', 'ranges']) if (b[f]) delete b[f][key]
        dropLength(b, key)
        for (const u of users) { delete u.params[key]; dropLive(u, key) }
    })
    const node = paramOwner(doc, id, key)
    if (!(key in (node.params || {}))) throw new ModelError(`'${id}' has no parameter '${key}'`)
    const by = namedBy(node, key)
    if (by) throw new ModelError(`'${key}' is named by ${by}: change the path first`)
    delete node.params[key]
    for (const f of ['constants', 'ranges'])
        if (node[f]) { delete node[f][key]; if (!Object.keys(node[f]).length) delete node[f] }
    dropLength(node, key)
    dropLive(node, key)
    return node
}

/** The kind of value a parameter holds: 'number', 'vector' ({x,y,z}), 'colour' ({r,g,b}), 'profile' (a list of
 *  points, each a list: [[x, y], [x, y, fillet], ...]) or 'path' ({ path: [[x, y, z], [x, y, z, fillet], ...] }).
 *  A flat list of numbers is none of these ('other'). */
export const paramKind = v => typeof v === 'number' ? 'number'
    : Array.isArray(v) ? (v.length && v.every(Array.isArray) ? 'profile' : 'other')
    : v && typeof v === 'object' && Array.isArray(v.path) ? 'path'
    : v && typeof v === 'object' && 'x' in v ? 'vector' : v && typeof v === 'object' && 'r' in v ? 'colour' : 'other'
/** A new profile: a unit square, one corner rounded -- something to see, and the form of a fillet to copy. */
export const DEFAULT_PROFILE = () => [[-0.5, -0.5], [0.5, -0.5, 0.1], [0.5, 0.5], [-0.5, 0.5]]
/** A new path: an L with its corner rounded, centred on the origin -- the form of a fillet to copy. */
export const DEFAULT_PATH = () => ({ path: [[-0.5, -0.5, 0], [0.5, -0.5, 0, 0.25], [0.5, 0.5, 0]] })
const KIND_VALUE = { number: () => 0, vector: () => ({ x: 0, y: 0, z: 0 }), colour: () => ({ r: 1, g: 1, b: 1 }),
    profile: DEFAULT_PROFILE, path: DEFAULT_PATH }

/** Rename a parameter, keeping its value, constant marking and range. The node's code is NOT
 *  rewritten: a textual rename cannot tell the parameter from a field or a comment that happens
 *  to share its name (the old builder's regex did exactly that damage), so the code editor
 *  reports the old name as unresolved and the user changes it where they mean it. */
export function renameParam(doc, id, from, to) {
    // a node's: its bindings follow (version 18) -- checked first, written once the rename itself has been made
    const bound = find(doc, id) && from !== to ? renameBound(doc, id, from, to, schemaUsers(doc, id)) : null
    const owners = flagOwners(doc, id)
    const out = renameParamOf(doc, id, from, to)
    bound?.()
    owners.forEach(o => renameFlag(o, from, to))      // an animated value stays animated under its new name
    return out
}
function renameParamOf(doc, id, from, to) {
    keepAmplitude(id, from)
    if (schemaNode(doc, id)) return onBlock(doc, id, (b, users) => {
        hasParam(b, id, from)
        if (from === to) return
        if (to in b.params) throw new ModelError(`'${id}' already has a parameter '${to}'`)
        const re = pt => pt.map(c => typeof c === 'string' ? renameIn(c, from, to) : c)
        const named = v => paramKind(v) === 'path' && pathUses(v, from) ? { ...v, path: v.path.map(re) }
            : paramKind(v) === 'profile' && pointUses(v, from) ? v.map(re) : v
        // each in its own order, so the panel does not reshuffle; a path's points that name it rewritten (expr.js renameIn)
        const ren = P => Object.fromEntries(Object.entries(P).map(([k, v]) => [k === from ? to : k, named(v)]))
        b.params = ren(b.params)
        for (const f of ['constants', 'ranges']) if (b[f] && from in b[f]) { b[f][to] = b[f][from]; delete b[f][from] }
        if (b.lengths) b.lengths = b.lengths.map(k => k === from ? to : k)
        for (const u of users) {
            u.params = ren(u.params)
            if (u.liveProfiles) u.liveProfiles = u.liveProfiles.map(k => k === from ? to : k)
        }
    })
    const node = paramOwner(doc, id, from)
    if (!(from in (node.params || {}))) throw new ModelError(`'${id}' has no parameter '${from}'`)
    if (from === to) return node
    if (to in node.params) throw new ModelError(`'${id}' already has a parameter '${to}'`)
    // rebuild in the same order, so the panel does not reshuffle; a path's points that name it are rewritten (expr.js
    // renameIn: a whole name, never a component) -- unlike code, a path's expressions are this file's own syntax
    const re = pt => pt.map(c => typeof c === 'string' ? renameIn(c, from, to) : c)
    const named = v => paramKind(v) === 'path' && pathUses(v, from) ? { ...v, path: v.path.map(re) }
        : paramKind(v) === 'profile' && pointUses(v, from) ? v.map(re) : v
    const params = Object.fromEntries(Object.entries(node.params).map(([k, v]) => [k === from ? to : k, named(v)]))
    checkOwner(doc, { ...node, params }, id)
    node.params = params
    for (const f of ['constants', 'ranges'])
        if (node[f] && from in node[f]) { node[f][to] = node[f][from]; delete node[f][from] }
    if (node.lengths) node.lengths = node.lengths.map(k => k === from ? to : k)
    if (node.liveProfiles) node.liveProfiles = node.liveProfiles.map(k => k === from ? to : k)
    return node
}

/** Change what a parameter holds; its value starts over as that kind's default. A vector or a
 *  colour cannot be a compile-time constant or have a range, so those markings go with it. */
export function setParamKind(doc, id, key, kind) {
    // a node's: refused while a binding reads it, and a binding of it goes when it becomes another kind (version 18)
    const node = find(doc, id)?.node
    const was = node ? paramKind(node.params?.[key]) : null
    if (node && was !== kind) notBound(doc, id, key)
    const users = node ? schemaUsers(doc, id) : []
    const owners = flagOwners(doc, id)
    const out = setParamKindOf(doc, id, key, kind)
    if (node && was !== kind) dropBound(users, key)
    // a profile or a path is the shader's text, never one value a timeline moves: its flag goes
    if (kind === 'profile' || kind === 'path') owners.forEach(o => dropFlag(o)(key))
    return out
}
function setParamKindOf(doc, id, key, kind) {
    if (kind !== 'number') keepAmplitude(id, key)
    if (schemaNode(doc, id)) return onBlock(doc, id, (b, users) => {
        hasParam(b, id, key)
        if (!KIND_VALUE[kind]) throw new ModelError(`unknown parameter kind '${kind}' (number, vector, colour, profile or path)`)
        if (paramKind(b.params[key]) === kind) return
        notNamed(b, users, key)
        if ((kind === 'profile' || kind === 'path') && b.kind !== 'object')
            throw new ModelError(`a ${kind} is a code object's parameter: '${id}' is a group`)
        b.params[key] = KIND_VALUE[kind]()
        for (const u of users) u.params[key] = KIND_VALUE[kind]()
        if (kind !== 'number') for (const f of ['constants', 'ranges']) if (b[f]) delete b[f][key]
        if (kind === 'colour') dropLength(b, key)          // a colour is not a length
        if (kind !== 'profile') for (const u of users) dropLive(u, key)
    })
    const node = paramOwner(doc, id, key)
    if (!(key in (node.params || {}))) throw new ModelError(`'${id}' has no parameter '${key}'`)
    if (!KIND_VALUE[kind]) throw new ModelError(`unknown parameter kind '${kind}' (number, vector, colour, profile or path)`)
    if (paramKind(node.params[key]) === kind) return node
    const by = namedBy(node, key)
    if (by) throw new ModelError(`'${key}' is named by ${by}: change the path first`)
    if ((kind === 'profile' || kind === 'path') && node.kind !== 'object')
        throw new ModelError(`a ${kind} is a code object's parameter: '${id}' is ${material(doc, id) || reliefMaterialId(id) != null ? 'a material' : 'a group'}`)
    node.params[key] = KIND_VALUE[kind]()
    if (kind !== 'number') for (const f of ['constants', 'ranges'])
        if (node[f]) { delete node[f][key]; if (!Object.keys(node[f]).length) delete node[f] }
    if (kind === 'colour') dropLength(node, key)          // a colour is not a length
    if (kind !== 'profile') dropLive(node, key)
    return node
}

/** Set a profile parameter's points, refused -- by the user's own point numbers -- if they are not a sound outline
 *  (core/shapes.js profilePieces). Structural: the outline is the shader's own text. */
export function setProfile(doc, id, key, points) {
    const node = paramOwner(doc, id, key)
    if (!(key in (node.params || {}))) throw new ModelError(`'${id}' has no parameter '${key}'`)
    if (paramKind(node.params[key]) !== 'profile') throw new ModelError(`'${key}' is not a profile`)
    const v = structuredClone(points)
    if (paramKind(v) !== 'profile') throw new ModelError(`a profile is a list of points, each [x, y] or [x, y, fillet]`)
    // what is typed is checked at today's values, names or not: refused, not drawn as nothing
    const r = resolveProfile(node.params, v)
    const bad = [...outlineProblems(node, key, v), ...(r.problems.length ? [] : profilePieces(r.points).problems)]
    if (bad.length) throw new ModelError([...new Set(bad)].map(m => `profile '${key}': ${m}`))
    node.params[key] = v
    return node
}
/** Make a profile live (its pieces uniforms: a parameter it names moves it with no compile) or compiled (its numbers
 *  the shader's text). Structural either way. Kept on the node, `liveProfiles`: the value is a bare list. */
export function setProfileLive(doc, id, key, on) {
    const node = paramOwner(doc, id, key)
    if (!(key in (node.params || {}))) throw new ModelError(`'${id}' has no parameter '${key}'`)
    const v = node.params[key]
    if (paramKind(v) !== 'profile') throw new ModelError(`'${key}' is not a profile`)
    if (on && v.length > LIVE_PROFILE_MAX) throw new ModelError(`a live profile has at most ${LIVE_PROFILE_MAX} points ('${key}' has ${v.length})`)
    dropLive(node, key)
    if (on) node.liveProfiles = [...(node.liveProfiles || []), key]
    return node
}
/** Set a path parameter's points (the list inside its { path }), refused -- by the user's own point numbers -- if
 *  they are not a sound path (core/shapes.js pathPieces). Structural, as a profile is. */
export function setPath(doc, id, key, points) {
    const node = paramOwner(doc, id, key)
    if (!(key in (node.params || {}))) throw new ModelError(`'${id}' has no parameter '${key}'`)
    if (paramKind(node.params[key]) !== 'path') throw new ModelError(`'${key}' is not a path`)
    const v = structuredClone(points)
    if (!Array.isArray(v) || !v.every(Array.isArray)) throw new ModelError(`a path is a list of points, each [x, y, z] or [x, y, z, fillet]`)
    const next = { path: v, ...(node.params[key].live ? { live: true } : {}) }
    // what is typed is checked at today's values, names or not: refused, not drawn as nothing
    const r = resolvePath(node.params, next)
    const bad = [...pathProblems(node, next), ...(r.problems.length ? [] : pathPieces(r.points).problems)]
    if (bad.length) throw new ModelError([...new Set(bad)].map(m => `path '${key}': ${m}`))
    node.params[key] = next
    return node
}
/** Make a path live (its pieces uniforms: a parameter it names moves it with no compile) or compiled (its numbers
 *  the shader's text). Structural either way: the shader changes. */
export function setPathLive(doc, id, key, on) {
    const node = paramOwner(doc, id, key)
    if (!(key in (node.params || {}))) throw new ModelError(`'${id}' has no parameter '${key}'`)
    const v = node.params[key]
    if (paramKind(v) !== 'path') throw new ModelError(`'${key}' is not a path`)
    if (on && v.path.length > LIVE_PATH_MAX) throw new ModelError(`a live path has at most ${LIVE_PATH_MAX} points ('${key}' has ${v.path.length})`)
    const next = { ...v }
    if (on) next.live = true; else delete next.live
    node.params[key] = next
    return node
}
export { resolvePath, resolveProfile, pathNames, pointNames }

/* A LENGTH: a parameter measured in the scene's unit (doc.unit), which the panel and the Parameters list
   then show beside it -- "radius (cm)" -- as they show the position's. Nothing else changes: the shader
   has no units, only numbers, so this is a label and not a conversion. A number, a vector, a profile or a path can
   be one. */
const dropLength = (node, key) => {
    if (!node.lengths) return
    node.lengths = node.lengths.filter(k => k !== key)
    if (!node.lengths.length) delete node.lengths
}
/** Whether a parameter is a length in the scene's unit. */
export const isLength = (owner, key) => !!owner?.lengths?.includes(key)
/** Mark a parameter as a length in the scene's unit, or not. */
export function setLength(doc, id, key, on) {
    if (schemaNode(doc, id)) return onBlock(doc, id, b => {
        hasParam(b, id, key)
        if (!on) { dropLength(b, key); return }
        if (paramKind(b.params[key]) === 'colour') throw new ModelError(`'${key}' is a colour, not a length`)
        if (!isLength(b, key)) b.lengths = [...(b.lengths || []), key]
    })
    const node = paramOwner(doc, id, key)
    if (!(key in (node.params || {}))) throw new ModelError(`'${id}' has no parameter '${key}'`)
    if (!on) { dropLength(node, key); return node }
    if (paramKind(node.params[key]) === 'colour') throw new ModelError(`'${key}' is a colour, not a length`)
    if (!isLength(node, key)) node.lengths = [...(node.lengths || []), key]
    return node
}
function lengthsProblems(n) {
    if (n.lengths === undefined) return []
    if (!Array.isArray(n.lengths)) return [`'${n.id}': lengths must be a list of parameter names`]
    const p = []
    for (const k of n.lengths) {
        if (!(k in (n.params || {}))) p.push(`'${n.id}': length '${k}' is not one of its parameters`)
        else if (!['number', 'vector', 'profile', 'path'].includes(paramKind(n.params[k]))) p.push(`'${n.id}': length '${k}' must be a number, {x, y, z}, a profile or a path`)
    }
    if (new Set(n.lengths).size !== n.lengths.length) p.push(`'${n.id}': a length is listed twice`)
    return p
}

/** The slider range the panel offers for a number parameter, or null to drop it. */
export function setRange(doc, id, key, range) {
    if (schemaNode(doc, id)) return onBlock(doc, id, (b, users) => {
        hasParam(b, id, key)
        if (range == null) { if (b.ranges) delete b.ranges[key]; return }
        const bad = rangeProblems(key, range)
        if (bad.length) throw new ModelError(bad.map(x => `'${id}': ${x}`))
        b.ranges = { ...(b.ranges || {}), [key]: { min: range.min, max: range.max, step: range.step } }
        // a value outside its new range would be a slider pinned at one end showing a lie -- in every user
        for (const u of [b, ...users]) if (typeof u.params[key] === 'number') u.params[key] = Math.min(range.max, Math.max(range.min, u.params[key]))
    })
    const node = paramOwner(doc, id, key)
    if (!(key in (node.params || {}))) throw new ModelError(`'${id}' has no parameter '${key}'`)
    if (range == null) {
        if (node.ranges) { delete node.ranges[key]; if (!Object.keys(node.ranges).length) delete node.ranges }
        return node
    }
    const bad = rangeProblems(key, range)
    if (bad.length) throw new ModelError(bad.map(x => `'${id}': ${x}`))
    node.ranges = { ...(node.ranges || {}), [key]: { min: range.min, max: range.max, step: range.step } }
    // a value outside its new range would be a slider pinned at one end showing a lie
    if (typeof node.params[key] === 'number') node.params[key] = Math.min(range.max, Math.max(range.min, node.params[key]))
    return node
}
/** Everything wrong with an owner's `ranges`: each names one of its parameters and is sound. */
function rangesProblems(n) {
    if (n.ranges === undefined) return []
    if (!n.ranges || typeof n.ranges !== 'object') return [`'${n.id}': ranges must be an object`]
    const p = []
    for (const [k, r] of Object.entries(n.ranges)) {
        if (!(k in (n.params || {}))) p.push(`'${n.id}': range for '${k}', which is not one of its parameters`)
        p.push(...rangeProblems(k, r).map(x => `'${n.id}': ${x}`))
    }
    return p
}
function rangeProblems(k, r) {
    const p = []
    if (!r || typeof r !== 'object') return [`range of '${k}' must be {min, max, step}`]
    if (![r.min, r.max, r.step].every(Number.isFinite)) p.push(`range of '${k}' needs numeric min, max and step`)
    else if (!(r.min < r.max)) p.push(`range of '${k}': min must be below max`)
    else if (!(r.step > 0)) p.push(`range of '${k}': step must be above 0`)
    return p
}

/** Make a parameter compile-time (`type` one of CONSTANT_TYPES) or live again (`type` null).
 *  Making it u32 or i32 rounds its value, since a constant of those types is a whole number. */
export function setConstant(doc, id, key, type) {
    const owners = flagOwners(doc, id)
    const out = setConstantOf(doc, id, key, type)
    // a compile-time value is the shader's text: no uniform to animate (setAnimated refuses it the same way)
    if (type != null) owners.forEach(o => dropFlag(o)(key))
    return out
}
function setConstantOf(doc, id, key, type) {
    if (schemaNode(doc, id)) return onBlock(doc, id, (b, users) => {
        hasParam(b, id, key)
        if (type == null) { if (b.constants) delete b.constants[key]; return }
        b.constants = { ...(b.constants || {}), [key]: type }
        // each user's value made one of its type: a constant's value is still each node's (two values, two functions)
        for (const u of [b, ...users]) {
            if (type !== 'f32' && typeof u.params[key] === 'number') u.params[key] = Math.round(u.params[key])
            if (type === 'u32' && u.params[key] < 0) u.params[key] = 0
        }
    })
    const node = paramOwner(doc, id, key)
    if (!(key in (node.params || {}))) throw new ModelError(`'${id}' has no parameter '${key}'`)
    if (type == null) {
        if (node.constants) { delete node.constants[key]; if (!Object.keys(node.constants).length) delete node.constants }
        return node
    }
    // `id` for the messages: a relief's owner is its material's relief, which has none of its own
    const next = { ...node, id, params: { ...node.params }, constants: { ...(node.constants || {}), [key]: type } }
    if (type !== 'f32' && typeof next.params[key] === 'number') next.params[key] = Math.round(next.params[key])
    if (type === 'u32' && next.params[key] < 0) next.params[key] = 0
    const bad = constantProblems(next)
    if (bad.length) throw new ModelError(bad)
    node.params = next.params; node.constants = next.constants
    return node
}

export function remove(doc, id) {
    const { node, parent, index } = must(doc, id)
    if (!parent) throw new ModelError('the root cannot be removed')
    parent.children.splice(index, 1)
    return node
}

/** Refuses while anything uses it, naming the users -- deleting it would leave them pointing
 *  at nothing, which is the old builder's label bug arrived at by another road. And refuses the
 *  last one: a scene keeps at least one material (ensureMaterial), as a project keeps a scene. */
export function removeMaterial(doc, id) {
    const users = []
    // a group giving it to its objects (version 23) uses it too
    walk(doc, n => { if (n.material === id) users.push(n.id) })
    if (users.length) throw new ModelError(`material '${id}' is used by ${users.join(', ')}`)
    const i = doc.materials.findIndex(m => m.id === id)
    if (i < 0) throw new ModelError(`no material '${id}'`)
    if (doc.materials.length === 1) throw new ModelError('a scene keeps at least one material')
    return doc.materials.splice(i, 1)[0]
}

/* A SCENE'S MATERIALS NEVER RUN OUT (the user, 2026-09-30: "make sure scenes always have at least 1
   material (white diffuse)"). A new scene had none, and an object with none is the shader's built-in
   default -- which the Properties dropdown called "(default white)", a material that was never in the
   list and could not be edited. The white is the diffuse preset: 0.8, what that built-in gives, so an
   object that gains it looks as it did.
   NOT IN createDoc: that is also the scratch document of the library's studio, the item editor,
   check-shaders and most tests, which count their materials. Nor in parse, which is also undo's
   format: a step back must give back exactly what was. A scene gets it where it is MADE (project.js
   blankScene) and where it is LOADED (demo.js load). */
export function ensureMaterial(doc) {
    if (!doc.materials.length) addMaterial(doc, { label: 'white', preset: 'diffuse' })
    return doc
}

/** THE SCENE'S DEFAULT: what a new object is made of -- the first SURFACE in its list, so dragging
 *  another to the top makes that one the default. Not a lamp's glow, a detector or a limiter: none is
 *  what a new object should be by accident. Not the stage's either, while a library item is edited
 *  (library/edit.js: its floor's grey). Null when there is none: the object keeps the built-in grey. */
export const defaultMaterial = doc => doc.materials.find(m => typeOf(m) === 'surface'
    && !doc.libraryItem?.stageMaterials?.includes(m.id)) ?? null

/** Every object in `node` without a material (not a light or an export box, which have none) wears
 *  the scene's default. For what the + menu makes and the library's shapes of no size of their own;
 *  a copy of the user's keeps what it had, "none" included. */
export function wearDefault(doc, node) {
    const m = defaultMaterial(doc)
    if (m) walkNode(node, n => {
        if (n.kind === 'object' && n.type !== 'light' && !isBoxType(n.type) && n.material == null) n.material = m.id
    })
    return node
}

/** Move a node under another group, at `index` of that group's children (end if omitted).
 *  The index is into the list AFTER the node has been taken out, so moving within the same
 *  group means what it reads as. */
export function move(doc, id, parentId, index) {
    const { node, parent } = must(doc, id)
    if (!parent) throw new ModelError('the root cannot be moved')
    const target = groupOf(doc, parentId)
    let inside = false
    if (node.kind === 'group') walkNode(node, n => { if (n === target) inside = true })
    if (inside) throw new ModelError(`cannot move '${id}' into itself`)
    const from = parent.children.indexOf(node)
    parent.children.splice(from, 1)
    insert(target.children, node, index)
    // into an array, or an array into a place: a light inside it held to the arrays' rules (copiesProblems)
    const bad = arraysAroundProblems(doc, id)
    if (bad.length) {
        target.children.splice(target.children.indexOf(node), 1)
        parent.children.splice(from, 0, node)
        throw new ModelError(bad)
    }
    return node
}

const walkNode = (node, fn) => {
    fn(node)
    if (node.kind === 'group') for (const c of node.children) walkNode(c, fn)
}

/** A deep copy with fresh ids, placed right after the original. Materials are shared, not
 *  copied: a duplicated object is the same stuff in a second place. */
export function duplicate(doc, id) {
    const { node, parent, index } = must(doc, id)
    if (!parent) throw new ModelError('the root cannot be duplicated')
    const copy = structuredClone(node)
    walkNode(copy, n => { n.id = newId(doc) })
    copy.label = node.label + ' copy'
    parent.children.splice(index + 1, 0, copy)
    return copy
}

/** A copy of a material with a fresh id, right after the original. Nothing uses it yet, so the
 *  shader does not change until something picks it. */
export function duplicateMaterial(doc, id) {
    const i = doc.materials.findIndex(m => m.id === id)
    if (i < 0) throw new ModelError(`no material '${id}'`)
    const copy = { ...structuredClone(doc.materials[i]), id: newId(doc, 'm') }
    copy.label = doc.materials[i].label + ' copy'
    doc.materials.splice(i + 1, 0, copy)
    return copy
}

//----------------------------------------------------------------------------------------------
// Assets -- a subtree or a material, self-contained, to put into this or another document
//----------------------------------------------------------------------------------------------
/* WHY NOT JUST MOVE THE NODE ACROSS. Ids are unique only within a document and a node names its
   material by id, so a node carried into another scene can collide with an id there and name a
   material that does not exist -- or, worse, one that does and is something else. An asset
   carries the materials its subtree uses and the unit its numbers are in; insertAsset gives
   everything fresh ids in the target and rewires the materials. It is BUILDER.md's library
   operation (§4), and the tree's copy, paste and drag between scenes are all this one function.

   A SNAPSHOT, NOT A REFERENCE: extract clones, so a copy taken and then edited at its source
   pastes as it was when copied -- as a clipboard does everywhere else. */

/* WHAT IT NEEDS OF THE SCENE'S FUNCTIONS BLOCK (helpers.js; P3 call 7): the helpers its code reads, and theirs -- as
   `functions` on the asset, only when there are any, so an asset that calls none is what it always was (the library
   compares assets: library/edit.js canon) */
const withHelpers = (doc, asset, codes) => {
    const f = helpersFor(doc.functions ?? '', codes)
    if (f) asset.functions = f
    return asset
}
const materialCodes = m => [m.code ?? '', m.relief?.code ?? '']

/** { kind: 'node', node, materials, blocks, unit, functions? } or { kind: 'material', material, unit, functions? } --
 *  `functions` the helpers of the scene's functions block its code calls, when it calls any. */
export function extractAsset(doc, id) {
    const unit = doc.unit ?? 'm'
    const mat = material(doc, id)
    if (mat) return withHelpers(doc, { kind: 'material', material: structuredClone(mat), unit }, materialCodes(mat))
    const { node, parent } = must(doc, id)
    if (!parent) throw new ModelError('the scene itself is not an asset; duplicate the scene instead')
    const used = new Set(), blocks = []
    /* WHAT IT WEARS, NOT ONLY WHAT IT OWNS (version 23): under a group that gives its objects a material, the copy
       takes that group's material with it -- as its own on a shape that does not keep its own, as the group's own on
       a group that has none -- so it is pasted, dragged to another scene or kept in the library looking as it did.
       Exactly what the group above did: what keeps its own, and a group inside with one of its own, still do. */
    const copy = structuredClone(node)
    const above = materialGroupAbove(doc, id)?.material
    if (above != null && (node.kind === 'group' ? node.material == null : node.ownMaterial !== true && node.type !== 'light' && !isBoxType(node.type)))
        copy.material = above
    walkNode(copy, n => {
        if (n.material != null) used.add(n.material)
        if (n.block != null && !blocks.includes(n.block)) blocks.push(n.block)
    })
    /* its blocks go with it (version 16): an asset is complete, as a file is -- in the order the subtree first uses
       them, which is the order an asset from before 16 gets its blocks in (blocksFromCode): the library compares the
       two (library/edit.js canon) */
    const asset = { kind: 'node', node: copy, unit,
                    materials: structuredClone(doc.materials.filter(m => used.has(m.id))),
                    blocks: structuredClone(blocks.map(id => block(doc, id)).filter(Boolean)) }
    return withHelpers(doc, asset, [...asset.blocks.map(b => b.code ?? ''), ...asset.materials.flatMap(materialCodes)])
}

/* The same material: identical parameters and code, whatever it is called or numbered. The
   label does not count -- a 'glass' that was renamed 'glass copy' on its way in (below) is still
   the glass, and a second paste must find it rather than add a third. */
/** Two materials that differ in nothing but their id and label: the same material. */
export const sameMaterial = (a, b) => {
    // nor its animated flags: which values a scene means to move is not what the stuff is
    const { id: _a, label: _l, animate: _f, ...x } = a, { id: _b, label: _m, animate: _g, ...y } = b
    // the fields in one order: a material upgraded (v18to19) has its new field last, one made since in FIELDS' order
    const canon = o => JSON.stringify({ ...o, params: o.params && Object.fromEntries(Object.entries(o.params).sort(([p], [q]) => p < q ? -1 : p > q ? 1 : 0)) })
    return canon(x) === canon(y)
}

/** A material with every field FIELDS has, those it lacks at their defaults, added after its own: one saved before a
 *  field existed (an upgrade, an asset). A copy; the material's own values untouched. */
export function withFieldDefaults(m) {
    if (!m?.params || typeof m.params !== 'object') return m
    const params = { ...m.params }
    for (const [k, f] of Object.entries(FIELDS)) if (!(k in params)) params[k] = structuredClone(f.def)
    return { ...m, params }
}

/**
 * Put an asset into `doc`. A node goes under `parentId` at `index` (the end if omitted); a
 * material into the list at `index`, `parentId` ignored. Returns the new node or material.
 *
 * Everything gets a fresh id. A node's materials are REUSED where the document already has an
 * identical one (parameters and code; the name may differ) -- copying three spheres of one glass must not make three glasses -- and added
 * otherwise. A material inserted on its own is always a new one: that is what was asked for.
 *
 * THE UNIT: an asset from a metre scene put into a millimetre one keeps its physical size. Its
 * top node's position and scale are converted, which scales everything inside its frame --
 * parameters, children, code -- by the same factor, exactly as the SDF would. NOT A BLEND: a CSG
 * group combines distances already taken to the world (codegen children()), so its blend -- and a
 * child's own join blend -- is a world length no frame scales, and each one is converted here
 * (this comment said blends scaled with the frame until 2026-09-30; model.test).
 * An asset whose unit is NULL has no size of its own: it lands at 1 unit of the scene it goes
 * into, as the + menu makes it -- the library's generic shapes, modifiers and lights. A library
 * sphere made in metres was a metre ball in a millimetre scene, and its noise relief a group at
 * scale 1000, while + made both a millimetre across.
 * Materials have nothing to convert: radiance does not care about the unit (photometry.js), and
 * a material's lengths are real size in its code -- metres() and mm() -- whatever the scene's.
 *
 * AN ASSET SAVED BEFORE VERSION 14 -- a library item, an exported library file, the clipboard, none
 * of which carry a version -- has groups with an op: upgraded here (upgradeJoins) as it goes in.
 *
 * All or nothing: the document is checked afterwards and left exactly as it was if the asset
 * would make it unsound.
 */
export function insertAsset(doc, asset, parentId = 'root', index) {
    /* ITS HELPERS (helpers.js): the ones the scene's functions block lacks are added to it, the ones it has the same are
       its own already. One the scene has DIFFERENTLY is refused, before anything changes: the asset's code would call
       the scene's, which is another shape -- said, never done quietly. Renaming one of the two is the way through. */
    const have = new Map(helpersOf(doc.functions ?? '').map(x => [x.name, x]))
    const bring = helpersOf(asset?.functions ?? '').filter(x => {
        const h = have.get(x.name)
        if (h && !sameHelper(h.text, x.text))
            throw new ModelError(`'${x.name}' in this scene's functions is not the one the pasted code calls: rename one of them first`)
        return !h
    })
    const before = { materials: doc.materials.slice(), blocks: (doc.blocks || []).slice(), nextId: doc.nextId, functions: doc.functions }
    if (bring.length) doc.functions = [String(doc.functions ?? '').replace(/\s+$/, ''), ...bring.map(x => x.text)].filter(Boolean).join('\n\n') + '\n'
    const labels = new Set(doc.materials.map(m => m.label))
    const addMat = (m, index) => {
        const copy = { ...structuredClone(withFieldDefaults(m)), id: newId(doc, 'm') }
        // a second 'glass' in the list could not be told from the first in the panel's dropdown
        if (labels.has(copy.label)) copy.label += ' copy'
        insert(doc.materials, copy, index)
        return copy
    }
    let out, undo = () => { }
    if (asset?.kind === 'material') out = addMat(asset.material, index)
    else if (asset?.kind === 'node') {
        const parent = groupOf(doc, parentId)
        const map = new Map()
        for (const m of asset.materials || []) {
            const same = doc.materials.find(d => sameMaterial(d, withFieldDefaults(m)))
            map.set(m.id, same ? same.id : addMat(m).id)
        }
        /* ITS BLOCKS (version 16): one the scene has already, the same code and schema, is used as it is -- so a
           second paste of a lens is the same lens block, and editing it reaches both, as a duplicate's does -- else
           added, under a name the scene's blocks do not have yet ("lens 2"): the same name with other code beside
           it, never over it, which would change every node already using it */
        const blockMap = new Map(), fresh = []
        doc.blocks ??= []
        for (const b of asset.blocks || []) {
            const same = doc.blocks.find(d => sameBlock(d, b))
            if (same) blockMap.set(b.id, same.id)
            else fresh.push(b)
        }
        const node = upgradeJoins(structuredClone(asset.node))
        walkNode(node, n => {
            n.id = newId(doc)
            if (n.material != null) n.material = map.get(n.material) ?? n.material      // a group's too (version 23)
        })
        // the nodes' ids first, then the new blocks', as an asset from before 16 has them: one order, either way
        for (const b of fresh) {
            const copy = { ...structuredClone(b), id: newId(doc, 'b'), label: freshBlockLabel(doc, b.label ?? 'code') }
            if (copy.builtin && builtinOf(copy) !== copy.builtin) delete copy.builtin
            doc.blocks.push(copy)
            blockMap.set(b.id, copy.id)
        }
        walkNode(node, n => { if (n.block != null) n.block = blockMap.get(n.block) ?? n.block })
        // AN ASSET SAVED BEFORE VERSION 16 -- code on its nodes -- gets its blocks here, as a file of version 15 does
        blocksFromCode(doc, node)
        const k = asset.unit === null ? 1 : (UNITS[asset.unit ?? 'm'] ?? 1) / (UNITS[doc.unit ?? 'm'] ?? 1)
        // to 12 digits, so a metre's 0.3 comes back from millimetres as 0.3 and not 0.30000000000000004
        const conv = v => +(v * k).toPrecision(12)
        if (k !== 1 && node.transform) {
            for (const c of ['x', 'y', 'z']) node.transform.pos[c] = conv(node.transform.pos[c])
            node.transform.scale = conv(node.transform.scale)
        }
        if (k !== 1) walkNode(node, n => {
            if (n.kind === 'group' && Number.isFinite(n.blend)) n.blend = conv(n.blend)
            if (Number.isFinite(n.joinBlend)) n.joinBlend = conv(n.joinBlend)      // a world length too (version 14)
        })
        insert(parent.children, node, index)
        undo = () => parent.children.splice(parent.children.indexOf(node), 1)
        out = node
    } else throw new ModelError(`not an asset (kind '${asset?.kind}')`)
    const bad = validate(doc)
    if (bad.length) {
        undo()
        doc.materials.splice(0, doc.materials.length, ...before.materials)
        doc.blocks = before.blocks
        doc.nextId = before.nextId
        if (before.functions === undefined) delete doc.functions
        else doc.functions = before.functions
        throw new ModelError(bad)
    }
    return out
}

/** Nodes and materials share one id space, so one rename serves both rows of the tree. */
export function rename(doc, id, label) {
    const target = material(doc, id) || must(doc, id).node
    target.label = String(label)
    return doc
}
export function setEnabled(doc, id, enabled) { must(doc, id).node.enabled = !!enabled; return doc }

/* LOCKS (the user, 2026-10-02: "objects could use a 'lock position' and 'lock parameters' option that prevents
   accidental changing position/rotation or object size, scale when in edit mode"). Two, on any node but the root:
     lockPosition  its position and rotation
     lockParams    its parameters' values -- the sizes a stretch cube or a slider changes, a path's or a profile's
                   points -- and its uniform scale
   AGAINST THE HAND, NOT THE PROGRAM. What honours them is what a hand edits through: the gizmo and the Points mode in
   the picture (overlay.js) and the properties panel's rows (panel.js), which show a locked number without a control
   that moves it. A model operation, the parameter registry (the timeline, a script, the command palette) and an undo
   still change a locked node: each is deliberate, and a timeline that stopped at a lock would be a bug of its own.
   Not the renderer's: toTree does not copy them, so a lock compiles nothing and writes no uniform.
   True or absent, as straightMaterial, and no format version: a builder that does not know them loses the lock and
   nothing of the shape. A copy -- duplicated, pasted, put in the library -- keeps them, as it keeps `enabled`. */
export const LOCKS = { position: 'lockPosition', params: 'lockParams' }
/** A node's locks: { position, params }, both false for anything that has none (the root, a material, null). */
export const lockOf = node => ({ position: node?.lockPosition === true, params: node?.lockParams === true })
/** Lock or unlock one of a node's two: `which` is 'position' or 'params'. */
export function setLock(doc, id, which, on) {
    const key = LOCKS[which]
    if (!key) throw new ModelError(`no lock '${which}': it is ${Object.keys(LOCKS).join(' or ')}`)
    const { node, parent } = must(doc, id)
    if (!parent) throw new ModelError('the root has nothing to lock: it is the world frame')
    if (on) node[key] = true
    else delete node[key]
    return doc
}

/* ANIMATED VALUES (the user, 2026-10-08: "the Bake mode could use some uniforms ... any variables that need to be
   animated should be a uniform. Ideally, in the scene tree, properties can be flagged ... and these appear at the top
   of the scene in a list"). A value flagged is one the scene means to move: the bake keeps it a uniform (demo.js
   bakeScene, animate.js), so a timeline playing it does not send the picture back to the editing build; the scene
   row lists it first (panel.js); the Parameters panel and the timeline's + track offer only those while any are
   flagged (lib/shell/params.js onlyAnimated).
   NAMED AS THE PARAMETER REGISTRY NAMES IT (builder/params.js): a path, 'scene/<id>/<rest>', kept on what owns it as
   <rest> -- `animate: ['radius', 'transform/position']` on a node or a material; a material's relief's on the
   material, as '#relief/<parameter>' (a relief's fields are a closed list, reliefProblems: a builder that did not know
   the flag would refuse the whole file, not lose the flag; and setRelief drops them with the relief); the environment's
   on the root, as 'environment/<setting>'; the view's camera and exposure (0.66.0, VIEW above) on the root too, as the
   registry names them, 'view/camera/<setting>' and 'view/exposure/<setting>' -- the renderer's paths (lib/pathtracer/
   params.js), which a saved timeline track names, and which no node id can take (a node `camera` is scene/camera/...).
   Relative, so a copy -- duplicated, pasted, put in the library -- keeps them as it keeps a lock, under its new id.
   As the locks: present or absent, no format version -- a builder that does not know them loses the flag and
   nothing of the shape. What a flag is worth in the shader is the bake's to say (animate.js liveUniformsOf). */
const ANIMATE_PATH = /^scene\/([^/]+)\/(.+)$/
/* THE VIEW'S VALUES a flag can name: the camera's numbers the registry has (lib/pathtracer/params.js settingsParams --
   not its mode, a word, nor its target and position, three numbers at once) and every exposure setting */
const VIEW_FLAG = /^view\/(camera|exposure)\/([^/]+)$/
const CAMERA_FLAGS = ['camtype', 'azimuth', 'elevation', 'distance', 'fov', 'dimensions', 'aperture', 'focus']
/* path -> { owner, key }: where a flag is kept, or null for a path that names nothing of this scene */
function animateSlot(doc, path) {
    const v = VIEW_FLAG.exec(String(path ?? ''))
    if (v) return (v[1] === 'camera' ? CAMERA_FLAGS.includes(v[2]) : v[2] in VIEW_EXPOSURE) ? { owner: doc.root, key: v[0] } : null
    const m = ANIMATE_PATH.exec(String(path ?? ''))
    if (!m) return null
    const [, at, key] = m
    if (at === 'environment') return { owner: doc.root, key: `environment/${key}` }
    const rm = reliefMaterialId(at)
    if (rm != null) { const m = material(doc, rm); return m?.relief ? { owner: m, key: RELIEF_FLAG + key, marks: m.relief } : null }
    const mat = material(doc, at)
    if (mat) return { owner: mat, key }
    const f = find(doc, at)
    return f && f.parent ? { owner: f.node, key } : null
}
const RELIEF_FLAG = '#relief/'
/* WHO HOLDS A PARAMETER'S FLAG, for an edit to that parameter of `id`: a relief, a material, or every node sharing the
   node's block (a schema edit reaches them all: model.js onBlock) -- read before the edit, which may split a block */
function flagOwners(doc, id) {
    const rm = reliefMaterialId(id)
    if (rm != null) { const m = material(doc, rm); return m ? [[m, RELIEF_FLAG]] : [] }
    const mat = material(doc, id)
    if (mat) return [[mat, '']]
    const f = find(doc, id)
    if (!f) return []
    return (schemaNode(doc, id) ? schemaUsers(doc, id) : [f.node]).map(n => [n, ''])
}
const flagsOf = o => Array.isArray(o?.animate) ? o.animate.filter(k => typeof k === 'string') : []
/** Whether the value at registry path `path` is flagged as animated. */
export const isAnimated = (doc, path) => { const s = animateSlot(doc, path); return !!s && flagsOf(s.owner).includes(s.key) }
/** FLAG OR UNFLAG ONE VALUE, by its registry path. A compile-time parameter is refused: it is the shader's text, and
 *  no uniform can carry it -- the bake would recompile at every frame it moved, as the editing build already does. */
export function setAnimated(doc, path, on) {
    const s = animateSlot(doc, path)
    if (!s) throw new ModelError(`'${path}' is not a value of this scene`)
    // a node's markings are its block's (version 16): read through its view
    const marks = s.marks ?? (s.owner.kind === 'group' || s.owner.kind === 'object' ? viewOf(doc, s.owner) : s.owner)
    const name = s.marks ? s.key.slice(RELIEF_FLAG.length) : s.key
    if (on && !name.includes('/') && marks.constants?.[name]) throw new ModelError(`'${s.key}' is compile-time: every change recompiles, so it cannot be animated live`)
    const now = flagsOf(s.owner).filter(k => k !== s.key)
    if (on) now.push(s.key)
    if (now.length) s.owner.animate = now
    else delete s.owner.animate
    return doc
}
/** EVERY FLAGGED PATH, in the order the scene row lists them: the view's, the environment's, the nodes' in tree order,
 *  then the materials' and their reliefs'. A flag naming what is no longer there (a parameter removed by hand in a
 *  file) is listed all the same: the list says so, and unflagging it is how it goes. */
export function animatedPaths(doc) {
    const out = []
    for (const k of flagsOf(doc.root)) if (k.startsWith('view/')) out.push(k)
    for (const k of flagsOf(doc.root)) if (k.startsWith('environment/')) out.push(`scene/${k}`)
    walk(doc, n => { if (n !== doc.root) for (const k of flagsOf(n)) out.push(`scene/${n.id}/${k}`) })
    for (const m of doc.materials) {
        const own = flagsOf(m)
        for (const k of own) if (!k.startsWith(RELIEF_FLAG)) out.push(`scene/${m.id}/${k}`)
        for (const k of own) if (k.startsWith(RELIEF_FLAG)) out.push(`scene/${reliefOwner(m.id)}/${k.slice(RELIEF_FLAG.length)}`)
    }
    return out
}
/* a parameter renamed or removed: its flag follows it, on the owner given ([object, prefix]: flagOwners) */
const renameFlag = ([o, pre], from, to) => { if (Array.isArray(o?.animate)) o.animate = o.animate.map(k => k === pre + from ? pre + to : k) }
const dropFlag = ([o, pre]) => key => {
    if (!Array.isArray(o?.animate)) return
    o.animate = o.animate.filter(k => k !== pre + key)
    if (!o.animate.length) delete o.animate
}

/* DOES THE MATERIAL FOLLOW THE WARP (the user, 2026-09-30: a 3D print's layers twisted with the shape). A
   group's code can bend space -- twist, bend, mirror, repeat -- and everything inside it is evaluated in the
   bent space, its materials too: their colour code's p_local and their relief. `straightMaterial` on a group
   with code lays the materials of everything in it out as if it, and every group inside it, had not bent
   space; the shape still bends (codegen.js, the material frame). Straight from here down: a warp is code, and
   the generator cannot apply an inner group's to a second point. Honoured on a group with code only. */
/**
 * AN ARRAY (version 17): `copies`, a list of transforms ({ pos, rot, scale }, as a node's), each a place in the group's
 * own frame where its children are drawn -- or null to make it a plain group again. A plain group only: no code (its
 * code is the walk of its children, which an array repeats) and no joins among its children (a CSG group combines them
 * into one shape; put that group inside the array). A light inside is drawn once a copy (0.79.0), and then its copies
 * share one scale (copiesProblems). Structural in codegen when the count changes (a uniform each), and live otherwise.
 */
export function setCopies(doc, id, copies) {
    const { node, parent } = must(doc, id)
    if (node.kind !== 'group' || !parent) throw new ModelError(`'${id}' is not a group of the scene: only a group has copies`)
    if (copies == null) { delete node.copies; return node }
    const next = { ...node, copies: structuredClone(copies) }
    const bad = copiesProblems(next, doc)
    if (bad.length) throw new ModelError(bad)
    node.copies = next.copies
    return node
}
/** A row of copies: `n` along `axis` ('x', 'y' or 'z'), `pitch` apart, centred on the group's origin -- a start for the
 *  panel's copies (the rest is typed). */
export const copiesRow = (n, pitch, axis = 'x') => Array.from({ length: n }, (_, i) => {
    const t = identity()
    t.pos[axis] = +((i - (n - 1) / 2) * pitch).toPrecision(12)
    return t
})
/** A ring of copies: `n` turned evenly about `axis` ('x', 'y' or 'z') through the group's origin, `radius` from it -- the
 *  first on +x about z, +y about x, +z about y, each the first turned by its angle (its rotation about that axis alone,
 *  which the transform's x-then-y-then-z angles are exactly). A light in it faces the way the first does, turned with it:
 *  a ring of LEDs as a list of copies (0.79.0), where the circular array is group code and draws no light. */
export const copiesRing = (n, radius, axis = 'z') => Array.from({ length: n }, (_, i) => {
    const t = identity()
    // to 12 digits, and a cosine's 6e-17 at a right angle 0, so a quarter turn of a ring of 4 is on the axis it reads as
    const round = v => Math.abs(v) < 1e-12 * Math.abs(radius) ? 0 : +v.toPrecision(12)
    const a = 2 * Math.PI * i / n, c = round(radius * Math.cos(a)), s = round(radius * Math.sin(a))
    if (axis === 'z') { t.pos.x = c; t.pos.y = s }
    else if (axis === 'x') { t.pos.y = c; t.pos.z = s }
    else { t.pos.z = c; t.pos.x = s }
    t.rot[axis] = +(360 * i / n).toPrecision(12)
    return t
})
/* Everything wrong with a group's copies */
function copiesProblems(n, doc = null) {
    if (n.copies === undefined) return []
    const p = []
    if (!Array.isArray(n.copies) || !n.copies.length) return [`'${n.id}': copies is a list of transforms, at least one`]
    if (n.copies.length > ARRAY_MAX) p.push(`'${n.id}': at most ${ARRAY_MAX} copies (it has ${n.copies.length}): each is a walk of the group at every step`)
    n.copies.forEach((t, i) => {
        const at = { id: `${n.id}' copy '${i + 1}`, transform: t }
        checkTransform(at, p)
    })
    /* a block with no code is a group's parameters alone (version 18: an LED strip's count, its copies bound to it) --
       only code is refused. Without the document to read the block, any block is, as before. */
    if (n.block !== undefined && (!doc || groupHasCode(doc, n)))
        p.push(`'${n.id}': a group with code has no copies (its code is how its children are drawn): put the copies in a group inside it`)
    if (isCsg(n)) p.push(`'${n.id}': a group whose children join (a subtraction, an intersection, a blend) has no copies: put that group inside one that has them`)
    /* A LIGHT INSIDE (0.79.0): drawn once a copy, a face and a source a copy -- if every copy has one scale, which light
       sampling's weight of a face rests on (lights.js A LIGHT INSIDE ARRAYS says why). Refused here, so a light is never
       left out of a picture for it. Not a light under group code below, which is not drawn anyway. The other rule
       there, an array with a light in it inside a group whose children join, is not refused: a join or a blend changed
       anywhere above would make a saved scene unreadable. Such a light is not drawn, and the Optics page says why
       (sources.js skipped), as for one under group code. */
    const s0 = n.copies[0]?.scale ?? 1
    if (n.copies.some(t => (t?.scale ?? 1) !== s0)) {
        let light = null
        const look = x => {
            if (light) return
            if (x !== n && x.kind === 'group' && (doc ? groupHasCode(doc, x) : x.block !== undefined || hasCode(x))) return
            if (x.type === 'light') { light = x.id; return }
            for (const c of x.children || []) look(c)
        }
        look(n)
        if (light) p.push(`'${n.id}': its copies differ in scale and a light is inside ('${light}'): an array with a light in it has one scale for all its copies (light sampling weighs every copy's face by the first's area)`)
    }
    return p
}
/* EVERY ARRAY'S PROBLEMS AROUND A NODE JUST PUT SOMEWHERE (a light added, a node moved): the arrays above it and inside
   it, which are the ones a light coming in can break (copiesProblems) */
function arraysAroundProblems(doc, id) {
    const p = []
    for (let f = find(doc, id); f?.parent; f = find(doc, f.parent.id)) if (f.parent !== doc.root && f.parent.copies) p.push(...copiesProblems(f.parent, doc))
    walkNode(must(doc, id).node, x => { if (x.kind === 'group' && x.copies) p.push(...copiesProblems(x, doc)) })
    return p
}

//----------------------------------------------------------------------------------------------
// COMPONENT PARAMETERS (version 18; builder/bind.js): a node's values bound to the parameters of the groups above it
//----------------------------------------------------------------------------------------------
/* the groups above node `id`, nearest first, the root left out (it has no parameters) */
function above(doc, id) {
    const out = []
    const go = (n, up) => {
        if (n.id === id) { out.push(...up); return true }
        if (n.kind === 'group') for (const c of n.children) if (go(c, n === doc.root ? up : [n, ...up])) return true
        return false
    }
    go(doc.root, [])
    return out
}
/* whether a group can be an array: no code (its block, if any, only parameters) and no joins */
const plainGroup = (doc, n) => n.kind === 'group' && !groupHasCode(doc, n) && !isCsg(n)
/** The values node `id` can bind, in order (bind.js targetsOf). */
export function bindTargets(doc, id) {
    const { node, parent } = must(doc, id)
    return targetsOf(node, { plainGroup: !!parent && plainGroup(doc, node), root: !parent })
}
/* THE LOOKUP A TARGET OF node GETS: the groups above it, nearest first -- and the node's own parameters before them,
   for a group's targets that are not its parameters. Read fresh, so a resolve sees what was just written above. */
const lookupFor = (doc, node, up = above(doc, node.id)) => t => lookupIn([
    ...(node.kind === 'group' && !isParamTarget(t) ? [{ id: node.id, params: node.params || {} }] : []),
    ...up.map(g => ({ id: g.id, params: g.params || {} }))])
/** THE NAMES node `id`'s bindings can read, for the panel's hint: [{ id, label, names, own }] -- each group above with
 *  parameters, nearest first, and a group's own first (`own`: for its placement and copies, not its parameters). */
export function bindNames(doc, id) {
    const { node, parent } = must(doc, id)
    if (!parent) return []
    const out = above(doc, id).filter(g => Object.keys(g.params || {}).length).map(g => ({ id: g.id, label: g.label ?? g.id, names: Object.keys(g.params) }))
    if (node.kind === 'group' && Object.keys(node.params || {}).length) out.unshift({ id: node.id, label: node.label ?? node.id, names: Object.keys(node.params), own: true })
    return out
}
/** Node `id`'s bindings as text, one `target = expression` a line. */
export const bindingsOf = (doc, id) => bindText(must(doc, id).node.bind)
/** Read `text` as node `id`'s bindings without changing anything: { bind, errors: [{ line, col, message }] }. */
export function readBindings(doc, id, text) {
    const { node } = must(doc, id)
    return parseBindings(text, bindTargets(doc, id), lookupFor(doc, node))
}
/**
 * BIND NODE `id`'s VALUES (bind.js): `text`, one `target = expression` a line, replaces all its bindings -- empty text
 * none. Refused, by line and column, if a line does not read, names a value the node does not have or a name no group
 * above has. The values are then resolved through the whole scene: returns resolveBindings's { changed, problems }.
 */
export function setBindings(doc, id, text) {
    const { node, parent } = must(doc, id)
    if (!parent) throw new ModelError('the root has nothing to bind: it is the world frame')
    const r = readBindings(doc, id, text)
    if (r.errors.length) throw new ModelError(r.errors.map(e => `line ${e.line}:${e.col}  ${e.message}`))
    if (Object.keys(r.bind).length) node.bind = r.bind
    else delete node.bind
    return resolveBindings(doc)
}
/**
 * EVERY BINDING'S VALUE WRITTEN, top down (a group's own before its children read its parameters): { changed:
 * [{ id, key }] -- each value that moved, by the key builder/demo.js live() pushes it under -- problems: [message] }. A
 * binding that cannot be resolved keeps the value it had and is a problem: said, never guessed.
 */
export function resolveBindings(doc) {
    const changed = [], problems = []
    const go = (n, up) => {
        if (n.bind && n !== doc.root) {
            const r = applyBindings(n, lookupFor(doc, n, up), { copiesRow, arrayMax: ARRAY_MAX, setLight: lightBound })
            for (const key of r.changed) changed.push({ id: n.id, key })
            problems.push(...r.problems)
        }
        if (n.kind === 'group') for (const c of n.children) go(c, n === doc.root ? up : [n, ...up])
    }
    go(doc.root, [])
    return { changed, problems }
}
/** WHAT HOLDS A NODE'S VALUES, for everything that honours a lock -- the handles in the picture, the panel's rows, the
 *  readout: its own locks (lockOf), and its bindings (bind.js boundOf), which a drag would only fight. `bound` says
 *  which of the two is a binding's. */
export function heldOf(node) {
    const L = lockOf(node), b = boundOf(node)
    return { position: L.position || b.position, params: L.params || b.params, bound: b }
}
/* THE BINDINGS BELOW GROUP g THAT READ ITS PARAMETER `name`: [{ node, target }] -- those whose nearest group above with a
   parameter of that name is g (a nearer one hides it), and g's own non-parameter targets */
function readersOf(doc, g, name) {
    const out = []
    const reads = (n, t) => { const r = parseExpr(n.bind[t]); return !r.error && namesOf(r.ast).some(x => x.name === name) }
    for (const t of Object.keys(g.bind || {})) if (!isParamTarget(t) && t !== 'copies.along' && reads(g, t)) out.push({ node: g, target: t })
    const go = (n, hidden) => {
        for (const t of Object.keys(n.bind || {})) {
            if (t === 'copies.along') continue
            // a group's own parameter of that name hides g's from its placement, not from its parameters
            const own = n.kind === 'group' && !isParamTarget(t) && name in (n.params || {})
            if (!hidden && !own && reads(n, t)) out.push({ node: n, target: t })
        }
        if (n.kind === 'group') for (const c of n.children) go(c, hidden || name in (n.params || {}))
    }
    for (const c of g.children || []) go(c, false)
    return out
}
/** WHAT MOVES WITH GROUP `id`'s PARAMETER `key`, through the bindings: [{ id, key }], each by the key builder/demo.js
 *  live() pushes it under (bind.js liveKeyOf) -- and on, through a group's parameter bound to it, to what that one
 *  moves. For what an animated component parameter keeps a uniform in the bake (animate.js): the parameter itself is
 *  no uniform the shader reads, only what it is bound to. Nothing for an object, a material or a name no one reads. */
export function boundFrom(doc, id, key) {
    const out = [], seen = new Set()
    const go = (g, name) => {
        if (seen.has(`${g.id}\n${name}`)) return
        seen.add(`${g.id}\n${name}`)
        for (const r of readersOf(doc, g, name)) {
            out.push({ id: r.node.id, key: liveKeyOf(r.target) })
            if (r.node.kind === 'group' && isParamTarget(r.target)) go(r.node, r.target.split('.')[0])
        }
    }
    const node = find(doc, id)?.node
    if (node?.kind === 'group') go(node, key)
    return out
}
/* the groups a parameter edit of group `id` reaches: every group using its block (a block's schema is theirs all) */
const schemaUsers = (doc, id) => { const n = must(doc, id).node; const B = blockOf(doc, n); return B && !B.builtin ? usersOf(doc, B.id) : [n] }
/* refused while a binding reads it (removeParam, setParamKind), as a path naming it is */
function notBound(doc, id, key) {
    const { node } = must(doc, id)
    if (node.kind !== 'group') return
    for (const g of schemaUsers(doc, id)) {
        const r = readersOf(doc, g, key)
        if (r.length) throw new ModelError(`'${key}' is read by ${r.map(x => `'${x.node.id}' ${x.target}`).join(', ')}: change ${r.length === 1 ? 'that binding' : 'those bindings'} first`)
    }
}
/* A RENAMED PARAMETER, in the bindings: a group's, in every binding that reads it (refused when a nearer group would
   take the new name instead); and, on every node using the block, a target of that name. Checked now, written by the
   function it returns -- after the rename itself, which may still refuse. */
function renameBound(doc, id, from, to, users) {
    const { node } = must(doc, id)
    const edits = []
    if (node.kind === 'group') for (const g of users) for (const r of readersOf(doc, g, from)) {
        const up = above(doc, r.node.id), between = r.node === g ? [] : up.slice(0, up.indexOf(g))
        const capture = between.find(x => to in (x.params || {})) ?? (r.node.kind === 'group' && r.node !== g && to in (r.node.params || {}) ? r.node : null)
        if (capture) throw new ModelError(`'${r.node.id}' ${r.target} would read '${capture.id}''s '${to}' instead: rename to another name`)
        edits.push(r)
    }
    return () => {
        for (const r of edits) r.node.bind[r.target] = renameIn(r.node.bind[r.target], from, to)
        for (const u of users) if (u.bind) u.bind = Object.fromEntries(Object.entries(u.bind).map(([t, e]) =>
            [t === from ? to : t.startsWith(from + '.') ? to + t.slice(from.length) : t, e]))
    }
}
/* a parameter gone, or of another kind: its targets go with it, on every node using the block */
function dropBound(users, key) {
    for (const u of users) if (u.bind) {
        for (const t of Object.keys(u.bind)) if (t === key || t.startsWith(key + '.')) delete u.bind[t]
        if (!Object.keys(u.bind).length) delete u.bind
    }
}
/* EVERYTHING WRONG WITH A NODE'S BINDINGS that can be known from the file alone: what they are, the targets the node
   has, the expressions read. A name no group above has is not one: moving a node can do that, and resolveBindings says
   so where it happens. */
function bindProblems(doc, n, parent) {
    if (n.bind === undefined) return []
    if (!n.bind || typeof n.bind !== 'object' || Array.isArray(n.bind)) return [`'${n.id}': bind is an object of target: expression`]
    const p = [], targets = targetsOf(n, { plainGroup: !!parent && plainGroup(doc, n), root: !parent })
    p.push(...bindingsProblems(n.bind).map(m => `'${n.id}': bind: ${m}`))
    for (const [t, e] of Object.entries(n.bind)) {
        if (typeof e !== 'string') { p.push(`'${n.id}': bind ${t} is not an expression`); continue }
        if (!targets.includes(t)) { p.push(`'${n.id}': bind ${t} is not one of its values`); continue }
        if (t === 'copies.along') { if (!['x', 'y', 'z'].includes(e)) p.push(`'${n.id}': copies.along is x, y or z`); continue }
        const r = parseExpr(e)
        if (r.error) p.push(`'${n.id}': bind ${t}: ${r.error} at column ${r.at}`)
    }
    return p
}

export function setStraightMaterial(doc, id, on) {
    const { node } = must(doc, id)
    if (node.kind !== 'group') throw new ModelError(`'${id}' is not a group; only a group's code bends space`)
    if (on) node.straightMaterial = true
    else delete node.straightMaterial
    return doc
}

/* THE PATTERN FRAME (version 24; codegen.js THE PATTERN FRAME): where a node's material lays its pattern out, in the
   node's own frame -- the pattern moved by `pos` and turned by `rot` (degrees about x, then y, then z, as a transform's),
   the shape not. */
/** The pattern frame that changes nothing: the object's own. */
export const patternIdentity = () => ({ pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } })
/** Whether a node can hold one: an object that wears a material (not a light or a box), or a group -- whose frame is
 *  where its children's material is read when it folds them as one shape (patternOwner), and nothing for a plain one. */
export const canPattern = n => n?.kind === 'group' || (n?.kind === 'object' && n.type !== 'light' && !isBoxType(n.type))
/** Set node `id`'s pattern frame ({ pos, rot }, copied), or take it away (null): the object's own frame again. Having
 *  one or not is the shader's text (a compile); its values after that are a uniform (live). */
export function setPattern(doc, id, pattern) {
    const { node, parent } = must(doc, id)
    if (pattern == null) { delete node.pattern; return node }
    const next = { ...node, pattern: structuredClone(pattern) }
    const bad = patternProblems(next, !parent)
    if (bad.length) throw new ModelError(bad)
    node.pattern = next.pattern
    return node
}
/** WHOSE PATTERN FRAME A NODE'S MATERIAL IS READ IN: the node's own -- or, inside a group that folds its children into
 *  the scene as one shape, the outermost such group's, since a material's point is the frame of what folds into the
 *  scene (codegen emitMaterials: a CSG shape's is its group's; scene_api.js fold, XF_SUB): a CSG group, or group code
 *  that works on its children's result (codegen isAfter: a round, a shell). A plain group folds nothing of its own:
 *  null for one. The panel says which, so a frame that would change nothing is never offered silently. */
export function patternOwner(doc, id) {
    let chain = null                                          // the root first, the node last
    const go = (n, up) => { if (chain) return; if (n.id === id) { chain = [...up, n]; return } for (const c of n.children || []) go(c, [...up, n]) }
    go(doc.root, [])
    if (!chain) return null
    const outer = chain.slice(0, -1).find(g => g !== doc.root && foldsAsOne(doc, g))
    if (outer) return outer.id
    const node = chain[chain.length - 1]
    return node !== doc.root && canPattern(node) && (node.kind === 'object' || foldsAsOne(doc, node)) ? node.id : null
}
/** Whether a group folds its children into the scene as one shape (patternOwner): a CSG group, or group code that works
 *  on its children's result (codegen isAfter: a round, a shell). Its pattern frame is where their material is read. */
export const foldsAsOne = (doc, g) => g?.kind === 'group'
    && (isCsg(g) || isAfter({ kind: 'group', code: codeOf(doc, g), params: g.params }, { straight: false }))

/** A material's type (version 10): surface, emitter, detector or limiter. Surface removes the field.
 *  The parameters stay as they are, so switching back loses nothing; codegen reads only the ones
 *  the type uses (materials.js FIELDS_OF). */
export function setMaterialType(doc, id, type) {
    const m = material(doc, id)
    if (!m) throw new ModelError(`no material '${id}'`)
    if (!MATERIAL_TYPES.includes(type)) throw new ModelError(`material type must be one of ${MATERIAL_TYPES.join(', ')}`)
    if (type === 'surface') delete m.type
    else m.type = type
    // an emitter with no light is a black surface that ends every path: give it the preset's glow
    if (type === 'emitter' && !(m.params.emissiveLuminance > 0)) m.params.emissiveLuminance = 1000
    return doc
}

/** A LIGHT (version 10, lights.js): a rectangle, a disc or a ray file, with its size as parameters
 *  and its settings in `light`. */
export function addLight(doc, parentId, { shape = 'rectangle', id, label, transform, params, ...settings } = {}, index) {
    const parent = groupOf(doc, parentId)
    const S = LIGHT_SHAPES[shape]
    if (!S) throw new ModelError(`unknown light shape '${shape}' (one of ${Object.keys(LIGHT_SHAPES).join(', ')})`)
    const node = {
        id: checkNewId(doc, id), kind: 'object', type: 'light', label: label ?? S.label, enabled: true,
        transform: structuredClone(transform ?? identity()), material: null,
        params: { ...S.params, ...structuredClone(params ?? {}) },
        light: { shape, ...(shape === 'rayfile' ? { file: '' } : {}), ...structuredClone(settings) },
    }
    const bad = lightProblems(node)
    if (bad.length) throw new ModelError(bad)
    insert(parent.children, node, index)
    // into an array: held to its rules (copiesProblems)
    const around = arraysAroundProblems(doc, node.id)
    if (around.length) { parent.children.splice(parent.children.indexOf(node), 1); throw new ModelError(around) }
    return node
}
/** Change a light's settings: `patch` over what it has. A setting at its default is dropped (flux
 *  null is the luminance's), so a plain light saves small. The shape does not change. */
export function setLight(doc, id, patch) {
    const { node } = must(doc, id)
    if (node.type !== 'light') throw new ModelError(`'${id}' is not a light`)
    const { next, bad } = lightPatched(node, patch)
    if (bad.length) throw new ModelError(bad)
    node.light = next
    return doc
}
/* A LIGHT'S SETTINGS WITH `patch` OVER THEM, as stored (a setting at its default dropped) and checked: { next, bad } */
function lightPatched(node, patch) {
    const next = { ...node.light, ...structuredClone(patch), shape: node.light.shape }
    for (const [k, v] of Object.entries(next))
        if (v === undefined || (k in LIGHT_DEFAULTS && JSON.stringify(v) === JSON.stringify(LIGHT_DEFAULTS[k]))) delete next[k]
    return { next, bad: lightProblems({ ...node, light: next }) }
}
/* ...FOR A BINDING (bind.js applyBindings, 0.69.0): an object's components over what the light has now (a colour's r alone,
   an xy's x), its defaults filled in -- written when sound, refused with why when not: { changed, problems } */
function lightBound(node, patch) {
    const L = lightOf(node), full = {}
    for (const [k, v] of Object.entries(patch)) full[k] = v && typeof v === 'object' ? { ...L[k], ...v } : v
    const { next, bad } = lightPatched(node, full)
    if (bad.length) return { changed: false, problems: bad }
    const changed = JSON.stringify(next) !== JSON.stringify(node.light)
    node.light = next
    return { changed, problems: [] }
}

/** AN EXPORT BOX (exportbox.js): the part of the scene a 3MF or STL export takes. Draws nothing.
 *  `size` its edges in its own frame; `settings` over EXPORT_DEFAULTS (cell mm, colours). */
export function addExportBox(doc, parentId, { id, label, transform, size, ...settings } = {}, index) {
    const parent = groupOf(doc, parentId)
    const node = {
        id: checkNewId(doc, id), kind: 'object', type: 'export', label: label ?? 'export box', enabled: true,
        transform: structuredClone(transform ?? identity()), material: null,
        params: { size: { ...EXPORT_PARAMS.size, ...(size || {}) } },
    }
    if (Object.keys(settings).length) node.export = structuredClone(settings)
    const bad = exportProblems(node)
    if (bad.length) throw new ModelError(bad)
    insert(parent.children, node, index)
    return node
}
/** Change an export box's settings: `patch` over what it has; a setting at its default is dropped. */
export function setExport(doc, id, patch) {
    const { node } = must(doc, id)
    if (node.type !== 'export') throw new ModelError(`'${id}' is not an export box`)
    const next = { ...(node.export || {}), ...structuredClone(patch) }
    for (const [k, v] of Object.entries(next)) if (v === undefined || v === EXPORT_DEFAULTS[k]) delete next[k]
    const bad = exportProblems({ ...node, export: next })
    if (bad.length) throw new ModelError(bad)
    if (Object.keys(next).length) node.export = next
    else delete node.export
    return doc
}

/** A HAZE BOX (hazebox.js, version 22): dust in the air inside it, for the renderer (core/haze.js). Draws nothing.
 *  `size` its edges in its own frame; `settings` over HAZE_DEFAULTS (mfp m, albedo {r, g, b}, g). One a scene. */
export function addHazeBox(doc, parentId, { id, label, transform, size, ...settings } = {}, index) {
    const parent = groupOf(doc, parentId)
    if (hazeNode(doc)) throw new ModelError(`this scene has a haze box already ('${hazeNode(doc).id}'): one a scene`)
    const node = {
        id: checkNewId(doc, id), kind: 'object', type: 'haze', label: label ?? 'haze box', enabled: true,
        transform: structuredClone(transform ?? identity()), material: null,
        params: { size: { ...HAZE_PARAMS.size, ...(size || {}) } },
    }
    if (Object.keys(settings).length) node.haze = structuredClone(settings)
    const bad = hazeProblems(node)
    if (bad.length) throw new ModelError(bad)
    insert(parent.children, node, index)
    return node
}
/** Change a haze box's settings: `patch` over what it has; a setting at its default is dropped. */
export function setHaze(doc, id, patch) {
    const { node } = must(doc, id)
    if (node.type !== 'haze') throw new ModelError(`'${id}' is not a haze box`)
    const next = { ...(node.haze || {}), ...structuredClone(patch) }
    for (const [k, v] of Object.entries(next))
        if (v === undefined || JSON.stringify(v) === JSON.stringify(HAZE_DEFAULTS[k])) delete next[k]
    const bad = hazeProblems({ ...node, haze: next })
    if (bad.length) throw new ModelError(bad)
    if (Object.keys(next).length) node.haze = next
    else delete node.haze
    return doc
}

/*======================================================================================================================
  THE ENVIRONMENT -- the sun and sky, or the studio light -- is the scene's (UI_PLAN.md section 8): a room
  keeps its sun. It was a renderer setting saved with the workspace, so a scene opened on its own came
  back under whatever sky the last one left, and two scenes in a project could not have their own.

  `doc.environment` holds the renderer's own settings for it, by the renderer's names -- the Lighting
  group of lib/pathtracer/core/uniforms.schema.js, the ones with a control -- so there is no second
  vocabulary to translate: the builder hands them to RT.set as they are. OPTIONAL: a scene without one
  shows whatever the renderer has (every scene saved before this), and gets one the first time its
  environment is edited, then with every setting, so it no longer depends on what came before.

  No version change: validate() passes a top-level key it does not know through untouched, and
  serialize() writes the whole document, so a builder of this same version that predates the field
  carries it along rather than dropping it -- it just does not apply it. A version bump would also have
  collided with the optics branch's 11 to 13, which upgrade() tells apart by content.

  THE RADIUS LEFT IT in version 15 (envRadius below): it is no Lighting setting any more but the scene's
  own, in its own unit, so ENVIRONMENT -- built from that group -- no longer has it.
======================================================================================================================*/
/** Each environment setting's schema entry, by its uniform name: only the ones with a control. */
export const ENVIRONMENT = Object.freeze(Object.fromEntries(Object.entries(UniformGroups.Lighting).filter(([, sp]) => sp.gui)))
/** The tree's row for it, and the panel's id for it: never a node id (ids are letters and digits). */
export const ENVIRONMENT_ID = '#environment'

function environmentProblems(env) {
    if (!env || typeof env !== 'object' || Array.isArray(env)) return ['environment must be an object']
    const p = []
    for (const [k, v] of Object.entries(env)) {
        const sp = ENVIRONMENT[k]
        if (!sp) { p.push(`environment.${k}: not an environment setting`); continue }
        if (String(sp.type).startsWith('vec3')) {
            if (!(v && typeof v === 'object' && ['r', 'g', 'b'].every(c => Number.isFinite(v[c]) && v[c] >= 0))) p.push(`environment.${k} must be {r, g, b}, each >= 0`)
            continue
        }
        if (!Number.isFinite(v)) { p.push(`environment.${k} must be a number`); continue }
        const g = sp.gui
        if (g.options && !Object.values(g.options).includes(v)) p.push(`environment.${k} must be one of ${Object.values(g.options).join(', ')}`)
        else if ((g.min !== undefined && v < g.min) || (g.max !== undefined && v > g.max)) p.push(`environment.${k} must be within ${g.min ?? '-∞'} .. ${g.max ?? '∞'}`)
    }
    return p
}
/* THE SCENE'S RADIUS (version 15): where it stops and the environment begins -- a ray beyond it, heading out,
   has left and sees the sky; anything placed beyond it is invisible; the sun's photons start on it (uniforms.schema.js
   DERIVED envRadius). IN THE SCENE'S UNIT, as every length in the document is, so changing the unit reinterprets it
   with the geometry rather than leaving a 25 cm world around a model just made a hundred times bigger. OPTIONAL:
   absent is the renderer's 400 m in ANY unit -- what every scene had before (photometry.js ENV_RADIUS_DEFAULT_M) --
   so a document that never set one, and every createDoc a test or a bench makes, means what it always did. */
/* a length converted between units, kept to twelve significant digits: 0.3 / 0.1 is 2.9999999999999996 */
const inUnit = (metres, unit) => Number((metres / (UNITS[unit] ?? 1)).toPrecision(12))
/** The radius the scene has, in its unit: its own, or the 400 m default said in that unit (what the panel shows). */
export const envRadiusOf = doc => doc.envRadius ?? inUnit(ENV_RADIUS_DEFAULT_M, doc.unit ?? 'm')
const envRadiusProblems = v => Number.isFinite(v) && v > 0 ? [] : ['envRadius must be a number > 0 (in the scene\'s unit)']
/** Set the scene's radius, in its unit; null or undefined takes it back to the default. Checked first. */
export function setEnvRadius(doc, v) {
    if (v == null) { delete doc.envRadius; return doc }
    const bad = envRadiusProblems(v)
    if (bad.length) throw new ModelError(bad)
    doc.envRadius = v
    return doc
}

/** The scene's environment with `values` over it -- checked first, so a refusal changes nothing. */
export function setEnvironment(doc, values) {
    const next = { ...(doc.environment || {}), ...structuredClone(values) }
    const bad = environmentProblems(next)
    if (bad.length) throw new ModelError(bad)
    doc.environment = next
    return doc
}
/** THE WHOLE ENVIRONMENT a scene that has one is shown under: its own settings over the defaults (0.66.0). The bundled
 *  examples name three settings each (scenes/make.mjs SUN, STUDIO), and the builder pushed only what a scene named, so
 *  the sun's and the sky's illuminance, the sun's size, the turbidity and the studio's colour were whatever the scene
 *  shown before had left -- the same carry-over as the camera's (VIEW below). A scene without one is null: it still
 *  shows what the renderer has, as every scene saved before 0.52.0 did. */
export const environmentOf = doc => doc.environment
    ? { ...Object.fromEntries(Object.entries(ENVIRONMENT).map(([k, sp]) => [k, structuredClone(sp.def)])), ...structuredClone(doc.environment) }
    : null

/*======================================================================================================================
  THE VIEW -- how the scene is looked at: its camera and its exposure (0.66.0; the user, 2026-10-17: "Camera settings
  and exposure can vary per scene ... the information should belong to the scenes. Because switching between scenes
  almost always causes the camera and exposure to be wrong").

  `doc.view = { camera, exposure }`. The controls stay the view's (the camera and exposure popovers over the picture,
  and the scene row's folders); the values are the scene's, saved with it, so a scene file, an example, a duplicate and
  a scene copied to another project each come with the way it is seen. Until 0.66.0 the builder kept a camera per
  scene beside the documents (demo.js) -- saved only in a workspace and the browser's project, with no exposure at
  all -- and put back only the fields it had: an example's camera has no field of view, so it kept the last scene's.

  WHOLE WHEN READ (sceneViewOf): whatever a scene leaves out is the default, never what the scene before had. The camera's
  defaults are the page's start (app.html Q: 20 units off, the 40 degree field), the exposure's the schema's.

  NOT AN EDIT (demo.js): looking is not editing, so a camera moved or an exposure changed is no undo step, and the
  history's snapshots leave the view out (project.js historyText). Lengths are the scene's unit, as every length here.

  No version change, as the environment's (above): a builder of 22 that predates it carries it along unread.
======================================================================================================================*/
/** Each exposure setting's schema entry, by its uniform name: the Exposure group's, the ones with a control. */
export const VIEW_EXPOSURE = Object.freeze(Object.fromEntries(Object.entries(UniformGroups.Exposure).filter(([, sp]) => sp.gui)))
/** A camera's settings and what each may be: lib/camera.js get() and RT.applySettings name them so. pos and up are a
 *  free (fps) camera's; an orbit is its target, azimuth, elevation and distance. */
const pt3 = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)
export const VIEW_CAMERA = Object.freeze({
    mode: v => v === 'orbit' || v === 'fps' || 'must be orbit or fps',
    camtype: v => v === 0 || v === 1 || 'must be 0 (perspective) or 1 (orthographic)',
    fov: v => (Number.isFinite(v) && v > 0 && v < 180) || 'must be a number of degrees between 0 and 180',
    dimensions: v => (Number.isFinite(v) && v > 0) || 'must be a number > 0 (the parallel view\'s width)',
    target: v => pt3(v) || 'must be [x, y, z]',
    azimuth: v => Number.isFinite(v) || 'must be a number (degrees)',
    elevation: v => Number.isFinite(v) || 'must be a number (degrees from straight up)',
    distance: v => (Number.isFinite(v) && v > 0) || 'must be a number > 0',
    pos: v => pt3(v) || 'must be [x, y, z]',
    up: v => pt3(v) || 'must be [x, y, z]',
    aperture: v => (Number.isFinite(v) && v >= 0) || 'must be a number >= 0 (0 a pinhole)',
    focus: v => (Number.isFinite(v) && v >= 0) || 'must be a number >= 0 (0 the target\'s distance)',
})
/* THE CAMERA A SCENE LEAVING ONE OUT HAS: the page's start (app.html Q, and the renderer's up), a pinhole */
export const CAMERA_DEFAULTS = Object.freeze({ mode: 'orbit', camtype: 0, fov: 40, dimensions: 10, target: [0, 0, 0],
    azimuth: 40, elevation: 70, distance: 20, up: [0, 0, 1], aperture: 0, focus: 0 })
/* the camera's lengths: what a unit's change, or a camera from a scene in another unit, scales */
export const CAMERA_LENGTHS = Object.freeze(['dimensions', 'target', 'distance', 'pos', 'aperture', 'focus'])

function viewProblems(view) {
    if (!view || typeof view !== 'object' || Array.isArray(view)) return ['view must be an object']
    const p = []
    for (const k of Object.keys(view)) if (k !== 'camera' && k !== 'exposure') p.push(`view.${k}: not part of a view (camera, exposure)`)
    const c = view.camera
    if (c !== undefined) {
        if (!c || typeof c !== 'object' || Array.isArray(c)) p.push('view.camera must be an object')
        else for (const [k, v] of Object.entries(c)) {
            const check = VIEW_CAMERA[k]
            if (!check) { p.push(`view.camera.${k}: not a camera setting`); continue }
            const ok = check(v)
            if (ok !== true) p.push(`view.camera.${k} ${ok}`)
        }
    }
    const e = view.exposure
    if (e !== undefined) {
        if (!e || typeof e !== 'object' || Array.isArray(e)) p.push('view.exposure must be an object')
        else for (const [k, v] of Object.entries(e)) {
            const sp = VIEW_EXPOSURE[k]
            if (!sp) { p.push(`view.exposure.${k}: not an exposure setting`); continue }
            if (!Number.isFinite(v)) { p.push(`view.exposure.${k} must be a number`); continue }
            const g = sp.gui
            if (g.options && !Object.values(g.options).includes(v)) p.push(`view.exposure.${k} must be one of ${Object.values(g.options).join(', ')}`)
            else if ((g.min !== undefined && v < g.min) || (g.max !== undefined && v > g.max)) p.push(`view.exposure.${k} must be within ${g.min ?? '-∞'} .. ${g.max ?? '∞'}`)
        }
    }
    return p
}
/** A camera with only the settings VIEW_CAMERA knows, copied: what the renderer's camera hands out has more (its
 *  aspect, its near and far planes), which are the canvas's and the renderer's, not the scene's. */
export const cameraSettings = c => c && typeof c === 'object'
    ? Object.fromEntries(Object.keys(VIEW_CAMERA).filter(k => c[k] !== undefined).map(k => [k, structuredClone(c[k])])) : null
/** An exposure with only the Exposure group's settings, copied (RT.get() hands out every setting at once). */
export const exposureSettings = e => e && typeof e === 'object'
    ? Object.fromEntries(Object.keys(VIEW_EXPOSURE).filter(k => e[k] !== undefined).map(k => [k, e[k]])) : null
/**
 * THE VIEW A SCENE IS SHOWN WITH, whole: { camera, exposure }. The camera is the scene's with every setting it leaves
 * out at CAMERA_DEFAULTS -- or null for a scene that has none, which the builder shows from the camera there is,
 * converted to its unit (demo.js). The exposure is always whole: the scene's over the schema's defaults.
 */
export function sceneViewOf(doc) {
    const c = doc?.view?.camera
    const camera = c ? { ...structuredClone(CAMERA_DEFAULTS), ...cameraSettings(c) } : null
    const exposure = { ...Object.fromEntries(Object.entries(VIEW_EXPOSURE).map(([k, sp]) => [k, sp.def])), ...exposureSettings(doc?.view?.exposure) }
    return { camera, exposure }
}
/** Set the scene's view: `camera` and `exposure` each over what it has, checked first (a refusal changes nothing).
 *  Only the settings each knows are kept; null for either takes it away. */
export function setView(doc, { camera, exposure } = {}) {
    const next = structuredClone(doc.view || {})
    if (camera === null) delete next.camera
    else if (camera !== undefined) next.camera = { ...(next.camera || {}), ...cameraSettings(camera) }
    if (exposure === null) delete next.exposure
    else if (exposure !== undefined) next.exposure = { ...(next.exposure || {}), ...exposureSettings(exposure) }
    const bad = viewProblems(next)
    if (bad.length) throw new ModelError(bad)
    if (Object.keys(next).length) doc.view = next
    else delete doc.view
    return doc
}
/** A camera's lengths said in another unit: one kept by a scene in `from` seen from a scene in `to`, the same place in
 *  metres. 330 mm stays 0.33 m, rather than becoming 330 m. */
export function cameraInUnit(camera, from, to) {
    if (!camera) return camera
    const f = (UNITS[from] ?? 1) / (UNITS[to] ?? 1)
    const out = structuredClone(camera)
    if (f === 1) return out
    const s = v => Number((v * f).toPrecision(12))
    for (const k of CAMERA_LENGTHS) if (out[k] !== undefined) out[k] = Array.isArray(out[k]) ? out[k].map(s) : s(out[k])
    return out
}

/*======================================================================================================================
  THE TIMELINE -- how the scene moves: the Timeline panel's keys and the film it records (0.67.0; the user, 2026-10-17:
  "make the settings for the animation timeline part of a scene").

  `doc.timeline = { fps, duration, tracks, export }`: the `timeline` of lib/timeline's own file (timeline.js toJSON),
  and of its export settings the film's (TIMELINE_FILM): its size, samples, range and name. The encoder's -- format,
  bitrate, written to disk as it goes -- are the person's, not the scene's, and stay in the browser (tools/timeline.js).

  WHY THE SCENE'S. Until 0.67.0 one timeline was the page's, in the browser's storage, whatever scene was shown:
  - a track names what it moves by its registry path, and a node's is its id (builder/params.js), which is unique
    only within its document (newId: n1, n2 ... in every scene). A track on one scene's n4 found another scene's n4
    with a parameter of the same name and moved it (read in code: tools/timeline.js liveRegistry asks only whether
    the path is there);
  - a camera's lengths are in the scene's unit (CAMERA_LENGTHS): a distance keyed at 20 was 20 mm in one scene, 20 m in
    the next;
  - which values are animated (setAnimated) was already the scene's, and the keys that go with them were not.

  WHOLE WHEN READ (sceneTimelineOf): what a scene leaves out is the default, never the last scene's. lib/timeline's
  load keeps the fps, the duration and any export setting a file does not name (timeline.js fromJSON `o.fps > 0`,
  sequencer.js load `k in obj.export`), so a scene handed over as it is would get the scene before's -- the camera's
  carry-over of 0.66.0 again.

  NOT AN UNDO STEP, as the view is not (project.js OUTSIDE_HISTORY): the timeline has never had an undo, and a
  snapshot of the whole project at every key dragged would cost what an edit costs for nothing anyone asked for. But
  SAVED as an edit is (demo.js keepTimeline): keys are work, so a timeline changed is written with the project within
  the second, and a second tab's copy is made by it (workspace/autosave.js).

  A TRACK ON A PATH THE SCENE DOES NOT HAVE IS KEPT, as lib/timeline keeps it ("(unknown)" in its header): a node
  deleted and brought back by an undo has its track again.

  No version change, as the view's and the environment's: a builder of 22 that predates it carries it along unread.
======================================================================================================================*/
/** The film's settings a scene keeps, and what each may be: lib/timeline's export settings (sequencer.js S), as its
 *  export menu sets them (export-ui.js). */
export const TIMELINE_FILM = Object.freeze({
    width: v => (Number.isInteger(v) && v >= 1) || 'must be a whole number of pixels >= 1',
    height: v => (Number.isInteger(v) && v >= 1) || 'must be a whole number of pixels >= 1',
    samples: v => (Number.isInteger(v) && v >= 1) || 'must be a whole number >= 1 (renders a frame)',
    from: v => (Number.isFinite(v) && v >= 0) || 'must be a number of seconds >= 0',
    to: v => (Number.isFinite(v) && v >= 0) || 'must be a number of seconds >= 0 (0 the whole duration)',
    filename: v => typeof v === 'string' || 'must be text',
})
/* THE TIMELINE A SCENE LEAVING ONE OUT HAS: what the panel started with before it was the scene's (tools/timeline.js
   until 0.67.0), and lib/timeline's own range of 0 to 0, the whole duration */
export const TIMELINE_DEFAULTS = Object.freeze({ fps: 30, duration: 8, tracks: Object.freeze([]),
    export: Object.freeze({ width: 1920, height: 1080, samples: 64, from: 0, to: 0, filename: 'raytracer' }) })

const keyValue = v => Number.isFinite(v) || (Array.isArray(v) && v.length > 0 && v.every(Number.isFinite))
function timelineProblems(t) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) return ['timeline must be an object']
    const p = []
    for (const k of Object.keys(t)) if (!['fps', 'duration', 'tracks', 'export'].includes(k)) p.push(`timeline.${k}: not part of a timeline (fps, duration, tracks, export)`)
    if (t.fps !== undefined && !(Number.isFinite(t.fps) && t.fps > 0)) p.push('timeline.fps must be a number > 0 (frames a second)')
    if (t.duration !== undefined && !(Number.isFinite(t.duration) && t.duration > 0)) p.push('timeline.duration must be a number > 0 (seconds)')
    if (t.tracks !== undefined) {
        if (!Array.isArray(t.tracks)) p.push('timeline.tracks must be a list')
        else {
            const seen = new Set()
            t.tracks.forEach((k, i) => {
                const at = `timeline.tracks[${i}]`
                if (!k || typeof k !== 'object' || Array.isArray(k)) { p.push(`${at} must be an object`); return }
                if (typeof k.prop !== 'string' || !k.prop) p.push(`${at}.prop must be a parameter's path`)
                else if (seen.has(k.prop)) p.push(`${at}: a second track on '${k.prop}' (one a parameter)`)
                else seen.add(k.prop)
                if (!INTERPS.includes(k.interp)) p.push(`${at}.interp must be one of ${INTERPS.join(', ')}`)
                if (!Array.isArray(k.keys)) { p.push(`${at}.keys must be a list`); return }
                k.keys.forEach((x, j) => {
                    if (!x || typeof x !== 'object' || Array.isArray(x)) { p.push(`${at}.keys[${j}] must be an object`); return }
                    if (!(Number.isFinite(x.t) && x.t >= 0)) p.push(`${at}.keys[${j}].t must be a number of seconds >= 0`)
                    if (!keyValue(x.v)) p.push(`${at}.keys[${j}].v must be a number or a list of numbers`)
                    if (x.ease != null && !EASES.includes(x.ease)) p.push(`${at}.keys[${j}].ease must be one of ${EASES.join(', ')}`)
                })
            })
        }
    }
    const e = t.export
    if (e !== undefined) {
        if (!e || typeof e !== 'object' || Array.isArray(e)) p.push('timeline.export must be an object')
        else for (const [k, v] of Object.entries(e)) {
            const check = TIMELINE_FILM[k]
            if (!check) { p.push(`timeline.export.${k}: not a setting of the film (${Object.keys(TIMELINE_FILM).join(', ')})`); continue }
            const ok = check(v)
            if (ok !== true) p.push(`timeline.export.${k} ${ok}`)
        }
    }
    return p
}
/** The film's settings of an export's, copied: lib/timeline's hold the encoder's too (format, bitrate, stream). */
export const filmSettings = e => e && typeof e === 'object'
    ? Object.fromEntries(Object.keys(TIMELINE_FILM).filter(k => e[k] !== undefined).map(k => [k, e[k]])) : null
/** THE TIMELINE A SCENE IS SHOWN WITH, whole: its own over TIMELINE_DEFAULTS, the film's settings each over theirs. A
 *  copy: what the panel does to it is not the scene's until it is kept (setTimeline). */
export function sceneTimelineOf(doc) {
    const t = doc?.timeline ?? {}
    return { fps: t.fps ?? TIMELINE_DEFAULTS.fps, duration: t.duration ?? TIMELINE_DEFAULTS.duration,
             tracks: structuredClone(t.tracks ?? []), export: { ...TIMELINE_DEFAULTS.export, ...filmSettings(t.export) } }
}
/** Set the scene's timeline, WHOLE (the panel hands over all of it at every change): its fps, duration and tracks as
 *  given, and of its export settings the film's. Checked first: a refusal changes nothing. Null takes it away. */
export function setTimeline(doc, t) {
    if (t == null) { delete doc.timeline; return doc }
    if (!t || typeof t !== 'object' || Array.isArray(t)) throw new ModelError(['timeline must be an object'])
    const next = {}
    for (const k of ['fps', 'duration', 'tracks']) if (t[k] !== undefined) next[k] = structuredClone(t[k])
    const film = filmSettings(t.export)
    if (film && Object.keys(film).length) next.export = film
    const bad = timelineProblems(next)
    if (bad.length) throw new ModelError(bad)
    doc.timeline = next
    return doc
}

/*======================================================================================================================
  THE SCENE'S SURFACE TOLERANCE (0.66.0): how close a ray must come to a surface to have hit it, in the scene's unit,
  0 or absent the renderer's automatic one (a share of the scene's size: lib/pathtracer/core/photometry.js autoEps).
  It was a renderer setting in metres, one for every scene: a value typed for a 25 cm optic was the one a 4 m room, an
  example and a library item were traced with. It is a property of the scene's geometry -- a 10 um gap between a
  liquid and its glass, a 1 mm reflector wall -- so it is saved with the scene, and an edit to it is an undo step,
  as the radius is. The renderer takes it as its `eps`, in metres (demo.js sceneSelf, index.js updateScene).
======================================================================================================================*/
const toleranceProblems = v => Number.isFinite(v) && v >= 0 ? [] : ['tolerance must be a number >= 0 (in the scene\'s unit; 0 = automatic)']
/** The tolerance the scene sets, in its unit; 0 for the automatic one. */
export const toleranceOf = doc => doc.tolerance ?? 0
/** Set the scene's tolerance, in its unit; 0, null or undefined is the automatic one. Checked first. */
export function setTolerance(doc, v) {
    if (v == null || v === 0) { delete doc.tolerance; return doc }
    const bad = toleranceProblems(v)
    if (bad.length) throw new ModelError(bad)
    doc.tolerance = v
    return doc
}

/** HIDING WITHOUT RECOMPILING (codegen's liveVisibility), saved with the scene: every node stays in the
 *  shader behind a uniform, so the eye in the tree is a uniform written. Off by default: the shader then
 *  has only what is shown, and nothing is evaluated for what is not. */
export function setLiveVisibility(doc, on) {
    if (on) doc.liveVisibility = true
    else delete doc.liveVisibility
    return doc
}
/** What codegen gets for a document, and how: its tree (hidden nodes kept when live) and generate()'s
 *  options. The ONE place this is decided -- the builder's build and the page's first scene both come
 *  here, so the two cannot disagree about which uniforms the shader declares. */
export function generateArgs(doc, opts = {}) {
    // the scene as data (opts.data) keeps every node: whether one is shown is in its record, as live visibility has it
    const live = doc?.liveVisibility === true || opts.data === true
    return [toTree(doc, { keepDisabled: live }), { ...opts, liveVisibility: live }]
}

/** The optics trace's reach, saved with the scene: the longest optical path, scene units, 0 = none. */
export function setOpticsMaxDist(doc, maxDist) {
    if (!(Number.isFinite(maxDist) && maxDist >= 0)) throw new ModelError('optics.maxDist must be a number >= 0')
    doc.optics = { ...(doc.optics || {}), maxDist }
    return doc
}
/** An object's own material; or a group's (version 23), which every object below it wears instead of its own unless
 *  it keeps that (setOwnMaterial) -- null takes the group's away, and each wears its own again. Not the root's: the
 *  scene's row is not a group of it, and a scene of one material is a group around everything. Not a light's or a
 *  box's, which have none. */
export function setMaterial(doc, id, mat) {
    const { node, parent } = must(doc, id)
    if (node.kind === 'group' && !parent) throw new ModelError('the scene itself has no material: put its objects in a group and give the group one')
    if (node.kind === 'object' && (node.type === 'light' || isBoxType(node.type)))
        throw new ModelError(`'${id}' is a ${node.type === 'light' ? 'light' : BOX_WORDS[node.type]}, which has no material`)
    if (mat != null && !material(doc, mat)) throw new ModelError(`no material '${mat}'`)
    if (node.kind === 'group' && mat == null) delete node.material
    else node.material = mat
    return doc
}
/** Whether an object keeps its own material under a group that gives its children one (version 23): true or absent,
 *  as straightMaterial. Kept where no group gives one too, unused until one does -- as the base's join waits. */
export function setOwnMaterial(doc, id, on) {
    const { node } = must(doc, id)
    if (node.kind !== 'object' || node.type === 'light' || isBoxType(node.type))
        throw new ModelError(`'${id}' is not a shape; only a shape keeps a material of its own`)
    if (on) node.ownMaterial = true
    else delete node.ownMaterial
    return doc
}
/** The group nearest above `id` that gives what is below it a material (version 23), or null: its ancestors only, not
 *  itself. Every object under it that does not keep its own wears that group's. */
export function materialGroupAbove(doc, id) {
    let f = find(doc, id), out = null
    for (; f?.parent && !out; f = find(doc, f.parent.id)) if (f.parent.material != null) out = f.parent
    return out
}
/** The material an object wears (version 23): its own, unless a group above gives its children one and it does not
 *  keep its own -- then the nearest such group's. What toTree hands codegen, and what the tree and the panel show.
 *  { material, group }: the material's id (null for none), and the group it comes from, null for its own. */
export function wornMaterial(doc, id) {
    const { node } = must(doc, id)
    // a light and a box wear nothing, whatever the group says
    const shape = node.kind === 'object' && node.type !== 'light' && !isBoxType(node.type)
    const g = shape && node.ownMaterial !== true ? materialGroupAbove(doc, id) : null
    return g ? { material: g.material, group: g.id } : { material: node.material ?? null, group: null }
}

//----------------------------------------------------------------------------------------------
// What codegen reads
//----------------------------------------------------------------------------------------------

/**
 * What codegen.generate() takes: the tree with disabled nodes pruned -- a disabled group takes
 * its whole subtree out of the shader, which is what makes the eye on a group useful for
 * isolating part of a scene. Groups keep their blend and transform; objects their transform and
 * the id of the material they wear -- a group's above them, where one gives its objects one and they do not keep
 * their own (version 23, wornMaterial), so codegen knows no group material; every node its join and own blend. The
 * materials ride on the root, as `materials`.
 *
 * A GROUP CARRIES `csg`, whether it combines its children into one shape (codegen isCsg), decided on
 * the DOCUMENT, before disabled children are pruned. Decided on the tree, hiding the only child that
 * joins by subtraction would turn the group into a plain union -- and its blend uniform would vanish
 * from the shader while params.js, which reads the document, still wrote it live. A version 10 group
 * was CSG by its own op, which pruning never changed; this keeps that. It is the group's OWN joins: a
 * plain group that is one of a CSG group's shapes keeps `csg` false and is combined all the same, as a
 * union (codegen combinedGroups, 0.76.0), which its parent decides -- the tree's, not this flag.
 *
 * `keepDisabled` (for codegen's liveVisibility, the document's setting): disabled nodes stay, marked
 * `enabled: false`, so the shader has them and a uniform decides -- hiding one then compiles nothing.
 */
export function toTree(doc, { keepDisabled = false } = {}) {
    // `over`: the material a group above gives its objects (version 23, wornMaterial), null for none
    const go = (node, over = null) => {
        if (node.enabled === false && !keepDisabled) return null
        const off = n => {
            if (node.enabled === false) n.enabled = false
            if (node.join !== undefined) n.join = node.join
            if (node.joinBlend !== undefined) n.joinBlend = node.joinBlend
            return n
        }
        if (node.kind === 'group') {
            const mine = node !== doc.root && node.material != null ? node.material : over
            const g = off({ id: node.id, kind: 'group', blend: node.blend ?? 0, csg: isCsg(node),
                            children: node.children.map(c => go(c, mine)).filter(Boolean) })
            if (node.transform) g.transform = structuredClone(node.transform)
            /* ITS CODE AND SCHEMA FROM ITS BLOCK (version 16), its values in the block's order: what codegen reads is
               what a node with its own code would have been, so a version 15 file compiles to the shader it did */
            const B = blockOf(doc, node)
            if (B) {
                g.code = B.code
                g.params = inOrder(B, node.params)
                if (B.constants) g.constants = { ...B.constants }
                if (B.ranges) g.ranges = structuredClone(B.ranges)
            }
            if (node.straightMaterial) g.straightMaterial = true
            if (node.copies) g.copies = structuredClone(node.copies)
            if (node.pattern) g.pattern = structuredClone(node.pattern)
            return g
        }
        const B = blockOf(doc, node)
        const worn = over != null && node.ownMaterial !== true && node.type !== 'light' && !isBoxType(node.type) ? over : node.material ?? null
        const n = off({ id: node.id, kind: 'object', type: node.type, material: worn,
                        params: B ? inOrder(B, node.params) : structuredClone(node.params || {}) })
        if (node.transform) n.transform = structuredClone(node.transform)
        if (node.pattern) n.pattern = structuredClone(node.pattern)
        if (node.type === 'light') n.light = structuredClone(node.light)
        else if (node.type === 'export') n.export = structuredClone(node.export ?? {})
        else if (node.type === 'haze') n.haze = structuredClone(node.haze ?? {})
        else n.code = B ? B.code : node.code
        const schema = B ?? node
        if (schema.constants) n.constants = { ...schema.constants }
        if (schema.ranges) n.ranges = structuredClone(schema.ranges)
        // which of its parameters are lengths: the scene's size is guessed from those alone (bounds.js sceneExtent)
        if (schema.lengths?.length) n.lengths = [...schema.lengths]
        // which of its profiles are live: codegen writes their pieces as uniforms (a field toTree does not copy is not there)
        if (node.liveProfiles) n.liveProfiles = [...node.liveProfiles]
        return n
    }
    const root = go(doc.root) || { id: doc.root.id, kind: 'group', blend: 0, children: [] }
    root.csg = false             // the top level is always a plain union (codegen: culling rests on it)
    root.materials = structuredClone(doc.materials)
    root.functions = doc.functions ?? ''
    root.unit = doc.unit ?? 'm'
    // where the scene stops, in that unit (codegen hands it to the renderer); absent is the renderer's default
    if (doc.envRadius !== undefined) root.envRadius = doc.envRadius
    // ...and how close a ray must come, in that unit (setTolerance); absent is the renderer's automatic one
    if (doc.tolerance !== undefined) root.tolerance = doc.tolerance
    return root
}

/* a node's values in its block's order (a value it lacks, the block's default: validate refuses that, but a tree is
   made of documents mid-edit too) */
const inOrder = (B, params = {}) => Object.fromEntries(Object.keys(B.params).map(k => [k, structuredClone(k in params ? params[k] : B.params[k])]))

/** The objects toTree would emit, flattened in tree order -- for tests and the console. */
export function toNodes(doc) {
    const out = []
    const go = n => n.kind === 'group' ? n.children.forEach(go) : out.push(n)
    go(toTree(doc))
    return out
}


//----------------------------------------------------------------------------------------------
// Saving and loading
//----------------------------------------------------------------------------------------------

export const serialize = doc => JSON.stringify(doc, null, 2)

/* WHICH APPLICATION WROTE A FILE (version.js stamp, '0.1.0+1819ac6'): `app`, at the top of a saved FILE only,
   next to its format version. It says who wrote the file, which the file's own version cannot (that only changes
   with the format). Never part of a document: a document is snapshotted by undo, hashed for library thumbnails and
   compared for "changed since", and a stamp that moves with every commit would change all three. So it is put on
   at the moment of writing (withApp) and taken off at the moment of reading (withoutApp, in parse). */
export const withApp = (o, app) => {
    if (!app || !o || typeof o !== 'object') return o
    const { app: _, ...rest } = o
    return { format: rest.format, version: rest.version, app, ...rest }
}
export const withoutApp = o => {
    if (!o || typeof o !== 'object' || Array.isArray(o) || !('app' in o)) return o
    const { app: _, ...rest } = o
    return rest
}

/** Every problem with a document, as strings. Empty means it is sound. */
export function validate(doc) {
    const p = []
    if (!doc || typeof doc !== 'object') return ['not an object']
    if (doc.format !== FORMAT) p.push(`format is '${doc.format}', expected '${FORMAT}'`)
    if (doc.version !== VERSION) p.push(`version ${doc.version} is not one this builder reads (it reads ${VERSION}, and upgrades 1 to ${VERSION - 1} and the optics branch's 9 to 13)`)
    if (!Number.isInteger(doc.nextId) || doc.nextId < 1) p.push('nextId must be a positive integer')
    if (!Array.isArray(doc.materials)) p.push('materials must be a list')
    if (!doc.root || doc.root.kind !== 'group') p.push('root must be a group')
    if (!(doc.unit in UNITS)) p.push(`unit '${doc.unit}' is not one of ${Object.keys(UNITS).join(', ')}`)
    if (doc.optics !== undefined) {
        const o = doc.optics
        if (!o || typeof o !== 'object' || Array.isArray(o)) p.push('optics must be an object')
        else {
            if (o.maxDist !== undefined && !(Number.isFinite(o.maxDist) && o.maxDist >= 0)) p.push('optics.maxDist must be a number >= 0')
            for (const k of Object.keys(o)) if (k !== 'maxDist') p.push(`optics.${k}: not a setting (the sources are builder lights)`)
        }
    }
    if (doc.environment !== undefined) p.push(...environmentProblems(doc.environment))
    if (doc.envRadius !== undefined) p.push(...envRadiusProblems(doc.envRadius))
    if (doc.view !== undefined) p.push(...viewProblems(doc.view))
    if (doc.timeline !== undefined) p.push(...timelineProblems(doc.timeline))
    if (doc.tolerance !== undefined) p.push(...toleranceProblems(doc.tolerance))
    if (doc.liveVisibility !== undefined && typeof doc.liveVisibility !== 'boolean') p.push('liveVisibility must be true or false')
    if (p.length) return p

    const seen = new Set()
    const seeId = (id, what) => {
        if (typeof id !== 'string' || !ID.test(id)) p.push(`${what}: '${id}' is not a valid id`)
        else if (seen.has(id)) p.push(`${what}: id '${id}' appears twice`)
        seen.add(id)
    }
    for (const m of doc.materials) {
        seeId(m?.id, 'material')
        p.push(...materialProblems(m))
    }
    // the blocks (version 16): each sound, in the scene's id space
    if (!Array.isArray(doc.blocks)) p.push('blocks must be a list')
    else for (const b of doc.blocks) { seeId(b?.id, 'block'); p.push(...blockProblems(b)) }
    const blocks = new Map((Array.isArray(doc.blocks) ? doc.blocks : []).map(b => [b?.id, b]))
    /* A NODE AND ITS BLOCK: one of the scene's, of its kind, and the node's values those of its parameters */
    const usesBlock = (n, kind) => {
        const B = blocks.get(n.block)
        if (!B) return p.push(`'${n.id}': no block '${n.block}'`)
        if (B.kind !== kind) return p.push(`'${n.id}': block '${n.block}' is ${B.kind === 'group' ? 'a group\'s' : 'an object\'s'} code`)
        p.push(...userProblems(n, B))
    }
    let hazeSeen = 0                       // one haze box a scene (version 22)
    const walkCheck = (n, where) => {
        if (!n || typeof n !== 'object') { p.push(`${where}: not a node`); return }
        seeId(n.id, where)
        if (typeof n.enabled !== 'boolean') p.push(`'${n.id}': enabled must be true or false`)
        if (n !== doc.root) checkTransform(n, p)
        if (n.pattern !== undefined) p.push(...patternProblems(n, n === doc.root))
        // true or absent (setLock); the root has none to lock
        for (const key of Object.values(LOCKS)) if (n[key] !== undefined && (n === doc.root || n[key] !== true))
            p.push(n === doc.root ? `the root has no ${key}` : `'${n.id}': ${key} is true or absent`)
        // a join anywhere but on the root; at the top level it is dormant (moved or pasted there), not wrong
        if (n === doc.root && (n.join !== undefined || n.joinBlend !== undefined)) p.push('the root joins nothing')
        else p.push(...joinProblems(n))
        // version 18: what a node's bindings say, the names aside (resolveBindings)
        if (n === doc.root && n.bind !== undefined) p.push('the root binds nothing')
        if (n.kind === 'group') {
            if ('op' in n) p.push(`'${n.id}': a group has no op since version 14 -- its children's joins say how they combine`)
            if (!(Number.isFinite(n.blend) && n.blend >= 0)) p.push(`'${n.id}': blend must be a number >= 0`)
            if (!Array.isArray(n.children)) p.push(`'${n.id}': a group needs a children list`)
            else n.children.forEach((c, i) => walkCheck(c, `'${n.id}' child ${i}`))
            // version 23: a group's material, which its objects wear; the root has none (setMaterial)
            if (n.material !== undefined && (n === doc.root || typeof n.material !== 'string' || !doc.materials.some(m => m?.id === n.material)))
                p.push(n === doc.root ? 'the root has no material' : `'${n.id}': no material '${n.material}'`)
            if (n.ownMaterial !== undefined) p.push(`'${n.id}': ownMaterial is a shape's, not a group's`)
            if (n !== doc.root) {
                p.push(...groupProblems(n))
                if (n.block !== undefined) usesBlock(n, 'group')
                p.push(...copiesProblems(n, doc))
            }
            else if (n.code !== undefined || n.params !== undefined || n.block !== undefined) p.push(`the root has no code or parameters; its code is the functions block`)
            if (n === doc.root && n.copies !== undefined) p.push('the root has no copies: it is the world frame')
        } else if (n.kind === 'object') {
            if (!NODE_TYPES[n.type]) p.push(`'${n.id}': unknown object type '${n.type}'`)
            if (n.material != null && !doc.materials.some(m => m?.id === n.material))
                p.push(`'${n.id}': no material '${n.material}'`)
            // true or absent (setOwnMaterial, version 23), and a shape's only
            if (n.ownMaterial !== undefined && (n.ownMaterial !== true || n.type === 'light' || isBoxType(n.type)))
                p.push(`'${n.id}': ownMaterial is true or absent, and a shape's only`)
            if (!n.params || typeof n.params !== 'object' || Array.isArray(n.params)) p.push(`'${n.id}': params must be an object`)
            else {
                const bad = Object.keys(n.params).filter(k => !PARAM.test(k) || RESERVED_PARAMS.includes(k))
                if (bad.length) p.push(`'${n.id}': parameter name(s) not valid in WGSL: ${bad.join(', ')}`)
                if (n.type === 'light' || isBoxType(n.type)) p.push(...profileProblems(n))
            }
            if (n.type === 'light') {
                p.push(...lightProblems(n))
                if (n.material != null) p.push(`'${n.id}': a light has no material`)
            } else if (n.type === 'export') {
                p.push(...exportProblems(n))
                if (n.light !== undefined) p.push(`'${n.id}': light settings on an export box`)
            } else if (n.type === 'haze') {
                p.push(...hazeProblems(n))
                if (n.light !== undefined || n.export !== undefined) p.push(`'${n.id}': light or export settings on a haze box`)
                if (hazeSeen++) p.push(`'${n.id}': a second haze box -- one a scene`)
            } else {
                // version 16: its code and its parameters' schema are its block's, its values its own
                if (typeof n.block !== 'string') p.push(`'${n.id}': a code node names its block (version 16)`)
                else if (n.params && typeof n.params === 'object') usesBlock(n, 'object')
                for (const k of ['code', 'constants', 'ranges', 'lengths']) if (n[k] !== undefined)
                    p.push(`'${n.id}': its ${k} is its block's since version 16, not its own`)
                if (n.light !== undefined) p.push(`'${n.id}': light settings on a code node`)
            }
            if ((n.type === 'light' || isBoxType(n.type)) && n.block !== undefined) p.push(`'${n.id}': a ${n.type === 'light' ? 'light' : BOX_WORDS[n.type]} has no block`)
            if (n.detector !== undefined) p.push(`'${n.id}': detector is a material's type`)
            if (n.type === 'light' || isBoxType(n.type)) {
                p.push(...constantProblems(n))
                p.push(...rangesProblems(n))
                p.push(...lengthsProblems(n))
            }
            p.push(...liveProfilesProblems(n))
        } else p.push(`'${n.id}': unknown kind '${n.kind}'`)
    }
    walkCheck(doc.root, 'root')
    // the bindings, once the tree itself is sound (their targets are read off each node's parameters and its block)
    if (!p.length) walk(doc, (n, parent) => { if (parent) p.push(...bindProblems(doc, n, parent)) })
    if (doc.functions !== undefined && typeof doc.functions !== 'string') p.push('functions must be a string of WGSL')
    for (const id of seen) if (RESERVED_IDS.includes(id) && id !== doc.root.id) p.push(`'${id}' is a reserved id`)
    return p
}

/** Text in, a sound document out -- or a ModelError listing everything wrong with it. */
export function parse(text) {
    let doc
    try { doc = withoutApp(JSON.parse(text)) } catch (e) { throw new ModelError(`not JSON: ${e.message}`) }
    doc = upgrade(doc)
    const problems = validate(doc)
    if (problems.length) throw new ModelError(problems)
    return doc
}

const finite3 = v => v && typeof v === 'object' && ['x', 'y', 'z'].every(k => Number.isFinite(v[k]))
function checkTransform(n, p) {
    const t = n.transform
    if (!t || typeof t !== 'object') return p.push(`'${n.id}': needs a transform`)
    if (!finite3(t.pos)) p.push(`'${n.id}': transform.pos must be {x, y, z} numbers`)
    if (!finite3(t.rot)) p.push(`'${n.id}': transform.rot must be {x, y, z} numbers (degrees)`)
    if (!(Number.isFinite(t.scale) && t.scale > 0)) p.push(`'${n.id}': transform.scale must be a number > 0`)
}
/* A PATTERN FRAME (version 24): a place and a turn, nothing else -- a scale would cancel in every material that reads its
   point in real units (p_local * S_local, MATERIAL_CODE_TEMPLATE), so it would mean something only to the few that do not */
function patternProblems(n, root) {
    if (root) return ['the root has no pattern frame: it is the world']
    if (!canPattern(n)) return [`'${n.id}': a ${n.type === 'light' ? 'light' : BOX_WORDS[n.type] ?? n.type} has no material, so no pattern frame`]
    const t = n.pattern, p = []
    if (!t || typeof t !== 'object' || Array.isArray(t)) return [`'${n.id}': pattern is { pos, rot }`]
    if (!finite3(t.pos)) p.push(`'${n.id}': pattern.pos must be {x, y, z} numbers`)
    if (!finite3(t.rot)) p.push(`'${n.id}': pattern.rot must be {x, y, z} numbers (degrees)`)
    for (const k of Object.keys(t)) if (k !== 'pos' && k !== 'rot') p.push(`'${n.id}': pattern.${k}: a pattern frame is a place and a turn only`)
    return p
}

/** Older files, brought up to VERSION one version at a time, by filling in what they could not
 *  have said. Anything that is not a recognisable older document is passed through for
 *  validate() to reject. */
export function upgrade(doc) {
    if (!doc || typeof doc !== 'object' || doc.format !== FORMAT) return doc
    // the optics branch's own 9 to 13 (branchToV10) overlap this line's numbers: told apart by content
    const branch = doc.version >= 9 && doc.version <= 13 && fromBranch(doc)
    if (!branch && !(doc.version >= 1 && doc.version < VERSION)) return doc
    let d = structuredClone(doc)
    if (d.version === 1) d = v1to2(d)
    if (d.version === 2) d = v2to3(d)
    if (d.version === 3) d = v3to4(d)
    if (d.version === 4) d.version = 5          // nothing to change: group code is new, not moved
    if (d.version === 5) d = v5to6(d)
    if (d.version === 6) d = v6to7(d)
    if (d.version === 7) d = v7to8(d)
    if (d.version === 8) d = v8to9(d)
    if (d.version >= 9 && d.version <= 13 && fromBranch(d)) d = branchToV10(d)
    if (d.version === 9) d = v9to10(d)
    if (d.version === 10) d = v10to14(d)
    if (d.version === 14) d = v14to15(d)
    if (d.version === 15) d = v15to16(d)
    if (d.version === 16) d.version = 17          // nothing to change: arrays are new, not moved
    if (d.version === 17) d.version = 18          // nothing to change: bindings are new
    if (d.version === 18) d = v18to19(d)
    if (d.version === 19) d = v19to20(d)
    if (d.version === 20) d = v20to21(d)
    if (d.version === 21) d.version = 22          // nothing to change: haze boxes are new
    if (d.version === 22) d.version = 23          // nothing to change: a group's material is new
    if (d.version === 23) d.version = 24          // nothing to change: pattern frames are new
    if (d.version === 24) d = v24to25(d)
    return d
}

/** 24 -> 25: every material gets translucency and a film's spread at 0 -- an opaque base, refracting glass, as it rendered. */
function v24to25(d) {
    d.materials = (d.materials || []).map(m => withFieldDefaults(m))
    d.version = 25
    return d
}

/** 20 -> 21: every material gets the Abbe number at 0 -- no dispersion, as it rendered. */
function v20to21(d) {
    d.materials = (d.materials || []).map(m => withFieldDefaults(m))
    d.version = 21
    return d
}

/** 19 -> 20: every material gets the coating's fields, coating 0 -- none, as it rendered. */
function v19to20(d) {
    d.materials = (d.materials || []).map(m => withFieldDefaults(m))
    d.version = 20
    return d
}

/** 18 -> 19: every material gets the colour depth at 0 -- no absorption inside, as it rendered. */
function v18to19(d) {
    d.materials = (d.materials || []).map(m => withFieldDefaults(m))
    d.version = 19
    return d
}

/** 15 -> 16: every node's code becomes a block (blocksFromCode): the same code with the same schema is one block,
 *  every node that had it its user. */
function v15to16(d) {
    d.blocks = Array.isArray(d.blocks) ? d.blocks : []
    if (d.materials && d.root) blocksFromCode(d, d.root)
    d.version = 16
    return d
}
/**
 * CODE ON NODES BECOMES BLOCKS, in `node`'s subtree, into `doc`'s list: a version 15 document's (v15to16), or an
 * asset saved before 16 going into a scene (insertAsset) -- a library item, the clipboard. Each code object, and
 * each group with code or parameters, takes the block that is its code and schema: one the scene has already
 * (sameBlock: what is the same code is one block, built-in or not), else a new one, named after the first node
 * with it. The node keeps its values and loses the rest. A node already naming a block is left as it is.
 */
export function blocksFromCode(doc, node) {
    const go = n => {
        if (!n || typeof n !== 'object') return
        const object = n.kind === 'object' && (n.type === 'code' || n.type === undefined) && n.block === undefined
        const group = n.kind === 'group' && n !== doc.root && n.block === undefined && (n.code !== undefined || n.params !== undefined)
        if (object || group) {
            const spec = { kind: n.kind, label: n.label, code: String(n.code ?? ''), params: structuredClone(n.params || {}),
                           constants: n.constants, ranges: n.ranges, lengths: n.lengths }
            n.block = blockFor(doc, spec, { share: true }).id
            if (n.params === undefined) n.params = {}
            for (const k of ['code', 'constants', 'ranges', 'lengths']) delete n[k]
        }
        for (const c of n.kind === 'group' && Array.isArray(n.children) ? n.children : []) go(c)
    }
    go(node)
    return node
}

/** 14 -> 15: the radius out of the environment and onto the scene, in the scene's unit. A radius of exactly the
 *  400 m default is dropped, not moved: every environment edited once holds it, copied whole from the renderer
 *  (params.js makeAfter), and as the scene's own 400 it would read 400000 in a mm scene and stop meaning 400 m the
 *  moment the unit changed. An environment left with nothing in it goes too: an empty one would count as the
 *  scene's own and stop its next edit copying the renderer's set. */
function v14to15(d) {
    const env = d.environment
    if (env && typeof env === 'object' && !Array.isArray(env) && 'envRadius' in env) {
        const m = env.envRadius
        delete env.envRadius
        if (Number.isFinite(m) && m > 0 && m !== ENV_RADIUS_DEFAULT_M) d.envRadius = inUnit(m, d.unit ?? 'm')
        if (!Object.keys(env).length) delete d.environment
    }
    d.version = 15
    return d
}

/** 10 -> 14: every group's op goes to its children (upgradeJoins). 11 to 13 are the optics branch's. */
function v10to14(d) {
    upgradeJoins(d.root)
    d.version = 14
    return d
}

/**
 * A GROUP'S OP BECOMES ITS CHILDREN'S JOINS, in a document of version 10 or in any node that still
 * carries one -- an asset: library items, exported library files and the clipboard hold nodes with
 * no version (extractAsset), so insertAsset calls this too, and a node with `op` is the mark of one
 * saved before 14. Stored items are not rewritten (thumbnails are keyed on the asset as it is).
 *
 * Every SHAPE child after the first takes the op -- the first is the base, and a light or an export
 * box is no shape of the group (codegen leaves both out of the combine), so neither is the base nor
 * gets a join. The first shape in the DOCUMENT, hidden or not, as version 10's codegen took the first
 * of whatever was left: [a hidden, b, c] less is b - c in both, and a - b - c in both when a shows.
 * A union needs nothing: absent is union, and its blend stays on the group.
 *
 * ONE CASE CHANGES ITS TEXT, deliberately: a subtraction or intersection with fewer than two shapes
 * and no blend has no child to give its op to, and becomes a plain group -- the same shape, which it
 * already was, but no longer through the CSG path (model.test).
 */
export function upgradeJoins(node) {
    const go = g => {
        if (!g || g.kind !== 'group') return
        if ('op' in g && OPS.includes(g.op)) {
            const shapes = (g.children || []).filter(c => c && !isBoxType(c.type) && c.type !== 'light')
            if (g.op !== 'union') for (const c of shapes.slice(1)) c.join = g.op
            delete g.op
        }
        for (const c of g.children || []) go(c)
    }
    go(node)
    return node
}

/*======================================================================================================================
  FILES FROM THE OPTICS BRANCH. While the optics work was on a branch of its own, this format went its
  own way from version 8 to 13 alongside the line above: node types kept (sphere, box, ... and a lens,
  a rectangle and a disc sheet, a ray file), an object-level detector flag (9), material optics roles
  (10) then types (11), a source material's settings and the Optics page's source as a sheet (12), a
  ray file as an object (13). The numbers collide with this line's 9, so a file is told apart by what
  it holds -- a node type other than code or light, an object detector flag, a material with a type or
  an optics role or source settings, optics settings of any kind -- and brought here in two steps:
  its own upgrades up to its 13, then that to version 10.
======================================================================================================================*/
const BRANCH_SHEETS = {
    lens: [{ diameter: 1.0, thickness: 0.2, r1: 2.0, r2: 2.0 }, 'C = add_new(C, Nlens(p, diameter, thickness, r1, r2), MATERIAL);'],
    rectangle: [{ width: 1.0, height: 1.0 }, 'C = add_new(C, Nrectangle(p, VEC2(width, height) * 0.5), MATERIAL);'],
    disc: [{ radius: 0.5 }, 'C = add_new(C, Ndisc(p, radius), MATERIAL);'],
}
/* WHAT COUNTS AS EVIDENCE DEPENDS ON THE VERSION. This line's 10 has material types and optics settings
   of its own (an emitter, a detector; doc.optics.maxDist), and the branch's 10 had neither -- it had roles
   (m.optics), and its types came at its 11, its page source with optics at its 11. Taken as evidence at 10,
   every document of this line with a typed material went through branchToV10, whose 10 -> 11 step turns
   anything emitting into a 'source' and whose end drops a source nothing uses: an unused glowing material
   vanished on every undo, redo, save and reopen (each is a parse), and a detector in use with any emission
   came back an emitter (found on both lines, 2026-09-30; model.test). At 10, only what this line never
   wrote counts. 11 to 13 are the branch's alone: this line never saved them (it went from 10 to 14). */
function fromBranch(d) {
    if (d.version >= 11 && d.version <= 13) return true
    const at10 = d.version === 10
    let found = at10 ? Object.keys(d.optics || {}).some(k => k !== 'maxDist') : !!d.optics
    const go = n => {
        if (!n || typeof n !== 'object' || found) return
        // an export box is this line's, and never the branch's: it must not make a file look like one
        if (n.kind === 'object' && ((n.type !== 'code' && n.type !== 'light' && n.type !== 'export') || n.detector !== undefined || n.rayfile !== undefined)) found = true
        for (const c of n.children || []) go(c)
    }
    go(d.root)
    return found || (d.materials || []).some(m => m && ((!at10 && m.type !== undefined) || m.optics !== undefined || m.source !== undefined))
}
function branchToV10(d) {
    const objects = []
    const walkAll = (n, scale) => {
        if (!n || typeof n !== 'object') return
        const s = scale * (n.transform?.scale ?? 1)
        if (n.kind === 'object') objects.push([n, s])
        for (const c of n.children || []) walkAll(c, s)
    }
    walkAll(d.root, 1)
    const nodes = objects.map(([n]) => n)
    // ITS OWN UPGRADES, up to its 13 -- in its own words
    if (d.version === 9) {                     // an object's detector flag becomes its material's role
        const det = nodes.filter(n => n.detector === true), copies = new Map()
        for (const n of det) {
            const key = n.material ?? null
            const mat = key == null ? null : d.materials.find(m => m.id === key)
            const shared = key != null && nodes.some(o => o.detector !== true && (o.material ?? null) === key)
            if (mat && !shared) { mat.optics = 'detector'; continue }
            if (!copies.has(key)) {
                const id = newId(d, 'm')
                const base = mat ? structuredClone(mat) : { label: 'detector', params: materialDefaults(), code: MATERIAL_CODE_TEMPLATE }
                d.materials.push({ ...base, id, label: mat ? `${mat.label} (detector)` : 'detector', optics: 'detector' })
                copies.set(key, id)
            }
            n.material = copies.get(key)
        }
        for (const n of nodes) delete n.detector
        d.version = 10
    }
    if (d.version === 10) {                    // the role becomes the type; what emits, a source
        for (const m of d.materials || []) {
            if (m.optics === 'detector' || m.optics === 'limiter') m.type = m.optics
            else if (m.params?.emissiveLuminance > 0) m.type = 'source'
            delete m.optics
        }
        d.version = 11
    }
    const pageSource = d.version === 11 ? d.optics?.source : null
    if (d.version === 11 || d.version === 12) d.version = 13
    // ...and from its 13 to 10. The page's source (its 11) becomes a light directly.
    if (pageSource) {
        const s = pageSource, size = Array.isArray(s.size) ? s.size : [0, 0], rect = s.type === 'rectangle'
        const pos = Array.isArray(s.pos) ? s.pos : [0, 0, 0]
        const light = { shape: rect ? 'rectangle' : 'disc', flux: Number.isFinite(s.flux) ? Math.max(0, s.flux) : 100 }
        if (['uniform', 'collimated'].includes(s.distribution)) light.distribution = s.distribution
        if (Number.isFinite(s.n) && s.n !== 1) light.n = s.n
        if (Number.isFinite(s.halfAngle) && s.halfAngle > 0 && s.halfAngle < 90) light.halfAngle = s.halfAngle
        d.root.children.push({ id: newId(d, 'n'), kind: 'object', type: 'light', label: 'optics source', enabled: true, material: null,
            params: rect ? { width: 2 * (size[0] || 0.5), height: 2 * (size[1] ?? size[0] ?? 0.5) } : { radius: s.type === 'point' ? 5e-4 : (size[0] || 0.5) },
            transform: { pos: { x: pos[0], y: pos[1], z: pos[2] }, rot: rotationTowards(Array.isArray(s.axis) ? s.axis : [0, 0, 1]), scale: 1 },
            light })
    }
    if (d.optics) { delete d.optics.source; if (!Object.keys(d.optics).length) delete d.optics }
    // a source material's sheets become lights, the flux it gave all of them shared by area
    const srcMats = new Map((d.materials || []).filter(m => m.type === 'source').map(m => [m.id, m]))
    const sheetArea = ([n, s]) => (n.type === 'rectangle' ? (n.params?.width ?? 1) * (n.params?.height ?? 1)
                                   : Math.PI * (n.params?.radius ?? 0.5) ** 2) * s * s
    const lit = objects.filter(([n]) => (n.type === 'rectangle' || n.type === 'disc') && srcMats.has(n.material))
    const areaOf = new Map()
    for (const o of lit) areaOf.set(o[0].material, (areaOf.get(o[0].material) || 0) + sheetArea(o))
    for (const o of lit) {
        const [n] = o, m = srcMats.get(n.material), S = m.source || {}
        const light = { shape: n.type, colour: m.params?.emissive, luminance: m.params?.emissiveLuminance }
        for (const k of ['distribution', 'n', 'halfAngle', 'twoSided', 'transparent', 'emitN']) if (S[k] !== undefined) light[k] = S[k]
        if (S.flux != null) light.flux = S.flux * sheetArea(o) / (areaOf.get(n.material) || 1)
        for (const k of Object.keys(light)) if (light[k] === undefined) delete light[k]
        n.type = 'light'; n.material = null; n.light = light
        n.params = { ...LIGHT_SHAPES[light.shape].params, ...(n.params || {}) }
    }
    for (const [n] of objects) {
        if (n.type === 'rayfile') {
            const r = n.rayfile || {}
            n.type = 'light'; n.material = null; n.params = {}
            n.light = { shape: 'rayfile', file: r.file ?? '' }
            if (r.flux != null) n.light.flux = r.flux
            if (r.emitN != null && r.emitN !== 1) n.light.emitN = r.emitN
            if (r.box) n.light.box = r.box
            delete n.rayfile
        }
        const was = n.type !== 'light' && (BRANCH_SHEETS[n.type] || V8_TYPES[n.type])
        if (was) { n.params = { ...structuredClone(was[0]), ...(n.params || {}) }; n.code = was[1]; n.type = 'code' }
    }
    // a source material still on another shape glows as an emitter; one on nothing any more goes
    const used = new Set(nodes.map(n => n.material).filter(Boolean))
    d.materials = (d.materials || []).filter(m => m.type !== 'source' || used.has(m.id))
    for (const m of d.materials) if (m.type === 'source') { m.type = 'emitter'; delete m.source }
    d.version = 10
    return d
}

/** 9 -> 10: a material that emits becomes an emitter -- which it always was, in all but name. */
function v9to10(d) {
    for (const m of d.materials || []) if (m?.params?.emissiveLuminance > 0 && m.type === undefined) m.type = 'emitter'
    d.version = 10
    return d
}

/* WHAT EACH OBJECT TYPE WAS IN VERSION 8: its default parameters and the one line its body emitted.
   Frozen here rather than read from primitives.js, which is free to change -- an upgrade has to
   give the file what it meant when it was saved, and a v8 file upgraded with this compiles to the
   shader it did then, byte for byte but for the `// node` comment (codegen.test.mjs). */
const V8_TYPES = {
    sphere: [{ radius: 1.0 }, 'C = add_new(C, Nsphere(p, radius), MATERIAL);'],
    box: [{ size: { x: 0.5, y: 0.5, z: 0.5 }, rounding: 0.02 }, 'C = add_new(C, NboxRounded(p, size, rounding), MATERIAL);'],
    cylinder: [{ radius: 0.5, height: 1.0 }, 'C = add_new(C, Ncylinder(p, height * 0.5, radius), MATERIAL);'],
    capsule: [{ radius: 0.3, height: 1.0 }, 'C = add_new(C, Ncapsule(p, height * 0.5, radius), MATERIAL);'],
    torus: [{ ring: 0.8, tube: 0.2 }, 'C = add_new(C, Ntorus(p, ring, tube), MATERIAL);'],
    cone: [{ base: 0.6, top: 0.0, height: 1.2 }, 'C = add_new(C, sdCappedCone(p, height * 0.5, base, top), MATERIAL);'],
    plane: [{}, 'C = add_new(C, Nplane(p), MATERIAL);'],
}

/** 8 -> 9: every primitive node becomes a code node with the code its type emitted and the
 *  parameters codegen filled in -- a v8 node could leave one out and get the type's default, a
 *  code node has only what it carries. An unknown type is left for validate() to report. */
function v8to9(d) {
    const go = n => {
        if (!n || typeof n !== 'object') return
        if (n.kind === 'group' && Array.isArray(n.children)) n.children.forEach(go)
        const was = n.kind === 'object' && V8_TYPES[n.type]
        if (!was) return
        n.params = { ...structuredClone(was[0]), ...(n.params || {}) }
        n.code = was[1]
        n.type = 'code'
    }
    go(d.root)
    d.version = 9
    return d
}

/** 6 -> 7: the dead clearcoat fields go. */
function v6to7(d) {
    for (const m of d.materials || []) {
        if (!m?.params) continue
        delete m.params.clearcoat
        delete m.params.clearcoatRoughness
    }
    d.version = 7
    return d
}

/** 7 -> 8: the dead model field goes. */
function v7to8(d) {
    for (const m of d.materials || []) if (m?.params) delete m.params.model
    d.version = 8
    return d
}

/** How much brighter an old emission number becomes in cd/m^2. Before the units change, light
 *  was relative to a sky calibrated to an irradiance of 0.78 on the ground (sdf.js SKY_SCALE);
 *  the default sky is now 15 000 lx. Scaling by the ratio keeps every light exactly as bright
 *  against the default sky as it was against the old one, which is the only thing the old number
 *  ever meant. Exported so the test can hold the two ends of it. */
export const OLD_EMISSION_TO_CDM2 = 15000 / 0.78

/** 5 -> 6: a unit (metres, which is what every earlier scene's numbers were read as) and
 *  emission as luminance. The old emission was colour * strength, whose luminance is
 *  Y(colour) * strength; the new one is hue * luminance with the hue normalised, so the same
 *  light is luminance = Y(colour) * strength * the factor above. Code that writes m.emissive
 *  directly cannot be converted and is left as it is. */
function v5to6(d) {
    d.unit = 'm'
    for (const m of d.materials || []) {
        const P = m?.params
        if (!P || !('emissiveStrength' in P)) continue
        const c = P.emissive || { r: 1, g: 1, b: 1 }
        P.emissiveLuminance = (P.emissiveStrength || 0) * Y([c.r, c.g, c.b]) * OLD_EMISSION_TO_CDM2
        delete P.emissiveStrength
    }
    d.version = 6
    return d
}

/** 3 -> 4: each palette material becomes that palette entry as data -- parameters, and for the
 *  procedural entries the WGSL that computed them. An unknown name is left for validate() to
 *  report rather than guessed at. */
function v3to4(d) {
    d.materials = (d.materials || []).map(m => {
        const src = PALETTE_V3[m?.palette]
        if (!src) return m
        return { id: m.id, label: m.label, params: { ...materialDefaults(), ...structuredClone(src.params) },
                 code: src.code ?? '' }
    })
    d.version = 4
    return d
}

/** 1 -> 2: the identity transform on every node but the root, and every group a plain union. */
function v1to2(d) {
    const go = (n, isRoot) => {
        if (!n || typeof n !== 'object') return
        if (!isRoot && n.transform === undefined) n.transform = identity()
        if (n.kind === 'group') {
            if (n.op === undefined) n.op = 'union'
            if (n.blend === undefined) n.blend = 0
            if (Array.isArray(n.children)) n.children.forEach(c => go(c, false))
        }
    }
    go(d.root, true)
    d.version = 2
    return d
}

/** 2 -> 3: a sphere's `centre` becomes part of its position. The centre was subtracted in the
 *  sphere's OWN frame -- after its rotation and scale -- so it moves the sphere by R * scale *
 *  centre in the parent's frame, not by centre itself. */
function v2to3(d) {
    const go = n => {
        if (!n || typeof n !== 'object') return
        if (n.kind === 'group' && Array.isArray(n.children)) n.children.forEach(go)
        if (n.kind === 'object' && n.type === 'sphere' && n.params && 'centre' in n.params) {
            const c = n.params.centre || {}
            delete n.params.centre
            if (n.transform?.pos && n.transform?.rot) {
                const m = matrixOf(n.transform), k = n.transform.scale
                const [x, y, z] = [c.x || 0, c.y || 0, c.z || 0].map(v => v * k)
                n.transform.pos.x += m[0] * x + m[4] * y + m[8] * z
                n.transform.pos.y += m[1] * x + m[5] * y + m[9] * z
                n.transform.pos.z += m[2] * x + m[6] * y + m[10] * z
            }
        }
    }
    go(d.root)
    d.version = 3
    return d
}
