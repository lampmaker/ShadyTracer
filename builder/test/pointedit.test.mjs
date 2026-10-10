//======================================================================================================================
// Tests for the points edited in the picture (builder/pointedit.js): where a path's and a profile's points lie, the
// curve drawn as the shader is given it, a drag that moves exactly what its handle says, a name that sets its
// parameter within its range, a refusal when ANY path of the node would break, points put in and taken out, the
// fillet's handle at its arc's middle and held to what fits, the readout, and the camera square to a profile's plane
// -- through the real lib/camera.js. Whether it is pleasant to use is the user's to say.
// Run: node builder/test/pointedit.test.mjs
//======================================================================================================================
import * as M from '../model.js'
import { primitiveObject } from '../primitives.js'
import * as E from '../pointedit.js'
import { pathPieces, profilePieces } from '../../lib/pathtracer/core/shapes.js'
import { projectPoint, rayThrough } from '../../lib/pathtracer/core/genrays.js'
import { CAMERA } from '../../lib/camera.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want),
    `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
const near = (a, b, e) => Math.abs(a - b) <= e
const vnear = (name, got, want, e = 1e-9) =>
    ok(name, !!got && got.length === want.length && got.every((v, i) => near(v, want[i], e)),
        `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
const sub = (a, b) => a.map((v, i) => v - b[i])
const add = (a, b) => a.map((v, i) => v + b[i])
const scl = (a, s) => a.map(v => v * s)
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0)
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const T = (pos = [0, 0, 0], rot = [0, 0, 0], scale = 1) =>
    ({ pos: { x: pos[0], y: pos[1], z: pos[2] }, rot: { x: rot[0], y: rot[1], z: rot[2] }, scale })

/* the presets with points, inside a turned, scaled group -- where a frame's sign or a missing scale shows */
const d = M.createDoc({ title: 'points' })
const grp = M.addGroup(d, 'root', { transform: T([4, -1, 0.5], [20, -35, 60], 2.5) })
const place = (key, t) => M.addObject(d, grp.id, { ...primitiveObject(key), transform: t })
const tube = place('bent tube', T([0.3, -0.2, 0.4], [10, 0, 0], 0.5))
const guide = place('light guide', T([-0.5, 0.2, 0], [0, 25, -40], 1.5))
const knob = place('revolution', T([0, 0, 1]))
const plate = place('extrusion', T())
const ball = M.addObject(d, 'root', { primitive: 'sphere' })
// a node as the tools read it: with its block's code and schema (model.js viewOf, version 16)
const node = n => M.viewOf(d, M.find(d, n.id).node)

//----------------------------------------------------------------------------------------------
// WHAT CAN BE EDITED, AND WHERE IT LIES
//----------------------------------------------------------------------------------------------
eq('a path', E.pointTargets(node(tube)), [{ k: 'route', kind: 'path' }])
eq('a sweep: its path, and its section across the path', E.pointTargets(node(guide)),
    [{ k: 'route', kind: 'path' }, { k: 'section', kind: 'profile', plane: 'sweep', along: 'route' }])
eq('a revolved outline: radius and height', E.pointTargets(node(knob)), [{ k: 'outline', kind: 'profile', plane: 'rz' }])
eq('an extruded one: x and y', E.pointTargets(node(plate)), [{ k: 'outline', kind: 'profile', plane: 'xy' }])
eq('nothing on a sphere, nor on a group', [E.pointTargets(node(ball)), E.pointTargets(node(grp))], [[], []])
eq('the code is read without its comments: "revolve" in a comment is not a revolve',
    E.usageOf({ code: '// revolve(outline, p)\nC = add_new(C, extrude(outline, p, 0.1), MATERIAL);', params: {} }, 'outline'), { plane: 'xy' })
eq('...and a sweep along something that is not a path is not a sweep',
    E.usageOf({ code: 'C = add_new(C, sweep(r, outline, p), MATERIAL);', params: { r: 2 } }, 'outline'), { plane: 'xy' })

const targetOf = (n, k) => E.pointTargets(node(n)).find(t => t.k === k)
for (const [what, n, k] of [['the sweep', guide, 'section'], ['the revolve', knob, 'outline'], ['the extrude', plate, 'outline']]) {
    const t = targetOf(n, k), P = E.planeOf(node(n), t)
    ok(`${what}'s plane: U, V, W unit and square, W = U x V`,
        [P.U, P.V, P.W].every(v => near(Math.hypot(...v), 1, 1e-12)) && near(dot(P.U, P.V), 0, 1e-12) && cross(P.U, P.V).every((v, i) => near(v, P.W[i], 1e-12)),
        JSON.stringify(P))
}
// the light guide's route starts along +x: B is +z off it and N = B x T = +y (shapes.js pathPieces' first frame)
eq('the sweep\'s plane is the path\'s first frame at its first point: x along N, y along B, looked at along T',
    E.planeOf(node(guide), targetOf(guide, 'section')), { O: [-0.7, 0, 0], U: [0, 1, 0], V: [0, 0, 1], W: [1, 0, 0] })
