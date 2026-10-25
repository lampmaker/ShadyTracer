// node lib/pathtracer/test/develop.test.mjs
//
// DEVELOP (lib/pathtracer/develop.js): a rendered picture kept as light, exposed and tone-mapped after the render.
// No GPU. What it checks: the settings a develop starts from are the ones the display used for that render (so a
// save left untouched is the picture the old Save PNG wrote); the develop pass's uniforms are every name its schema
// declares; the preview's box; the meter's median; and the darkroom on a recording stand-in for the device -- the
// copy, the overlay drawn while the render's camera is its own, the save at full size, the memory given back.
// The viewer's (0.next): the `view` a save and a thumbnail take -- the mapping the pass always had -- and the one a
// preview is given, the clipping stripes never in a save; the histogram's clear, dispatch and read back; one pixel's
// light read from the right place.
// Whether the preview and the PNG LOOK right only the user's GPU and eye can say.
import { viewSettings, developUniforms, DEVELOP_UNIFORMS, boxFor, boxForSpan, viewFill, histogramStep, clipShares,
         medianLuminance, makeDarkroom, MAX_BOX, stripView, rowsPerStrip } from '../develop.js'
import { derive, ev100ToScale, meterEV100 } from '../core/photometry.js'
import { rendertoscreen_prog, develop_prog, develop_histogram_prog, DevelopHistogramUniformTypes, HIST_BINS }
    from '../core/rendertoscreen.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const near = (a, b, tol = 1e-12) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b))

//----------------------------------------------------------------------------------------------------------------------
// where a develop starts: what the display used
//----------------------------------------------------------------------------------------------------------------------
const view = { exposureEV: 12.5, autoExposure: 0, exposureComp: 1, toneMap: 2, contrast: 0.1, saturation: -0.2,
               brightness: 0.05, measureMode: 0, measureMin: 2, measureMax: 5000, measureBands: 7 }
{
    const s = viewSettings(view, [9, 1])
    ok('manual exposure: the manual EV, whatever the meter last read', s.ev === 12.5)
    ok('the tone curve and grading as set', s.toneMap === 2 && s.contrast === 0.1 && s.saturation === -0.2 && s.brightness === 0.05)
    ok('the false-colour scale as set', s.show === 0 && s.measureMin === 2 && s.measureMax === 5000 && s.measureBands === 7)
    /* the display's own multiplier for a manual exposure is derive()'s exposureScale (rendertoscreen.js: UB.exposureScale) */
    ok('untouched, manual: the multiplier the display used', near(developUniforms(s, { src: [4, 4], res: [4, 4] }).exposureScale,
        derive(view).exposureScale))
}
{
    const auto = { ...view, autoExposure: 1 }
    const s = viewSettings(auto, [9.25, 1])
    ok('auto exposure, metered: the metered EV less the compensation', s.ev === 8.25, `${s.ev}`)
    // the display: ev100ToScale(aeState[0] - UB.exposureComp) when autoExposure and aeState[1] != 0
    ok('untouched, auto: the multiplier the display used', near(developUniforms(s, { src: [4, 4], res: [4, 4] }).exposureScale,
        ev100ToScale(9.25 - 1)))
    ok('auto exposure that never metered (aeState[1] 0): the manual EV, as the display falls back to',
        viewSettings(auto, [9.25, 0]).ev === 12.5)
    ok('auto exposure, nothing read back: the manual EV', viewSettings(auto, null).ev === 12.5)
}
ok('a measuring view starts as that view', viewSettings({ ...view, measureMode: 1 }).show === 1)
ok('nothing at all: EV 15, the schema\'s default', viewSettings().ev === 15)

