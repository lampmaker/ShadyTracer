//======================================================================================================================
// RADIANCE HDR (0.next) -- RGBE, the oldest HDR picture there is, read by nearly everything that reads HDR at all.
//
// One shared exponent a pixel and an 8-bit mantissa each channel (about 1 % precision), so it cannot hold a negative:
// the darkroom clips into the display gamut first (core/colorimetry.js gamutClip, the display's own clip). Its units
// are Radiance's -- watts per steradian per square metre, 179 lumens a watt -- so the darkroom writes cd/m^2 / 179 and a
// Radiance tool reads the right luminance; PRIMARIES says the channels are Rec.709's, as the accumulation's are.
//
// Rows run top first (`-Y h +X w`). A row 8 to 32767 pixels wide is the "new" run-length form -- its four components
// one after the other, each runs (128 + n, a byte) and copies (n, n bytes) -- which every reader since 1991 reads; any
// other width is written flat.
//
//   const R = makeHDR({ w, h, lines: ['EXPOSURE=1.0', ...] })
//   R.addRows(rgb, k)          k rows of w x 3 Float32, top first
//   const blob = R.finish()
//======================================================================================================================

const enc = new TextEncoder()

/** One pixel's RGBE: the largest channel's exponent shared, each mantissa a byte. 0 below 1e-32, as Radiance does. */
export function rgbe(r, g, b, out = new Uint8Array(4), o = 0) {
    const v = Math.max(r, g, b)
    if (!(v >= 1e-32)) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0; return out }
    let e = Math.floor(Math.log2(v)) + 1
    let m = v / 2 ** e
    if (m >= 1) { e++; m /= 2 }                       // log2 rounding at an exact power of two
    const s = 256 / 2 ** e
    out[o] = Math.min(255, Math.max(0, Math.floor(r * s))); out[o + 1] = Math.min(255, Math.max(0, Math.floor(g * s)))
    out[o + 2] = Math.min(255, Math.max(0, Math.floor(b * s))); out[o + 3] = e + 128
    return out
}

/* one component of a row, run-length encoded as Radiance's writer does it: runs of 4 or more, copies between them */
function rle(data, out) {
    const w = data.length, MIN = 4
    let cur = 0
    while (cur < w) {
        let beg = cur, run = 0, old = 0
        while (run < MIN && beg < w) {
            beg += run; old = run; run = 1
            while (beg + run < w && run < 127 && data[beg] === data[beg + run]) run++
        }
        if (old > 1 && old === beg - cur) { out.push(128 + old, data[cur]); cur = beg }
        while (cur < beg) {
            const n = Math.min(128, beg - cur)
            out.push(n)
            for (let i = 0; i < n; i++) out.push(data[cur + i])
            cur += n
        }
        if (run >= MIN) { out.push(128 + run, data[beg]); cur += run }
    }
}

export function makeHDR({ w, h, lines = [] }) {
    const parts = [enc.encode(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n${lines.map(l => l + '\n').join('')}\n-Y ${h} +X ${w}\n`)]
    const flat = w < 8 || w > 0x7fff
    let rows = 0
    const px = new Uint8Array(w * 4), comp = new Uint8Array(w)
    return {
        addRows(rgb, k) {
            if (rows + k > h) throw new Error(`[hdr] ${rows + k} rows for a picture of ${h}`)
            for (let r = 0; r < k; r++) {
                for (let x = 0, s = (r * w) * 3; x < w; x++, s += 3) rgbe(rgb[s], rgb[s + 1], rgb[s + 2], px, x * 4)
                if (flat) { parts.push(px.slice()); continue }
                const out = [2, 2, w >> 8, w & 255]
                for (let c = 0; c < 4; c++) {
                    for (let x = 0; x < w; x++) comp[x] = px[x * 4 + c]
                    rle(comp, out)
                }
                parts.push(new Uint8Array(out))
            }
            rows += k
        },
        finish() {
            if (rows !== h) throw new Error(`[hdr] ${rows} rows written of ${h}`)
            return new Blob(parts, { type: 'image/vnd.radiance' })
        },
    }
}
