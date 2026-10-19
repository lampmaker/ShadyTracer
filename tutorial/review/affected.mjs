// node tutorial/review/affected.mjs [base]          (base: origin/main, else main)
// node tutorial/review/affected.mjs --files a.js b.js
//
// WHICH PARTS OF THE TUTORIAL A CHANGE TO SHADYTRACER TOUCHES (CLAUDE.md, "The tutorial follows the code"). Every file
// changed since the branch left `base` (committed, staged, not yet staged, or new), outside tutorial/ itself, is held
// against what ties a page to the code:
//   - an EXCERPT (<pre data-src data-sym>): the lines it shows, found today the way the page finds them, and whether
//     the change touched them -- the hash the page was stamped with says the same, but only for those lines;
//   - a CITATION (<cite data-src data-sym>): the line it names;
//   - an IMPORT: an engine module a page's figures run (help/widgets.js draws the distance fields, measure.js the
//     error bars), so a change there can change a figure with no line of the page changing;
//   - what a chapter is ABOUT (kit/chapters.js `code`), planned chapters too: a file no page quotes still has a
//     chapter, or a line in tutorial/PLAN.md, that describes it.
// It prints each chapter and why, and what to do. It decides nothing: reading the sections is the review. Nothing
// listed is not proof that nothing is stale -- a new feature belongs in some chapter's plan whether or not a file
// of it is tied to one -- so the list is where the review starts, not where it ends.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { CHAPTERS } from '../kit/chapters.js'
import { locate, optionsOf } from '../kit/excerpt.js'

const TUT = resolve(dirname(fileURLToPath(import.meta.url)), '..'), REPO = resolve(TUT, '..')
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? (['test', 'review'].includes(f) ? [] : walk(p)) : [p] })
const unq = v => v.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const attrsOf = s => { const a = {}; for (const m of s.matchAll(/([\w-]+)="([^"]*)"/g)) a[m[1]] = unq(m[2]); return a }

/** Every tie between the tutorial and the repository: [{ page, chapter, kind, file, first?, last?, sym? }]. */
export function ties() {
    const out = []
    const importsOf = p => [...readFileSync(p, 'utf8').matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]/gm)].map(m => resolve(dirname(p), m[1]))
    for (const f of walk(TUT).filter(f => f.endsWith('.html'))) {
        const page = relative(TUT, f), html = readFileSync(f, 'utf8')
        const chapter = /<body[^>]*data-chapter="([^"]*)"/.exec(html)?.[1] || null
        // a tag ends at the first > outside quotes (a data-why may write `=>`)
        for (const m of html.matchAll(/<(pre|cite)\b((?:[^>"]|"[^"]*")*)>/g)) {
            if (!/\bdata-src="/.test(m[2])) continue
            const a = attrsOf(m[2]), tie = { page, chapter, kind: m[1] === 'pre' ? 'excerpt' : 'citation', file: a['data-src'], sym: a['data-sym'] }
            try { const hit = locate(readFileSync(join(REPO, tie.file), 'utf8'), optionsOf(k => a[k])); Object.assign(tie, { first: hit.first, last: m[1] === 'pre' ? hit.last : hit.first }) }
            catch (e) { tie.missing = e.message }
            out.push(tie)
        }
        // the page's module and everything it imports, outside the tutorial
        const src = /<script type="module" src="([^"]+)"/.exec(html)?.[1]
        if (src) {
            const seen = new Set(), visit = p => { if (seen.has(p) || !existsSync(p)) return; seen.add(p); for (const q of importsOf(p)) visit(q) }
            visit(resolve(dirname(f), src))
            // not version.js: it gives the title block its number, every PR changes it, and no page explains it
            for (const p of seen) if (!p.startsWith(TUT + '/') && relative(REPO, p) !== 'version.js') out.push({ page, chapter, kind: 'import', file: relative(REPO, p) })
        }
    }
    for (const c of CHAPTERS) for (const p of c.code) out.push({ page: c.file, chapter: c.id, kind: 'about', file: p })
    return out
}

