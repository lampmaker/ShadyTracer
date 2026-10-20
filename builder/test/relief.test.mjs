//======================================================================================================================
// Tests for the noise relief in a shell (builder/modifiers.js relief; codegen.js SURFACE_ONLY). Run:
//   node builder/test/relief.test.mjs
//
// The relief skips its noise where the point is farther from the plain shape than the noise can move the surface
// -- a bound noise.js PROVES (NZ_GRAD_VALUE_BOUND) and test/noise.test.mjs checks against the noise itself. How
// much time that saves, and whether the picture is unchanged, only the GPU and the user can say. What runs here:
//   - the template's code is the code MIRRORED below, line for line, and its noise branch is the relief as it was
//     (the benchmark's frozen scene): a change to one without the other fails here;
//   - the mirror on the real noise (noise.js fbm3, the WGSL's twin) over a sphere and a box, in a scaled frame:
//     where the shell answers, its value has the old field's sign, is never a hit, and is no farther than any
//     point found on the displaced surface -- a lower bound, so the march cannot step through the relief; and a
//     hit's normal differences never reach the shell's edge;
//   - what codegen tells a group's code for each kind of parent: READ_REACH and DIVIDED_ABOVE, which the template
//     reads (0 and false at the root and under plain unions, 5/4 of the blends and true under CSG, unbounded under
//     group code), and SURFACE_ONLY for code saved before; a group whose code does not name one gets nothing;
//   - A MATERIAL'S RELIEF IN A SMOOTH BLEND (codegen reliefChain), its wrapper mirrored and held to the text: two
//     spheres in a smooth union wearing the print layers -- the fillet's surface is the true one (both raised,
//     then blended), where the wrapper as it was left it bare, and its value no farther than that surface;
//   - THE NOISE RELIEF MODIFIER IN A SMOOTH BLEND, the same on the real fBm: the template's surface is the true one
//     where the code as it was (divided before the blend) is off, and its value no farther than that surface;
//   - THE NORMAL ACROSS A BAND'S EDGE (0.70.1), on the real fBm: the library's knockdown stucco cut from its white
//     plaster, smooth and hard -- the normal as it was turned where the stucco's band ends (the user's line), the
//     undivided normal the field's own gradient all the way across, and the normal it was everywhere else.
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { MODIFIERS, RELIEF_CODE_FBM_BOUND } from '../modifiers.js'
import { generate, codeOnly, GROUP_SCOPE } from '../codegen.js'
import * as Model from '../model.js'
import { fbm3, vnoise3, nzFbmLip, NZ_GRAD_VALUE_BOUND, NZ_GRAD_LIP_MEASURED, NZ_RELIEF_LIP_MEASURED } from '../../lib/pathtracer/core/noise.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const lines = code => codeOnly(code).split('\n').map(l => l.trim()).filter(Boolean)

