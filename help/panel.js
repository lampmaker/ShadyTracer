//======================================================================================================================
// THE HELP PANEL (the user, 2026-10-10: "an extensive help / tutorial system"; roadmap/UI_PLAN.md "help comes with the
// entry": an F1 panel, a tour that points at real parts of the program, reference pages made from the registries).
//
// A contents list on the left -- the tracks, their pages, and the open page's own headings -- and the page on the right,
// with back, forward, home and a search over every page. A page is markdown (markdown.js); its links act (links.js):
// another page, an example opened, a command run, a panel opened and pointed at. A ```widget block becomes a live
// picture (widgets.js).
//
// The panel knows nothing of the page it is in: what a link does to the program is the host's, through `hooks`
// (app.html) -- so the panel runs in a check page with stand-ins (test/panel.check.mjs).
//======================================================================================================================

import { renderMarkdown } from './markdown.js'
import { kindOf } from './links.js'
import { HELP, PAGES, page as pageOf, HOME, urlOfPage } from './index.js'
import { WIDGETS } from './widgets.js'

const LAST_KEY = 'raytracer.help.page'

/**
 * @param host   the panel's element
 * @param hooks  { fetchText(url) -> Promise<text>, openExample(file), runCommand(id) -> bool, show(target) -> bool,
 *                 say(text) } -- each optional; a link whose hook is missing says so in the status
 * @returns { open(key, anchor?), back(), forward(), search(query), get current, element }
 */
