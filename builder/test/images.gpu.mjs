//======================================================================================================================
// PICTURES ON SURFACES ON A REAL WEBGPU (0.84.0; builder/images.js, lib/pathtracer/core/images.js). Run:
//   node builder/test/images.gpu.mjs
//
// OPTIONAL, AND LOUD ABOUT IT, as the other GPU checks: the `webgpu` package (npm i -g webgpu) and a Vulkan driver
// (lavapipe: apt-get install mesa-vulkan-drivers), or it says so and passes. Dawn compiles with Tint, the browser's
// compiler, which naga (check-shaders' fourth pass) is not.
//
// What it holds:
//   - THE MATERIAL, codegen and as data, through the scene's own getMaterial2 at points on a turned box: a glowing
//     picture's emission the JS twin's (core/images.js) times the luminance on its front, the material's own glow on a
//     side ('front' faces) and where the picture is transparent; a surface's base colour the picture's; the pattern
//     frame moving the picture as it moves a pattern; a slot's live value (its uniform written) moving it without a
//     compile;
//   - THE WHOLE RENDERER (R.trace, every kernel, the real tinywebgpu): a matte floor under a panel glowing with a black
//     and white checker, against the same panel glowing a uniform grey of the same mean -- light sampling on and off,
//     pixel by pixel. Inferred, and what this tests: emission that varies over a surface is evaluated where each
//     strategy's ray lands (lib/pathtracer/README.md, Emissive surfaces as lights), so far from a fine checker the floor
//     sees its mean; and a black square, where the point emits nothing and is the screen's dark surface, does not
//     break light sampling's discovery or its weights.
// WHAT IT CANNOT SHOW: the picture, or speed. Those are the user's (CLAUDE.md).
//======================================================================================================================
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

