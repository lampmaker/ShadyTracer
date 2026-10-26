//======================================================================================================================
// ANSWERS ALONG THE RAY, COUNTED BEFORE THEY ARE BUILT (the user, 2026-10-26: "exact (no stepping) intersection solutions
// for basic shapes (plane, circle, etc) possibly including relief (check if there is any intersection possible at all). It
// could improve rays traveling fairly parallel to surfaces"). Run:
//   node builder/test/alongray.gpu.mjs
//
// OPTIONAL, AND LOUD ABOUT IT, as the other GPU tests are: the `webgpu` package and a Vulkan driver (lavapipe), or it says
// so and passes.
//
// THE IDEA. Sphere tracing steps a ray by its distance to the nearest surface, and a ray running nearly parallel to a
// surface closes on it by about (1 - sin theta) a step: many steps, and at a graze it runs out of them (the prism scene's
// slit beam on the table, drawn only by the exact hits removed in 0.41.0: roadmap/ARCHITECTURE.md, Removed in 0.41.0). A
// closed-form shape can say instead how far along the ray its boundary first is -- entering or leaving -- and the ray may
// go that far at once. The step is the least of those answers and stepscale times every other fold's distance; the first
// crossing of any hard union, subtraction or intersection is no nearer than the least first crossing of its shapes, so
// that is safe wherever no blend or warp bends the surface.
//
// WHAT IS BUILT HERE, AND ONLY HERE (no renderer change):
//   - THE ANSWERS (ALONG_WGSL, and their JS twins): a plane, a rounded box (exact when sharp; with rounding the outer box
//     from outside, else none), a sphere, a capped cylinder, a rectangle sheet, and a plane relief's band (|z| <= a: a ray
//     that never meets the slab never meets the relief; inside it, the relief steps as now). Each against its twin and
//     against a brute march of its own distance in JS.
//   - THE SCENE'S TEXT WITH ANSWERS (alongText), codegen's own with one line changed an answering object: one plain
//     shape under plain groups and arrays only, answering in its own frame (transpose(XF_M) * r.dir, a length there times
//     XF_S). The rule is modelled by asking the scene twice: as it is, for the hit test, and, away from a surface, with
//     the answering shapes left out -- everything else's distance -- the step the least of that (stepscale of it, the
//     march's own rule) and the answers. (Asking twice is the test's way to the rule, not its cost: codegen knows which
//     shapes it folds.)
//   - RUN THROUGH THE RENDERER'S OWN MARCH (prog_march, distance only): its loop, its hit test, its escape and maxiter.
// WHAT IS COUNTED, per bench scene (the bench's camera, 64 x 36 rays, codegen with measured boxes) and the prism scene:
// camera rays, and shadow rays from where they end towards a sun at 50 and at 5 degrees -- steps a ray, how each ends (a
// hit, the sky, out of steps), and how the answers' ends differ from the plain march's; and in the prism scene, rays
// lowered onto the table at 0.1 to 0.5 degrees: how many reach it within maxiter.
// WHAT MUST HOLD: the twins; the text with its answers off marching as the plain march does, bit for bit; and no answered
// ray through a solid -- the plain field traced along every stretch the answers skipped past a plain hit (skippedChecker).
// What does go on past a plain hit is a graze: the plain march stops a tolerance short of a surface, eps / sin(theta)
// along a ray at a shallow angle, where an answer lands on it -- or brushes an edge an answer passes.
// COUNTS, NOT TIMES (CLAUDE.md): what an answer costs beside a distance is the card's to say.
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

let webgpu = null
try { webgpu = await import('webgpu') } catch {
    try { webgpu = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'webgpu/index.js')).href) } catch { }
}
if (!webgpu) { console.log('(along-the-ray count SKIPPED: no webgpu package. npm i -g webgpu to get it, and a Vulkan driver: lavapipe in a container.)'); process.exit(0) }

const M = await import('../model.js')
const { generate, isCsg, boxLoName, boxHiName } = await import('../codegen.js')
const { plainShapeOf } = await import('../plainshape.js')
const { lineage } = await import('../bounds.js')
const { cullBoxes, createBoxes, cullUniforms } = await import('../boxes.js')
const { prog_tagfield, tagSample, TAG_FIELD_WORDS } = await import('../../lib/pathtracer/core/field.js')
const { CAMERAS, BENCH_FILES, benchUrl } = await import('../../bench/index.js')
const { CAMERAS: SCALING_CAMERAS, SCALING_FILES } = await import('../../bench/scaling.js')
const { WEBGPU } = await import('../../lib/tinywebgpu/src/tinywebgpu.js')
const { prog_march, counterWords, COUNTER_WORDS } = await import('../../lib/pathtracer/core/wavefront.js')
const { RAY_BYTES, SHADE_ITEM_BYTES } = await import('../../lib/pathtracer/core/tracebasics.js')
const U = await import('../../lib/pathtracer/core/uniforms.schema.js')
const { derive } = await import('../../lib/pathtracer/core/photometry.js')
const { SCENE_PRELUDE } = await import('../../lib/pathtracer/core/scene_api.js')
const { defines, TOKENS, SHORT_TOKENS } = await import('../../lib/wgsl_shorthand.js')

