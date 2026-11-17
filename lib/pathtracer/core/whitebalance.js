/*======================================================================================================================
  THE VIEW'S WHITE BALANCE (0.next; the user, 2026-11-17: the physical sun "is very warm now ... about 5000 K, so that is
  right, but the colour is quite warm, beige" -- and a white balance in the exposure controls).

  The picture holds light in linear Rec.709, whose white is D65 (6504 K); the display shows it as it is. A sun of 5000 K
  is then what a camera set to daylight-D65 would show: warm. A camera, and an eye, adapt instead: the light that lights
  the scene is taken as white. This is that: a von Kries adaptation in Bradford's cone space (the Darkroom's own,
  darkroom/grade.js whiteBalanceMatrix) from the chosen white to D65, after the exposure and before the gamut and the
  tone curve -- the display's alone (rendertoscreen.js displayPixel): the light the accumulation holds, every reading
  (the illuminance view, the luminance view, the Tests panel's) and a saved picture's light are what they were.

  THE WHITE is the view's whiteK and whiteTint (Duv x 1000 from where D65 sits, the Darkroom's convention), or with
  whiteAuto what the environment puts on a level white surface: the sky's light on it and the sun's, at its elevation,
  as the environment's map measured them (core/envmap.js, R.envMeasure) -- what a camera's auto white balance would take
  of a grey card lying in the open. Not the lamps: they are the scene's, and a scene lit by lamps alone keeps its setting.
  An environment with no colour to take (black, or a white too far off the locus) keeps the setting too.

  6506 K AND TINT 0 IS NO CHANGE: the matrix is the identity there, exactly, so every scene saved before has the picture it
  had.
======================================================================================================================*/
import { whiteBalanceMatrix, whiteFromRGB, WB_DEFAULT } from '../darkroom/grade.js'

export const IDENTITY4 = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
export { WB_DEFAULT }

/** The light the environment puts on a level white surface facing up, linear Rec.709 (lux x the channel's share): the
 *  sky's outside the sun's cone and, with the cone in use and the sun up, the cone's at the sun's elevation. Null when
 *  nothing is measured yet. */
export function levelLight(v, env, sunOn) {
    if (!env?.skyRGB) return null
    const h = Math.max(0, Math.sin((v.uSunElevation ?? 45) * Math.PI / 180))
    return env.skyRGB.map((c, i) => c + (sunOn ? (env.sunRGB?.[i] ?? 0) * h : 0))
}

/** The white the view balances to: { temp, tint, from: 'setting' | 'environment' }. */
export function viewWhite(v, env = null, sunOn = true) {
    const set = { temp: Number.isFinite(+v.whiteK) ? +v.whiteK : WB_DEFAULT.temp, tint: +v.whiteTint || 0, from: 'setting' }
    if ((v.whiteAuto | 0) !== 1) return set
    const rgb = levelLight(v, env, sunOn)
    if (!rgb) return set
    const w = whiteFromRGB(rgb)
    return w.error ? set : { temp: w.temp, tint: w.tint, from: 'environment' }
}

/** The view's white balance as the display reads it (UB.viewWB): column-major 4 x 4, its upper 3 x 3 the adaptation;
 *  the identity, exactly, at D65. */
export function viewWhiteMatrix(v, env = null, sunOn = true) {
    const { temp, tint } = viewWhite(v, env, sunOn)
    if (temp === WB_DEFAULT.temp && tint === 0) return IDENTITY4.slice()
    const m = whiteBalanceMatrix(temp, tint)
    return [m[0][0], m[1][0], m[2][0], 0, m[0][1], m[1][1], m[2][1], 0, m[0][2], m[1][2], m[2][2], 0, 0, 0, 0, 1]
}
