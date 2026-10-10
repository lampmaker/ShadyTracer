// node lib/pathtracer/core/test/compileprogress.test.mjs
//
// THE COMPILE'S PROGRESS BAR, without a GPU (compileprogress.js): what a build is predicted to take -- the largest
// of its uncached kernels' inlined sizes times a rate, the cached ones left out -- what a build teaches the rate (an
// EMA, nothing below the threshold, the storage missing or throwing), and the bar drawn from the clock: monotone,
// never at its end before the build is, and saying when it is taking longer than predicted. The engine's side --
// a real build telling expectMs, an all-cached one not -- is build.test.mjs's.
import { DEFAULT_RATE, RATE_KEY, LEARN_MIN_MS, CACHE_RATIO, MAX_SEEN, GROWTH, SIZE_REF, kernelMs, expandDefines, inlinedSize, predictCompile, learnRate, readRate, writeRate,
         compileFraction, compileLabel } from '../compileprogress.js'
import { inlineStats } from '../wgslgraph.js'
import { defines, shorthand, TOKENS, SHORT_TOKENS } from '../../../wgsl_shorthand.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const near = (a, b, e = 1e-12) => Math.abs(a - b) <= e * Math.max(1, Math.abs(b))

//----------------------------------------------------------------------------------------------------------------------
// THE SIZE: of the text the compiler is handed, the shorthand expanded as tinywebgpu expands G.defines
//----------------------------------------------------------------------------------------------------------------------
{
    const src = `fn f(p: W) -> F { return length(p); }\nfn g(p: W) -> F { return f(p) + f(p * 2.0); }\n@compute @workgroup_size(64,1,1)\nfn main(@builtin(global_invocation_id) gid: vec3<u32>) {\n  let d: F = g(W(1.0));\n}`
    const table = defines(TOKENS, SHORT_TOKENS)
    ok('expandDefines: the same text as wgsl_shorthand.js shorthand(), which the rate was fitted on', expandDefines(src, table) === shorthand(TOKENS, SHORT_TOKENS)(src))
    ok('...an empty table rewrites nothing', expandDefines(src, '') === src && expandDefines(src, undefined) === src)
    ok('...whole words only, the longest first (U3 before U)', expandDefines('U3 U U32 xU', 'U u32, U3 vec3<u32>') === 'vec3<u32> u32 U32 xU')
    const size = inlinedSize(src, table)
    ok('inlinedSize: inlineStats of the expanded text, from main', size === inlineStats(shorthand(TOKENS, SHORT_TOKENS)(src), 'main').inlined && size > 0, `${size}`)
    ok('...larger expanded than not (F -> f32, W -> vec3<f32>): the size is of what the compiler sees', size > inlineStats(src, 'main').inlined)
    ok('...g inlined into main with two copies of f', size > inlineStats(src, 'g').inlined + inlineStats(src, 'f').inlined)
    ok('...null for a handle with no text (a stub device), or none with a main', inlinedSize(undefined) === null && inlinedSize('') === null && inlinedSize('fn f() {}') === null)
}

//----------------------------------------------------------------------------------------------------------------------
// THE PREDICTION: the largest uncached kernel (they compile in parallel), at the rate
//----------------------------------------------------------------------------------------------------------------------
{
    const ks = [
        { name: 'genrays', cached: false, size: 20000 },
        { name: 'shade', cached: false, size: 400000 },
        { name: 'march', cached: false, size: 90000 },
        { name: 'flip', cached: false, size: null },           // no text to measure: left out
    ]
    const g = predictCompile(ks, DEFAULT_RATE)
    ok('the prediction: the slowest kernel, not the sum', g?.slowest === 'shade' && g.expectMs === Math.round(kernelMs(400000, DEFAULT_RATE)), JSON.stringify(g))
    ok('...the default rate is the 1080 Ti\'s 15.2 ms per 1000 inlined characters', near(DEFAULT_RATE, 0.0152))
    ok('...at the rate given', predictCompile(ks, 0.002)?.expectMs === Math.round(kernelMs(400000, 0.002)))
    const cachedShade = ks.map(k => k.name === 'shade' ? { ...k, cached: true } : k)
    const h = predictCompile(cachedShade, DEFAULT_RATE)
    ok('...a kernel from the cache is left out: it is ready at once whatever its size', h?.slowest === 'march' && h.expectMs === Math.round(kernelMs(90000, DEFAULT_RATE)), JSON.stringify(h))
    ok('...all from the cache: no prediction', predictCompile(ks.map(k => ({ ...k, cached: true })), DEFAULT_RATE) === null)
    ok('...nothing measurable (a stub\'s handles): no prediction', predictCompile([{ name: 'x', cached: false, size: null }]) === null && predictCompile([]) === null)
}

