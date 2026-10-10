//======================================================================================================================
// RAY FILES -- the Zemax source files a scene's ray sets name, loaded once and kept by name.
//
// A scene references a ray file by NAME (model version 10, a ray-file light's light.file): 100 000 rays are 2.8 MB,
// too much to carry in a scene file. The file itself is chosen once in the Builder (the ray-file light's
// panel) and kept here -- in memory, and in the browser's IndexedDB so a reload of the page still has
// it. A scene opened on another machine names a file that is not here yet: the Optics page lists it as
// "not loaded", and choosing the file again in the panel fills it in.
//
//   RAYFILES.load(file)    a File from an <input type=file>: parsed (lib/pathtracer/optics/zemax.js)
//   RAYFILES.get(name)     the parsed file { header, rays, total }, or undefined
//   RAYFILES.on(fn)        told whenever a file arrives
//======================================================================================================================
import { parseZemax, RAY_FLOATS } from '../lib/pathtracer/optics/zemax.js'

const DB = 'raytracer.rayfiles', STORE = 'files'
const cache = new Map()
const listeners = new Set()

const db = () => new Promise((res, rej) => {
    try {
        const r = indexedDB.open(DB, 1)
        r.onupgradeneeded = () => r.result.createObjectStore(STORE)
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
    } catch (e) { rej(e) }
})
const idb = async (mode, fn) => {
    const d = await db()
    return new Promise((res, rej) => {
        const t = d.transaction(STORE, mode)
        const q = fn(t.objectStore(STORE))
        t.oncomplete = () => res(q?.result)
        t.onerror = () => rej(t.error)
    })
}

/** Where a parsed file's rays start, in metres in the file's frame: [min, max] -- the ray set's box. */
export function rayBox(parsed) {
    const r = parsed.rays, n = parsed.header.count
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
    for (let k = 0; k < n; k++) for (let c = 0; c < 3; c++) {
        const v = r[k * RAY_FLOATS + c]
        if (v < min[c]) min[c] = v
        if (v > max[c]) max[c] = v
    }
    return n ? [min, max] : [[0, 0, 0], [0, 0, 0]]
}

const arrive = (name, buffer) => {
    const parsed = parseZemax(buffer)            // throws with the reason for a file it cannot read
    cache.set(name, parsed)
    for (const fn of listeners) { try { fn(name, parsed) } catch { } }
    return parsed
}

export const RAYFILES = {
    get: name => cache.get(name),
    on(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    /** Parse and keep a chosen file, under its name; also stored for the next session. */
    async load(file) {
        const buffer = await file.arrayBuffer()
        const parsed = arrive(file.name, buffer)
        try { await idb('readwrite', s => s.put(buffer, file.name)) } catch (e) { console.warn('[rayfiles] not stored for next time:', e?.message) }
        return parsed
    },
    /** Bring a file named by a scene back from the last session, if it was loaded then. */
    async restore(name) {
        if (!name || cache.has(name)) return cache.get(name)
        try {
            const buffer = await idb('readonly', s => s.get(name))
            if (buffer) return arrive(name, buffer)
        } catch (e) { console.warn('[rayfiles] could not read the stored copy:', e?.message) }
        return undefined
    },
}
