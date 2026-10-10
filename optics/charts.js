//======================================================================================================================
// THE OPTICS CHARTS THAT EXIST -- the six kinds, and every chart of each kind, with its own settings.
//
//   const CHARTS = chartSet({ key: 'raytracer.charts' })   // the host, BEFORE its layout is restored
//   CHARTS.list()          // [{ id, type, n, title, help, s }] -- one panel each
//   CHARTS.add('map', s)   // another map: 'optics.map.2', "Map 2", its settings s (copied) or the defaults
//   CHARTS.remove(id)      // an added one only; CHARTS.save() after a setting changed
//
// They were six fixed panels, one per kind, and the map's quantity ("shows") was one setting for the map and the
// three charts read off it. The user (2026-10-02): the quantity per chart, and a chart of the same kind added --
// "compare 2D map of intensity and 2D map of CCT". So a chart is an ENTRY here: a kind and its own settings.
//
// THE FIRST OF EACH KIND ALWAYS EXISTS, at the kind's own id ('optics.map'): the Analyse preset opens those six,
// the Optics menu shows them, and a layout saved before this keeps their places. Those can be closed, as any
// panel, but not removed. An added one is `<the kind's id>.<n>`, titled "<the kind's title> <n>".
//
// KEPT BETWEEN VISITS (localStorage, `key`) because the layout is: a saved layout naming 'optics.map.2' loses it
// unless that panel is registered before the restore (lib/shell/README.md), and the host can only register it from
// this list. The settings are kept with it -- a "Map 2" that came back showing illuminance again would have lost
// the one thing it was made for. What is read back is checked against the defaults, key by key and by type: a
// stored value of the wrong kind, or one from a version that had other settings, is the default instead.
//
// No DOM: optics/test/chartset.test.mjs runs it in Node with a stand-in storage.
//======================================================================================================================

/* THE KINDS, for the host to register one panel per chart (before its layout is restored) and to open from its
   menus. `id` is the first chart's; ids are forever (a saved layout names them). */
export const OPTICS_CHARTS = [
    { key: 'map', id: 'optics.map', title: 'Map',
      help: 'A detector\'s map (or the far field on a plane): illuminance, or the colour of the light that arrived -- each map its own. Hold the button down and move to read a place and take the profiles through it; Shift-drag to zoom, double-click for the whole detector.' },
    { key: 'polar', id: 'optics.polar', title: 'Polar', help: 'Luminous intensity against angle, in C planes, around the photometric axis.' },
    { key: 'igamma', id: 'optics.igamma', title: 'I – γ', help: 'Luminous intensity against γ, each C plane a line through C and C + 180.' },
    { key: 'profiles', id: 'optics.profiles', title: 'Profiles', help: 'Along both axes of the map through its point, in what this chart is set to show.' },
    { key: 'rings', id: 'optics.rings', title: 'Rings', help: 'The map averaged over rings about its point, in what this chart is set to show: a round spot with the noise of a whole ring.' },
    { key: 'encircled', id: 'optics.encircled', title: 'Encircled flux', help: 'The share of the map\'s flux within a radius of its point.' },
]
export const FAR_CHARTS = ['polar', 'igamma'], MAP_CHARTS = ['map', 'profiles', 'rings', 'encircled']

/* WHAT A MAP-READ CHART SHOWS (quantities.js): the quantity, and the target Δu'v' is from -- the detector's own
   whole colour ('mix'), a CCT and Duv, or an xy (the Colour mixing tool's two ways to say one) */
const QUANTITY = { q: 'E', target: 'mix', cct: 4000, duv: 0, x: 0.3805, y: 0.3768 }
/* EACH KIND'S OWN SETTINGS: how it DRAWS, nothing that needs a trace. The map's exposure: the true-colour map's
   brightness, x max. Encircled flux has none: it is the share of the flux, whatever a map shows. */
export const CHART_DEFAULTS = {
    map: { ...QUANTITY, isolines: 'lux', exposure: 1 },
    polar: { planes: '0, 90', log: false, decades: 3, view: 'auto' },
    igamma: { planes: '0, 90', log: false, decades: 3, span: 0 },
    profiles: { ...QUANTITY },
    rings: { ...QUANTITY },
    encircled: {},
}

const KIND = Object.fromEntries(OPTICS_CHARTS.map(c => [c.key, c]))

/** A kind's defaults with whatever of `s` fits them: the same keys, the same types. */
const settingsOf = (type, s) => {
    const d = CHART_DEFAULTS[type], out = { ...d }
    if (s && typeof s === 'object') for (const k of Object.keys(d)) if (typeof s[k] === typeof d[k]) out[k] = s[k]
    return out
}

/** The id and title of a kind's n-th chart. */
export const chartName = (type, n) => ({ id: n === 1 ? KIND[type].id : `${KIND[type].id}.${n}`,
                                         title: n === 1 ? KIND[type].title : `${KIND[type].title} ${n}` })

/**
 * @param key      where the list is kept (localStorage); null keeps nothing (a test, a mockup)
 * @param storage  optional: what to keep it in instead of localStorage (getItem, setItem)
 */
export function chartSet({ key = null, storage = globalThis.localStorage } = {}) {
    let stored = []
    try { stored = key && storage ? JSON.parse(storage.getItem(key)) ?? [] : [] } catch { }
    if (!Array.isArray(stored)) stored = []
    const entry = (type, n, s) => ({ ...chartName(type, n), type, n, help: KIND[type].help, s: settingsOf(type, s) })
    // the first of each kind, in the kinds' order; then the added ones, as they were added
    const list = OPTICS_CHARTS.map(c => entry(c.key, 1, stored.find(x => x?.type === c.key && x.n === 1)?.s))
    for (const x of stored)
        if (KIND[x?.type] && Number.isInteger(x.n) && x.n > 1 && !list.some(c => c.type === x.type && c.n === x.n)) list.push(entry(x.type, x.n, x.s))
    const save = () => {
        if (!key || !storage) return
        try { storage.setItem(key, JSON.stringify(list.map(({ type, n, s }) => ({ type, n, s })))) } catch { }
    }
    return {
        list: () => list,
        get: id => list.find(c => c.id === id) ?? null,
        /** Another chart of a kind, numbered after the highest of it there is, with `s` (copied) or the defaults. */
        add: (type, s = null) => {
            if (!KIND[type]) throw new Error(`no chart kind '${type}'`)
            const c = entry(type, Math.max(...list.filter(c => c.type === type).map(c => c.n)) + 1, s && JSON.parse(JSON.stringify(s)))
            list.push(c)
            save()
            return c
        },
        /** An added chart taken away; the first of a kind stays (false). */
        remove: id => {
            const i = list.findIndex(c => c.id === id && c.n > 1)
            if (i < 0) return false
            list.splice(i, 1)
            save()
            return true
        },
        save,
    }
}
