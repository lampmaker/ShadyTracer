// node lib/pathtracer/test/export.test.mjs
//
// THE DARKROOM'S FILES (lib/pathtracer/darkroom/export, 0.79.0), no GPU. Every writer's output is read back by a reader
// written HERE, from the formats' specifications and node's own zlib (inflateSync, crc32) -- not by the writer's code
// -- so a writer and its reader cannot share a mistake:
// - OpenEXR: float32 exact, half within its rounding (and its overflow to infinity said), ZIP blocks and blocks left
//   raw, rows top first, the header's channels, windows, chromaticities, whiteLuminance and strings;
// - Radiance HDR: RGBE within its mantissa, the run-length rows and the flat ones, the header's lines;
// - PFM: exact, rows bottom first;
// - PNG, 16 bits: exact, every CRC right, the text; text put into a PNG made elsewhere, still a PNG;
// - what a light file holds: absolute, exposed, lux x pi, the display gamut, Radiance's 179; which rows the Save box
//   shows; the line beside the button;
// - one export start to finish through a stand-in darkroom, each format;
// - and, where ffmpeg is installed, ffmpeg reading the EXR, HDR and PFM to the same numbers.
import { inflateSync, crc32 } from 'node:zlib'
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeEXR, toHalf, zipPrepass } from '../darkroom/export/exr.js'
import { makeHDR, rgbe } from '../darkroom/export/hdr.js'
import { makePFM } from '../darkroom/export/pfm.js'
import { makePNG16, insertText } from '../darkroom/export/png.js'
import { FORMATS, defaultExport, effective, rowsFor, lightScale, lightTransform, holdsLine, describe, RADIANCE_EFFICACY } from '../darkroom/export/index.js'
import { exportPicture } from '../darkroom/export/run.js'
import { ev100ToScale } from '../core/photometry.js'
import { gamutClip } from '../core/colorimetry.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1e-30, Math.abs(b))
const bytesOf = async blob => new Uint8Array(await blob.arrayBuffer())

/* A PICTURE OF EVERYTHING, rows top first: dark, mid, white, a sun, a channel below zero (out of gamut), exact zeros */
let seed = 7
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
function picture(w, h) {
    const f = new Float32Array(w * h * 3)
    for (let i = 0; i < w * h; i++) {
        const k = rnd(), L = k < 0.05 ? 0 : k < 0.08 ? 1.6e9 : 10 ** (rnd() * 8 - 3)
        f.set([L * rnd(), L * rnd(), L * (rnd() - (k > 0.93 ? 0.4 : 0))], i * 3)
    }
    // a flat stretch for the run-length writers
    for (let x = 0; x < Math.min(w, 40); x++) f.set([1, 2, 3], x * 3)
    return f
}
const W = 37, H = 21
const PIC = picture(W, H)
async function feed(writer, rgb, w, h, strip = 5) {
    for (let r = 0; r < h; r += strip) {
        const k = Math.min(strip, h - r)
        await writer.addRows(rgb.slice(r * w * 3, (r + k) * w * 3), k)
    }
}

