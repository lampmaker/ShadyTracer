//======================================================================================================================
// DEVELOP -- a rendered picture kept as light, and its exposure, tone curve and grading chosen after the render.
//
// WHY. A save used to put the display pass's 8-bit picture straight into the PNG: the exposure, the tone curve and
// the grading had to be right BEFORE a render that can take minutes, and a picture a stop too dark was rendered
// again. The render's result is linear light in cd/m^2 (the accumulation, Rec.709: core/photometry.js), so nothing
// about it depends on those settings -- only what the display makes of it does. So the save keeps a copy of the
// accumulation on the GPU (keep), shows it through the develop pass (core/rendertoscreen.js develop_prog) with
// settings of its own, and writes a PNG at full size whenever asked -- as many as one likes, from one render.
//
// WHAT THE VIEW SHOWED IS WHERE IT STARTS (viewSettings): the exposure the display used for that render -- the
// metered one, read from the GPU, when auto-exposure was on -- its tone curve and grading, or its false-colour scale.
// The develop pass runs the display's own per-pixel function, so a save left untouched is the picture the old Save
// PNG wrote, overlay included.
//
// SHOWN LARGE (0.79.0): the darkroom's viewer (darkroom/viewer.js) pans and zooms over the kept picture by the develop
// pass's `view` -- the picture point at the output's centre and the picture pixels an output pixel spans -- and asks
// for the developed picture's histogram (histogram) and one pixel's light under the cursor (pixel). A save and a
// thumbnail never pass a view: they take viewFill, the whole picture over the whole output, the mapping they always had.
//
// The arithmetic here is plain functions, tested without a GPU (lib/pathtracer/test/develop.test.mjs); the darkroom
// is the few GPU calls around them, and that test runs it on a recording stand-in for the device.
//======================================================================================================================

import { develop_prog, develop_histogram_prog, DevelopUniformTypes, HIST_BINS } from './core/rendertoscreen.js'
import { ev100ToScale, meterEV100, LUMA } from './core/photometry.js'
import { stampedName } from '../filename.js'
import { LIGHT_DEFAULTS, LIGHT_DITHER, lightUniforms } from './darkroom/grade.js'
import { CURVE_DEFAULTS, bakeLut } from './darkroom/curves.js'

/* THE PREVIEW'S BOX FILTER, at most this many taps a side (64 a pixel). A 4K picture in a 400-pixel preview is 10
   picture pixels an output pixel; 8 taps across them average away a firefly's speckle, and the rest is a preview. */
export const MAX_BOX = 8

/** The develop settings the view had: what the display used for the picture just rendered.
 *  `u` the uniform bag as traced (index.js buildUniforms), `ae` aeState as read from the GPU ([EV, valid]) or null.
 *  The exposure is the one the display multiplied by (rendertoscreen.js frag): the metered EV less the compensation
 *  when auto-exposure was on and had metered something, the manual EV otherwise. */
export function viewSettings(u = {}, ae = null) {
    const metered = (u.autoExposure | 0) === 1 && ae && ae[1] !== 0 && Number.isFinite(ae[0])
    return {
        show: u.measureMode | 0,
        ev: metered ? ae[0] - (+u.exposureComp || 0) : (Number.isFinite(+u.exposureEV) ? +u.exposureEV : 15),
        toneMap: u.toneMap | 0,
        contrast: +u.contrast || 0,
        saturation: +u.saturation || 0,
        brightness: +u.brightness || 0,
        measureMin: +u.measureMin || 1,
        measureMax: +u.measureMax || 100000,
        measureBands: u.measureBands | 0,
        // the light tools at their identity (darkroom/grade.js): the view had none -- the curves a fresh copy each time,
        // so a curve edited in one picture's settings is never the defaults' own arrays
        ...LIGHT_DEFAULTS, curves: CURVE_DEFAULTS(),
    }
}

