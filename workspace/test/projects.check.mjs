// node workspace/test/projects.check.mjs
//
// THE PROJECTS KEPT IN THE BROWSER, THE SCENES' CARDS, THE PROJECT PANEL AND THE FILE MENU, headless (UI_PLAN.md
// sections 10 and 11), over a page wired as the application's is (projects.html: the real store in IndexedDB, Web Locks,
// autosave, session, builder, tree, the line and cards over it, the Project panel, Import's question, File's commands,
// library and item editor; only the renderer and the files stood in):
//   - a first visit: one project, of the demo scene; the line over the tree names the project and counts its scenes, one
//     card, the open one; the tree's root row the scene
//   - File, five rows run as the menu bar runs them (the bar itself: lib/shell/test/example.check.mjs): the exports, Import
//     from file… -- a scene file joins, a project file asks, its scenes added or a project of its own
//   - the cards (0.63.0): ＋ a new scene, compiled; a click only selects (nothing compiled), ▶ and a double-click open; ⋯
//     duplicates another beside it and stays, deletes, and an undo of either stays on the scene worked on; dragged, they
//     reorder; a tree row dropped on one is copied there (Shift: moved); folded, the line names the open scene; the ▶ of
//     a scene not compiled
//   - the tree: the scene's row its root, its + the widget's, a click on it its settings without folding the tree;
//     a click on a group selecting it and folding nothing, its chevron folding it and selecting nothing;
//     no row of another scene; a right-click copies or moves to another scene, compiling only this one
//   - the clipboard: a copy goes on the system clipboard as JSON and pastes in another scene
//   - a reload: the same scenes, the scene worked on, the camera; a library item being edited, reopened, the cards waiting
//   - a second tab: its own copy, made on its first edit and not over the first tab's
//   - the Project panel: which project is here and which elsewhere, rename, duplicate, download, open, delete asking, new,
//     import; this project's scenes opened from it, an example added
// What any of it looks like on the user's screen is the user's to judge.
//
// OPTIONAL, AND LOUD ABOUT IT, as lib/shell/test/example.check.mjs is: it needs Playwright's Chromium.
/* global CHECK, DataTransfer, ClipboardEvent, indexedDB -- the page's, in the evaluated functions */
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
if (!chromium) { console.log('(projects check SKIPPED: no playwright. npm i -g playwright to get it.)'); process.exit(0) }

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
const url = `http://localhost:${server.address().port}/workspace/test/projects.html`
const b = await chromium.launch({ args: ['--disable-gpu'] })
const ctx = await b.newContext()           // a fresh profile: a first visit
const errs = []
/* ONE ERROR IS TREEVIEW'S OWN, not this page's: its row calls _handleDragEnter, which it never defines
   (lib/guistuff/treeview/treeview.js:196), on every dragenter -- harmless, the drag goes on. A submodule, changed in its own
   repository (CLAUDE.md); until then a tree row dragged onto a card (below) says it, and it is let through here, by name. */
const KNOWN = /_handleDragEnter is not a function/
const watch = p => { p.on('pageerror', e => { if (!KNOWN.test(e.message)) errs.push('pageerror: ' + e.message) }); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) }) }
let failed = 0
const ok = (n, c, x = '') => { if (!c) failed++; console.log((c ? 'ok    ' : 'FAIL  ') + n + (c ? '' : '  ' + x)) }
const ready = p => p.waitForFunction(() => window.CHECK && document.querySelectorAll('#t .treeview-node').length > 0, null, { timeout: 8000 })
const settle = p => p.waitForTimeout(450)          // the autosave looks every 150 ms here
const p = await ctx.newPage(); watch(p)
await p.goto(url); await ready(p)

// ---- A FIRST VISIT ---------------------------------------------------------------------------------------
const line = () => p.evaluate(() => document.querySelector('.shell-scenes-line').textContent.replace(/\s+/g, ' ').trim())
const cards = () => p.evaluate(() => [...document.querySelectorAll('.shell-scene-card')].map(c => ({ title: c.querySelector('.shell-scene-title').textContent,
    here: c.classList.contains('here'), sel: c.classList.contains('sel'), off: c.classList.contains('off'), key: c.dataset.key })))
let r = await p.evaluate(async () => ({ list: (await CHECK.SESSION.list()).map(m => [m.name, m.scenes, m.here]), rows: CHECK.rows() }))
ok('a first visit: one project, of the demo scene, kept at once', JSON.stringify(r.list) === '[["My project",1,true]]', JSON.stringify(r.list))
ok('...the tree\'s root is the scene\'s row, its contents under it (since 0.26.0)',
    r.rows[0] === 'Builder demo' && r.rows[1] === 'Ball  · no material' && !r.rows.includes('Environment'), JSON.stringify(r))
r = { line: await line(), cards: await cards() }
ok('...one line over the tree: the project, how many scenes (0.63.0)', /My project/.test(r.line) && /· 1 scene\b/.test(r.line), r.line)
ok('...and a card for the scene, the open one', r.cards.length === 1 && r.cards[0].title === 'Builder demo' && r.cards[0].here, JSON.stringify(r.cards))

