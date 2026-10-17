//======================================================================================================================
// SAVED AS IT CHANGES -- the project this tab works on, written to the store (store.js) when something changed,
// looked at once a second. UI_PLAN.md section 10.
//
// LOOKED AT, NOT HOOKED: a revision the builder raises at every recorded edit, undo, redo and load (demo.js),
// and the session -- the scene being worked on, the renderer's settings, every scene's camera, the item
// editor's memory -- compared as JSON. Hooks in every place that edits a scene or moves the camera would all
// have to be there; a look cannot miss one. The scenes are serialized only when the revision moved, so an
// orbit writes a few kilobytes of session, not every scene.
//
// A COPY NOT YET MADE (tabs.js: a second tab on a project gets its own copy): nothing is written until the
// first EDIT, which makes it a project of its own. A tab only looked through -- the camera turned -- adds
// nothing to the list.
//
// AT THE PAGE'S END an IndexedDB write may not finish before the page is gone, so flush() (on pagehide) puts
// what is not yet written in localStorage, synchronously, under the project's id; recover() writes it into
// the store on the next load, if it is newer than what the store has. A reload just after an edit loses
// nothing. localStorage holds a few megabytes: a project too big for it is not flushed, and says so.
//
//   const A = createAutosave({ store, read, local })     read() -> { revision, project, session }
//   A.target({ id })  or  A.target({ copyOf: meta, name })
//   A.hold(true) ... A.hold(false)  nothing written while another project is swapped in
//   A.since()                    what is there now counts as saved (a project just opened)
//   await A.tick()               write what changed -- every second, and when the tab is hidden
//   A.flush()                    pagehide
//   await recover(store, local, id)
//======================================================================================================================

import * as P from '../builder/project.js'

const KEY = 'raytracer.unsaved:'

/**
 * @param store      store.js's createProjectStore
 * @param read       () => { revision, project, session }: the builder's revision and project, and the session
 * @param local      localStorage, or a stand-in (null: no flush)
 * @param onCreated  (meta) => void: a copy became a project of its own
 * @param say        a status line, for a save that failed (said once, until one works again)
 */
export function createAutosave({ store, read, local = null, now = () => Date.now(), onCreated = () => { }, say = () => { } }) {
    let T = { id: null, copyOf: null, name: null }
    let last = { revision: null, session: null }
    let busy = null, failed = false, held = false        // busy: the write on its way

    const look = () => {
        const r = read()
        const session = JSON.stringify(r.session ?? {})
        return { r, session, project: r.revision !== last.revision, sess: session !== last.session }
    }
    const A = {
        /** Save to project `id`; or, with `copyOf`, to a copy of it called `name`, made on the first edit. */
        target(t) { T = { id: t.id ?? null, copyOf: t.copyOf ?? null, name: t.name ?? null } },
        /** HELD while another project is swapped in (session.js open): from the moment the target names the new one
         *  until the builder holds it, a look would write the old project's scenes into the new one's record. */
        hold(on) { held = !!on },
        get id() { return T.id },
        get copyOf() { return T.copyOf },
        get name() { return T.name },
        /** What is there now counts as saved: a project just read from the store, or just made. */
        since() { const { r, session } = look(); last = { revision: r.revision, session } },
        /** Whether something is not written yet. */
        get dirty() { const x = look(); return x.project || x.sess },
        /** Write what changed. Resolves true when something was written. One write at a time: a look while one is
         *  on its way waits for the next, which finds whatever changed meanwhile. */
        async tick() {
            if (busy) { await busy.catch(() => { }); return false }
            if (held) return false
            const { r, session, project, sess } = look()
            if (!project && !sess) return false
            if (!T.id && !(T.copyOf && project)) return false          // a copy is made by an edit, not by a look
            /* the target as it was looked at: another project opened while this write is on its way is not
               this write's to change (session.js open holds new writes, but not one already going) */
            const t0 = T
            let done
            busy = new Promise(res => { done = res })
            try {
                let wrote = t0.id
                if (!t0.id) {
                    const m = await store.create({ name: t0.name ?? 'Copy', project: r.project, session: r.session })
                    wrote = m.id
                    if (T === t0) T = { id: m.id, copyOf: null, name: m.name }
                    try { onCreated(m) } catch (e) { console.error('[autosave] onCreated', e) }
                } else await store.save(t0.id, { project: project ? r.project : null, session: sess ? r.session : null })
                // another project is the target now: what counts as saved there is its own (since())
                if (T.id !== wrote) return true
                last = { revision: r.revision, session }
                try { local?.removeItem(KEY + T.id) } catch { }
                if (failed) say('saved in the browser again')
                failed = false
                return true
            } catch (e) {
                console.error('[autosave]', e)
                if (!failed) say(`NOT saved in the browser: ${e.message} -- File › Export ▸ Project file keeps a copy`)
                failed = true
                return false
            } finally { busy = null; done() }
        },
        /** The page is going: what is not written, to localStorage at once. Nothing for a copy not made yet. */
        flush() {
            if (!T.id || !local || held) return false
            const { r, project, sess } = look()
            if (!project && !sess) return false
            try {
                local.setItem(KEY + T.id, JSON.stringify({ at: now(), project: project ? P.serialize(r.project) : null, session: r.session ?? {} }))
                return true
            } catch (e) { console.warn('[autosave] could not flush to localStorage (too big?):', e?.message); return false }
        },
    }
    return A
}

/** WHAT A PAGE FLUSHED AS IT WENT (createAutosave flush), written into the store if it is newer than what the store
 *  has; the flush is removed either way. Resolves true when it wrote something. */
export async function recover(store, local, id) {
    let raw = null
    try { raw = local?.getItem(KEY + id) } catch { }
    if (!raw) return false
    try { local.removeItem(KEY + id) } catch { }
    try {
        const x = JSON.parse(raw)
        const m = await store.meta(id)
        if (!(x.at > (m.saved ?? 0))) return false
        const project = x.project ? P.parse(x.project).project : null
        await store.save(id, { project, session: x.session ?? null })
        return true
    } catch (e) { console.warn('[autosave] a flushed save was not used:', e?.message); return false }
}

/** Every flush a page left behind (createAutosave flush), each written in as recover() does. Resolves how many. */
export async function recoverAll(store, local) {
    if (!local) return 0
    const ids = []
    try { for (let i = 0; i < local.length; i++) { const k = local.key(i); if (k?.startsWith(KEY)) ids.push(k.slice(KEY.length)) } } catch { }
    let n = 0
    for (const id of ids) if (await recover(store, local, id)) n++
    return n
}