/** Taps a side for an output pixel spanning `span` picture pixels ([x, y]): 1 at full size or zoomed in. */
export const boxForSpan = span => Math.min(MAX_BOX, Math.max(1, Math.ceil(Math.max(span[0], span[1]) - 1e-9)))
/** Taps a side for an output of `res` pixels showing a picture of `src`: 1 at full size or larger. */
export const boxFor = (src, res) => boxForSpan([src[0] / res[0], src[1] / res[1]])
/** The develop pass's `view` that fills an output of `res` with the whole picture of `src`: its centre at the output's
 *  centre, each axis stretched on its own -- the pass's mapping before it had a view (uv * src), which a save (res =
 *  src) and a thumbnail (very nearly the picture's shape) still use. */
export const viewFill = (src, res) => [src[0] / 2, src[1] / 2, src[0] / res[0], src[1] / res[1]]

/** The develop pass's uniforms: every name DevelopUniformTypes declares, nothing else (tinywebgpu refuses a name its
 *  schema lacks). The exposure goes in as the multiplier the display computes from an EV (photometry.ev100ToScale),
 *  and auto-exposure off: the EV is decided here, once. `view` as the pass reads it ([cx, cy, spanX, spanY],
 *  darkroom/view.js toUniform), the whole picture when not given; `clipWarn` the viewer's stripes, never a save's. */
export function developUniforms(s, { src, res, overlay = false, view = viewFill(src, res), clipWarn = false, legend = [0, 0, 1, 1], float = false }) {
    const light = lightUniforms(s)
    /* DITHER ONLY WHERE 8 BITS ARE WRITTEN: a float target (the 16-bit PNG's strips) keeps what the pass computed, and a
       dither there would be noise added for nothing. lightOn keeps its "any" bit, so the rest runs as it would. */
    if (float) light.lightOn &= ~LIGHT_DITHER
    return {
        // no `time`: the display's uniforms lost it in 0.22.3 (no shader read it), and tinywebgpu refuses an undeclared name
        res: [res[0], res[1]],
        exposureScale: ev100ToScale(s.ev), autoExposure: 0, exposureComp: 0,
        toneMap: s.toneMap | 0, contrast: +s.contrast || 0, saturation: +s.saturation || 0, brightness: +s.brightness || 0,
        measureMode: s.show | 0, measureMin: +s.measureMin, measureMax: +s.measureMax, measureBands: s.measureBands | 0,
        src: [src[0], src[1]], box: boxForSpan([view[2], view[3]]), overlayOn: overlay ? 1 : 0,
        view: [view[0], view[1], view[2], view[3]], clipWarn: clipWarn ? 1 : 0,
        legend: [legend[0], legend[1], legend[2], legend[3]],
        ...light,
    }
}
// every name of DevelopUniformTypes is written above: one added to the schema and not here would sit at 0 (the test checks)
export const DEVELOP_UNIFORMS = Object.keys(DevelopUniformTypes)

/** Every `step`-th pixel each way, so the histogram visits about `cap` pixels however large the picture: its
 *  shape is what it is about, and a million pixels draw it as well as fifty. */
export const histogramStep = (w, h, cap = 1 << 20) => Math.max(1, Math.ceil(Math.sqrt(w * h / cap)))

/* THE STRIPS AN EXPORT READS (0.79.0): about this many bytes at a time, whole rows. An 8K picture's light is 530 MB
   (16 bytes a pixel), more than a page should hold twice over, and a readback's staging buffer is as big as what it
   reads; strips of one size reuse one staging buffer (tinywebgpu's pool is keyed by size). */
export const STRIP_BYTES = 16 << 20
export const rowsPerStrip = (w, bytesPerPixel, budget = STRIP_BYTES) => Math.max(1, Math.floor(budget / (w * bytesPerPixel)))

/** The develop pass's `view` and `legend` for the strip of image rows r0 .. r0 + t - 1 (counted from the TOP) drawn into a
 *  w x t target at full size: the target's top row on image row r0, the legend placing the strip in the whole picture. */
