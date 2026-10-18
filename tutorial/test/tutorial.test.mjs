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
import { locate, optionsOf, hash } from '../kit/excerpt.js'
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
const tags = html => [...html.matchAll(/<([a-zA-Z][\w-]*)\b([^>]*)>/g)].map(m => ({ tag: m[1].toLowerCase(), attrs: attrsOf(m[2]), raw: m[2] }))

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

/* THE STYLES: every one in kit/styles.js has its file, imported by kit.css, setting every token kit.css defaults, the
   colours for light and for dark both (a style missing a dark colour would show the default's in the reader's) ---- */
{
    const { STYLES } = await import('../kit/styles.js')
    const kit = readFileSync(join(TUT, 'kit/kit.css'), 'utf8')
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
        ok(`style "${st.id}": its dark blocks are its own`, css.includes(`:root[data-theme="dark"][data-style="${st.id}"]`) && css.includes(`:root:not([data-theme="light"])[data-style="${st.id}"]`))
    }
}

/* THE GLOSSARY ---------------------------------------------------------------------------------------------------- */
ok('glossary ids are unique', new Set(GLOSSARY.map(g => g.id)).size === GLOSSARY.length)
for (const g of GLOSSARY) {
    ok(`glossary "${g.id}": its chapter exists`, !!chapter(g.ch), g.ch)
    ok(`glossary "${g.id}": its see-also entries exist`, g.see.every(s => term(s)), g.see.join(' '))
    ok(`glossary "${g.id}": a term and a definition`, g.term && g.short && g.short.length > 20)
}

/* THE PAGES ------------------------------------------------------------------------------------------------------- */
const KNOWN = new Set(['data-g', 'data-ch', 'data-fig', 'data-step', 'data-src', 'data-sym', 'data-nth', 'data-in', 'data-to', 'data-max', 'data-doc',
    'data-why', 'data-hash', 'data-claim', 'data-auto', 'data-words', 'data-chapter', 'data-open-style', 'data-style'])
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
    for (const t of T) {
        for (const k of Object.keys(t.attrs)) if (k.startsWith('data-')) ok(`${name}: data-* attributes are the kit's`, KNOWN.has(k), `<${t.tag} ${k}>`)
        const a = t.attrs
        if (a['data-g'] != null) ok(`${name}: glossary term "${a['data-g']}" exists`, !!term(a['data-g']))
        if (a['data-words'] != null) for (const w of a['data-words'].trim().split(/\s+/)) ok(`${name}: word "${w}" is in the glossary`, !!term(w))
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
    // a file:line typed by hand goes stale: every one is a <cite data-src data-sym>
    const typed = [...html.replace(/<(pre|cite)\b[^>]*>/g, '').matchAll(/\b[\w./-]+\.(?:js|mjs|md|css|html):\d+/g)].map(m => m[0])
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
