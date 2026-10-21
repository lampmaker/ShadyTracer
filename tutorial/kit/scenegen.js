//======================================================================================================================
// A SCENE TREE INTO SHADER TEXT, small -- chapter 24's figures run this. ShadyTracer's codegen (builder/codegen.js) cannot
// be imported by a page (its imports reach the GPU code: tutorial.test.mjs), and it is a renderer's worth of cases; this
// does what it does for a flat scene of one group: a base shape, then shapes joined to it by union or subtraction, the
// group's blend k smoothing every join (scene_api.js csgUnion / csgSubtract, chapter 3). Three ways out, as the engine's:
//   codegen   the structure as code, every number a uniform read (UB.<field>_<id>): a value changed is a uniform
//             written, a shape added or taken away new text, a compile
//   baked     codegen's text with every value a constant, by the engine's own bake (builder/bake.js baked): faster to
//             run (the compiler can fold the numbers), a compile for every change
//   data      one text for every such scene: a loop over records, each shape's kind, join and numbers; a shape added
//             is a record more, never new text (builder/scenedata.js)
// Pure.
//======================================================================================================================

import { baked } from '../../builder/bake.js'
import { sceneConstantsWGSL, NO_LIGHT_FACES } from '../../lib/pathtracer/core/uniforms.schema.js'
import { circle, box, smin, smax } from '../../help/widgets.js'

/* THE SHAPES' DISTANCES AND THE BLEND, written once, the same in every mode (scene_api.js's are in every kernel) */
export const PRELUDE = [
    'fn sdCircle(p: vec2<f32>, r: f32) -> f32 { return length(p) - r; }',
    'fn sdBox(p: vec2<f32>, h: vec2<f32>) -> f32 { let q = abs(p) - h; return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0); }',
]
const num = v => Number.isInteger(v) ? `${v}.0` : `${+v.toFixed(4)}`

/** CODEGEN: the scene as code. `scene` is { k, shapes: [{ id, kind: 'circle'|'box', join: 'union'|'subtract', c, r | h }] },
 *  the first shape the base. Returns ShadyTracer's scene shape: { wgsl, uniforms: { name: { type, def } } }. */
export function codegen(scene) {
    const lines = ['fn SDF(p: vec2<f32>) -> f32 {'], uniforms = {}
    const u = (name, type, def) => { uniforms[name] = { type, def }; return `UB.${name}` }
    scene.shapes.forEach((s, i) => {
        const at = u(`pos_${s.id}`, 'vec2<f32>', s.c)
        const e = s.kind === 'circle' ? `sdCircle(p - ${at}, ${u(`r_${s.id}`, 'f32', s.r)})` : `sdBox(p - ${at}, ${u(`size_${s.id}`, 'vec2<f32>', s.h)})`
        if (i === 0) lines.push(`    var d = ${e};`)
        else lines.push(`    d = ${s.join === 'subtract' ? `csgSubtract(d, ${e}` : `csgUnion(d, ${e}`}, ${u('k_g', 'f32', scene.k)});`)
    })
    lines.push('    return d;', '}')
    return { wgsl: lines.join('\n'), uniforms }
}
/** BAKED: codegen's scene through the engine's bake; the text it compiles is its constants, then its code */
export function bake(scene) {
    const b = baked(codegen(scene)), head = sceneConstantsWGSL(b)
    return { wgsl: (head.startsWith(NO_LIGHT_FACES) ? head.slice(NO_LIGHT_FACES.length) : head).trimEnd() + '\n' + b.wgsl, baked: b }
}
/* AS DATA: one text, and the records it reads -- REC numbers a shape: kind (0 circle, 1 box), join (0 union, 1 subtract),
   x, y, a, b (a radius, or a box's half sizes), k */
export const DATA_WGSL = [
    'fn SDF(p: vec2<f32>) -> f32 {',
    '    var d = 1.0e9;',
    '    for (var i = 0u; i < UB.count; i++) {',
    '        let r = recs[i];',
    '        let q = p - vec2<f32>(r.x, r.y);',
    '        var e = sdCircle(q, r.a);',
    '        if (r.kind == 1u) { e = sdBox(q, vec2<f32>(r.a, r.b)); }',
    '        if (i == 0u) { d = e; }',
    '        else if (r.join == 0u) { d = csgUnion(d, e, r.k); }',
    '        else { d = csgSubtract(d, e, r.k); }',
    '    }',
    '    return d;',
    '}',
].join('\n')
export function records(scene) {
    return scene.shapes.map(s => [s.kind === 'box' ? 1 : 0, s.join === 'subtract' ? 1 : 0, s.c[0], s.c[1], s.kind === 'box' ? s.h[0] : s.r, s.kind === 'box' ? s.h[1] : 0, scene.k])
}
/** the text a mode compiles: what decides whether a change needs a compile */
export const textOf = (scene, mode) => mode === 'data' ? DATA_WGSL : mode === 'baked' ? bake(scene).wgsl : codegen(scene).wgsl

/** THE SCENE'S DISTANCE at (x, y), as all three texts compute it: the base, then each join with the blend k (scene_api.js
 *  csgUnion is a smooth min, csgSubtract a smooth max with the shape turned inside out; k 0 hard) */
export function sceneDist(scene, x, y) {
    let d = 0
    scene.shapes.forEach((s, i) => {
        const e = s.kind === 'circle' ? circle(x - s.c[0], y - s.c[1], s.r) : box(x - s.c[0], y - s.c[1], s.h[0], s.h[1])
        d = i === 0 ? e : s.join === 'subtract' ? (scene.k > 0 ? smax(d, -e, scene.k) : Math.max(d, -e)) : (scene.k > 0 ? smin(d, e, scene.k) : Math.min(d, e))
    })
    return d
}

/** A KERNEL'S TEXT FOR THE COMPILE FIGURE: an SDF of `n` objects written as codegen writes one (its transform, its sizes
 *  as uniforms, its material), and a main that calls it at `sites` places, as the march, the normal's differences and
 *  the materials do -- for wgslgraph.js inlineStats to count */
export function kernelText(n, sites) {
    const body = []
    for (let i = 0; i < n; i++) body.push(`    { let q = xfPoint(p, UB.xf_n${i}); let size = UB.size_n${i}; let rounding = UB.rounding_n${i}; C = add_new(C, NboxRounded(q, size, rounding) * UB.xf_n${i}[3].w, matid_n${i}); }`)
    const calls = []
    for (let k = 0; k < sites; k++) calls.push(`    acc = acc + SDF(p + vec3<f32>(${k}.0, 0.0, 0.0)).s.w;`)
    return [
        'fn SDF(p: vec3<f32>) -> Hit {', '    var C = emptyHit();', ...body, '    return C;', '}',
        'fn main() {', '    var acc = 0.0;', '    let p = vec3<f32>(0.0);', ...calls, '}',
    ].join('\n')
}
