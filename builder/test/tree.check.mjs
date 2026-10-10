// node builder/test/tree.check.mjs
//
// THE TREE'S JOIN MARKS (model version 14), clicked, headless, in the real tree over the real model and project
// with a stand-in builder (test/drop.html, the same harness as drop.check): a plain group's second child clicked
// from ∪ to − makes the group a subtraction -- the document says so, one undo step, one compile, and the rows
// then show the marks and letters; a further click goes on to ∩ and back to ∪; a click on the base is refused
// and changes nothing; the top level and a light have no mark at all. And THE LOCK beside the eye: a click locks both
// of a node's, a click on any lock opens both, an undo step and no compile. Nothing else clicks these: the page needs
// WebGPU, which this container does not have. What the picture shows after is the user's to judge.
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
if (!chromium) { console.log('(tree check SKIPPED: no playwright. npm i -g playwright to get it.)'); process.exit(0) }

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
await p.goto(`http://localhost:${server.address().port}/builder/test/drop.html`)
await p.waitForFunction(() => window.CHECK && document.querySelectorAll('[data-path]').length > 0, null, { timeout: 5000 })

/* every row as it is drawn: its label, and the join mark in its toggle column (null when it has none) */
const rows = () => p.evaluate(() => [...document.querySelectorAll('.treeview-node[data-path]')].map(r => ({
    label: r.querySelector('.treeview-label')?.textContent.trim(),
    mark: r.querySelector('[data-property="join"]')?.textContent.trim() ?? null })))
const row = async start => (await rows()).find(r => r.label?.startsWith(start))
/* a click on the join mark of the row whose label starts with `start`, as a person would */
const click = start => p.evaluate(start => {
    const r = [...document.querySelectorAll('.treeview-node[data-path]')].find(e => e.querySelector('.treeview-label')?.textContent.trim().startsWith(start))
    const t = r?.querySelector('[data-property="join"]')
    if (!t) return false
    t.click(); return true
}, start)
const state = () => p.evaluate(() => {
    const { M, BUILDER, T } = CHECK, d = BUILDER.doc
    return { g1: M.find(d, 'g1').node.join ?? 'union', g2: M.find(d, 'g2').node.join ?? 'union', commits: T.commits, applied: T.applied, status: T.status.at(-1) }
})

// BEFORE: a plain group -- names as they were, the marks there to click
ok('a plain group\'s first shape shows the base, the second its union', (await row('box'))?.mark === '●' && (await row('sphere'))?.mark === '∪',
    JSON.stringify(await rows()))
ok('a light in it has no mark (it is no shape of the group)', (await row('rectangle light'))?.mark === null)
ok('the top level has none (always a plain union)', (await row('ball'))?.mark === null && (await row('bee'))?.mark === null)

// ∪ -> −: the group becomes a subtraction
let before = await state()
ok('clicking the second child\'s ∪', await click('sphere'))
let s = await state()
ok('...makes it subtract, as one undo step and one compile', s.g2 === 'subtract' && s.commits === before.commits + 1 && s.applied === before.applied + 1, JSON.stringify(s))
ok('...and the rows read the subtraction: ● a, − b, the group a − b', (await row('● a'))?.label.startsWith('● a  box') && (await row('− b'))?.mark === '−'
    && (await row('group'))?.label.endsWith('· a − b'), JSON.stringify(await rows()))

// − -> ∩ -> ∪
await click('− b'); s = await state()
ok('again: intersect', s.g2 === 'intersect' && (await row('∩ b'))?.mark === '∩', JSON.stringify(s))
await click('∩ b'); s = await state()
ok('and again: union, and a plain group once more -- no marks in the names', s.g2 === 'union' && (await row('sphere'))?.mark === '∪' && (await row('group'))?.label === 'group',
    JSON.stringify(await rows()))

// THE BASE: refused
before = await state()
ok('clicking the base', await click('box'))
s = await state()
ok('...is refused: nothing changed, nothing committed or compiled, and it says why', s.g1 === 'union' && s.commits === before.commits && s.applied === before.applied
    && /the base/.test(s.status ?? ''), JSON.stringify(s))
ok('...and its mark is the base\'s again', (await row('box'))?.mark === '●')

// THE LOCK (model.js setLock): a click on an open one locks both of a node's, a click on any lock opens both;
// one undo step and no compile, a lock being nothing the shader reads
const lockOf = id => p.evaluate(id => CHECK.M.lockOf(CHECK.M.find(CHECK.BUILDER.doc, id).node), id)
const clickLock = start => p.evaluate(start => {
    const r = [...document.querySelectorAll('.treeview-node[data-path]')].find(e => e.querySelector('.treeview-label')?.textContent.trim().startsWith(start))
    const t = r?.querySelector('[data-property="lock"]')
    if (!t) return null
    t.click()
    return t.title
}, start)
const lockTitle = start => p.evaluate(start => [...document.querySelectorAll('.treeview-node[data-path]')]
    .find(e => e.querySelector('.treeview-label')?.textContent.trim().startsWith(start))?.querySelector('[data-property="lock"]')?.title ?? null, start)