//======================================================================================================================
// READERS, from the specifications
//======================================================================================================================
function fromHalf(h) {
    const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023
    if (e === 0) return s * m * 2 ** -24
    if (e === 31) return m ? NaN : s * Infinity
    return s * (1 + m / 1024) * 2 ** (e - 15)
}
function readEXR(buf) {
    const v = new DataView(buf.buffer, buf.byteOffset, buf.length)
    if (v.getInt32(0, true) !== 20000630) throw new Error('not an EXR')
    const version = v.getInt32(4, true)
    let o = 8
    const cstr = () => { let e = o; while (buf[e]) e++; const s = new TextDecoder().decode(buf.subarray(o, e)); o = e + 1; return s }
    const attrs = {}
    for (;;) {
        if (buf[o] === 0) { o++; break }
        const name = cstr(), type = cstr(), size = v.getInt32(o, true); o += 4
        attrs[name] = { type, bytes: buf.subarray(o, o + size), at: o }
        o += size
    }
    // channels
    const ch = [], cb = attrs.channels.bytes
    for (let p = 0; cb[p];) {
        let e = p; while (cb[e]) e++
        const name = new TextDecoder().decode(cb.subarray(p, e)); p = e + 1
        const d = new DataView(cb.buffer, cb.byteOffset + p, 16)
        ch.push({ name, type: d.getInt32(0, true) }); p += 16
    }
    const box = new DataView(attrs.dataWindow.bytes.buffer, attrs.dataWindow.bytes.byteOffset, 16)
    const w = box.getInt32(8, true) + 1, h = box.getInt32(12, true) + 1
    const comp = attrs.compression.bytes[0], lines = comp === 3 ? 16 : 1
    const nBlocks = Math.ceil(h / lines)
    const out = new Float32Array(w * h * 3)
    let raws = 0, zips = 0
    for (let b = 0; b < nBlocks; b++) {
        const off = Number(v.getBigUint64(o + b * 8, true))
        const y = v.getInt32(off, true), size = v.getInt32(off + 4, true)
        let data = buf.subarray(off + 8, off + 8 + size)
        const k = Math.min(lines, h - y)
        const bpv = ch.map(c => c.type === 1 ? 2 : 4)
        const rawSize = k * w * bpv.reduce((s, x) => s + x, 0)
        if (comp === 3 && size < rawSize) {
            zips++
            const t = new Uint8Array(inflateSync(data))
            for (let i = 1; i < t.length; i++) t[i] = (t[i - 1] + t[i] - 128) & 255     // undo the predictor
            const u = new Uint8Array(t.length), half = (t.length + 1) >> 1               // undo the split
            for (let i = 0; i < t.length; i++) u[i] = i & 1 ? t[half + (i >> 1)] : t[i >> 1]
            data = u
        } else raws++
        const dv = new DataView(data.buffer, data.byteOffset, data.length)
        let p = 0
        for (let r = 0; r < k; r++) for (let c = 0; c < ch.length; c++) for (let x = 0; x < w; x++) {
            const val = ch[c].type === 1 ? fromHalf(dv.getUint16(p, true)) : dv.getFloat32(p, true)
            p += bpv[c]
            const idx = { R: 0, G: 1, B: 2 }[ch[c].name]
            out[((y + r) * w + x) * 3 + idx] = val
        }
    }
    const f32 = a => new DataView(a.bytes.buffer, a.bytes.byteOffset, a.bytes.length)
    return { w, h, version, ch, comp, raws, zips, rgb: out,
             chroma: attrs.chromaticities && [...Array(8)].map((_, i) => f32(attrs.chromaticities).getFloat32(i * 4, true)),
             whiteLuminance: attrs.whiteLuminance && f32(attrs.whiteLuminance).getFloat32(0, true),
             strings: Object.fromEntries(Object.entries(attrs).filter(([, a]) => a.type === 'string').map(([k, a]) => [k, new TextDecoder().decode(a.bytes)])),
             lineOrder: attrs.lineOrder?.bytes[0] }
}
function readHDR(buf) {
    let o = 0
    const line = () => { let e = o; while (buf[e] !== 10) e++; const s = new TextDecoder().decode(buf.subarray(o, e)); o = e + 1; return s }
    const head = []
    for (let l = line(); l !== ''; l = line()) head.push(l)
    const [, h, , w] = line().split(' ').map(Number)
    const rgb = new Float32Array(w * h * 3)
    let rle = 0, flat = 0
    for (let y = 0; y < h; y++) {
        const px = new Uint8Array(w * 4)
        if (buf[o] === 2 && buf[o + 1] === 2 && w >= 8 && w <= 0x7fff) {
            rle++
            o += 4
            for (let c = 0; c < 4; c++) for (let x = 0; x < w;) {
                const n = buf[o++]
                if (n > 128) { const val = buf[o++]; for (let i = 0; i < n - 128; i++) px[(x++) * 4 + c] = val }
                else for (let i = 0; i < n; i++) px[(x++) * 4 + c] = buf[o++]
            }
        } else { flat++; px.set(buf.subarray(o, o + w * 4)); o += w * 4 }
        for (let x = 0; x < w; x++) {
            const e = px[x * 4 + 3], f = e ? 2 ** (e - 136) : 0
            for (let c = 0; c < 3; c++) rgb[(y * w + x) * 3 + c] = e ? (px[x * 4 + c] + 0.5) * f : 0
        }
    }
    return { w, h, head, rgb, rle, flat, end: o === buf.length }
}
function readPFM(buf) {
    let o = 0
    const tok = () => { while (buf[o] === 10 || buf[o] === 32) o++; let e = o; while (buf[e] !== 10 && buf[e] !== 32) e++; const s = new TextDecoder().decode(buf.subarray(o, e)); o = e; return s }
    const magic = tok(), w = +tok(), h = +tok(), scale = +tok(); o++
    const f = new Float32Array(buf.slice(o).buffer)
    const rgb = new Float32Array(w * h * 3)
    for (let y = 0; y < h; y++) rgb.set(f.subarray((h - 1 - y) * w * 3, (h - y) * w * 3), y * w * 3)   // bottom row first in the file
    return { magic, w, h, scale, rgb, length: f.length }
}
function readPNG(buf) {
    const sig = [137, 80, 78, 71, 13, 10, 26, 10]
    if (!sig.every((b, i) => buf[i] === b)) throw new Error('not a PNG')
    const v = new DataView(buf.buffer, buf.byteOffset, buf.length)
    let o = 8, badCrc = 0
    const chunks = [], idat = [], text = {}
    while (o < buf.length) {
        const n = v.getUint32(o), type = new TextDecoder().decode(buf.subarray(o + 4, o + 8))
        const data = buf.subarray(o + 8, o + 8 + n)
        if (crc32(buf.subarray(o + 4, o + 8 + n)) !== v.getUint32(o + 8 + n)) badCrc++
        chunks.push(type)
        if (type === 'IDAT') idat.push(data)
        if (type === 'iTXt') {
            const z = data.indexOf(0), key = new TextDecoder().decode(data.subarray(0, z))
            let p = z + 3; while (data[p]) p++; p++; while (data[p]) p++; p++
            text[key] = new TextDecoder().decode(data.subarray(p))
        }
        o += 12 + n
    }
    const ih = buf.subarray(16, 29), iv = new DataView(ih.buffer, ih.byteOffset, 13)
    const w = iv.getUint32(0), h = iv.getUint32(4), depth = ih[8], colour = ih[9]
    let rows = null
    if (depth === 16 && colour === 2) {
        const raw = new Uint8Array(inflateSync(Buffer.concat(idat)))
        const stride = w * 6, bpp = 6
        rows = new Uint16Array(w * h * 3)
        let prev = new Uint8Array(stride)
        for (let y = 0; y < h; y++) {
            const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), cur = new Uint8Array(stride)
            for (let i = 0; i < stride; i++) {
                const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0
                const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
                const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]
                cur[i] = (line[i] + pred) & 255
            }
            for (let x = 0; x < w * 3; x++) rows[y * w * 3 + x] = (cur[2 * x] << 8) | cur[2 * x + 1]
            prev = cur
        }
    }
    return { w, h, depth, colour, chunks, badCrc, text, rows }
}

