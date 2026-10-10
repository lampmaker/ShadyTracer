// node lib/pathtracer/optics/test/optics.test.mjs
//
// The optics module's arithmetic, without a GPU: the source's direction sampling (sampleCos, the JS
// mirror of prog_opt_gen) against closed forms, the source uniforms, and the tally decoding --
// fixed point with a hand-made carry, which is exactly the kind of thing that is right for small
// numbers and wrong past 2^32.
import { sampleCos, coneShare, sourceRecords, defaultSource, fluxPerRay, DISTRIBUTIONS, placeRays, hue } from '../sources.js'
import { fresnel, slabT, twoSlabT, refract, wedgeExitDeg, absorbingSlabT, tintedSlabT, coatedSlabT } from '../fresnel.js'
import { LUMA } from '../../core/photometry.js'
import { RAYSET_VEC4 } from '../kernels.js'
import { readTallies } from '../index.js'
import { makeEstimate } from '../estimate.js'
import { detectorMap, eigenSym3, turbo, KNN_MAX_CELLS, cellColour } from '../detmap.js'
import { xyToXYZ, XYZtoxy, xyToUpVp, cctDuvToXy } from '../../core/colorimetry.js'
import { OPT_FX, O_FLUX, O_COUNT, O_TAG, O_MAT, O_PARK, F_ESCAPED, F_LOST, C_ESCAPED, OPT_TALLY_WORDS,
         optDataWords, O_PATHS, VERT_WORDS, DET_WORDS, detBase, F_DETECTED, C_DETECTED, O_DETN, SRC_VEC4 } from '../kernels.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol

// stratified u: exact enough to test means to 1e-4 without noise
const N = 200000
const us = Array.from({ length: N }, (_, i) => (i + 0.5) / N)
const mean = f => us.reduce((a, u) => a + f(u), 0) / N

