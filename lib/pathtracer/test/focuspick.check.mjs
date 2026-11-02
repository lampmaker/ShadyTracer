// node lib/pathtracer/test/focuspick.check.mjs
//
// PICK FOCUS IN A BROWSER (lib/pathtracer/focuspick.js over the real view toolbar, its Camera popover's real
// PropertyTable and the real lib/camera.js with its mouse controls), headless, a stand-in pick answering the floor:
// the button at the popover's foot; clicked, the popover collapses and the mode is armed; a press on the picture
// focuses the lens on the floor under it -- the focus PLANE's distance along the camera's axis, as the kernels read it
// -- and nobody else hears the press (no orbit, no listener on the window after it, as the measure tool's is); held,
// the focus follows the mouse; let go, focused where it was let go and the mode over, the next drag an orbit again.
// The sky and the letterbox focus nothing; Escape and a press elsewhere let the mode go; an orthographic camera has no
// button and no mode.
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
if (!chromium) { console.log('(focus pick check SKIPPED: no playwright. npm i -g playwright to get it.)'); process.exit(0) }

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
const p = await b.newPage({ viewport: { width: 800, height: 600 } })
const errs = []
p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })
let failed = 0
const ok = (n, c, x = '') => { if (!c) failed++; console.log((c ? 'ok    ' : 'FAIL  ') + n + (c ? '' : '  ' + x)) }
await p.goto(`http://localhost:${server.address().port}/lib/pathtracer/test/focuspick.html`)
await p.waitForFunction(() => window.CHECK, null, { timeout: 5000 })
await p.waitForTimeout(150)          // PropertyTable's own touches come on a timeout

// the stage is 600 x 400 at the page's corner, the buffer 300 x 100: the picture is 600 x 200, from y 100 (letterboxed)
const client = (x, y) => [(x + 1) / 2 * 600, 100 + (1 - y) / 2 * 200]
const settle = () => p.waitForTimeout(120)            // the stand-in's picks take 15 ms each
const S = () => p.evaluate(() => ({ focus: CHECK.cam.get().focus, azimuth: CHECK.cam.get().azimuth, elevation: CHECK.cam.get().elevation,
    armed: CHECK.F.armed, cursor: CHECK.canvas.style.cursor, picks: CHECK.picks.length, later: CHECK.later(),
    pop: CHECK.V.sections.Camera.element.parentElement.style.display }))
const expect = (x, y) => p.evaluate(([x, y]) => CHECK.expect(x, y), [x, y])
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e * Math.max(1, Math.abs(b))
const clickButton = async () => {
    const r = await p.evaluate(() => { const e = CHECK.F.button.element.querySelector('button').getBoundingClientRect(); return [e.x + e.width / 2, e.y + e.height / 2] })
    await p.mouse.click(...r)
}

// THE BUTTON, at the Camera popover's foot
await p.evaluate(() => CHECK.V.open('Camera'))
let s = await S()
ok('the Camera popover opens, with a Pick focus button in it', s.pop === 'block' && await p.evaluate(() =>
    CHECK.V.sections.Camera.element.contains(CHECK.F.button.element) && /Pick focus/.test(CHECK.F.button.element.textContent)), JSON.stringify(s))
await clickButton()
s = await S()
ok('clicked: the popover collapses, the mode armed, the cursor a cross', s.pop === 'none' && s.armed && s.cursor === 'crosshair', JSON.stringify(s))

// PRESSED, HELD, LET GO
const s0 = s
await p.mouse.move(...client(-0.3, -0.4)); await p.mouse.down(); await settle()
s = await S()
let want = await expect(-0.3, -0.4)
ok('a press focuses on the floor under it: the focus plane through it', near(s.focus, want, 1e-5) && s.armed, JSON.stringify([s.focus, want, s.armed]))
ok('...and nobody else heard the press: no orbit, no listener after it on the window', s.azimuth === s0.azimuth && s.elevation === s0.elevation && s.later === s0.later, JSON.stringify([s0, s]))
await p.mouse.move(...client(0.5, 0.6), { steps: 6 }); await settle()
s = await S(); want = await expect(0.5, 0.6)
ok('held and moved: the focus follows the mouse', near(s.focus, want, 1e-5) && s.armed && s.azimuth === s0.azimuth, JSON.stringify([s.focus, want]))
await p.mouse.move(...client(0.1, -0.8)); await p.mouse.up(); await settle()
s = await S(); want = await expect(0.1, -0.8)
ok('let go: focused where it was let go', near(s.focus, want, 1e-5), JSON.stringify([s.focus, want]))
ok('...and the mode over: the cursor back, the camera unturned', !s.armed && s.cursor === '' && s.azimuth === s0.azimuth && s.elevation === s0.elevation, JSON.stringify(s))
const fDone = s.focus
await p.mouse.move(...client(0, 0)); await p.mouse.down(); await p.mouse.move(...client(0.2, 0), { steps: 4 }); await p.mouse.up(); await settle()
s = await S()
ok('the next drag orbits as before, the focus kept', s.azimuth !== s0.azimuth && s.focus === fDone, JSON.stringify(s))

// NOTHING TO FOCUS ON
await p.evaluate(() => CHECK.F.arm())
let n = (await S()).picks
await p.mouse.move(...client(0.9, 0)); await p.mouse.down(); await p.mouse.up(); await settle()
s = await S()
ok('the sky: picked, the focus kept, the mode over', s.picks > n && s.focus === fDone && !s.armed, JSON.stringify(s))
await p.evaluate(() => CHECK.F.arm())
n = (await S()).picks
await p.mouse.move(300, 50); await p.mouse.down(); await p.mouse.up(); await settle()
s = await S()
ok('the letterbox: not even picked, the focus kept', s.picks === n && s.focus === fDone && !s.armed, JSON.stringify(s))

// LET GO WITHOUT FOCUSING
await p.evaluate(() => CHECK.F.arm()); await p.keyboard.press('Escape')
ok('Escape lets the mode go', !(await S()).armed)
await p.evaluate(() => CHECK.F.arm())
const l0 = (await S()).later
await p.mouse.click(50, 420); await settle()
s = await S()
ok('a press elsewhere lets it go, and is its own', !s.armed && s.cursor === '' && s.later === l0 + 1 && s.focus === fDone, JSON.stringify(s))

// AN ORTHOGRAPHIC CAMERA HAS NO LENS
await p.evaluate(() => CHECK.cam.set({ camtype: 1 }))
ok('orthographic: no button', await p.evaluate(() => CHECK.F.button.hidden === true))
await p.evaluate(() => CHECK.F.arm())
ok('...and no mode', !(await S()).armed)
await p.evaluate(() => CHECK.cam.set({ camtype: 0 }))
ok('perspective again: the button back', await p.evaluate(() => CHECK.F.button.hidden === false))

if (errs.length) failed++
console.log(errs.join('\n') || 'no page errors'); await b.close(); server.close()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