eq('...the revolve\'s, the half-plane y = 0: x the radius, y the height (codegen revolve: q = (|p.xy|, p.z))',
    E.planeOf(node(knob), targetOf(knob, 'outline')), { O: [0, 0, 0], U: [1, 0, 0], V: [0, 0, 1], W: [0, -1, 0] })
eq('...and a path has none: it is 3D', E.planeOf(node(tube), targetOf(tube, 'route')), null)
eq('the readout\'s names', [E.coordNames(targetOf(tube, 'route')), E.coordNames(targetOf(knob, 'outline')), E.coordNames(targetOf(plate, 'outline'))],
    [['x', 'y', 'z'], ['r', 'z'], ['x', 'y']])

for (const [n, k] of [[tube, 'route'], [guide, 'section'], [knob, 'outline']]) {
    const t = targetOf(n, k), P = E.planeOf(node(n), t)
    for (const pt of [[0.3, -1.2, 0.7], [-2, 0.5, 1e-3]]) {
        const c = pt.slice(0, t.kind === 'path' ? 3 : 2)
        vnear(`${k} of ${node(n).label}: a point to its object's frame and back`, E.coordsOf(t, P, E.localOf(t, P, c)), c, 1e-12)
    }
}

//----------------------------------------------------------------------------------------------
// THE CURVE AS THE SHADER IS GIVEN IT
//----------------------------------------------------------------------------------------------
{
    const t = targetOf(tube, 'route'), r = E.pointsOf(node(tube), t)
    eq('the bent tube reads: its rise named, its points numbers', [r.problems, r.points[3]], [[], [0.5, 0.5, 0.6]])
    const C = E.curveOf(t, null, r.pieces)
    ok('a path\'s curve runs from its first point to its last', C[0][0].every((v, i) => near(v, r.points[0][i], 1e-12)) && C.at(-1).at(-1).every((v, i) => near(v, r.points[3][i], 1e-12)),
        JSON.stringify([C[0][0], C.at(-1).at(-1)]))
    let joined = true
    for (let i = 1; i < C.length; i++) if (!C[i][0].every((v, j) => near(v, C[i - 1].at(-1)[j], 1e-9))) joined = false
    ok('...each run starting where the last ended: straight, arc, straight', joined && C.length === 5)
    const bend = r.pieces.find(p => p.kind === 'bend')
    ok('...every arc point at the fillet\'s radius from its centre', C[1].every(p => near(Math.hypot(...sub(p, bend.c)), bend.R, 1e-12)))
}
{
    const t = targetOf(knob, 'outline'), P = E.planeOf(node(knob), t), r = E.pointsOf(node(knob), t)
    const C = E.curveOf(t, P, r.pieces)
    let joined = true
    for (let i = 0; i < C.length; i++) if (!C[(i + 1) % C.length][0].every((v, j) => near(v, C[i].at(-1)[j], 1e-9))) joined = false
    ok('a profile\'s curve closes: each run starts where the one before ended, the first where the last did', joined)
    ok('...in its plane: every point at y = 0 (the revolve\'s half-plane)', C.flat().every(p => p[1] === 0))
    const arcs = r.pieces.filter(p => p.kind === 'arc'), drawn = C.filter(c => c.length > 2)
    ok('...its arcs the short way round, at their radius', arcs.length === drawn.length && drawn.every((c, i) =>
        c.every(p => near(Math.hypot(...sub(E.coordsOf(t, P, p), arcs[i].c)), arcs[i].r, 1e-12))))
    const bad = E.pointsOf({ params: { o: [[0, 0], [1, 0], [1, 0]] } }, { k: 'o', kind: 'profile', plane: 'xy' })
    ok('an outline that is not sound draws nothing, and says why', !bad.pieces.length && /same point/.test(bad.problems[0]), JSON.stringify(bad.problems))
}

