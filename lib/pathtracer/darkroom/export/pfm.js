//======================================================================================================================
// PFM (0.next) -- a portable float map: a three-line header and the floats, for a script that wants the numbers and
// nothing else. Little-endian (the scale -1), rows BOTTOM first: the format's own order, which is the accumulation's,
// so the rows handed in top first are written in reverse at the end. It has nowhere to say what its numbers mean;
// the darkroom says it beside the button instead.
//
//   const P = makePFM({ w, h });  P.addRows(rgb, k);  const blob = P.finish()
//======================================================================================================================

export function makePFM({ w, h }) {
    const rows = []
    return {
        addRows(rgb, k) {
            if (rows.length + k > h) throw new Error(`[pfm] ${rows.length + k} rows for a picture of ${h}`)
            // Float32Array is the machine's order, little-endian on every machine WebGPU runs on; said, not assumed
            if (new Uint8Array(new Float32Array([1]).buffer)[3] !== 0x3f) throw new Error('[pfm] a big-endian machine: not written')
            for (let r = 0; r < k; r++) rows.push(new Uint8Array(rgb.slice(r * w * 3, (r + 1) * w * 3).buffer))
        },
        finish() {
            if (rows.length !== h) throw new Error(`[pfm] ${rows.length} rows written of ${h}`)
            return new Blob([new TextEncoder().encode(`PF\n${w} ${h}\n-1.0\n`), ...rows.reverse()], { type: 'application/octet-stream' })
        },
    }
}
