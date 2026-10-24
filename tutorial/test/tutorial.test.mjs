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
    ok('affected: ...and finds the chapter that is about the file, planned ones too', inside.some(h => h.kind === 'about' && h.chapter === 'rays') && inside.some(h => h.kind === 'about' && h.chapter === 'wavefront'))
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
    /* THE LAMP NEE AIMS AT IS THE ONE A BOUNCE CAN HIT. The room above has a lamp 0.001 thick and 12,000 paths a pixel,
       and passed while the figures' lamps (0.015 and 0.02 thick) read 9% apart: NEE drew points of the middle line, the
       bounces found the capsule, and NEE also aimed from the last surface, one bounce further than a bounce can reach.
       These hold the two rules with lamps as thick as the figures', and enough paths to see a few percent. */
    const L = 1.3, r = 0.05, lamp = { kind: 'segment', a: [-1.5, 2], b: [0.5, 2.6], r, emit: L }, world = { shapes: [lamp] }
    // the capsule's edges as seen from the origin, facing up: each end's direction turned out by asin(r / distance)
    const pa = Math.atan2(-1.5, 2) - Math.asin(r / Math.hypot(-1.5, 2)), pb = Math.atan2(0.5, 2.6) + Math.asin(r / Math.hypot(0.5, 2.6)), exact = L * (Math.sin(pb) - Math.sin(pa))
    const run = (nee, n, seed) => { const R = rng(seed); let s = 0, s2_ = 0; for (let i = 0; i < n; i++) { const e = directE(world, 0, 0, 0, 1, { nee, rand: R }); s += e; s2_ += e * e } const m = s / n; return { m, se: Math.sqrt((s2_ / n - m * m) / (n - 1)) } }
    const on = run(true, 200000, 31), off = run(false, 200000, 32)
    ok('flat world: a thick lamp by NEE is the capsule\'s light, L (sin phi2 - sin phi1) to its round ends\' tangents', Math.abs(on.m - exact) < 4 * on.se + 2e-4, `${on.m} ± ${on.se} vs ${exact}`)
    ok('...and by bouncing, on average', Math.abs(off.m - exact) < 4 * off.se + 2e-4, `${off.m} ± ${off.se} vs ${exact}`)
    // chapter 14's aim figure: its exact value is the capsule's
    const N14 = await import('../ch/nee.js'), S14 = { ...N14.figures.aim.state }, R14 = rng(9), w14 = {
        shapes: [{ kind: 'box', c: [3, -0.4], h: [5, 0.4], albedo: 0.7 }, { kind: 'segment', a: [S14.lampX - S14.size / 2, 3.4], b: [S14.lampX + S14.size / 2, 3.4], r: 0.02, emit: 0.8 / S14.size }],
    }
    let a14 = 0, b14 = 0; const n14 = 200000
    for (let i = 0; i < n14; i++) { const e = directE(w14, 2.6, 1e-3, 0, 1, { nee: true, rand: R14 }); a14 += e; b14 += e * e }
    const m14 = a14 / n14, se14 = Math.sqrt((b14 / n14 - m14 * m14) / n14)
    ok('ch.14: the aim figure\'s exact value is what aiming at its capsule reads', Math.abs(m14 - N14.exactE(S14)) < 4 * se14 + 3e-4, `${m14} ± ${se14} vs ${N14.exactE(S14)}`)
    // a room with the figures' lamp, capped at one bounce and at six: the same answer with NEE and without
    const Y = await import('../ch/yours.js'), room = { shapes: Y.roomOf(false) }
    for (const cap of [1, 6]) {
        const est = (nee, seed) => { const R = rng(seed); let s = 0, s2 = 0, n = 0; for (let k = 0; k < 300; k++) for (let i = 0; i < 56; i++) { const [ox, oy, dx, dy] = cameraRay(Y.CAM, i, R()); const v = tracePath(room, ox, oy, dx, dy, { nee, maxBounce: cap, rand: R }); s += v; s2 += v * v; n++ } const m = s / n; return { m, se: Math.sqrt((s2 / n - m * m) / n) } }
        const e1 = est(true, 40 + cap), e0 = est(false, 50 + cap)
        ok(`flat world: a room with a lamp 0.015 thick, capped at ${cap} bounce${cap > 1 ? 's' : ''}, reads the same with NEE and without`, Math.abs(e1.m - e0.m) < 4 * Math.hypot(e1.se, e0.se), `${e1.m} ± ${e1.se} vs ${e0.m} ± ${e0.se}`)
    }
    // chapter 14's room: the page's "about a fifth" for the smallest lamp and "about half" for the largest, at 256 samples
    const fr = N14.figures.room, ratio = k => { const s = structuredClone({ ...fr.state, ...fr.steps[k] }); fr.work.reset(s); while (s.spp < 256) fr.work.add(s, 0); return N14.relError(s.on) / N14.relError(s.off) }
    const rs = ratio('small'), rb = ratio('big')
    ok('ch.14: NEE\'s error bar about a fifth of the other\'s with the smallest lamp, about half with the largest', rs > 0.17 && rs < 0.24 && rb > 0.44 && rb < 0.58, `${rs} ${rb}`)
    // ...and the 3D room's "about a fifth" with its largest lamp, at 24 samples
    const f3 = N14.figures.room3, s3 = structuredClone({ ...f3.state, ...f3.steps.big }); f3.work.reset(s3)
    while (s3.spp < 24) f3.work.add(s3, 0)
    const r3 = N14.relError(s3.on.m) / N14.relError(s3.off.m)
    ok('ch.14: in 3D, NEE\'s error bar about a fifth of the other\'s with the largest lamp', r3 > 0.15 && r3 < 0.25, r3)
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
    // the diagram's edge ends where the fitted curves turn back (a reader saw the old one, 380 to 700 nm, cross the map)
    {
        const SP = await import('../../lib/pathtracer/core/spectral.js'), xyAt = l => C.XYZtoxy(SP.cmf(l))
        let lo = 0, hi = 0
        for (let l = 380; l <= 470; l++) if (!lo || xyAt(l)[1] < xyAt(lo)[1]) lo = l
        for (let l = 600; l <= 720; l++) if (!hi || xyAt(l)[0] > xyAt(hi)[0]) hi = l
        ok('ch.6: the diagram\'s edge runs from the fit\'s lowest y (427 nm) to its largest x (644 nm), as the page says', lo === 427 && hi === 644 && K.LOCUS_LO === lo && K.LOCUS_HI === hi
            && K.LOCUS.length === hi - lo + 1, `${lo} ${hi}`)
    }
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
    ok('ch.8: the matte room averages 0.1316; with a mirror, a pixel sees the lamp at 0.950', D.figures.mirror.readout(r0).includes('average 0.1316') && Math.abs(top - 0.95) < 1e-12, top)
    // the furnace: exact at albedo 1, matte or mirror, on every path; the page's other numbers
    const w = D.render('furnace', { rho: 1, surface: 'matte', cap: 40, max: 48 }), wm = D.render('furnace', { rho: 1, surface: 'mirror', cap: 40, max: 48 })
    ok('ch.8: the white furnace: every pixel exactly 1, with no noise, matte and mirror', [w, wm].every(r => r.pix.every(p => p.Y === 1 && p.V === 0)))
    const fr = st => D.figures.furnace.readout(D.render('furnace', { ...D.figures.furnace.steps[st], max: 48 }))
    {
        const gp = D.gapPixels(), g = D.render('furnace', { rho: 0.7, surface: 'matte', cap: 40, max: 48 }).pix.map(p => p.Y), c = D.render('furnace', { rho: 1, surface: 'matte', cap: 1, max: 48 }).pix.map(p => p.Y)
        const darkest = v => v.indexOf(Math.min(...v))
        ok('ch.8: the gap the furnace\'s strip brackets is pixels 17 to 19, and its darkest pixel is in it, grey and capped', gp.join() === '16,17,18' && gp.includes(darkest(g)) && gp.includes(darkest(c)), `${gp} ${darkest(g)} ${darkest(c)}`)
    }
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
    const E = (deg, rough) => M.albedo(Math.cos(deg * Math.PI / 180), rough, 160, true)
    let low = 0; for (let d = 0; d <= 89; d++) if (E(d, 0.3) < E(low, 0.3)) low = d
    ok('ch.9: E at roughness 0.3 is 0.991 straight on and lowest near 85 degrees (0.886); at roughness 1, 0.307 straight on and 0.451 at 60; 19.88% lost at 40 degrees and 17.76% at 78, roughness 0.6',
        E(0, 0.3).toFixed(3) === '0.991' && Math.abs(low - 85) <= 1 && E(85, 0.3).toFixed(3) === '0.886' && E(0, 1).toFixed(3) === '0.307' && E(60, 1).toFixed(3) === '0.451'
        && r('lobe', 'rough').includes('19.88%') && r('lobe', 'grazing').includes('17.76%'), `${low} ${E(0, 1)}`)
    ok('ch.9: the old density is the true one straight down, 0.154 to 1.623 of it at 60 degrees, from 0.023 at 80', r('oldpdf', 'straight').includes('1.000 to 1.000') && r('oldpdf', 'slant').includes('0.154 to 1.623') && r('oldpdf', 'grazing').includes('0.023 to'), r('oldpdf', 'slant'))
    ok('ch.9: the page\'s numbers: E 0.8012 at roughness 0.6, 40 degrees; a compensated metal at roughness 0.3 reads 0.9965 with the plain table', r('lobe', 'rough').includes('E = 0.8012') && r('albedo', 'r03').includes('reads 0.9965'), r('albedo', 'r03'))
    // the mirror's formulas are microfacet.js's, line for line where the WGSL can be read
    ok('ch.9: the mirror follows the WGSL: Lambda, G2, D and the reflect density', /return 0\.5 \* \(-1\.0 \+ sqrt\(1\.0 \+ t2\)\);/.test(MFs) && /return 1\.0 \/ \(1\.0 \+ mfLambda\(o, a\) \+ mfLambda\(i, a\)\);/.test(MFs)
        && /return 1\.0 \/ \(MF_PI \* a\.x \* a\.y \* t \* t\);/.test(MFs) && /return mfG1\(o, a\) \* mfD\(h, a\) \/ \(4\.0 \* o\.z\);/.test(MFs))
}

{
    const G = await import('../ch/glass.js'), FR = await import('../../lib/pathtracer/optics/fresnel.js')
    // the pane's passes, summed, are fresnel.js's closed forms, clear and absorbing
    let worst = 0
    for (const th of [0, 30, 45, 70, 85]) for (const [c, d] of [[1, 0], [0.5, 1], [0.2, 4]]) {
        const P = G.slabPasses(th, 1.5, c, d, 200), want = d > 0 ? FR.absorbingSlabT(th, 1.5, 1, c, d) : FR.slabT(th, 1.5).model
        worst = Math.max(worst, Math.abs(P.T - want))
    }
    ok('ch.10: the pane\'s bounces, summed, are (1 - R)/(1 + R) and absorbingSlabT', worst < 1e-12, worst)
    // Snell at the interface; 4% straight on; total internal reflection past the critical angle; p is 0 at Brewster's
    const a = G.interfaceAt(45, 1.5, 'air'), b = G.interfaceAt(30, 1.5, 'glass')
    ok('ch.10: Snell both ways, 4% straight on, nothing refracted past 41.81 degrees, p 0 at Brewster', Math.abs(Math.sin(45 * Math.PI / 180) - 1.5 * Math.sin(a.thetaT * Math.PI / 180)) < 1e-12
        && Math.abs(1.5 * Math.sin(30 * Math.PI / 180) - Math.sin(b.thetaT * Math.PI / 180)) < 1e-12 && Math.abs(G.interfaceAt(0, 1.5, 'air').R - 0.04) < 1e-12
        && G.interfaceAt(41.9, 1.5, 'glass').t === null && G.interfaceAt(41.7, 1.5, 'glass').t !== null && G.criticalDeg(1.5).toFixed(2) === '41.81'
        && G.interfaceAt(G.brewsterDeg(1.5, 'air'), 1.5, 'air').p < 1e-20)
    // the ball: rays near the axis meet at its paraxial focus n / 2(n - 1)
    ok('ch.10: a ball\'s near-axis rays meet at n / 2(n - 1), for glass, water and diamond', [1.5, 1.33, 2.42].every(n => Math.abs(G.axisCross(0.001, n) - G.ballFocus(n)) < 1e-5))
    const r = (f, st) => G.figures[f].readout({ ...G.figures[f].state, ...G.figures[f].steps[st] })
    ok('ch.10: the page\'s numbers: 28.13 degrees and 5.0% (s 9.2, p 0.8); 48.59 from inside; 90.2 / 90.4 / 90.7%; 45.5 / 50.9% at 78; 45.6 / 41.1 / 52.9% absorbing; 1.500 and 1.104; 2.015; 0.852',
        r('snell', 'air').includes('bends to 28.13°') && r('snell', 'air').includes('s 9.2%, p 0.8%, unpolarised 5.0%') && r('snell', 'inside').includes('bends to 48.59°')
        && r('slab', 'clear').includes('90.2% the first time, 90.4% with every bounce') && r('slab', 'clear').includes('slab: 90.7%') && r('slab', 'steep').includes('45.5% the first time, 50.9%')
        && r('slab', 'absorbing').includes('t = 45.6%') && r('slab', 'absorbing').includes('41.1% with every bounce') && r('slab', 'absorbing').includes('absorbed 52.9%')
        && r('ball', 'glass').includes('meet 1.500') && r('ball', 'glass').includes('0.9 off at 1.104') && r('ball', 'water').includes('meet 2.015') && r('ball', 'diamond').includes('inside the ball, 0.704 past the centre'), r('slab', 'absorbing'))
    // past an index of 2 the near-axis rays cross inside the ball, at the front face's own focus; and no ray lit from
    // outside is ever totally reflected inside a ball (the far side is met at the angle of the bend in, below critical)
    const inside = n => { const sg = G.traceBall(0.001, n).segs[1]; return sg.a[0] + sg.a[1] / (sg.a[1] - sg.b[1]) * (sg.b[0] - sg.a[0]) }
    ok('ch.10: a diamond ball\'s rays cross inside it at n / (n - 1) - 1 = 0.704; no ray in any ball totally reflected', [2.2, 2.42, 2.5].every(n => Math.abs(inside(n) - G.frontFocus(n)) < 1e-5)
        && G.frontFocus(2.42).toFixed(3) === '0.704' && [1.05, 1.5, 2, 2.42, 2.5].every(n => Array.from({ length: 199 }, (_, k) => (k - 99) / 100).every(h => !G.traceBall(h, n).tir)))
}

{
    const X = await import('../ch/dispersion.js'), SP = await import('../../lib/pathtracer/core/spectral.js'), SPs = readFileSync(join(REPO, 'lib/pathtracer/core/spectral.js'), 'utf8')
    // Cauchy through n_d and V_d: exact at d and in F - C; BK7 within 6e-5 of its catalogue
    const nd = 1.75, vd = 28, F = SP.cauchyN(nd, vd, SP.LAMBDA_F), C = SP.cauchyN(nd, vd, SP.LAMBDA_C)
    ok('ch.11: Cauchy is n_d at d and gives (n_d - 1)/V_d between F and C; BK7 within 6e-5 of its catalogue', Math.abs(SP.cauchyN(nd, vd, SP.LAMBDA_D) - nd) < 1e-12 && Math.abs((nd - 1) / (F - C) - vd) < 1e-9
        && Math.abs(SP.cauchyN(1.5168, 64.17, SP.LAMBDA_F) - 1.52238) < 6e-5 && Math.abs(SP.cauchyN(1.5168, 64.17, SP.LAMBDA_C) - 1.51432) < 6e-5)
    // through the prism: Snell at both faces for each wavelength; at least deviation the d line leaves level-symmetric; no dispersion, one angle
    const fl = st => X.figures.prism.readout({ ...X.figures.prism.state, ...X.figures.prism.steps[st] })
    ok('ch.11: the flint fans blue 3.24 degrees more than red, BK7 0.71, none 0.00', fl('flint').includes('blue bent 3.24°') && fl('bk7').includes('blue bent 0.71°') && fl('none').includes('blue bent 0.00°'), fl('flint'))
    const d = X.throughPrism(SP.LAMBDA_D, 1.75, 28, 31)
    ok('ch.11: at a tilt of 31 degrees the flint\'s yellow ray leaves 31 degrees down: least deviation, symmetric', Math.abs(d.angle - 31) < 0.2, d.angle)
    // the draw: each channel's weight averages exactly 1; at most 3
    const exact = [0, 1, 2].map(c => SP.SPEC_PICK.reduce((a, p, k) => a + (p > 0 ? SP.SPEC_WEIGHTS[k][c] : 0), 0))
    const maxw = Math.max(...SP.SPEC_PICK.flatMap((p, k) => p > 0 ? SP.SPEC_WEIGHTS[k].map(w => w / p) : []))
    ok('ch.11: the draw\'s weights average exactly 1 in each channel, and never pass 3', exact.every(v => Math.abs(v - 1) < 1e-12) && maxw <= 3 + 1e-12)
    ok('ch.11: 20,000 draws average 0.993, 1.014, 0.993', X.figures.draw.readout({ n: 20000, seed: 1 }).includes('R 0.993, G 1.014, B 0.993'))
    // the coating: a constant reflectance is that reflectance in every channel; the edge at 45 degrees is the bench's 551.8 nm
    ok('ch.11: a coating that reflects 0.3 everywhere reflects 0.3 in every channel; the edge at 45 degrees moves to 551.8 nm, the bench\'s', SP.edgeRGB(0.3, 0.3, 600, 20).every(v => Math.abs(v - 0.3) < 1e-12)
        && X.coatEdge(600, 45).toFixed(1) === '551.8' && readFileSync(join(REPO, 'docs/TESTING.md'), 'utf8').includes('the edge at 551.8 nm'))
    // the comments' numbers, checked: 15 bits, 40 differences, red 0 from 460 to 552 nm in this fit
    const zero = []; for (let l = 440; l <= 560; l += 0.5) if (SP.rgbBar(l)[0] === 0) zero.push(l)
    ok('ch.11: the tag holds 15 bits from bit 17; 40 bins; red\'s weight 0 from 460 to 552 nm', SP.LAMBDA_SHIFT === 17 && 32 - SP.LAMBDA_SHIFT === 15 && SP.SPEC_BINS === 40 && zero[0] === 460 && zero[zero.length - 1] === 552
        && SPs.includes('is 41 softplus') && SPs.includes('upper 16 bits'), `${zero[0]}-${zero[zero.length - 1]}`)
    const tail = SP.SPEC_PICK.reduce((a, p, k) => a + (SP.SPEC_LO + k * SP.SPEC_STEP >= 730 ? p : 0), 0)
    ok('ch.11: the fit\'s red end: red 0 from 733 nm, and those bins drawn 1.25e-5 of the time', SP.rgbBar(733)[0] === 0 && SP.rgbBar(732)[0] > 0 && tail.toExponential(2) === '1.25e-5', tail)
}

