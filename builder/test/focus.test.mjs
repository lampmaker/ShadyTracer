//======================================================================================================================
// node builder/test/focus.test.mjs
//
// THE CAMERA BROUGHT TO A NODE (focus.js; the tree's double-click): which box a node is framed by -- an export box's
// own, a measured one only when it is for the node as it is now, else the document's estimate, a group's from its
// enabled objects, none for the root, a plane or what is not there -- and the camera that frames it, THROUGH THE REAL
// lib/camera.js: every corner of the box in the picture, the angles kept, a free camera taken to its orbit, a parallel
// view by its width, a tall view by its narrower side; and the glide between. No GPU, no DOM: whether it feels right
// is the user's to say.
//======================================================================================================================
import * as M from '../model.js'
import { focusBox, framing, focusPose, glidePose, MIN_DISTANCE } from '../focus.js'
import { framing as studioFraming, STUDIO } from '../../library/studio.js'
import { CAMERA } from '../../lib/camera.js'
import { projectPoint } from '../../lib/pathtracer/core/genrays.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b))
const nearV = (a, b, tol = 1e-9) => a.length === b.length && a.every((v, k) => near(v, b[k], tol))
const corners = b => [0, 1, 2, 3, 4, 5, 6, 7].map(c => [c & 1 ? b.hi[0] : b.lo[0], c & 2 ? b.hi[1] : b.lo[1], c & 4 ? b.hi[2] : b.lo[2]])

// ---- THE BOX ------------------------------------------------------------------------------------------------------
const d = M.createDoc()
const ball = M.addObject(d, 'root', { primitive: 'sphere' })
const far = M.addObject(d, 'root', { primitive: 'box', transform: { ...M.identity(), pos: { x: 4, y: 0, z: 1 }, scale: 2 } })
const g = M.addGroup(d, 'root', { id: 'g', transform: { ...M.identity(), pos: { x: 0, y: 10, z: 0 } } })
const g1 = M.addObject(d, g.id, { primitive: 'sphere' })
const g2 = M.addObject(d, g.id, { primitive: 'sphere', transform: { ...M.identity(), pos: { x: 3, y: 0, z: 0 } } })
const off = M.addObject(d, g.id, { primitive: 'sphere', transform: { ...M.identity(), pos: { x: -50, y: 0, z: 0 } } })
M.setEnabled(d, off.id, false)
const plane = M.addObject(d, 'root', { primitive: 'plane' })
{
    const b = focusBox(d, ball.id)
    ok('a sphere at the origin: its own box (the estimate, right for the stock shapes)', nearV(b.lo, [-0.5, -0.5, -0.5]) && nearV(b.hi, [0.5, 0.5, 0.5]) && !b.open && !b.measured, JSON.stringify(b))
    const f = focusBox(d, far.id)
    ok('a box moved and scaled: where it is and how big', nearV(f.lo, [3, -1, 0]) && nearV(f.hi, [5, 1, 2]), JSON.stringify(f))
    const G = focusBox(d, g.id)
    ok('a group: its enabled objects together, in the world (a hidden one left out)', nearV(G.lo, [-0.5, 9.5, -0.5]) && nearV(G.hi, [3.5, 10.5, 0.5]), JSON.stringify(G))
    ok('nothing for the root, an id not in the scene, or a plane (no size known)', [d.root.id, 'nope', plane.id, null].every(id => focusBox(d, id) === null))
    void g1; void g2; void off
    const e = M.addExportBox(d, 'root', { transform: { ...M.identity(), pos: { x: 0, y: 0, z: 2 } } })
    const E = focusBox(d, e.id)
    ok('an export box: its own box, which the estimate leaves out', !!E && nearV(E.lo, [-0.5, -0.5, 1.5]) && nearV(E.hi, [0.5, 0.5, 2.5]), JSON.stringify(E))
    M.remove(d, e.id)
}
{
    // the measured box: only when it is for the node as it is now (boxes.js fresh); else the estimate
    const measured = [[-2, -2, -2], [2, 2, 2]]
    const B = (fresh, open = false) => ({ fresh: () => fresh, corners: () => corners({ lo: measured[0], hi: measured[1] }), get: () => ({ open }) })
    const m = focusBox(d, ball.id, B(true))
    ok('a fresh measured box is the one framed', m.measured && nearV(m.lo, measured[0]) && nearV(m.hi, measured[1]), JSON.stringify(m))
    const s = focusBox(d, ball.id, B(false))
    ok('a stale one is not: the estimate', !s.measured && nearV(s.hi, [0.5, 0.5, 0.5]), JSON.stringify(s))
    ok('a plane measured: endless, so the page frames nothing', focusBox(d, plane.id, B(true, true))?.open === true)
    ok('a plane with only a stale measurement: still better than none', focusBox(d, plane.id, B(false, true))?.open === true)
}

