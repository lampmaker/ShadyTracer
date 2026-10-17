// node workspace/test/projects.check.mjs
//
// THE PROJECTS KEPT IN THE BROWSER AND THE FILE MENU, headless (UI_PLAN.md section 10), over a page wired as the
// application's is (projects.html: the real store in IndexedDB, Web Locks, autosave, session, projects list, builder,
// tree, File's commands (builder/filemenu.js), library and item editor; only the renderer and the files stood in):
//   - a first visit: one project, of the demo scene; the row over the tree names the project, the tree's root row
//     the scene, and nothing over the tree opens a menu (the dropdown there until 0.45.0 is File's now)
//   - File, its commands run as the menu bar runs them (the menu bar itself: lib/shell/test/example.check.mjs):
//     New scene, rename, duplicate, up and down, delete and undo, a scene switched to -- each compiling only when
//     the scene worked on changes -- an example added as a copy; each file entry calls its own, a scene file opened
//     joins the project, a project file a project of its own; nothing switches or opens while an item is edited
//   - the tree: the scene's row its root, its + the widget's, a click on it its settings without folding the tree;
//     a click on a group selecting it and folding nothing, its chevron folding it and selecting nothing;
//     no row of another scene; a right-click copies or moves to another scene, compiling only this one
//   - the clipboard: a copy goes on the system clipboard as JSON and pastes in another scene
//   - a reload: the same scenes, the scene worked on, the camera; a library item being edited, reopened
//   - a second tab: its own copy, made on its first edit and not over the first tab's
//   - the projects list: which is here and which elsewhere, rename, duplicate, download, new, open, delete asking
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
const watch = p => { p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) }) }
let failed = 0
const ok = (n, c, x = '') => { if (!c) failed++; console.log((c ? 'ok    ' : 'FAIL  ') + n + (c ? '' : '  ' + x)) }
const ready = p => p.waitForFunction(() => window.CHECK && document.querySelectorAll('#t .treeview-node').length > 0, null, { timeout: 8000 })
const settle = p => p.waitForTimeout(450)          // the autosave looks every 150 ms here
const p = await ctx.newPage(); watch(p)
await p.goto(url); await ready(p)

// ---- A FIRST VISIT ---------------------------------------------------------------------------------------
let r = await p.evaluate(async () => ({ list: (await CHECK.SESSION.list()).map(m => [m.name, m.scenes, m.here]), rows: CHECK.rows(),
    name: document.querySelector('.shell-sw-name').textContent, menus: document.querySelectorAll('#sw button:not(.shell-sw-play):not(.icon-btn)').length }))
ok('a first visit: one project, of the demo scene, kept at once', JSON.stringify(r.list) === '[["My project",1,true]]', JSON.stringify(r.list))
ok('...the row names the project; the tree\'s root is the scene\'s row, its contents under it (since 0.26.0)',
    r.name === 'My project' && r.rows[0] === 'Builder demo' && r.rows[1] === 'Ball  · no material' && !r.rows.includes('Environment'), JSON.stringify(r))
ok('...and nothing over the tree is a menu: the scenes and files are File\'s (0.45.0)', r.menus === 0, JSON.stringify(r))

// ---- FILE --------------------------------------------------------------------------------------------------
const run = id => p.evaluate(id => CHECK.menu.run(id), id)
const titles = () => p.evaluate(() => CHECK.BUILDER.project.scenes.map(s => s.doc.title))
ok('File: one scene, so nothing to switch to, and the last scene not deleted', !(await p.evaluate(() => CHECK.menu.on('file.switch') || CHECK.menu.on('file.deleteScene'))))
// THE FILES: each entry calls its own
for (const [id, key] of [['file.saveScene', 'saveScene'], ['file.save', 'save'], ['file.saveWorkspace', 'saveWorkspace']]) {
    await run(id)
    r = await p.evaluate(() => CHECK.T.files.at(-1))
    ok(`${id}: the host's ${key}`, r === key, r)
}
// a scene file opened: it joins the project after the scene worked on, and is worked on (demo.js load)
await p.evaluate(() => { const d = CHECK.P.blankScene('From a file'); CHECK.M.addObject(d, 'root', { label: 'Pebble' }); CHECK.T.nextFile = { name: 'pebble.json', text: CHECK.M.serialize(d) } })
await run('file.open')
await p.waitForFunction(() => CHECK.BUILDER.doc.title === 'From a file', null, { timeout: 4000 }).catch(() => { })
r = await p.evaluate(() => ({ last: CHECK.T.files.at(-1), titles: CHECK.BUILDER.project.scenes.map(s => s.doc.title), rows: CHECK.rows() }))
ok('Open a file…: a scene file joins this project, worked on', r.last === 'open' && JSON.stringify(r.titles) === '["Builder demo","From a file"]'
    && r.rows[0] === 'From a file' && r.rows.some(t => t.startsWith('Pebble')), JSON.stringify(r))