// ---- FILE: five rows -----------------------------------------------------------------------------------------
const run = id => p.evaluate(id => CHECK.menu.run(id), id)
const titles = () => p.evaluate(() => CHECK.BUILDER.project.scenes.map(s => s.doc.title))
const applied = () => p.evaluate(() => CHECK.T.applied.length)
r = await p.evaluate(() => CHECK.menu.file())
ok('File: New project, Projects…, Import from file…, Export, Save picture', JSON.stringify(r) === '["New project","Projects…","Import from file…","Export","Save picture…"]', JSON.stringify(r))
for (const [label, key] of [['Scene file…', 'exportScene:'], ['Project file…', 'exportProject'], ['3D print (3MF / STL)…', 'exportPrint']]) {
    await p.evaluate(l => CHECK.menu.choose('file.export', l), label)
    r = await p.evaluate(() => CHECK.T.files.at(-1))
    ok(`Export ▸ ${label}: the host's`, r.startsWith(key), r)
}
await run('file.projects')
ok('Projects…: the Project panel', (await p.evaluate(() => CHECK.T.opened.at(-1))) === 'projects')
// a scene file imported: it joins the project after the scene worked on, and is worked on (demo.js load)
await p.evaluate(() => { const d = CHECK.P.blankScene('From a file'); CHECK.M.addObject(d, 'root', { label: 'Pebble' }); CHECK.T.nextFile = { name: 'pebble.json', text: CHECK.M.serialize(d) } })
await run('file.import')
await p.waitForFunction(() => CHECK.BUILDER.doc.title === 'From a file', null, { timeout: 4000 }).catch(() => { })
r = await p.evaluate(() => ({ titles: CHECK.BUILDER.project.scenes.map(s => s.doc.title), rows: CHECK.rows() }))
ok('Import from file…: a scene file joins this project, worked on', JSON.stringify(r.titles) === '["Builder demo","From a file"]'
    && r.rows[0] === 'From a file' && r.rows.some(t => t.startsWith('Pebble')), JSON.stringify(r))
ok('...a card for it, the open one', JSON.stringify((await cards()).map(c => [c.title, c.here])) === '[["Builder demo",false],["From a file",true]]')
// a project file: it asks -- its scenes added here
await p.evaluate(() => { const { P } = CHECK; CHECK.T.nextFile = { name: 'two.json', text: P.serialize(P.createProject([P.blankScene('Two A'), P.blankScene('Two B')])) } })
const asked = run('file.import')
await p.waitForSelector('.shell-ask', { timeout: 4000 })
r = await p.$$eval('.shell-ask .shell-ask-label', e => e.map(x => x.textContent))
ok('...a project file asks: a project of its own, or its scenes here', r.length === 2 && /own/.test(r[0]) && /Add its 2 scenes/.test(r[1]), JSON.stringify(r))
await p.click('.shell-ask .shell-ask-choice:has-text("Add its")'); await asked
await p.waitForFunction(() => CHECK.BUILDER.doc.title === 'Two A', null, { timeout: 4000 }).catch(() => { })
r = await titles()
ok('...its scenes added after the scene worked on, the first worked on', JSON.stringify(r) === '["Builder demo","From a file","Two A","Two B"]', JSON.stringify(r))
r = await p.evaluate(() => { CHECK.BUILDER.undo(); return { titles: CHECK.BUILDER.project.scenes.map(s => s.doc.title), cur: CHECK.BUILDER.doc.title } })
ok('...one undo takes them out, back on the scene they were added from', JSON.stringify(r.titles) === '["Builder demo","From a file"]' && r.cur === 'From a file', JSON.stringify(r))
await p.evaluate(() => { CHECK.T.nextFile = null; CHECK.tree.sceneOps.remove(CHECK.BUILDER.current) })

// ---- THE CARDS (0.63.0) ------------------------------------------------------------------------------------
const card = t => `.shell-scene-card:has(.shell-scene-title:text-is("${t}"))`
let n = await applied()
await p.click('.shell-scenes-plus')
await p.click('.shell-dropdown .shell-label:text-is("Empty scene")')
r = await p.evaluate(() => ({ titles: CHECK.BUILDER.project.scenes.map(s => s.doc.title), cur: CHECK.BUILDER.doc.title, rows: CHECK.rows(), applied: CHECK.T.applied.length }))
ok('＋ › Empty scene: after this one, worked on and compiled', JSON.stringify(r.titles) === '["Builder demo","New scene"]' && r.cur === 'New scene' && r.applied === n + 1, JSON.stringify(r))
ok('...the tree shows it alone, its row the root: no row of the other scene', r.rows[0] === 'New scene' && !r.rows.includes('Ball  · no material'), JSON.stringify(r.rows))
await p.waitForTimeout(300)
ok('...its card, the open one; the line counts two', (await cards()).map(c => c.here).join() === 'false,true' && /· 2 scenes/.test(await line()))
// renamed where it is named (Properties renames by the tree's sceneOps): its card follows
await p.evaluate(() => CHECK.tree.sceneOps.rename(CHECK.BUILDER.current, 'Lens v2'))
await p.waitForTimeout(300)
ok('a scene renamed: its card follows', (await cards()).some(c => c.title === 'Lens v2' && c.here))
// a click on another card only selects it
n = await applied()
await p.click(`${card('Builder demo')} .shell-scene-title`)
r = { cur: await p.evaluate(() => CHECK.BUILDER.doc.title), applied: await applied(), chosen: await p.evaluate(() => CHECK.T.cards.at(-1)), cards: await cards() }
ok('a click on another card: chosen (for Properties), nothing compiled, still on this scene', r.cur === 'Lens v2' && r.applied === n
    && r.chosen === r.cards[0].key && r.cards[0].sel, JSON.stringify(r))
