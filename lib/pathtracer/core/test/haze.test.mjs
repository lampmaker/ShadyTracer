//======================================================================================================================
// THE HAZE BOX'S ARITHMETIC, no GPU (core/haze.js). Run: node lib/pathtracer/core/test/haze.test.mjs
//
// What the kernels' haze rests on, in its JS mirror (the WGSL against these is test/haze.gpu.mjs):
//   - THE BOX: a segment's stretch inside a turned box and the scene's radius, against brute force -- starts inside,
//     misses, a face parallel, a zero length, the radius cutting it;
//   - THE COLLISION (the user's "move back YY"): its probability 1 - exp(-sigma L) on the stretch, and where it falls the
//     truncated exponential;
//   - HENYEY-GREENSTEIN: one over the sphere, its draw's histogram its density, its mean cosine g, a draw about any axis;
//   - THE UNIFORMS: metres whatever the scene's unit, off with no haze and in Sketch and the Optics view, g held to its
//     limit;
//   - THE PHOTON'S CONNECTION FROM THE AIR (ltConnectMedium's arithmetic): a collimated beam through dust seen side on --
//     an orthographic camera against the closed form, band by band; a pinhole against the camera's own integral of the
//     same light, image-wide (dist / z^3, the volume's footprint);
//   - LIGHT SAMPLING FROM THE AIR (mediumNee + the phase function's draw, by the power heuristic): a sun and a sky, the
//     sphere's density for the sky, against the in-scattering integral;
//   - AN ALBEDO-1 SLAB walked through: every photon leaves it, and the share that met nothing is exp(-tau).
//======================================================================================================================
import { hazeUniforms, hazeSpanJS, hazeTrJS, hgEvalJS, hgCosJS, hgSampleJS, hazeCollideJS, HAZE_G_MAX } from '../haze.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const rng = (seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 })(4242)
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = a => { const l = Math.hypot(...a); return a.map(v => v / l) }
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const sphere = () => { const z = 1 - 2 * rng(), s = Math.sqrt(1 - z * z), p = 2 * Math.PI * rng(); return [s * Math.cos(p), s * Math.sin(p), z] }
// a turned frame: three unit axes from a random rotation
const frame = () => { const a = sphere(); let b = norm(cross(a, sphere())); return [a, b, cross(a, b)] }
const box = ({ centre = [0, 0, 0], axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], half = [1, 1, 1], mfp = 1, albedo = [1, 1, 1], g = 0 } = {}) =>
    hazeUniforms({ centre, axes, half, mfp, albedo, g }, 1, 0)
const inside = (u, p, R) => {
    const o = sub(p, u.hazeC)
    return [u.hazeU, u.hazeV, u.hazeW].every(a => Math.abs(dot(o, a)) <= a[3]) && dot(p, p) <= R * R
}