ok('every node row has a lock, open; the Materials heading has none', /: unlocked$/.test(await lockTitle('bee') ?? '') && /: unlocked$/.test(await lockTitle('group') ?? '')
    && await lockTitle('Materials') === null, JSON.stringify([await lockTitle('bee'), await lockTitle('group'), await lockTitle('Materials')]))
before = await state()
ok('clicking the open lock of "bee"', await clickLock('bee') !== null)
s = await state()
ok('...locks its position and its parameters: one undo step, nothing compiled', JSON.stringify(await lockOf('b')) === JSON.stringify({ position: true, params: true })
    && s.commits === before.commits + 1 && s.applied === before.applied, JSON.stringify([await lockOf('b'), s]))
ok('...and the row shows it locked', /: locked$/.test(await lockTitle('bee') ?? ''), await lockTitle('bee'))
await clickLock('bee')
ok('clicked again: both open', JSON.stringify(await lockOf('b')) === JSON.stringify({ position: false, params: false }))
await p.evaluate(() => { CHECK.M.setLock(CHECK.BUILDER.doc, 'a', 'position', true); CHECK.tree.rebuild() })
ok('one lock alone shows as that one', /: position locked$/.test(await lockTitle('ball') ?? ''), await lockTitle('ball'))
await clickLock('ball')
ok('...and a click opens it', JSON.stringify(await lockOf('a')) === JSON.stringify({ position: false, params: false }))

// A DOUBLE-CLICK ON A NODE'S ROW (tree.js onFocus; the page brings the camera to it, focus.js): once, for that node,
// already selected by its two clicks; a group's stays as open as it was; nothing for what has nothing to see, nor
// on a row's marks, where a double-click is two toggles. A real double-click: two presses and releases, as a mouse.
const labelOf = start => p.evaluate(start => {
    const r = [...document.querySelectorAll('.treeview-node[data-path]')].find(e => e.querySelector('.treeview-label')?.textContent.trim().startsWith(start))
    const l = r?.querySelector('.treeview-label')
    if (!l) return null
    const b = l.getBoundingClientRect()
    return { x: b.left + Math.min(20, b.width / 2), y: b.top + b.height / 2 }
}, start)
const dbl = async start => { const at = await labelOf(start); if (!at) return false; await p.mouse.dblclick(at.x, at.y); await p.waitForTimeout(50); return true }
const focus = () => p.evaluate(() => ({ focus: [...CHECK.T.focus], selected: CHECK.T.selected }))
const nRows = async () => (await rows()).length
await p.evaluate(() => { CHECK.T.focus.length = 0 })
ok('double-clicking "bee"', await dbl('bee'))
let F = await focus()
ok('...focuses it, once, and it is the one selected', JSON.stringify(F) === JSON.stringify({ focus: ['b'], selected: 'b' }), JSON.stringify(F))
const open = await nRows()
await p.evaluate(() => { CHECK.T.focus.length = 0 })
ok('double-clicking the group', await dbl('group'))
F = await focus()
ok('...focuses the group', JSON.stringify(F.focus) === JSON.stringify(['g']), JSON.stringify(F))
ok('...and leaves it as open as it was (its two clicks close and open it)', await nRows() === open, `${open} -> ${await nRows()}`)
await p.evaluate(() => { CHECK.T.focus.length = 0 })
for (const r of ['Materials', 'red']) await dbl(r)
F = await focus()
ok('the Materials heading and a material: nothing to see, no focus', F.focus.length === 0, JSON.stringify(F))
const lockAt = await p.evaluate(() => {
    const r = [...document.querySelectorAll('.treeview-node[data-path]')].find(e => e.querySelector('.treeview-label')?.textContent.trim().startsWith('bee'))
    const b = r?.querySelector('[data-property="lock"]')?.getBoundingClientRect()
    return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null
})
if (lockAt) { await p.mouse.dblclick(lockAt.x, lockAt.y); await p.waitForTimeout(50) }
F = await focus()
ok('a double-click on a row\'s lock is two toggles, not a focus', !!lockAt && F.focus.length === 0
    && JSON.stringify(await lockOf('b')) === JSON.stringify({ position: false, params: false }), JSON.stringify([F, await lockOf('b')]))

ok('no page errors', !errs.length, errs.join('\n'))
await b.close(); server.close()
console.log(failed ? `${failed} FAILED` : 'tree joins, locks and double-clicks: all passed')
process.exit(failed ? 1 : 0)
