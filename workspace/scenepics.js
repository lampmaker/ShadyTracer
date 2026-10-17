//======================================================================================================================
// THE SCENES' PICTURES -- one per scene of a project, the last picture the view had of it, for its card over the tree
// (builder/scenestrip.js) and in the Project panel (projectview.js); and how long the scene took to open (0.63.0;
// UI_PLAN.md section 11).
//
// TAKEN FROM THE LIVE PICTURE, NEVER RENDERED FOR THE PURPOSE. Only the scene being worked on is compiled, and a
// compile is seconds, so another scene's picture can only be the one it had when it was last shown. startCapture asks
// the renderer (RT.thumbnail: a copy of the accumulation, developed small; nothing stopped or restarted) once a
// picture has SETTLED: the scene shown and not compiling, nothing moving, 32 samples since the picture last started
// over -- and once per such start (RT.resets), so a still picture costs nothing more.
//
// KEPT in a database of its own (`raytracer.scenepics`), not the projects' (store.js): pictures are not the project, are
// never in a file, and a project's write should not carry them. Keyed `<project id>:<scene key>` -- scene keys start
// again in every project. A project deleted takes its pictures with it (removeProject). This tab's copy of another
// tab's project has no id until something in it changes: its pictures stay in memory until then.
//
//   const pics = createScenePics({ backend: indexedDbPics() })      // memoryPics() where IndexedDB is refused, and in tests
//   pics.get(projectId, key)  -> { url, openMs, at } | null    (the first ask reads the store, then tells on())
//   pics.put(projectId, key, { blob, openMs })                 either or both
//   pics.removeProject(projectId)        pics.on(fn)
//   const C = startCapture({ RT, BUILDER, pics, project: () => id })   C.tick()  C.stop()
//======================================================================================================================
/* global indexedDB -- the browser's */

/** Pictures kept in memory: for tests, and a browser that refuses storage. */
export function memoryPics() {
    const m = new Map()
    return {
        get: async k => m.get(k) ?? null,
        put: async (k, v) => { m.set(k, v) },
        keys: async prefix => [...m.keys()].filter(k => k.startsWith(prefix)),
        del: async k => { m.delete(k) },
    }
}

/** Pictures kept in the browser's IndexedDB, a database of their own. */
export function indexedDbPics(name = 'raytracer.scenepics', store = 'pics') {
    const db = () => new Promise((res, rej) => {
        const q = indexedDB.open(name, 1)
        q.onupgradeneeded = () => q.result.createObjectStore(store)
        q.onsuccess = () => res(q.result)
        q.onerror = () => rej(q.error)
    })
    const run = async (mode, fn) => {
        const d = await db()
        try {
            return await new Promise((res, rej) => {
                const t = d.transaction(store, mode), s = t.objectStore(store)
                const q = fn(s)
                t.oncomplete = () => res(q?.result)
                t.onerror = () => rej(t.error)
            })
        } finally { d.close() }
    }
    return {
        get: k => run('readonly', s => s.get(k)).then(v => v ?? null),
        put: (k, v) => run('readwrite', s => s.put(v, k)),
        keys: prefix => run('readonly', s => s.getAllKeys(IDBKeyRange.bound(prefix, prefix + '￿'))),
        del: k => run('readwrite', s => s.delete(k)),
    }
}

/**
 * @param backend  memoryPics() or indexedDbPics()
 * @param url      blob => an object URL (injectable for tests)
 * @param revoke   url => void
 * @param now      the clock
 */
