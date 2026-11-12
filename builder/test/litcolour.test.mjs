//======================================================================================================================
// Tests for the print's lit colours (0.next): the mesh's side (litcolour.js), the probes' layout (core/probes.js), and
// the whole export with `light` 'lit' (exportbox.js runExport) over stand-ins for the GPU -- the field as
// exportbox.test.mjs gives it, and a probe that answers with a colour made from where each probe looks.
// Run: node builder/test/litcolour.test.mjs
//
// What decides whether a lit print is the picture's colours on the part: that every probe stands on the surface and
// looks AT it along its outward normal, in the world, however the box is turned and scaled; that it starts off the
// surface by the offset said; that each triangle takes its corners' colours and a face the box cuts the material's;
// that the noise is averaged over a vertex's ring and nothing else is. Whether the renderer gives each probe the light
// there is probes.gpu.mjs's (on Dawn), and whether it looks right printed is the user's.
//======================================================================================================================
import * as M from '../model.js'
import { runExport, boxOf, settingsProblems, LIGHTS } from '../exportbox.js'
import { createMesher, openEdges } from '../mesh.js'
import { toParent } from '../bounds.js'
import { boxCuts, cutsOf, vertexProbes, smoothVertices, triangleColours } from '../litcolour.js'
import { probePicture, probeRays, probePlace, PROBE_OVERRIDES, PROBES_PER_RENDER } from '../../lib/pathtracer/core/probes.js'
import { FIELD_GRID, FIELD_HEADER } from '../../lib/pathtracer/core/field.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const T = (pos = [0, 0, 0], rot = [0, 0, 0], scale = 1) => ({ pos: { x: pos[0], y: pos[1], z: pos[2] }, rot: { x: rot[0], y: rot[1], z: rot[2] }, scale })

//----------------------------------------------------------------------------------------------
// the probes' picture and rays
//----------------------------------------------------------------------------------------------
{
    for (const n of [1, 250, 1000, 123457, PROBES_PER_RENDER]) {
        const p = probePicture(n)
        const legendRows = Math.ceil(0.025 * p.h)
        ok(`${n} probes: a picture that holds them past its first rows`, p.w * p.h >= p.first + n && p.first % p.w === 0, JSON.stringify(p))
        ok(`...none in the bottom 2.5 % where the false colour's legend is drawn, with a row to spare`, p.first / p.w >= legendRows + 1, JSON.stringify(p))
        ok('...no wider than 2048', p.w <= 2048)
    }
    const pic = probePicture(40)
    const rays = probeRays(new Float32Array([1, 2, 3, 4, 5, 6]), new Float32Array([0, 0, -2, 1, 0, 0]), { offset: 0.5, unit: 2, pixels: pic.w * pic.h, first: pic.first })
    ok('probe rays: one a pixel', rays.length === 8 * pic.w * pic.h)
    ok('...probe 0 at the first pixel, half a unit back along its direction, in metres', [...rays.slice(8 * pic.first, 8 * pic.first + 8)].join() === [2, 4, 7, 0, 0, 0, -1, 0].join())
    ok('...probe 1 next', [...rays.slice(8 * pic.first + 8, 8 * pic.first + 16)].join() === [7, 10, 12, 0, 1, 0, 0, 0].join())
    ok('...every other pixel probe 0\'s', [0, pic.first - 1, pic.first + 2, pic.w * pic.h - 1].every(j => [...rays.slice(8 * j, 8 * j + 8)].join() === [2, 4, 7, 0, 0, 0, -1, 0].join()))
    ok('probe k\'s place, read top row first: its pixel first + k from the bottom', probePlace(0, pic)[1] === pic.h - 1 - pic.first / pic.w && probePlace(0, pic)[0] === 0
        && probePlace(pic.w, pic)[1] === probePlace(0, pic)[1] - 1)
    ok('the probes trace in Final, with neither light tracing nor the lights\' rays', PROBE_OVERRIDES.renderMode === 0 && PROBE_OVERRIDES.lt === 0 && PROBE_OVERRIDES.lightRays === 0)
    let threw = false
    try { probeRays([[0, 0, 0]], [[0, 0, 0]]) } catch { threw = true }
    ok('a probe with no direction refused', threw)
}

