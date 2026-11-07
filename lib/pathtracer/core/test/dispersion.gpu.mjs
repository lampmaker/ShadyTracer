//======================================================================================================================
// DISPERSION THROUGH THE SHADE KERNEL'S OWN BOUNCE, on a real WebGPU in node. Run:
//   node lib/pathtracer/core/test/dispersion.gpu.mjs
//
// What 0.40.0 put in the shader (core/spectral.js cauchyN, specDraw, rayLambda, withLambda; materials_pbr.js
// processMaterial_advanced) compiled by Dawn (Tint) from the very text prog_shade compiles, with a main of its own:
//   - the pieces against their JS mirrors: n(lambda), the wavelength draw's weights, the wavelength in a tag's upper
//     bits -- the flags below them untouched;
//   - processMaterial_advanced itself, 100 000 times a case, a fresh ray onto a smooth glass at 45 degrees: with
//     an Abbe number, what it REFLECTS is white and weighs the d line's Fresnel (no wavelength drawn), what it
//     REFRACTS carries a wavelength, leaves along Snell's direction at n(that wavelength), takes n(lambda) as its
//     medium's index, and averages (1 - F) in every channel -- the rainbow adds back to white; without one, as before;
//   - a ray that already has a wavelength keeps it, and meets the next glass at n(its wavelength), its weight
//     untouched -- no second draw.
//   - a ray already holding a wavelength at a glass with no Abbe number meets it at n_d: what every glass is in a scene
//     with dispersion off (0.83.0; builder/model.js setFeatures compiles its materials without one). Until then it was
//     a second pass with the picture's switch off (UB.dispersionOff, 0.74.0), gone with the switch.
//   - A LIGHT'S PHOTON THAT CARRIES ITS LIGHT'S SPECTRUM (0.next; core/lightspectra.js): the user's 450 nm LED (10 nm wide)
//     and a red one (630 nm, 20 nm), each photon tagged with its table (Ray.pix PIX_LS) in a learn buffer holding both,
//     at the same glass: what refracts is at the LED's own wavelengths only -- the red never below 560 nm, the blue within
//     430-470 -- distributed as the JS draw is, each its wavelength's colour, the mean (1 - F) times the LED's colour; the
//     draw itself against its JS mirror; and a photon with no table, or a camera ray whose pix happens to look like one,
//     drawn by the channels' weights as before.
//
// No picture: what a prism looks like is the user's to judge (CLAUDE.md). OPTIONAL, AND LOUD ABOUT IT: the `webgpu`
// package (npm i -g webgpu) and a Vulkan driver (lavapipe: apt-get install mesa-vulkan-drivers).
//======================================================================================================================
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(dispersion GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const { SHADE_PRELUDE } = await import('../scene_api.js')
const { MATERIALS_PBR } = await import('../materials_pbr.js')
const { FACE_TABLE, PROCESSING, LEARN_WORDS } = await import('../tracebasics.js')
const { counterstruct } = await import('../wavefront.js')
const { MF_WORDS } = await import('../microfacet.js')
const { ComputeUniformTypes } = await import('../uniforms.schema.js')
const { cauchyN, specDraw, lambdaOf, lambdaCode } = await import('../spectral.js')
const { fresnel, refract } = await import('../../optics/fresnel.js')
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
    console.log(`(dispersion GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }

/* THE PIECES: n(lambda) at LAMBDAS for (1.75, 28), the draw at U_N evenly spread u, a tag round trip at LAMBDAS */
const LAMBDAS = [380, 412.3, 486.13, 550, 587.56, 656.27, 700.5, 779.9]
const U_N = 4096
/* THE BOUNCE: a ray from air onto a smooth clear glass (n_d 1.75), 45 degrees, N times a case: [Abbe, the ray's own
   wavelength (0 none)]. ONE CALL A THREAD, each writing what came out, summed here: processMaterial_advanced inside a
   loop -- even of one iteration, even with no dispersion, main's code too -- crashed lavapipe (a segfault, 2026-10-09),
   where one call a thread ran clean. */
const N = 65536
const CASES = [[28, 0], [0, 0], [28, 550], [0, 550]]
const OUT = { pieces: 0, draw: 64, bounce: 128 }
const SAMPLE_FLOATS = 8                     // a sample: dir.xy z, beta rgb, n, lambda
const prog = WG.makeCompute(`${SHADE_PRELUDE}${MATERIALS_PBR}${FACE_TABLE}${PROCESSING}`,
    /*wgsl*/`
    // every binding the text names reached from main, as tinywebgpu binds them (check-shaders pass two says why)
    if (gid.x == 0xffffffffu) {
        _ = &marchBuffer0; _ = &marchBuffer1; _ = &shadeBuffer; _ = &frame_u32; _ = &shadowBuffer0; _ = &shadowBuffer1;
        _ = &counters; _ = &learn; _ = UB.res;
    }
    let id = gid.x;
    if (id == 0u) {
        // n(lambda), and the wavelength in a tag: the flags kept
        let L = array<f32, ${LAMBDAS.length}>(${LAMBDAS.map(l => l.toFixed(4)).join(', ')});
        for (var k = 0u; k < ${LAMBDAS.length}u; k++) {
            out[k] = cauchyN(1.75, 28.0, L[k]);
            var r = newRay(VEC3(0.0), VEC3(0.0, 0.0, 1.0), VEC4(1.0), 1.0);
            r.tag = TAG_PHOTON | TAG_PASSED | CLS_LIGHTS | TAG_FNEE;
            r = withLambda(r, L[k]);
            out[16u + k] = rayLambda(r);
            out[32u + k] = f32(r.tag & 0xFFFFu);
        }
        var none = newRay(VEC3(0.0), VEC3(0.0, 0.0, 1.0), VEC4(1.0), 1.0);
        out[48u] = rayLambda(none);
        // the draw: its mean weight per channel, its largest, at u evenly spread
        var m = VEC3(0.0); var big = 0.0;
        for (var j = 0u; j < ${U_N}u; j++) {
            let d = specDraw((f32(j) + 0.5) / ${U_N}.0);
            m += d.w / ${U_N}.0; big = max(big, max3(d.w));
            if (j == 1000u) { out[${OUT.draw + 4}u] = d.lambda; out[${OUT.draw + 5}u] = d.w.x; out[${OUT.draw + 6}u] = d.w.y; out[${OUT.draw + 7}u] = d.w.z; }
        }
        out[${OUT.draw}u] = m.x; out[${OUT.draw + 1}u] = m.y; out[${OUT.draw + 2}u] = m.z; out[${OUT.draw + 3}u] = big;
    }
    if (gid.y >= ${CASES.length}u || gid.x >= ${N}u) { return; }
    let ci = gid.y;
    // CASES' [Abbe, own wavelength], held in a var: a runtime index into an array value is not every compiler's
    var abbes = array<f32, ${CASES.length}>(${CASES.map(c => `${c[0]}.0`).join(', ')});
    var owns = array<f32, ${CASES.length}>(${CASES.map(c => `${c[1]}.0`).join(', ')});
    let abbe = abbes[ci];
    let own = owns[ci];
    var m = makeDefaultMaterial();
    m.baseColor = VEC3(1.0); m.roughness = 0.0; m.metallic = 0.0; m.ior = 1.75; m.transmission = 1.0; m.specular = 0.5;
    SEED_uvec4(vec4<u32>(11u, 13u, 17u, 19u));
    SEED_u32(gid.x);
    SEED_u32(ci);
    var r = newRay(VEC3(0.0, 0.0, 0.0), normalize(VEC3(0.70710678, 0.0, -0.70710678)), VEC4(1.0), 1.0);
    r.bounces = 2u;                                     // past a camera path's first-surface rules
    if (own > 0.0) { r = withLambda(r, own); }
    let h = Hit(r, VEC4(0.0, 0.0, 1.0, 0.0), 1u, 0u, -1.0e7);
    let o = processMaterial_advanced(h, m, VEC3(0.0, 0.0, 1.0), 1.75, vec3<u32>(0u), abbe);
    let b = ${OUT.bounce}u + (ci * ${N}u + gid.x) * ${SAMPLE_FLOATS}u;
    out[b] = o.dir.x; out[b + 1u] = o.dir.y; out[b + 2u] = o.dir.z;
    out[b + 3u] = o.beta.x; out[b + 4u] = o.beta.y; out[b + 5u] = o.beta.z;
    out[b + 6u] = o.n; out[b + 7u] = rayLambda(o);
    `,
    ComputeUniformTypes,
    { marchBuffer0: 'array<Ray>', marchBuffer1: 'array<Ray>', shadeBuffer: 'array<ShadeItem>', frame_u32: 'array<atomic<u32>>',
      shadowBuffer0: 'array<Ray>', shadowBuffer1: 'array<Ray>', learn: 'array<atomic<u32>>', counters: counterstruct,
      out: 'array<f32>' },
    { wg: [64, 1, 1], async: false })
const buf = n => WG.createStorageBuffer(Math.max(n, 256))
const out = buf(4 * (OUT.bounce + CASES.length * N * SAMPLE_FLOATS))
prog.resources = { marchBuffer0: buf(112).b, marchBuffer1: buf(112).b, shadeBuffer: buf(288).b, frame_u32: buf(16).b,
    shadowBuffer0: buf(112).b, shadowBuffer1: buf(112).b, learn: buf(4 * (LEARN_WORDS + MF_WORDS)).b, counters: buf(64).b,
    out: out.b }
/* light sampling off: what is checked is the bounce, and a shadow ray's light is not in it */
prog.uniforms = { res: [1, 1], nee: 0 }
prog.dispatch(N / 64, CASES.length, 1)
const g = await out.r(Float32Array)

// ---- the pieces
const nWorst = Math.max(...LAMBDAS.map((l, k) => Math.abs(g[k] - cauchyN(1.75, 28, l))))
ok('n(lambda) on the GPU is the JS mirror\'s within 1e-6', nWorst < 1e-6, `worst ${nWorst}`)
const lWorst = Math.max(...LAMBDAS.map((l, k) => Math.abs(g[16 + k] - l)))
ok('a wavelength put in a tag reads back within 0.007 nm (one step is 0.012)', lWorst < 0.007, `worst ${lWorst}`)
ok('...and the JS mirror codes it the same way', LAMBDAS.every((l, k) => Math.abs(lambdaOf(lambdaCode(l)) - g[16 + k]) < 1e-3))
const flags = 1 | 4 | 1024 | 2048
ok('...the flags below it untouched', LAMBDAS.every((_, k) => g[32 + k] === flags), [...g.slice(32, 32 + LAMBDAS.length)].join(' '))
ok('a ray with none reads 0', g[48] === 0)
const md = [...g.slice(OUT.draw, OUT.draw + 3)]
ok('the draw\'s mean weight is 1 in every channel (4096 evenly spread u)', md.every(v => Math.abs(v - 1) < 2e-3), md.join(' '))
ok('...no weight above 3 (each bin drawn by the channels\' sum)', g[OUT.draw + 3] <= 3 + 1e-5, `${g[OUT.draw + 3]}`)
const js = specDraw(1000.5 / U_N)
ok('...one draw the JS mirror\'s: its wavelength and weights', Math.abs(js.lambda - g[OUT.draw + 4]) < 1e-3
    && js.w.every((v, i) => Math.abs(v - g[OUT.draw + 5 + i]) < 1e-4), `GPU ${[...g.slice(OUT.draw + 4, OUT.draw + 8)]} JS ${js.lambda} ${js.w}`)

// ---- the bounce, as each material sets it: Abbe 0 is a glass with none, as a scene with dispersion off compiles every
//      glass -- a fresh ray draws nothing and refracts at n_d, one already holding a wavelength keeps its tag and meets
//      the glass at n_d (cauchyN of 0)
const bounce = g => CASES.forEach(([abbe, own], ci) => {
    const refl = [0, 0, 0], trans = [0, 0, 0]
    let lamMin = Infinity, lamMax = 0, snell = 0, nErr = 0, coloured = 0, wrongLambda = 0
    for (let j = 0; j < N; j++) {
        const b = OUT.bounce + (ci * N + j) * SAMPLE_FLOATS
        const dir = [g[b], g[b + 1], g[b + 2]], beta = [g[b + 3], g[b + 4], g[b + 5]], n = g[b + 6], lam = g[b + 7]
        if (dir[2] > 0) {                                   // reflected: above the surface
            beta.forEach((v, k) => refl[k] += v / N)
            coloured = Math.max(coloured, Math.abs(beta[0] - beta[1]), Math.abs(beta[1] - beta[2]))
            if (lam !== (own ? g[b + 7] : 0) || (own && Math.abs(lam - own) > 0.007)) wrongLambda++
        } else {
            beta.forEach((v, k) => trans[k] += v / N)
            lamMin = Math.min(lamMin, lam); lamMax = Math.max(lamMax, lam)
            const nl = lam > 0 ? cauchyN(1.75, abbe, lam) : 1.75
            snell = Math.max(snell, Math.abs(Math.hypot(dir[0], dir[1]) - Math.SQRT1_2 / nl))
            nErr = Math.max(nErr, Math.abs(n - nl))
            if (own && Math.abs(lam - own) > 0.007) wrongLambda++
        }
    }
    const name = own ? `a ray already at ${own} nm, Abbe ${abbe}` : `a fresh ray, Abbe ${abbe}`
    const Fh = own ? fresnel(Math.cos(Math.PI / 4), 1 / cauchyN(1.75, abbe, own)).unpolarised : fresnel(Math.cos(Math.PI / 4), 1 / 1.75).unpolarised
    // a reflection's weight is F / pick = 1, a refraction's (1 - F) w / (1 - pick): the counting noise of 65 536 picks
    ok(`${name}: reflects ${Fh.toFixed(4)} -- ${own ? 'the Fresnel at its own wavelength' : 'the d line\'s Fresnel'}, every channel`,
        refl.every(v => Math.abs(v - Fh) < 4e-3), refl.map(v => v.toFixed(4)).join(' '))
    ok(`${name}: what it reflects is white, weight for weight`, coloured < 1e-6, `largest channel difference ${coloured}`)
    // (1 - F) a channel: weights up to 3 / (1 - F) -- 0.02 is over 4 standard errors
    ok(`${name}: what it refracts averages 1 - F in every channel (the rainbow adds back to white)`,
        trans.every(v => Math.abs(v - (1 - Fh)) < 0.02), trans.map(v => v.toFixed(4)).join(' '))
    ok(`${name}: refracted along Snell at n(its wavelength), within 1e-5`, snell < 1e-5, `worst ${snell}`)
    ok(`${name}: and takes n(its wavelength) as its medium's index`, nErr < 1e-6, `worst ${nErr}`)
    if (abbe && !own) ok(`${name}: the refracted rays span the visible (380-780 nm)`, lamMin < 400 && lamMax > 700, `${lamMin}..${lamMax}`)
    if (!abbe && !own) ok(`${name}: no wavelength is given`, lamMin === 0 && lamMax === 0)
    if (own) ok(`${name}: keeps its own, never drawn again`, wrongLambda === 0 && Math.abs(lamMin - own) < 0.007 && Math.abs(lamMax - own) < 0.007, `${wrongLambda} ${lamMin}..${lamMax}`)
    else ok(`${name}: a reflection carries no wavelength`, wrongLambda === 0, `${wrongLambda}`)
})
bounce(g)

