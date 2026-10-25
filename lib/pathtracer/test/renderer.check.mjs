// node lib/pathtracer/test/renderer.check.mjs
//
// THE RENDERER PANEL IN A BROWSER (settingsui.js over the real PropertyTable, in the shell's stylesheet), headless --
// the page's own panel needs WebGPU, which the container does not have. Its boxes in order (RENDERER_BOXES): Quality's
// buttons, Preview and Accurate, the one in force lit, and the line saying what it traces or what Custom changed;
// Light sources' switches as checkboxes -- the environment ticked when lit, the caustics, the lights' rays -- and
// their photons; the bounces and the firefly clamp; a developer's settings, and the Ray marching, Performance and
// Diagnostics boxes, hidden until the Developer switch -- one line at the foot of Quality, remembered, with a count of the
// developer settings off their default (named in its tooltip) and Reset, greyed with nothing to put back; each
// row's help its tooltip; caustics not offered in Sketch or Optics, the lights' rays not in Sketch.
//
// OPTIONAL, AND LOUD ABOUT IT, as the other checks: it needs Playwright's Chromium.
/* global CHECK, getComputedStyle -- the page's, in the evaluated functions */
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
if (!chromium) { console.log('(renderer panel check SKIPPED: no playwright. npm i -g playwright to get it.)'); process.exit(0) }

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
const p = await b.newPage()
const errs = []
p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })
let failed = 0
const ok = (n, c, x = '') => { if (!c) failed++; console.log((c ? 'ok    ' : 'FAIL  ') + n + (c ? '' : '  ' + x)) }
await p.goto(`http://localhost:${server.address().port}/lib/pathtracer/test/renderer.html`)
await p.waitForFunction(() => window.CHECK && document.querySelectorAll('#p .tp-lblv').length > 0, null, { timeout: 5000 })
await p.waitForTimeout(300)          // PropertyTable's own touches come on a timeout; monitors poll

// what a person sees: the labels of the rows, and the titles of the folders, that are on screen
const seen = () => p.evaluate(() => ({
    rows: [...document.querySelectorAll('#p .tp-lblv')].filter(e => e.offsetParent !== null)
        .map(e => e.querySelector('.tp-lblv_l')?.textContent.trim()).filter(Boolean),
    folders: [...document.querySelectorAll('#p .tp-fldv')].filter(e => e.offsetParent !== null)
        .map(e => e.querySelector('.tp-fldv_t')?.textContent.trim()),
    boxes: [...document.querySelectorAll('#p .tp-rotv_c > .tp-fldv')].filter(e => e.offsetParent !== null)
        .map(e => e.querySelector('.tp-fldv_t')?.textContent.trim()),
}))
const rowEl = label => `[...document.querySelectorAll('#p .tp-lblv')].find(e => e.querySelector('.tp-lblv_l')?.textContent.trim() === ${JSON.stringify(label)})`
// the Quality buttons: the lit one's preset, or custom when none is
const quality = () => p.evaluate(() => document.querySelector('#p [data-preset][aria-pressed="true"]')?.dataset.preset ?? 'custom')
const line = () => p.evaluate(() => document.querySelector('#p .quality-line')?.textContent ?? '')
const note = () => p.evaluate(() => { const n = document.querySelector('#p .quality-note'); return n && n.offsetParent !== null ? n.textContent : '' })
const choose = id => p.evaluate(i => document.querySelector(`#p [data-preset="${i}"]`).click(), id)
const type = (label, v) => p.evaluate(`(() => { const i = [...${rowEl(label)}.querySelectorAll('input')].pop()
    i.value = ${JSON.stringify(String(v))}; i.dispatchEvent(new Event('change', { bubbles: true })) })()`)
const tick = (label, on) => p.evaluate(`(() => { const i = ${rowEl(label)}.querySelector('input[type=checkbox]')
    i.checked = ${!!on}; i.dispatchEvent(new Event('change', { bubbles: true })) })()`)
const ticked = label => p.evaluate(`${rowEl(label)}?.querySelector('input[type=checkbox]')?.checked ?? null`)
const tracing = () => p.evaluate(() => ({ ...CHECK.states.Tracing.values }))
const settle = () => p.waitForTimeout(300)
const CAUSTICS = 'Caustics (sun, glowing surfaces)', RAYS = 'Lights\' rays (light objects)', ENV = 'Sun, sky or studio'

