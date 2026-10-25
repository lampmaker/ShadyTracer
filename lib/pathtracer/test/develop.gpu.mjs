// node lib/pathtracer/test/develop.gpu.mjs
//
// THE DEVELOP PASS AND ITS HISTOGRAM ON DAWN (core/rendertoscreen.js develop_prog, develop_histogram_prog; 0.next).
// The darkroom's viewer moved the pass from `uv * src` to a view (the picture point at the output's centre and the
// span of an output pixel). What this runs, through the real tinywebgpu and the darkroom (develop.js):
// - a save's draw (no view: viewFill) BYTE FOR BYTE the pass as it was before the view, at full size and at a
//   thumbnail's size -- the old pass's text is kept here, the reference;
// - zoomed in, every output pixel the full-size picture's pixel under its centre (the nearest: a square, not a blur);
//   off the picture, the backdrop;
// - the clipping stripes where the output reaches white, and nothing else changed;
// - the histogram: every pixel counted once at R, G and B's own 8-bit values -- the developed picture's, read back --
//   and over a picture big enough to be strided, every step-th pixel each way; one pixel's light read back.
// Whether it LOOKS right is the user's screen's to say.
//
// OPTIONAL, AND LOUD ABOUT IT: the `webgpu` package (npm i -g webgpu) and a Vulkan driver (lavapipe in a container:
// apt-get install mesa-vulkan-drivers), as the other .gpu tests.
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(develop GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const { WEBGPU } = await import('../../tinywebgpu/src/tinywebgpu.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../wgsl_shorthand.js')
const { makeDarkroom, viewSettings, histogramStep, developUniforms } = await import('../develop.js')
const R2S = await import('../core/rendertoscreen.js')
const { RenderUniformTypes } = await import('../core/uniforms.schema.js')

Object.assign(globalThis, webgpu.globals)
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
    WG.defines = defines(TOKENS, SHORT_TOKENS)
} catch (e) {
    console.log(`(develop GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }

/* A PICTURE OF EVERYTHING: dark, mid, blown, a sun-bright pixel, a channel out of gamut (negative), black, a never
   sampled pixel -- r, g, b as f32 and the count, as the accumulation holds them. Seeded, so a failure repeats. */
let seed = 12345
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
function picture(w, h) {
    const f = new Float32Array(w * h * 4), u = new Uint32Array(f.buffer)
    for (let i = 0; i < w * h; i++) {
        const k = rnd()
        const L = k < 0.05 ? 0 : k < 0.1 ? 1.6e9 : 10 ** (rnd() * 7 - 2)          // cd/m^2, 0.01 to 1e5
        f.set([L * rnd(), L * rnd(), L * (rnd() - (k > 0.95 ? 0.5 : 0))], i * 4)
        u[i * 4 + 3] = k < 0.02 ? 0 : 16
    }
    return f
}
// what the view showed: a manual exposure that blows part of it out, the AgX curve, a little grading
const S = { ...viewSettings({ exposureEV: 9, autoExposure: 0, toneMap: 2, contrast: 0.1, saturation: 0.15, brightness: 0.02 }) }

/* THE PASS AS IT WAS BEFORE THE VIEW (0.77.0's develop_prog, its frag only): the reference a save must match */
// the per-pixel function as the pass carries it now (displayPixel, unchanged by the view), then the old frag
let passText
await R2S.develop_prog({ makeFrag: f => (passText = f, {}) })
const OLD_TYPES = { ...RenderUniformTypes, src: 'vec2<f32>', box: 'u32', overlayOn: 'u32' }
const OLD = await WG.makeFrag(/*wgsl*/`
    ${passText.slice(0, passText.indexOf('fn cbrtSigned'))}
    fn frag(uv: V) -> X {
        let src = UB.src;
        let n = max(UB.box, 1u);
        let foot = src / UB.res;
        let lo = uv * src - 0.5 * foot;
        let w = u32(src.x);
        let h = u32(src.y);
        var sum = VEC3(0.0);
        for (var j = 0u; j < n; j++) {
            for (var i = 0u; i < n; i++) {
                let q = lo + (vec2<f32>(f32(i), f32(j)) + vec2<f32>(0.5)) / f32(n) * foot;
                let p = vec2<u32>(clamp(q, vec2<f32>(0.0), src - vec2<f32>(1.0)));
                var c = displayPixel(hdr[p.x + p.y * w].rgb, uv, UB.exposureScale);
                if (UB.overlayOn != 0u) {
                    let o = textureLoad(overlay, vec2<i32>(i32(p.x), i32(h - 1u - p.y)), 0).rgb;
                    c = clamp(c + o, VEC3(0.0), VEC3(1.0));
                }
                sum = sum + c;
            }
        }
        return VEC4(sum / f32(n * n), 1.0);
    }`, OLD_TYPES,
    { hdr: 'array<vec4<f32>>', overlay: 'texture_2d<f32>' }, { readOnly: ['hdr'] })

const fmt = WG.format
// a texture's pixels as RGBA bytes, row 0 the TOP (a render target's), whatever the canvas format's channel order
async function pixelsOf(tex) {
    const px = await WG.readTexture(tex, { Ctor: Uint8Array })
    if (/^bgra/.test(tex.format)) for (let i = 0; i < px.length; i += 4) { const t = px[i]; px[i] = px[i + 2]; px[i + 2] = t }
    return px
}
const ctxFor = tex => ({ getCurrentTexture: () => tex })
const blank = WG.createTexture(1, 1, 'rgba8unorm')

const W = 61, H = 37
const data = picture(W, H)
const from = WG.createStorageBuffer(data)
const D = makeDarkroom(WG)
await D.keep({ from, w: W, h: H, view: S, samples: 16 })

//----------------------------------------------------------------------------------------------------------------------
// a save's draw is the pass as it was, byte for byte
//----------------------------------------------------------------------------------------------------------------------
for (const [tw, th, what] of [[W, H, 'at full size'], [17, 10, 'at a thumbnail\'s size (box filtered, each axis its own span)'], [7, 5, 'small']]) {
    const now = WG.createTexture(tw, th, fmt), was = WG.createTexture(tw, th, fmt)
    await D.preview(ctxFor(now), S)
    OLD.setResources({ hdr: from.b, overlay: blank })               // the same light the darkroom copied
    // only what the old pass declared: the view, the stripes, the legend and the light tools came after it
    const all = developUniforms(S, { src: [W, H], res: [tw, th] })
    OLD.uniforms = Object.fromEntries(Object.keys(OLD_TYPES).map(k => [k, all[k]]))
    OLD.drawTo(was)
    const a = await pixelsOf(now), b = await pixelsOf(was)
    let diff = 0
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++
    ok(`no view (a save, a thumbnail) ${what}: byte for byte the pass before the view`, diff === 0, `${diff} bytes differ`)
}

//----------------------------------------------------------------------------------------------------------------------
// zoomed in: the nearest pixel; off the picture: the backdrop
//----------------------------------------------------------------------------------------------------------------------
const full = WG.createTexture(W, H, fmt)
await D.preview(ctxFor(full), S)
const fullPx = await pixelsOf(full)
const at = (px, w, h, x, yUp) => { const i = ((h - 1 - yUp) * w + x) * 4; return [px[i], px[i + 1], px[i + 2]] }
{
    const ow = 40, oh = 24, z = 4, cx = 20.5, cy = 12.25
    const tex = WG.createTexture(ow, oh, fmt)
    await D.preview(ctxFor(tex), S, { view: [cx, cy, 1 / z, 1 / z] })
    const px = await pixelsOf(tex)
    let bad = 0
    for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
        const qx = Math.floor(cx + (x + 0.5 - ow / 2) / z), qy = Math.floor(cy + (y + 0.5 - oh / 2) / z)
        if (at(px, ow, oh, x, y).join() !== at(fullPx, W, H, qx, qy).join()) bad++
    }
    ok('at 400 %: every output pixel the full-size picture\'s pixel under its centre (the nearest)', bad === 0, `${bad} of ${ow * oh} differ`)
}
{
    const ow = 20, oh = 20
    const tex = WG.createTexture(ow, oh, fmt)
    await D.preview(ctxFor(tex), S, { view: [0, 0, 1, 1] })            // the picture's corner at the output's centre
    const px = await pixelsOf(tex)
    const back = Math.round(0.09 * 255)
    ok('off the picture: the backdrop', at(px, ow, oh, 2, 2).every(v => Math.abs(v - back) <= 1) && at(px, ow, oh, 18, 2).every(v => Math.abs(v - back) <= 1),
        `${at(px, ow, oh, 2, 2)}`)
    ok('...on it: the picture', at(px, ow, oh, 15, 15).join() === at(fullPx, W, H, 5, 5).join())
}

//----------------------------------------------------------------------------------------------------------------------
// the clipping stripes
//----------------------------------------------------------------------------------------------------------------------
{
    const tex = WG.createTexture(W, H, fmt)
    await D.preview(ctxFor(tex), S, { clipWarn: true })
    const px = await pixelsOf(tex)
    let striped = 0, wrong = 0, kept = 0
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const c = at(fullPx, W, H, x, y), s = at(px, W, H, x, y)
        const stripe = ((x + 0.5 + y + 0.5) / 8 + 0.0625) % 1 < 0.5    // the shader's: output pixel centres, y up
        const white = Math.max(...c) >= 255, black = Math.max(...c) === 0
        if (stripe && white) { if (s.join() === '255,0,0') striped++; else wrong++ }
        else if (stripe && black) { if (s.join() === '0,64,255') striped++; else wrong++ }
        else if (s.join() === c.join()) kept++; else wrong++
    }
    ok('clipping: what reaches white striped red, what is black striped blue, everything else as it was', wrong === 0 && striped > 0,
        `${wrong} wrong, ${striped} striped, ${kept} kept`)
}

//----------------------------------------------------------------------------------------------------------------------
// the histogram: what a save writes, counted
//----------------------------------------------------------------------------------------------------------------------
{
    const bins = await D.histogram(S)
    const want = new Uint32Array(3 * 256)
    for (let i = 0; i < W * H; i++) for (let c = 0; c < 3; c++) want[c * 256 + fullPx[i * 4 + c]]++
    let diff = 0
    for (let i = 0; i < 3 * 256; i++) diff += Math.abs(bins[i] - want[i])
    ok('the histogram: R, G and B counted at the saved picture\'s own 8-bit values', diff === 0, `${diff} counts off`)
    let luma = 0
    for (let i = 0; i < 256; i++) luma += bins[3 * 256 + i]
    ok('...and every pixel once in luma', luma === W * H, `${luma}`)
}
{
    // big enough to be strided: every step-th pixel each way
    const BW = 2100, BH = 600
    const big = picture(BW, BH)
    const D2 = makeDarkroom(WG)
    await D2.keep({ from: WG.createStorageBuffer(big), w: BW, h: BH, view: S })
    const step = histogramStep(BW, BH)
    const bins = await D2.histogram(S)
    let n = 0
    for (let i = 0; i < 256; i++) n += bins[i]
    ok(`a ${BW} x ${BH} picture: every ${step}nd pixel each way counted, once`, step === 2 && n === Math.ceil(BW / step) * Math.ceil(BH / step), `${n}`)
    const tex = WG.createTexture(BW, BH, fmt)
    await D2.preview(ctxFor(tex), S)
    const px = await pixelsOf(tex)
    const want = new Uint32Array(256)
    for (let y = 0; y < BH; y += step) for (let x = 0; x < BW; x += step) want[at(px, BW, BH, x, y)[0]]++
    let diff = 0
    for (let i = 0; i < 256; i++) diff += Math.abs(bins[i] - want[i])
    ok('...the very pixels the stride names', diff === 0, `${diff} counts off`)
    D2.discard()
}

//----------------------------------------------------------------------------------------------------------------------
// one pixel's light
//----------------------------------------------------------------------------------------------------------------------
{
    const v = await D.pixel(13, 29), i = (29 * W + 13) * 4
    ok('one pixel read back: its light as kept', v.rgb[0] === data[i] && v.rgb[1] === data[i + 1] && v.rgb[2] === data[i + 2], `${v.rgb} vs ${data.slice(i, i + 3)}`)
}

//----------------------------------------------------------------------------------------------------------------------
// the exports' readers (0.next): the developed picture in float strips, the light in strips
//----------------------------------------------------------------------------------------------------------------------
for (const [what, settings] of [['photographic', S], ['luminance in false colour, its legend along the bottom', { ...S, show: 2, measureMin: 0.1, measureMax: 1e5, measureBands: 0 }]]) {
    const ref = WG.createTexture(W, H, fmt)
    await D.preview(ctxFor(ref), settings)
    const px8 = await pixelsOf(ref)
    const rows = []
    // strips of 4 rows: 37 rows in 10 strips, the last a part one, so every edge between strips is crossed
    await D.developedRows(settings, async (rgba, r0, k) => rows.push({ rgba, r0, k }), { stripBytes: W * 16 * 4 })
    let off = 0, n = 0, worst = 0
    for (const { rgba, r0, k } of rows) for (let i = 0; i < k * W; i++) for (let c = 0; c < 3; c++) {
        const v16 = Math.round(Math.min(1, Math.max(0, rgba[i * 4 + c])) * 65535), v8 = px8[((r0 * W) + i) * 4 + c]
        const d = Math.abs(Math.round(v16 / 257) - v8)
        worst = Math.max(worst, d); if (d > 1) off++; n++
    }
    ok(`16-bit strips, ${what}: every value the 8-bit save's within 1 step, every row once`, off === 0 && n === W * H * 3
        && rows.map(r => r.r0).join() === [...Array(Math.ceil(H / 4)).keys()].map(i => i * 4).join(), `${off} off (worst ${worst}) of ${n}`)
}
{
    const rows = []
    await D.lightRows(async (rgb, r0, k) => rows.push({ rgb, r0, k }), { stripBytes: W * 16 * 5 })
    let bad = 0
    for (const { rgb, r0, k } of rows) for (let r = 0; r < k; r++) for (let x = 0; x < W; x++) {
        const y = H - 1 - (r0 + r), j = (y * W + x) * 4, i = (r * W + x) * 3
        if (rgb[i] !== data[j] || rgb[i + 1] !== data[j + 1] || rgb[i + 2] !== data[j + 2]) bad++
    }
    ok('the light in strips off the GPU: the kept copy exactly, image row r the buffer\'s h - 1 - r', bad === 0
        && rows.reduce((s, r) => s + r.k, 0) === H, `${bad}`)
}