Object.assign(globalThis, webgpu.globals)
let WG = null
try {
    globalThis.__dawn ??= webgpu.create([])
    WG = WEBGPU()
    await WG.init(0, {}, globalThis.__dawn)
    WG.defines = defines(TOKENS, SHORT_TOKENS)
} catch (e) {
    console.log(`(along-the-ray count SKIPPED: no WebGPU device -- ${e?.message ?? e}. In a container, apt-get install mesa-vulkan-drivers.)`)
    process.exit(0)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const say = console.log
const t0 = Date.now()

/*----------------------------------------------------------------------------------------------------------------------
  THE ANSWERS: how far along a unit direction ld, from p, a shape's boundary first is, in the shape's own frame.
  A crossing t >= 0, NEVER (1e30) when the ray never meets it, NONE (-1) when this shape cannot say (its distance then).
----------------------------------------------------------------------------------------------------------------------*/
const NEVER = 1e30, NONE = -1
const ALONG_WGSL = /* wgsl */ `
const AL_NEVER: f32 = 1.0e30;
const AL_NONE: f32 = -1.0;
/* the ray's interval in a slab lo..hi along one axis: (t0, t1), empty as t0 > t1 */
fn alSlab(o: f32, d: f32, lo: f32, hi: f32) -> vec2<f32> {
    if (abs(d) < 1.0e-30) { return select(vec2<f32>(1.0, -1.0), vec2<f32>(-AL_NEVER, AL_NEVER), o >= lo && o <= hi); }
    let a = (lo - o) / d; let b = (hi - o) / d;
    return vec2<f32>(min(a, b), max(a, b));
}
/* the first crossing of a solid's interval along the ray: its entry ahead, or its exit from inside, or never */
fn alFirst(i: vec2<f32>) -> f32 {
    if (i.x > i.y) { return AL_NEVER; }
    if (i.x > 0.0) { return i.x; }
    if (i.y > 0.0) { return i.y; }
    return AL_NEVER;
}
fn alBox(p: VEC3, ld: VEC3, b: VEC3) -> vec2<f32> {
    let x = alSlab(p.x, ld.x, -b.x, b.x); let y = alSlab(p.y, ld.y, -b.y, b.y); let z = alSlab(p.z, ld.z, -b.z, b.z);
    return vec2<f32>(max(x.x, max(y.x, z.x)), min(x.y, min(y.y, z.y)));
}
fn Aplane(p: VEC3, ld: VEC3) -> f32 {
    if (abs(ld.z) < 1.0e-30) { return AL_NEVER; }
    let t = -p.z / ld.z;
    return select(AL_NEVER, t, t > 0.0);
}
fn AboxRounded(p: VEC3, ld: VEC3, b: VEC3, r: FLOAT) -> f32 {
    if (r <= 0.0) { return alFirst(alBox(p, ld, b)); }
    // rounded: its outer box from outside (an entry no later than the shape's), and nothing to say from inside it
    if (all(abs(p) <= b)) { return AL_NONE; }
    let i = alBox(p, ld, b);
    return select(AL_NEVER, i.x, i.x <= i.y && i.x > 0.0);
}
fn Asphere(p: VEC3, ld: VEC3, r: FLOAT) -> f32 {
    let b = dot(p, ld); let c = dot(p, p) - r * r; let disc = b * b - c;
    if (disc < 0.0) { return AL_NEVER; }
    let s = sqrt(disc);
    return alFirst(vec2<f32>(-b - s, -b + s));
}
fn Acylinder(p: VEC3, ld: VEC3, h: FLOAT, r: FLOAT) -> f32 {
    let z = alSlab(p.z, ld.z, -h, h);
    let a = dot(ld.xy, ld.xy);
    var c2 = vec2<f32>(-AL_NEVER, AL_NEVER);
    if (a < 1.0e-30) {
        if (dot(p.xy, p.xy) > r * r) { return AL_NEVER; }
    } else {
        let b = dot(p.xy, ld.xy); let c = dot(p.xy, p.xy) - r * r; let disc = b * b - a * c;
        if (disc < 0.0) { return AL_NEVER; }
        let s = sqrt(disc);
        c2 = vec2<f32>((-b - s) / a, (-b + s) / a);
    }
    return alFirst(vec2<f32>(max(z.x, c2.x), min(z.y, c2.y)));
}
fn Arectangle(p: VEC3, ld: VEC3, h: VEC2) -> f32 {
    if (abs(ld.z) < 1.0e-30) { return AL_NEVER; }
    let t = -p.z / ld.z;
    if (t <= 0.0) { return AL_NEVER; }
    return select(AL_NEVER, t, all(abs(p.xy + t * ld.xy) <= h));
}
/* A PLANE RELIEF'S BAND, |z| <= a: its entry ahead; NONE inside it (the relief steps by its own bound there) */
fn AplaneBand(p: VEC3, ld: VEC3, a: FLOAT) -> f32 {
    if (abs(p.z) <= a) { return AL_NONE; }
    let i = alSlab(p.z, ld.z, -a, a);
    return select(AL_NEVER, i.x, i.x <= i.y && i.x > 0.0);
}
`
/* ...their JS twins, the same arithmetic in doubles */
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const slab = (o, d, lo, hi) => {
    if (Math.abs(d) < 1e-30) return o >= lo && o <= hi ? [-NEVER, NEVER] : [1, -1]
    const a = (lo - o) / d, b = (hi - o) / d
    return [Math.min(a, b), Math.max(a, b)]
}
const first = ([t0, t1]) => t0 > t1 ? NEVER : t0 > 0 ? t0 : t1 > 0 ? t1 : NEVER
const boxI = (p, d, b) => { const s = [0, 1, 2].map(k => slab(p[k], d[k], -b[k], b[k])); return [Math.max(...s.map(x => x[0])), Math.min(...s.map(x => x[1]))] }
const JS = {
    plane: (p, d) => { if (Math.abs(d[2]) < 1e-30) return NEVER; const t = -p[2] / d[2]; return t > 0 ? t : NEVER },
    box: (p, d, b, r) => {
        if (r <= 0) return first(boxI(p, d, b))
        if ([0, 1, 2].every(k => Math.abs(p[k]) <= b[k])) return NONE
        const i = boxI(p, d, b); return i[0] <= i[1] && i[0] > 0 ? i[0] : NEVER
    },
    sphere: (p, d, r) => { const b = dot3(p, d), c = dot3(p, p) - r * r, disc = b * b - c; if (disc < 0) return NEVER; const s = Math.sqrt(disc); return first([-b - s, -b + s]) },
    cylinder: (p, d, h, r) => {
        const z = slab(p[2], d[2], -h, h), a = d[0] ** 2 + d[1] ** 2
        let c2 = [-NEVER, NEVER]
        if (a < 1e-30) { if (p[0] ** 2 + p[1] ** 2 > r * r) return NEVER }
        else { const b = p[0] * d[0] + p[1] * d[1], c = p[0] ** 2 + p[1] ** 2 - r * r, disc = b * b - a * c; if (disc < 0) return NEVER; const s = Math.sqrt(disc); c2 = [(-b - s) / a, (-b + s) / a] }
        return first([Math.max(z[0], c2[0]), Math.min(z[1], c2[1])])
    },
    rectangle: (p, d, h) => { if (Math.abs(d[2]) < 1e-30) return NEVER; const t = -p[2] / d[2]; if (t <= 0) return NEVER; return Math.abs(p[0] + t * d[0]) <= h[0] && Math.abs(p[1] + t * d[1]) <= h[1] ? t : NEVER },
    band: (p, d, a) => { if (Math.abs(p[2]) <= a) return NONE; const i = slab(p[2], d[2], -a, a); return i[0] <= i[1] && i[0] > 0 ? i[0] : NEVER },
}
/* ...and each shape's own distance (sdf.js's), for the brute force: signed for the solids, |z| past a sheet */
const SDF = {
    plane: p => p[2],
    box: (p, b, r) => { const q = [0, 1, 2].map(k => Math.abs(p[k]) - (b[k] - r)); return Math.hypot(...q.map(v => Math.max(v, 0))) + Math.min(Math.max(...q), 0) - r },
    sphere: (p, r) => Math.hypot(...p) - r,
    cylinder: (p, h, r) => { const d = [Math.hypot(p[0], p[1]) - r, Math.abs(p[2]) - h]; return Math.min(Math.max(d[0], d[1]), 0) + Math.hypot(Math.max(d[0], 0), Math.max(d[1], 0)) },
    band: (p, a) => Math.abs(p[2]) - a,
}

/*----------------------------------------------------------------------------------------------------------------------
  1. THE TWINS: each answer against its JS twin on the GPU, and the JS against a brute march of the shape's own field
----------------------------------------------------------------------------------------------------------------------*/
{
    let seed = 12345
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    const dirOf = () => { const z = 2 * rnd() - 1, a = 2 * Math.PI * rnd(), s = Math.sqrt(1 - z * z); return [s * Math.cos(a), s * Math.sin(a), z] }
    // shapes: [name, wgsl call, js answer, js field (null for the sheet), the field's own kind]
    const B = [0.7, 0.4, 0.5], RR = 0.15
    const shapes = [
        ['plane', 'Aplane(p, d)', (p, d) => JS.plane(p, d), p => SDF.plane(p)],
        ['sharp box', `AboxRounded(p, d, VEC3(${B}), 0.0)`, (p, d) => JS.box(p, d, B, 0), p => SDF.box(p, B, 0)],
        ['rounded box', `AboxRounded(p, d, VEC3(${B}), ${RR})`, (p, d) => JS.box(p, d, B, RR), p => SDF.box(p, B, RR)],
        ['sphere', 'Asphere(p, d, 0.6)', (p, d) => JS.sphere(p, d, 0.6), p => SDF.sphere(p, 0.6)],
        ['cylinder', 'Acylinder(p, d, 0.5, 0.4)', (p, d) => JS.cylinder(p, d, 0.5, 0.4), p => SDF.cylinder(p, 0.5, 0.4)],
        ['rectangle', 'Arectangle(p, d, VEC2(0.6, 0.3))', (p, d) => JS.rectangle(p, d, [0.6, 0.3]), null],
        ['plane band', 'AplaneBand(p, d, 0.05)', (p, d) => JS.band(p, d, 0.05), p => SDF.band(p, 0.05)],
    ]
    const N = 1500, rays = []
    for (let i = 0; i < N; i++) {
        // half the rays aimed near the shape (most meet it), half anywhere; a tenth nearly parallel to z = 0
        const p = [0, 1, 2].map(() => 3 * (2 * rnd() - 1))
        let d = i % 2 ? dirOf() : (() => { const q = [0, 1, 2].map(() => 0.5 * (2 * rnd() - 1)); const v = q.map((x, k) => x - p[k]); const l = Math.hypot(...v); return v.map(x => x / l) })()
        if (i % 10 === 3) { d[2] = (2 * rnd() - 1) * 0.01; const l = Math.hypot(...d); d = d.map(x => x / l) }
        rays.push([p, d])
    }
    const inB = new Float32Array(8 * N)
    rays.forEach(([p, d], i) => { inB.set(p, 8 * i); inB.set(d, 8 * i + 4) })
    for (const [name, call, js, field] of shapes) {
        const prog = await WG.makeCompute(`${ALONG_WGSL}`, `
            let i = gid.x;
            if (i >= arrayLength(&tOut)) { return; }
            let p = rIn[2u * i].xyz; let d = rIn[2u * i + 1u].xyz;
            tOut[i] = ${call};`, {}, { rIn: 'array<vec4<f32>>', tOut: 'array<f32>' }, { async: false, wg: [64, 1, 1] })
        await prog.ready
        const a = WG.createStorageBuffer(inB), b = WG.createStorageBuffer(4 * N)
        prog.resources = { rIn: a.b, tOut: b.b }
        prog.dispatch(Math.ceil(N / 64), 1, 1)
        const g = await b.r(4 * N, 0, Float32Array)
        a.b.destroy(); b.b.destroy()
        let twinBad = 0, past = 0, early = 0, met = 0, never = 0, none = 0
        rays.forEach(([p0, d0], i) => {
            // the ray as the GPU had it (f32), so both sides answer the same question
            const p = Array.from(inB.subarray(8 * i, 8 * i + 3)), d = Array.from(inB.subarray(8 * i + 4, 8 * i + 7))
            const t = js(p, d), tg = g[i]
            const same = t === NEVER ? tg >= 1e29 : t === NONE ? tg === -1 : Math.abs(tg - t) <= 1e-4 * Math.max(1, t)
            if (!same) twinBad++
            if (t === NONE) { none++; return }
            // THE BRUTE FORCE: the field along the ray in steps of 2e-3 to 8 (every crossing is nearer), its first change of sign
            // (a sheet: of z within it)
            const dt = 2e-3
            let tTrue = NEVER, prev = null
            for (let s = 0; s <= 8; s += dt) {
                const q = [0, 1, 2].map(k => p[k] + s * d[k])
                const v = field ? field(q) : (Math.abs(q[0]) <= 0.6 && Math.abs(q[1]) <= 0.3 ? q[2] : null)
                if (v !== null && prev !== null && Math.sign(v) !== Math.sign(prev) && s > 0) { tTrue = s; break }
                prev = v
            }
            if (t >= NEVER) { never++; if (tTrue < NEVER && tTrue < 7.9) past++; return }
            met++
            if (t > tTrue + 2 * dt) past++                    // the answer beyond the true first crossing: unsafe
            else if (name !== 'rounded box' && tTrue < NEVER && t < tTrue - 2 * dt) early++
        })
        say(`  ${name}: ${met} met, ${never} never, ${none} no answer; ${past} past the field's first crossing, ${early} short of it, ${twinBad} unlike the JS twin`)
        ok(`the answer for a ${name}: the WGSL its JS twin's`, twinBad === 0, `${twinBad} of ${N}`)
        // a graze within the brute march's step can flip either way: allow a few in ten thousand
        ok(`...never beyond the shape's first crossing by the brute march (a safe step)`, past <= Math.ceil(N * 5e-4), `${past} of ${N}`)
        if (name !== 'rounded box') ok(`...and exactly it (within the brute march's step), not short of it`, early <= Math.ceil(N * 5e-4), `${early} of ${N}`)
    }
}

/*----------------------------------------------------------------------------------------------------------------------
  2. THE SCENE'S TEXT WITH ANSWERS: codegen's own, the plain shapes answering along the ray
  THE RULE, MODELLED BY ASKING TWICE: the scene as it is, for the hit test; and, away from a surface, the scene again with
  the answering shapes left out -- what everything else's distance is -- the step the least of that (stepscale of it, the
  march's rule) and the answers. Nothing else in the text is touched: every fold, CULL, a CSG group's or group code's own
  hit, a warp's children, all as codegen wrote them. (A first version kept a least distance through wrappers on every
  fold, and took a CSG child's or a shell's children's distances for the scene's -- near zero inside a skin, a false hit
  -- and missed a warp's children, which fold into the scene's own hit one XF_SUB down: both caught by its own check.)
  Asking twice is the test's way to the rule, not what it costs: codegen knows which shapes it folds, and would keep the
  rest's distance beside the answers in one evaluation.
----------------------------------------------------------------------------------------------------------------------*/
const ANSWER_OF = { Nplane: 'Aplane', NboxRounded: 'AboxRounded', Nsphere: 'Asphere', Ncylinder: 'Acylinder', Nrectangle: 'Arectangle' }
/* an object whose code is one plain shape with an answer, under nothing but plain groups and arrays (no CSG, no blend, no
   group code: a warp bends the ray, a blend the surface, code anything) */
function answerable(doc, node) {
    if (node.kind !== 'object' || node.type !== 'code') return null
    const ps = plainShapeOf(M.codeOf(doc, node))
    if (!ps || !ANSWER_OF[ps.fn]) return null
    const above = lineage(doc, node.id).slice(1)
    if (above.some(g => g !== doc.root && (isCsg(g) || M.codeOf(doc, g) || g.blend > 0))) return null
    if (doc.root.blend > 0) return null
    return ps
}
/** The scene's text with the answerable shapes answering. `on` false: none answer, the text otherwise the same (it is
 *  then the plain march's, bit for bit: checked). Returns { wgsl, answered, reliefs }. */
function alongText(doc, S, on = true) {
    let w = S.wgsl.replace(/\bfn SDF\(r: Ray\) -> Hit \{/, 'fn SDF_inner(r: Ray) -> Hit {')
    let answered = 0, reliefs = 0
    const all = []; const walk = n => { all.push(n); (n.children || []).forEach(walk) }; walk(doc.root)
    for (const node of all) {
        const ps = answerable(doc, node)
        if (!ps) continue
        const at = w.indexOf(`// node ${node.id} (code)`)
        if (at < 0) continue
        const next = w.indexOf('// node ', at + 10), end = next < 0 ? w.length : next
        let block = w.slice(at, end)
        const rs = `rs_${node.id}`
        if (block.includes(`var ${rs} =`)) {
            /* A MATERIAL RELIEF: only on a plane is its band a slab with an answer (anything else as now). The far fold --
               the base's distance less the amplitude, beyond twice it -- is what the band's answer replaces; the near one,
               the relief's own distance, stays */
            if (ps.fn !== 'Nplane') continue
            const ra = `ra_${node.id}`, rm = `rm_${node.id}`
            const far = `C = fold(C, VEC4(0.0, 0.0, 0.0, ${rs}.w - sign(${rs}.w) * ${ra}), ${rm});`
            if (!block.includes(far)) continue
            block = block.replace(far, `C = alFar(C, VEC4(0.0, 0.0, 0.0, ${rs}.w - sign(${rs}.w) * ${ra}), ${rm});`)
            block = block.replace(new RegExp(`(let ${ra} = [^;]*;)`), `$1 alBand(AplaneBand(p, transpose(XF_M) * r.dir, ${ra} / XF_S));`)
            reliefs++
        } else {
            const line = block.split('\n').find(l => /C = add_new\(C, \w+\(p/.test(l) && plainShapeOf(l.replace(/^\s*/, '')))
            if (!line) continue
            const args = ps.args.length ? ', ' + ps.args.join(', ') : ''
            block = block.replace(line, `C = add_along(C, ${ps.fn}(p${args}), ${ANSWER_OF[ps.fn]}(p, transpose(XF_M) * r.dir${args}), MATERIAL);`)
        }
        answered++
        w = w.slice(0, at) + block + w.slice(end)
    }
    const head = /* wgsl */ `
${ALONG_WGSL}
const AL_ON: bool = ${on};
var<private> AL_REST: bool = false;    // the second asking: the answering shapes left out, their answers kept
var<private> AL_T: f32 = 1.0e30;       // the least answer along the ray, scene units
/* a shape that answers: folded as ever the first time; the second, its answer instead (none: folded as ever) */
fn add_along(C: Hit, sdf: VEC4, t: f32, m: u32) -> Hit {
    if (!AL_REST || t < 0.0) { return add_new(C, sdf, m); }
    AL_T = min(AL_T, t * XF_S);
    return C;
}
/* a plane relief: its band's answer (a local length; none inside the band), and the far fold it stands for */
var<private> AL_BAND: bool = false;
fn alBand(t: f32) { AL_BAND = AL_REST && t >= 0.0; if (AL_BAND) { AL_T = min(AL_T, t * XF_S); } }
fn alFar(C: Hit, sdf: VEC4, m: u32) -> Hit { if (AL_BAND) { return C; } return fold(C, sdf, m); }
`
    const tail = /* wgsl */ `
fn SDF(r: Ray) -> Hit {
    AL_REST = false; AL_BAND = false;
    var h = SDF_inner(r);
    // at a surface, or with no answers: the hit as it is
    if (!AL_ON || abs(h.s.w) < SCN_TOL) { return h; }
    AL_REST = true; AL_T = 1.0e30;
    let rest = SDF_inner(r);
    AL_REST = false; AL_BAND = false;
    /* the distance whose step (stepscale of it) is the least safe one -- never under the tolerance, which the march would
       take for a surface (a step of stepscale of it is safe here, the true distance being no less) */
    let reach = 2.0 * UB.envRadius * scenePerEng();
    h.s.w = max(min(min(abs(rest.s.w), AL_T / UB.stepscale), reach), SCN_TOL);
    return h;
}
`
    return { wgsl: head + w + tail, answered, reliefs }
}

/*----------------------------------------------------------------------------------------------------------------------
  3. THE MARCHES: the renderer's own (distance only), plain, answers off and answers on, along the same rays
----------------------------------------------------------------------------------------------------------------------*/
const flat = v => v && typeof v === 'object' ? (Array.isArray(v) ? v : Object.values(v)) : v
const sceneValues = scene => Object.fromEntries(Object.entries(scene.uniforms || {}).map(([k, u]) => [k, flat(u.def)]))
function uniformBag(scene) {
    const v = Object.fromEntries(Object.entries(U.UniformSpec).map(([k, s]) => [k, s.def]))
    return { ...v, ...derive(v, { unit: scene.unit ?? 'm', extent: scene.extent ?? null, envRadius: scene.envRadius ?? null, haze: scene.haze ?? null }), ...sceneValues(scene) }
}
async function measure(doc, scene) {
    const prog = await prog_tagfield(WG, scene); await prog.ready
    const sample = async input => {
        const count = new Uint32Array(input.buffer, input.byteOffset, 4)[3]
        const inB = WG.createStorageBuffer(input), outB = WG.createStorageBuffer(Math.max(4 * TAG_FIELD_WORDS * count, 256))
        prog.resources = { fieldIn: inB.b, fieldOut: outB.b }
        prog.uniforms = { ...uniformBag(scene), res: [64, 64] }
        prog.run(count, 1, 1)
        const out = await outB.r(4 * TAG_FIELD_WORDS * count, 0, Float32Array)
        inB.b.destroy(); outB.b.destroy()
        return tagSample(out, scene)
    }
    const B = createBoxes({ sample, doc: () => doc }); await B.update()
    return B
}
const cullOf = (doc, S, B) => {
    const cull = {}
    for (const [id, b] of cullBoxes(doc, B)) { if (!(boxLoName(id) in (S.uniforms || {}))) continue; const { lo, hi } = cullUniforms(b); cull[boxLoName(id)] = lo; cull[boxHiName(id)] = hi }
    return cull
}
const RAY_F = RAY_BYTES / 4, HIT_F = SHADE_ITEM_BYTES / 4
function raysOf(pts, dirs) {
    const n = pts.length / 3, f = new Float32Array(RAY_F * n), u = new Uint32Array(f.buffer)
    for (let i = 0; i < n; i++) {
        const o = RAY_F * i
        f.set(pts.slice(3 * i, 3 * i + 3), o); f.set(dirs.slice(3 * i, 3 * i + 3), o + 4)
        f[o + 12] = 1; f[o + 13] = 1; f[o + 14] = 1
        u[o + 15] = 0; f[o + 16] = 1; f[o + 17] = 0; u[o + 18] = 0; u[o + 19] = 0; u[o + 20] = i; f[o + 21] = 1
        u[o + 22] = 0; f[o + 23] = 0; f[o + 24] = -1; f[o + 25] = 0; f[o + 26] = 0
    }
    return f
}
const unit = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l) }
const eyeOf = cam => {
    const RAD = Math.PI / 180, az = cam.azimuth * RAD, el = (90 - cam.elevation) * RAD
    return [0, 1, 2].map(k => cam.target[k] + cam.distance * [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)][k])
}
function cameraRays(cam, W, H) {
    const pos = eyeOf(cam), RAD = Math.PI / 180
    const z = unit(pos.map((v, k) => v - cam.target[k])), x = unit([-z[1], z[0], 0]), y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]]
    const t = Math.tan(cam.fov * RAD / 2), pts = [], dirs = []
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const u = ((i + 0.5) / W * 2 - 1) * t * W / H, v = ((j + 0.5) / H * 2 - 1) * t
        pts.push(...pos); dirs.push(...unit([0, 1, 2].map(k => -z[k] + u * x[k] + v * y[k])))
    }
    return { pts, dirs }
}
const inMetres = (rays, u) => { const r = rays.slice(); for (let i = 0; i < r.length / RAY_F; i++) for (let c = 0; c < 3; c++) r[RAY_F * i + c] *= u; return r }
/* every ray to its end through the renderer's march: { pos (scene units), steps, state } -- a ray still marching after
   the passes: state -1 */
