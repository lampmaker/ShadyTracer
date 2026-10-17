import { MARCH_TOL_WGSL } from './tolerances.js'


//=====================================================================================================
/* LIGHT TRACING'S LEARNED EMISSION MAP: LT_GRID x LT_GRID cells over the square photons cross
   the scene through. Exported so the host sizes the buffers from the same numbers the WGSL
   uses -- the two cannot drift. See THE EMISSION FRAME in sdf.js and prog_lt_build. */
export const LT_GRID = 128
export const LT_CELLS = LT_GRID * LT_GRID
/* The share of photons that ignore what has been learned and go uniformly over the square.
   It is what keeps the estimator unbiased while the map is wrong: every cell keeps a density
   of at least LT_FLOOR / LT_CELLS, so nothing the split hands to the photons is ever
   unreachable, and a caustic the map has not found yet is still found, just slowly. */
export const LT_FLOOR = 0.2

/* EMISSIVE SURFACES AS LIGHTS -- the layout of the one "learn" buffer the shade kernel writes.
   It holds light tracing's connection counts AND the emitter discovery AND the emitter list,
   one binding for three things, because prog_shade is at the spec floor of 8 storage
   bindings and a ninth is an adapter that will not run it.
     [0, LT_CELLS)              connections per sun-photon cell (was ltHit)
     [EV_BASE, +EG_CELLS*8)     per voxel of the emitter grid: min xyz, max xyz (quantised
                                over +-emitHalf), emission weight, hit count
     [EL_TMP, +1+EMIT_MAX*8)    the build's scratch list: count, then c.xyz, r, score per box
     [EL_SNAP, +1+EMIT_MAX*8)   THE SNAPSHOT sampling reads: count, then per box c.xyz, r,
                                P, cdf, 1/(4 PI^2 r^2), pad -- f32 bits in u32 words
     [LF_BASE, +2+FACE_MAX*LF_WORDS)  THE LIGHTS' FACES as light sampling reads them in shade: count,
                                the sum of their weights, then each face's LightFace (FACE_TABLE
                                below) -- written by the surface kernel from the scene's own
                                lightFace, so shade holds no scene (0.20.8)
   See EMISSIVE SURFACES in materials_pbr.js for what each is for. A fourth thing in the same binding
   for the same reason: shade is still at 8. */
export const EG = 16
export const EG_CELLS = EG * EG * EG
export const EMIT_MAX = 64
export const EV_BASE = LT_CELLS
export const EL_TMP = EV_BASE + EG_CELLS * 8
export const EL_SNAP = EL_TMP + 1 + EMIT_MAX * 8
/* FACE_MAX: the table's room, 96 KiB of the buffer. A scene with more lights than this is refused when
   its kernels are made (wavefront.js prog_surface, by the count its text declares), never sampled short:
   a face left out of the table would be missing from light sampling's total while the scene's own MIS
   weight counted it. */
export const LF_BASE = EL_SNAP + 1 + EMIT_MAX * 8
export const LF_WORDS = 24
export const FACE_MAX = 1024
export const LEARN_WORDS = LF_BASE + 2 + FACE_MAX * LF_WORDS

/* THE BYTES A RAY AND A SHADE QUEUE ITEM TAKE IN A STORAGE BUFFER -- the WGSL structs' strides: Ray (below, 112: four
   vec3s 16 apart, a scalar in the padding after each of the first three, then thirteen scalars from byte 60 -- no
   padding left since 0.37.0) and scene_api.js ShadeItem (272: the 144-byte Hit, then the Surface the surface kernel
   writes beside it -- a Material2 of 96, a vec3 and a scalar, a vec3 rounded to 16; 288 from 0.44.0 to 0.60.0, the
   manifold connection's answer beside them, 256 before 0.39.0 put a coating in the material, 240 before 0.37.0 put
   the medium beyond's absorption in it). The engine sizes
   its buffers by them (raytrace_main.js rayStuctSize, hitStructSize), the optics module its own, the tests read hits
   with them. They were three copies of a comment saying "MUST match the WGSL structs", which nothing checked; one place
   now, and test/structs.gpu.mjs asks a real WGSL compiler for the strides (0.22.4). */
export const RAY_BYTES = 112
export const SHADE_ITEM_BYTES = 272

/* EMITTER BRIGHTNESS, LOG-ENCODED for the discovery grid. An emitter's brightness is kept with
   atomicMax, so it has to be a u32 whose order is the luminance's order. It was
   u32(clamp(lum, 0, 1e5) * 16): linear, and saturating at 1e5 -- fine while emission was
   "5 per channel", useless in cd/m^2, where a bright panel is 2e4 and the sun seen in a mirror
   is 1.6e9, and everything above the cap ranked equal. log2 is monotone, so atomicMax still
   keeps the brightest; 80 stops (2^-40 .. 2^40 cd/m^2) across 24 bits is 2e-5 of a stop per
   step. 0 stays "never seen", which is why the code starts at 1.
   LUM_DECAY is the tenth-per-build fade, as a subtraction in the log domain: x 0.9. */
export const LUM_CODE = /*wgsl*/`
const LUM_K: f32 = 209715.2;                     // 2^24 / 80 codes per stop
const LUM_DECAY: u32 = 31877u;                   // round(-log2(0.9) * LUM_K)
fn lumEncode(lum: f32) -> u32 { return u32(clamp(log2(max(lum, 1e-30)) + 40.0, 0.0, 80.0) * LUM_K) + 1u; }
fn lumDecode(q: u32) -> f32 { return select(0.0, exp2(f32(q - 1u) / LUM_K - 40.0), q > 0u); }
`

/* THE TOLERANCES AND LENGTHS, as one snippet: DEFINIES below carries them to nearly every kernel, and the
   emitter grid's reader (wavefront.js prog_emit_collect), which takes none of DEFINIES, its margin from the
   same offsetEps -- one definition, as the march's and the aim's hit distance must be one length. They name UB:
   only into a kernel that binds the uniforms and reaches them (check-shaders, UNREACHABLE). Why each is what it
   is: the comment where DEFINIES places them. */
export const ENGINE_UNITS_WGSL = /*wgsl*/`
        // UB.eps 0 = automatic: UB.epsAuto, a share of the scene's size (photometry.js autoEps). Metres, both.
        fn tolSetting() -> FLOAT { return select(UB.epsAuto, UB.eps, UB.eps > 0.0); }
        /* THE ENGINE'S LENGTHS, IN METRES (0.36.0; lib/pathtracer/PRECISION.md), at a point p of the engine's world:
           the march's hit test, the normal's difference step, the step off a surface. Every kernel's own code asks
           these, never the scene's below (core/unitlint.js checks it). NEVER FINER THAN f32 CAN RESOLVE AT p:
           core/tolerances.js says why the floor is what it is, and generates this from the numbers its JS twin and
           test/floor.test.mjs use. It was 1e-7 of a SCENE unit: 0.1 nm in a mm scene, which is no floor at all. */
        ${MARCH_TOL_WGSL}
        fn normalTol(p: VEC3) -> FLOAT { return marchTol(p); }     // normal finite differences
        fn offsetTol(p: VEC3) -> FLOAT { return 10.0 * marchTol(p); }  // leaving a surface
        /* metres per scene unit, and scene units per metre: the boundary's two factors (scene_api.js SCENE_BOUNDARY).
           Both from the host in double precision, and multiplied by, never divided by: 1, 100 and 1000 are exact in
           f32 and WGSL's division is not exact (2.5 ulp), so a metre scene's conversions are exact by the spec. */
        fn engPerScene() -> FLOAT { return UB.sceneUnit; }
        fn scenePerEng() -> FLOAT { return UB.perMetre; }
`
/* ...AND THE SCENE'S, apart, so core/unitlint.js can tell the two sides by where they are written */
export const SCENE_UNITS_WGSL = /*wgsl*/`
        /* THE SCENE'S, in SCENE UNITS: what a scene's own WGSL calls (the builder's exact hits, culling, reliefs,
           materials sized in mm). SCN_TOL is the engine's tolerance at the point the engine asked the scene about,
           set by the boundary (sceneAt, materialAt) for the length of the call: a scene's tolerance is then always
           the engine's hit test where it is asked. 0 outside such a call -- a kernel that asks the scene directly
           in its own units (core/field.js) -- where it is the setting's. */
        var<private> SCN_TOL: FLOAT = 0.0;
        fn marchEps() -> FLOAT { return select(marchTol(VEC3(0.0)) * scenePerEng(), SCN_TOL, SCN_TOL > 0.0); }
        fn normalEps() -> FLOAT { return marchEps(); }
        fn offsetEps() -> FLOAT { return 10.0 * marchEps(); }
        fn metres(x: FLOAT) -> FLOAT { return x * scenePerEng(); }  // a length in m, in scene units
        // ...and in mm: a material's detail is sized in real millimetres whatever the scene's unit
        fn mm(x: FLOAT) -> FLOAT { return metres(x * 0.001); }
`
export const EPS_WGSL = ENGINE_UNITS_WGSL + SCENE_UNITS_WGSL

