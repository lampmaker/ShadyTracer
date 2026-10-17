//======================================================================================================================
// PROJECTS KEPT IN THE BROWSER -- the user's work, saved as it changes, so a refresh comes back to it; and the
// list of them (File › Projects…). UI_PLAN.md section 10.
//
// Until this, every page load put the bundled scenes into a fresh project and restored nothing: a refresh
// lost whatever had not been downloaded as a file. Files stay the backup and the exchange; this is where the
// work lives between them.
//
// A PROJECT HERE IS A WORKSPACE (builder/project.js): its scenes, each with its view (its camera and exposure),
// the scene being worked on, and the renderer's settings. It is kept in two parts, because they change at different
// rates:
//   project  the scenes, as project.serialize writes them -- written only when an edit changed them
//   session  { current, renderer, views, item } -- written when the camera or a setting moves, which while
//            orbiting is all the time, without serializing every scene again: `views` every scene's view as it is
//            now, which the scenes' text has as of their last write (`cameras` until 0.65.0, read still)
// Read back, the two are put together as one workspace text and project.parse reads it as it reads a file,
// so what was kept is held to exactly a workspace file's rules, and upgraded as a file's scenes are. `item`
// is the library item editor's memory (library/edit.js remember): what leaving an item open at the reload
// puts back.
//
// THREE OBJECT STORES, so the list costs nothing: `meta` (a name, dates, the scenes' titles) is all the list
// reads; `project` and `session` are read only to open one.
//
// NOTHING IS OVERWRITTEN THAT COULD NOT BE READ. A project that fails to parse (a newer version wrote it, or a
// bug did) stays as it was: read() throws, the caller starts elsewhere and says so, and text() still gives its
// parts as a file to download.
//
// PURE but for the IndexedDB backend: test/store.test.mjs runs it in node with the memory one.
//======================================================================================================================

import * as P from '../builder/project.js'

const STORES = ['meta', 'project', 'session']

/** THE BROWSER'S INDEXEDDB: kept between visits, as the library's items and the ray files are. */
export function indexedDbProjects(name = 'raytracer.projects') {
    const db = () => new Promise((res, rej) => {
        try {
            const r = indexedDB.open(name, 1)
            r.onupgradeneeded = () => { for (const s of STORES) r.result.createObjectStore(s, { keyPath: 'id' }) }
            r.onsuccess = () => res(r.result)
            r.onerror = () => rej(r.error)
        } catch (e) { rej(e) }
    })
    let opened = null
    const run = async (stores, mode, fn) => {
        const d = await (opened ??= db().catch(e => { opened = null; throw e }))
        return new Promise((res, rej) => {
            const t = d.transaction(stores, mode)
            const q = fn(t)
            t.oncomplete = () => res(q?.result)
            t.onerror = () => rej(t.error)
            t.onabort = () => rej(t.error ?? new Error('aborted'))
        })
    }
    return {
        all: store => run([store], 'readonly', t => t.objectStore(store).getAll()).then(v => v ?? []),
        get: (store, id) => run([store], 'readonly', t => t.objectStore(store).get(id)).then(v => v ?? null),
        /** In ONE transaction: puts [[store, value]] and the removal of `remove` from every store. */
        write: (puts = [], remove = null) => run(STORES, 'readwrite', t => {
            for (const [s, v] of puts) t.objectStore(s).put(v)
            if (remove != null) for (const s of STORES) t.objectStore(s).delete(remove)
        }),
    }
}

/** The same in memory: for a test, or a browser that refuses storage (the work then lasts the visit). */
export function memoryProjects() {
    const m = Object.fromEntries(STORES.map(s => [s, new Map()]))
    return {
        all: async store => [...m[store].values()].map(v => structuredClone(v)),
        get: async (store, id) => structuredClone(m[store].get(id) ?? null),
        write: async (puts = [], remove = null) => {
            for (const [s, v] of puts) m[s].set(v.id, structuredClone(v))
            if (remove != null) for (const s of STORES) m[s].delete(remove)
        },
    }
}

/** A name not already in `names`: "Lens" -> "Lens 2" -> "Lens 3". */
export function uniqueName(names, name) {
    const used = new Set(names)
    const base = String(name || 'Project').trim() || 'Project'
    if (!used.has(base)) return base
    let i = 2
    while (used.has(`${base} ${i}`)) i++
    return `${base} ${i}`
}

/* what the list shows of a project without reading it: how many scenes, and their titles -- a library item
   being edited is not one of the user's scenes, so it is not counted */
const summary = project => {
    const scenes = project.scenes.filter(s => !s.doc.libraryItem)
    return { scenes: scenes.length, titles: scenes.map(s => String(s.doc.title ?? '')) }
}

/* THE WORKSPACE TEXT, from the two parts: the session's fields as JSON, the project's text spliced in as it
   was written -- one megabyte of scenes is not parsed and written again to be read */
export const workspaceText = (projectText, session = {}) => {
    /* `views`: every scene's view as the session kept it, newer than the project's documents (0.65.0); `cameras`: a
       session kept before. Both go into the scenes as the workspace is read (builder/project.js workspaceOf). */
    const { current = null, renderer = {}, cameras = {}, views = {} } = session ?? {}
    const head = JSON.stringify({ format: P.WORKSPACE_FORMAT, version: P.WORKSPACE_VERSION, current, renderer, cameras, views })
    return `${head.slice(0, -1)},"project":${projectText}}`
}

/**
 * @param backend  where projects live (indexedDbProjects(), memoryProjects())
 * @param now      the clock, for a test
 */
