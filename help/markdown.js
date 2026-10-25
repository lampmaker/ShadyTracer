//======================================================================================================================
// MARKDOWN, AS THE HELP PAGES ARE WRITTEN -- a small renderer of our own (help/README.md says why there is no library):
// headings, paragraphs, **bold**, *italic*, `code`, fenced code, lists (- and 1.), tables, links, images, > notes, and
// a WIDGET: a fenced block whose language is `widget`, its first word the widget's name (help/widgets.js) and the rest
// its settings -- `name: value` a line. A page reads the same on GitHub, where a widget is a code block.
//
// A DEFINITION: a list item that is `code` -- words, as the code reference (reference/code.md) writes a function. It is
// a card, the code on a line of its own -- a signature, name(arg: type, ...) -> type, coloured by its parts -- the words
// under it, and a closing "Used by ..." sentence set apart (the user, 2026-10-25: "a solid block of information, hard
// to browse for human eyes"). A list of nothing else is marked as such, for its spacing. On GitHub it stays a list.
//
// ESCAPED, THEN MARKED UP: every character of the source is escaped before any tag is made, so a page cannot put HTML
// into the panel -- what is not markdown shows as text. A link's address is kept only if it is one of the kinds the
// panel follows (links.js kindOf): http(s), another page, an example, a command, a part of the window to show, an
// anchor. Anything else (javascript:, data:) becomes plain text.
//
// PURE: a string in, a string out (test/markdown.test.mjs). Headings carry an id from their text, for anchors and the
// page's own contents.
//======================================================================================================================

/** The characters HTML gives meaning to, escaped. */
export const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** A heading's anchor: lower case, letters, digits and dashes -- as GitHub makes them, near enough for our pages. */
export const slug = s => String(s).toLowerCase().replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-')

/** Whether an address is one the panel follows: anything else is shown as text, never as a link. */
export const safeHref = h => /^(https?:|help:|example:|cmd:|show:|#)/i.test(h) || /^[\w./-]+\.md(#[\w-]*)?$/.test(h)
const safeSrc = s => /^(https?:)/i.test(s) || /^[\w./-]+\.(png|jpe?g|gif|svg|webp)$/i.test(s)

/** Inline markup over text that is ALREADY ESCAPED. Code spans first, so nothing inside one is read as markup. */
function inline(t) {
    const codes = []
    t = t.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`)
    // images, then links: [text](href) -- the href escaped too, so &quot; cannot end the attribute
    t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, src) => {
        const raw = src.replace(/&amp;/g, '&')
        return safeSrc(raw) ? `<img src="${src}" alt="${alt}" loading="lazy">` : m
    })
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, href) => {
        const raw = href.replace(/&amp;/g, '&')
        return safeHref(raw) ? `<a href="${href}">${text}</a>` : text
    })
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    t = t.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![*\w])/g, '$1<em>$2</em>')
    return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`)
}

/** A SIGNATURE, ALREADY ESCAPED, coloured by its parts: its name, each argument's name and type, what it returns.
 *  Anything not of that shape is the code it was. Escaped text has no < or >, so nothing here can make a tag but these. */
