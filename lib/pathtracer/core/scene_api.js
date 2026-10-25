//======================================================================================================================
// SCENE API -- the WGSL a scene is written AGAINST, as opposed to the WGSL a scene supplies.
//
// A scene supplies two functions, `SDF(r: Ray) -> Hit` and `getMaterial2(C: Hit, checkInside:
// bool) -> Material2`. What it builds them from used to live in the host's scenes/common.js:
// add_new, the "nothing hit yet" Hit every SDF starts from, and MAT_AIR. None of that is a
// host's choice. add_new's backface test is the renderer's (it read UB.normallimit, a renderer setting, until 0.74.0); the empty Hit's medium is
// the one the shade kernel assumes a ray starts in; and every scene -- the three hand-written
// ones and the builder's generated one -- was carrying its own copy of the starting literal.
// A second host would have had to copy them again, so they are the renderer's now.
//
// SCENE_PRELUDE is the one spelling of everything a scene's WGSL is compiled after. The three
// geometry kernels and the builder's compile probe all use it, so the probe's claim to compile
// "the same prelude" is true by construction rather than by a comment. The shade kernel adds
// its processor after it; WGSL declarations are order-independent at module scope, so where
// the extra text goes changes nothing but line numbers.
//======================================================================================================================

import { PRIMITIVES } from './sdf.js'
import { DEFINITIONS } from './tracebasics.js'
import { MATERIALS } from './materials.js'
import { NOISE } from './noise.js'

/* add_new and fold, the scene's one way into a Hit: the whole answer (FOLD_FULL) everywhere but the renderer's march,
   which takes the distance-only pair (FOLD_DIST, SCENE_PRELUDE_DIST below) */