{
    const L = DISTRIBUTIONS.cosine
    ok('Lambertian (cos^1 over the hemisphere): mean cos is 2/3',
        near(mean(u => sampleCos(L, u, 0, 1)), 2 / 3, 1e-4), `${mean(u => sampleCos(L, u, 0, 1))}`)
    ok('cos^5 over the hemisphere: mean cos is (n+1)/(n+2) = 6/7',
        near(mean(u => sampleCos(L, u, 0, 5)), 6 / 7, 1e-4))
    const c60 = Math.cos(Math.PI / 3)
    ok('Lambertian: 3/4 of the flux within 60 degrees (1 - cos^2 60)',
        near(coneShare(L, 0, 1, c60), 0.75, 1e-12))
    ok('...and the sampler puts exactly that share there',
        near(us.filter(u => sampleCos(L, u, 0, 1) >= c60).length / N, 0.75, 1e-4))
    const c30 = Math.cos(Math.PI / 6)
    ok('cos^n within a 30-degree cone never leaves it',
        us.every(u => sampleCos(L, u, c30, 3) >= c30 - 1e-12))
}
{
    const U = DISTRIBUTIONS.uniform, c20 = Math.cos(20 * Math.PI / 180), c10 = Math.cos(10 * Math.PI / 180)
    ok('uniform cone: stays inside', us.every(u => sampleCos(U, u, c20, 1) >= c20 - 1e-12))
    ok('uniform cone: equal solid angle, equal share (10 of 20 degrees: (1-cos10)/(1-cos20))',
        near(us.filter(u => sampleCos(U, u, c20, 1) >= c10).length / N, (1 - c10) / (1 - c20), 1e-4))
    ok('collimated: straight along the axis', sampleCos(DISTRIBUTIONS.collimated, 0.37, 0, 1) === 1)
}
{
    // THE SOURCE TABLE: one record of SRC_VEC4 vec4s a source, picked by flux
    const R = SRC_VEC4 * 4
    const t = sourceRecords([{ ...defaultSource(), axis: [0, 0, -5], u: [0, 0, 1], flux: 300 },
                             { ...defaultSource(), type: 'disc', flux: 100, emitN: 1.41, twoSided: true },
                             { ...defaultSource(), flux: 0 }])
    ok('a source with no flux is left out', t.count === 2 && Math.abs(t.flux - 400) < 1e-9)
    ok('the cdf is the cumulative flux share, the last exactly 1', Math.abs(t.data[3] - 0.75) < 1e-7 && t.data[R + 3] === 1)
    ok('the axis is normalised', near(Math.hypot(t.data[4], t.data[5], t.data[6]), 1, 1e-6))
    const d = t.data[8] * t.data[4] + t.data[9] * t.data[5] + t.data[10] * t.data[6]
    ok('a tangent along the axis is replaced by one across it', Math.abs(d) < 0.99, `dot ${d}`)
    ok('a 90-degree cone is the hemisphere (cos 0)', near(t.data[14], 0, 1e-7))
    ok('shape, medium and faces are in the record', t.data[R + 7] === 1 && near(t.data[R + 16], 1.41, 1e-6) && t.data[R + 17] === 1)
    ok('no sources: an empty table, still a buffer to bind', sourceRecords([]).count === 0 && sourceRecords([]).data.length === R)
    ok('flux per ray is the total over the rays', fluxPerRay(1000, 4000) === 0.25)
}
{
    // a tally readback with known contents, including a low word that wrapped
    const a = new Uint32Array(OPT_TALLY_WORDS)
    const put = (slot, w) => { const v = Math.round(w * OPT_FX); a[slot] = v % 4294967296; a[slot + 1] = Math.floor(v / 4294967296) }
    put(O_FLUX + F_ESCAPED * 2, 12.5)
    put(O_FLUX + F_LOST * 2, 5000.25)                 // 5000 * 2^20 > 2^32: the carry matters
    a[O_COUNT + C_ESCAPED] = 7
    a[O_PARK] = 3
    put(O_TAG + 2 * 5, 10); put(O_TAG + 2 * 5 + 2, 4); a[O_TAG + 2 * 5 + 4] = 9
    put(O_MAT + 5 * 5, 1); a[O_MAT + 5 * 5 + 4] = 1
    put(O_FLUX + F_DETECTED * 2, 3.5); a[O_COUNT + C_DETECTED] = 4; a[O_DETN] = 4
    const t = readTallies(a, ['a', 'b'])
    ok('detected flux, count and hits decode', near(t.detected, 3.5, 1e-6) && t.counts.detected === 4 && t.detectorHits === 4)
    ok('escaped decodes', near(t.escaped, 12.5, 1e-6), `${t.escaped}`)
    ok('a sum past 2^32 fixed-point units keeps its carry', near(t.lost, 5000.25, 1e-6), `${t.lost}`)
    ok('counts and parked decode', t.counts.escaped === 7 && t.parked === 3)
    ok('only objects that were hit are listed', t.objects.length === 1 && t.objects[0].index === 2)
    ok('absorbed is incident - leaving', near(t.objects[0].absorbed, 6, 1e-6))
    ok('an object is named by its tag (tag n is tags[n-1])', t.objects[0].name === 'b')
    ok('materials decode too', t.materials.length === 1 && t.materials[0].index === 5 && near(t.materials[0].incident, 1, 1e-6))
}
ok('the path area follows the tallies: a count per ray, then 8-word vertices',
    optDataWords(10, 4) === O_PATHS + 10 + 10 * 4 * VERT_WORDS && VERT_WORDS === 8)
ok('the detector hits follow the paths, 8 words each',
    detBase(10, 4) === optDataWords(10, 4) && optDataWords(10, 4, 5) === detBase(10, 4) + 5 * DET_WORDS)