// a double-click opens it
await p.dblclick(`${card('Builder demo')} .shell-scene-title`)
await p.waitForTimeout(100)
r = { cur: await p.evaluate(() => CHECK.BUILDER.doc.title), applied: await applied() }
ok('...a double-click opens it: worked on, compiled', r.cur === 'Builder demo' && r.applied === n + 1, JSON.stringify(r))
// ▶ on another card opens it
await p.hover(card('Lens v2'))
await p.click(`${card('Lens v2')} .shell-scene-go`)
ok('▶ on a card opens it', (await p.evaluate(() => CHECK.BUILDER.doc.title)) === 'Lens v2' && (await applied()) === n + 2)
await p.dblclick(`${card('Lens v2')} .shell-scene-title`)
ok('...the open one\'s double-click: nothing', (await applied()) === n + 2)
await p.dblclick(`${card('Builder demo')} .shell-scene-title`)
// ⋯ on another card: Duplicate -- beside it, and you stay
n = await applied()
await p.click(`${card('Lens v2')} .shell-scene-more`)
await p.click('.shell-dropdown .shell-label:text-is("Duplicate")')
r = { titles: await titles(), cur: await p.evaluate(() => CHECK.BUILDER.doc.title), applied: await applied() }
ok('another card\'s ⋯ › Duplicate: the copy beside it, you stay, nothing compiled', JSON.stringify(r.titles) === '["Builder demo","Lens v2","Lens v2 copy"]'
    && r.cur === 'Builder demo' && r.applied === n, JSON.stringify(r))
// ...Delete, then undo: it comes back, and you stay (the user, 2026-10-17: "undo stays put")
await p.click(`${card('Lens v2 copy')} .shell-scene-more`)
await p.click('.shell-dropdown .shell-label:text-is("Delete")')
r = { titles: await titles(), cur: await p.evaluate(() => CHECK.BUILDER.doc.title), applied: await applied() }
ok('...Delete: gone, you stay, nothing compiled', JSON.stringify(r.titles) === '["Builder demo","Lens v2"]' && r.cur === 'Builder demo' && r.applied === n, JSON.stringify(r))
r = await p.evaluate(() => { const was = CHECK.BUILDER.undo(); return { was, titles: CHECK.BUILDER.project.scenes.map(s => s.doc.title), cur: CHECK.BUILDER.doc.title } })
ok('...an undo brings it back and stays on the scene worked on: nothing to compile', JSON.stringify(r.titles) === '["Builder demo","Lens v2","Lens v2 copy"]'
    && r.cur === 'Builder demo' && r.was === 'live', JSON.stringify(r))
await p.evaluate(() => CHECK.tree.sceneOps.remove(CHECK.BUILDER.project.scenes[2].key))
// DRAGGED, the cards reorder
await p.dragAndDrop(`${card('Lens v2')} .shell-scene-title`, `${card('Builder demo')} .shell-scene-title`)
await p.waitForTimeout(100)
ok('a card dragged onto another: before it', JSON.stringify(await titles()) === '["Lens v2","Builder demo"]', JSON.stringify(await titles()))
await p.dragAndDrop(`${card('Builder demo')} .shell-scene-title`, `${card('Lens v2')} .shell-scene-title`)
await p.waitForTimeout(100)
ok('...and back', JSON.stringify(await titles()) === '["Builder demo","Lens v2"]', JSON.stringify(await titles()))
// FOLDED: one line, which names the open scene
await p.click('.shell-scenes-fold')
r = { line: await line(), shown: await p.$eval('.shell-scenes-cards', e => !e.hidden && e.offsetHeight > 0) }
ok('folded: the cards gone, the line names the open scene', !r.shown && /Builder demo/.test(r.line), JSON.stringify(r))
await p.click('.shell-scenes-fold')
ok('...unfolded: the cards back', (await cards()).length === 2)
// ＋ › From an example…: the Project panel, at its examples
await p.click('.shell-scenes-plus')
await p.click('.shell-dropdown .shell-label:text-is("From an example…")')
ok('＋ › From an example…: the Project panel, at its examples', (await p.evaluate(() => CHECK.T.opened.at(-1))) === 'examples')
// the project's name: the Project panel
await p.click('.shell-scenes-project')
ok('the project\'s name: the Project panel', (await p.evaluate(() => CHECK.T.opened.at(-1))) === 'top')

// ---- THE SCENE'S ROW, the tree's root again (0.26.0): its + in the + column, a click its settings --------------
const sceneRow = '#t .treeview-node[data-path="0"]'
r = await p.evaluate(sceneRow => {
    const x = el => el?.getBoundingClientRect().left
    const add = document.querySelector(`${sceneRow} [title="Add…"]`)
    const mats = [...document.querySelectorAll('#t .treeview-node')].find(n => n.querySelector('.treeview-label')?.textContent === 'Materials')
    // the row has its + alone: no eye, lock, duplicate or delete
    const others = ['enabled', 'lock', 'duplicate', 'delete', 'join'].filter(k => document.querySelector(`${sceneRow} [data-property="${k}"]`))
    return { add: x(add), mats: x(mats?.querySelector('[title="Add…"]')), others }
}, sceneRow)
ok('the scene\'s row: its + alone, in the same column as Materials\' +', r.add != null && Math.abs(r.add - r.mats) < 0.5 && r.others.length === 0, JSON.stringify(r))
r = await p.evaluate(() => CHECK.BUILDER.doc.root.children.length)
await p.click(`${sceneRow} [title="Add…"]`)
// the widget's own menu, as drop.check.mjs goes through it: an entry by the start of its text (a submenu's has its ▸)
await p.evaluate(() => {
    const item = label => [...document.querySelectorAll('.treeview-child-type-menu div')].find(e => e.textContent.trim().startsWith(label))
    item('Shapes').click(); item('Primitives').click(); item('sphere').click()
})
r = { before: r, ...(await p.evaluate(() => ({ n: CHECK.BUILDER.doc.root.children.length, last: CHECK.BUILDER.doc.root.children.at(-1).label }))) }
ok('its +: the + menu, its submenus, a sphere at the scene\'s top level', r.n === r.before + 1 && r.last === 'sphere', JSON.stringify(r))
await p.evaluate(() => CHECK.BUILDER.undo())
const open = () => p.evaluate(() => ({ shown: getComputedStyle(document.querySelector('#t .treeview-children')).display !== 'none', rows: CHECK.rows().length,
    sel: CHECK.T.selected.at(-1), root: CHECK.BUILDER.doc.root.id }))