async function marchAll(prog, bag, rays0, buffers, passes = 40) {
    const n = rays0.length / RAY_F, u = bag.sceneUnit, rays = inMetres(rays0, u)
    const mb0 = WG.createStorageBuffer(rays), mb1 = WG.createStorageBuffer(rays.byteLength)
    const shade = WG.createStorageBuffer(HIT_F * 4 * n), counters = WG.createStorageBuffer(4 * Math.max(COUNTER_WORDS, 4))
    prog.resources = { marchBuffer0: mb0.b, marchBuffer1: mb1.b, shadeBuffer: shade.b, counters: counters.b, ...buffers }
    let inCount = n, readfrom = 0, shaded = 0
    for (let p = 0; p < passes && inCount > 0; p++) {
        counters.w(counterWords({ [readfrom]: inCount, 2: shaded, 3: readfrom }))
        prog.uniforms = { ...bag, lastpass: 0 }
        prog.dispatch(Math.ceil(inCount / 64), 1, 1)
        const c = await counters.r(Uint32Array)
        shaded = c[2]; inCount = readfrom === 0 ? c[1] : c[0]; readfrom = 1 - readfrom
    }
    const h = await shade.r(Float32Array), hu = new Uint32Array(h.buffer)
    const out = Array.from({ length: n }, () => ({ pos: null, steps: 0, state: -1 }))
    for (let k = 0; k < shaded; k++) {
        const o = HIT_F * k
        out[hu[o + 20]] = { pos: [h[o] / u, h[o + 1] / u, h[o + 2] / u], steps: hu[o + 15] & 0xffff, state: hu[o + 19] }
    }
    for (const b of [mb0, mb1, shade, counters]) b.b.destroy()
    return out
}
const HIT = 0, SKY = 2, OUT = 4
/* how the answered march's ends compare with the plain one's, ray by ray */
function compare(origins, plain, along, tol) {
    const c = { n: plain.length, sameEnd: 0, reached: 0, passed: 0, other: 0, stepsP: 0, stepsA: 0, outP: 0, outA: 0, skyP: 0, skyA: 0 }
    const tOf = (h, i) => h.pos ? Math.hypot(...h.pos.map((v, k) => v - origins[3 * i + k])) : Infinity
    plain.forEach((p, i) => {
        const a = along[i]
        c.stepsP += p.steps; c.stepsA += a.steps
        if (p.state === OUT || p.state === -1) c.outP++
        if (a.state === OUT || a.state === -1) c.outA++
        if (p.state === SKY) c.skyP++
        if (a.state === SKY) c.skyA++
        const pHit = p.state === HIT, aHit = a.state === HIT
        if (pHit && aHit && Math.abs(tOf(p, i) - tOf(a, i)) <= 4 * tol) c.sameEnd++
        else if (!pHit && p.state !== SKY && aHit) c.reached++               // plain ran out; the answers reached a surface
        else if (pHit && (!aHit || tOf(a, i) > tOf(p, i) + 4 * tol)) c.passed++   // a surface plain met, the answers went on
        else if (p.state === a.state && !pHit) c.sameEnd++
        else c.other++
    })
    return c
}
const pct = (a, n) => `${(100 * a / Math.max(n, 1)).toFixed(1)}%`
const fmt = c => `steps a ray ${(c.stepsP / c.n).toFixed(1)} -> ${(c.stepsA / c.n).toFixed(1)}; out of steps ${c.outP} -> ${c.outA}; sky ${c.skyP} -> ${c.skyA}; same end ${pct(c.sameEnd, c.n)}, reached ${c.reached}, passed ${c.passed}, other ${c.other}`

