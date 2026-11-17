#!/usr/bin/env node
//======================================================================================================================
// A CAUSTIC LENS FROM A PICTURE (0.next): the height map of a glass plate that throws a picture onto a screen.
//
//   node tools/causticlens.mjs picture.png [--size 100] [--distance 500] [--n 1.49] [--grid 384] [--out name]
//
// Collimated light (the sun, perpendicular to the plate) enters the plate's flat face, leaves through its relief, and
// lands on a screen parallel to the plate at `distance` mm from the relief's foot. Nothing is blocked: the relief only
// moves light, so where the picture is dark its light has gone to where it is bright. What comes out is a 16-bit grey
// PNG for a material's "relief from an image texture" (builder/materials.js pictureRelief) and the numbers to set
// beside it -- and a preview of what the screen receives, traced through the heights exactly as the renderer reads them.
//
// HOW (the user asked in chat, 2026-11-16: "with caustics you could make a picture -- how does that work?"):
//  1. THE MAP. Each point x of the plate (light arriving evenly) has to land at T(x) on the screen so that the light
//     per area there is the picture's. Energy kept: det DT(x) = 1 / picture(T(x)) -- the Monge-Ampere equation, whose
//     solution T = grad u with u convex is the optimal transport map (and a gradient, so a surface can make it). Solved
//     here with u = |x|^2/2 + phi by the fixed point (Delta u)^2 = (u_xx - u_yy)^2 + 4 u_xy^2 + 4 det, i.e.
//       Delta phi_{k+1} = sqrt((phi_xx - phi_yy)^2 + 4 phi_xy^2 + 4 / picture(x + grad phi_k)) - 2
//     a Poisson equation each step (Neumann: the plate's edge maps along the screen's edge), solved by cosine transform.
//     At phi = 0 it is the linearised design Delta phi = 1/picture - 1 exactly; the steps after it take the rest of the
//     non-linearity. The picture's contrast is brought in over the first steps (a picture of high contrast straight
//     away sends the iteration off). The picture's darkest is lifted to `floor` of its brightest: a black pixel would ask
//     for infinite spreading.
//  2. THE NORMALS. Each point's ray has to leave towards T(x) (scaled by --magnify) at the screen's distance: Snell's
//     law in vector form puts the normal along n * in - out, so the slope is out.xy / (n - out.z). Not the paraxial
//     slope (n - 1) grad h: the angles here are a few degrees to tens of degrees.
//  3. THE HEIGHTS. Those slopes are integrated by least squares (Delta h = div g, Neumann), three times over, the
//     ray's start moved to the height found.
//  4. AS THE RENDERER READS THEM. heightAt (core/images.js) is a cubic B-spline OF the pixels, which smooths them; a
//     B-spline's coefficients are found here that make it pass through the heights (a tridiagonal solve a line, ends
//     padded as heightAt's clamp pads them), and those are written, normalised to 0..1 by their range: the relief's
//     amplitude. The spline's weights are positive and sum to 1, so it never leaves 0..1, which heightAt clamps to.
//  5. THE PREVIEW traces rays through heightAtJS -- the GPU lookup's JS twin, on the 16-bit file's own bytes and the
//     slot the renderer would build -- refracts them exactly (TIR lost), within the sun's disc if asked, and bins them
//     on the screen. Its correlation with the picture is printed: the design's own check, in this model. It is NOT a
//     render: no Fresnel loss, no second face, no photon map. Whether ShadyTracer shows the picture is the user's to see.
//
// THE PLATE IN THE SCENE. A relief raises EVERY face of its object by h(x, y), the flat underside too (codegen: the
// object's distance minus h). Light through two relief faces is bent about twice as much and the design is wrong. So
// the underside has to be flat: intersect the relief slab with a box whose bottom is the slab's and whose top is far
// above, in a glass material of the same index WITHOUT the relief. The script prints the rest.
//
// No dependency: node's zlib for the PNGs; the heights' lookup and statistics are the engine's own (core/images.js).
//======================================================================================================================
import { readFileSync, writeFileSync } from 'node:fs'
import { inflateSync, deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { slotMatrix, heightAtJS, heightStats, pack16 } from '../lib/pathtracer/core/images.js'

//---------------------------------------------------------------------------------------------------------------------
// PNG in and out
//---------------------------------------------------------------------------------------------------------------------
const CRC_TABLE = (() => {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
    return t
})()
const crc32 = (bytes) => { let c = 0xffffffff; for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/** Any non-interlaced PNG (grey, grey + alpha, RGB, RGBA at 8 or 16 bits; palette or grey at 1-8) as
 *  { width, height, rgba: Float32Array 0..1 }. Throws, saying why. */
export function decodePNG(buf) {
    buf = Buffer.from(buf)
    if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG file')
    let o = 8, ihdr = null, plte = null, trns = null
    const idat = []
    while (o + 8 <= buf.length) {
        const len = buf.readUInt32BE(o), type = buf.toString('latin1', o + 4, o + 8), data = buf.subarray(o + 8, o + 8 + len)
        if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), bits: data[8], ct: data[9], il: data[12] }
        else if (type === 'PLTE') plte = data
        else if (type === 'tRNS') trns = data
        else if (type === 'IDAT') idat.push(data)
        else if (type === 'IEND') break
        o += 12 + len
    }
    if (!ihdr) throw new Error('PNG without IHDR')
    const { w, h, bits, ct, il } = ihdr
    if (il) throw new Error('interlaced PNGs are not read: save it without interlacing')
    const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct]
    if (!ch) throw new Error(`PNG colour type ${ct} unknown`)
    if (ct === 3 && !plte) throw new Error('palette PNG without a palette')
    const bpp = Math.max(1, (ch * bits) >> 3), stride = (w * ch * bits + 7) >> 3
    const raw = inflateSync(Buffer.concat(idat))
    if (raw.length < h * (stride + 1)) throw new Error('PNG data shorter than its size')
    const px = new Uint8Array(h * stride)
    for (let y = 0; y < h; y++) {
        const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = y * stride
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? px[row + x - bpp] : 0, b = y ? px[row - stride + x] : 0, c = x >= bpp && y ? px[row - stride + x - bpp] : 0
            let v = src[x]
            if (f === 1) v += a
            else if (f === 2) v += b
            else if (f === 3) v += (a + b) >> 1
            else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
            else if (f !== 0) throw new Error(`PNG row filter ${f} unknown`)
            px[row + x] = v & 255
        }
    }
    const max = (1 << bits) - 1
    const sample = (y, i) => {                       // the i-th sample of row y, 0..max
        if (bits === 16) return (px[y * stride + 2 * i] << 8) | px[y * stride + 2 * i + 1]
        if (bits === 8) return px[y * stride + i]
        const bit = i * bits, byte = px[y * stride + (bit >> 3)]
        return (byte >> (8 - bits - (bit & 7))) & max
    }
    const rgba = new Float32Array(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const k = 4 * (y * w + x)
        if (ct === 3) {
            const i = sample(y, x)
            rgba[k] = plte[3 * i] / 255; rgba[k + 1] = plte[3 * i + 1] / 255; rgba[k + 2] = plte[3 * i + 2] / 255
            rgba[k + 3] = trns && i < trns.length ? trns[i] / 255 : 1
        } else {
            const s = j => sample(y, x * ch + j) / max
            if (ch <= 2) { rgba[k] = rgba[k + 1] = rgba[k + 2] = s(0); rgba[k + 3] = ch === 2 ? s(1) : 1 }
            else { rgba[k] = s(0); rgba[k + 1] = s(1); rgba[k + 2] = s(2); rgba[k + 3] = ch === 4 ? s(3) : 1 }
        }
    }
    return { width: w, height: h, rgba }
}

