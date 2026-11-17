/*======================================================================================================================
  AN IMAGE OF THE SURROUNDINGS (0.next; the user, 2026-11-17: "and perhaps load an image, as is usual in CAD and render
  software"). core/environment.js says what the environment is -- code, background(dir) in cd/m^2 -- and this is one
  thing that code can read: envImage(dir), an equirectangular panorama (360 degrees across, 180 up, as HDRI sites give
  them) looked up in the direction dir.

  WHAT IT RETURNS is the picture's own numbers, linear: a Radiance .hdr's as they are, a PNG's, JPEG's or WebP's decoded
  from sRGB. The code scales them to cd/m^2 -- the image preset by UB.envImageLuminance, whose default, 179, is
  Radiance's own luminous efficacy (lm/W; the darkroom writes its .hdr files by it, darkroom/export/index.js): a
  calibrated .hdr then gives its own luminance. An 8-bit photograph has no such calibration -- its white is whatever the
  camera made white -- so it is given a daylight sky's 5000 cd/m^2 at white instead, a starting point to set by eye.

  WHICH WAY IT FACES: the picture's middle column is +x, and it runs to the right as one turns to the right (clockwise
  seen from above, as standing inside it); its top row is straight up. UB.envImageTurn turns it about z, in degrees,
  anticlockwise seen from above. The lookup is bilinear, wrapping across the seam at the back and clamped at the poles.

  ONLY WITH AN IMAGE IN THE SCENE: the kernels that hold the environment's code declare the picture (ENV_IMAGE_RESOURCE,
  an rgba16float texture the renderer makes from the scene's image: raytrace_main.js R.ensureEnv) when the scene has one,
  and keep the stub, black, otherwise -- so every other scene's text is what it was.
======================================================================================================================*/
export const ENV_IMAGE_RESOURCE = 'envImg'
export const ENV_IMAGE_TYPE = 'texture_2d<f32>'
/** The widest a picture is kept on the GPU: wider is box-filtered down (inferred: 4096 x 2048 is 0.17 degree a pixel,
 *  finer than any reflection a path tracer's few samples resolve; 64 MB of half floats). */
export const ENV_IMAGE_MAX_W = 4096
/** cd/m^2 per unit of a Radiance file: its luminous efficacy, lm/W. */
export const RADIANCE_EFFICACY = 179
/** ...and the white of an 8-bit photograph: a daylight sky's, chosen, not measured. */
export const PHOTO_WHITE_CD = 5000

/** Where the lookup goes in every program: black until withEnvironment puts the picture there. */
export const ENV_IMAGE_STUB = 'fn envImage(dir: VEC3) -> VEC3 { return VEC3(0.0); }   // no environment image here (core/envimage.js)'
export const ENV_IMAGE_WGSL = /* wgsl */`
/* THE SCENE'S ENVIRONMENT IMAGE in direction dir (core/envimage.js): equirectangular, bilinear, its own numbers. */
fn envImage(dir: VEC3) -> VEC3 {
    let d = normalize(dir);
    let size = textureDimensions(${ENV_IMAGE_RESOURCE});
    let w = i32(size.x);
    let h = i32(size.y);
    let u = fract(0.5 - atan2(d.y, d.x) / (2.0 * PI) + UB.envImageTurn / 360.0) * f32(w) - 0.5;
    let v = acos(clamp(d.z, -1.0, 1.0)) / PI * f32(h) - 0.5;
    let x0 = floor(u);
    let y0 = floor(v);
    let fx = u - x0;
    let fy = v - y0;
    let xa = ((i32(x0) % w) + w) % w;
    let xb = (xa + 1) % w;
    let ya = clamp(i32(y0), 0, h - 1);
    let yb = clamp(i32(y0) + 1, 0, h - 1);
    let top = mix(textureLoad(${ENV_IMAGE_RESOURCE}, vec2<i32>(xa, ya), 0).rgb, textureLoad(${ENV_IMAGE_RESOURCE}, vec2<i32>(xb, ya), 0).rgb, fx);
    let bot = mix(textureLoad(${ENV_IMAGE_RESOURCE}, vec2<i32>(xa, yb), 0).rgb, textureLoad(${ENV_IMAGE_RESOURCE}, vec2<i32>(xb, yb), 0).rgb, fx);
    return max(mix(top, bot, fy), VEC3(0.0));
}
`

/** The same lookup in JS, for the tests and for a host that wants the number: `img` { width, height, rgb } (Float32,
 *  three a pixel, top row first). */
export function envImageAt(img, dir, turnDeg = 0) {
    const n = Math.hypot(...dir), d = dir.map(x => x / n)
    const { width: w, height: h, rgb } = img
    const fr = x => x - Math.floor(x)
    const u = fr(0.5 - Math.atan2(d[1], d[0]) / (2 * Math.PI) + turnDeg / 360) * w - 0.5
    const v = Math.acos(Math.min(1, Math.max(-1, d[2]))) / Math.PI * h - 0.5
    const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0
    const xa = ((x0 % w) + w) % w, xb = (xa + 1) % w
    const ya = Math.min(Math.max(y0, 0), h - 1), yb = Math.min(Math.max(y0 + 1, 0), h - 1)
    const px = (x, y, c) => rgb[(y * w + x) * 3 + c]
    return [0, 1, 2].map(c => {
        const top = px(xa, ya, c) * (1 - fx) + px(xb, ya, c) * fx, bot = px(xa, yb, c) * (1 - fx) + px(xb, yb, c) * fx
        return Math.max(0, top * (1 - fy) + bot * fy)
    })
}

