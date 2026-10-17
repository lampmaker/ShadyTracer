//======================================================================================================================
// PARAMS -- the scene document's settings as entries of the application's parameter registry
// (lib/shell/params.js): what the timeline animates, an optimiser varies, and a script or the
// command palette reaches by name.
//
//   P.provide('scene', () => sceneParams(BUILDER.doc, { live, commit, structure, syncSources, reveal }))
//
// PURE, like model.js: it reads the document it is given and calls the hooks; no DOM, no device.
// test/params.test.mjs builds every bundled scene's entries and checks each LIVE one writes a
// uniform the generated scene actually declares -- the registry otherwise has one way to be wrong
// that nothing on screen shows: a value set, the document changed, and a uniform named that the
// shader never had, so the picture never moves.
//
// THE PATHS ARE IDS: 'scene/<node or material id>/<parameter>' -- a material's relief's
// 'scene/<material id>#relief/<parameter>' (materials.js reliefOwner) -- and for what every node has
//   scene/<id>/transform/position | rotation | scale
//   scene/<id>/blend                                   (a group's; 'blend' is a reserved parameter name)
//   scene/<id>/join/blend                              (a child's own join blend, while it has one)
//   scene/<id>/light/<setting>                         (a light's own settings, lights.js)
// A node's parameter cannot be called 'transform', 'join' or 'light' and collide: those are prefixes
// of longer paths, and no parameter path has three parts.
//
// WHAT A CHANGE DOES is what the properties panel does for the same value, because the panel calls
// the same `after` functions (builder/panel.js): a live value is pushed as a uniform and becomes an
// undo step; a compile-time one is a structural change. So an edit from the timeline and an edit from
// a slider cannot differ.
//
// NOT HERE: settings that are choices between shapes of the panel (a light's distribution, colour-by,
// a material's type, an object's material, the scene's unit). They are structural, they reshape the
// panel, and nothing that sweeps a number wants them. They can join when something does.
// Nor the scene's radius (model.js envRadius): it was here as scene/environment/envRadius while it was an
// environment setting; it is the scene object's now, no uniform (RT.updateScene), and nothing sweeps it.
//======================================================================================================================

import * as M from './model.js'
import { isCsg } from './codegen.js'
import { toArray, intoObject } from '../lib/shell/params.js'

/**
 * @param doc    the scene document (model.js)
 * @param hooks  { live(id, k), commit(key), structure(), syncSources(), reveal(id), onLabel(),
 *                 environment() -- the renderer's settings now, for a scene without an environment of its own }
 *               -- all optional
 * @returns      registry entries (lib/shell/params.js)
 */
