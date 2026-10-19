//======================================================================================================================
// COMPONENT PARAMETERS -- a value inside a group as an expression of the parameters of the groups above it
// (PERFORMANCE.md P3, "Component parameters"; the user: "would be nice"). A lens's holder bound to the lens's
// `diameter`, an LED strip's copies to its `count` and `pitch`: the group is the component, its parameters are what a
// customer changes, and everything inside follows.
//
// WHAT A BINDING IS: one line of a node's `bind` (model.js version 18) -- a TARGET, one of the node's own values, and an
// EXPRESSION in builder/expr.js's language (numbers, + - * /, brackets, names, a vector's component as `size.x`):
//   radius = diameter / 2           a number parameter of the node's
//   size.z = height                 a component of a vector or colour parameter (.x .y .z, .r .g .b)
//   pos.z = height + gap            its transform: pos.x .y .z, rot.x .y .z (degrees), scale
//   blend = fillet                  a group's blend;  join.blend = fillet: the node's own join blend
//   copies.count = n                an array's copies, made a row of `count` copies `pitch` apart along `copies.along`
//   copies.pitch = spacing          (x, y or z: a letter, not an expression) -- every resolve makes the row again, so
//   copies.along = y                places typed by hand are not kept while either is bound
//   light.flux = flux               A LIGHT'S OWN SETTINGS (lights.js; 0.69.0), named as the registry names them
//   light.colour.r = tint.r         (params.js scene/<id>/light/<setting>): flux, luminance, colour.r .g .b, cct, duv,
//                                   xy.x .y, n, halfAngle, emitN -- a ray file only its flux and emitN. They live in
//                                   the node's `light`, not its params, and were not targets before 0.69.0: a lamp
//                                   component could size its light but not say how bright or what colour it is (the
//                                   user, 2026-10-19). A binding HOLDS THE WAY THE LIGHT IS GIVEN with its value
//                                   (LIGHT_MODES): light.flux makes it a light set by its flux, light.luminance one set
//                                   by its luminance, light.colour.* one coloured by RGB, light.cct/duv by CCT, light.xy
//                                   by xy -- a cct bound into a light coloured by RGB would be a number nothing reads.
//                                   So two ways at once (light.flux and light.luminance) are refused, and the panel
//                                   holds its "brightness by" and "colour by" while one is bound.
// THE NAMES are the parameters of the groups ABOVE the node, the nearest first -- and, for a group's transform, blend
// and copies, its own parameters too (an LED strip's `copies.count = count`). A vector parameter is read by its
// component (`corner.x`), a colour by its (`tint.r`; 0.69.0: until then a colour parameter could not be read at all).
// Never a parameter's own: a parameter target reads only the groups above, so nothing is bound to itself, and no order
// of evaluation is needed but the tree's and, within a node, its parameters before the rest (applyBindings).
// A WHOLE VECTOR OR COLOUR binds in one line (0.69.0), `light.colour = tint`, `pos = at`: kept as a line a component.
//
// RESOLVED ON THE CPU AND WRITTEN AS VALUES. The document holds both the expression and the value it last gave, so
// codegen, the bounds, the panel, the records -- everything that reads a value -- reads a number as it always did, and
// a shader never sees a binding. A group parameter changed (a slider, the timeline) resolves again, and each value that
// moved is pushed live as if it had been dragged (builder/demo.js live): a uniform, a record, or -- an array's count in
// codegen -- a compile. So a binding costs the shader nothing.
//
// A NAME NO GROUP ABOVE HAS (the node moved out of its component, the parameter renamed elsewhere) is a problem said,
// never a guess: the value stays what it last was, and resolve() lists it.
//
// PURE, as model.js and expr.js: no DOM, no device. test/bind.test.mjs.
//======================================================================================================================

import { parseExpr, evalExpr, namesOf } from './expr.js'

