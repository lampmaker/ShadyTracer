//======================================================================================================================
// IMAGES -- a scene's pictures and a material's image slots (model version 29, 0.next; roadmap/TEXTURES.md T1). The
// engine's half -- the lookup, the atlas, the slot's uniform -- is lib/pathtracer/core/images.js.
//
// THE PICTURE IS THE SCENE'S, KEPT BY ITS CONTENT: doc.images = { <key>: { name, type, width, height, data } }, the key
// 'i' and the first 24 hex digits of the SHA-256 of its bytes, `data` those bytes in base64 (PNG, JPEG or WebP, as read,
// or re-encoded when it was scaled down to IMAGE_MAX_EDGE). Two materials and two slots with one picture keep it once.
// IN THE SCENE'S FILE, so a file is whole wherever it goes (roadmap/TEXTURES.md, decision 2): an exported scene, a
// project, a library item, a copy. A ray file's rays are kept per browser by name and do not travel (optics/rayfiles.js);
// a picture must not repeat that.
// NO UNDO STEP HOLDS IT (project.js OUTSIDE_HISTORY): a snapshot a step would carry megabytes, and an undo never needs to
// take a picture away -- a slot that names it is what the step undoes. So a slot may name a picture the document does
// not have (an undo's text, before carryOutside puts the pictures back; a file edited by hand): it reads transparent,
// and the panel says it is missing. Nothing here refuses it.
//
// A MATERIAL'S SLOTS: m.images = [{ name, image, use, projection, size, offset, turn, wrapU, wrapV, filter, faces,
// colour, sharpness }], in order (core/images.js SLOT_DEFAULTS has what each means). The name is what its code calls it
// by (`sample(picture)`), and its uniform is img_<name>_<material id> (slotKey): a material's own parameters may not be
// called img_... (model.js), so the two cannot meet. `use` 'colour' wires it with no code -- a surface's base colour, an
// emitter's glow -- at most one slot a material; 'none' leaves it to the code.
//======================================================================================================================
import { PROJECTIONS, WRAPS, FILTERS, FACES, USES, SLOT_DEFAULTS, IMAGE_MAX_EDGE, IMAGE_RESOURCE, heightStats, pack16 } from '../lib/pathtracer/core/images.js'

export { SLOT_DEFAULTS, PROJECTIONS, WRAPS, FILTERS, FACES, USES, IMAGE_MAX_EDGE }

export const IMAGE_KEY = /^i[0-9a-f]{24}$/
const SLOT_NAME = /^[A-Za-z][A-Za-z0-9_]*$/
/** What each setting of a slot does, in the user's words: the reference page's (help/reference.mjs). */
export const SLOT_HELP = {
    use: 'colour: the material\'s colour with no code -- a surface\'s base colour, a glowing material\'s glow (its white at the luminance, its black dark, the surface below it showing there); none: only its code reads it. A compile.',
    projection: 'How the point is put on the image texture, in the object\'s pattern frame: planar along its z; box, one of six faces by the normal, each read the right way round from outside; triplanar, the three blended by the normal; cylindrical round its z, across being the distance round in mm; spherical, the whole image once over a sphere.',
    size: 'One copy of the image texture, across and up, in real millimetres whatever the scene\'s unit (spherical: unused).',
    offset: 'Where the image texture\'s centre is in its plane, in mm.',
    turn: 'The image texture turned in its own plane, anticlockwise, in degrees.',
    wrapU: 'Across: repeat (copies side by side), mirror (every other copy flipped, no seam), clamp (the edge pixels go on) or none (one copy; the material\'s own value outside it).',
    wrapV: 'Up: the same four.',
    filter: 'smooth: mixed between pixels; pixels: each pixel a sharp square.',
    faces: 'Planar only: front (where the surface faces +z), both (front and back, the back mirrored as a slide seen from behind) or all (every face; the edges smear across the sides).',
    colour: 'true: a colour image, decoded from sRGB to light; false: data (a roughness map, a mask), read as its numbers.',
    sharpness: 'Triplanar only: how quickly the three projections hand over where the surface turns, 1 to 64.',
}

