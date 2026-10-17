//======================================================================================================================
// FIELD -- the scene's distance field and its surface colour, sampled at many points, for an export to
// a mesh (the builder's 3MF / STL export, builder/exportbox.js).
//
// THE GPU IS THE ONLY THING THAT CAN EVALUATE A SCENE. Every builder object is WGSL the user typed
// (primitives.js), so there is no JavaScript copy of the field to sample; this kernel compiles the
// scene the way the pick kernel does (core/pick.js) and evaluates it at points the host lays out.
// Compiled on first use and kept per scene, like the pick: a session that never exports never
// builds it.
//
// TWO MODES, one kernel -- each copy inlines the whole scene, and a compile is seconds:
//   GRID    point i of a lattice: origin + ix*ax + iy*ay + iz*az (i = ix + nx*(iy + ny*iz)), one f32
//           out per point, the SIGNED FIELD: < 0 inside anything, > 0 outside.
//   POINTS  the points the host lists after the header, four f32 out per point: the surface colour
//           there (linear RGB) and the material id, as f32.
//
// WHICH NUMBER IS "THE FIELD" is not obvious, because SDF() does not return one. Its Hit carries the
// nearest surface in either direction (s) and, separately, the least-deep thing the point is inside
// (insideW; scene_api.js fold). For a union of overlapping objects the nearest surface can be one
// the point is INSIDE another object behind -- s.w > 0 while the point is solid -- so s.w alone
// would put holes wherever two objects overlap. The sign comes from insideW: inside anything is
// negative. Outside everything, s.w is the true distance to the nearest surface. Inside, insideW is
// the distance to the surface of the object the point is least deep in, which near the outer
// boundary is that boundary -- the only place the mesher reads the magnitude (it interpolates only
// across a change of sign).
//
// THE BACKFACE TEST IS SWITCHED OFF, by starting the ray in a medium of index 2. fold() drops a
// surface whose normal faces along the ray by more than its bound unless the ray is inside something
// denser than air -- right for a march, wrong here: a point has no direction, and the field's
// magnitude outside would jump to the nearest surface that happens to face the arbitrary one given.
// (The bound was UB.normallimit, a setting below 1 could make it bite; it is 1 since 0.65.0, where
// only a NaN normal fails it. Kept off here all the same: a field point's answer owes nothing to it.)
//
// THE COLOUR is getMaterial2's baseColor at the point, as the picture would shade a hit there: the
// material of the nearest surface (Hit.m), with its code run -- a checker prints as a checker. A
// glowing surface's colour is its emission's hue, since an emitter's baseColor is not used.
//
// HEADER, four vec4 (u32 counts carried as bit patterns):
//   [0] origin.xyz, count (u32)      [1] ax.xyz, nx (u32)
//   [2] ay.xyz, ny (u32)             [3] az.xyz, mode (u32: 0 grid, 1 points)
// then, in POINTS mode, one vec4 per point (xyz used). The host keeps a dispatch under the 65535
// workgroup limit (64 threads each), i.e. under FIELD_MAX_POINTS points.
//======================================================================================================================

import { SCENE_PRELUDE } from './scene_api.js'
import { computeUniformTypes, sceneConstantsWGSL } from './uniforms.schema.js'

export const FIELD_GRID = 0
export const FIELD_POINTS = 1
export const FIELD_HEADER = 4                  // vec4s before the point list
export const FIELD_WG = 64
export const FIELD_MAX_POINTS = 65535 * FIELD_WG

export let prog_field = async (WG, scene) =>
    await WG.makeCompute(`${SCENE_PRELUDE}${sceneConstantsWGSL(scene)}${scene.wgsl}

        fn fieldHit(pos: VEC3) -> Hit {
            // n = 2: no backface test (see the header); the direction is arbitrary
            return SDF(newRay(pos, VEC3(0.0, 0.0, 1.0), VEC4(1.0), 2.0));
        }
        `,
        /*wgsl*/`
            /* the uniforms are declared whatever the scene reads, and an empty scene reads none:
               without a use here layout:'auto' drops the binding tinywebgpu binds (check-shaders) */
            _ = UB.res;
            let count = bitcast<u32>(fieldIn[0].w);
            let i = gid.x;
            if (i >= count) { return; }
            let mode = bitcast<u32>(fieldIn[3].w);
            if (mode == 0u) {
                let nx = bitcast<u32>(fieldIn[1].w);
                let ny = bitcast<u32>(fieldIn[2].w);
                let ix = i % nx;
                let iy = (i / nx) % ny;
                let iz = i / (nx * ny);
                let pos = fieldIn[0].xyz + f32(ix) * fieldIn[1].xyz + f32(iy) * fieldIn[2].xyz + f32(iz) * fieldIn[3].xyz;
                let h = fieldHit(pos);
                fieldOut[i] = select(h.s.w, h.insideW, h.insideW > -1.0e6);
                return;
            }
            let pos = fieldIn[4u + i].xyz;
            let h = fieldHit(pos);
            let m = getMaterial2(h, false);
            let e = max(m.emissive.x, max(m.emissive.y, m.emissive.z));
            let c = select(m.baseColor, m.emissive / max(e, 1e-12), e > 0.0);
            fieldOut[4u * i] = c.x;
            fieldOut[4u * i + 1u] = c.y;
            fieldOut[4u * i + 2u] = c.z;
            fieldOut[4u * i + 3u] = f32(h.m);
            `,
        computeUniformTypes(scene.uniforms),
        {
            fieldIn: 'array<vec4<f32>>',
            fieldOut: 'array<f32>',
            ...(scene.resources || {}),
        },
        // off-thread like every kernel that inlines the scene; see prog_march in wavefront.js
        { async: true, wg: [FIELD_WG, 1, 1] }
    )

