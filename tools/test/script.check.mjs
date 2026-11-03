// node tools/test/script.check.mjs
//
// THE SCRIPT PANEL IN A BROWSER (0.82.0): tools/test/script.html -- the panel over two scenes that keep their script
// through the builder's model -- driven headless. The application's page stops at WebGPU here, so without this the
// panel was code nothing ran. It checks: the scene's script in the editor and the line saying the scene has one; what is
// typed kept into the scene shown at once; another scene shown, its script (and none for one without); ▶ Run printing
// what the script logs and returns, a setting set; an error with its line, that line selected; ■ Stop ending a loop at
// its next await, its finally run; Ctrl Enter running; Tab indenting; an example put in only once its question is
// answered yes; files.save a real download. The colours under the text: the same text, in the same font and box, a
// comment and the API's names coloured, scrolled with the editor, an error's line marked in the gutter until an edit. A
// setting dragged from the Parameters panel by its name: its binding on an empty line, its call inside code, the result
// running; the row's ⧉ copying its path. The Reference pane: ? opens it beside the editor (under it when narrow), a word
// finding the names that have it, an example's insert putting it in on a line of its own, open kept over a reload. What the API does to a real picture is the user's to see.
//
// OPTIONAL, AND LOUD ABOUT IT: it needs Playwright's Chromium.
/* global CHECK -- the page's own, read inside page.evaluate() */
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
if (!chromium) { console.log('(script panel check SKIPPED: no playwright. npm i -g playwright to get it.)'); process.exit(0) }

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
const port = server.address().port

