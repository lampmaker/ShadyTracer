//======================================================================================================================
// OPENEXR (0.79.0) -- the kept render's light written as it is: linear, float, out-of-gamut colours and the sun included.
//
// WHY. The renderer's result is luminance in cd/m^2 (core/photometry.js), and until now it could leave the page only
// through an exposure, a tone curve and 8 bits. An EXR keeps the numbers: a compositor, a photo editor or a script reads
// the picture the renderer made. FLOAT32 BY DEFAULT for absolute values: half stops at 65504, and a visible sun is
// 1.6e9 cd/m^2 (the user chose this default, 2026-10-25). Half is offered for exposed values, where 1.0 is white.
//
// What is written (the OpenEXR file layout, single part, scanlines):
//   magic 20000630, version 2; a header of attributes, each `name\0 type\0 size value`, ended by a 0 byte --
//   channels B, G, R (sorted, as the format requires), compression, the data and display windows, line order
//   INCREASING_Y (rows top first), pixel aspect, screen window, and the photometric ones: chromaticities (Rec.709 / D65:
//   the accumulation's primaries) and whiteLuminance (the cd/m^2 of RGB 1,1,1 -- 1 for absolute values, so a reader
//   that honours it gets the renderer's numbers either way), then strings (the build, the settings);
//   an offset table (one u64 a block), then the blocks: y, size, data. A block is 16 rows under ZIP: each row's B, G
//   and R runs of w values, little-endian; then OpenEXR's byte split (even bytes, then odd) and predictor (each byte as
//   its difference from the last, + 128), then zlib -- and the raw bytes instead when zlib does not make them smaller,
//   which a reader tells by the size. NONE writes one row a block, raw.
//
//   const E = makeEXR({ w, h, half, compression: 'zip' | 'none', attributes: { whiteLuminance, strings: {...} } })
//   await E.addRows(rgb, k)          k rows of w x 3 Float32 (R, G, B), top first, in order
//   const blob = await E.finish()
//======================================================================================================================

/* global CompressionStream, Response -- the browser's, and node's since 18 */
const MAGIC = 20000630
const REC709 = [0.64, 0.33, 0.30, 0.60, 0.15, 0.06, 0.3127, 0.3290]
const COMPRESSION = { none: 0, zip: 3 }
const enc = new TextEncoder()

/* f32 to f16 bits, rounded to the nearest even; past 65504 infinity, below the smallest subnormal 0, NaN kept a NaN */
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer)
export function toHalf(v) {
    f32[0] = v
    const x = u32[0], sign = (x >>> 16) & 0x8000
    const e = (x >>> 23) & 0xff, m = x & 0x7fffff
    if (e === 0xff) return sign | 0x7c00 | (m ? 0x200 : 0)
    const E = e - 127 + 15
    if (E >= 0x1f) return sign | 0x7c00
    if (E <= 0) {
        if (E < -10) return sign
        const mm = m | 0x800000, shift = 14 - E
        let h = mm >>> shift
        const rem = mm & ((1 << shift) - 1), half = 1 << (shift - 1)
        if (rem > half || (rem === half && (h & 1))) h++
        return sign | h
    }
    let h = (E << 10) | (m >>> 13)
    const rem = m & 0x1fff
    if (rem > 0x1000 || (rem === 0x1000 && (h & 1))) h++         // a carry into the exponent is right: it rounds up a power
    return sign | h
}

/* OpenEXR's ZIP pre-pass: the bytes split into even then odd, then each as its difference from the one before + 128 */
export function zipPrepass(raw) {
    const n = raw.length, t = new Uint8Array(n)
    let a = 0, b = (n + 1) >> 1
    for (let i = 0; i < n; i += 2) { t[a++] = raw[i]; if (i + 1 < n) t[b++] = raw[i + 1] }
    let p = t[0]
    for (let i = 1; i < n; i++) { const d = (t[i] - p + 128 + 256) & 255; p = t[i]; t[i] = d }
    return t
}

const deflate = async bytes =>
    new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer())