/* ---- A LIGHT'S PHOTON THAT CARRIES ITS LIGHT'S SPECTRUM (core/lightspectra.js): CASES2' [table, a photon?], the
   table's 0xFFFF none. The photon starts with its light's colour on beta, as prog_opt_photons gives it. */
const { lightSpectrumTable, lightSpectraWords, lsDraw, LS_BASE, LS_WORDS, PIX_LS } = await import('../lightspectra.js')
const TABLES = [lightSpectrumTable({ spectrum: { kind: 'peaks', peaks: [{ nm: 450, fwhm: 10, weight: 1 }] } }),
                lightSpectrumTable({ spectrum: { kind: 'peaks', peaks: [{ nm: 630, fwhm: 20, weight: 1 }] } })]
const CASES2 = [[0, 1], [1, 1], [0xFFFF, 1], [0, 0]]
const U2 = 4096, OUT2 = { draw: 0, bounce: 64 }
const prog2 = WG.makeCompute(`${SHADE_PRELUDE}${MATERIALS_PBR}${FACE_TABLE}${PROCESSING}`,
    /*wgsl*/`
    if (gid.x == 0xffffffffu) {
        _ = &marchBuffer0; _ = &marchBuffer1; _ = &shadeBuffer; _ = &frame_u32; _ = &shadowBuffer0; _ = &shadowBuffer1;
        _ = &counters; _ = &learn; _ = UB.res;
    }
    let id = gid.x;
    if (id < 2u && gid.y == 0u) {
        // the draw from table id: its mean colour at U2 evenly spread u, and one draw at u = 0.3
        var m = VEC3(0.0);
        for (var j = 0u; j < ${U2}u; j++) { m += lsDraw(id, (f32(j) + 0.5) / ${U2}.0).w / ${U2}.0; }
        let d = lsDraw(id, 0.3);
        let b = ${OUT2.draw}u + id * 8u;
        out[b] = m.x; out[b + 1u] = m.y; out[b + 2u] = m.z; out[b + 3u] = d.lambda; out[b + 4u] = d.w.x; out[b + 5u] = d.w.y; out[b + 6u] = d.w.z;
    }
    if (gid.y >= ${CASES2.length}u || gid.x >= ${N}u) { return; }
    let ci = gid.y;
    var tabs = array<u32, ${CASES2.length}>(${CASES2.map(c => `${c[0]}u`).join(', ')});
    var phot = array<u32, ${CASES2.length}>(${CASES2.map(c => `${c[1]}u`).join(', ')});
    let tab = tabs[ci];
    var m = makeDefaultMaterial();
    m.baseColor = VEC3(1.0); m.roughness = 0.0; m.metallic = 0.0; m.ior = 1.75; m.transmission = 1.0; m.specular = 0.5;
    SEED_uvec4(vec4<u32>(23u, 29u, 31u, 37u));
    SEED_u32(gid.x);
    SEED_u32(ci);
    var r = newRay(VEC3(0.0, 0.0, 0.0), normalize(VEC3(0.70710678, 0.0, -0.70710678)), VEC4(1.0), 1.0);
    r.bounces = 2u;
    r.tag = select(0u, TAG_PHOTON | TAG_OPTIC | TAG_LTALL, phot[ci] != 0u);
    r.pix = select(0xFFFFFFFFu, PIX_LS | tab, tab != 0xFFFFu);
    // its light's colour, as the photon kernel puts it on beta: table 0's for the cases with none
    let ht = select(tab, 0u, tab == 0xFFFFu);
    r.beta = VEC3(lsF(LS_HEAD + ht * LS_STRIDE), lsF(LS_HEAD + ht * LS_STRIDE + 1u), lsF(LS_HEAD + ht * LS_STRIDE + 2u));
    let h = Hit(r, VEC4(0.0, 0.0, 1.0, 0.0), 1u, 0u, -1.0e7);
    let o = processMaterial_advanced(h, m, VEC3(0.0, 0.0, 1.0), 1.75, vec3<u32>(0u), 28.0);
    let b = ${OUT2.bounce}u + (ci * ${N}u + gid.x) * ${SAMPLE_FLOATS}u;
    out[b] = o.dir.x; out[b + 1u] = o.dir.y; out[b + 2u] = o.dir.z;
    out[b + 3u] = o.beta.x; out[b + 4u] = o.beta.y; out[b + 5u] = o.beta.z;
    out[b + 6u] = o.n; out[b + 7u] = rayLambda(o);
    `,
    ComputeUniformTypes,
    { marchBuffer0: 'array<Ray>', marchBuffer1: 'array<Ray>', shadeBuffer: 'array<ShadeItem>', frame_u32: 'array<atomic<u32>>',
      shadowBuffer0: 'array<Ray>', shadowBuffer1: 'array<Ray>', learn: 'array<atomic<u32>>', counters: counterstruct,
      out: 'array<f32>' },
    { wg: [64, 1, 1], async: false })