export function stripView(w, h, r0, t) {
    const cy = h - r0 - t / 2
    return { view: [w / 2, cy, 1, 1], legend: [0, (h - r0 - t) / h, 1, t / h] }
}

/** What a histogram says at its two ends: the share of pixels (luma) at white and at black, 0..1. */
export function clipShares(bins) {
    const L = bins.subarray ? bins.subarray(3 * HIST_BINS, 4 * HIST_BINS) : bins.slice(3 * HIST_BINS, 4 * HIST_BINS)
    let n = 0
    for (const v of L) n += v
    return n ? { white: L[HIST_BINS - 1] / n, black: L[0] / n, pixels: n } : { white: 0, black: 0, pixels: 0 }
}

/** The median luminance (cd/m^2) of a picture's sampled pixels, from the accumulation's words (4 a pixel: r, g, b as
 *  f32 bits, then the sample count). Pixels never sampled are left out, as imageStats leaves them out. At most
 *  `cap` pixels are sorted, evenly strided: the median of a few million is the median of one in every few. */
export function medianLuminance(words, cap = 1 << 20) {
    const f = new Float32Array(words.buffer, words.byteOffset, words.length)
    const np = words.length >> 2
    const step = Math.max(1, Math.floor(np / cap))
    const lum = []
    for (let i = 0; i < np; i += step) {
        if (words[i * 4 + 3] === 0) continue
        const y = LUMA[0] * f[i * 4] + LUMA[1] * f[i * 4 + 1] + LUMA[2] * f[i * 4 + 2]
        if (Number.isFinite(y)) lum.push(y)
    }
    if (!lum.length) return 0
    const sorted = Float64Array.from(lum).sort()
    return sorted[sorted.length >> 1]
}

/**
 * The darkroom: one kept picture at a time, on `gpu` (a tinywebgpu instance).
 *   keep({ from, w, h, overlays, view, samples })   copy the accumulation (`from`, a buffer handle) of a w x h render,
 *                                                   and draw `overlays` (R.overlays) into a texture of their own --
 *                                                   both while the render's camera and buffers are still its own
 *   preview(ctx, settings, { view, clipWarn })      into a WebGPU canvas context configured on this device, the
 *                                                   part of the picture `view` says (all of it when not given)
 *   histogram(settings)                             the developed picture counted: Uint32Array of 4 x 256 bins,
 *                                                   R, G, B and luma of what a save at these settings would write
 *   pixel(x, y)                                     one pixel's light, { rgb, Y } in cd/m^2 (x, y the buffer's:
 *                                                   row 0 the bottom), or null outside
 *   area(x, y, r)                                   the mean light of the (2r+1)^2 patch around it, its sampled
 *                                                   pixels only: { rgb, Y, n } -- the spot meter's and the eyedropper's
 *   save(settings, filename)                        a PNG at the picture's size; returns the Blob. Without a filename,
 *                                                   render-<the time>.png (lib/filename.js)
 *   developed(settings, { type, quality })          the developed picture as a PNG, JPEG or WebP Blob, not downloaded
 *   developedRows(settings, onRows)                 the developed picture at full size in float, strip by strip, rows
 *                                                   top first: onRows(rgba Float32Array, firstRow, rows) -- a 16-bit PNG
 *   lightRows(onRows)                               the kept light itself, strip by strip, rows top first:
 *                                                   onRows(rgb Float32Array, firstRow, rows) -- the EXR, HDR and PFM
 *   thumbnail(settings, w, h)                       a small PNG of it, w x h, not downloaded: a scene's card (RT.thumbnail)
 *   meter()                                         the EV a meter reads from the picture (median luminance)
 *   discard()                                       give the memory back
 */
