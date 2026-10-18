// node tutorial/stamp.mjs
//
// RECORD THAT THE EXCERPTS WERE READ. Every <pre data-src data-sym> in the tutorial's pages gets data-hash="..." set to
// the hash of the lines it shows today (kit/excerpt.js). A page then marks an excerpt whose code has changed since,
// and tutorial/test/tutorial.test.mjs lists it. So run this only after reading each changed excerpt against the text
// around it -- the stamp is the claim "this page's words still fit this code".
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { locate, optionsOf } from './kit/excerpt.js'

const TUT = dirname(fileURLToPath(import.meta.url)), REPO = resolve(TUT, '..')
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? (f === 'test' ? [] : walk(p)) : [p] })
const unq = v => v.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
let changed = 0
for (const f of walk(TUT).filter(f => f.endsWith('.html'))) {
    const html = readFileSync(f, 'utf8')
    const out = html.replace(/<pre\b([^>]*\bdata-src="[^"]*"[^>]*)>/g, (whole, inner) => {
        const a = {}; for (const m of inner.matchAll(/([\w-]+)="([^"]*)"/g)) a[m[1]] = unq(m[2])
        let h
        try { h = locate(readFileSync(join(REPO, a['data-src']), 'utf8'), optionsOf(k => a[k])).hash } catch (e) { console.log(`skipped ${relative(TUT, f)}: ${a['data-src']} "${a['data-sym']}": ${e.message}`); return whole }
        if (a['data-hash'] === h) return whole
        changed++
        console.log(`${relative(TUT, f)}: ${a['data-src']} "${a['data-sym']}" ${a['data-hash'] ?? '(none)'} -> ${h}`)
        return a['data-hash'] != null ? whole.replace(/data-hash="[^"]*"/, `data-hash="${h}"`) : whole.replace(/>$/, ` data-hash="${h}">`)
    })
    if (out !== html) writeFileSync(f, out)
}
console.log(`${changed} excerpt${changed === 1 ? '' : 's'} stamped`)
