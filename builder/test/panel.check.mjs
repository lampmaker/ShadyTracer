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
ok('the unit changed to cm', await set('unit', 'cm') === 'set')
await p.waitForTimeout(50)
ok('...and the radius row says so by itself (the panel redrawn), the number kept: the scene reinterpreted, as its shapes',
    (await readRows()).includes('environment radius (cm)') && await p.evaluate(() => CHECK.doc.envRadius) === 2.5, JSON.stringify(await readRows()))
ok('the Environment folder has no radius any more', !(await rowsOf('#environment')).some(l => /radius/i.test(l ?? '')), JSON.stringify(await rowsOf('#environment')))

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

ok('no page errors', !errs.length, errs.join('\n'))
await b.close(); server.close()
console.log(failed ? `${failed} FAILED` : 'builder panel: all passed')
process.exit(failed ? 1 : 0)
