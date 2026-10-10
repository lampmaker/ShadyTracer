// node lib/pathtracer/test/camera.check.mjs
//
// THE CAMERA POPOVER'S FIELDS IN A BROWSER (params.js camBindings in the real PropertyTable, over the real
// lib/camera.js), headless -- the page's own popover needs WebGPU, which the container does not have. The
// position and the target are three plain numbers each (no sliders: the user, 2026-09-30); a number typed in
// moves the camera there -- Tweakpane writes a point by reading the object and assigning x, y and z, so a copy
// would have taken the edit and dropped it -- and keeps the other point where it was; the fields follow a
// camera moved from elsewhere; the distance is a number box, not a slider over seven decades; so are the lens's
// aperture and focus (0.43.0), a number typed in each the camera's.
//
// OPTIONAL, AND LOUD ABOUT IT, as the other checks: it needs Playwright's Chromium.
/* global CHECK -- the page's, in the evaluated functions */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execSync } from 'node:child_process'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
let chromium
try { ({ chromium } = await import('playwright')) } catch {
    try { ({ chromium } = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'playwright/index.mjs')).href)) } catch { }
}
if (!chromium) { console.log('(camera check SKIPPED: no playwright. npm i -g playwright to get it.)'); process.exit(0) }

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
await p.goto(`http://localhost:${server.address().port}/lib/pathtracer/test/camera.html`)
await p.waitForFunction(() => window.CHECK && document.querySelectorAll('#p .tp-lblv').length > 0, null, { timeout: 5000 })
await p.waitForTimeout(150)          // PropertyTable's own touches come on a timeout

// the row of a field, its number inputs, and whether it has a slider or the + for one
const row = key => p.evaluate(k => {
    const el = CHECK.rows.get(k).element
    return { inputs: [...el.querySelectorAll('input')].map(i => i.value), plus: !!el.querySelector('.vector-plus-btn'),
             slider: !!el.querySelector('.tp-sldv') }
}, key)
const near = (a, b, e = 1e-3) => a.every((x, k) => Math.abs(x - b[k]) < e)
let r = await row('position'), t = await row('target')
const pos0 = await p.evaluate(() => CHECK.cam.get().pos)
ok('the position is three numbers, what the camera has', r.inputs.length === 3 && near(r.inputs.map(Number), pos0, 0.01), JSON.stringify([r, pos0]))
ok('...and the target', t.inputs.length === 3 && near(t.inputs.map(Number), [1, 2, 3]), JSON.stringify(t))
ok('no sliders on either', !r.plus && !t.plus && !r.slider && !t.slider, JSON.stringify([r, t]))
ok('...each number to at most four places', [...r.inputs, ...t.inputs].every(v => !/\.\d{5}/.test(v)), JSON.stringify([r.inputs, t.inputs]))
const d = await row('distance')
ok('the distance is a number box, not a slider', d.inputs.length === 1 && !d.slider, JSON.stringify(d))

// TYPED IN, as a person does: the field's value, and a change
const type = (key, i, v) => p.evaluate(([k, i, v]) => {
    const input = CHECK.rows.get(k).element.querySelectorAll('input')[i]
    input.value = String(v); input.dispatchEvent(new Event('change', { bubbles: true }))
    return CHECK.cam.get()
}, [key, i, v])
let c = await type('position', 0, 10)
ok('a position typed in moves the eye there', Math.abs(c.pos[0] - 10) < 1e-6 && near(c.pos.slice(1), pos0.slice(1), 1e-2), JSON.stringify(c.pos))
ok('...still looking at the target, as an orbit', near(c.target, [1, 2, 3], 1e-9) && c.mode === 'orbit'
    && Math.abs(c.distance - Math.hypot(c.pos[0] - 1, c.pos[1] - 2, c.pos[2] - 3)) < 1e-6, JSON.stringify(c))
c = await type('target', 2, 0)
ok('a target typed in is looked at from where the eye stands', Math.abs(c.target[2]) < 1e-9 && Math.abs(c.pos[0] - 10) < 1e-6, JSON.stringify(c))
// THE LENS (0.43.0): two number boxes, each a length the camera takes as typed
const ap = await row('aperture'), fo = await row('focus')
ok('the lens\'s aperture and focus are number boxes, 0 to start (a pinhole, focused on the target)',
    ap.inputs.length === 1 && !ap.slider && fo.inputs.length === 1 && !fo.slider && +ap.inputs[0] === 0 && +fo.inputs[0] === 0, JSON.stringify([ap, fo]))
c = await type('aperture', 0, 0.02); c = await type('focus', 0, 3.5)
ok('...typed in, the camera\'s', c.aperture === 0.02 && c.focus === 3.5, JSON.stringify([c.aperture, c.focus]))
ok('...and the kernels\' camLens: its radius, the distance in focus', await p.evaluate(() => {
    const L = CHECK.cam.getUniforms().camLens; return Math.abs(L[0] - 0.01) < 1e-12 && L[1] === 3.5 }))

// MOVED FROM ELSEWHERE (the wheel, a drag, a scene's camera put back): the fields follow on refresh
await p.evaluate(() => { CHECK.cam.set({ distance: 2 }); CHECK.refresh() })
r = await row('position'); const pos1 = await p.evaluate(() => CHECK.cam.get().pos)
ok('the fields follow a camera moved from elsewhere', near(r.inputs.map(Number), pos1, 0.01), JSON.stringify([r.inputs, pos1]))
ok('...and the refresh wrote nothing back', await p.evaluate(() => Math.abs(CHECK.cam.get().distance - 2) < 1e-9))

if (errs.length) failed++
console.log(errs.join('\n') || 'no page errors'); await b.close(); server.close()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