//----------------------------------------------------------------------------------------------
// A DRAG, through the real camera and the kernel's own ray
//----------------------------------------------------------------------------------------------
const cam = CAMERA({ aspect: 1.5, fov: 40, up: [0, 0, 1] })
{
    const F = E.frameOf(d, tube.id)
    cam.set({ target: F.toWorld([0, 0, 0]), azimuth: 30, elevation: 60, distance: 6 })
    const U = cam.getUniforms()
    const t = targetOf(tube, 'route'), r = E.pointsOf(node(tube), t)
    const start = r.points[1].slice(0, 3), P = F.toWorld(start)
    const q = projectPoint(P, U), r0 = rayThrough(q.x, q.y, U), r1 = rayThrough(q.x + 0.05, q.y - 0.03, U)
    for (const j of [0, 1, 2]) {
        const D = F.axis([0, 1, 2].map(i => +(i === j)))
        const got = E.dragPoint(F, t, null, P, start, { axis: D, j }, r0, r1)
        ok(`an arrow moves its own coordinate (${'xyz'[j]}) and leaves the others EXACTLY as they were`,
            got.every((v, i) => i === j ? v !== start[i] : v === start[i]), JSON.stringify([got, start]))
        // the point it lands on is the one of its axis nearest the ray under the mouse
        const W = F.toWorld(got), w0 = sub(W, r1.o), b = dot(D, r1.d)
        ok(`...to the point of its axis nearest the pointer's ray (${'xyz'[j]})`, near((b * dot(r1.d, w0) - dot(D, w0)) / (1 - b * b), 0, 1e-6))
    }
    // the dot: in the plane facing the camera, the point grabbed stays under the pointer
    const towards = sub(P, U.camPos.slice(0, 3)), N = scl(towards, 1 / Math.hypot(...towards))
    const got = E.dragPoint(F, t, null, P, start, { N }, r0, r1), at = projectPoint(F.toWorld(got), U)
    ok('a path\'s dot, dragged, stays under the pointer', near(at.x, q.x + 0.05, 1e-5) && near(at.y, q.y - 0.03, 1e-5), JSON.stringify([at, q]))
    ok('...and a ray that misses its plane moves nothing', E.dragPoint(F, t, null, P, start, { N: [0, 0, 1] }, { o: [0, 0, 5], d: [1, 0, 0] }, r1) === null)
    // A SQUARE (the Transform gizmo's, at the point: gizmodraw.js): in the plane of two of its axes, the third exactly kept
    const H = E.handlesOf(F, t, null)
    for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
        const D0 = H.axes[i].D, D1 = H.axes[j].D, Nq = [D0[1] * D1[2] - D0[2] * D1[1], D0[2] * D1[0] - D0[0] * D1[2], D0[0] * D1[1] - D0[1] * D1[0]]
        const sq = E.dragPoint(F, t, null, P, start, { N: Nq, js: [i, j] }, r0, r1), third = 3 - i - j
        ok(`a square (${'xyz'[i]}${'xyz'[j]}) moves its two coordinates and leaves the third EXACTLY as it was`,
            !!sq && sq[third] === start[third] && (sq[i] !== start[i] || sq[j] !== start[j]), JSON.stringify([sq, start]))
    }
}
for (const [n, k] of [[guide, 'section'], [knob, 'outline']]) {
    const F = E.frameOf(d, n.id), t = targetOf(n, k), P = E.planeOf(node(n), t), H = E.handlesOf(F, t, P)
    cam.set({ target: F.toWorld(P.O), azimuth: -50, elevation: 70, distance: 5 })
    const U = cam.getUniforms(), r = E.pointsOf(node(n), t)
    const start = r.points[1].slice(0, 2), Pw = F.toWorld(E.localOf(t, P, start))
    const q = projectPoint(Pw, U), r0 = rayThrough(q.x, q.y, U), r1 = rayThrough(q.x - 0.04, q.y + 0.06, U)
    const got = E.dragPoint(F, t, P, Pw, start, { N: H.N }, r0, r1), at = projectPoint(F.toWorld(E.localOf(t, P, got)), U)
    ok(`${k} of ${node(n).label}: a dot dragged stays in its plane and under the pointer`, got.length === 2 && near(at.x, q.x - 0.04, 1e-5) && near(at.y, q.y + 0.06, 1e-5),
        JSON.stringify([got, at, q]))
    eq(`...its arrows: U and V, two`, H.axes.map(a => a.j), [0, 1])
    vnear(`...and the plane's normal is the frame's W in the world`, H.N, F.axis(P.W), 1e-12)
}
vnear('Ctrl snaps what the drag changed, and only that', E.snapCoords([0.123, 0.5, 0.777], [0, 0.5, 0], 0.1), [0.1, 0.5, 0.8], 1e-12)

//----------------------------------------------------------------------------------------------
// WHAT A DRAG WRITES: a number, a parameter by its name within its range, or nothing
//----------------------------------------------------------------------------------------------
const owner = { params: { rise: 0.6, w: 2, corner: { x: 1, y: 2, z: 3 }, tint: { r: 1, g: 0, b: 0 }, k: 4 },
                constants: { k: 'f32' }, ranges: { rise: { min: 0.01, max: 10, step: 0.01 } } }