//----------------------------------------------------------------------------------------------
// the mesh's side, on a sphere cut by a box: probes on the surface, looking in; cut faces left out
//----------------------------------------------------------------------------------------------
function meshOf(f, n, lo, s) {
    const Ms = createMesher(n[0], n[1], n[2], s, lo)
    for (let z = 0; z < n[2]; z++) {
        const layer = new Float32Array(n[0] * n[1])
        for (let y = 0; y < n[1]; y++) for (let x = 0; x < n[0]; x++) layer[x + n[0] * y] = f(lo[0] + x * s[0], lo[1] + y * s[1], lo[2] + z * s[2])
        Ms.push(layer)
    }
    return Ms.finish()
}
{
    // a sphere of radius 8 about (10, 10, 5), cut by the box [0, 20] x [0, 20] x [0, 10] (z: its top and bottom cut off)
    const size = [20, 20, 10], c = [10, 10, 5]
    const f = (x, y, z) => Math.max(Math.hypot(x - c[0], y - c[1], z - c[2]) - 8, ...[0, 1, 2].map(a => Math.max(-[x, y, z][a], [x, y, z][a] - size[a])))
    const n = [22, 22, 12]
    const m = meshOf(f, n, [-0.5, -0.5, -0.5], [1, 1, 1])
    ok('the test mesh is closed', openEdges(m.triangles).length === 0)
    // the scene alone (the ball) at the grid's points, before the box's cut: what the export records each side of a face
    const ball = (x, y, z) => Math.hypot(x - c[0], y - c[1], z - c[2]) - 8
    const cuts = boxCuts(n, [1, 1, 1])
    for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) cuts.record(i, j, k, ball(i - 0.5, j - 0.5, k - 0.5))
    const { cut, onCut } = cutsOf(m.positions, m.triangles, size, [1, 1, 1], cuts)
    let wrongCut = 0, cutN = 0
    for (let t = 0; t < cut.length; t++) {
        const zs = [0, 1, 2].map(k => m.positions[3 * m.triangles[3 * t + k] + 2])
        const onFace = zs.every(z => Math.abs(z) < 1e-3) || zs.every(z => Math.abs(z - 10) < 1e-3)
        if (onFace !== !!cut[t]) wrongCut++
        cutN += cut[t]
    }
    ok('the cut triangles: exactly those on the top and bottom faces', wrongCut === 0 && cutN > 0, `${wrongCut} wrong of ${cut.length}, ${cutN} cut`)
    const P = vertexProbes(m.positions, m.triangles, cut, onCut)
    // away from the cuts (a cell and a half from the top and bottom), on the sphere and looking along its radius; at the
    // rim, on the mesher's bevel, within a cell of it and facing out
    let off = 0, outward = 0, far = 0, rimOff = 0, rimIn = 0
    for (let k = 0; k < P.count; k++) {
        const p = [0, 1, 2].map(a => P.points[3 * k + a]), r = p.map((v, a) => v - c[a]), l = Math.hypot(...r)
        const cosR = (r[0] * P.normals[3 * k] + r[1] * P.normals[3 * k + 1] + r[2] * P.normals[3 * k + 2]) / l
        if (p[2] > 1.5 && p[2] < 8.5) {
            far++
            if (Math.abs(l - 8) > 0.1) off++
            if (cosR > 0.9) outward++
        } else {
            if (Math.abs(l - 8) > 1) rimOff++
            if (cosR <= 0) rimIn++
        }
    }
    ok('every probe away from the cuts on the sphere', off === 0 && far > 1000, `${off} of ${far} off it`)
    ok('...its normal outward, within 25 degrees of the radius', outward === far, `${outward} of ${far}`)
    ok('...and at the rim of a cut, within a cell of the sphere, facing out', rimOff === 0 && rimIn === 0, `${rimOff} off, ${rimIn} facing in`)
    // a vertex only cut triangles have: no probe
    const only = new Uint8Array(m.positions.length / 3).fill(1)
    for (let t = 0; t < cut.length; t++) if (!cut[t]) for (let k = 0; k < 3; k++) only[m.triangles[3 * t + k]] = 0
    ok('...and none at a vertex of the cut faces alone', [...only].every((o, v) => !o || P.probe[v] < 0) && only.some(o => o))

    // A BOX FITTED TO A BOX: the part's own faces lie on the box's, and are no cut (the solid stops there)
    {
        const B = (x, y, z) => Math.max(...[0, 1, 2].map(a => Math.max(-[x, y, z][a], [x, y, z][a] - size[a])))
        const mb = meshOf(B, n, [-0.5, -0.5, -0.5], [1, 1, 1])
        const cb = boxCuts(n, [1, 1, 1])
        for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) cb.record(i, j, k, B(i - 0.5, j - 0.5, k - 0.5))
        const { cut: cutB, onCut: onB } = cutsOf(mb.positions, mb.triangles, size, [1, 1, 1], cb)
        const Pb = vertexProbes(mb.positions, mb.triangles, cutB, onB)
        ok('a box fitted to a box: no face of it a cut, a probe at every vertex', cutB.every(x => !x) && Pb.count === mb.positions.length / 3,
            `${cutB.reduce((s, x) => s + x, 0)} cut, ${Pb.count} of ${mb.positions.length / 3}`)
        // ...and a slab of it cut by the box: the floor under the box goes on past its bottom
        const cs = boxCuts(n, [1, 1, 1])
        // the scene a floor below z = 5, going on past the box on every side and below
        for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) cs.record(i, j, k, k - 0.5 - 5)
        const ms = meshOf((x, y, z) => Math.max(B(x, y, z), z - 5), n, [-0.5, -0.5, -0.5], [1, 1, 1])
        const { cut: cutS, onCut: onS } = cutsOf(ms.positions, ms.triangles, size, [1, 1, 1], cs)
        const Ps = vertexProbes(ms.positions, ms.triangles, cutS, onS)
        // a triangle on a face of the box or along an edge between two (every corner on one): cut; on the top: not;
        // and every probe on the top, the only surface of the floor's own
        let sides = 0, wrong = 0
        for (let t = 0; t < cutS.length; t++) {
            const ps = [0, 1, 2].map(k => [0, 1, 2].map(a => ms.positions[3 * ms.triangles[3 * t + k] + a]))
            const onBox = p => p.some((x, a) => Math.abs(x) < 1e-3 || Math.abs(x - size[a]) < 1e-3)
            const top = ps.every(p => Math.abs(p[2] - 5) < 1e-3)
            if (top && cutS[t]) wrong++
            if (ps.every(p => onBox(p) && p[2] < 4.75)) { sides++; if (!cutS[t]) wrong++ }
        }
        let below = 0
        for (let k = 0; k < Ps.count; k++) if (Ps.points[3 * k + 2] < 4.5 - 1e-3) below++
        ok('a floor cut by the box: its sides and bottom cut, its top its own', wrong === 0 && sides > 0, `${wrong} wrong`)
        ok('...no probe below its top\'s bevel (a ray there would start in the floor)', below === 0 && Ps.count > 0, `${below} of ${Ps.count}`)
    }

    // the colours: a probe's value its point's z, smoothed once; a cut triangle the fallback's
    const values = new Float32Array(3 * P.count)
    for (let k = 0; k < P.count; k++) values.fill(P.points[3 * k + 2] / 10, 3 * k, 3 * k + 3)
    const once = smoothVertices(values, m.triangles, P.probe, 1)
    ok('smoothing a linear field leaves it near itself (a ring averages about its centre)',
        [...once].every((v, i) => Math.abs(v - values[i]) < 0.06), Math.max(...[...once].map((v, i) => Math.abs(v - values[i]))))
    ok('...0 passes is the values', smoothVertices(values, m.triangles, P.probe, 0) === values)
    const flat = new Float32Array(values.length).fill(0.5)
    ok('...and a constant stays exactly it', [...smoothVertices(flat, m.triangles, P.probe, 3)].every(v => Math.abs(v - 0.5) < 1e-6))
    const fallback = new Float32Array(3 * cut.length).fill(9)
    const tc = triangleColours(m.triangles, P.probe, values, cut, fallback)
    let bad = 0
    for (let t = 0; t < cut.length; t++) {
        const corners = [0, 1, 2].map(k => m.triangles[3 * t + k]).filter(v => P.probe[v] >= 0)
        const want = cut[t] || !corners.length ? 9 : corners.reduce((s, v) => s + m.positions[3 * v + 2] / 10, 0) / corners.length
        if (Math.abs(tc[3 * t] - want) > 1e-5) bad++
    }
    ok('each triangle its probed corners\' mean, a cut one (or one with none) the fallback\'s', bad === 0, `${bad} wrong`)
}

