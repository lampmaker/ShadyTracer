//======================================================================================================================
// THE DARKROOM'S HISTOGRAM, DRAWN (0.next) -- what develop.js's histogram() counted, as a picture and one line.
//
// 4 x 256 bins: R, G, B and the luma of the encoded values (core/rendertoscreen.js develop_histogram_prog). The luma
// is drawn as a grey area, the three channels over it as light added on black (so where they agree they make white,
// as an image editor's do). The height is scaled to the tallest bin LEAVING OUT THE TWO ENDS: a black background or a
// blown sky is one bin that would otherwise flatten everything else to a line -- the line under it says what they hold.
//======================================================================================================================

import { HIST_BINS } from '../core/rendertoscreen.js'
import { clipShares } from '../develop.js'

/** The height the bars are scaled to: the tallest of R, G, B and luma, bins 1..254. Never 0. */
export function histogramPeak(bins) {
    let m = 0
    for (let c = 0; c < 4; c++)
        for (let i = 1; i < HIST_BINS - 1; i++) m = Math.max(m, bins[c * HIST_BINS + i])
    return Math.max(1, m)
}

/** The line under it: how much of the picture is at white and at black. */
export function histogramLine(bins) {
    const { white, black, pixels } = clipShares(bins)
    if (!pixels) return ''
    const pc = x => x === 0 ? '0' : x < 0.001 ? '< 0.1' : (x * 100).toFixed(1)
    return `white ${pc(white)} % · black ${pc(black)} %`
}

/** Draw `bins` into a 2D canvas, or clear it when there are none. */
export function drawHistogram(canvas, bins) {
    const g = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    g.globalCompositeOperation = 'source-over'
    g.fillStyle = '#111'
    g.fillRect(0, 0, W, H)
    if (!bins) return
    const peak = histogramPeak(bins)
    const bar = (c, style) => {
        g.fillStyle = style
        g.beginPath()
        g.moveTo(0, H)
        for (let i = 0; i < HIST_BINS; i++) {
            const h = Math.min(1, bins[c * HIST_BINS + i] / peak) * (H - 2)
            g.lineTo(i / (HIST_BINS - 1) * W, H - h)
        }
        g.lineTo(W, H)
        g.closePath()
        g.fill()
    }
    bar(3, 'rgba(160, 160, 160, 0.55)')
    g.globalCompositeOperation = 'lighter'
    bar(0, 'rgba(200, 40, 40, 0.75)')
    bar(1, 'rgba(40, 180, 40, 0.75)')
    bar(2, 'rgba(50, 80, 220, 0.75)')
    g.globalCompositeOperation = 'source-over'
}