// BY DEFAULT: the user's boxes and rows only
let s = await seen()
ok('the boxes, in order, and no Developer box', JSON.stringify(s.boxes) === JSON.stringify(['Quality', 'Light sources', 'Paths and noise', 'Render size']),
    JSON.stringify(s.boxes))
const USER = [ENV, CAUSTICS, RAYS, 'Photons per Pixel', 'Max Bounces']
ok('the user\'s rows are shown', USER.every(l => s.rows.includes(l)), JSON.stringify(s.rows))
ok('...and the firefly clamp', s.rows.some(l => l.startsWith('Firefly clamp')), JSON.stringify(s.rows))
ok('renderMode has no row of its own: the Quality buttons are its control', !s.rows.includes('Light paths') && !s.rows.includes('Quality'), JSON.stringify(s.rows))
for (const l of ['Epsilon (m, 0 = auto)', 'Max Iterations', 'Russian Roulette', 'Next-Event Estimation', 'Learn Photon Map',
                 'NEE emitter share', 'Draft: rays that look for lamps (share)', 'Max Averages (0=unlimited)'])
    ok(`hidden: ${l}`, !s.rows.includes(l))
ok('a developer\'s boxes and folders are hidden whole', !['Ray marching', 'Performance', 'Diagnostics', 'Light sampling', 'Photon map', 'Glowing surfaces (emitters)']
    .some(f => s.folders.includes(f)), JSON.stringify(s.folders))
// THE DEVELOPER LINE: in the Quality box, below its buttons, all on one line
const dev = () => p.evaluate(() => {
    const line = document.querySelector('#p .dev-line'), q = document.querySelector('#p .tp-rotv_c > .tp-fldv')
    if (!line) return null
    const parts = [...line.children].map(e => e.getBoundingClientRect())
    const reset = line.querySelector('button')
    return { inQuality: q.contains(line), belowButtons: line.getBoundingClientRect().top > document.querySelector('#p [data-preset]').getBoundingClientRect().bottom,
             oneLine: parts.every(r => Math.abs((r.top + r.bottom) / 2 - (parts[0].top + parts[0].bottom) / 2) < 4) && line.getBoundingClientRect().height < 34,
             on: line.querySelector('input[type=checkbox]').checked, info: line.querySelector('.dev-info').textContent,
             tip: line.querySelector('.dev-info').title, warn: line.querySelector('.dev-info').style.color.includes('warn'), resetOff: reset.disabled }
})
let D = await dev()
ok('the Developer switch is a line in the Quality box, below its buttons', D?.inQuality && D.belowButtons, JSON.stringify(D))
ok('...on one line at the panel\'s width: the switch, the count and Reset', D?.oneLine, JSON.stringify(D))
ok('...off, everything at default, Reset greyed', D && !D.on && D.info === 'all at default' && D.resetOff, JSON.stringify(D))
// the boxes are the property table's (GUISTUFF, `boxes`), the icons settingsui names, in the shell's colours
ok('the boxes carry their icons', await p.evaluate(() => [...document.querySelectorAll('#p .tp-rotv_c > .tp-fldv')]
    .every(f => f.classList.contains('pt-icon') && f.style.getPropertyValue('--pt-icon').startsWith('url("data:image/svg+xml,')
        && getComputedStyle(f.querySelector(':scope > .tp-fldv_b'), '::before').width === '15px')))
ok('...and are drawn as boxes, in the shell\'s colours', await p.evaluate(() => {
    const f = document.querySelector('#p .tp-rotv_c > .tp-fldv'), s = getComputedStyle(f)
    return f.classList.contains('pt-box') && s.borderTopStyle === 'solid' && s.borderTopColor === 'rgb(54, 64, 74)' && s.backgroundColor === 'rgb(26, 30, 34)'
}))
ok('a row\'s tooltip is its help', (await p.evaluate(`${rowEl('Max Bounces')}.closest('[title]')?.title ?? ''`)).startsWith('How often a path may scatter'))
ok('a fresh renderer is Standard', await quality() === 'standard', await quality())
ok('...and the line says what Standard traces', (await line()).startsWith('Full path tracing'), await line())
ok('the Quality buttons: Preview, Accurate and Optics', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('#p [data-preset]')].map(b => b.textContent)))
    === JSON.stringify(['Sketch', 'Draft', 'Standard', 'High', 'Optics']))
