//======================================================================================================================
// FASTER COMPILES -- chapter 27's figures run this. Pure.
//
//   THE BUILD IN TIME   one scene's kernels compiled blocking the page, off its thread one after another, or all at
//                       once: the user's measured times (docs/PERFORMANCE_REVIEW.md §10.3, the user's Pascal card,
//                       0.9.2, thirteen kernels then), laid out as each way would lay them.
//   A SESSION           what a build compiles as someone works -- a value moved, a shape added, another scene, back
//                       again -- with the kernels that hold the scene and those that do not, and tinywebgpu's pipeline
//                       cache keyed by the whole text, or without either; each build's time predicted by the engine's
//                       own compileprogress.js from a model's kernel sizes.
//   THE BAR             a build's progress as a count of kernels ready, against compileprogress.js's bar by the clock.
//======================================================================================================================

import { kernelMs, predictCompile, learnRate, DEFAULT_RATE } from '../../lib/pathtracer/core/compileprogress.js'

/* THE MEASURED BUILDS (§10.3): seconds, uncached. "all" a scene change's build, "seq" the same 13 kernels in turn;
   shade, occlude and march each alone. The other ten kernels are what one at a time leaves, 0.28 to 0.39 s together
   (computed); alone each took 12 to 126 ms. Copied; the test holds every number to the document. */
export const BUILDS = [
    { scene: 'Noise library', all: 11.2, seq: 13.4, shade: 10.7, occlude: 1.62, march: 0.75, shadeK: 715 },
    { scene: 'Surface materials', all: 7.0, seq: 8.6, shade: 7.0, occlude: 0.80, march: 0.42, shadeK: 552 },
    { scene: 'showcase', all: 4.7, seq: 5.8, shade: 4.6, occlude: 0.50, march: 0.42, shadeK: 355 },
    { scene: 'demo', all: 3.6, seq: 4.4, shade: 3.4, occlude: 0.36, march: 0.35, shadeK: 314 },
    { scene: 'Menger cubes', all: 4.3, seq: 5.2, shade: 4.1, occlude: 0.41, march: 0.33, shadeK: 306 },
    { scene: 'materials', all: 2.6, seq: 3.3, shade: 2.5, occlude: 0.22, march: 0.19, shadeK: 250 },
]
export const smallOf = b => +(b.seq - b.shade - b.occlude - b.march).toFixed(2)

/** One build laid out in time, seconds: `how` 'blocking' (one after another on the page's own thread: the page frozen
 *  for all of it), 'turn' (off the thread, one after another) or 'once' (off the thread, all at once: each starts at 0,
 *  the build ready when the measured all-at-once time says). Returns { bars: [{ name, from, to }], ready, frozen }. */
export function layout(b, how) {
    const order = [['shade', b.shade], ['occlude', b.occlude], ['march', b.march], ['ten small kernels', smallOf(b)]]
    if (how === 'once') return { bars: order.map(([name, s]) => ({ name, from: 0, to: s })), ready: b.all, frozen: 0 }
    let t = 0
    const bars = order.map(([name, s]) => { const bar = { name, from: t, to: t + s }; t += s; return bar })
    return { bars, ready: b.seq, frozen: how === 'blocking' ? b.seq : 0 }
}

/* A SESSION'S KERNELS: a model's inlined sizes, characters, of a build today (16 kernels: the photon map on, the step
   cache off). The three that hold the scene -- march, surface, occlude: their text is the scene's -- take the scene's
   size; the rest are the same text for every scene. Sizes chosen near the documents' (shade 113,000 and the optics
   bench's surface 252,000 after 0.20.8, roadmap/ARCHITECTURE.md); not measured for these scenes. */
export const FREE = { genrays: 12000, shade: 113000, flip: 900, prep_march: 900, prep_shade: 900, prep_occlude: 900, shadow_flip: 900,
    resolve: 8000, genphotons: 40000, lt_build: 6000, emit_collect: 10000, emit_publish: 1500, sppm: 30000 }
export const HOLDS = ['march', 'surface', 'occlude']
/** a scene's own kernels' sizes at a scene size `s` (its SDF, in characters, inlined once) */
export const sceneKernels = s => ({ march: 20000 + s, surface: 40000 + 2 * s, occlude: 18000 + s })

