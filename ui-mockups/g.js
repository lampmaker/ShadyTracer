//======================================================================================================================
// MOCKUP G -- the Analysis pane's sections told apart (the user, 2026-09-27: "the different sections in the
// optics -- intensity, map, results -- are hard to tell apart").
//
// The REAL pane (optics/page.js installOpticsPage), five times, over the stand-in optics module and made-up
// data of optics/test/page.html: an analysis is run in each, so every section is filled. Each proposal is a
// stylesheet (g-sections.html) over the same elements; the only thing done here is to wrap the pane's
// sections in an element each, so a stylesheet can box or rule a section -- which the pane would then do
// itself -- and, for D, put them in the order of the work.
//======================================================================================================================
import { PropertyTable } from '../lib/guistuff/propertytable/propertytable.js'
import { installOpticsPage } from '../optics/page.js'
import { FAR } from './mock.js'
import { makeEstimate } from '../lib/pathtracer/optics/estimate.js'
import * as Model from '../builder/model.js'
import { cctDuvToXy, xyToXYZ } from '../lib/pathtracer/core/colorimetry.js'
import { icon } from '../lib/pathtracer/icons.js'

const VARIANTS = [
    { key: 'now', l: '·', name: 'As it is', why: 'Every heading the same small muted capitals -- Intensity, Map, Chart, Results, and the folded tables below. Nothing says where one part ends.' },
    { key: 'bands', l: 'A', name: 'Bands', why: 'Each section opens with a band across the pane: raised, ruled, an icon and its name. The folded tables stay small capitals, so they read as "more".' },
    { key: 'cards', l: 'B', name: 'Boxes', why: 'Each section a box of its own with a gap between. The strongest separation; costs a little width and some quiet.' },
    { key: 'roles', l: 'C', name: 'In · shown · out', why: 'A coloured rule by role: the data that goes IN (teal), how the chart SHOWS it (the accent, like the selected chart\'s edge), what comes OUT (green, tinted ground).' },
    { key: 'steps', l: 'D', name: 'Steps', why: 'In the order of the work, numbered and joined by a line: what to measure, run it, the numbers, then how the selected chart draws them.' },
]

/* the icons the headers carry, as CSS masks */
{
    const root = document.documentElement.style
    for (const n of ['polar', 'map', 'image', 'table', 'play']) {
        const svg = icon(n).outerHTML.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
        root.setProperty(`--ic-${n}`, `url("data:image/svg+xml,${encodeURIComponent(svg)}")`)
    }
}

