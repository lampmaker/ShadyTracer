//======================================================================================================================
// PRINT -- a mesh (mesh.js) as a file a slicer opens: 3MF with a colour per triangle, OBJ with its MTL (0.next), or
// binary STL.
//
// PURE, like mesh.js: bytes out, no DOM, tested in node (test/print.test.mjs). The host downloads
// the Blob.
//
// 3MF BECAUSE IT CARRIES COLOUR in a form Bambu Studio reads: the Materials and Properties
// extension's colour group -- a list of sRGB colours -- and each triangle naming one of them (pid,
// p1). Bambu Studio's "Standard 3MF" import turns those into painted regions and asks which filament
// each colour gets; the colour group is the element it looks for. The file is a ZIP holding three
// XML parts; the model part is DEFLATEd, since a print-resolution mesh is hundreds of megabytes of
// text and compresses about tenfold. CompressionStream does it in the browser and in node alike.
//
// STL HAS NO COLOUR, and is here as the fallback every slicer reads.
//
// UNITS: both files are millimetres -- 3MF says so (unit="millimeter"), STL is taken as such by
// every slicer -- so the exporter scales from the scene's unit before this (exportbox.js).
//======================================================================================================================

import { hex } from './mesh.js'

const enc = new TextEncoder()

//----------------------------------------------------------------------------------------------
// ZIP: local headers, data, central directory. No ZIP64 -- refused past 4 GB rather than written
// wrong.
//----------------------------------------------------------------------------------------------
const CRC = (() => {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
    return t
})()
export const crc32 = (bytes, crc = 0) => {
    let c = ~crc >>> 0
    for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8)
    return ~c >>> 0
}

/** Deflate an iterable of text or byte chunks. { data, crc, size } -- size uncompressed. */
async function deflate(chunks) {
    const cs = new CompressionStream('deflate-raw')
    const out = new Response(cs.readable).arrayBuffer()
    const w = cs.writable.getWriter()
    let crc = 0, size = 0
    for (const c of chunks) {
        const b = typeof c === 'string' ? enc.encode(c) : c
        crc = crc32(b, crc); size += b.length
        await w.write(b)
    }
    await w.close()
    return { data: new Uint8Array(await out), crc, size }
}

/** A ZIP of { name, chunks } entries, each deflated. Resolves to a Uint8Array. */
export async function zip(entries) {
    const parts = [], central = []
    let offset = 0
    for (const { name, chunks } of entries) {
        const { data, crc, size } = await deflate(chunks)
        if (size > 0xFFFFFFFF || offset + data.length > 0xFFFFFFFF) throw new Error('the file would pass 4 GB, which this ZIP writer cannot say: use a coarser cell')
        const nm = enc.encode(name)
        const head = new DataView(new ArrayBuffer(30))
        head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0, true)
        head.setUint16(8, 8, true); head.setUint16(10, 0, true); head.setUint16(12, 0x21, true)   // 1980-01-01
        head.setUint32(14, crc, true); head.setUint32(18, data.length, true); head.setUint32(22, size, true)
        head.setUint16(26, nm.length, true); head.setUint16(28, 0, true)
        const cd = new DataView(new ArrayBuffer(46))
        cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0, true)
        cd.setUint16(10, 8, true); cd.setUint16(12, 0, true); cd.setUint16(14, 0x21, true)
        cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, size, true)
        cd.setUint16(28, nm.length, true); cd.setUint32(42, offset, true)
        parts.push(new Uint8Array(head.buffer), nm, data)
        central.push(new Uint8Array(cd.buffer), nm)
        offset += 30 + nm.length + data.length
    }
    const cdSize = central.reduce((s, b) => s + b.length, 0)
    const end = new DataView(new ArrayBuffer(22))
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true)
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true)
    const all = [...parts, ...central, new Uint8Array(end.buffer)]
    const out = new Uint8Array(all.reduce((s, b) => s + b.length, 0))
    let at = 0
    for (const b of all) { out.set(b, at); at += b.length }
    return out
}

//----------------------------------------------------------------------------------------------
// 3MF
//----------------------------------------------------------------------------------------------
const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
    + '</Types>\n'
const RELS = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>'
    + '</Relationships>\n'

const xmlText = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
// four decimals of a millimetre, trailing zeros dropped: a tenth of a micron is below any printer
const num = v => { const s = v.toFixed(4); return s.includes('.') ? s.replace(/\.?0+$/, '') || '0' : s }

