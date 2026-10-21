//======================================================================================================================
// Tests for the release (release.mjs). Run: node test/release.test.mjs
//
// What has to hold, none of it needing a GPU or the network:
//   a change note reads as its bump and its entry, and a note that would not is refused naming its file -- here, on
//     the PR, and not after the merge when the release meets it;
//   the version: the largest bump wins, a minor resets the patch, never a major; one entry for all the notes, above
//     the newest, as version.test.mjs reads the changelog;
//   the placeholder replaced as a version and nowhere else: not inside a word, not as its own name in backticks, not
//     in the files that define it or may not be touched;
//   a tutorial excerpt re-stamped only when the release alone moved it;
//   THIS repository: every note parses, and a placeholder means a note to release it;
//   the release through real git: a bare "origin" with main and dev, an upload made on main merged in, two notes
//     released as one version, dev and main moved together -- and a refused push moving neither, the checkout it was
//     run from untouched every time.
//======================================================================================================================
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, chmodSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import * as R from '../release.mjs'
import { locate } from '../tutorial/kit/excerpt.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const eq = (name, got, want) =>
    ok(name, JSON.stringify(got) === JSON.stringify(want),
        `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
const throws = (name, f, re) => {
    try { f(); ok(name, false, 'did not throw') } catch (e) { ok(name, re.test(e.message), e.message) }
}
const N = R.TOKEN

// ---- a change note ---------------------------------------------------------------------------------------------------
eq('a note: its bump and its entry', R.parseNote('changes/a.md', `bump: minor\n\n**A thing.** Done.\n`),
   { name: 'changes/a.md', bump: 'minor', body: '**A thing.** Done.' })
eq('...written on Windows (CRLF)', R.parseNote('changes/a.md', 'bump: patch\r\n\r\nFixed.\r\nTwo lines.\r\n').body, 'Fixed.\nTwo lines.')
throws('no bump line: refused, naming the file', () => R.parseNote('changes/x.md', 'Fixed.\n'), /changes\/x\.md.*first line/)
throws('a major: refused (0.x until the user says otherwise)', () => R.parseNote('changes/x.md', 'bump: major\n\nBig.'), /changes\/x\.md.*minor or patch/)
throws('a garbled bump', () => R.parseNote('changes/x.md', 'bump: minro\n\nOops.'), /minro/)
throws('no entry', () => R.parseNote('changes/x.md', 'bump: patch\n\n  \n'), /no entry/)
throws('a "## " heading inside: it would start another version', () => R.parseNote('changes/x.md', 'bump: patch\n\n## 0.9.0 — 2026-01-01\n'), /## /)

// ---- the version -----------------------------------------------------------------------------------------------------
eq('a patch', R.nextVersion('0.71.1', ['patch']), '0.71.2')
eq('a minor resets the patch', R.nextVersion('0.71.1', ['minor']), '0.72.0')
eq('the largest bump wins', R.nextVersion('0.71.1', ['patch', 'minor', 'patch']), '0.72.0')
throws('no bump', () => R.nextVersion('0.71.1', []), /nothing to release/)
throws('not semver', () => R.nextVersion('0.71', ['patch']), /MAJOR/)
eq('version.js: read', R.readVersion(`export const NAME = 'x'\nexport const VERSION = '0.71.1'\n`), '0.71.1')
eq('...and set, nothing else moved', R.setVersion(`a\nexport const VERSION = '0.71.1'\nb\n`, '0.72.0'), `a\nexport const VERSION = '0.72.0'\nb\n`)
throws('...a version.js without the line', () => R.setVersion('export let V = 1', '0.1.0'), /VERSION/)

// ---- the placeholder -------------------------------------------------------------------------------------------------
eq('replaced where it names the version', R.replaceNext(`the haze box (${N}), (${N}: a leg). ${N}.`, '0.72.0'),
   'the haze box (0.72.0), (0.72.0: a leg). 0.72.0.')
eq('not inside a word (code)', R.replaceNext(`iter${N}() ${N}s x${N}`, '0.72.0'), `iter${N}() ${N}s x${N}`)
eq('not its own name, in backticks', R.replaceNext('write `' + N + '` where', '0.72.0'), 'write `' + N + '` where')
eq('counted the same way', R.countNext(`(${N}) iter${N} \`${N}\` ${N}`), 2)