const AXES = ['x', 'y', 'z'], RGB = ['r', 'g', 'b']
/** The transform's targets, in the order the panel shows them */
export const TRANSFORM_TARGETS = ['pos.x', 'pos.y', 'pos.z', 'rot.x', 'rot.y', 'rot.z', 'scale']
/** An array's targets: two expressions and an axis */
export const COPIES_TARGETS = ['copies.count', 'copies.pitch', 'copies.along']
/** A light's own settings (lights.js LIGHT_DEFAULTS), each a number or a component of one: a face's, then a ray file's */
export const LIGHT_TARGETS = ['light.flux', 'light.luminance', 'light.colour.r', 'light.colour.g', 'light.colour.b', 'light.cct',
    'light.duv', 'light.xy.x', 'light.xy.y', 'light.n', 'light.halfAngle', 'light.emitN']
const RAYFILE_TARGETS = ['light.flux', 'light.emitN']
/** WHAT A LIGHT SETTING HOLDS BESIDES ITS VALUE: [which choice, the way it says] -- the panel's "brightness by" (a light
 *  is set by its flux exactly when its flux is not null: lights.js) and "colour by" (colourBy). The rest are numbers
 *  read whatever the light is given by (n only by cos^n, halfAngle not by a collimated one: unused there, not wrong). */
export const LIGHT_MODES = { flux: ['brightness', 'flux'], luminance: ['brightness', 'luminance'],
    colour: ['colour', 'rgb'], cct: ['colour', 'cct'], duv: ['colour', 'cct'], xy: ['colour', 'xy'] }
/** Whether a target is a light's own setting, and which: 'light.colour.r' -> 'colour' */
export const isLightTarget = t => t.startsWith('light.')
export const lightSettingOf = t => isLightTarget(t) ? t.split('.')[1] : null
/** TWO WAYS AT ONCE: the first pair of `targets` (in order) that give one choice two ways -- light.flux with
 *  light.luminance, light.colour.r with light.cct -- as { target, other, choice }, or null. */
export function lightModeClash(targets) {
    const seen = {}
    for (const t of targets) {
        const m = LIGHT_MODES[lightSettingOf(t)]
        if (!m) continue
        const [choice, way] = m, was = seen[choice]
        if (was && was.way !== way) return { target: t, other: was.target, choice }
        seen[choice] ??= { way, target: t }
    }
    return null
}
const clashSaid = c => `'${c.target}' and '${c.other}' give its ${c.choice} two ways: bind one`

/* the kind of a parameter's value, as model.js paramKind says it (here so this file imports nothing of the model) */
const kindOf = v => typeof v === 'number' ? 'number' : v && typeof v === 'object' && !Array.isArray(v) && !Array.isArray(v.path)
    ? ('x' in v ? 'vector' : 'r' in v ? 'colour' : 'other') : 'other'

/**
 * EVERY TARGET A NODE HAS, in order: its number parameters, each component of its vectors and colours, its
 * transform's, a group's blend, its own join blend, and a plain group's copies. `node` is read through the model's
 * view (its block's schema): its params are its values. `opts`: { plainGroup, root } -- whether it can be an array
 * (no code, no joins: model.js setCopies's rule) and whether it is the root (which has none of these).
 */
export function targetsOf(node, { plainGroup = false, root = false } = {}) {
    if (root || !node) return []
    const out = []
    for (const [k, v] of Object.entries(node.params || {})) {
        const kind = kindOf(v)
        if (kind === 'number') out.push(k)
        else if (kind === 'vector') { for (const c of AXES) if (c in v) out.push(`${k}.${c}`) }
        else if (kind === 'colour') { for (const c of RGB) if (c in v) out.push(`${k}.${c}`) }
    }
    // a light's own settings, after its size (and so among the first a refusal lists)
    if (node.type === 'light') out.push(...(node.light?.shape === 'rayfile' ? RAYFILE_TARGETS : LIGHT_TARGETS))
    out.push(...TRANSFORM_TARGETS)
    if (node.kind === 'group') out.push('blend')
    out.push('join.blend')
    if (plainGroup) out.push(...COPIES_TARGETS)
    return out
}

/** WHAT A TARGET IS CALLED WHEN IT IS PUSHED LIVE (builder/demo.js live(id, k)): a parameter's own name, 'transform',
 *  'blend', 'jblend' (codegen joinBlendName), 'copies', 'light' (a light's colour, luminance and beam, all three) */
