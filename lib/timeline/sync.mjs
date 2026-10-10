#!/usr/bin/env node
//======================================================================================
// SYNC.MJS — refresh this vendored copy of TIMELINE from its canonical home.
//
//   node lib/timeline/sync.mjs --check [path-to-CODE_WOOD]   report drift, exit 1 if any
//   node lib/timeline/sync.mjs         [path-to-CODE_WOOD]   copy it over and stamp it
//
// The canonical copy is CODE_WOOD/LIBRARIES/TIMELINE, because other CODE_WOOD projects
// use it too. This copy exists so weavesim boots without reaching across repositories.
// Change the timeline THERE and run this; changing it here means the next sync silently
// reverts you, which is exactly the failure mode a vendored copy invites.
//
// The path defaults to a sibling checkout (../CODE_WOOD), which is how the two repos
// usually sit. PROVENANCE records the commit this copy was taken from, so a difference
// is always attributable to a range of commits rather than to a mystery.
//======================================================================================
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const check = args.includes('--check')
const SRCROOT = args.find(a => !a.startsWith('--')) ?? join(HERE, '../../../CODE_WOOD')
const SRC = join(SRCROOT, 'LIBRARIES/TIMELINE')
// generated or local-only; never copied and never compared
const SKIP = new Set(['sync.mjs', 'PROVENANCE'])

const walk = async (dir, base = dir, out = []) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) await walk(p, base, out)
        else if (!SKIP.has(relative(base, p))) out.push(relative(base, p))
    }
    return out
}
const read = async p => { try { return await readFile(p) } catch { return null } }

try { await stat(SRC) } catch {
    console.error(`[timeline/sync] no canonical copy at ${SRC}\n` +
        `                pass the path to your CODE_WOOD checkout as an argument.`)
    process.exit(2)
}

const srcFiles = await walk(SRC)
const dstFiles = await walk(HERE)
const all = [...new Set([...srcFiles, ...dstFiles])].sort()
const diff = []
for (const f of all) {
    const a = await read(join(SRC, f)), b = await read(join(HERE, f))
    if (!a) diff.push(['extra here   ', f])
    else if (!b) diff.push(['missing here ', f])
    else if (!a.equals(b)) diff.push(['differs      ', f])
}

if (check) {
    if (!diff.length) { console.log('[timeline/sync] in sync with', SRC); process.exit(0) }
    console.error(`[timeline/sync] ${diff.length} file(s) differ from ${SRC}:`)
    for (const [k, f] of diff) console.error(`   ${k} ${f}`)
    console.error('   run without --check to take the canonical version.')
    process.exit(1)
}

for (const f of srcFiles) {
    const a = await read(join(SRC, f))
    await mkdir(dirname(join(HERE, f)), { recursive: true })
    await writeFile(join(HERE, f), a)
}
let commit = 'unknown'
try {
    commit = execFileSync('git', ['-C', SRCROOT, 'log', '-1', '--format=%H %cs', '--', 'LIBRARIES/TIMELINE'],
        { encoding: 'utf8' }).trim()
} catch { /* not a git checkout, or git unavailable */ }
await writeFile(join(HERE, 'PROVENANCE'),
    `vendored copy of CODE_WOOD/LIBRARIES/TIMELINE\n` +
    `source commit: ${commit}\n` +
    `synced:        ${new Date().toISOString().slice(0, 10)}\n` +
    `refresh with:  node lib/timeline/sync.mjs [path-to-CODE_WOOD]\n`)
console.log(`[timeline/sync] ${srcFiles.length} files taken from ${SRC}`)
console.log(`                source commit ${commit}`)
if (diff.length) for (const [k, f] of diff) console.log(`   was ${k.trim()}: ${f}`)
