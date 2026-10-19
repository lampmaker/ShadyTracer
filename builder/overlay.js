//======================================================================================================================
// OVERLAY -- the selected node's name and its handles, drawn over the picture.
//
// Select a row in the tree and its name is drawn at its origin, with handles there (gizmo.js):
// TRANSFORM, one gizmo for moving, turning and sizing, every handle at once --
//   an ARROW per axis, a SQUARE per plane, and a CENTRE ring that moves in the plane facing the camera;
//   a QUARTER ARC between each pair of arrows, coloured by the axis it turns about, that rotates;
//   a CUBE on each of the shape's own axes, part way along, that STRETCHES it along that axis by its own
//   sizes (stretch.js: a box's size.x, a cylinder's radius or height) -- only on the axes its shape has
//   such sizes for, so a sphere, a group or code of the user's own has none;
//   and a dashed CIRCLE around it all that scales it whole: drag out to grow, in to shrink (uniform).
// One gizmo since the user asked for move and scale in one control (2026-10-02): Move and Scale were
// modes of their own because a scale circle drawn over the arrows overlapped them at every angle. The
// circle is now outside the arrows' heads, and the cubes sit on the shafts between the squares and the
// heads, so nothing overlaps; where two handles could both be hit the hit test's order decides (hitTest).
// The handles were made larger at the same time, to be easier to pick. The gizmo is drawn and hit-tested by
// gizmodraw.js, which the Points mode shares (its arrows, squares and centre at a point). (A Rotate mode of full rings
// came first; the arcs do the same turn without a mode switch, and it was removed once they were
// confirmed.)
// THE AXES are the parent's (the world's, at the top level) or, with the "local" button, the node's
// own, turned with it -- so the handles turn as it does (gizmo.js says what each costs). Remembered.
// The CUBES are always on the node's own axes, whichever: a size is the shape's own, and a box's
// size.x runs along its own x however it is turned. With "local" off and the node turned they are
// apart from the arrows, on a thin stem each.
// Dragging writes the node's transform, which is a uniform, or a stretched shape's sizes, live numbers
// (stretch.js takes no other), so the picture follows without a compile. Ctrl while dragging snaps: a move and a
// size to the grid's step at the node, the one the Points mode snaps to (pointedit gridStep, GRID_PX apart on screen;
// a fixed 0.1 until the user asked for "the snap mode in the regular transform as well", 2026-10-02), a turn to 15
// degrees, a scale to 0.1. The panel at the top right says the step.
//
// CLICKING SELECTS. A press and release on the picture that did not move -- which the camera also
// saw, and did nothing with, since it only acts on movement -- asks the renderer what is under it
// (RT.pick, core/pick.js). The pick names the DEEPEST node there; which level of its path is
// selected -- the top-level group by default, deeper with shift or a double-click, and back up with
// Esc -- is selection.js's rule. The choice goes out through `onPick`, which the host points at the
// tree so the row, the panel and this overlay all follow as if the row were clicked. A click on
// nothing (the sky) selects nothing. A press that turns into a drag is the camera's; a
// press on a handle is the handle's. The first pick after a scene change compiles the pick kernel,
// so it can take as long as a scene switch; the cursor says so, and a later click wins over one
// still waiting.
//
// NO BOX. A bounding box was drawn around the selection once, measured from the object's type; every
// object is code now and has none (bounds.js). The one exception is an export box (exportbox.js),
// whose outline is drawn dashed when it is selected: it is known exactly and invisible in the picture.
//
// AND ALL OF IT CAN BE SWITCHED OFF with the Edit button at the bottom left: then nothing is drawn,
// a click in the picture is only the camera's, and Esc is left alone -- the picture is only a
// picture again. The tree and the panel are not affected. Remembered per browser, in localStorage
// (a convenience: a browser that refuses storage just starts with editing on).
//
// A DRAG LOWERS NOTHING OF ITS OWN. It once dropped the picture to half scale and the photons to a tenth while
// a handle was held, behind a "fast drag" switch; the user had it removed (2026-10-02). The renderer's
// toolbar's ⚡ is the way to a lighter picture: since 0.59.0 fast while moving, which a drag holds (hold(), below).
//
// A 2D CANVAS OVER THE RENDER CANVAS, NOT A PASS IN THE RENDERER. A few lines do not need the GPU,
// and drawing them here changes no kernel, no uniform and no compile. It sits above the picture and
// below the renderer's floating menu (z-index 10).
//
// PROJECTED THE WAY THE KERNEL TRACES: core/genrays.js projectPoint inverts the ray construction
// itself, and rayThrough is that construction for the mouse, so a handle that sits on its object at
// one camera angle sits on it at every other, and a grabbed handle stays under the pointer. What is
// behind the camera is not drawn.
//
// LETTERBOXING. The render canvas is `object-fit: contain` (lib/utils.js CC): with a fixed render
// size its picture is centred in the panel with bars, not stretched to it. The overlay covers the
// panel, so it maps the kernel's [-1, 1] onto the picture's rectangle inside it, not the panel's --
// both ways, for drawing and for the mouse.
//
// THE CAMERA HAS TO LOSE THE DRAG, AND IT LISTENS FOR mousedown. lib/camera.js attaches `mousedown`
// to the render canvas itself, not pointer events, so stopping a pointerdown would leave the camera
// orbiting under every handle drag. This takes `mousedown` in the CAPTURE phase on the stage, which
// runs before the canvas sees it, and stops it only when it lands on a handle -- a press anywhere
// else reaches the camera exactly as before. The overlay's own canvas takes no pointer events at all,
// so hovering, the menu and the camera are untouched by it.
//
// AN EDIT LIKE A SLIDER'S. A drag writes the document's position and calls BUILDER.live, and commits
// under the same key the panel's transform uses, so a drag is one undo step, as dragging a slider is.
// The panel's numbers follow through the renderer's refresh, as they do after any RT.set. Escape
// during a drag puts the node back.
//
// THE NUMBERS: a panel at the view's top right (readout.js) shows the selection's position, rotation, scale, lengths
// and measured bounds, and while a handle is held what the drag has done, the numbers it changes lit. The Points mode
// writes its own numbers there too.
//
// LOCKED (model.js lockOf; the user, 2026-10-02) OR BOUND (heldOf, version 18: a value from its component's parameters, which
// a drag would only fight): a node whose position is locked has no arrows, squares, centre or arcs;
// one whose parameters are locked no stretch cubes and no circle, and its Points mode is shown but cannot be chosen --
// its points are parameters. What is not drawn cannot be grabbed: a press there is the camera's, or a click that picks.
// A padlock beside the name says why the handles are missing, and the panel at the top right says what is locked.
//
// POINTS, the other mode (pointsmode.js), offered when the selected object has a path or a profile: its points
// edited in the picture -- dots, this gizmo's arrows, squares and centre at the selected point (gizmodraw.js), a
// fillet's diamond, typed numbers, a view square to a profile's plane, and its legs switch on the view's toolbar
// (`points.viewPill`, which the host places). This file hands it the drawing, the mouse and the keys while it is the mode; a click there
// that misses every handle lets the point go rather than picking another object.
//
// REDRAWN EVERY FRAME WHILE SOMETHING IS SELECTED, and not at all otherwise. The handles move with the
// camera, with a transform dragged in the panel and with an undo, and following each of those
// separately would be three hooks that the next way of changing a transform forgets; one frame of
// a few lines costs nothing next to the trace. The panel's size is cached from a ResizeObserver
// rather than read per frame, which would force a layout per frame.
//======================================================================================================================

