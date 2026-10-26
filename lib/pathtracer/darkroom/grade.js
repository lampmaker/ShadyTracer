//======================================================================================================================
// THE DARKROOM'S LIGHT TOOLS (0.next) -- what is done to the light before the tone curve, as numbers.
//
// WHY ON THE LIGHT. The grading the develop pass had (contrast, saturation, brightness) acts on the encoded picture,
// after the tone curve has already decided what is white: there, a shadow lifted is a grey lifted, and a colour cast is
// baked in. A camera's raw tools act on the light, where a white balance is a change of illuminant, a shadow lifted is
// light multiplied, and a saturation is a property of the colour, not of its encoding. So these come between the
// exposure and the tone curve, in this order (core/rendertoscreen.js developPixel):
//
//   1. the exposure (as before: 1.0 is white)
//   2. WHITE BALANCE and GAINS, one matrix: diag(gains) . XYZ->RGB709 . Bradford(white -> D65) . RGB709->XYZ. The white
//      is the light that should look white -- a temperature and a tint (Duv x 1000, from where D65 itself sits, so
//      6506 K and 0 is D65: xyToCctDuv of Rec.709's white gives 6506 K, Duv 0.0033). A warm lamp's scene neutralised is the
//      white set to the lamp's temperature, as a camera does it.
//   3. the TONE EQUALISER: a gain in stops for each of 8 bands, -7 to 0 EV below white, interpolated in log2 of the
//      exposed luminance and held at its ends; applied to the three channels alike, so a hue is kept.
//   4. OKLAB (Bjorn Ottosson's, 2020): saturation scales chroma, vibrance scales it more where it is low (relative to
//      lightness, so the scale of the light does not matter), hue turns it. A sign-kept cube root, so a colour outside
//      the gamut (a negative channel, kept by the accumulation) goes through and back.
//   5. the gamut clip and the tone curve as before -- and a new one, number 7, HABLE ADJUSTABLE: John Hable's curve
//      with its white point, toe and shoulder the user's. At its defaults it is the fixed Hable curve (number 6).
//
// AN UNTOUCHED DEVELOP IS THE DISPLAY'S PICTURE, BIT FOR BIT: lightUniforms says which stages are on (lightOn, a bit
// each), and with none on and the curve not 7 the pass runs displayPixel itself. lib/pathtracer/test/develop.gpu.mjs
// holds developPixel at identity to displayPixel bit for bit, and each stage below to its WGSL.
//======================================================================================================================

import { curvesIdentity } from './curves.js'
import { RGB709_TO_XYZ, XYZ_TO_RGB709, cctDuvToXy, xyToCctDuv, xyToXYZ, rgbToXYZ, XYZtoxy, CCT_MIN, CCT_MAX } from '../core/colorimetry.js'

/* D65 AS THE RGB MATRIX HAS IT: Rec.709's white, (1, 1, 1), in xy -- 0.312716, 0.329001, not the rounded 0.3127, 0.3290,
   or a white balanced to "D65" comes out 0.02 % off grey (found by grade.test.mjs) */
const D65 = XYZtoxy(rgbToXYZ([1, 1, 1]))
const D65_CCT = xyToCctDuv(...D65)
/** Where D65 sits: 6506 K, Duv 0.0033. The white balance's defaults, and the tint's zero. */
export const WB_DEFAULT = { temp: Math.round(D65_CCT.cct), duv: D65_CCT.duv }

/** Every light tool's setting at its identity: what a picture untouched has (develop.js viewSettings spreads it). */
export const LIGHT_DEFAULTS = {
    wbTemp: WB_DEFAULT.temp, wbTint: 0, gainR: 1, gainG: 1, gainB: 1,
    eq0: 0, eq1: 0, eq2: 0, eq3: 0, eq4: 0, eq5: 0, eq6: 0, eq7: 0,
    labSat: 0, labVib: 0, labHue: 0,
    tcWhite: Math.log2(5.6), tcToe: 0.20, tcShoulder: 0.15,
    // the finished picture's tools (0.next, phase 4): FINISH below
    vigAmount: 0, vigMid: 0.5, vigRound: 0,
    transfer: 0, lvInBlack: 0, lvInWhite: 1, lvGamma: 1, lvOutBlack: 0, lvOutWhite: 1,
    liftX: 0, liftY: 0, liftM: 0, gammaX: 0, gammaY: 0, gammaM: 0, gainX: 0, gainY: 0, gainM: 0,
    grainAmount: 0, grainSize: 1.5, dither: false, curveLuma: false,
}
export const EQ_KEYS = ['eq0', 'eq1', 'eq2', 'eq3', 'eq4', 'eq5', 'eq6', 'eq7']
/** The band each equaliser key is: its stops below white. */
export const EQ_STOPS = [-7, -6, -5, -4, -3, -2, -1, 0]
/** lightOn's bits: something on (the develop pass then runs developPixel), and each stage. */
export const LIGHT_ANY = 1, LIGHT_WB = 2, LIGHT_EQ = 4, LIGHT_LAB = 8
export const LIGHT_LEVELS = 16, LIGHT_CURVES = 32, LIGHT_CDL = 64, LIGHT_VIGNETTE = 128, LIGHT_GRAIN = 256, LIGHT_DITHER = 512,
             LIGHT_CURVE_LUMA = 1024
