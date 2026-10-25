//  renders the accumulation buffer to screen.
import { RenderUniformTypes, DisplayUniformTypes } from './uniforms.schema.js'
import { EXPOSURE_WGSL } from './photometry.js'
import { GAMUT_CLIP_WGSL } from './colorimetry.js'

/*======================================================================================
  THE TONE CURVES, applied to linear light already divided by the clipping luminance -- so
  1.0 is "white" in the exposure's sense and the curve decides what happens above it.

  PBR NEUTRAL is Khronos's (KHR_materials / the "PBR Neutral" tone mapper, 2024): identity
  below 0.76 apart from a small toe offset, then a compression of the brightest channel that
  keeps hue, with a little desaturation only where it compresses. Made for showing products
  and materials as they are -- which is what a renderer that measures light should show.

  AGX is Troy Sobotka's, in the widely used polynomial approximation (inset matrix, log2
  encoding over [-12.47, 4.03] around mid grey 0.18, a 6th-order fit of the default
  contrast curve, outset matrix, then the 2.2 display EOTF back to linear). Filmic: bright
  saturated colours drift towards white the way film and sensors do. AGX PUNCHY is the same with
  Blender's "Punchy" look applied in AgX's encoded space before the outset: power 1.35,
  saturation 1.4.

  ACES (FITTED) is Stephen Hill's fit of the ACES reference rendering and output transforms
  for an sRGB display: sRGB into the ACES working space, a rational fit of RRT+ODT, back out.
  The look most games shipped with; contrasty, and it shifts bright hues.

  REINHARD is the simplest one that never clips, L/(1+L), applied to the luminance and the
  colour scaled by it, so hue is kept. Flat, but it shows what is there.

  HABLE is John Hable's Uncharted 2 filmic curve, with his usual exposure bias of 2 and white
  point 11.2: a toe and a long shoulder, hue-shifting per channel.

  The numbers are the toneMap setting's and are stable: a saved setting keeps meaning the same
  curve, so new curves go at the end.
======================================================================================*/
const TONE = /*wgsl*/`
fn toneNeutral(c_in: vec3<f32>) -> vec3<f32> {
    let startCompression = 0.8 - 0.04;
    let desaturation = 0.15;
    var c = c_in;
    let x = min(c.r, min(c.g, c.b));
    let offset = select(0.04, x - 6.25 * x * x, x < 0.08);
    c = c - vec3<f32>(offset);
    let peak = max(c.r, max(c.g, c.b));
    if (peak < startCompression) { return c; }
    let d = 1.0 - startCompression;
    let newPeak = 1.0 - d * d / (peak + d - startCompression);
    c = c * (newPeak / peak);
    let g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
    return mix(c, vec3<f32>(newPeak), g);
}
fn agxContrast(x: vec3<f32>) -> vec3<f32> {
    let x2 = x * x;
    let x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x
         + 0.4298 * x2 + 0.1191 * x - vec3<f32>(0.00232);
}
fn toneAgX(c_in: vec3<f32>) -> vec3<f32> {
    let inset = mat3x3<f32>(
        0.842479062253094, 0.0423282422610123, 0.0423756549057051,
        0.0784335999999992, 0.878468636469772, 0.0784336,
        0.0792237451477643, 0.0791661274605434, 0.879142973793104);
    let outset = mat3x3<f32>(
        1.19687900512017, -0.0528968517574562, -0.0529716355144438,
        -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
        -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
    let minEv = -12.47393;
    let maxEv = 4.026069;
    var v = inset * max(c_in, vec3<f32>(1e-10));
    v = clamp(log2(v), vec3<f32>(minEv), vec3<f32>(maxEv));
    v = (v - vec3<f32>(minEv)) / (maxEv - minEv);
    v = agxContrast(v);
    v = outset * v;
    return pow(max(v, vec3<f32>(0.0)), vec3<f32>(2.2));   // back to linear for the sRGB step
}
fn toneAgXPunchy(c_in: vec3<f32>) -> vec3<f32> {
    let inset = mat3x3<f32>(
        0.842479062253094, 0.0423282422610123, 0.0423756549057051,
        0.0784335999999992, 0.878468636469772, 0.0784336,
        0.0792237451477643, 0.0791661274605434, 0.879142973793104);
    let outset = mat3x3<f32>(
        1.19687900512017, -0.0528968517574562, -0.0529716355144438,
        -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
        -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
    let minEv = -12.47393;
    let maxEv = 4.026069;
    var v = inset * max(c_in, vec3<f32>(1e-10));
    v = clamp(log2(v), vec3<f32>(minEv), vec3<f32>(maxEv));
    v = (v - vec3<f32>(minEv)) / (maxEv - minEv);
    v = agxContrast(v);
    // the look: power, then saturation around the Rec.709 luminance
    v = pow(max(v, vec3<f32>(0.0)), vec3<f32>(1.35));
    let y = dot(v, vec3<f32>(0.2126, 0.7152, 0.0722));
    v = vec3<f32>(y) + 1.4 * (v - vec3<f32>(y));
    v = outset * v;
    return pow(max(v, vec3<f32>(0.0)), vec3<f32>(2.2));
}
fn toneACES(c_in: vec3<f32>) -> vec3<f32> {
    // Hill's matrices are given by rows; v * M dots v with each constructor argument, i.e. a row
    let toAces = mat3x3<f32>(
        0.59719, 0.35458, 0.04823,
        0.07600, 0.90834, 0.01566,
        0.02840, 0.13383, 0.83777);
    let fromAces = mat3x3<f32>(
         1.60475, -0.53108, -0.07367,
        -0.10208,  1.10813, -0.00605,
        -0.00327, -0.07276,  1.07602);
    let v = c_in * toAces;
    let a = v * (v + vec3<f32>(0.0245786)) - vec3<f32>(0.000090537);
    let b = v * (0.983729 * v + vec3<f32>(0.4329510)) + vec3<f32>(0.238081);
    return (a / b) * fromAces;
}
fn toneReinhard(c: vec3<f32>) -> vec3<f32> {
    let y = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
    return c / (1.0 + y);
}
fn hable(x: vec3<f32>) -> vec3<f32> {
    // shoulder, linear, linear angle, toe, toe numerator, toe denominator -- spelled out,
    // because single capitals are the shader shorthand's (F is a type there)
    let sh = 0.15; let li = 0.50; let la = 0.10; let to = 0.20; let tn = 0.02; let td = 0.30;
    return (x * (sh * x + vec3<f32>(la * li)) + vec3<f32>(to * tn))
         / (x * (sh * x + vec3<f32>(li)) + vec3<f32>(to * td)) - vec3<f32>(tn / td);
}
/* THE FALSE COLOUR of the illuminance view: Google's Turbo, in its published polynomial fit --
   perceptually ordered blue -> green -> yellow -> red, and already display-encoded, so it goes
   to the screen without the sRGB step. */
fn turbo(t_in: f32) -> vec3<f32> {
    let x = clamp(t_in, 0.0, 1.0);
    let v4 = vec4<f32>(1.0, x, x * x, x * x * x);
    let v2 = v4.zw * v4.z;
    return vec3<f32>(
        dot(v4, vec4<f32>(0.13572138, 4.61539260, -42.66032258, 132.13108234)) + dot(v2, vec2<f32>(-152.94239396, 59.28637943)),
        dot(v4, vec4<f32>(0.09140261, 2.19418839, 4.84296658, -14.18503333)) + dot(v2, vec2<f32>(4.27729857, 2.82956604)),
        dot(v4, vec4<f32>(0.10667330, 12.64194608, -60.58204836, 110.36276771)) + dot(v2, vec2<f32>(-89.90310912, 27.34824973)));
}
fn toneHable(c: vec3<f32>) -> vec3<f32> {
    return hable(2.0 * c) / hable(vec3<f32>(11.2));
}
`