//----------------------------------------------------------------------------------------------------------------------
// the light tools (0.next): developPixel at identity is displayPixel bit for bit; each stage the JS mirror's
//----------------------------------------------------------------------------------------------------------------------
const G = await import('../darkroom/grade.js')
const CV = await import('../darkroom/curves.js')
const straightLut = WG.createStorageBuffer(CV.bakeLut(CV.CURVE_DEFAULTS()))
{
    // the develop pass by hand, lightOn forced to 1 (developPixel) with every stage at its identity
    const forced = await R2S.develop_prog(WG)
    const a = WG.createTexture(W, H, fmt), b = WG.createTexture(W, H, fmt)
    for (const tm of [0, 1, 2, 4, 6]) {
        const s = { ...S, toneMap: tm }
        await D.preview(ctxFor(a), s)
        forced.setResources({ hdr: from.b, overlay: blank, curveLut: straightLut.b })
        forced.uniforms = { ...developUniforms(s, { src: [W, H], res: [W, H] }), lightOn: 1 }
        forced.drawTo(b)
        const pa = await pixelsOf(a), pb = await pixelsOf(b)
        let diff = 0
        for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) diff++
        ok(`developPixel at identity (curve ${tm}) is displayPixel, byte for byte: the copy has not drifted`, diff === 0, `${diff} bytes differ`)
    }
    const six = WG.createTexture(W, H, fmt), seven = WG.createTexture(W, H, fmt)
    await D.preview(ctxFor(six), { ...S, toneMap: 6 })
    await D.preview(ctxFor(seven), { ...S, toneMap: 7 })
    const p6 = await pixelsOf(six), p7 = await pixelsOf(seven)
    let off = 0
    for (let i = 0; i < p6.length; i++) if (Math.abs(p6[i] - p7[i]) > 1) off++
    ok('curve 7 at its defaults is curve 6, within a step', off === 0, `${off} values off`)
}
{
    // the stages themselves, on chosen colours, through a kernel that calls darkroomLight and the adjustable curve
    let header
    await R2S.develop_histogram_prog({ makeCompute: (b) => (header = b, {}) })
    const colours = [[0.18, 0.18, 0.18], [0.9, 0.2, 0.05], [0.02, 0.05, 0.3], [3.5, 2.0, 1.0], [0.4, -0.05, 0.6], [1e-5, 2e-5, 1e-5], [0.6, 0.55, 0.5]]
    const input = new Float32Array(colours.length * 4)
    colours.forEach((c, i) => input.set([...c, 0], i * 4))
    const inBuf = WG.createStorageBuffer(input), outBuf = WG.createStorageBuffer(input.length * 4 * 2)
    const K = await WG.makeCompute(header, /*wgsl*/`
        let i = gid.x;
        if (i >= arrayLength(&inp)) { return; }
        // every binding the text names reached from main, as tinywebgpu binds them (check-shaders pass two says why)
        if (i == 0xffffffffu) { _ = curveLut[0]; }
        let c = inp[i].xyz;
        outp[i * 2u] = vec4<f32>(darkroomLight(c), 0.0);
        outp[i * 2u + 1u] = vec4<f32>(toneHableAdjustable(max(c, vec3<f32>(0.0))), 0.0);`,
        R2S.DevelopHistogramUniformTypes, { inp: 'read array<vec4<f32>>', outp: 'array<vec4<f32>>', curveLut: 'read array<f32>' }, { wg: [64, 1, 1] })
    const cases = [
        ['white balance at 3000 K, tint 4, gains', { wbTemp: 3000, wbTint: 4, gainR: 1.1, gainB: 0.9 }],
        ['the equaliser', { eq0: 2, eq2: 1, eq5: -1, eq7: -0.5 }],
        ['saturation, vibrance, hue', { labSat: 0.4, labVib: 0.6, labHue: 25 }],
        ['all of them, and curve 7 moved', { wbTemp: 4200, eq3: 0.7, labSat: -0.3, labHue: -40, toneMap: 7, tcWhite: 3.5, tcToe: 0.3, tcShoulder: 0.35 }],
    ]
    for (const [what, set] of cases) {
        const s = { ...S, ...G.LIGHT_DEFAULTS, ...set }
        K.setResources({ inp: inBuf.b, outp: outBuf.b, curveLut: straightLut.b })
        K.uniforms = { ...developUniforms(s, { src: [1, 1], res: [1, 1] }), step: 1 }
        K.run(colours.length, 1, 1)
        const out = await outBuf.r(input.length * 4 * 2, 0, Float32Array)
        /* f32 against f64, relative 2e-5 of the COLOUR (its largest channel), not of each channel: Oklab's way back makes a
           small channel out of large terms (the blue of 3.5, 2, 1 comes out 0.0104 off by 6e-7, measured here: 2e-7 of
           the colour), and Hable's toe at x = 1e-5 subtracts two near-equal numbers (1e-8 off, 1 % of itself) -- so an
           absolute floor too. All far below a 16-bit step (1.5e-5 of white). */
        let worst = 0, worst7 = 0
        const miss = (gpu, js, size, floor) => Math.abs(gpu - js) / (2e-5 * size + floor)
        colours.forEach((c, i) => {
            const js = G.lightStages(c, s), size = Math.max(...js.map(Math.abs))
            for (let k = 0; k < 3; k++) worst = Math.max(worst, miss(out[i * 8 + k], js[k], size, 1e-8))
            const t7 = c.map(x => G.tone7(Math.max(x, 0), 2 ** s.tcWhite, s.tcToe, s.tcShoulder)), size7 = Math.max(...t7.map(Math.abs))
            for (let k = 0; k < 3; k++) worst7 = Math.max(worst7, miss(out[i * 8 + 4 + k], t7[k], size7, 1e-6))
        })
        ok(`${what}: the WGSL the JS mirror's, to f32's precision`, worst <= 1, `worst ${worst} of the tolerance`)
        ok(`${what}: curve 7's WGSL its JS`, worst7 <= 1, `worst ${worst7} of the tolerance`)
    }
}
{
    // a develop with the light tools on: the histogram counts what a save draws
    const s = { ...S, ...G.LIGHT_DEFAULTS, wbTemp: 3500, eq1: 1, labVib: 0.4 }
    const tex = WG.createTexture(W, H, fmt)
    await D.preview(ctxFor(tex), s)
    const px = await pixelsOf(tex)
    const bins = await D.histogram(s)
    const want = new Uint32Array(3 * 256)
    for (let i = 0; i < W * H; i++) for (let c = 0; c < 3; c++) want[c * 256 + px[i * 4 + c]]++
    let diff = 0
    for (let i = 0; i < 3 * 256; i++) diff += Math.abs(bins[i] - want[i])
    ok('with the light tools on, the histogram counts the picture a save draws', diff === 0, `${diff} counts off`)
}

