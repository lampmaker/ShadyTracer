//======================================================================================================================
// THE PHOTON MAP'S MEASUREMENT, no GPU (core/sppm.js). Run: node lib/pathtracer/core/test/sppm.test.mjs
//
// A white diffuse floor, a square lamp above it, glass between, a pinhole camera looking through the glass at the floor:
// light -> glass -> floor -> glass -> eye, the class the photon map is for. Drawn two ways, which must agree:
//   by the CAMERA'S RAYS, the renderer's own estimator: through the glass (weight T at each face), the floor, a cosine
//     bounce (weight rho), back through the glass, the lamp found or not -- refractions weighed by T alone, as the camera
//     side does (n^2 left out: the path's two ends are in air);
//   by the PHOTON MAP, sample after sample: photons from the lamp through the glass, stored on the floor; the camera's
//     rays through the glass to the floor, each gathering f Phi / (pi r^2) within r_k of where it lands, over n^2 of
//     the medium it is in -- and the samples averaged, the radius shrinking (sppmRadius), as the picture's mean does.
// Two glasses: a SLAB WITH AIR UNDER IT (the user's case, 2026-10-15: two faces each way, the floor in air), and the
// slab lying ON the floor (the floor inside the glass: one face each way, a gather in a medium; the manifold connection's
// case until 0.61.0 removed it).
// Then a COLLIMATED BEAM under the slab (0.61.0: a light no camera path can meet, its photons stored though they passed
// no glass) against its closed form, the grid against brute force, the schedule, and the gates.
//======================================================================================================================
import { PhotonMap, sppmRadius, neighbourCells, cellOf, hashCell, storesJS, gathersJS, allLobesJS, TAGS, SPPM_NORMAL_DOT, SPPM_VISIT_HARD, SPPM_SUBS, SPPM_FILL, sppmKeep, sppmSubsOf,
         SPPM_ALPHA, pixelFootprint } from '../sppm.js'
import { refract, fresnel } from '../../optics/fresnel.js'
const fresnelR = (cosI, eta) => fresnel(cosI, eta).unpolarised

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const rng = (seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 })(7171)
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = a => { const l = Math.hypot(...a); return a.map(v => v / l) }
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const scaleV = (a, s) => a.map(v => v * s)

// the camera: a pinhole at Y looking at the origin, 8 x 8 pixels over 30 degrees (the removed manifold.test.mjs's)
const Y = [0.17, 0.06, 0.55], W = 8, H = 8, tf = Math.tan(15 * Math.PI / 180)
const fwd = norm(Y), right = norm(cross([0, 0, 1], fwd)), up = cross(fwd, right)
const cameraRay = pix => {
    const px = pix % W, py = (pix / W) | 0
    const x = -1 + (px + rng()) * 2 / W, y = -1 + (py + rng()) * 2 / H
    return norm(add(add(scaleV(right, x * tf), up, y * tf), fwd, -1))
}
// the lamp: a square, side 0.16, at height 0.45 beside the axis, facing down, radiance 1; the floor's albedo 0.8
const LZ = 0.45, LC = [-0.08, 0.03], LS = 0.16, RHO = 0.8, N_GLASS = 1.5
const PHI = Math.PI * LS * LS
const onLamp = (o, d) => { if (d[2] <= 0) return false; const t = (LZ - o[2]) / d[2], p = add(o, d, t)
    return Math.abs(p[0] - LC[0]) <= LS / 2 && Math.abs(p[1] - LC[1]) <= LS / 2 }

/* A HORIZONTAL SLAB between z = lo and z = hi, crossed by a ray from o along d: each face's transmittance and where it
   leaves; null if it misses or reflects totally. The floor is z = 0. */