ok('...on one line at the panel\'s width', await p.evaluate(() => new Set([...document.querySelectorAll('#p [data-preset]')].map(b => Math.round(b.getBoundingClientRect().top))).size === 1))

// A PRESET CHOSEN: what it names, nothing else; it reads as itself
let n = await p.evaluate(() => CHECK.resets.length)
await choose('draft'); await settle()
let t = await tracing()
ok('Draft sets the mode', t.renderMode === 1 && t.maxbounce === 10, JSON.stringify(t))
ok('...restarting the render', await p.evaluate(k => CHECK.resets.slice(k).includes(true), n))
ok('...and reads Draft', await quality() === 'draft', await quality())
ok('...and the line says so', (await line()).startsWith('Light straight from the sun'), await line())
s = await seen()
ok('caustics and the lights\' rays stay offered in Draft (light through glass is theirs)', s.rows.includes(CAUSTICS) && s.rows.includes(RAYS), JSON.stringify(s.rows))
n = await p.evaluate(() => CHECK.resets.length)
await choose('draft'); await settle()
ok('the preset already in force: no restart', await p.evaluate(k => !CHECK.resets.slice(k).includes(true), n))
await p.evaluate(() => { CHECK.states.Measure.values.measureMode = 1; CHECK.UI.applyVisibility() }); await settle()
ok('a false-colour view: the note says it traces in full', (await note()).includes('traces in full'), await note())
await p.evaluate(() => { CHECK.states.Measure.values.measureMode = 0; CHECK.UI.applyVisibility() }); await settle()
ok('...and goes with it', await note() === '', await note())
await choose('sketch'); await settle()
s = await seen()
ok('Sketch: no caustics, lights\' rays or photons (it traces no light)', (await tracing()).renderMode === 2
    && ![CAUSTICS, RAYS, 'Photons per Pixel'].some(l => s.rows.includes(l)), JSON.stringify(s.rows))
ok('...nor the Optics view\'s flat light', !s.rows.some(l => l.startsWith('Flat light')), JSON.stringify(s.rows))
await choose('optics'); await settle()
s = await seen()
ok('Optics: the lights\' rays, their photon count and its flat light, no caustics row', (await tracing()).renderMode === 3
    && s.rows.includes(RAYS) && s.rows.includes('Photons per Pixel') && s.rows.some(l => l.startsWith('Flat light')) && !s.rows.includes(CAUSTICS),
    JSON.stringify(s.rows))
ok('...and reads Optics', await quality() === 'optics', await quality())
await choose('high'); await settle()
t = await tracing()
ok('High quality: full, more bounces and photons', t.renderMode === 0 && t.maxbounce === 24 && t.ltPhotons === 2, JSON.stringify(t))
await choose('standard'); await settle()
await type('Max Bounces', 12); await settle()
ok('a setting moved off the preset reads Custom', (await tracing()).maxbounce === 12 && await quality() === 'custom', await quality())
ok('...and the line names it against the nearest preset', (await line()).includes('Max Bounces 12 (Standard: 10)'), await line())
n = await p.evaluate(() => CHECK.resets.length)
await p.evaluate(() => CHECK.table.refresh()); await settle()
t = await tracing()
ok('a refresh writing the shown values back changes nothing', t.maxbounce === 12 && t.renderMode === 0
    && await p.evaluate(k => !CHECK.resets.slice(k).includes(true), n), JSON.stringify(t))
await choose('standard'); await settle()
ok('Standard puts it back', (await tracing()).maxbounce === 10 && await quality() === 'standard', await quality())

// THE LIGHT SOURCES' SWITCHES: checkboxes over the 0 and 1, the environment's the other way round
ok('every switch starts ticked', await ticked(ENV) === true && await ticked(CAUSTICS) === true && await ticked(RAYS) === true,
    JSON.stringify([await ticked(ENV), await ticked(CAUSTICS), await ticked(RAYS)]))
