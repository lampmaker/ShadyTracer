// node tutorial/review/extract.mjs <out-dir> [page ...]
//
// A PAGE AS A READER MEETS IT, for a reader who cannot open a browser: the blank-reader review (tutorial/review/README.md).
// Each page is opened in headless Chromium and written out as <out-dir>/<page>/page.md -- its text in reading order,
// the maths fold-outs open, the code excerpts as the page shows them, each figure's caption, controls and readout, and
// what every underlined word's card says -- with a screenshot of every figure as it starts and after each paragraph
// that moves it (fig-<n>-<step>.png). Nothing about ShadyTracer goes in that the page does not show.
//
// Pages: the written chapters (kit/chapters.js), the contents, the glossary and the styles page, or the ones named.
// Needs Playwright's Chromium, and says so.
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, extname, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execSync } from 'node:child_process'
import { CHAPTERS } from '../kit/chapters.js'
import { GLOSSARY } from '../kit/glossary.js'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
let chromium
try { ({ chromium } = await import('playwright')) } catch {
    try { ({ chromium } = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'playwright/index.mjs')).href)) } catch { }
}
if (!chromium) { console.log('(extract SKIPPED: no playwright. npm i -g playwright to get it.)'); process.exit(0) }
const out = process.argv[2] ? resolve(process.argv[2]) : null
if (!out) { console.log('usage: node tutorial/review/extract.mjs <out-dir> [page ...]'); process.exit(1) }
const PAGES = process.argv.length > 3 ? process.argv.slice(3)
    : [...CHAPTERS.filter(c => c.file).map(c => c.file), 'index.html', 'glossary.html', 'styles.html']

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
const b = await chromium.launch({ args: ['--disable-gpu'] })