{
    // THE DETECTOR MAP. First the eigen-decomposition it fits the plane with: A v = lambda v
    const A = [[4, 1, 0.5], [1, 3, 0.2], [0.5, 0.2, 1]]
    const e = eigenSym3(A)
    const res = e.vectors.map((v, k) => Math.hypot(...[0, 1, 2].map(i => A[i][0] * v[0] + A[i][1] * v[1] + A[i][2] * v[2] - e.values[k] * v[i])))
    ok('eigenSym3: A v = lambda v for all three, largest first',
        res.every(r => r < 1e-9) && e.values[0] >= e.values[1] && e.values[1] >= e.values[2], res.join())

    // a uniformly lit square 2 x 2 units at z = 5, 1 lm over 40 000 hits, in a cm scene:
    // E = 1 lm / (0.02 m)^2 = 2500 lx everywhere
    const hits = []
    for (let i = 0; i < 200; i++) for (let j = 0; j < 200; j++)
        hits.push({ pos: [-1 + (i + 0.5) / 100, -1 + (j + 0.5) / 100, 5], flux: 1 / 40000, dir: [0, 0, -1], tag: 1 })
    // over the square's known extent: the hits' own box is half a spacing short on each side
    const range = { a: [-1, 1], b: [-1, 1] }
    const m = detectorMap(hits, { cells: 20, metresPerUnit: 0.01, unit: 'lm', range })
    ok('map: a floor is laid out along x and y', m.axisNames?.join() === 'x,y' && Math.abs(m.normal[2]) === 1)
    ok('map: square cells over the hits, 20 along the longer side', m.nx === 20 && m.ny === 20)
    ok('map: uniform light reads the same E in every cell, in lux', Math.abs(m.max - 2500) < 1e-6 && Math.abs(m.minLit - 2500) < 1e-6,
        `${m.max} ${m.minLit}`)
    ok('map: the total is the flux that landed', Math.abs(m.total - 1) < 1e-9 && Math.abs(m.uniformity - 1) < 1e-9)
    ok('map: flat', m.flatness < 1e-9)
    ok('map: a source in watts maps in W/m^2', detectorMap(hits, { unit: 'W' }).unit === 'W/m\u00b2')

    // the same square tilted 30 degrees about x: the fitted plane follows it and the area is true
    const t = Math.PI / 6
    const tilted = hits.map(h => ({ ...h, pos: [h.pos[0], h.pos[1] * Math.cos(t), h.pos[1] * Math.sin(t)] }))
    const mt = detectorMap(tilted, { cells: 20, metresPerUnit: 0.01, range })
    ok('map: a tilted plane is fitted, not projected: E the same', Math.abs(mt.max - 2500) < 1e-3 && !mt.axisNames,
        `${mt.max}`)
    ok('map: fewer than three hits, no map', detectorMap(hits.slice(0, 2)) === null)
    ok('turbo: the display pass\'s colours (blue low, red high)', turbo(0.15)[2] > turbo(0.15)[0] && turbo(1)[0] > turbo(1)[2])
    const auto = detectorMap(hits, { cells: 20, metresPerUnit: 0.01 })
    ok('map: auto range, edge-short by half a spacing: within 1% on this lattice', Math.abs(auto.meanLit / 2500 - 1) < 0.011,
        `${auto.meanLit}`)
}