export function makeDarkroom(gpu) {
    let img = null, prog = null, prog32 = null, hprog = null, blank = null
    /* THE CURVES' TABLE (0.79.0, phase 4): 4 x 1024 floats, the develop pass's and the histogram's, made with the first
       draw (straight curves) and written again only when the curves change -- setCurves compares the baked table */
    let lut = null, lutKey = ''
    const curveTable = () => {
        if (!lut) { lut = gpu.createStorageBuffer(bakeLut(CURVE_DEFAULTS())); lutKey = JSON.stringify(CURVE_DEFAULTS()) }
        return lut
    }
    const setCurves = curves => {
        const key = JSON.stringify(curves ?? CURVE_DEFAULTS())
        if (lut && key === lutKey) return false
        const table = bakeLut(curves)
        if (!lut) lut = gpu.createStorageBuffer(table); else lut.w(table)
        lutKey = key
        return true
    }

    // compiled on the first preview; a compile that failed is tried again next time rather than kept failed
    const program = () => prog ??= develop_prog(gpu).catch(e => { prog = null; throw e })
    // ...and for a 16-bit save, the same pass into a float target (half would keep about 11 bits near white)
    const program32 = () => prog32 ??= develop_prog(gpu, { format: 'rgba32float' }).catch(e => { prog32 = null; throw e })
    const histProgram = () => hprog ??= develop_histogram_prog(gpu).catch(e => { hprog = null; throw e })
    const release = () => {
        if (!img) return
        try { img.hdr.b.destroy() } catch { }
        try { img.overlay?.destroy() } catch { }
        try { img.hist?.b.destroy() } catch { }
        img = null
    }

    const draw = async (target, s, res, { view, clipWarn = false, legend, float = false } = {}) => {
        const p = await (float ? program32() : program())
        // after the compile's await: a discard may have come in during it
        if (!img) throw new Error('[develop] no picture kept: render one first')
        blank ??= gpu.createTexture(1, 1, 'rgba8unorm')     // bound when there is no overlay; never read then
        setCurves(s.curves); curveTable()
        p.setResources({ hdr: img.hdr.b, overlay: img.overlay || blank, curveLut: lut.b })
        p.uniforms = developUniforms(s, { src: [img.w, img.h], res, overlay: !!img.overlay, view, clipWarn, legend, float })
        p.drawTo(target)
    }
    const held = pic => { if (img !== pic) throw new Error('[develop] the picture changed during the export') }

    return {
        /** what is kept: its size, samples, the settings the view had, and the memory it holds; null when nothing */
        get picture() {
            return img && { w: img.w, h: img.h, samples: img.samples, view: { ...img.view }, bytes: img.bytes, overlay: !!img.overlay }
        },

        async keep({ from, w, h, overlays = [], view, samples = 0 }) {
            release()
            const bytes = w * h * 16
            const dev = gpu.device
            /* OUT OF MEMORY IS SAID, not found later as a black preview: a 8K picture's copy is half a gigabyte beside
               a renderer that still holds its own. Asked for in an error scope; the copy is not attempted without it. */
            dev.pushErrorScope?.('out-of-memory')
            const hdr = gpu.createStorageBuffer(bytes)
            const oom = await dev.popErrorScope?.()
            if (oom) { try { hdr.b.destroy() } catch { } throw new Error(`[develop] no room on the GPU for a ${(bytes / 1e6) | 0} MB copy of the picture`) }
            const enc = dev.createCommandEncoder()
            enc.copyBufferToBuffer(from.b ?? from, 0, hdr.b, 0, bytes)
            dev.queue.submit([enc.finish()])
            /* THE OVERLAY into a texture that starts transparent black (a new texture is zeros) and is drawn on with
               'load', as each overlay draws -- so it holds what they add and nothing else */
            let overlay = null
            if (overlays.length) {
                overlay = gpu.createTexture(w, h, gpu.format)
                for (const o of overlays) o(overlay)
            }
            img = { w, h, hdr, overlay, bytes, samples, view: { ...view } }
            return this.picture
        },

        async preview(ctx, s, opts = {}) {
            const t = ctx.getCurrentTexture()
            await draw(t, s, [t.width, t.height], opts)
        },

        /* THE HISTOGRAM: 4 KB cleared, counted by develop_histogram_prog over every histogramStep-th pixel, read back.
           The buffer is the picture's (made with its first histogram, freed with it). A read back waits for the GPU,
           so the viewer asks for one at a time, after a setting moves -- never per frame of a pan. */
        async histogram(s) {
            const p = await histProgram()
            if (!img) return null
            const pic = img
            pic.hist ??= gpu.createStorageBuffer(4 * HIST_BINS * 4)
            pic.hist.clear()
            const step = histogramStep(pic.w, pic.h)
            setCurves(s.curves); curveTable()
            p.setResources({ hdr: pic.hdr.b, hist: pic.hist.b, curveLut: lut.b })
            p.uniforms = { ...developUniforms(s, { src: [pic.w, pic.h], res: [pic.w, pic.h] }), step }
            p.run(Math.ceil(pic.w / step), Math.ceil(pic.h / step), 1)
            const bins = await pic.hist.r(4 * HIST_BINS * 4, 0, Uint32Array)
            return img === pic ? bins : null              // a picture kept or discarded meanwhile: not this one's
        },

        /* ONE PIXEL'S LIGHT, for the viewer's readout: 16 bytes read from the kept copy (r, g, b as f32; the fourth word
           the sample count), x and y the buffer's (row 0 the bottom) */
        async pixel(x, y) {
            if (!img || !(x >= 0 && y >= 0 && x < img.w && y < img.h)) return null
            const pic = img
            const f = await pic.hdr.r(16, ((y | 0) * pic.w + (x | 0)) * 16, Float32Array)
            if (img !== pic) return null
            const rgb = [f[0], f[1], f[2]]
            return { rgb, Y: LUMA[0] * rgb[0] + LUMA[1] * rgb[1] + LUMA[2] * rgb[2] }
        },

        /* A PATCH'S MEAN LIGHT (0.79.0): one read a row of it, the pixels never sampled (count 0) left out, as the
           meter leaves them out -- a spot meter or an eyedropper on one pixel would read its noise */
        async area(x, y, r = 4) {
            if (!img) return null
            const pic = img
            const x0 = Math.max(0, (x | 0) - r), x1 = Math.min(pic.w - 1, (x | 0) + r)
            const y0 = Math.max(0, (y | 0) - r), y1 = Math.min(pic.h - 1, (y | 0) + r)
            if (x0 > x1 || y0 > y1) return null
            const sum = [0, 0, 0]
            let n = 0
            for (let row = y0; row <= y1; row++) {
                const f = await pic.hdr.r((x1 - x0 + 1) * 16, (row * pic.w + x0) * 16, Float32Array)
                const u = new Uint32Array(f.buffer, f.byteOffset, f.length)
                for (let i = 0; i <= x1 - x0; i++) {
                    if (u[i * 4 + 3] === 0) continue
                    sum[0] += f[i * 4]; sum[1] += f[i * 4 + 1]; sum[2] += f[i * 4 + 2]; n++
                }
            }
            if (img !== pic || !n) return null
            const rgb = sum.map(v => v / n)
            return { rgb, Y: LUMA[0] * rgb[0] + LUMA[1] * rgb[1] + LUMA[2] * rgb[2], n }
        },

        async save(s, filename = stampedName('render', 'png')) {
            if (!img) throw new Error('[develop] no picture kept: render one first')
            // the canvas's format, as the display's target: gpu.save swaps a BGRA texture's ends itself
            const tex = gpu.createTexture(img.w, img.h, gpu.format)
            try {
                await draw(tex, s, [img.w, img.h])
                return await gpu.save(tex, filename)
            } finally { try { tex.destroy() } catch { } }
        },

        /* THE DEVELOPED PICTURE AS A FILE OF ANOTHER KIND, not downloaded: tinywebgpu's save encodes PNG, JPEG or WebP
           through a canvas (8 bits a channel), the darkroom's caller adds the text and downloads it */
        async developed(s, { type = 'image/png', quality = 0.92 } = {}) {
            if (!img) throw new Error('[develop] no picture kept: render one first')
            const tex = gpu.createTexture(img.w, img.h, gpu.format)
            try {
                await draw(tex, s, [img.w, img.h])
                return await gpu.save(tex, 'picture', { download: false, type, quality })
            } finally { try { tex.destroy() } catch { } }
        },

        /* THE DEVELOPED PICTURE IN FLOAT, for a 16-bit PNG: the develop pass at full size into an rgba32float strip of
           rows (stripView: the strip's own view, the legend placed in the whole), read back strip by strip -- an 8K
           picture in float is 530 MB, which neither the GPU beside the kept copy nor the page needs to hold at once */
        async developedRows(s, onRows, { stripBytes = STRIP_BYTES } = {}) {
            if (!img) throw new Error('[develop] no picture kept: render one first')
            const pic = img, { w, h } = pic
            const t = Math.min(h, rowsPerStrip(w, 16, stripBytes))
            const tex = gpu.createTexture(w, t, 'rgba32float')
            try {
                for (let r0 = 0; r0 < h; r0 += t) {
                    const k = Math.min(t, h - r0)
                    await draw(tex, s, [w, t], { ...stripView(w, h, r0, t), float: true })
                    held(pic)
                    // the target's top k rows: the last strip's rows past the picture are backdrop, not read
                    const rows = await gpu.readTexture(tex, { y: 0, height: k, Ctor: Float32Array })
                    held(pic)
                    await onRows(rows, r0, k)
                }
            } finally { try { tex.destroy() } catch { } }
        },

        /* THE LIGHT ITSELF, for the EXR, HDR and PFM: the kept copy read strip by strip (the buffer's rows run from the
           bottom, so a strip of image rows r0 .. r0 + k - 1 is buffer rows h - r0 - k .. h - r0 - 1, read at once and
           handed over top first), r, g, b of each pixel and not its sample count */
        async lightRows(onRows, { stripBytes = STRIP_BYTES } = {}) {
            if (!img) throw new Error('[develop] no picture kept: render one first')
            const pic = img, { w, h } = pic
            const k0 = rowsPerStrip(w, 16, stripBytes)
            for (let r0 = 0; r0 < h; r0 += k0) {
                const k = Math.min(k0, h - r0), b0 = h - r0 - k
                const f = await pic.hdr.r(k * w * 16, b0 * w * 16, Float32Array)
                held(pic)
                const out = new Float32Array(k * w * 3)
                for (let i = 0; i < k; i++) {
                    const src = (k - 1 - i) * w * 4, dst = i * w * 3
                    for (let x = 0; x < w; x++) {
                        out[dst + x * 3] = f[src + x * 4]; out[dst + x * 3 + 1] = f[src + x * 4 + 1]; out[dst + x * 3 + 2] = f[src + x * 4 + 2]
                    }
                }
                await onRows(out, r0, k)
            }
        },

        /* A SMALL PICTURE OF IT for a scene's card (index.js RT.thumbnail, workspace/scenepics.js): developed as save
           develops it, into a w x h target, and handed back as a PNG Blob without a download. The develop pass
           box-filters at most 8 taps a side, so a picture many times larger aliases a little: for a
           card of 52 x 33 px, enough. */
        async thumbnail(s, w, h) {
            if (!img) throw new Error('[develop] no picture kept: render one first')
            const tex = gpu.createTexture(w, h, gpu.format)
            try {
                await draw(tex, s, [w, h])
                return await gpu.save(tex, 'scene.png', { download: false })
            } finally { try { tex.destroy() } catch { } }
        },

        async meter() {
            if (!img) return null
            const L = medianLuminance(await img.hdr.r(img.bytes, 0, Uint32Array))
            return L > 0 ? meterEV100(L) : null
        },

        discard: release,
    }
}