/*----------------------------------------------------------------------------------------------------------------------
  THE BOX: a segment's stretch inside it, against stepping along the segment
----------------------------------------------------------------------------------------------------------------------*/
{
    let worst = 0, cases = 0
    for (let k = 0; k < 400; k++) {
        const u = box({ centre: [rng() - 0.5, rng() - 0.5, rng() - 0.5], axes: frame(), half: [0.1 + rng(), 0.1 + rng(), 0.1 + rng()] })
        const R = k % 5 === 0 ? 0.6 + rng() : 100                // every fifth: the radius cutting the box
        const A = [3 * (rng() - 0.5), 3 * (rng() - 0.5), 3 * (rng() - 0.5)], d = sphere(), len = k % 7 === 0 ? 0 : 4 * rng()
        const s = hazeSpanJS(u, A, d, len, R)
        const N = 4000
        let n = 0
        for (let i = 0; i < N; i++) if (inside(u, add(A, d, (i + 0.5) / N * len), R)) n++
        const brute = n / N * len, got = Math.max(0, s[1] - s[0])
        worst = Math.max(worst, Math.abs(brute - got)); cases++
    }
    ok('a segment\'s stretch in a turned box and the radius is what stepping along it finds', worst < 4 * 4 / 4000 * 1.01, `worst ${worst}`)
    // a face parallel to the segment: inside the slab all of it, outside none
    const u = box({ half: [1, 1, 1] })
    const sIn = hazeSpanJS(u, [-2, 0.5, 0], [1, 0, 0], 4, 100), sOut = hazeSpanJS(u, [-2, 1.5, 0], [1, 0, 0], 4, 100)
    ok('a segment parallel to two faces, inside them: the box\'s width', Math.abs(sIn[1] - sIn[0] - 2) < 1e-12, JSON.stringify(sIn))
    ok('...outside them: nothing', !(sOut[1] > sOut[0]), JSON.stringify(sOut))
    const s0 = hazeSpanJS(u, [0, 0, 0], [0, 0, 1], 0, 100)
    ok('a zero-length segment inside the box: nothing to cross', !(s0[1] - s0[0] > 0), JSON.stringify(s0))
    ok('a start inside: from 0', Math.abs(hazeSpanJS(u, [0.2, 0, 0], [1, 0, 0], 5, 100)[0]) < 1e-12)
    ok('the transmittance of a crossing: exp(-sigma width)', Math.abs(hazeTrJS(box({ mfp: 0.5 }), [-3, 0, 0], [1, 0, 0], 6, 100) - Math.exp(-4)) < 1e-12)
    ok('no haze: transmittance 1', hazeTrJS(hazeUniforms(null), [-3, 0, 0], [1, 0, 0], 6, 100) === 1)
}

/*----------------------------------------------------------------------------------------------------------------------
  THE COLLISION: its probability on the stretch, and where it falls
----------------------------------------------------------------------------------------------------------------------*/
{
    const u = box({ half: [1, 1, 1], mfp: 1.25 }), sigma = 0.8
    const A = [-3, 0.2, -0.1], d = [1, 0, 0], len = 6, N = 200000
    const bins = new Array(10).fill(0)
    let hits = 0
    for (let i = 0; i < N; i++) {
        const t = hazeCollideJS(u, A, d, len, 100, rng())
        if (t < 0) continue
        hits++
        const x = t - 2                                     // the stretch is t in [2, 4]
        bins[Math.min(9, Math.floor(x / 0.2))]++
    }
    const P = 1 - Math.exp(-sigma * 2), se = Math.sqrt(P * (1 - P) / N)
    ok('a collision with probability 1 - exp(-sigma L) on the stretch', Math.abs(hits / N - P) < 4 * se, `${hits / N} vs ${P} +- ${se}`)
    let chi = 0
    for (let b = 0; b < 10; b++) {
        const pb = (Math.exp(-sigma * 0.2 * b) - Math.exp(-sigma * 0.2 * (b + 1))) / P
        chi += (bins[b] - hits * pb) ** 2 / (hits * pb)
    }
    ok('...where it falls: the exponential truncated to the stretch (chi^2, 9 dof)', chi < 27.9, `chi2 ${chi.toFixed(2)}`)
    ok('a leg that misses the box: none', hazeCollideJS(u, [-3, 5, 0], d, len, 100, 0.999) === -1)
}

