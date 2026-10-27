//======================================================================================================================
// Tests for what a search engine and a shared link see. Run: node test/seo.test.mjs
//
// What has to hold, none of it needing a GPU or a browser:
//   the front page (index.html, 0.next)'s head: a title, a description, the canonical address -- the one the README
//     sends people to -- and the Open Graph card, its picture a file here of the size it claims; the JSON-LD parsing,
//     about the same address, and its FAQ the questions and answers the page shows, word for word.
//   the front page's body: every picture one of the README's own (docs/screenshots), its alt and its size the file's,
//     the first one loaded at once and the rest lazily; every link and source a file here; the app linked; a query the
//     app reads (app.html's own keys) sent on to it, and only such a query.
//   docs/screenshots: JPEGs under 1 MB, each one the README or the card shows, and every one they name there.
//   the app (app.html, which was / until 0.next): kept out of search results and the sitemap; its introduction taken
//     away before the shell is made in that element, and nothing started without WebGPU or an adapter.
//   sitemap.xml: the front page, the tutorial's contents and glossary and every chapter written, each a file here,
//     nothing else; every page in it with its own description, a chapter's the line tutorial/kit/chapters.js gives it.
//   robots.txt: the sitemap named, and nothing the app or the tutorial loads disallowed (a crawler that renders the
//     page needs its scripts).
// Every one of these is invisible at run time: a stale sitemap or a wrong card says nothing in the page.
//======================================================================================================================
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHAPTERS } from '../tutorial/kit/chapters.js'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = f => readFileSync(join(repo, f), 'utf8')

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}

// ---- the address: the README's "Run it" -------------------------------------------------------------------------------
const site = /\*\*Run it: <(https:\/\/[^>]+?)\/?>\*\*/.exec(read('README.md'))?.[1]
ok('the README names the site\'s address', !!site)
const SITE = site + '/'
const fileOf = url => url.startsWith(SITE) ? url.slice(SITE.length) : null

// ---- the front page's head ----------------------------------------------------------------------------------------------
const page = read('index.html')
const head = page.slice(0, page.indexOf('</head>'))
const meta = (attr, key) => new RegExp(`<meta ${attr}="${key}" content="([^"]*)">`).exec(head)?.[1]
const title = /<title>([^<]*)<\/title>/.exec(head)?.[1] ?? ''
ok('a title that says what the page is', title.includes('ShadyTracer') && title.length > 'ShadyTracer'.length + 10, title)
const description = meta('name', 'description') ?? ''
ok('a description, 50 to 200 characters', description.length >= 50 && description.length <= 200, `${description.length}: ${description}`)
ok('the canonical address the README\'s', head.includes(`<link rel="canonical" href="${SITE}">`))
const icon = /<link rel="icon" href="([^"]+)"/.exec(head)?.[1]
ok('an icon, a file here', !!icon && existsSync(join(repo, icon)), icon)
ok('og:url the canonical address', meta('property', 'og:url') === SITE, meta('property', 'og:url'))
for (const k of ['og:type', 'og:title', 'og:description', 'og:image:alt']) ok(`${k} given`, !!meta('property', k))
ok('a large card', meta('name', 'twitter:card') === 'summary_large_image')

