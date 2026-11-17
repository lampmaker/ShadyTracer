/*======================================================================================================================
  WHERE THE ENVIRONMENT IS BRIGHT: a map for light sampling (0.next; core/environment.js says why the environment is
  code now, and sdf.js THE ENVIRONMENT how the renderer calls it).

  Light sampling aimed at the environment used to know two things: the sun's cone, and that the sky is broad and smooth
  -- so it drew sky directions from a cosine lobe about the normal. A sky of stars, two moons, a lamp-lit window in a
  photograph: all of it bright in small places the lobe finds by chance, so the environment lit the scene with grain or
  hardly at all (the user, 2026-11-17: "you get no light from the stars"). Now a third strategy draws directions in
  proportion to how bright the environment is there, from a map of it, beside the cone and the lobe; MIS weighs the
  three, so each direction is counted by the density of all of them.

  THE MAP IS ONLY A GUIDE. Every sample's light is what the code returns in that exact direction (sdf.js envRadiance);
  the map only says how often to look there. So it can be coarse, stale for a frame or wrong, and the picture is still
  right: only its noise changes. What it must never do is call a direction impossible where light is -- so every texel
  keeps a floor (ENV_FLOOR of the mean), and the cosine lobe stays in the mixture besides.

  EQUAL AREAS. The map is a cylindrical equal-area projection: columns are azimuth, rows are equal steps in z = cos of
  the angle from straight up. Every texel is the same solid angle, 4 pi / (W H), and a direction uniform in (azimuth, z)
  inside a texel is uniform in solid angle -- so a texel's density is its probability times W H / (4 pi), with no
  sin(theta) anywhere.

  MADE ON THE GPU, SAMPLED THERE, TABULATED ON THE HOST. prog_envbake evaluates the environment at ENV_SS x ENV_SS
  points in each texel and writes their mean luminance; the host reads that back (W H floats), turns it into the CDFs
  (envSampling, here, in JS: plain, testable, once per change) and uploads one rgba32float texture shade reads:
     r  the CDF along the texel's row, at the texel's end (1 at the row's last);
     g  the density, per steradian, of a direction in this texel (the pdf envMapPdf returns);
     b  the CDF down the rows, at the end of this texel's row (the same along a row; read in column 0).
  The bake runs before any frame that needs it (raytrace_main.js R.ensureEnv), when the environment's code or one of
  its settings has changed -- and measures, in the same pass, what the environment puts on a level surface and what
  the sun's cone gives head-on, which the Tests panel compares the picture to.
======================================================================================================================*/
export const ENV_W = 512
export const ENV_H = 256
export const ENV_SS = 2                 // ENV_SS x ENV_SS points a texel, stratified
export const ENV_CONE_THREADS = 256     // the sun's cone measured by these threads, past the texels'...
export const ENV_CONE_EACH = 16         // ...each this many directions: a 64 x 64 stratified grid in the cone
export const ENV_FLOOR = 1e-3           // every texel's weight at least this share of the mean: never impossible
export const ENV_RESOURCE = 'envTex'
export const ENV_TYPE = 'texture_2d<f32>'
/** The share of light sampling's environment samples (those not sent at the sun's cone) the map draws, the rest the
 *  cosine lobe: an even split. Chosen, not measured -- the lobe suits a broad sky and a diffuse surface, the map a
 *  small bright source; half each costs either at most a factor of two in the density it would have had alone. */
export const ENV_MAP_SHARE = 0.5

/** The map's three functions as shade has them, in place of sdf.js ENV_MAP_STUB. */
export const ENV_MAP_WGSL = /* wgsl */`
const ENV_W = ${ENV_W};
const ENV_H = ${ENV_H};
/* THE MAP'S SHARE of the environment samples not sent at the sun (core/envmap.js): 0 until the first bake. */
fn envMapShare() -> f32 { return UB.envMapShare; }
/* A direction drawn from the map: a row by the CDF down column 0 (b), a column by that row's own (r), then a point
   uniform in (azimuth, z) inside the texel -- uniform in solid angle, the projection being equal-area. The two numbers
   each pick a texel and then, rescaled within its step of the CDF, place the point: no more random numbers are drawn. */
fn envMapSample(u: VEC2) -> VEC3 {
    var lo = 0;
    var hi = ENV_H - 1;
    while (lo < hi) {
        let mid = (lo + hi) / 2;
        if (u.x < textureLoad(${ENV_RESOURCE}, vec2<i32>(0, mid), 0).b) { hi = mid; } else { lo = mid + 1; }
    }
    let row = lo;
    var r0 = 0.0;
    if (row > 0) { r0 = textureLoad(${ENV_RESOURCE}, vec2<i32>(0, row - 1), 0).b; }
    let r1 = textureLoad(${ENV_RESOURCE}, vec2<i32>(0, row), 0).b;
    let fy = clamp((u.x - r0) / max(r1 - r0, 1e-12), 0.0, 0.999999);
    lo = 0;
    hi = ENV_W - 1;
    while (lo < hi) {
        let mid = (lo + hi) / 2;
        if (u.y < textureLoad(${ENV_RESOURCE}, vec2<i32>(mid, row), 0).r) { hi = mid; } else { lo = mid + 1; }
    }
    let col = lo;
    var c0 = 0.0;
    if (col > 0) { c0 = textureLoad(${ENV_RESOURCE}, vec2<i32>(col - 1, row), 0).r; }
    let c1 = textureLoad(${ENV_RESOURCE}, vec2<i32>(col, row), 0).r;
    let fx = clamp((u.y - c0) / max(c1 - c0, 1e-12), 0.0, 0.999999);
    let z = 1.0 - 2.0 * (f32(row) + fy) / f32(ENV_H);
    let phi = 2.0 * PI * (f32(col) + fx) / f32(ENV_W);
    let s = sqrt(max(0.0, 1.0 - z * z));
    return VEC3(s * cos(phi), s * sin(phi), z);
}
/* The map's density at a direction, per steradian: its texel's (g). */
fn envMapPdf(L: VEC3) -> f32 {
    let d = normalize(L);
    let col = clamp(i32(fract(atan2(d.y, d.x) / (2.0 * PI)) * f32(ENV_W)), 0, ENV_W - 1);
    let row = clamp(i32((1.0 - d.z) * 0.5 * f32(ENV_H)), 0, ENV_H - 1);
    return textureLoad(${ENV_RESOURCE}, vec2<i32>(col, row), 0).g;
}
`

