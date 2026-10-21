//======================================================================================================================
// SHAPES -- the scene builder's newer primitives (roadmap/BUILDER.md §6, phase 2), each returning (outward unit normal,
// signed distance) like the N* functions in sdf.js, which embeds this text in PRIMITIVES.
//
// EXACT OR SAFE, AND SAID WHICH. A distance that is too large anywhere lets the marcher step through the surface, and
// inside glass it is stepped through from within. So every shape here is exact inside, or a bound there (never
// larger than the true distance); outside it is exact unless its comment says "a bound". Each claim was MEASURED
// against an independent reference (dense profiles, exact point-to-triangle distances, dense spines) when the shapes
// were chosen, and test/shapes.test.mjs measures them again on this file's JS twin. Two textbook formulas were refused
// by that measurement: Quilez's pyramid is too large inside (by up to half the base, in 15-46% of the solid -- its
// size counts the four sides only, the base only sets the sign), and his parabola's sign flips in f32 near the curve
// (about 1% of samples where z is the focal height, and the whole axis read as surface). Their replacements are below.
//
// THE NORMALS ARE THE DISTANCE'S GRADIENT, analytic: the closest point's direction, (p - c) / |p - c|, or the winning
// piece's gradient. The test holds each one to central differences. A shape without one would cost the renderer three
// more evaluations of the whole scene per hit (tracebasics.js calcNormals_fast).
//
// NO sign(): WGSL's sign(0) is 0, which makes a normal that is not unit length on an axis or a fold (measured on the
// octahedron); select(-1, 1, x >= 0) instead. No unguarded normalize: a NaN normal fails add_new's backface test and
// deletes the surface (sdf.js). Every parameter is a live uniform, so every shape is finite for ANY values -- zero,
// negative, swapped -- with the guards each function names; the test sweeps them.
//
// A JS MIRROR follows the WGSL, function for function, for the no-GPU test -- as noise.js does. It is only as right as
// that correspondence, so keep the two next to each other and change them together.
//======================================================================================================================