const chunk = (type, data) => {
    const t = Buffer.from(type, 'latin1'), len = Buffer.alloc(4), crc = Buffer.alloc(4)
    len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
    return Buffer.concat([len, t, data, crc])
}
/** A grey PNG, 8 or 16 bits, from integer samples (first row the top). */
export function encodeGreyPNG(samples, width, height, bits = 16) {
    const bpx = bits / 8, stride = width * bpx, raw = Buffer.alloc(height * (stride + 1))
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const v = samples[y * width + x], o = y * (stride + 1) + 1 + x * bpx
        if (bits === 16) raw.writeUInt16BE(v, o); else raw[o] = v
    }
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = bits; ihdr[9] = 0
    return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

//---------------------------------------------------------------------------------------------------------------------
// The Neumann Poisson solver: the 5-point Laplacian with mirrored ghosts (u[-1] = u[0]) is diagonal in the DCT-II basis
//---------------------------------------------------------------------------------------------------------------------
function cosTable(N) {
    const t = new Float64Array(N * N)
    for (let k = 0; k < N; k++) for (let n = 0; n < N; n++) t[k * N + n] = Math.cos(Math.PI * k * (n + 0.5) / N)
    return t
}
/** A Poisson solver on an nx x ny grid of spacing h: solve(rhs) is the u with Laplacian rhs - mean(rhs), mean 0. */
export function poissonSolver(nx, ny, h) {
    const cx = cosTable(nx), cy = cosTable(ny), tmp = new Float64Array(nx * ny), lam = new Float64Array(nx * ny)
    for (let ky = 0; ky < ny; ky++) for (let kx = 0; kx < nx; kx++)
        lam[ky * nx + kx] = (2 * Math.cos(Math.PI * kx / nx) - 2 + 2 * Math.cos(Math.PI * ky / ny) - 2) / (h * h)
    const rowLine = new Float64Array(Math.max(nx, ny)), out = new Float64Array(Math.max(nx, ny))
    // along x of every row, then along y of every column; inv: the inverse (DCT-III with its weights)
    function pass(a, b, inv) {
        for (let y = 0; y < ny; y++) {
            for (let x = 0; x < nx; x++) rowLine[x] = a[y * nx + x]
            for (let k = 0; k < nx; k++) {
                let s = 0
                if (inv) { s = rowLine[0] / nx; for (let m = 1; m < nx; m++) s += (2 / nx) * rowLine[m] * cx[m * nx + k] }
                else for (let n = 0; n < nx; n++) s += rowLine[n] * cx[k * nx + n]
                out[k] = s
            }
            for (let x = 0; x < nx; x++) tmp[y * nx + x] = out[x]
        }
        for (let x = 0; x < nx; x++) {
            for (let y = 0; y < ny; y++) rowLine[y] = tmp[y * nx + x]
            for (let k = 0; k < ny; k++) {
                let s = 0
                if (inv) { s = rowLine[0] / ny; for (let m = 1; m < ny; m++) s += (2 / ny) * rowLine[m] * cy[m * ny + k] }
                else for (let n = 0; n < ny; n++) s += rowLine[n] * cy[k * ny + n]
                out[k] = s
            }
            for (let y = 0; y < ny; y++) b[y * nx + x] = out[y]
        }
    }
    return function solve(rhs) {
        const hat = new Float64Array(nx * ny), u = new Float64Array(nx * ny)
        pass(rhs, hat, false)
        hat[0] = 0                                    // the mean: Neumann's compatibility, and the constant is free
        for (let i = 1; i < nx * ny; i++) hat[i] /= lam[i]
        pass(hat, u, true)
        return u
    }
}

