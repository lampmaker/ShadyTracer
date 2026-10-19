// node lib/shell/test/example.check.mjs
//
// THE SHELL IN A BROWSER: lib/shell/example.html driven headless -- the default layout, the pinned
// panel, the View menu, a command, visibility told to an owner that registers after the layout is
// restored, the arrangement kept across a reload, reset, a floating panel, a real pop-out window, and
// pop-outs left out of the saved layout. The application's own page cannot be driven here (it stops
// at WebGPU), so this is the only thing that runs the shell's DOM.
//
// Also the layout presets (apply, save one's own, delete), the command palette, and the renderer's view
// toolbar (lib/pathtracer/viewtools.js) against a stand-in renderer, and the parameter registry: the
// Parameters panel over the renderer's real settings, and the palette finding and setting them.
//
// OPTIONAL, AND LOUD ABOUT IT, as check-shaders' naga pass is: it needs Playwright's Chromium (this
// repository has no package.json; `npm i -g playwright` once). Without it, it says so and exits 0 --
// never a silent pass. It serves the repository itself on a free port.
/* global EXAMPLE -- the page's own, read inside page.evaluate() */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execSync } from 'node:child_process'
import { presetValues } from '../../pathtracer/quality.js'
const STANDARD = presetValues('standard')      // what the stand-in's settings are given to read as Standard

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
let chromium
try { ({ chromium } = await import('playwright')) } catch {
    try { ({ chromium } = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'playwright/index.mjs')).href)) } catch { }
}
if (!chromium) { console.log('(shell browser check SKIPPED: no playwright. npm i -g playwright to get it.)'); process.exit(0) }

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
const ctx = await b.newContext({ viewport: { width: 1200, height: 800 } })
const p = await ctx.newPage(); const errs = []
p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })
const U = `http://localhost:${port}/lib/shell/example.html`
let failed = 0
const ok = (n, c, x = '') => { if (!c) failed++; console.log((c ? 'ok    ' : 'FAIL  ') + n + (c ? '' : '  ' + x)) }
await p.goto(U); await p.waitForTimeout(800)
let st = await p.evaluate(() => ({ how: EXAMPLE.how, panels: EXAMPLE.S.dock.panels.map(x => x.id) }))
ok('first visit: the default layout', st.how === 'default' && st.panels.join() === 'view,tree', JSON.stringify(st))
ok('the pinned panel has no close button', await p.evaluate(() => [...document.querySelectorAll('.dv-tab')].find(t => t.textContent.includes('View')).querySelector('.dv-default-tab-action').style.display === 'none'))
// open the chart from the View menu
await p.click('.shell-menu:has-text("View")'); await p.waitForTimeout(100)
const items = await p.$$eval('.shell-dropdown .shell-item .shell-label', a => a.map(x => x.textContent))
ok('the View menu lists every panel and Reset', ['View', 'Tree', 'Chart', 'Reset the layout'].every(t => items.includes(t)), items.join('|'))
await p.dispatchEvent('.shell-dropdown .shell-item:has-text("Chart")', 'mouseup'); await p.waitForTimeout(300)
st = await p.evaluate(() => ({ panels: EXAMPLE.S.dock.panels.map(x => x.id), log: EXAMPLE.log.slice() }))
ok('View > Chart opens it, and it is told it is shown', st.panels.includes('chart') && st.log.includes('chart shown'), JSON.stringify(st))
ok('its tab carries its module', await p.evaluate(() => !![...document.querySelectorAll('.dv-tab')].find(t => t.textContent.includes('Chart'))?.querySelector('.shell-mod-optics')))
// pop-out refused for the pinned panel's group
await p.evaluate(() => { const g = EXAMPLE.S.dock.getPanel('view').group; g.element.querySelector('.shell-gact button:nth-child(2)').click() })
await p.waitForTimeout(200)
ok('pop-out of the view is refused, with a reason', (await p.textContent('.shell-status-left')).includes('cannot be popped out'))
// menu command runs; Edit shortcut shown
await p.click('.shell-menu:has-text("File")'); await p.waitForTimeout(100)
ok('a command shows its keys', (await p.textContent('.shell-dropdown')).includes('Ctrl H'))
await p.dispatchEvent('.shell-dropdown .shell-item:has-text("Say hello")', 'mouseup'); await p.waitForTimeout(100)
ok('a command runs from the menu', (await p.textContent('.shell-status-left')) === 'hello')
// a submenu row: its entries beside it when pointed at, one chosen runs and closes both
await p.click('.shell-menu:has-text("File")'); await p.waitForTimeout(100)
await p.hover('.shell-dropdown .shell-item:has-text("Greet")'); await p.waitForTimeout(100)
ok('a submenu row opens its entries beside it', (await p.$$('.shell-dropdown')).length === 2 && (await p.textContent('.shell-dropdown:last-of-type')).includes('Ada'))
await p.dispatchEvent('.shell-dropdown .shell-item:has-text("Ada")', 'mouseup'); await p.waitForTimeout(100)
ok('...an entry chosen runs, and both close', (await p.textContent('.shell-status-left')) === 'hi Ada' && (await p.$$('.shell-dropdown')).length === 0)
ok('a panel registered with menu: false has no View entry', await p.evaluate(() => !EXAMPLE.S.registries.commands.has('view.hidden')))
// save and restore across a reload
await p.waitForTimeout(700)
await p.reload(); await p.waitForTimeout(900)
st = await p.evaluate(() => ({ how: EXAMPLE.how, panels: EXAMPLE.S.dock.panels.map(x => x.id), log: EXAMPLE.log.slice() }))
ok('a reload restores the arrangement, chart included', st.how === 'restored' && st.panels.includes('chart'), JSON.stringify(st))
ok('...and the restored chart is told it is shown, though it registered its watcher after the restore', st.log.includes('chart shown'), JSON.stringify(st.log))
// a saved layout naming a panel this page no longer registers (the raytracer's two optics charts became six):
// restored without it -- dockview skips a group's view that is not in `panels` -- not thrown back to the default
await p.evaluate(() => {
    const j = JSON.parse(localStorage.getItem('shell.example.layout'))
    j.panels.gone = { id: 'gone', contentComponent: 'gone', title: 'Gone' }
    const put = n => n.type === 'leaf' ? (n.data.views.includes('chart') && (n.data.views.push('gone'), n.data.activeView = 'gone')) : n.data.forEach(put)
    put(j.grid.root)
    localStorage.setItem('shell.example.layout', JSON.stringify(j))
})
await p.reload(); await p.waitForTimeout(900)
st = await p.evaluate(() => ({ how: EXAMPLE.how, panels: EXAMPLE.S.dock.panels.map(x => x.id), missing: document.querySelectorAll('.shell-missing').length }))
ok('a layout naming a panel that is gone is restored without it', st.how === 'restored' && st.panels.includes('chart') && !st.panels.includes('gone') && !st.missing, JSON.stringify(st))
// a saved layout holding a tab's old title (the raytracer's Renderer became Render settings, 0.57.0): the title the
// page registers now, and the module's dot, which markTabs finds by that title
await p.evaluate(() => {
    const j = JSON.parse(localStorage.getItem('shell.example.layout'))
    j.panels.chart.title = 'Old chart name'
    localStorage.setItem('shell.example.layout', JSON.stringify(j))
})
await p.reload(); await p.waitForTimeout(900)
st = await p.evaluate(() => {
    const tab = [...document.querySelectorAll('.dv-tab')].find(t => t.textContent.includes('Chart') || t.textContent.includes('Old chart'))
    return { title: EXAMPLE.S.dock.panels.find(x => x.id === 'chart')?.title, tab: tab?.textContent.trim(), dot: !!tab?.querySelector('.shell-mod') }
})
ok('a saved layout\'s old title is replaced by the registered one, its tab marked', st.title === 'Chart' && st.tab === 'Chart' && st.dot, JSON.stringify(st))
// close the chart, reset
await p.evaluate(() => EXAMPLE.S.close('chart')); await p.waitForTimeout(200)
st = await p.evaluate(() => EXAMPLE.log.slice())
ok('closing tells it it is hidden', st.includes('chart hidden'), JSON.stringify(st))
await p.evaluate(() => EXAMPLE.S.layout.reset()); await p.waitForTimeout(300)
ok('Reset the layout: the default again', (await p.evaluate(() => EXAMPLE.S.dock.panels.map(x => x.id).join())) === 'view,tree')
// float and pop out a normal panel
await p.evaluate(() => { EXAMPLE.S.open('chart', { referencePanel: 'view', direction: 'right' }); EXAMPLE.S.dock.addFloatingGroup(EXAMPLE.S.dock.getPanel('chart').group, { width: 300, height: 200 }) }); await p.waitForTimeout(300)
ok('a panel floats', await p.evaluate(() => EXAMPLE.S.dock.getPanel('chart').api.location.type === 'floating'))
const pop = ctx.waitForEvent('page', { timeout: 4000 }).catch(() => null)
await p.evaluate(() => EXAMPLE.S.dock.addPopoutGroup(EXAMPLE.S.dock.getPanel('tree').group, { popoutUrl: '/popout.html' }))
const w = await pop; await p.waitForTimeout(800)
ok('a panel pops out to its own window, the module label carried', !!w && (await w.evaluate(() => !!document.querySelector('.shell-mod'))))
await p.waitForTimeout(700)
const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('shell.example.layout')))
ok('the popped-out panel is not saved (a blocked reopen would lose it)', !saved.panels.tree && !(saved.popoutGroups ?? []).length, JSON.stringify(Object.keys(saved.panels)))
// PRESETS: a preset replaces the arrangement; one of the user's own is saved, applied and deleted
await p.evaluate(() => EXAMPLE.S.layout.apply('Charts')); await p.waitForTimeout(300)
ok('a preset arranges its panels, the pinned one kept', (await p.evaluate(() => EXAMPLE.S.dock.panels.map(x => x.id).sort().join())) === 'chart,view')
ok('...and its switcher button is lit', (await p.evaluate(() => document.querySelector('.shell-preset.on')?.textContent)) === 'Charts')
await p.evaluate(() => EXAMPLE.S.layout.saveAs('Mine')); await p.evaluate(() => EXAMPLE.S.layout.apply('Wide')); await p.waitForTimeout(200)
ok('another preset replaces it', (await p.evaluate(() => EXAMPLE.S.dock.panels.map(x => x.id).join())) === 'view')
await p.evaluate(() => EXAMPLE.S.layout.apply('Mine')); await p.waitForTimeout(300)
ok('a layout the user saved comes back', (await p.evaluate(() => EXAMPLE.S.dock.panels.map(x => x.id).sort().join())) === 'chart,view')
ok('...and is in the switcher', await p.evaluate(() => [...document.querySelectorAll('.shell-preset')].some(b => b.textContent === 'Mine')))
ok('...and deleted', await p.evaluate(() => EXAMPLE.S.layout.remove('Mine') && !EXAMPLE.S.layout.names().includes('Mine')))
// THE PALETTE: Ctrl K, a panel by name, Enter
await p.evaluate(() => EXAMPLE.S.layout.apply('Wide')); await p.waitForTimeout(200)
await p.keyboard.press('Control+k'); await p.waitForTimeout(100)
ok('Ctrl K opens the palette', await p.evaluate(() => !document.querySelector('.shell-palette').hidden))
await p.keyboard.type('tree'); await p.waitForTimeout(100)
ok('...which finds a panel by its name', (await p.evaluate(() => document.querySelector('.shell-palette-item.on')?.textContent)).startsWith('Tree'))
await p.keyboard.press('Enter'); await p.waitForTimeout(300)
ok('...and Enter opens it', await p.evaluate(() => EXAMPLE.S.isOpen('tree') && document.querySelector('.shell-palette').hidden))
// THE VIEW TOOLBAR (2026-10-02): the picture's at the top left -- camera and exposure menus (a caret), the fast
// preview a switch in a pill of its own -- and at the bottom right the ANALYSE drawer: what the view shows and its
// false-colour range, and a host's groups; closed, its button says what is on
const bar = () => p.evaluate(() => [...EXAMPLE.V.bar.querySelectorAll('button')].map(b => ({
    shown: b.style.display !== 'none' && b.parentElement.style.display !== 'none', on: !!b.dataset.on, menu: !!b.dataset.menu,
    pill: b.parentElement !== EXAMPLE.V.bar, text: b.textContent.trim(), tip: b.title })))