export const SHAPES = /* wgsl */ `
//===========================================================================================================
// THE BUILDER'S NEWER SHAPES (lib/pathtracer/core/shapes.js, where the header says what is exact and why)
//===========================================================================================================

/* --- A 2D VOCABULARY WITH GRADIENTS. A shape of revolution is a 2D shape in the half-plane q = (r, z),
   r = length(p.xy): each piece returns VEC3(gradient.xy, distance) there, and g2Revolve lifts it into 3D. --- */

/* A unit 2D direction, or the fallback where there is none. */
fn g2Dir(v: VEC2, fallback: VEC2) -> VEC2 {
    let l = length(v);
    return select(fallback, v / l, l > 1e-12);
}
/* A circle of radius r around c (a sphere, revolved). */
fn g2Circle(q: VEC2, c: VEC2, r: FLOAT) -> VEC3 {
    let e = q - c;
    return VEC3(g2Dir(e, VEC2(1.0, 0.0)), length(e) - r);
}
/* An axis-aligned box of half-size b around c. Exact both sides. */
fn g2Box(q: VEC2, c: VEC2, b: VEC2) -> VEC3 {
    let s = select(VEC2(-1.0), VEC2(1.0), q >= c);
    let e = abs(q - c) - b;
    if (e.x > 0.0 || e.y > 0.0) {
        let o = max(e, VEC2(0.0));
        return VEC3(o / length(o) * s, length(o));
    }
    if (e.x > e.y) { return VEC3(s.x, 0.0, e.x); }
    return VEC3(0.0, s.y, e.y);
}
/* The parabola y = k x^2 (k > 0), signed: POSITIVE BELOW it (outside the bowl). Exact. The closest point solves
   x^3 - 3 a x - 2 b = 0 (Cardano), written so nothing cancels in f32: one real root as 2b / (u^2 - a + (a/u)^2),
   u^3 = b + sqrt(h) -- the textbook u + a/u subtracts nearly equal numbers -- and the sign from which side of the
   curve the point is, not from comparing x with the root. The gradient is the curve's normal at the foot, so no
   division by a distance that may be tiny. */
fn g2Parabola(q: VEC2, k: FLOAT) -> VEC3 {
    let sx = select(-1.0, 1.0, q.x >= 0.0);
    let xa = abs(q.x);              // not a capital x: the page's shorthand makes that one letter vec4<f32> (wgsl_shorthand.js SHORT_TOKENS)
    let ik = 1.0 / k;
    let a = ik * (q.y - 0.5 * ik) / 3.0;
    let b = 0.25 * ik * ik * xa;
    let h = b * b - a * a * a;
    var x: FLOAT;
    if (h > 0.0) {
        let u = pow(b + sqrt(h), 1.0 / 3.0);
        let w = a / u;
        x = 2.0 * b / (u * u - a + w * w);
    } else {
        x = 2.0 * sqrt(max(a, 0.0)) * cos(atan2(sqrt(-h), b) / 3.0);
    }
    let e = VEC2(xa - x, q.y - k * x * x);
    let side = select(-1.0, 1.0, k * xa * xa - q.y >= 0.0);
    let n = VEC2(2.0 * k * x, -1.0) / sqrt(1.0 + 4.0 * k * k * x * x);
    return VEC3(n.x * sx, n.y, side * length(e));
}
/* Of two pieces, the larger distance with its gradient: an intersection. Exact inside (the nearer boundary is the
   one); outside a bound where both pieces are close. */
fn g2Max(a: VEC3, b: VEC3) -> VEC3 { return select(b, a, a.z >= b.z); }
/* The complement: inside and outside swapped. */
fn g2Neg(a: VEC3) -> VEC3 { return -a; }
/* Moved by t along its gradient: the set where the distance is below t. */
fn g2Offset(a: VEC3, t: FLOAT) -> VEC3 { return VEC3(a.xy, a.z - t); }
/* A 2D result at q = (length(p.xy), p.z), lifted around the z axis. On the axis any radial direction will do. */
fn g2Revolve(p: VEC3, g: VEC3) -> VEC4 {
    let l = length(p.xy);
    let radial = select(VEC2(1.0, 0.0), p.xy / l, l > 1e-12);
    return VEC4(radial * g.x, g.y, g.z);
}

/* --- THE SHAPES. All z up; centred on the origin, but for the dome (its base on z = 0) and the reflector (its
   focus at the origin) -- the points an optical part is placed by. --- */

/* A ROUND CONE: a sphere of radius r1 at z = -h/2 and one of r2 at z = +h/2, and the cone that touches both
   (Quilez's round cone). Exact both sides. With h <= |r1 - r2| one sphere holds the other, and is the shape. */
fn NroundCone(p: VEC3, r1: FLOAT, r2: FLOAT, h: FLOAT) -> VEC4 {
    let q = VEC2(length(p.xy), p.z + 0.5 * h);
    if (h <= abs(r1 - r2)) {
        if (r1 >= r2) { return g2Revolve(p, g2Circle(q, VEC2(0.0, 0.0), r1)); }
        return g2Revolve(p, g2Circle(q, VEC2(0.0, h), r2));
    }
    let b = (r1 - r2) / h;
    let a = sqrt(1.0 - b * b);
    let k = dot(q, VEC2(-b, a));
    if (k < 0.0) { return g2Revolve(p, g2Circle(q, VEC2(0.0, 0.0), r1)); }
    if (k > a * h) { return g2Revolve(p, g2Circle(q, VEC2(0.0, h), r2)); }
    return g2Revolve(p, VEC3(a, b, dot(q, VEC2(a, b)) - r1));
}

/* A REGULAR OCTAHEDRON, s from the centre to each vertex (Quilez's exact one). Exact both sides: inside it is the
   nearest face's plane; outside, in a face's own region the same, else the nearest edge's point. */
fn Noctahedron(p: VEC3, s0: FLOAT) -> VEC4 {
    let s = max(s0, 0.0);
    let sg = select(VEC3(-1.0), VEC3(1.0), p >= VEC3(0.0));
    let a = abs(p);
    let m = a.x + a.y + a.z - s;
    let face = sg * 0.5773502691896258;
    if (3.0 * a.x < m) {
        let k = clamp(0.5 * (a.z - a.y + s), 0.0, s);
        let v = VEC3(a.x, a.y - s + k, a.z - k);
        return VEC4(sg * safeDir(v, face * sg), length(v));
    }
    if (3.0 * a.y < m) {
        let k = clamp(0.5 * (a.x - a.z + s), 0.0, s);
        let v = VEC3(a.y, a.z - s + k, a.x - k);
        let u = VEC3(v.z, v.x, v.y);
        return VEC4(sg * safeDir(u, face * sg), length(v));
    }
    if (3.0 * a.z < m) {
        let k = clamp(0.5 * (a.y - a.x + s), 0.0, s);
        let v = VEC3(a.z, a.x - s + k, a.y - k);
        let u = VEC3(v.y, v.z, v.x);
        return VEC4(sg * safeDir(u, face * sg), length(v));
    }
    return VEC4(face, m * 0.5773502691896258);
}

/* A SQUARE PYRAMID: base side base on z = -h/2, apex on z = +h/2. Folded by its symmetry to x >= y >= 0, where the
   nearest point is on the +x side face or the base (a mirror-symmetric convex solid keeps it on the point's side).
   Inside: the nearer of that face's plane and the base's -- exact for a convex solid. Outside: the nearer of the
   closest point on that face (in its own 2D coordinates) and on the base square -- exact. */
fn Npyramid(p: VEC3, base: FLOAT, height: FLOAT) -> VEC4 {
    let b = max(0.5 * base, 1e-6);
    let h = max(height, 1e-6);
    let L = sqrt(h * h + b * b);
    let sg = select(VEC2(-1.0), VEC2(1.0), p.xy >= VEC2(0.0));
    let ax = abs(p.x); let ay = abs(p.y);
    let swap = ay > ax;
    let P = VEC3(max(ax, ay), min(ax, ay), p.z + 0.5 * h);
    let n = VEC3(h, 0.0, b) / L;                      // the +x face's outward normal
    let t = VEC3(-b, 0.0, h) / L;                     // up that face, along its slant
    let dp = dot(P - VEC3(b, 0.0, 0.0), n);
    var g: VEC3;
    var d: FLOAT;
    if (dp <= 0.0 && P.z >= 0.0) {
        if (dp >= -P.z) { g = n; d = dp; } else { g = VEC3(0.0, 0.0, -1.0); d = -P.z; }
    } else {
        // the face as a 2D triangle: base edge u in [-b, b] at v = 0, apex at (0, L); here u = P.y >= 0
        let u = P.y;
        let v = dot(P - VEC3(b, 0.0, 0.0), t);
        var cu = u; var cv = v;
        if (v < 0.0 || u / b + v / L > 1.0) {
            let e1 = VEC2(min(u, b), 0.0);
            let hy = VEC2(-b, L);
            let s1 = clamp(dot(VEC2(u - b, v), hy) / dot(hy, hy), 0.0, 1.0);
            let e2 = VEC2(b, 0.0) + hy * s1;
            let pick2 = v >= 0.0 && dot(VEC2(u, v) - e2, VEC2(u, v) - e2) < dot(VEC2(u, v) - e1, VEC2(u, v) - e1);
            let c = select(e1, e2, pick2);
            cu = c.x; cv = c.y;
        }
        let cf = VEC3(b, cu, 0.0) + t * cv;
        let cb = VEC3(min(P.x, b), min(P.y, b), 0.0);
        let vf = P - cf; let vb = P - cb;
        let lf = length(vf); let lb = length(vb);
        if (lf <= lb) { g = safeDir(vf, n); d = lf; } else { g = safeDir(vb, VEC3(0.0, 0.0, -1.0)); d = lb; }
    }
    let gxy = select(g.xy, g.yx, swap) * sg;
    return VEC4(gxy, g.z, d);
}

/* A FRUSTUM -- the builder's pyramid since the user asked for one more flexible (2026-10-01): a rectangular base, full
   sides base.x by base.y, on z = -h/2, and a rectangular top, top.x by top.y, on z = +h/2. A top of 0 by 0 is an apex
   (the old Npyramid, which stays for the nodes that call it); a top bigger than the base is the same solid upside
   down; either is convex. Folded by its two mirror planes (no x-y swap: the base need not be square), the nearest
   point is on the +x side, the +y side, the top or the base (a mirror-symmetric convex solid keeps it on the point's
   side). Inside: the nearest of those four planes -- exact for a convex solid. Outside: the nearest of the closest
   points on those four faces -- exact. */
fn frSeg(P: VEC3, a: VEC3, b: VEC3) -> VEC3 {
    let ab = b - a;
    return a + ab * clamp(dot(P - a, ab) / max(dot(ab, ab), 1e-30), 0.0, 1.0);
}
/* The nearest point of a planar convex quad a-b-c-d, counter-clockwise about its unit normal n (two corners may meet:
   an apex) -- the projection if it falls inside, else the nearest edge's nearest point. */
fn frQuad(P: VEC3, a: VEC3, b: VEC3, c: VEC3, d: VEC3, n: VEC3) -> VEC3 {
    let q = P - n * dot(P - a, n);
    if (dot(cross(b - a, q - a), n) >= 0.0 && dot(cross(c - b, q - b), n) >= 0.0
        && dot(cross(d - c, q - c), n) >= 0.0 && dot(cross(a - d, q - d), n) >= 0.0) { return q; }
    var best = frSeg(P, a, b);
    let e1 = frSeg(P, b, c);
    if (dot(P - e1, P - e1) < dot(P - best, P - best)) { best = e1; }
    let e2 = frSeg(P, c, d);
    if (dot(P - e2, P - e2) < dot(P - best, P - best)) { best = e2; }
    let e3 = frSeg(P, d, a);
    if (dot(P - e3, P - e3) < dot(P - best, P - best)) { best = e3; }
    return best;
}
fn Nfrustum(p: VEC3, base: VEC2, top: VEC2, height: FLOAT) -> VEC4 {
    let b = abs(base) * 0.5;
    let t = abs(top) * 0.5;
    let h = max(height, 1e-6);
    let sg = select(VEC2(-1.0), VEC2(1.0), p.xy >= VEC2(0.0));
    let P = VEC3(abs(p.x), abs(p.y), p.z + 0.5 * h);
    let nx = safeDir(VEC3(h, 0.0, b.x - t.x), VEC3(1.0, 0.0, 0.0));     // the +x side's outward normal
    let ny = safeDir(VEC3(0.0, h, b.y - t.y), VEC3(0.0, 1.0, 0.0));     // the +y side's
    let dx = dot(P - VEC3(b.x, 0.0, 0.0), nx);
    let dy = dot(P - VEC3(0.0, b.y, 0.0), ny);
    var g = nx;
    var d = dx;
    if (dx <= 0.0 && dy <= 0.0 && P.z >= 0.0 && P.z <= h) {
        if (dy > d) { d = dy; g = ny; }
        if (P.z - h > d) { d = P.z - h; g = VEC3(0.0, 0.0, 1.0); }
        if (-P.z > d) { d = -P.z; g = VEC3(0.0, 0.0, -1.0); }
    } else {
        let cx = frQuad(P, VEC3(b.x, -b.y, 0.0), VEC3(b.x, b.y, 0.0), VEC3(t.x, t.y, h), VEC3(t.x, -t.y, h), nx);
        let cy = frQuad(P, VEC3(b.x, b.y, 0.0), VEC3(-b.x, b.y, 0.0), VEC3(-t.x, t.y, h), VEC3(t.x, t.y, h), ny);
        let ct = VEC3(min(P.x, t.x), min(P.y, t.y), h);
        let cb = VEC3(min(P.x, b.x), min(P.y, b.y), 0.0);
        var c = cx;
        var fall = nx;
        if (dot(P - cy, P - cy) < dot(P - c, P - c)) { c = cy; fall = ny; }
        if (dot(P - ct, P - ct) < dot(P - c, P - c)) { c = ct; fall = VEC3(0.0, 0.0, 1.0); }
        if (dot(P - cb, P - cb) < dot(P - c, P - c)) { c = cb; fall = VEC3(0.0, 0.0, -1.0); }
        g = safeDir(P - c, fall);
        d = length(P - c);
    }
    return VEC4(g.xy * sg, g.z, d);
}

/* A PRISM: a regular polygon, sides of it (rounded, 3 to 64) with radius to its corners and a flat side facing -y -- so
   4 is a square square to the axes and 3 a triangle standing on its base -- extruded height along z, centred. sides is
   a live uniform: 3 to 4 to 6 without a compile (the user, 2026-10-01: "toggle between triangular and square").
   Exact: the edge whose normal is nearest the point's direction is the one it is nearest (inside, that edge has the
   largest projection; outside, a point in its wedge is nearest that edge or one of its two corners -- a corner's ray
   from the centre lies within the corner's own normal cone). */
fn g2RegularPolygon(q: VEC2, sides: FLOAT, R0: FLOAT) -> VEC3 {
    let n = clamp(round(sides), 3.0, 64.0);
    let R = max(R0, 0.0);
    let an = PI / n;
    let a = R * cos(an);                               // to the middle of an edge
    let he = R * sin(an);                              // half an edge
    let k = round((atan2(q.y, q.x) + 0.5 * PI) / (2.0 * an));
    let phi = -0.5 * PI + 2.0 * an * k;
    let nk = VEC2(cos(phi), sin(phi));                 // that edge's outward normal
    let tk = VEC2(-nk.y, nk.x);
    let u = dot(q, nk);
    let v = dot(q, tk);
    if (u <= a) { return VEC3(nk, u - a); }
    let e = VEC2(u - a, v - clamp(v, -he, he));
    let d = length(e);
    return VEC3(select(nk, (nk * e.x + tk * e.y) / d, d > 1e-12), d);
}
fn Nprism(p: VEC3, sides: FLOAT, radius: FLOAT, height: FLOAT) -> VEC4 {
    return g2Extrude(p, g2RegularPolygon(p.xy, sides, radius), max(0.5 * height, 0.0));
}

/* A TRIANGLE a-b-c, counter-clockwise. Exact both sides: inside, the nearest edge's line (a convex polygon's distance
   inside is its nearest side's); outside, the nearest point on the three edges, and the direction from it. */
fn g2Triangle(q: VEC2, a: VEC2, b: VEC2, c: VEC2) -> VEC3 {
    let e0 = b - a;
    let e1 = c - b;
    let e2 = a - c;
    let n0 = g2Dir(VEC2(e0.y, -e0.x), VEC2(0.0, -1.0));    // each edge's outward normal
    let n1 = g2Dir(VEC2(e1.y, -e1.x), VEC2(1.0, 0.0));
    let n2 = g2Dir(VEC2(e2.y, -e2.x), VEC2(-1.0, 0.0));
    let s0 = dot(q - a, n0);
    let s1 = dot(q - b, n1);
    let s2 = dot(q - c, n2);
    if (s0 <= 0.0 && s1 <= 0.0 && s2 <= 0.0) {
        var g = VEC3(n0, s0);
        if (s1 > g.z) { g = VEC3(n1, s1); }
        if (s2 > g.z) { g = VEC3(n2, s2); }
        return g;
    }
    let w0 = q - a - e0 * clamp(dot(q - a, e0) / max(dot(e0, e0), 1e-30), 0.0, 1.0);
    let w1 = q - b - e1 * clamp(dot(q - b, e1) / max(dot(e1, e1), 1e-30), 0.0, 1.0);
    let w2 = q - c - e2 * clamp(dot(q - c, e2) / max(dot(e2, e2), 1e-30), 0.0, 1.0);
    var w = w0;
    var n = n0;
    if (dot(w1, w1) < dot(w, w)) { w = w1; n = n1; }
    if (dot(w2, w2) < dot(w, w)) { w = w2; n = n2; }
    let d = length(w);
    return VEC3(select(n, w / d, d > 1e-12), d);
}
/* A TRIANGULAR PRISM, any triangle (the library's, 0.77.0): the triangle stands in the xz plane, its base width
   along x on z = -height/2 and its top on z = +height/2, extruded depth along y. apex is where the top is along the
   base, as a fraction of it: 0 over the base's -x end (a right-angle prism, the right angle there), 0.5 over its
   middle (isosceles), 1 over its +x end; beyond 0 to 1 the top leans out past the base (obtuse), still a triangle.
   Centred on the base's middle, the height's and the depth's -- for apex in 0 to 1 the centre of its box. Every
   parameter is live; width and height are taken as their size (abs), never below 1e-6. Exact both sides. */
fn Ntriprism(p: VEC3, width: FLOAT, height: FLOAT, apex: FLOAT, depth: FLOAT) -> VEC4 {
    let w = max(abs(width), 1e-6);
    let h = max(abs(height), 1e-6);
    let g = g2Triangle(p.xz, VEC2(-0.5 * w, -0.5 * h), VEC2(0.5 * w, -0.5 * h), VEC2((apex - 0.5) * w, 0.5 * h));
    let e = g2Extrude(p.xzy, g, max(0.5 * depth, 0.0));    // extruded along y: the extrusion's z is the prism's y
    return VEC4(e.x, e.z, e.y, e.w);
}

/* A CAPPED TORUS: an arc of radius R in the xy plane, angle degrees of it, symmetric about +y, swept by a tube of
   radius r (Quilez's, rewritten round the closest point on the arc: his expanded sqrt(|p|^2 + R^2 - 2Rk) lost
   5e-3 at R = 10 in f32, and went negative under the root). Exact outside; inside exact, or a bound where the tube
   overlaps itself. 360 is a whole ring. */
fn NcappedTorus(p: VEC3, R: FLOAT, r: FLOAT, angle: FLOAT) -> VEC4 {
    let half = clamp(angle, 0.0, 360.0) * (PI / 360.0);
    let sc = VEC2(max(sin(half), 1e-6), cos(half));
    let sx = select(-1.0, 1.0, p.x >= 0.0);
    let q = VEC3(abs(p.x), p.y, p.z);
    // past the arc's end: its end point; within its wedge: the arc's point in the point's direction
    let c = select(R * g2Dir(q.xy, VEC2(0.0, 1.0)), R * sc, sc.y * q.x > sc.x * q.y);
    let v = q - VEC3(c, 0.0);
    let n = safeDir(v, VEC3(0.0, 0.0, 1.0));
    return VEC4(n.x * sx, n.y, n.z, length(v) - r);
}

/* A CHAIN LINK: a ring of radius R in the xy plane, pulled apart along y by span (two half rings and two
   straight lengths), swept by a tube of radius r (Quilez's link). Exact outside; inside a bound when r > R. */
fn Nlink(p: VEC3, span: FLOAT, R: FLOAT, r: FLOAT) -> VEC4 {
    let le = max(0.5 * span, 0.0);
    let qy = select(-1.0, 1.0, p.y >= 0.0) * max(abs(p.y) - le, 0.0);
    return Ntorus(VEC3(p.x, qy, p.z), R, r);
}

/* A DOME: the part of a sphere of radius R above z = 0, height tall (its base on z = 0, so a dome placed on a
   board sits on it). Over R it is more than a hemisphere. Quilez's cut sphere, its centre at c = height - R:
   exact both sides. c is kept below R (at height 2R the axis read the wrong sign). */
fn Ndome(p: VEC3, R0: FLOAT, height: FLOAT) -> VEC4 {
    let R = max(R0, 1e-6);
    let c = clamp(height - R, -R, R * (1.0 - 1e-4));
    let hc = -c;                                       // the cut plane, in the sphere's frame
    let w = sqrt(max(R * R - hc * hc, 0.0));           // the rim's radius
    let q = VEC2(length(p.xy), p.z - c);
    let s = max((hc - R) * q.x * q.x + w * w * (hc + R - 2.0 * q.y), hc * q.x - w * q.y);
    if (s < 0.0) { return g2Revolve(p, g2Circle(q, VEC2(0.0, 0.0), R)); }
    if (q.x < w) { return g2Revolve(p, VEC3(0.0, -1.0, hc - q.y)); }
    return g2Revolve(p, g2Circle(q, VEC2(w, hc), 0.0));
}

/* A TUBE: a hollow cylinder, inner and outer radius, height tall, centred. The 2D box [inner, outer] x
   [-h/2, h/2], revolved: exact both sides. inner <= 0 is a solid cylinder (the box around the axis would have put a
   surface along it); outer is kept above inner. */
fn Ntube(p: VEC3, outer: FLOAT, inner: FLOAT, height: FLOAT) -> VEC4 {
    let q = VEC2(length(p.xy), p.z);
    let hh = max(0.5 * height, 0.0);
    if (inner <= 0.0) { return g2Revolve(p, g2Box(q, VEC2(0.0, 0.0), VEC2(max(outer, 0.0), hh))); }
    let ro = max(outer, inner + 1e-6);
    return g2Revolve(p, g2Box(q, VEC2(0.5 * (inner + ro), 0.0), VEC2(0.5 * (ro - inner), hh)));
}

/* A PARABOLIC REFLECTOR: the mirror z = r^2 / 4f - f -- its FOCUS AT THE ORIGIN, opening to +z, so a light at the
   node's origin is at the focus -- out to radius aperture, its wall wall thick BEHIND the mirror, so the
   reflecting face is the exact paraboloid. The wall is the band 0 <= s <= wall of the signed distance s to the
   parabola (exact on both sides of it: behind a parabola its offsets have no cusps), cut by the cylinder r <=
   aperture. Exact inside; outside a bound near the rim (never too large; measured up to 0.53 short), as Nlens is. */
fn Ndish(p: VEC3, f: FLOAT, aperture: FLOAT, wall: FLOAT) -> VEC4 {
    let fo = max(f, 1e-6);
    let q = VEC2(length(p.xy), p.z + fo);
    let s = g2Parabola(q, 0.25 / fo);
    let band = g2Max(g2Neg(s), g2Offset(s, max(wall, 1e-6)));
    return g2Revolve(p, g2Max(band, VEC3(1.0, 0.0, q.x - max(aperture, 0.0))));
}
/* AN ASPHERIC LENS (the user, 2026-10-04: "can you add an aspheric lens? I'd like to make condenser lens"): two
   even-asphere faces and a round rim, along z and centred, as sdf.js Nlens is. Each face's sag is the standard
       z(r) = c r^2 / (1 + sqrt(1 - (1 + k) c^2 r^2)) + a4 r^4 + a6 r^6 + a8 r^8 + a10 r^10,     c = 1 / R
   measured INTO the lens from its vertex at +-thickness/2: R > 0 is convex, 0 flat, below 0 hollowed; k the conic
   constant (0 a sphere, -1 a paraboloid, below -1 a hyperboloid); a4..a10 in the scene's unit to the power 1 - 2i.
   THE DISTANCE IS A BOUND, BOTH SIDES. A face's height above its surface, s z - t/2 + sag(r), is divided by the
   steepest the surface can be inside the aperture: the conic's slope c r / sqrt(...) grows with r, so its most is at
   the rim, and the polynomial's is under the sum of its terms' sizes there. Each face is then 1-Lipschitz and zero
   on its surface, so never more than the distance on either side; beyond the rim a face is held at the rim's height,
   flat, which keeps both true. The rim is an exact cylinder. The normal is the surface's own: the gradient's
   direction, exactly. Steep faces cost shorter steps (a face of 60 degrees at the rim halves them). A conic too
   small for the aperture -- an ellipse whose square root would go negative inside it -- is held at the edge of its
   existence: finite, still a bound, and visibly not a lens. */
fn asphSag(r: FLOAT, c: FLOAT, k: FLOAT, a: VEC4) -> VEC2 {
    let r2 = r * r;
    let w = 1.0 - (1.0 + k) * c * c * r2;
    let u = sqrt(max(w, 1e-4));
    let poly = r2 * r2 * (a.x + r2 * (a.y + r2 * (a.z + r2 * a.w)));
    let dpoly = r * r2 * (4.0 * a.x + r2 * (6.0 * a.y + r2 * (8.0 * a.z + r2 * 10.0 * a.w)));
    // (sag, its slope): the conic's slope is c r / u where the root is its own, 2 c r / (1 + u) where it is held
    return VEC2(c * r2 / (1.0 + u) + poly, select(2.0 * c * r / (1.0 + u), c * r / u, w >= 1e-4) + dpoly);
}
/* The steepest |slope| a face can have for r up to rho: the conic's at rho, and every term's size there. */
fn asphSlopeMax(rho: FLOAT, c: FLOAT, k: FLOAT, a: VEC4) -> FLOAT {
    let r2 = rho * rho;
    let u = sqrt(max(1.0 - (1.0 + k) * c * c * r2, 1e-4));
    let poly = rho * r2 * (4.0 * abs(a.x) + r2 * (6.0 * abs(a.y) + r2 * (8.0 * abs(a.z) + r2 * 10.0 * abs(a.w))));
    return abs(c) * rho / u + poly;
}
/* One face: s = 1 the +z one, -1 the -z one; l = length(p.xy) and its direction; ht half the thickness. */
fn asphFace(p: VEC3, l: FLOAT, radial: VEC2, rho: FLOAT, ht: FLOAT, R: FLOAT, k: FLOAT, a: VEC4, s: FLOAT) -> VEC4 {
    let c = select(0.0, 1.0 / R, abs(R) > 1e-9);
    let z = asphSag(min(l, rho), c, k, a);
    let m = asphSlopeMax(rho, c, k, a);
    let g = VEC3(radial * select(0.0, z.y, l < rho), s);
    return VEC4(g / length(g), (s * p.z - ht + z.x) / sqrt(1.0 + m * m));
}
fn Nasphere(p: VEC3, D: FLOAT, t: FLOAT, R1: FLOAT, k1: FLOAT, a1: VEC4, R2: FLOAT, k2: FLOAT, a2: VEC4) -> VEC4 {
    let rho = max(0.5 * D, 1e-6);
    let l = length(p.xy);
    let radial = select(VEC2(1.0, 0.0), p.xy / l, l > 1e-12);
    var n = VEC4(radial, 0.0, l - rho);
    let top = asphFace(p, l, radial, rho, 0.5 * t, R1, k1, a1, 1.0);
    if (top.w > n.w) { n = top; }
    let bottom = asphFace(p, l, radial, rho, 0.5 * t, R2, k2, a2, -1.0);
    if (bottom.w > n.w) { n = bottom; }
    return n;
}
/* --- A PROFILE: a closed outline of straight edges and fillet arcs -- a node's profile parameter (builder/
   codegen.js writes one function per profile, a chain of the calls below with its pieces as numbers, from
   profileWGSL in this file's JS). The pieces run counter-clockwise (the compiler turns a clockwise outline
   round), so an edge's outside is on its right. DISTANCE: the nearest piece's, exact. INSIDE: the even-odd rule
   over the edges and each arc's chord, then flipped inside the arc's circular segment (between chord and arc --
   outside the chord polygon at a convex fillet, inside it at a concave one): exact, so the distance is exact on
   both sides. The gradient is the nearest point's direction; on the curve itself, that piece's outward normal.
   An edge marked not a surface (one lying on the axis, when the profile is revolved) still counts for inside. */
struct Prof { v: VEC2, d2: FLOAT, n: VEC2, inside: bool }
fn pfStart() -> Prof { return Prof(VEC2(0.0, 0.0), 3.0e38, VEC2(1.0, 0.0), false); }
/* Whether the ray from q towards +x crosses the edge a-b (half-open in y, so a vertex is counted once). */
fn pfCross(q: VEC2, a: VEC2, b: VEC2) -> bool {
    return (a.y > q.y) != (b.y > q.y) && q.x < a.x + (q.y - a.y) * (b.x - a.x) / (b.y - a.y);
}
fn pfSegment(A: Prof, q: VEC2, a: VEC2, b: VEC2, surface: bool) -> Prof {
    var R = A;
    if (pfCross(q, a, b)) { R.inside = !R.inside; }
    if (!surface) { return R; }
    let ab = b - a;
    let t = clamp(dot(q - a, ab) / max(dot(ab, ab), 1e-30), 0.0, 1.0);
    let v = q - (a + ab * t);
    let d2 = dot(v, v);
    if (d2 < R.d2) { R.v = v; R.d2 = d2; R.n = g2Dir(VEC2(ab.y, -ab.x), VEC2(1.0, 0.0)); }
    return R;
}
/* A fillet: the minor arc from a to b around c, radius r. convex: the shape is on c's side of it. */
fn pfArc(A: Prof, q: VEC2, c: VEC2, r: FLOAT, a: VEC2, b: VEC2, convex: bool) -> Prof {
    var R = A;
    let w = q - c;
    let m = 0.5 * (a + b) - c;                    // from the centre to the chord's middle: the arc lies beyond it
    if (pfCross(q, a, b) != (dot(w, w) < r * r && dot(w, m) > dot(m, m))) { R.inside = !R.inside; }
    let ea = a - c;
    let eb = b - c;
    let s = select(-1.0, 1.0, ea.x * eb.y - ea.y * eb.x >= 0.0);
    let wedge = s * (ea.x * w.y - ea.y * w.x) >= 0.0 && s * (w.x * eb.y - w.y * eb.x) >= 0.0;
    let ends = select(b, a, dot(q - a, q - a) <= dot(q - b, q - b));
    let p = select(ends, c + g2Dir(w, g2Dir(m, VEC2(1.0, 0.0))) * r, wedge);
    let v = q - p;
    let d2 = dot(v, v);
    if (d2 < R.d2) { R.v = v; R.d2 = d2; R.n = g2Dir(p - c, VEC2(1.0, 0.0)) * select(-1.0, 1.0, convex); }
    return R;
}
fn pfEnd(A: Prof) -> VEC3 {
    let d = sqrt(A.d2);
    let s = select(1.0, -1.0, A.inside);
    return VEC3(select(A.n, A.v * (s / max(d, 1e-30)), d > 1e-12), s * d);
}
/* A 2D result extruded along z, h either side of z = 0 (Quilez's extrusion: exact when the 2D one is). */
fn g2Extrude(p: VEC3, g: VEC3, h: FLOAT) -> VEC4 {
    let wz = abs(p.z) - h;
    let sz = select(-1.0, 1.0, p.z >= 0.0);
    if (g.z > 0.0 && wz > 0.0) {
        let l = length(VEC2(g.z, wz));
        return VEC4(g.xy * (g.z / l), sz * wz / l, l);
    }
    if (g.z > wz) { return VEC4(g.xy, 0.0, g.z); }
    return VEC4(0.0, 0.0, sz, wz);
}
/* --- A PATH (roadmap/BUILDER.md §6 phase 4): an open line of points in 3D -- straight segments, and at a corner a BEND:
   the arc of its fillet, tangent to both edges in their plane, or with no fillet a fan about the corner itself. A
   cross-section (a profile, or a circle for a tube) is carried along it in a frame by parallel transport: constant
   along a segment, turned about the bend's axis round a bend, so at a bend it is N = a.radial + b.axis, B = c.radial
   + d.axis with constant a, b, c, d (the compiler's f). builder/codegen.js writes, per path, a straight chain of the
   calls below with its pieces as numbers (pathWGSL in this file's JS).
     THE ROUNDED TUBE: one closest point on the whole path, |p - c| - r -- exact outside; inside a bound where a fillet
   is tighter than r. (With a scale per point, round cones instead: below, PER POINT.)
     THE SWEEP, and the flat tube: PER PIECE. Each segment is the cross-section extruded along it, each bend the
   cross-section turned about the bend's axis over its angle, both with flat ends; outside, the nearest of them is the
   distance -- exact, at any bend however tight (the planning measurement: to 9e-15, sharp corners included; a scale
   factor on one closest point's distance could not be made safe, it jumps). Inside, the plain nearest would put a
   face at every joint, where two pieces' ends meet inside the solid -- and the march takes a distance near zero for a
   hit -- so inside is the distance to the pieces' sides and the path's two end faces, the joints left out -- save
   where the cross-section reaches past a bend's axis, where part of a joint's face can be the surface (swBendEnds):
   never too deep (exact where the cross-sections do not overlap themselves). A piece whose centreline is farther
   than the cross-section reaches (e) beyond what the others already gave is skipped. --- */
struct PathNear { c: VEC3, d2: FLOAT, n: VEC3 }
/* A live path's slot as its loop reads it (pathWGSL, slotted): its piece's numbers (m: a segment's (a, L) (T, on)
   (N, first) (B, last), a bend's (c, R) (k, on) (u0, -) (u1, -)), a bend's frame (f), its values (v: a segment's va
   and vb, a bend's v) -- builder/codegen.js lays the uniforms out so. */
struct PathSlot { m: mat4x4<f32>, f: vec4<f32>, v: mat2x4<f32> }
fn pnStart() -> PathNear { return PathNear(VEC3(0.0, 0.0, 0.0), 3.0e38, VEC3(0.0, 0.0, 1.0)); }
fn pnSegment(A: PathNear, p: VEC3, a: VEC3, T: VEC3, L: FLOAT, N: VEC3) -> PathNear {
    let c = a + T * clamp(dot(p - a, T), 0.0, L);
    var R = A;
    if (dot(p - c, p - c) < R.d2) { R.c = c; R.d2 = dot(p - c, p - c); R.n = N; }
    return R;
}
/* Is rad (unit, perpendicular to k) within the bend's angle, from u0 round k to u1 (less than a half turn)? */
fn pnWedge(rad: VEC3, k: VEC3, u0: VEC3, u1: VEC3) -> bool {
    return dot(cross(u0, rad), k) >= 0.0 && dot(cross(rad, u1), k) >= 0.0;
}
fn pnBend(A: PathNear, p: VEC3, c0: VEC3, k: VEC3, R0: FLOAT, u0: VEC3, u1: VEC3) -> PathNear {
    let v = p - c0;
    let rad = safeDir(v - k * dot(v, k), u0);
    let e0 = c0 + u0 * R0;
    let e1 = c0 + u1 * R0;
    let c = select(select(e1, e0, dot(p - e0, p - e0) <= dot(p - e1, p - e1)), c0 + rad * R0, pnWedge(rad, k, u0, u1));
    var R = A;
    if (dot(p - c, p - c) < R.d2) { R.c = c; R.d2 = dot(p - c, p - c); R.n = rad; }
    return R;
}

/* The sweep's running result: out, the nearest piece's signed distance (exact outside) and its gradient; depth, the
   nearest side or end face, and the vector from p to it. */
struct Sw { out: FLOAT, gout: VEC3, depth: FLOAT, gin: VEC3 }
fn swStart() -> Sw { return Sw(3.0e38, VEC3(0.0, 0.0, 1.0), 3.0e38, VEC3(0.0, 0.0, 1.0)); }
/* A piece within reach e of a centreline cl away can give nothing nearer than cl - e: skipped if that is no better. */
fn swSkip(S: Sw, cl: FLOAT, e: FLOAT) -> bool { return cl - e >= S.out && cl - e >= S.depth; }
/* From p to a planar region (the cross-section's inside: g its 2D distance at p's foot, h p's height off the plane
   along n): xyz the vector to the nearest point, w the distance. */
fn swRegion(g: VEC3, h: FLOAT, n: VEC3, N: VEC3, B: VEC3) -> VEC4 {
    let gz = max(g.z, 0.0);
    return VEC4((N * g.x + B * g.y) * (-gz) - n * h, length(VEC2(gz, h)));
}
/* ...and to its outline, the curve: a side's edge. */
fn swCurve(g: VEC3, h: FLOAT, n: VEC3, N: VEC3, B: VEC3) -> VEC4 {
    return VEC4((N * g.x + B * g.y) * (-g.z) - n * h, length(VEC2(g.z, h)));
}
struct SwSeg { q: VEC2, s: FLOAT, cl: FLOAT }
fn swSegLocal(p: VEC3, a: VEC3, T: VEC3, N: VEC3, B: VEC3, L: FLOAT) -> SwSeg {
    let v = p - a;
    let s = dot(v, T);
    return SwSeg(VEC2(dot(v, N), dot(v, B)), s, length(v - T * clamp(s, 0.0, L)));
}
fn swSegFold(S: Sw, l: SwSeg, g: VEC3, T: VEC3, N: VEC3, B: VEC3, L: FLOAT, first: bool, last: bool) -> Sw {
    var R = S;
    let x = g2Extrude(VEC3(l.q, l.s - 0.5 * L), g, 0.5 * L);          // the piece, its flat ends at 0 and L
    if (x.w < R.out) { R.out = x.w; R.gout = N * x.x + B * x.y + T * x.z; }
    let side = swCurve(g, l.s - clamp(l.s, 0.0, L), T, N, B);          // its side: the outline along 0..L
    if (side.w < R.depth) { R.depth = side.w; R.gin = side.xyz; }
    if (first) {
        let f = swRegion(g, l.s, T, N, B);                              // the path's start face
        if (f.w < R.depth) { R.depth = f.w; R.gin = f.xyz; }
    }
    if (last) {
        let f = swRegion(g, l.s - L, T, N, B);                          // the path's end face
        if (f.w < R.depth) { R.depth = f.w; R.gin = f.xyz; }
    }
    return R;
}
/* A bend's view of p: whether p's half-plane about the axis is within the bend (inW), or the opposite one is (opW: a
   cross-section reaching past the axis lies there too); the cross-section coordinates in each; and at each end, p's
   coordinates in that end's plane and its height off it. */
struct SwBend { inW: bool, opW: bool, rad: VEC3, q: VEC2, qo: VEC2, q0: VEC2, h0: FLOAT, q1: VEC2, h1: FLOAT, cl: FLOAT }
fn swBendLocal(p: VEC3, c: VEC3, k: VEC3, R0: FLOAT, u0: VEC3, u1: VEC3, f: VEC4) -> SwBend {
    let v = p - c;
    let h = dot(v, k);
    let w = v - k * h;
    let rho = length(w);
    let rad = safeDir(w, u0);
    let inW = pnWedge(rad, k, u0, u1);
    let opW = pnWedge(-rad, k, u0, u1);
    let a = rho - R0;
    let ao = -rho - R0;
    let o0 = v - u0 * R0;
    let o1 = v - u1 * R0;
    let T0 = cross(k, u0);
    let T1 = cross(k, u1);
    let cl = select(min(length(o0), length(o1)), length(VEC2(a, h)), inW);
    return SwBend(inW, opW, rad, VEC2(a * f.x + h * f.y, a * f.z + h * f.w), VEC2(ao * f.x + h * f.y, ao * f.z + h * f.w),
                  VEC2(dot(o0, u0 * f.x + k * f.y), dot(o0, u0 * f.z + k * f.w)), dot(o0, T0),
                  VEC2(dot(o1, u1 * f.x + k * f.y), dot(o1, u1 * f.z + k * f.w)), dot(o1, T1), cl);
}
/* The cross-section in the half-plane of rad (rad itself, or the opposite one), g its 2D distance there. (Its
   gradient made unit for out: swEnd falls back on it inside, and a section scaled differently in x and y has one
   shorter than 1, swRescale.) */
fn swBendSide(S: Sw, g: VEC3, rad: VEC3, k: VEC3, f: VEC4) -> Sw {
    var R = S;
    let N = rad * f.x + k * f.y;
    let B = rad * f.z + k * f.w;
    if (g.z < R.out) { R.out = g.z; R.gout = safeDir(N * g.x + B * g.y, N); }
    if (abs(g.z) < R.depth) { R.depth = abs(g.z); R.gin = select(N * g.x + B * g.y, (N * g.x + B * g.y) * (-g.z), abs(g.z) > 1e-12); }
    return R;
}
/* Its two ends: the end faces, for p outside the bend (or anywhere, when the cross-section reaches past the axis),
   and their outlines as edges of its side. And when the cross-section reaches past the axis (show: e > R), each end
   FACE as a depth too: the part of the section past the axis is not carried on round the bend -- it turns the other
   way, into the opposite half-plane -- so there the face between the bend and its segment can be the surface, and a
   depth that does not count it is too deep. Nothing covered it before 2026-10-02: a sharp corner (a fan, R 0) swept
   with an off-centre section (the asymmetric L) stepped 40 times the step across the face, MEASURED in node on the
   code then shipped -- shapes.test's random directions had not crossed it. With e <= R every point of the face is
   carried on, so the depth there stays exact (shapes.test: "inside exact, no face left at a joint"). */
fn swBendEnds(S: Sw, b: SwBend, g0: VEC3, g1: VEC3, k: VEC3, u0: VEC3, u1: VEC3, f: VEC4, show: bool) -> Sw {
    var R = S;
    let r0 = swRegion(g0, b.h0, cross(k, u0), u0 * f.x + k * f.y, u0 * f.z + k * f.w);
    let r1 = swRegion(g1, b.h1, cross(k, u1), u1 * f.x + k * f.y, u1 * f.z + k * f.w);
    if (r0.w < R.out) { R.out = r0.w; R.gout = safeDir(-r0.xyz, cross(k, u0) * -1.0); }
    if (r1.w < R.out) { R.out = r1.w; R.gout = safeDir(-r1.xyz, cross(k, u1)); }
    if (show && r0.w < R.depth) { R.depth = r0.w; R.gin = r0.xyz; }
    if (show && r1.w < R.depth) { R.depth = r1.w; R.gin = r1.xyz; }
    let c0 = swCurve(g0, b.h0, cross(k, u0), u0 * f.x + k * f.y, u0 * f.z + k * f.w);
    let c1 = swCurve(g1, b.h1, cross(k, u1), u1 * f.x + k * f.y, u1 * f.z + k * f.w);
    if (c0.w < R.depth) { R.depth = c0.w; R.gin = c0.xyz; }
    if (c1.w < R.depth) { R.depth = c1.w; R.gin = c1.xyz; }
    return R;
}
fn swEnd(S: Sw) -> VEC4 {
    if (S.out >= 0.0) { return VEC4(safeDir(S.gout, VEC3(0.0, 0.0, 1.0)), S.out); }
    return VEC4(safeDir(S.gin, S.gout), -S.depth);
}

/* --- PER POINT, THE CROSS-SECTION'S SCALE AND TWIST (2026-10-02; core/shapes.js pathPieces). A point's values v =
   (sx, sy, twist in radians): the section there is the path's own, turned by the twist and scaled, M = R(twist)
   diag(sx, sy) in the frame (N, B). A segment changes them linearly from its first point's to its second's; a bend
   holds its corner's. A TUBE reads sx alone (round: the user's choice), so its values are (sx, sx, 0) -- swRound.
     THE ROUNDED TUBE: the union of a ROUND CONE per segment (its two ends' balls and the cone touching both, Quilez's
   round cone, as NroundCone) and a torus arc per bend -- each exact both sides, so their union is exact outside and
   never too deep inside, the guarantee the tube with one radius has. One closest point on the whole path (pnSegment,
   pnBend) cannot do it: with a radius that changes, the nearest surface point is not radial from the nearest point
   of the line.
     THE SWEEP AND THE FLAT TUBE: per piece, as without values. A bend holds its values: its section, scaled and turned
   by the constant M, is min(sx, sy) g(M^-1 q) -- exact when sx = sy (a similarity), a bound otherwise (never too large:
   g(M^-1 q) changes no faster than 1/min(sx, sy)), and floored as a segment is (swRescale says why). A path whose
   values are all the default is written without any of this (pathWGSL), as before.
     A segment's section CHANGES along it, and min(sx, sy) g(M^-1 q) at its own s changes faster than distance does:
   the section turning under a point rho from the line moves it k.rho per unit of length, and a scale changing moves
   it by its rate times rho over the smallest scale. So the segment's value is divided by
     lip = sqrt(1 + (k.rho)^2 + c^2) * (1 + c),   c = (scale rate) * rho / smin,   rho = max(|q|, e * smax)
   (k the twist rate, e the unscaled section's reach). MEASURED in doubles (node, 2026-10-02, a rectangle section,
   200 000 points a case): without it the slope reached 1.34 (x scale 1 to 2) and 3.88 (a full turn over half a unit),
   and with it no case exceeded 1.000. A first form with e * smax for rho in c, the reach alone, held near the section
   and failed far from it (1.53, a profile scaled in x only along a path): only a uniform scale keeps the change of
   g bounded by the reach. Far from the section that divides by a lot, so the value is also never less than
   |q| - e * smax -- the whole piece lies within that cylinder, so that is no more than the distance either -- which
   keeps the far field as fast as before and keeps the skipping honest (a piece is skipped when |q| - e.smax is no
   better than what the others gave; with values smaller than that, skipping it was a jump). It is a BOUND both sides
   then -- the surface where it should be, the distance short of the true one -- so the march takes shorter steps near
   a steep taper or twist (inferred, not measured on a GPU; the twist modifier does the same, builder/modifiers.js).
   Its gradient, for the normal, is the slice's in full, the section's motion along s included.
     shapes.test MEASURES it (2026-10-02) over three paths (an L, an S in 3D, a sharp corner), four sets of values (a
   taper, scale x alone, a twist, all three at once) and three sections (a tube, a rounded rectangle, an off-centre L):
   no slope over 1 on random pairs, along lines and across every joint face; never too large outside, never too deep
   inside, against the slices themselves; the surface where they are; the normal its gradient. The divisor's cost
   there: the distance at least 0.068 of the true one, at worst (all three at once, the off-centre L). And that it is
   needed: one segment's slice alone has a slope of 1.79 under a whole turn along half a unit, 1.25 under scale x
   going 1 to 2 along one. --- */
fn swRound(v: VEC3, asTube: bool) -> VEC3 { return select(v, VEC3(v.x, v.x, 0.0), asTube); }
/* A point of the section plane, q, in the unscaled section's own coordinates: M^-1 q. */
fn swUnscale(q: VEC2, v: VEC3) -> VEC2 {
    let c = cos(v.z);
    let s = sin(v.z);
    return VEC2(c * q.x + s * q.y, -s * q.x + c * q.y) / v.xy;
}
/* The unscaled section's 2D result g at M^-1 q, as the scaled section's at q: min(sx, sy) times its distance, and
   its gradient carried back, min(sx, sy) M^-T -- NOT made unit: a bend's end faces weigh it against the distance
   along (swRegion, swCurve), and with sx and sy different it is shorter than 1, so a unit one there is not the
   gradient. (With sx = sy it is unit anyway.) And never less than |q| - e.max(sx, sy), e the unscaled section's
   reach, as a segment's (swSegFoldV): with sx and sy different, min(sx, sy) g falls below it far from the section,
   and the skipping takes that floor as given -- MEASURED 2026-10-02, without it a bend skipped was a jump of 60 times
   the step (a rounded rectangle 0.3 by 0.16, scales 0.4 and 0.7). The whole section lies within that circle, so the
   floor is no more than the distance outside, and inside it is no deeper either; with sx = sy it never wins. */
fn swRescale(g: VEC3, v: VEC3, q: VEC2, e: FLOAT) -> VEC3 {
    let m = min(v.x, v.y);
    let gs = g.xy / v.xy * m;
    let c = cos(v.z);
    let s = sin(v.z);
    let cyl = length(q) - e * max(v.x, v.y);
    if (cyl > m * g.z) { return VEC3(g2Dir(q, VEC2(1.0, 0.0)), cyl); }
    return VEC3(c * gs.x - s * gs.y, s * gs.x + c * gs.y, m * g.z);
}
/* The rounded tube's running result: the nearest piece's signed distance and its gradient. */
struct PathD { n: VEC3, d: FLOAT }
fn pdStart() -> PathD { return PathD(VEC3(0.0, 0.0, 1.0), 3.0e38); }
/* A segment from a, along T, L long, radius ra at its start and rb at its end: a round cone, exact both sides. */
fn pdCone(A: PathD, p: VEC3, a: VEC3, T: VEC3, L: FLOAT, ra: FLOAT, rb: FLOAT, N: VEC3) -> PathD {
    let w = p - a;
    let z = dot(w, T);
    let rv = w - T * z;
    let q = VEC2(length(rv), z);
    let rad = safeDir(rv, N);
    var g: VEC3;
    if (L <= abs(ra - rb)) {
        g = select(g2Circle(q, VEC2(0.0, L), rb), g2Circle(q, VEC2(0.0, 0.0), ra), ra >= rb);
    } else {
        let b = (ra - rb) / L;
        let a2 = sqrt(1.0 - b * b);
        let k = dot(q, VEC2(-b, a2));
        if (k < 0.0) { g = g2Circle(q, VEC2(0.0, 0.0), ra); }
        else if (k > a2 * L) { g = g2Circle(q, VEC2(0.0, L), rb); }
        else { g = VEC3(a2, b, dot(q, VEC2(a2, b)) - ra); }
    }
    var R = A;
    if (g.z < R.d) { R.d = g.z; R.n = rad * g.x + T * g.y; }
    return R;
}
/* A bend of the rounded tube: its arc (or the corner, a fan), the ball of radius r swept along it. */
fn pdBend(A: PathD, p: VEC3, c0: VEC3, k: VEC3, R0: FLOAT, u0: VEC3, u1: VEC3, r: FLOAT) -> PathD {
    let v = p - c0;
    let rad = safeDir(v - k * dot(v, k), u0);
    let e0 = c0 + u0 * R0;
    let e1 = c0 + u1 * R0;
    let c = select(select(e1, e0, dot(p - e0, p - e0) <= dot(p - e1, p - e1)), c0 + rad * R0, pnWedge(rad, k, u0, u1));
    let d = length(p - c) - r;
    var R = A;
    if (d < R.d) { R.d = d; R.n = safeDir(p - c, rad); }
    return R;
}
fn pdEnd(A: PathD) -> VEC4 { return VEC4(safeDir(A.n, VEC3(0.0, 0.0, 1.0)), A.d); }
/* A segment's view of p with values va at its start and vb at its end: the section's coordinates in the unscaled
   section's frame (q), how far along (s), from the centreline (cl), the values at p's s (v) and their rates along it
   (dv; nothing beyond its ends, where the end's section runs on unchanged), p in the turned frame (u), the slope
   bound (lip), the largest scale (smax, for the skipping's reach), p in the section plane unturned (qp), the floor
   |q| - e.smax (cyl), and how lip changes across the section plane (dl: its rate along |q| over lip |q|, nothing
   while rho is e.smax). */
struct SwSegV { q: VEC2, s: FLOAT, cl: FLOAT, v: VEC3, dv: VEC3, u: VEC2, lip: FLOAT, smax: FLOAT, qp: VEC2, cyl: FLOAT, dl: FLOAT }
fn swSegLocalV(p: VEC3, a: VEC3, T: VEC3, N: VEC3, B: VEC3, L: FLOAT, va0: VEC3, vb0: VEC3, asTube: bool, e: FLOAT) -> SwSegV {
    let w = p - a;
    let s = dot(w, T);
    let q = VEC2(dot(w, N), dot(w, B));
    let va = swRound(va0, asTube);
    let vb = swRound(vb0, asTube);
    let iL = 1.0 / max(L, 1e-9);
    let v = mix(va, vb, clamp(s * iL, 0.0, 1.0));
    let dv = select(VEC3(0.0, 0.0, 0.0), (vb - va) * iL, s > 0.0 && s < L);
    let c = cos(v.z);
    let sn = sin(v.z);
    let u = VEC2(c * q.x + sn * q.y, -sn * q.x + c * q.y);
    let smax = max(max(va.x, va.y), max(vb.x, vb.y));
    let smin = min(min(va.x, va.y), min(vb.x, vb.y));
    let k = abs(vb.z - va.z) * iL;
    let lq = length(q);
    let rho = max(lq, e * smax);
    let cr = max(abs(vb.x - va.x), abs(vb.y - va.y)) * iL / max(smin, 1e-9);
    let cc = cr * rho;
    let sq = sqrt(1.0 + k * k * rho * rho + cc * cc);
    let lip = sq * (1.0 + cc);
    let dlip = (k * k * rho + cc * cr) / sq * (1.0 + cc) + sq * cr;
    return SwSegV(u / v.xy, s, length(w - T * clamp(s, 0.0, L)), v, dv, u, lip, smax, q, lq - e * smax,
                  select(0.0, dlip / (lip * lq), lq > e * smax));
}
/* The segment, g the unscaled section's 2D result at l.q: its slice min(sx, sy) g, divided by lip, between flat ends
   at 0 and L. Its gradient, in full and of its own length (the corners below weigh it against the distance along):
   the slice's in the section plane, min(sx, sy) M^-T g's; along T the slice's own rate -- the smaller scale's rate
   times g, and the section moving under p (dq/ds = -(D'/D) q - k (J u) / D); all over lip, less what lip itself
   changes across the plane once |q| is past the reach. (Without the last two, MEASURED 2026-10-02: the normal was
   off its gradient by up to 0.8 rad, 0.39 within 0.02 of the surface.) Inside, a side's depth and, for the path's
   ends, the distance to the DISC the end face lies in (radius e.smax about the path): never more than to the face
   itself -- whose section is not the slice's at p's s, so it is not to hand -- and, unlike the face's plane, far
   wherever the path passes that plane far from the face. */
fn swSegFoldV(S: Sw, l: SwSegV, g: VEC3, T: VEC3, N: VEC3, B: VEC3, L: FLOAT, first: bool, last: bool) -> Sw {
    let m = min(l.v.x, l.v.y);
    let gs = g.xy / l.v.xy * m;
    let c = cos(l.v.z);
    let sn = sin(l.v.z);
    let gq = VEC2(c * gs.x - sn * gs.y, sn * gs.x + c * gs.y);
    let dm = select(l.dv.y, l.dv.x, l.v.x <= l.v.y);
    let dq = -(l.dv.xy / l.v.xy) * l.q - l.dv.z * VEC2(-l.u.y, l.u.x) / l.v.xy;
    let fs = dm * g.z + m * dot(g.xy, dq);
    let fl = m * g.z / l.lip;
    let fd = max(fl, l.cyl);
    let G = (N * gq.x + B * gq.y + T * fs - (N * l.qp.x + B * l.qp.y) * (m * g.z * l.dl)) / l.lip;
    let nf = select(G, safeDir(N * l.qp.x + B * l.qp.y, N), l.cyl > fl);
    let wz = abs(l.s - 0.5 * L) - 0.5 * L;
    let sz = select(-1.0, 1.0, l.s >= 0.5 * L);
    var R = S;
    var out = wz;
    var gout = T * sz;
    if (fd > 0.0 && wz > 0.0) { out = length(VEC2(fd, wz)); gout = nf * fd + T * (sz * wz); }
    else if (fd > wz) { out = fd; gout = nf; }
    if (out < R.out) { R.out = out; R.gout = safeDir(gout, T); }        // unit: swEnd falls back on it inside
    let h = l.s - clamp(l.s, 0.0, L);
    let side = length(VEC2(fd, h));
    if (side < R.depth) { R.depth = side; R.gin = nf * (-fd) - T * h; }
    let cy = max(l.cyl, 0.0);
    let off = (N * l.qp.x + B * l.qp.y) * (-cy / max(length(l.qp), 1e-12));
    if (first && length(VEC2(cy, l.s)) < R.depth) { R.depth = length(VEC2(cy, l.s)); R.gin = off - T * l.s; }
    if (last && length(VEC2(cy, l.s - L)) < R.depth) { R.depth = length(VEC2(cy, l.s - L)); R.gin = off - T * (l.s - L); }
    return R;
}
`