//---------------------------------------------------------------------------------------------------------------------
// The picture as a target
//---------------------------------------------------------------------------------------------------------------------
const srgbToLinear = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
const linearToSrgb = c => c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055

/** The picture's light (luminance times alpha; decoded from sRGB unless `linear`) resampled to nx x ny cells by area,
 *  first row the picture's top. */
export function targetOf(img, nx, ny, { linear = false } = {}) {
    const { width: W, height: H, rgba } = img
    const lum = new Float64Array(W * H)
    for (let i = 0; i < W * H; i++) {
        const d = linear ? (c => c) : srgbToLinear
        lum[i] = (0.2126 * d(rgba[4 * i]) + 0.7152 * d(rgba[4 * i + 1]) + 0.0722 * d(rgba[4 * i + 2])) * rgba[4 * i + 3]
    }
    // the summed-area table, for the mean over any rectangle of the picture (bilinear inside a pixel)
    const S = new Float64Array((W + 1) * (H + 1))
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) S[(y + 1) * (W + 1) + x + 1] = lum[y * W + x] + S[y * (W + 1) + x + 1] + S[(y + 1) * (W + 1) + x] - S[y * (W + 1) + x]
    const at = (x, y) => {                            // the integral over [0,x] x [0,y], x and y in pixels, continuous
        x = Math.min(W, Math.max(0, x)); y = Math.min(H, Math.max(0, y))
        const i = Math.min(W - 1, Math.floor(x)), j = Math.min(H - 1, Math.floor(y)), fx = x - i, fy = y - j
        const s = (a, b) => S[b * (W + 1) + a]
        return s(i, j) + fx * (s(i + 1, j) - s(i, j)) + fy * (s(i, j + 1) - s(i, j)) + fx * fy * (s(i + 1, j + 1) - s(i + 1, j) - s(i, j + 1) + s(i, j))
    }
    const t = new Float64Array(nx * ny), sx = W / nx, sy = H / ny
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        // a cell at least one pixel wide, so a grid finer than the picture is its bilinear blend rather than its steps
        const wx = Math.max(sx, 1), wy = Math.max(sy, 1), cx = (i + 0.5) * sx, cy = (j + 0.5) * sy
        const x0 = cx - wx / 2, x1 = cx + wx / 2, y0 = cy - wy / 2, y1 = cy + wy / 2
        t[j * nx + i] = (at(x1, y1) - at(x0, y1) - at(x1, y0) + at(x0, y0)) / (wx * wy)
    }
    return t
}