const was = await open()
await p.click(`${sceneRow} .treeview-label`)
r = await open()
ok('a click on it: the scene itself selected, for Properties -- and the tree stays open', r.sel === r.root && r.shown && r.rows === was.rows && was.shown, JSON.stringify([was, r]))
await p.click(`${sceneRow} .treeview-label`)
r = await open()
ok('...a second click too: still open', r.shown && r.rows === was.rows, JSON.stringify(r))
r = await p.evaluate(() => { CHECK.tree.rebuild(); return getComputedStyle(document.querySelector('#t .treeview-node[data-path="0"]')).backgroundColor })
ok('...and stays lit through a rebuild', r !== 'rgba(0, 0, 0, 0)' && r !== 'transparent', r)

// ---- A CLICK SELECTS, ONLY THE CHEVRON FOLDS (the user, 2026-10-05: "This makes it easier to edit properties") ------
const gid = await p.evaluate(() => {
    const { M, BUILDER, tree } = CHECK
    const g = M.addGroup(BUILDER.doc, 'root', { label: 'Holder' })
    M.addObject(BUILDER.doc, g.id, { label: 'Pin' })
    BUILDER.commit(); tree.rebuild()
    return g.id
})
const seen = label => p.evaluate(l => [...document.querySelectorAll('#t .treeview-node')]
    .some(n => n.querySelector('.treeview-label')?.textContent.startsWith(l) && n.offsetParent !== null), label)
const groupRow = p.locator('#t .treeview-node', { has: p.locator('.treeview-label:text-is("Holder")') }).first()
await groupRow.locator('.treeview-label').click()
r = { sel: await p.evaluate(() => CHECK.T.selected.at(-1)), pin: await seen('Pin') }
ok('a click on a group: selected, for Properties, and not folded', r.sel === gid && r.pin, JSON.stringify(r))
await groupRow.locator('.treeview-label').click()
ok('...a second click: still open', await seen('Pin'))
let picks = await p.evaluate(() => CHECK.T.selected.length)
await groupRow.locator('.treeview-expand-icon').click()
r = { pin: await seen('Pin'), picks: await p.evaluate(() => CHECK.T.selected.length) }
ok('its chevron: folded, and nothing else selected', !r.pin && r.picks === picks, JSON.stringify(r))
await p.evaluate(() => CHECK.tree.rebuild())
ok('...kept folded through a rebuild', !(await seen('Pin')))
await groupRow.locator('.treeview-expand-icon').click()
ok('...its chevron again: open', await seen('Pin'))
// the scene's chevron folds the whole tree; a node selected from elsewhere (the picture) opens it again
picks = await p.evaluate(() => CHECK.T.selected.length)
await p.click(`${sceneRow} .treeview-expand-icon`)
r = { ball: await seen('Ball'), picks: await p.evaluate(() => CHECK.T.selected.length) }
ok('the scene\'s chevron folds the tree, selecting nothing', !r.ball && r.picks === picks, JSON.stringify(r))
await p.evaluate(() => CHECK.tree.select(CHECK.BUILDER.doc.root.children.find(n => n.label === 'Ball').id))
ok('...a node selected from elsewhere (the picture) opens it again', await seen('Ball'))
await p.evaluate(() => CHECK.BUILDER.undo())          // the group out again

// ---- THE ▶: on the open scene's card, only while it is not the one shown (a safe start, a scene that did not compile) --
const play = () => p.evaluate(() => !!document.querySelector('.shell-scene-card.here .shell-sw-play'))
ok('the scene shown: no ▶ on its card', !(await play()))
await p.evaluate(() => CHECK.BUILDER.unshow())
await p.waitForFunction(() => !!document.querySelector('.shell-scene-card.here .shell-sw-play'), null, { timeout: 2000 }).catch(() => { })
ok('...not shown (as after a safe start): the ▶ is on its card, and it says so', await play() && /not compiled/.test(await p.textContent('.shell-scene-card.here .shell-scene-meta')))
n = await applied()
await p.click('.shell-scene-card.here .shell-sw-play')
await p.waitForFunction(() => !document.querySelector('.shell-scene-card.here .shell-sw-play'), null, { timeout: 2000 }).catch(() => { })
ok('...a click compiles it, and the ▶ goes', (await applied()) === n + 1 && !(await play()))

