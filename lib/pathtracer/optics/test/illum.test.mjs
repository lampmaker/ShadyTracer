// node lib/pathtracer/optics/test/illum.test.mjs
//
// Illuminance read off a map (optics/illum.js), without a GPU: profiles, the radial profile, encircled
// flux and isolux lines on maps with known answers, and the far field projected onto a plane against
// a Lambertian source's closed form, E = flux cos^4(gamma) / (pi h^2).
import { cellAt, cellSe, peak, centroid, profile, radial, encircled, isolux, intensityAt, virtualPlane } from '../illum.js'
import { intensity } from '../farfield.js'
import { detectorMap } from '../detmap.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol
const RAD = Math.PI / 180

/* A MAP MADE BY HAND: n x n cells of 1 unit over [-n/2, n/2]^2, E from a function of the cell centre */
const mapOf = (n, f, extra = {}) => {
    const E = new Float64Array(n * n), count = new Uint32Array(n * n)
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const a = -n / 2 + x + 0.5, b = -n / 2 + y + 0.5
        E[y * n + x] = f(a, b); count[y * n + x] = 100
    }
    return { E, count, nx: n, ny: n, cell: 1, range: { a: [-n / 2, n / 2], b: [-n / 2, n / 2] }, metresPerUnit: 1,
             smooth: 'none', ...extra }
}

{
    const m = mapOf(10, (a, b) => a + 2 * b + 50)
    ok('cellAt: the corner cell, and nothing off the map', cellAt(m, -4.9, -4.9)?.i === 0 && cellAt(m, 5.1, 0) === null)
    const pa = profile(m, 'a', [0.2, 1.5])
    ok('profile across: a row of 10, E rising by 1 a cell', pa.length === 10 && pa.every((p, k) => !k || near(p.y - pa[k - 1].y, 1, 1e-12)))
    ok('...at the row the point is in (b = 1.5: E = a + 53)', near(pa[0].y, -4.5 + 53, 1e-12))
    const pb = profile(m, 'b', [0.2, 1.5])
    ok('profile up: a column, E rising by 2', pb.length === 10 && near(pb[1].y - pb[0].y, 2, 1e-12))
    ok('a histogram cell\'s error is E / sqrt(hits)', near(cellSe(m, 7), m.E[7] / 10, 1e-12))
    ok('peak: the brightest cell\'s centre', near(peak(m)[0], 4.5, 1e-12) && near(peak(m)[1], 4.5, 1e-12))
}

{
    // a UNIFORM DISC of radius 20 on a fine map: encircled flux r^2 / R^2, r50 = R / sqrt 2, r90 = R sqrt 0.9
    const R = 20, m = mapOf(60, (a, b) => Math.hypot(a, b) <= R ? 1 : 0)
    const c = centroid(m)
    ok('centroid of a centred disc is the centre', near(c[0], 0, 1e-9) && near(c[1], 0, 1e-9))
    const f = encircled(m, [0, 0])
    ok('encircled: the total is the lit area (E 1, cells of 1 m^2)', near(f.total, Math.PI * R * R, 0.01 * Math.PI * R * R), `${f.total}`)
    ok('r50 = R / sqrt 2 to a cell', near(f.r50, R / Math.SQRT2, 1), `${f.r50}`)
    ok('r90 = R sqrt 0.9 to a cell', near(f.r90, R * Math.sqrt(0.9), 1), `${f.r90}`)
    ok('...and it rises from 0 to 1', f.points[0].y === 0 && near(f.points.at(-1).y, 1, 1e-12)
        && f.points.every((p, k) => !k || p.y >= f.points[k - 1].y))
    // cell centres are at half-integers, so an edge at r = 20 falls between rings; at 19.5 it cuts ring 19
    const r = radial(mapOf(60, (a, b) => Math.hypot(a, b) <= 19.5 ? 1 : 0), [0, 0])
    ok('radial: 1 inside, 0 well outside', near(r[5].y, 1, 1e-12) && r[25].y === 0)
    ok('...the ring holding the edge is partly lit', r[19].y > 0.2 && r[19].y < 1, `${r[19].y}`)
    ok('...rings past the map\'s nearest edge (30 away) are marked not full', r[10].full && r[29].full && !r[30].full)
    ok('...a ring\'s error is from all its hits together', near(r[5].se, 1 / Math.sqrt(100 * r[5].cells), 1e-12))
}

