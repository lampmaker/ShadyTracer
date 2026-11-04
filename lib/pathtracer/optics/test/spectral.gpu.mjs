// node lib/pathtracer/optics/test/spectral.gpu.mjs
//
// THE SPECTRAL OPTICS TRACE ON DAWN (0.next; optics/spectral.js, roadmap/LIGHT_MODEL.md S2): the real optics module
// (optics/index.js) and its kernels, compiled as a scene with its `spectral` feature on compiles them, over a builder
// scene, traced on a WebGPU in node. No picture: what the page shows is the user's to judge (CLAUDE.md). It checks
//   - the pieces against their JS mirrors: the wavelength draw (spLambda: the CDF of x + y + z), a ray's three, the
//     basis a material's RGB becomes a spectrum by;
//   - a white LED by its spectrum onto a detector: what the detector reads is the spectrum's own xy (its luminance per
//     ray 1 on average, every flux figure as the colour trace's), and every hit carries its three wavelengths and their
//     weights, which add up to the hit's XYZ;
//   - the same light through a dichroic plate (a coating reflecting below 500 nm, on both faces): the light that reaches
//     the detector is its spectrum times the plate's transmission at each wavelength, T^2 / (1 - R^2), integrated --
//     read within the trace's error, where the colour trace's per-channel average misses it (core/test/spectralnoise
//     says by how much);
//   - a dispersive slab: rays collapse to one wavelength there, and white light through it at normal incidence stays
//     the light's own colour on average;
//   - the colour trace untouched: the same scene with the feature off reads its RGB light's chromaticity exactly.
// OPTIONAL, AND LOUD ABOUT IT: the `webgpu` package (npm i -g webgpu) and a Vulkan driver (lavapipe).
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}
const quietly = async f => { const l = console.log, w = console.warn; console.log = () => { }; console.warn = () => { }; try { return await f() } finally { console.log = l; console.warn = w } }

let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(spectral optics GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }
Object.assign(globalThis, webgpu.globals)
globalThis.__dawn ??= webgpu.create([])

const { WEBGPU } = await import('../../../tinywebgpu/src/tinywebgpu.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../../wgsl_shorthand.js')
const { PRIMITIVES } = await import('../../core/sdf.js')
const { DEFINITIONS } = await import('../../core/tracebasics.js')
const U = await import('../../core/uniforms.schema.js')
const { derive } = await import('../../core/photometry.js')
const { RAYTRACER } = await import('../../core/raytrace_main.js')
const { createOptics } = await import('../index.js')
const S = await import('../spectral.js')
const { SPD_PRESETS } = await import('../../core/spd.js')
const { XYZtoxy, xyToUpVp, rgbToXYZ } = await import('../../core/colorimetry.js')
const M = await import('../../../../builder/model.js')
const { generate } = await import('../../../../builder/codegen.js')

const WG = WEBGPU()
await WG.init(0, {}, globalThis.__dawn)
WG.defines = defines(TOKENS, SHORT_TOKENS)
const upvp = xyz => xyToUpVp(...XYZtoxy(xyz))
const dUv = (a, b) => Math.hypot(...upvp(a).map((v, i) => v - upvp(b)[i]))