//======================================================================================================================
// THE JS MIRROR -- for test/shapes.test.mjs only. Same names, same arithmetic (in doubles); vectors are arrays.
//======================================================================================================================
const PI = Math.PI
const clamp = (x, a, b) => Math.min(Math.max(x, a), b)
const sel = (f, t, c) => c ? t : f                                       // WGSL select(f, t, c)
const len = v => Math.hypot(...v)
const dot = (a, b) => a.reduce((s, x, k) => s + x * b[k], 0)
const sub = (a, b) => a.map((x, k) => x - b[k])
const add = (a, b) => a.map((x, k) => x + b[k])
const scl = (a, s) => a.map(x => x * s)
const sgn = x => x >= 0 ? 1 : -1                                          // select(-1, 1, x >= 0)
export function safeDir(v, fallback) { const l = len(v); return l > 1e-12 ? scl(v, 1 / l) : fallback }

export function g2Dir(v, fallback) { const l = len(v); return l > 1e-12 ? scl(v, 1 / l) : fallback }
export function g2Circle(q, c, r) { const e = sub(q, c); return [...g2Dir(e, [1, 0]), len(e) - r] }
export function g2Box(q, c, b) {
    const s = [sgn(q[0] - c[0]), sgn(q[1] - c[1])]
    const e = [Math.abs(q[0] - c[0]) - b[0], Math.abs(q[1] - c[1]) - b[1]]
    if (e[0] > 0 || e[1] > 0) {
        const o = [Math.max(e[0], 0), Math.max(e[1], 0)], l = len(o)
        return [o[0] / l * s[0], o[1] / l * s[1], l]
    }
    if (e[0] > e[1]) return [s[0], 0, e[0]]
    return [0, s[1], e[1]]
}
export function g2Parabola(q, k) {
    const sx = sgn(q[0]), xa = Math.abs(q[0])
    const ik = 1 / k
    const a = ik * (q[1] - 0.5 * ik) / 3
    const b = 0.25 * ik * ik * xa
    const h = b * b - a * a * a
    let x
    if (h > 0) {
        const u = Math.pow(b + Math.sqrt(h), 1 / 3)
        const w = a / u
        x = 2 * b / (u * u - a + w * w)
    } else {
        x = 2 * Math.sqrt(Math.max(a, 0)) * Math.cos(Math.atan2(Math.sqrt(-h), b) / 3)
    }
    const e = [xa - x, q[1] - k * x * x]
    const side = k * xa * xa - q[1] >= 0 ? 1 : -1
    const m = Math.sqrt(1 + 4 * k * k * x * x)
    return [2 * k * x / m * sx, -1 / m, side * len(e)]
}
export const g2Max = (a, b) => a[2] >= b[2] ? a : b
export const g2Neg = a => a.map(x => -x)
export const g2Offset = (a, t) => [a[0], a[1], a[2] - t]
export function g2Revolve(p, g) {
    const l = Math.hypot(p[0], p[1])
    const radial = l > 1e-12 ? [p[0] / l, p[1] / l] : [1, 0]
    return [radial[0] * g[0], radial[1] * g[0], g[1], g[2]]
}

