//======================================================================================================================
// Tests for the selection box and the projection it is drawn with.
// Run: node builder/test/bounds.test.mjs
//
// What can be checked without a GPU: that a point goes to the world by the same transform the shader
// undoes, and that projectPoint really is genrays' ray construction run backwards -- a point on the
// ray the kernel shoots through a pixel must project back onto that pixel. Whether the handles then
// sit on the object in the picture is for the user's screen. (Boxes were tested here too, until
// every object became code and had none -- bounds.js.)
//======================================================================================================================
import * as M from '../model.js'
import { matrixOf } from '../transform.js'
import * as B from '../bounds.js'
import { selectionGeometry, toParent } from '../bounds.js'
import { demoDoc } from './demo-doc.mjs'
import { projectPoint, clipToView } from '../../lib/pathtracer/core/genrays.js'
import { CAMERA } from '../../lib/camera.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e
const vnear = (name, got, want, e = 1e-9) =>
    ok(name, got.length === want.length && got.every((v, i) => near(v, want[i], e)),
        `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
const T = (pos = [0, 0, 0], rot = [0, 0, 0], scale = 1) =>
    ({ pos: { x: pos[0], y: pos[1], z: pos[2] }, rot: { x: rot[0], y: rot[1], z: rot[2] }, scale })

ok('there is no box to ask for any more', !('localBounds' in B) && !('corners' in B))

//----------------------------------------------------------------------------------------------
// toParent is the inverse of the shader's xfPoint, through the same matrix codegen uploads
//----------------------------------------------------------------------------------------------
{
    const t = T([1, -2, 0.5], [30, -50, 110], 1.7)
    const m = matrixOf(t)
    // xfPoint: (transpose(R) * (p - pos)) / scale, R's columns being m[0..2], m[4..6], m[8..10]
    const xfPoint = p => {
        const d = [p[0] - m[12], p[1] - m[13], p[2] - m[14]]
        return [0, 4, 8].map(c => (d[0] * m[c] + d[1] * m[c + 1] + d[2] * m[c + 2]) / m[15])
    }
    for (const p of [[0, 0, 0], [1, 0, 0], [0.3, -2, 5]])
        vnear(`xfPoint(toParent(${p})) is ${p}`, xfPoint(toParent(t, p)), p, 1e-12)
}

//----------------------------------------------------------------------------------------------
// The selection in the world: every ancestor's transform, but never the root's
//----------------------------------------------------------------------------------------------
{
    const d = M.createDoc({ title: 't' })
    const g = M.addGroup(d, 'root', { transform: T([10, 0, 0], [0, 0, 90], 2) })
    const s = M.addObject(d, g.id, { primitive: 'sphere', params: { radius: 1 }, transform: T([1, 0, 0]) })
    d.root.transform = T([100, 100, 100])       // codegen never applies it, so neither may the box
    const geo = selectionGeometry(d, s.id)
    // (1,0,0) in the group, scaled by 2 and turned 90 about z: (0,2,0), then moved: (10,2,0)
    vnear('nested origin', geo.origin, [10, 2, 0], 1e-12)
    ok('an unknown id draws nothing', selectionGeometry(d, 'nope') === null)
    vnear('a group has an origin for its handles', selectionGeometry(d, g.id).origin, [10, 0, 0], 1e-12)
    vnear('the root\'s is the world\'s', selectionGeometry(d, 'root').origin, [0, 0, 0], 1e-12)
}
{
    const d = demoDoc()
    const geo = selectionGeometry(d, 'ball')
    vnear('the demo ball is where its transform puts it', geo.origin, [-1.5, 0, 0], 1e-12)
}

//----------------------------------------------------------------------------------------------
// Projection: a point on the kernel's ray through (x, y) projects back to (x, y)
//----------------------------------------------------------------------------------------------
/* genrays' construction, transcribed: dir = normalize(right*x*fx + up*y*fy - fwd) from camPos
   for perspective; origin camPos + right*x*fx + up*y*fy, dir -fwd for orthographic. */
const kernelRay = (U, camtype, x, y) => {
    const V = U.invView, fx = U.invProjection[0], fy = U.invProjection[5], c = U.camPos
    const right = [V[0], V[1], V[2]], up = [V[4], V[5], V[6]], fwd = [V[8], V[9], V[10]]
    if (camtype === 1) return {
        o: [0, 1, 2].map(k => c[k] + right[k] * x * fx + up[k] * y * fy),
        d: fwd.map(v => -v),
    }
    return { o: [c[0], c[1], c[2]], d: [0, 1, 2].map(k => right[k] * x * fx + up[k] * y * fy - fwd[k]) }
}
for (const camtype of [0, 1]) {
    const cam = CAMERA({ aspect: 16 / 9, fov: 50, up: [0, 0, 1] })
    cam.set({ camtype, dimensions: 8, azimuth: 37, elevation: 70, distance: 12 })
    cam.setOrbit({ target: [1, -2, 0.5] })
    const U = cam.getUniforms()
    const kind = camtype ? 'ortho' : 'persp'
    for (const [x, y] of [[0, 0], [0.5, -0.25], [-0.9, 0.8]]) {
        const { o, d } = kernelRay(U, camtype, x, y)
        const P = [0, 1, 2].map(k => o[k] + d[k] * 7.3)
        const q = projectPoint(P, U, camtype)
        vnear(`${kind}: the ray through (${x}, ${y}) projects back onto it`, [q.x, q.y], [x, y], 1e-9)
        ok(`${kind}: and is ahead of the camera`, q.depth > 0)
    }
    // a segment from in front of the camera to behind it is cut at the near depth
    const { o, d } = kernelRay(U, camtype, 0, 0)
    const ahead = [0, 1, 2].map(k => o[k] + d[k] * 5), behind = [0, 1, 2].map(k => o[k] - d[k] * 5)
    const seg = clipToView(ahead, behind, U, camtype, 0.01)
    ok(`${kind}: a segment through the camera is clipped`, seg && near(projectPoint(seg[1], U, camtype).depth, 0.01, 1e-9))
    ok(`${kind}: one wholly behind is dropped`, clipToView(behind, behind.map(v => v + 0.1), U, camtype, 0.01) === null)
}

// A PROFILE (a list of points) counts in the document's guess: its reach, not nothing
{
    const d = M.createDoc()
    M.addObject(d, 'root', { id: 'pr', params: { outline: [[-3, 0], [2, 0, 0.5], [0, 4]], height: 1 }, code: 'C = add_new(C, extrude(outline, p, height), MATERIAL);' })
    const b = B.estimateBox(d.root)
    ok('estimateBox reaches a profile\'s farthest point', !!b && b.hi[0] >= 4 && b.lo[0] <= -4, JSON.stringify(b))
}

// A PATH ({ path }): its farthest point PLUS what is swept along it -- a tube of 0.5 along a path 6 out reaches 6.5,
// which a max of the two would have cut to 6; the fillet (a fourth number; 20 fits this shallow turn) is not a
// coordinate: its arc stays inside the corner
{
    const d = M.createDoc()
    M.addObject(d, 'root', { id: 'tb', params: { route: { path: [[0, 0, 0], [3, 0, 0, 20], [6, 0.5, 0]] }, radius: 0.5 }, code: 'C = add_new(C, tube(route, p, radius, 0.0), MATERIAL);' })
    const b = B.estimateBox(d.root)
    ok('estimateBox reaches a path\'s farthest point plus the tube\'s radius', !!b && b.hi[0] >= 6.5 && b.lo[0] <= -6.5, JSON.stringify(b))
    ok('...and not the fillet\'s 20', !!b && b.hi[0] < 20, JSON.stringify(b))
    // a point that names a parameter (builder/expr.js) is where that parameter puts it: read, not taken for 0
    const e = M.createDoc()
    M.addObject(e, 'root', { id: 'tb', params: { reach: 5, route: { path: [[0, 0, 0], ['reach', 0, 0]] }, radius: 0.5 }, code: 'C = add_new(C, tube(route, p, radius, 0.0), MATERIAL);' })
    const c = B.estimateBox(e.root)
    ok('estimateBox reads a named point: 5 out, plus the radius', !!c && c.hi[0] >= 5.5 && c.lo[0] <= -5.5, JSON.stringify(c))
    // a point's scale (its 5th and 6th numbers, 2026-10-02) makes what is swept there bigger: a tube of 0.5 scaled 3
    // is 1.5 thick there -- and the scale is not a coordinate
    const sd = M.createDoc()
    M.addObject(sd, 'root', { id: 'tb', params: { route: { path: [[0, 0, 0], [3, 0, 0, 0, 3], [6, 0.5, 0]] }, radius: 0.5 }, code: 'C = add_new(C, tube(route, p, radius, 0.0), MATERIAL);' })
    const g = B.estimateBox(sd.root)
    ok('estimateBox: a point scaled 3 makes the radius count three times', !!g && g.hi[0] >= 7.5 && g.hi[0] < 9, JSON.stringify(g))
    ok('...and the named number is a coordinate, not a size swept along the path as well', !!c && c.hi[0] < 10, JSON.stringify(c))
    // a profile's named points read too (2026-10-02)
    const f = M.createDoc()
    M.addObject(f, 'root', { id: 'pl', params: { w: 6, outline: [[0, 0], ['w', 0], [0, 1]] }, code: 'C = add_new(C, extrude(outline, p, 0.1), MATERIAL);' })
    const pb = B.estimateBox(f.root)
    ok('estimateBox reads a profile\'s named point', !!pb && pb.hi[0] >= 6, JSON.stringify(pb))
}

// ONLY A SHAPE'S LENGTHS ARE SIZES: the capped torus's angle (270, degrees) was taken for one, and its guess was 540
// across for a ring of 0.42 -- put in on the picture it stood 270 above the floor (tree.js), the library framed it as a
// speck. Through the document's block, through toTree's copy, and a prism's sides, an aspheric's conic, a twisted
// bar's turn likewise; code that lists no lengths is still guessed from every number
{
    const d = M.createDoc()
    for (const k of ['capped torus', 'prism', 'aspheric lens', 'twisted bar']) M.addObject(d, 'root', { primitive: k, id: k.replace(' ', '') })
    const reachOf = b => Math.max(...b.hi.map(Math.abs), ...b.lo.map(Math.abs))
    const ct = M.find(d, 'cappedtorus').node
    const own = B.estimateBox(d.root, ct, d)
    ok('the capped torus\'s guess is its ring (the largest length), not its angle', !!own && near(reachOf(own), 0.42, 1e-9), JSON.stringify(own))
    const one = B.estimateBox({ kind: 'group', children: [ct] }, null, d)
    ok('...as the picture and the library ask for it', !!one && reachOf(one) < 1, JSON.stringify(one))
    const tree = M.toTree(d)
    ok('...and through toTree, which carries the lengths', reachOf(B.estimateBox(tree, tree.children[0])) < 1)
    ok('a prism\'s sides are not a size', reachOf(B.estimateBox(d.root, M.find(d, 'prism').node, d)) <= 1)
    ok('nor a twisted bar\'s turn', reachOf(B.estimateBox(d.root, M.find(d, 'twistedbar').node, d)) < 2)
    ok('the scene\'s extent from lengths alone', B.sceneExtent(tree) < 20, String(B.sceneExtent(tree)))
    const e = M.createDoc()
    M.addObject(e, 'root', { id: 'c', params: { r: 0.5, n: 7 }, code: 'C = add_new(C, Nsphere(p, r), MATERIAL);' })
    ok('code that lists no lengths: every number, as before', reachOf(B.estimateBox(e.root, M.find(e, 'c').node, e)) >= 7)
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
