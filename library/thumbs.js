//======================================================================================================================
// THE LIBRARY'S PICTURES -- one per item, rendered once and kept (library/panel.js shows them in its grid).
//
// KEYED BY WHAT THE ITEM IS, not by its name or id: a hash of its asset (the model's JSON), its preview (what
// a material is shown on) and THUMB_VERSION, so an item whose shape or material changes gets a new picture and a renamed one keeps
// its own, and raising THUMB_VERSION -- the studio lit differently, the renderer changed -- renders them
// all again. Kept in the browser's IndexedDB (a PNG each), as the user's items and ray files are.
//
// RENDERED BY WHATEVER THE HOST PASSES as `render(item)` -> a Blob (PNG), in the background: one at a
// time, the ones asked for most recently first (the tiles on screen ask as they scroll into view), and
// only when `idle()` says the host can spare the GPU. Without a renderer there are no pictures, and the
// panel shows each kind's icon instead -- which is also what it shows until a picture arrives.
//
//   const T = createThumbs({ backend, render, idle })
//   T.url(item)            the picture's object URL if kept, else null (at once, from memory)
//   T.want(item)           ask for it: kept -> told at once; not -> queued for the renderer
//   T.on((key, url) => ..) told when a picture arrives
//   T.all(items, { force })  every one now, not waiting for the host to be idle -- and with force, made
//                          again even if kept (the panel's "make every picture" button); T.onProgress
//======================================================================================================================
/* global indexedDB, crypto -- the browser's (and Node's crypto, for the test) */

/** Raise it to render every picture again: the studio or the renderer changed what they look like. */
// 2: the sun and a floor instead of the studio's even light, which made every sphere a flat disc
// 3: white items on a grey floor, and materials no longer inheriting the previous scene's uniforms
// 4: a modifier acts on an F, not a block
// 5: lights shown lit, a hair of floor below each item, a repeat's copies framed
// 6: materials on a sample at real size (a 25 mm sphere, or the item's own), the tolerance each item's own
export const THUMB_VERSION = 6

