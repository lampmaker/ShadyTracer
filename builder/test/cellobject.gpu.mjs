//======================================================================================================================
// THE CLOSEST OBJECT PER CELL, COUNTED BEFORE IT IS BUILT (the step cache's third step; the user, 2026-10-07: "storing the
// ID of the SDF it needs to evaluate for cells close to a surface ... if you need to do only 1 SDF instead of all objects
// that would help right"). Run:
//   node builder/test/cellobject.gpu.mjs
//
// OPTIONAL, AND LOUD ABOUT IT, as the other GPU tests are: the `webgpu` package and a Vulkan driver (lavapipe), or it says
// so and passes.
//
// THE IDEA: a cell of the step cache filled once keeps, beside its ball (the distance to the nearest surface from its
// centre), the top-level node A that surface belongs to and dRest, the nearest of all the others there. At a point p in
// the cell no other node is nearer than dRest - |p - c| (each distance is a lower bound that changes by at most one a
// unit). So where that still clears A's own distance at p, A alone answers the step: one node evaluated instead of every
// node whose box p is near, and no box test. Where it does not (near where two nodes meet), the scene is asked as now.
//
// WHAT IS COUNTED, per bench scene, along the bench's own camera (64 x 36 rays) and shadow rays from where they end toward
// one direction -- three marches along the same rays, each to its own end:
//   plain    the scene as codegen marches it, culled by its measured boxes (codegen.js culled): a node farther than its
//            box's margin answers with its box distance, the others are evaluated
//   cache    the same with the step cache filled once, own cell (wavefront.js stepCacheWGSL's once): a step inside a ball
//            that reaches a cell or more takes no evaluation
//   object   the cache, and A alone where it answers, as above; else the scene as plain asks it
// per ray: moves, full scene calls, A-alone calls, node evaluations (a top-level node's whole subtree, whatever it holds)
// and box tests. Each node's distance is its own scene's (the document with that node alone, no boxes), so the full
// distance is their least -- the roots of the bench scenes are plain unions, checked.
// SOUND OR NOT, checked: every ray ends where plain's does (but the share the march's tolerance decides, as the step-cache
// GPU test allows), and every A-alone step against the least of all the nodes' own distances there.
// A SIMULATION ON THE CPU of the march's rules (tracebasics.js marchEps, stepscale, maxiter, the escape radius), with the
// distances from the GPU. COUNTS, NOT TIMES (CLAUDE.md): what an evaluation costs is the card's to say.
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(closest-object count SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const M = await import('../model.js')
const { generate, isCsg } = await import('../codegen.js')
const { cullBoxes, createBoxes, toLocalOf } = await import('../boxes.js')
const { stepCacheBox } = await import('../stepbox.js')
const { marchTolAt } = await import('../../lib/pathtracer/core/tolerances.js')
const { prog_tagfield, tagFieldTags } = await import('../../lib/pathtracer/core/field.js')
const { CAMERAS, BENCH_FILES, benchUrl } = await import('../../bench/index.js')
const { CAMERAS: SCALING_CAMERAS, SCALING_FILES } = await import('../../bench/scaling.js')
const { WEBGPU } = await import('../../lib/tinywebgpu/src/tinywebgpu.js')
const { UniformSpec, computeUniformTypes, sceneConstantsWGSL } = await import('../../lib/pathtracer/core/uniforms.schema.js')
const { SCENE_PRELUDE } = await import('../../lib/pathtracer/core/scene_api.js')
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
    console.log(`(closest-object count SKIPPED: no WebGPU device -- ${e?.message ?? e}.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const say = console.log
console.warn = () => { }

const flat = v => v && typeof v === 'object' ? (Array.isArray(v) ? v : Object.values(v)) : v
function uniformBag(scene) {
    const v = Object.fromEntries(Object.entries(UniformSpec).map(([k, s]) => [k, s.def]))
    const out = { ...v, ...derive(v, { unit: scene.unit ?? 'm', extent: scene.extent ?? null, envRadius: scene.envRadius ?? null }) }
    for (const [k, u] of Object.entries(scene.uniforms || {})) out[k] = flat(u.def)
    return out
}
/* the boxes, measured as the page measures them (stepcache.gpu.mjs measure) */
async function measure(doc, scene) {
    const prog = await prog_tagfield(WG, scene); await prog.ready
    const sample = async input => {
        const count = new Uint32Array(input.buffer, input.byteOffset, 4)[3]
        const inB = WG.createStorageBuffer(input), outB = WG.createStorageBuffer(Math.max(8 * count, 256))
        prog.resources = { fieldIn: inB.b, fieldOut: outB.b }
        prog.uniforms = { ...uniformBag(scene), res: [64, 64] }
        prog.run(count, 1, 1)
        const out = await outB.r(8 * count, 0, Float32Array)
        inB.b.destroy(); outB.b.destroy()
        const n = out.length / 2, d = new Float32Array(n), tag = new Uint32Array(n), bits = new Uint32Array(out.buffer, out.byteOffset, out.length)
        for (let i = 0; i < n; i++) { d[i] = out[2 * i]; tag[i] = bits[2 * i + 1] }
        return { d, tag, tags: tagFieldTags(scene) }
    }
    const B = createBoxes({ sample, doc: () => doc }); await B.update()
    return B
}
const unit = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l) }
function cameraRays(cam, W, H) {
    const RAD = Math.PI / 180, az = cam.azimuth * RAD, el = (90 - cam.elevation) * RAD
    const pos = [0, 1, 2].map(k => cam.target[k] + cam.distance * [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)][k])
    const z = unit(pos.map((v, k) => v - cam.target[k])), x = unit([-z[1], z[0], 0]), y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]]
    const t = Math.tan(cam.fov * RAD / 2), rays = []
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const u = ((i + 0.5) / W * 2 - 1) * t * W / H, v = ((j + 0.5) / H * 2 - 1) * t
        rays.push({ o: pos.slice(), d: unit([0, 1, 2].map(k => -z[k] + u * x[k] + v * y[k])) })
    }
    return rays
}

/* A NODE'S OWN DISTANCE, as a function of points: the document with that top-level node alone, generated without boxes
   (its distance, not its box's), evaluated on the GPU. Signed, as the scene folds it; the march reads its magnitude. */
async function nodeEvaluator(doc, node) {
    const d = structuredClone(doc)
    d.root.children = [structuredClone(node)]
    const S = generate(...M.generateArgs(d, { id: 'built', cull: false }))
    const prog = await WG.makeCompute(`${SCENE_PRELUDE}${sceneConstantsWGSL(S)}${S.wgsl}`, `
        _ = UB.res;
        let i = gid.x;
        if (i >= arrayLength(&ptOut)) { return; }
        let h = SDF(newRay(ptIn[i].xyz, VEC3(0.0, 0.0, 1.0), VEC4(1.0), 1.5));
        ptOut[i] = h.s.w;`,
        computeUniformTypes(S.uniforms), { ptIn: 'array<vec4<f32>>', ptOut: 'array<f32>', ...(S.resources || {}) }, { async: false, wg: [64, 1, 1] })
    await prog.ready
    const bag = { ...uniformBag(S), res: [64, 64] }
    const CHUNK = 65535 * 64
    return async pts => {                               // pts: Float32Array of xyzw; resolves to Float32Array of distances
        const n = pts.length / 4, out = new Float32Array(n)
        for (let from = 0; from < n; from += CHUNK) {
            const m = Math.min(CHUNK, n - from)
            const inB = WG.createStorageBuffer(pts.subarray(4 * from, 4 * (from + m))), outB = WG.createStorageBuffer(4 * Math.max(m, 4))
            prog.resources = { ptIn: inB.b, ptOut: outB.b }
            prog.uniforms = bag
            prog.dispatch(Math.ceil(m / 64), 1, 1)
            out.set((await outB.r(4 * m, 0, Float32Array)).subarray(0, m), from)
            inB.b.destroy(); outB.b.destroy()
        }
        return out
    }
}

const CELLS = 1e6, W = 64, H = 36, SHARE = 0.005, ROUNDS = 1500
const L = unit([0.3, 0.2, 0.93])

/* ONE SCENE: the nodes, their boxes as codegen culls them, the cells, and the three marches */
async function count(label, file, cam) {
    const doc = M.parse(readFileSync(fileURLToPath(benchUrl(file)), 'utf8'))
    ok(`${label}: the root a plain union (so the scene's distance is the least of its top-level nodes')`, !isCsg(doc.root) && !(doc.root.blend > 0))
    const S = generate(...M.generateArgs(doc, { id: 'built' }))
    const B = await measure(doc, S)
    const tops = (doc.root.children || []).filter(n => n.enabled !== false && n.type !== 'export' && n.type !== 'haze')
    const N = tops.length
    const evals = []
    for (const n of tops) evals.push(await nodeEvaluator(doc, n))
    const base = uniformBag(S)
    const unitScale = base.sceneUnit || 1
    /* THE MARCH'S HIT TEST AT A POINT (0.36.0): the setting, never finer than f32 resolves there (core/tolerances.js
       marchTolAt, the shader's marchTol), in metres -- here in the scene's numbers; the culling margin ten of it there
       (the scene's cullMargin, through SCN_TOL). `offset` is ten of it at the origin: the shadow rays' back-off and what
       counts as one place */
    const setting = base.eps > 0 ? base.eps : base.epsAuto
    const tolAt = p => marchTolAt(setting, p.map(x => x * unitScale)) / unitScale
    const offset = 10 * tolAt([0, 0, 0])
    const stepscale = base.stepscale, maxiter = base.maxiter
    const R = base.envRadius / unitScale, lmax = 1000 / unitScale
    /* the boxes codegen culls with: each top-level node's, in its own frame, times its scale -- null never culled */
    const cb = cullBoxes(doc, B)
    const box = tops.map(n => {
        const b = cb.get(n.id)
        return b ? { lo: b.lo, hi: b.hi, local: toLocalOf(doc, n.id), scale: n.transform?.scale ?? 1 } : null
    })
    const boxDist = (b, p) => {
        const q = b.local(p)
        const d = [0, 1, 2].map(k => Math.abs(q[k] - 0.5 * (b.lo[k] + b.hi[k])) - 0.5 * (b.hi[k] - b.lo[k]))
        return (Math.hypot(...d.map(v => Math.max(v, 0))) + Math.min(Math.max(...d), 0)) * b.scale
    }
    const boxTests = box.filter(Boolean).length
    /* THE CELLS, as R.setStepCacheBox cuts the box: per cell its ball (the least distance at its centre), A and dRest */
    const cbox = stepCacheBox(doc, B)
    ok(`${label}: a box for the cache`, !!cbox)
    const size = [0, 1, 2].map(k => cbox.hi[k] - cbox.lo[k]), cs = Math.cbrt(size[0] * size[1] * size[2] / CELLS)
    const dims = size.map(s => Math.max(1, Math.ceil(s / cs))), cells = dims[0] * dims[1] * dims[2]
    const centres = new Float32Array(4 * cells)
    for (let k = 0; k < cells; k++) {
        const x = k % dims[0], y = Math.floor(k / dims[0]) % dims[1], z = Math.floor(k / (dims[0] * dims[1]))
        centres[4 * k] = cbox.lo[0] + (x + 0.5) * cs; centres[4 * k + 1] = cbox.lo[1] + (y + 0.5) * cs; centres[4 * k + 2] = cbox.lo[2] + (z + 0.5) * cs
    }
    const r1 = new Float32Array(cells).fill(Infinity), r2 = new Float32Array(cells).fill(Infinity), A = new Int16Array(cells).fill(-1)
    for (let i = 0; i < N; i++) {
        const d = await evals[i](centres)
        for (let k = 0; k < cells; k++) {
            const a = Math.abs(d[k])
            if (a < r1[k]) { r2[k] = r1[k]; r1[k] = a; A[k] = i } else if (a < r2[k]) r2[k] = a
        }
    }
    const cellOf = p => {
        const g = [0, 1, 2].map(k => (p[k] - cbox.lo[k]) / cs)
        if (g.some((v, k) => v < 0 || v >= dims[k])) return -1
        return Math.floor(g[0]) + dims[0] * (Math.floor(g[1]) + dims[1] * Math.floor(g[2]))
    }
    const centreOf = k => [centres[4 * k], centres[4 * k + 1], centres[4 * k + 2]]

    /* THE MARCHES. A ray: { p, d, moves, calls, aCalls, nodeEvals, boxTests, ltot, end }. A round asks every node's
       distance at every live ray's point (all three ways together), then each way takes the step its rules allow. */
    const march = async (starts, maxRounds = ROUNDS) => {
        const ways = ['plain', 'cache', 'object']
        const R3 = ways.map(() => starts.map(s => ({ p: s.o.slice(), d: s.d.slice(), moves: 0, calls: 0, aCalls: 0, aHits: 0, nodeEvals: 0, callEvals: 0, boxTests: 0, ltot: 0, end: null })))
        let unsound = 0, aSteps = 0
        for (let round = 0; round < maxRounds; round++) {
            /* the cache moves first, with no evaluation, as the kernel's loop does: until the ray is in no ball that holds it */
            for (let w = 1; w < 3; w++) for (const r of R3[w]) {
                if (r.end) continue
                for (let guard = 0; guard < 10000; guard++) {
                    const k = cellOf(r.p)
                    if (k < 0) break
                    const c = centreOf(k), oc = r.p.map((v, j) => v - c[j]), c2 = oc[0] ** 2 + oc[1] ** 2 + oc[2] ** 2 - r1[k] ** 2
                    if (c2 >= 0) break
                    const b = oc[0] * r.d[0] + oc[1] * r.d[1] + oc[2] * r.d[2], exit = -b + Math.sqrt(b * b - c2)
                    if (exit < cs) break
                    const s = exit * stepscale
                    r.p = r.p.map((v, j) => v + r.d[j] * s); r.ltot += s; r.moves++
                    if (r.moves > maxiter) break
                }
            }
            const live = []
            R3.forEach((rs, w) => rs.forEach(r => { if (!r.end) live.push([w, r]) }))
            if (!live.length) break
            const pts = new Float32Array(4 * live.length)
            live.forEach(([, r], i) => pts.set(r.p, 4 * i))
            const D = []
            for (let i = 0; i < N; i++) D.push(await evals[i](pts))
            live.forEach(([w, r], li) => {
                const dist = i => Math.abs(D[i][li])
                let full = Infinity
                for (let i = 0; i < N; i++) full = Math.min(full, dist(i))
                /* the scene as codegen asks it: each culled node answers with its box distance, the others are evaluated */
                const culled = () => {
                    let m = Infinity, k = 0
                    for (let i = 0; i < N; i++) {
                        const bd = box[i] ? boxDist(box[i], r.p) : -1
                        if (bd > 10 * tolAt(r.p)) m = Math.min(m, bd); else { m = Math.min(m, dist(i)); k++ }
                    }
                    r.calls++; r.nodeEvals += k; r.callEvals += k; r.boxTests += boxTests
                    return m
                }
                let ea = null
                if (w === 2) {
                    const k = cellOf(r.p)
                    if (k >= 0 && A[k] >= 0) {
                        const c = centreOf(k), rest = r2[k] - Math.hypot(r.p[0] - c[0], r.p[1] - c[1], r.p[2] - c[2]), a = dist(A[k])
                        r.aCalls++; r.nodeEvals++
                        if (rest >= a) {
                            ea = a; aSteps++; r.aHits++
                            if (a > full * (1 + 1e-4) + 1e-6) unsound++        // A alone said more than every node's own distance
                        }
                    }
                }
                if (ea === null) ea = culled()
                if (r.ltot > lmax || r.moves > maxiter) { r.end = { state: 'maxiter', p: r.p }; return }
                if (r.p[0] * r.d[0] + r.p[1] * r.d[1] + r.p[2] * r.d[2] > 0 && r.p[0] ** 2 + r.p[1] ** 2 + r.p[2] ** 2 > R * R) { r.end = { state: 'escaped', p: r.p }; return }
                if (ea < tolAt(r.p)) { r.end = { state: 'hit', p: r.p }; return }
                const s = ea * stepscale
                r.p = r.p.map((v, j) => v + r.d[j] * s); r.ltot += s; r.moves++
            })
        }
        R3.forEach(rs => rs.forEach(r => { r.end ??= { state: 'cut', p: r.p } }))
        return { ways: R3, unsound, aSteps }
    }
    const summary = (rs, ref) => {
        const n = rs.length, sum = f => rs.reduce((s, r) => s + f(r), 0) / n
        const differ = ref ? rs.filter((r, i) => r.end.state !== ref[i].end.state || (r.end.state === 'hit'
            && Math.hypot(...r.end.p.map((v, j) => v - ref[i].end.p[j])) > offset)).length : 0
        const calls = rs.reduce((s, r) => s + r.calls, 0)
        return { moves: sum(r => r.moves), calls: sum(r => r.calls), aCalls: sum(r => r.aCalls), aHits: sum(r => r.aHits), nodeEvals: sum(r => r.nodeEvals),
                 perCall: calls ? rs.reduce((s, r) => s + r.callEvals, 0) / calls : 0,
                 boxTests: sum(r => r.boxTests), cut: rs.filter(r => r.end.state === 'cut').length, differ, n }
    }
    const line = (what, s) => `${what}: moves ${s.moves.toFixed(1)}, scene calls ${s.calls.toFixed(1)} (${s.perCall.toFixed(2)} nodes evaluated a call)`
        + (s.aCalls ? `, A tried ${s.aCalls.toFixed(1)} and answered ${s.aHits.toFixed(1)}` : '') + `, node evaluations ${s.nodeEvals.toFixed(1)}, box tests ${s.boxTests.toFixed(1)}`
        + (s.differ ? `; ${s.differ} of ${s.n} end otherwise` : '') + (s.cut ? `; ${s.cut} cut at ${ROUNDS} rounds` : '')
    const report = []
    const cam0 = await march(cameraRays(cam, W, H))
    const camS = cam0.ways.map((rs, w) => summary(rs, w ? cam0.ways[0] : null))
    // shadow rays from where plain's camera rays hit, backed off along them, toward one direction
    const shadowStarts = cam0.ways[0].filter(r => r.end.state === 'hit').map(r => ({ o: r.end.p.map((v, j) => v - r.d[j] * 2 * offset), d: L.slice() }))
    const sh0 = await march(shadowStarts)
    const shS = sh0.ways.map((rs, w) => summary(rs, w ? sh0.ways[0] : null))
    say(`  ${label} (${N} top-level nodes, ${boxTests} with a box; ${cells} cells of ${cs.toFixed(4)}): per camera ray`)
    ;['plain', 'cache', 'object'].forEach((w, i) => say(`    ${line(w, camS[i])}`))
    say(`    per shadow ray (${shS[0].n})`)
    ;['plain', 'cache', 'object'].forEach((w, i) => say(`    ${line(w, shS[i])}`))
    report.push({ label, camS, shS, N, boxTests })
    for (const [what, S3, M3] of [['camera', camS, cam0], ['shadow', shS, sh0]]) {
        ok(`${label}, ${what} rays: the cache and the closest object end every ray where plain does, but the march's tolerance's share`,
            S3[1].differ <= SHARE * S3[1].n && S3[2].differ <= SHARE * S3[2].n, `${S3[1].differ}, ${S3[2].differ} of ${S3[1].n}`)
        ok(`${label}, ${what} rays: A alone never said more than every node's own distance (${M3.aSteps} such steps)`, M3.unsound === 0, `${M3.unsound} of ${M3.aSteps}`)
    }
    return report
}

const SCENES = [
    ['the optics bench', SCALING_FILES.bench, SCALING_CAMERAS.bench],
    ['OpticsBench2', SCALING_FILES.bench2, SCALING_CAMERAS.bench2],
    ['the demo', BENCH_FILES.demo, CAMERAS.demo],
    ['the showcase', BENCH_FILES.showcase, CAMERAS.showcase],
    ['the material test', BENCH_FILES.materials, CAMERAS.materials],
    ['the Noise library', BENCH_FILES.noise, CAMERAS.noise],
    ['Surface materials', BENCH_FILES.surfaces, CAMERAS.surfaces],
]
const only = process.argv[2] ? new RegExp(process.argv[2], 'i') : null
for (const [label, file, cam] of SCENES) {
    if (only && !only.test(label)) continue
    const t0 = Date.now()
    await count(label, file, cam)
    say(`    (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
}
say(`closest object per cell, counted: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
