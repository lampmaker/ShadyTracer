//======================================================================================================================
// EVERY TUTORIAL PAGE'S START: boot({ figures }) from the page's own module. It reads the page's markup and fills in
// what the markup only names:
//
//   data-g="id"                 a glossary term: linked to its entry, its card shown on hover, focus or first tap
//   data-ch="id#anchor"         a chapter: linked to its page (or, while it is planned, to its place on the map)
//   <pre data-src data-sym>     an excerpt of the real file, fetched now and found by excerpt.js
//   <cite data-src data-sym>    a file:line reference, the line found the same way, linked to GitHub
//   <figure data-fig="name">    a live figure: figures[name] mounted by figure.js
//   data-step="name:step"       a paragraph that moves figure `name` to `step` as it scrolls past (or when clicked)
//   .titleblock[data-auto]      the sheet's title block, from chapters.js and the app's version
//   ul.words[data-words]        the chapter's glossary terms as chips
//   nav.tabs[data-auto]         previous and next written chapters
//
// And the bar: contents, the style by name (kit/styles.js) and light / dark, both remembered. A style is kept in
// localStorage (the preview of a claude.ai artifact drops a URL's query, so ?style= cannot be relied on), and ?style=
// still wins where it arrives. Storage can be refused (a private window): every read and write is guarded and
// the page works without it.
//======================================================================================================================

import { CHAPTERS, PARTS, TITLE, chapter, neighbours, partOf } from './chapters.js'
import { term } from './glossary.js'
import { locate, optionsOf, languageOf } from './excerpt.js'
import { mountFigure } from './figure.js'
import { VERSION, loadRevision, revision } from '../../version.js'
import { STYLES, DEFAULT_STYLE, styleOf } from './styles.js'

export const TUT = new URL('../', import.meta.url)          // tutorial/
export const REPO = new URL('../../', import.meta.url)      // the repository's root: excerpts' paths start here
export const GITHUB = 'https://github.com/lampmaker/ShadyTracer'