for (const [e, want] of [[0.5, 'number'], [undefined, 'number'], ['rise', { name: 'rise' }], [' rise ', { name: 'rise' }],
    ['corner.y', { name: 'corner', comp: 'y' }], ['corner', 'locked'], ['w/2', 'locked'], ['-rise', 'locked'], ['nope', 'locked'],
    ['k', 'locked'], ['tint.r', 'locked'], ['corner.w', 'locked']])
    eq(`entry ${JSON.stringify(e)}: ${JSON.stringify(want)}`, E.entryKind(owner, e), want)
{
    const pathT = { k: 'route', kind: 'path' }, profT = { k: 'o', kind: 'profile', plane: 'xy' }
    const list = [[0, 0, 0], ['w/2', 0, 'rise'], [1, 'corner.y', 0]]
    const before = JSON.stringify(list)
    eq('a number is set, a locked expression left, a name sets its parameter -- held in its range',
        E.writePoint(owner, pathT, list, 1, { 0: 5, 1: 0.25, 2: 20 }), { list: [[0, 0, 0], ['w/2', 0.25, 'rise'], [1, 'corner.y', 0]], params: { rise: 10 } })
    eq('...and below it too', E.writePoint(owner, pathT, list, 1, { 2: -3 }).params, { rise: 0.01 })
    eq('a vector\'s component sets that component, the rest kept', E.writePoint(owner, pathT, list, 2, { 1: 7 }),
        { list: JSON.parse(before), params: { corner: { x: 1, y: 7, z: 3 } } })
    eq('...the list as given is not touched', JSON.stringify(list), before)
    eq('a name met twice in a point is set once, by its first coordinate', E.writePoint(owner, pathT, [['rise', 'rise', 0]], 0, { 0: 1, 1: 2 }).params, { rise: 1 })
    eq('a number is tidied: 0.1 + 0.2 is written 0.3', E.writePoint(owner, pathT, [[0, 0, 0]], 0, { 0: 0.1 + 0.2 }).list, [[0.3, 0, 0]])
    eq('a value that is not finite is not written', E.writePoint(owner, pathT, [[1, 2, 3]], 0, { 0: NaN, 1: Infinity }).list, [[1, 2, 3]])
    eq('no fillet set to 0 stays none', E.writePoint(owner, pathT, [[1, 0, 0]], 0, { 3: 0 }).list, [[1, 0, 0]])
    eq('a fillet set is added', E.writePoint(owner, pathT, [[1, 0, 0]], 0, { 3: 0.2 }).list, [[1, 0, 0, 0.2]])
    eq('...and one set to 0 goes, so the text says no more than it means', E.writePoint(owner, pathT, [[1, 0, 0, 0.2]], 0, { 3: 0 }).list, [[1, 0, 0]])
    eq('a profile\'s fillet is its third entry', E.writePoint(owner, profT, [[1, 2]], 0, { 2: 0.1 }).list, [[1, 2, 0.1]])
    eq('a named fillet sets its parameter', E.writePoint(owner, profT, [[1, 2, 'rise']], 0, { 2: 0.4 }), { list: [[1, 2, 'rise']], params: { rise: 0.4 } })
    /* A PATH POINT'S SCALE AND TWIST (2026-10-02): entries 5 to 7, padded with the defaults a point skips and trimmed of
       the ones it ends with -- never of a value before one that is not */
    eq('a scale x on a point with no fillet: the fillet written as it reads, 0', E.writePoint(owner, pathT, [[1, 0, 0]], 0, { 4: 1.5 }).list, [[1, 0, 0, 0, 1.5]])
    eq('a scale y alone: scale x written as it reads, 1', E.writePoint(owner, pathT, [[1, 0, 0]], 0, { 5: 0.5 }).list, [[1, 0, 0, 0, 1, 0.5]])
    eq('a twist alone: the scales written as they read', E.writePoint(owner, pathT, [[1, 0, 0, 0, 2]], 0, { 6: 30 }).list, [[1, 0, 0, 0, 2, 2, 30]])
    eq('a fillet set to 0 before a scale: the scale stays (until 2026-10-02 the point was cut at its fillet)',
        E.writePoint(owner, pathT, [[1, 0, 0, 0.2, 1.5]], 0, { 3: 0 }).list, [[1, 0, 0, 0, 1.5]])
    eq('the defaults a point ends with go: a twist of 0', E.writePoint(owner, pathT, [[1, 0, 0, 0.2, 1.5, 0.5, 30]], 0, { 6: 0 }).list, [[1, 0, 0, 0.2, 1.5, 0.5]])
    eq('...every one back to its default: the fillet alone left', E.writePoint(owner, pathT, [[1, 0, 0, 0.2, 1.5, 0.5, 30]], 0, { 4: 1, 5: 1, 6: 0 }).list, [[1, 0, 0, 0.2]])
    eq('...a scale y set to scale x\'s: it follows, so it goes', E.writePoint(owner, pathT, [[1, 0, 0, 0, 2, 0.5]], 0, { 5: 2 }).list, [[1, 0, 0, 0, 2]])
    eq('a twist written as a name sets the parameter, in its range', E.writePoint(owner, pathT, [[1, 0, 0, 0, 1, 1, 'rise']], 0, { 6: 45 }),
        { list: [[1, 0, 0, 0, 1, 1, 'rise']], params: { rise: 10 } })
}
eq('a path point\'s values: scale x, scale y (scale x\'s when left off), twist; the defaults 1, 1, 0',
    [[1, 2, 3], [1, 2, 3, 0, 2], [1, 2, 3, 0, 2, 0.5, 45]].map(E.valuesOf), [[1, 1, 0], [2, 2, 0], [2, 0.5, 45]])