import { projectPoint, rayThrough, clipToView } from '../lib/pathtracer/core/genrays.js'
import { boxCorners, BOX_EDGES } from './exportbox.js'
import { selectionGeometry } from './bounds.js'
import { clickTarget, parentOf, pathTo } from './selection.js'
import { moveFrame, dragTo, worldPerPixels, AXES, nearestOnLine, stretchFactor,
         rotateTo, ringAngle, angleStep, scaleTo } from './gizmo.js'
import { paintGizmo, hitGizmo, RINGS, CUBES } from './gizmodraw.js'
import { stretchOf, startOf, stretched } from './stretch.js'
import { gridStep, GRID_PX, tidy } from './pointedit.js'
import { installReadout, transformReadout } from './readout.js'
import { createPointsMode } from './pointsmode.js'
import { find, heldOf, viewOf } from './model.js'
import { iconPill } from '../lib/pathtracer/icons.js'

const COLOR = { box: '#ffcc33', text: '#ffffff',
                // the measured boxes (boxes.js): the selection's bright, the rest faint, groups apart from objects
                selBox: '#7fe0ff', objBox: 'rgba(127,224,255,0.38)', groupBox: 'rgba(230,185,140,0.45)' }
const STORE_KEY = 'raytracer.builder.edit'
/** The cursor over a handle: an arc turns, a cube or the circle sizes, the rest move. */
const cursorOf = handle => RINGS.includes(handle) ? 'grab' : handle === 'scale' || CUBES.includes(handle) ? 'nwse-resize' : 'move'
/** Whether a lock holds what a drag of this kind writes: a move or a turn the position, a scale or a stretch the
 *  parameters (model.js heldOf: its locks, and its bindings). */
const lockedFor = (kind, lock) => kind === 'move' || kind === 'rotate' ? lock.position : kind === 'scale' || kind === 'stretch' ? lock.params : false
const MODES = [
    { mode: 'transform', label: '\u2725 Transform', title: 'Transform: an arrow moves along its axis, a square in its plane, '
        + 'the centre in the view; the quarter arcs rotate; a cube stretches the shape along its own axis by its own sizes '
        + '(a box\'s size, a cylinder\'s radius or height); the dashed circle scales it whole. Ctrl snaps' },
    { mode: 'points', label: '\u2316 Points', title: 'Points: the path\'s or profile\'s points -- drag a dot, an arrow, a square or '
        + 'the fillet\'s diamond; Delete, Insert or +, Enter to type; Ctrl snaps to the grid' },
]

