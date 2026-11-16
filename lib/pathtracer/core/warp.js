//======================================================================================================================
// A RAY WARP (0.next): a region of the scene in which the march does what the scene's own code says, not a straight step.
//
// WHY. The user (2026-11-15), for art and not for physics: "an object with no ordinary material in which another function
// is used for ray marching ... a code block with the normal raymarch step in it that users can change", to twist rays and
// make other strange artefacts, and to change the other things a ray carries -- its colour, where it is, whether it goes
// on -- depending on parameters or on where it is.
//
// WHAT IT IS. The builder's object with a warp (builder/warp.js, model version 30): its own code is the REGION, an
// ordinary SDF; its warp code is run at every march step a ray takes inside that region and may change the ray's
// direction, move it elsewhere, tint what it carries, add light along it and stop it. The scene's text has one function
// for all of it, sceneWarp (codegen.js THE RAY WARPS), in the scene's units; this file is the engine's side: the boundary
// call (warpAt, in the scene_api.js sense: lengths converted here and nowhere else) and the lines the march runs
// (WARP_MARCH_WGSL, wavefront.js prog_march), compiled only for a scene with one (scene.warp), so every other scene's
// march is the text it was.
//
// WHY A STEP CANNOT GO THROUGH A SURFACE (reasoned, not measured). The distance the scene gives is the radius of a ball
// around the ray holding no surface; ANY path no longer than it stays in that ball, straight or bent. So the march keeps
// the step the scene allows -- or less: sceneWarp shortens it to the warp's `step` inside a region, so a curve is followed
// in small pieces, and outside to just past the region's surface, so a warp starts where its region does -- and the code
// changes only the direction the step is taken in. A ray MOVED (`pos`) is not stepped on that iteration: where it lands,
// the next step asks the scene there.
//
// WHAT IS LEFT STRAIGHT, said once here and in Help > Ray warps. Light sampling's shadow rays (prog_occlude) pass through a
// region as if it were not there: a warp casts no shadow, and a tinted one no tinted shadow. A path the warp bent or moved
// no longer has the density light sampling would have given it, so what it meets afterwards counts in full (prevPdf -1,
// sunmis 1), as after a collision in a medium (haze.js mediumCollide) -- light a bent path finds by chance comes on top of
// what the straight shadow ray found, which is no physics, and rare (the light's solid angle).
//
// WHOSE LIGHT A WARPED PATH IS (0.next; the user, 2026-11-16: under a lamp, with no sun or studio, the warp was not seen
// from the camera at all -- only in the light it bent onto a diffuse floor; under the sun it bent the picture behind it).
// Read in code: while the lights' photons run (UB.ltLights), the first surface a camera path meets takes no light sampling
// towards a light's face (scene_api.js lightFaceShare); the photons bring that light, each connecting to the camera by a
// STRAIGHT shadow ray (TAG_CONN), and the camera path shares the face it meets next with them by MIS (Ray.ltMis,
// CLS_LIGHTS). So a lamp-lit surface behind a warp reached the picture by straight lines around it. Now a camera ray a warp
// acts on before its first surface is marked (TAG_WARPED, tracebasics.js) and keeps that surface's light -- light sampling
// towards the faces, the face met next its own whole, no light tracer's class (CLS_CAND) -- and a connection to the camera
// that would enter a warp's region is refused (warpBlocks, the occlusion kernel): the straight line it stands for is not
// the path a camera ray takes there. A path a warp acts on only past its first surface keeps its sharing with the photons,
// whose own walk the warp bends too -- right for a reversible warp, not exactly for a twist. A warp need not be reversible -- a twist is not: a ray walked backwards along a twisted path
// turns the other way -- so photons (which also march here) and camera paths may disagree about the caustics through one;
// for art, not physics, that is allowed. The step cache's balls step straight: a ray uses one only where it does not
// reach a warp's region (warpClear). Probes (TAG_PROBE, a line looking for an emitter) are never warped. A haze box's or a
// scattering material's collision is drawn for a leg as if it were straight (haze.js hazeDraw, mediumDraw) and found where
// the ray has gone that far: through a warp, where the bent path has, which is close to the straight leg's and not it.
//
// COLOUR AND LIGHT BY LENGTH. A tint is per unit of length in the warp's own frame (pow(tint, ds)) and a glow per unit of
// length (glow ds), so the picture does not change with the step: a finer `step` follows a curve more closely and leaves
// the colour as it was. Glow is light added to a camera path, through what the path carries (beta); a photon's light is
// the lamp's, so it gets none, nor does the illuminance view (measureMode 1), which measures what reaches a surface.
//======================================================================================================================

/** The bits sceneWarp sets in WarpIO.flags (codegen.js THE RAY WARPS writes them as these numbers) */
export const WARP_FLAGS = Object.freeze({ IN: 1, MOVED: 2, STOPPED: 4 })

