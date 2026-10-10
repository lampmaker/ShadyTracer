//======================================================================================================================
// POINTS MODE -- a path's or a profile's points edited in the picture (asked 2026-10-02: "a tool to draw the paths and
// sections ... interactive, in the main window ... close to the current tools ... in local mode, with the rgb arrows,
// and that shows a line and xyz delta / dotted lines to previous point; some controls to add/delete points, some
// controls to set/change radius"; then "dragging a coordinate written as name should name the parameter. Within the
// min/max range"). The overlay's other mode (overlay.js), beside Transform, offered when the selected object has
// a path or a profile. Every number here is pointedit.js's, tested in node; this file draws and listens.
//
// WHAT IS DRAWN: the curve as the shader is given it (fillets as arcs), red with the reason when it is not sound; the
// points joined by a dotted line, each a dot with its number; for the selected point, THE TRANSFORM GIZMO (gizmodraw.js,
// the one the overlay draws for a node: the user, 2026-10-02, "use the same controls as for the transform, so include
// the plane control elements") -- an arrow per coordinate along the object's own axes (a profile's two in its plane;
// none along a coordinate that is locked), a square per pair of them (a profile's one, its plane), the centre ring for
// the point itself; its arcs, cubes and circle hidden -- and a diamond that sets its fillet; at a PATH's point, its
// cross-section where it is swept there, scaled and turned by the point's values, with a second gizmo on it (the user,
// 2026-10-02: "tube: scale, so change diameter per point / sweep: scale (x,y and both) and rotation"): a cube along its
// N for scale x and one along B for scale y, the circle for both, a quarter arc about the path for its twist -- a
// tube's the circle alone, its diameter (pointedit sectionHandles); and dotted legs to the point before it along the
// axes, twice as thick, with every other point's too while
// the legs switch on the view's toolbar is on (`viewPill`, beside the bounding boxes'). A profile's plane gets a faint
// grid. ITS NUMBERS
// -- by name, the difference to the point before, the length, the fillet, the grid step Ctrl snaps to, what is wrong
// -- are in the panel at the view's top right (readout.js), and Enter's typed entry opens there. Both sat beside the
// point once, on whichever side covered the fewest handles, and still covered one now and then (the user, 2026-10-02:
// "a more organized, semi transparent overlay in the upper right corner").
//
// WHAT A DRAG DOES: a dot or the centre ring moves the point in the plane facing the camera (a path's) or in its own
// plane (a profile's); an arrow moves one coordinate; a square two, the third exactly as it was; the diamond the
// fillet; a section's cube, circle and arc its scales and twist, as the Transform's do a node's (twice as far out,
// twice the scale; Ctrl on 0.1 and 15 degrees). Each step is judged against every path and profile of the node
// before anything is written (pointedit soundWith): a step that would break one is refused and said, and the point
// stays where it last was sound. Written through the model's setters, a parameter named by a coordinate the way its
// slider writes it, pushed with BUILDER.live, one undo step per drag. Escape puts it all back.
//
// LIVE WHILE EDITED: entering the mode tells the builder (BUILDER.editPoints), which compiles the path live whatever
// the document says, with room for 8 points more (codegen.js EDIT_SPARE: its chain is slots, each on or off), and back
// on leaving -- so a drag, a point put in or taken out, compiles nothing until the room runs out. Until that compile
// is in, or for a path too long to be live, a drag draws here and pushes once, on release.
//
// KEYS, only while a point is selected and nothing is being typed: Delete or Backspace takes it away, Insert or +
// puts one after it, Enter types its numbers, Escape lets it go. None of them is the camera's (lib/camera.js: W A S
// D, Space, Q and the arrows).
//
// THE PLANE VIEW (a profile's): the camera square to its plane, orthographic, framing the outline -- and back to where
// it was, on the button, on leaving the mode or on another selection.
//======================================================================================================================

import { projectPoint } from '../lib/pathtracer/core/genrays.js'
import { worldPerPixels, nearestOnLine, PLANES, ringAngle, angleStep, stretchFactor, scaleTo } from './gizmo.js'
import { paintGizmo, hitGizmo } from './gizmodraw.js'
import * as E from './pointedit.js'
import { iconPill, iconButton, lit as litIcon } from '../lib/pathtracer/icons.js'
import { signed, deg } from './readout.js'

const COLOR = { curve: '#ffcc33', bad: '#ff6b6b', poly: 'rgba(235,235,235,0.6)', dot: '#e6e6e6', sel: '#ffcc33', hot: '#ffffff',
                fillet: '#ff9f43', grid: 'rgba(200,215,230,0.12)', gridAxis: 'rgba(200,215,230,0.32)', text: '#ffffff', note: '#b9c3cc' }
const AXIS_COLOR = { x: '#ff5555', r: '#ff5555', y: '#55dd55', z: '#5599ff' }
// a path point's section: its outline, and its handles -- the section's own x and y lighter than the object's axes, whose
// arrows they can sit beside, and its twist in a colour no axis has
const SECTION = { outline: 'rgba(255,217,102,0.85)', x: '#ffa08a', y: '#a6e3a6', twist: '#c792ea' }
const DOT_PX = 4.5           // a point's dot
const DOT_GRAB = 8           // how near a dot counts as on it
const LEGS_KEY = 'raytracer.builder.edit.legs'   // every point's legs, or the selected one's: remembered
const DIAMOND_PX = 6         // the fillet's diamond
const DIAMOND_MIN_PX = 18    // ...kept this far off its corner while the fillet is small, so it is not under the dot
const MAX_LINES = 160        // a grid of more lines than this is drawn coarser
const SAY_MS = 4000          // how long a refusal stays in the readout