n = await p.evaluate(() => CHECK.resets.length)
await tick(ENV, false); await settle()
ok('the environment unticked is lamps only, restarting', (await tracing()).lampsOnly === 1 && await p.evaluate(k => CHECK.resets.slice(k).includes(true), n))
ok('...which is no quality of its own: still Standard', await quality() === 'standard', await quality())
await tick(ENV, true); await settle()
ok('...and ticked again, the scene\'s', (await tracing()).lampsOnly === 0)
await tick(CAUSTICS, false); await settle()
ok('caustics unticked: lt 0', (await tracing()).lt === 0)
await tick(RAYS, false); await settle()
ok('the lights\' rays unticked: lightRays 0', (await tracing()).lightRays === 0)
ok('...both less than Standard: Custom, and the line says which', await quality() === 'custom'
    && (await line()).includes(`${CAUSTICS} off (Standard: on)`) && (await line()).includes(`${RAYS} off (Standard: on)`), await line())
await p.evaluate(() => { Object.assign(CHECK.states.Tracing.values, { lt: 1, lightRays: 1 }); CHECK.UI.applyVisibility(); CHECK.table.refresh() }); await settle()
/* DISPERSION (0.74.0): a user's row in Paths and noise, stored the other way round (dispersionOff), so ticked is on --
   and off is less than Standard, which puts it back */
{
    const DISP = 'Dispersion (glass splits colours)'
    ok('dispersion: a row of the user\'s, ticked', s.rows.includes(DISP) && await ticked(DISP) === true, JSON.stringify(s.rows))
    n = await p.evaluate(() => CHECK.resets.length)
    await tick(DISP, false); await settle()
    ok('...unticked: dispersionOff 1, restarting', (await tracing()).dispersionOff === 1 && await p.evaluate(k => CHECK.resets.slice(k).includes(true), n))
    ok('...Custom, and the line says so', await quality() === 'custom' && (await line()).includes('Dispersion off (every glass at n_d) (Standard:'), await line())
    await choose('standard'); await settle()
    ok('...Standard ticks it again', (await tracing()).dispersionOff === 0 && await ticked(DISP) === true && await quality() === 'standard')
    /* MAX DIFFUSE BOUNCES (0.75.0): a user's row beside the bounces, all 40 by default; fewer is Custom, and Standard puts
       them back */
    const DIFF = 'Max Diffuse Bounces'
    ok('max diffuse bounces: a row of the user\'s, at 40', s.rows.includes(DIFF) && (await tracing()).maxDiffuse === 40, JSON.stringify(s.rows))
    await type(DIFF, 2); await settle()
    ok('...2 typed: the setting 2, Custom, and the line says so', (await tracing()).maxDiffuse === 2 && await quality() === 'custom'
        && (await line()).includes('Max Diffuse Bounces 2 (Standard: 40)'), await line())
    await choose('standard'); await settle()
    ok('...Standard puts all 40 back', (await tracing()).maxDiffuse === 40 && await quality() === 'standard')
}
/* FAST WHILE MOVING (0.59.0): its switch and what a move traces as, in the Quality box, ticked and Draft by default; the
   choice greyed while the switch is off (gui.requires), and ticking it writes the setting */
{
    const FAST = 'Fast while moving', AS = 'Fast while moving: as'
    const greyed = label => p.evaluate(`!!${rowEl(label)}?.querySelector('select, input')?.disabled`)
    ok('fast while moving: in the Quality box, on, a choice of Draft or Sketch beside it',
        (await ticked(FAST)) === true && !(await greyed(AS)) && (await tracing()).moveMode === 1, `${await ticked(FAST)} ${await greyed(AS)}`)
    await tick(FAST, false); await settle()
    ok('...unticked: the setting 0, and the choice greyed while it is off', (await tracing()).moveFast === 0 && await greyed(AS))
    await tick(FAST, true); await settle()
    ok('...ticked again, the choice back', (await tracing()).moveFast === 1 && !(await greyed(AS)))
}
ok('set from elsewhere (a script, the menu), the boxes follow', await ticked(CAUSTICS) === true && await ticked(RAYS) === true && await quality() === 'standard')

// THE DEVELOPER SWITCH
const setDev = on => p.evaluate(o => { const i = document.querySelector('#p .dev-line input[type=checkbox]'); i.checked = o; i.dispatchEvent(new Event('change', { bubbles: true })) }, on)
await p.evaluate(() => { CHECK.states.Tracing.values.maxiter = 128; CHECK.UI.applyVisibility() }); await settle()
D = await dev()
ok('a developer setting moved while hidden: counted, named in the tooltip, in the warning colour, Reset live', D.info === '1 not at default'
    && D.tip.includes('maxiter') && D.warn && !D.resetOff, JSON.stringify(D))