//---------------------------------------------------------------------------------------------------------------------
// The design
//---------------------------------------------------------------------------------------------------------------------
/**
 * @param target  nx x ny light the screen should receive, first row the top (any scale)
 * @param o       { size: [Lx, Ly] mm, distance mm, n, magnify, floor, iterations, log }
 * @returns { heights (mm, nx x ny, first row the top, min 0), coefficients (the B-spline's, 0..1), amplitude mm,
 *            map: the transport map's residual, maxAngle deg, maxSlope }
 */
export function design(target, nx, ny, o = {}) {
    const { size: [Lx, Ly], distance: D = 500, n = 1.49, magnify = 1, floor = 0.05, iterations = 80, relax = 0.5, log = () => {} } = o
    const h = Lx / nx
    if (Math.abs(Ly / ny - h) > 1e-6 * h) throw new Error('cells must be square')
    const N = nx * ny, solve = poissonSolver(nx, ny, h)
    // inside: row j counts up +y (the picture's row ny-1-j), x across; cell centres at (i+.5)h - Lx/2, (j+.5)h - Ly/2
    let tmax = 0
    for (const v of target) tmax = Math.max(tmax, v)
    if (!(tmax > 0)) throw new Error('the picture is black: there is nothing to make')
    const tgt = new Float64Array(N)
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) tgt[j * nx + i] = floor + (1 - floor) * target[(ny - 1 - j) * nx + i] / tmax
    let mean = 0
    for (const v of tgt) mean += v / N
    for (let i = 0; i < N; i++) tgt[i] /= mean          // the same light in as out: mean 1 over the same area
    const X = i => (i + 0.5) * h - Lx / 2, Y = j => (j + 0.5) * h - Ly / 2
    const ix = (i) => Math.min(nx - 1, Math.max(0, i)), jy = (j) => Math.min(ny - 1, Math.max(0, j))
    // the target at a point, bilinear over cell centres, clamped
    // the target at a point, bilinear over cell centres, clamped; its contrast brought in geometrically (tgt^blend,
    // its mean kept 1): a straight mix 1 + blend (t - 1) still asks the full darkness's spreading once blend nears 1
    let pow = 1, norm = 1
    const tAt = (x, y) => {
        const fx = Math.min(nx - 1, Math.max(0, (x + Lx / 2) / h - 0.5)), fy = Math.min(ny - 1, Math.max(0, (y + Ly / 2) / h - 0.5))
        const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(ny - 2, Math.floor(fy)), a = fx - i, b = fy - j
        const v = (1 - b) * ((1 - a) * tgt[j * nx + i] + a * tgt[j * nx + i + 1]) + b * ((1 - a) * tgt[(j + 1) * nx + i] + a * tgt[(j + 1) * nx + i + 1])
        return Math.pow(v, pow) / norm
    }
    const grad = (u) => {                             // central differences; the edge's normal component 0 (Neumann)
        const gx = new Float64Array(N), gy = new Float64Array(N)
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
            const k = j * nx + i
            gx[k] = i === 0 || i === nx - 1 ? 0 : (u[k + 1] - u[k - 1]) / (2 * h)
            gy[k] = j === 0 || j === ny - 1 ? 0 : (u[k + nx] - u[k - nx]) / (2 * h)
        }
        return [gx, gy]
    }

    // 1. the map
    let phi = new Float64Array(N), residual = Infinity
    const ramp = Math.max(1, Math.round(iterations / 2))
    for (let it = 0; it < iterations; it++) {
        const blend = Math.min(1, (it + 1) / ramp)
        pow = blend; norm = 0
        for (const v of tgt) norm += Math.pow(v, pow) / N
        const [gx, gy] = grad(phi), rhs = new Float64Array(N)
        let res = 0, cells = 0
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
            const k = j * nx + i, p = (a, b) => phi[jy(b) * nx + ix(a)]
            const xx = (p(i + 1, j) - 2 * p(i, j) + p(i - 1, j)) / (h * h)
            const yy = (p(i, j + 1) - 2 * p(i, j) + p(i, j - 1)) / (h * h)
            const xy = (p(i + 1, j + 1) - p(i + 1, j - 1) - p(i - 1, j + 1) + p(i - 1, j - 1)) / (4 * h * h)
            const f = 1 / tAt(X(i) + gx[k], Y(j) + gy[k])
            rhs[k] = Math.sqrt((xx - yy) ** 2 + 4 * xy * xy + 4 * f) - 2
            // how far the map is from keeping the light, away from the edge (whose ghosts are not the equation)
            if (i > 1 && j > 1 && i < nx - 2 && j < ny - 2) { res += (((1 + xx) * (1 + yy) - xy * xy - f) / f) ** 2; cells++ }
        }
        res = Math.sqrt(res / cells)
        const next = solve(rhs)
        for (let k = 0; k < N; k++) phi[k] += relax * (next[k] - phi[k])
        if (blend === 1) residual = res
        if (it % 10 === 0 || it === iterations - 1) log(`  map ${it + 1}/${iterations}: contrast ${(blend * 100).toFixed(0)} %, rms (det - f) / f ${res.toExponential(2)}`)
    }
    const [mx, my] = grad(phi)

    // 2 + 3. the normals by Snell, the heights by least squares, the ray's start at the height found
    let H = new Float64Array(N), maxAngle = 0, maxSlope = 0
    for (let pass = 0; pass < 3; pass++) {
        const sx = new Float64Array(N), sy = new Float64Array(N)
        maxAngle = 0; maxSlope = 0
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
            const k = j * nx + i, x = X(i), y = Y(j)
            const qx = magnify * (x + mx[k]), qy = magnify * (y + my[k])
            let ox = qx - x, oy = qy - y, oz = D - H[k]
            const l = Math.hypot(ox, oy, oz); ox /= l; oy /= l; oz /= l
            sx[k] = ox / (n - oz); sy[k] = oy / (n - oz)
            maxAngle = Math.max(maxAngle, Math.acos(oz)); maxSlope = Math.max(maxSlope, Math.hypot(sx[k], sy[k]))
        }
        // div of the slopes at the cells' faces (each face the mean of its two cells, 0 on the plate's edge)
        const div = new Float64Array(N)
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
            const k = j * nx + i
            const e = i < nx - 1 ? (sx[k] + sx[k + 1]) / 2 : 0, w = i > 0 ? (sx[k] + sx[k - 1]) / 2 : 0
            const nn = j < ny - 1 ? (sy[k] + sy[k + nx]) / 2 : 0, s = j > 0 ? (sy[k] + sy[k - nx]) / 2 : 0
            div[k] = (e - w + nn - s) / h
        }
        H = solve(div)
        let lo = Infinity
        for (const v of H) lo = Math.min(lo, v)
        for (let k = 0; k < N; k++) H[k] -= lo
    }

    // 4. the B-spline coefficients that pass through the heights (rows, then columns), normalised to 0..1
    const C = Float64Array.from(H)
    /* per line, the c with (c[k-1] + 4 c[k] + c[k+1]) / 6 = s[k], c[-1] = c[0] and c[n] = c[n-1] as heightAt's clamp
       pads them: tridiagonal, solved exactly (Thomas). The usual recursive filter (pole sqrt(3) - 2) assumes the line
       mirrored about its end sample: on a line of samples about 1 it missed the clamped ends by 0.16 (tried while
       writing this). */
    const line = new Float64Array(Math.max(nx, ny)), cp = new Float64Array(Math.max(nx, ny))
    const prefilter = (len, get, set) => {
        if (len === 1) { set(0, get(0)); return }
        for (let k = 0; k < len; k++) {
            const diag = (k === 0 || k === len - 1 ? 5 : 4) / 6, off = 1 / 6
            const m = diag - (k > 0 ? off * cp[k - 1] : 0)
            cp[k] = off / m
            line[k] = (get(k) - (k > 0 ? off * line[k - 1] : 0)) / m
        }
        for (let k = len - 2; k >= 0; k--) line[k] -= cp[k] * line[k + 1]
        for (let k = 0; k < len; k++) set(k, line[k])
    }
    for (let j = 0; j < ny; j++) prefilter(nx, i => C[j * nx + i], (i, v) => { C[j * nx + i] = v })
    for (let i = 0; i < nx; i++) prefilter(ny, j => C[j * nx + i], (j, v) => { C[j * nx + i] = v })
    let cl = Infinity, ch = -Infinity
    for (const v of C) { cl = Math.min(cl, v); ch = Math.max(ch, v) }
    const amplitude = ch - cl
    // back to the picture's row order: first row the top (+y), as heightAt reads a picture
    const coefficients = new Float64Array(N), heights = new Float64Array(N)
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        coefficients[(ny - 1 - j) * nx + i] = amplitude > 0 ? (C[j * nx + i] - cl) / amplitude : 0
        heights[(ny - 1 - j) * nx + i] = H[j * nx + i] - cl     // as the relief shows it: its lowest coefficient at 0
    }
    // the target as the design aimed at it (floor and mean), first row the top, for the comparison
    const aimed = new Float64Array(N)
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) aimed[(ny - 1 - j) * nx + i] = tgt[j * nx + i]
    return { heights, coefficients, amplitude, residual, aimed, maxAngle: maxAngle * 180 / Math.PI, maxSlope }
}