export const liveKeyOf = target => TRANSFORM_TARGETS.includes(target) ? 'transform' : target === 'blend' ? 'blend'
    : target === 'join.blend' ? 'jblend' : target.startsWith('copies.') ? 'copies' : isLightTarget(target) ? 'light'
    : target.split('.')[0]

/**
 * A SCOPE: the parameters of the groups above a node, nearest first -- [{ id, params }]. lookupIn(scope)(name, comp)
 * is that name's number, or { error } said so the user can act on it.
 */
export function lookupIn(scope) {
    return (name, comp) => {
        const at = scope.find(s => s.params && name in s.params)
        if (!at) return { error: `'${name}' is not a parameter of any group above` }
        const v = at.params[name], kind = kindOf(v)
        if (kind === 'number') return comp ? { error: `'${name}' is a number: it has no .${comp}` } : { value: v }
        if (kind === 'vector') return !comp ? { error: `'${name}' is a vector: say which component, ${name}.x` }
            : comp in v ? { value: v[comp] } : { error: `'${name}' has no .${comp}` }
        if (kind === 'colour') return !comp ? { error: `'${name}' is a colour: say which component, ${name}.r` }
            : RGB.includes(comp) && comp in v ? { value: v[comp] } : { error: `'${name}' is a colour: its components are .r, .g, .b` }
        return { error: `'${name}' is a value an expression cannot read` }
    }
}

/** Whether a target is one of the node's parameters (read from the groups above alone), not its placement */
export const isParamTarget = t => !(TRANSFORM_TARGETS.includes(t) || t === 'blend' || t === 'join.blend' || t.startsWith('copies.'))

/**
 * READ A NODE'S BINDINGS AS TEXT: one `target = expression` a line, blank lines and `//` comments skipped. `targets`
 * the node's (targetsOf), `lookupFor(target)` the lookup its scope gives that target (lookupIn: the groups above for a
 * parameter, the node's own parameters too for the rest). Returns { bind, errors }, bind the object to store
 * ({ target: expression } in the order written) and errors [{ line, col, message }], both columns 1-based.
 */
export function parseBindings(text, targets, lookupFor) {
    const bind = {}, errors = []
    String(text ?? '').split('\n').forEach((raw, i) => {
        const line = i + 1
        const cut = raw.indexOf('//'), body = cut >= 0 ? raw.slice(0, cut) : raw
        if (!body.trim()) return
        const eq = body.indexOf('=')
        if (eq < 0) return errors.push({ line, col: 1, message: 'a binding is target = expression' })
        const target = body.slice(0, eq).trim(), lead = body.slice(0, eq).search(/\S/) + 1
        const rhs = body.slice(eq + 1), start = eq + 1 + (rhs.length - rhs.trimStart().length) + 1
        const expr = rhs.trim()
        /* A WHOLE VECTOR OR COLOUR IN ONE LINE (0.69.0): `light.colour = tint`, `size = corner`, `pos = at` -- a
           parameter's bare name, read component by component. Stored one line a component, so the text shows what it
           means once applied, and everything that reads a binding reads it as it always did. */
        const parts = targets.includes(target) ? [] : targets.filter(x => x.startsWith(target + '.') && [...AXES, ...RGB].includes(x.slice(target.length + 1)))
        if (parts.length) {
            const r = parseExpr(expr)
            if (r.error) return errors.push({ line, col: start + r.at - 1, message: r.error })
            if (!('name' in r.ast) || r.ast.comp)
                return errors.push({ line, col: start, message: `a whole ${target} takes a parameter's name (${target} = tint), or one line a component: ${parts[0]} = ...` })
            for (const t of parts) if (!add(line, lead, t, `${r.ast.name}.${t.slice(target.length + 1)}`, start)) return
            return
        }
        // a light's own settings are written light.<setting>, as the registry has them: `flux = ...` is the natural slip
        if (!targets.includes(target) && targets.includes(`light.${target}`))
            return errors.push({ line, col: lead || 1, message: `'${target}' is a light setting: write light.${target}` })
        if (!targets.includes(target))
            return errors.push({ line, col: lead || 1, message: `'${target}' is not a value of this node: ${targets.slice(0, 12).join(', ')}${targets.length > 12 ? ', ...' : ''}` })
        if (target === 'copies.along') {
            if (target in bind) return errors.push({ line, col: lead, message: `'${target}' is bound twice` })
            if (!AXES.includes(expr)) return errors.push({ line, col: start, message: 'copies.along is x, y or z' })
            bind[target] = expr
            return
        }
        add(line, lead, target, expr, start)
    })
    /* ONE TARGET'S EXPRESSION, checked and kept: false (and an error at its line) when it is not. `start` is the column
       the expression starts at; a whole value's components are written by this file, so an error in one is put there. */
    function add(line, lead, target, expr, start) {
        if (target in bind) return !errors.push({ line, col: lead, message: `'${target}' is bound twice` })
        const clash = lightModeClash([...Object.keys(bind), target])
        if (clash) return !errors.push({ line, col: lead, message: clashSaid(clash) })
        const r = parseExpr(expr)
        if (r.error) return !errors.push({ line, col: start + r.at - 1, message: r.error })
        const lookup = lookupFor(target)
        for (const n of namesOf(r.ast)) {
            const v = lookup(n.name, n.comp)
            if (v.error) return !errors.push({ line, col: start + n.at - 1, message: v.error })
        }
        bind[target] = expr
        return true
    }
    if (('copies.along' in bind) && !('copies.count' in bind) && !('copies.pitch' in bind))
        errors.push({ line: 1, col: 1, message: 'copies.along says the axis of a row: bind copies.count or copies.pitch with it' })
    return { bind, errors }
}

