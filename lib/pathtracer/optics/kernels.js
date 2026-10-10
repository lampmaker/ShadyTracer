//======================================================================================================================
// OPTICS KERNELS -- the technical ray trace's own generator and shade, built from the renderer's parts.
//
// The optics run (optics/index.js) traces RAYS, not pictures: N rays leave a source, walk through
// every material the scene has, and the question is where their flux goes -- which object each one
// hits, how much each object absorbs, what escapes, and along which path. So it reuses what decides
// that in the renderer -- the scene's SDF, the march, processMaterial and its BSDF sampling -- and
// replaces only the two ends: where rays come from (prog_opt_gen) and what is recorded when they
// interact (prog_opt_shade).
//
// OWN BUFFERS, OWN PIPELINES. Nothing here is bound into the renderer's pipelines or buffers: the
// render loop may run between two steps of a trace (the user orbits the camera to look at the rays),
// and it would overwrite anything the two shared. The only thing borrowed is `learn`, read-only in
// effect -- the GGX tables processMaterial samples live in its tail (microfacet.js) -- because an
// optics ray never connects to the camera and never discovers emitters, which are its only writers.
//
// OBJECTS, NOT ONLY MATERIALS. The render kernels know a hit's material id and nothing else. The
// shade here compiles the scene's PICK copy (pickWgsl, the builder's; scene_api.js XF_TAG), and at
// every interaction evaluates the SDF once more with capture on -- exactly as core/pick.js does per
// click -- so each interaction knows which OBJECT it hit (HIT_TAG). A scene without a pick copy
// tallies everything under tag 0, and per material as before.
//
// TALLIES ARE INTEGERS. Flux is added as fixed point (OPT_FX per unit of ray weight) into a lo/hi
// pair of u32 atomics, with the carry done by hand: exact, deterministic, and immune to the retry
// storms a float compare-and-swap suffers when a narrow beam sends every ray to the same object.
// A ray starts with weight 1; the host turns weights into W or lm with the source's flux / N.
//======================================================================================================================
import { SCENE_PRELUDE } from '../core/scene_api.js'
import { PROCESSING, PROCESSING_ASKS, DEFINITIONS } from '../core/tracebasics.js'
import { PRIMITIVES } from '../core/sdf.js'
import { MATERIALS_PBR as PROCESSOR } from '../core/materials_pbr.js'
import { computeUniformTypes, sceneConstantsWGSL } from '../core/uniforms.schema.js'
import { counterstruct } from '../core/wavefront.js'
import { LUMA } from '../core/photometry.js'
import { RGB709_TO_XYZ } from '../core/colorimetry.js'

/* THE LAYOUT of the optData buffer, in u32 words. Shared by the WGSL below and the host that reads
   it (optics/index.js), so the two cannot disagree. A FLUX slot is a lo/hi pair. */
export const OPT_FX = 1 << 20                  // fixed-point units per unit of ray weight
export const OPT_TAGS = 256                    // objects (pick tags); tag 0 = untagged
export const OPT_MATS = 64                     // material ids
export const O_PARK = 0                        // [0] rays parked for the next step (atomic count)
export const O_DETN = 1                        // [1] detector hits recorded (atomic count; may pass the cap)
export const O_FLUX = 16                       // global flux pairs: escaped, lost, detected
export const O_COUNT = 22                      // global counts: escaped, lost, interactions, absorbed, detected
/* ...and one more flux pair in the words after them: what the media absorbed between surfaces (0.37.0; Beer-Lambert,
   tracebasics.js absorbAlong). It falls between one interaction's LEAVING and the next one's INCIDENT, which no
   object's row holds, so without its own tally the trace's balance would stop reading 0 (roadmap/PLAN.md B2). */
export const O_VOL = 28
export const O_TAG = 32                        // per tag: incident pair, leaving pair, hits
export const O_MAT = O_TAG + OPT_TAGS * 5      // per material: the same five words
export const O_PATHS = O_MAT + OPT_MATS * 5    // path vertex counts (per displayed ray), then vertices
export const OPT_TALLY_WORDS = O_PATHS         // what a readback of the tallies needs
export const F_ESCAPED = 0, F_LOST = 1, F_DETECTED = 2
export const C_ESCAPED = 0, C_LOST = 1, C_INTERACTIONS = 2, C_ABSORBED = 3, C_DETECTED = 4
/* A path vertex: position, the ray's weight arriving there, the OPTICAL path length from the
   source (sum of n * length, as the march keeps it in ray.ltot) -- which is what the page's
   path-length slider cuts the drawing at -- and the ray's colour arriving there (words 5-7: rgb of
   beta x radiance over its luminance, so a hue of luminance 1), for drawing rays in the light's
   colour: the source's hue, times whatever coloured glass the ray has passed. */
export const VERT_WORDS = 8
/* A detector hit: position and weight (its luminous flux, Y), then the direction the ray arrived
   along and the tag, then its X and Z in the same units -- so a detector knows the COLOUR of what it
   caught, exactly: XYZ from the ray's channels through the Rec.709 matrix (core/colorimetry.js), which
   undoes the conversion that made them from the light's chromaticity. */