/* THE STRETCH THE ANSWERS SKIPPED, CHECKED: where the plain march hit and the answers went on, the plain scene's own field
   (SDF, every shape, no culling) traced along the ray from the plain hit to where the answers ended -- by half the
   distance, never under a quarter of the tolerance, so a thin plate is not stepped over. Inside a solid by more than two
   tolerances anywhere there: the answers passed through it. Else a graze: the plain march stops a tolerance short of a
   surface, eps / sin(theta) along a grazing ray, where an answer lands on it -- or brushes an edge an answer passes. */
async function skippedChecker(S) {
    const prog = await WG.makeCompute(`${SCENE_PRELUDE}${U.sceneConstantsWGSL(S)}${S.wgsl}`, `
        _ = UB.res;
        let i = gid.x;
        if (i >= arrayLength(&segOut)) { return; }
        let o = segIn[2u * i].xyz; let t1 = segIn[2u * i].w;
        let d = segIn[2u * i + 1u].xyz; let tol = segIn[2u * i + 1u].w;
        var t = 0.0; var least = 1.0e30; var n = 0u;
        loop {
            if (t > t1 || n >= 200000u) { break; }
            let h = SDF(newRay(o + t * d, d, VEC4(1.0), 1.5));
            least = min(least, h.s.w);
            if (h.s.w < -2.0 * tol) { break; }
            t = t + max(0.5 * abs(h.s.w), 0.25 * tol);
            n = n + 1u;
        }
        segOut[i] = vec2<f32>(least, select(0.0, 1.0, t > t1));`,
        U.computeUniformTypes(S.uniforms), { segIn: 'array<vec4<f32>>', segOut: 'array<vec2<f32>>', ...(S.resources || {}) }, { async: false, wg: [64, 1, 1] })
    await prog.ready
    const bag = { ...uniformBag(S), res: [64, 64] }
    return async segs => {                    // [o (3), length, dir (3), tol] each; resolves to [least distance, finished]
        if (!segs.length) return []
        const n = segs.length / 8, inB = WG.createStorageBuffer(new Float32Array(segs)), outB = WG.createStorageBuffer(8 * Math.max(n, 4))
        prog.resources = { segIn: inB.b, segOut: outB.b }
        prog.uniforms = bag
        prog.dispatch(Math.ceil(n / 64), 1, 1)
        const out = await outB.r(8 * n, 0, Float32Array)
        inB.b.destroy(); outB.b.destroy()
        return Array.from({ length: n }, (_, k) => [out[2 * k], out[2 * k + 1]])
    }
}

