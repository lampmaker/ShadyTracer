//======================================================================================================================
// HOW LONG A BUILD WILL TAKE, AND HOW FAR IT HAS GOT -- for the "compiling the scene" bar.
//
// WHY NOT THE COUNT. The bar was "kernels ready of 13" (raytrace_main.js R._buildWavefrontPipelines), and nine of
// the thirteen are tiny and ready in milliseconds, so it jumped to ~12/13 and sat there for the rest of the build:
// "often gets stuck on the last part" (the user, 2026-10-03). The build is ready when its slowest kernel is --
// shade, 76-82% of the build, and all-at-once equal to shade alone within 0.5 s (measured on the user's GTX 1080 Ti,
// the benchmark's compileSeqEach) -- so the count says almost nothing about the time left.
//
// WHAT PREDICTS IT. Over 24 kernel x scene pairs on that card (Chrome 154, code 6b54026), a kernel's uncached
// compile time is about 15.2 ms per 1000 characters of its INLINED size (wgslgraph.js inlineStats, on the text
// after the shorthand the compiler is given): rms error 33%, worst 85% (all in small kernels), shade alone within
// 26% in every scene. Its plain text length does not (rms 366%). So a build's time is predicted as the largest of
// its uncached kernels' (they compile in parallel), and the rate is learned again on each machine from the builds
// it does: the 1080 Ti's number is only where a machine starts.
// ...AND IT GROWS FASTER THAN THE TEXT. Those pairs were the bench scenes, every build under ten seconds. The bigger
// builds the scaling and scenedata benchmarks then compiled on the same card (the user's Pascal, 0.16.0-0.20.0,
// 2026-10-04, `compile ms`) took up to 2.4 times the linear prediction: the optics bench 35.1 s against 15.9,
// OpticsBench2 45.9 against 18.9, the lens assembly x 4 30.8 against 15.4 -- and x 32, predicted 97 s, was still
// compiling after ten minutes. Over those 16 builds (2-46 s; the predictions from the kernels' text in node, code of
// 2026-10-04), the measured time is 0.736 x the linear prediction to the power 1.37 (seconds): rms 11%, worst 28%,
// where the linear rate alone is rms 27%, worst 59%. So a kernel's time is its size x the rate x (size / SIZE_REF) to
// the power GROWTH - 1: the rate is still the time per character, at SIZE_REF, where the two fits agree (about 151 000
// inlined characters, a 2.3 s build). Fitted on one card and 16 builds, and past 46 s an extrapolation: the x 32's
// ten minutes and more is above what it predicts (6.5 min), so a long prediction is a floor, not an estimate.
//
// Everything here is pure or takes its storage as an argument, so it is tested without a GPU or a browser
// (test/compileprogress.test.mjs). The renderer computes and learns; the page draws (index.html).
//======================================================================================================================
import { inlineStats } from './wgslgraph.js'

/** ms per inlined character, before a machine has taught its own: measured on the user's GTX 1080 Ti (above). */
export const DEFAULT_RATE = 15.2 / 1000
/** Where a machine's own rate is kept (localStorage): per browser profile, which is per machine near enough. */
export const RATE_KEY = 'pathtracer.compileRate'
/* A build whose slowest uncached kernel took less than this teaches nothing: mostly from the cache, or kernels so
   small the fixed costs (the module, the driver's own start) are most of their time -- the fit's worst errors */
export const LEARN_MIN_MS = 300
/** How much of the newest build's rate goes into the kept one: an EMA, so one odd build (the GPU busy) only half counts. */
export const LEARN_WEIGHT = 0.5
/* A BUILD THE BROWSER'S OWN CACHE ANSWERED is not a compile, and tinywebgpu cannot tell: its `cached` is only its own
   in-memory cache, gone on a reload, while the browser keeps compiled shaders across one. Measured 2026-10-03 on the
   development machine (the user's GTX 1080 Ti, headless Chrome, a fresh profile): the Noise library compiled in 6.3 s;
   the page reloaded on it, the same build took 0.2 s and then 0.1 s (shade 158 and 95 ms), none of it from
   tinywebgpu's cache -- about 1/40 of the kept rate. Those were under LEARN_MIN_MS and taught nothing, but nothing
   says a cache answer stays under 300 ms in a bigger scene or on a slower machine, and one that did not would halve
   the rate toward it: the next real edit under-predicted, its bar at 90% early and "taking longer" for most of it.
   So a build seen faster than CACHE_RATIO of the kept rate is taken for a cache answer and teaches nothing. The cost:
   a machine that really compiles over 4x faster than the rate it starts from never learns its own and is told too
   long a time -- its bar ends early, not stuck. Rates within 4x converge (a 3x-faster one: 0.67 of the rate a build). */
export const CACHE_RATIO = 0.25
/* AND NO BUILD MOVES THE RATE MORE THAN TWICE: what one build is seen to take is held to MAX_SEEN times the kept rate
   before the blend, so a stalled one (another tab on the GPU, the driver busy) at weight 0.5 doubles it at most, rather
   than multiplying it by however long the stall was. A machine really slower than its rate still gets there: twice a
   build until it is near, then the EMA. */
export const MAX_SEEN = 3
/** How a kernel's compile grows with its inlined size: time ~ size^GROWTH (fitted above), equal to the linear rate at SIZE_REF. */
export const GROWTH = 1.37, SIZE_REF = 151000
/** A kernel's predicted compile, ms, at `rate` (ms a character at SIZE_REF). */
export const kernelMs = (size, rate = DEFAULT_RATE) => rate * size * Math.pow(size / SIZE_REF, GROWTH - 1)

