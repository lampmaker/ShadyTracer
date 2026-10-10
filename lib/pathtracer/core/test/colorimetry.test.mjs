// node lib/pathtracer/core/test/colorimetry.test.mjs
//
// core/colorimetry.js against published values: the Planckian locus (CIE 15 / the blackbody xy the
// literature tabulates), D65 and illuminant A as CCT + Duv, and round trips.
import { RGB709_TO_XYZ, XYZ_TO_RGB709, rgbToXYZ, XYZtoRGB, xyToXYZ, XYZtoxy, xyToUv, uvToXy, xyToUpVp,
         planckXy, cctDuvToXy, xyToCctDuv, rgbFromXy, gamutClip, mixToTarget } from '../colorimetry.js'
import { LUMA } from '../photometry.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol

{
    const I = RGB709_TO_XYZ.map(r => [0, 1, 2].map(j => r[0] * XYZ_TO_RGB709[0][j] + r[1] * XYZ_TO_RGB709[1][j] + r[2] * XYZ_TO_RGB709[2][j]))
    ok('the two matrices are inverses', I.every((r, i) => r.every((v, j) => near(v, i === j ? 1 : 0, 1e-12))))
    ok('the Y row is LUMA exactly', RGB709_TO_XYZ[1].every((v, i) => v === LUMA[i]))
    const w = XYZtoxy(rgbToXYZ([1, 1, 1]))
    ok('RGB white is D65 (0.3127, 0.3290)', near(w[0], 0.3127, 2e-4) && near(w[1], 0.3290, 2e-4), `${w}`)
    ok('xy -> XYZ -> xy', (([x, y]) => near(x, 0.45, 1e-12) && near(y, 0.41, 1e-12))(XYZtoxy(xyToXYZ(0.45, 0.41, 7))))
    ok('xyY keeps Y', xyToXYZ(0.3, 0.3, 42)[1] === 42)
    const [u, v] = xyToUv(0.3127, 0.3290)
    ok('D65 in 1960 uv (0.1978, 0.3122)', near(u, 0.1978, 1e-4) && near(v, 0.3122, 1e-4), `${u} ${v}`)
    ok('uv -> xy round trip', (([x, y]) => near(x, 0.3127, 1e-12) && near(y, 0.3290, 1e-12))(uvToXy(u, v)))
    ok("u'v' is v scaled by 1.5", near(xyToUpVp(0.3127, 0.3290)[1], 1.5 * v, 1e-15))
}
{
    // the blackbody locus, xy (CIE 2-degree observer)
    const REF = [[2000, 0.5267, 0.4133], [2856, 0.4476, 0.4074], [3000, 0.4369, 0.4041], [4000, 0.3805, 0.3768],
                 [5000, 0.3451, 0.3516], [6500, 0.3135, 0.3236], [10000, 0.2807, 0.2884]]
    let worst = 0
    for (const [T, x, y] of REF) { const p = planckXy(T); worst = Math.max(worst, Math.hypot(p[0] - x, p[1] - y)) }
    ok('Planckian locus within 5e-4 of the tabulated blackbody xy', worst < 5e-4, `worst ${worst}`)
    ok('Duv 0 is the locus itself', (([x, y]) => near(x, planckXy(4000)[0], 1e-12) && near(y, planckXy(4000)[1], 1e-12))(cctDuvToXy(4000, 0)))
    // the offset is perpendicular and of the size asked, in 1960 uv
    const p0 = xyToUv(...planckXy(4000)), p1 = xyToUv(...cctDuvToXy(4000, 0.01))
    ok('a Duv of 0.01 is 0.01 away in 1960 uv', near(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), 0.01, 1e-9))
    ok('positive Duv is above the locus (larger v, towards green)', p1[1] > p0[1])
}
{
    // CCT and Duv back from xy
    const A = xyToCctDuv(0.44757, 0.40745)
    ok('illuminant A: 2856 K, on the locus', near(A.cct, 2856, 6) && near(A.duv, 0, 5e-4), JSON.stringify(A))
    const D = xyToCctDuv(0.3127, 0.3290)
    ok('D65: 6504 K, Duv +0.0032', near(D.cct, 6504, 15) && near(D.duv, 0.0032, 3e-4), JSON.stringify(D))
    let worst = 0
    for (const T of [1800, 2700, 3000, 4000, 5700, 6500, 9000]) for (const duv of [-0.02, -0.006, 0, 0.006, 0.02]) {
        const r = xyToCctDuv(...cctDuvToXy(T, duv))
        worst = Math.max(worst, Math.abs(r.cct - T) / T, Math.abs(r.duv - duv))
    }
    ok('CCT + Duv -> xy -> CCT + Duv, 1800-9000 K, Duv to +-0.02', worst < 1e-5, `worst ${worst}`)
    ok('past the locus\'s end: flagged', xyToCctDuv(0.15, 0.06).inRange === false)
}
{
    // exact RGB of a chromaticity, and the display clip
    const w = rgbFromXy(0.3127, 0.3290)
    ok('D65 is RGB white, luminance 1', w.every(c => near(c, 1, 2e-3)), `${w}`)
    const blue = rgbFromXy(0.15, 0.025)                        // a royal-blue LED, outside Rec.709
    ok('a royal blue has a negative channel', Math.min(...blue) < 0, `${blue}`)
    ok('...and luminance 1', near(LUMA[0] * blue[0] + LUMA[1] * blue[1] + LUMA[2] * blue[2], 1, 1e-12))
    ok('...and XYZ back gives its xy exactly', (([x, y]) => near(x, 0.15, 1e-12) && near(y, 0.025, 1e-12))(XYZtoxy(rgbToXYZ(blue))))
    const c = gamutClip(blue)
    ok('clipped: no negative channel, luminance kept', Math.min(...c) >= 0
        && near(LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2], 1, 1e-12), `${c}`)
    ok('clip leaves an in-gamut colour alone', gamutClip([0.2, 0.5, 0.9]).every((v, i) => v === [0.2, 0.5, 0.9][i]))
    // LINEARITY, which the hybrid rests on: mixing exact RGBs and converting is mixing XYZs
    const mix = [0, 1, 2].map(i => 3 * rgbFromXy(0.69, 0.3)[i] + 5 * blue[i])
    const X = rgbToXYZ(mix), X2 = [0, 1, 2].map(i => xyToXYZ(0.69, 0.3, 3)[i] + xyToXYZ(0.15, 0.025, 5)[i])
    ok('mixing in exact RGB is mixing in XYZ', X.every((v, i) => near(v, X2[i], 1e-9)))
    ok('XYZ -> RGB -> XYZ', rgbToXYZ(XYZtoRGB([0.3, 0.5, 0.2])).every((v, i) => near(v, [0.3, 0.5, 0.2][i], 1e-12)))
}

{
    // MIXING: the user's luminaire (red, green, blue LEDs as xy) to 4000 K at 1000 lm
    const P = [[0.69, 0.3], [0.205, 0.7], [0.15, 0.025]], T = planckXy(4000)
    const m = mixToTarget(P, T, 1000)
    ok('mix: reachable, fluxes sum to the total', m.reachable && near(m.flux[0] + m.flux[1] + m.flux[2], 1000, 1e-9), `${m.flux}`)
    const sum = [0, 1, 2].map(k => P.reduce((a, p, i) => a + xyToXYZ(p[0], p[1], m.flux[i])[k], 0))
    ok('mix: the sum has the target chromaticity', (([x, y]) => near(x, T[0], 1e-12) && near(y, T[1], 1e-12))(XYZtoxy(sum)))
    ok("mix: the user's own tool's split (310 / 673 / 16.5 lm)", near(m.flux[0], 310.5, 0.1) && near(m.flux[1], 673.0, 0.1) && near(m.flux[2], 16.5, 0.1), `${m.flux}`)
    ok('mix: a target outside the triangle is unreachable', !mixToTarget(P, [0.08, 0.5], 1).reachable)
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