const dock = () => p.evaluate(() => {
    const d = EXAMPLE.V.analyse.el, drawer = d.children[0], master = d.children[1].querySelector('button'), badges = d.children[1].querySelector('span')
    return { open: EXAMPLE.V.analyse.isOpen, drawerShown: drawer.style.display !== 'none', masterOn: !!master.dataset.on, masterTip: master.title,
             badges: badges.style.display !== 'none' ? { text: badges.textContent, icons: badges.querySelectorAll('svg').length } : null,
             captions: [...drawer.children].map(c => c.firstChild.textContent),
             buttons: [...drawer.querySelectorAll('button')].map(b => ({ shown: b.style.display !== 'none', on: !!b.dataset.on, menu: !!b.dataset.menu, tip: b.title })) }
})
let t = await bar()
ok('the top strip is the picture\'s: camera, exposure, quality, fast while moving -- icons, but the quality says its mode in a word',
    t.length === 4 && t[0].text === '' && t[1].text === '' && t[3].text === '' && t[2].text !== '', JSON.stringify(t))
ok('...camera, exposure and quality are menus (a caret), not in a pill; fast while moving is a switch in a pill of its own',
    t[0].menu && t[1].menu && t[2].menu && !t[0].pill && !t[1].pill && !t[2].pill && !t[3].menu && t[3].pill, JSON.stringify(t))
