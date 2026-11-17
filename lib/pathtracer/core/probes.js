//======================================================================================================================
// PROBES -- the renderer traced along rays the host gives, one a pixel, instead of a camera's (0.next).
//
// FOR THE PRINT EXPORT'S LIT COLOURS (builder/exportbox.js): the colour a point of the part has in the picture -- the
// light leaving it, as the renderer traces it, developed as the view develops it. A camera sees only what faces it, so
// each point gets a ray of its own: from just off the surface, straight at it. The light along that ray is what the
// surface sends back the way it faces: for a matte surface its whole look (the same every way); for a glossy one what
// it reflects straight out, a mirror's what is in front of it.
//
// HOW (genrays.js THE PROBES, camtype 2): pixel k's ray is probe k's, the same every sample, so the accumulation's
// pixel k is the running mean of the light along it. Everything else is the renderer's own: light sampling, the bounces,
// the materials. What the probes cannot have (PROBE_OVERRIDES):
//   - LIGHT TRACING AND THE LIGHTS' RAYS, which reach the picture by joining a photon to the camera -- through the
//     camera's footprint at the photon (materials_pbr.js camFootprint) and the pixel it projects to, neither of which
//     a list of rays has. Off, the camera's paths find every light's face themselves (raytrace_main.js ltLights 0): the
//     light is all there, with more noise in caustics. A light with no face (a ray file's) has only photons and is
//     missing.
//   - THE PHOTON MAP, which runs only for a perspective camera anyway (raytrace_main.js sppmWant).
//   - A FAST MODE: Draft, Sketch and Optics light the picture their own ways (quality.js); the probes are Final.
//
// PURE: numbers in, numbers out, tested in node; probes.gpu.mjs runs them through the renderer on Dawn.
//======================================================================================================================

/** The settings a render of probes traces with, over the user's (index.js buildUniforms). */
export const PROBE_OVERRIDES = Object.freeze({ lt: 0, lightRays: 0, renderMode: 0 })

/** The most probes one render takes: its picture's pixels, kept to a size every device allocates (an accumulation of
 *  16 bytes a pixel and a ray buffer beside it, as a 2048 x 2048 save). More are rendered in turn. */
export const PROBES_PER_RENDER = 2048 * 1024
/** The picture a render of `n` probes is: `w` across, as few rows as hold them, and `first` the pixel of probe 0.
 *  THE BOTTOM ROWS HOLD NO PROBE: the develop pass draws the false-colour view's legend over the bottom 2.5 % of the
 *  picture (rendertoscreen.js darkroomPixel, uv.y < 0.025), and the accumulation's row 0 is the picture's bottom. A
 *  probe there would come back the legend's colour; so the probes start `pad` rows up, a margin over that share. */
export function probePicture(n, maxW = 2048) {
    if (!(n >= 1)) throw new Error('no probes')
    const w = Math.min(maxW, Math.max(16, Math.ceil(Math.sqrt(n))))
    const rows = Math.ceil(n / w), pad = Math.ceil(0.04 * rows) + 2
    return { w, h: Math.max(16, rows + pad), first: pad * w }
}

/**
 * THE PROBES AS genrays READS THEM: 8 floats a pixel -- the origin and the direction, each a vec4 -- in metres.
 * @param points  where each probe looks: [[x, y, z], ...] or a flat Float32Array, in the scene's units
 * @param dirs    which way it looks, the same shape (any length; normalised here)
 * @param offset  how far back along its direction the ray starts, in the scene's units: off the surface, so the march
 *                meets it rather than starting on it
 * @param unit    metres per scene unit (photometry.js derive's sceneUnit): the engine is in metres
 * @param pixels  the picture's pixels: every one gets a ray, the ones not a probe's the first probe's
 * @param first   the pixel probe 0 is (probePicture's), the ones before it padding too
 */