{
    /* THE PIECES: the WGSL's draw, a ray's three wavelengths and the basis against the JS mirrors, for 4096 u */
    const N = 4096
    const prog = WG.makeCompute(`${PRIMITIVES};${DEFINITIONS}${S.SPECTRAL_CORE_WGSL}`, /*wgsl*/`
        let i = gid.x;
        // every binding the text names reached from main (check-shaders pass two says why): the uniforms too
        if (i == 0xffffffffu) { out[0] = f32(UB.maxbounce); }
        if (i >= ${N}u) { return; }
        let u = (f32(i) + 0.5) / ${N}.0;
        let q = spLambda(u);
        var r: Ray;
        r.tag = (1u + u32(round(u * SP_STEPS))) << 17u;
        let l = specLams(r);
        let b = vec3<f32>(spNode(SP_BASIS, q.x), spNode(SP_BASIS + SP_N, q.x), spNode(SP_BASIS + 2u * SP_N, q.x));
        out[i * 8u] = q.x; out[i * 8u + 1u] = q.y; out[i * 8u + 2u] = l.x; out[i * 8u + 3u] = l.y; out[i * 8u + 4u] = l.z;
        out[i * 8u + 5u] = b.x; out[i * 8u + 6u] = b.y; out[i * 8u + 7u] = b.z;`,
        { ...U.ComputeUniformTypes }, { optSpectral: 'array<f32>', out: 'array<f32>' }, { wg: [64, 1, 1], readOnly: ['optSpectral'] })
    const data = S.spectralBuffer([])
    const sb = WG.createStorageBuffer(data.byteLength); sb.w(data)
    const out = WG.createStorageBuffer(N * 8 * 4)
    prog.resources = { optSpectral: sb.b, out: out.b }
    prog.uniforms = { maxbounce: 1 }
    prog.dispatch(N / 64, 1, 1)
    const g = await out.r(Float32Array)
    let dl = 0, dp = 0, d3 = 0, db = 0
    for (let i = 0; i < N; i++) {
        const u = (i + 0.5) / N, q = S.spLambda(u), l3 = S.spLambdas(S.uOf(S.uCode(u))).map(x => x.lambda)
        dl = Math.max(dl, Math.abs(g[i * 8] - q.lambda)); dp = Math.max(dp, Math.abs(g[i * 8 + 1] - q.pdf) / q.pdf)
        d3 = Math.max(d3, ...[0, 1, 2].map(k => Math.abs(g[i * 8 + 2 + k] - l3[k])))
        db = Math.max(db, ...[0, 1, 2].map(c => Math.abs(g[i * 8 + 5 + c] - [1, 0, 0].map((_, cc) => cc === c ? 1 : 0).reduce((a, w, cc) => a + w * S.reflectanceAt([0, 1, 2].map(x => x === c ? 1 : 0), q.lambda), 0))))
    }
    /* WITHIN f32: a cell's density is the difference of two CDF values near each other, a few 1e-3 relative in f32 --
       not a bias, since the GPU draws from the same f32 CDF it takes the density of (measured on lavapipe, 2026-11-04:
       7e-4 nm, 1.3e-3; a ray's three 0.015 nm; the basis 1.1e-6) */
    ok('the draw: the WGSL\'s wavelength the JS mirror\'s within 2e-3 nm, its density within 3e-3', dl < 2e-3 && dp < 3e-3, `${dl} nm, ${dp}`)
    ok('...a ray\'s three wavelengths (u, u + 1/3, u + 2/3) the mirror\'s within 0.03 nm', d3 < 0.03, `${d3}`)
    ok('...the basis a material\'s RGB becomes a spectrum by, the mirror\'s within 3e-6', db < 3e-6, `${db}`)
}

/* THE SCENE: a detector floor 2 m square, a light 1 m over it shining straight down; and, when asked, a plate between
   them (a coated one, or a dispersive slab). In metres. */
