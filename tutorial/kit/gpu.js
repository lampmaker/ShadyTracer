//======================================================================================================================
// THE MACHINE IN A FEW FUNCTIONS -- what chapters 21 to 23's figures run instead of a GPU. The pages may not reach the
// GPU code (tutorial.test.mjs holds them to that), and tinywebgpu, which packs ShadyTracer's uniforms, reaches it; so
// its arithmetic is mirrored here, and the test holds the mirror to the real thing on a stand-in device. Pure.
//
//   typeInfo, layoutStruct   a uniform struct's layout: tinywebgpu's makeSchema, mirrored
//   lockstep                 lanes of a group running one loop together: each group as long as its slowest lane
//   dispatchCounts           the workgroups a dispatch asks for, flat or one row per y, against the 65535 limit
//======================================================================================================================

/** A UNIFORM'S SIZE AND ALIGNMENT, in 4-byte words (tinywebgpu.js typeInfo): a scalar 1 and 1; vecN N wide aligned to N,
 *  except vec3, which aligns to 4 and still takes 3, so a scalar after it packs into its tail; matCxR, C columns of a
 *  vecR, a 3-row column taking 4. `comps` is how many numbers it holds. */
export function typeInfo(t) {
    let m
    if (/^[fiu]32$/.test(t)) return { size: 1, align: 1, comps: 1 }
    if ((m = /^vec([234])<[fiu]32>$/.exec(t))) { const c = +m[1]; return { size: c, align: c === 3 ? 4 : c, comps: c } }
    if ((m = /^mat([234])x([234])<f32>$/.exec(t))) { const c = +m[1], r = +m[2]; return { size: c * (r === 3 ? 4 : r), align: r === 3 ? 4 : r, comps: c * r } }
    throw new Error(`unknown uniform type ${t}`)
}
const alignTo = (n, a) => Math.ceil(n / a) * a
/** A STRUCT LAID OUT IN ORDER, [[name, type], ...]: each field at the next offset its alignment allows, the whole
 *  rounded up to 16 bytes. Offsets and sizes in words; `pad` the words skipped before a field. */
export function layoutStruct(entries) {
    let offset = 0, used = 0
    const fields = entries.map(([name, type]) => {
        const { size, align } = typeInfo(type), at = alignTo(offset, align), f = { name, type, offset: at, size, pad: at - offset }
        offset = at + size; used += size
        return f
    })
    const words = alignTo(offset, 4)
    return { fields, words, bytes: words * 4, padWords: words - used, tail: words - offset }
}

/** LANES IN LOCK-STEP: `steps[i]` the loop's turns lane i needs, lanes taken `width` at a time in order. A group runs
 *  until its slowest lane is done, the others waiting. Returns the groups ({ first, lanes, max, sum }) and the totals:
 *  `work` the turns asked for, `time` the lane-turns the groups occupy (width x their max each), `use` work / time. */
export function lockstep(steps, width) {
    const groups = []
    let work = 0, time = 0
    for (let first = 0; first < steps.length; first += width) {
        const lanes = steps.slice(first, first + width), max = Math.max(...lanes), sum = lanes.reduce((a, b) => a + b, 0)
        groups.push({ first, lanes, max, sum }); work += sum; time += width * max
    }
    return { groups, work, time, use: time ? work / time : 1 }
}

/** THE WORKGROUPS A DISPATCH OVER A PICTURE ASKS FOR, `wg` threads a group: flat (one index over every pixel: all of
 *  them along x) or one row per y (x across a row, y the rows) -- prog_resolve's two ways (wavefront.js) -- against
 *  the limit a dimension may have, 65535 on effectively every adapter. */
export const MAX_GROUPS = 65535
export function dispatchCounts(w, h, wg = 64) {
    const flat = Math.ceil(w * h / wg), rows = { x: Math.ceil(w / wg), y: h }
    return { flat, flatOK: flat <= MAX_GROUPS, rows, rowsOK: rows.x <= MAX_GROUPS && rows.y <= MAX_GROUPS, limitPixels: MAX_GROUPS * wg }
}
