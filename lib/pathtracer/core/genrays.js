import { DEFINITIONS } from './tracebasics.js'
import { ComputeUniformTypes } from './uniforms.schema.js'
import { LENS_WGSL } from './lens.js'

// fills the raybuffer with rays from the cam position

/* THE BASE UNIFORMS ONLY, not the scene's. Ray generation has no interest in geometry, and nor
   have resolve, genphotons and emit_collect (wavefront.js), but all four used to declare the
   scene's own uniforms (computeUniformTypes(scene.uniforms)) because R.trace handed every kernel
   the whole bag and tinywebgpu rejects a name its schema does not declare. So their text changed
   with every scene, and with every edit that changed the scene's uniform list, and each was
   compiled again for a uniform none of them reads. Declared from ComputeUniformTypes alone, the
   text is the same whatever the scene, so a scene change finds them in tinywebgpu's pipeline
   cache; check-shaders pass two holds the four to one text across every scene it builds. The
   rejection stays (a typo is otherwise a value that never reaches the shader), so the callers
   filter instead: R.trace hands these four only the base names (raytrace_main.js
   forCompute). `scene` stays a parameter so that no caller changes. */
/* THE RAYGEN TILE GRID, in one place because what trace() hands the kernel and what the tests
   expect it to (core/test/build.test.mjs) must agree. (The convergence test page, which exercised
   this path without a scene in the way, was its third user until 0.22.6.)

   ROUNDED, NOT FLOORED. This was floor(sqrt(N * w/h)), which for N = w*h is floor(sqrt(w*w))
   -- except that N * (w/h) is computed in floating point and lands a hair under w*w for about
   one window size in forty (656 of 24768 sizes tried). Then tilesX = w-1, the tiles are
   1/(w-1) wide, every column drifts a little further off the pixel grid, and pixels get 0, 1
   or 2 rays per sample instead of exactly one. Not wrong -- the jitter still covers every
   pixel -- but the per-pixel sample count then depends on the window size, which is a
   variable nobody would think to control for when comparing noise. Rounded, a 1-spp render
   gets exactly one tile per pixel. */
export const raygenTiles = (N, w, h) => {
    const tilesX = Math.max(1, Math.round(Math.sqrt(N * (w / Math.max(1, h)))));
    const tilesY = Math.max(1, Math.ceil(N / tilesX));
    return { tilesX, tilesY, invTilesX: 1.0 / tilesX, invTilesY: 1.0 / tilesY };
};

export let genrays_prog = async (WG, wgsize, scene = {}) => await WG.makeCompute(`${DEFINITIONS}${LENS_WGSL}`,
            /*wgsl*/`
            let rayindex:u32= gid.x;                           // gid.y and z are 0, 1D array

            /* ONE BATCH OF THE SAMPLE'S CAMERA RAYS (core/photons.js planBatches): rayBatch of them, written from the
               buffer's start, the tile of each its index in the whole sample -- rayFirst on. One batch (rayFirst 0,
               rayBatch the whole raycount) is the sample as it always was. Each batch has a seed of its own. */
            if (rayindex >= UB.rayBatch) { return; }           // guard against overdispatch
            SEED_uvec4(UB.seed) ; SEED_u32(rayindex);           // initialize random seed
            let tile = UB.rayFirst + rayindex;

            let fres  = VEC2(UB.res);                           // framebuffer resolution
            let tilesX: u32 = max(1u, UB.tilesX);
            let tilesY: u32 = max(1u, UB.tilesY);
            let invTX: f32 = UB.invTilesX;                      // precomputed 1.0/tilesX
            let invTY: f32 = UB.invTilesY;                      // precomputed 1.0/tilesY

            var cellxy = vec2<u32>(tile % tilesX, tile / tilesX);

            // base uv from cell center
            let uv0 = (VEC2(cellxy) + VEC2(0.5, 0.5)) * VEC2(invTX, invTY);
            let rnd = PRNG();                                   // xy the jitter, zw the lens point
            let jitter = (rnd.xy - VEC2(0.5)) * VEC2(invTX, invTY);
            let uv = clamp(uv0 + jitter, VEC2(0.0), VEC2(1.0));
           
            let xy = uv * 2.0 - VEC2(1.0);

            // Stable method only
            // camtype: 0 = perspective, 1 = orthographic
            let isPersp = (UB.camtype == 0u);
            var origin: VEC3;
            var dir: VEC3;
            let camPos = UB.camPos.xyz;
            // Camera basis from invView columns
            let right = UB.invView[0].xyz;
            let up    = UB.invView[1].xyz;
            let fwd   = UB.invView[2].xyz;          // points from target->pos; scene-forward is -fwd
            let fx = UB.invProjection[0][0];        // = a*tan(fov/2) or halfwidth for ortho
            let fy = UB.invProjection[1][1];        // = tan(fov/2) or halfheight for ortho
            if (isPersp) {
                // Basis-based perspective ray: origin=camPos, dir from basis and invProjection diagonals               
                let dirCam = VEC3(xy.x * fx, xy.y * fy, -1.0);
                dir = normalize(right * dirCam.x + up * dirCam.y + fwd * dirCam.z);
                origin = camPos;
                /* THROUGH THE LENS (0.43.0; lens.js): from a point of its disc, at the point the pinhole's ray meets
                   the focus plane. A radius of 0 is the pinhole's ray itself, as it was. */
                let R = UB.camLens.x;
                if (R > 0.0) {
                    let off = lensDisc(right, up, R, rnd.zw);
                    origin = camPos + off;
                    dir = normalize((right * dirCam.x + up * dirCam.y + fwd * dirCam.z) * UB.camLens.y - off);
                }
            } else {
                // Orthographic: per-pixel origin on near plane using half-extents from invProjection diagonals                
                origin = camPos + right * (xy.x * fx) + up * (xy.y * fy);
                dir = -fwd; // already unit length
            }

            var ray = newRay(origin, dir, VEC4(1.0), 1.0);
            let p = vec2<u32>(clamp(uv * fres, VEC2(0.0), fres - VEC2(1.0)));
            ray.pix = p.x + p.y * u32(UB.res.x);           
            rayBuffer0[rayindex] = ray;            
            `,
    ComputeUniformTypes,
    { rayBuffer0: 'array<Ray>' }
    /* Off-thread too, though this one does NOT inline the scene, nor now declare its uniforms
       (the note above). It is async because it is the last non-trivial synchronous compile
       left on this path, and with the builder's Promise.all that costs nothing. The kernels it
       genuinely matters for are prog_march, prog_shade and prog_occlude; the reasoning is
       written out on prog_march. */
    , { async: true, wg: [wgsize, 1, 1] }
);