// the card's picture: on this site, a JPEG here, and the size the tags say (read from its frame header)
const image = meta('property', 'og:image') ?? ''
const imageFile = fileOf(image)
ok('og:image on this site', !!imageFile, image)
const jpegSize = buf => {
    for (let i = 2; i + 9 < buf.length;) {
        if (buf[i] !== 0xff) return null
        const marker = buf[i + 1], len = buf.readUInt16BE(i + 2)
        if (marker >= 0xc0 && marker <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
        i += 2 + len
    }
    return null
}
if (imageFile && existsSync(join(repo, imageFile))) {
    const buf = readFileSync(join(repo, imageFile))
    const size = jpegSize(buf)
    ok('og:image a JPEG', buf[0] === 0xff && buf[1] === 0xd8 && !!size)
    ok('...of the width and height the tags give', size && `${size.w}x${size.h}` === `${meta('property', 'og:image:width')}x${meta('property', 'og:image:height')}`, JSON.stringify(size))
    ok('...under 1 MB: a card is fetched every time a link is shared', buf.length < 1 << 20, `${buf.length} bytes`)
} else ok('og:image a file here', false, imageFile)

// the JSON-LD: it must parse, or a search engine drops it quietly
const lds = [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => {
    try { return JSON.parse(m[1]) } catch (e) { ok('every JSON-LD block parses', false, e.message); return null }
})
const data = lds.find(d => d?.['@type'] === 'SoftwareApplication')
ok('the JSON-LD a SoftwareApplication at the address', data?.url === SITE, JSON.stringify(data?.url))
ok('...with the card\'s picture', data?.image === image)
ok('...its screenshot a file here', !!fileOf(data?.screenshot ?? '') && existsSync(join(repo, fileOf(data.screenshot))), data?.screenshot)

// the FAQ: the questions and answers the page shows, word for word -- Google drops markup that says what the page does not
const plain = html => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
const faqHtml = /<div class="faq">([\s\S]*?)<\/div>/.exec(page)?.[1] ?? ''
const shown = [...faqHtml.matchAll(/<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)].map(m => ({ q: plain(m[1]), a: plain(m[2]) }))
const faq = lds.find(d => d?.['@type'] === 'FAQPage')?.mainEntity ?? []
ok('the FAQ on the page', shown.length >= 5, `${shown.length} questions`)
ok('the FAQ\'s JSON-LD as many questions as the page', faq.length === shown.length, `${faq.length} vs ${shown.length}`)
faq.forEach((e, i) => {
    ok(`FAQ ${i + 1}'s question the page's`, e.name === shown[i]?.q, `${JSON.stringify(e.name)} vs ${JSON.stringify(shown[i]?.q)}`)
    ok(`FAQ ${i + 1}'s answer the page's`, e.acceptedAnswer?.text === shown[i]?.a, `${JSON.stringify(e.acceptedAnswer?.text)}\n      vs ${JSON.stringify(shown[i]?.a)}`)
})

// ---- the front page's body ----------------------------------------------------------------------------------------------
const body = page.slice(page.indexOf('<body>'))
const attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]
const imgs = [...body.matchAll(/<img\b[^>]*>/g)].map(m => m[0]).filter(t => attr(t, 'src') !== 'favicon.svg')
ok('the front page shows the pictures', imgs.length >= 6, `${imgs.length}`)
imgs.forEach((t, i) => {
    const src = attr(t, 'src') ?? ''
    ok(`${src}: one of the README's own pictures`, /^docs\/screenshots\/[a-z-]+\.jpg$/.test(src))
    ok(`${src}: an alt that says what it shows`, (attr(t, 'alt') ?? '').length > 30)
    if (!existsSync(join(repo, src))) return ok(`${src} exists`, false)
    const size = jpegSize(readFileSync(join(repo, src)))
    ok(`${src}: width and height the file's own (${size?.w} x ${size?.h}) -- a picture retaken at another size is these two numbers`,
        size && +attr(t, 'width') === size.w && +attr(t, 'height') === size.h, `the page says ${attr(t, 'width')} x ${attr(t, 'height')}`)
    ok(`${src}: ${i ? 'loaded lazily' : 'the first, loaded at once'}`, i ? attr(t, 'loading') === 'lazy' : !attr(t, 'loading'))
})
// every link and source on it a file here (the address, its anchors and other sites aside)
const locals = [...page.matchAll(/\s(?:href|src)="([^"#]+)(?:#[^"]*)?"/g)].map(m => m[1]).filter(u => !/^(https?:|mailto:)/.test(u))
for (const u of new Set(locals)) {
    const f = u === './' ? 'index.html' : u.endsWith('/') ? u + 'index.html' : u
    ok(`the front page's ${u} a file here`, existsSync(join(repo, f)))
}
ok('...the app linked', locals.includes('app.html'))
ok('...the tutorial linked', locals.includes('tutorial/'))
// its anchors: each a section
for (const [, id] of page.matchAll(/href="#([^"]+)"/g)) ok(`#${id} a section of the page`, page.includes(` id="${id}"`))

// a query the app reads is sent on to it, and only such a query. The app's keys: its start's ?safe (start.js), the picture's
// ?s and ?a (lib/utils.js ctx.Sc), and every key of the Q the page reads its query into (lib/utils.js GU) -- read here from app.html
const app = read('app.html')
const qKeys = [...(/U\.GU\(\{([\s\S]*?)\}\)/.exec(app)?.[1] ?? '').matchAll(/(\w+)\s*:/g)].map(m => m[1])
ok('app.html\'s Q read', qKeys.length >= 5, JSON.stringify(qKeys))
const sent = JSON.parse((/const APP_KEYS = (\[[^\]]*\])/.exec(page)?.[1] ?? '[]').replace(/'/g, '"'))
const appKeys = ['safe', 's', 'a', ...qKeys]
ok('the front page sends on every key the app reads', appKeys.every(k => sent.includes(k)), `missing ${JSON.stringify(appKeys.filter(k => !sent.includes(k)))}`)
ok('...and no other (a shared link\'s ?utm_source= stays here)', sent.every(k => appKeys.includes(k)), `extra ${JSON.stringify(sent.filter(k => !appKeys.includes(k)))}`)
ok('...to app.html, with its query and anchor', page.includes("location.replace('app.html' + location.search + location.hash)"))
ok('...before the page is drawn: in its head', head.includes('const APP_KEYS'))

// ---- docs/screenshots: the README's pictures, and the front page's -----------------------------------------------------
const shots = readdirSync(join(repo, 'docs/screenshots')).filter(f => f !== 'README.md')
const readme = read('README.md')
const named = new Set([...readme.matchAll(/\(docs\/screenshots\/([^)]+)\)/g)].map(m => m[1]))
for (const f of shots) {
    if (!f.endsWith('.jpg')) { ok(`docs/screenshots/${f}: a JPEG`, false, `convert docs/screenshots/${f} -strip -sampling-factor 4:2:0 -quality 85 docs/screenshots/${f.replace(/\.\w+$/, '.jpg')}, then delete it (docs/screenshots/README.md)`); continue }
    const n = statSync(join(repo, 'docs/screenshots', f)).size
    ok(`docs/screenshots/${f} under 1 MB`, n < 1 << 20, `${n} bytes`)
    ok(`docs/screenshots/${f} shown by the README, or the card`, named.has(f) || image.endsWith('/' + f))
}
for (const f of named) ok(`the README's docs/screenshots/${f} a file here`, shots.includes(f))

// ---- the app: a tool, not the page to find ------------------------------------------------------------------------------
ok('app.html kept out of search results', app.includes('<meta name="robots" content="noindex">'))
const container = /<div class="content" id="container">([\s\S]*?)\n    <\/div>/.exec(app)?.[1] ?? ''
ok('app.html\'s #container holds the introduction', /<main class="about" id="about">/.test(container))
ok('...a noscript line', container.includes('<noscript>'))
ok('...the front page linked', container.includes('href="./"'))
const module = app.slice(app.indexOf('<script type="module">'))
const at = s => module.indexOf(s)
const probe = at('if (!navigator.gpu || !(await navigator.gpu.requestAdapter()')
ok('the module stops without WebGPU or an adapter, before the introduction goes and the shell is made',
    probe > 0 && probe < at("document.getElementById('about')?.remove()") && probe < at('createShell(container'))
ok('the introduction taken away before the shell is made in its element',
    at("document.getElementById('about')?.remove()") > 0 && at("document.getElementById('about')?.remove()") < at('createShell(container'))

// ---- sitemap.xml ------------------------------------------------------------------------------------------------------
const sitemap = read('sitemap.xml')
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1])
const written = CHAPTERS.filter(c => c.file && existsSync(join(repo, 'tutorial', c.file)))
const want = ['', 'tutorial/', 'tutorial/glossary.html', ...written.map(c => `tutorial/${c.file}`)]
const have = locs.map(fileOf)
ok('every sitemap address on this site', have.every(f => f !== null), locs.filter(l => fileOf(l) === null).join(' '))
const missing = want.filter(f => !have.includes(f)), extra = have.filter(f => f !== null && !want.includes(f))
ok('the sitemap the app, the tutorial\'s contents and glossary and every chapter written: no more, no less',
    !missing.length && !extra.length && have.length === new Set(have).size,
    `missing ${JSON.stringify(missing)}, not expected ${JSON.stringify(extra)} -- a chapter written is a <url> added to sitemap.xml`)
