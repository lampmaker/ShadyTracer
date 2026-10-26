//======================================================================================================================
// TESTS.JS -- the one-press test bench.
//
// WHY THIS EXISTS. Every real number in this project has come from the user pasting a readout
// back, because a software adapter in a container measures a CPU emulation of a GPU and predicts
// nothing about a real card. That loop is the only honest instrument available, so it has to be
// CHEAP. Until now it was not: weavesim's test/sweep.js (in RAYTRACER_WEBGPU) is "open the file, select all,
// paste into the console, then type await weavesimSweep()", which is why it went unused, and the
// Russian-roulette comparison needed a hand-written Playwright harness plus a four-call sequence
// typed into devtools.
//
// So: a Tests folder in the menu, one button per measurement. Press it, it runs, it prints a
// table into a popup with a Copy button and to the console. And it is a REGISTRY -- the next
// measurement is a row in a table here, not another bespoke harness and another round of
// instructions.
//
// TWO KINDS OF TEST, because the two questions need opposite conditions:
//
//   kind: 'image'  does this change the PICTURE?  Loop PAUSED, a fixed number of samples via
//                  RT.step(n), read RT.imageStats(). Deterministic and comparable.
//   kind: 'cost'   does this change the SPEED?    Loop RUNNING, settle, read RTSTATS(). Never
//                  paused -- pausing is exactly what makes a cost reading meaningless.
//   kind: 'bench'  HOW FAST, on a fixed stage?     Offscreen at a set size, a set camera, set
//                  settings; one sample per trace, each awaited and timed. For comparing
//                  machines and commits (bench), where 'cost' compares
//                  settings on whatever the view is showing.
//
// A cost reading taken in a container is worthless; the report says which adapter produced it so
// a pasted table can never be mistaken for one from real hardware.
//======================================================================================================================

import { projectPoint } from './core/genrays.js'
import { createOptics } from './optics/index.js'
import { intensity, farStats, farGeometry } from './optics/farfield.js'
import { fresnel, slabT, twoSlabT, wedgeExitDeg, absorbingSlabT, tintedSlabT, coatedSlabT } from './optics/fresnel.js'
import { edgeRGB, edgeAt, cauchyN, SPEC_WEIGHTS, SPEC_LO, SPEC_STEP, SPEC_BINS } from './core/spectral.js'
import { hue, defaultSource } from './optics/sources.js'
import { rgbFromXy, cctDuvToXy, xyToCctDuv, xyToUpVp, XYZtoxy, mixToTarget, planckXy, rgbToXYZ, XYZtoRGB } from './core/colorimetry.js'
import { EMIT_EPOCH, SPLIT_OVER_MS } from './core/raytrace_main.js'
import { watchRun, Stopped } from './runwatch.js'
import { perIteration } from './core/kerneltime.js'
import { UniformSpec } from './core/uniforms.schema.js'
import { presetValues } from './quality.js'
import * as V from './verdict.js'
import { SKETCH_FALLBACK_LX, opticsFlatShare, LUMA } from './core/photometry.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))

//======================================================================================================================
// THE REGISTRY
//
// A test is: an id, a title, a kind, a `pin` applied to every case, and the cases. A case carries
// `set` (uniforms, through RT.set -- the same path the sliders use) and/or `rt` (properties on the
// renderer itself, such as budgetOverride, which is not a uniform).
//======================================================================================================================

/* SCENES WITH A KNOWN ANSWER, which none of the real ones has. Written against the scene contract
   directly (lib/pathtracer/core/scene_api.js) rather than through the builder, which lives in a
   project this library does not import. Exported so check-shaders compiles them through every
   kernel: a scene only the bench loads would otherwise be a scene nothing checks.

   THE MATERIAL IS SCENE UNIFORMS, so a test row sets it the way it sets everything else (RT.set)
   and one compiled scene serves every material. The defaults are the photometry floor's: a pure
   Lambertian of albedo 0.8 (specular 0 -- see makeDiffuse in core/materials.js).

   plane   one infinite plane at z = 0: every point sees the whole sky and sun, nothing shadows
           anything, and a Lambertian of albedo rho under illuminance E has luminance rho E / pi
           at every pixel.
   sphere  a unit sphere at the origin, for the white furnace: in a uniform environment an
           albedo-1 material must be invisible, whatever the angle it is seen at.
   shell   a HOLLOW sphere: material 1 between r = 1 and 1.1 round a cavity of air of radius 1, for the
           integrating sphere (optics-balance). Not the furnace's sphere: its source at the centre was then
           inside an opaque solid, and every ray left without meeting a wall (the user's 0.77.0 run: arrived 0).
   tilted  the plane through the origin, tilted by tTilt degrees TOWARDS THE SUN, in the sun's own
           vertical plane: its normal makes an angle 90 - elevation - tilt with the sun, so under
           the sun alone it receives E_sun sin(elevation + tilt) -- the cosine law, with no
           azimuth convention to get wrong.
   disc    the floor, and above it a Lambertian emitter: a flat cylinder of radius tDiscR and
           half-thickness tDiscT centred tDiscH up, luminance tEmit. Its illuminance on the floor
           has a closed form for the bottom face; the rim is integrated (cylinderE).
   slab    an infinite slab of material 1 (the glass, when the row makes it one) between
           tSlabZ -+ tSlabT, over a floor of material 3 -- black, and listed as the scene's
           DETECTOR, so what the slab passes is counted where it lands. With tGap > 0 it is two
           slabs of that thickness each, tGap of air between them, centred on the same height.
   wedge   the glass between a level bottom face at tSlabZ - tSlabT and a top face through
           (0, 0, tSlabZ + tSlabT) tilted by tWedge degrees about y (outward normal
           (sin a, 0, cos a)), over the same detector floor: a prism, for Snell's law.
   ball    a sphere of material 1 (the glass, when the row makes it one), radius 0.5 centred 0.6 up,
           on a FINITE white floor (material 4, albedo 0.8): a disc of radius 4, 0.1 thick, its top at
           z = 0 -- the whole scene inside a radius of 5, so a row may give the scene that radius and
           change nothing it draws (small-caustic). A ball lens focuses the sun about 0.75 past its
           centre: a caustic on the floor beside it.
   pane    a pane of material 1 standing on the ball's white floor: 1.2 wide, 1 high, 2 tSlabT thick, in the x-z
           plane -- the user's picture of 2026-10-15 (a glass slab standing before a lamp), lit by the sun behind the
           camera: the floor behind the pane is lit through it and seen through it (sppm). */
const FLOOR_ALBEDO = 0.8
const tU = def => ({ type: 'f32', def })
const MATERIAL_UNIFORMS = { tBase: tU(FLOOR_ALBEDO), tMetal: tU(0), tRough: tU(1), tSpec: tU(0), tTrans: tU(0), tIor: tU(1.5),
    /* anisotropy, and the grain it runs along (SURFACES.md phase 1): 0 none -- the old frame from the
       normal alone -- 1 brushed along x, 2 turned about the z axis through the origin */
    tAniso: tU(0), tGrain: tU(0),
    // the tilted plane's tilt towards the sun, degrees; the disc light's height, radius, half-thickness
    // (scene units) and luminance (cd/m^2)
    tTilt: tU(0), tDiscH: tU(1), tDiscR: tU(0.5), tDiscT: tU(0.01), tEmit: tU(10000),
    // the slab's (and wedge's) centre height and half-thickness, the gap between two slabs, the
    // wedge's tilt in degrees
    tSlabZ: tU(0.5), tSlabT: tU(0.1), tGap: tU(0), tWedge: tU(20),
    // material 1's colour depth (core/materials.js attenuationDistance), scene units: 0 none, the old tint per crossing
    tDepth: tU(0),
    /* material 1's coating (core/materials.js coatMaterial, 0.39.0): where (0 none, 1 entering with an AR back, 2 bare
       back, 3 every face), R below and above the edge, the edge and its width (nm), the stack's effective index */
    tCoat: tU(0), tCoatLo: tU(0), tCoatHi: tU(0), tCoatEdge: tU(600), tCoatW: tU(20), tCoatN: tU(1.8),
    // material 1's Abbe number (core/materials.js abbe, 0.40.0): 0 no dispersion
    tAbbe: tU(0) }
/* How big each shape is, in its own units, for the automatic surface tolerance (photometry.js
   autoEps): what the builder's bounds would say. The plane's is the part the camera sees. */
const EXTENT = { plane: 10, sphere: 2 * Math.sqrt(3), shell: 2.2 * Math.sqrt(3), tilted: 10, disc: 2, slab: 2, wedge: 2, ball: Math.hypot(8, 8, 1.2),
                 pane: Math.hypot(8, 8, 1.2) }
/* THE DETECTORS of a shape, as material ids (the optics trace's `detectors`): the floor under the
   slab and the wedge is material 3. */
const DETECTORS = { slab: [3], wedge: [3] }
export const testScene = (unit, shape = 'plane') => ({
    id: `bench-${shape}-${unit}`, title: `Bench ${shape} (${unit})`, unit, uniforms: MATERIAL_UNIFORMS,
    extent: EXTENT[shape], ...(DETECTORS[shape] ? { detectors: DETECTORS[shape] } : {}),
    wgsl: /*wgsl*/`
fn getMaterial2(C: Hit, checkInside: bool) -> Material2 {
    let idx = select(C.m, C.a, checkInside);
    var m = makeDefaultMaterial();           // idx 0 is the air, IOR 1
    if (idx == 2u) { m.emissive = vec3<f32>(UB.tEmit); }   // the disc light: white, Y = tEmit
    if (idx == 3u) { m = makeDiffuse(vec3<f32>(0.0), 1.0); }  // the detector floor: black
    if (idx == 4u) { m = makeDiffuse(vec3<f32>(${FLOOR_ALBEDO}), 1.0); }  // the ball's floor: white
    if (idx == 1u) {
        m.baseColor = vec3<f32>(UB.tBase);
        m.metallic = UB.tMetal;
        m.roughness = UB.tRough;
        m.specular = UB.tSpec;
        m.transmission = UB.tTrans;
        m.ior = UB.tIor;
        m.anisotropy = UB.tAniso;
        m.attenuationDistance = UB.tDepth;
        m = coatMaterial(m, u32(UB.tCoat + 0.5), UB.tCoatLo, UB.tCoatHi, UB.tCoatEdge, UB.tCoatW, UB.tCoatN);
        m.abbe = UB.tAbbe;
        /* THE GRAIN goes through localPoint and the helpers, as a builder material's does, so the
           bench runs that path: in this hand-written scene the frame is the identity and the local
           point the world one (scene_api.js localPoint). Only when asked, and never on the
           medium lookup -- it is an SDF evaluation per hit. */
        if (UB.tGrain > 0.5 && !checkInside) {
            let q = localPoint(C.r);
            let R = HIT_FRAME;
            m.tangent = select(grainAlong(R, VEC3(1.0, 0.0, 0.0)),
                               grainAround(R, q, VEC3(0.0, 0.0, 1.0)), UB.tGrain > 1.5);
        }
    }
    return m;
}
/* an infinite slab |z - c| <= t: the outward normal is +z above its middle and -z below */
fn benchSlab(z: FLOAT, c: FLOAT, t: FLOAT) -> VEC4 {
    return VEC4(0.0, 0.0, select(-1.0, 1.0, z >= c), abs(z - c) - t);
}
fn SDF(r: Ray) -> Hit {
    var C = emptyHit(r);
    ${{
        sphere: 'C = add_new(C, Nsphere(r.pos, 1.0), 1u);',
        // the shell's own outward normal: away from the centre on its outer face, towards it on its inner one
        shell: `let sl = max(length(r.pos), 1e-6);
    C = add_new(C, VEC4(r.pos / sl * select(-1.0, 1.0, sl > 1.05), abs(sl - 1.05) - 0.05), 1u);`,
        plane: 'C = add_new(C, Nplane(r.pos), 1u);',
        tilted: `let sd = sunDirection();
    let sh = normalize(VEC3(sd.x, sd.y, 0.0));              // the sun's bearing, level
    let tt = UB.tTilt * PI / 180.0;
    let tn = VEC3(0.0, 0.0, cos(tt)) + sh * sin(tt);
    C = add_new(C, VEC4(tn, dot(r.pos, tn)), 1u);`,
        ball: `C = add_new(C, Ncylinder(r.pos - VEC3(0.0, 0.0, -0.05), 0.05, 4.0), 4u);
    C = add_new(C, Nsphere(r.pos - VEC3(0.0, 0.0, 0.6), 0.5), 1u);`,
        // the ball's floor with a pane of material 1 standing on it (sppm's row): the floor behind it lit and seen through it
        pane: `C = add_new(C, Ncylinder(r.pos - VEC3(0.0, 0.0, -0.05), 0.05, 4.0), 4u);
    C = add_new(C, Nbox(r.pos - VEC3(0.0, 0.0, 0.5), VEC3(0.6, UB.tSlabT, 0.5)), 1u);`,
        disc: `C = add_new(C, Nplane(r.pos), 1u);
    C = add_new(C, Ncylinder(r.pos - VEC3(0.0, 0.0, UB.tDiscH), UB.tDiscT, UB.tDiscR), 2u);`,
        slab: `C = add_new(C, Nplane(r.pos), 3u);
    if (UB.tGap > 0.0) {
        let off = UB.tSlabT + 0.5 * UB.tGap;
        C = add_new(C, benchSlab(r.pos.z, UB.tSlabZ + off, UB.tSlabT), 1u);
        C = add_new(C, benchSlab(r.pos.z, UB.tSlabZ - off, UB.tSlabT), 1u);
    } else {
        C = add_new(C, benchSlab(r.pos.z, UB.tSlabZ, UB.tSlabT), 1u);
    }`,
        wedge: `C = add_new(C, Nplane(r.pos), 3u);
    let wa = UB.tWedge * PI / 180.0;
    let wn = VEC3(sin(wa), 0.0, cos(wa));
    let dTop = dot(r.pos - VEC3(0.0, 0.0, UB.tSlabZ + UB.tSlabT), wn);
    let dBot = (UB.tSlabZ - UB.tSlabT) - r.pos.z;
    // the intersection of two half-spaces: the larger distance, and that face's normal
    C = add_new(C, select(VEC4(0.0, 0.0, -1.0, dBot), VEC4(wn, dTop), dTop > dBot), 1u);`,
    }[shape]}
    return C;
}
`,
})
export const floorScene = unit => testScene(unit, 'plane')
/* The floor as an OPTICS DETECTOR: `detectors` lists material ids, and the floor is material 1. */
const detectorFloor = { ...testScene('m', 'plane'), id: 'bench-plane-m-detector', detectors: [1] }
/* The integrating sphere's shell, made once: the runner tells scenes apart by object, so its two rows share one compile. */
const SHELL = testScene('m', 'shell')
/* EVERY TEST CAMERA NAMES ITS TARGET (0.62.1), the origin each was written for (camera.js's own default). Without one an
   orbit keeps the view's target (camera.js setOrbit), and that is in the view's scene's unit: a builder scene's 40 mm
   read as 40 m by a metre test scene. The first press of `haze` (the user, 2026-10-16) looked 3 m from such a point at
   sky only -- every row 1000.000244, noise 0, the CONTROL with them -- and a node run with the view's target at
   [0, 0, 40] read exactly 1000 on every row, a black sphere included (this session, Dawn over lavapipe). The runner
   puts the view's target back once a test's camera names one (run's finally). */
/* Straight down from five units up, a few degrees off vertical so the orbit camera's up vector is
   defined: the whole frame is floor. In a mm scene that is 5 mm, and the answer must not change. */
const FLOOR_CAMERA = { mode: 'orbit', camtype: 0, target: [0, 0, 0], azimuth: 30, elevation: 8, distance: 5, fov: 40 }
/* 70 degrees off vertical: an OBLIQUE view, the one the old sampler got wrong -- a camera looking
   straight down cannot tell a correct visible-normal sampler from the broken one. */
const OBLIQUE_CAMERA = { mode: 'orbit', camtype: 0, target: [0, 0, 0], azimuth: 30, elevation: 70, distance: 5, fov: 40 }
/* The sphere from three units: it fills most of the frame and shows every angle out to the limb.
   The background is the environment itself and reads exactly 1, so a deficit on the sphere shows
   at about three quarters of its size in the mean. */
const FURNACE_CAMERA = { mode: 'orbit', camtype: 0, target: [0, 0, 0], azimuth: 30, elevation: 60, distance: 3, fov: 40 }
const floorExpected = v => {
    const h = Math.max(0, Math.sin((v.uSunElevation ?? 45) * Math.PI / 180))
    return FLOOR_ALBEDO * ((v.sunIlluminance ?? 0) * h + (v.skyIlluminance ?? 0)) / Math.PI
}
/* THE DISC LIGHT'S ANSWER. Illuminance on the floor z = 0 at distance rho from the axis, from a
   Lambertian cylinder of luminance L (axis z, centre height H, half-thickness T, radius R): the
   bottom face and the rim, each element counted where it faces the point -- which for a convex
   emitter is exactly where it is visible. Midpoint rule; with T = 0 it matches the closed form
   (pi L / 2)(1 - (h^2 + rho^2 - R^2) / sqrt((h^2 + rho^2 + R^2)^2 - 4 rho^2 R^2)) to 1e-6, and at
   T = 1 cm the rim adds 1.8% at rho = 2R and 4% at 3R, which is why it is not left out. */
export function cylinderE(rho, { L, H, R, T }, N = 300) {
    let E = 0
    const zb = H - T, dr = R / N, dph = 2 * Math.PI / N
    for (let i = 0; i < N; i++) {
        const r = (i + 0.5) * dr
        for (let j = 0; j < N; j++) {
            const ph = (j + 0.5) * dph, x = r * Math.cos(ph), y = r * Math.sin(ph)
            const d2 = (rho - x) ** 2 + y * y + zb * zb
            E += L * zb * zb / (d2 * d2) * r * dr * dph            // cos_e cos_r / d^2, both zb/d
        }
    }
    const K = 24, dz = 2 * T / K
    if (T > 0) for (let j = 0; j < N; j++) {
        const ph = (j + 0.5) * dph, c = Math.cos(ph), sn = Math.sin(ph)
        for (let k = 0; k < K; k++) {
            const z = zb + (k + 0.5) * dz, vx = rho - R * c, vy = -R * sn
            const d2 = vx * vx + vy * vy + z * z, d = Math.sqrt(d2)
            const ce = (vx * c + vy * sn) / d, cr = z / d
            if (ce > 0) E += L * ce * cr / d2 * R * dph * dz
        }
    }
    return E
}

/* A SENSOR IN THE PICTURE: the illuminance-view reading at a world point, averaged over the
   (2k+1)^2 pixels around where it lands -- each pixel's error bar combined, so the reading says
   how good it is. null if the point is off the picture or behind the camera. The picture must
   be in the illuminance view (measureMode 1), which is what makes pi L a lux figure. Exported for a
   host's rows (builder/lightbench.js). */
export const sensorAt = async (RT, Q, P, k = 1) => {
    const U = RT.cam.getUniforms()
    const q = projectPoint(P, U, RT.cam.get().camtype ?? 0)
    if (!(q.depth > 0) || Math.abs(q.x) > 0.95 || Math.abs(q.y) > 0.95) return null
    const cx = Math.floor((q.x + 1) / 2 * Q.w), cy = Math.floor((q.y + 1) / 2 * Q.h)
    let sum = 0, var_ = 0, n = 0
    const rgb = [0, 0, 0]
    for (let dy = -k; dy <= k; dy++) for (let dx = -k; dx <= k; dx++) {
        const r = await RT.readPixel(cx + dx, cy + dy)
        if (!r) continue
        sum += r.L; var_ += (r.se ?? 0) ** 2; n++
        if (r.rgb) for (let i = 0; i < 3; i++) rgb[i] += r.rgb[i]
    }
    // rgb: the mean colour, in the pixels' own units (not times pi) -- a bench reads its hue
    return n ? { E: Math.PI * sum / n, se: Math.PI * Math.sqrt(var_) / n, rgb: rgb.map(x => x / n) } : null
}

// what a surface facing up receives: the illuminance view must show this whatever the floor is
const floorIlluminance = v => {
    if ((v.envMode | 0) === 1) return v.studioIlluminance ?? 1000     // the studio light: as set
    const h = Math.max(0, Math.sin((v.uSunElevation ?? 45) * Math.PI / 180))
    return (v.sunIlluminance ?? 0) * h + (v.skyIlluminance ?? 0)
}
/* Low and to the side, BELOW the disc light (5 cos 80 = 0.87 up, the disc's face is at 0.99):
   the floor under the disc is in view instead of hidden behind it. */
const DISC_CAMERA = { mode: 'orbit', camtype: 0, target: [0, 0, 0], azimuth: 30, elevation: 80, distance: 5, fov: 40 }
const DISC_RADII = [0, 0.5, 1, 1.5]
/* A SMALL SCENE AND ITS RADIUS (0.9.1; photometry.js photonHalf): the same centimetre scene twice, without a radius
   of its own (the 400 m default: the sun's photon square and the emitter search stay at their 15 m settings, as
   before) and with one just round it (both capped to it). Made once each: the runner tells scenes apart by object. */
const BALL_CM = testScene('cm', 'ball')
const BALL_CM_R5 = { ...testScene('cm', 'ball'), id: 'bench-ball-cm-r5', envRadius: 5 }
const DISC_CM = testScene('cm', 'disc')
const DISC_CM_R6 = { ...testScene('cm', 'disc'), id: 'bench-disc-cm-r6', envRadius: 6 }
/* the ball side on to the sun (its azimuth 45, in either sense), its caustic on the floor beside it in view */
const BALL_CAMERA = { mode: 'orbit', camtype: 0, target: [0, 0, 0.3], azimuth: 135, elevation: 45, distance: 3.5, fov: 40 }
/* THE DISC LIGHT'S SENSORS, read after a row: measured / closed form at each radius (four directions
   each, those on the picture), and the worst relative error. In the picture rather than the
   illuminance view, the floor's luminance is rho E / pi, so E is pi L / albedo. */
const discRead = radii => async (RT, c, ctx) => {
    const v = RT.get()
    const geo = { L: v.tEmit, H: v.tDiscH, R: v.tDiscR, T: v.tDiscT }
    const albedo = (v.measureMode | 0) === 1 ? 1 : v.tBase
    const discRatio = [], rel = []
    for (const rho of radii) {
        let E = 0, var_ = 0, n = 0
        for (const ph of rho ? [0, 90, 180, 270] : [0]) {
            const a = ph * Math.PI / 180
            const s = await sensorAt(RT, ctx.Q, [rho * Math.cos(a), rho * Math.sin(a), 0])
            if (!s) continue
            E += s.E / albedo; var_ += (s.se / albedo) ** 2; n++
        }
        const exp = cylinderE(rho, geo)
        discRatio.push(n ? E / n / exp : null)
        if (n) rel.push(Math.sqrt(var_) / n / exp)
    }
    return { discRatio, discSe: rel.length ? Math.max(...rel) : null }
}
/* LOOKING DOWN AT THE FLOOR BESIDE THE DISC, which is out of the picture (about 40 degrees above its top
   edge): the disc's light is in view, the disc is not -- so a path that stops at the floor can only
   find it by a seek ray (render-modes, below). The sensors at 1 and 1.5 m are on the picture. */
const BESIDE_DISC_CAMERA = { mode: 'orbit', camtype: 0, target: [1.5, 0, 0], azimuth: 0, elevation: 20, distance: 2, fov: 30 }
/* Draft and full, compared row by row where no absolute answer is written: each Draft row's meanLuma over
   the last full row's. A closure, so it is reset by the first full row of every run. */
let lastFullLuma = null
const vsFull = async RT => {
    const st = await RT.imageStats()
    if ((RT.get().renderMode | 0) === 0) { lastFullLuma = st.meanLuma; return { vsFull: 1 } }
    return { vsFull: lastFullLuma > 0 ? st.meanLuma / lastFullLuma : null }
}
const FURNACE_L = 1000
const LAMBERT = { tMetal: 0, tSpec: 0, tTrans: 0, tAniso: 0, tGrain: 0 }
/* THE HAZE BOX'S FURNACE (0.62.0; core/haze.js): the furnace's unit sphere inside a box of dust 3.2 m wide, mean free path
   1.5 m -- about two along a line through it -- of albedo `albedo` and asymmetry g; `on` false, the box there and its
   density 0 (the kernels the same). One object a row, so a row's scene is its own (the bench swaps by object). */
const hazeFurnace = (g, albedo, on = true) => ({ ...testScene('m', 'sphere'), id: `bench-haze-${g}-${albedo}${on ? '' : '-hidden'}`,
    haze: { centre: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], half: [1.6, 1.6, 1.6], mfp: 1.5, albedo: [albedo, albedo, albedo], g, on } })

/* THE RULES (verdict.js): what each test's rows must read to PASS, written beside its note as `verdict(row, i, rows,
   case)`. THE FLOORS ARE CHOICES -- what each note says the code is allowed, held against the user's 0.77.0 run
   (Pascal, 2026-10-22) and the baselines the notes quote -- not measurements; the next run tunes them. A test with no
   rule (the speed tests, the benchmarks) reads INFO: its numbers are for reading. */
const fin = v => typeof v === 'number' && Number.isFinite(v)
// the error bar of a ratio of a row's meanLuma to a fixed answer: the mean's own, scaled
const ratioSe = (r, ratio) => { const s = V.meanSe(r); return fin(s) && r.meanLuma ? s * Math.abs(ratio / r.meanLuma) : null }
// a ratio against its answer (1 unless said), the row's own error bar
const vsAnswer = (ratio, r, floor, want = 1, what = 'ratio') => V.near(ratio, want, { se: ratioSe(r, ratio), floor, what })
// the row named by the start of its label: a rule that says "against the light-tracing-off row" survives a reorder
const labelled = (rows, start) => rows.find(x => x.case.startsWith(start))
/* rows that must agree with a reference row on meanLuma; the reference itself is INFO, since it is what the others
   are judged by */
const vsRow = (ref, floor) => (r, i, rows) => {
    const x = typeof ref === 'function' ? ref(rows, i) : labelled(rows, ref)
    return x === r ? V.info('the reference: the rows that must agree with it are judged against it')
        : V.agreeMean(r, x, typeof floor === 'function' ? floor(r) : floor)
}
/* THE OPTICS TRACE'S RULE: the row's `expect` against its reading, the share's own counting noise as its error bar
   (an arrival count or an angle has none: the floor alone); the flux in flight 0 unless it is what the row asks;
   a colour within du'v' of its target. A row marked `mustFail` is a known limit kept visible: it must MISS by over
   that much. `floors` per expect key, relative to the answer; 3e-3 otherwise ("1 within a few 1e-3"). */
const opticsRule = (floors = {}) => (r, i, rows, c) => {
    const e = c?.expect, out = []
    if (e && c.mustFail) out.push(V.mustDiffer(r.measured, r.expected, c.mustFail, e.key))
    else if (e) {
        const se = /Share$/.test(e.key) ? V.shareSe(r.measured, r.rays) : null
        out.push(V.near(r.measured, r.expected, { se, floor: (floors[e.key] ?? 3e-3) * Math.abs(r.expected), what: e.key }))
    }
    if (e?.key !== 'balance' && fin(r.balance)) out.push(V.near(r.balance, 0, { floor: 1e-6, what: 'balance' }))
    if (r.dupvp != null) out.push(V.below(r.dupvp, floors.dupvp?.(c) ?? 1e-3, "du'v'"))
    return V.worst(out)
}
/* SENSORS in the picture (disc-light's rho columns, the optics source's x columns): each against 1 within the row's
   worst error bar, or 1% -- a 3x3-pixel sensor reads a patch, not a point, and the closed forms are for a point */
const sensorRule = (get, getSe, names) => r => V.sensors(get(r), getSe(r), 0.01, names)
const DISC_NAMES = DISC_RADII.map(x => `rho ${x}`), X_NAMES = [0, 0.5, 1].map(x => `x ${x}`)