/* THE SCENE AND THE STAND-IN (as optics/test/page.html) */
const doc = Model.createDoc({ title: 'mockup' })
doc.unit = 'mm'
doc.materials.push({ id: 'm1', type: 'detector', label: 'Screen' })
doc.root.children.push({ id: 'screen', kind: 'object', label: 'Screen', enabled: true })
const RT = { scene: { id: 'built', unit: 'mm', opticsTags: ['screen'] } }
const BUILDER = { doc, model: { serialize: d => JSON.stringify(d) } }
const SCREEN = [0, 1, 2, 3, 4, 5, 6, 7].map(c => [c & 1 ? 30 : -30, c & 2 ? 20 : -20, c & 4 ? 0.5 : -0.5])
let seed = 7
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
const warm = cctDuvToXy(3000, 0), cool = cctDuvToXy(6500, 0.002)
const batchHits = () => Array.from({ length: 5000 }, () => {
    const r = Math.sqrt(-2 * Math.log(rnd() + 1e-12)), t = 2 * Math.PI * rnd(), core = rnd() < 0.55
    const rr = core ? 5 * Math.sqrt(rnd()) : 4.5 * r, f = Math.min(1, rr / 10), flux = 0.16 / 5000
    return { pos: [rr * Math.cos(t) * 1.25 + 3, rr * Math.sin(t), 0], flux, dir: [0, 0, -1], tag: 1,
             xyz: xyToXYZ(warm[0] + (cool[0] - warm[0]) * f, warm[1] + (cool[1] - warm[1]) * f, flux) }
})
const standIn = () => {
    const O = {
        settings: { bounces: 8, marchSteps: 1000, eps: 0, maxDist: 0 }, picture: {}, compiling: false, far: null, _liveLoop: null,
        lightPicture() { }, setSources() { }, setRayData() { }, dropRayData() { }, setFar() { }, live() { }, drawPaths() { },
        readPaths: async () => null, readHits: async () => ({ hits: batchHits() }),
        // as index.js hands an estimate a batch (optics/estimate.js), with the made-up numbers
        estimate: makeEstimate,
        run: async ({ rays, batches, onBatch, into }) => {
            const E = into ?? makeEstimate()
            const far = { mode: FAR.mode, material: 0, nC: FAR.nC, nG: FAR.nG, axis: [0, 0, 1], c0: [1, 0, 0], flux: FAR.flux, emitted: 1000, unit: 'lm' }
            let r = null
            for (let b = 1; b <= batches; b++) {
                E.add({ unit: 'lm', rays, emitted: 1000, escaped: 860, absorbed: 100, lost: 0, detected: 40, detectorHits: 5000,
                        counts: { interactions: 3 * rays }, objects: [{ index: 1, name: 'screen', incident: 40, absorbed: 0, hits: 5000 }],
                        materials: [{ index: 2, incident: 40, absorbed: 0, hits: 5000 }] }, far)
                r = { ...E.results(), mode: 'run' }
                O.far = E.farField()
                await onBatch(r, b, { hits: () => ({ hits: batchHits() }), last: b === batches })
            }
            return r
        },
    }
    return O
}
const tableIn = e => { const t = new PropertyTable({ container: e }); Object.assign(t.element.style, { fontSize: '13px', width: '100%' }); return t }
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e }

const row = document.getElementById('row')
for (const V of VARIANTS) {
    const col = el('div', 'col')
    const h = el('h2'); h.append(el('span', 'l', V.l), V.name)
    const host = el('div', `shell-panel ana v-${V.key}`)
    col.append(h, el('p', '', V.why), host)
    row.appendChild(col)
    installOpticsPage(host, { RT, WG: null, BUILDER, tableIn, boxes: { corners: () => SCREEN }, optics: standIn() })
    /* THE PANE'S SECTIONS, each wrapped: run bar and its note, the data, the chart, the results, the rest */
    /* B was chosen and built: the pane now boxes its own sections (.shell-ana). Taken off here, so each
       column still shows only its own stylesheet over the pane as it was */
    host.classList.remove('shell-ana')
    /* the pane's sections, by what they are: the chart's section left the pane on 2026-10-02 (a chart's settings
       are on the chart now), so this column's "How it is shown" is empty -- the record of what was compared */
    const [runbar, note, data] = [...host.children]
    const results = host.querySelector('.ana-results'), lower = host.querySelector('.ana-more'), chart = host.querySelector('.ana-chart')
    const wrap = (cls, ...kids) => { const w = el('div', `sec ${cls}`); host.appendChild(w); w.append(...kids); return w }
    const sec = {
        run: wrap('sec-run', runbar, note), data: wrap('sec-data', data), chart: wrap('sec-chart', ...(chart?.children ?? [])),
        results: wrap('sec-results', ...results.children), more: wrap('sec-more', lower),
    }
    chart?.remove(); results.remove()
    if (V.key === 'roles') {
        sec.data.before(el('div', 'role', 'What goes in'))
        sec.chart.before(el('div', 'role', 'How it is shown'))
        sec.results.before(el('div', 'role', 'What comes out'))
    }
    if (V.key === 'steps') {
        // the order of the work, and a heading for the run of its own
        sec.run.prepend(el('div', 'shell-head hd', 'Run'))
        host.append(sec.data, sec.run, sec.results, sec.chart, sec.more)
    }
    setTimeout(() => runbar.querySelector('button').click(), 300)
}
