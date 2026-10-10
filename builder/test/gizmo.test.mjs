//======================================================================================================================
// Tests for the move handles. Run: node builder/test/gizmo.test.mjs
//
// The two promises the gizmo makes, checked with the real camera and the kernel's own ray:
//   an ARROW changes its own number of the position and no other, by the distance dragged;
//   a SQUARE or the CENTRE keeps the point grabbed under the pointer -- after the drag, that point
//   of the node projects exactly onto the pixel the mouse is at.
// Both inside a turned, scaled group, where the parent's axes are not the world's, which is the
// case a sign or a missing 1/S would get wrong. Whether it feels right to drag is for the user.
//======================================================================================================================
import * as M from '../model.js'
import { moveFrame, dragTo, grab, usable, nearestOnLine, toParentMove, worldPerPixels,
    rotRows, axisRows, eulerOf, rotateTo, ringAngle, RING_BASIS, angleStep, scaleTo, arcPoints } from '../gizmo.js'
import { lineage, toParent } from '../bounds.js'
import { projectPoint, rayThrough } from '../../lib/pathtracer/core/genrays.js'
import { CAMERA } from '../../lib/camera.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const near = (a, b, e) => Math.abs(a - b) <= e
const vnear = (name, got, want, e = 1e-9) =>
    ok(name, !!got && got.length === want.length && got.every((v, i) => near(v, want[i], e)),
        `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
const T = (pos = [0, 0, 0], rot = [0, 0, 0], scale = 1) =>
    ({ pos: { x: pos[0], y: pos[1], z: pos[2] }, rot: { x: rot[0], y: rot[1], z: rot[2] }, scale })
const P3 = p => [p.x, p.y, p.z]

//----------------------------------------------------------------------------------------------
// rayThrough is the kernel's construction: transcribed from genrays' WGSL here, independently
//----------------------------------------------------------------------------------------------
const kernelRay = (U, camtype, x, y) => {
    const V = U.invView, fx = U.invProjection[0], fy = U.invProjection[5], c = U.camPos
    const right = [V[0], V[1], V[2]], up = [V[4], V[5], V[6]], fwd = [V[8], V[9], V[10]]
    if (camtype === 1) return { o: [0, 1, 2].map(k => c[k] + right[k] * x * fx + up[k] * y * fy), d: fwd.map(v => -v) }
    const d = [0, 1, 2].map(k => right[k] * x * fx + up[k] * y * fy - fwd[k]), l = Math.hypot(...d)
    return { o: [c[0], c[1], c[2]], d: d.map(v => v / l) }
}
const camera = camtype => {
    const cam = CAMERA({ aspect: 16 / 9, fov: 50, up: [0, 0, 1] })
    cam.set({ camtype, dimensions: 8, azimuth: 37, elevation: 70, distance: 12 })
    cam.setOrbit({ target: [1, -2, 0.5] })
    return cam.getUniforms()
}
for (const camtype of [0, 1]) {
    const U = camera(camtype), kind = camtype ? 'ortho' : 'persp'
    for (const [x, y] of [[0, 0], [0.4, -0.7]]) {
        const a = rayThrough(x, y, U, camtype), b = kernelRay(U, camtype, x, y)
        vnear(`${kind}: rayThrough(${x}, ${y}) starts where the kernel's does`, a.o, b.o, 1e-12)
        vnear(`${kind}: and points the same way`, a.d, b.d, 1e-12)
    }
}

//----------------------------------------------------------------------------------------------
// The frame the handles point along: the parent's
//----------------------------------------------------------------------------------------------
const d = M.createDoc({ title: 't' })
const top = M.addObject(d, 'root', { primitive: 'sphere', transform: T([1, 2, 3]) })
const grp = M.addGroup(d, 'root', { transform: T([4, -1, 0.5], [20, -35, 60], 2.5) })
const kid = M.addObject(d, grp.id, { primitive: 'sphere', transform: T([0.3, -0.2, 0.4], [10, 0, 0], 0.5) })
d.root.transform = T([50, 50, 50])        // never applied by codegen, so never by the gizmo