let DEFINIES = /*wgsl*/`
${LUM_CODE}
// GLOBAL DEFINES
        //globals

        // Ray state constants
        const RAY_ACTIVE: u32 = 0u;
        const RAY_ABSORBED: u32 = 1u;
        const RAY_ESCAPED: u32 = 2u;
        const RAY_HIT_TARGET: u32 = 3u;
        const RAY_MAXITER: u32 = 4u;
        const RAY_SOURCE: u32 = 5u;
        const RAY_ERROR: u32 = 6u;
        const RAY_SHADOWED: u32 = 7u;
        const RAY_TERMINATED: u32 = 8u;

        // Ray marching parameters
        /* THE EPSILON SLIDER DID NOTHING. UB.eps has been in the schema and on the GUI since
           before this file was reorganised, and the marching used this constant instead, so
           dragging it changed no pixel. It is the main quality-for-speed dial an SDF tracer
           has -- the sibling project's biggest single win came from loosening exactly this --
           so it is wired up rather than removed. The constant stays as the floor: 0 would
           never terminate. */
        /* IN METRES, the engine's unit since 0.36.0 (lib/pathtracer/PRECISION.md); the scene
           meets them in its own unit only through the boundary (scene_api.js SCENE_BOUNDARY).
           normalEps and offsetEps were the constants NORMAL_EPS and OFFSET_EPS, in scene
           units; then fixed LENGTHS -- 1 mm and 10 mm -- which is right for a room and wrong for
           an LED: a 10 mm step off a surface carries a refracted ray clean through a 6 mm lens.
           So every one follows the march tolerance, the one that is a setting (core/tolerances.js
           lists each use and its multiple). An earlier note here called a 0.01-unit offset in a
           mm scene "below f32 spacing" a few hundred units out: it is not -- f32's spacing at 500
           is 3.1e-5 -- and the unit changes no precision at all; distance from the origin does,
           which is what marchTol's floor follows. */
        ${EPS_WGSL}
        /* A LOOP BOUND THE COMPILER CANNOT SEE: n plus a uniform that is always 0. Every compiler
           behind WebGPU inlines every call, so each call to SDF() is a whole copy of the scene, and a
           loop with a constant bound around one is unrolled into that many copies. The march used a
           constant 32 so it WOULD unroll; the Noise library scene then held about a hundred copies
           of itself across march, occlude and shade and took over a minute to compile (2026-09-29).
           Around an SDF call, or inside anything an SDF calls, a loop takes its bound from here. */
        fn noUnroll(n: u32) -> u32 { return n + UB.opaqueZero; }

    /* RADIANCE_CLAMP IS GONE, and with it the reason for it. It capped every path at 1e4 so a
       u32 fixed-point frame buffer could not overflow; the frame and splat buffers hold f32
       now (see DEPOSIT in wavefront.js), and a sunlit wall at 25 000 cd/m^2 is not a firefly.
       What is left is UB.fireflyClamp, off by default, which is a choice rather than a guard.
       MAXSOURCES, DIRECT_CLAMP and uMinFlux went too: declared, never read. */

    /*==============================================================================================
      LIGHT TRACING -- the vocabulary. See LIGHT TRACING in materials_pbr.js for the method.

      Ray.tag bits. A photon is a ray that started at the sun; a connection is the shadow ray a
      photon sends to the camera; the two CLS bits track, on a CAMERA path, whether it belongs to
      the class of paths the light tracer is responsible for, so that class is not counted twice.
    ==============================================================================================*/
    const LT_GRID: u32 = ${LT_GRID}u;
    const LT_CELLS: u32 = ${LT_CELLS}u;
    const LT_FLOOR: FLOAT = ${LT_FLOOR};
    const EG: u32 = ${EG}u;
    const EG_CELLS: u32 = ${EG_CELLS}u;
    const EMIT_MAX: u32 = ${EMIT_MAX}u;
    const EV_BASE: u32 = ${EV_BASE}u;
    const EL_TMP: u32 = ${EL_TMP}u;
    const EL_SNAP: u32 = ${EL_SNAP}u;
    const LF_BASE: u32 = ${LF_BASE}u;
    const LF_WORDS: u32 = ${LF_WORDS}u;
    const FACE_MAX: u32 = ${FACE_MAX}u;
    const TAG_PHOTON: u32 = 1u;     // this ray is a photon walking from the sun
    const TAG_CONN:   u32 = 2u;     // this shadow ray connects a photon vertex to the camera
    const TAG_PASSED: u32 = 4u;     // photon: has passed at least one delta event
    const CLS_CAND:   u32 = 8u;     // camera path: first vertex scattered by an evaluable lobe
    const CLS_SPEC:   u32 = 16u;    // camera path: ...and only delta events since
    const TAG_EMIT:   u32 = 32u;    // shadow ray aimed at an emitter: counts the emission it hits
    const TAG_PROBE:  u32 = 64u;    // a line looking for an emissive surface to start a photon on
    /* An OPTICS ray (lib/pathtracer/optics): a photon of the technical ray trace, which carries
       flux through EVERY event -- diffuse and glossy too -- instead of stopping at the first real
       scatter, and never connects to the camera. Always set together with TAG_PHOTON, so NEE,
       emitter hits and the rest treat it as a photon; only the two rules below read this bit. */
    const TAG_OPTIC:  u32 = 128u;
    /* ...and an optics photon that LIGHTS THE PICTURE (optics/kernels.js prog_opt_photons): it
       connects to the camera at every surface it lands on, not only after a delta event, because
       its source is not geometry and no camera path can count any of its light. */
    const TAG_LTALL:  u32 = 256u;
    /* A DRAFT SEEK RAY (materials_pbr.js FAST MODES): a camera path Draft has ended, sent one
       segment on with nothing on it, to discover an emitter the camera cannot see. Set after the
       class bits below are written at bounce 1, which overwrite the whole tag. */
    const TAG_SEEK:   u32 = 512u;
    /* A CAMERA PATH WHOSE LIGHTS ARE THE PHOTONS': its first surface scattered by a lobe a
       connection evaluates (EV_EVAL), in air, while the lights' photons run (UB.ltLights). Those
       photons connect at exactly that vertex through exactly those lobes (ltConnect, from LT_MIN_ALPHA up),
       so a light's face this path meets later shows it nothing (codegen LIGHTS); every other
       camera path counts the face itself. Set once, at the first surface, never cleared. A face met
       at bounce 2 is the exception either way: that direct path both sides make, and they share it
       by MIS (Ray.ltMis, PLAN.md L4b). */
    const CLS_LIGHTS: u32 = 1024u;
    /* A SHADOW RAY OF LIGHT SAMPLING TOWARDS A LIGHT'S FACE (PLAN.md L7): aimed at a point on the
       face, it stops at tmax, just short of it, as a connection stops at the camera (occlusion
       kernel), and what it carries goes into the frame if nothing was in the way. */
    const TAG_FNEE:   u32 = 2048u;
    /* THE PHOTON MAP'S CLASS (sppm.js; named for the lens whose photons owned it from 0.43.0 to 0.60.0): two fields of
       two bits, one a photon's and one a camera path's, each its place in the pattern  delta+ -> D (EV_EVAL) -> delta+.
       A photon's (bits 14-15): 0 delta events only so far (TAG_PASSED says whether there was one), 3 it has scattered
       (1 and 2 were the lens's photon at D and armed for the lens: gone in 0.61.0). A camera path's (bits 12-13): 0 out
       of it, 1 only delta events from the eye -- it gathers where it lands -- 2 then D, 3 then a delta again -- ARMED,
       the light it reaches now is the map's. Read and written by lensField and withLensField (materials_pbr.js). */
    const LENS_CAM_SHIFT: u32 = 12u;
    const LENS_PH_SHIFT:  u32 = 14u;
    /* BIT 16 IS FREE (0.61.0): it was TAG_LENS_ONE, the manifold connection's part of the class, from 0.44.0, taken from
       the wavelength. Left free rather than handed back: the wavelength's 15 bits are steps of 0.012 nm, and flags are
       what ran out. */
    /* THE RAY'S WAVELENGTH, NOT A FLAG (0.40.0; spectral.js rayLambda, withLambda): the tag's upper 15 bits (16 until 0.44.0), 0 for a
       ray that has none -- the Ray had no padding left. A NEW FLAG STAYS BELOW BIT 17 (bit 16 is free since 0.61.0; the
       class's fields hold bits 12-15), and a write of a whole tag that a
       wavelength must outlive keeps these bits (pathEnd's at a path's first surface). Starting a ray, and a shadow
       ray, which carries an answer and never refracts, may write the tag whole. */
    const TAG_LAMBDA_MASK: u32 = 0xFFFE0000u;

    /* A LIGHT'S FACE AS LIGHT SAMPLING SEES IT (the scene's lightFace(i); codegen LIGHTS): its world
       frame -- centre, the unit axes of its sheet and its normal -- its half sizes (a disc's radius
       twice), 1 a disc or 2 a rectangle, whether both faces emit, its colour times its luminance
       straight out, its beam (lights.js beamOf), and a weight for picking it: 0 when it is not drawn. */
    struct LightFace {
        centre: VEC3,
        u: VEC3,
        v: VEC3,
        n: VEC3,
        half: VEC2,
        shape: u32,
        twoSided: u32,
        le: VEC3,
        beam: vec4<f32>,
        weight: f32,
    }
    /* How much of light sampling goes to light faces where it may (lightFaceShare, scene_api.js). */
    const FACE_NEE_SHARE: FLOAT = 0.5;

    /* What kind of event the material just sampled. The split between the two estimators is
       defined by these, so the material code sets them in exactly one place per branch.
         DELTA  a smooth reflection or refraction: one direction, no density. Only a walk can
                follow it; nothing can connect through it.
         EVAL   a lobe that ltConnect can evaluate for an arbitrary pair of directions: the
                diffuse lobe, and GGX reflection at alpha >= LT_MIN_ALPHA.
         OTHER  a real scatter that is neither: rough refraction (no evaluable BTDF here), GGX
                too narrow to connect without fireflies, rough TIR.
         NONE   nothing scattered: an emitter, or a vertex the ray left without touching. */
    const EV_NONE:  u32 = 0u;
    const EV_DELTA: u32 = 1u;
    const EV_EVAL:  u32 = 2u;
    const EV_OTHER: u32 = 3u;

    /* Below this GGX alpha a glossy lobe is left to BSDF sampling rather than connected to.
       A connection evaluates f directly, and f of a lobe this narrow is ~1/(PI alpha^2) at its
       peak: a photon that happens to land in it is a firefly. Both sides of the split read this
       one constant, so moving it moves the boundary, never the total. */
    const LT_MIN_ALPHA: FLOAT = 0.05;
`