/** The output transfers, by the setting's number: 0 the exact sRGB curve the display uses. */
export const TRANSFERS = { 'sRGB': 0, 'gamma 2.2': 1, 'gamma 2.4 (BT.1886)': 2, 'linear': 3 }

//----------------------------------------------------------------------------------------------------------------------
// white balance
//----------------------------------------------------------------------------------------------------------------------
const BRADFORD = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]]
const mul3 = (a, b) => a.map(r => [0, 1, 2].map(j => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]))
const apply3 = (m, v) => m.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2])
function inv3(m) {
    const [[a, b, c], [d, e, f], [g, h, i]] = m
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
    const det = a * A + b * B + c * C
    return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
            [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
            [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]]
}
const BRADFORD_INV = inv3(BRADFORD)

/** The white a temperature and tint name, as xy. */
export const whiteXy = (temp, tint) => cctDuvToXy(temp, WB_DEFAULT.duv + tint / 1000)

/** The 3 x 3 (rows) taking linear Rec.709 light lit by `white` to the same scene lit by D65, then the gains. */
export function whiteBalanceMatrix(temp, tint = 0, gains = [1, 1, 1]) {
    const src = apply3(BRADFORD, xyToXYZ(...whiteXy(temp, tint), 1))
    const dst = apply3(BRADFORD, xyToXYZ(...D65, 1))
    const scale = [[dst[0] / src[0], 0, 0], [0, dst[1] / src[1], 0], [0, 0, dst[2] / src[2]]]
    const adapt = mul3(BRADFORD_INV, mul3(scale, BRADFORD))
    const m = mul3(XYZ_TO_RGB709, mul3(adapt, RGB709_TO_XYZ))
    return m.map((r, i) => r.map(v => v * gains[i]))
}

/** THE EYEDROPPER: the temperature and tint that make a patch of light (linear Rec.709) neutral, or why not. */
export function whiteFromRGB(rgb) {
    if (!(rgb.every(Number.isFinite)) || Math.min(...rgb) < 0) return { error: 'a colour outside the screen\'s gamut cannot be a white' }
    const XYZ = rgbToXYZ(rgb)
    if (!(XYZ[1] > 0)) return { error: 'black: nothing to take a white from' }
    const xy = XYZtoxy(XYZ)
    const { cct, duv, inRange } = xyToCctDuv(...xy)
    // outside the temperatures the locus is drawn for, or too far off it (Duv 0.05) to be a light anyone calls white
    if (!inRange || Math.abs(duv) > 0.05) return { error: `not a white: ${inRange ? `Duv ${duv.toFixed(3)}` : `outside ${CCT_MIN}-${CCT_MAX} K`}` }
    return { temp: Math.round(cct), tint: Math.round((duv - WB_DEFAULT.duv) * 10000) / 10 }
}

//----------------------------------------------------------------------------------------------------------------------
// the tone equaliser
//----------------------------------------------------------------------------------------------------------------------
/** The gain in stops at x stops below white (x = log2 of the exposed luminance): the bands interpolated, held at the ends. */
export function eqGain(bands, x) {
    const t = Math.min(7, Math.max(0, x + 7))
    const i = Math.min(Math.floor(t), 6)
    return bands[i] + (bands[i + 1] - bands[i]) * (t - i)
}

