//======================================================================================================================
// Tests for the STL reader (stl.js) and the surfaces found in a mesh (fit.js). Run: node import/test/stl.test.mjs
//
// The meshes are OpenCascade's tessellations of the fixtures (fixtures/make.py, export tolerance 0.02 mm), so the
// surfaces fit.js should find in each are exactly the faces OpenCascade reports for the solid it tessellated: a hole
// that was a polygon in the STL is a cylinder again, a fillet a torus. The converted part is then held to OpenCascade's
// classified points beyond the mesh's own error -- within a few hundredths of a millimetre of a curved face the STL
// does not know where the surface is (the band), and a point there is not counted.
// The fitters are held to surfaces given exactly; the reader to binary and ASCII of one mesh, a binary file that
// begins with "solid", a mesh turned inside out and one with a hole in it.
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { readSTL } from '../stl.js'
import { meshSolid, meshInside, fitCylinder, fitCone, fitSphere, fitTorus } from '../fit.js'
import { toCSG } from '../csg.js'
import { shapesOf, shapeSDF } from '../shapes.js'
import { frame, cylinder, cone, sphere, torus, norm, add, mul } from '../geom.js'
import { mulberry } from '../brep.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const fixture = n => new URL(`./fixtures/${n}`, import.meta.url)
const PARTS = ['plate', 'bracket', 'boss', 'lens', 'roundbox']

/* a mesh back into STL: binary (with a header of our choosing) and ASCII */
function binary(m, header = '') {
    const n = m.triangles.length / 3, buf = new ArrayBuffer(84 + 50 * n), dv = new DataView(buf)
    new Uint8Array(buf).set(new TextEncoder().encode(header.slice(0, 80)))
    dv.setUint32(80, n, true)
    for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++)
        dv.setFloat32(84 + 50 * t + 12 + 12 * k + 4 * c, m.positions[3 * m.triangles[3 * t + k] + c], true)
    return new Uint8Array(buf)
}
function ascii(m) {
    const out = ['solid test part']
    for (let t = 0; t < m.triangles.length; t += 3) {
        out.push('  facet normal 0 0 0', '    outer loop')
        for (let k = 0; k < 3; k++) { const i = m.triangles[t + k]; out.push(`      vertex ${m.positions[3 * i]} ${m.positions[3 * i + 1]} ${m.positions[3 * i + 2]}`) }
        out.push('    endloop', '  endfacet')
    }
    out.push('endsolid test part')
    return new TextEncoder().encode(out.join('\n'))
}

// THE READER
{
    const ref = JSON.parse(readFileSync(fixture('plate.json'), 'utf8'))
    const m = readSTL(readFileSync(fixture('plate.stl')))
    ok('plate.stl: closed, no warnings', m.open === 0 && !m.warnings.length, JSON.stringify(m.warnings))
    ok('...its volume OpenCascade\'s within the tessellation (0.1%)', Math.abs(m.volume - ref.volume) / ref.volume < 1e-3, `${m.volume} ${ref.volume}`)
    // V - E + F = 2 - 2g with E = 3F/2; the plate's genus is its four through-holes (the pocket is blind)
    ok('...welded: each vertex shared (half as many vertices as triangles, + 2 - 2 x 4 for its four holes)',
       m.positions.length / 3 === m.triangles.length / 6 + 2 - 2 * 4, `${m.positions.length / 3} vertices, ${m.triangles.length / 3} triangles`)
    const a = readSTL(ascii(m))
    ok('the same mesh as ASCII: the same triangles, the same volume, its name read', a.triangles.length === m.triangles.length
        && Math.abs(a.volume - m.volume) < 1e-9 * m.volume && a.name === 'test part', `${a.triangles.length} ${a.volume} '${a.name}'`)
    const b = readSTL(binary(m, 'solid but binary'))
    ok('a binary file whose header begins with "solid": read as binary by its size', b.triangles.length === m.triangles.length && Math.abs(b.volume - m.volume) < 1e-6 * m.volume)
    const inv = { positions: m.positions, triangles: m.triangles.slice() }
    for (let i = 0; i < inv.triangles.length; i += 3) { const x = inv.triangles[i + 1]; inv.triangles[i + 1] = inv.triangles[i + 2]; inv.triangles[i + 2] = x }
    const r = readSTL(binary(inv))
    ok('a mesh wound inside out: turned to face out', r.volume > 0 && Math.abs(r.volume - m.volume) < 1e-6 * m.volume)
    const holed = { positions: m.positions, triangles: m.triangles.slice(3) }
    const h = readSTL(binary(holed))
    ok('a mesh missing a triangle: three open edges, and said', h.open === 3 && h.warnings.some(w => /not closed/.test(w)), JSON.stringify([h.open, h.warnings]))
    let msg = ''
    try { meshSolid(h) } catch (e) { msg = e.message }
    ok('...and refused as a solid: no inside to convert', /not closed/.test(msg), msg)
    try { readSTL(new TextEncoder().encode('hello')); msg = '' } catch (e) { msg = e.message }
    ok('neither binary nor ASCII STL: said', /not an STL file/.test(msg), msg)
}