// ---- COPY TO, MOVE TO ANOTHER SCENE (the tree's right-click) -----------------------------------------------
const rowEl = label => p.locator('#t .treeview-node', { has: p.locator(`.treeview-label:text-is("${label}")`) }).first()
let applied0 = await applied()
await rowEl('Ball  · no material').click({ button: 'right' })
r = await p.$$eval('.shell-dropdown .shell-item', e => e.map(x => x.textContent))
ok('a right-click on an object: copy to and move to each other scene', r.includes('Copy Ball to') && r.includes('Move Ball to') && r.filter(t => t === 'Lens v2').length === 2, JSON.stringify(r))
await p.locator('.shell-dropdown .shell-label:text-is("Lens v2")').first().click()
r = await p.evaluate(() => {
    const P = CHECK.P, pr = CHECK.BUILDER.project
    const lens = pr.scenes.find(s => s.doc.title === 'Lens v2').doc
    return { there: lens.root.children.map(n => n.label), here: CHECK.BUILDER.doc.root.children.map(n => n.label), cur: CHECK.BUILDER.doc.title, applied: CHECK.T.applied.length, sound: CHECK.M.validate(lens).length === 0 && P.validate(pr).length === 0 }
})
ok('copy to: in that scene\'s top level, sound; this one keeps it, still worked on, nothing compiled', r.there.includes('Ball') && r.here.includes('Ball') && r.cur === 'Builder demo' && r.applied === applied0 && r.sound, JSON.stringify(r))
r = await p.evaluate(() => { CHECK.BUILDER.undo(); return { cur: CHECK.BUILDER.doc.title, there: CHECK.BUILDER.project.scenes.find(s => s.doc.title === 'Lens v2').doc.root.children.map(n => n.label) } })
ok('...its undo takes the copy back out of that scene, and stays on this one (0.63.0)', r.cur === 'Builder demo' && !r.there.includes('Ball'), JSON.stringify(r))
await p.evaluate(() => CHECK.BUILDER.redo())
await rowEl('Slab  · no material').click({ button: 'right' })
await p.locator('.shell-dropdown .shell-label:text-is("Lens v2")').nth(1).click()
r = await p.evaluate(() => ({ there: CHECK.BUILDER.project.scenes.find(s => s.doc.title === 'Lens v2').doc.root.children.map(n => n.label),
    here: CHECK.BUILDER.doc.root.children.map(n => n.label), applied: CHECK.T.applied.length }))
ok('move to: there, gone from here, and this scene compiled', r.there.includes('Slab') && !r.here.includes('Slab') && r.applied === applied0 + 1, JSON.stringify(r))
r = await p.evaluate(() => { CHECK.BUILDER.undo(); return { here: CHECK.BUILDER.doc.root.children.map(n => n.label), cur: CHECK.BUILDER.doc.title,
    there: CHECK.BUILDER.project.scenes.find(s => s.doc.title === 'Lens v2').doc.root.children.map(n => n.label) } })
ok('...one undo step for both scenes, staying on this one', r.here.includes('Slab') && !r.there.includes('Slab') && r.cur === 'Builder demo', JSON.stringify(r))

// ---- A TREE ROW DROPPED ON A CARD: copied into that scene; with Shift, moved (0.63.0) ----------------------------
applied0 = await applied()
await p.dragAndDrop('#t .treeview-node:has(.treeview-label:text-is("Ball  · no material")) .treeview-label', `${card('Lens v2')} .shell-scene-title`)
await p.waitForTimeout(200)
r = await p.evaluate(() => ({ there: CHECK.BUILDER.project.scenes.find(s => s.doc.title === 'Lens v2').doc.root.children.filter(n => n.label === 'Ball').length,
    here: CHECK.BUILDER.doc.root.children.map(n => n.label), cur: CHECK.BUILDER.doc.title, applied: CHECK.T.applied.length }))
ok('a tree row dropped on another scene\'s card: a copy there, this one keeps it, nothing compiled', r.there === 2 && r.here.includes('Ball')
    && r.cur === 'Builder demo' && r.applied === applied0, JSON.stringify(r))
{
    const from = await p.locator('#t .treeview-node:has(.treeview-label:text-is("Ball  · no material")) .treeview-label').first().boundingBox()
    const to = await p.locator(`${card('Lens v2')} .shell-scene-title`).boundingBox()
    await p.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await p.mouse.down()
    await p.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 })
    await p.keyboard.down('Shift'); await p.mouse.move(to.x + to.width / 2 + 2, to.y + to.height / 2, { steps: 2 }); await p.mouse.up(); await p.keyboard.up('Shift')
    await p.waitForTimeout(200)
}
r = await p.evaluate(() => ({ there: CHECK.BUILDER.project.scenes.find(s => s.doc.title === 'Lens v2').doc.root.children.filter(n => n.label === 'Ball').length,
    here: CHECK.BUILDER.doc.root.children.map(n => n.label), applied: CHECK.T.applied.length }))
ok('...with Shift: moved -- gone from here, this scene compiled', r.there === 3 && !r.here.includes('Ball') && r.applied === applied0 + 1, JSON.stringify(r))
await p.evaluate(() => { CHECK.BUILDER.undo(); CHECK.BUILDER.undo() })
r = await p.evaluate(() => ({ cur: CHECK.BUILDER.doc.title, here: CHECK.BUILDER.doc.root.children.map(n => n.label),
    there: CHECK.BUILDER.project.scenes.find(s => s.doc.title === 'Lens v2').doc.root.children.filter(n => n.label === 'Ball').length }))
ok('...both undone, staying on this scene', r.cur === 'Builder demo' && r.here.includes('Ball') && r.there === 1, JSON.stringify(r))
await p.evaluate(() => CHECK.tree.rebuild())