/* THE STEPS OF A SESSION: what each does to the scene's text. `scene` names the scene, `size` its SDF's size, `rev`
   its structure (a shape added is another text; undone, the text it had). */
export const SESSION = [
    { what: 'Open scene A', short: 'Open A', scene: 'A', size: 60000, rev: 0 },
    { what: 'Move a shape (a value)', short: 'Move', scene: 'A', size: 60000, rev: 0, value: true },
    { what: 'Add a shape', short: 'Add', scene: 'A', size: 64000, rev: 1 },
    { what: 'Open scene B', short: 'Open B', scene: 'B', size: 30000, rev: 0 },
    { what: 'Back to scene A', short: 'Back to A', scene: 'A', size: 64000, rev: 1 },
    { what: 'Undo the shape', short: 'Undo', scene: 'A', size: 60000, rev: 0 },
]
/**
 * The session played out: per step, which kernels compiled and which came from the cache, and the build's time
 * predicted the engine's way (compileprogress.js predictCompile: the largest uncached kernel's kernelMs). `cache`:
 * tinywebgpu's pipeline cache (its key the whole text); `free`: the kernels that hold no scene declare only the base
 * uniforms, so their text is the same for every scene (genrays.js) -- off, every kernel's text carries the scene's
 * uniform list, as before 0.10.0. A value moved changes no text: nothing compiles either way.
 */
export function playSession(steps = SESSION, { cache = true, free = true, rate = DEFAULT_RATE } = {}) {
    const seen = new Set(), out = []
    for (const st of steps) {
        if (st.value) { out.push({ ...st, compiled: [], cached: [], ms: 0 }); continue }
        const sizes = { ...FREE, ...sceneKernels(st.size) }, text = `${st.scene}#${st.rev}`
        const kernels = Object.entries(sizes).map(([name, size]) => {
            const key = HOLDS.includes(name) || !free ? `${name}|${text}` : name
            const cached = cache && seen.has(key)
            seen.add(key)
            return { name, size, cached }
        })
        const p = predictCompile(kernels, rate)
        out.push({ ...st, compiled: kernels.filter(k => !k.cached).map(k => k.name), cached: kernels.filter(k => k.cached).map(k => k.name), ms: p?.expectMs ?? 0, slowest: p?.slowest ?? null })
    }
    return out
}

/* THE BAR. A build whose kernels are ready at `readyAt` (ms, every kernel), predicted to take `expectMs`. The old bar:
   kernels ready over all of them, so it jumps as the small ones finish and sits there. The bar by the clock is
   compileprogress.js compileFraction, drawn by the chapter. */
export const countBar = (t, readyAt) => readyAt.filter(r => r <= t).length / readyAt.length
/** a build's ready times, ms, scaled to end at `totalMs`: the measured shape of a parallel build (§10.3: the small
 *  kernels ready at 177 to 402 ms, queued behind the rest; march, then occlude, then shade, which ends the build) */
export function readyTimes(totalMs, n = 16) {
    const small = Array.from({ length: n - 3 }, (_, k) => 177 + (402 - 177) * k / Math.max(1, n - 4))
    return [...small.map(v => Math.min(v, totalMs)), 0.07 * totalMs, 0.15 * totalMs, totalMs]
}

/** BUILDS ON A MACHINE `slow` times slower than the rate it starts from: each build of a kernel of `size` predicted
 *  at the kept rate, timed at the machine's real one, the rate learned after (compileprogress.js learnRate); a step
 *  marked `cacheHit` is a reload the browser's own cache answered (a 1/40 of the time). Returns each build's
 *  { rate, predicted, took, learned } */
export function learning(steps, { size = 450000, slow = 2, start = DEFAULT_RATE } = {}) {
    let rate = start
    return steps.map(st => {
        const predicted = kernelMs(size, rate), real = kernelMs(size, start * slow), took = st.cacheHit ? real / 40 : real
        const next = learnRate(rate, [{ name: 'shade', cached: false, size, ms: took }])
        const row = { rate, predicted, took, learned: next, cacheHit: !!st.cacheHit }
        rate = next
        return row
    })
}