const through = (o, d, lo, hi) => {
    if (Math.abs(d[2]) < 1e-9) return null
    const down = d[2] < 0, z1 = down ? hi : lo, z2 = down ? lo : hi, n1 = [0, 0, down ? 1 : -1]
    const p1 = add(o, d, (z1 - o[2]) / d[2])
    const T1 = 1 - fresnelR(-dot(d, n1), 1 / N_GLASS), t = refract(d, n1, 1 / N_GLASS)
    const p2 = add(p1, t, (z2 - p1[2]) / t[2])
    const n2 = n1                                             // the far face, towards the ray inside: parallel, the same
    const out = refract(t, n2, N_GLASS); if (!out) return null
    return { p: p2, d: out, T: T1 * (1 - fresnelR(-dot(t, n2), N_GLASS)) }
}

const GAP = 0.03, SLAB = 0.05
const airGap = {
    name: 'a slab with air under it (the user\'s case: two faces each way)',
    // from the camera to the floor: through the slab, then the floor; the medium the floor is seen in
    down: (o, d) => { const s = through(o, d, GAP, GAP + SLAB); if (!s || s.d[2] >= 0) return null
        return { D: add(s.p, s.d, -s.p[2] / s.d[2]), T: s.T, n: 1 } },
    // from the floor up to the lamp: through the slab again
    up: (D, b) => { const s = through(D, b, GAP, GAP + SLAB); return s && onLamp(s.p, s.d) ? s.T : 0 },
    // a photon from the lamp down to the floor
    photon: (P, d) => { const s = through(P, d, GAP, GAP + SLAB); if (!s || s.d[2] >= 0) return null
        return { D: add(s.p, s.d, -s.p[2] / s.d[2]), T: s.T } },
}
/* THE SLAB LYING ON THE FLOOR (the removed manifold.test.mjs's slab): the floor is inside the glass, one face each way */
const onFloor = (() => {
    const enter = (o, d) => { const n1 = [0, 0, 1], p = add(o, d, (SLAB - o[2]) / d[2])
        return { p, T: 1 - fresnelR(-dot(d, n1), 1 / N_GLASS), t: refract(d, n1, 1 / N_GLASS) } }
    return {
        name: 'a slab lying on the floor (the floor inside the glass: one face each way)',
        down: (o, d) => { if (d[2] >= 0) return null; const e = enter(o, d); return { D: add(e.p, e.t, -e.p[2] / e.t[2]), T: e.T, n: N_GLASS } },
        up: (D, b) => { const p = add(D, b, SLAB / b[2]), out = refract(b, [0, 0, -1], N_GLASS); if (!out) return 0
            return onLamp(p, out) ? 1 - fresnelR(b[2], N_GLASS) : 0 },
        photon: (P, d) => { const e = enter(P, d); return { D: add(e.p, e.t, -e.p[2] / e.t[2]), T: e.T } },
    }
})()

const cosine = () => { const u = rng(), ph = 2 * Math.PI * rng(), r = Math.sqrt(u); return [r * Math.cos(ph), r * Math.sin(ph), Math.sqrt(1 - u)] }

// the camera's own: through, the floor, a cosine bounce, back through, the lamp
function cameraImage(G, n) {
    const img = new Float64Array(W * H)
    for (let pix = 0; pix < W * H; pix++) {
        let s = 0
        for (let k = 0; k < n; k++) {
            const a = G.down(Y, cameraRay(pix)); if (!a) continue
            s += a.T * RHO * G.up(a.D, cosine())
        }
        img[pix] = s / n
    }
    return img
}
// the photon map's: K samples, each its photons stored and its camera rays gathering at r_k; the samples averaged
function mapImage(G, K, photons, perPixel, r1) {
    const img = new Float64Array(W * H)
    let stored = 0, gathered = 0
    for (let k = 1; k <= K; k++) {
        const r = sppmRadius(r1, k), map = new PhotonMap(2 * r, 1 << 16)
        for (let i = 0; i < photons; i++) {
            const P = [LC[0] + (rng() - 0.5) * LS, LC[1] + (rng() - 0.5) * LS, LZ]
            const c = cosine(), d = [c[0], c[1], -c[2]]
            const h = G.photon(P, d); if (!h) continue
            map.store(h.D, [PHI / photons * h.T, 0, 0], scaleV(d, -1), [0, 0, 1]); stored++
        }
        const f = () => [RHO / Math.PI, 0, 0]
        for (let pix = 0; pix < W * H; pix++) {
            let s = 0
            for (let j = 0; j < perPixel; j++) {
                const a = G.down(Y, cameraRay(pix)); if (!a) continue
                const g = map.gather(a.D, [0, 0, 1], r, f)
                s += a.T * g.sum[0] / (Math.PI * r * r) / (a.n * a.n); gathered++
            }
            img[pix] += s / perPixel / K
        }
    }
    return { img, stored, gathered }
}

