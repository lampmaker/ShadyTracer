// tools/causticlens.mjs: a caustic lens's height map from a picture, no GPU.
//   - its 16-bit PNG read back by ShadyTracer's own decoder (builder/images.js decodePNG16) exactly, and by its own;
//   - the Neumann Poisson solver against a function whose Laplacian is known;
//   - the B-spline coefficients: heightAtJS (the GPU lookup's twin) through them passes through the designed heights;
//   - a small design traced through the heights as heightAt reads them, the screen's light like the picture's;
//   - twice the distance about half the relief (the paraxial (n - 1) d grad h = displacement).
import assert from 'node:assert/strict'
import { decodePNG, encodeGreyPNG, poissonSolver, design, asRendererReads, preview, correlation, targetOf } from '../causticlens.mjs'
import { decodePNG16 } from '../../builder/images.js'
import { heightAtJS } from '../../lib/pathtracer/core/images.js'

let failed = 0
async function test(name, fn) {
    try { await fn(); console.log(`ok   ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 3).join('\n     ')}`) }
}

// a picture: a bright ring and a block on a dark ground, nx x ny, first row the top
function picture(nx, ny) {
    const t = new Float64Array(nx * ny)
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const r = Math.hypot(i + 0.5 - nx * 0.33, j + 0.5 - ny * 0.5)
        t[j * nx + i] = Math.abs(r - ny * 0.28) < ny * 0.07 || (i > nx * 0.65 && i < nx * 0.9 && j > ny * 0.2 && j < ny * 0.5) ? 1 : 0.1
    }
    return t
}

await test('the 16-bit height map reads back exactly through ShadyTracer\'s own decoder, and through the script\'s', async () => {
    const w = 37, h = 23, s = new Uint16Array(w * h)
    for (let k = 0; k < w * h; k++) s[k] = (k * 2654435761) % 65536
    const png = encodeGreyPNG(s, w, h, 16)
    const d = await decodePNG16(new Uint8Array(png))
    assert.equal(d.width, w); assert.equal(d.height, h)
    assert.deepEqual(Array.from(d.gray), Array.from(s))
    const own = decodePNG(png)
    for (let k = 0; k < w * h; k++) assert.equal(Math.round(own.rgba[4 * k] * 65535), s[k])
    const s8 = Uint8Array.from(s, v => v >> 8), own8 = decodePNG(encodeGreyPNG(s8, w, h, 8))
    for (let k = 0; k < w * h; k++) assert.equal(Math.round(own8.rgba[4 * k] * 255), s8[k])
})

await test('the Poisson solver: a sum of cosines whose Laplacian is known, Neumann at the edge', () => {
    const nx = 24, ny = 16, h = 0.5, solve = poissonSolver(nx, ny, h)
    // cos(pi kx (i + 1/2) / nx) is an eigenvector of the 5-point Laplacian with mirrored ghosts: its eigenvalue exact
    const lam = (k, n) => (2 * Math.cos(Math.PI * k / n) - 2) / (h * h)
    const u = new Float64Array(nx * ny), f = new Float64Array(nx * ny)
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const a = Math.cos(Math.PI * 3 * (i + 0.5) / nx), b = Math.cos(Math.PI * 2 * (j + 0.5) / ny)
        u[j * nx + i] = a * b + 0.5 * a
        f[j * nx + i] = (lam(3, nx) + lam(2, ny)) * a * b + 0.5 * lam(3, nx) * a + 7   // + 7: the mean is dropped
    }
    const got = solve(f)
    for (let k = 0; k < nx * ny; k++) assert.ok(Math.abs(got[k] - u[k]) < 1e-9, `${k}: ${got[k]} vs ${u[k]}`)
})

const nx = 48, ny = 32, size = [48, 32]
const target = picture(nx, ny)
const d = design(target, nx, ny, { size, distance: 300, n: 1.5 })
const R = asRendererReads(d.coefficients, nx, ny, size)

await test('the coefficients are 0..1 and heightAt through them passes through the designed heights', () => {
    for (const c of d.coefficients) assert.ok(c >= 0 && c <= 1)
    let worst = 0
    // inside, away from the edge, where the prefilter's start and heightAt's clamp do not reach
    for (let j = 4; j < ny - 4; j++) for (let i = 4; i < nx - 4; i++) {
        const x = (i + 0.5) - size[0] / 2, y = size[1] / 2 - (j + 0.5)
        const got = d.amplitude * heightAtJS(R.slot, R.img, [x, y, 0])[0]
        worst = Math.max(worst, Math.abs(got - d.heights[j * nx + i]))
    }
    // measured when written: 6e-6 of the amplitude, the 16 bits' rounding
    assert.ok(worst < 3e-5 * d.amplitude, `worst ${worst} mm of ${d.amplitude} mm`)
})

await test('traced through the heights as heightAt reads them, the screen\'s light is the picture\'s', () => {
    const p = preview(R.img, R.slot, nx, ny, { size, amplitude: d.amplitude, distance: 300, n: 1.5, spp: 6 })
    const r = correlation(p.light, d.aimed, nx, ny)
    console.log(`     correlation ${r.toFixed(4)}`)
    // measured here when written: 0.98 (the script's own model: no Fresnel, no second face)
    assert.ok(r > 0.95, `correlation ${r}`)
    // ...and the picture flipped, or a flat plate, nothing like it: the check can fail
    const flipped = Float64Array.from(d.aimed, (_, k) => d.aimed[(ny - 1 - Math.floor(k / nx)) * nx + (k % nx)])
    assert.ok(correlation(p.light, flipped, nx, ny) < 0.6)
    const flat = asRendererReads(new Float64Array(nx * ny), nx, ny, size)
    const q = preview(flat.img, flat.slot, nx, ny, { size, amplitude: 0, distance: 300, n: 1.5, spp: 6 })
    assert.ok(!(correlation(q.light, d.aimed, nx, ny) > 0.3))
})

await test('twice the distance, about half the relief', () => {
    const far = design(target, nx, ny, { size, distance: 600, n: 1.5 })
    const ratio = far.amplitude / d.amplitude
    assert.ok(Math.abs(ratio - 0.5) < 0.03, `ratio ${ratio}`)
})

await test('a picture read as light: sRGB decoded, its area averaged', () => {
    const img = { width: 4, height: 2, rgba: new Float32Array(32).fill(1) }
    for (let k = 0; k < 8; k++) if (k % 4 < 2) { img.rgba[4 * k] = img.rgba[4 * k + 1] = img.rgba[4 * k + 2] = 0.5 }
    const t = targetOf(img, 2, 1)
    const half = Math.pow((0.5 + 0.055) / 1.055, 2.4)
    assert.ok(Math.abs(t[0] - half) < 1e-6 && Math.abs(t[1] - 1) < 1e-6, String(Array.from(t)))
    assert.ok(Math.abs(targetOf(img, 2, 1, { linear: true })[0] - 0.5) < 1e-6)
})

if (failed) { console.log(`${failed} failed`); process.exit(1) }
console.log('all passed')