// ---- THE SYSTEM CLIPBOARD --------------------------------------------------------------------------------
// the key itself, in a real Chromium: a copy event comes with nothing selected, and the tree takes it
await rowEl('Ball  · no material').click()
await p.evaluate(() => { CHECK.T.saidBefore = CHECK.T.said.length; window.__copied = null; window.addEventListener('copy', e => { window.__copied = e.defaultPrevented }, { once: true }) })
await p.keyboard.press('Control+C')
r = await p.evaluate(() => ({ said: CHECK.T.said.slice(CHECK.T.saidBefore), copied: window.__copied }))
ok('Ctrl+C pressed, nothing selected: the browser sends the copy event, and the tree takes it', r.said.includes('copied Ball') && r.copied === true, JSON.stringify(r))
r = await p.evaluate(() => CHECK.BUILDER.doc.root.children.length)
await p.keyboard.press('Control+V')
ok('Ctrl+V pressed: the browser sends the paste event, and the tree pastes', (await p.evaluate(() => CHECK.BUILDER.doc.root.children.length)) === r + 1)
r = await p.evaluate(async () => {
    const { tree, BUILDER } = CHECK
    tree.select(BUILDER.doc.root.children.find(n => n.label === 'Ball').id)
    const dt = new DataTransfer()
    document.body.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }))
    const text = dt.getData('text/plain')
    tree.sceneOps.enter(BUILDER.project.scenes.find(s => s.doc.title === 'Lens v2').key)
    const before = BUILDER.doc.root.children.length
    const dt2 = new DataTransfer(); dt2.setData('text/plain', text)
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt2, bubbles: true, cancelable: true }))
    return { marked: /"format":"raytracer-asset"/.test(text), added: BUILDER.doc.root.children.length - before, cur: BUILDER.doc.title }
})
ok('Ctrl+C puts the row on the system clipboard, marked as ours', r.marked, JSON.stringify(r))
ok('...and Ctrl+V pastes it from there, in another scene', r.added === 1 && r.cur === 'Lens v2', JSON.stringify(r))

// ---- A RELOAD ----------------------------------------------------------------------------------------------
// turned as a move turns it: through the renderer, which tells whoever keeps the view (0.66.0: the scene's, demo.js keepView)
await p.evaluate(() => { CHECK.RT.applyView({ camera: { distance: 7.5 } }) })
await settle(p)
const before = await p.evaluate(() => ({ titles: CHECK.BUILDER.project.scenes.map(s => s.doc.title), cur: CHECK.BUILDER.doc.title,
    kids: CHECK.BUILDER.doc.root.children.map(n => n.label) }))
await p.reload(); await ready(p)
r = await p.evaluate(() => ({ titles: CHECK.BUILDER.project.scenes.map(s => s.doc.title), cur: CHECK.BUILDER.doc.title,
    kids: CHECK.BUILDER.doc.root.children.map(n => n.label), distance: CHECK.R.camera.distance, undo: CHECK.BUILDER.canUndo, rows: CHECK.rows() }))
ok('a reload: the same scenes, the scene worked on, its contents', JSON.stringify([r.titles, r.cur, r.kids]) === JSON.stringify([before.titles, before.cur, before.kids]), `${JSON.stringify(before)} -> ${JSON.stringify(r)}`)
ok('...the camera as it was left', r.distance === 7.5, String(r.distance))
ok('...no undo history (not kept, as decided)', r.undo === false)
// an edit straight before a reload: the page's end flushes it
await p.evaluate(() => { CHECK.tree.sceneOps.add() })
await p.reload(); await ready(p)
ok('an edit just before a reload is not lost', (await p.evaluate(() => CHECK.BUILDER.project.scenes.length)) === before.titles.length + 1)

// a library item being edited: reopened after a reload
r = await p.evaluate(async () => {
    const { M } = CHECK, d = M.createDoc()
    const it = await CHECK.library.add({ name: 'my gold', category: 'Mine', asset: M.extractAsset(d, M.addMaterial(d, { label: 'gold', preset: 'metal' }).id) })
    await CHECK.E.open(it)
    return { active: CHECK.E.active, cur: CHECK.BUILDER.doc.title }
})
ok('a library item opened for editing', r.active && r.cur === 'my gold', JSON.stringify(r))
await p.waitForTimeout(300)
r = await p.evaluate(() => ({ off: ['file.import', 'file.newProject', 'scene.new', 'scene.duplicate', 'scene.delete'].filter(id => CHECK.menu.on(id)),
    cards: [...document.querySelectorAll('.shell-scene-card')].map(c => [c.querySelector('.shell-scene-title').textContent, c.classList.contains('off')]) }))
ok('...nothing imports, adds or deletes while it is edited', r.off.length === 0, JSON.stringify(r))
ok('...the item has no card; the cards wait, greyed', !r.cards.some(c => c[0] === 'my gold') && r.cards.every(c => c[1]), JSON.stringify(r.cards))
const stay = await p.evaluate(() => CHECK.BUILDER.doc.title)
await p.dblclick('.shell-scene-card .shell-scene-title')
ok('...a card double-clicked opens nothing', (await p.evaluate(() => CHECK.BUILDER.doc.title)) === stay)
await settle(p)
await p.reload(); await ready(p)
r = await p.evaluate(() => ({ active: CHECK.E.active, cur: CHECK.BUILDER.doc.title, strip: !!document.querySelector('.shell-edit-strip'), back: CHECK.rows()[0] }))
ok('...reopened after a reload: current, its strip over the view, the tree isolated on it', r.active && r.cur === 'my gold' && r.strip && /^back to/.test(r.back), JSON.stringify(r))
r = await p.evaluate(async () => { CHECK.E.close(); await new Promise(res => setTimeout(res, 50)); return { active: CHECK.E.active, dirty: CHECK.E.dirty, cur: CHECK.BUILDER.doc.title } })
ok('...and closed, unchanged, back to the scene it came from', !r.active && r.cur !== 'my gold', JSON.stringify(r))

