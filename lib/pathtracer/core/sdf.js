import { SUN_TINT, LUMA } from './photometry.js'
import { SHAPES } from './shapes.js'

/*======================================================================================
  SUN AND SKY, standalone: PRIMITIVES includes it, and so does prog_skynorm, which has to
  evaluate exactly this sky with no scene around it.

  THE OLD ONE WAS GREY, and arithmetically it could not have been anything else:

      var skyColor = pow(VEC3(0.2,0.5,1.0), VEC3(2)) * skyFactor + haze;

  skyFactor topped out at 0.0011, so the blue term peaked around 0.001, while haze was a
  SCALAR up to 0.5 added equally to all three channels. The neutral term outweighed the
  coloured one about 500 to 1.

  Replaced with single-scattering Rayleigh + Mie, which is barely more code and gets the
  three things a hand-tuned gradient never does: the zenith is blue because Rayleigh goes
  as 1/lambda^4, the horizon whitens because it looks through more air, and a low sun
  reddens because the light reaching that air has been through more air still.

  IN PHYSICAL UNITS NOW (cd/m^2 -- see core/photometry.js). The scattering model gives the
  SHAPE of the sky; its magnitude is whatever UB.skyScale makes it, and that is measured
  rather than calibrated: prog_skynorm integrates skyRadianceRaw over the hemisphere on the
  GPU and the host sets skyScale so the sky puts exactly UB.skyIlluminance lux on a
  horizontal surface. It used to be SKY_SCALE = 6.5, chosen so the new sky matched the
  irradiance of the old one, which was itself a number nobody had chosen.

  The sun is a uniform disc of luminance UB.sunL, derived on the host from the direct
  normal illuminance and the disc's size -- so the size is the shadow's softness and not
  its brightness, which the old radiance-valued slider (uSunIntensity at a half-angle
  uSunSize of 0.1 rad, 21x the real sun) got the wrong way round.

  SPLIT INTO SUN AND SKY, which is what next-event estimation needs: NEE samples the solar
  disc directly and the BSDF path must then not count it twice. skyLuminance takes the
  weight to apply to the disc -- 1.0 for a ray whose bounce did not sample the sun, 0.0 for
  one that did. See THE SUN IS SAMPLED DIRECTLY in wavefront.js.
======================================================================================*/
export const SKY = /* wgsl */`
// Rayleigh scattering per channel, proportional to 1/lambda^4 and normalised to blue.
const SKY_BETA_R = VEC3(0.175, 0.410, 1.0);
const SKY_BETA_M = 0.06;        // Mie, grey by definition -- this is the haze
const SKY_MIE_G  = 0.76;        // Mie forward-scattering, the glow around the sun
const SKY_DEPTH  = 0.35;        // air mass to optical depth
const LUMA_709   = VEC3(${LUMA.join(', ')});   // Y of linear Rec.709, the units' definition

fn sunDirection() -> VEC3 {
    let e = UB.uSunElevation * PI / 180.0;
    let a = UB.uSunAzimuth * PI / 180.0;
    return VEC3(cos(e) * sin(a), cos(e) * cos(a), sin(e));
}

// The luminance of the solar disc, tinted, with Y = UB.sunL exactly.
fn sunRadiance() -> VEC3 {
    return VEC3(${SUN_TINT.map(c => c.toFixed(7)).join(', ')}) * UB.sunL;
}


// Solid angle of the disc, which is the 1/pdf of sampling it uniformly. From the host, in
// double precision: 1 - cos(0.00465) in f32 is off by about half a percent.
fn sunSolidAngle() -> FLOAT { return UB.sunSolidAngle; }

/* INSIDE THE DISC, tested as |L x S|^2 <= sin^2(theta) on the sun's side, not as
   dot(L, S) >= cos(theta). At the real sun the two cosines differ by 1.1e-5, which is about
   180 f32 steps below 1.0: the dot-product test puts the edge wherever rounding says, and a
   direction sampled just inside can test as outside. The cross product is small there and
   keeps its relative precision. Every strategy -- the camera's BSDF hit, NEE, the photon
   emitter -- calls this, so wherever the edge is, it is the same edge. */
fn inSunDisc(dir: VEC3) -> bool {
    let sd = sunDirection();
    let L = normalize(dir);
    let c = cross(L, sd);
    return dot(L, sd) > 0.0 && dot(c, c) <= UB.sunSin2;
}

// Kasten-Young relative air mass: 1/cos(zenith) near the top, finite at the horizon.
fn airMass(cosZenith: FLOAT) -> FLOAT {
    let c = clamp(cosZenith, 0.0, 1.0);
    let zdeg = degrees(acos(c));
    return 1.0 / (c + 0.15 * pow(max(93.885 - zdeg, 0.1), -1.253));
}

/* Everything except the disc, before scaling. EVERY UB FIELD THIS READS must be in the key
   R.ensureSky measures on (raytrace_main.js) -- a field read here and missing there is a sky
   that changes without being re-measured. Today: uSunElevation, uSunAzimuth, uSkyTurbidity. */
fn skyRadianceRaw(dir: VEC3) -> VEC3 {
    let sd = sunDirection();
    let d = normalize(dir);
    let cosT = clamp(dot(d, sd), -1.0, 1.0);
    let mView = airMass(max(d.z, 0.0));
    let mSun = airMass(max(sd.z, 0.0));
    let bM = VEC3(SKY_BETA_M * (0.5 + max(UB.uSkyTurbidity, 0.0)));
    let bT = SKY_BETA_R + bM;

    let phaseR = 3.0 / (16.0 * PI) * (1.0 + cosT * cosT);
    let g = SKY_MIE_G;
    let phaseM = (1.0 - g * g) / (4.0 * PI * pow(max(1.0 + g * g - 2.0 * g * cosT, 1e-4), 1.5));

    // single scattering: how much is scattered towards the eye, times how much of the beam
    // survived to be scattered. The (1 - exp) is the saturating version of that product.
    let ext = exp(-bT * (mView + mSun) * SKY_DEPTH);
    return (SKY_BETA_R * phaseR + bM * phaseM) / bT * (VEC3(1.0) - ext);
}

/* Everything except the disc, in cd/m^2 -- or, for the white-furnace bench, one constant
   luminance in every direction (UB.envUniform > 0; the host turns the sun off with it). A furnace
   is the one environment in which the right answer for an albedo-1 material is known everywhere:
   the picture must equal the environment, pixel for pixel. */
fn skyRadiance(dir: VEC3) -> VEC3 {
    if (UB.envUniform > 0.0) { return VEC3(UB.envUniform); }
    /* THE STUDIO LIGHT (envMode 1): L0 (1 + top d.z), L0 derived so a level surface facing up gets
       studioIlluminance lux (photometry.studioLuminance). Smooth, so the cosine-weighted
       environment samples of light sampling suit it; the sun is off, and so its samples. */
    if (UB.envMode == 1u) { return UB.studioL * max(1.0 + UB.studioTop * normalize(dir).z, 0.0); }
    return skyRadianceRaw(dir) * UB.skyScale;
}

/* The solar disc alone, as a function of direction. envRadiance is sky plus this; the light
   tracer emits exactly this, so the two cannot disagree about where the sun's edge is or how
   bright it is. HARD-EDGED now, exactly: it used to fade over the outer 2% of its cosine
   range, which every strategy saw alike (so no bias) but which took about 1% off the
   illuminance -- a number that is now a setting and has to come out as set. */
fn sunDiscRadiance(dir: VEC3) -> VEC3 {
    return select(VEC3(0.0), sunRadiance(), inSunDisc(dir));
}

/* A direction uniformly inside the solar cone. pdf is 1/sunSolidAngle. Here rather than with
   the rest of NEE because the photon emitter needs it and compiles no shading code.
   Written in omc = 1 - cos rather than cos: sin = sqrt(omc (2 - omc)) keeps its precision
   where sqrt(1 - cos^2) of a cosine 1e-5 from 1 does not -- at the real sun that form put
   the sampled radius half a percent off. */
fn sampleSunCone(u: VEC2) -> VEC3 {
    let sd = sunDirection();
    let omc = u.x * UB.sunOneMinusCos;
    let cosT = 1.0 - omc;
    let sinT = sqrt(max(0.0, omc * (2.0 - omc)));
    let phi = 2.0 * PI * u.y;
    var t = VEC3(1.0, 0.0, 0.0);
    if (abs(sd.x) > 0.9) { t = VEC3(0.0, 1.0, 0.0); }
    let b1 = normalize(cross(t, sd));
    let b2 = cross(sd, b1);
    return normalize(b1 * (cos(phi) * sinT) + b2 * (sin(phi) * sinT) + sd * cosT);
}
`

