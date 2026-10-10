// node test/diagnose.check.mjs
//
// STALE FILES, FOUND AND FIXED (diagnose.js), in headless Chromium. A module served
// with a max-age -- or with none, where Chrome reuses a file for a tenth of its age -- is taken from the
// cache on a reload without asking the server, so after an update the page runs the old module with the
// new: what an incognito window (an empty cache) did not do. This makes that happen on purpose: a page
// imports v.js, the server's v.js changes, a reload keeps the old one. Then staleFiles() must name it,
// reloadFresh() must bring the new one, and a clean page must report nothing stale.
//
// OPTIONAL, AND LOUD ABOUT IT, as lib/shell/test/example.check.mjs is: it needs Playwright's Chromium.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execSync } from 'node:child_process'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let chromium
try { ({ chromium } = await import('playwright')) } catch {
    try { ({ chromium } = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'playwright/index.mjs')).href)) } catch { }
}
if (!chromium) { console.log('(diagnose check SKIPPED: no playwright. npm i -g playwright to get it.)'); process.exit(0) }

let version = 1
const PAGE = `<!DOCTYPE html><meta charset="utf-8"><script type="module">
import { v } from './v.js'
import * as D from '/diagnose.js'
window.T = { v, D }
</script>`
const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (path === '/fresh/page.html') { res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); return res.end(PAGE) }
    // the module the update changes: cacheable for ten minutes, no validator -- a reload reuses it unasked
    if (path === '/fresh/v.js') { res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'max-age=600' }); return res.end(`export const v = ${version}\n`) }
    try {
        const file = join(repo, path)
        if (!file.startsWith(repo)) throw new Error('outside')
        res.writeHead(200, { 'content-type': extname(file) === '.js' ? 'text/javascript' : 'application/octet-stream', 'cache-control': 'no-store' })
        res.end(await readFile(file))
    } catch { res.writeHead(404); res.end() }
})
await new Promise(r => server.listen(0, r))
const U = `http://localhost:${server.address().port}/fresh/page.html`

const b = await chromium.launch({ args: ['--disable-gpu'] })
const p = await (await b.newContext()).newPage()
const errs = []
p.on('pageerror', e => errs.push('pageerror: ' + e.message))
let failed = 0
const ok = (n, c, x = '') => { if (!c) failed++; console.log((c ? 'ok    ' : 'FAIL  ') + n + (c ? '' : '  ' + x)) }
const ready = () => p.waitForFunction(() => window.T, null, { timeout: 5000 })

await p.goto(U); await ready()
ok('first load: the module as served', await p.evaluate(() => T.v) === 1)
ok('...and nothing stale', (await p.evaluate(() => T.D.staleFiles())).length === 0)

version = 2                                  // the update
await p.reload(); await ready()
const kept = await p.evaluate(() => T.v)
ok('a reload keeps the cached module though the server changed it (the fault, made on purpose)', kept === 1, `v ${kept}`)
const cached = await p.evaluate(() => T.D.cachedFiles())
ok('cachedFiles() names it as taken from the cache unasked', cached.some(u => u.endsWith('/fresh/v.js')), JSON.stringify(cached))
const stale = await p.evaluate(() => T.D.staleFiles())
ok('staleFiles() finds it differs from the server\'s', stale.length === 1 && stale[0].endsWith('/fresh/v.js'), JSON.stringify(stale))
const text = await p.evaluate(() => T.D.report({}))
ok('the report says STALE and names it', /STALE/.test(text) && /\/fresh\/v\.js/.test(text), text)

await Promise.all([p.waitForNavigation(), p.evaluate(u => T.D.reloadFresh(u), stale)])
await ready()
ok('reloadFresh() brings the server\'s copy', await p.evaluate(() => T.v) === 2)
ok('...and nothing is stale after it', (await p.evaluate(() => T.D.staleFiles())).length === 0)

if (errs.length) failed++
console.log(errs.join('\n') || 'no page errors'); await b.close(); server.close()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