const SUN = elev => { const e = elev * Math.PI / 180, a = 30 * Math.PI / 180; return [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)] }
const TOTALS = []
async function count(label, doc, cam, extraRays = null) {
    const S = generate(...M.generateArgs(doc, { id: `al-${label.replace(/\W+/g, '')}` }))
    const B = await measure(doc, S)
    const bag = { ...uniformBag(S), ...cullOf(doc, S, B), res: [64, 64], seed: [1, 2, 3, 4] }
    const on = alongText(doc, S, true), off = alongText(doc, S, false)
    const buffers = {}
    const Kp = await prog_march(WG, S, 64, { distOnly: 1 })
    const Ka = await prog_march(WG, { ...S, wgsl: on.wgsl }, 64, { distOnly: 1 })
    const Ko = await prog_march(WG, { ...S, wgsl: off.wgsl }, 64, { distOnly: 1 })
    for (const k of [Kp, Ka, Ko]) await k.ready
    const tol = Math.max((bag.eps > 0 ? bag.eps : bag.epsAuto) / (bag.sceneUnit || 1), 1e-7)
    const check = await skippedChecker(S)
    const run = async (pts, dirs) => {
        const rays = raysOf(pts, dirs)
        const [p, a, o] = [await marchAll(Kp, bag, rays, buffers), await marchAll(Ka, bag, rays, buffers), await marchAll(Ko, bag, rays, buffers)]
        // THE SAFETY CHECK: answers off is the plain march with every fold through the wrappers -- never a longer step
        const fewer = o.filter((h, i) => h.steps < p[i].steps && p[i].state !== -1).length
        const offDiffer = o.filter((h, i) => h.steps !== p[i].steps || h.state !== p[i].state).length
        // the rays the answers took past a surface the plain march hit: a few, to read
        const tOf = (h, i) => h.pos ? Math.hypot(...h.pos.map((v, k) => v - pts[3 * i + k])) : Infinity
        const passed = []
        p.forEach((h, i) => { if (h.state === HIT && (a[i].state !== HIT || tOf(a[i], i) > tOf(h, i) + 4 * tol) && passed.length < 3)
            passed.push(`ray ${i} from [${pts.slice(3 * i, 3 * i + 3).map(v => v.toFixed(3))}] dir [${dirs.slice(3 * i, 3 * i + 3).map(v => v.toFixed(4))}]: plain hit at t ${tOf(h, i).toFixed(4)} [${h.pos.map(v => v.toFixed(4))}], answers ${a[i].state === HIT ? 'hit' : a[i].state === SKY ? 'sky' : 'out'} at t ${tOf(a[i], i).toFixed(4)}`) })
        // every ray the answers took past the plain hit: its skipped stretch through the plain field
        const segs = [], which = []
        p.forEach((h, i) => {
            if (h.state !== HIT || (a[i].state === HIT && tOf(a[i], i) <= tOf(h, i) + 4 * tol)) return
            const t0 = tOf(h, i), t1 = a[i].pos ? tOf(a[i], i) - t0 : 0
            if (!(t1 > 0)) return
            segs.push(...h.pos, t1, ...dirs.slice(3 * i, 3 * i + 3), tol); which.push(i)
        })
        const got = await check(segs)
        const tunnelled = got.filter(([least]) => least < -2 * tol).length, unfinished = got.filter(([least, done]) => least >= -2 * tol && !done).length
        return { c: compare(pts, p, a, tol), fewer, offDiffer, passed, p, skipped: got.length, tunnelled, unfinished }
    }
    const { pts, dirs } = cameraRays(cam, 64, 36)
    const cam1 = await run(pts, dirs)
    say(`  ${label}: ${on.answered} shapes answering (${on.reliefs} a relief's band); camera rays: ${fmt(cam1.c)}`)
    const skipped = r => `${r.skipped} went on past the plain hit: ${r.skipped - r.tunnelled - r.unfinished} grazes, ${r.tunnelled} through a solid${r.unfinished ? `, ${r.unfinished} not finished checking` : ''}`
    say(`    ${skipped(cam1)}`)
    ok(`${label}: answers off, every camera ray the plain march's bit for bit (the rewrite touches nothing else)`, cam1.offDiffer === 0, `${cam1.offDiffer} rays differ, ${cam1.fewer} in fewer steps`)
    ok(`${label}: ...no camera ray with answers through a solid`, cam1.tunnelled === 0, `${cam1.tunnelled}: ${cam1.passed.join('; ')}`)
    const row = { label, answered: on.answered, cam: cam1.c }
    // SHADOW RAYS from where the camera rays hit, backed off along them, towards a sun at 50 and at 5 degrees
    const hitPts = [], back = 10 * tol
    cam1.p.forEach((h, i) => { if (h.state !== HIT) return; hitPts.push(h.pos.map((v, k) => v - dirs[3 * i + k] * 2 * back)) })
    for (const elev of [50, 5]) {
        const sd = SUN(elev), sp = hitPts.flat(), sdirs = hitPts.flatMap(() => sd)
        const sh = await run(sp, sdirs)
        say(`    shadow rays to a sun at ${elev} degrees (${hitPts.length}): ${fmt(sh.c)}`)
        say(`      ${skipped(sh)}`)
        ok(`${label}: ...shadow rays at ${elev} degrees: answers off the plain march's bit for bit`, sh.offDiffer === 0, `${sh.offDiffer} differ, ${sh.fewer} in fewer steps`)
        ok(`${label}: ...and none with answers through a solid`, sh.tunnelled === 0, `${sh.tunnelled}: ${sh.passed.join('; ')}`)
        row[`sun${elev}`] = sh.c
    }
    if (extraRays) {
        for (const [name, pts2, dirs2] of extraRays) {
            const x = await run(pts2, dirs2)
            say(`    ${name} (${pts2.length / 3}): ${fmt(x.c)}`)
            say(`      ${skipped(x)}`)
            ok(`${label}: ...${name}: none with answers through a solid`, x.tunnelled === 0, `${x.tunnelled}`)
            row[name] = x.c
        }
    }
    TOTALS.push(row)
}

