//======================================================================================================================
// Tests for the add-ins (lib/addins/): where the page finds them and which it trusts, the two phases, an add-in that
// fails never stopping another or the page, the API's names, and the example add-in (docs/addins/template) run whole --
// its sweep through the real scene script API over a stand-in optics page, its panel over a stand-in document. No
// browser, no GPU. Run: node lib/addins/test/loader.test.mjs
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { createAddins, trustOf, parseManifest, declarationOf, readList, LIST_KEY, ADDIN_API } from '../loader.js'
import { makeParams } from '../../shell/params.js'
import { makeScriptApi } from '../../../tools/scriptapi.js'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '../../..')

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want),
    `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
const throws = async (name, fn, re) => {
    try { await fn(); ok(name, false, 'did not throw') } catch (e) { ok(name, re.test(e.message), `threw: ${e.message}`) }
}

const BASE = 'https://shadytracer.com/app.html'
const memStorage = (init = {}) => {
    const m = new Map(Object.entries(init))
    return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), map: m }
}
/** a shell that records what it is asked */
const standInShell = () => {
    const S = { panels: [], commands: [], opened: [], std: 0, said: [], jobs: [] }
    Object.assign(S, {
        panel: def => { S.panels.push(def); return { def, children: [], append(...c) { this.children.push(...c) } } },
        command: def => { S.commands.push(def); return def },
        open: (id, ...a) => S.opened.push(id), close: () => { }, isOpen: () => false, onVisible: () => { },
        standardCommands: () => { S.std++ }, status: t => S.said.push(t), progress: (k, j) => S.jobs.push([k, j]),
        searchIn: () => () => { }, tools: {}, barEnd: {},
    })
    return S
}
const mod = (id, extra = {}) => ({ addin: { id, name: id.toUpperCase(), api: ADDIN_API }, register: () => { }, ...extra })

//----------------------------------------------------------------------------------------------------------------------
// TRUST AND MANIFESTS
//----------------------------------------------------------------------------------------------------------------------
eq('trust: the page\'s origin, the user\'s machine, elsewhere, not a URL',
    ['/addins/x.js', 'addins/x.js', 'https://shadytracer.com/a.js', 'http://localhost:8000/a.js', 'http://127.0.0.1/a.js', 'http://[::1]:3000/a.js',
     'https://evil.example/a.js', 'http://shadytracer.com/a.js', 'javascript:alert(1)', 'data:text/javascript,1'].map(u => trustOf(u, BASE)),
    ['same', 'same', 'same', 'local', 'local', 'local', 'foreign', 'foreign', 'bad', 'bad'])
eq('a manifest\'s entries read against the manifest, strings or { url }',
    parseManifest('["a/x.js", { "url": "/b.js" }, "http://localhost:1/c.js"]', 'http://localhost:8000/pro/addins.json'),
    ['http://localhost:8000/pro/a/x.js', 'http://localhost:8000/b.js', 'http://localhost:1/c.js'])
await throws('a manifest that is not JSON is said with where it is', () => parseManifest('[a', 'm.json'), /m\.json: not JSON/)
await throws('...nor a list', () => parseManifest('{}', 'm.json'), /a list of module URLs/)
await throws('...an entry that is no URL, by its place', () => parseManifest('["a.js", 3]', 'http://x/m.json'), /entry 2 is not a URL/)
eq('the user\'s list unreadable is none', [readList(memStorage({ [LIST_KEY]: '{' })), readList(null), readList(memStorage({ [LIST_KEY]: '["a", 2]' }))], [[], [], ['a']])

await throws('a module with no declaration', () => declarationOf({}, 'u'), /exports no `addin`/)
await throws('an id with capitals', () => declarationOf({ addin: { id: 'Bad', api: 1 }, register() { } }, 'u'), /lower case/)
await throws('another API version', () => declarationOf({ addin: { id: 'a', api: 2 }, register() { } }, 'u'), /written for add-in API 2, this page has 1/)
await throws('neither function', () => declarationOf({ addin: { id: 'a', api: 1 } }, 'u'), /neither register\(\) nor start\(\)/)
eq('a declaration with no name is named by its id', declarationOf({ addin: { id: 'a-1', api: 1 }, start() { } }, 'u'), { id: 'a-1', name: 'a-1', api: 1, version: '' })

//----------------------------------------------------------------------------------------------------------------------
// WHERE THEY COME FROM: each once, the manifest first, the address, the user's list
//----------------------------------------------------------------------------------------------------------------------
{
    const imported = []
    const mods = {
        'https://shadytracer.com/a.js': mod('a'), 'https://shadytracer.com/b.js': mod('b'),
        'http://localhost:8000/c.js': mod('c'), 'https://shadytracer.com/d.js': mod('d'),
    }
    const storage = memStorage({ [LIST_KEY]: JSON.stringify(['https://shadytracer.com/d.js', 'https://shadytracer.com/a.js']) })
    const A = createAddins({ base: BASE, search: '?addin=b.js&addin=http://localhost:8000/c.js', storage,
        importer: async u => { imported.push(u); return mods[u] },
        fetchText: async u => u === 'https://shadytracer.com/addins.json' ? '["a.js", "b.js"]' : null })
    const list = await A.register({ SHELL: standInShell(), PARAMS: makeParams(), base: BASE })
    eq('each once, in order, the first source keeping it', list.map(a => [a.id, a.from, a.state]),
        [['a', 'manifest', 'registered'], ['b', 'manifest', 'registered'], ['c', 'address', 'registered'], ['d', 'yours', 'registered']])
    eq('...each imported once', imported.length, 4)
}
{
    // a foreign add-in in the address: asked, refused and not imported; allowed, imported and remembered
    const imported = [], asked = []
    const u = 'https://evil.example/x.js'
    const run = async (answer, storage) => {
        const A = createAddins({ base: BASE, search: `?addin=${encodeURIComponent(u)}&addin=javascript:1`, storage,
            importer: async x => { imported.push(x); return mod('x') }, fetchText: async () => null,
            confirm: async t => { asked.push(t); return answer } })
        return A.register({ SHELL: standInShell(), PARAMS: makeParams() })
    }
    const storage = memStorage()
    const no = await run(false, storage)
    eq('a foreign module refused: asked, not imported, said', [asked.length, imported.length, no.map(a => [a.state, a.error])],
        [1, 0, [['refused', 'not allowed'], ['refused', 'not an http(s) URL']]])
    ok('...the question names the URL and what it can reach', /evil\.example\/x\.js[\s\S]*your projects/.test(asked[0]))
    const yes = await run(true, storage)
    eq('allowed: imported and joining the user\'s list', [imported, readList(storage), yes[0].state], [[u], [u], 'registered'])
    asked.length = 0
    await run(false, storage)
    eq('...and next time not asked again', [asked.length, imported.length], [0, 2])
}
{
    // a manifest from the address, from the user's machine: no question, its entries read against it
    const A = createAddins({ base: 'http://localhost:8000/ShadyTracer/app.html', search: '?addins=/addins.json',
        importer: async u => mod(u.endsWith('one.js') ? 'one' : 'two'),
        fetchText: async u => u === 'http://localhost:8000/addins.json' ? '["addins/one.js"]' : null,
        confirm: async () => { throw new Error('asked') } })
    const l = await A.register({ SHELL: standInShell(), PARAMS: makeParams() })
    eq('the private repository served locally: its manifest\'s add-in', l.map(a => [a.url, a.from, a.state]), [['http://localhost:8000/addins/one.js', 'address', 'registered']])
}
{
    const A = createAddins({ base: BASE, safe: true, importer: async () => { throw new Error('imported') }, fetchText: async () => '["a.js"]' })
    eq('a safe start loads nothing', [await A.register({ SHELL: standInShell(), PARAMS: makeParams() }), A.safe], [[], true])
}

//----------------------------------------------------------------------------------------------------------------------
// ONE THAT FAILS STOPS NO OTHER: a 404, a throw, a hang, a refusal; the phases
//----------------------------------------------------------------------------------------------------------------------
{
    const order = []
    const never = new Promise(() => { })
    const mods = {
        'gone.js': null,
        'throws.js': mod('throws', { register: () => { throw new Error('boom') } }),
        'hangs.js': mod('hangs', { register: () => never }),
        'old.js': { addin: { id: 'old', api: 0 }, register() { } },
        'good.js': mod('good', {
            register: st => { order.push('register good'); let threw = null; try { st.rt } catch (e) { threw = e.message }; order.push(threw) },
            start: async st => { order.push(`start good ${st.rt.name}`) },
        }),
        'twin.js': mod('good'),
        'late.js': mod('late', { start: () => { throw new Error('late boom') } }),
    }
    const logged = []
    const A = createAddins({ base: BASE, search: '', storage: memStorage({ [LIST_KEY]: JSON.stringify(Object.keys(mods).map(k => new URL(k, BASE).href)) }),
        importer: async u => { const m = mods[u.split('/').pop()]; if (!m) throw new Error('404'); return m },
        fetchText: async () => null, log: (k, t) => logged.push([k, t]), timeoutMs: { load: 50, register: 50, start: 50 } })
    const l = await A.register({ SHELL: standInShell(), PARAMS: makeParams() })
    const states = () => Object.fromEntries(A.list().map(a => [a.url.split('/').pop(), [a.state, a.error]]))
    eq('each failure its own, the rest registered', states(), {
        'gone.js': ['failed', '404'], 'throws.js': ['failed', 'boom'], 'hangs.js': ['failed', 'register(): no answer after 0.05 s'],
        'old.js': ['refused', `${new URL('old.js', BASE).href}: written for add-in API 0, this page has 1`],
        'good.js': ['registered', null], 'twin.js': ['refused', "another add-in has the id 'good'"], 'late.js': ['registered', null] })
    ok('...every failure in the console', logged.filter(x => x[0] === 'error').length === 5, JSON.stringify(logged))
    eq('the renderer not there at register, said', order, ['register good', 'add-in good: st.rt is there from start(), not register()'])
    await throws('start before register is refused', () => createAddins({ base: BASE }).start(), /after register/)
    await A.start({ RT: { name: 'rt' } })
    eq('start: only the registered, with the rest of the page', [order.at(-1), states()['good.js'][0], states()['late.js']], ['start good rt', 'started', ['failed', 'late boom']])
    ok('...the list given back as copies', A.list()[0] !== A.list()[0] && l.length === 7)
    await throws('start runs once', () => A.start({}), /runs once/)
}

//----------------------------------------------------------------------------------------------------------------------
// THE API: an add-in's names its own; the page's settings by path; storage under its id
//----------------------------------------------------------------------------------------------------------------------
{
    const S = standInShell(), P = makeParams(), storage = memStorage()
    const page = { radius: 1 }
    P.provide('scene', () => [{ path: 'scene/n4/radius', min: 0, max: 10, get: () => page.radius, set: v => { page.radius = v } }])
    let st = null, x = 3
    const A = createAddins({ base: BASE, storage, importer: async () => mod('demo', {
        register: s => {
            st = s
            s.shell.panel({ id: 'main', title: 'Main' })
            s.shell.command({ id: 'go', menu: 'Analysis', label: 'Go', run: () => s.shell.open('main') })
            s.params.provide(() => [{ path: 'x', label: 'X', min: 0, max: 5, get: () => x, set: v => { x = v } }])
        } }), fetchText: async () => '["demo.js"]' })
    await A.register({ SHELL: S, PARAMS: P, base: BASE, storage, importer: async u => ({ u }) })
    eq('a panel and a command carry the add-in\'s id', [S.panels[0].id, S.panels[0].module, S.commands[0].id, S.commands[0].group], ['addin.demo.main', 'addin', 'addin.demo.go', 'addin.demo'])
    eq('...no View entries made at register (the page\'s own call decides the window verbs)', S.std, 0)
    S.commands[0].run()
    eq('...its own panel opened by its short id', S.opened, ['addin.demo.main'])
    eq('its setting in the page\'s registry, under addin/demo/, grouped by its name', [P.read('addin/demo/x'), P.get('addin/demo/x').group, st.params.path('x')], [3, 'DEMO', 'addin/demo/x'])
    st.params.write('addin/demo/x', 9)
    eq('...written and coerced to its range', x, 5)
    st.params.write('scene/n4/radius', 4)
    eq('the page\'s settings by path', page.radius, 4)
    await throws('...an unknown one thrown', () => st.params.write('scene/n9/r', 1), /no parameter/)
    st.storage.set('k', { a: 1 })
    eq('storage under its id, JSON', [storage.map.get('addin.demo.k'), st.storage.get('k'), st.storage.get('none', 7)], ['{"a":1}', { a: 1 }, 7])
    await throws('importCore takes a path within the page', () => st.importCore('https://x/y.js'), /within the page/)
    eq('...and imports it from the page\'s base', await st.importCore('lib/pathtracer/optics/illum.js'), { u: 'https://shadytracer.com/lib/pathtracer/optics/illum.js' })
    eq('the contract is frozen', [Object.isFrozen(st), Object.isFrozen(st.shell), Object.isFrozen(st.params)], [true, true, true])
    await A.start({ RT: {}, BUILDER: { doc: { id: 'd' }, model: {}, commit: k => { st.__k = k } } })
    st.shell.panel({ id: 'later' })
    eq('a panel made after start gets its View entry at once', S.std, 1)
    eq('the builder from start, the document read', st.builder.doc, { id: 'd' })
}

//----------------------------------------------------------------------------------------------------------------------
// THE EXAMPLE ADD-IN (docs/addins/template): through the loader, its sweep through the real script API over a stand-in
// optics page, its panel over a stand-in document
//----------------------------------------------------------------------------------------------------------------------
{
    const template = join(repo, 'docs/addins/template/addins/example/index.js'), fixture = join(here, 'fixtures/example.js')
    ok('the fixture is the template\'s example, byte for byte', readFileSync(template, 'utf8') === readFileSync(fixture, 'utf8'))
    eq('the template\'s manifest names it', JSON.parse(readFileSync(join(repo, 'docs/addins/template/addins.json'), 'utf8')), ['addins/example/index.js'])

    /* the optics page: a floor of 16 x 16 cells lit evenly, but for one cell given more the further the swept setting
       is from 0.6 -- so its uniformity is 1 at 0.6 exactly, and less either side */
    const page = { pos: [0, 0, 0] }
    const P = makeParams()
    P.provide('scene', () => [{ path: 'scene/n4/transform/position', dims: 3, min: -10, max: 10, get: () => page.pos.slice(), set: v => { page.pos = v.slice() } }])
    const snapshotAt = x => {
        const hits = []
        for (let y = 0; y < 64; y++) for (let i = 0; i < 64; i++) hits.push({ pos: [(i + 0.5) / 64, (y + 0.5) / 64, 0], dir: [0, 0, -1], flux: 1 / 4096, tag: 3 })
        hits.push({ pos: [0.5 / 16, 0.5 / 16, 0], dir: [0, 0, -1], flux: Math.abs(x - 0.6), tag: 3 })
        const v = (a, se = null) => ({ value: a, se })
        return { results: { unit: 'lm', emitted: v(1), escaped: v(0), lost: v(0), absorbed: v(0), detected: v(1), volume: v(0), objects: [], materials: [] },
            far: null, rays: 1e6, hits, hitsUnit: 'lm', lengthUnit: 'm', metresPerUnit: 1, tagName: () => 'floor', matName: i => `m${i}`,
            corners: () => [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 0.001], [1, 0, 0.001], [0, 1, 0.001], [1, 1, 0.001]] }
    }
    const traced = []
    const OPTICS = { analyse: async () => { traced.push(page.pos[1]); return snapshotAt(page.pos[1]) }, analysis: () => null, analysisSetup: () => ({}), setupAnalysis: p => p }
    const RT = { sceneBusy: () => false }
    const scriptApi = (signal, log) => makeScriptApi({ PARAMS: P, RT, BUILDER: { applying: false }, OPTICS, signal, log, frame: () => Promise.resolve() })

    /* a document with as much as the example's panel uses */
    const made = []
    globalThis.document = { createElement: tag => { const e = { tag, children: [], value: '', textContent: '', disabled: false, on: {},
        append(...c) { this.children.push(...c) }, addEventListener(t, fn) { this.on[t] = fn } }; made.push(e); return e } }
    const S = standInShell(), storage = memStorage()
    const A = createAddins({ base: BASE, storage, importer: u => import(u),
        fetchText: async () => JSON.stringify([pathToFileURL(fixture).href]) })
    const l = await A.register({ SHELL: S, PARAMS: P, base: BASE, storage })
    eq('the example registered: its panel, its command, its setting', [l[0].state, l[0].name, S.panels[0].id, S.commands[0].id, P.read('addin/example/steps')],
        ['registered', 'Example: sweep', 'addin.example.sweep', 'addin.example.sweep', 5])
    await A.start({ RT, OPTICS, scriptApi })
    eq('...and started', A.list()[0].state, 'started')

    const { sweep } = await import(pathToFileURL(fixture).href)
    await throws('a vector setting with no part named is said', () => sweep(scriptApi(new AbortController().signal, () => { }), { path: 'scene/n4/transform/position', from: 0, to: 1 }), /has 3 numbers: say which/)

    /* the panel's button: y from 0 to 1 in six steps, the best (0.6) set */
    const inputs = made.filter(e => e.tag === 'input'), button = made.find(e => e.tag === 'button'), out = made.find(e => e.tag === 'pre')
    P.write('addin/example/steps', 6)
    inputs[0].value = 'scene/n4/transform/position'; inputs[1].value = '0'; inputs[2].value = '1'; inputs[3].value = '1'
    await button.on.click()
    eq('the sweep traced each value once, in order', traced.map(v => +v.toFixed(6)), [0, 0.2, 0.4, 0.6, 0.8, 1])
    ok('...the best its 0.6, uniformity 1, said', /best: 0\.6000 \(U0 1\.000\), set/.test(out.textContent), out.textContent)
    eq('...the setting left at the best, the other parts kept', page.pos.map(v => +v.toFixed(6)), [0, 0.6, 0])
    ok('...each step\'s uniformity less away from 0.6', (() => { const u = out.textContent.split('\n').slice(0, 6).map(r => +/U0 ([\d.]+)/.exec(r)[1]); return u[0] < u[2] && u[2] < u[3] && u[5] < u[4] && u[4] < u[3] })(), out.textContent)
    eq('...its progress shown and taken away', [S.jobs.at(-2)[0], S.jobs.at(-2)[1].done, S.jobs.at(-1)], ['addin.example.sweep', 6, ['addin.example.sweep', null]])
    eq('...the path kept for next time', storage.map.get('addin.example.path'), '"scene/n4/transform/position"')
    delete globalThis.document
}

//----------------------------------------------------------------------------------------------------------------------
// THE PAGE: the phases where they must be (app.html's inline script, which nothing imports), and nothing to load here
//----------------------------------------------------------------------------------------------------------------------
{
    const app = readFileSync(join(repo, 'app.html'), 'utf8')
    const at = s => app.indexOf(s)
    const reg = at('await ADDINS.register('), std = at('SHELL.standardCommands({ window: false'), restore = at('SHELL.layout.restore()')
    const start = at('ADDINS.start('), rtStart = app.lastIndexOf('RT.start()'), first = at('await firstCompile(')
    ok('register() before the page\'s View entries and the layout\'s restore', reg > 0 && reg < std && std < restore, JSON.stringify({ reg, std, restore }))
    ok('start() after the first compile and the render loop\'s start', start > first && start > rtStart && first > 0, JSON.stringify({ start, first, rtStart }))
    ok('no add-in on a safe start or after an unfinished one', /safe: new URLSearchParams\(location\.search\)\.has\('safe'\) \|\| unfinished/.test(app))
    eq('this repository loads none: its addins.json is empty', JSON.parse(readFileSync(join(repo, 'addins.json'), 'utf8')), [])
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
