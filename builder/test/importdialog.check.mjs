// node builder/test/importdialog.check.mjs
//
// THE IMPORT DIALOG IN A BROWSER (builder/importdialog.js, 0.next), on its own over a blank page, at a device pixel
// ratio of 2 and a phone's width: the bar moving with what it is told; Cancel and Escape calling the host's cancel once
// and closing; an error said with Close; a conversion that did not go cleanly asked about -- each part's lines, a part
// left out by its box, Import handing the host what was left out, the deviation typed and Re-convert handing it over and
// going back to the bar, the red box; nothing refused that could import, no deviation offered; a click elsewhere no
// answer. Whether the page's import goes through it is app.html's, and whether it looks right is the user's.
//
// OPTIONAL, AND LOUD ABOUT IT, as the other checks: it needs Playwright's Chromium.
/* global D */
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
if (!chromium) { console.log('(import dialog check SKIPPED: no playwright. npm i -g playwright to get it.)'); process.exit(0) }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' }
const server = createServer(async (req, res) => {
    try {
        const url = decodeURIComponent(new URL(req.url, 'http://x').pathname)
        if (url === '/blank') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><meta charset="utf-8"><body style="margin:0;background:#111"></body>') }
        const path = join(repo, url)
        if (!path.startsWith(repo)) throw new Error('outside')
        const body = await readFile(path)
        res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
        res.end(body)
    } catch { res.writeHead(404); res.end() }
})
await new Promise(r => server.listen(0, r))
const b = await chromium.launch({ args: ['--disable-gpu'] })
const p = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 390, height: 700 } })
const errs = []
p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })
let failed = 0
const ok = (n, c, x = '') => { if (!c) failed++; console.log((c ? 'ok    ' : 'FAIL  ') + n + (c ? '' : '  ' + x)) }
await p.goto(`http://localhost:${server.address().port}/blank`)
await p.evaluate(async () => { window.D = await import('/builder/importdialog.js'); window.LOG = [] })

const open = () => p.evaluate(() => { window.LOG = []; window.d = D.openImportDialog({ name: 'part.step', onCancel: () => LOG.push('cancel') }) })
const q = sel => p.locator(`.import-dialog ${sel}`)
const gone = async () => (await p.locator('.import-dialog').count()) === 0

// THE BAR
await open()
await p.evaluate(() => d.progress({ label: 'part.step: classifying points inside and out', fraction: 0.4 }))
ok('the bar where it is told, its words', parseFloat(await q('[data-role=bar]').evaluate(e => e.style.width)) === 40
    && (await q('[data-role=stage]').textContent()).includes('classifying'))
const bb = await p.locator('.import-dialog').boundingBox()
ok('...inside a phone\'s width with its gutter', bb.x >= 15 && bb.x + bb.width <= 390 - 15, JSON.stringify(bb))
await p.mouse.click(5, 690)
ok('a click elsewhere is no answer', !(await gone()) && (await p.evaluate(() => LOG.length)) === 0)
await q('[data-role=cancel]').click()
ok('Cancel: the host told once, the dialog gone', await gone() && (await p.evaluate(() => LOG.join())) === 'cancel')
await open()
await p.keyboard.press('Escape')
ok('Escape: the same', await gone() && (await p.evaluate(() => LOG.join())) === 'cancel')

// AN ERROR
await open()
await p.evaluate(() => d.error('part.step: 3 face(s) lie on surfaces that are not planes'))
ok('an error said, the bar gone, Close', (await p.locator('.import-dialog').textContent()).includes('3 face(s)') && (await q('[data-role=cancel]').textContent()) === 'Close')
await q('[data-role=cancel]').click()
ok('...Close closing it, no cancel told', await gone() && (await p.evaluate(() => LOG.length)) === 0)

// A QUESTION
const result = {
    ok: true, asset: {}, warnings: ['an edge on a b_spline_curve is taken as straight'],
    parts: [{ name: 'lid', id: 'g1', report: { shapes: 7, groups: 2, mismatches: 6, checked: 2965 } },
            { name: 'body', id: 'g2', report: { shapes: 12, groups: 3, mismatches: 0, checked: 3000, approximated: 2, deviation: 0.031 } }],
    refused: [{ name: 'knob', why: '1 face(s) of knob lie on surfaces that are not planes, cylinders, cones, spheres or tori (bspline)', needs: 0.12 }],
}
await open()
await p.evaluate(r => d.ask(r, { maxDeviation: 0.05, markRed: true, onImport: a => LOG.push(['import', a]), onReconvert: a => LOG.push(['again', a]) }), result)
const text = await p.locator('.import-dialog').textContent()
ok('asked: 2 of 3 parts converted', text.includes('2 of 3 parts converted'))
ok('...each part with its lines: the disagreement, the fitted faces, the refusal with what it would need',
    text.includes('6 of 2965 check points disagree') && text.includes('2 faces fitted to a regular shape, at most 0.031 mm off') && text.includes('0.12 mm'))