await setDev(true); await settle()
s = await seen()
D = await dev()
ok('switched on, the developer rows show', ['Max Iterations', 'Russian Roulette', 'Draft: rays that look for lamps (share)', 'Next-Event Estimation',
    'NEE sun/sky split', 'Uniform environment (cd/m², 0 = sky; test)'].every(l => s.rows.includes(l)) && !s.rows.some(l => /TRACE2/.test(l)), JSON.stringify(s.rows))
ok('...in their boxes', JSON.stringify(s.boxes) === JSON.stringify(['Quality', 'Light sources', 'Paths and noise', 'Render size', 'Ray marching', 'Performance', 'Diagnostics']),
    JSON.stringify(s.boxes))
/* THE PERFORMANCE BOX (0.30.0): how the scene is built, a word at its top (the title's tooltip too), each row's help on
   hover, and a row greyed -- not to be ticked -- while what it needs is off, its tooltip naming that */
{
    const DATA = 'Scene as data (edits without a compile)'
    const CACHE = 'Step cache (0 off, 1 own cell, 2 cells ahead)', CELLS = 'Step cache: cells (millions)', VIEW = 'Step cache: show its cells'
    const FILL = 'Step cache: fill (1 when the scene changes, 2 every frame)'
    const box = await p.evaluate(() => {
        const f = [...document.querySelectorAll('#p .tp-rotv_c > .tp-fldv')].find(e => e.querySelector('.tp-fldv_t')?.textContent.trim() === 'Performance')
        return f && { rows: [...f.querySelectorAll('.tp-lblv_l')].map(e => e.textContent.trim()), intro: f.querySelector('.box-intro')?.textContent ?? '',
                      tip: f.querySelector('.tp-fldv_t').title, introShown: f.querySelector('.box-intro')?.offsetParent !== null }
    })
    // (the candidate grid's and exact hits' rows went in 0.41.0; they were the greyed rows' first example here)
    ok('Performance: the GPU time a frame, then the build options, in order, under a word at the top that is the title\'s tooltip too', box
        && JSON.stringify(box.rows) === JSON.stringify(['GPU time a frame (ms, 0 = whole samples)', 'Bake when the edits stop', DATA, 'March on distance only', CACHE, FILL, CELLS, VIEW])
        && /different build/.test(box.intro) && box.introShown && box.tip === box.intro, JSON.stringify(box))
    const state = label => p.evaluate(`(() => { const r = ${rowEl(label)}; const i = r?.querySelector('input')
        return r && { disabled: !!i?.disabled, tip: r.closest('[title]')?.title ?? '' } })()`)
    const adv = () => p.evaluate(() => ({ ...CHECK.states.Advanced.values }))
    let c = await state(CELLS)
    ok('...the cache\'s fill, cells and view greyed while the cache is off, the tooltip its help and what to switch on', c?.disabled && (await state(VIEW)).disabled
        && (await state(FILL)).disabled && /cells/i.test(c.tip) && c.tip.includes(`Needs ${CACHE} on.`), JSON.stringify(c))
    ok('...and what needs nothing is not', !(await state(DATA)).disabled && !(await state(CACHE)).disabled && !(await state('Bake when the edits stop')).disabled)
    await type(CACHE, 2); await settle()
    c = await state(CELLS)
    ok('the step cache on: its fill, cells and view usable, the "needs" gone from their tooltips', (await adv()).stepCache === 2 && !c.disabled
        && !(await state(VIEW)).disabled && !(await state(FILL)).disabled && !c.tip.includes(`Needs ${CACHE} on.`), JSON.stringify(c))
    ok('...the fill filled once by default (the lazy fill, its 0, gone in 0.41.0)', (await adv()).stepCacheFill === 1)
    await p.evaluate(() => { Object.assign(CHECK.states.Advanced.values, { stepCache: 0 }); CHECK.UI.applyVisibility(); CHECK.table.refresh() }); await settle()
    ok('...set off from elsewhere (a script, a workspace): greyed again', (await state(CELLS)).disabled && (await state(VIEW)).disabled && (await state(FILL)).disabled)
}
ok('...and Light sources\' folders', ['Light sampling', 'Photon map', 'Glowing surfaces (emitters)'].every(f => s.folders.includes(f)), JSON.stringify(s.folders))
ok('...and it is remembered', await p.evaluate(() => CHECK.mem.get('pathtracer.developer') === '1'))
ok('...the count no longer a warning: the rows are in view', D.on && !D.warn, JSON.stringify(D))
ok('a developer\'s switch is a checkbox too', await ticked('Next-Event Estimation') === true && await ticked('Russian Roulette') === false)
await type('Step Scale', 0.5); await settle()
ok('another moved is counted too', (await tracing()).stepscale === 0.5 && (await dev()).info === '2 not at default' && (await dev()).tip.includes('stepscale'),
    JSON.stringify(await dev()))
