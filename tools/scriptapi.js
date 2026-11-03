//======================================================================================================================
// THE SCRIPT'S API -- what a scene's script (builder/model.js SCRIPT, 0.next) is handed: every setting by its path, the
// camera, the live picture and what it measures, a render kept in the darkroom and written to a file, an analysis run
// and the numbers read off it, files to save.
//
//   const api = makeScriptApi({ PARAMS, RT, BUILDER, OPTICS, signal, log })
//   await runScript(code, api)                  // the script's names are api's: params, camera, render, optics, ...
//
// The user, 2026-11-03: "a javascript code block (part of a scene) that can control and read everything ... for
// example for a generative art work ... data: measure; Analysis, run -> data ... with that a lens can be optimised
// (a built-in optimiser comes later)". So this is the optimiser's contract too: a variable is a parameter's path,
// a run is optics.run(), and what it minimises is a number read off the result.
//
// NOTHING HERE IS A NEW MECHANISM, each part is the one the page already has, so a script sees what a person sees:
//   settings          PARAMS (lib/shell/params.js): the registry the Parameters panel, the timeline and the palette
//                     write through. A script's write is quiet -- no undo step each, as the timeline's -- and a path
//                     that does not exist THROWS: an optimiser "optimising" a typo would be the worst outcome (PARAMS
//                     write says the same). A structural one compiles: settled() waits for it.
//   the camera        RT.view / RT.applyView, what a scene keeps as its view
//   the picture       RT.measure / measureRegion, the HUD's cursor reading; RT.hud.samples
//   a render          RT.renderPicture into the darkroom (kept as light) and shown there; saved through the
//                     darkroom's own export (lib/pathtracer/darkroom/export/run.js), any of its formats
//   an analysis       the Analysis pane's (optics/page.js O.analyse): shown in the pane and the charts as ▶ Run's is,
//                     and read here with the functions those charts draw from (optics/farfield.js, illum.js,
//                     detmap.js) -- so a number a script prints is the number the chart shows, never a second sum
// What this file adds is the shapes those leave to a caller, and stopping: every call that waits (await) checks the
// run's signal, so ■ Stop ends a loop at its next one. One that only sets is not stopped -- a `finally` putting the
// settings back must still run after a Stop -- and a loop that never waits holds the page: Stop cannot be pressed.
//
// PURE BUT FOR WHAT IT IS HANDED: no DOM, no device. tools/test/script.test.mjs drives it with stand-ins and real
// optics arithmetic.
//======================================================================================================================

import { intensity, planeCurve, farStats, zoneFlux, intensityCSV } from '../lib/pathtracer/optics/farfield.js'
import { detectorMap } from '../lib/pathtracer/optics/detmap.js'
import { profile, radial, encircled, isolux, peak, centroid, cellAt, cellSe, intensityAt, virtualPlane, rangeOfPoints } from '../lib/pathtracer/optics/illum.js'
import { exportPicture } from '../lib/pathtracer/darkroom/export/run.js'
import { FORMATS, defaultExport } from '../lib/pathtracer/darkroom/export/index.js'

/** The names a script is handed (makeScriptApi's keys, test/script.test.mjs holds the two together): what the editor
 *  colours as the script's own (tools/scripthighlight.js). */
export const SCRIPT_NAMES = Object.freeze(['params', 'settled', 'scene', 'camera', 'exposure', 'picture', 'render', 'optics', 'files',
    'log', 'warn', 'progress', 'sleep', 'frame', 'check', 'signal', 'st'])

/** The error a stopped script ends with: said as "stopped", not as a failure. */
export const STOPPED = 'ScriptStopped'
const stoppedError = () => { const e = new Error('stopped'); e.name = STOPPED; return e }

