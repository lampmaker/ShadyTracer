// node lib/pathtracer/test/stats.test.mjs
//
// THE RENDER STATS READOUT (core/utilities.js showFPS), on a stand-in DOM: elements with children, a parent and their
// own document, nothing else. What the user saw (2026-10-05): the panel a growing stream of run-together text. Two
// causes, each pinned here --
//   ONE READOUT: it was looked up with document.getElementById at every repaint, so a panel outside the page's document
//     (a tab not shown, a popped-out window) got a new readout four times a second. Repainted any number of times, the
//     mount holds one, made in the mount's own document, its style there too; a new mount gets its own, and the old one
//     is not written to again.
//   A TABLE: the text's newlines were in a div that does not keep them. The rows: Speed, the Picture, Under the
//     cursor, each a heading and readings of three cells, then the warnings LAST (first until 0.59.2: they come and
//     go, and every section under them jumped); a section with nothing to say left out; nothing reading "undefined"
//     or "NaN".

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}

// ---- a stand-in DOM: just what the readout touches
class El {
    constructor(doc, tag) { this.ownerDocument = doc; this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null; this.style = {}; this.id = ''; this.className = ''; this._text = '' }
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); this.children.push(c); c.parentNode = this; c.ownerDocument = this.ownerDocument; return c }
    removeChild(c) { this.children = this.children.filter(x => x !== c); c.parentNode = null; return c }
    replaceChildren(...cs) { for (const c of this.children) c.parentNode = null; this.children = []; cs.forEach(c => this.appendChild(c)) }
    set textContent(t) { this.children = []; this._text = String(t) }
    get textContent() { return this._text + this.children.map(c => c.textContent).join('') }
    *all() { for (const c of this.children) { yield c; yield* c.all() } }
}
class Doc {
    constructor() { this.documentElement = new El(this, 'html'); this.head = this.documentElement.appendChild(new El(this, 'head')); this.body = this.documentElement.appendChild(new El(this, 'body')) }
    createElement(tag) { return new El(this, tag) }
    getElementById(id) { for (const e of this.documentElement.all()) if (e.id === id) return e; return null }
}
const page = new Doc()
globalThis.document = page

const { showFPS, statsRows } = await import('../core/utilities.js')

// ---- one readout, however often it is painted, in a panel that is not in the page's document
const other = new Doc()                         // a popped-out window's document
const panel = other.createElement('div')        // ...and the panel in it, not even attached: a tab not shown
showFPS.mount = panel
for (let i = 0; i < 40; i++) showFPS.refresh()
const huds = panel.children.filter(c => c.id === 'fpsHud')
ok('forty repaints into a panel outside the page\'s document: one readout in it', panel.children.length === 1 && huds.length === 1, `${panel.children.length} children`)
ok('...made in the panel\'s own document, the page\'s untouched', huds[0]?.ownerDocument === other && page.getElementById('fpsHud') === null)
showFPS.mount = page.body.appendChild(page.createElement('div'))
showFPS.refresh()
ok('...its look in each document it is painted in, once', !!page.getElementById('rt-stats-style') && [...page.documentElement.all()].filter(e => e.id === 'rt-stats-style').length === 1)
const firstText = huds[0].textContent
showFPS.refresh()
ok('a new mount gets a readout of its own, and the old one is not written to again', showFPS.mount.children.length === 1 && huds[0].textContent === firstText)
// a readout left in a mount from before (an earlier page state) is taken away, not added to
const again = page.createElement('div'), stale = again.appendChild(page.createElement('div')); stale.id = 'fpsHud'
showFPS.mount = again
showFPS.refresh(); showFPS.refresh()
ok('a readout left in the mount from before is replaced, not added to', again.children.length === 1 && again.children[0] !== stale)