/** The 16-bit samples of the coefficients, and the plate as ShadyTracer reads it: { samples, img, slot }. */
export function asRendererReads(coefficients, nx, ny, [Lx, Ly]) {
    const samples = new Uint16Array(nx * ny)
    for (let k = 0; k < nx * ny; k++) samples[k] = Math.round(Math.min(1, Math.max(0, coefficients[k])) * 65535)
    const img = { width: nx, height: ny, pixels: pack16(samples, null, nx, ny) }
    const entry = { width: nx, height: ny, bits: 16, heights: heightStats(img, { bits: 16 }) }
    const slot = slotMatrix(SLOT_FOR([Lx, Ly]), { x: 0, y: 0, w: nx, h: ny }, entry)
    return { samples, img, slot }
}
/** The image texture's settings the plate wants (builder/images.js SLOT_HELP says what each is). */
export const SLOT_FOR = ([Lx, Ly]) => ({
    use: 'none', projection: 'planar', size: { x: Lx, y: Ly }, offset: { x: 0, y: 0 }, turn: 0,
    wrapU: 'clamp', wrapV: 'clamp', filter: 'smooth', faces: 'all', colour: false,
})

/** A small deterministic generator (mulberry32), so a preview and a test are the same every run. */
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }

/**
 * 5. WHAT THE SCREEN RECEIVES: rays straight up through the flat face (within the sun's disc, refracted into the glass),
 * out through the heights as heightAt reads them (normal by central differences), Snell exactly, binned on the screen
 * (nx x ny cells over magnify times the plate, first row the top). Mean 1 over the screen.
 */