const b = await chromium.launch({ args: ['--disable-gpu'] })
const ctx = await b.newContext({ viewport: { width: 1100, height: 700 }, acceptDownloads: true })
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'])
const p = await ctx.newPage()
const errs = []
p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/\[script\]/.test(m.text())) errs.push(m.text().slice(0, 300)) })
let failed = 0
const ok = (n, c, x = '') => { if (!c) failed++; console.log((c ? 'ok    ' : 'FAIL  ') + n + (c ? '' : '  ' + x)) }
const out = () => p.evaluate(() => CHECK.panel.output())
const until = async (fn, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await p.waitForTimeout(30) } return false }
try {
    await p.goto(`http://localhost:${port}/tools/test/script.html`); await p.waitForTimeout(300)
    const ed = p.locator('.rt-script-code')
    ok('the scene\'s script in the editor', await ed.inputValue() === 'log("from A")', await ed.inputValue())
    ok('...and the line says the scene has one', (await p.locator('.rt-script-bar .state').textContent()) === 'this scene has a script')

    await ed.fill('params.set("scene/n4/radius", 7)\nlog("radius", params.get("scene/n4/radius"))\nreturn 41 + 1')
    ok('what is typed is kept into the scene shown at once', await p.evaluate(() => CHECK.scriptOf('a')).then(t => t.startsWith('params.set')))
    await p.click('.rt-script-bar .run')
    ok('▶ Run prints what it logs and returns', await until(async () => (await out()).includes('→ 42')), JSON.stringify(await out()))
    ok('...the log line', (await out()).includes('radius 7'))
    ok('...and the setting was set', await p.evaluate(() => CHECK.S.radius) === 7)

    await p.evaluate(() => CHECK.show('b'))
    ok('another scene shown: its script (none)', await ed.inputValue() === '' && (await p.locator('.rt-script-bar .state').textContent()) === 'no script in this scene')
    await p.evaluate(() => CHECK.show('a'))
    ok('...and back: A\'s again', (await ed.inputValue()).startsWith('params.set'))

    await ed.fill('const x = 1\nlog("before")\nnull.boom')
    await p.click('.rt-script-bar .run')
    ok('an error is said with its line', await until(async () => (await out()).some(l => /TypeError: .*\(line 3\)/.test(l))), JSON.stringify((await out()).slice(-3)))
    const sel = await ed.evaluate(e => e.value.slice(e.selectionStart, e.selectionEnd))
    ok('...and that line selected in the editor', sel === 'null.boom', sel)

    await ed.fill('try { for (;;) { camera.set({ azimuth: 90 }); await sleep(20) } } finally { camera.set({ azimuth: 5 }); log("put back") }')
    await ed.focus()
    await p.keyboard.press('Control+Enter')
    ok('Ctrl Enter runs it', await until(() => p.evaluate(() => CHECK.panel.running)))
    ok('...Run greyed and Stop not while it runs', await p.locator('.rt-script-bar .run').isDisabled() && !(await p.locator('.rt-script-bar .stop').isDisabled()))
    await p.waitForTimeout(100)
    await p.click('.rt-script-bar .stop')
    ok('■ Stop ends the loop at its next await', await until(async () => (await out()).some(l => /^■ stopped/.test(l))), JSON.stringify((await out()).slice(-3)))
    ok('...its finally run', (await out()).includes('put back') && await p.evaluate(() => CHECK.cam.azimuth) === 5)

    await ed.fill('')
    await ed.focus()
    await p.keyboard.press('Tab')
    await p.keyboard.type('x')
    ok('Tab indents in the editor', await ed.inputValue() === '    x', JSON.stringify(await ed.inputValue()))

    // an example: asked first when the editor holds a script, refused and accepted
    p.once('dialog', d => d.dismiss())
    await p.selectOption('.rt-script-bar .examples', 'settings')
    ok('an example over a script is asked first: no, nothing replaced', await ed.inputValue() === '    x')
    p.once('dialog', d => d.accept())
    await p.selectOption('.rt-script-bar .examples', 'settings')
    ok('...yes, the example in', (await ed.inputValue()).startsWith('// Every setting has a path'))
    ok('...and kept into the scene', (await p.evaluate(() => CHECK.scriptOf('a'))).startsWith('// Every setting has a path'))

    await ed.fill('files.save("numbers.csv", [["x", "y"], [1, 2]])')
    const dl = p.waitForEvent('download', { timeout: 3000 })
    await p.click('.rt-script-bar .run')
    const d = await dl.catch(() => null)
    ok('files.save downloads the file under its name', d?.suggestedFilename() === 'numbers.csv', d?.suggestedFilename())
    if (d) { const path = await d.path(); ok('...its rows as CSV', (await readFile(path, 'utf8')) === 'x,y\n1,2\n') }

    // THE COLOURS: the layer under the textarea draws its text, laid out as the textarea lays it out
    const long = Array.from({ length: 80 }, (_, i) => `// line ${i + 1}\nlog("value", params.get("scene/n4/radius") * ${i})`).join('\n')
    await ed.fill(long)
    await p.waitForTimeout(50)
    const L = await p.evaluate(() => {
        const ta = document.querySelector('.rt-script-code'), hl = document.querySelector('.rt-script-hl')
        const cs = e => { const c = getComputedStyle(e); return [c.fontFamily, c.fontSize, c.lineHeight, c.paddingTop, c.paddingLeft, c.tabSize, c.whiteSpace, c.letterSpacing] }
        const a = ta.getBoundingClientRect(), b = hl.getBoundingClientRect()
        return { text: hl.textContent, value: ta.value, same: JSON.stringify(cs(ta)) === JSON.stringify(cs(hl)), at: [a.left - b.left, a.top - b.top],
                 kinds: [...new Set([...hl.querySelectorAll('span')].map(x => x.className))], textColour: getComputedStyle(ta).color }
    })
    ok('the colours draw the editor\'s text exactly', L.text === L.value + '\n\n')
    ok('...in the same font, line height, padding and tabs, at the same place', L.same && L.at[0] === 0 && L.at[1] === 0, JSON.stringify(L.at))
    ok('...comments, strings, numbers, the API\'s names and calls coloured', ['hl-com', 'hl-str', 'hl-num', 'hl-api', 'hl-fn'].every(k => L.kinds.includes(k)), L.kinds.join(' '))
    ok('...and the textarea\'s own text transparent over them', /rgba\(0, 0, 0, 0\)|transparent/.test(L.textColour), L.textColour)
    await ed.evaluate(e => { e.scrollTop = 600; e.dispatchEvent(new Event('scroll')) })
    await p.waitForTimeout(30)
    const scr = await p.evaluate(() => [document.querySelector('.rt-script-code').scrollTop, document.querySelector('.rt-script-hl').scrollTop, document.querySelector('.rt-script-gutter').scrollTop])
    ok('...scrolled with the editor, the line numbers too', scr[0] > 0 && scr[0] === scr[1] && scr[1] === scr[2], JSON.stringify(scr))
    await ed.evaluate(e => { e.scrollTop = e.scrollHeight; e.dispatchEvent(new Event('scroll')) })
    await p.waitForTimeout(30)
    const end = await p.evaluate(() => [document.querySelector('.rt-script-code').scrollTop, document.querySelector('.rt-script-hl').scrollTop])
    ok('...to the very end', end[0] === end[1], JSON.stringify(end))
    await ed.fill('log(1)\nnull.boom')
    await p.click('.rt-script-bar .run')
    ok('an error\'s line marked in the gutter', await until(() => p.evaluate(() => document.querySelector('.rt-script-gutter .err')?.textContent === '2')))
    await ed.press('End'); await p.keyboard.type(' ')
    ok('...until the next edit', await until(() => p.evaluate(() => !document.querySelector('.rt-script-gutter .err'))))
    await ed.fill(await p.evaluate(() => CHECK.example('lens')))

    // THE REFERENCE PANE
    ok('the reference is closed at first', !(await p.locator('.rt-script-ref').isVisible()))
    await p.click('.rt-script-bar .ref')
    ok('? opens it beside the editor', await p.locator('.rt-script-ref').isVisible()
        && await p.evaluate(() => { const r = document.querySelector('.rt-script-ref').getBoundingClientRect(), e = document.querySelector('.rt-script-edit').getBoundingClientRect(); return r.left >= e.right - 1 }))
    await p.fill('.rt-script-ref > input', 'flux within')
    const found = await p.evaluate(() => [...document.querySelectorAll('.rt-script-ref .item')].filter(i => !i.hidden).map(i => i.querySelector('.sig').textContent))
    ok('a search finds the names with those words, and only those', found.includes('a.fluxWithin(angle)') && found.length < 8, JSON.stringify(found))
    await ed.fill('log(1)\nlog(2)')
    await ed.evaluate(e => e.setSelectionRange(3, 3))
    await p.locator('.rt-script-ref .item').filter({ hasText: 'a.fluxWithin(angle)' }).locator('.ex button').click()
    const after = await ed.inputValue()
    ok('insert puts its example in at the caret, on a line of its own', after.startsWith('log\nlog(\'within 10°:\'') && after.endsWith('\n(1)\nlog(2)'), JSON.stringify(after))
    ok('...kept into the scene', (await p.evaluate(() => CHECK.scriptOf('a'))) === after)
    await p.fill('.rt-script-ref > input', 'zzzz nothing')
    ok('a search with no match says so', await p.locator('.rt-script-ref-none').isVisible())
    await p.fill('.rt-script-ref > input', '')
    if (process.env.SHOT) { await ed.fill(await p.evaluate(() => CHECK.example('beam'))); await p.fill('.rt-script-ref > input', 'beam'); await p.locator('#panel').screenshot({ path: process.env.SHOT }) }
    await p.setViewportSize({ width: 900, height: 700 })
    await p.evaluate(() => { document.getElementById('panel').style.width = '480px' })
    await p.waitForTimeout(100)
    ok('in a narrow panel it goes under the editor', await p.evaluate(() => { const r = document.querySelector('.rt-script-ref').getBoundingClientRect(), e = document.querySelector('.rt-script-edit').getBoundingClientRect(); return r.top >= e.bottom - 1 }))
    await p.reload(); await p.waitForTimeout(300)
    ok('open is kept over a reload', await p.locator('.rt-script-ref').isVisible())

    // A SETTING DRAGGED IN from the Parameters panel by its name, and its path copied by the row's ⧉
    await ed.fill('log(1)\n\nconst r = ')
    const row = n => p.locator('.shell-param').filter({ hasText: n }).locator('.shell-param-label')
    const box = await ed.boundingBox()
    // the empty second line: 6 px of padding, then a line of 12 x 1.45 px
    await row('position').dragTo(ed, { targetPosition: { x: 30, y: 6 + 17.4 * 1.5 } })
    ok('dropped on an empty line: its binding there', (await ed.inputValue()).split('\n')[1] === "const lensPosition = param('scene/n4/transform/position')   // lens › position", JSON.stringify(await ed.inputValue()))
    await row('radius').dragTo(ed, { targetPosition: { x: box.width - 20, y: 6 + 17.4 * 2.5 } })
    ok('...after `const r = `: its call alone', (await ed.inputValue()).split('\n')[2] === "const r = param('scene/n4/radius')", JSON.stringify(await ed.inputValue()))
    ok('...kept into the scene', (await p.evaluate(() => CHECK.scriptOf('a'))).includes("const r = param('scene/n4/radius')"))
    await ed.press('Control+End')
    await p.keyboard.type('\nlensPosition.value = [1, 2, 4]\nreturn [lensPosition[2], r * 1]')
    await p.click('.rt-script-bar .run')
    ok('...and it runs: the setting set and read by its handle', await until(async () => (await out()).includes(`→ [4, ${await p.evaluate(() => CHECK.S.radius)}]`)), JSON.stringify((await out()).slice(-2)))
    ok('...the position written', JSON.stringify(await p.evaluate(() => CHECK.S.pos)) === '[1,2,4]')
    await p.locator('.shell-param').filter({ hasText: 'radius' }).hover()
    await p.locator('.shell-param').filter({ hasText: 'radius' }).locator('.shell-param-copy').click()
    ok('the row\'s ⧉ copies its path', await until(async () => (await p.evaluate(() => navigator.clipboard.readText())) === 'scene/n4/radius'))
    ok('...and says so', (await p.evaluate(() => CHECK.said())) === 'copied scene/n4/radius')

    ok('no page errors', !errs.length, errs.join(' | '))
} catch (e) { failed++; console.log('FAIL  ' + (e.stack || e)) }
finally { await b.close(); server.close() }
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exit(failed ? 1 : 0)
