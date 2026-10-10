// node library/test/panel.check.mjs
//
// THE LIBRARY PANEL IN A BROWSER (library/panel.js over library/store.js), headless: the items listed by
// category; search and the kind and source chips narrowing them; a double-click and Enter putting one in;
// ＋ refusing with nothing selected and keeping the selection as one's own; renaming and removing it;
// export as a download and import through the file chooser; the tag row narrowing, folding and unfolding;
// ⧉ duplicating into one's own with the name open for renaming; ✎ handing the host one's own item -- a
// built-in one through a copy. The application's page stops at WebGPU, so
// this is what runs the panel.
//
// OPTIONAL, AND LOUD ABOUT IT, as lib/shell/test/example.check.mjs is: it needs Playwright's Chromium.
/* global CHECK, DragEvent, DataTransfer -- the page's, in the evaluated functions */
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
if (!chromium) { console.log('(library panel check SKIPPED: no playwright. npm i -g playwright to get it.)'); process.exit(0) }

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
const ctx = await b.newContext({ acceptDownloads: true })
const p = await ctx.newPage()
const errs = []
p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })
let failed = 0
const ok = (n, c, x = '') => { if (!c) failed++; console.log((c ? 'ok    ' : 'FAIL  ') + n + (c ? '' : '  ' + x)) }
await p.goto(`http://localhost:${server.address().port}/library/test/panel.html`)
await p.waitForFunction(() => document.querySelectorAll('.shell-lib-item').length > 0, null, { timeout: 5000 })

const names = () => p.$$eval('.shell-lib-item .shell-lib-name', a => a.map(x => x.textContent))
const cats = () => p.$$eval('.shell-lib-cat', a => a.map(x => x.textContent))
let c = await cats()
ok('the items are listed by category, each once', ['Shapes', 'Modifiers', 'Lights', 'Materials', 'Optics', 'Assemblies'].every(k => c.includes(k)) && new Set(c).size === c.length, c.join('|'))
ok('each item\'s help is its tooltip', await p.$eval('.shell-lib-item', e => e.title.length > 10))

await p.fill('.shell-lib-bar input', 'lens')
let n = await names()
// a match may be in the name, a tag or the help (polycarbonate is tagged lens): what matters is the lens is
// found and what has nothing to do with it is not
ok('search narrows to what matches', n.some(x => x.startsWith('PMMA lens')) && !n.includes('sphere') && !n.includes('gold') && n.length < 8, n.join('|'))
await p.fill('.shell-lib-bar input', '')
await p.click('.shell-lib-chip[data-k="kind"][data-v="light"]')
n = await names()
ok('the Lights chip shows lights only', n.length >= 3 && n.includes('rectangle light') && !n.includes('sphere'), n.join('|'))
await p.click('.shell-lib-chip[data-k="kind"][data-v=""]')

// THE GRID: pictures asked for as tiles come into view, shown when they arrive; the rest wait off screen
await p.waitForFunction(() => document.querySelectorAll('.shell-lib-pic img').length > 0, null, { timeout: 5000 })
let pics = await p.evaluate(() => ({ imgs: document.querySelectorAll('.shell-lib-pic img').length, tiles: document.querySelectorAll('.shell-lib-tile').length,
    rendered: CHECK.T.rendered.length }))
ok('the grid shows pictures as they arrive', pics.imgs > 0 && pics.tiles > 0, JSON.stringify(pics))
ok('...only for the tiles in view (and a margin), not the whole library at once', pics.rendered < pics.tiles, JSON.stringify(pics))
await p.evaluate(() => document.querySelector('.shell-lib-list').scrollTo(0, 1e6)); await p.waitForTimeout(400)
const more = await p.evaluate(() => CHECK.T.rendered.length)
ok('...and more as the list scrolls', more > pics.rendered, `${pics.rendered} -> ${more}`)
await p.evaluate(() => document.querySelector('.shell-lib-list').scrollTo(0, 0))
// LIVE: a pause on a tile hands it to the studio; leaving hands it back; a sweep across starts nothing
await p.hover('.shell-lib-tile:has-text("sphere")'); await p.waitForTimeout(450)
let L = await p.evaluate(() => ({ live: CHECK.T.live.slice(), canvas: !!document.querySelector('.shell-lib-tile .shell-lib-live') }))
ok('a pause on a tile makes it live', L.live.at(-1) === 'sphere' && L.canvas, JSON.stringify(L))
await p.mouse.move(600, 580); await p.waitForTimeout(100)
L = await p.evaluate(() => ({ stopped: CHECK.T.stopped, canvas: !!document.querySelector('.shell-lib-tile .shell-lib-live') }))
ok('...and leaving it stops the live view', L.stopped === 1 && !L.canvas, JSON.stringify(L))
const before = await p.evaluate(() => CHECK.T.live.length)
for (const name of ['box', 'cylinder', 'sphere']) { await p.hover(`.shell-lib-tile:has-text("${name}")`); await p.waitForTimeout(60) }
await p.mouse.move(600, 580); await p.waitForTimeout(400)
ok('a pointer swept across tiles starts no live view', await p.evaluate(() => CHECK.T.live.length) === before)
// THE LIST: the other view, remembered
await p.click('.shell-lib-viewrow button[title="A list"]')
ok('the list view has rows, no pictures', await p.evaluate(() => !document.querySelector('.shell-lib-tile') && document.querySelectorAll('.shell-lib-item').length > 10))
await p.reload(); await p.waitForFunction(() => document.querySelectorAll('.shell-lib-item').length > 0)
ok('...and is kept for next time', await p.evaluate(() => !document.querySelector('.shell-lib-tile')))
await p.click('.shell-lib-viewrow button[title="Pictures"]')

