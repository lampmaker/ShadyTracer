// node lib/pathtracer/test/darkroomtools.check.mjs
//
// THE DARKROOM'S CURVES EDITOR AND COLOUR WHEELS IN A BROWSER (darkroom/curveeditor.js, darkroom/wheels.js, 0.79.0),
// over a plain settings object (darkroomtools.html), at a device pixel ratio of 2. The curves: a click adds a point
// where it is and a drag moves it; the curve the settings get is a new object each change; a point cannot pass its
// neighbours; a double-click and a drag out of the square take a point away; the ends move and stay; the tabs edit
// their own channel; the luminance switch. The wheels: a press moves a dot there, a drag follows, held to the rim; a
// double-click back to the centre; red to the right, green up and to the left; one change a move. Both made in a host not
// shown, as the page makes them (0.79.0): nothing thrown, the wheels drawn once shown.
//
// OPTIONAL, AND LOUD ABOUT IT, as the other checks: it needs Playwright's Chromium.
/* global CHECK -- the page's, in the evaluated functions */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execSync } from 'node:child_process'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
let chromium
try { ({ chromium } = await import('playwright')) } catch {
    try { ({ chromium } = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'playwright/index.mjs')).href)) } catch { }
}
if (!chromium) { console.log('(darkroom tools check SKIPPED: no playwright. npm i -g playwright to get it.)'); process.exit(0) }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }
const server = createServer(async (req, res) => {
    try {
        const path = join(repo, decodeURIComponent(new URL(req.url, 'http://x').pathname))
        if (!path.startsWith(repo)) throw new Error('outside')
        const body = await readFile(path)
        res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
        res.end(body)
    } catch { res.writeHead(404); res.end() }
})
await new Promise(r => server.listen(0, r))
const b = await chromium.launch({ args: ['--disable-gpu'] })
const p = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 400, height: 800 } })
const errs = []
p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })
let failed = 0
const ok = (n, c, x = '') => { if (!c) failed++; console.log((c ? 'ok    ' : 'FAIL  ') + n + (c ? '' : '  ' + x)) }
await p.goto(`http://localhost:${server.address().port}/lib/pathtracer/test/darkroomtools.html`)
await p.waitForFunction(() => window.CHECK, null, { timeout: 5000 })

const curve = k => p.evaluate(k => CHECK.DV.curves[k], k)
const box = await p.locator('#c [data-curve="canvas"]').boundingBox()
// a point in the curve's own 0..1 at the page: the square has a 6 CSS px margin (curveeditor.js geom)
const at = (x, y) => [box.x + 6 + x * (box.width - 12), box.y + 6 + (1 - y) * (box.height - 12)]
const near = (a, b, t = 0.01) => Math.abs(a - b) <= t

// THE CURVES
{
    const before = await p.evaluate(() => CHECK.DV.curves)
    await p.mouse.move(...at(0.5, 0.7)); await p.mouse.down(); await p.mouse.up()
    const m = await curve('m')
    ok('a click adds a point where it is', m.length === 3 && near(m[1][0], 0.5) && near(m[1][1], 0.7), JSON.stringify(m))
    ok('...the settings given a new object, the old one untouched', (await p.evaluate(() => CHECK.DV.curves)) !== before && before.m.length === 2)
    await p.mouse.move(...at(0.5, 0.7)); await p.mouse.down()
    await p.mouse.move(...at(0.4, 0.8), { steps: 4 }); await p.mouse.up()
    const m2 = await curve('m')
    ok('a point dragged follows', m2.length === 3 && near(m2[1][0], 0.4) && near(m2[1][1], 0.8), JSON.stringify(m2))
    await p.mouse.move(...at(0.4, 0.8)); await p.mouse.down()
    // past the white end but within the margin a drag out of the square needs (OUT, 24 CSS px): held before its neighbour
    await p.mouse.move(...at(1.04, 0.8), { steps: 4 }); await p.mouse.up()
    const m3 = await curve('m')
    ok('...never past its neighbour (the white end)', m3.length === 3 && m3[1][0] < 1 && m3[1][0] > 0.98, JSON.stringify(m3))
    await p.mouse.move(...at(0, 0)); await p.mouse.down()
    await p.mouse.move(...at(0.05, 0.1), { steps: 3 }); await p.mouse.up()
    const m4 = await curve('m')
    ok('the black end moves', near(m4[0][0], 0.05) && near(m4[0][1], 0.1) && m4.length === 3, JSON.stringify(m4))
    await p.mouse.move(...at(0.05, 0.1)); await p.mouse.down()
    await p.mouse.move(box.x - 60, box.y + box.height / 2, { steps: 4 }); await p.mouse.up()
    ok('...and stays when dragged out of the square', (await curve('m')).length === 3)
    const mid = (await curve('m'))[1]
    await p.mouse.move(...at(mid[0], mid[1])); await p.mouse.down()
    await p.mouse.move(box.x + box.width / 2, box.y + box.height + 60, { steps: 4 }); await p.mouse.up()
    ok('an inner point dragged out of the square goes', (await curve('m')).length === 2, JSON.stringify(await curve('m')))
    await p.mouse.click(...at(0.3, 0.2))
    const pt = (await curve('m'))[1]
    await p.mouse.dblclick(...at(pt[0], pt[1]))
    ok('a double-click takes a point away', (await curve('m')).length === 2, JSON.stringify(await curve('m')))
    await p.locator('#c [data-curve="r"]').click()
    await p.mouse.click(...at(0.5, 0.3))
    ok('the R tab edits red alone', (await curve('r')).length === 3 && (await curve('m')).length === 2 && (await curve('g')).length === 2
        && (await p.evaluate(() => CHECK.E.active)) === 'r')
    await p.locator('#c [data-curve="luma"]').check()
    ok('the luminance switch', await p.evaluate(() => CHECK.DV.curveLuma === true))
    const n = await p.evaluate(() => CHECK.counts.curve)
    ok('changes said each time', n >= 8, `${n}`)
    await p.evaluate(() => { CHECK.DV.curves = { m: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] }; CHECK.DV.curveLuma = false; CHECK.E.redraw() })
    ok('redrawn from settings changed elsewhere: the switch follows', !(await p.locator('#c [data-curve="luma"]').isChecked()))
}