ok('...the warning', text.includes('taken as straight'))
ok('...the deviation offered, at what it was', (await q('[data-role=deviation]').inputValue()) === '0.05')
ok('...the red box, ticked', await q('[data-role=red]').isChecked())
await q('[data-part=lid] [data-role=keep]').uncheck()
await q('[data-role=red]').uncheck()
await q('[data-role=import]').click()
const imp = await p.evaluate(() => LOG)
ok('Import: what was left out and the red, handed to the host; closed', await gone() && imp.length === 1 && imp[0][0] === 'import'
    && JSON.stringify(imp[0][1]) === JSON.stringify({ leaveOut: ['g1'], markRed: false }), JSON.stringify(imp))
await open()
await p.evaluate(r => d.ask(r, { maxDeviation: 0.05, markRed: true, onImport: a => LOG.push(['import', a]), onReconvert: a => { LOG.push(['again', a]); d.restart() } }), result)
await q('[data-part=lid] [data-role=keep]').uncheck()
await q('[data-part=body] [data-role=keep]').uncheck()
ok('...every converted part left out: Import greyed', await q('[data-role=import]').isDisabled())
await q('[data-role=deviation]').fill('0.15')
await q('[data-role=reconvert]').click()
const again = await p.evaluate(() => LOG)
ok('Re-convert: the deviation typed handed over', again.length === 1 && again[0][0] === 'again' && again[0][1].maxDeviation === 0.15 && again[0][1].markRed === true, JSON.stringify(again))
ok('...and back to the bar, the parts gone', !(await gone()) && parseFloat(await q('[data-role=bar]').evaluate(e => e.style.width)) === 0
    && (await q('[data-part]').count()) === 0 && (await q('[data-role=import]').count()) === 0)
await p.evaluate(() => d.close())

// NOTHING THAT A DEVIATION WOULD CHANGE: none offered
await open()
await p.evaluate(() => d.ask({ ok: true, asset: {}, warnings: [], parts: [{ name: 'a', id: 'g', report: { shapes: 3, groups: 1, mismatches: 2, checked: 100 } }], refused: [] },
    { maxDeviation: 0.05, markRed: true, onImport: a => LOG.push(['import', a]) }))
ok('a part with only a disagreement: no deviation, no red box, Import', (await q('[data-role=deviation]').count()) === 0 && (await q('[data-role=red]').count()) === 0
    && (await q('[data-role=import]').textContent()) === 'Import')
await q('[data-role=import]').click()
ok('...Import with nothing left out', JSON.stringify(await p.evaluate(() => LOG)) === JSON.stringify([['import', { leaveOut: [], markRed: true }]]))

// THE WORKER, AS THE PAGE STARTS IT (app.html convertCAD): a module Worker given the assembly's bytes, its progress as it
// goes and one result, the parts with their group ids
{
    const w = await p.evaluate(async () => {
        const bytes = await (await fetch('/import/test/fixtures/assembly.step')).arrayBuffer()
        return await new Promise(res => {
            const worker = new Worker('/import/worker.js', { type: 'module' })
            const progress = []
            worker.onmessage = e => { if (e.data.progress) progress.push(e.data.progress); else { worker.terminate(); res({ progress, result: e.data }) } }
            worker.onerror = e => res({ error: e.message })
            worker.postMessage({ name: 'assembly.step', bytes, material: null, options: {} }, [bytes])
        })
    })
    ok('the worker: one result, ok, two parts with their ids', !w.error && w.result.ok && w.result.parts.length === 2 && w.result.parts.every(x => x.id), JSON.stringify(w).slice(0, 300))
    ok('...its progress before it, from 0 to 1, never back', w.progress?.length >= 2 && w.progress[0].fraction === 0 && w.progress.at(-1).fraction === 1
        && w.progress.every((x, i) => !i || x.fraction >= w.progress[i - 1].fraction), w.progress?.map(x => x.fraction).join(' '))
}

ok('no errors on the page', !errs.length, errs.join(' | '))
await b.close(); server.close()
if (failed) { console.log(`${failed} FAILED`); process.exit(1) }
console.log('import dialog check: all ok')