function header({ w, h, half, compression, attributes = {} }) {
    const parts = []
    const push = b => parts.push(b instanceof Uint8Array ? b : new Uint8Array(b))
    const attr = (name, type, value) => {
        push(enc.encode(`${name}\0${type}\0`))
        const size = new DataView(new ArrayBuffer(4)); size.setInt32(0, value.length, true)
        push(new Uint8Array(size.buffer)); push(value)
    }
    const dv = (n, fill) => { const d = new DataView(new ArrayBuffer(n)); fill(d); return new Uint8Array(d.buffer) }
    // channels: B, G, R, each its name, pixel type (1 half, 2 float), pLinear 0, 3 reserved, x and y sampling 1
    const ch = []
    for (const c of ['B', 'G', 'R']) {
        ch.push(...enc.encode(c + '\0'))
        ch.push(...dv(16, d => { d.setInt32(0, half ? 1 : 2, true); d.setInt32(8, 1, true); d.setInt32(12, 1, true) }))
    }
    ch.push(0)
    attr('channels', 'chlist', new Uint8Array(ch))
    attr('compression', 'compression', new Uint8Array([COMPRESSION[compression]]))
    const box = dv(16, d => { d.setInt32(0, 0, true); d.setInt32(4, 0, true); d.setInt32(8, w - 1, true); d.setInt32(12, h - 1, true) })
    attr('dataWindow', 'box2i', box)
    attr('displayWindow', 'box2i', box)
    attr('lineOrder', 'lineOrder', new Uint8Array([0]))
    attr('pixelAspectRatio', 'float', dv(4, d => d.setFloat32(0, 1, true)))
    attr('screenWindowCenter', 'v2f', dv(8, () => { }))
    attr('screenWindowWidth', 'float', dv(4, d => d.setFloat32(0, 1, true)))
    attr('chromaticities', 'chromaticities', dv(32, d => REC709.forEach((v, i) => d.setFloat32(i * 4, v, true))))
    if (attributes.whiteLuminance != null) attr('whiteLuminance', 'float', dv(4, d => d.setFloat32(0, attributes.whiteLuminance, true)))
    for (const [k, v] of Object.entries(attributes.strings || {})) attr(k.slice(0, 31), 'string', enc.encode(String(v)))
    push([0])
    const n = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(8 + n)
    const v = new DataView(out.buffer)
    v.setInt32(0, MAGIC, true); v.setInt32(4, 2, true)            // version 2, single-part scanlines, short names
    let o = 8
    for (const p of parts) { out.set(p, o); o += p.length }
    return out
}

export function makeEXR({ w, h, half = false, compression = 'zip', attributes = {} }) {
    if (!(compression in COMPRESSION)) throw new Error(`[exr] no compression '${compression}'`)
    const lines = compression === 'zip' ? 16 : 1
    const bpv = half ? 2 : 4
    const rowBytes = 3 * w * bpv
    const blocks = []                       // { y, data } in order
    let pending = [], pendingY = 0, rows = 0

    const flush = async () => {
        if (!pending.length) return
        const k = pending.length, raw = new Uint8Array(k * rowBytes), v = new DataView(raw.buffer)
        pending.forEach((row, r) => {
            // each row: B, G, R, each a run of w values
            for (let c = 0; c < 3; c++) {
                const src = 2 - c                                      // B, G, R from R, G, B
                let o = r * rowBytes + c * w * bpv
                for (let x = 0; x < w; x++, o += bpv) {
                    const val = row[x * 3 + src]
                    if (half) v.setUint16(o, toHalf(val), true); else v.setFloat32(o, val, true)
                }
            }
        })
        let data = raw
        if (compression === 'zip') {
            const z = await deflate(zipPrepass(raw))
            if (z.length < raw.length) data = z
        }
        blocks.push({ y: pendingY, data })
        pendingY += k
        pending = []
    }

    return {
        async addRows(rgb, k) {
            if (rows + k > h) throw new Error(`[exr] ${rows + k} rows for a picture of ${h}`)
            for (let r = 0; r < k; r++) {
                pending.push(rgb.slice(r * w * 3, (r + 1) * w * 3))      // a copy: the caller may reuse its array
                if (pending.length === lines) await flush()
            }
            rows += k
        },
        async finish() {
            if (rows !== h) throw new Error(`[exr] ${rows} rows written of ${h}`)
            await flush()
            const head = header({ w, h, half, compression, attributes })
            const table = new Uint8Array(8 * blocks.length), tv = new DataView(table.buffer)
            let off = head.length + table.length
            const parts = [head, table]
            blocks.forEach((b, i) => {
                tv.setBigUint64(i * 8, BigInt(off), true)
                const pre = new Uint8Array(8), pv = new DataView(pre.buffer)
                pv.setInt32(0, b.y, true); pv.setInt32(4, b.data.length, true)
                parts.push(pre, b.data)
                off += 8 + b.data.length
            })
            return new Blob(parts, { type: 'image/x-exr' })
        },
    }
}
