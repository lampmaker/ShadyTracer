// node workspace/test/store.test.mjs
//
// PROJECTS KEPT IN THE BROWSER, without a browser (workspace/): the store keeps, lists, reads, renames,
// duplicates, removes, exports and imports projects, and never overwrites one it cannot read; the autosave
// writes only what changed, makes a second tab's copy on its first edit and not on a look, holds while another
// project is swapped in, and a flush at the page's end is recovered when it is newer; the tabs give a project to
// one tab only, by lock or by asking over a channel; and the session starts a first visit on the demo, a second
// tab on its own copy, and an unreadable project on a fresh one while keeping it as it was.
import * as M from '../../builder/model.js'
import * as P from '../../builder/project.js'
import { createProjectStore, memoryProjects, uniqueName, workspaceText } from '../store.js'
import { createAutosave, recover } from '../autosave.js'
import { createTabs } from '../tabs.js'
import { createSession } from '../session.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
const throws = async (name, fn, re = null) => {
    try { await fn(); ok(name, false, 'did not throw') } catch (e) { ok(name, !re || re.test(e.message), e.message) }
}

let clock = 1000
const now = () => ++clock
const proj = (...titles) => P.createProject(titles.map(t => P.blankScene(t)))

// ---- THE STORE -------------------------------------------------------------------------------------------
{
    const S = createProjectStore({ backend: memoryProjects(), now })
    eq('nothing kept: no latest', await S.latest(), null)
    const a = await S.create({ name: 'Lens', project: proj('v1', 'v2'), session: { current: 's2', renderer: { values: { x: 1 } } } })
    const b = await S.create({ name: 'Lens', project: proj('bench') })
    eq('a name already kept gets a number', b.name, 'Lens 2')
    eq('...as uniqueName says', uniqueName(['A', 'A 2'], 'A'), 'A 3')
    eq('the list says how many scenes and their titles, without reading them', [a.scenes, a.titles], [2, ['v1', 'v2']])
    eq('the latest is the one made last', (await S.latest()).id, b.id)
    await S.touch(a.id)
    eq('...or the one opened last', (await S.latest()).id, a.id)

    // what a page starts on is the project WORKED ON last: a copy made after (a second tab's) does not win over the
    // original saved since -- and one just opened from the list wins over the one left
    {
        const S2 = createProjectStore({ backend: memoryProjects(), now })
        const orig = await S2.create({ name: 'Original', project: proj('o') })
        const copy = await S2.create({ name: 'Original (copy)', project: proj('o') })
        await S2.save(orig.id, { session: { current: 's1', cameras: { s1: { distance: 2 } } } })
        eq('the latest is the one saved last, not the copy made after it was opened', (await S2.latest()).id, orig.id)
        await S2.touch(copy.id)
        eq('...and one just opened wins', (await S2.latest()).id, copy.id)
    }
    const r = await S.read(a.id)
    eq('read back: the scenes', r.workspace.project.scenes.map(s => s.doc.title), ['v1', 'v2'])
    eq('...the scene being worked on', r.workspace.current, 's2')
    eq('...the renderer\'s settings', r.workspace.renderer, { values: { x: 1 } })

    // the session alone: the scenes are not written again
    const before = (await S.meta(a.id)).modified
    await S.save(a.id, { session: { current: 's1', renderer: {}, views: { s1: { camera: { distance: 3 } } } } })
    const m2 = await S.meta(a.id)
    ok('a session saved alone leaves `modified` (the scenes) alone', m2.modified === before && m2.saved > before)
    eq('...and is what is read: each scene with the view the session kept (0.63.0), over the one its text had',
        (await S.read(a.id)).workspace.project.scenes[0].doc.view.camera.distance, 3)
    // a project kept before 0.63.0: its scenes with no view, each one's camera in the session beside them
    const old = await S.create({ name: 'Old', project: P.createProject([M.createDoc({ title: 'o1' })]), session: { current: 's1', cameras: { s1: { distance: 5 } } } })
    eq('...one kept before, its camera beside the scenes, is read into its scene', (await S.read(old.id)).workspace.project.scenes[0].doc.view, { camera: { distance: 5 } })
    await S.remove(old.id)
    const p3 = proj('v1', 'v2', 'v3')
    await S.save(a.id, { project: p3 })
    const m3 = await S.meta(a.id)
    ok('scenes saved: modified moves and the summary follows', m3.modified > before && m3.scenes === 3)
    eq('the list: the one changed last first', (await S.list()).map(m => m.id), [a.id, b.id])

    await S.rename(b.id, 'Lens')
    eq('a rename to a name another has gets a number', (await S.meta(b.id)).name, 'Lens 2')
    const c = await S.duplicate(a.id)
    eq('a duplicate: "<name> copy", the same scenes', [c.name, (await S.read(c.id)).workspace.project.scenes.length], ['Lens copy', 3])
    await S.remove(c.id)
    await throws('removed: gone', () => S.read(c.id), /no such project/)

    // a library item being edited is kept (to reopen it after a reload) -- but a FILE never has it
    const p = proj('mine')
    const item = P.addScene(p, P.blankScene('gold'))
    item.doc.libraryItem = { id: 'mine:x', kind: 'material', from: 's1', stage: [], details: {} }
    const d = await S.create({ name: 'With item', project: p, session: { current: item.key } })
    eq('an item\'s scene is not counted as a scene of the user\'s', d.scenes, 1)
    eq('...but kept', (await S.read(d.id)).workspace.project.scenes.length, 2)
    const file = P.parse(await S.text(d.id))
    ok('exported as a workspace file: without it, and current back on the scene it came from',
        file.workspace && file.workspace.project.scenes.length === 1 && file.workspace.current === 's1')

    // importing: a workspace or a project file is a project; a scene file goes into one
    const w = await S.importText(P.serializeWorkspace(proj('a', 'b'), 's2', { values: {} }), 'From file')
    eq('a workspace file kept as a project, current as it says', [(await S.read(w.id)).workspace.current, w.name], ['s2', 'From file'])
    const pf = await S.importText(P.serialize(proj('x')), 'Project file')
    eq('a project file kept, current its first scene', (await S.read(pf.id)).workspace.current, 's1')
    await throws('a scene file is refused, saying where it goes', () => S.importText(M.serialize(P.blankScene('one'))), /scene file/)
    await throws('not a file of ours', () => S.importText('{"format":"nope"}'), /not a scene/)

    eq('the workspace text from the two parts reads as a workspace', !!P.parse(workspaceText(P.serialize(proj('q')), { current: 's1' })).workspace, true)
}