/* THE STEP CACHE'S CELLS, SEEN FROM THE CAMERA (stepCacheView, a developer's; wavefront.js stepCacheWGSL; the user:
   "is there a way to visualise the 3D grid?"). The pixel's camera ray -- genrays.js's, without the jitter, so the pixel's
   own -- walked through the grid cell by cell (a 3D DDA, Amanatides and Woo) up to 1024 cells. A cell whose ball is
   SMALLER THAN A CELL is a little orange fog: filled near a surface, a fill that bought no step there. Every other cell is
   clear -- empty ones, and since 0.32.2 the ones whose ball reaches past the cell (where a ray can take a cached step),
   which were green and drew the whole filled volume as one blob that hid everything else (the user, 2026-10-07: "the
   green is not useful; make the cells clear instead of green"). So what shows is the band round the objects where the
   cache cannot help -- kept across a camera move, gone after an edit.
   Returned premultiplied: rgb the fog's colour times its cover, a the cover. Reads UB.scLo, UB.scDims, the camera's
   uniforms and `stepCache` as u32 (read-only here); scene-free, so builder/test/stepcache.gpu.mjs runs it in a kernel. */
export const STEP_CACHE_VIEW_WGSL = /*wgsl*/`
fn scView(uv: vec2<f32>) -> vec4<f32> {
    let cs = UB.scLo.w;
    let dims = UB.scDims.xyz;
    if (cs <= 0.0 || dims.x == 0u) { return vec4<f32>(0.0); }
    let xy = uv * 2.0 - vec2<f32>(1.0);
    let right = UB.invView[0].xyz;
    let up = UB.invView[1].xyz;
    let fwd = UB.invView[2].xyz;
    let fx = UB.invProjection[0][0];
    let fy = UB.invProjection[1][1];
    var o = UB.camPos.xyz;
    var d = -fwd;
    if (UB.camtype == 0u) { d = normalize(right * (xy.x * fx) + up * (xy.y * fy) - fwd); }
    else { o = o + right * (xy.x * fx) + up * (xy.y * fy); }
    // no component exactly 0: that axis is then never stepped (its next crossing ever further)
    let dd = select(d, vec3<f32>(1.0e-20), abs(d) < vec3<f32>(1.0e-20));
    let lo = UB.scLo.xyz;
    let hi = lo + vec3<f32>(dims) * cs;
    let t0 = (lo - o) / dd;
    let t1 = (hi - o) / dd;
    let tn = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), max(min(t0.z, t1.z), 0.0));
    let tf = min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z));
    if (tn >= tf) { return vec4<f32>(0.0); }
    let p = (o + dd * tn - lo) / cs;
    var cell = vec3<i32>(clamp(floor(p), vec3<f32>(0.0), vec3<f32>(dims) - vec3<f32>(1.0)));
    let stp = select(vec3<i32>(-1), vec3<i32>(1), dd > vec3<f32>(0.0));
    let tDelta = abs(vec3<f32>(cs) / dd);
    var tMax = (lo + (vec3<f32>(cell) + select(vec3<f32>(0.0), vec3<f32>(1.0), dd > vec3<f32>(0.0))) * cs - o) / dd;
    var acc = vec4<f32>(0.0);
    for (var i = 0u; i < 1024u; i = i + 1u) {
        let k = u32(cell.x) + dims.x * (u32(cell.y) + dims.y * u32(cell.z));
        let v = stepCache[k];
        if (v != 0u && bitcast<f32>(v) < cs) {
            let a = 0.05;
            acc = acc + vec4<f32>(vec3<f32>(1.0, 0.45, 0.1) * a, a) * (1.0 - acc.a);
            if (acc.a > 0.97) { break; }
        }
        if (tMax.x < tMax.y && tMax.x < tMax.z) { cell.x = cell.x + stp.x; tMax.x = tMax.x + tDelta.x; }
        else if (tMax.y < tMax.z) { cell.y = cell.y + stp.y; tMax.y = tMax.y + tDelta.y; }
        else { cell.z = cell.z + stp.z; tMax.z = tMax.z + tDelta.z; }
        if (any(cell < vec3<i32>(0)) || any(cell >= vec3<i32>(dims))) { break; }
    }
    return acc;
}
`