// ---- the changelog ---------------------------------------------------------------------------------------------------
const LOG = '# Changelog\n\nHow it works.\n\n## 0.1.0 — 2026-01-01\n\nFirst.\n'
const notes = [{ name: 'changes/a.md', bump: 'minor', body: `**A.** In ${N}.` }, { name: 'changes/b.md', bump: 'patch', body: '**B.** Fixed.' }]
const e = R.entryText('0.2.0', '2026-02-01', notes)
eq('one entry for every note, the placeholder replaced in them', e, '## 0.2.0 — 2026-02-01\n\n**A.** In 0.2.0.\n\n**B.** Fixed.\n')
const L2 = R.insertEntry(LOG, e)
eq('...above the newest, a blank line each side', L2, '# Changelog\n\nHow it works.\n\n' + e + '\n## 0.1.0 — 2026-01-01\n\nFirst.\n')
eq('...read as version.test.mjs reads it', R.entriesOf(L2), [{ v: '0.2.0', date: '2026-02-01' }, { v: '0.1.0', date: '2026-01-01' }])
eq('...a CRLF changelog kept CRLF', R.insertEntry(LOG.replace(/\n/g, '\r\n'), e), L2.replace(/\n/g, '\r\n'))
eq('...an entry ended without a blank line before the next (0.71.1 was)', R.insertEntry('# C\n\n## 0.1.0 — 2026-01-01\nx\n', e),
   '# C\n\n' + e + '\n## 0.1.0 — 2026-01-01\nx\n')

// ---- a release planned over a tree in memory --------------------------------------------------------------------------
const treeOf = files => ({ list: Object.keys(files), read: p => files[p] ?? null })
const SRC = `// one\nfunction f() {\n    return 1   // (${N})\n}\n`
const base = {
    'version.js': `export const VERSION = '0.1.0'\n`,
    'CHANGELOG.md': LOG,
    'src.js': SRC,
    'doc.md': 'Write `' + N + '` where you would name your version.\n',
    'lib/utils.js': `// (${N}) never touched\n`,
    'lib/dockview/x.js': `// (${N})\n`,
    'release.mjs': `const T = '${N}'\n`,
    'picture.png': null,                                       // a binary: read as null
    'changes/b-fix.md': 'bump: patch\n\n**B.** Fixed.\n',
    'changes/a-feature.md': `bump: minor\n\n**A.** In ${N}.\n`,
}
const plan = R.planRelease(treeOf(base), { date: '2026-02-01' })
eq('the plan: the version, from what', [plan.from, plan.version, plan.date], ['0.1.0', '0.2.0', '2026-02-01'])
eq('...the notes in file-name order', plan.notes.map(n => n.name), ['changes/a-feature.md', 'changes/b-fix.md'])
eq('...deleted', plan.deletes, ['changes/a-feature.md', 'changes/b-fix.md'])
eq('...the placeholder replaced where it is one', plan.writes.get('src.js'), SRC.replace(N, '0.2.0'))
eq('...the files written: these and no others', [...plan.writes.keys()].sort(), ['CHANGELOG.md', 'src.js', 'version.js'])
eq('...the changelog\'s new top', R.entriesOf(plan.writes.get('CHANGELOG.md'))[0], { v: '0.2.0', date: '2026-02-01' })
ok('...holding both notes, the first bold sentence of each in the commit', R.commitMessage(plan) ===
   'Release 0.2.0\n\n- A. (changes/a-feature.md)\n- B. (changes/b-fix.md)\n', R.commitMessage(plan))
eq('a date before the newest entry\'s: the entry under it is never dated after it',
   R.planRelease(treeOf(base), { date: '2025-12-31' }).date, '2026-01-01')
const none = R.planRelease(treeOf({ 'version.js': base['version.js'], 'CHANGELOG.md': LOG, 'src.js': '// x\n' }))
eq('no note: nothing to release, nothing written', [none.version, none.writes.size, none.deletes.length], [null, 0, 0])
throws('a placeholder and no note: refused (it would be released as someone else\'s version)',
       () => R.planRelease(treeOf(Object.fromEntries(Object.entries(base).filter(([p]) => !p.startsWith('changes/'))))), /src\.js.*no change note/)
throws('a note that does not parse: refused', () => R.planRelease(treeOf({ ...base, 'changes/c.md': 'Fixed.\n' })), /changes\/c\.md/)
eq('a folder under changes/ is not a note', R.pending(treeOf({ 'changes/old/x.md': 'whatever' })).notes, [])
eq('check: the released tree holds', R.check({ list: Object.keys(base).filter(p => !p.startsWith('changes/')), read: p => plan.writes.get(p) ?? base[p] ?? null }), [])
eq('check: what it catches', R.check(treeOf({ 'version.js': `export const VERSION = '0.3.0'\n`, 'CHANGELOG.md': LOG, 'x.js': `(${N})`, 'changes/a.md': 'bump: patch\n\nA.' })).length, 3)

