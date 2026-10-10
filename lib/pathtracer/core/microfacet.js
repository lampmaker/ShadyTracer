//======================================================================================================================
// MICROFACET -- the one GGX this renderer has, in the surface's local frame (z = normal), and the
// albedo tables that make materials conserve energy.
//
// WHY THIS FILE EXISTS. The material review (PLAN.md) found the old model wrong in ways a
// straight-down test could not see:
//   - the visible-normal sampler built its disk in a fixed frame instead of around the view, and
//     its pdf was (D Gv NoH)/(4 VoH) -- right only at normal view. Anywhere else the BSDF-sampled
//     estimate was biased and disagreed with NEE and with light tracing, and a [0,10] clamp then
//     cut the fireflies it made;
//   - three different "is it a mirror" thresholds, and an alpha clamped in eval but not in the pdf;
//   - Fresnel from a `specular` slider, never from the IOR -- water, glass and diamond all
//     reflected 4%, and total internal reflection jumped from 4% to 100%;
//   - a diffuse term weighted by (1 - F) whose missing energy the rough coat did not give back:
//     a white "diffuse" floor read 0.975 of what it should, and could not pass a white furnace.
//
// WHAT REPLACES IT, each piece from the literature, nothing invented:
//   GGX D and Smith Lambda/G1 (Heitz 2014), height-correlated G2 = 1 / (1 + Lo + Li).
//   Visible-normal sampling by spherical caps (Dupuy & Benyoub 2023), whose reflect pdf is exactly
//   G1(o) D(h) / (4 o.z) -- so a sampled reflection weighs F G2 / G1(o) <= 1, and no clamp is needed.
//   Exact unpolarised dielectric Fresnel, TIR included, from the ratio of indices.
//   Energy: a dielectric's diffuse base is coupled to its coat by the coat's albedo,
//       f_diff = base (1 - E(o)) (1 - E(i)) / (pi (1 - E_avg))          (Kulla & Conty 2017)
//   which integrates to exactly base (1 - E(o)) and is reciprocal; a metal's single-scatter lobe is
//   scaled by 1 + F0 (1/E1(o) - 1) (Turquin 2019), exact for F0 = 1.
//
// THE TABLES ARE COMPUTED ON THE GPU from the very functions shading calls -- prog_mf_lut below --
// so the albedo the coupling divides by is the albedo the lobe actually has. A JS copy of GGX would
// be a second model the first time either was edited; the white-furnace bench row is what checks
// the two agree (a furnace reads 1 exactly when they do).
//
// THEY LIVE IN THE `learn` BUFFER, past everything light tracing and emitter discovery keep there
// (layout in tracebasics.js), because prog_shade is at the spec floor of 8 storage bindings and a
// ninth is an adapter that will not run it. clearLight rewrites only the first LEARN_WORDS, so the
// tables survive every clear. Read with atomicLoad and bitcast, which is what that buffer is.
//======================================================================================================================
import { LEARN_WORDS } from './tracebasics.js'

/* Table sizes. mu is the cosine to the normal, r the roughness (alpha = r^2, sqrt spacing puts the
   resolution where the lobe changes fastest), n the relative index of refraction 1..3. */
export const MF_NMU = 32
export const MF_NR = 32
export const MF_NIOR = 16
export const MF_EC = LEARN_WORDS                                  // [ior][r][mu] coat albedo
export const MF_ECAVG = MF_EC + MF_NIOR * MF_NR * MF_NMU          // [ior][r]     its cosine-weighted mean
export const MF_E1 = MF_ECAVG + MF_NIOR * MF_NR                   // [r][mu]      albedo at F = 1
/* THE ANISOTROPIC TABLES (SURFACES.md phase 1b). An anisotropic lobe's albedo is not the isotropic
   one at any single roughness: it depends on the view's AZIMUTH against the rough axis, by up to 0.1
   absolute at roughness 0.5, anisotropy 0.8 -- the furnace read 0.988 for such a metal. Neither the
   geometric mean alpha (what the isotropic lookup amounted to) nor the alpha projected on the view's
   azimuth fits (worst error 0.10 and 0.15 there), so these add the two dimensions: u, the log10 of
   the ratio of the two alphas (0 isotropic, 1 at |anisotropy| 1), and phi, the view's azimuth from the
   rough axis over 0..90 degrees (the lobe is symmetric in both). u is log-spaced because the ratio
   changes fastest near |anisotropy| 1: 8 x 8 so spaced interpolates to 0.0012 mean / 0.009 worst,
   as well as 12 x 12 spaced evenly (checked against a direct integration of this GGX, 2026-09-29).
   Only anisotropic materials read them; an isotropic one keeps the tables above, exactly. */