export function probeRays(points, dirs, { offset = 0, unit = 1, pixels = null, first = 0 } = {}) {
    const get = (A, k) => A instanceof Float32Array || A instanceof Float64Array ? [A[3 * k], A[3 * k + 1], A[3 * k + 2]] : A[k]
    const n = points instanceof Float32Array || points instanceof Float64Array ? points.length / 3 : points.length
    if (!(n >= 1)) throw new Error('no probes')
    const total = Math.max(first + n, pixels ?? 0)
    const out = new Float32Array(8 * total)
    for (let k = 0; k < n; k++) {
        const p = get(points, k), d = get(dirs, k), j = first + k
        const l = Math.hypot(d[0], d[1], d[2])
        if (!(l > 0)) throw new Error(`probe ${k} has no direction`)
        for (let a = 0; a < 3; a++) {
            out[8 * j + a] = (p[a] - offset * d[a] / l) * unit
            out[8 * j + 4 + a] = d[a] / l
        }
    }
    for (let j = 0; j < total; j++) if (j < first || j >= first + n) out.copyWithin(8 * j, 8 * first, 8 * first + 8)
    return out
}

/** Probe k's place in a developed picture read top row first (develop.js developedRows), [column, row]: the
 *  accumulation's rows run from the bottom (genrays: pixel x + y w, y up), so pixel j = first + k is in row
 *  h - 1 - floor(j / w). */
export const probePlace = (k, { w, h, first }) => { const j = first + k; return [j % w, h - 1 - Math.floor(j / w)] }

/** THE PROBES' COLOURS: the render's accumulation (`from`, the picture `pic` of probePicture, `n` probes) developed in
 *  the darkroom `dr` (develop.js makeDarkroom: one of the caller's own) with the settings `view`, read back top row first
 *  and put back in the probes' order -- 3 floats a probe, in [0, 1] as the display encodes them. Into `out` at probe
 *  `at` when given. */
export async function developProbes(dr, { from, pic, n, view, samples = 0, out = null, at = 0 }) {
    const colour = out ?? new Float32Array(3 * n)
    await dr.keep({ from, w: pic.w, h: pic.h, view, samples })
    const byRow = new Map()
    for (let k = 0; k < n; k++) { const [x, y] = probePlace(k, pic); (byRow.get(y) ?? byRow.set(y, []).get(y)).push([k, x]) }
    await dr.developedRows(view, (rows, r0, k) => {
        for (let i = 0; i < k; i++) for (const [q, x] of byRow.get(r0 + i) ?? [])
            for (let a = 0; a < 3; a++) colour[3 * (at + q) + a] = rows[4 * (i * pic.w + x) + a]
    })
    return colour
}

/** THE VIEW'S LOOK FOR THE PROBES, ADJUSTED (0.next; the user: lit colours "dont really work. maybe a brightness/contrast
 *  setting"): `stops` brighter -- the EV down by as many, as the display's exposure works (photometry.js ev100ToScale:
 *  each EV halves the picture) -- and `contrast` added to the view's own, the display's mix about 0.5 of the encoded
 *  picture (rendertoscreen.js), held to its range -1 to 1. A copy; the view is left as it is. */
export function probeView(view, look = null) {
    const stops = +look?.stops || 0, contrast = +look?.contrast || 0
    return { ...view, ev: view.ev - stops, contrast: Math.max(-1, Math.min(1, (+view.contrast || 0) + contrast)) }
}

/** How the probes' colours came out, for the export to say: their luminance (Rec.709 weights of the encoded values)
 *  at the 5th, 50th and 95th percentile, and how many are black (under 1/255) and white (over 254/255). */
export function colourSpread(colour) {
    const n = colour.length / 3
    if (!n) return null
    const Y = new Float32Array(n)
    for (let k = 0; k < n; k++) Y[k] = 0.2126 * colour[3 * k] + 0.7152 * colour[3 * k + 1] + 0.0722 * colour[3 * k + 2]
    const sorted = Float32Array.from(Y).sort()
    const at = q => sorted[Math.min(n - 1, Math.floor(q * n))]
    let black = 0, white = 0
    for (const y of Y) { if (y < 1 / 255) black++; else if (y > 254 / 255) white++ }
    return { p5: at(0.05), median: at(0.5), p95: at(0.95), black: black / n, white: white / n }
}