//----------------------------------------------------------------------------------------------------------------------
// Oklab
//----------------------------------------------------------------------------------------------------------------------
const cbrt = x => Math.sign(x) * Math.abs(x) ** (1 / 3)
export function oklab([r, g, b]) {
    const l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s]
}
export function fromOklab([L, a, b]) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s]
}
/** Vibrance's reach: a colour whose chroma is this share of its lightness or more is left to saturation alone. */
export const VIBRANCE_REACH = 0.25          // a vivid sRGB colour is 0.22-0.38 (measured in node with oklab())
/** Saturation, vibrance and hue (radians) in Oklab. */
export function labAdjust(rgb, sat, vib, hue) {
    const [L, a, b] = oklab(rgb)
    const rel = Math.hypot(a, b) / Math.max(Math.abs(L), 1e-6)
    const k = (1 + sat) * (1 + vib * (1 - Math.min(rel / VIBRANCE_REACH, 1)))
    const c = Math.cos(hue), s = Math.sin(hue)
    return fromOklab([L, (a * c - b * s) * k, (a * s + b * c) * k])
}

//----------------------------------------------------------------------------------------------------------------------
// the adjustable curve
//----------------------------------------------------------------------------------------------------------------------
/** Hable's curve with its shoulder and toe given (the rest his: linear 0.50, its angle 0.10, toe 0.02 / 0.30). */
export const hableP = (x, sh, to) => (x * (sh * x + 0.10 * 0.50) + to * 0.02) / (x * (sh * x + 0.50) + to * 0.30) - 0.02 / 0.30
/** Curve 7: white the input that comes out at 1, its exposure bias Hable's 2. At white 5.6, toe 0.2, shoulder 0.15 it
 *  is curve 6, hable(2c) / hable(11.2). */
export const tone7 = (x, white, toe, shoulder) => hableP(2 * x, shoulder, toe) / hableP(2 * white, shoulder, toe)

//----------------------------------------------------------------------------------------------------------------------
// FINISH (0.next, phase 4): what is done to the finished picture, after the tone curve -- and the vignette, on the light
//----------------------------------------------------------------------------------------------------------------------
/* THE VIGNETTE is a lens's: a gain in stops falling off towards the corners, applied to the light before the tone
   curve, so a darkened corner darkens as light does. 0 at the centre, `amount` at the corners, starting at `mid`
   (0..1 of the way out); `round` 0 follows the picture's shape, 1 is a circle in pixels. */
export function vignetteStops(px, py, w, h, amount, mid, round) {
    const qx = ((px + 0.5) / w - 0.5) * 2, qy = ((py + 0.5) / h - 0.5) * 2
    const a = w / h
    const r0 = Math.hypot(qx, qy) / Math.SQRT2, r1 = Math.hypot(qx * a, qy) / Math.hypot(a, 1)
    const r = r0 + (r1 - r0) * round
    const t = Math.min(1, Math.max(0, (r - mid) / Math.max(1e-6, 1 - mid)))
    return amount * t * t * (3 - 2 * t)
}

/** The output transfer: linear light (0..1 after the curve) to the encoded value. */
export function encodeOut(x, transfer) {
    const c = Math.min(1, Math.max(0, x))
    if (transfer === 1) return c ** (1 / 2.2)
    if (transfer === 2) return c ** (1 / 2.4)
    if (transfer === 3) return c
    return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
}

/** LEVELS: the input's black and white made 0 and 1, a gamma for the midtones, then the output's black and white. */
export const levels = (x, inB, inW, gamma, outB, outW) =>
    outB + (outW - outB) * Math.min(1, Math.max(0, (x - inB) / Math.max(1e-6, inW - inB))) ** (1 / gamma)

/* THE WHEELS: a disc point (x, y) is a colour -- spread onto red, green and blue along three axes 120 degrees apart,
   so the three sum to 0 and a tint does not brighten -- and each wheel's master slider moves all three. Lift is the
   CDL's offset, gamma its power, gain its slope. */
const AXES = [[1, 0], [-0.5, Math.sqrt(3) / 2], [-0.5, -Math.sqrt(3) / 2]]
export const wheelTint = (x, y) => AXES.map(([ax, ay]) => x * ax + y * ay)
export function cdlFromWheels(s) {
    const lift = wheelTint(s.liftX, s.liftY), gam = wheelTint(s.gammaX, s.gammaY), gain = wheelTint(s.gainX, s.gainY)
    return {
        offset: lift.map(t => 0.1 * (s.liftM + t)),
        power: gam.map(t => 2 ** -(0.5 * (s.gammaM + t))),
        slope: gain.map(t => 2 ** (s.gainM + 0.5 * t)),
    }
}
/** ASC CDL on one encoded channel: slope, offset, power. */
export const cdl = (x, slope, offset, power) => Math.max(x * slope + offset, 0) ** power