{
    // CHAPTER 18: the flat world's glass, sun, split and light tracer
    const F = await import('../kit/flatland.js'), C = await import('../ch/caustics.js'), { standardError } = await import('../../lib/pathtracer/core/measure.js')
    const DEG = Math.PI / 180
    // pixelOf is cameraRay turned round
    const cam = C.CAM
    ok('ch.18: a point on a pixel\'s middle ray lands back on that pixel', Array.from({ length: cam.pixels }, (_, p) => p).every(p => { const [ox, oy, dx, dy] = F.cameraRay(cam, p, 0.5); return F.pixelOf(cam, ox + dx * 3, oy + dy * 3).px === p }))
    // glass: Snell's law, and Fresnel's share reflected
    const R = F.rng(5), th = 45 * DEG, d = [Math.sin(th), -Math.cos(th)]
    let refl = 0; const N = 40000
    for (let i = 0; i < N; i++) if (F.glassStep(1.5, d[0], d[1], 0, 1, 0, 0, R()).reflected) refl++
    const R45 = F.glassStep(1.5, d[0], d[1], 0, 1, 0, 0, 0.99).R, t = F.glassStep(1.5, d[0], d[1], 0, 1, 0, 0, 0.99)
    ok('ch.18: glass refracts by Snell (sin 45 = 1.5 sin theta_t) and reflects Fresnel\'s share', Math.abs(Math.sin(th) - 1.5 * Math.abs(t.dx)) < 1e-12 && Math.abs(refl / N - R45) < 4 * Math.sqrt(R45 * (1 - R45) / N), `${refl / N} ${R45}`)
    // light tracing against the camera: a floor in the sun, every photon connected (all), against NEE
    const floorOnly = () => { const w = C.worldOf(0.27); w.shapes = w.shapes.filter(s => s.name === 'floor'); w.sun.width = 16; return w }
    const camImg = (world, spp, opts) => { const r = F.rng(7), img = new Float64Array(cam.pixels); for (let s = 0; s < spp; s++) for (let p = 0; p < cam.pixels; p++) { const [ox, oy, dx, dy] = F.cameraRay(cam, p, r()); img[p] += F.tracePath(world, ox, oy, dx, dy, { rand: r, maxBounce: 6, ...opts }) } return Array.from(img, v => v / spp) }
    const ltImg = (world, batches, n, opts) => { const r = F.rng(11), img = new Float64Array(cam.pixels); for (let b = 0; b < batches; b++) { const o = F.lightTrace(world, cam, { n, rand: r, ...opts }); for (let p = 0; p < cam.pixels; p++) img[p] += o.img[p] } return Array.from(img, v => v / batches) }
    const wf = floorOnly(), nee = camImg(wf, 60, { nee: true }), lt = ltImg(wf, 60, 3000, { all: true }), mid = Array.from({ length: 30 }, (_, k) => k + 12)
    // photons are counted, so each pixel carries counting noise (a few hundred connections each): the region's mean
    // is held tight, each pixel loosely
    const worst = Math.max(...mid.map(p => Math.abs(lt[p] / nee[p] - 1))), ratio = mid.reduce((a, p) => a + lt[p], 0) / mid.reduce((a, p) => a + nee[p], 0)
    ok('ch.18: photons connected from a sunlit floor make the camera\'s own picture of it (0.386, rho E / 2): its mean within 1%, every pixel within 15%', Math.abs(ratio - 1) < 0.01 && worst < 0.15 && Math.abs(nee[30] - 0.8 / 2 * F.sunE(wf.sun) * Math.sin(75 * DEG)) < 2e-3, `${ratio} ${worst} ${nee[30]}`)
    // the split: the camera's paths (NEE, no split: right, noisy) against both with the split, under the ball
    const reg = r => { let m = 0, v = 0; for (const i of C.causticPixels) { m += r.pix[i].Y; v += (standardError(r.pix[i].V, r.pix[i].S) ?? 0) ** 2 } return [m / C.causticPixels.length, Math.sqrt(v) / C.causticPixels.length] }
    const [mc, sc] = reg(C.render({ mode: 'camera', half: 1, max: 1500, seed: 2 })), [mb, sb] = reg(C.render({ mode: 'both', half: 1, max: 300, seed: 3 }))
    const [ml] = reg(C.render({ mode: 'light', half: 1, max: 300, seed: 4 })), [mt, st] = reg(C.render({ mode: 'twice', half: 1, max: 300, seed: 3 }))
    ok('ch.18: under the ball, the camera alone and both with the split agree; without it the photons\' share is counted again', Math.abs(mc - mb) < 4 * Math.hypot(sc, sb) && Math.abs(mt - mb - ml) < 4 * st + 0.02 && mt > 1.6 * mb, `${mc}±${sc} ${mb}±${sb} twice ${mt} lt ${ml}`)
    // the open floor is the camera's in every mode but light tracing's own
    const open = C.render({ mode: 'twice', half: 0.27, max: 40 }).pix[40].Y, openB = C.render({ mode: 'both', half: 0.27, max: 40 }).pix[40].Y
    ok('ch.18: the open floor reads the same split or not', Math.abs(open - openB) < 1e-12, `${open} ${openB}`)
    // the page's 400-sample numbers: the bracket and the open floor (pixels 41 to 48), each way
    const at400 = mode => { const r = C.render({ mode, max: 400 }), g = idx => idx.reduce((a, i) => a + r.pix[i].Y, 0) / idx.length; return [g(C.causticPixels).toFixed(3), g(C.openPixels).toFixed(3)].join(' ') }
    ok('ch.18: after 400 samples the bracket reads 0.455 camera, 0.282 photons, 0.313 split, 0.738 not; the open floor 0.388, 0.007, 0.395, 0.395', at400('camera') === '0.455 0.388' && at400('light') === '0.282 0.007'
        && at400('both') === '0.313 0.395' && at400('twice') === '0.738 0.395')
    const sunL = 1 / (2 * Math.sin(0.27 * Math.PI / 180))
    ok('ch.18: a find is the sun\'s 106 times the floor\'s 0.8, 85, and 85 once in 220 is 0.39', Math.round(sunL) === 106 && Math.round(0.8 * sunL) === 85 && (0.8 * sunL / 220).toFixed(2) === '0.39')
    // the learned map: a distribution with its floor; counts halved; the page's numbers
    const L = F.newLearn(8); L.emitted.set([10, 10, 10, 10, 10, 10, 10, 10]); L.hits.set([0, 0, 9, 1, 0, 0, 0, 0]); F.learnRebuild(L)
    const sum = L.p.reduce((a, b) => a + b, 0)
    ok('ch.18: a rebuilt map sums to 1, keeps 20% / K in every cell, gives the rest by hits / emitted, and halves both counts', Math.abs(sum - 1) < 1e-12 && Math.min(...L.p) >= 0.2 / 8 - 1e-15
        && Math.abs(L.p[2] - (0.8 * 0.9 / 1.0 + 0.2 / 8)) < 1e-12 && L.hits[2] === 4 && L.emitted[0] === 5)
    const rd = st2 => C.figures.learn.readout({ ...C.figures.learn.state, ...C.figures.learn.steps[st2] })
    ok('ch.18: the page\'s photons: 176 of 1500 connect evenly, 919 learned after ten samples', rd('uniform').includes('176 connected') && rd('learned').includes('919 connected'), rd('learned'))
    // the kinds: each path's blocked lines are blocked, its open ones open
    const kw = C.kindsWorld(), ph = C.photonPath(kw), f0 = ph.end, up = [Math.cos(75 * DEG), Math.sin(75 * DEG)]
    const sees = (x, y, tx, ty) => F.visible(kw, x, y + 4e-3, tx, ty)
    ok('ch.18: the caustic\'s floor sees the eye but not the sun; through the pane it sees neither', !sees(f0[0], f0[1], f0[0] + up[0] * 30, f0[1] + up[1] * 30) && F.visible(C.worldOf(), f0[0], f0[1] + 4e-3, ...C.CAM.eye) && !sees(f0[0], f0[1], ...C.CAM.eye))
}

{
    // CHAPTER 19: the flat world's photon map, its radius's schedule, the hashed grid
    const F = await import('../kit/flatland.js'), P = await import('../ch/photons.js'), S = await import('../../lib/pathtracer/core/sppm.js')
    // a gather: photons evenly spaced along a floor, power phi each, are an irradiance phi / spacing; a photon on a
    // surface 30 degrees off is another surface's
    const even = Array.from({ length: 2001 }, (_, i) => ({ x: -1 + i * 1e-3, y: 0, nx: 0, ny: 1, flux: 2e-3 }))
    const tilted = { x: 0, y: 0, nx: Math.sin(Math.PI / 6), ny: Math.cos(Math.PI / 6), flux: 5 }
    const gEven = F.gather({}, { photons: [...even, tilted], r: 0.1 }, 0, 0, 0, 1, 0.8)
    ok('ch.19: a gather of photons spread evenly reads (rho / 2) E, and leaves out a surface 30 degrees off', Math.abs(gEven - 0.4 * 2) < 0.4 * 2 * 0.011, gEven)
    // the flat world's schedule shrinks r as the engine's shrinks r^2
    const sched = [2, 10, 300].every(k => [2 / 3, 0.25].every(a => Math.abs(F.radiusFlat(1, k, a) - S.sppmRadius(1, k, a) ** 2) < 1e-12))
    ok('ch.19: radiusFlat(k) / r1 is sppmRadius(k)^2 / r1^2: the gather\'s length shrinks as the engine\'s area', sched && F.radiusFlat(0.25, 300).toFixed(3) === '0.041' && F.radiusFlat(0.25, 300, 0.25).toFixed(4) === '0.0038')
    // the photons' estimate at the peak against the exact rays, over a window: the map gathers what is there
    {
        const world = P.worldOf(false), R = F.rng(99), K = 800, hs = [0.1, 0.25], acc = hs.map(() => [0, 0])
        for (let k = 0; k < K; k++) {
            const store = []; F.lightTrace(world, P.CAM, { n: 600, rand: R, store, connect: false })
            hs.forEach((h, j) => { let t = 0; for (const p of store) if (p.ny > 0.99 && Math.abs(p.y) < 0.01 && Math.abs(p.x - P.X0) < h) t += p.flux; const v = 0.4 * t / (2 * h); acc[j][0] += v; acc[j][1] += v * v })
        }
        const res = hs.map((h, j) => { const m = acc[j][0] / K, se = Math.sqrt((acc[j][1] / K - m * m) / K); return [m, se, P.trueAt(P.X0, h)] })
        ok('ch.19: the photons stored under the ball average to the exact rays\' light over the same window (0.838 within 0.1, 0.623 within 0.25)', res.every(([m, se, t]) => Math.abs(m - t) < 4 * se) && P.trueAt(P.X0, 0.1).toFixed(3) === '0.838' && P.trueAt(P.X0, 0.25).toFixed(3) === '0.623', JSON.stringify(res))
    }
    ok('ch.19: the true value at the peak is 0.938, the caustic\'s brightest', P.TRUE_X0.toFixed(3) === '0.938' && [-0.4, 0, 0.4, 0.6].every(x => P.trueAt(x, 0.004) < P.TRUE_X0))
    // the shrink: a held radius settles on the window's average, a shrinking one goes on towards the truth
    const run = P.shrinkRun(0.25, 2 / 3), f = run.fixed[P.SHRINK_K - 1], g = run.shrink[P.SHRINK_K - 1]
    ok('ch.19: after 300 samples the held radius reads its window\'s 0.623 (within 3%), the shrinking one 0.905, nearer 0.938', Math.abs(f / P.trueAt(P.X0, 0.25) - 1) < 0.03 && g.toFixed(3) === '0.905' && Math.abs(g - P.TRUE_X0) < Math.abs(f - P.TRUE_X0), `${f} ${g}`)
    ok('ch.19: alpha 0.25 overshoots to 1.002 at 300', P.shrinkRun(0.25, 0.25).shrink[P.SHRINK_K - 1].toFixed(3) === '1.002')
    // the map in the whole flat renderer: the caustic seen through the pane, against the camera's own paths given a
    // 3-degree sun (which they find often enough to measure) -- counted once, not twice and not never
    {
        const world = P.worldOf(); world.sun = P.sunOf(3)
        const peak = [23, 24, 25, 26], mom = () => peak.map(() => [0, 0]), add = (m, v) => peak.forEach((i, j) => { m[j][0] += v[i]; m[j][1] += v[i] * v[i] })
        const stat = (m, n) => { let a = 0, v = 0; for (const [s1, s2] of m) { const mu = s1 / n; a += mu; v += (s2 / n - mu * mu) / n } return [a / peak.length, Math.sqrt(v) / peak.length] }
        let R = F.rng(21); const cam = mom(), N1 = 4000
        for (let k = 0; k < N1; k++) { const v = new Float64Array(48); for (const i of peak) { const [ox, oy, dx, dy] = F.cameraRay(P.CAM, i, R()); v[i] = F.tracePath(world, ox, oy, dx, dy, { nee: true, maxBounce: 10, rand: R }) } add(cam, v) }
        R = F.rng(22); const map = mom(), N2 = 200
        for (let k = 0; k < N2; k++) add(map, P.sample(world, true, 0.02, R))
        const [a, sa] = stat(cam, N1), [b, sb] = stat(map, N2)
        ok('ch.19: through the pane, the map and light tracing read the caustic the camera\'s own paths find by chance', Math.abs(a - b) < 4 * Math.hypot(sa, sb) && a > 0.3, `${a}±${sa} map ${b}±${sb}`)
    }
    // the page's numbers, as its figure makes them
    const rdMap = st => P.figures.map.readout(Object.assign(P.render({ on: P.figures.map.steps[st].on, r: P.figures.map.steps[st].r, max: 300 }), P.figures.map.steps[st]))
    ok('ch.19: through the pane, 0.323 ± 0.060 without the map and 0.366 ± 0.003 with it, after 300 samples', rdMap('missing').includes('0.323 ± 0.060') && rdMap('with').includes('0.366 ± 0.003'), rdMap('missing'))
    let finds = 0
    for (let k = 0; k < 300; k++) { const v = P.sample(P.worldOf(), false, 0.06, F.rng(1000003 + k * 7919)); for (const i of P.panePixels) if (v[i] > 3) finds++ }
    ok('ch.19: without the map the camera found the sun through the ball 9 times in those 300 samples', finds === 9, finds)
    const pix = (st, i) => P.render({ on: P.figures.map.steps[st].on, r: P.figures.map.steps[st].r, max: 300 }).pix[i - 1].Y.toFixed(2)
    ok('ch.19: the page\'s pixels: 24 reads 1.45 and 25 0.03 without the map; 25 reads 0.72 with it, 0.49 with r = 0.4', pix('missing', 24) === '1.45' && pix('missing', 25) === '0.03' && pix('with', 25) === '0.72' && pix('wide', 25) === '0.49')
    // the grid against brute force, everywhere; a collision; the budget right over every start
    const ph = P.gridPhotons(), brute = (x, r) => 0.4 * ph.reduce((t, p) => t + (Math.abs(p.x - x) < r ? p.f : 0), 0) / (2 * r)
    let gridOK = true
    for (const r of [0.05, 0.1, 0.15, 0.3, 0.4]) for (let x = -2; x <= 2.4; x += 0.037) if (Math.abs(P.gridGather(x, r).est - brute(x, r)) > 1e-12) gridOK = false
    ok('ch.19: a gather through the grid\'s two cells counts exactly what a walk over every photon counts', gridOK && ph.length === 27)
    ok('ch.19: the figure\'s hash and sub-lists are sppm.js\'s: hashCell, sppmSubsOf, 32 sub-lists', [-11, -3, 0, 1, 5].every(c => P.hash1(c) === S.hashCell(c, 0, 0, 4)) && P.SUBS === S.SPPM_SUBS && P.subsOf(12) === S.sppmSubsOf(12, 6))
    const w = P.gridGather(0.31, 0.15), col = P.gridGather(-0.5, 0.15)
    ok('ch.19: at 0.31 a gather walks 20 records and counts 10; at -0.5 it walks 11, 10 of them other cells\'', w.walked === 20 && w.counted === 10 && col.walked === 11 && col.other === 10 && col.counted === 1 && P.hash1(1) === P.hash1(-3))
    let mean = 0; for (let st = 0; st < P.SUBS; st++) mean += P.gridGather(0.31, 0.15, { budget: true, start: st }).est
    mean /= P.SUBS
    const b0 = P.gridGather(0.31, 0.15, { budget: true, start: 0 })
    ok('ch.19: with the budget a start reads 0.738 (24 and 16 sub-lists), and all 32 starts average to the whole walk\'s 0.615', Math.abs(mean - w.est) < 1e-12 && b0.est.toFixed(3) === '0.738' && w.est.toFixed(3) === '0.615' && b0.split.map(t => t.m).join() === '24,16', mean)
    // the engine's numbers the page states
    ok('ch.19: the engine as the page says: 32 sub-lists, a 512-record budget (64 a cell), alpha 2/3, 44-byte records, 2 million by default (88 MB), a probe every 16 traces, normals within 25.8 degrees', S.SPPM_SUBS === 32 && S.SPPM_VISIT === 512 && S.sppmShare(512) === 64 && S.SPPM_ALPHA === 2 / 3
        && S.SPPM_REC * 4 === 44 && S.SPPM_CAPACITY_DEFAULT * 1e6 * 44 === 88e6 && S.SPPM_PROBE === 16 && (Math.acos(S.SPPM_NORMAL_DOT) * 180 / Math.PI).toFixed(1) === '25.8' && S.SPPM_HEADS === 1 << 20)
    const perf = readFileSync(join(REPO, 'docs/PERFORMANCE.md'), 'utf8'), log = readFileSync(join(REPO, 'CHANGELOG.md'), 'utf8')
    ok('ch.19: the measured numbers are where the page says: 196.0 / 173.3 ms, 22.7 and 16.2; 0.355 / 0.274, 8,315 records', perf.includes('| 1 baked, as it is (map on) | 196.0 |') && perf.includes('| 2 photon map off | 173.3') && perf.includes('22.7 ms a sample at 720p, of which the sppm kernel is 16.2 ms')
        && log.includes('0.61.2 read **0.355** of') && log.includes('**0.274** at 1920 x 1080') && log.includes('8,315 records') && log.includes('| new (two or three seeds) | 0.965, 1.000 | 0.884, 0.891, 0.903 |'))
}