/*======================================================================================
  WHAT THE DISPLAY MAKES OF ONE PIXEL: its linear light in, the colour on screen out.
  One function for the two passes that show the picture -- the live display below and the
  develop pass after it (a saved picture's exposure and tone curve, chosen after the render)
  -- so a picture saved untouched cannot differ from the one the view showed. `scale` is the
  exposure multiplier, decided by each caller (the live one may have metered it); `uv` is
  the output's, for the false-colour legend along the bottom edge.
======================================================================================*/
const DISPLAY = /*wgsl*/`
${EXPOSURE_WGSL}
${GAMUT_CLIP_WGSL}
${TONE}
fn displayPixel(centerRGB: VEC3, uv: V, scale: f32) -> VEC3 {
                /* EXPOSURE, THEN THE TONE CURVE, THEN sRGB, THEN THE GRADING. The multiplier is
                   1 / the luminance that clips at the EV (photometry.ev100ToScale), so 1.0 here
                   is white. The EV is exposureEV when manual, or what the GPU metered
                   (aeState[0], core/autoexposure.js) less the compensation when auto -- read
                   here, in the same frame the meter wrote it, with no trip through the CPU.
                   The encoding is the exact sRGB transfer curve, because the canvas is an 8-bit
                   UNORM format the browser presents as sRGB without converting.
                   Contrast, saturation and brightness act on the encoded picture, as they did. */
                /* THE ILLUMINANCE VIEW: the accumulation holds E/pi on every visible surface (the
                   camera's first hit was a white Lambertian -- tracebasics.js), so pi Y is lux.
                   Shown on a logarithmic false-colour scale from measureMin to measureMax, stepped
                   into measureBands flat bands when that is not 0, with a strip of the scale
                   itself along the bottom so the colours can be read. Nothing here is exposed or
                   tone-mapped: the colour IS the number. A pixel with no light shows black. */
                /* ...and THE LUMINANCE VIEW (measureMode 2) on the same scale: the picture's own
                   Y in cd/m^2, not multiplied by pi */
                if (UB.measureMode != 0u) {
                    // the pixel's own luminance: exact even where a channel is negative (a colour
                    // outside the gamut; wavefront.js badDeposit)
                    let Yv = max(dot(centerRGB, VEC3(0.2126, 0.7152, 0.0722)), 0.0);
                    let lux = select(Yv, 3.14159265 * Yv, UB.measureMode == 1u);
                    let lo = log2(max(UB.measureMin, 1e-6));
                    let hi = max(log2(max(UB.measureMax, 1e-6)), lo + 1e-3);
                    let bands = f32(UB.measureBands);
                    let inStrip = uv.y < 0.025;                // the legend, along the bottom edge
                    var t = select((log2(max(lux, 1e-30)) - lo) / (hi - lo), uv.x, inStrip);
                    if (bands > 0.0) { t = (floor(clamp(t, 0.0, 0.99999) * bands) + 0.5) / bands; }
                    let shown = select(turbo(t), VEC3(0.0), lux <= 0.0 && !inStrip);
                    return clamp(shown, VEC3(0.0), VEC3(1.0));
                }
                /* INTO THE DISPLAY'S GAMUT, once, here: the accumulation holds exact colours, a
                   saturated LED's with a negative channel, so a mix of them sums right; the screen
                   cannot show them, and gets the same luminance, desaturated (core/colorimetry.js) */
                var rgb = gamutClip(centerRGB * scale);
                switch (UB.toneMap) {
                    case 1u: { rgb = toneNeutral(rgb); }
                    case 2u: { rgb = toneAgX(rgb); }
                    case 3u: { rgb = toneAgXPunchy(rgb); }
                    case 4u: { rgb = toneACES(rgb); }
                    case 5u: { rgb = toneReinhard(rgb); }
                    case 6u: { rgb = toneHable(rgb); }
                    default: { }
                }
                rgb = clamp(rgb, VEC3(0.0), VEC3(1.0));
                let lo = rgb * 12.92;
                let hi = 1.055 * pow(rgb, VEC3(1.0 / 2.4)) - VEC3(0.055);
                rgb = select(hi, lo, rgb <= VEC3(0.0031308));

                // Contrast around 0.5 pivot (unchanged)
                rgb = mix(VEC3(0.5), rgb, UB.contrast + 1.0);

                // Better saturation: mix toward luminance rather than constant gray
                let luma = dot(rgb, VEC3(0.2126, 0.7152, 0.0722));
                rgb = mix(VEC3(luma), rgb, UB.saturation + 1.0);

                rgb = rgb + UB.brightness;
                return clamp(rgb, VEC3(0.0), VEC3(1.0));
}
`

