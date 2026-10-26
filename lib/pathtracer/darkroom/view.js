//======================================================================================================================
// WHERE THE DARKROOM'S VIEWER LOOKS (0.next) -- pan and zoom over a kept picture, as numbers.
//
// The viewer (viewer.js) shows the kept render as large as its tab, the develop pass (core/rendertoscreen.js
// develop_prog) told where to look by four numbers: the picture point at the output's centre and the picture pixels
// one output pixel spans. This file is how a view is moved -- fitted, zoomed about the cursor, panned, clamped -- and
// read back (the picture pixel under a point), with no DOM and no GPU, so lib/pathtracer/test/darkroom.test.mjs runs
// all of it in node.
//
// TWO SPACES, BOTH Y UP, because the develop pass's are: the picture's pixels (row 0 the bottom, as the accumulation
// keeps them; pixel (x, y) covers [x, x+1) x [y, y+1)) and the output's DEVICE pixels (the canvas's backing store,
// y = 0 its bottom row: tinywebgpu's makeFrag hands frag a uv with y = 0 at the bottom). The viewer turns a mouse's CSS
// position into the second with fromCss; a readout turns a picture pixel into the top-left numbering image editors
// use with imageXY.
//
// A VIEW is { cx, cy, z, fit }: the centre in picture pixels, the zoom in output device pixels per picture pixel (1 is
// "100 %": one picture pixel on one screen pixel), and whether it follows the output's size (Fit) or stays put.
//======================================================================================================================

/** The zoom steps + and - walk, as the image editors do: halves and thirds below 1, whole numbers above. */
export const ZOOM_STEPS = [1 / 32, 1 / 16, 1 / 8, 1 / 6, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64]
export const ZOOM_MAX = 64

/** The zoom that shows the whole picture in the output, its shape kept. */
export const fitZoom = (src, res) => Math.min(res[0] / src[0], res[1] / src[1])

/** The least zoom allowed: a quarter of the fit, or of 100 % for a picture smaller than the output -- far enough out
 *  to see the picture in its surroundings, not so far it is a dot. */
export const zoomMin = (src, res) => Math.min(fitZoom(src, res), 1) / 4

/** The whole picture, centred, following the output's size. */
export const viewFit = (src, res) => ({ cx: src[0] / 2, cy: src[1] / 2, z: fitZoom(src, res), fit: true })

/** At zoom `z` (1 = 100 %), centred on a picture point (the picture's centre when none is given). */
export const viewAt = (src, res, z, centre = [src[0] / 2, src[1] / 2]) =>
    clampView({ cx: centre[0], cy: centre[1], z, fit: false }, src, res)

/** The zoom held to its limits and the centre to the picture: some of the picture always stays in view. */
export function clampView(v, src, res) {
    const z = Math.min(ZOOM_MAX, Math.max(zoomMin(src, res), v.z))
    return { cx: Math.min(src[0], Math.max(0, v.cx)), cy: Math.min(src[1], Math.max(0, v.cy)), z, fit: !!v.fit }
}

/** The picture point (continuous, picture pixels) under an output point `o` (device pixels, y up). */
export const pictureAtPoint = (v, o, res) => [v.cx + (o[0] - res[0] / 2) / v.z, v.cy + (o[1] - res[1] / 2) / v.z]

/** The picture pixel under an output point, [x, y] as the buffer numbers it (row 0 the bottom), or null off the picture. */
export function pictureAt(v, o, res, src) {
    const [x, y] = pictureAtPoint(v, o, res)
    return x >= 0 && y >= 0 && x < src[0] && y < src[1] ? [Math.floor(x), Math.floor(y)] : null
}

/** Zoom by `factor` keeping the picture point under `o` where it is -- a wheel turned over a detail zooms into that
 *  detail. Leaves Fit. */
export function zoomAt(v, factor, o, res, src) {
    const p = pictureAtPoint(v, o, res)
    const z = Math.min(ZOOM_MAX, Math.max(zoomMin(src, res), v.z * factor))
    return clampView({ cx: p[0] - (o[0] - res[0] / 2) / z, cy: p[1] - (o[1] - res[1] / 2) / z, z, fit: false }, src, res)
}

/** The next zoom step in (dir > 0) or out (dir < 0) from z, about the output's centre unless `o` is given. */
export function stepZoom(v, dir, res, src, o = [res[0] / 2, res[1] / 2]) {
    const eps = 1e-6
    const next = dir > 0 ? ZOOM_STEPS.find(s => s > v.z * (1 + eps)) ?? ZOOM_MAX
        : [...ZOOM_STEPS].reverse().find(s => s < v.z * (1 - eps)) ?? ZOOM_STEPS[0]
    return zoomAt(v, next / v.z, o, res, src)
}

/** Moved by `d` output device pixels (y up): the picture follows the hand that drags it. Leaves Fit. */
export const panBy = (v, d, res, src) => clampView({ cx: v.cx - d[0] / v.z, cy: v.cy - d[1] / v.z, z: v.z, fit: false }, src, res)

/** The develop pass's `view` uniform: [cx, cy, span, span], the span the picture pixels one output pixel covers. */
export const toUniform = v => [v.cx, v.cy, 1 / v.z, 1 / v.z]

/** A mouse's position in an element (CSS pixels from its top left) as the output's device pixels, y up. */
export const fromCss = (x, y, cssHeight, dpr = 1) => [x * dpr, (cssHeight - y) * dpr]

/** A buffer's pixel as an image editor numbers it: from the top left. */
export const imageXY = (p, src) => [p[0], src[1] - 1 - p[1]]

/** The zoom as a person reads it: "100 %", "12.5 %", "6.25 %". */
export function zoomLabel(z) {
    const pc = z * 100
    return `${pc >= 100 ? Math.round(pc) : +pc.toFixed(pc >= 10 ? 1 : 2)} %`
}
