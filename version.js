//======================================================================================================================
// THE APPLICATION'S VERSION, and the exact revision it is running.
//
// VERSION is semver 0.x, raised by hand in the PR that changes the application, with an entry in CHANGELOG.md beside
// this file (CLAUDE.md, *Versions*; test/version.test.mjs holds the two to each other): MINOR for a feature or a
// file format's change, PATCH for a fix or a document. It says what a build is MEANT to be.
//
// The REVISION says exactly which code it is: the commit the server's checkout is on, read from .git at start-up.
// There is no build step to stamp it in, and the page is served from the repository's root (README, *Quick
// start*), so .git sits beside this file and is plain files: HEAD names a branch, the branch's file or packed-refs
// names the commit. GitHub Pages never serves .git, so the Pages workflow (.github/workflows/pages.yml) writes the
// commit it deployed into a file of its own, REVISION, beside this one: `<40-hex hash> <branch>`. .git is asked
// first -- a local checkout is the truth, and a stale REVISION left in one must not outvote it -- then REVISION.
// Anywhere neither is served -- a server that hides dotfiles, a worktree whose .git is a pointer -- the revision
// is unknown and only VERSION shows. Uncommitted edits are invisible here: the revision is what the checkout was
// last committed as.
//
// Why both: every number that decided anything here was measured on the user's card and pasted back by hand
// (CLAUDE.md), and a pasted number is only worth what is known about the code that made it. The benchmark already
// fingerprints its kernels (tests.js kernelFingerprint); this names the whole page, in every result, report and file.
//
//   await loadRevision()     once, before the title is drawn (index.html); never throws, gives up after a second
//   versionText()            'ShadyTracer 0.1.0 · 1819ac6 (main)' -- the title, About, Help › Report, test results
//   stamp()                  '0.1.0+1819ac6' (semver build metadata) -- what a saved file records as `app`
//======================================================================================================================

export const NAME = 'ShadyTracer'
export const VERSION = '0.49.0'

let REV = null

/** The revision once loadRevision has read it: { hash (7), full (40), branch | null }, or null. */
export const revision = () => REV

export const versionText = () =>
    `${NAME} ${VERSION}${REV ? ` · ${REV.hash}${REV.branch ? ` (${REV.branch})` : ' (detached)'}` : ''}`

export const stamp = () => REV ? `${VERSION}+${REV.hash}` : VERSION

const HASH = /^[0-9a-f]{40}$/

/** .git/HEAD's text: { ref: 'refs/heads/main' }, { hash } when detached, or null. */
export function parseHead(text) {
    const t = String(text ?? '').trim()
    const m = /^ref:\s*(refs\/\S+)$/.exec(t)
    if (m) return { ref: m[1] }
    return HASH.test(t) ? { hash: t } : null
}

/** packed-refs' text: the commit `ref` names, or null. Its lines are `<hash> <ref>`; `^` peels a tag, `#` comments. */
export function packedRef(text, ref) {
    for (const line of String(text ?? '').split('\n')) {
        const [h, r] = line.trim().split(/\s+/)
        if (r === ref && HASH.test(h)) return h
    }
    return null
}

/** A REVISION file's text (`<hash> <branch>`, the branch optional): { hash, full, branch | null }, or null. */
export function parseStampFile(text) {
    const m = /^([0-9a-f]{40})(?:[ \t]+(\S+))?\s*$/.exec(String(text ?? '').trim())
    return m ? { hash: m[1].slice(0, 7), full: m[1], branch: m[2] ?? null } : null
}

/**
 * Read the revision from `base`, the URL of a .git folder, or failing that from `stampFile`, the URL of the REVISION
 * file a deploy writes. Every failure -- a missing file, an HTML error page, a server that never answers -- is null,
 * never a throw: a page that cannot say its revision still has to start. `fetch`, `base` and `stampFile` are
 * parameters so the Node test can hand in a fake server.
 */
export async function readRevision({ fetch: get = globalThis.fetch, base = new URL('./.git/', import.meta.url),
                                     stampFile = new URL('./REVISION', import.meta.url), timeoutMs = 1000 } = {}) {
    if (typeof get !== 'function') return null
    const ctl = typeof AbortController === 'function' ? new AbortController() : null
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null
    const text = async name => {
        if (ctl?.signal.aborted) return null   // the second asks after the time is up give up too, whatever `get` does
        try {
            /* no-store: the revision is the server's NOW. A cached HEAD would name the commit of the last visit --
               the same staleness diagnose.js exists to catch in the modules. */
            const r = await get(new URL(name, base), { cache: 'no-store', signal: ctl?.signal })
            return r?.ok ? await r.text() : null
        } catch { return null }
    }
    const fromGit = async () => {
        const head = parseHead(await text('HEAD'))
        if (!head) return null
        if (head.hash) return { hash: head.hash.slice(0, 7), full: head.hash, branch: null }
        const loose = (await text(head.ref))?.trim()
        const full = HASH.test(loose ?? '') ? loose : packedRef(await text('packed-refs'), head.ref)
        if (!full) return null
        return { hash: full.slice(0, 7), full, branch: head.ref.replace(/^refs\/heads\//, '') }
    }
    try {
        return (await fromGit()) ?? (stampFile ? parseStampFile(await text(stampFile)) : null)
    } finally { if (timer) clearTimeout(timer) }
}

/** Read the revision and keep it for versionText() and stamp(). Resolves to it, or null. */
export async function loadRevision(opts) {
    REV = await readRevision(opts)
    return REV
}