export function preview(img, slot, nx, ny, o = {}) {
    const { size: [Lx, Ly], amplitude, distance: D = 500, n = 1.49, magnify = 1, sunDiameter = 0, spp = 4, seed = 1 } = o
    const h = Lx / nx, e = h / 4, rand = rng(seed)
    const height = (x, y) => amplitude * heightAtJS(slot, img, [x, y, 0])[0]
    const out = new Float64Array(nx * ny), sx = magnify * Lx, sy = magnify * Ly
    const sinA = Math.sin(sunDiameter * Math.PI / 360)
    let rays = 0, lost = 0
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) for (let a = 0; a < spp; a++) for (let b = 0; b < spp; b++) {
        rays++
        const x = (i + (a + rand()) / spp) * h - Lx / 2, y = Ly / 2 - (j + (b + rand()) / spp) * h
        // a direction in the sun's disc, uniform in its sines, then into the glass through the flat face (its sines / n)
        let dx = 0, dy = 0
        if (sinA > 0) { const r = sinA * Math.sqrt(rand()), t = 2 * Math.PI * rand(); dx = r * Math.cos(t) / n; dy = r * Math.sin(t) / n }
        const dz = Math.sqrt(1 - dx * dx - dy * dy)
        const z0 = height(x, y)
        const hx = (height(x + e, y) - height(x - e, y)) / (2 * e), hy = (height(x, y + e) - height(x, y - e)) / (2 * e)
        const nl = Math.hypot(hx, hy, 1), Nx = -hx / nl, Ny = -hy / nl, Nz = 1 / nl
        const cosi = dx * Nx + dy * Ny + dz * Nz, k = 1 - n * n * (1 - cosi * cosi)
        if (k < 0) { lost++; continue }                // total internal reflection: back into the plate
        const c = Math.sqrt(k) - n * cosi
        const tx = n * dx + c * Nx, ty = n * dy + c * Ny, tz = n * dz + c * Nz
        if (!(tz > 0)) { lost++; continue }
        const s = (D - z0) / tz, X = x + s * tx, Y = y + s * ty
        const fx = (X + sx / 2) / sx * nx - 0.5, fy = (sy / 2 - Y) / sy * ny - 0.5
        const i0 = Math.floor(fx), j0 = Math.floor(fy), u = fx - i0, v = fy - j0
        for (const [di, dj, w] of [[0, 0, (1 - u) * (1 - v)], [1, 0, u * (1 - v)], [0, 1, (1 - u) * v], [1, 1, u * v]]) {
            const ii = i0 + di, jj = j0 + dj
            if (ii >= 0 && ii < nx && jj >= 0 && jj < ny) out[jj * nx + ii] += w
            else if (w > 0) lost += w
        }
    }
    let mean = 0
    for (const v of out) mean += v / (nx * ny)
    if (mean > 0) for (let k = 0; k < nx * ny; k++) out[k] /= mean
    return { light: out, lostShare: lost / rays }
}