//======================================================================================================================
// OpenEXR
//======================================================================================================================
{
    const blob = await (async () => { const E = makeEXR({ w: W, h: H, attributes: { whiteLuminance: 1, strings: { software: 'ShadyTracer test', shadyTracer: '{"a":1}' } } }); await feed(E, PIC, W, H); return E.finish() })()
    const r = readEXR(await bytesOf(blob))
    let bad = 0
    for (let i = 0; i < PIC.length; i++) if (r.rgb[i] !== PIC[i]) bad++
    ok('EXR float32: every value back exactly, the sun and the negative channels included', bad === 0 && r.w === W && r.h === H, `${bad} differ`)
    ok('...channels B, G, R (sorted, as the format wants), float, ZIP, rows top first, version 2',
        r.ch.map(c => c.name).join() === 'B,G,R' && r.ch.every(c => c.type === 2) && r.comp === 3 && r.lineOrder === 0 && r.version === 2)
    ok('...ZIP blocks of 16 rows, read back through the predictor and the split', r.zips + r.raws === Math.ceil(H / 16) && r.zips >= 1, `${r.zips} zip, ${r.raws} raw`)
    ok('...Rec.709 / D65 chromaticities and whiteLuminance', r.chroma.map(x => +x.toFixed(4)).join() === '0.64,0.33,0.3,0.6,0.15,0.06,0.3127,0.329' && r.whiteLuminance === 1)
    ok('...the strings', r.strings.software === 'ShadyTracer test' && r.strings.shadyTracer === '{"a":1}')
}
{
    const E = makeEXR({ w: W, h: H, half: true, compression: 'none' }); await feed(E, PIC, W, H)
    const r = readEXR(await bytesOf(await E.finish()))
    let bad = 0, inf = 0
    for (let i = 0; i < PIC.length; i++) {
        const a = PIC[i], b = r.rgb[i]
        if (Math.abs(a) > 65504) { if (b === Infinity * Math.sign(a)) inf++; else bad++; continue }
        if (Math.abs(a) < 6.1e-5 ? Math.abs(a - b) > 2 ** -25 : !near(b, a, 2 ** -11)) bad++
    }
    ok('EXR half, no compression: within half\'s rounding; past 65504 infinity, which is why absolute values are float', bad === 0 && inf > 0 && r.ch.every(c => c.type === 1) && r.comp === 0 && r.raws === H, `${bad} bad, ${inf} inf`)
    ok('toHalf rounds to the nearest even and keeps the specials', toHalf(1) === 0x3c00 && toHalf(65504) === 0x7bff && toHalf(65520) === 0x7c00
        && toHalf(-0) === 0x8000 && toHalf(2 ** -24) === 1 && toHalf(1 + 2 ** -11) === 0x3c00 && toHalf(1 + 3 * 2 ** -11) === 0x3c02 && (toHalf(NaN) & 0x7c00) === 0x7c00 && (toHalf(NaN) & 0x3ff) !== 0)
    const flatRow = new Uint8Array(64).fill(9)
    ok('the ZIP pre-pass of a flat run: all 128s after the first byte', zipPrepass(flatRow).subarray(1).every(b => b === 128))
}
{
    // noise does not deflate: such a block is kept raw, and read back raw
    const noise = new Float32Array(16 * 16 * 3).map(() => (rnd() - 0.5) * 1e30)
    const E = makeEXR({ w: 16, h: 16 }); await E.addRows(noise, 16)
    const r = readEXR(await bytesOf(await E.finish()))
    ok('a block zlib cannot shrink is written raw, and reads back', r.raws === 1 && r.rgb.every((x, i) => x === noise[i]))
}

