//======================================================================================================================
// THE THIN LENS IN THE KERNELS, on a real WebGPU in node. Run: node lib/pathtracer/core/test/lens.gpu.mjs
//
// What 0.43.0 put in the shaders (core/lens.js), compiled by Dawn (Tint), against the JS mirror that lens.test.mjs holds
// to the measurement:
//   - genrays itself: each ray from a point of the lens's disc, crossing the pinhole's ray of the same jitter at the
//     focus plane, that point's picture inside the ray's pixel; the disc uniform in area; a radius of 0 the pinhole's
//     ray from camPos, bit for bit;
//   - lensStep, the lens's class moved on by an event, for photons and camera paths, against its JS transcription,
//     every other bit of the tag kept;
//   - lensHit, a photon's segment against the disc: its pixel and Phi / (A_px A_L cos^4) where it crosses, and nothing
//     for a segment that ends short of the lens, a photon not armed, out of air, going away, beside the disc, the Optics
//     page's own rays, a camera path, a probe -- nor at all with no aperture, in the illuminance view, a fast mode, on
//     the last pass or for an orthographic camera;
//   - ltConnect through the lens: a shadow ray aimed at a point of the disc, the pixel that point's ray lands on, and
//     flux f |n.v| dist / (z^3 A_px) measured from that point;
//   - a hit shaded in prog_shade's own phases (pathBegin, pathPrelude, pathMiddle, pathEnd): a sun's photon walking on
//     from D, armed by the glass after it, ended by what follows; connecting before D and not after; a camera path's
//     field kept through the write of its first surface's tag; a light's photon; the Optics page's own rays untouched;
//     and with no aperture, every photon ending at its first scatter as before, no field written.
//
// No picture: what the lens looks like is the user's to judge (CLAUDE.md). OPTIONAL, AND LOUD ABOUT IT: the `webgpu`
// package (npm i -g webgpu) and a Vulkan driver (lavapipe: apt-get install mesa-vulkan-drivers).
//======================================================================================================================
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(lens GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const { SHADE_PRELUDE } = await import('../scene_api.js')
const { MATERIALS_PBR } = await import('../materials_pbr.js')
const { FACE_TABLE, PROCESSING, LEARN_WORDS } = await import('../tracebasics.js')
const { counterstruct } = await import('../wavefront.js')
const { MF_WORDS } = await import('../microfacet.js')
const { ComputeUniformTypes } = await import('../uniforms.schema.js')
const { genrays_prog, raygenTiles } = await import('../genrays.js')
const { engineCamera } = await import('../units.js')
const { lensImage, lensWeight } = await import('../lens.js')
const { CAMERA } = await import('../../../camera.js')
const { WEBGPU } = await import('../../../tinywebgpu/src/tinywebgpu.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../../wgsl_shorthand.js')

Object.assign(globalThis, webgpu.globals)
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])            // kept: the Dawn instance must outlive the device (scenedata.gpu.mjs)
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
    WG.defines = defines(TOKENS, SHORT_TOKENS)
} catch (e) {
    console.log(`(lens GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const rng = (seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 })(777)

// THE CAMERA: the real lib/camera.js, turned and off the origin, through engineCamera as the page hands it over
const W = 48, H = 32, R = 0.05, FOCUS = 2.5
const cam = CAMERA({ aspect: W / H, fov: 50, near: 0.01, far: 4000, up: [0, 0, 1] })
cam.set({ mode: 'orbit', azimuth: 30, elevation: 70, distance: 4, target: [0.5, -0.3, 0.2] })
const camera = (aperture, focus) => {
    cam.set({ aperture, focus })
    const E = engineCamera(cam.getUniforms(), 0, 1)
    const V = E.invView
    return { E, pos: E.camPos.slice(0, 3), right: [V[0], V[1], V[2]], up: [V[4], V[5], V[6]], fwd: [V[8], V[9], V[10]],
             fx: E.invProjection[0], fy: E.invProjection[5], F: E.camLens[1], R: E.camLens[0] }
}
const buf = n => WG.createStorageBuffer(Math.max(n, 256))

// ---- GENRAYS ----------------------------------------------------------------------------------------------------
{
    const N = W * H, T = raygenTiles(N, W, H)
    const gen = await genrays_prog(WG, 64)
    await gen.ready                                     // an async pipeline: compiled before it binds (tinywebgpu)
    const rays = buf(112 * N)
    gen.setResources({ rayBuffer0: rays.b })
    const run = async C => {
        gen.uniforms = { seed: [3, 5, 7, 11], rayFirst: 0, rayBatch: N, res: [W, H], ...T, camtype: 0,
                         camPos: C.E.camPos, invView: C.E.invView, invProjection: C.E.invProjection, camLens: C.E.camLens }
        gen.dispatch(Math.ceil(N / 64), 1, 1)
        const f = await rays.r(Float32Array), u = new Uint32Array(f.buffer)
        return Array.from({ length: N }, (_, i) => ({ o: [f[28 * i], f[28 * i + 1], f[28 * i + 2]],
            d: [f[28 * i + 4], f[28 * i + 5], f[28 * i + 6]], pix: u[28 * i + 20] }))
    }
    const C0 = camera(0, FOCUS), pin = await run(C0)
    const C = camera(2 * R, FOCUS), lens = await run(C)
    ok('the camera hands the kernels the lens in metres: radius and focus', Math.abs(C.R - R) < 1e-7 && Math.abs(C.F - FOCUS) < 1e-6, `${C.R} ${C.F}`)
    ok('a radius of 0: every ray from camPos, as before the lens', pin.every(r => r.o.every((v, k) => v === Math.fround(C0.pos[k]))))
    let worstPlane = 0, outside = 0, m2 = 0, worstFocus = 0, worstPix = 0, samePix = true
    lens.forEach((r, i) => {
        const off = r.o.map((v, k) => v - C.pos[k])
        worstPlane = Math.max(worstPlane, Math.abs(dot(off, C.fwd)))
        const q = dot(off, off); m2 += q / N; if (q > R * R * (1 + 1e-4)) outside++
        // the focus plane's point, and the pinhole's ray of the same jitter (the same random numbers) through it
        const at = (ray) => { const t = FOCUS / -dot(ray.d, C.fwd); return ray.o.map((v, k) => v + ray.d[k] * t) }
        const Pf = at(r), P0 = at(pin[i])
        worstFocus = Math.max(worstFocus, Math.hypot(Pf[0] - P0[0], Pf[1] - P0[1], Pf[2] - P0[2]))
        // that point's picture is in the ray's pixel
        const xy = lensImage(r.o, r.d, { ...C, F: FOCUS })
        const px = (xy[0] + 1) / 2 * W, py = (xy[1] + 1) / 2 * H
        const ix = r.pix % W, iy = Math.floor(r.pix / W)
        worstPix = Math.max(worstPix, Math.max(ix - px, px - ix - 1, 0), Math.max(iy - py, py - iy - 1, 0))
        samePix &&= r.pix === pin[i].pix
    })
    ok('with a lens: every ray starts on the lens\'s plane', worstPlane < 1e-5, `${worstPlane}`)
    ok('...inside its disc', outside === 0, `${outside} of ${N} outside`)
    ok('...uniform in area: mean r^2 = R^2 / 2 within 5 %', Math.abs(m2 / (R * R / 2) - 1) < 0.05, `${m2 / (R * R / 2)}`)
    ok('...and crosses the pinhole\'s ray of its jitter at the focus plane (within 2e-6 m)', worstFocus < 2e-6, `${worstFocus}`)
    ok('...whose picture is in the ray\'s own pixel (within 1e-3 of one)', worstPix < 1e-3, `${worstPix}`)
    ok('...the pixel the pinhole\'s ray had', samePix)
}

// ---- LENSSTEP, LENSHIT, LTCONNECT -------------------------------------------------------------------------------
const TAG = { PHOTON: 1, CONN: 2, PASSED: 4, PROBE: 64, OPTIC: 128, LTALL: 256, LIGHTS: 1024 }
const EV = [1, 2, 3]                                   // EV_DELTA, EV_EVAL, EV_OTHER (tracebasics.js)
const CAM = 12, PH = 14, ONE = 1 << 16             // TAG_LENS_ONE (0.44.0): the manifold connection's part of the class
const field = (tag, s) => (tag >>> s) & 3
const withField = (tag, s, v) => ((tag & ~(3 << s)) | (v << s)) >>> 0
// the indices before and after an event the table tries: in air throughout, out of glass into air, within glass
const NCASES = [[1, 1], [1.5, 1], [1.5, 1.5]]
// lensStep transcribed (materials_pbr.js), TAG_LENS_ONE with it
function lensStepJS(tag, photon, bounces, ev, nIn, nOut) {
    const delta = ev === 1, ev2 = ev === 2
    if (photon) {
        const f = field(tag, PH)
        let g = 3, one = false
        if (f === 0) { if (delta) g = 0; else if (ev2 && (tag & TAG.PASSED)) g = 1 }
        else if ((f === 1 || f === 2) && delta) { g = 2; one = f === 1 && nIn > 1.001 && Math.abs(nOut - 1) <= 1e-3 }
        return (withField(tag & ~ONE, PH, g) | (one ? ONE : 0)) >>> 0
    }
    const f = field(tag, CAM)
    let g = 0, one = false
    if (bounces === 1) g = delta ? 1 : 0
    else if (f === 1) { g = delta ? 1 : ev2 ? 2 : 0; one = g === 2 && bounces === 2 && nIn > 1.001 }
    else if ((f === 2 || f === 3) && delta) { g = 3; one = !!(tag & ONE) }
    return (withField(tag & ~ONE, CAM, g) | (one ? ONE : 0)) >>> 0
}
const STEPS = []
for (const photon of [true, false]) for (const bounces of [1, 2]) for (let f = 0; f < 4; f++) for (const passed of [0, 1]) for (const ev of EV)
    for (const nc of [0, 1, 2]) for (const oneIn of [0, 1]) {
        const base = (0xABC00000 | TAG.LIGHTS | (photon ? TAG.PHOTON : 0) | (passed ? TAG.PASSED : 0) | (oneIn ? ONE : 0)) >>> 0
        STEPS.push({ photon, bounces, ev, nc, tag: withField(base, photon ? PH : CAM, f) })
    }

// the lensHit cases: a photon whose segment crosses the lens's plane at Y, with what to expect
const C = camera(2 * R, FOCUS)
const apx = 4 * C.fx * C.fy / (W * H)
const toward = (Y, tilt) => {   // a direction arriving at Y from the scene: mostly +fwd, tilted
    const d = [0, 1, 2].map(k => C.fwd[k] + C.right[k] * tilt[0] + C.up[k] * tilt[1]), l = Math.hypot(...d)
    return d.map(v => v / l)
}
const lensAt = (a, b) => [0, 1, 2].map(k => C.pos[k] + C.right[k] * a + C.up[k] * b)
const HITS = []
const hit = (name, o) => HITS.push({ name, Y: lensAt(0.6 * R, -0.3 * R), tilt: [0.15, -0.1], back: 1.5, seg: 2, n: 1, field: 2,
                                     tag: TAG.PHOTON | TAG.PASSED, escaped: 0, valid: false, ...o })
hit('an armed photon crossing the disc', { valid: true })
hit('...a light\'s photon (TAG_LTALL)', { tag: TAG.PHOTON | TAG.OPTIC | TAG.LTALL, valid: true })
hit('...steeply, near the rim', { Y: lensAt(-0.05 * R, 0.97 * R), tilt: [-0.3, 0.25], valid: true })
hit('...one that escaped short of the lens: the segment goes on', { seg: 1, escaped: 1, valid: true })
hit('a segment that ends short of the lens', { seg: 1 })
hit('a photon not yet at D', { field: 0 })
hit('...at D, no delta since', { field: 1 })
hit('...out of the class', { field: 3 })
hit('not in air', { n: 1.5 })
hit('beside the disc', { Y: lensAt(1.1 * R, 0) })
hit('going away from the camera', { tilt: [0.15, -0.1], away: true })
hit('the Optics page\'s own ray', { tag: TAG.PHOTON | TAG.OPTIC })
// the manifold connection's part (0.44.0): the lens's while the manifold is off, the manifold's while on (below)
hit('an armed photon out of glass by one refraction, the manifold off', { tag: TAG.PHOTON | TAG.PASSED | ONE, valid: true })
hit('a camera path', { tag: 0 })
hit('a probe', { tag: TAG.PHOTON | TAG.PROBE })
hit('off the picture', { tilt: [1.4, 0] })
for (const h of HITS) {
    h.d = toward(h.Y, h.tilt)
    h.start = h.Y.map((v, k) => v - h.d[k] * h.back)
    if (h.away) h.d = h.d.map(v => -v)              // from the same start, the other way
    h.tag = withField(h.tag, PH, h.field)
}
// ltConnect: a photon at P on a diffuse surface facing the camera, many threads each its own lens point
const CONN_N = 4096
const P = [0, 1, 2].map(k => C.pos[k] - C.fwd[k] * 1.7 + C.right[k] * 0.2 + C.up[k] * 0.1)
const NRM = (() => { const d = [0, 1, 2].map(k => C.pos[k] - P[k] + C.up[k] * 0.4), l = Math.hypot(...d); return d.map(v => v / l) })()
const L_IN = (() => { const d = [0.3, -0.2, -1], l = Math.hypot(...d); return d.map(v => v / l) })()   // the photon's direction

// a hit shaded in prog_shade's phases: [what, tag, bounces before it, 0 a diffuse surface / 1 smooth glass]
const SUN = TAG.PHOTON | TAG.PASSED
const SHADES = [
    ['a sun\'s photon after glass, at a diffuse floor: D', SUN, 1, 0],
    ['...straight from the sun, at the floor', TAG.PHOTON, 0, 0],
    ['...at D, then glass', withField(SUN, PH, 1), 2, 1],
    ['...armed, then glass again', withField(SUN, PH, 2), 3, 1],
    ['...armed, then a diffuse wall', withField(SUN, PH, 2), 3, 0],
    ['a camera path at glass, its first surface', TAG.LIGHTS, 0, 1],
    ['...a delta from the eye, then the floor', withField(0, CAM, 1), 1, 0],
    ['...then glass after the floor', withField(0, CAM, 2), 2, 1],
    ['a light\'s photon at glass', TAG.PHOTON | TAG.OPTIC | TAG.LTALL, 0, 1],
    ['...then the floor', TAG.PHOTON | TAG.OPTIC | TAG.LTALL | TAG.PASSED, 1, 0],
    ['the Optics page\'s ray at glass', TAG.PHOTON | TAG.OPTIC, 0, 1],
]
const SHADE_N = 64                                     // each case on 64 threads: the glass's pick is random

const IN = { steps: 0, hits: 2560, conn: 4096, shades: 6144 }
const OUT = { steps: 8192, hits: 9216, conn: 12288, shades: 12288 + 4096 * 16 }
OUT.owned = OUT.shades + SHADES.length * SHADE_N * 4
// lensOwned's tags: a camera path armed, armed by one refraction, a photon armed, a camera path at D
const OWNED = [withField(0, CAM, 3), withField(ONE, CAM, 3), withField(TAG.PHOTON, CAM, 3), withField(ONE, CAM, 2)]
const WORDS = OUT.owned + 16
const io = new Float32Array(WORDS), iu = new Uint32Array(io.buffer)
STEPS.forEach((s, i) => { iu[IN.steps + 4 * i] = s.tag; iu[IN.steps + 4 * i + 1] = s.photon ? 1 : 0; iu[IN.steps + 4 * i + 2] = s.bounces | (s.nc << 8); iu[IN.steps + 4 * i + 3] = s.ev })
HITS.forEach((h, i) => {
    const b = IN.hits + 16 * i
    io.set(h.start, b); io.set(h.d, b + 4); io[b + 8] = h.seg; io[b + 9] = h.n; iu[b + 10] = h.tag; iu[b + 11] = h.escaped
})
io.set(P, IN.conn); io.set(NRM, IN.conn + 4); io.set(L_IN, IN.conn + 8)
SHADES.forEach(([, tag, bounces, kind], i) => { iu[IN.shades + 4 * i] = tag; iu[IN.shades + 4 * i + 1] = bounces; iu[IN.shades + 4 * i + 2] = kind })

const prog = WG.makeCompute(`${SHADE_PRELUDE}${MATERIALS_PBR}${FACE_TABLE}${PROCESSING}`,
    /*wgsl*/`
    // every binding the text names reached from main, as tinywebgpu binds them (check-shaders pass two says why)
    if (gid.x == 0xffffffffu) {
        _ = &marchBuffer0; _ = &marchBuffer1; _ = &shadeBuffer; _ = &frame_u32; _ = &shadowBuffer0; _ = &shadowBuffer1;
        _ = &counters; _ = &learn; _ = UB.res;
    }
    let i = gid.x;
    if (gid.y == 0u) {
        if (i < ${STEPS.length}u) {
            let b = ${IN.steps}u + 4u * i;
            let packed = bitcast<u32>(io[b + 2u]);
            let nc = packed >> 8u;
            let nIn = select(1.5, 1.0, nc == 0u);
            let nOut = select(1.0, 1.5, nc == 2u);
            io[${OUT.steps}u + i] = bitcast<f32>(lensStep(bitcast<u32>(io[b]), bitcast<u32>(io[b + 1u]) != 0u,
                                                         packed & 255u, bitcast<u32>(io[b + 3u]), nIn, nOut));
        }
        return;
    }
    if (gid.y == 1u) {
        if (i >= ${HITS.length}u) { return; }
        let b = ${IN.hits}u + 16u * i;
        let start = VEC3(io[b], io[b + 1u], io[b + 2u]);
        let d = VEC3(io[b + 4u], io[b + 5u], io[b + 6u]);
        let seg = io[b + 8u];
        let n = io[b + 9u];
        var r = newRay(start + d * seg, d, VEC4(1.0), n);
        r.radiance = VEC3(2.0, 3.0, 4.0);
        r.beta = VEC3(0.5, 0.25, 0.125);
        r.vtxLtot = 5.0;
        r.ltot = 5.0 + seg * n;
        r.tag = bitcast<u32>(io[b + 10u]);
        let escaped = bitcast<u32>(io[b + 11u]) != 0u;
        r.state = select(RAY_ACTIVE, RAY_ESCAPED, escaped);
        lensHit(r, escaped);
        let o = ${OUT.hits}u + 16u * i;
        io[o] = select(0.0, 1.0, LENS_VALID);
        io[o + 1u] = bitcast<f32>(LENS_RAY.pix);
        io[o + 2u] = LENS_RAY.radiance.x; io[o + 3u] = LENS_RAY.radiance.y; io[o + 4u] = LENS_RAY.radiance.z;
        io[o + 5u] = LENS_RAY.pos.x; io[o + 6u] = LENS_RAY.pos.y; io[o + 7u] = LENS_RAY.pos.z;
        io[o + 8u] = bitcast<f32>(LENS_RAY.tag); io[o + 9u] = LENS_RAY.tmax;
        return;
    }
    if (gid.y == 4u) {
        if (i < ${OWNED.length}u) {
            let t = array<u32, ${OWNED.length}>(${OWNED.map(t => t + 'u').join(', ')});
            io[${OUT.owned}u + i] = select(0.0, 1.0, lensOwned(t[i]));
        }
        return;
    }
    if (gid.y == 3u) {
        // prog_shade's phases, in its order, with the surface kernel's answers handed in as it hands them
        let c = i / ${SHADE_N}u;
        if (c >= ${SHADES.length}u) { return; }
        SEED_uvec4(vec4<u32>(31u, 37u, 41u, 43u));
        SEED_u32(i);
        let b = ${IN.shades}u + 4u * c;
        let glass = bitcast<u32>(io[b + 2u]) == 1u;
        var r = newRay(VEC3(0.0, 0.0, 0.0), normalize(VEC3(0.3, 0.1, -1.0)), VEC4(1.0), 1.0);
        r.radiance = VEC3(1.0);
        r.tag = bitcast<u32>(io[b]);
        r.bounces = bitcast<u32>(io[b + 1u]);
        r.pix = 0xFFFFFFFFu;
        let h = Hit(r, VEC4(0.0, 0.0, 1.0, 1e-4), 1u, 0u, -1.0e7);
        var m = makeDiffuse(VEC3(0.8), 1.0);
        if (glass) { m = makeDefaultMaterial(); m.baseColor = VEC3(1.0); m.roughness = 0.0; m.metallic = 0.0; m.ior = 1.5; m.transmission = 1.0; m.specular = 0.5; }
        var st = pathBegin(h);
        st.nrm = VEC3(0.0, 0.0, 1.0);
        st = pathPrelude(st);
        st.m = m;
        st = pathMiddle(st);
        if (st.go && st.askMedium) { st.n1 = 1.5; st.mu1 = VEC3(0.0); st.v1 = 0.0; }
        let conn = NEE_VALID;
        let e = pathEnd(st);
        let o = ${OUT.shades}u + 4u * i;
        io[o] = bitcast<f32>(e.tag);
        io[o + 1u] = bitcast<f32>(e.state);
        io[o + 2u] = select(0.0, 1.0, conn);
        io[o + 3u] = bitcast<f32>(LAST_EVENT);
        return;
    }
    if (i >= ${CONN_N}u) { return; }
    SEED_uvec4(vec4<u32>(17u, 19u, 23u, 29u));
    SEED_u32(i);
    let P = VEC3(io[${IN.conn}u], io[${IN.conn + 1}u], io[${IN.conn + 2}u]);
    let nrm = VEC3(io[${IN.conn + 4}u], io[${IN.conn + 5}u], io[${IN.conn + 6}u]);
    let din = VEC3(io[${IN.conn + 8}u], io[${IN.conn + 9}u], io[${IN.conn + 10}u]);
    var r = newRay(P, din, VEC4(1.0), 1.0);
    r.radiance = VEC3(1.0, 2.0, 3.0);
    r.beta = VEC3(1.0);
    r.tag = TAG_PHOTON | TAG_PASSED;
    r.bounces = 2u;
    r.ltMis = 0.0;
    r.pix = 0xFFFFFFFFu;
    let m = makeDiffuse(VEC3(0.8), 1.0);
    NEE_VALID = false;
    ltConnect(r, m, nrm, vec4<u32>(0u));         // no manifold answer: the connection in air
    let o = ${OUT.conn}u + 16u * i;
    io[o] = select(0.0, 1.0, NEE_VALID);
    io[o + 1u] = bitcast<f32>(NEE_RAY.pix);
    io[o + 2u] = NEE_RAY.radiance.x; io[o + 3u] = NEE_RAY.radiance.y; io[o + 4u] = NEE_RAY.radiance.z;
    io[o + 5u] = NEE_RAY.pos.x; io[o + 6u] = NEE_RAY.pos.y; io[o + 7u] = NEE_RAY.pos.z;
    io[o + 8u] = NEE_RAY.dir.x; io[o + 9u] = NEE_RAY.dir.y; io[o + 10u] = NEE_RAY.dir.z;
    // the lobes it evaluated, from the point it aimed at: what the splat must carry
    let v = NEE_RAY.dir;
    let lb = makeLobes(nrm, v, m, 1.0 / max(m.ior, 1.0), 1.0, false);
    let f = lobesEval(lb, -din, LT_MIN_ALPHA);
    io[o + 11u] = f.x; io[o + 12u] = f.y; io[o + 13u] = f.z;
    `,
    ComputeUniformTypes,
    { marchBuffer0: 'array<Ray>', marchBuffer1: 'array<Ray>', shadeBuffer: 'array<ShadeItem>', frame_u32: 'array<atomic<u32>>',
      shadowBuffer0: 'array<Ray>', shadowBuffer1: 'array<Ray>', learn: 'array<atomic<u32>>', counters: counterstruct,
      io: 'array<f32>' },
    { wg: [64, 1, 1], async: false })
const ioBuf = buf(4 * WORDS)
prog.resources = { marchBuffer0: buf(112).b, marchBuffer1: buf(112).b, shadeBuffer: buf(288).b, frame_u32: buf(16).b,
    shadowBuffer0: buf(112).b, shadowBuffer1: buf(112).b, learn: buf(4 * (LEARN_WORDS + MF_WORDS)).b, counters: buf(64).b,
    io: ioBuf.b }
const runMain = async (over = {}) => {
    ioBuf.w(io)
    prog.uniforms = { res: [W, H], camtype: 0, camPos: C.E.camPos, invView: C.E.invView, invProjection: C.E.invProjection,
                      camLens: C.E.camLens, measureMode: 0, renderMode: 0, lastpass: 0, maxbounce: 10, rr: 0, manifold: 0, ...over }   // every one named: a write merges (toolkit layout.test)
    prog.dispatch(CONN_N / 64, 5, 1)
    return await ioBuf.r(Float32Array)
}
const g = await runMain(), gu = new Uint32Array(g.buffer)

// lensStep
const wrong = STEPS.filter((s, i) => gu[OUT.steps + i] !== lensStepJS(s.tag, s.photon, s.bounces, s.ev, ...NCASES[s.nc]))
ok(`lensStep moves the class as written, ${STEPS.length} cases, the rest of the tag kept`, wrong.length === 0,
    wrong.slice(0, 3).map(s => JSON.stringify(s)).join(' '))
const at = (photon, bounces, f, passed, ev, nc = 0, oneIn = 0) => gu[OUT.steps + STEPS.findIndex(s => s.photon === photon && s.bounces === bounces
    && field(s.tag, photon ? PH : CAM) === f && !!(s.tag & TAG.PASSED) === !!passed && s.ev === ev && s.nc === nc && !!(s.tag & ONE) === !!oneIn)]
ok('a photon after a delta is at D where it scatters by an evaluable lobe', field(at(true, 2, 0, 1, 2), PH) === 1)
ok('...not straight from its source (no delta first): out', field(at(true, 2, 0, 0, 2), PH) === 3)
ok('...armed by the delta after D, and stays armed through more', field(at(true, 2, 1, 1, 1), PH) === 2 && field(at(true, 2, 2, 1, 1), PH) === 2)
ok('...out at anything else after D', field(at(true, 2, 2, 1, 2), PH) === 3 && field(at(true, 2, 1, 1, 3), PH) === 3)
ok('a camera path: its first surface a delta, then D, then a delta: armed', field(at(false, 1, 0, 0, 1), CAM) === 1
    && field(at(false, 2, 1, 0, 2), CAM) === 2 && field(at(false, 2, 2, 0, 1), CAM) === 3)
ok('...its first surface evaluable: never in the class', field(at(false, 1, 0, 0, 2), CAM) === 0)
// TAG_LENS_ONE (0.44.0), the manifold's part of the class
ok('a photon at D refracting out of glass into air: armed, the manifold\'s part', (at(true, 2, 1, 1, 1, 1) & ONE) !== 0)
ok('...staying in glass, or in air all along: not', (at(true, 2, 1, 1, 1, 2) & ONE) === 0 && (at(true, 2, 1, 1, 1, 0) & ONE) === 0)
ok('...a second delta: not any more', (at(true, 2, 2, 1, 1, 1, 1) & ONE) === 0)
ok('a camera path reaching D as its second surface, inside glass: the manifold\'s part', (at(false, 2, 1, 0, 2, 2) & ONE) !== 0)
ok('...reaching it in air: not', (at(false, 2, 1, 0, 2, 0) & ONE) === 0)
ok('...kept while armed, through deltas', (at(false, 2, 2, 0, 1, 0, 1) & ONE) !== 0 && (at(false, 2, 3, 0, 1, 0, 1) & ONE) !== 0)
ok('...gone when it leaves the class', (at(false, 2, 3, 0, 2, 0, 1) & ONE) === 0 && field(at(false, 2, 3, 0, 2, 0, 1), CAM) === 0)

// lensHit
HITS.forEach((h, i) => {
    const o = OUT.hits + 16 * i, valid = g[o] === 1
    if (!h.valid) return ok(`lensHit: ${h.name} -- nothing`, !valid)
    const c = dot(h.d, C.fwd)
    const xy = lensImage(h.Y, h.d.map(v => -v), C)
    const pix = Math.min(W - 1, Math.floor((xy[0] + 1) / 2 * W)) + W * Math.min(H - 1, Math.floor((xy[1] + 1) / 2 * H))
    const want = [2 * 0.5, 3 * 0.25, 4 * 0.125].map(v => v * lensWeight(R, c, apx))
    const got = [g[o + 2], g[o + 3], g[o + 4]]
    ok(`lensHit: ${h.name} -- deposited`, valid)
    ok(`...on the pixel its ray from that point of the lens lands on`, gu[o + 1] === pix, `${gu[o + 1]} against ${pix} (${xy})`)
    ok(`...Phi / (A_px A_L cos^4) of it, within 1e-5`, got.every((v, k) => Math.abs(v / want[k] - 1) < 1e-5), `${got} against ${want}`)
    ok(`...a connection ray from the point it crossed, ended before it marches`, Math.hypot(g[o + 5] - h.Y[0], g[o + 6] - h.Y[1], g[o + 7] - h.Y[2]) < 1e-5
        && gu[o + 8] === TAG.CONN && g[o + 9] < 0, `${[...g.slice(o + 5, o + 10)]}`)
})
for (const [what, over] of [['no aperture', { camLens: [0, FOCUS, 0, 0] }], ['the illuminance view', { measureMode: 1 }],
                            ['Draft', { renderMode: 1 }], ['the last pass', { lastpass: 1 }], ['an orthographic camera', { camtype: 1 }]]) {
    const h = await runMain(over)
    ok(`lensHit: nothing with ${what}`, HITS.every((_, i) => h[OUT.hits + 16 * i] === 0))
}
{
    const h = await runMain({ manifold: 1 }), one = HITS.findIndex(x => x.tag & ONE), plain = 0
    ok('lensHit with the manifold on: the one refraction\'s photon left to it, the rest still the lens\'s',
        h[OUT.hits + 16 * one] === 0 && h[OUT.hits + 16 * plain] === 1)
    const m0 = await runMain({ manifold: 1, camLens: [0, FOCUS, 0, 0] })
    ok('...and with the manifold on and no aperture, no lens hit at all', HITS.every((_, i) => m0[OUT.hits + 16 * i] === 0))
}
// lensOwned (0.44.0): what the camera's side leaves to the photons, by what owns the class
for (const [what, over, want] of [['a lens, the manifold off', {}, [1, 1, 0, 0]], ['a lens and the manifold', { manifold: 1 }, [1, 1, 0, 0]],
        ['no lens, the manifold on', { manifold: 1, camLens: [0, FOCUS, 0, 0] }, [0, 1, 0, 0]],
        ['no lens, the manifold off', { camLens: [0, FOCUS, 0, 0] }, [0, 0, 0, 0]], ['the illuminance view', { manifold: 1, measureMode: 1 }, [0, 0, 0, 0]]]) {
    const h = await runMain(over)
    const got = OWNED.map((_, i) => h[OUT.owned + i])
    ok(`lensOwned with ${what}: armed paths ${want.slice(0, 2).join(', ')} (all of it, its one refraction's part), never a photon's or one at D`,
        got.every((v, i) => v === want[i]), got.join(' '))
}

// ltConnect through the lens
{
    let n = 0, worstPix = 0, worstW = 0, outside = 0, m2 = 0, pixes = new Set()
    for (let i = 0; i < CONN_N; i++) {
        const o = OUT.conn + 16 * i
        if (g[o] !== 1) continue
        n++
        const O = [g[o + 5], g[o + 6], g[o + 7]], d = [g[o + 8], g[o + 9], g[o + 10]]
        // the point it aims at: its line across the lens's plane
        const t = dot([0, 1, 2].map(k => C.pos[k] - O[k]), C.fwd) / dot(d, C.fwd)
        const Y = O.map((v, k) => v + d[k] * t), off = Y.map((v, k) => v - C.pos[k])
        const q = dot(off, off); m2 += q; if (q > R * R * (1 + 1e-3)) outside++
        const v = Y.map((x, k) => x - P[k]), dist = Math.hypot(...v), z = dot(v, C.fwd)
        const vn = v.map(x => x / dist)
        const xy = lensImage(Y, vn.map(x => -x), C)
        const pix = Math.min(W - 1, Math.floor((xy[0] + 1) / 2 * W)) + W * Math.min(H - 1, Math.floor((xy[1] + 1) / 2 * H))
        if (gu[o + 1] !== pix) worstPix++
        pixes.add(gu[o + 1])
        const G = Math.abs(dot(NRM, vn)) * dist / (z * z * z)
        const want = [1, 2, 3].map((r, k) => r * g[o + 11 + k] * G / apx)
        worstW = Math.max(worstW, ...want.map((w, k) => Math.abs(g[o + 2 + k] / w - 1)))
    }
    ok(`ltConnect through the lens: every one of ${CONN_N} photons connects`, n === CONN_N, `${n}`)
    ok('...each aimed at a point of the disc', outside === 0, `${outside} outside`)
    ok('...spread over it uniformly: mean r^2 = R^2 / 2 within 5 %', Math.abs(m2 / n / (R * R / 2) - 1) < 0.05, `${m2 / n / (R * R / 2)}`)
    ok('...each on the pixel that point\'s ray lands on', worstPix === 0, `${worstPix} elsewhere`)
    ok('...P out of focus (1.7 against 2.5): its light spread over more than one pixel', pixes.size > 1, `${pixes.size}`)
    ok('...carrying flux f |n.v| dist / (z^3 A_px) from that point, within 1e-4', worstW < 1e-4, `${worstW}`)
}

// the shade's phases
{
    const RAY_ACTIVE = 0
    const readShades = h => {
        const u = new Uint32Array(h.buffer)
        return SHADES.map((_, c) => Array.from({ length: SHADE_N }, (_, j) => {
            const o = OUT.shades + 4 * (c * SHADE_N + j)
            return { tag: u[o], state: u[o + 1], conn: h[o + 2] === 1, ev: u[o + 3] }
        }))
    }
    const on = readShades(g), off = readShades(await runMain({ camLens: [0, FOCUS, 0, 0] }))
    const every = (c, f) => on[c].every(f)
    const active = x => x.state === RAY_ACTIVE
    ok('the run reached a state: every case drew an event', on.every(c => c.every(x => x.ev >= 1 && x.ev <= 3)), JSON.stringify(on.map(c => c[0])))
    ok(`${SHADES[0][0]}: connects there, walks on, at D`, every(0, x => x.conn && active(x) && field(x.tag, PH) === 1))
    ok(`${SHADES[1][0]}: no connection (NEE counts it), ends, out of the class`, every(1, x => !x.conn && !active(x) && field(x.tag, PH) === 3))
    ok(`${SHADES[2][0]}: connects no more, walks on, armed`, every(2, x => !x.conn && active(x) && field(x.tag, PH) === 2 && (x.tag & TAG.PASSED)))
    ok(`${SHADES[3][0]}: walks on, still armed`, every(3, x => !x.conn && active(x) && field(x.tag, PH) === 2))
    ok(`${SHADES[4][0]}: no connection, ends`, every(4, x => !x.conn && !active(x) && field(x.tag, PH) === 3))
    ok(`${SHADES[5][0]}: its field 1 outlives the write of its first surface's tag, CLS_LIGHTS cleared there as before`,
        every(5, x => field(x.tag, CAM) === 1 && !(x.tag & TAG.LIGHTS)), on[5].slice(0, 3).map(x => x.tag.toString(16)).join(' '))
    ok(`${SHADES[6][0]}: at D (2)`, every(6, x => field(x.tag, CAM) === 2))
    ok(`${SHADES[7][0]}: armed (3) -- the light it meets now is the photons'`, every(7, x => field(x.tag, CAM) === 3))
    ok(`${SHADES[8][0]}: TAG_PASSED, not yet at D, walking on`, every(8, x => (x.tag & TAG.PASSED) && field(x.tag, PH) === 0 && active(x)))
    ok(`${SHADES[9][0]}: at D, and connected there as it always does`, every(9, x => field(x.tag, PH) === 1 && x.conn))
    ok(`${SHADES[10][0]}: no field, no TAG_PASSED -- it lights nothing`, every(10, x => field(x.tag, PH) === 0 && field(x.tag, CAM) === 0 && !(x.tag & TAG.PASSED)))
    ok('with no aperture: a sun\'s photon ends at its first scatter, as before the lens', off[0].every(x => x.conn && !active(x)))
    ok('...and no field is moved, photon\'s or camera path\'s', off.every((c, i) => c.every(x => field(x.tag, PH) === field(SHADES[i][1], PH)
        && field(x.tag, CAM) === field(SHADES[i][1], CAM))))
}

console.log(`lens GPU: ${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