//----------------------------------------------------------------------------------------------
// A NAME CAN BREAK ANOTHER PATH: refused for every path and profile of the node, not only the one edited
//----------------------------------------------------------------------------------------------
{
    const n = { kind: 'object', params: { rise: 0.5, a: { path: [[0, 0, 0], [1, 0, 0], [1, 0, 'rise']] }, b: { path: [[0, 0, 0], [0, 1, 'rise'], [0, 2, 0]] },
                          o: [[0, 0], ['rise', 0], [0, 1]] }, code: 'C = add_new(C, tube(a, p, 0.1, 0.0), MATERIAL);' }
    eq('sound as it is', E.soundWith(n, {}, 'b', null), { ok: true, problems: [] })
    const r = E.soundWith(n, { rise: 0 }, 'b', n.params.b.path)
    ok('rise 0, dragged on path b: path a\'s points 2 and 3 meet, and the profile has no area -- refused, said by name',
        !r.ok && r.problems.length === 2 && /^path 'a': points 2 and 3 are the same point/.test(r.problems[0]) && /^profile 'o': /.test(r.problems[1]), JSON.stringify(r))
    const s = E.soundWith(n, {}, 'b', [[0, 0, 0], [0, 0, 0]])
    ok('...and a list that is not sound is refused the same way', !s.ok && /^path 'b'/.test(s.problems[0]), JSON.stringify(s))
    ok('...its live flag kept while it is judged', E.soundWith({ kind: 'object', params: { p: { path: [[0, 0, 0], [1, 0, 0]], live: true } } }, {}, 'p', [[0, 0, 0], [2, 0, 0]]).ok)
}

//----------------------------------------------------------------------------------------------
// POINTS PUT IN AND TAKEN OUT
//----------------------------------------------------------------------------------------------
{
    const pathT = { kind: 'path' }, profT = { kind: 'profile' }
    const pl = [[0, 0, 0], [1, 0, 'f'], [1, 1, 0]], pp = [[0, 0, 0], [1, 0, 0, 0.1], [1, 1, 0]]
    eq('a point put after another: halfway to the next, the rest as written', E.insertPoint(pathT, pl, pp, 0), [[0, 0, 0], [0.5, 0, 0], [1, 0, 'f'], [1, 1, 0]])
    eq('...after a path\'s last: past it by its last edge', E.insertPoint(pathT, pl, pp, 2), [[0, 0, 0], [1, 0, 'f'], [1, 1, 0], [1, 2, 0]])
    eq('...after a profile\'s last: halfway back to its first', E.insertPoint(profT, [[0, 0], [1, 0], [0, 1]], [[0, 0], [1, 0], [0, 1]], 2), [[0, 0], [1, 0], [0, 1], [0, 0.5]])
    eq('no path has fewer than two points, no profile fewer than three',
        [E.removePoint(pathT, [[0, 0, 0], [1, 0, 0]], 0), E.removePoint(profT, [[0, 0], [1, 0], [0, 1]], 1)], [null, null])
    eq('a path\'s last taken away: the new end gives up its fillet (an end has no corner)',
        E.removePoint(pathT, [[0, 0, 0], [1, 0, 0, 0.1], [1, 1, 0, 0.1], [2, 1, 0]], 3), [[0, 0, 0], [1, 0, 0, 0.1], [1, 1, 0]])
    eq('...and its first', E.removePoint(pathT, [[0, 0, 0], [1, 0, 0, 0.1], [1, 1, 0, 0.1], [2, 1, 0]], 0), [[1, 0, 0], [1, 1, 0, 0.1], [2, 1, 0]])
    eq('a profile keeps every fillet', E.removePoint(profT, [[0, 0, 0.1], [1, 0, 0.1], [1, 1], [0, 1, 0.2]], 2), [[0, 0, 0.1], [1, 0, 0.1], [0, 1, 0.2]])
    // A PATH'S SECTION VALUES (2026-10-02): a point put in takes its neighbours' mean, a new end keeps its own
    const vl = [[0, 0, 0, 0, 2], [1, 0, 0, 0.1, 1, 1, 90], [1, 1, 0]]
    eq('a point put in between two: their scales and twist halfway, as the section changes there',
        E.insertPoint(pathT, vl, vl, 0)[1], [0.5, 0, 0, 0, 1.5, 1.5, 45])
    eq('...past a path\'s end: the last one\'s', E.insertPoint(pathT, [[0, 0, 0], [1, 0, 0, 0, 2]], [[0, 0, 0], [1, 0, 0, 0, 2]], 1)[2], [2, 0, 0, 0, 2])
    eq('...between two without any: none written', E.insertPoint(pathT, pl, pp, 0)[1], [0.5, 0, 0])
    eq('a path\'s end taken away: the new end gives up its fillet and keeps its section', E.removePoint(pathT, [[0, 0, 0], [1, 0, 0, 0.1, 1.5, 0.5, 30], [1, 1, 0]], 2),
        [[0, 0, 0], [1, 0, 0, 0, 1.5, 0.5, 30]])
    eq('...and its first likewise', E.removePoint(pathT, [[0, 0, 0], [1, 0, 0, 0.1, 2], [1, 1, 0]], 0), [[1, 0, 0, 0, 2], [1, 1, 0]])
}

