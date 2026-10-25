//======================================================================================================================
// WHAT THE DARKROOM CAN SAVE (0.next) -- the formats, the rows each needs, what each file will hold, and the light's
// numbers as each light format writes them. Plain functions: lib/pathtracer/test/export.test.mjs runs every one in node.
//
// TWO KINDS OF FILE. A DEVELOPED one is the picture the viewer shows: the exposure, tone curve and grading, the
// optics overlay, 8 or 16 bits (develop.js save, developedRows). A LIGHT one is the render itself (develop.js
// lightRows): linear Rec.709, no tone curve, no grading, no overlay -- in cd/m^2 (ABSOLUTE, the default: the user,
// 2026-10-25) or multiplied by the chosen exposure so 1.0 is white (EXPOSED, what a compositor expects). A render of the
// illuminance view holds E / pi on every surface (core/tracebasics.js), and the display shows pi Y as lux
// (rendertoscreen.js measureMode 1): its light formats are multiplied by pi the same way, absolute only, and say lux.
//======================================================================================================================

import { gamutClip } from '../../core/colorimetry.js'
import { ev100ToScale } from '../../core/photometry.js'

export const FORMATS = [
    { id: 'png', label: 'PNG, 8-bit', ext: 'png', kind: 'developed' },
    { id: 'png16', label: 'PNG, 16-bit', ext: 'png', kind: 'developed' },
    { id: 'jpeg', label: 'JPEG', ext: 'jpg', kind: 'developed', type: 'image/jpeg', quality: true },
    { id: 'webp', label: 'WebP', ext: 'webp', kind: 'developed', type: 'image/webp', quality: true },
    { id: 'exr', label: 'OpenEXR (the light)', ext: 'exr', kind: 'light', gamut: true, precision: true },
    { id: 'hdr', label: 'Radiance HDR (the light)', ext: 'hdr', kind: 'light' },
    { id: 'pfm', label: 'PFM (the light)', ext: 'pfm', kind: 'light', gamut: true },
]
export const formatOf = id => FORMATS.find(f => f.id === id) ?? FORMATS[0]
/** Radiance's units: watts per steradian per square metre at 179 lumens a watt. */
export const RADIANCE_EFFICACY = 179

/** The export settings a darkroom starts with. */
export const defaultExport = () => ({ format: 'png', quality: 0.92, values: 'absolute', precision: 'float', gamut: false })

const isLux = pic => (pic?.view?.show | 0) === 1

/** What the settings come to for this picture: a lux render absolute only, half only for exposed EXR. */
export function effective(ex, pic) {
    const f = formatOf(ex.format)
    const values = isLux(pic) ? 'absolute' : ex.values === 'exposed' ? 'exposed' : 'absolute'
    return {
        format: f.id, kind: f.kind, ext: f.ext, type: f.type, quality: Math.min(1, Math.max(0.05, +ex.quality || 0.92)),
        values, lux: isLux(pic),
        half: f.id === 'exr' && values === 'exposed' && ex.precision === 'half',
        // RGBE cannot hold a negative: HDR always clips; EXR and PFM when asked
        gamut: f.id === 'hdr' || (!!f.gamut && !!ex.gamut),
    }
}

/** Which rows the Save box shows for these settings. */
export function rowsFor(ex, pic) {
    const f = formatOf(ex.format), e = effective(ex, pic)
    return {
        quality: !!f.quality,
        values: f.kind === 'light' && !e.lux,
        precision: !!f.precision && e.values === 'exposed',
        gamut: !!f.gamut,
    }
}

/** The multiplier from the light kept to the numbers a light file holds, and what 1.0 in the file is in cd/m^2 (or lx). */
export function lightScale(ex, pic, ev) {
    const e = effective(ex, pic)
    const k = (e.lux ? Math.PI : 1) * (e.values === 'exposed' ? ev100ToScale(ev) : 1) / (e.format === 'hdr' && e.values === 'absolute' ? RADIANCE_EFFICACY : 1)
    // the cd/m^2 one unit of the file stands for, before any tool's own conventions
    const unit = e.values === 'exposed' ? 1 / ev100ToScale(ev) : e.format === 'hdr' ? RADIANCE_EFFICACY : 1
    return { k, unit }
}

/** The per-pixel step before a light file is written: scaled, and into the display's gamut when asked. Writes `out` in place. */
export function lightTransform(ex, pic, ev) {
    const e = effective(ex, pic), { k } = lightScale(ex, pic, ev)
    return (rgb, out = rgb) => {
        for (let i = 0; i < rgb.length; i += 3) {
            let r = rgb[i] * k, g = rgb[i + 1] * k, b = rgb[i + 2] * k
            if (e.gamut) [r, g, b] = gamutClip([r, g, b])
            out[i] = r; out[i + 1] = g; out[i + 2] = b
        }
        return out
    }
}

const mb = n => n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`

/** The line beside the button: what the file will hold, and how big it can be. */
export function holdsLine(ex, pic, ev) {
    if (!pic) return ''
    const e = effective(ex, pic), n = pic.w * pic.h
    if (e.kind === 'developed') {
        const what = e.lux ? 'the lux picture in false colour' : 'the developed picture'
        if (e.format === 'png16') return `${what}, 16 bits a channel · up to ${mb(n * 6)}`
        if (e.format === 'png') return `${what}, 8 bits a channel`
        return `${what}, quality ${Math.round(e.quality * 100)} %`
    }
    const { unit } = lightScale(ex, pic, ev)
    const quantity = e.lux ? 'illuminance, lx (π × the light a white surface sends back)'
        : e.values === 'exposed' ? `the light × the exposure: 1.0 = white = ${+unit.toPrecision(4)} cd/m²`
        : e.format === 'hdr' ? 'the light in Radiance\'s units (cd/m² ÷ 179)' : 'the light, cd/m²'
    const precision = e.format === 'hdr' ? 'RGBE (1 %)' : e.half ? 'half float' : 'float32'
    const gamut = e.gamut ? 'into the display gamut' : 'colours outside the gamut kept'
    const size = e.format === 'pfm' ? mb(n * 12) : e.format === 'hdr' ? `up to ${mb(n * 4)}` : `up to ${mb(n * (e.half ? 6 : 12))}`
    const note = e.format === 'pfm' ? ' · the file cannot say what its numbers are' : ''
    return `${quantity} · ${precision}, Rec.709, ${gamut} · no tone curve, grading or overlay · ${size}${note}`
}

/** What every file says about itself: the build, the picture, how it was developed, what its numbers are. */
export function describe({ ex, pic, settings, ev, build = '' }) {
    const e = effective(ex, pic)
    const light = e.kind === 'light' ? (() => {
        const { unit } = lightScale(ex, pic, ev)
        return { quantity: e.lux ? 'illuminance' : 'luminance', unit: e.lux ? 'lx' : 'cd/m2', oneIs: unit,
                 primaries: 'Rec.709 / D65', gamutClipped: e.gamut }
    })() : null
    const { filename: _f, status: _s, ...develop } = settings || {}
    return {
        software: build || 'ShadyTracer',
        json: JSON.stringify({ app: 'ShadyTracer', build, width: pic.w, height: pic.h, samples: pic.samples,
                               format: e.format, ...(light ? { light } : { develop }) }),
    }
}