const FOLD_FULL = `        /* FOLD ONE PRIMITIVE INTO THE HIT. sdf is (normal.xyz, distance) in the CURRENT frame,
           taken to world here; matIndex its material. */
        fn add_new(C: Hit, sdf: VEC4, matIndex: u32) -> Hit {
            return fold(C, VEC4(XF_M * sdf.xyz, sdf.w * XF_S), matIndex);
        }

        /* FOLD A WORLD-SPACE RESULT. add_new without the transform, for a value that is
           already in world units -- a CSG group's combined shape, built from children that
           each went through their own transform.
           Two things are tracked at once, and they are separate on purpose:
             the MEDIUM (a, insideW): of everything the point is inside, the one it is least
               deep in -- argmax over negative distances -- which is what refraction asks for;
             the SURFACE (s, m): argmin over |d|, the nearest boundary in either direction. */
        fn fold(C: Hit, sdf: VEC4, matIndex: u32) -> Hit {
            var H = C;
            if (sdf.w < 0.0 && sdf.w > H.insideW) {
                H.insideW = sdf.w;
                H.a = matIndex;
            }
            if (abs(sdf.w) < abs(H.s.w)) {
                /* backface / grazing-angle test applies to the surface only, not the medium. ITS BOUND IS 1 (0.74.0):
                   it was UB.normallimit, a developer setting whose default was 1, and at 1 no unit or zero normal fails
                   it -- only a NaN one does (csgNormal below), as it always has. So the setting went and nothing moved. */
                let pass1 = (dot(sdf.xyz, H.r.dir) <= 1.0) || (H.r.n > 1.0);
                if (pass1) {
                    H.s = sdf;
                    H.m = matIndex;
                    if (LOCAL_CAPTURE) {
                        if (XF_SUB == 0u) {
                            HIT_LOCAL = XF_P;
                            if (XF_STRAIGHT) { HIT_FRAME = XF_QM; HIT_SCALE = XF_QS; } else { HIT_FRAME = XF_M; HIT_SCALE = XF_S; }
                        }
                        if (abs(sdf.w) < HIT_TAG_D) { HIT_TAG_D = abs(sdf.w); HIT_TAG = XF_TAG; }
                    }
                }
            }
            return H;
        }
`
const FOLD_DIST = `        /* DISTANCE ONLY (0.next; wavefront.js prog_march's distOnly, the renderer's march always): the march's own pair, for
           a march that asks the scene one thing, how far the nearest surface is. add_new and fold as the renderer's (FOLD_FULL)
           with all but the nearest surface's signed distance left out -- the normal and its turn into the world frame,
           the material, the medium, the capture -- so nothing in the march reads a shape's normal and the compiler can
           drop that work at every step (measured: the march 8-79% less GPU time, docs/PERFORMANCE.md). The full answer is the surface kernel's,
           once, at the ray the march stopped (prog_surface, THE HIT ITSELF). THE ONE RULE THAT DIFFERS is fold's pass1,
           which only a NaN normal fails (a normalize(0): a sphere's exact centre); with no normal here nothing fails it,
           so such a point's distance is that shape's -- never longer than the full fold's, a shorter step if anything. */
        fn add_new(C: Hit, sdf: VEC4, matIndex: u32) -> Hit {
            return fold(C, VEC4(0.0, 0.0, 0.0, sdf.w * XF_S), matIndex);
        }
        fn fold(C: Hit, sdf: VEC4, matIndex: u32) -> Hit {
            var H = C;
            if (abs(sdf.w) < abs(H.s.w)) { H.s.w = sdf.w; }
            return H;
        }
`
const sceneApiWGSL = fold => /* wgsl */ `
        /* MATERIAL ID 0 IS THE AMBIENT MEDIUM. It is what emptyHit puts in Hit.a, so it is the
           medium a ray is in before it enters anything, and getMaterial2(C, true) is asked
           about it constantly. A scene's getMaterial2 must answer it with an IOR of 1; no
           geometry should ever carry it. */
        const MAT_AIR: u32 = 0u;

        /* WHAT AN SDF STARTS FROM: nothing hit, ambient medium, and a distance no real
           primitive loses to. The environment is the renderer's -- a ray that leaves the
           environment radius gets envRadiance in the shade kernel -- so a scene has no sky
           dome to open with, only this. */
        fn emptyHit(r: Ray) -> Hit {
            return Hit(r, VEC4(0.0, 0.0, 1.0, 1.0e7), MAT_AIR, MAT_AIR, -1.0e7);
        }

        /* WHAT THE SCENE SAYS ABOUT A HIT, for a shade kernel that does not hold it (0.20.8; wavefront.js
           prog_surface writes it, prog_shade reads it): the three questions shade used to ask, answered.
             m    the material, of the hit as the path asks about it (pathFacing; a probe's hit as it is)
             nrm  the normal as the SDF gives it, before it is turned to the ray (hitNormal's answer)
             n1   the medium a hair beyond, where the material asks (pathMiddle, probeMiddle) -- 0 otherwise
             mu1  ...and what it absorbs, per metre (materials.js mediumMu; 0.37.0) -- 0 otherwise
           It rides beside the hit in the shade queue (ShadeItem), not in a buffer of its own: shade is at the
           spec floor of 8 storage bindings, and a ninth is an adapter that will not run it. */
        struct Surface {
            m: Material2,
            nrm: VEC3,
            n1: FLOAT,
            mu1: VEC3,          // 16 more bytes an item (0.37.0): ShadeItem 272 since a coating's (tracebasics.js SHADE_ITEM_BYTES)
            v1: FLOAT,          // ...and its Abbe number (materials.js abbe; 0.40.0): 0 not dispersive. mu1's padding: no byte more
            /* The manifold connection's answer (0.44.0) rode here, 16 more bytes an item, ShadeItem 288. It went with the
               connection in 0.61.0: the photon map (sppm.js) owns the class it served. 272 again. */
        }
        struct ShadeItem {
            hit: Hit,           // the march writes this
            sf: Surface,        // ...the surface kernel this, and shade reads both
        }

        /* THE ARGUMENTS SHADE'S QUESTIONS DEPEND ON THE PATH FOR, decided by the same functions in the
           kernel that asks them (prog_surface) and the one that uses the answers (tracebasics.js, the path's
           and the probe's phases), so the material is asked about exactly the hit shade shades. */
        /* A PATH'S HIT AS ITS MATERIAL IS ASKED ABOUT IT (pathPrelude): inside if the distance is negative, the
           normal turned to face the ray and kept in s, the bounce counted -- or leaving: the ray is moving away
           from the surface and nothing is asked. */
        struct Facing { res: Hit, nrm: VEC3, inside: bool, leaving: bool, }
        fn pathFacing(hit: Hit, n: VEC3) -> Facing {
            var f: Facing;
            f.inside = hit.s.w < 0.0;
            f.nrm = select(n, -n, f.inside);
            f.leaving = dot(-hit.r.dir, f.nrm) < 0.0;
            f.res = hit;
            f.res.s = VEC4(f.nrm, hit.s.w);
            f.res.r.bounces++;
            return f;
        }
        // AN EMITTER PHOTON'S PROBE THAT HAS RUN OUT (probeBegin): it asks nothing
        fn probeEnds(r: Ray) -> bool { return r.state != RAY_ACTIVE || r.ltot > r.tmax; }
        // ...AND ONE THAT ASKS THE MEDIUM (probeMiddle): an emitter seen from outside, the medium its photon starts in
        fn probeAsksMedium(res: Hit, nrm: VEC3, m: Material2) -> bool {
            let outside = res.s.w >= 0.0 && dot(nrm, -res.r.dir) > 0.0;
            return outside && max(m.emissive.x, max(m.emissive.y, m.emissive.z)) > 0.0;
        }

        /* THE CURRENT TRANSFORM: local frame -> world, for whatever add_new is folding in.
           A primitive is evaluated in its own frame, so its normal is a local direction and
           its distance a local length; the scene builder nests transforms (a group, then an
           object in it) and sets these on the way in and puts them back on the way out.
           Identity unless something sets them, so a hand-written scene that never touches
           them folds exactly as it always did. Private, i.e. per invocation: SDF is called
           several times per ray (the march, the normal's differences) and each call starts
           from the identity because each one restores what it changed. */
        var<private> XF_M: mat3x3<f32> = mat3x3<f32>(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0);
        var<private> XF_S: f32 = 1.0;
        /* ...and the part of XF_S that is not a size: the product of the warp step factors k in force
           (warp() below). XF_S / XF_K is the frame's TRUE scale, which a relief in real millimetres
           needs (builder/codegen.js): under a twist XF_S alone made a relief's bumps 1/k too big. Kept
           right only by scenes that read it -- the builder restores it where it restores XF_S when a
           material has a relief, and resets it at the top of SDF(). */
        var<private> XF_K: f32 = 1.0;

        /* CODE THAT BENDS SPACE SAYS SO. A group's code may change p in ways a transform cannot
           -- a twist, a bend, a mirror -- and then two things the transform made true are not:
             the DISTANCE is no longer a true distance. A stretching warp makes the field steeper
               than 1, and the marcher, trusting it, steps through the surface. k < 1 shrinks
               every distance folded in from here on, so the steps are short enough again;
             the ANALYTIC NORMALS point the wrong way, since they were computed in the warped
               space and XF_M does not know the warp. Zeroing XF_M zeroes every normal folded in
               from here on, and the shade kernel takes one by differences instead -- the same
               fallback a bare sd() distance gets.
           Both are undone where the group's block puts XF_M and XF_S back, so it reaches its
           own children and nothing after them. */
        fn warp(k: f32) {
            XF_S = XF_S * k;
            XF_K = XF_K * k;
            XF_M = mat3x3<f32>();
        }

        /* THE HIT IN ITS OWN OBJECT'S FRAME, for a material that wants to be fixed to the object
           rather than the world (a checker that moves with its object). The Hit that reaches
           shading is read from a buffer, and widening it would cost every bounce of every scene;
           so the local point is NOT carried. It is recovered on demand: localPoint() runs the SDF
           once more at the hit with LOCAL_CAPTURE set, and fold() records the current frame's
           point -- XF_P, which the scene builder keeps up to date only in scenes whose material
           code asks for it -- whenever the surface it is folding wins. XF_SUB is above zero
           inside a CSG child's private Hit, whose winner is not the scene's, so nothing is
           recorded there; the CSG group records its own frame when its combined shape folds in.
           Nothing calls localPoint unless a material does, so every other scene pays one
           never-taken branch per fold. */
        var<private> XF_P: VEC3 = VEC3(0.0);
        var<private> XF_SUB: u32 = 0u;
        var<private> LOCAL_CAPTURE: bool = false;
        var<private> HIT_LOCAL: VEC3 = VEC3(0.0);
        /* AND ITS FRAME: the rotation local -> world (XF_M) of the surface that won, recorded with
           HIT_LOCAL, so a direction written in the object's frame -- the grain of brushed metal,
           materials.js grainAlong -- turns with the object. Zero under a warp (warp() zeroes XF_M),
           which a grain turns into "no grain" rather than a wrong one. XF_M is kept by every
           scene, so unlike XF_P this costs nothing to track. */
        var<private> HIT_FRAME: mat3x3<f32> = mat3x3<f32>(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0);
        /* AND ITS SCALE (XF_S): one local unit in scene units, so a pattern sized in real units --
           a brush streak half a millimetre wide -- stays that size on an object scaled up or
           down. Under a warp XF_S also carries the warp's step factor k, so there it is off by k. */
        var<private> HIT_SCALE: f32 = 1.0;
        /* THE MATERIAL FRAME, where it is not the geometry's: under a group whose code bends space but whose
           materials are laid out straight (the scene builder's straightMaterial -- a 3D print's layers kept
           level while its shape twists). XF_Q is the point as if no warp had moved it, XF_QM and XF_QS that
           frame's rotation to the world and true scale; the builder sets them at such a group and moves them
           with every transform inside it, and gives XF_P the straight point. XF_STRAIGHT says they are in
           force, so a hit records them as its frame and scale: XF_M and XF_S cannot simply take their values,
           since those also carry the normals and the distances. Nothing else reads them, and a scene that
           never sets the flag records what it always did. */
        var<private> XF_Q: VEC3 = VEC3(0.0);
        var<private> XF_QM: mat3x3<f32> = mat3x3<f32>(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0);
        var<private> XF_QS: f32 = 1.0;
        var<private> XF_STRAIGHT: bool = false;

        /* WHICH PART OF THE SCENE THE HIT IS, for picking with the mouse (core/pick.js). XF_TAG is
           the tag of the block being evaluated, set only by a scene compiled for the pick kernel
           (the builder's pickWgsl, which enters and leaves a tag at every node); a scene that never
           sets it picks as tag 0.

           THE DEEPEST SURFACE THROUGH THE POINT, not the scene's winner. The pick kernel evaluates
           the scene once more exactly at the hit, and of every fold made there -- at any depth,
           inside a CSG child's private Hit too -- HIT_TAG keeps the one whose |distance| is
           smallest: the surface that actually passes through the point. Children fold before the
           group that combines them, and a tie keeps the first, so a hard CSG cut names the child
           whose face it is (Block, not Carved) and the host can walk up from there; where a smooth
           blend has made a surface belonging to no single child, the group's own fold is the
           nearest and the group is named. (It was the scene's winner at the top level, which made
           every CSG child unreachable by clicking: the group was all it could ever report.)

           Recorded in the branch fold() already had for the local point, so a render kernel pays
           nothing it did not pay already: LOCAL_CAPTURE is false there and the branch is never
           taken. */
        var<private> XF_TAG: u32 = 0u;
        var<private> HIT_TAG: u32 = 0u;
        var<private> HIT_TAG_D: f32 = 3.0e38;

        /* A transform as the builder declares it (model.js matrixOf): columns 0-2 the rotation
           local -> parent, column 3 (position, uniform scale). */
        fn xfRot(T: mat4x4<f32>) -> mat3x3<f32> { return mat3x3<f32>(T[0].xyz, T[1].xyz, T[2].xyz); }
        /** A parent-frame point in the child's frame: undo the position, the rotation (R is
            orthonormal, so its inverse is its transpose), then the scale. */
        fn xfPoint(p: VEC3, T: mat4x4<f32>) -> VEC3 {
            return (transpose(xfRot(T)) * (p - T[3].xyz)) / T[3].w;
        }

        /* LIGHT SAMPLING TOWARDS LIGHT FACES (PLAN.md L7), the parts the sampler (materials_pbr.js)
           and a face a BSDF sample meets (codegen LIGHTS) must compute alike, or the MIS weights of
           the two would not sum to one. The faces are the scene's -- lightFace, lightFaceTotal,
           lightFacePick (codegen emitLightFaces; none: the stub, uniforms.schema.js) -- and nothing
           here calls lightFace: a face is fetched once by its caller and handed in. Each call of it
           is a switch over every light, which the GPU compiler inlines where it is called. */
        fn lightFaceArea(f: LightFace) -> f32 {
            return select(4.0 * f.half.x * f.half.y, 3.14159265359 * f.half.x * f.half.x, f.shape == 1u);
        }
        /* HOW MUCH OF LIGHT SAMPLING GOES TO FACES at a vertex of the given bounce and tag: none on a
           photon, none on a path whose lights the photons own (CLS_LIGHTS), none at the first surface
           while light photons run -- the photons and the camera share those paths (Ray.ltMis) and a
           third strategy there would need a weight of its own -- and none with no face shown. Not by
           LIGHT_FACES, which only a kernel holding the scene has: a scene without faces has a total of 0,
           so the answer is the same, and shade (no scene since 0.20.8) reads the total from its table. */
        fn lightFaceShare(bounces: u32, tag: u32) -> f32 {
            if (bounces == 0u || (tag & (TAG_PHOTON | CLS_LIGHTS)) != 0u) { return 0.0; }
            if (bounces == 1u && UB.ltLights != 0u) { return 0.0; }
            return select(0.0, FACE_NEE_SHARE, lightFaceTotal() > 0.0);
        }
        /* The density, in solid angle, with which light sampling with that share picks the direction
           to a point of face f dist away, seen at cosY from its normal: the share, the face's pick (its
           weight over tot, lightFaceTotal), one over its area, area to solid angle. */
        fn lightFaceDensity(share: f32, f: LightFace, tot: f32, dist: f32, cosY: f32) -> f32 {
            if (share <= 0.0 || tot <= 0.0 || f.weight <= 0.0) { return 0.0; }
            return share * (f.weight / tot) * dist * dist / max(lightFaceArea(f) * abs(cosY), 1e-20);
        }
        /* BOUNDING-BOX CULLING (the builder's codegen wraps each top-level node of the render copy
           dearer than its box in it -- not one plain shape, since 0.34.0: codegen.js ONLY THE DEAR
           ONES). The distance from q, a point in the node's own frame, to the node's box lo..hi in
           that frame -- a lower bound on the distance to anything inside the box, so a node farther
           than cullMargin() contributes that bound instead of being evaluated. -1 (evaluate it) when
           the box is not known (lo.w == 0: not measured yet, measured for parameters that have since
           changed, or unbounded). CULLING OFF IS NOT A TEST HERE since 0.29.0: a scene made without
           its boxes (codegen.js emitScene's cull, the bench's alone since 0.34.0) calls none of this
           -- it was the uniform cull, tested at every box of every step. */
        fn cullDist(q: VEC3, lo: vec4<f32>, hi: vec4<f32>) -> FLOAT {
            if (lo.w == 0.0) { return -1.0; }
            let d = abs(q - 0.5 * (lo.xyz + hi.xyz)) - 0.5 * (hi.xyz - lo.xyz);
            return length(max(d, VEC3(0.0))) + min(max(d.x, max(d.y, d.z)), 0.0);
        }
        /* HOW NEAR A BOX BEFORE ITS NODE IS EVALUATED: the leaving offset, ten surface tolerances. A
           culled node's bound is always above it, so the march never takes a box for a surface
           (its hit test is one tolerance) and a ray leaving a surface never starts inside a skip. */
        fn cullMargin() -> FLOAT { return offsetEps(); }

${fold}
        /* A RELIEF'S DISTANCE INTO THE HIT: d the distance with the relief's height already taken off, slope
           the bound on how much that steepened the field (the scene builder's reliefs -- a material's, codegen
           object(); the noise relief and displace modifiers', modifiers.js). Divided by the slope here, a safe
           distance again -- unless a CSG group above blends it (deferred). Divided inside a blend, the fillet
           comes out wrong: smin(x/c, y/c, k) is smin(x, y, k c) / c. So there it goes in undivided, its slope kept
           in XF_RL, and the outermost group of that CSG chain divides its combined result by the steepest -- once
           (codegen saves, resets and restores XF_RL there, so nested chains keep their own).
             DEFERRED, A CAPTURE ALSO SEES IT AT ITS OWN SLOPE, for the tag alone: undivided, the group's divided
           distance would always be the nearer, and a click on the relief (or the box measured from the tags,
           field.js) would find the group. Only under LOCAL_CAPTURE, so a render pays nothing for it. */
        var<private> XF_RL: f32 = 1.0;
        /* A NORMAL'S LOOK (0.71.1): set by the engine around the SDF calls a normal by differences makes (the surface
           kernel, calcNormals_fast, the pick), and read by a chain's outermost group, which then leaves its result
           UNDIVIDED. XF_RL is the steepest slope of the reliefs within their bands at that point, and a relief beyond
           its band adds none: where a gentle relief's surface (white plaster, 1.11) passes the band's edge of a steep
           one it is cut by (knockdown stucco, 4.67), the division jumped fourfold, and a difference across the jump
           turned the normal by up to 86 degrees (relief.test.mjs's mirror; builder/test/reliefnormal.gpu.mjs on Dawn)
           -- a hard line drawn round the cut, farther out the larger the blend (the user, 2026-10-20). A normal reads
           only the field's direction, which the division is not needed for: it is there so the march does not step
           through a bump. Only a group with no code at or above it reads this (codegen.js children()): code reads the
           value off the surface (a round's offset), and there the division is part of the shape. A flag, no length:
           the engine may set it (unitlint.js). */
        var<private> NORMAL_LOOK: bool = false;
        fn foldRelief(C: Hit, d: f32, m: u32, slope: f32, deferred: bool) -> Hit {
            if (!deferred) { return fold(C, VEC4(0.0, 0.0, 0.0, d / slope), m); }
            XF_RL = max(XF_RL, slope);
            if (LOCAL_CAPTURE) { _ = fold(C, VEC4(0.0, 0.0, 0.0, d / slope), m); }
            return fold(C, VEC4(0.0, 0.0, 0.0, d), m);
        }

        /* CSG ON (normal, distance), with k the blend: 0 is a hard op, > 0 a polynomial smooth
           one. Not sdf.js's NopSmooth* for two reasons. Those divide by k, so a hard op --
           k = 0 -- is a NaN. And they normalize the blended normal, while most primitives
           (sdBox and every sd() one) return NO normal, a zero vector: normalize(0) is a NaN,
           which fails add_new's backface test and silently deletes the surface.

           A BLENDED NORMAL NEEDS BOTH NORMALS. The gradient of the smooth min is exactly
           mix(grad a, grad b, t), so with two analytic normals the mix is right. With one --
           a sphere scooped out of a box, which has none -- mix(0, nb, t) normalizes to nb for
           any t > 0, and the whole blend zone was shaded with the sphere's normal while the
           surface itself had the blended shape: the fillet looked warped, and no step size
           could fix it because the distances were never wrong. So a missing normal on either
           side means no normal for the result, and the renderer takes one by differences of
           the blended field, which is exact whatever the primitives provide. */
        fn csgNormal(a: VEC3, b: VEC3, t: f32) -> VEC3 {
            if (dot(a, a) < 1e-12 || dot(b, b) < 1e-12) { return VEC3(0.0); }
            let n = mix(a, b, t);
            let l = length(n);
            return select(VEC3(0.0), n / l, l > 1e-12);
        }
        fn csgUnion(a: VEC4, b: VEC4, k: f32) -> VEC4 {
            if (k <= 0.0) { return select(b, a, a.w < b.w); }
            let h = max(k - abs(a.w - b.w), 0.0);
            let m = select(1.0, 0.0, a.w < b.w);          // 0 when a is nearer
            let t = m + (1.0 - 2.0 * m) * 0.5 * h / k;     // weight of b in the normal
            return VEC4(csgNormal(a.xyz, b.xyz, t), min(a.w, b.w) - h * h * 0.25 / k);
        }
        fn csgIntersect(a: VEC4, b: VEC4, k: f32) -> VEC4 {
            if (k <= 0.0) { return select(b, a, a.w > b.w); }
            let h = max(k - abs(a.w - b.w), 0.0);
            let m = select(1.0, 0.0, a.w > b.w);          // 0 when a is farther
            let t = m + (1.0 - 2.0 * m) * 0.5 * h / k;
            return VEC4(csgNormal(a.xyz, b.xyz, t), max(a.w, b.w) + h * h * 0.25 / k);
        }
        /** a minus b: inside a and outside b. */
        fn csgSubtract(a: VEC4, b: VEC4, k: f32) -> VEC4 { return csgIntersect(a, -b, k); }
`
export const SCENE_API = sceneApiWGSL(FOLD_FULL)

