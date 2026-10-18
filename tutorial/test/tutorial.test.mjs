// node tutorial/test/tutorial.test.mjs [--manifest]
//
// THE TUTORIAL HOLDS TOGETHER, with no browser. A tutorial nothing checks is the developer page this repo once removed
// (docs/TESTING.md, "The convergence page"), so every promise the pages make is tested here:
//   - the contents (kit/chapters.js) and the pages agree: every written chapter has its page, every page its chapter;
//   - every glossary term a page names exists, every entry's chapter exists, every chapter link and anchor resolves,
//     every relative link and script is a file, every data-* attribute is one the kit reads (a typo fails here);
//   - every excerpt is found exactly once in today's source (kit/excerpt.js, the code the page runs), no file:line is
//     typed by hand, and excerpts whose code changed since the page was checked are LISTED (not failed: an engine edit
//     should not break CI for the tutorial; the page marks them itself);
//   - every figure and every one of its steps draws into a recording canvas without throwing or a NaN;
//   - the flat world (kit/flatland.js) against closed forms in 2D, and NEE against plain path tracing;
//   - what the pages import never reaches the GPU code. --manifest prints that set and the excerpted files: what a
//     static copy of the tutorial (the claude.ai preview) has to carry.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CHAPTERS, PARTS, chapter } from '../kit/chapters.js'
import { GLOSSARY, term } from '../kit/glossary.js'
import { locate, optionsOf, hash, languageOf } from '../kit/excerpt.js'
import { makePen } from '../kit/pen.js'
import { march, pointLightE, directE, tracePath, cameraRay, rng } from '../kit/flatland.js'
import { march3, pointLightE3, directE3, trace3, cameraRay3, orbit, sampleCone } from '../kit/space.js'

const TUT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = resolve(TUT, '..')
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) } }
const notes = []

