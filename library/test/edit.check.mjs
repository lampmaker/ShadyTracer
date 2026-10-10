// node library/test/edit.check.mjs
//
// EDITING A LIBRARY ITEM IN A BROWSER (library/edit.js over the real tree and library panel), headless: ✎ on a
// built-in material opens a copy of one's own as a scene the tree shows alone, under a row back; the strip over
// the view names it, with Save and Close; Properties and the Scene tab are brought forward; an edit shows the
// unsaved dot; Close then asks, Keep editing keeps it, Discard goes back to the scene before; the item's row saves;
// the back row closes. The logic under it -- undo, redo, what is saved -- is edit.test.mjs's, on the real builder.
//
// OPTIONAL, AND LOUD ABOUT IT, as the other checks: it needs Playwright's Chromium.
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
if (!chromium) { console.log('(library editor check SKIPPED: no playwright. npm i -g playwright to get it.)'); process.exit(0) }

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
const p = await (await b.newContext({ viewport: { width: 1300, height: 700 } })).newPage()
const errs = []
p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })
let failed = 0
const ok = (n, c, x = '') => { if (!c) failed++; console.log((c ? 'ok    ' : 'FAIL  ') + n + (c ? '' : '  ' + x)) }
await p.goto(`http://localhost:${server.address().port}/library/test/edit.html`)
await p.waitForFunction(() => document.querySelectorAll('.shell-lib-item').length > 0, null, { timeout: 5000 })

const treeLabels = () => p.$$eval('#t [data-path]', a => a.map(x => x.textContent.trim()))
const strip = () => p.$eval('#v .shell-edit-strip', s => s.textContent).catch(() => null)

// OPEN: ✎ on a built-in material edits a copy of one's own, alone in the tree, the strip over the view
await p.hover('.shell-lib-item:has-text("copper")'); await p.click('.shell-lib-item:has-text("copper") button[title^="Edit a copy"]')
await p.waitForSelector('#v .shell-edit-strip', { timeout: 3000 }).catch(() => null)
let S = await p.evaluate(() => ({ cur: CHECK.BUILDER.doc.title, item: CHECK.BUILDER.doc.libraryItem, opened: CHECK.T.opened, sel: CHECK.T.selected.at(-1),
    scenes: CHECK.BUILDER.project.scenes.length, R: CHECK.R }))
let labels = await treeLabels()
ok('✎ on a built-in material opens a copy of one\'s own as a scene of its own', S.cur === 'copper copy' && S.item?.id.startsWith('mine:') && S.scenes === 3, JSON.stringify(S.cur))
// its own row at the root again since 0.26.0 (tree.js rowsFor), under the back row
ok('...the tree shows only it, its row under a row back to the scene before', labels[0].includes('back to my scene') && labels[1] === 'copper copy'
    && !labels.some(l => l.includes('second')) && labels.some(l => l.includes('floor (not saved)')), labels.join('|'))
ok('...its material selected, the Scene tab and Properties brought forward', S.sel === S.item.subject && S.opened.includes('scene') && S.opened.includes('properties'), JSON.stringify(S.opened))
ok('...the strip over the view names it, unsaved-dot hidden', /copper copy/.test(await strip() ?? '')
    && await p.$eval('#v .shell-edit-dot', d => d.hidden))
ok('...the view framed on it, its exposure metered', S.R.values.autoExposure === 1 && S.R.camera.fov === 30, JSON.stringify(S.R))

// AN EDIT: the dot; Close asks; Keep editing keeps it; the strip's Save saves; Close goes back
await p.evaluate(() => { const d = CHECK.BUILDER.doc; d.materials.find(m => m.id === d.libraryItem.subject).params.roughness = 0.91 })
await p.waitForTimeout(450)
ok('an edit shows the unsaved dot', !(await p.$eval('#v .shell-edit-dot', d => d.hidden)))
await p.click('#v .shell-edit-strip button[title^="Close"]')
ok('Close with changes asks, in the strip', /Unsaved changes/.test(await strip() ?? ''), await strip())
await p.click('#v .shell-edit-strip button:has-text("Keep editing")')
ok('Keep editing keeps it', await p.evaluate(() => CHECK.E.active) && /copper copy/.test(await strip() ?? ''))
// the strip's Save: the item's row in the tree had a ✓ too, until 0.7.0; back since 0.26.0, its + alone
await p.click('#v .shell-edit-strip button[title^="Save to the library"]')
await p.waitForTimeout(200)
S = await p.evaluate(async () => ({ kept: (await CHECK.library.list()).find(i => i.name === 'copper copy'), dirty: CHECK.E.dirty }))
ok('the strip\'s Save saves it to the library', S.kept?.asset.material.params.roughness === 0.91 && !S.dirty, JSON.stringify(S.kept?.asset.material.params))
await p.click('#v .shell-edit-strip button[title^="Close"]')
await p.waitForTimeout(200)
S = await p.evaluate(() => ({ cur: CHECK.BUILDER.doc.title, items: CHECK.BUILDER.project.scenes.filter(s => s.doc.libraryItem).length, R: CHECK.R }))
labels = await treeLabels()
/* the tree shows the scene worked on alone since 0.7.0 (the others are the project menu's): back on the scene before,
   its row the root, with no row of the item's or the back row */
ok('Close, saved: back to the scene before, the item\'s scene gone, the tree on that scene again',
    S.cur === 'my scene' && S.items === 0 && labels[0] === 'my scene' && labels.some(l => l.includes('Materials'))
    && !labels.some(l => l.includes('back to') || l.includes('floor (not saved)')), labels.join('|'))
ok('...no strip, the camera and exposure given back', await strip() === null && S.R.camera.distance === 99 && S.R.values.autoExposure === 0, JSON.stringify(S.R))

// DISCARD, and the back row
await p.hover('.shell-lib-item:has-text("copper copy")'); await p.click('.shell-lib-item:has-text("copper copy") button[title^="Edit it"]')
await p.waitForSelector('#v .shell-edit-strip', { timeout: 3000 }).catch(() => null)
await p.evaluate(() => { CHECK.BUILDER.doc.title = 'renamed, never saved' })
await p.click('#t [data-path]:has-text("back to")')
ok('the back row closes -- asking, since it is not saved', /Unsaved changes/.test(await strip() ?? ''), await strip())
await p.click('#v .shell-edit-strip button:has-text("Discard")')
await p.waitForTimeout(200)
S = await p.evaluate(async () => ({ cur: CHECK.BUILDER.doc.title, active: CHECK.E.active, names: (await CHECK.library.list()).map(i => i.name) }))
ok('Discard goes back, and the library still holds what was saved', S.cur === 'my scene' && !S.active && S.names.includes('copper copy')
    && !S.names.includes('renamed, never saved'))

if (errs.length) failed++
console.log(errs.join('\n') || 'no page errors'); await b.close(); server.close()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