/** The image types a scene keeps: what every browser decodes. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
/** The prefix of a slot's key and uniform; a material's own parameter may not start with it (model.js). */
export const SLOT_PREFIX = 'img_'
/** A slot's key, as the panel and the builder's live() name it: its uniform is codegen's uniformName(material, key). */
export const slotKey = name => `${SLOT_PREFIX}${name}`
/** The slot a key names on material `m`, or null. */
export const slotOfKey = (m, k) => typeof k === 'string' && k.startsWith(SLOT_PREFIX)
    ? (m?.images ?? []).find(s => s.name === k.slice(SLOT_PREFIX.length)) ?? null : null
/** Whether a material has any slot (then its code sees its point in its frame: codegen materialReadsLocal). */
export const hasSlots = m => Array.isArray(m?.images) && m.images.length > 0
/** The slot that is the material's colour with no code ('colour'), or null. */
export const colourSlot = m => (m?.images ?? []).find(s => s.use === 'colour') ?? null
/** A slot as codegen reads it: every setting there, the defaults where the file has none. */
export const slotOf = s => ({ ...SLOT_DEFAULTS, ...s, size: { ...SLOT_DEFAULTS.size, ...s?.size }, offset: { ...SLOT_DEFAULTS.offset, ...s?.offset } })

/** THE SURFACE UNDER A PICTURE THAT GLOWS (roadmap/TEXTURES.md 4, way 1): where a pixel is black the point emits nothing
 *  and is not an emitter there (materials_pbr.js), so an emitter whose glow is a picture keeps these fields of a surface
 *  too, which show where it is dark -- a switched-off screen. The rest of a surface (transmission and what follows) it
 *  does not have: a pixel that glows ends the path, as every emitter does. */
export const SCREEN_FIELDS = ['baseColor', 'metallic', 'roughness', 'specular', 'specularTint']
/** ...and what they start as on the first picture an emitter glows with: a screen's dark glass. */
export const SCREEN_DEFAULTS = Object.freeze({ baseColor: Object.freeze({ r: 0.02, g: 0.02, b: 0.02 }), metallic: 0, roughness: 0.05, specular: 0.5, specularTint: 0 })

const isObj = o => o && typeof o === 'object' && !Array.isArray(o)
const xy = v => isObj(v) && Number.isFinite(v.x) && Number.isFinite(v.y)

/** Every problem with a scene's pictures, as strings. */
export function imagesProblems(images) {
    if (images === undefined) return []
    if (!isObj(images)) return ['images must be an object of images by key']
    const p = []
    for (const [k, e] of Object.entries(images)) {
        if (!IMAGE_KEY.test(k)) p.push(`images: '${k}' is not an image's key (i and 24 hex digits)`)
        if (!isObj(e)) { p.push(`images.${k}: not an image`); continue }
        if (typeof e.name !== 'string') p.push(`images.${k}: name must be a string`)
        if (!IMAGE_TYPES.includes(e.type)) p.push(`images.${k}: type must be one of ${IMAGE_TYPES.join(', ')}`)
        for (const d of ['width', 'height'])
            if (!(Number.isInteger(e[d]) && e[d] >= 1 && e[d] <= IMAGE_MAX_EDGE)) p.push(`images.${k}: ${d} must be a whole number from 1 to ${IMAGE_MAX_EDGE}`)
        if (typeof e.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(e.data)) p.push(`images.${k}: data must be the image's bytes in base64`)
        // a 16-bit grey PNG (0.next): read by this file's own decoder, not the browser's, which gives 8 bits
        if (e.bits !== undefined && !(e.bits === 16 && e.type === 'image/png')) p.push(`images.${k}: bits is 16 (a 16-bit grey PNG) or absent`)
        // its heights' bound (core/images.js heightStats): six numbers from 0 to 1 read as colour and as data
        if (e.heights !== undefined && !(isObj(e.heights) && ['colour', 'data'].every(c => Array.isArray(e.heights[c]) && e.heights[c].length === 6
            && e.heights[c].every(v => Number.isFinite(v) && v >= 0 && v <= 1.01)) && Object.keys(e.heights).length === 2))
            p.push(`images.${k}: heights must be { colour, data }, six numbers from 0 to 1 each`)
        for (const x of Object.keys(e)) if (!['name', 'type', 'width', 'height', 'data', 'bits', 'heights'].includes(x)) p.push(`images.${k}: '${x}' is not an image's`)
    }
    return p
}