//----------------------------------------------------------------------------------------------------------------------
// THE GROWTH: a compile grows faster than its text (compileprogress.js, ...AND IT GROWS FASTER THAN THE TEXT)
//----------------------------------------------------------------------------------------------------------------------
{
    ok('kernelMs: the linear rate at SIZE_REF', near(kernelMs(SIZE_REF, DEFAULT_RATE), SIZE_REF * DEFAULT_RATE))
    ok('...twice the size, 2^GROWTH the time', near(kernelMs(4e5, 1) / kernelMs(2e5, 1), Math.pow(2, GROWTH)) && GROWTH > 1)
    /* THE BUILDS IT WAS FITTED ON, as recorded: [the linear prediction at the default rate, s (the kernels' text in node,
       2026-10-04), the uncached compile measured, s (`compile ms`, the user's Pascal: scenedata 0.20.0 and 0.16.0, the
       scaling run 0.16-0.17)]. The model must fit them as claimed, and better than the line it replaces. */
    const BUILDS = [[5.7, 8.030], [4.7, 5.711], [4.4, 5.105], [2.7, 2.554], [3.0, 3.434], [2.2, 2.334], [2.6, 2.835], [2.4, 2.730],
                    [2.8, 2.947], [2.6, 3.221], [2.2, 2.005], [2.1, 2.066], [15.9, 35.139], [18.9, 45.900], [6.7, 7.756], [15.4, 30.765]]
    // a build predicted p seconds at the default rate has the size p / DEFAULT_RATE (in ms per character)
    const model = p => kernelMs(p * 1000 / DEFAULT_RATE, DEFAULT_RATE) / 1000
    const err = f => BUILDS.map(([p, m]) => (f(p) - m) / m)
    const rms = e => Math.sqrt(e.reduce((a, x) => a + x * x, 0) / e.length), worst = e => Math.max(...e.map(Math.abs))
    const em = err(model), el = err(p => p)
    ok('...fits the 16 recorded builds: rms 11%, worst 28%', rms(em) < 0.115 && worst(em) < 0.285, `rms ${rms(em).toFixed(3)} worst ${worst(em).toFixed(3)}`)
    ok('...where the linear rate alone is rms 27%, worst 59%', rms(el) > 0.26 && worst(el) > 0.58, `rms ${rms(el).toFixed(3)} worst ${worst(el).toFixed(3)}`)
    ok('...the lens assembly x 32 as codegen (97 s linear) over six minutes; recorded as still compiling after ten', model(97.2) > 360, `${model(97.2).toFixed(0)} s`)
}

//----------------------------------------------------------------------------------------------------------------------
// THE LEARNING: the slowest uncached kernel's time over its size, half into the kept rate; nothing from a quick build,
// nor from one the browser's cache answered; no build moves it more than twice
//----------------------------------------------------------------------------------------------------------------------
{
    const r0 = 0.0152
    const K = size => kernelMs(size, 1)          // what a kernel of that size takes at a rate of 1: the rate's unit
    const ks = [
        { name: 'shade', cached: false, size: 200000, ms: 4000 },
        { name: 'march', cached: false, size: 100000, ms: 1500 },
        { name: 'flip', cached: false, size: 500, ms: 20 },
    ]
    const r1 = learnRate(r0, ks)
    ok('learnRate: an EMA of weight 0.5 toward the slowest kernel\'s time over what its size predicts at a rate of 1', near(r1, 0.5 * r0 + 0.5 * 4000 / K(200000)), `${r1}`)
    ok('...the slowest by time, not by size', near(learnRate(r0, [{ name: 'a', size: 30000, ms: 600 }, { name: 'b', size: 1e6, ms: 500 }]), 0.5 * r0 + 0.5 * 600 / K(30000)))
    ok('...the weight given', near(learnRate(r0, ks, { weight: 1 }), 4000 / K(200000)))
    ok('...a cached kernel teaches nothing, however long it waited', learnRate(r0, [{ name: 'shade', cached: true, size: 1e5, ms: 9000 }]) === r0)
    ok(`...nor a build whose slowest uncached kernel took under ${LEARN_MIN_MS} ms`, learnRate(r0, [{ name: 'shade', cached: false, size: 1e5, ms: LEARN_MIN_MS - 1 }]) === r0)
    ok('...but one at the threshold does', learnRate(r0, [{ name: 'shade', cached: false, size: 2e4, ms: LEARN_MIN_MS }]) !== r0)
    ok('...nor a kernel with no size or no time', learnRate(r0, [{ name: 'a', size: null, ms: 5000 }, { name: 'b', size: 1000 }]) === r0)
    ok('...from no kept rate, the build\'s own', near(learnRate(NaN, ks), 4000 / K(200000)))
    let r = r0
    for (let i = 0; i < 12; i++) r = learnRate(r, [{ name: 'shade', size: 100000, ms: 3000 }])
    ok('...builds in a row converge on the machine\'s rate', Math.abs(r / (3000 / K(100000)) - 1) < 1e-3, `${r}`)
    // the browser's own cache answering (measured: the Noise library's shade 158 ms over 450850 characters after a reload)
    const reload = [{ name: 'shade', cached: false, size: 450850, ms: 400 }]
    ok(`...a build seen under ${CACHE_RATIO} of the rate, over the threshold all the same, is a cache answer: nothing learned`,
        400 / K(450850) < CACHE_RATIO * r0 && learnRate(r0, reload) === r0)
    ok('...one just over that ratio is a compile, and counts', near(learnRate(r0, [{ name: 'shade', size: 1e5, ms: K(1e5) * r0 * 0.26 }]), r0 * (0.5 + 0.5 * 0.26)))
    ok('...a machine 3x faster than its rate learns it', near(learnRate(r0, [{ name: 'shade', size: 1e6, ms: K(1e6) * r0 / 3 }]), r0 * 2 / 3))
    ok(`...a stalled build (60 s for a kernel predicted 9 s) moves the rate at most to twice: seen held to ${MAX_SEEN}x`,
        near(learnRate(r0, [{ name: 'shade', size: 400000, ms: 60000 }]), 0.5 * r0 + 0.5 * MAX_SEEN * r0) && near(learnRate(r0, [{ name: 'shade', size: 400000, ms: 60000 }]), 2 * r0))
    let slowM = r0, steps = 0
    while (Math.abs(slowM / (20 * r0) - 1) > 0.01 && steps < 50) { slowM = learnRate(slowM, [{ name: 'shade', size: 1e5, ms: K(1e5) * 20 * r0 }]); steps++ }
    ok('...a machine 20x slower than its rate still gets there: twice a build, then the EMA', steps < 15 && Math.abs(slowM / (20 * r0) - 1) <= 0.01, `${steps} builds, ${slowM}`)
}

