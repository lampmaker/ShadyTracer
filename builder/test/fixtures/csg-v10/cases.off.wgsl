const MATID_DEFAULT: u32 = 1u;
const matid_white: u32 = 2u;
const matid_glass: u32 = 3u;
const matid_local: u32 = 4u;
const matid_lim: u32 = 5u;
const MATID_BLACK: u32 = 6u;
const MATID_CLEAR: u32 = 7u;
const matid_ltlamp: u32 = 8u;     // light ltlamp

fn clearSheet() -> Material2 {
    var m = makeDefaultMaterial();
    m.baseColor = vec3<f32>(1.0); m.metallic = 0.0; m.roughness = 0.0; m.specular = 0.0; m.transmission = 1.0;
    return m;
}
fn lightBeam(beam: vec4<f32>, cosT: f32) -> f32 {
    let kind = u32(beam.x + 0.5);
    if (kind == 0u) { return 1.0; }          // collimated: no luminance to show, its Lambertian equivalent
    if (cosT < beam.z) { return 0.0; }       // outside the cone
    let c = max(cosT, 1e-4);
    if (kind == 1u) { return 1.0 / c; }      // uniform in solid angle: radiance 1/cos
    return pow(c, beam.y - 1.0);            // cos^n: radiance cos^(n-1)
}
fn getMaterial2(C: Hit, checkInside: bool) -> Material2 {
    let idx = select(C.m, C.a, checkInside);
    let p = C.r.pos;
    let n = C.s.xyz;
    var p_local = C.r.pos;
    var R_local = mat3x3<f32>(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0);
    var S_local = 1.0;
    if (!checkInside && (idx == 4u)) {
        p_local = localPoint(C.r); R_local = HIT_FRAME; S_local = HIT_SCALE;
    }
    var fm: Material2;
    var face = 0u;
    switch (idx) {
        case 2u: {     // material white
            var m = makeDefaultMaterial();
            m.baseColor = UB.baseColor_white;
            m.metallic = UB.metallic_white;
            m.roughness = UB.roughness_white;
            m.anisotropy = UB.anisotropy_white;
            m.specular = UB.specular_white;
            m.specularTint = UB.specularTint_white;
            m.transmission = UB.transmission_white;
            m.ior = UB.ior_white;
            return m;
        }
        case 3u: {     // material glass
            var m = makeDefaultMaterial();
            m.baseColor = UB.baseColor_glass;
            m.metallic = UB.metallic_glass;
            m.roughness = UB.roughness_glass;
            m.anisotropy = UB.anisotropy_glass;
            m.specular = UB.specular_glass;
            m.specularTint = UB.specularTint_glass;
            m.transmission = UB.transmission_glass;
            m.ior = UB.ior_glass;
            return m;
        }
        case 4u: {     // material local
            var m = makeDefaultMaterial();
            m.baseColor = UB.baseColor_local;
            m.metallic = UB.metallic_local;
            m.roughness = UB.roughness_local;
            m.anisotropy = UB.anisotropy_local;
            m.specular = UB.specular_local;
            m.specularTint = UB.specularTint_local;
            m.transmission = UB.transmission_local;
            m.ior = UB.ior_local;
            {
m.baseColor = fract(p_local);
            }
            return m;
        }
        case 5u: {     // material lim
            var m = makeDefaultMaterial();
            return m;
        }
        case 1u: { return makeDiffuse(vec3<f32>(0.8), 1.0); }
        case 6u: { return makeDiffuse(vec3<f32>(0.0), 1.0); }   // MATID_BLACK
        case 7u: { return clearSheet(); }   // MATID_CLEAR
        case 8u: {     // light ltlamp
            var m = makeDiffuse(vec3<f32>(0.0), 1.0);
            let direct = C.r.bounces == 2u && C.r.ltMis > 0.0;          // shared with its photons by MIS
            if ((C.r.tag & (TAG_PHOTON | TAG_EMIT | TAG_PROBE)) == 0u && C.r.bounces >= 1u
                && (C.r.bounces == 1u || ((direct || (C.r.tag & CLS_LIGHTS) == 0u) && u32(UB.beam_ltlamp.x + 0.5) != 0u))) {
                let le = UB.emissiveLuminance_ltlamp * lightBeam(UB.beam_ltlamp, dot(-C.r.dir, n)) / max(C.r.n * C.r.n, 1.0);
                let w = select(1.0, 1.0 / (1.0 + le * C.r.ltMis), direct);
                m.emissive = UB.emissive_ltlamp / max(dot(UB.emissive_ltlamp, LUMA_709), 1e-6) * le * w;
            }
            m.lightTraced = 1u;
            fm = m; face = 1u;     // to the one weight below
        }
        default: { return makeDefaultMaterial(); }
    }
    if (any(fm.emissive != VEC3(0.0)) && C.r.bounces >= 2u && C.r.prevPdf >= 0.0) {
        let pl = lightFaceDensity(lightFaceShare(C.r.bounces - 1u, C.r.tag), lightFace(face - 1u), lightFaceTotal(),
                                  max(C.r.ltot - C.r.vtxLtot, 0.0) / max(C.r.n, 1e-4), dot(-C.r.dir, n));
        let a = C.r.prevPdf * C.r.prevPdf;
        fm.emissive = fm.emissive * (a / max(a + pl * pl, 1e-20));
    }
    return fm;
}
const LIGHT_FACES: u32 = 1u;
fn lightFaceTotal() -> f32 {
    var t = 0.0;
    t += select(0.0, 1.0, u32(UB.beam_ltlamp.x + 0.5) != 0u);     // light ltlamp
    return t;
}
fn lightFacePick(u: f32) -> u32 {
    var acc = 0.0;
    var last = 0u;
    { let w = select(0.0, 1.0, u32(UB.beam_ltlamp.x + 0.5) != 0u); if (w > 0.0) { last = 0u; acc += w; if (u < acc) { return 0u; } } }     // light ltlamp
    return last;
}
fn lightFace(i: u32) -> LightFace {
    var f: LightFace;
    switch (i) {
        case 0u: {     // light ltlamp
            var M = mat3x3<f32>(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0);
            var S = 1.0;
            var t = VEC3(0.0);
            { let T = UB.xf_lt; t += M * (S * T[3].xyz); M = M * xfRot(T); S *= T[3].w; }
            { let T = UB.xf_ltlamp; t += M * (S * T[3].xyz); M = M * xfRot(T); S *= T[3].w; }
            f.centre = t; f.u = M[0]; f.v = M[1]; f.n = M[2];
            f.half = VEC2(UB.radius_ltlamp) * S; f.shape = 1u;
            f.twoSided = 0u;
            f.le = UB.emissive_ltlamp / max(dot(UB.emissive_ltlamp, LUMA_709), 1e-6) * UB.emissiveLuminance_ltlamp;
            f.beam = UB.beam_ltlamp;
            f.weight = select(0.0, 1.0, u32(UB.beam_ltlamp.x + 0.5) != 0u);
        }
        default: {}
    }
    return f;
}
fn lightFaceLe(f: LightFace, cosT: f32) -> VEC3 {
    return f.le * lightBeam(f.beam, cosT);
}