export const TESTS = [
    {
        id: 'photometry',
        kind: 'image',
        title: 'Physical units: does a white floor come out at rho E / pi?',
        verdict: (r, i, rows) => {
            const ratio = r.meanLuma / r.expected
            /* the clamp with NEE off removes the fireflies that carry the sun there: it must read BELOW its unclamped
               row, by the energy it took (0.21 against 1.00 in the 0.77.0 run) */
            if (r.case.includes('NEE off') && r.case.includes('clamp')) {
                const un = labelled(rows, 'sun + sky, NEE off, 10-degree disc')
                return un ? V.below(ratio, 0.95 * un.meanLuma / un.expected, 'ratio, against the unclamped row\'s') : V.none('no unclamped row')
            }
            return vsAnswer(ratio, r, 0.005)
        },
        note: 'THE FIRST ABSOLUTE CHECK THIS RENDERER HAS HAD. Every other test compares two'
            + ' arms of the same renderer; this one compares against arithmetic. ratio = meanLuma'
            + ' / (0.8 (E_sun sin h + E_sky) / pi), and it should be 1. meanLuma rather than the'
            + ' median: the median of a skewed per-pixel distribution is not its mean, and NEE'
            + ' makes it skewed. WHAT A MISS MEANS: every row off by the same few percent is the'
            + ' DIFFUSE MODEL, not the units. A'
            + ' sun-only row off while sky-only holds is the disc: its luminance, its pdf or its'
            + ' edge. Sky-only off, or the turbidity row disagreeing with the sky row, is the'
            + ' sky normalisation (prog_skynorm). The mm rows must equal their m rows: radiance'
            + ' has no length in it, so the scene unit may change tolerances, never light.'
            + ' Loads its own scene and camera and puts yours back afterwards.'
            + ' BASELINE (Pascal, after the material review): 0.998 - 1.000 on EVERY row, the floor'
            + ' a pure Lambertian. (Before it, ~0.975: the floor was a plastic whose base lost'
            + ' (1-F) under a 4% coat.) One row leaving the pack is the signal; the whole column'
            + ' moving means the material changed.'
            + ' THE TWO FIREFLY-CLAMP ROWS (fireflyClamp is in multiples of the display white):'
            + ' at 4x white the floor must still read 1 -- a sunlit floor is far below the cap, and'
            + ' the clamp in cd/m^2 it replaced took this floor dark at any value that touched a'
            + ' firefly. The NEE-off row is the clamp doing its job: there the sun is found only by'
            + ' rare BSDF rays carrying huge values, so it reads BELOW its unclamped row above, by'
            + ' the energy of the fireflies it removed. Those two rows are the clamp run at all.'
            + ' See TESTING.md.',
        delta: 'meanLuma',
        samples: 32,
        scene: floorScene('m'),
        camera: FLOOR_CAMERA,
        pin: { maxaverages: 0, maxiter: 400, maxbounce: 10, rr: 0, nee: 1, lt: 0, envUniform: 0,
               fireflyClamp: 0, uSunAzimuth: 45, uSunElevation: 45, uSkyTurbidity: 0.7,
               sunIlluminance: 100000, sunDiameter: 0.53, skyIlluminance: 15000,
               ...LAMBERT, tBase: FLOOR_ALBEDO, tRough: 1, tIor: 1.5 },
        extra: {
            columns: [['expected', r => r.expected, 1], ['ratio', r => r.meanLuma / r.expected, 4]],
            // the settings the row actually ran with, after the pin and the case were applied
            read: async RT => ({ expected: floorExpected(RT.get()) }),
        },
        cases: [
            { label: 'sun + sky', set: {} },
            { label: 'sun only', set: { skyIlluminance: 0 } },
            { label: 'sky only', set: { sunIlluminance: 0 } },
            { label: 'sun only, elevation 20', set: { skyIlluminance: 0, uSunElevation: 20 } },
            { label: 'sun only, 10-degree disc', set: { skyIlluminance: 0, sunDiameter: 10 } },
            { label: 'sky only, turbidity 4', set: { sunIlluminance: 0, uSkyTurbidity: 4 } },
            { label: 'sun + sky, NEE off, 10-degree disc', set: { nee: 0, sunDiameter: 10 } },
            { label: 'sun + sky, light tracing on', set: { lt: 1 } },
            { label: 'sun + sky, mm scene', set: {}, scene: floorScene('mm') },
            { label: 'sky only, mm scene', set: { sunIlluminance: 0 }, scene: floorScene('mm') },
            { label: 'sun + sky, firefly clamp 4x white', set: { fireflyClamp: 4 } },
            { label: 'sun + sky, NEE off, 10-degree disc, clamp 4x', set: { nee: 0, sunDiameter: 10, fireflyClamp: 4 } },
        ],
    },
    {
        id: 'error-bar',
        kind: 'image',
        title: 'Error bars: does each pixel report the noise it really has?',
        verdict: (r, i, rows) => V.worst([
            V.near(r.seRatio, 1, { floor: r.case.includes('NEE off') ? 0.05 : 0.03, what: 'seRatio' }),
            // four times the samples, half the error bar
            r.case.includes('128 samples') ? V.near(r.relSE / rows[0].relSE, 0.5, { floor: 0.05, what: 'relSE against 32 samples\'' }) : null,
        ]),
        note: 'THE ERROR BAR CHECKED AGAINST THE PICTURE. Every pixel now carries the standard'
            + ' error of its mean (resolve keeps its variance; core/measure.js), which is what the'
            + ' HUD shows under the cursor. On the photometry floor -- flat and evenly lit, so'
            + ' neighbouring pixels differ ONLY by noise -- the mean squared difference of'
            + ' neighbours must equal the sum of their reported squared errors: seRatio = 1. Below'
            + ' 1 the bars are too wide, above 1 too narrow (or the picture has detail, which this'
            + ' one does not). relSE is the typical pixel error relative to the mean, and it should'
            + ' fall as 1/sqrt(samples): the 128-sample row about half the 32-sample one. The'
            + ' window-10 row tests the moving average, whose worth is about 2N+1 = 21 samples,'
            + ' not 10 and not 32. NEE off is the hard case: heavy-tailed, so its ratio wanders'
            + ' more at 32 samples. Loads its own scene and camera.',
        delta: 'meanLuma',
        samples: 32,
        scene: floorScene('m'),
        camera: FLOOR_CAMERA,
        pin: { maxaverages: 0, maxiter: 400, maxbounce: 10, rr: 0, nee: 1, lt: 0, envUniform: 0,
               fireflyClamp: 0, uSunAzimuth: 45, uSunElevation: 45, uSkyTurbidity: 0.7,
               sunIlluminance: 100000, sunDiameter: 0.53, skyIlluminance: 15000,
               ...LAMBERT, tBase: FLOOR_ALBEDO, tRough: 1, tIor: 1.5 },
        extra: {
            columns: [['relSE', r => r.relSE, 5], ['seRatio', r => r.seRatio, 3]],
            read: async () => ({}),                 // both come with the image statistics
        },
        cases: [
            { label: 'sun + sky, 32 samples', set: {} },
            { label: 'sun + sky, 128 samples', set: {}, samples: 128 },
            { label: 'sky only', set: { sunIlluminance: 0 } },
            { label: 'sun + sky, NEE off, 10-degree disc', set: { nee: 0, sunDiameter: 10 } },
            { label: 'sun + sky, light tracing on', set: { lt: 1 } },
            { label: 'sun + sky, EMA window 10', set: { maxaverages: 10 } },
            { label: 'sun + sky, mm scene', set: {}, scene: floorScene('mm') },
        ],
    },
    {
        id: 'illuminance',
        kind: 'image',
        title: 'Illuminance view: does every surface read the lux falling on it?',
        verdict: (r, i, rows, c) => {
            // the luminance view shows the floor itself: its ratio is the albedo, its area against rho E / pi
            const want = c?.set?.measureMode === 2 ? (c.set.tBase ?? FLOOR_ALBEDO) : 1
            return V.worst([vsAnswer(Math.PI * r.meanLuma / r.expected, r, 0.005, want),
                            V.near(r.areaRatio, 1, { se: r.areaRel, floor: 0.005, what: 'area' })])
        },
        note: 'THE ILLUMINANCE VIEW AGAINST ARITHMETIC (Measure group, measureMode 1). The camera\'s'
            + ' first hit is replaced by a white Lambertian for one bounce, so the picture holds'
            + ' E/pi and lux = pi meanLuma must equal E_sun sin h + E_sky on the photometry floor --'
            + ' WHATEVER THE FLOOR IS MADE OF. That is the point of the swap, so the rows make the'
            + ' floor dark, a mirror and glass: a row that follows its material instead of the light'
            + ' means the swap missed a path (NEE, light tracing\'s connection, the MIS weights).'
            + ' ratio = lux / expected, should be 1 on every row, as photometry\'s does. Loads its'
            + ' own scene and camera. AREA is the measure tool\'s rectangle (measureRegion) over the'
            + ' middle quarter of the picture, against the same answer: 1, with areaSe its relative'
            + ' error bar. The luminance-view row (measureMode 2) shows the real floor, so its'
            + ' ratio reads the albedo (0.8) and its area column is taken against rho E / pi: 1.',
        delta: 'meanLuma',
        samples: 32,
        scene: floorScene('m'),
        camera: FLOOR_CAMERA,
        pin: { maxaverages: 0, maxiter: 400, maxbounce: 10, rr: 0, nee: 1, lt: 0, envUniform: 0,
               fireflyClamp: 0, uSunAzimuth: 45, uSunElevation: 45, uSkyTurbidity: 0.7,
               sunIlluminance: 100000, sunDiameter: 0.53, skyIlluminance: 15000,
               ...LAMBERT, tBase: FLOOR_ALBEDO, tRough: 1, tIor: 1.5, measureMode: 1 },
        extra: {
            columns: [['lux', r => Math.PI * r.meanLuma, 1], ['expected', r => r.expected, 1],
                      ['ratio', r => Math.PI * r.meanLuma / r.expected, 4],
                      ['area', r => r.areaRatio, 4], ['areaSe', r => r.areaRel, 4]],
            read: async RT => {
                const v = RT.get(), expected = floorIlluminance(v)
                /* the measure tool's rectangle: lux in the illuminance view; in the luminance view
                   the floor's own luminance, rho E / pi */
                const a = await RT.measureRegion?.(-0.5, -0.5, 0.5, 0.5)
                const want = a?.unit === 'lx' ? expected : v.tBase * expected / Math.PI
                return { expected, areaRatio: a ? a.mean / want : null, areaRel: a?.rel ?? null }
            },
        },
        cases: [
            { label: 'white floor, sun + sky', set: {} },
            { label: 'dark floor (albedo 0.05)', set: { tBase: 0.05 } },
            { label: 'mirror floor', set: { tMetal: 1, tRough: 0, tSpec: 1 } },
            { label: 'glass floor', set: { tTrans: 1, tRough: 0, tSpec: 0.5 } },
            { label: 'sun only, elevation 20', set: { skyIlluminance: 0, uSunElevation: 20 } },
            { label: 'sky only', set: { sunIlluminance: 0 } },
            { label: 'NEE off, 10-degree disc', set: { nee: 0, sunDiameter: 10 } },
            { label: 'light tracing on, mirror floor', set: { lt: 1, tMetal: 1, tRough: 0, tSpec: 1 } },
            { label: 'mm scene', set: {}, scene: floorScene('mm') },
            { label: 'LUMINANCE VIEW (mode 2): ratio reads the albedo, area 1', set: { measureMode: 2 } },
            /* the studio light: a level floor facing up receives studioIlluminance, whatever the
               top-light share -- L0 is derived to make it so (photometry.studioLuminance) */
            { label: 'STUDIO light, 2000 lx, top 0.5', set: { envMode: 1, studioIlluminance: 2000, studioTop: 0.5 } },
            { label: 'STUDIO light, 2000 lx, flat, tinted', set: { envMode: 1, studioIlluminance: 2000, studioTop: 0,
                                                                   studioColor: { r: 1, g: 0.8, b: 0.6 } } },
        ],
    },
    {
        id: 'cosine-law',
        kind: 'image',
        title: 'Cosine law: does a tilted surface receive E_sun sin(elevation + tilt)?',
        verdict: r => r.expected > 0 ? vsAnswer(Math.PI * r.meanLuma / r.expected, r, 0.005)
            : V.exactly(r.meanLuma, 0, 'luminance, the plane\'s back to the sun'),
        note: 'THE COSINE LAW, in the illuminance view (measureMode 1). One plane through the'
            + ' origin, tilted towards the sun in the sun\'s own vertical plane, the sun alone (no'
            + ' sky), elevation 45: the lux on it must be E_sun sin(45 + tilt) -- all of the sun at'
            + ' tilt 45 (facing it), 0.5 at tilt -15, none once it turns its back (tilt -50: must read'
            + ' 0, so ratio is blank). ratio = lux / expected, 1 on every lit row. A miss that grows'
            + ' with the tilt is the cosine; one that does not is the sun itself (photometry'
            + ' checks that). Loads its own scene and camera.',
        delta: 'meanLuma',
        samples: 32,
        scene: testScene('m', 'tilted'),
        camera: FLOOR_CAMERA,
        pin: { maxaverages: 0, maxiter: 400, maxbounce: 10, rr: 0, nee: 1, lt: 0, envUniform: 0,
               fireflyClamp: 0, uSunAzimuth: 45, uSunElevation: 45, uSkyTurbidity: 0.7,
               sunIlluminance: 100000, sunDiameter: 0.53, skyIlluminance: 0,
               ...LAMBERT, tBase: FLOOR_ALBEDO, tRough: 1, tIor: 1.5, measureMode: 1 },
        extra: {
            columns: [['lux', r => Math.PI * r.meanLuma, 1], ['expected', r => r.expected, 1],
                      ['ratio', r => r.expected > 0 ? Math.PI * r.meanLuma / r.expected : null, 4]],
            read: async RT => {
                const v = RT.get()
                const a = ((v.uSunElevation ?? 45) + (v.tTilt ?? 0)) * Math.PI / 180
                return { expected: (v.sunIlluminance ?? 0) * Math.max(0, Math.sin(a)) }
            },
        },
        cases: [
            { label: 'level (tilt 0)', set: { tTilt: 0 } },
            { label: 'tilt 30 towards the sun', set: { tTilt: 30 } },
            { label: 'tilt 45: facing the sun', set: { tTilt: 45 } },
            { label: 'tilt -15: sun at 30 degrees', set: { tTilt: -15 } },
            { label: 'tilt -30: sun at 15 degrees', set: { tTilt: -30 } },
            { label: 'tilt -50: back to the sun (0 lx)', set: { tTilt: -50 } },
            { label: 'tilt 30, NEE off, 10-degree disc', set: { tTilt: 30, nee: 0, sunDiameter: 10 } },
        ],
    },
    {
        id: 'disc-light',
        kind: 'image',
        title: 'Disc light: does an emitter light the floor as the closed form says?',
        verdict: sensorRule(r => r.discRatio, r => r.discSe, DISC_NAMES),
        note: 'THE FIRST ABSOLUTE CHECK OF AN EMITTER. A white Lambertian disc of 10 000 cd/m^2,'
            + ' radius 0.5 m, its face 0.99 m above the floor, sun and sky off -- so every lux on'
            + ' the floor comes from it, and the answer is arithmetic: the closed form for a disc'
            + ' plus the 1 cm rim, integrated (cylinderE). Read by sensors in the picture at 0, 0.5,'
            + ' 1 and 1.5 m from the axis (four directions each, 3x3 pixels, error bars combined):'
            + ' each column is measured / expected and must be 1 within its error (seMax, the worst'
            + ' relative error). The camera sits below the disc to see the floor under it. Rows:'
            + ' NEE with discovered emitters, BSDF sampling alone, light tracing\'s emitter photons,'
            + ' NEE\'s emitter share at 0.9, and the PICTURE (not the illuminance view) read as pi'
            + ' L / albedo, which checks emitters in the ordinary render too. Loads its own scene and'
            + ' camera.',
        delta: 'meanLuma',
        samples: 64,
        scene: testScene('m', 'disc'),
        camera: DISC_CAMERA,
        pin: { maxaverages: 0, maxiter: 400, maxbounce: 10, rr: 0, nee: 1, lt: 0, envUniform: 0,
               fireflyClamp: 0, sunIlluminance: 0, skyIlluminance: 0,
               ...LAMBERT, tBase: FLOOR_ALBEDO, tRough: 1, tIor: 1.5, measureMode: 1,
               tDiscH: 1, tDiscR: 0.5, tDiscT: 0.01, tEmit: 10000 },
        extra: {
            columns: [...DISC_RADII.map((rho, i) => [`rho ${rho}`, r => r.discRatio?.[i] ?? null, 4]),
                      ['seMax', r => r.discSe, 4]],
            read: discRead(DISC_RADII),
        },
        cases: [
            { label: 'NEE on', set: {} },
            { label: 'NEE off (BSDF sampling alone)', set: { nee: 0 } },
            { label: 'light tracing on', set: { lt: 1 } },
            { label: 'NEE emitter share 0.9', set: { neeEmitShare: 0.9 } },
            { label: 'the picture, not the view (pi L / albedo)', set: { measureMode: 0 } },
        ],
    },
    {
        id: 'render-modes',
        kind: 'image',
        title: 'Draft and Sketch: does Draft keep the direct light exactly, on a floor with nothing else?',
        verdict: (r, i, rows) => {
            if (r.case.includes('sketch')) return V.info('Sketch is a fixed light: reported only')
            if (r.case.startsWith('lamps only')) return V.exactly(r.meanLuma, 0, 'luminance, with no lamp in the scene')
            if (r.lambert) return vsAnswer(r.meanLuma / r.expected, r, 0.005)
            // a floor with no written answer: against the last full row above it
            const full = rows.slice(0, i + 1).reverse().find(x => x.case.endsWith('full'))
            return full === r ? V.info('the reference: the draft row below is judged against it') : V.agreeMean(r, full, 0.005, 'against full')
        },
        note: 'THE FAST MODES AGAINST A KNOWN ANSWER (materials_pbr.js FAST MODES, quality.js). A floor under an'
            + ' open sky gets no bounce light -- nothing else is there to bounce from -- so Draft, which leaves'
            + ' out only the bounce light, must read exactly what full path tracing reads. ratio is meanLuma over'
            + ' rho E / pi for the Lambertian rows (1, as photometry); vsFull is each row over the last full row'
            + ' above it, for the floors with no written answer: a glossy coat (roughness 0.5: an evaluable'
            + ' lobe, where Draft stops and its light sample counts it), a near-mirror coat (0.15: a lobe'
            + ' Draft follows instead) and a mirror. WHAT A MISS MEANS: Draft low on every row is its light'
            + ' sample still weighted by MIS (the BSDF half is never traced); low on the glossy or near-mirror'
            + ' rows alone, the split between what is counted at the stop and what is followed. Sketch is'
            + ' a fixed light, reported only. Lamps only must read 0 with the sun and sky still set: ratio is'
            + ' against the settings, which keep them. BASELINE: none yet -- built 2026-10-01, not run.',
        delta: 'meanLuma',
        samples: 32,
        scene: floorScene('m'),
        camera: FLOOR_CAMERA,
        pin: { maxaverages: 0, maxiter: 400, maxbounce: 10, rr: 0, nee: 1, lt: 0, envUniform: 0,
               fireflyClamp: 0, uSunAzimuth: 45, uSunElevation: 45, uSkyTurbidity: 0.7,
               sunIlluminance: 100000, sunDiameter: 0.53, skyIlluminance: 15000,
               ...LAMBERT, tBase: FLOOR_ALBEDO, tRough: 1, tIor: 1.5 },
        extra: {
            columns: [['ratio', r => r.lambert ? r.meanLuma / r.expected : null, 4], ['vsFull', r => r.vsFull, 4]],
            read: async (RT, c) => {
                const v = RT.get()
                const lambert = !(v.tSpec > 0) && !(v.tMetal > 0)
                // vsFull only where there is no written answer: those rows come in pairs, full then draft
                return { lambert, expected: FLOOR_ALBEDO * floorIlluminance(v) / Math.PI, ...(lambert ? {} : await vsFull(RT)) }
            },
        },
        cases: [
            { label: 'Lambertian, full', set: {} },
            { label: 'Lambertian, draft', set: { renderMode: 1 } },
            { label: 'Lambertian, sketch (a fixed light: reported only)', set: { renderMode: 2 } },
            { label: 'sun only, full', set: { skyIlluminance: 0 } },
            { label: 'sun only, draft', set: { skyIlluminance: 0, renderMode: 1 } },
            { label: 'sky only, draft', set: { sunIlluminance: 0, renderMode: 1 } },
            { label: 'studio light, draft', set: { envMode: 1, renderMode: 1 } },
            { label: 'glossy coat (roughness 0.5), full', set: { tSpec: 0.5, tRough: 0.5 } },
            { label: 'glossy coat (roughness 0.5), draft', set: { tSpec: 0.5, tRough: 0.5, renderMode: 1 } },
            { label: 'near-mirror coat (roughness 0.15), full', set: { tSpec: 0.5, tRough: 0.15 } },
            { label: 'near-mirror coat (roughness 0.15), draft', set: { tSpec: 0.5, tRough: 0.15, renderMode: 1 } },
            { label: 'mirror metal, full', set: { tMetal: 1, tRough: 0, tBase: 0.9 } },
            { label: 'mirror metal, draft', set: { tMetal: 1, tRough: 0, tBase: 0.9, renderMode: 1 } },
            { label: 'lamps only, draft (sun and sky still set): 0', set: { lampsOnly: 1, renderMode: 1 } },
            { label: 'lamps only, full: 0', set: { lampsOnly: 1 } },
        ],
    },
    {
        id: 'draft-lamps',
        kind: 'image',
        title: 'Draft: does a lamp the camera cannot see still light the floor?',
        verdict: (r, i, rows) => {
            if (r.case.includes('seek rays off')) return V.exactly(r.meanLuma, 0, 'luminance, the disc never found')
            const sens = V.sensors(r.discRatio, r.discSe, 0.01, ['rho 1', 'rho 1.5'])
            // lamps only leaves the sun and sky out however they are set: the draft row's picture, which its note expects
            if (r.case.includes('lamps only')) return V.worst([sens, V.agreeMean(r, labelled(rows, 'draft'), 0.01, 'against draft')])
            return sens
        },
        note: 'DRAFT\'S SEEK RAYS (materials_pbr.js FAST MODES). The disc light of disc-light, the camera looking'
            + ' down at the floor beside it with the disc out of the picture. Emitters are found by the camera'
            + ' paths that hit them; a Draft path stops at the floor, so without seek rays (draftSeek 0) the disc'
            + ' is never found and the floor stays dark. Each row loads the scene afresh, which forgets every'
            + ' emitter found before it, so each starts from nothing -- and then WARMS UP (clearLearned): two of'
            + ' the list\'s rebuilds in the row\'s own mode, the seek rays finding the disc or not, before the'
            + ' picture is cleared and its samples count. Without it a Draft row\'s first samples were black'
            + ' until the list reached the kernels, and how many depended on timing: the user\'s three runs'
            + ' (0.77.0 and 0.78.0) read draft 0.998, 0.984, 0.984 of full and lamps only 0.968, 0.984, 0.968 --'
            + ' 0, 1 or 2 of 64 samples (1/64 is 1.6 %), and the lamps-only row\'s check against draft was'
            + ' one row\'s start against the other\'s. On Dawn (2026-10-26) a fresh Draft row\'s first two samples'
            + ' read exactly 0, 0.971-0.981 of full over 64, and 0.9994 warmed (lamps only 1.0024). Columns as'
            + ' disc-light, in the picture (pi L / albedo): 1 is the closed form. EXPECTED: full, draft and'
            + ' lamps only with the sun and sky set 1, the last two the same; seek rays off 0 (never found, warm'
            + ' or not). BASELINE: none yet -- built 2026-10-01.',
        delta: 'meanLuma',
        samples: 64,
        // the emitter list found before the samples count (the clearLearned block in measureImage)
        clearLearned: true,
        scene: testScene('m', 'disc'),
        camera: BESIDE_DISC_CAMERA,
        pin: { maxaverages: 0, maxiter: 400, maxbounce: 10, rr: 0, nee: 1, lt: 0, envUniform: 0,
               fireflyClamp: 0, sunIlluminance: 0, skyIlluminance: 0,
               ...LAMBERT, tBase: FLOOR_ALBEDO, tRough: 1, tIor: 1.5, measureMode: 0,
               tDiscH: 1, tDiscR: 0.5, tDiscT: 0.01, tEmit: 10000 },
        extra: {
            columns: [...[1, 1.5].map((rho, i) => [`rho ${rho}`, r => r.discRatio?.[i] ?? null, 4]), ['seMax', r => r.discSe, 4]],
            read: discRead([1, 1.5]),
        },
        cases: [
            // a scene object of its own per row: the swap clears the emitter list (raytrace_main.js setScene)
            { label: 'full', set: {}, scene: { ...testScene('m', 'disc'), id: 'bench-disc-m-a' } },
            { label: 'draft', set: { renderMode: 1 }, scene: { ...testScene('m', 'disc'), id: 'bench-disc-m-b' } },
            { label: 'draft, seek rays off: the disc is never found', set: { renderMode: 1, draftSeek: 0 },
              scene: { ...testScene('m', 'disc'), id: 'bench-disc-m-c' } },
            { label: 'draft, lamps only, sun and sky set', set: { renderMode: 1, lampsOnly: 1, sunIlluminance: 100000, skyIlluminance: 15000 },
              scene: { ...testScene('m', 'disc'), id: 'bench-disc-m-d' } },
        ],
    },
    {
        id: 'scale',
        kind: 'image',
        title: 'Scale: does a glass sphere look the same in m, cm and mm?',
        verdict: (r, i, rows) => {
            /* THE OLD 1 mm must NOT match: on trimmedLuma, since this glass sphere's meanLuma carries the sun's
               fireflies (relSE about 25 a pixel: a few % on the mean) and the old row has none */
            if (r.case.includes('OLD')) return V.mustDiffer(r.trimmedLuma, labelled(rows, 'glass sphere, mm')?.trimmedLuma, 0.05, 'trimmedLuma')
            return i === 0 ? V.info('the reference: cm and mm must agree with it') : V.agreeMean(r, rows[0], 0.005)
        },
        note: 'THE SURFACE TOLERANCE AGAINST THE SCENE UNIT. The same unit-radius glass sphere, seen'
            + ' from three units away under sun and sky, in metres, centimetres and millimetres: light'
            + ' has no length in it and the camera is in scene units, so the three pictures are the'
            + ' same one, and meanLuma must match within noise. It did not before: the tolerance was'
            + ' a fixed 1 mm and the step off a surface 10 mm, so in a 1 mm sphere a refracted ray was'
            + ' carried straight out of it. Now it is a share of the scene\'s size (photometry.js'
            + ' autoEps, never coarser than 1 mm). The last row puts the old fixed 1 mm back in the mm'
            + ' scene: it must NOT match -- that is the failure the change removes, kept visible.',
        delta: 'meanLuma',
        samples: 32,
        scene: testScene('m', 'sphere'),
        camera: FURNACE_CAMERA,
        pin: { maxaverages: 0, maxiter: 400, maxbounce: 16, rr: 0, nee: 1, lt: 0, envUniform: 0,
               fireflyClamp: 0, uSunAzimuth: 45, uSunElevation: 45, uSkyTurbidity: 0.7,
               sunIlluminance: 100000, sunDiameter: 0.53, skyIlluminance: 15000, eps: 0,
               tBase: 1, tMetal: 0, tRough: 0, tSpec: 0.5, tTrans: 1, tIor: 1.5 },
        cases: [
            { label: 'glass sphere, m', set: {} },
            { label: 'glass sphere, cm', set: {}, scene: testScene('cm', 'sphere') },
            { label: 'glass sphere, mm', set: {}, scene: testScene('mm', 'sphere') },
            { label: 'mm, the OLD fixed 1 mm (must differ)', set: { eps: 0.001 }, scene: testScene('mm', 'sphere') },
        ],
    },
    {
        id: 'optics-light',
        kind: 'image',
        title: 'The optics source lighting the picture: the lux arithmetic says?',
        verdict: r => V.worst([
            V.sensors(r.lightRatio, r.lightSe, 0.01, X_NAMES),
            r.hueErr != null ? V.below(r.hueErr, 1e-3, 'hue error') : null,
            // the mix: its colour as solved, 4000 K on the locus
            r.cct != null ? V.near(r.cct, 4000, { floor: 50, what: 'CCT' }) : null,
            r.dupvp != null ? V.below(r.dupvp, 2e-3, "du'v'") : null,
        ]),
        note: 'THE OPTICS SOURCE IN THE PICTURE (Optics page, "source lights the picture"). Sun and sky'
            + ' off; the only light is the optics source, which is not geometry, so every lux of it'
            + ' comes through light tracing (its photons connect to the camera at every surface). Read'
            + ' in the illuminance view by sensors on the floor at 0, 0.5 and 1 m from below the'
            + ' source. A Lambertian POINT source of flux Phi, h = 1 m up, facing down: E = Phi h^2 /'
            + ' (pi d^4), d the distance to the source -- 318 lx straight below at 1000 lm. A COLLIMATED'
            + ' disc of radius 0.5 m: E = Phi / (pi r^2) inside it (1273 lx at 1000 lm), 0 outside'
            + ' (the 1 m sensor, blank). Each column is measured / expected, 1 within seMax. The'
            + ' picture row checks the same through the floor itself: pi L / albedo. The MM row is the'
            + ' same setup in millimetres -- the lux a million times higher -- and is the row that'
            + ' failed first: the photons carried plain lumens where the connection wants lumens per'
            + ' scene unit squared, 10^4 too dark in a cm scene and right only in metres.',
        delta: 'meanLuma',
        samples: 64,
        scene: floorScene('m'),
        camera: FLOOR_CAMERA,
        pin: { maxaverages: 0, maxiter: 400, maxbounce: 10, rr: 0, nee: 1, lt: 0, envUniform: 0,
               fireflyClamp: 0, sunIlluminance: 0, skyIlluminance: 0,
               ...LAMBERT, tBase: FLOOR_ALBEDO, tRough: 1, tIor: 1.5, measureMode: 1 },
        opticsLight: { perPixel: 1, source: { type: 'point', pos: [0, 0, 1], axis: [0, 0, -1], u: [1, 0, 0],
                       size: [0, 0], distribution: 'cosine', halfAngle: 90, n: 1, flux: 1000, unit: 'lm' } },
        extra: {
            columns: [...[0, 0.5, 1].map((x, i) => [`x ${x}`, r => r.lightRatio?.[i] ?? null, 4]),
                      ['seMax', r => r.lightSe, 4], ['hue err', r => r.hueErr, 4],
                      ['CCT', r => r.cct, 0], ["du'v'", r => r.dupvp, 5]],
            read: async (RT, c, ctx) => {
                const v = RT.get()
                const src = { ...(c.opticsLight ?? {}).source }
                const albedo = (v.measureMode | 0) === 1 ? 1 : v.tBase
                /* lux needs lengths in METRES: the scene's numbers are in its unit, so a 1-unit
                   height in a mm scene is 1 mm and the lux a million times higher */
                const s = { m: 1, cm: 0.01, mm: 0.001 }[RT.scene?.unit] ?? 1
                const expected = x => src.distribution === 'collimated'
                    ? (Math.abs(x) < src.size[0] ? 1000 / (Math.PI * (src.size[0] * s) ** 2) : 0)
                    : 1000 * (1 * s) ** 2 / (Math.PI * ((1 + x * x) * s * s) ** 2)
                const lightRatio = [], rel = []
                let hueErr = null
                const extra = {}
                for (const x of [0, 0.5, 1]) {
                    const s = await sensorAt(RT, ctx.Q, [x, 0, 0])
                    const e = expected(x)
                    lightRatio.push(s && e > 0 ? (s.E / albedo) / e : null)
                    if (s && e > 0) rel.push(s.se / albedo / e)
                    /* THE COLOUR, under the source: the floor is grey (and the illuminance view white),
                       so its colour per unit luminance must be the light's hue per unit luminance.
                       The largest channel difference; 0 within the noise. White must read 0 too. */
                    if (x === 0 && s && s.E > 0 && !c.opticsLight?.sources) {
                        const Ls = s.E / Math.PI, want = hue(src.colour)
                        hueErr = Math.max(...s.rgb.map((v, i) => Math.abs(v / Ls - want[i])))
                    }
                }
                /* A ROW WITH A TARGET COLOUR: the chromaticity against it, in u'v' -- the exact colours
                   summed in the picture's accumulation. Of the WHOLE FRAME, not a sensor: the row's
                   lights sit at one point with one distribution, so the colour is the same everywhere
                   on the floor, and a 3 x 3 sensor holds ~1000 photon hits, ~17 of them from a blue
                   that is 1.6% of the flux -- a one-sigma count moves the mix by 250 K (the first
                   press read 4247 K, du'v' 0.013, lux right). The frame holds ~1e6. */
                if (c.target) {
                    const all = await RT.readRegion?.(0, 0, ctx.Q.w - 1, ctx.Q.h - 1)
                    const ch = all?.colour, [tu, tv] = xyToUpVp(...c.target)
                    if (ch) Object.assign(extra, { cct: ch.cct, dupvp: Math.hypot(ch.u - tu, ch.v - tv) })
                }
                return { lightRatio, lightSe: rel.length ? Math.max(...rel) : null, hueErr, ...extra }
            },
        },
        cases: [
            { label: 'Lambertian point, illuminance view', set: {},
              opticsLight: { perPixel: 1, source: { type: 'point', pos: [0, 0, 1], axis: [0, 0, -1], u: [1, 0, 0],
                             size: [0, 0], distribution: 'cosine', halfAngle: 90, n: 1, flux: 1000, unit: 'lm' } } },
            { label: 'Lambertian point, the picture (pi L / albedo)', set: { measureMode: 0 },
              opticsLight: { perPixel: 1, source: { type: 'point', pos: [0, 0, 1], axis: [0, 0, -1], u: [1, 0, 0],
                             size: [0, 0], distribution: 'cosine', halfAngle: 90, n: 1, flux: 1000, unit: 'lm' } } },
            { label: 'Lambertian point, MM SCENE (1 mm up: 318 Mlx)', set: {}, scene: floorScene('mm'),
              opticsLight: { perPixel: 1, source: { type: 'point', pos: [0, 0, 1], axis: [0, 0, -1], u: [1, 0, 0],
                             size: [0, 0], distribution: 'cosine', halfAngle: 90, n: 1, flux: 1000, unit: 'lm' } } },
            /* A COLOURED LIGHT: the same lux (the hue is normalised to luminance 1) and, on the grey
               floor, the light's own colour (hue err 0). Before the colour rode on the photons'
               beta, the red row's floor read white: hue err about 3. */
            { label: 'RED Lambertian point, the picture', set: { measureMode: 0 },
              opticsLight: { perPixel: 1, source: { type: 'point', pos: [0, 0, 1], axis: [0, 0, -1], u: [1, 0, 0],
                             size: [0, 0], distribution: 'cosine', halfAngle: 90, n: 1, flux: 1000, unit: 'lm',
                             colour: { r: 1, g: 0.1, b: 0.05 } } } },
            { label: 'BLUE Lambertian point, illuminance view', set: {},
              opticsLight: { perPixel: 1, source: { type: 'point', pos: [0, 0, 1], axis: [0, 0, -1], u: [1, 0, 0],
                             size: [0, 0], distribution: 'cosine', halfAngle: 90, n: 1, flux: 1000, unit: 'lm',
                             colour: [0.05, 0.1, 1] } } },
            /* THREE LEDS MIXED TO 4000 K (optics-colour's mix: red, green and a royal blue whose
               exact colour has a negative channel), lighting the floor. The same 1000 lm, so the same
               lux; and the floor must read 4000 K, Duv 0 -- which it only does if the picture ADDS
               the exact colours, negative channel and all, and clips once at the display. It read
               off while each photon was clipped to the gamut before it was added. */
            { label: 'R+G+B mixed to 4000 K, illuminance view', set: {}, target: planckXy(4000),
              opticsLight: { perPixel: 1, source: { type: 'point', pos: [0, 0, 1], axis: [0, 0, -1], u: [1, 0, 0],
                             size: [0, 0], distribution: 'cosine', halfAngle: 90, n: 1, flux: 1000, unit: 'lm' },
                             sources: (() => {
                                 const P = [[0.69, 0.3], [0.205, 0.7], [0.15, 0.025]]
                                 const { flux } = mixToTarget(P, planckXy(4000), 1000)
                                 return P.map((xy, i) => ({ colour: rgbFromXy(...xy), flux: flux[i] }))
                             })() } },
            { label: 'collimated disc r 0.5, illuminance view', set: {},
              opticsLight: { perPixel: 1, source: { type: 'disc', pos: [0, 0, 1], axis: [0, 0, -1], u: [1, 0, 0],
                             size: [0.5, 0.5], distribution: 'collimated', halfAngle: 90, n: 1, flux: 1000, unit: 'lm' } } },
        ],
    },
    {
        id: 'optics-mode',
        kind: 'image',
        title: 'The Optics view: do the lights\' rays light a floor as the lux arithmetic says, and stop there?',
        verdict: r => {
            /* FULL and the illuminance view walk on to the disc and back: x 1 must read ABOVE 1, or the row is not
               telling the modes apart (its note) -- by 3 sigma to PASS, above 1 at all to be a CHECK */
            if (r.case.startsWith('full') || r.case.includes('illuminance view')) {
                const x1 = r.lightRatio?.[2], se = r.lightSe ?? 0
                if (!fin(x1)) return V.none('x 1 not measured')
                const say = `x 1 ${x1.toFixed(4)}, must be above 1 + 3σ (${(1 + 3 * se).toFixed(4)})`
                return x1 > 1 + 3 * se ? V.pass(say) : x1 > 1 ? V.check(say) : V.fail(say)
            }
            return V.sensors(r.lightRatio, r.lightSe, 0.01, X_NAMES)
        },
        note: 'THE OPTICS VIEW (renderMode 3, quality.js; materials_pbr.js FAST MODES). The disc light\'s scene with the'
            + ' disc made an ordinary surface (tEmit 0: the default material, a grey with a coat) and a 1000 lm'
            + ' Lambertian POINT source 0.5 m over the floor, facing down, under it; sun and sky off. In the picture'
            + ' (pi L / albedo), sensors on the floor at 0, 0.5 and 1 m from below the source, against Phi h^2 /'
            + ' (pi d^4): 1273, 318 and 51 lx. In the Optics view with its flat light off, each photon connects at'
            + ' the floor and ENDS there (the floor is diffuse), so the floor reads the direct light exactly: x'
            + ' columns 1 within seMax. In FULL the photons walk on, up to the disc and back down, so the floor reads'
            + ' MORE -- reported, above 1; were it 1 too, the row would not be telling the two apart. Most at x 1,'
            + ' where the direct light is weakest and the light the disc sends down, spread wide, the largest share'
            + ' (1.14 there on the first press; x 0 had been predicted, wrongly).'
            + ' The flat light 2 stops down adds a quarter of Sketch\'s light, 1000 lx with the environment off'
            + ' (photometry.js SKETCH_FALLBACK_LX), as sketchLight puts it on a level surface: E/4 (0.4 + 0.6 cos v),'
            + ' v the view\'s angle from the floor\'s normal -- the expected value includes it, so 1 again. The MM row'
            + ' is the same in millimetres (the lux a million times higher). The illuminance view traces in full'
            + ' whatever the mode (quality.js effective): reported, as the full row -- and it reads what the full row'
            + ' does, the one difference the photon map, which never runs in it. In the user\'s 0.77.0 and 0.78.0 runs'
            + ' the full row read under it at all six sensors (0.78.0: 0.958 / 0.965 / 1.060 against 1.017 / 1.019 /'
            + ' 1.195). Found on Dawn over lavapipe (2026-10-26) in this scene: with the map running every sample, the floor'
            + ' read 0.94-0.97 of the map off -- its batches of photons alone dropped the shadow rays the queue had no'
            + ' room for, and a light\'s photons connect at every surface (raytrace_main.js shadowcap) -- and 1.000 with'
            + ' the cap fixed (0.next). That this was the user\'s shortfall is inferred: the next run says.'
            + ' BASELINE (Ampere, 1243x1020,'
            + ' 2026-10-02, 0.4.0): Optics flat off 0.994 / 0.995 / 0.999 (seMax 0.019); 2 stops down 0.996 / 0.996'
            + ' / 0.998 (0.005); mm 0.997 / 0.993 / 1.023 (0.018); full 1.016 / 1.043 / 1.140; the illuminance view'
            + ' 1.015 / 1.054 / 1.104.',
        delta: 'meanLuma',
        samples: 64,
        scene: testScene('m', 'disc'),
        camera: DISC_CAMERA,
        pin: { maxaverages: 0, maxiter: 400, maxbounce: 10, rr: 0, nee: 1, lt: 0, envUniform: 0,
               fireflyClamp: 0, sunIlluminance: 0, skyIlluminance: 0, measureMode: 0, opticsFlat: -12,
               ...LAMBERT, tBase: FLOOR_ALBEDO, tRough: 1, tIor: 1.5,
               tDiscH: 1, tDiscR: 0.5, tDiscT: 0.01, tEmit: 0 },
        opticsLight: { perPixel: 1, source: { type: 'point', pos: [0, 0, 0.5], axis: [0, 0, -1], u: [1, 0, 0],
                       size: [0, 0], distribution: 'cosine', halfAngle: 90, n: 1, flux: 1000, unit: 'lm' } },
        extra: {
            columns: [...[0, 0.5, 1].map((x, i) => [`x ${x}`, r => r.lightRatio?.[i] ?? null, 4]),
                      ['seMax', r => r.lightSe, 4], ['flat lx', r => r.flatE, 1]],
            read: async (RT, c, ctx) => {
                const v = RT.get()
                const albedo = (v.measureMode | 0) === 1 ? 1 : v.tBase
                const s = { m: 1, cm: 0.01, mm: 0.001 }[RT.scene?.unit] ?? 1
                const h = 0.5, flux = 1000
                const direct = x => flux * (h * s) ** 2 / (Math.PI * ((h * h + x * x) * s * s) ** 2)
                /* THE FLAT LIGHT a camera path adds on the floor in the Optics view (materials_pbr.js
                   sketchLight, over pi / albedo): a headlight's 0.6 at the view's cosine, 0.25 from above
                   and 0.15 along the normal, all of the floor's normal here; none in any other mode */
                const optics = (v.renderMode | 0) === 3 && (v.measureMode | 0) === 0
                const flatE = optics ? SKETCH_FALLBACK_LX * opticsFlatShare(v.opticsFlat) : 0
                const cam = RT.cam.getUniforms().camPos
                const flat = x => {
                    const d = [cam[0] - x, cam[1], cam[2]], cosV = Math.max(0, d[2] / Math.hypot(...d))
                    return flatE * (0.4 + 0.6 * cosV)
                }
                const lightRatio = [], rel = []
                for (const x of [0, 0.5, 1]) {
                    const r = await sensorAt(RT, ctx.Q, [x, 0, 0])
                    const e = direct(x) + flat(x)
                    lightRatio.push(r ? (r.E / albedo) / e : null)
                    if (r) rel.push(r.se / albedo / e)
                }
                return { lightRatio, lightSe: rel.length ? Math.max(...rel) : null, flatE }
            },
        },
        cases: [
            { label: 'full: the direct light and what the disc sends back (above 1)', set: {} },
            { label: 'Optics, flat light off: the direct light alone', set: { renderMode: 3 } },
            { label: 'Optics, flat light 2 stops down: and a quarter of Sketch\'s', set: { renderMode: 3, opticsFlat: -2 } },
            { label: 'Optics, flat light off, MM SCENE', set: { renderMode: 3 }, scene: testScene('mm', 'disc') },
            { label: 'Optics, the illuminance view: traced in full (as the full row)', set: { renderMode: 3, measureMode: 1 } },
        ],
    },
    {
        id: 'optics-balance',
        kind: 'optics',
        title: 'Optics trace: does every ray end where arithmetic says?',
        verdict: opticsRule(),
        note: 'THE OPTICS MODULE AGAINST KNOWN ANSWERS (lib/pathtracer/optics; the Optics page runs'
            + ' the same code). Rays are traced through every material to the end and their flux'
            + ' tallied. A collimated beam onto a lone floor of albedo rho: absorbed = 1 - rho,'
            + ' escaped = rho, and a mirror floor sends all of it back. After ONE STEP on the rho 0.5'
            + ' floor every ray is still going but carries half its flux: balance (the flux still in'
            + ' flight) must read exactly 0.5 and absorbed 0.5; a TRACE of 1 step (the step slider,'
            + ' Live) cuts the rays after their first interaction, so half the flux is still going'
            + ' (lost column). The floor flagged as a DETECTOR stops every ray on arrival: detected 1,'
            + ' absorbed 0, whatever its albedo. A MAXIMUM DISTANCE shorter than the way to the floor'
            + ' stops every ray first: all lost (still going), none absorbed. A point source inside a closed, hollow white'
            + ' sphere of albedo rho (an integrating sphere: a shell 0.1 thick round a cavity of radius 1; until 0.78.0 it'
            + ' was the furnace\'s solid ball, the source inside an opaque solid, and every ray escaped): nothing escapes,'
            + ' and the flux arriving at'
            + ' its wall, summed over every bounce, is 1 + rho + rho^2 + ... = 1 / (1 - rho) times what'
            + ' was emitted -- 5 at 0.8, 2 at 0.5 -- whatever the shape (arrived). A ray is never killed'
            + ' (its weight carries the absorption), so interact/ray reads the bounce cap there.'
            + ' balance must be 0 on every other row (emitted = escaped + absorbed + lost): the'
            + ' tallies lose nothing. (A run once read 2.0e-6 on the albedo 0.8 row, 0.78.0: one ray, a grazing'
            + ' reflection declined by the floor pass after pass until the last, which wrote it back to a march'
            + ' nothing ran -- about one ray in two million, now counted lost: optics/kernels.js onward, 0.next.)'
            + ' ratio = measured / expected, 1 within a few 1e-3.',
        rays: 100000, batches: 4,
        // no maximum distance: the integrating sphere's series needs every bounce it takes
        optics: { maxDist: 0 },
        scene: floorScene('m'),
        pin: { envUniform: 0, sunIlluminance: 0, skyIlluminance: 0, ...LAMBERT, tRough: 1, tIor: 1.5 },
        source: { type: 'disc', pos: [0, 0, 1], axis: [0, 0, -1], u: [1, 0, 0], size: [0.3, 0.3],
                  distribution: 'collimated', halfAngle: 90, n: 1, flux: 1000, unit: 'lm' },
        cases: [
            { label: 'black floor', set: { tBase: 0 }, expect: { key: 'absorbedShare', value: 1 } },
            { label: 'floor albedo 0.5', set: { tBase: 0.5 }, expect: { key: 'absorbedShare', value: 0.5 } },
            { label: 'floor albedo 0.8', set: { tBase: 0.8 }, expect: { key: 'absorbedShare', value: 0.2 } },
            { label: 'mirror floor', set: { tBase: 1, tMetal: 1, tRough: 0, tSpec: 1 },
              expect: { key: 'escapedShare', value: 1 } },
            { label: 'albedo 0.5, Lambertian source', set: { tBase: 0.5 },
              source: { distribution: 'cosine', halfAngle: 90, n: 1 }, expect: { key: 'absorbedShare', value: 0.5 } },
            { label: 'albedo 0.5, ONE STEP: half the flux in flight', set: { tBase: 0.5 }, step: 1,
              expect: { key: 'balance', value: 0.5 } },
            { label: 'albedo 0.5, TRACE 1 step: half still going', set: { tBase: 0.5 }, trace: 1,
              expect: { key: 'lostShare', value: 0.5 } },
            { label: 'MAX DISTANCE 0.5 m, floor 1 m away: none arrive', set: { tBase: 0.5 }, optics: { maxDist: 0.5 },
              expect: { key: 'lostShare', value: 1 } },
            { label: 'the floor a DETECTOR: every ray caught', set: { tBase: 0.5 }, scene: detectorFloor,
              expect: { key: 'detectedShare', value: 1 } },
            { label: 'integrating sphere, albedo 0.8', set: { tBase: 0.8 }, scene: SHELL,
              source: { type: 'point', pos: [0, 0, 0], axis: [0, 0, 1], distribution: 'uniform', halfAngle: 90 },
              expect: { key: 'arrivedShare', value: 5 } },
            { label: 'integrating sphere, albedo 0.5', set: { tBase: 0.5 }, scene: SHELL,
              source: { type: 'point', pos: [0, 0, 0], axis: [0, 0, 1], distribution: 'uniform', halfAngle: 90 },
              expect: { key: 'arrivedShare', value: 2 } },
        ],
    },
    {
        id: 'optics-farfield',
        kind: 'optics',
        title: 'Far field: does the intensity grid give a source\'s known curve?',
        verdict: opticsRule({ beam: 0.02, i0Ratio: 0.005 }),
        note: 'THE FAR FIELD (optics/farfield.js; the Optics page\'s Intensity tab) AGAINST CLOSED FORMS.'
            + ' A disc source 1 m over the floor shines UP, so nothing is in its way and every ray escapes'
            + ' into the far field (far = its share of the emitted flux, 1). A Lambertian source has'
            + ' I(0) = flux / pi (I0 ratio = I0 fitted as I0 cos(gamma) over 0-20 degrees, over that: 1) and a beam angle of 120 degrees (where I'
            + ' falls to half); cos^5 has 2 acos(0.5^(1/5)) = 58.95; a uniform 30-degree cone is flat'
            + ' to its edge, so 60. The beam angle is taken at half of I max, and I max is the grid\'s'
            + ' largest bin: its noise (about 1.6 % here, on a 5-degree grid pooled round the axis) moves'
            + ' the 120 by about a degree, so ratio within 0.01-0.02 is the pass. The last row feeds the'
            + ' grid from a DETECTOR instead -- the floor, with the source shining down onto it, the grid\'s'
            + ' axis down -- so the arriving directions must give the same I0. ratio = measured / expected.',
        /* A COARSE GRID, POOLED ROUND THE AXIS: I max is the largest bin, and the largest of many noisy
           bins reads high -- at 1 x 5 degrees the bins by the axis hold a handful of rays each, and the
           beam angle (half of I max) would inherit that bias. 5-degree rings, rotational symmetry, 2
           million rays: the cap holds ~4000 rays, I max ~1.6 % noise. */
        rays: 250000, batches: 8, farSymmetry: 'rotational',
        optics: { maxDist: 0, far: { mode: 'escaped', nC: 24, nG: 37, axis: [0, 0, 1], c0: [1, 0, 0] } },
        scene: floorScene('m'),
        pin: { envUniform: 0, sunIlluminance: 0, skyIlluminance: 0, ...LAMBERT, tBase: 0.5 },
        source: { type: 'disc', pos: [0, 0, 1], axis: [0, 0, 1], u: [1, 0, 0], size: [0.1, 0.1],
                  distribution: 'cosine', halfAngle: 90, n: 1, flux: 1000, unit: 'lm' },
        cases: [
            { label: 'Lambertian: everything reaches the far field', expect: { key: 'farShare', value: 1 } },
            { label: 'Lambertian: I(0) = flux / pi', expect: { key: 'i0Ratio', value: 1 } },
            { label: 'Lambertian: beam angle 120 deg', expect: { key: 'beam', value: 120 } },
            { label: 'cos^5: beam angle', source: { n: 5 }, expect: { key: 'beam', value: 58.9546 } },
            { label: 'uniform 30-deg cone: beam angle 60 deg', source: { distribution: 'uniform', halfAngle: 30 },
              expect: { key: 'beam', value: 60 } },
            { label: 'fed by a DETECTOR (the floor, lit from above): I(0) = flux / pi', scene: detectorFloor,
              source: { axis: [0, 0, -1] }, optics: { far: { mode: 'detector', material: 1, axis: [0, 0, -1] } },
              expect: { key: 'i0Ratio', value: 1 } },
        ],
    },
    {
        id: 'optics-refraction',
        kind: 'optics',
        title: 'Optics trace: Snell, Fresnel and total internal reflection against the textbook',
        verdict: opticsRule(),
        note: 'REFRACTION IN THE OPTICS TRACE, which optics-balance never exercises (every surface there'
            + ' is opaque). Glass n 1.5, smooth, clear; the black floor under it is a DETECTOR, so'
            + ' "detected" is what the glass let through. SLAB at 0, 45 and 70 degrees: T = (1 - R) /'
            + ' (1 + R), every internal reflection summed -- 0.9231, 0.9043, 0.7079 -- with R the'
            + ' unpolarised Fresnel at each face, which is what the shader does (ratio 1 = the code does'
            + ' what it claims). "vs polar." divides by the PHYSICAL answer, s and p carried through the'
            + ' slab separately (0.9231, 0.9073, 0.7287): the size of the unpolarised model\'s own error,'
            + ' 0 head-on and -3% at 70 degrees. INSIDE THE GLASS: a source in the slab (emitting into'
            + ' n 1.5) aimed 40 degrees off the normal, under the critical 41.81, escapes upwards'
            + ' 1 / (1 + R) = 0.8030 of it and down to the floor the rest; at 44 degrees it is TOTALLY'
            + ' REFLECTED at both faces forever -- nothing escapes, nothing is detected, all of it lost'
            + ' to the bounce cap (any escape there is a TIR bug). GLASS BALL: a point source at the'
            + ' centre of a solid glass sphere meets the surface head-on every time, reflects R = 0.04'
            + ' back through the centre and tries again: interactions per ray 1 / (1 - R) = 1.0417,'
            + ' and every ray escapes. A source that thought it was in air would read 1. WEDGE: a beam'
            + ' straight down through a 20-degree prism leaves at -10.26 degrees from vertical (Snell'
            + ' at both faces); "exit deg" is the median over the floor\'s hits, so the few rays that'
            + ' bounced inside do not move it. TWO SLABS with an air gap: T = T1^2 / (1 - R1^2) ='
            + ' 0.8571. With a 50 mm gap it must pass. With a 0.5 mm gap and the automatic tolerance'
            + ' (surface offset 2 mm in this 2 m scene) it is EXPECTED TO FAIL, reading one slab\'s'
            + ' 0.9231: a gap thinner than the offset is jumped, and the index beyond a surface is'
            + ' probed twice the offset away -- inside the second slab. That row is the known limit,'
            + ' measured; the next row sets the trace\'s eps to 10 um (offset 0.1 mm) and must pass.',
        rays: 100000, batches: 4,
        optics: { maxDist: 0 },
        scene: testScene('m', 'slab'),
        pin: { envUniform: 0, sunIlluminance: 0, skyIlluminance: 0,
               tBase: 1, tMetal: 0, tRough: 0, tSpec: 0.5, tTrans: 1, tIor: 1.5, tAniso: 0, tGrain: 0,
               tSlabZ: 0.5, tSlabT: 0.1, tGap: 0, tWedge: 20 },
        source: { type: 'disc', pos: [0, 0, 1], axis: [0, 0, -1], u: [0, 1, 0], size: [0.3, 0.3],
                  distribution: 'collimated', halfAngle: 90, n: 1, flux: 1000, emitN: 1, unit: 'lm' },
        extra: {
            columns: [['vs polar.', r => r.physical ? r.detectedShare / r.physical : null, 4],
                      ['exit deg', r => r.exitDeg, 3]],
            read: async (O, c) => {
                const out = { physical: c.physical ?? null, exitDeg: null }
                if (c.readExit) {
                    const h = await O.readHits()
                    const a = (h?.hits || []).map(x => Math.atan2(x.dir[0], -x.dir[2]) * 180 / Math.PI).sort((p, q) => p - q)
                    out.exitDeg = a.length ? a[a.length >> 1] : null
                    if (c.expect?.key === 'exitDeg') out.measured = out.exitDeg
                }
                return out
            },
        },
        cases: [
            ...[0, 45, 70].map(t => {
                const a = t * Math.PI / 180, T = slabT(t, 1.5)
                return { label: `slab, ${t} deg`, set: {}, physical: T.polarised,
                         source: { axis: [Math.sin(a), 0, -Math.cos(a)] },
                         expect: { key: 'detectedShare', value: T.model } }
            }),
            ...[40, 44].map(t => {
                const a = t * Math.PI / 180, R = fresnel(Math.cos(a), 1.5).unpolarised
                return { label: t < 42 ? `inside the slab, ${t} deg: escapes up` : `inside the slab, ${t} deg: TIR, all lost`,
                         set: {},
                         source: { type: 'point', pos: [0, 0, 0.5], axis: [Math.sin(a), 0, Math.cos(a)], size: [0, 0], emitN: 1.5 },
                         expect: R < 1 ? { key: 'escapedShare', value: 1 / (1 + R) } : { key: 'lostShare', value: 1 } }
            }),
            { label: 'glass ball, source at its centre', set: {}, scene: testScene('m', 'sphere'),
              source: { type: 'point', pos: [0, 0, 0], axis: [0, 0, 1], size: [0, 0], distribution: 'uniform', emitN: 1.5 },
              expect: { key: 'perRay', value: 1 / (1 - fresnel(1, 1 / 1.5).unpolarised) } },
            { label: 'wedge 20 deg: exit angle', set: {}, scene: testScene('m', 'wedge'), readExit: true,
              expect: { key: 'exitDeg', value: wedgeExitDeg(20, 1.5) } },
            { label: 'two slabs, 50 mm gap', set: { tGap: 0.05, tSlabT: 0.05 },
              expect: { key: 'detectedShare', value: twoSlabT(0, 1.5) } },
            { label: 'two slabs, 0.5 mm gap, auto eps (LIMIT: expected to fail)', set: { tGap: 0.0005, tSlabT: 0.05 },
              // the known limit: it must MISS -- by over 3% (one slab's 0.923 against 0.857)
              expect: { key: 'detectedShare', value: twoSlabT(0, 1.5) }, mustFail: 0.03 },
            { label: 'two slabs, 0.5 mm gap, eps 10 um', set: { tGap: 0.0005, tSlabT: 0.05 }, optics: { eps: 1e-5 },
              expect: { key: 'detectedShare', value: twoSlabT(0, 1.5) } },
        ],
    },
    {
        id: 'optics-absorption',
        kind: 'optics',
        title: 'Optics trace: does glass absorb with its thickness (Beer-Lambert)?',
        verdict: opticsRule(),
        note: 'ABSORPTION INSIDE A MATERIAL (0.37.0; core/materials.js attenuationDistance, the builder\'s "colour'
            + ' depth"). The slab of optics-refraction, glass n 1.5, smooth, colour 0.5 grey, over the black detector'
            + ' floor; "detected" is what it let through. With a colour depth d the light inside keeps 0.5^(L/d) over'
            + ' a path L, and every internal reflection is absorbed again: T = (1 - R)^2 t / (1 - R^2 t^2), t one'
            + ' pass (optics/fresnel.js absorbingSlabT). 200 mm thick with d 200 mm: t = 0.5, T 0.4610; 400 mm'
            + ' thick: t = 0.25, T 0.2304 -- the THICKNESS now matters; at 45 degrees the path inside is longer.'
            + ' The same slab in an MM SCENE (every length x 1000, the depth too) must read the same: the depth is a'
            + ' length the scene boundary converts. The last two rows are the OLD RULE, which a depth of 0 still is:'
            + ' the colour multiplies at each crossing, (1 - R)^2 0.25 / (1 - R^2) = 0.2308 at 200 and at 400 mm alike'
            + ' (fresnel.js tintedSlabT). balance must read 0 on every row: what the glass absorbs inside is its own'
            + ' tally (optics/kernels.js O_VOL, in "absorbed"), or the flux would go missing between its faces.'
            + ' ratio = measured / expected, 1 within a few 1e-3.',
        rays: 100000, batches: 4,
        optics: { maxDist: 0 },
        scene: testScene('m', 'slab'),
        pin: { envUniform: 0, sunIlluminance: 0, skyIlluminance: 0,
               tBase: 0.5, tMetal: 0, tRough: 0, tSpec: 0.5, tTrans: 1, tIor: 1.5, tAniso: 0, tGrain: 0,
               tSlabZ: 0.5, tSlabT: 0.1, tGap: 0, tWedge: 20, tDepth: 0.2 },
        source: { type: 'disc', pos: [0, 0, 1], axis: [0, 0, -1], u: [0, 1, 0], size: [0.3, 0.3],
                  distribution: 'collimated', halfAngle: 90, n: 1, flux: 1000, emitN: 1, unit: 'lm' },
        cases: [
            { label: '200 mm thick, colour depth 200 mm', set: {},
              expect: { key: 'detectedShare', value: absorbingSlabT(0, 1.5, 0.2, 0.5, 0.2) } },
            { label: '400 mm thick, colour depth 200 mm', set: { tSlabT: 0.2 },
              expect: { key: 'detectedShare', value: absorbingSlabT(0, 1.5, 0.4, 0.5, 0.2) } },
            { label: '200 mm thick, 45 deg', set: {}, source: { axis: [Math.SQRT1_2, 0, -Math.SQRT1_2] },
              expect: { key: 'detectedShare', value: absorbingSlabT(45, 1.5, 0.2, 0.5, 0.2) } },
            { label: '400 mm thick, MM SCENE', scene: testScene('mm', 'slab'), set: { tSlabZ: 500, tSlabT: 200, tDepth: 200 },
              source: { pos: [0, 0, 1000], size: [300, 300] },
              expect: { key: 'detectedShare', value: absorbingSlabT(0, 1.5, 0.4, 0.5, 0.2) } },
            { label: 'depth 0 (the old rule), 200 mm thick', set: { tDepth: 0 },
              expect: { key: 'detectedShare', value: tintedSlabT(0, 1.5, 0.5) } },
            { label: 'depth 0 (the old rule), 400 mm thick', set: { tDepth: 0, tSlabT: 0.2 },
              expect: { key: 'detectedShare', value: tintedSlabT(0, 1.5, 0.5) } },
        ],
    },
    {
        id: 'optics-coating',
        kind: 'optics',
        title: 'Optics trace: does a coating reflect and pass what it says (beam splitter, AR, dichroic)?',
        verdict: opticsRule(),
        note: 'A COATING (0.39.0; core/materials.js coat, core/spectral.js). The clear slab of optics-refraction (n 1.5,'
            + ' smooth, white) over the black detector floor; "detected" is what it let through. A coating replaces the'
            + ' Fresnel of the faces light ENTERS by; the faces it LEAVES by are AR (nothing reflects), bare (the glass\'s'
            + ' Fresnel) or the coating again. The incoherent series per channel (optics/fresnel.js coatedSlabT):'
            + ' T = (1 - R) with an AR back, (1 - R)/(1 + F) bare, (1 - R)/(1 + R) every face. A 50/50 beam splitter'
            + ' with an AR back must pass exactly 0.5 at 0 and 45 degrees (it has no edge); bare back 0.4808; every'
            + ' face 1/3; R 0 on every face (a perfect AR) passes 1. THE DICHROIC reflects above 600 nm (R 0 to 1, a'
            + ' 20 nm edge): each channel reflects R averaged over its wavelengths (spectral.js edgeRGB), so white'
            + ' light passes sum(luma x (1 - R_c)) and turns cyan -- "du\'v\'" is the detected colour against that,'
            + ' 0 up to noise. At 45 degrees the edge moves to 600 x sqrt(1 - (sin 45 / 1.8)^2) = 551.8 nm and more'
            + ' of green reflects. A RED light through the same dichroic passes 1 - R_red: a coloured ray picks'
            + ' reflection by what it carries, so its rays are not split into heavy and empty ones. Every face'
            + ' coated, the series runs per channel. ratio = measured / expected, 1 within a few 1e-3; balance 0.',
        rays: 100000, batches: 4,
        optics: { maxDist: 0 },
        scene: testScene('m', 'slab'),
        pin: { envUniform: 0, sunIlluminance: 0, skyIlluminance: 0,
               tBase: 1, tMetal: 0, tRough: 0, tSpec: 0.5, tTrans: 1, tIor: 1.5, tAniso: 0, tGrain: 0,
               tSlabZ: 0.5, tSlabT: 0.1, tGap: 0, tWedge: 20, tDepth: 0,
               tCoat: 1, tCoatLo: 0.5, tCoatHi: 0.5, tCoatEdge: 600, tCoatW: 20, tCoatN: 1.8 },
        source: { type: 'disc', pos: [0, 0, 1], axis: [0, 0, -1], u: [0, 1, 0], size: [0.3, 0.3],
                  distribution: 'collimated', halfAngle: 90, n: 1, flux: 1000, emitN: 1, unit: 'lm' },
        extra: {
            columns: [['x', r => r.cx, 4], ['y', r => r.cy, 4], ["du'v'", r => r.dupvp, 5]],
            read: async (O, c) => {
                if (!c.target) return {}
                const h = await O.readHits()
                const sum = [0, 0, 0]
                for (const x of h?.hits || []) for (let k = 0; k < 3; k++) sum[k] += x.xyz[k]
                const xy = XYZtoxy(sum)
                if (!xy) return {}
                const [u, v] = xyToUpVp(xy[0], xy[1]), [tu, tv] = xyToUpVp(...c.target)
                return { cx: xy[0], cy: xy[1], dupvp: Math.hypot(u - tu, v - tv) }
            },
        },
        cases: (() => {
            /* WHAT A LIGHT OF COLOUR rgb LETS THROUGH, per channel T_c, as a share of its luminous flux, and the colour
               that comes out (xy) -- the tallies weigh a ray by its luminance (optics/kernels.js optWeight) */
            const through = (rgb, T) => {
                const out = rgb.map((c, i) => c * T[i])
                const lum = v => v.reduce((a, c, i) => a + LUMA[i] * c, 0)
                return { share: lum(out) / lum(rgb), xy: XYZtoxy(rgbToXYZ(out)) }
            }
            const at = deg => ({ source: { axis: [Math.sin(deg * Math.PI / 180), 0, -Math.cos(deg * Math.PI / 180)] } })
            const split = (label, deg, coat, back, R) => ({ label, set: { tCoat: coat, tCoatLo: R, tCoatHi: R }, ...at(deg),
                expect: { key: 'detectedShare', value: coatedSlabT(deg, 1.5, R, back) } })
            const dichroic = (label, deg, coat, back, rgb = [1, 1, 1]) => {
                const R = edgeRGB(0, 1, edgeAt(600, Math.sin(deg * Math.PI / 180), 1.8), 20)
                const t = through(rgb, R.map(r => coatedSlabT(deg, 1.5, r, back)))
                return { label, set: { tCoat: coat, tCoatLo: 0, tCoatHi: 1 }, ...at(deg),
                         ...(rgb.join() === '1,1,1' ? {} : { source: { ...at(deg).source, colour: rgb } }),
                         expect: { key: 'detectedShare', value: t.share }, target: t.xy }
            }
            return [
                { label: 'no coating (the bare slab, as optics-refraction)', set: { tCoat: 0 },
                  expect: { key: 'detectedShare', value: slabT(0, 1.5).model } },
                split('beam splitter 50/50, AR back, 0 deg', 0, 1, 'ar', 0.5),
                split('beam splitter 50/50, AR back, 45 deg', 45, 1, 'ar', 0.5),
                split('beam splitter 50/50, bare back, 0 deg', 0, 2, 'bare', 0.5),
                split('beam splitter 50/50, every face, 0 deg', 0, 3, 'coated', 0.5),
                split('anti-reflective (R 0), 45 deg', 45, 1, 'ar', 0),
                dichroic('dichroic, reflects > 600 nm, AR back, white, 0 deg', 0, 1, 'ar'),
                dichroic('dichroic, reflects > 600 nm, AR back, white, 45 deg', 45, 1, 'ar'),
                dichroic('dichroic, every face, white, 0 deg', 0, 3, 'coated'),
                dichroic('dichroic, AR back, a RED light, 0 deg', 0, 1, 'ar', [1, 0, 0]),
            ]
        })(),
    },
    {
        id: 'optics-dispersion',
        kind: 'optics',
        title: 'Optics trace: does a dispersive wedge spread white light by wavelength as Snell and Cauchy say?',
        verdict: opticsRule({ measured: 2e-4 }),
        note: 'DISPERSION (0.40.0; core/spectral.js). A collimated white beam straight down through a 30 degree glass'
            + ' wedge, n_d 1.75, onto the detector floor; it leaves bent by Snell twice (optics/fresnel.js wedgeExitDeg).'
            + ' With an Abbe number each ray refracted into the glass is given a wavelength, refracts at n(lambda) --'
            + ' Cauchy through n_d and V_d (spectral.js cauchyN) -- and carries that wavelength\'s weight in each'
            + ' channel, so the beam fans out: blue bent most, red least. Each row reads one channel\'s mean exit'
            + ' angle over the detector hits (their colour turned back into Rec.709 RGB, hits within a window of the'
            + ' fan only: the rare twice-reflected ray leaves elsewhere) against the same mean computed from the'
            + ' channels\' wavelength weights (spectral.js SPEC_WEIGHTS) and Snell at each wavelength. Abbe 0 is the'
            + ' control: every channel at the one angle. Abbe 28 (a dense flint): red -23.89, green -24.18, blue'
            + ' -24.86 degrees. ratio = measured / expected, 1 within a few 1e-4 -- these are angles, and the noise is tiny.',
        rays: 100000, batches: 4,
        optics: { maxDist: 0 },
        scene: testScene('m', 'wedge'),
        pin: { envUniform: 0, sunIlluminance: 0, skyIlluminance: 0,
               tBase: 1, tMetal: 0, tRough: 0, tSpec: 0.5, tTrans: 1, tIor: 1.75, tAniso: 0, tGrain: 0,
               tSlabZ: 0.5, tSlabT: 0.1, tGap: 0, tWedge: 30, tDepth: 0, tCoat: 0, tAbbe: 28 },
        source: { type: 'disc', pos: [0, 0, 1], axis: [0, 0, -1], u: [0, 1, 0], size: [0.1, 0.1],
                  distribution: 'collimated', halfAngle: 90, n: 1, flux: 1000, emitN: 1, unit: 'lm' },
        extra: {
            columns: [['red deg', r => r.angR, 4], ['green deg', r => r.angG, 4], ['blue deg', r => r.angB, 4],
                      ['hits used', r => r.used, 0]],
            read: async (O, c) => {
                const h = await O.readHits()
                const [lo, hi] = c.window
                const sum = [0, 0, 0], wsum = [0, 0, 0]
                let used = 0
                for (const x of h?.hits || []) {
                    const a = Math.atan2(x.dir[0], -x.dir[2]) * 180 / Math.PI
                    if (!(a >= lo && a <= hi)) continue
                    used++
                    XYZtoRGB(x.xyz).forEach((v, k) => { sum[k] += v * a; wsum[k] += v })
                }
                const ang = sum.map((s, k) => wsum[k] > 0 ? s / wsum[k] : null)
                return { angR: ang[0], angG: ang[1], angB: ang[2], used, measured: ang[c.channel] }
            },
        },
        cases: (() => {
            const W = 30, ND = 1.75, V = 28
            /* A CHANNEL'S MEAN EXIT ANGLE: each wavelength's angle (Snell twice at n(lambda)) weighed by what it is to the
               channel (the bins' weights, uniform within a bin) and by what the bottom face lets out at it (its Fresnel
               at n(lambda); the top face's is the d line's, the same for all) -- 20 wavelengths a bin */
            const exitAt = n => {
                const a = W * Math.PI / 180
                const inside = Math.asin(Math.sin(a) / n) - a              // the ray's angle from straight down, inside
                return { deg: wedgeExitDeg(W, n), F: fresnel(Math.cos(inside), n).unpolarised }
            }
            const mean = (c, v) => {
                let s = 0, w = 0
                for (let k = 0; k < SPEC_BINS; k++) for (let j = 0; j < 20; j++) {
                    const e = exitAt(cauchyN(ND, v, SPEC_LO + (k + (j + 0.5) / 20) * SPEC_STEP))
                    const wt = SPEC_WEIGHTS[k][c] * (1 - e.F)
                    s += wt * e.deg; w += wt
                }
                return s / w
            }
            const all = [0, 1, 2].map(c => mean(c, V)), span = [Math.min(...all), Math.max(...all)]
            const ends = [exitAt(cauchyN(ND, V, 380)).deg, exitAt(cauchyN(ND, V, 780)).deg]
            const window = [Math.min(...ends) - 2, Math.max(...ends) + 2]
            return [
                { label: 'Abbe 0 (the control): every channel at the one angle', set: { tAbbe: 0 }, channel: 1,
                  window: [exitAt(ND).deg - 2, exitAt(ND).deg + 2], expect: { key: 'measured', value: exitAt(ND).deg } },
                ...['red', 'green', 'blue'].map((name, c) => ({ label: `Abbe ${V}: the ${name} channel's mean exit angle`, set: {},
                    channel: c, window, expect: { key: 'measured', value: mean(c, V) } })),
            ].map(r => ({ ...r, spread: span }))
        })(),
    },
    {
        id: 'optics-colour',
        kind: 'optics',
        title: 'Optics trace: does a detector read the colour the lights were given?',
        verdict: opticsRule({ dupvp: c => c?.label.includes('mix') ? 2e-3 : 1e-3 }),
        note: 'COLOUR, EXACT (core/colorimetry.js). A light is given as a chromaticity -- CCT + Duv or CIE'
            + ' xy, as a datasheet gives an LED -- and a flux; the trace carries it and a detector'
            + ' turns what it caught back into XYZ. With neutral optics that is exact, so every row must'
            + ' read its target: "du\'v\'" is the distance in CIE 1976 u\'v\' from it, 0 up to noise'
            + ' (about 1e-3 is invisible; 0.0035 is a one-step MacAdam ellipse, roughly). A 3000 K light'
            + ' onto the detector floor; a 6500 K Duv +0.005 one through the clear glass slab (Fresnel'
            + ' losses change the flux, never the colour); a ROYAL BLUE LED, xy (0.15, 0.025), far'
            + ' outside the Rec.709 gamut -- its exact RGB has a negative channel, which must survive'
            + ' the GPU path; and THREE LEDS (red 0.69/0.30, green 0.205/0.70, royal blue) whose fluxes are'
            + ' solved to MIX to 4000 K on the locus at 1000 lm total (colorimetry mixToTarget, the'
            + ' user\'s own luminaire tool\'s matrix): the mix must read 4000 K, Duv 0 -- directly and'
            + ' through the glass. The mix rows are the noisiest: each ray picks ONE of the three by'
            + ' flux, so the colour carries the counting noise of that pick (the blue is 1.6% of the rays) --'
            + ' so they trace 250 000 rays a batch, not 100 000. At 100 000 that noise alone went past their'
            + ' 0.002 in 7 runs of 40 on Dawn (median 1.2e-3; the user\'s 0.78.0 runs read 0.0005-0.0021);'
            + ' at 250 000, none of 40 (median 6.1e-4, the largest 1.7e-3), and about 1 % a row by the pick\'s'
            + ' arithmetic (2026-10-26). 500 000 would want a buffer past 128 MiB. Read from the last batch\'s'
            + ' detector hits, which the hits\' room (262 144) holds whole.',
        rays: 100000, batches: 4,
        optics: { maxDist: 0 },
        scene: detectorFloor,
        pin: { envUniform: 0, sunIlluminance: 0, skyIlluminance: 0,
               tBase: 1, tMetal: 0, tRough: 0, tSpec: 0.5, tTrans: 1, tIor: 1.5, tAniso: 0, tGrain: 0,
               tSlabZ: 0.5, tSlabT: 0.1, tGap: 0, tWedge: 20 },
        source: { type: 'disc', pos: [0, 0, 1], axis: [0, 0, -1], u: [0, 1, 0], size: [0.3, 0.3],
                  distribution: 'collimated', halfAngle: 90, n: 1, flux: 1000, emitN: 1, unit: 'lm' },
        extra: {
            columns: [['x', r => r.cx, 4], ['y', r => r.cy, 4], ['CCT', r => r.cct, 0], ['Duv', r => r.duv, 4],
                      ["du'v'", r => r.dupvp, 5]],
            read: async (O, c) => {
                const h = await O.readHits()
                const sum = [0, 0, 0]
                for (const x of h?.hits || []) for (let k = 0; k < 3; k++) sum[k] += x.xyz[k]
                const xy = XYZtoxy(sum)
                if (!xy) return {}
                const t = xyToCctDuv(xy[0], xy[1]), [u, v] = xyToUpVp(xy[0], xy[1]), [tu, tv] = xyToUpVp(...c.target)
                return { cx: xy[0], cy: xy[1], cct: t.inRange ? t.cct : null, duv: t.inRange ? t.duv : null,
                         dupvp: Math.hypot(u - tu, v - tv) }
            },
        },
        cases: (() => {
            const lit = xy => ({ colour: rgbFromXy(...xy) })
            const w3000 = cctDuvToXy(3000, 0), w6500 = cctDuvToXy(6500, 0.005), blue = [0.15, 0.025]
            const P = [[0.69, 0.3], [0.205, 0.7], blue], T = planckXy(4000)
            const { flux } = mixToTarget(P, T, 1000)
            const mix = P.map((xy, i) => ({ ...lit(xy), flux: flux[i] }))
            return [
                { label: '3000 K onto the detector', set: {}, source: lit(w3000), target: w3000 },
                { label: '6500 K Duv +0.005 through glass', set: {}, scene: testScene('m', 'slab'), source: lit(w6500), target: w6500 },
                { label: 'royal blue (out of gamut)', set: {}, source: lit(blue), target: blue },
                { label: `R+G+B mixed to 4000 K (${flux.map(f => f.toFixed(1)).join(' / ')} lm)`, set: {}, sources: mix, target: T, rays: 250000 },
                { label: 'the same mix through glass', set: {}, scene: testScene('m', 'slab'), sources: mix, target: T, rays: 250000 },
            ]
        })(),
    },
    {
        id: 'furnace',
        kind: 'image',
        title: 'White furnace: is an albedo-1 material invisible in a uniform world?',
        verdict: r => {
            const ratio = r.meanLuma / FURNACE_L
            if (r.case.startsWith('CONTROL')) return V.below(ratio, 0.5, 'ratio (the control)')
            // rough glass's transmission is single-scatter: under 1 by what masking loses, and never over
            if (r.case.includes('glass, rough')) return V.between(ratio, 0.9, 1, 'ratio, single-scatter rough glass')
            return vsAnswer(ratio, r, 0.002)
        },
        note: 'THE ENERGY CHECK FOR EVERY MATERIAL. The environment is one luminance everywhere'
            + ' (envUniform, sun off), and every row is a unit sphere of an albedo-1 material --'
            + ' white Lambertian, white plastic, white metal, clear glass. Light can neither be made'
            + ' nor lost on the way to the eye, so the picture must equal the environment: ratio 1.000.'
            + ' The background reads exactly 1, so a loss ON the sphere shows at about 3/4 of its'
            + ' size in the mean. WHAT A MISS MEANS: plastic below 1 = the coat/base coupling (the'
            + ' albedo tables, microfacet.js); rough metal below 1 = the Turquin compensation; glass'
            + ' below 1 = Fresnel or refraction losing light (at maxbounce 40 and maxiter 400 the truncation is'
            + ' negligible -- but for the dichroic on every face, which traps light and runs at maxbounce 100 and'
            + ' maxiter 6000: see its rows); anything ABOVE 1 is energy created, a bug wherever it is. ROUGH GLASS is'
            + ' the one expected shortfall: its transmission is single-scatter, and a rough'
            + ' interface loses some light to masking that nothing gives back yet. NEE-off rows'
            + ' must equal their NEE-on partners: that is sampling and evaluation agreeing.'
            + ' THE LAST ROW IS A CONTROL that must read well below 1: if it reads 1.000 the sphere'
            + ' was never drawn and every row is void.',
        delta: 'meanLuma',
        samples: 32,
        scene: testScene('m', 'sphere'),
        camera: FURNACE_CAMERA,
        pin: { maxaverages: 0, maxiter: 400, maxbounce: 40, rr: 0, nee: 1, lt: 0, fireflyClamp: 0,
               envUniform: FURNACE_L, tBase: 1, tRough: 0.5, tIor: 1.5, tCoat: 0, tAbbe: 0, ...LAMBERT },
        extra: {
            columns: [['ratio', r => r.meanLuma / FURNACE_L, 4]],
            read: async () => ({}),
        },
        cases: [
            { label: 'Lambertian', set: {} },
            { label: 'Lambertian, NEE off', set: { nee: 0 } },
            { label: 'plastic, rough 0.5', set: { tSpec: 0.5 } },
            { label: 'plastic, rough 0.5, NEE off', set: { tSpec: 0.5, nee: 0 } },
            { label: 'plastic, rough 1.0', set: { tSpec: 0.5, tRough: 1 } },
            { label: 'plastic, smooth', set: { tSpec: 0.5, tRough: 0 } },
            { label: 'plastic, ior 2.4, rough 0.2', set: { tSpec: 0.5, tIor: 2.4, tRough: 0.2 } },
            { label: 'metal, rough 0.5', set: { tMetal: 1 } },
            { label: 'metal, rough 1.0', set: { tMetal: 1, tRough: 1 } },
            { label: 'metal, rough 1.0, NEE off', set: { tMetal: 1, tRough: 1, nee: 0 } },
            // low roughness: the tables' 32 x 32 grid used to overstate the albedo here (microfacet.js)
            { label: 'metal, rough 0.3', set: { tMetal: 1, tRough: 0.3 } },
            { label: 'metal, rough 0.15', set: { tMetal: 1, tRough: 0.15 } },
            { label: 'metal, mirror', set: { tMetal: 1, tRough: 0 } },
            { label: 'glass, smooth, ior 1.5', set: { tTrans: 1, tRough: 0 } },
            { label: 'glass, smooth, ior 2.4', set: { tTrans: 1, tRough: 0, tIor: 2.4 } },
            { label: 'glass, rough 0.3 (single-scatter: a little under 1)', set: { tTrans: 1, tRough: 0.3 } },
            /* ANISOTROPIC (SURFACES.md phases 1 and 1b): circles about z, so the frame turns over the
               sphere and meets the poles, where grainAround gives zero and the old frame takes over.
               These read 0.988 while the energy tables were isotropic; with the anisotropic tables
               they must read 1 like the rest. The metal is Turquin's compensation (E1), the plastic
               the coat/base coupling (Ec and its mean over every direction), negative anisotropy the
               other axis rough (the azimuth measured from y), 0.95 the steep end of the u axis. */
            { label: 'metal, rough 0.5, anisotropic 0.8, turned', set: { tMetal: 1, tAniso: 0.8, tGrain: 2 } },
            { label: 'metal, rough 0.5, anisotropic 0.8, turned, NEE off', set: { tMetal: 1, tAniso: 0.8, tGrain: 2, nee: 0 } },
            { label: 'metal, rough 0.5, anisotropic -0.8, turned', set: { tMetal: 1, tAniso: -0.8, tGrain: 2 } },
            { label: 'metal, rough 0.7, anisotropic 0.95, brushed', set: { tMetal: 1, tRough: 0.7, tAniso: 0.95, tGrain: 1 } },
            { label: 'metal, rough 0.3, anisotropic 0.5, no grain', set: { tMetal: 1, tRough: 0.3, tAniso: 0.5 } },
            { label: 'plastic, rough 0.5, anisotropic 0.8, turned', set: { tSpec: 0.5, tAniso: 0.8, tGrain: 2 } },
            { label: 'plastic, rough 0.5, anisotropic 0.8, turned, NEE off', set: { tSpec: 0.5, tAniso: 0.8, tGrain: 2, nee: 0 } },
            { label: 'plastic, ior 2.4, rough 0.3, anisotropic 0.9, brushed', set: { tSpec: 0.5, tIor: 2.4, tRough: 0.3, tAniso: 0.9, tGrain: 1 } },
            /* COATINGS (0.39.0; core/materials.js coat): a coating reflects R and passes 1 - R in every channel, so a coated
               white sphere must vanish too -- whatever its R per channel, however the pick splits a ray between them
               (materials_pbr.js coatPick), NEE on or off. A dichroic turns the reflected light red and the passed light
               cyan, and the two must add back to white. Smooth only: a rough coating's glossy lobe is not compensated for
               what single scattering loses (makeLobes, coatAlbedo), as a rough glass's transmission is not.
               A DICHROIC ON EVERY FACE TRAPS LIGHT: inside a sphere every hit is at the angle the light came in by, and
               where the coating reflects 0.99 of a channel there, what got in bounces a hundred times on average before it
               leaves. The furnace's caps cut those paths -- maxiter is the march's steps over the WHOLE path (wavefront.js),
               so 400 of them end a path after some dozens of chords (inferred, not counted) -- and that, not the coating, is what these two rows
               read 0.9971 / 0.9972 (0.77.0, Pascal) and 0.9976 / 0.9976 (0.78.0, Ampere) for. On Dawn over lavapipe
               (2026-10-26, the sphere's pixels): 0.9960 and 0.9970 at the pins (two runs), 0.9959 at maxbounce 200 with maxiter 400, 0.9988 at
               maxiter 4000, 0.9999 +- 0.0006 at maxbounce 100 with maxiter 6000 -- the caps these rows run at. (The
               renderer's own defaults cut the same light: a cap, as maxbounce has always been one.)
               THE BEAM SPLITTER's few 1e-4 under 1 is not a cap: a ray that enters within the surface tolerance of the
               rim meets the inside past the critical angle (the march stops a tolerance short of the surface, so the
               angle it reads is a little steeper than the true one) and is totally reflected at every hit after it. It
               moves with the tolerance: 0.99984, 0.99960 and 0.99793 on the sphere at eps x 0.1, x 1 and x 10 on Dawn. */
            { label: 'glass, smooth, beam splitter 50/50 on every face', set: { tTrans: 1, tRough: 0, tCoat: 3, tCoatLo: 0.5, tCoatHi: 0.5 } },
            { label: 'glass, smooth, dichroic (> 600 nm), AR inside', set: { tTrans: 1, tRough: 0, tCoat: 1, tCoatLo: 0, tCoatHi: 1, tCoatEdge: 600, tCoatW: 20 } },
            { label: 'glass, smooth, dichroic (> 600 nm), every face', set: { tTrans: 1, tRough: 0, tCoat: 3, tCoatLo: 0, tCoatHi: 1, tCoatEdge: 600, tCoatW: 20,
                                                                          maxbounce: 100, maxiter: 6000 } },
            { label: 'glass, smooth, dichroic (> 600 nm), every face, NEE off', set: { tTrans: 1, tRough: 0, tCoat: 3, tCoatLo: 0, tCoatHi: 1, tCoatEdge: 600, tCoatW: 20, nee: 0,
                                                                                   maxbounce: 100, maxiter: 6000 } },
            { label: 'plastic, smooth, dichroic coat (< 500 nm) over the white base', set: { tSpec: 0.5, tRough: 0, tCoat: 1, tCoatLo: 1, tCoatHi: 0, tCoatEdge: 500, tCoatW: 20 } },
            { label: 'plastic, smooth, dichroic coat (< 500 nm), NEE off', set: { tSpec: 0.5, tRough: 0, tCoat: 1, tCoatLo: 1, tCoatHi: 0, tCoatEdge: 500, tCoatW: 20, nee: 0 } },
            /* DISPERSION (0.40.0; core/spectral.js): a refraction into the sphere draws a wavelength and weighs the ray's
               channels by it -- 1 on average in each -- and every index after is n(lambda). The rainbow must average
               back to white: a dispersive white sphere vanishes like a clear one. */
            { label: 'glass, smooth, Abbe 20 (dispersive)', set: { tTrans: 1, tRough: 0, tAbbe: 20 } },
            { label: 'glass, smooth, Abbe 20, NEE off', set: { tTrans: 1, tRough: 0, tAbbe: 20, nee: 0 } },
            { label: 'glass, rough 0.3, Abbe 20 (single-scatter: as rough glass)', set: { tTrans: 1, tRough: 0.3, tAbbe: 20 } },
            /* THE CONTROL: a row that must FAIL. Every row above passes by reading the environment,
               and so does a picture with no sphere in it -- a shade kernel that did not build, a
               scene that did not load. That happened (2026-09-29: a page mixing cached old modules
               with new ones read 1000.000244 with zero noise on every row, rough glass included).
               A black sphere takes its own area out of the mean: about 3/4 of the frame's worth of
               sphere, so well below 1. If THIS reads 1.000, nothing above was measured. */
            { label: 'CONTROL: black sphere -- must read well below 1', set: { tBase: 0 } },
        ],
    },
    {
        id: 'haze',
        kind: 'image',
        title: 'Dust in the air: is an albedo-1 haze box invisible in a uniform world?',
        verdict: r => {
            const ratio = r.meanLuma / FURNACE_L
            if (r.case.includes('black sphere')) return V.below(ratio, 0.5, 'ratio (the control)')
            if (r.case.includes('albedo 0.5')) return V.below(ratio, 0.6, 'ratio (the control)')
            return vsAnswer(ratio, r, 0.002)
        },
        note: 'THE HAZE BOX\'S ENERGY CHECK (0.62.0; core/haze.js). The furnace\'s white sphere (Lambertian, albedo 1) inside'
            + ' a box of dust 3.2 m wide, mean free path 1.5 m, albedo 1: light scattered in the air, many times -- light'
            + ' sampled from the air (the sky as a uniform sphere) and the phase function\'s own draw, weighed by MIS -- can'
            + ' neither be made nor lost, so ratio 1.000 whatever g, and NEE off the same -- against the no-box row, whose own'
            + ' few 1e-4 under 1 are the furnace\'s (0.9998 on the user\'s card, 2026-10-16). The box hidden (its density 0, the'
            + ' same kernels) and no box at all read 1 too; secs against them says what the haze costs: its code alone'
            + ' (hidden), and the collisions (the rows with dust; each is a bounce, so maxbounce 40). TWO CONTROLS, each must'
            + ' read well below 1: the black sphere without a box says the picture holds the furnace at all (1.000 there:'
            + ' nothing below was measured -- the first press, 0.62.0, looked at sky, its camera orbiting the view\'s own'
            + ' target); dust of albedo 0.5 says the dust does something. On Dawn over lavapipe (haze.gpu.mjs, its own furnace'
            + ' without a sphere, 2026-10-16): 0.997-1.002 at g 0.6, 0 and -0.5 -- this row is the card\'s compiler (Tint) on'
            + ' the same arithmetic. BASELINE (Pascal, 819x1031, 0.62.2, 2026-10-16): no box 0.99977, hidden +0.0002 %, NEE off'
            + ' +0.002 %, the dust +0.024 %, +0.015 %, -0.010 % at g 0.6, 0, -0.5; the controls 0.152 and 0.4315. (0.62.1 read'
            + ' the dust 0.03-0.08 % under, NEE off too: paths lost, a collision put inside the sphere -- core/haze.js hazeDraw.)',
        delta: 'meanLuma',
        samples: 32,
        scene: hazeFurnace(0.6, 1),
        camera: FURNACE_CAMERA,
        pin: { maxaverages: 0, maxiter: 400, maxbounce: 40, rr: 0, nee: 1, lt: 0, fireflyClamp: 0,
               envUniform: FURNACE_L, tBase: 1, tRough: 0.5, tIor: 1.5, tCoat: 0, tAbbe: 0, ...LAMBERT },
        extra: {
            columns: [['ratio', r => r.meanLuma / FURNACE_L, 4]],
            read: async () => ({}),
        },
        cases: (() => {
            const g6 = hazeFurnace(0.6, 1), bare = testScene('m', 'sphere')
            return [
                { label: 'no haze box (the furnace\'s Lambertian row)', set: {}, scene: bare },
                /* the furnace's own control (above), so that a picture without the sphere in it cannot pass as a box that
                   changed nothing: the first press's camera looked at sky (FURNACE_CAMERA's target, 0.62.1) */
                { label: 'CONTROL: no box, a black sphere -- must read well below 1', set: { tBase: 0 }, scene: bare },
                { label: 'a haze box, hidden (density 0: the haze\'s code, no dust)', set: {}, scene: hazeFurnace(0.6, 1, false) },
                { label: 'dust, g 0.6', set: {}, scene: g6 },
                { label: 'dust, g 0.6, NEE off', set: { nee: 0 }, scene: g6 },
                { label: 'dust, g 0 (even)', set: {}, scene: hazeFurnace(0, 1) },
                { label: 'dust, g -0.5 (back)', set: {}, scene: hazeFurnace(-0.5, 1) },
                { label: 'CONTROL: dust of albedo 0.5 -- must read well below 1', set: {}, scene: hazeFurnace(0.6, 0.5) },
            ]
        })(),
    },
    {
        id: 'bsdf-parity',
        kind: 'image',
        title: 'Seen at an angle: do BSDF sampling, NEE and light tracing agree?',
        verdict: vsRow((rows, i) => rows[i & ~1], 0.005),
        note: 'THE TEST THE OLD SAMPLER WOULD HAVE FAILED, and the straight-down floor could not'
            + ' see. The camera looks at a floor 70 degrees off vertical, under sun and sky, and each'
            + ' material is rendered with NEE on and off. With NEE off every bit of light is found'
            + ' by BSDF sampling, with it on mostly by evaluation, so the pair agree only if the'
            + ' sampler draws from the density it divides by. The old visible-normal sampler was'
            + ' right only at normal view; this is where it went wrong. Compare each PAIR on meanLuma'
            + ' (NEE-off rows are noisier -- a few tenths of a percent is their scatter); the delta'
            + ' column against row 1 means nothing across materials.',
        delta: 'meanLuma',
        samples: 32,
        scene: floorScene('m'),
        camera: OBLIQUE_CAMERA,
        pin: { maxaverages: 0, maxiter: 400, maxbounce: 10, rr: 0, nee: 1, lt: 0, fireflyClamp: 0,
               envUniform: 0, uSunAzimuth: 45, uSunElevation: 45, uSkyTurbidity: 0.7,
               sunIlluminance: 100000, sunDiameter: 5, skyIlluminance: 15000,
               tBase: 0.8, tRough: 0.3, tIor: 1.5, ...LAMBERT },
        cases: [
            { label: 'Lambertian, NEE on', set: {} },
            { label: 'Lambertian, NEE off', set: { nee: 0 } },
            { label: 'plastic 0.3, NEE on', set: { tSpec: 0.5 } },
            { label: 'plastic 0.3, NEE off', set: { tSpec: 0.5, nee: 0 } },
            { label: 'metal 0.3, NEE on', set: { tMetal: 1 } },
            { label: 'metal 0.3, NEE off', set: { tMetal: 1, nee: 0 } },
            { label: 'metal 0.6, NEE on', set: { tMetal: 1, tRough: 0.6 } },
            { label: 'metal 0.6, NEE off', set: { tMetal: 1, tRough: 0.6, nee: 0 } },
            /* A GRAIN (SURFACES.md phase 1): the lobe frame now comes from the material, and every
               pair must still agree -- sampling, NEE and light tracing's evaluation all build it in
               makeLobes. Brushed along x, turned about the vertical axis (the grain changes over
               the floor), and a plastic, whose coat uses the same frame. */
            { label: 'metal 0.3 brushed, NEE on', set: { tMetal: 1, tAniso: 0.8, tGrain: 1 } },
            { label: 'metal 0.3 brushed, NEE off', set: { tMetal: 1, tAniso: 0.8, tGrain: 1, nee: 0 } },
            { label: 'metal 0.3 turned, NEE on', set: { tMetal: 1, tAniso: 0.8, tGrain: 2 } },
            { label: 'metal 0.3 turned, NEE off', set: { tMetal: 1, tAniso: 0.8, tGrain: 2, nee: 0 } },
            { label: 'plastic 0.3 brushed, NEE on', set: { tSpec: 0.5, tAniso: 0.8, tGrain: 1 } },
            { label: 'plastic 0.3 brushed, NEE off', set: { tSpec: 0.5, tAniso: 0.8, tGrain: 1, nee: 0 } },
        ],
    },
    {
        id: 'frame-cost',
        kind: 'cost',
        title: 'What does the f32 frame buffer cost?',
        note: 'The frame and splat buffers went from a u32 atomicAdd to an f32 compare-and-swap'
            + ' loop (DEPOSIT in wavefront.js), so physical luminances fit in them. That is the one'
            + ' change in the units step that could cost speed, and it cannot be measured in the'
            + ' container. There is no "before" arm to switch to -- compare BASELINE with the'
            + ' ms/sample this card read before the change (cost-sweep BASELINE in an older paste).'
            + ' FIRST RUN (Pascal, 1188x969): 70 ms with light tracing, 9 ms without -- 7.8x, where'
            + ' main\'s lt bench had read about 1.4x (secs 2.8 off / 3.8 learned). The suspect is'
            + ' CONTENTION: the learned map sends most connections into the few pixels of the'
            + ' caustic, and a compare-and-swap on one address serialises -- every lane after the'
            + ' first retries -- where the u32 atomicAdd it replaced was resolved in the memory'
            + ' system. But a connection is also a full shadow-ray march to the camera, so the rows'
            + ' below separate the two with settings that already exist: the UNIFORM map keeps the'
            + ' photons and drops connections ~70x (0.0087 per photon against ~0.6 learned); 0.1'
            + ' photons/px drops both 10x. Cheap uniform + expensive learned = the connections.'
            + ' Then the same scene and view on main, lt on and off, says how much of that is the'
            + ' CAS: main has the integer add and everything else the same.',
        secs: 5,
        pin: { maxiter: 400, maxbounce: 10, rr: 0, nee: 1, lt: 1, ltLearn: 1, ltPhotons: 1 },
        cases: [
            { label: 'BASELINE (learned map, 1 photon/px)', set: {} },
            { label: 'learned, 0.1 photons/px', set: { ltPhotons: 0.1 } },
            { label: 'NEE off', set: { nee: 0 } },
            // after the learned rows: ltLearn 0 resets the map to uniform
            { label: 'uniform map (few connections)', set: { ltLearn: 0 } },
            { label: 'light tracing off (no photons, no splats)', set: { lt: 0 } },
        ],
    },
    {
        id: 'render-modes-cost',
        kind: 'cost',
        title: 'What do the Quality presets cost on this scene?',
        note: 'THE PRESETS (quality.js) on the scene and view you have, ms per sample. Sketch traces to the first'
            + ' diffuse or glossy surface and stops, with no shadow rays and no photons; Draft adds one shadow'
            + ' ray there and keeps light tracing; High quality is full with 24 bounces and two photons a pixel;'
            + ' Optics is Sketch and the lights\' photons, which walk through gloss and glass to the first diffuse'
            + ' lobe (in a scene with no light it is Sketch). Then Draft without its seek rays, which says what finding lamps costs;'
            + ' and Draft without the photon map, then without the lights\' rays (0.74.0; the user: "little difference in'
            + ' performance between draft and standard"): Draft keeps both, and the same iterations a sample as Standard, so'
            + ' these two say how much of a Draft sample is the photons\' and not the camera\'s. Read the'
            + ' HUD\'s samples/s beside it: a cheaper sample is also more samples in each frame (render-loop.js).'
            + ' BASELINE: none yet -- built 2026-10-01.',
        secs: 5,
        /* THE PHOTON MAP ON, as the page has it since 0.61.0 (0.74.0): every bench row starts with it off (BENCH_BASE
           below), and these rows are to time the presets as the view traces them. Never run before this, so no
           reading of them moves. */
        pin: { sppm: 1 },
        cases: [
            { label: 'Standard (full)', set: presetValues('standard') },
            { label: 'High quality', set: presetValues('high') },
            { label: 'Draft', set: { ...presetValues('standard'), ...presetValues('draft') } },
            { label: 'Sketch', set: { ...presetValues('standard'), ...presetValues('sketch') } },
            { label: 'Optics (Sketch and the lights\' rays)', set: { ...presetValues('standard'), ...presetValues('optics') } },
            { label: 'Draft, seek rays off', set: { ...presetValues('standard'), ...presetValues('draft'), draftSeek: 0 } },
            { label: 'Draft, photon map off', set: { ...presetValues('standard'), ...presetValues('draft'), sppm: 0 } },
            { label: 'Draft, lights\' rays off', set: { ...presetValues('standard'), ...presetValues('draft'), lightRays: 0 } },
            /* MAX DIFFUSE BOUNCES (0.75.0): 0 is the direct light, through every lens, mirror and glass -- what Draft
               approximates, exactly -- and 2 a short room; the same iterations a sample (the budget reads maxbounce) */
            { label: 'Standard, 0 diffuse bounces', set: { ...presetValues('standard'), maxDiffuse: 0 } },
            { label: 'Standard, 2 diffuse bounces', set: { ...presetValues('standard'), maxDiffuse: 2 } },
        ],
    },
    {
        id: 'rr-bias',
        kind: 'image',
        title: 'Russian roulette bias',
        /* EACH RR-ON ROW AGAINST ITS RR-OFF ROW AT THE SAME CAP. It was every row against the first, so the maxbounce-40
           rows were judged against maxbounce 10 -- the light past the tenth bounce, which is no bias: on the user's
           scene of 2026-10-26 (0.78.0) RR off read 1.0050 at 40 against 10, the floor exactly. */
        verdict: vsRow((rows, i) => rows[i & ~1], 0.005),
        note: 'ANSWERED: unbiased, within 0.15% across all four arms on a Pascal card at 32'
            + ' samples. The 6-8% brightening that prompted this test was the adaptive budget'
            + ' confounding the comparison, not a bias. Kept as a regression check: each RR-on row'
            + ' against the RR-off row at its own maxbounce (1 v 2, 3 v 4). Between the caps the'
            + ' difference is the light past the tenth bounce, which depends on the scene -- 0.5 % on the'
            + ' user\'s of 2026-10-26.',
        samples: 32,
        /* PIN THE CONFOUNDERS HERE, not per case. The comparison that was supposed to rule out
           truncation was itself run with the ADAPTIVE BUDGET live -- so the two arms did not even
           get the same number of wavefront iterations, and RR (which ends paths early) pushes the
           budget down on its own. That one mistake is the reason this file exists; pinned here it
           cannot be made again. maxaverages 0 is the true mean, not the EMA window. */
        pin: { maxaverages: 0, maxiter: 400 },
        cases: [
            { label: 'RR off, maxbounce 10', set: { rr: 0, maxbounce: 10 } },
            { label: 'RR on,  maxbounce 10', set: { rr: 1, maxbounce: 10 } },
            { label: 'RR off, maxbounce 40', set: { rr: 0, maxbounce: 40 } },
            { label: 'RR on,  maxbounce 40', set: { rr: 1, maxbounce: 40 } },
        ],
    },
    {
        id: 'nee',
        kind: 'image',
        title: 'Next-event estimation: same picture, less noise?',
        verdict: vsRow((rows, i) => rows[i & ~1], 0.005),
        note: 'PASS = meanLuma unchanged and noise well down. Compared on meanLuma, not'
            + ' trimmedLuma, and that is the whole point: NEE moves energy OUT of the bright'
            + ' tail that trimming discards, so a trimmed mean reports the improvement as a'
            + ' bias. Expect trimmedLuma and median to diverge between the arms at a bright'
            + ' sun while meanLuma holds -- that divergence IS the effect, fireflies becoming'
            + ' smooth light. If meanLuma itself moves, the sun is counted twice or not at'
            + ' all: check sunmis.'
            + ' SCOPE: when this was written light sampling covered the ANALYTIC ENVIRONMENT ONLY --'
            + ' the solar disc and the sky -- and emissive geometry was found by BSDF sampling alone,'
            + ' so in a scene carrying its own light this test did not measure what its title says.'
            + ' The +76% on meanLuma at 20x sun was read in such a scene. Noise still fell 3.8x and it'
            + ' plainly looked better with sun and sky, so it shipped on; nee-split localises the rest.'
            + ' Since then NEE also aims at the emitters discovery finds (neeEmitShare) and, on the'
            + ' camera\'s own paths, at a light\'s face (PLAN.md L7) -- nee 0 switches all three off.'
            + ' READ THE PAIRS, and note that the delta column is against the FIRST row: rows'
            + ' 1v2 and 3v4 each vary nothing but nee and are the actual test. Comparing'
            + ' across the pairs only says how much brighter 20 is than 1.',
        delta: 'meanLuma',
        samples: 32,
        /* THE SUN IS PINNED, and it was not. The two baseline rows set no sun at all,
           so they ran at whatever the UI happened to hold while the "sun x20" rows set an
           absolute 20 -- which makes the label a lie in either direction and the delta
           column unreadable. A run with the UI sun above 20 reported the BRIGHTER rows as
           39% darker, and the +76% this note records from an earlier session was read under
           some third unknown setting. Pinned to the schema default, so "x20" means x20 and
           two runs a week apart are comparable.
           IN PHYSICAL UNITS SINCE THE UNITS CHANGE, and the old "x20" pair has no equivalent:
           the default sun is now the real one, 0.53 degrees and 100 klx, which is already the
           case NEE exists for -- BSDF sampling finds a disc of 6.7e-5 sr about never. The
           second pair is a 5-degree sun of the same illuminance: the same light, a disc BSDF
           sampling can hit. Every percentage quoted in the note above was read in the old
           units, and so was every figure in TESTING.md. */
        pin: { maxaverages: 0, maxiter: 400, maxbounce: 10, rr: 0, sunIlluminance: 100000, sunDiameter: 0.53, skyIlluminance: 15000 },
        cases: [
            { label: 'NEE off (BSDF sampling only)', set: { nee: 0 } },
            { label: 'NEE on', set: { nee: 1 } },
            { label: 'NEE off, 5-degree sun', set: { nee: 0, sunDiameter: 5 } },
            { label: 'NEE on,  5-degree sun', set: { nee: 1, sunDiameter: 5 } },
        ],
    },
    {
        id: 'nee-split',
        kind: 'image',
        title: 'Which half of light sampling is wrong?',
        verdict: vsRow(rows => rows[0], 0.005),
        note: 'FIGURES HERE PREDATE PHYSICAL UNITS. THE OPEN QUESTION. NEE is clean at the default sun (-0.07% on meanLuma) and 76%'
            + ' brighter at 20x, so the error is in the disc rather than the sky -- and since'
            + ' the NEE-off path is unchanged code that agreed with sun-only NEE before MIS'
            + ' landed, the light-sampling arm is the suspect. neeSunPick splits it: 1.0 samples'
            + ' only the disc, 0.0 only the sky (the disc is then found by chance through the'
            + ' cosine lobe -- noisy, but unbiased and independent of the cone code). EVERY row'
            + ' must agree with the first on meanLuma. The one that does not names the bug: if'
            + ' only sky-only agrees, it is the cone sampling or its pdf; if only disc-only'
            + ' agrees, it is the hemisphere term; if neither, it is the MIS weight itself.',
        delta: 'meanLuma',
        samples: 32,
        pin: { maxaverages: 0, maxiter: 400, maxbounce: 10, rr: 0,
               sunIlluminance: 100000, sunDiameter: 0.53, skyIlluminance: 15000 },
        cases: [
            { label: 'NEE off (reference)', set: { nee: 0 } },
            { label: 'NEE, sky only  (pick 0.0)', set: { nee: 1, neeSunPick: 0.0 } },
            { label: 'NEE, disc only (pick 1.0)', set: { nee: 1, neeSunPick: 1.0 } },
            { label: 'NEE, mixture   (pick 0.5)', set: { nee: 1, neeSunPick: 0.5 } },
        ],
    },
    {
        id: 'lt',
        kind: 'image',
        title: 'Light tracing: same total, and what the learned map is worth',
        verdict: vsRow('light tracing off (must', 0.005),
        note: 'RUN IT ON THE SHOWCASE SCENE, with the glass in view -- the bench runs whatever'
            + ' scene is loaded.'
            + ' meanLuma MUST HOLD ON EVERY ROW. Light tracing takes over one class of paths'
            + ' (sun -> glass or mirror -> first visible surface) from the camera side, which'
            + ' stops counting the sun along them, and only along lines that cross the photon'
            + ' square (ltCovers in sdf.js). Both sides are unbiased and the map only decides'
            + ' where photons go, so no row may move the mean beyond its noise. NEE-off rows are'
            + ' the noisiest estimate here (a 20x sun found by chance): +-0.5% is their scatter.'
            + ' THE NOISE TO READ IS lt noise. Before the rows, an untimed pass with learning on'
            + ' marks where light tracing contributes strongly (connection count >= 10% of the'
            + ' 99th percentile) and warms the map; that region is FROZEN and every row -- lt off'
            + ' too -- is measured inside it (lt reach = its share of the image). So row 1 vs 2'
            + ' vs 3 is learned vs light tracing off vs uniform photons, on the same pixels.'
            + ' Image-wide noise cannot show this: the caustic is a few percent of the view.'
            + ' lt top1% is the share of photons the busiest 1% of cells get (0.01 = uniform);'
            + ' conn/photon the share of photons that produced a camera connection.'
            + ' Small bright sun on purpose: that is where caustics are sharp and BSDF sampling'
            + ' is hopeless. (Pinned in lux since the units change: 100 klx from a 3.44-degree'
            + ' disc, the old 0.03 rad half-angle; noise figures before that are not comparable.)',
        delta: 'meanLuma',
        samples: 32,
        pin: { maxaverages: 0, maxiter: 400, maxbounce: 10, rr: 0, nee: 1,
               /* the old uSunSize 0.03 was a HALF-angle in radians: 3.44 degrees across */
               sunIlluminance: 100000, sunDiameter: 3.44, skyIlluminance: 15000,
               /* light tracing's own split, measured as before the photon map went on by default (0.61.0): with it the
                  class seen through glass changes owner and its blur would move these columns (the sppm row is its) */
               ltPhotons: 1, ltRadius: 15, ltLearn: 0, sppm: 0 },
        ltMaskPass: { samples: 64, set: { lt: 1, ltLearn: 1 } },
        extra: {
            columns: [
                ['lt top1%', r => r.topCellShare, 3],
                ['conn/photon', r => r.connPerPhoton, 4],
                ['lt noise', r => r.ltNoise, 4],
                ['lt reach', r => r.ltReach, 4],
            ],
            // only rows that run light tracing have a map worth reading
            read: async (RT, c) => (c.set?.lt ? await RT.ltStats() : {}),
        },
        cases: [
            // first, so the map the mask pass warmed is still there (ltLearn 0 resets it)
            { label: 'on, learned map (warmed by the mask pass)', set: { lt: 1, ltLearn: 1 } },
            /* WHAT LEARNING IS FOR: FEWER PHOTONS. The fifth run showed learned and uniform
               equal at 1 photon/pixel (lt noise 0.489 vs 0.491) -- the uniform map already
               delivered enough, and the camera side's other paths dominate what is left -- and
               the learned row the slowest, since 100x more of its photons connect. So compare
               at a tenth of the photons: if learned at 0.1 holds row 1's lt noise and uniform
               at 0.1 does not, learning is buying the photon budget, and secs says at what. */
            { label: 'on, learned, 0.1 photons/px', set: { lt: 1, ltLearn: 1, ltPhotons: 0.1 } },
            { label: 'light tracing off (must match row 1)', set: { lt: 0 } },
            { label: 'on, uniform map (must match)', set: { lt: 1 } },
            { label: 'on, uniform, 0.1 photons/px', set: { lt: 1, ltPhotons: 0.1 } },
            { label: 'on, uniform, square 0.5 (must match)', set: { lt: 1, ltRadius: 0.5 } },
            { label: 'NEE off, light tracing off (+-0.5%)', set: { lt: 0, nee: 0 } },
            { label: 'NEE off, light tracing on, uniform (+-0.5%)', set: { lt: 1, nee: 0 } },
            { label: 'light tracing off (repeat; must match row 3)', set: { lt: 0 } },
        ],
    },
    {
        id: 'emitters',
        kind: 'image',
        title: 'Emissive surfaces as lights: every way of finding them gives the same picture',
        verdict: (r, i, rows) => {
            // on the scene shown: one with no emissive object lights nothing here, and that measures nothing
            if (rows.every(x => !x.meanLuma) || rows.every(x => !x.emitters))
                return V.none('no emitter found in the scene shown: load one with an emissive object (the showcase)')
            return vsRow(rows => rows[0], x => x.case.includes('NEE off') ? 0.03 : 0.01)(r, i, rows)
        },
        note: 'RUN IT ON THE SHOWCASE SCENE: its orange/petrol sphere is emissive. Sun and sky are'
            + ' OFF, so that sphere is the only light. Nothing is declared -- the renderer discovers'
            + ' the emitter from the paths that hit it (emitters = boxes in its list after the row).'
            + ' Every row is an unbiased estimate of the same picture, so meanLuma must hold: NEE'
            + ' toward discovered emitters with MIS (row 1), BSDF sampling alone (rows 3-4, NEE'
            + ' off: a few % of scatter), with and without light tracing (which starts photons on'
            + ' the emitter for its caustics through glass), and NEE\'s emitter share at both ends'
            + ' (rows 5-6). A row that moves names the bug: 2 = the emitter-caustic split'
            + ' (emitCovers); 3/4 = the MIS weight on emitter hits (emitConePdf disagreeing'
            + ' between NEE and the hit); 5/6 = the share not reaching both sides. The first'
            + ' samples of every row run before anything is listed -- that is the case the MIS'
            + ' weight of 1 for an undiscovered emitter exists for.',
        delta: 'meanLuma',
        samples: 64,
        pin: { maxaverages: 0, maxiter: 400, maxbounce: 10, rr: 0, nee: 1, lt: 1,
               ltPhotons: 1, ltRadius: 15, ltLearn: 1, emitRadius: 15, neeEmitShare: 0.5,
               ltEmitShare: 0.5, sunIlluminance: 0, skyIlluminance: 0, sppm: 0 },     // the split's own, as lt (0.61.0)
        extra: {
            columns: [['emitters', r => r.emitters, 0]],
            // after the row, read and waited for: R.emitCount is only as fresh as the page's last yield
            read: async RT => ({ emitters: await RT.readEmitCount?.() ?? RT.emitCount }),
        },
        cases: [
            { label: 'NEE on, light tracing on', set: {} },
            { label: 'NEE on, light tracing off', set: { lt: 0 } },
            { label: 'NEE off, light tracing off (few % scatter)', set: { nee: 0, lt: 0 } },
            { label: 'NEE off, light tracing on (few % scatter)', set: { nee: 0 } },
            { label: 'NEE emitter share 0.2', set: { neeEmitShare: 0.2 } },
            { label: 'NEE emitter share 0.9', set: { neeEmitShare: 0.9 } },
        ],
    },
    {
        id: 'small-caustic',
        kind: 'image',
        title: 'A small scene\'s sun caustic: the photon square capped at the scene\'s radius',
        verdict: vsRow((rows, i) => labelled(rows, rows[i].case.startsWith('radius 5 cm') ? 'radius 5 cm, light tracing off' : 'radius 400 m, light tracing off'), 0.005),
        note: 'A 1 cm glass ball on a white floor 8 cm across, in a cm scene, under the real sun (0.53 degrees):'
            + ' its caustic lands on the floor beside it. The sun\'s photons cross a square through the scene,'
            + ' 15 m half-size by default (ltRadius), learned on a 128 x 128 grid -- cells of 23 cm round a 1 cm'
            + ' ball. Since 0.9.1 the square is never wider than the scene\'s radius (photometry.js photonHalf):'
            + ' rows 1, 2 and 5 give this scene a radius of 5 cm (cells of 0.8 mm), rows 3, 4 and 6 leave it the'
            + ' 400 m default (the 15 m square, as before). The scene is the same -- all of it inside 5 cm -- and'
            + ' the split is exact for any square (ltCovers), so meanLuma MUST HOLD ON EVERY ROW. WHAT THE CAP'
            + ' BUYS is conn/photon (the share of photons that reach the camera through the glass) and lt noise'
            + ' (inside the caustic, as in lt): row 2 against row 3 at a uniform map, row 1 against row 4 learned.'
            + ' Row 4 starts its map cold (row 3 reset it); row 1 was warmed by the mask pass. Loads its own'
            + ' scene and camera.',
        delta: 'meanLuma',
        samples: 32,
        scene: BALL_CM_R5,
        camera: BALL_CAMERA,
        pin: { maxaverages: 0, maxiter: 400, maxbounce: 10, rr: 0, nee: 1, lt: 1, envUniform: 0, envMode: 0,
               fireflyClamp: 0, uSunAzimuth: 45, uSunElevation: 45, uSkyTurbidity: 0.7,
               sunIlluminance: 100000, sunDiameter: 0.53, skyIlluminance: 15000, eps: 0,
               ltPhotons: 1, ltRadius: 15, ltLearn: 0, measureMode: 0, renderMode: 0, sppm: 0,     // the split's own, as lt (0.61.0)
               tBase: 1, tMetal: 0, tRough: 0, tSpec: 0.5, tTrans: 1, tIor: 1.5, tAniso: 0, tGrain: 0 },
        ltMaskPass: { samples: 64, set: { lt: 1, ltLearn: 1 } },
        extra: {
            columns: [
                ['lt top1%', r => r.topCellShare, 3],
                ['conn/photon', r => r.connPerPhoton, 4],
                ['lt noise', r => r.ltNoise, 4],
                ['lt reach', r => r.ltReach, 4],
            ],
            read: async (RT, c) => (c.set?.lt ? await RT.ltStats() : {}),
        },
        cases: [
            { label: 'radius 5 cm: square 5 cm, learned (warmed)', set: { lt: 1, ltLearn: 1 } },
            { label: 'radius 5 cm: square 5 cm, uniform map', set: { lt: 1 } },
            { label: 'radius 400 m: square 15 m, uniform map (as before)', set: { lt: 1 }, scene: BALL_CM },
            { label: 'radius 400 m: square 15 m, learned from cold', set: { lt: 1, ltLearn: 1 }, scene: BALL_CM },
            { label: 'radius 5 cm, light tracing off (must match)', set: { lt: 0 } },
            { label: 'radius 400 m, light tracing off (must match)', set: { lt: 0 }, scene: BALL_CM },
        ],
    },
    {
        id: 'sppm',
        kind: 'image',
        title: 'Seen through glass: the photon map gathers what the camera\'s rays find by chance',
        verdict: vsRow((rows, i) => labelled(rows, rows[i].case.startsWith('lens') ? 'lens 5 cm, photon map off' : 'photon map off'), 0.005),
        note: 'A pane of clear glass (n 1.5, 4 cm) standing on a white floor, the sun (3.44 degrees, 30 up) behind the'
            + ' camera: the floor behind the pane is lit through it and seen through it -- sun -> glass -> floor -> glass'
            + ' -> eye, the user\'s picture of 2026-10-15 with the sun for the lamp. The photon map (0.60.0, core/sppm.js)'
            + ' stores the sun\'s photons where they land past the glass and the camera\'s rays gather them where they land'
            + ' through it; the camera\'s rays then leave that light to it. So meanLuma MUST HOLD over every row: the map off'
            + ' (the camera\'s rays find the sun through the glass by chance), on, on with light tracing off (no photons: the'
            + ' camera keeps it all) -- and between the two rows through a 5 cm lens, off and on, another picture by its depth'
            + ' of field -- within the map\'s blur, which shrinks with samples. (Until 0.61.0 the lens\'s photons drew row 4,'
            + ' specks; they went with the map on by default.) WHAT TO LOOK AT: after the map\'s rows the floor seen through'
            + ' the pane should be smooth (a little soft at first), after rows 1 and 4 grainy; secs says what the map costs (a'
            + ' sample is two wavefront chains with it on); map M the photons it held, its radius in mm. Loads its own scene'
            + ' and camera.',
        delta: 'meanLuma',
        samples: 64,
        scene: { ...testScene('m', 'pane'), id: 'bench-pane-m', envRadius: 5 },
        camera: { mode: 'orbit', camtype: 0, target: [0, 0.9, 0.15], azimuth: 270, elevation: 72, distance: 4, fov: 40 },
        pin: { maxaverages: 0, maxiter: 400, maxbounce: 10, rr: 0, nee: 1, lt: 1, envUniform: 0, envMode: 0,
               fireflyClamp: 0, uSunAzimuth: 180, uSunElevation: 30, uSkyTurbidity: 0.7,
               sunIlluminance: 100000, sunDiameter: 3.44, skyIlluminance: 15000, eps: 0,
               ltPhotons: 1, ltRadius: 15, ltLearn: 1, measureMode: 0, renderMode: 0, sppm: 0, sppmRadius: 3,
               tBase: 1, tMetal: 0, tRough: 0, tSpec: 0.5, tTrans: 1, tIor: 1.5, tAniso: 0, tGrain: 0, tSlabT: 0.02 },
        extra: {
            columns: [
                ['map M', r => r.sppmStored, 3],
                ['dropped', r => r.sppmOverflow, 0],
                /* the gathers stopped at their hard cap (core/sppm.js SPPM_VISIT_HARD): above 0, photons within the radius
                   went uncounted there and the floor through the glass reads dark -- a bias, not noise (0.61.2); and the
                   share of its stores a sample kept so as not to overfill the map (1 while it fits; exact either way, 0.61.3) */
                ['cut', r => r.sppmCut, 0],
                ['kept', r => r.sppmKeep, 3],
                ['r mm', r => r.sppmRadius, 2],
            ],
            read: async RT => {
                const m = RT.sppmStats
                return m ? { sppmStored: m.stored / 1e6, sppmOverflow: m.overflow, sppmCut: m.cut, sppmKeep: m.keep ?? 1, sppmRadius: m.radius * 1000 } : {}
            },
        },
        cases: [
            { label: 'photon map off (the camera\'s rays find it by chance)', set: { sppm: 0 } },
            { label: 'photon map on (must match row 1)', set: { sppm: 1 } },
            { label: 'photon map on, light tracing off (must match row 1: no photons, the camera keeps it)', set: { sppm: 1, lt: 0 } },
            { label: 'lens 5 cm, photon map off (the camera\'s rays: another picture, its depth of field)', set: { sppm: 0 },
              camera: { mode: 'orbit', camtype: 0, target: [0, 0.9, 0.15], azimuth: 270, elevation: 72, distance: 4, fov: 40, aperture: 0.05 } },
            { label: 'lens 5 cm, photon map on (must match row 4)', set: { sppm: 1 },
              camera: { mode: 'orbit', camtype: 0, target: [0, 0.9, 0.15], azimuth: 270, elevation: 72, distance: 4, fov: 40, aperture: 0.05 } },
        ],
    },
    {
        id: 'small-emitter',
        kind: 'image',
        title: 'A small emitter: aimed at its own size, against the closed form',
        verdict: sensorRule(r => r.discRatio, r => r.discSe, DISC_NAMES),
        note: 'disc-light at a hundredth of the size: a 1 cm Lambertian disc of 10 000 cd/m^2, its face 0.99 cm'
            + ' above the floor of a cm scene, sun and sky off, read by the same sensors against the same closed'
            + ' form (cylinderE: light has no length in it, so the answer is the same). Every column must be 1'
            + ' within its error (seMax). WHAT CHANGED (0.9.1): the sphere NEE and the emitter probes aim at was'
            + ' the box of the camera\'s hits plus a fixed 2 cm -- round this 1 cm disc, a sphere four times its'
            + ' size, most of whose cone missed it -- and is now plus the step off a surface (emitMargin 0 = auto);'
            + ' and the emitter search grid is never wider than the scene\'s radius, like the sun\'s photon square.'
            + ' Rows 4 and 6 put the old 2 cm back (emitMargin 0.02); 5 and 6 leave the radius at the 400 m default'
            + ' (the grid at its 15 m setting). Exact at any margin (emitCovers), so the columns must hold on every'
            + ' row; WHAT IT BUYS is seMax: row 1 against row 4 (the margin), row 1 against 5 (the grid), row 1'
            + ' against 6 (both, as it was). Loads its own scene and camera.',
        delta: 'meanLuma',
        samples: 64,
        scene: DISC_CM_R6,
        camera: DISC_CAMERA,
        pin: { maxaverages: 0, maxiter: 400, maxbounce: 10, rr: 0, nee: 1, lt: 0, envUniform: 0, envMode: 0,
               fireflyClamp: 0, sunIlluminance: 0, skyIlluminance: 0, eps: 0, renderMode: 0,
               emitRadius: 15, emitMargin: 0, neeEmitShare: 0.5, ltEmitShare: 0.5,
               ...LAMBERT, tBase: FLOOR_ALBEDO, tRough: 1, tIor: 1.5, measureMode: 1,
               tDiscH: 1, tDiscR: 0.5, tDiscT: 0.01, tEmit: 10000 },
        extra: {
            columns: [...DISC_RADII.map((rho, i) => [`rho ${rho}`, r => r.discRatio?.[i] ?? null, 4]),
                      ['seMax', r => r.discSe, 4]],
            read: discRead(DISC_RADII),
        },
        cases: [
            { label: 'radius 6 cm: NEE', set: {} },
            { label: 'radius 6 cm: BSDF sampling alone', set: { nee: 0 } },
            { label: 'radius 6 cm: light tracing on', set: { lt: 1 } },
            { label: 'radius 6 cm, the OLD 2 cm margin (must match, noisier)', set: { emitMargin: 0.02 } },
            { label: 'radius 400 m (grid 15 m): NEE', set: {}, scene: DISC_CM },
            { label: 'radius 400 m and the old margin: as before', set: { emitMargin: 0.02 }, scene: DISC_CM },
        ],
    },
    {
        id: 'nee-cost',
        kind: 'cost',
        title: 'What does the occlusion queue cost?',
        note: 'The other side of nee: one shadow ray per rough bounce is not free. Read it'
            + ' together with the noise column above -- NEE is worth it if the noise falls by'
            + ' more than the frame rate does.',
        secs: 5,
        pin: { maxiter: 400, maxbounce: 10, rr: 0 },
        cases: [
            { label: 'NEE off', set: { nee: 0 } },
            { label: 'NEE on', set: { nee: 1 } },
        ],
    },
    {
        id: 'iteration-cost',
        kind: 'cost',
        title: 'What does a wavefront iteration actually cost?',
        note: 'WHAT THE WORST-CASE BUDGET COSTS (0.10.0: it is always the worst case). If a drained'
            + ' iteration is real money, this curve falls steeply and shortening the chain is worth'
            + ' engineering. If it is flat, the five dispatches are noise and the time is in the'
            + ' marching -- which is what maxiter 128 (-47%) already suggests.'
            + ' budgetOverride is the only honest way to ask: maxbounce and maxiter both change'
            + ' the iteration count AND the work inside it. Convergence suffers at the short end'
            + ' (watch rays flushed climb) but the light does not, because of THE FLUSH.',
        secs: 5,
        pin: { maxiter: 400, maxbounce: 10, rr: 0 },
        cases: [24, 20, 16, 12, 8].map(n => ({
            label: `${n} iterations`, rt: { budgetOverride: n },
        })),
    },
    {
        id: 'cost-sweep',
        kind: 'cost',
        title: 'Where the render time goes',
        note: 'sweep.js for this project: baseline, then one dial turned down per case. A case that'
            + ' is barely cheaper than the baseline is not where the time is.',
        secs: 5,
        cases: [
            { label: 'BASELINE', set: {} },
            { label: 'rr on', set: { rr: 1 } },
            { label: 'maxbounce 4', set: { maxbounce: 4 } },
            { label: 'maxiter 128', set: { maxiter: 128 } },
            /* No `fastnormals 0` row since 0.74.0: the setting went (uniforms.schema.js, Advanced), after this row's
               first run had it at 4.3x the frame (TESTING.md). */
            /* There used to be an `spp 2` row here, and it had to run LAST: R.ensureBuffers never
               shrinks, so doubling the rays left the buffers at ~670 MB for everything after it,
               and run second to last it put the row after it (autobudget off, gone in 0.22.3) at
               +384% against a baseline it never shared. spp is gone (uniforms.schema.js), but the rule stands for any case
               that can only grow an allocation -- more photons per pixel, say. */
        ],
    },
]