//======================================================================================================================
// Radiance HDR
//======================================================================================================================
{
    const clipped = new Float32Array(PIC.length)
    for (let i = 0; i < PIC.length; i += 3) clipped.set(gamutClip([PIC[i], PIC[i + 1], PIC[i + 2]]), i)
    const R = makeHDR({ w: W, h: H, lines: ['SOFTWARE=test', 'EXPOSURE=2.0'] }); await feed(R, clipped, W, H)
    const r = readHDR(await bytesOf(R.finish()))
    let bad = 0
    for (let i = 0; i < clipped.length; i += 3) {
        const m = Math.max(clipped[i], clipped[i + 1], clipped[i + 2])
        for (let c = 0; c < 3; c++) if (Math.abs(r.rgb[i + c] - clipped[i + c]) > m * 2 / 256 + 1e-30) bad++
    }
    ok('HDR: every channel within RGBE\'s step (its largest channel / 128)', bad === 0 && r.w === W && r.h === H, `${bad}`)
    ok('...every row run-length encoded (37 wide), and nothing after the last', r.rle === H && r.end)
    ok('...its header lines', r.head[0] === '#?RADIANCE' && r.head.includes('FORMAT=32-bit_rle_rgbe') && r.head.includes('EXPOSURE=2.0'))
    const n = makeHDR({ w: 4, h: 2 }); n.addRows(new Float32Array(24).fill(0.5), 2)
    const rn = readHDR(await bytesOf(n.finish()))
    ok('a row narrower than 8 written flat', rn.flat === 2 && rn.rgb.every(x => near(x, 0.5, 0.01)))
    ok('rgbe: 0 below 1e-32, an exact power of two', rgbe(0, 0, 0).join() === '0,0,0,0' && rgbe(1, 0.5, 0.25).join() === '128,64,32,129')
}