/* THE LOCAL POINT, TWO WAYS (getMaterial2 asks for it, scene_api.js above says why). LOOKED UP: localPoint runs the
   SDF once more at the point, capturing -- every kernel but two. GIVEN: the shade and occlusion kernels capture it on
   a trip of their own one SDF call (wavefront.js) and localPoint returns what they captured; asked before that, it
   says so (LOCAL_WANTED) and the kernel captures and asks the material again. Every call of the SDF is a whole copy
   of the scene once the compiler inlines it, and getMaterial2's own was one in each of shade's two getMaterial2 sites
   and occlusion's: on the optics bench shade held the scene four times and occlusion twice (bench/test/copies.test). */
const LOCAL_CAPTURE_BEGIN = /* wgsl */ `
            LOCAL_CAPTURE = true;
            HIT_LOCAL = r.pos;                 // what a scene that tracks no frames will get
            /* ...and what fold() records for it: fold copies XF_P whenever a surface wins, and a
               scene that tracks no frames never sets XF_P, so without this every hit of a
               hand-written scene was "at" the origin, not at r.pos as promised above. The builder
               sets XF_P = p itself at the top of SDF, so for its scenes this changes nothing. */
            XF_P = r.pos;
            HIT_FRAME = mat3x3<f32>(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0);
            HIT_SCALE = 1.0;`
