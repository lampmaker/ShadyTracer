// node lib/pathtracer/test/savesize.check.mjs
//
// THE SAVE'S SIZE ROWS IN A BROWSER (savesize.js over the real PropertyTable, the page's refresh one a frame), with
// the view an odd size, as a window often is. Two bugs the user met in the Save an image box:
// - with "match view aspect" on, a width typed set the sizes climbing, frame after frame, and never stopping. fix()
//   wrote the height; a frame later the refresh brought it back to its row, whose change handler ran fix('h'), which
//   wrote the width from it -- off by the rounding -- whose row's handler wrote the height again...
// - with it off, a height of 1000 typed became 1001. Tweakpane's step snaps to multiples of 2 counted from the
//   value the row was BOUND with (tweakpane-4.0.4.js StepConstraint, its origin the initial value): the view's height,
//   721, so every height was odd.
// So: typed sizes kept as typed, both ways; the sizes settled (no fix after the frames that follow a change); the
// height following the width at the view's aspect; the live size, even.
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
if (!chromium) { console.log('(save size check SKIPPED: no playwright. npm i -g playwright to get it.)'); process.exit(0) }

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
await p.goto(`http://localhost:${server.address().port}/lib/pathtracer/test/savesize.html`)
await p.waitForFunction(() => window.CHECK && document.querySelectorAll('#p .tp-lblv').length > 0, null, { timeout: 5000 })

const row = label => p.locator('#p .tp-lblv').filter({ has: p.locator('.tp-lblv_l', { hasText: new RegExp(`^${label}$`) }) })
// typed as a person does: the field, the number, Enter
const type = async (label, v) => { const i = row(label).locator('input'); await i.fill(String(v)); await i.press('Enter') }
const frames = n => p.evaluate(n => new Promise(r => { const go = k => k ? requestAnimationFrame(() => go(k - 1)) : r(); go(n) }), n)
const sizes = () => p.evaluate(() => ({ w: CHECK.SV.width, h: CHECK.SV.height, fixes: CHECK.fixes() }))
const shown = async label => Number(await row(label).locator('input').inputValue())
/* settled: the fixes stop. 30 frames is far more than a fix's echo needs (one a frame); the bug ran forever */
const settled = async () => { await frames(5); const a = await sizes(); await frames(30); const z = await sizes(); return { ...z, still: a.fixes === z.fixes && a.w === z.w && a.h === z.h } }

{
    const s = await sizes()
    ok('the live size, even, the height the view\'s aspect', s.w % 2 === 0 && s.h % 2 === 0 && Math.abs(s.w / s.h - 1279 / 721) < 0.01, JSON.stringify(s))
}
// MATCHED: a width typed, the height follows, and it all stops
for (const w of [1000, 1920, 777, 3000]) {
    await type('width', w)
    const s = await settled()
    const want = Math.round(w / 2) * 2
    ok(`matched: width ${w} typed, settled`, s.still, JSON.stringify(s))
    ok(`matched: width ${w} typed stays ${want}`, s.w === want, JSON.stringify(s))
    ok(`matched: the height at the view's aspect (${s.h})`, Math.abs(s.h - want * 721 / 1279) <= 2 && s.h % 2 === 0, JSON.stringify(s))
    ok(`matched: the rows show it`, await shown('width') === s.w && await shown('height') === s.h)
}
{
    await type('height', 600)
    const s = await settled()
    ok('matched: height 600 typed, settled, kept, the width following', s.still && s.h === 600 && Math.abs(s.w - 600 * 1279 / 721) <= 2, JSON.stringify(s))
}
// FREE: each as typed
await row('match view aspect').locator('label').click()
await frames(3)
ok('match view off', await p.evaluate(() => CHECK.SV.matchView === false))
for (const [w, h] of [[1000, 1000], [1001, 999], [640, 480]]) {
    await type('width', w); await type('height', h)
    const s = await settled()
    const W = Math.round(w / 2) * 2, H = Math.round(h / 2) * 2
    ok(`free: ${w} x ${h} typed is ${W} x ${H}, settled`, s.still && s.w === W && s.h === H, JSON.stringify(s))
    ok(`free: the rows show it`, await shown('width') === W && await shown('height') === H)
}
// THE LIVE SIZE from an odd view: even, and settled
await p.evaluate(() => { CHECK.VIEW.w = 1023; CHECK.VIEW.h = 767; CHECK.useLive() })
{
    const s = await settled()
    ok('the live size from 1023 x 767: 1024 x 768, settled', s.still && s.w === 1024 && s.h === 768, JSON.stringify(s))
}
ok('no errors', errs.length === 0, errs.join('\n'))
await b.close(); server.close()
console.log(failed ? `\n${failed} FAILED` : '\nall ok')
process.exit(failed ? 1 : 0)
