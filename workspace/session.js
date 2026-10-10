//======================================================================================================================
// THE PROJECT THIS TAB WORKS ON -- which one a page starts on, opening another from the list, a new one, a file
// kept as one. UI_PLAN.md section 10. No DOM: test/session.test.mjs runs it in node over the memory store.
//
// WHICH ONE A PAGE STARTS ON:
//   nothing kept yet       a FIRST VISIT: a project of one lightweight demo scene (scenes/index.js FIRST_VISIT),
//                          kept at once, so the next reload comes back to it
//   the one worked on last this tab takes it (tabs.js) and saves to it as it changes (store.js latest)
//   ...held by another tab ITS OWN COPY (the user, 2026-10-02): the same scenes, saved as "<name> (copy)" once
//                          something is edited here -- never over the other tab's
//   ...that cannot be read kept as it was (store.js: nothing unreadable is overwritten), and a new project of the
//                          demo scene started instead, saying so
//
// OPENING ANOTHER is the same, from the list: what this tab has is saved first, its project let go, the other
// taken or copied. The page does the rest through `apply(workspace, item)` -- the builder's project replaced,
// the renderer's settings and the item editor put back, the scene compiled -- since that needs the page.
//======================================================================================================================

import * as P from '../builder/project.js'

const copyName = name => `${name} (copy)`

/**
 * @param store       store.js's createProjectStore
 * @param tabs        tabs.js's createTabs
 * @param autosave    autosave.js's createAutosave
 * @param firstVisit  async () => a project object: a first visit's (the demo scene)
 * @param apply       async (workspace, item, info) => void: the page shows a project read from the store
 * @param say         a status line
 */
export function createSession({ store, tabs, autosave, firstVisit, apply = async () => { }, say = () => { } }) {
    /* A PROJECT TO WORK ON: taken, or a copy of one another tab has. Returns what to show. */
    const take = async meta => {
        const mine = await tabs.claim(meta.id)
        let r
        try { r = await store.read(meta.id) } catch (e) { if (mine) tabs.release(meta.id); throw e }
        if (mine) {
            autosave.target({ id: meta.id, name: meta.name })
            await store.touch(meta.id)
            return { ...r, note: null }
        }
        autosave.target({ copyOf: meta, name: copyName(meta.name) })
        return { ...r, note: `'${meta.name}' is open in another tab: this tab works on a copy, kept as '${copyName(meta.name)}' once you change something` }
    }
    /* a new project, kept at once and taken */
    const made = async (name, project, session = {}) => {
        const m = await store.create({ name, project, session: { current: project.scenes[0].key, ...session } })
        await tabs.claim(m.id)
        autosave.target({ id: m.id, name: m.name })
        return { meta: m, workspace: { project, current: project.scenes[0].key, renderer: {}, cameras: {}, ...session }, item: null }
    }
    const blank = () => P.createProject([P.blankScene()])

    const S = {
        /** What this tab works on: { id, name, copy } -- `copy` the name of the project it is a copy of, while that
         *  copy is not made yet. */
        info() {
            return { id: autosave.id, name: autosave.name ?? null, copy: autosave.copyOf?.name ?? null }
        },
        /**
         * THE PROJECT A PAGE STARTS ON (above). Resolves to { meta, workspace, item, note }: `workspace` is what to
         * build the page with -- { project, current, renderer, cameras } -- and `note`, when there is one, what to say.
         */
        async start() {
            const latest = await store.latest()
            if (!latest) return { ...await made('My project', await firstVisit()),
                note: 'a first visit: a demo scene to start from -- the examples are in File › Examples' }
            try { return await take(latest) } catch (e) {
                console.error('[projects] could not read', latest.name, e)
                const why = e.problems ? e.problems[0] : e.message
                const r = await made('My project', await firstVisit())
                return { ...r, note: `'${latest.name}' could not be read (${why}). It is kept unchanged: File › Projects… can download it` }
            }
        },
        /** Open project `id` here: what this tab has saved first, then it is taken (or copied) and shown. */
        async open(id) {
            if (id === autosave.id) return say('that is the project open here')
            const meta = await store.meta(id)
            await S.saveNow()
            let r
            const before = { id: autosave.id, copyOf: autosave.copyOf, name: autosave.name }
            autosave.hold(true)
            try {
                // the one asked for cannot be read: this tab stays on what it had
                try { r = await take(meta) } catch (e) { autosave.target(before); throw e }
                if (before.id) tabs.release(before.id)
                await apply(r.workspace, r.item, S.info())
                autosave.since()
            } finally { autosave.hold(false) }
            say(r.note ?? `opened ${meta.name}`)
            return r
        },
        /** A new project of one empty scene, opened here. */
        async create(name = 'New project') {
            await S.saveNow()
            const before = autosave.id
            autosave.hold(true)
            let r
            try {
                r = await made(name, blank())
                if (before) tabs.release(before)
                await apply(r.workspace, null, S.info())
                autosave.since()
            } finally { autosave.hold(false) }
            say(`new project: ${r.meta.name}`)
            return r.meta
        },
        /** A file kept as a project (store.importText: a workspace or a project file), and opened here. */
        async importText(text, name) {
            const m = await store.importText(text, name)
            await S.open(m.id)
            return m
        },
        /** Write what is unsaved now (Ctrl+S, and before another project is opened). */
        async saveNow() { await autosave.tick(); await autosave.tick() },      // the first may only wait for one on its way
        /** The projects kept, each marked: `here` this tab's, `elsewhere` held by another tab. */
        async list() {
            const [all, others] = await Promise.all([store.list(), tabs.others()])
            return all.map(m => ({ ...m, here: m.id === autosave.id, elsewhere: others.has(m.id) }))
        },
        async rename(id, name) {
            const m = await store.rename(id, name)
            if (id === autosave.id) autosave.target({ id, name: m.name })
            return m
        },
        duplicate: id => store.duplicate(id),
        /** Gone for good: not the one open here, nor one another tab has (it would be saved again from there). */
        async remove(id) {
            if (id === autosave.id) throw new Error('it is the project open here: open another one first')
            if ((await tabs.others()).has(id)) throw new Error('it is open in another tab: close it there first')
            return store.remove(id)
        },
        exportText: (id, opts) => store.text(id, opts),
        /** A copy this tab was working on became a project (autosave's onCreated): it is this tab's now. */
        async adopt(meta) {
            await tabs.claim(meta.id)
            say(`kept this tab's copy as '${meta.name}'`)
        },
    }
    return S
}