/* THE GROUPS, as the Tests panel shows them: a folder each, its own Run all first, then its tests in this order. Asked
   for when the panel had grown to some forty buttons in the order they were written (the user, 2026-10-22). `inRunAll`:
   the panel's top Run all takes every group with a known answer; Speed needs the loop running on the scene shown and
   says nothing without a reader, so it runs from its own folder only. The benchmarks are the page's (RTTESTS.addTest,
   `group: 'benchmarks'`), minutes each, and in no Run all. A host test names its group the same way (light-vs-emitter,
   'lights'). Every built-in test is in exactly one group (verdict.test.mjs). */
export const GROUPS = [
    { id: 'units', title: 'Light & units', inRunAll: true,
      ids: ['photometry', 'illuminance', 'cosine-law', 'error-bar', 'scale'] },
    { id: 'lights', title: 'Lights & emitters', inRunAll: true,
      ids: ['disc-light', 'small-emitter', 'emitters'] },
    { id: 'materials', title: 'Materials & energy', inRunAll: true,
      ids: ['furnace', 'haze', 'bsdf-parity'] },
    { id: 'estimators', title: 'Estimators agree', inRunAll: true,
      ids: ['nee', 'nee-split', 'lt', 'small-caustic', 'sppm', 'rr-bias'] },
    { id: 'modes', title: 'Render modes', inRunAll: true,
      ids: ['render-modes', 'draft-lamps', 'optics-mode', 'optics-light'] },
    { id: 'optics', title: 'Optics trace', inRunAll: true,
      ids: ['optics-balance', 'optics-refraction', 'optics-absorption', 'optics-coating', 'optics-dispersion',
            'optics-colour', 'optics-farfield'] },
    { id: 'speed', title: 'Speed', inRunAll: false,
      ids: ['cost-sweep', 'frame-cost', 'nee-cost', 'iteration-cost', 'render-modes-cost'] },
    { id: 'benchmarks', title: 'Benchmarks', inRunAll: false, ids: [] },
]
/* A TEST ON THE SCENE SHOWN: one that loads no scene of its own measures whatever is loaded, and its button says so --
   emitters on a scene with no emissive object measured a black picture in the 0.77.0 run. Worked out, not flagged. */
