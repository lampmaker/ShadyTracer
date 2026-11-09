// node builder/test/viewlist.check.mjs
//
// THE CAMERA POPOVER'S SAVED VIEWS (builder/viewlist.js, 0.84.0) in headless Chromium, over a stand-in builder that keeps
// the views with the real model (builder/model.js saveView ...) and a stand-in renderer whose camera is plain data --
// the page's own popover needs WebGPU, which the container does not have. Save view, its name opened for typing and
// kept; a click going to a view; the row lit while the camera is at it; a double-click renaming, Escape not; ↻ keeping
// the camera now; ✕ asking a second click; a name the model refuses said in the list; nothing offered while no scene is
// shown. What the builder's verbs do with the scene is builder/test/views.test.mjs's.
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
if (!chromium) { console.log('(viewlist check SKIPPED: no playwright. npm i -g playwright to get it.)'); process.exit(0) }

/* the page: a popover's element, the list in it, a stand-in builder over the real model and a stand-in camera */
const PAGE = `<!doctype html><meta charset="utf-8"><body style="background:#111">
<div id="pop" style="width:300px;background:#16191c"></div>
<script type="module">
import * as M from '/builder/model.js'
import { installViewList } from '/builder/viewlist.js'
const doc = M.createDoc({ title: 'V' })
const cam = { mode: 'orbit', camtype: 0, fov: 40, dimensions: 10, target: [0, 0, 0], azimuth: 40, elevation: 70, distance: 20, up: [0, 0, 1], aperture: 0, focus: 0 }
const watchers = new Set(), tell = () => watchers.forEach(f => f())
const RT = { view: () => ({ camera: structuredClone(cam) }), applyView: ({ camera }) => { Object.assign(cam, structuredClone(camera)); tell() },
             watchView: f => (watchers.add(f), () => watchers.delete(f)) }
const told = () => BUILDER.onSavedViews?.(M.savedViewsOf(doc))
const change = fn => { const r = fn(); told(); return r }
const BUILDER = {
    viewsShown: true, onSavedViews: null,
    savedViews: () => M.savedViewsOf(doc),
    saveView: name => change(() => { const n = name ?? M.nextViewName(doc); M.saveView(doc, n, RT.view().camera); return n }),
    updateView: name => change(() => { M.updateView(doc, name, RT.view().camera); return name }),
    renameView: (a, b) => change(() => { M.renameView(doc, a, b); return b }),
    removeView: name => change(() => { M.removeView(doc, name); return name }),
    goToView: name => { const v = M.savedViewsOf(doc).find(s => s.name === name); if (!v) return false; RT.applyView({ camera: v.camera }); return true },
}
const L = installViewList({ el: document.getElementById('pop'), BUILDER, RT })
window.CHECK = { doc, cam, M, BUILDER, L, move: p => { Object.assign(cam, p); tell() } }
</script>`

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }
const server = createServer(async (req, res) => {
    try {
        const url = decodeURIComponent(new URL(req.url, 'http://x').pathname)
        if (url === '/__viewlist.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); return }
        const path = join(repo, url)
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
try {
    await p.goto(`http://localhost:${server.address().port}/__viewlist.html`)
    await p.waitForFunction(() => window.CHECK, null, { timeout: 10000 })
    const names = () => p.$$eval('.rt-viewlist-row', rs => rs.map(r => r.dataset.name))
    const note = () => p.$eval('.rt-viewlist', el => el.lastChild.style.display === 'none' ? '' : el.lastChild.textContent)
    const frame = () => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))

    ok('none yet, said', (await names()).length === 0 && /None yet/.test(await note()), await note())
    await p.click('.rt-viewlist-save')
    await frame()
    ok('Save view: View 1, its name open for typing and focused', JSON.stringify(await names()) === '["View 1"]'
        && await p.evaluate(() => document.activeElement?.classList.contains('rt-viewlist-name')))
    await p.keyboard.press('Control+a'); await p.keyboard.type('Front'); await p.keyboard.press('Enter')
    await frame()
    ok('...typed and Enter: renamed Front', JSON.stringify(await names()) === '["Front"]', JSON.stringify(await names()))
    ok('...the camera is at it: lit', await p.$eval('.rt-viewlist-go', b => b.textContent.startsWith('●')))

    await p.evaluate(() => CHECK.move({ azimuth: 200, distance: 5, fov: 20 }))
    await frame()
    ok('the camera moved: no longer lit', !(await p.$eval('.rt-viewlist-go', b => b.textContent.startsWith('●'))))
    await p.click('.rt-viewlist-save'); await frame(); await p.keyboard.press('Enter'); await frame()
    ok('a second, kept as View 1', JSON.stringify(await names()) === '["Front","View 1"]', JSON.stringify(await names()))
    await p.click('.rt-viewlist-row[data-name="Front"] .rt-viewlist-go')
    ok('a click on Front: the camera back there', JSON.stringify(await p.evaluate(() => [CHECK.cam.azimuth, CHECK.cam.distance, CHECK.cam.fov])) === '[40,20,40]')
    await frame()
    ok('...lit, and View 1 not', await p.$eval('.rt-viewlist-row[data-name="Front"] .rt-viewlist-go', b => b.textContent.startsWith('●'))
        && !(await p.$eval('.rt-viewlist-row[data-name="View 1"] .rt-viewlist-go', b => b.textContent.startsWith('●'))))

    await p.dblclick('.rt-viewlist-row[data-name="View 1"] .rt-viewlist-go'); await frame()
    await p.keyboard.type('Gone'); await p.keyboard.press('Escape'); await frame()
    ok('a double-click renames, Escape keeps the old name', JSON.stringify(await names()) === '["Front","View 1"]', JSON.stringify(await names()))
    await p.dblclick('.rt-viewlist-row[data-name="View 1"] .rt-viewlist-go'); await frame()
    await p.keyboard.press('Control+a'); await p.keyboard.type('Front'); await p.keyboard.press('Enter'); await frame()
    ok('a name taken: refused, said in the list, the name kept', JSON.stringify(await names()) === '["Front","View 1"]' && /saved already/.test(await note()), await note())

    await p.evaluate(() => CHECK.move({ distance: 9 }))
    await p.click('.rt-viewlist-row[data-name="Front"] .rt-viewlist-update')
    ok('↻: Front kept as the camera is now', await p.evaluate(() => CHECK.M.savedViewsOf(CHECK.doc)[0].camera.distance) === 9)

    await p.click('.rt-viewlist-row[data-name="View 1"] .rt-viewlist-delete')
    ok('✕ once: asks, takes nothing away', JSON.stringify(await names()) === '["Front","View 1"]'
        && await p.$eval('.rt-viewlist-row[data-name="View 1"] .rt-viewlist-delete', b => b.textContent) === 'Delete?')
    await p.click('.rt-viewlist-row[data-name="View 1"] .rt-viewlist-delete')
    ok('...twice: gone', JSON.stringify(await names()) === '["Front"]')

    await p.evaluate(() => { CHECK.BUILDER.viewsShown = false; CHECK.L.refresh() })
    ok('no scene shown: said, and nothing offered', /compile has not ended/.test(await note())
        && await p.$eval('.rt-viewlist-save', b => b.disabled) && await p.$eval('.rt-viewlist-go', b => b.disabled))
    ok('no page errors', errs.length === 0, errs.join('\n'))
} finally {
    await b.close(); server.close()
}
console.log(failed ? `viewlist check: ${failed} FAILED` : 'viewlist check: all ok')
if (failed) process.exit(1)