const pageFile = f => f === '' ? 'index.html' : f.endsWith('/') ? f + 'index.html' : f
for (const f of want.slice(1)) {
    const p = pageFile(f)
    if (!existsSync(join(repo, p))) { ok(`${p} exists`, false); continue }
    const d = /<meta name="description" content="([^"]*)">/.exec(read(p))?.[1]
    ok(`${p} has a description`, !!d)
}
for (const c of written) {
    const d = /<meta name="description" content="([^"]*)">/.exec(read(`tutorial/${c.file}`))?.[1]
    ok(`tutorial/${c.file}'s description its line in chapters.js`, d === c.line, `${JSON.stringify(d)} vs ${JSON.stringify(c.line)}`)
}
ok('the styles page kept out of the index', read('tutorial/styles.html').includes('<meta name="robots" content="noindex">'))

// ---- robots.txt -------------------------------------------------------------------------------------------------------
const robots = read('robots.txt')
ok('robots.txt names the sitemap', robots.includes(`Sitemap: ${SITE}sitemap.xml`))
const rules = [...robots.matchAll(/^Disallow:\s*(\S+)/gm)].map(m => new RegExp('^' + m[1].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')))
const blocked = path => rules.some(r => r.test(path))
// what the app and the tutorial load: the page's own imports and links, the modules each of those imports in turn
const loaded = new Set(), queue = []
const take = (from, spec) => {
    if (!/^\.{1,2}\//.test(spec)) return
    const path = new URL(spec, `http://x/${from}`).pathname.slice(1)
    if (!loaded.has(path) && existsSync(join(repo, path))) { loaded.add(path); if (path.endsWith('.js')) queue.push(path) }
}
const refs = text => [...text.matchAll(/(?:from\s*|import\s*\(\s*|import\s+|src=|href=)["'`](\.{1,2}\/[^"'`]+|[a-z][\w./-]*\.(?:js|css|svg|html))["'`]/g)].map(m => m[1].startsWith('.') ? m[1] : './' + m[1])
for (const p of ['index.html', 'app.html', ...want.slice(1).map(pageFile)]) for (const s of refs(read(p))) take(p, s)
while (queue.length) { const f = queue.pop(); for (const s of refs(read(f))) take(f, s) }
ok('the pages\' loads found', loaded.size > 50, `${loaded.size}`)
const hit = [...loaded].filter(p => blocked('/' + p))
ok('nothing the app or the tutorial loads disallowed', !hit.length, hit.slice(0, 5).join(' '))
for (const p of ['/', '/index.html', '/app.html', '/tutorial/', ...want.map(f => '/' + f)]) ok(`${p} not disallowed`, !blocked(p))

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