const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? (f === 'test' ? [] : walk(p)) : [p] })
const pages = walk(TUT).filter(f => f.endsWith('.html'))
const attrsOf = s => { const a = {}; for (const m of s.matchAll(/([\w-]+)="([^"]*)"/g)) a[m[1]] = m[2].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); return a }
// a tag ends at the first > outside quotes: an attribute may hold one (a data-why writing `=>`)
const tags = html => [...html.matchAll(/<([a-zA-Z][\w-]*)\b((?:[^>"]|"[^"]*")*)>/g)].map(m => ({ tag: m[1].toLowerCase(), attrs: attrsOf(m[2]), raw: m[2] }))

/* THE CONTENTS ----------------------------------------------------------------------------------------------------- */
ok('chapter ids are unique', new Set(CHAPTERS.map(c => c.id)).size === CHAPTERS.length)
ok('every chapter is in a part', CHAPTERS.every(c => PARTS.some(p => p.id === c.part)))
for (const c of CHAPTERS.filter(c => c.file)) {
    const f = join(TUT, c.file)
    ok(`chapter "${c.id}" has its page`, existsSync(f), c.file)
    if (!existsSync(f)) continue
    const html = readFileSync(f, 'utf8')
    ok(`chapter "${c.id}": the page says it is that chapter`, new RegExp(`<body[^>]*data-chapter="${c.id}"`).test(html))
    ok(`chapter "${c.id}": its <title> and <h1> are its title`, html.includes(`<title>${c.title} ·`) && html.includes(`<h1>${c.title}</h1>`), c.title)
    ok(`chapter "${c.id}": its eyebrow gives its number`, html.includes(`Chapter ${c.number}</p>`))
}
for (const f of pages.filter(f => f.includes('/ch/'))) {
    const id = /data-chapter="([^"]*)"/.exec(readFileSync(f, 'utf8'))?.[1]
    ok(`${relative(TUT, f)} is in the contents`, !!chapter(id)?.file, id)
}

/* WHAT A CHANGE TOUCHES (review/affected.mjs, CLAUDE.md "The tutorial follows the code"): every path a chapter is
   about exists -- a renamed file would leave its chapter unwatched with nothing saying so -- and a change is held
   against the lines a page shows, the files its figures run and the folders a chapter is about ------------------ */
{
    const { ties, affected } = await import('../review/affected.mjs')
    for (const c of CHAPTERS) for (const p of c.code) ok(`chapter "${c.id}": the code it is about, ${p}, exists`, existsSync(join(REPO, p)))
    const all = ties(), tiles = all.find(t => t.kind === 'excerpt' && t.sym === 'const raygenTiles')
    ok('affected: an excerpt is a tie, with the lines it shows', tiles?.first > 0 && tiles.last >= tiles.first)
    const inside = affected([{ file: tiles.file, ranges: [[tiles.last, tiles.last]] }], all)
    ok('affected: a change inside an excerpt\'s lines is flagged as those lines', inside.some(h => h.sym === 'const raygenTiles' && h.overlap === true)
        && inside.some(h => h.kind === 'excerpt' && h.sym !== 'const raygenTiles' && h.overlap === false))
    ok('affected: ...and finds the chapter that is about the file, planned ones too', inside.some(h => h.kind === 'about' && h.chapter === 'rays') && inside.some(h => h.kind === 'about' && h.chapter === 'caustics'))
    ok('affected: a module a figure runs is a tie', affected([{ file: 'help/widgets.js', ranges: null }], all).some(h => h.kind === 'import' && h.chapter === 'nee'))
    ok('affected: a file in a folder a chapter is about', affected([{ file: 'lib/pathtracer/optics/farfield.js', ranges: null }], all).some(h => h.chapter === 'optics'))
    ok('affected: the tutorial\'s own files and version.js are not changes to ShadyTracer', !affected([{ file: 'tutorial/kit/pen.js', ranges: null }, { file: 'version.js', ranges: null }], all).length)
}

/* THE STYLES: every one in kit/styles.js has its file, imported by kit.css, setting every token kit.css defaults, the
   colours for light and for dark both (a style missing a dark colour would show the default's in the reader's) ---- */
{
    const { STYLES } = await import('../kit/styles.js')
    const kit = readFileSync(join(TUT, 'kit/kit.css'), 'utf8'), fontsCss = readFileSync(join(TUT, 'kit/fonts/fonts.css'), 'utf8')
    ok('the typefaces: kit.css imports kit/fonts/fonts.css first, and no page or module asks Google for one', kit.includes('@import url("fonts/fonts.css")')
        && !walk(TUT).some(f => /\.(js|html|css)$/.test(f) && !f.includes('/kit/fonts/') && readFileSync(f, 'utf8').includes('fonts.googleapis.com')))
    const block = sel => { const i = kit.indexOf(sel); return kit.slice(i, kit.indexOf('}', i)) }
    const all = [...block(':where(:root) {').matchAll(/(--[\w-]+):/g)].map(m => m[1])
    const dark = [...block(':where(:root[data-theme="dark"]) {').matchAll(/(--[\w-]+):/g)].map(m => m[1])
    ok('styles: ids are unique and named', new Set(STYLES.map(s => s.id)).size === STYLES.length && STYLES.every(s => s.name && s.line && s.about && s.face))
    for (const st of STYLES) {
        const f = join(TUT, `kit/styles/${st.id}.css`)
        ok(`style "${st.id}": its file exists and kit.css imports it`, existsSync(f) && kit.includes(`@import url("styles/${st.id}.css")`))
        if (!existsSync(f)) continue
        const css = readFileSync(f, 'utf8'), count = t => css.split(t + ':').length - 1
        const missing = all.filter(t => !count(t)), noDark = dark.filter(t => count(t) < 3)
        ok(`style "${st.id}": sets every token`, !missing.length, missing.join(' '))
        ok(`style "${st.id}": sets every colour for dark too, under the media query and data-theme both`, !noDark.length, noDark.join(' '))
        // its typefaces are the repository's: every family it names has its faces in kit/fonts/fonts.css, each file
        // there, and the family's licence beside them (THIRD_PARTY.md); nothing loads from Google
        const fams = [...st.fonts.matchAll(/family=([^:&]+)/g)].map(m => m[1].replace(/\+/g, ' '))
        for (const fam of fams) {
            const rules = [...fontsCss.matchAll(/@font-face \{([^}]*)\}/g)].map(m => m[1]).filter(r => r.includes(`font-family: '${fam}'`))
            ok(`style "${st.id}": ${fam} is kept in kit/fonts, its files and its licence there`, rules.length > 0
                && rules.every(r => existsSync(join(TUT, 'kit/fonts', /url\("([^"]+)"\)/.exec(r)[1])))
                && existsSync(join(TUT, 'kit/fonts', fam.toLowerCase().replace(/[^a-z0-9]/g, '') + '-OFL.txt')))
        }
        ok(`style "${st.id}": its dark blocks are its own`, css.includes(`:root[data-theme="dark"][data-style="${st.id}"]`) && css.includes(`:root:not([data-theme="light"])[data-style="${st.id}"]`))
    }
}

/* THE READING LIST: every source once, its link https, and "credited" only where that file's own comments name the
   author -- where ShadyTracer learned something is a claim read in code, never remembered ------------------------- */
const { READING, reading } = await import('../kit/reading.js')
ok('reading list: ids are unique', new Set(READING.map(r => r.id)).size === READING.length)
for (const r of READING) {
    ok(`reading "${r.id}": an author, a title and what it is`, r.who && r.title && r.kind)
    if (r.href) ok(`reading "${r.id}": its link is https, and dated as checked`, /^https:\/\/[^\s"<>]+$/.test(r.href) && /^\d{4}-\d\d-\d\d$/.test(r.checked ?? ''))
    if (r.credited) ok(`reading "${r.id}": ${r.credited} credits ${r.who.split(/[ ,]/)[1] || r.who}`, existsSync(join(REPO, r.credited)) && readFileSync(join(REPO, r.credited), 'utf8').includes(r.who.split(',')[0].split(' ').pop()))
}

/* THE GLOSSARY ---------------------------------------------------------------------------------------------------- */
ok('glossary ids are unique', new Set(GLOSSARY.map(g => g.id)).size === GLOSSARY.length)
for (const g of GLOSSARY) {
    ok(`glossary "${g.id}": its chapter exists`, !!chapter(g.ch), g.ch)
    ok(`glossary "${g.id}": its see-also entries exist`, g.see.every(s => term(s)), g.see.join(' '))
    ok(`glossary "${g.id}": a term and a definition`, g.term && g.short && g.short.length > 20)
    ok(`glossary "${g.id}": its sources are in the reading list`, (g.read ?? []).every(id => reading(id)), (g.read ?? []).join(' '))
}

/* THE STAMPER: a tag ends at the first > outside quotes, so a data-why writing `=>` keeps its words, and a second
   stamp replaces the attribute, not text that looks like one ------------------------------------------------------ */
{
    const { stampPage } = await import('../stamp.mjs')
    const file = 'one\ntwo\nthree\n', read = () => file
    const page = '<pre data-src="x.js" data-sym="two" data-why="f = (x) => x"></pre>'
    const once = stampPage(page, read).html, h = locate(file, optionsOf(k => ({ 'data-sym': 'two' })[k])).hash
    ok('stamp: the hash goes at the end of the tag, not into a > inside an attribute', once === `<pre data-src="x.js" data-sym="two" data-why="f = (x) => x" data-hash="${h}"></pre>`, once)
    const stale = '<pre data-src="x.js" data-sym="two" data-why="a data-hash=&quot;0&quot; b" data-hash="0"></pre>'
    ok('stamp: a stale hash replaced in its attribute only', stampPage(stale, read).html === `<pre data-src="x.js" data-sym="two" data-why="a data-hash=&quot;0&quot; b" data-hash="${h}"></pre>`, stampPage(stale, read).html)
    ok('stamp: a stamped page unchanged', stampPage(once, read).changed === 0 && stampPage(once, read).html === once)
}

/* THE PAGES ------------------------------------------------------------------------------------------------------- */
const KNOWN = new Set(['data-g', 'data-ch', 'data-fig', 'data-step', 'data-src', 'data-sym', 'data-nth', 'data-in', 'data-to', 'data-max', 'data-doc',
    'data-why', 'data-hash', 'data-claim', 'data-auto', 'data-words', 'data-chapter', 'data-open-style', 'data-style', 'data-ref', 'data-say'])
// a colour word marked for its style's name (page.js sayColours): a role every style names (kit.css's --say-* tokens)
const SAY = new Set([...readFileSync(join(TUT, 'kit/kit.css'), 'utf8').matchAll(/--say-(\w+):/g)].map(m => m[1]))
const excerpted = new Set(), drift = []
const srcCache = new Map(), src = p => { if (!srcCache.has(p)) srcCache.set(p, readFileSync(join(REPO, p), 'utf8')); return srcCache.get(p) }
const modules = new Map()          // page -> its module's exports
for (const f of pages) {
    const name = relative(TUT, f), html = readFileSync(f, 'utf8'), T = tags(html)
    const ids = new Set(T.map(t => t.attrs.id).filter(Boolean))
    // its one module, imported here: no DOM at import (each mounts only where there is a document)
    const scripts = T.filter(t => t.tag === 'script')
    ok(`${name}: one module script, by src`, scripts.length === 1 && scripts[0].attrs.type === 'module' && !!scripts[0].attrs.src, JSON.stringify(scripts.map(s => s.attrs)))
    ok(`${name}: no inline module script`, !/<script type="module">/.test(html))
    let mod = null
    if (scripts[0]?.attrs.src) {
        const p = resolve(dirname(f), scripts[0].attrs.src)
        ok(`${name}: its module exists`, existsSync(p), scripts[0].attrs.src)
        try { mod = await import(pathToFileURL(p).href) } catch (e) { ok(`${name}: its module imports in node`, false, e.stack?.split('\n').slice(0, 3).join(' | ')) }
        modules.set(name, { mod, path: p })
    }
    // a stamp written into an attribute's text (stamp.mjs once ended a tag at the > of a data-why's `=>`)
    ok(`${name}: no attribute's text holds an attribute`, !T.some(t => Object.values(t.attrs).some(v => /\bdata-[\w-]+="/.test(v))),
        T.flatMap(t => Object.values(t.attrs).filter(v => /\bdata-[\w-]+="/.test(v))).join(' | ').slice(0, 200))
    for (const t of T) {
        for (const k of Object.keys(t.attrs)) if (k.startsWith('data-')) ok(`${name}: data-* attributes are the kit's`, KNOWN.has(k), `<${t.tag} ${k}>`)
        if (t.attrs['data-say'] != null) ok(`${name}: a colour word names a role every style names (data-say="${t.attrs['data-say']}")`, SAY.has(t.attrs['data-say']))
        const a = t.attrs
        if (a['data-g'] != null) ok(`${name}: glossary term "${a['data-g']}" exists`, !!term(a['data-g']))
        if (a['data-words'] != null) for (const w of a['data-words'].trim().split(/\s+/)) ok(`${name}: word "${w}" is in the glossary`, !!term(w))
        if (a['data-ref'] != null) ok(`${name}: source "${a['data-ref']}" is in the reading list`, !!reading(a['data-ref']))
        if (a['data-claim'] != null) ok(`${name}: a claim is measured, code or inferred`, ['measured', 'code', 'inferred'].includes(a['data-claim']), a['data-claim'])
        if (a['data-ch'] != null) {
            const [id, anchor] = a['data-ch'].split('#'), c = chapter(id)
            ok(`${name}: chapter link "${a['data-ch']}" names a chapter`, !!c)
            if (c?.file && anchor) ok(`${name}: chapter link "${a['data-ch']}" names an anchor of it`, readFileSync(join(TUT, c.file), 'utf8').includes(`id="${anchor}"`))
        }
        for (const k of ['href', 'src']) {
            const v = a[k]
            if (!v || /^(https?:|#|mailto:|data:)/.test(v) || a['data-g'] != null || a['data-ch'] != null) continue
            ok(`${name}: ${k}="${v}" is a file`, existsSync(resolve(dirname(f), v.split(/[?#]/)[0])))
        }
        if (a['data-fig'] != null) ok(`${name}: figure "${a['data-fig']}" is exported by the page's module`, !!mod?.figures?.[a['data-fig']])
        if (a['data-step'] != null) {
            const [fig, st] = a['data-step'].split(':')
            ok(`${name}: step "${a['data-step']}" names a figure on the page and one of its steps`, ids && html.includes(`data-fig="${fig}"`) && !!mod?.figures?.[fig]?.steps?.[st])
        }
        if (a['data-src'] != null) {
            excerpted.add(a['data-src'])
            const where = `${name}: ${t.tag} ${a['data-src']} "${a['data-sym']}"`
            if (!existsSync(join(REPO, a['data-src']))) { ok(`${where}: the file exists`, false); continue }
            let hit = null
            try { hit = locate(src(a['data-src']), optionsOf(k => a[k])) } catch (e) { ok(`${where}: found exactly once`, false, e.message); continue }
            ok(`${where}: found exactly once`, true)
            if (t.tag === 'pre') {
                if (!a['data-hash']) notes.push(`not yet checked (no data-hash): ${where}, lines ${hit.first}-${hit.last} (node tutorial/stamp.mjs)`)
                else if (a['data-hash'] !== hit.hash) drift.push(`${where}: ${a['data-hash']} -> ${hit.hash}, lines ${hit.first}-${hit.last}`)
            }
        }
    }
    // a reading box: a tag, then sources by id, each with the page's own reason to read it (an empty li is a bare link)
    for (const box of html.matchAll(/<aside class="refs">([\s\S]*?)<\/aside>/g)) {
        ok(`${name}: a reading box starts with its tag`, /^\s*<span class="tag">[^<]+<\/span>\s*<ul>/.test(box[1]))
        const items = [...box[1].matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/g)]
        ok(`${name}: a reading box lists sources`, items.length > 0)
        for (const [, at, why] of items) ok(`${name}: each source in a reading box is one from the list, with a reason`, /data-ref="[^"]+"/.test(at) && why.replace(/<[^>]+>/g, '').trim().length > 30, at)
    }
    if (name.startsWith('ch/')) ok(`${name}: says where its ideas come from (a reading box)`, html.includes('<aside class="refs">'))
    // a file:line typed by hand goes stale: every one is a <cite data-src data-sym>
    const typed = [...html.replace(/<(pre|cite)\b(?:[^>"]|"[^"]*")*>/g, '').matchAll(/\b[\w./-]+\.(?:js|mjs|md|css|html):\d+/g)].map(m => m[0])
    ok(`${name}: no file:line typed by hand`, !typed.length, typed.join(' '))
}

/* THE FIGURES: every spec, in its first state and after each step, drawn into a canvas that records -------------- */
function fakeCtx() {
    const calls = [], nan = []
    const ctx = new Proxy({}, {
        get(t, k) {
            if (k in t) return t[k]
            if (k === 'measureText') return s => ({ width: String(s).length * 7 })
            return (...args) => { calls.push(k); if (args.some(a => typeof a === 'number' && !Number.isFinite(a))) nan.push(`${String(k)}(${args.join(', ')})`) }
        },
        set(t, k, v) { t[k] = v; return true },
    })
    return { ctx, calls, nan }
}
const colours = Object.fromEntries(['paper', 'ink', 'soft', 'faint', 'accent', 'cam', 'light', 'shadow', 'blocked', 'solid', 'fill', 'glass', 'normal', 'hit', 'step', 'grid'].map(r => [r, '#123456']))
const themes = ['hatch', 'dots', 'wash'].map((fill, i) => ({ colors: colours, rough: i === 1 ? 0 : 1.1, double: i === 0, width: 1.5, misreg: i === 1 ? 1.6 : 0, fill, fonts: { hand: 'x', mono: 'y', body: 'z' } }))
const clone = v => JSON.parse(JSON.stringify(v))
for (const [name, { mod }] of modules) {
    for (const [fig, spec] of Object.entries(mod?.figures ?? {})) {
        const states = [['first', clone(spec.state ?? {})], ...Object.entries(spec.steps ?? {}).map(([k, p]) => [k, Object.assign(clone(spec.state ?? {}), clone(p))])]
        for (const [k, state] of states) {
            const theme = themes[(k.length + fig.length) % themes.length]
            const { ctx, calls, nan } = fakeCtx()
            let err = null
            try {
                if (spec.work) { spec.work.reset(state); spec.work.add(state, 4); spec.work.add(state, 4) }
                const handles = []
                spec.draw(makePen(ctx, { s: 60, ox: 320, oy: 220, W: 640, H: 440 }, theme, handles), state, 0.5)
                for (const h of handles) if (spec.drag?.[h.id]) { spec.drag[h.id](state, [(h.x - 320) / 60 + 0.1, (220 - h.y) / 60 + 0.1]) }
                if (spec.readout) ok(`${name} figure "${fig}" (${k}): its readout is text`, typeof spec.readout(state) === 'string')
            } catch (e) { err = e }
            ok(`${name} figure "${fig}" (${k}): draws without throwing`, !err, err?.stack?.split('\n').slice(0, 3).join(' | '))
            ok(`${name} figure "${fig}" (${k}): draws something`, calls.includes('stroke') || calls.includes('fill') || calls.includes('fillRect'))
            ok(`${name} figure "${fig}" (${k}): no NaN or infinite coordinate`, !nan.length, nan.slice(0, 3).join('; '))
        }
    }
}

/* THE FLAT WORLD AGAINST CLOSED FORMS (2D: light spreads around a circle) ----------------------------------------- */
{
    // a point light at height h over an open floor: E(x) = I h / (x^2 + h^2), which integrates to pi I
    const floor = { shapes: [{ kind: 'box', c: [0, -1], h: [5000, 1] }] }, h = 2, I = 1.5
    let worst = 0, integral = 0
    for (let x = -6; x <= 6; x += 0.5) worst = Math.max(worst, Math.abs(pointLightE(floor, { p: [0, h], I }, x, 0, 0, 1) - I * h / (x * x + h * h)))
    ok('flat world: a point light on a floor is I h / (x^2 + h^2)', worst < 1e-12, `worst ${worst}`)
    for (let x = -400; x < 400; x += 0.05) integral += pointLightE(floor, { p: [0, h], I }, x + 0.025, 0, 0, 1) * 0.05
    ok('...and over the whole floor sums to pi I (less the tails past 400)', Math.abs(integral - (Math.PI - 2 * Math.atan(h / 400)) * I) < 1e-3 * I, `${integral}`)
    // ...blocked by something in the way
    const blocked = { shapes: [...floor.shapes, { kind: 'circle', c: [0, 1], r: 0.3 }] }
    ok('...and 0 behind something in the way', pointLightE(blocked, { p: [0, h], I }, 0, 0, 0, 1) === 0)
}
{
    // a segment lamp seen from a point: E = L (sin phi2 - sin phi1); NEE and a cosine bounce both find it on average
    const L = 1.3, world = { shapes: [{ kind: 'segment', a: [-1.5, 2], b: [0.5, 2.6], r: 1e-4, emit: L }] }
    const s1 = -1.5 / Math.hypot(-1.5, 2), s2 = 0.5 / Math.hypot(0.5, 2.6), exact = L * (s2 - s1)
    const run = (nee, n, seed) => { const R = rng(seed); let s = 0, s2_ = 0; for (let i = 0; i < n; i++) { const e = directE(world, 0, 0, 0, 1, { nee, rand: R }); s += e; s2_ += e * e } const m = s / n; return { m, se: Math.sqrt((s2_ / n - m * m) / (n - 1)) } }
    const on = run(true, 60000, 11), off = run(false, 60000, 12)
    ok('flat world: a lamp\'s light by NEE is L (sin phi2 - sin phi1)', Math.abs(on.m - exact) < 4 * on.se + 1e-3, `${on.m} ± ${on.se} vs ${exact}`)
    ok('...and by bouncing at random, on average', Math.abs(off.m - exact) < 4 * off.se + 1e-3, `${off.m} ± ${off.se} vs ${exact}`)
    ok('...NEE with far less spread for the same tries', on.se < off.se / 3, `${on.se} vs ${off.se}`)
}
{
    // a whole room, paths of up to 4 bounces: with and without NEE, the same pixel value within their error bars
    const room = {
        sky: 0, shapes: [
            { kind: 'box', c: [3, -0.3], h: [4, 0.3], albedo: 0.7 }, { kind: 'box', c: [3, 4.3], h: [4, 0.3], albedo: 0.6 },
            { kind: 'box', c: [-1.3, 2], h: [0.3, 2.6], albedo: 0.6 }, { kind: 'box', c: [7.3, 2], h: [0.3, 2.6], albedo: 0.6 },
            { kind: 'circle', c: [2.5, 0.7], r: 0.7, albedo: 0.7 },
            { kind: 'segment', a: [2.4, 3.6], b: [3.6, 3.6], r: 1e-3, emit: 1 },
        ],
    }
    const cam = { eye: [0, 3], dir: Math.atan2(-2.5, 4), fov: 1.1, pixels: 8 }
    for (const px of [2, 5]) {
        const est = (nee, seed) => { const R = rng(seed); let s = 0, s2 = 0; const n = 12000; for (let i = 0; i < n; i++) { const [ox, oy, dx, dy] = cameraRay(cam, px, R()); const y = tracePath(room, ox, oy, dx, dy, { nee, maxBounce: 4, rand: R }); s += y; s2 += y * y } const m = s / n; return { m, se: Math.sqrt((s2 / n - m * m) / (n - 1)) } }
        const on = est(true, 100 + px), off = est(false, 200 + px)
        ok(`flat world: pixel ${px} of a room path traced with and without NEE agrees`, Math.abs(on.m - off.m) < 4 * Math.hypot(on.se, off.se), `${on.m} ± ${on.se} vs ${off.m} ± ${off.se}`)
        ok(`...pixel ${px}: NEE's error bar is the smaller`, on.se < off.se, `${on.se} vs ${off.se}`)
    }
}
{
    // sphere tracing against the analytic hit of a ray and a circle
    const o = {}, world = { shapes: [{ kind: 'circle', c: [3, 0.5], r: 1 }] }
    march(world, 0, 0, 1, 0, { eps: 1e-4 }, o)
    ok('flat world: the march stops at the circle, within its tolerance', o.hit && Math.abs(o.t - (3 - Math.sqrt(1 - 0.25))) < 1e-4 / 0.9, `${o.t}`)
    march(world, 0, 0, 0, 1, { eps: 1e-4, far: 20 }, o)
    ok('...and misses what is not in its way', !o.hit)
    // the camera: the middle of the film looks forward, its edges fov / 2 aside
    const cam = { eye: [0, 0], dir: 0.3, fov: 1.2, pixels: 10 }
    const mid = cameraRay(cam, 5, 0), edge = cameraRay(cam, 0, 0)
    ok('flat world: the film\'s middle looks along the camera', Math.abs(Math.atan2(mid[3], mid[2]) - 0.3) < 1e-12)
    ok('...and its edge half the field of view aside', Math.abs(Math.abs(Math.atan2(edge[3], edge[2]) - 0.3) - 0.6) < 1e-12)
}

/* 3D (kit/space.js) AGAINST CLOSED FORMS: light over spheres again -------------------------------------------------- */
{
    // a point light over a floor: I cos(theta) / d^2
    const floor = { shapes: [{ kind: 'plane', z: 0 }] }
    let worst = 0
    for (const x of [0, 0.5, 1, 2, 4]) worst = Math.max(worst, Math.abs(pointLightE3(floor, { p: [0, 0, 2], I: 3 }, [x, 0, 0], [0, 0, 1]) - 3 * 2 / Math.pow(x * x + 4, 1.5)))
    ok('3D: a point light on a floor is I cos(theta) / d^2', worst < 1e-12, `worst ${worst}`)
    // a glowing ball of radius R at distance d, straight above a point: E = pi L sin^2(alpha), sin(alpha) = R / d
    const L = 2, R = 0.5, d = 3, ball = { shapes: [{ kind: 'sphere', c: [0, 0, d], r: R, emit: L }] }, exact = Math.PI * L * (R / d) ** 2
    const run = (nee, n, seed) => { const r = rng(seed); let s = 0, s2 = 0; for (let i = 0; i < n; i++) { const e = directE3(ball, [0, 0, 0], [0, 0, 1], { nee, rand: r }); s += e; s2 += e * e } const m = s / n; return { m, se: Math.sqrt(Math.max(0, s2 / n - m * m) / (n - 1)) } }
    const on = run(true, 20000, 31), off = run(false, 60000, 32)
    ok('3D: a glowing ball\'s light by aiming into its cone is pi L sin^2(alpha)', Math.abs(on.m - exact) < 4 * on.se + 1e-4 * exact, `${on.m} ± ${on.se} vs ${exact}`)
    ok('...and by bouncing at random, on average', Math.abs(off.m - exact) < 4 * off.se, `${off.m} ± ${off.se} vs ${exact}`)
    // the cone sampler's density integrates to 1 over its cone: 1 / pdf is the cone's solid angle, 2 pi (1 - cos)
    const c = sampleCone([0, 0, 0], ball.shapes[0], 0.3, 0.7)
    ok('3D: the cone\'s density is one over its solid angle', Math.abs(1 / c.pdf - 2 * Math.PI * (1 - Math.sqrt(1 - (R / d) ** 2))) < 1e-12)
    // a room path traced with and without NEE: the same pixel within their error bars
    const room = { sky: [0, 0, 0], shapes: [
        { kind: 'plane', z: 0, rgb: [0.7, 0.7, 0.7] }, { kind: 'wall', n: [0, -1, 0], d: -2, rgb: [0.7, 0.7, 0.7] },
        { kind: 'wall', n: [1, 0, 0], d: -2, rgb: [0.7, 0.3, 0.3] }, { kind: 'wall', n: [-1, 0, 0], d: -2, rgb: [0.3, 0.7, 0.3] },
        { kind: 'wall', n: [0, 0, -1], d: -3, rgb: [0.7, 0.7, 0.7] }, { kind: 'sphere', c: [0, 1, 2.4], r: 0.3, emit: 4 }] }
    const cam = { eye: [0, -3, 1.5], target: [0, 1, 1.2], fov: 0.8 }
    const est = (nee, seed) => { const r = rng(seed); let s = 0, s2 = 0; const n = 6000; for (let i = 0; i < n; i++) { const y = trace3(room, cam.eye, cameraRay3(cam, 3, 4, 8, 6, r(), r()), { nee, maxBounce: 3, rand: r, far: 14 })[1]; s += y; s2 += y * y } const m = s / n; return { m, se: Math.sqrt((s2 / n - m * m) / (n - 1)) } }
    const a = est(true, 41), b = est(false, 42)
    ok('3D: a room pixel path traced with and without NEE agrees', Math.abs(a.m - b.m) < 4 * Math.hypot(a.se, b.se), `${a.m} ± ${a.se} vs ${b.m} ± ${b.se}`)
    ok('...NEE\'s error bar the smaller', a.se < b.se, `${a.se} vs ${b.se}`)
    // the march, and the cameras
    const o = {}; march3({ shapes: [{ kind: 'sphere', c: [4, 0.5, 0], r: 1 }] }, [0, 0, 0], [1, 0, 0], { eps: 1e-5 }, o)
    ok('3D: the march stops at the sphere, within its tolerance', o.hit && Math.abs(o.t - (4 - Math.sqrt(0.75))) < 1e-5 / 0.9, `${o.t}`)
    const mid = cameraRay3({ eye: [0, 0, 0], target: [1, 0, 0], fov: 1 }, 4, 3, 8, 6, 0, 0)
    ok('3D: the film\'s middle looks at the target', Math.abs(mid[0] - 1) < 1e-12 && Math.abs(mid[1]) < 1e-12 && Math.abs(mid[2]) < 1e-12)
    const t = orbit({ target: [1, 2, 3], yaw: 0.4, pitch: 0.3 }).project([1, 2, 3])
    ok('3D: an orbiting camera puts its target in the middle', Math.abs(t[0]) < 1e-12 && Math.abs(t[1]) < 1e-12)
}

/* THE CHAPTERS' OWN NUMBERS: what a page's prose quotes from its figures, held here so a change to the code they run
   (noise.js, widgets.js) fails until the prose is read again ------------------------------------------------------ */
{
    const { caught, caught3 } = await import('../ch/reading.js')
    ok('ch.0: a piece 0.6 long catches 4 of 36 rays at r = 1 and 2 at r = 2 (the flat world\'s 1/r)', caught(1) === 4 && caught(2) === 2, `${caught(1)}, ${caught(2)}`)
    ok('ch.0: ...and in 3D a patch 0.6 a side catches 4 x 4 = 16 at r = 1 and 2 x 2 = 4 at r = 2 (1/r^2)', caught3(1) === 16 && caught3(2) === 4, `${caught3(1)}, ${caught3(2)}`)
}
{
    const S = await import('../ch/shapes.js'), W = await import('../../help/widgets.js')
    // the blend's normal (scene_api.js csgUnion, mirrored) is the slope of the blended field, for two shapes with normals
    const A = [0.3, 0.1], B = [-0.5, -0.2], rA = 0.7, rB = 0.6, k = 0.5
    const at = (c, r, x, y) => { const dx = x - c[0], dy = y - c[1], l = Math.hypot(dx, dy); return [dx / l, dy / l, l - r] }
    const f = (x, y) => W.smin(at(A, rA, x, y)[2], at(B, rB, x, y)[2], k)
    let worst = 0
    for (let i = 0; i < 400; i++) {
        const x = -1.6 + 3 * ((i * 0.6180339) % 1), y = -1.2 + 2.4 * ((i * 0.7548776) % 1)
        const n = S.csgUnion(at(A, rA, x, y), at(B, rB, x, y), k), h = 1e-5
        const g = [(f(x + h, y) - f(x - h, y)) / (2 * h), (f(x, y + h) - f(x, y - h)) / (2 * h)], gl = Math.hypot(...g)
        worst = Math.max(worst, Math.hypot(n[0] - g[0] / gl, n[1] - g[1] / gl), Math.abs(n[2] - f(x, y)))
    }
    ok('ch.3: a blend\'s normal, mix(grad a, grad b, t) made unit, is the blended field\'s slope (and its distance smin)', worst < 1e-5, worst.toExponential(2))
    ok('ch.3: ...and a shape with no normal gives the join none (csgNormal)', S.csgUnion([0, 0, 0.1], [1, 0, 0.2], 0.5).slice(0, 2).every(v => v === 0))
    // a relief divided before a blend: smin(x/c, y/c, k) = smin(x, y, k c) / c
    let gap = 0
    for (const [x, y, c] of [[0.1, 0.3, 2], [-0.2, 0.05, 3.5], [0.4, 0.41, 1.7], [1, -1, 4]]) gap = Math.max(gap, Math.abs(W.smin(x / c, y / c, 0.3) - W.smin(x, y, 0.3 * c) / c))
    ok('ch.3: smin(x/c, y/c, k) = smin(x, y, kc)/c, why a relief under a blend is divided after it', gap < 1e-12, gap)
    // the swirl's numbers, as the page quotes them
    const st = d => S.steepest(1.2, d).worst
    ok('ch.3: the swirl at turn 1.2: steepest 1.77 undivided, 1.13 divided by sqrt(1 + c^2), 1.00 by (c + sqrt(c^2 + 4)) / 2',
        Math.abs(st('none') - 1.77) < 0.01 && Math.abs(st('sqrt') - 1.13) < 0.01 && Math.abs(st('exact') - 1.00) < 0.006, [st('none'), st('sqrt'), st('exact')].map(v => v.toFixed(3)).join(' '))
    // ...and the probe's circle, as the steps say: into the arm undivided and divided by sqrt(1 + c^2), not by the
    // exact divisor -- nor anywhere inside the extent with it (beyond, the swirl stretches more, and the page says so)
    const cuts = (div, p) => { const g = S.swirlField(1.2, div), raw = S.swirlField(1.2, 'none'), d = g(...p); let mn = Infinity
        for (let i = 0; i < 720; i++) { const a = i / 720 * 2 * Math.PI; mn = Math.min(mn, raw(p[0] + Math.cos(a) * d, p[1] + Math.sin(a) * d)) } return d > 0 && mn < -1e-4 }
    const P = S.figures.swirl.steps.raw.probe
    let exactCuts = 0
    for (let i = 0; i < 900; i++) { const a = i * 2.39996, r = 0.99 * Math.sqrt((i + 0.5) / 900), p = [r * Math.cos(a), r * Math.sin(a)]; if (cuts('exact', p)) exactCuts++ }
    ok('ch.3: the swirl\'s probe circle cuts the arm undivided and by sqrt(1 + c^2), never with the exact divisor inside the extent',
        cuts('none', P) && cuts('sqrt', P) && !cuts('exact', P) && !exactCuts, `${exactCuts} probes`)
    // the 3D twist (builder/modifiers.js: p turned by rate z, distances times 1/sqrt(1 + rate^2 extent^2)): the page's
    // measured slopes, the largest found on a grid of points within the extent near the child
    const twist = (rate, p) => { const a = rate * p[2], c = Math.cos(a), s = Math.sin(a); return [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]] }
    const box3 = (q, b) => { const d = q.map((v, i) => Math.abs(v) - b[i]); return Math.hypot(...d.map(v => Math.max(v, 0))) + Math.min(Math.max(...d), 0) }
    const slope3 = (g, lo, hi, ext, n = 26) => {
        let w = 0
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let l = 0; l < n; l++) {
            const p = [0, 1, 2].map((a, m) => lo[a] + (hi[a] - lo[a]) * ([i, j, l][m] + 0.5) / n)
            if (Math.hypot(p[0], p[1]) > ext) continue
            const h = 1e-5, gr = [0, 1, 2].map(a => { const u = [...p], v = [...p]; u[a] += h; v[a] -= h; return (g(u) - g(v)) / (2 * h) })
            w = Math.max(w, Math.hypot(...gr))
        }
        return w
    }
    const c45 = Math.SQRT1_2, plate = q => box3([q[0] - 0.9, c45 * q[1] + c45 * q[2], -c45 * q[1] + c45 * q[2]], [0.08, 0.15, 0.03])
    const plateSlope = slope3(p => plate(twist(0.8, p)) / Math.sqrt(1 + 0.64), [0.75, -0.25, -0.25], [1.05, 0.25, 0.25], 1.0, 34)
    const B3 = [0.6, 0.6, 0.5], ext = Math.hypot(0.6, 0.6)
    const boxSlope = slope3(p => box3(twist(1.2, p), B3) / Math.sqrt(1 + 1.44 * ext * ext), [-1, -1, -0.8], [1, 1, 0.8], ext)
    ok('ch.3: a plate tilted 45 degrees at a twist\'s extent (rate 0.8, extent 1): slope 1.14 after the twist\'s division; a twisted box under 1',
        Math.abs(plateSlope - 1.14) < 0.015 && boxSlope < 1 && boxSlope > 0.9, `${plateSlope.toFixed(3)}, box ${boxSlope.toFixed(3)}`)
    // the relief figure's ray, as the page tells it: stuck undivided, 33 steps divided, 22 with the shell
    const ray = mode => { const s = { ...S.figures.relief.steps[mode] }, l = Math.hypot(s.from[0], s.from[1] * 0.6), r = S.march(S.reliefField(s), s.from, [-s.from[0] / l, -s.from[1] * 0.6 / l]), t = S.reliefField({ ...s, mode: 'raw' }); return { n: r.pts.length, end: r.end, inside: r.pts.filter(([x, y]) => t(x, y) < -0.004).length } }
    const raw = ray('raw'), div = ray('divided'), sh = ray('shell')
    ok('ch.3: the relief\'s ray: undivided it rocks for 300 steps, half inside; divided 33 steps; with the shell 22',
        raw.end === 'out of steps' && raw.n === 300 && Math.abs(raw.inside - 150) <= 3 && div.end === 'hit' && div.n === 33 && !div.inside && sh.end === 'hit' && sh.n === 22 && !sh.inside,
        JSON.stringify({ raw, div, sh }))
    ok('ch.3: the relief\'s slope bound is the modifier\'s: 1 + amount / size x 17.2 / 1.875', Math.abs(S.reliefSlope(0.12, 0.2) - (1 + 0.6 * 17.2 / 1.875)) < 1e-12)
    // a ball wholly inside the pool: everywhere inside the ball, the fold says glass
    const pool = (x, y) => W.circle(x + 0.2, y + 0.35, 1.45)
    let wrong = 0
    for (let i = 0; i < 2000; i++) {
        const a = i * 2.39996, r = 0.62 * Math.sqrt((i + 0.5) / 2000), x = 0.15 + r * Math.cos(a), y = -0.2 + r * Math.sin(a)
        if (S.fold(S.fold(S.emptyHit(), pool(x, y), 'water'), W.circle(x - 0.15, y + 0.2, 0.62), 'glass').a !== 'glass') wrong++
    }
    ok('ch.3: a solid wholly inside another is the one a point in it is least deep in', !wrong, `${wrong} points`)
    ok('ch.3: ...and the overlap step\'s probe, inside the glass, is called water', S.figures.fold.readout(S.figures.fold.steps.overlap).endsWith('in: water'))
}

{
    const N = await import('../ch/normals.js'), { f32Floor } = await import('../../lib/pathtracer/core/tolerances.js')
    // forward differences' error shrinks like h, central ones' like h^2, on the circle
    const p = N.figures.slope.steps.round.probe, ex = N.exact(...p), ang = n => Math.acos(Math.min(1, n[0] * ex[0] + n[1] * ex[1]))
    const fw = h => ang(N.forward(N.field, ...p, h)), ce = h => ang(N.central(N.field, ...p, h))
    ok('ch.4: forward differences\' error falls like the step, central ones\' like its square', Math.abs(fw(0.02) / fw(0.002) - 10) < 1.5 && Math.abs(ce(0.02) / ce(0.002) - 100) < 15,
        `${(fw(0.02) / fw(0.002)).toFixed(2)}, ${(ce(0.02) / ce(0.002)).toFixed(1)}`)
    let worst = 0
    for (let i = 0; i < 300; i++) {
        const q = [-2.6 + 5.2 * ((i * 0.618034) % 1), -1.6 + 3.2 * ((i * 0.754878) % 1)], dc = Math.hypot(q[0] - 0.75, q[1] - 0.15) - 0.95
        if (dc > N.field(...q) + 0.01) continue                // the box is nearer, or nearly: its corners are another test
        const c = N.central(N.field, ...q, 1e-6), e = N.exact(...q)
        worst = Math.max(worst, Math.hypot(c[0] - e[0], c[1] - e[1]))
    }
    ok('ch.4: the exact normal is the field\'s slope where the circle is nearer', worst < 1e-4, worst)
    // the readouts the prose quotes
    const r = k => N.figures.slope.readout(N.figures.slope.steps[k])
    ok('ch.4: on the circle 3.9 and 0.6 degrees at h 0.3; near the crease 6.9 and 20.5; a tenth the step 0.8 and 0.0',
        r('round').includes('3.9° off') && r('round').includes('0.6° off') && r('crease').includes('6.9° off') && r('crease').includes('20.5° off')
        && r('creaseSmall').includes('0.8° off') && r('creaseSmall').includes('0.0° off'), [r('round'), r('crease'), r('creaseSmall')].join(' | '))
    const g = (frac, k) => N.grainErrors(frac, 2 ** k)
    ok('ch.4: the f32 figure: 2.2 mrad at 128 spacings, 110 at 2, the step\'s own 11 at 16384, 7.7 for a radius of a thousandth at 128',
        g(0.1, 7).all.toFixed(1) === '2.2' && Math.round(g(0.1, 1).all / 10) === 11 && Math.round(g(0.1, 14).step) === 11 && g(0.001, 7).all.toFixed(1) === '7.7',
        [g(0.1, 7).all, g(0.1, 1).all, g(0.1, 14).step, g(0.001, 7).all].map(v => v.toFixed(2)).join(' '))
    const q = N.grainPoint(0.1, 0.3).p
    ok('ch.4: the figure\'s step at 128 spacings is the renderer\'s floor (tolerances.js f32Floor), in f32', N.stepAt(128, q) === Math.fround(f32Floor([q[0], q[1], 0])))
}

{
    const M = await import('../ch/montecarlo.js')
    const d = M.darts(4, 81920)
    ok('ch.12: 81,920 darts (seed 4): 3.1440 ± 0.0057, 0.4 error bars from pi; 20 give 3.4',
        d.mean.toFixed(4) === '3.1440' && d.se.toFixed(4) === '0.0057' && (Math.abs(d.mean - Math.PI) / d.se).toFixed(1) === '0.4' && M.darts(4, 20).mean === 3.4)
    ok('ch.12: the error bar from measure.js is the textbook s / sqrt(N) for a true mean', Math.abs(d.se - M.DART_SD / Math.sqrt(81920)) / d.se < 0.01, `${d.se} against ${M.DART_SD / Math.sqrt(81920)}`)
    const sp = M.spread(1)
    ok('ch.12: 240 estimates a column scatter as 1.642 / sqrt(N), within the 15% such a count allows', sp.every(({ N, sd }) => Math.abs(sd / (M.DART_SD / Math.sqrt(N)) - 1) < 0.15), sp.map(c => c.sd.toFixed(3)).join(' '))
    // THE OLD OUTPUT, every state counted: f32(state) is an integer, so the output is exactly (v mod 671040) / 671040 and
    // the whole distribution is a count on 671040 points. States below 2^24 convert exactly; above, about 2^(e-23) states
    // round to each multiple of 2^(e-23).
    const DIV = 671040, counts = new Float64Array(DIV)
    for (let v = 0; v < 2 ** 24; v++) counts[v % DIV]++
    for (let e = 24; e < 32; e++) { const sp2 = 2 ** (e - 23); for (let m = 2 ** 23; m < 2 ** 24; m++) counts[(m * sp2) % DIV] += sp2 }
    const pre = new Float64Array(DIV + 1); for (let k = 0; k < DIV; k++) pre[k + 1] = pre[k] + counts[k]
    const share = (a, b) => (pre[Math.min(DIV, Math.ceil(b * DIV))] - pre[Math.ceil(a * DIV)]) / pre[DIV]
    const range = w => { let lo = Infinity, hi = 0; for (let i = 0; i < Math.round(1 / w); i++) { const r = share(i * w, (i + 1) * w) / w; lo = Math.min(lo, r); hi = Math.max(hi, r) } return [lo, hi] }
    const [lo4, hi4] = range(1e-4), [lo3, hi3] = range(1e-3)
    ok('ch.12: the old output, every state counted: windows of 0.0001 get 0.95x to 1.83x their share, of 0.001 0.96x to 1.04x',
        lo4.toFixed(2) === '0.95' && hi4.toFixed(2) === '1.83' && lo3.toFixed(2) === '0.96' && hi3.toFixed(2) === '1.04', [lo4, hi4, lo3, hi3].map(v => v.toFixed(3)).join(' '))
    // ...and the figure's quicker count agrees with it, window by window
    // (a point of the 671040 lying exactly on a window's edge falls either side of it in floating point, and oldShare
    // decides it afresh for each wrap of the line: so each window is held to within one point's fair share of it)
    const gap = w => Math.max(...M.windows(0.3, w).map(r => Math.abs(r.old - share(r.a, r.a + w) / w))), point = w => 1 / (DIV * w)
    ok('ch.12: the figure\'s count of the old output (oldShare) is the full count\'s, window by window, within one point',
        [1e-3, 1e-4, 1e-5].every(w => gap(w) < point(w)), [1e-3, 1e-4, 1e-5].map(w => `${gap(w).toExponential(1)} < ${point(w).toExponential(1)}`).join(' '))
    const g = k => M.figures.grid.readout(M.figures.grid.steps[k])
    ok('ch.12: the dice figure says what the page says: 0.96-1.04, 0.95-1.83, 0.01-8.76; PCG4D 1.000',
        g('wide').includes('0.96× to 1.04×') && g('narrow').includes('0.95× to 1.83×') && g('tiny').includes('0.01× to 8.76×') && g('narrow').includes('PCG4D: 1.000× to 1.000×'), [g('wide'), g('narrow'), g('tiny')].join(' | '))
    ok('ch.12: seven-eighths of the states are at or above 2^29, where f32 keeps multiples of 64: a grid of 64 / 671040 = 1/10485', 64 / DIV === 1 / 10485 && (2 ** 32 - 2 ** 29) / 2 ** 32 === 7 / 8)
}

{
    const P = await import('../ch/paths.js'), { ENGINE_RR } = await import('../kit/flatland.js')
    const p = P.onePath(17, 0.8)
    ok('ch.13: the first figure\'s path bounces four times and finds the lamp carrying 0.8^4 = 0.41', p.info.end === 'lamp' && p.info.bounces === 4 && Math.abs(p.L - 0.8 ** 4) < 1e-12
        && p.rec.map(r => r.beta).every((b, k) => Math.abs(b - 0.8 ** k) < 1e-12), JSON.stringify(p.info))
    const tb = readFileSync(join(REPO, 'lib/pathtracer/core/tracebasics.js'), 'utf8')
    ok('ch.13: the flat world\'s roulette is tracebasics.js\'s: from bounce 3, p in [0.1, 0.95]', ENGINE_RR.start === +/const uRRStart: u32 = (\d+)u;/.exec(tb)[1]
        && ENGINE_RR.min === +/const RR_MIN_P: FLOAT = ([\d.]+);/.exec(tb)[1] && ENGINE_RR.max === +/const RR_MAX_P: FLOAT = ([\d.]+);/.exec(tb)[1])
    const run = (fig, over = {}) => { const s = { ...fig.state, ...over }; fig.work.reset(s); while (fig.work.add(s, 1e9)); return s }
    const c = run(P.figures.cap), all = c.caps.at(-1).Y, sh = k => Math.round(100 * c.caps[[0, 1, 2, 3, 4, 6, 8, 12, 20, 40].indexOf(k)].Y / all)
    const w = run(P.figures.cap, { rho: 0.95 }), shw = k => Math.round(100 * w.caps[[0, 1, 2, 3, 4, 6, 8, 12, 20, 40].indexOf(k)].Y / w.caps.at(-1).Y)
    ok('ch.13: a cap of 1, 3, 8 keeps 46, 72, 95% of the light at albedo 0.8; 3 and 8 keep 46 and 76% at 0.95', sh(1) === 46 && sh(3) === 72 && sh(8) === 95 && shw(3) === 46 && shw(8) === 76,
        `${sh(1)} ${sh(3)} ${sh(8)} / ${shw(3)} ${shw(8)}`)
    const r = run(P.figures.roulette), se = m => Math.sqrt(m.S * m.V / (1 - m.S)), z = (r.on.Y - r.off.Y) / Math.hypot(se(r.off), se(r.on))
    const eff = (se(r.off) ** 2 * r.costOff) / (se(r.on) ** 2 * r.costOn)
    ok('ch.13: roulette on and off agree within their error bars; 10.0 and 4.7 rays a path; for equal rays 0.96 of the error bar',
        Math.abs(z) < 1 && (r.costOff / r.off.cnt).toFixed(1) === '10.0' && (r.costOn / r.on.cnt).toFixed(1) === '4.7' && (1 / Math.sqrt(eff)).toFixed(2) === '0.96', `z ${z.toFixed(2)}, eff ${eff.toFixed(3)}`)
    const ratio = m => { const e = (se(m.off) ** 2 * m.costOff) / (se(m.on) ** 2 * m.costOn); return (1 / Math.sqrt(e)).toFixed(2) }
    const u = run(P.figures.roulette, P.figures.roulette.steps.unfair), dk = run(P.figures.roulette, { rho: 0.5 }), wh = run(P.figures.roulette, { rho: 0.95 })
    ok('ch.13: survivors that keep their beta lose a third of the light (0.233 against 0.346); for equal rays 0.68 in a dark room, 1.60 with white walls',
        u.on.Y.toFixed(3) === '0.233' && u.off.Y.toFixed(3) === '0.346' && ratio(dk) === '0.68' && ratio(wh) === '1.60', `${u.on.Y} ${u.off.Y} ${ratio(dk)} ${ratio(wh)}`)
    const q = P.onePath(17, 0.6, 20, 8)
    ok('ch.13: the one path\'s beta is the walls\' albedo to the power of its bounces, whatever the albedo', q.rec.every((r, k) => Math.abs(r.beta - 0.6 ** k) < 1e-12))
}

{
    const M = await import('../ch/mis.js'), { rng } = await import('../kit/flatland.js')
    const tb = readFileSync(join(REPO, 'lib/pathtracer/core/tracebasics.js'), 'utf8')
    ok('ch.15: the flat world\'s misWeight is the power heuristic tracebasics.js writes, and the two weights sum to 1',
        /fn misWeight\(pThis: f32, pOther: f32\) -> f32 \{\s*let a = pThis \* pThis;\s*let b = pOther \* pOther;\s*return a \/ max\(a \+ b, 1e-20\);/.test(tb)
        && [[1, 2], [0.3, 7], [5, 0.01]].every(([a, b]) => Math.abs(M.misWeight(a, b) + M.misWeight(b, a) - 1) < 1e-12))
    ok('ch.15: every lamp gives the same light (radiance x length 0.4)', M.LAMPS.every(L => Math.abs(L.Le * L.len - 0.4) < 1e-12))
    // each of the three estimates is the exact light on average: 6000 samples at a mirror point of each plate
    let worst = 0
    M.SIGMAS.forEach((sg, p) => {
        const x = [1.5, 3.3, 5.1, 6.9][p], ex = M.exactAt(x, sg), R = rng(31 + p), sum = [0, 0, 0], sq = [0, 0, 0], n = 6000
        for (let i = 0; i < n; i++) { const e = M.estimates(x, sg, R); for (let m = 0; m < 3; m++) { sum[m] += e[m]; sq[m] += e[m] * e[m] } }
        for (let m = 0; m < 3; m++) { const mean = sum[m] / n, se = Math.sqrt((sq[m] / n - mean * mean) / n); worst = Math.max(worst, Math.abs(mean - ex) / se) }
    })
    ok('ch.15: lamp points, plate directions and MIS each average to the exact light (within 4 error bars)', worst < 4, worst.toFixed(2))
    const run = st => { const s = { ...M.figures.plates.state, ...st }; M.figures.plates.work.reset(s); while (M.figures.plates.work.add(s, 1e9)); return M.figures.plates.readout(s) }
    const r256 = run({ max: 256 })
    ok('ch.15: after 256 samples the error bars are 13%, 12% and 6% of the light', r256.includes('lamps 13%') && r256.includes('directions 12%') && r256.includes('MIS 6%'), r256)
    const w = k => M.figures.weights.readout({ ...M.figures.weights.state, ...M.figures.weights.steps[k] })
    ok('ch.15: the weights figure: 0.99 for the tiny lamp on the rough plate, 1.00 for the sharp plate under the long lamp',
        w('rough').includes('weights 0.99 for the lamp') && w('sharp').includes('1.00 for the plate'), [w('rough'), w('sharp')].join(' | '))
}

{
    const E = await import('../ch/emitters.js'), tb = readFileSync(join(REPO, 'lib/pathtracer/core/tracebasics.js'), 'utf8')
    const K = +/const LUM_K: f32 = ([\d.]+);/.exec(tb)[1], decay = +/const LUM_DECAY: u32 = (\d+)u;/.exec(tb)[1]
    ok('ch.16: the log code\'s constants are tracebasics.js\'s: 2^24 / 80 codes a stop, a tenth\'s fade', K === E.LUM_K && decay === Math.round(-Math.log2(0.9) * K)
        && /lumEncode\(lum: f32\) -> u32 \{ return u32\(clamp\(log2\(max\(lum, 1e-30\)\) \+ 40\.0, 0\.0, 80\.0\) \* LUM_K\) \+ 1u; \}/.test(tb))
    ok('ch.16: the log code keeps order and comes back within a step (4.8e-6 of a stop), 1e-12 to 1e12', [1e-12, 1e-3, 1, 2e4, 1.6e9, 1e12].every((v, i, a) =>
        Math.abs(Math.log2(E.lumDecode(E.lumEncode(v)) / v)) <= 80 / 2 ** 24 && (i === 0 || E.lumEncode(v) > E.lumEncode(a[i - 1]))) && Math.abs(80 / 2 ** 24 - 4.77e-6) < 1e-8)
    ok('ch.16: the old code: 0 below 1/16, the same for everything from 1e5 up', E.oldCode(0.05) === 0 && E.oldCode(1e5) === E.oldCode(1.6e9))
    const c = E.crofton(1, 40000)
    ok('ch.16: random lines cross each shape as its length predicts, within 4 counting errors', E.CROFTON_SHAPES.every((sh, k) => Math.abs(c.count[k] - c.n * sh.len / (Math.PI * E.RC)) < 4 * Math.sqrt(c.n * sh.len / (Math.PI * E.RC))),
        c.count.join(' '))
    const BINS = 12, h = new Array(BINS).fill(0); for (const cs of c.cosines) h[Math.min(BINS - 1, Math.floor(Math.acos(Math.min(1, cs)) / (Math.PI / 2) * BINS))]++
    ok('ch.16: ...at angles spread as a matte surface\'s cosine', h.every((v, i) => Math.abs(v / c.cosines.length - (Math.sin((i + 1) * Math.PI / 24) - Math.sin(i * Math.PI / 24))) < 0.006))
    const d = E.discover(2, 1), d8 = E.discover(2, 8)
    ok('ch.16: the first sample finds the ball (28 hits) and the bar behind the wall (2)', E.figures.discovery.readout({ seed: 2, samples: 1 }).includes('the ball: 28 hits') && E.figures.discovery.readout({ seed: 2, samples: 1 }).includes('the bar behind the wall: 2 hits'), E.figures.discovery.readout({ seed: 2, samples: 1 }))
    ok('ch.16: cells only gain hits as samples add up', d8.cells.size >= d.cells.size)
    const epoch = +/export const EMIT_EPOCH = (\d+)/.exec(readFileSync(join(REPO, 'lib/pathtracer/core/raytrace_main.js'), 'utf8'))[1]
    ok('ch.16: the figure lists its cells as often as raytrace_main.js EMIT_EPOCH rebuilds the list, nothing after one sample', epoch === E.EMIT_EPOCH
        && E.figures.discovery.readout({ seed: 2, samples: 1 }).includes('none listed yet') && E.figures.discovery.readout({ seed: 2, samples: 8 }).includes('cells listed'), epoch)
}

{
    const L = await import('../ch/lens.js'), { cameraRayLens, cameraRay3 } = await import('../kit/space.js')
    let worst = 0
    for (const [R, D, h, F] of [[0.6, 3.2, 0.9, 6], [0.3, 9, -1.2, 4], [1.1, 2, 2.5, 9.5], [0.05, 7, 0, 7.2]]) worst = Math.max(worst, Math.abs(L.blurSeen(R, D, h, F) - L.blurFormula(R, D, F)))
    ok('ch.17: lens.js lensImage gives the thin lens\'s blur, 2R |1/F - 1/D| over tan(fov/2), and none at the focus', worst < 1e-12 && L.blurSeen(0.6, 6, 0.9, 6) < 1e-12, worst)
    const r = L.figures.thin.readout({ ...L.figures.thin.state, ...L.figures.thin.steps.near })
    ok('ch.17: the near step\'s blur is 2R|1/F - 1/D| = 0.175, over tan 20 deg = 0.364: 0.48 of the half-height, 240 pixels of 1000', r.includes('= 0.1750') && r.includes('= 0.364: 0.4808') && r.includes('measured from the rays: 0.4808') && r.includes('240 pixels'), r)
    const cam = { eye: [0.2, -0.4, 1.1], target: [4, 1, 0.3], fov: 0.7 }, a = cameraRayLens(cam, 7, 33, 80, 50, 0.21, 0.83, 0, 3, 0.5, 0.5), b = cameraRay3(cam, 7, 33, 80, 50, 0.21, 0.83)
    ok('ch.17: a lens of radius 0 is the pinhole\'s ray, from the eye', a.o.every((v, k) => v === cam.eye[k]) && a.d.every((v, k) => Math.abs(v - b[k]) < 1e-15))
    // every ray from the lens for one picture point meets the pinhole's ray at the focus distance along the axis
    const F = 3.7, f = (() => { const d = [cam.target[0] - cam.eye[0], cam.target[1] - cam.eye[1], cam.target[2] - cam.eye[2]], l = Math.hypot(...d); return d.map(v => v / l) })()
    let gap = 0
    for (const [l1, l2] of [[0.1, 0.2], [0.9, 0.7], [0.5, 0.05]]) {
        const q = cameraRayLens(cam, 7, 33, 80, 50, 0.21, 0.83, 0.3, F, l1, l2), t = F / (q.d[0] * f[0] + q.d[1] * f[1] + q.d[2] * f[2]) - ((q.o[0] - cam.eye[0]) * f[0] + (q.o[1] - cam.eye[1]) * f[1] + (q.o[2] - cam.eye[2]) * f[2]) / (q.d[0] * f[0] + q.d[1] * f[1] + q.d[2] * f[2])
        const P = q.o.map((v, k) => v + q.d[k] * t), tb = F / (b[0] * f[0] + b[1] * f[1] + b[2] * f[2]), Pb = cam.eye.map((v, k) => v + b[k] * tb)
        gap = Math.max(gap, Math.hypot(P[0] - Pb[0], P[1] - Pb[1], P[2] - Pb[2]))
    }
    ok('ch.17: through the lens, a picture point\'s rays all meet the pinhole\'s on the focus plane', gap < 1e-12, gap)
}

{
    const P = await import('../ch/photometry.js'), { sunCone, discLuminance } = await import('../../lib/pathtracer/core/photometry.js')
    // the panel: every pixel's covered share, summed, against the square's exact illuminance, and against I / d^2 far off
    const errs = [1, 2, 4, 8, 10].map(d => Math.abs(P.panelSeen(d, 0.5).E / P.panelE(d, 0.5) - 1))
    ok('ch.5: a panel\'s pixels, each its covered share, bring the eye its exact lux, 4Ls atan s, within 0.02% from 1 m to 10 m', Math.max(...errs) < 2e-4, errs.map(e => e.toExponential(1)).join(' '))
    ok('ch.5: ...which tends to L a^2 / d^2 once the panel is small beside its distance', Math.abs(P.panelE(100, 0.5) / (P.PANEL_L * 0.25 / 1e4) - 1) < 1e-4)
    const near = P.panelSeen(2, 0.5), far = P.panelSeen(4, 0.5)
    ok('ch.5: the page\'s counts: 294 whole and 106 edge pixels at 2 m, 39 and 61 at 4 m; 61.2 and 15.5 lux', near.whole === 294 && near.part === 106 && far.whole === 39 && far.part === 61
        && near.E.toFixed(1) === '61.2' && far.E.toFixed(1) === '15.5', `${near.whole} ${near.part} ${far.whole} ${far.part} ${near.E} ${far.E}`)
    // the sun: L cos summed over the disc's directions gives back the illuminance it was derived from
    const c = sunCone(0.53), L = discLuminance(1e5, c.half), N = 4000
    let E = 0
    for (let k = 0; k < N; k++) { const t = (k + 0.5) / N * c.half; E += L * Math.cos(t) * Math.sin(t) * 2 * Math.PI * c.half / N }
    ok('ch.5: discLuminance: 1.488e9 cd/m2 at 0.53 degrees, and L cos over the disc sums back to 100,000 lux', Math.abs(L / 1.488e9 - 1) < 1e-3 && Math.abs(E / 1e5 - 1) < 1e-6, `${L} ${E}`)
    ok('ch.5: the comments\' numbers: the half-angle 0.004625 (not 0.00465 "across"), 1 - cos 1.07e-5 (not 1.08e-5), about 180 f32 steps below 1',
        Math.abs(c.half - 0.0046251) < 1e-7 && Math.abs(c.oneMinusCos - 1.0696e-5) < 1e-9 && Math.round((1 - Math.fround(Math.cos(c.half))) / 2 ** -24) === 179, (1 - Math.fround(Math.cos(c.half))) / 2 ** -24)
    ok('ch.5: L x solid angle is 2 / (1 + cos) of the exact: 0.0005% at the real sun, 0.19% at 10 degrees across, 1% near 23',
        Math.abs(P.solidAngleError(c.half) - 5.35e-6) < 5e-8 && Math.abs(P.solidAngleError(sunCone(10).half) - 0.0019) < 1e-4 && Math.abs(P.solidAngleError(sunCone(22.8).half) - 0.01) < 3e-4)
    // a cosine-weighted bounce off a level floor lands in the disc as often as its projected solid angle says
    const R = rng(91), half = sunCone(10).half, el = Math.PI / 4, sd = [Math.cos(el), 0, Math.sin(el)], M = 400000
    let hit = 0
    for (let k = 0; k < M; k++) {
        const r = Math.sqrt(R()), ph = 2 * Math.PI * R(), d = [r * Math.cos(ph), r * Math.sin(ph), Math.sqrt(1 - r * r)]
        if (d[0] * sd[0] + d[1] * sd[1] + d[2] * sd[2] >= Math.cos(half)) hit++
    }
    const want = P.findChance(half, el) * M
    ok('ch.5: a random bounce finds a 10-degree sun at 45 degrees 1 time in 186, within 4 counting errors', Math.abs(hit - want) < 4 * Math.sqrt(want) && Math.round(1 / P.findChance(half, el)) === 186, `${hit} against ${want.toFixed(0)}`)
    // the floor: rho E / pi is the test's own expected column (docs/TESTING.md, third run)
    const T = readFileSync(join(REPO, 'docs/TESTING.md'), 'utf8')
    const want3 = [['both', 45, '21826.0'], ['sun', 45, '18006.3'], ['sky', 45, '3819.7'], ['sun', 20, '8709.5']]
    ok('ch.5: rho E / pi gives the expected column of the measured floor rows, which TESTING.md records with them', want3.every(([m, h, x]) => P.floorL(h, 0.8, m !== 'sky', m !== 'sun').toFixed(1) === x)
        && P.MEASURED.every(([, , v]) => T.includes(`| ${v.toFixed(1)} |`)), want3.map(([m, h]) => P.floorL(h, 0.8, m !== 'sky', m !== 'sun').toFixed(1)).join(' '))
    const tests = readFileSync(join(REPO, 'lib/pathtracer/tests.js'), 'utf8'), sch = readFileSync(join(REPO, 'lib/pathtracer/core/uniforms.schema.js'), 'utf8')
    ok('ch.5: the figures\' 100,000 and 15,000 lux and albedo 0.8 are the renderer\'s defaults and the test\'s floor', P.SUN_E === +/sunIlluminance:\s*\{ type: 'f32', def: (\d+)/.exec(sch)[1]
        && P.SKY_E === +/skyIlluminance:\s*\{ type: 'f32', def: (\d+)/.exec(sch)[1] && /const FLOOR_ALBEDO = 0\.8\b/.test(tests))
}

{
    const K = await import('../ch/colour.js'), C = await import('../../lib/pathtracer/core/colorimetry.js')
    // the screen's triangle is Rec.709's, from colorimetry.js's own matrix; its white D65
    const want = [[0.64, 0.33], [0.30, 0.60], [0.15, 0.06]]
    ok('ch.6: the triangle is Rec.709\'s primaries and its white D65, from the renderer\'s matrix', K.PRIMARIES.every((p, i) => Math.hypot(p[0] - want[i][0], p[1] - want[i][1]) < 2e-4)
        && Math.hypot(K.D65[0] - 0.3127, K.D65[1] - 0.3290) < 2e-4)
    // a hot body through the fit lands on the standard's line to within the fit's error, as the page says
    const bb = T => C.xyToCctDuv(...K.lightXYZ({ mode: 'bb', T }).xy)
    ok('ch.6: a hot body through the fitted curves reads 3024 K, Duv +0.0004, at 3000 K, and within 1% and 0.001 from 2700 to 10,000 K', Math.round(bb(3000).cct) === 3024 && bb(3000).duv.toFixed(4) === '0.0004'
        && [2700, 4000, 6500, 10000].every(T => Math.abs(bb(T).cct / T - 1) < 0.01 && Math.abs(bb(T).duv) < 1e-3))
    // the page's numbers, from the figures' own readouts
    const r = (f, st) => K.figures[f].readout({ ...K.figures[f].state, ...K.figures[f].steps[st] })
    ok('ch.6: the page\'s numbers: 6500 K is 1.042, 0.984, 1.034; the royal blue 1.452, −2.568, 35.011, clipped 1.127, 0, 10.533', r('match', 'white').includes('1.042, 0.984, 1.034')
        && r('xy', 'blue').includes('1.452, −2.568, 35.011') && r('xy', 'blue').includes('on the screen: 1.127, 0.000, 10.533'), r('xy', 'blue'))
    ok('ch.6: the user\'s three LEDs to 4000 K: 310.5 / 673.0 / 16.5 lm, their mix at the target; 1500 K needs −0.6 lm of blue', r('mix', 'mix').includes('red 310.5 lm + green 673.0 lm + blue 16.5 lm')
        && r('mix', 'warm').includes('blue -0.6 lm') && r('mix', 'warm').includes('not reachable'))
    const P = [[0.69, 0.3], [0.205, 0.7], [0.15, 0.025]], T4 = C.planckXy(4000), m = C.mixToTarget(P, T4, 1000), got = K.mixedXy(P, m.flux)
    ok('ch.6: ...and the three lights summed have exactly the target\'s chromaticity', Math.hypot(got[0] - T4[0], got[1] - T4[1]) < 1e-12)
    // the clip keeps luminance; a swatch never leaves 0-255
    const blue = C.rgbFromXy(0.15, 0.025), c = C.gamutClip(blue), Y = v => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
    ok('ch.6: the display\'s clip keeps the luminance and leaves no negative channel; a swatch stays in 0-255', Math.abs(Y(c) - Y(blue)) < 1e-12 && Math.min(...c) >= 0
        && K.swatchRGB(blue).every(v => v >= 0 && v <= 255))
    // the locus comment's "within about 3e-4": 3.8e-4 at 2856 K against the test's table
    const REF = [[2000, 0.5267, 0.4133], [2856, 0.4476, 0.4074], [3000, 0.4369, 0.4041], [4000, 0.3805, 0.3768], [5000, 0.3451, 0.3516], [6500, 0.3135, 0.3236], [10000, 0.2807, 0.2884]]
    const errs = REF.map(([T, x, y]) => { const p = C.planckXy(T); return Math.hypot(p[0] - x, p[1] - y) }), worst = Math.max(...errs)
    ok('ch.6: the hot bodies\' line is 3.8e-4 from the table at worst, at 2856 K (the comment: "about 3e-4")', worst.toExponential(1) === '3.8e-4' && REF[errs.indexOf(worst)][0] === 2856, worst)
}

{
    const X = await import('../ch/pixels.js'), PH = await import('../../lib/pathtracer/core/photometry.js'), AE = readFileSync(join(REPO, 'lib/pathtracer/core/autoexposure.js'), 'utf8')
    // the meter mirror: one luminance everywhere meters at its own bin's centre, a third of a stop from the exact EV
    const one = X.meter(new Array(1000).fill(500))
    ok('ch.7: the meter on a scene of one luminance gives that luminance\'s EV, within half a bin', Math.abs(one.evAvg - PH.meterEV100(500)) <= 44 / 128 / 2 + 1e-9 && one.ev === one.evAvg, `${one.evAvg} ${PH.meterEV100(500)}`)
    // black below the floor does not vote; with blackVotes it drags the average down once past the 10% cut
    const room = X.pixels('room', 0), dark = X.pixels('room', 0.6)
    ok('ch.7: black pixels change nothing unless they vote', Math.abs(X.meter(room).ev - X.meter(dark).ev) < 1e-12 && X.meter(dark, { blackVotes: true }).evAvg < X.meter(dark).evAvg - 5)
    // the page's numbers
    const r = st => X.figures.meter.readout({ ...X.figures.meter.state, ...X.figures.meter.steps[st] })
    ok('ch.7: the page\'s meter numbers: outdoors EV 15.87 (white 7.16e+4), the room 4.86 protected to 6.82, black voting 1.07', r('outdoors').includes('EV 15.87') && r('outdoors').includes('7.16e+4')
        && r('room').includes('EV 4.86') && r('room').includes('chosen: EV 6.82') && r('unprotected').includes('chosen: EV 4.86') && r('black').includes('chosen: EV 1.07'), r('room'))
    // the mirror's constants are the kernel's, and its last step the kernel's lines
    const aeConst = k => +new RegExp(`export const ${k} = (-?[\\d.]+)`).exec(AE)[1]
    ok('ch.7: the mirror\'s constants are autoexposure.js\'s, and the kernel takes the darker of the average and the highlight rule', ['AE_BINS', 'AE_LOG_MIN', 'AE_LOG_MAX', 'AE_LOW', 'AE_HIGH', 'AE_PROTECT'].every(k => aeConst(k) === X[k])
        && X.meter(room).ev === Math.max(X.meter(room).evAvg, X.meter(room).evHi)
        && /let evTarget = max\(meterEV100\(exp2\(logL\)\), evHi\);/.test(AE) && /let evHi = logHi - log2\(EV_CLIP\) - max\(UB\.aeHeadroom, 0\.0\);/.test(AE) && /if \(Y >= exp2\(AE_LOG_MIN\)\)/.test(AE))
    // the meter's average lands at 12.5/120 of white, which sRGB shows at about 0.36
    ok('ch.7: a metered luminance shows at 12.5/120 = 0.104 of white, and sRGB lifts it to 0.356', Math.abs(1234 * PH.ev100ToScale(PH.meterEV100(1234)) - 12.5 / 120) < 1e-12 && X.srgb(12.5 / 120).toFixed(3) === '0.356')
    // the tone ports at points their formulas give by hand
    const g = (id, v) => X.display([v, v, v], id)[0]
    ok('ch.7: the tone ports: none clips at white; Neutral is the identity less its toe offset below 0.76 (0.5 shows sRGB(0.46)); Reinhard is L/(1+L); Hable 1 at its white 11.2/2',
        Math.abs(g('none', 1) - 1) < 1e-12 && g('none', 3) === g('none', 1) && Math.abs(g('neutral', 0.5) - X.srgb(0.46)) < 1e-12 && Math.abs(X.toneReinhard([1, 1, 1])[0] - 0.5) < 1e-12 && Math.abs(X.toneHable([5.6, 5.6, 5.6])[0] - 1) < 1e-12)
    ok('ch.7: every curve keeps grey grey and rises with the light', X.CURVES.every(([id]) => { let prev = -1; for (let st = -8; st <= 4; st += 0.5) { const c = X.display([2 ** st, 2 ** st, 2 ** st], id); if (Math.abs(c[0] - c[1]) > 2e-3 || Math.abs(c[1] - c[2]) > 2e-3 || c[0] < prev - 1e-9) return false; prev = c[0] } return true }))
    const rc = st => X.figures.curve.readout({ curve: st })
    ok('ch.7: the page\'s curve numbers: none 99 at 3 stops under, Neutral 240 at white, AgX 202 at white', rc('none').includes('shows 99 of 255') && rc('neutral').includes('at white 240') && rc('agx').includes('at white 202'))
    const re = X.figures.encode.readout({ top: 0.1 })
    ok('ch.7: the darkest tenth gets 27 codes kept linearly, 90 as sRGB', re.includes('27 of the 256 codes kept linearly, 90 kept as sRGB'), re)
}

{
    const D = await import('../ch/diffuse.js'), F = await import('../kit/flatland.js'), MF = readFileSync(join(REPO, 'lib/pathtracer/core/microfacet.js'), 'utf8')
    // flatland's mirror: a ray down at 45 degrees onto a mirror floor leaves up at 45 degrees, carrying the albedo
    const world = { sky: 1, shapes: [{ kind: 'box', c: [0, -1], h: [5, 1], albedo: 0.8, mirror: true }] }, rec = []
    const Lm = F.tracePath(world, -1, 1, Math.SQRT1_2, -Math.SQRT1_2, { rand: F.rng(1), maxBounce: 3, record: rec })
    const out = rec[1], dir = [out.b[0] - out.a[0], out.b[1] - out.a[1]], l = Math.hypot(...dir)
    ok('ch.8: a mirror sends a ray out at the angle it came in, with its albedo', Math.abs(dir[0] / l - Math.SQRT1_2) < 1e-9 && Math.abs(dir[1] / l - Math.SQRT1_2) < 1e-9 && Math.abs(Lm - 0.8) < 1e-12, `${dir} ${Lm}`)
    // the matte figure's numbers: E = cos / 2.6, L = rho E / 2
    const m = D.matteOut(35, 0.7)
    ok('ch.8: the matte point at 35 degrees: E 0.3151, its radiance 0.1103 every way', m.E.toFixed(4) === '0.3151' && m.L.toFixed(4) === '0.1103')
    // the room: the mirror shows the lamp at 0.95, which only a bounce can find with NEE on
    const r0 = D.render('mirror', { wall: 'matte', max: 96 }), r1 = D.render('mirror', { wall: 'mirror', max: 96 }), top = Math.max(...r1.pix.map(p => p.Y))
    ok('ch.8: the matte room averages 0.1320; with a mirror, a pixel sees the lamp at 0.950', D.figures.mirror.readout(r0).includes('average 0.1320') && Math.abs(top - 0.95) < 1e-12, top)
    // the furnace: exact at albedo 1, matte or mirror, on every path; the page's other numbers
    const w = D.render('furnace', { rho: 1, surface: 'matte', cap: 40, max: 48 }), wm = D.render('furnace', { rho: 1, surface: 'mirror', cap: 40, max: 48 })
    ok('ch.8: the white furnace: every pixel exactly 1, with no noise, matte and mirror', [w, wm].every(r => r.pix.every(p => p.Y === 1 && p.V === 0)))
    const fr = st => D.figures.furnace.readout(D.render('furnace', { ...D.figures.furnace.steps[st], max: 48 }))
    ok('ch.8: grey 0.8128, a cap of one bounce 0.9963', fr('grey').includes('average 0.8128') && fr('cap').includes('average 0.9963'), fr('cap'))
    // makeMirror's "tiny value (e.g., 0.02)": below ALPHA_MIN, still a delta; the first blur at sqrt(ALPHA_MIN)
    const AM = +/export const ALPHA_MIN = ([\d.e-]+)/.exec(MF)[1]
    ok('ch.8: a roughness of 0.02 is an alpha of 0.0004, under ALPHA_MIN 0.001: still a mirror; the first blur at 0.0316', 0.02 ** 2 < AM && Math.sqrt(AM).toFixed(4) === '0.0316')
}

{
    const M = await import('../ch/microfacets.js'), MFs = readFileSync(join(REPO, 'lib/pathtracer/core/microfacet.js'), 'utf8')
    // GGX's D is a density of facet normals: the projected area sums to 1, D(h) cos theta_h over the half-sphere
    const sumD = a => { let acc = 0; const N = 2000; for (let k = 0; k < N; k++) { const t = (k + 0.5) / N * Math.PI / 2; acc += M.D([Math.sin(t), 0, Math.cos(t)], a) * Math.cos(t) * Math.sin(t) * 2 * Math.PI * (Math.PI / 2 / N) } return acc }
    ok('ch.9: the mirror\'s GGX D integrates to 1 (projected), at alpha 0.05, 0.3 and 1', [0.05, 0.3, 1].every(a => Math.abs(sumD(a) - 1) < 2e-3), [0.05, 0.3, 1].map(sumD).join(' '))
    // the visible-normal draw has the density it claims: a histogram of reflected directions against G1 D / (4 o.z)
    const a = 0.3, o = [Math.sin(0.7), 0, Math.cos(0.7)], R = rng(5), n = 200000, cap = 0.25
    let inCone = 0; const c = [0, 0, 1]
    for (let k = 0; k < n; k++) { const i = M.reflect(o, M.vndf(o, a, [R(), R()])); if (i[2] > 0 && i[0] * c[0] + i[1] * c[1] + i[2] * c[2] > Math.cos(cap)) inCone++ }
    let want = 0; const NT = 200, NP = 200
    for (let t = 0; t < NT; t++) for (let q = 0; q < NP; q++) { const th = (t + 0.5) / NT * cap, ph = (q + 0.5) / NP * 2 * Math.PI, i = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)]; want += M.pdfReflect(o, i, a) * Math.sin(th) * (cap / NT) * (2 * Math.PI / NP) }
    ok('ch.9: directions drawn by visible normals land in a cone as often as G1 D / (4 o.z) says', Math.abs(inCone / n - want) < 4 * Math.sqrt(want / n), `${inCone / n} against ${want}`)
    ok('ch.9: Smith G1 <= 1, G2 <= G1', [[0.3, 0.2], [0.9, 0.6], [0.05, 1]].every(([t1, t2]) => { const w1 = [Math.sin(t1), 0, Math.cos(t1)], w2 = [-Math.sin(t2), 0, Math.cos(t2)]; return M.G1(w1, 0.5) <= 1 && M.G2(w1, w2, 0.5) <= M.G1(w1, 0.5) }))
    // the old grid's number, as microfacet.js's comment records it; the warped grid closer; the old density right straight on
    ok('ch.9: the plain 32 x 32 grid gives 0.97850 at roughness 0.3, 60 degrees (the comment\'s number); converged about 0.9751; warped 0.97556',
        M.albedo(0.5, 0.3, 32, false).toFixed(5) === '0.97850' && Math.abs(M.albedo(0.5, 0.3, 400, true) - 0.9751) < 2e-4 && M.albedo(0.5, 0.3, 32, true).toFixed(5) === '0.97556' && MFs.includes('0.97850 for 0.97505'))
    const r = (f, st) => M.figures[f].readout({ ...M.figures[f].state, ...M.figures[f].steps[st] })
    ok('ch.9: the old density is the true one straight down, 0.154 to 1.623 of it at 60 degrees, from 0.023 at 80', r('oldpdf', 'straight').includes('1.000 to 1.000') && r('oldpdf', 'slant').includes('0.154 to 1.623') && r('oldpdf', 'grazing').includes('0.023 to'), r('oldpdf', 'slant'))
    ok('ch.9: the page\'s numbers: E 0.8012 at roughness 0.6, 40 degrees; a compensated metal at roughness 0.3 reads 0.9965 with the plain table', r('lobe', 'rough').includes('E = 0.8012') && r('albedo', 'r03').includes('reads 0.9965'), r('albedo', 'r03'))
    // the mirror's formulas are microfacet.js's, line for line where the WGSL can be read
    ok('ch.9: the mirror follows the WGSL: Lambda, G2, D and the reflect density', /return 0\.5 \* \(-1\.0 \+ sqrt\(1\.0 \+ t2\)\);/.test(MFs) && /return 1\.0 \/ \(1\.0 \+ mfLambda\(o, a\) \+ mfLambda\(i, a\)\);/.test(MFs)
        && /return 1\.0 \/ \(MF_PI \* a\.x \* a\.y \* t \* t\);/.test(MFs) && /return mfG1\(o, a\) \* mfD\(h, a\) \/ \(4\.0 \* o\.z\);/.test(MFs))
}

/* THE EXCERPT LOCATOR ON ITS OWN ----------------------------------------------------------------------------------- */
{
    const text = [
        '// the why of foo', 'export function foo(a) {', "  const s = '}' // a brace in a string, and one here }", '  return a', '}',
        '/* A BANNER. it says', '   something */', 'const one = x => x * 2', 'fn twice(a: f32) -> f32 { return a; }', 'fn twice(b: f32) -> f32 {', '  return b;', '}',
    ].join('\n')
    const f = locate(text, { sym: 'function foo' })
    ok('excerpt: a function from its comment to its brace, past braces in strings and comments', f.first === 1 && f.last === 5, `${f.first}-${f.last}`)
    const b = locate(text, { sym: 'A BANNER.' })
    ok('excerpt: a symbol in a block comment reaches the comment\'s end', b.first === 6 && b.last === 7, `${b.first}-${b.last}`)
    const c = locate(text, { sym: 'const one', doc: false }), cd = locate(text, { sym: 'const one' })
    ok('excerpt: a one-line const is one line', c.first === 8 && c.last === 8, `${c.first}-${c.last}`)
    ok('excerpt: ...with the comment directly above it, by default', cd.first === 6 && cd.last === 8, `${cd.first}-${cd.last}`)
    let e = null; try { locate(text, { sym: 'fn twice' }) } catch (x) { e = x }
    ok('excerpt: a symbol found twice is refused', /2 times/.test(e?.message ?? ''))
    const n2 = locate(text, { sym: 'fn twice', nth: 2 })
    ok('excerpt: ...and found by nth', n2.first === 10 && n2.last === 12, `${n2.first}-${n2.last}`)
    e = null; try { locate(text, { sym: 'function foo', to: 'nowhere' }) } catch (x) { e = x }
    ok('excerpt: a `to` never reached is refused', /not within/.test(e?.message ?? ''))
    ok('excerpt: the hash ignores indenting', hash(['  a', '    b']) === hash(['a', '  b']) && hash(['a']) !== hash(['b']))
    // the language: inside the file's template literal is WGSL however JavaScript-like the lines, outside it JavaScript
    // however much it talks of f32 -- past a comment with one backtick in it, and a template with a template inside
    const js = ['// a note with one ` in it', "const s = 'a ` too'", 'export const K = /* wgsl */ `', '  ${x ? `y` : ``}',
        '  let pick = PRNG().x;', '`', 'const later = f32 => f32', '/* `', '*/', 'const after = 1'].join('\n')
    ok('excerpt: a line inside the shader string is WGSL', languageOf('a.js', ['let pick = PRNG().x;'], js, 5) === 'WGSL')
    ok('excerpt: ...a line after it JavaScript, f32 or not', languageOf('a.js', ['const later = f32 => f32'], js, 7) === 'JavaScript' && languageOf('a.js', ['x'], js, 10) === 'JavaScript')
}

/* WHAT THE PAGES IMPORT ------------------------------------------------------------------------------------------- */
const reach = new Set()
const importsOf = p => [...readFileSync(p, 'utf8').matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]/gm)].map(m => resolve(dirname(p), m[1]))
const visit = p => { if (reach.has(p)) return; reach.add(p); for (const q of importsOf(p)) visit(q) }
for (const { path } of modules.values()) visit(path)
const outside = [...reach].filter(p => !p.startsWith(TUT)).map(p => relative(REPO, p)).sort()
const gpu = outside.filter(p => p.startsWith('lib/tinywebgpu') || /makeCompute\(|navigator\.gpu/.test(readFileSync(join(REPO, p), 'utf8').replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')))
ok('the pages\' imports never reach the GPU code', !gpu.length, gpu.join(' '))
if (process.argv.includes('--manifest')) {
    console.log('MANIFEST: the engine modules the pages import')
    for (const p of outside) console.log('  ' + p)
    console.log('MANIFEST: the files the pages excerpt')
    for (const p of [...excerpted].sort()) console.log('  ' + p)
}

for (const d of drift) console.log(`CHANGED SINCE CHECKED  ${d}`)
for (const n of notes) console.log(`NOTE  ${n}`)
console.log(`\n${pass} passed, ${fail} failed${drift.length ? `, ${drift.length} excerpts changed since checked (read them, then node tutorial/stamp.mjs)` : ''}`)
process.exit(fail ? 1 : 0)