/** A node's bindings as the text parseBindings reads */
export const bindingsText = bind => Object.entries(bind || {}).map(([t, e]) => `${t} = ${e}`).join('\n')

/** One expression's value in a scope: { value } or { error } */
export function evaluate(expr, lookup) {
    const r = parseExpr(expr)
    if (r.error) return { error: `${r.error} (column ${r.at})` }
    for (const n of namesOf(r.ast)) { const v = lookup(n.name, n.comp); if (v.error) return v }
    const value = evalExpr(r.ast, (name, comp) => lookup(name, comp).value)
    return Number.isFinite(value) ? { value } : { error: `it comes to ${value}` }
}

/** Everything wrong with a node's bindings as a whole, for the file's check (model.js bindProblems): two ways at once */
export function bindingsProblems(bind) {
    const c = lightModeClash(Object.keys(bind || {}))
    return c ? [clashSaid(c)] : []
}

/**
 * WRITE A NODE'S BINDINGS' VALUES INTO IT, in its scope (lookupFor, as parseBindings's), its parameters first -- the
 * rest may read them: returns { changed: [live key, ...] (each once), problems: [message, ...] }. `copiesRow(n, pitch,
 * axis)` and `arrayMax` are the model's (model.js copiesRow, ARRAY_MAX), passed in so this file stays the model's
 * dependency, not the other way round; so is `setLight(node, patch)`, which writes a patch of a light's settings --
 * an object's components over what it has -- when it is sound and returns { changed, problems }. A target whose value
 * is not sound -- a number that is not, a scale below what it can be, a count out of range, a light setting its
 * checks refuse (a CCT out of range, a luminance on a collimated light) -- is a problem and keeps its value.
 */