/** How alike two pictures are: the correlation of their values, each blurred by `blur` cells (a 3x3 box per cell). */
export function correlation(a, b, nx, ny, blur = 1) {
    const box = (v) => {
        let cur = Float64Array.from(v)
        for (let r = 0; r < blur; r++) {
            const nxt = new Float64Array(nx * ny)
            for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
                let s = 0, c = 0
                for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
                    const ii = i + di, jj = j + dj
                    if (ii >= 0 && ii < nx && jj >= 0 && jj < ny) { s += cur[jj * nx + ii]; c++ }
                }
                nxt[j * nx + i] = s / c
            }
            cur = nxt
        }
        return cur
    }
    const A = box(a), B = box(b), N = nx * ny
    let ma = 0, mb = 0
    for (let k = 0; k < N; k++) { ma += A[k] / N; mb += B[k] / N }
    let sab = 0, saa = 0, sbb = 0
    for (let k = 0; k < N; k++) { const x = A[k] - ma, y = B[k] - mb; sab += x * y; saa += x * x; sbb += y * y }
    return sab / Math.sqrt(saa * sbb)
}

/** Light 0..about 1 as an 8-bit sRGB picture's samples, `white` the light shown white. */
const toSrgb8 = (light, white) => Uint8Array.from(light, v => Math.round(255 * linearToSrgb(Math.min(1, Math.max(0, v / white)))))

//---------------------------------------------------------------------------------------------------------------------
// The command
//---------------------------------------------------------------------------------------------------------------------
const USAGE = `node tools/causticlens.mjs picture.png [options]

  --size MM        the plate's longer edge in mm (default 100); the other follows the picture's shape
  --distance MM    from the relief's foot (its black) to the screen, in mm (default 500)
  --n N            the glass's index (default 1.49, PMMA)
  --magnify M      the picture on the screen M times the plate (default 1)
  --floor F        the darkest the picture may be, a share of its brightest (default 0.05)
  --grid N         cells along the longer edge, the height map's pixels (default 384)
  --iterations K   steps of the map's solver (default 80; a --floor under 0.05 wants several hundred)
  --sun DEG        the sun's diameter for the preview (default 0.53; 0 for collimated)
  --linear         the picture's values are light already (no sRGB decode)
  --out NAME       the files' stem (default: the picture's, beside it)

Writes NAME-height.png (16 bit, for the relief), NAME-preview.png (the screen, traced), NAME-target.png (what the
design aimed at), NAME-lens.json (the settings), and prints what to set in ShadyTracer.`

function parseArgs(argv) {
    const o = { size: 100, distance: 500, n: 1.49, magnify: 1, floor: 0.05, grid: 384, iterations: 80, sun: 0.53, linear: false }
    const nums = ['size', 'distance', 'n', 'magnify', 'floor', 'grid', 'iterations', 'sun']
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (a === '-h' || a === '--help') { o.help = true; continue }
        if (a === '--linear') { o.linear = true; continue }
        if (a === '--out') { o.out = argv[++i]; continue }
        const k = a.startsWith('--') ? a.slice(2) : null
        if (k && nums.includes(k)) {
            const v = Number(argv[++i])
            if (!Number.isFinite(v)) throw new Error(`--${k} wants a number, got ${argv[i]}`)
            o[k] = v; continue
        }
        if (a.startsWith('-')) throw new Error(`unknown option ${a}`)
        if (o.input) throw new Error(`one picture at a time (${o.input}, then ${a})`)
        o.input = a
    }
    const bad = [['size', o.size > 0], ['distance', o.distance > 0], ['n', o.n > 1], ['magnify', o.magnify > 0],
        ['floor', o.floor > 0 && o.floor < 1], ['grid', o.grid >= 16 && o.grid <= 4096 && Number.isInteger(o.grid)],
        ['iterations', o.iterations >= 1 && Number.isInteger(o.iterations)], ['sun', o.sun >= 0]].filter(([, ok]) => !ok)
    if (bad.length) throw new Error(`out of range: ${bad.map(([k]) => '--' + k).join(', ')}`)
    return o
}