/*======================================================================================
  THE DARKROOM'S LIGHT TOOLS (0.next; lib/pathtracer/darkroom/grade.js says why and is their JS
  mirror): white balance and gains, the tone equaliser and Oklab's saturation, vibrance and hue
  between the exposure and the tone curve, and curve 7, Hable's with its white, toe and shoulder
  given. developPixel is displayPixel's ops in displayPixel's order with those between them --
  a copy, not a change to displayPixel, which the live display runs and the tutorial quotes;
  lib/pathtracer/test/develop.gpu.mjs holds the copy to the original bit for bit at identity.
  darkroomPixel chooses: displayPixel itself when no light tool is on (lightOn 0), so an
  untouched develop is the display's picture. lightOn's bits (grade.js): 1 any, 2 white
  balance, 4 the equaliser, 8 Oklab -- a stage off is never computed, so it changes no bit.
  A false-colour view is a measurement: no light tool touches it.
======================================================================================*/
const LIGHT = /*wgsl*/`
fn cbrtSigned(x: vec3<f32>) -> vec3<f32> { return sign(x) * pow(abs(x), vec3<f32>(1.0 / 3.0)); }
fn oklabFrom(c: vec3<f32>) -> vec3<f32> {
    let lms = cbrtSigned(vec3<f32>(
        0.4122214708 * c.x + 0.5363325363 * c.y + 0.0514459929 * c.z,
        0.2119034982 * c.x + 0.6806995451 * c.y + 0.1073969566 * c.z,
        0.0883024619 * c.x + 0.2817188376 * c.y + 0.6299787005 * c.z));
    return vec3<f32>(
        0.2104542553 * lms.x + 0.7936177850 * lms.y - 0.0040720468 * lms.z,
        1.9779984951 * lms.x - 2.4285922050 * lms.y + 0.4505937099 * lms.z,
        0.0259040371 * lms.x + 0.7827717662 * lms.y - 0.8086757660 * lms.z);
}
fn oklabTo(lab: vec3<f32>) -> vec3<f32> {
    let l1 = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
    let m1 = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
    let s1 = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
    let lms = vec3<f32>(l1 * l1 * l1, m1 * m1 * m1, s1 * s1 * s1);
    return vec3<f32>(
         4.0767416621 * lms.x - 3.3077115913 * lms.y + 0.2309699292 * lms.z,
        -1.2684380046 * lms.x + 2.6097574011 * lms.y - 0.3413193965 * lms.z,
        -0.0041960863 * lms.x - 0.7034186147 * lms.y + 1.7076147010 * lms.z);
}
// the equaliser's gain in stops at x stops below white: 8 bands at -7..0, interpolated, held at the ends
fn eqGainAt(x: f32) -> f32 {
    var bands = array<f32, 8>(UB.eqLo.x, UB.eqLo.y, UB.eqLo.z, UB.eqLo.w, UB.eqHi.x, UB.eqHi.y, UB.eqHi.z, UB.eqHi.w);
    let t = clamp(x + 7.0, 0.0, 7.0);
    let i = min(u32(floor(t)), 6u);
    return mix(bands[i], bands[i + 1u], t - f32(i));
}
// Hable's curve, its shoulder and toe given (hable() above has his fixed ones)
fn hableP(x: vec3<f32>, sh: f32, to: f32) -> vec3<f32> {
    let li = 0.50; let la = 0.10; let tn = 0.02; let td = 0.30;
    return (x * (sh * x + vec3<f32>(la * li)) + vec3<f32>(to * tn))
         / (x * (sh * x + vec3<f32>(li)) + vec3<f32>(to * td)) - vec3<f32>(tn / td);
}
// curve 7: tone7.x the white (the input that comes out at 1), .y the toe, .z the shoulder
fn toneHableAdjustable(c: vec3<f32>) -> vec3<f32> {
    return hableP(2.0 * c, UB.tone7.z, UB.tone7.y) / hableP(vec3<f32>(2.0 * UB.tone7.x), UB.tone7.z, UB.tone7.y);
}
// the light stages on an exposed colour (1.0 = white), each only when its bit is on: grade.js lightStages
fn darkroomLight(c: vec3<f32>) -> vec3<f32> {
    var rgb = c;
    if ((UB.lightOn & 2u) != 0u) { rgb = (UB.wb * vec4<f32>(rgb, 0.0)).xyz; }
    if ((UB.lightOn & 4u) != 0u) {
        let y = dot(rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
        rgb = rgb * exp2(eqGainAt(log2(max(y, 1e-30))));
    }
    if ((UB.lightOn & 8u) != 0u) {
        let lab = oklabFrom(rgb);
        let rel = length(lab.yz) / max(abs(lab.x), 1e-6);
        let k = (1.0 + UB.lab.x) * (1.0 + UB.lab.y * (1.0 - min(rel / 0.25, 1.0)));      // grade.js VIBRANCE_REACH
        let cs = cos(UB.lab.z);
        let sn = sin(UB.lab.z);
        rgb = oklabTo(vec3<f32>(lab.x, (lab.y * cs - lab.z * sn) * k, (lab.y * sn + lab.z * cs) * k));
    }
    return rgb;
}
/* THE FINISHED PICTURE'S TOOLS (0.next, phase 4; grade.js FINISH, curves.js): the vignette on the light, then after the
   tone curve the output transfer, Levels, the curves from their table (curveLut: master, red, green, blue, 1024 each),
   the colour wheels as an ASC CDL, and after the old grading the grain and the dither, both from a hash of the picture
   pixel so they are the same in every preview and save. lightOn's bits: 16 Levels, 32 curves, 64 CDL, 128 vignette,
   256 grain, 512 dither, 1024 the curves on luma -- each off never computed. */
fn pcg(n: u32) -> u32 {
    let st = n * 747796405u + 2891336453u;
    let w = ((st >> ((st >> 28u) + 4u)) ^ st) * 277803737u;
    return (w >> 22u) ^ w;
}
fn unit24(h: u32) -> f32 { return f32(h >> 8u) / 16777216.0; }
fn cellNoise(ix: i32, iy: i32) -> f32 { return unit24(pcg(u32(ix + iy * 65536) ^ 0x632BE5ABu)) * 2.0 - 1.0; }
fn grainNoiseAt(pix: vec2<u32>, size: f32) -> f32 {
    let g = (vec2<f32>(pix) + vec2<f32>(0.5)) / size;
    let cell = floor(g);
    var f = g - cell;
    f = f * f * (3.0 - 2.0 * f);
    let ix = i32(cell.x);
    let iy = i32(cell.y);
    let a = cellNoise(ix, iy);
    let b = cellNoise(ix + 1, iy);
    let c = cellNoise(ix, iy + 1);
    let d = cellNoise(ix + 1, iy + 1);
    let top = a + (b - a) * f.x;
    return top + ((c + (d - c) * f.x) - top) * f.y;
}
fn ditherAt(pix: vec2<u32>) -> f32 {
    let h1 = pcg((pix.x + pix.y * 65536u) ^ 0x1B873593u);
    let h2 = pcg(h1);
    return (unit24(h1) + unit24(h2) - 1.0) / 255.0;
}
// vignette.x the stops at the corners, .y where it starts, .z round (0 the picture's shape, 1 a circle in pixels)
fn vignetteStopsAt(pix: vec2<u32>) -> f32 {
    let q = ((vec2<f32>(pix) + vec2<f32>(0.5)) / UB.src - vec2<f32>(0.5)) * 2.0;
    let a = UB.src.x / UB.src.y;
    let r0 = length(q) / sqrt(2.0);
    let r1 = length(vec2<f32>(q.x * a, q.y)) / length(vec2<f32>(a, 1.0));
    let r = mix(r0, r1, UB.vignette.z);
    let t = clamp((r - UB.vignette.y) / max(1e-6, 1.0 - UB.vignette.y), 0.0, 1.0);
    return UB.vignette.x * t * t * (3.0 - 2.0 * t);
}
// the output transfer; 0 is displayPixel's own sRGB expression, step for step
fn encodeOut(c: vec3<f32>) -> vec3<f32> {
    switch (UB.transfer) {
        case 1u: { return pow(c, vec3<f32>(1.0 / 2.2)); }
        case 2u: { return pow(c, vec3<f32>(1.0 / 2.4)); }
        case 3u: { return c; }
        default: {
            let lo = c * 12.92;
            let hi = 1.055 * pow(c, VEC3(1.0 / 2.4)) - VEC3(0.055);
            return select(hi, lo, c <= VEC3(0.0031308));
        }
    }
}
// one curve of the table at x: linear between its two nearest entries
fn lutAt(ch: u32, x: f32) -> f32 {
    let t = clamp(x, 0.0, 1.0) * 1023.0;
    let i = min(u32(floor(t)), 1022u);
    return mix(curveLut[ch * 1024u + i], curveLut[ch * 1024u + i + 1u], t - f32(i));
}
// Levels, the curves and the wheels (CDL), on the encoded picture
fn darkroomFinish(c: vec3<f32>) -> vec3<f32> {
    var rgb = c;
    if ((UB.lightOn & 16u) != 0u) {
        let t = clamp((rgb - vec3<f32>(UB.levelsIn.x)) / max(1e-6, UB.levelsIn.y - UB.levelsIn.x), vec3<f32>(0.0), vec3<f32>(1.0));
        rgb = vec3<f32>(UB.levelsOut.x) + (UB.levelsOut.y - UB.levelsOut.x) * pow(t, vec3<f32>(UB.levelsIn.z));
    }
    if ((UB.lightOn & 32u) != 0u) {
        if ((UB.lightOn & 1024u) != 0u) {
            let y = dot(rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
            let y2 = lutAt(0u, y);
            rgb = select(vec3<f32>(y2), rgb * (y2 / y), y > 1e-6);
        } else {
            rgb = vec3<f32>(lutAt(0u, rgb.x), lutAt(0u, rgb.y), lutAt(0u, rgb.z));
        }
        rgb = vec3<f32>(lutAt(1u, rgb.x), lutAt(2u, rgb.y), lutAt(3u, rgb.z));
    }
    if ((UB.lightOn & 64u) != 0u) {
        rgb = pow(max(rgb * UB.cdlSlope.xyz + UB.cdlOffset.xyz, vec3<f32>(0.0)), UB.cdlPower.xyz);
    }
    return rgb;
}
fn developPixel(centerRGB: VEC3, uv: V, scale: f32, pix: vec2<u32>) -> VEC3 {
    if (UB.measureMode != 0u) { return displayPixel(centerRGB, uv, scale); }
    var rgb = darkroomLight(centerRGB * scale);
    if ((UB.lightOn & 128u) != 0u) { rgb = rgb * exp2(vignetteStopsAt(pix)); }
    // from here, displayPixel's own steps: the gamut, the curve, sRGB, the grading -- with the finish between
    rgb = gamutClip(rgb);
    switch (UB.toneMap) {
        case 1u: { rgb = toneNeutral(rgb); }
        case 2u: { rgb = toneAgX(rgb); }
        case 3u: { rgb = toneAgXPunchy(rgb); }
        case 4u: { rgb = toneACES(rgb); }
        case 5u: { rgb = toneReinhard(rgb); }
        case 6u: { rgb = toneHable(rgb); }
        case 7u: { rgb = toneHableAdjustable(rgb); }
        default: { }
    }
    rgb = clamp(rgb, VEC3(0.0), VEC3(1.0));
    rgb = darkroomFinish(encodeOut(rgb));
    rgb = mix(VEC3(0.5), rgb, UB.contrast + 1.0);
    let luma = dot(rgb, VEC3(0.2126, 0.7152, 0.0722));
    rgb = mix(VEC3(luma), rgb, UB.saturation + 1.0);
    rgb = rgb + UB.brightness;
    if ((UB.lightOn & 256u) != 0u) {
        let y = clamp(dot(rgb, vec3<f32>(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
        rgb = rgb + vec3<f32>(grainNoiseAt(pix, UB.grain.y) * UB.grain.x * 0.08 * (0.3 + 2.8 * y * (1.0 - y)));
    }
    if ((UB.lightOn & 512u) != 0u) { rgb = rgb + vec3<f32>(ditherAt(pix)); }
    return clamp(rgb, VEC3(0.0), VEC3(1.0));
}
fn darkroomPixel(centerRGB: VEC3, uv: V, scale: f32, pix: vec2<u32>) -> VEC3 {
    if (UB.lightOn == 0u) { return displayPixel(centerRGB, uv, scale); }
    return developPixel(centerRGB, uv, scale, pix);
}
`