// ---- A SECOND TAB: its own copy ---------------------------------------------------------------------------
const q = await ctx.newPage(); watch(q)
await q.goto(url); await ready(q)
r = await q.evaluate(() => ({ info: CHECK.SESSION.info(), proj: document.querySelector('.shell-scenes-project').textContent, said: CHECK.T.said }))
ok('a second tab on the project: a copy, not made yet, and it says so', r.info.id === null && r.info.copy === 'My project' && /not saved yet/.test(r.proj), JSON.stringify(r))
const n0 = await p.evaluate(async () => (await CHECK.SESSION.list()).length)
await q.evaluate(() => { CHECK.RT.applyView({ camera: { distance: 99 } }) }); await settle(q)
ok('...a look (the camera turned) makes no copy', (await p.evaluate(async () => (await CHECK.SESSION.list()).length)) === n0)
const firstScenes = await p.evaluate(() => CHECK.BUILDER.project.scenes.length)
await q.evaluate(() => CHECK.tree.sceneOps.add()); await settle(q)
r = await p.evaluate(async () => (await CHECK.SESSION.list()).map(m => [m.name, m.scenes, m.here, m.elsewhere]))
ok('...an edit makes it, as "<name> (copy)", the second tab\'s', r.some(m => m[0] === 'My project (copy)' && !m[2] && m[3]), JSON.stringify(r))
const mine = await p.evaluate(async () => (await CHECK.store.read(CHECK.SESSION.info().id)).workspace.project.scenes.filter(s => !s.doc.libraryItem).length)
ok('...and the first tab\'s project is not touched by it', mine === firstScenes, `${mine} vs ${firstScenes}`)