let UNIFORMS =/*wgsl*/`
// UNIFORM VARIABLES.  DEFINE as constants for now
   
  //  const UB.tracelights: u32 = 0; // trace lights in the scene, 0 = no lights, 1 = trace lights
   // const UB.maxiter: u32 = 100u; // maximum number of iterations for ray marching
  
//    const uSeed: vec4<u32>= vec4<u32>(0xA53B3F17u, 0xC0FFEE42u, 0xDEADBEEFu, 0x12345678u); // seed for noise functions
    const uRRStart: u32 = 3u;     // start russian roulette after this many bounces
    const RR_MIN_P: FLOAT = 0.1;  // min continuation probability
    const RR_MAX_P: FLOAT = 0.95; // max continuation probability
      
   // const view_inverse: mat4x4<f32> = mat4x4<f32>(1.0, 0.0, 0.0, 0.0,0.0, 1.0, 0.0, 0.0,0.0, 0.0, 1.0, 0.0,0.0, 0.0, 0.0, 1.0);
   // const projection_inverse: mat4x4<f32> = mat4x4<f32>(1.0, 0.0, 0.0, 0.0,0.0, 1.0, 0.0, 0.0,0.0, 0.0, 1.0, 0.0,0.0, 0.0, 0.0, 1.0);
    
   // const exposure: FLOAT=1.;
   // //const gamma: FLOAT=2.2;  // exposure =s log scale -30,,30

`







//=====================================================================================================
let NOISE =/*wgsl*/`
// NOISE FUNCTIONS
        const NOISE_HX: vec4<u32> = vec4<u32>(2313257647u, 2700274807u, 3152041561u, 3679390633u);
        var<private> NOISE_H: vec4<u32>;              // internal state

        fn SEED_u32(v: u32) { NOISE_H = (NOISE_H.yzwx ^ vec4<u32>(v)) * NOISE_HX;}
        fn SEED_float(v: FLOAT) { SEED_u32(bitcast<u32>(v));}
        fn SEED_uvec4(seed: vec4<u32>) { NOISE_H = seed;}
        fn SEED_vec4(pos: VEC4) {SEED_float(pos.x);SEED_float(pos.y);SEED_float(pos.z);SEED_float(pos.w);}
        fn SEED_vec3(pos: VEC3) {SEED_vec4(VEC4(pos, 1.0));}
        fn SEED_vec2(pos: VEC2) {SEED_vec4(VEC4(pos, pos));}
        fn SEED_default() {NOISE_H = vec4<u32>(0xA53B3F17u, 0xC0FFEE42u, 0xDEADBEEFu, 0x12345678u);}

        /* -----------------------------------------------------------------------------
           PRNG -- four uniform numbers in [0,1), each with 24 bits of resolution.

           IT USED TO CAP HOW FAR A RENDER COULD CONVERGE. The output was
           fract(f32(state) / 671040.0), and both halves of that throw bits away: f32 of a
           u32 keeps only the top 24 bits, and dividing by ~2^19.4 then taking fract keeps
           only what lands below the binary point -- for half of all draws (state >= 2^31)
           that is a grid of 256/671040, about 1/2600. Worked out exactly for a perfectly
           uniform state, the probability of landing in a window of width 1e-4 ranged from
           0.08x to 3.2x what it should be depending on where the window sat, and at 1e-3
           from 0.96x to 1.29x. Nothing about that averages away: a small sun is a small
           window in sample space, each pixel sees it at a different place on the grid, and
           each pixel converged -- confidently -- to its own wrong answer. A test image with
           a small bright sun and no NEE stopped improving at a fixed level of "noise" that
           was really per-pixel bias. The state update had no right shifts either, so bits
           only ever flowed upward and the low bits were poor.

           Now: PCG4D (Jarzynski & Olano, "Hash Functions for GPU Rendering", JCGT 2020) as
           the state update, and the top 24 bits of each lane as the float -- exactly
           representable in f32, so the grid is 2^-24 and uniform. The SEED_ functions are
           unchanged: the first PRNG() call runs the state through pcg4d, which mixes all
           128 bits across all four lanes, so what the seeding lacks in avalanche does not
           reach the output. */
        fn pcg4d(a: vec4<u32>) -> vec4<u32> {
            var v = a * 1664525u + 1013904223u;
            v.x += v.y * v.w;  v.y += v.z * v.x;  v.z += v.x * v.y;  v.w += v.y * v.z;
            v ^= v >> vec4<u32>(16u);
            v.x += v.y * v.w;  v.y += v.z * v.x;  v.z += v.x * v.y;  v.w += v.y * v.z;
            return v;
        }

        fn PRNG() -> VEC4 {
            NOISE_H = pcg4d(NOISE_H);
            return VEC4(NOISE_H >> vec4<u32>(8u)) * (1.0 / 16777216.0);
        }




        `
