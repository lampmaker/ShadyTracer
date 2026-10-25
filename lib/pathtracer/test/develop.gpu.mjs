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
const OLD = await WG.makeFrag(/*wgsl*/`
    ${passText.slice(0, passText.indexOf('fn frag'))}
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
    }`, { ...RenderUniformTypes, src: 'vec2<f32>', box: 'u32', overlayOn: 'u32' },
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
    const { view: _v, clipWarn: _c, legend: _l, ...u } = developUniforms(S, { src: [W, H], res: [tw, th] })
    OLD.uniforms = u
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

D.discard()
console.log(`develop GPU: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