await p.evaluate(() => { CHECK.T.nextFile = null; CHECK.tree.sceneOps.remove(CHECK.BUILDER.current) })
let applied = await p.evaluate(() => CHECK.T.applied.length)
await run('file.new')
r = await p.evaluate(() => ({ titles: CHECK.BUILDER.project.scenes.map(s => s.doc.title), cur: CHECK.BUILDER.doc.title, rows: CHECK.rows(), applied: CHECK.T.applied.length }))
ok('New scene: an empty scene after this one, worked on and compiled', JSON.stringify(r.titles) === '["Builder demo","New scene"]' && r.cur === 'New scene' && r.applied === applied + 1, JSON.stringify(r))
ok('...the tree shows it alone, its row the root: no row of the other scene', r.rows[0] === 'New scene' && !r.rows.includes('Ball  · no material'), JSON.stringify(r.rows))

// rename, through the prompt
await p.evaluate(() => { CHECK.T.nextName = 'Lens v2' })
await run('file.renameScene')
r = await p.evaluate(() => ({ title: CHECK.BUILDER.doc.title, label: CHECK.BUILDER.doc.root.label, list: CHECK.menu.items('file.switch').map(i => i.label.trim()) }))
ok('rename: the scene\'s title and its row, and Switch ▸ lists it', r.title === 'Lens v2' && r.label === 'Lens v2' && r.list.includes('● Lens v2'), JSON.stringify(r))
ok('...and the tree\'s root row follows', (await p.evaluate(() => CHECK.rows()))[0] === 'Lens v2')
// up, down
await run('file.sceneUp')
ok('up: first in the list', JSON.stringify(await titles()) === '["Lens v2","Builder demo"]')
ok('...and up again greyed', !(await p.evaluate(() => CHECK.menu.on('file.sceneUp'))))
await run('file.sceneDown')
ok('down: back', JSON.stringify(await titles()) === '["Builder demo","Lens v2"]')
// switching: Switch to scene ▸, another chosen
applied = await p.evaluate(() => CHECK.T.applied.length)
await p.evaluate(() => CHECK.menu.choose('file.switch', 'Builder demo'))
r = await p.evaluate(() => ({ cur: CHECK.BUILDER.doc.title, applied: CHECK.T.applied.length, rows: CHECK.rows() }))
ok('Switch to scene ▸, one chosen: worked on, compiled', r.cur === 'Builder demo' && r.applied === applied + 1 && r.rows.includes('Ball  · no material'), JSON.stringify(r))
applied = r.applied
await p.evaluate(() => CHECK.menu.choose('file.switch', 'Builder demo'))
ok('...the scene worked on is inert there: no compile', (await p.evaluate(() => CHECK.T.applied.length)) === applied)
// duplicate, delete, undo
await run('file.duplicateScene')
r = await titles()
ok('duplicate: a copy right after it, worked on', JSON.stringify(r) === '["Builder demo","Builder demo copy","Lens v2"]' && await p.evaluate(() => CHECK.BUILDER.doc.title) === 'Builder demo copy', JSON.stringify(r))
await run('file.deleteScene')
r = await p.evaluate(() => ({ titles: CHECK.BUILDER.project.scenes.map(s => s.doc.title), cur: CHECK.BUILDER.doc.title }))
ok('delete: gone, the one before it worked on', JSON.stringify(r.titles) === '["Builder demo","Lens v2"]' && r.cur === 'Builder demo', JSON.stringify(r))
r = await p.evaluate(() => { CHECK.BUILDER.undo(); return CHECK.BUILDER.project.scenes.map(s => s.doc.title) })
ok('...and an undo brings it back', JSON.stringify(r) === '["Builder demo","Builder demo copy","Lens v2"]', JSON.stringify(r))
await p.evaluate(() => { CHECK.tree.sceneOps.remove(CHECK.BUILDER.project.scenes[1].key); CHECK.tree.sceneOps.enter(CHECK.BUILDER.project.scenes[0].key) })
// an example: a copy into the project. Its titles are asked for when File opens (a row's `when`), so they are there
await p.evaluate(() => CHECK.menu.on('file.examples'))
await p.waitForFunction(() => CHECK.menu.items('file.examples').some(i => i.label === 'Menger cubes'), null, { timeout: 4000 }).catch(() => { })
await p.evaluate(() => CHECK.menu.choose('file.examples', 'Menger cubes'))
await p.waitForFunction(() => CHECK.BUILDER.doc.title === 'Menger cubes', null, { timeout: 4000 }).catch(() => { })
r = await p.evaluate(() => ({ titles: CHECK.BUILDER.project.scenes.map(s => s.doc.title), cur: CHECK.BUILDER.doc.title }))
ok('an example, from Examples ▸: a copy after the scene worked on, and worked on', JSON.stringify(r.titles) === '["Builder demo","Menger cubes","Lens v2"]' && r.cur === 'Menger cubes', JSON.stringify(r))
await p.evaluate(() => CHECK.tree.sceneOps.enter(CHECK.BUILDER.project.scenes[0].key))

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

