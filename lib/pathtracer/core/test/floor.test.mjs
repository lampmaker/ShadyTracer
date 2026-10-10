// node lib/pathtracer/core/test/floor.test.mjs
//
// THE TOLERANCE'S f32 FLOOR (core/tolerances.js), MEASURED IN AN f32 EMULATION -- every operation through Math.fround,
// a shape's distance as the shader computes it: a sphere's length(p - c) - r, and a box turned by a matrix (the builder's
// transforms) with its max and min. Not a GPU: WGSL lets a GPU's sqrt be a few ulp where node's is exact (inferred from
// the spec, not measured), so this says what f32 itself allows -- the part no setting can buy back.
//
// WHAT THE FLOOR IS FOR, as measured here (2026-10-07): the NOISE in a normal by differences (the shade kernel's, for
// every shape without its own normal). Its angle from the same differences taken in double precision -- the curvature's
// own error is in both and cancels, so this is f32's alone -- at a step of K spacings of f32 at the point, the worst over
// 200 points, worst over spheres and turned boxes from a size a tenth of their distance from the origin to a third:
//     K = 1: ~700 mrad   4: ~150   16: ~44   64: ~11   128: ~5   256: ~2
// so below a hundred or so spacings a surface's shading is f32's pattern -- the "structure" a far or a finely set surface
// shows. A shape much smaller than its distance (0.2 mm at 1 m) has little of it at any K: its numbers are its own size.
// WHAT IT IS NOT FOR: the march's ending. In the same emulation every march ended within a few steps at a tolerance of a
// single spacing, every shape, every distance; so that is asserted as it is, and nothing more is claimed for it.
// WHAT IT COSTS: a tolerance set by hand finer than the floor is not given -- 15 um at 1 m from the origin -- and the
// normal of a part far smaller than that (a 0.2 mm sphere at 1 m) then carries the step's curvature error, smooth, about
// step / diameter. The automatic tolerance is above the floor within 6.5 times the scene's size of the origin, 65 m at
// most (the 1 mm cap); held below, as PRECISION.md says it.
import { f32Floor, marchTolAt, TOL_F32_STEPS, F32_STEP, TOL_MIN_M, MARCH_TOL_WGSL } from '../tolerances.js'
import { autoEps } from '../photometry.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }

const f = Math.fround
const ulp = x => { const a = new Float32Array([Math.abs(x)]), b = new Uint32Array(a.buffer); b[0]++; return a[0] - f(Math.abs(x)) }
// a turned frame, as the builder's transforms put one in (rows of a rotation, in f32)
const R = (() => { const a = 0.7, b = 0.4, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b)
    return [[ca, -sa * cb, sa * sb], [sa, ca * cb, -ca * sb], [0, sb, cb]].map(r => r.map(f)) })()
const RT = [0, 1, 2].map(i => [0, 1, 2].map(j => R[j][i]))
const mul32 = (M, v) => M.map(r => f(f(f(r[0] * v[0]) + f(r[1] * v[1])) + f(r[2] * v[2])))
const mul64 = (M, v) => M.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2])
const len32 = v => f(Math.sqrt(f(f(f(v[0] * v[0]) + f(v[1] * v[1])) + f(v[2] * v[2]))))
const SHAPES = {
    sphere: { d32: (p, c, r) => f(len32([f(p[0] - c[0]), f(p[1] - c[1]), f(p[2] - c[2])]) - f(r)),
              d64: (p, c, r) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - r },
    'turned box': {
        d32: (p, c, r) => { const q = mul32(RT, [f(p[0] - c[0]), f(p[1] - c[1]), f(p[2] - c[2])]).map(x => f(f(Math.abs(x)) - f(r)))
                            return f(len32(q.map(x => Math.max(x, 0))) + f(Math.min(Math.max(q[0], q[1], q[2]), 0))) },
        d64: (p, c, r) => { const q = mul64(RT, [p[0] - c[0], p[1] - c[1], p[2] - c[2]]).map(x => Math.abs(x) - r)
                            return Math.hypot(...q.map(x => Math.max(x, 0))) + Math.min(Math.max(...q), 0) } },
}
let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
const angle = (a, b) => Math.acos(Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b))))
/* march in f32 toward a shape of size r whose centre is D from the origin, tolerance K spacings at the point; then the
   normal by forward differences, step the same: { ended, worst angle from the double-precision differences } */
