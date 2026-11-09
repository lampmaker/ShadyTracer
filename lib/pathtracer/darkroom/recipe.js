//======================================================================================================================
// A DARKROOM RECIPE (0.79.0) -- the develop settings as a thing to keep, copy, paste, name and read back.
//
// WHY. A picture's look is many settings now (an exposure, a white balance, eight bands of an equaliser, four curves,
// three wheels ...), and getting it right on one render is work worth keeping: for the next render of the scene, for
// another scene, for undo. So the settings are one plain object (index.js DV), and this file is how it travels -- as
// JSON on the clipboard, as a named preset in this browser, or read back out of a picture the Darkroom saved (its PNG
// says how it was made: export/index.js describe puts the settings in a Comment text chunk).
//
// READ, NEVER TRUSTED. What comes in -- pasted text, a stored preset, a file -- is checked key by key against the
// settings a develop has (`defaults`): a key it does not know is left out, a value of the wrong kind is refused and
// the default stands, the curves are normalised (curves.js). The file name and status line are not settings.
//
// No DOM: lib/pathtracer/test/recipe.test.mjs runs every function here in node, the storage a stand-in.
//======================================================================================================================

import { normalizeCurves } from './curves.js'

export const RECIPE_KIND = 'darkroom-recipe'
export const RECIPE_VERSION = 1
export const PRESETS_KEY = 'darkroom.presets'
/* the parts of the settings object that are not the look */
const NOT_SETTINGS = new Set(['filename', 'status'])

/** The look in `settings` as a recipe: every setting a develop has, nothing else, the curves normalised. */
export function toRecipe(settings, defaults = settings) {
    const out = {}
    for (const k of Object.keys(defaults)) {
        if (NOT_SETTINGS.has(k) || !(k in settings)) continue
        out[k] = k === 'curves' ? normalizeCurves(settings.curves) : settings[k]
    }
    return { app: 'ShadyTracer', kind: RECIPE_KIND, version: RECIPE_VERSION, settings: out }
}

/** The settings a recipe (or a bare settings object) carries, checked against `defaults`: only keys a develop has, of
 *  the kind its default is. Returns { settings, ignored } or { error }. */
export function fromRecipe(obj, defaults) {
    if (!obj || typeof obj !== 'object') return { error: 'not a recipe' }
    if ('kind' in obj && obj.kind !== RECIPE_KIND) return { error: `a ${obj.kind}, not a recipe` }
    const src = obj.settings && typeof obj.settings === 'object' ? obj.settings : obj.develop && typeof obj.develop === 'object' ? obj.develop : obj
    const settings = {}, ignored = []
    for (const [k, v] of Object.entries(src)) {
        if (NOT_SETTINGS.has(k) || ['app', 'kind', 'version'].includes(k)) continue
        if (!(k in defaults)) { ignored.push(k); continue }
        const d = defaults[k]
        if (k === 'curves') { settings.curves = normalizeCurves(v); continue }
        if (typeof d === 'number' && Number.isFinite(+v) && typeof v !== 'boolean' && v !== null && v !== '') settings[k] = +v
        else if (typeof d === 'boolean' && typeof v === 'boolean') settings[k] = v
        else ignored.push(k)
    }
    return { settings, ignored }
}

/** Text from the clipboard as settings, or why not. */
export function recipeFromText(text, defaults) {
    let obj
    try { obj = JSON.parse(text) } catch { return { error: 'not JSON: copy settings from the Darkroom first' } }
    return fromRecipe(obj, defaults)
}

/* A PNG's text chunks, read: tEXt (Latin-1) and iTXt (UTF-8, uncompressed only -- what the Darkroom writes) */
export function pngText(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    const sig = [137, 80, 78, 71, 13, 10, 26, 10]
    if (b.length < 8 || !sig.every((x, i) => b[i] === x)) return null
    const out = {}
    let o = 8
    while (o + 8 <= b.length) {
        const n = ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
        const type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7])
        if (o + 12 + n > b.length) break
        const d = b.subarray(o + 8, o + 8 + n)
        const z = d.indexOf(0)
        if (type === 'tEXt' && z > 0) out[new TextDecoder('latin1').decode(d.subarray(0, z))] = new TextDecoder('latin1').decode(d.subarray(z + 1))
        if (type === 'iTXt' && z > 0 && d[z + 1] === 0) {
            let p = z + 3
            while (p < d.length && d[p]) p++
            p++
            while (p < d.length && d[p]) p++
            p++
            out[new TextDecoder().decode(d.subarray(0, z))] = new TextDecoder().decode(d.subarray(p))
        }
        if (type === 'IEND') break
        o += 12 + n
    }
    return out
}

/** The settings a saved picture carries (a PNG the Darkroom wrote), or why not. */
export function recipeFromPicture(bytes, defaults) {
    const text = pngText(bytes)
    if (!text) return { error: 'not a PNG' }
    if (!text.Comment) return { error: 'this PNG does not say how it was developed' }
    let obj
    try { obj = JSON.parse(text.Comment) } catch { return { error: 'this PNG\'s settings are not readable' } }
    if (obj?.app !== 'ShadyTracer' || !obj.develop) return { error: obj?.light ? 'a light file has no develop settings' : 'not a ShadyTracer picture' }
    return fromRecipe(obj, defaults)
}

/* NAMED PRESETS, in this browser (localStorage: a convenience per viewer, not a project's). A store that is missing,
   full, blocked or holds garbage reads as no presets; nothing here throws. */
export function presets(storage = globalThis.localStorage) {
    const read = () => {
        try {
            const all = JSON.parse(storage?.getItem(PRESETS_KEY) ?? '{}')
            return all && typeof all === 'object' && !Array.isArray(all) ? all : {}
        } catch { return {} }
    }
    const write = all => { try { storage?.setItem(PRESETS_KEY, JSON.stringify(all)); return true } catch { return false } }
    return {
        names: () => Object.keys(read()).sort((a, b) => a.localeCompare(b)),
        get: name => read()[name] ?? null,
        save: (name, recipe) => {
            const n = String(name ?? '').trim().slice(0, 60)
            if (!n) return false
            const all = read()
            all[n] = recipe
            return write(all)
        },
        remove: name => { const all = read(); if (!(name in all)) return false; delete all[name]; return write(all) },
    }
}

/* UNDO AND REDO FOR THE LOOK, as snapshots of the recipe's text -- the builder's way (builder/history.js), kept here
   because this library imports nothing of the application's. A step whose text is the same records nothing; steps with
   the same key inside `window` ms are one (a slider dragged is one undo, not sixty). */
export function makeUndo(initial, { limit = 100, window = 800, now = () => Date.now() } = {}) {
    let current = initial, lastKey = null, lastAt = -Infinity
    const past = [], future = []
    return {
        commit(text, key = null) {
            if (text === current) return false
            const t = now()
            if (!(key != null && key === lastKey && t - lastAt <= window && past.length)) {
                past.push(current)
                if (past.length > limit) past.shift()
            }
            current = text; future.length = 0; lastKey = key; lastAt = t
            return true
        },
        undo() { if (!past.length) return null; future.push(current); current = past.pop(); lastKey = null; return current },
        redo() { if (!future.length) return null; past.push(current); current = future.pop(); lastKey = null; return current },
        reset(text) { current = text; past.length = 0; future.length = 0; lastKey = null },
        get canUndo() { return past.length > 0 },
        get canRedo() { return future.length > 0 },
    }
}