// ---- THE ▶: only while the scene worked on is not the one shown (a safe start, a scene that did not compile) --------
ok('the scene shown: no ▶', await p.$eval('.shell-sw-play', b => b.hidden))
await p.evaluate(() => CHECK.BUILDER.unshow())
await p.waitForFunction(() => !document.querySelector('.shell-sw-play').hidden, null, { timeout: 2000 }).catch(() => { })
ok('...not shown (as after a safe start): the ▶ is there', !(await p.$eval('.shell-sw-play', b => b.hidden)))
applied = await p.evaluate(() => CHECK.T.applied.length)
await p.click('.shell-sw-play')
await p.waitForFunction(() => document.querySelector('.shell-sw-play').hidden, null, { timeout: 2000 }).catch(() => { })
ok('...a click compiles it, and the ▶ goes', (await p.evaluate(() => CHECK.T.applied.length)) === applied + 1 && await p.$eval('.shell-sw-play', b => b.hidden))

// ---- COPY TO, MOVE TO ANOTHER SCENE (the tree's right-click) -----------------------------------------------
const rowEl = label => p.locator('#t .treeview-node', { has: p.locator(`.treeview-label:text-is("${label}")`) }).first()
applied = await p.evaluate(() => CHECK.T.applied.length)
await rowEl('Ball  · no material').click({ button: 'right' })
r = await p.$$eval('.shell-dropdown .shell-item', e => e.map(x => x.textContent))
ok('a right-click on an object: copy to and move to each other scene', r.includes('Copy Ball to') && r.includes('Move Ball to') && r.filter(t => t === 'Lens v2').length === 2, JSON.stringify(r))
await p.locator('.shell-dropdown .shell-label:text-is("Lens v2")').first().click()
r = await p.evaluate(() => {
    const P = CHECK.P, pr = CHECK.BUILDER.project
    const lens = pr.scenes.find(s => s.doc.title === 'Lens v2').doc
    return { there: lens.root.children.map(n => n.label), here: CHECK.BUILDER.doc.root.children.map(n => n.label), cur: CHECK.BUILDER.doc.title, applied: CHECK.T.applied.length, sound: CHECK.M.validate(lens).length === 0 && P.validate(pr).length === 0 }
})
ok('copy to: in that scene\'s top level, sound; this one keeps it, still worked on, nothing compiled', r.there.includes('Ball') && r.here.includes('Ball') && r.cur === 'Builder demo' && r.applied === applied && r.sound, JSON.stringify(r))
await rowEl('Slab  · no material').click({ button: 'right' })
await p.locator('.shell-dropdown .shell-label:text-is("Lens v2")').nth(1).click()
r = await p.evaluate(() => ({ there: CHECK.BUILDER.project.scenes.find(s => s.doc.title === 'Lens v2').doc.root.children.map(n => n.label),
    here: CHECK.BUILDER.doc.root.children.map(n => n.label), applied: CHECK.T.applied.length }))