{
    // CHAPTER 20: the flat world's dust against haze.js and closed forms
    const F = await import('../kit/flatland.js'), Z = await import('../ch/haze.js'), HZ = await import('../../lib/pathtracer/core/haze.js')
    // the flat world's phase function: a density round the circle, mean cosine g, drawn as it says
    const phaseOK = [0, 0.7, -0.5, 0.95].every(g => {
        let I = 0, M = 0; const N = 20000
        for (let i = 0; i < N; i++) { const th = -Math.PI + (i + 0.5) / N * 2 * Math.PI, p = F.phase2(Math.cos(th), g); I += p; M += p * Math.cos(th) }
        I *= 2 * Math.PI / N; M *= 2 * Math.PI / N
        const R = F.rng(3), K = 40000; let mc = 0, m2 = 0
        for (let i = 0; i < K; i++) { const [x] = F.phaseSample2(1, 0, g, R()); mc += x; m2 += x * x }
        const mean = mc / K, se = Math.sqrt((m2 / K - mean * mean) / K)
        return Math.abs(I - 1) < 1e-9 && Math.abs(M - g) < 1e-6 && Math.abs(mean - g) < 4 * se + 1e-9
    })
    ok('ch.20: the flat world\'s phase function adds to 1 round the circle, its mean cosine is g, and its draws follow it', phaseOK)
    // the flat world's collision is haze.js's, for the same box and number
    const box = { c: [0.3, -0.2], h: [2, 1], mfp: 1.3 }, u3 = HZ.hazeUniforms({ centre: [0.3, -0.2, 0], half: [2, 1, 1], mfp: 1.3, albedo: [1, 1, 1], g: 0 }, 1, 0)
    let same = true; const Rc = F.rng(9)
    for (let i = 0; i < 2000; i++) {
        const x = -4 + 8 * Rc(), y = -2 + 4 * Rc(), a = 2 * Math.PI * Rc(), u = Rc(), len = 1 + 6 * Rc()
        const t2 = F.hazeCollide2(box, x, y, Math.cos(a), Math.sin(a), len, u), t3 = HZ.hazeCollideJS(u3, [x, y, 0], [Math.cos(a), Math.sin(a), 0], len, 1e6, u)
        if ((t2 < 0) !== (t3 < 0) || (t2 >= 0 && Math.abs(t2 - t3) > 1e-9)) same = false
    }
    ok('ch.20: hazeCollide2 draws the collision haze.js\'s hazeCollideJS draws, ray for ray', same)
    ok('ch.20: the transmittance across the box is e^(-length / mfp)', Math.abs(F.hazeTr2(box, -5, 0, 1, 0, 20) - Math.exp(-4 / 1.3)) < 1e-12 && F.hazeTr2(box, -5, 3, 1, 0, 20) === 1)
    // single scattering from the sun, by light sampling from the air: a camera ray across a box under a sun straight
    // overhead reads albedo p(0) E T_sun (1 - e^(-4 / mfp)), E the sun's illuminance across its rays
    {
        const half = 0.27 * Math.PI / 180, sun = { dir: Math.PI / 2, half, L: 1 / (2 * Math.sin(half)) }
        const world = { sky: 0, sun, shapes: [], haze: { c: [0, 0], h: [2, 1], mfp: 1.5, albedo: 0.8, g: 0.6 } }
        const R = F.rng(13), N = 60000; let a = 0, a2 = 0
        for (let i = 0; i < N; i++) { const v = F.tracePath(world, -5, 0.2, 1, 0, { rand: R, nee: true, maxBounce: 1 }); a += v; a2 += v * v }
        const mean = a / N, se = Math.sqrt((a2 / N - mean * mean) / N)
        const want = 0.8 * F.phase2(0, 0.6) * sun.L * 2 * half * Math.exp(-0.8 / 1.5) * (1 - Math.exp(-4 / 1.5))
        ok('ch.20: sunlit dust seen across reads its single-scattering integral (light sampling from the air)', Math.abs(mean - want) < 4 * se, `${mean} ± ${se} want ${want}`)
    }
    // the room: light sampling from the air and the phase function's bounces alone agree, given a sun they can find (5 degrees)
    {
        const w = Z.roomOf({ half: 5 }), mean = (mode, N, seed) => {
            const R = F.rng(seed); let a = 0, a2 = 0
            for (let k = 0; k < N; k++) { const v = Z.roomSample(w, mode, R); let m = 0; for (const i of Z.beamPixels) m += v[i]; m /= Z.beamPixels.length; a += m; a2 += m * m }
            const mu = a / N; return [mu, Math.sqrt((a2 / N - mu * mu) / N)]
        }
        const [aa, sa] = mean('aim', 500, 11), [pp, sp] = mean('phase', 2000, 12)
        ok('ch.20: across the beam, aiming at the sun from the air and the bounces alone read the same, with a sun they can find', Math.abs(aa - pp) < 4 * Math.hypot(sa, sp), `${aa}±${sa} ${pp}±${sp}`)
    }
    // the dust's furnace: exactly 1, no noise; the controls under it; the eye on the sky reads 1 too
    const fr = o => Z.furnaceRead(Z.renderFurnace({ ...o, max: 200 }).pix)
    const pass = fr({}), black = fr({ disc: 0 }), halfD = fr({ dust: 0.5 }), sky = fr({ disc: 0, aim: 'sky' })
    ok('ch.20: albedo-1 dust round a white disc in a sky of 1 reads 1 with no noise; a black disc 0.558, dust of 0.5 0.447; the eye on the sky 1 again', pass.mean === 1 && pass.spread === 0
        && black.mean.toFixed(3) === '0.558' && halfD.mean.toFixed(3) === '0.447' && sky.mean === 1 && sky.spread === 0, `${pass.mean} ${black.mean} ${halfD.mean} ${sky.mean}`)
    // the pages' numbers
    const h4 = Z.histogram(4, 101), h07 = Z.histogram(0.7, 101)
    ok('ch.20: of 4000 crossings 1453 pass at mfp 4 (1472 expected), 9 at 0.7 (13)', h4.passed === 1453 && Math.round(4000 * Math.exp(-1)) === 1472 && h07.passed === 9 && Math.round(4000 * Math.exp(-4 / 0.7)) === 13)
    ok('ch.20: Henyey-Greenstein adds to 1 over the sphere; 3000 draws\' mean cosine near g', [0, 0.7, -0.5].every(g => Math.abs(Z.sphereIntegral(g) - 1) < 1e-4 && Math.abs(Z.phaseDraws(g, 1).mean - g) < 0.03))
    const rest = [...Array(48).keys()].filter(i => !Z.beamPixels.includes(i) && !Z.patchPixels.includes(i))
    const room = st => { const s = Z.renderRoom({ ...Z.figures.beam.steps[st], max: 300 }); return { b: Z.regionOf(s.pix, Z.beamPixels), p: Z.regionOf(s.pix, Z.patchPixels), r: Z.regionOf(s.pix, rest), pix: s.pix } }
    const rc = room('clear'), rp = room('phase'), ra = room('aim'), rb = room('back'), rt = room('thick')
    ok('ch.20: the room\'s numbers: no dust, the patch 0.120 and across the beam 0.002; bounces alone 0.0038 ± 0.0003, the patch 0.025 and pixel 46 0.19 ± 0.19; aimed 0.0096 ± 0.0006, the rest 0.003, the patch 0.035; g -0.5 0.0047; mfp 1 0.0013 and 0.0014',
        rc.p.mean.toFixed(3) === '0.120' && rc.b.mean.toFixed(3) === '0.002' && rp.b.mean.toFixed(4) === '0.0038' && rp.b.se.toFixed(4) === '0.0003' && rp.p.mean.toFixed(3) === '0.025'
        && rp.pix[45].Y.toFixed(2) === '0.19' && Z.regionOf(rp.pix, [45]).se.toFixed(2) === '0.19' && Math.max(...rp.pix.map(q => q.Y)) === rp.pix[45].Y
        && ra.b.mean.toFixed(4) === '0.0096' && ra.b.se.toFixed(4) === '0.0006' && ra.r.mean.toFixed(3) === '0.003' && ra.p.mean.toFixed(3) === '0.035' && rb.b.mean.toFixed(4) === '0.0047'
        && rt.b.mean.toFixed(4) === '0.0013' && rt.p.mean.toFixed(4) === '0.0014' && Z.patchPixels.length === 2, `${rc.p.mean} ${rp.b.mean} ${ra.b.mean} ${rb.b.mean} ${rt.b.mean}`)
    // the engine's numbers the page states
    const tst = readFileSync(join(REPO, 'docs/TESTING.md'), 'utf8'), med = readFileSync(join(REPO, 'roadmap/MEDIA.md'), 'utf8')
    ok('ch.20: the measured and worked numbers are where the page says', tst.includes('the hidden box +0.0002 %, the dust with NEE off +0.002 %') && tst.includes('+0.024 % at g 0.6, +0.015 % at 0, −0.010 % at −0.5')
        && tst.includes('the controls 0.152 and 0.4315') && tst.includes('the haze\'s code alone 1.2 s as no box, the dust 1.5–1.6 s, NEE off 0.7 s') && med.includes('that is about 7e-5') && HZ.HAZE_G_MAX === 0.95)
}

{
    // CHAPTER 21: the machine's arithmetic, mirrored, held to tinywebgpu's own
    const K = await import('../kit/gpu.js'), Gc = await import('../ch/gpu.js')
    const { WEBGPU } = await import('../../lib/tinywebgpu/src/tinywebgpu.js')
    globalThis.GPUBufferUsage ??= { UNIFORM: 64, STORAGE: 128, COPY_SRC: 4, COPY_DST: 8, INDIRECT: 256, MAP_READ: 1 }
    globalThis.GPUTextureUsage ??= { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 }
    const S = WEBGPU(); let last = null
    S.device = { createBuffer: ({ size }) => ({ size }), queue: { writeBuffer: (b, o, ab) => { last = new Uint32Array(ab.slice(0)) } } }
    /** where tinywebgpu puts each field: written one at a time, the first word that changes */
    const real = entries => {
        const r = S.makeSchema(Object.fromEntries(entries)), at = {}
        r.uniformWrite({}); let prev = last
        entries.forEach(([name, type], k) => {
            const n = K.typeInfo(type).comps
            r.uniformWrite({ [name]: Array(n).fill(k + 1) })
            at[name] = last.findIndex((w, i) => w !== prev[i]); prev = last
        })
        return { bytes: r.uniformBuffer.size, at }
    }
    const agree = entries => { const m = K.layoutStruct(entries), t = real(entries); return m.bytes === t.bytes && m.fields.every(f => t.at[f.name] === f.offset) }
    ok('ch.21: kit/gpu.js lays out a struct as tinywebgpu does: the small one in both orders, every type, and ShadyTracer\'s UB', agree(Gc.SMALL) && agree(Gc.SMALL_BAD) && agree(Gc.ENGINE_UB)
        && agree([['a', 'f32'], ['m3', 'mat3x3<f32>'], ['b', 'u32'], ['v2', 'vec2<i32>'], ['m2', 'mat2x2<f32>'], ['c', 'f32'], ['m4', 'mat4x4<f32>'], ['v3', 'vec3<u32>'], ['d', 'i32']]))
    const L1 = K.layoutStruct(Gc.SMALL), L2 = K.layoutStruct(Gc.SMALL_BAD), L3 = K.layoutStruct(Gc.ENGINE_UB)
    ok('ch.21: the page\'s structs: 64 bytes (8 padding), 80 (24), and UB 109 fields in 768 bytes (48)', L1.bytes === 64 && 4 * L1.padWords === 8 && L2.bytes === 80 && 4 * L2.padWords === 24
        && L3.fields.length === 109 && L3.bytes === 768 && 4 * L3.padWords === 48, `${L3.fields.length} ${L3.bytes} ${4 * L3.padWords}`)
    // lock-step: a group is as long as its slowest lane
    const ls = K.lockstep([1, 5, 2, 2, 3, 3], 2)
    ok('ch.21: lockstep: groups as long as their slowest lane', ls.time === 2 * (5 + 2 + 3) && ls.work === 16 && Math.abs(ls.use - 0.8) < 1e-12)
    const pct = (w, o) => Math.round(100 * Gc.lanesRun(w, o).use)
    ok('ch.21: the page\'s lanes: 45% busy in groups of 32, 39% shuffled, 70% in groups of 8', pct(32, 'neighbours') === 45 && pct(32, 'shuffled') === 39 && pct(8, 'neighbours') === 70, `${pct(32, 'neighbours')} ${pct(32, 'shuffled')} ${pct(8, 'neighbours')}`)
    const d = (w, h) => K.dispatchCounts(w, h)
    ok('ch.21: a flat dispatch runs out of x at 4,194,240 pixels: 1920 x 1080 is 32,400 groups, 2048 x 2048 65,536; a 4K row 60 groups and 2160 rows', d(1920, 1080).flat === 32400 && d(1920, 1080).flatOK
        && d(2048, 2048).flat === 65536 && !d(2048, 2048).flatOK && d(2048, 2048).limitPixels === 4194240 && d(3840, 2160).rows.x === 60 && d(3840, 2160).rows.y === 2160 && d(4096, 4096).rowsOK)
    // the engine's numbers the page states
    const rm = readFileSync(join(REPO, 'lib/pathtracer/core/raytrace_main.js'), 'utf8'), perf = readFileSync(join(REPO, 'docs/PERFORMANCE.md'), 'utf8')
    const TB = await import('../../lib/pathtracer/core/tracebasics.js')
    ok('ch.21: 64 threads a group, 150 and 250 ms, a 1 GiB ray budget of 496 bytes a ray, the compile times where the page says', /wvf_wg: 64,/.test(rm) && rm.includes('export const SUBMIT_MS = 150, SPLIT_OVER_MS = 250')
        && rm.includes('rayBudgetBytes: 1024 * 1024 * 1024,') && 2 * TB.RAY_BYTES + TB.SHADE_ITEM_BYTES === 496 && (2 ** 30 / 496 / 1e6).toFixed(2) === '2.16'
        && perf.includes('ready at (ms): shade 18546, occlude 3365, march 1765, genrays 507') && perf.includes('read 21.2 and\n22.7 s for the Noise library on Ampere') && perf.includes('7.9-8.1 s on the 1080 Ti'))
}

{
    // CHAPTER 22: the flat world's wavefront against its path tracer, and the page's numbers
    const F = await import('../kit/flatland.js'), WK = await import('../kit/wavefront.js'), WF = await import('../ch/wavefront.js')
    const full = WF.run()
    // the counts add up, iteration by iteration
    let adds = true
    full.iters.forEach((l, i) => {
        if (l.marched !== l.hits + l.escaped + l.outOfSteps + l.onward + l.flushed) adds = false
        if (i > 0 && l.marched !== full.iters[i - 1].onward + full.iters[i - 1].newLegs) adds = false
        if (i > 0 && i < full.iters.length - 1 && l.shadowsTraced !== full.iters[i - 1].shadowsQueued) adds = false
    })
    ok('ch.22: every ray marched is shaded, out of steps, still marching or flushed; the next iteration marches the survivors and the new legs; occlusion traces what shade queued the iteration before', adds)
    // the wavefront's picture is the path tracer's, on average
    {
        const w = WK.wavefrontRun(WF.world, WF.CAM, { spp: 64, seed: 21 }), R = F.rng(23), N = 64 * 64
        let a = 0, a2 = 0
        for (let k = 0; k < 64; k++) for (let p = 0; p < 64; p++) { const [ox, oy, dx, dy] = F.cameraRay(WF.CAM, p, R()); const v = F.tracePath(WF.world, ox, oy, dx, dy, { nee: true, maxBounce: 10, rand: R }); a += v; a2 += v * v }
        const m = a / N, se = Math.sqrt((a2 / N - m * m) / N), mw = WF.pictureMean(w)
        ok('ch.22: run as a wavefront at the worst-case budget, the room reads what the flat world\'s path tracer reads, nothing flushed or cut', Math.abs(mw - m) < 4 * Math.SQRT2 * se && w.flushed === 0 && !(w.iters[w.iters.length - 1].cut > 0), `${mw} ${m} ± ${se}`)
    }
    // the lanes: one lane a group waits for nobody
    const one = WK.laneTimes(full, 1, 20)
    ok('ch.22: with one lane a group neither way waits', one.mega.busy === one.mega.time && one.wave.busy === one.wave.time)
    // the page's numbers
    const i1 = full.iters[0], cut = b => WF.run(b).iters[WF.run(b).iters.length - 1].cut
    ok('ch.22: the page\'s sample: worst case 24; iteration 1 marches 1024, 812 reach something, 212 go on; 523 shadow rays traced in iteration 2; rays in 19 iterations; 56 in iteration 15',
        full.worst === 24 && full.budget === 24 && i1.marched === 1024 && i1.hits + i1.escaped === 812 && i1.onward === 212 && full.iters[1].shadowsTraced === 523
        && full.iters.filter(l => l.marched > 0).length === 19 && full.iters[14].marched === 56 && full.paths.length === 1024)
    ok('ch.22: the mean 0.0153 at the worst case; at 8 iterations 88 flushed, 775 cut, 249 paths counted, 2 pixels with none, 0.0152; at 4, 181 counted, 8 with none', WF.pictureMean(full).toFixed(4) === '0.0153' && WF.run(8).flushed === 88 && cut(8) === 775
        && WF.run(8).paths.filter(p => p.ended).length === 249 && WF.leftOut(WF.run(8)) === 2 && WF.pictureMean(WF.run(8)).toFixed(4) === '0.0152' && WF.run(4).paths.filter(p => p.ended).length === 181 && WF.leftOut(WF.run(4)) === 8)
    // a cut path hands nothing in and is not counted: resolve's n (wavefront.js prog_resolve); over 20 runs the mean holds near the worst case and falls when short
    const mr = Object.fromEntries([0, 12, 10, 8, 6, 4].map(b => [b, WF.meanOverRuns(b, 20)])), rel = b => mr[b] / mr[0] - 1
    ok('ch.22: over 20 runs, the mean held at 12 and 10 iterations (within 5%) and fell 4% at 8, 14% at 6, 30% at 4', Math.abs(rel(12)) < 0.05 && Math.abs(rel(10)) < 0.05
        && Math.round(-100 * rel(8)) === 4 && Math.round(-100 * rel(6)) === 14 && Math.round(-100 * rel(4)) === 30, JSON.stringify(Object.fromEntries(Object.keys(mr).map(b => [b, rel(b).toFixed(3)]))))
    const lt = c => { const t = WK.laneTimes(full, 32, c); return [Math.round(100 * t.mega.busy / t.mega.time), Math.round(100 * t.wave.busy / t.wave.time), (t.mega.time / t.wave.time).toFixed(2)].join(' ') }
    ok('ch.22: the lanes: 46% against 74% at a shading of 20 (1.60 times), 33/61 at 1, 64/86 at 80', lt(20) === '46 74 1.60' && lt(1).startsWith('33 61') && lt(80).startsWith('64 86'), `${lt(20)} | ${lt(1)} | ${lt(80)}`)
    const rv = readFileSync(join(REPO, 'docs/PERFORMANCE_REVIEW.md'), 'utf8'), rmain = readFileSync(join(REPO, 'lib/pathtracer/core/raytrace_main.js'), 'utf8')
    ok('ch.22: the measured numbers are where the page says', rv.includes('| Noise library | 243.1 | 184.7 | 102.8 | 27.2 | 45.5 |') && rv.includes('`wall − gpu ≈ 1.5 ms + 2.35 ms × iterations` (R² 0.995)')
        && rv.includes('| Noise library | 24 | 21 | 81.1 | 179.9 | **45%** |') && rv.includes('march still took 1.4-1.5 ms') && rmain.includes('cost 0.13 ms (materials) to 0.42 ms (Menger) of GPU')
        && rmain.includes('3,945 of the Menger cubes\' last') && rmain.includes('The benchmark\'s materials row ran 8, 24 and 8 iterations'))
}