export const DET_WORDS = 10

/* THE FAR FIELD: flux per direction, a (C, gamma) grid of lo/hi pairs after the detector hits, gamma
   the angle from the photometric axis (the light's +z) and C the angle about it from its +x -- the
   lighting convention's type C. nG gamma bins centred on 0, 180/(nG-1), ..., 180 degrees, the two
   end ones half as wide (the caps at the poles); nC C bins centred on 0, 360/nC, ... Bin
   (ig, ic) is word farBase + (ig * nC + ic) * 2. optics/farfield.js turns it into candela. */
export const FAR_OFF = 0, FAR_ESCAPED = 1, FAR_DETECTOR = 2
/** Where the path vertices start, where the detector hits start, and where the far field starts. */
export const pathBase = pathRays => O_PATHS + pathRays
export const detBase = (pathRays, pathVerts) => O_PATHS + pathRays + pathRays * pathVerts * VERT_WORDS
export const farBase = (pathRays, pathVerts, detCap) => detBase(pathRays, pathVerts) + detCap * DET_WORDS
/** Words the optData buffer needs for `pathRays` displayed rays of `pathVerts` vertices each, room
 *  for `detCap` detector hits, and a far field of `farBins` bins. */
export const optDataWords = (pathRays, pathVerts, detCap = 0, farBins = 0) => farBase(pathRays, pathVerts, detCap) + farBins * 2

/* THE SOURCES are a table in a storage buffer (optSources), SRC_VEC4 vec4s each, which the host
   fills (optics/sources.js sourceRecords) from every source in the scene -- the builder's sheets
   carrying a source material:
     [0] centre (metres), cdf         the cumulative share of the total flux up to and including it
     [1] emission axis (unit), shape  0 point, 1 disc, 2 rectangle, 3 a ray set (a Zemax file)
     [2] first tangent (unit), size x the disc's radius, the rectangle's half width
     [3] size y, distribution, cos(half angle), n     distribution: 0 collimated, 1 uniform, 2 cos^n
     [4] emitN, twoSided, onSurface, 0   the index it emits into; both faces when > 0.5; > 0.5 when
                                      the source is geometry in the scene (a builder sheet), so
                                      its rays must start off it
     [5] colour, 0                    the light's hue, normalised to luminance 1 (sourceRecords)
   THE COLOUR RIDES ON beta. A ray's weight in the tallies is the LUMINANCE of beta x radiance
   (optWeight), so a hue of luminance 1 leaves every flux figure as it was, and the picture's photons
   (whose radiance is flux) light what they reach in the light's colour. It was not carried at all:
   builder/sources.js dropped the colour, and a red LED lit its scene white -- only the face the
   camera saw directly was red.
   A ray picks its source by flux, so every ray carries the same share of the TOTAL flux.
   A RAY SET (shape 3) is its rays, in a second buffer (optRays, RAYSET_VEC4 vec4s a ray: position in
   metres and weight -- its flux over the set's mean -- then direction): [2].w is where its rays
   start in it and [3].x how many. A traced ray takes one of them at random, as it is, weighted. */
export const RAYSET_VEC4 = 2
export const SRC_VEC4 = 6
export const OPT_UNIFORMS = {
    optSrcCount: 'u32',         // sources in the table
    optRays: 'u32',             // rays in this batch
    optPathRays: 'u32',         // how many of them (the first ones) record their path
    optPathVerts: 'u32',        // vertices kept per recorded path
    optStep: 'u32',             // 1: park rays after each interaction (stepping); 0: run through
    optEscLen: 'f32',           // how long an escaping ray is drawn, metres (no max distance)
    optMaxDist: 'f32',          // the longest OPTICAL path traced, metres; 0 = no limit
    optDetCap: 'u32',           // detector hits the buffer has room for
    // THE DETECTORS: one bit per MATERIAL id (256), set for every material whose type is
    // detector or limiter (model version 10; codegen `detectors`)
    optDetA: 'vec4<u32>',       // material ids 0..127
    optDetB: 'vec4<u32>',       // material ids 128..255
    // WHAT RAYS PASS THROUGH: one bit per material id -- transparent sources (codegen `passes`)
    optPassA: 'vec4<u32>',
    optPassB: 'vec4<u32>',
    // THE FAR FIELD (FAR_* above): x nC, y nG (0: none), z what feeds it -- off, every escaping ray,
    // or every ray arriving at the detector material w, by the direction it arrives along
    optFar: 'vec4<u32>',
    optFarAxis: 'vec4<f32>',    // xyz: gamma = 0, the photometric axis (unit)
    optFarC0: 'vec4<f32>',      // xyz: C = 0, a unit vector square to the axis
}

