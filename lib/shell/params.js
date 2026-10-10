//======================================================================================================================
// PARAMS -- every setting a person can change, by a path, for everything that is not a person.
//
//   const P = makeParams()
//   P.provide('scene', () => [...entries])     // a provider: asked afresh every time (see below)
//   P.read('scene/lens1/radius')               // the live value (an array when dims > 1)
//   P.write('scene/lens1/radius', 2.5)         // coerced to its range, set, an undo step, listeners told
//   P.apply({ path: value, ... })              // the timeline's verb: set, but no undo step each
//   P.find('radius')                           // for the command palette
//   P.onChange(({ path, value, source }) => ...)
//   P.changed(path, source)                    // a control that edited the value itself says so
//
// WHY: the properties panel, the timeline, a future optimiser, the command palette and a console
// script all change the same settings. Written once per consumer, they drift -- the renderer's
// scene page once wrote uniforms and never the document, so a scene tuned there saved as it was
// before (builder/panel.js says so). Here there is one list, and each entry's set() does
// everything a change needs: the document, the renderer, the undo step.
//
// THE CONTRACT IS THE TIMELINE'S (lib/timeline/registry.js): an entry is
//   { id, label, group, get, set, min, max, step, options, dims }
// and this object answers get / has / list / range / current / coerce / apply as that registry
// does, so makeSequencer({ registry: P }) takes it as it is. The coercion is the timeline's own
// function, not a copy of it. What an entry adds:
//   path     the id, spelled as where it lives: 'scene/<node id>/<param>', 'renderer/tracing/maxbounce'.
//            IDS, NEVER LABELS: a label is renamed, and a timeline track or an optimiser's variable
//            saved against it would then name nothing (builder/model.js, "identity is an id").
//   unit     for a reader, optional
//   help     one line for a tooltip, optional
//   kind     'live'        a uniform write: the next frame shows it
//            'structural'  the shader changes: a compile, seconds. An optimiser must know this.
//   set(v, { quiet })  quiet = no undo step (the timeline playing is not an edit)
//   reveal() optional: show the control that edits it (the palette runs it)
//   animated true for a value its owner flagged as one to animate (the builder's scene: model.js setAnimated)
//
// ONLY THE ANIMATED, WHILE ANY ARE (the user, 2026-10-08: "the parameters list can then reflect only those properties,
// which makes it easier to find them when animating"). `shown()` is what a list of settings offers a person -- the
// Parameters panel, the timeline's + track: every entry, or only the animated ones while `onlyAnimated` is on. On by
// default whenever any entry is animated; a person's choice (setOnlyAnimated) holds until the page is reloaded. list()
// and get() stay whole: a track already on a value not flagged goes on playing it.
//
// PROVIDERS ARE ASKED EVERY TIME, NOT CACHED. The scene's parameters are its nodes', and nodes come
// and go with every edit, undo and file opened. A cached list would be right for the only caller
// that existed when it was written and wrong the first time a second one deleted a node -- the
// failure this repository keeps repeating (CLAUDE.md). A few hundred small objects per call is
// nothing next to a frame.
//======================================================================================================================

import { makeRegistry } from '../timeline/registry.js'

const TIMELINE = makeRegistry()          // for its coerce() only: the same rounding the timeline applies

/** A value as the registry speaks it: a number, or an array of numbers for dims > 1. */
const copy = v => Array.isArray(v) ? v.slice() : v