/* `cacheView`: the step cache's cells drawn over the picture (STEP_CACHE_VIEW_WGSL), compiled in only when asked -- the
   engine's kernel option (raytrace_main.js R.kernelOptions), on while the setting stepCacheView is and the cache with it.
   Off, this pass holds none of it, not the walk and not the cells' binding: what it compiled before the view existed. */
export   let rendertoscreen_prog=async (WG, { cacheView = 0 } = {})=> await WG.makeFrag(
             /*wgsl*/`
            ${cacheView ? STEP_CACHE_VIEW_WGSL : ''}
            ${DISPLAY}
            fn frag(uv:V)->X {
                // uv is in [0,1] range;   accumulation coordinates are full resolution pixels
                let pixel = vec2<u32>(uv * vec2<f32>(UB.res));
                let index = pixel.x + pixel.y * u32(UB.res.x);

                /* The accumulation buffer holds the EXPONENTIAL MOVING AVERAGE that
                   prog_resolve maintains: r,g,b are f32 bitcast into u32, linear Rec.709 in
                   cd/m^2 (core/photometry.js), and the fourth word is the sample count the EMA
                   weighting uses. Already averaged, so nothing to divide. */
                let base: u32 = index * 4u;
                let centerRGB = VEC3(bitcast<f32>(atomicLoad(&accumulation_u32[base + 0u])),
                                     bitcast<f32>(atomicLoad(&accumulation_u32[base + 1u])),
                                     bitcast<f32>(atomicLoad(&accumulation_u32[base + 2u])));
                let scale = select(UB.exposureScale, ev100ToScale(aeState[0] - UB.exposureComp),
                                   UB.autoExposure != 0u && aeState[1] != 0.0);
                /* ALPHA 1. It was the sample count, at least 1 -- which an 8-bit target (the canvas,
                   a save's texture: the canvas's format) stores as 1 all the same. */
                var rgb = displayPixel(centerRGB, uv, scale);
                ${cacheView ? /*wgsl*/`/* THE STEP CACHE'S CELLS over the picture (STEP_CACHE_VIEW_WGSL), in the photographic view. Compiled
                   in only with the cache (the kernel option): off, its cells are not kept up to date. Here, in the live
                   display, and not in displayPixel: the develop pass shares that, and a saved picture is never to carry a
                   debugging view. */
                if (UB.measureMode == 0u) {
                    let c = scView(uv);
                    rgb = rgb * (1.0 - c.a) + c.rgb;
                }` : ''}
                return VEC4(rgb, 1.0);
            }
        `,
            DisplayUniformTypes,                // the step cache's view too (uniforms.schema.js)
            /* aeState is read-only here and written by prog_ae_update; a host that does not run
               auto-exposure binds a zeroed one and leaves autoExposure 0 */
            { accumulation_u32: 'array<atomic<u32>>', aeState: 'array<f32>',
              ...(cacheView ? { stepCache: 'read array<u32>' } : {}) }   // the step cache's cells, to be shown
            ,
        )

