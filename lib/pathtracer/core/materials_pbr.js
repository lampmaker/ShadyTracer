import { MICROFACET, MF_LUT_READ } from "./microfacet.js"
import { SPECTRAL_WGSL } from "./spectral.js"
import { LENS_WGSL } from "./lens.js"
import { SPPM_SHARED_WGSL } from "./sppm.js"

export let MATERIALS_PBR = /*wgsl*/`

//======================================================================================================================
// helper functions
fn saturate(x:f32)->f32 { return clamp(x, 0.0, 1.0); }
fn max3(a:VEC3)->f32 { return max(a.x, max(a.y, a.z)); }
fn mtlOrthonormalBasis(n: vec3<f32>) -> mat3x3<f32> {
  // Construct an orthonormal basis from a normal vector n.
  let s: vec3<f32> = select(normalize(cross(n, vec3<f32>(0.0,1.0,0.0))),
                            normalize(cross(n, vec3<f32>(0.0,0.0,1.0))),
                            abs(n.z) < 0.999);
  let t: vec3<f32> = cross(s, n);
  return mat3x3<f32>(s, t, n);
}


${MICROFACET}
${MF_LUT_READ}
${SPECTRAL_WGSL}
${LENS_WGSL}
${SPPM_SHARED_WGSL}

/* (0.22.3: build_tangent, mtl_toWorld, sampleHemisphereCosine_mtl and pdfHemisphereCosine went from here. Nothing
   called them: the diffuse lobe is sampled in lobesSample and weighed in lobesPdf below, and this model is in the
   shade kernel alone, so no scene's or material's own code could call them either.) */


/*==============================================================================================
  THE MATERIAL AS LOBES -- one description that sampling, evaluation and the MIS density all read,
  so the three cannot disagree about what the surface does. (They did: the sampler's pdf was only
  right at normal view, NEE evaluated a different Smith term, and the MIS density knew a third
  mirror threshold. See microfacet.js for what went wrong and what the pieces are.)

      f = metallic         * f_metal
        + (1 - metallic)   * [ f_coat + transmission * f_trans + (1 - transmission) * f_diff ]

    f_metal  GGX reflection, Schlick Fresnel with F0 = baseColor, times Turquin's
             1 + F0 (1/E1(o) - 1) for the energy single scattering loses (exact at F0 = 1)
    f_coat   GGX reflection with the EXACT dielectric Fresnel of the interface, scaled by
             coatK = mix(2 * specular, 1, transmission) x tint: specular 0.5 is the physical
             interface, 0 no coat at all (a pure Lambertian), and a transmissive material is
             always physical -- scaling glass's Fresnel would lose the light TIR must keep
    f_trans  GGX refraction through the same microfacets, (1 - F) x baseColor
    f_diff   baseColor (1 - Ec(o)) (1 - Ec(i)) / (pi (1 - Ec_avg)), Ec the coat's own albedo:
             whatever the coat does not reflect, the base gets -- a white plastic, a white
             Lambertian and smooth glass all pass a white furnace

  SAMPLED BY LOBE: pick metal with p = metallic, else the diffuse base with p = (1 - ps)(1 -
  transmission), ps the coat's Fresnel at the view, else the interface. A smooth interface then
  reflects with ps; a rough one draws its facet first and reflects by THAT facet's Fresnel, so
  every facet that can pass light is sampled for it (interfaceReflectP). The weight is the lobe's
  own f cos / pdf over the pick's probability. Unbiased only if no lobe with a value has pick
  probability 0 -- which ps = 1 past the critical angle broke for rough glass. A delta lobe (alpha < ALPHA_MIN) has no density: it is only ever sampled, and
  NEE's MIS treats a delta event as one light sampling could not have produced.
==============================================================================================*/
struct Lobes {
    tX: vec3<f32>, tY: vec3<f32>, nZ: vec3<f32>,   // the local frame; z is the normal
    o: vec3<f32>,            // the view, local
    a: vec2<f32>,            // anisotropic alpha, clamped to [ALPHA_MIN, 1]
    aMin: f32,               // the smaller UNclamped alpha: what the light-tracing split reads
    r: f32,                  // roughness, which is what the tables are indexed by
    isDelta: bool,           // reflection and refraction are mirrors
    metallic: f32,
    trans: f32,
    base: vec3<f32>,
    transTint: vec3<f32>,    // what a crossing multiplies by: base, or white when the volume absorbs instead
    coatK: vec3<f32>,        // scale on the exact Fresnel (see above)
    coated: bool,            // a coating is the interface here (Material2.coat): coatR, not coatK x Fresnel
    coatR: vec3<f32>,        // ...its reflectance per channel at the view's angle; 0 on an anti-reflective face
    pw: vec3<f32>,           // ...and what its channels weigh in the pick: the ray's own share of each (coatPick)
    eta: f32,                // n incident / n beyond, for Fresnel and refraction
    etaT: f32,               // ...and for the refracted direction alone: eta, but n(lambda)'s for a dispersed ray (0.40.0)
    nrel: f32,               // the tables' relative index, >= 1
    ps: f32,                 // probability of the coat within the dielectric part
    cm: vec3<f32>,           // Turquin's factor for the metal, at this view
    ecO: vec3<f32>,          // the coat's albedo at this view, scaled
    ecAvg: vec3<f32>,        // ...and its cosine-weighted mean
    anU: f32,                // the tables' anisotropy coordinate (mfAnisoU): 0 = isotropic tables
    roughX: bool,            // x is the rough axis: the tables' azimuth is measured from it
}
/* THE INTERFACE'S REFLECTANCE at cosI. A COATED one (makeLobes) is its coating's, taken at the view's angle for every
   facet -- exact for a smooth surface, the macro angle's for a rough one -- and total past the critical angle, which
   no coating changes. */
fn coatFresnel(lb: Lobes, cosI: f32) -> vec3<f32> {
    let f = fresnelDielectric(cosI, lb.eta);
    if (lb.coated) { return select(lb.coatR, vec3<f32>(1.0), f >= 1.0); }
    return min(lb.coatK * f, vec3<f32>(1.0));
}
/* HOW LIKELY A PICK IS TO REFLECT, of a reflectance per channel. Uncoated, the largest channel, as always (a tint
   scales one Fresnel). A COATING's channels can be anything -- a dichroic reflects red and passes blue -- and the
   largest would send nearly every ray to the mirror, leaving the channels it passes to a few rays of enormous weight:
   so the channels weighed by what the ray carries (pw, coatPick). A pure red ray then reflects as often as red does,
   with weight 1; a white one splits by the mean. */
fn reflectPick(lb: Lobes, c: vec3<f32>) -> f32 { return select(max3(c), dot(c, lb.pw), lb.coated); }
/* A local direction's azimuth from the rough axis, 0..pi/2 -- the anisotropic tables' phi. Straight
   up it has none, and none is needed (every azimuth agrees there). */
fn lobeAzimuth(lb: Lobes, w: VEC3) -> f32 {
    let wr = abs(select(w.y, w.x, lb.roughX));
    let ws = abs(select(w.x, w.y, lb.roughX));
    return atan2(ws, max(wr, 1e-12));
}
// w local; its albedo depends on its azimuth too when the lobe is anisotropic (phase 1b)
fn coatAlbedo(lb: Lobes, w: VEC3) -> vec3<f32> {
    // a coating's: its reflectance at the view, at every angle -- what the base under it is lit by, approximately
    if (lb.coated) { return lb.coatR; }
    var e: f32;
    if (lb.anU > 0.0) { e = mfEcA(w.z, lobeAzimuth(lb, w), lb.r, lb.anU, lb.nrel); }
    else { e = mfEc(w.z, lb.r, lb.nrel); }
    return min(lb.coatK * e, vec3<f32>(1.0));
}
fn toLocal(lb: Lobes, w: VEC3) -> VEC3 { return VEC3(dot(w, lb.tX), dot(w, lb.tY), dot(w, lb.nZ)); }
fn toWorldL(lb: Lobes, w: VEC3) -> VEC3 { return normalize(lb.tX * w.x + lb.tY * w.y + lb.nZ * w.z); }

/* eta = n_incident / n_beyond. The caller knows the media; see processMaterial_advanced. n0 is the incident medium's
   index and inside whether the view is from within the material: a coating needs both (where the light is, below). */
fn makeLobes(n: VEC3, v: VEC3, m: Material2, eta: f32, n0: f32, inside: bool) -> Lobes {
    var lb: Lobes;
    /* THE FRAME, which is where anisotropy points. With a grain (Material2.tangent) x is the grain
       projected onto the surface. Without one it is mtlOrthonormalBasis's: horizontal in the world
       and switching axis near the poles -- which is why anisotropy used to have no direction a
       material could choose. A grain that is (nearly) normal to the surface, or zero, has no
       direction on it and falls back too. Every consumer -- eval, pdf, sample, ltConnect -- builds
       its frame here from the same material, so they cannot disagree about it. */
    var fr = mtlOrthonormalBasis(n);
    let tp = m.tangent - n * dot(m.tangent, n);
    let tl = dot(tp, tp);
    let grained = tl > 1e-6 * dot(m.tangent, m.tangent) && tl > 1e-30;
    if (grained) {
        let tx = tp * inverseSqrt(tl);
        fr = mat3x3<f32>(tx, cross(tx, n), n);             // the same handedness as the fallback
    }
    lb.tX = fr[0]; lb.tY = fr[1]; lb.nZ = fr[2];
    lb.o = VEC3(dot(v, lb.tX), dot(v, lb.tY), max(dot(v, n), 1e-4));
    lb.r = clamp(m.roughness, 0.0, 1.0);
    let aIso = lb.r * lb.r;
    lb.isDelta = aIso < ALPHA_MIN;
    let an = clamp(m.anisotropy, -1.0, 1.0);
    let rs = mfAnisoAlpha(lb.r, abs(an));                  // (rough, smooth): the tables' own
    /* WITH A GRAIN THE SIGN MEANS SOMETHING. Brushing leaves grooves along the stroke: the facets
       tilt ACROSS it, so positive anisotropy is smooth along x (the grain) and rough along y,
       which draws the highlight out across the grooves as on real brushed metal; negative is the
       reverse. Without a grain the old formula stands, sign ignored, so no stored material moves. */
    let aRaw = select(rs, select(rs.yx, rs, an < 0.0), grained);
    lb.aMin = min(aRaw.x, aRaw.y);
    lb.a = clamp(aRaw, VEC2(ALPHA_MIN), VEC2(1.0));
    lb.anU = mfAnisoU(abs(an));
    lb.roughX = aRaw.x >= aRaw.y;
    lb.metallic = saturate(m.metallic);
    lb.trans = saturate(m.transmission);
    lb.base = m.baseColor;
    /* A MATERIAL THAT ABSORBS INSIDE (materials.js attenuationDistance) takes its colour off the ray as the ray travels
       through it (absorbAlong, tracebasics.js), so its interface passes every channel alike; tinted here too, the
       colour would be counted twice, once per crossing on top of the depth. Without one, the old rule: tinted at
       every crossing, whatever the thickness. */
    lb.transTint = select(m.baseColor, VEC3(1.0), m.attenuationDistance > 0.0);
    let lum = max3(m.baseColor);
    let tint = select(VEC3(1.0), m.baseColor / max(lum, 1e-6), lum > 0.0);
    lb.coatK = mix(2.0 * m.specular, 1.0, lb.trans) * mix(VEC3(1.0), tint, m.specularTint);
    lb.eta = eta;
    lb.etaT = eta;                                       // a dispersive refraction's own (processMaterial_advanced)
    lb.nrel = clamp(1.0 / eta, 1.0, 3.0);
    /* A COATING (Material2.coat, 0.39.0) is the interface instead of the bare Fresnel, on every face the light enters
       the material by; on a face it leaves by, as the material says: anti-reflective (nothing reflects but total
       internal reflection), the bare interface, or the coating again. Its reflectance per channel is the stack's
       R(lambda) averaged over each channel's wavelengths (spectral.js coatEdgeRGB), its edge moved by the light's
       invariant n0 sin(theta0) -- the same on every layer -- through the stack's effective index. Evaluated once, at
       the view: a smooth coating's angle exactly. */
    lb.coated = false;
    lb.coatR = VEC3(0.0);
    lb.pw = VEC3(1.0 / 3.0);
    if (m.coat != 0u) {
        if (!inside || m.coat == 3u) {
            let sin0 = sqrt(max(0.0, 1.0 - lb.o.z * lb.o.z));
            let lh = coatLowHigh(m);
            lb.coatR = coatEdgeRGB(lh.x, lh.y, coatEdgeAt(m.coatEdge, n0 * sin0, m.coatIndex), m.coatWidth);
            lb.coated = true;
        } else if (m.coat == 1u) {
            lb.coated = true;                                        // anti-reflective: coatR stays 0
        }
    }
    /* The coat's pick probability: its Fresnel at the view. Held under 1 unless the interface
       really is totally reflecting, so a base under it is never unreachable. */
    lb.ps = coatPs(lb);
    lb.ecO = coatAlbedo(lb, lb.o);
    /* THE ANISOTROPIC TABLES when the lobe is (microfacet.js, SURFACES.md phase 1b): its albedo
       depends on the view's azimuth, and the isotropic tables at the same roughness were off by up
       to 0.1 -- a white anisotropic metal read 0.988 in the furnace. */
    /* ONLY THE TABLES SOMETHING READS (0.61.2), each one an atomicLoad of the learn buffer and branched, not selected
       (a select reads both): e1 only for a metal -- cm is read only times metallic, or on the metal's own branch, and
       1 there gives cm 1, finite as any -- the average only for an uncoated lobe, whose ecAvg it is, and the
       isotropic pair no longer read and then overwritten by the anisotropic one. Every value read is the one read before. */
    var e1 = 1.0;
    var eAvg = 0.0;
    if (lb.anU > 0.0) {
        if (lb.metallic > 0.0) { e1 = mfE1A(lb.o.z, lobeAzimuth(lb, lb.o), lb.r, lb.anU); }
        if (!lb.coated) { eAvg = mfEcAAvg(lb.r, lb.anU, lb.nrel); }
    } else {
        if (lb.metallic > 0.0) { e1 = mfE1(lb.o.z, lb.r); }
        if (!lb.coated) { eAvg = mfEcAvg(lb.r, lb.nrel); }
    }
    lb.ecAvg = select(min(lb.coatK * eAvg, VEC3(1.0)), lb.coatR, lb.coated);
    lb.cm = VEC3(1.0) + m.baseColor * (1.0 / max(e1, 1e-3) - 1.0);
    return lb;
}
// the coat's pick probability at the view (makeLobes, coatPick)
fn coatPs(lb: Lobes) -> f32 {
    let fo = reflectPick(lb, coatFresnel(lb, lb.o.z));
    return min(fo, select(0.999, 1.0, fresnelDielectric(lb.o.z, lb.eta) >= 1.0));
}
/* A COATING'S PICK WEIGHED BY THE RAY (reflectPick): its channels' shares of what the ray carries, |beta| -- a light
   outside the gamut has a negative channel, which still carries light -- or alike for a ray carrying nothing. Only
   where a ray scatters (processMaterial_advanced): every density its MIS reads is then this lobe's own. ltConnect's
   lobes keep the even weights, which is what the camera's first vertex has (its beta is white). */
fn coatPick(lb_in: Lobes, beta: vec3<f32>) -> Lobes {
    var lb = lb_in;
    if (!lb.coated) { return lb; }
    let a = abs(beta);
    let t = a.x + a.y + a.z;
    lb.pw = select(VEC3(1.0 / 3.0), a / t, t > 0.0);
    lb.ps = coatPs(lb);
    return lb;
}

/* f for a direction above the surface, delta lobes excluded (they have no value to give), and
   the glossy lobes only from alpha minAlpha up -- 0 for NEE, LT_MIN_ALPHA for light tracing,
   whose connection must equal the camera side's EVAL events and nothing else. */
fn lobesEval(lb: Lobes, l: VEC3, minAlpha: f32) -> VEC3 {
    let i = toLocal(lb, l);
    if (i.z <= 0.0) { return VEC3(0.0); }
    var f = VEC3(0.0);
    if (!lb.isDelta && lb.aMin >= minAlpha) {
        let h = normalize(lb.o + i);
        let spec = mfD(h, lb.a) * mfG2(lb.o, i, lb.a) / (4.0 * lb.o.z * i.z);
        let oh = dot(lb.o, h);
        f += lb.metallic * lb.cm * fresnelSchlick3(oh, lb.base) * spec;
        f += (1.0 - lb.metallic) * coatFresnel(lb, oh) * spec;
    }
    /* THE BASE, where there is one: with none (all metal, or all transmission) its term is 0 times what is finite, and
       adding that 0 changes no bit of f -- so the albedo table is not read for it (0.61.2; mfLoad is an atomicLoad) */
    let wDiff = (1.0 - lb.metallic) * (1.0 - lb.trans);
    if (wDiff > 0.0) {
        let ecI = coatAlbedo(lb, i);
        f += wDiff * lb.base * (VEC3(1.0) - lb.ecO) * (VEC3(1.0) - ecI)
             / (MF_PI * max(VEC3(1.0) - lb.ecAvg, VEC3(1e-4)));
    }
    return f;
}
/* NOTHING TO EVALUATE (0.61.2): every lobe a delta -- alpha under ALPHA_MIN, as makeLobes decides it -- and no base under
   them, all metal or all transmission: a mirror, clear glass, a dichroic plate. lobesEval is exactly 0 there for every
   direction and every floor (its specular term needs !isDelta, its base term (1 - metallic)(1 - transmission)), so what
   is only ever multiplied by it -- a photon's connection, a light sample -- adds nothing, and its callers stop before
   the work rather than after it: makeLobes's coating alone is 41 exp and log (spectral.js coatEdgeRGB). From the
   material, with makeLobes's own arithmetic, so the two cannot disagree; test/sppm.gpu.mjs holds lobesEval to it. A
   test before the work, never the answer. */
fn lobesNone(m: Material2) -> bool {
    let r = clamp(m.roughness, 0.0, 1.0);
    return r * r < ALPHA_MIN && (1.0 - saturate(m.metallic)) * (1.0 - saturate(m.transmission)) <= 0.0;
}

/* The density the lobe sampler has for a direction above the surface, over its continuous lobes
   -- exactly, now: the pick probabilities times each lobe's own pdf. Used as the MIS weight's
   BSDF density; delta lobes are handled by the caller. */
fn lobesPdf(lb: Lobes, l: VEC3) -> f32 {
    let i = toLocal(lb, l);
    if (i.z <= 0.0) { return 0.0; }
    let wd = 1.0 - lb.metallic;
    let pd = (1.0 - lb.ps) * (1.0 - lb.trans);
    var p = wd * pd * i.z / MF_PI;
    if (!lb.isDelta) {
        let pr = mfPdfReflect(lb.o, i, lb.a);
        p += (lb.metallic + wd * (1.0 - pd) * interfaceReflectP(lb, dot(lb.o, normalize(lb.o + i)))) * pr;
    }
    return p;
}

/* Within a rough interface event, the probability of reflecting off the facet h that was drawn:
   its own Fresnel against what transmission would carry, Fh / (Fh + (1 - Fh) transmission). 1
   for an opaque dielectric (all the interface does is reflect; the rest is the base's), Fh for
   glass -- Walter et al. 2007's choice, which sends a facet in total internal reflection to
   reflection and lets every facet that can pass light, pass it. */
fn interfaceReflectP(lb: Lobes, oh: f32) -> f32 {
    let fh = reflectPick(lb, coatFresnel(lb, oh));
    let den = fh + (1.0 - fh) * lb.trans;
    return select(1.0, fh / den, den > 1e-6);
}

struct LobeSample {
    dir: VEC3,
    w: VEC3,             // f cos / (pick probability x pdf); 0 means the path ends here
    ev: u32,             // EV_* for the light-tracing split
    isDelta: bool,       // for MIS: light sampling could not have produced this direction
    transmitted: bool,   // the ray crossed into the medium beyond
    diffuse: bool,       // the diffuse base was drawn (an EV_EVAL glossy reflection is not): LAST_DIFFUSE
}
fn lobesSample(lb: Lobes, rnd: vec4<f32>) -> LobeSample {
    var s: LobeSample;
    s.w = VEC3(0.0);
    s.ev = EV_OTHER;
    s.isDelta = false;
    s.transmitted = false;
    s.diffuse = false;
    var i = VEC3(0.0, 0.0, 1.0);
    let glossyEv = select(EV_OTHER, EV_EVAL, lb.aMin >= LT_MIN_ALPHA);
    let wd = 1.0 - lb.metallic;
    var pick = rnd.x;
    if (pick < lb.metallic) {                                     // ---- metal
        if (lb.isDelta) {
            i = VEC3(-lb.o.x, -lb.o.y, lb.o.z);
            s.w = fresnelSchlick3(lb.o.z, lb.base) * lb.cm;
            s.ev = EV_DELTA; s.isDelta = true;
        } else {
            let h = mfSampleVNDF(lb.o, lb.a, rnd.yz);
            i = reflect(-lb.o, h);
            if (i.z > 0.0) {
                s.w = lb.cm * fresnelSchlick3(dot(lb.o, h), lb.base) * mfG2(lb.o, i, lb.a) / mfG1(lb.o, lb.a);
            }
            s.ev = glossyEv;
        }
    } else {
        pick = (pick - lb.metallic) / max(wd, 1e-6);
        /* THE INTERFACE (coat reflection or transmission) against THE DIFFUSE BASE. The base is
           what neither reflects nor transmits: probability pd = (1 - ps)(1 - transmission).
           A ROUGH INTERFACE DRAWS ITS FACET FIRST and then decides by that facet's Fresnel
           (interfaceReflectP). It used to decide by ps, the Fresnel at the MACRO angle, which is
           exactly 1 past the critical angle -- and then no transmission was ever sampled, though
           plenty of tilted facets still let light out; the reflection branch carried only F(h)
           of it. Inside a rough sphere, where internal rays soon arrive past the critical angle,
           that lost ~10% of the light in the white furnace (the sphere read 0.92). */
        let pd = (1.0 - lb.ps) * (1.0 - lb.trans);
        if (pick < 1.0 - pd) {
            let sub = pick / max(1.0 - pd, 1e-6);
            if (lb.isDelta) {
                // a smooth interface's facet is the normal: ps is its Fresnel, exactly
                if (sub < lb.ps / max(1.0 - pd, 1e-6)) {                     // ---- mirror coat
                    i = VEC3(-lb.o.x, -lb.o.y, lb.o.z);
                    s.w = coatFresnel(lb, lb.o.z) / lb.ps;
                } else {                                                      // ---- clear refraction
                    s.transmitted = true;
                    i = refract(-lb.o, VEC3(0.0, 0.0, 1.0), lb.etaT);
                    if (i.z < 0.0) { s.w = (VEC3(1.0) - coatFresnel(lb, lb.o.z)) * lb.transTint / (1.0 - lb.ps); }
                }
                s.ev = EV_DELTA; s.isDelta = true;
            } else {
                let h = mfSampleVNDF(lb.o, lb.a, rnd.yz);
                let oh = dot(lb.o, h);
                let fc = coatFresnel(lb, oh);
                let r = interfaceReflectP(lb, oh);
                if (sub < r) {                                                // ---- glossy coat
                    i = reflect(-lb.o, h);
                    if (i.z > 0.0) {
                        s.w = fc * mfG2(lb.o, i, lb.a) / mfG1(lb.o, lb.a) / ((1.0 - pd) * r);
                    }
                    s.ev = glossyEv;
                } else {                                                      // ---- rough refraction
                    s.transmitted = true;
                    i = refract(-lb.o, h, lb.etaT);
                    // nothing that fails to cross the macro-surface; the facet's own TIR never
                    // gets here (r = 1 there)
                    if (i.z < 0.0) {
                        s.w = lb.trans * (VEC3(1.0) - fc) * lb.transTint * mfG2(lb.o, i, lb.a) / mfG1(lb.o, lb.a)
                              / ((1.0 - pd) * (1.0 - r));
                    }
                    s.ev = EV_OTHER;                              // no evaluable BTDF on the other side
                }
            }
        } else {                                                  // ---- diffuse base
            let r = sqrt(rnd.y);
            let phi = 2.0 * MF_PI * rnd.z;
            i = VEC3(r * cos(phi), r * sin(phi), sqrt(max(0.0, 1.0 - rnd.y)));
            let ecI = coatAlbedo(lb, i);
            s.w = lb.base * (VEC3(1.0) - lb.ecO) * (VEC3(1.0) - ecI)
                  / max(VEC3(1.0) - lb.ecAvg, VEC3(1e-4)) / (1.0 - lb.ps);
            s.ev = EV_EVAL;
            s.diffuse = true;
        }
    }
    s.dir = toWorldL(lb, i);
    return s;
}

/*==============================================================================================
  LIGHT TRACING -- caustics, by walking from the sun instead of from the eye.

  WHY. A caustic is sun -> glass or mirror (one or more DELTA events) -> a diffuse or glossy
  surface -> eye. The camera side cannot find it except by luck: at the diffuse point it must
  guess the one direction that the glass maps onto the solar disc, and NEE cannot help because a
  delta chain has no density to aim a shadow ray through -- so glass casts a shadow. From the
  sun it is easy: the photon goes through the glass exactly by Snell and Fresnel, lands where
  the optics put it, and then only has to ask whether the camera sees that point.

  THE SPLIT, which is what keeps the total right. Path space is divided, not blended:
    the LIGHT TRACER counts   sun -> DELTA+ -> vertex x1 (its EVAL part) -> camera, x1 seen directly
    the CAMERA SIDE counts    everything else, and on escape leaves out the solar disc for a
                              path tagged CLS_CAND|CLS_SPEC -- exactly the class above -- whose
                              line a photon could have come down (ltCovers, sdf.js). Lines
                              outside the photon square stay with the camera side, so the
                              square decides the noise and never the total.
  Both sides classify with the same EV_* the material sets, so "EVAL at x1" means the same
  thing to both. Nothing is weighted; each path is counted by exactly one side. The sky seen
  through glass stays on the camera side (only the disc is emitted), as do caustics seen
  THROUGH glass or in a mirror (x1 not directly visible): those need SPPM.

  WHAT A CONNECTION'S EVAL LOBES MUST EQUAL (ltConnect): the expected value of the camera side's sampled weight, restricted
  to EVAL events, as f*cos. lobesSample's weights are each lobe's f cos / pdf over its pick
  probability, so their expectation over the EVAL events is exactly lobesEval over the lobes that
  lobesSample calls EVAL -- the diffuse base always, the glossy lobes from LT_MIN_ALPHA up. TIR
  cannot happen at x1: the camera ray is in air, so eta <= 1.
==============================================================================================*/
/* THE CONNECTION. Where on the picture this point lands and what it adds there.

   The camera side estimates a pixel as the mean radiance over rays spread UNIFORMLY OVER THE
   PIXEL'S AREA on the image plane at distance 1 (genrays jitters in uv). Rewritten as an
   integral over surface area, a point x contributes L(x -> eye) * G / A_px with
       G = |n.v| * dist / z^3        (perspective: dA on the plane -> solid angle -> area at x;
                                      z is depth along the view axis, dist the true distance)
       G = |n.v|                     (orthographic: the plane IS the area measure)
   and A_px = (2 fx)(2 fy) / (w h), the pixel's area on that plane. A photon carries flux, so
   L_in cos_in dw dA is already in it and the splat is  flux * beta * f * G / A_px.
   The pixel is found with genrays' own mapping backwards, so a photon lands on the pixel whose
   rays would have seen the same point. */
/* THE CAMERA'S FOOTPRINT at a point it sees: G, the Jacobian from the image plane (at distance 1)
   to area at P, and A_px, a pixel's area on that plane -- a camera ray lands on P with density G / A_px
   per pixel. ltConnect weighs a photon's splat by it, and the lights' MIS (Ray.ltMis) weighs the two
   strategies by it from both ends, so there is one copy. G is 0 where the camera cannot see P. */
fn camFootprint(P: VEC3, nrm: VEC3) -> VEC2 {
    let fwd = UB.invView[2].xyz;                // target -> camera, as genrays reads it
    let fx = UB.invProjection[0][0];
    let fy = UB.invProjection[1][1];
    let fres = VEC2(UB.res);
    let apx = 4.0 * fx * fy / (fres.x * fres.y);
    let d = UB.camPos.xyz - P;
    if (UB.camtype == 0u) {
        let dist = length(d);
        let z = dot(d, fwd);                      // depth in front of the camera
        if (z <= 1e-4 || dist <= 1e-4) { return VEC2(0.0, apx); }
        return VEC2(abs(dot(nrm, d / dist)) * dist / (z * z * z), apx);
    }
    return VEC2(abs(dot(nrm, fwd)), apx);
}

/* (Through the glass a photon is in, the manifold connection joined it to the camera from 0.44.0 to 0.60.0, through this
   function; the photon map gathers that light now -- core/sppm.js -- and it went in 0.61.0.) */
fn ltConnect(ray: Ray, m: Material2, nrm: VEC3) {
    if (max3(m.emissive) > 0.0 || abs(ray.n - 1.0) > 1e-3) { return; }   // an emitter; or not in air
    /* NOT ON THE LAST PASS, and unlike NEE this one costs light: the occlusion pass traces a
       queued ray on the NEXT iteration, so a connection made now is never traced, and there is
       no camera-side fallback to hand the path back to. It is the same truncation THE FLUSH
       accepts for a camera path that runs out of iterations -- rare at the worst-case budget,
       and a reason not to squeeze budgetOverride with light tracing on. */
    if (UB.lastpass != 0u) { return; }
    let P = ray.pos;
    let right = UB.invView[0].xyz;
    let up    = UB.invView[1].xyz;
    let fwd   = UB.invView[2].xyz;              // target -> camera, as genrays reads it
    let fx = UB.invProjection[0][0];
    let fy = UB.invProjection[1][1];
    let fres = VEC2(UB.res);
    /* the camera's footprint at P from its centre: the lights' MIS below weighs by it, and the camera's half of that MIS
       (processMaterial, Ray.ltMis) by the same function of P, so the two weights still sum to 1 through a lens */
    let foot = camFootprint(P, nrm);
    let apx = foot.y;
    var G = foot.x;

    /* THROUGH THE LENS (0.43.0; lens.js): to a point of its disc drawn uniformly, and from there everything below --
       the footprint G is the pinhole's measured from that point, the pixel the one its ray through the focus plane
       lands on, the shadow ray aimed at it. Drawn only with a lens, so a pinhole's photons draw the numbers they did. */
    let R = select(0.0, UB.camLens.x, UB.camtype == 0u);
    var off = VEC3(0.0);
    if (R > 0.0) { off = lensDisc(right, up, R, PRNG().xy); }
    /* NOTHING HERE TO CONNECT THROUGH (lobesNone, 0.61.2): a mirror, clear glass, a dichroic -- f below is 0, so the
       contribution is, and it would return there, after makeLobes and lobesEval. A light's photons call this at every
       surface they land on (TAG_LTALL), the scene's plates included. After the lens's draw, so every number drawn
       after this one is the number it was. */
    if (lobesNone(m)) { return; }
    let camPos = UB.camPos.xyz + off;
    let d = camPos - P;
    var v: VEC3;
    var dist: f32;
    var xy: VEC2;
    if (UB.camtype == 0u) {
        dist = length(d);
        let z = dot(d, fwd);                      // depth in front of the camera
        if (z <= 1e-4 || dist <= 1e-4) { return; }
        v = d / dist;
        xy = VEC2(-dot(d, right) / (z * fx), -dot(d, up) / (z * fy));
        if (R > 0.0) {
            xy = lensImage(off, -v, right, up, fwd, fx, fy, UB.camLens.y).xy;
            G = abs(dot(nrm, v)) * dist / (z * z * z);
        }
    } else {
        dist = dot(d, fwd);                       // to the camera plane along the view axis
        if (dist <= 1e-4) { return; }
        v = fwd;
        xy = VEC2(-dot(d, right) / fx, -dot(d, up) / fy);
    }
    if (abs(xy.x) >= 1.0 || abs(xy.y) >= 1.0) { return; }   // off the picture
    if (dot(nrm, v) <= 0.0) { return; }          // the camera is on the other side of the surface

    /* WHICH LOBES, AND HOW MUCH (Ray.ltMis). A photon of a source no camera path can meet (ltMis < 0:
       no face, or collimated) evaluates every lobe it can: nothing else counts that light. A light's
       photon at its first surface (bounces 1), while the camera's paths share those paths
       (ltLightFlux), evaluates every lobe too and keeps R / (1 + R) of each -- R this strategy's
       density over the camera's, the number the face works out from the other end (codegen LIGHTS).
       Anything else: the lobes a connection owns outright (EV_EVAL, from LT_MIN_ALPHA up), weight 1 -- L4's
       split. The lobes are the camera's own at this vertex (the view is the camera's; in air), so
       their pdf is the one its sampler has. NEVER SHARED IN A FAST MODE (renderMode != 0; FAST
       MODES): the camera's path stops at this vertex there, so it never makes the other half. */
    /* WHAT IT EVALUATES, then: every lobe (minAlpha 0) for a source no path can meet, or a shared
       path; otherwise the camera side's expected weight restricted to EVAL events, as f -- lobesEval
       with the glossy lobes counted from LT_MIN_ALPHA up (the split's boundary), since that is exactly
       where lobesSample starts calling a glossy reflection EVAL. The photon is in air (returned above
       otherwise), so the interface is air to this material's IOR -- what the camera side computes
       too, for anything but a surface nested in another medium.
       ONE makeLobes AND ONE lobesEval, the floor chosen at run time (0.10.0). The three cases each
       made their own -- the EVAL one through a helper, ltEvalBsdf -- and every call is a whole copy
       of the BSDF once the compiler inlines it, in shade and the optics trace alike. A NaN ltMis is
       neither < 0 nor > 0, so it takes the EVAL lobes, as it did. */
    /* (in air ownMedium(m, 1) is max(ior, 1): the interface it always was) */
    let l = -ray.dir;
    let lb = makeLobes(nrm, v, m, 1.0 / ownMedium(m, 1.0), 1.0, false);
    let ltShared = ray.ltMis > 0.0 && ray.bounces == 1u && UB.ltLightFlux > 0.0 && UB.renderMode == 0u;
    let f = lobesEval(lb, l, select(LT_MIN_ALPHA, 0.0, ray.ltMis < 0.0 || ltShared));
    var w = 1.0;
    if (ltShared) {
        let r = ray.ltMis * abs(dot(nrm, l)) * apx / (max(foot.x, 1e-30) * max(lobesPdf(lb, l), 1e-30));
        w = r / (1.0 + r);
    }
    /* A light outside the Rec.709 gamut (a royal-blue LED) carries its exact colour, a channel
       negative (core/colorimetry.js), and it is deposited AS IT IS: clipping each photon to the
       gamut here, as this first did, shifts a mix of such lights -- the sum of clipped colours is
       not the clipped sum. The display clips, once per pixel (rendertoscreen.js). */
    let contrib = ray.radiance * ray.beta * f * (G / apx * w);
    if (dot(contrib, VEC3(0.2126, 0.7152, 0.0722)) <= 0.0) { return; }

    let uv = (xy + VEC2(1.0)) * 0.5;              // genrays: xy = uv * 2 - 1
    let p = vec2<u32>(clamp(uv * fres, VEC2(0.0), fres - VEC2(1.0)));
    /* WHERE THE SHADOW RAY STARTS: ON THE CAMERA'S LINE OF SIGHT TO P, as far along it as lifts it off the surface.
       It asks whether the camera sees P, so it must trace the line the camera sees P along -- every occluder is then
       judged where the picture shows it. It started at P + nrm h instead, aimed along v from P: a line PARALLEL to the
       line of sight, h to one side of it all the way to the camera, which it missed by h. Seen from the camera an
       occluder at distance D was tested h/D to one side of where it is drawn, so the light a surface sends past
       something in front of it was cut off beside that thing rather than at its edge: a shadow offset from the
       object, wider the nearer the object is to the camera. h is 20 times the march epsilon, 2 cm in a room. (The
       user saw such a shadow round an object in front of a lamp-lit diffuse surface, 2026-10-07; this is the cause
       read in code, not yet confirmed on their picture.) Re-aiming from P + nrm h at the camera, as light sampling
       towards a face does below, would only leave the angle h subtends at P, a band of fixed width round every
       silhouette.
       Along the line, a distance s lifts the ray h off the surface where s = h / (nrm.v); the part of the line
       skipped is only ever within h of P's surface. AT GRAZING VIEWS that s grows without bound, so it stops at 4 h
       and the rest of the height is taken along the normal, re-aimed at the camera: below nrm.v = 1/4 the line is
       off by at most the angle (h - 4 h nrm.v) subtends at P, never more than the re-aim alone. 4 is a choice, not a
       measurement: how much of the line beside P goes untested against how far into grazing views the line is exact.
       Orthographic: v is the view axis, so the same start is on the ray of P's own pixel, and dist its depth. */
    let h = offsetTol(P) * 2.0;
    let cv = dot(nrm, v);                         // > 0: returned above otherwise
    let grazing = cv < 0.25;
    let s = h / max(cv, 0.25);
    let lift = select(0.0, h - s * cv, grazing);  // the height s leaves, along the normal
    let O = P + v * s + nrm * lift;
    var dir = v;
    /* how far it goes: short of the camera by h, as before -- dist less what the start took, along v (exact for
       orthographic, whose dist is a depth, and for perspective off grazing, where O is on the line) */
    var tmax = dist - s - cv * lift - h;
    if (grazing && UB.camtype == 0u) {
        let toCam = camPos - O;
        let l = length(toCam);
        dir = toCam / max(l, 1e-30);
        tmax = l - h;
    }
    NEE_RAY = ray;
    NEE_RAY.pos = O;
    NEE_RAY.dir = dir;
    NEE_RAY.radiance = contrib;
    NEE_RAY.beta = VEC3(1.0);
    NEE_RAY.steps = 0u;
    NEE_RAY.ltot = 0.0;
    NEE_RAY.absLtot = 0.0;                        // its own length absorbed from its start (prog_occlude)
    NEE_RAY.n = 1.0;                              // ltot counts optical length; this is air
    NEE_RAY.bounces = 0u;
    NEE_RAY.state = RAY_ACTIVE;
    NEE_RAY.tag = TAG_CONN;
    NEE_RAY.tmax = tmax;
    NEE_RAY.pix = p.x + p.y * UB.res.x;
    NEE_VALID = true;
    // and teach the emission map: this photon's cell produced something the camera can use
    if (ray.pix < LT_CELLS) { atomicAdd(&learn[ray.pix], 1u); }
}

/*==============================================================================================
  THE CLASS THE PHOTON MAP OWNS (sppm.js), named for the lens that owned it first:
      light -> delta+ -> D (EV_EVAL) -> delta+ -> eye,
  the floor behind a glass pane, lit through it and seen through it. Each side keeps its place in that
  pattern in a field of Ray.tag (tracebasics.js LENS_PH_SHIFT, LENS_CAM_SHIFT), and both classify by
  the EV_* the material sets, so D means the same thing from either end, as light tracing's split
  does. A photon is stored where it lands with its field 0 and TAG_PASSED (delta events only, one at
  least); a camera ray gathers where it lands with its field 1 (the same from the eye); the camera's
  path then leaves the class -- the light it reaches past D through delta events -- to the map.
  WHO OWNED IT BEFORE, AND WHY THEY WENT (0.61.0): photons that happened to cross the camera's
  aperture (0.43.0, lensHit -- the white specks in the user's picture of 2026-10-15) and, for D
  inside glass with one refraction to the eye, the manifold connection (0.44.0, core/manifold.js:
  Newton's method on the face, in the surface kernel). The map gathers all of it, through any chain
  of glass and mirrors, and both went with the map on by default. The aperture stays: depth of field.
==============================================================================================*/
fn lensField(tag: u32, shift: u32) -> u32 { return (tag >> shift) & 3u; }
fn withLensField(tag: u32, shift: u32, v: u32) -> u32 { return (tag & ~(3u << shift)) | (v << shift); }
/* ONE EVENT ON: the tag with its field moved by the event just drawn -- a photon's (photon) or a camera
   path's -- at this bounce. A photon: 0 stays 0 through a delta, anything else -> 3, out (it has
   scattered: only a source no camera path can meet is stored past that, sppm.js). A camera path: at its
   first surface 1 for a delta, else 0; 1 stays 1 through a delta and -> 2 at an EV_EVAL event; 2 or 3 ->
   3 through a delta; anything else -> 0, out. */
fn lensStep(tag: u32, photon: bool, bounces: u32, ev: u32) -> u32 {
    let delta = ev == EV_DELTA;
    if (photon) {
        return withLensField(tag, LENS_PH_SHIFT, select(3u, 0u, lensField(tag, LENS_PH_SHIFT) == 0u && delta));
    }
    let f = lensField(tag, LENS_CAM_SHIFT);
    var g = 0u;
    if (bounces == 1u) { g = select(0u, 1u, delta); }
    else if (f == 1u) { g = select(select(0u, 2u, ev == EV_EVAL), 1u, delta); }
    else if ((f == 2u || f == 3u) && delta) { g = 3u; }
    return withLensField(tag, LENS_CAM_SHIFT, g);
}
/* A CAMERA PATH ARMED (field 3): the light it reaches now -- with nothing but delta events since its
   D -- is the photon map's, while the map owns the class (sppmSplit; the caller says whose photons
   run: the sun's, the emitters', the lights'). */
fn lensOwned(tag: u32) -> bool {
    return sppmSplit() && (tag & TAG_PHOTON) == 0u && lensField(tag, LENS_CAM_SHIFT) == 3u;
}

/*==============================================================================================
  EMISSIVE SURFACES -- DISCOVERY. Every camera path that hits an emissive surface records where:
  the tight box of hits per voxel of a grid over +-emitHalf, and how bright. prog_emit_collect
  and prog_emit_publish turn that into the list NEE and the emitter photons sample from. Nothing
  is declared by the scene: an emitter is found the first time any path sees it.
==============================================================================================*/
fn emitDeposit(p: VEC3, Le: VEC3) {
    let R = UB.emitHalf;                          // metres: emitRadius, capped at the scene's radius
    let u = (p + VEC3(R)) / (2.0 * R);
    if (any(u < VEC3(0.0)) || any(u >= VEC3(1.0))) { return; }
    let v = vec3<u32>(u * f32(EG));
    let cell = v.x + EG * (v.y + EG * v.z);
    let q = vec3<u32>(u * 16777215.0);
    let base = EV_BASE + cell * 8u;
    atomicMin(&learn[base + 0u], q.x); atomicMin(&learn[base + 1u], q.y); atomicMin(&learn[base + 2u], q.z);
    atomicMax(&learn[base + 3u], q.x); atomicMax(&learn[base + 4u], q.y); atomicMax(&learn[base + 5u], q.z);
    let lum = dot(Le, VEC3(0.2126, 0.7152, 0.0722));
    /* The BRIGHTEST emission seen here, not a sum: a screen-filling emitter is a million hits a
       sample, and a sum of their luminance wraps a u32 inside one. Log-encoded -- see LUM_CODE
       in tracebasics.js for why the linear code it replaces saturated in cd/m^2. */
    atomicMax(&learn[base + 6u], lumEncode(lum));
    atomicAdd(&learn[base + 7u], 1u);
}

/* How often NEE aims at emitters rather than the environment: UB.neeEmitShare once anything has
   been discovered, 0 before -- so an emitter-free scene samples exactly as it always did. */
fn emitShare() -> f32 { return select(0.0, clamp(UB.neeEmitShare, 0.05, 0.95), emitCount() > 0u); }

/*==============================================================================================
  FAST MODES (UB.renderMode; quality.js): DRAFT (1), SKETCH (2) and OPTICS (3), for building a scene
  or following its optics rather than judging its light. Camera paths only -- a photon, a probe or an
  optics ray is never in one, so light tracing, the optics trace and the optics source lighting the
  picture are as in full (but for where Optics ends a light's photon, below).

  THE RULE IS LIGHT TRACING'S SPLIT, turned round (the EV_* events, tracebasics.js; ltConnect
  above). At a surface met from OUTSIDE:
    - the light added here is counted over the EVALUABLE lobes only -- lobesEval from LT_MIN_ALPHA:
      the diffuse base and glossy reflection at alpha >= 0.05;
    - the path ENDS if the lobe drawn is one of those (EV_EVAL), and GOES ON otherwise: a mirror
      or clear glass (EV_DELTA), near-mirror gloss and rough refraction (EV_OTHER).
  Inside a solid (the hit seen from within it) nothing is added and everything goes on: a shadow
  ray from there starts inside the solid and meets its own wall, and ending there would black out
  light on its way through glass.

  WHY THIS COUNTS NOTHING TWICE. What is added here covers exactly the evaluable lobes; a path
  goes on only along the others, which nothing added here covered. So a path that goes on must
  collect what it meets in full: prevPdf -1 and sunmis 1 (the MIS bookkeeping below skips a fast
  path), the weights of a direction light sampling could not have produced. And the light sample
  itself has WEIGHT 1, not the power heuristic: the BSDF ray that would have carried the rest of
  the direct light over the evaluable lobes is never traced; with MIS left in, Draft would be too
  dark by the share that ray was given. On a floor under an open sky there is no bounce light, so
  Draft and full must agree there -- the render-modes bench row checks exactly that.
  What is not counted is the bounce light -- everything after an evaluable lobe. That is the mode.

  DRAFT adds NEE: the sun, the sky and the discovered emitters, one shadow ray. Light reaching a
  surface through glass is light tracing's (its photons connect at exactly that first evaluable
  vertex, which Draft's paths end at and never count past -- so it stays on, quality.js).
  Emitters are discovered by the camera paths that hit them, and a Draft path stops at the wall a
  hidden lamp lights: so a share (UB.draftSeek) of the paths that end go one segment further as
  SEEK rays (TAG_SEEK, tracebasics.js processMaterial), carrying nothing, to find lamps.

  SKETCH adds sketchLight: three fixed lights and no shadow ray at all, so the picture settles in a
  few samples and says nothing about the scene's light -- a viewport for shape.

  OPTICS is Sketch's camera side (sketchLit), with the flat light dimmed or off by its own setting
  (photometry.js derive), and THE LIGHTS' PHOTONS, which Sketch leaves out: they walk from the light
  through mirrors, glass, gloss and rough refraction, connect to the camera at every surface they land
  on, and END AT THE FIRST DIFFUSE LOBE THEY DRAW (tracebasics.js processMaterial, LAST_DIFFUSE). So
  the picture is the shapes in a flat light and, on top, where the optics put the lights' light --
  without the room's bounce light, which is what would hide a beam's edge.
  NOTHING IS COUNTED TWICE. A camera path here collects no light of the lights' but a face it meets
  (directly, or past a lobe it follows: a mirror, glass, near-mirror gloss); a photon connects through
  the lobes the camera path stops at (ltConnect's EVAL lobes, EV_EVAL) or, for a source no path can meet, every
  lobe. Their direct paths are NOT shared by MIS (Ray.ltMis) in any fast mode: that weight assumes the
  camera's path goes on from its first surface to the face, and here it stops there -- so the photon
  keeps the whole of what it connects through the evaluable lobes, and the face the whole of what is
  met past the others. Draft has the same stop and the same rule.
==============================================================================================*/
fn fastCamera(tag: u32) -> bool {
    return UB.renderMode != 0u && (tag & (TAG_PHOTON | TAG_PROBE | TAG_SEEK)) == 0u;
}
/* The modes whose camera paths take Sketch's fixed light instead of a light sample: Sketch and Optics. */
fn sketchLit() -> bool { return UB.renderMode == 2u || UB.renderMode == 3u; }
/* SKETCH'S LIGHT: a headlight along the ray, a light from straight above, and a fill along the
   normal so nothing that faces the camera is black -- shares of UB.sketchE, the lux the scene's
   environment puts on a level surface (photometry.js derive), so an exposure set for the scene
   suits it. Over the evaluable lobes only, as Draft's NEE: a narrow lobe lit along the view would
   be a spot of 1 / (pi alpha^2) on every surface facing the camera. In world z, the renderer's up
   (the camera's, index.js). */
const SKETCH_HEAD: FLOAT = 0.6;
const SKETCH_TOP: FLOAT = 0.25;
const SKETCH_FILL: FLOAT = 0.15;
fn sketchLight(lb: Lobes, n: VEC3, v: VEC3) -> VEC3 {
    let up = VEC3(0.0, 0.0, 1.0);
    /* THE THREE LIGHTS ARE A LOOP'S PASSES, head, top, fill, summed in that order as they were, and its
       bound goes through noUnroll though no SDF is in it: each lobesEval is a whole copy of the BSDF
       once inlined, and a constant 3 would be unrolled straight back into the three it was (0.10.0). */
    var f = VEC3(0.0);
    for (var k = 0u; k < noUnroll(3u); k++) {
        let d = select(select(n, up, k == 1u), v, k == 0u);
        let c = select(select(SKETCH_FILL, SKETCH_TOP * max(dot(n, up), 0.0), k == 1u), SKETCH_HEAD * max(dot(n, v), 0.0), k == 0u);
        f += lobesEval(lb, d, LT_MIN_ALPHA) * c;
    }
    return f * UB.sketchE;
}

/* THE EMITTER HALF of a hit's material, cut off the front of processMaterial_advanced (0.9.5) so the
   medium question below it can be asked at one place in the shade kernel (Shading, tracebasics.js):
   the hit with its glow added, and ended when the path stops here -- every emitter but a transparent
   light's face. Unchanged otherwise. */
struct EmitterHit { res: Hit, ended: bool, }
fn emitterHit(_res: Hit, matrl: Material2) -> EmitterHit {
    var res = _res;                           // local copy of the hit result
    if (max3(matrl.emissive) > 0.0) {
        /* AN EMITTER HIT is the BSDF half of emitter sampling, so it is weighted against it:
           by the density the previous vertex's NEE would have had for this direction,
           recovered from where that vertex was (vtxLtot) and how far this is. prevPdf -1 means
           light sampling could not have produced the direction -- camera, NEE off, below the
           surface -- and the hit keeps weight 1; so does an emitter nothing has discovered
           yet, whose NEE density is 0. That is why this is unbiased from the first sample.
           A camera path in light tracing's class leaves the emission to the emitter photons
           when there are any and a photon could have started here (emitCovers).
           Camera paths also DISCOVER the emitter: see emitDeposit. A photon collects nothing
           here -- its radiance field is flux, and it ends at the emitter. */
        var w = 1.0;
        if ((res.r.tag & TAG_PHOTON) != 0u) {
            w = 0.0;
        } else if (matrl.lightTraced != 0u) {
            // ...save for a path armed for the lens (lens.js), whose light the lights' photons bring through it
            if (UB.ltLights != 0u && lensOwned(res.r.tag)) { w = 0.0; }
            /* A LIGHT'S FACE (codegen LIGHTS) is no emitter for this renderer to find: its light
               reaches the picture through its own photons, and through the camera paths they cannot
               reach, which meet the face by BSDF sampling alone (CLS_LIGHTS); the strategies here
               see it black -- light sampling's shadow rays (TAG_EMIT) and the emitter photons'
               probes (TAG_PROBE). So it is NOT DISCOVERED: listed, it took neeEmitShare of light sampling towards a face
               that returns nothing, and turned light tracing's photons into probes that can never
               start on it -- all of them with the sun off. Not handed to the emitter photons, which
               cannot start here. And weight 1: emitConePdf counts every listed box whose cone holds
               this direction -- an emissive object's box can hold a face -- while that strategy's
               shadow ray sees the face black, so weighting against it would lose light. */
        } else {
            /* ...or armed for the lens (lens.js): the emitter photons bring that path through it */
            if (UB.ltEmit != 0u && ((res.r.tag & (CLS_CAND | CLS_SPEC)) == (CLS_CAND | CLS_SPEC) || lensOwned(res.r.tag))
                && emitCovers(res.r.pos)) {
                w = 0.0;
            } else if (res.r.prevPdf >= 0.0) {
                let dist = max(res.r.ltot - res.r.vtxLtot, 0.0) / max(res.r.n, 1e-4);
                let xPrev = res.r.pos - res.r.dir * dist;
                // light sampling at the vertex before gave emitters this much, faces taken out (L7)
                let fsPrev = lightFaceShare(res.r.bounces - 1u, res.r.tag);
                w = misWeight(res.r.prevPdf, (1.0 - fsPrev) * emitShare() * emitConePdf(xPrev, res.r.dir));
            }
            emitDeposit(res.r.pos, matrl.emissive);
        }
        res.r.radiance += res.r.beta * matrl.emissive * w;
        /* ...AND A TRANSPARENT LIGHT'S FACE (lightTraced 2) LETS THE PATH THROUGH, on as the clear
           sheet it is to everything else (codegen clearSheet), its glow added. Every other emitter
           ends the path. Once its face glowed only at the camera's first hit, which it stopped; it
           glows on later hits now (PLAN.md L4), and a path it stopped there would find a window
           light opaque. */
        if (matrl.lightTraced != 2u) {
            res.r.state = RAY_SOURCE;
            res.r = moveBy(res.r, res.r.dir * offsetTol(res.r.pos) * 2.0);
            return EmitterHit(res, true);
        }
    }
    return EmitterHit(res, false);
}

/* THE MEDIA ON EITHER SIDE. A transmissive surface asks the scene what is really beyond it
   (the SDF probe a hair inside), because that is where a refracted ray goes -- glass in
   water, a bubble in glass. An opaque one uses its own IOR, and never less than the medium
   the ray is in: that probe cost an SDF evaluation per hit on every dielectric, and turned an
   IOR-1 default material met from inside water into a total-internal-reflection mirror.
   Whether to ask, and the answer when not: the caller asks (mediumBeyond, tracebasics.js) at
   the one place the shade kernel asks it, and hands the answer to processMaterial_advanced.
   asksMedium is in materials.js since 0.20.8: the surface kernel asks the question, and holds no BSDF model. */
fn ownMedium(matrl: Material2, n0: FLOAT) -> FLOAT { return max(matrl.ior, n0); }

/* Everything a hit's material does after its emitter half (emitterHit) and the medium beyond it (n1). */
/* _mu1: what the medium beyond absorbs (materials.js mediumMu), taken on with its index when the ray crosses.
   _v1: its Abbe number (materials.js abbe): 0 one index at every wavelength. */
fn processMaterial_advanced(_res:Hit, matrl:Material2, _nrm: VEC3, _n1: FLOAT, _mu1: VEC3, _v1: FLOAT) -> Ray {
    var res = _res;                           // local copy of the hit result
    let view = -res.r.dir;                    // view/outgoing
    let nrm = _nrm;
    let n0 = res.r.n;
    let inside = res.s.w < 0.0;                 // seen from within (processMaterial turned the normal)
    /* DISPERSION (0.40.0; spectral.js). A ray that has a wavelength meets every medium at n(its wavelength): its own
       index, res.r.n, already is, and the medium beyond is here. A ray without one, at a dispersive medium beyond,
       draws one -- used only if it refracts: the reflect-or-refract pick and its Fresnel are the d line's, so what a
       prism reflects stays white and noiseless, and the refraction alone takes n(lambda) and the wavelength's weight
       per channel (mean 1 in each over the draw). A dispersive medium the ray is already in without a wavelength (a
       photon started inside one) gives none: it leaves at n_d.
       SWITCHED OFF (UB.dispersionOff, 0.68.0; the user: "dispersion on/off"): every Abbe number read as 0, so no ray
       draws a wavelength and every glass refracts at its n_d -- camera paths, photons and so the photon map alike, from
       this one place. 0 is on, so a bag that leaves it out (a GPU test's) traces dispersion as it always did. */
    let v1 = select(_v1, 0.0, UB.dispersionOff != 0u);
    let lam0 = rayLambda(res.r);
    let n1 = select(_n1, cauchyN(_n1, v1, lam0), lam0 > 0.0);
    let draw = v1 > 0.0 && lam0 == 0.0;
    var spec: SpecDraw;
    var nT = n1;
    if (draw) {
        spec = specDraw(PRNG().x);
        spec.lambda = lambdaCoded(spec.lambda);           // as the tag keeps it, so every index after reads this one
        nT = cauchyN(_n1, v1, spec.lambda);
    }
    // a coating's pick weighed by what this ray carries (coatPick); the same lobes for sampling, NEE and MIS below
    var lobes = coatPick(makeLobes(nrm, view, matrl, n0 / n1, n0, inside), res.r.beta);
    lobes.etaT = n0 / nT;

    /*----------------------------------------------------------------------------------------
      LIGHT SAMPLING, one of the two MIS strategies. See NEXT-EVENT ESTIMATION and MULTIPLE
      IMPORTANCE SAMPLING in tracebasics.js for what the other one is and why both are needed.

      The BSDF is EVALUATED towards the sampled direction here, not sampled: MIS asks what this
      surface does for one particular direction, which the lobe-selection code below never
      answers. Specular comes from the same GGX evaluator the sampled path uses, so the two
      agree about the surface; diffuse is the Lambert term the dielectric branch would have
      used, under the same (1-F) energy split.

      Skipped on the last wavefront iteration, where nothing would march the shadow ray. The
      surface falls back to BSDF sampling alone there -- noisier, still unbiased.
    ----------------------------------------------------------------------------------------*/
    /* FAST MODES (above): Draft's light sample at weight 1 over the evaluable lobes, Sketch's fixed
       light instead of one, and neither inside a solid. */
    let fast = fastCamera(res.r.tag);
    let neeMinAlpha = select(0.0, LT_MIN_ALPHA, fast);
    // NEE not for a photon: it carries flux from the sun, and NEE_RAY is its camera connection
    if (fast && sketchLit()) {
        if (!inside) { res.r.radiance += res.r.beta * sketchLight(lobes, nrm, view); }
    } else if (UB.nee != 0u && UB.lastpass == 0u && (res.r.tag & TAG_PHOTON) == 0u && !(fast && inside)) {
        /* THREE LIGHTS NOW: a light's FACES with probability fs -- only where the camera owns
           what they light (lightFaceShare; PLAN.md L7) -- then of the rest the discovered emitters
           with probability emitShare(), else the environment (itself sun disc or sky, by
           neeSunPick). One random picks and is rescaled at each step, so with no face to aim at
           and nothing discovered this is exactly the old block. Each density carries the share
           that picked it -- as the BSDF side's weights must (sunmis below, the emissive branch,
           codegen LIGHTS). */
        let pick00 = PRNG().x;
        let fs = lightFaceShare(res.r.bounces, res.r.tag);
        let pick0 = (pick00 - fs) / max(1.0 - fs, 1e-6);    // the rest's own draw, when it is theirs
        let es = emitShare();
        let uL = PRNG().xy;
        /* WHAT EACH BRANCH CHOOSES, and nothing more: a direction L, the light's density for it pS (the
           MIS weight's), what the contribution is divided by dS, the radiance arriving along L le, and
           which light it was (kind: 1 a face, 2 an emitter, 3 the environment; 0 nothing to send).
           The lobes are evaluated ONCE, after the branches, for whichever ran (0.10.0): each branch made
           its own lobesEval, lobesPdf and misWeight, and every call is a whole copy of the BSDF once
           the compiler inlines it. Each light keeps what it had: its own random draws, its own guard,
           its divisor (a face max(pF, 1e-30), the others bare), its threshold (1e-9 for an emitter,
           1e-7 else, and a face's pF > 0), and the ray's n and tmax set by a face only. An emitter's
           le is 1 -- the occlusion kernel multiplies its emission in -- and times 1 is exact. */
        var kind = 0u;
        var L = VEC3(0.0);
        var NoL = 0.0;
        var pS = 0.0;
        var dS = 1.0;
        var le = VEC3(1.0);
        var y = VEC3(0.0);                                  // a face's: the point aimed at
        /* NOTHING TO LIGHT (lobesNone, 0.61.2): every lobe here a delta, no base -- f below is 0 for any light, the
           contribution 0, and no shadow ray would be sent. So no light is chosen, sampled or evaluated, and kind stays
           0; the numbers each branch would have drawn are drawn all the same (pick00 and uL above, a face's pick
           here), so nothing drawn after this moves. */
        if (lobesNone(matrl)) {
            if (pick00 < fs) { _ = PRNG(); }
        } else if (pick00 < fs) {
            /* A LIGHT'S FACE: one by its pick, a point uniform on it, and the side of it this
               vertex sees -- a one-sided face lights nothing behind it. The shadow ray aims at the
               point and stops just short of it (TAG_FNEE); anything in the way stops it, another
               face included, so the BSDF side weighs a face it meets against that face's own
               density alone. Its radiance is the face's at that angle over n^2 of the medium here,
               as its glow is to a camera path (codegen LIGHTS). */
            let tot = lightFaceTotal();                     // > 0: fs is 0 otherwise
            let face = lightFaceAt(lightFacePick(PRNG().x * tot));   // fetched once: each call is a switch over every light
            y = face.centre;
            if (face.shape == 1u) {
                let rr = face.half.x * sqrt(uL.x);
                let ph = 2.0 * PI * uL.y;
                y += (face.u * cos(ph) + face.v * sin(ph)) * rr;
            } else {
                y += face.u * ((2.0 * uL.x - 1.0) * face.half.x) + face.v * ((2.0 * uL.y - 1.0) * face.half.y);
            }
            let dy = y - res.r.pos;
            let dist = length(dy);
            L = dy / max(dist, 1e-20);
            let cosY = dot(face.n, -L);
            NoL = dot(nrm, L);
            if (dist > 0.0 && NoL > 0.0 && abs(cosY) > 1e-6 && (cosY > 0.0 || face.twoSided != 0u)) {
                pS = lightFaceDensity(fs, face, tot, dist, cosY);
                dS = max(pS, 1e-30);
                le = lightFaceLe(face, abs(cosY)) / max(res.r.n * res.r.n, 1.0);
                kind = 1u;
            }
        } else if (pick0 < es) {
            /* EMITTER NEE: a direction into one box's bounding sphere; the shadow ray then
               counts the emission of WHATEVER it hits first (TAG_EMIT, occlusion kernel) --
               so emission that varies over the surface is evaluated where it is, and a box
               that holds no emitter along that line simply returns nothing. Divided by the
               whole mixture's density, not the one box's. */
            let b = emitPick(pick0 / es);
            let dc = emitCentre(b) - res.r.pos;
            let d2 = dot(dc, dc);
            let r = emitF(b, 3u);
            if (d2 > r * r) {
                let d = sqrt(d2);
                let axis = dc / d;
                let omc = coneOneMinusCos(r, d2);
                let cosT = 1.0 - uL.x * omc;
                let sinT = sqrt(max(0.0, 1.0 - cosT * cosT));
                let phi = 2.0 * PI * uL.y;
                var tt = VEC3(1.0, 0.0, 0.0);
                if (abs(axis.x) > 0.9) { tt = VEC3(0.0, 1.0, 0.0); }
                let b1 = normalize(cross(tt, axis));
                let b2 = cross(axis, b1);
                L = normalize(b1 * (cos(phi) * sinT) + b2 * (sin(phi) * sinT) + axis * cosT);
                NoL = dot(nrm, L);
                let pE = (1.0 - fs) * es * emitConePdf(res.r.pos, L);
                if (NoL > 0.0 && pE > 0.0) { pS = pE; dS = pE; kind = 2u; }
            }
        } else {
            let pick = (pick0 - es) / max(1.0 - es, 1e-6);
            L = envSampleDir(nrm, pick, uL);
            NoL = dot(nrm, L);
            let pL = (1.0 - fs) * (1.0 - es) * envPdf(L, nrm);
            if (NoL > 0.0 && pL > 0.0) { pS = pL; dS = pL; le = envRadiance(L); kind = 3u; }
        }
        if (kind != 0u) {
            let f = lobesEval(lobes, L, neeMinAlpha);       // what the sampler samples (FAST MODES: the evaluable lobes)
            let pB = lobesPdf(lobes, L);
            let w = select(misWeight(pS, pB), 1.0, fast);
            // an emitter's: everything but the emission, which the occlusion kernel multiplies in
            let contrib = res.r.beta * f * NoL * le * (w / dS);
            if (pS > 0.0 && max3(contrib) > select(1e-7, 1e-9, kind == 2u)) {
                NEE_RAY = res.r;
                NEE_RAY.pos = res.r.pos + nrm * offsetTol(res.r.pos) * 2.0;
                NEE_RAY.dir = L;
                NEE_RAY.radiance = contrib;                 // a shadow ray carries what it will deposit
                NEE_RAY.beta = VEC3(1.0);
                NEE_RAY.steps = 0u;
                NEE_RAY.ltot = 0.0;
                NEE_RAY.absLtot = 0.0;                      // through the path's medium, absorbed at the deposit (prog_occlude)
                NEE_RAY.bounces = 0u;
                NEE_RAY.state = RAY_ACTIVE;
                NEE_RAY.tag = select(0u, TAG_EMIT, kind == 2u);   // the environment's runs until it leaves the scene
                if (kind == 1u) {
                    let toY = y - NEE_RAY.pos;
                    NEE_RAY.dir = normalize(toY);
                    NEE_RAY.n = 1.0;                        // so ltot is length, which tmax is
                    NEE_RAY.tmax = length(toY) - offsetTol(res.r.pos) * 2.0;
                    NEE_RAY.tag = TAG_FNEE;
                }
                NEE_VALID = true;
            }
        }
    }

    /* THE BOUNCE: one lobe, drawn by lobesSample, its weight exact -- no clamp. The old [0,10]
       clamp cut the fireflies a wrong sampling pdf made at grazing views; with the pdf right, a
       reflection weighs at most F G2/G1 <= 1 over its pick probability. A weight of zero (a
       reflection below the surface, a refraction a microfacet totally reflects) ends the path:
       it would carry nothing, and marching it would still cost. */
    let smp = lobesSample(lobes, PRNG());
    res.r.dir = smp.dir;
    res.r.beta *= smp.w;
    LAST_EVENT = smp.ev;
    LAST_DIFFUSE = smp.diffuse;
    if (smp.transmitted) {                                  // the new medium's index, and what it absorbs
        res.r.n = nT;                                       // n(lambda) where the ray has a wavelength, n1 otherwise
        res.r = withMu(res.r, _mu1);                        // from here: the ray arrived absorbed (prog_shade)
        // ...and the wavelength it was refracted at, which it keeps, and what that wavelength is to each channel
        if (draw) { res.r.beta *= spec.w; res.r = withLambda(res.r, spec.lambda); }
    }
    if (max3(smp.w) <= 0.0) { res.r.state = RAY_ABSORBED; }

    /* THE BSDF'S DENSITY FOR THE DIRECTION DRAWN, taken once for the two halves below that ask
       (0.10.0): each took its own lobesPdf of the same direction -- res.r.dir is smp.dir, set above --
       and every call is a whole copy of the BSDF once inlined. Each half still asks under its own
       condition, and gets 0 when it does not. */
    let misOut = UB.nee != 0u && UB.lastpass == 0u && (res.r.tag & TAG_PHOTON) == 0u && !fast;
    let ltOut = (res.r.tag & TAG_PHOTON) == 0u && res.r.bounces == 1u && UB.ltLightFlux > 0.0 && !fast
                && !smp.isDelta && !smp.transmitted && abs(n0 - 1.0) <= 1e-3 && max3(smp.w) > 0.0;
    /* ...and not for a DELTA EVENT (0.61.2): ltOut excludes one, and misOut's half below reads pOut only where the
       direction is above the surface and no delta ('above') -- elsewhere it keeps weight 1 and prevPdf -1 whatever
       pOut is. A mirror, clear glass or a dichroic draws nothing else. */
    var pOut = 0.0;
    if ((misOut || ltOut) && !smp.isDelta) { pOut = lobesPdf(lobes, smp.dir); }

    /* THE OTHER HALF OF MIS. The direction is only settled here, after the lobe draw, so this
       is the first point at which the weight for BSDF sampling can be computed. It is carried
       on the ray and applied when and if that ray reaches the environment, which may be many
       iterations later -- see skyLuminance in sdf.js.
       Weight 1 when light sampling did not run at all (NEE off, or the last pass), so the ray
       collects the environment in full and nothing is lost.

       ONLY AGAINST A STRATEGY THAT COULD HAVE PRODUCED THIS DIRECTION. Light sampling here only
       ever proposes -- and only ever counts -- directions above the surface (the NEE block
       above requires NoL > 0). A transmitted direction is below it, so light sampling's
       density there is zero whatever envPdf says about the sun cone. Weighting against it
       anyway gave a refracted ray leaving glass towards the sun a weight of 0 (the BSDF density
       is also 0 below the surface): the sun through glass was counted by NEITHER strategy,
       and with NEE on a glass sphere cast a plain shadow even with light tracing off. */
    /* ...and the environment's density is (1 - emitShare) of its own, since that is how often
       NEE draws from it. prevPdf and vtxLtot are the emitter-side half: the BSDF density of
       this direction, or -1 where light sampling could not have produced it, and where this
       vertex was -- read on an emitter hit to weight it (the emissive branch above). */
    /* ...not on a fast path: whatever goes on from one goes on along a lobe nothing above counted,
       so it collects in full (FAST MODES) */
    if (misOut) {
        /* A DELTA EVENT is one light sampling could not have produced -- NEE evaluates only the
           continuous lobes -- so it keeps weight 1, like a direction below the surface. This used
           to be a pdf of 1e9 for anything smooth, which also switched NEE off for the DIFFUSE
           base under a smooth coat: a glossy plastic under the sun was lit by chance alone. */
        let above = dot(nrm, res.r.dir) > 0.0 && !smp.isDelta;
        // branched, not selected: a select evaluates both sides, and envPdf is wasted below the surface or at a delta
        var pLout = 0.0;
        if (above) {
            pLout = (1.0 - lightFaceShare(res.r.bounces, res.r.tag)) * (1.0 - emitShare()) * envPdf(res.r.dir, nrm);
        }
        let pBout = pOut;
        res.r.sunmis = select(misWeight(pBout, pLout), 1.0, pLout <= 0.0);
        res.r.prevPdf = select(-1.0, pBout, above);
    } else {
        res.r.sunmis = 1.0;
        res.r.prevPdf = -1.0;
    }
    res.r.vtxLtot = res.r.ltot;

    /* THE LIGHTS' MIS, THE CAMERA'S HALF (Ray.ltMis). At its first surface a camera path that
       scattered by a lobe a photon's connection can evaluate -- any reflection that is not a delta
       -- in air, while the lights' photons share their direct paths (ltLightFlux), carries |cos|
       A_px / (flux per photon  G  pdf) to the face it may meet next, which completes R with its
       own radiance. 0 otherwise: no photon can make those paths, and the face keeps them whole.
       Here, before the ray leaves the surface: G is the camera's footprint at this point.
       NOT ON A FAST PATH (FAST MODES, above): it ends at the lobes this would share, and the face it
       meets past the others is its own whole -- a share kept for it here was light nobody counted. */
    if ((res.r.tag & TAG_PHOTON) == 0u && res.r.bounces == 1u) {
        res.r.ltMis = 0.0;
        if (ltOut) {
            let pdf = pOut;
            let foot = camFootprint(res.r.pos, nrm);
            if (pdf > 0.0 && foot.x > 0.0) {
                res.r.ltMis = abs(dot(nrm, smp.dir)) * foot.y / (UB.ltLightFlux * foot.x * pdf);
            }
        }
    }

    res.r = moveBy(res.r, res.r.dir * offsetTol(res.r.pos));
    return res.r;
}

`;
