//======================================================================================================================
// THE OPTICS PAGE -- the technical ray trace: its rays over the picture, its analysis, its charts.
//
// The sources are the scene's (model version 10): every light object -- a rectangle, a disc or a ray file.
// Three places, by what each is for (UI_PLAN.md section 9, and mockup F -- ui-mockups/f-analyse.html --
// which the user chose):
//   RAYS      a VIEW: a few thousand rays from the sources, live -- traced again every frame, so they
//             follow every move in the Builder. The viewport's rays icon shows them; the popover
//             beside it holds how many, how far, and how they are drawn. Nothing they trace reaches a
//             chart or a number.
//   ANALYSIS  ONE PANE (the host's `host`) for the MEASUREMENT: the run bar (how many rays, a number times
//             a multiplier; ▶; Live, the analysis again and again with every chart following each edit; when
//             it ran), the data every chart is made from (what feeds the far field and its grid; which
//             detector the map is of, its area, cells and smoothing) and the results as cards. Folded
//             below them: the sources, the totals and
//             the engine's limits. An analysis is many rays, every one to the end, in batches; each
//             number the mean over the batches with the standard error from their spread. Its result
//             is kept here (ANA), apart from the module's own, which every trace -- the rays' too --
//             replaces.
//   CHARTS    PANELS OF THEIR OWN, of six kinds: the map, the polar diagram, I against gamma, the
//             profiles, the rings, the encircled flux. Each is a line of ITS OWN CONTROLS -- what it
//             shows and how, its saves, ⧉ and ✕ -- over a canvas, with one line of readout under the
//             pointer. One of each always; MORE OF A KIND MADE AT WILL (a chart's ⧉, or Optics › New
//             chart), each with its own settings -- an illuminance map beside a CCT map (charts.js: the
//             list, kept between visits; the host registers a panel per entry before its layout is
//             restored). Pointing at one moves its siblings' marks: an angle on the far field's, a place
//             or a radius on the map's. On a map the button held down moves the point the profiles go
//             through; Shift-drag zooms.
// They were two panels each holding a strip and several charts of uncontrolled size (the user,
// 2026-09-27: "multiple charts in a single pane is not optimal"); a docked panel per chart is sized by
// the dock like anything else.
// Objects are named after the builder's nodes; the engine only knows pick tags, the builder knows what
// they are.
//
// Everything that traces is lib/pathtracer/optics; this file is controls, charts and a table.
//======================================================================================================================
import { createOptics } from '../lib/pathtracer/optics/index.js'
import { detectorMap } from '../lib/pathtracer/optics/detmap.js'
import { UNITS } from '../lib/pathtracer/core/photometry.js'
import { rgbToXYZ, XYZtoxy, xyToXYZ, xyToCctDuv, cctDuvToXy, mixToTarget } from '../lib/pathtracer/core/colorimetry.js'
import { sourceTable, faceSource } from '../builder/sources.js'
import { placeRays } from '../lib/pathtracer/optics/sources.js'
import { RAYFILES } from './rayfiles.js'
import { intensity, planeCurve, farStats, intensityCSV } from '../lib/pathtracer/optics/farfield.js'
import { drawPolar, polarAngleAt, nearestPoint, polarStyle } from '../lib/pathtracer/optics/polar.js'
import { drawCartesian, cartesianAngleAt } from '../lib/pathtracer/optics/cartesian.js'
import { profile, radial, encircled, isolux, peak, centroid, cellAt, cellSe, virtualPlane, rangeOfPoints, rangeOfView } from '../lib/pathtracer/optics/illum.js'
import { drawXY, xyAt, nearestX, ticks } from '../lib/pathtracer/optics/xychart.js'
import { drawHeatmap, heatmapAt } from '../lib/pathtracer/optics/heatmap.js'
import { quantityMap, quantitiesOf, MAP_QUANTITIES, cellChroma } from '../lib/pathtracer/optics/quantities.js'
import { chartStrip, saveCanvases, saveText } from '../lib/pathtracer/strip.js'
import { stampedName } from '../lib/filename.js'
import { icon, iconButton, iconPill, lit } from '../lib/pathtracer/icons.js'
import { OPTICS_CHARTS, FAR_CHARTS, MAP_CHARTS, chartSet } from './charts.js'

/* THE CHARTS' KINDS and the set of charts that exist (charts.js), for the host to register a panel per chart
   before its layout is restored (a saved layout names its panels, and one not registered yet is left out of
   it) and to open from its menus */
export { OPTICS_CHARTS, chartSet }

/* THE PANE'S LOOK -- lib/shell/shell.css's .shell-chart, .shell-readout, .shell-runbar, .shell-head, .shell-cards:
   in the shell's stylesheet, because a popped-out window gets the main window's sheets and nothing else */
const div = (cls, html = '') => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; return d }

/* A number and its error, to the precision the error allows. */
const fmt = (s, unit = '') => {
    if (s == null) return '–'
    const v = typeof s === 'number' ? s : s.value, e = typeof s === 'number' ? null : s.se
    if (!Number.isFinite(v)) return '–'
    const digits = e && e > 0 ? Math.max(0, Math.min(6, 1 - Math.floor(Math.log10(e)))) : 3
    const n = Math.abs(v) >= 1e5 ? v.toExponential(3) : v.toFixed(digits)
    return e && e > 0 ? `${n} ± ${Math.abs(v) >= 1e5 ? e.toExponential(1) : e.toFixed(digits)}${unit}` : `${n}${unit}`
}

/* HOW AN ANALYSIS IS CUT INTO BATCHES. A batch needs ~480 bytes of ray buffers per ray (three ray
   buffers and a hit buffer, index.js ensureBuffers), so 250 000 rays is 120 MB -- the most one
   batch is given. At least 4 batches, or the spread says nothing about the error. */
const BATCH_MAX = 250000, BATCH_MIN_COUNT = 4
const batchesFor = total => {
    const batches = Math.max(BATCH_MIN_COUNT, Math.ceil(total / BATCH_MAX))
    return { batches, rays: Math.max(1, Math.round(total / batches)) }
}
/* THE RAY COUNT'S MULTIPLIERS, and the most an analysis traces: 50 million, the old millions field's top, which was a
   slider's range -- memory does not grow with it (a batch's buffers are BATCH_MAX's), only the time */
const TIMES = { '× 1': 1, '× 10': 10, '× 100': 100, '× 1k': 1e3, '× 10k': 1e4, '× 100k': 1e5, '× 1M': 1e6, '× 10M': 1e7 }
const RAYS_MAX = 5e7

/**
 * @param host      the Analysis pane's element (it scrolls)
 * @param tableIn   (el, opts) -> a property table in it, in the host's style; opts the table's own (`boxes`)
 * @param charts    { set, el: { [id]: the chart panel's element }, onVisible(id, fn(seen)),
 *                  add(chart, nearId) -> element, remove(id) } -- the host's panels, one per chart of `set`
 *                  (charts.js chartSet; without one, the six kinds' first alone). `add` registers a panel for a
 *                  chart made here and opens it beside nearId's; `remove` lets an added one's go. Without `add`
 *                  no chart is made here. A chart without an element is simply not drawn.
 * @param optics    optional: the optics module to use instead of making one (a test's stand-in)
 * @param mixing    optional { el, onVisible(fn(seen)) }: the Colour mixing tool's panel -- a window of its own
 *                  (Tools menu), not a folder in the Analysis pane; without it there is no colour mixing
 */
