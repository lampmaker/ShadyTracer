// node lib/pathtracer/test/darkroom.test.mjs
//
// THE DARKROOM'S VIEWER, AS NUMBERS (lib/pathtracer/darkroom/view.js and histogram.js, 0.next). No GPU, no DOM.
// What it checks: Fit shows the whole picture with its shape kept; a zoom about a point keeps the picture point under
// that point where it was (a wheel turned over a detail zooms into the detail); a pan moves the picture with the hand;
// the view stays on the picture and inside its zoom limits; the pixel under a point read back through the uniform the
// develop pass takes, the y flip included; the zoom steps and labels; the histogram's scale and its line. What the
// viewer LOOKS like, and whether a pixel at 400 % is a square, only the user's screen can say.
import { viewFit, viewAt, fitZoom, zoomMin, clampView, zoomAt, stepZoom, panBy, pictureAt, pictureAtPoint, toUniform,
         fromCss, imageXY, zoomLabel, ZOOM_MAX, ZOOM_STEPS } from '../darkroom/view.js'
import { histogramPeak, histogramLine } from '../darkroom/histogram.js'
import { HIST_BINS } from '../core/rendertoscreen.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b))

/* what the develop pass does with `view` (core/rendertoscreen.js develop_prog): the footprint's centre of output pixel o,
   y up -- the uniform's numbers, not view.js's own, so a view and its uniform cannot disagree unseen */
const shaderCentre = (u, o, res) => [u[0] + (o[0] - 0.5 * res[0]) * u[2], u[1] + (o[1] - 0.5 * res[1]) * u[3]]

//----------------------------------------------------------------------------------------------------------------------
// Fit
//----------------------------------------------------------------------------------------------------------------------
{
    const src = [3840, 2160], res = [1600, 1200]
    const v = viewFit(src, res)
    ok('Fit: a wide picture fits the width, centred, following the output', near(v.z, 1600 / 3840) && v.cx === 1920 && v.cy === 1080 && v.fit)
    const u = toUniform(v)
    const left = shaderCentre(u, [0.5, 600], res), right = shaderCentre(u, [1599.5, 600], res)
    ok('...its first and last output columns on the picture\'s first and last', left[0] > 0 && left[0] < 3 && right[0] < 3840 && right[0] > 3837,
        `${left[0]} ${right[0]}`)
    const top = shaderCentre(u, [800, 1199.5], res)
    ok('...and its shape kept: above the picture is backdrop (the centre past its top)', top[1] >= 2160, `${top[1]}`)
    ok('a tall picture fits the height', near(fitZoom([1000, 4000], [800, 800]), 0.2))
    ok('a picture smaller than the output: Fit enlarges it', near(fitZoom([320, 200], [1600, 1000]), 5))
    ok('the least zoom: a quarter of the fit, or of 100 % for a small picture',
        near(zoomMin([3840, 2160], [1600, 1200]), 1600 / 3840 / 4) && near(zoomMin([320, 200], [1600, 1000]), 0.25))
}

//----------------------------------------------------------------------------------------------------------------------
// zoom about a point, pan, clamp
//----------------------------------------------------------------------------------------------------------------------
{
    const src = [2000, 1000], res = [1000, 800]
    const v0 = viewFit(src, res)
    const o = [730, 210]
    const before = pictureAtPoint(v0, o, res)
    const v1 = zoomAt(v0, 3.7, o, res, src)
    const after = pictureAtPoint(v1, o, res)
    ok('a zoom about a point keeps the picture point under it', near(before[0], after[0]) && near(before[1], after[1]),
        `${before} -> ${after}`)
    ok('...and leaves Fit', !v1.fit && near(v1.z, v0.z * 3.7))
    const sc = shaderCentre(toUniform(v1), o, res)
    ok('...the develop pass seeing the same point there', near(sc[0], after[0]) && near(sc[1], after[1]))

    const v2 = panBy(v1, [40, -25], res, src)
    const moved = pictureAtPoint(v2, [o[0] + 40, o[1] - 25], res)
    ok('a pan moves the picture with the hand: the point dragged is under the cursor\'s new place',
        near(moved[0], after[0]) && near(moved[1], after[1]))

    const far = clampView({ cx: -500, cy: 5000, z: 1e6, fit: true }, src, res)
    ok('clamped: the centre stays on the picture, the zoom at most the maximum, Fit kept as it was',
        far.cx === 0 && far.cy === 1000 && far.z === ZOOM_MAX && far.fit)
    ok('...and at least the minimum', clampView({ cx: 0, cy: 0, z: 1e-9 }, src, res).z === zoomMin(src, res))
    const lots = Array.from({ length: 60 }).reduce(v => zoomAt(v, 1.5, o, res, src), v0)
    ok('a wheel turned in for ever stops at the maximum', lots.z === ZOOM_MAX)
    const out = Array.from({ length: 60 }).reduce(v => zoomAt(v, 1 / 1.5, o, res, src), v0)
    ok('...and out for ever at the minimum', near(out.z, zoomMin(src, res)))
}