/** sdf.js's Ntorus, which Nlink calls */
export function Ntorus(p, R, r) {
    const lxy = Math.hypot(p[0], p[1])
    const radial = lxy > 1e-12 ? [p[0] / lxy, p[1] / lxy] : [1, 0]
    const q = [lxy - R, p[2]]
    const n = safeDir([radial[0] * q[0], radial[1] * q[0], q[1]], [0, 0, 1])
    return [...n, len(q) - r]
}

export function NroundCone(p, r1, r2, h) {
    const q = [Math.hypot(p[0], p[1]), p[2] + 0.5 * h]
    if (h <= Math.abs(r1 - r2)) {
        if (r1 >= r2) return g2Revolve(p, g2Circle(q, [0, 0], r1))
        return g2Revolve(p, g2Circle(q, [0, h], r2))
    }
    const b = (r1 - r2) / h
    const a = Math.sqrt(1 - b * b)
    const k = dot(q, [-b, a])
    if (k < 0) return g2Revolve(p, g2Circle(q, [0, 0], r1))
    if (k > a * h) return g2Revolve(p, g2Circle(q, [0, h], r2))
    return g2Revolve(p, [a, b, dot(q, [a, b]) - r1])
}

export function Noctahedron(p, s0) {
    const s = Math.max(s0, 0)
    const sg = p.map(sgn)
    const a = p.map(Math.abs)
    const m = a[0] + a[1] + a[2] - s
    const face = scl(sg, 0.5773502691896258)
    const out = (u, v) => [...safeDir(u, face.map((x, k) => x * sg[k])).map((x, k) => x * sg[k]), len(v)]
    if (3 * a[0] < m) {
        const k = clamp(0.5 * (a[2] - a[1] + s), 0, s)
        const v = [a[0], a[1] - s + k, a[2] - k]
        return out(v, v)
    }
    if (3 * a[1] < m) {
        const k = clamp(0.5 * (a[0] - a[2] + s), 0, s)
        const v = [a[1], a[2] - s + k, a[0] - k]
        return out([v[2], v[0], v[1]], v)
    }
    if (3 * a[2] < m) {
        const k = clamp(0.5 * (a[1] - a[0] + s), 0, s)
        const v = [a[2], a[0] - s + k, a[1] - k]
        return out([v[1], v[2], v[0]], v)
    }
    return [...face, m * 0.5773502691896258]
}

