// node optics/test/page.check.mjs
//
// THE OPTICS PAGE IN A BROWSER: optics/test/page.html -- the Analysis pane and the chart panels as
// index.html makes them, over a stand-in optics module whose analysis is made-up data -- driven headless.
// The application's own page stops at WebGPU, so without this the pane, the charts, their bars, the
// shared hover, the zoom and the results were code nothing ever ran (CLAUDE.md: a feature nothing
// exercises has never run). It checks:
//   before an analysis: every chart says why it is empty, the pane says there are no results
//   each chart's own controls ON the chart (the user, 2026-10-02), none in the Analysis pane
//   ▶ Run: the stand-in's batches reach every chart, the result cards, the totals and the run bar
//   the ray count: a number times a multiplier, 500k typed setting both, more than the most refused, either way
//   Live: round after round, the count each; ▶ Run disabled; Σ off at first, each round on its own; with Σ the rounds
//     adding up, and a reset of the picture starting them over; Σ off again; the rays traced between rounds and their own loop not started; switched off mid-round, the round let
//     go and the totals as the whole rounds left them; the rays switched on
//     during a ▶ Run start when it ends; no round while a scene is built (the run bar says it waits); a round the
//     scene was swapped under let go, Live going on; one that fails with the scene as it was stops it, and says why
//   hover: pointing at the polar diagram reads I - gamma too; pointing at the map reads the rings
//   a chart's strip: log brings its decades, typed C planes are drawn and kept, a field typed wrong goes back
//   the map: the button held moves the point and the profiles with it, and does not zoom; Shift-drag zooms
//     (the map's strip offers the way back), double-click goes back; the point said in the other charts' strips
//   more charts: the map's ⧉ makes another beside it, its own "shows" (an illuminance map beside a CCT map,
//     read at the same place); the profiles' own "shows"; Analysis › New chart's verb; ✕ takes one away
//   the data: the map switched to the far field on a plane re-shapes the data table and redraws; a map
//     whose choice that map cannot show says so
//   colour mixing: not in the Analysis pane; a window of its own, filled when it is opened
//   the rays in the view's analysis drawer: their switch and settings; on, a scene with no light or a light the
//     trace skips is said under their buttons, with why
//
// OPTIONAL, AND LOUD ABOUT IT, as lib/shell/test/example.check.mjs is: it needs Playwright's Chromium.
// Without it, it says so and exits 0 -- never a silent pass.
/* global CHECK -- the page's own, read inside page.evaluate() */
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
if (!chromium) { console.log('(optics page check SKIPPED: no playwright. npm i -g playwright to get it.)'); process.exit(0) }

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
const port = server.address().port

const b = await chromium.launch({ args: ['--disable-gpu'] })
const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage()
const errs = []
/* the one error a check causes on purpose: Live stopped by a round that fails (below), which the page logs */
const EXPECTED = /^\[optics\] Error: kernel refused/
p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !EXPECTED.test(m.text())) errs.push(m.text().slice(0, 300)) })
let failed = 0
const ok = (n, c, x = '') => { if (!c) failed++; console.log((c ? 'ok    ' : 'FAIL  ') + n + (c ? '' : '  ' + x)) }
await p.goto(`http://localhost:${port}/optics/test/page.html`); await p.waitForTimeout(900)

const KEYS = ['map', 'polar', 'igamma', 'profiles', 'rings', 'encircled']
/* a chart by its id less 'optics.': 'map' is the first map, 'map.2' the one made after it. Its strip
   (lib/pathtracer/strip.js): each control SHOWN, by what it sets (data-key), and what it says -- a dropdown's
   chosen text, a segmented choice's lit word, a field's value; its actions shown, by their tooltips */
const state = () => p.evaluate(() => {
    const ids = Object.keys(CHECK.el), k = id => id.replace(/^optics\./, '')
    const barOf = id => {
        const strip = CHECK.el[id].querySelector('.chart-strip')
        if (!strip) return null
        const fields = {}
        for (const e of strip.querySelectorAll('[data-key]')) {
            if (e.style.display === 'none') continue
            fields[e.dataset.key] = e.tagName === 'SELECT' ? e.selectedOptions[0]?.textContent ?? '' : e.tagName === 'LABEL' ? e.querySelector('input').value
                : [...e.querySelectorAll('button')].find(b => b.dataset.on)?.textContent ?? ''
        }
        return { fields, labels: Object.keys(fields), first: strip.parentElement.firstChild === strip,
                 tools: [...strip.querySelectorAll(':scope > button:not([data-key])')].filter(b => b.style.display !== 'none').map(b => b.title) }
    }
    return {
        bars: Object.fromEntries(ids.map(id => [k(id), barOf(id)])),
        cards: [...document.querySelectorAll('.shell-card .k')].map(e => e.textContent),
        note: [...document.querySelectorAll('.shell-note')].map(e => e.textContent).join(' | '),
        when: document.querySelector('.shell-runbar .when')?.textContent,
        readouts: Object.fromEntries(ids.map(id => [k(id), CHECK.el[id].querySelector('.shell-readout')?.textContent ?? null])),
        sizes: Object.fromEntries(ids.map(id => { const c = CHECK.el[id].querySelector('canvas'); return [k(id), c ? [c.clientWidth, c.clientHeight] : null] })),
        // the Analysis pane's own rows: the data and what folds away
        labels: [...CHECK.pane.querySelectorAll('.tp-lblv_l')].map(e => e.textContent.trim()),
        heads: [...CHECK.pane.querySelectorAll('.shell-head')].map(e => e.textContent.trim()),
        band: [...document.querySelectorAll('.shell-band')].some(b => b.style.display === 'block'),
    }
})
// where a chart's canvas is on the page, and a point a share across and down it
const at = async (key, fx, fy) => {
    const r = await p.evaluate(k => { const c = CHECK.el[`optics.${k}`].querySelector('canvas').getBoundingClientRect(); return [c.left, c.top, c.width, c.height] }, key)
    return [r[0] + fx * r[2], r[1] + fy * r[3]]
}
// what a chart's canvas holds now, to tell whether it was drawn again
const pixels = key => p.evaluate(k => CHECK.el[`optics.${k}`].querySelector('canvas').toDataURL(), key)
const cardValue = k => p.evaluate(k => [...document.querySelectorAll('.shell-card')].find(c => c.querySelector('.k').textContent === k)?.querySelector('.v').textContent, k)
// a chart's strip, used as a person would: a dropdown's option or a segmented choice's word chosen by its text,
// a field typed into and left, an action by its tooltip
const control = (key, ctl) => `CHECK.el['optics.${key}'].querySelector('.chart-strip [data-key="${ctl}"]')`
const options = (key, ctl) => p.evaluate(`[...(${control(key, ctl)}).options].map(o => o.textContent)`)
const choose = (key, ctl, text) => p.evaluate(`(() => {
    const c = ${control(key, ctl)}, t = ${JSON.stringify(text)}
    if (!c || c.style.display === 'none') return false
    if (c.tagName === 'SELECT') {
        const i = [...c.options].findIndex(o => o.textContent === t)
        if (i < 0) return false
        c.selectedIndex = i; c.dispatchEvent(new Event('change', { bubbles: true }))
        return true
    }
    const b = [...c.querySelectorAll('button')].find(b => b.textContent === t)
    b?.click()
    return !!b
})()`)
const type = (key, ctl, text) => p.evaluate(`(() => {
    const c = ${control(key, ctl)}?.querySelector('input')
    if (!c) return false
    c.focus(); c.value = ${JSON.stringify(text)}; c.blur()
    return true
})()`)
const tool = (key, start) => p.evaluate(([k, t]) => {
    const b = [...CHECK.el[`optics.${k}`].querySelectorAll('.chart-strip > button')].find(b => b.title.startsWith(t) && b.style.display !== 'none')
    b?.click()
    return !!b
}, [key, start])

