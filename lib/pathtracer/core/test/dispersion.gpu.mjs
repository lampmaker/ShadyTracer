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
//   - all of it again with the picture's switch off (UB.dispersionOff, 0.68.0): every glass as if its Abbe number were
//     0 -- no wavelength drawn, white, refracted at n_d -- and a ray already holding one meeting the glass at n_d.
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
const CASES = [[28, 0], [0, 0], [28, 550]]
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
    let abbe = select(select(28.0, 0.0, ci == 1u), 28.0, ci == 2u);
    let own = select(0.0, 550.0, ci == 2u);
    var m = makeDefaultMaterial();
    m.baseColor = VEC3(1.0); m.roughness = 0.0; m.metallic = 0.0; m.ior = 1.75; m.transmission = 1.0; m.specular = 0.5;
    SEED_uvec4(vec4<u32>(11u, 13u, 17u, 19u));
    SEED_u32(gid.x);
    SEED_u32(ci);
    var r = newRay(VEC3(0.0, 0.0, 0.0), normalize(VEC3(0.70710678, 0.0, -0.70710678)), VEC4(1.0), 1.0);
    r.bounces = 2u;                                     // past a camera path's first-surface rules
    if (own > 0.0) { r = withLambda(r, own); }
    let h = Hit(r, VEC4(0.0, 0.0, 1.0, 0.0), 1u, 0u, -1.0e7);
    let o = processMaterial_advanced(h, m, VEC3(0.0, 0.0, 1.0), 1.75, VEC3(0.0), abbe);
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

// ---- the bounce: as each material sets it, and again with the picture's switch off (UB.dispersionOff, 0.68.0)
const bounce = (g, off) => CASES.forEach(([setAbbe, own], ci) => {
    /* SWITCHED OFF, every Abbe number reads 0: a fresh ray draws nothing and refracts at n_d, and a ray already holding
       a wavelength (one in flight as the switch moves) keeps its tag but meets the glass at n_d (cauchyN of 0) */
    const abbe = off ? 0 : setAbbe
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
    const name = (own ? `a ray already at ${own} nm, Abbe ${setAbbe}` : `a fresh ray, Abbe ${setAbbe}`) + (off ? ', dispersion off' : '')
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
bounce(g, false)
prog.uniforms = { res: [1, 1], nee: 0, dispersionOff: 1 }
prog.dispatch(N / 64, CASES.length, 1)
bounce(await out.r(Float32Array), true)

console.log(`dispersion GPU: ${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