export const MF_NAN = 8
export const MF_NPHI = 8
export const MF_ECA = MF_E1 + MF_NR * MF_NMU                        // [ior][r][u][mu][phi]
export const MF_ECAAVG = MF_ECA + MF_NIOR * MF_NR * MF_NAN * MF_NMU * MF_NPHI   // [ior][r][u]
export const MF_E1A = MF_ECAAVG + MF_NIOR * MF_NR * MF_NAN          // [r][u][mu][phi]
export const MF_WORDS = MF_E1A + MF_NR * MF_NAN * MF_NMU * MF_NPHI - MF_EC
/* Samples per table entry: a 32 x 32 grid over the sampler's unit square, WARPED toward u.y = 1
   (prog_mf_lut says why). */
const MF_SQRT_SAMPLES = 32

/* Below this alpha a lobe is a DELTA -- one threshold for sampling, evaluation, the MIS pdf and the
   light-tracing split. 1e-3 is roughness 0.0316: under that, a GGX lobe is narrower than anything
   a march epsilon can resolve, and f/pdf is numerically meaningless anyway. */
export const ALPHA_MIN = 1e-3

export const MICROFACET = /*wgsl*/`
const ALPHA_MIN: f32 = ${ALPHA_MIN};
const MF_PI: f32 = 3.14159265358979;

// Smith Lambda for GGX, anisotropic. w in the local frame; symmetric in the sign of w.z, so it
// serves a transmitted direction as well.
fn mfLambda(w: vec3<f32>, a: vec2<f32>) -> f32 {
    let z2 = max(w.z * w.z, 1e-12);
    let t2 = (a.x * a.x * w.x * w.x + a.y * a.y * w.y * w.y) / z2;
    return 0.5 * (-1.0 + sqrt(1.0 + t2));
}
fn mfG1(w: vec3<f32>, a: vec2<f32>) -> f32 { return 1.0 / (1.0 + mfLambda(w, a)); }
/* THE TWO ALPHAS OF A ROUGHNESS AND AN |ANISOTROPY|: (rough, smooth), unclamped, their geometric
   mean r^2. One function, so the lobe (makeLobes) and the tables it reads cannot be built from two
   different spellings of it. */
fn mfAnisoAlpha(r: f32, an: f32) -> vec2<f32> {
    let aIso = r * r;
    let aspect = sqrt(1.0 - 0.9 * clamp(an, 0.0, 1.0));
    return vec2<f32>(aIso / aspect, aIso * aspect);
}
// the tables' anisotropy coordinate: log10 of rough / smooth, 0..1
fn mfAnisoU(an: f32) -> f32 { return -log(1.0 - 0.9 * clamp(an, 0.0, 1.0)) / 2.302585093; }
fn mfAnisoOfU(u: f32) -> f32 { return (1.0 - pow(10.0, -u)) / 0.9; }
// height-correlated masking-shadowing: more accurate than G1 G1, and what the tables integrate
fn mfG2(o: vec3<f32>, i: vec3<f32>, a: vec2<f32>) -> f32 {
    return 1.0 / (1.0 + mfLambda(o, a) + mfLambda(i, a));
}
fn mfD(h: vec3<f32>, a: vec2<f32>) -> f32 {
    if (h.z <= 0.0) { return 0.0; }
    let t = (h.x * h.x) / (a.x * a.x) + (h.y * h.y) / (a.y * a.y) + h.z * h.z;
    return 1.0 / (MF_PI * a.x * a.y * t * t);
}
/* A visible microfacet normal for view o (o.z > 0), by spherical caps -- Dupuy & Benyoub 2023:
   stretch o to the unit-roughness configuration, sample the cap of the unit sphere that o sees,
   unstretch. Its density is D_v(h) = G1(o) max(0, o.h) D(h) / o.z, exactly. */
fn mfSampleVNDF(o: vec3<f32>, a: vec2<f32>, u: vec2<f32>) -> vec3<f32> {
    let os = normalize(vec3<f32>(o.x * a.x, o.y * a.y, o.z));
    let phi = 2.0 * MF_PI * u.x;
    let z = (1.0 - u.y) * (1.0 + os.z) - os.z;
    let sinT = sqrt(clamp(1.0 - z * z, 0.0, 1.0));
    let c = vec3<f32>(sinT * cos(phi), sinT * sin(phi), z);
    let hs = c + os;
    return normalize(vec3<f32>(hs.x * a.x, hs.y * a.y, max(hs.z, 1e-7)));
}
/* The density of l = reflect(-o, h) with h from mfSampleVNDF: D_v(h) / (4 o.h) = G1(o) D(h) / (4 o.z).
   (The old one was D Gv NoH / (4 VoH), which only agrees at o = n.) */
fn mfPdfReflect(o: vec3<f32>, i: vec3<f32>, a: vec2<f32>) -> f32 {
    if (o.z <= 0.0 || i.z <= 0.0) { return 0.0; }
    let h = normalize(o + i);
    return mfG1(o, a) * mfD(h, a) / (4.0 * o.z);
}
/* Exact Fresnel reflectance of a dielectric interface for unpolarised light. eta = n_incident /
   n_transmitted, cosI the cosine on the incident side. 1 under total internal reflection -- and
   it rises to 1 continuously on the way there, which Schlick with a fixed F0 never did. */
fn fresnelDielectric(cosI_in: f32, eta: f32) -> f32 {
    let cosI = clamp(cosI_in, 0.0, 1.0);
    let sin2T = eta * eta * (1.0 - cosI * cosI);
    if (sin2T >= 1.0) { return 1.0; }
    let cosT = sqrt(1.0 - sin2T);
    let rs = (eta * cosI - cosT) / (eta * cosI + cosT);
    let rp = (cosI - eta * cosT) / (cosI + eta * cosT);
    return 0.5 * (rs * rs + rp * rp);
}
// Schlick for conductors, where F0 IS the parameter a user sets (the metal's colour)
fn fresnelSchlick3(cosI: f32, f0: vec3<f32>) -> vec3<f32> {
    return f0 + (vec3<f32>(1.0) - f0) * pow(1.0 - clamp(cosI, 0.0, 1.0), 5.0);
}
`

