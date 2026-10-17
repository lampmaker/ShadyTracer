// node workspace/test/scenepics.test.mjs
//
// The scenes' pictures (workspace/scenepics.js, 0.63.0), no browser: kept per project and scene, a picture and a time to
// open each kept when the other is put, read back from the store on first asking and told when it arrives, a project's
// pictures gone with it; a copy not yet kept in memory only. And when a picture is taken: once it has settled -- the
// scene shown, nothing compiling, moving or rendered offscreen, 32 samples -- once per start of the picture, never for a
// library item, and never labelled with a scene switched to during the read.
import { createScenePics, memoryPics, startCapture } from '../scenepics.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const tick = () => new Promise(r => setTimeout(r, 0))

{
    const backend = memoryPics()
    let n = 0
    const made = [], revoked = []
    const P = createScenePics({ backend, url: b => { made.push(b); return `url${++n}` }, revoke: u => revoked.push(u), now: () => 7 })
    let told = 0
    P.on(() => told++)
    ok('nothing kept: null', P.get('p1', 's1') === null)
    await P.put('p1', 's1', { blob: 'png-a' })
    ok('a picture put: its url, when', JSON.stringify(P.get('p1', 's1')) === JSON.stringify({ url: 'url1', openMs: null, at: 7 }) && told === 1)
    await P.put('p1', 's1', { openMs: 6200 })
    ok('a time to open put: the picture kept', P.get('p1', 's1').url === 'url1' && P.get('p1', 's1').openMs === 6200)
    await P.put('p1', 's1', { blob: 'png-b' })
    ok('a new picture: a new url, the old one let go, the time kept', P.get('p1', 's1').url === 'url2' && revoked.includes('url1') && P.get('p1', 's1').openMs === 6200)
    ok('kept in the store under the project and the scene', JSON.stringify(await backend.get('p1:s1')) === JSON.stringify({ blob: 'png-b', openMs: 6200, at: 7 }))
    // another page reads what this one kept: asked, it comes from the store and is told
    const Q = createScenePics({ backend, url: b => `fresh-${b}`, revoke: () => { } })
    let heard = 0
    Q.on(() => heard++)
    ok('another page: nothing at first asking', Q.get('p1', 's1') === null)
    await tick(); await tick()
    ok('...then read from the store, and told', heard === 1 && Q.get('p1', 's1').url === 'fresh-png-b' && Q.get('p1', 's1').openMs === 6200)
    ok('...scene keys apart by project', Q.get('p2', 's1') === null)
    await P.put('p2', 's1', { blob: 'other' })
    await P.removeProject('p1')
    ok('a project deleted: its pictures gone, from memory and the store', P.get('p1', 's1') === null && (await backend.keys('p1:')).length === 0)
    ok('...another project\'s kept', (await backend.keys('p2:')).length === 1)
    // a copy not yet kept (no id): in memory only
    await P.put(null, 's3', { blob: 'copy' })
    ok('a copy not yet kept: in memory, not the store', P.get(null, 's3')?.url && (await backend.keys('~:')).length === 0)
}

{
    // WHEN A PICTURE IS TAKEN
    const S = { resets: 1, samples: 40, busy: false, off: false, moving: false }
    let asked = 0
    const RT = {
        resets: () => S.resets, hud: { get samples() { return S.samples } }, sceneBusy: () => S.busy, offscreenBusy: () => S.off,
        interacting: { active: () => S.moving }, thumbnail: async () => { asked++; return `pic${asked}` },
    }
    const BUILDER = { current: 's1', showing: true, applying: false, doc: {} }
    const put = []
    const pics = { put: async (pid, key, v) => put.push(`${pid}:${key}:${v.blob}`) }
    const C = startCapture({ RT, BUILDER, pics, project: () => 'p1', timer: false })
    ok('a settled picture is taken', await C.tick() === true && put.at(-1) === 'p1:s1:pic1')
    ok('...once: the same picture is not taken again', await C.tick() === false && asked === 1)
    S.resets++
    S.samples = 10
    ok('the picture started over: not before 32 samples', await C.tick() === false && asked === 1)
    S.samples = 32
    ok('...then taken again', await C.tick() === true && asked === 2)
    S.resets++
    for (const [what, set, unset] of [['compiling', () => { S.busy = true }, () => { S.busy = false }],
                                      ['rendered offscreen', () => { S.off = true }, () => { S.off = false }],
                                      ['moving', () => { S.moving = true }, () => { S.moving = false }],
                                      ['not shown', () => { BUILDER.showing = false }, () => { BUILDER.showing = true }],
                                      ['applying', () => { BUILDER.applying = true }, () => { BUILDER.applying = false }],
                                      ['a library item', () => { BUILDER.doc = { libraryItem: {} } }, () => { BUILDER.doc = {} }]]) {
        set()
        ok(`none while ${what}`, await C.tick() === false && asked === 2)
        unset()
    }
    // switched to another scene during the read: not kept, under either name
    RT.thumbnail = async () => { asked++; BUILDER.current = 's2'; S.resets++; return 'late' }
    ok('a scene switched to during the read: the picture is not kept', await C.tick() === false && !put.some(p => p.includes('late')))
    BUILDER.current = 's1'
    RT.thumbnail = async () => { throw new Error('lost device') }
    S.resets++
    const warn = console.warn; console.warn = () => { }
    ok('a picture that fails is not asked for again until the picture starts over', await C.tick() === false && await C.tick() === false)
    console.warn = warn
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