/** Every problem with a material's slots, as strings. `taken`: names its code already has (its parameters, its scope). */
export function slotsProblems(m, taken = []) {
    if (m?.images === undefined) return []
    const id = m?.id
    if (!Array.isArray(m.images)) return [`material '${id}': images must be a list of image textures`]
    const p = [], seen = new Set()
    let colours = 0
    for (const s of m.images) {
        if (!isObj(s)) { p.push(`material '${id}': an image texture that is not an object`); continue }
        const at = `material '${id}', image texture '${s.name}'`
        if (typeof s.name !== 'string' || !SLOT_NAME.test(s.name)) p.push(`material '${id}': '${s.name}' is not a name for an image texture (a WGSL name)`)
        else if (seen.has(s.name)) p.push(`${at}: a second image texture of that name`)
        else if (taken.includes(s.name)) p.push(`${at}: the name is taken (a parameter of the material, or a name its code has)`)
        seen.add(s.name)
        if (typeof s.image !== 'string' || !IMAGE_KEY.test(s.image)) p.push(`${at}: image must be an image's key`)
        const one = (k, list) => { if (s[k] !== undefined && !list.includes(s[k])) p.push(`${at}: ${k} must be one of ${list.join(', ')}`) }
        one('use', USES); one('projection', PROJECTIONS); one('wrapU', WRAPS); one('wrapV', WRAPS); one('filter', FILTERS); one('faces', FACES)
        if (s.use === 'colour') colours++
        if (s.size !== undefined && !(xy(s.size) && s.size.x > 0 && s.size.y > 0)) p.push(`${at}: size must be {x, y} in mm, each above 0`)
        if (s.offset !== undefined && !xy(s.offset)) p.push(`${at}: offset must be {x, y} in mm`)
        if (s.turn !== undefined && !Number.isFinite(s.turn)) p.push(`${at}: turn must be a number of degrees`)
        if (s.sharpness !== undefined && !(Number.isFinite(s.sharpness) && s.sharpness >= 1 && s.sharpness <= 64)) p.push(`${at}: sharpness must be from 1 to 64`)
        if (s.colour !== undefined && typeof s.colour !== 'boolean') p.push(`${at}: colour must be true (sRGB) or false (data)`)
        for (const x of Object.keys(s)) if (!['name', 'image', ...Object.keys(SLOT_DEFAULTS)].includes(x)) p.push(`${at}: '${x}' is not an image texture's setting`)
    }
    if (colours > 1) p.push(`material '${id}': ${colours} image textures are its colour -- one at most`)
    return p
}

/** The keys of the pictures a scene's materials use, in the order first used. */
export function usedImages(doc) {
    const out = []
    for (const m of doc?.materials ?? []) for (const s of m.images ?? []) if (!out.includes(s.image)) out.push(s.image)
    return out
}

/** A free slot name on material `m`: `base`, base2, base3, ... */
export function freeSlotName(m, base = 'texture', taken = []) {
    const has = n => (m.images ?? []).some(s => s.name === n) || taken.includes(n)
    if (!has(base)) return base
    for (let i = 2; ; i++) if (!has(`${base}${i}`)) return `${base}${i}`
}