/* G.DEFINES EXPANDED THE WAY TINYWEBGPU EXPANDS THEM (tinywebgpu.js compileShader): the same entry parse, whole words,
   longest first. A handle's `wgsl` is the text BEFORE that expansion -- schema and entry point, the shorthand still in
   it -- and the rate was fitted on the expanded text (shaderstats.mjs: shorthand(TOKENS, SHORT_TOKENS)), so the size
   must be of what the compiler is handed. Done from the device's own table rather than wgsl_shorthand.js's, so a
   page with another table predicts from what its compiler sees. */
export function expandDefines(code, defines = '') {
    const map = {}
    String(defines || '').replace(/([^\s,]+)[ \t]+([^,\n]+)/g, (e, t, r) => { map[t] = r.trim(); return e })
    const keys = Object.keys(map)
    if (!keys.length) return code
    return code.replace(new RegExp(`\\b(?:${keys.sort((a, b) => b.length - a.length).join('|')})\\b`, 'g'), t => map[t])
}

/** A kernel's inlined size from its handle's text, or null when there is none to measure (a stub, a parse failure). */
export function inlinedSize(wgsl, defines = '') {
    if (typeof wgsl !== 'string' || !wgsl) return null
    try { return inlineStats(expandDefines(wgsl, defines), 'main')?.inlined ?? null } catch { return null }
}

/**
 * The build's predicted time: the largest over the kernels that will compile -- not from the cache (`cached`), and
 * with a size -- of kernelMs(size, rate). kernels: [{ name, cached, size }]. { expectMs, slowest } or null when none compiles.
 */
export function predictCompile(kernels, rate = DEFAULT_RATE) {
    let best = null
    for (const k of kernels) {
        if (k.cached || !(k.size > 0)) continue
        const ms = kernelMs(k.size, rate)
        if (!best || ms > best.expectMs) best = { expectMs: Math.round(ms), slowest: k.name }
    }
    return best
}

/**
 * The rate after a build: the slowest uncached kernel's time from the request until it was ready, over what kernelMs
 * would give its size at a rate of 1, held to MAX_SEEN x `rate` and blended into it -- or `rate` unchanged when no
 * uncached kernel took LEARN_MIN_MS, or when that was under CACHE_RATIO x `rate` (the browser's cache answered: nothing
 * to learn from). kernels: [{ name, cached, size, ms }].
 */
export function learnRate(rate, kernels, { minMs = LEARN_MIN_MS, weight = LEARN_WEIGHT, cacheRatio = CACHE_RATIO, maxSeen = MAX_SEEN } = {}) {
    let slow = null
    for (const k of kernels) if (!k.cached && k.size > 0 && Number.isFinite(k.ms) && (!slow || k.ms > slow.ms)) slow = k
    if (!slow || slow.ms < minMs) return rate
    const seen = slow.ms / kernelMs(slow.size, 1)
    if (!validRate(rate)) return seen
    if (seen < cacheRatio * rate) return rate
    return (1 - weight) * rate + weight * Math.min(seen, maxSeen * rate)
}

const validRate = r => Number.isFinite(r) && r > 0
/* The storage may be missing (node, a worker) or throw on any access (a private window, site data blocked): every
   touch is guarded, and a missing or unreadable rate is the default, never an error */
const storeOf = storage => { try { return storage === undefined ? globalThis.localStorage ?? null : storage } catch { return null } }
/** The machine's kept rate, or DEFAULT_RATE. `storage` defaults to localStorage. */
export function readRate(storage) {
    try { const r = Number(storeOf(storage)?.getItem(RATE_KEY)); return validRate(r) ? r : DEFAULT_RATE } catch { return DEFAULT_RATE }
}
/** Keeps `rate`; false when it could not be kept (or was not a rate). */
export function writeRate(rate, storage) {
    if (!validRate(rate)) return false
    try { const s = storeOf(storage); if (!s) return false; s.setItem(RATE_KEY, String(rate)); return true } catch { return false }
}

/* THE BAR FROM THE CLOCK. Linear to EASE_AT of the way while the build is within its prediction; past it, easing
   toward EASE_TO, never 1: the prediction is a fit with a third's error, and a bar that reached its end
   with the build still going would be the stuck bar again. The ease's time constant is half a prediction -- slower
   than a slope-matched curve, which would sit at 0.98 a third past the estimate and look stuck once more. */
const EASE_AT = 0.9, EASE_TO = 0.99, EASE_TAU = 0.5
/** How far along, 0 .. 0.99 (never 1), at `elapsedMs` into a build predicted to take `expectMs`. Monotone in elapsedMs. */
export function compileFraction(elapsedMs, expectMs) {
    if (!(expectMs > 0)) return 0
    const x = Math.max(0, elapsedMs) / expectMs
    return x <= 1 ? EASE_AT * x : EASE_TO - (EASE_TO - EASE_AT) * Math.exp(-(x - 1) / EASE_TAU)
}
/** What the bar says beside it: the seconds left while within the prediction, then that it is taking longer. */
export function compileLabel(elapsedMs, expectMs) {
    if (!(expectMs > 0) || elapsedMs >= expectMs) return 'taking longer than usual'
    return `about ${Math.max(1, Math.ceil((expectMs - elapsedMs) / 1000))} s left`
}