/*======================================================================================
  THE DEVELOP PASS: a rendered picture's linear light, kept (lib/pathtracer/develop.js),
  shown with an exposure, tone curve and grading chosen after the render rather than
  before it. Everything per pixel is darkroomPixel above: displayPixel itself with the view's
  settings, so it is the view's picture; developPixel when a light tool is on (0.next).
  `hdr` is a copy of the accumulation as the render left it: r, g, b as f32, the fourth
  word the sample count (unread). Row 0 is the BOTTOM of the picture, as the display draws
  (tinywebgpu's makeFrag hands frag a uv with y = 0 at the bottom of the target).
  WHERE AN OUTPUT PIXEL LOOKS (`view`, 0.next): xy the picture point at the output's centre,
  in picture pixels, zw the picture pixels one output pixel spans -- so the darkroom's
  viewer pans and zooms by four numbers. A save and a thumbnail pass the view that fills the
  output with the whole picture (develop.js viewFill: centre src/2, span src/res), which is
  the mapping this pass always had (uv * src). Outside the picture: a dark backdrop.
  THE OUTPUT MAY BE SMALLER than the picture (a preview): each output pixel then averages a
  box x box grid over its footprint, rather than showing one pixel in every few -- a firefly
  a preview happened to land on would otherwise stand for its whole neighbourhood. At the
  picture's own size `box` is 1 and the tap is exactly the display's pixel; zoomed in past
  it (a span under 1) the one tap lands on floor(q): the nearest picture pixel, so a pixel
  looked at closely is a square, not a blur.
  `clipWarn` (the viewer's, never a save's): a tap whose output reaches white on any channel
  striped red, one black on every channel striped blue -- in the photographic view only.
  `overlay` is what was drawn over the picture when it was rendered (the optics paths:
  R.overlays), into a texture of its own; added after the display, as it was added over
  the display then. A render target's row 0 is the TOP, so its rows are read upside down.
======================================================================================*/
export const DevelopUniformTypes = {
    ...RenderUniformTypes,
    src: 'vec2<f32>',        // the picture's size, pixels; `res` is the output's
    box: 'u32',              // taps per side per output pixel
    overlayOn: 'u32',        // 1 when `overlay` holds something to add
    view: 'vec4<f32>',       // xy the picture point at the output's centre, zw picture pixels per output pixel
    clipWarn: 'u32',         // 1: stripe what clips (the viewer's preview only)
    legend: 'vec4<f32>',     // where this output sits in the whole picture, for the false-colour legend: xy + uv * zw
    // the light tools (LIGHT above, darkroom/grade.js lightUniforms)
    lightOn: 'u32',          // a bit a stage on; 0 runs displayPixel itself
    wb: 'mat4x4<f32>',       // white balance and gains, the upper 3 x 3
    eqLo: 'vec4<f32>',       // the equaliser's gains in stops, -7..-4 EV
    eqHi: 'vec4<f32>',       // ...and -3..0 EV
    lab: 'vec4<f32>',        // Oklab: saturation, vibrance, hue (radians)
    tone7: 'vec4<f32>',      // curve 7: white, toe, shoulder
    // the finished picture's tools (0.next, phase 4)
    transfer: 'u32',         // 0 sRGB, 1 gamma 2.2, 2 gamma 2.4, 3 linear
    levelsIn: 'vec4<f32>',   // black, white, 1 / gamma
    levelsOut: 'vec4<f32>',  // black, white
    cdlSlope: 'vec4<f32>',   // the wheels as an ASC CDL: gain
    cdlOffset: 'vec4<f32>',  // ...lift
    cdlPower: 'vec4<f32>',   // ...gamma
    vignette: 'vec4<f32>',   // stops at the corners, where it starts, round
    grain: 'vec4<f32>',      // amount, size in picture pixels
}
/* `format`: the target's (the canvas's when not given). A 16-bit save draws into rgba32float, in strips of rows -- each a
   `view` of its part and a `legend` placing it in the whole, so the false-colour legend lands along the picture's
   bottom edge, not every strip's (develop.js developedRows). (0, 0, 1, 1) is the output itself: uv exactly, as before. */
