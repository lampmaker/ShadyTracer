//======================================================================================================================
// STL -- a triangle mesh from an STL file, binary or ASCII, with its corners welded into shared vertices so it has
// edges, and whether it is closed: what fit.js needs to find the surfaces it was tessellated from.
//
// BINARY OR ASCII is told by the size, not the first word: a binary file is 84 bytes and 50 a triangle exactly, and
// some exporters begin a binary file with "solid" too, which is what an ASCII one begins with.
// WELDED BY EXACT POSITION: a CAD program writes a vertex shared by triangles as the same three floats each time, so
// equal floats are one vertex. A mesh that does not close that way is welded again to a millionth of its size, and
// whatever is still open is reported (open edges), not guessed at.
// FACING OUT: the triangles are turned round if their volume comes out negative.
//
//   readSTL(bytes) -> { name, positions: Float64Array xyz, triangles: Uint32Array abc, open, volume, warnings }
//======================================================================================================================

export function readSTL(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    const warnings = []
    let name = '', raw
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
    if (u8.length >= 84 && 84 + 50 * dv.getUint32(80, true) === u8.length) {
        const n = dv.getUint32(80, true)
        raw = new Float32Array(9 * n)
        for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) raw[9 * i + k] = dv.getFloat32(84 + 50 * i + 12 + 4 * k, true)
        name = new TextDecoder('latin1').decode(u8.slice(0, 80)).replace(/\0.*$/s, '').replace(/^solid\s*/i, '').trim()
    } else {
        const text = new TextDecoder('latin1').decode(u8)
        if (!/^\s*solid/i.test(text) || !/facet/i.test(text)) throw new Error('not an STL file: neither its size (binary) nor its first word (ASCII) says so')
        name = (/^\s*solid[ \t]*([^\r\n]*)/i.exec(text)?.[1] || '').trim()
        const v = [], re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi
        let m
        while ((m = re.exec(text))) v.push(+m[1], +m[2], +m[3])
        if (v.length % 9) throw new Error('an ASCII STL facet does not have three vertices')
        raw = Float64Array.from(v)
    }
    let mesh = weld(raw, 0)
    if (mesh.open) {
        let lo = Infinity, hi = -Infinity
        for (const x of raw) { lo = Math.min(lo, x); hi = Math.max(hi, x) }
        const again = weld(raw, 1e-6 * (hi - lo))
        if (again.open < mesh.open) mesh = again
    }
    if (mesh.dropped) warnings.push(`${mesh.dropped} triangle(s) of no area left out`)
    if (mesh.open) warnings.push(`the mesh is not closed: ${mesh.open} edge(s) belong to one triangle`)
    if (mesh.volume < 0) {
        const t = mesh.triangles
        for (let i = 0; i < t.length; i += 3) { const a = t[i + 1]; t[i + 1] = t[i + 2]; t[i + 2] = a }
        mesh.volume = -mesh.volume
    }
    return { name, ...mesh, warnings }
}

/* equal positions (to `tol`, by snapping to its lattice; exact when 0) into one vertex; triangles with two corners on
   one vertex dropped; the edges used once counted */
function weld(raw, tol) {
    const index = new Map(), pos = [], tri = []
    const key = (x, y, z) => tol > 0 ? `${Math.round(x / tol)},${Math.round(y / tol)},${Math.round(z / tol)}` : `${x},${y},${z}`
    const vert = (x, y, z) => {
        const k = key(x, y, z)
        let i = index.get(k)
        if (i === undefined) { i = pos.length / 3; index.set(k, i); pos.push(x, y, z) }
        return i
    }
    let dropped = 0
    for (let i = 0; i < raw.length; i += 9) {
        const a = vert(raw[i], raw[i + 1], raw[i + 2]), b = vert(raw[i + 3], raw[i + 4], raw[i + 5]), c = vert(raw[i + 6], raw[i + 7], raw[i + 8])
        if (a === b || b === c || c === a) { dropped++; continue }
        tri.push(a, b, c)
    }
    const triangles = Uint32Array.from(tri), positions = Float64Array.from(pos)
    // an edge once each way in a closed, consistently wound mesh: count the directed edges left without a partner
    const half = new Map()
    for (let i = 0; i < triangles.length; i += 3) for (let k = 0; k < 3; k++) {
        const a = triangles[i + k], b = triangles[i + (k + 1) % 3]
        const back = `${b},${a}`
        if (half.get(back)) { half.set(back, half.get(back) - 1); if (!half.get(back)) half.delete(back) }
        else half.set(`${a},${b}`, (half.get(`${a},${b}`) || 0) + 1)
    }
    let open = 0
    for (const v of half.values()) open += v
    let volume = 0
    for (let i = 0; i < triangles.length; i += 3) {
        const [a, b, c] = [triangles[i], triangles[i + 1], triangles[i + 2]].map(j => [positions[3 * j], positions[3 * j + 1], positions[3 * j + 2]])
        volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
    }
    return { positions, triangles, open, volume, dropped }
}