//----------------------------------------------------------------------------------------------------------------------
// A PICTURE FROM A FILE, in the browser: decoded (its size is the scene's to know without decoding it again), scaled down
// to IMAGE_MAX_EDGE when larger -- said, in `scaled` -- and keyed by its bytes. Never in node: the tests build entries
// with entryFromBytes.
//----------------------------------------------------------------------------------------------------------------------
const toBase64 = bytes => {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
    let s = ''
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
    return btoa(s)
}
/** A picture's bytes from its base64 (a Uint8Array). */
export const fromBase64 = b64 => {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'))
    const s = atob(b64), out = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
    return out
}
/** The key of a picture's bytes: 'i' and the first 24 hex digits of their SHA-256. */
export async function imageKey(bytes) {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    return 'i' + [...h.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('')
}
/** A picture's entry from bytes whose size and type are known: { key, entry }. */
export async function entryFromBytes(bytes, { name = 'image', type, width, height }) {
    return { key: await imageKey(bytes), entry: { name: String(name), type, width, height, data: toBase64(bytes) } }
}
/* A 16-BIT GREY PNG (0.next; a height map, core/images.js A PICTURE AS A HEIGHT): the browser decodes every picture to 8
   bits, which give a height 256 levels -- a terrace every amplitude / 255 under a raking light -- so a grey PNG of 16 bits
   is read here, from its specification: its chunks, its IDAT inflated (DecompressionStream's zlib, the browser's and
   node's own), its rows unfiltered. Grey (colour type 0) and grey with alpha (4), not interlaced; every other PNG is the
   browser's to decode, at 8 bits. */
const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10]
/** A PNG's header: { width, height, depth, colourType, interlace }, or null for what is not a PNG. */
export function pngInfo(bytes) {
    if (!(bytes?.length > 33) || PNG_SIG.some((b, i) => bytes[i] !== b)) return null
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return null
    return { width: dv.getUint32(16), height: dv.getUint32(20), depth: bytes[24], colourType: bytes[25], interlace: bytes[28] }
}
/** Whether this file's own decoder reads it: a 16-bit grey PNG, not interlaced. */
export const isDeepGrey = info => !!info && info.depth === 16 && (info.colourType === 0 || info.colourType === 4) && info.interlace === 0
async function inflate(bytes) {
    const out = new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')))
    return new Uint8Array(await out.arrayBuffer())
}
/** A 16-bit grey PNG decoded: { width, height, gray: Uint16Array, alpha: Uint16Array | null }. Throws, saying why. */
export async function decodePNG16(bytes) {
    const info = pngInfo(bytes)
    if (!isDeepGrey(info)) throw new Error('not a 16-bit grey PNG that is not interlaced')
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const parts = []
    for (let o = 8; o + 8 <= bytes.length;) {
        const len = dv.getUint32(o), type = String.fromCharCode(...bytes.subarray(o + 4, o + 8))
        if (type === 'IDAT') parts.push(bytes.subarray(o + 8, o + 8 + len))
        if (type === 'IEND') break
        o += 12 + len
    }
    const z = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) { z.set(p, at); at += p.length }
    const raw = await inflate(z)
    const ch = info.colourType === 4 ? 2 : 1, bpp = 2 * ch, stride = info.width * bpp
    if (raw.length < info.height * (stride + 1)) throw new Error('its image data is shorter than its size says')
    const rows = new Uint8Array(info.height * stride)
    for (let y = 0; y < info.height; y++) {
        const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = rows.subarray(y * stride, (y + 1) * stride)
        const up = y ? rows.subarray((y - 1) * stride, y * stride) : null
        for (let i = 0; i < stride; i++) {
            const a = i >= bpp ? row[i - bpp] : 0, b = up ? up[i] : 0, c = up && i >= bpp ? up[i - bpp] : 0
            const pr = () => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
            row[i] = (src[i] + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? pr() : NaN)) & 255
            if (f > 4) throw new Error(`a row with filter ${f}, which PNG does not have`)
        }
    }
    const n = info.width * info.height, gray = new Uint16Array(n), alpha = ch === 2 ? new Uint16Array(n) : null
    for (let i = 0; i < n; i++) {
        gray[i] = (rows[i * bpp] << 8) | rows[i * bpp + 1]
        if (alpha) alpha[i] = (rows[i * bpp + 2] << 8) | rows[i * bpp + 3]
    }
    return { width: info.width, height: info.height, gray, alpha }
}

/** A PICTURE'S PIXELS AS THE ATLAS HOLDS THEM: { width, height, pixels } in rgba bytes, a 16-bit grey one's packed
 *  (core/images.js pack16). Decoded from its entry -- by the browser, or for 16 bits by decodePNG16. */
