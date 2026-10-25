// node lib/pathtracer/test/grade.test.mjs
//
// THE DARKROOM'S LIGHT TOOLS AS NUMBERS (lib/pathtracer/darkroom/grade.js, 0.next), no GPU: the white balance takes the
// chosen white to D65 (Bradford, exactly) and is the identity at its defaults; the eyedropper on a lamp's colour reads
// the lamp's temperature, and the patch it was taken from comes out neutral; the gains on their channels; the
// equaliser's bands interpolated and held; Oklab there and back, saturation and hue at 0 nothing, chroma scaled by
// 1 + s, lightness kept, vibrance reaching low chroma; curve 7 at its defaults the fixed Hable curve; which stages a
// setting switches on. Whether the picture LOOKS better is the user's to say.
import { WB_DEFAULT, LIGHT_DEFAULTS, EQ_KEYS, whiteXy, whiteBalanceMatrix, whiteFromRGB, eqGain, oklab, fromOklab, labAdjust,
         hableP, tone7, lightUniforms, lightIdentity, lightStages, LIGHT_ANY, LIGHT_WB, LIGHT_EQ, LIGHT_LAB } from '../darkroom/grade.js'
import { rgbToXYZ, XYZtoxy, xyToXYZ, rgbFromXy, cctDuvToXy, xyToCctDuv } from '../core/colorimetry.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b))
const apply = (m, v) => m.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2])

//----------------------------------------------------------------------------------------------------------------------
// white balance
//----------------------------------------------------------------------------------------------------------------------
{
    const d65 = xyToCctDuv(...XYZtoxy(rgbToXYZ([1, 1, 1])))        // Rec.709's own white, as the matrix has it
    ok('the defaults are where Rec.709\'s white sits: 6506 K, Duv 0.0033', WB_DEFAULT.temp === Math.round(d65.cct) && WB_DEFAULT.temp === 6506
        && near(WB_DEFAULT.duv, d65.duv) && near(d65.duv, 0.0033, 0.02), JSON.stringify(WB_DEFAULT))
    for (const [T, tint] of [[3000, 0], [2700, 5], [9000, -4]]) {
        const m = whiteBalanceMatrix(T, tint)
        // the white's own colour, at luminance 1, in Rec.709: it must come out D65's white, (1, 1, 1)
        const w = rgbFromXy(...whiteXy(T, tint)).map(c => c / rgbToXYZ(rgbFromXy(...whiteXy(T, tint)))[1])
        const out = apply(m, w)
        ok(`white balance at ${T} K, tint ${tint}: that light comes out white (1, 1, 1), its luminance kept`, out.every(c => near(c, 1, 1e-9)),
            out.map(c => c.toFixed(6)).join())
    }
    const m = whiteBalanceMatrix(3000)
    const xy = XYZtoxy(rgbToXYZ(apply(m, rgbFromXy(0.40, 0.45))))
    ok('...and another colour moved the way a 3000 K white moves it: bluer', xy[0] < 0.40 && xy[1] < 0.45, xy.join())
    const g = whiteBalanceMatrix(WB_DEFAULT.temp, 0, [2, 1, 0.5])
    ok('the gains multiply the rows of red, green and blue', near(apply(g, [1, 1, 1])[0], 2 * apply(whiteBalanceMatrix(WB_DEFAULT.temp), [1, 1, 1])[0])
        && near(apply(g, [1, 1, 1])[2], 0.5 * apply(whiteBalanceMatrix(WB_DEFAULT.temp), [1, 1, 1])[2]))
    // the eyedropper
    const lamp = rgbFromXy(...cctDuvToXy(3000, 0)).map(c => c * 40)       // a 3000 K lamp's light on a white wall, 40 cd/m^2-ish
    const w = whiteFromRGB(lamp)
    ok('the eyedropper on a 3000 K wall reads 3000 K and the tint that puts it on the locus', w.temp === 3000 && Math.abs(w.tint + WB_DEFAULT.duv * 1000) <= 0.05,
        JSON.stringify(w))
    const out = apply(whiteBalanceMatrix(w.temp, w.tint), lamp)
    ok('...and white balanced by what it read, the wall is neutral', Math.max(...out) / Math.min(...out) < 1.003, out.join())
    ok('the eyedropper refuses black, a negative channel, a colour off the locus\'s range', whiteFromRGB([0, 0, 0]).error && whiteFromRGB([1, -0.1, 1]).error
        && whiteFromRGB([0, 0, 1]).error, JSON.stringify([whiteFromRGB([0, 0, 0]), whiteFromRGB([1, -0.1, 1]), whiteFromRGB([0, 0, 1])]))
}