const sub = (a, b) => a.map((v, i) => v - b[i])
const add = (a, b) => a.map((v, i) => v + b[i])
const scl = (a, s) => a.map(v => v * s)
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0)
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l) }
const messageOf = e => e?.problems?.join('; ') ?? e?.message ?? String(e)

/**
 * @param stage, canvas, RT, BUILDER  as the overlay has them (overlay.js installSelectionOverlay)
 * @param boxes   the measured bounds, optional: how far an object reaches, so the plane view never starts inside it
 * @param button, lit  the overlay's bar button and its lit state, so the bar reads as one
 * @param readout the panel of numbers (readout.js installReadout): this mode's numbers and its typed entry go there
 * @param redraw  ask the overlay for a frame
 * @returns { bar, available(id), sync(id, on), paint(g, V), hit(x, y), cursor(h), setHover(h), begin(h, e, V, at),
 *            move(D, e), end(D), cancel(D), key(e), select(i), get selected, get editing, get planeView }
 */
export function createPointsMode({ stage, canvas, RT, BUILDER, boxes = null, button, lit, readout = null, redraw = () => { } }) {
    let active = null            // { scene, id, k }: what BUILDER.editPoints was last told
    const chosen = new Map()     // a node's target picked in the bar's list, by node id
    let sel = null               // the selected point's index
    let hover = null             // the handle under the pointer
    let planeCam = null          // { scene, camera }: the camera the plane view replaced
    let said = null              // { text, until }: the last refusal
    let hits = []                // the handles drawn this frame, in stage pixels
    let dotsAt = []              // each point's dot on screen this frame (null behind the camera)
    let entry = null             // the typed entry's box, while open
    let held = null              // the drag under way (begin's), for the numbers it changes
    let legsDrawn = []           // whose legs were drawn this frame, and how thick: [{ i, width }]
    const M = () => BUILDER.model

    //------------------------------------------------------------------------------------------------------------------
    // WHAT IS EDITED
    //------------------------------------------------------------------------------------------------------------------
    /** The selected node's target as it is now, or null: { doc, id, node, targets, t, P (plane), F (frame) }. */
    const ctxOf = id => {
        const doc = BUILDER.doc
        const found = id != null && doc ? M().find(doc, id)?.node : null
        // with its block's code and schema (model.js viewOf): which parameters its code reads, their ranges, its constants
        const node = found ? M().viewOf(doc, found) : null
        const targets = E.pointTargets(node)
        if (!targets.length) return null
        const t = targets.find(x => x.k === chosen.get(id)) ?? targets[0]
        return { doc, id, node, targets, t, P: E.planeOf(node, t), F: E.frameOf(doc, id) }
    }
    const ctx = () => active && active.scene === BUILDER.current ? ctxOf(active.id) : null
    const say = text => { said = { text, until: performance.now() + SAY_MS }; redraw() }

    //------------------------------------------------------------------------------------------------------------------
    // THE BAR: which of the node's paths and profiles, a point more or less, the plane view
    //------------------------------------------------------------------------------------------------------------------
    const bar = document.createElement('span')
    Object.assign(bar.style, { display: 'none', gap: '4px', alignItems: 'center' })
    const pick = document.createElement('select')
    Object.assign(pick.style, { font: '12px Arial, sans-serif', color: '#ccd4db', background: 'rgba(18,21,24,0.85)',
        border: '1px solid rgba(160,175,190,0.3)', borderRadius: '4px', padding: '2px 3px' })
    pick.title = 'Which of its paths and profiles to edit'
    pick.onchange = () => { if (active) { chosen.set(active.id, pick.value); sel = null; redraw() } }
    const addBtn = button('+ point', 'Put a point after the selected one (or after the last): halfway to the next. Key: Insert or +', () => addAfter())
    const delBtn = button('− point', 'Take the selected point away. Key: Delete or Backspace', () => removeSel())
    const planeBtn = button('⊡ plane', 'Look square at the profile\'s plane (orthographic, with its grid); again to go back', () => planeCam ? leavePlane() : enterPlane())
    // a point more or less are actions; the plane view a switch (lit while on), so a pill of its own (icons.js)
    const planePill = iconPill(planeBtn)
    bar.append(pick, addBtn, delBtn, planePill)
    /* EVERY POINT'S LEGS, a switch on the VIEW's toolbar beside the bounding boxes' (the host puts `viewPill` there;
       shown only while this mode is on): the user, 2026-10-02, "the dotted xyz lines from previous point is useful. I'd
       like to see if it's worth doing this for all points ... it will be a busy grid but maybe it gives a better feel
       for a 3d tube. Maybe hide it behind a toggle". Off by default; remembered. */
    let allLegs = false
    try { allLegs = localStorage.getItem(LEGS_KEY) === 'on' } catch { }
    const legsBtn = iconButton('legs', '', () => {
        allLegs = !allLegs
        try { localStorage.setItem(LEGS_KEY, allLegs ? 'on' : 'off') } catch { }
        showLegs(); redraw()
    })
    const showLegs = () => {
        litIcon(legsBtn, allLegs)
        legsBtn.title = allLegs ? 'Every point\'s steps from the one before, along the axes, dotted (click: the selected point\'s only)'
                                : 'The selected point\'s steps from the one before, along the axes, dotted (click: every point\'s)'
    }
    showLegs()
    const viewPill = iconPill(legsBtn)
    viewPill.style.display = 'none'

    /** Every frame, from the overlay: what is edited follows the selection, the mode and Edit -- one place that sees
     *  every way they change (a click, the tree, an undo, a scene switched), as the overlay's own drawing does. */
    function sync(id, on) {
        const c = on ? ctxOf(id) : null
        const next = c ? { scene: BUILDER.current, id, k: c.t.k } : null
        if (active?.scene !== next?.scene || active?.id !== next?.id || active?.k !== next?.k) {
            if (active?.id !== next?.id || active?.scene !== next?.scene) sel = null
            if (planeCam) leavePlane()
            closeEntry()
            active = next
            try { BUILDER.editPoints?.(next?.id ?? null, next?.k ?? null) } catch (e) { console.warn('[points] editPoints', e) }
        }
        const v = c ? 'inline-flex' : 'none'
        if (bar.style.display !== v) bar.style.display = v
        if (viewPill.style.display !== v) viewPill.style.display = v
        if (c) {
            const want = c.targets.map(t => `${t.k}|${t.kind}`).join(',')
            if (pick.dataset.list !== want) {
                pick.replaceChildren(...c.targets.map(t => Object.assign(document.createElement('option'), { value: t.k, textContent: `${t.k} (${t.kind})` })))
                pick.dataset.list = want
            }
            if (pick.value !== c.t.k) pick.value = c.t.k
            pick.style.display = c.targets.length > 1 ? '' : 'none'
            planePill.style.display = c.P ? '' : 'none'
            planeBtn.textContent = planeCam ? '↩ back' : '⊡ plane'
            lit(planeBtn, !!planeCam)
            const n = E.pointsOf(c.node, c.t).list?.length ?? 0
            delBtn.disabled = sel == null || n <= E.minPoints(c.t)
            delBtn.style.opacity = delBtn.disabled ? '0.45' : '1'
        }
        if (sel != null && c) {
            const n = E.pointsOf(c.node, c.t).list?.length ?? 0
            if (sel >= n) sel = n ? n - 1 : null              // an undo took points away
        }
        return c
    }

    //------------------------------------------------------------------------------------------------------------------
    // DRAWING
    //------------------------------------------------------------------------------------------------------------------
    /** The grid step at a world point, in the object's own units: what Ctrl snaps to. */
    const stepAt = (V, c, W) => {
        const depth = projectPoint(W, V.U, V.camtype).depth
        const wpp = worldPerPixels(1, depth, V.U.invProjection[5], V.dh, V.camtype)
        return E.gridStep(wpp / c.F.S, E.GRID_PX)
    }

    function paint(g, V) {
        const c = ctx()
        hits = []; dotsAt = []; legsDrawn = []
        if (!c) { readout?.show(null); return }
        const { t, P, F } = c
        const r = E.pointsOf(c.node, t)
        const k = t.kind === 'path' ? 3 : 2
        const finite = p => p && p.slice(0, k).every(Number.isFinite)
        const W = L => F.toWorld(L)
        const at = Wp => projectPoint(Wp, V.U, V.camtype).depth > V.near ? V.screen(Wp) : null
        const worldOf = p => W(E.localOf(t, P, p.slice(0, k)))
        const line = (pts, color, width, dash = []) => {
            g.beginPath()
            let prev = null
            for (const p of pts) {
                const q = at(p)
                if (q && prev) g.lineTo(q[0], q[1])
                else if (q) g.moveTo(q[0], q[1])
                prev = q
            }
            g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash)
            g.stroke()
            g.setLineDash([])
        }
        const anchor = finite(r.points[sel ?? 0]) ? worldOf(r.points[sel ?? 0]) : F.toWorld([0, 0, 0])
        const step = stepAt(V, c, anchor)

        // THE GRID, a profile's, under everything: the outline's extent with a margin, the origin's lines brighter
        if (P) {
            const pts = r.points.filter(finite)
            if (pts.length) {
                const us = pts.map(p => p[0]), vs = pts.map(p => p[1])
                let u0 = Math.min(...us, 0), u1 = Math.max(...us, 0), v0 = Math.min(...vs, 0), v1 = Math.max(...vs, 0)
                const m = Math.max(u1 - u0, v1 - v0) * 0.25 + step
                let s = step
                while ((u1 - u0 + 2 * m) / s + (v1 - v0 + 2 * m) / s > MAX_LINES) s *= 2
                u0 = Math.floor((u0 - m) / s) * s; u1 = Math.ceil((u1 + m) / s) * s
                v0 = Math.floor((v0 - m) / s) * s; v1 = Math.ceil((v1 + m) / s) * s
                const G = (u, v) => W(E.localOf(t, P, [u, v]))
                for (let i = 0, u = u0; u <= u1 + s / 2; u = u0 + ++i * s)
                    line([G(u, v0), G(u, v1)], Math.abs(u) < s / 2 ? COLOR.gridAxis : COLOR.grid, 1)
                for (let i = 0, v = v0; v <= v1 + s / 2; v = v0 + ++i * s)
                    line([G(u0, v), G(u1, v)], Math.abs(v) < s / 2 ? COLOR.gridAxis : COLOR.grid, 1)
            }
        }

        // THE CURVE, as the shader is given it; when it is not sound, the points joined in red
        const bad = r.problems.length > 0
        const poly = r.points.filter(finite).map(worldOf)
        if (t.kind === 'profile' && poly.length) poly.push(poly[0])
        line(poly, bad ? COLOR.bad : COLOR.poly, 1, [4, 4])
        if (!bad) for (const pl of E.curveOf(t, P, r.pieces)) line(pl.map(W), COLOR.curve, 2)

        /* THE LEGS: from the point before to a point, one coordinate at a time along the object's own axes, dotted in
           the axis's colour -- the selected point's always, twice as thick, and with the switch every point's (a
           path's from its second, a profile's first from its last, as the readout counts them) */
        const prevOf = i => t.kind === 'path' ? i - 1 : (i - 1 + r.points.length) % r.points.length
        const legs = (i, width) => {
            const q = r.points[prevOf(i)]
            if (!finite(r.points[i]) || !finite(q) || prevOf(i) === i) return
            const ro = E.readout(t, r.points, i)
            if (!ro.delta) return
            let L = sub(ro.coords, ro.delta)
            ro.delta.forEach((d, j) => {
                if (!d) return
                const next = L.map((v, n) => n === j ? v + d : v)
                line([worldOf(L), worldOf(next)], AXIS_COLOR[ro.names[j]], width, [3, 3])
                L = next
            })
            legsDrawn.push({ i, width })
        }
        if (allLegs) r.points.forEach((_, i) => { if (i !== sel && prevOf(i) >= 0) legs(i, 1) })
        if (sel != null && prevOf(sel) >= 0) legs(sel, 2)

        /* THE SELECTED POINT: the Transform gizmo at it (gizmodraw.js; the user: "use the same controls as for the
           transform, so include the plane control elements") -- an arrow per coordinate along the object's own axes (a
           profile's two in its plane), a square per pair of them, the centre ring for the point itself; not its arcs,
           cubes or circle -- a path point's section has a gizmo of its own for those, below. No arrow along a
           coordinate that is locked, and no square with one. Then the fillet's diamond. */
        const ro = sel != null && finite(r.points[sel]) ? E.readout(t, r.points, sel) : null
        if (ro) {
            const Pw = worldOf(r.points[sel])
            const depth = projectPoint(Pw, V.U, V.camtype).depth
            const H = E.handlesOf(F, t, P)
            const entries = r.list[sel] || []
            const free = j => E.entryKind(c.node, entries[j]) !== 'locked'
            const dirs = t.kind === 'path' ? H.axes.map(a => a.D) : [H.axes[0].D, H.axes[1].D, H.N]
            const third = ['x', 'y', 'z'].find(n => !ro.names.map(m => m === 'r' ? 'x' : m).includes(n))
            const colors = t.kind === 'path' ? ro.names.map(n => AXIS_COLOR[n]) : [...ro.names.map(n => AXIS_COLOR[n]), AXIS_COLOR[third]]
            const arrows = H.axes.filter(a => free(a.j)).map(a => a.j)
            const squares = Object.entries(PLANES).filter(([, [i, j]]) => i < k && j < k && free(i) && free(j)).map(([n]) => n)
            const drawn = paintGizmo(g, V, { origin: Pw, dirs }, { arrows, squares, arcs: false, cubes: [], circle: false,
                colors, hot: name => hover?.name === name })
            for (const h of drawn) {
                if (h.seg) hits.push({ ...h, kind: 'axis', i: sel, j: h.k, D: dirs[h.k] })
                else if (h.quad) hits.push({ ...h, kind: 'plane', i: sel, js: h.plane, N: norm(cross(dirs[h.plane[0]], dirs[h.plane[1]])) })
                else if (h.centre) hits.push({ ...h, kind: 'dot', i: sel, at: h.centre })
            }
            const corner = E.cornerOf(t, P, r.points, sel)
            const fi = E.filletIndex(t)
            if (corner && E.entryKind(c.node, entries[fi]) !== 'locked') {
                const minL = worldPerPixels(DIAMOND_MIN_PX, depth, V.U.invProjection[5], V.dh, V.camtype) / F.S
                const Dl = add(corner.V, scl(corner.b, Math.max(corner.r * corner.kf, minL)))
                const Dw = W(Dl), q = at(Dw)
                if (q) {
                    const name = 'fillet', hot = hover?.name === name
                    if (corner.r > 0) line([Pw, Dw], COLOR.fillet, 1, [2, 3])
                    g.beginPath()
                    g.moveTo(q[0], q[1] - DIAMOND_PX); g.lineTo(q[0] + DIAMOND_PX, q[1]); g.lineTo(q[0], q[1] + DIAMOND_PX); g.lineTo(q[0] - DIAMOND_PX, q[1])
                    g.closePath(); g.fillStyle = hot ? COLOR.hot : COLOR.fillet; g.fill()
                    hits.push({ kind: 'fillet', name, i: sel, at: q, W: Dw })
                }
            }
            /* A PATH POINT'S SECTION: its outline as swept there, and the second gizmo on it -- each handle left out where
               the entry it writes is an expression (a scale x dragged alone writes scale y too when that follows it) */
            const sec = t.kind === 'path' && !bad ? E.sectionAt(r.pieces, r.points.length, sel) : null
            if (sec) {
                for (const pl of E.sectionOutline(c.node, t.k, r.pieces, r.points, sel) ?? []) line(pl.map(W), SECTION.outline, 1.5)
                const ent = r.list[sel] || [], follows = ent.length <= 5
                const kinds = E.sectionHandles(c.node, t.k).filter(h => h === 'sy' ? free(5) : h === 'twist' ? free(6)
                    : h === 'both' ? free(4) && (follows || free(5)) : free(4))
                const Os = W(sec.O), dirsS = [F.axis(sec.N), F.axis(sec.B), F.axis(sec.T)]
                const f = n => held?.h.name === n && held.f ? held.f : 1
                const cubes = [...(kinds.includes('sx') ? [{ name: 'vsx', k: 0, dir: dirsS[0], f: f('vsx'), stem: true }] : []),
                               ...(kinds.includes('sy') ? [{ name: 'vsy', k: 1, dir: dirsS[1], f: f('vsy'), stem: true }] : [])]
                const drawnS = paintGizmo(g, V, { origin: Os, dirs: dirsS }, { arrows: [], squares: [], centre: false, cubes,
                    arcs: kinds.includes('twist') ? [{ name: 'twist', k: 2 }] : [], circle: kinds.includes('both') || kinds.includes('diameter'),
                    colors: [SECTION.x, SECTION.y, SECTION.twist], hot: name => hover?.name === name, held: held?.h.name ?? null })
                const how = { vsx: 'sx', vsy: 'sy', twist: 'twist', scale: kinds.includes('diameter') ? 'diameter' : 'both' }
                for (const h of drawnS) hits.push({ ...h, kind: 'value', how: how[h.name], i: sel, O: Os, dirs: dirsS })
            }
        }

        // THE DOTS, numbered as the text box numbers them
        g.font = '10px Arial, sans-serif'
        r.points.forEach((p, i) => {
            if (!finite(p)) { dotsAt.push(null); return }
            const q = at(worldOf(p))
            dotsAt.push(q)
            if (!q) return
            const name = `dot:${i}`, hot = hover?.name === name
            const locked = (r.list[i] || []).slice(0, k).every(e => E.entryKind(c.node, e) === 'locked')
            g.beginPath(); g.arc(q[0], q[1], i === sel || hot ? DOT_PX + 1.5 : DOT_PX, 0, Math.PI * 2)
            g.fillStyle = hot ? COLOR.hot : i === sel ? COLOR.sel : COLOR.dot
            g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 1.5
            if (locked) { g.strokeStyle = g.fillStyle; g.stroke() } else { g.fill(); g.stroke() }
            if (r.points.length <= 40 || i === sel) {
                g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.strokeText(String(i + 1), q[0] + 7, q[1] - 7)
                g.fillStyle = COLOR.note; g.fillText(String(i + 1), q[0] + 7, q[1] - 7)
            }
            hits.push({ kind: 'dot', name, i, at: q })
        })

        /* THE NUMBERS, in the panel at the view's top right (readout.js): the selected point's by name, lit while a drag
           changes them; the step to the point before; its fillet; a coordinate written as an expression, as written;
           the grid; and what is wrong */
        const unit = c.doc.unit ?? 'm', rows = [], notes = []
        if (ro) {
            const ent = r.list[sel] || [], fi = E.filletIndex(t)
            const moving = held?.i === sel && held.h.kind !== 'fillet' ? held.start : null
            rows.push({ label: `point ${sel + 1}`, unit, cells: ro.coords.map((v, j) =>
                ({ axis: ro.names[j], text: E.fmt(v), ...(moving && v !== moving[j] ? { hot: true } : {}) })) })
            if (ro.delta) {
                rows.push({ label: '\u0394', unit, cells: ro.delta.map((v, j) => ({ axis: ro.names[j], text: signed(v) })) })
                rows.push({ label: '|\u0394|', unit, cells: [{ text: E.fmt(ro.length) }, ...(ro.angle != null ? [{ text: `${ro.angle.toFixed(1)}\u00b0` }] : [])] })
            }
            const fe = ent[fi]
            if (ro.fillet || fe !== undefined) rows.push({ label: 'fillet', unit, cells: [{ text: E.fmt(ro.fillet),
                ...(held?.i === sel && held.h.kind === 'fillet' && ro.fillet !== held.f0 ? { hot: true } : {}) }] })
            // a path point's section: a tube's scale (its diameter's), a sweep's scale x and y and twist
            if (ro.values) {
                const v = ro.values, was = held?.i === sel && held.h.kind === 'value' ? held.v0 : null
                const cell = (j, axis) => ({ ...(axis ? { axis } : {}), text: j === 2 ? deg(v[j]) : v[j].toFixed(3), ...(was && v[j] !== was[j] ? { hot: true } : {}) })
                if (E.sectionHandles(c.node, t.k).includes('diameter')) rows.push({ label: 'scale', unit: '\u00d7', cells: [cell(0)] })
                else rows.push({ label: 'scale', unit: '\u00d7', cells: [cell(0, 'x'), cell(1, 'y')] }, { label: 'twist', unit: '\u00b0', cells: [cell(2)] })
            }
            ent.forEach((e, j) => {
                if (typeof e !== 'string') return
                const locked = E.entryKind(c.node, e) === 'locked'
                const what = j === fi ? 'fillet' : j > fi ? E.VALUE_NAMES[j - fi - 1] : ro.names[j]
                notes.push({ text: `${what} = ${e.trim()}${locked ? ' (an expression: typed, not dragged)' : ''}`, tone: 'note' })
            })
            notes.push({ text: `grid ${step} -- Ctrl snaps to it${ro.values ? '; a scale to 0.1, a twist to 15\u00b0' : ''}`, tone: 'note' })
        } else notes.push({ text: `${r.points.length} points -- click one to move it; + puts one after the last`, tone: 'note' })
        if (bad) notes.push({ text: r.problems[0], tone: 'bad' })
        if (said && performance.now() < said.until) notes.push({ text: said.text, tone: 'bad' })
        readout?.show({ title: c.node.label || c.id, sub: `${t.k} (${t.kind})`, unit, rows, notes })
    }

    //------------------------------------------------------------------------------------------------------------------
    // THE MOUSE
    //------------------------------------------------------------------------------------------------------------------
    /** The handle under a stage point, in the gizmo's order (gizmodraw hitGizmo): the selected point's centre ring; a
     *  section's cube, and the fillet's diamond, small targets that win over an arrow's shaft; its arrows and the
     *  section's arc; the nearest dot, which a square must not swallow -- nor the section's circle, a ring 290 pixels
     *  across that took every click on a dot under it (points.check, 2026-10-02); then that circle; its squares. */
    function hit(x, y) {
        const far = h => Math.hypot(x - h.at[0], y - h.at[1])
        const h = hitGizmo(hits.filter(q => !q.circle), x, y, {
            small: () => hits.find(q => q.kind === 'fillet' && far(q) <= DIAMOND_PX + 3) ?? null,
            between: () => {
                let best = null, bd = DOT_GRAB
                for (const q of hits) if (q.kind === 'dot' && !q.centre) { const d = far(q); if (d <= bd) { best = q; bd = d } }
                return best
            },
        })
        return h && !h.quad ? h : hitGizmo(hits.filter(q => q.circle), x, y) ?? h
    }
    const cursor = h => !h ? '' : h.kind === 'fillet' ? 'ew-resize' : h.kind === 'value' ? (h.how === 'twist' ? 'grab' : 'nwse-resize') : 'move'

    /** Make a value right in the document: a parameter named, as a slider makes it, then the list through the model's
     *  setter, which refuses what is not sound -- and then nothing changed. */
    function apply(c, list, params) {
        const node = M().find(BUILDER.doc, c.id)?.node
        if (!node) return false
        const before = {}
        for (const [n, v] of Object.entries(params)) { before[n] = node.params[n]; node.params[n] = v }
        try {
            if (list) (c.t.kind === 'path' ? M().setPath : M().setProfile)(BUILDER.doc, c.id, c.t.k, list)
            return true
        } catch (err) {
            for (const [n, v] of Object.entries(before)) node.params[n] = v
            say(messageOf(err))
            return false
        }
    }
    /** Whether a push now writes uniforms rather than compiling: the path is live in the scene shown (forced or the
     *  document's), and so is every one of the node's that reads a name moved. */
    const pushesLive = (c, names) => {
        const pp = RT.scene?.pointParams
        if (!pp || RT.scene?.id !== 'built') return true
        const mine = pp.filter(p => p.id === c.id && (p.k === c.t.k || names.some(n => p.deps.includes(n))))
        return mine.length > 0 && mine.every(p => p.live)
    }
    const push = (c, names) => {
        BUILDER.live(c.id, c.t.k)
        for (const n of names) BUILDER.live(c.id, n)
    }
    /** A list written whole -- a point put in or taken away: judged, written, pushed, its own undo step. */
    function writeList(c, list) {
        const judged = E.soundWith(c.node, {}, c.t.k, list)
        if (!judged.ok) { say(judged.problems[0]); return false }
        if (!apply(c, list, {})) return false
        push(c, [])
        BUILDER.commit?.(null)
        redraw()
        return true
    }

    /** A press on a handle: the drag, or null when there is nothing it can move. `px` an event's stage pixels (the
     *  circle scales by how much farther from the section's centre on screen the pointer is, as Transform's does). */
    function begin(h, e, V, at, px = null) {
        const c = ctx()
        if (!c) return null
        const r = E.pointsOf(c.node, c.t), k = c.t.kind === 'path' ? 3 : 2
        sel = h.i
        closeEntry()
        const start = r.points[h.i]?.slice(0, k)
        if (!start || !start.every(Number.isFinite)) { say(r.problems[0] ?? `point ${h.i + 1} does not read`); return null }
        const params0 = structuredClone(c.node.params)
        const D = { h, c, i: h.i, start, list0: structuredClone(r.list), params0, node0: { ...c.node, params: params0 },
                    r0: at(e), at, names: new Set(), changed: false, live: true }
        D.P = c.F.toWorld(E.localOf(c.t, c.P, start))
        D.step = stepAt(V, c, D.P)
        if (h.kind === 'dot') {
            // a profile's in its own plane -- unless it is seen edge on, when the plane facing the camera, cut to it
            const view = V.towards(D.P), N = E.handlesOf(c.F, c.t, c.P).N
            D.how = { N: N && Math.abs(dot(N, view)) > 0.08 ? N : view }
        } else if (h.kind === 'axis') D.how = { axis: h.D, j: h.j }
        // a square: in its plane through the point, its two coordinates moving and the third exactly as it was
        else if (h.kind === 'plane') D.how = { N: h.N, js: h.js }
        /* A SECTION'S HANDLE, as Transform's are dragged (overlay.js): a cube by how much farther out along its line
           (gizmo.stretchFactor), the circle by how much farther from the centre on screen (scaleTo), the arc by the
           angle turned, summed step by step so it can go round more than once -- from the values at the press */
        else if (h.kind === 'value') {
            Object.assign(D, { v0: E.valuesOf(r.points[h.i]), entries: r.list[h.i] || [], S: { origin: h.O, dirs: h.dirs } })
            if (h.how === 'twist') {
                const a0 = ringAngle(D.S, 2, D.r0)
                if (a0 == null) return null
                Object.assign(D, { prev: a0, total: 0 })
            } else if (h.how === 'sx' || h.how === 'sy') {
                D.axis = h.how === 'sx' ? 0 : 1                  // (D.c is the context)
                D.s0 = nearestOnLine(h.O, h.dirs[D.axis], D.r0)
                if (!(D.s0 > 0)) return null
                D.f = 1
            } else {
                if (!px) return null
                D.px = px; D.Os = V.screen(h.O)
                D.d0 = Math.hypot(px(e)[0] - D.Os[0], px(e)[1] - D.Os[1])
            }
        }
        else {
            D.corner = E.cornerOf(c.t, c.P, r.points, h.i)
            if (!D.corner) return null
            D.Bw = c.F.axis(D.corner.b); D.Dw = h.W
            const s0 = nearestOnLine(D.Dw, D.Bw, D.r0)
            if (s0 == null) return null
            D.s0 = s0 / c.F.S; D.f0 = D.corner.r
        }
        held = D
        redraw()
        return D
    }
    function move(D, e) {
        const ray = D.at(e)
        let values
        if (D.h.kind === 'fillet') {
            const s = nearestOnLine(D.Dw, D.Bw, ray)
            if (s == null) return
            let f = E.filletDrag(D.corner, D.f0, D.s0, s / D.c.F.S)
            if (e.ctrlKey) f = Math.min(Math.round(f / D.step) * D.step, D.corner.rMax)
            values = { [E.filletIndex(D.c.t)]: f }
        } else if (D.h.kind === 'value') {
            let x
            if (D.h.how === 'twist') {
                const a = ringAngle(D.S, 2, ray)
                if (a == null) return
                D.total += angleStep(a, D.prev); D.prev = a
                x = D.total * 180 / Math.PI
            } else if (D.axis != null) {
                const s = nearestOnLine(D.h.O, D.h.dirs[D.axis], ray)
                if (s == null) return
                x = D.f = stretchFactor(D.s0, s)
            } else {
                const [px, py] = D.px(e)
                x = scaleTo(1, D.d0, Math.hypot(px - D.Os[0], py - D.Os[1]))
            }
            values = E.valueDrag(D.entries, D.v0, D.h.how, x, e.ctrlKey)
        } else {
            let got = E.dragPoint(D.c.F, D.c.t, D.c.P, D.P, D.start, D.how, D.r0, ray)
            if (!got) return
            if (e.ctrlKey) got = E.snapCoords(got, D.start, D.step)
            values = {}
            got.forEach((v, j) => { if (v !== D.start[j]) values[j] = v })
        }
        const w = E.writePoint(D.node0, D.c.t, D.list0, D.i, values)
        // a name moved earlier in this drag and not now goes back to where it started
        const params = { ...Object.fromEntries([...D.names].map(n => [n, D.params0[n]])), ...w.params }
        const judged = E.soundWith(D.node0, params, D.c.t.k, w.list)
        if (!judged.ok) { say(judged.problems[0]); return }
        if (!apply(D.c, w.list, params)) return
        Object.keys(w.params).forEach(n => D.names.add(n))
        D.changed = true
        if (pushesLive(D.c, Object.keys(params))) push(D.c, Object.keys(params))
        else D.live = false                                  // it would compile: once, on release
        BUILDER.commit?.(`${D.c.id}.${D.c.t.k}`)
        said = null
    }
    function end(D) {
        held = null
        if (!D?.changed) return
        if (!D.live) push(D.c, [...D.names])
        BUILDER.commit?.(`${D.c.id}.${D.c.t.k}`)
        redraw()
    }
    function cancel(D) {
        held = null
        if (!D?.changed) return
        const params = Object.fromEntries([...D.names].map(n => [n, D.params0[n]]))
        apply(D.c, D.list0, params)
        push(D.c, Object.keys(params))
        BUILDER.commit?.(`${D.c.id}.${D.c.t.k}`)
        redraw()
    }

    //------------------------------------------------------------------------------------------------------------------
    // A POINT MORE OR LESS, AND THE KEYS
    //------------------------------------------------------------------------------------------------------------------
    function addAfter() {
        const c = ctx()
        if (!c) return
        const r = E.pointsOf(c.node, c.t), k = c.t.kind === 'path' ? 3 : 2
        const i = sel ?? r.points.length - 1
        const near = [i, (i + 1) % r.points.length, i - 1].filter(j => j >= 0 && j < r.points.length)
        if (!near.every(j => r.points[j].slice(0, k).every(Number.isFinite))) { say(r.problems[0] ?? 'the points do not read'); return }
        if (writeList(c, E.insertPoint(c.t, r.list, r.points, i))) sel = i + 1
    }
    function removeSel() {
        const c = ctx()
        if (!c || sel == null) return
        const list = E.removePoint(c.t, E.pointsOf(c.node, c.t).list, sel)
        if (!list) { say(`a ${c.t.kind} keeps at least ${E.minPoints(c.t)} points`); return }
        if (writeList(c, list)) sel = list.length ? Math.min(sel, list.length - 1) : null
    }
    /** A key, from the overlay (not while typing, not during a drag): whether it was this mode's. */
    function key(e) {
        if (!ctx() || e.ctrlKey || e.metaKey || e.altKey) return false
        if (sel != null && (e.key === 'Delete' || e.key === 'Backspace')) { removeSel(); return true }
        if (e.key === 'Insert' || e.key === '+') { addAfter(); return true }
        if (sel != null && e.key === 'Enter') { openEntry(); return true }
        if (sel != null && e.key === 'Escape') { sel = null; closeEntry(); redraw(); return true }
        return false
    }

    //------------------------------------------------------------------------------------------------------------------
    // TYPED ENTRY: the selected point's entries AS WRITTEN -- `w/2` stays `w/2` -- and what is typed goes through the
    // model's setter, which says what it refuses
    //------------------------------------------------------------------------------------------------------------------
    function closeEntry() { if (entry) { entry = null; readout?.form(null) } }
    function openEntry() {
        const c = ctx()
        if (!c || sel == null) return
        closeEntry()
        const i = sel, list = E.pointsOf(c.node, c.t).list, pt = list[i] || []
        const names = E.coordNames(c.t), fi = E.filletIndex(c.t)
        const end = c.t.kind === 'path' && (i === 0 || i === list.length - 1)
        const box = entry = document.createElement('div')
        box.className = 'points-entry'
        Object.assign(box.style, { display: 'grid', gridTemplateColumns: 'auto 9em', gap: '3px 6px', alignItems: 'center' })
        const head = document.createElement('div')
        head.textContent = `point ${i + 1}: a number or an expression of the parameters`
        head.style.gridColumn = '1 / 3'
        box.append(head)
        // a path's point: its section's scale x, scale y and twist too -- an empty box reads as its default (the hint)
        const values = c.t.kind === 'path' ? E.VALUE_NAMES.map((n, m) => [n, fi + 1 + m, ['1', 'scale x', '0'][m]]) : []
        const fields = [...names.map((n, j) => [n, j]), ...(end ? [] : [['fillet', fi, '0']]), ...values].map(([label, j, hint]) => {
            const l = document.createElement('label'); l.textContent = label
            const inp = document.createElement('input')
            inp.value = pt[j] === undefined ? '' : String(pt[j])
            if (hint) inp.placeholder = hint
            inp.dataset.entry = String(j)
            Object.assign(inp.style, { font: '12px monospace', color: '#e6e6e6', background: '#15181b', border: '1px solid #3a4148', borderRadius: '3px', padding: '2px 4px' })
            box.append(l, inp)
            return [j, inp]
        })
        const msg = document.createElement('div')
        Object.assign(msg.style, { gridColumn: '1 / 3', color: COLOR.bad, maxWidth: '22em' })
        const hint = document.createElement('div')
        hint.textContent = 'Enter applies, Escape closes'
        Object.assign(hint.style, { gridColumn: '1 / 3', color: '#8a949d', fontSize: '11px' })
        box.append(msg, hint)
        const applyTyped = () => {
            const now = ctx()
            if (!now || now.id !== c.id || now.t.k !== c.t.k) return closeEntry()
            const vals = Object.fromEntries(fields.map(([j, inp]) => [j, E.parseEntry(inp.value)]))
            const missing = names.find((n, j) => vals[j] == null)
            if (missing) { msg.textContent = `${missing}: a number or an expression`; return }
            const next = E.pointFrom(c.t, Array.from({ length: c.t.kind === 'path' ? fi + 4 : fi + 1 }, (_, j) => vals[j] ?? null))
            const cur = E.pointsOf(now.node, now.t).list.map(p => [...p])
            cur[i] = next
            try { (now.t.kind === 'path' ? M().setPath : M().setProfile)(BUILDER.doc, now.id, now.t.k, cur) }
            catch (err) { msg.textContent = messageOf(err); return }
            push(now, [])
            BUILDER.commit?.(null)
            closeEntry()
            redraw()
        }
        for (const [, inp] of fields) inp.addEventListener('keydown', ev => {
            if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); applyTyped() }
            else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeEntry() }
        })
        // in the panel at the top right, in place of the numbers it types (readout.js); without one, nowhere to type
        if (!readout) { entry = null; return }
        readout.form(box)
        fields[0][1].focus(); fields[0][1].select()
    }

    //------------------------------------------------------------------------------------------------------------------
    // THE PLANE VIEW
    //------------------------------------------------------------------------------------------------------------------
    const setCamera = cam => {
        if (RT.applySettings) RT.applySettings({ camera: structuredClone(cam) })
        else if (RT.cam) { if (cam.mode) RT.cam.set({ mode: cam.mode }); RT.cam.set(cam) }
    }
    function enterPlane() {
        const c = ctx()
        if (!c?.P) return
        const pts = E.pointsOf(c.node, c.t).points.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]))
        if (!pts.length) return
        const us = pts.map(p => p[0]), vs = pts.map(p => p[1])
        const lo = [Math.min(...us), Math.min(...vs)], hi = [Math.max(...us), Math.max(...vs)]
        const centre = c.F.toWorld(E.localOf(c.t, c.P, [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2]))
        const half = [(hi[0] - lo[0]) / 2 * c.F.S, (hi[1] - lo[1]) / 2 * c.F.S]
        const C = boxes?.corners?.(c.doc, c.id)
        const clear = C ? Math.max(...C.map(p => Math.hypot(...sub(p, centre)))) : 0
        const view = E.planeView(c.F.axis(c.P.W), c.F.axis(c.P.U), centre, half, clear, (canvas.width || 1) / (canvas.height || 1))
        const was = RT.settings?.().camera ?? RT.cam?.get?.()
        if (!was) return
        planeCam = { scene: BUILDER.current, camera: structuredClone(was) }
        setCamera({ mode: 'orbit', ...view })
        redraw()
    }
    function leavePlane() {
        const p = planeCam
        planeCam = null
        // the camera of the scene it was taken in: not put on another scene switched to meanwhile
        if (p && p.scene === BUILDER.current) setCamera(p.camera)
        redraw()
    }

    return {
        bar,
        /** Whether node `id` has anything to edit here. */
        available: id => !!ctxOf(id),
        sync, paint, hit, cursor, begin, move, end, cancel, key,
        setHover(h) { hover = h },
        /** Select point i (null: none). */
        select(i) { sel = i; closeEntry(); redraw() },
        get selected() { return sel },
        /** What is being edited: { id, k } or null. */
        get editing() { return active ? { id: active.id, k: active.k } : null },
        get planeView() { return !!planeCam },
        /** The handles drawn last frame, in stage pixels, and the refusal being said: for the checks. */
        get handles() { return hits.map(({ kind, name, i, j, js, at, seg, quad, how, cube, circle, segs }) => ({ kind, name, i, j, js, at, seg, quad, how, cube, circle, segs })) },
        /** Whose legs were drawn last frame, and how thick ([{ i, width }]); and the switch for every point's. */
        get legs() { return legsDrawn.map(l => ({ ...l })) },
        get allLegs() { return allLegs },
        /** The legs switch, in a pill: the host puts it on the view's toolbar, beside the bounding boxes'. */
        viewPill,
        get said() { return said && performance.now() < said.until ? said.text : null },
        /** What this mode last put in the panel (readout.js's model), or null. */
        get readout() { return readout?.model ?? null },
    }
}