export const LOCAL_POINT_LOOKED = /* wgsl */ `
        fn localPoint(r: Ray) -> VEC3 {${LOCAL_CAPTURE_BEGIN}
            _ = SDF(r);
            LOCAL_CAPTURE = false;
            return HIT_LOCAL;
        }
`
export const LOCAL_POINT_GIVEN = /* wgsl */ `
        var<private> LOCAL_READY: bool = false;     // the kernel captured the point its material is asked about
        var<private> LOCAL_WANTED: bool = false;    // a material asked for it before it was
        fn localPoint(r: Ray) -> VEC3 {
            if (!LOCAL_READY) { LOCAL_WANTED = true; }
            return HIT_LOCAL;
        }
        // around the kernel's one SDF call, on the trip that captures: localPoint's own steps, before and after
        fn localCaptureBegin(r: Ray) {${LOCAL_CAPTURE_BEGIN}
        }
        fn localCaptureEnd() { LOCAL_CAPTURE = false; LOCAL_READY = true; }
`

/*======================================================================================================================
  THE BOUNDARY (0.36.0): where the engine meets the scene, and the only place it does. The ENGINE's world is in engine
  units -- its rays, hits, tolerances, camera, lights and caches -- and the SCENE CONTRACT is in the scene's own: its
  SDF, getMaterial2 and light faces, and everything a scene's text calls (metres, mm, marchEps, offsetEps, cullMargin,
  XF_*, SCN_*, HIT_*, localPoint). So the builder's code, the golden shaders and every saved scene mean what they meant,
  and every length the engine uses is in one unit. lib/pathtracer/PRECISION.md says why; core/unitlint.js checks, for
  every kernel and every scene, that no engine function calls the scene's side but through these.
  ONE SDF CALL AND ONE getMaterial2 CALL, as the kernels had: each call site is a whole copy of the scene once inlined
  (bench/test/copies.test.mjs), so a capture is an argument of sceneAt, not a second function.
  WHAT IS A LENGTH, of what crosses: a Ray's pos, ltot, tmax, vtxLtot and absLtot (RAY_LENGTHS below); a Hit's distance s.w and
  insideW (but not its "inside nothing", -1e7); a light face's centre and half sizes. NOT: directions, the normal, radiance, pdfs,
  tags, n -- and Ray.ltMis, m^2/lm carried from the camera's first surface, which the scene multiplies by a luminance
  (codegen.js LIGHTS): a ratio of the engine's own lengths, the same in any unit the engine is consistent in.
  Material2 holds one length, attenuationDistance (0.37.0; materials.js), converted in materialAt. A Ray's medium
  absorption (muR, muG, muB) is per engine length and the scene never reads it: not converted, and classed not a length.
  Engine units per scene unit: engPerScene() (EPS_WGSL, tracebasics.js).
======================================================================================================================*/
/** The fields of struct Ray (tracebasics.js) that are lengths, which the boundary converts -- and those that are not.
 *  unitlint.js checks the struct has exactly these, so a field added to the Ray fails it until it is put in one. */