//===========================================================================================================
let RAYS =/*wgsl*/`
// RAY STRUCTURES


        // Ray object----------------------------------------------------------------------------------
      /* THE MEDIUM'S ABSORPTION (0.37.0; materials.js mediumMu): muR, muG, muB are the coefficient per metre of the
         medium the ray is in, as n is its index -- set where n is, at a transmission (processMaterial_advanced) and
         where a photon starts (probeEnd), 0 in air. They sit in the 4 bytes after each of the first three vec3s, which
         the struct was paying for as padding, so no field before them moved (the GPU tests write and read rays by
         word: the builder's .gpu.mjs tests) and the Ray stays 112. absLtot, the last free word, is the ltot up to which the
         absorption has been applied (absorbAlong); the rest is applied where a ray arrives (prog_shade, prog_opt_shade)
         or deposits (prog_occlude). */
      struct Ray {  // 18 * 4 = 72 btyes
            pos: vec3<f32>,                 // 0..11
            muR: f32,                       // 12
            dir: vec3<f32>,             // 16..27
            muG: f32,                   // 28
            radiance: vec3<f32>,    // 32..43
            muB: f32,               // 44
            beta    : vec3<f32>,    // 48..63
            /* TWO COUNTS IN ONE WORD (0.69.0; the Ray had no room for a field more). The low 16 bits are the march's
               steps over the whole path, capped by UB.maxiter (at most 2000); the high 16 are the DIFFUSE BOUNCES so far,
               the EV_EVAL events a camera path or a light's photon has drawn, for UB.diffuseCap (pathEnd). Read only
               through raySteps and rayDiffuse below, and named counts, not steps, so a read of the old field fails
               to compile rather than seeing the diffuse bounces as thousands of steps. A march step is += 1u, a diffuse
               bounce += DIFFUSE_ONE. */
            counts: u32,            // 60
            n: f32,                 //81
            ltot: f32,              //82
            bounces: u32,           //83
            state: u32,             //84
            pix: u32,               //85
            /* How much of the SOLAR DISC this ray may collect if it escapes to the sky.
               1.0 for a ray nothing has sampled the sun for; 0.0 once a bounce has done
               next-event estimation towards it, because the light is then already in
               radiance and counting it again on escape would double it. Carried on the
               ray rather than recomputed because only the bounce that made the decision
               knows what it did. Four vec3s pad to 64 bytes and the scalars to 32, so
               this rides in space the struct was already paying for. */
            sunmis: f32,            //86
            /* LIGHT TRACING bits -- TAG_* and CLS_* above. Bytes 88..91, which the struct was
               already paying for: four vec3s pad to 64 and it rounds to 96. */
            tag: u32,               //87
            /* How far a TAG_CONN shadow ray may travel before it has reached the camera. Every
               other shadow ray runs until it leaves the scene; a connection must stop AT the
               camera, or geometry behind the camera would block it. Bytes 92..95, the last
               free ones -- the next field makes the Ray 112 bytes. */
            tmax: f32,              //88
            /* MIS AGAINST EMITTER HITS needs, at the hit, what the LAST scatter knew: the BSDF
               density of the direction it chose (-1 where light sampling could not have
               produced that direction -- NEE off, last pass, below the surface, the camera),
               and the optical length at that vertex, so the hit can recover where the vertex
               was. The environment's equivalent is sunmis, computable at the scatter because
               the sky has no position; an emitter's density depends on where it is hit. These
               two made the Ray 112 bytes, from 96. */
            prevPdf: f32,           //89
            vtxLtot: f32,           //90
            /* MIS BETWEEN A LIGHT'S PHOTONS AND THE CAMERA'S PATHS, for the light's DIRECT paths
               (camera -> x1 -> a light's face, nothing between; PLAN.md L4b). Both strategies make
               them, and which is better depends on the light's size against the lobe's width, so
               they share them by the balance heuristic; the ratio of the two densities is
                   R = Le(y -> x1) |cos x1| A_px / (flux per photon  G_cam(x1)  pdf_bsdf(x1 -> y)).
               A CAMERA PATH carries, from its first surface, everything in R but Le: |cos| A_px /
               (flux G pdf), 0 where the photons cannot make its paths (a delta or a transmission
               there, not in air, no lights' photons) -- its face then glows R-weighted at bounce 2.
               A PHOTON carries, from its emission, Le / flux per photon of its own start, which
               its first connection completes into R; -1 for a source no camera path can meet (no
               face, or collimated), whose photons then own every lobe they can evaluate. The
               last four bytes of the padding: the Ray stays 112. */
            ltMis: f32,             //91
            absLtot: f32,           // 108: the ltot the medium's absorption has been applied up to (above)
        };  // 112 bytes, no padding left -- see rayStuctSize


        // New hit record returned by SDF
        struct Hit {
            r: Ray,   // 0..88
            s: VEC4,  // 89..104
            m: u32,   // 105            closest material index
            a: u32,    // 106                  // current material index;
            insideW: f32 // beste negatieve d gevonden tot nu toe (start: -INF)
        }           // 107 bytes total,

        /* Ray.counts' two halves (above): the march's steps, and the diffuse bounces. Every reader masks, so a seed and
           a maxiter test see the steps exactly as they did when they were the whole word. */
        const STEPS_MASK: u32 = 0xFFFFu;
        const DIFFUSE_ONE: u32 = 0x10000u;
        fn raySteps(r: Ray) -> u32 { return r.counts & STEPS_MASK; }
        fn rayDiffuse(r: Ray) -> u32 { return r.counts >> 16u; }

        fn newRay(pos: VEC3, dir: VEC3, col: VEC4, n: FLOAT) -> Ray {
            var r: Ray;
            r.state = RAY_ACTIVE;    // ray is active
            r.pos = pos;
            r.dir = normalize(dir);
            r.counts = 0u;           // no march steps, no diffuse bounces
            r.n = n;                 // air refractive index            
            r.beta = VEC3(1.0);    // default throughput
            r.radiance = VEC3(0.0);  // initial radiance
            r.ltot = 0.0;            // total length traveled by ray           
            r.bounces = 0u;
            r.sunmis = 1.0;          // a camera ray sees the sun; nothing has sampled it yet
            r.tag = 0u;
            r.tmax = 0.0;
            r.prevPdf = -1.0;        // the camera is not a vertex light sampling ran at
            r.vtxLtot = 0.0;
            r.ltMis = 0.0;           // no light's MIS until a first surface or an emission sets it
            r.muR = 0.0; r.muG = 0.0; r.muB = 0.0;   // nothing absorbs: a ray given an n > 1 here (an optics source's
            r.absLtot = 0.0;                         // emitN) starts in a medium whose absorption is not known
            return r;
        }

        // THE MEDIUM'S ABSORPTION ON A RAY (struct Ray says where it lives)
        fn rayMu(r: Ray) -> VEC3 { return VEC3(r.muR, r.muG, r.muB); }
        fn withMu(r: Ray, mu: VEC3) -> Ray { var s = r; s.muR = mu.x; s.muG = mu.y; s.muB = mu.z; return s; }
        /* What survives of the light the ray has carried since absLtot, per channel: exp(-mu d), d the length travelled
           in the medium -- its optical length over its index, as the MIS recovers a vertex (materials_pbr.js
           emitterHit), n being one value the whole way: it changes only at a shade, which applies this first. */
        fn rayTransmittance(r: Ray) -> VEC3 {
            let mu = rayMu(r);
            if (max(mu.x, max(mu.y, mu.z)) <= 0.0) { return VEC3(1.0); }
            return exp(-mu * (max(r.ltot - r.absLtot, 0.0) / max(r.n, 1e-4)));
        }
        /* ...applied to beta, and marked as applied. Where a ray ARRIVES, once whatever brought it there is over --
           every march pass, every offset off a surface (moveBy) and the march's steps back are in ltot by then, so
           this counts each of them once and nothing twice, without a multiply in the march's loop. */
        fn absorbAlong(r: Ray) -> Ray {
            var s = r;
            s.beta = r.beta * rayTransmittance(r);
            s.absLtot = r.ltot;
            return s;
        }

        fn moveBy(r: Ray, offset: VEC3) -> Ray {
            var newRay = r;
            newRay.pos += offset;
            newRay.ltot += length(offset) * r.n;
            return newRay;
        }
`


let BASICS =/*wgsl*/`
//PROCESSING FUNCTIONS
    fn max3rgb(c: VEC3) -> FLOAT { return max(c.r, max(c.g, c.b)); }

    fn toWorld(local: VEC3, n: VEC3) -> VEC3 {
        // Build orthonormal basis (T, B, N)
        let t = normalize(select(cross(n, VEC3(0.0, 1.0, 0.0)), cross(n, VEC3(0.0, 0.0, 1.0)), abs(n.z) < 0.999));
        let b = cross(t, n);
        return local.x * t + local.y * b + local.z * n;
    }
    // Uniform cone sampling around an axis (used for light sampling)
    fn sampleCone(axis: VEC3, coneAngle: FLOAT) -> VEC3 {
        let uv = PRNG().xy; // uniform in [0,1]
        let phi = 2.0 * PI * uv.x;
        let cosTheta = mix(cos(coneAngle), 1.0, uv.y);
        let sinTheta = sqrt(1.0 - cosTheta * cosTheta);
        let local = VEC3(cos(phi) * sinTheta, sin(phi) * sinTheta, cosTheta);
        return normalize(toWorld(local, normalize(axis)));
    }

    // Cosine-weighted hemisphere sampling for diffuse BSDF
    fn sampleHemisphereCosine(n: VEC3) -> VEC3 {
        let u = PRNG().xy;
        let r = sqrt(u.x);
        let phi = 2.0 * PI * u.y;
        let x = r * cos(phi);
        let y = r * sin(phi);
        let z = sqrt(max(0.0, 1.0 - x * x - y * y));
        let local = VEC3(x, y, z);
        return normalize(toWorld(local, normalize(n)));
    }

`

/* NEVER put a backtick in one of these WGSL comments. The shader is a JS template literal,
   so a backtick meant as markdown ends the literal and the file stops parsing -- three times
   now, the last one for the word rr-bias. Quote code with plain words or single quotes. */