{
    // CHAPTER 23: threads on one pixel, the number formats, the batches
    const K = await import('../kit/gpu.js'), A = await import('../ch/accumulate.js'), F = await import('../kit/flatland.js'), PH = await import('../../lib/pathtracer/core/photons.js')
    let exact = true, lastWins = true
    for (let seed = 1; seed <= 40; seed++) {
        const n = 2 + (seed % 15), vals = A.valuesOf(n, seed)
        for (const ls of [true, false]) for (const mode of ['atomic', 'cas']) { const r = K.raceRun(vals, mode, { lockstep: ls, rand: F.rng(seed) }); if (r.final !== r.expected) exact = false }
        if (K.raceRun(vals, 'plain', { lockstep: true }).final !== vals[n - 1]) lastWins = false
        if (K.raceRun(vals, 'cas', { lockstep: true }).failed !== n * (n - 1) / 2) exact = false
    }
    ok('ch.23: an atomic add and a compare-and-swap loop count every thread, in lock-step or interleaved; in lock-step n threads fail n(n-1)/2 swaps; a plain load and store in lock-step keeps the last thread\'s', exact && lastWins)
    const rr = st => A.raceOf(A.figures.race.steps[st])
    ok('ch.23: the page\'s race: 2 of 26 in lock-step, 10 interleaved, 26 by atomic add, 15 failed swaps for 6 threads, 120 and 17 rounds for 16', rr('plain').final === 2 && rr('plain').expected === 26 && rr('mixed').final === 10
        && rr('atomic').final === 26 && rr('cas').failed === 15 && rr('cas').final === 26 && rr('crowd').failed === 120 && rr('crowd').rounds === 17)
    ok('ch.23: the old fixed point kept 25,000 as 10,000 and a millionth as 0, 0.3 as 0.29998779; an f32 keeps 25,000 and 1.6e9 exactly', K.fixedKeeps(25000) === 1e4 && K.fixedKeeps(1e-6) === 0
        && K.fixedKeeps(0.3).toFixed(8) === '0.29998779' && K.f32Keeps(25000) === 25000 && K.f32Keeps(1.6e9) === 1.6e9)
    const wfs = readFileSync(join(REPO, 'lib/pathtracer/core/wavefront.js'), 'utf8')
    ok('ch.23: the format\'s numbers are the code\'s: 65536 a unit, the clamp at 1e4, a wall 25 000, the sun 1.6e9, 65535 a pixel a sample', wfs.includes('= 65536 per unit') && wfs.includes('clamped at 1e4') && wfs.includes('a sunlit white wall is 25 000')
        && wfs.includes('the sun\'s disc 1.6e9') && wfs.includes('held at most 65535 per pixel per sample'))
    // the batches: every plan's parts add up, every batch fits
    let plans = true
    const R = F.rng(5)
    for (let i = 0; i < 300; i++) {
        const budget = 1 + Math.floor(R() * 3e6), streams = [Math.floor(R() * 9e6), Math.floor(R() * 4e6)], map = R() < 0.5
        const p = PH.planBatches(budget, streams, 1, map ? { first: [1] } : {})
        for (let k = 0; k < p.batches; k++) if (streams.reduce((a, _, s) => a + p.part(s, k), 0) > budget) plans = false
        streams.forEach((n, s) => { let t = 0; for (let k = 0; k < p.batches; k++) t += p.part(s, k); if (t !== n) plans = false })
    }
    const pl = st => A.planOf(A.figures.batches.steps[st]).plan
    ok('ch.23: planBatches\' batches each fit and add up to every stream; the page\'s 2,164,802 rays, 1 batch, 5 of 1,658,880 and 200,000, 2 with the photon map first', plans && A.BUDGET === 2164802
        && pl('fits').batches === 1 && pl('over').batches === 5 && pl('over').part(0, 2) === 1658880 && pl('over').part(1, 4) === 200000 && pl('map').batches === 2 && pl('map').firstBatches === 1 && pl('map').part(0, 0) === 0)
    const tj = readFileSync(join(REPO, 'lib/pathtracer/tests.js'), 'utf8'), rmn = readFileSync(join(REPO, 'lib/pathtracer/core/raytrace_main.js'), 'utf8')
    ok('ch.23: the measured and counted numbers are where the page says', tj.includes('FIRST RUN (Pascal, 1188x969): 70 ms with light tracing, 9 ms without -- 7.8x') && tj.includes('read about 1.4x')
        && rmn.includes('16.8 M\n       pixels of accumulation plus the same of frame buffer, 537 MB') && /pixels \* 16\)  \/\/ the picture/.test(rmn) && /createStorageBuffer\(pixels \* 8\)/.test(rmn))
}