// ---- the tutorial's stamps --------------------------------------------------------------------------------------------
const opts = { sym: 'function f' }
const hOld = locate(SRC, opts).hash, hNew = locate(SRC.replace(N, '0.2.0'), opts).hash
ok('(the replacement moves the excerpt\'s hash)', hOld !== hNew)
const page = `<p>x</p>\n<pre data-src="src.js" data-sym="function f" data-hash="${hOld}"></pre>\n` +
             `<pre data-src="src.js" data-sym="// one" data-to="function f" data-hash="deadbeef"></pre>\n`
const withPage = R.planRelease(treeOf({ ...base, 'tutorial/ch/a.html': page, 'tutorial/test/b.html': page }), { date: '2026-02-01' })
const stamped = withPage.writes.get('tutorial/ch/a.html') ?? ''
ok('an excerpt the release alone moved: re-stamped', stamped.includes(`data-hash="${hNew}"`), stamped)
ok('one already stale: left for someone to read', stamped.includes('data-hash="deadbeef"'), stamped)
eq('...and a tutorial test folder left alone', [withPage.writes.has('tutorial/test/b.html'), withPage.stamped], [false, [{ path: 'tutorial/ch/a.html', count: 1 }]])

// ---- this repository ------------------------------------------------------------------------------------------------
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const here = R.treeOf(ROOT, args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }))
const live = R.pending(here)
eq('every change note in changes/ parses', live.errors, [])
ok(`a ${N} in the code means a note to release it`, !live.tokens.length || live.notes.length,
   `${live.tokens.map(t => t.path).join(', ')} hold ${N}, and changes/ has no note`)
eq('version.js is where the release looks', R.readVersion(here.read('version.js')), R.entriesOf(here.read('CHANGELOG.md'))[0].v)