//----------------------------------------------------------------------------------------------------------------------
// THE STORAGE: kept per machine, every touch guarded
//----------------------------------------------------------------------------------------------------------------------
{
    const mem = () => { const m = new Map(); return { m, getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)) } }
    const s = mem()
    ok('readRate: nothing kept -> the default', readRate(s) === DEFAULT_RATE)
    ok('writeRate: kept under its key', writeRate(0.02, s) === true && s.m.get(RATE_KEY) === '0.02' && readRate(s) === 0.02)
    ok('...not a rate, not kept', writeRate(NaN, s) === false && writeRate(-1, s) === false && writeRate(0, s) === false && readRate(s) === 0.02)
    s.m.set(RATE_KEY, 'garbage')
    ok('readRate: an unreadable value -> the default', readRate(s) === DEFAULT_RATE)
    s.m.set(RATE_KEY, '-3')
    ok('...a negative one too', readRate(s) === DEFAULT_RATE)
    const throwing = { getItem() { throw new Error('SecurityError') }, setItem() { throw new Error('QuotaExceededError') } }
    ok('a storage that throws: the default, and nothing thrown', readRate(throwing) === DEFAULT_RATE && writeRate(0.02, throwing) === false)
    ok('no storage at all (null): the default, nothing kept', readRate(null) === DEFAULT_RATE && writeRate(0.02, null) === false)
    // the default storage: node has no localStorage (this run), and a getter that throws is how a blocked one looks
    const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    ok('...the default storage missing (node): the default, nothing kept', readRate() === DEFAULT_RATE && writeRate(0.02) === false)
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError') } })
    ok('...the default storage throwing on access: the default, nothing thrown', readRate() === DEFAULT_RATE && writeRate(0.02) === false)
    const g = mem()
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: g })
    ok('...the default storage present: used', writeRate(0.03) === true && readRate() === 0.03 && g.m.get(RATE_KEY) === '0.03')
    if (had) Object.defineProperty(globalThis, 'localStorage', had); else delete globalThis.localStorage
}

//----------------------------------------------------------------------------------------------------------------------
// THE BAR FROM THE CLOCK
//----------------------------------------------------------------------------------------------------------------------
{
    const E = 20000
    let prev = -1, monotone = true, below = true
    for (let t = 0; t <= 20 * E; t += 37) {
        const f = compileFraction(t, E)
        if (f < prev) monotone = false
        if (!(f < 1) || !(f <= 0.99)) below = false
        prev = f
    }
    ok('compileFraction: monotone in the time, from 0', compileFraction(0, E) === 0 && monotone)
    ok('...never at the end before the build is: 0.99 at most however long it runs', below && compileFraction(1e9, E) <= 0.99 && compileFraction(5 * E, E) < 0.99, `${compileFraction(1e9, E)}`)
    ok('...linear to 0.9 at the prediction', near(compileFraction(E / 2, E), 0.45) && near(compileFraction(E, E), 0.9))
    ok('...past it, still moving but slower', compileFraction(1.5 * E, E) > compileFraction(E, E) + 0.02 && compileFraction(1.5 * E, E) < 0.96 && compileFraction(3 * E, E) > 0.97,
        `${compileFraction(1.5 * E, E)} ${compileFraction(3 * E, E)}`)
    ok('...no prediction or a time before the request: 0, never NaN', compileFraction(100, 0) === 0 && compileFraction(100, undefined) === 0 && compileFraction(-50, E) === 0)
    ok('compileLabel: the seconds left while within the prediction, rounded up', compileLabel(0, E) === 'about 20 s left' && compileLabel(15500, E) === 'about 5 s left')
    ok('...never "0 s left" in its last second', compileLabel(E - 1, E) === 'about 1 s left')
    ok('..."taking longer than usual" from the prediction on', compileLabel(E, E) === 'taking longer than usual' && compileLabel(5 * E, E) === 'taking longer than usual')
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