export function Npyramid(p, base, height) {
    const b = Math.max(0.5 * base, 1e-6)
    const h = Math.max(height, 1e-6)
    const L = Math.sqrt(h * h + b * b)
    const sg = [sgn(p[0]), sgn(p[1])]
    const ax = Math.abs(p[0]), ay = Math.abs(p[1])
    const swap = ay > ax
    const P = [Math.max(ax, ay), Math.min(ax, ay), p[2] + 0.5 * h]
    const n = [h / L, 0, b / L], t = [-b / L, 0, h / L]
    const dp = dot(sub(P, [b, 0, 0]), n)
    let g, d
    if (dp <= 0 && P[2] >= 0) {
        if (dp >= -P[2]) { g = n; d = dp } else { g = [0, 0, -1]; d = -P[2] }
    } else {
        const u = P[1]
        const v = dot(sub(P, [b, 0, 0]), t)
        let cu = u, cv = v
        if (v < 0 || u / b + v / L > 1) {
            const e1 = [Math.min(u, b), 0]
            const hy = [-b, L]
            const s1 = clamp(dot([u - b, v], hy) / dot(hy, hy), 0, 1)
            const e2 = [b + hy[0] * s1, hy[1] * s1]
            const d2 = (c) => (u - c[0]) ** 2 + (v - c[1]) ** 2
            const c = (v >= 0 && d2(e2) < d2(e1)) ? e2 : e1
            cu = c[0]; cv = c[1]
        }
        const cf = [b + t[0] * cv, cu, t[2] * cv]
        const cb = [Math.min(P[0], b), Math.min(P[1], b), 0]
        const vf = sub(P, cf), vb = sub(P, cb)
        const lf = len(vf), lb = len(vb)
        if (lf <= lb) { g = safeDir(vf, n); d = lf } else { g = safeDir(vb, [0, 0, -1]); d = lb }
    }
    const gxy = swap ? [g[1], g[0]] : [g[0], g[1]]
    return [gxy[0] * sg[0], gxy[1] * sg[1], g[2], d]
}

export function g2RegularPolygon(q, sides, R0) {
    const n = clamp(Math.round(sides), 3, 64), R = Math.max(R0, 0)
    const an = PI / n, a = R * Math.cos(an), he = R * Math.sin(an)
    const k = Math.round((Math.atan2(q[1], q[0]) + 0.5 * PI) / (2 * an))
    const phi = -0.5 * PI + 2 * an * k
    const nk = [Math.cos(phi), Math.sin(phi)], tk = [-nk[1], nk[0]]
    const u = dot(q, nk), v = dot(q, tk)
    if (u <= a) return [nk[0], nk[1], u - a]
    const e = [u - a, v - clamp(v, -he, he)], d = len(e)
    return d > 1e-12 ? [(nk[0] * e[0] + tk[0] * e[1]) / d, (nk[1] * e[0] + tk[1] * e[1]) / d, d] : [nk[0], nk[1], d]
}
export const Nprism = (p, sides, radius, height) => g2Extrude(p, g2RegularPolygon([p[0], p[1]], sides, radius), Math.max(0.5 * height, 0))

// the triangle and the triangular prism (see their WGSL)
export function g2Triangle(q, a, b, c) {
    const e0 = sub(b, a), e1 = sub(c, b), e2 = sub(a, c)
    const n0 = g2Dir([e0[1], -e0[0]], [0, -1]), n1 = g2Dir([e1[1], -e1[0]], [1, 0]), n2 = g2Dir([e2[1], -e2[0]], [-1, 0])
    const s0 = dot(sub(q, a), n0), s1 = dot(sub(q, b), n1), s2 = dot(sub(q, c), n2)
    if (s0 <= 0 && s1 <= 0 && s2 <= 0) {
        let g = [...n0, s0]
        if (s1 > g[2]) g = [...n1, s1]
        if (s2 > g[2]) g = [...n2, s2]
        return g
    }
    const foot = (o, e) => { const t = clamp(dot(sub(q, o), e) / Math.max(dot(e, e), 1e-30), 0, 1); return sub(sub(q, o), scl(e, t)) }
    const w0 = foot(a, e0), w1 = foot(b, e1), w2 = foot(c, e2)
    let w = w0, n = n0
    if (dot(w1, w1) < dot(w, w)) { w = w1; n = n1 }
    if (dot(w2, w2) < dot(w, w)) { w = w2; n = n2 }
    const d = len(w)
    return d > 1e-12 ? [w[0] / d, w[1] / d, d] : [n[0], n[1], d]
}
export function Ntriprism(p, width, height, apex, depth) {
    const w = Math.max(Math.abs(width), 1e-6), h = Math.max(Math.abs(height), 1e-6)
    const g = g2Triangle([p[0], p[2]], [-0.5 * w, -0.5 * h], [0.5 * w, -0.5 * h], [(apex - 0.5) * w, 0.5 * h])
    const e = g2Extrude([p[0], p[2], p[1]], g, Math.max(0.5 * depth, 0))
    return [e[0], e[2], e[1], e[3]]
}

// the frustum (see its WGSL)
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export function frSeg(P, a, b) {
    const ab = sub(b, a)
    return add(a, scl(ab, clamp(dot(sub(P, a), ab) / Math.max(dot(ab, ab), 1e-30), 0, 1)))
}
export function frQuad(P, a, b, c, d, n) {
    const q = sub(P, scl(n, dot(sub(P, a), n)))
    if (dot(cross3(sub(b, a), sub(q, a)), n) >= 0 && dot(cross3(sub(c, b), sub(q, b)), n) >= 0
        && dot(cross3(sub(d, c), sub(q, c)), n) >= 0 && dot(cross3(sub(a, d), sub(q, d)), n) >= 0) return q
    let best = frSeg(P, a, b)
    for (const e of [frSeg(P, b, c), frSeg(P, c, d), frSeg(P, d, a)]) if (dot(sub(P, e), sub(P, e)) < dot(sub(P, best), sub(P, best))) best = e
    return best
}
export function Nfrustum(p, base, top, height) {
    const b = [Math.abs(base[0]) * 0.5, Math.abs(base[1]) * 0.5], t = [Math.abs(top[0]) * 0.5, Math.abs(top[1]) * 0.5]
    const h = Math.max(height, 1e-6)
    const sg = [sgn(p[0]), sgn(p[1])]
    const P = [Math.abs(p[0]), Math.abs(p[1]), p[2] + 0.5 * h]
    const nx = safeDir([h, 0, b[0] - t[0]], [1, 0, 0]), ny = safeDir([0, h, b[1] - t[1]], [0, 1, 0])
    const dx = dot(sub(P, [b[0], 0, 0]), nx), dy = dot(sub(P, [0, b[1], 0]), ny)
    let g = nx, d = dx
    if (dx <= 0 && dy <= 0 && P[2] >= 0 && P[2] <= h) {
        if (dy > d) { d = dy; g = ny }
        if (P[2] - h > d) { d = P[2] - h; g = [0, 0, 1] }
        if (-P[2] > d) { d = -P[2]; g = [0, 0, -1] }
    } else {
        const cands = [
            [frQuad(P, [b[0], -b[1], 0], [b[0], b[1], 0], [t[0], t[1], h], [t[0], -t[1], h], nx), nx],
            [frQuad(P, [b[0], b[1], 0], [-b[0], b[1], 0], [-t[0], t[1], h], [t[0], t[1], h], ny), ny],
            [[Math.min(P[0], t[0]), Math.min(P[1], t[1]), h], [0, 0, 1]],
            [[Math.min(P[0], b[0]), Math.min(P[1], b[1]), 0], [0, 0, -1]],
        ]
        let [c, fall] = cands[0]
        for (const [k, f] of cands.slice(1)) if (dot(sub(P, k), sub(P, k)) < dot(sub(P, c), sub(P, c))) { c = k; fall = f }
        g = safeDir(sub(P, c), fall)
        d = len(sub(P, c))
    }
    return [g[0] * sg[0], g[1] * sg[1], g[2], d]
}

export function NcappedTorus(p, R, r, angle) {
    const half = clamp(angle, 0, 360) * (PI / 360)
    const sc = [Math.max(Math.sin(half), 1e-6), Math.cos(half)]
    const sx = sgn(p[0])
    const q = [Math.abs(p[0]), p[1], p[2]]
    const c = sel(scl(g2Dir([q[0], q[1]], [0, 1]), R), scl(sc, R), sc[1] * q[0] > sc[0] * q[1])
    const v = [q[0] - c[0], q[1] - c[1], q[2]]
    const n = safeDir(v, [0, 0, 1])
    return [n[0] * sx, n[1], n[2], len(v) - r]
}

export function Nlink(p, span, R, r) {
    const le = Math.max(0.5 * span, 0)
    const qy = sgn(p[1]) * Math.max(Math.abs(p[1]) - le, 0)
    return Ntorus([p[0], qy, p[2]], R, r)
}

export function Ndome(p, R0, height) {
    const R = Math.max(R0, 1e-6)
    const c = clamp(height - R, -R, R * (1 - 1e-4))
    const hc = -c
    const w = Math.sqrt(Math.max(R * R - hc * hc, 0))
    const q = [Math.hypot(p[0], p[1]), p[2] - c]
    const s = Math.max((hc - R) * q[0] * q[0] + w * w * (hc + R - 2 * q[1]), hc * q[0] - w * q[1])
    if (s < 0) return g2Revolve(p, g2Circle(q, [0, 0], R))
    if (q[0] < w) return g2Revolve(p, [0, -1, hc - q[1]])
    return g2Revolve(p, g2Circle(q, [w, hc], 0))
}

export function Ntube(p, outer, inner, height) {
    const q = [Math.hypot(p[0], p[1]), p[2]]
    const hh = Math.max(0.5 * height, 0)
    if (inner <= 0) return g2Revolve(p, g2Box(q, [0, 0], [Math.max(outer, 0), hh]))
    const ro = Math.max(outer, inner + 1e-6)
    return g2Revolve(p, g2Box(q, [0.5 * (inner + ro), 0], [0.5 * (ro - inner), hh]))
}

export function Ndish(p, f, aperture, wall) {
    const fo = Math.max(f, 1e-6)
    const q = [Math.hypot(p[0], p[1]), p[2] + fo]
    const s = g2Parabola(q, 0.25 / fo)
    const band = g2Max(g2Neg(s), g2Offset(s, Math.max(wall, 1e-6)))
    return g2Revolve(p, g2Max(band, [1, 0, q[0] - Math.max(aperture, 0)]))
}

/* the aspheric lens's JS twin, function for function */
export function asphSag(r, c, k, a) {
    const r2 = r * r, w = 1 - (1 + k) * c * c * r2, u = Math.sqrt(Math.max(w, 1e-4))
    const poly = r2 * r2 * (a[0] + r2 * (a[1] + r2 * (a[2] + r2 * a[3])))
    const dpoly = r * r2 * (4 * a[0] + r2 * (6 * a[1] + r2 * (8 * a[2] + r2 * 10 * a[3])))
    return [c * r2 / (1 + u) + poly, (w >= 1e-4 ? c * r / u : 2 * c * r / (1 + u)) + dpoly]
}
export function asphSlopeMax(rho, c, k, a) {
    const r2 = rho * rho, u = Math.sqrt(Math.max(1 - (1 + k) * c * c * r2, 1e-4))
    const poly = rho * r2 * (4 * Math.abs(a[0]) + r2 * (6 * Math.abs(a[1]) + r2 * (8 * Math.abs(a[2]) + r2 * 10 * Math.abs(a[3]))))
    return Math.abs(c) * rho / u + poly
}
export function asphFace(p, l, radial, rho, ht, R, k, a, s) {
    const c = Math.abs(R) > 1e-9 ? 1 / R : 0
    const z = asphSag(Math.min(l, rho), c, k, a), m = asphSlopeMax(rho, c, k, a)
    const sl = l < rho ? z[1] : 0, g = [radial[0] * sl, radial[1] * sl, s], gl = len(g)
    return [g[0] / gl, g[1] / gl, g[2] / gl, (s * p[2] - ht + z[0]) / Math.sqrt(1 + m * m)]
}
export function Nasphere(p, D, t, R1, k1, a1, R2, k2, a2) {
    const rho = Math.max(0.5 * D, 1e-6), l = Math.hypot(p[0], p[1])
    const radial = l > 1e-12 ? [p[0] / l, p[1] / l] : [1, 0]
    let n = [radial[0], radial[1], 0, l - rho]
    const top = asphFace(p, l, radial, rho, 0.5 * t, R1, k1, a1, 1)
    if (top[3] > n[3]) n = top
    const bottom = asphFace(p, l, radial, rho, 0.5 * t, R2, k2, a2, -1)
    if (bottom[3] > n[3]) n = bottom
    return n
}

//----------------------------------------------------------------------------------------------------------------------
// PROFILES (JS): the compiler from points to pieces, which codegen and the model both use, and the twin of the WGSL
//----------------------------------------------------------------------------------------------------------------------
const cross2 = (a, b) => a[0] * b[1] - a[1] * b[0]
const norm2 = v => { const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l] }
/* whether segments a-b and c-d share a point (touching counts) */
function segmentsMeet(a, b, c, d) {
    const o = (p, q, r) => Math.sign(cross2(sub(q, p), sub(r, p)))
    const on = (p, q, r) => Math.min(p[0], q[0]) <= r[0] && r[0] <= Math.max(p[0], q[0]) && Math.min(p[1], q[1]) <= r[1] && r[1] <= Math.max(p[1], q[1])
    const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b)
    if (o1 !== o2 && o3 !== o4) return true
    return (o1 === 0 && on(a, b, c)) || (o2 === 0 && on(a, b, d)) || (o3 === 0 && on(c, d, a)) || (o4 === 0 && on(c, d, b))
}

/**
 * A profile -- [[x, y], [x, y, fillet], ...], a closed outline, the last point joined back to the first -- as the
 * pieces the WGSL walks: { kind: 'segment', a, b, axis } and { kind: 'arc', c, r, a, b, convex }, counter-clockwise.
 * A fillet rounds its point's corner with an arc of that radius tangent to both edges. `axis` marks an edge lying on
 * x = 0, which a revolved profile does not count as a surface (it is the axis it turns about).
 * PROBLEMS, each naming the user's own point numbers (1-based, in the order written): fewer than three points, a
 * point that is not two or three numbers, a negative fillet, two neighbours the same, no area, edges that cross,
 * fillets that do not fit their edges. With any, there are no pieces.
 * @returns {{ pieces: object[], problems: string[] }}
 */