export function createScenePics({ backend = memoryPics(), url = b => URL.createObjectURL(b), revoke = u => URL.revokeObjectURL(u), now = () => Date.now() } = {}) {
    const mem = new Map()               // '<project>:<key>' -> { url, blob, openMs, at } | null (asked, being read)
    const listeners = []
    const tell = () => { for (const fn of listeners) { try { fn() } catch (e) { console.warn('[scenepics]', e) } } }
    // a copy not yet kept has no id: its pictures are kept here only, under '~'
    const full = (pid, key) => `${pid ?? '~'}:${key}`
    const shown = e => e && { url: e.url, openMs: e.openMs ?? null, at: e.at ?? null }

    return {
        get(pid, key) {
            const k = full(pid, key)
            if (mem.has(k)) return shown(mem.get(k))
            mem.set(k, null)
            if (pid != null) backend.get(k).then(v => {
                if (!v || mem.get(k)) return          // nothing kept, or a newer one put meanwhile
                mem.set(k, { url: v.blob ? url(v.blob) : null, blob: v.blob ?? null, openMs: v.openMs ?? null, at: v.at ?? null })
                tell()
            }).catch(e => console.warn('[scenepics] read:', e?.message))
            return null
        },
        /** A new picture, a new time to open, or both: what is not given is kept. */
        async put(pid, key, { blob, openMs } = {}) {
            const k = full(pid, key), old = mem.get(k) ?? (pid != null ? await backend.get(k).catch(() => null) : null)
            const e = { url: old?.url ?? null, blob: old?.blob ?? null, openMs: old?.openMs ?? null, at: old?.at ?? null }
            if (blob) { if (old?.url && mem.get(k)) revoke(old.url); e.blob = blob; e.url = url(blob); e.at = now() }
            else if (old?.blob && !mem.get(k)) e.url = url(old.blob)
            if (openMs != null) e.openMs = openMs
            mem.set(k, e)
            tell()
            if (pid != null) await backend.put(k, { blob: e.blob, openMs: e.openMs, at: e.at }).catch(err => console.warn('[scenepics] write:', err?.message))
        },
        /** A project deleted: its pictures go too. */
        async removeProject(pid) {
            if (pid == null) return
            const prefix = `${pid}:`
            for (const [k, e] of mem) if (k.startsWith(prefix)) { if (e?.url) revoke(e.url); mem.delete(k) }
            try { for (const k of await backend.keys(prefix)) await backend.del(k) } catch (e) { console.warn('[scenepics] remove:', e?.message) }
            tell()
        },
        on(fn) { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn), 1) },
    }
}

/**
 * Take the scene's picture once it has settled -- looked at every `every` ms.
 * @param RT        the renderer: thumbnail, resets, hud.samples, sceneBusy, offscreenBusy, interacting
 * @param BUILDER   demo.js's: current, showing, applying, doc
 * @param pics      createScenePics'
 * @param project   () => the id of the project this tab works on (null for a copy not yet kept)
 * @param idle      () => bool: the host's own word that nothing is being done with the view
 */
export function startCapture({ RT, BUILDER, pics, project = () => null, idle = () => true, every = 1000, samples = 32, width = 192, timer = true }) {
    const taken = new Map()             // '<project>:<key>' -> the picture start (RT.resets) it was taken at
    let busy = false
    const settled = () => BUILDER.showing && !BUILDER.applying && !BUILDER.doc?.libraryItem
        && !RT.sceneBusy?.() && !RT.offscreenBusy?.() && !RT.interacting?.active?.() && idle()
        && (RT.hud?.samples ?? 0) >= samples
    const tick = async () => {
        if (busy || !settled()) return false
        const pid = project(), key = BUILDER.current, r = RT.resets?.() ?? 0, k = `${pid}:${key}`
        if (taken.get(k) === r) return false
        busy = true
        try {
            const blob = await RT.thumbnail({ width })
            // still the same scene and the same picture: a switch or an edit during the read would mislabel it
            if (!blob || BUILDER.current !== key || (RT.resets?.() ?? 0) !== r) return false
            taken.set(k, r)
            await pics.put(pid, key, { blob })
            return true
        } catch (e) {
            taken.set(k, r)                     // tried: not again until the picture starts over
            console.warn('[scenepics] the picture:', e?.message)
            return false
        } finally { busy = false }
    }
    const id = timer ? setInterval(tick, every) : 0
    return { tick, stop: () => clearInterval(id) }
}