/**
 * A Radiance .hdr's pixels: { width, height, rgb } -- rgb Float32, three a pixel, top row first, in the file's own units.
 * Reads the header (FORMAT 32-bit_rle_rgbe, an EXPOSURE it divides by), the usual orientation only (-Y h +X w: every
 * HDRI made this century), and both row forms: the "new" run-length one and flat. Throws, saying why, for anything else.
 */
export function parseHDR(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    let i = 0
    const line = () => {
        let s = ''
        while (i < b.length && b[i] !== 10) s += String.fromCharCode(b[i++])
        i++
        return s
    }
    const first = line()
    if (!/^#\?(RADIANCE|RGBE)/.test(first)) throw new Error('not a Radiance HDR file (no #?RADIANCE header)')
    let exposure = 1
    for (let l = line(); l !== ''; l = line()) {
        if (i >= b.length) throw new Error('the header has no end')
        const m = /^FORMAT=(.*)$/.exec(l)
        if (m && m[1].trim() !== '32-bit_rle_rgbe') throw new Error(`format ${m[1].trim()} is not read: only 32-bit_rle_rgbe`)
        const e = /^EXPOSURE=\s*([0-9.eE+-]+)/.exec(l)
        if (e && +e[1] > 0) exposure *= +e[1]
    }
    const res = /^-Y\s+(\d+)\s+\+X\s+(\d+)\s*$/.exec(line())
    if (!res) throw new Error('only the usual orientation (-Y height +X width) is read')
    const h = +res[1], w = +res[2]
    if (!(w > 0 && h > 0)) throw new Error('an empty picture')
    const rgb = new Float32Array(w * h * 3)
    const row = new Uint8Array(w * 4)
    for (let y = 0; y < h; y++) {
        if (i + 4 > b.length) throw new Error(`the file ends at row ${y} of ${h}`)
        if (w >= 8 && w <= 0x7fff && b[i] === 2 && b[i + 1] === 2 && ((b[i + 2] << 8) | b[i + 3]) === w) {
            i += 4
            for (let c = 0; c < 4; c++) {
                for (let x = 0; x < w;) {
                    if (i >= b.length) throw new Error(`the file ends in row ${y}`)
                    let n = b[i++]
                    if (n > 128) {
                        n -= 128
                        if (x + n > w) throw new Error(`a run past the end of row ${y}`)
                        const v = b[i++]
                        for (let k = 0; k < n; k++) row[(x++) * 4 + c] = v
                    } else {
                        if (n === 0 || x + n > w) throw new Error(`a bad copy in row ${y}`)
                        for (let k = 0; k < n; k++) row[(x++) * 4 + c] = b[i++]
                    }
                }
            }
        } else {
            if (i + w * 4 > b.length) throw new Error(`the file ends in row ${y}`)
            row.set(b.subarray(i, i + w * 4)); i += w * 4
        }
        for (let x = 0; x < w; x++) {
            const e = row[x * 4 + 3], o = (y * w + x) * 3
            const f = e ? 2 ** (e - 136) / exposure : 0
            rgb[o] = row[x * 4] * f; rgb[o + 1] = row[x * 4 + 1] * f; rgb[o + 2] = row[x * 4 + 2] * f
        }
    }
    return { width: w, height: h, rgb }
}

/** An sRGB-encoded byte as linear light (IEC 61966-2-1). */
const SRGB = new Float32Array(256).map((_, k) => { const c = k / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
/** 8-bit RGBA pixels, sRGB, as linear { width, height, rgb }. */
export const linearFromSRGB = ({ width, height, pixels }) => {
    const rgb = new Float32Array(width * height * 3)
    for (let i = 0, n = width * height; i < n; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = SRGB[pixels[i * 4 + c]]
    return { width, height, rgb }
}

/** A float as IEEE half bits, rounded to nearest; past 65504 infinity, below the smallest subnormal 0. */
export function toHalf(x) {
    const f = new Float32Array([x]), u = new Uint32Array(f.buffer)[0]
    const sign = (u >>> 16) & 0x8000, exp = (u >>> 23) & 0xff, man = u & 0x7fffff
    if (exp === 0xff) return sign | 0x7c00 | (man ? 0x200 : 0)
    const e = exp - 127 + 15
    if (e >= 0x1f) return sign | 0x7c00
    if (e <= 0) {
        if (e < -10) return sign
        const m = (man | 0x800000) >>> (1 - e)
        return sign | ((m + 0x1000) >>> 13)
    }
    const h = sign | (e << 10) | (man >>> 13)
    return h + ((man & 0x1000) ? 1 : 0)
}

/** A picture as the GPU keeps it: box-filtered to at most ENV_IMAGE_MAX_W across (and half that up), rgba16float --
 *  { width, height, data: Uint16Array of 4 halves a pixel }. */
export function envImageTexels(img, maxW = ENV_IMAGE_MAX_W) {
    const k = Math.max(1, Math.ceil(img.width / maxW))
    const w = Math.max(1, Math.floor(img.width / k)), h = Math.max(1, Math.floor(img.height / k))
    const data = new Uint16Array(w * h * 4)
    const one = toHalf(1)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const s = [0, 0, 0]
        for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) {
            const o = ((y * k + dy) * img.width + (x * k + dx)) * 3
            s[0] += img.rgb[o]; s[1] += img.rgb[o + 1]; s[2] += img.rgb[o + 2]
        }
        const o = (y * w + x) * 4
        for (let c = 0; c < 3; c++) data[o + c] = toHalf(Math.min(s[c] / (k * k), 65504))
        data[o + 3] = one
    }
    return { width: w, height: h, data }
}