export function profilePieces(points) {
    const problems = []
    if (!Array.isArray(points) || points.length < 3) return { pieces: [], problems: ['a profile needs at least three points'] }
    points.forEach((pt, i) => {
        if (!Array.isArray(pt) || (pt.length !== 2 && pt.length !== 3) || !pt.every(Number.isFinite))
            problems.push(`point ${i + 1}: x, y, and a fillet radius if it has one -- numbers`)
        else if (pt.length === 3 && pt[2] < 0) problems.push(`point ${i + 1}: a fillet radius cannot be negative`)
    })
    if (problems.length) return { pieces: [], problems }
    const n = points.length
    const at = i => (i % n + n) % n
    for (let i = 0; i < n; i++) {
        const a = points[i], b = points[at(i + 1)]
        if (a[0] === b[0] && a[1] === b[1]) problems.push(`points ${i + 1} and ${at(i + 1) + 1} are the same point`)
    }
    if (problems.length) return { pieces: [], problems }
    let area = 0
    for (let i = 0; i < n; i++) area += cross2(points[i], points[at(i + 1)]) / 2
    const size = Math.max(...points.map(p => Math.max(Math.abs(p[0]), Math.abs(p[1]))), 1e-30)
    if (!(Math.abs(area) > 1e-12 * size * size)) return { pieces: [], problems: ['the outline encloses no area'] }
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue                                      // neighbours, through the closing edge
        if (segmentsMeet(points[i], points[at(i + 1)], points[j], points[at(j + 1)]))
            problems.push(`edges ${i + 1}-${at(i + 1) + 1} and ${j + 1}-${at(j + 1) + 1} cross`)
    }
    if (problems.length) return { pieces: [], problems }
    // COUNTER-CLOCKWISE, each point keeping its number for the messages
    const idx = [...Array(n).keys()]
    if (area < 0) idx.reverse()
    const P = idx.map(i => points[i])
    const corner = P.map((p, i) => {
        const r = p[2] ?? 0
        if (!(r > 0)) return null
        const prev = P[at(i - 1)], next = P[at(i + 1)]
        const u = norm2(sub(prev, p)), v = norm2(sub(next, p))
        const ang = Math.acos(Math.min(1, Math.max(-1, dot(u, v))))           // the angle between the two edges
        if (ang > Math.PI - 1e-9) return null                                   // a straight run: nothing to round
        const t = r / Math.tan(ang / 2)
        const bis = norm2([u[0] + v[0], u[1] + v[1]])
        const pp = [p[0], p[1]]
        return { t, r, A: add(pp, scl(u, t)), B: add(pp, scl(v, t)), c: add(pp, scl(bis, r / Math.sin(ang / 2))),
                 convex: cross2(sub(p, prev), sub(next, p)) > 0 }
    })
    for (let i = 0; i < n; i++) {
        const j = at(i + 1), need = (corner[i]?.t ?? 0) + (corner[j]?.t ?? 0)
        const L = Math.hypot(P[j][0] - P[i][0], P[j][1] - P[i][1])
        if (need > L * (1 + 1e-9)) {
            const which = [corner[i] && idx[i] + 1, corner[j] && idx[j] + 1].filter(Boolean).sort((a, b) => a - b)
            problems.push(`the fillet${which.length > 1 ? 's' : ''} at point${which.length > 1 ? 's' : ''} ${which.join(' and ')} need ${+need.toPrecision(4)} of an edge ${+L.toPrecision(4)} long`)
        }
    }
    if (problems.length) return { pieces: [], problems }
    const pieces = []
    for (let i = 0; i < n; i++) {
        const k = corner[i]
        if (k) pieces.push({ kind: 'arc', c: k.c, r: k.r, a: k.A, b: k.B, convex: k.convex })
        const a = k ? k.B : [P[i][0], P[i][1]], j = at(i + 1), b = corner[j] ? corner[j].A : [P[j][0], P[j][1]]
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-12 * size)
            pieces.push({ kind: 'segment', a, b, axis: Math.abs(a[0]) <= 1e-12 * size && Math.abs(b[0]) <= 1e-12 * size })
    }
    return { pieces, problems }
}

/* a number as a WGSL float literal: always a decimal point or an exponent */
const lit = x => { const s = String(x === 0 ? 0 : x); return /[.eE]/.test(s) ? s : s + '.0' }
const v2 = p => `VEC2(${lit(p[0])}, ${lit(p[1])})`
/** A profile piece's numbers as WGSL: what a compiled profile is written with -- `surface` is whether a segment is a
 *  surface (an axis edge is not, when revolved), `convex` an arc's side. */
export const literalProfileOperands = k => k.kind === 'arc'
    ? { c: v2(k.c), r: lit(k.r), a: v2(k.a), b: v2(k.b), convex: `${k.convex}` }
    : { a: v2(k.a), b: v2(k.b), surface: k.axis ? '!axis' : 'true' }
/**
 * The WGSL of one profile: fn <name>(q: VEC2, axis: bool) -> VEC3, a straight chain of pf* calls, one per piece,
 * in order (straight-line code, not a loop over a constant array: nothing here indexes a const array at run time,
 * and only the browser's compiler could say whether that is accepted). `axis` true leaves the axis edges out of the
 * distance, for revolve.
 *   operands(piece) writes each piece's numbers: literals for a compiled profile. `guard`, a WGSL condition, returns
 * nothing when true; no pieces (an outline not sound as compiled) is a function that returns nothing.
 *   SLOTTED (`slots`, a number: a LIVE profile, or one edited in the picture -- builder/codegen.js): the chain is by
 * position -- an arc, then a segment, for each point there is room for (profileSlotsOf) -- so a fillet appearing or
 * going, a point added or taken away within the room, is numbers, not text. A LOOP over the slots, as a live path's
 * (pathWGSL says why, and why its bound goes through noUnroll): each read by its index through <name>_slot(i)
 * (`slot(i)`, the uniform of slot i, a mat2x4), run up to `count`, each kind's call made only while its `on` (an
 * operand) holds. A switch picks the slot, no array.
 */
export function profileWGSL(name, pieces, { operands = literalProfileOperands, guard = null, slots = null, slot = null, count = null } = {}) {
    const FAR = 'VEC3(1.0, 0.0, 1.0e7)'
    const looped = slots != null
    if (!looped && !pieces.length) return `fn ${name}(q: VEC2, axis: bool) -> VEC3 { return ${FAR}; }`
    const call = (kind, o) => kind === 'arc'
        ? `A = pfArc(A, q, ${o.c}, ${o.r}, ${o.a}, ${o.b}, ${o.convex});`
        : `A = pfSegment(A, q, ${o.a}, ${o.b}, ${o.surface});`
    const out = [], lines = [`fn ${name}(q: VEC2, axis: bool) -> VEC3 {`]
    if (guard) lines.push(`    if (${guard}) { return ${FAR}; }`)
    lines.push('    var A = pfStart();')
    if (!looped) for (const k of pieces) lines.push(`    ${call(k.kind, operands(k))}`)
    else {
        // arcs in the even slots, segments in the odd (profileSlotsOf)
        const arc = operands({ kind: 'arc' }), seg = operands({ kind: 'segment' })
        lines.push(`    for (var i = 0u; i < noUnroll(u32(${count})); i = i + 1u) {`, `        let sl = ${name}_slot(i);`,
            '        if ((i & 1u) == 0u) {', `            if (${arc.on}) { ${call('arc', arc)} }`,
            '        } else {', `            if (${seg.on}) { ${call('segment', seg)} }`, '        }', '    }')
        // a slot past the room is never read (the loop stops at it); off either way: an arc's radius -1, a segment's flag 0
        out.push(`fn ${name}_slot(i: u32) -> mat2x4<f32> {`, '    switch i {',
            ...Array.from({ length: slots }, (_, i) => `        case ${i}u: { return ${slot(i)}; }`),
            '        default: { return mat2x4<f32>(vec4<f32>(0.0, 0.0, -1.0, 0.0), vec4<f32>()); }', '    }', '}')
    }
    lines.push('    return pfEnd(A);', '}')
    return [...out, ...lines].join('\n')
}

// the twin of the WGSL above
export const pfStart = () => ({ v: [0, 0], d2: 3.0e38, n: [1, 0], inside: false })
export const pfCross = (q, a, b) => (a[1] > q[1]) !== (b[1] > q[1]) && q[0] < a[0] + (q[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
export function pfSegment(A, q, a, b, surface) {
    const R = { ...A }
    if (pfCross(q, a, b)) R.inside = !R.inside
    if (!surface) return R
    const ab = sub(b, a)
    const t = clamp(dot(sub(q, a), ab) / Math.max(dot(ab, ab), 1e-30), 0, 1)
    const v = sub(q, add(a, scl(ab, t)))
    const d2 = dot(v, v)
    if (d2 < R.d2) { R.v = v; R.d2 = d2; R.n = g2Dir([ab[1], -ab[0]], [1, 0]) }
    return R
}
export function pfArc(A, q, c, r, a, b, convex) {
    const R = { ...A }
    const w = sub(q, c)
    const m = sub(scl(add(a, b), 0.5), c)
    if (pfCross(q, a, b) !== (dot(w, w) < r * r && dot(w, m) > dot(m, m))) R.inside = !R.inside
    const ea = sub(a, c), eb = sub(b, c)
    const s = cross2(ea, eb) >= 0 ? 1 : -1
    const wedge = s * cross2(ea, w) >= 0 && s * cross2(w, eb) >= 0
    const ends = dot(sub(q, a), sub(q, a)) <= dot(sub(q, b), sub(q, b)) ? a : b
    const p = wedge ? add(c, scl(g2Dir(w, g2Dir(m, [1, 0])), r)) : ends
    const v = sub(q, p)
    const d2 = dot(v, v)
    if (d2 < R.d2) { R.v = v; R.d2 = d2; R.n = scl(g2Dir(sub(p, c), [1, 0]), convex ? 1 : -1) }
    return R
}
export function pfEnd(A) {
    const d = Math.sqrt(A.d2), s = A.inside ? -1 : 1
    return [...(d > 1e-12 ? scl(A.v, s / Math.max(d, 1e-30)) : A.n), s * d]
}
/** What profileWGSL's function returns, in JS: the pieces folded in order. */
export function profileEval(pieces, q, axis = false) {
    let A = pfStart()
    for (const k of pieces) A = k.kind === 'arc' ? pfArc(A, q, k.c, k.r, k.a, k.b, k.convex) : pfSegment(A, q, k.a, k.b, k.axis ? !axis : true)
    return pfEnd(A)
}
export function g2Extrude(p, g, h) {
    const wz = Math.abs(p[2]) - h, sz = sgn(p[2])
    if (g[2] > 0 && wz > 0) { const l = Math.hypot(g[2], wz); return [g[0] * g[2] / l, g[1] * g[2] / l, sz * wz / l, l] }
    if (g[2] > wz) return [g[0], g[1], 0, g[2]]
    return [0, 0, sz, wz]
}

//----------------------------------------------------------------------------------------------------------------------
// PATHS (JS): the compiler from points to pieces, which codegen and the model both use, the reach of a cross-section,
// the generator of a path's WGSL, and the twin of the WGSL's helpers
//----------------------------------------------------------------------------------------------------------------------
const norm3 = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l] }

/**
 * A path -- [[x, y, z], [x, y, z, fillet], [x, y, z, fillet, scale x, scale y, twist], ...], open, from the first point
 * to the last -- as the pieces the WGSL walks, in order: { kind: 'segment', a, T, N, B, L, first, last, va, vb } and
 * { kind: 'bend', c, k, R, u0, u1, f, a, b, phi, v }.
 * PER POINT, THE CROSS-SECTION'S SCALE AND TWIST (the user, 2026-10-02): entries 5 to 7, scale x, scale y (scale x's
 * when left off) and twist in degrees, all optional. A point's values are [sx, sy, twist in RADIANS]; a segment carries
 * its two points' (va, vb) and changes linearly between them, a bend holds its corner's (v) -- the user's choice:
 * "change on straights, hold on bends". `varies` says whether any point is off the defaults [1, 1, 0].
 * A bend is a corner's fillet arc (R its radius, in the plane of its two edges, tangent to both, a to b), or with no
 * fillet a fan about the corner (R 0); k its axis, u0 and u1 its radial directions at its ends, f = [a, b, c, d] the
 * frame's coefficients there (N = a.radial + b.k, B = c.radial + d.k). The first frame: B the world's +z off the path
 * (+y where the path runs along z), N = B x T.
 * PROBLEMS, by the user's own point numbers: fewer than two points, a point not three or four numbers, a negative
 * fillet, a fillet on an end (no corner there), two neighbours the same point, a corner where the path turns back on
 * itself, fillets that do not fit their edge. With any, there are no pieces.
 * @returns {{ pieces: object[], problems: string[] }}
 */
export function pathPieces(points) {
    const problems = []
    if (!Array.isArray(points) || points.length < 2) return { pieces: [], problems: ['a path needs at least two points'], varies: false }
    points.forEach((pt, i) => {
        if (!Array.isArray(pt) || pt.length < 3 || pt.length > 7 || !pt.every(Number.isFinite))
            problems.push(`point ${i + 1}: x, y, z, then a fillet, scale x, scale y and twist if it has them -- numbers`)
        else if (pt.length >= 4 && pt[3] < 0) problems.push(`point ${i + 1}: a fillet radius cannot be negative`)
        else if (pt.length >= 4 && pt[3] > 0 && (i === 0 || i === points.length - 1)) problems.push(`point ${i + 1}: an end has no corner to round`)
        else if ((pt.length >= 5 && !(pt[4] > 0)) || (pt.length >= 6 && !(pt[5] > 0))) problems.push(`point ${i + 1}: a scale is more than 0`)
    })
    if (problems.length) return { pieces: [], problems, varies: false }
    const n = points.length, P = points.map(p => [p[0], p[1], p[2]]), F = points.map(p => p[3] ?? 0)
    const V = points.map(p => { const sx = p[4] ?? 1; return [sx, p[5] ?? sx, (p[6] ?? 0) * Math.PI / 180] })
    const varies = V.some(v => v[0] !== 1 || v[1] !== 1 || v[2] !== 0)
    for (let i = 0; i + 1 < n; i++)
        if (P[i][0] === P[i + 1][0] && P[i][1] === P[i + 1][1] && P[i][2] === P[i + 1][2]) problems.push(`points ${i + 1} and ${i + 2} are the same point`)
    if (problems.length) return { pieces: [], problems, varies: false }
    const T = [], L = []
    for (let i = 0; i + 1 < n; i++) { const d = sub(P[i + 1], P[i]); L.push(len(d)); T.push(norm3(d)) }
    const bend = new Array(n).fill(null)
    for (let i = 1; i + 1 < n; i++) {
        const turn = Math.acos(Math.min(1, Math.max(-1, dot(T[i - 1], T[i]))))
        if (turn > Math.PI - 1e-3) { problems.push(`the path turns back on itself at point ${i + 1}`); continue }
        if (turn < 1e-9) continue                                               // straight on: no corner
        const k = norm3(cross3(T[i - 1], T[i])), r = F[i], half = (Math.PI - turn) / 2
        const t = r / Math.tan(half)
        const c = r > 0 ? add(P[i], scl(norm3(sub(T[i], T[i - 1])), r / Math.sin(half))) : P[i]
        bend[i] = { k, R: r, t, c, phi: turn, a: sub(P[i], scl(T[i - 1], t)), b: add(P[i], scl(T[i], t)),
                    u0: cross3(T[i - 1], k), u1: cross3(T[i], k) }
    }
    for (let i = 0; i + 1 < n; i++) {
        const need = (bend[i]?.t ?? 0) + (bend[i + 1]?.t ?? 0)
        if (need > L[i] * (1 + 1e-9)) {
            const which = [bend[i]?.t && i + 1, bend[i + 1]?.t && i + 2].filter(Boolean)
            problems.push(`the fillet${which.length > 1 ? 's' : ''} at point${which.length > 1 ? 's' : ''} ${which.join(' and ')} need ${+need.toPrecision(4)} of an edge ${+L[i].toPrecision(4)} long`)
        }
    }
    if (problems.length) return { pieces: [], problems, varies: false }
    // THE FIRST FRAME, then carried: constant along a segment, its coefficients on (radial, k) constant round a bend
    let Bv = sub([0, 0, 1], scl(T[0], T[0][2]))
    if (len(Bv) < 1e-6) Bv = sub([0, 1, 0], scl(T[0], T[0][1]))
    Bv = norm3(Bv)
    let Nv = cross3(Bv, T[0])
    const pieces = []
    for (let i = 0; i + 1 < n; i++) {
        const a = bend[i] ? bend[i].b : P[i], b = bend[i + 1] ? bend[i + 1].a : P[i + 1]
        pieces.push({ kind: 'segment', a, T: T[i], N: Nv, B: Bv, L: Math.max(len(sub(b, a)), 0), first: i === 0, last: i === n - 2,
                      va: V[i], vb: V[i + 1] })
        const k = bend[i + 1]
        if (k) {
            const f = [dot(Nv, k.u0), dot(Nv, k.k), dot(Bv, k.u0), dot(Bv, k.k)]
            pieces.push({ kind: 'bend', c: k.c, k: k.k, R: k.R, u0: k.u0, u1: k.u1, f, a: k.a, b: k.b, phi: k.phi, v: V[i + 1] })
            Nv = add(scl(k.u1, f[0]), scl(k.k, f[1]))
            Bv = add(scl(k.u1, f[2]), scl(k.k, f[3]))
        }
    }
    return { pieces, problems, varies }
}

