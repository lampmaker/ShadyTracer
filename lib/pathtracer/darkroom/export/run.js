//======================================================================================================================
// ONE EXPORT, START TO FINISH (0.next): the darkroom's picture into the file the settings ask for, as a Blob -- the
// caller names it and downloads it. No DOM, no GPU of its own: it drives a darkroom (develop.js makeDarkroom, or a
// stand-in in lib/pathtracer/test/export.test.mjs) and the writers beside it.
//
//   const blob = await exportPicture({ darkroom, ex, settings, build, onProgress: (rows, of) => ... })
//======================================================================================================================

import { effective, lightScale, lightTransform, describe } from './index.js'
import { makeEXR } from './exr.js'
import { makeHDR } from './hdr.js'
import { makePFM } from './pfm.js'
import { makePNG16, insertText } from './png.js'

export async function exportPicture({ darkroom, ex, settings, build = '', onProgress = () => { } }) {
    const pic = darkroom.picture
    if (!pic) throw new Error('[export] no picture kept: render one first')
    const e = effective(ex, pic)
    const ev = settings.ev
    const about = describe({ ex, pic, settings, ev, build })
    const text = [['Software', about.software], ['Comment', about.json]]

    if (e.kind === 'developed' && e.format !== 'png16') {
        const blob = await darkroom.developed(settings, { type: e.type ?? 'image/png', quality: e.quality })
        // a PNG says how it was made; a JPEG or WebP from a canvas has no room the browser lets us write
        if (e.format !== 'png') return blob
        return new Blob([insertText(new Uint8Array(await blob.arrayBuffer()), text)], { type: 'image/png' })
    }

    if (e.format === 'png16') {
        const P = makePNG16(pic.w, pic.h)
        await darkroom.developedRows(settings, async (rgba, r0, k) => {
            const rgb = new Uint16Array(k * pic.w * 3)
            for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
                rgb[i] = Math.round(Math.min(1, Math.max(0, rgba[j])) * 65535)
                rgb[i + 1] = Math.round(Math.min(1, Math.max(0, rgba[j + 1])) * 65535)
                rgb[i + 2] = Math.round(Math.min(1, Math.max(0, rgba[j + 2])) * 65535)
            }
            await P.addRows(rgb, k)
            onProgress(r0 + k, pic.h)
        })
        return P.finish(text)
    }

    // THE LIGHT
    const { unit } = lightScale(ex, pic, ev)
    const step = lightTransform(ex, pic, ev)
    const W = e.format === 'exr'
        ? makeEXR({ w: pic.w, h: pic.h, half: e.half, compression: 'zip',
                    attributes: { whiteLuminance: e.lux ? 1 : unit, strings: { software: about.software, shadyTracer: about.json } } })
        : e.format === 'hdr'
            ? makeHDR({ w: pic.w, h: pic.h, lines: [
                `SOFTWARE=${about.software.replace(/\n/g, ' ')}`,
                'PRIMARIES=0.640 0.330 0.300 0.600 0.150 0.060 0.3127 0.3290',
                // exposed values: EXPOSURE is what they were multiplied by after Radiance's units (value / EXPOSURE = W/sr/m^2)
                ...(e.values === 'exposed' ? [`EXPOSURE=${(179 / unit).toPrecision(8)}`] : [])] })
            : makePFM({ w: pic.w, h: pic.h })
    await darkroom.lightRows(async (rgb, r0, k) => {
        await W.addRows(step(rgb), k)
        onProgress(r0 + k, pic.h)
    })
    return W.finish()
}

/** The file to the browser's downloads. The URL is let go later, not at once: the click starts a download that still
 *  has to read it (a large EXR for a while). */
export function download(blob, name) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 60000)
}