//======================================================================================================================
// PFM, PNG 16
//======================================================================================================================
{
    const P = makePFM({ w: W, h: H }); await feed(P, PIC, W, H)
    const r = readPFM(await bytesOf(P.finish()))
    ok('PFM: PF, little-endian, every value exact, rows bottom first', r.magic === 'PF' && r.scale === -1 && r.length === W * H * 3
        && r.rgb.every((x, i) => x === PIC[i]))
}
{
    const v16 = new Uint16Array(W * H * 3).map((_, i) => (i * 2654435761) >>> 16)
    const P = makePNG16(W, H)
    for (let r = 0; r < H; r += 4) { const k = Math.min(4, H - r); await P.addRows(v16.slice(r * W * 3, (r + k) * W * 3), k) }
    const r = readPNG(await bytesOf(await P.finish([['Software', 'ShadyTracer test'], ['Comment', '{"cd":"cd/m²"}']])))
    ok('PNG 16-bit: 16 bits RGB, every value exact', r.depth === 16 && r.colour === 2 && r.rows.every((x, i) => x === v16[i]))
    ok('...every CRC right, the chunks in order, the text in UTF-8', r.badCrc === 0 && r.chunks[0] === 'IHDR' && r.chunks.at(-1) === 'IEND'
        && r.text.Software === 'ShadyTracer test' && r.text.Comment === '{"cd":"cd/m²"}', JSON.stringify(r.chunks))
}
{
    // a PNG made by Pillow where it is installed (the kind of PNG a canvas writes), else by our own writer
    let png = null
    try {
        const d = mkdtempSync(join(tmpdir(), 'png-'))
        execFileSync('python3', ['-I', '-c', `from PIL import Image; Image.new('RGB', (5, 3), (10, 20, 30)).save(${JSON.stringify(join(d, 'a.png'))})`])
        png = new Uint8Array(readFileSync(join(d, 'a.png')))
        rmSync(d, { recursive: true })
    } catch { }
    if (!png) { const P = makePNG16(2, 2); await P.addRows(new Uint16Array(12), 2); png = await bytesOf(await P.finish()) }
    const t = readPNG(insertText(png, [['Comment', 'hello ²']]))
    ok('text put into a PNG made elsewhere: right after IHDR, every CRC still right', t.badCrc === 0 && t.chunks[1] === 'iTXt' && t.text.Comment === 'hello ²')
}

//======================================================================================================================
// what a light file holds, the rows, the line
//======================================================================================================================
const photo = { w: 4000, h: 2000, samples: 64, view: { show: 0 } }, luxPic = { ...photo, view: { show: 1 } }
{
    const ev = 10, s = ev100ToScale(ev)
    ok('absolute: the light as kept, 1.0 = 1 cd/m²', lightScale({ format: 'exr', values: 'absolute' }, photo, ev).k === 1
        && lightScale({ format: 'exr', values: 'absolute' }, photo, ev).unit === 1)
    const x = lightScale({ format: 'exr', values: 'exposed' }, photo, ev)
    ok('exposed: times the exposure, 1.0 = the luminance that clips', near(x.k, s, 1e-12) && near(x.unit, 1 / s, 1e-12))
    ok('HDR absolute: Radiance\'s units, cd/m² / 179', near(lightScale({ format: 'hdr', values: 'absolute' }, photo, ev).k, 1 / RADIANCE_EFFICACY, 1e-12))
    ok('a lux render: x pi, absolute whatever was asked', near(lightScale({ format: 'exr', values: 'exposed' }, luxPic, ev).k, Math.PI, 1e-12)
        && effective({ format: 'exr', values: 'exposed', precision: 'half' }, luxPic).half === false)
    const t = lightTransform({ format: 'exr', values: 'absolute', gamut: true }, photo, ev)(new Float32Array([2, 1, -1]))
    ok('into the gamut when asked: the display\'s own clip', [...t].every((v, i) => near(v, gamutClip([2, 1, -1])[i], 1e-6)))
    ok('HDR always into the gamut, EXR not unless asked', effective({ format: 'hdr' }, photo).gamut && !effective({ format: 'exr' }, photo).gamut)
}
{
    const r = f => rowsFor({ ...defaultExport(), ...f }, photo)
    ok('the rows: quality for JPEG and WebP only', r({ format: 'jpeg' }).quality && r({ format: 'webp' }).quality && !r({ format: 'png' }).quality && !r({ format: 'exr' }).quality)
    ok('...values for the light formats', r({ format: 'exr' }).values && r({ format: 'hdr' }).values && r({ format: 'pfm' }).values && !r({ format: 'png16' }).values)
    ok('...precision only for an exposed EXR: absolute is float', !r({ format: 'exr' }).precision && r({ format: 'exr', values: 'exposed' }).precision
        && effective({ format: 'exr', values: 'absolute', precision: 'half' }, photo).half === false)
    ok('...no values for a lux render', !rowsFor({ format: 'exr' }, luxPic).values)
    ok('the default: PNG, absolute, float', defaultExport().format === 'png' && defaultExport().values === 'absolute' && defaultExport().precision === 'float')
    ok('every format has a line', FORMATS.every(f => holdsLine({ ...defaultExport(), format: f.id }, photo, 12).length > 10))
    ok('the line says what EXR holds', /cd\/m²/.test(holdsLine({ format: 'exr' }, photo, 12)) && /float32/.test(holdsLine({ format: 'exr' }, photo, 12))
        && /up to 96 MB/.test(holdsLine({ format: 'exr' }, photo, 12)), holdsLine({ format: 'exr' }, photo, 12))
    ok('...and lux for a lux render', /lx/.test(holdsLine({ format: 'exr' }, luxPic, 12)))
    const d = describe({ ex: { format: 'exr' }, pic: photo, settings: { ev: 12, filename: 'x', status: 'y' }, ev: 12, build: 'ShadyTracer 0.79.0 · abc' })
    ok('what a file says of itself: the build, and the light\'s unit', d.software === 'ShadyTracer 0.79.0 · abc' && JSON.parse(d.json).light.unit === 'cd/m2')
}