// ---- NOTHING UNREADABLE IS OVERWRITTEN -------------------------------------------------------------------
{
    const backend = memoryProjects()
    const S = createProjectStore({ backend, now })
    const a = await S.create({ name: 'Broken', project: proj('one') })
    await backend.write([['project', { id: a.id, text: '{"format":"raytracer-project","version":99,"nextKey":2,"scenes":[]}' }]])
    let problems = null
    try { await S.read(a.id) } catch (e) { problems = e.problems ?? [e.message] }
    ok('a project that does not read throws, listing why', problems && problems.some(x => /version 99/.test(x)), JSON.stringify(problems))
    ok('...and is still there, as it was', (await backend.get('project', a.id)).text.includes('"version":99'))
    ok('...and can still be downloaded as it was kept', (await S.text(a.id)).includes('"version":99'))
}

// ---- THE AUTOSAVE ----------------------------------------------------------------------------------------
{
    const backend = memoryProjects()
    let writes = []
    const spy = { ...backend, write: (puts, remove) => { writes.push(puts.map(([s]) => s)); return backend.write(puts, remove) } }
    const S = createProjectStore({ backend: spy, now })
    const state = { revision: 0, project: proj('a'), session: { current: 's1', camera: 1 } }
    const read = () => state
    const m = await S.create({ name: 'Work', project: state.project, session: state.session })
    const local = new Map()
    const L = { getItem: k => local.get(k) ?? null, setItem: (k, v) => local.set(k, v), removeItem: k => local.delete(k) }
    const A = createAutosave({ store: S, read, local: L, now })
    A.target({ id: m.id, name: m.name }); A.since(); writes = []
    eq('nothing changed: nothing written', await A.tick(), false)
    state.session = { current: 's1', camera: 2 }
    await A.tick()
    eq('the camera moved: the session written, not the scenes', writes.at(-1), ['meta', 'session'])
    state.revision++; P.newScene(state.project, 'b')
    await A.tick()
    eq('an edit: the scenes written', writes.at(-1), ['meta', 'project'])
    eq('...and read back', (await S.read(m.id)).workspace.project.scenes.length, 2)
    A.hold(true); state.revision++
    eq('held: nothing written', await A.tick(), false)
    A.hold(false)
    ok('let go: written', await A.tick())

    // the page's end: flushed to localStorage, and recovered on the next load when newer
    state.revision++; P.newScene(state.project, 'c')
    ok('a flush puts what is unsaved in localStorage', A.flush() && local.size === 1)
    eq('recovered into the store', await recover(S, L, m.id), true)
    eq('...the edit is there', (await S.read(m.id)).workspace.project.scenes.length, 3)
    ok('...and the flush is gone', local.size === 0)
    state.revision++; P.newScene(state.project, 'd')
    A.flush()
    clock -= 100                      // a flush OLDER than what the store has (a write after it finished)
    await A.tick()
    clock += 200
    eq('a flush older than the store is not used', await recover(S, L, m.id), false)

    // a copy: made on the first edit, not on a look
    let created = null
    const B = createAutosave({ store: S, read, now, onCreated: x => { created = x } })
    const n0 = (await S.list()).length
    B.target({ copyOf: m, name: 'Work (copy)' }); B.since()
    state.session = { current: 's1', camera: 9 }
    await B.tick()
    eq('a copy is not made by a look (the camera turned)', (await S.list()).length, n0)
    state.revision++
    await B.tick()
    ok('...but by an edit, under its name', created?.name === 'Work (copy)' && (await S.list()).length === n0 + 1 && B.id === created.id)
    ok('...and saves there from then on', (await S.meta(created.id)).scenes === state.project.scenes.length)

    // a write already on its way when another project is opened: it does not take that one's place
    const slow = { ...backend, write: (p, r) => new Promise(res => setTimeout(() => res(backend.write(p, r)), 30)) }
    const S2 = createProjectStore({ backend: slow, now })
    const C = createAutosave({ store: S2, read, now })
    const x = await S2.create({ name: 'X', project: proj('x') }), y = await S2.create({ name: 'Y', project: proj('y') })
    C.target({ id: x.id }); state.revision++
    const going = C.tick()
    C.target({ id: y.id })
    await going
    eq('...the target stays the project opened', C.id, y.id)
}