export function createProjectStore({ backend = memoryProjects(), now = () => Date.now() } = {}) {
    const newId = () => `p${now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
    const meta = async id => {
        const m = await backend.get('meta', id)
        if (!m) throw new Error(`no such project '${id}'`)
        return m
    }
    const S = {
        /** Every project's meta, the one changed last first: { id, name, created, modified, opened, saved,
         *  scenes, titles }. `modified` is when its scenes last changed; `saved` when anything was written. */
        async list() {
            return (await backend.all('meta')).sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0) || String(a.name).localeCompare(String(b.name)))
        },
        /** THE PROJECT WORKED ON LAST -- what a page starts on -- or null when there is none: the later of when it was
         *  opened and when anything of it was saved. Opened alone, a second tab's copy (made after the first tab
         *  opened the original) would be what the next visit starts on, however long the first tab went on working;
         *  saved alone, a project just opened from the list and not yet changed would lose to the one left. */
        async latest() {
            const at = m => Math.max(m.opened ?? 0, m.saved ?? 0, m.modified ?? 0)
            return (await backend.all('meta')).sort((a, b) => at(b) - at(a))[0] ?? null
        },
        meta,
        /** A new project of `project` (a project object, project.js) and its session; returns its meta. The name is
         *  made unique among the projects kept. */
        async create({ name = 'My project', project, session = {} } = {}) {
            if (!project) throw new Error('a project to keep is needed')
            const t = now(), id = newId()
            const names = (await backend.all('meta')).map(m => m.name)
            const m = { id, name: uniqueName(names, name), created: t, modified: t, opened: t, saved: t, ...summary(project) }
            await backend.write([['meta', m], ['project', { id, text: P.serialize(project) }], ['session', { id, session: structuredClone(session) }]])
            return m
        },
        /** Write what changed: `project` (an object) when its scenes did, `session` when the camera or a setting did --
         *  either may be left out. Returns the meta. A project that is not there any more is not made again. */
        async save(id, { project = null, session = null } = {}) {
            const m = await meta(id), t = now()
            const puts = []
            if (project) { Object.assign(m, summary(project), { modified: t }); puts.push(['project', { id, text: P.serialize(project) }]) }
            if (session) puts.push(['session', { id, session: structuredClone(session) }])
            if (!puts.length) return m
            m.saved = t
            await backend.write([['meta', m], ...puts])
            return m
        },
        /** The project as it was kept: { meta, workspace: { project, current, renderer }, item } -- each scene with the
         *  view the session kept for it (builder/project.js workspaceOf). Throws a
         *  ModelError (its `problems` listing everything wrong) for one that cannot be read -- and changes nothing. */
        async read(id) {
            const m = await meta(id)
            const proj = await backend.get('project', id), sess = (await backend.get('session', id))?.session ?? {}
            if (!proj?.text) throw new Error(`project '${m.name}' has no scenes kept`)
            const r = P.parse(workspaceText(proj.text, sess))
            if (!r.workspace) throw new Error(`project '${m.name}' is not a workspace`)
            return { meta: m, workspace: r.workspace, item: sess.item ?? null }
        },
        /** The project as a WORKSPACE FILE, the format File › Open reads: without a library item being edited, as
         *  every file is (project.withoutItems). One that cannot be read is given as it was kept, so it can still
         *  be downloaded and looked at. */
        async text(id, { app = null } = {}) {
            await meta(id)                  // one that is not there at all is an error, not an empty file
            try {
                const { workspace: w } = await S.read(id)
                const { project, current } = P.withoutItems(w.project, w.current)
                return P.serializeWorkspace(project, current, w.renderer, { app })
            } catch {
                const proj = await backend.get('project', id), sess = (await backend.get('session', id))?.session ?? {}
                return workspaceText(proj?.text ?? 'null', sess)
            }
        },
        /** Opened now: the project a page starts on next. */
        async touch(id) {
            const m = await meta(id)
            m.opened = now()
            await backend.write([['meta', m]])
            return m
        },
        async rename(id, name) {
            const m = await meta(id)
            const names = (await backend.all('meta')).filter(x => x.id !== id).map(x => x.name)
            m.name = uniqueName(names, name)
            await backend.write([['meta', m]])
            return m
        },
        /** A copy kept beside it, "<name> copy"; returns its meta. Copied as kept: read or not. */
        async duplicate(id, name = null) {
            const m = await meta(id), t = now(), nid = newId()
            const names = (await backend.all('meta')).map(x => x.name)
            const proj = await backend.get('project', id), sess = await backend.get('session', id)
            const c = { ...m, id: nid, name: uniqueName(names, name ?? `${m.name} copy`), created: t, modified: t, opened: t, saved: t }
            await backend.write([['meta', c], ['project', { ...proj, id: nid }], ['session', { session: {}, ...sess, id: nid }]])
            return c
        },
        async remove(id) {
            await meta(id)
            await backend.write([], id)
        },
        /**
         * A FILE KEPT AS A PROJECT: a workspace file (its scenes and their views, current scene, settings), or a project
         * file (its scenes alone; the renderer's settings stay as they are when it is opened). A scene file is not a
         * project: it goes into one (File › Open). Throws a ModelError for a file that does not read.
         */
        async importText(text, name = 'Imported project') {
            const r = P.parse(text)
            if (r.doc) throw new Error('a scene file goes into the open project (File › Open), not into a project of its own')
            const w = r.workspace ?? { project: r.project, current: r.project.scenes[0].key, renderer: {} }
            return S.create({ name, project: w.project, session: { current: w.current, renderer: w.renderer } })
        },
    }
    return S
}