// THE FITTERS, on surfaces given exactly: points on them, and for the cone and torus the normal lines
{
    const rnd = mulberry(3)
    const on = (S, n) => {
        const P = [], L = []
        for (let i = 0; i < n; i++) {
            const u = rnd() * 2 * Math.PI, v = S.type === 'torus' ? -1 + 2 * rnd() : S.type === 'sphere' ? -1.2 + 2.4 * rnd() : -2 + 4 * rnd()
            const p = S.at(u, v)
            P.push(p); L.push({ c: p, n: S.grad(p) })
        }
        return { P, L }
    }
    const F = frame([1, -2, 0.5], norm([0.3, 0.4, 0.86]), [1, 0, 0])
    const Y = cylinder(F, 1.7), { P: py, L: ly } = on(Y, 60)
    const y = fitCylinder(py, ly.map(l => l.n))
    ok('a cylinder found again: its radius and its axis', y && Math.abs(y.r - 1.7) < 1e-9 && Math.abs(Math.abs(y.F.z[0] * F.z[0] + y.F.z[1] * F.z[1] + y.F.z[2] * F.z[2]) - 1) < 1e-12)
    const K = cone(F, 2, 0.4), { P: pk, L: lk } = on(K, 80)
    const k = fitCone(pk, lk)
    ok('a cone found again: every point on it to a nanometre', k && pk.every(p => Math.abs(k.g(p)) < 1e-6), k && Math.max(...pk.map(p => Math.abs(k.g(p)))))
    const S = sphere(F, 3.3), { P: ps } = on(S, 40)
    const s = fitSphere(ps)
    ok('a sphere found again', s && Math.abs(s.r - 3.3) < 1e-9 && Math.hypot(s.F.o[0] - 1, s.F.o[1] + 2, s.F.o[2] - 0.5) < 1e-9)
    const T = torus(F, 5, 1.2), { P: pt, L: lt } = on(T, 120)
    const t = fitTorus(pt, lt)
    ok('a torus found again: its radii', t && Math.abs(t.R - 5) < 1e-7 && Math.abs(t.r - 1.2) < 1e-7, t && `${t.R} ${t.r}`)
    void add; void mul
}

// THE FIXTURES: the surfaces OpenCascade tessellated, found again, and the part they make
for (const n of PARTS) {
    const ref = JSON.parse(readFileSync(fixture(`${n}.json`), 'utf8'))
    const m = readSTL(readFileSync(fixture(`${n}.stl`)))
    const B = meshSolid(m)
    const kinds = {}
    for (const f of B.faces) kinds[f.surface.type] = (kinds[f.surface.type] || 0) + 1
    ok(`${n}.stl: the faces OpenCascade's solid has, by surface`, JSON.stringify(Object.entries(kinds).sort()) === JSON.stringify(Object.entries(ref.kinds).sort()),
       `${JSON.stringify(kinds)} against ${JSON.stringify(ref.kinds)}`)
    ok(`${n}.stl: its band (how far the facets stray from the surfaces) no more than the export tolerance and a little`, B.band < 0.05, B.band)
    const away = ref.points.filter(([, , , , d]) => d > 2.5 * B.band)
    let bad = 0
    for (const [x, y, z, c] of away) if ((B.inside([x, y, z]) ? 1 : 0) !== c) bad++
    ok(`${n}.stl: inside the mesh where OpenCascade says, at all ${away.length} points off the band`, bad === 0, `${bad} disagree`)
    const C = toCSG(B), ir = shapesOf(C)
    ok(`${n}.stl: converted clean`, C.report.conflicts === 0 && C.report.uncovered === 0 && C.report.mismatches === 0, JSON.stringify(C.report))
    bad = 0
    for (const [x, y, z, c] of away) if ((shapeSDF(ir.root, [x, y, z]) < 0 ? 1 : 0) !== c) bad++
    ok(`${n}.stl: the shapes on OpenCascade's side at every point off the band`, bad === 0, `${bad} disagree`)
}

// A MESH THAT IS NO CAD PART: a sphere's facets with its vertices moved off it, as a scan's would be. Nothing fits,
// every facet is a plane, and the conversion refuses it by its size rather than build a formula of all of them
{
    const pos = [], tri = []
    const n = 24, m = 48, rnd = mulberry(9)
    const id = (i, j) => i === 0 ? 0 : i === n ? 1 : 2 + (i - 1) * m + (j % m)
    const put = (th, ph) => { const r = 10 * (1 + 0.01 * (rnd() - 0.5)); pos.push(r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)) }
    put(0, 0); put(Math.PI, 0)
    for (let i = 1; i < n; i++) for (let j = 0; j < m; j++) put(Math.PI * i / n, 2 * Math.PI * j / m)
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
        const a = id(i, j), b = id(i, j + 1), c = id(i + 1, j), d = id(i + 1, j + 1)
        if (i > 0) tri.push(a, c, b)
        if (i < n - 1) tri.push(b, c, d)
    }
    const mesh = { positions: Float64Array.from(pos), triangles: Uint32Array.from(tri), open: 0 }
    const B = meshSolid(mesh)
    ok('a scan-like sphere: no curved surface found in it', B.fitted.curved === 0, JSON.stringify(B.fitted))
    let msg = ''
    try { toCSG(B) } catch (e) { msg = e.message }
    ok('...and refused by its number of faces, saying it is not a CAD part', /more than \d+/.test(msg) && /scan or a sculpt/.test(msg), msg)
    const inside = meshInside(mesh)
    ok('...its inside still known (the mesh\'s parity)', inside([0, 0, 0]) && inside([5, 3, 2]) && !inside([12, 0, 0]) && !inside([0, 0, -10.2]))
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
