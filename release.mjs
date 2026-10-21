//======================================================================================================================
// THE RELEASE: dev's change notes become a version, and dev becomes main.
//
//   node release.mjs             gather, show, ask, release, push      (VS Code: Terminal > Run Task > Release dev → main)
//   node release.mjs --dry-run   gather and show only                  (VS Code: Release: dry run)
//   node release.mjs --yes       without asking
//
// Why it exists: every PR used to raise VERSION and add the top entry of CHANGELOG.md itself, and name its version
// in comments, tests and the tutorial. Two branches in parallel took the same next number, and the one merged second
// renumbered all of it by hand (5e068dc, eecc5ce). Now a PR merges into `dev` and never picks a number (CLAUDE.md,
// *Versions*): it adds a change note, changes/<slug>.md -- first line `bump: minor` or `bump: patch`, a blank line,
// then the entry -- and writes the placeholder `0.next` wherever it would name its version. Notes have names of
// their own and the placeholder is the same on every branch, so branches never conflict over the version.
//
// This turns what dev holds into one version. It never touches the checkout it is run from: it works in a worktree
// of its own, made from the remote's dev and removed however it ends.
//   1. fetch dev and main; merge main into dev if main has commits dev lacks (an upload made straight to main);
//   2. read the notes; none is nothing to release. The largest bump wins: MINOR 0.(m+1).0, PATCH 0.m.(p+1);
//   3. one CHANGELOG.md entry, `## <version> — <date>`, the notes in file-name order; VERSION set to match;
//   4. the placeholder replaced in every tracked text file, but in the files that define it (EXCLUDED), and where it
//      is the placeholder's NAME: in backticks in CLAUDE.md, the changelog and a note (NAMES), nowhere else;
//   5. a tutorial excerpt re-stamped only when the release alone moved it: its old stamp is the hash of its lines
//      before the replacement. Any other stale excerpt stays listed for someone to read (CLAUDE.md);
//   6. the notes deleted, the result checked as version.test.mjs checks it, committed as you, and pushed to dev and
//      main in one atomic push: both move or neither does.
// Pages deploys main as before (.github/workflows/pages.yml), so a merge into dev is not deployed; a release is.
//
// The work is pure functions over a tree ({ list, read }) and test/release.test.mjs runs them, and the whole release
// through real git, without a GPU or the network.
//======================================================================================================================
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync, mkdtempSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { stampPage } from './tutorial/stamp.mjs'
import { locate, optionsOf } from './tutorial/kit/excerpt.js'

export const TOKEN = '0.next'
export const NOTES = 'changes/'
/* The files the placeholder is never replaced in: utils.js is off limits (CLAUDE.md), timeline and dockview are
   copies changed only by their own sync, and these two define the placeholder, so they hold it on purpose. */
export const EXCLUDED = ['lib/utils.js', 'lib/timeline/', 'lib/dockview/', 'release.mjs', 'test/release.test.mjs']
const BUMPS = ['patch', 'minor']
/* Never inside a word (iter0.next is code). In backticks it is the placeholder's NAME only where something is said
   ABOUT the placeholder: CLAUDE.md, which tells a PR to write it, the changelog, whose entries have described it, and a
   note, whose body becomes an entry. Everywhere else it is a version, backticks or not. Backticks kept it everywhere
   until 0.76.0, which shipped with seven files still reading `0.next` (FEATURES.md, model.js, three tests, two
   headless checks, tutorial/PLAN.md): the branch had written its version as CLAUDE.md shows the placeholder, in
   backticks, and nothing told the two apart. */
export const NAMES = ['CLAUDE.md', 'CHANGELOG.md']
const NAME_RE = /(?<![\w`])0\.next(?![\w`])/g
const TOKEN_RE = /`0\.next`|(?<!\w)0\.next(?!\w)/g      // the backticks go with it: a version is not code
/* The entries as test/version.test.mjs reads them. */
const ENTRY_RE = /^## (\S+) [—-] (\S+)\s*$/gm
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/

const excluded = p => EXCLUDED.some(e => e.endsWith('/') ? p.startsWith(e) : p === e)
const isNote = p => p.startsWith(NOTES) && p.endsWith('.md') && !p.slice(NOTES.length).includes('/')