/** How far a profile's outline reaches from its origin -- a bound for the sweep's skipping: no farther than its
 *  farthest vertex, or an arc's centre plus its radius. */
export const profileReachOf = pieces => pieces.reduce((m, k) => Math.max(m, k.kind === 'arc' ? Math.hypot(...k.c) + k.r
    : Math.max(Math.hypot(...k.a), Math.hypot(...k.b))), 0)

const v3 = p => `VEC3(${lit(p[0])}, ${lit(p[1])}, ${lit(p[2])})`
const v4 = p => `VEC4(${lit(p[0])}, ${lit(p[1])}, ${lit(p[2])}, ${lit(p[3])})`
/** A piece's numbers as WGSL literals: what a compiled path is written with (and its values, for the varying form). */
export const literalOperands = k => k.kind === 'segment'
    ? { a: v3(k.a), T: v3(k.T), N: v3(k.N), B: v3(k.B), L: lit(k.L), va: v3(k.va ?? [1, 1, 0]), vb: v3(k.vb ?? [1, 1, 0]) }
    : { c: v3(k.c), k: v3(k.k), R: lit(k.R), u0: v3(k.u0), u1: v3(k.u1), f: v4(k.f), v: v3(k.v ?? [1, 1, 0]) }
/** Whether any of a path's pieces has a value off the defaults: what decides that it is written in the varying form. */
export const piecesVary = pieces => pieces.some(k => (k.kind === 'segment' ? [k.va, k.vb] : [k.v])
    .some(v => !!v && (v[0] !== 1 || v[1] !== 1 || v[2] !== 0)))
/**
 * The WGSL of one path: <name>_near(p) -> PathNear (its closest point, for a rounded tube) and <name>_sweep(p, prof,
 * r, e) -> VEC4 (the per-piece distance, for a sweep or a flat tube), each a straight chain, one block per piece. The
 * cross-section is pathCross(prof, r, q), which codegen writes per scene (a circle of radius r, or a profile).
 *   operands(piece) writes each piece's numbers: literals for a compiled path. `guard`, a WGSL condition, returns
 * nothing (far) when true: a live path a slider has made unsound. NO PIECES -- a path that is not sound as compiled --
 * is two functions that return nothing.
 *   VARYING (`vary`: a point's scale or twist, 2026-10-02): <name>_tube(p, r) -> VEC4 in place of _near -- the
 * rounded tube as round cones and torus arcs, its radius r times each point's scale x -- and a _sweep whose segments
 * take the slice at p's own place and whose bends hold their corner's values (the WGSL's comment above swRound). The
 * operands then carry each piece's values too: a segment's va and vb, a bend's v. Without `vary` the text is what it
 * was, so a path with every value the default costs what it did.
 *   SLOTTED (`slots`, a number: a LIVE path, or one edited in the picture -- builder/codegen.js, which rewrites its
 * numbers as uniforms): the chain is by position -- segment, bend, segment ... for the points there is room for
 * (pathSlotsOf) -- so a corner made straight, a point added or taken away within the room, is numbers, not text. It is
 * A LOOP over the slots, each read by its index through <name>_slot(i) (`slot(i)`: the uniforms of slot i, { m, f, v },
 * a PathSlot's three), one block for a segment and one for a bend, run up to `count` (a uniform: the slots up to the
 * last one on) and skipping a slot that is off. Until 2026-10-02 it was written out slot by slot, every block with
 * its own copy of the cross-section: the light guide edited in the picture (4 points and 8 spare) was the section at
 * 51 places in every kernel, and its compile took 70 s on the user's machine. Now it is at 5, whatever the room.
 * THE LOOP'S BOUND GOES THROUGH noUnroll (tracebasics.js: every compiler behind WebGPU inlines every call, and
 * unrolls a loop whose bound it can see). Its first form, `min(count, slots)`, told the compiler it ran at most
 * `slots` times; the user found the compile only "a bit better" -- inferred, not measured, that it was unrolled back
 * into a copy a slot. A count past the room is harmless: the accessor's default is a slot that is off.
 * `operands` then reads the slot, `sl` (codegen's).
 */
export function pathWGSL(name, pieces, { operands = literalOperands, guard = null, slots = null, slot = null, count = null, vary = false } = {}) {
    const FAR_NEAR = 'PathNear(VEC3(0.0, 0.0, 0.0), 1.0e14, VEC3(0.0, 0.0, 1.0))', FAR = 'VEC4(0.0, 0.0, 1.0, 1.0e7)'
    const looped = slots != null
    const nearHead = vary ? `fn ${name}_tube(p: VEC3, r: FLOAT) -> VEC4` : `fn ${name}_near(p: VEC3) -> PathNear`
    const swHead = `fn ${name}_sweep(p: VEC3, prof: u32, r: FLOAT, e: FLOAT) -> VEC4`
    if (!looped && !pieces.length) return [`${nearHead} { return ${vary ? FAR : FAR_NEAR}; }`, `${swHead} { return ${FAR}; }`].join('\n')
    /* a piece's call in the closest-point function, and its lines in the sweep, as either a chain or the loop has them */
    const nearCall = (kind, o) => kind === 'segment'
        ? (vary ? `A = pdCone(A, p, ${o.a}, ${o.T}, ${o.L}, r * (${o.va}).x, r * (${o.vb}).x, ${o.N});` : `A = pnSegment(A, p, ${o.a}, ${o.T}, ${o.L}, ${o.N});`)
        : (vary ? `A = pdBend(A, p, ${o.c}, ${o.k}, ${o.R}, ${o.u0}, ${o.u1}, r * (${o.v}).x);` : `A = pnBend(A, p, ${o.c}, ${o.k}, ${o.R}, ${o.u0}, ${o.u1});`)
    const swLines = (kind, o, first, last) => {
        if (kind === 'segment') return vary ? [
            `let l = swSegLocalV(p, ${o.a}, ${o.T}, ${o.N}, ${o.B}, ${o.L}, ${o.va}, ${o.vb}, asTube, e);`,
            `if (!swSkip(S, l.cl, e * l.smax)) { S = swSegFoldV(S, l, pathCross(prof, r, l.q), ${o.T}, ${o.N}, ${o.B}, ${o.L}, ${first}, ${last}); }`] : [
            `let l = swSegLocal(p, ${o.a}, ${o.T}, ${o.N}, ${o.B}, ${o.L});`,
            `if (!swSkip(S, l.cl, e)) { S = swSegFold(S, l, pathCross(prof, r, l.q), ${o.T}, ${o.N}, ${o.B}, ${o.L}, ${first}, ${last}); }`]
        // The end faces are folded for p in the wedge too when the cross-section reaches past the axis (e > R).
        // Measured (node, doubles, 2026-10-01): leaving them out there changed the distance at 0 of 1,300,000
        // points over six tight cases, one a section wholly past the axis -- likely because the neighbouring
        // piece's capped end is the same face. That is an argument, not a proof for every neighbour (a fan, a
        // zero-length segment), so they stay: two more cross-sections, at tight bends only. And there each face is
        // a depth too (swBendEnds' show): past the axis part of it can be the surface.
        const args = `${o.k}, ${o.f}`
        if (!vary) return [
            `let b = swBendLocal(p, ${o.c}, ${o.k}, ${o.R}, ${o.u0}, ${o.u1}, ${o.f});`,
            'if (!swSkip(S, b.cl, e)) {',
            `    if (b.inW) { S = swBendSide(S, pathCross(prof, r, b.q), b.rad, ${args}); }`,
            `    if (b.opW) { S = swBendSide(S, pathCross(prof, r, b.qo), -b.rad, ${args}); }`,
            `    if (!b.inW || e > ${o.R}) { S = swBendEnds(S, b, pathCross(prof, r, b.q0), pathCross(prof, r, b.q1), ${o.k}, ${o.u0}, ${o.u1}, ${o.f}, e > ${o.R}); }`,
            '}']
        // the section the bend holds, scaled and turned by its corner's values, at q (swUnscale, swRescale)
        const X = q => `swRescale(pathCross(prof, r, swUnscale(${q}, v)), v, ${q}, e)`
        return [
            `let v = swRound(${o.v}, asTube);`,
            'let em = e * max(v.x, v.y);',
            `let b = swBendLocal(p, ${o.c}, ${o.k}, ${o.R}, ${o.u0}, ${o.u1}, ${o.f});`,
            'if (!swSkip(S, b.cl, em)) {',
            `    if (b.inW) { S = swBendSide(S, ${X('b.q')}, b.rad, ${args}); }`,
            `    if (b.opW) { S = swBendSide(S, ${X('b.qo')}, -b.rad, ${args}); }`,
            `    if (!b.inW || em > ${o.R}) { S = swBendEnds(S, b, ${X('b.q0')}, ${X('b.q1')}, ${o.k}, ${o.u0}, ${o.u1}, ${o.f}, em > ${o.R}); }`,
            '}']
    }
    const at = (n, lines) => lines.map(l => ' '.repeat(n) + l)
    const near = [`${nearHead} {`], sw = [`${swHead} {`]
    if (guard) { near.push(`    if (${guard}) { return ${vary ? FAR : FAR_NEAR}; }`); sw.push(`    if (${guard}) { return ${FAR}; }`) }
    near.push(vary ? '    var A = pdStart();' : '    var A = pnStart();')
    // a tube's section is a circle (pathCross's 4294967295u): it reads scale x alone (swRound)
    sw.push('    var S = swStart();', ...(vary ? ['    let asTube = prof == 4294967295u;'] : []))
    const out = []
    if (!looped) for (const k of pieces) {
        const o = operands(k)
        near.push(`    ${nearCall(k.kind, o)}`)
        sw.push('    {', ...at(8, swLines(k.kind, o, k.first, k.last)), '    }')
    } else {
        // segments in the even slots, bends in the odd (pathSlotsOf); a slot is on by its [1].w, either kind
        const seg = operands({ kind: 'segment' }), bend = operands({ kind: 'bend' })
        const loop = (a, b) => [`    for (var i = 0u; i < noUnroll(u32(${count})); i = i + 1u) {`,
            `        let sl = ${name}_slot(i);`, '        if (sl.m[1].w < 0.5) { continue; }',
            '        if ((i & 1u) == 0u) {', ...at(12, a), '        } else {', ...at(12, b), '        }', '    }']
        near.push(...loop([nearCall('segment', seg)], [nearCall('bend', bend)]))
        sw.push(...loop(swLines('segment', seg, seg.first, seg.last), swLines('bend', bend)))
        const z = { m: 'mat4x4<f32>()', f: 'vec4<f32>()', v: 'mat2x4<f32>()' }
        out.push(`fn ${name}_slot(i: u32) -> PathSlot {`, '    switch i {',
            ...Array.from({ length: slots }, (_, i) => { const q = { ...z, ...slot(i) }; return `        case ${i}u: { return PathSlot(${q.m}, ${q.f}, ${q.v}); }` }),
            `        default: { return PathSlot(${z.m}, ${z.f}, ${z.v}); }`, '    }', '}')
    }
    near.push(vary ? '    return pdEnd(A);' : '    return A;', '}')
    sw.push('    return swEnd(S);', '}')
    return [...out, ...near, ...sw].join('\n')
}

/* THE SLOTS A LIVE CHAIN IS WRITTEN IN (2026-10-02, the user: "adding points now requires recompilation ... a number
   of extra points added with some flag that these are empty"). A compiled chain is its pieces in order; a live one is
   written BY POSITION, for a number of points -- `cap`, the room -- so its text depends on the room alone, and the
   pieces are numbers laid into it: a path's segment i in slot 2i and the bend after it in 2i + 1 (a straight corner has
   none: its slot is off); a profile's point j's arc in 2j and the segment after it in 2j + 1 (no fillet, or a segment
   a fillet used up: off). Order is kept, so with the slots that are off left out the chain IS the compiled chain
   (codegen.test reads it so). Spare room is slots that are off. */
/** How many slots a path with room for `cap` points has: cap - 1 segments and the cap - 2 bends between them. */
export const pathSlotCount = cap => Math.max(2 * cap - 3, 1)
/** A path's pieces laid into its slots: a piece or null (off) a slot. */
export function pathSlotsOf(pieces, cap) {
    const slots = new Array(pathSlotCount(cap)).fill(null)
    let j = 0
    for (const p of pieces) {
        if (p.kind === 'segment') slots[2 * j++] = p
        else slots[2 * j - 1] = p
    }
    return slots
}
/** How many slots a profile with room for `cap` points has: an arc and a segment a point. */
export const profileSlotCount = cap => 2 * cap
/** A profile's pieces laid into its slots, in order: an arc where the slot is an arc's, a segment where a segment's
 *  -- an arc after an arc means the segment between was used up by the two fillets, so the second is the next point's. */
export function profileSlotsOf(pieces, cap) {
    const slots = new Array(profileSlotCount(cap)).fill(null)
    let j = 0, arcAt = -1
    for (const p of pieces) {
        if (p.kind === 'arc') { if (arcAt === j) j++; slots[2 * j] = p; arcAt = j }
        else slots[2 * j++ + 1] = p
    }
    return slots
}