/* GRAIN AND DITHER from a hash of the picture pixel: the same grain on a pixel in every preview and save, and the
   develop pass's (core/rendertoscreen.js pcg) bit for bit -- PCG's output permutation (O'Neill 2014) on 32 bits */
export function pcg(n) {
    const st = (Math.imul(n >>> 0, 747796405) + 2891336453) >>> 0
    const w = Math.imul(((st >>> (((st >>> 28) + 4) >>> 0)) ^ st) >>> 0, 277803737) >>> 0
    return ((w >>> 22) ^ w) >>> 0
}
/** 0..1 from a hash, in the 24 bits an f32 holds exactly, as the shader turns it. */
export const unit24 = h => (h >>> 8) / 16777216
const GRAIN_SALT = 0x632BE5AB, DITHER_SALT = 0x1B873593
const cellNoise = (ix, iy) => unit24(pcg(((ix + iy * 65536) >>> 0) ^ GRAIN_SALT)) * 2 - 1
/** The grain's noise at a picture pixel: value noise on cells `size` pixels wide, -1..1. */
export function grainNoise(px, py, size) {
    const gx = (px + 0.5) / size, gy = (py + 0.5) / size
    const ix = Math.floor(gx), iy = Math.floor(gy)
    let fx = gx - ix, fy = gy - iy
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy)
    const a = cellNoise(ix, iy), b = cellNoise(ix + 1, iy), c = cellNoise(ix, iy + 1), d = cellNoise(ix + 1, iy + 1)
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy
}
/** How much grain a tone gets: most in the midtones, less in black and white, as film's. */
export const grainWeight = y => 0.3 + 2.8 * y * (1 - y)
/** The dither at a picture pixel: triangular, -1..1 of one 8-bit step. */
export function ditherAt(px, py) {
    const h1 = pcg(((px + py * 65536) >>> 0) ^ DITHER_SALT), h2 = pcg(h1)
    return (unit24(h1) + unit24(h2) - 1) / 255
}

//----------------------------------------------------------------------------------------------------------------------
// the uniforms
//----------------------------------------------------------------------------------------------------------------------
const v = (s, k) => (Number.isFinite(+s[k]) ? +s[k] : LIGHT_DEFAULTS[k])
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** The light tools' uniforms for develop settings `s`: the matrix (WGSL column order), the bands, Oklab's, curve 7's,
 *  and which stages are on. A stage at its identity is off -- never computed, so it cannot change a bit. */
export function lightUniforms(s = {}) {
    const gains = [v(s, 'gainR'), v(s, 'gainG'), v(s, 'gainB')]
    const wbOn = v(s, 'wbTemp') !== WB_DEFAULT.temp || v(s, 'wbTint') !== 0 || gains.some(g => g !== 1)
    const m = wbOn ? whiteBalanceMatrix(v(s, 'wbTemp'), v(s, 'wbTint'), gains) : null
    const bands = EQ_KEYS.map(k => v(s, k))
    const eqOn = bands.some(b => b !== 0)
    const lab = [v(s, 'labSat'), v(s, 'labVib'), v(s, 'labHue') * Math.PI / 180]
    const labOn = lab.some(x => x !== 0)
    const curve7 = (s.toneMap | 0) === 7
    // the finished picture's tools
    const transfer = Math.max(0, Math.min(3, v(s, 'transfer') | 0))
    const lv = ['lvInBlack', 'lvInWhite', 'lvGamma', 'lvOutBlack', 'lvOutWhite'].map(k => v(s, k))
    const levelsOn = lv.some((x, i) => x !== [0, 1, 1, 0, 1][i])
    const curvesOn = !curvesIdentity(s.curves)
    const wheels = Object.fromEntries(['liftX', 'liftY', 'liftM', 'gammaX', 'gammaY', 'gammaM', 'gainX', 'gainY', 'gainM'].map(k => [k, v(s, k)]))
    const cdlOn = Object.values(wheels).some(x => x !== 0)
    const c = cdlFromWheels(wheels)
    const vig = [v(s, 'vigAmount'), v(s, 'vigMid'), v(s, 'vigRound')]
    const vigOn = vig[0] !== 0
    const grain = [v(s, 'grainAmount'), Math.max(1, v(s, 'grainSize'))]
    const grainOn = grain[0] !== 0
    const ditherOn = !!s.dither
    const any = wbOn || eqOn || labOn || curve7 || transfer !== 0 || levelsOn || curvesOn || cdlOn || vigOn || grainOn || ditherOn
    const lightOn = (any ? LIGHT_ANY : 0) | (wbOn ? LIGHT_WB : 0) | (eqOn ? LIGHT_EQ : 0) | (labOn ? LIGHT_LAB : 0)
        | (levelsOn ? LIGHT_LEVELS : 0) | (curvesOn ? LIGHT_CURVES : 0) | (cdlOn ? LIGHT_CDL : 0) | (vigOn ? LIGHT_VIGNETTE : 0)
        | (grainOn ? LIGHT_GRAIN : 0) | (ditherOn ? LIGHT_DITHER : 0) | (curvesOn && s.curveLuma ? LIGHT_CURVE_LUMA : 0)
    return {
        lightOn,
        // column-major: column j holds m[0..2][j]
        wb: m ? [m[0][0], m[1][0], m[2][0], 0, m[0][1], m[1][1], m[2][1], 0, m[0][2], m[1][2], m[2][2], 0, 0, 0, 0, 1] : IDENTITY.slice(),
        eqLo: bands.slice(0, 4), eqHi: bands.slice(4, 8),
        lab: [...lab, 0],
        tone7: [2 ** v(s, 'tcWhite'), v(s, 'tcToe'), v(s, 'tcShoulder'), 0],
        transfer,
        levelsIn: [lv[0], lv[1], 1 / Math.max(0.01, lv[2]), 0], levelsOut: [lv[3], lv[4], 0, 0],
        cdlSlope: [...c.slope, 0], cdlOffset: [...c.offset, 0], cdlPower: [...c.power, 0],
        vignette: [...vig, 0],
        grain: [...grain, 0, 0],
    }
}