// ---- the release through real git ------------------------------------------------------------------------------------
const TMP = mkdtempSync(join(tmpdir(), 'release-test-'))
const gitConfig = join(TMP, 'gitconfig')
writeFileSync(gitConfig, '[init]\n\tdefaultBranch = main\n[user]\n\tname = Tester\n\temail = tester@example.com\n')
/* The machine's own git settings kept out: a global commit signing or hooks path would fail or change the test. */
const env = { ...process.env, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' }
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const put = (dir, files) => { for (const [p, t] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), t) } }
const quiet = () => { }
try {
    const origin = join(TMP, 'origin.git'), seed = join(TMP, 'seed'), user = join(TMP, 'user')
    git(TMP, 'init', '--quiet', '--bare', origin)
    git(TMP, 'clone', '--quiet', origin, seed)
    put(seed, { 'version.js': `export const VERSION = '0.1.0'\n`, 'CHANGELOG.md': LOG, 'src.js': '// nothing yet\n' })
    git(seed, 'add', '.'); git(seed, 'commit', '--quiet', '-m', 'start')
    git(seed, 'push', '--quiet', 'origin', 'HEAD:main', 'HEAD:dev')
    git(TMP, 'clone', '--quiet', origin, user)
    put(user, { 'mine.txt': 'uncommitted work\n' })
    const userHead = git(user, 'rev-parse', 'HEAD')
    const at = ref => git(origin, 'rev-parse', ref)
    const show = (ref, p) => git(origin, 'show', `${ref}:${p}`)
    const worktrees = () => git(user, 'worktree', 'list').split('\n').length
    const untouched = name => ok(`${name}: the checkout run from untouched, no worktree left`,
        git(user, 'rev-parse', 'HEAD') === userHead && git(user, 'status', '--porcelain') === '?? mine.txt' && worktrees() === 1,
        git(user, 'status', '--porcelain'))
    const rel = o => R.release({ cwd: user, env, log: quiet, date: '2026-02-01', ...o })

    eq('nothing on dev: nothing to release', await rel({ yes: true }), { version: null })
    untouched('nothing to release')

    /* two pull requests merged into dev, and an upload made straight onto main */
    git(seed, 'checkout', '--quiet', '-b', 'dev', 'origin/dev')
    put(seed, { 'changes/b-fix.md': 'bump: patch\n\n**B.** Fixed.\n', 'changes/a-feature.md': `bump: minor\n\n**A.** In ${N}.\n`,
                'src.js': `// the feature (${N})\n`, 'doc.md': 'Write `' + N + '` where you would name your version.\n' })
    git(seed, 'add', '.'); git(seed, 'commit', '--quiet', '-m', 'two PRs'); git(seed, 'push', '--quiet', 'origin', 'dev')
    git(seed, 'checkout', '--quiet', '-b', 'up', 'origin/main')
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, ...Buffer.from(` (${N}) `)])
    writeFileSync(join(seed, 'shot.png'), PNG)
    git(seed, 'add', '.'); git(seed, 'commit', '--quiet', '-m', 'Add files via upload'); git(seed, 'push', '--quiet', 'origin', 'HEAD:main')
    const dev0 = at('dev'), main0 = at('main')

    eq('a dry run: the version it would be', await rel({ dryRun: true }), { version: '0.2.0', dryRun: true })
    eq('...nothing pushed', [at('dev'), at('main')], [dev0, main0])
    untouched('a dry run')
    eq('answered no: not released', await rel({ ask: async () => 'n' }), { version: null })
    eq('...nothing pushed', [at('dev'), at('main')], [dev0, main0])

    /* main refusing the push, as a protected branch would: the push is atomic, so dev does not move either */
    const hook = join(origin, 'hooks', 'update')
    writeFileSync(hook, '#!/bin/sh\n[ "$1" = refs/heads/main ] && { echo "main is protected" >&2; exit 1; }\nexit 0\n')
    chmodSync(hook, 0o755)
    let err = ''
    try { await rel({ yes: true }) } catch (x) { err = x.message }
    ok('main refused: the release says why', /main is protected/.test(err) && /neither dev nor main moved/.test(err), err)
    eq('...and neither moved', [at('dev'), at('main')], [dev0, main0])
    untouched('a refused push')
    rmSync(hook)

    const r = await rel({ ask: async () => 'y' })
    eq('released: the version', r.version, '0.2.0')
    eq('...dev and main both at the release', [at('dev'), at('main')], [r.sha, r.sha])
    eq('...version.js', show('main', 'version.js'), `export const VERSION = '0.2.0'`)
    eq('...the changelog: one entry for both notes, on top', R.entriesOf(show('main', 'CHANGELOG.md')).map(x => x.v), ['0.2.0', '0.1.0'])
    ok('...holding them in order, the placeholder replaced', show('main', 'CHANGELOG.md').includes('**A.** In 0.2.0.\n\n**B.** Fixed.'))
    eq('...the code\'s placeholder replaced', show('main', 'src.js'), '// the feature (0.2.0)')
    eq('...its name in backticks kept', show('main', 'doc.md'), 'Write `' + N + '` where you would name your version.')
    eq('...the notes gone', git(origin, 'ls-tree', '--name-only', 'main', 'changes/'), '')
    ok('...the upload merged in, byte for byte (a binary never rewritten)',
       Buffer.from(execFileSync('git', ['show', 'main:shot.png'], { cwd: origin, env })).equals(PNG))
    eq('...the release commit, as the user', [git(origin, 'log', '-1', '--format=%s|%an', 'main')], ['Release 0.2.0|Tester'])
    ok('...after the merge of main', git(origin, 'log', '-1', '--format=%s', 'main~1') === 'Merge main into dev before the release')
    untouched('a release')
    eq('and again: nothing left to release', await rel({ yes: true }), { version: null })

    /* a branch made before the release, merging dev after it: no conflict over the version */
    git(seed, 'checkout', '--quiet', '-b', 'feature', dev0)
    put(seed, { 'changes/c.md': 'bump: patch\n\nC.\n', 'other.js': `// (${N})\n` })
    git(seed, 'add', '.'); git(seed, 'commit', '--quiet', '-m', 'C')
    git(seed, 'fetch', '--quiet', 'origin')
    let merged = true
    try { git(seed, 'merge', '--quiet', '--no-edit', 'origin/dev') } catch { merged = false }
    ok('a branch from before the release merges dev after it without a conflict', merged)
    eq('...keeping its own note and placeholder for the next release',
       [existsSync(join(seed, 'changes/c.md')), readFileSync(join(seed, 'other.js'), 'utf8'), readFileSync(join(seed, 'src.js'), 'utf8')],
       [true, `// (${N})\n`, '// the feature (0.2.0)\n'])

    /* main and dev changing the same line: the release stops before anything, saying where */
    git(seed, 'checkout', '--quiet', '-B', 'd', 'origin/dev')
    put(seed, { 'changes/d.md': 'bump: patch\n\nD.\n', 'src.js': '// dev\'s line\n' })
    git(seed, 'add', '.'); git(seed, 'commit', '--quiet', '-m', 'D'); git(seed, 'push', '--quiet', 'origin', 'HEAD:dev')
    git(seed, 'checkout', '--quiet', '-B', 'm', 'origin/main')
    put(seed, { 'src.js': '// main\'s line\n' })
    git(seed, 'add', '.'); git(seed, 'commit', '--quiet', '-m', 'on main'); git(seed, 'push', '--quiet', 'origin', 'HEAD:main')
    const dev1 = at('dev'), main1 = at('main')
    err = ''
    try { await rel({ yes: true }) } catch (x) { err = x.message }
    ok('main and dev in conflict: refused, naming the file', /conflicts in:\n {2}src\.js/.test(err) && /Nothing was pushed/.test(err), err)
    eq('...nothing pushed', [at('dev'), at('main')], [dev1, main1])
    untouched('a conflict')
} finally {
    rmSync(TMP, { recursive: true, force: true })
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