// the twin of the WGSL's path helpers
export const pnStart = () => ({ c: [0, 0, 0], d2: 3.0e38, n: [0, 0, 1] })
export function pnSegment(A, p, a, T, L, N) {
    const c = add(a, scl(T, clamp(dot(sub(p, a), T), 0, L))), d2 = dot(sub(p, c), sub(p, c))
    return d2 < A.d2 ? { c, d2, n: N } : A
}
export const pnWedge = (rad, k, u0, u1) => dot(cross3(u0, rad), k) >= 0 && dot(cross3(rad, u1), k) >= 0
export function pnBend(A, p, c0, k, R0, u0, u1) {
    const v = sub(p, c0), rad = safeDir(sub(v, scl(k, dot(v, k))), u0)
    const e0 = add(c0, scl(u0, R0)), e1 = add(c0, scl(u1, R0))
    const c = pnWedge(rad, k, u0, u1) ? add(c0, scl(rad, R0)) : (dot(sub(p, e0), sub(p, e0)) <= dot(sub(p, e1), sub(p, e1)) ? e0 : e1)
    const d2 = dot(sub(p, c), sub(p, c))
    return d2 < A.d2 ? { c, d2, n: rad } : A
}
export const swStart = () => ({ out: 3.0e38, gout: [0, 0, 1], depth: 3.0e38, gin: [0, 0, 1] })
export const swSkip = (S, cl, e) => cl - e >= S.out && cl - e >= S.depth
const comb = (N, B, x, y) => add(scl(N, x), scl(B, y))
export function swRegion(g, h, n, N, B) {
    const gz = Math.max(g[2], 0)
    return [...sub(scl(comb(N, B, g[0], g[1]), -gz), scl(n, h)), Math.hypot(gz, h)]
}
export function swCurve(g, h, n, N, B) {
    return [...sub(scl(comb(N, B, g[0], g[1]), -g[2]), scl(n, h)), Math.hypot(g[2], h)]
}
export function swSegLocal(p, a, T, N, B, L) {
    const v = sub(p, a), s = dot(v, T)
    return { q: [dot(v, N), dot(v, B)], s, cl: len(sub(v, scl(T, clamp(s, 0, L)))) }
}
export function swSegFold(S, l, g, T, N, B, L, first, last) {
    const R = { ...S }
    const x = g2Extrude([l.q[0], l.q[1], l.s - 0.5 * L], g, 0.5 * L)
    if (x[3] < R.out) { R.out = x[3]; R.gout = add(comb(N, B, x[0], x[1]), scl(T, x[2])) }
    const side = swCurve(g, l.s - clamp(l.s, 0, L), T, N, B)
    if (side[3] < R.depth) { R.depth = side[3]; R.gin = side.slice(0, 3) }
    if (first) { const f = swRegion(g, l.s, T, N, B); if (f[3] < R.depth) { R.depth = f[3]; R.gin = f.slice(0, 3) } }
    if (last) { const f = swRegion(g, l.s - L, T, N, B); if (f[3] < R.depth) { R.depth = f[3]; R.gin = f.slice(0, 3) } }
    return R
}
export function swBendLocal(p, c, k, R0, u0, u1, f) {
    const v = sub(p, c), h = dot(v, k), w = sub(v, scl(k, h)), rho = len(w), rad = safeDir(w, u0)
    const inW = pnWedge(rad, k, u0, u1), opW = pnWedge(scl(rad, -1), k, u0, u1)
    const a = rho - R0, ao = -rho - R0, o0 = sub(v, scl(u0, R0)), o1 = sub(v, scl(u1, R0))
    const N0 = add(scl(u0, f[0]), scl(k, f[1])), B0 = add(scl(u0, f[2]), scl(k, f[3]))
    const N1 = add(scl(u1, f[0]), scl(k, f[1])), B1 = add(scl(u1, f[2]), scl(k, f[3]))
    return { inW, opW, rad, q: [a * f[0] + h * f[1], a * f[2] + h * f[3]], qo: [ao * f[0] + h * f[1], ao * f[2] + h * f[3]],
             q0: [dot(o0, N0), dot(o0, B0)], h0: dot(o0, cross3(k, u0)), q1: [dot(o1, N1), dot(o1, B1)], h1: dot(o1, cross3(k, u1)),
             cl: inW ? Math.hypot(a, h) : Math.min(len(o0), len(o1)) }
}
export function swBendSide(S, g, rad, k, f) {
    const R = { ...S }
    const N = add(scl(rad, f[0]), scl(k, f[1])), B = add(scl(rad, f[2]), scl(k, f[3])), n = comb(N, B, g[0], g[1])
    if (g[2] < R.out) { R.out = g[2]; R.gout = safeDir(n, N) }
    if (Math.abs(g[2]) < R.depth) { R.depth = Math.abs(g[2]); R.gin = Math.abs(g[2]) > 1e-12 ? scl(n, -g[2]) : n }
    return R
}
export function swBendEnds(S, b, g0, g1, k, u0, u1, f, show) {
    const R = { ...S }
    const T0 = cross3(k, u0), T1 = cross3(k, u1)
    const N0 = add(scl(u0, f[0]), scl(k, f[1])), B0 = add(scl(u0, f[2]), scl(k, f[3]))
    const N1 = add(scl(u1, f[0]), scl(k, f[1])), B1 = add(scl(u1, f[2]), scl(k, f[3]))
    const r0 = swRegion(g0, b.h0, T0, N0, B0), r1 = swRegion(g1, b.h1, T1, N1, B1)
    if (r0[3] < R.out) { R.out = r0[3]; R.gout = safeDir(scl(r0.slice(0, 3), -1), scl(T0, -1)) }
    if (r1[3] < R.out) { R.out = r1[3]; R.gout = safeDir(scl(r1.slice(0, 3), -1), T1) }
    if (show && r0[3] < R.depth) { R.depth = r0[3]; R.gin = r0.slice(0, 3) }
    if (show && r1[3] < R.depth) { R.depth = r1[3]; R.gin = r1.slice(0, 3) }
    const c0 = swCurve(g0, b.h0, T0, N0, B0), c1 = swCurve(g1, b.h1, T1, N1, B1)
    if (c0[3] < R.depth) { R.depth = c0[3]; R.gin = c0.slice(0, 3) }
    if (c1[3] < R.depth) { R.depth = c1[3]; R.gin = c1.slice(0, 3) }
    return R
}
export function swEnd(S) {
    if (S.out >= 0) return [...safeDir(S.gout, [0, 0, 1]), S.out]
    return [...safeDir(S.gin, S.gout), -S.depth]
}
/** What a path's _near returns, in JS. */
export function pathNearEval(pieces, p) {
    let A = pnStart()
    for (const k of pieces) A = k.kind === 'segment' ? pnSegment(A, p, k.a, k.T, k.L, k.N) : pnBend(A, p, k.c, k.k, k.R, k.u0, k.u1)
    return A
}
/** What a path's _sweep returns, in JS: cross(q) the cross-section's 2D result, e its reach. */
export function pathSweepEval(pieces, p, cross, e) {
    let S = swStart()
    for (const k of pieces) {
        if (k.kind === 'segment') {
            const l = swSegLocal(p, k.a, k.T, k.N, k.B, k.L)
            if (!swSkip(S, l.cl, e)) S = swSegFold(S, l, cross(l.q), k.T, k.N, k.B, k.L, k.first, k.last)
        } else {
            const b = swBendLocal(p, k.c, k.k, k.R, k.u0, k.u1, k.f)
            if (swSkip(S, b.cl, e)) continue
            if (b.inW) S = swBendSide(S, cross(b.q), b.rad, k.k, k.f)
            if (b.opW) S = swBendSide(S, cross(b.qo), scl(b.rad, -1), k.k, k.f)
            // why e > R: see pathWGSL. (Until 2026-10-02 this call sat inside the comment, so the twin never folded a
            // bend's end faces while the WGSL did; on 80,000 points the two agreed to 1e-12 -- the neighbouring
            // segment's capped end is the same face -- but a tapered end would not have been.)
            if (!b.inW || e > k.R) S = swBendEnds(S, b, cross(b.q0), cross(b.q1), k.k, k.u0, k.u1, k.f, e > k.R)
        }
    }
    return swEnd(S)
}
/** The rounded tube, in JS: one closest point. */
export function tubeRoundedEval(pieces, p, r) {
    const A = pathNearEval(pieces, p), d = Math.sqrt(A.d2)
    return [...safeDir(sub(p, A.c), A.n), d - Math.max(r, 0)]
}

// the twin of the WGSL's per-point scale and twist (the WGSL's comment above swRound says what each does and why)
export const swRound = (v, asTube) => asTube ? [v[0], v[0], 0] : v
export function swUnscale(q, v) {
    const c = Math.cos(v[2]), s = Math.sin(v[2])
    return [(c * q[0] + s * q[1]) / v[0], (-s * q[0] + c * q[1]) / v[1]]
}
export function swRescale(g, v, q, e) {
    const m = Math.min(v[0], v[1]), gs = [g[0] / v[0] * m, g[1] / v[1] * m], c = Math.cos(v[2]), s = Math.sin(v[2])
    const cyl = len(q) - e * Math.max(v[0], v[1])
    if (cyl > m * g[2]) return [...g2Dir(q, [1, 0]), cyl]
    return [c * gs[0] - s * gs[1], s * gs[0] + c * gs[1], m * g[2]]
}
export const pdStart = () => ({ n: [0, 0, 1], d: 3.0e38 })
export function pdCone(A, p, a, T, L, ra, rb, N) {
    const w = sub(p, a), z = dot(w, T), rv = sub(w, scl(T, z)), q = [len(rv), z], rad = safeDir(rv, N)
    let g
    if (L <= Math.abs(ra - rb)) g = ra >= rb ? g2Circle(q, [0, 0], ra) : g2Circle(q, [0, L], rb)
    else {
        const b = (ra - rb) / L, a2 = Math.sqrt(1 - b * b), k = dot(q, [-b, a2])
        if (k < 0) g = g2Circle(q, [0, 0], ra)
        else if (k > a2 * L) g = g2Circle(q, [0, L], rb)
        else g = [a2, b, dot(q, [a2, b]) - ra]
    }
    return g[2] < A.d ? { d: g[2], n: add(scl(rad, g[0]), scl(T, g[1])) } : A
}
export function pdBend(A, p, c0, k, R0, u0, u1, r) {
    const v = sub(p, c0), rad = safeDir(sub(v, scl(k, dot(v, k))), u0)
    const e0 = add(c0, scl(u0, R0)), e1 = add(c0, scl(u1, R0))
    const c = pnWedge(rad, k, u0, u1) ? add(c0, scl(rad, R0)) : (dot(sub(p, e0), sub(p, e0)) <= dot(sub(p, e1), sub(p, e1)) ? e0 : e1)
    const d = len(sub(p, c)) - r
    return d < A.d ? { d, n: safeDir(sub(p, c), rad) } : A
}
export const pdEnd = A => [...safeDir(A.n, [0, 0, 1]), A.d]
const mix3 = (a, b, t) => a.map((x, k) => x + (b[k] - x) * t)
export function swSegLocalV(p, a, T, N, B, L, va0, vb0, asTube, e) {
    const w = sub(p, a), s = dot(w, T), q = [dot(w, N), dot(w, B)]
    const va = swRound(va0, asTube), vb = swRound(vb0, asTube), iL = 1 / Math.max(L, 1e-9)
    const v = mix3(va, vb, clamp(s * iL, 0, 1))
    const dv = s > 0 && s < L ? sub(vb, va).map(x => x * iL) : [0, 0, 0]
    const c = Math.cos(v[2]), sn = Math.sin(v[2])
    const u = [c * q[0] + sn * q[1], -sn * q[0] + c * q[1]]
    const smax = Math.max(va[0], va[1], vb[0], vb[1]), smin = Math.min(va[0], va[1], vb[0], vb[1])
    const k = Math.abs(vb[2] - va[2]) * iL
    const lq = len(q), rho = Math.max(lq, e * smax)
    const cr = Math.max(Math.abs(vb[0] - va[0]), Math.abs(vb[1] - va[1])) * iL / Math.max(smin, 1e-9), cc = cr * rho
    const sq = Math.sqrt(1 + k * k * rho * rho + cc * cc), lip = sq * (1 + cc)
    const dlip = (k * k * rho + cc * cr) / sq * (1 + cc) + sq * cr
    return { q: [u[0] / v[0], u[1] / v[1]], s, cl: len(sub(w, scl(T, clamp(s, 0, L)))), v, dv, u, lip, smax, qp: q, cyl: lq - e * smax,
             dl: lq > e * smax ? dlip / (lip * lq) : 0 }
}
export function swSegFoldV(S, l, g, T, N, B, L, first, last) {
    const R = { ...S }
    const m = Math.min(l.v[0], l.v[1]), gs = [g[0] / l.v[0] * m, g[1] / l.v[1] * m]
    const c = Math.cos(l.v[2]), sn = Math.sin(l.v[2])
    const gq = [c * gs[0] - sn * gs[1], sn * gs[0] + c * gs[1]]
    const dm = l.v[0] <= l.v[1] ? l.dv[0] : l.dv[1]
    const dq = [-(l.dv[0] / l.v[0]) * l.q[0] - l.dv[2] * (-l.u[1]) / l.v[0], -(l.dv[1] / l.v[1]) * l.q[1] - l.dv[2] * l.u[0] / l.v[1]]
    const fs = dm * g[2] + m * (g[0] * dq[0] + g[1] * dq[1])
    const fl = m * g[2] / l.lip, fd = Math.max(fl, l.cyl)
    const G = scl(sub(add(comb(N, B, gq[0], gq[1]), scl(T, fs)), scl(comb(N, B, l.qp[0], l.qp[1]), m * g[2] * l.dl)), 1 / l.lip)
    const nf = l.cyl > fl ? safeDir(comb(N, B, l.qp[0], l.qp[1]), N) : G
    const wz = Math.abs(l.s - 0.5 * L) - 0.5 * L, sz = sgn(l.s - 0.5 * L)
    let out = wz, gout = scl(T, sz)
    if (fd > 0 && wz > 0) { out = Math.hypot(fd, wz); gout = add(scl(nf, fd), scl(T, sz * wz)) }
    else if (fd > wz) { out = fd; gout = nf }
    if (out < R.out) { R.out = out; R.gout = safeDir(gout, T) }
    const h = l.s - clamp(l.s, 0, L), side = Math.hypot(fd, h)
    if (side < R.depth) { R.depth = side; R.gin = sub(scl(nf, -fd), scl(T, h)) }
    const cy = Math.max(l.cyl, 0), off = scl(comb(N, B, l.qp[0], l.qp[1]), -cy / Math.max(len(l.qp), 1e-12))
    if (first && Math.hypot(cy, l.s) < R.depth) { R.depth = Math.hypot(cy, l.s); R.gin = sub(off, scl(T, l.s)) }
    if (last && Math.hypot(cy, l.s - L) < R.depth) { R.depth = Math.hypot(cy, l.s - L); R.gin = sub(off, scl(T, l.s - L)) }
    return R
}
/** The rounded tube with per-point values, in JS: a round cone a segment, a ball swept round a bend. */
export function pathTubeEval(pieces, p, r) {
    let A = pdStart()
    for (const k of pieces) A = k.kind === 'segment' ? pdCone(A, p, k.a, k.T, k.L, r * k.va[0], r * k.vb[0], k.N)
        : pdBend(A, p, k.c, k.k, k.R, k.u0, k.u1, r * k.v[0])
    return pdEnd(A)
}
/** The sweep or flat tube with per-point values, in JS: cross(q) the UNSCALED section's 2D result, e its reach,
 *  asTube a tube's (its sx alone). As the WGSL pathWGSL writes for a path that varies. */
export function pathSweepEvalV(pieces, p, cross, e, asTube = false) {
    let S = swStart()
    for (const k of pieces) {
        if (k.kind === 'segment') {
            const l = swSegLocalV(p, k.a, k.T, k.N, k.B, k.L, k.va, k.vb, asTube, e)
            if (!swSkip(S, l.cl, e * l.smax)) S = swSegFoldV(S, l, cross(l.q), k.T, k.N, k.B, k.L, k.first, k.last)
        } else {
            const v = swRound(k.v, asTube), em = e * Math.max(v[0], v[1])
            const b = swBendLocal(p, k.c, k.k, k.R, k.u0, k.u1, k.f)
            if (swSkip(S, b.cl, em)) continue
            const X = q => swRescale(cross(swUnscale(q, v)), v, q, e)
            if (b.inW) S = swBendSide(S, X(b.q), b.rad, k.k, k.f)
            if (b.opW) S = swBendSide(S, X(b.qo), scl(b.rad, -1), k.k, k.f)
            if (!b.inW || em > k.R) S = swBendEnds(S, b, X(b.q0), X(b.q1), k.k, k.u0, k.u1, k.f, em > k.R)
        }
    }
    return swEnd(S)
}