const sum = a => a.reduce((s, v) => s + v, 0)
const block = img => Array.from({ length: (W / 2) * (H / 2) }, (_, b) => {
    const bx = (b % (W / 2)) * 2, by = ((b / (W / 2)) | 0) * 2
    return img[bx + W * by] + img[bx + 1 + W * by] + img[bx + W * (by + 1)] + img[bx + 1 + W * (by + 1)]
})
for (const G of [airGap, onFloor]) {
    const ci = cameraImage(G, 100000)
    /* r_1 a centimetre, a quarter of a pixel's 4 cm footprint on the floor here; 48 samples of 60 000 photons */
    const m = mapImage(G, 48, 60000, 64, 0.01)
    const cb = block(ci), mb = block(m.img)
    const lit = [...cb.keys()].filter(b => cb[b] > 0.5 * Math.max(...cb))
    const worst = lit.map(b => Math.abs(mb[b] / cb[b] - 1)).reduce((a, b) => Math.max(a, b), 0)
    console.log(`  ${G.name}: camera ${sum(ci).toFixed(5)}, map ${sum(m.img).toFixed(5)} (${(sum(m.img) / sum(ci)).toFixed(4)});`
        + ` ${lit.length} blocks inside, worst ${worst.toFixed(3)}`)
    ok(`${G.name}: the map's picture is the camera's -- the sum within 2 %`, Math.abs(sum(m.img) / sum(ci) - 1) < 0.02,
        `${sum(m.img)} against ${sum(ci)}`)
    ok(`${G.name}: ...and block by block within 6 % inside it`, lit.length >= 3 && worst < 0.06, `${lit.length} blocks, worst ${worst}`)
}
{
    /* THE 1 / n^2, planted: the floor under the glass gathered without it reads n^2 = 2.25 times the camera's */
    const ci = cameraImage(onFloor, 20000)
    const G = { ...onFloor, down: (o, d) => { const a = onFloor.down(o, d); return a && { ...a, n: 1 } } }
    const m = mapImage(G, 8, 30000, 16, 0.01)
    ok('a gather in glass without 1/n^2 is n^2 too bright (the planted mistake is seen)', Math.abs(sum(m.img) / sum(ci) / (N_GLASS ** 2) - 1) < 0.05,
        `${sum(m.img) / sum(ci)}`)
}