export const develop_prog = async (WG, { format } = {}) => await WG.makeFrag(
    /*wgsl*/`
    ${DISPLAY}
    ${LIGHT}
    fn frag(uv: V) -> X {
        let src = UB.src;
        let n = max(UB.box, 1u);
        let o = uv * UB.res;                      // the output pixel, y up
        let foot = UB.view.zw;                    // picture pixels per output pixel
        let centre = UB.view.xy + (o - 0.5 * UB.res) * foot;
        if (any(centre < vec2<f32>(0.0)) || any(centre >= src)) { return VEC4(VEC3(0.09), 1.0); }
        let lo = centre - 0.5 * foot;
        let w = u32(src.x);
        let h = u32(src.y);
        /* the stripes, 8 output pixels a period, running diagonally so they cannot be mistaken for the picture. Pixel
           centres sum to whole numbers, eighths of the period: a sixteenth more keeps every pixel off a stripe's edge,
           where the interpolated uv would decide it by its last bit */
        let stripe = fract((o.x + o.y) / 8.0 + 0.0625) < 0.5;
        var sum = VEC3(0.0);
        for (var j = 0u; j < n; j++) {
            for (var i = 0u; i < n; i++) {
                let q = lo + (vec2<f32>(f32(i), f32(j)) + vec2<f32>(0.5)) / f32(n) * foot;
                let p = vec2<u32>(clamp(q, vec2<f32>(0.0), src - vec2<f32>(1.0)));
                var c = darkroomPixel(hdr[p.x + p.y * w].rgb, UB.legend.xy + uv * UB.legend.zw, UB.exposureScale, p);
                if (UB.clipWarn != 0u && UB.measureMode == 0u && stripe) {
                    if (max(c.r, max(c.g, c.b)) >= 254.5 / 255.0) { c = VEC3(1.0, 0.0, 0.0); }
                    else if (max(c.r, max(c.g, c.b)) <= 0.5 / 255.0) { c = VEC3(0.0, 0.25, 1.0); }
                }
                if (UB.overlayOn != 0u) {
                    let ov = textureLoad(overlay, vec2<i32>(i32(p.x), i32(h - 1u - p.y)), 0).rgb;
                    c = clamp(c + ov, VEC3(0.0), VEC3(1.0));
                }
                sum = sum + c;
            }
        }
        return VEC4(sum / f32(n * n), 1.0);
    }
    `,
    DevelopUniformTypes,
    { hdr: 'array<vec4<f32>>', overlay: 'texture_2d<f32>', curveLut: 'read array<f32>' },
    { readOnly: ['hdr'], ...(format ? { format } : {}) },
)