export const onSceneShown = t => !t.scene && !(t.cases || []).some(c => c.scene)

//======================================================================================================================
// THE RUNNER
//======================================================================================================================

/* Every column a report can hold, so the formatter and the JSON agree on names and widths. */
const COLUMNS = {
    image: [
        ['trimmedLuma', r => r.trimmedLuma, 6],
        ['meanLuma', r => r.meanLuma, 6],
        ['median', r => r.median, 6],
        ['noise', r => r.noise, 4],
        ['covered', r => r.covered, 4],
        ['secs', r => r.secs, 1],
    ],
    /* TIME TO A GIVEN QUALITY, relative to row 1 (>1 = gets there faster). Monte Carlo noise
       falls as 1/sqrt(samples), so noise^2 x time is what reaching a given noise costs; a
       setting that halves samples/s but halves the variance breaks even at 1.0. samples/s on its
       own cannot say that, and it was being read as if it could: NEE took the emitters bench
       from 18 to 8 samples/s and still reached the same noise 1.4x sooner. Uses the case's wall
       time, which includes the per-case clear and drain -- a small fixed cost per row. */
    imageEff: ['effic', (r, base) => (base && r.noise && r.secs && base.noise && base.secs)
        ? (base.noise * base.noise * base.secs) / (r.noise * r.noise * r.secs) : null, 2],
    /* THE OPTICS TRACE (lib/pathtracer/optics): where the emitted flux went, as shares of it, and
       the row's own known answer. balance is emitted - escaped - absorbed - lost over emitted:
       0 in a full run, the flux still in flight after a step. */
    optics: [
        ['absorbed', r => r.absorbedShare, 5],
        ['escaped', r => r.escapedShare, 5],
        ['lost', r => r.lostShare, 5],
        ['detected', r => r.detectedShare, 5],
        ['arrived', r => r.arrivedShare, 4],
        ['interact/ray', r => r.perRay, 2],
        ['balance', r => r.balance, 6],
        // the far field, when the row feeds one (optics-farfield)
        ['far', r => r.farShare, 4],
        ['I0 ratio', r => r.i0Ratio, 4],
        ['beam deg', r => r.beam, 2],
        ['expected', r => r.expected, 4],
        ['ratio', r => r.expected ? r.measured / r.expected : null, 4],
        ['secs', r => r.secs, 1],
    ],
    /* THE BENCHMARK's: the median sample (the one number compared), its spread, how many samples the
       row timed and threw away, the scene swap before it -- which may be the browser's cache and is
       NOT a compile measurement -- and the code fingerprint, which says whether two rows ran the same
       kernels. `null` decimals: a string column. */
    bench: [
        ['ms/sample', r => r.msPerSample, 1],
        ['min', r => r.msMin, 1],
        ['max', r => r.msMax, 1],
        ['samples/s', r => r.samplesPerSec, 2],
        // WHERE A SAMPLE'S GPU TIME GOES (core/kerneltime.js): ms per sample, medians over samples of their own
        ['gpu ms', r => r.gpuMs, 1],
        ['march', r => r.kernelMs?.march, 1],
        // the scene's answers about each hit, which shade asked itself before 0.20.8 (wavefront.js prog_surface)
        ['surface', r => r.kernelMs?.surface, 1],
        ['shade', r => r.kernelMs?.shade, 1],
        ['occlude', r => r.kernelMs?.occlude, 1],
        /* the GPU time between kernels (core/kerneltime.js tally): what the number of dispatches costs, apart from
           their work -- and, in the wavefront log's sample, the iterations a few rays kept going (wavefrontOf) */
        ['gaps', r => r.gpuGapMs, 1],
        ['tail ms', r => r.wavefrontTailMs, 1],
        /* the CPU's part of a sample: setting the uniforms and recording the dispatches, to the last submit
           (raytrace_main.js R.recordMs), median over the timed samples -- the wall clock above less the GPU time is
           this plus waiting for the GPU to report it done */
        ['record ms', r => r.recordMs, 1],
        /* the same row with the next sample recorded while the GPU runs this one (lib/pathtracer/samples.js): ms a
           sample over a stretch of its own. Against ms/sample, what overlapping the two would buy a save */
        ['pipelined', r => r.pipelinedMs, 1],
        // shadow rays the sample cut short and counted as unoccluded (wavefront.js prog_occlude, wavefrontOf): out of
        // maxiter, and before 0.10.0 also those the last pass left marching
        ['cut', r => r.shadowCut, 0],
        ['timed', r => r.timedSamples, 0],
        ['warm-up', r => r.warmupSamples, 0],
        ['setScene ms', r => r.setSceneMs, 0],
        ['compile ms', r => r.compileMs, null],
        ['compile seq', r => r.compileSeqMs, null],
        ['boxes', r => r.boxes, null],
        ['code', r => r.code, null],
    ],
    cost: [
        ['ms/sample', r => r.msPerSample, 3],
        ['samples/s', r => r.samplesPerSec, 1],
        ['cpu ms', r => r.cpuMsPerFrame, 2],
        ['queue ms', r => r.queueMs, 0],
        ['paced', r => r.pacedFraction, 2],
        // the BUDGET and what the scene actually NEEDED are different numbers: the iterations the
        // chain ran (the worst case since 0.10.0) and the last one any ray still marched in
        ['budget', r => r.wavefrontIterations, 0],
        ['used', r => r.iterationsUsed, 0],
    ],
}
/* The one number each kind is compared on. A delta against anything else is decoration.
   A test may override it with `delta`, and one has to: trimmedLuma is the right statistic for
   comparing two estimators of the same mean, but NEE's whole effect is moving energy out of
   the tail that trimming discards, so trimming would report the improvement as a bias. */