const out2 = buf(4 * (OUT2.bounce + CASES2.length * N * SAMPLE_FLOATS))
const learn2 = buf(4 * (LS_BASE + LS_WORDS))
learn2.w(lightSpectraWords(TABLES), LS_BASE * 4)
prog2.resources = { marchBuffer0: buf(112).b, marchBuffer1: buf(112).b, shadeBuffer: buf(288).b, frame_u32: buf(16).b,
    shadowBuffer0: buf(112).b, shadowBuffer1: buf(112).b, learn: learn2.b, counters: buf(64).b, out: out2.b }
prog2.uniforms = { res: [1, 1], nee: 0 }
prog2.dispatch(N / 64, CASES2.length, 1)
const g2 = await out2.r(Float32Array)

TABLES.forEach((T, t) => {
    const name = ['the 450 nm LED', 'the red LED'][t], b = OUT2.draw + t * 8, big = Math.max(...T.hue.map(Math.abs))
    const jsMean = [0, 0, 0]
    for (let j = 0; j < U2; j++) lsDraw(T, (j + 0.5) / U2).col.forEach((v, k) => jsMean[k] += v / U2)
    ok(`${name}'s table: the draw's mean colour on the GPU the JS mirror's (4096 u)`, jsMean.every((v, k) => Math.abs(v - g2[b + k]) < 1e-4 * big),
       `GPU ${[...g2.slice(b, b + 3)]} JS ${jsMean}`)
    const d = lsDraw(T, 0.3)
    ok(`${name}'s table: one draw the JS mirror's, its wavelength and colour`, Math.abs(d.lambda - g2[b + 3]) < 1e-3
       && d.col.every((v, k) => Math.abs(v - g2[b + 4 + k]) < 1e-5 * big), `GPU ${[...g2.slice(b + 3, b + 7)]} JS ${d.lambda} ${d.col}`)
})
const Fd = fresnel(Math.cos(Math.PI / 4), 1 / 1.75).unpolarised
CASES2.forEach(([tab, photon], ci) => {
    const name = tab === 0xFFFF ? 'a photon with no table' : !photon ? 'a camera ray whose pix looks like a table\'s' : ['the 450 nm LED\'s photon', 'the red LED\'s photon'][tab]
    const T = TABLES[tab === 0xFFFF ? 0 : tab]
    const trans = [0, 0, 0], hist = new Float64Array(80)
    let lamMin = Infinity, lamMax = 0, snell = 0, nT = 0
    for (let j = 0; j < N; j++) {
        const b = OUT2.bounce + (ci * N + j) * SAMPLE_FLOATS
        if (g2[b + 2] > 0) continue                             // reflected
        nT++
        const lam = g2[b + 7]
        for (let k = 0; k < 3; k++) trans[k] += g2[b + 3 + k] / N
        lamMin = Math.min(lamMin, lam); lamMax = Math.max(lamMax, lam)
        hist[Math.min(79, Math.max(0, Math.floor((lam - 380) / 5)))]++
        snell = Math.max(snell, Math.abs(Math.hypot(g2[b], g2[b + 1]) - Math.SQRT1_2 / cauchyN(1.75, 28, lam)))
    }
    if (tab === 0xFFFF || !photon) {
        ok(`${name}: drawn by the channels' weights, across the visible`, lamMin < 400 && lamMax > 700, `${lamMin}..${lamMax}`)
        return
    }
    const [lo, hi] = tab === 0 ? [430, 470] : [560, 700]
    ok(`${name}: what refracts is at its light's own wavelengths only, ${lo}-${hi} nm`, lamMin >= lo && lamMax <= hi, `${lamMin}..${lamMax}`)
    // the histogram every 5 nm against the JS draw's probability there: 65 536 picks, the binomial's 5 sigma
    let worst = 0
    for (let k = 0; k < 80; k++) {
        const a = 380 + 5 * k, P = T.cdf[Math.min(399, a + 4 - 380)] - (a > 380 ? T.cdf[a - 1 - 380] : 0)
        const sig = Math.sqrt(Math.max(P * (1 - P), 1e-12) / nT)
        worst = Math.max(worst, Math.abs(hist[k] / nT - P) / Math.max(sig, 1 / nT))
    }
    ok(`${name}: its wavelengths every 5 nm the JS draw's, within 5 sigma`, worst < 5, `worst ${worst.toFixed(2)} sigma`)
    ok(`${name}: refracted along Snell at n(its wavelength)`, snell < 1e-5, `worst ${snell}`)
    // each refraction weighs (1 - F) / (1 - pick) = 1 times its cell's colour: the mean (1 - F) times the light's colour,
    // its noise the cells' colours' spread and the pick's
    const big = Math.max(...T.hue.map(Math.abs))
    ok(`${name}: what it refracts averages (1 - F) times its light's colour, a negative channel kept`,
       trans.every((v, k) => Math.abs(v - (1 - Fd) * T.hue[k]) < 0.01 * big), `${trans.map(v => v.toFixed(3))} against ${T.hue.map(v => ((1 - Fd) * v).toFixed(3))}`)
})

console.log(`dispersion GPU: ${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