let MAINTRACE =/*wgsl*/`
// MAIN RAYTRACING FUNCTIONS
/*==================================================================================================
  NEXT-EVENT ESTIMATION and MULTIPLE IMPORTANCE SAMPLING.

  WHY. Left to itself the path tracer finds a light by chance. The sun is a cone of about 0.03
  steradian out of the 6.28 in a hemisphere, so a cosine-weighted bounce lands on it roughly
  once in two hundred tries and spikes the pixel when it does -- which is exactly why this
  converges fast with the sun turned down and slowly with it turned up. The estimator was fine;
  the variance was not.

  TWO STRATEGIES, NEITHER GOOD ENOUGH ALONE. Sampling the BSDF is right for a smooth surface,
  whose lobe is narrow and already knows where the light must come from; it is hopeless at
  finding a small bright source off a rough one. Sampling the light is the reverse: it finds the
  sun every time, and on a near-mirror it returns a direction the BSDF has almost no response
  to, which is a firefly. The first version of this chose between them on a roughness
  threshold. MIS does not choose -- it runs both and weights each by how likely it was to have
  produced that direction, so the strategy that suited the surface dominates and the other
  still contributes what it can.

  WHAT IS SAMPLED. A mixture: half the light samples go to the solar disc, half cosine-weighted
  over the hemisphere for the sky. The sky matters more than it looks. Measured with sun-only
  NEE, the noise fell 36% with the sun turned up and only 4% at the default -- because at the
  default most of the light in the scene is sky, and nothing was sampling it.

  THE BSDF PDF HERE is the lobe sampler's mixture density over its continuous lobes (lobesPdf in
  materials_pbr.js): each lobe's pdf times its pick probability. The material picks a lobe with a
  random number and divides by that lobe's own density, so this number is used ONLY as a weight --
  MIS stays unbiased for any positive pair, since the power heuristic sums to one. A delta lobe has
  no density at all: it is handled as a direction light sampling could not have produced.

  LIGHTS THAT ARE NOT THE SKY. This was written when what is sampled here was the ANALYTIC
  ENVIRONMENT and nothing else -- the solar disc and the sky dome, both functions of direction
  alone -- and emissive GEOMETRY was invisible to it: a lamp in the scene was found only by a
  bounce that happened to hit it, and an NEE comparison run in such a scene did not measure what
  it appeared to. It named the next step: a list the shading pass can sample, a point on a light,
  the geometric term that makes it a solid-angle pdf, and the same MIS weight on a BSDF hit. That
  has been built twice, as it said, without changing the rest of this file: the emitters discovery
  finds (neeEmitShare, emitConePdf) and, on the camera's own paths, a light's face (TAG_FNEE with the
  tags above, lightFaceDensity; PLAN.md L7). The one pick in materials_pbr.js chooses among the three.

  THE HAND-OFF. The decision needs the BSDF and the normal, which only the material code has;
  the buffer to put the shadow ray in belongs to the shade kernel, and the march kernel compiles
  the same material code without it bound. So the material leaves the ray in a var<private> and
  shade collects it. All of this lives in PROCESSING rather than beside the Ray struct in
  DEFINITIONS, because it calls the sky functions from sdf.js and genrays takes DEFINITIONS on
  its own -- putting it there cost a WGSL compile error for an unresolved sunDirection in a
  kernel that has no use for it.
==================================================================================================*/

        var<private> NEE_RAY: Ray;          // the shadow ray a bounce wants traced
        var<private> NEE_VALID: bool = false;
        /* What the last processMaterial_advanced sampled -- EV_* above. The light-tracing split
           reads it after the call; see processMaterial. */
        var<private> LAST_EVENT: u32 = 0u;
        /* ...and whether that was the DIFFUSE base, which EV_EVAL shares with glossy reflection: the
           Optics view ends a light's photon there and nowhere else (processMaterial). */
        var<private> LAST_DIFFUSE: bool = false;

        // sampleSunCone lives in sdf.js with the rest of the sun: genphotons needs it too.

        /* Cosine-weighted about n. Written here rather than borrowed from the material model,
           which is in the shade kernel alone (materials_pbr.js). pdf is cos/PI. */
        fn sampleCosineHemi(n: VEC3, u: VEC2) -> VEC3 {
            let r = sqrt(u.x);
            let phi = 2.0 * PI * u.y;
            var t = VEC3(1.0, 0.0, 0.0);
            if (abs(n.x) > 0.9) { t = VEC3(0.0, 1.0, 0.0); }
            let b1 = normalize(cross(t, n));
            let b2 = cross(n, b1);
            return normalize(b1 * (r * cos(phi)) + b2 * (r * sin(phi))
                             + n * sqrt(max(0.0, 1.0 - u.x)));
        }

        fn envSampleDir(n: VEC3, pick: f32, u: VEC2) -> VEC3 {
            if (pick < UB.neeSunPick) { return sampleSunCone(u); }
            return sampleCosineHemi(n, u);
        }

        /* The mixture density. BOTH terms are evaluated for EVERY direction, not just the one
           the chosen strategy produced -- that is what makes it a mixture rather than two
           separate densities, and getting it wrong here is a real bias, not a variance cost. */
        fn envPdf(L: VEC3, n: VEC3) -> f32 {
            var pSun = 0.0;
            /* THE SAME EDGE AS THE RADIANCE, inSunDisc, and it has to be. This was
               dot(L, S) >= cos(theta) while sunDiscRadiance tested |L x S|^2 <= sin^2(theta):
               at the real sun the cosine sits ~180 f32 steps below 1, so the two disagreed on a
               band at the rim set by rounding. A light sample in that band carried the full
               disc (1.6e9 cd/m^2) divided by a pdf that thought it was sky -- about 1e5 too
               much -- and the first photometry run read the floor 142x too bright in the mean
               with the median right. sunCosHalfAngle is gone so no second edge can come back. */
            if (inSunDisc(L)) { pSun = 1.0 / sunSolidAngle(); }
            let pCos = max(dot(L, n), 0.0) / PI;
            return UB.neeSunPick * pSun + (1.0 - UB.neeSunPick) * pCos;
        }

        // Power heuristic, beta = 2. Sums to 1 across the two strategies by construction.
        fn misWeight(pThis: f32, pOther: f32) -> f32 {
            let a = pThis * pThis;
            let b = pOther * pOther;
            return a / max(a + b, 1e-20);
        }



        /*------------------------------------------------------------------------------------
          THE PROBE -- how an emitter photon finds where to start. genphotons sends it along a
          random line through one listed box's bounding sphere, starting at the FAR end and
          travelling back (-w). It passes through anything that is not an emissive surface seen
          from outside, and at the first one that is, it becomes a photon leaving along +w with
          flux Le / (probes * emitLineDensity) -- the cosine of Crofton's density and of the
          Lambertian emission cancel.
          Why the first from the far end is exact: any emissive point further back emits along
          +w into this emitter, which absorbs it -- a photon from there carries nothing. Anything
          that is NOT an emitter in between is passed through, so the photon then meets it
          properly: a lens hugging an LED is refracted through, not mistaken for the source.
          Past the chord (ltot > tmax: n stays 1, so ltot is length), escaped, or out of
          steps, the probe found nothing and ends -- the count it divides by includes it.
        ------------------------------------------------------------------------------------*/
        /*------------------------------------------------------------------------------------
          A HIT'S THREE QUESTIONS TO THE SCENE, EACH ASKED AT ONE PLACE (0.9.5). Shading a hit asks
          the scene up to three things: its normal (calcNormals_fast: the SDF), its material
          (getMaterial2), and the medium beyond it (getMaterial2 a hair across the surface). The
          probe below and a path (processMaterial) each asked all three in functions of their own,
          and a call is a whole copy of the scene once the compiler inlines it: the Noise library's
          shade kernel held the SDF eight times and getMaterial2 four (bench/shaderstats.mjs), and a
          kernel's compile time is its inlined size -- 8-15 ms per thousand characters on the user's
          Pascal card, shade 76-82% of every build (PERFORMANCE_REVIEW.md §10.3, #4).
          So the probe and the path are cut at their questions into phases that hand a Shading on,
          and the shade kernel asks each question once, between them (wavefront.js prog_shade):
          hitNormal, getMaterial2, mediumBeyond. Each is asked with exactly the arguments, and under
          exactly the conditions, it was before. The scene draws no random numbers (materials.js
          hashes its own), so asking a question at another line moves nothing in the sample.
          SINCE 0.20.8 THE SHADE KERNEL ASKS NONE OF THEM: the surface kernel before it does (wavefront.js
          prog_surface) and leaves the answers beside the hit (scene_api.js Surface), so shade holds no
          scene and compiles once. Where a question's argument depends on the path -- the hit as the
          material is asked about it, whether the medium is asked and from where -- both kernels decide
          it by the same functions (scene_api.js pathFacing, probeEnds, probeAsksMedium).
          probeProcess and processMaterial still do the whole thing in one call, for a kernel that
          shades one kind of ray (the optics trace's, optics/kernels.js): PROCESSING_ASKS, below,
          only in a kernel that holds the scene.
        ------------------------------------------------------------------------------------*/
        struct Shading {
            go: bool,           // a phase still to run; when false, the ray below is the answer
            ray: Ray,           // the answer
            res: Hit,           // the hit, as the material question takes it
            nrm: VEC3,          // the normal: as asked, for a probe; turned to face the ray, for a path
            m: Material2,       // the material
            askMedium: bool,    // the medium question, to be asked...
            mediumFrom: Ray,    // ...a hair from this ray's point...
            mediumDir: VEC3,    // ...this way
            n1: FLOAT,          // the medium beyond: its answer, or the path's default (ownMedium)
            mu1: VEC3,          // ...and its absorption (mediumMu), or the ray's own where it is not asked
            v1: FLOAT,          // ...and its Abbe number (materials.js abbe): 0, not dispersive, where it is not asked
            inside: bool,       // a path met the surface from inside
            isPhoton: bool,     // a path's kind, read where processMaterial read it
            isOptic: bool,
            connectAll: bool,
            dens: FLOAT,        // a probe's emitter line density
            emitted: bool,      // a path ended at an emitter (emitterHit, materials_pbr.js)
        }

        // THE PROBE, before its questions: a probe that has run out ends here, asking none
        fn probeBegin(hit: Hit) -> Shading {
            var st: Shading;
            var r = hit.r;
            st.ray = r;
            if (probeEnds(r)) { r.state = RAY_TERMINATED; st.ray = r; return st; }
            st.go = true;
            st.res = hit;
            return st;
        }
        /* ...after the normal and the material: an emitter seen from outside starts a photon, which
           needs to know the medium it starts in (usually air, but an emitter can sit inside glass) */
        fn probeMiddle(_st: Shading) -> Shading {
            var st = _st;
            var r = st.res.r;
            if (probeAsksMedium(st.res, st.nrm, st.m)) {
                st.dens = emitLineDensity(r.pos);
                if (st.dens <= 0.0 || UB.emitPhotons == 0u) { r.state = RAY_TERMINATED; st.ray = r; st.go = false; return st; }
                st.askMedium = true;
                st.mediumFrom = r;
                st.mediumDir = st.nrm;
                return st;
            }
            // not an emitter seen from outside: go through it and keep looking
            st.ray = moveBy(r, r.dir * offsetTol(r.pos) * 2.0);
            st.go = false;
            return st;
        }
        // ...and after the medium: the photon
        fn probeEnd(st: Shading) -> Ray {
            let r = st.res.r;
            var ph = r;
            ph.pos = r.pos + st.nrm * offsetTol(r.pos) * 2.0;
            ph.dir = -r.dir;
            ph.radiance = st.m.emissive / (f32(UB.emitPhotons) * st.dens);   // flux
            ph.beta = VEC3(1.0);
            ph.tag = TAG_PHOTON;
            ph.pix = 0xFFFFFFFFu;               // no sun-map cell
            ph.bounces = 0u;
            ph.counts = raySteps(r);            // the probe's march steps, as before; no diffuse bounces (Ray.counts)
            ph.ltot = 0.0;
            ph.tmax = 0.0;
            ph.prevPdf = -1.0;
            ph.sunmis = 1.0;
            ph.n = st.n1;                       // the medium it starts in (mediumBeyond)
            ph = withMu(ph, st.mu1);            // ...and what that absorbs
            ph.absLtot = 0.0;
            ph.state = RAY_ACTIVE;
            return ph;
        }

        // A PATH'S HIT, before its questions: what processMaterial cleared first
        fn pathBegin(hit: Hit) -> Shading {
            NEE_VALID = false;          // only this bounce's decision may reach the shade kernel
            LAST_EVENT = EV_NONE;
            LAST_DIFFUSE = false;
            var st: Shading;
            st.go = true;
            st.res = hit;
            st.ray = hit.r;
            return st;
        }
        // ...after the normal (hitNormal): which side the ray is on, and whether it is leaving
        fn pathPrelude(_st: Shading) -> Shading {
            var st = _st;
            // which side, the normal turned to the ray, the bounce counted: pathFacing (scene_api.js), which the
            // surface kernel asks the material by too
            let f = pathFacing(st.res, st.nrm);
            if (f.leaving) {
                st.ray = moveBy(st.res.r, st.res.r.dir * offsetTol(st.res.r.pos));   // moving away from the surface: no material
                st.go = false;
                return st;
            }
            st.isPhoton = (f.res.r.tag & TAG_PHOTON) != 0u;
            st.inside = f.inside;
            st.nrm = f.nrm;
            st.res = f.res;
            return st;
        }
        // ...after the material (getMaterial2 of the hit as the prelude left it)
        fn pathMiddle(_st: Shading) -> Shading {
            var st = _st;
            var res = st.res;
            let nrm = st.nrm;
            let isPhoton = st.isPhoton;
            var closestMaterial = st.m;
            /* A SEEK RAY'S ONE QUESTION: does what it hit emit? If so the emitter is recorded, as a
               camera path's hit would record it (emitDeposit), and either way the ray ends here --
               it carries no light (beta 0), so its deposit adds nothing to the pixel, whose path it
               still is and is counted once. */
            if ((res.r.tag & TAG_SEEK) != 0u) {
                /* ...but never a light's face (lightTraced): its photons light the picture, and listed it
                   would take light sampling's emitter share for nothing (PLAN.md L1; materials_pbr.js, the
                   emissive branch). A seek ray can see one glow: a path's direct face hit glows for it. */
                if (max3(closestMaterial.emissive) > 0.0 && closestMaterial.lightTraced == 0u) { emitDeposit(res.r.pos, closestMaterial.emissive); }
                res.r.state = RAY_TERMINATED;
                st.ray = res.r;
                st.go = false;
                return st;
            }
            /* THE ILLUMINANCE VIEW (measureMode 1, the Measure group). The camera's first hit is a
               white Lambertian for this one bounce, so what reaches the camera is E/pi on the
               surface's visible side; the display multiplies by pi. ONLY the camera's first hit:
               a photon scatters off the real material, and everything after this vertex is the
               scene as it is. Light tracing's connection below is the same vertex seen from the
               other end -- the point it connects is the camera's first hit on that pixel -- so it
               evaluates the same white surface (see ltConnect's caller). */
            // mode 1 only: the luminance view (2) shows the real surfaces, in false colour
            let measuring = UB.measureMode == 1u;
            if (measuring && !isPhoton && res.r.bounces == 1u) { closestMaterial = makeDiffuse(VEC3(1.0), 1.0); }
            /* A PHOTON CONNECTS BEFORE IT SCATTERS: the connection is about the light arriving
               here, whatever this vertex goes on to do with it. Only once it has passed a
               delta event -- a photon straight from the sun is NEE's to count -- and only
               within the bounce cap a camera path of the same length would have had. The
               shadow ray rides NEE_RAY, which a photon never uses for NEE. */
            let isOptic = (res.r.tag & TAG_OPTIC) != 0u;
            let connectAll = (res.r.tag & TAG_LTALL) != 0u;
            /* (a sun's or an emitter's photon ends at the first surface that scatters it, so one here has passed delta
               events only: the lens's photons walked on past D, from 0.43.0 to 0.60.0, connecting no more) */
            /* ...and only with a diffuse bounce left (diffuseLeft, materials_pbr.js): this vertex is the camera's first, an
               EV_EVAL event on its side, and the photon brings its own before it */
            let inAir = isPhoton && ((!isOptic && (res.r.tag & TAG_PASSED) != 0u) || connectAll) && res.r.bounces <= UB.maxbounce
                        && diffuseLeft(res.r);
            if (inAir) {
                var seen = closestMaterial;                 // what the camera sees here
                if (measuring) { seen = makeDiffuse(VEC3(1.0), 1.0); }
                ltConnect(res.r, seen, nrm);
            }
            st.isOptic = isOptic;
            st.connectAll = connectAll;
            // the material's emitter half (materials_pbr.js), then whether it asks the medium beyond
            let e = emitterHit(res, closestMaterial);
            st.res = e.res;
            st.emitted = e.ended;
            st.m = closestMaterial;                     // what the rest sees: the illuminance view's white, if so
            if (!e.ended) {
                st.n1 = ownMedium(closestMaterial, e.res.r.n);
                st.mu1 = rayMu(e.res.r);            // not asked: no transmission reads it (asksMedium)
                st.v1 = 0.0;                        // ...nor the dispersion
                if (asksMedium(closestMaterial)) {
                    st.askMedium = true;
                    st.mediumFrom = e.res.r;
                    st.mediumDir = -nrm;
                }
            }
            return st;
        }
        // ...after the medium beyond (mediumBeyond): the rest of the material, and what the path is now
        fn pathEnd(st: Shading) -> Ray {
            var res = st.res;
            let inside = st.inside;
            let isPhoton = st.isPhoton;
            let isOptic = st.isOptic;
            let connectAll = st.connectAll;
            if (!st.emitted) { res.r = processMaterial_advanced(res, st.m, st.nrm, st.n1, st.mu1, st.v1); }
            // A DIFFUSE BOUNCE drawn (Ray.counts' high half; the cap's two ends are below, beside the bounce cap)
            if (LAST_EVENT == EV_EVAL) { res.r.counts += DIFFUSE_ONE; }
            /* THE PHOTON MAP'S CLASS, MOVED ON BY THIS EVENT (the fields at LENS_CAM_SHIFT): a picture's photon -- a sun's,
               an emitter's, or a light's (connectAll), never the Optics page's own rays -- and a camera path, each by the
               event it just drew. Only while the map runs (sppm.js: its store and its gather read the fields in every mode
               it runs in); otherwise both stay 0. */
            let lensPh = isPhoton && (!isOptic || connectAll);
            if (sppmOn() && !st.emitted && (lensPh || !isPhoton)) {
                res.r.tag = lensStep(res.r.tag, lensPh, res.r.bounces, LAST_EVENT);
            }

            if (isOptic) {
                // an optics ray walks on through every event (TAG_OPTIC); only the caps end it
                /* ...EXCEPT A LIGHT'S PHOTON IN THE OPTICS VIEW (renderMode 3; materials_pbr.js FAST
                   MODES): it has connected here, above, and it ends if the lobe it drew is the diffuse
                   base -- no diffuse bounces, which is the view. Through a mirror, glass, gloss of any
                   roughness and rough refraction it walks on, connecting again where it lands. Not the
                   Optics page's own rays (no TAG_LTALL): that trace runs at renderMode 0 anyway
                   (optics/index.js), and this would cut its tallies short if it ever did not. */
                if (connectAll && UB.renderMode == 3u && LAST_DIFFUSE && res.r.state == RAY_ACTIVE) {
                    res.r.state = RAY_TERMINATED;
                }
                // a light's photon past a delta event, for the photon map's class (sppmStores reads it)
                if (connectAll && LAST_EVENT == EV_DELTA) { res.r.tag = res.r.tag | TAG_PASSED; }
            } else if (isPhoton) {
                /* The walk continues only through delta events. The first real scatter ends it:
                   everything a photon could reach from here -- a diffuse bounce onward -- is a
                   path the camera side already samples, and continuing would count it twice.
                   (Through the camera's lens it walked on past D, from 0.43.0 to 0.60.0; the photon map stores it
                   at D instead.) */
                if (LAST_EVENT == EV_DELTA) { res.r.tag = res.r.tag | TAG_PASSED; }
                else if (res.r.state == RAY_ACTIVE) { res.r.state = RAY_TERMINATED; }
            } else {
                /* THE LIGHTS' SPLIT (PLAN.md L4), whatever the sun and the emitters do: a light's
                   photons run on their own (R.photonSources). Their connection needs the vertex in
                   air (ltConnect), so the path must be too -- a camera under water keeps its
                   lights. A reflection keeps the medium, so res.r.n after the event is the one at
                   the vertex. The tag is written whole here, as the split below writes it. */
                /* ...ITS FLAGS, that is: a wavelength drawn at this very surface (a refraction into a dispersive
                   medium; spectral.js) rides in the tag's upper bits and outlives the write (0.40.0) */
                /* ...and the lens's field, which lensStep has just written for this surface, above (0.43.0) */
                if (res.r.bounces == 1u) {
                    res.r.tag = (res.r.tag & (TAG_LAMBDA_MASK | (3u << LENS_CAM_SHIFT))) | select(0u, CLS_LIGHTS,
                                       UB.ltLights != 0u && LAST_EVENT == EV_EVAL && abs(res.r.n - 1.0) <= 1e-3);
                }
                if (UB.lt != 0u || UB.ltEmit != 0u) {
                    /* EITHER photon source. This read UB.lt alone -- which means SUN photons -- so with
                       the sun off and emitter photons running, no camera path was ever tagged, none
                       handed its emitter caustic over, and the photons counted it a second time:
                       light tracing on read 0.6% brighter than off on the emitters bench. */
                    /* THE CAMERA SIDE OF THE SPLIT. The light tracer owns exactly: first vertex
                       scattered by an evaluable lobe (EV_EVAL), then one or more delta events, then
                       the solar disc. Mark that class as it forms so the shade kernel can leave its
                       sun out on escape. A path leaves the class at the first event that breaks it
                       and never re-enters. CLS_LIGHTS, set above, is kept. */
                    if (res.r.bounces == 1u) {
                        res.r.tag = res.r.tag | select(0u, CLS_CAND, LAST_EVENT == EV_EVAL);
                    } else if ((res.r.tag & CLS_CAND) != 0u) {
                        if (LAST_EVENT == EV_DELTA) { res.r.tag = res.r.tag | CLS_SPEC; }
                        else { res.r.tag = res.r.tag & ~(CLS_CAND | CLS_SPEC); }
                    }
                }
            }

            /* THE FAST MODES' STOP (materials_pbr.js FAST MODES): a camera path met from outside ends at
               an evaluable lobe -- its direct light, or Sketch's, was added at this vertex, and the
               bounce light past it is what these modes leave out. Delta, near-mirror gloss and rough
               refraction go on. HERE, after the class bits are written, because at bounce 1 they
               replace the whole tag and would take a seek ray's bit with them. In Draft a share of
               the paths that end go on as seek rays instead -- not on the last pass, where nothing
               would march them. */
            if (fastCamera(res.r.tag) && res.r.state == RAY_ACTIVE && !inside && LAST_EVENT == EV_EVAL) {
                if (UB.renderMode == 1u && UB.lastpass == 0u && PRNG().x < UB.draftSeek) {
                    res.r.tag = res.r.tag | TAG_SEEK;
                    res.r.beta = VEC3(0.0);
                } else {
                    res.r.state = RAY_TERMINATED;
                }
            }

            // the hard bounce cap
            if (res.r.bounces > UB.maxbounce) {
                res.r.state = RAY_TERMINATED;
            }
            /* THE DIFFUSE CAP (Max Diffuse Bounces, 0.69.0; UB.diffuseCap the most EV_EVAL events a whole light path may
               hold, its last scatter into a light counted -- 0 none). It cuts the same paths on every side of the split,
               so what each side leaves to another is still counted exactly once:
               - A CAMERA PATH counts its EV_EVAL draws. It arrived capped when it had none left (diffuseLeft): it sampled
                 no light there, and an EV_EVAL draw now puts it over -- it ends. Otherwise it goes on: past a mirror or
                 glass, or with one more, still within the cap.
               - A LIGHT'S PHOTON (connectAll; it walks through every event) connects only with one left (pathMiddle);
                 once it has none it can light nothing more and ends.
               - A SUN'S OR AN EMITTER'S PHOTON has only delta events before it lands, and ends at its first scatter
                 above: none drawn, always one left while the cap is 1 or more, so nothing of its class moves -- the
                 camera's CLS_CAND and CLS_SPEC, the photon map's records and what lensOwned leaves it, whose gathering
                 camera rays have drawn none either (sppm.js sppmGathers: delta events only since the eye).
               The Optics page's own rays are none of these (the page's trace sends no cap, optics/index.js). */
            if (UB.diffuseCap != 0u && res.r.state == RAY_ACTIVE) {
                let d = rayDiffuse(res.r);
                if (isPhoton) { if (connectAll && d >= UB.diffuseCap) { res.r.state = RAY_TERMINATED; } }
                else if (d > UB.diffuseCap) { res.r.state = RAY_TERMINATED; }
            }
            /* RUSSIAN ROULETTE -- unbiased early termination.
               This was written and then commented out, so every path ran to UB.maxbounce
               (default 10) or until it was absorbed, however little light it was still
               carrying. A path whose throughput has fallen to 0.02 contributes almost
               nothing and costs exactly as much to trace as one carrying 1.0.

               Roulette kills it with probability 1-p and divides the survivors by p, so
               the ESTIMATOR IS UNCHANGED -- fewer rays, same expected image, more noise
               per sample but many more samples per second. It only starts after uRRStart
               bounces, so the early ones (which carry most of the energy and most of the
               structure) are never gambled away.

               p is the largest throughput channel, clamped: RR_MAX_P stops it being a
               no-op on bright paths, RR_MIN_P stops a near-black path being kept alive by
               a huge 1/p that would turn one unlucky survivor into a firefly.

               THE 6-8% BRIGHTENING WAS NOT BIAS -- IT WAS THE MEASUREMENT.
               This comment used to record an unexplained 6-8% brightening when RR was
               switched on, and to name its own prime suspect: the comparison runs had the
               ADAPTIVE ITERATION BUDGET live, and RR ends paths early, so the two arms were
               not even given the same number of wavefront iterations. That suspect was
               right. Re-run through the test bench with autobudget PINNED OFF (press
               rr-bias in the Tests menu; see docs/TESTING.md), 1024x1024,
               32 samples, on a Pascal card, all four arms land within 0.15% of each other:

                   RR off, maxbounce 10   trimmedLuma 0.058860
                   RR on,  maxbounce 10               0.058779   -0.14%
                   RR off, maxbounce 40               0.058775   -0.14%
                   RR on,  maxbounce 40               0.058770   -0.15%

               So the estimator is unbiased, as the theory above says, and there is nothing
               left to explain. Enabling it is safe.

               IT IS STILL OFF BY DEFAULT, now for a different and much duller reason: in
               this scene it buys nothing. The same bench's cost-sweep puts rr-on at +0.9%
               ms/sample -- inside the noise, and if anything slower -- while rays flushed
               fall from 1416 to 360. RR does terminate paths earlier; the wavefront just
               does not get paid for it, because a drained iteration still costs its five
               dispatches. It should earn its keep in a scene deep enough for the budget to
               shrink, and that is the case to find before changing the default. */
            if (UB.rr != 0u && res.r.bounces >= uRRStart && res.r.state == RAY_ACTIVE) {
                let p = clamp(max3rgb(res.r.beta), RR_MIN_P, RR_MAX_P);
                if (PRNG().x > p) {
                    res.r.state = RAY_TERMINATED;
                } else {
                    res.r.beta /= p;              // essential for energy conservation
                }
            }

       
        
            return res.r;
        }
`

























