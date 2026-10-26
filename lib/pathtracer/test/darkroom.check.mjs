// node lib/pathtracer/test/darkroom.check.mjs
//
// THE DARKROOM'S VIEWER IN A BROWSER (darkroom/viewer.js, 0.next), over a stand-in darkroom (darkroom.html) that
// records every draw and every pixel read, at a device pixel ratio of 2 so CSS and device pixels differ, as on most
// screens the user has. What it drives: nothing kept said; a picture shown in Fit; 100 %, + and -, the keys; the wheel
// keeping the picture point under the cursor; a drag panning with the hand; the readout asking for the pixel under the
// cursor, numbered from the top left; Before held, Split drawing the view's picture beside, Clipping passed on; a line
// over the picture; a picture of the same size kept where it was, another refitted; nothing kept again.
// What the picture LOOKS like is not here: the container has no GPU that draws (CLAUDE.md), and the user's eye is
// the judge of that.
//
// OPTIONAL, AND LOUD ABOUT IT, as the other checks: it needs Playwright's Chromium.
/* global CHECK -- the page's, in the evaluated functions */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execSync } from 'node:child_process'
import { viewFit, pictureAtPoint, fromCss, toUniform, imageXY } from '../darkroom/view.js'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
let chromium
try { ({ chromium } = await import('playwright')) } catch {
    try { ({ chromium } = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'playwright/index.mjs')).href)) } catch { }
}
if (!chromium) { console.log('(darkroom check SKIPPED: no playwright. npm i -g playwright to get it.)'); process.exit(0) }

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
const p = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1000, height: 700 } })
const errs = []
p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })
let failed = 0
const ok = (n, c, x = '') => { if (!c) failed++; console.log((c ? 'ok    ' : 'FAIL  ') + n + (c ? '' : '  ' + x)) }
await p.goto(`http://localhost:${server.address().port}/lib/pathtracer/test/darkroom.html`)
await p.waitForFunction(() => window.CHECK, null, { timeout: 5000 })

const frames = n => p.evaluate(n => new Promise(r => { const go = k => k ? requestAnimationFrame(() => go(k - 1)) : r(); go(n) }), n)
const el = k => p.locator(`#v [data-dr="${k}"]`)
const view = () => p.evaluate(() => CHECK.V.view)
const lastDraw = canvas => p.evaluate(c => CHECK.draws.filter(d => d.canvas === c).at(-1) ?? null, canvas)
const stageBox = async () => el('stage').boundingBox()
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b))
const DPR = 2
const PIC = { w: 2000, h: 1000, samples: 64, bytes: 2000 * 1000 * 16, view: {}, overlay: false }

// NOTHING KEPT
ok('nothing kept: said over the stage', /Nothing rendered yet/.test(await el('message').textContent()) && await el('message').isVisible())
ok('...the buttons greyed', await el('fit').isDisabled() && await el('in').isDisabled())

// A PICTURE: Fit
await p.evaluate(pic => CHECK.V.picture(pic), PIC)
await frames(3)
const box = await stageBox()
const res = [Math.round(box.width * DPR), Math.round(box.height * DPR)]
{
    const d = await lastDraw('now')
    const want = toUniform(viewFit([PIC.w, PIC.h], res))
    ok('a picture: drawn in Fit, into a canvas of the stage\'s device pixels', d && d.w === res[0] && d.h === res[1]
        && d.view.every((x, i) => near(x, want[i])) && d.tag === 'now' && d.clipWarn === false, JSON.stringify({ d, want, res }))
    ok('...the message gone, the caption saying what is kept', !(await el('message').isVisible())
        && /2000×1000 · 64 samples · 32 MB/.test(await el('caption').textContent()))
    ok('...Fit lit, the zoom said', (await el('fit').getAttribute('aria-pressed')) === 'true'
        && (await el('zoom').textContent()) === `${+(res[0] / 2000 * 100).toFixed(1)} %`, await el('zoom').textContent())
}

// 100 %, + and -
await el('100').click(); await frames(2)
ok('100 %: one picture pixel a device pixel', near((await view()).z, 1) && (await el('zoom').textContent()) === '100 %' && near((await lastDraw('now')).view[2], 1))
await el('in').click(); await frames(2)
ok('+ from 100 %: 150 %', near((await view()).z, 1.5))
await el('out').click(); await el('out').click(); await frames(2)
ok('- twice: 2/3', near((await view()).z, 2 / 3))

// THE WHEEL about the cursor
{
    const v0 = await view()
    const at = [box.x + 600, box.y + 120]
    const o = fromCss(600, 120, box.height, DPR)
    const before = pictureAtPoint(v0, o, res)
    await p.mouse.move(...at)
    await p.mouse.wheel(0, -300)
    await frames(3)
    const v1 = await view()
    const after = pictureAtPoint(v1, o, res)
    ok('the wheel zooms in, about the cursor: the picture point under it stays', v1.z > v0.z && near(before[0], after[0], 1e-6) && near(before[1], after[1], 1e-6),
        JSON.stringify({ v0, v1, before, after }))
}