{
    /* THE SMOOTHED MAPS. Random hits (not a lattice: the point is noise) over a uniformly lit 2 x 2 cm
       square, 1 lm in 20 000 hits -- E = 2500 lx everywhere, known. 40 x 40 cells is ~12 hits a
       cell, ~29% noise in the histogram. Each smoothing must keep the level (interior cells, away
       from the edge where a kernel or a k-disc runs off the map), take noise out about as its
       relNoise says, and -- gauss and epan -- put exactly the flux that landed on the map. */
    let seed = 4242
    const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
                        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
    const n = 20000
    const hits = Array.from({ length: n }, () => ({ pos: [-1 + 2 * rnd(), -1 + 2 * rnd(), 0], flux: 1 / n, dir: [0, 0, -1], tag: 1 }))
    const range = { a: [-1, 1], b: [-1, 1] }
    const inner = (m, margin) => {
        const v = []
        for (let y = margin; y < m.ny - margin; y++) for (let x = margin; x < m.nx - margin; x++) v.push(m.E[y * m.nx + x])
        const mu = v.reduce((a, b) => a + b) / v.length
        return { mean: mu, rel: Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / (v.length - 1)) / mu }
    }
    const opts = { cells: 40, metresPerUnit: 0.01, unit: 'lm', range }
    const hist = detectorMap(hits, opts)
    const h0 = inner(hist, 6)
    ok('smooth none: the histogram, as before', hist.smooth === 'none' && hist.E === hist.hist)
    ok('smooth none: ~29% noise a cell, and relNoise says so', near(h0.rel, 0.29, 0.04) && near(hist.relNoise, h0.rel, 0.05),
       `${h0.rel} ${hist.relNoise}`)
    const cellArea = (hist.cell * 0.01) ** 2
    for (const [sm, extra] of [['gauss', { bandwidth: 1.5 }], ['epan', { bandwidth: 2.5 }], ['knn', { k: 64 }]]) {
        const m = detectorMap(hits, { ...opts, smooth: sm, ...extra })
        const r = inner(m, 6)
        ok(`smooth ${sm}: keeps the level (2500 lx +-2% inside)`, Math.abs(r.mean / 2500 - 1) < 0.02, `${r.mean}`)
        ok(`smooth ${sm}: takes out noise, as relNoise predicts (+-35%)`, r.rel < 0.5 * h0.rel && Math.abs(r.rel / m.relNoise - 1) < 0.35,
           `${r.rel} predicted ${m.relNoise}`)
        ok(`smooth ${sm}: the histogram is kept beside it`, m.hist !== m.E && m.hist.length === m.E.length)
        if (sm !== 'knn') {
            const total = m.E.reduce((a, e) => a + e * cellArea, 0)
            // the flux in range: the range is about the hits' centroid, so a few at the edge fall out
            ok(`smooth ${sm}: exactly the flux that landed`, near(total, hist.total, 1e-9), `${total} ${hist.total}`)
            ok(`smooth ${sm}: its blur reported in metres`, near(m.bandwidthM, extra.bandwidth * m.cell * 0.01, 1e-12))
        }
    }
    // a hit whose kernel reaches no cell centre counts in its own cell
    const tiny = detectorMap(hits, { ...opts, smooth: 'epan', bandwidth: 0.1 })
    ok('smooth epan: a bandwidth far under a cell is the histogram', tiny.E.every((e, i) => near(e, hist.E[i], 1e-9 * hist.max)))
    // 'knn' leaves a centre with fewer than k hits in reach at 0, rather than dividing by a guess
    const few = detectorMap(hits.slice(0, 50), { ...opts, smooth: 'knn', k: 64 })
    ok('smooth knn: fewer hits than k in reach reads 0', few.E.every(e => e === 0) && KNN_MAX_CELLS > 0)
    // THE K NEAREST, not the k in a square: a lone near hit just outside the square that first holds
    // k must still count. Brute force at every centre against the map.
    const pts = hits.slice(0, 3000)
    const kk = 7, mk = detectorMap(pts, { ...opts, cells: 16, smooth: 'knn', k: kk })
    // in the map's own coordinates: about the hits' centroid, and only the hits in range
    const loc = pts.map(p => [p.pos[0] - mk.origin[0], p.pos[1] - mk.origin[1]])
        .filter(([a, b]) => a >= -1 && a <= 1 && b >= -1 && b <= 1)
    let worst = 0
    for (let y = 0; y < mk.ny; y++) for (let x = 0; x < mk.nx; x++) {
        const ca = -1 + (x + 0.5) * mk.cell, cb = -1 + (y + 0.5) * mk.cell
        const d = loc.map(([a, b]) => (a - ca) ** 2 + (b - cb) ** 2).sort((p, q) => p - q)
        const want = kk / n / (Math.PI * d[kk - 1] * 1e-4)        // each hit carries 1/n lm; cm -> m^2
        worst = Math.max(worst, Math.abs(mk.E[y * mk.nx + x] / want - 1))
    }
    ok('smooth knn: every centre is the brute-force k-nearest estimate', worst < 1e-9, `worst ${worst}`)
}

{
    // A RAY SET: placed through a frame, weights averaging 1, packed after the sheets' records
    const file = new Float32Array([0.001, 0, 0, 1, 0, 0, 1, 0,     0, 0.002, 0, 3, 1, 0, 0, 0])   // metres; flux 1 and 3
    const placed = placeRays(file, { origin: [0, 0, 5], u: [1, 0, 0], v: [0, -1, 0], w: [0, 0, -1], scale: 100 })   // cm scene
    const V = RAYSET_VEC4 * 4
    ok('placeRays: metres to scene units through the frame', near(placed[0], 0.1, 1e-6) && near(placed[2], 5, 1e-6) && near(placed[V + 1], -0.2, 1e-6))
    ok('...directions turned, not scaled', near(placed[4 + 2], -1, 1e-6) && near(placed[V + 4], 1, 1e-6))
    ok('...weights are flux over the mean (0.5 and 1.5)', near(placed[3], 0.5, 1e-6) && near(placed[V + 3], 1.5, 1e-6))
    const rd = new Map([['a', placed]])
    const t = sourceRecords([defaultSource(), { type: 'rayset', rays: 'a', flux: 10, emitN: 1.5 }, { type: 'rayset', rays: 'missing', flux: 5 }], rd)
    const R = SRC_VEC4 * 4
    ok('a ray set with no data is left out', t.count === 2 && near(t.flux, 1010, 1e-9))
    ok('its record: shape 3, where its rays start, how many, its medium',
        t.data[R + 7] === 3 && t.data[R + 11] === 0 && t.data[R + 12] === 2 && near(t.data[R + 16], 1.5, 1e-6))
    ok('its rays are in the packed buffer', t.rays.length === 2 * V && near(t.rays[V + 3], 1.5, 1e-6))
}