ok('...the exposure shown with its EV in the tooltip', t[1].shown && t[1].tip === 'Exposure: EV 9.2', JSON.stringify(t[1]))
/* THE QUALITY MENU (0.59.0): the mode in force in a word on its button, the presets in its popover, a choice through
   RT.set writing only what differs; Custom said when the settings are no preset's */
ok('the stand-in\'s settings are no preset\'s: the word is Custom', t[2].text === 'Custom' && /^Quality: Custom/.test(t[2].tip), JSON.stringify(t[2]))
await p.evaluate(v => { Object.assign(EXAMPLE.state, v); EXAMPLE.V.refresh() }, STANDARD)
t = await bar()
ok('...given Standard\'s, it says Standard', t[2].text === 'Standard', JSON.stringify(t[2]))
const qpop = () => p.evaluate(() => {
    const el = EXAMPLE.V.quality.el
    return { shown: el.style.display !== 'none', presets: [...el.querySelectorAll('[data-preset]')].map(b => ({ id: b.dataset.preset, on: b.getAttribute('aria-pressed') === 'true' })),
             line: el.textContent, box: el.querySelector('input[type=checkbox]')?.checked,
             move: [...el.querySelectorAll('[data-move]')].map(b => ({ m: +b.dataset.move, on: b.getAttribute('aria-pressed') === 'true', disabled: b.disabled })) }
})
await p.evaluate(() => EXAMPLE.V.quality.btn.click()); await p.waitForTimeout(100)
let q = await qpop()
ok('...its menu: the five presets in the Quality box\'s order, Standard lit, the box\'s line, the while-moving row',
    q.shown && q.presets.map(x => x.id).join() === 'sketch,draft,standard,high,optics' && q.presets.filter(x => x.on).map(x => x.id).join() === 'standard'
    && /Full path tracing/.test(q.line) && /While moving/i.test(q.line) && q.move.length === 2, JSON.stringify(q))
await p.evaluate(() => EXAMPLE.V.quality.el.querySelector('[data-preset=sketch]').click()); await p.waitForTimeout(100)
t = await bar()
ok('...Sketch chosen: renderMode 2 through RT.set, the menu closed, the word Sketch',
    (await p.evaluate(() => EXAMPLE.state.renderMode)) === 2 && !(await qpop()).shown && t[2].text === 'Sketch', JSON.stringify(t[2]))