//----------------------------------------------------------------------------------------------------------------------
// the develop pass's uniforms
//----------------------------------------------------------------------------------------------------------------------
{
    const u = developUniforms(viewSettings(view), { src: [1920, 1080], res: [1920, 1080], overlay: true })
    const keys = Object.keys(u)
    ok('every uniform the develop pass declares is written, and nothing else (tinywebgpu refuses an undeclared name)',
        keys.length === DEVELOP_UNIFORMS.length && DEVELOP_UNIFORMS.every(k => k in u), `${keys} vs ${DEVELOP_UNIFORMS}`)
    ok('auto exposure off in the pass: the EV is decided once, here', u.autoExposure === 0 && u.exposureComp === 0)
    ok('the overlay flag', u.overlayOn === 1 && developUniforms(viewSettings(), { src: [1, 1], res: [1, 1] }).overlayOn === 0)
    ok('at full size one tap a pixel: exactly the display\'s pixel', u.box === 1)
    ok('no view given: the whole picture over the whole output (centre src/2, span src/res), the mapping the pass always had',
        u.view.join() === [960, 540, 1, 1].join() && u.clipWarn === 0)
    const t = developUniforms(viewSettings(view), { src: [1920, 1080], res: [190, 107] })
    ok('a thumbnail of not quite the picture\'s shape: each axis its own span, so the picture fills it',
        near(t.view[2], 1920 / 190) && near(t.view[3], 1080 / 107) && t.box === boxFor([1920, 1080], [190, 107]))
    const z = developUniforms(viewSettings(view), { src: [1920, 1080], res: [800, 600], view: [100, 200, 0.25, 0.25], clipWarn: true })
    ok('a view given: passed as it is; zoomed in (a span under 1) one tap -- the nearest pixel', z.view.join() === '100,200,0.25,0.25'
        && z.box === 1 && z.clipWarn === 1)
    ok('zoomed out to a span of 3: 3 x 3 taps', developUniforms(viewSettings(view), { src: [10, 10], res: [10, 10], view: [5, 5, 3, 3] }).box === 3)
}
ok('viewFill: the centre and the span each way', viewFill([400, 300], [200, 50]).join() === '200,150,2,6')
ok('boxFor is boxForSpan of the whole picture\'s spans', boxFor([3000, 100], [1000, 100]) === boxForSpan([3, 1]))
ok('a half-size preview averages 2 x 2', boxFor([1920, 1080], [960, 540]) === 2)
ok('an odd ratio rounds up: every picture pixel inside some tap\'s reach', boxFor([1000, 1000], [300, 300]) === 4)
ok(`a 4K picture in a small preview: at most ${MAX_BOX} a side`, boxFor([3840, 2160], [400, 225]) === MAX_BOX)
ok('an output larger than the picture: still one tap', boxFor([100, 100], [400, 400]) === 1)

//----------------------------------------------------------------------------------------------------------------------
// the histogram's arithmetic
//----------------------------------------------------------------------------------------------------------------------
ok('the histogram visits every pixel of a picture of a million or fewer', histogramStep(1024, 1024) === 1 && histogramStep(640, 360) === 1)
ok('...and about a million of a bigger one: 4K every 3rd each way, 16K x 16K every 16th',
    histogramStep(3840, 2160) === 3 && histogramStep(16384, 16384) === 16)
{
    const bins = new Uint32Array(4 * HIST_BINS)
    bins[3 * HIST_BINS] = 10; bins[3 * HIST_BINS + 100] = 80; bins[4 * HIST_BINS - 1] = 10
    bins[0] = 999                                   // red's black bin: not luma, not counted
    const c = clipShares(bins)
    ok('the shares at white and black are luma\'s, of every pixel counted', near(c.white, 0.1) && near(c.black, 0.1) && c.pixels === 100,
        JSON.stringify(c))
    ok('nothing counted: nothing said', clipShares(new Uint32Array(4 * HIST_BINS)).pixels === 0)
}

//----------------------------------------------------------------------------------------------------------------------
// the meter's median
//----------------------------------------------------------------------------------------------------------------------
const pixels = list => {           // [[r, g, b, count], ...] as the accumulation's words
    const f = new Float32Array(list.length * 4), u = new Uint32Array(f.buffer)
    list.forEach(([r, g, b, n], i) => { f[i * 4] = r; f[i * 4 + 1] = g; f[i * 4 + 2] = b; u[i * 4 + 3] = n })
    return u
}
{
    const words = pixels([[1, 1, 1, 4], [5, 5, 5, 4], [1e6, 1e6, 1e6, 0], [3, 3, 3, 4], [0, 0, 0, 0]])
    ok('the median of the sampled pixels; one never sampled is left out, however bright its words', near(medianLuminance(words), 3, 1e-6),
        `${medianLuminance(words)}`)
    ok('luminance is Rec.709 Y, not the mean of the channels', near(medianLuminance(pixels([[0, 0, 1, 1]])), 0.0722, 1e-6))
    ok('nothing sampled: 0', medianLuminance(pixels([[1, 1, 1, 0]])) === 0)
    const many = pixels(Array.from({ length: 1000 }, (_, i) => [i, i, i, 1]))
    ok('strided when there are more pixels than the cap: still the median', Math.abs(medianLuminance(many, 100) - 500) <= 10,
        `${medianLuminance(many, 100)}`)
}