{
    const f = moveFrame(d, top.id)
    vnear('top level: the origin is the position', f.origin, [1, 2, 3])
    vnear('top level: the axes are the world\'s', f.axes.flat(), [1, 0, 0, 0, 1, 0, 0, 0, 1])
    ok('the root has no handles', moveFrame(d, 'root') === null)
    ok('nor does an unknown id', moveFrame(d, 'nope') === null)
    const g = moveFrame(d, kid.id)
    ok('in a group: the scale is the group\'s', near(g.scale, 2.5, 1e-12))
    g.axes.forEach((W, i) => ok(`in a group: axis ${i} is S long`, near(Math.hypot(...W), 2.5, 1e-12)))
    ok('in a group: the axes are orthogonal', [[0, 1], [1, 2], [0, 2]].every(([i, j]) =>
        near(g.axes[i].reduce((s, v, n) => s + v * g.axes[j][n], 0), 0, 1e-12)))
    // a world move along a parent axis is one unit of that number per S
    vnear('toParentMove undoes the parent\'s axes', toParentMove(g, g.axes[1].map(v => v * 0.7)), [0, 0.7, 0], 1e-12)
}

//----------------------------------------------------------------------------------------------
// Drags, with the real camera: the grabbed point stays under the pointer
//----------------------------------------------------------------------------------------------
/* Every handle has to be exercised by some case: from this camera the group's xy square is edge-on
   and so skipped (as the overlay would skip it), which is why the top-level node runs too. */
/* ...and each case twice: along the parent's axes and along the node's own (`local`). kid is turned
   inside a turned group, so its own axes are neither the group's nor the world's. */
const exercised = new Set()
for (const local of [false, true]) for (const camtype of [0, 1]) for (const node of [kid, top]) {
    if (local && node === top) node.transform.rot = { x: 30, y: -50, z: 110 }   // turned, or local is parent
    const U = camera(camtype), kind = `${camtype ? 'ortho' : 'persp'} ${node === kid ? 'in group' : 'top'}${local ? ' local' : ''}`
    const rayAt = P => { const q = projectPoint(P, U, camtype); return rayThrough(q.x, q.y, U, camtype) }
    const ndc = P => { const q = projectPoint(P, U, camtype); return [q.x, q.y] }

    const f = moveFrame(d, node.id, local), start = { ...node.transform.pos }
    const view = camtype ? [-U.invView[8], -U.invView[9], -U.invView[10]]
        : (() => { const v = f.origin.map((o, i) => o - U.camPos[i]), l = Math.hypot(...v); return v.map(x => x / l) })()
    const along = (k, s) => f.origin.map((o, i) => o + f.dirs[k][i] * s)

    // an arrow: grab a point on the axis, move the mouse to a point further along it
    for (const k of [0, 1, 2]) {
        const name = 'xyz'[k]
        if (!usable(f, view)[name]) continue
        exercised.add(name + (local ? '/local' : ''))
        const pos = dragTo(name, f, start, rayAt(along(k, 0.3)), rayAt(along(k, 1.1)), view)
        if (local) {
            // along the node's own axis: the origin moves 0.8 world units along it, whatever numbers that takes
            const was = node.transform.pos
            node.transform.pos = pos
            const moved = moveFrame(d, node.id).origin.map((o, i) => o - f.origin[i])
            node.transform.pos = was
            vnear(`${kind}: arrow ${name} moves the node along its own ${name} by the distance dragged`, moved,
                f.dirs[k].map(v => v * 0.8), 1e-9)
            continue
        }
        const want = P3(start).map((v, i) => i === k ? v + 0.8 / f.scale : v)
        vnear(`${kind}: arrow ${name} moves ${name} by the distance dragged, and nothing else`, pos && P3(pos), want, 1e-9)
        ok(`${kind}: arrow ${name} leaves the other numbers bit-identical`,
            pos && [0, 1, 2].every(i => i === k || P3(pos)[i] === P3(start)[i]))
    }

    // a square and the centre: the grabbed world point follows the mouse exactly
    for (const handle of ['xy', 'yz', 'zx', 'view']) {
        if (!usable(f, view)[handle]) continue
        exercised.add(handle + (local ? '/local' : ''))
        const r0 = rayAt(along(0, 0.2).map((v, i) => v + f.dirs[1][i] * 0.15))
        const A = grab(handle, f, r0, view)
        const target = [0.12, -0.3]                                   // where the mouse goes
        const r = rayThrough(target[0], target[1], U, camtype)
        const pos = dragTo(handle, f, start, r0, r, view)
        ok(`${kind}: ${handle} drag lands`, !!pos)
        if (!pos) continue
        const was = node.transform.pos
        node.transform.pos = pos
        const moved = moveFrame(d, node.id).origin.map((o, i) => o - f.origin[i])
        node.transform.pos = was
        vnear(`${kind}: ${handle} keeps the grabbed point under the pointer`, ndc(A.map((v, i) => v + moved[i])), target, 1e-9)
    }

    // letting go where it started puts it back exactly
    const r0 = rayAt(along(0, 0.5))
    vnear(`${kind}: a drag back to the start is no move`, P3(dragTo('view', f, start, r0, r0, view)), P3(start), 0)
}
top.transform.rot = { x: 0, y: 0, z: 0 }
ok('every handle was dragged by some case, both ways', ['x', 'y', 'z', 'xy', 'yz', 'zx', 'view']
    .every(h => exercised.has(h) && exercised.has(h + '/local')), `exercised: ${[...exercised]}`)
{
    const p = moveFrame(d, kid.id), l = moveFrame(d, kid.id, true), R = rotRows(kid.transform.rot)
    ok('local: the handles are the node\'s turned axes', [0, 1, 2].every(k =>
        [0, 1, 2].every(q => near(l.dirs[k][q], R[0][k] * p.dirs[0][q] + R[1][k] * p.dirs[1][q] + R[2][k] * p.dirs[2][q], 1e-12))))
    vnear('local: the numbers still convert through the parent\'s axes', l.axes.flat(), p.axes.flat(), 0)
    ok('local: its axes are right-handed, so the rings turn the way they read',
        near(l.dirs[0][1] * l.dirs[1][2] - l.dirs[0][2] * l.dirs[1][1], l.dirs[2][0], 1e-12))
}