ok('move to: there, gone from here, and this scene compiled', r.there.includes('Slab') && !r.here.includes('Slab') && r.applied === applied + 1, JSON.stringify(r))
r = await p.evaluate(() => { CHECK.BUILDER.undo(); return { here: CHECK.BUILDER.doc.root.children.map(n => n.label), cur: CHECK.BUILDER.doc.title,
    there: CHECK.BUILDER.project.scenes.find(s => s.doc.title === 'Lens v2').doc.root.children.map(n => n.label) } })
ok('...one undo step for both scenes, staying on this one', r.here.includes('Slab') && !r.there.includes('Slab') && r.cur === 'Builder demo', JSON.stringify(r))

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
// turned as a move turns it: through the renderer, which tells whoever keeps the view (0.63.0: the scene's, demo.js keepView)
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
r = await p.evaluate(() => ({ off: ['file.new', 'file.switch', 'file.examples', 'file.open', 'file.newProject', 'file.deleteScene'].filter(id => CHECK.menu.on(id)),
    item: CHECK.menu.on('file.saveItem') && CHECK.menu.on('file.closeItem') }))
ok('...nothing switches, adds or opens while it is edited; its Save and Close are File\'s', r.off.length === 0 && r.item, JSON.stringify(r))
await settle(p)
await p.reload(); await ready(p)
r = await p.evaluate(() => ({ active: CHECK.E.active, cur: CHECK.BUILDER.doc.title, strip: !!document.querySelector('.shell-edit-strip'), back: CHECK.rows()[0] }))
ok('...reopened after a reload: current, its strip over the view, the tree isolated on it', r.active && r.cur === 'my gold' && r.strip && /^back to/.test(r.back), JSON.stringify(r))
r = await p.evaluate(async () => { CHECK.E.close(); await new Promise(res => setTimeout(res, 50)); return { active: CHECK.E.active, dirty: CHECK.E.dirty, cur: CHECK.BUILDER.doc.title } })
ok('...and closed, unchanged, back to the scene it came from', !r.active && r.cur !== 'my gold', JSON.stringify(r))

// ---- A SECOND TAB: its own copy ---------------------------------------------------------------------------
const q = await ctx.newPage(); watch(q)
await q.goto(url); await ready(q)
r = await q.evaluate(() => ({ info: CHECK.SESSION.info(), proj: document.querySelector('.shell-sw-title').textContent, said: CHECK.T.said }))
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

