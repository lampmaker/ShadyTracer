//======================================================================================================================
// TRANSFORM -- a node's placement relative to its parent, and the uniform it becomes.
//
// Its own module because both model.js (which stores transforms) and codegen.js (which declares
// them as uniforms) need it, and model.js already imports codegen.js.
//======================================================================================================================

/** Relative to the parent: position, then rotation in DEGREES about x, then y, then z, then a
 *  uniform scale. Uniform only, and deliberately: a distance field scaled differently along
 *  each axis is no longer a distance, and the marcher would overstep. */
export const identity = () => ({ pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: 1 })

/**
 * A transform as the mat4x4<f32> uniform codegen declares for it, column-major, 16 numbers:
 * columns 0-2 are the rotation R (local -> parent), column 3 is (position, scale). Not a
 * homogeneous matrix -- the shader unpacks it (core/scene_api.js, xfPoint) -- because the
 * scale has to reach the distance as well as the point, and a 4x4 has nowhere else to carry it.
 *
 * R = Rz * Ry * Rx: rotate about x first, then y, then z, all about the parent's axes.
 */
export function matrixOf(t = identity()) {
    const r = Math.PI / 180
    const [cx, sx] = [Math.cos(t.rot.x * r), Math.sin(t.rot.x * r)]
    const [cy, sy] = [Math.cos(t.rot.y * r), Math.sin(t.rot.y * r)]
    const [cz, sz] = [Math.cos(t.rot.z * r), Math.sin(t.rot.z * r)]
    // rows of Rz*Ry*Rx
    const R = [
        [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
        [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
        [-sy, cy * sx, cy * cx],
    ]
    return [
        R[0][0], R[1][0], R[2][0], 0,      // column 0
        R[0][1], R[1][1], R[2][1], 0,      // column 1
        R[0][2], R[1][2], R[2][2], 0,      // column 2
        t.pos.x, t.pos.y, t.pos.z, t.scale,
    ]
}