const LAYOUT = `
const OPT_FX: f32 = ${OPT_FX}.0;
const OPT_TAGS: u32 = ${OPT_TAGS}u;
const OPT_MATS: u32 = ${OPT_MATS}u;
const O_PARK: u32 = ${O_PARK}u;
const O_DETN: u32 = ${O_DETN}u;
const F_DETECTED: u32 = ${F_DETECTED}u;
const C_DETECTED: u32 = ${C_DETECTED}u;
const VERT_WORDS: u32 = ${VERT_WORDS}u;
const DET_WORDS: u32 = ${DET_WORDS}u;
const O_FLUX: u32 = ${O_FLUX}u;
const O_COUNT: u32 = ${O_COUNT}u;
const O_TAG: u32 = ${O_TAG}u;
const O_MAT: u32 = ${O_MAT}u;
const O_PATHS: u32 = ${O_PATHS}u;
const F_ESCAPED: u32 = ${F_ESCAPED}u;
const F_LOST: u32 = ${F_LOST}u;
const C_ESCAPED: u32 = ${C_ESCAPED}u;
const C_LOST: u32 = ${C_LOST}u;
const C_INTERACTIONS: u32 = ${C_INTERACTIONS}u;
const C_ABSORBED: u32 = ${C_ABSORBED}u;
const O_VOL: u32 = ${O_VOL}u;

/* Flux into a lo/hi pair: the carry is the wrap of the low word. */
fn optAdd(slot: u32, w: f32) {
    let v = u32(clamp(w, 0.0, 4000.0) * OPT_FX + 0.5);
    if (v == 0u) { return; }
    let old = atomicAdd(&optData[slot], v);
    if (old + v < old) { atomicAdd(&optData[slot + 1u], 1u); }
}
/* A ray's weight: what is left of the unit it started with, as luminance. */
fn optWeight(r: Ray) -> f32 { return dot(r.beta * r.radiance, VEC3(${LUMA.join(', ')})); }

/* THE PATHS of the first optPathRays rays: a vertex count per ray, then optPathVerts vertices of
   (position, weight, optical path length) each. One ray is only ever handled by one invocation at
   a time, so its slots need no atomics beyond the storage type's. */
fn optVertBase(id: u32, k: u32) -> u32 { return O_PATHS + UB.optPathRays + (id * UB.optPathVerts + k) * VERT_WORDS; }
/* The ray's colour as a hue of luminance 1 (white for a ray with nothing left). */
fn optHue(r: Ray) -> VEC3 {
    let c = r.beta * r.radiance;
    let y = dot(c, VEC3(${LUMA.join(', ')}));
    return select(VEC3(1.0), c / y, y > 0.0);
}
fn optVertex(id: u32, p: VEC3, w: f32, opl: f32, hue: VEC3) {
    if (id >= UB.optPathRays) { return; }
    let k = atomicLoad(&optData[O_PATHS + id]);
    if (k >= UB.optPathVerts) { return; }
    let b = optVertBase(id, k);
    atomicStore(&optData[b + 0u], bitcast<u32>(p.x));
    atomicStore(&optData[b + 1u], bitcast<u32>(p.y));
    atomicStore(&optData[b + 2u], bitcast<u32>(p.z));
    atomicStore(&optData[b + 3u], bitcast<u32>(w));
    atomicStore(&optData[b + 4u], bitcast<u32>(opl));
    atomicStore(&optData[b + 5u], bitcast<u32>(hue.x));
    atomicStore(&optData[b + 6u], bitcast<u32>(hue.y));
    atomicStore(&optData[b + 7u], bitcast<u32>(hue.z));
    atomicStore(&optData[O_PATHS + id], k + 1u);
}
/* The last vertex recorded: xyz its position, w its optical path length. */
fn optLastVertex(id: u32) -> VEC4 {
    let k = atomicLoad(&optData[O_PATHS + id]);
    let b = optVertBase(id, max(k, 1u) - 1u);
    return VEC4(bitcast<f32>(atomicLoad(&optData[b + 0u])),
                bitcast<f32>(atomicLoad(&optData[b + 1u])),
                bitcast<f32>(atomicLoad(&optData[b + 2u])),
                bitcast<f32>(atomicLoad(&optData[b + 4u])));
}
/* Is this material a detector (or a limiter)? One bit per material id in optDetA / optDetB. */
fn optIsDetector(mat: u32) -> bool {
    if (mat >= 256u) { return false; }
    let word = select(UB.optDetA[(mat >> 5u) & 3u], UB.optDetB[(mat >> 5u) & 3u], mat >= 128u);
    return ((word >> (mat & 31u)) & 1u) != 0u;
}
/* Does the trace pass through this material (a transparent source)? The same bit layout. */
fn optIsPass(mat: u32) -> bool {
    if (mat >= 256u) { return false; }
    let word = select(UB.optPassA[(mat >> 5u) & 3u], UB.optPassB[(mat >> 5u) & 3u], mat >= 128u);
    return ((word >> (mat & 31u)) & 1u) != 0u;
}
/* A ray that reached a detector: where, with how much, along which direction, on which object.
   Counted past the cap, so the host can say how many did not fit. */
fn optRecordHit(p: VEC3, w: f32, d: VEC3, tag: u32, c: VEC3) {
    let k = atomicAdd(&optData[O_DETN], 1u);
    if (k >= UB.optDetCap) { return; }
    let b = O_PATHS + UB.optPathRays + UB.optPathRays * UB.optPathVerts * VERT_WORDS + k * DET_WORDS;
    atomicStore(&optData[b + 0u], bitcast<u32>(p.x));
    atomicStore(&optData[b + 1u], bitcast<u32>(p.y));
    atomicStore(&optData[b + 2u], bitcast<u32>(p.z));
    atomicStore(&optData[b + 3u], bitcast<u32>(w));
    atomicStore(&optData[b + 4u], bitcast<u32>(d.x));
    atomicStore(&optData[b + 5u], bitcast<u32>(d.y));
    atomicStore(&optData[b + 6u], bitcast<u32>(d.z));
    atomicStore(&optData[b + 7u], tag);
    atomicStore(&optData[b + 8u], bitcast<u32>(dot(c, VEC3(${RGB709_TO_XYZ[0].join(', ')}))));
    atomicStore(&optData[b + 9u], bitcast<u32>(dot(c, VEC3(${RGB709_TO_XYZ[2].join(', ')}))));
}
/* A ray into the far field by its direction (the grid is described with farBase above). The C = 90
   direction is axis x C0, so for a light's frame (+z, +x) it is +y: C runs counterclockwise seen
   from where the light shines. */
const FAR_ESCAPED: u32 = ${FAR_ESCAPED}u;
const FAR_DETECTOR: u32 = ${FAR_DETECTOR}u;
fn optFarAdd(d: VEC3, w: f32) {
    let nC = UB.optFar.x;
    let nG = UB.optFar.y;
    if (nC == 0u || nG < 2u) { return; }
    let ax = UB.optFarAxis.xyz;
    let c0 = UB.optFarC0.xyz;
    let c90 = cross(ax, c0);
    let dn = normalize(d);
    let g = acos(clamp(dot(dn, ax), -1.0, 1.0));
    var c = atan2(dot(dn, c90), dot(dn, c0));
    if (c < 0.0) { c += 6.28318530718; }
    let ig = min(u32(g / 3.14159265359 * f32(nG - 1u) + 0.5), nG - 1u);
    let ic = u32(c / 6.28318530718 * f32(nC) + 0.5) % nC;
    let base = O_PATHS + UB.optPathRays + UB.optPathRays * UB.optPathVerts * VERT_WORDS + UB.optDetCap * DET_WORDS;
    optAdd(base + (ig * nC + ic) * 2u, w);
}
`