function sceneOf({ spectral, plate = null }) {
    const d = M.createDoc({ title: 'spectral optics' })
    d.unit = 'm'
    M.addMaterial(d, { id: 'det', preset: 'diffuse', label: 'detector' })
    M.setMaterialType(d, 'det', 'detector')
    M.addObject(d, 'root', { id: 'floor', primitive: 'box', material: 'det', params: { size: { x: 1, y: 1, z: 0.01 }, rounding: 0 }, transform: { pos: { x: 0, y: 0, z: -0.01 }, rot: { x: 0, y: 0, z: 0 }, scale: 1 } })
    if (plate) {
        M.addMaterial(d, { id: 'gl', preset: 'glass', label: 'plate' })
        Object.assign(M.material(d, 'gl').params, plate)
        M.addObject(d, 'root', { id: 'plate', primitive: 'box', material: 'gl', params: { size: { x: 0.6, y: 0.6, z: 0.02 }, rounding: 0 }, transform: { pos: { x: 0, y: 0, z: 0.5 }, rot: { x: 0, y: 0, z: 0 }, scale: 1 } })
    }
    if (spectral) M.setFeatures(d, { spectral: true })
    return generate(...M.generateArgs(d, { id: `spec-${spectral}-${plate ? Object.keys(plate).join('') : 'none'}` }))
}
async function traceOf(scene, source, { rays = 200000, batches = 2 } = {}) {
    const R = RAYTRACER(WG, null, { w: 4, h: 4, resetframecount: 0 }, scene)
    R.hud = () => { }
    await quietly(() => R.init())
    const v = { ...U.defaultUniformValues() }
    const derived = derive(v, { unit: scene.unit, extent: scene.extent, envRadius: scene.envRadius })
    const sceneVals = Object.fromEntries(Object.entries(scene.uniforms || {}).map(([k, u]) => [k, U.uniformToGPU(u.def, u.type)]))
    const bag = { ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, U.uniformToGPU(x, U.UniformSpec[k]?.type)])), ...derived, ...sceneVals }
    const RT = { get scene() { return R.scene }, get learn() { return R.learn }, uniformBag: () => bag, photonSources: [], overlays: [],
                 redraw() { }, invalidate() { }, cam: { getUniforms: () => ({ camPos: [0, 0, 5], invView: new Array(16).fill(0), invProjection: new Array(16).fill(1) }), get: () => ({ camtype: 0 }) } }
    const O = createOptics(RT, WG)
    O.setSources([source])
    const all = []
    for (let b = 0; b < batches; b++) {
        await quietly(() => O.run({ rays, batches: 1 }))
        const h = await O.readHits()
        if (process.env.SPECTRAL_DEBUG) { const r = O.results; console.log('DEBUG', JSON.stringify({ hits: h.hits.length, count: h.count, emitted: r?.emitted, escaped: r?.escaped, lost: r?.lost, detected: r?.detected, objects: r?.objects?.map(o => [o.label ?? o.tag, o.incident]) })) }
        for (const x of h.hits) all.push(x)
    }
    return { hits: all, spectral: !!scene.spectral, results: O.results }
}
const sumXYZ = hits => hits.reduce((a, h) => a.map((v, i) => v + h.xyz[i]), [0, 0, 0])
const disc = extra => ({ type: 'disc', pos: [0, 0, 1], axis: [0, 0, -1], u: [1, 0, 0], size: [0.05, 0.05], distribution: 'collimated',
                         halfAngle: 90, n: 1, flux: 1000, emitN: 1, twoSided: false, ...extra })
const white = SPD_PRESETS['LED white, about 4000 K (blue die and phosphor)']
const own = S.sourceSpectrum({ spectrum: white })
const ownXYZ = S.nodesXYZ(own.values)