/** A change note's text as { name, bump, body }, or a throw naming the file and what is wrong with it. */
export function parseNote(name, text) {
    const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n')
    const m = /^bump:\s*(\S*)\s*$/.exec(lines[0] ?? '')
    if (!m) throw new Error(`${name}: the first line must be "bump: minor" or "bump: patch"`)
    if (!BUMPS.includes(m[1])) throw new Error(`${name}: "bump: ${m[1]}" -- minor or patch only (0.x until the user says otherwise)`)
    const body = lines.slice(1).join('\n').trim()
    if (!body) throw new Error(`${name}: no entry after the bump line`)
    /* a "## " line would read as another version's heading (version.test.mjs's ENTRY_RE) or split this one */
    if (/^## /m.test(body)) throw new Error(`${name}: a "## " heading would start another version's entry; use ### or bold`)
    return { name, bump: m[1], body }
}

/** The version after `v` for these bumps: the largest wins. */
export function nextVersion(v, bumps) {
    const m = SEMVER.exec(v)
    if (!m) throw new Error(`"${v}" is not MAJOR.MINOR.PATCH`)
    if (!bumps.length) throw new Error('no bump: nothing to release')
    const [maj, min, pat] = m.slice(1).map(Number)
    return bumps.includes('minor') ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`
}

/* `path` is the file the text is from; none is a note's body or CLAUDE.md's, where backticks keep the name. */
const tokenIn = path => path == null || NAMES.includes(path) || isNote(path) ? NAME_RE : TOKEN_RE
export const replaceNext = (text, v, path) => text.replace(tokenIn(path), v)
export const countNext = (text, path) => (String(text).match(tokenIn(path)) || []).length

/** version.js's VERSION, and its text with VERSION set to `v`. */
const VERSION_RE = /^(export const VERSION = )'([^']*)'/m
export function readVersion(js) {
    const m = VERSION_RE.exec(js ?? '')
    if (!m) throw new Error('version.js has no `export const VERSION = \'...\'` line')
    return m[2]
}
export const setVersion = (js, v) => (readVersion(js), js.replace(VERSION_RE, `$1'${v}'`))

/** The entries' headings, newest first, as version.test.mjs reads them. */
export const entriesOf = changelog => [...String(changelog).matchAll(ENTRY_RE)].map(m => ({ v: m[1], date: m[2] }))

/** One version's entry: its heading, then the notes' bodies in the order given, the placeholder replaced in them. */
export const entryText = (v, date, notes) => `## ${v} — ${date}\n\n${notes.map(n => replaceNext(n.body, v)).join('\n\n')}\n`

/** The changelog with `entry` above its newest, in the changelog's own line endings (a Windows checkout's CRLF). */
export function insertEntry(changelog, entry) {
    const eol = changelog.includes('\r\n') ? '\r\n' : '\n'
    const m = /^## /m.exec(changelog)
    const at = m ? m.index : changelog.length
    const before = changelog.slice(0, at)
    const gap = !before || /(\r?\n){2}$/.test(before) ? '' : /\r?\n$/.test(before) ? eol : eol + eol
    return before + gap + entry.replace(/\n/g, eol) + (m ? eol : '') + changelog.slice(at)
}

/** A date as YYYY-MM-DD, the local day. */
export const today = (d = new Date()) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** What a tree holds of the next release: its notes parsed, the notes that do not parse, the files with the
 *  placeholder. test/release.test.mjs runs it on the repository, so a bad note fails its PR, not the release. */
export function pending({ list, read }) {
    const notes = [], errors = [], tokens = []
    for (const p of list.filter(isNote).sort()) {
        try { notes.push(parseNote(p, read(p))) } catch (e) { errors.push(e.message) }
    }
    for (const p of list) {
        if (excluded(p) || isNote(p)) continue
        const t = read(p)
        const n = t == null ? 0 : countNext(t, p)
        if (n) tokens.push({ path: p, count: n })
    }
    return { notes, errors, tokens }
}

/** What is wrong with a released tree, as version.test.mjs and this tool see it: [] when nothing. */
export function check({ list, read }) {
    const out = []
    let v = null
    try { v = readVersion(read('version.js')) } catch (e) { out.push(e.message) }
    const es = entriesOf(read('CHANGELOG.md') ?? '')
    if (es[0]?.v !== v) out.push(`CHANGELOG.md's top entry is ${es[0]?.v}, version.js says ${v}`)
    if (es[1] && es[0].date < es[1].date) out.push(`${es[0].v} is dated ${es[0].date}, before ${es[1].v}'s ${es[1].date}`)
    const left = pending({ list, read })
    if (left.notes.length || left.errors.length) out.push(`notes left: ${[...left.notes.map(n => n.name), ...left.errors].join(', ')}`)
    for (const t of left.tokens) out.push(`${t.path}: ${t.count} × ${TOKEN} left`)
    return out
}

/**
 * The release of a tree ({ list: tracked paths, read(path) -> text, or null for a binary or a folder }), not applied:
 * { version, from, date, notes, writes: Map(path -> text), deletes: [paths], tokens, stamped }. No notes: version null and
 * nothing to write. A note that does not parse, a placeholder with no note, or a result `check` refuses: a throw.
 */