//----------------------------------------------------------------------------------------------------------------------
// one function for the display and the develop pass
//----------------------------------------------------------------------------------------------------------------------
{
    const grab = () => { let text; return [{ makeFrag: f => { text = f; return {} } }, () => text] }
    const [a, ta] = grab(), [b, tb] = grab()
    await rendertoscreen_prog(a); await develop_prog(b)
    const fn = t => t.slice(t.indexOf('fn displayPixel'), t.indexOf('fn frag'))
    ok('the display and the develop pass run the same per-pixel function, text for text',
        fn(ta()).length > 500 && fn(ta()).trim() === fn(tb()).trim())
    /* ...and the histogram counts what the develop pass draws: the same function, in a compute kernel */
    let body, main, types, res
    await develop_histogram_prog({ makeCompute: (b, m, t, r) => { body = b; main = m; types = t; res = r; return {} } })
    ok('the histogram runs the same per-pixel function', body.includes(fn(ta()).trim()))
    ok('...over the kept light, read-only, into its bins', res.hdr.startsWith('read ') && /atomic<u32>/.test(res.hist))
    ok('...declaring every develop uniform and its step', types === DevelopHistogramUniformTypes
        && DEVELOP_UNIFORMS.every(k => k in types) && types.step === 'u32')
    // check-shaders pass two lints the one shape Tint refuses: a barrier after an early return
    const firstBarrier = main.indexOf('workgroupBarrier')
    ok('...no return before its barriers: every invocation reaches them', firstBarrier > 0 && !/\breturn\b/.test(main))
}