/*======================================================================================================================
  WHICH PART OF THE SCENE IS NEAREST, over a grid -- for the bounds of every object (the builder's
  bounds tool, builder/boxes.js).

  The builder's objects are code, so nothing on the CPU knows where one ends (builder/bounds.js: "there
  are no boxes any more"). The pick copy of the scene does know which object a surface belongs to: it
  sets XF_TAG as it evaluates each node, and with LOCAL_CAPTURE on fold() keeps HIT_TAG, the tag of the
  surface nearest the point, and HIT_TAG_D, its distance (scene_api.js). Evaluated at every point of a
  lattice, that says for each point which object's surface is nearest and how near: the points within
  a cell of a surface, sorted by tag, are that object's surface, and their extent its box.

  Sampled, not traced: a ray from outside never reaches an object inside another (an LED die in its
  silicone), a point beside it does. A thin sheet (a light, a detector) is found by the points within
  a cell of it.

  THE OPTICS COPY WHEN THERE IS ONE (opticsPickWgsl): it has everything the pick copy has and the ray
  limiters too, which the picture leaves out -- a limiter is a detector and needs its box as much. Its
  tags are `opticsTags` then; the host reads the list that goes with the copy (tagFieldTags).

  GRID mode only (fieldInput's header); out, two f32 per point: the nearest surface's distance, and
  its tag as u32 bits (0 = no tagged surface).
======================================================================================================================*/
export let prog_tagfield = async (WG, scene) =>
    await WG.makeCompute(`${SCENE_PRELUDE}${sceneConstantsWGSL(scene)}${scene.opticsPickWgsl ?? scene.pickWgsl ?? scene.wgsl}
        `,
        /*wgsl*/`
            _ = UB.res;
            let count = bitcast<u32>(fieldIn[0].w);
            let i = gid.x;
            if (i >= count) { return; }
            let nx = bitcast<u32>(fieldIn[1].w);
            let ny = bitcast<u32>(fieldIn[2].w);
            let ix = i % nx;
            let iy = (i / nx) % ny;
            let iz = i / (nx * ny);
            let pos = fieldIn[0].xyz + f32(ix) * fieldIn[1].xyz + f32(iy) * fieldIn[2].xyz + f32(iz) * fieldIn[3].xyz;
            LOCAL_CAPTURE = true;
            HIT_TAG = 0u;
            HIT_TAG_D = 3.0e38;
            // n = 2: no backface test (the field kernel's header says why); the direction is arbitrary
            _ = SDF(newRay(pos, VEC3(0.0, 0.0, 1.0), VEC4(1.0), 2.0));
            LOCAL_CAPTURE = false;
            fieldOut[2u * i] = HIT_TAG_D;
            fieldOut[2u * i + 1u] = bitcast<f32>(HIT_TAG);
            `,
        computeUniformTypes(scene.uniforms),
        {
            fieldIn: 'array<vec4<f32>>',
            fieldOut: 'array<f32>',
            ...(scene.resources || {}),
        },
        { async: true, wg: [FIELD_WG, 1, 1] }
    )
/** The tag list that goes with the copy prog_tagfield compiles: tag k is list[k - 1]. */
export const tagFieldTags = scene => (scene.opticsPickWgsl ? scene.opticsTags : scene.pickWgsl ? scene.tags : null) ?? []

/** The header as the kernel reads it. `points` (POINTS mode): a flat xyz list. */
export function fieldInput({ mode, count, origin = [0, 0, 0], ax = [0, 0, 0], ay = [0, 0, 0], az = [0, 0, 0], nx = 0, ny = 0, points = null }) {
    const n = FIELD_HEADER + (mode === FIELD_POINTS ? count : 0)
    const f = new Float32Array(4 * n), u = new Uint32Array(f.buffer)
    f.set(origin, 0); u[3] = count
    f.set(ax, 4); u[7] = nx
    f.set(ay, 8); u[11] = ny
    f.set(az, 12); u[15] = mode
    if (mode === FIELD_POINTS) for (let i = 0; i < count; i++) {
        f[16 + 4 * i] = points[3 * i]; f[17 + 4 * i] = points[3 * i + 1]; f[18 + 4 * i] = points[3 * i + 2]
    }
    return f
}