/*----------------------------------------------------------------------------------------------------------------------
  HENYEY-GREENSTEIN
----------------------------------------------------------------------------------------------------------------------*/
for (const g of [-0.9, -0.5, 0, 0.3, 0.7, 0.9]) {
    // one over the sphere: 2 pi times the integral over the cosine, by Simpson's rule on a fine grid
    const M = 20000
    let I = 0
    for (let i = 0; i <= M; i++) { const c = -1 + 2 * i / M, w = i === 0 || i === M ? 1 : i % 2 ? 4 : 2; I += w * hgEvalJS(c, g) }
    I *= 2 / M / 3 * 2 * Math.PI
    ok(`HG g=${g}: one over the sphere`, Math.abs(I - 1) < 1e-4, `${I}`)
    // its draw: the cosine's histogram is the density, and the mean cosine is g
    const N = 100000, B = 20, bins = new Array(B).fill(0)
    let mean = 0
    for (let i = 0; i < N; i++) { const c = hgCosJS(g, rng()); mean += c; bins[Math.min(B - 1, Math.floor((c + 1) / 2 * B))]++ }
    mean /= N
    let chi = 0
    for (let b = 0; b < B; b++) {
        let pb = 0
        for (let k = 0; k < 200; k++) { const c = -1 + (b + (k + 0.5) / 200) * 2 / B; pb += hgEvalJS(c, g) * 2 * Math.PI * (2 / B) / 200 }
        chi += (bins[b] - N * pb) ** 2 / Math.max(N * pb, 1e-9)
    }
    ok(`HG g=${g}: the draw's histogram is the density (chi^2, 19 dof)`, chi < 43.8, `chi2 ${chi.toFixed(2)}`)
    ok(`HG g=${g}: the mean cosine is g`, Math.abs(mean - g) < 0.01, `${mean}`)
}
{
    const d = norm([0.3, -0.7, 0.2]), g = 0.6
    let worst = 0
    for (let i = 0; i < 1000; i++) {
        const u0 = rng(), w = hgSampleJS(d, g, [u0, rng()])
        worst = Math.max(worst, Math.abs(Math.hypot(...w) - 1), Math.abs(dot(w, d) - hgCosJS(g, u0)))
    }
    ok('a draw about any axis: a unit direction at the drawn cosine to it', worst < 1e-12, `${worst}`)
    ok('symmetric: p(cos; g) = p(-cos; -g)', Math.abs(hgEvalJS(0.4, 0.7) - hgEvalJS(-0.4, -0.7)) < 1e-15)
}

/*----------------------------------------------------------------------------------------------------------------------
  THE UNIFORMS
----------------------------------------------------------------------------------------------------------------------*/
{
    const haze = { centre: [100, 0, 50], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], half: [250, 100, 80], mfp: 2, albedo: [0.9, 0.8, 0.7], g: 0.7 }
    const mm = hazeUniforms(haze, 0.001, 0), m = hazeUniforms({ ...haze, centre: [0.1, 0, 0.05], half: [0.25, 0.1, 0.08] }, 1, 0)
    const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-12)
    ok('a box in mm and the same box in m: the same metres', ['hazeC', 'hazeU', 'hazeV', 'hazeW', 'hazeA'].every(k => close(mm[k], m[k])), JSON.stringify([mm, m]))
    ok('the extinction is one over the mean free path, per metre, in any unit', mm.hazeC[3] === 0.5)
    for (const mode of [2, 3]) ok(`render mode ${mode} (Sketch, the Optics view): no haze`, hazeUniforms(haze, 1, mode).hazeC[3] === 0)
    ok('Draft keeps it', hazeUniforms(haze, 1, 1).hazeC[3] === 0.5)
    ok('no box: no haze', hazeUniforms(null).hazeC[3] === 0 && hazeUniforms(undefined, 1, 0).hazeC[3] === 0)
    ok('a mean free path of 0: no haze, not an infinite one', hazeUniforms({ ...haze, mfp: 0 }).hazeC[3] === 0)
    ok('g held within its limit', hazeUniforms({ ...haze, g: 1 }).hazeA[3] === HAZE_G_MAX && hazeUniforms({ ...haze, g: -3 }).hazeA[3] === -HAZE_G_MAX)
    ok('the albedo held to 0..1', close(hazeUniforms({ ...haze, albedo: [2, -1, 0.5] }).hazeA.slice(0, 3), [1, 0, 0.5]))
}