{
    // A LIGHT'S COLOUR: a hue of luminance 1 in record [5], so the flux (a luminance weight) is unchanged
    const Y = c => LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2]
    const red = hue({ r: 1, g: 0.1, b: 0.05 })
    ok('hue: luminance 1', near(Y(red), 1, 1e-12), `${Y(red)}`)
    ok('hue: the ratios kept', near(red[1] / red[0], 0.1, 1e-12) && near(red[2] / red[0], 0.05, 1e-12))
    ok('hue: an array works the same', hue([1, 0.1, 0.05]).every((x, i) => near(x, red[i], 1e-12)))
    ok('hue: missing, black or broken is white', [undefined, { r: 0, g: 0, b: 0 }, { r: NaN, g: 1, b: 1 }]
        .every(c => hue(c).every(x => x === 1)))
    const rb = hue([-0.5, 0.2, 9])
    ok('hue: an out-of-gamut colour keeps its negative channel, luminance 1', rb[0] < 0 && near(Y(rb), 1, 1e-12))
    const R = SRC_VEC4 * 4
    const t = sourceRecords([{ ...defaultSource(), colour: { r: 0, g: 0, b: 2 } },
                             { type: 'rayset', rays: 'a', flux: 10, colour: [0, 1, 0] }],
                            new Map([['a', new Float32Array(RAYSET_VEC4 * 4)]]))
    ok('the record carries the hue at [5]', near(t.data[20], 0, 1e-7) && near(t.data[22], 1 / LUMA[2], 1e-4))
    ok('...a ray set\'s too', near(t.data[R + 21], 1 / LUMA[1], 1e-5))
    ok('...and white when none is given', sourceRecords([defaultSource()]).data.slice(20, 23).every(x => x === 1))
}
{
    // FRESNEL, the bench's known answers (optics/fresnel.js), against textbook values
    ok('glass head-on: 4%', near(fresnel(1, 1 / 1.5).unpolarised, 0.04, 1e-12))
    ok('...the same from inside (reciprocity)', near(fresnel(1, 1.5).unpolarised, 0.04, 1e-12))
    const brewster = Math.atan(1.5)
    ok('Brewster: p vanishes', fresnel(Math.cos(brewster), 1 / 1.5).p < 1e-20)
    const crit = Math.asin(1 / 1.5)
    ok('total internal reflection past the critical angle', fresnel(Math.cos(crit + 1e-3), 1.5).unpolarised === 1
        && fresnel(Math.cos(crit - 1e-3), 1.5).unpolarised < 1)
    // the reflectance inside at the refracted angle equals the one outside (both faces of a slab)
    const cI = Math.cos(50 * Math.PI / 180), sT = Math.sin(50 * Math.PI / 180) / 1.5
    ok('the same R at both faces of a slab', near(fresnel(cI, 1 / 1.5).unpolarised, fresnel(Math.sqrt(1 - sT * sT), 1.5).unpolarised, 1e-12))
    ok('slab head-on: (1 - R)/(1 + R) = 12/13', near(slabT(0, 1.5).model, 12 / 13, 1e-12) && near(slabT(0, 1.5).polarised, 12 / 13, 1e-12))
    ok('two slabs head-on: 6/7', near(twoSlabT(0, 1.5), 6 / 7, 1e-12))
    ok('unpolarised per face under-transmits at a slant', slabT(70, 1.5).model < slabT(70, 1.5).polarised)
    // ABSORBING (0.37.0): clear is slabT, and twice the thickness is the internal transmittance squared
    ok('an absorbing slab with nothing absorbed is the clear one', near(absorbingSlabT(30, 1.5, 0.2, 1, 0.2), slabT(30, 1.5).model, 1e-12)
        && near(absorbingSlabT(30, 1.5, 0.2, 0.5, 0), slabT(30, 1.5).model, 1e-12))
    {
        const R = fresnel(1, 1 / 1.5).unpolarised, T = t => (1 - R) ** 2 * t / (1 - R * R * t * t)
        ok('head-on, its colour depth thick: one pass leaves the colour', near(absorbingSlabT(0, 1.5, 0.2, 0.5, 0.2), T(0.5), 1e-12))
        ok('...twice as thick: the colour squared', near(absorbingSlabT(0, 1.5, 0.4, 0.5, 0.2), T(0.25), 1e-12))
        const cosIn = Math.sqrt(1 - (Math.sin(Math.PI / 4) / 1.5) ** 2)
        ok('at 45 degrees: the longer path inside', near(absorbingSlabT(45, 1.5, 0.2, 0.5, 0.2),
            (1 - fresnel(Math.SQRT1_2, 1 / 1.5).unpolarised) ** 2 * 0.5 ** (1 / cosIn) / (1 - fresnel(Math.SQRT1_2, 1 / 1.5).unpolarised ** 2 * 0.25 ** (1 / cosIn)), 1e-12))
        ok('the old rule: tinted at both faces, and white is the clear slab', near(tintedSlabT(0, 1.5, 0.5), (1 - R) ** 2 * 0.25 / (1 - R * R), 1e-12)
            && near(tintedSlabT(0, 1.5, 1), slabT(0, 1.5).model, 1e-12))
        // A COATED slab (0.39.0): a coating with the glass's own Fresnel, bare or coated inside, is the clear slab
        const F30 = fresnel(Math.cos(Math.PI / 6), 1 / 1.5).unpolarised
        ok('a coating that reflects what the bare glass does is the clear slab, back bare or coated',
            near(coatedSlabT(30, 1.5, F30, 'bare'), slabT(30, 1.5).model, 1e-12) && near(coatedSlabT(30, 1.5, F30, 'coated'), slabT(30, 1.5).model, 1e-12))
        ok('...an AR back passes 1 - R, every face coated (1 - R) / (1 + R), R 0 everything', near(coatedSlabT(45, 1.5, 0.5, 'ar'), 0.5, 1e-15)
            && near(coatedSlabT(0, 1.5, 0.5, 'coated'), 1 / 3, 1e-15) && coatedSlabT(70, 1.5, 0, 'ar') === 1)
    }
    const d = refract([Math.sin(0.5), 0, -Math.cos(0.5)], [0, 0, 1], 1 / 1.5)
    ok('refract: Snell (sin in = 1.5 sin out) and still a unit vector',
        near(Math.hypot(...d), 1, 1e-12) && near(Math.sin(0.5), 1.5 * d[0], 1e-12))
    ok('refract: null past the critical angle', refract([Math.sin(0.8), 0, -Math.cos(0.8)], [0, 0, 1], 1.5) === null)
    // a thin prism deviates by about (n - 1) a
    ok('a 2-degree wedge deviates by about 1 degree', near(Math.abs(wedgeExitDeg(2, 1.5)), 1, 0.01), `${wedgeExitDeg(2, 1.5)}`)
    ok('the bench\'s 20-degree wedge: -10.26', near(wedgeExitDeg(20, 1.5), -10.2604, 1e-3))
}