// ---- a table: the sections, each reading three cells, then the warnings
const cost = { rate: 12.34, ms: 81.2, cpu: 1.5, lat: 3.2, takePaced: () => 0.1 }
Object.assign(showFPS, { render: { mode: 1, lampsOnly: true }, flushed: 12, nonfinite: 0, autoEV: 9.7, samples: 120, window: 0, photons: 2.5e6,
                         probe: { L: 123.456, rel: 0.034, nEff: 120 }, lux: false,
                         tolerance: { v: '10.5', u: '\u00b5m', n: 'automatic: 1e-4 of the scene\'s 105 mm' },
                         photonPlan: { lt: { ask: 100, got: 50 }, sources: [{ name: 'LED', ask: 10, got: 10, ready: true, why: 'still compiling' }] } })
const rows = statsRows(cost)
const kinds = rows.map(r => r.warn != null ? 'w' : r.head != null ? 'h' : 'r').join('')
const warns = rows.filter(r => r.warn != null)
ok('the warnings last, every one: Draft, lamps only, flushed, the photons short, a source\'s reason', /^h[hr]*w{5}$/.test(kinds)
    && /^DRAFT/.test(warns[0].warn) && rows.some(r => /FLUSHED: 12 rays/.test(r.warn ?? '')) && rows.some(r => /^50% of the light-tracing/.test(r.warn ?? ''))
    && rows.some(r => r.warn === 'LED: still compiling'), kinds)
ok('...after Speed, the Picture and Under the cursor, in that order', rows.filter(r => r.head).map(r => r.head).join() === 'Speed,Picture,Under the cursor')
ok('...each reading a name, a number and its unit, and what qualifies it apart from the unit', rows.filter(r => r.k).every(r => typeof r.k === 'string' && typeof r.v === 'string' && typeof r.u === 'string')
    && rows.find(r => r.k === 'Per sample').u === 'ms' && rows.find(r => r.k === 'Per sample').n === 'wall clock')
ok('...the numbers as the readout gave them', rows.find(r => r.k === 'Samples').v === '12.3' && rows.find(r => r.k === 'Per sample').v === '81.20'
    && rows.find(r => r.k === 'Luminance').v === '123.5' && rows.find(r => r.k === 'Error').v === '± 3.4' && rows.find(r => r.k === 'Averaged').v === '120')
