// node help/test/panel.check.mjs
//
// THE HELP PANEL (help/panel.js), headless, with stand-ins for what its links do (help/test/panel.html): the contents
// listed by track with the first page open and its own headings under it; a page link, back and forward; links that
// open an example, run a command and point at a panel, each handed to the host; one that names nothing said, not
// silent; the search; the last page remembered; an SDF widget drawn and its slider redrawing it. What a page reads like
// is the user's to judge.
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
if (!chromium) { console.log('(help panel check SKIPPED: no playwright. npm i -g playwright to get it.)'); process.exit(0) }

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
const p = await b.newPage({ viewport: { width: 900, height: 600 } })
const errs = []
p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })
let failed = 0
const ok = (n, c, x = '') => { if (!c) failed++; console.log((c ? 'ok    ' : 'FAIL  ') + n + (c ? '' : '  ' + x)) }
const url = `http://localhost:${server.address().port}/help/test/panel.html`
await p.goto(url + "?fresh")
await p.waitForFunction(() => window.CHECK?.H.current, null, { timeout: 5000 }).catch(() => { })
const state = () => p.evaluate(() => ({
    page: CHECK.H.current?.id, h1: document.querySelector('.help-page h1')?.textContent,
    tracks: [...document.querySelectorAll('.help-track')].map(e => e.textContent),
    entries: [...document.querySelectorAll('.help-entry')].map(e => e.dataset.page), on: document.querySelector('.help-entry.on')?.dataset.page,
    subs: document.querySelectorAll('.help-subentry').length, calls: CHECK.calls.slice(),
    back: document.querySelector('.help-btn')?.disabled }))
const click = sel => p.evaluate(sel => { const a = document.querySelector(sel); a?.click(); return !!a }, sel)
const settle = () => p.waitForTimeout(150)

let s = await state()
ok('the first page open: Welcome, its title the page\'s heading', s.page === 'welcome' && s.h1 === 'Welcome to ShadyTracer', JSON.stringify(s))
ok('...the contents by track, every page listed, the open one marked, its headings under it', s.tracks.includes('Start') && s.tracks.includes('Reference')
    && s.entries.includes('ref-shapes') && s.on === 'welcome' && s.subs > 1, JSON.stringify(s))
ok('...nothing to go back to', s.back === true)

// A PAGE LINK, BACK AND FORWARD
ok('a link to another page', await click('.help-page a[href="../modelling/sdf.md"]')); await settle()
s = await state()
ok('...opens it', s.page === 'sdf' && /distance functions/.test(s.h1), JSON.stringify(s))
ok('back', await click('.help-btn[title="Back"]')); await settle()
ok('...the page before', (await state()).page === 'welcome')
ok('forward', await click('.help-btn[title="Forward"]')); await settle()
ok('...the page after', (await state()).page === 'sdf')

// THE WIDGETS on the SDF page: drawn, and a slider redraws
{
    const w = await p.evaluate(() => {
        const cs = [...document.querySelectorAll('canvas.help-sdf')]
        const lit = c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) n++; return n }
        return { n: cs.length, lit: cs.map(lit), sliders: document.querySelectorAll('.help-sdf-controls input').length }
    })
    ok('the SDF page\'s widgets: every one a picture, drawn', w.n >= 5 && w.lit.every(n => n > 1000), JSON.stringify(w))
    ok('...with sliders where the mode has parameters', w.sliders >= 4, JSON.stringify(w))
    const moved = await p.evaluate(() => {
        const c = document.querySelectorAll('canvas.help-sdf')
        const blend = [...document.querySelectorAll('.help-widget')].find(e => e.querySelector('input'))
        const canvas = blend.querySelector('canvas'), input = blend.querySelector('input')
        const before = canvas.toDataURL()
        input.value = input.max; input.dispatchEvent(new Event('input'))
        return { changed: canvas.toDataURL() !== before, n: c.length }
    })
    ok('...a slider moved redraws its picture', moved.changed, JSON.stringify(moved))
}

// LINKS THAT ACT: each handed to the host
await p.evaluate(() => CHECK.H.open('welcome')); await settle()
await p.evaluate(() => { CHECK.calls.length = 0 })
await click('.help-page a[href="example:first-steps.json"]')
await click('.help-page a[href="show:properties"]')
await p.evaluate(() => CHECK.H.follow('cmd:help.contents'))
await p.evaluate(() => CHECK.H.follow('cmd:no.such'))
await p.evaluate(() => CHECK.H.follow('javascript:alert(1)'))
s = await state()
ok('an example link opens the example; a show link points at the panel; a command runs', JSON.stringify(s.calls.slice(0, 3))
    === JSON.stringify([['example', 'first-steps.json'], ['show', 'properties'], ['cmd', 'help.contents']]), JSON.stringify(s.calls))
ok('...one that names nothing is said, not silent; a link it does not follow too', s.calls.some(c => c[0] === 'say' && /no command 'no.such'/.test(c[1]))
    && s.calls.some(c => c[0] === 'say' && /cannot follow/.test(c[1])), JSON.stringify(s.calls))

// SEARCH
{
    const found = await p.evaluate(() => CHECK.H.search('sphere tracing'))
    await settle()
    ok('search: the pages holding every word, listed', found.some(f => f.id === 'sdf') && await p.evaluate(() => document.querySelectorAll('.help-hit').length > 0), JSON.stringify(found))
    const none = await p.evaluate(() => CHECK.H.search('xyzzy plover'))
    ok('...nothing found said', none.length === 0 && await p.evaluate(() => /Nothing found/.test(document.querySelector('.help-page').textContent)))
    await p.evaluate(() => document.querySelector('.help-hit a')?.click())
}

// THE LAST PAGE, remembered
await p.evaluate(() => CHECK.H.open('ref-materials')); await settle()
await p.goto(url)
await p.waitForFunction(() => window.CHECK?.H.current, null, { timeout: 5000 }).catch(() => { })
ok('the last page read opens again', (await state()).page === 'ref-materials')

ok('no page errors', !errs.length, errs.join('\n'))
await b.close(); server.close()
console.log(failed ? `${failed} FAILED` : 'help panel: all passed')
if (failed) process.exit(1)