export function installHelp(host, hooks = {}) {
    const doc = host.ownerDocument
    const fetchText = hooks.fetchText ?? (async url => { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status}`); return r.text() })
    const say = hooks.say ?? (() => { })
    const make = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }

    host.classList.add('help')
    const bar = make('div', 'help-bar')
    const btn = (label, title, run) => { const b = make('button', 'help-btn', label); b.title = title; b.onclick = run; return b }
    const backB = btn('◀', 'Back', () => back()), fwdB = btn('▶', 'Forward', () => forward()), homeB = btn('⌂', 'The first page', () => open(HOME))
    const find = make('input', 'help-search')
    Object.assign(find, { type: 'search', placeholder: 'Search the help…' })
    find.oninput = () => search(find.value)
    bar.append(backB, fwdB, homeB, find)
    const side = make('nav', 'help-side'), article = make('article', 'help-page')
    const body = make('div', 'help-body')
    body.append(side, article)
    host.append(bar, body)

    const texts = new Map()          // file -> markdown, as fetched
    const read = async file => {
        if (!texts.has(file)) texts.set(file, await fetchText(urlOfPage(file)))
        return texts.get(file)
    }
    let current = null, history = [], at = -1, widgets = []

    function contents() {
        side.replaceChildren()
        for (const t of HELP) {
            if (!t.pages.length) continue
            side.append(make('div', 'help-track', t.track))
            for (const p of t.pages) {
                const a = make('a', `help-entry${current?.id === p.id ? ' on' : ''}`, p.title)
                a.href = '#'; a.dataset.page = p.id
                a.onclick = e => { e.preventDefault(); open(p.id) }
                side.append(a)
                if (current?.id === p.id && current.headings.length > 1) {
                    const sub = make('div', 'help-sub')
                    for (const h of current.headings.slice(1).filter(h => h.level <= 3)) {
                        const s = make('a', `help-subentry l${h.level}`, h.text.replace(/[*`]/g, ''))
                        s.href = '#'; s.onclick = e => { e.preventDefault(); scrollTo(h.id) }
                        sub.append(s)
                    }
                    side.append(sub)
                }
            }
        }
    }
    const scrollTo = id => { const e = article.querySelector(`[id="${CSS.escape?.(id) ?? id}"]`); e?.scrollIntoView({ block: 'start' }) }

    /** Show page `key` (an id or a file), scrolled to `anchor`. Kept in the history unless going back or forward. */
    async function show(key, anchor = null, { push = true } = {}) {
        const p = pageOf(key)
        if (!p) { say(`help: no page '${key}'`); return false }
        let text
        try { text = await read(p.file) } catch (e) { article.replaceChildren(make('p', 'help-error', `The page ${p.file} could not be read (${e.message}).`)); return false }
        for (const w of widgets) { try { w.dispose?.() } catch { } }
        const r = renderMarkdown(text)
        article.innerHTML = r.html
        current = { ...p, headings: r.headings }
        widgets = []
        for (const el of article.querySelectorAll('.help-widget')) {
            const w = r.widgets[+el.dataset.widget], build = WIDGETS[w?.name]
            if (build) { try { widgets.push(build(el, w.settings)) } catch (e) { el.textContent = `(widget ${w.name}: ${e.message})` } }
            else el.textContent = `(no widget '${w?.name}')`
        }
        for (const a of article.querySelectorAll('a[href]')) a.onclick = e => { e.preventDefault(); follow(a.getAttribute('href')) }
        if (push) { history = history.slice(0, at + 1); history.push([p.id, anchor]); at = history.length - 1 }
        backB.disabled = at <= 0; fwdB.disabled = at >= history.length - 1
        try { localStorage.setItem(LAST_KEY, p.id) } catch { /* kept for this page only */ }
        contents()
        if (anchor) scrollTo(anchor); else article.scrollTop = 0
        return true
    }
    const open = (key, anchor) => show(key, anchor)
    const back = () => { if (at > 0) { at--; return show(...history[at], { push: false }) } }
    const forward = () => { if (at < history.length - 1) { at++; return show(...history[at], { push: false }) } }

    /** WHAT A LINK DOES (links.js). A hook the host did not give is said, never silently nothing. */
    function follow(href) {
        const k = kindOf(href, current?.file ?? '')
        const need = (f, what) => f ? true : (say(`help: ${what} is not available here`), false)
        switch (k.kind) {
            case 'page': return open(k.target, k.anchor)
            case 'anchor': return scrollTo(k.target)
            case 'example': return need(hooks.openExample, 'opening an example') && hooks.openExample(k.target)
            case 'cmd': return need(hooks.runCommand, 'running a command') && (hooks.runCommand(k.target) || say(`help: no command '${k.target}'`))
            case 'show': return need(hooks.show, 'showing a part of the window') && (hooks.show(k.target) || say(`help: nothing called '${k.target}' to show`))
            case 'web': return window.open(k.target, '_blank', 'noopener')
            default: return say(`help: a link it cannot follow (${href})`)
        }
    }

    /** SEARCH: every page's text, fetched once; the pages that hold every word, with the line that holds the first. */
    let searching = 0
    async function search(q) {
        const words = String(q).toLowerCase().split(/\s+/).filter(Boolean)
        if (!words.length) { if (current) show(current.id, null, { push: false }); return [] }
        const ticket = ++searching
        const found = []
        for (const p of PAGES) {
            let t
            try { t = await read(p.file) } catch { continue }
            const low = t.toLowerCase()
            if (words.every(w => low.includes(w) || p.title.toLowerCase().includes(w))) {
                const line = t.split('\n').find(l => l.toLowerCase().includes(words[0]) && !/^#|^```/.test(l)) ?? ''
                found.push({ id: p.id, title: p.title, track: p.track, line: line.replace(/[#*`>|[\]]/g, '').trim().slice(0, 160) })
            }
        }
        if (ticket !== searching) return found
        article.replaceChildren(make('h1', null, `Search: ${q}`))
        if (!found.length) article.append(make('p', null, 'Nothing found.'))
        for (const f of found) {
            const d = make('div', 'help-hit')
            const a = make('a', null, f.title); a.href = '#'; a.onclick = e => { e.preventDefault(); find.value = ''; open(f.id) }
            d.append(a, make('span', 'help-hit-track', ` · ${f.track}`), make('p', null, f.line))
            article.append(d)
        }
        return found
    }

    let last = null
    try { last = localStorage.getItem(LAST_KEY) } catch { /* none */ }
    contents()
    open(pageOf(last) ? last : HOME)
    return { open, back, forward, search, follow, get current() { return current }, element: host }
}