export function planRelease({ list, read }, { date = today(), log = () => { } } = {}) {
    const { notes, errors, tokens } = pending({ list, read })
    if (errors.length) throw new Error(errors.join('\n'))
    if (!notes.length) {
        if (tokens.length) throw new Error(`${TOKEN} in ${tokens.map(t => t.path).join(', ')}, but no change note in ${NOTES}`)
        return { version: null, from: null, date: null, notes, writes: new Map(), deletes: [], tokens, stamped: [] }
    }
    const from = readVersion(read('version.js'))
    const version = nextVersion(from, notes.map(n => n.bump))
    const writes = new Map()
    const now = p => writes.has(p) ? writes.get(p) : read(p)

    for (const t of tokens) writes.set(t.path, replaceNext(read(t.path), version, t.path))

    /* Never dated before the entry under it (version.test.mjs): entries written in another time zone came first. */
    const old = read('CHANGELOG.md')
    if (old == null) throw new Error('no CHANGELOG.md')
    const prev = entriesOf(old)[0]?.date
    const day = prev && prev > date ? prev : date
    writes.set('CHANGELOG.md', insertEntry(now('CHANGELOG.md'), entryText(version, day, notes)))
    writes.set('version.js', setVersion(now('version.js'), version))

    /* An excerpt the replacement moved: stamped again only when its stamp was right before it, so no excerpt the
       release did not move is ever stamped unread. */
    const stamped = []
    if (tokens.length) {
        const oldHash = a => { try { return locate(read(a['data-src']), optionsOf(k => a[k])).hash } catch { return null } }
        for (const p of list.filter(p => p.startsWith('tutorial/') && p.endsWith('.html') && !p.includes('/test/'))) {
            const html = now(p)
            if (html == null) continue
            const r = stampPage(html, now, () => { }, a => a['data-hash'] != null && oldHash(a) === a['data-hash'])
            if (r.changed) { writes.set(p, r.html); stamped.push({ path: p, count: r.changed }) }
        }
    }

    const deletes = notes.map(n => n.name)
    const gone = new Set(deletes)
    const problems = check({ list: list.filter(p => !gone.has(p)), read: now })
    if (problems.length) throw new Error(`the release would not hold:\n  ${problems.join('\n  ')}`)
    log(`${from} → ${version}`)
    return { version, from, date: day, notes, writes, deletes, tokens, stamped }
}

/** The commit's message: the version, then each note's first bold sentence (or first line), and its file. */
export function commitMessage(plan) {
    const gist = n => (/\*\*(.+?)\*\*/.exec(n.body)?.[1] ?? n.body.split('\n')[0]).trim()
    return `Release ${plan.version}\n\n${plan.notes.map(n => `- ${gist(n)} (${n.name})`).join('\n')}\n`
}

// ---- git ------------------------------------------------------------------------------------------------------------

/** A worktree's files as a tree: what git tracks, read as text; a binary file (a NUL early on) or a folder (a
 *  submodule, which a worktree does not check out) reads as null. */
export function treeOf(dir, git) {
    const list = git(['ls-files', '-z']).split('\0').filter(Boolean)
    const cache = new Map()
    const read = p => {
        if (cache.has(p)) return cache.get(p)
        let t = null
        try {
            const f = join(dir, p)
            if (statSync(f).isFile()) {
                const b = readFileSync(f)
                t = b.subarray(0, 8000).includes(0) ? null : b.toString('utf8')
            }
        } catch { t = null }
        cache.set(p, t)
        return t
    }
    return { list, read }
}

/**
 * The release, through git. `cwd` is any checkout of the repository; it is left as it was. Resolves to
 * { version, sha } once pushed, { version, dryRun: true }, { version: null } with nothing to release or when the
 * answer is no; throws with git's own words when something refuses, nothing pushed.
 */