/** The model part's text, in chunks of `per` vertices or triangles: a print-resolution mesh is too
 *  long to be one string. */
export function* modelXml({ positions, triangles, palette = null, index = null, name = 'scene', per = 50000 }) {
    const coloured = palette && palette.length > 1 && index
    yield '<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"'
        + ' xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">\n'
        + ` <metadata name="Title">${xmlText(name)}</metadata>\n`
        + ' <metadata name="Application">ShadyTracer scene builder</metadata>\n'
        + ' <resources>\n'
        + (palette?.length ? `  <m:colorgroup id="1">\n${palette.map(c => `   <m:color color="${hex(c)}"/>\n`).join('')}  </m:colorgroup>\n` : '')
        + `  <object id="2" type="model" name="${xmlText(name)}"${palette?.length ? ' pid="1" pindex="0"' : ''}>\n`
        + '   <mesh>\n    <vertices>\n'
    const nv = positions.length / 3, nt = triangles.length / 3
    for (let s = 0; s < nv; s += per) {
        let t = ''
        for (let i = s; i < Math.min(nv, s + per); i++)
            t += `     <vertex x="${num(positions[3 * i])}" y="${num(positions[3 * i + 1])}" z="${num(positions[3 * i + 2])}"/>\n`
        yield t
    }
    yield '    </vertices>\n    <triangles>\n'
    for (let s = 0; s < nt; s += per) {
        let t = ''
        for (let i = s; i < Math.min(nt, s + per); i++)
            t += `     <triangle v1="${triangles[3 * i]}" v2="${triangles[3 * i + 1]}" v3="${triangles[3 * i + 2]}"`
                + (coloured ? ` pid="1" p1="${index[i]}"/>\n` : '/>\n')
        yield t
    }
    yield '    </triangles>\n   </mesh>\n  </object>\n </resources>\n <build>\n  <item objectid="2"/>\n </build>\n</model>\n'
}

/** A 3MF file: the mesh in millimetres, and optionally a palette (sRGB [0, 1]) and a palette index
 *  per triangle. Resolves to a Uint8Array. */
export async function write3MF(mesh) {
    return zip([
        { name: '[Content_Types].xml', chunks: [CONTENT_TYPES] },
        { name: '_rels/.rels', chunks: [RELS] },
        { name: '3D/3dmodel.model', chunks: modelXml(mesh) },
    ])
}

//----------------------------------------------------------------------------------------------
// STL, binary: 80 bytes of header, a count, then 50 bytes a triangle
//----------------------------------------------------------------------------------------------
export function writeSTL({ positions, triangles, name = 'scene' }) {
    const nt = triangles.length / 3
    const buf = new ArrayBuffer(84 + 50 * nt), dv = new DataView(buf)
    new Uint8Array(buf).set(enc.encode(`binary STL, mm: ${name}`.slice(0, 80)))
    dv.setUint32(80, nt, true)
    for (let t = 0; t < nt; t++) {
        const at = 84 + 50 * t
        const p = [0, 1, 2].map(k => [0, 1, 2].map(j => positions[3 * triangles[3 * t + k] + j]))
        const u = [0, 1, 2].map(j => p[1][j] - p[0][j]), v = [0, 1, 2].map(j => p[2][j] - p[0][j])
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
        const l = Math.hypot(...n) || 1
        for (let j = 0; j < 3; j++) dv.setFloat32(at + 4 * j, n[j] / l, true)
        for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) dv.setFloat32(at + 12 + 12 * k + 4 * j, p[k][j], true)
    }
    return new Uint8Array(buf)
}