const docOf = url => M.parse(readFileSync(fileURLToPath(url), 'utf8'))
const SCENES = [
    ['the optics bench', benchUrl(SCALING_FILES.bench), SCALING_CAMERAS.bench],
    ['the Noise library', benchUrl(BENCH_FILES.noise), CAMERAS.noise],
    ['the showcase', benchUrl(BENCH_FILES.showcase), CAMERAS.showcase],
    ['the demo', benchUrl(BENCH_FILES.demo), CAMERAS.demo],
    ['the Menger cubes', benchUrl(BENCH_FILES.Menger_cubes), CAMERAS.Menger_cubes],
    ['the material test', benchUrl(BENCH_FILES.materials), CAMERAS.materials],
    ['dichroics', benchUrl(BENCH_FILES.dichroics), CAMERAS.dichroics],
]
for (const [label, url, cam] of SCENES) await count(label, docOf(url), cam)
{
    /* THE PRISM SCENE (scenes/prism-dispersion.json), and rays lowered onto its table (the plane z = -15 mm) at 0.1 to 0.5
       degrees, each meeting it 40 to 120 mm ahead, heading away from the prism -- the slit beam's graze, the march alone */
    const url = new URL('../../scenes/prism-dispersion.json', import.meta.url), doc = docOf(url)
    const pts = [], dirs = []
    for (const deg of [0.1, 0.2, 0.3, 0.4, 0.5]) for (let k = 0; k < 64; k++) {
        const L = 40 + 80 * k / 63, th = deg * Math.PI / 180
        pts.push(-70, -20 + 0.1 * k, -15 + L * Math.tan(th)); dirs.push(...unit([-Math.cos(th), 0, -Math.sin(th)]))
    }
    await count('the prism scene', doc, doc.view.camera, [['rays grazing the table, 0.1 to 0.5 degrees', pts, dirs]])
    const g = TOTALS.at(-1)['rays grazing the table, 0.1 to 0.5 degrees']
    say(`    the graze: ${g.n - g.outP} of ${g.n} reach the table plainly within maxiter, ${g.n - g.outA} with the answers`)
}

say(`  ${((Date.now() - t0) / 1000).toFixed(0)} s`)
console.log(`along the ray, counted: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