{
    /* THE COLOUR TRACE UNTOUCHED: an RGB light, the feature off -- its chromaticity read back exactly, as always */
    const rgb = [1.4, 0.8, 0.3]
    const t = await traceOf(sceneOf({ spectral: false }), disc({ colour: rgb }), { rays: 50000, batches: 1 })
    const want = rgbToXYZ(rgb)
    ok(`the colour trace: ${t.hits.length} hits, its light's chromaticity exactly (1e-6 u'v'), no wavelengths`, t.hits.length > 40000
        && dUv(sumXYZ(t.hits), want) < 1e-6 && t.hits.every(h => !h.lam), `${dUv(sumXYZ(t.hits), want)}`)
}
{
    /* A WHITE LED BY ITS SPECTRUM: the detector reads the spectrum's xy, its luminance per ray 1 on average */
    const t = await traceOf(sceneOf({ spectral: true }), disc({ colour: [1, 1, 1], spectrum: white }))
    const xyz = sumXYZ(t.hits), n = t.hits.length
    ok(`spectral: ${n} hits, each with three wavelengths and their weights`, n > 300000 && t.hits.every(h => h.lam?.length === 3 && h.w?.length === 3))
    const d = dUv(xyz, ownXYZ)
    console.log(`(a white LED by its spectrum onto the detector: ${n} hits, ${d.toExponential(2)} u'v' from its own colour)`)
    ok(`...what the detector caught is the spectrum's own colour within 1e-3 u'v' (${d.toExponential(2)})`, d < 1e-3)
    ok('...every lumen arrives: the detected flux the light\'s (collimated onto the floor), within 1 %', Math.abs(xyz[1] / (2 * 1000) - 1) < 0.01, `${xyz[1]} of 2000 (two batches)`)
    // a hit's XYZ is its three wavelengths' weights times the CMFs there (the host's table: optics/spectral.js)
    const { CIE_LO, CIE_X, CIE_Y, CIE_Z } = await import('../../core/cie1931.js')
    const cmf = l => { const f = l - CIE_LO, i = Math.floor(f), t2 = f - i; return [CIE_X, CIE_Y, CIE_Z].map(A => A[i] + t2 * (A[i + 1] - A[i])) }
    let worst = 0
    for (const h of t.hits.slice(0, 2000)) {
        const x = [0, 1, 2].map(c => h.lam.reduce((a, l, k) => a + h.w[k] * cmf(l)[c], 0))
        worst = Math.max(worst, ...x.map((v, c) => Math.abs(v - h.xyz[c]) / Math.max(1e-9, Math.abs(h.xyz[1]))))
    }
    ok('...each hit\'s XYZ its wavelengths\' weights times the CMFs, within 1e-3 of its Y', worst < 1e-3, `${worst}`)
}
{
    /* THROUGH A DICHROIC PLATE: every face coated, reflecting below 500 nm (R 1 to 0 over 10 nm), at normal incidence (no
       shift). Incoherent, each wavelength passes T^2 / (1 - R^2) of the plate's two faces, R = R(lambda). The detector's Y
       against that integral over the light's spectrum (at the nodes, as the trace sees it); the colour trace's reading
       of the same plate beside it, for the record. */
    const coat = { coating: 3, coatLow: 1, coatHigh: 0, coatEdge: 500, coatWidth: 10, coatIndex: 1.8, transmission: 1, roughness: 0 }
    const sigma = 10 / (2 * Math.log(9))
    const Rl = l => 1 + (0 - 1) / (1 + Math.exp(-(l - 500) / sigma))
    const { CIE_Y } = await import('../../core/cie1931.js')
    let num = 0, den = 0
    for (let i = 0; i < S.SP_N; i++) { const R = Rl(S.SP_LO + i), T = 1 - R; num += own.values[i] * CIE_Y[i] * (T * T / Math.max(1e-12, 1 - R * R)); den += own.values[i] * CIE_Y[i] }
    const wantShare = num / den
    const t = await traceOf(sceneOf({ spectral: true, plate: coat }), disc({ colour: [1, 1, 1], spectrum: white }))
    const share = sumXYZ(t.hits)[1] / 2000
    // the error of the share: the hits' Y spread over the rays traced (400 000)
    const ys = t.hits.map(h => h.xyz[1]), mean = ys.reduce((a, v) => a + v, 0) / 400000
    const se = Math.sqrt(ys.reduce((a, v) => a + (v - mean) ** 2, 0) / 400000 / 400000) * 400000 / 2000
    ok(`a dichroic plate: the detector reads ${share.toFixed(4)} of the light, its transmission integrated by wavelength ${wantShare.toFixed(4)}, within 4 sigma (${se.toExponential(1)})`,
        Math.abs(share - wantShare) < 4 * se + 2e-3, `${share} vs ${wantShare}`)
    const tc = await traceOf(sceneOf({ spectral: false, plate: coat }), disc({ colour: rgbOfWhite() }))
    console.log(`(through the dichroic plate: the spectral trace reads ${share.toFixed(4)} +- ${se.toFixed(4)}, the integral ${wantShare.toFixed(4)};`
        + ` the colour trace ${(sumXYZ(tc.hits)[1] / 2000).toFixed(4)}, its per-channel average of the edge)`)
}
{
    /* A DISPERSIVE SLAB at normal incidence: every ray through it collapses to its first wavelength, and the light that
       comes out is the light's own colour on average (the slab's faces reflect the same at every wavelength) */
    const t = await traceOf(sceneOf({ spectral: true, plate: { abbe: 30, ior: 1.6, transmission: 1, roughness: 0 } }), disc({ colour: [1, 1, 1], spectrum: white }))
    const one = t.hits.filter(h => h.one).length
    ok(`a dispersive slab: the rays through it collapsed to one wavelength (${one} of ${t.hits.length})`, one > 0.8 * t.hits.length)
    const d = dUv(sumXYZ(t.hits), ownXYZ)
    ok(`...and white through it stays the light's colour within 2e-3 u'v' (${d.toExponential(2)})`, d < 2e-3)
}

function rgbOfWhite() {
    // the white LED's exact Rec.709 RGB, as the colour trace carries it
    const xyz = S.nodesXYZ(own.values)
    return [[3.2406, -1.5372, -0.4986], [-0.9689, 1.8758, 0.0415], [0.0557, -0.2040, 1.0570]].map(r => r[0] * xyz[0] + r[1] * xyz[1] + r[2] * xyz[2])
}

console.log(`spectral optics GPU: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