// A DRAG pans with the hand
{
    const v0 = await view()
    const from = [box.x + 300, box.y + 200]
    const grabbed = pictureAtPoint(v0, fromCss(300, 200, box.height, DPR), res)
    await p.mouse.move(...from); await p.mouse.down()
    await p.mouse.move(from[0] + 50, from[1] + 30, { steps: 5 }); await p.mouse.up()
    await frames(2)
    const v1 = await view()
    const under = pictureAtPoint(v1, fromCss(350, 230, box.height, DPR), res)
    ok('a drag pans: the point grabbed is under the cursor where it let go', near(grabbed[0], under[0], 1e-6) && near(grabbed[1], under[1], 1e-6),
        JSON.stringify({ grabbed, under }))
}

// THE READOUT: the pixel under the cursor
{
    await el('100').click(); await frames(2)
    const v = await view()
    await p.mouse.move(box.x + 410, box.y + 250); await frames(4)
    const o = fromCss(410, 250, box.height, DPR)
    const q = pictureAtPoint(v, o, res), want = [Math.floor(q[0]), Math.floor(q[1])]
    const read = await p.evaluate(() => CHECK.reads.at(-1))
    ok('the readout reads the pixel under the cursor (the buffer\'s numbering, row 0 the bottom)', read && read[0] === want[0] && read[1] === want[1],
        JSON.stringify({ read, want }))
    const text = await el('readout').textContent()
    const [x, y] = imageXY(want, [PIC.w, PIC.h])
    ok('...and says it numbered from the top left, its luminance and light', text.includes(`x ${x}  y ${y}`) && text.includes('2.1 cd/m²')
        && text.includes('RGB 1.5 2.5 0.25'), text)
}

// KEYS
await el('stage').focus()
await p.keyboard.press('0'); await frames(2)
ok('0: Fit', (await view()).fit)
await p.keyboard.press('2'); await frames(2)
ok('2: 200 %', near((await view()).z, 2))
await p.keyboard.press('+'); await frames(2)
ok('+: the next step, 300 %', near((await view()).z, 3))
await p.keyboard.press('-'); await frames(2)
ok('-: back to 200 %', near((await view()).z, 2))
{
    const v0 = await view()
    await p.keyboard.press('ArrowRight'); await frames(2)
    const v1 = await view()
    ok('an arrow pans a tenth of the stage', near(v1.cx - v0.cx, res[0] * 0.1 / 2) && v1.cy === v0.cy, JSON.stringify({ v0, v1 }))
}
await p.keyboard.down('\\'); await frames(3)
ok('\\ held: the picture as the view showed it', (await lastDraw('now')).tag === 'before')
await p.keyboard.up('\\'); await frames(3)
ok('...let go: as it is now', (await lastDraw('now')).tag === 'now')

// BEFORE (held), SPLIT, CLIPPING
{
    const bb = await el('hold').boundingBox()
    await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.mouse.down(); await frames(3)
    ok('Before held: the view\'s picture', (await lastDraw('now')).tag === 'before')
    await p.mouse.up(); await frames(3)
    ok('...let go: now', (await lastDraw('now')).tag === 'now')
    await el('split').click(); await frames(3)
    const bd = await lastDraw('before')
    ok('Split: the view\'s picture drawn beside, the same part of it', bd && bd.tag === 'before'
        && JSON.stringify(bd.view) === JSON.stringify((await lastDraw('now')).view))
    ok('...left of the line, the picture now right of it', await el('before').isVisible() && await el('line').isVisible()
        && (await el('now').evaluate(c => c.style.clipPath)) === 'inset(0px 0px 0px 50%)', await el('now').evaluate(c => c.style.clipPath))
    // the line dragged to a quarter
    const lb = await el('line').boundingBox()
    await p.mouse.move(lb.x + lb.width / 2, lb.y + 100); await p.mouse.down()
    await p.mouse.move(box.x + box.width * 0.25, lb.y + 100, { steps: 4 }); await p.mouse.up(); await frames(3)
    ok('...the line dragged moves the split, not the picture', (await el('now').evaluate(c => c.style.clipPath)) === 'inset(0px 0px 0px 25%)',
        await el('now').evaluate(c => c.style.clipPath))
    await el('split').click(); await frames(3)
    ok('Split off: one picture', !(await el('before').isVisible()) && (await el('now').evaluate(c => c.style.clipPath)) === '')
    await el('clip').click(); await frames(3)
    ok('Clipping: the stripes asked for', (await lastDraw('now')).clipWarn === true)
    await el('clip').click(); await frames(3)
    ok('...and off', (await lastDraw('now')).clipWarn === false)
}