// THE WHEELS
{
    const wb = await p.locator('#w [data-wheel="gain"]').boundingBox()
    const r = wb.width / 2 - 2, cx = wb.x + wb.width / 2, cy = wb.y + wb.height / 2
    const n0 = await p.evaluate(() => CHECK.counts.wheel)
    await p.mouse.move(cx + 0.5 * r, cy); await p.mouse.down(); await p.mouse.up()
    const g = await p.evaluate(() => ({ x: CHECK.DV.gainX, y: CHECK.DV.gainY }))
    ok('a press on the gain wheel moves its dot there: right is red (+x)', near(g.x, 0.5, 0.02) && near(g.y, 0, 0.02), JSON.stringify(g))
    ok('...one change said', (await p.evaluate(() => CHECK.counts.wheel)) === n0 + 1)
    await p.mouse.move(cx, cy); await p.mouse.down()
    await p.mouse.move(cx - 3 * r * 0.5, cy - 3 * r * 0.866, { steps: 5 }); await p.mouse.up()
    const g2 = await p.evaluate(() => ({ x: CHECK.DV.gainX, y: CHECK.DV.gainY }))
    ok('a drag up and to the left (green) follows, held to the rim', near(Math.hypot(g2.x, g2.y), 1, 0.01) && near(g2.x, -0.5, 0.02) && near(g2.y, 0.866, 0.02), JSON.stringify(g2))
    await p.mouse.dblclick(cx + 0.2 * r, cy)
    ok('a double-click back to the centre', await p.evaluate(() => CHECK.DV.gainX === 0 && CHECK.DV.gainY === 0))
    ok('the other wheels untouched', await p.evaluate(() => CHECK.DV.liftX === 0 && CHECK.DV.gammaY === 0))
}

// MADE WHILE NOT SHOWN, as the page makes them (0.79.0): nothing thrown, and the wheels drawn once they have a size
{
    ok('the curves and wheels made in a host not shown: nothing thrown', await p.evaluate(() => CHECK.hiddenError === null), await p.evaluate(() => CHECK.hiddenError))
    await p.evaluate(() => { document.getElementById('h').style.display = 'block' })
    // the pixels painted, not the canvas's width: one never sized is 300 wide by the element's default
    const drawn = () => p.evaluate(() => {
        const c = document.querySelector('#h [data-wheel="gain"]'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
        let n = 0
        for (let i = 3; i < d.length; i += 4) if (d[i]) n++
        return { w: c.width, css: c.clientWidth, n }
    })
    let s = await drawn()
    for (let t = 0; t < 50 && !s.n; t++) { await p.waitForTimeout(100); s = await drawn() }
    ok('...shown, a wheel drawn at its size (by the ResizeObserver)', s.w === s.css * 2 && s.n > s.w * s.w / 2, JSON.stringify(s))
}

ok('no errors', errs.length === 0, errs.join('\n'))
await b.close(); server.close()
console.log(failed ? `\n${failed} FAILED` : '\nall ok')
process.exit(failed ? 1 : 0)