process.env.LP_NUM_THREADS ??= '0'
{
    let a = (Number(process.env.IMAGES_GPU_SEED ?? 1) >>> 0) || 1
    Math.random = () => {
        a = (a + 0x6D2B79F5) >>> 0
        let t = Math.imul(a ^ (a >>> 15), a | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(pictures GPU check SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const M = await import('../model.js')
const { PRESETS } = await import('../materials.js')
const { generate, uniformName } = await import('../codegen.js')
const { entryFromBytes, slotKey } = await import('../images.js')
const { slotMatrix, imageSampleJS, heightAtJS, heightStats, pack16 } = await import('../../lib/pathtracer/core/images.js')
const { WEBGPU } = await import('../../lib/tinywebgpu/src/tinywebgpu.js')
const { SCENE_PRELUDE } = await import('../../lib/pathtracer/core/scene_api.js')
const { sceneCompute } = await import('../../lib/pathtracer/core/images.js')
const U = await import('../../lib/pathtracer/core/uniforms.schema.js')
const { derive, LUMA } = await import('../../lib/pathtracer/core/photometry.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../lib/wgsl_shorthand.js')

Object.assign(globalThis, webgpu.globals)
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
    WG.defines = defines(TOKENS, SHORT_TOKENS)
} catch (e) {
    console.log(`(pictures GPU check SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const flat = v => typeof v === 'boolean' ? (v ? 1 : 0) : Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : v
const at = (x, y = 0, z = 0, rx = 0, ry = 0, rz = 0, scale = 1) => ({ pos: { x, y, z }, rot: { x: rx, y: ry, z: rz }, scale })

function uniformBag(scene) {
    const v = Object.fromEntries(Object.entries(U.UniformSpec).map(([k, s]) => [k, s.def]))
    const out = { ...v, ...derive(v, { unit: scene.unit ?? 'm', extent: scene.extent ?? null, envRadius: scene.envRadius ?? null }) }
    for (const [k, u] of Object.entries(scene.uniforms || {})) out[k] = flat(u.def)
    return out
}
/* ONE KERNEL, `n` threads: `body` writes 16 floats at evalOut[16i] for thread i, reading evalIn (lightface.gpu.mjs) --
   through sceneCompute, as every kernel holding the scene is made, so it is given the atlas read */
async function run(scene, body, input, n, values = {}) {
    const touch = Object.keys(scene.resources || {}).filter(k => k !== 'sceneImages').map(k => `_ = ${k}[0];`).join(' ')
    const main = `
        _ = UB.res; _ = evalIn[0]; ${touch}
        let i = gid.x;
        if (i >= ${n}u) { return; }
        ${body}`
    const prog = await sceneCompute(WG, scene, `${SCENE_PRELUDE}${U.sceneConstantsWGSL(scene)}${scene.wgsl}`, main,
        U.computeUniformTypes(scene.uniforms), { evalIn: 'array<vec4<f32>>', evalOut: 'array<f32>', ...(scene.resources || {}) },
        { async: false, wg: [64, 1, 1] })
    await prog.ready
    const inB = WG.createStorageBuffer(new Float32Array(Math.max(4, input.length))), outB = WG.createStorageBuffer(64 * n)
    WG.device.queue.writeBuffer(inB.b, 0, new Float32Array(input))
    const buffers = scene.init ? await scene.init(WG) : {}
    prog.resources = { evalIn: inB.b, evalOut: outB.b, ...buffers }
    prog.uniforms = { ...uniformBag(scene), res: [64, 64], ...values }
    prog.dispatch(Math.ceil(n / 64), 1, 1)
    const out = await outB.r(Float32Array)
    inB.b.destroy(); outB.b.destroy()
    return out
}

// a picture whose every texel is its own, opaque but for one column (alpha 0): 23 x 17
const PW = 23, PH = 17
const pixels = new Uint8Array(PW * PH * 4)
{
    let s = 5
    for (let i = 0; i < pixels.length; i++) { s = (s * 1103515245 + 12345) >>> 0; pixels[i] = s >>> 24 }
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) pixels[4 * (y * PW + x) + 3] = x === 7 ? 0 : 255
}
const picture = { width: PW, height: PH, pixels }
const pic = await entryFromBytes(pixels, { name: 'pattern.png', type: 'image/png', width: PW, height: PH })
/** The tree with each picture's pixels put beside its entry (a stand-in for decoding: builder/images.js makeAtlas). */
const withPixels = (tree, px) => { for (const [k, e] of Object.entries(tree.images ?? {})) tree.images[k] = { ...e, pixels: px[k] }; return tree }

/*----------------------------------------------------------------------------------------------------------------------
  THE MATERIAL AT POINTS ON A TURNED BOX: its top face (+z in its frame), its side, through getMaterial2 -- the local point
  captured as the renderer captures it (localPoint runs the SDF), at the hit's normal.
----------------------------------------------------------------------------------------------------------------------*/
const L = 750
const TURN = 30, POS = [0.3, -0.2, 0.5], HALF = [0.2, 0.15, 0.01], PAT = { x: 0.05, y: -0.03, z: 0 }
const slot = { size: { x: 90, y: 70 }, offset: { x: 12, y: -8 }, turn: 20, wrapU: 'mirror', wrapV: 'repeat' }
const mkDoc = ({ pattern = null } = {}) => {
    const d = M.createDoc({})
    M.addImage(d, pic)
    const screen = M.addMaterial(d, { id: 'screen', label: 'screen', preset: 'diffuse' })
    M.setMaterialType(d, 'screen', 'emitter')
    screen.params.emissiveLuminance = L
    M.addImageSlot(d, 'screen', pic.key, slot)
    M.addMaterial(d, { id: 'poster', label: 'poster', preset: 'diffuse' })
    M.addImageSlot(d, 'poster', pic.key, { ...slot, projection: 'box' })
    M.addObject(d, 'root', { id: 'panel', primitive: 'box', material: 'screen', params: { size: { x: 2 * HALF[0], y: 2 * HALF[1], z: 2 * HALF[2] }, rounding: 0 },
        transform: at(...POS, 0, 0, TURN) })
    M.addObject(d, 'root', { id: 'card', primitive: 'box', material: 'poster', params: { size: { x: 2 * HALF[0], y: 2 * HALF[1], z: 2 * HALF[2] }, rounding: 0 },
        transform: at(POS[0], POS[1] + 1, POS[2], 0, 0, TURN) })
    if (pattern) { M.setPattern(d, 'panel', { pos: pattern, rot: { x: 0, y: 0, z: 0 } }); M.setPattern(d, 'card', { pos: pattern, rot: { x: 0, y: 0, z: 0 } }) }
    ok('the probe scene: sound', M.validate(d).length === 0, JSON.stringify(M.validate(d)))
    return d
}
const c = Math.cos(TURN * Math.PI / 180), s = Math.sin(TURN * Math.PI / 180)
const toWorld = (lx, ly, lz, dy = 0) => [POS[0] + c * lx - s * ly, POS[1] + dy + s * lx + c * ly, POS[2] + lz]
const toWorldN = (nx, ny, nz) => [c * nx - s * ny, s * nx + c * ny, nz]

for (const data of [false, true]) for (const pattern of [null, PAT]) {
    const how = `${data ? 'as data' : 'codegen'}${pattern ? ', the pattern frame moved' : ''}`
    const d = mkDoc({ pattern })
    const [tree, opts] = M.generateArgs(d, { id: 'img-mat', data })
    const scene = generate(withPixels(tree, { [pic.key]: pixels }), opts)
    ok(`${how}: the atlas a resource, and init makes it`, scene.resources?.sceneImages === 'texture_2d<f32>' && typeof scene.init === 'function')
    // points: on the panel's top (local z = +half), on its side (local x = +half), and on the card's top and side
    const cases = []
    let seed = 3
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
    for (let k = 0; k < 48; k++) {
        const lx = (2 * rnd() - 1) * HALF[0] * 0.95, ly = (2 * rnd() - 1) * HALF[1] * 0.95
        cases.push({ mat: 'screen', l: [lx, ly, HALF[2]], n: [0, 0, 1], dy: 0 })
        cases.push({ mat: 'screen', l: [HALF[0], ly, (2 * rnd() - 1) * HALF[2] * 0.8], n: [1, 0, 0], dy: 0 })
        cases.push({ mat: 'poster', l: [lx, ly, HALF[2]], n: [0, 0, 1], dy: 1 })
        cases.push({ mat: 'poster', l: [HALF[0] , ly, (2 * rnd() - 1) * HALF[2] * 0.8], n: [1, 0, 0], dy: 1 })
    }
    const input = []
    for (const q of cases) input.push(...toWorld(...q.l, q.dy), 0, ...toWorldN(...q.n), q.mat === 'screen' ? 0 : 1)
    const ids = { screen: `matid_screen`, poster: `matid_poster` }
    const g = await run(scene, /*wgsl*/`
        let P = evalIn[2u * i].xyz; let N = evalIn[2u * i + 1u].xyz; let which = evalIn[2u * i + 1u].w;
        var r = newRay(P - N * 0.05, N, VEC4(1.0), 1.0);
        r.pos = P;
        var hit = emptyHit(r);
        hit.m = select(${ids.screen}, ${ids.poster}, which > 0.5); hit.a = 0u;
        hit.s = vec4<f32>(N, 0.0);
        let m = getMaterial2(hit, false);
        evalOut[16u * i] = m.emissive.x; evalOut[16u * i + 1u] = m.emissive.y; evalOut[16u * i + 2u] = m.emissive.z;
        evalOut[16u * i + 3u] = m.baseColor.x; evalOut[16u * i + 4u] = m.baseColor.y; evalOut[16u * i + 5u] = m.baseColor.z;
        evalOut[16u * i + 6u] = m.roughness;`, input, cases.length)
    const S = slotMatrix(M.imageSlotOf(d.materials[0].images[0]), scene.imageRects.get(pic.key))
    const Sb = slotMatrix(M.imageSlotOf(d.materials[1].images[0]), scene.imageRects.get(pic.key))
    const base = PRESETS.diffuse.params().baseColor
    let worstE = 0, worstB = 0, at1 = '', sideOwn = true, sawBlack = false
    cases.forEach((q, i) => {
        // the point in the pattern frame, mm: its local point less the frame's place
        const lq = [q.l[0] - (pattern?.x ?? 0), q.l[1] - (pattern?.y ?? 0), q.l[2] - (pattern?.z ?? 0)].map(v => v * 1000)
        const e = [g[16 * i], g[16 * i + 1], g[16 * i + 2]], b = [g[16 * i + 3], g[16 * i + 4], g[16 * i + 5]]
        if (q.mat === 'screen') {
            const t = imageSampleJS(S, picture, lq, q.n)
            const want = [0, 1, 2].map(k => L * (1 - t[3]) + t[k] * L * t[3])       // own glow white at L, where transparent
            const dE = Math.max(...want.map((w, k) => Math.abs(w - e[k]))) / L
            if (dE > worstE) { worstE = dE; at1 = `${JSON.stringify(q.l)} n ${q.n}: ${e} vs ${want}` }
            if (q.n[0] === 1 && !e.every(x => Math.abs(x - L) < 1e-3 * L)) sideOwn = false
            if (q.n[2] === 1 && t[3] === 1) sawBlack = true
        } else {
            const t = imageSampleJS(Sb, picture, lq, q.n)
            const want = [base.r, base.g, base.b].map((o, k) => o * (1 - t[3]) + t[k] * t[3])
            worstB = Math.max(worstB, ...want.map((w, k) => Math.abs(w - b[k])))
        }
    })
    ok(`${how}: a glowing picture's emission the twin's times the luminance, own glow where transparent (worst ${(worstE * 100).toFixed(3)} % of L)`, worstE < 3e-3, at1)
    ok(`${how}: the panel's side (not a front face) its own glow`, sideOwn)
    ok(`${how}: the cases hold the picture's opaque texels`, sawBlack)
    ok(`${how}: a surface's base colour the picture's, box-projected on its top and side (worst ${worstB.toExponential(2)})`, worstB < 3e-3)
    // the screen's surface under its glow (images.js SCREEN_DEFAULTS): its dark glass, read
    const rough = cases.map((q, i) => q.mat === 'screen' ? g[16 * i + 6] : null).filter(x => x !== null)
    ok(`${how}: the glowing picture keeps a surface under it, the screen's glass (roughness 0.05)`, rough.every(r => Math.abs(r - 0.05) < 1e-6), rough.slice(0, 3))

    // A SLOT'S LIVE VALUE: its uniform written with another offset, the same scene, the picture moved by it
    if (!data && !pattern) {
        const moved = { ...M.imageSlotOf(d.materials[0].images[0]), offset: { x: -30, y: 25 }, filter: 'pixels', wrapU: 'none' }
        const Sm = slotMatrix(moved, scene.imageRects.get(pic.key))
        const g2 = await run(scene, /*wgsl*/`
            let P = evalIn[2u * i].xyz; let N = evalIn[2u * i + 1u].xyz;
            var r = newRay(P - N * 0.05, N, VEC4(1.0), 1.0); r.pos = P;
            var hit = emptyHit(r); hit.m = matid_screen; hit.a = 0u; hit.s = vec4<f32>(N, 0.0);
            let m = getMaterial2(hit, false);
            evalOut[16u * i] = m.emissive.x; evalOut[16u * i + 1u] = m.emissive.y; evalOut[16u * i + 2u] = m.emissive.z;`,
            input, cases.length, { [uniformName('screen', slotKey('texture'))]: Sm })
        let worst = 0
        cases.forEach((q, i) => {
            if (q.mat !== 'screen' || q.n[2] !== 1) return
            const t = imageSampleJS(Sm, picture, q.l.map(v => v * 1000), q.n)
            const want = [0, 1, 2].map(k => L * (1 - t[3]) + t[k] * L * t[3])
            worst = Math.max(worst, ...want.map((w, k) => Math.abs(w - g2[16 * i + k]) / L))
        })
        ok(`a slot's uniform written live moves the picture, no compile (worst ${(worst * 100).toFixed(3)} % of L)`, worst < 3e-3)
    }
}

/*----------------------------------------------------------------------------------------------------------------------
  A RELIEF FROM A PICTURE (0.84.0; materials.js pictureRelief, core/images.js heightAt): a 60 x 40 x 4 mm plaque in a
  scene in mm, its top at z = 2, wearing a material whose picture -- random greys, sharp from texel to texel, so its slope
  is steep -- is its relief, 1.5 mm, the picture 3 x 2 mm, repeated across and mirrored up. Rays at 12 degrees above the plaque's plane,
  each in its own direction, marched through the scene's own SDF (codegen and as data): every one must stop where it
  first meets the relief, found here by stepping along it 2 microns at a time against the JS twin's height -- not later,
  through a bump. STRAIGHT DOWN WOULD PROVE NOTHING: along a vertical the field is z - 2 - h(x, y) exactly whatever the
  bound, and with the bound taken out (slope 0) every vertical ray still landed right. Run so, these rays do not: a bound
  under the true slope lets the march step through a bump, and that is what this catches. At 8 and at 16 bits, raised
  and engraved (raise -1). And the frames agree: the hit's material reads the picture where the relief put the surface
  (heightAt at its IMG_Q times the amplitude is the hit's height).
----------------------------------------------------------------------------------------------------------------------*/
for (const bits of [8, 16]) for (const raise of [1, -1]) for (const data of [false, true]) {
    const how = `a relief from a ${bits}-bit picture${raise < 0 ? ', engraved' : ''}, ${data ? 'as data' : 'codegen'}`
    const RW = 24, RH = 16
    let rs = 31 + bits + raise
    const rnd = () => { rs = (rs * 1103515245 + 12345) >>> 0; return rs >>> 16 }
    const px = bits === 16 ? pack16(new Uint16Array(RW * RH).map(() => rnd()), null, RW, RH)
        : (() => { const p = new Uint8Array(RW * RH * 4); for (let i = 0; i < RW * RH; i++) { const v = rnd() & 255; p.set([v, v, v, 255], 4 * i) } return p })()
    const img = { width: RW, height: RH, pixels: px }
    const ent = await entryFromBytes(px, { name: 'height.png', type: 'image/png', width: RW, height: RH })
    if (bits === 16) ent.entry.bits = 16
    ent.entry.heights = heightStats(img, { bits })
    const d = M.createDoc({})
    d.unit = 'mm'
    M.addImage(d, ent)
    M.addMaterial(d, { id: 'pl', label: 'plaque', preset: 'diffuse' })
    /* 3 x 2 mm a copy, so its slopes are steep -- eight texels a mm at 1.5 mm high: the steepest brute force finds is
       about 6.9, the bound 16 -- repeated across and mirrored up (both seams' bounds in play). Gentler, a march with no
       bound at all still landed right: at 60 x 40 mm (slopes of 0.6) and at 12 x 8 (1.7), too gentle to show anything. */
    M.addImageSlot(d, 'pl', ent.key, { size: { x: 3, y: 2 }, wrapU: 'repeat', wrapV: 'mirror', colour: false })
    M.setRelief(d, 'pl', 'picture')
    const R = M.material(d, 'pl').relief
    R.params.amplitude = 1.5; R.params.raise = raise
    M.addObject(d, 'root', { id: 'plaque', primitive: 'box', material: 'pl', params: { size: { x: 30, y: 20, z: 2 }, rounding: 0 }, transform: at(0, 0, 0) })   // half sizes
    ok(`${how}: the scene sound`, M.validate(d).length === 0, JSON.stringify(M.validate(d)))
    const [tree, opts] = M.generateArgs(d, { id: 'relief-pic', data })
    const scene = generate(withPixels(tree, { [ent.key]: px }), opts)
    const S = slotMatrix(M.imageSlotOf(M.material(d, 'pl').images[0]), scene.imageRects.get(ent.key), ent.entry)
    const N = 400
    const pts = []
    let ps = 9
    const prnd = () => { ps = (ps * 1664525 + 1013904223) >>> 0; return ps / 2 ** 32 }
    // each ray: a start over the plaque, 12 degrees above its plane, its own heading
    const EL = 12 * Math.PI / 180
    for (let k = 0; k < N; k++) {
        const az = 2 * Math.PI * prnd(), dx = Math.cos(EL) * Math.cos(az), dy = Math.cos(EL) * Math.sin(az), dz = -Math.sin(EL)
        const tz = (5.5 - 2) / Math.sin(EL), x0 = 40 * prnd() - 20, y0 = 26 * prnd() - 13     // where it would reach z = 2
        pts.push(x0 - dx * tz, y0 - dy * tz, 5.5, 0, dx, dy, dz, 0)
    }
    const g = await run(scene, /*wgsl*/`
        let o = evalIn[2u * i].xyz; let dir = evalIn[2u * i + 1u].xyz;
        var r = newRay(o, dir, VEC4(1.0), 1.0);
        var t = 0.0;
        var steps = 0u;
        for (var k = 0u; k < 4000u; k++) {
            r.pos = o + dir * t;
            let hit = SDF(r);
            if (abs(hit.s.w) < 1.0e-4) { break; }
            t += hit.s.w;
            steps++;
        }
        evalOut[16u * i] = t;
        evalOut[16u * i + 1u] = f32(steps);
        // the hit's material: where it reads the picture, through the capture the renderer makes
        var hh = emptyHit(r);
        hh.m = matid_pl; hh.a = 0u; hh.s = vec4<f32>(0.0, 0.0, 1.0, 0.0);
        let m = getMaterial2(hh, false);
        evalOut[16u * i + 2u] = heightAt(UB.${uniformName('pl', slotKey('texture'))}, IMG_Q).x;
        evalOut[16u * i + 3u] = m.roughness;`, pts, N)
    let worst = 0, below = 0, frames = 0, at1 = '', maxSteps = 0
    for (let k = 0; k < N; k++) {
        const o = pts.slice(8 * k, 8 * k + 3), dir = pts.slice(8 * k + 4, 8 * k + 7)
        const surf = tt => o[2] + dir[2] * tt - 2 - 1.5 * raise * heightAtJS(S, img, [o[0] + dir[0] * tt, o[1] + dir[1] * tt, 0])[0]
        // the first crossing: 2 microns at a time along the ray, then halved down to a nanometre
        let a0 = 0, want = null
        for (let tt = 0; tt < 80; tt += 0.002) { if (surf(tt) <= 0) { let lo = a0, hi = tt; for (let b = 0; b < 30; b++) { const mdl = (lo + hi) / 2; if (surf(mdl) <= 0) hi = mdl; else lo = mdl } want = hi; break } a0 = tt }
        const t = g[16 * k]
        if (want == null) { below++; continue }
        /* ON THE SURFACE, AND NOT PAST ITS FIRST CROSSING. Not "at the first crossing": a ray grazing a bump's top within the
           march's tolerance (|d| < 1e-4) is a hit there, as the renderer's is -- one stopped 0.7 mm before the crossing, 0.4
           microns above a bump, the GPU's height and the twin's there agreeing to 2e-7 -- and it is the right answer */
        const err = Math.abs(surf(t))                                // how far the hit is from the surface, in height
        if (err > worst) { worst = err; at1 = `ray ${k}: t ${t}, the first crossing ${want}, ${err} mm off the surface` }
        if (t > want + 0.01) below++
        const z = o[2] + dir[2] * t
        frames = Math.max(frames, Math.abs(2 + 1.5 * raise * g[16 * k + 2] - z))
        maxSteps = Math.max(maxSteps, g[16 * k + 1])
    }
    ok(`${how}: every ray at 12 degrees stops on the relief (worst ${worst.toExponential(2)} mm off it, ${maxSteps} steps at most)`, worst < 0.002 && maxSteps < 4000, at1)
    ok(`${how}: none went past it -- the march never stepped through a bump`, below === 0, `${below} of ${N}`)
    ok(`${how}: the material reads the picture where the relief is (the frames agree, worst ${frames.toExponential(2)} mm)`, frames < 0.01)
}

/*----------------------------------------------------------------------------------------------------------------------
  THE WHOLE RENDERER: a white matte floor under a 0.3 x 0.3 m panel 0.6 m up, its face down glowing with a picture of
  8 x 8 black and white squares (pixels: each square one texel, sharp), against the same panel glowing a uniform picture
  of one grey whose linear value is the checker's mean as near as a byte can say (188: 0.5029). The camera below the
  panel, so only the floor is in view; light tracing off (lightface.gpu.mjs: no optics module here). The two floors' ratio
  is the means' ratio, 0.5 / 0.5029, light sampling on and off.
----------------------------------------------------------------------------------------------------------------------*/
{
    const { RAYTRACER } = await import('../../lib/pathtracer/core/raytrace_main.js')
    const { CAMERA } = await import('../../lib/camera.js')
    const { engineCamera } = await import('../../lib/pathtracer/core/units.js')
    const { effective } = await import('../../lib/pathtracer/quality.js')
    const quietly = async f => { const e = console.error, w = console.warn, l = console.log, i = console.info
        console.error = console.warn = console.log = console.info = () => { }; try { return await f() } finally { console.error = e; console.warn = w; console.log = l; console.info = i } }

    const N8 = 8
    const checker = new Uint8Array(N8 * N8 * 4), grey = new Uint8Array(N8 * N8 * 4)
    for (let y = 0; y < N8; y++) for (let x = 0; x < N8; x++) {
        const v = (x + y) % 2 ? 255 : 0
        checker.set([v, v, v, 255], 4 * (y * N8 + x)); grey.set([188, 188, 188, 255], 4 * (y * N8 + x))
    }
    const lin = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    const ratio = 0.5 / lin(188 / 255)
    const sceneOf = async (px, key) => {
        const e = await entryFromBytes(px, { name: key, type: 'image/png', width: N8, height: N8 })
        const d = M.createDoc({})
        M.addImage(d, e)
        M.addMaterial(d, { id: 'matte', params: { ...PRESETS.diffuse.params(), baseColor: { r: 0.8, g: 0.8, b: 0.8 }, specular: 0 } })
        const scr = M.addMaterial(d, { id: 'scr', label: 'screen', preset: 'diffuse' })
        M.setMaterialType(d, 'scr', 'emitter')
        scr.params.emissiveLuminance = 2000
        // its face down: the box turned 180 degrees about x, so its frame's +z (the picture's front) points at the floor
        M.addImageSlot(d, 'scr', e.key, { size: { x: 300, y: 300 }, filter: 'pixels', wrapU: 'clamp', wrapV: 'clamp' })
        M.addObject(d, 'root', { id: 'floor', primitive: 'box', material: 'matte', params: { size: { x: 1.5, y: 1.5, z: 0.05 }, rounding: 0 }, transform: at(0, 0, -0.025) })
        M.addObject(d, 'root', { id: 'panel', primitive: 'box', material: 'scr', params: { size: { x: 0.3, y: 0.3, z: 0.004 }, rounding: 0 }, transform: at(0, 0, 0.6, 180, 0, 0) })
        const [tree, opts] = M.generateArgs(d, { id: `img-${key}` })
        return generate(withPixels(tree, { [e.key]: px }), opts)
    }
    const W = 24, H = 24
    const target = WG.device.createTexture({ size: [W, H], format: WG.format, usage: GPUTextureUsage.RENDER_ATTACHMENT }).createView()
    const cam = CAMERA({ aspect: W / H, fov: 50, up: [0, 0, 1] })
    cam.setPose({ pos: [0, -1.1, 0.3], target: [0, 0, 0], up: [0, 0, 1] })
    const render = async (scene, over, samples) => {
        const Q = { w: W, h: H, resetframecount: 1 }
        const R = RAYTRACER(WG, null, Q, scene)
        R.hud = () => { }
        let err = null
        try { await quietly(() => R.init()) } catch (e) { err = e?.message ?? String(e) }
        const v = { ...U.defaultUniformValues(), envMode: 0, sunIlluminance: 0, skyIlluminance: 0, nee: 1, lt: 0, maxbounce: 3, rr: 0,
                    fireflyClamp: 0, maxaverages: 0, autoExposure: 0, sppm: 0, ...over }
        const traced = effective(v)
        const derived = derive(traced, { unit: scene.unit, extent: scene.extent, envRadius: scene.envRadius, tolerance: scene.tolerance })
        const EC = engineCamera(cam.getUniforms(), 0, derived.sceneUnit)
        const bag = Object.fromEntries(Object.entries({ ...Object.fromEntries(Object.entries(traced).map(([k, x]) => [k, U.uniformToGPU(x, U.UniformSpec[k]?.type)])),
            ...derived, invView: EC.invView, invProjection: EC.invProjection, camPos: EC.camPos, camLens: EC.camLens, camtype: 0 })
            .filter(([k]) => k in U.ComputeUniformTypes || k in U.UniformSpec))
        for (const [k, u] of Object.entries(scene.uniforms || {})) bag[k] = flat(u.def)
        if (!err) try {
            R.kernelOptions = R.kernelOptionsOf(bag)
            await quietly(() => R.applyKernelOptions())
            for (let done = 0; done < samples; done += 16) {
                await quietly(() => R.trace(Q, bag, Math.min(16, samples - done), target))
                Q.resetframecount = 0
                await WG.device.queue.onSubmittedWorkDone()
            }
        } catch (e) { err = e?.message ?? String(e) }
        const a = err ? null : await R.accumulation_u32.r(W * H * 16, 0, Uint32Array)
        const f = a && new Float32Array(a.buffer, a.byteOffset, a.length)
        return { err, img: f ? Array.from({ length: W * H }, (_, i) => LUMA[0] * f[i * 4] + LUMA[1] * f[i * 4 + 1] + LUMA[2] * f[i * 4 + 2]) : [] }
    }
    const paired = (a, b) => {
        const idx = a.map((_, i) => i).filter(i => b[i] > 0)
        const n = idx.length, mb = idx.reduce((s, i) => s + b[i], 0) / n
        const dd = idx.map(i => a[i] - b[i]), md = dd.reduce((s, x) => s + x, 0) / n
        return { n, mean: 1 + md / mb, se: Math.sqrt(dd.reduce((s, x) => s + (x - md) ** 2, 0) / (n - 1) / n) / mb }
    }
    const pm = p => `${p.mean.toFixed(4)} +- ${p.se.toFixed(4)}`
    const t0 = Date.now()
    const sc = await sceneOf(checker, 'checker'), sg = await sceneOf(grey, 'grey')
    const runs = {}
    for (const [k, over, n] of [['on', { nee: 1 }, 384], ['off', { nee: 0 }, 2048]]) {
        runs[k] = [await render(sc, over, n), await render(sg, over, n)]
        ok(`light sampling ${k}: both renders ran`, runs[k].every(r => r.err === null), runs[k].map(r => r.err).join(' | '))
    }
    for (const [k, [a, b]] of Object.entries(runs)) {
        if (a.err !== null || b.err !== null) continue
        const p = paired(a.img, b.img)
        console.log(`  light sampling ${k}: the checker's floor ${pm(p)} of the grey's (${p.n} pixels; the means' ratio ${ratio.toFixed(4)}), ${((Date.now() - t0) / 1000).toFixed(0)} s`)
        ok(`light sampling ${k}: a glowing checker lights the floor as its mean does, ${pm(p)} against ${ratio.toFixed(4)}`,
            p.n > W * H / 3 && Math.abs(p.mean - ratio) < Math.max(0.015, 3.5 * p.se), pm(p))
    }
    if (runs.on.every(r => r.err === null) && runs.off.every(r => r.err === null)) {
        const p = paired(runs.on[0].img, runs.off[0].img)
        ok(`...and the checker's floor with light sampling on is its floor with it off, ${pm(p)}`, Math.abs(p.mean - 1) < Math.max(0.02, 3.5 * p.se), pm(p))
    }
}

console.log(`pictures on Dawn: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
