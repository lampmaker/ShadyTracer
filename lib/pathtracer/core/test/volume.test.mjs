//======================================================================================================================
// SCATTER INSIDE A MATERIAL, no GPU (0.next; core/haze.js THE MEDIUM'S WALK, roadmap/DIFFUSERS.md A). Run:
//   node lib/pathtracer/core/test/volume.test.mjs
//
// The march walks a ray through a scattering material: a free flight -ln(1 - u) / sigma a leg, Henyey-Greenstein's turn
// at each collision, every collision weighing 1. Its JS mirror (haze.js slabWalkJS) is held here to what radiative
// transfer says without it, for a slab whose faces do nothing (index-matched), lit head-on:
//   - what never collides is exp(-tau), exactly: Beer-Lambert for the ballistic part;
//   - nothing is made or lost: what goes through and what comes back add to 1;
//   - deep in the slab, the diffusion regime: T (tau + 2 q) the same at every depth, q = 0.7104 the Milne problem's
//     extrapolation length for isotropic scattering -- what makes a thick part milkier than a thin one, and by how much;
//   - forward scattering passes more than isotropic at one depth, and Henyey-Greenstein's mean cosine is g;
// and THE MEDIUM AS A RAY CARRIES IT (tracebasics.js packMedium: six f16 in three words, per millimetre): what the
// packing does to an absorption and a scattering coefficient over the range a material can ask for, bounded, and what
// that does to exp(-mu L) over the lengths a scene has. The march's own walk against this mirror is test/volume.gpu.mjs.
//======================================================================================================================
import { slabWalkJS, hgSampleJS, f16JS, packMediumJS, HAZE_G_MAX } from '../haze.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const se = (p, n) => Math.sqrt(Math.max(p * (1 - p), 1e-12) / n)

// THE BALLISTIC PART, AND NOTHING LOST
for (const [tau, g] of [[0.3, 0], [1, 0], [2, 0.8], [3, -0.4]]) {
    const N = 200000, r = slabWalkJS({ tau, g, rays: N, seed: 11 })
    ok(`a slab of optical depth ${tau}, g ${g}: what never collided is exp(-tau) (${r.ballistic.toFixed(5)} against ${Math.exp(-tau).toFixed(5)})`,
        Math.abs(r.ballistic - Math.exp(-tau)) < 4 * se(Math.exp(-tau), N))
    ok(`...and through plus back is all of it (${(r.T + r.R).toFixed(6)})`, Math.abs(r.T + r.R - 1) < 1e-12)
}

/* THE DIFFUSION REGIME: for isotropic scattering T(tau) -> C / (tau + 2 q) as tau grows, q = 0.7104 (the Milne problem's
   extrapolation length, in mean free paths) -- so T (tau + 2 q) must stop depending on tau. At 10, 20 and 40 mean free
   paths; the spread allowed is the walk's own noise and the next term's (1 / tau^2 against 1 / tau). */
{
    const q = 0.7104, rows = []
    for (const [tau, N] of [[10, 200000], [20, 200000], [40, 120000]]) {
        const r = slabWalkJS({ tau, g: 0, rays: N, seed: 12 })
        rows.push({ tau, c: r.T * (tau + 2 * q), e: se(r.T, N) * (tau + 2 * q), steps: r.steps })
    }
    const ref = rows[1].c
    ok(`deep in a slab, T (tau + 2 q) stops depending on depth: ${rows.map(x => `${x.tau}: ${x.c.toFixed(4)}`).join(', ')}`,
        rows.every(x => Math.abs(x.c - ref) < 4 * Math.hypot(x.e, rows[1].e) + 0.01 * ref))
    /* ...and the collisions a ray takes grow with the depth (those it walks through take about tau^2, those it comes back
       by few): the walk's cost, in march steps against Max Iterations */
    ok(`...a ray's collisions grow with the depth: ${rows.map(x => `${x.tau}: ${x.steps.toFixed(1)}`).join(', ')}`,
        rows[2].steps > 1.5 * rows[1].steps && rows[1].steps > 1.5 * rows[0].steps)
}