/*======================================================================================
  THE DEVELOPED PICTURE'S HISTOGRAM (the darkroom's, 0.next): what a save at these settings
  would write, counted -- 256 bins each of R, G, B and the Rec.709 luma of the encoded
  values, as an image editor counts them. The same darkroomPixel as the develop pass, at the
  picture's own pixels (no box, no overlay: the overlay is drawing, not picture), every
  `step`-th one each way so a big picture costs about a million pixels. `uv` is the middle
  of the output, so the false-colour legend strip is never counted.
  Counted as the auto-exposure counts (core/autoexposure.js): a histogram in workgroup
  memory, flushed with one atomic per non-empty bin. NO EARLY RETURN before the barriers
  (check-shaders pass two): an invocation past the edge simply counts nothing.
======================================================================================*/
export const HIST_BINS = 256
export const DevelopHistogramUniformTypes = { ...DevelopUniformTypes, step: 'u32' }
export const develop_histogram_prog = async (WG) => await WG.makeCompute(
    /*wgsl*/`
    ${DISPLAY}
    ${LIGHT}
    var<workgroup> hLocal: array<atomic<u32>, ${4 * HIST_BINS}>;
    fn histBin(x: f32) -> u32 { return u32(clamp(x, 0.0, 1.0) * ${HIST_BINS - 1}.0 + 0.5); }
    `,
    /*wgsl*/`
    let li = lid.x + lid.y * 16u;                // 256 invocations, 1024 bins: four each
    for (var k = 0u; k < 4u; k++) { atomicStore(&hLocal[li * 4u + k], 0u); }
    workgroupBarrier();
    let w = u32(UB.src.x);
    let h = u32(UB.src.y);
    let p = gid.xy * max(UB.step, 1u);
    if (p.x < w && p.y < h) {
        let c = darkroomPixel(hdr[p.x + p.y * w].rgb, vec2<f32>(0.5), UB.exposureScale, p);
        let y = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
        atomicAdd(&hLocal[histBin(c.r)], 1u);
        atomicAdd(&hLocal[${HIST_BINS}u + histBin(c.g)], 1u);
        atomicAdd(&hLocal[${2 * HIST_BINS}u + histBin(c.b)], 1u);
        atomicAdd(&hLocal[${3 * HIST_BINS}u + histBin(y)], 1u);
    }
    workgroupBarrier();
    for (var k = 0u; k < 4u; k++) {
        let b = li * 4u + k;
        let m = atomicLoad(&hLocal[b]);
        if (m > 0u) { atomicAdd(&hist[b], m); }
    }
    `,
    DevelopHistogramUniformTypes,
    { hdr: 'read array<vec4<f32>>', hist: 'array<atomic<u32>>', curveLut: 'read array<f32>' },
    { wg: [16, 16, 1] },
)