// ---- THE CAMERA, through lib/camera.js -----------------------------------------------------------------------------
const inView = (cam, box, camtype = 0) => {
    const U = cam.getUniforms()
    return corners(box).every(p => { const q = projectPoint(p, U, camtype); return (camtype === 1 || q.depth > 0) && Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1 })
}
const fills = (cam, box, camtype = 0) => {
    // ...and not lost in it: the sphere round the box reaches at least half way to the narrower edge
    const U = cam.getUniforms(), qs = corners(box).map(p => projectPoint(p, U, camtype))
    return Math.max(...qs.map(q => Math.max(Math.abs(q.x), Math.abs(q.y)))) > 0.5
}
{
    const box = focusBox(d, far.id)
    for (const aspect of [1.6, 1, 0.5]) {
        const cam = CAMERA({ aspect, fov: 40, up: [0, 0, 1] })
        cam.set({ target: [0, 0, 0], azimuth: 30, elevation: 60, distance: 20 })
        const to = focusPose(cam.get(), box)
        ok(`aspect ${aspect}: the angles kept, the box's centre the target`, to.azimuth === 30 && to.elevation === 60 && nearV(to.target, [4, 0, 1]), JSON.stringify(to))
        cam.set(to)
        ok(`aspect ${aspect}: every corner of the box in the picture`, inView(cam, box))
        ok(`aspect ${aspect}: ...and filling it, not lost in it`, fills(cam, box))
    }
    // a free camera: its orbit, where it is (focus.js: lib/camera.js does not rebuild its view for a new pos in fps)
    const cam = CAMERA({ aspect: 1.5, fov: 40, up: [0, 0, 1] })
    cam.set({ mode: 'fps' }); cam.set({ pos: [10, -10, 5], target: [0, 0, 0] })
    const to = focusPose(cam.get(), box)
    const dir = [10, -10, 5], L = Math.hypot(...dir)
    ok('a free camera is taken to the orbit it is on: azimuth and elevation of where it stands', to.mode === 'orbit'
        && near(to.azimuth, 315) && near(to.elevation, Math.acos(5 / L) * 180 / Math.PI), JSON.stringify(to))
    cam.set({ mode: 'orbit' }); cam.set(to)
    ok('...and frames the box from there', inView(cam, box) && fills(cam, box))
    // a parallel view: framed by its width (dimensions), the distance only keeps the box in front
    const ortho = CAMERA({ aspect: 1.5, fov: 40, up: [0, 0, 1] })
    ortho.set({ camtype: 1, dimensions: 50 })
    ortho.set({ target: [0, 0, 0], azimuth: 30, elevation: 60, distance: 20 })
    const po = focusPose({ ...ortho.get(), camtype: 1 }, box)
    ok('a parallel view gets a width', po.dimensions > 0 && near(po.dimensions, 2 * framing(box.lo, box.hi).radius * 1.5), JSON.stringify(po))
    ortho.set(po)
    ok('...that shows the whole box', inView(ortho, box, 1) && fills(ortho, box, 1))
    // something tiny: never nearer than the camera panel lets a distance be
    const tiny = { lo: [0, 0, 0], hi: [1e-6, 1e-6, 1e-6] }
    ok('a box too small to see is framed at the camera panel\'s least distance', focusPose(cam.get(), tiny).distance === MIN_DISTANCE)
}
{
    // framing: the narrower field of view decides; the studio's is the same at its own fov and margin
    const lo = [-1, -1, -1], hi = [1, 1, 1], r = Math.sqrt(3) * 1.12
    ok('wide or square: the vertical field', near(framing(lo, hi, { aspect: 2 }).distance, r / Math.sin(20 * Math.PI / 180)) && near(framing(lo, hi).distance, framing(lo, hi, { aspect: 1 }).distance))
    ok('tall: the horizontal one, narrower, so farther', framing(lo, hi, { aspect: 0.5 }).distance > framing(lo, hi).distance)
    const s = studioFraming(lo, hi), f = framing(lo, hi, { fov: STUDIO.fov, margin: STUDIO.margin })
    ok('the studio frames with the same function', near(s.distance, f.distance) && nearV(s.target, f.target) && near(s.radius, f.radius))
}
{
    // the glide: from where it was to where it goes, eased, the distance by equal ratios
    const a = { mode: 'orbit', target: [0, 0, 0], azimuth: 30, elevation: 60, distance: 20, dimensions: 8 }
    const b = { mode: 'orbit', target: [4, 0, 1], azimuth: 30, elevation: 60, distance: 0.2, dimensions: 2 }
    const at = t => glidePose(a, b, t)
    ok('t 0 is where it was', nearV(at(0).target, a.target) && near(at(0).distance, a.distance) && near(at(0).dimensions, a.dimensions))
    ok('t 1 is where it goes', nearV(at(1).target, b.target) && near(at(1).distance, b.distance) && near(at(1).dimensions, b.dimensions))
    ok('half way: the target half way, the distance the geometric mean', nearV(at(0.5).target, [2, 0, 0.5]) && near(at(0.5).distance, 2))
    ok('eased: slow at both ends', Math.hypot(...at(0.1).target) < 0.1 * Math.hypot(...b.target) && Math.hypot(...at(0.9).target) > 0.9 * Math.hypot(...b.target))
    ok('past either end it stays there', near(at(-1).distance, 20) && near(at(2).distance, 0.2))
    ok('a start with no distance (a free camera that said none) goes straight to the end', glidePose({ target: [0, 0, 0] }, b, 0.3).distance === 0.2)
}

console.log(fail ? `${fail} failed, ${pass} passed.` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