export { STYLES } from './styles.js'
const KEY_STYLE = 'shadytracer.tutorial.style', KEY_THEME = 'shadytracer.tutorial.theme'
const store = {
    get: k => { try { return localStorage.getItem(k) } catch { return null } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch { /* refused: fine */ } },
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']

/* STYLE AND THEME ---------------------------------------------------------------------------------------------------- */
function loadFonts(doc, ids) {
    for (const id of ids) {
        const st = styleOf(id)
        if (!st?.fonts) continue
        const href = `https://fonts.googleapis.com/css2?${st.fonts}&display=swap`
        if (doc.head.querySelector(`link[href="${href}"]`)) continue
        const l = doc.createElement('link'); l.rel = 'stylesheet'; l.href = href; doc.head.appendChild(l)
    }
}
export function currentStyle(doc = document) {
    const q = new URL(doc.defaultView.location.href).searchParams.get('style')
    if (q && styleOf(q)) { store.set(KEY_STYLE, q); return q }
    const s = store.get(KEY_STYLE)
    return styleOf(s) ? s : DEFAULT_STYLE
}
export function setStyle(doc, name) {
    doc.documentElement.dataset.style = name
    store.set(KEY_STYLE, name)
    loadFonts(doc, [name])
    doc.dispatchEvent(new CustomEvent('kit:theme'))
}
const isDark = doc => doc.documentElement.dataset.theme ? doc.documentElement.dataset.theme === 'dark' : !!doc.defaultView.matchMedia?.('(prefers-color-scheme: dark)').matches
export function setTheme(doc, t) {
    if (t) doc.documentElement.dataset.theme = t; else delete doc.documentElement.dataset.theme
    store.set(KEY_THEME, t)
    doc.dispatchEvent(new CustomEvent('kit:theme'))
}

function bar(doc, { styles = true } = {}) {
    const el = doc.createElement('div'); el.className = 'kit-bar'
    const home = doc.createElement('a'); home.className = 'kbtn'; home.href = new URL('index.html', TUT).href; home.textContent = 'Contents'
    el.appendChild(home)
    if (styles) {
        /* THE STYLE, BY NAME: a menu, since there will be more of them (kit/styles.js), and a link to them side by side */
        const lab = doc.createElement('label'); lab.className = 'stylepick'
        const sel = doc.createElement('select'); sel.id = 'kit-style'
        for (const st of STYLES) { const o = doc.createElement('option'); o.value = st.id; o.textContent = st.name; o.title = st.line; sel.appendChild(o) }
        sel.value = doc.documentElement.dataset.style
        sel.addEventListener('change', () => setStyle(doc, sel.value))
        const all = doc.createElement('a'); all.className = 'stylesall'; all.href = new URL('styles.html', TUT).href; all.textContent = 'Style'
        all.title = 'All the styles, side by side'
        lab.append(all, sel)
        el.appendChild(lab)
    }
    const th = doc.createElement('button'); th.type = 'button'; th.className = 'kbtn'
    const label = () => { const d = isDark(doc); th.textContent = d ? 'Light' : 'Dark'; th.setAttribute('aria-label', d ? 'Switch to light' : 'Switch to dark') }
    th.addEventListener('click', () => { setTheme(doc, isDark(doc) ? 'light' : 'dark'); label() })
    doc.defaultView.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', label)
    label()
    el.appendChild(th)
    doc.body.appendChild(el)
}

/* LINKS: glossary terms and chapters ------------------------------------------------------------------------------- */
export const chapterHref = (id, anchor) => {
    const c = chapter(id)
    if (!c) return null
    return c.file ? new URL(c.file + (anchor ? '#' + anchor : ''), TUT).href : new URL(`index.html#ch-${id}`, TUT).href
}

function glossaryLinks(doc) {
    const card = doc.createElement('div'); card.className = 'gcard'; card.hidden = true; card.setAttribute('role', 'tooltip'); card.id = 'kit-gcard'
    doc.body.appendChild(card)
    let open = null, timer = 0
    const show = a => {
        const g = term(a.dataset.g)
        if (!g) return
        clearTimeout(timer)
        const c = chapter(g.ch)
        card.innerHTML = `<b>${esc(g.term)}</b><p>${esc(g.short)}</p>` +
            `<a href="${new URL('glossary.html#' + g.id, TUT).href}">Glossary</a>` +
            (c && c.id !== doc.body.dataset.chapter ? ` · <a href="${chapterHref(c.id)}">${c.file ? 'Explained in' : 'Planned:'} “${esc(c.title)}”</a>` : '')
        card.hidden = false
        const r = a.getBoundingClientRect(), win = doc.defaultView
        const w = card.offsetWidth, x = Math.max(16, Math.min(win.innerWidth - w - 16, r.left))
        const below = r.bottom + card.offsetHeight + 12 < win.innerHeight
        card.style.left = (x + win.scrollX) + 'px'
        card.style.top = (below ? r.bottom + 8 + win.scrollY : r.top - card.offsetHeight - 8 + win.scrollY) + 'px'
        open = a
        a.setAttribute('aria-describedby', card.id)
    }
    const hide = () => { timer = setTimeout(() => { card.hidden = true; open?.removeAttribute('aria-describedby'); open = null }, 160) }
    card.addEventListener('mouseenter', () => clearTimeout(timer)); card.addEventListener('mouseleave', hide)
    doc.addEventListener('keydown', e => { if (e.key === 'Escape') { card.hidden = true; open = null } })
    for (const a of doc.querySelectorAll('[data-g]')) {
        const g = term(a.dataset.g)
        if (!g) { a.classList.add('broken'); a.title = `no glossary entry "${a.dataset.g}"`; continue }
        if (a.tagName === 'A') a.href = new URL('glossary.html#' + g.id, TUT).href
        a.addEventListener('mouseenter', () => show(a)); a.addEventListener('mouseleave', hide)
        a.addEventListener('focus', () => show(a)); a.addEventListener('blur', hide)
        // a first tap shows the card instead of leaving the page; a second follows the link
        a.addEventListener('click', e => { if (open !== a || card.hidden) { e.preventDefault(); show(a) } })
    }
    for (const a of doc.querySelectorAll('[data-ch]')) {
        const [id, anchor] = a.dataset.ch.split('#')
        const href = chapterHref(id, anchor)
        if (!href) { a.classList.add('broken'); continue }
        a.href = href
        if (!chapter(id).file) { a.classList.add('planned'); a.title = `“${chapter(id).title}” is planned, not written yet` }
    }
}

/* EXCERPTS ------------------------------------------------------------------------------------------------------------ */
const texts = new Map()
const fetchText = src => {
    if (!texts.has(src)) texts.set(src, fetch(new URL(src, REPO), { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(`${src}: ${r.status}`); return r.text() }))
    return texts.get(src)
}
const ghLink = (src, first, last) => {
    const rev = revision()
    return rev ? `${GITHUB}/blob/${rev.full}/${src}#L${first}${last && last !== first ? '-L' + last : ''}` : `${GITHUB}/blob/main/${src}`
}
const TOK = /(\$\{[^}]*\}?)|\b(fn|let|var|const|if|else|for|while|loop|return|break|continue|struct|switch|case|default|function|export|import|from|async|await|new|class|true|false|select)\b|\b(\d+\.?\d*(?:e-?\d+)?[uf]?)\b/g
/* a piece of code (no comment in it) as HTML: one pass over the raw text, so no marking can land inside another's tag */
const codeHTML = s => {
    let out = '', last = 0
    for (const m of s.matchAll(TOK)) {
        out += esc(s.slice(last, m.index))
        out += m[1] ? `<span class="tpl">${esc(m[1])}</span>` : m[2] ? `<span class="k">${m[2]}</span>` : `<span class="num">${m[3]}</span>`
        last = m.index + m[0].length
    }
    return out + esc(s.slice(last))
}
/** The lines as HTML: comments (carried across lines), numbers, keywords, and `${...}` -- the parts a kernel's
 *  JavaScript fills in when it builds the WGSL text -- marked. */