{
    // ISOLUX on a ramp E = a: the line at level L is a = L, straight up the map
    const m = mapOf(12, a => a)
    const [iso] = isolux(m, [1.25])
    ok('isolux: a segment in every row of squares', iso.segs.length === 11, `${iso.segs.length}`)
    ok('...every end on a = 1.25', iso.segs.every(s => near(s[0], 1.25, 1e-12) && near(s[2], 1.25, 1e-12)))
    const [none] = isolux(m, [100])
    ok('...and no line for a level the map never reaches', none.segs.length === 0)
    // a circle: E = -r; the -10 line has every end 10 from the centre, within the chord's sag
    const c = mapOf(40, (a, b) => -Math.hypot(a, b))
    const [circ] = isolux(c, [-10])
    ok('isolux of a cone: a closed ring at r = 10', circ.segs.length > 30
        && circ.segs.every(s => near(Math.hypot(s[0], s[1]), 10, 0.1) && near(Math.hypot(s[2], s[3]), 10, 0.1)))
    // a SADDLE: one square, the two high corners opposite; the centre decides which pairs connect
    // high at (0,0) and (1,1), low at (1,0) and (0,1): cell centres (0.5,0.5) (1.5,1.5) and (1.5,0.5) (0.5,1.5)
    const sad = { E: Float64Array.from([1, 0, 0, 1]), nx: 2, ny: 2, cell: 1, range: { a: [0, 2], b: [0, 2] } }
    const low = [[1.5, 0.5], [0.5, 1.5]], high = [[0.5, 0.5], [1.5, 1.5]]
    const cutsOff = (segs, near_, far_) => segs.every(s => {
        const mx = (s[0] + s[2]) / 2, my = (s[1] + s[3]) / 2, d = q => Math.hypot(mx - q[0], my - q[1])
        return Math.min(...near_.map(d)) < Math.min(...far_.map(d))
    })
    const [s1] = isolux(sad, [0.4])                        // centre 0.5, above the level: the high corners join
    ok('saddle, centre above: two segments, each cutting off a LOW corner', s1.segs.length === 2 && cutsOff(s1.segs, low, high))
    const [s2] = isolux(sad, [0.6])                        // centre 0.5, below: the low corners join
    ok('saddle, centre below: each cutting off a HIGH corner', s2.segs.length === 2 && cutsOff(s2.segs, high, low))
}

{
    // THE DETECTOR MAP gives what these need: its unit conversion, and its noise
    const hits = []
    for (let i = 0; i < 4000; i++) hits.push({ pos: [(i % 63) / 63 * 10, Math.floor(i / 63) / 63 * 10, 0], flux: 1 / 4000, tag: 1 })
    const m = detectorMap(hits, { cells: 16, metresPerUnit: 0.01 })
    ok('detectorMap reports its metres per unit', m.metresPerUnit === 0.01)
    ok('...and encircled flux gets back the flux that landed', near(encircled(m, centroid(m)).total, 1, 1e-9))
}

{
    // THE VIRTUAL PLANE under a Lambertian source: E(0) = flux / (pi h^2), E = E0 cos^4 gamma
    const nC = 72, nG = 181, flux = 1000, dG = 1
    const f = new Float64Array(nC * nG)
    for (let j = 0; j < nG; j++) {
        const lo = Math.max(0, (j - 0.5) * dG) * RAD, hi = Math.min(180, (j + 0.5) * dG) * RAD
        const F = g => g >= Math.PI / 2 ? 1 : Math.sin(g) ** 2
        for (let i = 0; i < nC; i++) f[j * nC + i] = flux * (F(hi) - F(lo)) / nC
    }
    const far = { nC, nG, flux: f, se: null, emitted: flux, unit: 'lm' }
    const R = intensity(far)
    ok('intensityAt: I(30 deg) = (flux / pi) cos 30 between bins', near(intensityAt(R, 30.5, 17).I, flux / Math.PI * Math.cos(30.5 * RAD), 0.5))
    const h = 2, m = virtualPlane(far, R, { h, half: 2, cells: 41 })
    const E0 = flux / (Math.PI * h * h)
    const mid = m.E[20 * 41 + 20]
    ok('virtual plane: E below the source = flux / (pi h^2)', near(mid, E0, E0 * 2e-3), `${mid} vs ${E0}`)
    // the cell centred at a = 2 - cell/2 on the middle row: gamma = atan(a / h)
    const x = 40, a = -2 + (x + 0.5) * m.cell, g = Math.atan2(a, h)
    ok('...and E0 cos^4 gamma off the axis', near(m.E[20 * 41 + x], E0 * Math.cos(g) ** 4, E0 * 3e-3), `${m.E[20 * 41 + x]} vs ${E0 * Math.cos(g) ** 4}`)
    ok('...in lux, axes C0 and C90', m.unit === 'lx' && m.axisNames[0] === 'C0')
    const auto = virtualPlane(far, R, { h })
    ok('auto size: a Lambertian source reaches past 80 deg, so the plane is h tan 80 wide', near(auto.range.a[1], h * Math.tan(80 * RAD), 1e-9))
    // the flux on a plane square of half-width s under a Lambertian source is below the flux within
    // the cone through its corners and above the one through its edges' middles
    const s2 = virtualPlane(far, R, { h, half: h, cells: 200 })
    const inner = flux * Math.sin(Math.atan(1)) ** 2, outer = flux * Math.sin(Math.atan(Math.SQRT2)) ** 2
    ok('...the flux on a finite plane is between the cones through its edges and corners', s2.total > inner && s2.total < outer,
        `${s2.total} (${inner}..${outer})`)
}

