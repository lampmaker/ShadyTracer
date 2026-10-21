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
// The arithmetic here is plain functions, tested without a GPU (lib/pathtracer/test/develop.test.mjs); the darkroom
// is the few GPU calls around them, and that test runs it on a recording stand-in for the device.
//======================================================================================================================

import { develop_prog, DevelopUniformTypes } from './core/rendertoscreen.js'
import { ev100ToScale, meterEV100, LUMA } from './core/photometry.js'
import { stampedName } from '../filename.js'

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
    }
}

/** Taps a side for an output of `res` pixels showing a picture of `src`: 1 at full size or larger. */
export const boxFor = (src, res) =>
    Math.min(MAX_BOX, Math.max(1, Math.ceil(Math.max(src[0] / res[0], src[1] / res[1]) - 1e-9)))

/** The develop pass's uniforms: every name DevelopUniformTypes declares, nothing else (tinywebgpu refuses a name its
 *  schema lacks). The exposure goes in as the multiplier the display computes from an EV (photometry.ev100ToScale),
 *  and auto-exposure off: the EV is decided here, once. */
export function developUniforms(s, { src, res, overlay = false }) {
    return {
        // no `time`: the display's uniforms lost it in 0.22.3 (no shader read it), and tinywebgpu refuses an undeclared name
        res: [res[0], res[1]],
        exposureScale: ev100ToScale(s.ev), autoExposure: 0, exposureComp: 0,
        toneMap: s.toneMap | 0, contrast: +s.contrast || 0, saturation: +s.saturation || 0, brightness: +s.brightness || 0,
        measureMode: s.show | 0, measureMin: +s.measureMin, measureMax: +s.measureMax, measureBands: s.measureBands | 0,
        src: [src[0], src[1]], box: boxFor(src, res), overlayOn: overlay ? 1 : 0,
    }
}
// every name of DevelopUniformTypes is written above: one added to the schema and not here would sit at 0 (the test checks)
export const DEVELOP_UNIFORMS = Object.keys(DevelopUniformTypes)

/** A preview of a w x h picture fitted inside maxW x maxH, never larger than the picture, whole pixels. */
export function fitPreview(w, h, maxW, maxH) {
    const s = Math.min(1, maxW / w, maxH / h)
    return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))]
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
 *   preview(ctx, settings)                          into a WebGPU canvas context configured on this device
 *   save(settings, filename)                        a PNG at the picture's size; returns the Blob. Without a filename,
 *                                                   render-<the time>.png (lib/filename.js)
 *   thumbnail(settings, w, h)                       a small PNG of it, w x h, not downloaded: a scene's card (RT.thumbnail)
 *   meter()                                         the EV a meter reads from the picture (median luminance)
 *   discard()                                       give the memory back
 */
export function makeDarkroom(gpu) {
    let img = null, prog = null, blank = null

    // compiled on the first preview; a compile that failed is tried again next time rather than kept failed
    const program = () => prog ??= develop_prog(gpu).catch(e => { prog = null; throw e })
    const release = () => {
        if (!img) return
        try { img.hdr.b.destroy() } catch { }
        try { img.overlay?.destroy() } catch { }
        img = null
    }

    const draw = async (target, s, res) => {
        const p = await program()
        // after the compile's await: a discard may have come in during it
        if (!img) throw new Error('[develop] no picture kept: render one first')
        blank ??= gpu.createTexture(1, 1, 'rgba8unorm')     // bound when there is no overlay; never read then
        p.setResources({ hdr: img.hdr.b, overlay: img.overlay || blank })
        p.uniforms = developUniforms(s, { src: [img.w, img.h], res, overlay: !!img.overlay })
        p.drawTo(target)
    }

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

        async preview(ctx, s) {
            const t = ctx.getCurrentTexture()
            await draw(t, s, [t.width, t.height])
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