export async function pixelsOf(entry) {
    const bytes = fromBase64(entry.data)
    if (entry.bits === 16) {
        const d = await decodePNG16(bytes)
        return { width: d.width, height: d.height, pixels: pack16(d.gray, d.alpha, d.width, d.height) }
    }
    const bmp = await createImageBitmap(new Blob([bytes], { type: entry.type }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
    try { return { width: bmp.width, height: bmp.height, pixels: bitmapPixels(bmp) } } finally { bmp.close?.() }
}
const bitmapPixels = bmp => {
    const c = new OffscreenCanvas(bmp.width, bmp.height)
    const g = c.getContext('2d', { willReadFrequently: true })
    g.drawImage(bmp, 0, 0)
    return new Uint8Array(g.getImageData(0, 0, bmp.width, bmp.height).data.buffer)
}
/* THE HEIGHTS' BOUND FROM PIXELS THE BROWSER DECODED, with room: a canvas keeps its colours premultiplied by alpha, so
   reading them back un-premultiplied rounds a part-transparent pixel's colour a little apart from what the atlas, which
   is given them un-premultiplied, holds (inferred, from how a 2D canvas stores them). Two levels in 255 on every
   difference covers that rounding at every alpha above 1/255 times the luminance's weights, which sum to 1. A 16-bit
   picture is read by decodePNG16, the atlas's own bytes: no room needed. */
const BROWSER_ROOM = 2 / 255
const statsOf = (px, bits) => {
    const st = heightStats(px, { bits })
    if (bits === 16) return st
    return Object.fromEntries(Object.entries(st).map(([k, v]) => [k, v.map(x => Math.min(1.01, x + BROWSER_ROOM))]))
}
/** Work out an entry's heights' bound (core/images.js heightStats) from its pixels, and give it to the entry: for one
 *  made before entries had it. Returns the entry. */
export async function withHeights(entry) {
    if (entry.heights) return entry
    entry.heights = statsOf(await pixelsOf(entry), entry.bits ?? 8)
    return entry
}

/**
 * A file (or a Blob) as a picture: { key, entry, scaled } -- scaled the size it was, when it was larger than
 * IMAGE_MAX_EDGE and was scaled down; null otherwise. Its heights' bound is worked out as it is read, for a relief
 * (core/images.js A PICTURE AS A HEIGHT). A 16-bit grey PNG keeps its 16 bits (decodePNG16), and is refused, saying so,
 * when larger than IMAGE_MAX_EDGE: scaling one here would round it to 8. Throws, saying why, for what is not a PNG, JPEG
 * or WebP the browser can decode.
 */
export async function imageFromFile(file) {
    const type = IMAGE_TYPES.includes(file.type) ? file.type : null
    const name = String(file.name ?? 'image')
    if (!type) throw new Error(`'${file.name ?? 'the file'}' is not a PNG, JPEG or WebP image${file.type ? ` (it is ${file.type})` : ''}`)
    const bytes = new Uint8Array(await file.arrayBuffer())
    const info = type === 'image/png' ? pngInfo(bytes) : null
    if (isDeepGrey(info)) {
        if (Math.max(info.width, info.height) > IMAGE_MAX_EDGE)
            throw new Error(`'${name}' is a 16-bit image of ${info.width} x ${info.height}: scale it to ${IMAGE_MAX_EDGE} on its longer side first (scaled here it would lose its 16 bits)`)
        let d
        try { d = await decodePNG16(bytes) } catch (e) { throw new Error(`'${name}' could not be decoded: ${e?.message ?? e}`) }
        const got = await entryFromBytes(bytes, { name, type, width: d.width, height: d.height })
        got.entry.bits = 16
        got.entry.heights = statsOf({ width: d.width, height: d.height, pixels: pack16(d.gray, d.alpha, d.width, d.height) }, 16)
        return { ...got, scaled: null }
    }
    let bmp
    try { bmp = await createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }) }
    catch (e) { throw new Error(`'${file.name ?? 'the file'}' could not be decoded: ${e?.message ?? e}`) }
    const { width, height } = bmp
    if (Math.max(width, height) <= IMAGE_MAX_EDGE) {
        const heights = statsOf({ width, height, pixels: bitmapPixels(bmp) }, 8)
        bmp.close?.()
        const got = await entryFromBytes(bytes, { name, type, width, height })
        got.entry.heights = heights
        return { ...got, scaled: null }
    }
    // TOO LARGE: drawn at IMAGE_MAX_EDGE on its longer side, and kept as PNG (a JPEG stays a JPEG, at 0.92)
    const k = IMAGE_MAX_EDGE / Math.max(width, height)
    const w = Math.max(1, Math.round(width * k)), h = Math.max(1, Math.round(height * k))
    const c = new OffscreenCanvas(w, h)
    const g = c.getContext('2d')
    g.imageSmoothingQuality = 'high'
    g.drawImage(bmp, 0, 0, w, h)
    bmp.close?.()
    const outType = type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
    const blob = await c.convertToBlob({ type: outType, quality: 0.92 })
    const got = await entryFromBytes(new Uint8Array(await blob.arrayBuffer()), { name, type: outType, width: w, height: h })
    // the bound from the bytes kept, as the atlas will be given them (a JPEG re-encoded is not the canvas drawn)
    await withHeights(got.entry)
    return { ...got, scaled: { width, height } }
}

