//======================================================================================================================
// THE ENGINE'S UNIT, ON THE HOST'S SIDE (0.36.0). The engine works in metres; a scene, the camera, the builder and every
// host tool in the scene's own unit (lib/pathtracer/PRECISION.md). What crosses from the host to the GPU is converted
// here, in one place each, and what comes back the other way:
//   the camera          engineCamera -- its position and an orthographic camera's extents (the rest are directions)
//   a point or a length toEngine / toScene -- the pick's ray in, its hit out; the step cache's box; the optics'
//                       reach, sources, hits and paths
// On the GPU the scene's side is reached through the boundary (core/scene_api.js SCENE_BOUNDARY). Plain JS, no GPU:
// test/units.test.mjs runs every line.
//======================================================================================================================

import { unitScale } from './photometry.js'

/** Metres per scene unit for a scene (its `unit`, 'm' when it gives none): what the engine multiplies a scene's lengths by. */
export const metresPerUnit = scene => unitScale(scene?.unit ?? 'm')

/** A point, vector of lengths or one length, from the scene's unit into the engine's (metres), and back. */
export const toEngine = (v, u) => Array.isArray(v) || ArrayBuffer.isView(v) ? Array.from(v, x => x * u) : v * u
export const toScene = (v, u) => Array.isArray(v) || ArrayBuffer.isView(v) ? Array.from(v, x => x / u) : v / u

/**
 * THE CAMERA'S UNIFORMS IN ENGINE UNITS: camera.js getUniforms() ({ invView, invProjection, camPos }) as the kernels
 * take them. The camera itself stays in the scene's unit -- the builder's views, gizmos, focus and saved cameras are
 * the scene's numbers -- so only what the GPU reads is converted: the position (camPos, and invView's translation,
 * column 3), and for an ORTHOGRAPHIC camera (camtype 1) invProjection's diagonal, which is then its half width and half
 * height and its depth (camera.js orthoInverse), lengths; for a perspective one it is tan(fov/2) and the aspect, no
 * length. invView's columns 0-2 are directions. New arrays: the camera's own are never written.
 */
export function engineCamera(CU, camtype, u) {
    if (!CU) return CU
    const invView = Float32Array.from(CU.invView)
    invView[12] *= u; invView[13] *= u; invView[14] *= u
    const invProjection = Float32Array.from(CU.invProjection)
    if ((camtype | 0) === 1) { invProjection[0] *= u; invProjection[5] *= u; invProjection[10] *= u; invProjection[14] *= u }
    const camPos = [CU.camPos[0] * u, CU.camPos[1] * u, CU.camPos[2] * u, CU.camPos[3] ?? 1]
    /* THE LENS (0.43.0; camera.js camLens): its radius and the distance in focus, lengths both. A camera without one
       (a stand-in, an older host) is a pinhole: radius 0, and a focus the kernels then never read. */
    const L = CU.camLens ?? [0, 1, 0, 0]
    const camLens = [L[0] * u, L[1] * u, L[2] ?? 0, L[3] ?? 0]
    return { invView, invProjection, camPos, camLens }
}
