//======================================================================================================================
// Tests for the application's version and revision. Run: node test/version.test.mjs
//
// What has to hold, none of it needing a GPU or a browser:
//   VERSION and CHANGELOG.md agree -- the top entry is the version the code says it is, versions only go up, and
//     every entry has a date. That is the whole of the rule "raise it in the PR, with its entry": the test is what
//     a PR that forgets half of it trips over.
//   the revision is read from a .git the way a server hands it out -- a branch's own file, packed-refs, a detached
//     HEAD -- and every way that can fail (no .git, an HTML error page, a server that never answers) is null, not
//     a throw: a page that cannot say its revision still has to start.
//   where .git is not served (GitHub Pages), the REVISION file the deploy writes names it instead -- and never
//     outvotes a .git that is there.
//   a saved FILE carries `app` beside its format version, and reading it takes `app` off again, so it never reaches
//     a document: undo snapshots, library thumbnails' keys and "changed since" compare documents, and a stamp
//     that moves with every commit would change all three.
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { NAME, VERSION, versionText, stamp, revision, parseHead, packedRef, parseStampFile, readRevision, loadRevision } from '../version.js'
import * as M from '../builder/model.js'
import * as P from '../builder/project.js'
import { createLibrary, memoryBackend } from '../library/store.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const eq = (name, got, want) =>
    ok(name, JSON.stringify(got) === JSON.stringify(want),
        `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)

// ---- VERSION and the CHANGELOG -------------------------------------------------------------------------------------
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/
ok('VERSION is semver MAJOR.MINOR.PATCH', SEMVER.test(VERSION), VERSION)
ok('and 0.x until the user says otherwise', VERSION.startsWith('0.'), VERSION)

const log = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
const entries = [...log.matchAll(/^## (\S+) [—-] (\S+)\s*$/gm)].map(m => ({ v: m[1], date: m[2] }))
ok('the changelog has entries', entries.length > 0)
eq('its top entry is VERSION (raise version.js and add the entry in the same PR)', entries[0]?.v, VERSION)
const num = v => (SEMVER.exec(v) || []).slice(1).map(Number)
const after = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false }
for (const [i, e] of entries.entries()) {
    ok(`entry ${e.v} is semver`, SEMVER.test(e.v))
    ok(`entry ${e.v} has a real date (YYYY-MM-DD)`, /^\d{4}-\d{2}-\d{2}$/.test(e.date) && !isNaN(Date.parse(e.date)), e.date)
    if (i > 0) {
        ok(`${entries[i - 1].v} is above ${e.v}: newest first, each version once`, after(num(entries[i - 1].v), num(e.v)))
        ok(`${entries[i - 1].v} is not dated before ${e.v}`, entries[i - 1].date >= e.date)
    }
}

// ---- reading .git --------------------------------------------------------------------------------------------------
const H1 = '1819ac65e659ad2a58335a29e9b2de73ca59b93b', H2 = '57baa3fa84530daae35d09cfd2a8fb246404713c'
eq('HEAD naming a branch', parseHead('ref: refs/heads/main\n'), { ref: 'refs/heads/main' })
eq('a detached HEAD', parseHead(`${H1}\n`), { hash: H1 })
eq('an HTML page is not a HEAD', parseHead('<!DOCTYPE html><title>404</title>'), null)
eq('nor is nothing', parseHead(null), null)
const PACKED = `# pack-refs with: peeled fully-peeled sorted\n${H2} refs/heads/feature/x\n${H1} refs/heads/main\n^${H2}\n`
eq('packed-refs: the line naming the ref', packedRef(PACKED, 'refs/heads/main'), H1)
eq('packed-refs: a branch with a slash', packedRef(PACKED, 'refs/heads/feature/x'), H2)
eq('packed-refs: not there', packedRef(PACKED, 'refs/heads/other'), null)

/* A fake server: a map of paths under .git to bodies; anything else is a 404. `hang` never answers but to an abort. */
const BASE = new URL('http://localhost:8000/.git/')
const server = (files, { hang = false, html404 = false } = {}) => (url, opts = {}) => {
    if (hang) return new Promise((_, rej) => opts.signal?.addEventListener('abort', () => rej(new Error('aborted'))))
    const path = String(url).slice(String(BASE).length)
    const body = files[path]
    if (body == null) return Promise.resolve(html404 ? { ok: true, text: async () => '<html>not found</html>' } : { ok: false, text: async () => '' })
    return Promise.resolve({ ok: true, text: async () => body })
}
const read = (files, o) => readRevision({ fetch: server(files, o), base: BASE, timeoutMs: 50 })

eq('a branch whose file is there', await read({ HEAD: 'ref: refs/heads/main\n', 'refs/heads/main': `${H1}\n` }),
   { hash: H1.slice(0, 7), full: H1, branch: 'main' })
eq('a branch packed away', await read({ HEAD: 'ref: refs/heads/feature/x\n', 'packed-refs': PACKED }),
   { hash: H2.slice(0, 7), full: H2, branch: 'feature/x' })
eq('a detached HEAD', await read({ HEAD: H1 }), { hash: H1.slice(0, 7), full: H1, branch: null })
eq('no .git served', await read({}), null)
eq('a server answering every path with a page', await read({}, { html404: true }), null)
eq('a branch named nowhere', await read({ HEAD: 'ref: refs/heads/gone\n', 'packed-refs': PACKED }), null)
eq('a server that never answers: given up on, null', await read({}, { hang: true }), null)
eq('a fetch that throws', await readRevision({ fetch: () => { throw new Error('no network') }, base: BASE }), null)
eq('no fetch at all', await readRevision({ fetch: null, base: BASE }), null)

// ---- the REVISION file a deploy writes, where .git is not served (GitHub Pages) ---------------------------------------
eq('REVISION: a hash and its branch', parseStampFile(`${H1} main\n`), { hash: H1.slice(0, 7), full: H1, branch: 'main' })
eq('REVISION: a hash alone', parseStampFile(H2), { hash: H2.slice(0, 7), full: H2, branch: null })
eq('REVISION: an HTML page is not one', parseStampFile('<!DOCTYPE html><title>404</title>'), null)
eq('REVISION: nor is a short hash', parseStampFile('abc1234 main'), null)
const STAMP = new URL('http://localhost:8000/REVISION')
/* The fake server again, answering REVISION as well as paths under .git. */
const site = (files, stampText) => (url, opts) =>
    String(url) === String(STAMP) ? Promise.resolve(stampText == null ? { ok: false, text: async () => '' } : { ok: true, text: async () => stampText })
        : server(files)(url, opts)
const readSite = (files, stampText) => readRevision({ fetch: site(files, stampText), base: BASE, stampFile: STAMP, timeoutMs: 50 })
eq('no .git, a REVISION: the deployed commit', await readSite({}, `${H2} main\n`), { hash: H2.slice(0, 7), full: H2, branch: 'main' })
eq('a .git and a stale REVISION: .git wins', await readSite({ HEAD: 'ref: refs/heads/main\n', 'refs/heads/main': H1 }, `${H2} main`),
   { hash: H1.slice(0, 7), full: H1, branch: 'main' })
eq('neither: null', await readSite({}, null), null)
eq('a REVISION that is a page: null', await readSite({}, '<html>not found</html>'), null)

// ---- what is shown and stamped ---------------------------------------------------------------------------------------
eq('before the revision is known: the version alone', [versionText(), stamp(), revision()], [`${NAME} ${VERSION}`, VERSION, null])
await loadRevision({ fetch: server({ HEAD: 'ref: refs/heads/main\n', 'refs/heads/main': H1 }), base: BASE })
eq('with it: the title line', versionText(), `${NAME} ${VERSION} · ${H1.slice(0, 7)} (main)`)
eq('...and the stamp, semver build metadata', stamp(), `${VERSION}+${H1.slice(0, 7)}`)
await loadRevision({ fetch: server({ HEAD: H2 }), base: BASE })
eq('a detached checkout says so', versionText(), `${NAME} ${VERSION} · ${H2.slice(0, 7)} (detached)`)
const APP = stamp()

// ---- files: `app` written beside the format version, and never read into a document ----------------------------------
const doc = M.createDoc({ title: 'stamped' })
M.addObject(doc, 'root', { primitive: 'sphere' })
const p = P.createProject([doc])
const key = p.scenes[0].key
const keysOf = text => Object.keys(JSON.parse(text))

const sceneText = P.serializeScene(p, key, { app: APP })
eq('a scene file: app right after its version', keysOf(sceneText).slice(0, 3), ['format', 'version', 'app'])
eq('...with the stamp', JSON.parse(sceneText).app, APP)
const back = P.parse(sceneText).doc
ok('...read back, the document has no app', !('app' in back))
eq('...and is the document an unstamped file gives', back, P.parse(P.serializeScene(p, key)).doc)
ok('...as model.parse reads it too (the bundled scenes)', !('app' in M.parse(sceneText)))

const projectText = P.serialize(p, { app: APP })
eq('a project file: app right after its version', keysOf(projectText).slice(0, 3), ['format', 'version', 'app'])
ok('...read back, the project has no app', !('app' in P.parse(projectText).project))
ok('undo\'s snapshots are not stamped (serialize with no app)', !('app' in JSON.parse(P.serialize(p))))

const wsText = P.serializeWorkspace(p, key, { exposure: 1 }, { app: APP })
eq('a workspace file: app right after its version', keysOf(wsText).slice(0, 3), ['format', 'version', 'app'])
const ws = P.parse(wsText).workspace
ok('...read back, neither the workspace\'s project nor its documents have app',
   !('app' in ws.project) && ws.project.scenes.every(s => !('app' in s.doc)))

/* a file stamped twice (saved, opened, saved again) carries the newest stamp once */
eq('a stamp replaces an older one', JSON.parse(M.serialize(M.withApp({ format: 'f', version: 1, app: 'old', x: 1 }, APP))),
   { format: 'f', version: 1, app: APP, x: 1 })
eq('no app given: the object as it was', M.withApp({ format: 'f', version: 1 }, ''), { format: 'f', version: 1 })

const L = createLibrary({ model: M, backend: memoryBackend() })
await L.add({ name: 'ball', category: 'Tests', asset: M.extractAsset(doc, doc.root.children[0].id) })
const libText = await L.exportLibrary()
eq('a library file: app beside its version', [JSON.parse(libText).app, keysOf(libText).indexOf('app') === 2], [APP, true])
const other = createLibrary({ model: M, backend: memoryBackend() })
const r = await other.importLibrary(libText)
ok('...and it imports as before, the stamp not in any item', r.added === 1
   && (await other.list()).filter(i => i.source === 'mine').every(i => !('app' in i) && !('app' in (i.asset || {}))), JSON.stringify(r))

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