export function installOpticsPage(host, { RT, WG, BUILDER, tableIn, onEdit = () => { }, charts = null, boxes = null, view = null,
                                          optics = null, mixing = null }) {
    /* `optics`: a stand-in for the optics module -- optics/test/page.check.mjs drives this page in a browser
       with no GPU, and a made-up far field and hits, so the charts and the pane are run by something */
    const O = optics ?? createOptics(RT, WG)

    /* THE PANE, top to bottom: the run bar and its line of status; the data; the results; then the table
       of what folds away (sources, totals, limits). Made first, empty, because the sections below fill them
       as they are defined. A chart's settings are on the chart (attach), not here: they were, as the
       SELECTED chart's, until the user asked for them on the chart itself (2026-10-02). */
    /* THE RAYS AN ANALYSIS TRACES, a number times a multiplier (the user, 2026-10-04: "1M, 10M etc." typed as
       millions, where a live analysis wants 100 or 1000) -- ▶ Run's in all, and Live's in every round */
    const runbar = div('shell-runbar', '<input class="count">'
        + `<select class="times">${Object.entries(TIMES).map(([t, x]) => `<option value="${x}">${t}</option>`).join('')}</select>`
        + '<button class="run" title="Run the analysis: trace that many rays, in batches, for numbers with error bars">▶ Run</button>'
        + '<button class="live">Live</button><button class="sum">Σ</button><span class="when"></span>')
    const raysIn = runbar.querySelector('.count'), timesIn = runbar.querySelector('.times'), whenEl = runbar.querySelector('.when')
    const runBtn = runbar.querySelector('.run'), liveBtn = runbar.querySelector('.live'), sumBtn = runbar.querySelector('.sum')
    const noteEl = div('shell-note')
    const dataEl = document.createElement('div')
    const resHead = div('shell-head', 'Results'), cardsEl = div('shell-cards'), resNote = div('shell-note')
    const lowerEl = document.createElement('div')
    /* EACH SECTION A BOX OF ITS OWN (mockup G, B -- the user's choice, 2026-09-27): every heading was the
       same small muted capitals and Intensity, Map, the chart and the results ran together. The data's
       two are its table's folders, boxes as the property table draws them (`boxes`, the Render settings' and
       Properties' look); the results' is wrapped here, in the same colours (lib/shell/shell.css .shell-ana);
       what folds away stays plain below, which is what makes it read as "more". */
    const secResults = div('ana-sec ana-results')
    secResults.append(resHead, cardsEl, resNote)
    dataEl.className = 'ana-data'; lowerEl.className = 'ana-more'
    host.classList.add('shell-ana')
    host.append(runbar, noteEl, dataEl, secResults, lowerEl)
    // the results' heading icon, as a mask the stylesheet puts before it (a popped-out window keeps it: inline)
    host.style.setProperty('--ic-table', `url("data:image/svg+xml,${encodeURIComponent(icon('table').outerHTML.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'))}")`)
    const dataTable = tableIn(dataEl, { boxes: true })
    const table = tableIn(lowerEl)
    const say = t => { noteEl.textContent = t; noteEl.title = t }
    /* A HAZE BOX (0.62.0; builder/hazebox.js) is the picture's alone: this trace (optics/kernels.js) has a chain of its own
       and does not see the dust yet, so a run over a scene with one says so where its result is read */
    const hazeNote = () => RT.scene?.haze ? 'the haze box is not traced here: these numbers are without its dust (the picture has it)' : ''

    /* rays: the look -- traced and drawn, so few enough to retrace on every change.
       steps: how many interactions each follows. count x times: the analysis's rays (TIMES). */
    const T = { rays: 2000, steps: 6, count: 1, times: 1e6, bounces: O.settings.bounces, marchSteps: O.settings.marchSteps,
                eps: O.settings.eps, maxDist: O.settings.maxDist }
    // opl: how far along its optical path each ray is drawn, in the scene's unit; at the slider's maximum, all of it
    /* show: the rays drawn over the picture, LIVE -- traced again and again, so they follow every change
       (the viewport's rays icon). A view: nothing it traces reaches a chart or the results. */
    const V = { show: false, colour: 0, brightness: 0.02, opl: T.maxDist > 0 ? T.maxDist : 1000 }
    /* THE ANALYSIS'S RESULT, kept apart from the rays': every trace the optics module runs replaces its
       own O.far, O.results and hit buffer, so a live look at 2 000 rays would have replaced the charts'
       million-ray analysis with itself. The charts and the results table read this, and only the
       analysis writes it. */
    const ANA = { far: null, results: null, rays: 0, at: null, sig: null, stale: false, secs: null }
    /* STALE: the scene has changed since the analysis ran -- an edit, or another scene -- so its numbers
       are of a scene that no longer exists. The charts still show them, under a line saying so. */
    const sceneSig = () => { try { return BUILDER?.doc ? BUILDER.model.serialize(BUILDER.doc) : '' } catch { return '' } }

    /* THE SCENE'S SOURCES: every light object (model version 10, builder/lights.js;
       builder/sources.js sourceTable), read from the document at every trace -- so a sheet moved
       with the handles, a flux typed in its panel, a new light added, is in the next trace.
       This page has no source of its own any more. */
    const SRC = { text: '' }
    const placedKey = new Map()                 // ray set id (a copy's key) -> the key its placed rays are under
    const sourcesFromDoc = () => {
        const doc = BUILDER?.doc
        if (!doc) return { list: [], skipped: [] }
        const { sources: all, skipped } = sourceTable(doc)
        /* A RAY SET: its file (loaded in the Builder, or stored from last time), its rays placed by the
           node's frame -- metres to scene units, times the node's scale -- and registered with the
           optics module under a key that changes when the frame does. A file not here yet is asked
           for from storage and listed as not loaded until it arrives. */
        const mpu = UNITS[doc.unit] ?? 1
        const sources = []
        for (const x of all) {
            if (x.kind !== 'rayset') { sources.push(x); continue }
            const f = RAYFILES.get(x.file)
            if (!f) { RAYFILES.restore(x.file); skipped.push({ id: x.id, label: x.label, reason: `ray file '${x.file}' not loaded: choose it in the Builder` }); continue }
            const frame = { origin: x.origin, u: x.u, v: x.v, w: x.normal, scale: x.scale / mpu }
            // a copy of one in an array is placed on its own, under its own key (builder/sources.js INSIDE AN ARRAY)
            const own = x.key ?? x.id
            const key = `${own}|${x.file}|${JSON.stringify(frame)}`
            if (placedKey.get(own) !== key) {
                if (placedKey.has(own)) O.dropRayData(placedKey.get(own))
                O.setRayData(key, placeRays(f.rays, frame))
                placedKey.set(own, key)
            }
            sources.push({ ...x, rays: key, flux: x.flux ?? f.total, unit: f.header.fluxUnit, header: f.header })
        }
        // a sheet in the scene starts its rays off it (builder/sources.js faceSource, shared with the bench)
        const describe = x => x.kind === 'rayset' ? { type: 'rayset', rays: x.rays, flux: x.flux, emitN: x.emitN, colour: x.colour } : faceSource(x)
        // the trace starts from every light, and the picture light-traces every one (codegen LIGHTS:
        // the camera's paths count a light's face only where these photons cannot connect)
        const list = sources.map(describe)
        return { list, pictureList: list, sources, skipped }
    }
    /* a light's colour as a datasheet gives it: CCT and Duv near white, else xy */
    const colourOf = rgb => {
        const xy = rgb && XYZtoxy(rgbToXYZ(rgb))
        if (!xy) return ''
        const t = xyToCctDuv(xy[0], xy[1])
        return Math.abs(t.duv) <= 0.02 && t.inRange ? `, ${Math.round(t.cct)} K Duv ${t.duv >= 0 ? '+' : ''}${t.duv.toFixed(3)}`
            : `, xy ${xy[0].toFixed(3)} ${xy[1].toFixed(3)}`
    }
    const describeSources = ({ sources = [], skipped = [] }) => {
        const lines = sources.map(x => (x.kind === 'rayset'
            ? `${x.label}: ${x.header.count.toLocaleString()} rays from ${x.file}, ${x.flux.toPrecision(4)} ${x.unit === 'W' ? 'W (taken as lm)' : 'lm'}`
              + `${x.emitN > 1 ? `, into n ${x.emitN}` : ''}${x.header.rotated ? ' -- the file\'s rotation applied, convention unverified' : ''}`
            : `${x.label}: ${x.flux.toPrecision(4)} lm, ${x.distribution === 'cosine' ? (x.n === 1 ? 'Lambertian' : `cos^${x.n}`) : x.distribution}`
            + `${x.halfAngle < 90 && x.distribution !== 'collimated' ? ` within ${x.halfAngle} deg` : ''}${x.twoSided ? ', both faces' : ''}`
            + `${x.emitN > 1 ? `, into n ${x.emitN}` : ''}${x.transparent ? ', transparent' : ''}`) + colourOf(x.colour))
        for (const k of skipped) lines.push(`${k.label}: not traced -- ${k.reason}`)
        return lines.length ? lines.join('\n') : 'none: add a light in the Builder (+ > Lights)'
    }

    /* the scene's maximum distance (model version 9, `optics.maxDist`): when the scene showing
       changes, its value becomes the page's, and an edit here is written back into the scene */
    let lastDoc = null
    const fromDoc = () => {
        const doc = BUILDER?.doc
        if (doc === lastDoc) return false
        lastDoc = doc
        if (Number.isFinite(doc?.optics?.maxDist)) T.maxDist = doc.optics.maxDist
        try { table.refresh?.() } catch { } try { raysTable?.refresh?.() } catch { }
        return true
    }
    // a scene switch in the Builder is not an event this page hears, so look now and then
    /* THE PICTURE IS LIT BY THE SCENE'S LIGHT-TRACED SOURCES, always -- not a toggle: their light
       reaches the picture no other way (codegen LIGHTS). Kept in step with the scene
       here, twice a second, and at every trace; a sheet dragged with the handles restarts the
       picture once, when it lands. */
    O.picture.applies = () => RT.scene?.id === 'built'      // the builder's scene, not a bench's
    O.lightPicture(true)
    let found = { sources: [] }
    const followScene = () => {
        found = sourcesFromDoc()
        O.setSources(found.list, found.pictureList)
        return found
    }
    setInterval(() => {
        if (fromDoc()) retrace()
        // an edit since the analysis makes its numbers stale: the run bar says so, once, when it happens
        const stale = !!ANA.at && sceneSig() !== ANA.sig
        if (stale !== ANA.stale) { ANA.stale = stale; sayWhen() }
        const d = describeSources(followScene())
        if (d !== SRC.text) { SRC.text = d; try { table.refresh?.() } catch { } try { raysTable?.refresh?.() } catch { } }
        raysSay()
        oplFollowRange()
        // the data's lists follow the scene's lights and detector materials
        buildData()
        if (mixSeen) mixBuild()
    }, 500)

    const push = () => {
        fromDoc()
        followScene()
        Object.assign(O.settings, { bounces: T.bounces | 0, marchSteps: T.marchSteps | 0, eps: T.eps,
                                    // the rays' trace records every ray it draws; an analysis records as
                                    // many, and the module never draws them (index.js publish)
                                    pathRays: Math.max(1, T.rays | 0),
                                    maxDist: Math.max(0, +T.maxDist || 0),
                                    // an analysis records up to 64 legs per recorded ray: 20 000 rays x
                                    // 1000 legs would be 640 MB of vertices for a picture nobody reads
                                    pathVerts: Math.min(66, Math.max(2, (T.bounces | 0) + 2)) })
        O.setFar(farSettings())
    }

    const fs = table.addFolder({ title: 'Sources' })
    fs.addBinding(SRC, 'text', { readonly: true, label: '', multiline: true, rows: 3 })

    /* COLOUR MIXING: three of the scene's lights, a target colour (CCT + Duv, or xy) and a total flux;
       "Set the fluxes" writes each light's flux into the scene (one undo step). Exact, because light
       adds in XYZ: one 3 x 3 solve (core/colorimetry.js mixToTarget -- the user's own luminaire tool's
       matrix). Out of reach when the target lies outside the triangle the three lights span, which is
       said, and nothing is written. Above the choice: what ALL the scene's lights make together now.
       A TOOL, NOT PART OF THE ANALYSIS (the user, 2026-09-27): it changes the scene's lights rather than
       measuring anything, so it is a panel of its own opened from the Tools menu, kept up to date only
       while it is seen. */
    const MX = { a: '', b: '', c: '', by: 'cct', cct: 4000, duv: 0, x: 0.3805, y: 0.3768, total: 1000, text: '' }
    const fm = mixing?.el ? tableIn(mixing.el) : null
    // what it did or why it did not, in its own window: the Analysis pane's status line may not be in sight
    const mixNote = div('shell-note')
    mixing?.el?.appendChild(mixNote)
    const mixSay = t => { mixNote.textContent = t }
    let mixSeen = false
    const mixLights = () => {
        const doc = BUILDER?.doc
        if (!doc) return []
        // every light with its exact colour and its flux (a ray file without its own: the file's)
        return sourceTable(doc).sources.map(x => ({ id: x.id, label: x.label, xy: XYZtoxy(rgbToXYZ(x.colour)),
            flux: x.flux ?? (x.kind === 'rayset' ? RAYFILES.get(x.file)?.total : 0) ?? 0 })).filter(x => x.xy)
    }
    const colourText = xy => {
        const t = xyToCctDuv(xy[0], xy[1])
        return `xy ${xy[0].toFixed(4)} ${xy[1].toFixed(4)}`
            + (t.inRange && Math.abs(t.duv) <= 0.05 ? ` · ${Math.round(t.cct)} K, Duv ${t.duv >= 0 ? '+' : ''}${t.duv.toFixed(4)}` : '')
    }
    const mixTarget = () => MX.by === 'cct' ? cctDuvToXy(MX.cct, MX.duv) : [MX.x, MX.y]
    const mixPlan = () => {
        const L = mixLights()
        const lines = []
        const sum = [0, 0, 0]
        for (const l of L) { const v = xyToXYZ(l.xy[0], l.xy[1], l.flux); for (let k = 0; k < 3; k++) sum[k] += v[k] }
        const now = XYZtoxy(sum)
        lines.push(now ? `now, all ${L.length} lights together: ${sum[1].toPrecision(4)} lm, ${colourText(now)}` : 'no lights with flux in the scene')
        const pick = [MX.a, MX.b, MX.c].map(id => L.find(l => l.id === id))
        if (pick.some(p => !p)) { lines.push('choose three lights'); return { lines } }
        if (new Set([MX.a, MX.b, MX.c]).size < 3) { lines.push('choose three DIFFERENT lights'); return { lines } }
        const t = mixTarget()
        const m = mixToTarget(pick.map(p => p.xy), t, Math.max(0, +MX.total || 0))
        lines.push(`target ${colourText(t)}, ${(+MX.total).toPrecision(4)} lm`)
        lines.push(...pick.map((p, i) => `${p.label}: ${m.flux[i].toPrecision(4)} lm  (now ${(+p.flux).toPrecision(4)})`))
        if (!m.reachable) lines.push('OUT OF REACH: the target lies outside the triangle of these three colours -- a flux would be negative')
        const others = L.filter(l => !pick.includes(l) && l.flux > 0)
        if (others.length) lines.push(`the other ${others.length} light(s) are left as they are, and add to what the scene shows`)
        return { lines, pick, m }
    }
    const mixRefresh = () => { MX.text = mixPlan().lines.join('\n'); try { fm?.refresh?.() } catch { } }
    let mixKey = null
    /* the dropdowns list the scene's lights: rebuilt when the lights (or their names) change */
    const mixBuild = () => {
        if (!fm) return
        const L = mixLights()
        const key = JSON.stringify(L.map(l => [l.id, l.label]))
        if (key === mixKey) return mixRefresh()
        mixKey = key
        for (const c of [...fm.children]) c.dispose()
        const ids = L.map(l => l.id)
        if (!ids.includes(MX.a)) MX.a = ids[0] ?? ''
        if (!ids.includes(MX.b)) MX.b = ids[1] ?? ''
        if (!ids.includes(MX.c)) MX.c = ids[2] ?? ''
        const options = Object.fromEntries([['(none)', ''], ...L.map(l => [`${l.label} (${l.id})`, l.id])])
        for (const [k, label] of [['a', 'light 1'], ['b', 'light 2'], ['c', 'light 3']])
            fm.addBinding(MX, k, { label, options }).on('change', mixRefresh)
        fm.addBinding(MX, 'by', { label: 'target', options: { 'CCT + Duv': 'cct', 'CIE xy': 'xy' } }).on('change', () => { mixKey = null; mixBuild() })
        if (MX.by === 'cct') {
            fm.addBinding(MX, 'cct', { label: 'CCT (K)', min: 1000, max: 15000, step: 10 }).on('change', mixRefresh)
            fm.addBinding(MX, 'duv', { label: 'Duv', min: -0.05, max: 0.05, step: 0.0005 }).on('change', mixRefresh)
        } else {
            fm.addBinding(MX, 'x', { label: 'x', min: 0.001, max: 0.8, step: 0.0001 }).on('change', mixRefresh)
            fm.addBinding(MX, 'y', { label: 'y', min: 0.001, max: 0.9, step: 0.0001 }).on('change', mixRefresh)
        }
        fm.addBinding(MX, 'total', { label: 'total flux (lm)', min: 0 }).on('change', mixRefresh)
        fm.addBinding(MX, 'text', { readonly: true, label: '', multiline: true, rows: 7 })
        fm.addButton({ title: 'Set the fluxes' }).on('click', () => {
            const { pick, m } = mixPlan()
            if (!pick || !m) return mixSay('choose three different lights first')
            if (!m.reachable) return mixSay('out of reach -- nothing changed')
            const doc = BUILDER.doc
            /* a light whose brightness is from its component's parameters (builder/bind.js light.flux, light.luminance;
               0.69.0): a flux set here would be undone by the next resolve, so it is the parameter that has to change */
            const held = pick.filter(p => Object.keys(BUILDER.model.find(doc, p.id)?.node.bind || {}).some(t => t === 'light.flux' || t === 'light.luminance'))
            if (held.length) return mixSay(`${held.map(p => p.label).join(', ')}: brightness from parameters -- change the group's parameter, or unbind it`)
            try {
                // a light given by luminance becomes one given by flux: the flux is what is set
                pick.forEach((p, i) => BUILDER.model.setLight(doc, p.id, { flux: m.flux[i] }))
            } catch (e) { return mixSay(e.message) }
            BUILDER.syncSources?.()
            for (const p of pick) BUILDER.live(p.id, 'light')
            BUILDER.commit?.('colour mix')
            onEdit()
            mixRefresh()
            mixSay(`set: ${pick.map((p, i) => `${p.label} ${m.flux[i].toPrecision(4)} lm`).join(', ')}`)
            if (O.results) retrace()
        })
        mixRefresh()
    }
    // the lights' list is made when the panel is seen: they may have changed while it was not
    mixing?.onVisible?.(v => { mixSeen = v; if (v) { mixKey = null; mixBuild() } })

    /* A CHANGE OF SETTINGS (the scene switched, a limit, a colour mix) goes to the module; the live rays
       pick it up at their next trace, the analysis at its next run. Nothing is traced for it here: the
       rays are traced only while they are shown, and numbers only when asked for (▶). */
    const retrace = () => push()

    /* THE RAYS, LIVE, while shown: `rays` rays through `steps` interactions from the sources, traced
       again every frame so moving anything in the Builder shows at once. A trace that fails (a scene
       mid-compile) stops them and says why. */
    let raysBtn = null, raysTable = null
    /* WHAT THE RAYS CANNOT SHOW, SAID WHERE THEY ARE SWITCHED ON (the user, 2026-10-03): the trace starts only from
       the lights sourceTable takes, and one it skips -- under group code, a ray file not loaded -- or a scene with
       no light at all drew no rays and no word in the view; the reason was only in the Analysis pane's Sources,
       out of sight. While the rays are on, the drawer's RAYS group says it under its buttons (viewtools
       analyse.note), each skipped light with its reason; with nothing amiss it says nothing. */
    const raysProblem = () => {
        const { sources = [], skipped = [] } = found
        const lines = skipped.map(k => `${k.label}: not traced -- ${k.reason}`)
        if (!sources.length) lines.unshift(skipped.length ? 'no light to trace:' : 'no light to trace: add a light in the Builder (+ > Lights)')
        return lines.length ? lines.join('\n') : null
    }
    /* only when what it says changes: it is called every half second (the interval above), and each mark repaints the
       drawer's badges and its button's title */
    let raysSaid = null
    const raysSay = () => {
        const problem = V.show ? raysProblem() : null
        const key = `${V.show}\n${problem}`
        if (key === raysSaid) return
        raysSaid = key
        view?.analyse.note?.('rays', problem)
        // shown with the analysis drawer closed too: its button says so, and what is wrong (its first line, without
        // the colon that leads into the list below it)
        view?.analyse.mark('rays', V.show ? { icon: 'rays', tip: problem ? `rays (${problem.split('\n')[0].replace(/:$/, '')})` : 'rays' } : null)
    }
    const showRays = on => {
        V.show = !!on
        if (raysBtn) lit(raysBtn, V.show)
        if (!V.show) { raysSay(); O.live(false); O.drawPaths(false); return }
        push()
        raysSay()
        O.drawPaths(true, { colorMode: V.colour, brightness: V.brightness, maxOpl: oplLimit() })
        // an analysis has the module: Live traces them between its rounds, and ▶ Run's end starts them (pauseRays)
        if (held) return
        O.live(true, () => { push(); return { rays: T.rays | 0, steps: T.steps | 0 } }, (r, err) => {
            if (err) { say(`rays stopped: ${err.message}`); showRays(false) }
        })
    }
    /* an analysis needs the module to itself (a second trace while one runs is refused): the live rays
       are paused for it and resumed after -- and, while it HOLDS it, not started by their switch either: they were,
       and the trace refused them, so the rays switched on during a ▶ Run switched themselves off again */
    let held = false
    const pauseRays = async () => {
        held = true
        O.live(false); await O._liveLoop
        return () => { held = false; if (V.show) showRays(true) }
    }
    /* THE RAYS BETWEEN TWO ROUNDS OF A LIVE ANALYSIS: the rays' own loop would be refused while a round traces, so
       Live traces them itself, once a round. What is drawn is only ever a trace's (index.js publish): the round's
       batches between two of these are never seen. */
    const raysBetween = async () => {
        const scene = RT.scene
        push()
        try {
            await O.trace({ rays: T.rays | 0, steps: T.steps | 0 })
        } catch (e) {
            // a scene swapped under them, as under a round (liveRounds): traced again after the next round
            if (RT.scene !== scene || RT.sceneBusy?.()) return
            say(`rays stopped: ${e.message}`); showRays(false)
        }
    }

    /* THE PATH-LENGTH SLIDER: each ray drawn up to an OPTICAL path length (sum of n * length) -- so the light moves
       through the system as a front, glass holding it back. Only a redraw: the paths carry their path length
       (optics/paths.js). A LENGTH IN THE SCENE'S UNIT, not a share (the user, 2026-10-09): it was a share of the
       maximum distance, or of the longest ray traced without one, so the same setting meant another place after
       every trace and every edit of the distance. Its range is the slider's own, set by right-clicking the row (the
       property table's min, max, step); AT THE SLIDER'S MAXIMUM, every ray whole -- the slider's end is "all". */
    let oplRow = null, oplMax = null
    const oplLimit = () => oplRow && V.opl < oplRow.max ? V.opl : Infinity
    /* a range set in that menu changes no value and sends no change, so the cut would wait for the slider's next move:
       looked at with the rest, twice a second. A slider at its end before stays there -- "all" stays all. */
    const oplFollowRange = () => {
        if (!oplRow || oplRow.max === oplMax) return
        if (oplMax != null && V.opl >= oplMax) V.opl = oplRow.max
        oplMax = oplRow.max
        try { oplRow.refresh() } catch { }
        O.drawPaths(V.show, { maxOpl: oplLimit() })
    }
    /* THE MAXIMUM DISTANCE, edited from two places: the Analysis pane's Advanced, and the rays' popover -- it cuts
       every drawn ray short, and folded away in Advanced the user could not find what was cutting them (2026-10-09).
       One value (T.maxDist, the scene's optics.maxDist), so each place refreshes the other. */
    const maxDistChanged = () => {
        const doc = BUILDER?.doc
        if (doc && doc === lastDoc) { try { BUILDER.model.setOpticsMaxDist(doc, Math.max(0, +T.maxDist || 0)) } catch { } }
        retrace()
        try { table.refresh?.() } catch { } try { raysTable?.refresh?.() } catch { }
        // the path slider is a share of it when it is set
        O.drawPaths(V.show, { maxOpl: oplLimit() })
    }

    /* THE RAYS' OWN SETTINGS: a popover beside the rays icon, the RAYS group of the view's analysis drawer
       (lib/pathtracer/viewtools.js V.analyse; on the toolbar at the top left until 2026-10-02, the user: the rays
       "belong together" with what the view shows and the measuring). How many, how far, how far along each path,
       colour and brightness. */
    if (view) {
        raysBtn = iconButton('rays', 'Rays over the picture, live (click: show or hide)', () => showRays(!V.show))
        const pop = view.popover('Rays', 'tune', 'The rays\' settings')
        view.analyse.add('rays', 'Rays', iconPill(raysBtn), pop.btn)
        const f = raysTable = pop.table
        f.addBinding(T, 'rays', { label: 'rays', min: 1, max: 20000, step: 1 })
        f.addBinding(T, 'steps', { label: 'interactions', min: 0, max: 64, step: 1 })
        f.addBinding(T, 'maxDist', { label: 'max distance (0 = none)', min: 0 }).on('change', maxDistChanged)
        oplRow = f.addBinding(V, 'opl', { label: 'path shown (end = all)', min: 0, max: V.opl })
            .on('change', () => O.drawPaths(V.show, { maxOpl: oplLimit() }))
        oplMax = oplRow.max
        // light colour × flux: the light's colour at the brightness of what the ray still carries (optics/paths.js)
        f.addBinding(V, 'colour', { label: 'colour by', options: { 'what is left': 0, 'step': 1, 'plain': 2, 'light colour': 3, 'light colour × flux': 4 } })
            .on('change', () => O.drawPaths(V.show, { colorMode: V.colour }))
        /* additive: a line's brightness adds up where rays overlap, so a dense bundle saturates at
           what reads as faint for one ray -- the default is low for that reason (0.25 was 10x too bright) */
        f.addBinding(V, 'brightness', { label: 'brightness', min: 0.0002, max: 1, step: 0.0002 })
            .on('change', () => O.drawPaths(V.show, { brightness: V.brightness }))
        // the lights the rays start from, and the ones they do not with why: the Analysis pane's Sources, here too
        f.addBinding(SRC, 'text', { readonly: true, label: 'lights', multiline: true, rows: 3 })
        lit(raysBtn, false)
    }

    /* NO "SOURCE LIGHTS THE PICTURE" TOGGLE ANY MORE: every source is a builder light, and the
       picture light-traces every light by its photons (R.photonSources), with its distribution --
       the camera sees only a light's face directly (codegen emitMaterials, LIGHTS). */

    /* THE NAMES: the engine reports pick tags and material ids, the builder knows what they are */
    const nameOfTag = (i, fallback) => {
        const id = (RT.scene?.opticsTags ?? RT.scene?.tags)?.[i - 1]
        if (!id) return i ? fallback : 'untagged'
        const find = n => n?.id === id ? n : (n?.children || []).map(find).find(Boolean)
        const node = BUILDER?.doc ? find(BUILDER.doc.root) : null
        return node?.label || id
    }
    const nameOfMat = i => {
        if (i === 0) return 'air'
        if (i === 1) return 'default'
        return BUILDER?.doc?.materials?.[i - 2]?.label || `material ${i}`
    }
    const num = v => v == null || !Number.isFinite(v) ? '–' : Math.abs(v) < 1e-9 ? '0' : Math.abs(v) >= 1e5 ? v.toExponential(3) : +v.toPrecision(4) + ''
    // a value with its error when it has one, to the precision the error allows
    const pm = (v, e) => e != null && e > 0 ? fmt({ value: v, se: e }) : num(v)

    //==================================================================================================================
    // THE DATA every chart is made from: in the Analysis pane, once -- not repeated on each chart
    //==================================================================================================================
    /* THE FAR FIELD (optics/farfield.js). WHAT FEEDS IT is a choice, because which rays count is the
       user's question: every ray that leaves the scene, or every ray arriving at one DETECTOR material --
       a surface made to catch the light of interest (the rays through the lens, not the ones off the
       mount). Either way a ray is binned by its DIRECTION alone: the luminaire seen from far away.
       THE FRAME is a light's: gamma = 0 along its axis (+z, where it shines), C = 0 along its +x.
       FLIPPED (the user, 2026-10-04: the beam "sometimes arrives at the wrong side of the material", its peak at
       gamma +-180): gamma = 0 along the light's -z instead -- a light facing into a reflector sends its beam back
       along -z. C = 0 stays, so the frame turns half a turn about it (the kernel's C = 90 is axis x C0, index.js
       farLayout): gamma becomes 180 - gamma and C = 90 and C = 270 change places -- a turn, never a mirror image.
       CUSTOM (the user, the same day: "lights are not always on the same axis as the targets"): an axis typed as a
       vector in the world's x, y, z (`axisText`, read into `axisV`); C = 0 then the world's +x made square to it, or
       +y where the axis runs along x (index.js farLayout).
       What feeds it, its axis and its direction and its grid need the analysis run again (farChanged); its unit and
       rotational symmetry are how it is READ -- the results' too -- and only redraw (farRead). */
    const F = { from: 'escaped', light: 0, flip: false, axisV: [0, 0, 1], axisText: '0, 0, 1', dG: 1, dC: 5, unit: 'cd', rot: false }
    /* custom is -1, not a word: the binding is a number's (its first value, 0), and Tweakpane reads every option of it
       as a number -- 'custom' came back 0, the first light. Its binding says min -1: the property table holds a number
       given no range to 0..100 of its own (propertytable.js bindingPrepper), and -1 was put back to 0 */
    const isCustom = () => F.light === -1
    const symmetry = () => F.rot ? 'rotational' : 'none'
    const DG = { '0.25°': 0.25, '0.5°': 0.5, '1°': 1, '2°': 2, '2.5°': 2.5, '5°': 5 }
    const DC = { '1°': 1, '2.5°': 2.5, '5°': 5, '10°': 10, '15°': 15, '22.5°': 22.5, '30°': 30, '45°': 45, '90°': 90 }
    const detectorMats = () => (BUILDER?.doc?.materials || []).map((m, i) => ({ m, id: i + 2 }))
        .filter(({ m }) => m.type === 'detector' || m.type === 'limiter')
    const fromOptions = () => {
        const from = { 'escaping rays': 'escaped' }
        for (const d of detectorMats()) from[`at ${d.m.label || `material ${d.id}`}`] = `mat:${d.id}`
        return from
    }
    const lightOptions = () => {
        const lights = found.sources || [], light = {}
        lights.forEach((x, i) => { light[x.label] = i })
        if (!lights.length) light['world +z'] = 0
        light['custom (a vector)'] = -1
        return light
    }
    const farSettings = () => {
        const x = isCustom() ? null : (found.sources || [])[F.light]
        const mode = F.from === 'escaped' ? 'escaped' : F.from.startsWith('mat:') ? 'detector' : 'off'
        return { mode, material: mode === 'detector' ? +F.from.slice(4) : 0,
                 nC: Math.round(360 / F.dC), nG: Math.round(180 / F.dG) + 1,
                 axis: (isCustom() ? F.axisV : x?.normal ?? [0, 0, 1]).map(v => F.flip ? -v : v), c0: x?.u ?? [1, 0, 0] }
    }

    /* THE MAP (optics/illum.js, detmap.js): OF a detector's hits -- the objects the analysis's hits
       landed on -- or of the FAR FIELD ON A PLANE h metres off along the photometric axis (illum.js
       virtualPlane: exact for a point source, off by the luminaire's size over h). The two drawn the
       same way are the near-field / far-field check.
       area: what a detector's map covers -- 'detector', its whole measured box (builder/boxes.js), or
       'lit', where the light landed. zoom: a rectangle dragged on the map, in what the map shows; null
       for none. THE RESOLUTION AND SMOOTHING: the histogram, or a kernel density estimate -- Gaussian or
       Epanechnikov, `bandwidth` in cells -- or the photon-map estimate from the k nearest hits.
       None of it traces: the map is made again from the hits the analysis kept.
       THE POINT the profiles, rings and encircled flux are taken about (`through`): the brightest cell,
       the flux-weighted centre, or wherever the map was last clicked -- one point for the three, so
       the map marks one. */
    const MP = { cells: 64, smooth: 'none', bandwidth: 1.5, k: 32 }
    const IL = { src: 'tag:0', h: 1, half: 0, through: 'peak', area: 'detector', zoom: null }
    const isPlane = () => IL.src === 'plane'
    const tagOf = () => isPlane() ? 0 : +IL.src.slice(4) || 0
    /* the hits the map is made from (the analysis's), and where the map was last clicked */
    let lastMap = null, ilClicked = null
    const detectorTags = () => [...new Set((lastMap?.hits || []).map(h => h.tag))].sort((a, b) => a - b)
    const sourceOptions = () => {
        const opts = {}
        for (const t of detectorTags()) opts[nameOfTag(t, `tag ${t}`)] = `tag:${t}`
        if (!Object.keys(opts).length) opts['(no detector hits yet)'] = 'tag:0'
        opts['the far field on a plane'] = 'plane'
        return opts
    }
    /* the lists follow the scene (its detector materials, its lights) and the analysis (the objects hit):
       a choice that is no longer in its list goes back to the first */
    const keepChoices = () => {
        if (!Object.values(fromOptions()).includes(F.from)) F.from = 'escaped'
        if (!isCustom() && F.light >= Math.max(1, (found.sources || []).length)) F.light = 0
        const tags = detectorTags()
        if (!isPlane() && !tags.includes(tagOf())) IL.src = `tag:${tags[0] ?? 0}`
    }
    // a slider's change while it is dragged is not the last: a map remade per pixel of drag is not wanted
    const done = f => e => { if (e?.last !== false) f() }
    /* THE DATA'S TABLE, made again when a list in it changes or a choice changes which rows apply (the
       plane has a distance, a kernel a width, k nearest a k): Tweakpane's option lists are fixed when
       bound. A choice that reshapes it does so a frame after its own event, not inside it. */
    let dataKey = null
    const buildData = (force = false) => {
        keepChoices()
        const key = JSON.stringify([fromOptions(), lightOptions(), sourceOptions(), isPlane(), MP.smooth, isCustom()])
        if (!force && key === dataKey) return false
        dataKey = key
        for (const c of [...dataTable.children]) c.dispose()
        const reshape = () => requestAnimationFrame(() => buildData())
        const fi = dataTable.addFolder({ title: 'Intensity', icon: icon('polar').outerHTML })
        fi.addBinding(F, 'from', { label: 'from', options: fromOptions() }).on('change', farChanged)
        fi.addBinding(F, 'light', { label: 'axis', options: lightOptions(), min: -1 }).on('change', () => { farChanged(); reshape() })
        /* a custom axis: three numbers, by commas or spaces, not all 0 -- anything else said, and the field put back */
        if (isCustom()) fi.addBinding(F, 'axisText', { label: 'axis x, y, z' }).on('change', () => {
            const v = String(F.axisText).split(/[\s,;]+/).filter(Boolean).map(Number)
            if (v.length === 3 && v.every(Number.isFinite) && Math.hypot(...v) > 0) { F.axisV = v; farChanged() }
            // the table is rebuilt only when its shape changes: forced, to show the vector as it is again
            else { say('axis: three numbers, x, y and z, not all 0'); F.axisText = F.axisV.join(', '); requestAnimationFrame(() => buildData(true)) }
        })
        fi.addBinding(F, 'flip', { label: 'flip direction' }).on('change', farChanged)
        fi.addBinding(F, 'dG', { label: 'γ step', options: DG }).on('change', farChanged)
        fi.addBinding(F, 'dC', { label: 'C step', options: DC }).on('change', farChanged)
        fi.addBinding(F, 'unit', { label: 'unit', options: { 'cd': 'cd', 'cd/klm': 'cd/klm' } }).on('change', farRead)
        fi.addBinding(F, 'rot', { label: 'rotational symmetry' }).on('change', farRead)
        const fm = dataTable.addFolder({ title: 'Map', icon: icon('map').outerHTML })
        fm.addBinding(IL, 'src', { label: 'of', options: sourceOptions() }).on('change', () => { IL.zoom = null; mapChanged(); reshape() })
        if (isPlane()) {
            fm.addBinding(IL, 'h', { label: 'distance (m)', min: 0.001 }).on('change', done(mapChanged))
            fm.addBinding(IL, 'half', { label: 'half-width (m, 0 = auto)', min: 0 }).on('change', done(mapChanged))
        } else fm.addBinding(IL, 'area', { label: 'area', options: { 'whole detector': 'detector', 'lit area': 'lit' } })
            .on('change', () => { IL.zoom = null; mapChanged() })
        fm.addBinding(MP, 'cells', { label: 'cells', min: 8, max: 256, step: 1 }).on('change', done(mapChanged))
        if (!isPlane()) {
            fm.addBinding(MP, 'smooth', { label: 'smoothing', options: { 'none': 'none', 'Gaussian': 'gauss', 'Epanechnikov': 'epan', 'k nearest': 'knn' } })
                .on('change', () => { mapChanged(); reshape() })
            if (MP.smooth === 'gauss' || MP.smooth === 'epan')
                fm.addBinding(MP, 'bandwidth', { label: 'width (cells)', min: 0.25, max: 16, step: 0.25 }).on('change', done(mapChanged))
            if (MP.smooth === 'knn') fm.addBinding(MP, 'k', { label: 'k nearest', min: 4, max: 1024, step: 1 }).on('change', done(mapChanged))
        }
        return true
    }

    //==================================================================================================================
    // THE CHARTS: one panel each, the canvas filling it, one line of readout
    //==================================================================================================================
    /* EVERY CHART, by id (charts.js chartSet): its kind, its own settings `s`, its panel. The first of each kind
       always exists; more are made (a chart's ⧉, or Analysis › New chart) and taken away (its ✕). */
    const SET = charts?.set ?? chartSet()
    const KIND = Object.fromEntries(OPTICS_CHARTS.map(c => [c.key, c]))
    const first = type => SET.list().find(c => c.type === type)
    const panes = {}                              // id -> { id, type, s, el, plot, c, readout, layout, visible, drag, ro, strip, refreshBar }
    /* THE POINTER, shared: an angle on the far field's charts, and on the map's a place on the map (every map
       marks it: two maps side by side are read at the same place), a radius about its point (rings and encircled
       flux mark the same one) or a profile's x */
    const hover = { angle: null, pos: null, r: null, px: null }
    const draw = (...ids) => {
        for (const id of ids) {
            const p = panes[id]
            if (!p?.visible || p.c.clientWidth < 10 || p.c.clientHeight < 10) continue
            try { p.layout = DRAW[p.type](p) } catch (e) { console.error(`[optics] the ${id} chart:`, e) }
        }
    }
    /* every chart of these kinds */
    const drawKinds = (...types) => draw(...Object.values(panes).filter(p => types.includes(p.type)).map(p => p.id))
    const drawFarCharts = () => drawKinds(...FAR_CHARTS)
    const drawMapCharts = () => drawKinds(...MAP_CHARTS)
    /* a chart with nothing to show says why, in the middle of its panel */
    const blank = (p, text) => {
        const c = p.c, dpr = globalThis.devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight
        c.width = Math.round(W * dpr); c.height = Math.round(H * dpr)
        const g = c.getContext('2d')
        g.setTransform(dpr, 0, 0, dpr, 0, 0)
        g.fillStyle = '#16191c'; g.fillRect(0, 0, W, H)
        g.fillStyle = '#5d6b77'; g.font = '12px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'
        const lines = [], words = String(text).split(/\s+/)
        let line = ''
        for (const w of words) { const t = line ? `${line} ${w}` : w; if (g.measureText(t).width > W - 40 && line) { lines.push(line); line = w } else line = t }
        if (line) lines.push(line)
        lines.forEach((l, i) => g.fillText(l, W / 2, H / 2 + (i - (lines.length - 1) / 2) * 17))
        p.readout.textContent = ''
        return null
    }

    /* THE FAR FIELD AS READ: the analysis's, in the unit and symmetry asked for, made once per change of
       those (a hover redraw reuses it) */
    let farMemo = null
    const readFar = () => {
        const far = ANA.far
        if (!far) return null
        if (farMemo?.far !== far || farMemo.unit !== F.unit || farMemo.rot !== F.rot)
            farMemo = { far, unit: F.unit, rot: F.rot, R: intensity(far, { symmetry: symmetry(), perKlm: F.unit === 'cd/klm' }) }
        return farMemo
    }
    const planesOf = t => {
        const v = String(t).split(/[\s,;]+/).map(Number).filter(Number.isFinite).map(c => ((c % 360) + 360) % 360)
        const u = [...new Set(v)].slice(0, 9)
        return u.length ? u : [0]
    }
    const curvesOf = (R, planes) => planes.map(C => ({ label: `C${+C.toFixed(2)}–C${+((C + 180) % 360).toFixed(2)}`, points: planeCurve(R, C).points }))
    const farChart = drawer => p => {
        const f = readFar()
        if (!f) return blank(p, 'No far field yet: ▶ Run in the Analysis pane.')
        const s = p.s, planes = planesOf(s.planes), S = farStats(f.far, f.R, planes), curves = curvesOf(f.R, planes)
        const L = drawer(p.c, { curves, unit: f.R.unit, log: s.log, decades: s.decades | 0, hover: hover.angle,
                                levels: [{ at: 0.5 * S.max.I, label: '50 %' }, { at: 0.1 * S.max.I, label: '10 %' }] }, s)
        // which half of the plane the pointer is on: the angle is signed, + for C, - for C + 180
        p.readout.innerHTML = hover.angle == null ? '' : curves.map((k, i) => {
            const q = nearestPoint(k.points, hover.angle), C = planes[i]
            return `<span style="color:${polarStyle(i).colour}">■</span> C${+((q.a < 0 ? C + 180 : C) % 360).toFixed(2)} γ ${Math.abs(q.a).toFixed(1)}°: `
                + `${pm(q.I, q.se)} ${f.R.unit}`
        }).join(' · ')
        return L
    }

    /* THE MAP BEING SHOWN, made once per change of what it is made from (hover redraws reuse it).
       A detector map's coordinates are shifted to the world's where its axes are the world's (a
       floor reads in x and y from the scene's origin); otherwise they are about the hits' centre. */
    let ilMemo = null
    const currentIllum = () => {
        if (isPlane()) {
            if (!ANA.far) return { why: 'No far field yet: ▶ Run in the Analysis pane (Intensity › from says what feeds it).' }
            const key = [IL.h, IL.half, MP.cells, F.rot].map(String).join('|')
            if (ilMemo?.key === key && ilMemo.far === ANA.far) return ilMemo.v
            const R = intensity(ANA.far, { symmetry: symmetry(), perKlm: false })
            const m = { ...virtualPlane(ANA.far, R, { h: +IL.h || 1, half: +IL.half || 0, cells: MP.cells | 0 }), lengthUnit: 'm' }
            const v = { m, name: `the far field ${+IL.h} m off` }
            ilMemo = { key, far: ANA.far, v }
            return v
        }
        const hits = lastMap?.hits
        if (!hits?.length) return { why: 'No detector hits yet: give a surface a detector material (Builder), then ▶ Run in the Analysis pane.' }
        /* WHAT IT COVERS: a zoom when there is one; else the whole detector, from its measured box --
           the node the hits' tag names, its box's corners in the world (boxes.js; null until measured,
           and then the map is where the light landed) -- else where the light landed */
        const tag = tagOf()
        const id = (RT.scene?.opticsTags ?? RT.scene?.tags)?.[tag - 1]
        const corners = IL.area === 'detector' && id && boxes && BUILDER?.doc ? boxes.corners(BUILDER.doc, id) : null
        const range = IL.zoom ? rangeOfView(IL.zoom) : corners ? rangeOfPoints(corners) : null
        const covers = IL.zoom ? 'zoomed' : corners ? 'the whole detector'
            : IL.area === 'detector' ? 'where the light landed (the detector\'s box is not measured yet)' : 'where the light landed'
        const key = [tag, MP.cells, MP.smooth, MP.bandwidth, MP.k, RT.scene?.unit, IL.area, JSON.stringify(IL.zoom), JSON.stringify(corners)].join('|')
        if (ilMemo?.key === key && ilMemo.hits === hits) return ilMemo.v
        const list = hits.filter(h => h.tag === tag)
        const mpu = UNITS[RT.scene?.unit] ?? 1
        const m0 = list.length >= 3 ? detectorMap(list, { cells: MP.cells | 0, metresPerUnit: mpu, unit: lastMap.unit,
                                                           smooth: MP.smooth, bandwidth: MP.bandwidth, k: MP.k | 0, range }) : null
        let v
        if (!m0) v = { why: 'Too few hits on that detector for a map.' }
        else {
            const offA = m0.axisNames ? m0.origin[0] * m0.u[0] + m0.origin[1] * m0.u[1] + m0.origin[2] * m0.u[2] : 0
            const offB = m0.axisNames ? m0.origin[0] * m0.v[0] + m0.origin[1] * m0.v[1] + m0.origin[2] * m0.v[2] : 0
            const m = { ...m0, range: { a: [m0.range.a[0] + offA, m0.range.a[1] + offA], b: [m0.range.b[0] + offB, m0.range.b[1] + offB] },
                        lengthUnit: RT.scene?.unit ?? 'units', axisNames: m0.axisNames ?? ['u (fitted)', 'v (fitted)'] }
            v = { m, covers, name: nameOfTag(tag, `tag ${tag}`) }
        }
        ilMemo = { key, hits, v }
        return v
    }
    /* THE POINT the profiles, rings and encircled flux are taken about: one for every chart, found on the
       illuminance whatever a chart shows -- the brightest cell is a bright one */
    const mapPoint = m => IL.through === 'clicked' && ilClicked && cellAt(m, ...ilClicked) ? ilClicked
        : IL.through === 'centroid' ? centroid(m) : peak(m)
    const setPoint = at => { ilClicked = at; if (IL.through !== 'clicked') { IL.through = 'clicked'; syncAbout() } }
    /* WHAT A CHART READ OFF THE MAP SHOWS, by its own settings `s` (charts.js; the user, 2026-10-02: the quantity
       per chart, an illuminance map beside a CCT map). The quantity's map (quantities.js: the illuminance, or a
       colour quantity when the hits carry colour -- a choice the map cannot show falls back to E) is made ONCE per
       map and quantity, and what is read off it once per set of levels or per point, whichever chart asks: every
       pointer move redraws every map, and at 256 x 256 cells the isolines and the two sorts by distance are
       65 000 cells each. Each is made when a chart asks for it, so a chart not drawn costs nothing.
       paint false: the two that paint the light (True colour, Colour only) are a map's alone -- read off as
       numbers they are the illuminance, so a profile of them is the illuminance's. */
    let QM = { m: null }
    const mapView = (s = {}, { paint = true } = {}) => {
        const cur = currentIllum()
        if (!cur?.m) return { why: cur?.why ?? '' }
        const m = cur.m
        if (QM.m !== m) QM = { m, by: new Map(), ptKey: null, pt: null, enc: null }
        let key = quantitiesOf(m).includes(s.q) ? s.q : 'E'
        if (!paint && MAP_QUANTITIES[key].paint) key = 'E'
        // the two that paint the light keep E, and everything read off the map reads it as E
        const QD = MAP_QUANTITIES[key], isE = key === 'E' || !!QD.paint
        const target = key !== 'dTarget' || s.target === 'mix' ? null
            : s.target === 'cct' ? cctDuvToXy(+s.cct, +s.duv) : [+s.x, +s.y]
        const qk = `${key}|${target ? target.join() : ''}`
        let D = QM.by.get(qk)
        if (!D) QM.by.set(qk, D = { qm: { ...quantityMap(m, key, { target }), digits: QD.digits }, contours: new Map(), ptk: null })
        const pk = `${IL.through}|${ilClicked}`
        if (QM.ptKey !== pk) Object.assign(QM, { ptKey: pk, pt: mapPoint(m), enc: null })
        const pt = QM.pt, ptk = pt.join()
        if (D.ptk !== ptk) Object.assign(D, { ptk, rad: null, profA: null, profB: null })
        const qm = D.qm
        const fmtQ = v => v == null || !Number.isFinite(v) ? '–' : QD.digits != null ? v.toFixed(QD.digits) : num(v)
        const yAxis = isE ? {} : { yMin: 'auto', yFormat: v => v.toFixed(Math.max(0, (QD.digits ?? 2) - 1)) }
        return { cur, m, qm, key, QD, isE, pt, fmtQ, yAxis, lu: m.lengthUnit,
            contours: levels => { const k = levels.join(); if (!D.contours.has(k)) D.contours.set(k, isolux(qm, levels)); return D.contours.get(k) },
            enc: () => QM.enc ??= encircled(m, pt),
            rad: () => D.rad ??= radial(qm, pt),
            profile: axis => axis === 'a' ? (D.profA ??= profile(qm, 'a', pt)) : (D.profB ??= profile(qm, 'b', pt)) }
    }
    /* a map's isolines, by its own setting: round steps, a share of the range, or none */
    const levelsOf = (V, s) => s.isolines === 'off' || !(V.qm.hi > V.qm.lo) ? []
        : s.isolines === 'relative' ? [0.1, 0.25, 0.5, 0.75, 0.9].map(f => V.isE ? f * V.qm.hi : V.qm.lo + f * (V.qm.hi - V.qm.lo))
        : ticks(V.isE ? 0 : V.qm.lo, V.qm.hi, 5).filter(v => v > (V.isE ? 0 : V.qm.lo) && v < V.qm.hi)
    const pos = (V, v) => `${num(v)} ${V.lu}`

    const DRAW = {
        polar: farChart((c, o, s) => drawPolar(c, { ...o, view: s.view })),
        igamma: farChart((c, o, s) => drawCartesian(c, { ...o, span: +s.span || 0 })),
        map: p => {
            const V = mapView(p.s)
            if (!V.m) return blank(p, V.why)
            const L = drawHeatmap(p.c, V.qm, { contours: V.contours(levelsOf(V, p.s)), point: V.pt, lengthUnit: V.lu, unit: V.qm.unit, hover: hover.pos,
                                               exposure: +p.s.exposure || 1 })
            const [na, nb] = V.m.axisNames, c = hover.pos && cellAt(V.m, ...hover.pos)
            // a colour quantity also says the cell's colour, in the terms a datasheet gives it
            const ch = c && V.key !== 'E' ? cellChroma(V.m, c.i) : null
            const chText = !ch ? '' : ` · x ${ch.x.toFixed(4)} y ${ch.y.toFixed(4)}`
                + (ch.cct != null ? ` · ${Math.round(ch.cct)} K Duv ${ch.duv >= 0 ? '+' : ''}${ch.duv.toFixed(4)}` : '')
            p.readout.textContent = c ? `${na} ${pos(V, hover.pos[0])}, ${nb} ${pos(V, hover.pos[1])}: `
                    + `${V.QD.digits != null ? V.fmtQ(V.qm.E[c.i]) : pm(V.qm.E[c.i], cellSe(V.qm, c.i))} ${V.qm.unit}`
                    + (V.isE ? '' : ` · ${num(V.m.E[c.i])} ${V.m.unit}`) + chText + (V.m.count && V.m.smooth === 'none' ? ` · ${V.m.count[c.i]} hits` : '')
                : V.cur.covers === 'zoomed' ? 'zoomed: double-click for the whole detector' : ''
            return L
        },
        profiles: p => {
            const V = mapView(p.s, { paint: false })
            if (!V.m) return blank(p, V.why)
            const [na, nb] = V.m.axisNames
            const series = [{ label: `along ${na} (${nb} ${num(V.pt[1])})`, points: V.profile('a') }, { label: `along ${nb} (${na} ${num(V.pt[0])})`, points: V.profile('b') }]
            const L = drawXY(p.c, { series, xLabel: V.lu, yUnit: V.qm.unit, hover: hover.px,
                levels: V.isE ? [{ at: V.m.meanLit, label: 'mean (lit)' }] : [], ...V.yAxis })
            p.readout.innerHTML = hover.px == null ? '' : series.map((s, k) => {
                const q = nearestX(s.points.filter(q => Number.isFinite(q.y)), hover.px)
                return q ? `<span style="color:${polarStyle(k).colour}">■</span> ${pos(V, q.x)}: ${pm(q.y, q.se)} ${V.qm.unit}` : ''
            }).join(' · ')
            return L
        },
        rings: p => {
            const V = mapView(p.s, { paint: false })
            if (!V.m) return blank(p, V.why)
            const rad = V.rad(), enc = V.enc(), edge = rad.find(r => !r.full)?.x
            const L = drawXY(p.c, { series: [{ label: 'ring average', points: rad }], xLabel: `r, ${V.lu}`, yUnit: V.qm.unit, hover: hover.r,
                marks: [{ x: enc.r50, label: 'r50' }, { x: enc.r90, label: 'r90' }, ...(edge != null ? [{ x: edge, label: 'map edge' }] : [])], ...V.yAxis })
            const q = hover.r == null ? null : nearestX(rad, hover.r)
            p.readout.textContent = q ? `ring at r ${pos(V, q.x)}: ${pm(q.y, q.se)} ${V.qm.unit} (${q.cells} cells${q.full ? '' : ', past the map\'s edge'})` : ''
            return L
        },
        encircled: p => {
            const V = mapView()
            if (!V.m) return blank(p, V.why)
            const enc = V.enc()
            const L = drawXY(p.c, { series: [{ label: 'within r', points: enc.points }], xLabel: `r, ${V.lu}`, yUnit: '%', yMax: 1,
                yFormat: v => `${Math.round(v * 100)}`, levels: [{ at: 0.5, label: '50 %' }, { at: 0.9, label: '90 %' }],
                marks: [{ x: enc.r50, label: 'r50' }, { x: enc.r90, label: 'r90' }], hover: hover.r })
            const q = hover.r == null ? null : nearestX(enc.points, hover.r)
            p.readout.textContent = q ? `within r ${pos(V, q.x)}: ${(100 * q.y).toFixed(1)} % of the map's flux` : ''
            return L
        },
    }
    /* THE POINTER on each: what it sets, and which charts follow */
    const MOVE = {
        polar: (p, L, x, y) => { const a = polarAngleAt(L, x, y); if (a !== hover.angle) { hover.angle = a; drawFarCharts() } },
        igamma: (p, L, x, y) => { const a = cartesianAngleAt(L, x, y); if (a !== hover.angle) { hover.angle = a; drawFarCharts() } },
        map: (p, L, x, y) => {
            hover.pos = heatmapAt(L, x, y); hover.px = null
            /* THE BUTTON HELD DOWN on a map: the point follows the pointer, and with it the profiles, the rings and
               the encircled flux -- the cross-sections read while it moves (the user, 2026-10-02: a drag zoomed,
               and got in the way of exactly that). Shift-drag zooms (mapPointer). */
            const moved = p.drag === 'point' && !!hover.pos
            if (moved) setPoint(hover.pos)
            const V = hover.pos ? mapView() : null
            hover.r = V?.m ? Math.hypot(hover.pos[0] - V.pt[0], hover.pos[1] - V.pt[1]) : null
            if (moved) drawMapCharts(); else drawKinds('map', 'rings', 'encircled')
        },
        profiles: (p, L, x, y) => { hover.px = xyAt(L, x, y); drawKinds('profiles') },
        rings: (p, L, x, y) => { hover.r = xyAt(L, x, y); hover.pos = null; drawKinds('rings', 'encircled') },
        encircled: (p, L, x, y) => { hover.r = xyAt(L, x, y); hover.pos = null; drawKinds('rings', 'encircled') },
    }

    /* A CHART'S PANEL, filled: the host's, at the start or when a chart is made here. Its own strip along the
       top (makeBar), the canvas in what is left -- watched there, so a strip wrapping onto a second line redraws
       it -- with the readout and the zoom's rectangle over it. */
    const attach = (c, panel) => {
        const el = div('shell-chart'), plot = div('shell-plot')
        const cv = document.createElement('canvas'), readout = div('shell-readout')
        plot.append(cv, readout)
        el.append(plot)
        panel.appendChild(el)
        const p = panes[c.id] = { id: c.id, type: c.type, s: c.s, el, plot, c: cv, readout, layout: null, visible: false, drag: null, ro: null,
                                  strip: null, refreshBar: null }
        p.ro = new ResizeObserver(() => draw(c.id))
        p.ro.observe(plot)
        makeBar(p)
        charts?.onVisible?.(c.id, v => { p.visible = v; if (v) draw(c.id) })
        cv.addEventListener('pointermove', e => { const r = cv.getBoundingClientRect(); if (p.layout) MOVE[p.type](p, p.layout, e.clientX - r.left, e.clientY - r.top) })
        cv.addEventListener('pointerleave', () => {
            if (p.drag) return                    // held: the pointer is captured, and comes back
            Object.assign(hover, { angle: null, pos: null, r: null, px: null })
            if (FAR_CHARTS.includes(p.type)) drawFarCharts(); else drawMapCharts()
        })
        if (p.type === 'map') mapPointer(p)
        return p
    }

    /* A MAP UNDER THE BUTTON. Pressed and held, the point the profiles, rings and encircled flux are taken about
       goes where it is pressed and follows the pointer (MOVE.map) -- it was a click that did not drag, and a drag
       zoomed. SHIFT-DRAG zooms: the map made again from the same hits over the rectangle, with as many cells as
       before -- finer cells, no new trace -- and a double-click goes back to the whole detector. A zoom is the
       data's (what the map covers), so every map zooms together: two maps compared are of the same place. */
    const mapPointer = P => {
        const band = div('shell-band')
        P.plot.appendChild(band)
        P.c.style.cursor = 'crosshair'
        const px = e => { const r = P.c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }
        const inPlot = ([x, y]) => { const L = P.layout; return L ? [Math.max(L.x0, Math.min(L.x0 + L.pw, x)), Math.max(L.y0, Math.min(L.y0 + L.ph, y))] : [x, y] }
        let from = null
        P.c.addEventListener('pointerdown', e => {
            const at = e.button === 0 ? heatmapAt(P.layout, ...px(e)) : null
            if (!at) return
            P.c.setPointerCapture?.(e.pointerId)
            if (e.shiftKey && !isPlane()) { P.drag = 'zoom'; from = px(e); return }
            P.drag = 'point'
            setPoint(at)
            hover.pos = at; hover.r = 0; hover.px = null
            drawMapCharts()
        })
        P.c.addEventListener('pointermove', e => {
            if (P.drag !== 'zoom') return
            const A = inPlot(from), B = inPlot(px(e))
            Object.assign(band.style, { display: 'block', left: `${Math.min(A[0], B[0])}px`, top: `${Math.min(A[1], B[1])}px`,
                                        width: `${Math.abs(A[0] - B[0])}px`, height: `${Math.abs(A[1] - B[1])}px` })
        })
        const end = (e, cancelled = false) => {
            const was = P.drag
            P.drag = null; band.style.display = 'none'
            // the cards' r50 and r90 are about the point: once, where it was let go
            if (was === 'point') return results()
            if (was !== 'zoom' || cancelled) return
            const a = inPlot(from), b = inPlot(px(e))
            from = null
            if (Math.hypot(b[0] - a[0], b[1] - a[1]) <= 5) return          // a Shift-click: no rectangle
            const A = heatmapAt(P.layout, ...a), B = heatmapAt(P.layout, ...b)
            if (!A || !B || Math.abs(A[0] - B[0]) < 1e-12 || Math.abs(A[1] - B[1]) < 1e-12) return
            IL.zoom = { a: [Math.min(A[0], B[0]), Math.max(A[0], B[0])], b: [Math.min(A[1], B[1]), Math.max(A[1], B[1])] }
            mapChanged()
        }
        P.c.addEventListener('pointerup', e => end(e))
        P.c.addEventListener('pointercancel', e => end(e, true))
        P.c.addEventListener('dblclick', () => { if (IL.zoom) { IL.zoom = null; mapChanged() } })
    }

    /* A CHANGE OF DATA. What feeds the far field, its axis or its grid: the analysis's far field is of
       other settings now, so it goes, and the charts say to run it again rather than show numbers that
       are not of what is asked. How it is read, or anything of the map: made again from what is kept. */
    const farChanged = () => { push(); ANA.far = null; farRead() }
    const farRead = () => { drawFarCharts(); if (isPlane()) drawMapCharts(); results() }
    // the map's strips offer what this map can show (a plane's has no colour) and, zoomed, the way back
    const mapChanged = () => { drawMapCharts(); results(); refreshBars(...MAP_CHARTS) }

    //==================================================================================================================
    // A CHART'S OWN CONTROLS: what it shows and how, what it saves, another like it, and away
    //==================================================================================================================
    const farCSV = () => {
        const f = readFar()
        if (!f) return say('no far field yet: ▶ Run first')
        saveText(intensityCSV(f.R), 'intensity.csv')
    }
    const ilCSV = () => {
        const m = currentIllum()?.m
        if (!m) return say('no map yet: ▶ Run with a detector in the scene, or choose the far field on a plane')
        const colour = !!m.EX
        const rows = [`# illuminance, ${m.unit}; a across, b up, cell centres in ${m.lengthUnit}${colour ? '; x, y the cell\'s chromaticity' : ''}`,
                      `a,b,E,se${colour ? ',x,y' : ''}`]
        const qx = colour ? quantityMap(m, 'x') : null, qy = colour ? quantityMap(m, 'y') : null
        for (let y = 0; y < m.ny; y++) for (let x = 0; x < m.nx; x++) {
            const i = y * m.nx + x
            const row = [m.range.a[0] + (x + 0.5) * m.cell, m.range.b[0] + (y + 0.5) * m.cell, m.E[i], cellSe(m, i) ?? '']
            if (colour) row.push(Number.isFinite(qx.E[i]) ? qx.E[i] : '', Number.isFinite(qy.E[i]) ? qy.E[i] : '')
            rows.push(row.join(','))
        }
        saveText(rows.join('\n'), 'illuminance.csv')
    }
    /* the kept hits as a file: position, flux, the direction they arrived from, the object, the colour */
    const hitsCSV = () => {
        const hits = lastMap?.hits
        if (!hits?.length) return say('no detector hits: give a surface a detector material (Builder), then ▶ Run')
        const u = lastMap.unit
        const rows = [`# ${hits.length} detector hits${lastMap.note || ''}; flux in ${u} (each batch's share); X_, Z_ the colour in the same unit`,
                      'x,y,z,flux_' + u + ',dx,dy,dz,object,X_' + u + ',Z_' + u]
        for (const r of hits) rows.push([...r.pos, r.flux, ...(r.dir ?? ['', '', '']), nameOfTag(r.tag, `tag ${r.tag}`), r.xyz?.[0] ?? '', r.xyz?.[2] ?? ''].join(','))
        saveText(rows.join('\n'), 'detector-hits.csv')
        say(`${hits.length} detector hits saved`)
    }
    const SAVES = {
        polar: [['table', 'Save the intensity table (CSV)', farCSV]],
        igamma: [['table', 'Save the intensity table (CSV)', farCSV]],
        map: [['table', 'Save the map (CSV)', ilCSV],
              ['download', 'Save the detector hits the analysis kept (CSV): position, flux, direction, object, colour', hitsCSV]],
    }
    /* A CHART'S OWN STRIP (lib/pathtracer/strip.js), on the chart: the user, 2026-10-02, "put the controls for the
       chart (what it shows) into the chart itself. Not in the analysis pane" -- with two maps side by side, each
       says on it what it shows. By the strip's rules (the user, 2026-09-27): a value said once, by the control
       itself; two or three choices a segmented row of short words; a dropdown for the longer lists; a tooltip on
       everything. Made once per chart: the controls that apply only sometimes (a target's, log's decades, the
       true colour's brightness, a zoom's way back) are shown or hidden by its refreshBar, which every change that
       can reshape it calls -- and so do an analysis and a change of the map's data, which change what the
       quantity's list offers. A chart's own settings are kept as they change (charts.js). The point it is read
       about (`about`) is the map's, one for every chart read off it, so each of theirs shows the same. */
    const inRange = (v, min, max) => { const n = +v; return String(v).trim() !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null }
    /* WHAT A CHART READ OFF THE MAP SHOWS: the quantity, and for Δu'v' its target. A choice the map cannot show
       (CCT kept from a map with colour, the analysis now without) stays the chart's, said as such in the list --
       a blank field would look like no choice at all -- and the chart draws the illuminance until it can. The two
       that paint the light are a map's alone. */
    const quantityStrip = (p, S, keep, redraw, shown) => {
        const s = p.s
        const offered = () => { const m = currentIllum()?.m; return (m ? quantitiesOf(m) : ['E']).filter(q => p.type === 'map' || !MAP_QUANTITIES[q].paint) }
        S.select('q', { tip: p.type === 'map' ? 'What the map shows' : 'What this chart shows, read off the map',
            options: () => {
                const keys = offered(), o = Object.fromEntries(keys.map(q => [MAP_QUANTITIES[q].label, q]))
                if (!keys.includes(s.q)) o[`${MAP_QUANTITIES[s.q]?.label ?? s.q} (not in this map: illuminance shown)`] = s.q
                return o
            }, get: () => s.q, set: keep('q', redraw) })
        if (p.type === 'map') {
            S.select('exposure', { tip: 'The true colour\'s brightness: × 1 makes the brightest cell white, more lifts the dim fringes and clips the middle',
                options: { '× 1': 1, '× 2': 2, '× 4': 4, '× 10': 10, '× 100': 100 }, get: () => s.exposure, set: keep('exposure', redraw) })
            shown.push(['exposure', () => s.q === 'light' && offered().includes('light')])
        }
        const target = () => s.q === 'dTarget' && offered().includes('dTarget')
        S.choice('target', { tip: 'What Δu′v′ is measured from', get: () => s.target, set: keep('target', redraw),
            options: [{ value: 'mix', text: 'own', tip: 'The detector\'s own colour: the whole of the light that reached it' },
                      { value: 'cct', text: 'CCT', tip: 'A CCT and Duv' }, { value: 'xy', text: 'xy', tip: 'A CIE 1931 xy' }] })
        const typed = (key, min, max) => v => { const n = inRange(v, min, max); if (n != null) keep(key, redraw)(n); else S.refresh() }
        S.input('cct', { prefix: 'K', width: 58, tip: 'The target\'s CCT, kelvin (1000 to 15 000)', get: () => s.cct, set: typed('cct', 1000, 15000) })
        S.input('duv', { prefix: 'Duv', width: 62, tip: 'The target\'s Duv (-0.05 to 0.05), + towards green', get: () => s.duv, set: typed('duv', -0.05, 0.05) })
        S.input('x', { prefix: 'x', width: 62, tip: 'The target\'s CIE x', get: () => s.x, set: typed('x', 0, 0.8) })
        S.input('y', { prefix: 'y', width: 62, tip: 'The target\'s CIE y', get: () => s.y, set: typed('y', 0, 0.9) })
        shown.push(['target', target], ['cct', () => target() && s.target === 'cct'], ['duv', () => target() && s.target === 'cct'],
                   ['x', () => target() && s.target === 'xy'], ['y', () => target() && s.target === 'xy'])
    }
    const makeBar = p => {
        const c = SET.get(p.id), s = p.s, type = p.type
        const S = p.strip = chartStrip(p.el)
        const go = () => draw(p.id)
        // a setting of the chart's own: set, kept, drawn, and the strip shows what now applies
        const keep = (key, then) => v => { s[key] = v; SET.save(); then(); p.refreshBar() }
        const shown = []                          // [control, () => whether it applies now]
        let back = null
        if (FAR_CHARTS.includes(type)) {
            S.input('planes', { prefix: 'C', width: 74, get: () => s.planes, set: keep('planes', () => { go(); if (c === first('polar')) results() }),
                                tip: 'The C planes drawn, in degrees: up to nine, by commas or spaces -- each a line through C and C + 180' })
            S.choice('log', { tip: 'The intensity axis', get: () => !!s.log, set: keep('log', go),
                              options: [{ value: false, text: 'lin', tip: 'Linear' }, { value: true, text: 'log', tip: 'Logarithmic' }] })
            S.select('decades', { tip: 'How many decades the log scale shows', get: () => s.decades, set: keep('decades', go),
                                  options: Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => [`${n} decade${n > 1 ? 's' : ''}`, n])) })
            shown.push(['decades', () => s.log])
            if (type === 'polar') S.choice('view', { tip: 'How much of the circle is drawn', get: () => s.view, set: keep('view', go),
                options: [{ value: 'auto', text: 'auto', tip: 'As much as the light needs' }, { value: 'full', text: 'full', tip: 'The full circle' },
                          { value: 'lower', text: 'lower', tip: 'The lower half' }] })
            else S.select('span', { tip: 'The γ range drawn', get: () => s.span, set: keep('span', go),
                options: { 'γ auto': 0, '±1°': 1, '±2°': 2, '±5°': 5, '±10°': 10, '±20°': 20, '±30°': 30, '±45°': 45, '±60°': 60, '±90°': 90, '±180°': 180 } })
        } else if (type === 'map') {
            quantityStrip(p, S, keep, () => { go(); results() }, shown)
            S.choice('isolines', { tip: 'Isolines', get: () => s.isolines, set: keep('isolines', go),
                options: [{ value: 'lux', text: 'steps', tip: 'Isolines at round steps' }, { value: 'relative', text: '%', tip: 'Isolines at 10, 25, 50, 75 and 90 % of the range' },
                          { value: 'off', text: 'off', tip: 'No isolines' }] })
            back = S.action('back', 'Zoomed: back to the whole detector (or double-click the map)', () => { IL.zoom = null; mapChanged() })
        } else {
            S.choice('about', { tip: 'The point the profiles, rings and encircled flux are taken about: one for all of them. Press on a map to put it there.',
                get: () => IL.through, set: v => { IL.through = v; syncAbout(); drawMapCharts(); results() },
                options: [{ value: 'peak', text: 'peak', tip: 'About the brightest cell' }, { value: 'centroid', text: 'centroid', tip: 'About the flux-weighted centre' },
                          { value: 'clicked', text: 'pressed', tip: 'About where a map was last pressed' }] })
            if (type !== 'encircled') quantityStrip(p, S, keep, go, shown)
        }
        S.spacer()
        // ITS SAVES, ANOTHER LIKE IT (beside it, its settings copied: two charts compared differ in one), AWAY
        for (const [ic, tip, run] of SAVES[type] ?? []) S.action(ic, tip, run)
        // with the time it was saved: every save its own file (lib/filename.js)
        S.action('image', 'Save the chart (PNG)', () => saveCanvases(p.plot, stampedName(c.n > 1 ? `${type}-${c.n}` : type, 'png')))
        if (charts?.add) S.action('duplicate', `Another ${KIND[type].title} chart like this one, beside it: its settings copied, to change one`, () => addChart(type, c))
        if (charts?.remove && c.n > 1) S.action('close', `Remove ${c.title} (the first ${KIND[type].title} chart stays: it can only be closed)`, () => removeChart(c.id))
        p.refreshBar = () => {
            for (const [k, applies] of shown) S.show(k, !!applies())
            if (back) back.style.display = IL.zoom ? '' : 'none'
            S.refresh()
        }
        p.refreshBar()
    }
    /* every chart's strip of these kinds, again: what it offers may have changed */
    const refreshBars = (...types) => { for (const p of Object.values(panes)) if (types.includes(p.type)) p.refreshBar() }
    /* the point moved to where a map was pressed, or chosen in one chart's strip: every strip that shows it says so */
    const syncAbout = () => refreshBars('profiles', 'rings', 'encircled')

    /* ANOTHER CHART of a kind: a chart's ⧉ (`like`, its settings copied), or Analysis › New chart (the kind's
       defaults). The host makes its panel and opens it beside `like`'s, or the first of its kind's. Returns its
       id; null where the host makes no panels. */
    const addChart = (type, like = null) => {
        if (!charts?.add || !KIND[type]) return null
        const c = SET.add(type, like?.s ?? null)
        const panel = charts.add(c, like?.id ?? first(type).id)
        if (panel) attach(c, panel)
        return c.id
    }
    /* AN ADDED CHART TAKEN AWAY, its settings with it; the first of a kind is only ever closed */
    const removeChart = id => {
        if (!SET.remove(id)) return false
        charts?.remove?.(id)
        panes[id]?.ro?.disconnect()
        delete panes[id]
        return true
    }
    // the host's panels, one per chart -- here, once everything a chart's strip is made of exists
    for (const c of SET.list()) { const panel = charts?.el?.[c.id]; if (panel) attach(c, panel) }

    //==================================================================================================================
    // THE RESULTS, as cards: the numbers a person looks for first; the rest is on the charts' readouts
    //==================================================================================================================
    const card = (k, v, e = '') => `<div class="shell-card"><div class="k">${k}</div><div class="v">${v}</div><div class="e">${e}</div></div>`
    // a beam's width: where I falls to the level each side of the plane's peak -- or why there is none
    const width = w => w == null ? 'below' : w.width != null ? `${w.width.toFixed(1)}°` : 'open'
    const results = () => {
        const out = [], notes = []
        const f = readFar()
        if (f) {
            // the beam in the first polar diagram's first plane: one set of cards, however many charts
            const planes = planesOf(first('polar').s.planes), S = farStats(f.far, f.R, planes), u = f.R.unit, C0 = +planes[0].toFixed(2)
            out.push(card('I max', `${num(S.max.I)} ${u}`, `${S.max.se > 0 ? `± ${num(S.max.se)} · ` : ''}γ ${S.max.gamma.toFixed(1)}° C ${S.max.C.toFixed(1)}°`))
            out.push(card(`beam · C${C0}`, width(S.planes[0].beam), `field ${width(S.planes[0].field)}`))
            out.push(card('efficiency', S.efficiency != null ? `${(100 * S.efficiency).toFixed(1)} %` : '–', `${num(S.flux)} of ${num(f.far.emitted)} ${f.far.unit}`))
            if (S.max.se != null && S.max.I > 0 && S.max.se / S.max.I > 0.05)
                notes.push(`I max is ${(100 * S.max.se / S.max.I).toFixed(0)} % noise: more rays, a coarser γ step, or rotational symmetry for a round beam`)
            if (f.far.emitted > 0 && S.flux / f.far.emitted < 0.05)
                notes.push('little of the light reaches the far field: in a closed scene nothing escapes -- feed it from a detector')
        }
        const V = mapView()                          // the illuminance's, whatever the charts show
        if (V.m) {
            const m = V.m, enc = V.enc()
            out.push(card(`E max · ${V.cur.name}`, `${num(m.max)} ${m.unit}`, `mean ${num(m.meanLit)} · min ${num(m.minLit)}`))
            out.push(card('U0', m.uniformity != null ? m.uniformity.toFixed(2) : '–', `min / mean · Ud ${m.max > 0 ? (m.minLit / m.max).toFixed(2) : '–'}`))
            out.push(card('r50 · r90', `${num(enc.r50)} · ${num(enc.r90)}`, `${V.lu}, about ${IL.through === 'clicked' ? 'the click' : IL.through === 'centroid' ? 'the centroid' : 'the peak'}`))
            if (m.colour?.cctInRange) out.push(card('CCT', `${Math.round(m.colour.cct)} K`, `Duv ${m.colour.duv >= 0 ? '+' : ''}${m.colour.duv.toFixed(4)}`
                + (m.colour.dUpVpMax != null ? ` · Δu′v′ max ${m.colour.dUpVpMax.toFixed(4)}` : '')))
            else if (m.colour) out.push(card('colour', `x ${m.colour.x.toFixed(4)} y ${m.colour.y.toFixed(4)}`, m.colour.dUpVpMax != null ? `Δu′v′ max ${m.colour.dUpVpMax.toFixed(4)}` : ''))
            /* how far off a target the colour is: the first chart's that shows it (each chart has its own target) */
            const tc = SET.list().find(c => c.s.q === 'dTarget')
            const off = tc ? mapView(tc.s, { paint: false }).qm?.off : null
            if (off) out.push(card('Δu′v′ from target', off.whole != null ? off.whole.toFixed(4) : '–',
                `the whole · cells: max ${off.max != null ? off.max.toFixed(4) : '–'} rms ${off.rms != null ? off.rms.toFixed(4) : '–'}`))
            notes.push(`map: ${m.nx} × ${m.ny} cells of ${pos(V, m.cell)} over ${V.cur.covers ?? 'the plane'}; `
                + (m.virtual ? `a point source ${num(m.h)} m off -- right when the luminaire is small against that`
                    : m.smooth === 'none' ? `about ${m.hitsPerLitCell?.toFixed(0)} hits per lit cell, ±${m.relNoise != null ? (100 * m.relNoise).toFixed(0) : '?'} % a cell`
                    : `smoothed (${m.smooth}), ±${m.relNoise != null ? (100 * m.relNoise).toFixed(0) : '?'} % a cell`)
                + (m.flatness > 0.01 ? '; NOT FLAT: a projection onto the fitted plane' : ''))
        }
        cardsEl.innerHTML = out.join('')
        cardsEl.style.display = out.length ? '' : 'none'
        resNote.textContent = out.length ? notes.join('. ') : 'No results yet: ▶ Run traces the rays and fills every chart.'
    }

    //==================================================================================================================
    // WHAT FOLDS AWAY: the totals, and the engine's limits
    //==================================================================================================================
    /* THE TOTALS of the last analysis: where the light went, per object and per material */
    const ft = table.addFolder({ title: 'Totals', expanded: false })
    const out = document.createElement('div')
    Object.assign(out.style, { font: '12px var(--sh-mono, ui-monospace, monospace)', padding: '4px 8px 8px', color: 'var(--sh-ink, #cfd6dc)', overflowX: 'auto' })
    ft.element.querySelector('.tp-fldv_c')?.appendChild(out)
    const render = r => {
        if (!r) { out.innerHTML = 'No analysis yet.'; return }
        const u = ` ${r.unit}`
        const inFlight = r.emitted.value - r.escaped.value - r.lost.value - r.absorbed.value - (r.detected?.value || 0)
        const hitsNote = r.detectorHits ? ` (${r.detectorHits} rays)` : ''
        const rows = list => list.map(o => `<tr><td>${o.name}</td><td>${fmt(o.incident)}</td><td>${fmt(o.absorbed)}</td><td>${o.hits}</td></tr>`).join('')
        const objects = r.objects.map(o => ({ ...o, name: nameOfTag(o.index, o.name) }))
        const mats = r.materials.map(o => ({ ...o, name: nameOfMat(o.index) }))
        const th = `<tr style="color:#8fa3b3"><td></td><td>arriving${u}</td><td>absorbed${u}</td><td>hits</td></tr>`
        const f = readFar(), S = f ? farStats(f.far, f.R, [0]) : null
        out.innerHTML = `
            <div style="margin-bottom:4px">${r.rays.toLocaleString()} rays in ${r.batches} batches</div>
            <table style="border-collapse:collapse;width:100%">
              <tr><td>emitted</td><td>${fmt(r.emitted, u)}</td></tr>
              <tr><td>escaped</td><td>${fmt(r.escaped, u)}</td></tr>
              <tr><td>absorbed</td><td>${fmt(r.absorbed, u)}</td></tr>
              ${r.volume?.value ? `<tr><td>&nbsp;&nbsp;of it inside, between surfaces</td><td>${fmt(r.volume, u)}</td></tr>` : ''}
              <tr><td>on detectors${hitsNote}</td><td>${fmt(r.detected, u)}</td></tr>
              <tr><td>lost (caps, max distance)</td><td>${fmt(r.lost, u)}</td></tr>
              <tr><td>unaccounted</td><td>${fmt(inFlight, u)}</td></tr>
            </table>
            <div style="margin:8px 0 2px;color:#8fa3b3">per object</div>
            <table style="border-collapse:collapse;width:100%">${th}${rows(objects)}</table>
            <div style="margin:8px 0 2px;color:#8fa3b3">per material</div>
            <table style="border-collapse:collapse;width:100%">${th}${rows(mats)}</table>
            ${S ? `<div style="margin:8px 0 2px;color:#8fa3b3">far-field flux by zone</div>
                   ${S.zones.map(z => `<div>γ ${z.from}–${z.to}°: ${num(z.flux)} ${f.far.unit} (${S.flux > 0 ? (100 * z.flux / S.flux).toFixed(1) : '–'} %)</div>`).join('')}` : ''}`
    }
    render(null)

    /* THE ENGINE'S LIMITS, which a person rarely needs and which change what every number means */
    const fx = table.addFolder({ title: 'Advanced', expanded: false })
    // a number, not a slider: how far the system reaches is the scene's business -- and saved with it
    fx.addBinding(T, 'maxDist', { label: 'max optical distance (0 = none)', min: 0 }).on('change', maxDistChanged)
    fx.addBinding(T, 'bounces', { label: 'interactions per ray', min: 1, max: 1000, step: 1 })
    fx.addBinding(T, 'marchSteps', { label: 'march steps per ray', min: 100, max: 100000, step: 100 }).on('change', retrace)
    // in metres, whatever the scene's unit; 0 follows the scene's size, as the picture does
    fx.addBinding(T, 'eps', { label: 'surface tolerance (m, 0 = auto)', min: 0, max: 1e-2, step: 1e-7 }).on('change', retrace)

    //==================================================================================================================
    // THE ANALYSIS: the run bar's ▶, and Live
    //==================================================================================================================
    /* ONE AT A TIME: a second press while one runs would interleave two sets of batches into one result. ▶ Run and
       Live are one or the other: each button is disabled while the other has the module (buttons, below). */
    let analysing = false
    /* waiting: for a scene being built (liveRounds); builds: the renderer's compile notices seen, to tell a round a
       build began during; sum: whether the rounds add up (the Σ beside Live) -- off unless asked for (the user,
       2026-10-04: "make the cumulative optional. that makes it easier to compare results": a round on its own is the
       same number of rays every time, so two of them compare, where a sum compares with a single round) */
    const LIVE = { on: false, loop: null, waiting: false, builds: 0, sum: false }
    /* THE RAYS IT TRACES: a number in the field times the multiplier beside it. "500k" or "2M" typed in the field
       sets the multiplier too, as the millions field this replaced took them. 1 to RAYS_MAX in all. */
    const raysTotal = () => Math.round(T.count * T.times)
    const parseCount = v => {
        const m = /^\s*(\d+(?:\.\d*)?|\.\d+)\s*([kKmM]?)\s*$/.exec(String(v))
        return m ? { count: +m[1], times: m[2] ? (m[2].toLowerCase() === 'k' ? 1e3 : 1e6) : T.times } : null
    }
    const fits = ({ count, times }) => { const n = Math.round(count * times); return n >= 1 && n <= RAYS_MAX }
    const countRefused = () => say(`rays: a number times the multiplier beside it, 1 to ${RAYS_MAX / 1e6} million in all`)
    const showCount = () => {
        raysIn.value = `${+T.count}`
        timesIn.value = String(T.times)
        raysIn.title = timesIn.title = `${raysTotal().toLocaleString()} rays: ▶ Run's in all, and Live's every round. `
            + 'Type a number (500k and 2M set the multiplier too); the multiplier beside it'
    }
    raysIn.addEventListener('change', () => {
        const c = parseCount(raysIn.value)
        if (c && fits(c)) Object.assign(T, c); else countRefused()
        showCount()
    })
    timesIn.addEventListener('change', () => {
        const c = { count: T.count, times: +timesIn.value }
        if (fits(c)) Object.assign(T, c); else countRefused()
        showCount()
    })
    raysIn.addEventListener('keydown', e => { if (e.key === 'Enter') raysIn.blur() })
    showCount()
    /* WHEN IT RAN, and STALE: the scene has changed since -- an edit, or another scene -- so its numbers
       are of a scene that no longer exists. The charts still show them; the run bar says so. LIVE: the last
       round's rays and how long a round takes; an edit is stale only until the round after it, so not said. */
    const sayWhen = () => {
        const t = ANA.at?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        whenEl.classList.toggle('stale', !!ANA.stale && !LIVE.on)
        if (LIVE.on) {
            whenEl.textContent = LIVE.waiting ? 'live · waiting for the scene to build'
                : ANA.live ? `live · ${ANA.rays.toLocaleString()} rays${ANA.rounds > 1 ? ` in ${ANA.rounds} rounds` : ''} · ${ANA.secs.toFixed(2)} s a round`
                : 'live · the first round...'
            whenEl.title = LIVE.sum ? 'Live, Σ: the rounds add up while nothing changes; a change to the scene, the view or the settings starts again from one round'
                : 'Live: every round on its own, that many rays -- Σ adds them up while nothing changes'
            return
        }
        whenEl.textContent = !ANA.at ? '' : ANA.stale ? `scene changed since ${t}` : `${ANA.rays.toLocaleString()} rays · ${t}`
        whenEl.title = ANA.stale ? 'The numbers are of the scene as it was: ▶ Run again' : ANA.at ? `traced in ${ANA.secs?.toFixed(1)} s` : ''
    }

    /* THE DETECTOR HITS the map is made of: an analysis's, every batch's together, each batch carrying
       its share of the flux -- up to MAP_HITS of them, beyond which the later batches are left out (each
       batch is a whole estimate on its own, so leaving some out adds noise, not bias). The hit buffer
       holds 262 144, more than an analysis batch's rays, and a ray stops at the first detector it
       reaches, so no batch overflows it. ONLY THE ANALYSIS WRITES THEM: the live rays trace into the
       same buffer, and their 2 000 rays are a look, not a measurement. LIVE'S ROUNDS ADDED UP share the one
       allowance: the map stops filling in at it, while the totals and the far field go on converging. */
    // a hit kept for the map is a JS object of a few hundred bytes: half a million is ~100 MB
    const MAP_HITS = 500000

    const buttons = () => {
        runBtn.disabled = analysing || LIVE.on
        liveBtn.disabled = analysing
        liveBtn.classList.toggle('on', LIVE.on)
        liveBtn.textContent = LIVE.on ? '■ Live' : 'Live'
        liveBtn.title = LIVE.on ? 'Live: on. Click to stop -- the charts keep what the whole rounds gave'
            : 'Live: the analysis again and again, that many rays a round -- every chart and number follows each change in the Builder.'
              + ' Fewer rays, quicker rounds'
        sumBtn.classList.toggle('on', LIVE.sum)
        sumBtn.title = LIVE.sum ? 'Σ on: Live\'s rounds add up while nothing changes -- the error bars shrink, the map fills in. Click for every round on its own'
            : 'Σ off: every round of Live on its own, the same number of rays each, to compare one with another. Click to add them up while nothing changes'
    }
    const runAnalysis = async () => {
        if (analysing || LIVE.on) return say(LIVE.on ? 'the analysis is live: switch Live off to run it once' : 'an analysis is already running')
        analysing = true; buttons()
        const resume = await pauseRays()
        try {
            await analysis()
            // the run bar says how many and when; its tooltip how long -- the status line has nothing to add but the dust's absence
            say(hazeNote())
        } catch (e) {
            console.error('[optics]', e)
            say(`analysis failed: ${e.message}`)
        } finally { analysing = false; resume(); buttons() }
    }
    runBtn.onclick = runAnalysis

    /* ONE ANALYSIS'S BATCHES: the ray count in batches, into an estimate (optics/estimate.js: each number the mean
       over the batches with the standard error from their spread), and the detector hits kept for the map -- whole
       batches of them while there is room (`room`, of MAP_HITS). ▶ Run shows each readback's batches as they come; a
       live round shows nothing itself: liveRounds decides what it is shown with. Throws what the trace throws, and
       STOPPED when Live is switched off during it. */
    const STOPPED = new Error('stopped'), SCENE_CHANGED = new Error('the scene changed during the round')
    const traceRound = async ({ live = false, room = MAP_HITS } = {}) => {
        const scene = RT.scene
        push()
        const { rays, batches } = batchesFor(raysTotal())
        const t0 = performance.now()
        if (!live) say(`tracing${O.compiling ? ' -- compiling the optics kernels...' : '...'}`)
        const est = O.estimate(), hits = []
        let kept = 0
        await O.run({ rays, batches, into: est, onBatch: async (r, b, batch) => {
            if (live && !LIVE.on) throw STOPPED
            // the batches of one readback arrive together: drawn once, at the last of them
            if (!live && (batch?.last ?? true)) { ANA.results = r; ANA.far = O.far; render(r); farRead(); say(`batch ${b} of ${batches}`) }
            if (hits.length < room) {
                // read back with the batch (index.js); a stand-in module without it (a check's, a mockup's): as it stands
                const h = batch?.hits ? batch.hits() : await O.readHits()
                if (h) { for (const x of h.hits) hits.push(x); kept++ }
            }
        } })
        // a live round the scene was swapped under is of two scenes: let go, as one that failed for it is (liveRounds)
        if (live && RT.scene !== scene) throw SCENE_CHANGED
        return { est, hits, kept, secs: (performance.now() - t0) / 1000 }
    }
    /* WHAT THE CHARTS, CARDS AND TOTALS SHOW: an estimate and the hits kept with it -- a ▶ Run's, or Live's rounds so
       far. The map is made again only when asked (`map`): each batch's hits carry that batch's flux, so the map is
       their average over the batches kept, and for half a million hits rescaling and mapping them took 0.29 s and
       0.27 s (timed in Node on the build machine, 2026-10-04: not the user's computer, but not nothing) -- Live asks
       only when the hits have grown by a quarter. */
    const show = ({ est, hits, kept, secs, live = false, rounds = 1, map = true }) => {
        const r = est.results()
        Object.assign(ANA, { results: r, far: est.farField(), rays: r.rays, at: new Date(), sig: sceneSig(), stale: false,
                             secs, live, rounds })
        if (map) {
            const n = Math.max(1, kept)
            lastMap = { hits: hits.map(h => ({ ...h, flux: h.flux / n, xyz: h.xyz?.map(v => v / n) })), unit: 'lm', note: ` from ${kept} of ${r.batches} batches` }
        }
        buildData()
        render(r); farRead(); if (map) drawMapCharts(); results(); sayWhen()
        // the map's charts offer the quantities the hits allow: colour ones only when they carry colour
        if (map) refreshBars(...MAP_CHARTS)
    }
    const analysis = async () => show(await traceRound())

    /* LIVE (the user, 2026-10-04: "a 'live' mode that traces continuously, updates all charts"): the analysis again
       and again, every round that many fresh rays -- what ▶ Run gives, for the scene as it is now. The rays, if
       shown, are traced between rounds (raysBetween). A round that fails stops it, and says why -- unless the scene
       changed under it (below). Switched off and on before its loop has seen it: the same loop goes on, or a new one
       starts when the old has ended.
       WITH Σ, THE ROUNDS ADD UP while nothing changes (the user, 2026-10-04, after the picture: "the viewport shows
       the detector disc pretty sharp"; and the same day, Σ optional, off at first): each round is merged into one estimate, so the error bars shrink and the map
       fills in as the picture does. What starts it over is what starts the picture over -- RT.resets, the picture's
       own resets counted: a scene value, the camera, the scene, a light -- and the trace's own settings and ray count
       (liveKey), which the picture does not see. A round during which any of them moved is shown on its own and kept
       by nothing: its batches are of two states. So a drag shows round after round on its own, as before, and once
       it stops the next rounds add up. Nothing here has to know what an edit touched: the picture already does.
       THROUGH A STRUCTURAL EDIT. The renderer's setScene puts the new scene in RT.scene before building it, and
       its uniforms in the bag after (lib/pathtracer/index.js sceneBusy), and the optics kernels are compiled for
       RT.scene and handed that bag -- in between, a name one scene has and the other not can be refused
       (tinywebgpu: "Unknown uniform"), and the edit Live is for would stop it. So no round starts while a scene is built
       or swapped in (the run bar says it waits), and a round that fails or ends with the scene changed, or a build
       begun, since it started is let go, not stopped on: the next is of the new scene. */
    const nextFrame = () => new Promise(r => requestAnimationFrame(r))
    const sceneBusy = () => !!RT.sceneBusy?.()
    RT.onCompile?.(() => { LIVE.builds++ })               // every build's notices, its start to its end
    const liveKey = () => { const S = O.settings; return JSON.stringify([raysTotal(), S.bounces, S.marchSteps, S.eps, S.maxDist, S.far]) }
    /* the rounds added up: their estimate, its hits and the batches they are of, what it is of, and the hits the map
       was last made from */
    const ACC = { est: null }
    const liveRounds = async () => {
        const resume = await pauseRays()
        say(hazeNote())
        try {
            while (LIVE.on) {
                const waiting = sceneBusy()
                if (waiting !== LIVE.waiting) { LIVE.waiting = waiting; sayWhen() }
                if (waiting) { await nextFrame(); continue }
                push()                            // the settings the round runs with, before they are compared
                const scene = RT.scene, builds = LIVE.builds, resets = RT.resets?.(), key = liveKey()
                const adds = LIVE.sum && !!ACC.est && ACC.scene === scene && ACC.resets === resets && ACC.key === key
                let round
                try { round = await traceRound({ live: true, room: adds ? MAP_HITS - ACC.hits.length : MAP_HITS }) } catch (e) {
                    if (e === STOPPED || (RT.scene === scene && LIVE.builds === builds && !sceneBusy())) throw e
                    ACC.est = null
                    await nextFrame(); continue
                }
                const moved = RT.scene !== scene || LIVE.builds !== builds || RT.resets?.() !== resets || liveKey() !== key
                // ACC.est gone: Σ switched off, or on again, while the round ran (it starts over)
                if (adds && !moved && ACC.est) {
                    ACC.est.merge(round.est)
                    for (const h of round.hits) ACC.hits.push(h)
                    ACC.kept += round.kept; ACC.rounds++
                } else Object.assign(ACC, { est: round.est, hits: round.hits, kept: round.kept, rounds: 1, mapHits: -1, scene, resets, key })
                const map = ACC.hits.length > 1.25 * ACC.mapHits
                if (map) ACC.mapHits = ACC.hits.length
                show({ est: ACC.est, hits: ACC.hits, kept: ACC.kept, secs: round.secs, live: true, rounds: ACC.rounds, map })
                if (moved) ACC.est = null             // of two states: the next round starts over
                if (LIVE.on && V.show) await raysBetween()
                await nextFrame()                 // the picture's frames between rounds, as the rays' own loop leaves them
            }
        } catch (e) {
            if (e !== STOPPED) { console.error('[optics]', e); LIVE.on = false; say(`live analysis stopped: ${e.message}`) }
        } finally { resume() }
    }
    const startLive = () => {
        if (LIVE.loop) return
        LIVE.loop = liveRounds().finally(() => { LIVE.loop = null; if (LIVE.on) startLive(); buttons(); sayWhen() })
    }
    const setLive = on => {
        if (on && analysing) return say('an analysis is running: Live once it has finished')
        LIVE.on = !!on
        if (LIVE.on) { ANA.live = false; LIVE.waiting = false; ACC.est = null; startLive() }
        buttons(); sayWhen()
    }
    liveBtn.onclick = () => setLive(!LIVE.on)
    /* Σ, at any time: what was added up so far is let go either way -- switched on, the sum starts with the next round */
    sumBtn.onclick = () => { LIVE.sum = !LIVE.sum; ACC.est = null; buttons(); sayWhen() }
    buttons()

    buildData(true)
    results()
    sayWhen()
    O.drawPaths(false)
    /* ANOTHER CHART from the host's menu (Analysis › New chart): O.addChart('map') -- on the module the page
       returns, because that is what the host keeps (window.OPTICS); its id, or null where no panel is made */
    O.addChart = type => addChart(type)
    /* THE PICTURE'S LIGHTS FOLLOW A MOVE AT ONCE (0.61.4): the host calls this after every live change (app.html,
       BUILDER.afterLive: a gizmo's drag, a slider, the timeline). The lights' photons start from the source table this
       reads off the document, and it was read only by the half-second tick above, or by the live rays' rounds while they
       were shown: a lamp group dragged moved its reflector and its face every frame (uniforms) while its photons kept
       starting where it had been up to half a second before -- the light lagging the object, updating a few times a
       second, its photons leaving from behind the reflector's new place (the user, 2026-10-16, Reflector.json).
       A table is about 0.03 ms of the CPU (measured on the user's laptop, three scenes). */
    O.followScene = () => { followScene() }
    return O
}