/** What a change touches: `changes` is [{ file, ranges: [[first, last], ...] | null }] (null: the whole file, or not known). */
export function affected(changes, all = ties()) {
    const hits = []
    for (const ch of changes) {
        // version.js: every PR raises VERSION, so it would list chapter 0 every time; the stamp on chapter 0's
        // excerpt of it (tutorial.test.mjs) still says when the lines shown change
        if (ch.file.startsWith('tutorial/') || ch.file === 'version.js') continue
        for (const t of all) {
            const same = t.kind === 'about' && t.file.endsWith('/') ? ch.file.startsWith(t.file) : ch.file === t.file
            if (!same) continue
            const overlap = t.first == null || !ch.ranges ? null : ch.ranges.some(([a, b]) => a <= t.last && b >= t.first)
            hits.push({ ...t, changed: ch.file, overlap })
        }
    }
    return hits
}

/** The changed files and their changed lines (new side) since the branch left `base`, working tree included. */
export function changesSince(base) {
    // the diff of a branch that adds the tutorial itself passed execFileSync's default 1 MB and killed the run (ENOBUFS)
    const git = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 30 })
    const from = git('merge-base', base, 'HEAD').trim()
    const files = new Map()
    for (const line of git('diff', '-U0', '--no-color', from).split('\n')) {
        const f = /^\+\+\+ b\/(.*)$/.exec(line)
        if (f) { files.set(f[1], []); var cur = f[1]; continue }
        if (/^\+\+\+ \/dev\/null/.test(line)) { cur = null; continue }
        const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
        if (h && cur) { const a = +h[1], n = h[2] == null ? 1 : +h[2]; files.get(cur).push([a, Math.max(a, a + n - 1)]) }
    }
    // deleted files, and submodules (a moved pin is one line, "Subproject commit")
    for (const f of git('diff', '--name-only', from).split('\n').filter(Boolean)) if (!files.has(f)) files.set(f, null)
    for (const f of git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean)) files.set(f, null)
    return [...files].map(([file, ranges]) => ({ file, ranges }))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const args = process.argv.slice(2)
    let changes
    if (args[0] === '--files') changes = args.slice(1).map(file => ({ file, ranges: null }))
    else {
        const base = args[0] ?? ['origin/main', 'main'].find(b => { try { execFileSync('git', ['rev-parse', '--verify', '-q', b], { cwd: REPO, stdio: 'ignore' }); return true } catch { return false } })
        if (!base) { console.log('no base branch found: name one, or use --files'); process.exit(1) }
        changes = changesSince(base)
        console.log(`${changes.filter(c => !c.file.startsWith('tutorial/')).length} files changed outside tutorial/ since ${base}\n`)
    }
    const all = ties(), hits = affected(changes, all)
    const broken = all.filter(t => t.missing)
    if (!hits.length && !broken.length) console.log('No chapter is tied to these files. Still ask: does this change add or alter something a chapter, or tutorial/PLAN.md, describes?')
    const by = new Map()
    for (const h of hits) { const k = h.chapter ?? h.page; if (!by.has(k)) by.set(k, []); by.get(k).push(h) }
    const order = k => CHAPTERS.find(c => c.id === k)?.number ?? -1
    for (const [k, hs] of [...by].sort((a, b) => order(a[0]) - order(b[0]))) {
        const c = CHAPTERS.find(c => c.id === k)
        console.log(!c ? `tutorial/${k}` : `ch. ${c.number} "${c.title}"  ${c.file ? `(tutorial/${c.file})` : '(planned: its line in tutorial/PLAN.md)'}`)
        for (const h of hs) {
            const where = h.first ? `:${h.first}${h.last !== h.first ? '-' + h.last : ''}` : ''
            const what = { excerpt: `shows ${h.file}${where} ("${h.sym}")`, citation: `cites ${h.file}${where} ("${h.sym}")`, import: `runs ${h.file} in its figures`, about: `is about ${h.file}` }[h.kind]
            const flag = h.overlap === true ? '  <- THOSE LINES CHANGED' : h.overlap === false ? '  (changed elsewhere in the file)' : ''
            console.log(`  ${what}${flag}`)
        }
    }
    for (const t of broken) console.log(`BROKEN  ${t.page}: ${t.kind} ${t.file} "${t.sym}": ${t.missing}`)
    if (by.size || broken.length) console.log(`
For each chapter above: read the sections that explain these files against the change, fix what no longer holds
(the prose, a figure's numbers, a stamp's measurement, a glossary card), then node tutorial/stamp.mjs once the
excerpts are re-read, and node tutorial/test/tutorial.test.mjs. A planned chapter: correct its line in
tutorial/PLAN.md. Say in the PR what was read and what changed.`)
}