// the children of group cc, which its code calls as children(C, p)
fn children_cc(C_in: Hit, p_in: VEC3) -> Hit {
    let r = C_in.r;
    var C = C_in;
    let p = p_in;
    var k_cc = VEC4(0.0, 0.0, 1.0, 1.0e7);
    var km_cc = MAT_AIR;
    {
        var C = emptyHit(r);     // this child alone
        XF_SUB += 1u;
        // node cca (code)
        {
            let p = xfPoint(p, UB.xf_cca);
            let xfm_cca = XF_M; let xfs_cca = XF_S;
            XF_M = XF_M * xfRot(UB.xf_cca); XF_S = XF_S * UB.xf_cca[3].w;
            let xfp_cca = XF_P; XF_P = p;
            {
                let size = UB.size_cca;
                let rounding = UB.rounding_cca;
                let MATERIAL = matid_white;
// A box: size is the HALF-size along each axis; the rounding stays inside it.
C = add_new(C, NboxRounded(p, size, rounding), MATERIAL);
            }
            XF_M = xfm_cca; XF_S = xfs_cca;
            XF_P = xfp_cca;
        }
        XF_SUB -= 1u;
        k_cc = C.s; km_cc = C.m;
    }
    {
        var C = emptyHit(r);     // this child alone
        XF_SUB += 1u;
        // node ccb (code)
        {
            let p = xfPoint(p, UB.xf_ccb);
            let xfm_ccb = XF_M; let xfs_ccb = XF_S;
            XF_M = XF_M * xfRot(UB.xf_ccb); XF_S = XF_S * UB.xf_ccb[3].w;
            let xfp_ccb = XF_P; XF_P = p;
            {
                let radius = UB.radius_ccb;
                let MATERIAL = matid_white;
// A sphere around this node's origin.
C = add_new(C, Nsphere(p, radius), MATERIAL);
            }
            XF_M = xfm_ccb; XF_S = xfs_ccb;
            XF_P = xfp_ccb;
        }
        XF_SUB -= 1u;
        k_cc = csgSubtract(k_cc, C.s, UB.blend_cc);
    }
    C = fold(C, k_cc, km_cc);
    return C;
}

// the children of group rbrel, which its code calls as children(C, p)
fn children_rbrel(C_in: Hit, p_in: VEC3) -> Hit {
    let r = C_in.r;
    var C = C_in;
    let p = p_in;
    // node rbs (code)
    {
        let p = xfPoint(p, UB.xf_rbs);
        let xfm_rbs = XF_M; let xfs_rbs = XF_S;
        XF_M = XF_M * xfRot(UB.xf_rbs); XF_S = XF_S * UB.xf_rbs[3].w;
        let xfp_rbs = XF_P; XF_P = p;
        {
            let radius = UB.radius_rbs;
            let MATERIAL = matid_white;
// A sphere around this node's origin.
C = add_new(C, Nsphere(p, radius), MATERIAL);
        }
        XF_M = xfm_rbs; XF_S = xfs_rbs;
        XF_P = xfp_rbs;
    }
    return C;
}