/* THE TABLES, READ. Needs the learn buffer, so it is only in the shade kernel's module (the LUT
   kernel writes the same words directly). Linear interpolation in every axis, clamped at the ends. */
export const MF_LUT_READ = /*wgsl*/`
const MF_NMU: u32 = ${MF_NMU}u;
const MF_NR: u32 = ${MF_NR}u;
const MF_NIOR: u32 = ${MF_NIOR}u;
const MF_EC: u32 = ${MF_EC}u;
const MF_ECAVG: u32 = ${MF_ECAVG}u;
const MF_E1: u32 = ${MF_E1}u;
fn mfLoad(i: u32) -> f32 { return bitcast<f32>(atomicLoad(&learn[i])); }
// continuous grid coordinate -> (lower index, fraction), clamped
fn mfAxis(x: f32, n: u32) -> vec2<f32> {
    let c = clamp(x, 0.0, f32(n - 1u));
    let i0 = min(floor(c), f32(n - 2u));
    return vec2<f32>(i0, c - i0);
}
fn mfMuX(mu: f32) -> f32 { return mu * f32(MF_NMU) - 0.5; }        // cell centres (j + 0.5) / NMU
fn mfRX(r: f32) -> f32 { return r * f32(MF_NR - 1u); }              // r = k / (NR - 1)
fn mfIorX(n: f32) -> f32 { return (n - 1.0) * f32(MF_NIOR - 1u) / 2.0; }   // n = 1 + 2 i / (NIOR - 1)
// coat albedo E(mu; r, n) -- single scatter, exact Fresnel at n = n_material / n_outside
fn mfEc(mu: f32, r: f32, n: f32) -> f32 {
    let am = mfAxis(mfMuX(mu), MF_NMU); let ar = mfAxis(mfRX(r), MF_NR); let an = mfAxis(mfIorX(n), MF_NIOR);
    var acc = 0.0;
    for (var c = 0u; c < 8u; c++) {
        let di = f32(c & 1u); let dk = f32((c >> 1u) & 1u); let dj = f32((c >> 2u) & 1u);
        let w = mix(1.0 - an.y, an.y, di) * mix(1.0 - ar.y, ar.y, dk) * mix(1.0 - am.y, am.y, dj);
        let idx = MF_EC + ((u32(an.x) + u32(di)) * MF_NR + u32(ar.x) + u32(dk)) * MF_NMU + u32(am.x) + u32(dj);
        acc += w * mfLoad(idx);
    }
    return acc;
}
fn mfEcAvg(r: f32, n: f32) -> f32 {
    let ar = mfAxis(mfRX(r), MF_NR); let an = mfAxis(mfIorX(n), MF_NIOR);
    var acc = 0.0;
    for (var c = 0u; c < 4u; c++) {
        let di = f32(c & 1u); let dk = f32((c >> 1u) & 1u);
        let w = mix(1.0 - an.y, an.y, di) * mix(1.0 - ar.y, ar.y, dk);
        acc += w * mfLoad(MF_ECAVG + (u32(an.x) + u32(di)) * MF_NR + u32(ar.x) + u32(dk));
    }
    return acc;
}
// the anisotropic ones: phi is the azimuth from the rough axis, 0..pi/2, at cell centres like mu
const MF_NAN: u32 = ${MF_NAN}u;
const MF_NPHI: u32 = ${MF_NPHI}u;
const MF_ECA: u32 = ${MF_ECA}u;
const MF_ECAAVG: u32 = ${MF_ECAAVG}u;
const MF_E1A: u32 = ${MF_E1A}u;
fn mfUX(u: f32) -> f32 { return u * f32(MF_NAN - 1u); }
fn mfPhiX(phi: f32) -> f32 { return phi / (0.5 * MF_PI) * f32(MF_NPHI) - 0.5; }
// [r][u][mu][phi] from base, interpolated in all four
fn mfRead4(base: u32, mu: f32, phi: f32, r: f32, u: f32) -> f32 {
    let ar = mfAxis(mfRX(r), MF_NR); let au = mfAxis(mfUX(u), MF_NAN);
    let am = mfAxis(mfMuX(mu), MF_NMU); let ap = mfAxis(mfPhiX(phi), MF_NPHI);
    var acc = 0.0;
    for (var c = 0u; c < 16u; c++) {
        let dk = f32(c & 1u); let dl = f32((c >> 1u) & 1u); let dj = f32((c >> 2u) & 1u); let dq = f32((c >> 3u) & 1u);
        let w = mix(1.0 - ar.y, ar.y, dk) * mix(1.0 - au.y, au.y, dl) * mix(1.0 - am.y, am.y, dj) * mix(1.0 - ap.y, ap.y, dq);
        let idx = base + (((u32(ar.x) + u32(dk)) * MF_NAN + u32(au.x) + u32(dl)) * MF_NMU + u32(am.x) + u32(dj)) * MF_NPHI + u32(ap.x) + u32(dq);
        acc += w * mfLoad(idx);
    }
    return acc;
}
fn mfE1A(mu: f32, phi: f32, r: f32, u: f32) -> f32 { return mfRead4(MF_E1A, mu, phi, r, u); }
fn mfEcA(mu: f32, phi: f32, r: f32, u: f32, n: f32) -> f32 {
    let an = mfAxis(mfIorX(n), MF_NIOR);
    let block = MF_NR * MF_NAN * MF_NMU * MF_NPHI;
    return mix(mfRead4(MF_ECA + u32(an.x) * block, mu, phi, r, u), mfRead4(MF_ECA + (u32(an.x) + 1u) * block, mu, phi, r, u), an.y);
}
fn mfEcAAvg(r: f32, u: f32, n: f32) -> f32 {
    let ar = mfAxis(mfRX(r), MF_NR); let au = mfAxis(mfUX(u), MF_NAN); let an = mfAxis(mfIorX(n), MF_NIOR);
    var acc = 0.0;
    for (var c = 0u; c < 8u; c++) {
        let di = f32(c & 1u); let dk = f32((c >> 1u) & 1u); let dl = f32((c >> 2u) & 1u);
        let w = mix(1.0 - an.y, an.y, di) * mix(1.0 - ar.y, ar.y, dk) * mix(1.0 - au.y, au.y, dl);
        acc += w * mfLoad(MF_ECAAVG + ((u32(an.x) + u32(di)) * MF_NR + u32(ar.x) + u32(dk)) * MF_NAN + u32(au.x) + u32(dl));
    }
    return acc;
}
// albedo of the single-scatter lobe at F = 1: what a white metal keeps
fn mfE1(mu: f32, r: f32) -> f32 {
    let am = mfAxis(mfMuX(mu), MF_NMU); let ar = mfAxis(mfRX(r), MF_NR);
    var acc = 0.0;
    for (var c = 0u; c < 4u; c++) {
        let dk = f32(c & 1u); let dj = f32((c >> 1u) & 1u);
        let w = mix(1.0 - ar.y, ar.y, dk) * mix(1.0 - am.y, am.y, dj);
        acc += w * mfLoad(MF_E1 + (u32(ar.x) + u32(dk)) * MF_NMU + u32(am.x) + u32(dj));
    }
    return acc;
}
`

