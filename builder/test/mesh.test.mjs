//======================================================================================================================
// Tests for the mesher and the colour reduction (mesh.js).
// Run: node builder/test/mesh.test.mjs
//
// What decides whether a printed file is usable is checked here on fields written in JavaScript: that
// the mesh is CLOSED and consistently wound (every edge once in each direction -- what a slicer calls
// manifold), that it faces outward (positive volume), and that it is the right size (the volume of a
// sphere, of a box). Whether the GPU's field is the scene is the kernel's (core/field.js), and whether
// Bambu Studio reads the file is for the user's screen.
//======================================================================================================================
import { createMesher, openEdges, meshVolume, centroids, quantize, toSRGB, hex } from '../mesh.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}

/** Mesh f(x, y, z) over a grid of n points per axis spanning [lo, hi]. */
function meshOf(f, n, lo, hi) {
    const s = (hi - lo) / (n - 1)
    const M = createMesher(n, n, n, [s, s, s], [lo, lo, lo])
    for (let z = 0; z < n; z++) {
        const layer = new Float32Array(n * n)
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) layer[x + n * y] = f(lo + x * s, lo + y * s, lo + z * s)
        M.push(layer)
    }
    return M.finish()
}

//----------------------------------------------------------------------------------------------
// a sphere: closed, outward, the right volume
//----------------------------------------------------------------------------------------------
{
    const r = 1
    const m = meshOf((x, y, z) => Math.hypot(x, y, z) - r, 41, -1.5, 1.5)
    const open = openEdges(m.triangles)
    ok('a sphere is closed and consistently wound', open.length === 0, open.join('\n      '))
    const v = meshVolume(m.positions, m.triangles), want = 4 / 3 * Math.PI * r ** 3
    ok('...faces outward', v > 0, `volume ${v}`)
    ok('...and holds a sphere\'s volume within 1%', Math.abs(v / want - 1) < 0.01, `volume ${v}, want ${want}`)
    let worst = 0
    for (let i = 0; i < m.positions.length; i += 3) worst = Math.max(worst, Math.abs(Math.hypot(m.positions[i], m.positions[i + 1], m.positions[i + 2]) - r))
    ok('...every vertex on the surface to a tenth of a cell', worst < 0.1 * 3 / 40, `worst ${worst}`)
}

//----------------------------------------------------------------------------------------------
// a field that reaches the grid's edge -- a half space -- is closed off there
//----------------------------------------------------------------------------------------------
{
    const m = meshOf((x, y, z) => z, 12, -1, 1)
    ok('a half space cut by the grid is closed', openEdges(m.triangles).length === 0, openEdges(m.triangles).join('\n      '))
    ok('...and faces outward', meshVolume(m.positions, m.triangles) > 0)
}

//----------------------------------------------------------------------------------------------
// two overlapping spheres and a hole through a box: more than one surface, and one of genus 1
//----------------------------------------------------------------------------------------------
{
    const two = meshOf((x, y, z) => Math.min(Math.hypot(x - 0.4, y, z) - 0.6, Math.hypot(x + 0.4, y, z) - 0.6), 33, -1.2, 1.2)
    ok('overlapping spheres: closed', openEdges(two.triangles).length === 0)
    const apart = meshOf((x, y, z) => Math.min(Math.hypot(x - 0.7, y, z) - 0.3, Math.hypot(x + 0.7, y, z) - 0.3), 33, -1.2, 1.2)
    ok('separate spheres: closed', openEdges(apart.triangles).length === 0)
    const box = (x, y, z, h) => Math.max(Math.abs(x) - h, Math.abs(y) - h, Math.abs(z) - h)
    const ring = meshOf((x, y, z) => Math.max(box(x, y, z, 0.8), -(Math.hypot(x, y) - 0.4)), 30, -1, 1)
    ok('a box with a hole through it: closed', openEdges(ring.triangles).length === 0)
    const v = meshVolume(ring.positions, ring.triangles), want = 1.6 ** 3 - Math.PI * 0.4 ** 2 * 1.6
    ok('...and about its volume (the edges are not sharp)', Math.abs(v / want - 1) < 0.03, `volume ${v}, want ${want}`)
    // a thin wall and values exactly zero at grid points: still one surface
    const flat = meshOf((x, y, z) => Math.round(x * 10) / 10 === 0 ? 0 : Math.abs(x) - 0.05, 21, -1, 1)
    ok('a wall with exact zeros on the grid: closed', openEdges(flat.triangles).length === 0)
}

