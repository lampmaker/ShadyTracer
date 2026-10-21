// node tutorial/stamp.mjs
//
// RECORD THAT THE EXCERPTS WERE READ. Every <pre data-src data-sym> in the tutorial's pages gets data-hash="..." set to
// the hash of the lines it shows today (kit/excerpt.js). A page then marks an excerpt whose code has changed since,
// and tutorial/test/tutorial.test.mjs lists it. So run this only after reading each changed excerpt against the text
// around it -- the stamp is the claim "this page's words still fit this code".
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { locate, optionsOf } from './kit/excerpt.js'

const TUT = dirname(fileURLToPath(import.meta.url)), REPO = resolve(TUT, '..')
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? (f === 'test' ? [] : walk(p)) : [p] })
const unq = v => v.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** One page's text with every excerpt's data-hash set; `read(path)` gives a repository file's text. A tag ends at the
 *  first > outside quotes: an attribute may hold one (a data-why writing `(x, y) => ...`), and a pattern that stopped
 *  at any > once wrote the stamp into the middle of that sentence. `should(attrs)` decides whether an excerpt whose
 *  hash moved is stamped: always, here; release.mjs stamps only those the release itself moved, by its version number. */
export function stampPage(html, read, log = () => { }, should = () => true) {
    let changed = 0
    const out = html.replace(/<pre\b((?:[^>"]|"[^"]*")*)>/g, (whole, inner) => {
        if (!/\bdata-src="/.test(inner)) return whole
        const a = {}; for (const m of inner.matchAll(/([\w-]+)="([^"]*)"/g)) a[m[1]] = unq(m[2])
        let h
        try { h = locate(read(a['data-src']), optionsOf(k => a[k])).hash } catch (e) { log(`skipped ${a['data-src']} "${a['data-sym']}": ${e.message}`); return whole }
        if (a['data-hash'] === h || !should(a)) return whole
        changed++
        log(`${a['data-src']} "${a['data-sym']}" ${a['data-hash'] ?? '(none)'} -> ${h}`)
        return a['data-hash'] != null ? whole.replace(/ data-hash="[^"]*"(?=(?:[^"]*"[^"]*")*[^"]*>$)/, ` data-hash="${h}"`) : whole.replace(/>$/, ` data-hash="${h}">`)
    })
    return { html: out, changed }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    let changed = 0
    for (const f of walk(TUT).filter(f => f.endsWith('.html'))) {
        const html = readFileSync(f, 'utf8')
        const r = stampPage(html, p => readFileSync(join(REPO, p), 'utf8'), m => console.log(`${relative(TUT, f)}: ${m}`))
        changed += r.changed
        if (r.html !== html) writeFileSync(f, r.html)
    }
    console.log(`${changed} excerpt${changed === 1 ? '' : 's'} stamped`)
}