//======================================================================================================================
// one export through a stand-in darkroom
//======================================================================================================================
{
    // the darkroom's three readers over a picture in JS: the light as kept, the developed picture a made-up function of it
    const dev = v => Math.min(1, Math.max(0, v / 100))
    const darkroom = {
        picture: { w: W, h: H, samples: 8, view: { show: 0 }, bytes: W * H * 16 },
        async lightRows(on) { for (let r = 0; r < H; r += 8) { const k = Math.min(8, H - r); await on(PIC.slice(r * W * 3, (r + k) * W * 3), r, k) } },
        async developedRows(s, on) {
            for (let r = 0; r < H; r += 6) {
                const k = Math.min(6, H - r), a = new Float32Array(k * W * 4)
                for (let i = 0; i < k * W; i++) for (let c = 0; c < 3; c++) a[i * 4 + c] = dev(PIC[(r * W + i) * 3 + c])
                await on(a, r, k)
            }
        },
        async developed(s, { type }) {
            const P = makePNG16(1, 1); await P.addRows(new Uint16Array(3), 1)
            return type === 'image/png' ? P.finish() : new Blob([new Uint8Array([255, 216, 255])], { type })
        },
    }
    const settings = { ev: 11, toneMap: 1, filename: 'render', status: '' }
    const progress = []
    const exr = readEXR(await bytesOf(await exportPicture({ darkroom, ex: { format: 'exr', values: 'absolute' }, settings, build: 'b', onProgress: (n, of) => progress.push([n, of]) })))
    ok('export, EXR absolute: the light as kept, whiteLuminance 1, the build in it', exr.rgb.every((x, i) => x === PIC[i]) && exr.whiteLuminance === 1 && exr.strings.software === 'b')
    ok('...progress row by row to the last', progress.at(-1)[0] === H && progress.at(-1)[1] === H && progress.length === Math.ceil(H / 8))
    const s = ev100ToScale(11)
    const exr2 = readEXR(await bytesOf(await exportPicture({ darkroom, ex: { format: 'exr', values: 'exposed', precision: 'half' }, settings })))
    ok('export, EXR exposed half: times the exposure, whiteLuminance the cd/m² of 1.0', exr2.ch[0].type === 1 && near(exr2.whiteLuminance, 1 / s, 1e-6)
        && Math.abs(exr2.rgb[3 * 5] - PIC[3 * 5] * s) <= Math.abs(PIC[3 * 5] * s) * 2 ** -10 + 2 ** -24)
    const hdr = readHDR(await bytesOf(await exportPicture({ darkroom, ex: { format: 'hdr', values: 'absolute' }, settings, build: 'b' })))
    const g = gamutClip([PIC[60], PIC[61], PIC[62]]).map(v => v / 179)
    ok('export, HDR: Radiance\'s units, Rec.709 primaries, the software', g.every((v, c) => Math.abs(hdr.rgb[60 + c] - v) <= Math.max(...g) / 64 + 1e-30)
        && hdr.head.includes('PRIMARIES=0.640 0.330 0.300 0.600 0.150 0.060 0.3127 0.3290') && hdr.head.includes('SOFTWARE=b'))
    const pfm = readPFM(await bytesOf(await exportPicture({ darkroom, ex: { format: 'pfm', values: 'absolute' }, settings })))
    ok('export, PFM: the light as kept', pfm.rgb.every((x, i) => x === PIC[i]))
    const png = readPNG(await bytesOf(await exportPicture({ darkroom, ex: { format: 'png16' }, settings, build: 'b' })))
    ok('export, PNG 16-bit: the developed rows at 16 bits', png.rows.every((x, i) => x === Math.round(dev(PIC[i]) * 65535)) && JSON.parse(png.text.Comment).develop.toneMap === 1
        && !('filename' in JSON.parse(png.text.Comment).develop))
    const png8 = readPNG(await bytesOf(await exportPicture({ darkroom, ex: { format: 'png' }, settings, build: 'b' })))
    ok('export, PNG 8-bit: the darkroom\'s PNG with the text put in', png8.badCrc === 0 && png8.text.Software === 'b')
    const jpg = await exportPicture({ darkroom, ex: { format: 'jpeg', quality: 0.8 }, settings })
    ok('export, JPEG: the darkroom\'s own, as it gave it', jpg.type === 'image/jpeg')
}