// ---- THE MIRROR, and the text it mirrors
const TEMPLATE = [
    'var H = children(emptyHit(r), p);',
    'let peak = nzFbmLip(4u, 1.0, 0.5, 1.0);',
    'let slope = 1.0 + amount / size * nzFbmLip(4u, 2.0, 0.5, NZ_GRAD_LIP_MEASURED) / peak;',
    'let reach = NZ_GRAD_VALUE_BOUND * abs(amount) * XF_S;',
    'if (abs(H.s.w) > 2.0 * reach + READ_REACH + (slope + 1.0) * marchEps()) {',
    'C = fold(C, VEC4(0.0, 0.0, 0.0, H.s.w - sign(H.s.w) * reach), H.m);',
    '} else {',
    'let n = fbm3(p / size, 1u, 4u, 2.0, 0.5);',
    'C = foldRelief(C, H.s.w - amount * n.w / peak * XF_S, H.m, slope, DIVIDED_ABOVE);',
    '}',
]
ok('the template is the code mirrored here, line for line', JSON.stringify(lines(MODIFIERS.relief.code)) === JSON.stringify(TEMPLATE),
    lines(MODIFIERS.relief.code).join('\n      '))
{
    // the benchmark's frozen Noise library carries the relief as it was before the shell: the noise branch is it
    const frozen = JSON.parse(readFileSync(new URL('../../bench/scenes/noise.json', import.meta.url), 'utf8'))
    const codes = []
    const walk = n => { if (/fbm3\(p \/ size/.test(n.code || '')) codes.push(n.code); (n.children || []).forEach(walk) }
    walk(frozen.root)
    const was = [TEMPLATE[0], TEMPLATE[1], TEMPLATE[7], TEMPLATE[2],
        'H.s = VEC4(0.0, 0.0, 0.0, (H.s.w - amount * n.w / peak * XF_S) / slope);', 'C = fold(C, H.s, H.m);']
    ok('the noise branch is the relief as it was (the frozen benchmark scene\'s six), the same lines',
        codes.length === 6 && codes.every(c => JSON.stringify(lines(c)) === JSON.stringify(was)), codes.length ? lines(codes[0]).join('\n      ') : 'none')
    // and the bundled Noise library carries the relief as the builder writes it now
    // the file as the builder reads it: a group's code is its block's (model.js version 16)
    const shipped = Model.parse(readFileSync(new URL('../../test/fixtures/scenes/noise.json', import.meta.url), 'utf8'))
    const now = []
    const walk2 = n => { const c = Model.codeOf(shipped, n); if (/fbm3\(p \/ size/.test(c)) now.push(c); (n.children || []).forEach(walk2) }
    walk2(shipped.root)
    /* FIVE GROUPS: the sixth relief, rough stone's, is its material's since a material can carry one (builder/
       materials.js RELIEFS; the user, 2026-09-30) -- its box wears it, and codegen wraps the box, not a group */
    ok('the bundled Noise library\'s five relief groups are the template', now.length === 5 && now.every(c => c === MODIFIERS.relief.code),
        `${now.length} groups`)
    ok('...and the sixth relief is rough stone\'s material\'s', shipped.materials.filter(m => m.relief).map(m => m.label).join() === 'rough stone (granite, relief 1.5 mm / 8 mm)')
}
{
    // the benchmark's copy with the fBm's own bound: the template's lines but the one it divides by
    const want = TEMPLATE.map((l, i) => i === 2 ? 'let slope = 1.0 + amount / size * NZ_RELIEF_LIP_MEASURED / peak;' : l)
    ok('RELIEF_CODE_FBM_BOUND: the template\'s code but for the bound in the slope line', JSON.stringify(lines(RELIEF_CODE_FBM_BOUND)) === JSON.stringify(want),
        lines(RELIEF_CODE_FBM_BOUND).join('\n      '))
}

const PEAK = nzFbmLip(4, 1.0, 0.5, 1.0)
const LIP_SUMMED = nzFbmLip(4, 2.0, 0.5, NZ_GRAD_LIP_MEASURED)       // the modifier's: the one-octave bound, summed
const slopeOf = (amount, size, lip = LIP_SUMMED) => 1 + amount / size * lip / PEAK
const noise = (p, size) => fbm3(p.map(x => x / size), 1, 4, 2.0, 0.5)[3]
/* d: the plain shape's distance in WORLD units (H.s.w: the children folded through add_new, x XF_S); p: the point
   in the group's own frame; S: XF_S; eps: marchEps(); readReach: READ_REACH (0 at the root, Infinity under group
   code: no shell). Not deferred: foldRelief divides by the slope. Returns [value, whether the shell answered]. */
const relief = (d, p, { amount, size, S, eps, readReach = 0 }) => {
    const slope = slopeOf(amount, size), reach = NZ_GRAD_VALUE_BOUND * Math.abs(amount) * S
    if (Math.abs(d) > 2 * reach + readReach + (slope + 1) * eps) return [d - Math.sign(d) * reach, true]
    return [(d - amount * noise(p, size) / PEAK * S) / slope, false]
}

// ---- THE MIRROR ON THE REAL NOISE: two shapes in a frame scaled by S, the amounts and sizes of the Noise library's
let seed = 0x2545f491
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 2 ** 32 }
const unit = () => { for (;;) { const v = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1], l = Math.hypot(...v); if (l > 0.1 && l <= 1) return v.map(x => x / l) } }
const add = (a, b, k = 1) => a.map((x, i) => x + k * b[i])
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const SHAPES = {
    sphere: { d: p => Math.hypot(...p) - 10, R: 10 },
    box: {  // half sizes 10, 6, 8: exact outside and in
        d: p => { const q = [Math.abs(p[0]) - 10, Math.abs(p[1]) - 6, Math.abs(p[2]) - 8]
                  return Math.hypot(...q.map(x => Math.max(x, 0))) + Math.min(Math.max(q[0], q[1], q[2]), 0) },
        R: 6,
    },
}
// the plain shape's outward normal, by central differences
const gradOf = (d, p) => { const h = 1e-5, g = [0, 1, 2].map(k => { const e = [0, 0, 0]; e[k] = h; return (d(add(p, e)) - d(add(p, e, -1))) / (2 * h) }), l = Math.hypot(...g); return g.map(x => x / l) }
const CASES = [
    { amount: 1, size: 10, S: 1 }, { amount: 3, size: 25, S: 1 }, { amount: 0.3, size: 2, S: 1 },
    { amount: 1.5, size: 8, S: 0.001 },          // the same relief with the frame in metres
    { amount: 0.02, size: 0.5, S: 20 },           // a shallow relief, the frame scaled up
]
const TRIALS = 4
let shellAnswered = 0, worstGap = Infinity, reachUsed = 0, crossed = 0
for (const [name, shape] of Object.entries(SHAPES)) for (const c of CASES) {
    const eps = 0.01 * c.S, slope = slopeOf(c.amount, c.size), reach = NZ_GRAD_VALUE_BOUND * c.amount * c.S
    const local = reach / c.S                                                 // the reach in the frame
    /* points on the displaced surface: along a ray from the centre, between where the PLAIN distance is -reach and
       +reach, the old field's zero, by bisection. That the old field changes sign between those two IS the proved
       bound on the real noise: were the noise to reach past it, some ray would find no sign change. */
    const onSurface = dir => {
        const f = t => relief(shape.d(dir.map(x => x * t)) * c.S, dir.map(x => x * t), { ...c, eps, readReach: Infinity })[0]
        const at = target => { let a = 0, b = 100; for (let k = 0; k < 60; k++) { const m = (a + b) / 2; if (shape.d(dir.map(x => x * m)) < target) a = m; else b = m } return (a + b) / 2 }
        let lo = at(-1.0001 * local), hi = at(1.0001 * local)
        if (!(f(lo) < 0 && f(hi) > 0)) return null
        for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (f(m) < 0) lo = m; else hi = m }
        return dir.map(x => x * (lo + hi) / 2)
    }
    let bracketed = 0
    for (let trial = 0; trial < TRIALS; trial++) {
        const axis = unit()
        const q = onSurface(axis)
        if (!q) continue
        bracketed++
        // a patch of the displaced surface around it, dense enough to find a near point for every probe below
        const patch = []
        for (let k = 0; k < 200; k++) {
            const u = add(axis, unit(), 0.02 + 6 * local / shape.R * rnd()), l = Math.hypot(...u)
            const s = onSurface(u.map(x => x / l)); if (s) patch.push(s)
        }
        // probes on both sides of it, at distances where the shell answers
        const n = gradOf(shape.d, q)
        for (let k = 0; k < 40; k++) {
            const side = k % 2 ? 1 : -1
            const off = side * (2 * local + (slope + 1) * eps / c.S + (0.02 + 3 * rnd()) * local)
            const p = add(q, n, off)
            const d = shape.d(p) * c.S
            const [v, shell] = relief(d, p, { ...c, eps })
            if (!shell) continue
            shellAnswered++
            const old = relief(d, p, { ...c, eps, readReach: Infinity })[0]
            ok(`${name} ${JSON.stringify(c)}: the shell keeps the old field's sign`, Math.sign(v) === Math.sign(old), `${v} vs ${old}`)
            ok(`${name} ${JSON.stringify(c)}: the shell is never a hit`, Math.abs(v) >= reach + eps, `${v}`)
            const near = Math.min(...patch.map(s => dist(p, s))) * c.S
            worstGap = Math.min(worstGap, (near - Math.abs(v)) / reach)
            ok(`${name} ${JSON.stringify(c)}: no nearer than a point found on the displaced surface`, Math.abs(v) <= near * (1 + 1e-9), `${Math.abs(v)} > ${near}`)
        }
        /* a hit and its normal's six differences: all on the noise's side of the edge. A hit is anywhere the field
           is within eps of zero, so besides the surface itself the two farthest hits along the plain normal,
           about slope x eps out (the field there is the plain distance over slope) */
        for (const s of patch.slice(0, 60)) {
            reachUsed = Math.max(reachUsed, Math.abs(shape.d(s)) / local)
            const n = gradOf(shape.d, s)
            for (const h of [0, 1, -1].map(k => add(s, n, k * slope * eps / c.S)))
                for (const e of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
                    const p = add(h, e, eps / c.S)
                    if (relief(shape.d(p) * c.S, p, { ...c, eps })[1]) crossed++
                }
        }
    }
    ok(`${name} ${JSON.stringify(c)}: the displaced surface bracketed within the reach on every ray tried`, bracketed === TRIALS, `${bracketed}/${TRIALS}`)
}
ok('the shell answered for the probes (the band test ran)', shellAnswered > 300, `${shellAnswered}`)
ok('no hit\'s normal differences reach the shell', crossed === 0, `${crossed}`)
ok('the reach is not a bound that nothing reaches: the surface found moves by a real share of it', reachUsed > 0.3 && reachUsed <= 1, `${reachUsed}`)
console.log(`  shell: ${shellAnswered} probes; nearest surface point found at least ${worstGap.toFixed(3)} reach beyond the shell's value; surface moved up to ${reachUsed.toFixed(3)} of the reach`)