/*----------------------------------------------------------------------------------------------------------------------
  THE PHOTON'S CONNECTION FROM THE AIR: a collimated beam of flux PHI along +x, w x w through y, z in [-w/2, w/2],
  entering the dust at x = 0. The dust fills x in [0, X], y, z in [-B, B]. Photons end at their first collision (a sun's
  do; this keeps single scattering, which the closed form is) and connect from it -- ltConnectMedium's splat,
  flux x albedo x p x G / A_px, dimmed by the dust on the way to the camera.
----------------------------------------------------------------------------------------------------------------------*/
const beam = { PHI: 2, w: 0.1, X: 1, B: 0.3, mfp: 0.5, albedo: 0.8, g: 0.6 }
const beamBox = hazeUniforms({ centre: [beam.X / 2, 0, 0], half: [beam.X / 2, beam.B, beam.B], mfp: beam.mfp, albedo: [beam.albedo, beam.albedo, beam.albedo], g: beam.g }, 1, 0)
const shootBeam = (N, connect) => {
    const sigma = 1 / beam.mfp
    for (let i = 0; i < N; i++) {
        const A = [-0.5, (rng() - 0.5) * beam.w, (rng() - 0.5) * beam.w]
        const t = hazeCollideJS(beamBox, A, [1, 0, 0], 3, 100, rng())
        if (t < 0) continue
        connect(add(A, [1, 0, 0], t), beam.PHI / N * beam.albedo)    // beta: the albedo, the free flight's weight
    }
    return sigma
}
{
    // ORTHOGRAPHIC, looking down -y from y = 2 at the x-z plane: pixels of 0.05 x 0.05, G = 1
    const px = 0.05, cols = 20, rows = 4                          // x in [0, 1], z in [-0.1, 0.1]
    const img = new Float64Array(cols * rows), img2 = new Float64Array(cols * rows)
    const N = 400000
    const sigma = shootBeam(N, (P, flux) => {
        const c = Math.floor(P[0] / px), r = Math.floor((P[2] + 0.1) / px)
        if (c < 0 || c >= cols || r < 0 || r >= rows) return
        const p = hgEvalJS(dot([1, 0, 0], [0, 1, 0]), beam.g)
        const T = hazeTrJS(beamBox, P, [0, 1, 0], 10, 100)
        const v = flux * p * 1 / (px * px) * T
        img[r * cols + c] += v; img2[r * cols + c] += v * v
    })
    // the closed form, for a pixel at x in [x0, x0 + px], wholly inside the beam's height: albedo p E e^{-sigma x}
    // e^{-sigma B} 2 sinh(sigma w / 2) / sigma * sigma  (the camera's ray through the beam's width, dimmed to the box's top)
    const E = beam.PHI / (beam.w * beam.w), p0 = hgEvalJS(0, beam.g)
    let worst = 0, worstZ = 0
    for (let c = 0; c < cols; c++) {
        const x0 = c * px, mx = (Math.exp(-sigma * x0) - Math.exp(-sigma * (x0 + px))) / (sigma * px)   // e^{-sigma x} over the pixel
        const L = beam.albedo * p0 * E * mx * Math.exp(-sigma * beam.B) * 2 * Math.sinh(sigma * beam.w / 2)
        for (const r of [1, 2]) {                               // the two rows inside the beam (z in [-0.05, 0.05])
            const i = r * cols + c, mean = img[i], se = Math.sqrt(Math.max(img2[i] - mean * mean / N, 0))
            worst = Math.max(worst, Math.abs(mean - L) / L)
            worstZ = Math.max(worstZ, Math.abs(mean - L) / se)
        }
    }
    ok('a collimated beam in dust seen side on, orthographic: every band its closed form (single scattering, dimmed both ways)',
       worstZ < 4.5, `worst ${(100 * worst).toFixed(2)}%, ${worstZ.toFixed(2)} error bars`)
    ok('...and nothing outside the beam\'s height', img[0] === 0 && img[3 * cols + 5] === 0)
}
{
    // A PINHOLE at C, looking at the beam from the side and a little above: the photons' splats (G = dist / z^3) summed
    // over the picture against the camera's own estimate of the same light, ray by ray -- the integral along each pixel's
    // ray of sigma_s p E(x) T(to the camera), by quadrature. The image-wide sum tests the volume's footprint.
    const C = [0.5, 1.6, 0.4], target = [0.5, 0, 0]
    const fwd = norm(sub(C, target)), right = norm(cross([0, 0, 1], fwd)), up = cross(fwd, right)
    const W = 48, H = 32, fx = Math.tan(25 * Math.PI / 180), fy = fx * H / W, apx = 4 * fx * fy / (W * H)
    const sigma = 1 / beam.mfp
    let photonSum = 0, photonSum2 = 0
    const N = 400000
    shootBeam(N, (P, flux) => {
        const d = sub(C, P), dist = Math.hypot(...d), z = dot(d, fwd)
        if (z <= 1e-4) return
        const v = d.map(c => c / dist)
        const xy = [-dot(d, right) / (z * fx), -dot(d, up) / (z * fy)]
        if (Math.abs(xy[0]) >= 1 || Math.abs(xy[1]) >= 1) return
        const G = dist / (z * z * z)
        const T = hazeTrJS(beamBox, P, v, dist, 100)
        const s = flux * hgEvalJS(dot([1, 0, 0], v), beam.g) * G / apx * T
        photonSum += s; photonSum2 += s * s
    })
    const E = beam.PHI / (beam.w * beam.w)
    let camSum = 0
    const SS = 4                                                   // rays a pixel, stratified
    for (let py = 0; py < H; py++) for (let qx = 0; qx < W; qx++) for (let s = 0; s < SS * SS; s++) {
        const x = -1 + (qx + ((s % SS) + 0.5) / SS) * 2 / W, y = -1 + (py + (Math.floor(s / SS) + 0.5) / SS) * 2 / H
        const dir = norm(add(add(right.map(c => c * x * fx), up, y * fy), fwd, -1))   // the pixel ltConnect's xy = (x, y) finds
        // the beam's slab along this ray: y, z in [-w/2, w/2], x in [0, X]
        let t0 = 0, t1 = 10
        for (const [k, lo, hi] of [[0, 0, beam.X], [1, -beam.w / 2, beam.w / 2], [2, -beam.w / 2, beam.w / 2]]) {
            if (Math.abs(dir[k]) < 1e-12) { if (C[k] < lo || C[k] > hi) { t1 = -1 } continue }
            const a = (lo - C[k]) / dir[k], b = (hi - C[k]) / dir[k]
            t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b))
        }
        if (!(t1 > t0)) continue
        const K = 64, p = hgEvalJS(dot([1, 0, 0], dir.map(c => -c)), beam.g)
        let L = 0
        for (let k = 0; k < K; k++) {
            const t = t0 + (k + 0.5) / K * (t1 - t0), P = add(C, dir, t)
            L += beam.albedo * sigma * p * E * Math.exp(-sigma * P[0]) * hazeTrJS(beamBox, P, dir.map(c => -c), t, 100)
        }
        camSum += L * (t1 - t0) / K / (SS * SS)
    }
    const se = Math.sqrt(Math.max(photonSum2 - photonSum * photonSum / N, 0))
    ok('a pinhole: the photons\' splats over the picture are the camera\'s own integral of the same light (dist / z^3)',
       Math.abs(photonSum - camSum) < 4 * se + 0.005 * camSum, `photons ${photonSum.toFixed(5)} +- ${se.toFixed(5)}, camera ${camSum.toFixed(5)}`)
}