// ---- THE PROJECT PANEL (0.63.0: it was a list over the page) ---------------------------------------------------
const prow = name => `#pv .shell-proj-row:has(.shell-proj-name > :first-child:text-is("${name}")), #pv .shell-proj-row:has(.shell-proj-name:text-is("${name}"))`
const pmenu = async (name, label) => {
    await p.hover(`#pv .shell-proj-row[data-id="${await p.evaluate(nm => [...document.querySelectorAll('#pv .shell-proj-row')].find(r => r.querySelector('.shell-proj-name').firstChild.textContent === nm)?.dataset.id, name)}"]`)
    const id = await p.evaluate(nm => [...document.querySelectorAll('#pv .shell-proj-row')].find(r => r.querySelector('.shell-proj-name').firstChild.textContent === nm)?.dataset.id, name)
    await p.click(`#pv .shell-proj-row[data-id="${id}"] .shell-pv-more`)
    return p.$$eval('.shell-dropdown .shell-item', (e, l) => { const x = e.find(i => i.querySelector('.shell-label')?.textContent === l); return x ? !x.classList.contains('off') : null }, label)
}
const pick = label => p.dispatchEvent(`.shell-dropdown .shell-item:has(.shell-label:text-is("${label}"))`, 'mouseup')
await p.evaluate(() => CHECK.view.refresh())
await p.waitForFunction(() => document.querySelectorAll('#pv .shell-proj-row').length >= 2, null, { timeout: 4000 }).catch(() => { })
r = await p.$$eval('#pv .shell-proj-row', e => e.map(x => x.querySelector('.shell-proj-name').textContent))
ok('the panel\'s projects: this tab\'s marked, the copy "another tab"', r.some(t => t === 'My projectthis tab') && r.some(t => t === 'My project (copy)another tab'), JSON.stringify(r))
ok('...neither can be deleted', (await pmenu('My project', 'Delete…')) === false && (await p.keyboard.press('Escape'), await pmenu('My project (copy)', 'Delete…')) === false)
await p.keyboard.press('Escape')
await pmenu('My project', 'Duplicate'); await pick('Duplicate')
await p.waitForFunction(() => [...document.querySelectorAll('#pv .shell-proj-name')].some(e => e.firstChild.textContent === 'My project copy'), null, { timeout: 4000 })
await pmenu('My project copy', 'Rename…'); await pick('Rename…')
await p.fill('#pv .shell-proj-rename', 'Lamp B'); await p.press('#pv .shell-proj-rename', 'Enter')
await p.waitForFunction(() => [...document.querySelectorAll('#pv .shell-proj-name')].some(e => e.firstChild.textContent === 'Lamp B'), null, { timeout: 4000 })
ok('duplicate and rename, from a project\'s ⋯', true)
await pmenu('Lamp B', 'Download as a file'); await pick('Download as a file')
await p.waitForFunction(() => CHECK.T.downloads.length > 0, null, { timeout: 4000 }).catch(() => { })
r = await p.evaluate(() => CHECK.T.downloads.at(-1))
ok('download: a project file (the workspace format), named for it, without the library item', r?.[0] === 'Lamp_B.json' && /"format": "raytracer-workspace"/.test(r[1]) && !/libraryItem/.test(r[1]), r?.[0])
let work = await p.evaluate(() => CHECK.T.work)
await p.click('#pv .shell-proj-row:has(.shell-proj-name:text-is("Lamp B"))')
await p.waitForFunction(() => CHECK.SESSION.info().name === 'Lamp B', null, { timeout: 4000 }).catch(() => { })
r = await p.evaluate(() => ({ info: CHECK.SESSION.info(), undo: CHECK.BUILDER.canUndo, work: CHECK.T.work }))
ok('a click on another project: this tab works on it, its own history, and the picture comes back', r.info.name === 'Lamp B' && !r.undo && r.work === work + 1, JSON.stringify(r))
await p.waitForTimeout(300)
ok('...the line over the tree names it', /Lamp B/.test(await line()))
await p.evaluate(() => CHECK.view.refresh()); await p.waitForTimeout(200)
await pmenu('My project', 'Delete…'); await pick('Delete…')
ok('delete asks first, in the row', !!(await p.waitForSelector('#pv .shell-proj-q', { timeout: 4000 }).catch(() => null)))
await p.click('#pv .shell-proj-btn.danger')
await p.waitForFunction(() => ![...document.querySelectorAll('#pv .shell-proj-name')].some(e => e.firstChild.textContent === 'My project'), null, { timeout: 4000 }).catch(() => { })
r = await p.evaluate(async () => ({ gone: !(await CHECK.SESSION.list()).some(m => m.name === 'My project'), removed: CHECK.T.removed.length }))
ok('...and deletes, its pictures with it', r.gone && r.removed === 1, JSON.stringify(r))
// THIS PROJECT'S SCENES, large: one opened from the panel, and the picture back
await p.evaluate(() => CHECK.tree.sceneOps.add())
await p.evaluate(() => CHECK.view.refresh()); await p.waitForTimeout(200)
r = await p.$$eval('#pv .shell-pv-card[data-key] .shell-pv-title', e => e.map(x => x.textContent))
ok('the panel\'s scenes: a card each', JSON.stringify(r) === JSON.stringify(await titles()), JSON.stringify(r))
n = await applied(); work = await p.evaluate(() => CHECK.T.work)
await p.click('#pv .shell-pv-card[data-key]:not(.here)')
r = { applied: await applied(), work: await p.evaluate(() => CHECK.T.work), cur: await p.evaluate(() => CHECK.BUILDER.current), first: await p.evaluate(() => CHECK.BUILDER.project.scenes[0].key) }
ok('...another opened from it: compiled, and the picture back', r.applied === n + 1 && r.work === work + 1 && r.cur === r.first, JSON.stringify(r))
// an example: a copy into this project
await p.click('#pv .shell-pv-ex:has-text("Menger cubes")')
await p.waitForFunction(() => CHECK.BUILDER.doc.title === 'Menger cubes', null, { timeout: 4000 }).catch(() => { })
ok('an example from the panel: a copy, worked on, and the picture back', (await p.evaluate(() => CHECK.BUILDER.doc.title)) === 'Menger cubes' && (await p.evaluate(() => CHECK.T.work)) === work + 2)
// + New project
await p.click('#pv .shell-proj-btn:has-text("+ New project")')
await p.waitForFunction(() => CHECK.SESSION.info().name === 'New project', null, { timeout: 4000 }).catch(() => { })
r = await p.evaluate(() => ({ info: CHECK.SESSION.info(), titles: CHECK.BUILDER.project.scenes.map(s => s.doc.title) }))
ok('+ New project: one empty scene, worked on here', r.info.name === 'New project' && JSON.stringify(r.titles) === '["New scene"]', JSON.stringify(r))
r = await p.evaluate(() => CHECK.SESSION.info().id)
await run('file.newProject')
await p.waitForFunction(id => CHECK.SESSION.info().id && CHECK.SESSION.info().id !== id, r, { timeout: 4000 }).catch(() => { })
r = await p.evaluate(was => ({ info: CHECK.SESSION.info(), was, titles: CHECK.BUILDER.project.scenes.map(s => s.doc.title) }), r)
ok('File › New project: another, of one empty scene, worked on here', r.info.id !== r.was && JSON.stringify(r.titles) === '["New scene"]', JSON.stringify(r))
// a project file imported as a project of its own (Import from file…, the question answered so)
await p.evaluate(() => {
    const { P } = CHECK
    CHECK.T.nextFile = { name: 'filed.json', text: P.serializeWorkspace(P.createProject([P.blankScene('From a file')]), 's1', { values: {} }) }
})
const asked2 = p.evaluate(() => CHECK.importFile())
await p.waitForSelector('.shell-ask', { timeout: 4000 })
await p.click('.shell-ask .shell-ask-choice:has-text("Open as a project of its own")'); await asked2
await p.waitForFunction(() => CHECK.SESSION.info().name === 'filed', null, { timeout: 4000 }).catch(() => { })
r = await p.evaluate(() => ({ info: CHECK.SESSION.info(), title: CHECK.BUILDER.doc.title }))
ok('Import from file…, a project file: a project of its own, opened', r.info.name === 'filed' && r.title === 'From a file', JSON.stringify(r))
await p.waitForTimeout(300)
ok('...the line over the tree names it', /filed/.test(await line()))

ok('no page errors', errs.length === 0, errs.join('\n      '))
await b.close()
server.close()
console.log(failed ? `\n${failed} FAILED` : '\nall pass')
process.exit(failed ? 1 : 0)