export const RAY_LENGTHS = Object.freeze(['pos', 'ltot', 'tmax', 'vtxLtot', 'absLtot'])
export const RAY_NOT_LENGTHS = Object.freeze(['dir', 'radiance', 'beta', 'counts', 'n', 'bounces', 'state', 'pix', 'sunmis', 'tag',
    'prevPdf', 'ltMis', 'muR', 'muG', 'muB'])
export const HIT_LENGTHS = Object.freeze(['s.w', 'insideW'])
export const HIT_NOT_LENGTHS = Object.freeze(['r', 's.xyz', 'm', 'a'])
const boundaryWGSL = given => /* wgsl */ `
        fn rayToScene(r: Ray) -> Ray {
            let k = scenePerEng();
            var s = r;
            ${RAY_LENGTHS.map(f => `s.${f} = r.${f} * k;`).join(' ')}
            return s;
        }
        /* insideW's "inside nothing" (emptyHit's -1e7, tested "> -1e6": core/field.js) kept as it is */
        fn insideScaled(w: FLOAT, k: FLOAT) -> FLOAT { return select(w, w * k, w > -1.0e6); }
        fn hitToScene(h: Hit) -> Hit {
            let k = scenePerEng();
            var s = h;
            s.r = rayToScene(h.r);
            s.s.w = h.s.w * k;
            s.insideW = insideScaled(h.insideW, k);
            return s;
        }
        ${given ? '' : `// the local point's capture, as localCaptureBegin is where it is given (LOCAL_POINT_GIVEN)
        fn boundaryCapture(r: Ray) {${LOCAL_CAPTURE_BEGIN}
        }`}
        /* THE SCENE AT r (an engine ray): its Hit, the distances in engine units and the engine's own ray in it. capture:
           the local point and the pick's tag recorded on this call (fold, LOCAL_CAPTURE). The scene's tolerance is the
           engine's at r.pos for the call (SCN_TOL, EPS_WGSL). */
        fn sceneAt(r: Ray, capture: bool) -> Hit {
            let rs = rayToScene(r);
            SCN_TOL = marchTol(r.pos) * scenePerEng();
            if (capture) { ${given ? 'localCaptureBegin(rs);' : 'boundaryCapture(rs);'} }
            var h = SDF(rs);
            if (capture) { ${given ? 'localCaptureEnd();' : 'LOCAL_CAPTURE = false;'} }
            SCN_TOL = 0.0;
            let k = engPerScene();
            h.r = r;
            h.s.w = h.s.w * k;
            h.insideW = insideScaled(h.insideW, k);
            return h;
        }
        // THE MATERIAL of an engine hit: the scene asked about the hit in its own units
        fn materialAt(h: Hit, inside: bool) -> Material2 {
            SCN_TOL = marchTol(h.r.pos) * scenePerEng();
            var m = getMaterial2(hitToScene(h), inside);
            SCN_TOL = 0.0;
            m.attenuationDistance = m.attenuationDistance * engPerScene();    // its one length (materials.js)
            return m;
        }
        // A LIGHT'S FACE in engine units: its centre and half sizes (the rest are directions, a radiance, ratios)
        fn lightFaceAt(i: u32) -> LightFace {
            var f = lightFace(i);
            let k = engPerScene();
            f.centre = f.centre * k;
            f.half = f.half * k;
            return f;
        }
        // THE PICK'S TAG: which part of the scene the surface at a capturing sceneAt is (fold, HIT_TAG)
        fn tagCaptureBegin() { HIT_TAG = 0u; HIT_TAG_D = 3.0e38; }
        fn tagCaptureEnd() -> u32 { return HIT_TAG; }
`
export const SCENE_BOUNDARY = boundaryWGSL(false)
export const SCENE_BOUNDARY_GIVEN = boundaryWGSL(true)