export function applyBindings(node, lookupFor, { copiesRow, arrayMax, setLight = null }) {
    const changed = new Set(), problems = []
    const bind = node.bind || {}
    const say = (t, m) => problems.push(`'${node.id}' ${t}: ${m}`)
    let row = null
    const light = {}                // setting -> its value, or { component: value }
    const order = [...Object.entries(bind).filter(([t]) => isParamTarget(t)), ...Object.entries(bind).filter(([t]) => !isParamTarget(t))]
    for (const [t, expr] of order) {
        if (t === 'copies.along') continue
        const r = evaluate(expr, lookupFor(t))
        if (r.error) { say(t, r.error); continue }
        let v = r.value
        if (t.startsWith('copies.')) { (row ??= {})[t.slice(7)] = v; continue }
        if (isLightTarget(t)) {
            const [, k, c] = t.split('.')
            if (c === undefined) light[k] = v
            else (light[k] ??= {})[c] = v
            continue
        }
        if (t === 'scale' && !(v > 0)) { say(t, `a scale is above 0 (it comes to ${v})`); continue }
        if ((t === 'blend' || t === 'join.blend') && v < 0) v = 0
        if (TRANSFORM_TARGETS.includes(t)) {
            const T = node.transform
            if (!T) { say(t, 'no transform'); continue }
            if (t === 'scale') { if (T.scale !== v) { T.scale = v; changed.add('transform') } continue }
            const [part, c] = t.split('.')
            if (T[part][c] !== v) { T[part][c] = v; changed.add('transform') }
            continue
        }
        if (t === 'blend') { if (node.blend !== v) { node.blend = v; changed.add('blend') } continue }
        if (t === 'join.blend') { if (node.joinBlend !== v) { node.joinBlend = v; changed.add('jblend') } continue }
        const [k, c] = t.split('.')
        const P = node.params || {}
        if (!(k in P)) { say(t, `no parameter '${k}' any more`); continue }
        if (c === undefined) {
            if (typeof P[k] !== 'number') { say(t, `'${k}' is not a number now`); continue }
            if (P[k] !== v) { P[k] = v; changed.add(k) }
        } else {
            if (!P[k] || typeof P[k] !== 'object' || !(c in P[k])) { say(t, `'${k}' has no .${c} now`); continue }
            if (P[k][c] !== v) { P[k][c] = v; changed.add(k) }
        }
    }
    /* A LIGHT'S SETTINGS, each with the way it is given (LIGHT_MODES) and checked as the panel's are (setLight): one
       patch a choice -- cct with duv, x with y, a colour's three components together -- so one refused keeps only its
       own value */
    const lightTargets = Object.keys(bind).filter(isLightTarget)
    if (lightTargets.length) {
        const of = k => lightTargets.filter(t => lightSettingOf(t) === k)
        const patches = []
        if ('flux' in light) patches.push([of('flux'), { flux: light.flux }])
        if ('luminance' in light) patches.push([of('luminance'), { luminance: light.luminance, flux: null }])
        if ('colour' in light) patches.push([of('colour'), { colourBy: 'rgb', colour: light.colour }])
        if ('cct' in light || 'duv' in light) patches.push([[...of('cct'), ...of('duv')], { colourBy: 'cct',
            ...('cct' in light ? { cct: light.cct } : {}), ...('duv' in light ? { duv: light.duv } : {}) }])
        if ('xy' in light) patches.push([of('xy'), { colourBy: 'xy', xy: light.xy }])
        for (const k of ['n', 'halfAngle', 'emitN']) if (k in light) patches.push([of(k), { [k]: light[k] }])
        for (const [ts, patch] of patches) {
            if (node.type !== 'light' || !setLight) { say(ts.join(', '), 'not a light'); continue }
            const r = setLight(node, patch)
            if (r.problems.length) say(ts.join(', '), r.problems.map(m => m.replace(`'${node.id}': `, '')).join('; '))
            else if (r.changed) changed.add('light')
        }
    }
    if (row) {
        // the row as it is, where only one of the two is bound: its count, and the pitch between its first two
        const now = node.copies || []
        const along = bind['copies.along'] ?? 'x'
        const pitchNow = now.length > 1 ? now[1].pos[along] - now[0].pos[along] : 1
        const n = Math.round(row.count ?? now.length ?? 1), pitch = row.pitch ?? pitchNow
        if (!(n >= 1 && n <= arrayMax)) say('copies.count', `an array has 1 to ${arrayMax} copies (it comes to ${n})`)
        else {
            const next = copiesRow(n, pitch, along)
            if (JSON.stringify(next) !== JSON.stringify(node.copies ?? null)) { node.copies = next; changed.add('copies') }
        }
    }
    return { changed: [...changed], problems }
}

/** What a node's bindings hold, for what honours a lock (model.js heldOf): its transform's position or turn, and its
 *  parameters or scale -- the two a lock holds. A light's own settings are neither: its flux bound leaves its size to
 *  stretch (the panel holds those rows itself). */
export function boundOf(node) {
    const t = Object.keys(node?.bind || {})
    return { position: t.some(x => x.startsWith('pos.') || x.startsWith('rot.')),
             params: t.some(x => x === 'scale' || (isParamTarget(x) && !isLightTarget(x))) }
}
