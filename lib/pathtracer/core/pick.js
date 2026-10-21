//======================================================================================================================
// PICK -- one ray, marched by one thread, to find what is under the mouse.
//
// Nothing per frame: the kernel is compiled on the first pick after a scene change and dispatched
// once per click. The host computes the ray (genrays.js rayThrough, the render kernel's own ray
// construction without the jitter) and reads back where it hit, the surface normal, and a TAG --
// which part of the scene the surface belongs to, in whatever numbering the scene gave it.
//
// THE TAG IS THE SCENE'S. The renderer knows nothing about nodes; a scene that wants to be picked
// supplies `pickWgsl`, a copy of itself that sets XF_TAG as it evaluates its parts, and fold()
// records the winning surface's tag while capture is on (scene_api.js). The builder's copy tags
// every node and ships `tags` to map a tag back to a node id. A scene without pickWgsl is
// compiled as it is and picks as tag 0: a hit, anonymous.
//
// THE SAME MARCH AS THE RENDER, in the ways that decide what is hit: the same epsilon, step scale,
// step limit, starting medium and "left the scene" test (wavefront.js prog_march), so the pick
// cannot find a surface the picture does not show or miss one it does. The step limit is the
// uniform maxiter, not a constant: one thread has no use for an unrolled loop, and unrolling the
// scene's SDF is what makes a compile slow.
//
// THE CAPTURE PASS: once the march stops on a surface, SDF runs once more at that point with
// LOCAL_CAPTURE on, which is what makes fold() record HIT_TAG: the tag of the deepest surface that
// passes through the point (scene_api.js says why deepest). The same second evaluation a
// material's p_local costs, and here only once per click.
//
// OUTPUT, eight u32 words: found, tag, distance (f32 bits), then pos.xyz and normal.xyz packed as
// f32 bits after them -- read back as one buffer and viewed both ways.
//======================================================================================================================

import { SCENE_PRELUDE } from './scene_api.js'
import { computeUniformTypes, sceneConstantsWGSL } from './uniforms.schema.js'

export const PICK_WORDS = 12

export let prog_pick = async (WG, scene) =>
    await WG.makeCompute(`${SCENE_PRELUDE}${sceneConstantsWGSL(scene)}${scene.pickWgsl ?? scene.wgsl}`,
        /*wgsl*/`
            if (gid.x != 0u) { return; }
            var ray = newRay(pickIn[0].xyz, pickIn[1].xyz, VEC4(1.0), 1.0);
            let limit = min(UB.maxiter, 100000u);
            /* ONE SDF CALL FOR THE WHOLE PICK (0.10.0): the march's steps, then the capture at the hit,
               then -- where the capture finds no normal (sd() distances, blends of one) -- the six points
               of a central difference (the shade side's calcNormals did the same until 0.22.3, when it went
               uncalled), each a pass of one loop. They were eight call sites -- the march's, the
               capture's and pickNormal's six -- and every call is a whole copy of the scene once inlined;
               the pick kernel is compiled on the first click after every scene change. Each evaluation
               is made at the same point, in the same order and with LOCAL_CAPTURE as it was, and the
               normal is pickNormal's arithmetic: SDF(+) - SDF(-) per axis, then normalized. */
            var found = 0u;
            var tag = 0u;
            var n = VEC3(0.0);
            var g = VEC3(0.0);
            var k = 0u;                                   // the march's steps taken
            var stage = 0u;                               // 0 the march, 1 the capture, 2-7 the normal's points
            loop {
                if (stage == 0u && k >= limit) { break; }
                var q = ray;
                if (stage == 1u) {
                    tagCaptureBegin();
                } else if (stage >= 2u) {
                    // +x, -x, +y, -y, +z, -z: pickNormal's own points, in its order, made as it made them
                    let ne = normalTol(ray.pos);              // the shade kernel's difference step (EPS_WGSL)
                    let a = (stage - 2u) / 2u;
                    let e = VEC3(select(0.0, ne, a == 0u), select(0.0, ne, a == 1u), select(0.0, ne, a == 2u));
                    q.pos = select(ray.pos + e, ray.pos - e, (stage & 1u) != 0u);
                }
                /* the normal's points as a normal's looks (scene_api.js NORMAL_LOOK): a difference of both sides, so no
                   base to look at as the shade side does (normalAtHitWGSL) */
                NORMAL_LOOK = stage >= 2u;
                let h = sceneAt(q, stage == 1u);              // the capture on its own trip (scene_api.js)
                NORMAL_LOOK = false;
                if (stage == 0u) {
                    k++;
                    let ea = abs(h.s.w);
                    if (ea < marchTol(ray.pos)) { found = 1u; stage = 1u; continue; }
                    if (dot(ray.pos, ray.dir) > 0.0 && dot(ray.pos, ray.pos) > UB.envRadius * UB.envRadius) { break; }
                    /* the render's longest march, 1 km (wavefront.js lmax). It was 1000.0 in SCENE units -- 1 m in a mm
                       scene, where the picture traces to 1 km: a pick on anything over a metre off found nothing */
                    if (ray.ltot > 1000.0) { break; }
                    ray = moveBy(ray, ray.dir * ea * UB.stepscale);
                } else if (stage == 1u) {
                    tag = tagCaptureEnd();
                    n = h.s.xyz;
                    if (!(dot(n, n) < 1e-12)) { break; }  // the scene's own normal; NaN keeps it, as before
                    stage = 2u;
                } else {
                    // g = (SDF(+) - SDF(-)) per axis, as pickNormal's gx, gy, gz: the + point is set, the - taken off
                    let a = (stage - 2u) / 2u;
                    if ((stage & 1u) != 0u) { g[a] -= h.s.w; } else { g[a] = h.s.w; }
                    stage++;
                    if (stage == 8u) {
                        n = select(VEC3(0.0), normalize(g), dot(g, g) > 0.0);
                        break;
                    }
                }
            }
            pickOut[0] = found;
            pickOut[1] = tag;
            pickOut[2] = bitcast<u32>(ray.ltot);
            pickOut[3] = 0u;
            pickOut[4] = bitcast<u32>(ray.pos.x);
            pickOut[5] = bitcast<u32>(ray.pos.y);
            pickOut[6] = bitcast<u32>(ray.pos.z);
            pickOut[7] = 0u;
            pickOut[8] = bitcast<u32>(n.x);
            pickOut[9] = bitcast<u32>(n.y);
            pickOut[10] = bitcast<u32>(n.z);
            pickOut[11] = 0u;
            `,
        computeUniformTypes(scene.uniforms),
        {
            pickIn: 'array<vec4<f32>>',          // origin, direction
            pickOut: 'array<u32>',
            ...(scene.resources || {}),
        },
        // off-thread like every kernel that inlines the scene; see prog_march in wavefront.js
        { async: true, wg: [1, 1, 1] }
    )

/** Unpack what the kernel wrote. */
export function readPick(words) {
    const f = new Float32Array(words.buffer, words.byteOffset, PICK_WORDS)
    return {
        hit: words[0] === 1,
        tag: words[1],
        distance: f[2],
        pos: [f[4], f[5], f[6]],
        normal: [f[8], f[9], f[10]],
    }
}