/** Everything a scene's WGSL is compiled after, in the order every geometry kernel uses. NOISE is in
 *  it so the SDF (a displacement) and the materials (a pattern) both have it (noise.js). */
export const SCENE_PRELUDE = `${PRIMITIVES};${DEFINITIONS}${NOISE}${MATERIALS}${SCENE_API}${LOCAL_POINT_LOOKED}${SCENE_BOUNDARY}`
/** ...for the renderer's march (0.next): the scene asked for its distance alone (FOLD_DIST above) */
export const SCENE_PRELUDE_DIST = `${PRIMITIVES};${DEFINITIONS}${NOISE}${MATERIALS}${sceneApiWGSL(FOLD_DIST)}${LOCAL_POINT_LOOKED}${SCENE_BOUNDARY}`
/** ...for the two kernels that capture the local point on a trip of their own SDF call (surface, occlusion) */
export const SCENE_PRELUDE_GIVEN = `${PRIMITIVES};${DEFINITIONS}${NOISE}${MATERIALS}${SCENE_API}${LOCAL_POINT_GIVEN}${SCENE_BOUNDARY_GIVEN}`
/** ...and what shade compiles instead, holding no scene (0.20.8): the same text with no localPoint, which names the
 *  scene's SDF. The same for every scene, so a scene change finds shade in the pipeline cache. */
export const SHADE_PRELUDE = `${PRIMITIVES};${DEFINITIONS}${NOISE}${MATERIALS}${SCENE_API}`

/** WHETHER A NORMAL BY DIFFERENCES LOOKS AT THE HIT TOO (0.71.1), for a kernel that takes one after the scene's `text`:
 *  where a chain's outermost group reads NORMAL_LOOK (SCENE_API above), a normal's looks are undivided while the hit's
 *  own value, from the march, was divided, so the differences' base is looked at as they are. One SDF look more a hit in
 *  such a scene, none in any other. Read from the text the kernel compiles, as LIGHT_FACES is (uniforms.schema.js), so
 *  the two cannot disagree: a scene reading the flag with this false would difference a divided base against
 *  undivided looks on every surface of the group. */
export const normalAtHitWGSL = text => `const NORMAL_AT_HIT: bool = ${/\bNORMAL_LOOK\b/.test(text ?? '')};\n`