export function makeParams() {
    const providers = new Map()          // name -> () => entries
    const listeners = new Set()
    let onlyAnimated = null              // null: on while any entry is animated (the default); else a person's choice

    const normal = (e, name) => {
        const path = e.path ?? e.id
        const q = { dims: 1, kind: 'live', group: name, ...e, path, id: path }
        if (q.options && !q.interp) q.interp = 'step'
        return q
    }
    const all = () => {
        const out = []
        for (const [name, fn] of providers) {
            let list = []
            try { list = fn() || [] } catch (e) { console.error(`[params] provider '${name}' failed:`, e) }
            for (const e of list) out.push(normal(e, name))
        }
        return out
    }
    const emit = ev => { for (const fn of listeners) { try { fn(ev) } catch (e) { console.error('[params] listener failed:', e) } } }

    const P = {
        /** Register a provider under a name (replacing one of that name). Returns the undo. */
        provide(name, fn) { providers.set(name, fn); return () => providers.delete(name) },

        // ---- the timeline's registry, as lib/timeline/registry.js answers it ----------------
        list: (prefix = '') => all().filter(p => !prefix || p.path === prefix || p.path.startsWith(prefix.endsWith('/') ? prefix : prefix + '/')),
        get: path => all().find(p => p.path === path),
        has: path => !!P.get(path),
        range: p => TIMELINE.range(p),
        current: path => { const p = P.get(path); return p ? copy(p.get()) : undefined },
        coerce: (p, v) => TIMELINE.coerce(p, v),
        /** Write { path: value } through the setters, quietly (no undo step each: the timeline plays
         *  through this). Returns the paths that were known. */
        apply(values, source = 'apply') {
            const byPath = new Map(all().map(p => [p.path, p]))
            const done = []
            for (const path in values) {
                const p = byPath.get(path)
                if (!p) continue
                const v = P.coerce(p, values[path])
                p.set(v, { quiet: true })
                done.push(path)
                emit({ path, value: copy(v), source })
            }
            return done
        },

        // ---- what a list of settings offers a person: the animated alone, while any are and the filter is on --
        /** Whether any entry is animated. */
        anyAnimated: () => all().some(p => p.animated),
        /** Whether the lists offer only the animated entries: a person's choice, or on while any are. `any`: anyAnimated()
         *  if the caller has it already (every provider is asked for it). */
        onlyAnimated: (any = null) => onlyAnimated ?? (any ?? P.anyAnimated()),
        /** Choose (true, false), or go back to the default (null). */
        setOnlyAnimated(on) { onlyAnimated = on == null ? null : !!on },
        /** list(prefix), but only the animated entries while onlyAnimated() and any are. */
        shown(prefix = '') {
            const l = P.list(prefix), any = l.some(p => p.animated)
            return any && P.onlyAnimated(any) ? l.filter(p => p.animated) : l
        },

        // ---- for people and scripts ------------------------------------------------------
        read: path => P.current(path),
        /** Set one value as an edit: coerced, set, one undo step, listeners told. Throws on a path
         *  that does not exist -- a typo that silently does nothing is the worst outcome for a
         *  script or an optimiser, which would then "optimise" a constant (RT.set says the same). */
        write(path, value, { source = 'write', quiet = false } = {}) {
            const p = P.get(path)
            if (!p) throw new Error(`no parameter '${path}'`)
            if ((p.dims | 0) > 1 && (!Array.isArray(value) || value.length !== p.dims))
                throw new Error(`'${path}' takes ${p.dims} numbers`)
            const v = P.coerce(p, value)
            p.set(v, { quiet })
            emit({ path, value: copy(v), source })
            return copy(v)
        },
        /** A control that edits the value itself (a slider bound to the document) says so here, so
         *  everything else that shows it can follow. */
        changed(path, source = 'panel') {
            // a slider reports every step of a drag: the value (every provider asked) only if a listener reads it
            emit({ path, source, get value() { return P.current(path) } })
        },
        onChange(fn) { listeners.add(fn); return () => listeners.delete(fn) },

        /** Parameters matching every word of the query, in label, path or group; best first. */
        find(query = '', limit = 50) {
            const words = String(query).toLowerCase().split(/\s+/).filter(Boolean)
            const scored = []
            for (const p of all()) {
                const label = String(p.label ?? '').toLowerCase()
                const hay = `${label} ${p.path.toLowerCase()} ${String(p.group ?? '').toLowerCase()}`
                if (!words.every(w => hay.includes(w))) continue
                // a label that starts with the query first, then one that has it, then the rest
                const s = !words.length ? 0 : label.startsWith(words[0]) ? 0 : words.every(w => label.includes(w)) ? 1 : 2
                scored.push([s, p])
            }
            scored.sort((a, b) => a[0] - b[0] || a[1].path.localeCompare(b[1].path))
            return scored.slice(0, limit).map(x => x[1])
        },
        /** A value typed by a person, as this entry takes it: an option by its name or its number,
         *  a vector as its numbers separated by commas or spaces. Throws on anything else -- the
         *  palette's "radius = 2" says what was wrong rather than setting NaN. */
        parse(p, text) {
            const t = String(text).trim()
            if (p.options) {
                const hit = Object.entries(p.options).find(([name]) => name.toLowerCase() === t.toLowerCase())
                if (hit) return hit[1]
                if (Object.values(p.options).includes(+t) && t !== '') return +t
                throw new Error(`${p.label}: one of ${Object.keys(p.options).join(', ')}`)
            }
            const nums = t.split(/[\s,;]+/).filter(Boolean).map(Number)
            const n = p.dims | 0 || 1
            if (nums.length !== n || !nums.every(Number.isFinite)) throw new Error(`${p.label} takes ${n === 1 ? 'a number' : `${n} numbers`}`)
            return n === 1 ? nums[0] : nums
        },
        /** How a value reads: numbers to four figures, options by name, vectors comma separated. */
        format(p, v = p.get()) {
            if (p.options) { const hit = Object.entries(p.options).find(([, o]) => o === v); return hit ? hit[0] : String(v) }
            const one = x => typeof x === 'number' ? +x.toPrecision(4) + '' : String(x)
            return (Array.isArray(v) ? v.map(one).join(', ') : one(v)) + (p.unit ? ` ${p.unit}` : '')
        },
    }
    return P
}

// ---- helpers for providers: the document's value shapes as the registry's arrays ---------------------
/** {x,y}, {x,y,z}, {x,y,z,w}, {r,g,b} or {r,g,b,a} as an array, and back into the same object (kept, so bindings
 *  to it stay live). THE VALUE'S OWN COMPONENTS: this said x, y, z for anything with an x, so a 2D {x, y} (the
 *  builder's pyramid's base, the first one) came back with z = NaN written into it -- which changed its
 *  uniform's type. Named KEYS3 for what it was; every caller gets the right count now. */
export const KEYS3 = v => v && typeof v === 'object'
    ? ('x' in v ? ['x', 'y', ...('z' in v ? ['z'] : []), ...('w' in v ? ['w'] : [])]
       : 'r' in v ? ['r', 'g', 'b', ...('a' in v ? ['a'] : [])] : null) : null
export const toArray = v => { const k = KEYS3(v); return k ? k.map(c => +v[c]) : v }
export const intoObject = (obj, arr) => { const k = KEYS3(obj); k.forEach((c, i) => { obj[c] = +arr[i] }); return obj }
