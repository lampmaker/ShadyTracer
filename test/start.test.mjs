// node test/start.test.mjs
//
// THE PAGE'S START WHEN ITS SCENE WILL NOT COMPILE (start.js), without a GPU, over stand-ins for the renderer and the
// builder (the user, 2026-10-02: a material that would not compile, kept in the browser, and every reload stuck on
// it): a first compile that fails leaves the renderer on the empty scene, tells the builder nothing of the project
// is showing, and says what is wrong as the probe reports it; one that works says nothing. A safe start is asked
// for with ?safe, or taken when the last start left its mark; the mark is set for each start and removed when it
// is done.
import { safeStartOf, started, safeNote, firstCompile, STARTING_KEY } from '../start.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const store = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m } }
const quiet = async fn => { const e = console.error; console.error = () => { }; try { return await fn() } finally { console.error = e } }

// ---- THE FIRST COMPILE -------------------------------------------------------------------------------------------
{
    const T = { scenes: [], unshown: 0 }
    const nothing = { id: 'nothing' }
    const stand = refuse => ({
        RT: { async init() { if (refuse) throw new Error('shade: does not compile') }, async setScene(s) { T.scenes.push(s.id) } },
        BUILDER: { doc: { title: 'Lens v2' }, unshow() { T.unshown++ },
            async check() { return { ok: false, report: "\nmaterial 'gold' line 3: unresolved identifier 'colr'\n(and more)" } } },
    })
    ok('a first compile that works: nothing to say, nothing changed', await firstCompile({ ...stand(false), nothing }) === null && !T.scenes.length && !T.unshown)
    const note = await quiet(() => firstCompile({ ...stand(true), nothing }))
    ok('one that fails: the renderer on the empty scene', JSON.stringify(T.scenes) === '["nothing"]', JSON.stringify(T.scenes))
    ok('...the builder told nothing of the project is showing', T.unshown === 1)
    ok('...and the note names the scene and the probe\'s first line', /'Lens v2' does not compile: material 'gold' line 3: unresolved identifier 'colr' -- started on an empty scene/.test(note ?? ''), note)
    // even the empty scene refused, and no probe: still a start, still a note
    const worse = { RT: { async init() { throw new Error('x') }, async setScene() { throw new Error('y') } },
        BUILDER: { doc: { title: 'B' }, unshow() { }, async check() { throw new Error('z') } } }
    ok('nothing compiles at all: it still returns, saying which scene', /'B' does not compile -- started/.test(await quiet(() => firstCompile({ ...worse, nothing })) ?? ''))
}

// ---- SAFE START ------------------------------------------------------------------------------------------------------
{
    const L = store()
    let s = safeStartOf(L, '', 'Lens v2')
    ok('a first start: not safe', !s.safe && !s.asked && s.unfinished === null)
    ok('...and its mark is set', JSON.parse(L.getItem(STARTING_KEY)).scene === 'Lens v2')
    s = safeStartOf(L, '', 'Lens v2')
    ok('the mark still there at the next start (that one never finished): safe, and why', s.safe && !s.asked && s.unfinished?.scene === 'Lens v2')
    ok('...the note says so', /the last start did not finish/.test(safeNote('Lens v2', s)))
    started(L)
    s = safeStartOf(L, '?x=1', 'Lens v2')
    ok('a start that finished: the next one is not safe', !s.safe)
    started(L)
    s = safeStartOf(L, '?safe', 'Lens v2')
    ok('?safe asks for one', s.safe && s.asked && /as asked/.test(safeNote('Lens v2', s)))
    ok('no localStorage at all: never safe unless asked, and nothing thrown', !safeStartOf(null, '', 'x').safe && safeStartOf(null, '?safe', 'x').safe)
    started(null)
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