// PUT IN: a double-click, and Enter in the search box
await p.dblclick('.shell-lib-item:has-text("PMMA lens")')
await p.fill('.shell-lib-bar input', 'optics bench'); await p.press('.shell-lib-bar input', 'Enter')
let T = await p.evaluate(() => CHECK.T)
ok('a double-click puts it in', T.inserted[0]?.startsWith('PMMA lens'), JSON.stringify(T.inserted))
ok('...and Enter puts in the first match', T.inserted[1]?.startsWith('Optics bench'), JSON.stringify(T.inserted))
await p.fill('.shell-lib-bar input', '')

// KEEP THE SELECTION
await p.click('.shell-lib-bar button[title^="Keep"]')
T = await p.evaluate(() => CHECK.T)
ok('＋ with nothing selected says to select something', /select an object/.test(T.said.at(-1) ?? ''), JSON.stringify(T.said))
await p.evaluate(() => { CHECK.T.selected = CHECK.sphereId })
await p.click('.shell-lib-bar button[title^="Keep"]')
ok('＋ opens a line named after the selection', await p.$eval('.shell-lib-form input', i => i.value) === 'my ball')
await p.fill('.shell-lib-form input', 'ball of mine'); await p.press('.shell-lib-form input', 'Enter')
await p.waitForTimeout(200)
await p.click('.shell-lib-chip[data-v="mine"]')
n = await names()
ok('...and Enter keeps it, under Mine', n.length === 1 && n[0] === 'ball of mine' && (await cats()).includes('Mine'), n.join('|'))

// RENAME AND EXPORT, then REMOVE, then IMPORT what was exported
await p.hover('.shell-lib-item'); await p.click('.shell-lib-item button[title="Rename"]')
await p.fill('.shell-lib-rename', 'round thing'); await p.press('.shell-lib-rename', 'Enter')
await p.waitForTimeout(200)
ok('renamed in place', (await names())[0] === 'round thing', (await names()).join('|'))
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('.shell-lib-bar button[title^="Export"]')])
const file = await dl.path()
const text = await readFile(file, 'utf8')
ok('export downloads a library file of one\'s own items', JSON.parse(text).items?.[0]?.name === 'round thing' && dl.suggestedFilename() === 'library.json')
await p.hover('.shell-lib-item'); await p.click('.shell-lib-item button[title^="Remove"]')
await p.waitForTimeout(200)
ok('removed, and the empty list says how to keep something', /Nothing of your own yet/.test(await p.textContent('.shell-lib-list')))
const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('.shell-lib-bar button[title^="Import"]')])
await fc.setFiles(file)
await p.waitForTimeout(300)
ok('import brings it back', (await names())[0] === 'round thing', (await names()).join('|'))

// DRAGGED OUT: the host is told what and when it ends; a tile turning its live view is not dragged
await p.click('.shell-lib-chip[data-v="mine"]')                 // the source filter off again: every item
const drag = await p.evaluate(() => {
    const t = document.querySelector('.shell-lib-item')
    const fire = type => { const e = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }); t.dispatchEvent(e); return e }
    const name = t.querySelector('.shell-lib-name').textContent
    const started = fire('dragstart'); fire('dragend')
    const told = CHECK.T.dragged.slice()
    const m = document.createElement('canvas'); m.className = 'shell-lib-live turning'; t.appendChild(m)
    const refused = fire('dragstart').defaultPrevented
    m.remove()
    return { name, draggable: t.draggable, started: !started.defaultPrevented, told, refused, after: CHECK.T.dragged.length }
})
ok('an item is dragged out, and the host told what and when it ends', drag.draggable && drag.started && drag.told[0] === drag.name && drag.told[1] === null, JSON.stringify(drag))
ok('...but not from a tile whose live view is turning', drag.refused && drag.after === 2, JSON.stringify(drag))

