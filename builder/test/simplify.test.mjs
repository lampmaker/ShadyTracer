//======================================================================================================================
// Tests for the print mesh's simplification (simplify.js, 0.next).
// Run: node builder/test/simplify.test.mjs
//
// On fields written in JavaScript, meshed by mesh.js as an export meshes them, then simplified: the result is still
// CLOSED and consistently wound (every edge once each way), faces outward, keeps its volume, has fewer triangles where
// the surface is flat than where it curves, and stays near the TRUE surface -- every vertex, and points inside every
// triangle, measured against the exact distance of the shape, held to the tolerance plus the mesher's own error
// (measured first, on the mesh before simplifying). Colours: no triangle changes colour, a region keeps its triangles'
// colour count, and a border stays where it was.
//======================================================================================================================
import { createMesher, openEdges, meshVolume } from '../mesh.js'
import { simplify } from '../simplify.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}

function meshOf(f, n, lo, hi) {
    const s = (hi - lo) / (n - 1)
    const M = createMesher(n, n, n, [s, s, s], [lo, lo, lo])
    for (let z = 0; z < n; z++) {
        const layer = new Float32Array(n * n)
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) layer[x + n * y] = f(lo + x * s, lo + y * s, lo + z * s)
        M.push(layer)
    }
    return { ...M.finish(), cell: s }
}

/** The worst |f| over every vertex and seven points inside every triangle: how far the mesh is from the surface. */
function deviation(m, f) {
    let worst = 0
    const P = m.positions, T = m.triangles
    const W = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1 / 3, 1 / 3, 1 / 3], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5]]
    for (let t = 0; t < T.length; t += 3) for (const [a, b, c] of W) {
        const p = [0, 1, 2].map(k => a * P[3 * T[t] + k] + b * P[3 * T[t + 1] + k] + c * P[3 * T[t + 2] + k])
        worst = Math.max(worst, Math.abs(f(...p)))
    }
    return worst
}
const tris = m => m.triangles.length / 3

//----------------------------------------------------------------------------------------------
// a sphere: closed, outward, its volume, near the true sphere
//----------------------------------------------------------------------------------------------
const sphere = (x, y, z) => Math.hypot(x, y, z) - 10
{
    const m = meshOf(sphere, 61, -12, 12)                 // a cell of 0.4, as the exporter's default in mm
    const before = deviation(m, sphere)
    for (const tol of [0.01, 0.05, 0.2]) {
        const s = await simplify(m, { tol })
        const open = openEdges(s.triangles)
        ok(`sphere, tol ${tol}: closed and consistently wound`, open.length === 0, open.join('\n      '))
        const v0 = meshVolume(m.positions, m.triangles), v = meshVolume(s.positions, s.triangles)
        ok(`...outward, its volume within 1% of the mesh's`, v > 0 && Math.abs(v / v0 - 1) < 0.01, `${v} against ${v0}`)
        const dev = deviation(s, sphere)
        ok(`...every point within the tolerance plus the mesher's error of the true sphere`, dev <= tol + before, `${dev} > ${tol} + ${before}`)
        ok(`...fewer triangles`, tris(s) < tris(m), `${tris(s)} of ${tris(m)}`)
        console.log(`      sphere r 10, cell 0.4, tol ${tol}: ${tris(m)} -> ${tris(s)} triangles, deviation ${before.toFixed(4)} -> ${dev.toFixed(4)}`)
    }
    const same = await simplify(m, { tol: 0 })
    ok('a tolerance of 0: the mesh as it was', same.triangles === m.triangles && same.positions === m.positions)
}

//----------------------------------------------------------------------------------------------
// a box: flat faces become a few triangles, its corners and edges kept
//----------------------------------------------------------------------------------------------
{
    const box = (x, y, z) => Math.max(Math.abs(x) - 8, Math.abs(y) - 6, Math.abs(z) - 4)
    const m = meshOf(box, 51, -10, 10)
    const s = await simplify(m, { tol: 0.01 })
    ok('a box: closed', openEdges(s.triangles).length === 0)
    ok('...a flat face is a handful of triangles: under 1% of the mesh', tris(s) < 0.01 * tris(m), `${tris(s)} of ${tris(m)}`)
    const v0 = meshVolume(m.positions, m.triangles), v = meshVolume(s.positions, s.triangles)
    ok('...its volume', Math.abs(v / v0 - 1) < 1e-3, `${v} against ${v0}`)
    console.log(`      box 16 x 12 x 8, cell 0.4, tol 0.01: ${tris(m)} -> ${tris(s)} triangles`)
}