/*======================================================================================================================
  GENERATE -- one ray per invocation, from the source the uniforms describe.

  Every ray carries the same weight, 1: the source's flux is divided evenly, so the SAMPLING is the
  distribution. Position uniform over the point / disc / rectangle; direction about the axis:
    collimated   the axis itself
    uniform      uniform in solid angle within the cone: cos = 1 - u (1 - cos a)
    cos^n        density ~ cos^n within the cone: cos^(n+1) uniform on [cos^(n+1) a, 1]
  n = 1 over the whole hemisphere is Lambertian. optics/sources.js mirrors these in JS for the test.
======================================================================================================================*/
/* THE SOURCE, sampled: one ray per id, position and direction as the header above says. Shared by
   the trace's generator and the picture's (prog_opt_photons), so the two cannot disagree about
   what the source is. */
const SOURCE_RAY = /*wgsl*/`
const SRC_VEC4: u32 = ${SRC_VEC4}u;
/* WHERE THE LIGHT LEFT ITS SOURCE: the point on the face, before the ray is stepped off it (below) --
   where the trace draws the ray from. Set by optSourceRay; prog_opt_photons has no use for it. */
var<private> OPT_FROM: VEC3;
fn optSourceRay(id: u32) -> Ray {
    SEED_uvec4(UB.seed);
    SEED_u32(id);
    SEED_u32(0x9E3779B9u);
    // WHICH SOURCE, by flux: the first whose cumulative share reaches the draw
    let pick = PRNG();
    var k = 0u;
    for (var i = 0u; i < UB.optSrcCount; i++) { k = i; if (pick.x <= optSources[i * SRC_VEC4].w) { break; } }
    let b = k * SRC_VEC4;
    let r0 = optSources[b];
    let r1 = optSources[b + 1u];
    let r2 = optSources[b + 2u];
    let r3 = optSources[b + 3u];
    let r4 = optSources[b + 4u];
    let colour = optSources[b + 5u].xyz;
    // A RAY SET: one of its rays, as the file has it (placed by the host), carrying its weight
    if (u32(r1.w + 0.5) == 3u) {
        let cnt = max(u32(r3.x + 0.5), 1u);
        let j = u32(r2.w + 0.5) + min(u32(PRNG().x * f32(cnt)), cnt - 1u);
        let a = optRays[j * 2u];
        let dd = optRays[j * 2u + 1u];
        var rr = newRay(a.xyz, dd.xyz, VEC4(1.0), max(r4.x, 1.0));
        OPT_FROM = a.xyz;
        rr.beta = VEC3(a.w) * colour;
        rr.ltMis = -1.0;                            // no face: no camera path can meet it (Ray.ltMis)
        return rr;
    }
    let front = normalize(r1.xyz);
    let tu = normalize(r2.xyz - front * dot(r2.xyz, front));
    let tv = cross(front, tu);

    let u = PRNG();
    var p = r0.xyz;
    let shape = u32(r1.w + 0.5);
    if (shape == 1u) {
        let r = r2.w * sqrt(u.x);
        let ph = 6.28318530718 * u.y;
        p += (tu * cos(ph) + tv * sin(ph)) * r;
    } else if (shape == 2u) {
        p += tu * (2.0 * u.x - 1.0) * r2.w + tv * (2.0 * u.y - 1.0) * r3.x;
    }
    // BOTH FACES: half the rays from each, the flux shared evenly (sourceTable counts both faces)
    var axis = front;
    if (r4.y > 0.5 && pick.y < 0.5) { axis = -front; }

    let dist = u32(r3.y + 0.5);
    let u2 = PRNG();
    var c = 1.0;
    if (dist == 1u) {
        c = 1.0 - u2.x * (1.0 - r3.z);
    } else if (dist == 2u) {
        let e = r3.w + 1.0;
        let lo = pow(max(r3.z, 0.0), e);
        c = pow(1.0 - u2.x * (1.0 - lo), 1.0 / e);
    }
    let s = sqrt(max(0.0, 1.0 - c * c));
    let ph2 = 6.28318530718 * u2.y;
    let d = normalize(tu * (s * cos(ph2)) + tv * (s * sin(ph2)) + axis * c);
    /* OFF THE SHEET, on the side it emits from, when the source is geometry (a builder sheet): a ray
       starting on it would be stopped by it at once. TWO MARCH TOLERANCES, not the bounce's two
       surface offsets (20 tolerances) that it took until 2026-10-02: in RGBW_mixer that was 0.21 mm
       off a 1 mm die whose lightguide begins 0.20 mm in front of it, so every ray started inside the
       guide and was drawn from its face -- the user saw the rays offset from the light. Two are
       enough: the march stops at |d| < marchTol (wavefront.js), a face is an exact flat sheet, and a
       ray LEAVING it at height h is h + t cos(theta) away, never closer, at any angle. A bounce needs
       more (estimated normals, curved and inexact surfaces), and so does a ray ARRIVING at a face
       (light sampling's stop: it meets the face at eps / cos). Not for a source that is only a
       description (a bench's point 1 m up): moved 2 cm, its inverse-square answer would be 4% off.
       IN ITS MEDIUM: an LED die in silicone emits into n 1.41, not air. */
    let off = select(0.0, 2.0 * marchTol(p), r4.z > 0.5);
    OPT_FROM = p;
    var ray = newRay(p + axis * off, d, VEC4(1.0), max(r4.x, 1.0));
    ray.beta = colour;
    /* ITS DENSITY, for MIS with the camera's paths (Ray.ltMis): the probability of this source,
       side, point and direction, over cos -- times the photon count (prog_opt_photons) it is the
       light's radiance this way over the flux each photon carries, which the camera side reads off
       the face it meets. Only a FACE the camera can meet: a builder sheet (onSurface), a disc or a
       rectangle, not collimated; anything else -1, and its photons own every lobe they can
       evaluate. The source's share is its step in the cumulative table, the point uniform on one
       face, the side a half when both emit, the direction the pdf drawn above. */
    ray.ltMis = -1.0;
    if (r4.z > 0.5 && (shape == 1u || shape == 2u) && dist != 0u) {
        // (select evaluates both sides: the index is kept in range for k = 0, whose share starts at 0)
        let prev = select(0.0, optSources[(max(k, 1u) - 1u) * SRC_VEC4].w, k > 0u);
        let area = select(4.0 * r2.w * r3.x, 3.14159265359 * r2.w * r2.w, shape == 1u);
        let cc = max(c, 1e-6);
        var pdir = 1.0 / (6.28318530718 * max(1.0 - r3.z, 1e-9));                 // uniform in the cone
        if (dist == 2u) {
            let e = r3.w + 1.0;
            pdir = e * pow(cc, r3.w) / (6.28318530718 * max(1.0 - pow(max(r3.z, 0.0), e), 1e-9));
        }
        ray.ltMis = max(r0.w - prev, 0.0) * select(1.0, 0.5, r4.y > 0.5) * pdir / (max(area, 1e-30) * cc);
    }
    return ray;
}
`