//----------------------------------------------------------------------------------------------
// OBJ WITH ITS MTL (0.next): the colours as materials, one a palette entry, each face naming its own
//
// FOR SLICERS THAT READ AN OBJ'S COLOURS AND NOT A 3MF'S: Bambu Studio before 2.5 loaded a 3MF that it had not
// written as geometry alone ("The 3mf is not from Bambu Lab, load geometry data only"), and reads an OBJ's colours,
// mapping them to filaments in a dialog. What it reads, from its own loader (BambuStudio master, 2026-11:
// libslic3r/Format/OBJ.cpp and objparser.cpp):
//   - a face's colour is its material's Kd, as given (no gamma unless asked): so Kd is the palette's sRGB, as the
//     3MF's colour group is;
//   - PLUS A TENTH OF Ka when Ka is between 0.01 and 0.99, so Ka is written 0 0 0;
//   - `d` as the colour's opacity, 1 when absent or out of (0, 1]: written 1;
//   - the MTL found by `mtllib`'s name beside the OBJ: so the two files go into the same folder under the names
//     written here (the host makes them unique, lib/filename.js, so a browser does not rename one "(1)").
// MATERIALS, NOT VERTEX COLOURS, though it reads those too: a vertex colour is the vertex's, and a face takes the mean
// of its three, so a border between two colours would come out a blend unless its vertices were split -- and a mesh
// split there is no longer closed. With materials every face has its colour and the mesh stays the one mesh.js made,
// each vertex once.
//
// OBJ HAS NO UNITS: millimetres, as the STL, which is what a slicer takes them for; z up, as the bed.
//----------------------------------------------------------------------------------------------

/** The OBJ and, with a palette, its MTL: { obj, mtl } as Uint8Arrays (mtl null without colours). `mtlName` is the
 *  MTL's file name as the OBJ names it. Faces are written by colour, the palette's order, each colour's run after one
 *  `usemtl`; the vertices as given, 1-based. */
export function writeOBJ({ positions, triangles, palette = null, index = null, name = 'scene', mtlName = 'scene.mtl', per = 50000 }) {
    const nv = positions.length / 3, nt = triangles.length / 3
    const coloured = !!(palette?.length && index)
    const chunks = [`# ${String(name).replace(/[\r\n]+/g, ' ')}\n# ShadyTracer scene builder: millimetres, z up\n`]
    if (coloured) chunks.push(`mtllib ${mtlName}\n`)
    chunks.push(`o ${String(name).replace(/\s+/g, '_') || 'scene'}\n`)
    for (let s = 0; s < nv; s += per) {
        let t = ''
        for (let i = s; i < Math.min(nv, s + per); i++) t += `v ${num(positions[3 * i])} ${num(positions[3 * i + 1])} ${num(positions[3 * i + 2])}\n`
        chunks.push(t)
    }
    const face = i => `f ${triangles[3 * i] + 1} ${triangles[3 * i + 1] + 1} ${triangles[3 * i + 2] + 1}\n`
    if (!coloured) {
        for (let s = 0; s < nt; s += per) { let t = ''; for (let i = s; i < Math.min(nt, s + per); i++) t += face(i); chunks.push(t) }
    } else {
        // the faces of each colour together: counted, then placed (a stable sort by colour, in linear time)
        const start = new Int32Array(palette.length + 1)
        for (let i = 0; i < nt; i++) start[index[i] + 1]++
        for (let c = 0; c < palette.length; c++) start[c + 1] += start[c]
        const order = new Int32Array(nt), at = start.slice(0, palette.length)
        for (let i = 0; i < nt; i++) order[at[index[i]]++] = i
        for (let c = 0; c < palette.length; c++) {
            if (start[c] === start[c + 1]) continue
            chunks.push(`usemtl ${materialName(c)}\n`)
            for (let s = start[c]; s < start[c + 1]; s += per) {
                let t = ''
                for (let k = s; k < Math.min(start[c + 1], s + per); k++) t += face(order[k])
                chunks.push(t)
            }
        }
    }
    const mtl = coloured ? enc.encode(`# ShadyTracer scene builder: ${palette.length} colour(s), sRGB\n` + palette.map((c, i) =>
        `\nnewmtl ${materialName(i)}\nKd ${c.map(v => Math.min(1, Math.max(0, v)).toFixed(6)).join(' ')}\nKa 0 0 0\nd 1\nillum 1\n`).join('')) : null
    return { obj: joinText(chunks), mtl }
}
/** Palette entry i's material name in the MTL: numbered in the palette's order, the most used first (mesh.js quantize). */
export const materialName = i => `colour_${i + 1}`

/** Text chunks as one UTF-8 array, without one string of the whole (a print-resolution OBJ is hundreds of MB). */
function joinText(chunks) {
    const parts = chunks.map(c => enc.encode(c))
    const out = new Uint8Array(parts.reduce((s, b) => s + b.length, 0))
    let at = 0
    for (const b of parts) { out.set(b, at); at += b.length }
    return out
}