/** The bake's main: one thread a texel, its mean luminance (the sky's, outside the sun's cone, as light sampling's map
 *  needs it); then ENV_CONE_THREADS threads measuring the cone head-on (sum of Y cos over their directions). THE CODE'S
 *  OWN LIGHT, without the gains (envSun, envSky: lamps only, a test's split): what the environment is, which derive and
 *  the Tests panel scale by what is switched on -- so a lamps-only row still knows what it switched off. */
export const ENV_BAKE_MAIN = /* wgsl */`
    let i = gid.x;
    let texels = ${ENV_W}u * ${ENV_H}u;
    if (i < texels) {
        let x = f32(i % ${ENV_W}u);
        let y = f32(i / ${ENV_W}u);
        var acc = 0.0;
        for (var sy = 0u; sy < ${ENV_SS}u; sy++) {
            for (var sx = 0u; sx < ${ENV_SS}u; sx++) {
                let ux = (x + (f32(sx) + 0.5) / ${ENV_SS}.0) / ${ENV_W}.0;
                let uy = (y + (f32(sy) + 0.5) / ${ENV_SS}.0) / ${ENV_H}.0;
                let z = 1.0 - 2.0 * uy;
                let s = sqrt(max(0.0, 1.0 - z * z));
                let phi = 2.0 * PI * ux;
                let d = VEC3(s * cos(phi), s * sin(phi), z);
                if (!inSunCone(d)) { acc += dot(envBase(d), LUMA_709); }
            }
        }
        envOut[i] = acc / f32(${ENV_SS * ENV_SS}u);
        return;
    }
    let t = i - texels;
    if (t >= ${ENV_CONE_THREADS}u) { return; }
    var cone = 0.0;
    let sd = sunDirection();
    for (var k = 0u; k < ${ENV_CONE_EACH}u; k++) {
        let j = t * ${ENV_CONE_EACH}u + k;                      // 0 .. 4095, a 64 x 64 grid
        let u = (vec2<f32>(f32(j % 64u), f32(j / 64u)) + 0.5) / 64.0;
        let d = sampleSunCone(u);
        cone += dot(envBase(d), LUMA_709) * max(dot(d, sd), 0.0);
    }
    envOut[texels + t] = cone;
`
export const ENV_BAKE_THREADS = ENV_W * ENV_H + ENV_CONE_THREADS

/** The z (cos of the angle from straight up) at the middle of row y. */
export const rowZ = y => 1 - 2 * (y + 0.5) / ENV_H

/**
 * The bake's output turned into the texture shade samples, and what it measured.
 * @param {Float32Array} out   ENV_BAKE_THREADS floats: the texels' mean luminance, then the cone's partial sums
 * @param {number} coneSolidAngle  the sun's cone, sr (UB.sunSolidAngle)
 * @returns {{ tex: Float32Array, skyHorizontal: number, sunNormal: number, mean: number }}
 *   tex: ENV_W x ENV_H x 4 (r, g, b, a as the header says); skyHorizontal: lux on a level surface facing up from
 *   everything outside the cone; sunNormal: lux on a surface facing the sun from the cone alone.
 */
export function envSampling(out, coneSolidAngle = 0) {
    const N = ENV_W * ENV_H, omega = 4 * Math.PI / N
    let sum = 0
    for (let i = 0; i < N; i++) { const y = out[i]; if (y > 0 && Number.isFinite(y)) sum += y }
    const mean = sum / N
    const floor = mean > 0 ? ENV_FLOOR * mean : 1
    const w = new Float64Array(N)
    let total = 0, skyHorizontal = 0
    for (let i = 0; i < N; i++) {
        const y = out[i] > 0 && Number.isFinite(out[i]) ? out[i] : 0
        w[i] = y + floor
        total += w[i]
        const z = rowZ(Math.floor(i / ENV_W))
        if (z > 0) skyHorizontal += y * omega * z
    }
    const tex = new Float32Array(N * 4)
    const density = N / (4 * Math.PI)
    let below = 0
    for (let row = 0; row < ENV_H; row++) {
        let rowSum = 0
        for (let x = 0; x < ENV_W; x++) rowSum += w[row * ENV_W + x]
        let along = 0
        const rowCdf = row === ENV_H - 1 ? 1 : (below + rowSum) / total
        for (let x = 0; x < ENV_W; x++) {
            const i = row * ENV_W + x
            along += w[i]
            tex[4 * i] = x === ENV_W - 1 ? 1 : along / rowSum
            tex[4 * i + 1] = w[i] / total * density
            tex[4 * i + 2] = rowCdf
        }
        below += rowSum
    }
    let cone = 0
    for (let t = 0; t < ENV_CONE_THREADS; t++) { const c = out[N + t]; if (Number.isFinite(c)) cone += c }
    const sunNormal = coneSolidAngle * cone / (ENV_CONE_THREADS * ENV_CONE_EACH)
    return { tex, skyHorizontal, sunNormal, mean }
}
