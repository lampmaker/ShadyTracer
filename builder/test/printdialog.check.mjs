//======================================================================================================================
// The print dialog in headless Chromium (builder/printdialog.js, 0.83.0): File > Export > 3D print... over a stand-in
// page (printdialog.html) -- what to print, the box fitted to it, its outline in the picture, a size typed and Fit, the
// settings checked before Export, the export asked with what was chosen and its result said, the settings remembered,
// and Close taking the outline away. Run: node builder/test/printdialog.check.mjs (optional: playwright)
//======================================================================================================================
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
if (!chromium) { console.log('(print dialog check SKIPPED: no playwright. npm i -g playwright to get it.)'); process.exit(0) }

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
await p.goto(`http://localhost:${server.address().port}/builder/test/printdialog.html`)
await p.waitForFunction(() => window.CHECK, null, { timeout: 5000 })

/* what the dialog shows: which choice, which are offered, the sizes, the lines, Export's state */
const shown = () => p.evaluate(() => {
    const d = document.querySelector('.print-dialog')
    if (!d) return null
    const r = v => d.querySelector(`input[data-what="${v}"]`)
    const export_ = [...d.querySelectorAll('button')].find(x => x.textContent === 'Export')
    return { what: r('object').checked ? 'object' : 'scene', objectOffered: !r('object').disabled,
             sizes: [...d.querySelectorAll('input[data-axis]')].map(i => +i.value), text: d.textContent, exportOn: !export_.disabled }
})
const type = (sel, value) => p.evaluate(([sel, value]) => {
    const i = document.querySelector(`.print-dialog ${sel}`)
    i.value = String(value); i.dispatchEvent(new Event('input', { bubbles: true }))
}, [sel, value])
const press = label => p.evaluate(label => [...document.querySelectorAll('.print-dialog button')].find(x => x.textContent === label)?.click(), label)
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6)