//----------------------------------------------------------------------------------------------------------------------
// the equaliser, Oklab, curve 7
//----------------------------------------------------------------------------------------------------------------------
{
    const b = [1, 2, 3, 4, 5, 6, 7, 8]
    ok('eqGain at a band: that band', eqGain(b, -7) === 1 && eqGain(b, -3) === 5 && eqGain(b, 0) === 8)
    ok('...between two: interpolated', near(eqGain(b, -2.25), 5.75))
    ok('...beyond the ends: held', eqGain(b, -20) === 1 && eqGain(b, 3) === 8)
}
{
    let worst = 0
    for (const c of [[0.2, 0.5, 0.9], [3, 0.01, 0.4], [0.5, 0.5, 0.5], [1.2, -0.1, 0.3], [1e-4, 2e-4, 5e-5]]) {
        const back = fromOklab(oklab(c))
        worst = Math.max(worst, ...back.map((v, i) => Math.abs(v - c[i]) / Math.max(1e-6, Math.abs(c[i]))))
    }
    ok('Oklab there and back: the colour, a negative channel included', worst < 1e-6, `${worst}`)
    ok('...white is grey in it: a = b = 0, L = 1 at 1.0', oklab([1, 1, 1]).every((v, i) => near(v, i ? 0 : 1, 1e-6)))
    const c = [0.6, 0.2, 0.1]
    ok('saturation, vibrance and hue at 0: the colour as it was', labAdjust(c, 0, 0, 0).every((v, i) => near(v, c[i], 1e-7)))
    const [L, a, bb] = oklab(c), s = oklab(labAdjust(c, 0.5, 0, 0))
    ok('saturation 0.5: chroma x 1.5, lightness and hue kept', near(s[0], L, 1e-6) && near(Math.hypot(s[1], s[2]), 1.5 * Math.hypot(a, bb), 1e-6)
        && near(Math.atan2(s[2], s[1]), Math.atan2(bb, a), 1e-6))
    const h = oklab(labAdjust(c, 0, 0, Math.PI / 2))
    ok('hue 90 degrees: turned, chroma and lightness kept', near(h[0], L, 1e-6) && near(Math.atan2(h[2], h[1]) - Math.atan2(bb, a), Math.PI / 2, 1e-6)
        && near(Math.hypot(h[1], h[2]), Math.hypot(a, bb), 1e-6))
    const dull = [0.5, 0.48, 0.46], vivid = [0.9, 0.1, 0.05]
    const gain = (x, k) => Math.hypot(...oklab(labAdjust(x, 0, k, 0)).slice(1)) / Math.hypot(...oklab(x).slice(1))
    ok('vibrance: a dull colour raised more than a vivid one, which it leaves alone', gain(dull, 0.5) > 1.4 && near(gain(vivid, 0.5), 1, 1e-6),
        `${gain(dull, 0.5)} ${gain(vivid, 0.5)}`)
    ok('...and the same at any brightness (relative to lightness)', near(gain(dull.map(v => v * 1000), 0.5), gain(dull, 0.5), 1e-6))
}
{
    const hable = x => { const sh = 0.15, li = 0.50, la = 0.10, to = 0.20, tn = 0.02, td = 0.30; return (x * (sh * x + la * li) + to * tn) / (x * (sh * x + li) + to * td) - tn / td }
    const d = LIGHT_DEFAULTS
    ok('curve 7 at its defaults is curve 6, hable(2c) / hable(11.2), as toneHable writes it',
        [0, 0.01, 0.18, 1, 4, 11.2 / 2].every(x => near(tone7(x, 2 ** d.tcWhite, d.tcToe, d.tcShoulder), hable(2 * x) / hable(11.2), 1e-12)))
    ok('...its white comes out at 1', near(tone7(3, 3, 0.3, 0.4), 1))
    ok('hableP with Hable\'s own toe and shoulder is his curve', near(hableP(2.5, 0.15, 0.20), hable(2.5)))
}