/* THE TOLERANCE IS THE SCENE'S SINCE 0.66.0 (builder/panel.js, its Properties, in its unit; builder/test/panel.check.mjs
   holds that row to what this one held: typed, a box and not a slider, nothing rounded). Here only its line is left. */
{
    const EPS = 'Surface tolerance (\u00b5m, 0 = auto)'
    ok('no tolerance row in the Renderer panel: the scene sets it', await p.evaluate(`!${rowEl(EPS)}`))
    // THE BOX'S LINE: the tolerance in use as the host says it (the facade's toleranceInUse), repainted with the rest
    const lineOf = () => p.evaluate(() => {
        const f = [...document.querySelectorAll('#p .tp-rotv_c > .tp-fldv')].find(e => e.querySelector('.tp-fldv_t')?.textContent.trim() === 'Ray marching')
        const l = f?.querySelector('.box-line'); return l && l.offsetParent !== null ? l.textContent : null })
    ok('the Ray marching box says the tolerance in use, as the host gives it', (await lineOf()) === 'In use: 10.5 \u00b5m, automatic: 1e-4 of the scene\'s 105 mm.', String(await lineOf()))
    await p.evaluate(() => { CHECK.lineText.tolerance = 'In use: 1 \u00b5m, set by hand.'; CHECK.UI.applyVisibility() }); await settle()
    ok('...and follows it when it changes', (await lineOf()) === 'In use: 1 \u00b5m, set by hand.', String(await lineOf()))
}
await p.evaluate(() => CHECK.states.Tracing.values.maxbounce = 12)
n = await p.evaluate(() => CHECK.resets.length)
await p.evaluate(() => document.querySelector('#p .dev-line button').click()); await settle()
t = await tracing()
ok('Reset puts them back, restarting, and the user\'s settings stay', t.maxiter === 400 && t.stepscale === 0.9 && t.maxbounce === 12
    && await p.evaluate(k => CHECK.resets.slice(k).includes(true), n) && (await dev()).info === 'all at default' && (await dev()).resetOff,
    JSON.stringify([t, await dev()]))
await p.evaluate(() => CHECK.UI.setDeveloper(false)); await settle()
s = await seen()
ok('switched off from elsewhere (a host command), they go, and the box follows', !s.rows.includes('Max Iterations') && !s.folders.includes('Diagnostics')
    && !s.folders.includes('Light sampling') && !(await dev()).on, JSON.stringify(s))

// A HOST WITH NO QUALITY BOX: the same line, in a Developer box of its own
await p.evaluate(() => { CHECK.U2 = CHECK.fallback() }); await settle()
const fb = await p.evaluate(() => {
    const q = document.querySelector('#q'), f = q.querySelector('.tp-rotv_c > .tp-fldv')
    return { title: f?.querySelector('.tp-fldv_t')?.textContent.trim(), line: !!f?.querySelector('.dev-line'), on: f?.querySelector('.dev-line input').checked }
})
ok('no Quality box: a Developer box holds the line', fb.title === 'Developer' && fb.line && fb.on === false, JSON.stringify(fb))
await p.evaluate(() => { const i = document.querySelector('#q .dev-line input'); i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })) }); await settle()
ok('...its switch turns and is remembered', await p.evaluate(() => CHECK.U2.developer() && CHECK.mem.get('pathtracer.developer') === '1'))

if (errs.length) failed++
console.log(errs.join('\n') || 'no page errors'); await b.close(); server.close()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