/* THE KERNEL ABOVE, RUN BACKWARDS: where on screen a world point is. For anything the host draws
   over the picture -- the scene builder's bounding box and, later, its handles -- which has to
   land on the pixel the traced surface did, or the box and the object drift apart as the camera
   moves.

   READ OFF THE KERNEL, NOT OFF THE MATRICES. The camera's invProjection is a real inverse
   projection for perspective, but the kernel never multiplies by it: it takes the basis from
   invView's columns and only the two diagonal entries fx, fy from invProjection, and builds
   dir = right*x*fx + up*y*fy - fwd. Inverting that exact construction is the only way to be
   right for what the kernel does rather than for what the matrices would do; if the kernel's
   ray construction changes, this has to change with it.
   THE LENS (0.43.0) leaves this the pinhole's on purpose: every ray of a pixel crosses the pinhole's ray at the
   focus plane, so the host's overlays are drawn where the picture is sharp, and blurred elsewhere as it is.

   @param P       [x, y, z] in world space
   @param U       the camera's getUniforms(): invView, invProjection, camPos
   @param camtype 0 perspective, 1 orthographic (as UB.camtype)
   @returns { x, y, depth } -- x, y in the kernel's [-1, 1] (y up, as its uv), depth the distance
            ahead of the camera along the view axis. depth <= 0 is behind the camera, where x and
            y mean nothing: a caller drawing a line must clip it first (clipToView). */
export function projectPoint(P, U, camtype = 0) {
    const V = U.invView, I = U.invProjection, c = U.camPos
    const d = [P[0] - c[0], P[1] - c[1], P[2] - c[2]]
    const a = d[0] * V[0] + d[1] * V[1] + d[2] * V[2]          // along right  (column 0)
    const b = d[0] * V[4] + d[1] * V[5] + d[2] * V[6]          // along up     (column 1)
    const depth = -(d[0] * V[8] + d[1] * V[9] + d[2] * V[10])  // ahead: the kernel looks down -fwd
    const fx = I[0], fy = I[5]                                   // invProjection[0][0], [1][1]
    if (camtype === 1) return { x: a / fx, y: b / fy, depth }   // orthographic: no division by depth
    return { x: a / (depth * fx), y: b / (depth * fy), depth }
}

/* A SEGMENT CUT TO THE PART IN FRONT OF THE CAMERA, in world space, or null if none of it is.
   Projecting an endpoint behind a perspective camera divides by a negative depth and puts it on
   the wrong side of the screen, so a box edge running past the camera would be drawn as a line
   across the whole picture. `near` is a depth, as projectPoint reports it. */
export function clipToView(A, B, U, camtype = 0, near = 1e-3) {
    const da = projectPoint(A, U, camtype).depth, db = projectPoint(B, U, camtype).depth
    if (da < near && db < near) return null
    if (da >= near && db >= near) return [A, B]
    const t = (near - da) / (db - da)
    const M = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]
    return da < near ? [M, B] : [A, M]
}

/* THE KERNEL'S RAY THROUGH A POINT OF THE PICTURE, on the CPU: what the mouse is pointing at.
   The same construction as the kernel above, without the jitter -- x, y in its [-1, 1], y up --
   so a handle dragged along it stays under the pointer. projectPoint is its inverse, and
   bounds.test.mjs checks the pair against a transcription of the kernel.
   @returns { o, d } in world space, d of unit length */
export function rayThrough(x, y, U, camtype = 0) {
    const V = U.invView, fx = U.invProjection[0], fy = U.invProjection[5], c = U.camPos
    const right = [V[0], V[1], V[2]], up = [V[4], V[5], V[6]], fwd = [V[8], V[9], V[10]]
    if (camtype === 1) return {
        o: [0, 1, 2].map(k => c[k] + right[k] * x * fx + up[k] * y * fy),
        d: fwd.map(v => -v),
    }
    const d = [0, 1, 2].map(k => right[k] * x * fx + up[k] * y * fy - fwd[k])
    const l = Math.hypot(d[0], d[1], d[2]) || 1
    return { o: [c[0], c[1], c[2]], d: d.map(v => v / l) }
}