export let DEFINITIONS = `
${DEFINIES}
${UNIFORMS}

${NOISE}
${RAYS}
`

export const EMIT_LIST = `
/*==================================================================================================
  THE EMITTER LIST -- read side. Only for kernels that bind learn (shade, genphotons); a helper
  naming a binding its kernel lacks is the UNREACHABLE/unresolved trap check-shaders looks for.
==================================================================================================*/
fn emitCount() -> u32 { return min(atomicLoad(&learn[EL_SNAP]), EMIT_MAX); }
fn emitF(b: u32, k: u32) -> f32 { return bitcast<f32>(atomicLoad(&learn[EL_SNAP + 1u + b * 8u + k])); }
fn emitCentre(b: u32) -> VEC3 { return VEC3(emitF(b, 0u), emitF(b, 1u), emitF(b, 2u)); }

/* A box by its cumulative probability. Linear: at most EMIT_MAX, and this is not per step. */
fn emitPick(u: f32) -> u32 {
    let K = emitCount();
    for (var b = 0u; b < K; b++) { if (u < emitF(b, 5u)) { return b; } }
    return max(K, 1u) - 1u;
}

/* 1 - cos of the cone a sphere of radius r at squared distance d2 subtends -- as
   sin^2 / (1 + cos), which keeps its digits when the sphere is small and far. */
fn coneOneMinusCos(r: f32, d2: f32) -> f32 {
    let s2 = r * r / d2;
    return s2 / (1.0 + sqrt(max(0.0, 1.0 - s2)));
}

/* THE DENSITY emitter NEE draws direction dir with from x: the mixture over every box whose
   bounding sphere x is outside of and whose cone contains dir. Evaluated on BOTH sides of MIS
   -- by NEE for the direction it drew, and on a BSDF hit of an emitter for the direction the
   bounce drew -- which is what keeps the weights summing to one. */
fn emitConePdf(x: VEC3, dir: VEC3) -> f32 {
    let K = emitCount();
    var p = 0.0;
    for (var b = 0u; b < K; b++) {
        let dc = emitCentre(b) - x;
        let d2 = dot(dc, dc);
        let r = emitF(b, 3u);
        if (d2 <= r * r) { continue; }
        let omc = coneOneMinusCos(r, d2);
        if (dot(dir, dc) >= (1.0 - omc) * sqrt(d2)) { p += emitF(b, 4u) / (2.0 * PI * omc); }
    }
    return p;
}

/* Is point y inside some box's sphere -- i.e. could an emitter photon start there? The camera
   side hands an emitter hit to the photons only then, so the split is exact whatever has or has
   not been discovered. */
fn emitCovers(y: VEC3) -> bool {
    let K = emitCount();
    for (var b = 0u; b < K; b++) {
        let d = y - emitCentre(b);
        let r = emitF(b, 3u);
        if (dot(d, d) < r * r) { return true; }
    }
    return false;
}

/* The line density a probe produced (y, w) with, less its cos: sum over boxes whose sphere holds
   y of P_b / (4 PI^2 r_b^2). A uniformly random line through a sphere of radius r crosses a
   surface element with density |n.w| dA dw / (4 PI^2 r^2) -- Crofton -- which is the Lambertian
   emission measure itself, so an emitter photon needs no knowledge of the emitter's shape. */
fn emitLineDensity(y: VEC3) -> f32 {
    let K = emitCount();
    var p = 0.0;
    for (var b = 0u; b < K; b++) {
        let d = y - emitCentre(b);
        let r = emitF(b, 3u);
        if (dot(d, d) < r * r) { p += emitF(b, 4u) * emitF(b, 6u); }
    }
    return p;
}
`