//----------------------------------------------------------------------------------------------------------------------
// the finished picture's tools (phase 4): each stage the JS twin's, grain and dither on the same hash, dither never in
// a float strip, the histogram with everything on
//----------------------------------------------------------------------------------------------------------------------
{
    let header
    await R2S.develop_histogram_prog({ makeCompute: (b) => (header = b, {}) })
    const ins = [[0, 0, 0], [0.002, 0.01, 0.05], [0.18, 0.18, 0.18], [0.5, 0.3, 0.1], [0.9, 0.95, 1], [1, 1, 1]]
    const pixels = [[0, 0], [5, 3], [30, 20], [60, 36], [17, 9], [44, 2]]
    const input = new Float32Array(ins.length * 8)
    ins.forEach((c, i) => input.set([...c, 0, pixels[i][0], pixels[i][1], 0, 0], i * 8))
    const inBuf = WG.createStorageBuffer(input), outBuf = WG.createStorageBuffer(ins.length * 8 * 4)
    const K = await WG.makeCompute(header, /*wgsl*/`
        let i = gid.x;
        if (i * 2u >= arrayLength(&inp)) { return; }
        let c = inp[i * 2u].xyz;
        let pix = vec2<u32>(u32(inp[i * 2u + 1u].x), u32(inp[i * 2u + 1u].y));
        outp[i * 2u] = vec4<f32>(darkroomFinish(encodeOut(c)), 0.0);
        outp[i * 2u + 1u] = vec4<f32>(grainNoiseAt(pix, UB.grain.y), ditherAt(pix), vignetteStopsAt(pix), f32(pcg(pix.x + pix.y * 7u)));`,
        R2S.DevelopHistogramUniformTypes, { inp: 'read array<vec4<f32>>', outp: 'array<vec4<f32>>', curveLut: 'read array<f32>' }, { wg: [64, 1, 1] })
    const curves = { ...CV.CURVE_DEFAULTS(), m: [[0, 0], [0.25, 0.18], [0.75, 0.85], [1, 1]], b: [[0, 0.05], [1, 0.95]] }
    const lutBuf = WG.createStorageBuffer(CV.bakeLut(curves))
    const cases = [
        ['gamma 2.2 and Levels', { transfer: 1, lvInBlack: 0.05, lvInWhite: 0.9, lvGamma: 1.4, lvOutBlack: 0.02, lvOutWhite: 0.98 }],
        ['linear out, the curves', { transfer: 3, curves }],
        ['the curves on luma', { curves, curveLuma: true }],
        ['the wheels', { liftX: 0.3, liftM: 0.2, gammaY: -0.4, gammaM: 0.3, gainX: -0.2, gainM: 0.4 }],
        ['all of them, grain and a vignette', { transfer: 2, lvGamma: 0.8, curves, liftY: 0.2, gainM: -0.2, grainAmount: 0.6, grainSize: 2.5, vigAmount: -1.2, vigMid: 0.2, vigRound: 0.6 }],
    ]
    for (const [what, set] of cases) {
        const s = { ...S, ...G.LIGHT_DEFAULTS, curves: CV.CURVE_DEFAULTS(), ...set }
        const lut = CV.bakeLut(s.curves)
        K.setResources({ inp: inBuf.b, outp: outBuf.b, curveLut: (set.curves ? lutBuf : straightLut).b })
        K.uniforms = { ...developUniforms(s, { src: [W, H], res: [W, H] }), step: 1 }
        K.run(ins.length, 1, 1)
        const out = await outBuf.r(ins.length * 8 * 4, 0, Float32Array)
        let worst = 0, grain = 0, dith = 0, vig = 0, hash = 0
        ins.forEach((c, i) => {
            const js = G.finishEarly(c, s, lut, CV.lutSample)
            for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(out[i * 8 + k] - js[k]))
            const [px, py] = pixels[i]
            grain = Math.max(grain, Math.abs(out[i * 8 + 4] - G.grainNoise(px, py, Math.max(1, s.grainSize))))
            dith = Math.max(dith, Math.abs(out[i * 8 + 5] - G.ditherAt(px, py)))
            vig = Math.max(vig, Math.abs(out[i * 8 + 6] - G.vignetteStops(px, py, W, H, s.vigAmount, s.vigMid, s.vigRound)))
            // the hash itself through an f32 is exact only below 2^24: compare its float form
            hash = Math.max(hash, Math.abs(out[i * 8 + 7] - Math.fround(G.pcg((px + py * 7) >>> 0))) / Math.fround(G.pcg((px + py * 7) >>> 0) || 1))
        })
        // encoded values: 1e-5 is a 16-bit step's two thirds; f32 against f64 through pow and the table
        ok(`${what}: the WGSL the JS twin's within 1e-5 of white`, worst < 1e-5, `worst ${worst}`)
        if (what.startsWith('all')) {
            ok('grain noise: the WGSL the JS\'s, from the same hash', grain < 1e-6, `${grain}`)
            ok('dither: the WGSL the JS\'s, from the same hash', dith < 1e-9, `${dith}`)
            ok('vignette stops: the WGSL the JS\'s', vig < 1e-5, `${vig}`)
            ok('pcg: the WGSL hash the JS\'s', hash < 1e-7, `${hash}`)
        }
    }
}
{
    // dither changes an 8-bit picture and never a float strip; with everything on the histogram is a save's bytes
    const plain = { ...S, ...G.LIGHT_DEFAULTS, curves: CV.CURVE_DEFAULTS() }
    const a = WG.createTexture(W, H, fmt), b = WG.createTexture(W, H, fmt)
    await D.preview(ctxFor(a), plain)
    await D.preview(ctxFor(b), { ...plain, dither: true })
    const pa = await pixelsOf(a), pb = await pixelsOf(b)
    let changed = 0, far = 0
    for (let i = 0; i < pa.length; i++) { if (pa[i] !== pb[i]) changed++; if (Math.abs(pa[i] - pb[i]) > 1) far++ }
    ok('dither on an 8-bit picture: some values moved, none by more than a step', changed > 0 && far === 0, `${changed} moved, ${far} far`)
    const fa = [], fb = []
    await D.developedRows(plain, async r => fa.push(...r))
    await D.developedRows({ ...plain, dither: true }, async r => fb.push(...r))
    ok('...and a float strip not at all', fa.length === fb.length && fa.every((x, i) => x === fb[i]))
    const all = { ...plain, transfer: 1, lvGamma: 1.2, curves: { ...CV.CURVE_DEFAULTS(), g: [[0, 0], [0.5, 0.6], [1, 1]] }, gainX: 0.3,
                  vigAmount: -1, grainAmount: 0.5, dither: true, wbTemp: 4000 }
    const tex = WG.createTexture(W, H, fmt)
    await D.preview(ctxFor(tex), all)
    const px = await pixelsOf(tex)
    const bins = await D.histogram(all)
    const want = new Uint32Array(3 * 256)
    for (let i = 0; i < W * H; i++) for (let c = 0; c < 3; c++) want[c * 256 + px[i * 4 + c]]++
    let diff = 0
    for (let i = 0; i < 3 * 256; i++) diff += Math.abs(bins[i] - want[i])
    ok('with every tool on (the curves through the darkroom\'s table), the histogram counts what a save draws', diff === 0, `${diff} counts off`)
}

D.discard()
console.log(`develop GPU: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