const DELTA = { image: r => r.trimmedLuma, cost: r => r.msPerSample, bench: r => r.msPerSample, optics: r => r.absorbedShare }
const DELTA_LABEL = { trimmedLuma: 'Δ trimmed', meanLuma: 'Δ mean', msPerSample: 'Δ ms' }

/**
 * Build the bench. `ctx` supplies everything the runner touches, so nothing here reaches into a
 * module: { RT, Q, WG, COST }. Returns { run, runAll, TESTS }.
 */
export function makeTestBench(ctx) {
    const { RT, Q, WG } = ctx
    bindEnvironment(ctx)                // so a report says which adapter produced it
    /* THE RUN'S WATCH (runwatch.js): every GPU step a run awaits ends with the step, or as soon as the device is
       lost, or past its time -- and the run then stops, keeps its rows and says why. Asked for when the scenedata
       benchmark lost the GPU at row 19 and sat on "...running" (the user's Pascal, 2026-10-04). One watch per device:
       a run after a loss on the same device stops at its first step instead of waiting on a dead one.
       THE TIMES ARE CHOICES, NOT MEASUREMENTS. A sample: SAMPLE_MS, where the slowest seen is 1.35 s (the Menger
       cubes as data, the user's Pascal, 0.20.0), and the engine cuts a heavy sample into short submissions anyway. A
       wait for the queue and the boxes' measuring: STEP_MS, since a queue drained after the live loop was once 71 s
       deep on a software adapter (measureImage). A compile: none -- it cannot be called back once started, so a row
       whose compile is predicted to take minutes is not started at all (COMPILE_LIMIT_MS, below); one started stops
       only on a loss. */
    const SAMPLE_MS = ctx.limits?.sampleMs ?? 60000, STEP_MS = ctx.limits?.stepMs ?? 300000      // ctx.limits: the tests'
    let RUN = watchRun(null), watched = null
    const gpu = (step, ms, what) => RUN.within(step, ms, what)
    const drain = () => gpu(() => WG.device.queue.onSubmittedWorkDone().catch(() => 0), STEP_MS, 'waiting for the GPU queue')

    //------------------------------------------------------------------------------------------
    // Applying a case. THREE LAYERS, re-applied from the snapshot every single time: the user's
    // settings, then the test's pin, then the case's own override. Not "apply the override on top
    // of whatever the last case left behind" -- that way a case silently inherits its
    // predecessor's state and the table is a record of the order the buttons were pressed.
    //------------------------------------------------------------------------------------------
    /* Renderer properties a case may set, and therefore ones the snapshot must carry: any key
       left out here would be restored from nothing and leak into every later test. */
    const RTKEYS = ['budgetOverride', 'submitEvery']
    const snapRT = () => Object.fromEntries(RTKEYS.map(k => [k, RT[k]]))

    let OPT = null                      // the optics module, made on first use (optics tests, optics-light)
    const apply = (snap, test, c) => {
        /* THE ENVIRONMENT IS SUN AND SKY unless a test says otherwise: every lighting bench's
           expected value is written for it, and a user who left the studio light on (envMode 1)
           would otherwise get a table of failures with nothing wrong in the renderer */
        /* ...AND FULL PATH TRACING WITH THE SCENE'S OWN ENVIRONMENT, for the same reason: a user who left
           Draft, Sketch or lamps only on would get a table measuring that instead (quality.js effective) --
           and the lights' rays on (0.16.0), or a row lit by an optics source (opticsLight) would read it dark */
        /* ...and every diffuse bounce, and dispersion as each glass sets it (0.75.0): a row's closed form is the full
           picture's, and these are the user's own settings below the row's */
        const unknown = RT.set({ ...snap.values, envMode: 0, renderMode: 0, lampsOnly: 0, lightRays: 1,
                                 maxDiffuse: UniformSpec.maxDiffuse.def, dispersionOff: 0, ...(test.pin || {}), ...(c.set || {}) })
            /* only the test's own names are worth a warning: once a test swaps the scene, the
               snapshot carries the user's scene uniforms, which the test scene rightly lacks */
            .filter(k => k in (test.pin || {}) || k in (c.set || {}))
        if (unknown.length) console.warn('[tests] unknown uniform(s):', unknown)
        Object.assign(RT, snap.rt, test.rt || {}, c.rt || {})
    }

    //------------------------------------------------------------------------------------------
    // An IMAGE case.
    //------------------------------------------------------------------------------------------
    const measureImage = async (snap, test, c, say = () => { }) => {
        RT.pause()
        /* DRAINING IS NOT INSTANT, and on a slow adapter it is most of the run. The loop submits
           without waiting, so at the moment it is paused the queue holds everything it got ahead
           by -- measured at 71 SECONDS on the software adapter here, which made the first case
           of a run look like a hang for twelve minutes while every later case took two seconds.
           Nothing can be measured until it is empty, so the only fix is to say what is going on. */
        if (ctx.COST.lat > 1000) say(`draining the render queue (${(ctx.COST.lat / 1000).toFixed(0)}s deep)...`)
        await drain()                       // the in-flight frame lands before anything changes
        apply(snap, test, c)
        /* THE OPTICS SOURCE LIGHTING THE PICTURE, when the test asks (optics-light): set and
           compiled before the canvas is cleared, since switching it on restarts the picture. */
        const light = c.opticsLight ?? test.opticsLight
        if (light) {
            OPT ??= createOptics(RT, WG)
            // several at once (`sources`, each over `source`), or the one
            if (light.sources) OPT.setSources(light.sources.map(x => ({ ...defaultSource(), ...light.source, ...x })))
            else OPT.setSource(light.source)
            await OPT.lightPicture(true, light.perPixel ?? 1)
        } else if (OPT?.picture.on) await OPT.lightPicture(false)
        /* A TRUE BLANK CANVAS. Nothing in this renderer ever clears the accumulation -- a "reset"
           only pulls the EMA window in, so a camera move re-weights the picture instead of
           flashing black. Lovely to look at, useless to measure against: without the clear, case
           2 starts from case 1's image. */
        await RT.clearAccums()
        /* ...AND, WHEN A TEST ASKS, WHAT LIGHT TRACING AND EMITTER DISCOVERY HAVE LEARNED: the
           photon map and the emitter list outlive a clear of the picture (the lt bench's warmed
           rows depend on that), and a list left by the row before -- an emitter that row showed and
           this one hides -- would aim this row's light sampling at it. */
        if (test.clearLearned && RT.clearLight) {
            RT.clearLight()
            /* ...THEN LET DISCOVERY FIND WHAT THIS ROW SHOWS before a sample counts. Light
               tracing's split between the sun and the emitters reads the emitter count on the CPU,
               from a readback that lands only when the page yields -- which step() does not do
               between samples -- so from a cleared list the whole row ran as if it had no emitter:
               no emitter photons, and 0 in light-vs-emitter's `emitters` column on the rows that
               showed one (first press, 2026-09-29). Two rebuilds of the list, the count read and
               waited for, and the picture cleared again. */
            await RT.step(2 * EMIT_EPOCH)
            await RT.readEmitCount()
            await RT.clearAccums()
        }
        /* ...and CONSUME THE RESET. Q.resetframecount is cleared by the render loop, which is not
           running. Left at 1 it pins the averaging window to 0 on every step -- each sample
           replaces the last -- so 32 steps converge no further than 1 does. */
        Q.resetframecount = 0
        await drain()
        // a case may ask for its own count (error-bar's 128-sample row), else the test's
        await RT.step(c?.samples ?? test.samples)
        const r = await RT.imageStats(snap.ltMask || null)
        /* A test may read more than the image -- `extra.read` runs after the same step, so its
           numbers describe exactly the samples the row measured. It is handed the row's own image
           statistics too, for a column that compares this row with another. */
        if (test.extra) Object.assign(r, await test.extra.read(RT, c, ctx, r))
        return r
    }

    //------------------------------------------------------------------------------------------
    // A COST case.
    //------------------------------------------------------------------------------------------
    const measureCost = async (snap, test, c, say = () => { }) => {
        RT.resume()
        apply(snap, test, c)
        /* DRAIN BEFORE TIMING, or the first case measures someone else's backlog. The loop
           submits without waiting, so at the moment a setting changes there can be seconds of
           queued work; a window opened then reports the queue, not the render. */
        if (ctx.COST.lat > 1000) say(`draining the render queue (${(ctx.COST.lat / 1000).toFixed(0)}s deep)...`)
        await drain()
        const secs = test.secs || 5
        await sleep(1200)                   // a discarded window: let the governor and the
        ctx.COST.reset()                    // exponential averages forget the previous case
        await sleep(secs * 1000)
        const s = window.RTSTATS(true)
        /* `used` and `flushed` come from the per-frame counter readback, which runs every frame (raytrace_main.js),
           so after the window's seconds of frames they are this case's own. (A switch that once turned it off left
           them holding the case before's -- `used 23 / flushed 3501` on a case that ran none -- and they were
           blanked then; the switch went in 0.10.0.) */
        // rate and ms/sample are exponential averages over the window. A queue deeper than a
        // quarter of it means the window never held steady state, so the number is not one.
        s.shaky = s.queueMs > secs * 250
        return s
    }

    //------------------------------------------------------------------------------------------
    /* A BENCH case (bench): the render timed on a stage nothing about the session
       can move. Every renderer setting at its schema default, then the scene's own environment, then
       the row's change -- where a cost case starts from the user's settings; the camera the row
       names, target included; the size the test names, rendered OFFSCREEN (beginOffscreen), so the
       window plays no part. Then samples one at a time, each awaited (renderFrame waits for the GPU
       after every sample): no governor deciding how many go in a frame, no queue ahead of the clock.
       What is timed is therefore wall clock from recording to the GPU's done, per sample -- stated
       as that in the report, and nothing more. The warm-up is thrown away: a new scene's first
       frame is cut into a submission per iteration (raytrace_main.js NO SUBMIT LONG ENOUGH), its
       emitters are found and its photon map learnt in the first samples. */
    const rendererDefaults = () => Object.fromEntries(Object.keys(RT.settings().values)
        .filter(k => k in UniformSpec)
        .map(k => [k, structuredClone(UniformSpec[k].def)]))
    /* A row's stage: the defaults, the scene's environment, the row's change, the row's camera. The scene
       itself is swapped in by the runner (useScene), before this. */
    /* WHAT A BENCH ROW STARTS FROM over the defaults (0.61.0): the photon map off, as it was before it went on by default
       -- these rows time the kernels and the samples, and every one measured before was without it. A row that wants it
       sets it. */
    const BENCH_BASE = { sppm: 0 }
    const stageBench = (snap, test, c) => {
        const unknown = RT.set({ ...rendererDefaults(), ...BENCH_BASE, ...(c.environment ?? test.environment ?? {}),
                                 ...(test.pin || {}), ...(c.set || {}) })
            .filter(k => k in (test.pin || {}) || k in (c.set || {}) || k in (c.environment ?? test.environment ?? {}))
        if (unknown.length) throw new Error(`[bench] '${c.label}': unknown setting(s) ${unknown.join(', ')}`)
        /* THE ITERATION BUDGET IS THE ROW'S OWN WORST CASE. Since 0.10.0 by construction: R.trace sets it to the
           worst case every trace, unless budgetOverride (raytrace_main.js THE ITERATION BUDGET IS THE WORST CASE),
           so this reset is moot. Before, the budget was adaptive engine state that carried from row to row: the
           "maxiter 128" row (worst case 15) left every later row at 15 iterations where row 1 had 24 -- the kernel
           pass counts of the fifth run showed it (2026-09-30), and row 1 read 7-9% above its repeats -- and the
           reset itself, from a stale `used`, sent rows to 4 iterations and on to 8 (the third run). Kept, as a
           page that has just loaded has it, so nothing depends on it being moot. */
        RT.budget = 0
        Object.assign(RT, snap.rt, test.rt || {}, c.rt || {})
        /* A PINHOLE unless the row names a lens (0.43.0): a camera here is a pose, and the page's lens -- the user's
           depth of field -- would otherwise stay on and blur every row. */
        const given = c.camera ?? test.camera
        const camera = given && { aperture: 0, focus: 0, ...given }
        if (camera) RT.applySettings({ camera })
        return camera
    }
    /* THE SCENE'S OWN LIGHTS' PHOTONS, for a bench row that brings them (`opticsLight`, as an image row's: the frozen
       document's lights, builder/sources.js faceSource; 0.61.2). The page lights the picture only with its own builder
       scene's lights (optics/page.js O.picture.applies), so without this a bench scene's light-traced lights shine nothing
       into the timed picture. Off again for a row without. The run puts it off at its end (OPT.lightPicture(false)). */
    const lightBench = async (test, c) => {
        const light = c.opticsLight ?? test.opticsLight
        if (light) {
            OPT ??= createOptics(RT, WG)
            OPT.setSources(light.sources.map(x => ({ ...defaultSource(), ...x })))
            await OPT.lightPicture(true, light.perPixel ?? 1)
        } else if (OPT?.picture.on) await OPT.lightPicture(false)
    }
    /* THE ROW'S KERNEL OPTIONS, BEFORE ITS SCENE GOES IN (raytrace_main.js R.kernelOptions: the step cache is compiled into
       the kernels only when on, so its setting is a build). Only the settings the options are read from, and set before
       the runner swaps the row's scene in: that swap then builds them, and nothing compiles the scene before with this
       row's options (index.js syncKernels). A row of the same scene as the one before builds them after (the job),
       which measureBench waits for. */
    const stageKernels = (test, c) => {
        if (!RT.kernelSettings?.length) return               // a renderer without kernel options
        const want = { ...rendererDefaults(), ...BENCH_BASE, ...(c.environment ?? test.environment ?? {}), ...(test.pin || {}), ...(c.set || {}) }
        RT.set(Object.fromEntries(RT.kernelSettings.filter(k => k in want).map(k => [k, want[k]])))
    }
    const measureBench = async (snap, test, c, say = () => { }, got = {}) => {
        /* THE ROW'S KERNELS BUILT FIRST (stageKernels above), so nothing compiles while the uncached compile or the
           samples are timed -- and checked: a build that failed put the kernels before back (index.js syncKernels),
           which would time another row's code under this row's name. */
        if (RT.kernelsSettled) {
            say('building the row\'s kernels...')
            await gpu(() => RT.kernelsSettled(), Infinity, 'building the row\'s kernels')
            const want = RT.kernelOptionsOf(RT.uniformBag())
            if (!RT.sameKernelOptions(want, RT.builtOptions))
                throw new Error(`[bench] '${c.label}': its kernels would not build (${JSON.stringify(want)}; built ${JSON.stringify(RT.builtOptions)})`)
        }
        /* THE UNCACHED COMPILE, for a row that asks (`compile`: one per distinct scene text): the build's own
           kernels for this row's scene, each made text no cache has seen, all at once as a scene change
           compiles them, with the loop paused and the GPU drained (raytrace_main.js R.compileUncached).
           Before the render, so the render's samples do not share the GPU with it. A row whose scene
           generates the same text as another (`sameTextAs`) says which instead of compiling again. If a
           kernel failed to compile, the cell says so ("1 failed") instead of a time, which would be the
           scene's compile minus that kernel's; the JSON keeps the time and names the kernels. */
        let compile = { compileMs: c.sameTextAs !== undefined ? `= row ${c.sameTextAs + 1}` : '-', compileSlowest: null }
        if (c.compile && RT.compileUncached) {
            await drain()
            say('compiling uncached...')
            const r = await gpu(() => RT.compileUncached(c.scene || test.scene), Infinity, 'the uncached compile')
            const failed = r.failed || []
            compile = { compileMs: failed.length ? `${failed.length} failed` : String(r.ms),
                        compileMsAll: r.ms, compileSlowest: r.slowest, compileReadyAt: r.readyAt, compileFailed: failed }
            /* ...AND THE SAME KERNELS ONE AT A TIME (raytrace_main.js: { sequential }), uncached again: whether a scene
               change would be quicker compiling in turn than all at once, which kernel costs what alone, and what
               the march's text costs to validate without a pipeline (`moduleMs`, the probe's near twin).
               ONLY WHEN A TEST ASKS (`compileSequential`), since 0.20.3: it was a third compile of every compile row
               (the scene's own, all at once, then this), and its question is answered -- the build is ready when shade
               is, all at once equal to shade alone within 0.5 s (the user's GTX 1080 Ti, compileprogress.js). The
               benchmark should be minutes, and a row of compiles was most of them (the user, 2026-10-04). */
            if (test.compileSequential || c.compileSequential) {
                await drain()
                say('compiling uncached, one kernel at a time...')
                const q = await gpu(() => RT.compileUncached(c.scene || test.scene, { sequential: true }), Infinity, 'the uncached compile, one kernel at a time')
                if (q) compile = { ...compile, compileSeqMs: q.failed?.length ? `${q.failed.length} failed` : String(q.ms),
                                   compileSeqEach: q.each, compileSeqSlowest: q.slowest, moduleMs: q.moduleMs }
            }
        }
        /* THE CULLING BOXES, for a row that brings a measurer (`measureBoxes`: the benchmark's rows, each for its
           own document -- the page measures only the builder's). After the compile, before the clock: the
           measuring is GPU round trips over the scene's tagged field, and the row times what the boxes buy,
           not what they cost to find. "known/total" top-level nodes with a box. */
        let boxes = { boxes: '-' }
        if (c.measureBoxes && RT.sampleTags) {
            await drain()
            say('measuring the bounding boxes...')
            const t0 = performance.now(), r = await gpu(() => c.measureBoxes(RT), STEP_MS, 'measuring the bounding boxes')
            boxes = { boxes: `${r.known}/${r.total}`, boxesMs: Math.round(performance.now() - t0), ...(r.unknown?.length ? { boxesUnknown: r.unknown } : {}) }
        }
        const camera = stageBench(snap, test, c)
        await gpu(() => lightBench(test, c), STEP_MS, 'the scene\'s lights\' photons')
        // the row's own size where it names one (`size`: a resolution row), else the test's
        const size = c.size ?? test.size
        const W = test.warmup || { samples: 3, ms: 2000 }, T = test.timed || { samples: 4, ms: 5000, max: 64 }
        await gpu(() => RT.beginOffscreen(size), STEP_MS, 'starting the offscreen render')
        const times = [], records = []
        let warm = 0, kernels = {}, controller = {}, pipelined = {}, extra = {}
        /* THE BUDGET SAMPLE BY SAMPLE, and the readings the row starts from (stale: the last row's). Asked when
           three runs (Pascal, 2026-10-02) put the same materials row at 8, 24 and 8 iterations: read in code, a
           shrink from the start state (R.budget 0) landed on the floor of 4 and only flushing grew it back. The
           controller is gone since 0.10.0 (raytrace_main.js THE ITERATION BUDGET IS THE WORST CASE), so every
           entry should read the row's worst case: one that does not says it came back. */
        const budgets = { budgetStart: { used: RT.used ?? null, flushed: RT.flushed ?? null }, budgetWarmup: [], budgetTimed: [] }
        /* THE ROW AS FAR AS IT GOT: what it returns at its end, and what the runner keeps of it when the run stops
           part way (`got.partial`, runwatch.js) -- the samples a row timed before the GPU was lost are its numbers. */
        const summary = () => {
            const sorted = [...times].sort((a, b) => a - b), mid = sorted.length >> 1
            const median = !sorted.length ? null : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
            return {
                msPerSample: median, msMin: sorted[0] ?? null, msMax: sorted.at(-1) ?? null,
                samplesPerSec: median > 0 ? 1000 / median : null,
                recordMs: medianOf(records), ...controller, ...pipelined, ...budgets,
                // each timed sample's wall clock and recording, in order: whether the time outside the GPU is every
                // sample's or some samples' (the second run's fastest sample sat 40 ms under its median)
                msSamples: times.map(t => +t.toFixed(1)), recordSamples: records.map(t => +t.toFixed(2)),
                timedSamples: times.length, warmupSamples: warm,
                size: `${size.width}x${size.height}`, camera: camera ?? null,
                unit: RT.scene?.unit ?? null, set: c.set || {}, ...compile, ...boxes, ...kernels, ...extra,
            }
        }
        got.partial = summary
        try {
            const tw = performance.now()
            while (warm < W.samples || performance.now() - tw < W.ms) {
                await gpu(() => RT.renderFrame(1), SAMPLE_MS, `warm-up sample ${warm + 1}`)
                budgets.budgetWarmup.push(RT.budget ?? null)
                say(`warm-up sample ${++warm}`)
            }
            const tt = performance.now()
            while (times.length < T.max && (times.length < T.samples || performance.now() - tt < T.ms)) {
                const t = performance.now()
                await gpu(() => RT.renderFrame(1), SAMPLE_MS, `timed sample ${times.length + 1}`)
                times.push(performance.now() - t)
                if (typeof RT.recordMs === 'number') records.push(RT.recordMs)
                budgets.budgetTimed.push(RT.budget ?? null)
                if (times.length % 4 === 0) say(`timed sample ${times.length}`)
            }
            /* THE ITERATION BUDGET the timed samples ran at, and the last readings of the counters: the first timed
               run (Pascal, 2026-10-02) logged 8 to 18 iterations in four scenes against a worst case of 24, which the
               old adaptive controller's accident explained. Since 0.10.0 the budget is the worst case
               (raytrace_main.js), and `budgetUsed` and `budgetFlushed` say how much of it the scene used. */
            controller = { budget: RT.budget ?? null, budgetUsed: RT.used ?? null, budgetFlushed: RT.flushed ?? null }
            /* THE TEST'S OWN READINGS (`extra.read`, as an image test's), after the timed samples, of the last of them:
               the photon map's counts, say -- what the row ran with, beside what it cost */
            if (test.extra?.read) extra = await gpu(() => test.extra.read(RT, c), STEP_MS, 'the row\'s own readings') ?? {}
            /* ONE SAMPLE IN FLIGHT: the same row, the next sample recorded while the GPU runs the one before
               (renderFrame's inFlight, lib/pathtracer/samples.js), timed as a stretch and divided by its samples --
               a throughput, where ms/sample is each sample's latency. After the timed samples, so it cannot move
               them. Asked because the second run (Pascal, 2026-10-02) put the time outside the GPU at 44-51 ms a
               sample beyond the JavaScript, yet the fastest sample of every row within 5-16 ms of the GPU time. */
            const P = test.pipelined
            if (P?.samples > 0) {
                say('one sample in flight...')
                /* ...and one submission a sample, unless the row asks for its own -- BUT ONLY WHERE THE ENGINE WOULD
                   NOT HAVE CUT THE SAMPLE ANYWAY: its slowest timed sample under SPLIT_OVER_MS (raytrace_main.js), wall
                   clock, which is never less than the GPU's time the engine decides on. Pinned because the engine's
                   frame timer (R.frameMs, R.trace) once read a sample waiting behind another together with it, and
                   over 250 ms would cut the samples into submissions -- #26 measured inside #24's column. It times the
                   GPU's busy time now, so that no longer happens; the pin stayed so this column reads as run 3's did
                   (PERFORMANCE_REVIEW.md §10.6).
                   ABOVE IT THE PIN WAS THE DANGER. One submission a sample takes away what keeps a heavy sample from
                   Windows' reset of a GPU busy about 2 s (R.trace, NO SUBMIT LONG ENOUGH TO BE KILLED). The scenedata
                   run lost the GPU right here (the user's Pascal, 0.20.0, 2026-10-04): the Menger cubes as data with
                   the grid, after its timed samples, the console's last progress "one sample in flight...". Its row
                   as data had timed 1347 ms a sample and lived through this step as one submission each; with the
                   grid the demo had been 1.56 times its data row, which would put this one past 2 s -- inferred, its
                   own samples never reached the report. What would test it: that row again, now cut, with no loss. */
                const own = RT.submitEvery
                const pin = !(own > 0) && times.length > 0 && Math.max(...times) < SPLIT_OVER_MS
                if (pin) RT.submitEvery = 1e6
                try {
                    const tp = performance.now()
                    await gpu(() => RT.renderFrame(P.samples, null, null, { inFlight: 2 }), SAMPLE_MS * P.samples, `${P.samples} samples with one in flight`)
                    pipelined = { pipelinedMs: (performance.now() - tp) / P.samples, pipelinedSamples: P.samples,
                                  pipelinedSubmits: own > 0 ? `the row's ${own}` : pin ? 'one a sample' : 'the engine\'s' }
                } finally { RT.submitEvery = own }
            }
            /* WHERE THE TIME GOES: each kernel timed on the GPU (core/kerneltime.js), in samples of their own AFTER
               the timed ones, so the timestamps cannot move the wall clock above -- whose runs 1-4 had none. Their
               own wall clock is kept too, to show what the timestamps cost. */
            const K = test.kernels
            if (K && RT.timeKernels) {
                if (RT.timeKernels(true)) {
                    const per = [], wall = []
                    try {
                        const tk = performance.now()
                        for (let n = 0; n < K.max && (n < K.samples || performance.now() - tk < K.ms); n++) {
                            const t = performance.now()
                            await gpu(() => RT.renderFrame(1), SAMPLE_MS, `kernel-timed sample ${n + 1}`)
                            wall.push(performance.now() - t)
                            const r = await gpu(() => RT.kernelTimes(), SAMPLE_MS, 'reading the kernel times')
                            if (r) per.push(r)
                        }
                    } finally { RT.timeKernels(false) }
                    kernels = kernelSummary(per, wall)
                    /* ...AND ONE MORE SAMPLE WITH THE WAVEFRONT LOG (raytrace_main.js R.wavefrontLog): rays and GPU ms
                       per iteration. Its own sample, after those, because the log adds a pass an iteration. */
                    if (RT.wavefrontLog && RT.timeKernels(true)) {
                        try {
                            await gpu(() => RT.wavefrontLog(true), STEP_MS, 'starting the wavefront log')
                            await gpu(() => RT.renderFrame(1), SAMPLE_MS, 'the wavefront log\'s sample')
                            const [kt, counts] = await gpu(() => Promise.all([RT.kernelTimes(), RT.wavefrontCounts()]), SAMPLE_MS, 'reading the wavefront log')
                            kernels = { ...kernels, ...wavefrontOf(kt, counts) }
                        } finally { await RUN.tidy(() => RT.wavefrontLog(false)); RT.timeKernels(false) }
                    }
                } else kernels = { kernelsNote: 'no timestamp-query on this device' }
            }
        } finally {
            /* the live view back however the row ended -- not waited for on a lost device, nor for ever (RUN.tidy) */
            const e = await RUN.tidy(() => RT.endOffscreen(), STEP_MS)
            if (e && RUN.why === null) throw e
            if (e) console.error('[tests] ending the offscreen render after the run stopped:', e)
        }
        return summary()
    }

    //------------------------------------------------------------------------------------------
    /* AN OPTICS case: the technical ray trace over the test's scene (lib/pathtracer/optics), with
       the renderer's settings applied the same way -- the material uniforms reach the optics
       kernels through the same uniform bag. `c.step` traces that many steps from a reset instead
       of running every ray to the end. `c.expect` names the row's known answer: which reading
       (absorbedShare, escapedShare, lostShare, detectedShare, arrivedShare, balance) and its value.
       `c.trace` traces that many steps in one go instead (the step slider's and Live's path). */
    const measureOptics = async (snap, test, c) => {
        RT.pause()
        await drain()
        apply(snap, test, c)
        OPT ??= createOptics(RT, WG)
        // several sources at once (a row's `sources`), each over the test's source; else the one
        if (c.sources) OPT.setSources(c.sources.map(x => ({ ...defaultSource(), ...(test.source || {}), ...x })))
        else OPT.setSource({ ...(test.source || {}), ...(c.source || {}) })
        /* every setting a row may change is put back first -- the trace is shared by every case and
           every test, and a row's eps would otherwise still be set for the next test's rows */
        Object.assign(OPT.settings, { bounces: 64, marchSteps: 2000, eps: 0, ...(test.optics || {}), ...(c.optics || {}) })
        // THE FAR FIELD: off unless the test asks, the case's fields over the test's -- a case that
        // changes only what feeds it keeps the test's grid
        OPT.settings.far = { mode: 'off', nC: 72, nG: 181, axis: [0, 0, 1], c0: [1, 0, 0], material: 0,
                             ...(test.optics?.far || {}), ...(c.optics?.far || {}) }
        const rays = c.rays ?? test.rays ?? 100000
        let res
        if (c.step) {
            await OPT.reset({ rays })
            for (let i = 0; i < c.step; i++) res = await OPT.step()
        } else if (c.trace != null) {
            res = await OPT.trace({ rays, steps: c.trace })
        } else {
            res = await OPT.run({ rays, batches: c.batches ?? test.batches ?? 4 })
        }
        const E = res.emitted.value || 1
        const r = {
            absorbedShare: res.absorbed.value / E, escapedShare: res.escaped.value / E, lostShare: res.lost.value / E,
            detectedShare: (res.detected?.value ?? 0) / E,
            perRay: res.interactionsPerRay?.value ?? null,
            // flux arriving at surfaces, all interactions summed, over emitted: 1 + rho + rho^2 + ...
            arrivedShare: res.objects.reduce((a, o) => a + o.incident.value, 0) / E,
            balance: (res.emitted.value - res.escaped.value - res.absorbed.value - res.lost.value
                      - (res.detected?.value ?? 0)) / E,
            alive: res.alive != null ? res.alive / rays : null,
            seAbsorbed: res.absorbed.se != null ? res.absorbed.se / E : null,
            rays: res.rays, batches: res.batches,
        }
        if (OPT.far) {
            const F = OPT.far, R = intensity(F, { symmetry: test.farSymmetry ?? 'none' }), S = farStats(F, R, [0])
            /* I0 FITTED over 0-20 degrees as I0 cos(gamma), not read at gamma = 0: the pole's cap is
               half a bin wide and holds ~1e-4 of the flux -- a few dozen rays, 10 % noise -- where the
               first 20 degrees hold 12 %. Against a Lambertian source's flux / pi; only meaningful on
               the rows that have one. */
            const { omega } = farGeometry(F.nC, F.nG)
            let f = 0, w = 0
            for (let j = 0; j * R.dG <= 20; j++) {
                for (let i = 0; i < F.nC; i++) f += F.flux[j * F.nC + i]
                w += omega[j] * F.nC * Math.cos(j * R.dG * Math.PI / 180)
            }
            Object.assign(r, { farShare: S.flux / E, i0Ratio: (f / w) / (E / Math.PI), beam: S.planes[0].beam?.width ?? null })
        }
        if (c.expect) { r.expected = c.expect.value; r.measured = r[c.expect.key] }
        /* A test may read more than the tallies -- the detector hits, say -- after the same run, and
           may supply the row's measured value itself (a reading the tallies do not have) */
        if (test.extra?.read) Object.assign(r, await test.extra.read(OPT, c, res))
        return r
    }

    //------------------------------------------------------------------------------------------
    /* A TEST MAY BRING ITS OWN SCENE AND CAMERA, and a case its own scene. Swapped in before the
       case is applied, so the case's uniforms land on the scene they are meant for, and put back
       in `run`'s finally BEFORE the settings are restored -- setScene rebuilds the scene's uniform
       state from the scene being swapped IN, so restoring settings first and the scene second
       would hand the user's scene the defaults. */
    let current = null
    /* WHICH CODE WAS MEASURED: a short hash (FNV-1a) of the kernels the scene is compiled into, and shade, as
       compiled. Two rows with the same value ran the same shader text; a report from another day with a
       different value ran different code, whatever the commit it claims. */
    const kernelFingerprint = () => {
        let h = 0x811c9dc5
        for (const k of ['prog_wvfmarch', 'prog_wvfshade', 'prog_wvfocclude', 'prog_wvfsurface']) {
            const t = RT[k]?.wgsl || ''
            for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
        }
        return h.toString(16).padStart(8, '0')
    }
    const useScene = async scene => {
        if (!scene || scene === current) return
        await RT.setScene(scene)
        current = scene
    }
    /* NO ROW WHOSE COMPILE WOULD TAKE MINUTES. The scaling bench's lens assembly x 32 as codegen was still compiling
       after ten minutes (the user, 2026-10-03): "an order of magnitude too long" (2026-10-04). A compile cannot be
       called back once started, so the row is judged before its scene goes in: the engine predicts the build from
       the kernels' text without compiling it (raytrace_main.js R.predictCompile, this machine's learned rate), and a
       row predicted over COMPILE_LIMIT_MS is not run -- its row says so, with the prediction. The limit is a choice:
       a row compiles its scene once to show it and once more uncached, so a row at the limit is two minutes of
       compiling. The prediction is a fit (compileprogress.js: rms 11%, worst 28% over the user's 16 builds of 2-46 s),
       so a row near the limit may run over it, and one far past it is an extrapolation. One prediction a scene: rows
       sharing a scene share it. */
    const COMPILE_LIMIT_MS = ctx.limits?.compileMs ?? 60000
    const predicted = new WeakMap()
    const tooLong = async scene => {
        if (!scene || scene === current || !RT.predictCompile) return null
        if (!predicted.has(scene)) predicted.set(scene, await RT.predictCompile(scene).catch(() => null))
        const p = predicted.get(scene)
        return p?.expectMs > COMPILE_LIMIT_MS ? p : null
    }
    const minutes = ms => ms >= 90000 ? `${(ms / 60000).toFixed(1)} min` : `${Math.round(ms / 1000)} s`

    const run = async (test, onProgress = () => { }) => {
        const snap = { values: RT.get(), rt: snapRT(), running: RT.running(), size: RT.size?.(),
                       scene: RT.scene, camera: RT.cam?.get?.(), settings: RT.settings?.() }
        const bench = test.kind === 'bench'
        /* THE RUN'S WATCH on the device as it is now: a new one unless this device was already lost, in which case
           the old one stays and the run stops at its first step, saying so */
        if (watched !== WG.device || !RUN.lost) { RUN = watchRun(WG.device); watched = WG.device }
        let stopped = null, at = null
        // a benchmark renders offscreen, case by case: the live view has nothing to do meanwhile
        if (bench) RT.pause()
        current = RT.scene
        /* PIN THE RESOLUTION FOR THE RUN. Every number this bench produces is a function of it:
           ms/sample is near-linear in pixels, `covered` is per-size by definition, and `noise`
           -- a mean difference between adjacent pixels -- reads LOWER at higher resolution for
           the same sampler, because neighbours are more correlated. None of that is a problem
           while the size is a constant. It became one the moment the size could follow the
           panel: a splitter dragged mid-run changes the resolution BETWEEN cases, which is
           precisely the "a case inherits whatever the last one left behind" failure the
           snapshot exists to prevent. Fixed at whatever it is now, and put back afterwards. */
        try { RT.setSize?.({ mode: 'fixed', width: Q.w, height: Q.h, scale: 1 }) } catch { }
        const rows = []
        const t0 = performance.now()
        try {
            /* A MASK PASS, for a test that measures noise where light tracing matters: one
               untimed run with the given settings, whose connection map becomes the region
               every row's ltNoise is measured over. It also warms the learned photon map. */
            /* THE TEST'S OWN SCENE AND CAMERA FIRST, then the mask: it is pixels, and only right for what the rows
               see. The camera was set after the mask pass, and the scene only per row -- which was fine while the
               one test with a mask (lt) had neither and ran on what was loaded; the first with its own of both
               (small-caustic) would have masked the user's view instead. */
            /* ...A PINHOLE unless it names a lens (0.43.0), as a benchmark's rows are (stageBench): the page's lens is the
               user's depth of field, and would blur what a row reads off its pixels. A ROW MAY NAME ITS OWN CAMERA (the
               lens row's apertures): set before it, and the test's own again before the next row that names none. */
            const camOf = c => ({ aperture: 0, focus: 0, ...(c?.camera ?? test.camera) })
            if (test.camera && !bench) RT.cam?.set?.(camOf(null))   // a benchmark sets each row's own
            let rowCamera = null                                    // the camera the last row named, if it named one
            if (test.ltMaskPass && RT.ltMask) {
                await gpu(() => useScene(test.scene), Infinity, 'compiling the test\'s scene')
                onProgress('building the light-tracing mask...')
                await gpu(() => measureImage(snap, { ...test, samples: test.ltMaskPass.samples }, { set: test.ltMaskPass.set }), Infinity, 'the light-tracing mask')
                snap.ltMask = await gpu(() => RT.ltMask(), STEP_MS, 'reading the light-tracing mask')
            }
            for (const [i, c] of test.cases.entries()) {
                const got = {}, ts = performance.now(), scene = c.scene || test.scene
                at = { row: i + 1, label: c.label, got, ts }
                const head = `running ${i + 1}/${test.cases.length}: ${c.label}`
                const say = extra => onProgress(rows.length
                    ? `${format(test, rows, false)}\n\n${head}\n${extra || ''}`
                    : `${head}\n${extra || ''}`)
                if (bench) {
                    say('predicting the compile...')
                    const long = await tooLong(scene)
                    if (long) {
                        rows.push({ case: c.label, compileMs: `~${minutes(long.expectMs)}`, compilePredictedMs: long.expectMs,
                                    compileSlowest: long.slowest, skipped: `predicted ${minutes(long.expectMs)} to compile (${long.slowest}), over the run's ${minutes(COMPILE_LIMIT_MS)}: not run` })
                        onProgress(format(test, rows, false))
                        continue
                    }
                }
                if (!bench && (c.camera || rowCamera)) { RT.cam?.set?.(camOf(c)); rowCamera = c.camera ?? null }
                const swapped = scene && scene !== current, t1 = performance.now()
                if (bench) stageKernels(test, c)          // in the same task as the swap below: it builds them
                await gpu(() => useScene(scene), Infinity, `compiling '${c.label}'`)
                const setSceneMs = swapped ? performance.now() - t1 : 0
                say()
                await sleep(0)              // yield, so the popup repaints and the page is not
                                            // mistaken for hung
                const tc = performance.now()
                /* A BENCHMARK ROW GUARDS EACH OF ITS OWN STEPS (measureBench), so it ends through its own finally -- the
                   offscreen render let go BEFORE the restore below puts the scene back and resumes the loop. Raced from
                   out here too, the race won first and the restore ran with the offscreen target still set (this file's
                   test, a mutation of it). Every other kind is raced against the device's loss whole. */
                const r = bench
                    ? { ...await measureBench(snap, test, c, s => (say(s), sleep(0)), got), setSceneMs, code: kernelFingerprint() }
                    : await gpu(() => test.kind === 'image'
                        ? measureImage(snap, test, c, s => (say(s), sleep(0)))
                        : test.kind === 'optics'
                        ? measureOptics(snap, test, c)
                        : measureCost(snap, test, c, s => (say(s), sleep(0))), Infinity, c.label)
                // wall time for the case itself. Not a performance number -- it is what tells
                // you whether to reach for a smaller canvas or fewer samples before the next run.
                rows.push({ case: c.label, ...r, secs: +((performance.now() - tc) / 1000).toFixed(1) })
                onProgress(format(test, rows, false))
            }
            at = null
        } catch (e) {
            if (!(e instanceof Stopped)) throw e
            /* THE RUN STOPPED (runwatch.js): the rows done are kept, the row it stopped in with what it had timed,
               and the report says where and why */
            stopped = { row: at?.row ?? null, of: test.cases.length, label: at?.label ?? null, why: e.why, lost: !!RUN.lost }
            const part = at?.got.partial?.()
            if (part && (part.timedSamples || part.warmupSamples))
                rows.push({ case: `${at.label} (stopped)`, ...part, stopped: e.why, secs: +((performance.now() - at.ts) / 1000).toFixed(1) })
            console.error(`[tests] ${test.id} stopped at row ${stopped.row ?? '-'} (${stopped.label ?? 'before the rows'}): ${e.why}`)
        } finally {
            /* RESTORE, WHATEVER HAPPENED. A test that leaves the renderer in a test configuration
               is worse than no test at all -- the next thing you look at is a lie and nothing
               tells you so. ...EXCEPT ON A LOST DEVICE: nothing that needs the GPU is waited for or started (a scene
               compiled, a picture lit, the loop resumed) -- it is gone until the page is reloaded, which the report
               says. The settings themselves are still put back, so a reload's autosave keeps the user's, not a row's. */
            const lost = !!RUN.lost
            Object.assign(RT, snap.rt)
            if (!lost && snap.scene && RT.scene !== snap.scene) {
                const e = await RUN.tidy(() => RT.setScene(snap.scene), Infinity)
                if (e) console.error('[tests] scene restore failed', e)
            }
            if ((test.camera || test.cases.some(c => c.camera)) && snap.camera && !bench) {
                const { mode, camtype, azimuth, elevation, distance, fov, dimensions, target, aperture = 0, focus = 0 } = snap.camera
                // the target too, if the test moved it (draft-lamps looks beside its disc); and the lens, which it always sets
                const moved = (test.camera?.target || test.cases.some(c => c.camera?.target)) && target
                try { RT.cam?.set?.({ mode, camtype, azimuth, elevation, distance, fov, dimensions, aperture, focus, ...(moved ? { target } : {}) }) } catch { }
            }
            /* a benchmark moved the camera row by row, target included: all of it back, and the size,
               the way a workspace puts them back (index.js applySettings: mode, then pose, then size) */
            if (bench && snap.settings) { try { RT.applySettings(snap.settings) } catch (e) { console.error('[tests] settings restore failed', e) } }
            if (!lost && OPT?.picture.on) await RUN.tidy(() => OPT.lightPicture(false))
            try { RT.set(snap.values) } catch (e) { console.error('[tests] settings restore failed', e) }
            if (snap.size) { try { RT.setSize(snap.size) } catch { } }
            Q.resetframecount = 1
            if (snap.running && !lost) RT.resume(); else RT.pause()
        }
        const text = format(test, rows, true, performance.now() - t0, stopped)
        console.log(text)
        return { rows, text, stopped, verdict: V.judge(test, rows) }
    }

    /* RUN SEVERAL: the panel's Run all (every group with a known answer) or a group's own. The report opens with one
       line a test -- its verdict and the rows that did not pass -- and the reports follow, as each test's own button
       gives them. */
    const runAll = async (tests = TESTS.filter(t => GROUPS.some(g => g.inRunAll && g.ids.includes(t.id))), onProgress = () => { }) => {
        if (typeof tests === 'function') return runAll(undefined, tests)      // runAll(onProgress), as before groups
        const parts = [], results = []
        let halted = null
        for (const t of tests) {
            onProgress(`${summaryTable(results, tests.length)}\n\n=== ${t.id} ===`)
            const r = await run(t, s => onProgress(`${summaryTable(results, tests.length)}\n\n${parts.join('\n\n')}\n\n${s}`))
            parts.push(r.text)
            results.push({ test: t, rows: r.rows, verdict: r.verdict })
            if (r.stopped) { halted = `Run all stopped after ${t.id}: ${r.stopped.why}`; parts.push(halted); break }
        }
        return { text: [summaryTable(results, tests.length), ...parts].join('\n\n'), results }
    }

    /* LOOK THROUGH ROW n's CAMERA (1-based): its scene, its settings and its camera in the live view, the loop
       running -- and LEFT there, to be looked at. Nobody can check a benchmark's framing without seeing it, and
       the benchmark itself renders offscreen. The user's settings are not restored: reload, or open a workspace. */
    const view = async (test, n) => {
        const c = test.cases[n - 1]
        if (!c) throw new Error(`[bench] no row ${n}: rows are 1-${test.cases.length}`)
        current = RT.scene                  // whatever is showing now, not what a run last left
        await useScene(c.scene || test.scene)
        if (c.measureBoxes && RT.sampleTags) await c.measureBoxes(RT)     // the row's boxes, as the run has them
        stageBench({ rt: snapRT() }, test, c)
        await lightBench(test, c)                   // its lights' photons too: a beam is half of what there is to see
        RT.resume()
        return `row ${n}: ${c.label} -- ${JSON.stringify(c.camera ?? test.camera ?? null)}`
    }

    return { run, runAll, view, TESTS }
}