//----------------------------------------------------------------------------------------------
// A PATH POINT'S SECTION (2026-10-02): where it is drawn and its handles sit, which handles, and what a drag writes
//----------------------------------------------------------------------------------------------
{
    const t = targetOf(guide, 'route'), r = E.pointsOf(node(guide), t), n = r.points.length
    const segs = r.pieces.filter(p => p.kind === 'segment')
    const F0 = E.sectionAt(r.pieces, n, 0), Fn = E.sectionAt(r.pieces, n, n - 1)
    vnear('an end\'s section: at the point, in its segment\'s frame', [...F0.O, ...F0.N, ...F0.B, ...F0.T], [...r.points[0], ...segs[0].N, ...segs[0].B, ...segs[0].T], 1e-12)
    vnear('...the last end\'s likewise', [...Fn.O, ...Fn.T], [...r.points[n - 1].slice(0, 3), ...segs[n - 2].T], 1e-12)
    for (const i of [1, 2]) {
        const F = E.sectionAt(r.pieces, n, i), c = E.cornerOf(t, null, r.points, i)
        vnear(`corner ${i + 1}: at the middle of its arc (where its fillet's handle is)`, F.O, add(c.V, scl(c.b, c.r * c.kf)), 1e-12)
        const bis = add(segs[i - 1].T, segs[i].T), bl = Math.hypot(...bis)
        vnear('...along the path there: halfway between its two edges\' directions', F.T, scl(bis, 1 / bl), 1e-12)
        ok('...its N and B a right-handed frame across it', Math.abs(dot(F.N, F.T)) < 1e-12 && Math.abs(dot(F.B, F.T)) < 1e-12 && Math.abs(dot(F.N, F.B)) < 1e-12
            && Math.abs(Math.hypot(...F.N) - 1) < 1e-12 && Math.hypot(...sub(cross(F.N, F.B), F.T)) < 1e-12)
    }
    const straight = pathPieces([[0, 0, 0], [1, 0, 0], [2, 0, 0], [2, 1, 0]]).pieces
    vnear('a straight corner: at the point, in the frame of the segment it starts', [...E.sectionAt(straight, 4, 1).O, ...E.sectionAt(straight, 4, 1).T], [1, 0, 0, 1, 0, 0], 1e-12)
    const fan = pathPieces([[0, 0, 0], [1, 0, 0], [1, 1, 0]]).pieces
    vnear('a sharp corner (a fan): at the corner itself', E.sectionAt(fan, 3, 1).O, [1, 0, 0], 1e-12)
    eq('not the path\'s pieces (unsound): none', E.sectionAt([], 3, 1), null)
    eq('which handles: a tube\'s diameter alone; a sweep\'s scale x, scale y, both and twist; a path nothing reads, the sweep\'s',
        [E.sectionHandles(node(tube), 'route'), E.sectionHandles(node(guide), 'route'), E.sectionHandles({ code: '' }, 'route')],
        [['diameter'], ['sx', 'sy', 'both', 'twist'], ['sx', 'sy', 'both', 'twist']])
    // WHAT A DRAG WRITES (for writePoint)
    const follows = [1, 0, 0, 0, 1.5], own = [1, 0, 0, 0, 1.5, 0.5]
    eq('scale x by a cube: scale y written as it was, since left off it would follow', E.valueDrag(follows, [1.5, 1.5, 0], 'sx', 2), { 4: 3, 5: 1.5 })
    eq('...scale y by its cube', E.valueDrag(own, [1.5, 0.5, 0], 'sy', 0.5), { 5: 0.25 })
    eq('the circle: both -- a scale y that follows left to follow, one of its own scaled too',
        [E.valueDrag(follows, [1.5, 1.5, 0], 'both', 2), E.valueDrag(own, [1.5, 0.5, 0], 'both', 2)], [{ 4: 3 }, { 4: 3, 5: 1 }])
    eq('a tube\'s circle: its scale x, its diameter', E.valueDrag(own, [1.5, 0.5, 0], 'diameter', 2), { 4: 3 })
    eq('the twist: by the degrees turned', E.valueDrag(own, [1.5, 0.5, 30], 'twist', 20), { 6: 50 })
    eq('Ctrl: a scale on 0.1, never below it; a twist on 15 degrees',
        [E.tidy(E.valueDrag(own, [1.5, 0.5, 0], 'diameter', 1.37, true)[4]), E.valueDrag(own, [1, 1, 0], 'diameter', 0.01, true)[4], E.valueDrag(own, [1, 1, 30], 'twist', 20, true)[6]],
        [2.1, 0.1, 45])
    const w = E.writePoint({ params: {} }, { kind: 'path' }, [[0, 0, 0], follows], 1, E.valueDrag(follows, [1.5, 1.5, 0], 'sx', 2))
    eq('...and written: scale x doubled, scale y as it read', w.list[1], [1, 0, 0, 0, 3, 1.5])
}