/** The key of an item's picture: SHA-256 of its asset, its preview and THUMB_VERSION, hex. */
export async function thumbKey(item, version = THUMB_VERSION) {
    // the preview only when there is one: an item without one is keyed as before, but for the version
    const text = JSON.stringify({ v: version, asset: item?.asset ?? null, ...(item?.preview != null ? { preview: item.preview } : {}) })
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** PNGs by key in IndexedDB. */
export function indexedDbThumbs(name = 'raytracer.thumbs', store = 'png') {
    const db = () => new Promise((res, rej) => {
        const r = indexedDB.open(name, 1)
        r.onupgradeneeded = () => r.result.createObjectStore(store)
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
    })
    const run = async (mode, fn) => {
        const d = await db()
        return new Promise((res, rej) => {
            const t = d.transaction(store, mode)
            const q = fn(t.objectStore(store))
            t.oncomplete = () => res(q?.result)
            t.onerror = () => rej(t.error)
        })
    }
    return { get: key => run('readonly', s => s.get(key)), put: (key, blob) => run('readwrite', s => s.put(blob, key)) }
}
/** The same in memory (a test; a browser that refuses storage). */
export function memoryThumbs() {
    const m = new Map()
    return { get: async k => m.get(k), put: async (k, b) => { m.set(k, b) }, size: () => m.size }
}

/**
 * @param backend  where pictures are kept (indexedDbThumbs(), memoryThumbs())
 * @param render   item -> Promise<Blob>: the studio (library/studio.js); null for no pictures
 * @param idle     () -> bool: whether the host can spare the GPU now; asked before each render
 * @param retryMs  how long to wait before asking idle() again
 */
export function createThumbs({ backend = memoryThumbs(), render = null, idle = () => true, retryMs = 500 } = {}) {
    const urls = new Map()                  // key -> object URL, for pictures already read
    const keys = new WeakMap()              // item -> key (an item object is not changed in place)
    const failed = new Set()                // keys whose render threw: not tried again this visit
    const queue = []                        // { key, item, urgent, force }, the most recent last
    const listeners = new Set(), progressListeners = new Set()
    const run = { done: 0, total: 0 }       // the current all(): how far it has got
    const progress = () => { for (const f of progressListeners) { try { f({ ...run }) } catch { } } }
    let running = false, rendering = false
    const tell = (key, url) => { for (const f of listeners) { try { f(key, url) } catch (e) { console.error('[thumbs]', e) } } }
    const keyOf = async item => { let k = keys.get(item); if (!k) { k = await thumbKey(item); keys.set(item, k) } return k }
    const keep = (key, blob) => {
        const url = URL.createObjectURL(blob)
        urls.set(key, url)
        tell(key, url)
        return url
    }

    const pump = async () => {
        if (running || !render) return
        running = true
        try {
            while (queue.length) {
                // an urgent one (asked for by all()) does not wait for the host to be idle
                if (!queue.at(-1).urgent && !idle()) { await new Promise(r => setTimeout(r, retryMs)); continue }
                const { key, item, urgent, force } = queue.pop()
                const skip = (!force && urls.has(key)) || failed.has(key)
                if (skip) { if (urgent) { run.done++; progress() } continue }
                try {
                    rendering = true
                    const blob = await render(item).finally(() => { rendering = false })
                    if (!blob) { failed.add(key); continue }
                    try { await backend.put(key, blob) } catch (e) { console.warn('[thumbs] not kept for next time:', e?.message) }
                    const old = urls.get(key)
                    keep(key, blob)
                    if (old) URL.revokeObjectURL(old)
                } catch (e) { failed.add(key); console.warn(`[thumbs] ${item.name}:`, e?.message ?? e) }
                finally { if (urgent) { run.done++; progress() } }
            }
        } finally { running = false }
    }

    const T = {
        keyOf,
        /** The picture's URL when it has been read this visit, else null. Synchronous: for drawing a tile. */
        url(item) { const k = keys.get(item); return k ? urls.get(k) ?? null : null },
        /** Ask for an item's picture: from the store if kept, else rendered when the renderer is free. */
        async want(item) {
            const key = await keyOf(item)
            if (urls.has(key)) return urls.get(key)
            let blob = null
            try { blob = await backend.get(key) } catch { }
            if (blob) return keep(key, blob)
            // queued even with no renderer yet: setRender() starts what was asked for before it
            if (failed.has(key)) return null
            const at = queue.findIndex(q => q.key === key)
            if (at >= 0) queue.splice(at, 1)
            queue.push({ key, item })
            pump()
            return null
        },
        /** EVERY ONE NOW: queued urgent -- not waiting for the host to be idle -- the given order first; with
         *  `force`, made again even when kept (after the studio changed). Resolves when all are done. */
        async all(items, { force = false } = {}) {
            const list = [...items].reverse()        // popped from the end: the first given goes first
            const entries = await Promise.all(list.map(async item => ({ key: await keyOf(item), item, urgent: true, force })))
            if (force) for (const e of entries) failed.delete(e.key)
            // what is queued already goes after these; each at most once
            const keys = new Set(entries.map(e => e.key))
            for (let i = queue.length - 1; i >= 0; i--) if (keys.has(queue[i].key)) queue.splice(i, 1)
            queue.push(...entries)
            run.done = 0; run.total = entries.length
            /* LISTENING BEFORE THE QUEUE MOVES: what is kept already is skipped at once, without an await,
               so the last count could come and go before a listener added after pump() was there to hear it */
            const finished = new Promise(res => {
                if (!run.total) return res()
                const off = T.onProgress(p => { if (p.done >= p.total) { off(); res() } })
            })
            progress()
            pump()
            await finished
        },
        /** Be told ({ done, total }) as an all() goes. */
        onProgress(fn) { progressListeners.add(fn); return () => progressListeners.delete(fn) },
        /** Be told (key, url) when a picture arrives. */
        on(fn) { listeners.add(fn); return () => listeners.delete(fn) },
        /** How many are waiting for the renderer (a panel says so). */
        get pending() { return queue.length + (rendering ? 1 : 0) },
        /** Plug the renderer in later (the studio is made after the library): queued items start. */
        setRender(fn) { render = fn; pump() },
    }
    return T
}
