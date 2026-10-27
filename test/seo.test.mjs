//======================================================================================================================
// Tests for what a search engine and a shared link see. Run: node test/seo.test.mjs
//
// What has to hold, none of it needing a GPU or a browser:
//   index.html's head: a title, a description, the canonical address -- the one the README sends people to -- and the
//     Open Graph card, its picture a file here of the size it claims; the JSON-LD parsing, about the same address.
//   the introduction in #container (what a crawler reads, having no WebGPU): a heading and the tutorial linked; taken
//     away before the shell is made in that element, and nothing started without navigator.gpu.
//   sitemap.xml: the app, the tutorial's contents and glossary and every chapter written, each a file here, nothing
//     else; every page in it with its own description, a chapter's the line tutorial/kit/chapters.js gives it.
//   robots.txt: the sitemap named, and nothing the app or the tutorial loads disallowed (a crawler that renders the
//     page needs its scripts).
// Every one of these is invisible at run time: a stale sitemap or a wrong card says nothing in the page.
//======================================================================================================================
import { readFileSync, existsSync } from 'node:fs'
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

// ---- index.html's head ------------------------------------------------------------------------------------------------
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
const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(head)?.[1]
let data = null
try { data = JSON.parse(ld) } catch (e) { ok('the JSON-LD parses', false, e.message) }
ok('the JSON-LD a SoftwareApplication at the address', data?.['@type'] === 'SoftwareApplication' && data?.url === SITE, JSON.stringify(data?.url))
ok('...with the card\'s picture', data?.image === image)

// ---- the introduction and the start -----------------------------------------------------------------------------------
const container = /<div class="content" id="container">([\s\S]*?)\n    <\/div>/.exec(page)?.[1] ?? ''
ok('#container holds the introduction', /<main class="about" id="about">/.test(container))
ok('...a heading', /<h1>ShadyTracer<\/h1>/.test(container))
ok('...the tutorial linked', container.includes('href="tutorial/"'))
ok('...a noscript line', container.includes('<noscript>'))
const module = page.slice(page.indexOf('<script type="module">'))
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
for (const p of ['index.html', ...want.slice(1).map(pageFile)]) for (const s of refs(read(p))) take(p, s)
while (queue.length) { const f = queue.pop(); for (const s of refs(read(f))) take(f, s) }
ok('the pages\' loads found', loaded.size > 50, `${loaded.size}`)
const hit = [...loaded].filter(p => blocked('/' + p))
ok('nothing the app or the tutorial loads disallowed', !hit.length, hit.slice(0, 5).join(' '))
for (const p of ['/', '/index.html', '/tutorial/', ...want.map(f => '/' + f)]) ok(`${p} not disallowed`, !blocked(p))

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
