//======================================================================================================================
// WHAT A LINK IN A HELP PAGE DOES -- the panel's (panel.js) and the coverage test's (test/coverage.test.mjs) one reading:
//   other.md, other.md#part   another page, by its file (as on GitHub, where the pages are read too)
//   help:<page id>            another page, by its id (help/index.js)
//   #part                     a heading on this page
//   example:<file>            File › Examples' example of that file (scenes/index.js), added to the project and opened
//   cmd:<command id>          a command run, as its menu entry would (Analysis › Analysis setup is cmd:analysis.setup)
//   show:<panel id>           a panel of the window opened and pointed at (show:properties); show:menu:<name> a menu
//   http(s):                  a page on the web, in a tab of its own
// PURE (no DOM). A page link names a page by file relative to the page it is on.
//======================================================================================================================

/** { kind, target, anchor }: kind one of page, anchor, example, cmd, show, web, or null for an address the panel
 *  does not follow (markdown.js shows those as text). `from` is the file of the page the link is on. */
export function kindOf(href, from = '') {
    const h = String(href ?? '')
    let m
    if ((m = /^help:([\w-]+)(?:#([\w-]+))?$/.exec(h))) return { kind: 'page', target: m[1], anchor: m[2] ?? null, byId: true }
    if ((m = /^#([\w-]+)$/.exec(h))) return { kind: 'anchor', target: m[1] }
    if ((m = /^example:([\w.-]+\.json)$/.exec(h))) return { kind: 'example', target: m[1] }
    if ((m = /^cmd:([\w.-]+)$/.exec(h))) return { kind: 'cmd', target: m[1] }
    if ((m = /^show:((?:menu:)?[\w. -]+)$/.exec(h))) return { kind: 'show', target: m[1] }
    if (/^https?:\/\//i.test(h)) return { kind: 'web', target: h }
    if ((m = /^([\w./-]+\.md)(?:#([\w-]+))?$/.exec(h))) return { kind: 'page', target: resolve(from, m[1]), anchor: m[2] ?? null }
    return { kind: null, target: h }
}

/** A page's file, relative to another page's: `../start/welcome.md` from `optics/units.md` is `start/welcome.md`. */
export function resolve(from, rel) {
    const parts = String(from).split('/').slice(0, -1)
    for (const p of String(rel).split('/')) {
        if (p === '..') parts.pop()
        else if (p !== '.' && p !== '') parts.push(p)
    }
    return parts.join('/')
}

/** Every link in a page's markdown, with the line it is on: [{ href, line, image }]. Code (fenced and `inline`) is
 *  skipped; an image's address is a picture's, which the panel does not follow. */
export function linksIn(src) {
    const out = []
    let fenced = false
    String(src ?? '').split('\n').forEach((l, n) => {
        if (/^```/.test(l)) { fenced = !fenced; return }
        if (fenced) return
        for (const m of l.replace(/`[^`]*`/g, '').matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) out.push({ href: m[1], line: n + 1, image: m[0].startsWith('!') })
    })
    return out
}