// ---- THE TABS --------------------------------------------------------------------------------------------
const fakeLocks = () => {
    const held = new Set()
    return {
        request(name, opts, cb) {
            if (held.has(name)) return Promise.resolve(cb(null))
            held.add(name)
            return Promise.resolve(cb({ name })).then(v => { held.delete(name); return v })
        },
        query: async () => ({ held: [...held].map(name => ({ name })) }),
    }
}
{
    const locks = fakeLocks()
    const one = createTabs({ locks }), two = createTabs({ locks })
    eq('by lock', one.how, 'locks')
    ok('the first tab takes a project', await one.claim('p1'))
    ok('...the second cannot', !(await two.claim('p1')))
    ok('...and sees the first has it', (await two.others()).has('p1') && !(await one.others()).has('p1'))
    one.release('p1')
    await new Promise(r => setTimeout(r, 0))
    ok('let go: the second can take it', await two.claim('p1'))
}
{
    const one = createTabs({ locks: null, wait: 50 }), two = createTabs({ locks: null, wait: 50 })
    eq('without locks, by asking over a channel', one.how, 'channel')
    ok('the first tab takes a project', await one.claim('p9'))
    ok('...the second, asking, is told it is taken', !(await two.claim('p9')))
    ok('...and sees who has what', (await two.others()).has('p9'))
    one.release('p9')
    ok('let go: the second can take it', await two.claim('p9'))
}

// ---- THE SESSION -----------------------------------------------------------------------------------------
{
    const backend = memoryProjects(), locks = fakeLocks()
    const tab = () => {
        const S = createProjectStore({ backend, now })
        const state = { revision: 0, project: null, session: {} }
        const A = createAutosave({ store: S, read: () => state, now })
        const shown = []
        const X = createSession({ store: S, tabs: createTabs({ locks }), autosave: A, firstVisit: async () => proj('Builder demo'),
            apply: async w => { state.project = w.project; state.revision++; shown.push(w.project.scenes[0].doc.title) } })
        return { S, A, X, state, shown }
    }
    const t1 = tab()
    const s1 = await t1.X.start()
    eq('a first visit: one project of the demo scene, kept at once', [(await t1.S.list()).length, s1.workspace.project.scenes[0].doc.title, s1.meta.name], [1, 'Builder demo', 'My project'])
    ok('...and this tab saves to it', t1.A.id === s1.meta.id && !t1.X.info().copy)

    const t2 = tab()
    const s2 = await t2.X.start()
    ok('a second tab on it: its own copy, not made yet, and it says so', t2.A.id === null && t2.X.info().copy === 'My project' && /another tab/.test(s2.note))
    eq('...the same scenes', s2.workspace.project.scenes[0].doc.title, 'Builder demo')

    const other = await t1.S.create({ name: 'Other', project: proj('o1') })
    await t1.X.open(other.id)
    eq('opening another: shown', t1.shown.at(-1), 'o1')
    ok('...taken, and the first let go', t1.A.id === other.id && await t2.X.list().then(l => !l.find(m => m.id === s1.meta.id).elsewhere))
    await throws('the project open here cannot be removed', () => t1.X.remove(other.id), /open here/)
    await throws('one open in another tab cannot either', () => t2.X.remove(other.id), /another tab/)

    const n = await t1.X.create()
    eq('a new project: one empty scene, opened', [t1.shown.at(-1), t1.A.id], ['New scene', n.id])

    // a project that cannot be read, opened last: kept as it was, and a fresh one started
    const S = createProjectStore({ backend, now })
    const bad = await S.create({ name: 'Bad', project: proj('b') })
    await backend.write([['project', { id: bad.id, text: 'not json' }]])
    const t3 = tab()
    const s3 = await t3.X.start()
    ok('an unreadable project opened last: a fresh one of the demo, and it says which and why', /'Bad' could not be read/.test(s3.note) && s3.meta.id !== bad.id, s3.note)
    ok('...the unreadable one kept unchanged', (await backend.get('project', bad.id)).text === 'not json')
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