await p.evaluate(() => EXAMPLE.V.quality.btn.click()); await p.waitForTimeout(100)
const before = await p.evaluate(() => JSON.stringify(EXAMPLE.state))
await p.evaluate(() => EXAMPLE.V.quality.el.querySelector('[data-preset=sketch]').click()); await p.waitForTimeout(100)
ok('...the mode in force chosen again writes nothing (no restart)', (await p.evaluate(() => JSON.stringify(EXAMPLE.state))) === before)
await p.evaluate(() => EXAMPLE.V.quality.btn.click()); await p.waitForTimeout(100)
await p.evaluate(() => EXAMPLE.V.quality.el.querySelector('[data-preset=standard]').click()); await p.waitForTimeout(100)
ok('...and Standard back: full again', (await p.evaluate(() => EXAMPLE.state.renderMode)) === 0 && (await bar())[2].text === 'Standard')
// ⚡ FAST WHILE MOVING: a switch for moveFast, on by default (unset reads as on), the mode left alone
ok('fast while moving: offered in the photographic view, on, its tooltip naming Draft', t[3].shown && (await bar())[3].on
    && /^Fast while moving: Draft/.test((await bar())[3].tip), JSON.stringify((await bar())[3]))
const fastClick = () => p.evaluate(() => EXAMPLE.V.bar.querySelectorAll('button')[3].click()).then(() => p.waitForTimeout(100))
await fastClick()
t = await bar()
ok('...a click switches it off (moveFast 0 through RT.set), the mode untouched', (await p.evaluate(() => [EXAMPLE.state.moveFast, EXAMPLE.state.renderMode])).join() === '0,0'
    && !t[3].on && /off/.test(t[3].tip), JSON.stringify(t[3]))
await p.evaluate(() => EXAMPLE.V.quality.btn.click()); await p.waitForTimeout(100)
q = await qpop()
ok('...the menu\'s box follows it, unticked, its Draft | Sketch greyed', q.box === false && q.move.every(x => x.disabled), JSON.stringify(q))
await p.evaluate(() => EXAMPLE.V.quality.el.querySelector('input[type=checkbox]').click()); await p.waitForTimeout(100)
await p.evaluate(() => EXAMPLE.V.quality.el.querySelector('[data-move="2"]').click()); await p.waitForTimeout(100)
q = await qpop(); t = await bar()
ok('...ticked in the menu it is on again, Sketch chosen there: moveMode 2, lit, ⚡ lit and naming Sketch',
    (await p.evaluate(() => [EXAMPLE.state.moveFast, EXAMPLE.state.moveMode])).join() === '1,2' && q.move.find(x => x.m === 2).on
    && t[3].on && /^Fast while moving: Sketch/.test(t[3].tip), JSON.stringify([q, t[3]]))
await p.evaluate(() => EXAMPLE.V.close())
// THE DRAWER: closed at first, its button alone; open, the groups in order, captioned
let d = await dock()
ok('the analysis drawer is closed at first: its button alone, nothing on, so no badge', !d.open && !d.drawerShown && !d.masterOn && !d.badges, JSON.stringify(d))
await p.evaluate(() => EXAMPLE.V.analyse.el.children[1].querySelector('button').click()); await p.waitForTimeout(100)
d = await dock()
ok('...its button opens it, lit: DISPLAY then the measure tool\'s MEASURE, captioned', d.open && d.drawerShown && d.masterOn && d.captions.join() === 'Display,Measure', JSON.stringify(d))
ok('...DISPLAY: the three views, the photographic lit, the range (a menu) hidden in it; MEASURE: pin, area, ruler, clear, save',
    d.buttons.length === 9 && d.buttons[0].on && !d.buttons[1].on && d.buttons[3].menu && !d.buttons[3].shown
    && /^Pin a reading/.test(d.buttons[4].tip) && /^Positions and distances/.test(d.buttons[6].tip)
    && /^Save the readings/.test(d.buttons[8].tip), JSON.stringify(d.buttons))
ok('...with nothing placed, clear and save are greyed out (nothing to clear or save)', await p.evaluate(() =>
    [7, 8].every(i => { const b = EXAMPLE.V.analyse.el.querySelectorAll('button')[i]; return b.disabled && b.style.opacity === '0.35' })))
ok('...a host\'s note is in its mode\'s tooltip, not on the picture', d.buttons[1].tip.includes('a host note'))
await p.evaluate(() => EXAMPLE.V.analyse.el.querySelectorAll('button')[1].click()); await p.waitForTimeout(100)
d = await dock(); t = await bar()
ok('a mode icon switches the view (RT.set) and lights', (await p.evaluate(() => EXAMPLE.state.measureMode)) === 1 && d.buttons[1].on && !d.buttons[0].on)
ok('...in a false-colour view the range is offered, its value in the tooltip, and the exposure is not',
    d.buttons[3].shown && d.buttons[3].tip.startsWith('False-colour range: 1 – 100') && d.buttons[3].tip.includes('lx, 10 bands') && !t[1].shown, JSON.stringify([d.buttons[3], t[1]]))