/*----------------------------------------------------------------------------------------------------------------------
  LIGHT SAMPLING FROM THE AIR: at one point, a sun (a cone of half-angle 2 degrees, radiance Ls) and a uniform sky Lk.
  The in-scattered radiance towards -d is  int p L  =  Lk + Ls int_cone p,  drawn two ways and weighed by the power
  heuristic (mediumNee, and the phase function's draw in mediumVertex): the sun's cone with neeSunPick, else the sphere.
----------------------------------------------------------------------------------------------------------------------*/
{
    const S = norm([0.3, 0.2, 0.9]), half = 2 * Math.PI / 180, cosH = Math.cos(half), Om = 2 * Math.PI * (1 - cosH)
    const Ls = 1000, Lk = 3, pick = 0.5
    const inSun = L => dot(L, S) >= cosH
    const Lenv = L => Lk + (inSun(L) ? Ls : 0)
    const envPdfM = L => pick * (inSun(L) ? 1 / Om : 0) + (1 - pick) / (4 * Math.PI)
    const sunCone = () => {
        const omc = rng() * (1 - cosH), c = 1 - omc, s = Math.sqrt(omc * (2 - omc)), ph = 2 * Math.PI * rng()
        const t = Math.abs(S[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0], b1 = norm(cross(t, S)), b2 = cross(S, b1)
        return [0, 1, 2].map(k => b1[k] * Math.cos(ph) * s + b2[k] * Math.sin(ph) * s + S[k] * c)
    }
    const mis = (a, b) => a * a / Math.max(a * a + b * b, 1e-300)
    for (const g of [0, 0.7, -0.4]) {
        const d = norm([0.5, -0.3, 0.6])                         // travelling this way; the sun 'behind' or 'ahead' by g
        // the reference: Lk + Ls times the phase function over the cone, by quadrature
        let cone = 0
        const M = 400
        for (let i = 0; i < M; i++) for (let j = 0; j < 64; j++) {
            const omc = (i + 0.5) / M * (1 - cosH), c = 1 - omc, s = Math.sqrt(omc * (2 - omc)), ph = 2 * Math.PI * (j + 0.5) / 64
            const t = Math.abs(S[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0], b1 = norm(cross(t, S)), b2 = cross(S, b1)
            const L = [0, 1, 2].map(k => b1[k] * Math.cos(ph) * s + b2[k] * Math.sin(ph) * s + S[k] * c)
            cone += hgEvalJS(dot(d, L), g) * Om / (M * 64)
        }
        const ref = Lk + Ls * cone
        const N = 400000
        let sum = 0, sum2 = 0
        for (let n = 0; n < N; n++) {
            let v = 0
            // the light sample
            const L = rng() < pick ? sunCone() : sphere()
            const pS = envPdfM(L), f = hgEvalJS(dot(d, L), g)
            v += f * Lenv(L) * mis(pS, f) / pS
            // the phase function's own draw, meeting the environment
            const w = hgSampleJS(d, g, [rng(), rng()])
            const pB = hgEvalJS(dot(d, w), g)
            v += Lenv(w) * mis(pB, envPdfM(w))                    // its weight f / pdf is 1
            sum += v; sum2 += v * v
        }
        const mean = sum / N, se = Math.sqrt((sum2 / N - mean * mean) / N)
        ok(`light sampling from the air, g=${g}: the sun and the sky by the power heuristic are the in-scattering integral`,
           Math.abs(mean - ref) < 4 * se, `${mean.toFixed(3)} +- ${se.toFixed(3)} vs ${ref.toFixed(3)}`)
    }
}

/*----------------------------------------------------------------------------------------------------------------------
  AN ALBEDO-1 SLAB, WALKED THROUGH: photons in along +x through x in [0, 1], wide in y and z; every one leaves through
  one face or the other, and the share that met nothing is exp(-tau)
----------------------------------------------------------------------------------------------------------------------*/
{
    const u = box({ centre: [0.5, 0, 0], half: [0.5, 1e4, 1e4], mfp: 0.5, g: 0.5 })
    const N = 50000
    let through = 0, back = 0, clear = 0, lost = 0
    for (let i = 0; i < N; i++) {
        let P = [-0.1, 0, 0], d = [1, 0, 0], k = 0
        for (; k < 10000; k++) {
            const t = hazeCollideJS(u, P, d, 100, 1e6, rng())
            if (t < 0) { if (d[0] > 0) through++; else back++; if (k === 0) clear++; break }
            P = add(P, d, t)
            d = hgSampleJS(d, 0.5, [rng(), rng()])
        }
        if (k === 10000) lost++
    }
    ok('an albedo-1 slab: every photon leaves it, through one face or the other', through + back === N && lost === 0, `${through} + ${back} + lost ${lost}`)
    const P0 = Math.exp(-2), se = Math.sqrt(P0 * (1 - P0) / N)
    ok('...and the share that met nothing is exp(-tau)', Math.abs(clear / N - P0) < 4 * se, `${clear / N} vs ${P0}`)
}

console.log(`haze: ${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