/* A COLLIMATED BEAM SEEN THROUGH THE SLAB (0.61.0): a light no camera path can meet (Ray.ltMis < 0), between the slab and
   the floor, straight down onto a square of it. Its photons pass no glass, so before 0.61.0 the map stored none (TAG_PASSED
   was the gate) and nothing else drew the floor it lights through the slab: ltConnect's line to the eye is blocked by the
   slab, and the camera's paths cannot meet the beam. Now they are stored at every surface (storesJS's ltMis), and the
   picture is the closed form: the floor's radiance rho E / pi, E = Phi / A on the square, times each camera ray's T
   through the slab -- the camera's rays sampled only for where they land, the light exact. */
{
    const BS = 0.16, PHI_B = 2, A = BS * BS
    const tag = TAGS.PHOTON | TAGS.OPTIC | TAGS.LTALL           // a light's photon, its first surface: no glass passed
    const inBeam = D => Math.abs(D[0]) <= BS / 2 && Math.abs(D[1]) <= BS / 2
    const exact = new Float64Array(W * H)
    for (let pix = 0; pix < W * H; pix++) {
        let s = 0
        for (let k = 0; k < 20000; k++) { const a = airGap.down(Y, cameraRay(pix)); if (a && inBeam(a.D)) s += a.T * RHO * PHI_B / (Math.PI * A) }
        exact[pix] = s / 20000
    }
    const beamImage = (ltMis, K, photons, perPixel, r1) => {
        const img = new Float64Array(W * H)
        let all = 0
        for (let k = 1; k <= K; k++) {
            const r = sppmRadius(r1, k), map = new PhotonMap(2 * r, 1 << 16)
            if (storesJS(tag, 0, 10, { ltMis })) for (let i = 0; i < photons; i++)
                map.store([(rng() - 0.5) * BS, (rng() - 0.5) * BS, 0], [PHI_B / photons, 0, 0], [0, 0, 1], [0, 0, 1], 1, allLobesJS(tag, ltMis))
            const f = (l, a) => { if (a) all++; return [RHO / Math.PI, 0, 0] }
            for (let pix = 0; pix < W * H; pix++) {
                let s = 0
                for (let j = 0; j < perPixel; j++) {
                    const a = airGap.down(Y, cameraRay(pix)); if (!a) continue
                    s += a.T * map.gather(a.D, [0, 0, 1], r, f).sum[0] / (Math.PI * r * r)
                }
                img[pix] += s / perPixel / K
            }
        }
        return { img, all }
    }
    const m = beamImage(-1, 32, 40000, 64, 0.008), eb = block(exact), mb = block(m.img)
    const lit = [...eb.keys()].filter(b => eb[b] > 0.5 * Math.max(...eb))
    const worst = lit.map(b => Math.abs(mb[b] / eb[b] - 1)).reduce((a, b) => Math.max(a, b), 0)
    console.log(`  a collimated beam under the slab: exact ${sum(exact).toFixed(5)}, map ${sum(m.img).toFixed(5)}`
        + ` (${(sum(m.img) / sum(exact)).toFixed(4)}); ${lit.length} blocks inside, worst ${worst.toFixed(3)}`)
    ok('a collimated beam seen through the slab: the map\'s picture is T rho Phi / (A pi) -- the sum within 2 %',
        Math.abs(sum(m.img) / sum(exact) - 1) < 0.02, `${sum(m.img)} against ${sum(exact)}`)
    ok('...and block by block within 6 % inside it', lit.length >= 2 && worst < 0.06, `${lit.length} blocks, worst ${worst}`)
    ok('...its photons gathered through every lobe (the record\'s flag)', m.all > 0)
    ok('...and a light a camera path can meet (ltMis >= 0) stores none there: its light is the camera\'s',
        sum(beamImage(0, 1, 1000, 1, 0.008).img) === 0)
}