//======================================================================================================================
// ffmpeg, where installed: a reader nobody here wrote
//======================================================================================================================
{
    let ff = true
    try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }) } catch { ff = false }
    if (!ff) console.log('(ffmpeg cross-check SKIPPED: no ffmpeg)')
    else {
        const d = mkdtempSync(join(tmpdir(), 'exr-'))
        const decode = file => {
            const out = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'gbrpf32le', '-'], { maxBuffer: 1 << 26 })
            const f = new Float32Array(out.buffer, out.byteOffset, out.length / 4), n = f.length / 3, rgb = new Float32Array(n * 3)
            for (let i = 0; i < n; i++) { rgb[i * 3] = f[2 * n + i]; rgb[i * 3 + 1] = f[i]; rgb[i * 3 + 2] = f[n + i] }   // planes G, B, R
            return rgb
        }
        // in gamut and within half's range, for the half and RGBE rows; the full picture for float
        const tame = PIC.map(v => Math.min(Math.max(v, 0), 60000))
        try {
            const E = makeEXR({ w: W, h: H }); await feed(E, PIC, W, H)
            writeFileSync(join(d, 'a.exr'), await bytesOf(await E.finish()))
            const a = decode(join(d, 'a.exr'))
            ok('ffmpeg reads our float32 ZIP EXR to the same numbers', a.length === PIC.length && a.every((x, i) => x === PIC[i] || near(x, PIC[i], 1e-7)),
                `${[...a.slice(0, 6)]} vs ${[...PIC.slice(0, 6)]}`)
            const E2 = makeEXR({ w: W, h: H, half: true }); await feed(E2, tame, W, H)
            writeFileSync(join(d, 'b.exr'), await bytesOf(await E2.finish()))
            const b = decode(join(d, 'b.exr'))
            ok('...and our half ZIP EXR', b.every((x, i) => Math.abs(x - tame[i]) <= Math.max(Math.abs(tame[i]) * 2 ** -10, 2 ** -24)))
            const R = makeHDR({ w: W, h: H }); await feed(R, tame, W, H)
            writeFileSync(join(d, 'c.hdr'), await bytesOf(R.finish()))
            const c = decode(join(d, 'c.hdr'))
            let bad = 0
            for (let i = 0; i < tame.length; i += 3) { const m = Math.max(tame[i], tame[i + 1], tame[i + 2]); for (let k = 0; k < 3; k++) if (Math.abs(c[i + k] - tame[i + k]) > m / 64 + 1e-30) bad++ }
            ok('...and our HDR', c.length === tame.length && bad === 0, `${bad}`)
            const P = makePFM({ w: W, h: H }); await feed(P, PIC, W, H)
            writeFileSync(join(d, 'd.pfm'), await bytesOf(P.finish()))
            const p = decode(join(d, 'd.pfm'))
            ok('...and our PFM, rows the right way up', p.every((x, i) => x === PIC[i]))
        } catch (e) { ok('ffmpeg read the files', false, String(e?.message ?? e).slice(0, 400)) }
        rmSync(d, { recursive: true })
    }
}

console.log(`export: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