export const  PRIMITIVES =/* wgsl */`
${SKY}

/*======================================================================================
  THE EMISSION FRAME, shared by the photon emitter and by the camera side's test of which
  paths the photons own. They must agree to the last bit, so there is one definition.

  Photons are parametrised by WHERE THEY CROSS THE PLANE THROUGH THE ORIGIN facing the sun,
  q = x b1 + y b2 with |x|, |y| <= ltHalf, and by their direction w in the solar cone. A
  photon starts far out along its own line, at the plane dot(p, s) = envRadius, which by
  the scene contract has nothing beyond it -- so a photon's first segment is exactly the
  stretch a camera path escaping along the same line would have crossed.

  That is what makes the split EXACT FOR ANY SQUARE. A camera path that reaches the solar
  disc along direction d leaves along a line; that line crosses the plane at one q. If q is
  inside the square, a photon could have come down this very line, and the photons own the
  path; if not, the camera side keeps it. So ltRadius is an efficiency setting and nothing
  else: too small and caustics stay noisy on the camera side, never missing. The half-size
  both sides read is UB.ltHalf: that setting, never wider than the scene's radius, worked out
  once on the host (photometry.js photonHalf) -- one number, so the two cannot disagree.

  Learning happens in these coordinates too, at the scene rather than out where photons
  start: a sun 5 degrees wide would smear a map drawn 400 units away by 35 units.
======================================================================================*/
fn ltFrame() -> mat3x3<f32> {                    // columns: b1, b2, s
    let s = sunDirection();
    var t = VEC3(1.0, 0.0, 0.0);
    if (abs(s.x) > 0.9) { t = VEC3(0.0, 1.0, 0.0); }
    let b1 = normalize(cross(t, s));
    return mat3x3<f32>(b1, cross(s, b1), s);
}

/* Where the line through p along d crosses the plane, in square coordinates (b1, b2). */
fn ltPlaneCoords(p: VEC3, d: VEC3) -> VEC2 {
    let frm = ltFrame();   // not F: that is a shorthand token for f32
    let q = p - d * (dot(p, frm[2]) / dot(d, frm[2]));
    return VEC2(dot(q, frm[0]), dot(q, frm[1]));
}

/* Could a photon have come down this line? d must point towards the sun side, which any
   direction inside the solar cone does. */
fn ltCovers(p: VEC3, d: VEC3) -> bool {
    if (dot(d, sunDirection()) <= 1e-4) { return false; }   // a cosine, not a length
    let xy = ltPlaneCoords(p, d);
    let R = UB.ltHalf;                           // scene units: the setting, capped at the radius
    return abs(xy.x) <= R && abs(xy.y) <= R;
}

/* The whole environment: sky plus disc, unweighted. This is what a light sample evaluates.
   The disc is hard-edged (sunDiscRadiance) because NEE samples exactly that cone and the two
   have to agree about where the light is. The soft glow around it comes from Mie
   scattering, where it belongs. */
fn envRadiance(dir: VEC3) -> VEC3 {
    return skyRadiance(dir) + sunDiscRadiance(dir);
}

/* What a ray collects when it escapes. The weight w is its MIS weight: 1.0 for a camera ray or any
   ray whose bounce did no light sampling, and otherwise the balance between the two
   strategies for the direction it happens to be travelling in.
   It scales the WHOLE environment, not just the disc as it did when NEE sampled only the
   sun -- light sampling now covers the sky too, so both strategies cover all of it and both
   have to be weighted. See MULTIPLE IMPORTANCE SAMPLING in tracebasics.js. */
fn skyLuminance(dir: VEC3, w: FLOAT) -> VEC3 {
    return envRadiance(dir) * w;
}

// SDF formulas that do not return normals.=======================================================================
fn sd(f:FLOAT)->VEC4 {
    return VEC4(0,0,0,f);
}
fn sdSphere(p: VEC3, r: FLOAT) -> VEC4 {
    return sd(length(p) - r);
}
fn sdBox(p: VEC3, b: VEC3) -> VEC4 {
    let q = abs(p) - b;
    return sd(length(max(q, VEC3(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0));
}
fn sdRoundedBox(p: VEC3, b: VEC3, r: FLOAT) -> VEC4 {
    let q = abs(p) - b;
    return sd(length(max(q, VEC3(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r);
}   
fn sdCylinder(p: VEC3, h: FLOAT, r: FLOAT) -> VEC4 {
    // SDF (Inigo Quilez): capped cylinder
    let q   = VEC2(length(p.xy), abs(p.z));
    let d   = q - VEC2(r, h);
    let out = max(d, VEC2(0.0));
    let dist = min(max(d.x, d.y), 0.0) + length(out);
    return sd(dist);
}

fn sdCappedCylinder(p: VEC3, a:VEC3,b:VEC3,r:FLOAT) -> VEC4 {
    // SDF (Inigo Quilez): capped cylinder between a and b
    let pa = p - a;
    let ba = b - a;
    let baba = dot(ba, ba);
    let paba = dot(pa, ba);
    let x = length(pa * baba - ba * paba) - r * baba;
    let y = abs(paba - baba * 0.5) - baba * 0.5;
    let x2 = x * x;
    let y2 = y * y * baba;
    let d=select (select(0., x2, x > 0.) + select(0., y2 , y>0.), -min(-x2, -y2) , max(x, y) < 0.0 );    
    return sd(sign(d) * sqrt(abs(d)) / baba);
}

fn opSmoothUnion(d1: VEC4, d2: VEC4, k: FLOAT) -> VEC4 {
    let h = clamp(0.5+0.5*(d2.w - d1.w)/k, 0.0, 1.0);
    let f = mix(d2.w, d1.w, h) - k*h*(1.0 - h);
    return sd(f);
}

fn opSmoothSubtract(d1: VEC4, d2: VEC4, k: FLOAT) -> VEC4 {
    let h = clamp(0.5 - 0.5 * (d2.w + d1.w) / k, 0.0, 1.0);
    let f = mix(d1.w, -d2.w, h) + k * h * (1.0 - h);
    return sd(f);
}

fn opSmoothIntersect(d1: VEC4, d2: VEC4, k: FLOAT) -> VEC4 {
    let h = clamp(0.5 - 0.5 * (d2.w - d1.w) / k, 0.0, 1.0);
    let f = mix(d2.w, d1.w, h) + k * h * (1.0 - h);
    return sd(f);
}

fn opScale(d: VEC4, s: FLOAT) -> VEC4 {
    return sd(d.w * s);
}

fn opUninion(d1: VEC4, d2: VEC4) -> VEC4 {
    return sd(min(d1.w, d2.w));
}   
fn opIntersection(d1: VEC4, d2: VEC4) -> VEC4 {
    return sd(max(d1.w, d2.w));
}
fn opSubtraction(d1: VEC4, d2: VEC4) -> VEC4 {
    return sd(max(d1.w, -d2.w));
}





// Menger sponge distance function
fn sdMenger( p:VEC3, ITER:u32) -> VEC4 {
    var d = sdBox(p, VEC3(1.)).w; // base cube
    var scale = 1.;
    for (var i:u32 = 0; i < ITER; i++) {
        // fold into [-1,1]
        var a = fract(0.5 * p * scale) * 2.0 - 1.0;
        scale *= 3.;

        // cross void: at least two coords small
        var r = abs(a)/2.;
        var c = (min(max(r.x, r.y), min(max(r.y, r.z), max(r.z, r.x))) - 1./3.) / scale;
        // subtract the void
        d = max(d, c);
    }
    return sd(d);
}







































//===========================================================================================================
// SDF formulas that return the surface distance AND normal vector.
// it returns a VEC4 where .xyz is the normal and .w is the distance.
// the direction of the normal is such that it points out of the surface (away from the interior volume).
// if the point is inside the surface, the normal still points outward
// the normal direction always has length 1 (unit vector).
//===========================================================================================================


fn Nsphere(p: VEC3, r: FLOAT) -> VEC4 {
    let d = length(p) - r;
    let n = normalize(p); // gradient of a sphere at p
    return VEC4(n, d);
}


// p: position, b: box half-sizes, r: radius
fn Nroundedbox(p: VEC3, b: VEC3, r: FLOAT) -> VEC4 {
    let q = abs(p) - b;
    let d = length(max(q, VEC3(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
    let g = max(q, VEC3(0.0));
    var n: VEC3;
    if (g.x > 0.0 || g.y > 0.0 || g.z > 0.0) {
        n = normalize(g) * sign(p);
    } else {
        // volledig binnen: kies het dominante vlak
        let s = sign(p);
        if (q.x > q.y && q.x > q.z) {
            n = VEC3(s.x, 0.0, 0.0);
        } else if (q.y > q.z) {
            n = VEC3(0.0, s.y, 0.0);
        } else {
            n = VEC3(0.0, 0.0, s.z);
        }
    }
    return VEC4(n, d);
}


fn Nbox(p: VEC3, b: VEC3) -> VEC4 {
    return Nroundedbox(p, b, 0.01);
}


fn Ncylinder(p: VEC3, h: FLOAT, r: FLOAT) -> VEC4 {
    // SDF (Inigo Quilez): capped cylinder
    let q   = VEC2(length(p.xy), abs(p.z));
    let d   = q - VEC2(r, h);
    let out = max(d, VEC2(0.0));
    let dist = min(max(d.x, d.y), 0.0) + length(out);

    // normale
    var n: VEC3;
    let len_xy = max(q.x, 1e-8);      // voorkom /0
    let n_side = VEC3(p.x/len_xy, p.y/len_xy, 0.0);
    let n_cap  = VEC3(0.0, 0.0, sign(p.z));

    if (d.x > 0.0 && d.y > 0.0) {
        // buiten in de “hoek”: combinatie van zijwand+kap, gewogen door d
        let w = out / max(length(out), 1e-8);
        n = normalize(VEC3(n_side.xy * w.x, 0.0) + n_cap * w.y);
    } else if (d.x > d.y) {
        // zijwand domineert (buiten of binnen)
        n = n_side;
    } else {
        // kap domineert (buiten of binnen)
        n = n_cap;
    }

    return VEC4(n, dist);
}


/* A SPHERICAL LENS on the z axis: diameter D, centre thickness t, radii r1 (the +z face) and r2 (the
   -z face). A positive radius bulges OUT (both positive: biconvex), a negative one is hollowed in,
   0 is flat -- the lens-maker's picture, not Zemax's signed-by-direction one.
   Each face is a sphere through its vertex (z = +-t/2): the lens is INSIDE a convex face's sphere
   and OUTSIDE a concave one's. Outside a sphere is unbounded, so a concave face is also capped by a
   plane through its rim, which leaves a flat flange where a real lens would have one. The lens is
   the intersection of the faces and the edge cylinder: max of their distances, which is a lower
   bound (safe to march) and exact near the winning face, whose gradient is the normal. */
/* FLAT SHEETS, zero thickness, in the xy plane: a rectangle of half-sizes h and a disc of radius
   r. For what a sheet is good for -- a source's emitting face, a planar optics detector, a ray
   limiter across a beam -- thickness would be a second surface nobody wants. The distance is never
   negative (nowhere is inside a sheet), so a sheet is seen from both sides, its normal facing the
   side the point is on: +z exactly on the plane, which is the side a source emits from. */
fn sheetNormal(q: VEC2, pz: FLOAT) -> VEC4 {
    let s = select(1.0, -1.0, pz < 0.0);
    let d = length(VEC3(q, pz));
    if (max(q.x, q.y) <= 0.0 || d < 1e-12) { return VEC4(0.0, 0.0, s, abs(pz)); }
    return VEC4(VEC3(q, pz) / d, d);
}
fn Nrectangle(p: VEC3, h: VEC2) -> VEC4 {
    let e = max(abs(p.xy) - h, VEC2(0.0));
    let n = sheetNormal(e, p.z);
    if (max(e.x, e.y) <= 0.0) { return n; }
    return VEC4(n.xy * sign(p.xy), n.z, n.w);   // beyond an edge: the gradient points away from it
}
fn Ndisc(p: VEC3, r: FLOAT) -> VEC4 {
    let l = length(p.xy);
    let e = max(l - r, 0.0);
    if (e <= 0.0) { return VEC4(0.0, 0.0, select(1.0, -1.0, p.z < 0.0), abs(p.z)); }
    let d = length(VEC2(e, p.z));
    let radial = p.xy / max(l, 1e-12);
    return VEC4(radial * (e / d), p.z / d, d);
}

fn lensFace(p: VEC3, vz: FLOAT, R: FLOAT, s: FLOAT, rim: FLOAT) -> VEC4 {
    // s: +1 for the +z face, -1 for the -z face; the outward normal of a flat face is (0,0,s)
    if (abs(R) < 1e-9) { return VEC4(0.0, 0.0, s, s * p.z - vz); }
    let q = p - VEC3(0.0, 0.0, s * (vz - R));      // from the face's centre of curvature
    let l = max(length(q), 1e-12);
    var f = VEC4(sign(R) * q / l, sign(R) * (l - abs(R)));
    if (R < 0.0) {
        let sag = abs(R) - sqrt(max(R * R - rim * rim, 0.0));
        let cap = VEC4(0.0, 0.0, s, s * p.z - (vz + sag));
        if (cap.w > f.w) { f = cap; }
    }
    return f;
}
fn Nlens(p: VEC3, D: FLOAT, t: FLOAT, r1: FLOAT, r2: FLOAT) -> VEC4 {
    let rim = 0.5 * D;
    let lxy = max(length(p.xy), 1e-12);
    var n = VEC4(p.x / lxy, p.y / lxy, 0.0, lxy - rim);
    let a = lensFace(p, 0.5 * t, r1, 1.0, rim);
    if (a.w > n.w) { n = a; }
    let b = lensFace(p, 0.5 * t, r2, -1.0, rim);
    if (b.w > n.w) { n = b; }
    return n;
}



//===========================================================================================================
// Union: choose nearest surface





// Smooth-Min (Smooth Union) with Normals:
fn Nsmin(a: VEC4, b: VEC4, k: FLOAT) -> VEC4 {
    let h = max(k - abs(a.w - b.w), 0.0);
    let m = select(1.0, 0.0, a.w < b.w);
    let blend = 0.5 * h / k;
    let d = mix(a.w, b.w, m) - h * h * 0.25 / k;
    let n = normalize(mix(a.xyz, b.xyz, m + (1.0 - 2.0 * m) * blend));
    return VEC4(n, d);
}

//Smooth-Max (Smooth Intersection) with Normals:
fn Nsmax(a: VEC4, b: VEC4, k: FLOAT) -> VEC4 {
    let h = max(k - abs(a.w - b.w), 0.0);
    let m = select(1.0, 0.0, a.w > b.w);
    let blend = 0.5 * h / k;
    let d = mix(a.w, b.w, m) + h * h * 0.25 / k;
    let n = normalize(mix(a.xyz, b.xyz, m + (1.0 - 2.0 * m) * blend));
    return VEC4(n, d);
}

fn NopSmoothUnion(a: VEC4, b: VEC4, k: FLOAT) -> VEC4 { return Nsmin(a, b, k); }
fn NopSmoothIntersect(a: VEC4, b: VEC4, k: FLOAT) -> VEC4 { return Nsmax(a, b, k); }
fn NopSmoothSubtract(a: VEC4, b: VEC4, k: FLOAT) -> VEC4 { return Nsmax(a, VEC4(-b.xyz, -b.w), k); }
















fn Nmenger(p: VEC3, ITER: u32) -> VEC4 {
    var nd = Nbox(p, VEC3(1.0));
    var d  = nd.w;
    var n  = nd.xyz;

    var scale = 1.0;
    for (var i: u32 = 0u; i < ITER; i = i + 1u) {
        // vouw naar [-1, 1]
        var a = fract(0.5 * p * scale) * 2.0 - 1.0;
        scale *= 3.0;

        // "kruis-void": minstens twee coördinaten klein
        var r  = abs(a) * 0.5;
        let m1 = max(r.x, r.y);  // xy-balk
        let m2 = max(r.y, r.z);  // yz-balk
        let m3 = max(r.z, r.x);  // zx-balk
        let m  = min(m1, min(m2, m3));
        let c  = (m - 1.0/3.0) / scale;  // -SDF(holte); we doen max(d,c)

        if (c > d) {
            d = c;

            // Bepaal welke balk actief is en binnen die balk welke as de max is
            if (m1 <= m2 && m1 <= m3) {
                // xy-balk
                if (r.x >= r.y) {
                    n = VEC3(sign(a.x), 0.0, 0.0);
                } else {
                    n = VEC3(0.0, sign(a.y), 0.0);
                }
            } else if (m2 <= m1 && m2 <= m3) {
                // yz-balk
                if (r.y >= r.z) {
                    n = VEC3(0.0, sign(a.y), 0.0);
                } else {
                    n = VEC3(0.0, 0.0, sign(a.z));
                }
            } else {
                // zx-balk
                if (r.z >= r.x) {
                    n = VEC3(0.0, 0.0, sign(a.z));
                } else {
                    n = VEC3(sign(a.x), 0.0, 0.0);
                }
            }
        }
    }
    return VEC4(normalize(n), d);
}
















//===========================================================================================================
// PRIMITIVES THE SCENE BUILDER OFFERS BY NAME, each returning (normal, distance) with the normal
// ANALYTIC wherever that is cheap. A primitive without one hands the renderer a zero normal, and it
// then takes one by differences: four or six more SDF evaluations of the whole scene per hit. So
// the normal is worth a few lines here. All are centred on the origin, z up, like Ncylinder; where
// they sit and how they turn is the transform's business.
// Every normalize() here is guarded: a point exactly on an axis or at the centre has no direction,
// and a NaN normal fails add_new's backface test and deletes the surface.

fn safeDir(v: VEC3, fallback: VEC3) -> VEC3 {
    let l = length(v);
    return select(fallback, v / l, l > 1e-12);
}

/* A ring around the z axis: R from the axis to the tube's centre, r the tube's radius. */
fn Ntorus(p: VEC3, R: FLOAT, r: FLOAT) -> VEC4 {
    let lxy = length(p.xy);
    let radial = select(VEC2(1.0, 0.0), p.xy / lxy, lxy > 1e-12);
    let q = VEC2(lxy - R, p.z);
    let n = safeDir(VEC3(radial * q.x, q.y), VEC3(0.0, 0.0, 1.0));
    return VEC4(n, length(q) - r);
}

/* A segment from z = -h to z = +h, swept by radius r: a pill. */
fn Ncapsule(p: VEC3, h: FLOAT, r: FLOAT) -> VEC4 {
    let c = VEC3(0.0, 0.0, clamp(p.z, -h, h));
    let v = p - c;
    // on the axis inside the segment there is no outward direction; any unit vector will do
    return VEC4(safeDir(v, VEC3(1.0, 0.0, 0.0)), length(v) - r);
}

/* The half-space below z = 0, surface facing +z. Infinite: it shades everything beneath it. */
fn Nplane(p: VEC3) -> VEC4 {
    return VEC4(0.0, 0.0, 1.0, p.z);
}

/* A box of half-size b, its edges rounded by r WITHIN that size (the old Nbox added its 0.01
   rounding outside it). r = 0 is a sharp box. */
fn NboxRounded(p: VEC3, b: VEC3, r: FLOAT) -> VEC4 {
    let rr = clamp(r, 0.0, min(b.x, min(b.y, b.z)));
    return Nroundedbox(p, b - VEC3(rr), rr);
}

/* A cone along z, base radius r1 at z = -h, top radius r2 at z = +h (0 for a point). Exact
   (Inigo Quilez's capped cone); its normal is left to the renderer -- the exact gradient has
   four regions, and a normal that is wrong in one of them is worse than a slower right one. */
fn sdCappedCone(p: VEC3, h: FLOAT, r1: FLOAT, r2: FLOAT) -> VEC4 {
    let q = VEC2(length(p.xy), p.z);
    let k1 = VEC2(r2, h);
    let k2 = VEC2(r2 - r1, 2.0 * h);
    let ca = VEC2(q.x - min(q.x, select(r2, r1, q.y < 0.0)), abs(q.y) - h);
    let cb = q - k1 + k2 * clamp(dot(k1 - q, k2) / dot(k2, k2), 0.0, 1.0);
    let s = select(1.0, -1.0, cb.x < 0.0 && ca.y < 0.0);
    return sd(s * sqrt(min(dot(ca, ca), dot(cb, cb))));
}

${SHAPES}
`