//----------------------------------------------------------------------------------------------
// THE FILLET'S HANDLE: at its arc's middle, and held to what fits
//----------------------------------------------------------------------------------------------
{
    const t = targetOf(tube, 'route'), r = E.pointsOf(node(tube), t)
    eq('a path\'s ends have no corner', [E.cornerOf(t, null, r.points, 0), E.cornerOf(t, null, r.points, 3)], [null, null])
    eq('...nor has a straight run', E.cornerOf(t, null, [[0, 0, 0], [1, 0, 0], [2, 0, 0]], 1), null)
    const bends = r.pieces.filter(p => p.kind === 'bend')
    for (const [i, b] of [[1, bends[0]], [2, bends[1]]]) {
        const c = E.cornerOf(t, null, r.points, i), h = b.phi / 2, w = cross(b.k, b.u0)
        const mid = add(b.c, scl(add(scl(b.u0, Math.cos(h)), scl(w, Math.sin(h))), b.R))
        vnear(`corner ${i + 1}: the handle at V + b r kf is the arc's middle as pathPieces makes the arc`, add(c.V, scl(c.b, c.r * c.kf)), mid, 1e-12)
    }
    // corner 2 of the bent tube: 90 degrees, its edges 1 long, the next corner's fillet 0.2 taking 0.2 of one
    const c = E.cornerOf(t, null, r.points, 1)
    ok('the largest fillet that fits: 0.8 here', near(c.rMax, 0.8, 1e-12), String(c.rMax))
    const at = f => pathPieces(r.points.map((p, i) => i === 1 ? [...p.slice(0, 3), f] : p)).problems
    ok('...which pathPieces takes', at(c.rMax).length === 0, JSON.stringify(at(c.rMax)))
    ok('...and a hair more it refuses', at(c.rMax * 1.01).length === 1, JSON.stringify(at(c.rMax * 1.01)))
    eq('the handle dragged: by distance over kf, never below 0 nor past what fits',
        [E.filletDrag(c, 0.2, 0, 0.1 * c.kf), E.filletDrag(c, 0.2, 0, 99), E.filletDrag(c, 0.2, 0, -99)].map(E.tidy), [0.3, 0.8, 0])
}
{
    const t = { kind: 'profile', plane: 'xy' }, P = E.planeOf({}, t)
    const pts = [[0, 0], [1, 0, 0.2], [1, 1], [0, 1]]
    const c = E.cornerOf(t, P, pts, 1), arc = profilePieces(pts).pieces.find(p => p.kind === 'arc')
    const m = sub(scl(add(arc.a, arc.b), 0.5), arc.c), mid = add(arc.c, scl(m, arc.r / Math.hypot(...m)))
    vnear('a profile\'s corner: the handle is its arc\'s middle as profilePieces makes it', add(c.V, scl(c.b, c.r * c.kf)).slice(0, 2), mid, 1e-12)
    const at = f => profilePieces(pts.map((p, i) => i === 1 ? [p[0], p[1], f] : p)).problems
    ok('...the largest that fits (1 here) taken, a hair more refused (on each edge it overruns)', near(c.rMax, 1, 1e-12) && !at(c.rMax).length && at(c.rMax * 1.01).length === 2,
        JSON.stringify([c.rMax, at(c.rMax), at(c.rMax * 1.01)]))
    ok('...a profile\'s first point is a corner too: its outline is closed', E.cornerOf(t, P, pts, 0) !== null)
}

