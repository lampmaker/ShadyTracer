//======================================================================================================================
// ZEMAX SOURCE FILES (.DAT) -- ray sets, as LED makers publish them, read into typed arrays.
//
//   const f = parseZemax(arrayBuffer)
//   f.header   { identifier, count, description, sourceFlux, raySetFlux, wavelength, units, loc, rot,
//                format, fluxType }
//   f.rays     Float32Array, RAY_FLOATS a ray: x, y, z, flux, l, m, n, wavelength -- positions in METRES,
//              the file's own placement (loc, rot) applied, directions unit
//
// THE FORMAT (Zemax OpticStudio "source file", little endian):
//   int    identifier        8675309 for OpticStudio's own; others write 1010
//   uint   count             rays in the file
//   char   description[100]
//   float  sourceFlux, raySetFlux, wavelength (um, 0 = several), inclinationBeg, inclinationEnd,
//          azimuthBeg, azimuthEnd
//   long   dimensionUnits    0 m, 1 in, 2 cm, 3 ft, 4 mm  (4 bytes)
//   float  locX, locY, locZ, rotX, rotY, rotZ (radians), scaleX, scaleY, scaleZ, unused x4
//   int    rayFormatType     0: flux only -- x y z l m n flux (7 floats);  2: spectral -- + wavelength
//   int    fluxType          0 watts, 1 lumens
//   int    reserved x2
//  = 208 bytes of header, then the rays.
//
// WHAT THE OLD PARSER (lampmaker/raytracer core/zemaxRayfileparser.js) GOT WRONG, and this does not:
//   - it ignored rayFormatType, so a spectral file (8 floats a ray) was read 7 at a time: garbage
//     from the second ray on. Here the record size comes from the type, and a file whose length
//     disagrees with header + count x record is refused rather than read.
//   - it ignored dimensionUnits: the positions of an mm file were taken as whatever the scene used.
//   - it ignored the file's own location and rotation.
//   - it made one JS object per ray: 100 000 of them for a typical LED file.
//
// THE ROTATION CONVENTION IS NOT VERIFIED. The header's rotX/Y/Z are applied as rotations about x,
// then y, then z (the builder's own convention). No file at hand has a rotation to check it
// against; `rotated` says when one does, so a caller can say so.
//======================================================================================================================

export const ZEMAX_HEADER_BYTES = 208
export const RAY_FLOATS = 8
export const ZEMAX_UNITS = { 0: ['m', 1], 1: ['in', 0.0254], 2: ['cm', 0.01], 3: ['ft', 0.3048], 4: ['mm', 0.001] }