//----------------------------------------------------------------------------------------------------------------------
// the pixel under a point, through the uniform
//----------------------------------------------------------------------------------------------------------------------
{
    const src = [640, 480], res = [1280, 960]
    const v = viewAt(src, res, 4, [100.25, 400.75])            // 400 %: a picture pixel is 4 x 4 output pixels
    const c = pictureAt(v, [res[0] / 2, res[1] / 2], res, src)
    ok('at 400 %, the pixel at the centre is the one the centre is in', c[0] === 100 && c[1] === 400, `${c}`)
    // the 4 output pixels across picture pixel 100, whose left edge is a quarter of a picture pixel (one output pixel)
    // left of the output's middle, a pixel boundary: the shader's centre floors to it for each (the nearest pixel)
    const u = toUniform(v)
    const xs = [-0.5, 0.5, 1.5, 2.5].map(dx => Math.floor(shaderCentre(u, [res[0] / 2 + dx, res[1] / 2], res)[0]))
    ok('...and every output pixel the shader draws over it shows that one pixel: a square, not a blur',
        xs.join() === '100,100,100,100', xs.join())
    ok('off the picture: none', pictureAt(viewAt(src, res, 1, [0, 0]), [10, 10], res, src) === null)
    const css = fromCss(30, 10, 480, 2)
    ok('a mouse 10 CSS px from the top of a 480 px stage at DPR 2: device pixels, y up', css[0] === 60 && css[1] === 940)
    ok('a buffer pixel numbered as an image editor numbers it: row 0 of the buffer is the bottom', imageXY([5, 0], src).join() === '5,479'
        && imageXY([5, 479], src).join() === '5,0')
}

//----------------------------------------------------------------------------------------------------------------------
// the steps and the label
//----------------------------------------------------------------------------------------------------------------------
{
    const src = [4000, 3000], res = [1000, 750]
    const at = z => ({ cx: 2000, cy: 1500, z, fit: false })
    ok('+ from 100 %: 150 %', near(stepZoom(at(1), 1, res, src).z, 1.5))
    ok('- from 100 %: 2/3', near(stepZoom(at(1), -1, res, src).z, 2 / 3))
    ok('+ from between steps: the next step up, not a step skipped', near(stepZoom(at(1.2), 1, res, src).z, 1.5))
    ok('+ at the top stays there', stepZoom(at(64), 1, res, src).z === ZOOM_MAX)
    ok('the steps run in order', ZOOM_STEPS.every((s, i) => i === 0 || s > ZOOM_STEPS[i - 1]))
    ok('labels: 100 %, 12.5 %, 6.25 %, 6400 %', zoomLabel(1) === '100 %' && zoomLabel(1 / 8) === '12.5 %' && zoomLabel(1 / 16) === '6.25 %'
        && zoomLabel(64) === '6400 %', [1, 1 / 8, 1 / 16, 64].map(zoomLabel).join(' | '))
}

//----------------------------------------------------------------------------------------------------------------------
// the histogram drawn
//----------------------------------------------------------------------------------------------------------------------
{
    const bins = new Uint32Array(4 * HIST_BINS)
    bins[3 * HIST_BINS] = 1e6                    // a black background
    bins[3 * HIST_BINS + 128] = 50
    bins[2 * HIST_BINS + 40] = 70
    bins[HIST_BINS - 1] = 1e5                    // red clipped
    ok('the scale leaves out both ends: a black background does not flatten the rest', histogramPeak(bins) === 70)
    ok('...and is never 0', histogramPeak(new Uint32Array(4 * HIST_BINS)) === 1)
    const line = histogramLine(bins)
    ok('the line says the share at white and at black (luma)', /white 0 %/.test(line) && /black 100\.0 %/.test(line), line)
    ok('nothing counted, nothing said', histogramLine(new Uint32Array(4 * HIST_BINS)) === '')
}

console.log(`darkroom: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
