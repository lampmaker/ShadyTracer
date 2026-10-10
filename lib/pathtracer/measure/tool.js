//======================================================================================================================
// THE MEASURE TOOL -- readings pinned to the picture, the average over a rectangle, and the false
// colour's legend, drawn over the render.
//
//   const M = installMeasureTool({ stage, canvas, RT, toolbar })     // toolbar: installViewToolbar's
//   M.pins, M.area            what is placed;  M.readings() the numbers;  M.csv() the same as text
//
// Its buttons are the MEASURE group of the view's analysis drawer (viewtools.js V.analyse, bottom right; it had a
// bar of its own there until 2026-10-02, the user: "should belong together"), icons with tooltips (icons.js):
// ( pin  area ) clear, save as CSV -- and while anything is placed the drawer's button shows a pin, the drawer
// open or not. With Pin or Area on, a press on the picture is
// the tool's and nobody else's (the camera and the builder's selection both listen for mousedown on
// the canvas, so the tool takes it in the capture phase on the window, before either). Escape or the
// button again turns it off.
//
// A PIN STICKS TO THE SURFACE clicked, not to the screen: the click is picked (RT.pick, the pick
// kernel), and the world point is projected again every frame, so orbiting keeps it on the same
// spot of the floor and it re-reads there as the picture converges. Where the pick finds nothing (the
// sky, or the pick kernel still compiling) it stays at its place on the screen. A click on a pin
// removes it.
//
// THE AREA IS A RECTANGLE OF THE PICTURE, not of a surface: its mean is over pixels (see
// core/measure.js regionReading for what that means on a receding floor).
//
// NUMBERS ARE IN WHAT THE VIEW SHOWS: lux in the illuminance view (Measure group), cd/m^2 in the
// picture and the luminance view. Each carries its standard error, from the picture's own samples.
//
// AND THE COLOUR (core/measure.js chromaOf): CCT + Duv near white, CIE xy away from it, exact even
// for a saturated LED outside the display's gamut. In the ILLUMINANCE view the surface is white for
// the camera, so it is the colour of the light arriving there -- which is what a colour meter held
// on that surface would read; in the picture it is light times surface. An area adds the colour of
// all its pixels together, and says how far they stray from it (u'v', max and rms).
//
// Everything is read with the engine's readbacks (RT.measure, RT.measureRegion) a few times a
// second while something is placed, one read in flight, and nothing at all otherwise.
//======================================================================================================================
import { projectPoint } from '../core/genrays.js'
import { fmtChroma } from '../core/measure.js'
import { iconButton, iconPill, lit, enable } from '../icons.js'

const READ_MS = 400
const PIN_GRAB_PX = 9
const INK = { pin: '#ffe14d', area: '#7fe0ff', text: '#ffffff', shade: 'rgba(0,0,0,0.6)' }

/** A reading as a short number: three significant digits, exponent past 1e5 or under 0.01. */
export const fmtValue = v => {
    if (v == null || !Number.isFinite(v)) return '–'
    if (v === 0) return '0'
    const a = Math.abs(v)
    return a >= 1e5 || a < 0.01 ? v.toExponential(2) : v.toPrecision(3)
}
const fmtRel = rel => rel == null ? '± ?' : `± ${(rel * 100).toFixed(rel < 0.01 ? 2 : 1)}%`

/** The legend's ticks for a log scale from lo to hi: the band edges when there are few bands (so a
 *  colour can be read off as a range), the decades otherwise. Positions are 0..1 along the strip. */
export function legendTicks(lo, hi, bands) {
    lo = Math.max(lo, 1e-6); hi = Math.max(hi, lo * 1.001)
    const L0 = Math.log10(lo), L1 = Math.log10(hi)
    const at = v => (Math.log10(v) - L0) / (L1 - L0)
    if (bands > 0 && bands <= 12) return Array.from({ length: bands + 1 }, (_, k) => {
        const v = lo * Math.pow(hi / lo, k / bands)
        return { t: k / bands, v }
    })
    const out = [{ t: 0, v: lo }]
    for (let d = Math.ceil(L0 + 1e-9); d < L1 - 1e-9; d++) out.push({ t: at(10 ** d), v: 10 ** d })
    out.push({ t: 1, v: hi })
    return out
}