//----------------------------------------------------------------------------------------------
// the whole export, lit, in a turned and scaled box: what the probe is asked and what the file holds
//----------------------------------------------------------------------------------------------
const standIn = f => async (input, outFloats) => {
    const u = new Uint32Array(input.buffer)
    const count = u[3], nx = u[7], ny = u[11], mode = u[15]
    const v = k => [input[4 * k], input[4 * k + 1], input[4 * k + 2]]
    const out = new Float32Array(outFloats)
    for (let i = 0; i < count; i++) {
        if (mode === FIELD_GRID) {
            const ix = i % nx, iy = Math.floor(i / nx) % ny, iz = Math.floor(i / (nx * ny))
            out[i] = f([0, 1, 2].map(a => v(0)[a] + ix * v(1)[a] + iy * v(2)[a] + iz * v(3)[a]))
        } else out.set([0, 1, 0, 7], 4 * i)                 // the material: green
    }
    return out
}
{
    // a metre scene: a ball of 15 mm at (0.1, 0.02, 0) in a box of 40 x 40 x 20 mm, the box's frame turned 90 about x
    // and scaled 2 (its 20 mm of z is the world's y; the box 20 x 20 x 10 in its own frame)
    const d = M.createDoc({ title: 'ball' }); d.unit = 'm'
    const C = [0.1, 0.02, 0], R = 0.015
    const frames = [T(C, [90, 0, 0], 2)]
    const box = boxOf(frames, [0, 0, 0], [0.02, 0.02, 0.01])
    const f = p => Math.hypot(p[0] - C[0], p[1] - C[1], p[2] - C[2]) - R
    // the world's z of the box's own z axis: where its top is
    const zAxis = [0, 1, 2].map(a => toParent(frames[0], [0, 0, 1])[a] - toParent(frames[0], [0, 0, 0])[a])
    let asked = null
    const probe = async o => {
        asked = o
        const n = o.points.length / 3, colour = new Float32Array(3 * n)
        // red where the probe looks from above the ball's centre along the world's z, blue below
        for (let k = 0; k < n; k++) colour.set(o.points[3 * k + 2] > C[2] ? [1, 0, 0] : [0, 0, 1], 3 * k)
        o.onProgress?.(1, 1)
        return { colour }
    }
    const said = []
    const r = await runExport({ sample: standIn(f), probe, doc: d, box, cell: 1, colours: 3, format: '3mf', light: 'lit', samples: 16, onProgress: t => said.push(t) })
    ok('lit: the probe asked once, at its samples', asked && asked.samples === 16)
    const n = asked.points.length / 3
    // away from the cuts (the box's z, the world's y here, more than a cell and a half from its faces): on the ball and
    // looking along its radius; on the bevels at the rims, within a cell and facing it
    let off = 0, wrongWay = 0, far = 0, rimBad = 0
    for (let k = 0; k < n; k++) {
        const p = [0, 1, 2].map(a => asked.points[3 * k + a]), rr = p.map((x, a) => x - C[a]), l = Math.hypot(...rr)
        const dd = [0, 1, 2].map(a => asked.dirs[3 * k + a]), dl = Math.hypot(...dd)
        const cosR = (rr[0] * dd[0] + rr[1] * dd[1] + rr[2] * dd[2]) / (l * dl)
        if (Math.abs(dl - 1) > 1e-5) wrongWay++
        if (Math.abs(rr[1]) < 0.01 - 0.0015) {
            far++
            if (Math.abs(l - R) > 0.0004) off++
            if (cosR > -0.9) wrongWay++
        } else if (Math.abs(l - R) > 0.001 || cosR >= 0) rimBad++
    }
    ok(`...every point away from the cuts on the ball in the world (within 0.4 of a 1 mm cell), ${far} of them`, off === 0 && far > 100, `${off} off`)
    ok('...each looking at it: its direction a unit vector against the outward radius in the world', wrongWay === 0, `${wrongWay} wrong`)
    ok('...and at the rims, within a cell of it and looking at it', rimBad === 0, `${rimBad} wrong`)
    ok('...from half a cell off: the part is printed at its size in the world (the frame\'s scale included), 0.5 mm', Math.abs(asked.offset - 0.0005) < 1e-12, asked.offset)
    ok('...said as it goes', said.some(t => /lighting/.test(t)))
    // red and blue each the mean of a cluster, which the smoothing mixed a little where they meet
    const pal = r.palette.map(c => c.map(v => Math.round(v * 255)))
    const has = want => pal.some(c => c.every((v, i) => Math.abs(v - want[i]) <= 8))
    ok('three colours: red and blue lit, green on the faces the box cuts', pal.length === 3 && has([255, 0, 0]) && has([0, 0, 255]) && has([0, 255, 0]), JSON.stringify(pal))
    ok('...the mesh closed', r.open === 0)
    ok('...the box\'s z the world\'s -y here (the test turns it 90 about x)', Math.abs(zAxis[1] + 2) < 1e-9, JSON.stringify(zAxis))

    // material: no probe asked; STL: none
    asked = null
    await runExport({ sample: standIn(f), probe, doc: d, box, cell: 1, colours: 3, format: '3mf' })
    ok('material colours (the default): no probe', asked === null)
    await runExport({ sample: standIn(f), probe, doc: d, box, cell: 1, format: 'stl', light: 'lit' })
    ok('an STL has no colours: no probe, lit or not', asked === null)
    let msg = ''
    try { await runExport({ sample: standIn(f), doc: d, box, cell: 1, format: '3mf', light: 'lit' }) } catch (e) { msg = e.message }
    ok('lit with no renderer to ask: said', /renderer/.test(msg), msg)
    ok('the settings: lit and material, samples a whole number from 1', LIGHTS.join() === 'material,lit' && settingsProblems({ cell: 1, colours: 4, light: 'lit', samples: 64 }).length === 0
        && settingsProblems({ cell: 1, colours: 4, light: 'sunny' }).length === 1 && settingsProblems({ cell: 1, colours: 4, samples: 0 }).length === 1
        && settingsProblems({ cell: 1, colours: 4, samples: 2.5 }).length === 1)
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