ok('...nor the quality nor fast while moving (a measuring view traces in full)', !t[2].shown && !t[3].shown, JSON.stringify(t.slice(2)))
await p.evaluate(() => EXAMPLE.V.analyse.el.querySelectorAll('button')[3].click()); await p.waitForTimeout(200)
ok('the range opens a popover with its controls, flat (no folder title) -- UPWARDS, its button being low in the view', await p.evaluate(() => {
    const pop = [...EXAMPLE.V.bar.parentElement.children].find(e => e.textContent.includes('measureBands') && e.style.display === 'block')
    return !!pop && !pop.querySelector('.tp-fldv') && pop.style.top === '' && pop.style.bottom !== ''
}))
// A PIN PLACED (the measure tool's Pin, then a click on the picture); CLOSED, WHAT IS ON STAYS ON, ITS BUTTON SAYS SO
await p.evaluate(() => EXAMPLE.S.open('view')); await p.waitForTimeout(300)     // the view in front: a step above opened the tree
await p.evaluate(() => EXAMPLE.V.analyse.el.querySelectorAll('button')[4].click()); await p.waitForTimeout(50)
const pr = await p.evaluate(() => { const r = EXAMPLE.pic.getBoundingClientRect(); return [r.left + r.width * 0.4, r.top + r.height * 0.4] })
const under = await p.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e === EXAMPLE.pic ? 'the picture' : `${e.tagName} ${e.textContent.slice(0, 60)}` }, pr)
await p.mouse.click(pr[0], pr[1]); await p.waitForTimeout(200)
ok('the measure tool\'s Pin, then a click on the picture: a pin', (await p.evaluate(() => EXAMPLE.MEASURE.pins.length)) === 1, under)
ok('...with something placed, clear and save are offered', await p.evaluate(() => [7, 8].every(i => !EXAMPLE.V.analyse.el.querySelectorAll('button')[i].disabled)))
await p.evaluate(() => EXAMPLE.V.analyse.el.querySelectorAll('button')[4].click())        // Pin off again
await p.evaluate(() => EXAMPLE.V.analyse.el.children[1].querySelector('button').click()); await p.waitForTimeout(100)
d = await dock()
ok('the drawer closed: the lux view stays (no RT.set), the pin stays, the popover in it closes',
    !d.open && !d.drawerShown && (await p.evaluate(() => EXAMPLE.state.measureMode)) === 1 && (await p.evaluate(() => EXAMPLE.MEASURE.pins.length)) === 1
    && await p.evaluate(() => ![...EXAMPLE.V.bar.parentElement.children].some(e => e.textContent.includes('measureBands') && e.style.display === 'block')), JSON.stringify(d))
ok('...its button shows them: the unit of the view, and a pin; the tooltip names them',
    d.badges?.text === 'lx' && d.badges.icons === 1 && /On: Lux on surfaces.*pinned readings/.test(d.masterTip), JSON.stringify(d))
ok('...remembered for the next visit', (await p.evaluate(() => localStorage.getItem('pathtracer.view.analyse'))) === 'closed')
await p.evaluate(() => EXAMPLE.V.open('Show')); await p.waitForTimeout(200)
ok('a host pointing at the range (V.open) opens the drawer, then the popover', (await dock()).open
    && await p.evaluate(() => [...EXAMPLE.V.bar.parentElement.children].some(e => e.textContent.includes('measureBands') && e.style.display === 'block')))
await p.mouse.click(400, 300); await p.waitForTimeout(100)
await p.evaluate(() => { EXAMPLE.V.analyse.el.querySelectorAll('button')[7].click(); EXAMPLE.state.measureMode = 0; EXAMPLE.state.autoExposure = 1; EXAMPLE.V.refresh() })
ok('back in the photographic view, with auto exposure the tooltip has the metered EV', (await bar())[1].tip === 'Exposure: EV 10.4, auto')
ok('a press elsewhere closed the popover', await p.evaluate(() => ![...EXAMPLE.V.bar.parentElement.children].some(e => e.textContent.includes('measureBands') && e.style.display === 'block')))
ok('...the pins cleared (the measure tool\'s Clear), and with nothing on, the open drawer\'s button has no badge',
    (await p.evaluate(() => EXAMPLE.MEASURE.pins.length)) === 0 && !(await dock()).badges)
ok('...and clear and save greyed again', await p.evaluate(() => [7, 8].every(i => EXAMPLE.V.analyse.el.querySelectorAll('button')[i].disabled)))

/* THE RULER (measure/tool.js, 0.68.0): points on surfaces and the distances between them. The stand-in gets a pick and a
   camera: a plane at z = 0 in a mm scene, seen by an orthographic camera looking down -z whose picture is 200 mm across,
   so the picture's (x, y) is the world's (100 x, 100 y, 0) and back -- the pick and genrays.js projectPoint each other's
   inverse, as the real ones are. The left quarter of the picture is sky: the pick finds nothing there. */
await p.evaluate(() => Object.assign(EXAMPLE.RT, {
    scene: { unit: 'mm' },
    cam: { get: () => ({ camtype: 1 }),
           getUniforms: () => ({ invView: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 10, 1], invProjection: [100, 0, 0, 0, 0, 100, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                                 camPos: [0, 0, 10, 1] }) },
    pick: async (x, y) => x < -0.5 ? { hit: false, tag: 0, distance: 0, pos: [0, 0, 0], normal: [0, 0, 0] }
                                   : { hit: true, tag: 0, distance: 10, pos: [100 * x, 100 * y, 0], normal: [0, 0, 1] },
    tolerances: () => ({ tolerance: 1e-5 }),            // metres: 0.01 mm, two decimals
}))
// where a point of the picture is on the page, by the tool's own letterboxing (the canvas is 300 x 150)
const onPage = (x, y) => p.evaluate(([x, y]) => {
    const r = EXAMPLE.pic.parentElement.getBoundingClientRect(), c = EXAMPLE.pic
    const s = Math.min(r.width / c.width, r.height / c.height), dw = c.width * s, dh = c.height * s
    return [r.left + (r.width - dw) / 2 + (x * 0.5 + 0.5) * dw, r.top + (r.height - dh) / 2 + (0.5 - y * 0.5) * dh]
}, [x, y])
const clickAt = async (x, y, shift = false) => {
    const [px, py] = await onPage(x, y)
    if (shift) await p.keyboard.down('Shift')
    await p.mouse.click(px, py)
    if (shift) await p.keyboard.up('Shift')
    await p.waitForTimeout(120)
}
await p.evaluate(() => EXAMPLE.V.analyse.el.querySelectorAll('button')[6].click()); await p.waitForTimeout(50)
d = await dock()
ok('the measure tool\'s Ruler: lit alone', d.buttons[6].on && !d.buttons[4].on && !d.buttons[5].on, JSON.stringify(d.buttons.slice(4)))
await clickAt(0, 0); await clickAt(0.3, 0); await clickAt(0.3, 0.4)
await clickAt(-0.8, 0.2)                                    // the sky: nothing placed
await clickAt(0.1, -0.2, true)                              // Shift: a new line
let R = await p.evaluate(() => EXAMPLE.MEASURE.readings())
const near = (a, b) => Math.abs(a - b) < 0.05             // a pixel of a 200 mm picture is under 0.5 mm; the clicks land within one
ok('...three clicks and a Shift-click: points A, B, C in one line, then D in a new one; the click on the sky placed nothing and named nothing',
    R.points.map(q => q.name + q.line).join() === 'A1,B1,C1,D2' && R.points.every(q => q.unit === 'mm'), JSON.stringify(R.points))