// THE GRID: every photon within r found exactly once, against brute force, at every place a query can sit in its cell
{
    const r = 0.013, map = new PhotonMap(2 * r, 1 << 8)       // few lists: many cells share one
    const pts = []
    for (let i = 0; i < 4000; i++) {
        const p = [(rng() - 0.5) * 0.4, (rng() - 0.5) * 0.4, (rng() - 0.5) * 0.04]
        const n = rng() < 0.9 ? [0, 0, 1] : [1, 0, 0]
        pts.push({ p, n }); map.store(p, [1, 0, 0], [0, 0, 1], n)
    }
    let bad = 0, total = 0
    for (let q = 0; q < 2000; q++) {
        const x = [(rng() - 0.5) * 0.4, (rng() - 0.5) * 0.4, (rng() - 0.5) * 0.04]
        const brute = pts.filter(e => Math.hypot(e.p[0] - x[0], e.p[1] - x[1], e.p[2] - x[2]) <= r && dot(e.n, [0, 0, 1]) >= SPPM_NORMAL_DOT).length
        const got = map.gather(x, [0, 0, 1], r, () => [1, 0, 0]).sum[0]
        total += brute
        if (got !== brute) bad++
    }
    ok(`the grid finds every photon within r once, with 256 lists for 4000 photons (${total} found by brute force)`, bad === 0 && total > 1000, `${bad} queries wrong`)
    ok('eight cells, the query\'s own first', neighbourCells([0.011, -0.002, 0.03], 0.02).length === 8
        && JSON.stringify(neighbourCells([0.011, -0.002, 0.03], 0.02)[0]) === JSON.stringify(cellOf([0.011, -0.002, 0.03], 0.02)))
    ok('the hash is a 32-bit one: the same for a cell and its wrap', hashCell(-1, 2, 3) === hashCell(-1 + 2 ** 32, 2, 3))
    /* NEITHER FULL NOR CUT (0.61.2, sppm.js): a gather within its budget walks every cell's whole list, the same sum as
       without one; a cell past its share is walked by sub-lists, exact in expectation; the stores' keep, the same */
    {
        const q = [0.004, -0.003, 0], n = [0, 0, 1], one = () => [1, 0, 0]
        const exact = map.gather(q, n, r, one).sum[0]
        const wide = map.gather(q, n, r, one, { visit: 1 << 20 })
        ok('within its budget a gather is the whole lists\' sum, exactly', wide.sum[0] === exact && !wide.cut && exact > 0, `${wide.sum[0]} ${exact}`)
        // a seeded draw, so the run is the same every time
        let seed = 7
        const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296 }
        /* A DENSE CELL: 6000 photons in a 1 cm square on one plane, gathered with a budget of 64 (a share of 8 a cell):
           every cell is walked by sub-lists. Over 300 maps -- each its own draw of sub-lists, each gather its own start --
           the mean is the exact sum within three standard errors, and no gather walked near the hard cap */
        const pts = Array.from({ length: 6000 }, () => [(rnd() - 0.5) * 0.01, (rnd() - 0.5) * 0.01, 0])
        const make = keep => { const m = new PhotonMap(0.02, 1 << 12); for (const p of pts) m.store(p, [1, 1, 1], [0, 0, 1], n, 1, false, { keep, rnd }); return m }
        const full = make(1).gather([0, 0, 0], n, 0.006, one).sum[0]
        const trials = (keep, visit) => {
            const v = [], walked = []
            for (let t = 0; t < 300; t++) { const g = make(keep).gather([0, 0, 0], n, 0.006, one, { visit, rnd }); v.push(g.sum[0]); walked.push(g.visits) }
            const mean = v.reduce((a, b) => a + b, 0) / v.length, se = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1) / v.length)
            return { mean, se, maxWalked: Math.max(...walked) }
        }
        const sub = trials(1, 64)
        ok(`a cell too full to walk is subsampled, exact in expectation: ${sub.mean.toFixed(1)} +- ${sub.se.toFixed(1)} against ${full}, walking at most ${sub.maxWalked} of 6000`,
            Math.abs(sub.mean - full) < 3 * sub.se && sub.se > 0 && sub.maxWalked < SPPM_VISIT_HARD * 64 && sub.maxWalked < 2000, JSON.stringify(sub))
        const kept = trials(0.3, Infinity)
        ok(`a store kept with probability 0.3, its power over it: ${kept.mean.toFixed(1)} +- ${kept.se.toFixed(1)} against ${full}`,
            Math.abs(kept.mean - full) < 3 * kept.se && kept.se > 0, JSON.stringify(kept))
        const both = trials(0.5, 32)
        ok(`...and both at once: ${both.mean.toFixed(1)} +- ${both.se.toFixed(1)} against ${full}`, Math.abs(both.mean - full) < 3 * both.se, JSON.stringify(both))
        // the hard cap: a budget of 1 (a share of 1 a cell, hard cap 8) over 6000 photons: one sub-list holds ~190
        const capped = make(1).gather([0, 0, 0], n, 0.006, one, { visit: 1, rnd })
        ok('a gather that reaches the hard cap stops there and says so', capped.cut && capped.visits === SPPM_VISIT_HARD, JSON.stringify(capped))
        ok('the keep: 1 while the demand fits the planned fill, the fill over it past that, 1 with none known',
            sppmKeep(1000, 800) === 1 && Math.abs(sppmKeep(1000, 2000) - SPPM_FILL / 2) < 1e-15 && sppmKeep(1000, null) === 1 && sppmKeep(0, 5) === 1)
        ok('the sub-lists walked: all (the whole list) while the count fits, as many as fit past it, one at least',
            sppmSubsOf(64, 64) === SPPM_SUBS && sppmSubsOf(65, 64) === Math.floor(SPPM_SUBS * 64 / 65) && sppmSubsOf(1e6, 8) === 1)
    }
    // the bounce cap: b_c + b_p - 1 <= maxbounce
    const m2 = new PhotonMap(0.1, 16)
    m2.store([0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 0, 1], 5)
    ok('a merged path longer than maxbounce is not counted', m2.gather([0, 0, 0], [0, 0, 1], 0.05, () => [1, 0, 0], { maxB: 9, bc: 5 }).sum[0] === 1
        && m2.gather([0, 0, 0], [0, 0, 1], 0.05, () => [1, 0, 0], { maxB: 9, bc: 6 }).sum[0] === 0)
}

