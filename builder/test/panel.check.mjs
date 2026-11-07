// node builder/test/panel.check.mjs
//
// THE PROPERTIES PANEL'S JOINS (model version 14), headless, in the real panel and PropertyTable over the real
// model with a stand-in builder: a child of a group shows how it joins and whether it has a blend of its own,
// and changing either reaches the document -- the join and the checkbox as a compile, the blend as a live
// uniform; the base says it is the base; a node at the top level has no join; a group has its blend and no op
// any more. Nothing else ran these controls: the page needs WebGPU, which this container does not have. What
// the picture shows after is the user's to judge.
//
// OPTIONAL, AND LOUD ABOUT IT, as lib/shell/test/example.check.mjs is: it needs Playwright's Chromium.
/* global CHECK -- the page's, in the evaluated functions */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execSync } from 'node:child_process'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
let chromium
try { ({ chromium } = await import('playwright')) } catch {
    try { ({ chromium } = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'playwright/index.mjs')).href)) } catch { }
}
if (!chromium) { console.log('(panel check SKIPPED: no playwright. npm i -g playwright to get it.)'); process.exit(0) }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }
const server = createServer(async (req, res) => {
    try {
        const path = join(repo, decodeURIComponent(new URL(req.url, 'http://x').pathname))
        if (!path.startsWith(repo)) throw new Error('outside')
        res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
        res.end(await readFile(path))
    } catch { res.writeHead(404); res.end() }
})
await new Promise(r => server.listen(0, r))
const b = await chromium.launch({ args: ['--disable-gpu'] })
const p = await b.newPage()
const errs = []
p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })
let failed = 0
const ok = (n, c, x = '') => { if (!c) failed++; console.log((c ? 'ok    ' : 'FAIL  ') + n + (c ? '' : '  ' + x)) }
await p.goto(`http://localhost:${server.address().port}/builder/test/panel.html`)
await p.waitForFunction(() => window.CHECK, null, { timeout: 5000 })