/** THE PICTURE'S COLOUR AT A POINT OF IT (viewColours, 0.next): `img` the developed picture, w x h, rgba top row first;
 *  x and y the kernel's [-1, 1] across and up (genrays.js projectPoint). Pixel (px, py) from the bottom covers
 *  [px, px + 1) x [py, py + 1) of uv * size (genrays: p = uv * res, rounded down), so its centre is at + 0.5; between
 *  centres, bilinear, held at the edges. [r, g, b]. */
export function viewSample(img, w, h, x, y) {
    const fx = Math.min(w - 1, Math.max(0, (x + 1) / 2 * w - 0.5)), fyb = Math.min(h - 1, Math.max(0, (y + 1) / 2 * h - 0.5))
    const x0 = Math.floor(fx), y0 = Math.floor(fyb), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1)
    const sx = fx - x0, sy = fyb - y0
    const at = (px, pyb, a) => img[4 * ((h - 1 - pyb) * w + px) + a]
    return [0, 1, 2].map(a => (1 - sx) * (1 - sy) * at(x0, y0, a) + sx * (1 - sy) * at(x1, y0, a) + (1 - sx) * sy * at(x0, y1, a) + sx * sy * at(x1, y1, a))
}

/* ALL AROUND (0.next; index.js viewsAround, the print export's "As lit, all around"). The user: a part lit from behind,
   whose back the view does not show, kept its material's colour there. So the part is rendered from several cameras round
   it, each a picture as the view makes one -- every light in it, the photon map and the lights' rays included -- and each
   point takes its colour from the camera that sees it most squarely. */
/** How many cameras, and where they look from: the cube's 6 faces, then its 8 corners, then its 12 edges. */
export const AROUND_COUNTS = [6, 14, 26]
export function aroundDirections(n) {
    if (!AROUND_COUNTS.includes(n)) throw new Error(`all around takes ${AROUND_COUNTS.join(', ')} views`)
    const out = []
    for (let a = 0; a < 3; a++) for (const s of [1, -1]) { const d = [0, 0, 0]; d[a] = s; out.push(d) }
    if (n >= 14) for (const x of [1, -1]) for (const y of [1, -1]) for (const z of [1, -1]) out.push([x, y, z].map(v => v / Math.sqrt(3)))
    if (n >= 26) for (let a = 0; a < 3; a++) for (const s of [1, -1]) for (const t of [1, -1]) {
        const d = [0, 0, 0]; d[(a + 1) % 3] = s / Math.SQRT2; d[(a + 2) % 3] = t / Math.SQRT2; out.push(d)
    }
    return out
}
/** The cameras round `points` (flat xyz, the scene's units): each { pos, target, up }, looking at the points' bounding
 *  box's centre from far enough that a cone of `fov` degrees (a square picture's) holds the sphere round every point,
 *  with a tenth to spare. Up is the scene's +z, or +y for a camera on the z axis. */
export function aroundViews(points, n, fov = 35) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
    for (let k = 0; k < points.length; k += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], points[k + a]); hi[a] = Math.max(hi[a], points[k + a]) }
    const c = [0, 1, 2].map(a => (lo[a] + hi[a]) / 2)
    let r = 0
    for (let k = 0; k < points.length; k += 3) r = Math.max(r, Math.hypot(points[k] - c[0], points[k + 1] - c[1], points[k + 2] - c[2]))
    const dist = 1.1 * Math.max(r, 1e-9) / Math.sin((fov / 2) * Math.PI / 180)
    return aroundDirections(n).map(d => ({
        pos: c.map((v, a) => v + d[a] * dist), target: c, up: Math.abs(d[2]) > 0.99 ? [0, 1, 0] : [0, 0, 1],
    }))
}