ok('...each where the pick put it, in the scene\'s unit', near(R.points[1].world[0], 30) && near(R.points[1].world[1], 0)
    && near(R.points[2].world[1], 40) && near(R.points[3].world[0], 10) && near(R.points[3].world[1], -20), JSON.stringify(R.points))
ok('...A-B and B-C joined, D on its own: 30 mm and 40 mm, each the step between its ends',
    R.distances.map(s => s.from + '-' + s.to).join() === 'A-B,B-C' && near(R.distances[0].length, 30) && near(R.distances[1].length, 40)
    && R.distances.every(s => s.unit === 'mm' && Math.abs(Math.hypot(...s.delta) - s.length) < 1e-9), JSON.stringify(R.distances))
ok('...the drawer\'s button names them', /points and distances/.test((await dock()).masterTip), (await dock()).masterTip)
const csv = await p.evaluate(() => EXAMPLE.MEASURE.csv()), ab = csv.split('\n').find(r => r.startsWith('distance,A-B,'))?.split(',')
ok('...the CSV has a row a point and a row a distance, its step in x, y, z and its length the value, all 18 columns',
    /^point,A,/m.test(csv) && ab && near(+ab[2], 30) && near(+ab[3], 0) && +ab[4] === 0 && near(+ab[5], 30) && ab[7] === 'mm'
    && csv.split('\n').every(r => r.split(',').length === 18), csv)
await clickAt(0.3, 0)                                       // on B: removed, A and C joined
R = await p.evaluate(() => EXAMPLE.MEASURE.readings())
ok('a click on a point removes it, its neighbours joined: A-C 50 mm', R.points.map(q => q.name).join() === 'A,C,D'
    && R.distances.map(s => s.from + '-' + s.to).join() === 'A-C' && near(R.distances[0].length, 50), JSON.stringify(R.distances))
await p.evaluate(() => EXAMPLE.V.analyse.el.querySelectorAll('button')[6].click())      // the Ruler off: its line ends
await p.evaluate(() => EXAMPLE.V.analyse.el.querySelectorAll('button')[6].click())      // ...and on again
await clickAt(0.5, 0.5)
R = await p.evaluate(() => EXAMPLE.MEASURE.readings())
ok('...the Ruler switched off and on: the next point, E, starts a line of its own', R.points.at(-1).name === 'E' && R.points.at(-1).line === 3
    && R.distances.length === 1, JSON.stringify(R.points))
await p.keyboard.press('Escape'); await p.waitForTimeout(50)
ok('Escape switches the Ruler off', !(await dock()).buttons[6].on)
await p.evaluate(() => EXAMPLE.V.analyse.el.querySelectorAll('button')[7].click())
ok('...Clear takes the points away with the rest', (await p.evaluate(() => EXAMPLE.MEASURE.points.length)) === 0
    && (await p.evaluate(() => [7, 8].every(i => EXAMPLE.V.analyse.el.querySelectorAll('button')[i].disabled))))
await p.evaluate(() => { for (const k of ['scene', 'cam', 'pick', 'tolerances']) delete EXAMPLE.RT[k] })

// THE PARAMETERS: the panel lists the registry, a typed value is written through it, the palette sets one
await p.evaluate(() => EXAMPLE.S.open('params', { referencePanel: 'view', direction: 'right' }, { width: 460 })); await p.waitForTimeout(700)
st = await p.evaluate(() => ({ rows: document.querySelectorAll('.shell-param').length, n: EXAMPLE.P.list().length,
    has: [...document.querySelectorAll('.shell-param-label')].some(e => e.textContent === 'Max Bounces'),
    paths: document.querySelector('.shell-params').textContent.includes('renderer/tracing') }))
ok('the Parameters panel lists every entry by its name, and shows no paths', st.rows === st.n && st.n > 40 && st.has && !st.paths, JSON.stringify(st))
await p.fill('.shell-params-top input', 'max bounce'); await p.waitForTimeout(100)
ok('...filtered by words', (await p.evaluate(() => document.querySelectorAll('.shell-param').length)) === 1)
await p.fill('.shell-param-value', '12.4'); await p.press('.shell-param-value', 'Enter'); await p.waitForTimeout(100)
st = await p.evaluate(() => ({ v: EXAMPLE.states.Tracing.values.maxbounce, f: document.querySelector('.shell-param-value').value }))
ok('a typed value is written, rounded to the step, and shown as it was taken', st.v === 12 && st.f === '12', JSON.stringify(st))
await p.fill('.shell-param-value', 'many'); await p.press('.shell-param-value', 'Enter'); await p.waitForTimeout(100)
ok('...and a value it cannot take is refused, with why', (await p.textContent('.shell-status-left')).includes('takes a number') &&
    (await p.evaluate(() => EXAMPLE.states.Tracing.values.maxbounce)) === 12)