// WHAT A MAP COVERS: a detector's box, and a zoom of it -- on a floor (world axes, shown from the
// world's origin), with a small spot on a large screen, which is what the zoom is for
{
    const { rangeOfPoints, rangeOfView, displayOffset } = await import('../illum.js')
    let s = 11
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
    // a spot of radius about 0.1 at (5, 3) on a 4 x 4 floor centred on (5, 3), z = 0
    const hits = Array.from({ length: 20000 }, () => {
        const r = 0.1 * Math.sqrt(rnd()), t = 2 * Math.PI * rnd()
        return { pos: [5 + r * Math.cos(t), 3 + r * Math.sin(t), 0], flux: 1 / 20000, tag: 1 }
    })
    const floor = [0, 1, 2, 3, 4, 5, 6, 7].map(c => [c & 1 ? 7 : 3, c & 2 ? 5 : 1, c & 4 ? 0.01 : -0.01])
    const lit = detectorMap(hits, { cells: 40, metresPerUnit: 1 })
    const whole = detectorMap(hits, { cells: 40, metresPerUnit: 1, range: rangeOfPoints(floor) })
    const [oa, ob] = displayOffset(whole)
    ok('the whole detector: the map spans the floor\'s box, not the spot', Math.abs(whole.range.a[0] + oa - 3) < 1e-9 && Math.abs(whole.range.a[1] + oa - 7) < 1e-9
        && Math.abs(whole.range.b[0] + ob - 1) < 1e-9, JSON.stringify(whole.range) + ` +${oa},${ob}`)
    ok('...shown in the world\'s x and y', whole.axisNames?.join() === 'x,y')
    ok('...and all the flux is on it', Math.abs(whole.total - 1) < 1e-9)
    ok('the lit area alone is the spot', lit.range.a[1] - lit.range.a[0] < 0.21)
    // A ZOOM onto the spot, in what the map shows (x 4.9..5.1, y 2.9..3.1)
    const z = detectorMap(hits, { cells: 40, metresPerUnit: 1, range: rangeOfView({ a: [4.9, 5.1], b: [2.9, 3.1] }) })
    const [za, zb] = displayOffset(z)
    ok('a zoom: the map is the rectangle asked for, in what the map shows', Math.abs(z.range.a[0] + za - 4.9) < 1e-9 && Math.abs(z.range.b[1] + zb - 3.1) < 1e-9)
    ok('...its cells are the zoom\'s share of the whole map\'s', Math.abs(z.cell - 0.2 / 40) < 1e-12 && Math.abs(whole.cell - 4 / 40) < 1e-12, `${z.cell} ${whole.cell}`)
    // the spot is 1 lm over pi 0.1^2 m^2: 31.8 lx inside it. Its lit cells now lie inside it, so they read that,
    // where the whole floor's 0.1 cells straddle its edge and read less
    const inSpot = 1 / (Math.PI * 0.01)
    ok('...the zoomed cells read the spot\'s own illuminance', Math.abs(z.meanLit - inSpot) / inSpot < 0.15, `${z.meanLit} vs ${inSpot}`)
    ok('...where the whole floor\'s cells, straddling its edge, read less', whole.meanLit < 0.8 * inSpot, `${whole.meanLit}`)
    // a zoom of part of the spot: the hits outside it are in no cell, and not counted as sampling its cells
    const half = detectorMap(hits, { cells: 40, metresPerUnit: 1, range: rangeOfView({ a: [5.0, 5.1], b: [2.9, 3.1] }) })
    ok('a zoom counts only its own hits (about half the spot here)', half.hits > 8000 && half.hits < 12000, `${half.hits}`)
    ok('...so its hits per cell are its own, not the whole spot\'s over its cells', Math.abs(half.hitsPerLitCell - half.hits / half.litCells) < 1e-9)
    ok('...and its flux is the flux in it', Math.abs(half.total - half.hits / 20000) < 1e-9)
}

console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