/*======================================================================================================
  THE TABLE KERNELS. prog_mf_lut: one invocation per entry of Ec and E1, integrating the reflection
  lobe's albedo E(o) = integral F G2/G1(o) dD_v -- the expected weight of a VNDF-sampled reflection --
  over a stratified grid. prog_mf_lut_avg: one per (n, r), E_avg = 2 integral E(mu) mu dmu. Run once,
  at init; the tables depend on nothing but these functions.
======================================================================================================*/
const ENTRIES_EC = MF_NIOR * MF_NR * MF_NMU
const ENTRIES_E1 = MF_NR * MF_NMU
const ENTRIES_ECA = MF_NIOR * MF_NR * MF_NAN * MF_NMU * MF_NPHI
const ENTRIES_E1A = MF_NR * MF_NAN * MF_NMU * MF_NPHI
export const MF_LUT_ENTRIES = ENTRIES_EC + ENTRIES_E1 + ENTRIES_ECA + ENTRIES_E1A
/* The averages' entries: (ior, r) for the isotropic coat, then (ior, r, u) for the anisotropic one. */
export const MF_AVG_ENTRIES = MF_NIOR * MF_NR + MF_NIOR * MF_NR * MF_NAN
export let prog_mf_lut = async (WG) =>
    await WG.makeCompute(MICROFACET,
        /*wgsl*/`
        let e = gid.x;
        if (e >= ${MF_LUT_ENTRIES}u) { return; }
        /* Which table, and where in it: Ec [ior][r][mu], E1 [r][mu], then the anisotropic
           Ec [ior][r][u][mu][phi] and E1 [r][u][mu][phi]. Each region's index within its table is
           the entry's offset into the region; the destination is the table's own base, since the
           averages sit between Ec and E1 and e alone does not say where a word goes. */
        var dst = ${MF_EC}u + e;
        var ior = 1.0;
        var k = 0u;       // roughness
        var j = 0u;       // mu
        var l = 0u;       // anisotropy (u)
        var q = 0u;       // azimuth
        var aniso = false;
        var isE1 = false;
        if (e < ${ENTRIES_EC}u) {
            ior = 1.0 + 2.0 * f32(e / ${MF_NR * MF_NMU}u) / ${MF_NIOR - 1}.0;
            k = (e / ${MF_NMU}u) % ${MF_NR}u; j = e % ${MF_NMU}u;
        } else if (e < ${ENTRIES_EC + ENTRIES_E1}u) {
            let t = e - ${ENTRIES_EC}u;
            isE1 = true; k = t / ${MF_NMU}u; j = t % ${MF_NMU}u;
            dst = ${MF_E1}u + t;
        } else {
            aniso = true;
            var t = e - ${ENTRIES_EC + ENTRIES_E1}u;
            if (t >= ${ENTRIES_ECA}u) { t -= ${ENTRIES_ECA}u; isE1 = true; dst = ${MF_E1A}u + t; }
            else { ior = 1.0 + 2.0 * f32(t / ${MF_NR * MF_NAN * MF_NMU * MF_NPHI}u) / ${MF_NIOR - 1}.0; dst = ${MF_ECA}u + t; }
            q = t % ${MF_NPHI}u; j = (t / ${MF_NPHI}u) % ${MF_NMU}u;
            l = (t / ${MF_NPHI * MF_NMU}u) % ${MF_NAN}u; k = (t / ${MF_NPHI * MF_NMU * MF_NAN}u) % ${MF_NR}u;
        }
        let r = f32(k) / ${MF_NR - 1}.0;
        let mu = (f32(j) + 0.5) / ${MF_NMU}.0;
        let st = sqrt(max(0.0, 1.0 - mu * mu));
        var a = vec2<f32>(max(r * r, ALPHA_MIN));
        var o = vec3<f32>(st, 0.0, mu);
        if (aniso) {
            // x the rough axis, as mfAnisoAlpha orders them; clamped exactly as makeLobes clamps
            a = clamp(mfAnisoAlpha(r, mfAnisoOfU(f32(l) / ${MF_NAN - 1}.0)), vec2<f32>(ALPHA_MIN), vec2<f32>(1.0));
            let phi = (f32(q) + 0.5) / ${MF_NPHI}.0 * 0.5 * MF_PI;
            o = vec3<f32>(st * cos(phi), st * sin(phi), mu);
        }
        var acc = 0.0;
        for (var sy = 0u; sy < ${MF_SQRT_SAMPLES}u; sy++) {
            for (var sx = 0u; sx < ${MF_SQRT_SAMPLES}u; sx++) {
                /* THE GRID IS WARPED, u.y = 1 - (1 - v)^2 with weight 2 (1 - v). What a lobe loses is the
                   reflections that go below the horizon, and those come from the rim of the visible
                   cap -- u.y near 1 -- a sliver that at low roughness a regular 32 x 32 grid resolved
                   badly: it overstated the albedo by 0.3-0.7% at roughness 0.3 (0.97850 for 0.97505
                   converged), so Turquin under-compensated and a white metal of roughness 0.3 read
                   0.997 in the furnace -- predicted from the grid and then measured, 2026-09-29.
                   Warped, the worst entry over roughness 0.1-0.8 is 0.0010 off, from 0.0073, for the
                   same count. Anything less than a full re-integration of these tables could not fix
                   it: refining any interpolation axis left that row where it was. */
                let v = (vec2<f32>(f32(sx), f32(sy)) + 0.5) / ${MF_SQRT_SAMPLES}.0;
                let u = vec2<f32>(v.x, 1.0 - (1.0 - v.y) * (1.0 - v.y));
                let h = mfSampleVNDF(o, a, u);
                let i3 = reflect(-o, h);
                if (i3.z > 0.0) {
                    let fr = select(fresnelDielectric(dot(o, h), 1.0 / ior), 1.0, isE1);
                    acc += 2.0 * (1.0 - v.y) * fr * mfG2(o, i3, a) / mfG1(o, a);
                }
            }
        }
        atomicStore(&learn[dst], bitcast<u32>(acc / ${MF_SQRT_SAMPLES * MF_SQRT_SAMPLES}.0));
        `,
        {},
        { learn: 'array<atomic<u32>>' },
        { wg: [64, 1, 1] }
    )

