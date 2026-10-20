//======================================================================================================================
// THE NORMAL ACROSS A RELIEF'S BAND EDGE, on a WebGPU in node (Dawn) -- 0.70.1 (scene_api.js NORMAL_LOOK). Run:
//   node builder/test/reliefnormal.gpu.mjs     (optional: npm i -g webgpu, and lavapipe; says so and passes without)
//
// The user's case (2026-10-20): a sphere of knockdown stucco cut from a box of white plaster, the library's two, a
// smooth subtraction -- and a hard line on the plaster round the cut, gone when both wore the same relief. A CSG
// chain's top divides by the steepest slope among the reliefs within their bands, which jumped where the stucco's band
// ends, and the surface kernel's differences straddled the jump. relief.test.mjs mirrors the field in JS; this runs the
// kernels: the scene as the builder makes it, the march, then the surface kernel (wavefront.js prog_surface), whose
// normal is read back for a row of rays coming straight down across that edge on the plaster, 4 um apart. Next to its
// neighbour a normal turns by a hair over that; the line turned it by degrees. The same for the two other normals by
// differences: calcNormals_fast, the optics trace's (its text cut from tracebasics.js PROCESSING_ASKS), over the same
// hits, and the pick's central differences (core/pick.js), ray by ray near the edge. And all three through the scene's
// text as it was before 0.70.1 (the top dividing in a normal's look too, so NORMAL_AT_HIT false): the line, which the
// test must see, or it could not fail.
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(relief normal GPU check SKIPPED: no webgpu module -- npm i -g webgpu)'); process.exit(0) }

const M = await import('../model.js')
const { generate } = await import('../codegen.js')
const { WEBGPU } = await import('../../lib/tinywebgpu/src/tinywebgpu.js')
const { prog_march, prog_surface, counterWords, COUNTER_WORDS } = await import('../../lib/pathtracer/core/wavefront.js')
const { prog_pick, readPick, PICK_WORDS } = await import('../../lib/pathtracer/core/pick.js')
const { RAY_BYTES, SHADE_ITEM_BYTES, LEARN_WORDS, PROCESSING_ASKS } = await import('../../lib/pathtracer/core/tracebasics.js')
const { SCENE_PRELUDE, normalAtHitWGSL } = await import('../../lib/pathtracer/core/scene_api.js')
const { UniformSpec, computeUniformTypes, sceneConstantsWGSL } = await import('../../lib/pathtracer/core/uniforms.schema.js')
const { derive } = await import('../../lib/pathtracer/core/photometry.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../lib/wgsl_shorthand.js')