//----------------------------------------------------------------------------------------------------------------------
// THE ATLAS ON THE GPU: a scene's init (codegen generate) makes it -- composed with the scene as data's init when the
// scene has both, as every resource of a scene comes from the one init the renderer calls (raytrace_main.js setScene).
//
// KEPT BY WHAT IS IN IT. Every structural edit is a new scene, and decoding a 4096-pixel picture again at each would be
// a wait at every compile (inferred: a browser decodes a few hundred megapixels a second, so 16 Mpx is a noticeable part
// of one; not measured here). So the atlas of the same pictures at the same places on the same device is made once and
// handed to every scene that asks (ATLASES, its last few). None is destroyed by hand: an older scene may still hold one
// (the renderer's scene before, put back when a build fails; the optics module's pipelines), and a texture no one holds
// is the browser's to free.
//----------------------------------------------------------------------------------------------------------------------
const ATLASES = []                  // { device, sig, ready: Promise<GPUTexture> }, newest last
const ATLASES_KEPT = 3
/** What an atlas holds: its size, and every picture's key and place. */
export const atlasSignature = atlas => JSON.stringify([atlas.width, atlas.height, [...atlas.rects].sort((a, b) => a[0] < b[0] ? -1 : 1)])

async function makeAtlas(WG, atlas, images) {
    const tex = WG.createTexture(atlas.width, atlas.height, 'rgba8unorm')
    for (const [key, r] of atlas.rects) {
        const e = images[key]
        if (!e) continue
        try {
            if (e.pixels) {                 // a test's stand-in: rgba bytes, first row the top (never in a file: imagesProblems)
                const D = WG.device
                D.queue.writeTexture({ texture: tex, origin: { x: r.x, y: r.y } }, e.pixels, { bytesPerRow: 4 * r.w, rowsPerImage: r.h }, { width: r.w, height: r.h })
                continue
            }
            if (e.bits === 16) {            // this file's own decoder, and its two bytes a texel (core/images.js pack16)
                const d = await pixelsOf(e)
                WG.device.queue.writeTexture({ texture: tex, origin: { x: r.x, y: r.y } }, d.pixels, { bytesPerRow: 4 * d.width, rowsPerImage: d.height },
                    { width: Math.min(r.w, d.width), height: Math.min(r.h, d.height) })
                continue
            }
            if (typeof createImageBitmap !== 'function') { console.warn(`[images] '${e.name}' not decoded: no createImageBitmap here`); continue }
            const bmp = await createImageBitmap(new Blob([fromBase64(e.data)], { type: e.type }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
            WG.device.queue.copyExternalImageToTexture({ source: bmp, flipY: false },
                { texture: tex, origin: { x: r.x, y: r.y }, premultipliedAlpha: false }, { width: Math.min(r.w, bmp.width), height: Math.min(r.h, bmp.height) })
            bmp.close?.()
        } catch (err) { console.warn(`[images] '${e.name}' could not be put on the GPU: ${err?.message ?? err}`) }
    }
    return tex
}

/** Give `scene` its atlas: `init` returns it beside whatever the init before it returned. `images` the tree's pictures. */
export function attachImages(scene, atlas, images) {
    const before = scene.init
    const sig = atlasSignature(atlas)
    Object.defineProperty(scene, 'imageRects', { enumerable: false, configurable: true, writable: true, value: atlas.rects })
    Object.defineProperty(scene, 'imageAtlas', { enumerable: false, configurable: true, writable: true, value: sig })
    Object.defineProperty(scene, 'init', { enumerable: false, configurable: true, writable: true, value: async WG => {
        const others = before ? await before(WG) : {}
        let hit = ATLASES.find(a => a.device === WG.device && a.sig === sig)
        if (!hit) {
            hit = { device: WG.device, sig, ready: makeAtlas(WG, atlas, images) }
            ATLASES.push(hit)
            while (ATLASES.length > ATLASES_KEPT) ATLASES.shift()
        }
        return { ...(others || {}), [IMAGE_RESOURCE]: await hit.ready }
    } })
    return scene
}