// ---- INSIDE THE BAND, THE STEP BOUND: the field (plain distance less the noise, over the slope) must change no faster
//      than the distance it stands for, or the march steps through the relief. Its gradient, in world units per
//      world unit, at points in the band on the real noise: the plain shape's gradient less amount / peak times the
//      fBm's (its analytic gradient, over size), over the slope -- for the modifier's bound, the benchmark row's, and a
//      quarter of that, which must fail, or this check cannot. noise.test.mjs holds the bounds to the fBm's steepest;
//      this holds the relief's arithmetic around them (amount, size, peak, the frame's scale) to the same.
{
    const LIPS = { summed: LIP_SUMMED, measured: NZ_RELIEF_LIP_MEASURED, quarter: NZ_RELIEF_LIP_MEASURED / 4 }
    const worst = { summed: 0, measured: 0, quarter: 0 }
    let points = 0
    for (const shape of Object.values(SHAPES)) for (const c of CASES) {
        const local = NZ_GRAD_VALUE_BOUND * c.amount
        for (let k = 0; k < 300; k++) {
            const dir = unit(), target = (2 * rnd() - 1) * 2 * local
            let a = 0, b = 100
            for (let i = 0; i < 60; i++) { const m = (a + b) / 2; if (shape.d(dir.map(x => x * m)) < target) a = m; else b = m }
            if (a < 1e-6) continue                         // deeper than the shape goes (the box's middle): not in its band
            const p = dir.map(x => x * (a + b) / 2)
            const g0 = gradOf(shape.d, p), n = fbm3(p.map(x => x / c.size), 1, 4, 2.0, 0.5)
            const g = Math.hypot(...[0, 1, 2].map(i => g0[i] - c.amount / PEAK * n[i] / c.size))
            for (const [key, lip] of Object.entries(LIPS)) worst[key] = Math.max(worst[key], g / slopeOf(c.amount, c.size, lip))
            points++
        }
    }
    ok('in the band, the modifier\'s field changes no faster than distance', worst.summed <= 1, `${worst.summed}`)
    ok('...nor the benchmark row\'s, with the bound measured for its fBm', worst.measured <= 1, `${worst.measured}`)
    ok('...and a quarter of that bound does (so the check can fail)', worst.quarter > 1, `${worst.quarter}`)
    console.log(`  band: ${points} points; the field's steepest over the step bound: modifier ${worst.summed.toFixed(3)}, measured ${worst.measured.toFixed(3)}, a quarter ${worst.quarter.toFixed(3)}`)
}