//======================================================================================================================
// THE REPORT
//
// Aligned plain text, because it is going to be read in a terminal-ish popup and pasted into a
// chat window, with the same numbers as JSON underneath so they can be parsed back exactly.
//======================================================================================================================

const num = (v, d) => (v === null || v === undefined || Number.isNaN(v) ? '-' : (+v).toFixed(d))
const medianOf = a => {
    const s = [...a].sort((x, y) => x - y), m = s.length >> 1
    return !s.length ? null : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
/** The kernel-timed samples of a bench row (core/kerneltime.js results, one a sample) as its cells: per kernel
 *  the median over the samples (a kernel absent from a sample counts 0 there), `gpuMs` the median of each
 *  sample's total -- not the sum of the medians -- and the samples' own wall clock. */
export function kernelSummary(per, wall = []) {
    if (!per.length) return { kernelsNote: 'no kernel times came back' }
    const names = [...new Set(per.flatMap(r => Object.keys(r.ms)))].sort()
    const kernelMs = Object.fromEntries(names.map(k => [k, medianOf(per.map(r => r.ms[k] || 0))]))
    // the first pass's start to the last one's end, and what of it no pass ran (core/kerneltime.js tally)
    const spans = per.filter(r => typeof r.spanMs === 'number')
    return {
        ...(spans.length ? { gpuSpanMs: medianOf(spans.map(r => r.spanMs)), gpuGapMs: medianOf(spans.map(r => r.gapMs)) } : {}),
        gpuMs: medianOf(per.map(r => Object.values(r.ms).reduce((a, b) => a + b, 0))),
        kernelMs,
        kernelPasses: Object.fromEntries(names.map(k => [k, medianOf(per.map(r => r.count?.[k] || 0))])),
        kernelSamples: per.length,
        kernelWallMs: medianOf(wall),
        ...(per.some(r => r.overflow) ? { kernelOverflow: Math.max(...per.map(r => r.overflow)) } : {}),
    }
}
/** One sample's wavefront log beside its kernel times (raytrace_main.js R.wavefrontCounts, core/kerneltime.js): per
 *  iteration the rays it marched, shaded and occluded and the GPU ms of its passes; and THE TAIL -- the iterations
 *  that marched under a tenth of what the first one did, and the ms they took. A long, costly tail is a wavefront
 *  draining a few long paths through a whole chain of dispatches: the case for refilling it as it empties. */
export function wavefrontOf(kt, counts) {
    if (!kt?.seq || !counts?.iterations?.length) return { wavefrontNote: 'no wavefront log came back' }
    const { iterations: ms } = perIteration(kt.seq)
    const it = counts.iterations.map((c, i) => ({ ...c, ms: ms[i] ?? {}, gpuMs: Object.values(ms[i] ?? {}).reduce((a, b) => a + b, 0) }))
    const first = it[0].marched || 0
    const tail = it.filter(r => r.marched < 0.1 * first)
    const total = it.reduce((a, r) => a + r.gpuMs, 0)
    const last = it[it.length - 1]
    // `flushed` and `shadowCut` are logged as the sample's running totals; per iteration, what that one added
    const step = (k, i) => (it[i][k] ?? 0) - (i ? it[i - 1][k] ?? 0 : 0)
    return {
        wavefrontTailMs: tail.reduce((a, r) => a + r.gpuMs, 0),
        wavefrontTailIterations: tail.length,
        wavefrontIterationsMs: total,
        wavefrontGapMs: kt.gapMs,
        // the whole sample's: shadow rays cut short (prog_occlude) and camera rays the last pass ended (THE FLUSH)
        ...(last.shadowCut !== undefined ? { shadowCut: last.shadowCut } : {}),
        ...(last.flushed !== undefined ? { flushed: last.flushed } : {}),
        wavefront: it.map((r, i) => ({ marched: r.marched, next: r.next, shaded: r.shaded, occluded: r.occluded,
                                       shadowsNext: r.shadowsNext, cut: step('shadowCut', i), flushed: step('flushed', i),
                                       march: +(r.ms.march || 0).toFixed(3), surface: +(r.ms.surface || 0).toFixed(3),
                                       shade: +(r.ms.shade || 0).toFixed(3),
                                       occlude: +(r.ms.occlude || 0).toFixed(3), gpu: +r.gpuMs.toFixed(3) })),
    }
}
const pad = (s, w, left = false) => left ? String(s).padEnd(w) : String(s).padStart(w)

function environment(ctx) {
    const { Q } = ctx
    let adapter = 'unknown adapter'
    try {
        const i = ctx.WG.device?.adapterInfo
        adapter = [i?.vendor, i?.architecture, i?.device, i?.description].filter(Boolean).join(' ')
            || 'unknown adapter'
    } catch { }
    /* WALL CLOCK, whatever the device supports. This said "gpu pass" whenever the adapter had the
       timestamp-query feature -- but nothing ever reads a timestamp: the loop only calls
       cost.submitted(spp, false) (render-loop.js), so COST.ms is always the wall-clock rate. */
    /* WHICH BUILD, when the host says (installUI's `build`, a function: the raytracer's version and git revision).
       A result pasted back a week later is only worth what is known about the code that made it; the kernel
       fingerprint a benchmark row carries says whether two rows ran the same shader, this says which page. */
    let build = ''
    try { build = ctx.build?.() || '' } catch { }
    return `${build ? `${build} · ` : ''}${Q.w}x${Q.h} · ${adapter} · timing wall clock`
}

let ENV = () => ''
export const bindEnvironment = ctx => { ENV = () => environment(ctx) }

/* A TEST'S REPORT: its header, a row a case with its verdict, its note, and the JSON once done. Exported for
   verdict.test.mjs, which reads a replayed run's. */
export function format(test, rows, done, elapsedMs = 0, stopped = null) {
    const cols = [...COLUMNS[test.kind], ...(test.kind === 'image' ? [COLUMNS.imageEff] : []),
                  ...(test.extra?.columns || [])]
    const dkey = test.delta || (test.kind === 'image' ? 'trimmedLuma' : 'msPerSample')
    const delta = test.delta ? (r => r[test.delta]) : DELTA[test.kind]
    const w0 = Math.max(4, ...rows.map(r => r.case.length))
    const base = rows[0]
    /* THE VERDICTS (verdict.js), on the rows so far: a running report says how it is going, a finished one says it
       for the whole test */
    const verdict = V.judge(test, rows)
    /* EACH COLUMN AS WIDE AS ITS WIDEST CELL, 13 at least: a fixed 13 ran an mm row's 23730080.540728 into the
       column after it (the user's 0.77.0 run, optics-light) */
    const cells = rows.map(r => cols.map(([, get, dp]) => dp === null ? String(get(r, base) ?? '-') : num(get(r, base), dp)))
    const widths = cols.map(([n], j) => Math.max(13, n.length + 2, ...cells.map(c => c[j].length + 2)))
    // a row with nothing to compare (not run, or stopped before its timed samples) says '-', never NaN%
    const deltas = rows.map((r, i) => i === 0 || !delta(base) || !Number.isFinite(delta(r)) ? '-'
        : `${delta(r) >= delta(base) ? '+' : ''}${((delta(r) - delta(base)) / delta(base) * 100).toFixed(2)}%`)
    const dw = Math.max(12, ...deltas.map(d => d.length + 2))
    const head = `case`.padEnd(w0) + cols.map(([n], j) => pad(n, widths[j])).join('')
        + pad(DELTA_LABEL[dkey] || `Δ ${dkey}`, dw) + '  verdict'
    const body = rows.map((r, i) => {
        const d = deltas[i]
        // the verdict, and why when it is not a pass or a plain INFO (those say it in the JSON)
        const v = r.verdict, why = v && v.status !== V.PASS && v.status !== V.INFO ? `  ${v.why}` : ''
        const says = v ? `  ${v.status.padEnd(5)}${why}` : ''
        return pad(r.case, w0, true)
            + cells[i].map((c, j) => pad(c, widths[j])).join('')
            + pad(d, dw) + says + (r.shaky ? '   QUEUE DEEP -- raise secs' : '')
            + (r.skipped ? `   NOT RUN: ${r.skipped}` : '') + (r.stopped ? '   STOPPED part way: the numbers it had' : '')
    }).map(line => line.trimEnd())

    const L = []
    L.push(`=== ${test.id} · ${test.title} ${'='.repeat(Math.max(0, 62 - test.id.length - test.title.length))}`)
    L.push(ENV())
    L.push(test.kind === 'image'
        ? `image test · ${test.samples} samples · loop paused · true mean`
        : test.kind === 'optics'
        ? `optics test · ${test.rays ?? 100000} rays x ${test.batches ?? 4} batches unless a row says otherwise · loop paused`
        : test.kind === 'bench'
        ? `benchmark · ${test.size.width}x${test.size.height} offscreen (the view's size above plays no part) · one sample per trace, each awaited, wall clock`
          + ` · warm-up >= ${test.warmup.samples} samples and ${test.warmup.ms / 1000} s (discarded)`
          + ` · timed >= ${test.timed.samples} samples and ${test.timed.ms / 1000} s, at most ${test.timed.max}`
          + ` · settings: schema defaults, then the scene's environment, then the row's change`
        : `cost test · ${test.secs || 5}s per case · loop running`)
    if (test.kind === 'bench') {
        // where and when it ran: a benchmark is compared across machines and days
        try { L.push(`browser: ${navigator.userAgent}`) } catch { }
        L.push(`date: ${new Date().toISOString()}`)
    }
    if (rows.length) L.push(`verdict${done ? '' : ' so far'}: ${V.summarize(verdict)}`)
    // a no-op since 0.10.0 (the budget is always the worst case); still said, so a report reads as the row asked
    L.push('')
    L.push(head)
    L.push(...body)
    // an empty kernel column says why, once (a device without timestamp-query, a readback that failed)
    const why = [...new Set(rows.map(r => r.kernelsNote).filter(Boolean))]
    if (why.length) L.push(`gpu ms, march, surface, shade, occlude: none -- ${why.join('; ')}`)
    if (test.note) { L.push(''); L.push(test.note.replace(/\s+/g, ' ')) }
    if (rows.some(r => r.shaky)) L.push('\nSome windows never reached steady state -- rerun with a longer secs.')
    /* WHERE THE RUN STOPPED, and why (runwatch.js): the GPU lost, or a step past its time */
    if (stopped) {
        L.push('')
        L.push(`STOPPED at row ${stopped.row ?? '-'} of ${stopped.of}${stopped.label ? ` (${stopped.label})` : ''}: ${stopped.why}.`)
        L.push(`The rows above it ran to their end${rows.some(r => r.stopped) ? '; the last is what its row had measured when it stopped' : ''}; the rows after it did not run.`
            + (stopped.lost ? ' The GPU is gone until the page is reloaded. After a reload the rows that did not run can be run on their own from the console (BENCH.run, BENCH.scaling.run, BENCH.scenedata.run, numbered as in the whole test).' : ''))
    }
    if (done) {
        L.push('')
        L.push(`JSON (${(elapsedMs / 1000).toFixed(1)}s):`)
        const where = test.kind === 'bench'
            ? { size: test.size, browser: (() => { try { return navigator.userAgent } catch { return null } })(), date: new Date().toISOString() }
            : {}
        L.push(JSON.stringify({ test: test.id, env: ENV(), ...where, ...(stopped ? { stopped } : {}), verdict, rows }, null, 1))
    } else {
        L.push('')
        L.push('...running')
    }
    return L.join('\n')
}

/** THE RUN'S SUMMARY: one line a test, its verdict and its counts, and under it each row that did not pass and why.
 *  `of`: how many tests the run has, so a run in progress says how far it is. Exported for verdict.test.mjs. */
export function summaryTable(results, of = results.length) {
    const L = [`=== SUMMARY · ${results.length} of ${of} tests ${'='.repeat(40)}`]
    const w = Math.max(4, ...results.map(x => x.test.id.length))
    const totals = { pass: 0, check: 0, fail: 0, info: 0, void: 0 }
    for (const { test, rows, verdict } of results) {
        for (const k of Object.keys(totals)) totals[k] += verdict.counts[k]
        L.push(`${test.id.padEnd(w)}  ${V.summarize(verdict)}`)
        const not = rows.map((r, i) => [i, r]).filter(([, r]) => r.verdict && r.verdict.status !== V.PASS && r.verdict.status !== V.INFO)
        // every row out for one reason (emitters on a scene with none): once, not once a row
        if (not.length > 1 && not.every(([, r]) => r.verdict.status === not[0][1].verdict.status && r.verdict.why === not[0][1].verdict.why))
            L.push(`${''.padEnd(w)}    rows ${not.map(([i]) => i + 1).join(', ')} ${not[0][1].verdict.status}: ${not[0][1].verdict.why}`)
        else for (const [i, r] of not) L.push(`${''.padEnd(w)}    row ${i + 1} ${r.verdict.status}: ${r.case} -- ${r.verdict.why}`)
    }
    if (results.length) L.push(`${'all'.padEnd(w)}  ${V.summarize({ status: V.worst(results.map(x => ({ status: x.verdict.status, why: '' }))).status, counts: totals })}`)
    return L.join('\n')
}

//======================================================================================================================
// THE POPUP
//
// Plain DOM on purpose. lib/guistuff has createPopupPane, but it installs an outside-click-to-
// close handler -- hostile to a panel whose whole purpose is selecting text out of it. A fixed
// div with a readonly textarea, Copy and Close is less code and has no surprises.
//======================================================================================================================

let POP = null

export function showReport(title, text) {
    if (!POP) {
        const d = document.createElement('div')
        Object.assign(d.style, {
            position: 'fixed', right: '16px', bottom: '16px', width: 'min(760px, 92vw)',
            maxHeight: '70vh', background: '#14171a', color: '#e6e6e6',
            border: '1px solid #3a4046', borderRadius: '6px', zIndex: '10000',
            display: 'flex', flexDirection: 'column', font: '12px/1.4 monospace',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        })
        const bar = document.createElement('div')
        Object.assign(bar.style, {
            display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px',
            borderBottom: '1px solid #3a4046',
        })
        const h = document.createElement('span')
        h.style.flex = '1'
        const mkbtn = label => {
            const b = document.createElement('button')
            b.textContent = label
            Object.assign(b.style, {
                font: 'inherit', background: '#2a3138', color: '#e6e6e6',
                border: '1px solid #3a4046', borderRadius: '3px', padding: '2px 10px',
                cursor: 'pointer',
            })
            return b
        }
        const copy = mkbtn('Copy'), close = mkbtn('Close')
        const ta = document.createElement('textarea')
        ta.readOnly = true
        Object.assign(ta.style, {
            flex: '1', minHeight: '260px', background: 'transparent', color: 'inherit',
            border: 'none', outline: 'none', resize: 'none', padding: '8px',
            font: 'inherit', whiteSpace: 'pre', overflow: 'auto',
        })
        copy.onclick = async () => {
            try { await navigator.clipboard.writeText(ta.value); copy.textContent = 'Copied' }
            catch { ta.select() ; copy.textContent = 'Press Ctrl+C' }
            setTimeout(() => (copy.textContent = 'Copy'), 1500)
        }
        close.onclick = () => { d.style.display = 'none' }
        bar.append(h, copy, close)
        d.append(bar, ta)
        document.body.appendChild(d)
        POP = { d, h, ta }
    }
    POP.d.style.display = 'flex'
    POP.h.textContent = title
    POP.ta.value = text
    return POP
}

//======================================================================================================================
// WIRING
//======================================================================================================================

/** Add a Tests folder to `menu`: Run all, then a folder a group (GROUPS), each its own Run all first and its tests in
 *  order -- a test on the scene shown says so. */
export function installTestMenu(menu, ctx) {
    const bench = makeTestBench(ctx)
    const folder = menu.addFolder({ title: 'Tests', expanded: false })
    let busy = false

    const guard = (title, fn) => async () => {
        if (busy) { console.warn('[tests] a test is already running'); return }
        busy = true
        showReport(title, 'starting...')
        try {
            const { text } = await fn(s => showReport(title, s))
            showReport(title, text)
        } catch (e) {
            console.error('[tests]', e)
            showReport(title, `FAILED: ${e && e.stack || e}\n\nThe renderer has been restored.`)
        } finally { busy = false }
    }
    // the mark beside the id, where a narrow panel does not cut it off with the title's end
    const buttonTitle = t => `${t.id}${onSceneShown(t) ? ' (your scene)' : ''} — ${t.title}`
    const byId = new Map(TESTS.map(t => [t.id, t]))

    folder.addButton({ title: `Run all (${GROUPS.filter(g => g.inRunAll).length} groups, not ${GROUPS.filter(g => !g.inRunAll).map(g => g.title).join(' or ')})` })
        .on('click', guard('all tests', p => bench.runAll(undefined, p)))
    const folders = new Map()
    for (const g of GROUPS) {
        const f = folder.addFolder({ title: g.title, expanded: false })
        folders.set(g.id, f)
        const tests = g.ids.map(id => byId.get(id))
        if (tests.length) f.addButton({ title: `Run all — ${g.title}` }).on('click', guard(g.title, p => bench.runAll(tests, p)))
        for (const t of tests) f.addButton({ title: buttonTitle(t) }).on('click', guard(t.id, p => bench.run(t, p)))
    }

    /* A HOST'S OWN TEST, as a button here: one whose scenes this library cannot make -- the benchmark's
       are builder documents (bench), and the builder lives in a project this module
       does not import. `prepare()` builds the test when the button is pressed, so nothing is fetched or
       generated at start-up. In its group's folder (the benchmarks' unless it names one), after the group's own
       tests, and in no Run all: a benchmark is minutes, and a question of its own. */
    bench.addTest = ({ id, title, prepare, group = 'benchmarks' }) => {
        const f = folders.get(group) ?? folders.get('benchmarks')
        f.addButton({ title: `${id} — ${title}` })
            .on('click', guard(id, async p => bench.run(await prepare(), p)))
    }

    window.RTTESTS = bench      // ...and from the console, for a one-off case list
    return bench
}