// A LINE OVER THE PICTURE
await p.evaluate(() => CHECK.V.say('Rendering… sample 8 / 64')); await frames(1)
ok('say: a line over the picture', (await el('message').textContent()) === 'Rendering… sample 8 / 64' && await el('message').isVisible())
await p.evaluate(() => CHECK.V.say('')); await frames(1)
ok('...taken away', !(await el('message').isVisible()))

// A DRAW THAT FAILS: said over the picture, once, and gone when one draws again
{
    await p.evaluate(() => { CHECK.fail = 'boom'; CHECK.V.redraw() }); await frames(3)
    ok('a draw that fails: said over the picture', (await el('message').textContent()) === 'The picture could not be drawn: boom' && await el('message').isVisible())
    const logged = errs.filter(e => /could not be drawn/.test(e)).length
    await p.evaluate(() => CHECK.V.redraw()); await frames(3)
    ok('...logged once, not every draw', logged === 1 && errs.filter(e => /could not be drawn/.test(e)).length === 1, errs.join(' | '))
    await p.evaluate(() => { CHECK.fail = null; CHECK.V.redraw() }); await frames(3)
    ok('...and gone when it draws again', !(await el('message').isVisible()))
    errs.splice(0, errs.length, ...errs.filter(e => !/could not be drawn/.test(e)))
}

// A PICTURE AGAIN: the same size keeps its place, another is refitted
{
    await p.keyboard.press('2'); await frames(2)
    const v0 = await view()
    await p.evaluate(pic => CHECK.V.picture(pic), { ...PIC, samples: 256 }); await frames(2)
    const v1 = await view()
    ok('the same size again: the same place, to compare', v1.cx === v0.cx && v1.cy === v0.cy && v1.z === v0.z && !v1.fit)
    await p.evaluate(pic => CHECK.V.picture(pic), { ...PIC, w: 640, h: 480 }); await frames(2)
    ok('another size: Fit', (await view()).fit)
}

// A PICK (0.next): the next click on the picture, a drag still a pan, Esc nothing
{
    await p.keyboard.press('0'); await frames(2)
    const startPick = () => p.evaluate(() => { window.PICKED = undefined; CHECK.V.pick('Click a white').then(v => { window.PICKED = v }) })
    await startPick(); await frames(2)
    ok('a pick: its prompt over the picture, the cursor a crosshair', (await el('message').textContent()) === 'Click a white · Esc to cancel'
        && (await el('stage').evaluate(e => e.style.cursor)) === 'crosshair')
    const v0 = await view()
    await p.mouse.move(box.x + 300, box.y + 200); await p.mouse.down()
    await p.mouse.move(box.x + 360, box.y + 240, { steps: 4 }); await p.mouse.up(); await frames(2)
    ok('...a drag pans, and picks nothing', (await p.evaluate(() => window.PICKED)) === undefined && (await view()).cx !== v0.cx)
    const v1 = await view()
    await p.mouse.click(box.x + 420, box.y + 180); await frames(2)
    const q = pictureAtPoint(v1, fromCss(420, 180, box.height, DPR), res), want = [Math.floor(q[0]), Math.floor(q[1])]
    const got = await p.evaluate(() => window.PICKED)
    ok('...a click picks the picture pixel under it (the buffer\'s numbering)', got && got[0] === want[0] && got[1] === want[1], JSON.stringify({ got, want }))
    ok('...and the prompt goes, the cursor back', !(await el('message').isVisible()) && (await el('stage').evaluate(e => e.style.cursor)) === 'grab')
    await startPick(); await frames(1)
    await p.keyboard.press('Escape'); await frames(2)
    ok('Esc: the pick gives nothing', (await p.evaluate(() => window.PICKED)) === null && !(await el('message').isVisible()))
    await startPick(); await frames(1)
    await p.evaluate(pic => CHECK.V.picture(pic), { ...PIC, samples: 512 }); await frames(2)
    ok('another picture: the pick gives nothing', (await p.evaluate(() => window.PICKED)) === null)
}

// NOTHING KEPT AGAIN
await p.evaluate(() => CHECK.V.picture(null)); await frames(2)
ok('discarded: said again, nothing shown, the buttons greyed', /Nothing rendered yet/.test(await el('message').textContent())
    && !(await el('now').isVisible()) && await el('fit').isDisabled() && (await view()) === null)

ok('no errors', errs.length === 0, errs.join('\n'))
await b.close(); server.close()
console.log(failed ? `\n${failed} FAILED` : '\nall ok')
process.exit(failed ? 1 : 0)