// ---- WHAT CODEGEN TELLS A GROUP'S CODE, for each kind of parent: READ_REACH and DIVIDED_ABOVE, which the template
//      reads now, and SURFACE_ONLY, which code written before still reads
{
    const params = { ...MODIFIERS.relief.params }
    const OLD = 'var H = children(emptyHit(r), p);\nif (SURFACE_ONLY) { H.s.w = H.s.w; }\nC = fold(C, H.s, H.m);'   // as code saved before
    const build = code => {
        const d = Model.createDoc()
        const relief = (parent, id) => { Model.addGroup(d, parent, { id, code, params }); Model.addObject(d, id, { id: `${id}s` }) }
        relief('root', 'ra')                                                    // at the root
        Model.addGroup(d, 'root', { id: 'u' }); relief('u', 'rb')             // under a plain union
        Model.addGroup(d, 'root', { id: 'x', blend: 0 }); relief('x', 'rc'); Model.addObject(d, 'x', { id: 'xo', join: 'subtract' })
        Model.addGroup(d, 'root', { id: 'y', blend: 0.2 }); Model.addGroup(d, 'y', { id: 'yu' }); relief('yu', 'rd')
        Model.addObject(d, 'y', { id: 'yo' })
        // version 14: a relief that joins with a blend of its own, and a join after it with another
        Model.addGroup(d, 'root', { id: 'z' }); Model.addObject(d, 'z', { id: 'zo' })
        Model.addGroup(d, 'z', { id: 'rh', code, params, join: 'subtract', joinBlend: 0.05 }); Model.addObject(d, 'rh', { id: 'rhs' })
        Model.addObject(d, 'z', { id: 'zq', join: 'intersect', joinBlend: 0 })
        Model.addGroup(d, 'root', { id: 't', code: 'C = children(C, p);' }); relief('t', 're')   // under group code
        relief('root', 'rf'); relief('rf', 'rg')                               // a relief over a relief
        Model.addGroup(d, 't', { id: 'tz', blend: 0.1 }); relief('tz', 'ri')   // code above a CSG group
        Model.addObject(d, 'tz', { id: 'tzo', join: 'intersect' })
        Model.addGroup(d, 'root', { id: 'plain', code: MODIFIERS.round.code, params: { ...MODIFIERS.round.params } })   // code without them
        Model.addObject(d, 'plain', { id: 'po' })
        return generate(Model.toTree(d)).wgsl
    }
    // a coded group's aliases come first in its block, so the first of a name after its marker is its own
    const aliasOf = (w, name) => id => w.slice(w.indexOf(`// group ${id} (`)).match(new RegExp(`let ${name} = ([^;]*);`))?.[1]
    const old = build(OLD), flag = aliasOf(old, 'SURFACE_ONLY')
    ok('SURFACE_ONLY at the root: true', flag('ra') === 'true', flag('ra'))
    ok('...under a plain union: true', flag('rb') === 'true', flag('rb'))
    ok('...under a hard CSG: its blend\'s test (0 now, live)', flag('rc') === 'UB.blend_x <= 0.0', flag('rc'))
    ok('...under a smooth blend, through a plain union: its blend\'s test (false while it blends)', flag('rd') === 'UB.blend_y <= 0.0', flag('rd'))
    ok('...under group code: false', flag('re') === 'false', flag('re'))
    ok('...joining with own blends: the group\'s and every own one\'s test, together', flag('rh') === 'UB.blend_z <= 0.0 && UB.jblend_rh <= 0.0 && UB.jblend_zq <= 0.0', flag('rh'))
    ok('...a relief over a relief: the outer true, the inner false', flag('rf') === 'true' && flag('rg') === 'false', `${flag('rf')} ${flag('rg')}`)
    ok('...a group whose code does not name it: nothing emitted', (old.match(/let SURFACE_ONLY/g) || []).length === 9)
    ok('...nor the new names, which that code does not name', !/let (READ_REACH|DIVIDED_ABOVE)/.test(old))
    const now = build(MODIFIERS.relief.code), reach = aliasOf(now, 'READ_REACH'), div = aliasOf(now, 'DIVIDED_ABOVE')
    const both = id => `${reach(id)} | ${div(id)}`
    ok('READ_REACH, DIVIDED_ABOVE at the root: 0, no', both('ra') === '0.0 | false', both('ra'))
    ok('...under a plain union: 0, no', both('rb') === '0.0 | false', both('rb'))
    ok('...under a hard CSG: 5/4 of its blend (0 now, live), and the group divides', both('rc') === '1.25 * UB.blend_x | true', both('rc'))
    ok('...under a smooth blend, through a plain union: 5/4 of it, and the group divides', both('rd') === '1.25 * UB.blend_y | true', both('rd'))
    ok('...under group code: unbounded, no', both('re') === '1.0e30 | false', both('re'))
    ok('...joining with a blend of its own: its join and the one after it (own blends both), and the group divides',
        both('rh') === '1.25 * (UB.jblend_rh + UB.jblend_zq) | true', both('rh'))
    ok('...a relief over a relief: the outer 0, the inner unbounded', both('rf') === '0.0 | false' && both('rg') === '1.0e30 | false', `${both('rf')} / ${both('rg')}`)
    ok('...code above a CSG group: unbounded, and the group divides', both('ri') === '1.0e30 | true', both('ri'))
    // ...by it outside a normal's look (scene_api.js NORMAL_LOOK, 0.70.1) -- always under code (tz), which reads the value
    const rl = id => id === 'tz' ? 'XF_RL' : 'select(XF_RL, 1.0, NORMAL_LOOK)'
    ok('...the groups that divide save, reset and put back XF_RL; no other does; undivided in a normal\'s look, but under code',
        ['x', 'y', 'z', 'tz'].every(id => now.includes(`let xfrl_${id} = XF_RL; XF_RL = 1.0;`) && now.includes(`C = fold(C, VEC4(k_${id}.xyz, k_${id}.w / ${rl(id)}), km_${id});`))
        && (now.match(/let xfrl_/g) || []).length === 4)
    ok('...and the template no longer names SURFACE_ONLY', !/SURFACE_ONLY/.test(now))
    ok('a parameter cannot take any of the names', ['SURFACE_ONLY', 'READ_REACH', 'DIVIDED_ABOVE'].every(name => GROUP_SCOPE.includes(name) && (() => {
        try { Model.addGroup(Model.createDoc(), 'root', { code: MODIFIERS.relief.code, params: { [name]: 1 } }); return false } catch { return true }
    })()))
}