// THE TAG ROW: folded to the most used, a click lights one, two narrow, a lit one survives the fold
{
    const tags = () => p.$$eval('.shell-lib-tags .shell-lib-tag:not(.more)', a => a.map(x => x.dataset.tag))
    const all = await p.evaluate(() => CHECK.library.tagCounts(CHECK.panel.items).length)
    let t = await tags()
    ok('the tag row is folded to the eight most used, with a +N to unfold it',
        all > 10 && t.length === 8 && await p.$eval('.shell-lib-tags .more', b => b.textContent) === `+${all - 8}`, `${t.length} of ${all}: ${t}`)
    await p.click('.shell-lib-tag[data-tag="metal"]')
    n = await names()
    const metal = await p.evaluate(() => CHECK.panel.items.filter(i => i.tags.includes('metal')).map(i => i.name))
    ok('a tag lit shows what carries it', n.length === metal.length && n.every(x => metal.includes(x)), n.join('|'))
    await p.click('.shell-lib-tags .more')
    t = await tags()
    ok('+N unfolds every tag', t.length === all && await p.$eval('.shell-lib-tags .more', b => b.textContent) === 'less', `${t.length} of ${all}`)
    await p.click('.shell-lib-tag[data-tag="brushed"]')
    n = await names()
    ok('two lit: only what carries both', n.length === 1 && n[0] === 'brushed aluminium', n.join('|'))
    await p.click('.shell-lib-tags .more')
    t = await tags()
    ok('...and folded again, the lit ones still show', t.includes('brushed') && t.includes('metal') && t.length < all, t.join())
    for (const k of ['metal', 'brushed']) await p.click(`.shell-lib-tag[data-tag="${k}"]`)
    ok('both off: everything again', (await names()).length > 30)
}

// DUPLICATE: one's own copy, its name open for renaming where it is listed
await p.hover('.shell-lib-item:has-text("gold")'); await p.click('.shell-lib-item:has-text("gold") button[title^="Duplicate"]')
await p.waitForSelector('.shell-lib-rename', { timeout: 3000 }).catch(() => null)
ok('⧉ makes a copy of one\'s own and opens its name for renaming', await p.$eval('.shell-lib-rename', i => i.value).catch(() => null) === 'gold copy')
await p.fill('.shell-lib-rename', 'my gold'); await p.press('.shell-lib-rename', 'Enter'); await p.waitForTimeout(200)
n = await names()
{
    const listed = await p.evaluate(() => CHECK.panel.items.map(i => [i.name, i.category, i.source]))
    const mine = listed.find(x => x[0] === 'my gold')
    ok('...named, one\'s own, in the category it came from', mine?.[1] === 'Materials' && mine?.[2] === 'mine' && n.includes('gold'), JSON.stringify(mine))
    c = await cats()
    ok('...listed under the one Materials heading', c.filter(x => x === 'Materials').length === 1, c.join('|'))
}

// EDIT: one's own handed to the host; a built-in one through a copy of one's own
await p.hover('.shell-lib-item:has-text("my gold")'); await p.click('.shell-lib-item:has-text("my gold") button[title^="Edit it"]')
await p.waitForTimeout(100)
T = await p.evaluate(() => CHECK.T)
ok('✎ on one\'s own item hands it to the host', T.edited.at(-1)?.name === 'my gold' && T.edited.at(-1)?.source === 'mine', JSON.stringify(T.edited))
await p.hover('.shell-lib-item:has-text("copper")'); await p.click('.shell-lib-item:has-text("copper") button[title^="Edit a copy"]')
await p.waitForTimeout(200)
T = await p.evaluate(() => CHECK.T)
ok('✎ on a built-in one hands over a new copy of one\'s own, and says so', T.edited.at(-1)?.name === 'copper copy' && T.edited.at(-1)?.source === 'mine'
    && T.edited.at(-1)?.id.startsWith('mine:') && /copy of your own/.test(T.said.at(-1) ?? ''), JSON.stringify(T.edited.at(-1)) + ' ' + T.said.at(-1))

if (errs.length) failed++
console.log(errs.join('\n') || 'no page errors'); await b.close(); server.close()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
