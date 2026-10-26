//======================================================================================================================
// PNG, 16 BITS A CHANNEL, AND TEXT IN ANY PNG (0.79.0) -- the Darkroom's developed picture without 8-bit steps.
//
// WHY ITS OWN WRITER. The canvas that tinywebgpu's save encodes through holds 8 bits a channel, so a smooth gradient
// developed with a steep curve bands in the file however fine the light under it is. A 16-bit PNG keeps what the
// develop pass computed (in f32) to 1/65535. The browser has no encoder for it, and none is needed: a PNG is a header,
// the rows deflated (CompressionStream 'deflate' is the zlib stream IDAT wants, in the browser and in node alike), and
// CRCs (lib/timeline/zip.js's, read only: that folder is vendored).
//
//   const P = makePNG16(w, h)        rows top first, as an image is read
//   await P.addRows(rgb16, k)        k rows of w x 3 Uint16 (R, G, B), any number of times, in order
//   const blob = await P.finish(text)    text: [[keyword, value], ...] as iTXt (UTF-8: a JSON with "cd/m²" fits)
//
//   insertText(pngBytes, text)       the same text into a PNG made elsewhere (the 8-bit save's), right after IHDR
//
// Each row is filtered "Up" (its difference from the row above): a picture's neighbouring rows are alike, so the
// differences deflate far smaller than the values -- the filter every PNG reader must undo, no choice per row.
//======================================================================================================================

/* global CompressionStream, Response -- the browser's, and node's since 18 */
import { crc32 } from '../../../timeline/zip.js'

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const enc = new TextEncoder()

const be32 = (v, out = new Uint8Array(4), o = 0) => { out[o] = v >>> 24; out[o + 1] = (v >>> 16) & 255; out[o + 2] = (v >>> 8) & 255; out[o + 3] = v & 255; return out }

/** One chunk: its length, its type, its data, the CRC of type and data. */
export function chunk(type, data) {
    const out = new Uint8Array(12 + data.length)
    be32(data.length, out, 0)
    out.set(enc.encode(type), 4)
    out.set(data, 8)
    be32(crc32(out.subarray(4, 8 + data.length)), out, 8 + data.length)
    return out
}

/** An iTXt chunk: keyword, uncompressed, no language, the text in UTF-8. */
export function itxt(keyword, text) {
    const k = enc.encode(keyword.slice(0, 79)), t = enc.encode(text)
    const data = new Uint8Array(k.length + 5 + t.length)
    data.set(k, 0)                               // keyword\0, flag 0, method 0, language\0, translated keyword\0
    data.set(t, k.length + 5)
    return chunk('iTXt', data)
}

/** A PNG's bytes with text chunks put in right after its header (IHDR is always the first chunk: 8 + 25 bytes). */
export function insertText(png, text = []) {
    const at = 8 + 25
    const parts = text.map(([k, v]) => itxt(k, String(v)))
    const n = parts.reduce((s, p) => s + p.length, 0)
    const out = new Uint8Array(png.length + n)
    out.set(png.subarray(0, at), 0)
    let o = at
    for (const p of parts) { out.set(p, o); o += p.length }
    out.set(png.subarray(at), o)
    return out
}

/** A 16-bit RGB PNG, written as its rows arrive. */
export function makePNG16(w, h) {
    const cs = new CompressionStream('deflate')
    const writer = cs.writable.getWriter()
    const deflated = new Response(cs.readable).arrayBuffer()      // read while it is written, or the stream stalls
    const stride = w * 6
    let prev = new Uint8Array(stride), rows = 0
    return {
        async addRows(rgb, k) {
            if (rows + k > h) throw new Error(`[png16] ${rows + k} rows for a picture of ${h}`)
            const out = new Uint8Array(k * (stride + 1))
            const cur = new Uint8Array(stride)
            for (let r = 0; r < k; r++) {
                for (let i = 0, s = r * w * 3; i < w * 3; i++) { const v = rgb[s + i]; cur[2 * i] = v >>> 8; cur[2 * i + 1] = v & 255 }
                const o = r * (stride + 1)
                out[o] = 2                                         // filter: Up
                for (let i = 0; i < stride; i++) out[o + 1 + i] = (cur[i] - prev[i]) & 255
                prev.set(cur)
            }
            rows += k
            await writer.ready
            await writer.write(out)
        },
        async finish(text = []) {
            if (rows !== h) throw new Error(`[png16] ${rows} rows written of ${h}`)
            await writer.close()
            const z = new Uint8Array(await deflated)
            const ihdr = new Uint8Array(13)
            be32(w, ihdr, 0); be32(h, ihdr, 4)
            ihdr[8] = 16; ihdr[9] = 2                              // 16 bits, RGB; compression, filter, interlace 0
            return new Blob([new Uint8Array(SIGNATURE), chunk('IHDR', ihdr), ...text.map(([k, v]) => itxt(k, String(v))),
                             chunk('IDAT', z), chunk('IEND', new Uint8Array(0))], { type: 'image/png' })
        },
    }
}