// FORWARD SCATTERING passes more than isotropic at one depth; Henyey-Greenstein's mean cosine is g
{
    const a = slabWalkJS({ tau: 3, g: 0, rays: 100000, seed: 13 }), b = slabWalkJS({ tau: 3, g: 0.8, rays: 100000, seed: 13 })
    ok(`at depth 3, g 0.8 passes more than g 0 (${b.T.toFixed(4)} against ${a.T.toFixed(4)})`, b.T > a.T + 0.1)
    let s0 = 0, s1 = 0
    const N = 400000
    let x = 7                                                // mulberry32, as the walk's
    const rnd = () => { x = (x + 0x6D2B79F5) >>> 0; let t = Math.imul(x ^ (x >>> 15), x | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
    for (let k = 0; k < N; k++) { s0 += hgSampleJS([0, 0, 1], 0.7, [rnd(), rnd()])[2]; s1 += hgSampleJS([0, 0, 1], -0.3, [rnd(), rnd()])[2] }
    ok(`Henyey-Greenstein's draw has the mean cosine g (${(s0 / N).toFixed(4)} at 0.7, ${(s1 / N).toFixed(4)} at -0.3)`,
        Math.abs(s0 / N - 0.7) < 0.005 && Math.abs(s1 / N + 0.3) < 0.005)
}

/* THE MEDIUM PACKED (tracebasics.js packMedium): per millimetre in f16. f16's normal range is 6.1e-5 to 65504 with 11 bits
   (a relative 2^-11 = 4.9e-4 at most from the nearest), and below 6.1e-5 subnormals of step 6e-8; so per millimetre:
   - an absorption: a colour depth from 0.01 mm (a dense dye, -ln 1e-6 / 0.01 = 1382 per mm) to 10 km;
   - a scattering coefficient: a free path from 0.0154 mm (65000 per mm, the clamp) up.
   What matters is exp(-mu L): its error is |d mu| L, so it is bounded where it is used, over lengths up to 10 m. */
{
    let worstRel = 0, worstExp = 0
    for (let k = 0; k <= 400; k++) {
        const muPerM = 10 ** (-4 + 10 * k / 400)               // 1e-4 to 1e6 per metre: 10 km to 1 um colour depths
        const got = packMediumJS([muPerM, muPerM, muPerM], muPerM, 0).mu[0]
        const rel = Math.abs(got - muPerM) / muPerM
        if (muPerM * 1e-3 >= 2 ** -14) worstRel = Math.max(worstRel, rel)
        for (const L of [1e-3, 0.1, 1, 10]) {                 // metres travelled
            if (muPerM * L > 50) continue                     // nothing left to be wrong about
            worstExp = Math.max(worstExp, Math.abs(Math.exp(-got * L) - Math.exp(-muPerM * L)))
        }
    }
    ok(`an absorption packed, in f16's normal range, is within 2^-11 of itself (worst ${worstRel.toExponential(2)})`, worstRel <= 2 ** -11 * 1.0001)
    /* ...the worst is a weak absorber in f16's subnormals, whose half step is 2^-25 per mm: over 10 m, 3.0e-4 of exponent
       (a 10 km colour depth read as 10.3 km). Above them, 2^-12 of mu L. */
    ok(`...and exp(-mu L) over 1 mm to 10 m changes by no more than the subnormals' half step over 10 m, 3.0e-4 (worst ${worstExp.toExponential(2)})`,
        worstExp <= 2 ** -25 * 1e4 * 1.01)
    const s = packMediumJS([0, 0, 0], 1 / 0.002, 0.7)        // a free path of 2 mm
    ok(`a scattering coefficient packed: 2 mm's ${(1 / 0.002).toFixed(1)} per metre reads ${s.sigma.toFixed(2)}`, Math.abs(s.sigma * 0.002 - 1) < 5e-4)
    ok(`...g within f16's step of itself (0.7 reads ${s.g}), and held to +-${HAZE_G_MAX}`, Math.abs(s.g - 0.7) < 5e-4
        && packMediumJS([0, 0, 0], 1, 0.99).g <= HAZE_G_MAX + 1e-3 && packMediumJS([0, 0, 0], 1, -0.99).g >= -HAZE_G_MAX - 1e-3)
    ok('...a clear medium packs to nothing, and nothing reads as nothing', packMediumJS([0, 0, 0], 0, 0).sigma === 0 && f16JS(0) === 0)
    ok('...and a free path shorter than 0.0154 mm is held at 65000 per mm, not lost as an infinity',
        Number.isFinite(packMediumJS([0, 0, 0], 1e9, 0).sigma) && packMediumJS([0, 0, 0], 1e9, 0).sigma > 6e7)
}

console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