async function main() {
    let o
    try { o = parseArgs(process.argv.slice(2)) } catch (e) { console.error(e.message + '\n\n' + USAGE); process.exit(2) }
    if (o.help || !o.input) { console.log(USAGE); process.exit(o.help ? 0 : 2) }
    const img = decodePNG(readFileSync(o.input))
    const landscape = img.width >= img.height
    const nx = landscape ? o.grid : Math.max(8, Math.round(o.grid * img.width / img.height))
    const ny = landscape ? Math.max(8, Math.round(o.grid * img.height / img.width)) : o.grid
    const cell = o.size / o.grid, size = [nx * cell, ny * cell]
    const stem = o.out ?? o.input.replace(/\.png$/i, '')
    console.log(`${o.input}: ${img.width} x ${img.height} px -> ${nx} x ${ny} cells of ${cell.toFixed(3)} mm, a plate ${size[0].toFixed(2)} x ${size[1].toFixed(2)} mm`)
    const t0 = Date.now()
    const target = targetOf(img, nx, ny, { linear: o.linear })
    const d = design(target, nx, ny, { size, distance: o.distance, n: o.n, magnify: o.magnify, floor: o.floor, iterations: o.iterations, log: s => console.log(s) })
    const { samples, img: hImg, slot } = asRendererReads(d.coefficients, nx, ny, size)
    const pv = preview(hImg, slot, nx, ny, { size, amplitude: d.amplitude, distance: o.distance, n: o.n, magnify: o.magnify, sunDiameter: o.sun })
    const pv0 = o.sun > 0 ? preview(hImg, slot, nx, ny, { size, amplitude: d.amplitude, distance: o.distance, n: o.n, magnify: o.magnify, sunDiameter: 0 }) : pv
    const r0 = correlation(pv0.light, d.aimed, nx, ny), r = correlation(pv.light, d.aimed, nx, ny)
    let amax = 0
    for (const v of d.aimed) amax = Math.max(amax, v)
    writeFileSync(`${stem}-height.png`, encodeGreyPNG(samples, nx, ny, 16))
    writeFileSync(`${stem}-preview.png`, encodeGreyPNG(toSrgb8(pv.light, amax), nx, ny, 8))
    writeFileSync(`${stem}-target.png`, encodeGreyPNG(toSrgb8(d.aimed, amax), nx, ny, 8))
    const blur = o.distance * Math.tan(o.sun * Math.PI / 180)
    const steep = slot[13] * d.amplitude
    const settings = {
        picture: o.input, plate_mm: size.map(v => +v.toFixed(3)), distance_mm: o.distance, n: o.n, magnify: o.magnify, floor: o.floor,
        cells: [nx, ny], relief: { amplitude_mm: +d.amplitude.toFixed(4), raise: 1 }, image_texture: SLOT_FOR(size.map(v => +v.toFixed(3))),
        design: { map_residual: d.residual, max_angle_deg: +d.maxAngle.toFixed(2), max_slope: +d.maxSlope.toFixed(3), relief_slope_bound: +steep.toFixed(3) },
        preview: { correlation_collimated: +r0.toFixed(4), correlation_sun: +r.toFixed(4), sun_deg: o.sun, lost_share: +pv.lostShare.toFixed(4), sun_blur_mm: +blur.toFixed(2) },
    }
    writeFileSync(`${stem}-lens.json`, JSON.stringify(settings, null, 2) + '\n')
    console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s

The design, in this script's own model:
  relief amplitude ${d.amplitude.toFixed(3)} mm, steepest slope ${d.maxSlope.toFixed(2)}, rays bent up to ${d.maxAngle.toFixed(1)} deg
  the map's rms (det - f) / f: ${d.residual.toExponential(2)}
  preview vs aim, correlation: ${r0.toFixed(3)} collimated${o.sun > 0 ? `, ${r.toFixed(3)} under a ${o.sun} deg sun (its blur about ${blur.toFixed(1)} mm)` : ''}; ${(pv.lostShare * 100).toFixed(2)} % of the rays lost
  (a trace through the heights as heightAt reads them, not a render: no Fresnel, no photon map)

In ShadyTracer (the scene in mm; the image texture's size is mm whatever the unit):
  plate:     a box ${size[0].toFixed(2)} x ${size[1].toFixed(2)} mm, any thickness, its z along the light
  material:  glass of index ${o.n}, + image texture... ${stem.split('/').pop()}-height.png (16-bit grey), its settings:
               use none, projection planar, size ${size[0].toFixed(2)} x ${size[1].toFixed(2)} mm, offset 0 0, turn 0,
               wrap clamp / clamp, filter smooth, colour OFF (data -- colour on decodes sRGB and bends every height)
             relief: from an image texture, amplitude ${d.amplitude.toFixed(3)} mm, raise 1
  flat face: the relief raises every face, the underside too: intersect the plate with a box whose bottom is the
             plate's and whose top is well above the relief, in a glass of index ${o.n} WITHOUT the relief
  light:     the sun, straight along +z into the flat face${o.sun > 0 ? ` (its diameter ${o.sun} deg blurs the picture by about ${blur.toFixed(1)} mm)` : ''}
  screen:    a white wall parallel to the plate, ${o.distance} mm above the plate's top face (the relief's foot)
  picture:   on the wall as the height map lies on the plate (x across, y up, in the plate's frame); a camera on the
             plate's side looking at the wall sees it mirrored left to right
  caustics:  only the light's photons (the photon map) carry light through glass onto a wall
  relief's slope bound ${steep.toFixed(2)} (the march's step near the plate is divided by 1 + it)`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error(e.stack || e.message); process.exit(1) })