/* E_avg = 2 integral E(mu) mu dmu -- and for the anisotropic coat over the azimuth too: the mean of
   the phi cells (the lobe is symmetric in both quadrants, so 0..90 degrees is the whole circle). That
   is what the Kulla-Conty coupling divides by: the cosine-weighted mean of E over every direction. */
export let prog_mf_lut_avg = async (WG) =>
    await WG.makeCompute(``,
        /*wgsl*/`
        let e = gid.x;
        if (e >= ${MF_AVG_ENTRIES}u) { return; }
        var acc = 0.0;
        if (e < ${MF_NIOR * MF_NR}u) {                    // (ior, r)
            for (var j = 0u; j < ${MF_NMU}u; j++) {
                let mu = (f32(j) + 0.5) / ${MF_NMU}.0;
                acc += 2.0 * bitcast<f32>(atomicLoad(&learn[${MF_EC}u + e * ${MF_NMU}u + j])) * mu / ${MF_NMU}.0;
            }
            atomicStore(&learn[${MF_ECAVG}u + e], bitcast<u32>(acc));
        } else {                                          // (ior, r, u)
            let t = e - ${MF_NIOR * MF_NR}u;
            for (var j = 0u; j < ${MF_NMU}u; j++) {
                let mu = (f32(j) + 0.5) / ${MF_NMU}.0;
                for (var q = 0u; q < ${MF_NPHI}u; q++) {
                    let w = bitcast<f32>(atomicLoad(&learn[${MF_ECA}u + (t * ${MF_NMU}u + j) * ${MF_NPHI}u + q]));
                    acc += 2.0 * w * mu / ${MF_NMU * MF_NPHI}.0;
                }
            }
            atomicStore(&learn[${MF_ECAAVG}u + t], bitcast<u32>(acc));
        }
        `,
        {},
        { learn: 'array<atomic<u32>>' },
        { wg: [64, 1, 1] }
    )