export let prog_opt_gen = async (WG, scene = {}) =>
    // the ray and noise definitions only, as prog_genphotons: generating needs no scene
    await WG.makeCompute(`${PRIMITIVES};${DEFINITIONS}${LAYOUT}${SOURCE_RAY}`,
        /*wgsl*/`
        let id = gid.x;
        if (id >= UB.optRays) { return; }
        var ray = optSourceRay(id);
        // a photon's radiance field is its flux: weight 1 -- times beta, a ray set's own weight and
        // the light's hue
        ray.radiance = VEC3(1.0);
        ray.tag = TAG_PHOTON | TAG_OPTIC;
        ray.pix = id;                         // which ray it is, for its path
        rayBuffer0[id] = ray;
        if (id < UB.optPathRays) {
            atomicStore(&optData[O_PATHS + id], 0u);
            // drawn from the face itself, not from where the ray was stepped off it (OPT_FROM)
            optVertex(id, OPT_FROM, optWeight(ray), 0.0, optHue(ray));
        }
        `,
        { ...computeUniformTypes(scene.uniforms), ...OPT_UNIFORMS },
        { rayBuffer0: 'array<Ray>', optData: 'array<atomic<u32>>', optSources: 'array<vec4<f32>>', optRays: 'array<vec4<f32>>' },
        { wg: [64, 1, 1], readOnly: ['optSources', 'optRays'] }
    )