export async function release({ cwd = process.cwd(), remote = 'origin', dev = 'dev', main = 'main', dryRun = false,
                                yes = false, date = today(), env = process.env, log = console.log, ask = askTerminal } = {}) {
    const run = (dir, args) => {
        try { return execFileSync('git', args, { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
        catch (e) { throw new Error(`git ${args.join(' ')}:\n${(e.stderr || e.message).trim()}`) }
    }
    const root = run(cwd, ['rev-parse', '--show-toplevel'])
    try { run(root, ['fetch', '--quiet', remote, `+refs/heads/${dev}:refs/remotes/${remote}/${dev}`, `+refs/heads/${main}:refs/remotes/${remote}/${main}`]) }
    catch (e) { throw new Error(`${e.message}\n\nIs there a ${dev} branch on ${remote}? Pull requests merge into it (CLAUDE.md, Versions); make it from ${main} once.`) }
    const devSha = run(root, ['rev-parse', `refs/remotes/${remote}/${dev}`])
    const mainSha = run(root, ['rev-parse', `refs/remotes/${remote}/${main}`])

    const wt = mkdtempSync(join(tmpdir(), 'shadytracer-release-'))
    const git = args => run(wt, args)
    try {
        run(root, ['worktree', 'add', '--quiet', '--detach', wt, devSha])
        const behind = +git(['rev-list', '--count', `${devSha}..${mainSha}`])
        if (behind) {
            log(`${main} has ${behind} commit${behind === 1 ? '' : 's'} ${dev} lacks: merging ${main} into ${dev} first`)
            try { git(['merge', '--quiet', '--no-ff', '--no-edit', '-m', `Merge ${main} into ${dev} before the release`, mainSha]) }
            catch (e) {
                let files = ''
                try { files = git(['diff', '--name-only', '--diff-filter=U']) } catch { }
                try { git(['merge', '--abort']) } catch { }
                throw new Error(`merging ${main} into ${dev} conflicts${files ? ` in:\n  ${files.split('\n').join('\n  ')}` : ''}\nMerge ${main} into ${dev} by hand, push ${dev}, and run this again. Nothing was pushed.`)
            }
        }
        const plan = planRelease(treeOf(wt, git), { date })
        if (!plan.version) {
            const ahead = +git(['rev-list', '--count', `${mainSha}..HEAD`])
            log(`Nothing to release: no change note in ${NOTES} on ${remote}/${dev}${ahead ? ` (it is ${ahead} commit${ahead === 1 ? '' : 's'} ahead of ${main})` : ''}.`)
            return { version: null }
        }
        log(`\n${plan.from} → ${plan.version}\n`)
        for (const n of plan.notes) log(`  ${n.bump.padEnd(5)} ${n.name}`)
        log(`\n  ${TOKEN} replaced in ${plan.tokens.length} file${plan.tokens.length === 1 ? '' : 's'}${plan.tokens.length ? ': ' + plan.tokens.map(t => `${t.path} (${t.count})`).join(', ') : ''}`)
        if (plan.stamped.length) log(`  tutorial excerpts re-stamped: ${plan.stamped.map(s => `${s.path} (${s.count})`).join(', ')}`)
        log(`\n---- CHANGELOG.md\n${entryText(plan.version, plan.date, plan.notes)}----\n`)
        if (dryRun) { log('Dry run: nothing written, nothing pushed.'); return { version: plan.version, dryRun: true } }
        if (!yes && !/^y(es)?$/i.test(String(await ask(`Release ${plan.version} to ${remote}/${dev} and ${remote}/${main}? [y/N] `)).trim())) {
            log('Not released. Nothing was pushed.')
            return { version: null }
        }

        for (const [p, t] of plan.writes) writeFileSync(join(wt, p), t)
        git(['rm', '--quiet', '--', ...plan.deletes])
        git(['add', '--', ...plan.writes.keys()])
        const problems = check(treeOf(wt, git))     // from the disk this time: what is committed is what was checked
        if (problems.length) throw new Error(`the release did not hold:\n  ${problems.join('\n  ')}\nNothing was pushed.`)
        git(['commit', '--quiet', '-m', commitMessage(plan)])
        const sha = git(['rev-parse', 'HEAD'])
        try { git(['push', '--quiet', '--atomic', remote, `${sha}:refs/heads/${dev}`, `${sha}:refs/heads/${main}`]) }
        catch (e) { throw new Error(`${e.message}\n\nThe push is atomic: neither ${dev} nor ${main} moved. If ${dev} moved meanwhile, run this again.`) }
        log(`Released ${plan.version}: ${remote}/${main} and ${remote}/${dev} are at ${sha.slice(0, 7)}. Pages deploys ${main} (the Actions tab).`)
        return { version: plan.version, sha }
    } finally {
        try { run(root, ['worktree', 'remove', '--force', wt]) } catch { }
        rmSync(wt, { recursive: true, force: true })
        try { run(root, ['worktree', 'prune']) } catch { }
    }
}

async function askTerminal(question) {
    const { createInterface } = await import('node:readline/promises')
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    try { return await rl.question(question) } finally { rl.close() }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const args = new Set(process.argv.slice(2))
    const unknown = [...args].filter(a => !['--dry-run', '--yes'].includes(a))
    if (unknown.length) { console.error(`unknown: ${unknown.join(' ')}\nnode release.mjs [--dry-run] [--yes]`); process.exit(2) }
    try { await release({ dryRun: args.has('--dry-run'), yes: args.has('--yes') }) }
    catch (e) { console.error(`\n${e.message}`); process.exitCode = 1 }
}