// BEFORE AN ANALYSIS
let st = await state()
ok('every chart is a canvas filling a panel of its own', KEYS.every(k => st.sizes[k] && st.sizes[k][0] > 100 && st.sizes[k][1] > 100), JSON.stringify(st.sizes))
ok('no results before an analysis, and the pane says how to get them', !st.cards.length && /No results yet/.test(st.note), st.note)
ok('the data is in the pane: the far field\'s and the map\'s', ['from', 'axis', 'flip direction', 'γ step', 'C step', 'of', 'area', 'cells', 'smoothing'].every(l => st.labels.includes(l)), st.labels.join('|'))
const runNoteNow = () => p.evaluate(() => document.querySelector('.shell-runbar').nextElementSibling.textContent)
/* FLIP DIRECTION (the user, 2026-10-04: a beam arriving the other way had its peak at gamma +-180): gamma = 0 along the
   light's -z -- the axis the trace is given negated, C = 0 kept, so the frame turns half a turn about it */
const flip = () => p.evaluate(() => {
    const row = [...document.querySelectorAll('.tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim() === 'flip direction')
    row?.querySelector('input[type=checkbox]')?.click()
    return !!row
})
const asked = () => p.evaluate(() => JSON.stringify([CHECK.O.farAsked?.axis, CHECK.O.farAsked?.c0]))
const before = await asked()
ok('flip direction', await flip()); await p.waitForTimeout(100)
ok('...hands the trace the axis negated and C = 0 as it was', await asked() === JSON.stringify([[0, 0, -1], [1, 0, 0]]),
   `${before} -> ${await asked()}`)
await flip(); await p.waitForTimeout(100)
ok('...and back', await asked() === JSON.stringify([[0, 0, 1], [1, 0, 0]]), await asked())
/* A CUSTOM AXIS (the user, 2026-10-04: lights are not always on the axis of the targets): typed as a vector, flipped
   like any other; something that is not one said, and the field put back */
const dataSelect = (label, text) => p.evaluate(([label, text]) => {
    const row = [...document.querySelectorAll('.tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim() === label)
    const sel = row?.querySelector('select'), o = sel && [...sel.options].find(o => o.textContent === text)
    if (!o) return false
    sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true }))
    return true
}, [label, text])
const typeData = (label, text) => p.evaluate(([label, text]) => {
    const row = [...document.querySelectorAll('.tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim() === label)
    const i = row?.querySelector('input')
    if (!i) return false
    i.value = text; i.dispatchEvent(new Event('change', { bubbles: true }))
    return true
}, [label, text])
const paneRows = () => p.evaluate(() => [...CHECK.pane.querySelectorAll('.tp-lblv_l')].map(e => e.textContent.trim()))
ok('the axis offers a custom one', await dataSelect('axis', 'custom (a vector)')); await p.waitForTimeout(200)
ok('...which brings its vector, in the world\'s x, y, z', (await paneRows()).includes('axis x, y, z'), (await paneRows()).join('|'))
ok('...typed: the trace gets that axis', await typeData('axis x, y, z', '1, 0, 0.5') && (await p.waitForTimeout(100), await asked()) === JSON.stringify([[1, 0, 0.5], [1, 0, 0]]), await asked())
await flip(); await p.waitForTimeout(100)
ok('...flipped like a light\'s', await asked() === JSON.stringify([[-1, -0, -0.5], [1, 0, 0]]) || await asked() === JSON.stringify([[-1, 0, -0.5], [1, 0, 0]]), await asked())
await flip(); await p.waitForTimeout(100)
await typeData('axis x, y, z', '0 0 0'); await p.waitForTimeout(200)
ok('...a zero vector refused: said, the axis as it was, the field put back', /three numbers/.test(await runNoteNow()) && await asked() === JSON.stringify([[1, 0, 0.5], [1, 0, 0]])
   && await p.evaluate(() => [...document.querySelectorAll('.tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim() === 'axis x, y, z')?.querySelector('input')?.value) === '1, 0, 0.5',
   `${await runNoteNow()} ${await asked()}`)
ok('back to the light\'s axis: the vector\'s row goes', await dataSelect('axis', 'world +z') && (await p.waitForTimeout(200), !(await paneRows()).includes('axis x, y, z'))
   && await asked() === JSON.stringify([[0, 0, 1], [1, 0, 0]]), `${await asked()} ${(await paneRows()).join('|')}`)
// EACH CHART'S OWN CONTROLS, on it (the user, 2026-10-02), and none of them in the pane
const WANT = { map: ['q', 'isolines'], polar: ['planes', 'log', 'view'], igamma: ['planes', 'log', 'span'],
               profiles: ['about', 'q'], rings: ['about', 'q'], encircled: ['about'] }
ok('every chart has its own strip, first, with its controls and only those that apply', KEYS.every(k => st.bars[k]?.first && WANT[k].join() === st.bars[k].labels.join()),
   JSON.stringify(Object.fromEntries(KEYS.map(k => [k, st.bars[k]?.labels]))))
ok('...each saying its value itself', st.bars.map.fields.q === 'Illuminance' && st.bars.map.fields.isolines === 'steps' && st.bars.polar.fields.planes === '0, 90'
   && st.bars.polar.fields.log === 'lin' && st.bars.igamma.fields.span === 'γ auto' && st.bars.rings.fields.about === 'peak', JSON.stringify([st.bars.map.fields, st.bars.polar.fields]))
ok('...and its saves and ⧉ at the end: the map\'s CSVs and picture', ['Save the map (CSV)', 'Save the detector hits', 'Save the chart (PNG)', 'Another Map chart']
   .every(t => st.bars.map.tools.some(x => x.startsWith(t))) && st.bars.polar.tools.some(x => x.startsWith('Save the intensity table')), JSON.stringify(st.bars.map.tools))
ok('the Analysis pane has no chart\'s settings, nor a Chart section', !['shows', 'C planes', 'isolines', 'about', 'view'].some(l => st.labels.includes(l))
   && !st.heads.some(h => /^Chart/.test(h)), JSON.stringify([st.labels, st.heads]))
// THE SECTIONS' BOXES (0.64.0): the data's two the property table's (`boxes`), with their icons; the results' box the
// pane's own, in the same colours; what folds away below them not boxed
const boxes = await p.evaluate(() => {
    const data = [...document.querySelectorAll('.ana-data .tp-rotv_c > .tp-fldv')]
    const res = getComputedStyle(document.querySelector('.ana-results')), one = data[0] && getComputedStyle(data[0])
    return { data: data.map(f => [f.querySelector('.tp-fldv_t').textContent.trim(), f.classList.contains('pt-box'), f.classList.contains('pt-icon')]),
             same: !!one && ['borderTopColor', 'backgroundColor', 'borderTopLeftRadius'].every(k => res[k] === one[k]),
             more: [...document.querySelectorAll('.ana-more .tp-fldv')].some(f => f.classList.contains('pt-box')) }
})
ok('the data\'s folders are boxes with their icons, the results\' box in their colours, what folds away plain',
   JSON.stringify(boxes.data) === '[["Intensity",true,true],["Map",true,true]]' && boxes.same && !boxes.more, JSON.stringify(boxes))

// THE RAY COUNT (the user, 2026-10-04): a number and a multiplier, 1 × 1M at first
const count = () => p.evaluate(() => ({ n: document.querySelector('.shell-runbar .count').value, x: document.querySelector('.shell-runbar .times').selectedOptions[0].textContent }))
ok('the rays to trace: a number times a multiplier, 1 × 1M', JSON.stringify(await count()) === JSON.stringify({ n: '1', x: '× 1M' }), JSON.stringify(await count()))
ok('...the multipliers from × 1 to × 10M', (await p.evaluate(() => [...document.querySelectorAll('.shell-runbar .times option')].map(o => o.textContent)))
   .join() === '× 1,× 10,× 100,× 1k,× 10k,× 100k,× 1M,× 10M')

// ▶ RUN
await p.click('.shell-runbar button'); await p.waitForTimeout(1200)
st = await state()
ok('▶ Run runs the analysis once: the million in four batches', await p.evaluate(() => CHECK.O.runs === 1 && CHECK.O.asked[0].rays * CHECK.O.asked[0].batches === 1e6
   && CHECK.O.asked[0].batches === 4))
ok('the results arrive as cards', ['I max', 'efficiency', 'U0', 'r50 · r90', 'CCT'].every(k => st.cards.includes(k)) && st.cards.some(k => k.startsWith('E max')),
   st.cards.join('|'))
ok('the run bar says how many rays and when', /1,000,000 rays|1 000 000 rays|1000000 rays/.test(st.when), st.when)
ok('the totals are filled', await p.evaluate(() => /emitted/.test(document.querySelector('.tp-fldv_c table')?.textContent ?? '')))
ok('the map has colour, so it offers CCT (a map without would not)', await p.evaluate(() => /CCT/.test(document.querySelector('.shell-cards').textContent)))
ok('...and the map\'s strip offers it now', (await options('map', 'q')).includes('CCT'))

// HOVER: the far field's two share an angle, the map's four a place
let [x, y] = await at('polar', 0.5, 0.3)
await p.mouse.move(x, y); await p.waitForTimeout(150)
st = await state()
ok('pointing at the polar diagram reads it', /γ/.test(st.readouts.polar), JSON.stringify(st.readouts))
ok('...and I – γ follows the same angle', /γ/.test(st.readouts.igamma), JSON.stringify(st.readouts))
;[x, y] = await at('map', 0.45, 0.5)
await p.mouse.move(x, y); await p.waitForTimeout(150)
st = await state()
ok('pointing at the map reads the cell', /lx/.test(st.readouts.map), JSON.stringify(st.readouts))
ok('...and the rings and encircled flux read the same radius', /ring at r/.test(st.readouts.rings) && /within r/.test(st.readouts.encircled), JSON.stringify(st.readouts))
ok('...and the far field\'s charts let go of theirs', !st.readouts.polar, JSON.stringify(st.readouts))

// A CHART'S STRIP: a choice that brings a control of its own, a field typed
ok('I – γ\'s log scale', await choose('igamma', 'log', 'log')); await p.waitForTimeout(200)
st = await state()
ok('...brings its decades, in its strip alone', st.bars.igamma.labels.includes('decades') && !st.bars.polar.labels.includes('decades'), JSON.stringify([st.bars.igamma.labels, st.bars.polar.labels]))
ok('the polar diagram\'s C planes typed', await type('polar', 'planes', '0, 45, 90')); await p.waitForTimeout(200)
await p.mouse.move(...(await at('polar', 0.5, 0.3))); await p.waitForTimeout(150)
st = await state()
ok('...are drawn: three planes read under the pointer', (st.readouts.polar.match(/■/g) ?? []).length === 3 && /C45/.test(st.readouts.polar), st.readouts.polar)
ok('...and kept with the chart', await p.evaluate(() => CHECK.CHARTS.get('optics.polar').s.planes === '0, 45, 90'))

// THE MAP UNDER THE BUTTON (the user, 2026-10-02): held down, the point and the profiles follow the pointer, and
// nothing zooms -- the value under it is read as it moves; Shift-drag zooms
const [x0, y0] = await at('map', 0.3, 0.3), [x1, y1] = await at('map', 0.55, 0.6)
await p.mouse.move(x0, y0); await p.mouse.down(); await p.waitForTimeout(150)
const prof0 = await pixels('profiles')
await p.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 }); await p.waitForTimeout(150)
st = await state()
ok('held down and moved on the map: no zoom rectangle, the cell under it read', !st.band && /lx/.test(st.readouts.map), JSON.stringify([st.band, st.readouts.map]))
ok('...and the profiles drawn again through where it is', (await pixels('profiles')) !== prof0)
await p.mouse.move(x1, y1, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(300)
st = await state()
ok('...let go: no zoom, and the point is where it was let go', !st.bars.map.tools.some(t => t.startsWith('Zoomed'))
   && await p.evaluate(() => /about the click/.test(document.querySelector('.shell-cards').textContent)), JSON.stringify(st.bars.map.tools))
ok('...and every chart read about the point says so in its strip', ['profiles', 'rings', 'encircled'].every(k => st.bars[k].fields.about === 'pressed'),
   JSON.stringify(['profiles', 'rings', 'encircled'].map(k => st.bars[k].fields.about)))
const r50there = await cardValue('r50 · r90')
await p.mouse.click(x0, y0); await p.waitForTimeout(250)
ok('a click moves the point too: r50 about it is another number', (await cardValue('r50 · r90')) !== r50there, r50there)
await p.keyboard.down('Shift')
await p.mouse.move(x0, y0); await p.mouse.down(); await p.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 })
ok('Shift-drag on the map draws the rectangle', (await state()).band)
await p.mouse.move(x1, y1, { steps: 4 }); await p.mouse.up()
await p.keyboard.up('Shift')
await p.waitForTimeout(300)
st = await state()
ok('...and zooms it, the map\'s strip offering the way back', st.bars.map.tools.some(t => t.startsWith('Zoomed: back')), JSON.stringify(st.bars.map.tools))
await p.mouse.move(10, 10); await p.waitForTimeout(150)
st = await state()
ok('...and the map says it is zoomed', /zoomed/.test(st.readouts.map), JSON.stringify(st.readouts))
await p.mouse.dblclick(...(await at('map', 0.4, 0.5))); await p.waitForTimeout(300)
st = await state()
ok('a double-click goes back to the whole detector', !st.bars.map.tools.some(t => t.startsWith('Zoomed')), JSON.stringify(st.bars.map.tools))
ok('the rings\' strip puts the point back on the peak', await choose('rings', 'about', 'peak')); await p.waitForTimeout(200)
st = await state()
ok('...and the profiles\' and encircled flux\'s say the same', st.bars.profiles.fields.about === 'peak' && st.bars.encircled.fields.about === 'peak'
   && await p.evaluate(() => /about the peak/.test(document.querySelector('.shell-cards').textContent)), JSON.stringify([st.bars.profiles.fields, st.bars.encircled.fields]))
await p.mouse.click(...(await at('map', 0.35, 0.45))); await p.waitForTimeout(250)
ok('a click puts the point: the r50 card is about the click', await p.evaluate(() => /about the click/.test(document.querySelector('.shell-cards').textContent)))

// WHAT THE MAP SHOWS, for colour, in its strip: the light itself, and the distance from a target -- each brings its
// own fields, and the map, its readout and the cards keep working on it
ok('the map offers the light in its true colour', await choose('map', 'q', 'True colour'))
await p.waitForTimeout(250)
st = await state()
ok('...which brings its brightness', st.bars.map.labels.includes('exposure') && st.bars.map.fields.exposure === '× 1', st.bars.map.labels.join('|'))
await p.mouse.move(...(await at('map', 0.45, 0.5))); await p.waitForTimeout(150)
st = await state()
ok('...and pointing at it reads the illuminance and the cell\'s colour', /lx/.test(st.readouts.map) && /x 0\.\d{4} y 0\.\d{4}/.test(st.readouts.map), JSON.stringify(st.readouts.map))
ok('the map offers the distance from a target', await choose('map', 'q', 'Δu′v′ from target'))
await p.waitForTimeout(250)
st = await state()
ok('...whose target is the detector\'s own colour at first', st.bars.map.fields.target === 'own' && !st.bars.map.labels.includes('cct') && !st.bars.map.labels.includes('exposure'),
   JSON.stringify(st.bars.map.fields))
ok('...with a card of how far off the whole is', await p.evaluate(() => /Δu′v′ from target/.test(document.querySelector('.shell-cards').textContent)))
ok('a target by CCT', await choose('map', 'target', 'CCT'))
await p.waitForTimeout(250)
st = await state()
ok('...brings its CCT and Duv', st.bars.map.fields.cct === '4000' && st.bars.map.fields.duv === '0' && !st.bars.map.labels.includes('x'), JSON.stringify(st.bars.map.fields))
const offAt4000 = await cardValue('Δu′v′ from target')
const typed = await type('map', 'cct', '6500'); await p.waitForTimeout(200)
ok('...and a CCT typed moves the card', typed && (await cardValue('Δu′v′ from target')) !== offAt4000, offAt4000)
ok('...held to its range', (await type('map', 'cct', '99999')) && await p.evaluate(() => CHECK.CHARTS.get('optics.map').s.cct === 15000)
   && (await state()).bars.map.fields.cct === '15000')
ok('...and a field typed wrong goes back to its value', (await type('map', 'cct', 'warm')) && (await state()).bars.map.fields.cct === '15000')
ok('back to the illuminance', await choose('map', 'q', 'Illuminance'))
await p.waitForTimeout(250)

// ANOTHER MAP (the user, 2026-10-02: "compare 2D map of intensity and 2D map of CCT"): the map's ⧉ makes one
// beside it with its settings, each with its own "shows", both read at the same place
st = await state()
ok('the first map can be copied, and not removed', st.bars.map.tools.some(t => t.startsWith('Another Map chart')) && !st.bars.map.tools.some(t => t.startsWith('Remove')), st.bars.map.tools.join('|'))
ok('⧉ makes another map', await tool('map', 'Another Map chart')); await p.waitForTimeout(400)
st = await state()
ok('...its own panel, drawn, with its own strip', st.sizes['map.2']?.[0] > 100 && st.sizes['map.2']?.[1] > 100 && st.bars['map.2']?.labels.join() === 'q,isolines',
   JSON.stringify([st.sizes['map.2'], st.bars['map.2']]))
ok('...named Map 2, and not in the View menu (Analysis › Open chart lists the charts)', await p.evaluate(() => CHECK.S.registries.panels.get('optics.map.2')?.title === 'Map 2' && !CHECK.S.registries.commands.has('view.optics.map.2')))
ok('...and it can be removed', st.bars['map.2'].tools.some(t => t.startsWith('Remove Map 2')), st.bars['map.2'].tools.join('|'))
ok('Map 2 shows CCT', await choose('map.2', 'q', 'CCT')); await p.waitForTimeout(250)
await p.mouse.move(...(await at('map', 0.45, 0.5))); await p.waitForTimeout(200)
st = await state()
ok('pointing at the first map reads it in lux, and Map 2 the same place in K', /lx/.test(st.readouts.map) && !/\d K\b/.test(st.readouts.map)
   && /\d K\b/.test(st.readouts['map.2']) && st.readouts['map.2'].startsWith(st.readouts.map.split(':')[0]), JSON.stringify([st.readouts.map, st.readouts['map.2']]))
ok('the first map\'s strip still says illuminance, Map 2\'s CCT', st.bars.map.fields.q === 'Illuminance' && st.bars['map.2'].fields.q === 'CCT',
   JSON.stringify([st.bars.map.fields, st.bars['map.2'].fields]))
ok('...and the settings of each are kept with it', await p.evaluate(() => CHECK.CHARTS.get('optics.map.2').s.q === 'CCT' && CHECK.CHARTS.get('optics.map').s.q === 'E'))
// the profiles: a "shows" of their own, without the two that only paint
const profOpts = await options('profiles', 'q')
ok('the profiles show what they are set to: the quantities, not the two that paint', profOpts.includes('CCT') && profOpts.includes('Illuminance') && !profOpts.includes('True colour'), profOpts.join('|'))
ok('...CCT', await choose('profiles', 'q', 'CCT')); await p.waitForTimeout(250)
await p.mouse.move(...(await at('profiles', 0.5, 0.5))); await p.waitForTimeout(150)
ok('...and read in K', /K/.test((await state()).readouts.profiles), (await state()).readouts.profiles)
await choose('profiles', 'q', 'Illuminance'); await p.waitForTimeout(150)
// Analysis › New chart (the host's menu calls this), and ✕
ok('a new polar diagram from the menu\'s verb', await p.evaluate(() => CHECK.O.addChart('polar') === 'optics.polar.2')); await p.waitForTimeout(400)
st = await state()
ok('...drawn, Polar 2, with the defaults in its strip', st.sizes['polar.2']?.[0] > 100 && st.bars['polar.2']?.fields.planes === '0, 90'
   && await p.evaluate(() => CHECK.S.registries.panels.get('optics.polar.2')?.title === 'Polar 2'), JSON.stringify([st.sizes['polar.2'], st.bars['polar.2']]))
ok('✕ takes it away', await tool('polar.2', 'Remove Polar 2')); await p.waitForTimeout(300)
ok('...its panel, its View entry and its settings gone', await p.evaluate(() => !CHECK.S.isOpen('optics.polar.2')
   && !CHECK.S.registries.panels.has('optics.polar.2') && !CHECK.S.registries.commands.has('view.optics.polar.2') && !CHECK.CHARTS.get('optics.polar.2') && !CHECK.el['optics.polar.2'])
   && (await state()).bars.polar?.fields.planes === '0, 45, 90')
ok('a polar diagram made again takes the number freed', await p.evaluate(() => CHECK.O.addChart('polar') === 'optics.polar.2')); await p.waitForTimeout(300)
await tool('polar.2', 'Remove Polar 2'); await p.waitForTimeout(200)

// THE DATA: the map of the far field on a plane
await p.evaluate(() => {
    const s = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent === 'the far field on a plane'))
    s.value = [...s.options].find(o => o.textContent === 'the far field on a plane').value
    s.dispatchEvent(new Event('change', { bubbles: true }))
})
await p.waitForTimeout(400)
st = await state()
ok('the map of the far field on a plane: the data asks its distance, not its area', st.labels.includes('distance (m)') && !st.labels.includes('area') && !st.labels.includes('smoothing'),
   st.labels.join('|'))
ok('...and the results come from it', st.cards.some(k => k.startsWith('E max · the far field')), st.cards.join('|'))
ok('...and Map 2, kept on CCT, says this map cannot show it rather than going blank', /^CCT \(not in this map/.test(st.bars['map.2'].fields.q)
   && !(await options('map', 'q')).includes('CCT'), st.bars['map.2'].fields.q)

// COLOUR MIXING: a tool of its own, not a folder of the Analysis pane
const paneLabels = () => p.evaluate(() => [...CHECK.pane.querySelectorAll('.tp-lblv_l')].map(e => e.textContent.trim()))
ok('colour mixing is not in the Analysis pane', !(await paneLabels()).some(l => /light 1|target|total flux/.test(l)), (await paneLabels()).join('|'))
await p.evaluate(() => CHECK.S.open('tools.mixing', undefined, undefined, { floating: { width: 380, height: 480 } })); await p.waitForTimeout(400)
const mix = await p.evaluate(() => ({ labels: [...CHECK.mixEl.querySelectorAll('.tp-lblv_l')].map(e => e.textContent.trim()),
                                      buttons: [...CHECK.mixEl.querySelectorAll('.tp-btnv_t')].map(e => e.textContent.trim()),
                                      text: [...CHECK.mixEl.querySelectorAll('textarea')].map(e => e.value).join() }))
ok('opened, its window has the lights, the target and the button', ['light 1', 'light 2', 'light 3', 'target', 'total flux (lm)'].every(l => mix.labels.includes(l))
   && mix.buttons.includes('Set the fluxes'), JSON.stringify(mix))
ok('...and says what the scene\'s lights make now (none here)', /no lights with flux/.test(mix.text), mix.text)
await p.evaluate(() => [...CHECK.mixEl.querySelectorAll('.tp-btnv_b')].find(b => b.textContent.includes('Set the fluxes')).click()); await p.waitForTimeout(100)
ok('...and answers in its own window', await p.evaluate(() => /choose three different lights/.test(CHECK.mixEl.querySelector('.shell-note')?.textContent)))

// THE RAYS IN THE VIEW'S ANALYSIS DRAWER (2026-10-02): their switch and their settings, the drawer's RAYS group, after
// DISPLAY; shown, they mark the drawer's button while it is closed
const drawerOf = () => p.evaluate(() => {
    const d = CHECK.VIEW.analyse.el, drawer = d.children[0], badges = d.children[1].querySelector('span')
    const rays = [...drawer.children].find(c => c.firstChild.textContent === 'Rays')
    return { captions: [...drawer.children].map(c => c.firstChild.textContent), open: CHECK.VIEW.analyse.isOpen,
             rays: rays && [...rays.querySelectorAll('button')].map(b => ({ on: !!b.dataset.on, menu: !!b.dataset.menu, tip: b.title })),
             badgeIcons: badges.style.display !== 'none' ? badges.querySelectorAll('svg').length : 0 }
})
await p.evaluate(() => CHECK.VIEW.analyse.setOpen(true)); await p.waitForTimeout(100)
let dr = await drawerOf()
ok('the rays are the drawer\'s RAYS group, after DISPLAY: a switch, off, and their settings (a menu)', dr.captions.join() === 'Display,Rays'
   && dr.rays?.length === 2 && !dr.rays[0].on && !dr.rays[0].menu && dr.rays[1].menu, JSON.stringify(dr))
await p.evaluate(() => [...CHECK.VIEW.analyse.el.querySelectorAll('button')].find(b => b.title.startsWith('Rays over the picture')).click()); await p.waitForTimeout(100)
await p.evaluate(() => CHECK.VIEW.analyse.setOpen(false)); await p.waitForTimeout(100)
dr = await drawerOf()
ok('...switched on, and the drawer closed: on still, and the drawer\'s button shows the rays', dr.rays[0].on && dr.badgeIcons === 1, JSON.stringify(dr))
await p.evaluate(() => CHECK.VIEW.analyse.setOpen(true)); await p.waitForTimeout(100)
await p.evaluate(() => [...CHECK.VIEW.analyse.el.querySelectorAll('button')].find(b => b.title === 'The rays\' settings').click()); await p.waitForTimeout(200)
ok('...their settings open upwards from the drawer, with their rows', await p.evaluate(() => {
    const pop = [...document.body.querySelectorAll('div')].find(e => e.style.display === 'block' && e.textContent.includes('interactions'))
    return !!pop && pop.style.top === '' && pop.style.bottom !== ''
}))
/* THE MAXIMUM DISTANCE IN THE RAYS' OWN SETTINGS (the user, 2026-10-09: it cut every drawn ray short and was only in
   the Analysis pane's Advanced, folded away): the same value in both rows, each following the other. And "path shown"
   A LENGTH in the scene's unit, its range the user's to set by right-clicking the row; at the slider's end, all. */
const raysPop = () => [...document.body.querySelectorAll('div')].find(e => e.style.display === 'block' && e.textContent.includes('interactions'))
const rowIn = (root, label) => [...root.querySelectorAll('.tp-lblv')].find(r => r.querySelector('.tp-lblv_l')?.textContent.trim() === label)
const typeIn = (label, v, inPane) => p.evaluate(([label, v, inPane, raysPopS, rowInS]) => {
    const raysPop = eval(raysPopS), rowIn = eval(rowInS)
    const i = rowIn(inPane ? CHECK.pane : raysPop(), label)?.querySelector('input:not([type=checkbox])')
    if (!i) return false
    i.value = String(v); i.dispatchEvent(new Event('change')); return true
}, [label, v, inPane, raysPop.toString(), rowIn.toString()])
const valueIn = (label, inPane) => p.evaluate(([label, inPane, raysPopS, rowInS]) => {
    const raysPop = eval(raysPopS), rowIn = eval(rowInS)
    return rowIn(inPane ? CHECK.pane : raysPop(), label)?.querySelector('input:not([type=checkbox])')?.value ?? null
}, [label, inPane, raysPop.toString(), rowIn.toString()])
ok('...the max distance among them', await typeIn('max distance (0 = none)', 75))
await p.waitForTimeout(100)
ok('...typed there, Advanced\'s row shows it, and the scene keeps it', +(await valueIn('max optical distance (0 = none)', true)) === 75
   && await p.evaluate(() => CHECK.doc.optics?.maxDist === 75), String(await valueIn('max optical distance (0 = none)', true)))
await typeIn('max optical distance (0 = none)', 0, true); await p.waitForTimeout(100)
ok('...and typed in Advanced, the rays\' row follows', +(await valueIn('max distance (0 = none)')) === 0, String(await valueIn('max distance (0 = none)')))
const PATH = 'path shown (end = all)'
ok('path shown: at its end at first, every ray drawn whole', await p.evaluate(() => CHECK.O.pathStyle?.maxOpl === Infinity), JSON.stringify(await p.evaluate(() => String(CHECK.O.pathStyle?.maxOpl))))
await typeIn(PATH, 120); await p.waitForTimeout(100)
ok('...120 typed: each ray drawn to 120 in the scene\'s unit, whatever the max distance', await p.evaluate(() => CHECK.O.pathStyle?.maxOpl === 120), String(await p.evaluate(() => CHECK.O.pathStyle?.maxOpl)))
// the property table's range editor: right-click the row, three numbers (min, max, step)
await p.evaluate(([label, raysPopS, rowInS]) => {
    const raysPop = eval(raysPopS), rowIn = eval(rowInS)
    rowIn(raysPop(), label).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
}, [PATH, raysPop.toString(), rowIn.toString()]); await p.waitForTimeout(200)
const setRange = await p.evaluate(() => {
    const menu = [...document.body.querySelectorAll('*')].reverse().find(e => /Property: opl/.test(e.textContent) && e.querySelectorAll('input').length >= 3 && e.querySelectorAll('input').length <= 6)
    const ins = menu && [...menu.querySelectorAll('input')].filter(i => i.type !== 'checkbox')
    if (!ins || ins.length < 3) return false
    // the last three: min, max, step (a header row above them is a text field too)
    const max = ins[ins.length - 2]
    max.value = '50'; max.dispatchEvent(new Event('change'))
    ;[...menu.querySelectorAll('button')].find(b => b.textContent.trim() === 'Close')?.click()
    return true
})
ok('...right-clicked: the range editor, its max set to 50', setRange)
await p.waitForTimeout(700)
ok('...past the new end, the slider is at its end: every ray whole again, without the slider moved', await p.evaluate(() => CHECK.O.pathStyle?.maxOpl === Infinity), String(await p.evaluate(() => CHECK.O.pathStyle?.maxOpl)))
await typeIn(PATH, 20); await p.waitForTimeout(100)
ok('...and within it, 20 drawn to 20', await p.evaluate(() => CHECK.O.pathStyle?.maxOpl === 20), String(await p.evaluate(() => CHECK.O.pathStyle?.maxOpl)))
/* WHAT THE RAYS CANNOT SHOW IS SAID WHERE THEY ARE (the user, 2026-10-03: OpticsBench2's laser showed no rays, and
   nothing in the view said why). This scene has no light: the RAYS group says so under its buttons. A light under
   group code, which the trace skips (builder/sources.js), is named there with its reason, and in the rays' own
   settings; switched off, the note goes. */
const raysNote = () => p.evaluate(() => {
    const g = [...CHECK.VIEW.analyse.el.children[0].children].find(c => c.firstChild.textContent === 'Rays')
    const n = g?.lastElementChild
    return n && n.style.display !== 'none' ? n.textContent : ''
})
let note = await raysNote()
ok('...on, in a scene with no light: the RAYS group says there is none to trace, and how to add one', /^no light to trace: add a light in the Builder/.test(note), note)
await p.evaluate(() => {
    const { doc, Model } = CHECK
    Model.addGroup(doc, 'root', { id: 'twist', label: 'Twist' })
    Model.setCode(doc, 'twist', 'C = children(C, p);')      // its block's (model.js version 16)
    Model.addLight(doc, 'twist', { id: 'lamp', label: 'Laser', shape: 'disc' })
}); await p.waitForTimeout(700)
note = await raysNote()
ok('...a light under group code: named under the buttons, with why it is not traced', /no light to trace:\nLaser: not traced -- inside group code/.test(note), note)
ok('...and in the rays\' settings: the lights they start from, and the ones they do not', await p.evaluate(() => {
    const pop = [...document.body.querySelectorAll('div')].find(e => e.style.display === 'block' && e.textContent.includes('interactions'))
    return [...(pop?.querySelectorAll('textarea') || [])].some(t => /Laser: not traced -- inside group code/.test(t.value))
}))
await p.evaluate(() => [...CHECK.VIEW.analyse.el.querySelectorAll('button')].find(b => b.title.startsWith('Rays over the picture')).click()); await p.waitForTimeout(100)
ok('...switched off, the note goes', (await raysNote()) === '')
ok('...and off again: the mark goes', (await p.evaluate(() => { CHECK.VIEW.analyse.setOpen(false); return true })) && (await drawerOf()).badgeIcons === 0)

// THE RAY COUNT, typed and chosen: the multiplier is a dropdown, and 500k or 2M typed in the number sets it too
const setCount = n => p.evaluate(n => { const i = document.querySelector('.shell-runbar .count'); i.focus(); i.value = n; i.dispatchEvent(new Event('change')); i.blur() }, n)
const setTimes = t => p.evaluate(t => {
    const s = document.querySelector('.shell-runbar .times'), i = [...s.options].findIndex(o => o.textContent === t)
    if (i < 0) return false
    s.selectedIndex = i; s.dispatchEvent(new Event('change'))
    return true
}, t)
const runNote = () => p.evaluate(() => document.querySelector('.shell-runbar').nextElementSibling.textContent)
await setCount('500k')
ok('500k typed: 500 × 1k', JSON.stringify(await count()) === JSON.stringify({ n: '500', x: '× 1k' }), JSON.stringify(await count()))
await setTimes('× 10M')
ok('...× 10M chosen on 500: past the most, refused and said, the count as it was', JSON.stringify(await count()) === JSON.stringify({ n: '500', x: '× 1k' })
   && /1 to 50 million/.test(await runNote()), JSON.stringify([await count(), await runNote()]))
await setTimes('× 1')
await setCount('2.5')
await setTimes('× 100')
ok('2.5 × 100: 250 rays, said in the field\'s tooltip', await p.evaluate(() => /^250 rays/.test(document.querySelector('.shell-runbar .count').title)))
await setCount('0.001')
ok('...a count under one ray in all refused', JSON.stringify(await count()) === JSON.stringify({ n: '2.5', x: '× 100' }))
await setCount('1')
await setTimes('× 1k')

/* LIVE (the user, 2026-10-04): the analysis round after round, that many rays each, ▶ Run disabled meanwhile; the
   rounds ADD UP while nothing changes, and start over when the picture does (RT.resets, here CHECK.resets); the rays,
   if shown, traced between rounds by the page, their own loop (O.live) not started while it holds the module. The
   stand-in's batches read an emitted flux of 1000 + the run's number, so the totals say which runs they are of. */
const liveState = () => p.evaluate(() => {
    const emitted = [...document.querySelectorAll('.tp-fldv_c table tr')].find(r => r.cells[0]?.textContent === 'emitted')?.cells[1].textContent
    const when = document.querySelector('.shell-runbar .when').textContent
    return { runs: CHECK.O.runs, done: CHECK.O.done, traces: CHECK.O.traces, living: CHECK.O.living, when,
             run: document.querySelector('.shell-runbar .run').disabled,
             live: document.querySelector('.shell-runbar .live').classList.contains('on'), liveText: document.querySelector('.shell-runbar .live').textContent,
             emitted, mean: emitted ? parseFloat(emitted) : null, rays: +(/([\d,]+) rays/.exec(when)?.[1] ?? '').replace(/,/g, ''),
             head: [...document.querySelectorAll('.tp-fldv_c table')].find(t => /emitted/.test(t.textContent))?.previousElementSibling?.textContent ?? '' }
})
const meanOf = (a, b) => 1000 + (a + b) / 2               // the emitted flux of the runs a..b merged
const raysButton = () => p.evaluate(() => [...CHECK.VIEW.analyse.el.querySelectorAll('button')].find(b => b.title.startsWith('Rays over the picture')).click())
await p.evaluate(() => CHECK.VIEW.analyse.setOpen(true))
await raysButton(); await p.waitForTimeout(100)          // the rays on: their own loop runs
let ls = await liveState()
ok('the rays on, and no analysis: their own loop runs', ls.living === true, JSON.stringify(ls))
/* Σ OFF, AS IT STARTS (the user, 2026-10-04: "make the cumulative optional. that makes it easier to compare results"):
   every round shown on its own, the same rays each; Σ switched on while live, the rounds after it add up */
const sumOn = () => p.evaluate(() => document.querySelector('.shell-runbar .sum').classList.contains('on'))
ok('Σ is off at first', !(await sumOn()))
await p.evaluate(() => { CHECK.O.batchMs = 30 })
await p.click('.shell-runbar .live'); await p.waitForTimeout(1000)
ls = await liveState()
ok('Live with Σ off: every round on its own -- its rays alone in the run bar and the totals, its own mean',
   /^live · 1,000 rays · \d+\.\d\d s a round$/.test(ls.when) && ls.head === '1,000 rays in 4 batches' && Math.abs(ls.mean - (1000 + ls.done)) < 0.5, JSON.stringify(ls))
await p.click('.shell-runbar .sum')
const s0 = (await liveState()).done
await p.waitForFunction(d => CHECK.O.done >= d + 4, s0, { timeout: 5000 }); await p.waitForTimeout(30)
ls = await liveState()
ok('Σ switched on while live: the rounds after it add up', await sumOn() && /^live · [\d,]+ rays in \d+ rounds · /.test(ls.when), JSON.stringify(ls))
await p.click('.shell-runbar .live'); await p.waitForTimeout(400)
const runsBefore = (await liveState()).runs, callsBefore = await p.evaluate(() => CHECK.O.liveCalls.length)
await p.evaluate(() => { CHECK.O.batchMs = 30 })
await p.click('.shell-runbar .live'); await p.waitForTimeout(1500)
ls = await liveState()
let rounds = ls.done - runsBefore
ok('Live: lit, and ▶ Run disabled', ls.live && ls.run && /■/.test(ls.liveText), JSON.stringify(ls))
ok('...rounds one after another', rounds >= 3, `${rounds} rounds`)
ok('...each the count: 1 × 1k is four batches of 250', await p.evaluate(n => CHECK.O.asked.slice(n).every(a => a.rays === 250 && a.batches === 4), runsBefore))
ok('...the rounds add up, and the run bar says so: the rays of every round, how many, how long one takes',
   new RegExp(`^live · ${(1000 * rounds).toLocaleString('en-US')} rays in ${rounds} rounds · \\d+\\.\\d\\d s a round$`).test(ls.when), ls.when)
ok('...so do the totals: every round\'s batches, the mean of every round', ls.head === `${(1000 * rounds).toLocaleString()} rays in ${4 * rounds} batches`
   && Math.abs(ls.mean - meanOf(runsBefore + 1, ls.done)) < 0.5, JSON.stringify([ls.head, ls.mean, meanOf(runsBefore + 1, ls.done)]))
ok('...the rays\' own loop stopped, and the rays traced between rounds instead', ls.living === false && ls.traces >= 2
   && await p.evaluate(n => !CHECK.O.liveCalls.slice(n).includes(true), callsBefore), JSON.stringify(ls))
// THE PICTURE STARTS OVER (a value, the camera, the scene): the round it happened in is shown alone and kept by
// nothing, and the rounds after it add up again from one
await p.evaluate(() => { CHECK.O.batchMs = 100 })
await p.waitForFunction(() => CHECK.O.runs > CHECK.O.done, null, { timeout: 5000 })
const d0 = await p.evaluate(() => { CHECK.resets = (CHECK.resets ?? 0) + 1; return CHECK.O.done })
await p.waitForFunction(d => CHECK.O.done >= d + 1, d0, { timeout: 5000 }); await p.waitForTimeout(30)
ls = await liveState()
ok('a reset during a round: that round shown on its own', /^live · 1,000 rays · /.test(ls.when) && Math.abs(ls.mean - (1000 + d0 + 1)) < 0.5, JSON.stringify(ls))
await p.waitForFunction(d => CHECK.O.done >= d + 3, d0, { timeout: 5000 }); await p.waitForTimeout(30)
ls = await liveState()
ok('...then the rounds after it add up from one: not the one it happened in', /^live · 2,000 rays in 2 rounds · /.test(ls.when)
   && Math.abs(ls.mean - meanOf(d0 + 2, d0 + 3)) < 0.5, JSON.stringify([ls.when, ls.mean, meanOf(d0 + 2, d0 + 3)]))
// Σ OFF AGAIN while live: the next rounds each on their own; then on, for what follows
await p.click('.shell-runbar .sum')
const s1 = (await liveState()).done
await p.waitForFunction(d => CHECK.O.done >= d + 2, s1, { timeout: 5000 }); await p.waitForTimeout(30)
ls = await liveState()
ok('Σ switched off while live: the rounds after it each on their own again', !(await sumOn()) && /^live · 1,000 rays · /.test(ls.when)
   && Math.abs(ls.mean - (1000 + ls.done)) < 0.5, JSON.stringify(ls))
await p.click('.shell-runbar .sum')
// SWITCHED OFF IN THE MIDDLE OF A ROUND: the round is let go, the charts keep what the whole rounds gave
await p.waitForFunction(() => CHECK.O.runs > CHECK.O.done, null, { timeout: 5000 })
await p.waitForTimeout(150)                               // a batch or two into it
await p.click('.shell-runbar .live')
const offAt = await liveState()
await p.waitForTimeout(1200)
ls = await liveState()
ok('switched off mid-round: no round after it, and that one let go', ls.runs === offAt.runs && ls.done === offAt.runs - 1, JSON.stringify([offAt, ls]))
ok('...the totals what the whole rounds gave, as they were', ls.emitted === offAt.emitted && ls.head === offAt.head && ls.mean < 1000 + ls.runs,
   JSON.stringify([ls.emitted, offAt.emitted, ls.head]))
ok('...the button off, ▶ Run back, and the run bar says the rays and when', !ls.live && !ls.run && ls.liveText === 'Live'
   && ls.rays === offAt.rays && /^[\d,]+ rays · /.test(ls.when), JSON.stringify(ls))
ok('...and the rays\' own loop running again', ls.living === true, JSON.stringify(ls))
await p.evaluate(() => { CHECK.O.batchMs = 0 })
// THE RAYS SWITCHED ON DURING A ▶ RUN: not started then -- the trace would refuse them, and they switched themselves
// off -- but when it ends
await raysButton(); await p.waitForTimeout(100)          // off
await p.evaluate(() => { CHECK.O.batchMs = 200 })
await p.click('.shell-runbar .run'); await p.waitForTimeout(250)
ok('Live while ▶ Run runs: disabled', await p.evaluate(() => document.querySelector('.shell-runbar .live').disabled))
await raysButton(); await p.waitForTimeout(100)          // on, mid-run
ok('the rays switched on during a ▶ Run: their loop not started yet', (await liveState()).living === false)
await p.waitForFunction(() => CHECK.O.runs === CHECK.O.done, null, { timeout: 5000 }); await p.waitForTimeout(100)
ok('...and started when it ends', (await liveState()).living === true)
await p.evaluate(() => { CHECK.O.batchMs = 0 })
await raysButton()

/* LIVE THROUGH A STRUCTURAL EDIT: the renderer puts the new scene in before it builds, and its uniforms in after, so
   a round in between can be refused by name. While a scene is built no round starts; one the scene changed under is
   let go and the next goes on; one that fails with the scene as it was stops Live and says why. */
await p.click('.shell-runbar .live'); await p.waitForTimeout(400)
await p.evaluate(() => { CHECK.busy = true }); await p.waitForTimeout(300)
const busyAt = await liveState()
await p.waitForTimeout(500)
ls = await liveState()
ok('a scene being built: no round starts, and the run bar says Live waits for it', ls.runs === busyAt.runs && ls.live && ls.when === 'live · waiting for the scene to build',
   JSON.stringify([busyAt.runs, ls]))
await p.evaluate(() => { CHECK.busy = false }); await p.waitForTimeout(500)
ls = await liveState()
ok('...built: the rounds go on', ls.runs > busyAt.runs && /^live · [\d,]+ rays/.test(ls.when), JSON.stringify(ls))
const noteNow = () => p.evaluate(() => document.querySelector('.shell-runbar').nextElementSibling.textContent)
await p.evaluate(() => { CHECK.O.swap = true; CHECK.O.fail = "Unknown uniform 'mengerScale'" }); await p.waitForTimeout(600)
ls = await liveState()
ok('a round refused with the scene swapped under it: let go, and Live goes on', ls.live && ls.runs > busyAt.runs + 2 && !/stopped/.test(await noteNow()),
   JSON.stringify([ls, await noteNow()]))
await p.evaluate(() => { CHECK.O.fail = 'kernel refused' }); await p.waitForTimeout(600)
ls = await liveState()
ok('a round that fails with the scene as it was: Live stops, and says why', !ls.live && !ls.run && /^live analysis stopped: kernel refused/.test(await noteNow()),
   JSON.stringify([ls, await noteNow()]))
await p.click('.shell-runbar .live'); await p.waitForTimeout(300)
const beforeBuild = await liveState()
await p.evaluate(() => { CHECK.O.batchMs = 120 })
await p.waitForFunction(() => CHECK.O.runs > CHECK.O.done, null, { timeout: 5000 })
await p.evaluate(() => { CHECK.compiled(); CHECK.O.fail = 'No resources bound' })   // a build begins during the round, which then fails
await p.waitForTimeout(1200)
ls = await liveState()
ok('a round failing with a build begun since it started: let go, and Live goes on', ls.live && ls.runs > beforeBuild.runs + 1 && !/stopped/.test(await noteNow()),
   JSON.stringify([ls, await noteNow()]))
await p.evaluate(() => { CHECK.O.batchMs = 0 })
await p.click('.shell-runbar .live'); await p.waitForTimeout(300)

if (errs.length) failed++
console.log(errs.join('\n') || 'no page errors'); await b.close(); server.close()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