// ---- A MATERIAL'S RELIEF IN A SMOOTH BLEND (codegen object(), reliefChain): two spheres 2 mm apart, a 6 mm smooth
//      union, both wearing the 3D-print layers on the scene's z (model.test holds the preset to the mirror here). The
//      fillet lies off both spheres' own surfaces. The wrapper as it was skipped the relief there and left the fillet
//      bare; dividing by 1 + slope inside the blend would make the fillet 1 + slope times the blend. The wrapper now:
//      the band wider by 5/4 of the blend, the distance divided once, after the blend. Its surface must be the true
//      one -- both spheres raised by the layers, then blended -- and its value no farther than that surface.
{
    const { RELIEFS } = await import('../materials.js')
    const P = RELIEFS.layers.params, A = P.amplitude
    const fract = x => x - Math.floor(x)
    const layers = z => {
        const s = 2 * fract(z / P.layer) - 1, k = 1 + P.variation * vnoise3([0, 0, Math.floor(z / P.layer)], 61)[3]
        return { h: Math.max(-A, Math.min(A, A * (k * (1 - s * s) - 2 / 3))), slope: 4 * (1 + P.variation) * A / P.layer }
    }
    const csgUnion = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0); return Math.min(a, b) - h * h * 0.25 / k }
    const K = 6, REACH = 1.25 * K
    const dA = p => Math.hypot(p[0] + 11, p[1], p[2]) - 10, dB = p => Math.hypot(p[0] - 11, p[1], p[2]) - 10
    // in mm with the scene in mm (mm(1.0) = 1) and no warp (XF_K = 1); R the relief at p (the layers read only z)
    const TRUE = (p, R) => csgUnion(dA(p) - R.h, dB(p) - R.h, K)
    const WAS = (p, R) => {          // the wrapper before: per object, the band two amplitudes, divided inside the blend
        const w = d => Math.abs(d) > 2 * A ? d - Math.sign(d) * A : (d - R.h) / (1 + R.slope)
        return csgUnion(w(dA(p)), w(dB(p)), K)
    }
    const NOW = (p, R, { reach = REACH, divide = true } = {}) => {     // codegen's: the band widened, divided at the top
        let rl = 1
        const w = d => { if (Math.abs(d) > 2 * A + reach) return d - Math.sign(d) * A; rl = Math.max(rl, 1 + R.slope); return d - R.h }
        const v = csgUnion(w(dA(p)), w(dB(p)), K)
        return divide ? v / rl : v
    }
    const WIDE = (p, R) => csgUnion((dA(p) - R.h) / (1 + R.slope), (dB(p) - R.h) / (1 + R.slope), K)   // the skip off alone
    // the mirror is the text: generated for the same two spheres
    {
        const d = Model.createDoc()
        Model.addMaterial(d, { id: 'pla' }); Model.setRelief(d, 'pla', 'layers')
        Model.addGroup(d, 'root', { id: 'bu', blend: K })
        Model.addObject(d, 'bu', { id: 'a', primitive: 'sphere', material: 'pla' }); Model.addObject(d, 'bu', { id: 'b', primitive: 'sphere', material: 'pla' })
        const w = generate(Model.toTree(d)).wgsl
        ok('the mirror is the wrapper codegen writes: the band, the undivided height deferred, the one division',
            w.includes('if (abs(rs_a.w) > 2.0 * ra_a + 1.25 * UB.blend_bu) { C = fold(C, VEC4(0.0, 0.0, 0.0, rs_a.w - sign(rs_a.w) * ra_a), rm_a); }')
            && w.includes('C = foldRelief(C, rs_a.w - mm(hs.x) * XF_K, rm_a, 1.0 + hs.y, true); }')
            && w.includes('let xfrl_bu = XF_RL; XF_RL = 1.0;') && w.includes('k_bu = csgUnion(k_bu, C.s, UB.blend_bu);')
            && w.includes('C = fold(C, VEC4(k_bu.xyz, k_bu.w / select(XF_RL, 1.0, NORMAL_LOOK)), km_bu);'))
    }
    /* THE SURFACE, field by field: at each x and z, out along y from the axis to the first point where the field
       is not positive, then bisected -- the patch of the fillet facing +y. Along y the layers' height is constant,
       so the true field rises monotonically and has one crossing. */
    const surfaceY = (f, x, z, R) => {
        let y = 10
        if (!(f([x, y, z], R) > 0)) return NaN
        while (y > 0 && f([x, y - 0.01, z], R) > 0) y -= 0.01
        let lo = y - 0.01, hi = y
        for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (f([x, m, z], R) > 0) hi = m; else lo = m }
        return (lo + hi) / 2
    }
    const worst = { now: 0, was: 0, narrow: 0, wide: 0 }, alongZ = { true: [Infinity, -Infinity], was: [Infinity, -Infinity] }
    const patch = []
    for (let x = -3; x <= 3 + 1e-9; x += 0.1) for (let z = 0; z < 1; z += 0.01) {
        const R = layers(z), y = surfaceY(TRUE, x, z, R)
        patch.push([x, y, z])
        worst.now = Math.max(worst.now, Math.abs(surfaceY(NOW, x, z, R) - y))
        worst.was = Math.max(worst.was, Math.abs(surfaceY(WAS, x, z, R) - y))
        worst.narrow = Math.max(worst.narrow, Math.abs(surfaceY((p, R) => NOW(p, R, { reach: 0 }), x, z, R) - y))
        worst.wide = Math.max(worst.wide, Math.abs(surfaceY(WIDE, x, z, R) - y))
        if (Math.abs(x) < 1e-9) {     // how far off the sphere the fillet is, along z (the neck is round: its y alone is not)
            const t = dA([x, y, z]), w = dA([x, surfaceY(WAS, x, z, R), z])
            alongZ.true = [Math.min(alongZ.true[0], t), Math.max(alongZ.true[1], t)]
            alongZ.was = [Math.min(alongZ.was[0], w), Math.max(alongZ.was[1], w)]
        }
    }
    ok('the fillet\'s true surface has the layers on it (its height off the spheres moves along z by more than the amplitude)', alongZ.true[1] - alongZ.true[0] > A,
        `${alongZ.true[1] - alongZ.true[0]}`)
    ok('...and the wrapper as it was left it bare, the same height everywhere: the bug, mirrored', alongZ.was[1] - alongZ.was[0] < 1e-6 && worst.was > A / 2,
        `moves ${alongZ.was[1] - alongZ.was[0]}, off by ${worst.was}`)
    ok('the wrapper now: its surface is the true one, across the whole fillet', worst.now < 1e-9, `${worst.now}`)
    ok('...which the band\'s 5/4 of the blend is needed for (unwidened, it is off)', worst.narrow > A / 2, `${worst.narrow}`)
    ok('...and the division after the blend (inside it, the fillet grows by the slope)', worst.wide > 1, `${worst.wide}`)
    // AND A SAFE DISTANCE: off the fillet, no farther than any point found on its true surface; undivided it would be
    let probes = 0, over = 0, overUndivided = 0
    for (let k = 0; k < 400; k++) {
        const p = [(rnd() * 2 - 1) * 2.5, 0, 0.25 + 0.5 * rnd()], R = layers(p[2])
        p[1] = surfaceY(TRUE, p[0], p[2], R) + 0.01 + 3 * rnd() ** 2
        const near = Math.min(...patch.map(s => dist(p, s)))
        const v = NOW(p, R)
        if (!(v > 0)) continue
        probes++
        over = Math.max(over, v / near)
        overUndivided = Math.max(overUndivided, NOW(p, R, { divide: false }) / near)
    }
    ok('off the fillet, the field is no farther than any point found on its surface', probes > 300 && over <= 1 + 1e-9, `${probes} probes, worst ${over}`)
    ok('...and undivided it would be (so the check can fail)', overUndivided > 1, `${overUndivided}`)
    console.log(`  blend: fillet surface off by ${worst.now.toExponential(1)} mm (was ${worst.was.toFixed(3)}, unwidened ${worst.narrow.toFixed(3)}, divided inside ${worst.wide.toFixed(2)}); value over the nearest surface point found: ${over.toFixed(3)} (undivided ${overUndivided.toFixed(3)})`)
}

