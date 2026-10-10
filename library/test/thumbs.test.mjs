// node library/test/thumbs.test.mjs
//
// THE LIBRARY'S PICTURES (library/thumbs.js), without a browser or a GPU: the key follows what an item IS
// (its asset, its preview and the version), not its name; a picture is rendered once, kept, and read back rather than
// rendered again; the most recently asked for goes first; nothing renders while the host is busy; a
// render that fails is not retried every time a tile asks; and what was asked for before a renderer
// existed is rendered once one is plugged in.
import { thumbKey, createThumbs, memoryThumbs, THUMB_VERSION } from '../thumbs.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms))
const item = (name, radius) => ({ id: name, name, asset: { kind: 'node', node: { kind: 'object', params: { radius } } } })

// THE KEY
{
    const a = item('ball', 1), b = { ...item('renamed', 1) }, c = item('ball', 2)
    ok('the key ignores the name', await thumbKey(a) === await thumbKey(b))
    ok('...and follows the asset', await thumbKey(a) !== await thumbKey(c))
    ok('...and the version', await thumbKey(a) !== await thumbKey(a, THUMB_VERSION + 1))
    // what a material is shown on is part of its picture: a sample of its own is a new picture
    ok('...and what a material is shown on', await thumbKey(a) !== await thumbKey({ ...a, preview: { kind: 'node', node: { r: 1 } } }))
}

// RENDERED ONCE, KEPT, READ BACK
{
    const backend = memoryThumbs(), order = []
    // a render that takes a while, as a real one does: the others queue up behind it
    const render = async it => { order.push(it.name); await tick(15); return new Blob([it.name], { type: 'image/png' }) }
    const T = createThumbs({ backend, render })
    const arrived = []
    T.on((k, u) => arrived.push(u))
    const a = item('a', 1), b = item('b', 2), c = item('c', 3)
    ok('not kept yet: asking returns nothing at once', await T.want(a) === null)
    await T.want(b); await T.want(c)
    await tick(120)
    ok('each rendered once', order.length === 3, order.join())
    ok('the most recently asked first (after the one already started)', order[0] === 'a' && order[1] === 'c' && order[2] === 'b', order.join())
    ok('kept in the store', backend.size() === 3)
    ok('told as each arrives', arrived.length === 3)
    ok('url() has it at once now', typeof T.url(a) === 'string' && T.url(a).startsWith('blob:'))
    await T.want(a)
    ok('asked again: not rendered again', order.length === 3)
    // a second visit: a fresh instance over the same store reads it back
    const again = [], T2 = createThumbs({ backend, render: async it => { again.push(it.name); return new Blob(['x']) } })
    const url = await T2.want(item('a', 1))
    ok('a later visit reads the kept picture, renders nothing', typeof url === 'string' && again.length === 0)
}

// BUSY HOST, FAILURES, A RENDERER PLUGGED IN LATER
{
    let idle = false, n = 0
    const T = createThumbs({ render: async () => { n++; return new Blob(['p']) }, idle: () => idle, retryMs: 10 })
    await T.want(item('x', 1))
    await tick(40)
    ok('nothing renders while the host is busy', n === 0 && T.pending === 1)
    idle = true
    await tick(40)
    ok('...and it does once the host is idle', n === 1)

    let tries = 0
    const F = createThumbs({ render: async () => { tries++; throw new Error('no GPU') } })
    const bad = item('bad', 9)
    await F.want(bad); await tick(); await F.want(bad); await tick()
    ok('a render that failed is not tried again each time a tile asks', tries === 1, `tries ${tries}`)

    const L = createThumbs({ render: null })
    await L.want(item('early', 1))
    let late = 0
    L.setRender(async () => { late++; return new Blob(['p']) })
    await tick()
    ok('asked before a renderer existed: rendered once one is plugged in', late === 1)
}

// ALL(): every one now, even while the host is busy; with force, again though kept; progress to the total
{
    const backend = memoryThumbs(), made = []
    const T = createThumbs({ backend, render: async it => { made.push(it.name); return new Blob([it.name]) }, idle: () => false, retryMs: 10 })
    const xs = ['p', 'q', 'r'].map((n, i) => item(n, 10 + i))
    const seen = []
    T.onProgress(p => seen.push(`${p.done}/${p.total}`))
    await T.all(xs)
    ok('all() makes every one though the host is busy', made.join() === 'p,q,r', made.join())
    ok('...in the order given', made[0] === 'p')
    ok('...and says how far it has got, to the total', seen.at(-1) === '3/3', seen.join(' '))
    await T.all(xs)
    ok('asked again without force: nothing made again', made.length === 3)
    await T.all(xs, { force: true })
    ok('with force: made again, though kept', made.length === 6, made.join())
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