//----------------------------------------------------------------------------------------------------------------------
// the darkroom, on a recording device
//----------------------------------------------------------------------------------------------------------------------
const fakeGpu = ({ oom = false, data = null, slice = false } = {}) => {
    const log = [], made = { buffers: [], textures: [] }
    const g = {
        format: 'bgra8unorm', log, made, prog: null,
        device: {
            pushErrorScope: k => log.push(`push ${k}`),
            popErrorScope: async () => (log.push('pop'), oom ? { message: 'out of memory' } : null),
            createCommandEncoder: () => ({
                copyBufferToBuffer: (src, so, dst, d, n) => log.push({ copy: { src, so, dst, d, n } }),
                finish: () => 'commands',
            }),
            queue: { submit: c => log.push(`submit ${c}`) },
        },
        createStorageBuffer: n => {
            const b = { size: n, destroyed: false, destroy() { this.destroyed = true } }
            made.buffers.push(b)
            return { b, clear: () => log.push(`clear ${n}`),
                     r: async (bytes, off, C) => (log.push(`read ${bytes} at ${off}`),
                         slice && data ? new C(data.buffer.slice(off, off + bytes)) : data ?? new C(bytes / 4)) }
        },
        createTexture: (width, height, format) => {
            const t = { width, height, format, destroyed: false, destroy() { this.destroyed = true } }
            made.textures.push(t)
            return t
        },
        compiles: 0,
        makeFrag: (frag, types, resources, opts) => (g.compiles++, g.prog = {
            frag, types, resources, opts, draws: [], bound: null, u: null,
            setResources(r) { this.bound = r },
            set uniforms(u) { this.u = u },
            drawTo(target) { this.draws.push({ target, u: this.u, bound: this.bound }) },
        }),
        save: async (tex, name, opts) => (log.push({ save: { tex, name, opts } }), 'blob'),
        // a texture read back: its rows tagged with the draw that last went into it, so a strip says which draw it was
        readTexture: async (tex, o) => (log.push({ readTexture: { tex, ...o } }),
            new Float32Array(tex.width * o.height * 4).fill(g.prog.draws.filter(d => d.target === tex).length)),
        hcompiles: 0,
        makeCompute: (body, main, types, resources, opts) => (g.hcompiles++, g.hprog = {
            types, resources, opts, runs: [], bound: null, u: null,
            setResources(r) { this.bound = r },
            set uniforms(u) { this.u = u },
            run(x, y, z) { log.push('run'); this.runs.push({ x, y, z, u: this.u, bound: this.bound }) },
        }),
    }
    return g
}
const accum = { b: { label: 'the accumulation' } }
{
    const g = fakeGpu()
    const D = makeDarkroom(g)
    let threw = null
    try { await D.save(viewSettings(view), 'x.png') } catch (e) { threw = e }
    ok('nothing kept: a save says so rather than writing a black file', threw && D.picture === null)

    const drawnInto = []
    const overlay = t => drawnInto.push(t)
    const pic = await D.keep({ from: accum, w: 640, h: 360, samples: 32, overlays: [overlay], view: viewSettings(view) })
    const copy = g.log.find(x => x.copy)?.copy
    ok('the accumulation copied whole: 16 bytes a pixel, from its start', copy && copy.src === accum.b && copy.so === 0 && copy.d === 0
        && copy.n === 640 * 360 * 16 && copy.dst === g.made.buffers[0], JSON.stringify(copy))
    ok('asked for in an out-of-memory scope, before the copy',
        g.log.indexOf('push out-of-memory') < g.log.indexOf('pop') && g.log.indexOf('pop') < g.log.findIndex(x => x.copy))
    ok('the overlay drawn during keep (the render\'s camera still in place), into a texture of the picture\'s size in the canvas format',
        drawnInto.length === 1 && drawnInto[0].width === 640 && drawnInto[0].height === 360 && drawnInto[0].format === 'bgra8unorm')
    ok('what is kept is said', pic.w === 640 && pic.h === 360 && pic.samples === 32 && pic.bytes === 640 * 360 * 16 && pic.overlay
        && pic.view.ev === 12.5)
    pic.view.ev = 99
    ok('...and a copy: changing it changes nothing kept', D.picture.view.ev === 12.5)

    const target = { width: 320, height: 180 }
    await D.preview({ getCurrentTexture: () => target }, viewSettings(view))
    const pv = g.prog.draws.at(-1)
    ok('the preview drawn into the canvas\'s texture at its size, 2 x 2 taps', pv.target === target && pv.u.res[0] === 320
        && pv.u.res[1] === 180 && pv.u.box === 2 && pv.u.src[0] === 640)
    ok('the kept light and the overlay bound', pv.bound.hdr === g.made.buffers[0] && pv.bound.overlay === drawnInto[0] && pv.u.overlayOn === 1)

    const dev = { ...viewSettings(view), ev: 10, toneMap: 4 }
    const blob = await D.save(dev, 'shot.png')
    const sv = g.log.find(x => x.save)?.save, last = g.prog.draws.at(-1)
    ok('a save draws at the picture\'s own size, one tap a pixel, into a texture of the canvas format', last.u.res[0] === 640
        && last.u.res[1] === 360 && last.u.box === 1 && last.target.format === 'bgra8unorm' && last.target.width === 640)
    ok('...with the settings given', near(last.u.exposureScale, ev100ToScale(10)) && last.u.toneMap === 4)
    ok('...and writes that texture under the name given, its texture then freed', blob === 'blob' && sv.tex === last.target
        && sv.name === 'shot.png' && last.target.destroyed)
    ok('one program for every draw: compiled once', g.compiles === 1 && g.prog.draws.length === 2, `${g.compiles}`)

    const [hdr1, ov1] = [g.made.buffers[0], drawnInto[0]]
    await D.keep({ from: accum, w: 100, h: 50, view: viewSettings(view) })
    ok('a new picture gives the last one\'s memory back', hdr1.destroyed && ov1.destroyed)
    ok('no overlays: no texture, and the flag off', D.picture.overlay === false && g.made.textures.filter(t => t.width === 100).length === 0)
    await D.preview({ getCurrentTexture: () => ({ width: 100, height: 50 }) }, viewSettings(view))
    ok('...a placeholder bound in its place, never read', g.prog.draws.at(-1).u.overlayOn === 0 && g.prog.draws.at(-1).bound.overlay
        && g.prog.draws.at(-1).bound.overlay.width === 1)
    const hdr2 = g.made.buffers[1]
    D.discard()
    ok('discard gives the memory back and keeps nothing', hdr2.destroyed && D.picture === null)
}
{
    const g = fakeGpu({ oom: true })
    const D = makeDarkroom(g)
    let threw = null
    try { await D.keep({ from: accum, w: 8192, h: 8192, view: viewSettings(view) }) } catch (e) { threw = e }
    ok('no room for the copy: said, nothing copied, nothing kept, the buffer freed', threw && /no room/.test(threw.message)
        && !g.log.some(x => x.copy) && D.picture === null && g.made.buffers[0].destroyed, threw?.message)
}
{
    const words = pixels([[2, 2, 2, 1], [4, 4, 4, 1], [6, 6, 6, 1]])
    const g = fakeGpu({ data: words })
    const D = makeDarkroom(g)
    ok('the meter with nothing kept: nothing', await D.meter() === null)
    await D.keep({ from: accum, w: 3, h: 1, view: viewSettings(view) })
    const ev = await D.meter()
    ok('the meter: the EV a reflected-light meter reads for the median luminance', near(ev, meterEV100(4), 1e-6), `${ev}`)
    ok('...read from the kept copy, all of it', g.log.includes(`read ${3 * 16} at 0`))
}
{
    // the viewer's: a preview of part of the picture, the histogram, one pixel
    const words = pixels([[1, 2, 3, 1]])
    const g = fakeGpu({ data: new Float32Array(words.buffer) })
    const D = makeDarkroom(g)
    ok('no picture: no histogram, no pixel', await D.histogram(viewSettings(view)) === null && await D.pixel(0, 0) === null)
    await D.keep({ from: accum, w: 3000, h: 2000, view: viewSettings(view) })
    await D.preview({ getCurrentTexture: () => ({ width: 800, height: 600 }) }, viewSettings(view), { view: [10, 20, 0.5, 0.5], clipWarn: true })
    const pv = g.prog.draws.at(-1)
    ok('a preview draws the view it is given, with the stripes asked for', pv.u.view.join() === '10,20,0.5,0.5' && pv.u.clipWarn === 1 && pv.u.box === 1)
    await D.save(viewSettings(view), 'x.png')
    const sv = g.prog.draws.at(-1)
    ok('...and a save after it the whole picture at its own size, never striped', sv.u.view.join() === '1500,1000,1,1' && sv.u.clipWarn === 0)

    const bins = await D.histogram({ ...viewSettings(view), ev: 9 })
    const run = g.hprog.runs.at(-1), hist = g.made.buffers[1]
    ok('the histogram: a 4 KB buffer of its own, cleared, then counted, then read back',
        hist.size === 4 * HIST_BINS * 4 && g.log.indexOf(`clear ${4 * HIST_BINS * 4}`) < g.log.lastIndexOf('run')
        && g.log.lastIndexOf('run') < g.log.lastIndexOf(`read ${4 * HIST_BINS * 4} at 0`) && bins)
    const step = histogramStep(3000, 2000)
    ok('...over every step-th pixel each way, at the picture\'s own pixels, with the settings given', step === 3
        && run.x === 1000 && run.y === Math.ceil(2000 / 3) && run.u.step === 3 && run.u.res.join() === '3000,2000'
        && near(run.u.exposureScale, ev100ToScale(9)))
    ok('...binding the kept light and its bins', run.bound.hdr === g.made.buffers[0] && run.bound.hist === hist)
    ok('...every name its kernel declares', Object.keys(run.u).length === Object.keys(DevelopHistogramUniformTypes).length)
    await D.histogram(viewSettings(view))
    ok('the histogram kernel compiled once, its buffer made once', g.hcompiles === 1 && g.made.buffers.length === 2)

    const px = await D.pixel(7, 5)
    ok('one pixel: 16 bytes, from (y w + x) 16', g.log.includes(`read 16 at ${(5 * 3000 + 7) * 16}`))
    ok('...its light and luminance', px.rgb.join() === '1,2,3' && near(px.Y, 0.2126 + 2 * 0.7152 + 3 * 0.0722, 1e-6))
    ok('off the picture: nothing read', await D.pixel(3000, 0) === null && await D.pixel(-1, 4) === null)
    D.discard()
    ok('discard frees the histogram\'s buffer too', hist.destroyed)
}