/**
 * @param stage    the canvas panel's element: the overlay covers it
 * @param canvas   the render canvas, for its backing size (the picture's aspect) and its events
 * @param RT       the renderer: its `cam` for getUniforms() and get()
 * @param BUILDER  for `doc`, the scene the selected id belongs to, live() / commit(), nodeOfTag()
 * @param onPick   (id | null) => void, a click in the picture chose this node (null: nothing)
 * @param boxes    the measured bounds (boxes.js), optional: drawn as showBoxes says -- 'none', 'active'
 *                 (the selection's, the default) or 'all'
 * @returns { select(id | null), showBoxes(mode), boxesShown, redraw() }
 */
export function installSelectionOverlay({ stage, canvas, RT, BUILDER, onPick = () => { }, boxes = null }) {
    const el = document.createElement('canvas')
    Object.assign(el.style, { position: 'absolute', inset: '0', width: '100%', height: '100%',
        zIndex: '5', pointerEvents: 'none' })
    stage.appendChild(el)
    const g = el.getContext('2d')

    let cssW = stage.clientWidth, cssH = stage.clientHeight
    new ResizeObserver(() => { cssW = stage.clientWidth; cssH = stage.clientHeight }).observe(stage)

    let selected = null, frame = 0, boxMode = 'active'
    let handles = []             // what was last drawn, in stage pixels, for hit testing
    let hover = null, drag = null
    let mode = 'transform'
    let enabled = true
    try { enabled = localStorage.getItem(STORE_KEY) !== 'off' } catch { }

    /* THE BAR: bottom left, since the renderer's menu has the top left. The Edit switch is always
       there; the mode buttons only while editing is on and the selection has handles (not the
       root, whose transform moves nothing). */
    const bar = document.createElement('div')
    Object.assign(bar.style, { position: 'absolute', left: '8px', bottom: '8px', zIndex: '10', display: 'flex',
        alignItems: 'center', gap: '6px', padding: '2px', borderRadius: '5px', background: 'rgba(18,21,24,0.55)',
        border: '1px solid rgba(160,175,190,0.25)' })
    const button = (label, title, onclick) => {
        const b = document.createElement('button')
        b.textContent = label
        b.title = title
        Object.assign(b.style, { font: '12px Arial, sans-serif', color: '#ccd4db', background: 'transparent',
            border: '1px solid transparent', borderRadius: '4px', padding: '3px 7px', cursor: 'pointer' })
        b.onclick = onclick
        return b
    }
    const lit = (b, on) => Object.assign(b.style, on
        ? { background: 'rgba(120,150,175,0.35)', color: '#fff', borderColor: 'rgba(160,175,190,0.4)' }
        : { background: 'transparent', color: '#ccd4db', borderColor: 'transparent' })
    const editBtn = button('\u270e Edit', 'Edit in the picture: select by clicking, handles. Off: the picture is only a picture',
        () => setEnabled(!enabled))
    let local = true
    try { local = localStorage.getItem(STORE_KEY + '.local') !== 'off' } catch { }
    const localBtn = button('local', 'Handles along the object\'s own axes, turning with it. Off: along its parent\'s '
        + '(the world\'s, at the top level), where each arrow moves exactly one of the panel\'s numbers', () => {
            local = !local
            try { localStorage.setItem(STORE_KEY + '.local', local ? 'on' : 'off') } catch { }
            lit(localBtn, local)
        })
    lit(localBtn, local)
    /* THE MODES ARE ONE SET, one of them on: a pill of their own (icons.js iconPill, as the view's toolbar groups
       its switches -- the user, 2026-10-02: clear "what are toggles that belong together"); `local` a switch apart */
    const modes = document.createElement('span')
    Object.assign(modes.style, { display: 'none', gap: '6px', alignItems: 'center' })
    const buttons = MODES.map(m => button(m.label, m.title, () => setMode(m.mode)))
    const localPill = iconPill(localBtn)
    modes.append(iconPill(...buttons))
    const pointsBtn = buttons[MODES.findIndex(m => m.mode === 'points')]
    const POINTS_TITLE = pointsBtn.title, POINTS_LOCKED = 'Points: its parameters are locked, and its points are parameters -- '
        + 'untick "lock parameters" in the properties panel, or click its lock in the tree'
    pointsBtn.style.display = 'none'                        // until a frame finds something to edit (draw)
    const readout = installReadout(stage)
    const points = createPointsMode({ stage, canvas, RT, BUILDER, boxes, button, lit, readout,
        redraw: () => { if (!frame) frame = requestAnimationFrame(draw) } })
    modes.append(localPill, points.bar)
    bar.append(editBtn, modes)
    stage.appendChild(bar)
    const setMode = m => {
        mode = m
        hover = null; stage.style.cursor = ''       // what it was over is not drawn any more
        MODES.forEach((d, i) => lit(buttons[i], d.mode === m))
        // the points are always along the object's own axes: there is no parent's to choose
        localPill.style.display = m === 'points' ? 'none' : ''
    }
    setMode(mode)
    const showBar = on => { const v = on ? 'flex' : 'none'; if (modes.style.display !== v) modes.style.display = v }
    const setEnabled = on => {
        enabled = on
        try { localStorage.setItem(STORE_KEY, on ? 'on' : 'off') } catch { }
        lit(editBtn, on)
        editBtn.style.opacity = on ? '1' : '0.7'
        if (drag) end()
        hover = null; stage.style.cursor = ''
        if (!frame) frame = requestAnimationFrame(draw)    // draws, or clears and stops
    }

    /** The camera and the picture's rectangle, as both drawing and the mouse need them. */
    const viewNow = () => {
        const cam = RT.cam
        if (!cam) return null
        const U = cam.getUniforms(), state = cam.get()
        const camtype = state.camtype ?? 0
        // near as a depth ahead of the camera: the camera's own for perspective; for orthographic
        // rays start ON the camera's plane, so anything behind it is not in the picture
        const near = camtype === 1 ? 0 : Math.max(1e-4, state.near ?? 1e-3)
        const bw = canvas.width || 1, bh = canvas.height || 1
        const s = Math.min(cssW / bw, cssH / bh), dw = bw * s, dh = bh * s
        const ox = (cssW - dw) / 2, oy = (cssH - dh) / 2
        const screen = P => {
            const q = projectPoint(P, U, camtype)
            return [ox + (q.x * 0.5 + 0.5) * dw, oy + (0.5 - q.y * 0.5) * dh]
        }
        const ray = (px, py) => rayThrough(((px - ox) / dw) * 2 - 1, 1 - ((py - oy) / dh) * 2, U, camtype)
        /* which way the camera looks at a point: along the ray to it for perspective, the one
           viewing direction for orthographic */
        const towards = P => {
            if (camtype === 1) return [-U.invView[8], -U.invView[9], -U.invView[10]]
            const d = [P[0] - U.camPos[0], P[1] - U.camPos[1], P[2] - U.camPos[2]]
            const l = Math.hypot(...d) || 1
            return d.map(v => v / l)
        }
        return { U, camtype, near, ox, oy, dw, dh, screen, ray, towards }
    }

    /* THE GRID CTRL SNAPS TO at the node, as the Points mode's (pointedit gridStep, GRID_PX apart on screen): `grid` in
       its parent's units, which its position is written in, and `size` in its own, which its sizes are -- they differ
       by the node's own scale. A fixed 0.1 was a third of a 30 cm part and nothing of a 2 mm one. */
    const gridAt = (V, mf) => {
        const perPx = worldPerPixels(1, projectPoint(mf.origin, V.U, V.camtype).depth, V.U.invProjection[5], V.dh, V.camtype)
        return { grid: gridStep(perPx / mf.scale, GRID_PX), size: gridStep(perPx / (mf.scale * mf.node.transform.scale), GRID_PX) }
    }

    const draw = () => {
        frame = 0
        const dpr = window.devicePixelRatio || 1
        const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr))
        if (el.width !== w || el.height !== h) { el.width = w; el.height = h }
        g.setTransform(1, 0, 0, 1, 0, 0)
        g.clearRect(0, 0, w, h)
        handles = []
        /* THE MEASURED BOXES (boxes.js), under everything else: the selection's -- an object's or a
           group's -- and every node's while they are asked for. A view aid, not an edit: drawn with
           Edit off too. */
        const wantBoxes = boxes && (boxMode === 'all' || (boxMode === 'active' && selected != null))
        const V0 = wantBoxes ? viewNow() : null
        if (V0) { g.setTransform(dpr, 0, 0, dpr, 0, 0); paintBoxes(V0) }
        /* POINTS: offered only for an object with a path or a profile, and told every frame what it is editing */
        const pointsHere = enabled && selected != null && points.available(selected)
        // offered while its parameters are locked, so the mode is not simply gone, but not to be chosen (LOCKED above)
        const pointsLocked = pointsHere && heldOf(find(BUILDER.doc, selected)?.node).params
        if (mode === 'points' && (!pointsHere || pointsLocked) && selected != null && enabled) setMode('transform')
        pointsBtn.style.display = pointsHere ? '' : 'none'
        if (pointsBtn.disabled !== pointsLocked) {
            pointsBtn.disabled = pointsLocked
            pointsBtn.style.opacity = pointsLocked ? '0.45' : ''
            pointsBtn.style.cursor = pointsLocked ? 'not-allowed' : 'pointer'
            pointsBtn.title = pointsLocked ? POINTS_LOCKED : POINTS_TITLE
        }
        points.sync(selected, pointsHere && !pointsLocked && mode === 'points')
        if (selected == null || !enabled) {
            showBar(false)
            readout.show(null)
            if (wantBoxes) frame = requestAnimationFrame(draw)     // the camera moves
            return
        }

        const V = V0 || viewNow()
        const geo = V && selectionGeometry(BUILDER.doc, selected)
        if (geo) {
            g.setTransform(dpr, 0, 0, dpr, 0, 0)
            paint(geo, V)
        } else readout.show(null)
        frame = requestAnimationFrame(draw)
    }

    /* A BOX: its twelve edges, clipped to what is in front of the camera and to the picture. An open
       box (an object with no end, boxes.js) is dashed: its faces are where the search stopped. */
    function paintBoxes(V) {
        const d = BUILDER.doc
        if (!d) return
        const { U, camtype, near, screen } = V
        const one = (id, colour, width) => {
            const C = boxes.corners(d, id)
            if (!C) return
            const b = boxes.get(id)
            g.beginPath()
            for (const [a, c] of BOX_EDGES) {
                const seg = clipToView(C[a], C[c], U, camtype, near)
                if (!seg) continue
                const A = screen(seg[0]), B = screen(seg[1])
                g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1])
            }
            g.strokeStyle = colour; g.lineWidth = width; g.setLineDash(b?.open ? [5, 4] : [])
            g.stroke()
        }
        g.save()
        g.beginPath(); g.rect(V.ox, V.oy, V.dw, V.dh); g.clip()
        if (boxMode === 'all') BUILDER.model.walk(d, n => {
            if (n !== d.root && n.id !== selected && n.enabled !== false) one(n.id, n.kind === 'group' ? COLOR.groupBox : COLOR.objBox, 1)
        })
        if (selected != null && boxMode !== 'none') one(selected, COLOR.selBox, 1.5)
        g.setLineDash([])
        g.restore()
    }

    function paint(geo, V) {
        const { U, camtype, near, screen } = V

        g.lineCap = 'round'
        g.save()
        g.beginPath()
        g.rect(V.ox, V.oy, V.dw, V.dh)   // never over the letterbox bars
        g.clip()

        /* AN EXPORT BOX HAS A BOX, unlike every other object (NO BOX above): it is known exactly and
           draws nothing in the picture, so its outline is the only way to see what will be printed. A haze box
           too (hazebox.js): the dust shows only where light crosses it */
        if (geo.node.type === 'export' || geo.node.type === 'haze') {
            const C = boxCorners(BUILDER.doc, geo.node.id)
            g.beginPath()
            g.strokeStyle = COLOR.box
            g.lineWidth = 1.5
            g.setLineDash([6, 4])
            for (const [a, b] of BOX_EDGES) {
                const seg = C && clipToView(C[a], C[b], U, camtype, near)
                if (!seg) continue
                const A = screen(seg[0]), B = screen(seg[1])
                g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1])
            }
            g.stroke()
            g.setLineDash([])
        }

        const mf = moveFrame(BUILDER.doc, selected, local)
        showBar(!!mf)
        const depth = mf && projectPoint(mf.origin, U, camtype).depth
        if (mode === 'points') points.paint(g, V)            // it fills the readout itself
        else {
            if (mf && depth > near) paintHandles(mf, V)
            // over a stretch cube, what it would change; the measured box, if there is one, and whether it is current
            const c = drag ? -1 : CUBES.indexOf(hover)
            readout.show(mf ? transformReadout(BUILDER.doc, selected, { drag: drag?.kind === 'points' ? null : drag,
                preview: c >= 0 ? stretchOf(viewOf(BUILDER.doc, mf.node))?.[AXES[c]] : null,
                box: boxes?.get?.(selected) ?? null, fresh: boxes?.fresh?.(selected) ?? true,
                snap: drag && drag.kind !== 'points' ? drag.steps : gridAt(V, mf) }) : null)
        }

        // what is selected: its name at its origin, and a padlock after it while anything of it is locked
        if (projectPoint(geo.origin, U, camtype).depth > near) {
            const [x, y] = screen(geo.origin)
            const text = geo.node.label || geo.node.id
            g.font = '12px Arial, sans-serif'
            g.lineWidth = 3
            g.strokeStyle = 'rgba(0,0,0,0.7)'
            g.strokeText(text, x + 12, y - 12)
            g.fillStyle = COLOR.text
            g.fillText(text, x + 12, y - 12)
            const lock = heldOf(geo.node)
            if (lock.position || lock.params) paintPadlock(g, x + 12 + g.measureText(text).width + 6, y - 12)
        }
        g.restore()
    }

    /* A PADLOCK, 9 px wide, standing on the text's baseline at (x, y): drawn, not a glyph, so no font decides
       whether it shows */
    function paintPadlock(g, x, y) {
        g.save()
        g.lineWidth = 3
        g.strokeStyle = 'rgba(0,0,0,0.7)'
        const shape = () => { g.beginPath(); g.arc(x + 4.5, y - 7, 2.8, Math.PI, 0) }
        shape(); g.stroke()
        g.strokeRect(x, y - 7, 9, 7)
        g.lineWidth = 1.6
        g.strokeStyle = g.fillStyle = COLOR.box
        shape(); g.stroke()
        g.fillRect(x, y - 7, 9, 7)
        g.restore()
    }

    /* THE HANDLES (gizmodraw.js, every part of the gizmo), and the stretch cubes on the node's OWN axes whatever the
       arrows follow -- a size is the shape's own -- on the axes its shape has sizes for (stretch.js), not one seen
       end-on; with the arrows along the parent's axes each cube has its stem, since it need not lie on an arrow.
       Less what a lock holds (LOCKED above). Recorded in `handles` as drawn. */
    function paintHandles(mf, V) {
        const hot = name => (drag?.handle ?? hover) === name
        const lock = heldOf(mf.node)
        const axes = lock.params ? null : stretchOf(viewOf(BUILDER.doc, mf.node)), cubes = []
        if (axes) {
            const own = mf.local ? mf : moveFrame(BUILDER.doc, selected, true)
            const view = V.towards(own.origin)
            AXES.forEach((a, k) => {
                if (!axes[a] || Math.abs(own.dirs[k].reduce((s, v, i) => s + v * view[i], 0)) >= 0.97) return
                cubes.push({ name: CUBES[k], k, dir: own.dirs[k], f: drag?.handle === CUBES[k] ? drag.f : 1, stem: !mf.local })
            })
        }
        handles = paintGizmo(g, V, mf, { cubes, hot, held: drag?.handle ?? null,
            ...(lock.position ? { arrows: [], squares: [], arcs: false, centre: false } : {}), ...(lock.params ? { circle: false } : {}) })
    }

    /** The handle under a stage-pixel point (gizmodraw.js hitGizmo says in which order), or the Points mode's. */
    const hitTest = (x, y) => mode === 'points' ? points.hit(x, y) : hitGizmo(handles, x, y)?.name ?? null

    //------------------------------------------------------------------------------------------
    // The mouse
    //------------------------------------------------------------------------------------------
    /* Stage pixels from an event on the render canvas, which fills the stage from its corner.
       offsetX needs no layout read, which matters for hover: a rect per pointer move forces a
       layout while the readout dirties it every frame. */
    const onCanvas = e => e.target === canvas

    stage.addEventListener('mousemove', e => {
        if (drag || e.buttons !== 0) return
        const h = onCanvas(e) ? hitTest(e.offsetX, e.offsetY) : null
        if (mode === 'points') {
            if (h?.name !== hover?.name) { hover = h; points.setHover(h); stage.style.cursor = points.cursor(h) }
            return
        }
        if (h !== hover) { hover = h; stage.style.cursor = h ? cursorOf(h) : '' }
    })

    stage.addEventListener('mousedown', e => {
        /* defaultPrevented: a press another tool has taken and hands on to the camera -- the measure tool's, a drag
           begun with a pin or the ruler on (lib/pathtracer/measure/tool.js): it orbits, and selects nothing */
        if (e.button !== 0 || !onCanvas(e) || !enabled || e.defaultPrevented) return
        const handle = selected != null ? hitTest(e.offsetX, e.offsetY) : null
        // in Points a click on nothing lets the point go: picking would select the object's group and end the editing
        if (!handle) { watchClick(e, mode === 'points' ? () => points.select(null) : null); return }
        if (mode === 'points') { beginPoints(e, handle); return }
        const V = viewNow()
        const mf = V && moveFrame(BUILDER.doc, selected, local)
        if (!mf) return
        // the stage's corner once, for the moves that follow wherever the pointer goes
        const r = stage.getBoundingClientRect()
        const px = ev => [ev.clientX - r.left, ev.clientY - r.top]
        const at = ev => V.ray(...px(ev))
        const node = mf.node, t = node.transform
        const d = { handle, id: selected, node, frame: mf, at, px, view: V.towards(mf.origin),
                    start: { pos: { ...t.pos }, rot: { ...t.rot }, scale: t.scale } }
        const k = RINGS.indexOf(handle), c = CUBES.indexOf(handle)
        if (handle === 'scale') {
            const O = V.screen(mf.origin)
            Object.assign(d, { kind: 'scale', O, d0: Math.hypot(e.offsetX - O[0], e.offsetY - O[1]) })
        } else if (c >= 0) {
            /* A STRETCH is measured on the node's own axis as it was at mousedown, as a move is on its arrow's line:
               the factor is how much farther out along it the pointer now is (gizmo.stretchFactor), and the sizes
               are those at mousedown times it (stretch.js) -- so a drag back to where it began restores them */
            const own = moveFrame(BUILDER.doc, selected, true), refs = stretchOf(viewOf(BUILDER.doc, node))?.[AXES[c]]
            const s0 = refs && nearestOnLine(own.origin, own.dirs[c], at(e))
            if (!(s0 > 0)) return                             // seen end-on, or (somehow) grabbed behind the centre
            const keys = [...new Set(refs.map(r => r.k))]
            Object.assign(d, { kind: 'stretch', c, own, refs, s0, f: 1, from: startOf(node, refs),
                params0: Object.fromEntries(keys.map(n => [n, structuredClone(node.params[n])])) })
        } else if (k >= 0) {
            const a0 = ringAngle(mf, k, at(e))
            if (a0 == null) return                            // the ring's plane runs along the ray
            Object.assign(d, { kind: 'rotate', k, prev: a0, total: 0 })
        } else Object.assign(d, { kind: 'move', r0: at(e) })
        d.steps = gridAt(V, mf)                              // the grid as it is at the press: a drag does not zoom
        e.stopPropagation()                                   // before the canvas: no orbit
        e.preventDefault()
        drag = d
        stage.style.cursor = d.kind === 'rotate' ? 'grabbing' : cursorOf(handle)
        hold()
    }, true)

    /** A press on a point's handle (pointsmode.js): its drag, held as any other. */
    const beginPoints = (e, handle) => {
        const V = viewNow()
        if (!V) return
        const r = stage.getBoundingClientRect()
        const px = ev => [ev.clientX - r.left, ev.clientY - r.top]
        const at = ev => V.ray(...px(ev))
        const D = points.begin(handle, e, V, at, px)
        e.stopPropagation()                                   // a press on a handle is never the camera's
        e.preventDefault()
        if (!D) return
        drag = { kind: 'points', D, handle: handle.name }
        stage.style.cursor = points.cursor(handle)
        hold()
    }

    /** What a held handle needs, whichever it is: the mouse and Escape wherever they go until it is let go -- and the
     *  renderer told a move is under way for as long (RT.interacting, lib/pathtracer/interaction.js: a full picture
     *  traced lighter while it lasts, moveFast), so a drag paused without letting go does not go back to it under the
     *  pointer. Released in end(), however the drag ends. */
    let moving = null
    const hold = () => {
        moving?.()
        try { moving = RT.interacting?.hold?.() ?? null } catch { moving = null }
        addEventListener('mousemove', onMove, true)
        addEventListener('mouseup', onUp, true)
        addEventListener('keydown', onKey, true)
    }

    /* A CLICK is a press and a release within a few pixels of each other. Not stopped: the camera
       gets the press too, and a press it sees no movement after changes nothing. */
    let pickSeq = 0
    const watchClick = (e, onClick = null) => {
        const x0 = e.clientX, y0 = e.clientY, px = e.offsetX, py = e.offsetY
        addEventListener('mouseup', ev => {
            if (ev.button !== 0 || Math.hypot(ev.clientX - x0, ev.clientY - y0) > 3) return
            if (onClick) return onClick()
            // the second click of a double-click reports detail 2: the deepest node
            pickAt(px, py, ev.detail >= 2 ? 'deepest' : ev.shiftKey ? 'deeper' : 'click')
        }, { capture: true, once: true })
    }
    const pickAt = async (px, py, how) => {
        const V = viewNow()
        if (!V || !RT.pick) return
        const x = ((px - V.ox) / V.dw) * 2 - 1, y = 1 - ((py - V.oy) / V.dh) * 2
        if (Math.abs(x) > 1 || Math.abs(y) > 1) return        // on the letterbox bars
        const seq = ++pickSeq
        stage.style.cursor = 'progress'
        try {
            const res = await RT.pick(x, y)
            if (seq !== pickSeq || !res || !enabled) return   // a later click, the scene changed, or editing went off
            if (!res.hit) return onPick(null)
            const leaf = BUILDER.nodeOfTag?.(res.tag)
            const id = leaf == null ? null : clickTarget(BUILDER.doc, leaf, selected, how)
            if (id != null) onPick(id)
        } catch (err) {
            console.error('[overlay] pick failed', err)
        } finally {
            if (seq === pickSeq && !drag) stage.style.cursor = hover ? cursorOf(hover) : ''
        }
    }

    /** Write the node's transform and push it: a live uniform, one undo step per drag. */
    const place = ({ pos, rot, scale }) => {
        const t = drag.node.transform
        if (pos) Object.assign(t.pos, pos)
        if (rot) Object.assign(t.rot, rot)
        if (scale != null) t.scale = scale
        BUILDER.live(drag.id, 'transform')
        BUILDER.commit?.(`${drag.id}.transform`)
    }
    /** Write a stretched shape's sizes and push each: live numbers (stretch.js takes no other), one undo step per drag. */
    const size = params => {
        for (const [k, v] of Object.entries(params)) {
            drag.node.params[k] = structuredClone(v)
            BUILDER.live(drag.id, k)
        }
        BUILDER.commit?.(`${drag.id}.stretch.${AXES[drag.c]}`)
    }
    // tidied: 0.1 * 3 is 0.30000000000000004, and the panel and the file would say so
    const snap = (v, step) => tidy(Math.round(v / step) * step)
    const onMove = e => {
        const D = drag
        /* A LOCK THAT CAME ON WHILE A HANDLE WAS HELD (an undo, a script -- a locked handle is never drawn to be
           pressed): the drag writes nothing more. Escape still puts back what it had written. */
        if (lockedFor(D.kind, heldOf(D.node))) return
        if (D.kind === 'points') points.move(D.D, e)
        else if (D.kind === 'move') {
            const pos = dragTo(D.handle, D.frame, D.start.pos, D.r0, D.at(e), D.view)
            if (!pos) return
            // snap only the numbers this handle moves; the others stay exactly as they were
            if (e.ctrlKey) for (const c of ['x', 'y', 'z']) if (pos[c] !== D.start.pos[c]) pos[c] = snap(pos[c], D.steps.grid)
            place({ pos })
        } else if (D.kind === 'rotate') {
            /* summed step by step, so a drag round the ring more than once keeps turning instead of
               snapping back at 180 */
            const a = ringAngle(D.frame, D.k, D.at(e))
            if (a == null) return
            D.total += angleStep(a, D.prev)
            D.prev = a
            let deg = D.total * 180 / Math.PI
            if (e.ctrlKey) deg = snap(deg, 15)
            D.deg = deg                                       // the readout's "turned"
            place({ rot: rotateTo(D.k, D.start.rot, deg, D.frame.local) })
        } else if (D.kind === 'stretch') {
            const s = nearestOnLine(D.own.origin, D.own.dirs[D.c], D.at(e))
            if (s == null) return
            D.f = stretchFactor(D.s0, s)
            size(stretched(viewOf(BUILDER.doc, D.node), D.refs, D.f, D.from, e.ctrlKey ? D.steps.size : 0))
        } else {
            const [x, y] = D.px(e)
            let s = scaleTo(D.start.scale, D.d0, Math.hypot(x - D.O[0], y - D.O[1]))
            if (e.ctrlKey) s = Math.max(0.1, snap(s, 0.1))
            place({ scale: s })
        }
    }
    const end = () => {
        removeEventListener('mousemove', onMove, true)
        removeEventListener('mouseup', onUp, true)
        removeEventListener('keydown', onKey, true)
        // a points drag cut short (another selection, Edit off) still pushes what it wrote and is one undo step
        if (drag?.kind === 'points') points.end(drag.D)
        moving?.(); moving = null
        drag = null
        hover = null
        stage.style.cursor = ''
    }
    const onUp = e => { onMove(e); end() }
    const onKey = e => {
        if (e.key !== 'Escape') return
        e.stopPropagation()
        e.preventDefault()                   // not also "up a level" (below)
        if (drag.kind === 'points') { points.cancel(drag.D); drag.D.changed = false }   // put back: nothing for end() to push
        else if (drag.kind === 'stretch') size(drag.params0)
        else place(drag.start)
        end()
    }

    /* ESC GOES UP A LEVEL, out of a drag excepted (that Escape puts the node back, above, and stops
       it). Not while typing, and not when something else already took the key -- the parameter
       dialog closes on Escape and says so with preventDefault. */
    addEventListener('keydown', e => {
        if (e.defaultPrevented || drag || selected == null || !enabled) return
        const t = e.target
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
        // POINTS' KEYS first: Delete, Insert or +, Enter, and Escape lets a point go before it goes up a level
        if (mode === 'points' && !(e.key === 'Enter' && t?.tagName === 'BUTTON') && points.key(e)) { e.preventDefault(); return }
        if (e.key !== 'Escape') return
        // a node below the root; a material or the scene itself has no level to go up from
        if (!BUILDER.doc || !pathTo(BUILDER.doc, selected).length) return
        onPick(parentOf(BUILDER.doc, selected))
    })

    setEnabled(enabled)

    return {
        /** Show a node of BUILDER.doc, or nothing. */
        select(id) {
            selected = id ?? null
            if (drag) end()
            hover = null; stage.style.cursor = ''      // the handle it was over is gone
            if (!frame) frame = requestAnimationFrame(draw)
        },
        /** Which measured boxes are drawn: 'none', 'active' (the selection's) or 'all'. */
        showBoxes(mode) {
            boxMode = ['none', 'active', 'all'].includes(mode) ? mode : 'active'
            if (!frame) frame = requestAnimationFrame(draw)
        },
        get boxesShown() { return boxMode },
        /** The mode, and the Points mode's own state (pointsmode.js): for the host and the checks. */
        get mode() { return mode },
        /** The Transform handles as last drawn, in stage pixels (names: x y z, xy yz zx, rx ry rz, sx sy sz, view,
         *  scale): what a press is tested against, for the checks. */
        get handles() { return handles },
        /** The panel of numbers at the top right (readout.js): for the checks. */
        readout,
        points,
        /** WHAT IS UNDER A POINT OF THE PAGE (client coordinates): { hit, pos, id } -- the world point hit and
         *  the object there, as a click would find it -- or null off the picture or when the scene changed
         *  meanwhile. For a drop from the library (index.html), which has a point and no click. */
        async probe(cx, cy) {
            const V = viewNow()
            if (!V || !RT.pick) return null
            const r = stage.getBoundingClientRect()
            const x = ((cx - r.left - V.ox) / V.dw) * 2 - 1, y = 1 - ((cy - r.top - V.oy) / V.dh) * 2
            if (Math.abs(x) > 1 || Math.abs(y) > 1) return null
            const res = await RT.pick(x, y)
            if (!res) return null
            return { hit: !!res.hit, pos: res.hit ? res.pos : null, id: res.hit ? BUILDER.nodeOfTag?.(res.tag) ?? null : null }
        },
        /** Draw again (new boxes measured), leaving the selection and any drag as they are. */
        redraw() { if (!frame) frame = requestAnimationFrame(draw) },
    }
}