{
    // THE MAP'S COLOUR: hits carrying xyz. One colour everywhere reads that colour and no spread; two
    // halves of different colours read their XYZ sum, and each half's distance from it.
    const grid = (n, f) => { const out = []; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push(f((i + 0.5) / n, (j + 0.5) / n)); return out }
    const warm = cctDuvToXy(3000, 0), cool = cctDuvToXy(6500, 0.003)
    const hit = (a, b, xy, flux) => ({ pos: [a, b, 0], flux, dir: [0, 0, -1], tag: 1, xyz: xyToXYZ(xy[0], xy[1], flux) })
    const one = detectorMap(grid(60, (a, b) => hit(a, b, warm, 0.01)), { cells: 10, range: { a: [-0.5, 0.5], b: [-0.5, 0.5] } })
    ok('colour map: one colour reads its xy', near(one.colour.x, warm[0], 1e-9) && near(one.colour.y, warm[1], 1e-9))
    ok('...its CCT and Duv', near(one.colour.cct, 3000, 0.5) && near(one.colour.duv, 0, 1e-6), JSON.stringify(one.colour))
    ok('...and no spread over the cells', one.colour.dUpVpMax < 1e-9 && one.colour.cells === 100)
    ok('...a cell shows that colour at the luminance asked', (c => near(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], 0.5, 1e-9))(cellColour(one, 55, 0.5)))
    const split = detectorMap(grid(60, (a, b) => hit(a, b, a < 0.5 ? warm : cool, a < 0.5 ? 0.01 : 0.02)),
                              { cells: 10, range: { a: [-0.5, 0.5], b: [-0.5, 0.5] } })
    const sumXYZ = [0, 1, 2].map(k => 1800 * xyToXYZ(...warm, 0.01)[k] + 1800 * xyToXYZ(...cool, 0.02)[k])
    const want = XYZtoxy(sumXYZ)
    ok('two colours: the whole is their XYZ sum', near(split.colour.x, want[0], 1e-9) && near(split.colour.y, want[1], 1e-9))
    const [u0, v0] = xyToUpVp(...want), dw = Math.hypot(...[0, 1].map(k => xyToUpVp(...warm)[k] - [u0, v0][k]))
    const dc = Math.hypot(...[0, 1].map(k => xyToUpVp(...cool)[k] - [u0, v0][k]))
    ok("two colours: the largest u'v' distance is the further half's", near(split.colour.dUpVpMax, Math.max(dw, dc), 1e-9),
       `${split.colour.dUpVpMax} vs ${Math.max(dw, dc)}`)
    const sm = detectorMap(grid(60, (a, b) => hit(a, b, warm, 0.01)), { cells: 10, range: { a: [-0.5, 0.5], b: [-0.5, 0.5] }, smooth: 'gauss' })
    ok('smoothing keeps a uniform colour', sm.colour.dUpVpMax < 1e-9)
    const old = detectorMap(grid(20, (a, b) => ({ pos: [a, b, 0], flux: 1, dir: [0, 0, -1], tag: 1 })), { cells: 5 })
    ok('hits without colour: no colour, the rest as before', old.colour === null && old.EX === null && old.total === 400)
}