//----------------------------------------------------------------------------------------------------------------------
// the exports' readers (0.next): the light in strips, the developed picture in float strips, the developed blob
//----------------------------------------------------------------------------------------------------------------------
{
    const w = 5, h = 7
    const f = new Float32Array(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f.set([y * 10 + x, -y, 1000 + x, 99], (y * w + x) * 4)   // y the buffer's row
    const g = fakeGpu({ data: new Uint32Array(f.buffer), slice: true })
    const D = makeDarkroom(g)
    await D.keep({ from: accum, w, h, view: viewSettings(view) })
    const got = []
    await D.lightRows(async (rgb, r0, k) => got.push({ rgb: [...rgb], r0, k }), { stripBytes: w * 16 * 3 })
    ok('the light in strips of whole rows, top first, every row once', got.map(s => `${s.r0}+${s.k}`).join() === '0+3,3+3,6+1')
    const reads = g.log.filter(x => typeof x === 'string' && x.startsWith('read ')).map(x => x.slice(5))
    ok('...each strip one read of its rows from the buffer (rows run from the bottom)',
        reads.join() === [`${3 * w * 16} at ${4 * w * 16}`, `${3 * w * 16} at ${1 * w * 16}`, `${w * 16} at 0`].join(), reads.join())
    const all = got.flatMap(s => s.rgb)
    let bad = 0
    for (let r = 0; r < h; r++) for (let x = 0; x < w; x++) {
        const y = h - 1 - r, i = (r * w + x) * 3
        if (all[i] !== y * 10 + x || all[i + 1] !== -y || all[i + 2] !== 1000 + x) bad++
    }
    ok('...r, g, b of each pixel, image row r the buffer\'s row h - 1 - r, the sample count left behind', bad === 0 && all.length === w * h * 3, `${bad}`)
    ok('rowsPerStrip: whole rows within the budget, at least one', rowsPerStrip(100, 16, 16 * 100 * 7.5) === 7 && rowsPerStrip(1e6, 16, 10) === 1)

    // the developed picture in float strips
    const strips = []
    await D.developedRows(viewSettings(view), async (rgba, r0, k) => strips.push({ r0, k, n: rgba.length, tag: rgba[0] }), { stripBytes: w * 16 * 3 })
    const draws = g.prog.draws.slice(-3)
    ok('developed rows: one float target of a strip\'s size, drawn once a strip', draws.length === 3 && draws.every(d => d.target === draws[0].target)
        && draws[0].target.format === 'rgba32float' && draws[0].target.width === w && draws[0].target.height === 3 && draws[0].target.destroyed)
    ok('...by the pass compiled for a float target', g.prog.opts.format === 'rgba32float' && g.compiles === 1)
    const sv = r0 => stripView(w, h, r0, 3)
    ok('...each strip its own view and legend, full size, one tap', draws.every((d, i) => d.u.view.join() === sv(i * 3).view.join()
        && d.u.legend.join() === sv(i * 3).legend.join() && d.u.box === 1 && d.u.res.join() === `${w},3`))
    ok('...read back its top rows only: the last strip 1 row', strips.map(s => `${s.r0}+${s.k}:${s.n}`).join() === `0+3:${w * 3 * 4},3+3:${w * 3 * 4},6+1:${w * 4}`,
        strips.map(s => `${s.r0}+${s.k}:${s.n}`).join())
    ok('...each strip read after its own draw', strips.map(s => s.tag).join() === '1,2,3')
    // where a strip looks: its top row on image row r0 (the buffer's row h - 1 - r0), the legend placing it in the whole
    {
        const { view: v, legend: l } = stripView(1000, 500, 100, 64)
        const topCentre = v[1] + (63.5 - 32) * v[3]
        ok('stripView: the target\'s top row on image row r0', topCentre === 500 - 1 - 100 + 0.5, `${topCentre}`)
        ok('...its legend: uv.y 0 at the strip\'s bottom in the whole picture, the strip\'s share of its height',
            near(l[1] + 0.5 / 64 * l[3], (500 - 100 - 64 + 0.5) / 500) && near(l[3], 64 / 500) && l[0] === 0 && l[2] === 1)
    }
    const b = await D.developed(viewSettings(view), { type: 'image/jpeg', quality: 0.8 })
    const last = g.log.filter(x => x.save).at(-1).save
    ok('the developed picture as JPEG: tinywebgpu\'s save asked for it, not downloaded', b === 'blob' && last.opts.download === false
        && last.opts.type === 'image/jpeg' && last.opts.quality === 0.8 && last.tex.width === w && last.tex.destroyed)
    let threw = null, calls = 0
    await D.lightRows(async () => { calls++; D.discard() }, { stripBytes: w * 16 }).catch(e => { threw = e })
    ok('a picture discarded during an export: no further strips, the export says why', calls === 1 && /changed/.test(threw?.message), threw?.message)
    ok('every uniform the develop pass declares is written, the legend too', Object.keys(developUniforms(viewSettings(view), { src: [2, 2], res: [2, 2] })).length === DEVELOP_UNIFORMS.length
        && developUniforms(viewSettings(view), { src: [2, 2], res: [2, 2] }).legend.join() === '0,0,1,1')
}

console.log(`develop: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