function signature(c) {
    const m = /^(\w+)\((.*)\)(?:\s*-&gt;\s*(.+))?$/.exec(c)
    if (!m) return c
    const type = t => `<span class="help-type">${t}</span>`
    const args = m[2].split(', ').filter(Boolean).map(a => {
        const k = /^(\w+):\s*(.+)$/.exec(a)
        return k ? `<span class="help-arg">${k[1]}</span>: ${type(k[2])}` : a
    })
    return `<span class="help-fname">${m[1]}</span>(${args.join(', ')})${m[3] ? ` -&gt; ${type(m[3])}` : ''}`
}
const DEF = /^`([^`]+)`\s+--\s+(.*)$/
/** A definition's item (DEF): the code, the words, and their "Used by ..." apart. `t` is the source, not yet escaped. */
function definition(t) {
    const [, code, rest] = DEF.exec(t)
    const u = /\s(Used by .*)$/.exec(rest)
    const words = u ? rest.slice(0, u.index) : rest
    return `<li class="help-def"><div class="help-sig"><code>${signature(escapeHtml(code))}</code></div>`
        + `<div class="help-def-text">${inline(escapeHtml(words))}</div>`
        + (u ? `<div class="help-def-used">${inline(escapeHtml(u[1]))}</div>` : '') + '</li>'
}

/** A widget block's settings: `name: value` lines; a number reads as a number. */
export function widgetSettings(lines) {
    const out = {}
    for (const l of lines) {
        const m = /^\s*([\w-]+)\s*:\s*(.*?)\s*$/.exec(l)
        if (m) out[m[1]] = /^-?\d+(\.\d+)?$/.test(m[2]) ? +m[2] : m[2]
    }
    return out
}

/**
 * The page as HTML, and what it holds.
 * @returns { html, title, headings: [{ level, text, id }], widgets: [{ name, settings }] } -- title is the first
 *          heading's text; a widget is a <div class="help-widget" data-widget="i"> for the panel to fill.
 */
export function renderMarkdown(src) {
    const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n')
    const out = [], headings = [], widgets = []
    const ids = new Map()
    let i = 0, para = []
    const flush = () => { if (para.length) { out.push(`<p>${inline(escapeHtml(para.join(' ')))}</p>`); para = [] } }
    const unique = id => { const n = ids.get(id) ?? 0; ids.set(id, n + 1); return n ? `${id}-${n}` : id }
    while (i < lines.length) {
        const line = lines[i]
        // FENCED: code, or a widget
        const fence = /^```\s*([\w-]*)\s*(.*)$/.exec(line)
        if (fence) {
            flush()
            const body = []
            for (i++; i < lines.length && !/^```\s*$/.test(lines[i]); i++) body.push(lines[i])
            i++
            if (fence[1] === 'widget') {
                const name = (fence[2] || body.shift() || '').trim()
                widgets.push({ name, settings: widgetSettings(body) })
                out.push(`<div class="help-widget" data-widget="${widgets.length - 1}" data-name="${escapeHtml(name)}"></div>`)
            } else out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`)
            continue
        }
        // A HEADING
        const h = /^(#{1,4})\s+(.*?)\s*#*\s*$/.exec(line)
        if (h) {
            flush()
            const text = h[2], level = h[1].length, id = unique(slug(text))
            headings.push({ level, text, id })
            out.push(`<h${level} id="${escapeHtml(id)}">${inline(escapeHtml(text))}</h${level}>`)
            i++; continue
        }
        // A RULE
        if (/^(-{3,}|\*{3,})\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue }
        // A NOTE: > lines
        if (/^>\s?/.test(line)) {
            flush()
            const body = []
            for (; i < lines.length && /^>\s?/.test(lines[i]); i++) body.push(lines[i].replace(/^>\s?/, ''))
            out.push(`<blockquote>${renderMarkdown(body.join('\n')).html}</blockquote>`)
            continue
        }
        // A TABLE: a header row, a |---| row, then rows
        if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
            flush()
            const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => inline(escapeHtml(c.trim())))
            const head = cells(line)
            const rows = []
            for (i += 2; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) rows.push(cells(lines[i]))
            out.push(`<table><thead><tr>${head.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>`
                + rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('') + '</tbody></table>')
            continue
        }
        // A LIST: - or * or 1. items; an indented line continues the item
        const li = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line)
        if (li) {
            flush()
            const ordered = /\d/.test(li[2])
            const items = []
            for (; i < lines.length; i++) {
                const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i])
                if (m && /\d/.test(m[2]) === ordered) items.push(m[3])
                else if (items.length && /^\s{2,}\S/.test(lines[i])) items[items.length - 1] += ' ' + lines[i].trim()
                else break
            }
            const tag = ordered ? 'ol' : 'ul', defs = items.every(t => DEF.test(t))
            out.push(`<${tag}${defs ? ' class="help-defs"' : ''}>${items.map(t => DEF.test(t) ? definition(t) : `<li>${inline(escapeHtml(t))}</li>`).join('')}</${tag}>`)
            continue
        }
        if (!line.trim()) { flush(); i++; continue }
        para.push(line.trim())
        i++
    }
    flush()
    return { html: out.join('\n'), title: headings[0]?.text ?? '', headings, widgets }
}