Object.assign(globalThis, webgpu.globals)
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
    WG.defines = defines(TOKENS, SHORT_TOKENS)
} catch (e) {
    console.log(`(relief normal GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const say = console.log
console.warn = () => { }

// ---- THE SCENE, in mm: the plaster box's top face at z = 0, the stucco sphere (r 30) round (0, 0, 10) cut from it
const TOL = 0.05, BLEND = 3                    // mm: the scene's tolerance (its Properties), the group's blend
const lib = JSON.parse(readFileSync(new URL('../../library/items/materials.json', import.meta.url), 'utf8')).items
const asset = name => lib.find(i => i.name === name).asset
const doc = M.createDoc({ title: 'stucco cut from plaster' }); doc.unit = 'mm'
M.setTolerance(doc, TOL)
const plaster = M.insertAsset(doc, asset('white plaster')), stucco = M.insertAsset(doc, asset('knockdown stucco'))
const at = (x, y, z) => ({ pos: { x, y, z }, rot: { x: 0, y: 0, z: 0 }, scale: 1 })
M.addGroup(doc, 'root', { id: 'g', blend: BLEND })
M.addObject(doc, 'g', { id: 'bx', primitive: 'box', material: plaster.id, params: { size: { x: 100, y: 100, z: 20 }, rounding: 0 }, transform: at(0, 0, -20) })
M.addObject(doc, 'g', { id: 'sp', primitive: 'sphere', material: stucco.id, params: { radius: 30 }, transform: at(0, 0, 10), join: 'subtract' })
const S = generate(...M.generateArgs(doc, { id: 'relief-normal' }))
// ...and its text as before 0.70.1: the top dividing in a normal's look too
const was = t => t.replace('/ select(XF_RL, 1.0, NORMAL_LOOK))', '/ XF_RL)')
const WAS = { ...S, wgsl: was(S.wgsl), pickWgsl: was(S.pickWgsl) }
ok('the group is a chain\'s top that leaves its result undivided in a normal\'s look, and the surface kernel looks at the hit for it',
    [S.wgsl, S.pickWgsl].every(t => (t.match(/NORMAL_LOOK/g) || []).length === 1) && normalAtHitWGSL(S.wgsl).includes('= true;'))
ok('...the text as it was: divided, and no look at the hit', ![WAS.wgsl, WAS.pickWgsl].some(t => t.includes('NORMAL_LOOK')) && normalAtHitWGSL(WAS.wgsl).includes('= false;'))

const flat = v => v && typeof v === 'object' ? (Array.isArray(v) ? v : Object.values(v)) : v
const v0 = Object.fromEntries(Object.entries(UniformSpec).map(([k, s]) => [k, s.def]))
const bag = { ...v0, ...derive(v0, { unit: 'mm', extent: S.extent ?? null, envRadius: S.envRadius ?? null, tolerance: TOL }), res: [64, 64], seed: [1, 2, 3, 4], maxiter: 4000 }
for (const [k, u] of Object.entries(S.uniforms || {})) bag[k] = flat(u.def)

// ---- THE ROW: rays straight down at y 0.3, x across the stucco's band's edge on the face (34.3: its distance there two
//      amplitudes and 5/4 of the blend), clear of the sphere (r 30) and its fillet
const X0 = 33.5, DX = 0.004, N = 501
const RAY_F = RAY_BYTES / 4, ITEM_F = SHADE_ITEM_BYTES / 4
/* sf.nrm in a ShadeItem (scene_api.js): Hit 144 bytes (its Ray 112, s, m, a, insideW, to 16), then the Surface -- its
   Material2, nrm (16-aligned) with n1, mu1 with v1 -- ending the item's 272: nrm at 272 - 32. Checked below by what it
   holds: a unit vector, about +z, on every hit of the plaster. */
const NRM_F = (SHADE_ITEM_BYTES - 32) / 4
function rays() {
    const f = new Float32Array(RAY_F * N), u = new Uint32Array(f.buffer), m = 1e-3    // the engine's metres
    for (let i = 0; i < N; i++) {
        const o = RAY_F * i
        f.set([(X0 + i * DX) * m, 0.3 * m, 50 * m], o); f.set([0, 0, -1], o + 4)
        f[o + 12] = 1; f[o + 13] = 1; f[o + 14] = 1
        u[o + 15] = 0; f[o + 16] = 1; f[o + 17] = 0; u[o + 18] = 0; u[o + 19] = 0; u[o + 20] = i; f[o + 21] = 1
        u[o + 22] = 0; f[o + 23] = 0; f[o + 24] = -1; f[o + 25] = 0; f[o + 26] = 0
    }
    return f
}
/* calcNormals_fast as the optics trace has it, over a shade buffer's hits: the function's own text, and SDFd's, cut from
   PROCESSING_ASKS (the rest of it reaches the optics module's buffers) */
const fnOf = (src, name) => {
    const i = src.indexOf(`fn ${name}(`)
    let j = src.indexOf('{', i)
    for (let d = 0; ; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break }
    return src.slice(i, j + 1)
}
const prog_fast = scene => WG.makeCompute(`${SCENE_PRELUDE}${sceneConstantsWGSL(scene)}${scene.wgsl}${normalAtHitWGSL(scene.wgsl)}
${fnOf(PROCESSING_ASKS, 'SDFd')}
${fnOf(PROCESSING_ASKS, 'calcNormals_fast')}
`, `
        let i = gid.x;
        if (i >= arrayLength(&fastOut)) { return; }
        let hit = shadeBuffer[i].hit;
        fastOut[i] = vec4<f32>(calcNormals_fast(hit.r, hit), 0.0);`,
    computeUniformTypes(scene.uniforms), { shadeBuffer: 'array<ShadeItem>', fastOut: 'array<vec4<f32>>', ...(scene.resources || {}) },
    { async: false, wg: [64, 1, 1] })
/* the march, pass after pass as the renderer chains it (bake.gpu.mjs's), then the surface kernel over its hits, and
   calcNormals_fast over them: each ray's two normals, by its index */
async function normals(scene) {
    const [march, surface, fast] = await Promise.all([prog_march(WG, scene, 64), prog_surface(WG, scene, 64), prog_fast(scene)])
    await Promise.all([march.ready, surface.ready, fast.ready])
    const r0 = rays()
    const mb0 = WG.createStorageBuffer(r0), mb1 = WG.createStorageBuffer(r0.byteLength)
    const shade = WG.createStorageBuffer(SHADE_ITEM_BYTES * N), counters = WG.createStorageBuffer(4 * Math.max(COUNTER_WORDS, 4))
    const learn = WG.createStorageBuffer(4 * LEARN_WORDS)
    march.resources = { marchBuffer0: mb0.b, marchBuffer1: mb1.b, shadeBuffer: shade.b, counters: counters.b }
    let inCount = N, readfrom = 0, shaded = 0
    for (let p = 0; p < 80 && inCount > 0; p++) {
        counters.w(counterWords({ [readfrom]: inCount, 2: shaded, 3: readfrom }))
        march.uniforms = { ...bag, lastpass: p === 79 ? 1 : 0 }
        march.dispatch(Math.ceil(inCount / 64), 1, 1)
        const c = await counters.r(Uint32Array)
        shaded = c[2]; inCount = readfrom === 0 ? c[1] : c[0]; readfrom = 1 - readfrom
    }
    counters.w(counterWords({ 2: shaded }))
    surface.resources = { shadeBuffer: shade.b, counters: counters.b, learn: learn.b }
    surface.uniforms = bag
    surface.dispatch(Math.ceil(shaded / 64), 1, 1)
    const fastB = WG.createStorageBuffer(16 * shaded)
    fast.resources = { shadeBuffer: shade.b, fastOut: fastB.b }
    fast.uniforms = bag
    fast.dispatch(Math.ceil(shaded / 64), 1, 1)
    const h = await shade.r(Float32Array), hu = new Uint32Array(h.buffer), f = await fastB.r(Float32Array)
    const out = new Array(N).fill(null)
    for (let k = 0; k < shaded; k++) {
        const o = ITEM_F * k
        out[hu[o + 20]] = { n: [h[o + NRM_F], h[o + NRM_F + 1], h[o + NRM_F + 2]], fast: [f[4 * k], f[4 * k + 1], f[4 * k + 2]], z: h[o + 2] * 1e3, state: hu[o + 19] }
    }
    for (const b of [mb0, mb1, shade, counters, learn, fastB]) b.b.destroy()
    return out
}
/* the pick (core/pick.js) of the scene's pick copy, one ray a dispatch as the page asks it (raytrace_main.js R.pick): its
   normal for each of the rays from..to of the row */
async function picks(scene, from, to) {
    const prog = await prog_pick(WG, scene); await prog.ready
    const inB = WG.createStorageBuffer(32), outB = WG.createStorageBuffer(PICK_WORDS * 4)
    prog.resources = { pickIn: inB.b, pickOut: outB.b }
    prog.uniforms = bag
    const out = []
    for (let i = from; i <= to; i++) {
        inB.w(new Float32Array([(X0 + i * DX) * 1e-3, 0.3e-3, 50e-3, 0, 0, 0, -1, 0]))
        prog.dispatch(1, 1, 1)
        out.push(readPick(await outB.r(PICK_WORDS * 4, 0, Uint32Array)))
    }
    inB.b.destroy(); outB.b.destroy()
    return out
}
const angle = (a, b) => Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) * 180 / Math.PI
const across = (hits, key = 'n', i0 = 0) => {
    let worst = 0, at = 0
    for (let i = 1; i < hits.length; i++) { const a = angle(hits[i - 1][key], hits[i][key]); if (a > worst) { worst = a; at = X0 + (i0 + i - 0.5) * DX } }
    return { worst, at }
}

for (const [label, scene] of [['now', S], ['as it was', WAS]]) {
    let hits = null, why = ''
    try { hits = await normals(scene) } catch (e) { why = e?.message ?? String(e) }
    ok(`${label}: the march, the surface kernel and calcNormals_fast compile and run on Dawn`, !!hits, why.slice(0, 400))
    if (!hits) continue
    const good = h => h && h.state === 0 && Math.abs(h.z) < 1 && Math.abs(Math.hypot(...h.n) - 1) < 1e-3
    ok(`${label}: every ray of the row hits the plaster, and its normal reads back a unit vector`, hits.every(good), JSON.stringify(hits.find(h => !good(h))))
    const r = across(hits)
    // calcNormals_fast, the optics trace's, over the same hits; and the pick, ray by ray within 0.2 mm of the edge
    const f = across(hits, 'fast')
    const P0 = Math.round((34.12 - X0) / DX), P1 = Math.round((34.52 - X0) / DX)
    const pk = await picks(scene, P0, P1), p = across(pk, 'normal', P0)
    ok(`${label}: every pick finds the plaster, its normal a unit vector`, pk.every(q => q.hit && Math.abs(Math.hypot(...q.normal) - 1) < 1e-3))
    say(`  ${label}: neighbouring normals 4 um apart turn by up to ${r.worst.toFixed(3)} deg in the surface kernel (at x ${r.at.toFixed(3)} mm), `
        + `${f.worst.toFixed(3)} by calcNormals_fast (at ${f.at.toFixed(3)}), ${p.worst.toFixed(3)} in the pick (at ${p.at.toFixed(3)})`)
    if (label === 'now') {
        ok('now: every normal about +z, the plaster face\'s', hits.every(h => h.n[2] > 0.9 && h.fast[2] > 0.9) && pk.every(q => q.normal[2] > 0.9),
            JSON.stringify(hits.find(h => !(h.n[2] > 0.9 && h.fast[2] > 0.9))))
        ok('now: no line -- neighbouring normals within a tenth of a degree all the way across, in the surface kernel', r.worst < 0.1, `${r.worst} deg at x ${r.at}`)
        ok('...in calcNormals_fast', f.worst < 0.1, `${f.worst} deg at x ${f.at}`)
        ok('...and in the pick', p.worst < 0.1, `${p.worst} deg at x ${p.at}`)
    } else {
        const line = q => q.worst > 5 && Math.abs(q.at - 34.32) < 0.2
        ok('as it was: the line, where the stucco\'s band ends (x about 34.3), in the surface kernel', line(r), `${r.worst} deg at x ${r.at}`)
        ok('...in calcNormals_fast', line(f), `${f.worst} deg at x ${f.at}`)
        ok('...and in the pick', line(p), `${p.worst} deg at x ${p.at}`)
    }
}

say(`relief normal on a GPU: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