export function installMeasureTool({ stage, canvas, RT, toolbar }) {
    const el = document.createElement('canvas')
    Object.assign(el.style, { position: 'absolute', inset: '0', width: '100%', height: '100%',
        zIndex: '6', pointerEvents: 'none' })
    stage.appendChild(el)
    const g = el.getContext('2d')
    let cssW = stage.clientWidth, cssH = stage.clientHeight
    new ResizeObserver(() => { cssW = stage.clientWidth; cssH = stage.clientHeight; wake() }).observe(stage)

    const T = { mode: null, pins: [], area: null, areaReading: null, dragging: null }
    let nextPin = 1

    /* THE PICTURE'S RECTANGLE IN THE STAGE: the canvas is object-fit: contain, so the picture is
       letterboxed (the builder's overlay says the same, builder/overlay.js LETTERBOXING) */
    const view = () => {
        const bw = canvas.width || 1, bh = canvas.height || 1
        const s = Math.min(cssW / bw, cssH / bh), dw = bw * s, dh = bh * s
        return { ox: (cssW - dw) / 2, oy: (cssH - dh) / 2, dw, dh }
    }
    const toPic = (V, px, py) => [((px - V.ox) / V.dw) * 2 - 1, 1 - ((py - V.oy) / V.dh) * 2]
    const toStage = (V, x, y) => [V.ox + (x * 0.5 + 0.5) * V.dw, V.oy + (0.5 - y * 0.5) * V.dh]
    /* where a pin is now, in the picture's [-1, 1]: projected again if it is on a surface; null
       behind the camera or off the picture */
    const pinAt = p => {
        if (!p.world) return [p.x, p.y]
        const cam = RT.cam
        if (!cam) return null
        const q = projectPoint(p.world, cam.getUniforms(), cam.get().camtype ?? 0)
        if (!(q.depth > 0) || Math.abs(q.x) > 1 || Math.abs(q.y) > 1) return null
        return [q.x, q.y]
    }

    //--------------------------------------------------------------------------------------------------------------
    // THE BUTTONS, in the view's analysis drawer
    //--------------------------------------------------------------------------------------------------------------
    const setMode = m => {
        T.mode = T.mode === m ? null : m
        lit(pinBtn, T.mode === 'pin'); lit(areaBtn, T.mode === 'area')
        stage.style.cursor = T.mode ? 'crosshair' : ''
    }
    const pinBtn = iconButton('pin', 'Pin a reading: click a surface (click a pin to remove it)', () => setMode('pin'))
    const areaBtn = iconButton('area', 'Average over a rectangle: drag one', () => setMode('area'))
    const clearBtn = iconButton('clear', 'Remove the pins and the area', () => {
        T.pins = []; T.area = null; T.areaReading = null; nextPin = 1; wake()
    })
    const saveBtn = iconButton('download', 'Save the readings as CSV', () => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(new Blob([csv()], { type: 'text/csv' }))
        a.download = 'measurements.csv'
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    })
    // the two modes are switches, one at a time; clearing and saving are actions -- greyed while there is nothing to
    // clear or save (the user, 2026-10-02), as Undo is with nothing to undo
    toolbar.analyse.add('measure', 'Measure', iconPill(pinBtn, areaBtn), clearBtn, saveBtn)
    enable(clearBtn, false); enable(saveBtn, false)
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && T.mode) setMode(T.mode) })

    //--------------------------------------------------------------------------------------------------------------
    // THE MOUSE: only while a mode is on, and only on the picture
    //--------------------------------------------------------------------------------------------------------------
    /* ON THE WINDOW, IN THE CAPTURE PHASE: the first listener of all. The builder's selection
       overlay also captures mousedown on the stage, registered before this, and stopping
       propagation from a stage listener does not stop another listener on the stage -- a pin
       click would have selected an object as well. From the window, nothing below hears it. */
    window.addEventListener('mousedown', e => {
        if (!T.mode || e.button !== 0 || e.target !== canvas) return
        e.stopPropagation()                    // before the canvas: no orbit, no builder selection
        e.preventDefault()
        const r = stage.getBoundingClientRect()
        const at = ev => [ev.clientX - r.left, ev.clientY - r.top]
        const V = view(), p0 = at(e)
        if (T.mode === 'pin') {
            window.addEventListener('mouseup', ev => {
                const p1 = at(ev)
                if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 3) return
                placePin(V, p0)
            }, { capture: true, once: true })
            return
        }
        T.dragging = { a: p0, b: p0 }
        const move = ev => { T.dragging.b = at(ev); wake() }
        const up = ev => {
            window.removeEventListener('mousemove', move, true)
            window.removeEventListener('mouseup', up, true)
            const d = T.dragging; T.dragging = null
            d.b = at(ev)
            if (Math.abs(d.b[0] - d.a[0]) < 3 || Math.abs(d.b[1] - d.a[1]) < 3) { wake(); return }
            const [xa, ya] = toPic(V, ...d.a), [xb, yb] = toPic(V, ...d.b)
            const c = v => Math.max(-1, Math.min(1, v))
            T.area = { xa: c(Math.min(xa, xb)), ya: c(Math.min(ya, yb)), xb: c(Math.max(xa, xb)), yb: c(Math.max(ya, yb)) }
            T.areaReading = null
            wake(); readNow()
        }
        window.addEventListener('mousemove', move, true)
        window.addEventListener('mouseup', up, true)
    }, true)

    const placePin = async (V, p) => {
        // a click on a pin removes it
        const hitPin = T.pins.find(q => {
            const at = pinAt(q)
            if (!at) return false
            const s = toStage(V, ...at)
            return Math.hypot(s[0] - p[0], s[1] - p[1]) <= PIN_GRAB_PX
        })
        if (hitPin) { T.pins = T.pins.filter(q => q !== hitPin); wake(); return }
        const [x, y] = toPic(V, ...p)
        if (Math.abs(x) > 1 || Math.abs(y) > 1) return          // on the letterbox bars
        let world = null
        try {
            const res = await RT.pick?.(x, y)
            if (res?.hit && res.pos.every(Number.isFinite)) world = res.pos
        } catch { }
        T.pins.push({ n: nextPin++, x, y, world, reading: null })
        wake(); readNow()
    }

    //--------------------------------------------------------------------------------------------------------------
    // READING: a few times a second while something is placed
    //--------------------------------------------------------------------------------------------------------------
    let reading = false, lastArea = 0
    const unitNow = () => ((RT.get?.().measureMode | 0) === 1 ? 'lx' : 'cd/m²')
    const readNow = async () => {
        if (reading || (!T.pins.length && !T.area)) return
        reading = true
        try {
            const lux = unitNow() === 'lx'
            for (const p of T.pins) {
                const at = pinAt(p)
                const r = at ? await RT.measure?.(at[0], at[1]) : null
                p.reading = r ? { value: lux ? r.E : r.L, se: lux ? r.seE : r.se, rel: r.rel, unit: unitNow(), colour: r.colour } : null
            }
            /* A BIG RECTANGLE IS READ LESS OFTEN: its rows come back whole, 24 bytes a pixel, so a
               full-HD picture is 50 MB a read -- every 400 ms that would be a readback stream
               competing with the render. At most ~250 000 pixels' worth a second. */
            const px = T.area && (T.area.xb - T.area.xa) / 2 * (canvas.width || 1)
                                           * (T.area.yb - T.area.ya) / 2 * (canvas.height || 1)
            const due = T.area && (!T.areaReading || performance.now() - lastArea >= Math.max(READ_MS, px / 250))
            if (due) {
                lastArea = performance.now()
                T.areaReading = await RT.measureRegion?.(T.area.xa, T.area.ya, T.area.xb, T.area.yb)
            }
        } catch { }
        finally { reading = false }
        wake()
    }
    setInterval(readNow, READ_MS)

    //--------------------------------------------------------------------------------------------------------------
    // DRAWING: every frame while there is something to draw, and not at all otherwise
    //--------------------------------------------------------------------------------------------------------------
    let frame = 0
    /* what is placed shows on the analysis drawer's button, open or not: a pin stays on the picture either way */
    let placed = false
    const wake = () => {
        const now = T.pins.length > 0 || !!T.area
        if (now !== placed) {
            placed = now
            toolbar.analyse.mark('measure', now ? { icon: 'pin', tip: 'pinned readings' } : null)
            enable(clearBtn, now); enable(saveBtn, now)
        }
        if (!frame) frame = requestAnimationFrame(draw)
    }
    const label = (text, x, y, color, align = 'left') => {
        g.font = '12px ui-monospace, monospace'
        const w = g.measureText(text).width
        const lx = align === 'right' ? x - w - 6 : x
        g.fillStyle = INK.shade
        g.fillRect(lx - 3, y - 12, w + 6, 16)
        g.fillStyle = color
        g.fillText(text, lx, y)
    }
    const draw = () => {
        frame = 0
        const dpr = window.devicePixelRatio || 1
        if (el.width !== Math.round(cssW * dpr) || el.height !== Math.round(cssH * dpr)) {
            el.width = Math.round(cssW * dpr); el.height = Math.round(cssH * dpr)
        }
        g.setTransform(dpr, 0, 0, dpr, 0, 0)
        g.clearRect(0, 0, cssW, cssH)
        const V = view()
        const u = RT.get?.() || {}
        const busy = T.pins.length || T.area || T.dragging || (u.measureMode | 0) !== 0

        // the pins: a ring and the number beside it
        for (const p of T.pins) {
            const at = pinAt(p)
            if (!at) continue
            const [sx, sy] = toStage(V, ...at)
            g.strokeStyle = INK.pin; g.lineWidth = 2
            g.beginPath(); g.arc(sx, sy, 5, 0, 2 * Math.PI); g.stroke()
            g.beginPath(); g.moveTo(sx - 9, sy); g.lineTo(sx - 6, sy); g.moveTo(sx + 6, sy); g.lineTo(sx + 9, sy)
            g.moveTo(sx, sy - 9); g.lineTo(sx, sy - 6); g.moveTo(sx, sy + 6); g.lineTo(sx, sy + 9); g.stroke()
            const r = p.reading
            label(`${p.n}  ${r ? `${fmtValue(r.value)} ${r.unit} ${fmtRel(r.rel)}` : '…'}`, sx + 12, sy + 4, INK.pin)
            if (r?.colour) label(fmtChroma(r.colour), sx + 12, sy + 20, INK.pin)
        }

        // the area: its rectangle and what it averages to
        const box = T.dragging ? [T.dragging.a, T.dragging.b]
            : T.area ? [toStage(V, T.area.xa, T.area.yb), toStage(V, T.area.xb, T.area.ya)] : null
        if (box) {
            const [a, b] = box
            g.strokeStyle = INK.area; g.lineWidth = 1.5; g.setLineDash([5, 3])
            g.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))
            g.setLineDash([])
            const r = !T.dragging && T.areaReading
            if (r) {
                const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1])
                const c = r.colour
                label(`mean ${fmtValue(r.mean)} ${r.unit} ${fmtRel(r.rel)}${c ? `  ${fmtChroma(c)}` : ''}`, x, y - 39, INK.area)
                label(`min ${fmtValue(r.min)}  max ${fmtValue(r.max)}  U0 ${r.uniformity != null ? r.uniformity.toFixed(2) : '–'}`
                      + `  ${r.sampled} px`, x, y - 22, INK.area)
                if (c?.dUpVpMax != null) label(`\u0394u'v' max ${c.dUpVpMax.toFixed(4)}  rms ${c.dUpVpRms.toFixed(4)}`, x, y - 5, INK.area)
            }
        }

        // the false colour's legend: numbers on the strip the display pass draws along the bottom
        if ((u.measureMode | 0) !== 0) {
            const unit = (u.measureMode | 0) === 1 ? 'lx' : 'cd/m²'
            const ticks = legendTicks(+u.measureMin || 1, +u.measureMax || 1e5, u.measureBands | 0)
            const y = V.oy + V.dh * (1 - 0.025)                 // the strip is the picture's bottom 2.5%
            g.strokeStyle = INK.text; g.lineWidth = 1
            ticks.forEach((k, i) => {
                const x = V.ox + k.t * V.dw
                g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 5); g.stroke()
                const last = i === ticks.length - 1
                label(fmtValue(k.v) + (last ? ` ${unit}` : ''), last ? x : x + 2, y - 7, INK.text, last ? 'right' : 'left')
            })
        }
        if (busy) frame = requestAnimationFrame(draw)
    }
    wake()
    // the view changes from outside (the Measure group): look now and then whether to draw
    setInterval(() => { if (!frame && (RT.get?.().measureMode | 0) !== 0) wake() }, 500)

    /** What is placed, as numbers: the pins (number, world point or null, reading) and the area. */
    const readings = () => ({
        pins: T.pins.map(p => ({ n: p.n, world: p.world, ...(p.reading || {}) })),
        area: T.area && T.areaReading ? { ...T.area, ...T.areaReading } : null,
    })
    const csv = () => {
        // cie_x, cie_y: the reading's chromaticity; CCT and Duv where it is near white; du'v' the area's spread
        const rows = ['kind,n,x,y,z,value,std_error,unit,min,max,U0,pixels,cie_x,cie_y,CCT,Duv,dupvp_max,dupvp_rms']
        const col = c => c ? [c.x, c.y, c.cct ?? '', c.duv ?? '', c.dUpVpMax ?? '', c.dUpVpRms ?? ''] : ['', '', '', '', '', '']
        for (const p of T.pins) {
            const r = p.reading || {}
            rows.push(['pin', p.n, ...(p.world || ['', '', '']), r.value ?? '', r.se ?? '', r.unit ?? '', '', '', '', '', ...col(r.colour)].join(','))
        }
        const a = T.areaReading
        if (T.area && a) rows.push(['area', '', '', '', '', a.mean, a.se ?? '', a.unit, a.min, a.max, a.uniformity ?? '', a.sampled, ...col(a.colour)].join(','))
        return rows.join('\n')
    }
    return { get pins() { return T.pins }, get area() { return T.area }, readings, csv, setMode }
}