/** True when nothing a light tool does would change the picture (and the curve is not 7). */
export const lightIdentity = s => lightUniforms(s).lightOn === 0

/** The light stages in JS, as developPixel runs them, on one exposed colour (1.0 = white): before the gamut clip. */
export function lightStages(rgb, s) {
    const u = lightUniforms(s)
    let c = rgb.slice()
    if (u.lightOn & LIGHT_WB) c = [0, 1, 2].map(r => u.wb[r] * c[0] + u.wb[4 + r] * c[1] + u.wb[8 + r] * c[2])
    if (u.lightOn & LIGHT_EQ) {
        const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
        const g = 2 ** eqGain([...u.eqLo, ...u.eqHi], Math.log2(Math.max(y, 1e-30)))
        c = c.map(x => x * g)
    }
    if (u.lightOn & LIGHT_LAB) c = labAdjust(c, u.lab[0], u.lab[1], u.lab[2])
    return c
}

/** The finished picture's stages in JS, as developPixel runs them after the tone curve: `rgb` linear 0..1 out of the
 *  curve, `lut` the curves' table (curves.js bakeLut), (px, py) the picture pixel. The old grading, which the stages
 *  leave as it was, is not here: these are the new ones, before it, and grain and dither after it (finishLate). */
export function finishEarly(rgb, s, lut, lutSample) {
    const u = lightUniforms(s)
    let c = rgb.map(x => encodeOut(x, u.transfer))
    if (u.lightOn & LIGHT_LEVELS) c = c.map(x => levels(x, u.levelsIn[0], u.levelsIn[1], 1 / u.levelsIn[2], u.levelsOut[0], u.levelsOut[1]))
    if (u.lightOn & LIGHT_CURVES) {
        if (u.lightOn & LIGHT_CURVE_LUMA) {
            const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
            const y2 = lutSample(lut, 0, y)
            c = y > 1e-6 ? c.map(x => x * y2 / y) : [y2, y2, y2]
        } else c = c.map(x => lutSample(lut, 0, x))
        c = c.map((x, i) => lutSample(lut, i + 1, x))
    }
    if (u.lightOn & LIGHT_CDL) c = c.map((x, i) => cdl(x, u.cdlSlope[i], u.cdlOffset[i], u.cdlPower[i]))
    return c
}
export function finishLate(rgb, s, px, py) {
    const u = lightUniforms(s)
    let c = rgb.slice()
    if (u.lightOn & LIGHT_GRAIN) {
        const y = Math.min(1, Math.max(0, 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]))
        const n = grainNoise(px, py, u.grain[1]) * u.grain[0] * 0.08 * grainWeight(y)
        c = c.map(x => x + n)
    }
    if (u.lightOn & LIGHT_DITHER) { const d = ditherAt(px, py); c = c.map(x => x + d) }
    return c.map(x => Math.min(1, Math.max(0, x)))
}