fn SDF(r: Ray) -> Hit {
    let p = r.pos;
    var C = emptyHit(r);
    var CULL: FLOAT = 1.0e7;              // the nearest skipped node's box: a bound on all of them
    XF_P = p;
    {   // hs: skipped while farther than its box
        let bd_hs = cullDist(xfPoint(p, UB.xf_hs), UB.bxlo_hs, UB.bxhi_hs) * UB.xf_hs[3].w;
        if (bd_hs > cullMargin()) { CULL = min(CULL, bd_hs); } else {
            // group hs (subtract)
            {
                let p = xfPoint(p, UB.xf_hs);
                let xfm_hs = XF_M; let xfs_hs = XF_S;
                XF_M = XF_M * xfRot(UB.xf_hs); XF_S = XF_S * UB.xf_hs[3].w;
                let xfp_hs = XF_P; XF_P = p;
                var k_hs = VEC4(0.0, 0.0, 1.0, 1.0e7);
                var km_hs = MAT_AIR;
                {
                    var C = emptyHit(r);     // this child alone
                    XF_SUB += 1u;
                    // node hsa (code)
                    {
                        let p = xfPoint(p, UB.xf_hsa);
                        let xfm_hsa = XF_M; let xfs_hsa = XF_S;
                        XF_M = XF_M * xfRot(UB.xf_hsa); XF_S = XF_S * UB.xf_hsa[3].w;
                        let xfp_hsa = XF_P; XF_P = p;
                        {
                            let size = UB.size_hsa;
                            let rounding = UB.rounding_hsa;
                            let MATERIAL = matid_white;
// A box: size is the HALF-size along each axis; the rounding stays inside it.
C = add_new(C, NboxRounded(p, size, rounding), MATERIAL);
                        }
                        XF_M = xfm_hsa; XF_S = xfs_hsa;
                        XF_P = xfp_hsa;
                    }
                    XF_SUB -= 1u;
                    k_hs = C.s; km_hs = C.m;
                }
                {
                    var C = emptyHit(r);     // this child alone
                    XF_SUB += 1u;
                    // node hsb (code)
                    {
                        let p = xfPoint(p, UB.xf_hsb);
                        let xfm_hsb = XF_M; let xfs_hsb = XF_S;
                        XF_M = XF_M * xfRot(UB.xf_hsb); XF_S = XF_S * UB.xf_hsb[3].w;
                        let xfp_hsb = XF_P; XF_P = p;
                        {
                            let radius = UB.radius_hsb;
                            let MATERIAL = matid_white;
// A sphere around this node's origin.
C = add_new(C, Nsphere(p, radius), MATERIAL);
                        }
                        XF_M = xfm_hsb; XF_S = xfs_hsb;
                        XF_P = xfp_hsb;
                    }
                    XF_SUB -= 1u;
                    k_hs = csgSubtract(k_hs, C.s, UB.blend_hs);
                }
                C = fold(C, k_hs, km_hs);
                XF_M = xfm_hs; XF_S = xfs_hs;
                XF_P = xfp_hs;
            }
        }
    }
    {   // ss: skipped while farther than its box
        let bd_ss = cullDist(xfPoint(p, UB.xf_ss), UB.bxlo_ss, UB.bxhi_ss) * UB.xf_ss[3].w;
        if (bd_ss > cullMargin()) { CULL = min(CULL, bd_ss); } else {
            // group ss (subtract, smooth)
            {
                let p = xfPoint(p, UB.xf_ss);
                let xfm_ss = XF_M; let xfs_ss = XF_S;
                XF_M = XF_M * xfRot(UB.xf_ss); XF_S = XF_S * UB.xf_ss[3].w;
                let xfp_ss = XF_P; XF_P = p;
                var k_ss = VEC4(0.0, 0.0, 1.0, 1.0e7);
                var km_ss = MAT_AIR;
                {
                    var C = emptyHit(r);     // this child alone
                    XF_SUB += 1u;
                    // node ssa (code)
                    {
                        let p = xfPoint(p, UB.xf_ssa);
                        let xfm_ssa = XF_M; let xfs_ssa = XF_S;
                        XF_M = XF_M * xfRot(UB.xf_ssa); XF_S = XF_S * UB.xf_ssa[3].w;
                        let xfp_ssa = XF_P; XF_P = p;
                        {
                            let size = UB.size_ssa;
                            let rounding = UB.rounding_ssa;
                            let MATERIAL = matid_white;
// A box: size is the HALF-size along each axis; the rounding stays inside it.
C = add_new(C, NboxRounded(p, size, rounding), MATERIAL);
                        }
                        XF_M = xfm_ssa; XF_S = xfs_ssa;
                        XF_P = xfp_ssa;
                    }
                    XF_SUB -= 1u;
                    k_ss = C.s; km_ss = C.m;
                }
                {
                    var C = emptyHit(r);     // this child alone
                    XF_SUB += 1u;
                    // node ssb (code)
                    {
                        let p = xfPoint(p, UB.xf_ssb);
                        let xfm_ssb = XF_M; let xfs_ssb = XF_S;
                        XF_M = XF_M * xfRot(UB.xf_ssb); XF_S = XF_S * UB.xf_ssb[3].w;
                        let xfp_ssb = XF_P; XF_P = p;
                        {
                            let radius = UB.radius_ssb;
                            let height = UB.height_ssb;
                            let MATERIAL = matid_white;
// A cylinder along z, centred on this node's origin.
C = add_new(C, Ncylinder(p, height * 0.5, radius), MATERIAL);
                        }
                        XF_M = xfm_ssb; XF_S = xfs_ssb;
                        XF_P = xfp_ssb;
                    }
                    XF_SUB -= 1u;
                    k_ss = csgSubtract(k_ss, C.s, UB.blend_ss);
                }
                C = fold(C, k_ss, km_ss);
                XF_M = xfm_ss; XF_S = xfs_ss;
                XF_P = xfp_ss;
            }
        }
    }
    {   // it: skipped while farther than its box
        let bd_it = cullDist(xfPoint(p, UB.xf_it), UB.bxlo_it, UB.bxhi_it) * UB.xf_it[3].w;
        if (bd_it > cullMargin()) { CULL = min(CULL, bd_it); } else {
            // group it (intersect)
            {
                let p = xfPoint(p, UB.xf_it);
                let xfm_it = XF_M; let xfs_it = XF_S;
                XF_M = XF_M * xfRot(UB.xf_it); XF_S = XF_S * UB.xf_it[3].w;
                let xfp_it = XF_P; XF_P = p;
                var k_it = VEC4(0.0, 0.0, 1.0, 1.0e7);
                var km_it = MAT_AIR;
                {
                    var C = emptyHit(r);     // this child alone
                    XF_SUB += 1u;
                    // node ita (code)
                    {
                        let p = xfPoint(p, UB.xf_ita);
                        let xfm_ita = XF_M; let xfs_ita = XF_S;
                        XF_M = XF_M * xfRot(UB.xf_ita); XF_S = XF_S * UB.xf_ita[3].w;
                        let xfp_ita = XF_P; XF_P = p;
                        {
                            let radius = UB.radius_ita;
                            let MATERIAL = matid_glass;
// A sphere around this node's origin.
C = add_new(C, Nsphere(p, radius), MATERIAL);
                        }
                        XF_M = xfm_ita; XF_S = xfs_ita;
                        XF_P = xfp_ita;
                    }
                    XF_SUB -= 1u;
                    k_it = C.s; km_it = C.m;
                }
                {
                    var C = emptyHit(r);     // this child alone
                    XF_SUB += 1u;
                    // node itb (code)
                    {
                        let p = xfPoint(p, UB.xf_itb);
                        let xfm_itb = XF_M; let xfs_itb = XF_S;
                        XF_M = XF_M * xfRot(UB.xf_itb); XF_S = XF_S * UB.xf_itb[3].w;
                        let xfp_itb = XF_P; XF_P = p;
                        {
                            let size = UB.size_itb;
                            let rounding = UB.rounding_itb;
                            let MATERIAL = matid_white;
// A box: size is the HALF-size along each axis; the rounding stays inside it.
C = add_new(C, NboxRounded(p, size, rounding), MATERIAL);
                        }
                        XF_M = xfm_itb; XF_S = xfs_itb;
                        XF_P = xfp_itb;
                    }
                    XF_SUB -= 1u;
                    k_it = csgIntersect(k_it, C.s, UB.blend_it);
                }
                C = fold(C, k_it, km_it);
                XF_M = xfm_it; XF_S = xfs_it;
                XF_P = xfp_it;
            }
        }
    }
    {   // su: skipped while farther than its box
        let bd_su = cullDist(xfPoint(p, UB.xf_su), UB.bxlo_su, UB.bxhi_su) * UB.xf_su[3].w;
        if (bd_su > cullMargin()) { CULL = min(CULL, bd_su); } else {
            // group su (union, smooth)
            {
                let p = xfPoint(p, UB.xf_su);
                let xfm_su = XF_M; let xfs_su = XF_S;
                XF_M = XF_M * xfRot(UB.xf_su); XF_S = XF_S * UB.xf_su[3].w;
                let xfp_su = XF_P; XF_P = p;
                var k_su = VEC4(0.0, 0.0, 1.0, 1.0e7);
                var km_su = MAT_AIR;
                {
                    var C = emptyHit(r);     // this child alone
                    XF_SUB += 1u;
                    // node sua (code)
                    {
                        let p = xfPoint(p, UB.xf_sua);
                        let xfm_sua = XF_M; let xfs_sua = XF_S;
                        XF_M = XF_M * xfRot(UB.xf_sua); XF_S = XF_S * UB.xf_sua[3].w;
                        let xfp_sua = XF_P; XF_P = p;
                        {
                            let radius = UB.radius_sua;
                            let MATERIAL = matid_white;
// A sphere around this node's origin.
C = add_new(C, Nsphere(p, radius), MATERIAL);
                        }
                        XF_M = xfm_sua; XF_S = xfs_sua;
                        XF_P = xfp_sua;
                    }
                    XF_SUB -= 1u;
                    k_su = C.s; km_su = C.m;
                }
                {
                    var C = emptyHit(r);     // this child alone
                    XF_SUB += 1u;
                    // node sub (code)
                    {
                        let p = xfPoint(p, UB.xf_sub);
                        let xfm_sub = XF_M; let xfs_sub = XF_S;
                        XF_M = XF_M * xfRot(UB.xf_sub); XF_S = XF_S * UB.xf_sub[3].w;
                        let xfp_sub = XF_P; XF_P = p;
                        {
                            let radius = UB.radius_sub;
                            let MATERIAL = matid_glass;
// A sphere around this node's origin.
C = add_new(C, Nsphere(p, radius), MATERIAL);
                        }
                        XF_M = xfm_sub; XF_S = xfs_sub;
                        XF_P = xfp_sub;
                    }
                    XF_SUB -= 1u;
                    km_su = select(km_su, C.m, C.s.w < k_su.w);
                    k_su = csgUnion(k_su, C.s, UB.blend_su);
                }
                {
                    var C = emptyHit(r);     // this child alone
                    XF_SUB += 1u;
                    // node suc (code)
                    {
                        let p = xfPoint(p, UB.xf_suc);
                        let xfm_suc = XF_M; let xfs_suc = XF_S;
                        XF_M = XF_M * xfRot(UB.xf_suc); XF_S = XF_S * UB.xf_suc[3].w;
                        let xfp_suc = XF_P; XF_P = p;
                        {
                            let radius = UB.radius_suc;
                            let MATERIAL = matid_white;
// A sphere around this node's origin.
C = add_new(C, Nsphere(p, radius), MATERIAL);
                        }
                        XF_M = xfm_suc; XF_S = xfs_suc;
                        XF_P = xfp_suc;
                    }
                    XF_SUB -= 1u;
                    km_su = select(km_su, C.m, C.s.w < k_su.w);
                    k_su = csgUnion(k_su, C.s, UB.blend_su);
                }
                C = fold(C, k_su, km_su);
                XF_M = xfm_su; XF_S = xfs_su;
                XF_P = xfp_su;
            }
        }
    }
    {   // one: skipped while farther than its box
        let bd_one = cullDist(xfPoint(p, UB.xf_one), UB.bxlo_one, UB.bxhi_one) * UB.xf_one[3].w;
        if (bd_one > cullMargin()) { CULL = min(CULL, bd_one); } else {
            // group one (union, smooth)
            {
                let p = xfPoint(p, UB.xf_one);
                let xfm_one = XF_M; let xfs_one = XF_S;
                XF_M = XF_M * xfRot(UB.xf_one); XF_S = XF_S * UB.xf_one[3].w;
                let xfp_one = XF_P; XF_P = p;
                var k_one = VEC4(0.0, 0.0, 1.0, 1.0e7);
                var km_one = MAT_AIR;
                {
                    var C = emptyHit(r);     // this child alone
                    XF_SUB += 1u;
                    // node onea (code)
                    {
                        let p = xfPoint(p, UB.xf_onea);
                        let xfm_onea = XF_M; let xfs_onea = XF_S;
                        XF_M = XF_M * xfRot(UB.xf_onea); XF_S = XF_S * UB.xf_onea[3].w;
                        let xfp_onea = XF_P; XF_P = p;
                        {
                            let ring = UB.ring_onea;
                            let tube = UB.tube_onea;
                            let MATERIAL = matid_white;
// A torus in the xy plane: ring is the radius to the tube's centre, tube its own radius.
C = add_new(C, Ntorus(p, ring, tube), MATERIAL);
                        }
                        XF_M = xfm_onea; XF_S = xfs_onea;
                        XF_P = xfp_onea;
                    }
                    XF_SUB -= 1u;
                    k_one = C.s; km_one = C.m;
                }
                C = fold(C, k_one, km_one);
                XF_M = xfm_one; XF_S = xfs_one;
                XF_P = xfp_one;
            }
        }
    }
    {   // ex: skipped while farther than its box
        let bd_ex = cullDist(xfPoint(p, UB.xf_ex), UB.bxlo_ex, UB.bxhi_ex) * UB.xf_ex[3].w;
        if (bd_ex > cullMargin()) { CULL = min(CULL, bd_ex); } else {
            // group ex (subtract)
            {
                let p = xfPoint(p, UB.xf_ex);
                let xfm_ex = XF_M; let xfs_ex = XF_S;
                XF_M = XF_M * xfRot(UB.xf_ex); XF_S = XF_S * UB.xf_ex[3].w;
                let xfp_ex = XF_P; XF_P = p;
                // node exbox (export): an export box: draws nothing
                var k_ex = VEC4(0.0, 0.0, 1.0, 1.0e7);
                var km_ex = MAT_AIR;
                {
                    var C = emptyHit(r);     // this child alone
                    XF_SUB += 1u;
                    // node exa (code)
                    {
                        let p = xfPoint(p, UB.xf_exa);
                        let xfm_exa = XF_M; let xfs_exa = XF_S;
                        XF_M = XF_M * xfRot(UB.xf_exa); XF_S = XF_S * UB.xf_exa[3].w;
                        let xfp_exa = XF_P; XF_P = p;
                        {
                            let size = UB.size_exa;
                            let rounding = UB.rounding_exa;
                            let MATERIAL = matid_white;
// A box: size is the HALF-size along each axis; the rounding stays inside it.
C = add_new(C, NboxRounded(p, size, rounding), MATERIAL);
                        }
                        XF_M = xfm_exa; XF_S = xfs_exa;
                        XF_P = xfp_exa;
                    }
                    XF_SUB -= 1u;
                    k_ex = C.s; km_ex = C.m;
                }
                {
                    var C = emptyHit(r);     // this child alone
                    XF_SUB += 1u;
                    // node exb (code)
                    {
                        let p = xfPoint(p, UB.xf_exb);
                        let xfm_exb = XF_M; let xfs_exb = XF_S;
                        XF_M = XF_M * xfRot(UB.xf_exb); XF_S = XF_S * UB.xf_exb[3].w;
                        let xfp_exb = XF_P; XF_P = p;
                        {
                            let radius = UB.radius_exb;
                            let MATERIAL = matid_white;
// A sphere around this node's origin.
C = add_new(C, Nsphere(p, radius), MATERIAL);
                        }
                        XF_M = xfm_exb; XF_S = xfs_exb;
                        XF_P = xfp_exb;
                    }
                    XF_SUB -= 1u;
                    k_ex = csgSubtract(k_ex, C.s, UB.blend_ex);
                }
                C = fold(C, k_ex, km_ex);
                XF_M = xfm_ex; XF_S = xfs_ex;
                XF_P = xfp_ex;
            }
        }
    }
    {   // lt: skipped while farther than its box
        let bd_lt = cullDist(xfPoint(p, UB.xf_lt), UB.bxlo_lt, UB.bxhi_lt) * UB.xf_lt[3].w;
        if (bd_lt > cullMargin()) { CULL = min(CULL, bd_lt); } else {
            // group lt (subtract)
            {
                let p = xfPoint(p, UB.xf_lt);
                let xfm_lt = XF_M; let xfs_lt = XF_S;
                XF_M = XF_M * xfRot(UB.xf_lt); XF_S = XF_S * UB.xf_lt[3].w;
                let xfp_lt = XF_P; XF_P = p;
                var k_lt = VEC4(0.0, 0.0, 1.0, 1.0e7);
                var km_lt = MAT_AIR;
                {
                    var C = emptyHit(r);     // this child alone
                    XF_SUB += 1u;
                    // node lta (code)
                    {
                        let p = xfPoint(p, UB.xf_lta);
                        let xfm_lta = XF_M; let xfs_lta = XF_S;
                        XF_M = XF_M * xfRot(UB.xf_lta); XF_S = XF_S * UB.xf_lta[3].w;
                        let xfp_lta = XF_P; XF_P = p;
                        {
                            let size = UB.size_lta;
                            let rounding = UB.rounding_lta;
                            let MATERIAL = matid_white;
// A box: size is the HALF-size along each axis; the rounding stays inside it.
C = add_new(C, NboxRounded(p, size, rounding), MATERIAL);
                        }
                        XF_M = xfm_lta; XF_S = xfs_lta;
                        XF_P = xfp_lta;
                    }
                    XF_SUB -= 1u;
                    k_lt = C.s; km_lt = C.m;
                }
                {
                    var C = emptyHit(r);     // this child alone
                    XF_SUB += 1u;
                    // node ltb (code)
                    {
                        let p = xfPoint(p, UB.xf_ltb);
                        let xfm_ltb = XF_M; let xfs_ltb = XF_S;
                        XF_M = XF_M * xfRot(UB.xf_ltb); XF_S = XF_S * UB.xf_ltb[3].w;
                        let xfp_ltb = XF_P; XF_P = p;
                        {
                            let radius = UB.radius_ltb;
                            let height = UB.height_ltb;
                            let MATERIAL = matid_white;
// A capsule along z: height between the centres of its two end caps.
C = add_new(C, Ncapsule(p, height * 0.5, radius), MATERIAL);
                        }
                        XF_M = xfm_ltb; XF_S = xfs_ltb;
                        XF_P = xfp_ltb;
                    }
                    XF_SUB -= 1u;
                    k_lt = csgSubtract(k_lt, C.s, UB.blend_lt);
                }
                C = fold(C, k_lt, km_lt);
                // light ltlamp, from inside the combine: drawn in its own frames, not one of the shapes
                // node ltlamp (light, disc)
                {
                    let p = xfPoint(p, UB.xf_ltlamp);
                    let xfm_ltlamp = XF_M; let xfs_ltlamp = XF_S;
                    XF_M = XF_M * xfRot(UB.xf_ltlamp); XF_S = XF_S * UB.xf_ltlamp[3].w;
                    let xfp_ltlamp = XF_P; XF_P = p;
                    {
                        let radius = UB.radius_ltlamp;
                        let MATERIAL = select(MATID_BLACK, matid_ltlamp, p.z >= 0.0);
                        C = add_new(C, Ndisc(p, radius), MATERIAL);
                    }
                    XF_M = xfm_ltlamp; XF_S = xfs_ltlamp;
                    XF_P = xfp_ltlamp;
                }
                XF_M = xfm_lt; XF_S = xfs_lt;
                XF_P = xfp_lt;
            }
        }
    }
    {   // ap: skipped while farther than its box
        let bd_ap = cullDist(xfPoint(p, UB.xf_ap), UB.bxlo_ap, UB.bxhi_ap) * UB.xf_ap[3].w;
        if (bd_ap > cullMargin()) { CULL = min(CULL, bd_ap); } else {
            // group ap (subtract)
            {
                let p = xfPoint(p, UB.xf_ap);
                let xfm_ap = XF_M; let xfs_ap = XF_S;
                XF_M = XF_M * xfRot(UB.xf_ap); XF_S = XF_S * UB.xf_ap[3].w;
                let xfp_ap = XF_P; XF_P = p;
                var k_ap = VEC4(0.0, 0.0, 1.0, 1.0e7);
                var km_ap = MAT_AIR;
                {
                    var C = emptyHit(r);     // this child alone
                    XF_SUB += 1u;
                    // node apa (code): an optics limiter, not in the picture
                    XF_SUB -= 1u;
                    k_ap = C.s; km_ap = C.m;
                }
                {
                    var C = emptyHit(r);     // this child alone
                    XF_SUB += 1u;
                    // node apb (code)
                    {
                        let p = xfPoint(p, UB.xf_apb);
                        let xfm_apb = XF_M; let xfs_apb = XF_S;
                        XF_M = XF_M * xfRot(UB.xf_apb); XF_S = XF_S * UB.xf_apb[3].w;
                        let xfp_apb = XF_P; XF_P = p;
                        {
                            let radius = UB.radius_apb;
                            let height = UB.height_apb;
                            let MATERIAL = matid_white;
// A cylinder along z, centred on this node's origin.
C = add_new(C, Ncylinder(p, height * 0.5, radius), MATERIAL);
                        }
                        XF_M = xfm_apb; XF_S = xfs_apb;
                        XF_P = xfp_apb;
                    }
                    XF_SUB -= 1u;
                    k_ap = csgSubtract(k_ap, C.s, UB.blend_ap);
                }
                C = fold(C, k_ap, km_ap);
                XF_M = xfm_ap; XF_S = xfs_ap;
                XF_P = xfp_ap;
            }
        }
    }
    {   // outer: skipped while farther than its box
        let bd_outer = cullDist(xfPoint(p, UB.xf_outer), UB.bxlo_outer, UB.bxhi_outer) * UB.xf_outer[3].w;
        if (bd_outer > cullMargin()) { CULL = min(CULL, bd_outer); } else {
            // group outer (subtract, smooth)
            {
                let p = xfPoint(p, UB.xf_outer);
                let xfm_outer = XF_M; let xfs_outer = XF_S;
                XF_M = XF_M * xfRot(UB.xf_outer); XF_S = XF_S * UB.xf_outer[3].w;
                let xfp_outer = XF_P; XF_P = p;
                var k_outer = VEC4(0.0, 0.0, 1.0, 1.0e7);
                var km_outer = MAT_AIR;
                {
                    var C = emptyHit(r);     // this child alone
                    XF_SUB += 1u;
                    // group inner (union, smooth)
                    {
                        let p = xfPoint(p, UB.xf_inner);
                        let xfm_inner = XF_M; let xfs_inner = XF_S;
                        XF_M = XF_M * xfRot(UB.xf_inner); XF_S = XF_S * UB.xf_inner[3].w;
                        let xfp_inner = XF_P; XF_P = p;
                        var k_inner = VEC4(0.0, 0.0, 1.0, 1.0e7);
                        var km_inner = MAT_AIR;
                        {
                            var C = emptyHit(r);     // this child alone
                            XF_SUB += 1u;
                            // node ina (code)
                            {
                                let p = xfPoint(p, UB.xf_ina);
                                let xfm_ina = XF_M; let xfs_ina = XF_S;
                                XF_M = XF_M * xfRot(UB.xf_ina); XF_S = XF_S * UB.xf_ina[3].w;
                                let xfp_ina = XF_P; XF_P = p;
                                {
                                    let radius = UB.radius_ina;
                                    let MATERIAL = matid_white;
// A sphere around this node's origin.
C = add_new(C, Nsphere(p, radius), MATERIAL);
                                }
                                XF_M = xfm_ina; XF_S = xfs_ina;
                                XF_P = xfp_ina;
                            }
                            XF_SUB -= 1u;
                            k_inner = C.s; km_inner = C.m;
                        }
                        {
                            var C = emptyHit(r);     // this child alone
                            XF_SUB += 1u;
                            // node inb (code)
                            {
                                let p = xfPoint(p, UB.xf_inb);
                                let xfm_inb = XF_M; let xfs_inb = XF_S;
                                XF_M = XF_M * xfRot(UB.xf_inb); XF_S = XF_S * UB.xf_inb[3].w;
                                let xfp_inb = XF_P; XF_P = p;
                                {
                                    let size = UB.size_inb;
                                    let rounding = UB.rounding_inb;
                                    let MATERIAL = matid_white;
// A box: size is the HALF-size along each axis; the rounding stays inside it.
C = add_new(C, NboxRounded(p, size, rounding), MATERIAL);
                                }
                                XF_M = xfm_inb; XF_S = xfs_inb;
                                XF_P = xfp_inb;
                            }
                            XF_SUB -= 1u;
                            km_inner = select(km_inner, C.m, C.s.w < k_inner.w);
                            k_inner = csgUnion(k_inner, C.s, UB.blend_inner);
                        }
                        C = fold(C, k_inner, km_inner);
                        XF_M = xfm_inner; XF_S = xfs_inner;
                        XF_P = xfp_inner;
                    }
                    XF_SUB -= 1u;
                    k_outer = C.s; km_outer = C.m;
                }
                {
                    var C = emptyHit(r);     // this child alone
                    XF_SUB += 1u;
                    // node outc (code)
                    {
                        let p = xfPoint(p, UB.xf_outc);
                        let xfm_outc = XF_M; let xfs_outc = XF_S;
                        XF_M = XF_M * xfRot(UB.xf_outc); XF_S = XF_S * UB.xf_outc[3].w;
                        let xfp_outc = XF_P; XF_P = p;
                        {
                            let radius = UB.radius_outc;
                            let height = UB.height_outc;
                            let MATERIAL = matid_white;
// A cylinder along z, centred on this node's origin.
C = add_new(C, Ncylinder(p, height * 0.5, radius), MATERIAL);
                        }
                        XF_M = xfm_outc; XF_S = xfs_outc;
                        XF_P = xfp_outc;
                    }
                    XF_SUB -= 1u;
                    k_outer = csgSubtract(k_outer, C.s, UB.blend_outer);
                }
                C = fold(C, k_outer, km_outer);
                XF_M = xfm_outer; XF_S = xfs_outer;
                XF_P = xfp_outer;
            }
        }
    }
    {   // cc: skipped while farther than its box
        let bd_cc = cullDist(xfPoint(p, UB.xf_cc), UB.bxlo_cc, UB.bxhi_cc) * UB.xf_cc[3].w;
        if (bd_cc > cullMargin()) { CULL = min(CULL, bd_cc); } else {
            // group cc (subtract, smooth, code)
            {
                let p = xfPoint(p, UB.xf_cc);
                let xfm_cc = XF_M; let xfs_cc = XF_S;
                XF_M = XF_M * xfRot(UB.xf_cc); XF_S = XF_S * UB.xf_cc[3].w;
                let xfp_cc = XF_P; XF_P = p;
                let xfmc_cc = XF_M; let xfsc_cc = XF_S;
                {
                    var p = p;
C = children_cc(C, p);
C = children_cc(C, p + VEC3(0.0, 0.0, 2.5));
                }
                XF_M = xfmc_cc; XF_S = xfsc_cc;
                XF_M = xfm_cc; XF_S = xfs_cc;
                XF_P = xfp_cc;
            }
        }
    }
    {   // rb: skipped while farther than its box
        let bd_rb = cullDist(xfPoint(p, UB.xf_rb), UB.bxlo_rb, UB.bxhi_rb) * UB.xf_rb[3].w;
        if (bd_rb > cullMargin()) { CULL = min(CULL, bd_rb); } else {
            // group rb (union, smooth)
            {
                let p = xfPoint(p, UB.xf_rb);
                let xfm_rb = XF_M; let xfs_rb = XF_S;
                XF_M = XF_M * xfRot(UB.xf_rb); XF_S = XF_S * UB.xf_rb[3].w;
                let xfp_rb = XF_P; XF_P = p;
                var k_rb = VEC4(0.0, 0.0, 1.0, 1.0e7);
                var km_rb = MAT_AIR;
                {
                    var C = emptyHit(r);     // this child alone
                    XF_SUB += 1u;
                    // node rba (code)
                    {
                        let p = xfPoint(p, UB.xf_rba);
                        let xfm_rba = XF_M; let xfs_rba = XF_S;
                        XF_M = XF_M * xfRot(UB.xf_rba); XF_S = XF_S * UB.xf_rba[3].w;
                        let xfp_rba = XF_P; XF_P = p;
                        {
                            let size = UB.size_rba;
                            let rounding = UB.rounding_rba;
                            let MATERIAL = matid_white;
// A box: size is the HALF-size along each axis; the rounding stays inside it.
C = add_new(C, NboxRounded(p, size, rounding), MATERIAL);
                        }
                        XF_M = xfm_rba; XF_S = xfs_rba;
                        XF_P = xfp_rba;
                    }
                    XF_SUB -= 1u;
                    k_rb = C.s; km_rb = C.m;
                }
                {
                    var C = emptyHit(r);     // this child alone
                    XF_SUB += 1u;
                    // group rbrel (union, code)
                    {
                        let p = xfPoint(p, UB.xf_rbrel);
                        let xfm_rbrel = XF_M; let xfs_rbrel = XF_S;
                        XF_M = XF_M * xfRot(UB.xf_rbrel); XF_S = XF_S * UB.xf_rbrel[3].w;
                        let xfp_rbrel = XF_P; XF_P = p;
                        let xfmc_rbrel = XF_M; let xfsc_rbrel = XF_S;
                        {
                            var p = p;
                            let amount = UB.amount_rbrel;
                            let size = UB.size_rbrel;
                            let SURFACE_ONLY = UB.blend_rb <= 0.0;     // true: nothing above reads more than its surface
// Noise relief: a rough surface up to "amount" high and low, with features about "size"
// across -- four octaves of gradient noise (lib/pathtracer/core/noise.js). Costs four
// noises per step. The relief steepens the field by at most amount / size times the fBm's
// bound over its peak, so distances are divided by that: shorter steps, no holes. The bound
// is the MEASURED one (a quarter of the proved one, and a quarter the steps); for a proof
// use NZ_GRAD_LIP. The normal is by differences.
// IN A SHELL: the noise moves the surface by at most NZ_GRAD_VALUE_BOUND x amount (proved,
// noise.js), so beyond that from the plain shape, the plain distance less it is a safe
// distance -- no noise, no division. Only points near the surface pay for the noise. The
// edge is twice that out, so a step from the shell is never shorter than the reach (a ray
// grazing it would crawl), plus the hit tolerance times (slope + 1): a hit is within
// slope tolerances of the plain shape's reach and its normal's differences one more, so
// they never straddle the edge, where the value jumps. Not under a smooth blend or group
// code (SURFACE_ONLY false): those read the field away from the surface, flat out there.
var H = children_rbrel(emptyHit(r), p);
let peak = nzFbmLip(4u, 1.0, 0.5, 1.0);                 // the octaves' amplitudes summed
let slope = 1.0 + amount / size * nzFbmLip(4u, 2.0, 0.5, NZ_GRAD_LIP_MEASURED) / peak;
let reach = NZ_GRAD_VALUE_BOUND * abs(amount) * XF_S;   // how far the noise can move it
if (SURFACE_ONLY && abs(H.s.w) > 2.0 * reach + (slope + 1.0) * marchEps()) {
    H.s = VEC4(0.0, 0.0, 0.0, H.s.w - sign(H.s.w) * reach);
} else {
    let n = fbm3(p / size, 1u, 4u, 2.0, 0.5);
    H.s = VEC4(0.0, 0.0, 0.0, (H.s.w - amount * n.w / peak * XF_S) / slope);
}
C = fold(C, H.s, H.m);
                        }
                        XF_M = xfmc_rbrel; XF_S = xfsc_rbrel;
                        XF_M = xfm_rbrel; XF_S = xfs_rbrel;
                        XF_P = xfp_rbrel;
                    }
                    XF_SUB -= 1u;
                    km_rb = select(km_rb, C.m, C.s.w < k_rb.w);
                    k_rb = csgUnion(k_rb, C.s, UB.blend_rb);
                }
                C = fold(C, k_rb, km_rb);
                XF_M = xfm_rb; XF_S = xfs_rb;
                XF_P = xfp_rb;
            }
        }
    }
    {   // pl: skipped while farther than its box
        let bd_pl = cullDist(xfPoint(p, UB.xf_pl), UB.bxlo_pl, UB.bxhi_pl) * UB.xf_pl[3].w;
        if (bd_pl > cullMargin()) { CULL = min(CULL, bd_pl); } else {
            // group pl (intersect, smooth)
            {
                let p = xfPoint(p, UB.xf_pl);
                let xfm_pl = XF_M; let xfs_pl = XF_S;
                XF_M = XF_M * xfRot(UB.xf_pl); XF_S = XF_S * UB.xf_pl[3].w;
                let xfp_pl = XF_P; XF_P = p;
                var k_pl = VEC4(0.0, 0.0, 1.0, 1.0e7);
                var km_pl = MAT_AIR;
                {
                    var C = emptyHit(r);     // this child alone
                    XF_SUB += 1u;
                    // node pla (code)
                    {
                        let p = xfPoint(p, UB.xf_pla);
                        let xfm_pla = XF_M; let xfs_pla = XF_S;
                        XF_M = XF_M * xfRot(UB.xf_pla); XF_S = XF_S * UB.xf_pla[3].w;
                        let xfp_pla = XF_P; XF_P = p;
                        {
                            let size = UB.size_pla;
                            let rounding = UB.rounding_pla;
                            let MATERIAL = matid_local;
// A box: size is the HALF-size along each axis; the rounding stays inside it.
C = add_new(C, NboxRounded(p, size, rounding), MATERIAL);
                        }
                        XF_M = xfm_pla; XF_S = xfs_pla;
                        XF_P = xfp_pla;
                    }
                    XF_SUB -= 1u;
                    k_pl = C.s; km_pl = C.m;
                }
                {
                    var C = emptyHit(r);     // this child alone
                    XF_SUB += 1u;
                    // node plb (code)
                    {
                        let p = xfPoint(p, UB.xf_plb);
                        let xfm_plb = XF_M; let xfs_plb = XF_S;
                        XF_M = XF_M * xfRot(UB.xf_plb); XF_S = XF_S * UB.xf_plb[3].w;
                        let xfp_plb = XF_P; XF_P = p;
                        {
                            let radius = UB.radius_plb;
                            let MATERIAL = matid_white;
// A sphere around this node's origin.
C = add_new(C, Nsphere(p, radius), MATERIAL);
                        }
                        XF_M = xfm_plb; XF_S = xfs_plb;
                        XF_P = xfp_plb;
                    }
                    XF_SUB -= 1u;
                    k_pl = csgIntersect(k_pl, C.s, UB.blend_pl);
                }
                C = fold(C, k_pl, km_pl);
                XF_M = xfm_pl; XF_S = xfs_pl;
                XF_P = xfp_pl;
            }
        }
    }
    {   // dis: skipped while farther than its box
        let bd_dis = cullDist(xfPoint(p, UB.xf_dis), UB.bxlo_dis, UB.bxhi_dis) * UB.xf_dis[3].w;
        if (bd_dis > cullMargin()) { CULL = min(CULL, bd_dis); } else {
            // group dis (subtract)
            {
                let p = xfPoint(p, UB.xf_dis);
                let xfm_dis = XF_M; let xfs_dis = XF_S;
                XF_M = XF_M * xfRot(UB.xf_dis); XF_S = XF_S * UB.xf_dis[3].w;
                let xfp_dis = XF_P; XF_P = p;
                var k_dis = VEC4(0.0, 0.0, 1.0, 1.0e7);
                var km_dis = MAT_AIR;
                {
                    var C = emptyHit(r);     // this child alone
                    XF_SUB += 1u;
                    // node disb (code)
                    {
                        let p = xfPoint(p, UB.xf_disb);
                        let xfm_disb = XF_M; let xfs_disb = XF_S;
                        XF_M = XF_M * xfRot(UB.xf_disb); XF_S = XF_S * UB.xf_disb[3].w;
                        let xfp_disb = XF_P; XF_P = p;
                        {
                            let radius = UB.radius_disb;
                            let MATERIAL = matid_white;
// A sphere around this node's origin.
C = add_new(C, Nsphere(p, radius), MATERIAL);
                        }
                        XF_M = xfm_disb; XF_S = xfs_disb;
                        XF_P = xfp_disb;
                    }
                    XF_SUB -= 1u;
                    k_dis = C.s; km_dis = C.m;
                }
                {
                    var C = emptyHit(r);     // this child alone
                    XF_SUB += 1u;
                    // node disc (code)
                    {
                        let p = xfPoint(p, UB.xf_disc);
                        let xfm_disc = XF_M; let xfs_disc = XF_S;
                        XF_M = XF_M * xfRot(UB.xf_disc); XF_S = XF_S * UB.xf_disc[3].w;
                        let xfp_disc = XF_P; XF_P = p;
                        {
                            let radius = UB.radius_disc;
                            let height = UB.height_disc;
                            let MATERIAL = matid_white;
// A cylinder along z, centred on this node's origin.
C = add_new(C, Ncylinder(p, height * 0.5, radius), MATERIAL);
                        }
                        XF_M = xfm_disc; XF_S = xfs_disc;
                        XF_P = xfp_disc;
                    }
                    XF_SUB -= 1u;
                    k_dis = csgSubtract(k_dis, C.s, UB.blend_dis);
                }
                C = fold(C, k_dis, km_dis);
                XF_M = xfm_dis; XF_S = xfs_dis;
                XF_P = xfp_dis;
            }
        }
    }
    {   // mid: skipped while farther than its box
        let bd_mid = cullDist(xfPoint(p, UB.xf_mid), UB.bxlo_mid, UB.bxhi_mid) * UB.xf_mid[3].w;
        if (bd_mid > cullMargin()) { CULL = min(CULL, bd_mid); } else {
            // group mid (intersect, smooth)
            {
                let p = xfPoint(p, UB.xf_mid);
                let xfm_mid = XF_M; let xfs_mid = XF_S;
                XF_M = XF_M * xfRot(UB.xf_mid); XF_S = XF_S * UB.xf_mid[3].w;
                let xfp_mid = XF_P; XF_P = p;
                var k_mid = VEC4(0.0, 0.0, 1.0, 1.0e7);
                var km_mid = MAT_AIR;
                {
                    var C = emptyHit(r);     // this child alone
                    XF_SUB += 1u;
                    // node mida (code)
                    {
                        let p = xfPoint(p, UB.xf_mida);
                        let xfm_mida = XF_M; let xfs_mida = XF_S;
                        XF_M = XF_M * xfRot(UB.xf_mida); XF_S = XF_S * UB.xf_mida[3].w;
                        let xfp_mida = XF_P; XF_P = p;
                        {
                            let size = UB.size_mida;
                            let rounding = UB.rounding_mida;
                            let MATERIAL = matid_white;
// A box: size is the HALF-size along each axis; the rounding stays inside it.
C = add_new(C, NboxRounded(p, size, rounding), MATERIAL);
                        }
                        XF_M = xfm_mida; XF_S = xfs_mida;
                        XF_P = xfp_mida;
                    }
                    XF_SUB -= 1u;
                    k_mid = C.s; km_mid = C.m;
                }
                {
                    var C = emptyHit(r);     // this child alone
                    XF_SUB += 1u;
                    // node midc (code)
                    {
                        let p = xfPoint(p, UB.xf_midc);
                        let xfm_midc = XF_M; let xfs_midc = XF_S;
                        XF_M = XF_M * xfRot(UB.xf_midc); XF_S = XF_S * UB.xf_midc[3].w;
                        let xfp_midc = XF_P; XF_P = p;
                        {
                            let ring = UB.ring_midc;
                            let tube = UB.tube_midc;
                            let MATERIAL = matid_white;
// A torus in the xy plane: ring is the radius to the tube's centre, tube its own radius.
C = add_new(C, Ntorus(p, ring, tube), MATERIAL);
                        }
                        XF_M = xfm_midc; XF_S = xfs_midc;
                        XF_P = xfp_midc;
                    }
                    XF_SUB -= 1u;
                    k_mid = csgIntersect(k_mid, C.s, UB.blend_mid);
                }
                C = fold(C, k_mid, km_mid);
                XF_M = xfm_mid; XF_S = xfs_mid;
                XF_P = xfp_mid;
            }
        }
    }
    {   // plain: skipped while farther than its box
        let bd_plain = cullDist(xfPoint(p, UB.xf_plain), UB.bxlo_plain, UB.bxhi_plain) * UB.xf_plain[3].w;
        if (bd_plain > cullMargin()) { CULL = min(CULL, bd_plain); } else {
            // group plain (union)
            {
                let p = xfPoint(p, UB.xf_plain);
                let xfm_plain = XF_M; let xfs_plain = XF_S;
                XF_M = XF_M * xfRot(UB.xf_plain); XF_S = XF_S * UB.xf_plain[3].w;
                let xfp_plain = XF_P; XF_P = p;
                // node pa (code)
                {
                    let p = xfPoint(p, UB.xf_pa);
                    let xfm_pa = XF_M; let xfs_pa = XF_S;
                    XF_M = XF_M * xfRot(UB.xf_pa); XF_S = XF_S * UB.xf_pa[3].w;
                    let xfp_pa = XF_P; XF_P = p;
                    {
                        let radius = UB.radius_pa;
                        let MATERIAL = matid_white;
// A sphere around this node's origin.
C = add_new(C, Nsphere(p, radius), MATERIAL);
                    }
                    XF_M = xfm_pa; XF_S = xfs_pa;
                    XF_P = xfp_pa;
                }
                // node pb (code)
                {
                    let p = xfPoint(p, UB.xf_pb);
                    let xfm_pb = XF_M; let xfs_pb = XF_S;
                    XF_M = XF_M * xfRot(UB.xf_pb); XF_S = XF_S * UB.xf_pb[3].w;
                    let xfp_pb = XF_P; XF_P = p;
                    {
                        let size = UB.size_pb;
                        let rounding = UB.rounding_pb;
                        let MATERIAL = matid_white;
// A box: size is the HALF-size along each axis; the rounding stays inside it.
C = add_new(C, NboxRounded(p, size, rounding), MATERIAL);
                    }
                    XF_M = xfm_pb; XF_S = xfs_pb;
                    XF_P = xfp_pb;
                }
                XF_M = xfm_plain; XF_S = xfs_plain;
                XF_P = xfp_plain;
            }
        }
    }
    // node lone (code)
    {
        let p = xfPoint(p, UB.xf_lone);
        let xfm_lone = XF_M; let xfs_lone = XF_S;
        XF_M = XF_M * xfRot(UB.xf_lone); XF_S = XF_S * UB.xf_lone[3].w;
        let xfp_lone = XF_P; XF_P = p;
        {
            let MATERIAL = matid_white;
// The plane z = 0, solid below.
C = add_new(C, Nplane(p), MATERIAL);
        }
        XF_M = xfm_lone; XF_S = xfs_lone;
        XF_P = xfp_lone;
    }
    if (CULL < abs(C.s.w)) { C.s.w = CULL; }
    return C;
}