/*======================================================================================================================
  THE SOURCE LIGHTING THE PICTURE -- its photons, into the RENDERER's ray buffer (R.photonSources).

  The source is not geometry: no camera path can find it, so light tracing alone counts its light,
  and exactly -- each photon connects to the camera at EVERY surface it lands on (TAG_LTALL; the
  sun's photons only connect after glass, the camera side having the rest), carrying flux / N
  lumens, which the renderer's connection turns into cd/m^2. Direct light, the lens's spot, and
  light after diffuse bounces all count; what the camera sees through a mirror or glass cannot be
  connected, as with the sun's caustics.

  Written after the renderer's own rays and photons, at UB.optOffset; `pix` is past the learned
  map, so these photons never teach the sun's emission map anything.
======================================================================================================================*/
/* optCount this batch's photons, optTotal the sample's (core/photons.js planBatches: a sample in batches since 0.38.1) --
   what the flux was divided by, and so what the MIS density is multiplied by */
export const OPT_PHOTON_UNIFORMS = { optOffset: 'u32', optCount: 'u32', optTotal: 'u32', optFluxPerPhoton: 'f32' }
/* NO SCENE IN IT (0.34.2): the text holds no scene, and what it reads from the uniforms is the seed, the march's
   tolerance (eps, epsAuto, sceneUnit) and its own four (optics/test/drawn.test.mjs walks it from main) -- none of them
   a scene's. It took the scene's uniforms into its struct all the same, so each scene was a kernel of its own, compiled
   when that scene was first shown; until then the picture had no lights' photons (index.js pictureSource `ready`). The
   builder's bake swaps in a scene whose only uniforms are its boxes, a new struct, a compile: the light-traced lights
   went off for the frames it took, into a picture kept (the user, 2026-10-07: "the light goes off once or twice right
   after the bake compile"). Made once, it serves every scene. */
export let prog_opt_photons = async (WG) =>
    await WG.makeCompute(`${PRIMITIVES};${DEFINITIONS}${SOURCE_RAY}`,
        /*wgsl*/`
        let id = gid.x;
        if (id >= UB.optCount) { return; }
        var ray = optSourceRay(id);
        // flux, lm: its luminance is the number, and the light's hue is on beta (luminance 1)
        ray.radiance = VEC3(UB.optFluxPerPhoton);
        // its density times the count: the light's radiance this way over this flux (Ray.ltMis)
        if (ray.ltMis > 0.0) { ray.ltMis *= f32(max(UB.optTotal, UB.optCount)); }
        ray.tag = TAG_PHOTON | TAG_OPTIC | TAG_LTALL;
        ray.pix = 0xFFFFFFFFu;                      // no cell of the learned map
        rayBuffer0[UB.optOffset + id] = ray;
        `,
        { ...computeUniformTypes(), ...OPT_UNIFORMS, ...OPT_PHOTON_UNIFORMS },
        { rayBuffer0: 'array<Ray>', optSources: 'array<vec4<f32>>', optRays: 'array<vec4<f32>>' },
        { wg: [64, 1, 1], readOnly: ['optSources', 'optRays'] }
    )