//----------------------------------------------------------------------------------------------------------------------
// the uniforms: what a setting switches on
//----------------------------------------------------------------------------------------------------------------------
{
    const u = lightUniforms(LIGHT_DEFAULTS)
    ok('at the defaults nothing is on, the matrix the identity', u.lightOn === 0 && u.wb.join() === '1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1' && lightIdentity(LIGHT_DEFAULTS))
    ok('a settings object without the light tools reads as the defaults', lightUniforms({}).lightOn === 0)
    ok('white balance on', lightUniforms({ ...LIGHT_DEFAULTS, wbTemp: 3000 }).lightOn === (LIGHT_ANY | LIGHT_WB))
    ok('...a tint alone, a gain alone', lightUniforms({ ...LIGHT_DEFAULTS, wbTint: 1 }).lightOn === (LIGHT_ANY | LIGHT_WB)
        && lightUniforms({ ...LIGHT_DEFAULTS, gainB: 1.1 }).lightOn === (LIGHT_ANY | LIGHT_WB))
    ok('one band of the equaliser', lightUniforms({ ...LIGHT_DEFAULTS, eq3: 0.5 }).lightOn === (LIGHT_ANY | LIGHT_EQ))
    ok('vibrance', lightUniforms({ ...LIGHT_DEFAULTS, labVib: 0.2 }).lightOn === (LIGHT_ANY | LIGHT_LAB))
    ok('curve 7 alone: on, no stage', lightUniforms({ ...LIGHT_DEFAULTS, toneMap: 7 }).lightOn === LIGHT_ANY)
    ok('any other curve: off', [0, 1, 2, 3, 4, 5, 6].every(t => lightUniforms({ ...LIGHT_DEFAULTS, toneMap: t }).lightOn === 0))
    const w = lightUniforms({ ...LIGHT_DEFAULTS, wbTemp: 3000, gainR: 1.2 })
    const m = whiteBalanceMatrix(3000, 0, [1.2, 1, 1])
    ok('the matrix in WGSL\'s column order: column j holds row values m[0..2][j]', [0, 1, 2].every(j => [0, 1, 2].every(i => near(w.wb[j * 4 + i], m[i][j]))) && w.wb[15] === 1)
    ok('the bands, Oklab\'s (hue in radians) and curve 7\'s', lightUniforms({ ...LIGHT_DEFAULTS, eq0: 1, eq7: -1 }).eqLo[0] === 1
        && lightUniforms({ ...LIGHT_DEFAULTS, eq0: 1, eq7: -1 }).eqHi[3] === -1 && near(lightUniforms({ ...LIGHT_DEFAULTS, labHue: 90 }).lab[2], Math.PI / 2)
        && near(lightUniforms(LIGHT_DEFAULTS).tone7[0], 5.6, 1e-12))
    ok('EQ_KEYS are the 8 bands', EQ_KEYS.length === 8 && EQ_KEYS.every(k => k in LIGHT_DEFAULTS))
    const c = [0.3, 0.2, 0.1]
    ok('lightStages at the defaults: the colour untouched', lightStages(c, LIGHT_DEFAULTS).every((v, i) => v === c[i]))
    const e = lightStages([0.01, 0.01, 0.01], { ...LIGHT_DEFAULTS, ...Object.fromEntries(EQ_KEYS.map(k => [k, 1])) })
    ok('...every band +1 stop: doubled', e.every(v => near(v, 0.02)))
    ok('XYZ helpers agree (a sanity check of the import)', near(rgbToXYZ([1, 1, 1])[1], 1, 1e-9) && near(xyToXYZ(0.3127, 0.329, 1)[1], 1))
}

console.log(`grade: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