// ---- THE NOISE RELIEF MODIFIER IN A SMOOTH BLEND: sphere A under a noise relief group, sphere B plain, a 6 mm smooth
//      union, on the real fBm. Its code as it was ran the noise everywhere under a blend (SURFACE_ONLY false) but divided
//      by its slope before the blend, so the fillet on its side came out wrong. The template now: the shell farther out
//      by READ_REACH, and foldRelief leaving the division to the group (DIVIDED_ABOVE). Its surface must be the true
//      one -- A roughened, then blended -- and its value no farther than that surface.
{
    const K = 6, AMOUNT = 1, SIZE = 1.5, eps = 0.01               // a steep relief, so that its slope matters
    const slope = slopeOf(AMOUNT, SIZE), reach = NZ_GRAD_VALUE_BOUND * AMOUNT
    const csgUnion = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0); return Math.min(a, b) - h * h * 0.25 / k }
    const dA = p => Math.hypot(p[0] + 11, p[1], p[2]) - 10, dB = p => Math.hypot(p[0] - 11, p[1], p[2]) - 10
    const memo = new Map()                                                      // the fBm is slow in JS; every field shares it
    const nz = p => { const key = p.join(); let v = memo.get(key); if (v === undefined) memo.set(key, v = noise(p, SIZE)); return v }
    const rough = p => dA(p) - AMOUNT * nz(p) / PEAK                            // A's field with the noise on it, undivided
    const TRUE = p => csgUnion(rough(p), dB(p), K)
    const WAS = p => csgUnion(rough(p) / slope, dB(p), K)                       // never the shell under a blend, divided before it
    const NOW = (p, { readReach = 1.25 * K, divide = true } = {}) => {        // the template: READ_REACH, DIVIDED_ABOVE true
        const d = dA(p)
        if (Math.abs(d) > 2 * reach + readReach + (slope + 1) * eps) return csgUnion(d - Math.sign(d) * reach, dB(p), K)
        const v = csgUnion(rough(p), dB(p), K)
        return divide ? v / slope : v
    }
    // the template's arithmetic is this mirror's: generated for the same two spheres
    {
        const d = Model.createDoc()
        Model.addGroup(d, 'root', { id: 'bu', blend: K })
        Model.addGroup(d, 'bu', { ...MODIFIERS.relief, id: 'ga', params: { amount: AMOUNT, size: SIZE } })
        Model.addObject(d, 'ga', { id: 'a', primitive: 'sphere' }); Model.addObject(d, 'bu', { id: 'b', primitive: 'sphere' })
        const w = generate(Model.toTree(d)).wgsl
        ok('the modifier in a blend: READ_REACH 5/4 of the blend, the division left to the group, done once after it',
            w.includes('let READ_REACH = 1.25 * UB.blend_bu;') && w.includes('let DIVIDED_ABOVE = true;')
            && w.includes('let xfrl_bu = XF_RL; XF_RL = 1.0;') && w.includes('C = fold(C, VEC4(k_bu.xyz, k_bu.w / select(XF_RL, 1.0, NORMAL_LOOK)), km_bu);'))
    }
    /* the surface facing +y: from y0 down in steps of 0.05 to the first point not outside, then bisected. Every field
       on the same grid, so the true one's noise is reused; where two fields agree in sign, they find the same point */
    const surfaceY = (f, x, z, y0 = 8) => {
        let y = y0
        while (!(f([x, y, z]) > 0)) y += 0.25
        while (y > 0 && f([x, y - 0.05, z]) > 0) y -= 0.05
        let lo = y - 0.05, hi = y
        for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (f([x, m, z]) > 0) hi = m; else lo = m }
        return (lo + hi) / 2
    }
    const worst = { now: 0, was: 0, narrow: 0 }
    for (let x = -3; x <= 3 + 1e-9; x += 0.5) for (let z = 0; z < 3; z += 0.25) {
        const y = surfaceY(TRUE, x, z)
        worst.now = Math.max(worst.now, Math.abs(surfaceY(NOW, x, z) - y))
        worst.was = Math.max(worst.was, Math.abs(surfaceY(WAS, x, z) - y))
        worst.narrow = Math.max(worst.narrow, Math.abs(surfaceY(p => NOW(p, { readReach: 0 }), x, z) - y))
    }
    ok('the template in a blend: its surface is the true one, across the whole fillet', worst.now < 1e-9, `${worst.now}`)
    ok('...where the code as it was, divided before the blend, is off (the bug, mirrored)', worst.was > 0.1, `${worst.was}`)
    ok('...and READ_REACH is needed: with the root\'s shell, the fillet loses the noise', worst.narrow > 0.1, `${worst.narrow}`)
    /* a safe distance: no farther than any point found on the true surface. On A's own face, still in the group and its
       band: in the fillet the blended field is shallower than distance (its gradient a mix of two), so there even an
       undivided one would pass, and the check could not fail. A patch of it, each point from its neighbour's. */
    const patch = []
    for (let x = -7; x <= -4 + 1e-9; x += 0.1) {
        let y = surfaceY(TRUE, x, 1)
        for (let z = 1; z <= 2 + 1e-9; z += 0.05) { y = surfaceY(TRUE, x, z, y + 0.3); patch.push([x, y, z]) }
    }
    let probes = 0, over = 0, overUndivided = 0
    for (let k = 0; k < 200; k++) {
        const s = patch[Math.floor(rnd() * patch.length)]
        if (Math.abs(s[0] + 5.5) > 1 || s[2] < 1.25 || s[2] > 1.75) continue    // well inside the patch, so its nearest is in it
        const p = [s[0], s[1] + 0.02 + 2 * rnd() ** 2, s[2]]
        const v = NOW(p)
        if (!(v > 0)) continue
        const near = Math.min(...patch.map(q => dist(p, q)))
        probes++
        over = Math.max(over, v / near)
        overUndivided = Math.max(overUndivided, NOW(p, { divide: false }) / near)
    }
    ok('off the fillet, the field is no farther than any point found on its surface', probes > 40 && over <= 1 + 1e-9, `${probes} probes, worst ${over}`)
    ok('...and undivided it would be (so the check can fail)', overUndivided > 1, `${overUndivided}`)
    console.log(`  modifier blend: fillet surface off by ${worst.now.toExponential(1)} mm (as it was ${worst.was.toFixed(3)}, the root's shell ${worst.narrow.toFixed(3)}); value over the nearest surface point found: ${over.toFixed(3)} (undivided ${overUndivided.toFixed(3)})`)
}

