// node tutorial/test/pages.check.mjs [screenshot-dir]
//
// THE TUTORIAL IN A BROWSER, headless: every page, in every style and both themes, loads with no error; every figure's
// canvas has ink; every excerpt was found in today's source; a figure moved from the keyboard redraws; a paragraph's
// step moves its figure; the theme chosen survives a reload. Whether a page looks good is the user's to judge; with a
// directory given, a screenshot of each page goes there to help.
//
// Each style's faces are reported as loaded or not (they are the repository's, kit/fonts): a screenshot in fallback
// faces is not the style, and should not be passed off as it.
//
// OPTIONAL, AND LOUD ABOUT IT, as the repository's other checks: it needs Playwright's Chromium.
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { join, extname, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execSync } from 'node:child_process'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
let chromium
try { ({ chromium } = await import('playwright')) } catch {
    try { ({ chromium } = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'playwright/index.mjs')).href)) } catch { }
}
if (!chromium) { console.log('(tutorial pages check SKIPPED: no playwright. npm i -g playwright to get it.)'); process.exit(0) }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json', '.md': 'text/plain' }
const server = createServer(async (req, res) => {
    try {
        const path = join(repo, decodeURIComponent(new URL(req.url, 'http://x').pathname))
        if (!path.startsWith(repo)) throw new Error('outside')
        res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
        res.end(await readFile(path))
    } catch { res.writeHead(404); res.end() }
})
await new Promise(r => server.listen(0, r))
const base = `http://localhost:${server.address().port}/tutorial/`
const shots = process.argv[2] ? resolve(process.argv[2]) : null
if (shots) await mkdir(shots, { recursive: true })

// every written chapter, from the contents: a list typed here once covered the first three and nothing after them
const { CHAPTERS } = await import('../kit/chapters.js')
const PAGES = ['index.html', 'glossary.html', 'styles.html', ...CHAPTERS.filter(c => c.file).map(c => c.file)]
const { STYLES: LIST } = await import('../kit/styles.js')
const STYLES = Object.fromEntries(LIST.map(st => [st.id, st.face]))      // every style there is, and a face of it to check loaded
let failed = 0
const ok = (n, c, x = '') => { if (!c) failed++; console.log((c ? 'ok    ' : 'FAIL  ') + n + (c ? '' : '  ' + x)) }

const b = await chromium.launch({ args: ['--disable-gpu'] })
for (const theme of ['light', 'dark']) for (const [style, face] of Object.entries(STYLES)) {
    const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, colorScheme: theme })
    const p = await ctx.newPage()
    const errs = []
    p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 240)) })
    let fontsSaid = false
    for (const page of PAGES) {
        errs.length = 0
        await p.goto(base + page + `?style=${style}`)
        await p.waitForFunction(() => document.documentElement.classList.contains('kit-js'), null, { timeout: 5000 }).catch(() => { })
        await p.waitForTimeout(900)
        const s = await p.evaluate(async () => {
            await document.fonts.ready
            const ink = [...document.querySelectorAll('.fig-canvas canvas')].map(c => {
                const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
                let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 0) n++
                return n
            })
            return { style: document.documentElement.dataset.style, ink, failedExcerpts: document.querySelectorAll('.excerpt.failed').length,
                excerpts: document.querySelectorAll('figure.excerpt').length, pending: document.querySelectorAll('pre[data-src]').length,
                brokenTerms: document.querySelectorAll('.broken').length, noFigure: document.querySelectorAll('.fig-noscript').length }
        })
        const tag = `${theme} ${style} ${page}`
        ok(`${tag}: no errors`, !errs.length, errs.join(' | '))
        ok(`${tag}: in the style asked for`, s.style === style, s.style)
        ok(`${tag}: every figure mounted and drawn`, !s.noFigure && s.ink.every(n => n > 50), JSON.stringify(s.ink))
        ok(`${tag}: every excerpt found`, !s.failedExcerpts && !s.pending, `${s.failedExcerpts} failed, ${s.pending} never replaced`)
        ok(`${tag}: no broken glossary or chapter link`, !s.brokenTerms)
        if (!fontsSaid) {
            const loaded = await p.evaluate(f => document.fonts.check(f), face)
            console.log(`${loaded ? 'fonts ' : 'NOTE  '} ${style}: ${face} ${loaded ? 'loaded' : 'NOT loaded -- screenshots show fallback faces'}`)
            fontsSaid = true
        }
        if (shots) await p.screenshot({ path: join(shots, `${style}-${theme}-${page.replace(/\//g, '_').replace('.html', '')}.png`) })
    }

    if (theme === 'light' && style === 'notebook') {
        // THE KEYBOARD MOVES A FIGURE: the first figure's first handle, by the arrow keys
        await p.goto(base + 'ch/rays.html')
        await p.waitForTimeout(800)
        const sig = () => p.evaluate(() => { const c = document.querySelector('.fig-canvas canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) | 0; return h })
        const before = await sig()
        await p.focus('.fig-canvas canvas')
        for (let i = 0; i < 6; i++) await p.keyboard.press('ArrowUp')
        await p.waitForTimeout(300)
        ok('a figure moved from the keyboard redraws', (await sig()) !== before)
        // A STEP: clicking the paragraph that switches the room to the lamp's side changes the readout
        await p.click('[data-step="scene:forward"]')
        await p.waitForTimeout(300)
        const readouts = await p.evaluate(() => [...document.querySelectorAll('.fig-readout')].map(e => e.textContent).join(' | '))
        ok('a paragraph\'s step moves its figure', /left the lamp/.test(readouts), readouts)
        // THE THEME IS KEPT: dark chosen, a reload, still dark
        await p.click('.kit-bar > button.kbtn')
        const t1 = await p.evaluate(() => document.documentElement.dataset.theme)
        await p.reload(); await p.waitForTimeout(500)
        ok('the theme chosen survives a reload', t1 === 'dark' && await p.evaluate(() => document.documentElement.dataset.theme) === 'dark', t1)
        // THE STYLE MENU: a style chosen by name is the page's, and kept over a reload
        await p.selectOption('#kit-style', 'drafting'); await p.reload(); await p.waitForTimeout(400)
        ok('a style chosen from the menu is kept over a reload', await p.evaluate(() => document.documentElement.dataset.style === 'drafting' && document.getElementById('kit-style').value === 'drafting'))
        await p.selectOption('#kit-style', 'notebook')
        // A GLOSSARY TERM'S CARD, on hover
        await p.hover('a[data-g="pixel"]'); await p.waitForTimeout(200)
        ok('a glossary term shows its card', await p.evaluate(() => { const c = document.querySelector('.gcard'); return !!c && !c.hidden && /dot of the picture/.test(c.textContent) }))
    }
    await ctx.close()
}
await b.close(); server.close()
console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