/* A LIGHT'S BEAM: the shape of its distribution at an angle (codegen LIGHTS says what each kind is). One text,
   line by line, for the scene that has a light (codegen emits these lines, so its output is what it was) and for
   the table below, so the two cannot differ. */
export const LIGHT_BEAM_LINES = [
    'fn lightBeam(beam: vec4<f32>, cosT: f32) -> f32 {',
    '    let kind = u32(beam.x + 0.5);',
    '    if (kind == 0u) { return 1.0; }          // collimated: no luminance to show, its Lambertian equivalent',
    '    if (cosT < beam.z) { return 0.0; }       // outside the cone',
    '    let c = max(cosT, 1e-4);',
    '    if (kind == 1u) { return 1.0 / c; }      // uniform in solid angle: radiance 1/cos',
    '    return pow(c, beam.y - 1.0);            // cos^n: radiance cos^(n-1)',
    '}',
]

/*==================================================================================================
  THE LIGHTS' FACES, FROM THE TABLE THE SURFACE KERNEL WROTE (learn, [LF_BASE, ...)): light sampling's
  four functions in a kernel that does not hold the scene -- shade, since 0.20.8. A kernel that holds
  it has the scene's own (codegen emitLightFaces, scenedata.js lightFacesWGSL, or NO_LIGHT_FACES), and
  the surface kernel copies those here every iteration, before shade runs (FACE_TABLE_WRITE): the same
  faces, the same weights, the total summed in the same order, so every number below is the one the
  scene's function returns. Only for a kernel that binds learn.
==================================================================================================*/
export const FACE_TABLE = `
fn lfWord(i: u32, k: u32) -> u32 { return atomicLoad(&learn[LF_BASE + 2u + i * LF_WORDS + k]); }
fn lfF(i: u32, k: u32) -> f32 { return bitcast<f32>(lfWord(i, k)); }
fn lightFaceTotal() -> f32 { return bitcast<f32>(atomicLoad(&learn[LF_BASE + 1u])); }
// the scene's pick: the face whose share of u it falls in, the last one shown past the end
fn lightFacePick(u: f32) -> u32 {
    let K = min(atomicLoad(&learn[LF_BASE]), FACE_MAX);
    var acc = 0.0;
    var last = 0u;
    for (var i = 0u; i < K; i++) {
        let w = lfF(i, 23u);
        if (w > 0.0) { last = i; acc += w; if (u < acc) { return i; } }
    }
    return last;
}
// in ENGINE UNITS, as writeFaceTable stored it (lightFaceAt, scene_api.js SCENE_BOUNDARY): the boundary's name, so light
// sampling (materials_pbr.js) reads one function in shade and in a kernel that holds the scene
fn lightFaceAt(i: u32) -> LightFace {
    var f: LightFace;
    if (i >= min(atomicLoad(&learn[LF_BASE]), FACE_MAX)) { return f; }
    f.centre = VEC3(lfF(i, 0u), lfF(i, 1u), lfF(i, 2u));
    f.u = VEC3(lfF(i, 3u), lfF(i, 4u), lfF(i, 5u));
    f.v = VEC3(lfF(i, 6u), lfF(i, 7u), lfF(i, 8u));
    f.n = VEC3(lfF(i, 9u), lfF(i, 10u), lfF(i, 11u));
    f.half = VEC2(lfF(i, 12u), lfF(i, 13u));
    f.shape = lfWord(i, 14u);
    f.twoSided = lfWord(i, 15u);
    f.le = VEC3(lfF(i, 16u), lfF(i, 17u), lfF(i, 18u));
    f.beam = vec4<f32>(lfF(i, 19u), lfF(i, 20u), lfF(i, 21u), lfF(i, 22u));
    f.weight = lfF(i, 23u);
    return f;
}
${LIGHT_BEAM_LINES.join('\n')}
fn lightFaceLe(f: LightFace, cosT: f32) -> VEC3 { return f.le * lightBeam(f.beam, cosT); }
`
/* ...and the copy, in the surface kernel, after the scene: LIGHT_FACES and lightFace are the scene's, taken through the
   boundary (lightFaceAt) so the table is in engine units. Its
   total is the scene's lightFaceTotal, not a sum here, so it is the scene's number whatever order that
   adds in. */