/** THE BOUNDARY: the ray in the engine's units in, the warp's answer in them back -- the one place the two meet, as
 *  sceneAt is (scene_api.js SCENE_BOUNDARY). Compiled after the scene's text, which defines WarpIO and sceneWarp. */
export const WARP_BOUNDARY = /*wgsl*/`
        struct WarpStep { pos: vec3<f32>, dir: vec3<f32>, mult: vec3<f32>, add: vec3<f32>, step: f32, flags: u32 }
        /* ...what the warps make of a march step of length d from where the ray is (core/warp.js) */
        fn warpAt(r: Ray, d: FLOAT, seed: u32) -> WarpStep {
            let k = scenePerEng();
            var w: WarpIO;
            w.pos = r.pos * k;
            w.dir = r.dir;
            w.mult = vec3<f32>(1.0);
            w.add = vec3<f32>(0.0);
            w.step = d * k;
            w.ltot = r.ltot * k;
            w.tol = marchTol(r.pos) * k;
            w.bounces = r.bounces;
            w.photon = select(0u, 1u, (r.tag & TAG_PHOTON) != 0u);
            w.seed = seed;
            w.flags = 0u;
            let o = sceneWarp(w);
            let e = engPerScene();
            return WarpStep(o.pos * e, o.dir, o.mult, o.add, o.step * e, o.flags);
        }
        /* ...and whether a straight step of length d from where the ray is stays clear of every warp's region (the step
           cache's balls, which move a ray with no scene asked) */
        fn warpClear(r: Ray, d: FLOAT) -> bool {
            return sceneWarpDist(r.pos * scenePerEng()) * engPerScene() > d;
        }
        /* ...and how far the nearest region is, in the engine's units: negative inside one (the occlusion kernel's
           warpBlocks) */
        fn warpDistAt(r: Ray) -> FLOAT {
            return sceneWarpDist(r.pos * scenePerEng()) * engPerScene();
        }
`

/** THE OCCLUSION KERNEL'S LINES (wavefront.js prog_occlude, a scene with a warp), before the scene is asked at a step: a
 *  connection to the camera (TAG_CONN) that would enter a warp's region is refused (WHOSE LIGHT A WARPED PATH IS, above),
 *  and its step is held to just past the nearest region, so it cannot step over one. Every other shadow ray passes
 *  straight through, as it always did. */
export const WARP_OCCLUDE_WGSL = /*wgsl*/`
                var warpCap = 1.0e30;
                if (isConn) {
                    let wd = warpDistAt(ray);
                    if (wd < 0.0) { warped = true; break; }
                    warpCap = wd + marchTol(ray.pos);
                }
`

/** THE MARCH'S LINES, after the step `d` is known and before the ray moves by it (wavefront.js prog_march). `glow` false
 *  for the optics trace, whose rays carry power, not a camera's light. */
export const warpMarchWGSL = ({ glow = true } = {}) => /*wgsl*/`
                /* A RAY WARP (core/warp.js): inside a warp's region its code decides where this step goes, what it tints,
                   what light it adds and whether the ray stops; outside, the step ends just past the region's surface */
                if ((ray.tag & TAG_PROBE) == 0u) {
                    let wo = warpAt(ray, d, u32(PRNG().x * 4294967040.0));
                    d = wo.step;
                    if ((wo.flags & ${WARP_FLAGS.IN}u) != 0u) {
                        let bent = any(wo.dir != ray.dir) || (wo.flags & ${WARP_FLAGS.MOVED}u) != 0u;
                        // a camera ray before its first surface: that surface's light is its own (WHOSE LIGHT, above)
                        if ((ray.tag & TAG_PHOTON) == 0u && ray.bounces == 0u) { ray.tag = ray.tag | TAG_WARPED; }
                        if (bent) {
                            ray.prevPdf = -1.0;             // light sampling could not have made this path
                            ray.sunmis = 1.0;
                            if (ray.ltMis < LT_FACELESS + 0.5) { ray.ltMis = -1.0; }   // not the lens's any more (lens.js)
                        }${glow ? `
                        if ((ray.tag & TAG_PHOTON) == 0u && UB.measureMode != 1u) { ray.radiance += ray.beta * wo.add; }` : ''}
                        ray.beta = ray.beta * wo.mult;
                        ray.dir = wo.dir;
                        if ((wo.flags & ${WARP_FLAGS.MOVED}u) != 0u) { ray.pos = wo.pos; d = 0.0; }
                        if ((wo.flags & ${WARP_FLAGS.STOPPED}u) != 0u) {
                            /* STOPPED: what it gathered goes to the picture, as a ray out of steps does (shade's end) */
                            hit.r = ray;
                            hit.r.state = RAY_MAXITER;
                            var wpos = atomicAdd(&counters.shadeCount, 1u);
                            shadeBuffer[wpos].hit = hit;
                            return;
                        }
                    }
                }
`