export function sceneParams(doc, hooks = {}) {
    const H = makeAfter(hooks)
    const out = []
    const reveal = id => hooks.reveal ? () => hooks.reveal(id) : undefined
    const unit = doc.unit ?? 'm'

    // ---- a parameters list, a node's or a material's
    const params = (owner, keys, where, gui = () => ({})) => {
        for (const k of keys) {
            const v = owner.params?.[k]
            const kind = M.paramKind(v)
            // booleans, strings: nothing to sweep; a profile or a path is the shader's own text, never a live value
            if (kind === 'other' || kind === 'profile' || kind === 'path') continue
            const constant = owner.constants?.[k]
            const r = owner.ranges?.[k] || gui(k) || {}
            /* a length is in the scene's unit (model.js setLength); a light's size and an export box's
               always are -- shown beside it, as the position's is. A relief's are real millimetres. */
            const length = M.isLength(owner, k) || owner.type === 'light' || owner.type === 'export' || owner.type === 'haze'
            const base = { path: `scene/${owner.id}/${k}`, label: `${where} › ${gui(k).label ?? k}`, group: `scene · ${where}`,
                           reveal: reveal(owner.reveal ?? owner.id), kind: constant ? 'structural' : 'live',
                           ...(length ? { unit: owner.unit ?? unit } : {}) }
            if (kind === 'number') out.push({ ...base, min: r.min, max: r.max, step: constant && constant !== 'f32' ? 1 : r.step,
                help: constant ? `compile-time (${constant}): every change recompiles`
                    /* A MATERIAL FIELD IN THE SHADER ONLY WHILE IN USE (materials.js `only`: the colour depth): live, but its
                       first value in use is a compile, which live() asks for (demo.js) -- said, for an optimiser to know */
                    : M.MATERIAL_FIELDS[k]?.only && M.material(doc, owner.id) ? (M.MATERIAL_FIELDS[k].onlyHelp
                        ?? (M.MATERIAL_FIELDS[k].coat ? 'in the shader while the material has a coating: live'
                            : 'in the shader only while in use (above 0): the first such value compiles, then it is live'))
                    : undefined,
                get: () => owner.params[k],
                set: (x, o = {}) => { owner.params[k] = x; constant ? H.structure(o) : H.live(owner.id, k, o) } })
            // as many dimensions as the value has: a 2D {x, y} is two (lib/shell/params.js KEYS3)
            else out.push({ ...base, dims: toArray(owner.params[k]).length, ...(kind === 'colour' ? { min: 0 } : {}),
                get: () => toArray(owner.params[k]),
                set: (x, o = {}) => { intoObject(owner.params[k], x); constant ? H.structure(o) : H.live(owner.id, k, o) } })
        }
    }

    /* A BOUND VALUE IS NOT HERE (model.js version 18, builder/bind.js): it is its component's parameters' to set -- a
       value set here would be undone by the next resolve. The parameters it is bound to are, and moving one moves it. */
    const bound = (node, t) => Object.keys(node.bind || {}).some(x => x === t || x.startsWith(t + '.'))
    const free = (node, keys) => keys.filter(k => !bound(node, k))

    // ---- a transform: one mat4 uniform per node, so all three are live
    const transform = (node, where) => {
        const t = node.transform
        if (!t) return
        const base = { group: `scene · ${where}`, reveal: reveal(node.id), dims: 3 }
        if (!bound(node, 'pos')) out.push({ ...base, path: `scene/${node.id}/transform/position`, label: `${where} › position`, unit,
                   get: () => toArray(t.pos), set: (x, o = {}) => { intoObject(t.pos, x); H.live(node.id, 'transform', o) } })
        if (!bound(node, 'rot')) out.push({ ...base, path: `scene/${node.id}/transform/rotation`, label: `${where} › rotation`, unit: '°',
                   help: 'degrees about x, then y, then z', get: () => toArray(t.rot),
                   set: (x, o = {}) => { intoObject(t.rot, x); H.live(node.id, 'transform', o) } })
        if (!bound(node, 'scale')) out.push({ ...base, dims: 1, path: `scene/${node.id}/transform/scale`, label: `${where} › scale`, min: 0.01, max: 10, step: 0.01,
                   get: () => t.scale, set: (x, o = {}) => { t.scale = x > 0 ? x : 0.01; H.live(node.id, 'transform', o) } })
    }

    // ---- the materials: their type's fields and their own parameters, all live
    for (const mat of doc.materials) {
        const where = mat.label || mat.id
        const gui = k => ({ ...(M.MATERIAL_FIELDS[k]?.gui || {}), label: M.MATERIAL_FIELD_LABELS[k] ?? k })
        // a material's own lengths are real mm, as its relief's are (MATERIAL_CODE_TEMPLATE)
        params({ id: mat.id, unit: 'mm', params: mat.params, constants: mat.constants, ranges: mat.ranges, lengths: mat.lengths },
               /* a coating's values only while it has one (materials.js coating): otherwise none is in the shader, and a
                  value moved would be a compile that changes nothing */
               [...(M.MATERIAL_FIELDS_OF[M.typeOf(mat)] || []).filter(k => !M.MATERIAL_FIELDS[k].coat || M.hasCoating(mat.params)),
                ...M.customParams(mat)], where,
               k => k in M.MATERIAL_FIELDS ? gui(k) : {})
        /* ITS RELIEF's, live as the material's own: the owner `<id>#relief`, whose uniforms are its own
           (codegen paramUniform); revealing one shows the material */
        const R = mat.relief
        if (R) params({ id: M.reliefOwner(mat.id), reveal: mat.id, unit: 'mm', params: R.params, constants: R.constants,
                        ranges: R.ranges, lengths: R.lengths }, Object.keys(R.params || {}), `${where} › relief`)
    }

    // ---- the nodes
    M.walk(doc, (node, parent) => {
        if (node.id === doc.root.id) return         // the world frame: nothing of its own to move
        const where = node.label || node.id
        /* ITS OWN JOIN BLEND (model version 14), while it has one and is in a group: live while the group
           combines its children into one shape and so declares it, a compile otherwise -- the group's
           blend's rule, from the same isCsg. Turning one on or off is the panel's, and structural. */
        if (node.joinBlend != null && parent && parent !== doc.root && !bound(node, 'join.blend'))
            out.push({ path: `scene/${node.id}/join/blend`, label: `${where} › join blend`, group: `scene · ${where}`,
                       reveal: reveal(node.id), min: 0, max: 2, step: 0.001, unit, kind: isCsg(parent) ? 'live' : 'structural',
                       help: 'how smoothly it joins its group; live, except where it makes a plain group combine or not',
                       get: () => node.joinBlend, set: (x, o = {}) => H.joinBlend(parent, node, x, o) })
        if (node.kind === 'group') {
            transform(node, where)
            /* a plain union has no blend uniform at all (codegen declares one only for a CSG group), so
               its first move off 0 is a compile: the entry says so, for an optimiser to know */
            if (!bound(node, 'blend')) out.push({ path: `scene/${node.id}/blend`, label: `${where} › blend`, group: `scene · ${where}`, reveal: reveal(node.id),
                       min: 0, max: 2, step: 0.001, unit, kind: isCsg(node) ? 'live' : 'structural',
                       help: 'live, except across 0 on a union: that changes how the children combine, a compile',
                       get: () => node.blend, set: (x, o = {}) => H.blend(node, x, o) })
            // its parameters' schema is its block's (model.js version 16): read through the node's view
            params(M.viewOf(doc, node), free(node, Object.keys(node.params || {})), where)
            return
        }
        transform(node, where)
        if (node.type === 'export') { params(node, free(node, ['size']), where); return }
        if (node.type === 'haze') { params(node, free(node, ['size']), where); haze(node, where); return }
        if (node.type === 'light') {
            if (M.hasFace(node.light)) params(node, free(node, Object.keys(node.params || {})), where)
            light(node, where)
            return
        }
        params(M.viewOf(doc, node), free(node, Object.keys(node.params || {})), where)
    })

    // ---- a light's own settings: the ones that are numbers. The colour and brightness reach the
    //      picture as its face's uniforms (live(id, 'light')); the rest are read by the optics trace
    //      and the photons when they run
    function light(node, where) {
        const L = M.lightOf(node)
        const add = (key, e, patch) => out.push({ path: `scene/${node.id}/light/${key}`, label: `${where} › ${e.label ?? key}`,
            group: `scene · ${where}`, reveal: reveal(node.id), ...e,
            set: (x, o = {}) => H.light(doc, node, patch(x), o) })
        const byFlux = L.flux != null
        if (byFlux) add('flux', { label: 'flux', unit: 'lm', min: 0, get: () => M.lightOf(node).flux }, x => ({ flux: Math.max(0, x) }))
        if (L.shape === 'rayfile') {
            add('emitN', { label: 'emits into n', min: 1, max: 3, step: 0.001, get: () => M.lightOf(node).emitN }, x => ({ emitN: x }))
            return
        }
        if (!byFlux) add('luminance', { label: 'luminance', unit: 'cd/m²', min: 0, get: () => M.lightOf(node).luminance }, x => ({ luminance: Math.max(0, x) }))
        if (L.colourBy === 'cct') {
            add('cct', { label: 'CCT', unit: 'K', min: 1000, max: 15000, step: 10, get: () => M.lightOf(node).cct }, x => ({ cct: x }))
            add('duv', { label: 'Duv', min: -0.05, max: 0.05, step: 0.0005, get: () => M.lightOf(node).duv }, x => ({ duv: x }))
        } else if (L.colourBy === 'xy') {
            add('xy', { label: 'CIE x, y', dims: 2, min: 0.001, max: 0.9, step: 0.0001,
                        get: () => { const c = M.lightOf(node).xy; return [c.x, c.y] } }, ([x, y]) => (x + y < 1 ? { xy: { x, y } } : {}))
        } else add('colour', { label: 'colour', dims: 3, min: 0, get: () => toArray(M.lightOf(node).colour) },
                   x => ({ colour: { r: x[0], g: x[1], b: x[2] } }))
        if (L.distribution === 'cosine') add('n', { label: 'n (cosⁿ)', min: 0, max: 200, step: 0.1, get: () => M.lightOf(node).n }, x => ({ n: x }))
        if (L.distribution !== 'collimated')
            add('halfAngle', { label: 'cone half angle', unit: '°', min: 0.5, max: 90, step: 0.5, get: () => M.lightOf(node).halfAngle }, x => ({ halfAngle: x }))
        add('emitN', { label: 'emits into n', min: 1, max: 3, step: 0.001, get: () => M.lightOf(node).emitN }, x => ({ emitN: x }))
    }
    // ---- a haze box's settings (hazebox.js): the renderer's own uniforms, live (demo.js pushHaze)
    function haze(node, where) {
        const add = (key, e, patch) => out.push({ path: `scene/${node.id}/haze/${key}`, label: `${where} › ${e.label ?? key}`,
            group: `scene · ${where}`, reveal: reveal(node.id), ...e,
            set: (x, o = {}) => H.haze(doc, node, patch(x), o) })
        add('mfp', { label: 'mean free path', unit: 'm', min: 0.001, get: () => M.hazeSettings(node).mfp }, x => ({ mfp: Math.max(0.001, x) }))
        add('albedo', { label: 'albedo', dims: 3, min: 0, max: 1, get: () => toArray(M.hazeSettings(node).albedo) },
            x => ({ albedo: { r: Math.min(1, Math.max(0, x[0])), g: Math.min(1, Math.max(0, x[1])), b: Math.min(1, Math.max(0, x[2])) } }))
        add('g', { label: 'g (forward scattering)', min: -0.95, max: 0.95, step: 0.01, get: () => M.hazeSettings(node).g },
            x => ({ g: Math.min(0.95, Math.max(-0.95, x)) }))
    }
    // ---- the scene's environment (model.js ENVIRONMENT): every setting, whichever source is chosen,
    //      since a timeline may well move the sun of a scene shown in the studio light for now
    const base = () => { try { return hooks.environment?.() || {} } catch { return {} } }
    for (const [k, sp] of Object.entries(M.ENVIRONMENT)) {
        const vec = String(sp.type).startsWith('vec3')
        // the scene's whole environment (model.js environmentOf: what it leaves out is the default), else the renderer's
        const now = () => (M.environmentOf(doc) ?? base())[k] ?? sp.def
        const { label = k, min, max, step, options } = sp.gui
        out.push({ path: `scene/environment/${k}`, label: `Environment › ${label}`, group: 'scene · Environment',
                   reveal: reveal(M.ENVIRONMENT_ID), min, max, step, options, dims: vec ? 3 : 1,
                   get: () => vec ? toArray(now()) : now(),
                   set: (x, o = {}) => H.environment(doc, k, vec ? { r: x[0], g: x[1], b: x[2] } : x, o, base) })
    }
    /* ANIMATED (model.js setAnimated): what the Parameters panel and the timeline's + track offer alone while any value
       is flagged (lib/shell/params.js onlyAnimated). A compile-time value is never: no uniform carries it. */
    const flagged = new Set(M.animatedPaths(doc))           // once: an entry each asking the tree would be entries x nodes
    for (const e of out) if (e.kind !== 'structural' && flagged.has(e.path)) e.animated = true
    return out
}