// ---- the selected object: its own box, in its own frame
await p.evaluate(() => { try { localStorage.clear() } catch { } CHECK.open('a') })
let s = await shown()
ok('opened on a selection: the object chosen, its own box\'s size', s?.what === 'object' && near(s.sizes, [4, 2, 6]), JSON.stringify(s))
ok('...said in its own frame, z up on the bed', /object's own frame/.test(s.text) && /Selected object: part/.test(s.text))
const corners = await p.evaluate(() => CHECK.T.outline.at(-1))
ok('...its outline in the picture: eight corners, turned with it (its x along the world\'s y)',
    corners?.length === 8 && Math.abs(corners[1][1] - corners[0][1] - 4) < 1e-9 && Math.abs(corners[1][0] - corners[0][0]) < 1e-9, JSON.stringify(corners?.slice(0, 2)))
ok('...the grid said, in mm', /4 x 2 x 6 mm/.test(s.text) || /4\.000 x 2\.000 x 6\.000 mm/.test(s.text), s.text)

// ---- a size typed, then Fit
await type('input[data-axis="z"]', 10)
s = await shown()
ok('a size typed: the box that size about its centre, said typed', near(s.sizes, [4, 2, 10]) && /typed/.test(s.text), JSON.stringify(s))
ok('...the outline follows (what the overlay asks each frame)', await p.evaluate(() => { const c = CHECK.T.get?.(); return !!c && Math.abs(c[4][2] - c[0][2] - 10) < 1e-9 }))
await press('Fit')
s = await shown()
ok('Fit: the fitted box again', near(s.sizes, [4, 2, 6]) && !/typed/.test(s.text), JSON.stringify(s))

// ---- the settings checked, then the export asked with what was chosen
await type('input[step="0.01"]', 0)
s = await shown()
ok('a cell of 0: refused, said, Export off', !s.exportOn && /cell/.test(s.text), JSON.stringify(s))
await type('input[step="0.01"]', 0.25)
await type('input[data-setting="deviation"]', -0.1)
s = await shown()
ok('a negative deviation: refused, said, Export off', !s.exportOn && /deviation/.test(s.text), JSON.stringify(s))
await type('input[data-setting="deviation"]', 0.02)
await p.evaluate(() => { const f = document.querySelector('.print-dialog select[data-setting="format"]'); f.value = 'stl'; f.dispatchEvent(new Event('change')) })
s = await shown()
ok('...a good one: Export on; STL has no colour count', s.exportOn && await p.evaluate(() => document.querySelector('.print-dialog input[max="64"]').parentElement.style.display === 'none'), JSON.stringify(s))
await press('Export')
await p.waitForTimeout(50)
const asked = await p.evaluate(() => CHECK.T.exports.at(-1))
ok('Export: the object, its box in its frame, STL, the cell, the deviation', asked?.subject === 'a' && asked.format === 'stl' && asked.cell === 0.25 && asked.deviation === 0.02
    && near(asked.box.lo, [-2, -1, -3]) && asked.box.frames.length === 1 && asked.box.frames[0].rot.z === 90, JSON.stringify(asked))
s = await shown()
ok('...and what it made said, simplified from what', /STL: 1,234 triangles \(simplified from 5,678\), 2\.0 MB/.test(s.text), s.text)
ok('the scene is untouched: nothing added to it', await p.evaluate(() => CHECK.doc.root.children.map(c => c.id).join() === 'a,b,lamp,dust'))

// ---- the whole scene: the world, the light left out; the settings remembered
await p.evaluate(() => document.querySelector('.print-dialog input[data-what="scene"]').click())
s = await shown()
// a turned 90 about z at x 10: x 9..11, y -2..2; b: x -11..-9, y, z -1..1; z of a -3..3: union x -11..11, y -2..2, z -3..3
ok('Whole scene: the world\'s box, the light left out', s.what === 'scene' && near(s.sizes, [22, 4, 6]) && /In the world/.test(s.text), JSON.stringify(s))
await press('Close')
ok('Close: the dialog gone, and its outline', !(await p.evaluate(() => CHECK.isOpen())) && await p.evaluate(() => CHECK.T.outline.at(-1) === null))
await p.evaluate(() => CHECK.open(null))
s = await shown()
ok('opened with nothing selected: the whole scene, the object not offered', s.what === 'scene' && !s.objectOffered, JSON.stringify(s))
ok('...the cell, deviation and format remembered from the last export', await p.evaluate(() => document.querySelector('.print-dialog input[step="0.01"]').value === '0.25'
    && document.querySelector('.print-dialog input[data-setting="deviation"]').value === '0.02'
    && document.querySelector('.print-dialog select[data-setting="format"]').value === 'stl'))
// ---- the colours as lit (0.next): offered for a 3MF, its samples only then, asked and remembered
const shownRow = sel => p.evaluate(sel => document.querySelector(`.print-dialog ${sel}`).parentElement.style.display !== 'none', sel)
ok('STL: no "colour from" and no samples', !(await shownRow('select[data-setting="light"]')) && !(await shownRow('input[data-setting="samples"]')))
await p.evaluate(() => { const f = document.querySelector('.print-dialog select[data-setting="format"]'); f.value = '3mf'; f.dispatchEvent(new Event('change')) })
ok('3MF: "colour from" offered, Material to start, no samples for it', await shownRow('select[data-setting="light"]') && !(await shownRow('input[data-setting="samples"]'))
    && await p.evaluate(() => document.querySelector('.print-dialog select[data-setting="light"]').value === 'material'))
await p.evaluate(() => { const f = document.querySelector('.print-dialog select[data-setting="light"]'); f.value = 'lit'; f.dispatchEvent(new Event('change')) })
ok('...As lit: its samples offered, 64 to start', await shownRow('input[data-setting="samples"]')
    && await p.evaluate(() => document.querySelector('.print-dialog input[data-setting="samples"]').value === '64'))
await type('input[data-setting="samples"]', 0)
s = await shown()
ok('...0 samples refused, said, Export off', !s.exportOn && /samples/.test(s.text), JSON.stringify(s))
await type('input[data-setting="samples"]', 128)
await press('Export')
await p.waitForTimeout(50)
const lit = await p.evaluate(() => CHECK.T.exports.at(-1))
ok('...Export asks for the colours as lit, at its samples', lit?.light === 'lit' && lit.samples === 128 && lit.format === '3mf', JSON.stringify(lit))
await press('Close')
await p.evaluate(() => CHECK.open(null))
ok('...remembered', await p.evaluate(() => document.querySelector('.print-dialog select[data-setting="light"]').value === 'lit'
    && document.querySelector('.print-dialog input[data-setting="samples"]').value === '128'))
await p.focus('.print-dialog input[data-axis="x"]')
await p.keyboard.press('Escape')
ok('Escape, in the dialog, closes it', !(await p.evaluate(() => CHECK.isOpen())))
await p.evaluate(() => CHECK.open('lamp'))
ok('a light selected: only the whole scene', (await shown())?.objectOffered === false)
await p.evaluate(() => CHECK.open('dust'))
ok('a haze box selected: only the whole scene, and its dust left out of the scene\'s box', (await shown())?.objectOffered === false
    && near((await shown()).sizes, [22, 4, 6]), JSON.stringify(await shown()))
await p.evaluate(() => CHECK.close())

ok('no page errors', !errs.length, errs.join('\n'))
await b.close(); server.close()
console.log(failed ? `${failed} FAILED` : 'print dialog: all passed')
process.exit(failed ? 1 : 0)