await p.evaluate(() => EXAMPLE.P.write('scene/disc/radius', 2.5)); await p.fill('.shell-params-top input', 'radius'); await p.waitForTimeout(700)
/* THE DISC'S ROW BY WHAT IT IS (radius under Disc), not by being first: this read the first field, true while the disc
   was the only "radius". Since 0.60.0 the renderer's Tracing › Photon map: radius matches too and sorts ahead of it
   (params.js find: the same score, then renderer/ before scene/), and the check read the photon map's 3. */
const rows = await p.evaluate(() => { let group = null; const out = []
    for (const e of document.querySelector('.shell-params-list').children)
        if (e.classList.contains('shell-params-group')) group = e.textContent
        else out.push({ group, label: e.querySelector('.shell-param-label').textContent, value: e.querySelector('.shell-param-value').value })
    return out })
ok('a value set elsewhere shows', rows.find(r => r.group === 'Disc' && r.label === 'radius')?.value === '2.5', JSON.stringify(rows))
await p.keyboard.press('Control+k'); await p.keyboard.type('sun elev = 30'); await p.waitForTimeout(100)
ok('the palette offers to set a setting by name', (await p.evaluate(() => document.querySelector('.shell-palette-item.on')?.textContent)).startsWith('Set Environment › Sun Elevation to 30'))
await p.keyboard.press('Enter'); await p.waitForTimeout(100)
ok('...and Enter sets it', (await p.evaluate(() => EXAMPLE.states.Lighting.values.uSunElevation)) === 30)
await p.evaluate(() => { EXAMPLE.state.measureMode = 1; EXAMPLE.V.refresh() })
await p.keyboard.press('Control+k'); await p.keyboard.type('bands'); await p.waitForTimeout(100)
ok('a setting found by name shows its value, not its path', (await p.evaluate(() => document.querySelector('.shell-palette-item.on .shell-palette-where')?.textContent)) === '10')
await p.keyboard.press('Enter'); await p.waitForTimeout(200)
ok('...and Enter shows where it is set (the range popover, in a false-colour view)', await p.evaluate(() =>
    [...EXAMPLE.V.bar.parentElement.children].some(e => e !== EXAMPLE.V.bar && e.style.display === 'block' && e.textContent.includes('measureBands'))))

// A CHART'S STRIP (lib/pathtracer/strip.js): each kind of control changes the chart, and shows its state
await p.keyboard.press('Escape')
await p.evaluate(() => EXAMPLE.S.open('chart', { referencePanel: 'view', direction: 'below' }, { height: 300 })); await p.waitForTimeout(400)
const sb = sel => p.evaluate(s => document.querySelector(`.chart-strip ${s}`) != null, sel)
ok('the chart panel has its strip, first', await p.evaluate(() => EXAMPLE.strip.element.parentElement.firstChild === EXAMPLE.strip.element))
await p.evaluate(() => [...EXAMPLE.strip.element.querySelectorAll('button')].find(b => b.textContent === 'log').click())
ok('a segmented choice sets its value and lights', await p.evaluate(() => EXAMPLE.CH.scale === 'log' &&
    !![...EXAMPLE.strip.element.querySelectorAll('button')].find(b => b.textContent === 'log').dataset.on))
await p.evaluate(() => EXAMPLE.strip.element.querySelector('button[title="From where the values are"]').click())
ok('a toggle turns on', await p.evaluate(() => EXAMPLE.CH.auto === true))
await p.selectOption('.chart-strip select', { label: 'series b' })
ok('a dropdown sets its value', await p.evaluate(() => EXAMPLE.CH.series === 'b'))
await p.fill('.chart-strip input', '1234'); await p.press('.chart-strip input', 'Enter')
ok('a typed value is applied on Enter', await p.evaluate(() => EXAMPLE.CH.offset === 1234))
await p.evaluate(() => { EXAMPLE.CH.scale = 'lin'; EXAMPLE.strip.refresh() })
ok('refresh shows a value changed elsewhere', await p.evaluate(() =>
    !![...EXAMPLE.strip.element.querySelectorAll('button')].find(b => b.textContent === 'lin').dataset.on))
await p.evaluate(() => EXAMPLE.strip.show('offset', false))
ok('a control that does not apply is hidden', await p.evaluate(() => EXAMPLE.strip.element.querySelector('label').style.display === 'none'))
await p.evaluate(() => { EXAMPLE.strip.show('scale', false); EXAMPLE.strip.show('scale', true); EXAMPLE.strip.show('offset', true) })
ok('...and shown again keeps its own layout: a segmented choice still a row, a field still a row', await p.evaluate(() => {
    const seg = EXAMPLE.strip.element.querySelector('[data-key="scale"]'), [a, b] = seg.querySelectorAll('button')
    return getComputedStyle(seg).display === 'flex' && a.getBoundingClientRect().top === b.getBoundingClientRect().top
        && getComputedStyle(EXAMPLE.strip.element.querySelector('[data-key="offset"]')).display === 'flex'
}))
await p.evaluate(() => EXAMPLE.strip.element.querySelector('button[title="Save (CSV)"]').click())
ok('an action runs', await p.evaluate(() => EXAMPLE.CH.note === 'saved'))
ok('...and the strip is icons and short words: no text longer than a word', await sb('button') &&
    await p.evaluate(() => [...EXAMPLE.strip.element.querySelectorAll('button')].every(b => b.textContent.trim().split(/\s+/).length <= 1)))