/** A value as a line of the output: numbers to 6 figures, objects as compact JSON (typed arrays as lists, at most 20). */
export function formatValue(v, depth = 0) {
    if (typeof v === 'string') return depth ? JSON.stringify(v) : v
    if (typeof v === 'number') return Number.isFinite(v) ? String(+v.toPrecision(6)) : String(v)
    if (v == null || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
    if (typeof v === 'function') return `[function ${v.name || ''}]`.replace(' ]', ']')
    if (v instanceof Error) return `${v.name}: ${v.message}`
    if (depth > 4) return '…'
    if (ArrayBuffer.isView(v)) v = Array.from(v.length > 20 ? v.subarray(0, 20) : v).concat(v.length > 20 ? [`… ${v.length} in all`] : [])
    if (Array.isArray(v)) return `[${v.map(x => formatValue(x, depth + 1)).join(', ')}]`
    if (v instanceof Date) return v.toISOString()
    const keys = Object.keys(v).filter(k => typeof v[k] !== 'function')
    return `{ ${keys.map(k => `${k}: ${formatValue(v[k], depth + 1)}`).join(', ')} }`
}

/** Rows as CSV: a list of lists, or a list of objects (the first one's keys the header). Text quoted where it must be. */
export function toCSV(rows) {
    if (!Array.isArray(rows)) throw new Error('csv: a list of rows (lists or objects)')
    const cell = x => {
        const s = typeof x === 'number' ? String(x) : x == null ? '' : String(x)
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    if (rows.length && !Array.isArray(rows[0]) && typeof rows[0] === 'object') {
        const head = Object.keys(rows[0])
        return [head.map(cell).join(','), ...rows.map(r => head.map(k => cell(r[k])).join(','))].join('\n') + '\n'
    }
    return rows.map(r => (Array.isArray(r) ? r : [r]).map(cell).join(',')).join('\n') + '\n'
}

/* A FILE'S CONTENTS AS A BLOB: a Blob as it is; text as text (its type by the name); rows (a list) as CSV; any other
   value as JSON */
const TYPES = { csv: 'text/csv', json: 'application/json', txt: 'text/plain', svg: 'image/svg+xml', html: 'text/html' }
export function fileBlob(name, data) {
    const ext = String(name).split('.').pop().toLowerCase()
    if (typeof Blob !== 'undefined' && data instanceof Blob) return data
    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) return new Blob([data], { type: 'application/octet-stream' })
    if (typeof data === 'string') return new Blob([data], { type: TYPES[ext] ?? 'text/plain' })
    if (Array.isArray(data) && ext !== 'json') return new Blob([toCSV(data)], { type: 'text/csv' })
    return new Blob([JSON.stringify(data, (k, v) => ArrayBuffer.isView(v) ? Array.from(v) : v, 2)], { type: 'application/json' })
}

/*======================================================================================================================
  AN ANALYSIS, AS A SCRIPT READS IT: optics/page.js O.analysis()'s snapshot -- its totals, its far field, the detector
  hits kept for the map -- with the numbers the charts show read off it. Pure: the node test builds a snapshot by hand.
======================================================================================================================*/
const val = s => s == null ? null : typeof s === 'number' ? s : s.value
/** The intensity grid read at (gamma, C) in degrees, with its error, interpolated as the charts read it. */
const readI = (R, gamma, C) => intensityAt(R, gamma, C)

export function analysisOf(S) {
    if (!S?.results) return null
    const r = S.results, far = S.far
    const tagName = S.tagName ?? (t => `tag ${t}`), matName = S.matName ?? (i => `material ${i}`)
    const needFar = what => { if (!far) throw new Error(`${what}: this analysis has no far field (the Analysis pane's Intensity › from)`); return far }
    const memo = new Map()
    const R = ({ symmetry = 'none', perKlm = false } = {}) => {
        const k = `${symmetry}|${perKlm}`
        if (!memo.has(k)) memo.set(k, intensity(needFar('intensity'), { symmetry, perKlm }))
        return memo.get(k)
    }
    const hits = S.hits ?? []
    const tags = () => [...new Set(hits.map(h => h.tag))].sort((a, b) => a - b)
    /* a detector by its tag (a number), or by the name of the object it is (a node's label, or id) */
    const tagOf = d => {
        const list = tags()
        if (d == null) { if (!list.length) throw new Error('map: no detector hits in this analysis (give a surface a detector material)'); return list[0] }
        if (typeof d === 'number') { if (!list.includes(d)) throw new Error(`map: no hits on tag ${d} (hit: ${list.join(', ') || 'none'})`); return d }
        const t = list.find(x => tagName(x) === String(d))
        if (t == null) throw new Error(`map: no detector '${d}' was hit (hit: ${list.map(tagName).join(', ') || 'none'})`)
        return t
    }
    const A = {
        /** the rays traced, in how many batches, when; stale: the scene changed since */
        rays: S.rays ?? r.rays, batches: r.batches, at: S.at ?? null, stale: !!S.stale,
        /** what the run traced without: the haze box's dust, said by the page ('' for nothing) */
        note: S.haze || '',
        unit: r.unit ?? 'lm',
        /** the flux in all, each { value, se } in lm: emitted, escaped, lost, absorbed, detected, volume */
        totals: Object.fromEntries(['emitted', 'escaped', 'lost', 'absorbed', 'detected', 'volume'].map(k => [k, r[k] ?? null])),
        /** what every object received and absorbed, each { value, se } lm, and how many hits -- named as the tree names them */
        objects: (r.objects ?? []).map(o => ({ tag: o.index, name: tagName(o.index), incident: o.incident, absorbed: o.absorbed, hits: o.hits })),
        materials: (r.materials ?? []).map(o => ({ index: o.index, name: matName(o.index), incident: o.incident, absorbed: o.absorbed, hits: o.hits })),
        /** the share of the emitted flux that escaped (the far field's own share is stats().efficiency) */
        get efficiency() { const e = val(r.emitted), x = val(r.escaped); return e > 0 ? x / e : null },
        /** an object's row by its name or tag, or null */
        object: name => A.objects.find(o => o.name === String(name) || o.tag === name) ?? null,

        // ---- THE FAR FIELD (optics/farfield.js): luminous intensity by direction, type C ---------------------------
        hasFarField: !!far,
        far: far ?? null,
        /** the intensity grid: { nC, nG, dC, dG, I, se, unit }, I gamma-major (index j * nC + i) */
        intensity: opts => R(opts),
        /** I and its error at (gamma, C) degrees: { I, se } */
        intensityAt: (gamma, C = 0, opts) => readI(R(opts), gamma, C),
        /** the brightest bin: { I, se, gamma, C } */
        peak: opts => farStats(needFar('peak'), R(opts), [0]).max,
        /** what a datasheet gives: I max, per C plane its peak and the beam (50 %) and field (10 %) angles, the flux, the
         *  efficiency and the zones 0-30, 0-60, 0-90, 90-180 (farStats) */
        stats: ({ planes = [0, 90], ...opts } = {}) => farStats(needFar('stats'), R(opts), planes),
        /** the beam and field angles of the C plane through C and C + 180: { C, peak, beam: { minus, plus, width }, field } */
        beam: (C = 0, opts) => farStats(needFar('beam'), R(opts), [C]).planes[0],
        /** the flux within `angle` degrees of the axis, lm (a cone; zoneFlux) */
        fluxWithin: angle => zoneFlux(needFar('fluxWithin'), 0, +angle),
        /** the flux between two angles from the axis, lm */
        fluxBetween: (from, to) => zoneFlux(needFar('fluxBetween'), +from, +to),
        /** the flux the far field holds, lm */
        get farFlux() { return far ? far.flux.reduce((a, b) => a + b, 0) : null },
        /** the C plane through C and C + 180 as the polar diagram draws it: [{ a (signed gamma), I, se }] */
        curve: (C = 0, opts) => planeCurve(R(opts), C).points,
        /** the grid as CSV, a row per gamma (intensityCSV) */
        intensityCSV: opts => intensityCSV(R(opts)),
        /** the far field on a plane `h` metres off along the axis (virtualPlane): a map, as map() returns */
        plane: ({ h = 1, half = 0, cells = 64, symmetry = 'none' } = {}) =>
            mapOf({ ...virtualPlane(needFar('plane'), R({ symmetry }), { h, half, cells }), lengthUnit: 'm' }, `the far field ${h} m off`),

        // ---- THE DETECTORS' HITS AND THEIR MAPS (optics/detmap.js, illum.js) -----------------------------------------
        /** every detector hit: { tag, name, hits } */
        detectors: () => tags().map(t => ({ tag: t, name: tagName(t), hits: hits.filter(h => h.tag === t).length })),
        /** the hits on one detector (each batch's share of the flux, as the map reads them): { pos, dir, flux, tag, xyz? } */
        hits: detector => { const t = tagOf(detector); return hits.filter(h => h.tag === t) },
        /** A DETECTOR'S ILLUMINANCE MAP: cells a side, smoothing 'none' | 'gauss' | 'epan' | 'knn' (bandwidth in cells, k),
         *  over the whole detector (its measured box, `area` 'detector') or where the light landed ('lit') */
        map(detector, { cells = 64, smooth = 'none', bandwidth = 1.5, k = 32, area = 'detector' } = {}) {
            const t = tagOf(detector)
            const corners = area === 'detector' ? S.corners?.(t) : null
            const m0 = detectorMap(hits.filter(h => h.tag === t), { cells: cells | 0, metresPerUnit: S.metresPerUnit ?? 1,
                unit: S.hitsUnit ?? 'lm', smooth, bandwidth, k: k | 0, range: corners ? rangeOfPoints(corners) : null })
            if (!m0) throw new Error(`map: too few hits on '${tagName(t)}' for a map`)
            // the world's coordinates where the map's axes are the world's, as the page shows it (page.js currentIllum)
            const off = m0.axisNames ? [0, 1].map(j => m0.origin.reduce((s, x, i) => s + x * (j ? m0.v : m0.u)[i], 0)) : [0, 0]
            return mapOf({ ...m0, range: { a: m0.range.a.map(x => x + off[0]), b: m0.range.b.map(x => x + off[1]) },
                           lengthUnit: S.lengthUnit ?? 'units', axisNames: m0.axisNames ?? ['u (fitted)', 'v (fitted)'] }, tagName(t))
        },
    }
    return A
}

/** A MAP, as a script reads it: detectorMap's numbers (max, meanLit, minLit, uniformity, total, colour, ...) and the
 *  charts' readings about a point -- the peak by default, as the charts' `through` is. */
function mapOf(m, name) {
    const about = p => p === 'peak' || p == null ? peak(m) : p === 'centroid' ? centroid(m) : p
    return {
        name, nx: m.nx, ny: m.ny, cell: m.cell, range: m.range, unit: m.unit, lengthUnit: m.lengthUnit, axisNames: m.axisNames,
        E: m.E, max: m.max, meanLit: m.meanLit, minLit: m.minLit, uniformity: m.uniformity, total: m.total,
        litArea: m.litArea, colour: m.colour ?? null, relNoise: m.relNoise ?? null, raw: m,
        /** E at a point (the map's coordinates), with its error: { E, se } or null off the map */
        at(a, b) { const c = cellAt(m, a, b); return c ? { E: m.E[c.i], se: cellSe(m, c.i) } : null },
        peak: () => peak(m),
        centroid: () => centroid(m),
        /** along 'a' or 'b' through a point ('peak', 'centroid' or [a, b]): [{ x, y: E, se }] */
        profile: (axis = 'a', p) => profile(m, axis, about(p)),
        /** E averaged over rings about a point: [{ x: r, y: E, se, cells, full }] */
        radial: p => radial(m, about(p)),
        /** the share of the flux within a radius: { points, total, r50, r90 } */
        encircled: p => encircled(m, about(p)),
        isolux: levels => isolux(m, levels),
    }
}

/*======================================================================================================================
  THE API
======================================================================================================================*/
/**
 * @param PARAMS    the parameter registry (lib/shell/params.js)
 * @param RT        the renderer: view, applyView, measure, measureRegion, hud, renderPicture, darkroom, darkroomShow,
 *                  darkroomLook, sceneBusy, kernelsSettled, running, size
 * @param BUILDER   the builder (its doc, applying), or null
 * @param OPTICS    the optics page's module (O.analyse, O.analysis, O.analysisSetup, O.setupAnalysis), or null
 * @param signal    the run's AbortSignal: ■ Stop
 * @param log       (text, kind) => a line of the output; kind 'log' | 'warn' | 'error'
 * @param save      (blob, name) => the browser's download
 * @param progress  ({ label, done, total }) or (null) => the status bar's job
 * @param frame     () => a promise of the next animation frame
 * @param build     () => the build's line for a file's header (the version and revision)
 */
export function makeScriptApi({ PARAMS, RT, BUILDER = null, OPTICS = null, signal = new AbortController().signal,
                                log: out = () => { }, save = () => { throw new Error('files: nowhere to save to') },
                                progress: job = () => { }, frame = () => new Promise(r => setTimeout(r, 16)),
                                build = () => '', now = () => Date.now() }) {
    const check = () => { if (signal.aborted) throw stoppedError() }
    /* every call of the API checks the signal before it starts and after it waits: Stop ends a script at its next call */
    const guard = fn => async (...a) => { check(); const v = await fn(...a); check(); return v }
    const line = (kind, a) => out(a.map(x => formatValue(x)).join(' '), kind)
    const sleep = guard(ms => new Promise((res, rej) => {
        const t = setTimeout(done, Math.max(0, +ms || 0))
        function done() { signal.removeEventListener?.('abort', stop); res() }
        function stop() { clearTimeout(t); rej(stoppedError()) }
        signal.addEventListener?.('abort', stop, { once: true })
    }))
    const nextFrame = guard(() => frame())

    // ---- SETTINGS ------------------------------------------------------------------------------------------------------
    const entryOf = p => ({ path: p.path, label: p.label ?? p.path, group: p.group, kind: p.kind ?? 'live', value: PARAMS.current(p.path),
                            min: p.min, max: p.max, step: p.step, unit: p.unit, dims: p.dims | 0 || 1, options: p.options,
                            animated: !!p.animated })
    const known = path => {
        const p = PARAMS.get(path)
        if (!p) {
            /* what is near: the settings beside it (its node's), else those matching its last word */
            const at = String(path), parent = at.slice(0, at.lastIndexOf('/'))
            const beside = parent.includes('/') ? PARAMS.list(parent).map(x => x.path) : []
            const near = (beside.length ? beside : PARAMS.find?.(at.split('/').pop(), 5)?.map(x => x.path) ?? []).slice(0, 6)
            throw new Error(`no parameter '${path}'${near.length ? ` (did you mean ${near.join(', ')}?)` : ''}`)
        }
        return p
    }
    const params = {
        /** every setting under a path ('scene', 'scene/n4', 'renderer', 'view/camera'), as { path, label, value, min, max,
         *  kind ('live' or 'structural': a compile), animated, ... }; { animated: true } only the ones flagged animated,
         *  { live: true } only the ones that need no compile */
        list(prefix = '', { animated = false, live = false } = {}) {
            return PARAMS.list(prefix).filter(p => (!animated || p.animated) && (!live || p.kind !== 'structural')).map(entryOf)
        },
        /** the settings flagged animated (the Parameters panel's ★): what a piece of generative art usually moves */
        animated: (prefix = '') => params.list(prefix, { animated: true }),
        /** one setting's entry, or a throw for a path that does not exist */
        info: path => entryOf(known(path)),
        /** a setting's value: a number, or a list of numbers for a vector or a colour */
        get: path => { known(path); return PARAMS.current(path) },
        /** set a setting -- coerced to its range, and returned as it was set. No undo step unless { undo: true }. A
         *  structural one starts a compile: await settled() before reading anything off the picture */
        set(path, value, { undo = false } = {}) {
            known(path)
            return PARAMS.write(path, value, { source: 'script', quiet: !undo })
        },
        /** set several at once, { path: value }; every path checked before any is set */
        apply(values) {
            for (const path of Object.keys(values ?? {})) known(path)
            const out = {}
            for (const [path, v] of Object.entries(values)) out[path] = PARAMS.write(path, v, { source: 'script', quiet: true })
            return out
        },
        /** settings matching every word of a query, best first */
        find: (q, limit = 20) => PARAMS.find(q, limit).map(entryOf),
    }

    /* SETTLED: no build under way, and none for a few frames -- a structural write's compile starts at once (the tree's
       apply), the bake's swap later; and the renderer's kernels for its settings built */
    const settled = guard(async ({ timeout = 300000 } = {}) => {
        const t0 = now()
        let quiet = 0
        while (quiet < 3) {
            if (now() - t0 > timeout) throw new Error(`settled: still compiling after ${timeout / 1000} s`)
            await frame(); check()
            const busy = !!BUILDER?.applying || !!RT.sceneBusy?.()
            quiet = busy ? 0 : quiet + 1
        }
        await RT.kernelsSettled?.()
    })

    // ---- THE SCENE -------------------------------------------------------------------------------------------------------
    const walk = (n, out, parent = null) => {
        if (!n) return out
        if (parent) out.push({ id: n.id, label: n.label ?? n.id, kind: n.kind, type: n.type, parent, path: `scene/${n.id}` })
        for (const c of n.children ?? []) walk(c, out, n.id)
        return out
    }
    const scene = {
        get title() { return BUILDER?.doc?.title ?? '' },
        get unit() { return BUILDER?.doc?.unit ?? RT.scene?.unit ?? 'm' },
        /** every node: { id, label, kind, type, parent, path } -- its settings are params.list(path) */
        nodes: () => walk(BUILDER?.doc?.root, []),
        /** a node by its label or id, or null */
        node: name => scene.nodes().find(n => n.label === String(name) || n.id === String(name)) ?? null,
    }

    // ---- THE CAMERA AND THE EXPOSURE (RT.view: what a scene keeps as its view) --------------------------------------------
    const camera = {
        /** { mode, camtype, azimuth, elevation, distance, target, fov, aperture, focus, ... }, lengths in the scene's unit */
        get: () => RT.view().camera,
        /** any of those; the rest stay. Returns the camera as it is now */
        set(patch) { RT.applyView({ camera: patch }); return RT.view().camera },
    }
    const exposure = {
        get: () => RT.view().exposure,
        set(patch) { RT.applyView({ exposure: patch }); return RT.view().exposure },
    }

    // ---- THE LIVE PICTURE ------------------------------------------------------------------------------------------------
    const picture = {
        /** the samples the live picture holds now */
        samples: () => RT.hud?.samples ?? 0,
        /** wait until the live picture holds `n` samples -- after the frames a change takes to start it over */
        wait: guard(async (n = 16, { timeout = 600000 } = {}) => {
            if (RT.running && !RT.running()) throw new Error('picture.wait: the live picture is paused')
            const t0 = now()
            await frame(); await frame(); check()
            while ((RT.hud?.samples ?? 0) < n) {
                if (now() - t0 > timeout) throw new Error(`picture.wait: ${RT.hud?.samples ?? 0} of ${n} samples after ${timeout / 1000} s`)
                await frame(); check()
            }
            return RT.hud?.samples ?? 0
        }),
        /** what the picture measures at a point, x and y from -1 to 1 (left to right, bottom to top): { L (cd/m²), se, ... } */
        measure: guard((x, y) => RT.measure(x, y)),
        /** a rectangle's mean, its error, min, max and uniformity: { mean, se, min, max, uniformity, unit, ... } */
        region: guard((xa, ya, xb, yb) => RT.measureRegion(xa, ya, xb, yb)),
        /** the live view's size: { w, h, ... } */
        size: () => RT.size?.() ?? null,
    }

    // ---- A RENDER, KEPT AS LIGHT (the darkroom) ------------------------------------------------------------------------
    let renders = 0
    const fmtOf = (name, format) => {
        const f = format ?? (() => { const ext = String(name).split('.').pop().toLowerCase(); return ext === 'jpg' ? 'jpeg' : ext })()
        if (!FORMATS.some(x => x.id === f)) throw new Error(`save: format '${f}' is not one of ${FORMATS.map(x => x.id).join(', ')}`)
        return f
    }
    const handleOf = (pic, id) => {
        const mine = () => {
            const p = RT.darkroom?.picture
            if (id !== renders || !p || p.w !== pic.w || p.h !== pic.h || p.samples !== pic.samples)
                throw new Error('this render is no longer the darkroom\'s: it keeps one picture, the last rendered')
            return p
        }
        /* the settings it is developed with: as the view showed it, or the darkroom's look as the panel has it now, and
           over either any setting named (ev, toneMap, contrast, ...) */
        const lookOf = look => {
            const base = look === 'darkroom' || look?.from === 'darkroom' ? (RT.darkroomLook?.() ?? pic.view) : pic.view
            const over = look && typeof look === 'object' ? Object.fromEntries(Object.entries(look).filter(([k]) => k !== 'from')) : {}
            return { ...structuredClone(base), ...over }
        }
        const blob = guard(async (name = 'render.png', { format, look = 'view', quality, values, precision, gamut } = {}) => {
            mine()
            const ex = { ...defaultExport(), format: fmtOf(name, format) }
            for (const [k, v] of Object.entries({ quality, values, precision, gamut })) if (v !== undefined) ex[k] = v
            return exportPicture({ darkroom: RT.darkroom, ex, settings: lookOf(look), build: build() })
        })
        return {
            width: pic.w, height: pic.h, samples: pic.samples, view: { ...pic.view },
            /** the file as a Blob: its format by the name's extension (png, jpg, webp, exr, hdr, pfm) or `format` ('png16'
             *  for 16 bits); `look` 'view' (as the view showed it), 'darkroom' (the panel's settings now), or settings
             *  over the view's ({ ev: 12, toneMap: 2, ... }, or { from: 'darkroom', ev: 12 }) */
            blob,
            /** ...and downloaded under `name`, as it is (no time added) */
            save: guard(async (name = 'render.png', opts = {}) => {
                const b = await blob(name, opts)
                save(b, name)
                return { name, bytes: b.size }
            }),
            /** one pixel's light, x and y the picture's (row 0 the bottom): { rgb (cd/m²), Y } */
            pixel: guard((x, y) => { mine(); return RT.darkroom.pixel(x, y) }),
            /** the EV the darkroom's meter reads off the picture */
            meter: guard(() => { mine(); return RT.darkroom.meter() }),
        }
    }
    /** Render `samples` samples at `width` x `height` (the live view's size if not given), keep it in the darkroom, show it
     *  there (unless show: false), and return it: .save(name, opts), .blob(name, opts), .pixel(x, y). */
    const render = guard(async ({ width, height, samples = 64, show = true } = {}) => {
        if (RT.offscreenBusy?.()) throw new Error('render: another render or a recording is under way')
        const size = RT.size?.() ?? {}
        const w = Math.round(width ?? size.w), h = Math.round(height ?? size.h)
        if (!(w >= 1 && h >= 1)) throw new Error('render: a width and a height in pixels')
        const label = `script render ${w} × ${h}`
        try {
            const pic = await RT.renderPicture({ width: w, height: h, samples: samples | 0 || 1, signal,
                onProgress: (i, n) => { if (i === n || i % 4 === 0) job({ label, done: i, total: n }) } })
            const id = ++renders
            if (show) RT.darkroomShow?.(pic)
            return handleOf(pic, id)
        } catch (e) {
            if (e?.name === 'AbortError') throw stoppedError()
            throw e
        } finally { job(null) }
    })

    // ---- THE ANALYSIS (optics/page.js) -----------------------------------------------------------------------------------
    const needOptics = () => { if (!OPTICS?.analyse) throw new Error('optics: this page has no Analysis pane'); return OPTICS }
    const optics = {
        /** what the next run traces with: { rays, from, axis, flip, dG, dC } and the choices (fromOptions, axisOptions) */
        setup: () => needOptics().analysisSetup(),
        /** change it: { rays, from: 'escaped' | a detector material, axis: a light | [x, y, z], flip, dG, dC } */
        configure: patch => needOptics().setupAnalysis(patch),
        /** run the analysis -- with `setup` first -- shown in the pane and charts as ▶ Run's, and return what it found */
        run: guard(async (setup = null) => {
            const O = needOptics()
            return analysisOf(await O.analyse(setup))
        }),
        /** the last analysis the pane holds (a click's or a script's), or null */
        last: () => analysisOf(OPTICS?.analysis?.() ?? null),
    }

    // ---- FILES -------------------------------------------------------------------------------------------------------
    const files = {
        /** download `data` as `name`: text, a list of rows (CSV), any other value (JSON), or a Blob */
        save(name, data) { const b = fileBlob(name, data); save(b, String(name)); return { name: String(name), bytes: b.size } },
        csv: toCSV,
    }

    const api = {
        params, settled, scene, camera, exposure, picture, render, optics, files,
        log: (...a) => line('log', a),
        warn: (...a) => line('warn', a),
        /** a job in the status bar: progress(done, total, label), progress(null) to clear */
        progress: (done, total, label = 'script') => { if (done == null) job(null); else job({ label, done, total }) },
        sleep, frame: nextFrame,
        /** throws "stopped" if ■ Stop was pressed: for a long loop that calls nothing else */
        check,
        signal,
    }
    api.st = api
    return api
}

/*======================================================================================================================
  RUNNING ONE: the code as the body of an async function whose arguments are the API's names, in strict mode. An error's
  line is the script's own: the line a function's body starts on is measured once here, not assumed (each engine wraps
  `new Function` text its own way).
======================================================================================================================*/
const AsyncFunction = (async () => { }).constructor
const PRELUDE = '"use strict";\n'
let BODY_LINE = undefined
const lineOf = e => {
    const m = /scene-script\.js:(\d+):(\d+)/.exec(String(e?.stack ?? ''))
    return m ? [+m[1], +m[2]] : null
}
function bodyLine() {
    if (BODY_LINE !== undefined) return BODY_LINE
    try { new Function(`${PRELUDE}throw new Error('probe')\n//# sourceURL=scene-script.js`)() }
    catch (e) { const at = lineOf(e); BODY_LINE = at ? at[0] : null }
    return BODY_LINE
}
/** Where in the script an error was thrown: { line, column } (1-based), or null when the engine does not say. */
export function scriptLocation(e) {
    const at = lineOf(e), b = bodyLine()
    return at && b ? { line: at[0] - b + 1, column: at[1] } : null
}

/** Compile `code` and run it with `api`'s names in scope; resolves with what the script returns. A syntax error throws
 *  before anything runs. */
export async function runScript(code, api) {
    const names = Object.keys(api).filter(k => /^[A-Za-z_$][\w$]*$/.test(k))
    const fn = new AsyncFunction(...names, `${PRELUDE}${code}\n//# sourceURL=scene-script.js`)
    return await fn(...names.map(k => api[k]))
}