/**
 * THE VIEW'S ENTRIES AS THE SCENE FLAGS THEM (0.63.0): the renderer's camera and exposure entries (lib/pathtracer/
 * params.js view/camera, view/exposure) marked `animated` where the scene being edited flags them (model.js
 * setAnimated, kept on its root at the renderer's own paths). Unmarked, they left the timeline's + track and the
 * Parameters panel whenever any scene value was flagged (lib/shell/params.js onlyAnimated). The others as they are.
 */
export function viewEntriesFlagged(entries, doc) {
    const flagged = new Set((doc?.root?.animate || []).filter(k => String(k).startsWith('view/')))
    return flagged.size ? entries.map(e => flagged.has(e.path) ? { ...e, animated: true } : e) : entries
}

/**
 * WHAT HAPPENS AFTER A VALUE CHANGED, once, for the registry's setters and the properties panel alike.
 * `o.quiet` = no undo step: the timeline playing, an optimiser's trial. Everything else is an edit.
 */
export function makeAfter({ live = () => { }, commit = () => { }, structure = () => { }, syncSources = () => { }, onLabel = () => { } } = {}) {
    const A = {
        /** a uniform: pushed, and an undo step keyed so a drag coalesces into one (history.js) */
        live(id, k, o = {}) { live(id, k); if (!o.quiet) commit(`${id}.${k}`) },
        /** the shader text changes: an undo step of its own, then the compile */
        structure(o = {}) { if (!o.quiet) commit(null); structure() },
        /** A GROUP'S BLEND is a uniform EXCEPT across zero on a union: a union with no blend folds its
         *  children into the scene one by one, and one with a blend combines them into one shape
         *  first (codegen isCsg) -- different code. The value is set here, so `was` is read first. */
        blend(g, x, o = {}) {
            const was = isCsg(g)
            g.blend = x >= 0 ? x : 0
            if (isCsg(g) !== was) { onLabel(); A.structure(o) }
            else if (was) A.live(g.id, 'blend', o)
            // a union at 0 stays one: there is no uniform to push (the test found this one)
            else if (!o.quiet) commit(`${g.id}.blend`)
        },
        /** A CHILD'S OWN JOIN BLEND (model version 14): the same rule, on its group -- jblend_<id> is
         *  declared only while the group combines its children into one shape (codegen children()). */
        joinBlend(g, c, x, o = {}) {
            const was = isCsg(g)
            c.joinBlend = x >= 0 ? x : 0
            if (isCsg(g) !== was) { onLabel(); A.structure(o) }
            else if (was) A.live(c.id, 'jblend', o)
            else if (!o.quiet) commit(`${c.id}.jblend`)
        },
        /** a light's settings: through the model (which checks them), then its derived luminance and
         *  its face's uniforms. A patch the model refuses changes nothing and says why. */
        /** ONE ENVIRONMENT SETTING. A scene without an environment of its own takes the renderer's
         *  whole set with it the first time, so from then on it is self-contained (model.js). */
        environment(doc, k, v, o = {}, base = () => ({})) {
            const pick = {}
            if (!doc.environment) for (const key of Object.keys(M.ENVIRONMENT)) if (key in base()) pick[key] = base()[key]
            try { M.setEnvironment(doc, { ...pick, [k]: v }) } catch (e) { console.warn('[builder]', e.message); return false }
            live(M.ENVIRONMENT_ID, k)
            if (!o.quiet) commit(`environment.${k}`)
            return true
        },
        light(doc, node, patch, o = {}) {
            if (!Object.keys(patch).length) return false
            try { M.setLight(doc, node.id, patch) } catch (e) { console.warn('[builder]', e.message); return false }
            syncSources()
            live(node.id, 'light')
            if (!o.quiet) commit(`${node.id}.light`)
            return true
        },
        /** a haze box's settings (hazebox.js): through the model, which checks them, then to the renderer live */
        haze(doc, node, patch, o = {}) {
            if (!Object.keys(patch).length) return false
            try { M.setHaze(doc, node.id, patch) } catch (e) { console.warn('[builder]', e.message); return false }
            live(node.id, 'haze')
            if (!o.quiet) commit(`${node.id}.haze`)
            return true
        },
    }
    return A
}