//----------------------------------------------------------------------------------------------
// a sphere on a plinth: where it curves, smaller triangles than where it is flat -- the point of it
//----------------------------------------------------------------------------------------------
{
    const f = (x, y, z) => Math.min(Math.hypot(x, y, z - 2) - 5, Math.max(Math.abs(x) - 9, Math.abs(y) - 9, Math.abs(z + 4) - 2))
    const m = meshOf(f, 61, -12, 12)
    const s = await simplify(m, { tol: 0.02 })
    ok('a ball on a plinth: closed', openEdges(s.triangles).length === 0)
    // mean triangle area on the ball (above the plinth) against on the plinth's top
    let ballA = 0, ballN = 0, flatA = 0, flatN = 0
    for (let t = 0; t < s.triangles.length; t += 3) {
        const p = [0, 1, 2].map(k => [0, 1, 2].map(j => s.positions[3 * s.triangles[t + k] + j]))
        const u = p[1].map((v, j) => v - p[0][j]), w = p[2].map((v, j) => v - p[0][j])
        const a = Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2
        const cz = (p[0][2] + p[1][2] + p[2][2]) / 3
        if (cz > 0) { ballA += a; ballN++ } else if (Math.abs(cz + 2) < 1e-3) { flatA += a; flatN++ }
    }
    ok('...the flat top\'s triangles over 5 times the ball\'s in area', flatA / flatN > 5 * ballA / ballN, `${(flatA / flatN).toFixed(2)} against ${(ballA / ballN).toFixed(3)}`)
    ok('...and within the tolerance of the shape', deviation(s, f) <= 0.02 + deviation(m, f))
}

//----------------------------------------------------------------------------------------------
// a torus: genus 1 kept (V - E + F = 0), near the true surface
//----------------------------------------------------------------------------------------------
{
    const torus = (x, y, z) => Math.hypot(Math.hypot(x, y) - 6, z) - 2
    const m = meshOf(torus, 61, -9, 9)
    const s = await simplify(m, { tol: 0.03 })
    ok('a torus: closed', openEdges(s.triangles).length === 0)
    const V = s.positions.length / 3, F = tris(s), E = 3 * F / 2
    ok('...still a torus: V - E + F = 0', V - E + F === 0, `${V} - ${E} + ${F}`)
    ok('...near the true torus', deviation(s, torus) <= 0.03 + deviation(m, torus))
    // every vertex used
    const used = new Uint8Array(V); for (const i of s.triangles) used[i] = 1
    ok('...every vertex used by a triangle', used.every(x => x))
}

//----------------------------------------------------------------------------------------------
// colours: none changes, a border stays a border where it was
//----------------------------------------------------------------------------------------------
{
    const m = meshOf(sphere, 51, -12, 12)
    const cent = t => [0, 1, 2].map(k => (m.positions[3 * m.triangles[3 * t] + k] + m.positions[3 * m.triangles[3 * t + 1] + k] + m.positions[3 * m.triangles[3 * t + 2] + k]) / 3)
    // three colours: x > 0 red, x < 0 and y > 0 blue, the rest green -- a junction of three at the poles' meridian
    const labels = Uint16Array.from({ length: tris(m) }, (_, t) => { const c = cent(t); return c[0] > 0 ? 0 : c[1] > 0 ? 1 : 2 })
    const s = await simplify(m, { tol: 0.05, labels })
    ok('coloured: closed', openEdges(s.triangles).length === 0)
    ok('...a label per triangle', s.labels.length === tris(s))
    ok('...fewer triangles', tris(s) < 0.5 * tris(m), `${tris(s)} of ${tris(m)}`)
    // a vertex on a border (triangles of two colours round it) is where the border was: the original border runs within
    // one cell of x = 0 (red against the rest) or y = 0 (blue against green), as the centroids were cut
    const cell = m.cell
    const colourOf = new Map()
    for (let t = 0; t < tris(s); t++) for (let k = 0; k < 3; k++) {
        const v = s.triangles[3 * t + k]
        if (!colourOf.has(v)) colourOf.set(v, new Set())
        colourOf.get(v).add(s.labels[t])
    }
    let far = 0
    for (const [v, ls] of colourOf) {
        if (ls.size < 2) continue
        const x = s.positions[3 * v], y = s.positions[3 * v + 1]
        const near = (ls.has(0) && Math.abs(x) <= cell + 0.05) || (!ls.has(0) && Math.abs(y) <= cell + 0.05)
        if (!near) far++
    }
    ok('...every border vertex within a cell and the tolerance of where the border was', far === 0, `${far} away`)
    // each colour's area kept
    const area = (mm, L) => {
        const A = [0, 0, 0]
        for (let t = 0; t < mm.triangles.length / 3; t++) {
            const p = [0, 1, 2].map(k => [0, 1, 2].map(j => mm.positions[3 * mm.triangles[3 * t + k] + j]))
            const u = p[1].map((v, j) => v - p[0][j]), w = p[2].map((v, j) => v - p[0][j])
            A[L[t]] += Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2
        }
        return A
    }
    const a0 = area(m, labels), a1 = area(s, s.labels)
    ok('...each colour\'s area within 1% of what it was', a0.every((a, i) => Math.abs(a1[i] / a - 1) < 0.01), `${a1.map(a => a.toFixed(1))} against ${a0.map(a => a.toFixed(1))}`)
    let threw = false
    try { await simplify(m, { tol: 0.05, labels: new Uint16Array(3) }) } catch { threw = true }
    ok('a label count that is not the triangles\' refused', threw)
}

//----------------------------------------------------------------------------------------------
// two shapes, one small: each stays closed and none vanishes
//----------------------------------------------------------------------------------------------
{
    const f = (x, y, z) => Math.min(Math.hypot(x - 4, y, z) - 3, Math.hypot(x + 5, y, z) - 0.6)
    const m = meshOf(f, 49, -8, 8)
    const s = await simplify(m, { tol: 0.5 })
    ok('a big and a small sphere at a coarse tolerance: closed', openEdges(s.triangles).length === 0)
    const small = [...s.triangles].some(i => s.positions[3 * i] < -3)
    ok('...the small one still there', small)
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