//----------------------------------------------------------------------------------------------
// anisotropic spacing and an offset origin: the winding does not depend on the cell's shape
//----------------------------------------------------------------------------------------------
{
    const n = [20, 14, 9], lo = [-1.2, -0.9, -0.6], s = [2.4 / 19, 1.8 / 13, 1.2 / 8]
    const M = createMesher(n[0], n[1], n[2], s, lo)
    const f = (x, y, z) => Math.hypot(x, y / 0.7, z / 0.4) - 1
    for (let k = 0; k < n[2]; k++) {
        const L = new Float32Array(n[0] * n[1])
        for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) L[i + n[0] * j] = f(lo[0] + i * s[0], lo[1] + j * s[1], lo[2] + k * s[2])
        M.push(L)
    }
    const m = M.finish()
    ok('an ellipsoid on a stretched grid: closed', openEdges(m.triangles).length === 0)
    const v = meshVolume(m.positions, m.triangles), want = 4 / 3 * Math.PI * 0.7 * 0.4
    ok('...outward, and about its volume', v > 0 && Math.abs(v / want - 1) < 0.05, `volume ${v}, want ${want}`)
    const c = centroids(m.positions, m.triangles)
    ok('one centroid per triangle', c.length === m.triangles.length)
}

//----------------------------------------------------------------------------------------------
// the mesher refuses what it cannot do rather than returning half a mesh
//----------------------------------------------------------------------------------------------
{
    const M = createMesher(3, 3, 3)
    let threw = false
    try { M.push(new Float32Array(8)) } catch { threw = true }
    ok('a layer of the wrong size is refused', threw)
    threw = false
    try { M.finish() } catch { threw = true }
    ok('finishing early is refused', threw)
    const empty = meshOf(() => 1, 4, 0, 1)
    ok('nothing inside: no triangles', empty.triangles.length === 0)
}

//----------------------------------------------------------------------------------------------
// colours: exact when there are few, k of them when there are many, most used first
//----------------------------------------------------------------------------------------------
{
    const red = [1, 0, 0], blue = [0, 0, 1]
    const rgb = new Float32Array([...red, ...blue, ...blue, ...red, ...blue])
    const q = quantize(rgb, 4)
    ok('two colours stay two, exactly', q.palette.length === 2 && hex(q.palette[0]) === '#0000FF' && hex(q.palette[1]) === '#FF0000',
        JSON.stringify(q.palette))
    ok('...the most used first', [...q.index].join() === '1,0,0,1,0')
    // a gradient of 100 greys into 3
    const g = new Float32Array(300)
    for (let i = 0; i < 100; i++) g.fill(i / 99, 3 * i, 3 * i + 3)
    const q3 = quantize(g, 3)
    ok('a gradient becomes three colours', q3.palette.length === 3)
    ok('...each item on its nearest', [...q3.index].every((j, i) => {
        const d = c => (c[0] - i / 99) ** 2
        return q3.palette.every(c => d(q3.palette[j]) <= d(c) + 1e-9)
    }))
    ok('...and the same every time', JSON.stringify(quantize(g, 3)) === JSON.stringify(q3))
    ok('linear 0.5 is sRGB 188', Math.round(toSRGB(0.5) * 255) === 188)
    ok('one colour asked for: one', quantize(g, 1).palette.length === 1)
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