{
    // CHAPTER 24: a scene tree as text three ways, the engine's bake, inlined size and the compile model
    const SG = await import('../kit/scenegen.js'), CG = await import('../ch/codegen.js'), BK = await import('../../builder/bake.js')
    const CP = await import('../../lib/pathtracer/core/compileprogress.js'), WG = await import('../../lib/pathtracer/core/wgslgraph.js')
    const base = { mode: 'codegen', k: 0.3, extra: false, pos: CG.START }, sc = o => CG.sceneOf({ ...base, ...o })
    const moved = { pos: { ...CG.START, c: [1.4, -0.35] } }
    ok('ch.24: code with uniforms keeps its text when a value moves (a shape, the blend), and changes it when a shape is added', SG.textOf(sc(moved), 'codegen') === SG.textOf(sc({}), 'codegen')
        && SG.textOf(sc({ k: 0.6 }), 'codegen') === SG.textOf(sc({}), 'codegen') && SG.textOf(sc({ extra: true }), 'codegen') !== SG.textOf(sc({}), 'codegen'))
    ok('ch.24: baked, a value moved is new text; as data, nothing is: a shape added is a record more', SG.textOf(sc(moved), 'baked') !== SG.textOf(sc({}), 'baked')
        && SG.textOf(sc({ extra: true, k: 0.1 }), 'data') === SG.textOf(sc({}), 'data') && SG.records(sc({ extra: true })).length === SG.records(sc({})).length + 1)
    // the engine's bake on the toy: every value a constant, the text codegen's with UB. read back
    const cgs = SG.codegen(sc({})), bk = SG.bake(sc({}))
    ok('ch.24: bake.js turns all 7 uniforms into constants, and un-baked the text is codegen\'s byte for byte', bk.baked.baked.names.length === 7 && !bk.baked.baked.kept.length
        && bk.baked.wgsl.replace(/\bbk_/g, 'UB.') === cgs.wgsl && /const bk_pos_c: vec2<f32> = vec2<f32>\(1\.15, 0\.55\);/.test(bk.wgsl) && Object.keys(BK.baked(cgs, { live: n => n === 'k_g' }).uniforms).join() === 'k_g')
    // the records say what the scene says; the distance is the scene's
    const recs = SG.records(sc({}))
    ok('ch.24: the records hold each shape\'s kind, join and numbers; the toy\'s distance is the block, the ball and the hole', recs[0].join() === '1,0,0,-0.35,1.2,0.65,0.3' && recs[2].join() === '0,1,-0.45,0.05,0.35,0,0.3'
        && SG.sceneDist(sc({ k: 0 }), -0.45, 0.05) > 0 && SG.sceneDist(sc({ k: 0 }), 0.9, 0) < 0 && SG.sceneDist(sc({ k: 0 }), 1.15, 1.1) < 0)
    // the page's compile counts, as its steps make them
    const counts = Object.fromEntries(Object.entries(CG.figures.tree.steps).map(([k, st]) => { const s = JSON.parse(JSON.stringify(st)); CG.account(s); return [k, `${CG.MODES.map(([m]) => s.seen[m]?.n ?? 0).join('/')} ${s.last}`] }))
    ok('ch.24: the steps one story: 1 compile, a move written, a ball compiled (2); baked, its first text and a move compiled (2); as data, its first text, a ball taken away and added written (1)', counts.codegen === '1/0/0 compiled' && counts.move === '1/0/0 written'
        && counts.add === '2/0/0 compiled' && counts.baked === '2/2/0 compiled' && counts.data === '2/2/1 written', JSON.stringify(counts))
    const added = CG.figures.tree.steps.add.seen.codegen, fresh = added.text.split('\n').filter(l => !added.prev.split('\n').includes(l))
    ok('ch.24: adding a ball is one new line of code (and two new uniforms)', fresh.length === 1 && /csgUnion\(d, sdCircle\(p - UB\.pos_e, UB\.r_e\)/.test(fresh[0]), fresh.join(' | '))
    // inlined size: every call site a copy; the model equals the linear rate at its reference size
    const st = n => WG.inlineStats(SG.kernelText(40, n), 'main', ['SDF'])
    ok('ch.24: 40 objects called once 6,794 characters inlined, four times 27,020 (4 copies); 400 objects 273,500; the model 0.03, 0.22 and 5.18 s, the linear rate\'s at 151,000', st(1).inlined === 6794 && st(4).inlined === 27020 && st(4).copies.SDF === 4
        && WG.inlineStats(SG.kernelText(400, 4), 'main', ['SDF']).inlined === 273500 && (CP.kernelMs(6794) / 1000).toFixed(2) === '0.03' && (CP.kernelMs(27020) / 1000).toFixed(2) === '0.22'
        && (CP.kernelMs(273500) / 1000).toFixed(2) === '5.18' && Math.abs(CP.kernelMs(CP.SIZE_REF) - CP.DEFAULT_RATE * CP.SIZE_REF) < 1e-9 && CP.GROWTH === 1.37)
    const arch = readFileSync(join(REPO, 'roadmap/ARCHITECTURE.md'), 'utf8'), pf = readFileSync(join(REPO, 'docs/PERFORMANCE.md'), 'utf8'), sdj = readFileSync(join(REPO, 'builder/scenedata.js'), 'utf8')
    ok('ch.24: the measured numbers are where the page says', arch.includes('| the optics bench | 297.4 -> 109.1 (-63%) | 189.7 -> 61.2 (-68%) |') && arch.includes('| 8456 -> 4643 |') && arch.includes('Baked is faster on seven of the eight')
        && arch.includes('| 4.2, 3.9, 3.1 |') && arch.includes('| 8.9, 9.4 |') && arch.includes('| 1.36, 1.12, 0.83 |') && pf.includes('3.7-23 s uncached on the Ampere') && sdj.includes('header and 585 records'))
}

/* CHAPTER 25: MEASURE FIRST -------------------------------------------------------------------------------------- */
{
    const ME = await import('../ch/measure.js'), TI = await import('../kit/timing.js'), KT = await import('../../lib/pathtracer/core/kerneltime.js')
    const pf = readFileSync(join(REPO, 'docs/PERFORMANCE.md'), 'utf8'), rv = readFileSync(join(REPO, 'docs/PERFORMANCE_REVIEW.md'), 'utf8')
    ok('ch.25: the benchmark\'s first full run, as the page copies it', pf.includes('| Noise library, as it is | 736.5 | |') && pf.includes('| **reliefs removed (plain shapes)** | **81.1** | **-89.0%** |')
        && pf.includes('| Surface materials | 80.0 | |') && pf.includes('| showcase / demo / Menger cubes / materials | 93.1 / 95.6 / 177.2 / 61.8 |')
        && ME.RELIEFS.slice(3).every(([n, v]) => pf.includes(`| ${n} | ${v.toFixed(1)} |`)) && pf.includes('render **about 6x faster** at the same resolution'))
    ok('ch.25: the drift\'s readings and run 2\'s repeats are the documents\'', TI.DRIFT_READINGS.every(v => rv.includes(`| ${v.toFixed(1)} ms |`)) && pf.includes('737.3, 784.2 (after the settings rows) and 714.9')
        && pf.includes('9.3% of their mean') && pf.includes('rounded to 32.768 us here') && rv.includes('good to about ±20%'))
    // the model's sample, read by the engine's own tally: 194 passes, busy and gaps make the span, 24 iterations
    const r0 = ME.reading(0), busy = Object.values(r0.r.ms).reduce((a, b) => a + b, 0)
    ok('ch.25: 194 passes in 24 iterations; busy plus gaps is the span, gaps 0.39 of 87.8 ms; the march half, shade a fifth, occlusion a seventh, surface a ninth', r0.r.passes === 194 && r0.it.iterations.length === 24
        && Math.abs(busy + r0.r.gapMs - r0.r.spanMs) < 1e-6 && r0.r.gapMs.toFixed(2) === '0.39' && r0.r.spanMs.toFixed(1) === '87.8'
        && Math.abs(r0.r.ms.march / r0.r.spanMs - 0.5) < 0.02 && Math.abs(r0.r.ms.shade / r0.r.spanMs - 1 / 5) < 0.03 && Math.abs(r0.r.ms.occlude / r0.r.spanMs - 1 / 7) < 0.01 && Math.abs(r0.r.ms.surface / r0.r.spanMs - 1 / 9) < 0.01)
    const r1 = ME.reading(100)
    ok('ch.25: rounded to 100 us, 124 passes read 0; the march 44.6 against 44.3; prep_march 0 against 0.1, prep_occlude 0.2', r1.r.seq.filter(q => q[1] === 0).length === 124
        && r1.r.ms.march.toFixed(1) === '44.6' && r0.r.ms.march.toFixed(1) === '44.3' && r1.r.ms.prep_march === 0 && r0.r.ms.prep_march.toFixed(1) === '0.1' && r1.r.ms.prep_occlude.toFixed(1) === '0.2')
    // the timestamps as a card writes them: exact pairs give each pass its time back
    const P = [{ name: 'a', ms: 1.5 }, { name: 'b', ms: 0.25 }], t = TI.timestamps(P, { gap: 0.5 }), tl = KT.tally(P.map(p => p.name), t)
    ok('ch.25: timestamps in ns give each pass its ms back, and the gap between them', Math.abs(tl.ms.a - 1.5) < 1e-9 && Math.abs(tl.ms.b - 0.25) < 1e-9 && Math.abs(tl.gapMs - 0.5) < 1e-9)
    // the drift: the four readings' spread 16%; 40 comparisons of a true 10%
    const sep = TI.driftTrials(0.1, 'separate', { n: 40, seed: 1 }), int = TI.driftTrials(0.1, 'interleaved', { n: 40, seed: 1 })
    ok('ch.25: the readings spread 16%; separate runs read a 10% gain the wrong way 17 times in 40 and within 5 points 8 times; interleaved never wrong, 37 within 2', TI.driftSpread().toFixed(2) === '0.16'
        && sep.filter(v => v >= 0).length === 17 && sep.filter(v => Math.abs(v + 0.1) <= 0.05).length === 8 && int.filter(v => v >= 0).length === 0 && int.filter(v => Math.abs(v + 0.1) <= 0.02).length === 37)
    ok('ch.25: the Noise library 7.7 times the demo, its reliefs removed beside Surface materials', (736.5 / 95.6).toFixed(1) === '7.7' && Math.abs(81.1 - 80.0) < 2)
    // the reliefs alone and together: 484 summed against 655, as the run's notes say, and the rows' names their amount / size
    const alone = ME.RELIEFS.slice(3).reduce((a, [, v]) => a + v - 81.1, 0), flat = pf.replace(/\s+/g, ' ')
    const noise = JSON.parse(readFileSync(join(REPO, 'bench/scenes/noise.json'), 'utf8')), rel = noise.root.children.filter(c => c.params?.amount != null).map(c => `${c.params.amount} mm / ${c.params.size} mm`)
    ok('ch.25: the six reliefs alone add 484 ms summed, together 655; each row named by its relief\'s amount / size in the frozen scene', Math.round(alone) === 484 && Math.round(736.5 - 81.1) === 655
        && flat.includes('the six alone add 484 ms summed, and together they add 655 ms') && rel.length === 6 && ME.RELIEFS.slice(3).every(([n], i) => n.startsWith(`only relief ${rel[i]}`)), rel.join(', '))
    // rounding: a pass reads the ticks between its two rounded stamps, its own length on average
    const o1 = ME.oneRounded(137, 4, 100), o2 = ME.oneRounded(98, 4, 100), mean = [[4, 100], [40, 100], [4, 32.768], [150, 100]].map(([l, tk]) => ME.oneRounded(0, l, tk).mean / l)
    ok('ch.25: a 4 us pass at 137 us reads 0, across the tick at 100 reads 100; over 10,000 at random starts each reads its own length within 10%', o1.read === 0 && o2.read === 100 && mean.every(m => Math.abs(m - 1) < 0.1), mean.map(m => m.toFixed(3)).join(' '))
    ok('ch.25: rounded, the gaps read 0.20 ms against 0.39', r1.r.gapMs.toFixed(2) === '0.20')
    ok('ch.25: the readings\' range 38% and spread 16%; run 2\'s 9.3% a range over the mean; maxiter 128 makes the worst case 15', ((255.5 / 184.7 - 1) * 100).toFixed(0) === '38'
        && ((784.2 - 714.9) / ((737.3 + 784.2 + 714.9) / 3) * 100).toFixed(1) === '9.3' && 11 + Math.ceil(128 / 32) === 15)
}

/* CHAPTER 26: FEWER AND CHEAPER STEPS --------------------------------------------------------------------------- */
{
    const ST = await import('../ch/steps.js'), K = await import('../kit/steps.js'), NZ = await import('../../lib/pathtracer/core/noise.js')
    const api = readFileSync(join(REPO, 'lib/pathtracer/core/scene_api.js'), 'utf8'), cg = readFileSync(join(REPO, 'builder/codegen.js'), 'utf8')
    const wf = readFileSync(join(REPO, 'lib/pathtracer/core/wavefront.js'), 'utf8'), tb = readFileSync(join(REPO, 'lib/pathtracer/core/tracebasics.js'), 'utf8')
    const { MODIFIERS } = await import('../../builder/modifiers.js'), relief = MODIFIERS.relief.code
    // THE MIRRORS, held to the engine's text: what kit/steps.js does is what these lines say
    ok('ch.26: cullDist is the exact box distance and -1 unknown; the margin ten surface tolerances; skipped while farther, CULL standing in where nearer', api.includes('if (lo.w == 0.0) { return -1.0; }')
        && api.includes('return length(max(d, VEC3(0.0))) + min(max(d.x, max(d.y, d.z)), 0.0);') && api.includes('fn cullMargin() -> FLOAT { return offsetEps(); }') && tb.includes('fn offsetEps() -> FLOAT { return 10.0 * marchEps(); }')
        && cg.includes("if (bd_${n.id} > cullMargin()) { CULL = min(CULL, bd_${n.id}); } else {") && cg.includes("if (culling) e.raw('    if (CULL < abs(C.s.w)) { C.s.w = CULL; }')"))
    ok('ch.26: the relief\'s shell and division as the modifier writes them; 17.2 and 1.875 its numbers, 1.386 x amount its reach', relief.includes('let slope = 1.0 + amount / size * nzFbmLip(4u, 2.0, 0.5, NZ_GRAD_LIP_MEASURED) / peak;')
        && relief.includes('let reach = NZ_GRAD_VALUE_BOUND * abs(amount) * XF_S;') && relief.includes('if (abs(H.s.w) > 2.0 * reach + READ_REACH + (slope + 1.0) * marchEps()) {')
        && relief.includes('C = fold(C, VEC4(0.0, 0.0, 0.0, H.s.w - sign(H.s.w) * reach), H.m);') && relief.includes('let n = fbm3(p / size, 1u, 4u, 2.0, 0.5);')
        && K.LIP.modifier.toFixed(1) === '17.2' && K.LIP.measured === 11.2 && K.PEAK === 1.875 && NZ.NZ_GRAD_VALUE_BOUND.toFixed(3) === '1.386')
    ok('ch.26: scStep as the engine writes it: a ball\'s exit, a cell at least, the own cell or three; the march\'s 32 steps and never its last', wf.includes('best = max(best, -b + sqrt(b * b - c2));')
        && wf.includes('return select(-1.0, best, best >= cs);') && wf.includes('const SC_LOOKS: u32 = ${mode >= 2 ? 3 : 1}u;') && wf.includes('if (i + 1u < MAX_STEPS) {')
        && wf.includes('ray = moveBy(ray, ray.dir * (sc * UB.stepscale));') && wf.includes('const MAX_STEPS: u32 = 32u;') && K.MARCH_STEPS === 32 && wf.includes('${scene.pickWgsl ?? scene.wgsl}'))
    let SB = null; try { SB = await import('../../builder/stepbox.js') } catch { }
    const lists = [[{ lo: [-1, 0], hi: [2, 1] }, { lo: [3, -2], hi: [4, 0.5] }], [{ lo: [0, 0], hi: [1, 5] }]]
    ok('ch.26: unionBox in the plane is stepbox.js\'s with z flat', !SB || lists.every(L => { const a = K.unionBox(L), b = SB.unionBox(L.map(x => ({ lo: [...x.lo, 0], hi: [...x.hi, 0] }))); return a.lo.every((v, k) => Math.abs(v - b.lo[k]) < 1e-12) && a.hi.every((v, k) => Math.abs(v - b.hi[k]) < 1e-12) }), SB ? 'held to stepbox.js' : 'stepbox.js not importable here')
    // cullDist against brute force: the distance to a box's outline sampled finely, and inside the negative depth
    const bx = { lo: [-1, -0.5], hi: [2, 1] }, outline = []
    for (let k = 0; k <= 3000; k++) { const t = k / 3000; outline.push([-1 + 3 * t, -0.5], [-1 + 3 * t, 1], [-1, -0.5 + 1.5 * t], [2, -0.5 + 1.5 * t]) }
    let worst = 0
    for (let k = 0; k < 400; k++) { const x = -3 + 7 * ((k * 0.6180339) % 1), y = -2 + 4.5 * ((k * 0.3819660 + 0.1) % 1), inside = x > -1 && x < 2 && y > -0.5 && y < 1
        const bf = Math.min(...outline.map(q => Math.hypot(q[0] - x, q[1] - y))) * (inside ? -1 : 1); worst = Math.max(worst, Math.abs(K.cullDist(x, y, bx) - bf)) }
    ok('ch.26: cullDist is the distance to the box outside and minus it inside, against brute force', worst < 2e-3 && K.cullDist(0, 0, null) === -1, worst.toExponential(2))
    // the shelf: what the figure and the page count
    const n = (cull, shell) => ST.shelf(cull, shell), c = v => Math.round(v)
    const off = n('off', false), all = n('all', false), dear = n('dear', false), soff = n('off', true), sdear = n('dear', true), sall = n('all', true)
    const boxSteps = F => F.rays.reduce((a, r) => a + r.steps.filter(q => q.kind === 'box').length, 0)
    ok('ch.26: the shelf: 1,021 steps and 38,798 with no boxes and no shell, the noise 84%; every box 946 and 12,545 (387 a box\'s bound); dear only 907 and 12,208', off.steps === 1021 && c(off.cost) === 38798
        && Math.round(100 * off.T.octave * K.COST.octave / off.cost) === 84 && all.steps === 946 && c(all.cost) === 12545 && c(all.T.box) === 4730 && boxSteps(all) === 387 && dear.steps === 907 && c(dear.cost) === 12208,
        `${off.steps} ${off.cost} | ${all.steps} ${all.cost} ${boxSteps(all)} | ${dear.steps} ${dear.cost}`)
    ok('ch.26: shelled, 10,702 with no boxes and 11,471 (7% more) with the dear ones', c(soff.cost) === 10702 && c(sdear.cost) === 11471 && Math.round(100 * (sdear.cost / soff.cost - 1)) === 7, `${soff.cost} ${sdear.cost}`)
    const sameEnds = (A, B) => A.rays.every((r, i) => r.hit === B.rays[i].hit && Math.hypot(r.x - B.rays[i].x, r.y - B.rays[i].y) < 2e-3)
    ok('ch.26: every ray ends where it would without boxes, in every mode, shelled or not', [all, dear].every(F => sameEnds(F, off)) && [sall, sdear].every(F => sameEnds(F, soff)))
    // culling never answers more than the TRUE distance to the nearest surface (the plain shapes' exact, the reliefs' to
    // their outline), and a box's distance stands in only above the margin
    const rings = new Map(ST.NODES.filter(q => q.kind === 'relief').map(q => [q.id, K.reliefOutline(q, 720)]))
    const trueDist = (x, y) => Math.min(...ST.NODES.map(q => q.kind === 'relief' ? Math.min(...rings.get(q.id).map(p => Math.hypot(p[0] - x, p[1] - y)))
        : Math.abs(K.sceneAt({ nodes: [q] }, x, y, { cull: 'off', eps: 1e-3 }).d)))
    let culledOk = true, worstCull = 0
    for (let k = 0; k < 1500; k++) { const x = -8 + 15 * ((k * 0.7548777) % 1), y = 0.02 + 5 * ((k * 0.5698403 + 0.3) % 1), tr = trueDist(x, y)
        for (const cull of ['all', 'dear']) for (const shell of [true, false]) { const a = K.sceneAt(ST.SHELF, x, y, { cull, eps: 1e-3, shell })
            worstCull = Math.max(worstCull, Math.abs(a.d) - tr); if (Math.abs(a.d) > tr + 0.02 || (a.culled >= 0 && !(a.d > 10e-3))) culledOk = false } }
    ok('ch.26: at 1,500 points, every way, the culled answer is never more than the true distance (to 0.02, the reliefs\' outlines sampled), and a box\'s distance stands in only above the margin', culledOk, worstCull.toFixed(4))
    // the joins
    const wrong = (op, how) => { const J = ST.JOINS[op]; return J.rays.filter(([o, d]) => { const m = K.marchJoined(J, o[0], o[1], d[0], d[1], how), t = K.marchJoined(J, o[0], o[1], d[0], d[1], how, { field: 'truth' }); return m.hit !== t.hit || Math.hypot(m.x - t.x, m.y - t.y) > 0.02 }) }
    const lensShort = ST.JOINS.intersect.rays.map(([o, d]) => K.marchJoined(ST.JOINS.intersect, o[0], o[1], d[0], d[1], 'root', { field: 'truth' }).x - K.marchJoined(ST.JOINS.intersect, o[0], o[1], d[0], d[1], 'inside').x)
    const blendMiss = ST.JOINS.blend.rays.filter(([o, d]) => !K.marchJoined(ST.JOINS.blend, o[0], o[1], d[0], d[1], 'inside').hit).length
    let rootOk = true
    for (const op of ['intersect', 'blend']) {
        const J = ST.JOINS[op], edge = [], h = 0.01, f = (x, y) => K.joined(J, x, y, 'root').truth
        for (let x = -2.6; x < 2.6; x += h) for (let y = -1.4; y < 1.4; y += h) { const a = f(x, y); if (a * f(x + h, y) <= 0 || a * f(x, y + h) <= 0) edge.push([x + h / 2, y + h / 2]) }
        for (let k = 0; k < 600; k++) { const x = -3.3 + 6.6 * ((k * 0.7548777) % 1), y = -1.8 + 3.8 * ((k * 0.5698403) % 1), v = K.joined(J, x, y, 'root')
            if (v.truth <= 0) continue
            const tr = Math.min(...edge.map(p => Math.hypot(p[0] - x, p[1] - y)))
            if (v.culled > tr + 0.015 || (v.skipped && !(v.culled > 10e-3))) rootOk = false }
    }
    ok('ch.26: culled whole at the root no ray goes wrong and the box\'s distance never exceeds the true distance to the join; B culled inside the lens, all six stop 1.2 short; inside the blend three go wrong, two straight through', wrong('intersect', 'root').length === 0 && wrong('blend', 'root').length === 0 && rootOk
        && wrong('intersect', 'inside').length === 6 && lensShort.every(d => Math.abs(d - 1.2) < 0.02) && wrong('blend', 'inside').length === 3 && blendMiss === 2, lensShort.map(d => d.toFixed(3)).join(' '))
    const Pw = K.joined(ST.JOINS.intersect, 0.05, 1.7, 'root'), Pt = K.lensTrueDist(ST.JOINS.intersect, 0.05, 1.7)
    ok('ch.26: above the lens\'s tip, the formula 0.820, the box 0.900, the truth 0.901 (to the tip, 0.8 high)', Pw.truth.toFixed(3) === '0.820' && Pw.culled.toFixed(3) === '0.900' && Pt.toFixed(3) === '0.901' && Math.abs(Pt - Math.hypot(0.05, 0.9)) < 1e-12)
    // the shell: the figure's numbers, and its distances below the true ones
    const sh = (shell, lip) => ST.shellFan({ shell, ratio: 0.17, lip })
    const a1 = sh('none', 'modifier'), a2 = sh('shell', 'modifier'), a3 = sh('none', 'measured'), a4 = sh('shell', 'measured')
    ok('ch.26: one relief: 318 steps all paying, cost 5,406; in a shell 243, 211 paying, 3,619 (a third less); the 11.2 bound 252 and 202', a1.steps === 318 && a1.T.octave / K.OCTAVES === 318 && c(a1.cost) === 5406
        && a2.steps === 243 && a2.T.octave / K.OCTAVES === 211 && c(a2.cost) === 3619 && Math.round(100 * (1 - a2.cost / a1.cost)) === 33 && a3.steps === 252 && a4.steps === 202 && sameEnds(a2, a1),
        `${a1.steps} ${a1.cost} | ${a2.steps} ${a2.T.octave / 4} ${a2.cost} | ${a3.steps} ${a4.steps}`)
    const R0 = ST.reliefOf(0.17), ring = K.reliefOutline(R0, 1440), { slope, reach } = K.reliefBounds(R0)
    let lower = true, divided = true
    for (let k = 0; k < 600; k++) { const a = 2 * Math.PI * ((k * 0.618034) % 1), rr = 1 + (2.6 * ((k * 0.381966) % 1) - 1.3) * 0.4, x = rr * Math.cos(a), y = rr * Math.sin(a)
        const truth = Math.min(...ring.map(q => Math.hypot(q[0] - x, q[1] - y))) * Math.sign(K.reliefRaw(R0, x, y)), d0 = Math.hypot(x, y) - 1
        if (Math.abs(d0) > 2 * reach && Math.abs(d0 - Math.sign(d0) * reach) > Math.abs(truth) + 2e-3) lower = false
        if (Math.abs(K.reliefRaw(R0, x, y) / slope) > Math.abs(truth) + 2e-3) divided = false }
    ok('ch.26: outside the shell the plain distance less the reach, and everywhere the divided field, never more than the distance to the relief\'s surface (600 points against its outline)', lower && divided)
    // the step cache
    const cs = s => ST.cacheRun(s), base = ST.shelf('dear', true)
    const o1 = cs({ looks: 'own', cells: 1024, fill: 'pick' }), o2 = cs({ looks: 'ahead', cells: 1024, fill: 'pick' }), o3 = cs({ looks: 'own', cells: 1024, fill: 'render' })
    ok('ch.26: the cache over 1,024 cells: own cell 794 steps (116 from the cache), cost 10,220, a tenth less; cells ahead 755; filled from the copy with boxes 879; every ray ends as without it', o1.steps === 794 && o1.T.cached === 116 && c(o1.cost) === 10220
        && Math.round(10 * (1 - o1.cost / base.cost)) === 1 && o2.steps === 755 && o3.steps === 879 && [o1, o2, o3].every(F => sameEnds(F, base)), `${o1.steps} ${o1.T.cached} ${o1.cost} ${o2.steps} ${o3.steps}`)
    const C1 = ST.cacheOf(1024, 'pick'), C2 = ST.cacheOf(1024, 'render')
    let balls = true, capped = 0
    for (let k = 0; k < C1.R.length; k++) { const i = k % C1.nx, j = Math.floor(k / C1.nx), x = C1.lo[0] + (i + 0.5) * C1.cs, y = C1.lo[1] + (j + 0.5) * C1.cs
        const t = Math.abs(K.sceneAt(ST.SHELF, x, y, { cull: 'off', eps: 1e-3, shell: true }).d); if (Math.abs(C1.R[k] - Math.max(t, 1e-6)) > 1e-12 || (y > 0 && C2.R[k] > trueDist(x, y) + 0.02)) balls = false; if (C2.R[k] < C1.R[k] - 1e-9) capped++ }
    ok('ch.26: every cell the scene\'s own distance from its centre; filled from the copy with boxes, never more than the true distance, and smaller around the boxes', balls && capped > 0, `${capped} of ${C1.R.length} cells capped`)
    // the measured numbers, where the page says
    const pf = readFileSync(join(REPO, 'docs/PERFORMANCE.md'), 'utf8'), ar = readFileSync(join(REPO, 'roadmap/ARCHITECTURE.md'), 'utf8')
    ok('ch.26: the measured numbers are where the page says', pf.includes('| Noise library | 216.6 | 839.8 | 3.9x') && pf.includes('**The relief in a shell: 156.0 ms/sample, -22.9%**') && pf.includes('202.3')
        && pf.includes('So the shell took 48 ms off the march (-38%) and 21 off the occlusion rays (-33%)') && pf.includes('Noise library 250.4 against 988.9 with boxes off, 3.95x')
        && ar.includes('| the optics bench | 217.6 (131.0 / 60.4) |') && ar.includes('the optics bench -27%, the optics bench as data -19%,') && ar.includes('+81.4 (+11%)')
        && ar.includes('the showcase -14.8% (-13.4%), Surface materials -4.4%') && cg.replace(/\s+/g, ' ').includes("the Noise library's six reliefs, 89% of its time") && NZ.NZ_RELIEF_LIP_MEASURED === 11.2)
}

/* CHAPTER 27: FASTER COMPILES ------------------------------------------------------------------------------------ */
{
    const CK = await import('../kit/compiles.js'), CC = await import('../ch/compiles.js'), CP = await import('../../lib/pathtracer/core/compileprogress.js')
    const rv = readFileSync(join(REPO, 'docs/PERFORMANCE_REVIEW.md'), 'utf8'), wf = readFileSync(join(REPO, 'lib/pathtracer/core/wavefront.js'), 'utf8'), rm = readFileSync(join(REPO, 'lib/pathtracer/core/raytrace_main.js'), 'utf8')
    const row = b => `| ${b.scene} | ${b.all.toFixed(1)} | ${b.seq.toFixed(1)} | ${b.shade.toFixed(1)} | ${b.occlude.toFixed(2)} | ${b.march.toFixed(2)} | ${b.shadeK}K |`
    ok('ch.27: the six measured builds are the review\'s §10.3 rows', CK.BUILDS.every(b => rv.includes(row(b))), CK.BUILDS.filter(b => !rv.includes(row(b))).map(b => b.scene).join(', '))
    ok('ch.27: all at once 16 to 21% under one at a time; shade 76 to 82% of one at a time; the ten small kernels 0.28 to 0.39 s together', CK.BUILDS.every(b => { const g = Math.round(100 * (1 - b.all / b.seq)), sh = Math.round(100 * b.shade / b.seq), sm = CK.smallOf(b); return g >= 16 && g <= 21 && sh >= 76 && sh <= 82 && sm >= 0.28 && sm <= 0.39 })
        && rv.includes('All at once beat one at a time by 16-20%') && rv.includes('It is 76-82% of the kernels\' time one at a time'))
    const L1 = CK.layout(CK.BUILDS[0], 'blocking'), L3 = CK.layout(CK.BUILDS[0], 'once')
    ok('ch.27: blocking, the page frozen for the 13.4 s; all at once, every kernel from 0 and the build ready at the measured 11.2', L1.frozen === 13.4 && L1.bars.at(-1).to.toFixed(1) === '13.4' && L3.frozen === 0 && L3.ready === 11.2 && L3.bars.every(b => b.from === 0))
    ok('ch.27: 0.10.0\'s shade 11.4 to 5.9 s and the revisits 4.2 and 3.0 to 2.0 and 0.56 are the review\'s', rv.includes('| Noise library | 11.4 s | 5.9 s | −48% |') && rv.includes('| Noise library: show it again, hide it again (texts seen before) | 4.2 s, 3.0 s | 2.0 s, 0.56 s |'))
    // the kernels: the model's sixteen are the engine's table today (the step cache off, the photon map on), and exactly
    // the march, surface and occlusion kernels (and the step cache's fill) declare the scene's uniforms
    const table = [...rm.slice(rm.indexOf('const wavefrontKernels = '), rm.indexOf('PER-KERNEL GPU TIME')).matchAll(/\['(\w+)', 'prog_/g)].map(m => m[1]).filter(n => n !== 'stepcache_fill')
    const mine = Object.keys({ ...CK.FREE, ...CK.sceneKernels(0) })
    const kernelText = name => { const i = wf.indexOf(`export let prog_${name} =`); return i < 0 ? '' : wf.slice(i, wf.indexOf('\nexport ', i + 10)) }
    const sceneful = ['march', 'surface', 'occlude', 'stepcache_fill'].every(n => kernelText(n).includes('computeUniformTypes(scene.uniforms)'))
    const free = ['shade', 'sppm', 'resolve', 'genphotons', 'emit_collect'].every(n => !kernelText(n).includes('computeUniformTypes(scene.uniforms)'))
    ok('ch.27: the session\'s sixteen kernels are the engine\'s table; march, surface and occlusion hold the scene, shade and the others declare the base uniforms only', table.length === 16 && mine.length === 16 && table.every(n => mine.includes(n)) && sceneful && free
        && (wf.match(/computeUniformTypes\(scene\.uniforms\)/g) || []).length === 4, `${table.join(' ')} | ${mine.join(' ')}`)
    const P = CK.playSession(), off = CK.playSession(CK.SESSION, { cache: false }), nofree = CK.playSession(CK.SESSION, { free: false })
    const sizesOf = st => Object.entries({ ...CK.FREE, ...CK.sceneKernels(st.size) }).map(([name, size]) => ({ name, size }))
    ok('ch.27: the session: open 16 compiled; a value nothing; a shape 3 compiled, 13 cached; scene B 3; back and undo all cached; each build predictCompile\'s', P.map(p => `${p.compiled.length}/${p.cached.length}`).join(' ') === '16/0 0/0 3/13 3/13 0/16 0/16'
        && P.filter(p => p.compiled.length).every(p => p.ms === CP.predictCompile(sizesOf(p).map(k => ({ ...k, cached: !p.compiled.includes(k.name) }))).expectMs), P.map(p => `${p.compiled.length}/${p.cached.length}`).join(' '))
    ok('ch.27: without the cache every text change compiles all sixteen; with the four declaring the scene\'s uniforms a shape or a scene compiles seven, a revisit still cached', off.map(p => p.compiled.length).join(' ') === '16 0 16 16 16 16' && nofree.map(p => p.compiled.length).join(' ') === '16 0 7 7 0 0')
    // the four are the ones 0.10.0 changed, and today's base-uniform kernels include them; every kernel has a job written
    const g7 = readFileSync(join(REPO, 'lib/pathtracer/core/genrays.js'), 'utf8'), cl = readFileSync(join(REPO, 'CHANGELOG.md'), 'utf8')
    ok('ch.27: the four kernels are those genrays.js and the 0.10.0 entry name; every kernel of the table has a job', g7.includes('Ray generation has no interest in geometry, and nor\n   have resolve, genphotons and emit_collect') && cl.includes('Ray generation, resolve, the light tracer\'s photons and\n  the emitter list\'s collect pass declared the scene\'s own uniforms')
        && CK.ONCE_SCENE.join() === 'genrays,resolve,genphotons,emit_collect' && table.every(n => typeof CK.JOBS[n] === 'string' && CK.JOBS[n].length > 8))
    // the bar
    const C13 = CC.barCurves(10, 1.3), atT = (C, t) => CK.countBar(t * 1000, C.ready)
    ok('ch.27: a build predicted 10 s taking 13, its 13 kernels: the old bar 85% after a second (11 of 13), 12 of 13 at nine tenths; the clock\'s 9%, 90% at the prediction, never 100% before the end', Math.round(100 * atT(C13, 1)) === 85 && atT(C13, 11.7) === 12 / 13 && Math.round(100 * CP.compileFraction(1000, 10000)) === 9
        && CP.compileFraction(10000, 10000).toFixed(2) === '0.90' && [11, 15, 25, 100].every(t => CP.compileFraction(t * 1000, 10000) < 0.99) && CP.compileLabel(7000, 10000) === 'about 3 s left' && CP.compileLabel(12000, 10000) === 'taking longer than usual')
    const lr = CK.learning(CC.LEARN_STEPS, { slow: 2 }), fast = CK.learning(CC.LEARN_STEPS, { slow: 0.2 }), slow6 = CK.learning(CC.LEARN_STEPS, { slow: 6 })
    const err = q => q.predicted / q.took - 1
    ok('ch.27: learning a machine twice as slow: −50%, −25%, −12.5%, −6.3%, the reload ignored, then −3.1, −1.6, −0.8% (the fold-out\'s rates 22.8, 26.6, 28.5, 29.45, 29.93, 30.16, 30.28); one five times faster never learns; one six times slower doubles at most', ['-0.500', '-0.250', '-0.125', '-0.063'].every((v, i) => err(lr[i]).toFixed(3) === v)
        && lr[4].cacheHit && lr[4].learned === lr[4].rate && Math.abs(err(lr[6])) < 0.02 && [5, 6, 7].map(i => (100 * err(lr[i])).toFixed(1)).join() === '-3.1,-1.6,-0.8'
        && lr.map(q => (q.learned * 1000).toFixed(2)).join() === '22.80,26.60,28.50,29.45,29.45,29.93,30.16,30.28' && lr[4].took > CP.LEARN_MIN_MS && fast.every(q => q.learned === CP.DEFAULT_RATE) && Math.abs(slow6[0].learned / CP.DEFAULT_RATE - 2) < 1e-9, lr.map(q => err(q).toFixed(3)).join(' '))
    const readme = readFileSync(join(REPO, 'lib/pathtracer/README.md'), 'utf8'), twg = readFileSync(join(REPO, 'lib/tinywebgpu/src/tinywebgpu.js'), 'utf8'), ar = readFileSync(join(REPO, 'roadmap/ARCHITECTURE.md'), 'utf8')
    ok('ch.27: the stories and numbers are where the page says', readme.includes('raising the Menger iteration count froze the tab with no error') && twg.includes('seconds to a minute in which the page cannot')
        && rm.includes('This was nine sequential awaits, and every one of them awaited nothing') && ar.includes('| lens assembly x 32, as data | 52 205 -> 1 802 |') && readFileSync(join(REPO, 'docs/PERFORMANCE.md'), 'utf8').includes('That took the Noise library from over a minute to ~20 s.'))
}

/* CHAPTER 28: FEELING FAST -------------------------------------------------------------------------------------- */
{
    const FE = await import('../kit/feel.js'), FC = await import('../ch/feel.js')
    // THE GOVERNOR MIRROR HELD TO THE REAL LOOP: lib/render-loop.js run in a child process (it reads the browser's
    // requestAnimationFrame and performance.now, stubbed there, not here), each frame's interval the last frame's cost
    const { execFileSync } = await import('node:child_process')
    // With a slice, the renderer traces what raytrace_main.js's last slicing line allows (the line held below) and
    // tells the loop through opts.done, as the page's renderer does.
    const realSpp = (sampleMs, frames = 160, slice = 0) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
        let clock = 0, due = []
        Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true, writable: true })
        globalThis.requestAnimationFrame = f => { due.push(f) }
        const { makeRenderLoop } = await import(${JSON.stringify(join(REPO, 'lib/render-loop.js'))})
        const spp = [], cost = { paced: () => false, frame() { }, record: f => f(), submitted() { }, reset() { } }
        const traced = n => ${slice} > 0 ? (${sampleMs} > ${slice} ? 1 / Math.ceil(${sampleMs} / ${slice}) : Math.max(1, Math.min(n, Math.floor(${slice} / ${sampleMs})))) : n
        const L = makeRenderLoop(n => { spp.push(n) }, cost, { start: 3, ...(${slice} > 0 ? { done: () => traced(spp[spp.length - 1]) } : {}) })
        L.start()
        let last = 1000 / 60
        for (let k = 0; k < ${frames}; k++) { clock += last; const d = due; due = []; for (const f of d) f(); await new Promise(r => setTimeout(r, 0)); last = 5 + traced(spp[spp.length - 1]) * ${sampleMs} }
        console.log(JSON.stringify(spp))`], { encoding: 'utf8' }))
    const same = (ms, slice = 0) => { const real = realSpp(ms, 160, slice), mine = FE.governor({ sampleMs: ms, rule: 'now', frames: 160, sliceMs: slice }).map(f => f.spp); return real.length === 160 && real.every((v, i) => v === mine[i]) }
    ok('ch.28: the figure\'s governor traces, frame by frame, what the real render-loop.js does, at 5, 20 and 60 ms a sample', [5, 20, 60].every(ms => same(ms)))
    ok('ch.28: ...and asks what it asks with the slice on, told what each frame traced (opts.done), at 5, 20 and 60 ms', [5, 20, 60].every(ms => same(ms, 30)))
    ok('ch.28: the slice\'s cap on a light scene is raytrace_main.js\'s line', readFileSync(join(REPO, 'lib/pathtracer/core/raytrace_main.js'), 'utf8').includes('if (sliceMs > 0) count = sliced || sampleMs == null ? 1 : Math.max(1, Math.min(count, Math.floor(sliceMs / Math.max(1e-3, sampleMs))));'))
    const c5 = FE.governor({ sampleMs: 5, sliceMs: 30 }).slice(-20), c20 = FE.governor({ sampleMs: 20, sliceMs: 30 }).slice(-20)
    ok('ch.28: with the slice, 5 ms traces 6 a frame at 28.6 fps, the count asking 7.21; 20 ms traces 1 at 40', c5.every(f => f.traced === 6 && f.fps.toFixed(1) === '28.6' && f.count.toFixed(2) === '7.21') && c20.every(f => f.traced === 1 && f.fps === 40))
    const g20 = FE.governor({ sampleMs: 20 }), g5 = FE.governor({ sampleMs: 5 }), b20 = FE.governor({ sampleMs: 20, rule: 'before' }), b60 = FE.governor({ sampleMs: 60, rule: 'before' })
    ok('ch.28: today, 2 samples at 22 fps settled; a light scene 8 within 35 frames; before, hunting 2 and 3, and 0 and 1 on a heavy scene', g20.slice(-20).every(f => f.spp === 2) && g5.slice(35).every(f => f.spp === 8)
        && new Set(b20.slice(-20).map(f => f.spp)).size === 2 && b60.slice(-20).some(f => f.spp === 0) && g20.every(f => f.spp >= 1))
    let x = 3; for (let i = 0; i < 19; i++) x -= 0.1
    ok('ch.28: nineteen steps of 0.1 down from 3 reach 1.0999999999999983, the next 0.9999999999999983', x === 1.0999999999999983 && x - 0.1 === 0.9999999999999983 && Math.floor(x - 0.1) === 0)
    // the drag, through the real interaction.js and quality.js
    const mode = held => { const d = FE.dragTimeline({ held }), ch = []; d.forEach((f, k) => { if (k && f.mode !== d[k - 1].mode) ch.push([f.t, f.mode]) }); return ch }
    const h = mode(true), f = mode(false)
    ok('ch.28: a held drag traces Draft from its first poke to 0.4 s after the button comes up; a poking one drops to full in its pause and back', h.length === 2 && h[0][1] === 1 && h[0][0] === 304 && h[1][1] === 0 && h[1][0] >= 2100 && h[1][0] <= 2120
        && f.length === 4 && f[1][1] === 0 && f[1][0] >= 1088 && f[1][0] <= 1104 && f[2][1] === 1, JSON.stringify([h, f]))
    // the slicing and the submissions, their constants held to the engine's exports
    let RM = null; try { RM = await import('../../lib/pathtracer/core/raytrace_main.js') } catch { }
    ok('ch.28: the copied constants are raytrace_main.js\'s', !RM || (RM.SUBMIT_MS === FE.SUBMIT_MS && RM.SPLIT_OVER_MS === FE.SPLIT_OVER_MS && RM.SPLIT_ITERS === FE.SPLIT_ITERS && RM.SLICE_MAX === FE.SLICE_MAX && RM.SLICE_MIN_RAYS === FE.SLICE_MIN_RAYS && RM.SLICE_UNTIMED === FE.SLICE_UNTIMED), RM ? 'held' : 'raytrace_main.js not importable here')
    const s1 = FE.slicing({ sampleMs: 1000, px: 1280 * 720 }), s10 = FE.slicing({ sampleMs: 10000, px: 1280 * 720 }), s640 = FE.slicing({ sampleMs: 10000, px: 640 * 360 }), s20 = FE.slicing({ sampleMs: 20, px: 1280 * 720 })
    ok('ch.28: 20 ms whole; a second in 34 batches; 10 s at 720p 57 batches of 175 ms; at 640 x 360 15 of 667 ms, 5 submissions of 5 iterations', !s20.sliced && s20.K === 1 && s1.K === 34 && s1.perCall === 1 && s10.K === 57 && Math.round(s10.frameMs) === 175 && s10.submissions === 1
        && s640.K === 15 && Math.round(s640.frameMs) === 667 && s640.splitEvery === 5 && s640.submissions === 5 && Math.round(s640.submitMs) === 139 && s640.lastIters === 4)
    // the floor's arithmetic: the count rounded up, so batches a little under it; the iterations every batch runs
    const sch = readFileSync(join(REPO, 'lib/pathtracer/core/uniforms.schema.js'), 'utf8')
    ok('ch.28: 57 batches of about 16,168 rays at 1280 x 720 (the count rounded up); 24 iterations at the defaults, 38 at High quality',
        Math.round(921600 / 57) === 16168 && readFileSync(join(REPO, 'lib/pathtracer/core/raytrace_main.js'), 'utf8').includes('Math.ceil(planned.total / Math.max(1, R.sliceMinRays ?? SLICE_MIN_RAYS))')
        && readFileSync(join(REPO, 'lib/pathtracer/core/raytrace_main.js'), 'utf8').includes('const worstCase = Math.max(2, ((uniforms.maxbounce | 0) + 1) + chunks)')
        && /maxiter: \{ type: 'u32', def: 400/.test(sch) && /maxbounce: \{ type: 'u32', def: 10,/.test(sch) && (10 + 1) + Math.ceil(400 / 32) === 24 && (24 + 1) + Math.ceil(400 / 32) === 38
        && readFileSync(join(REPO, 'lib/pathtracer/quality.js'), 'utf8').includes("{ id: 'high', label: 'High quality', values: { ...STANDARD, maxbounce: 24"))
    // two in flight: runSamples' own order, and the figure's times
    const { runSamples } = await import('../../lib/pathtracer/samples.js')
    // the loop's own record: each trace as it is made, each sample as the loop has waited for it (onProgress)
    const realOrder = async depth => { const ev = []; let n = 0; await runSamples(6, { inFlight: depth, trace: async () => { ev.push(`trace ${++n}`) }, done: async () => { }, onProgress: k => ev.push(`done ${k}`) }); return ev }
    const r1 = await realOrder(1), r2 = await realOrder(2)
    ok('ch.28: the figure\'s order of recordings and waits is runSamples\', one in flight and two', r1.join() === FE.inFlight(6, { cpuMs: 12, gpuMs: 40, depth: 1 }).order.join() && r2.join() === FE.inFlight(6, { cpuMs: 12, gpuMs: 40, depth: 2 }).order.join(), `${r2.join(' ')} | ${FE.inFlight(6, { cpuMs: 12, gpuMs: 40, depth: 2 }).order.join(' ')}`)
    ok('ch.28: six samples of 12 + 40 ms: 312 one in flight, 252 two', FE.inFlight(6, { cpuMs: 12, gpuMs: 40, depth: 1 }).ms === 312 && FE.inFlight(6, { cpuMs: 12, gpuMs: 40, depth: 2 }).ms === 252)
    const rv = readFileSync(join(REPO, 'docs/PERFORMANCE_REVIEW.md'), 'utf8'), rl = readFileSync(join(REPO, 'lib/render-loop.js'), 'utf8')
    ok('ch.28: the measured numbers are where the page says', rl.includes('took 1.4-6.8 s, and 0.2 s with it paused') && readFileSync(join(REPO, 'lib/pathtracer/samples.js'), 'utf8').includes('13-25% off a sample')
        && rv.includes('257.6') && rv.includes('225.0') && rv.includes('57.5') && rv.includes('42.9') && readFileSync(join(REPO, 'lib/render-cost.js'), 'utf8').includes('seventeen seconds of backlog'))
}

/* CHAPTER 29: NOISE, BIAS AND CHECKING ---------------------------------------------------------------------------- */
{
    const CH = await import('../kit/checking.js'), CF = await import('../ch/checking.js'), FL = await import('../kit/flatland.js')
    // THE TRUE VALUE: a fresh run of 200,000 paths, other random numbers, against the constant (both standard errors)
    const dir = Math.atan2(CH.LOOK[1] - CH.EYE[1], CH.LOOK[0] - CH.EYE[0]), dx = Math.cos(dir), dy = Math.sin(dir)
    {
        const R = FL.rng(777001), n = 200000, info = {}
        let s1 = 0, s2 = 0, lost = 0, all = 0
        for (let i = 0; i < n; i++) {
            const L = FL.tracePath(CH.CORNER, CH.EYE[0], CH.EYE[1], dx, dy, { rand: R, maxBounce: i < 50000 ? 60 : CH.MAX_BOUNCE, info })
            s1 += L; s2 += L * L
            if (i < 50000) { lost += L - info.upTo[CH.MAX_BOUNCE]; all += L }
        }
        const m = s1 / n, se = Math.sqrt((s2 / n - m * m) / n), z = Math.abs(m - CH.TRUTH) / Math.hypot(se, CH.TRUTH_SE)
        ok('ch.29: the pixel\'s true value holds against a fresh 200,000 paths (within 3 standard errors)', z < 3, `${m.toFixed(4)} ± ${se.toFixed(4)} against ${CH.TRUTH}, z ${z.toFixed(2)}`)
        ok('ch.29: the light past the 16 bounces the figure follows is under 0.01% (paired, the same paths followed to 60)', lost / all < 1e-4, `${(100 * lost / all).toFixed(5)}%`)
    }
    // THE FOUR READINGS of the figure's first run: where the page says they stand
    const at = w => CF.standing(1, w)
    const wh = at('whole'), cp = at('cap'), cl = at('clamp'), wn = at('window')
    ok('ch.29: the whole path within 3 error bars of the true value; the cap about 19 under at 0.94, the clamp about 17 under at 1.20', Math.abs(wh.off) < 3 && Math.round(-cp.off) === 19 && cp.Y.toFixed(2) === '0.94' && Math.round(-cl.off) === 17 && cl.Y.toFixed(2) === '1.20',
        `${wh.off.toFixed(1)} ${cp.off.toFixed(1)} ${cp.Y.toFixed(3)} ${cl.off.toFixed(1)} ${cl.Y.toFixed(3)}`)
    ok('ch.29: the window is worth 21 samples after 4096, its error bar many times the true mean\'s', Math.abs(1 / wn.S - 21) < 1e-6 && wn.se > 10 * wh.se)
    ok('ch.29: the corner drawing counts a lamp leg as its reading does: the cap keeps leg 1 and cuts leg 2, the clamp marks 7 and 4.9 and not 3.43',
        CF.legCounted('cap', 1, 7) === 'counted' && CF.legCounted('cap', 2, 4.9) === 'cut' && CF.legCounted('clamp', 1, 7) === 'clamped' && CF.legCounted('clamp', 2, 4.9) === 'clamped'
        && CF.legCounted('clamp', 3, 3.43) === 'counted' && CF.legCounted('whole', 5, 1) === 'counted' && CF.legCounted('window', 2, 7) === 'counted')
    ok('ch.29: the clamp cuts the lamp found by the first bounce (7) and the second (4.9), not the third (3.43)', 0.7 * 10 > CH.CLAMP && 0.49 * 10 > CH.CLAMP && 0.343 * 10 < CH.CLAMP
        && CH.CORNER.shapes.filter(sh => sh.kind === 'box').every(sh => sh.albedo === 0.7) && CH.CORNER.shapes.find(sh => sh.emit).emit === 10)
    // THE FURNACE
    const rows = page => CF.furnaceRows(page), byId = (page, id) => rows(page).find(q => q.row.id === id)
    ok('ch.29: working, the white rows read 1 within 2%, the grey 0.85, the control 0.25: every verdict as it must be', rows('working').every(CF.verdict) && byId('working', 'grey').ratio.toFixed(2) === '0.85' && byId('working', 'control').ratio.toFixed(2) === '0.25')
    ok('ch.29: working, NEE off and the mirror read exactly 1 with noise 0; NEE on has noise', byId('working', 'matte-off').ratio === 1 && byId('working', 'matte-off').noise === 0 && byId('working', 'mirror').ratio === 1 && byId('working', 'mirror').noise === 0 && byId('working', 'matte').noise > 0)
    ok('ch.29: broken either way, every row reads 1 with noise 0, the control passing and the grey failing', ['empty', 'sky'].every(pg => rows(pg).every(q => q.ratio === 1 && q.noise === 0) && CF.verdict(byId(pg, 'control')) === false && !CF.verdict(byId(pg, 'grey'))))
    {
        // the disc fills three quarters of the film (pixel centres), and the NEE-on estimator is right on average
        let hit = 0
        for (let i = 0; i < CH.FPIX; i++) { const x = ((i + 0.5) / CH.FPIX) * 2 - 1, k = x * Math.tan(Math.atan(Math.tan(Math.asin(1 / 3)) / 0.75)), l = Math.hypot(k, 1), ddx = k / l, ddy = 1 / l, b2 = -3 * ddy, D = b2 * b2 - 8; if (D > 0) hit++ }
        const film = CH.furnaceFilm(CH.FURNACE_ROWS[0], 'working', { spp: 1500, seed: 9 }), mid = film.slice(10, 46).reduce((a, v) => a + v, 0) / 36
        ok('ch.29: the disc fills 42 of the 56 pixels; matte with NEE on reads 1 on the disc over many samples (within 0.5%)', hit === 42 && Math.abs(mid - 1) < 0.005, `${hit} ${mid.toFixed(5)}`)
    }
    {
        const r = Array.from({ length: 60 }, (_, k) => CH.furnaceReading(CH.furnaceFilm(CH.FURNACE_ROWS[0], 'working', { seed: k + 1 })).ratio)
        const m = r.reduce((a, b) => a + b) / r.length, sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1))
        ok('ch.29: the white NEE-on row spreads by about 0.4% from run to run, its mean 1 (the page\'s "five times" for 2%)', sd > 0.003 && sd < 0.0055 && Math.abs(m - 1) < 3 * sd / Math.sqrt(r.length), `${m.toFixed(5)} ${sd.toFixed(5)}`)
    }
    const rm29 = readFileSync(join(REPO, 'lib/pathtracer/core/raytrace_main.js'), 'utf8')
    ok('ch.29: the ratio, noise and seRatio are the bench\'s formulas', rm29.includes('noise: dn && mean ? (dsum / dn) / mean : 0') && rm29.includes('seRatio: e2 > 0 ? Math.sqrt(d2 / e2) : null'))
    // THE ERROR BARS: the page's numbers
    const eb = st => CF.barsOf(st), st = CF.figures.errorbar.steps
    const e1 = eb(st.mean), e2 = eb(st.more), e3 = eb(st.window), e4 = eb(st.wrong)
    ok('ch.29: 32 samples: 0.175 real, 0.176 reported; 256: about 0.065 both, seRatio 1.08; the window worth 21, 0.216 and 0.218; counted as 11, 0.308 and seRatio 0.69',
        e1.real.toFixed(3) === '0.175' && e1.reported.toFixed(3) === '0.176' && Math.abs(e2.real - 0.065) < 0.002 && Math.abs(e2.reported - 0.065) < 0.003 && e2.seRatio.toFixed(2) === '1.08'
        && e3.worth.toFixed(1) === '21.0' && e3.real.toFixed(3) === '0.216' && e3.reported.toFixed(3) === '0.218' && e4.reported.toFixed(3) === '0.308' && e4.seRatio.toFixed(2) === '0.69',
        [e1.real, e1.reported, e2.real, e2.reported, e2.seRatio, e3.real, e3.reported, e4.reported, e4.seRatio].map(v => v.toFixed(3)).join(' '))
    {
        const r = Array.from({ length: 40 }, (_, k) => CH.errorBars({ samples: 256, pixels: 1000, seed: k + 1 }).seRatio)
        const m = r.reduce((a, b) => a + b) / r.length, sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1))
        ok('ch.29: seRatio spreads by about 3% from one set of a thousand pixels to the next, so the first set\'s 1.08 is about 2.6 of those high', sd > 0.02 && sd < 0.04 && Math.abs(m - 1) < 0.02 && (r[0] - 1) / 0.03 > 2.4 && (r[0] - 1) / 0.03 < 2.8, `${m.toFixed(3)} ${sd.toFixed(3)} ${r[0].toFixed(3)}`)
    }
    ok('ch.29: a moving window\'s S settles at w / (2 - w) = 1/21 for w = 1/11', Math.abs((1 / 11) / (2 - 1 / 11) - 1 / 21) < 1e-15)
    // THE STORIES, where the page says they are
    const tj = readFileSync(join(REPO, 'lib/pathtracer/tests.js'), 'utf8'), td = readFileSync(join(REPO, 'docs/TESTING.md'), 'utf8'), wf29 = readFileSync(join(REPO, 'lib/pathtracer/core/wavefront.js'), 'utf8')
    ok('ch.29: the stories and numbers are where the page says', tj.includes('read 1000.000244 with zero noise on every row, rough glass included') && tj.includes('every row 1000.000244, noise 0, the CONTROL with')
        && tj.includes("{ label: 'CONTROL: black sphere -- must read well below 1', set: { tBase: 0 } }") && wf29.includes('the window\'s real sample count, which "N" is not')
        && wf29.includes('if (UB.fireflyClamp > 0.0 && !direct)') && /\| `error-bar` \|[^\n]*open — first press/.test(td) && td.includes('142–352, **median right** (1.01–1.04)') && td.includes('about 10⁵ too much')
        && td.includes('**0.9231**') && td.includes('rough glass **0.9587**') && td.includes('All four arms inside 0.15%') && td.includes('Pascal, 1188×969, 32 samples, `envUniform` 1000 cd/m², maxbounce 40')
        && readFileSync(join(REPO, 'lib/pathtracer/core/check-shaders.mjs'), 'utf8').includes('It said "24 modules parse" on the')
        && readFileSync(join(REPO, 'roadmap/SURFACES.md'), 'utf8').includes('A small positive bias, +0.02-0.09%, on metal'))
}

/* CHAPTER 30: NUMBERS HAVE GRAIN --------------------------------------------------------------------------------- */
{
    const GR = await import('../kit/grain.js'), GP = await import('../ch/precision.js'), TL = await import('../../lib/pathtracer/core/tolerances.js')
    // THE FATTENED DISC: Steiner's formula against brute force (the area within eps of the tilted disc's outline, on a grid)
    const brute = (r, eps, tilt) => {
        const b = r * Math.cos(tilt * Math.PI / 180), N = 360, M = 1200, h = (r + eps) * 2 / N, rim = []
        for (let k = 0; k < M; k++) { const t = 2 * Math.PI * k / M; rim.push([r * Math.cos(t), b * Math.sin(t)]) }
        let n = 0
        for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
            const x = -r - eps + (i + 0.5) * h, y = -r - eps + (j + 0.5) * h
            if ((x / r) ** 2 + (y / b) ** 2 <= 1) { n++; continue }
            let d = Infinity; for (const [u, v] of rim) d = Math.min(d, (x - u) ** 2 + (y - v) ** 2)
            if (d <= eps * eps) n++
        }
        return n * h * h / (Math.PI * r * b)
    }
    const b37 = brute(10, 0.91, 37), s37 = GR.discFatten(10, 0.91, 37)
    ok('ch.30: the fattened disc by Steiner\'s formula matches brute force within 1% (37 degrees, 0.91 mm on 1 cm)', Math.abs(b37 / s37 - 1) < 0.01, `${b37.toFixed(4)} ${s37.toFixed(4)}`)
    ok('ch.30: the 1 cm lamp at 0.91 mm: 1.19 face on, 1.22 at 37 degrees, the pair 0.822; 1.002 and 0.998 at 10 um; the flat world 1.11',
        GR.discFatten(0.01, 0.00091, 0).toFixed(2) === '1.19' && GR.discFatten(0.01, 0.00091, 37).toFixed(2) === '1.22' && (1 / GR.discFatten(0.01, 0.00091, 37)).toFixed(3) === '0.822'
        && GR.discFatten(0.01, 1e-5, 37).toFixed(3) === '1.002' && GR.flatFatten(0.01, 0.00091, 37).toFixed(2) === '1.11')
    const two = TL.TOLERANCES.find(t => t.name === 'two steps off')
    ok('ch.30: the gap: at 0.1 mm lost, one slab\'s 0.923; at 10 um seen, two slabs\' 0.857; the probe of the medium beyond is the table\'s twenty tolerances, mediumBeyond\'s offsetTol x 2',
        !GR.gapSeen(GR.GAP, 1e-4) && GR.gapT(GR.GAP, 1e-4).toFixed(3) === '0.923' && GR.gapSeen(GR.GAP, 1e-5) && GR.gapT(GR.GAP, 1e-5).toFixed(3) === '0.857'
        && two.times === GR.PROBE && two.why.includes('the medium beyond is asked this far across') && TL.TOLERANCES.find(t => t.name === 'leaving a surface').times === GR.LEAVE
        && readFileSync(join(REPO, 'lib/pathtracer/core/tracebasics.js'), 'utf8').includes('return materialAt(SDFd(r, d * offsetTol(r.pos) * 2.0), true);')
        && readFileSync(join(REPO, 'roadmap/PLAN.md'), 'utf8').includes('The index beyond a surface is probed 2 x the surface offset away (20 x'))
    // THE THREE TERMS
    const t1 = GR.terms({ extent: 0.105, dist: 0.05 }), t2 = GR.terms({ extent: 0.105, dist: 2 }), t3 = GR.terms({ extent: 10, dist: 5 })
    ok('ch.30: the mixer 10.5 um, the setting winning at 5 cm, the floor at 2 m (30.5 um), passing it at 69 cm; a room 1 mm, passing at 65.5 m; 6.55 sizes',
        Math.abs(t1.setting - 10.5e-6) < 1e-12 && t1.wins === 'the automatic tolerance' && t2.wins === 'the floor' && (t2.floor * 1e6).toFixed(1) === '30.5' && t1.beyond.toFixed(2) === '0.69'
        && t3.setting === 1e-3 && t3.beyond.toFixed(1) === '65.5' && (1e-4 / (128 * 2 ** -23)).toFixed(2) === '6.55')
    ok('ch.30: the old floor 0.1 nm in a mm scene; 10 nm at 10 m about a hundred times under 2^-23 x 10 m (1.2 um)', GR.oldFloor(1e-3) === 1e-10 && Math.round(2 ** -23 * 10 / 1e-8) === 119 && (2 ** -23 * 10 * 1e6).toFixed(1) === '1.2')
    // THE LINT: clean as written, and each planted line named by what it reaches
    const want = { none: null, sdf: /\(SDF\)/, eps: /\(marchEps\)/, tol: /\(SCN_TOL\)/, unit: /UB\.sceneUnit/, deep: /farAway calls the scene's side directly \(metres\)/ }
    ok('ch.30: the real unitlint.js passes the kernel as written and names each planted line', Object.entries(want).every(([k, re]) => { const f = GR.lint(k); return re ? f.length === 1 && re.test(f[0]) : f.length === 0 }),
        Object.keys(want).map(k => `${k}: ${GR.lint(k).join(' | ')}`).join(' // '))
    // THE STORIES, where the page says they are
    const td30 = readFileSync(join(REPO, 'docs/TESTING.md'), 'utf8'), cl30 = readFileSync(join(REPO, 'CHANGELOG.md'), 'utf8')
    ok('ch.30: the numbers and stories are where the page says', td30.includes('0.838, 0.819, 0.803, 0.799') && td30.includes('1.19x its area face on, 1.22x at the') && td30.includes('at the automatic tolerance 0.822, as predicted')
        && td30.includes('The 1 cm pairs at eps 10 um: 0.994') && td30.includes('The 0.5 mm gap at auto eps read 0.9228, one slab\'s value')
        && readFileSync(join(REPO, 'lib/pathtracer/PRECISION.md'), 'utf8').includes('0 of 2304 rays differ') && readFileSync(join(REPO, 'lib/pathtracer/PRECISION.md'), 'utf8').includes('its automatic tolerance is 10.5 µm')
        && readFileSync(join(REPO, 'lib/pathtracer/core/photometry.js'), 'utf8').includes("Menger's is 424 m across") && readFileSync(join(REPO, 'lib/pathtracer/core/tracebasics.js'), 'utf8').includes('WGSL\'s division is not exact (2.5 ulp)')
        && readFileSync(join(REPO, 'roadmap/PLAN.md'), 'utf8').includes('0.211 mm in RGBW_mixer, whose lightguide is 0.200 mm in front of its dies') && cl30.includes('**The tolerance row could not go below 10 µm.** Its step was 1e-5 m')
        && cl30.includes('5% of the sphere\'s radius') && readFileSync(join(REPO, 'lib/pathtracer/core/unitlint.js'), 'utf8').includes('the bug this repository keeps'))
    ok('ch.30: the figures\' readouts run', Object.values(GP.figures).every(f => Object.values(f.steps).every(st => typeof f.readout({ ...f.state, ...st }) === 'string')))
}

/* CHAPTER 31: THE OPTICS BENCH --------------------------------------------------------------------------------- */
{
    const OK = await import('../kit/optics.js'), OF = await import('../ch/optics.js')
    // the copied constant is the kernels'; the sums one add at a time, and the closed forms
    const kj = readFileSync(join(REPO, 'lib/pathtracer/optics/kernels.js'), 'utf8')
    ok('ch.31: OPT_FX and the rounding are kernels.js optAdd\'s', kj.includes('export const OPT_FX = 1 << 20') && kj.includes('let v = u32(clamp(w, 0.0, 4000.0) * OPT_FX + 0.5);') && OK.OPT_FX === 1 << 20 && OK.fixedUnits(0.7) === 734003)
    ok('ch.31: the float sum jumping through runs equals one add at a time', [[1, 1e5], [0.7, 3e6], [0.3, 2e6], [1, 2 ** 24 + 20]].every(([w, n]) => OK.f32Sum(w, n) === OK.f32SumSlow(w, n)))
    ok('ch.31: weight 1 stalls at 2^24 (half after 2^25); 0.7 is 5.78% low after 2^23; the integer pair 2.7e-7 off', OK.f32Sum(1, 2 ** 25) === 2 ** 24 && ((OK.f32Sum(0.7, 2 ** 23) / (0.7 * 2 ** 23) - 1) * 100).toFixed(2) === '-5.78'
        && Math.abs(OK.intSum(0.7, 2 ** 23).read / (0.7 * 2 ** 23) - 1 + 2.7e-7) < 2e-8)
    {
        // the 0.7 curve's story: added as 0.75 while the total is 1 to 4 million (4% high at its peak), as 0.5 from 4 to 8
        // million, and nothing past 16 million, where the total stops at 2^24
        const r = k => { const n = Math.round(2 ** k); return OK.f32Sum(0.7, n) / (0.7 * n) }
        ok('ch.31: weight 0.7 rises 4% above 1 by a total of 4 million, falls under it by 8, and stops at 2^24', Math.round((r(22) - 1) * 100) === 4 && r(22) > r(21) && r(21) > 1
            && r(23.5) < r(23) && r(23) < 1 && OK.f32Sum(0.7, 2 ** 25) === 2 ** 24 && (0.7 * 2 ** 22) / 1e6 > 2.9 && (0.7 * 2 ** 23) / 1e6 < 5.9, [21, 22, 23, 23.5].map(r).map(v => v.toFixed(4)).join(' '))
    }
    const t = OK.twoOrders()
    ok('ch.31: one set of weights in two orders: two floats, one integer', t.forward !== t.backward && t.intForward === t.intBackward)
    ok('ch.31: a cos^n source\'s I0 and beam angles: 318 cd and 120 for n 1, 58.95 for n 5', OK.I0(1).toFixed(0) === '318' && OK.beamAngle(1).toFixed(2) === '120.00' && OK.beamAngle(5).toFixed(2) === '58.95' && Math.abs(OK.floorE(5, 0) - 6000 / (2 * Math.PI)) < 1e-9)
    // the far field's figures: the numbers the page gives
    const bs = st => { const b = OF.beamOf({ ...OF.figures.beam.state, ...st }); return { up: b.st.max.I / OK.I0(st.n) - 1, beam: b.st.planes[0].beam.width } }
    const S = OF.figures.beam.steps, L = bs(S.lambert), Fw = bs(S.few), M = bs(S.many), Pp = bs(S.pooled)
    ok('ch.31: the page\'s beams: Lambertian 14% high and 111 deg; cos^5 at 20,000 34% and 44; at 2 million 2% and 57.8; pooled at 200,000 1% and 58.9',
        Math.round(L.up * 100) === 14 && Math.round(L.beam) === 111 && Math.round(Fw.up * 100) === 34 && Math.round(Fw.beam) === 44 && Math.round(M.up * 100) === 2 && M.beam.toFixed(1) === '57.8'
        && Math.round(Pp.up * 100) === 1 && Pp.beam.toFixed(1) === '58.9', JSON.stringify([L, Fw, M, Pp]))
    {
        // the far field over many rays holds the closed form, the pooled curve at every angle within 3%
        const far = OK.farOf(5, 2e6, { seed: 9 }), R = OK.intensity(far, { symmetry: 'rotational' }), c = OK.planeCurve(R, 0).points.filter(q => q.a >= 0 && q.a <= 60)
        ok('ch.31: two million cos^5 rays, pooled: the intensity within 3% of I0 cos^5 out to 60 degrees', c.every(q => Math.abs(q.I / (OK.I0(5) * Math.cos(q.a * Math.PI / 180) ** 5) - 1) < 0.03), c.map(q => (q.I / (OK.I0(5) * Math.cos(q.a * Math.PI / 180) ** 5)).toFixed(3)).join(' '))
    }
    const mp = st => OF.mapOf({ ...OF.figures.map.state, ...st }), MS = OF.figures.map.steps, mid = m => m.E[Math.floor(m.ny / 2) * m.nx + Math.floor(m.nx / 2)]
    const m1 = mp(MS.plain), m2 = mp(MS.few), m3 = mp(MS.gauss), m4 = mp(MS.knn)
    ok('ch.31: the page\'s maps: 29 hits a cell and 19% at 50,000; 4 and 51% at 5,000; Gaussian 10%, 8 cm, its middle 831; nearest 32, 18%',
        Math.round(m1.hitsPerLitCell) === 29 && Math.round(m1.relNoise * 100) === 19 && Math.round(m2.hitsPerLitCell) === 4 && Math.round(m2.relNoise * 100) === 51
        && Math.round(m3.relNoise * 100) === 10 && Math.round(m3.bandwidthM * 100) === 8 && Math.round(mid(m3)) === 831 && Math.round(m4.relNoise * 100) === 18)
    {
        // the Gaussian's middle reads low on average, not only in this run: 120 runs, its mean 913, 4.4% under 955
        let s = 0
        for (let seed = 1; seed <= 120; seed++) s += mid(OK.floorMap(5, 5000, { smooth: 'gauss', seed }))
        const mean = s / 120
        ok('ch.31: the Gaussian map\'s middle over 120 runs of 5,000 rays: 913 lux, 4.4% under the true 955', Math.round(mean) === 913 && ((mean / OK.floorE(5, 0) - 1) * 100).toFixed(1) === '-4.4' && Math.round(OK.floorE(5, 0)) === 955, mean.toFixed(1))
    }
    {
        // over many rays the plain map's middle row holds the closed form within its noise
        const m = OK.floorMap(5, 400000, { seed: 4 }), row = Math.floor(m.ny / 2)
        let worst = 0
        for (let i = 4; i < m.nx - 4; i++) { const x = m.range.a[0] + (i + 0.5) * m.cell, e = OK.floorE(5, Math.abs(x)); if (e > 100) worst = Math.max(worst, Math.abs(m.E[row * m.nx + i] / e - 1)) }
        ok('ch.31: 400,000 rays: the map\'s middle row within 15% of the closed form wherever it is over 100 lux (its cells about 7% noise there)', worst < 0.15, worst.toFixed(3))
    }
    const rd = readFileSync(join(REPO, 'lib/pathtracer/optics/README.md'), 'utf8'), td31 = readFileSync(join(REPO, 'docs/TESTING.md'), 'utf8')
    ok('ch.31: the stories and numbers are where the page says', rd.includes('The largest of many noisy') && rd.includes('took 1.4 s with the picture running and 0.2 s with it stopped')
        && td31.includes('slab 0.9991 / 0.9999 / 1.0007') && td31.includes('`vs polar.` 0.9991 / 0.9966 / 0.9721') && /\| `optics-farfield` \|[^\n]*cos⁵ 58\.95°[^\n]*open — first press/.test(td31)
        && td31.includes('4247 K, du\'v\' 0.013 -- from a 3 x 3 sensor holding ~17 blue photon hits, where one sigma is 250 K') && td31.includes('3999.9 K')
        && readFileSync(join(REPO, 'lib/pathtracer/optics/zemax.js'), 'utf8').includes('was read 7 at a time: garbage') && kj.includes('immune to the retry'))
}

/* CHAPTER 32: A RAY TRACER IN ONE PAGE --------------------------------------------------------------------------- */
{
    const P1 = await import('../kit/onepage.js'), Y = await import('../ch/yours.js'), F = await import('../kit/flatland.js')
    // the one page is the figures' path tracer: on the same random numbers, flatland's picture, matte and mirror, with
    // NEE and without (the page's "the two make the same picture")
    let worst = 0
    for (const mirror of [false, true]) for (const nee of [false, true]) {
        const shapes = Y.roomOf(mirror), a = P1.render(shapes, Y.CAM, 6, F.rng(5), { nee, bounces: 4 }), r = F.rng(5)
        for (let i = 0; i < Y.CAM.pixels; i++) {
            let s = 0
            for (let k = 0; k < 6; k++) { const [x, y, dx, dy] = F.cameraRay(Y.CAM, i, r()); s += F.tracePath({ shapes }, x, y, dx, dy, { nee, maxBounce: 4, rand: r }) }
            worst = Math.max(worst, Math.abs(a[i] - s / 6))
        }
    }
    ok('ch.32: onepage.js renders flatland.js\'s picture on the same random numbers, matte and mirror, with NEE and without', worst < 1e-12, worst)
    // no imports: the file is the whole program
    const src = readFileSync(join(REPO, 'tutorial/kit/onepage.js'), 'utf8'), code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/\/\/.*$/, '').trim()).filter(Boolean)
    ok('ch.32: onepage.js imports nothing, and is 88 lines of code', !/^\s*import\b/m.test(src) && code.length === 88, code.length)
    // the march figure's steps and the film's readouts, as the page tells them
    const M = Y.figures.march, mr = st => M.readout({ ...M.state, ...M.steps[st] })
    ok('ch.32: the march: the box\'s side in 8 steps, skimming its top 69, the lamp 9', mr('hit') === 'the ray hits the box in 8 steps of the march' && mr('graze') === 'the ray hits the box in 69 steps of the march'
        && mr('lamp') === 'the ray hits the lamp in 9 steps of the march', [mr('hit'), mr('graze'), mr('lamp')].join(' / '))
    const Fm = Y.figures.film, fr = st => Fm.readout({ ...Fm.state, ...Fm.steps[st] })
    ok('ch.32: the film: 1 sample 0.1118 and 1.537; 64 0.1184 and 0.216; 16 aimed 0.1190 and 0.261; the mirror 0.1602',
        fr('one').includes('average 0.1118') && fr('one').includes('average, 1.537') && fr('many').includes('average 0.1184') && fr('many').includes('average, 0.216')
        && fr('nee').includes('average 0.1190') && fr('nee').includes('average, 0.261') && fr('mirror').includes('average 0.1602'), [fr('one'), fr('many'), fr('nee'), fr('mirror')].join(' / '))
    // the camera's numbers and the march's settings the page states
    ok('ch.32: 56 pixels over 64 degrees; the lamp 0.015 thick; the march\'s 0.9, 0.001, 50 and 200', Y.CAM.pixels === 56 && Math.round(Y.CAM.fov * 180 / Math.PI) === 64 && Y.roomOf(false).find(s => s.emit).r === 0.015
        && src.includes('t += Math.abs(d) * 0.9') && src.includes('eps = 1e-3, far = 50') && src.includes('n < 200') && readFileSync(join(REPO, 'lib/pathtracer/core/raytrace_main.js'), 'utf8').includes('const MARCH_STEPS = 32'))
    // the outline figure: 17 of 28 points face the point below, 5 beyond the end; the room lamp's ends 6% of what it picks from
    const Ol = Y.figures.outline, ol = st => Y.outlineOf({ ...Ol.state, ...Ol.steps[st] }.P).filter(q => q.faces).length, rl = Y.roomOf(false).find(s => s.emit)
    const ends = 2 * Math.PI * rl.r / (Math.hypot(rl.b[0] - rl.a[0], rl.b[1] - rl.a[1]) + 2 * Math.PI * rl.r), bigEnds = 2 * Math.PI * Y.BIG_LAMP.r / (Math.hypot(Y.BIG_LAMP.b[0] - Y.BIG_LAMP.a[0], Y.BIG_LAMP.b[1] - Y.BIG_LAMP.a[1]) + 2 * Math.PI * Y.BIG_LAMP.r)
    ok('ch.32: the outline: 17 of 28 face the point below, 5 beyond the end; the ends 6% of the room lamp\'s outline, 47% of the large one\'s', Y.OUTLINE_K === 28 && ol('below') === 17 && ol('end') === 5 && Math.round(ends * 100) === 6 && Math.round(bigEnds * 100) === 47, `${ol('below')} ${ol('end')} ${ends} ${bigEnds}`)
    // every point lampPoint gives is on the capsule's outline, and the far side is never picked
    let off = 0, far = 0
    for (let k = 0; k < 400; k++) { const q = P1.lampPoint(Y.BIG_LAMP, 0.7, -1.7, (k + 0.5) / 400); off = Math.max(off, Math.abs(P1.segment(q.x, q.y, Y.BIG_LAMP))); if (q.y > 1e-9 && q.x > Y.BIG_LAMP.a[0] && q.x < Y.BIG_LAMP.b[0]) far++ }
    ok('ch.32: lampPoint\'s points lie on the capsule\'s outline, none on the far side', off < 1e-12 && far === 0, `${off} ${far}`)
    // the film: what each stretch of the strip sees, and the path drawn reaching the cap with three shadow rays and one blocked
    ok('ch.32: the strip sees the ceiling, the right wall (or the mirror) and the box', JSON.stringify(Y.seenSpans(Y.roomOf(false)).map(q => q.name)) === '["ceiling","right wall","box"]' && Y.seenSpans(Y.roomOf(true))[1].name === 'mirror' && Y.WHITE === 0.4)
    {
        const R = F.rng(Fm.steps.path.pathSeed * 104729 + Y.PATH_PX * 31 + 7), rec = [], info = {}, [x, y, dx, dy] = P1.camera(Y.CAM, Y.PATH_PX, R())
        F.tracePath({ shapes: Y.roomOf(false) }, x, y, dx, dy, { nee: true, maxBounce: 4, rand: R, record: rec, info })
        ok('ch.32: the path drawn: five legs to the cap, three shadow rays reaching the lamp and one blocked', info.end === 'cap' && rec.filter(r => r.kind === 'eye' || r.kind === 'bounce').length === 5
            && rec.filter(r => r.kind === 'shadow').length === 3 && rec.filter(r => r.kind === 'blocked').length === 1 && Y.PATH_PX === 14)
    }
    // the room at four bounces, fixed: aiming 0.1151 +- 0.0005, without 0.1163 +- 0.0010 (the page's section 6)
    {
        const run = nee => { const R = F.rng(77), sh = { shapes: Y.roomOf(false) }; let a = 0, b = 0, n = 0; for (let k = 0; k < 800; k++) for (let i = 0; i < 56; i++) { const [x, y, dx, dy] = F.cameraRay(Y.CAM, i, R()); const v = F.tracePath(sh, x, y, dx, dy, { nee, maxBounce: 4, rand: R }); a += v; b += v * v; n++ } const m = a / n; return [m, Math.sqrt((b / n - m * m) / n)] }
        const [m1, s1] = run(true), [m0, s0] = run(false)
        ok('ch.32: the room fixed, four bounces: aiming 0.1151 ± 0.0005, without 0.1163 ± 0.0010', m1.toFixed(4) === '0.1151' && s1.toFixed(4) === '0.0005' && m0.toFixed(4) === '0.1163' && s0.toFixed(4) === '0.0010', `${m1} ${s1} ${m0} ${s0}`)
    }
    // the mistake section's numbers are flatland.js's notes, which the lamp block above measures again
    const fl = readFileSync(join(REPO, 'tutorial/kit/flatland.js'), 'utf8')
    ok('ch.32: the mistakes\' numbers are flatland.js\'s own notes', fl.includes('0.1326 +- 0.0014 against the aimed rays\' 0.1213 +-') && fl.includes('0.0870 aiming against 0.0556 without'))
}

/* CHAPTER 33: OPEN PROBLEMS ---------------------------------------------------------------------------------------- */
{
    const O = await import('../kit/open.js'), OF = await import('../ch/open.js')
    const td = readFileSync(join(REPO, 'docs/TESTING.md'), 'utf8'), rows = new Map()
    for (const l of td.split('\n')) { const m = /^\| `([\w-]+)` \|/.exec(l); if (m) { const c = l.split('|'); rows.set(m[1], c[c.length - 2].trim()) } }
    // every item's words are in its file today; a bench row's status starts as the board says
    const bad = O.ITEMS.filter(it => !readFileSync(join(REPO, it.src), 'utf8').includes(it.quote) || (it.status && !(rows.get(it.id) ?? '').startsWith(it.status)))
    ok('ch.33: every open item\'s words are in its file today, every bench row\'s status as the board has it', bad.length === 0, bad.map(it => it.id).join(' '))
    // no open row left off the board: a row whose status starts "open" in TESTING.md is an item, unless the same cell
    // says it was answered (haze's does: the board has that as a finding)
    const openRows = [...rows].filter(([, st]) => /^open\b/.test(st) && !/\*\*answered/i.test(st)).map(([id]) => id), onBoard = new Set(O.ITEMS.map(it => it.id))
    ok('ch.33: every row TESTING.md calls open is on the board', openRows.every(id => onBoard.has(id)), openRows.filter(id => !onBoard.has(id)).join(' '))
    // every item names a written or planned chapter, every kind is known
    const { chapter: chOf } = await import('../kit/chapters.js')
    ok('ch.33: every item names a chapter and a known kind', O.ITEMS.every(it => chOf(it.ch) && O.KINDS.some(([k]) => k === it.kind)), O.ITEMS.filter(it => !chOf(it.ch)).map(it => it.id).join(' '))
    // the board lays every item out, inside the figure, in every view
    const W = 640, H = W / OF.figures.board.aspect
    for (const [k] of [['all'], ...O.KINDS]) {
        const L = OF.layout(k, W, H), want = O.itemsOf(k).length
        ok(`ch.33: the board's ${k} view places its ${want} cards inside the figure`, L.cards.length === want && L.cards.every(c => c.x >= 0 && c.y >= 0 && c.x + c.w <= W + 0.5 && c.y + c.h <= H + 0.5 && c.h > 8), `${L.cards.length} ${want}`)
    }
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
    const dp = ['function plan(n, { first = null } = {}) {', '  return n', '}', 'fn after(a: f32) -> f32 { return a; }'].join('\n'), d = locate(dp, { sym: 'function plan' })
    ok('excerpt: a function whose parameters hold braces reaches its body\'s end, not the parameters\'', d.first === 1 && d.last === 3, `${d.first}-${d.last}`)
    const ep = ['export async function plan({ first = null } = {}) {', '  return first', '}', 'const after = 1'].join('\n'), de = locate(ep, { sym: 'export async function plan' })
    ok('excerpt: ...exported and async too', de.first === 1 && de.last === 3, `${de.first}-${de.last}`)
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