export function highlight(lines) {
    let inBlock = false
    return lines.map(line => {
        let out = '', i = 0
        const code = codeHTML
        while (i < line.length) {
            if (inBlock) {
                const e = line.indexOf('*/', i)
                if (e < 0) { out += `<span class="c">${esc(line.slice(i))}</span>`; i = line.length } else { out += `<span class="c">${esc(line.slice(i, e + 2))}</span>`; i = e + 2; inBlock = false }
                continue
            }
            const lc = line.indexOf('//', i), bc = line.indexOf('/*', i)
            const nextC = [lc, bc].filter(x => x >= 0).sort((a, b) => a - b)[0]
            if (nextC == null) { out += code(line.slice(i)); break }
            out += code(line.slice(i, nextC))
            if (nextC === lc) { out += `<span class="c">${esc(line.slice(lc))}</span>`; break }
            inBlock = true; i = bc
        }
        return out
    })
}

async function excerpts(doc) {
    const pres = [...doc.querySelectorAll('pre[data-src]')], cites = [...doc.querySelectorAll('cite[data-src]')]
    await Promise.all([...pres, ...cites].map(async el => {
        const src = el.dataset.src, opts = optionsOf(k => el.getAttribute(k))
        let hit = null, err = null
        try { hit = locate(await fetchText(src), opts) } catch (e) { err = e }
        if (el.tagName === 'CITE') {
            const base = src.split('/').pop()
            const a = doc.createElement('a')
            a.textContent = el.textContent.trim() || (hit ? `${base}:${hit.first}` : base)
            a.href = hit ? ghLink(src, hit.first, hit.last) : ghLink(src)
            a.title = err ? `not found: ${err.message}` : `${src}, lines ${hit.first}–${hit.last}`
            el.replaceChildren(a)
            el.dataset.first = hit?.first ?? ''
            return
        }
        const fig = doc.createElement('figure'); fig.className = 'excerpt'
        const why = el.dataset.why ? `<span class="why">${esc(el.dataset.why)}</span>` : ''
        if (err) {
            fig.classList.add('failed')
            fig.innerHTML = `<figcaption><span>${esc(src)}</span>${why}</figcaption><pre>This excerpt could not be shown: ${esc(err.message)}.\nOpen it on GitHub: ${esc(ghLink(src))}</pre>`
        } else {
            const drift = el.dataset.hash && el.dataset.hash !== hit.hash
                ? ` <span class="drift" title="checked at ${esc(el.dataset.hash)}, now ${hit.hash}">· changed since this page was checked</span>` : ''
            const lines = hit.lines
            const html = highlight(lines)
            const lang = languageOf(src, lines)
            fig.innerHTML = `<figcaption><a class="src" href="${ghLink(src, hit.first, hit.last)}">${esc(src)} · lines ${hit.first}–${hit.last}</a>` +
                `<span class="lang">${lang}${lines.some(l => l.includes('${')) ? ' · highlighted parts are filled in when the kernel is built' : ''}</span>${drift}${why}</figcaption>` +
                `<div class="scroll"><pre><code>${html.map((h, k) => `<span class="ln">${hit.first + k}</span><span class="lc">${h || ' '}</span>`).join('')}</code></pre></div>`
            fig.dataset.src = src; fig.dataset.first = hit.first; fig.dataset.last = hit.last
        }
        el.replaceWith(fig)
    }))
}
function relinkExcerpts(doc) {
    for (const f of doc.querySelectorAll('figure.excerpt[data-src]')) { const a = f.querySelector('a.src'); if (a) a.href = ghLink(f.dataset.src, +f.dataset.first, +f.dataset.last) }
    for (const c of doc.querySelectorAll('cite[data-src] a')) { const el = c.parentElement; if (el.dataset.first) c.href = ghLink(el.dataset.src, +el.dataset.first) }
}

