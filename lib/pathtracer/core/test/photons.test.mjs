// node lib/pathtracer/core/test/photons.test.mjs
//
// A SAMPLE IN BATCHES (core/photons.js planBatches), without a GPU. The case that started it: a save of glass cubes in
// the sun at a size whose camera rays filled the ray buffer, so light tracing got no photon and the light through the
// glass was gone (2026-10-08) -- and before that, an LED's spot missing from a large viewport because light tracing
// had taken the room the optics sources needed. Now every stream is traced whole at any size: the batches add up to
// exactly what was asked, no batch holds more than the buffer, and each is a fair slice of every stream.
import { planBatches, splitPart } from '../photons.js'
import { RAY_BYTES, SHADE_ITEM_BYTES } from '../tracebasics.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}

// the renderer's numbers: 1 GiB over two rays and a shade queue item, by tracebasics.js's own sizes (raytrace_main.js R.maxRays)
const MAX_RAYS = Math.floor(1024 ** 3 / (2 * RAY_BYTES + SHADE_ITEM_BYTES))

/** Every property a plan must have, for the streams it was given. */
const sound = (name, budget, streams) => {
    const p = planBatches(budget, streams)
    const K = p.batches
    const sums = streams.map((_, s) => { let t = 0; for (let k = 0; k < K; k++) t += p.part(s, k); return t })
    ok(`${name}: every stream traced whole`, sums.every((t, s) => t === Math.max(0, Math.round(streams[s]))), `${sums} vs ${streams}`)
    let worst = 0
    for (let k = 0; k < K; k++) worst = Math.max(worst, streams.reduce((a, _, s) => a + p.part(s, k), 0))
    ok(`${name}: no batch over the buffer`, worst <= budget, `${worst} > ${budget}`)
    ok(`${name}: the batches tile each stream in order (first + part = the next first)`,
        streams.every((_, s) => { for (let k = 0; k + 1 < K; k++) if (p.first(s, k) + p.part(s, k) !== p.first(s, k + 1)) return false; return p.first(s, 0) === 0 }))
    ok(`${name}: no fewer batches than the rays need, and no more than one over`,
        K >= Math.ceil(p.total / budget) && K <= Math.ceil(p.total / budget) + 1, `${K} for ${p.total} in ${budget}`)
    return p
}

{
    // the save that lost the light: 2048 x 2048, one photon a pixel, half of them emitter probes
    const px = 2048 * 2048
    const p = sound('2048 x 2048 with light tracing', MAX_RAYS, [px, px / 2, px / 2])
    ok('...in batches, where one fill gave the photons nothing', p.batches === Math.ceil(2 * px / MAX_RAYS) && p.batches > 1, `${p.batches}`)
    ok('...each batch a fair slice: camera and photons in the same proportion as asked',
        [...Array(p.batches).keys()].every(k => Math.abs(p.part(0, k) - (p.part(1, k) + p.part(2, k))) <= 2))
}
{
    const px = 800 * 600
    const p = sound('a panel-sized view with light tracing', MAX_RAYS, [px, 0, px])
    ok('...one batch, the sample as it always was', p.batches === 1 && p.part(0, 0) === px && p.first(0, 0) === 0 && p.part(2, 0) === px)
}
{
    // 4K, High quality's two photons a pixel, and an optics source asking one
    const px = 3840 * 2160
    sound('4K, two photons a pixel and an optics source', MAX_RAYS, [px, px / 2, 1.5 * px, px])
}
sound('1080p, the stream sizes not dividing evenly', MAX_RAYS, [1920 * 1080, 12345, 2 * 1920 * 1080 - 12345, 777777])
sound('a tiny buffer: many batches', 100, [1001, 7, 333, 0, 50])
sound('streams of nothing', MAX_RAYS, [640 * 480, 0, 0])
{
    const p = planBatches(1000, [500, NaN, -5, undefined])
    ok('nonsense streams count as none', p.batches === 1 && p.part(1, 0) === 0 && p.part(2, 0) === 0 && p.part(3, 0) === 0, JSON.stringify(p.streams))
}
ok('splitPart: the parts add up and differ by at most one',
    [[10, 3], [7, 7], [0, 4], [1, 5], [1000003, 17]].every(([n, K]) => {
        const parts = [...Array(K).keys()].map(k => splitPart(n, K, k))
        return parts.reduce((a, b) => a + b, 0) === n && Math.max(...parts) - Math.min(...parts) <= 1
    }))

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
