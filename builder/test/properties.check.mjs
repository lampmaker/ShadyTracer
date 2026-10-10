// node builder/test/properties.check.mjs
//
// THE PROPERTIES PANEL IN A BROWSER (builder/panel.js in the real PropertyTable), headless -- nothing else runs
// it. A material's RELIEF: none at first; a preset chosen gives the material one (a compile), its parameters
// shown in mm whatever the scene's unit and live under the relief's own owner (<id>#relief), its code editor
// listing the errors reported against the relief; none takes it away. A library item's scene row: its category,
// tags and help, each an undo step. The scene's functions editor lists its own errors -- it stopped at
// "checking..." for good, because it compared the row shown with the holder's id ('functions'). The order of a
// material's rows (its relief last) and the code editors' folds. A material item's sample: the studio's four
// shapes offered at two sizes, one chosen swapped in wearing the material, "its own" once changed by hand. A
// modifier's "material follows the warp", on a group with code only.
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
if (!chromium) { console.log('(properties check SKIPPED: no playwright. npm i -g playwright to get it.)'); process.exit(0) }

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
const p = await (await b.newContext({ viewport: { width: 600, height: 1000 } })).newPage()
const errs = []
p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })
let failed = 0
const ok = (n, c, x = '') => { if (!c) failed++; console.log((c ? 'ok    ' : 'FAIL  ') + n + (c ? '' : '  ' + x)) }
await p.goto(`http://localhost:${server.address().port}/builder/test/properties.html`)
await p.waitForFunction(() => !!window.CHECK, null, { timeout: 5000 })
const labels = () => p.$$eval('#p .tp-lblv_l', a => a.map(x => x.textContent.trim()))
// the select of the row labelled `label`
const selectOf = label => p.evaluateHandle(l => [...document.querySelectorAll('#p .tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim() === l)?.querySelector('select'), label)

// A MATERIAL'S RELIEF
await p.evaluate(() => CHECK.panel.show('stone')); await p.waitForTimeout(100)
let L = await labels()
ok('a material shows a relief choice, none at first', L.includes('relief') && !L.some(l => l.startsWith('amplitude')), L.join('|'))
let sel = await selectOf('relief')
await sel.selectOption({ label: 'noise relief' }); await p.waitForTimeout(150)
let S = await p.evaluate(() => ({ relief: CHECK.doc.materials[0].relief, structure: CHECK.T.structure, commits: CHECK.T.commits.length }))
ok('choosing noise relief gives the material one: a compile, an undo step', S.relief?.params.amplitude === 1 && /fbm3/.test(S.relief.code) && S.structure === 1 && S.commits >= 1, JSON.stringify(S).slice(0, 200))
L = await labels()
ok('...its parameters shown in mm, whatever the scene\'s unit (cm here)', L.some(l => l.startsWith('amplitude (mm)')) && L.some(l => l.startsWith('size (mm)')), L.join('|'))
// a parameter dragged: live, under the relief's own owner
const moved = await p.evaluate(async () => {
    const row = [...document.querySelectorAll('#p .tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim().startsWith('amplitude (mm)'))
    const input = row.querySelector('input')
    input.value = '2.5'; input.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(r => setTimeout(r, 50))
    return { value: CHECK.doc.materials[0].relief.params.amplitude, live: CHECK.T.live.slice() }
})
ok('...and live: a change writes the relief\'s own parameter, pushed as stone#relief', moved.value === 2.5 && moved.live.includes('stone#relief.amplitude'), JSON.stringify(moved))
// its code editor lists the errors reported against the relief
const errsShown = await p.evaluate(async () => {
    CHECK.T.messages = [{ node: 'stone#relief', type: 'error', line: 2, col: 5, message: 'no such thing' }]
    const ta = [...document.querySelectorAll('#p textarea')].find(t => t.value.includes('fbm3'))
    ta.value += '\n// touched'; ta.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 800))
    CHECK.T.messages = []
    return [...document.querySelectorAll('#p div')].map(d => d.textContent).find(t => /no such thing/.test(t)) ?? null
})
ok('its code editor lists the errors reported at the relief\'s own lines', /error line 2:5\s+no such thing/.test(errsShown ?? ''), errsShown)
// THE ORDER AND THE FOLDS: the relief last; each code editor a folder of its own, folded when it holds only
// comments, its verdict in its title, its fold remembered
const folders = () => p.evaluate(() => [...document.querySelectorAll('#p .tp-fldv')].map(f => ({
    title: f.querySelector(':scope > .tp-fldv_b .tp-fldv_t')?.textContent.trim(), open: f.classList.contains('tp-fldv-expanded'),
    top: f.parentElement.closest('.tp-fldv')?.querySelector(':scope > .tp-fldv_b .tp-fldv_t')?.textContent.trim() })))
let F = await folders()
const inMaterial = F.filter(f => f.top === 'Material').map(f => f.title)
ok('a material\'s relief comes last, after its parameters and its code', inMaterial.at(-1) === 'relief' && inMaterial.indexOf('material code') < inMaterial.indexOf('relief'), inMaterial.join('|'))
ok('its code is a folder of its own, folded while it holds only comments', F.find(f => f.title?.startsWith('material code'))?.open === false, JSON.stringify(F))
ok('...the relief\'s code, which holds code, open', F.find(f => f.title?.startsWith('relief code'))?.open === true, JSON.stringify(F))
const titled = await p.evaluate(async () => {
    CHECK.T.messages = [{ node: 'stone', type: 'error', line: 1, col: 1, message: 'broken' }]
    const ta = [...document.querySelectorAll('#p textarea')].find(t => t.value.includes('Material code:'))
    ta.value += '\n// touched'; ta.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 800))
    CHECK.T.messages = []
    return [...document.querySelectorAll('#p .tp-fldv_t')].map(t => t.textContent.trim()).find(t => t.startsWith('material code'))
})
ok('a folded code folder says in its title that its code is broken', titled === 'material code · 1 error', titled)
await p.click('#p .tp-fldv_b:has-text("relief code")'); await p.waitForTimeout(250)
await p.evaluate(() => CHECK.panel.show('stone')); await p.waitForTimeout(100)
F = await folders()
ok('a folder folded stays folded when the panel is drawn again', F.find(f => f.title?.startsWith('relief code'))?.open === false, JSON.stringify(F))
await p.evaluate(() => CHECK.panel.show('a')); await p.waitForTimeout(100)
F = await folders()
ok('an object\'s code, which holds code, is open -- the relief\'s fold is not every folder\'s', F.find(f => f.title === 'code')?.open === true, JSON.stringify(F))
await p.evaluate(() => CHECK.panel.show('stone')); await p.waitForTimeout(100)

sel = await selectOf('relief')
await sel.selectOption({ label: 'none' }); await p.waitForTimeout(150)
ok('none takes it away', await p.evaluate(() => CHECK.doc.materials[0].relief === undefined))

// A MATERIAL'S LENGTH reads in mm in a cm scene: its code reads the point in mm (MATERIAL_CODE_TEMPLATE)
await p.evaluate(() => { const m = CHECK.doc.materials[0]; m.params.grain = 3; m.lengths = ['grain']; CHECK.panel.show('stone') })
await p.waitForTimeout(100)
L = await labels()
ok('a material\'s length is labelled mm, whatever the scene\'s unit', L.some(l => l.startsWith('grain (mm)')), L.join('|'))

// A LIBRARY ITEM'S SCENE ROW: its category, tags and help
await p.evaluate(() => { CHECK.doc.libraryItem = { id: 'mine:x', kind: 'material', subject: 'stone', stage: [], details: { category: 'Materials', tags: ['metal'], help: '' } }; CHECK.panel.show('root') })
await p.waitForTimeout(100)
L = await labels()
ok('a library item\'s scene row shows its category, tags and help', ['category', 'tags', 'help'].every(k => L.includes(k)), L.join('|'))
const tagged = await p.evaluate(async () => {
    const row = [...document.querySelectorAll('#p .tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim() === 'tags')
    const input = row.querySelector('input')
    input.value = 'metal, Brushed , '; input.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(r => setTimeout(r, 50))
    return { tags: CHECK.doc.libraryItem.details.tags, commit: CHECK.T.commits.at(-1) }
})
ok('...the tags edited as a line, kept as words, an undo step', JSON.stringify(tagged.tags) === '["metal","Brushed"]' && tagged.commit === 'libraryItem.tags', JSON.stringify(tagged))

// THE FUNCTIONS EDITOR LISTS ITS OWN ERRORS (it stopped at "checking..." for good)
const fn = await p.evaluate(async () => {
    delete CHECK.doc.libraryItem
    CHECK.T.messages = [{ node: 'functions', type: 'error', line: 3, col: 1, message: 'functions broke' }]
    CHECK.panel.show('root')
    await new Promise(r => setTimeout(r, 300))
    CHECK.T.messages = []
    return [...document.querySelectorAll('#p div')].map(d => d.textContent).find(t => /functions broke/.test(t)) ?? null
})
ok('the scene\'s functions editor lists the errors reported against it', /error line 3:1\s+functions broke/.test(fn ?? ''), fn)

// A MODIFIER'S "material follows the warp" (model.js setStraightMaterial): on a group with code only; unchecking it
// marks the group, structural and one undo step
await p.evaluate(() => {
    const { M, doc } = CHECK
    M.addGroup(doc, 'root', { id: 'tw', code: 'warp(0.5);\nC = children(C, p);' })
    M.addGroup(doc, 'root', { id: 'pl' })
    CHECK.panel.show('tw')
})
await p.waitForTimeout(100)
L = await labels()
ok('a group with code offers "material follows the warp", checked', L.includes('material follows the warp')
    && await p.evaluate(() => [...document.querySelectorAll('#p .tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim() === 'material follows the warp')?.querySelector('input')?.checked === true), L.join('|'))
const flip = await p.evaluate(async () => {
    const s0 = CHECK.T.structure, c0 = CHECK.T.commits.length
    const row = [...document.querySelectorAll('#p .tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim() === 'material follows the warp')
    row.querySelector('input').click()
    await new Promise(r => setTimeout(r, 50))
    return { straight: CHECK.M.find(CHECK.doc, 'tw').node.straightMaterial, s: CHECK.T.structure - s0, c: CHECK.T.commits.length - c0 }
})
ok('...unchecked: the group\'s materials laid out straight, structural, an undo step', flip.straight === true && flip.s === 1 && flip.c === 1, JSON.stringify(flip))
await p.evaluate(() => CHECK.panel.show('pl')); await p.waitForTimeout(100)
ok('...a group without code has nothing to bend: no such row', !(await labels()).includes('material follows the warp'))

// A MATERIAL ITEM'S SAMPLE: picked from the studio's shapes, on the material's own Properties
const li = await p.evaluate(() => { const li = CHECK.openItem(); CHECK.panel.show(li.subject); return li })
await p.waitForTimeout(100)
L = await labels()
ok('the item\'s material shows what it is shown on, first after its name', L.indexOf('sample') === L.indexOf('label') + 1, L.join('|'))
sel = await selectOf('sample')
ok('...the sphere, by default, among the four shapes', await sel.evaluate(e => e.value) === 'sphere'
    && JSON.stringify(await sel.evaluate(e => [...e.options].map(o => o.textContent))) === '["sphere","cube","cylinder","F"]')
const before = await p.evaluate(() => ({ s: CHECK.T.structure, c: CHECK.T.commits.length }))
await sel.selectOption({ label: 'F' }); await p.waitForTimeout(200)
const picked = await p.evaluate(li => {
    const d = CHECK.doc, n = CHECK.M.find(d, d.libraryItem.sample)?.node
    const wears = []; CHECK.M.walk({ root: n }, x => { if (x.kind === 'object') wears.push(x.material) })
    return { of: CHECK.sampleOf(d), kind: n?.kind, wears, s: CHECK.T.structure, c: CHECK.T.commits.length, old: !!CHECK.M.find(d, li.sample) }
}, li)
ok('choosing F puts an F in, wearing the material, the old sphere out',
    picked.of?.shape === 'F' && picked.of?.size === 50 && picked.kind === 'group' && picked.wears.length === 3 && picked.wears.every(m => m === li.subject) && !picked.old, JSON.stringify(picked))
ok('...structural, and an undo step', picked.s > before.s && picked.c > before.c, JSON.stringify({ before, picked }))
ok('...and the panel says F', await (await selectOf('sample')).evaluate(e => e.value) === 'F')
// ITS SIZE: 50 mm or 200 mm, the shape kept; the shape chosen after keeps the size
sel = await selectOf('sample size')
ok('the sample\'s size is offered, 50 mm now', JSON.stringify(await sel.evaluate(e => [...e.options].map(o => o.textContent))) === '["50 mm","200 mm"]'
    && await sel.evaluate(e => e.selectedOptions[0]?.textContent) === '50 mm')
await sel.selectOption({ label: '200 mm' }); await p.waitForTimeout(200)
await (await selectOf('sample')).selectOption({ label: 'sphere' }); await p.waitForTimeout(200)
const big = await p.evaluate(() => { const d = CHECK.doc, n = CHECK.M.find(d, d.libraryItem.sample)?.node
    return { of: CHECK.sampleOf(d), r: n?.params.radius, z: n?.transform.pos.z } })
ok('200 mm, then the sphere: a sphere 100 mm in radius, standing on the floor', big.of?.shape === 'sphere' && big.of?.size === 200 && big.r === 100 && big.z === 100, JSON.stringify(big))
ok('...and the panel says so', await (await selectOf('sample size')).evaluate(e => e.selectedOptions[0]?.textContent) === '200 mm')
await p.evaluate(() => { const d = CHECK.doc; CHECK.M.find(d, d.libraryItem.sample).node.transform.scale = 2; CHECK.panel.show(d.libraryItem.subject) })
await p.waitForTimeout(100)
ok('a sample changed by hand is "its own"', await (await selectOf('sample')).evaluate(e => e.selectedOptions[0]?.textContent) === 'its own')
ok('...and has no size to offer: a shape is picked first', !(await labels()).includes('sample size'))

if (errs.length) failed++
console.log(errs.join('\n') || 'no page errors'); await b.close(); server.close()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