/*======================================================================================================================
  SHADE -- one interaction per ray, and the bookkeeping the renderer has no use for.

  For each ray the march handed over:
    escaped   its weight to ESCAPED; the path gets a last segment up to the maximum distance
              (optMaxDist), or optEscLen long without one; and into the far field by its direction,
              when that is what feeds it (optFar.z FAR_ESCAPED)
    too far   a hit beyond optMaxDist: the ray stops at the limit, its weight to LOST
    ran out   (march steps, optical length, the last pass) its weight to LOST
    a detector  (a detector or limiter material, arriving from outside): the ray stops there, all
              its weight to the object's INCIDENT and to DETECTED, and the hit is recorded -- and
              into the far field by its arriving direction when this detector feeds it (FAR_DETECTOR)
    every ray what the medium it travelled in absorbed on the way (O_VOL), before any of the below
    a surface which object (the capture pass) and material; the incoming weight to that object's
              INCIDENT, processMaterial, then whatever leaves to its LEAVING -- absorbed is the
              difference, which is why it can be read per object without a signed tally. An
              emitter ends the ray (it is a source, not a reflector): everything absorbed. A ray
              the bounce cap ends is counted as leaving and as LOST, so
                emitted = escaped + lost + volume + sum over objects (incident - leaving)
              holds exactly, and the bench checks it.
  A ray that is still going is parked for the next step (optStep 1) or goes straight back to the
  march (optStep 0).

  processMaterial can decline to interact -- a hit seen from behind is nudged on and returned (see
  the `light < 0.0` test in tracebasics.js). Its bounce count does not move, and neither does
  anything here.
======================================================================================================================*/
export let prog_opt_shade = async (WG, scene, wgsize = 64) =>
    await WG.makeCompute(`${SCENE_PRELUDE}${PROCESSOR}${sceneConstantsWGSL(scene)}${scene.opticsPickWgsl ?? scene.pickWgsl ?? scene.wgsl}${PROCESSING}${PROCESSING_ASKS}${LAYOUT}`,
        /*wgsl*/`
        let rayindex = gid.x;
        let shadeCount = atomicLoad(&counters.shadeCount);
        if (rayindex >= shadeCount) { return; }
        var hit = shadeBuffer[rayindex].hit;      // the renderer's march writes the hit of a shade queue item (scene_api.js ShadeItem)
        /* THE MEDIUM'S ABSORPTION on the way here, as the renderer's shade applies it on arrival (tracebasics.js
           absorbAlong) -- and what it took, to its own tally (O_VOL): everything below reads the ray as it arrives */
        let wTravel = optWeight(hit.r);
        hit.r = absorbAlong(hit.r);
        var ray = hit.r;
        /* SEEDED BY THE RAY, not by its slot: the slot depends on the order atomics happened to run
           in, the ray's id and bounce count do not. With one seed per trace, retracing with one more
           step reproduces the first N legs exactly and only adds the next -- which is what makes the
           page's step slider show the same rays growing rather than new ones each time. */
        SEED_uvec4(UB.seed);
        SEED_u32(ray.pix);
        SEED_u32(ray.bounces);
        let id = ray.pix;
        let wIn = optWeight(ray);
        optAdd(O_VOL, wTravel - wIn);

        if (ray.state == RAY_ESCAPED) {
            optAdd(O_FLUX + F_ESCAPED * 2u, wIn);
            atomicAdd(&optData[O_COUNT + C_ESCAPED], 1u);
            if (UB.optFar.z == FAR_ESCAPED) { optFarAdd(ray.dir, wIn); }
            if (id < UB.optPathRays) {
                if (UB.optMaxDist > 0.0) {
                    // drawn up to the maximum distance: back along its line from where it left, by
                    // the optical length it has beyond that, over the index of the medium it is in
                    let over = max(ray.ltot - UB.optMaxDist, 0.0);
                    optVertex(id, ray.pos - ray.dir * (over / max(ray.n, 1e-6)), wIn, ray.ltot - over, optHue(ray));
                } else {
                    // drawn optEscLen beyond its last vertex, in the medium it left in (ray.n)
                    let lv = optLastVertex(id);
                    optVertex(id, lv.xyz + ray.dir * UB.optEscLen, wIn, lv.w + UB.optEscLen * ray.n, optHue(ray));
                }
            }
            return;
        }
        if (ray.state != RAY_ACTIVE) {                 // the march ran out: steps, length, last pass
            optAdd(O_FLUX + F_LOST * 2u, wIn);
            atomicAdd(&optData[O_COUNT + C_LOST], 1u);
            optVertex(id, ray.pos, wIn, ray.ltot, optHue(ray));
            return;
        }

        /* PAST THE MAXIMUM DISTANCE: this hit is further along the ray than the trace goes. The ray
           stops where its optical path reaches the limit -- counted with the rays still going, like
           the bounce cap -- and it never gets to interact here. */
        if (UB.optMaxDist > 0.0 && ray.ltot > UB.optMaxDist) {
            let over = ray.ltot - UB.optMaxDist;
            optAdd(O_FLUX + F_LOST * 2u, wIn);
            atomicAdd(&optData[O_COUNT + C_LOST], 1u);
            optVertex(id, ray.pos - ray.dir * (over / max(ray.n, 1e-6)), wIn, UB.optMaxDist, optHue(ray));
            return;
        }

        /* A TRANSPARENT SOURCE is not there for the trace: on through it, unchanged -- no
           interaction, no tally, back to the march like a hit seen from behind (below) */
        if (optIsPass(hit.m)) {
            var through = moveBy(ray, ray.dir * offsetTol(ray.pos) * 2.0);
            let read0 = counters.readfrom == 0u;
            if (read0) { let k = atomicAdd(&counters.buf1count, 1u); marchBuffer1[k] = through; }
            else { let k = atomicAdd(&counters.buf0count, 1u); marchBuffer0[k] = through; }
            return;
        }

        // WHICH OBJECT: the pick kernel's capture pass, once per interaction (scene_api.js)
        tagCaptureBegin();
        _ = sceneAt(ray, true);
        let tag = min(tagCaptureEnd(), OPT_TAGS - 1u);
        let mat = min(hit.m, OPT_MATS - 1u);
        let bounces0 = ray.bounces;

        /* A DETECTOR STOPS THE RAY -- a surface whose material is a detector or a limiter -- and
           records it (optRecordHit), whatever the material's fields say -- but only
           a real arrival: the same facing test processMaterial applies (normal towards the ray,
           flipped inside), or a ray just leaving a detector's surface would be caught by it. */
        var dn = hit.s.xyz;
        if (dot(dn, dn) == 0.0 || UB.fastnormals == 0) { dn = calcNormals_fast(hit.r, hit); }
        if (hit.s.w < 0.0) { dn = -dn; }
        if (optIsDetector(hit.m) && dot(-hit.r.dir, dn) >= 0.0) {
            optAdd(O_TAG + tag * 5u, wIn);
            atomicAdd(&optData[O_TAG + tag * 5u + 4u], 1u);
            optAdd(O_MAT + mat * 5u, wIn);
            atomicAdd(&optData[O_MAT + mat * 5u + 4u], 1u);
            optAdd(O_FLUX + F_DETECTED * 2u, wIn);
            atomicAdd(&optData[O_COUNT + C_DETECTED], 1u);
            atomicAdd(&optData[O_COUNT + C_INTERACTIONS], 1u);
            optVertex(id, hit.r.pos, wIn, hit.r.ltot, optHue(hit.r));
            optRecordHit(hit.r.pos, wIn, hit.r.dir, tag, hit.r.beta * hit.r.radiance);
            // the far field of what reaches THIS detector, by the direction it arrives along
            if (UB.optFar.z == FAR_DETECTOR && hit.m == UB.optFar.w) { optFarAdd(hit.r.dir, wIn); }
            return;
        }

        ray = processMaterial(hit);
        if (ray.bounces == bounces0) {                 // declined (seen from behind): not an interaction
            if (ray.state == RAY_ACTIVE) {
                let read0 = counters.readfrom == 0u;
                if (read0) { let k = atomicAdd(&counters.buf1count, 1u); marchBuffer1[k] = ray; }
                else { let k = atomicAdd(&counters.buf0count, 1u); marchBuffer0[k] = ray; }
            }
            return;
        }

        atomicAdd(&optData[O_COUNT + C_INTERACTIONS], 1u);
        optVertex(id, hit.r.pos, wIn, hit.r.ltot, optHue(hit.r));
        let goesOn = ray.state == RAY_ACTIVE || ray.state == RAY_TERMINATED;
        let wOut = select(0.0, optWeight(ray), goesOn);
        optAdd(O_TAG + tag * 5u, wIn);
        optAdd(O_TAG + tag * 5u + 2u, wOut);
        atomicAdd(&optData[O_TAG + tag * 5u + 4u], 1u);
        optAdd(O_MAT + mat * 5u, wIn);
        optAdd(O_MAT + mat * 5u + 2u, wOut);
        atomicAdd(&optData[O_MAT + mat * 5u + 4u], 1u);
        if (!goesOn) { atomicAdd(&optData[O_COUNT + C_ABSORBED], 1u); }

        if (ray.state == RAY_TERMINATED) {             // the bounce cap: it left, but nothing follows it
            optAdd(O_FLUX + F_LOST * 2u, wOut);
            atomicAdd(&optData[O_COUNT + C_LOST], 1u);
            return;
        }
        if (ray.state != RAY_ACTIVE) { return; }

        if (UB.optStep != 0u) {
            let k = atomicAdd(&optData[O_PARK], 1u);
            parked[k] = ray;
        } else {
            let read0 = counters.readfrom == 0u;
            if (read0) { let k = atomicAdd(&counters.buf1count, 1u); marchBuffer1[k] = ray; }
            else { let k = atomicAdd(&counters.buf0count, 1u); marchBuffer0[k] = ray; }
        }
        `,
        { ...computeUniformTypes(scene.uniforms), ...OPT_UNIFORMS },
        {
            marchBuffer0: 'array<Ray>',
            marchBuffer1: 'array<Ray>',
            shadeBuffer: 'array<ShadeItem>',
            counters: counterstruct,
            learn: 'array<atomic<u32>>',          // the GGX tables processMaterial samples
            optData: 'array<atomic<u32>>',        // tallies and paths (layout above)
            parked: 'array<Ray>',                 // rays waiting for the next step
            ...(scene.resources || {}),
        },
        // off-thread like every kernel that inlines the scene (see prog_march in wavefront.js)
        { async: true, wg: [wgsize, 1, 1] }
    )