//----------------------------------------------------------------------------------------------
// WHAT IS SAID BESIDE A POINT
//----------------------------------------------------------------------------------------------
eq('a path\'s point: its numbers, the difference from the one before, its length, its fillet',
    E.readout({ kind: 'path' }, [[0, 0, 0], [1, 2, 2, 0.1], [3, 2, 2]], 1),
    { names: ['x', 'y', 'z'], coords: [1, 2, 2], delta: [1, 2, 2], length: 3, angle: null, fillet: 0.1, values: [1, 1, 0] })
eq('...and its section\'s scale x, scale y and twist, the defaults where it has none', E.readout({ kind: 'path' }, [[0, 0, 0], [1, 2, 2, 0, 1.5, 0.5, 30]], 1).values, [1.5, 0.5, 30])
eq('...its first has nothing before it', E.readout({ kind: 'path' }, [[0, 0, 0], [1, 2, 2]], 0).delta, null)
eq('a profile\'s first: from its last, and the direction in degrees',
    E.readout({ kind: 'profile', plane: 'rz' }, [[0, 0], [3, 4], [0, 4]], 0),
    { names: ['r', 'z'], coords: [0, 0], delta: [0, -4], length: 4, angle: -90, fillet: 0 })
eq('four decimals, no minus zero', [E.fmt(-0.00001), E.fmt(1.23456), E.fmt(-2)], ['0.0000', '1.2346', '-2.0000'])

//----------------------------------------------------------------------------------------------
// THE GRID, AND WHAT IS TYPED
//----------------------------------------------------------------------------------------------
eq('the grid: 1, 2 or 5 a power of ten, at least 20 pixels apart', [0.0037, 0.001, 0.0025, 50, 0.5].map(w => E.gridStep(w)), [0.1, 0.02, 0.05, 1000, 10])
eq('...and something when the scale is not known', [E.gridStep(0), E.gridStep(NaN)], [0.1, 0.1])
eq('typed: numbers read as numbers, anything else is an expression, nothing is nothing',
    ['0.5', ' -3e2 ', '.5', '1.', '+2', 'w/2', 'rise', '1 2', '', '  '].map(E.parseEntry), [0.5, -300, 0.5, 1, 2, 'w/2', 'rise', '1 2', null, null])

//----------------------------------------------------------------------------------------------
// SQUARE TO A PROFILE'S PLANE, through the real camera (z up): it looks along -W, and where U is level the
// plane's x reads to the right -- straight down and straight up too, the camera's poles
//----------------------------------------------------------------------------------------------
{
    const basis = () => { const V = cam.getUniforms().invView; return { x: [V[0], V[1], V[2]], z: [V[8], V[9], V[10]] } }
    for (const [what, W, Ux] of [
        ['the revolve\'s plane', [0, -1, 0], [1, 0, 0]],
        ['a plane seen from straight above', [0, 0, 1], [1, 0, 0]],
        ['...turned', [0, 0, 1], [Math.cos(0.7), Math.sin(0.7), 0]],
        ['a plane seen from straight below', [0, 0, -1], [0, 1, 0]],
        ['a sweep\'s start, the path rising', [Math.cos(0.4) * 0.6, Math.sin(0.4) * 0.6, 0.8], [-Math.sin(0.4), Math.cos(0.4), 0]],
    ]) {
        cam.set({ camtype: 0 })
        const v = E.planeView(W, Ux, [1, 2, 3], [0.5, 0.25], 0, 1.5)
        cam.set(v)
        const B = basis(), st = cam.get()
        ok(`${what}: looked at straight on`, dot(B.z, W) > 1 - 1e-6, JSON.stringify(B.z))
        ok(`...its x to the right`, dot(B.x, Ux) > 1 - 1e-6, JSON.stringify(B.x))
        ok(`...orthographic, the target its centre`, st.camtype === 1 && st.target.every((c, i) => c === [1, 2, 3][i]))
    }
    // dimensions is the WIDTH (lib/camera.js: orthoDims = [d, d / aspect]): 0.5 x 0.25 half sizes, aspect 1.5
    cam.set(E.planeView([0, -1, 0], [1, 0, 0], [0, 0, 0], [0.5, 0.25], 0, 1.5))
    const [w, h] = cam.get().orthoDims
    ok('what is drawn fits with a margin, both ways', w > 1 && h > 0.5 && w <= 1.4 && near(w / h, 1.5, 1e-12), JSON.stringify([w, h]))
    const tall = E.planeView([0, -1, 0], [1, 0, 0], [0, 0, 0], [0.1, 2], 0, 1.5)
    ok('...a tall outline by its height', tall.dimensions / 1.5 > 4 && tall.dimensions / 1.5 < 5.6, String(tall.dimensions))
    ok('the camera starts outside what it looks at: a long sweep is not seen from inside', E.planeView([1, 0, 0], [0, 1, 0], [0, 0, 0], [0.1, 0.1], 5).distance > 5)
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `pointedit: ${pass} passed, 0 failed`)
process.exit(fail ? 1 : 0)