// A JOB IN THE STATUS BAR: a bar that moves with its count, one that only says it is working, gone when done
const job = await p.evaluate(() => {
    const S = EXAMPLE.S, q = () => [...document.querySelectorAll('.shell-status .shell-job')]
    S.progress('c', { label: 'compiling', done: 3, total: 12 })
    const one = q().length, text = q()[0]?.textContent, width = q()[0]?.querySelector('i')?.style.width
    S.progress('c', { label: 'compiling', done: 6, total: 12 })
    const moved = q()[0]?.querySelector('i')?.style.width, still = q().length
    S.progress('w', { label: 'waiting' })
    const busy = q()[1]?.querySelector('.shell-job-bar')?.classList.contains('busy')
    // by the clock (the path tracer's compile): the bar at the fraction, and no count beside it
    S.progress('c', { label: 'compiling, about 4 s left', fraction: 0.375, done: 12, total: 13 })
    const fr = { text: q()[0]?.textContent, width: q()[0]?.querySelector('i')?.style.width, busy: q()[0]?.querySelector('.shell-job-bar')?.classList.contains('busy') }
    S.progress('c', null); S.progress('w', null)
    return { one, text, width, moved, still, busy, fr, gone: q().length === 0 }
})
ok('a job shows its label and count in the status bar', job.one === 1 && /compiling 3\/12/.test(job.text) && job.width === '25%', JSON.stringify(job))
ok('...moves with the count, the same bar', job.moved === '50%' && job.still === 1, JSON.stringify(job))
ok('...one with no total only says it is working', job.busy === true, JSON.stringify(job))
ok('...one with a fraction: the bar at it, no count, not just working', job.fr.width === '37.5%' && !/\d+\/\d+/.test(job.fr.text) && /about 4 s left/.test(job.fr.text) && job.fr.busy === false, JSON.stringify(job.fr))
ok('...and each goes when told', job.gone, JSON.stringify(job))

// A PANEL WAITING: dimmed after a moment -- not at once, so a short wait never flashes -- and gone when done
const busy = await p.evaluate(async () => {
    const { busyOverlay } = await import('/lib/shell/shell.js')
    const host = document.querySelector('.shell-panel')
    const B = busyOverlay(host, { delay: 100 })
    B({ label: 'Compiling the scene…', done: 2, total: 13 })
    const early = !!host.querySelector('.shell-busy')
    await new Promise(r => setTimeout(r, 200))
    const o = host.querySelector('.shell-busy')
    const shown = { on: !!o, text: o?.textContent, cover: o && getComputedStyle(o).position === 'absolute' && getComputedStyle(o).pointerEvents !== 'none' }
    B({ label: 'Compiling the scene…', done: 13, total: 13 })
    const width = o?.querySelector('i')?.style.width
    B({ label: 'Compiling the scene — about 9 s left', fraction: 0.25, done: 12, total: 13 })
    const fr = { text: o?.textContent, width: o?.querySelector('i')?.style.width }
    B(null)
    const gone = !host.querySelector('.shell-busy')
    B({ label: 'quick' }); B(null)
    await new Promise(r => setTimeout(r, 200))
    return { early, ...shown, width, fr, gone, quick: !host.querySelector('.shell-busy') }
})
ok('a waiting panel is not covered at once (a short wait never flashes)', busy.early === false, JSON.stringify(busy))
ok('...then covered, saying what it waits on and how far', busy.on && busy.cover && /Compiling the scene/.test(busy.text) && /2 of 13/.test(busy.text), JSON.stringify(busy))
ok('...its bar following the count, and gone when done', busy.width === '100%' && busy.gone, JSON.stringify(busy))
ok('...or a fraction, with no count', busy.fr.width === '25%' && /about 9 s left/.test(busy.fr.text) && !/ of /.test(busy.fr.text), JSON.stringify(busy.fr))
ok('...and a wait over before the delay shows nothing', busy.quick, JSON.stringify(busy))

// THE HOST'S BUTTONS ON THE BAR (S.tools), right after the menus
const tool = await p.evaluate(() => { const t = document.querySelector('.shell-menus + .shell-tools'); return t && t.textContent })
ok('a button of the page\'s sits on the bar right after the menus', tool === '↶', String(tool))
await p.click('.shell-tools button'); await p.waitForTimeout(50)
ok('...and runs', (await p.textContent('.shell-status-left')) === 'tool')
// ?bare: standardCommands({ window: false, layouts: false }) -- the rows out of the menus, the commands kept for the palette
await p.goto(`${U}?bare`); await p.waitForTimeout(800)
const bare = await p.evaluate(() => {
    const C = EXAMPLE.S.registries.commands
    return { menus: [...document.querySelectorAll('.shell-menu')].map(b => b.textContent), float: C.get('window.float'), wide: C.get('view.layout.Wide'), reset: C.get('view.reset') }
})
ok('with window: false the Window menu has no button (nothing is in it)', !bare.menus.includes('Window'), bare.menus.join('|'))
ok('...its verbs kept, menu-less, labelled for the palette', bare.float && !bare.float.menu && /^Window: float/.test(bare.float.label), JSON.stringify(bare.float))
ok('with layouts: false "Layout: Wide" is in no menu but kept', bare.wide && !bare.wide.menu && bare.reset?.menu === 'View', JSON.stringify(bare.wide))
await p.keyboard.press('Control+k'); await p.keyboard.type('layout wide'); await p.waitForTimeout(100)
ok('...and the palette finds it', (await p.textContent('.shell-palette')).includes('Layout: Wide'))
await p.keyboard.press('Escape')

if (errs.length) failed++
console.log(errs.join('\n') || 'no page errors'); await b.close(); server.close()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