function trial(shape, D, r, K) {
    const S = SHAPES[shape], c = [f(D), f(0.37 * D), f(-0.21 * D)], tol = p => K * F32_STEP * Math.max(...p.map(Math.abs))
    let unended = 0, worst = 0
    for (let i = 0; i < 200; i++) {
        const u = 2 * rnd() - 1, t = 2 * Math.PI * rnd(), s = Math.sqrt(1 - u * u), n = [s * Math.cos(t), s * Math.sin(t), u]
        let p = c.map((x, k) => f(x + n[k] * 3 * r)), k = 0
        const dir = n.map(x => f(-x))
        for (; k < 300; k++) { const d = S.d32(p, c, r); if (Math.abs(d) < tol(p)) break; p = p.map((x, j) => f(x + f(dir[j] * f(d * 0.9)))) }
        if (k === 300) { unended++; continue }
        const h = f(tol(p)), d32 = S.d32(p, c, r), d64 = S.d64(p, c, r)
        const g32 = [0, 1, 2].map(a => { const q = p.slice(); q[a] = f(q[a] + h); return f(S.d32(q, c, r) - d32) })
        const g64 = [0, 1, 2].map(a => { const q = p.slice(); q[a] = q[a] + h; return S.d64(q, c, r) - d64 })
        worst = Math.max(worst, angle(g32, g64))
    }
    return { unended, worst }
}
// shapes as big as a third to a tenth of their distance from the origin: where f32's noise is worst
const BIG = [[0.3, 0.1], [1, 0.3], [100, 10], [1000, 50]]
for (const shape of Object.keys(SHAPES)) {
    const at = BIG.map(([D, r]) => trial(shape, D, r, TOL_F32_STEPS)), four = BIG.map(([D, r]) => trial(shape, D, r, 4))
    const w = Math.max(...at.map(o => o.worst)), w4 = Math.max(...four.map(o => o.worst))
    ok(`${shape}s a third to a tenth of their distance from the origin, 0.3 to 1000 m: the normal's f32 noise at the floor's step under 8 mrad (${(w * 1e3).toFixed(1)})`, w < 8e-3)
    ok(`...and at 4 spacings over 50 mrad (${(w4 * 1e3).toFixed(0)}): the noise the floor keeps out`, w4 > 50e-3)
    ok(`...every march ended, at the floor and at 4 spacings`, at.every(o => o.unended === 0) && four.every(o => o.unended === 0))
}
{
    // a part far smaller than its distance: little noise at any step -- its numbers are its own size
    const small = trial('sphere', 1, 0.0002, 4)
    ok(`a 0.2 mm sphere 1 m from the origin: little f32 noise even at 4 spacings (${(small.worst * 1e3).toFixed(2)} mrad)`, small.worst < 3e-3)
    // ...and the march ends at a single spacing too (the floor is not what makes it end)
    ok('the march ends at a single spacing as well, every shape and distance here', Object.keys(SHAPES).every(s => BIG.every(([D, r]) => trial(s, D, r, 1).unended === 0)))
}

// THE NUMBERS, and the shader's text generated from them
ok('the floor is 128 to 256 spacings of f32 at the point', [0.01, 0.3, 1, 7, 100].every(x => { const s = f32Floor([x, 0, 0]) / ulp(x); return s >= 128 && s < 256.0001 }))
ok('15 um at 1 m, 0.15 mm at 10 m, 1 mm at 65.5 m', Math.abs(f32Floor([1, 0, 0]) - 1.526e-5) < 1e-8 && Math.abs(f32Floor([10, 0, 0]) - 1.526e-4) < 1e-7
    && Math.abs(f32Floor([0, 0, -65.536]) - 1e-3) < 1e-6)
ok('the tolerance is the setting where the floor is below it, the floor where above, never under 1 nm',
    marchTolAt(1e-5, [0.02, 0, 0]) === 1e-5 && marchTolAt(1e-6, [100, 0, 0]) === f32Floor([100, 0, 0]) && marchTolAt(0, [0, 0, 0]) === TOL_MIN_M)
{
    // THE AUTOMATIC ONE AGAINST THE FLOOR (PRECISION.md, What it costs): above it within 6.5 times the scene's size of the
    // origin, not at 6.6; for a scene of 10 m or more the 1 mm cap, so 65 m and not 66
    const sizes = [0.01, 0.105, 1, 5, 9.9]
    ok('the automatic tolerance is above the floor within 6.5 sizes of the origin, below it at 6.6, scenes of 1 cm to 10 m',
        sizes.every(e => autoEps(e) > f32Floor([6.5 * e, 0, 0]) && autoEps(e) < f32Floor([6.6 * e, 0, 0])))
    ok('...and within 65 m for scenes of 10 m and more, not at 66 m', [10, 50, 400].every(e => autoEps(e) > f32Floor([65, 0, 0]) && autoEps(e) < f32Floor([66, 0, 0])))
    ok('...the RGBW mixer\'s 105 mm: the floor beyond 69 cm', autoEps(0.105) > f32Floor([0.68, 0, 0]) && autoEps(0.105) < f32Floor([0.70, 0, 0]))
}
ok('the shader\'s marchTol is made of the same numbers', MARCH_TOL_WGSL.includes(`${TOL_F32_STEPS}.0 * ${F32_STEP}`) && MARCH_TOL_WGSL.includes(`${TOL_MIN_M}`)
    && Math.fround(F32_STEP) === F32_STEP)

console.log(`floor: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