/* the rows of the panel as { label: the row's element }, read from Tweakpane's label cells */
const rowsOf = id => p.evaluate(id => {
    CHECK.panel.show(id)
    return [...document.querySelectorAll('.tp-lblv')].map(r => r.querySelector('.tp-lblv_l')?.textContent.trim())
}, id)
/* a control in the row labelled `label`: set a select's or an input's value, or click a checkbox */
const set = (label, value) => p.evaluate(([label, value]) => {
    const row = [...document.querySelectorAll('.tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim() === label)
    if (!row) return `no row '${label}'`
    const sel = row.querySelector('select'), box = row.querySelector('input[type=checkbox]'), txt = row.querySelector('input.tp-txtv_i')
    // Tweakpane's options are text only and chosen by index (tweakpane-4.0.4.js ListView): pick by the text
    if (sel) {
        const i = [...sel.options].findIndex(o => o.textContent.trim().startsWith(value))
        if (i < 0) return `no option '${value}' in '${label}'`
        sel.selectedIndex = i; sel.dispatchEvent(new Event('change', { bubbles: true }))
    }
    else if (box) box.click()
    else if (txt) { txt.value = String(value); txt.dispatchEvent(new Event('change', { bubbles: true })) }
    else return `no control in '${label}'`
    return 'set'
}, [label, value])
const state = () => p.evaluate(() => {
    const n = id => CHECK.M.find(CHECK.doc, id).node
    return { b: [n('b').join ?? 'union', n('b').joinBlend ?? null], c: [n('c').join ?? 'union', n('c').joinBlend ?? null], g: n('g').blend,
             live: CHECK.T.live.slice(), commits: CHECK.T.commits.slice(), structure: CHECK.T.structure, labels: CHECK.T.labels }
})

// A CHILD: its join and its own blend
let rows = await rowsOf('b')
ok('a child of a group shows its join and the own-blend box, and no blend slider without one',
    rows.includes('join') && rows.includes('own blend') && !rows.includes('join blend'), JSON.stringify(rows))
let before = await state()
ok('changing the join', await set('join', 'intersect') === 'set')
let s = await state()
ok('...reaches the document, as a compile with an undo step and a relabel',
    s.b[0] === 'intersect' && s.structure === before.structure + 1 && s.labels > before.labels && s.commits.at(-1) === null, JSON.stringify(s))

// ITS EDGE (model version 28): smooth by default, round or chamfer a compile with an undo step, smooth again no field
rows = await rowsOf('b')
ok('a child shows its edge, smooth by default', rows.includes('edge') && await p.evaluate(() => !('joinShape' in CHECK.M.find(CHECK.doc, 'b').node)), JSON.stringify(rows))
before = await state()
ok('setting it round', await set('edge', 'round') === 'set')
s = await state()
ok('...reaches the document, as a compile with an undo step', await p.evaluate(() => CHECK.M.find(CHECK.doc, 'b').node.joinShape) === 'round'
    && s.structure === before.structure + 1 && s.commits.at(-1) === null, JSON.stringify(s))
await rowsOf('b')
ok('...and back to smooth: no field', await set('edge', 'smooth') === 'set' && await p.evaluate(() => !('joinShape' in CHECK.M.find(CHECK.doc, 'b').node)))

// THE BASE says so
rows = await rowsOf('a')
ok('the first shape is the base', rows.includes('join (base)'), JSON.stringify(rows))

// AN OWN BLEND: live while the group combines
rows = await rowsOf('c')
ok('a child with its own blend shows its slider', rows.includes('join blend'), JSON.stringify(rows))
before = await state()
ok('setting it', await set('join blend', 0.08) === 'set')
s = await state()
ok('...is a live uniform write, jblend_<id>, with its undo step', s.c[1] === 0.08 && s.live.at(-1) === 'c.jblend'
    && s.commits.at(-1) === 'c.jblend' && s.structure === before.structure, JSON.stringify(s))
ok('turning it off', await set('own blend') === 'set')
s = await state()
ok('...takes the group\'s blend again, as a compile', s.c[1] === null && s.structure === before.structure + 1, JSON.stringify(s))
await p.waitForTimeout(50)          // the panel redraws after the change event
rows = await p.evaluate(() => [...document.querySelectorAll('.tp-lblv')].map(r => r.querySelector('.tp-lblv_l')?.textContent.trim()))
ok('...and the panel redraws without the slider', !rows.includes('join blend') && rows.includes('own blend'), JSON.stringify(rows))

// THE TOP LEVEL, and THE GROUP
rows = await rowsOf('top')
ok('a node at the top level has no join (always a plain union)', !rows.includes('join') && !rows.includes('own blend'), JSON.stringify(rows))
rows = await rowsOf('g')
ok('a group has its blend and no op any more', rows.includes('blend') && !rows.includes('combine'), JSON.stringify(rows))
before = await state()
ok('setting the group\'s blend', await set('blend', 0.2) === 'set')
s = await state()
ok('...is live (the group combines: one child subtracts)', s.g === 0.2 && s.live.at(-1) === 'g.blend' && s.structure === before.structure, JSON.stringify(s))

/* A GROUP'S MATERIAL (model.js version 23, 0.76.0): chosen in the group's panel, a compile and an undo step; an object
   in it then shows the group's, read-only, and "own material" -- checked, its own choice again; (each its own) back */
const mat = () => p.evaluate(() => {
    const n = id => CHECK.M.find(CHECK.doc, id).node
    return { g: n('g').material ?? null, a: n('a').material ?? null, own: n('a').ownMaterial ?? null, worn: CHECK.M.wornMaterial(CHECK.doc, 'a'),
             structure: CHECK.T.structure, commits: CHECK.T.commits.length }
})
rows = await rowsOf('a')
ok('an object in a group with no material: its material chosen, no own-material box', rows.includes('material') && !rows.includes('own material'), JSON.stringify(rows))
await rowsOf('g')
before = await mat()
ok('a group offers a material', await set('material', 'glass') === 'set')
let m = await mat()
ok('...the group\'s, worn by its objects over their own, a compile and an undo step', m.g === 'gl' && m.worn.material === 'gl' && m.worn.group === 'g'
    && m.a === before.a && m.structure === before.structure + 1 && m.commits > before.commits, JSON.stringify(m))
rows = await rowsOf('a')
let matShown = await p.evaluate(() => [...document.querySelectorAll('.tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim() === 'material')?.querySelector('input')?.value ?? null)
ok('an object in it shows the group\'s, read-only, and the own-material box', rows.includes('own material') && /^glass · from group/.test(matShown ?? ''), JSON.stringify([rows, matShown]))
ok('checking own material', await set('own material') === 'set')
m = await mat()
ok('...keeps its own, as a compile', m.own === true && m.worn.material === m.a && m.worn.group === null && m.structure === before.structure + 2, JSON.stringify(m))
await p.waitForTimeout(50)
matShown = await p.evaluate(() => !![...document.querySelectorAll('.tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim() === 'material')?.querySelector('select'))
ok('...and the panel redraws with its own choice', matShown)
await set('own material')
await rowsOf('g')
ok('(each its own) takes the group\'s away', await set('material', '(each its own)') === 'set')
m = await mat()
ok('...no field, each its own again', m.g === null && m.worn.material === m.a, JSON.stringify(m))

// THE RECIPE (recipe.js): typed, wrong at a line, put right, applied with Ctrl+Enter as one undo step
await rowsOf('g')
const recipe = (text, key) => p.evaluate(([text, key]) => {
    const row = [...document.querySelectorAll('.tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim() === 'recipe')
    const ta = row?.querySelector('textarea')
    if (!ta) return { error: 'no recipe editor' }
    if (text != null) { ta.value = text; ta.dispatchEvent(new Event('input', { bubbles: true })) }
    if (key) ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
    return { text: ta.value, said: document.querySelector('.builder-recipe-said')?.textContent ?? '' }
}, [text, key])
let r = await recipe()
// (b intersects by now, and c has no own blend: the steps above)
ok('a group\'s panel shows its recipe, as the group is', /^blend 0\.2\nunion a\s+# a base\nintersect b\s+# b ball\nsubtract c\s+# c hole$/.test(r.text)
    && /as the group is/.test(r.said), JSON.stringify(r))
await recipe('union a, b\nsubtract q')
await p.waitForTimeout(400)           // checked on a pause
r = await recipe()
ok('a wrong name is said at its line and column', /line 2:10 {2}no child 'q'/.test(r.said), JSON.stringify(r))
before = await state()
await recipe('union c, a\nsubtract b  blend 0.07', 'apply')
s = await state()
const order = await p.evaluate(() => CHECK.M.find(CHECK.doc, 'g').node.children.map(c => `${c.id}:${c.join ?? 'union'}:${c.joinBlend ?? '-'}`))
ok('Ctrl+Enter applies it: the order, the joins, the own blends, the group\'s blend back to none',
    JSON.stringify(order) === JSON.stringify(['c:union:-', 'a:union:-', 'b:subtract:0.07']) && s.g === 0, JSON.stringify([order, s.g]))
ok('...as one undo step and one compile', s.commits.length === before.commits.length + 1 && s.commits.at(-1) === null && s.structure === before.structure + 1,
    JSON.stringify(s))
await p.waitForTimeout(50)            // the panel is drawn afresh from the document
r = await recipe()
ok('...and the panel shows the recipe the document now makes', /^union a, b\s+#.*\nsubtract c {2}blend 0\.07/.test(r.text), JSON.stringify(r))

// A PROFILE (BUILDER.md §6 phase 3): its points as text, checked as typed, applied with Ctrl+Enter as one compile
const profile = (text, key) => p.evaluate(([text, key]) => {
    const row = [...document.querySelectorAll('.tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim().startsWith('outline') && r.querySelector('textarea'))
    const ta = row?.querySelector('textarea')
    if (!ta) return { error: 'no profile editor' }
    if (text != null) { ta.value = text; ta.dispatchEvent(new Event('input', { bubbles: true })) }
    if (key) ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
    return { text: ta.value, label: row.querySelector('.tp-lblv_l').textContent.trim(), said: document.querySelector('.builder-profile-said')?.textContent ?? '' }
}, [text, key])
rows = await rowsOf('pr')
let q = await profile()
ok('a profile is a text of its points, one a line, compile-time (the ⚙)', q.text === '0, 0\n1, 0, 0.1\n1, 1\n0, 1' && /⚙/.test(q.label) && /as it is: 4 points/.test(q.said), JSON.stringify(q))
await profile('0, 0\n1\n0, 1'); await p.waitForTimeout(400)
ok('a line of one number is said at its line', /line 2: "1" is not x, y/.test((await profile()).said), JSON.stringify(await profile()))
await profile('0, 0\n1, x\n0, 1'); await p.waitForTimeout(400)
ok('a name the object has not got is said by its point and entry (since profiles read names, 2026-10-02)', /point 2, y: no parameter 'x'/.test((await profile()).said), JSON.stringify(await profile()))
await profile('0, 0\n1, 0'); await p.waitForTimeout(400)
ok('too few points is said', /at least three/.test((await profile()).said))
await profile('0, 0\n2, 2\n2, 0\n0, 1'); await p.waitForTimeout(400)
ok('crossing edges are said, by their points', /edges 1-2 and 3-4 cross/.test((await profile()).said), (await profile()).said)
before = await state()
await profile('0, 0\n2, 0, 0.3\n2, 1\n0, 1', 'apply')
s = await state()
const outline = await p.evaluate(() => CHECK.M.find(CHECK.doc, 'pr').node.params.outline)
ok('Ctrl+Enter sets it in the document', JSON.stringify(outline) === JSON.stringify([[0, 0], [2, 0, 0.3], [2, 1], [0, 1]]), JSON.stringify(outline))
ok('...as one undo step and one compile', s.commits.length === before.commits.length + 1 && s.commits.at(-1) === null && s.structure === before.structure + 1, JSON.stringify(s))
await profile('0, 0\n1, 0'); await profile(null, 'apply')
ok('...and an unsound one is not applied', JSON.stringify(await p.evaluate(() => CHECK.M.find(CHECK.doc, 'pr').node.params.outline)) === JSON.stringify(outline))
/* the + dialog offers a profile to a code object and not to a group (model.js setParamKind refuses it there) */
const kindsOffered = id => p.evaluate(async id => {
    CHECK.panel.show(id)
    await new Promise(r => setTimeout(r, 50))
    const plus = [...document.querySelectorAll('[title="Add a parameter"]')][0]
    if (!plus) return ['(no +)']
    plus.click()
    await new Promise(r => setTimeout(r, 50))
    const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'vector'))
    const out = sel ? [...sel.options].map(o => o.value) : ['(no kind select)']
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    sel?.closest('div')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return out
}, id)
ok('the + dialog offers a profile on a code object', (await kindsOffered('pr')).includes('profile'), JSON.stringify(await kindsOffered('pr')))
ok('...and not on a group', !(await kindsOffered('g')).includes('profile') && (await kindsOffered('g')).includes('number'), JSON.stringify(await kindsOffered('g')))

// A PATH (phase 4): the same editor, three numbers a point (and a fillet), set through setPath into its { path }
const path = (text, key) => p.evaluate(([text, key]) => {
    const row = [...document.querySelectorAll('.tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim().startsWith('route') && r.querySelector('textarea'))
    const ta = row?.querySelector('textarea')
    if (!ta) return { error: 'no path editor' }
    if (text != null) { ta.value = text; ta.dispatchEvent(new Event('input', { bubbles: true })) }
    if (key) ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
    return { text: ta.value, label: row.querySelector('.tp-lblv_l').textContent.trim(), said: document.querySelector('.builder-path-said')?.textContent ?? '' }
}, [text, key])
rows = await rowsOf('pa')
q = await path()
ok('a path is a text of its points, x, y, z a line, compile-time (the ⚙)', q.text === '0, 0, 0\n1, 0, 0, 0.2\n1, 1, 0' && /⚙/.test(q.label) && /as it is: 3 points/.test(q.said), JSON.stringify(q))
await path('0, 0, 0\n1, 0\n1, 1, 0'); await p.waitForTimeout(400)
ok('a line with two numbers is said at its line, as not x, y, z', /line 2: "1, 0" is not x, y, z/.test((await path()).said), (await path()).said)
await path('0, 0, 0\n1, 0, 0\n0, 0, 0'); await p.waitForTimeout(400)
ok('a path folding back is said, by its point', /turns back on itself at point 2/.test((await path()).said), (await path()).said)
await path('0, 0, 0, 0.1\n1, 0, 0\n1, 1, 0'); await p.waitForTimeout(400)
ok('a fillet on an end is said, by its point', /point 1: an end has no corner/.test((await path()).said), (await path()).said)
before = await state()
await path('0, 0, 0\n2, 0, 0, 0.3\n2, 1, 0\n2, 1, 1', 'apply')
s = await state()
const route = await p.evaluate(() => CHECK.M.find(CHECK.doc, 'pa').node.params.route)
ok('Ctrl+Enter sets it in the document, as a { path }', JSON.stringify(route) === JSON.stringify({ path: [[0, 0, 0], [2, 0, 0, 0.3], [2, 1, 0], [2, 1, 1]] }), JSON.stringify(route))
ok('...as one undo step and one compile', s.commits.length === before.commits.length + 1 && s.commits.at(-1) === null && s.structure === before.structure + 1, JSON.stringify(s))
await path('0, 0, 0\n1, 0, 0\n0, 0, 0'); await path(null, 'apply')
ok('...and an unsound one is not applied', JSON.stringify(await p.evaluate(() => CHECK.M.find(CHECK.doc, 'pa').node.params.route)) === JSON.stringify(route))
// A POINT'S SECTION (2026-10-02): up to seven numbers -- after the fillet, scale x, scale y and twist; eight are too many
await path('0, 0, 0, 0, 1.5\n2, 0, 0, 0.3, 1, 0.5, 45\n2, 1, 0\n2, 1, 1'); await p.waitForTimeout(400)
ok('seven numbers a line: scale x, scale y and twist after the fillet, read clean', /reads clean/.test((await path()).said), (await path()).said)
await path('0, 0, 0\n2, 0, 0, 0.3, 1, 0.5, 45, 9\n2, 1, 0'); await p.waitForTimeout(400)
ok('...eight: said at its line, with what a point may have', /line 2: "2, 0, 0, 0.3, 1, 0.5, 45, 9" is not x, y, z, then fillet, scale x, scale y, twist if it has them/.test((await path()).said), (await path()).said)
await path('0, 0, 0\n2, 0, 0, 0.3, 0\n2, 1, 0'); await p.waitForTimeout(400)
ok('...a scale of 0: said by its point', /point 2: a scale is more than 0/.test((await path()).said), (await path()).said)
await path('0, 0, 0, 0, 1.5\n2, 0, 0, 0.3, 1, 0.5, 45\n2, 1, 0\n2, 1, 1', 'apply')
ok('...applied: the values in the document as typed', JSON.stringify(await p.evaluate(() => CHECK.M.find(CHECK.doc, 'pa').node.params.route.path))
    === JSON.stringify([[0, 0, 0, 0, 1.5], [2, 0, 0, 0.3, 1, 0.5, 45], [2, 1, 0], [2, 1, 1]]))
await path('0, 0, 0\n2, 0, 0, 0.3\n2, 1, 0\n2, 1, 1', 'apply')
// NAMES IN POINTS, AND LIVE (2026-10-01): a point may read the object's parameters; live, Apply is no compile, and a
// slider that makes the path unsound is said under it
await rowsOf('pa')
await path('0, 0, 0\n1, 0, 0, 0.2\n1, 1, h'); await p.waitForTimeout(400)
ok('a name the object has not got is said by its point and entry', /point 3, z: no parameter 'h'/.test((await path()).said), (await path()).said)
before = await state()
await path('0, 0, 0\n1, 0, 0, 0.2\n1, radius * 5, 0', 'apply')
s = await state()
ok('a point naming a parameter is applied as written (compiled: a compile)',
    JSON.stringify(await p.evaluate(() => CHECK.M.find(CHECK.doc, 'pa').node.params.route)) === JSON.stringify({ path: [[0, 0, 0], [1, 0, 0, 0.2], [1, 'radius * 5', 0]] })
    && s.structure === before.structure + 1, JSON.stringify(s))
await p.waitForTimeout(50)
before = await state()
ok('a path has a live box', await set('route: live', true) === 'set')
s = await state()
ok('...ticked: the path is live, as one compile and one undo step', await p.evaluate(() => CHECK.M.find(CHECK.doc, 'pa').node.params.route.live) === true
    && s.structure === before.structure + 1 && s.commits.length === before.commits.length + 1, JSON.stringify(s))
await p.waitForTimeout(50)
q = await path()
ok('...and its text is not marked compile-time any more', !/⚙/.test(q.label) && /as it is: 3 points/.test(q.said), JSON.stringify(q))
before = await state()
await path('0, 0, 0\n1, 0, 0, 0.3\n1, radius * 5, 0', 'apply')
s = await state()
ok('live: Ctrl+Enter applies with NO compile -- a live write of the path and one undo step',
    s.structure === before.structure && s.live.at(-1) === 'pa.route' && s.commits.length === before.commits.length + 1 && s.commits.at(-1) === null, JSON.stringify([before, s]))
await p.waitForTimeout(50)
before = await state()
/* a parameter's row has its pencil and cross in its label ("radius✎×"): found by how it starts */
const setParam = (name, value) => p.evaluate(([name, value]) => {
    const row = [...document.querySelectorAll('.tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim().replace(/[✎×]/g, '') === name)
    const txt = row?.querySelector('input.tp-txtv_i')
    if (!txt) return `no number field for '${name}'`
    txt.value = String(value); txt.dispatchEvent(new Event('change', { bubbles: true }))
    return 'set'
}, [name, value])
const said0 = await setParam('radius', 0)
ok('a slider on a name the path reads', said0 === 'set', said0 + ' ' + JSON.stringify(await rowsOf('pa')))
s = await state()
q = await path()
ok('...is a live write', s.live.at(-1) === 'pa.radius' && s.structure === before.structure, JSON.stringify(s))
ok('...and, the path made unsound, the editor says it draws nothing now, and why, with the value', /draws nothing now/.test(q.said) && /points 2 and 3 are the same point/.test(q.said) && /radius = 0/.test(q.said), q.said)
await setParam('radius', 0.1)
ok('...and back: as it is', /as it is: 3 points/.test((await path()).said), (await path()).said)
before = await state()
await set('route: live', false)
s = await state()
ok('unticked: compiled again, one compile', await p.evaluate(() => 'live' in CHECK.M.find(CHECK.doc, 'pa').node.params.route) === false && s.structure === before.structure + 1, JSON.stringify(s))
await p.waitForTimeout(50)
// A LIVE PROFILE (2026-10-02): the same box, names in its points, a live Apply with no compile, the verdict following
await p.evaluate(() => CHECK.M.addParam(CHECK.doc, 'pr', 'w', 2))
await rowsOf('pr')
before = await state()
await profile('0, 0\nw, 0, 0.3\nw, 1\n0, 1', 'apply')
s = await state()
ok('an outline naming a parameter is applied as written (compiled: a compile)', JSON.stringify(await p.evaluate(() => CHECK.M.find(CHECK.doc, 'pr').node.params.outline))
    === JSON.stringify([[0, 0], ['w', 0, 0.3], ['w', 1], [0, 1]]) && s.structure === before.structure + 1, JSON.stringify(s))
await p.waitForTimeout(50)
before = await state()
ok('a profile has a live box', await set('outline: live', true) === 'set')
s = await state()
ok('...ticked: listed live on its object, one compile and one undo step', JSON.stringify(await p.evaluate(() => CHECK.M.find(CHECK.doc, 'pr').node.liveProfiles)) === '["outline"]'
    && s.structure === before.structure + 1 && s.commits.length === before.commits.length + 1, JSON.stringify(s))
await p.waitForTimeout(50)
q = await profile()
ok('...its text not marked compile-time any more', !/⚙/.test(q.label) && /as it is: 4 points/.test(q.said), JSON.stringify(q))
before = await state()
await profile('0, 0\nw, 0, 0.2\nw, 1\n0, 1', 'apply')
s = await state()
ok('live: Ctrl+Enter applies with NO compile -- a live write of the outline and one undo step',
    s.structure === before.structure && s.live.at(-1) === 'pr.outline' && s.commits.length === before.commits.length + 1 && s.commits.at(-1) === null, JSON.stringify([before, s]))
await p.waitForTimeout(50)
before = await state()
await setParam('w', 0)
s = await state()
q = await profile()
ok('a slider on a name the outline reads is a live write, and made unsound the editor says it draws nothing now, and why',
    s.live.at(-1) === 'pr.w' && s.structure === before.structure && /draws nothing now/.test(q.said) && /w = 0/.test(q.said), q.said)
await setParam('w', 2)
ok('...and back: as it is', /as it is: 4 points/.test((await profile()).said), (await profile()).said)
before = await state()
await set('outline: live', false)
s = await state()
ok('unticked: compiled again, one compile', await p.evaluate(() => 'liveProfiles' in CHECK.M.find(CHECK.doc, 'pr').node) === false && s.structure === before.structure + 1, JSON.stringify(s))
await p.waitForTimeout(50)

/* THE CARET STAYS WHERE IT IS PUT (the user, 2026-10-02: "sometimes I cannot move the cursor in the box"). The page
   refreshes every table whenever the renderer's settings change -- the camera, any live write -- and the text box is
   a Tweakpane monitor made editable: its refresh wrote the textarea's text, and until a key was typed the caret
   went back to the start (propertytable.js) */
await rowsOf('pa')
const caret = await p.evaluate(async () => {
    const ta = [...document.querySelectorAll('textarea')][0]
    ta.focus(); ta.setSelectionRange(3, 3)
    CHECK.table.refresh(); await new Promise(r => setTimeout(r, 30))
    const untyped = ta.selectionStart
    ta.setRangeText('9', 5, 5, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true }))
    CHECK.table.refresh(); await new Promise(r => setTimeout(r, 30))
    return { untyped, typed: ta.selectionStart, focused: document.activeElement === ta }
})
ok('a refresh leaves the caret where it was put, before a key is typed and after', caret.untyped === 3 && caret.typed === 6 && caret.focused, JSON.stringify(caret))
/* A NUMBER NEVER BECOMES NaN, AND A NaN DOES NOT TAKE THE PANEL DOWN (the user, 2026-10-02: a parameter NaN that could
   not be changed, rows missing, the bent tube not pickable -- "[overlay] pick failed TypeError ... getDecimalDigits").
   A slider dragged while the panel is redrawn followed the mouse on its detached element, 0 wide, and wrote NaN; a
   number field takes expressions, and 0/0 is one; and Tweakpane cannot draw a NaN with no step, so show() stopped at
   that row -- every row after it missing, and a pick (which shows the panel) failed */
await p.evaluate(() => CHECK.M.setRange(CHECK.doc, 'pa', 'radius', { min: 0, max: 1, step: 0.01 }))
await rowsOf('pa')
const sbox = await p.evaluate(() => {
    const row = [...document.querySelectorAll('.tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim().replace(/[✎×]/g, '') === 'radius')
    const sl = row?.querySelector('.tp-sldv_t') || row?.querySelector('.tp-sldv'); const r = sl.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }
})
await p.mouse.move(sbox.x + 10, sbox.y + sbox.h / 2); await p.mouse.down(); await p.mouse.move(sbox.x + 30, sbox.y + sbox.h / 2)
const midDrag = await p.evaluate(() => CHECK.M.find(CHECK.doc, 'pa').node.params.radius)
await p.evaluate(() => CHECK.panel.show('pa'))                 // redrawn under the drag
await p.mouse.move(sbox.x + 50, sbox.y + sbox.h / 2); await p.mouse.move(sbox.x + 60, sbox.y + sbox.h / 2); await p.mouse.up()
const afterDrag = await p.evaluate(() => CHECK.M.find(CHECK.doc, 'pa').node.params.radius)
ok('a slider dragged while the panel is redrawn keeps a number, the one it had', Number.isFinite(afterDrag) && afterDrag === midDrag, `${midDrag} -> ${afterDrag}`)
/* A VALUE OUTSIDE ITS RANGE (the user, 2026-10-12: the RGBW example's 60 mm screen on a rectangle whose range stops at
   10): the slider widened to reach it, so a small drag from its end moves it a little -- the property table held the
   range as given, and the first drag wrote 1 over the 5 here */
const keptR = await p.evaluate(() => { const n = CHECK.M.find(CHECK.doc, 'pa').node; const was = n.params.radius; n.params.radius = 5; return was })
await rowsOf('pa')
const wbox = await p.evaluate(() => {
    const row = [...document.querySelectorAll('.tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim().replace(/[✎×]/g, '') === 'radius')
    const sl = row?.querySelector('.tp-sldv_t') || row?.querySelector('.tp-sldv'); const r = sl.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }
})
await p.mouse.move(wbox.x + wbox.w - 1, wbox.y + wbox.h / 2); await p.mouse.down(); await p.mouse.move(wbox.x + wbox.w - 4, wbox.y + wbox.h / 2); await p.mouse.up()
const wideR = await p.evaluate(() => CHECK.M.find(CHECK.doc, 'pa').node.params.radius)
ok('a value above its range\'s maximum: the slider reaches it, a small drag from its end leaves it near (5 in 0..1)',
    wideR > 4 && wideR <= 5, String(wideR))
await p.evaluate(r => { CHECK.M.find(CHECK.doc, 'pa').node.params.radius = r }, keptR)
await p.evaluate(() => CHECK.M.setRange(CHECK.doc, 'pa', 'radius', null))
await rowsOf('pa')
const wasR = await p.evaluate(() => CHECK.M.find(CHECK.doc, 'pa').node.params.radius)
await setParam('radius', '0/0')
ok('0/0 typed into a number leaves it as it was', await p.evaluate(() => CHECK.M.find(CHECK.doc, 'pa').node.params.radius) === wasR,
    String(await p.evaluate(() => CHECK.M.find(CHECK.doc, 'pa').node.params.radius)))
// a NaN already in the document, no range, not named by the path, and a row after it
const nan = await p.evaluate(() => {
    // parameters of its block (model.js version 16), then the NaN in the node's value, as a file could hold it
    CHECK.M.addParam(CHECK.doc, 'pa', 'bad', 0); CHECK.M.addParam(CHECK.doc, 'pa', 'after', 0.5)
    const n = CHECK.M.find(CHECK.doc, 'pa').node
    n.params.bad = NaN
    try { CHECK.panel.show('pa'); return { rows: [...document.querySelectorAll('.tp-lblv')].map(r => r.querySelector('.tp-lblv_l')?.textContent.trim()) } } catch (e) { return { threw: String(e) } }
})
ok('a NaN parameter: the panel is drawn, every row of it, the bad one marked', !nan.threw && nan.rows.some(r => /^bad.*⚠/.test(r)) && nan.rows.some(r => /^after/.test(r)) && nan.rows.includes('code'), JSON.stringify(nan))
const fixed = await p.evaluate(async () => {
    const row = [...document.querySelectorAll('.tp-lblv')].find(r => /^bad/.test(r.querySelector('.tp-lblv_l')?.textContent.trim()))
    const t = row.querySelector('input'); t.value = '0.25'; t.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(r => setTimeout(r, 30))
    return CHECK.M.find(CHECK.doc, 'pa').node.params.bad
})
ok('...a number typed into it puts it right', fixed === 0.25, String(fixed))
const gone = await p.evaluate(async () => {
    await new Promise(r => setTimeout(r, 30))
    const row = [...document.querySelectorAll('.tp-lblv')].find(r => /^bad/.test(r.querySelector('.tp-lblv_l')?.textContent.trim()))
    ;[...row.querySelectorAll('span')].find(sp => sp.title === 'Delete bad').click()
    await new Promise(r => setTimeout(r, 30))
    return 'bad' in CHECK.M.find(CHECK.doc, 'pa').node.params
})
ok('...and its × deletes it', gone === false)
await p.evaluate(() => { delete CHECK.M.find(CHECK.doc, 'pa').node.params.after })
// DELETING A PARAMETER A PATH NAMES is refused -- said, where it was clicked
await rowsOf('pa')
const refused = await p.evaluate(async () => {
    const row = [...document.querySelectorAll('.tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim().replace(/[✎×]/g, '') === 'radius')
    ;[...row.querySelectorAll('span')].find(sp => sp.title === 'Delete radius').click()
    await new Promise(r => setTimeout(r, 30))
    return { kept: 'radius' in CHECK.M.find(CHECK.doc, 'pa').node.params, said: document.querySelector('.builder-param-said')?.textContent ?? '' }
})
ok('deleting a parameter the path names is refused, and the panel says why', refused.kept && /'radius' is named by path 'route' \(point 3\)/.test(refused.said), JSON.stringify(refused))
await rowsOf('pa')
ok('the + dialog offers a path on a code object, and not on a group',
    (await kindsOffered('pa')).includes('path') && !(await kindsOffered('g')).includes('path'), JSON.stringify([await kindsOffered('pa'), await kindsOffered('g')]))

// LOCKS (model.js setLock): two rows above the position; a row a lock holds disabled, a vector without its +
const rowState = () => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.tp-lblv')].map(r => {
    const label = r.querySelector('.tp-lblv_l')
    const inputs = [...r.querySelectorAll('input, textarea, select')]
    return [label?.textContent.trim().replace(/[✎×+]/g, ''), { disabled: inputs.length > 0 && inputs.every(i => i.disabled || i.readOnly),
        plus: !!label?.querySelector('.vector-plus-btn'), tip: label?.title ?? '' }]
})))
// the sphere's radius row, whatever its label says after the name (its unit, when it is marked a length)
const radiusOf = rs => rs[Object.keys(rs).find(k => /^radius\b/.test(k))]
const settle = () => p.waitForTimeout(60)        // the panel redraws a tick after a change, and PropertyTable adds the + after that
rows = await rowsOf('top')
ok('a node\'s lock rows, just above its position', rows.indexOf('lock position') >= 0 && rows.indexOf('lock parameters') === rows.indexOf('lock position') + 1
    && rows.indexOf('position (m)') === rows.indexOf('lock parameters') + 1, JSON.stringify(rows))
await settle()
let rs = await rowState()
ok('...unlocked: position, rotation and scale can be changed, the vectors with their +', !rs['position (m)'].disabled && !rs['rotation °'].disabled
    && !rs.scale.disabled && rs['position (m)'].plus, JSON.stringify(rs))
before = await state()
ok('lock position', await set('lock position') === 'set')
await settle()
s = await state()
const topLock = () => p.evaluate(() => CHECK.M.lockOf(CHECK.M.find(CHECK.doc, 'top').node))
ok('...reaches the document, one undo step, the tree told, nothing compiled',
    (await topLock()).position && s.commits.at(-1) === null && s.labels > before.labels && s.structure === before.structure, JSON.stringify(s))
rs = await rowState()
ok('...position and rotation disabled with no +, saying how to unlock; the scale and the radius not',
    rs['position (m)'].disabled && rs['rotation °'].disabled && !rs['position (m)'].plus && !rs['rotation °'].plus
    && /untick "lock position"/.test(rs['position (m)'].tip) && !rs.scale.disabled && !radiusOf(rs).disabled && rs['lock position'].disabled === false, JSON.stringify(rs))
ok('lock parameters', await set('lock parameters') === 'set')
await settle()
rs = await rowState()
ok('...the scale and the radius disabled too, saying so', rs.scale.disabled && radiusOf(rs).disabled && /untick "lock parameters"/.test(radiusOf(rs).tip), JSON.stringify(rs))
await set('lock position'); await settle(); await set('lock parameters'); await settle()
rs = await rowState()
ok('both unticked: every row as it was', !rs['position (m)'].disabled && !rs.scale.disabled && !radiusOf(rs).disabled && rs['position (m)'].plus
    && JSON.stringify(await topLock()) === JSON.stringify({ position: false, params: false }), JSON.stringify(rs))
// THE PATTERN FRAME (model.js setPattern, version 24): a box under the placement; the first value moved gives the node one
// (a compile), the next is its uniform (live), "Take it away" a compile again; on a CSG group's shape it says whose it is
{
    const pat = () => p.evaluate(() => CHECK.M.find(CHECK.doc, 'top').node.pattern ?? null)
    rows = await rowsOf('top')
    ok('an object: its pattern frame\'s rows after its placement, labelled apart from it', rows.includes('pattern at (m)') && rows.includes('pattern turn °')
        && rows.indexOf('pattern at (m)') > rows.indexOf('scale') && rows.filter(r => r === 'position (m)').length === 1, JSON.stringify(rows))
    // one component of a vector row typed in (its label carries the row's + for its sliders)
    const setVec = (label, i, value) => p.evaluate(([label, i, value]) => {
        const row = [...document.querySelectorAll('.tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim().replace(/[✎×+]/g, '') === label)
        const input = row?.querySelectorAll('input.tp-txtv_i')[i]
        if (!input) return `no component ${i} in '${label}'`
        input.value = String(value); input.dispatchEvent(new Event('change', { bubbles: true }))
        return 'set'
    }, [label, i, value])
    let b4 = await state()
    ok('a pattern value moved', await setVec('pattern at (m)', 0, 0.25) === 'set')
    let st = await state()
    ok('...gives it one: in the document, an undo step and a compile', (await pat())?.pos.x === 0.25 && st.structure === b4.structure + 1 && st.commits.at(-1) === null,
        JSON.stringify([await pat(), st]))
    await settle(); await rowsOf('top'); await settle()
    b4 = await state()
    ok('another', await setVec('pattern turn °', 0, 90) === 'set')
    st = await state()
    ok('...is live: its uniform pushed, an undo step keyed for a drag, no compile', (await pat())?.rot.x === 90 && st.live.at(-1) === 'top.pattern'
        && st.commits.at(-1) === 'top.pattern' && st.structure === b4.structure, JSON.stringify([await pat(), st]))
    const clicked = await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Take it away')); b?.click(); return !!b })
    st = await state()
    ok('"Take it away": none again, a compile', clicked && (await pat()) === null && st.structure === b4.structure + 1, JSON.stringify(st))
    await settle()
    await rowsOf('b')
    const said = await p.evaluate(() => document.querySelector('.builder-pattern-said')?.textContent ?? '')
    ok('a CSG group\'s shape: its box says the material is laid out in the group\'s frame', /^A shape of '.+', which folds its shapes/.test(said), said)
}
// A PATH'S POINTS are parameters: read-only, Apply disabled and Ctrl+Enter refused
await p.evaluate(() => CHECK.M.setLock(CHECK.doc, 'pa', 'params', true))
await rowsOf('pa'); await settle()
const pathLocked = await p.evaluate(async () => {
    const row = [...document.querySelectorAll('.tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim().startsWith('route') && r.querySelector('textarea'))
    const ta = row.querySelector('textarea'), was = JSON.stringify(CHECK.M.find(CHECK.doc, 'pa').node.params.route)
    const apply = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Apply route'))
    ta.value = '0, 0, 0\n2, 0, 0'; ta.dispatchEvent(new Event('input', { bubbles: true }))
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 30))
    return { readOnly: ta.readOnly, applyDisabled: apply?.disabled, same: JSON.stringify(CHECK.M.find(CHECK.doc, 'pa').node.params.route) === was }
})
ok('a locked path: its points read-only, Apply disabled, Ctrl+Enter changes nothing', pathLocked.readOnly && pathLocked.applyDisabled && pathLocked.same, JSON.stringify(pathLocked))
await p.evaluate(() => CHECK.M.setLock(CHECK.doc, 'pa', 'params', false))
// A MATERIAL has no locks
const matId = await p.evaluate(() => CHECK.M.addMaterial(CHECK.doc).id)
ok('a material has no lock rows', !(await rowsOf(matId)).includes('lock position'))

// THE SCENE'S RADIUS (model.js envRadius, version 15): in the Scene folder beside the unit, in it; live, one undo
// step; out of the Environment folder, where it was a renderer setting in metres
const readRows = () => p.evaluate(() => [...document.querySelectorAll('.tp-lblv')].map(r => r.querySelector('.tp-lblv_l')?.textContent.trim()))
const rootRows = await rowsOf('root')
ok('the Scene folder has the radius, after the unit, in its unit', rootRows.indexOf('environment radius (m)') === rootRows.indexOf('unit') + 1, JSON.stringify(rootRows))
ok('...reading the 400 m default of a scene that set none', await p.evaluate(() => {
    const row = [...document.querySelectorAll('.tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim() === 'environment radius (m)')
    return Number(row?.querySelector('input')?.value)
}) === 400)
const er0 = await state()
ok('typing 2.5', await set('environment radius (m)', 2.5) === 'set')
const er1 = await state()
ok('...sets the scene\'s radius, pushed live, one undo step, nothing compiled', await p.evaluate(() => CHECK.doc.envRadius) === 2.5
    && er1.live.at(-1) === 'root.envRadius' && er1.commits.at(-1) === 'root.envRadius' && er1.structure === er0.structure, JSON.stringify(er1))
/* THE UNIT ASKS HOW (0.72.0, unitdialog.js): scale the objects, convert the dimensions, keep the numbers -- and Cancel,
   which leaves the scene as it was and the row at its unit */
const unitDialog = () => p.evaluate(() => { const d = document.querySelector('.unit-dialog')
    return d && { text: d.textContent, ways: [...d.querySelectorAll('button')].map(b => b.dataset.how) } })
const unitRow = () => p.evaluate(() => [...document.querySelectorAll('.tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim() === 'unit')
    ?.querySelector('select')?.selectedOptions[0]?.textContent.trim())
const answer = how => p.evaluate(how => document.querySelector(`.unit-dialog button[data-how=${how}]`).click(), how)
const u0 = await state()
ok('the unit chosen: cm', await set('unit', 'cm') === 'set')
const dlg = await unitDialog()
ok('...asks how: scale, dimensions, keep, and Cancel, the factor said', dlg?.ways.join() === 'scale,dimensions,keep,cancel'
    && /m \u2192 cm/.test(dlg.text) && /\u00d7100/.test(dlg.text), JSON.stringify(dlg))
ok('...converting the dimensions says first what it cannot: the plate\'s and the pipe\'s own code', /plate: its own code/.test(dlg?.text) && /pipe: its own code/.test(dlg?.text), dlg?.text)
await answer('cancel')
await p.waitForTimeout(50)
ok('Cancel: the scene in m, nothing committed or compiled, the row back at m, the question gone', await p.evaluate(() => CHECK.doc.unit ?? 'm') === 'm'
    && (await state()).commits.length === u0.commits.length && (await state()).structure === u0.structure && await unitRow() === 'm' && !(await unitDialog()),
    JSON.stringify([await unitRow(), await state()]))
ok('the unit chosen again: cm', await set('unit', 'cm') === 'set')
await answer('keep')
await p.waitForTimeout(50)
ok('keep the numbers: the unit cm, one undo step, a compile, the question gone', await p.evaluate(() => CHECK.doc.unit) === 'cm'
    && (await state()).commits.length === u0.commits.length + 1 && (await state()).structure === u0.structure + 1 && !(await unitDialog()))
ok('...and the radius row says so by itself (the panel redrawn), the number kept: the scene reinterpreted, as its shapes',
    (await readRows()).includes('environment radius (cm)') && await p.evaluate(() => CHECK.doc.envRadius) === 2.5, JSON.stringify(await readRows()))
/* THE SCENE'S SURFACE TOLERANCE (0.66.0, model.js setTolerance): after the radius, in its unit, 0 the automatic one; live,
   one undo step. What the Renderer panel's row held there (lib/pathtracer/test/renderer.check.mjs until 0.66.0): a box and
   not a slider, nothing rounded that is typed -- 0.000001 once became 0 -- and a value above 100 kept */
{
    const TOL = 'surface tolerance (cm, 0 = auto)'
    const r = await readRows()
    ok('the tolerance is the scene\'s, after its radius, in its unit', r.indexOf(TOL) === r.indexOf('environment radius (cm)') + 1, JSON.stringify(r))
    const field = () => p.evaluate(TOL => [...document.querySelectorAll('#t .tp-lblv')].find(e => e.querySelector('.tp-lblv_l')?.textContent.trim() === TOL), TOL)
    ok('...a box to type into, not a slider', await p.evaluate(TOL => { const row = [...document.querySelectorAll('#t .tp-lblv')]
        .find(e => e.querySelector('.tp-lblv_l')?.textContent.trim() === TOL); return !!row && !row.querySelector('.tp-sldv') }, TOL))
    const t0 = await state()
    ok('typing 0.0002 (2 um)', await set(TOL, '0.0002') === 'set')
    const t1 = await state()
    ok('...sets the scene\'s, unrounded, pushed live, one undo step, nothing compiled', await p.evaluate(() => CHECK.doc.tolerance) === 0.0002
        && t1.live.at(-1) === 'root.tolerance' && t1.commits.at(-1) === 'root.tolerance' && t1.structure === t0.structure, JSON.stringify([await p.evaluate(() => CHECK.doc.tolerance), t1.live.slice(-1)]))
    ok('...a millionth of one typed is kept', await set(TOL, '0.000001') === 'set' && await p.evaluate(() => CHECK.doc.tolerance) === 0.000001)
    ok('...and 250 too (no range of the table\'s own)', await set(TOL, '250') === 'set' && await p.evaluate(() => CHECK.doc.tolerance) === 250)
    ok('0 is the automatic one: nothing in the scene', await set(TOL, '0') === 'set' && await p.evaluate(() => !('tolerance' in CHECK.doc)))
    void field
}
// THE ENVIRONMENT, in the Scene folder since 0.52.0 (the user, 2026-10-10): its source and its settings after the radius;
// its old id shows the scene; a source chosen redraws it with that source's settings
{
    const rows = await rowsOf('root'), folders = await p.evaluate(() => [...document.querySelectorAll('.tp-fldv_t')].map(t => t.textContent.trim()))
    ok('the Scene folder holds the environment: its folder, its source after the radius', folders.includes('environment')
        && rows.indexOf('Source') > rows.indexOf('environment radius (cm)'), JSON.stringify({ rows, folders }))
    const old = await rowsOf('#environment')
    ok('...and the environment\'s old id shows the Scene', JSON.stringify(old) === JSON.stringify(rows), JSON.stringify(old))
    ok('choosing the studio', await set('Source', 'studio') === 'set')
    await p.waitForTimeout(50)
    ok('...redraws it with the studio\'s settings', (await readRows()).includes('Studio (lx, horizontal)'), JSON.stringify(await readRows()))
    /* THE STUDIO COLOUR SET (the user, 2026-10-10: "it always resets to white"): its picker's red field typed, the scene
       holding it, and the row still showing it once redrawn */
    const red = v => p.evaluate(v => {
        const row = [...document.querySelectorAll('.tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim() === 'Studio colour')
        const field = row?.querySelectorAll('input')[1]
        if (v != null && field) { field.value = String(v); field.dispatchEvent(new Event('change', { bubbles: true })) }
        return field ? Number(field.value) : null
    }, v)
    await red(0.25)
    await p.waitForTimeout(50)
    ok('the studio colour typed: the scene holds it (to the picker\'s 1/255)', Math.abs((await p.evaluate(() => CHECK.doc.environment.studioColor?.r)) - 0.25) < 0.006,
        JSON.stringify(await p.evaluate(() => CHECK.doc.environment)))
    await p.evaluate(() => CHECK.panel.show('root'))
    ok('...and shows it again, not white, once the panel is redrawn', Math.abs(await red() - 0.25) < 0.006, String(await red()))
}
/* EVERY ROW OF THE SCENE'S PROPERTIES SAYS WHAT IT IS (the user, 2026-10-10: "make sure it has tooltips & explanations"):
   a label with no title, in sun & sky and in the studio, and with a value flagged animated */
{
    const untitled = () => p.evaluate(() => { CHECK.panel.show('root')
        return [...document.querySelectorAll('.tp-lblv_l, .tp-fldv_t')].filter(l => l.textContent.trim() && !l.title).map(l => l.textContent.trim()) })
    const inStudio = await untitled()
    ok('every row and folder of the scene\'s properties has a tooltip, in the studio', !inStudio.length, JSON.stringify(inStudio))
    await set('Source', 'sun')
    await p.evaluate(() => CHECK.M.setAnimated(CHECK.doc, 'scene/environment/sunIlluminance', true))
    const inSun = await untitled()
    ok('...in sun and sky, with a value animated', !inSun.length, JSON.stringify(inSun))
    await p.evaluate(() => CHECK.M.setAnimated(CHECK.doc, 'scene/environment/sunIlluminance', false))
    const { ENVIRONMENT_HELP } = await import('../panel.js').catch(() => ({}))
    const M = await import('../model.js')
    ok('...and every environment setting has its explanation', !!ENVIRONMENT_HELP && Object.keys(M.ENVIRONMENT).every(k => ENVIRONMENT_HELP[k]),
        Object.keys(M.ENVIRONMENT).filter(k => !ENVIRONMENT_HELP?.[k]).join(', '))
}

// AN ARRAY (model.js copies, version 17): a plain group's copies -- made a row, typed, taken away -- each an undo step
{
    await p.evaluate(() => { CHECK.M.addGroup(CHECK.doc, 'root', { id: 'row', label: 'row' }); CHECK.M.addObject(CHECK.doc, 'row', { primitive: 'sphere' }) })
    const rr = await rowsOf('row')
    ok('a plain group offers copies: a count, a pitch in its unit, an axis', rr.includes('count') && rr.some(l => /^pitch \(/.test(l ?? '')) && rr.includes('along'), JSON.stringify(rr))
    ok('...and a group whose children join does not', !(await rowsOf('g')).includes('count'))
    await rowsOf('row')
    const button = title => p.evaluate(title => {
        const bt = [...document.querySelectorAll('.tp-btnv_b')].find(x => x.textContent.trim().startsWith(title))
        if (!bt) return false
        bt.click(); return true
    }, title)
    const s0 = await state()
    ok('Make it an array: clicked', await button('Make it an array'))
    await p.waitForTimeout(50)
    const made = await p.evaluate(() => CHECK.M.find(CHECK.doc, 'row').node.copies?.map(t => t.pos.x))
    const s1 = await state()
    ok('...three copies in a row along x, a pitch apart; one undo step, and a compile (a new count)', JSON.stringify(made) === '[-1,0,1]'
        && s1.commits.length === s0.commits.length + 1 && s1.structure === s0.structure + 1, JSON.stringify({ made, s1 }))
    const typed = await p.evaluate(() => {
        const row = [...document.querySelectorAll('.tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim() === 'places')
        const ta = row?.querySelector('textarea')
        if (!ta) return false
        ta.value = '-2, 0, 0\n0, 1, 0, 0, 0, 45, 0.5\n2, 0, 0'; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.dispatchEvent(new Event('change', { bubbles: true }))
        return true
    })
    ok('the places typed', typed)
    ok('...Apply places', await button('Apply places'))
    await p.waitForTimeout(50)
    const after = await p.evaluate(() => CHECK.M.find(CHECK.doc, 'row').node.copies)
    const s2 = await state()
    ok('...each copy where it was typed, the second turned and halved; the same count: live, no compile', after?.[0].pos.x === -2 && after[1].rot.z === 45 && after[1].scale === 0.5
        && after[2].pos.x === 2 && s2.live.at(-1) === 'row.copies' && s2.structure === s1.structure, JSON.stringify({ after, s2 }))
    ok('No copies', await button('No copies'))
    await p.waitForTimeout(50)
    ok('...a plain group again, and a compile', await p.evaluate(() => CHECK.M.find(CHECK.doc, 'row').node.copies === undefined) && (await state()).structure === s2.structure + 1)
}

// COMPONENT PARAMETERS (model.js version 18): a node's values bound to its group's parameters, as text checked as typed
{
    await p.evaluate(() => {
        CHECK.M.addGroup(CHECK.doc, 'root', { id: 'lensg', label: 'lens', params: { diameter: 2 } })
        CHECK.M.addObject(CHECK.doc, 'lensg', { id: 'lb', primitive: 'cylinder', label: 'body' })
        CHECK.M.addGroup(CHECK.doc, 'root', { id: 'strip', label: 'strip', params: { count: 3, pitch: 0.5 } })
        CHECK.M.addObject(CHECK.doc, 'strip', { primitive: 'sphere' })
    })
    const bindings = (text, key) => p.evaluate(([text, key]) => {
        const row = [...document.querySelectorAll('.tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim() === 'bindings')
        const ta = row?.querySelector('textarea')
        if (!ta) return { error: 'no bindings editor' }
        if (text != null) { ta.value = text; ta.dispatchEvent(new Event('input', { bubbles: true })) }
        if (key) ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
        return { text: ta.value, said: document.querySelector('.builder-bind-said')?.textContent ?? '' }
    }, [text, key])
    let rr = await rowsOf('top')
    ok('nothing to bind to (no group above with parameters): no bindings editor', !rr.includes('bindings'), JSON.stringify(rr))
    rr = await rowsOf('lb')
    ok('an object in a group with parameters: the names it can read, and its bindings', rr.includes('names') && rr.includes('bindings'), JSON.stringify(rr))
    await bindings('radius = diamter / 2')
    await p.waitForTimeout(400)
    let bd = await bindings()
    ok('a name no group above has: said at its line and column', /line 1:10 {2}'diamter' is not a parameter of any group above/.test(bd.said), JSON.stringify(bd))
    const s0 = await state(), pushed0 = await p.evaluate(() => CHECK.T.pushed.length)
    await bindings('radius = diameter / 2\npos.z = diameter', 'apply')
    const lb = await p.evaluate(() => { const n = CHECK.M.find(CHECK.doc, 'lb').node; return { bind: n.bind, r: n.params.radius, z: n.transform.pos.z, pushed: CHECK.T.pushed.slice() } })
    const s1 = await state()
    ok('Ctrl+Enter binds it: the values written, pushed live, one undo step, no compile',
        lb.bind?.radius === 'diameter / 2' && lb.r === 1 && lb.z === 2 && lb.pushed.slice(pushed0).sort().join() === 'lb.radius,lb.transform'
        && s1.commits.length === s0.commits.length + 1 && s1.structure === s0.structure, JSON.stringify({ lb, s1 }))
    await p.waitForTimeout(50)
    const held = await p.evaluate(() => {
        const row = l => [...document.querySelectorAll('.tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim().startsWith(l))
        const rad = row('radius'), pos = row('position')
        return { radius: rad?.querySelector('.tp-lblv_l')?.textContent.trim(), radTip: rad?.querySelector('.tp-lblv_l')?.title,
                 radDisabled: !!rad?.querySelector('input:disabled'), posDisabled: !!pos?.querySelector('input:disabled'),
                 posTip: pos?.querySelector('.tp-lblv_l')?.title }
    })
    // the label carries the length's unit, and the row's icons after it: radius (cm) =
    ok('...the bound rows held, their expression on the label', /^radius( \(\w+\))? =/.test(held.radius ?? '') && /radius = diameter \/ 2/.test(held.radTip ?? '')
        && held.radDisabled && held.posDisabled && /pos\.z = diameter/.test(held.posTip ?? ''), JSON.stringify(held))
    rr = await rowsOf('strip')
    ok('a group with parameters of its own: it can bind its copies to them', rr.includes('bindings') && rr.includes('count'), JSON.stringify(rr))
    await bindings('copies.count = count\ncopies.pitch = pitch', 'apply')
    await p.waitForTimeout(50)
    const strip = await p.evaluate(() => CHECK.M.find(CHECK.doc, 'strip').node.copies?.map(t => t.pos.x))
    rr = await p.evaluate(() => [...document.querySelectorAll('.tp-lblv')].map(r => r.querySelector('.tp-lblv_l')?.textContent.trim()))
    ok('...an array of count copies, pitch apart; its copies said to be from parameters, nothing to type there',
        JSON.stringify(strip) === '[-0.5,0,0.5]' && rr.includes('bound') && !rr.includes('places'), JSON.stringify({ strip, rr }))
    /* A LAMP (0.69.0): a light's flux and colour from its group's parameters -- the colour whole, in one line -- and its
       rows held: the value's, and the choice it holds (brightness by, colour by) */
    await p.evaluate(() => {
        CHECK.M.addGroup(CHECK.doc, 'root', { id: 'lampg', label: 'lamp', params: { flux: 500, tint: { r: 1, g: 0.5, b: 0.25 } } })
        CHECK.M.addLight(CHECK.doc, 'lampg', { id: 'lled', shape: 'rectangle', label: 'led' })
    })
    rr = await rowsOf('lled')
    ok('a light in a group with parameters: its bindings', rr.includes('bindings') && rr.includes('brightness by'), JSON.stringify(rr))
    const p0 = await p.evaluate(() => CHECK.T.pushed.length)
    await bindings('light.flux = flux\nlight.colour = tint', 'apply')
    await p.waitForTimeout(50)
    const lamp = await p.evaluate(() => { const n = CHECK.M.find(CHECK.doc, 'lled').node; return { light: n.light, bind: n.bind, pushed: CHECK.T.pushed.slice() } })
    ok('...its flux and its colour from the lamp\'s: written, the light set by its flux, pushed live as the light',
        lamp.light.flux === 500 && lamp.light.colour?.g === 0.5 && lamp.bind?.['light.colour.b'] === 'tint.b' && lamp.pushed.slice(p0).includes('lled.light'), JSON.stringify(lamp))
    const lheld = await p.evaluate(() => {
        const row = l => [...document.querySelectorAll('.tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim().replace(/^\W+/, '').startsWith(l))
        const at = l => { const r = row(l); return r && { off: !!r.querySelector(':disabled') || !!r.closest('.tp-v-disabled'), tip: r.querySelector('.tp-lblv_l')?.title ?? '' } }
        return { by: at('brightness by'), flux: at('flux (lm)'), colourBy: at('colour by'), colour: at('colour'), dist: at('distribution'), emitN: at('emits into n'),
                 text: document.querySelector('.builder-bind-said')?.textContent ?? '', bindText: [...document.querySelectorAll('textarea')].map(t => t.value).find(v => v.includes('light.')) }
    })
    ok('...the flux row and its colour held, their bindings on the label; brightness by and colour by held with them; the rest free',
        lheld.flux?.off && /light.flux = flux/.test(lheld.flux.tip) && lheld.colour?.off && /light.colour.r = tint.r/.test(lheld.colour.tip)
        && lheld.by?.off && lheld.colourBy?.off && lheld.dist && !lheld.dist.off && lheld.emitN && !lheld.emitN.off, JSON.stringify(lheld))
    ok('...and the editor shows the colour as the three lines it is', /light.colour.r = tint.r\nlight.colour.g = tint.g\nlight.colour.b = tint.b/.test(lheld.bindText ?? ''), JSON.stringify(lheld.bindText))
}

/* A LIGHT BY ITS SPECTRUM (0.83.0; core/spd.js): colour by spectrum starts as a blackbody at the colour's own CCT; peaks
   typed are checked as typed -- a problem said at its line, nothing put in -- and what reads clean is a live write of the
   light (no compile) with its undo step; a preset puts one in; the readout says the efficacy. */
{
    await p.evaluate(() => { CHECK.M.addLight(CHECK.doc, 'root', { id: 'spl', shape: 'rectangle', label: 'spectral led' }) })
    const light = () => p.evaluate(() => structuredClone(CHECK.M.lightOf(CHECK.M.find(CHECK.doc, 'spl').node)))
    const said = () => p.evaluate(() => document.querySelector('.builder-spectrum-said')?.textContent ?? '')
    const typeText = text => p.evaluate(text => {
        const ta = [...document.querySelectorAll('textarea')].find(t => /\d+ \d+ \d+/.test(t.value) || t.dataset.spectrum)
        if (!ta) return 'no textarea'
        ta.dataset.spectrum = '1'
        ta.value = text; ta.dispatchEvent(new Event('input', { bubbles: true }))
        return 'typed'
    }, text)
    let rr = await rowsOf('spl')
    ok('a light: colour by offers spectrum', rr.includes('colour by'))
    ok('colour by spectrum chosen', await set('colour by', 'spectrum') === 'set')
    await p.waitForTimeout(80)
    let L = await light()
    rr = await p.evaluate(() => [...document.querySelectorAll('.tp-lblv')].map(r => r.querySelector('.tp-lblv_l')?.textContent.trim().replace(/^[◇◆]/, '')))
    ok('...a blackbody at the white it was (D65: about 6500 K), its rows: kind, start from, temperature', L.colourBy === 'spectrum'
        && L.spectrum.kind === 'planck' && L.spectrum.T > 6400 && L.spectrum.T < 6600 && ['spectrum', 'start from', 'temperature (K)'].every(l => rr.includes(l)),
        JSON.stringify([L.spectrum, rr]))
    const readout = await p.evaluate(() => [...document.querySelectorAll('input')].map(i => i.value).find(v => /lm\/W radiated/.test(v)) ?? '')
    ok('...the readout says its efficacy', /\d+ lm\/W radiated/.test(readout), readout)
    await p.waitForTimeout(50)
    const plotLine = () => p.evaluate(() => ({ line: document.querySelector('.builder-spectrum-line')?.textContent ?? '', plot: !!document.querySelector('canvas.builder-spectrum-plot')?.width }))
    let pl = await plotLine()
    // a blackbody at D65's 6506 K: above 5000 K its reference is the CIE's daylight, which it is not quite -- Ra 98
    ok('...its spectrum drawn, and its CRI: Ra 98 against daylight at 6506 K', pl.plot && /^Ra 98 · R9 96 · 650\d K · \d+ lm\/W$/.test(pl.line), JSON.stringify(pl))
    ok('peaks chosen', await set('spectrum', 'peaks') === 'set')
    await p.waitForTimeout(80)
    L = await light()
    ok('...a white LED to start from, its text in the box', L.spectrum.kind === 'peaks' && L.spectrum.peaks.length === 2
        && /in use|2 peaks/.test(await said()), JSON.stringify([L.spectrum, await said()]))
    const before = await state()
    ok('a peak typed wrong', await typeText('630 17 1\n580 wide 2') === 'typed')
    await p.waitForTimeout(450)
    ok('...said at its line and column, nothing put in', /line 2, column 5/.test(await said()) && (await light()).spectrum.peaks.length === 2
        && (await state()).live.length === before.live.length, await said())
    ok('a red LED typed', await typeText('630 17 1') === 'typed')
    await p.waitForTimeout(450)
    L = await light()
    const s2 = await state()
    ok('...put in, live: the light pushed, no compile, its undo step', JSON.stringify(L.spectrum.peaks) === '[{"nm":630,"fwhm":17,"weight":1}]'
        && s2.live.slice(before.live.length).includes('spl.light') && s2.structure === before.structure && s2.commits.at(-1) === 'spl.light'
        && /in use/.test(await said()), JSON.stringify([L.spectrum, s2.live.slice(before.live.length), s2.commits.slice(-2), await said()]))
    pl = await plotLine()
    ok('...redrawn as typed: a red LED has no CCT, so no CRI', /^no CRI/.test(pl.line), pl.line)
    ok('a preset chosen: royal blue', await set('start from', 'LED royal blue') === 'set')
    await p.waitForTimeout(80)
    ok('...the light\'s spectrum the preset\'s', JSON.stringify((await light()).spectrum.peaks) === '[{"nm":450,"fwhm":20,"weight":1}]')
    ok('one of the CIE\'s LED lamps', await set('start from', 'CIE LED-B3') === 'set')
    await p.waitForTimeout(100)
    pl = await plotLine()
    ok('...a measured table of 81 points, its CRI the CIE illuminant\'s: Ra 85, R9 24, 4103 K', (await light()).spectrum.points?.length === 81
        && /^Ra 85 · R9 24 · 410\d K/.test(pl.line), JSON.stringify(pl))
}

/* A RAY FILE'S COLOUR (0.83.0; lights.js RAYFILE_COLOUR_BY, optics/sources.js rayFileColour): a rectangle's four ways and two
   of its own first -- from the file (its default) and its header's wavelength, the nm said in the choice -- the line under
   them saying what each comes to for the file loaded: a flux-only file at 854 nm, as the user's infrared LED's says */
{
    await p.evaluate(async () => {
        const { RAYFILES } = await import('/optics/rayfiles.js')
        const { writeZemax } = await import('/lib/pathtracer/optics/zemax.js')
        const rays = [0, 1, 2].map(k => ({ pos: [k, 0, 0], dir: [0, 0, 1], flux: 1 }))
        await RAYFILES.load(new File([writeZemax(rays, { fluxType: 0, wavelength: 0.854 })], 'ir854.DAT'))
        CHECK.M.addLight(CHECK.doc, 'root', { id: 'rfc', shape: 'rayfile', label: 'ir led', file: 'ir854.DAT' })
    })
    const light = () => p.evaluate(() => structuredClone(CHECK.M.find(CHECK.doc, 'rfc').node.light))
    const line = () => p.evaluate(() => [...document.querySelectorAll('textarea[readonly], .tp-mllv textarea')].map(t => t.value).join(' | '))
    const options = () => p.evaluate(() => {
        const row = [...document.querySelectorAll('.tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim() === 'colour by')
        return row ? [...row.querySelector('select').options].map(o => o.textContent.trim()) : []
    })
    let rr = await rowsOf('rfc')
    const opts = await options()
    ok('a ray file: colour by, from the file first, its header\'s wavelength with its nm, then a rectangle\'s four',
        rr.includes('colour by') && opts[0] === 'from the file' && opts[1] === "its header's wavelength (854 nm)"
        && ['RGB', 'CCT + Duv', 'CIE xy', 'spectrum'].every(o => opts.includes(o)), JSON.stringify(opts))
    ok('...from the file by default, nothing stored, and said: this file gives no colour', !('colourBy' in await light()) && /gives no colour/.test(await line()), await line())
    ok('its header\'s wavelength chosen', await set('colour by', "its header's wavelength") === 'set')
    await p.waitForTimeout(80)
    rr = await rowsOf('rfc')
    ok('...stored, and said: 854 nm, outside what the eye sees, nothing in the picture', (await light()).colourBy === 'wavelength'
        && /854 nm: outside what the eye sees/.test(await line()), JSON.stringify([await light(), await line()]))
    ok('RGB chosen', await set('colour by', 'RGB') === 'set')
    await p.waitForTimeout(80)
    rr = await rowsOf('rfc')
    ok('...kept as RGB (a ray file\'s default is its file), its colour row shown', (await light()).colourBy === 'rgb' && rr.includes('colour'), JSON.stringify([await light(), rr]))
}

/* THE ASPHERIC LENS'S COEFFICIENTS (2026-10-04): numbers with no range, typed from a datasheet. Tweakpane showed such a
   number to its first value's decimals, two at least -- 0.00 for an a4 of 1.6e-5 and an a10 of 2e-13 -- and a step
   would have rounded them away. Typed, they are kept whole and shown as typed; its radii and conic keep their sliders. */
await p.evaluate(() => { CHECK.M.addObject(CHECK.doc, 'root', { primitive: 'aspheric lens', id: 'asph' }) })
rows = await rowsOf('asph')
ok('an aspheric lens: its faces\' radius, conic and four terms each, after its size', ['r1', 'k1', 'a4_1', 'a10_1', 'r2', 'k2', 'a4_2', 'a10_2']
    .every(k => rows.some(r => r?.replace(/[✎×]/g, '').startsWith(k))) && rows.some(r => /^diameter/.test(r ?? '')), JSON.stringify(rows))
const shown = name => p.evaluate(name => [...document.querySelectorAll('.tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim().replace(/[✎×]/g, '') === name)
    ?.querySelector('input.tp-txtv_i')?.value, name)
ok('...a coefficient at 0 reads 0', await shown('a4_1') === '0', await shown('a4_1'))
ok('a4 typed as a datasheet gives it', await setParam('a4_1', '1.6e-5') === 'set')
await p.waitForTimeout(50)
ok('...kept whole in the document, and shown as it is', await p.evaluate(() => CHECK.M.find(CHECK.doc, 'asph').node.params.a4_1) === 1.6e-5 && await shown('a4_1') === '1.6e-5',
    `${await p.evaluate(() => CHECK.M.find(CHECK.doc, 'asph').node.params.a4_1)} shown ${await shown('a4_1')}`)
await setParam('a10_1', '-2.25e-13'); await p.waitForTimeout(50)
ok('...a negative a10 of -2.25e-13 too, where a number with no range could not go below 0', await p.evaluate(() => CHECK.M.find(CHECK.doc, 'asph').node.params.a10_1) === -2.25e-13 && await shown('a10_1') === '-2.25e-13', await shown('a10_1'))
await setParam('a6_1', '250'); await p.waitForTimeout(50)
ok('...and one above 100: kept (a number with no range was held to 0..100 by the property table)', await p.evaluate(() => CHECK.M.find(CHECK.doc, 'asph').node.params.a6_1) === 250, await shown('a6_1'))
await setParam('k1', '-0.6265'); await p.waitForTimeout(50)
ok('...and a conic typed to four places kept on its slider (its step\'s rounding no more than a float\'s)', Math.abs(await p.evaluate(() => CHECK.M.find(CHECK.doc, 'asph').node.params.k1) + 0.6265) < 1e-12, String(await p.evaluate(() => CHECK.M.find(CHECK.doc, 'asph').node.params.k1)) + ' shown ' + await shown('k1'))

/* ANIMATED VALUES (model.js setAnimated): the second panel, given the parameter registry as the page gives it. A live
   row has a ◇ before its name, which flags it -- an undo step and a relabel, nothing compiled; the scene's row then
   lists it first, its control writing as the row's does; ◆ there unflags it. A row the registry has no live entry for
   (a choice, a compile-time value) has none. */
{
    const flagRows = id => p.evaluate(id => {
        CHECK.flagPanel.show(id)
        return [...document.querySelectorAll('#t2 .tp-lblv')].map(r => ({ label: r.querySelector('.tp-lblv_l')?.textContent.trim(),
            flag: r.querySelector('.builder-animate')?.textContent ?? null }))
    }, id)
    const clickFlag = start => p.evaluate(start => {
        const row = [...document.querySelectorAll('#t2 .tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim().replace(/^[◇◆]/, '').startsWith(start))
        const i = row?.querySelector('.builder-animate')
        if (!i) return `no flag on '${start}'`
        i.click(); return 'clicked'
    }, start)
    let fr = await flagRows('top')
    const radius = fr.find(r => r.label?.replace(/^[◇◆]/, '').startsWith('radius'))
    ok('a live parameter\'s row: ◇ before its name', radius?.flag === '◇', JSON.stringify(fr))
    ok('...a choice (its material) none', fr.filter(r => /^material/.test(r.label ?? '')).every(r => r.flag === null), JSON.stringify(fr))
    ok('...its position and rotation one each', fr.filter(r => /^[◇◆]?(position|rotation)/.test(r.label ?? '')).every(r => r.flag === '◇'), JSON.stringify(fr))
    const t0 = await state()
    ok('clicked', await clickFlag('radius') === 'clicked')
    let st = await p.evaluate(() => ({ animate: CHECK.M.find(CHECK.doc, 'top').node.animate, any: CHECK.P.anyAnimated(), shown: CHECK.P.shown().map(e => e.path) }))
    const t1 = await state()
    ok('...flags it: in the document, an undo step and a relabel, nothing compiled', JSON.stringify(st.animate) === '["radius"]'
        && t1.commits.at(-1) === null && t1.labels > t0.labels && t1.structure === t0.structure, JSON.stringify([st, t1.commits.slice(-2)]))
    ok('...the registry says so: the Parameters panel\'s list now that one alone', st.any && JSON.stringify(st.shown) === '["scene/top/radius"]', JSON.stringify(st))
    fr = await flagRows('top')
    ok('...drawn again, ◆', fr.find(r => r.label?.replace(/^[◇◆]/, '').startsWith('radius'))?.flag === '◆')
    // the scene's row: the animated folder first, its control writing the value live
    fr = await flagRows(await p.evaluate(() => CHECK.doc.root.id))
    const listed = fr.find(r => /top › radius/.test(r.label ?? ''))
    ok('the scene\'s row lists it, ◆ before it', listed?.flag === '◆' && fr.findIndex(r => r === listed) < fr.findIndex(r => /^unit/.test(r.label ?? '')),
       JSON.stringify(fr.map(r => r.label)))
    /* IN BOXES (0.64.0): the animated values' box first, above the scene's own -- its name, unit, radius, instant hide --
       then a box a category; every one the table's, and drawn again the same */
    const sceneBoxes = () => p.evaluate(() => [...document.querySelectorAll('#t2 .tp-rotv_c > .tp-fldv')].map(f => [
        f.querySelector(':scope > .tp-fldv_b .tp-fldv_t').textContent.trim(), f.classList.contains('pt-box'),
        [...f.querySelectorAll(':scope > .tp-fldv_c > .tp-lblv .tp-lblv_l')].map(l => l.textContent.trim().replace(/^[◇◆]/, ''))]))
    let SB = await sceneBoxes()
    ok('...in boxes: the animated values\' first, then the scene\'s own with its rows, then environment, optical features and functions',
       JSON.stringify(SB.map(b => b[0].replace(/\s+◆$/, ''))) === '["animated · 1","Scene","environment","optical features","functions"]' && SB.every(b => b[1])
       && ['label', 'unit', 'instant hide / show'].every(l => SB[1][2].includes(l)) && SB[1][2].some(l => l.startsWith('environment radius')), JSON.stringify(SB))
    await p.evaluate(() => CHECK.flagPanel.show(CHECK.doc.root.id))
    ok('...drawn again: the same boxes, none left over', JSON.stringify(await sceneBoxes()) === JSON.stringify(SB), JSON.stringify(await sceneBoxes()))
    await p.evaluate(() => CHECK.flagPanel.show('g'))
    SB = await sceneBoxes()
    ok('...a group: its own box first, its position in it, its recipe and its code each a box after', SB[0]?.[0] === 'Group'
       && SB[0][2].some(l => l.startsWith('position')) && SB.slice(1).some(b => b[0] === 'recipe') && SB.at(-1)?.[0].startsWith('group code'), JSON.stringify(SB))
    await p.evaluate(() => CHECK.flagPanel.show(CHECK.doc.root.id))
    const live0 = (await state()).live.length
    const typed = await p.evaluate(() => {
        const row = [...document.querySelectorAll('#t2 .tp-lblv')].find(r => /top › radius/.test(r.querySelector('.tp-lblv_l')?.textContent ?? ''))
        const txt = row?.querySelector('input.tp-txtv_i')
        if (!txt) return 'no field'
        txt.value = '0.37'; txt.dispatchEvent(new Event('change', { bubbles: true }))
        return 'set'
    })
    await p.waitForTimeout(50)
    const after = await state()
    ok('...a value typed there: the document, pushed live as the row\'s own would be', typed === 'set'
        && await p.evaluate(() => CHECK.M.find(CHECK.doc, 'top').node.params.radius) === 0.37 && after.live.slice(live0).includes('top.radius'),
       JSON.stringify([typed, after.live.slice(live0)]))
    ok('...◆ there unflags it', await clickFlag('top › radius') === 'clicked')
    await p.waitForTimeout(50)
    fr = await flagRows(await p.evaluate(() => CHECK.doc.root.id))
    ok('...and the list is gone', !fr.some(r => /top › radius/.test(r.label ?? '')) && !(await p.evaluate(() => CHECK.M.find(CHECK.doc, 'top').node.animate)),
       JSON.stringify(fr.map(r => r.label)))
    await p.evaluate(() => CHECK.flagPanel.show(null))
}

// A MATERIAL'S COATING (materials.js coating, 0.39.0): where it is, a preset, and its values only while it has one
{
    const P = () => p.evaluate(() => ({ ...CHECK.M.material(CHECK.doc, 'gl').params }))
    const shown = () => p.evaluate(() => [...document.querySelectorAll('#t .tp-lblv')].map(r => r.querySelector('.tp-lblv_l')?.textContent.trim()))
    const VALUES = ['R below edge', 'R above edge', 'edge (nm)', 'edge width (nm)', 'stack index']
    rows = await rowsOf('gl')
    ok('a material shows where its coating is and the presets, and no value of one it does not have',
        rows.includes('coating') && rows.includes('preset') && !VALUES.some(l => rows.includes(l)), JSON.stringify(rows))
    before = await state()
    ok('choosing the beam splitter preset', await set('preset', 'beam splitter') === 'set')
    await p.waitForTimeout(50)                 // the panel redraws after the change event
    s = await state()
    let v = await P()
    ok('...puts one on (entry faces, AR back) with its values: the coating pushed, one undo step',
        v.coating === 1 && v.coatLow === 0.5 && v.coatHigh === 0.5 && s.live.slice(before.live.length).join() === 'gl.coating'
        && s.commits.length === before.commits.length + 1 && s.commits.at(-1) === null, JSON.stringify([v, s.live.slice(before.live.length), s.commits.slice(before.commits.length)]))
    rows = await shown()
    ok('...and the panel shows its values now', VALUES.every(l => rows.includes(l)), JSON.stringify(rows))
    ok('an edge typed', await set('edge (nm)', 520) === 'set')
    s = await state()
    ok('...is a live write of that field, with its undo step', (await P()).coatEdge === 520 && s.live.at(-1) === 'gl.coatEdge' && s.commits.at(-1) === 'gl.coatEdge',
        JSON.stringify([s.live.at(-1), s.commits.at(-1)]))
    before = await state()
    ok('the dichroic preset over it', await set('preset', 'dichroic: reflects red') === 'set')
    await p.waitForTimeout(50)
    s = await state()
    v = await P()
    ok('...with one on already: its values pushed, the coating left where it was', v.coating === 1 && v.coatLow === 0 && v.coatHigh === 1 && v.coatEdge === 600
        && ['gl.coatLow', 'gl.coatHigh', 'gl.coatEdge', 'gl.coatWidth', 'gl.coatIndex'].every(k => s.live.slice(before.live.length).includes(k))
        && !s.live.slice(before.live.length).includes('gl.coating'), JSON.stringify([v, s.live.slice(before.live.length)]))
    ok('on every face', await set('coating', 'every face') === 'set')
    s = await state()
    ok('...the coating written live', (await P()).coating === 3 && s.live.at(-1) === 'gl.coating')
    ok('none', await set('coating', 'none') === 'set')
    await p.waitForTimeout(50)
    rows = await shown()
    ok('...taken off: written, and the panel without its values', (await P()).coating === 0 && !VALUES.some(l => rows.includes(l)), JSON.stringify(rows))
}

/* THE SCENE'S OPTICAL FEATURES (0.83.0; model.js setFeatures): a box on the scene's row, Basic and Full over a switch a
   feature. A feature off hides its fields on every material; each change is one undo step and a compile; what a feature
   off hides is said once, in the box. */
{
    const FIELDS = ['Abbe number (dispersion)', 'colour depth (mm)', 'coating']
    const root = await p.evaluate(() => CHECK.doc.root.id)
    const box = () => p.evaluate(() => {
        const f = [...document.querySelectorAll('#t .tp-fldv')].find(x => x.querySelector(':scope > .tp-fldv_b .tp-fldv_t')?.textContent.trim().startsWith('optical features'))
        if (!f) return null
        return { title: f.querySelector(':scope > .tp-fldv_b .tp-fldv_t').textContent.trim(),
                 lit: [...f.querySelectorAll('button[data-preset]')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.preset),
                 line: f.querySelector('.features-line')?.textContent ?? '', notes: [...f.querySelectorAll('textarea')].map(t => t.value) }
    })
    const press = id => p.evaluate(id => { const b = document.querySelector(`#t button[data-preset="${id}"]`); if (!b) return 'no button'; b.click(); return 'pressed' }, id)
    const features = () => p.evaluate(() => CHECK.M.featuresOf(CHECK.doc))
    await p.evaluate(() => { CHECK.M.material(CHECK.doc, 'gl').params.abbe = 36 })
    rows = await rowsOf('gl')
    ok('Full, the default: the glass shows its Abbe number, colour depth and coating', FIELDS.every(l => rows.includes(l)), JSON.stringify(rows))
    rows = await rowsOf(root)
    let b = await box()
    ok('the scene\'s row: a box, optical features, Full lit, a switch a feature', b?.title === 'optical features' && JSON.stringify(b.lit) === '["full"]'
        && ['dispersion', 'absorption inside', 'coatings', 'spectral optics trace'].every(l => rows.includes(l)) && /Full/.test(b.line), JSON.stringify([b, rows]))
    before = await state()
    ok('Basic pressed', await press('basic') === 'pressed')
    await p.waitForTimeout(50)
    s = await state()
    ok('...every feature off -- every one a preset sets: optics analysis is none of theirs -- one undo step and a compile', JSON.stringify(await features()) === '{"dispersion":false,"absorption":false,"coatings":false,"spectral":false,"analysis":false}'
        && s.commits.length === before.commits.length + 1 && s.commits.at(-1) === null && s.structure === before.structure + 1,
        JSON.stringify([await features(), s.commits.slice(before.commits.length), s.structure - before.structure]))
    b = await box()
    ok('...the box redrawn: titled basic, Basic lit, the hidden Abbe number said', b?.title === 'optical features · basic' && JSON.stringify(b.lit) === '["basic"]'
        && b.notes.some(n => /glass has an Abbe number/.test(n)), JSON.stringify(b))
    rows = await rowsOf('gl')
    ok('...and the glass without the three, its index still there', !FIELDS.some(l => rows.includes(l)) && rows.includes('ior'), JSON.stringify(rows))
    ok('...its value kept', await p.evaluate(() => CHECK.M.material(CHECK.doc, 'gl').params.abbe) === 36)
    await rowsOf(root)
    before = await state()
    ok('dispersion ticked on its own', await set('dispersion', true) === 'set')
    await p.waitForTimeout(50)
    s = await state()
    b = await box()
    ok('...dispersion on, Custom, nothing lit, one undo step', (await features()).dispersion === true && b?.title === 'optical features · custom'
        && b.lit.length === 0 && /Custom/.test(b.line) && s.commits.length === before.commits.length + 1, JSON.stringify([b, await features()]))
    rows = await rowsOf('gl')
    ok('...the Abbe number back on the glass, the colour depth and coating still not', rows.includes('Abbe number (dispersion)')
        && !rows.includes('colour depth (mm)') && !rows.includes('coating'), JSON.stringify(rows))
    await rowsOf(root)
    ok('Full pressed', await press('full') === 'pressed')
    await p.waitForTimeout(50)
    ok('...every feature on: no key in the document', !(await p.evaluate(() => 'features' in CHECK.doc)))
    rows = await rowsOf('gl')
    ok('...and the glass shows all three again', FIELDS.every(l => rows.includes(l)), JSON.stringify(rows))
    before = await state()
    await rowsOf(root)
    await press('full'); await p.waitForTimeout(50)
    ok('Full again: nothing written, no undo step', (await state()).commits.length === before.commits.length)
    /* EXPERT (0.83.0): Full and the spectral optics trace, the one feature off by default -- saved as on, the glass the same */
    ok('Expert pressed', await press('expert') === 'pressed')
    await p.waitForTimeout(50)
    b = await box()
    ok('...the spectral trace on, saved as that alone, Expert lit, one undo step and a compile', JSON.stringify(await p.evaluate(() => CHECK.doc.features)) === '{"spectral":true}'
        && b?.title === 'optical features · expert' && JSON.stringify(b.lit) === '["expert"]' && /Expert/.test(b.line)
        && (await state()).commits.length === before.commits.length + 1, JSON.stringify(b))
    await press('full'); await p.waitForTimeout(50)
    ok('...Full again: no key', !(await p.evaluate(() => 'features' in CHECK.doc)))
    await p.evaluate(() => { CHECK.M.material(CHECK.doc, 'gl').params.abbe = 0 })
}

// AN OBJECT'S OPTICS ROLE (0.83.0; builder/model.js OPTICS_ROLES): its own box, offered while the scene's optics analysis is
// on -- a feature of its own, which the presets leave alone -- the role set, one undo step and an apply, taken away again
{
    const off = await p.evaluate(() => { CHECK.M.setFeatures(CHECK.doc, { analysis: false }); return CHECK.M.featuresOf(CHECK.doc).analysis })
    rows = await rowsOf('b')
    ok('analysis off: an object has no role row', off === false && !rows.includes('role'), JSON.stringify(rows))
    rows = await rowsOf('root')
    ok('...and the scene\'s optical features has the optics analysis switch', rows.includes('optics analysis'), JSON.stringify(rows))
    await p.evaluate(() => CHECK.M.setFeatures(CHECK.doc, { analysis: true }))
    rows = await rowsOf('b')
    ok('analysis on: the role row', rows.includes('role'), JSON.stringify(rows))
    before = await state()
    ok('detector chosen', await set('role', 'detector') === 'set')
    await p.waitForTimeout(50)
    s = await state()
    const role = () => p.evaluate(() => CHECK.M.find(CHECK.doc, 'b').node.opticsRole ?? null)
    ok('...the object a detector, with its undo step and an apply', await role() === 'detector' && s.commits.length === before.commits.length + 1
        && s.structure === before.structure + 1, JSON.stringify([await role(), s.commits.slice(-2), s.structure, before.structure]))
    ok('...its box titled by it', await p.evaluate(() => [...document.querySelectorAll('.tp-fldv_t')].some(t => t.textContent.trim() === 'optics analysis · detector')))
    await set('role', 'none'); await p.waitForTimeout(50)
    ok('none takes it away', await role() === null)
    await p.evaluate(() => CHECK.M.setFeatures(CHECK.doc, { analysis: false }))
}

// A HAZE BOX (0.62.0; builder/hazebox.js): where it is, its size, and its dust -- live, the renderer's own uniforms
rows = await rowsOf('hz')
ok('a haze box shows its size and its dust (mean free path, albedo, g), no material and no join',
    ['size', 'mean free path (m)', 'albedo (colour)', 'g (forward scattering)'].every(l => rows.includes(l)) && !rows.includes('material') && !rows.includes('join'),
    JSON.stringify(rows))
before = await state()
ok('setting its mean free path', await set('mean free path (m)', 4) === 'set')
s = await state()
const hzNow = await p.evaluate(() => CHECK.M.hazeSettings(CHECK.M.find(CHECK.doc, 'hz').node))
ok('...reaches the document, live (its dust), with its undo step and no compile', hzNow.mfp === 4 && s.live.at(-1) === 'hz.haze'
    && s.commits.at(-1) === 'hz.haze' && s.structure === before.structure, JSON.stringify([hzNow, s.live.slice(-2), s.commits.slice(-2)]))
const visText = await p.evaluate(() => [...document.querySelectorAll('textarea')].map(t => t.value).find(v => v.startsWith('visibility')) ?? '')
ok('...and the visibility beside it follows: 3.912 x 4 m, 15.6 m', /^visibility 15\.6 m/.test(visText), visText)

/* THE SCENE'S VIEW (0.66.0, model.js VIEW): the third panel, given a view as the page gives it. Its scene row has a camera
   and an exposure folder, folded until opened and remembered so; their rows are the popovers' and write the renderer's
   camera and exposure (which the scene keeps: demo.js keepView); an open folder follows a move made elsewhere; a value
   the registry has gets ◇, and flagging it puts the view's path on the root; a scene not shown yet says so */
{
    const sel = '#t3'
    const showRoot = () => p.evaluate(() => { CHECK.viewPanel.show(CHECK.doc.root.id) })
    const folderOf = title => p.evaluate(([sel, title]) => {
        const f = [...document.querySelectorAll(`${sel} .tp-fldv`)].find(e => e.querySelector(':scope > .tp-fldv_b .tp-fldv_t')?.textContent.trim().replace(/\s*\u25C6$/, '') === title)
        return f ? { open: f.classList.contains('tp-fldv-expanded'), rows: [...f.querySelectorAll('.tp-lblv')].map(r => r.querySelector('.tp-lblv_l')?.textContent.trim()) } : null
    }, [sel, title])
    const toggle = title => p.evaluate(([sel, title]) => {
        const f = [...document.querySelectorAll(`${sel} .tp-fldv`)].find(e => e.querySelector(':scope > .tp-fldv_b .tp-fldv_t')?.textContent.trim().replace(/\s*\u25C6$/, '') === title)
        f?.querySelector(':scope > .tp-fldv_b')?.click(); return !!f
    }, [sel, title])
    const typeIn = (folder, label, value) => p.evaluate(([sel, folder, label, value]) => {
        const f = [...document.querySelectorAll(`${sel} .tp-fldv`)].find(e => e.querySelector(':scope > .tp-fldv_b .tp-fldv_t')?.textContent.trim().replace(/\s*\u25C6$/, '') === folder)
        const row = [...(f?.querySelectorAll('.tp-lblv') || [])].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim().replace(/^[\u25C7\u25C6]/, '') === label)
        const txt = row?.querySelector('input.tp-txtv_i'), sl = row?.querySelector('select')
        if (sl) { const i = [...sl.options].findIndex(o => o.textContent.trim().startsWith(value)); sl.selectedIndex = i; sl.dispatchEvent(new Event('change', { bubbles: true })); return 'set' }
        if (!txt) return `no field '${label}' in '${folder}'`
        txt.value = String(value); txt.dispatchEvent(new Event('change', { bubbles: true })); return 'set'
    }, [sel, folder, label, value])
    const shownValue = (folder, label) => p.evaluate(([sel, folder, label]) => {
        const f = [...document.querySelectorAll(`${sel} .tp-fldv`)].find(e => e.querySelector(':scope > .tp-fldv_b .tp-fldv_t')?.textContent.trim().replace(/\s*\u25C6$/, '') === folder)
        const row = [...(f?.querySelectorAll('.tp-lblv') || [])].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim().replace(/^[\u25C7\u25C6]/, '') === label)
        return [...(row?.querySelectorAll('input.tp-txtv_i') || [])].pop()?.value ?? null
    }, [sel, folder, label])
    await p.evaluate(() => { try { localStorage.removeItem('raytracer.properties.codeOpen') } catch { } })
    await showRoot()
    let cf = await folderOf('camera'), ef = await folderOf('exposure')
    ok('the scene row has a camera and an exposure folder, both folded', cf && ef && !cf.open && !ef.open, JSON.stringify([cf, ef]))
    ok('...the camera\'s the popover\'s fields', ['mode', 'camtype', 'azimuth', 'elevation', 'distance', 'target', 'position'].every(k => cf.rows.some(r => r.replace(/^[\u25C7\u25C6]/, '') === k)),
        JSON.stringify(cf.rows))
    ok('...the exposure\'s every setting', ['EV100 (manual)', 'Auto exposure', 'Compensation (EV)', 'Tone curve'].every(k => ef.rows.some(r => r.replace(/^[\u25C7\u25C6]/, '') === k)),
        JSON.stringify(ef.rows))
    await toggle('camera'); await p.waitForTimeout(50)
    await showRoot()
    ok('opened, it stays open when the row is drawn again (remembered)', (await folderOf('camera'))?.open === true && (await folderOf('exposure'))?.open === false)
    const commits0 = (await state()).commits.length
    ok('typing a distance', await typeIn('camera', 'distance', 7.25) === 'set')
    // within 1e-9: the camera keeps its pose, and the distance read back from it is 7.249999999999998 as often as 7.25
    ok('...moves the camera, and is no undo step', Math.abs(await p.evaluate(() => CHECK.cam.get().distance) - 7.25) < 1e-9 && (await state()).commits.length === commits0,
        JSON.stringify([await p.evaluate(() => CHECK.cam.get().distance), (await state()).commits.slice(commits0)]))
    ok('the exposure\'s EV typed', await typeIn('exposure', 'EV100 (manual)', 9) === 'set')
    ok('...is the exposure\'s', await p.evaluate(() => CHECK.exposure.values.exposureEV) === 9 && (await state()).commits.length === commits0)
    await p.evaluate(() => CHECK.cam.set({ distance: 12.5 })); await p.waitForTimeout(80)
    ok('a move made elsewhere (a drag, the popover): the open folder follows it', Number(await shownValue('camera', 'distance')) === 12.5, await shownValue('camera', 'distance'))
    // ◇: the view's values the registry has; a word (mode) and a point (target) none
    const flags = await p.evaluate(sel => [...document.querySelectorAll(`${sel} .tp-fldv`)].filter(f => /^camera/.test(f.querySelector(':scope > .tp-fldv_b .tp-fldv_t')?.textContent.trim() ?? ''))
        .flatMap(f => [...f.querySelectorAll('.tp-lblv')]).map(r => [r.querySelector('.tp-lblv_l')?.textContent.trim().replace(/^[\u25C7\u25C6]/, ''), r.querySelector('.builder-animate')?.textContent ?? null]), sel)
    const flagOf = k => flags.find(([l]) => l === k)?.[1]
    ok('a camera number has ◇, its mode and target none', flagOf('distance') === '\u25C7' && flagOf('fov') === '\u25C7' && flagOf('mode') === null && flagOf('target') === null, JSON.stringify(flags))
    const flagged = await p.evaluate(sel => {
        const f = [...document.querySelectorAll(`${sel} .tp-fldv`)].find(e => /^camera/.test(e.querySelector(':scope > .tp-fldv_b .tp-fldv_t')?.textContent.trim() ?? ''))
        const row = [...f.querySelectorAll('.tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim().replace(/^[\u25C7\u25C6]/, '') === 'fov')
        row.querySelector('.builder-animate').click()
        return { animate: CHECK.doc.root.animate, shown: CHECK.P3.shown().map(e => e.path) }
    }, sel)
    ok('flagging the field of view: on the scene\'s root at the renderer\'s path, an undo step', JSON.stringify(flagged.animate) === '["view/camera/fov"]'
        && (await state()).commits.length === commits0 + 1, JSON.stringify(flagged))
    ok('...and the registry offers it as animated', flagged.shown.includes('view/camera/fov'), JSON.stringify(flagged.shown))
    await p.evaluate(() => CHECK.M.setAnimated(CHECK.doc, 'view/camera/fov', false))
    // a scene not shown yet: its camera is not the renderer's
    await p.evaluate(() => { CHECK.T.showing = false })
    await showRoot()
    cf = await folderOf('camera')
    ok('a scene still compiling: the folder says so, and binds nothing', cf && cf.rows.length === 1 && !cf.rows.includes('distance'), JSON.stringify(cf))
    await p.evaluate(() => { CHECK.T.showing = true; CHECK.viewPanel.show(null) })
}

/* ...AND A WAY THAT KEEPS THE REAL SIZE, through the question (0.72.0): the scene's numbers converted by the model's
   own (unitchange.js), one undo step and a compile */
{
    await rowsOf('root')
    const before = await p.evaluate(() => ({ unit: CHECK.doc.unit, r: CHECK.M.find(CHECK.doc, 'top').node.params.radius, env: CHECK.doc.envRadius,
                                              pos: CHECK.M.find(CHECK.doc, 'top').node.transform.pos.x }))
    const to = before.unit === 'mm' ? 'm' : 'mm', k = before.unit === 'cm' ? 10 : before.unit === 'm' ? 1000 : 0.001
    const s0 = await state()
    ok(`the unit chosen: ${to}`, await set('unit', to) === 'set')
    await answer('dimensions')
    await p.waitForTimeout(50)
    const after = await p.evaluate(() => ({ unit: CHECK.doc.unit, r: CHECK.M.find(CHECK.doc, 'top').node.params.radius, env: CHECK.doc.envRadius,
                                             pos: CHECK.M.find(CHECK.doc, 'top').node.transform.pos.x }))
    const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))
    ok('convert the dimensions: a sphere\'s radius and the scene\'s radius times the factor, one undo step, a compile',
        after.unit === to && near(after.r, before.r * k) && near(after.env, before.env * k) && (await state()).commits.length === s0.commits.length + 1
        && (await state()).structure === s0.structure + 1, JSON.stringify([before, after]))
    ok('...the row says the new unit', await unitRow() === to && (await readRows()).some(r => r === `environment radius (${to})`), JSON.stringify(await readRows()))
}

// A CODE BOX'S "Functions you can call…" (0.79.0): the host's help hook asked for the code reference, at a material's helpers
// for a material's code, at its top for an object's -- each anchor a heading the page has. A panel given no hook has none.
{
    const { renderMarkdown } = await import(pathToFileURL(join(repo, 'help/markdown.js')).href)
    const headings = renderMarkdown(await readFile(join(repo, 'help/reference/code.md'), 'utf8')).headings.map(h => h.id)
    const click = (id, sel) => p.evaluate(([id, sel]) => {
        CHECK.panel.show(id); CHECK.flagPanel.show(id)
        const bs = [...document.querySelectorAll(`${sel} button`)].filter(b => b.textContent.includes('Functions you can call'))
        bs[0]?.click()
        return { count: bs.length, asked: CHECK.T.help.slice() }
    }, [id, sel])
    const obj = await click('top', '#t')
    ok('an object\'s code box: the button asks the host for the code reference, at its top', obj.count === 1
        && JSON.stringify(obj.asked.at(-1)) === '["ref-code",null]', JSON.stringify(obj))
    const mat = await click('gl', '#t')
    ok('...a material\'s, at its helpers', mat.count === 1 && JSON.stringify(mat.asked.at(-1)) === '["ref-code","materials"]', JSON.stringify(mat))
    const src = await readFile(join(repo, 'builder/panel.js'), 'utf8')
    const at = Object.values(JSON.parse(/CODE_HELP_AT = (\{[^}]*\})/.exec(src)[1].replace(/(\w+):/g, '"$1":').replace(/'/g, '"')))
    ok('...every anchor it opens at is a heading of help/reference/code.md', at.length && at.every(a => headings.includes(a)), JSON.stringify(at))
    ok('...a panel given no hook shows none', (await click('top', '#t2')).count === 0)
    await p.evaluate(() => { CHECK.panel.show(null); CHECK.flagPanel.show(null) })
}

// A MATERIAL'S PICTURES (0.next; builder/images.js): + picture… reads a PNG through the browser's own decoder into the scene
// and the material, a compile with an undo step; each setting of its placement live; its use a compile; a file that is no
// picture said in the box; taken away again
{
    const { deflateSync } = await import('node:zlib')
    // a 3 x 2 PNG, written here from its specification (8-bit RGBA, no interlace)
    const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
    const crc = b => { let c = 0xFFFFFFFF; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0 }
    const chunk = (t, d) => { const o = Buffer.alloc(12 + d.length); o.writeUInt32BE(d.length, 0); o.write(t, 4, 'ascii'); d.copy(o, 8); o.writeUInt32BE(crc(o.subarray(4, 8 + d.length)), 8 + d.length); return o }
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(3, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 6
    const raw = Buffer.from([0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 255])   // a filter byte a row, then its pixels
    const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
    const button = (title, id = 'scr') => p.evaluate(([title, id]) => {
        const b = [...document.querySelectorAll('#t button')].find(x => x.textContent.trim().startsWith(title))
        if (!b) return `no button '${title}'`
        b.click(); return 'clicked'
    }, [title, id])
    const pick = async (title, file) => {
        const [chooser] = await Promise.all([p.waitForEvent('filechooser', { timeout: 5000 }), button(title)])
        await chooser.setFiles(file)
        await p.waitForTimeout(300)
    }
    rows = await rowsOf('scr')
    const has = await p.evaluate(() => [...document.querySelectorAll('#t button')].some(x => x.textContent.includes('+ image texture')))
    ok('a material has + image texture… under its image textures', has)
    before = await state()
    await pick('+ image texture', { name: 'logo.png', mimeType: 'image/png', buffer: png })
    const got = await p.evaluate(() => {
        const m = CHECK.M.material(CHECK.doc, 'scr')
        const k = m.images?.[0]?.image
        // (the scene's problems that are not the screen's: a step above left one of its own, which is not this check's)
        return { slot: m.images?.[0], entry: k && CHECK.doc.images?.[k] && { ...CHECK.doc.images[k], data: CHECK.doc.images[k].data.length }, base: m.params.baseColor, rough: m.params.roughness,
                 valid: CHECK.M.validate(CHECK.doc) }
    })
    s = await state()
    ok('...a PNG chosen: in the scene by its key, its size the decoder\'s, a slot that is the glow -- a compile and an undo step',
        got.entry?.width === 3 && got.entry?.height === 2 && got.entry?.type === 'image/png' && got.slot?.use === 'colour' && got.slot?.name === 'texture'
        && s.structure === before.structure + 1 && s.commits.at(-1) === null && got.valid.every(x => !/scr|image|picture/.test(x)), JSON.stringify([got, s.structure, before.structure]))
    ok('...the screen\'s surface under the glow its dark glass', got.base?.r === 0.02 && got.rough === 0.05, JSON.stringify(got))
    await p.waitForTimeout(50)
    rows = await p.evaluate(() => [...document.querySelectorAll('#t .tp-lblv')].map(r => r.querySelector('.tp-lblv_l')?.textContent.trim()))
    ok('...its rows: use, projection, size, offset, turn, wraps, filter, faces, colour; and the surface below the glow',
        ['use', 'projection', 'width (mm)', 'height (mm)', 'offset x (mm)', 'offset y (mm)', 'turn (deg)', 'wrap across', 'wrap up', 'filter', 'faces', 'colour (sRGB)', 'baseColor', 'roughness']
            .every(r => rows.includes(r)), JSON.stringify(rows))
    before = await state()
    ok('the width typed', await set('width (mm)', 55) === 'set')
    s = await state()
    ok('...is the slot\'s uniform, live, with its undo step: no compile', s.live.at(-1) === 'scr.img_texture' && s.commits.at(-1) === 'scr.img_texture'
        && s.structure === before.structure && await p.evaluate(() => CHECK.M.material(CHECK.doc, 'scr').images[0].size.x) === 55, JSON.stringify(s))
    // HEIGHT FROM THE IMAGE'S ASPECT RATIO: the height the width times the image's own height over its width (3 x 2: 2/3),
    // the width kept; live, no compile
    before = await state()
    ok('Height from the image\'s aspect ratio', await button('Height from the image\'s aspect ratio') === 'clicked')
    await p.waitForTimeout(50)
    const sz = await p.evaluate(() => ({ ...CHECK.M.material(CHECK.doc, 'scr').images[0].size }))
    s = await state()
    ok('...the height 55 x 2 / 3, the width kept, live', Math.abs(sz.y - 55 * 2 / 3) < 1e-4 && sz.x === 55 && s.structure === before.structure
        && s.live.at(-1) === 'scr.img_texture', JSON.stringify(sz))
    ok('wrap across: mirror', await set('wrap across', 'mirror') === 'set')
    s = await state()
    ok('...live too', s.live.at(-1) === 'scr.img_texture' && s.structure === before.structure
        && await p.evaluate(() => CHECK.M.material(CHECK.doc, 'scr').images[0].wrapU) === 'mirror')
    ok('the projection: triplanar', await set('projection', 'triplanar') === 'set')
    await p.waitForTimeout(50)
    rows = await p.evaluate(() => [...document.querySelectorAll('#t .tp-lblv')].map(r => r.querySelector('.tp-lblv_l')?.textContent.trim()))
    ok('...live, and the box shows its blend\'s sharpness and no faces', (await state()).structure === before.structure && rows.includes('blend sharpness') && !rows.includes('faces'), JSON.stringify(rows))
    ok('its use: code only', await set('use', 'code only') === 'set')
    s = await state()
    ok('...a compile', s.structure === before.structure + 1 && await p.evaluate(() => CHECK.M.material(CHECK.doc, 'scr').images[0].use) === 'none')
    // a file that is no picture: said in the box, nothing added
    await p.waitForTimeout(50)
    await pick('+ image texture', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
    await p.waitForTimeout(50)
    const said = await p.evaluate(() => [...document.querySelectorAll('#t .tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim() === 'not read')?.querySelector('textarea')?.value ?? null)
    ok('a text file chosen: said in the box, nothing added', /not a PNG, JPEG or WebP/.test(said ?? '') && await p.evaluate(() => CHECK.M.material(CHECK.doc, 'scr').images.length) === 1, said)
    // A RELIEF FROM IT (0.next): offered in the relief box by the picture's name, its heights' bound worked out on import
    // from the pixels Chromium decoded, a compile; the box says what such a relief is and is not
    ok('the picture\'s heights\' bound was worked out as it was read', await p.evaluate(() => { const e = Object.values(CHECK.doc.images)[0]; return e.heights?.colour?.length === 6 && e.heights.data[0] > 0 }))
    before = await state()
    ok('the relief: from an image texture', await set('relief', 'from an image texture: texture') === 'set')
    await p.waitForTimeout(150)
    s = await state()
    ok('...a relief reading it, amplitude and raise, a compile', await p.evaluate(() => CHECK.M.pictureReliefOf(CHECK.M.material(CHECK.doc, 'scr').relief)) === 'texture'
        && s.structure === before.structure + 1)
    const notes = await p.evaluate(() => [...document.querySelectorAll('#t textarea')].map(t => t.value).find(v => /on every face/.test(v)) ?? null)
    ok('...and its box says it is read planar (the picture is triplanar), on every face, at 8 bits', /read planar.*triplanar/.test(notes ?? '') && /8 bits a pixel/.test(notes ?? ''), notes)
    before = await state()
    ok('Take it away', await button('Take it away') === 'clicked')
    s = await state()
    ok('...the slot gone, the picture kept in the scene (no undo step holds it), a compile', s.structure === before.structure + 1
        && await p.evaluate(() => !CHECK.M.material(CHECK.doc, 'scr').images && Object.keys(CHECK.doc.images).length === 1))
    ok('...and the relief that read it with it', await p.evaluate(() => !CHECK.M.material(CHECK.doc, 'scr').relief))
    await p.evaluate(() => CHECK.panel.show(null))
}

ok('no page errors', !errs.length, errs.join('\n'))
await b.close(); server.close()
console.log(failed ? `${failed} FAILED` : 'builder panel: all passed')
process.exit(failed ? 1 : 0)