ok('...nothing reads undefined or NaN', !JSON.stringify(rows).match(/undefined|NaN/))
{
    // THE SURFACE TOLERANCE IN USE, in the Picture: what the facade hands in (core/tolerances.js toleranceInUse)
    const pic = rows.slice(rows.findIndex(r => r.head === 'Picture') + 1, rows.findIndex(r => r.head === 'Under the cursor'))
    const t = pic.find(r => r.k === 'Surface tolerance')
    ok('the Picture says the surface tolerance in use, its unit, and how it was chosen', t?.v === '10.5' && t.u === '\u00b5m' && /automatic: 1e-4 of the scene's 105 mm/.test(t.n), JSON.stringify(t))
    const { toleranceInUse } = await import('../core/tolerances.js')
    const a = toleranceInUse({ eps: 0, epsAuto: 1.0544e-5, sceneUnit: 0.001 }, { extent: 105.44 })
    const b = toleranceInUse({ eps: 1e-6, epsAuto: 1.0544e-5, sceneUnit: 0.001 }, { extent: 105.44 })
    const c = toleranceInUse({ eps: 0, epsAuto: 1e-3, sceneUnit: 1 }, { extent: 424 })
    const d = toleranceInUse({ eps: 0, epsAuto: 1e-3, sceneUnit: 1 }, null)
    ok('...said for the RGBW mixer: 10.5 um, 1e-4 of its 105 mm', a.v === '10.5' && a.u === '\u00b5m' && a.n === 'automatic: 1e-4 of the scene\'s 105 mm', JSON.stringify(a))
    ok('...set by hand, 1 um', b.v === '1' && b.u === '\u00b5m' && b.n === 'set by hand' && b.set)
    ok('...a big scene at the 1 mm cap, a scene with no size the fallback', /the 1 mm cap/.test(c.n) && /gives no size/.test(d.n) && c.v === '1' && c.u === 'mm')
    ok('...and the panel\'s line says the floor too', /15\.3 \u00b5m at 1 m from the origin/.test(a.line), a.line)
}
showFPS.mount = panel
showFPS(4, false, cost)            // the speed instrument handed in, as the loop does (a repaint waits for its clock)...
showFPS.refresh()                  // ...and painted from it now
const hud = panel.children[0], table = hud.children[0]
ok('painted: one table, a row each, a warning and a heading across all three columns, a reading three cells',
    hud.children.length === 1 && table.tagName === 'TABLE' && table.children.length === statsRows(cost).length
    && table.children.every(tr => tr.children.length === 3 || (tr.children.length === 1 && tr.children[0].colSpan === 3)))
const perSample = table.children.find(tr => tr.children[0]?.textContent === 'Per sample')
ok('...a note in a span of its own after the unit', perSample?.children[2].textContent === 'mswall clock' && perSample.children[2].children[0]?.className === 'n')

// ---- nothing to say, nothing said: no cost, no cursor, no warnings
Object.assign(showFPS, { render: null, flushed: 0, nonfinite: 0, autoEV: null, samples: undefined, photons: 0, probe: null, photonPlan: null, tolerance: null })
const bare = statsRows(null)
ok('with nothing but the loop: Speed and its loop rate alone, no empty section', bare.length === 2 && bare[0].head === 'Speed' && bare[1].k === 'Loop')
showFPS.lux = true; showFPS.probe = { L: 10, rel: null, nEff: null }
const lx = statsRows(null).filter(r => r.k)
ok('the illuminance view reads lux, pi times the picture; an error not yet known says so',
    lx.some(r => r.k === 'Illuminance' && r.u === 'lx' && r.v === (Math.PI * 10).toPrecision(4)) && lx.some(r => r.k === 'Error' && r.v === '± ?'))

// ---- the photon map (core/sppm.js): what it held and its radius under Picture; full or cut short a warning, last; off nothing
{
    showFPS.lux = false; showFPS.probe = null
    showFPS.sppm = { stored: 1234567, overflow: 0, cut: 0, capacity: 2e6, radius: 0.0042 }
    const quiet = statsRows(null)
    const row = quiet.find(r => r.k === 'Photon map')
    ok('the photon map: its photons and radius under Picture, no warning while none is dropped', row?.v === '1.235' && row.u === 'M stored'
        && row.n === 'radius 4.20 mm' && !quiet.some(r => r.warn), JSON.stringify(row))
    showFPS.sppm = { stored: 1.7e6, overflow: 0, cut: 0, capacity: 2e6, radius: 0.0042, keep: 0.573 }
    const thin = statsRows(null).find(r => r.k === 'Photon map')
    ok('...a sample that kept a share of its stores says how much (0.61.2), still no warning', thin?.n === 'radius 4.20 mm, 57% kept'
        && !statsRows(null).some(r => r.warn), JSON.stringify(thin))
    showFPS.sppm = { stored: 2e6, overflow: 31000, cut: 7, capacity: 2e6, radius: 0.0042 }
    const loud = statsRows(null).filter(r => r.warn).map(r => r.warn)
    ok('...photons dropped and gathers cut short each said, last, with the setting that holds more',
        loud.length === 2 && /PHOTON MAP FULL: 31,000 photons dropped \(Photon map: photons/.test(loud[0]) && /7 gathers stopped short/.test(loud[1]), JSON.stringify(loud))
    showFPS.sppm = { idle: 'nothing seen through glass or a mirror' }
    const idle = statsRows(null), irow = idle.find(r => r.k === 'Photon map')
    ok('...idle (0.61.0): the word and why, no warning', irow?.v === 'idle' && irow.n === 'nothing seen through glass or a mirror'
        && !idle.some(r => r.warn), JSON.stringify(irow))
    showFPS.sppm = null
    ok('...off: no row, no warning', !statsRows(null).some(r => r.k === 'Photon map' || /PHOTON MAP/.test(r.warn ?? '')))
}

console.log(`render stats: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