/** Read a Zemax source file. Throws with a reason for anything it cannot read honestly. */
export function parseZemax(buffer) {
    const dv = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer, buffer.byteOffset ?? 0, buffer.byteLength)
    if (dv.byteLength < ZEMAX_HEADER_BYTES) throw new Error(`not a Zemax source file: ${dv.byteLength} bytes, the header alone is ${ZEMAX_HEADER_BYTES}`)
    let o = 0
    const i32 = () => { const v = dv.getInt32(o, true); o += 4; return v }
    const u32 = () => { const v = dv.getUint32(o, true); o += 4; return v }
    const f32 = () => { const v = dv.getFloat32(o, true); o += 4; return v }
    const identifier = i32(), count = u32()
    let description = ''
    for (let k = 0; k < 100; k++) { const c = dv.getUint8(o + k); if (!c) break; description += String.fromCharCode(c) }
    o += 100
    const sourceFlux = f32(), raySetFlux = f32(), wavelength = f32()
    const inclination = [f32(), f32()], azimuth = [f32(), f32()]
    const unitsCode = i32()
    const loc = [f32(), f32(), f32()], rot = [f32(), f32(), f32()]
    o += 4 * 7                                         // scale x3 (unused), unused x4
    const format = i32(), fluxType = i32()
    o += 8
    if (!(unitsCode in ZEMAX_UNITS)) throw new Error(`unknown dimension units ${unitsCode} (0 m, 1 in, 2 cm, 3 ft, 4 mm)`)
    if (format !== 0 && format !== 2) throw new Error(`ray format ${format} is not read here: 0 (flux only) and 2 (spectral) are`)
    const per = format === 2 ? 8 : 7
    const want = ZEMAX_HEADER_BYTES + count * per * 4
    if (dv.byteLength !== want)
        throw new Error(`the file is ${dv.byteLength} bytes; a header and ${count} rays of ${per} floats would be ${want}`)
    const [unitName, toM] = ZEMAX_UNITS[unitsCode]

    // the file's own placement: rotate (x, then y, then z -- see the header), then move
    const R = rotXYZ(rot)
    const rotated = rot.some(r => r !== 0)
    const rays = new Float32Array(count * RAY_FLOATS)
    let total = 0
    for (let k = 0; k < count; k++) {
        const b = ZEMAX_HEADER_BYTES + k * per * 4
        const r = j => dv.getFloat32(b + j * 4, true)
        let p = [r(0), r(1), r(2)], d = [r(3), r(4), r(5)]
        if (rotated) { p = mul(R, p); d = mul(R, d) }
        const l = Math.hypot(d[0], d[1], d[2]) || 1
        const flux = r(6)
        total += flux
        rays.set([(p[0] + loc[0]) * toM, (p[1] + loc[1]) * toM, (p[2] + loc[2]) * toM, flux,
                  d[0] / l, d[1] / l, d[2] / l, per === 8 ? r(7) : wavelength], k * RAY_FLOATS)
    }
    return {
        header: { identifier, count, description, sourceFlux, raySetFlux, wavelength, inclination, azimuth,
                  units: unitName, metresPerUnit: toM, loc, rot, rotated, format, fluxType,
                  fluxUnit: fluxType === 1 ? 'lm' : 'W' },
        rays, total,
    }
}

const rotXYZ = ([ax, ay, az]) => {
    const [cx, sx, cy, sy, cz, sz] = [Math.cos(ax), Math.sin(ax), Math.cos(ay), Math.sin(ay), Math.cos(az), Math.sin(az)]
    // Rz * Ry * Rx: x applied first
    return [[cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
            [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
            [-sy, cy * sx, cy * cx]]
}
const mul = (M, v) => M.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2])

/** Write a Zemax source file (format 0 or 2) -- for tests, and later for a ray set leaving an optic.
 *  rays: [{ pos: [x, y, z], dir: [l, m, n], flux, wavelength? }] in the file's own units. */
export function writeZemax(rays, { description = '', units = 4, format = 0, fluxType = 0, wavelength = 0.55,
                                  loc = [0, 0, 0], rot = [0, 0, 0], identifier = 8675309 } = {}) {
    const per = format === 2 ? 8 : 7
    const buf = new ArrayBuffer(ZEMAX_HEADER_BYTES + rays.length * per * 4)
    const dv = new DataView(buf)
    const total = rays.reduce((a, r) => a + r.flux, 0)
    let o = 0
    const i32 = v => { dv.setInt32(o, v, true); o += 4 }, f32 = v => { dv.setFloat32(o, v, true); o += 4 }
    i32(identifier); dv.setUint32(o, rays.length, true); o += 4
    for (let k = 0; k < 100; k++) dv.setUint8(o + k, k < description.length ? description.charCodeAt(k) & 0x7f : 0)
    o += 100
    f32(total); f32(total); f32(wavelength); f32(0); f32(90); f32(0); f32(360)
    i32(units)
    for (const v of [...loc, ...rot, 1, 1, 1, 0, 0, 0, 0]) f32(v)
    i32(format); i32(fluxType); i32(0); i32(0)
    for (const r of rays) {
        for (const v of [...r.pos, ...r.dir, r.flux]) f32(v)
        if (per === 8) f32(r.wavelength ?? wavelength)
    }
    return buf
}