for (const page of PAGES) {
    const name = page.replace(/^ch\//, '').replace(/\.html$/, ''), dir = join(out, name)
    await mkdir(dir, { recursive: true })
    const p = await b.newPage({ viewport: { width: 1360, height: 900 } })
    await p.goto(base + page + '?style=notebook')
    await p.waitForFunction(() => document.documentElement.classList.contains('kit-js'), null, { timeout: 5000 }).catch(() => { })
    await p.waitForTimeout(1200)

    // THE FIGURES, as they start and after each paragraph that moves them (clicked, as a reader may)
    const figs = await p.evaluate(() => [...document.querySelectorAll('figure.fig')].map((f, i) => {
        f.dataset.n = i + 1
        const sec = f.closest('section'), name = f.dataset.fig
        return { n: i + 1, steps: sec ? [...sec.querySelectorAll('[data-step]')].map(e => e.dataset.step).filter(s => s.split(':')[0] === name) : [] }
    }))
    const shots = {}
    for (const f of figs) {
        const el = p.locator(`figure.fig[data-n="${f.n}"]`)
        await el.scrollIntoViewIfNeeded(); await p.waitForTimeout(f.steps.length ? 700 : 400)
        const slow = await p.evaluate(n => /room|room3/.test(document.querySelector(`figure.fig[data-n="${n}"]`).dataset.fig), f.n)
        shots[f.n] = []
        if (!f.steps.length) { const file = `fig-${f.n}.png`; await el.screenshot({ path: join(dir, file) }); shots[f.n].push(['as it starts', file]) }
        for (const st of f.steps) {
            // clicked, and clicked again if a paragraph scrolling through the page's reading band took the figure
            // back (the two screenshots of one figure came out the same in round 2 that way)
            const click = () => p.evaluate(([n, s]) => { const fig = document.querySelector(`figure.fig[data-n="${n}"]`); const el = [...fig.closest('section').querySelectorAll(`[data-step="${s}"]`)][0]; el.click(); return el.classList.contains('on') }, [f.n, st])
            await click(); await p.waitForTimeout(300)
            if (!await p.evaluate(([n, s]) => [...document.querySelector(`figure.fig[data-n="${n}"]`).closest('section').querySelectorAll(`[data-step="${s}"]`)][0].classList.contains('on'), [f.n, st])) await click()
            await p.waitForTimeout(slow ? 4000 : 500)
            const file = `fig-${f.n}-${st.split(':')[1]}.png`
            await el.screenshot({ path: join(dir, file) })
            shots[f.n].push([`after the paragraph marked [moves figure ${f.n}: ${st.split(':')[1]}]`, file])
        }
    }

    // THE TEXT, in reading order
    const md = await p.evaluate(({ shots }) => {
        for (const d of document.querySelectorAll('details')) d.open = true
        const used = new Set()
        const txt = el => {
            const c = el.cloneNode(true)
            for (const a of c.querySelectorAll('a[data-g]')) { used.add(a.dataset.g); a.textContent = `${a.textContent}°` }
            for (const a of c.querySelectorAll('a[data-ch]')) a.textContent = `${a.textContent} [link to another chapter${a.classList.contains('planned') ? ', not written yet' : ''}]`
            // a fraction, a power and an index as a reader would say them aloud, not run together
            for (const x of c.querySelectorAll('sup')) x.textContent = '^' + x.textContent
            for (const x of c.querySelectorAll('sub')) x.textContent = '_' + x.textContent
            for (const f of c.querySelectorAll('.frac')) f.textContent = `(${f.children[0]?.textContent ?? ''})/(${f.children[1]?.textContent ?? ''})`
            for (const x of c.querySelectorAll('.n, .tag')) x.textContent = x.textContent + (x.matches('.tag') ? ': ' : ' ')
            // a claim's stamp is said once, by the claim's own line below; a glossary entry's notes apart from its words
            for (const x of c.querySelectorAll('.stamp')) x.remove()
            for (const x of c.querySelectorAll('.where, .see, .read')) x.textContent = ' | ' + x.textContent
            for (const li of c.querySelectorAll('li, dt')) li.textContent = (li.matches('li') ? '\n- ' : '\n') + li.textContent
            for (const dd of c.querySelectorAll('dd')) dd.textContent = ' -- ' + dd.textContent
            // a detached copy's innerText is its textContent: the source's line breaks and indents, which say nothing
            return c.textContent.replace(/[ \t]*\n[ \t]*(?!- )/g, ' ').replace(/[ \t]{2,}/g, ' ').trim()
        }
        const lines = []
        const walk = el => {
            for (const n of el.children) {
                const t = n.tagName.toLowerCase()
                if (n.matches('.kit-bar, .gcard, .kit-offline, .titleblock, nav.tabs, script, style, canvas')) continue
                if (/^h[1-6]$/.test(t)) lines.push(`${'#'.repeat(+t[1])} ${txt(n)}`)
                else if (n.matches('figure.fig')) {
                    const k = n.dataset.n
                    const ctl = [...n.querySelectorAll('.fig-controls > *')].filter(c => !c.hidden).map(c => c.matches('.seg') ? `a choice of: ${[...c.children].map(b => b.innerText.trim()).join(' / ')}` : c.innerText.trim().replace(/\s+/g, ' ')).filter(Boolean)
                    lines.push(`[FIGURE ${k} -- an interactive drawing. Caption: ${n.querySelector('figcaption')?.innerText.trim() ?? ''}`
                        + `\n  Controls under it: ${ctl.join(' | ') || 'none'}\n  Its readout line: ${n.querySelector('.fig-readout')?.innerText.trim() || '(none)'}`
                        + `\n  Screenshots: ${(shots[k] ?? []).map(([w, f]) => `${f} (${w})`).join('; ')}]`)
                }
                else if (n.matches('figure.excerpt')) lines.push(`[CODE from ShadyTracer's source, as the page shows it -- ${txt(n.querySelector('figcaption'))}]\n\`\`\`\n${n.querySelector('pre')?.innerText ?? ''}\n\`\`\``)
                else if (n.matches('details')) { lines.push(`[FOLD-OUT, closed until the reader opens it: ${txt(n.querySelector('summary'))}]`); walk(n.querySelector('.body') ?? n); lines.push('[END OF FOLD-OUT]') }
                else if (n.matches('[data-claim]')) { used.add('claim-' + n.dataset.claim); lines.push(`[STAMPED "${({ measured: 'MEASURED', code: 'READ IN CODE', inferred: 'INFERRED' })[n.dataset.claim]}"°, the stamp a link with a card] ${txt(n)}`) }
                else if (n.matches('aside.refs')) lines.push(`[READING BOX, "${n.querySelector('.tag')?.textContent.trim() ?? ''}": outside sources, each a link that opens another site]\n`
                    + [...n.querySelectorAll('li')].map(li => `- ${li.querySelector('.src-t')?.textContent.trim() ?? '?'} (${li.querySelector('.by')?.textContent.trim() ?? ''}): ${txt(li.querySelector('.why') ?? li)}`).join('\n'))
                else if (n.matches('aside.note')) lines.push(`[NOTE IN THE MARGIN] ${txt(n)}`)
                else if (n.matches('[data-step]')) lines.push(`[moves figure ${n.closest('section')?.querySelector('figure.fig')?.dataset.n ?? '?'}: ${n.dataset.step.split(':')[1]}] ${txt(n)}`)
                else if (n.matches('p, ul, ol, dl, .eyebrow, .lede, pre')) lines.push(txt(n))
                else walk(n)
            }
        }
        walk(document.querySelector('main') ?? document.body)
        return { text: lines.filter(Boolean).join('\n\n'), used: [...used] }
    }, { shots })
    const cards = md.used.map(id => GLOSSARY.find(g => g.id === id)).filter(Boolean)
        .map(g => `- **${g.term}**: ${g.short}`).join('\n')
    await writeFile(join(dir, 'page.md'), `# The page "${page}", as a reader sees it\n\n`
        + `Words marked ° have a dotted underline on the page; hovering or tapping one shows a card. What each card says is at the end.\n`
        + `Paragraphs marked [moves figure n: step] change the figure beside them when the reader scrolls to them.\n\n---\n\n${md.text}\n\n---\n\n## What the cards say (words marked °)\n\n${cards || '(none)'}\n`)
    console.log(`${page}: ${figs.length} figures, ${Object.values(shots).flat().length} screenshots -> ${dir}`)
    await p.close()
}
await b.close(); server.close()