// ---- THE PROJECTS LIST -------------------------------------------------------------------------------------
await p.evaluate(() => CHECK.dialog.show())
await p.waitForSelector('.shell-proj-row')
r = await p.$$eval('.shell-proj-row', e => e.map(x => x.textContent))
ok('the list: this tab\'s marked "open here", the copy "open in another tab"', r.some(t => t.startsWith('My projectopen here')) && r.some(t => t.includes('My project (copy)open in another tab')), JSON.stringify(r))
r = await p.$$eval('.shell-proj-row', e => e.map(x => x.querySelector('[title^="Delete"], [title^="It is the one"], [title^="Another tab"]')?.disabled))
ok('...neither of those can be deleted', r.every(d => d === true), JSON.stringify(r))
await p.click('.shell-proj-row.here [title="Duplicate: a copy kept beside it"]')
await p.waitForFunction(() => [...document.querySelectorAll('.shell-proj-name')].some(e => e.textContent.startsWith('My project copy')))
await p.click('.shell-proj-row:has(.shell-proj-name:text-is("My project copy")) [title="Rename"]')
await p.fill('.shell-proj-rename', 'Lamp B'); await p.press('.shell-proj-rename', 'Enter')
await p.waitForFunction(() => [...document.querySelectorAll('.shell-proj-name')].some(e => e.textContent === 'Lamp B'))
ok('duplicate and rename, in the list', true)
await p.click('.shell-proj-row:has(.shell-proj-name:text-is("Lamp B")) [title^="Download"]')
await p.waitForFunction(() => CHECK.T.downloads.length > 0, null, { timeout: 4000 }).catch(() => { })
r = await p.evaluate(() => CHECK.T.downloads.at(-1))
ok('download: a workspace file, named for it, without the library item', r?.[0] === 'Lamp_B.json' && /"format": "raytracer-workspace"/.test(r[1]) && !/libraryItem/.test(r[1]), r?.[0])
await p.click('.shell-proj-row:has(.shell-proj-name:text-is("Lamp B")) .shell-proj-btn.main')
await p.waitForFunction(() => CHECK.SESSION.info().name === 'Lamp B', null, { timeout: 4000 }).catch(() => { })
r = await p.evaluate(() => ({ info: CHECK.SESSION.info(), open: CHECK.dialog.isOpen, undo: CHECK.BUILDER.canUndo }))
ok('open: this tab works on it, its own history', r.info.name === 'Lamp B' && !r.open && !r.undo, JSON.stringify(r))
await p.waitForTimeout(300)
ok('...the row names it', await p.textContent('.shell-sw-title') === 'Lamp B')
await p.evaluate(() => CHECK.dialog.show()); await p.waitForSelector('.shell-proj-row')
await p.click('.shell-proj-row:has(.shell-proj-name:text-is("My project")) [title^="Delete it"]')
ok('delete asks first', !!(await p.waitForSelector('.shell-proj-q', { timeout: 4000 }).catch(() => null)))
await p.click('.shell-proj-btn.danger')
await p.waitForFunction(() => ![...document.querySelectorAll('.shell-proj-name')].some(e => e.textContent.startsWith('My projectopen') || e.firstChild?.textContent === 'My project'))
ok('...and deletes', !(await p.evaluate(async () => (await CHECK.SESSION.list()).some(m => m.name === 'My project'))))
await p.click('.shell-proj-btn:has-text("+ New project")')
await p.waitForFunction(() => CHECK.SESSION.info().name === 'New project', null, { timeout: 4000 }).catch(() => { })
r = await p.evaluate(() => ({ info: CHECK.SESSION.info(), titles: CHECK.BUILDER.project.scenes.map(s => s.doc.title) }))
ok('+ New project: one empty scene, worked on here', r.info.name === 'New project' && JSON.stringify(r.titles) === '["New scene"]', JSON.stringify(r))
// FILE'S PROJECT ENTRIES: New project, and a workspace file kept as a project, through Import a project
r = await p.evaluate(() => CHECK.SESSION.info().id)
await run('file.newProject')
await p.waitForFunction(id => CHECK.SESSION.info().id && CHECK.SESSION.info().id !== id, r, { timeout: 4000 }).catch(() => { })
r = await p.evaluate(was => ({ info: CHECK.SESSION.info(), was, titles: CHECK.BUILDER.project.scenes.map(s => s.doc.title) }), r)
ok('File › New project: another, of one empty scene, worked on here', r.info.id !== r.was && JSON.stringify(r.titles) === '["New scene"]', JSON.stringify(r))
await p.evaluate(() => {
    const { P } = CHECK
    CHECK.T.nextFile = { name: 'filed.json', text: P.serializeWorkspace(P.createProject([P.blankScene('From a file')]), 's1', { values: {} }) }
})
await run('file.importProject')
await p.waitForFunction(() => CHECK.SESSION.info().name === 'filed', null, { timeout: 4000 }).catch(() => { })
r = await p.evaluate(() => ({ info: CHECK.SESSION.info(), title: CHECK.BUILDER.doc.title, last: CHECK.T.files.at(-1) }))
ok('Import a project from a file…: a workspace file, a project of its own, opened', r.last === 'importProject' && r.info.name === 'filed' && r.title === 'From a file', JSON.stringify(r))
await p.waitForTimeout(300)
ok('...the row names it', await p.textContent('.shell-sw-title') === 'filed')

ok('no page errors', errs.length === 0, errs.join('\n      '))
await b.close()
server.close()
console.log(failed ? `\n${failed} FAILED` : '\nall pass')
process.exit(failed ? 1 : 0)