export const FACE_TABLE_WRITE = `
fn lfPut(i: u32, k: u32, w: u32) { atomicStore(&learn[LF_BASE + 2u + i * LF_WORDS + k], w); }
fn lfPutF(i: u32, k: u32, x: f32) { lfPut(i, k, bitcast<u32>(x)); }
fn writeFaceTable() {
    let K = min(LIGHT_FACES, FACE_MAX);
    for (var i = 0u; i < noUnroll(K); i++) {
        let f = lightFaceAt(i);                 // in engine units (scene_api.js SCENE_BOUNDARY)
        lfPutF(i, 0u, f.centre.x); lfPutF(i, 1u, f.centre.y); lfPutF(i, 2u, f.centre.z);
        lfPutF(i, 3u, f.u.x); lfPutF(i, 4u, f.u.y); lfPutF(i, 5u, f.u.z);
        lfPutF(i, 6u, f.v.x); lfPutF(i, 7u, f.v.y); lfPutF(i, 8u, f.v.z);
        lfPutF(i, 9u, f.n.x); lfPutF(i, 10u, f.n.y); lfPutF(i, 11u, f.n.z);
        lfPutF(i, 12u, f.half.x); lfPutF(i, 13u, f.half.y);
        lfPut(i, 14u, f.shape); lfPut(i, 15u, f.twoSided);
        lfPutF(i, 16u, f.le.x); lfPutF(i, 17u, f.le.y); lfPutF(i, 18u, f.le.z);
        lfPutF(i, 19u, f.beam.x); lfPutF(i, 20u, f.beam.y); lfPutF(i, 21u, f.beam.z); lfPutF(i, 22u, f.beam.w);
        lfPutF(i, 23u, f.weight);
    }
    atomicStore(&learn[LF_BASE], K);
    atomicStore(&learn[LF_BASE + 1u], bitcast<u32>(lightFaceTotal()));
}
`

export let PROCESSING = `
${EMIT_LIST}
${BASICS}

${MAINTRACE}
// Workgroup-shared state for per-group compaction in trace pass
var<workgroup> wgCount: atomic<u32>;
var<workgroup> wgBase: u32;
`

/*==================================================================================================
  A HIT'S QUESTIONS IN ONE CALL each, and a probe's and a path's whole hit in one call: for a kernel that
  holds the scene and shades one kind of ray (the optics trace, optics/kernels.js), after PROCESSING. Out
  of PROCESSING since 0.20.8 because each names the scene's SDF or getMaterial2, and shade no longer
  holds the scene: a WGSL function that names one that does not exist is an error whether or not it
  is called. The surface kernel (wavefront.js prog_surface) asks the same questions, a trip each of one
  loop, with the same arguments.
==================================================================================================*/
export const PROCESSING_ASKS = `
    fn SDFd(r: Ray, dif: VEC3) -> Hit {  // measure distance to surface, with offset
            var _r: Ray = r;                       // arguments are immutable, so we need a copy
            _r.pos = r.pos + dif;
            return sceneAt(_r, false);             // through the boundary (scene_api.js): engine units
        }

    // calculate normals.   these point outwards from the surface.  So inside the material, normals are inverted.
    // One axis per pass of a loop the compiler cannot unroll (noUnroll): one copy of the scene
    // here, not three. (A central-difference calcNormals, six looks, sat beside it uncalled until 0.22.3.)
    fn calcNormals_fast(r: Ray, res: Hit) -> VEC3 {
        let d = res.s.w;
        let eps = normalTol(r.pos);                                 // the normal's difference step (EPS_WGSL)
        var g = VEC3(0.0);
        for (var k = 0u; k < noUnroll(3u); k++) {
            g[k] = SDFd(r, VEC3(f32(k == 0u), f32(k == 1u), f32(k == 2u)) * eps).s.w - d;
        }
        return normalize(g); // Normalize the result
    }

    // THE NORMAL: the SDF's own when it gives one, else three more looks at the scene
    fn hitNormal(hit: Hit) -> VEC3 {
        if (length(hit.s.xyz) > 0.0) { return hit.s.xyz; }
        return calcNormals_fast(hit.r, hit);
    }
    // THE MEDIUM BEYOND: the material a hair along d from the ray's point, asked from inside -- its index and what it
    // absorbs are what is read of it (Shading n1, mu1)
    fn mediumBeyond(r: Ray, d: VEC3) -> Material2 {
        return materialAt(SDFd(r, d * offsetTol(r.pos) * 2.0), true);
    }

    // the probe in one call
    fn probeProcess(hit: Hit) -> Ray {
        var st = probeBegin(hit);
        if (!st.go) { return st.ray; }
        st.nrm = hitNormal(hit);
        st.m = materialAt(st.res, false);
        st = probeMiddle(st);
        if (!st.go) { return st.ray; }
        let mb = mediumBeyond(st.mediumFrom, st.mediumDir);
        st.n1 = mb.ior;
        st.mu1 = mediumMu(mb);
        return probeEnd(st);
    }

    // a path's hit in one call
    fn processMaterial(res_in: Hit) -> Ray {
        var st = pathBegin(res_in);
        st.nrm = hitNormal(res_in);
        st = pathPrelude(st);
        if (!st.go) { return st.ray; }
        st.m = materialAt(st.res, false);
        st = pathMiddle(st);
        if (!st.go) { return st.ray; }
        if (st.askMedium) {
            let mb = mediumBeyond(st.mediumFrom, st.mediumDir);
            st.n1 = mb.ior;
            st.mu1 = mediumMu(mb);
            st.v1 = mb.abbe;
        }
        return pathEnd(st);
    }
`