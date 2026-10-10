// node builder/test/points.check.mjs
//
// THE POINTS MODE (2026-10-02), headless, in the real overlay over the real builder and the real camera, with a stand-in
// renderer (points.html): the mode offered only for an object with a path or a profile; entering it compiles the path
// live once and leaving compiles it back; a dot clicked is selected; an arrow dragged moves its own number and no
// other, writing uniforms and compiling nothing; a coordinate written as a name moves the parameter, held in its range,
// the text still the name; a drag that would make the path unsound stops where it last was sound and says why;
// Delete and + take a point away and put one in, and a path at two points keeps them; typed entry keeps an
// expression and says what it refuses; the fillet's diamond stops at the largest that fits; Escape puts a drag back;
// a click on nothing lets the point go without picking; the plane view looks square at a revolve's plane and back
// puts the camera exactly where it was. Nothing else ran these: the page needs WebGPU, which this container does not
// have. Whether the picture follows, and how it feels, is the user's to judge.
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
if (!chromium) { console.log('(points check SKIPPED: no playwright. npm i -g playwright to get it.)'); process.exit(0) }

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
try {
    await p.goto(`http://localhost:${server.address().port}/builder/test/points.html`)
    await p.waitForFunction(() => window.CHECK, null, { timeout: 10000 })
    const box = await p.locator('#stage').boundingBox()
    const frame = () => p.evaluate(() => CHECK.frame())
    const page = ([x, y]) => [box.x + x, box.y + y]
    const select = async id => { await p.evaluate(id => CHECK.overlay.select(id), id); await frame() }
    const shown = label => p.evaluate(label => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes(label)); return b ? b.style.display !== 'none' && getComputedStyle(b.parentElement).display !== 'none' : false }, label)
    const click = label => p.evaluate(label => [...document.querySelectorAll('button')].find(b => b.textContent.includes(label)).click(), label)
    const compiles = () => p.evaluate(() => CHECK.compiles)
    const until = async (fn, arg) => { await p.waitForFunction(fn, arg, { timeout: 5000 }); await frame() }
    const handles = () => p.evaluate(() => CHECK.overlay.points.handles)
    const selected = () => p.evaluate(() => CHECK.overlay.points.selected)
    const route = () => p.evaluate(() => CHECK.list('tb', 'route').path)
    const dotAt = async (id, local) => page(await p.evaluate(([id, l]) => CHECK.screenOf(id, l), [id, local]))
    /** a press at `from`, moved to `to` in steps, released; Escape before the release when asked */
    const drag = async (from, to, { escape = false, steps = 20 } = {}) => {
        await p.mouse.move(...from); await p.mouse.down()
        await p.mouse.move(...to, { steps })
        if (escape) await p.keyboard.press('Escape')
        await p.mouse.up(); await frame()
    }
    /** where point i of a node's path or profile is on the page NOW, as the document resolves it */
    const pointAt = async (id, k, i) => page(await p.evaluate(([id, k, i]) => {
        const node = CHECK.M.viewOf(CHECK.B.doc, CHECK.M.find(CHECK.B.doc, id).node), t = CHECK.E.pointTargets(node).find(t => t.k === k)
        const pt = CHECK.E.pointsOf(node, t).points[i]
        return CHECK.screenOf(id, CHECK.E.localOf(t, CHECK.E.planeOf(node, t), pt.slice(0, t.kind === 'path' ? 3 : 2)))
    }, [id, k, i]))
    const arrow = async j => (await handles()).find(h => h.kind === 'axis' && h.j === j)
    /** from the middle of arrow j, `px` pixels along it (negative: back along it) */
    const alongArrow = async (j, px) => {
        const h = await arrow(j)
        if (!h) return null
        const [a, c] = h.seg, l = Math.hypot(c[0] - a[0], c[1] - a[1]), u = [(c[0] - a[0]) / l, (c[1] - a[1]) / l]
        const m = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]
        return [page(m), page([m[0] + u[0] * px, m[1] + u[1] * px])]
    }

    // OFFERED ONLY WHERE THERE ARE POINTS
    await select('ball')
    ok('a sphere: no Points button', !(await shown('Points')))
    await select('tb')
    ok('the bent tube: a Points button', await shown('Points'))
    const legsPill = () => p.evaluate(() => { const b = document.querySelector('#bar button'); return b ? getComputedStyle(b.parentElement).display !== 'none' : null })
    eq('...the legs switch on the view\'s toolbar: not there outside the Points mode', await legsPill(), false)
    const c0 = await compiles()
    await click('Points')
    await until(n => CHECK.compiles > n, c0)
    ok('Points entered: the compiled path compiled once, live (forced)', await p.evaluate(() => CHECK.overlay.mode === 'points' && CHECK.B.editingPoints === 'tb.route'
        && CHECK.RT.scene.pointParams.find(P => P.k === 'route')?.forced === true), J(await p.evaluate(() => CHECK.RT.scene.pointParams)))
    ok('...the local switch is hidden: points move along the object\'s own axes', !(await shown('local')))

    // A DOT CLICKED
    await p.mouse.click(...await dotAt('tb', [0.5, -0.5, 0]))
    await frame()
    eq('point 2 clicked: selected', await selected(), 1)
    const arrows = (await handles()).filter(h => h.kind === 'axis').map(h => h.j)
    ok('...its arrows: x, y and z', J(arrows) === J([0, 1, 2]), J(arrows))
    {
        // THE TRANSFORM GIZMO AT THE POINT (gizmodraw.js): its centre ring and plane squares too; no arcs, cubes or circle
        // of its own -- the section's are a gizmo apart (kind 'value')
        const hs = await handles(), names = hs.filter(h => h.kind !== 'value').map(h => h.name)
        ok('...the Transform gizmo: the centre ring and plane squares too, and no arcs, cubes or circle of its own',
            hs.some(h => h.kind === 'dot' && h.name === 'view') && hs.some(h => h.kind === 'plane') && !names.some(n => /^(r[xyz]|s[xyz]|scale)$/.test(n)), J(names))
        /* A TUBE'S SECTION (2026-10-02, "tube: scale, so change diameter per point"): the circle alone -- a tube reads scale
           x only -- dragged out, the point's scale x written live with no compile; Escape puts it back */
        const vh = hs.filter(h => h.kind === 'value')
        eq('...its section: the circle alone, the tube\'s diameter', vh.map(h => h.how), ['diameter'])
        const O = vh[0]?.circle
        let on = null
        for (let a = 0; O && a < 360 && !on; a += 10) {
            const q = [O[0] + 145 * Math.cos(a * Math.PI / 180), O[1] + 145 * Math.sin(a * Math.PI / 180)]
            if (q[0] > 20 && q[0] < 780 && q[1] > 20 && q[1] < 480 && (await p.evaluate(([x, y]) => CHECK.overlay.points.hit(x, y)?.how, q)) === 'diameter') on = q
        }
        ok('...a place on it that is that handle', !!on, J(O))
        if (on) {
            const before = (await route())[1], cT = await compiles(), u0 = await p.evaluate(() => JSON.stringify(Object.entries(CHECK.state).filter(([k]) => k.startsWith('_pv'))))
            const out = [O[0] + (on[0] - O[0]) * 1.4, O[1] + (on[1] - O[1]) * 1.4]
            await p.mouse.move(...page(on)); await p.mouse.down(); await p.mouse.move(...page(out), { steps: 10 }); await frame()
            const during = (await route())[1], uDuring = await p.evaluate(() => JSON.stringify(Object.entries(CHECK.state).filter(([k]) => k.startsWith('_pv'))))
            const rows = await p.evaluate(() => CHECK.overlay.points.readout?.rows?.find(r => r.label === 'scale')?.cells.map(c => !!c.hot))
            await p.keyboard.press('Escape'); await p.mouse.up(); await frame()
            ok('the circle dragged 1.4 times as far out: scale x 1.4 written after the fillet, live, no compile',
                Math.abs(during[4] - 1.4) < 0.02 && J(during.slice(0, 4)) === J(before.slice(0, 4)) && uDuring !== u0 && await compiles() === cT, J({ before, during }))
            eq('...the scale lit in the panel while held', rows, [true])
            eq('...Escape: put back', (await route())[1], before)
        }
        // A SQUARE held: its two coordinates move, the third exactly as it was; Escape puts it back
        const sq = hs.find(h => h.kind === 'plane' && h.quad), before = (await route())[1]
        const mid = sq && [(sq.quad[0][0] + sq.quad[2][0]) / 2, (sq.quad[0][1] + sq.quad[2][1]) / 2]
        const under = mid && await p.evaluate(([x, y]) => CHECK.overlay.points.hit(x, y)?.kind, mid)
        eq('...a square\'s middle is that square', under, 'plane')
        if (sq) {
            await p.mouse.move(...page(mid)); await p.mouse.down(); await p.mouse.move(...page([mid[0] + 25, mid[1] + 18]), { steps: 8 }); await frame()
            const during = (await route())[1]
            await p.keyboard.press('Escape'); await p.mouse.up(); await frame()
            const third = [0, 1, 2].find(j => !sq.js.includes(j))
            ok(`a square (${sq.name}) held: its two coordinates moved, the third exactly as it was`,
                during[third] === before[third] && sq.js.some(j => during[j] !== before[j]), J({ before, during, js: sq.js }))
            eq('...Escape: put back', (await route())[1], before)
        }
    }
    {
        // EVERY POINT'S LEGS, behind a switch on the view's toolbar (off by default): the selected point's twice as thick
        eq('the legs switch shown while points are edited', await legsPill(), true)
        const widths = () => p.evaluate(() => Object.fromEntries(CHECK.overlay.points.legs.map(l => [l.i, l.width])))
        eq('...off: the selected point\'s legs only, twice as thick', await widths(), { 1: 2 })
        await p.evaluate(() => document.querySelector('#bar button').click()); await frame()
        eq('...on: every point with one before it, the selected twice as thick', await widths(), { 1: 2, 2: 1, 3: 1 })
        ok('...remembered', await p.evaluate(() => localStorage.getItem('raytracer.builder.edit.legs')) === 'on')
        await p.evaluate(() => document.querySelector('#bar button').click()); await frame()
        eq('...off again', [await widths(), await p.evaluate(() => localStorage.getItem('raytracer.builder.edit.legs'))], [{ 1: 2 }, 'off'])
    }
    // ITS NUMBERS in the panel at the top right (readout.js), which never takes the mouse
    const panel = () => p.evaluate(() => {
        const e = document.querySelector('.edit-readout'), s = document.getElementById('stage')
        if (!e || e.style.display === 'none') return null
        const r = e.getBoundingClientRect(), o = s.getBoundingClientRect()
        return { right: o.right - r.right, top: r.top - o.top, events: getComputedStyle(e).pointerEvents, text: e.textContent,
                 entry: !!e.querySelector('.points-entry') }
    })
    {
        const pn = await panel(), m = await p.evaluate(() => CHECK.overlay.points.readout)
        const x = await p.evaluate(() => CHECK.E.fmt(CHECK.E.pointsOf(CHECK.M.find(CHECK.B.doc, 'tb').node, CHECK.E.pointTargets(CHECK.M.find(CHECK.B.doc, 'tb').node)[0]).points[1][0]))
        ok('the selected point\'s numbers in the panel at the view\'s top right, its x among them',
            pn && pn.right < 12 && pn.top < 12 && m?.rows?.[0]?.label === 'point 2' && m.rows[0].cells[0].text === x && pn.text.includes(x), J({ pn, row: m?.rows?.[0], x }))
        ok('...which lets the mouse through: it covers no handle', pn?.events === 'none', pn?.events)
    }

    // AN ARROW: its own number and no other, live
    const before = await route(), c1 = await compiles(), u0 = await p.evaluate(() => JSON.stringify(Object.entries(CHECK.state).filter(([k]) => k.startsWith('_pp'))))
    await drag(...await alongArrow(0, 40))
    const after = await route()
    ok('the x arrow dragged: x moved, y, z and the fillet exactly as they were, every other point as it was',
        after[1][0] !== before[1][0] && after[1][1] === before[1][1] && after[1][2] === before[1][2] && after[1][3] === before[1][3]
        && J(after.filter((_, i) => i !== 1)) === J(before.filter((_, i) => i !== 1)), J([before[1], after[1]]))
    ok('...written to the renderer as uniforms, with no compile', await compiles() === c1
        && await p.evaluate(u0 => JSON.stringify(Object.entries(CHECK.state).filter(([k]) => k.startsWith('_pp'))) !== u0, u0))
    {
        // while held: the number it moves lit in the panel, and no other
        const [from, to] = await alongArrow(0, 30)
        await p.mouse.move(...from); await p.mouse.down(); await p.mouse.move(...to, { steps: 8 }); await frame()
        const lit = await p.evaluate(() => CHECK.overlay.points.readout?.rows?.[0]?.cells.map(c => !!c.hot))
        await p.keyboard.press('Escape'); await p.mouse.up(); await frame()
        eq('...held: x lit in the panel, y and z not', lit, [true, false, false])
        eq('...Escape: put back as it was after the drag before', (await route())[1], after[1])
    }

    // A NAME: the parameter moves, in its range; the text stays the name
    await p.mouse.click(...await dotAt('tb', [0.5, 0.5, 0.6]))
    await frame()
    eq('point 4 selected', await selected(), 3)
    await drag(...await alongArrow(2, 600), { steps: 40 })
    const rise = await p.evaluate(() => CHECK.list('tb', 'rise'))
    ok('its z, written "rise", dragged far up: rise is 1, its slider\'s max, and the point still says rise',
        rise === 1 && (await route())[3][2] === 'rise', J([rise, (await route())[3]]))
    eq('...and the renderer has it', await p.evaluate(() => CHECK.state.rise_tb), 1)

    // UNSOUND: held where it last was sound, and said. Point 3 dragged along y onto point 2's y: the path would run
    // +x to point 2 and straight back -x to point 3 -- it turns back on itself, which pathPieces refuses. (Dragged on
    // PAST that, to where it is sound again, it would go there: a refusal holds only while the place is unsound.)
    await p.mouse.click(...await dotAt('tb', [0.5, 0.5, 0]))
    await frame()
    const [from] = await alongArrow(1, 0), onto = await dotAt('tb', [0.5, -0.5, 0])
    await drag(from, onto, { steps: 60 })
    const y3 = (await route())[2][1], said = await p.evaluate(() => CHECK.overlay.points.said)
    ok('point 3 dragged onto point 2\'s y, where the path would turn back: held short of it, and said',
        y3 > -0.45 && y3 < 0.5 && /turns back|fillet/.test(said ?? ''), J([y3, said]))
    ok('...the path sound as it stands', await p.evaluate(() => CHECK.E.pointsOf(CHECK.M.find(CHECK.B.doc, 'tb').node, { k: 'route', kind: 'path' }).problems.length === 0))

    // ESCAPE puts a drag back
    const held = await route()
    await drag(...await alongArrow(0, 50), { escape: true })
    eq('a drag with Escape before the release: the points as they were', await route(), held)

    // DELETE AND +
    await p.mouse.click(...await pointAt('tb', 'route', 2))
    await frame()
    const cAdd = await compiles()
    await p.keyboard.press('Delete'); await frame()
    eq('Delete: point 3 taken away', (await route()).length, 3)
    await p.keyboard.press('+'); await frame()
    const r4 = await route()
    ok('+: a point put after the selected one (the last now: past it by the last edge)', r4.length === 4 && await selected() === 3, J(r4))
    await p.keyboard.press('+'); await frame()
    await p.keyboard.press('+'); await frame()
    const r6 = await route()
    ok('...and two more: six points, and none of it compiled (2026-10-02: room for points more while edited)', r6.length === 6 && await compiles() === cAdd,
        J({ n: r6.length, compiles: await compiles() - cAdd }))
    await p.keyboard.press('Delete'); await frame()
    await p.keyboard.press('Delete'); await frame()

    // THE FILLET'S DIAMOND
    await p.mouse.click(...await pointAt('tb', 'route', 1))
    await frame()
    eq('point 2 selected again', await selected(), 1)
    const fh = (await handles()).find(h => h.kind === 'fillet'), dp = await pointAt('tb', 'route', 1)
    ok('point 2 has a fillet\'s diamond', !!fh)
    if (fh) {
        const at = page(fh.at), out = [at[0] + (at[0] - dp[0]) * 30, at[1] + (at[1] - dp[1]) * 30]
        await drag(at, out, { steps: 40 })
        const { f, rMax } = await p.evaluate(() => {
            const node = CHECK.M.find(CHECK.B.doc, 'tb').node, t = { k: 'route', kind: 'path' }
            const r = CHECK.E.pointsOf(node, t)
            return { f: r.points[1][3], rMax: CHECK.E.cornerOf(t, null, r.points.map((q, i) => i === 1 ? q.slice(0, 3) : q), 1).rMax }
        })
        ok('...dragged far out: the largest fillet that fits, and no more', Math.abs(f - rMax) < 1e-6, J({ f, rMax }))
    }

    // TYPED: as written, and what is refused is said
    await p.keyboard.press('Enter'); await frame()
    {
        const pn = await panel()
        ok('Enter: the typed entry opens in the panel, in place of the numbers, and takes the mouse while it is open',
            pn?.entry && pn.events === 'auto' && !/grid .* Ctrl snaps/.test(pn.text), J(pn))
    }
    const x2 = await p.evaluate(() => String(CHECK.list('tb', 'route').path[1][0]))
    ok('Enter: the typed entry, its x as written', await p.evaluate(x2 => document.querySelector('.points-entry input[data-entry="0"]')?.value === x2, x2), x2)
    await p.fill('.points-entry input[data-entry="0"]', 'nope / 2')
    await p.press('.points-entry input[data-entry="0"]', 'Enter')
    ok('a name it does not have: said in the box, nothing written', await p.evaluate(x2 => /no parameter 'nope'/.test(document.querySelector('.points-entry').textContent)
        && String(CHECK.list('tb', 'route').path[1][0]) === x2, x2))
    // rise / 2 = 0.5 pulls point 2 in: the fillet just dragged to the largest that fits no longer does -- the model says so
    await p.fill('.points-entry input[data-entry="0"]', 'rise / 2')
    await p.press('.points-entry input[data-entry="0"]', 'Enter')
    ok('an expression that makes the path unsound: refused, the model\'s reason in the box', await p.evaluate(x2 => /fillet at point 2 need/.test(document.querySelector('.points-entry')?.textContent)
        && String(CHECK.list('tb', 'route').path[1][0]) === x2, x2))
    await p.fill('.points-entry input[data-entry="0"]', `rise * ${x2}`)
    await p.press('.points-entry input[data-entry="0"]', 'Enter')
    await frame()
    ok('an expression: written as typed, the box closed', await p.evaluate(x2 => CHECK.list('tb', 'route').path[1][0] === `rise * ${x2}` && !document.querySelector('.points-entry'), x2),
        await p.evaluate(() => document.querySelector('.points-entry')?.textContent + ' ' + JSON.stringify(CHECK.list('tb', 'route').path)))
    {
        const pn = await panel()
        ok('...the panel its numbers again, the expression said as written, the mouse let through', pn && !pn.entry && pn.events === 'none'
            && pn.text.includes(`x = rise * ${x2}`), J(pn))
    }

    // A PATH AT TWO POINTS keeps them
    await select('two')
    await p.mouse.click(...await dotAt('two', [0, 0, -1]))
    await frame()
    await p.keyboard.press('Delete'); await frame()
    ok('a path of two points: Delete refused, and said', (await p.evaluate(() => CHECK.list('two', 'route').path.length)) === 2
        && /at least 2/.test(await p.evaluate(() => CHECK.overlay.points.said) ?? ''))

    // A CLICK ON NOTHING lets the point go, and picks nothing
    const picks = await p.evaluate(() => CHECK.picks.length)
    await p.mouse.click(...page([780, 480]))          // the bottom right: the top left is the view's toolbar
    await frame()
    ok('a click on nothing: the point let go, the selection kept, no pick', await selected() === null && await p.evaluate(n => CHECK.picks.length === n, picks)
        && await p.evaluate(() => CHECK.overlay.points.editing?.id === 'two'))

    /* A SWEEP'S POINT (2026-10-02, "sweep: scale (x,y and both) and rotation"): its section's own gizmo -- a cube along
       N for scale x and one along B for scale y, the circle for both, a quarter arc about the path for its twist -- each
       dragged writes that value live, with no compile; a twist written as a name moves the parameter; typed, it takes
       all three */
    await p.evaluate(() => CHECK.cam.set({ target: [-1.8, 0.2, 0.2] }))
    await select('bar')
    await until(() => CHECK.B.editingPoints === 'bar.route')
    const bar = () => p.evaluate(() => CHECK.list('bar', 'route').path)
    await p.mouse.click(...await pointAt('bar', 'route', 2))
    await frame()
    eq('the twisted bar\'s last point selected', await selected(), 2)
    const vb = (await handles()).filter(h => h.kind === 'value')
    eq('...its section\'s gizmo: a cube for scale x and one for scale y, the circle for both, an arc for its twist', vb.map(h => h.how).sort(), ['both', 'sx', 'sy', 'twist'])
    {
        const cy = vb.find(h => h.how === 'sy'), Oc = vb.find(h => h.how === 'both')?.circle, b0 = await bar(), cB = await compiles()
        if (cy && Oc) {
            await drag(page(cy.cube), page([cy.cube[0] + (cy.cube[0] - Oc[0]) * 0.5, cy.cube[1] + (cy.cube[1] - Oc[1]) * 0.5]))
            const b1 = await bar(), f = b1[2][5] / b0[2][5]
            ok('scale y\'s cube dragged half as far out again: scale y about 1.5 times, scale x exactly as it was, no compile',
                f > 1.3 && f < 1.7 && b1[2][4] === b0[2][4] && await compiles() === cB, J([b0[2], b1[2]]))
        }
        const tw = vb.find(h => h.how === 'twist'), turn0 = await p.evaluate(() => CHECK.list('bar', 'turn'))
        if (tw?.segs?.length > 12) {
            const mid = s => [(s[0][0] + s[1][0]) / 2, (s[0][1] + s[1][1]) / 2]
            await drag(page(mid(tw.segs[3])), page(mid(tw.segs[12])))
            const turn1 = await p.evaluate(() => CHECK.list('bar', 'turn'))
            ok('its twist, written "turn", dragged along its arc: turn moved by tens of degrees, the point still says turn, no compile',
                Math.abs(turn1 - turn0) > 10 && Math.abs(turn1 - turn0) < 80 && (await bar())[2][6] === 'turn' && await compiles() === cB, J({ turn0, turn1 }))
        } else ok('...its twist arc drawn, to drag', false, J(tw))
    }
    await p.keyboard.press('Enter'); await frame()
    ok('Enter: the typed entry has its scale x, scale y and twist too', await p.evaluate(() => ['4', '5', '6'].every(j => !!document.querySelector(`.points-entry input[data-entry="${j}"]`))))
    await p.fill('.points-entry input[data-entry="4"]', '2')
    await p.press('.points-entry input[data-entry="4"]', 'Enter')
    await frame()
    ok('...scale x typed: written, the rest as they were', await p.evaluate(() => { const q = CHECK.list('bar', 'route').path[2]; return q[4] === 2 && q[6] === 'turn' }), J((await bar())[2]))
    await p.keyboard.press('Enter'); await frame()
    await p.fill('.points-entry input[data-entry="5"]', '0')
    await p.press('.points-entry input[data-entry="5"]', 'Enter')
    ok('...a scale of 0: refused, the model\'s reason in the box', await p.evaluate(() => /a scale is more than 0/.test(document.querySelector('.points-entry')?.textContent ?? '')),
        await p.evaluate(() => document.querySelector('.points-entry')?.textContent))
    await p.press('.points-entry input[data-entry="5"]', 'Escape')
    await frame()

    // THE PLANE VIEW: square to the revolve's plane, and back exactly
    await p.evaluate(() => CHECK.cam.set({ target: [2, 0, 0.1] }))            // the knob in the middle of the picture
    await select('knob')
    await until(() => CHECK.B.editingPoints === 'knob.outline')
    // A PROFILE'S POINT: its arrows are r and z, in its plane; a dot dragged stays under the pointer, in the plane
    const outline = () => p.evaluate(() => CHECK.list('knob', 'outline'))
    await p.mouse.click(...await pointAt('knob', 'outline', 2))
    await frame()
    eq('the revolve\'s point 3 selected: two arrows, r and z', [await selected(), (await handles()).filter(h => h.kind === 'axis').map(h => h.j)], [2, [0, 1]])
    eq('...and one square, its plane', (await handles()).filter(h => h.kind === 'plane').map(h => h.js), [[0, 1]])
    const k0 = await outline()
    await drag(...await alongArrow(0, 30))
    const k1 = await outline()
    ok('its r arrow dragged: r moved, z and the fillet exactly as they were', k1[2][0] !== k0[2][0] && k1[2][1] === k0[2][1] && k1[2][2] === k0[2][2]
        && J(k1.filter((_, i) => i !== 2)) === J(k0.filter((_, i) => i !== 2)), J([k0[2], k1[2]]))
    const grab = await pointAt('knob', 'outline', 2), to = [grab[0] - 25, grab[1] + 18]
    await drag(grab, to)
    const landed = await pointAt('knob', 'outline', 2), k2 = await outline()
    ok('a dot dragged in its plane: it lands under the pointer, r and z both moved', Math.hypot(landed[0] - to[0], landed[1] - to[1]) < 1.5
        && k2[2][0] !== k1[2][0] && k2[2][1] !== k1[2][1], J({ to, landed, k: k2[2] }))

    const cam0 = await p.evaluate(() => CHECK.cam.get())
    ok('a revolved outline: the plane button offered', await shown('plane'))
    await click('plane'); await frame()
    const v = await p.evaluate(() => { const V = CHECK.cam.getUniforms().invView; return { st: CHECK.cam.get(), x: [V[0], V[1], V[2]], z: [V[8], V[9], V[10]] } })
    ok('plane view: orthographic, looking along +y at the (r, z) half-plane, r to the right',
        v.st.camtype === 1 && v.z[1] < -0.999 && v.x[0] > 0.999, J(v))
    await click('back'); await frame()
    const cam1 = await p.evaluate(() => CHECK.cam.get())
    const keys = ['camtype', 'azimuth', 'elevation', 'distance', 'target', 'dimensions', 'fov', 'mode']
    ok('back: the camera exactly where it was', keys.every(k => J(cam0[k]) === J(cam1[k])), J(keys.map(k => [k, cam0[k], cam1[k]])))
    await click('plane'); await frame()
    await click('Transform'); await frame()
    const cam2 = await p.evaluate(() => CHECK.cam.get())
    ok('leaving the mode in plane view puts the camera back too', keys.every(k => J(cam0[k]) === J(cam2[k])))

    // LEAVING: compiled as the document says again
    await until(() => CHECK.B.editingPoints === null && !CHECK.RT.scene.pointParams.some(P => P.forced))
    ok('Transform: nothing edited, nothing forced in the scene shown', true)

    // ITS PARAMETERS LOCKED (model.js setLock): the points are parameters -- the mode shown, not to be chosen
    const pointsBtn = () => p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Points')); return { disabled: b.disabled, title: b.title } })
    const lockTb = on => p.evaluate(on => CHECK.M.setLock(CHECK.B.doc, 'tb', 'params', on), on)
    await select('tb')
    await click('Points')
    await until(() => CHECK.overlay.mode === 'points' && CHECK.B.editingPoints === 'tb.route')
    await lockTb(true); await frame()
    await until(() => CHECK.overlay.mode === 'transform' && CHECK.B.editingPoints === null)
    ok('locked while in the mode: back to Transform, nothing being edited', true)
    {
        const b = await pointsBtn()
        ok('...the Points button still there, disabled, saying why', await shown('Points') && b.disabled && /parameters are locked/.test(b.title), J(b))
    }
    await click('Points'); await frame()
    ok('...a click on it does nothing', await p.evaluate(() => CHECK.overlay.mode) === 'transform')
    await lockTb(false); await frame()
    {
        const b = await pointsBtn()
        ok('unlocked: the button as it was', !b.disabled && /^Points:/.test(b.title) && !/locked/.test(b.title), J(b))
    }
    await click('Points')
    await until(() => CHECK.overlay.mode === 'points' && CHECK.B.editingPoints === 'tb.route')
    ok('...and the mode chosen again', true)
    await click('Transform'); await frame()
} catch (e) {
    failed++
    console.log('FAIL  ' + (e?.stack || e))
} finally {
    ok('no page errors', !errs.length, errs.join('\n'))
    await b.close(); server.close()
}
console.log(failed ? `\n${failed} FAILED` : 'points check: all passed')
process.exit(failed ? 1 : 0)

function eq(n, got, want) { ok(n, J(got) === J(want), `got ${J(got)} want ${J(want)}`) }
