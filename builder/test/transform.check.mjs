// node builder/test/transform.check.mjs
//
// THE TRANSFORM GIZMO (2026-10-02), headless, in the real overlay over the real builder and the real camera, with a
// stand-in renderer (transform.html): one Transform mode where Move and Scale were two; a box has a stretch cube on
// each of its axes, on its arrow; a cube dragged out grows that one size and no other, writing the uniform and
// compiling nothing, and dragged back to where it began puts it exactly back; past the centre it stops short of
// nothing; Escape restores it; Ctrl snaps it to the grid's step; one drag is one undo step; a press on the arrow's
// shaft away from the cube still moves; a turned cylinder's cubes sit on its own axes, not the parent's, with "local"
// off, and its round axes move the radius, its long one the height; a sphere and a group have no cube but the circle,
// which scales them whole. THE PANEL of numbers at the top right (readout.js): the selection's position, rotation,
// scale and lengths, letting the mouse through, folded to its head by its one button; over a cube, what it would change; while a handle is held, what it has
// done and the numbers it changed; below the library's strip when there is one. Nothing else ran these: the page needs WebGPU, which this container does not have. How it
// looks and feels is the user's to judge.
//
// OPTIONAL, AND LOUD ABOUT IT, as the other checks: it needs Playwright's Chromium.
/* global CHECK -- the page's, in the evaluated functions */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execSync } from 'node:child_process'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
let chromium
try { ({ chromium } = await import('playwright')) } catch {
    try { ({ chromium } = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'playwright/index.mjs')).href)) } catch { }
}
if (!chromium) { console.log('(transform check SKIPPED: no playwright. npm i -g playwright to get it.)'); process.exit(0) }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }
const server = createServer(async (req, res) => {
    try {
        const path = join(repo, decodeURIComponent(new URL(req.url, 'http://x').pathname))
        if (!path.startsWith(repo)) throw new Error('outside')
        res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
        res.end(await readFile(path))
    } catch { res.writeHead(404); res.end() }
})
await new Promise(r => server.listen(0, r))
const b = await chromium.launch({ args: ['--disable-gpu'] })
const p = await b.newPage({ viewport: { width: 900, height: 600 } })
const errs = []
p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })
let failed = 0
const ok = (n, c, x = '') => { if (!c) failed++; console.log((c ? 'ok    ' : 'FAIL  ') + n + (c ? '' : '  ' + x)) }
const J = JSON.stringify
const eq = (n, got, want) => ok(n, J(got) === J(want), `got ${J(got)} want ${J(want)}`)
try {
    await p.goto(`http://localhost:${server.address().port}/builder/test/transform.html`)
    await p.waitForFunction(() => window.CHECK, null, { timeout: 10000 })
    const box = await p.locator('#stage').boundingBox()
    const frame = () => p.evaluate(() => CHECK.frame())
    const page = ([x, y]) => [box.x + x, box.y + y]
    const select = async id => { await p.evaluate(id => CHECK.overlay.select(id), id); await frame() }
    const hasButton = label => p.evaluate(label => [...document.querySelectorAll('button')].some(b => b.textContent.includes(label)), label)
    const click = label => p.evaluate(label => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label || b.textContent.includes(label)).click(), label)
    const compiles = () => p.evaluate(() => CHECK.compiles)
    const handles = () => p.evaluate(() => CHECK.overlay.handles.map(h => ({ ...h })))
    const handle = async name => (await handles()).find(h => h.name === name)
    const node = id => p.evaluate(id => CHECK.node(id), id)
    const uniform = k => p.evaluate(k => CHECK.state[k], k)
    const centre = async () => (await handle('view')).centre
    /** a press at `from`, moved to `to` in steps (through `via` first, if given), released; Escape or Ctrl when asked */
    const drag = async (from, to, { escape = false, ctrl = false, via = null, steps = 15 } = {}) => {
        await p.mouse.move(...from)
        if (ctrl) await p.keyboard.down('Control')
        await p.mouse.down()
        if (via) await p.mouse.move(...via, { steps })
        await p.mouse.move(...to, { steps })
        if (escape) await p.keyboard.press('Escape')
        await p.mouse.up()
        if (ctrl) await p.keyboard.up('Control')
        await frame()
    }
    const unit = (a, c) => { const l = Math.hypot(c[0] - a[0], c[1] - a[1]); return [(c[0] - a[0]) / l, (c[1] - a[1]) / l] }
    /** a cube's stage point, and one `px` farther out along the line from the centre through it */
    const outFrom = async (name, px) => {
        const O = await centre(), C = (await handle(name)).cube, u = unit(O, C)
        return [page(C), page([C[0] + u[0] * px, C[1] + u[1] * px])]
    }
    /** distance in pixels from point P to the line through A and B */
    const offLine = (P, A, B) => { const u = unit(A, B); return Math.abs((P[0] - A[0]) * u[1] - (P[1] - A[1]) * u[0]) }

    // ONE MODE: Transform, where Move and Scale were two
    await select('bx')
    ok('a Transform button; no Move, no Scale', await hasButton('Transform') && !(await hasButton('Move')) && !(await hasButton('Scale')))
    ok('the mode is transform', await p.evaluate(() => CHECK.overlay.mode) === 'transform')
    const names = (await handles()).map(h => h.name)
    ok('a box: arrows, arcs, centre, the circle and a cube per axis, all at once',
        ['x', 'y', 'z', 'rx', 'ry', 'rz', 'view', 'scale', 'sx', 'sy', 'sz'].every(n => names.includes(n)), J(names))
    {
        const x = await handle('x'), C = (await handle('sx')).cube
        const [A, T] = x.seg, along = ((C[0] - A[0]) * (T[0] - A[0]) + (C[1] - A[1]) * (T[1] - A[1])) / ((T[0] - A[0]) ** 2 + (T[1] - A[1]) ** 2)
        ok('local: the x cube on the x arrow\'s shaft, part way along', offLine(C, A, T) < 0.5 && along > 0.3 && along < 0.8, J({ C, A, T, along }))
    }
    {
        const O = await centre(), arrows = (await handles()).filter(h => ['x', 'y', 'z'].includes(h.name))
        const longest = Math.max(...arrows.map(h => Math.hypot(h.seg[1][0] - O[0], h.seg[1][1] - O[1])))
        ok('larger handles: an arrow reaches past 100 px with its head, and the circle is outside every head',
            longest > 100 && longest + 11 < 145, J({ longest }))
    }
    // THE PANEL at the top right
    const panel = () => p.evaluate(() => {
        const e = document.querySelector('.edit-readout'), s = document.getElementById('stage')
        if (!e || e.style.display === 'none') return null
        const r = e.getBoundingClientRect(), o = s.getBoundingClientRect()
        return { right: o.right - r.right, top: r.top - o.top, events: getComputedStyle(e).pointerEvents, text: e.textContent }
    })
    const model = () => p.evaluate(() => CHECK.overlay.readout.model)
    const rowOf = (m, label) => m?.rows?.find(r => r.label === label)
    const hotIn = m => (m?.rows || []).flatMap(r => r.cells.filter(c => c.hot).map(c => `${r.label}.${c.axis ?? ''}`))
    {
        const pn = await panel(), m = await model()
        ok('the panel: at the view\'s top right, letting the mouse through', pn && pn.right < 12 && pn.top < 12 && pn.events === 'none', J(pn))
        eq('...the box\'s name, position, rotation, scale and its lengths (a box\'s half size and rounding), in the scene\'s unit',
            [m.title, m.unit, m.rows.map(r => r.label)], ['box', 'm', ['position', 'rotation', 'scale', 'size', 'rounding']])
        eq('...the numbers as the document has them', [rowOf(m, 'position').cells.map(c => c.text), rowOf(m, 'size').cells.map(c => c.text)],
            [['0.0000', '0.0000', '0.0000'], ['0.5000', '0.5000', '0.5000']])
        ok('...and in the page', pn.text.includes('position') && pn.text.includes('0.5000'), pn.text)
    }
    // FOLDED to its head by its chevron, the one part of it that takes the mouse; remembered; open again
    {
        const fold = () => p.evaluate(() => document.querySelector('.edit-readout .edit-readout-fold').click())
        const btn = await p.evaluate(() => { const f = document.querySelector('.edit-readout .edit-readout-fold'); return f && getComputedStyle(f).pointerEvents })
        ok('the panel\'s fold button, taking the mouse while the panel does not', btn === 'auto', btn)
        await fold(); await frame()
        const pn = await panel()
        ok('...folded: the name and unit, none of the numbers, the panel still letting the mouse through',
            pn && pn.text.includes('box') && !pn.text.includes('position') && pn.events === 'none' && await p.evaluate(() => CHECK.overlay.readout.folded), J(pn))
        eq('...remembered', await p.evaluate(() => localStorage.getItem('raytracer.builder.edit.readout')), 'folded')
        await fold(); await frame()
        const back = await panel()
        ok('...open again: the numbers back', back?.text.includes('position') && back.text.includes('0.5000'), J(back))
        eq('...remembered open', await p.evaluate(() => localStorage.getItem('raytracer.builder.edit.readout')), 'open')
    }
    await p.mouse.move(...page((await handle('sx')).cube)); await frame()
    ok('over a cube the cursor says size', await p.evaluate(() => document.getElementById('stage').style.cursor) === 'nwse-resize')
    eq('...and the panel lights what it would change: size x', rowOf(await model(), 'size').cells.map(c => !!c.lit), [true, false, false])
    {
        // HELD: what the drag has done, the numbers it changed lit
        const [from, to] = await outFrom('sx', 40)
        await p.mouse.move(...from); await p.mouse.down(); await p.mouse.move(...to, { steps: 8 }); await frame()
        const m = await model()
        await p.keyboard.press('Escape'); await p.mouse.up(); await frame()
        ok('a cube held: size x lit and nothing else, a row of the factor', J(hotIn(m).filter(h => !h.startsWith('stretched'))) === J(['size.x'])
            && /^\u00d7 \d/.test(rowOf(m, 'stretched')?.cells[0].text), J(m.rows))
        ok('...let go (Escape): no drag row, nothing lit', !rowOf(await model(), 'stretched') && hotIn(await model()).length === 0)
        const x = await handle('x'), [A, T] = x.seg, at = [A[0] + (T[0] - A[0]) * 0.85, A[1] + (T[1] - A[1]) * 0.85], u = unit(A, T)
        await p.mouse.move(...page(at)); await p.mouse.down(); await p.mouse.move(...page([at[0] + u[0] * 30, at[1] + u[1] * 30]), { steps: 8 }); await frame()
        const mv = await model()
        await p.keyboard.press('Escape'); await p.mouse.up(); await frame()
        ok('the x arrow held: position x lit, a row of the move', J(hotIn(mv).filter(h => !h.startsWith('moved'))) === J(['position.x'])
            && rowOf(mv, 'moved')?.cells[0].text.startsWith('+'), J(mv.rows))
    }
    {
        // UNDER THE LIBRARY'S STRIP, when an item is being edited (library/edit.js puts it at the top right)
        await p.evaluate(() => {
            const s = document.createElement('div')
            s.className = 'shell-edit-strip'
            Object.assign(s.style, { position: 'absolute', top: '8px', right: '8px', height: '30px', width: '200px' })
            document.getElementById('stage').appendChild(s)
        })
        await frame()
        const below = await panel()
        await p.evaluate(() => document.querySelector('.shell-edit-strip').remove()); await frame()
        const back = await panel()
        ok('with the library\'s strip there, the panel below it; gone, back up', below.top >= 8 + 30 + 6 - 0.5 && back.top < 12, J({ below, back }))
    }

    // A CUBE DRAGGED OUT: its size grows, no other, live
    const c0 = await compiles(), bx0 = await node('bx')
    {
        const [from, to] = await outFrom('sx', 40)
        await drag(from, to)
    }
    let bx = await node('bx')
    ok('sx out: size.x grew', bx.params.size.x > bx0.params.size.x * 1.1, J(bx.params.size))
    ok('...size.y and size.z as they were, the rounding too', bx.params.size.y === bx0.params.size.y && bx.params.size.z === bx0.params.size.z
        && bx.params.rounding === bx0.params.rounding, J(bx.params))
    ok('...the transform untouched', J(bx.transform) === J(bx0.transform), J(bx.transform))
    ok('...the uniform written, nothing compiled', J(await uniform('size_bx')) === J(bx.params.size) && await compiles() === c0,
        J({ u: await uniform('size_bx'), c0, c: await compiles() }))

    // BACK TO WHERE IT BEGAN: exactly back
    {
        const before = (await node('bx')).params.size, [from, to] = await outFrom('sx', 50)
        await drag(from, from, { via: to })
        ok('sx out and back to the press: size.x exactly as before', J((await node('bx')).params.size) === J(before), J((await node('bx')).params.size))
    }
    // PAST THE CENTRE: as small as it goes, never nothing
    {
        // drags under one key within 800 ms are one undo step (history.js), as a slider's are: this one stands alone
        await p.waitForTimeout(900)
        const before = (await node('bx')).params.size.x, O = await centre(), [from] = await outFrom('sx', 0)
        const u = unit(from, page(O))
        await drag(from, [from[0] + u[0] * 200, from[1] + u[1] * 200])
        const v = (await node('bx')).params.size.x
        ok('sx dragged through the centre: size.x small but more than nothing', v > 0 && v <= before * 0.0101 + 1e-9, J({ before, v }))
        await p.evaluate(() => CHECK.B.undo())
        await frame()
        ok('...and one undo puts it back', (await node('bx')).params.size.x === before, J((await node('bx')).params.size))
    }
    // ESCAPE puts it back
    {
        const before = await node('bx'), [from, to] = await outFrom('sz', 40)
        await drag(from, to, { escape: true })
        const after = await node('bx')
        ok('sz out, Escape: the size as it was, and the uniform', J(after.params) === J(before.params) && J(await uniform('size_bx')) === J(before.params.size),
            J({ before: before.params, after: after.params }))
    }
    // CTRL snaps a size to the grid's step at the node
    {
        const step = await p.evaluate(() => CHECK.stepAt('bx')), [from, to] = await outFrom('sy', 37)
        await drag(from, to, { ctrl: true })
        const v = (await node('bx')).params.size.y, n = v / step
        ok('sy with Ctrl: size.y a whole number of grid steps', Math.abs(n - Math.round(n)) < 1e-6 && v !== 0.5, J({ v, step }))
    }
    // THE SHAFT AWAY FROM THE CUBE still moves
    {
        const before = await node('bx'), x = await handle('x'), [A, T] = x.seg
        const at = [A[0] + (T[0] - A[0]) * 0.85, A[1] + (T[1] - A[1]) * 0.85], u = unit(A, T)
        await drag(page(at), page([at[0] + u[0] * 30, at[1] + u[1] * 30]))
        const after = await node('bx')
        ok('the x arrow near its head: pos.x moved, the sizes did not', after.transform.pos.x > before.transform.pos.x + 0.01
            && J(after.params) === J(before.params), J({ pos: after.transform.pos, size: after.params.size }))
        await p.evaluate(() => CHECK.B.undo()); await frame()
    }

    // CTRL SNAPS A MOVE to the grid at the node, the one the Points mode snaps to, and the panel says the step
    {
        await p.waitForTimeout(900)                       // a step of its own in the history
        const step = await p.evaluate(() => CHECK.stepAt('bx', { parent: true })), x = await handle('x'), [A, T] = x.seg
        const at = [A[0] + (T[0] - A[0]) * 0.85, A[1] + (T[1] - A[1]) * 0.85], u = unit(A, T)
        const note = (await model()).notes.map(n => n.text).join(' ')
        ok('the panel says the grid Ctrl snaps to', note.includes(`grid ${step} -- Ctrl snaps moves and sizes to it`), note)
        await drag(page(at), page([at[0] + u[0] * 37, at[1] + u[1] * 37]), { ctrl: true })
        const v = (await node('bx')).transform.pos.x, n = v / step
        ok('the x arrow with Ctrl: pos.x a whole number of grid steps -- here not 0.1, the fixed step it was', step !== 0.1 && v !== 0
            && Math.abs(n - Math.round(n)) < 1e-9, J({ v, step }))
        await p.evaluate(() => CHECK.B.undo()); await frame()
    }

    // A RECTANGLE LIGHT: its width in x, its height in y, no thickness (lights.js)
    await select('lamp')
    {
        const n = (await handles()).map(h => h.name)
        ok('a rectangle light: cubes in x and y, none in z', n.includes('sx') && n.includes('sy') && !n.includes('sz'), J(n))
        const l0 = await node('lamp'), [from, to] = await outFrom('sx', 40)
        await drag(from, to)
        const l1 = await node('lamp')
        ok('...sx: its width grew, its height as it was, nothing compiled', l1.params.width > l0.params.width * 1.1 && l1.params.height === l0.params.height
            && await compiles() === c0, J(l1.params))
        ok('...the panel shows its width and height, which are not marked lengths', !!rowOf(await model(), 'width') && !!rowOf(await model(), 'height'))
    }

    // A TURNED CYLINDER, the arrows along the parent's axes: its cubes on its own
    await select('cy')
    await click('local'); await frame()
    {
        const O = await centre(), own = await p.evaluate(() => [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(e => CHECK.screenOf('cy', e)))
        const cz = (await handle('sz')).cube, z = await handle('z')
        ok('local off: the z cube on the cylinder\'s own z, not on the parent\'s z arrow', offLine(cz, O, own[2]) < 0.5 && offLine(cz, z.seg[0], z.seg[1]) > 5,
            J({ cz, own: own[2], z: z.seg }))
        const cy0 = await node('cy'), [from, to] = await outFrom('sz', 40)
        await drag(from, to)
        const cy1 = await node('cy')
        ok('sz: the height grew, the radius as it was', cy1.params.height > cy0.params.height * 1.1 && cy1.params.radius === cy0.params.radius, J(cy1.params))
        const [f2, t2] = await outFrom('sx', 40)
        await drag(f2, t2)
        const cy2 = await node('cy')
        ok('sx: the radius grew, the height as it was', cy2.params.radius > cy1.params.radius * 1.1 && cy2.params.height === cy1.params.height, J(cy2.params))
        ok('...nothing compiled for any of it', await compiles() === c0)
    }
    await click('local'); await frame()

    // NO SIZES: a sphere and a group -- no cube, but the circle
    for (const id of ['ball', 'grp']) {
        await select(id)
        const n = (await handles()).map(h => h.name)
        ok(`${id}: no cube, the circle`, !n.some(k => ['sx', 'sy', 'sz'].includes(k)) && n.includes('scale'), J(n))
    }
    {
        const O = await centre(), C = (await handle('scale')).circle, from = page([O[0] + 145, O[1]]), to = page([O[0] + 190, O[1]])
        ok('the circle at the centre', Math.hypot(C[0] - O[0], C[1] - O[1]) < 1e-6)
        const s0 = (await node('grp')).transform.scale
        await drag(from, to)
        const s1 = (await node('grp')).transform.scale
        ok('the circle dragged out: the group scaled up, as 190/145', Math.abs(s1 - s0 * 190 / 145) < 0.02, J({ s0, s1 }))
        await drag(from, to, { escape: true })
        ok('...and again with Escape: as it was', (await node('grp')).transform.scale === s1)
    }

    // LOCKED (model.js setLock; the user, 2026-10-02): what a lock holds is not drawn, so a press there grabs nothing
    await select('bx')
    await p.waitForTimeout(900)                          // a drag of its own, not merged with the box's last (history.js)
    const setLock = (k, on) => p.evaluate(([k, on]) => CHECK.M.setLock(CHECK.B.doc, 'bx', k, on), [k, on])
    const names2 = async () => (await handles()).map(h => h.name)
    const MOVES = ['x', 'y', 'z', 'xy', 'yz', 'zx', 'view', 'rx', 'ry', 'rz'], SIZES = ['sx', 'sy', 'sz', 'scale']
    {
        // A LOCK THAT COMES ON WHILE A HANDLE IS HELD (an undo, a script): the drag writes nothing more
        const x = await handle('x'), [A, T] = x.seg, at = [A[0] + (T[0] - A[0]) * 0.85, A[1] + (T[1] - A[1]) * 0.85], u = unit(A, T)
        const p0 = (await node('bx')).transform.pos
        await p.mouse.move(...page(at)); await p.mouse.down()
        await p.mouse.move(...page([at[0] + u[0] * 20, at[1] + u[1] * 20]), { steps: 5 }); await frame()
        const p1 = (await node('bx')).transform.pos
        await setLock('position', true)
        await p.mouse.move(...page([at[0] + u[0] * 60, at[1] + u[1] * 60]), { steps: 5 })
        await p.mouse.up(); await frame()
        const p2 = (await node('bx')).transform.pos
        ok('held when the position locks: it had moved, and moves no further', p1.x !== p0.x && J(p2) === J(p1), J({ p0, p1, p2 }))
    }
    {
        const n = await names2(), pn = await panel()
        ok('position locked: no arrow, square, centre or arc; the cubes and the circle stay', !n.some(k => MOVES.includes(k)) && SIZES.every(k => n.includes(k)), J(n))
        ok('...and the panel says what is locked', pn?.text.includes('locked: position and rotation'), pn?.text)
    }
    await setLock('params', true); await frame()
    eq('its parameters locked too: no handle at all', await names2(), [])
    await setLock('position', false); await frame()
    {
        const n = await names2()
        ok('parameters alone: the arrows, arcs and centre back; no cube, no circle',
            ['x', 'y', 'z', 'rx', 'ry', 'rz', 'view'].every(k => n.includes(k)) && !n.some(k => SIZES.includes(k)), J(n))
    }
    await setLock('params', false); await frame()
    {
        const n = await names2()
        ok('unlocked: every handle back', ['x', 'y', 'z', 'rx', 'ry', 'rz', 'view', 'scale', 'sx', 'sy', 'sz'].every(k => n.includes(k)), J(n))
    }
    {
        // A PRESS WHERE THE ARROW WAS, locked: the box stays (the press is the camera's, so this goes last)
        const x = await handle('x'), [A, T] = x.seg, at = [A[0] + (T[0] - A[0]) * 0.85, A[1] + (T[1] - A[1]) * 0.85], u = unit(A, T)
        await setLock('position', true); await frame()
        const t0 = (await node('bx')).transform
        await drag(page(at), page([at[0] + u[0] * 40, at[1] + u[1] * 40]))
        ok('locked: a drag where the x arrow was moves nothing', J((await node('bx')).transform) === J(t0), J((await node('bx')).transform))
        await setLock('position', false)
    }
    ok('no page errors', errs.length === 0, J(errs))
} catch (e) {
    failed++
    console.log('FAIL  threw: ' + (e?.stack || e))
} finally {
    await b.close()
    server.close()
}
console.log(failed ? `\n${failed} FAILED` : '\ntransform check: all passed')
process.exit(failed ? 1 : 0)