// THE SCHEDULE: r_1 first, shrinking, r_k^2 k^(1 - alpha) settling to a constant
{
    const r = k => sppmRadius(1, k)
    ok('r_1 is r_1', r(1) === 1)
    ok('the radius shrinks every sample', [2, 3, 10, 100, 1000].every(k => r(k) < r(k - 1)))
    const c = k => r(k) ** 2 * k ** (1 - SPPM_ALPHA)
    ok('r_k^2 falls as k^(alpha - 1)', Math.abs(c(4000) / c(2000) - 1) < 0.001, `${c(2000)} ${c(4000)}`)
    ok('a pixel\'s footprint: 2 d tan(fov/2) / rows', Math.abs(pixelFootprint(2, Math.tan(Math.PI / 8), 400) - 4 * Math.tan(Math.PI / 8) / 400) < 1e-15)
}

// THE GATES (transcribed; sppm.gpu.mjs holds the WGSL to them)
{
    const T = TAGS, ph = (f, extra = 0) => T.PHOTON | (f << T.PH_SHIFT) | extra, cam = (f, extra = 0) => (f << T.CAM_SHIFT) | extra
    ok('a sun photon past glass, before D: stored', storesJS(ph(0, T.PASSED), 2, 10))
    ok('...not before a delta event (NEE\'s and the connection\'s)', !storesJS(ph(0), 1, 10))
    ok('...not past D (a photon\'s field 3 once it has scattered)', !storesJS(ph(3, T.PASSED), 3, 10) && !storesJS(ph(3), 3, 10))
    ok('...not a probe, nor the Optics page\'s rays', !storesJS(ph(0, T.PASSED | T.PROBE), 2, 10) && !storesJS(ph(0, T.PASSED | T.OPTIC), 2, 10))
    ok('...a light\'s photon past glass, yes', storesJS(ph(0, T.PASSED | T.OPTIC | T.LTALL), 2, 10))
    ok('...not past the bounce cap', !storesJS(ph(0, T.PASSED), 10, 10) && storesJS(ph(0, T.PASSED), 8, 10))
    /* ...NOR AT IT (0.61.2): stored as b = bounces + 1, a record counts for a camera ray of bc only if bc + b <= maxbounce
       + 1, and a camera ray gathers only once it has passed a delta at its first surface, so bc >= 2. By brute force over
       the caps: a record is stored exactly when some gather could count it. */
    {
        let bad = 0
        for (let maxB = 1; maxB <= 24; maxB++) for (let bounces = 0; bounces <= maxB + 1; bounces++) {
            const b = bounces + 1, counted = Array.from({ length: maxB + 1 }, (_, i) => i + 2).some(bc => bc + b <= maxB + 1)
            if (storesJS(ph(0, T.PASSED), bounces, maxB) !== counted) bad++
            if (storesJS(ph(3, T.OPTIC | T.LTALL), bounces, maxB, { ltMis: -1 }) !== counted) bad++
        }
        ok('...a record stored exactly when a gather can count it: none at b = maxbounce, every cap from 1 to 24', bad === 0, `${bad} wrong`)
    }
    /* ...AND WITHIN THE DIFFUSE CAP (0.75.0; tracebasics.js pathEnd THE DIFFUSE CAP): a merged path's diffuse bounces are
       the photon's, the gather's vertex, and the camera ray's -- none, since it gathers only after delta events. By brute
       force over the caps (1 to 12, 0 none) and the photon's diffuse bounces: stored exactly when that sum fits. */
    {
        let bad = 0
        for (let cap = 0; cap <= 12; cap++) for (let diffuse = 0; diffuse <= 14; diffuse++) {
            const counted = cap === 0 || 0 + 1 + diffuse <= cap
            if (storesJS(ph(3, T.OPTIC | T.LTALL), 2, 10, { ltMis: -1, diffuse, diffuseCap: cap }) !== counted) bad++
            if (storesJS(ph(3, T.OPTIC | T.LTALL), 2, 10, { optics: true, diffuse, diffuseCap: cap }) !== counted) bad++
        }
        ok('...and within the diffuse cap: the photon\'s, the gather\'s vertex and none of the camera\'s, every cap from 1 to 12',
            bad === 0, `${bad} wrong`)
        ok('...a sun\'s photon (no diffuse bounce before it lands) stored at every cap, and none', [0, 1, 2, 5].every(cap =>
            storesJS(ph(0, T.PASSED), 2, 10, { diffuseCap: cap })))
    }
    ok('the Optics view: every light\'s photon, past glass or not; the sun\'s none', storesJS(ph(3, T.OPTIC | T.LTALL), 1, 10, { optics: true })
        && !storesJS(ph(0, T.PASSED), 2, 10, { optics: true }))
    ok('a camera ray through glass: gathers', gathersJS(cam(1)))
    ok('...not before a delta (field 0), nor past D (2, 3)', !gathersJS(cam(0)) && !gathersJS(cam(2)) && !gathersJS(cam(3)))
    ok('...not a seek ray', !gathersJS(cam(1, T.SEEK)))
    ok('...nor a photon', !gathersJS(cam(1, T.PHOTON)) && !gathersJS(cam(1, T.PROBE)))
    // A LIGHT NO CAMERA PATH CAN MEET (0.61.0: ltMis < 0, collimated or no face): every surface it lands on, any mode
    const L = T.OPTIC | T.LTALL
    ok('a collimated light\'s photon: stored at its first surface, no glass passed', storesJS(ph(0, L), 0, 10, { ltMis: -1 }))
    ok('...and past D, scattered', storesJS(ph(3, L), 3, 10, { ltMis: -1 }) && storesJS(ph(3, L | T.PASSED), 3, 10, { ltMis: -1 }))
    ok('...in the Optics view too', storesJS(ph(3, L), 3, 10, { ltMis: -1, optics: true }))
    ok('...not past the bounce cap', !storesJS(ph(3, L), 10, 10, { ltMis: -1 }))
    ok('...a light a camera path can meet, as before: past glass only', !storesJS(ph(0, L), 0, 10, { ltMis: 0.5 })
        && !storesJS(ph(3, L), 3, 10, { ltMis: 0 }) && storesJS(ph(0, L | T.PASSED), 2, 10, { ltMis: 0.5 }))
    ok('...the sun\'s and an emitter\'s, whatever ltMis reads (theirs is never set)', !storesJS(ph(3), 3, 10, { ltMis: -1 }))
    ok('...the Optics page\'s own rays never', !storesJS(ph(0, T.OPTIC), 0, 10, { ltMis: -1 }))
    ok('every lobe for the unmet light\'s photons, the evaluable ones for any other', allLobesJS(ph(3, L), -1)
        && !allLobesJS(ph(3, L), 0) && !allLobesJS(ph(3), -1) && !allLobesJS(ph(3, T.OPTIC), -1))
}

console.log(`sppm: ${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