//----------------------------------------------------------------------------------------------
// The handles that cannot be used are not offered
//----------------------------------------------------------------------------------------------
{
    const f = moveFrame(d, top.id)
    const u = usable(f, [0, 0, -1])                 // looking straight down z
    ok('an arrow pointing at the camera is not offered', u.z === false && u.x && u.y)
    ok('a square seen edge-on is not offered', u.yz === false && u.zx === false && u.xy === true)
    ok('the centre always is', u.view === true)
    ok('a line along the ray has no nearest point', nearestOnLine([0, 0, 0], [0, 0, 1], { o: [0, 0, 5], d: [0, 0, -1] }) === null)
    ok('handles keep one size on screen: twice as far, twice as long',
        near(worldPerPixels(90, 20, 0.5, 600), 2 * worldPerPixels(90, 10, 0.5, 600), 1e-12))
    ok('... and in orthographic, the same at any depth',
        worldPerPixels(90, 20, 4, 600, 1) === worldPerPixels(90, 10, 4, 600, 1))
}


//----------------------------------------------------------------------------------------------
// Rotate: the stored angles, the rings and the picture agree
//----------------------------------------------------------------------------------------------
const rnear = (name, A, B, e = 1e-9) => vnear(name, A.flat(), B.flat(), e)
const mul3 = (A, B) => A.map(row => [0, 1, 2].map(c => row[0] * B[0][c] + row[1] * B[1][c] + row[2] * B[2][c]))
for (const r of [{ x: 10, y: 20, z: 30 }, { x: -170, y: 80, z: 175 }, { x: 370, y: -45, z: -400 }, { x: 0, y: 0, z: 0 }]) {
    const e = eulerOf(rotRows(r), r)
    vnear(`eulerOf gives back ${JSON.stringify(r)} when asked near it`, [e.x, e.y, e.z], [r.x, r.y, r.z], 1e-9)
}
// y past 90: the other solution of the pair makes the same matrix; either must round-trip the matrix
for (const r of [{ x: 30, y: 90, z: 40 }, { x: -20, y: -90, z: 70 }, { x: 5, y: 120, z: -60 }]) {
    const e = eulerOf(rotRows(r), { x: 0, y: 0, z: 0 })
    rnear(`eulerOf round-trips the matrix of ${JSON.stringify(r)}`, rotRows(e), rotRows(r), 1e-9)
}
{
    const start = { x: 25, y: -40, z: 70 }
    for (const k of [0, 1, 2]) {
        const got = rotateTo(k, start, 33)
        rnear(`rotateTo about ${'xyz'[k]} is Rot(e_${'xyz'[k]}) * R`, rotRows(got),
            mul3(axisRows(k, 33 * Math.PI / 180), rotRows(start)), 1e-9)
        const small = rotateTo(k, start, 0.5)
        ok(`a half-degree turn about ${'xyz'[k]} moves the angles a little, not by 180`,
            Math.abs(small.x - start.x) + Math.abs(small.y - start.y) + Math.abs(small.z - start.z) < 2)
    }
    const z = rotateTo(2, start, 33.3)
    ok('the z ring adds to rot.z exactly', z.z === start.z + 33.3 && z.x === start.x && z.y === start.y)
    ok('angleStep wraps across pi', near(angleStep(-3.1, 3.1), 2 * Math.PI - 6.2, 1e-12))
}
/* In the picture: turning by 90 on ring k takes the direction of the ring's first basis axis to its
   second, which is the way ringAngle counts -- so the grabbed point follows the pointer round. */
{
    const U = camera(0)
    const world = (id, p) => lineage(d, id).filter(n => n !== d.root && n.transform).reduce((q, n) => toParent(n.transform, q), p)
    for (const k of [0, 1, 2]) {
        const f = moveFrame(d, kid.id), [i, j] = RING_BASIS[k]
        const aimAt = P => { const q = projectPoint(P, U, 0); return rayThrough(q.x, q.y, U, 0) }
        const ai = ringAngle(f, k, aimAt(f.origin.map((o, n) => o + f.dirs[i][n])))
        const aj = ringAngle(f, k, aimAt(f.origin.map((o, n) => o + f.dirs[j][n])))
        ok(`ring ${'xyz'[k]}: its first axis is at angle 0`, ai !== null && near(ai, 0, 1e-6))
        ok(`ring ${'xyz'[k]}: its second is at +90`, aj !== null && near(aj, Math.PI / 2, 1e-6))
        // a local point of the node that sits along the parent's axis i, before the turn
        const was = { ...kid.transform.rot }
        const R0 = rotRows(was), s = kid.transform.scale
        const e = [0, 1, 2].map(n => n === i ? 1 : 0)
        const local = [0, 1, 2].map(c => (R0[0][c] * e[0] + R0[1][c] * e[1] + R0[2][c] * e[2]) / s)  // R^T e / s
        vnear(`ring ${'xyz'[k]}: the chosen point starts along axis ${'xyz'[i]}`,
            world(kid.id, local).map((v, n) => v - f.origin[n]), f.axes[i].map(v => v), 1e-9)
        kid.transform.rot = rotateTo(k, was, 90)
        const after = world(kid.id, local).map((v, n) => v - f.origin[n])
        kid.transform.rot = was
        vnear(`ring ${'xyz'[k]}: +90 takes it to axis ${'xyz'[j]}`, after, f.axes[j], 1e-9)
    }
}
/* The quarter arcs in Move: each sits between the two arrows its ring's plane is spanned by (the x
   arc from y to z), and a click anywhere on it reads an angle inside that quarter, so grabbing the
   arc starts the same drag the full ring would. */
{
    const U = camera(0), f = moveFrame(d, kid.id), gap = 0.1
    const aimAt = P => { const q = projectPoint(P, U, 0); return rayThrough(q.x, q.y, U, 0) }
    for (const k of [0, 1, 2]) {
        const [i, j] = RING_BASIS[k], pts = arcPoints(f, k, 0.8, 8, gap)
        vnear(`arc ${'xyz'[k]}: starts off axis ${'xyz'[i]} by the gap`, pts[0].map((v, n) => v - f.origin[n]),
            f.dirs[i].map((v, n) => (v * Math.cos(gap) + f.dirs[j][n] * Math.sin(gap)) * 0.8), 1e-12)
        vnear(`arc ${'xyz'[k]}: ends off axis ${'xyz'[j]} by the gap`, pts[8].map((v, n) => v - f.origin[n]),
            f.dirs[j].map((v, n) => (v * Math.cos(gap) + f.dirs[i][n] * Math.sin(gap)) * 0.8), 1e-12)
        ok(`arc ${'xyz'[k]}: every point is its radius from the origin`,
            pts.every(P => near(Math.hypot(...P.map((v, n) => v - f.origin[n])), 0.8, 1e-12)))
        const angles = pts.map(P => ringAngle(f, k, aimAt(P)))
        ok(`arc ${'xyz'[k]}: grabbing it reads an angle inside its quarter`,
            angles.every((a, m) => a !== null && near(a, gap + (Math.PI / 2 - 2 * gap) * m / 8, 1e-6)), JSON.stringify(angles))
    }
}
/* Local rings: +90 on ring k takes the node's own axis i to where its own axis j was, and a turn
   the numbers make exactly (x) is exact. The frame is the one at mousedown, as in a drag. */
{
    const U = camera(0)
    const world = (id, p) => lineage(d, id).filter(n => n !== d.root && n.transform).reduce((q, n) => toParent(n.transform, q), p)
    const aimAt = P => { const q = projectPoint(P, U, 0); return rayThrough(q.x, q.y, U, 0) }
    for (const k of [0, 1, 2]) {
        const f = moveFrame(d, kid.id, true), [i, j] = RING_BASIS[k], s = kid.transform.scale
        const ai = ringAngle(f, k, aimAt(f.origin.map((o, n) => o + f.dirs[i][n])))
        const aj = ringAngle(f, k, aimAt(f.origin.map((o, n) => o + f.dirs[j][n])))
        ok(`local ring ${'xyz'[k]}: its axes read 0 and +90`, ai !== null && aj !== null && near(ai, 0, 1e-6) && near(aj, Math.PI / 2, 1e-6))
        const local = [0, 1, 2].map(n => n === i ? 1 / s : 0)          // the node's own unit i, before its scale
        const was = { ...kid.transform.rot }
        kid.transform.rot = rotateTo(k, was, 90, true)
        const after = world(kid.id, local).map((v, n) => v - f.origin[n])
        const axisK = world(kid.id, [0, 1, 2].map(n => n === k ? 1 / s : 0)).map((v, n) => v - f.origin[n])
        kid.transform.rot = was
        vnear(`local ring ${'xyz'[k]}: +90 takes its own ${'xyz'[i]} to where its ${'xyz'[j]} was`, after, f.dirs[j].map(v => v * f.scale), 1e-9)
        vnear(`local ring ${'xyz'[k]}: and leaves its own ${'xyz'[k]} where it was`, axisK, f.dirs[k].map(v => v * f.scale), 1e-9)
        const small = rotateTo(k, was, 0.5, true)
        ok(`local: a half-degree turn about ${'xyz'[k]} moves the angles a little`,
            Math.abs(small.x - was.x) + Math.abs(small.y - was.y) + Math.abs(small.z - was.z) < 2)
    }
    const x = rotateTo(0, { x: 25, y: -40, z: 70 }, 33.3, true)
    ok('the local x ring adds to rot.x exactly', x.x === 25 + 33.3 && x.y === -40 && x.z === 70)
    rnear('local rotateTo about y is R * Rot(e_y)', rotRows(rotateTo(1, { x: 25, y: -40, z: 70 }, 33, true)),
        mul3(rotRows({ x: 25, y: -40, z: 70 }), axisRows(1, 33 * Math.PI / 180)), 1e-9)
}
ok('scale follows the pointer\'s distance', near(scaleTo(1.5, 100, 150), 2.25, 1e-12))
ok('and never reaches zero', scaleTo(1, 100, 0) === 0.01)

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