/* THE SHEET: title block, words, prev / next ---------------------------------------------------------------------- */
function titleBlock(doc, id) {
    const c = chapter(id), el = doc.querySelector('.titleblock[data-auto]')
    if (!el) return
    const p = c ? partOf(c) : null, pi = p ? PARTS.indexOf(p) : -1
    const rev = revision()
    const rows = [['Drawing', TITLE], ...(c ? [['Part', `${ROMAN[pi] || ''}${pi > 0 ? ' · ' : ''}${p.title}`], ['Chapter', `${c.number} of ${CHAPTERS.length - 1}`], ['Status', c.status]] : []),
        ['Rev.', `${VERSION}${rev ? ' · ' + rev.hash : ''}`]]
    el.innerHTML = rows.map(([k, v]) => `<div>${esc(k)}</div><div><b>${esc(v)}</b></div>`).join('')
}
function words(doc) {
    for (const ul of doc.querySelectorAll('ul.words[data-words]')) {
        ul.innerHTML = ul.dataset.words.trim().split(/\s+/).map(id => { const g = term(id); return g ? `<li><a data-g="${id}">${esc(g.term)}</a></li>` : `<li class="broken">${esc(id)}?</li>` }).join('')
    }
}
function tabs(doc, id) {
    const el = doc.querySelector('nav.tabs[data-auto]')
    if (!el) return
    const { prev, next } = neighbours(id)
    const a = (c, cls, word) => c ? `<a class="${cls}" href="${new URL(c.file, TUT).href}"><small>${word} · chapter ${c.number}</small><span>${esc(c.title)}</span></a>` : ''
    el.innerHTML = a(prev, 'prev', 'Previous') + a(next, 'next', 'Next') ||
        `<a class="next" href="${new URL('index.html', TUT).href}"><small>Back to</small><span>the contents</span></a>`
}

/* FIGURES AND STEPS ---------------------------------------------------------------------------------------------------- */
/* A figure's name can appear in several sections (the same room, followed through a chapter): each is its own figure,
   and a step moves the one in the paragraph's own section -- or, if its section has none, the nearest before it. */
function figuresOf(doc, specs) {
    const mounted = new Map()
    for (const el of doc.querySelectorAll('figure[data-fig]')) {
        const name = el.dataset.fig, spec = specs[name]
        if (!spec) { el.insertAdjacentHTML('afterbegin', `<p class="fig-noscript">No figure called “${esc(name)}” in this page's module.</p>`); continue }
        try { mounted.set(el, mountFigure(el, spec, { name })) }
        catch (e) { console.error(e); el.insertAdjacentHTML('afterbegin', `<p class="fig-noscript">This figure failed to start: ${esc(e.message)}</p>`) }
    }
    const figureFor = (stepEl, name) => {
        const own = stepEl.closest('section')?.querySelector(`figure[data-fig="${name}"]`)
        if (own) return own
        const all = [...doc.querySelectorAll(`figure[data-fig="${name}"]`)]
        return all.filter(f => f.compareDocumentPosition(stepEl) & doc.defaultView.Node.DOCUMENT_POSITION_FOLLOWING).pop() ?? all[0]
    }
    const steps = [...doc.querySelectorAll('[data-step]')]
    const apply = el => {
        const [f, s] = el.dataset.step.split(':'), fig = figureFor(el, f)
        if (!mounted.get(fig)?.step(s)) return
        for (const o of steps) if (figureFor(o, o.dataset.step.split(':')[0]) === fig) o.classList.toggle('on', o === el)
    }
    const io = new doc.defaultView.IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) apply(e.target) }, { rootMargin: '-38% 0px -52% 0px' })
    for (const el of steps) {
        io.observe(el)
        el.tabIndex = 0
        el.addEventListener('click', e => { if (!e.target.closest('a, button, input')) apply(el) })
        el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === el) apply(el) })
    }
    return mounted
}

/**
 * Start the page. `figures` are the page module's specs by name; `styles: false` leaves the style menu out; `allFonts`
 * loads every style's faces (the styles page shows them all).
 */
export function boot({ figures = {}, styles = true, allFonts = false } = {}) {
    const doc = document
    doc.documentElement.classList.add('kit-js')
    const t = store.get(KEY_THEME)
    if (t === 'light' || t === 'dark') doc.documentElement.dataset.theme = t
    setStyle(doc, currentStyle(doc))
    if (allFonts) loadFonts(doc, STYLES.map(st => st.id))
    const id = doc.body.dataset.chapter
    bar(doc, { styles })
    titleBlock(doc, id)
    words(doc)
    tabs(doc, id)
    glossaryLinks(doc)
    const mounted = figuresOf(doc, figures)
    const done = excerpts(doc)
    loadRevision().then(() => { titleBlock(doc, id); done.then(() => relinkExcerpts(doc)) })
    return { mounted, excerpts: done }
}
