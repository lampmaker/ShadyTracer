// node lib/pathtracer/test/develop.test.mjs
//
// DEVELOP (lib/pathtracer/develop.js): a rendered picture kept as light, exposed and tone-mapped after the render.
// No GPU. What it checks: the settings a develop starts from are the ones the display used for that render (so a
// save left untouched is the picture the old Save PNG wrote); the develop pass's uniforms are every name its schema
// declares; the preview's box and size; the meter's median; and the darkroom on a recording stand-in for the device
// -- the copy, the overlay drawn while the render's camera is its own, the save at full size, the memory given back.
// Whether the preview and the PNG LOOK right only the user's GPU and eye can say.
import { viewSettings, developUniforms, DEVELOP_UNIFORMS, boxFor, fitPreview, medianLuminance, makeDarkroom, MAX_BOX }
    from '../develop.js'
import { derive, ev100ToScale, meterEV100 } from '../core/photometry.js'
import { rendertoscreen_prog, develop_prog } from '../core/rendertoscreen.js'

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
}
ok('a half-size preview averages 2 x 2', boxFor([1920, 1080], [960, 540]) === 2)
ok('an odd ratio rounds up: every picture pixel inside some tap\'s reach', boxFor([1000, 1000], [300, 300]) === 4)
ok(`a 4K picture in a small preview: at most ${MAX_BOX} a side`, boxFor([3840, 2160], [400, 225]) === MAX_BOX)
ok('an output larger than the picture: still one tap', boxFor([100, 100], [400, 400]) === 1)

{
    const [w, h] = fitPreview(3840, 2160, 800, 840)
    ok('a preview fits the width and keeps the aspect', w === 800 && h === 450, `${w} x ${h}`)
    const [w2, h2] = fitPreview(1000, 4000, 800, 840)
    ok('a tall picture fits the height', h2 === 840 && w2 === 210, `${w2} x ${h2}`)
    const [w3, h3] = fitPreview(320, 200, 800, 840)
    ok('never more pixels than the picture has', w3 === 320 && h3 === 200)
    ok('never zero', fitPreview(10000, 1, 100, 100)[1] === 1)
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
}

//----------------------------------------------------------------------------------------------------------------------
// the darkroom, on a recording device
//----------------------------------------------------------------------------------------------------------------------
const fakeGpu = ({ oom = false, data = null } = {}) => {
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
            return { b, r: async (bytes, off, C) => (log.push(`read ${bytes}`), data ?? new C(bytes / 4)) }
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
        save: async (tex, name) => (log.push({ save: { tex, name } }), 'blob'),
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
    ok('...read from the kept copy, all of it', g.log.includes(`read ${3 * 16}`))
}

console.log(`develop: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