/* THE ESTIMATE OVER BATCHES (estimate.js): running sums in place of the list it was, held to the list's own two-pass
   arithmetic -- copied here as it was in index.js `combine` -- on batches with objects that come and go; one estimate
   merged from two the same as one fed every batch; a number every batch gave alike read exactly, error zero */
{
    const combine = list => {
        const n = list.length
        const stat = f => {
            const v = list.map(f), m = v.reduce((a, b) => a + b, 0) / n
            const sd = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : NaN
            return { value: m, se: n > 1 ? sd / Math.sqrt(n) : null }
        }
        const merge = key => {
            const idx = [...new Set(list.flatMap(r => r[key].map(o => o.index)))].sort((a, b) => a - b)
            return idx.map(i => {
                const pick = r => r[key].find(o => o.index === i) || { incident: 0, leaving: 0, absorbed: 0, hits: 0 }
                const first = list.map(pick).find(o => o.name) || {}
                return { index: i, name: first.name, incident: stat(r => pick(r).incident),
                         absorbed: stat(r => pick(r).absorbed), hits: list.reduce((a, r) => a + pick(r).hits, 0) }
            })
        }
        return { unit: list[0].unit, rays: list.reduce((a, r) => a + r.rays, 0), batches: n,
                 emitted: stat(r => r.emitted), escaped: stat(r => r.escaped), lost: stat(r => r.lost),
                 absorbed: stat(r => r.absorbed), detected: stat(r => r.detected), detectorHits: list[list.length - 1].detectorHits,
                 objects: merge('objects'), materials: merge('materials'), interactionsPerRay: stat(r => r.counts.interactions / r.rays) }
    }
    let seed = 11
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
    const obj = (index, name) => ({ index, name, incident: 100 * rnd(), leaving: 0, absorbed: 30 * rnd(), hits: 1 + Math.floor(50 * rnd()) })
    // object 3 in some batches only, object 5 named in a later batch than it first appears
    const batch = b => ({ unit: 'lm', rays: 1000, emitted: 1000, escaped: 600 + 50 * rnd(), lost: 3 * rnd(), absorbed: 200 + 20 * rnd(), detected: 90 + 10 * rnd(),
                          detectorHits: 40 + b, counts: { interactions: 3000 + 500 * rnd() },
                          objects: [obj(1, 'lens'), ...(b % 3 ? [obj(3, 'mount')] : []), obj(5, b > 2 ? 'screen' : undefined)],
                          materials: [obj(2), ...(b % 2 ? [obj(4)] : [])] })
    const list = Array.from({ length: 9 }, (_, b) => batch(b))
    const E = makeEstimate()
    for (const r of list) E.add(r)
    const got = E.results(), want = combine(list)
    const same = (a, b) => near(a.value, b.value, 1e-9 * Math.max(1, Math.abs(b.value))) && (b.se == null ? a.se == null : near(a.se, b.se, 1e-9 * Math.max(1, b.se)))
    ok('estimate: the totals as the two-pass list gave them, mean and error', ['emitted', 'escaped', 'lost', 'absorbed', 'detected', 'interactionsPerRay'].every(k => same(got[k], want[k]))
       && got.rays === want.rays && got.batches === 9 && got.detectorHits === want.detectorHits && got.unit === 'lm', JSON.stringify([got.escaped, want.escaped]))
    ok('...an object some batches lacked: their zeros counted', got.objects.length === want.objects.length && got.objects.every((o, i) => {
        const w = want.objects[i]
        return o.index === w.index && o.name === w.name && o.hits === w.hits && same(o.incident, w.incident) && same(o.absorbed, w.absorbed)
    }) && got.materials.every((o, i) => same(o.incident, want.materials[i].incident)), JSON.stringify([got.objects[1], want.objects[1]]))
    ok('...a number every batch gave alike: exactly that, error exactly zero', got.emitted.value === 1000 && got.emitted.se === 0)
    const A = makeEstimate(), Bq = makeEstimate()
    list.slice(0, 4).forEach(r => A.add(r)); list.slice(4).forEach(r => Bq.add(r))
    A.merge(Bq)
    const m = A.results()
    ok('two estimates merged: as one fed every batch', ['escaped', 'absorbed', 'detected', 'interactionsPerRay'].every(k => same(m[k], want[k])) && m.batches === 9 && m.rays === 9000
       && m.objects.every((o, i) => same(o.incident, want.objects[i].incident) && o.hits === want.objects[i].hits && o.name === want.objects[i].name), JSON.stringify([m.escaped, want.escaped]))
    ok('...the merged-in one as it was', Bq.batches === 5 && Bq.results().batches === 5)
    ok('one batch: no error bar; none: no results', (() => { const one = makeEstimate().add(list[0]).results(); return one.escaped.se === null && one.batches === 1 })()
       && makeEstimate().results() === null)
    // the far field: per bin, the mean and error of plain sums, as farAccumulator gave them; merged alike; another grid refused
    const grid = { mode: 'escaped', material: 0, nC: 2, nG: 3, axis: [0, 0, 1], c0: [1, 0, 0], emitted: 1000, unit: 'lm' }
    const fars = Array.from({ length: 5 }, () => ({ ...grid, flux: Float64Array.from({ length: 6 }, () => rnd()) }))
    const F = makeEstimate()
    fars.forEach((f, i) => F.add(list[i], f))
    const ff = F.farField(), bin = i => fars.map(f => f.flux[i]), mean = v => v.reduce((a, b) => a + b, 0) / v.length
    const se = v => { const m = mean(v); return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1) / v.length) }
    ok('estimate: the far field per bin, mean and error', [0, 1, 2, 3, 4, 5].every(i => near(ff.flux[i], mean(bin(i)), 1e-12) && near(ff.se[i], se(bin(i)), 1e-9))
       && ff.batches === 5 && ff.rays === 5000 && ff.nC === 2 && ff.mode === 'escaped')
    const F1 = makeEstimate(), F2 = makeEstimate()
    fars.slice(0, 2).forEach((f, i) => F1.add(list[i], f)); fars.slice(2).forEach((f, i) => F2.add(list[i + 2], f))
    const fm = F1.merge(F2).farField()
    ok('...merged: the same', [0, 1, 2, 3, 4, 5].every(i => near(fm.flux[i], ff.flux[i], 1e-12) && near(fm.se[i], ff.se[i], 1e-12)) && fm.batches === 5)
    const threw = f => { try { f(); return null } catch (e) { return e.message } }
    ok('...a batch of another grid refused', /another far-field grid/.test(threw(() => F.add(list[0], { ...grid, nG: 5, flux: new Float64Array(10) })) ?? ''))
    ok('...and one without a far field among ones with', /all with a far field or all without/.test(threw(() => F.add(list[0], null)) ?? ''))
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