// ---- THE NORMAL ACROSS A BAND'S EDGE (0.70.1; scene_api.js NORMAL_LOOK). The user's case (2026-10-20): a sphere of
//      knockdown stucco cut from a box of white plaster, the library's two, and a hard line on the plaster round the
//      cut -- farther out with the blend on, nearer with it at 0, gone when both wore the same relief. A chain's top
//      divides by XF_RL, the steepest slope among the reliefs WITHIN THEIR BANDS: on the plaster face it was the
//      stucco's where the stucco's band reaches (two amplitudes and 5/4 of the blend from the sphere) and the plaster's
//      beyond, and the surface kernel's forward differences (wavefront.js prog_surface), from the march's own value at
//      the hit, straddled the jump. Mirrored: the field codegen writes (the wrappers, the smooth subtraction, the one
//      division), a hit where the march stops (its value a fraction of the tolerance), the normal as it was and as it
//      is (undivided looks, and the base looked at undivided: normalAtHitWGSL), against the field's own gradient there.
{
    const lib = JSON.parse(readFileSync(new URL('../../library/items/materials.json', import.meta.url), 'utf8')).items
    const reliefOf = name => lib.find(i => i.name === name)?.asset?.material?.relief
    const PL = reliefOf('white plaster'), ST = reliefOf('knockdown stucco')
    const has = (R, ...l) => !!R && l.every(x => lines(R.code).includes(x))
    ok('the mirror is the library\'s white plaster and knockdown stucco',
        has(PL, 'let n = fbm3(q / size, 1u, 4u, 2.0, 0.5);', 'h = amplitude * n.w / peak;', 'slope = amplitude / size * nzFbmLip(4u, 2.0, 0.5, NZ_GRAD_LIP_MEASURED) / peak;')
        && has(ST, 'let n = fbm3(q / size, 1u, 4u, 2.0, 0.5);', 'h = amplitude * smoothstep(edge, edge + soft, n.w / peak);',
            'slope = amplitude / size * nzFbmLip(4u, 2.0, 0.5, NZ_GRAD_LIP_MEASURED) / peak * 1.5 / soft;'))
    const peak = nzFbmLip(4, 1.0, 0.5, 1.0), grad = nzFbmLip(4, 2.0, 0.5, NZ_GRAD_LIP_MEASURED)
    const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
    const clampA = (h, A) => Math.max(-A, Math.min(A, h))         // codegen's relief function returns it clamped
    const plaster = q => { const { amplitude: A, size } = PL.params, n = fbm3(q.map(v => v / size), 1, 4, 2.0, 0.5)
        return { A, h: clampA(A * n[3] / peak, A), slope: A / size * grad / peak } }
    const stucco = q => { const { amplitude: A, size, edge, soft } = ST.params, n = fbm3(q.map(v => v / size), 1, 4, 2.0, 0.5)
        return { A, h: clampA(A * smoothstep(edge, edge + soft, n[3] / peak), A), slope: A / size * grad / peak * 1.5 / soft } }
    const csgIntersect = (a, b, k) => { if (k <= 0) return Math.max(a, b); const h = Math.max(k - Math.abs(a - b), 0); return Math.max(a, b) + h * h * 0.25 / k }
    // the plaster's face z = 0 (the box below it: only its top is near), the stucco sphere r 30 round (0, 0, 10) cut from it
    const C = [0, 0, 10], R0 = 30
    const sphere = p => Math.hypot(p[0] - C[0], p[1] - C[1], p[2] - C[2]) - R0
    const field = (p, blend, undivided = false) => {
        const reach = 1.25 * blend
        let rl = 1
        const wrap = (s, relief, q) => {         // codegen object() in a chain: the band, the height undivided, the slope kept
            const A = (relief === plaster ? PL : ST).params.amplitude
            if (Math.abs(s) > 2 * A + reach) return s - Math.sign(s) * A
            const r = relief(q); rl = Math.max(rl, 1 + r.slope); return s - r.h
        }
        const v = csgIntersect(wrap(p[2], plaster, p), -wrap(sphere(p), stucco, p.map((x, k) => x - C[k])), blend)
        return undivided ? v : v / rl                    // the chain's top: divided once, or undivided in a normal's look
    }
    const TOL = 0.05                                     // mm: the automatic tolerance of a scene about half a metre across
    const unit = v => { const l = Math.hypot(...v); return v.map(x => x / l) }
    const angle = (a, b) => Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI
    const forward = (f, p, base) => unit([0, 1, 2].map(k => { const q = [...p]; q[k] += TOL; return f(q) - base }))
    const walk = (blend, x0, x1) => {
        const out = { was: 0, wasOff: 0, now: 0, same: 0, steps: 0 }
        const edge = 2 * ST.params.amplitude + 1.25 * blend      // the stucco's distance where its band ends
        for (let i = 0, x = x0; x <= x1; i++, x = x0 + i * 0.004) {
            // the hit: where the march stops coming down, its divided value a fraction of the tolerance (a different one each)
            const f = 0.02 + 0.96 * ((i * 0.6180339887) % 1)
            let lo = -1.5, hi = 1.5
            for (let k = 0; k < 32; k++) { const m = (lo + hi) / 2; if (field([x, 0.3, m], blend) > f * TOL) hi = m; else lo = m }
            const p = [x, 0.3, hi]
            const was = forward(q => field(q, blend), p, field(p, blend))                        // the march's own value as base
            const now = forward(q => field(q, blend, true), p, field(p, blend, true))           // looked at, undivided
            const truth = unit([0, 1, 2].map(k => { const a = [...p], b = [...p]; a[k] += 1e-5; b[k] -= 1e-5; return field(a, blend, true) - field(b, blend, true) }))
            const w = angle(was, truth)
            if (w > out.was) { out.was = w; out.wasOff = sphere(p) - edge }
            out.now = Math.max(out.now, angle(now, truth))
            // where the jump is not within the differences' reach, the normal is what it was
            if (Math.abs(sphere(p) - edge) > 4 * TOL) { out.same = Math.max(out.same, angle(was, now)); out.steps++ }
        }
        return out
    }
    // each walk across the band's edge on the face (x about 34.3 with the blend, 30.4 without), clear of the fillet
    for (const [blend, x0, x1] of [[3, 33.5, 35.5], [0, 29.8, 31.3]]) {
        const r = walk(blend, x0, x1)
        ok(`blend ${blend}: as it was, the normal tilts where the stucco's band ends on the plaster (the line, mirrored)`,
            r.was > 5 && Math.abs(r.wasOff) <= TOL, `worst ${r.was.toFixed(2)} deg, ${r.wasOff.toFixed(4)} mm from the band's edge`)
        ok(`blend ${blend}: now the field's own gradient all the way across`, r.now < 0.1, `${r.now} deg`)
        ok(`blend ${blend}: ...and elsewhere the normal it was`, r.steps > 200 && r.same < 1e-4, `${r.steps} hits, ${r.same} deg`)
        console.log(`  band's edge, blend ${blend}: the normal off the field's gradient by up to ${r.was.toFixed(1)} deg as it was (${r.wasOff.toFixed(3)} mm from the stucco's band's edge), ${r.now.toExponential(1)} deg now`)
    }
}

console.log(`relief: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
