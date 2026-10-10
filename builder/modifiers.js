//======================================================================================================================
// MODIFIERS -- ready-made group code: what the group's + offers under "Modifiers".
//
// NOT A NODE TYPE, AND NOTHING THE GENERATOR KNOWS ABOUT. A modifier is a group whose code and
// parameters start as one of these; from then on it is a group like any other, and its code is
// the user's to change. That is the whole design (codegen, "A group's code"): one mechanism, the
// group calling its children, and these are examples of it that happen to be useful.
//
// EACH ONE SAYS WHAT IT COSTS, in its first comment, because group code runs at every march step
// of every ray. The two rules that keep a modifier correct are in its code, not hidden:
//   a warp that is not a plain move or turn calls warp(k) -- distances scaled by k so the march
//   does not overshoot, normals by differences because the analytic ones were bent with space;
//   a change to the distance goes through a Hit of the children's own, and multiplies a length
//   in this group's frame by XF_S to have it in the world units the Hit holds.
//
// TAGS say which of three kinds a modifier is, for the library's tag row: SPACE (it moves where the
// children are evaluated: twist, bend, repeat, mirror), SHAPE (it changes the distance by a size:
// round, shell) or SURFACE (a relief on the children's surface: displace, noise relief). A material
// can carry a relief itself now (materials.js RELIEFS), which is the usual way: what a surface is
// belongs to its material. These groups stay for a relief over a whole assembly or a CSG result.
// modifierGroup() leaves them out: a group has no tags.
//
// THE SCENE AS DATA KNOWS TWO SHAPES OF CODE, by reading it (codegen.js isBefore, isAfter): the space ones end with
// `C = children(C, p);` and fold nothing before it, round and shell start with `var H = children(emptyHit(r), p);`
// and warp nothing after -- so their children are records, and editing them compiles nothing. Code of another shape
// (displace and the relief read the CSG chain above them) is compiled with its children, which is right but slower to
// edit: a change here that moves a modifier out of its shape costs that, and scenedata.test.mjs says which is which.
//
// Parameter names avoid WGSL builtins -- a parameter is a `let` alias, and one called `round`
// would hide round() from the code that needs it (codegen's header).
//======================================================================================================================

const LEN = { min: 0.01, max: 10, step: 0.01 }

/* THE RELIEF'S CODE, given the WGSL for the Lipschitz bound of its fBm: what its distances are divided by near
   the surface. The modifier's is that bound summed over its four octaves from the one-octave bound measured for
   gradient noise. RELIEF_CODE_FBM_BOUND divides by a bound measured for this fBm itself (noise.js
   NZ_RELIEF_LIP_MEASURED): longer steps near the surface. Only the benchmark runs it, until it has been seen and
   timed. `note`: comment lines for the copy that differs. */
const reliefCode = (lip, note = []) => [
    '// Noise relief: a rough surface up to "amount" high and low, with features about "size"',
    '// across -- four octaves of gradient noise (lib/pathtracer/core/noise.js). Costs four',
    '// noises per step. The relief steepens the field by at most amount / size times the fBm\'s',
    '// bound over its peak, so distances are divided by that: shorter steps, no holes. The bound',
    '// is the MEASURED one (a quarter of the proved one, and a quarter the steps); for a proof',
    '// use NZ_GRAD_LIP. The normal is by differences.',
    '// IN A SHELL: the noise moves the surface by at most NZ_GRAD_VALUE_BOUND x amount (proved,',
    '// noise.js), so beyond that from the plain shape, the plain distance less it is a safe',
    '// distance -- no noise, no division. Only points near the surface pay for the noise. The',
    '// edge is twice that out, so a step from the shell is never shorter than the reach (a ray',
    '// grazing it would crawl), plus the hit tolerance times (slope + 1): a hit is within',
    '// slope tolerances of the plain shape\'s reach and its normal\'s differences one more, so',
    '// they never straddle the edge, where the value jumps. Under a smooth blend the edge is',
    '// farther by READ_REACH, as far as the blend reads the field off its surface (unbounded',
    '// under group code: no shell there). And foldRelief divides by the slope -- or, in a CSG',
    '// group (DIVIDED_ABOVE), leaves it to the group, which divides once after the blend: divided',
    '// before it, the fillet would come out the wrong size.',
    ...note,
    'var H = children(emptyHit(r), p);',
    'let peak = nzFbmLip(4u, 1.0, 0.5, 1.0);                 // the octaves\' amplitudes summed',
    `let slope = 1.0 + amount / size * ${lip} / peak;`,
    'let reach = NZ_GRAD_VALUE_BOUND * abs(amount) * XF_S;   // how far the noise can move it',
    'if (abs(H.s.w) > 2.0 * reach + READ_REACH + (slope + 1.0) * marchEps()) {',
    '    C = fold(C, VEC4(0.0, 0.0, 0.0, H.s.w - sign(H.s.w) * reach), H.m);',
    '} else {',
    '    let n = fbm3(p / size, 1u, 4u, 2.0, 0.5);',
    '    C = foldRelief(C, H.s.w - amount * n.w / peak * XF_S, H.m, slope, DIVIDED_ABOVE);',
    '}',
].join('\n')
export const RELIEF_CODE_FBM_BOUND = reliefCode('NZ_RELIEF_LIP_MEASURED', [
    '// THIS COPY divides by a step bound measured for this fBm itself (NZ_RELIEF_LIP_MEASURED), not',
    '// the one-octave bound summed over its octaves: longer steps. The benchmark\'s row, not yet the modifier.',
])

export const MODIFIERS = {
    twist: {
        label: 'twist',
        tags: ['space'],
        params: { rate: 1.0, extent: 1.0 },
        ranges: { rate: { min: -10, max: 10, step: 0.01 }, extent: LEN },
        lengths: ['extent'],
        code: [
            '// Twist about z: "rate" radians per unit of height. Costs a sin and a cos per step.',
            '// A twist stretches space, the more the farther from the axis; "extent" -- how far the',
            '// children reach from it -- sets the step scale that keeps the march from overshooting.',
            'let a = rate * p.z;',
            'p = VEC3(cos(a) * p.x - sin(a) * p.y, sin(a) * p.x + cos(a) * p.y, p.z);',
            'warp(1.0 / sqrt(1.0 + rate * rate * extent * extent));',
            'C = children(C, p);',
        ].join('\n'),
    },
    bend: {
        label: 'bend',
        tags: ['space'],
        params: { amount: 0.3, extent: 2.0 },
        ranges: { amount: { min: -3, max: 3, step: 0.001 }, extent: LEN },
        lengths: ['extent'],
        code: [
            '// Bend along x, curling toward z: "amount" radians per unit of x. A cheap bend, not an',
            '// exact one; a sin and a cos per step. "extent" -- how far along x the children reach --',
            '// sets the step scale.',
            'let a = amount * p.x;',
            'p = VEC3(cos(a) * p.x - sin(a) * p.z, p.y, sin(a) * p.x + cos(a) * p.z);',
            'warp(1.0 / sqrt(1.0 + amount * amount * extent * extent));',
            'C = children(C, p);',
        ].join('\n'),
    },
    repeat: {
        label: 'repeat',
        tags: ['space'],
        params: { spacing: { x: 2, y: 2, z: 2 }, count: { x: 2, y: 2, z: 0 } },
        lengths: ['spacing'],
        // vectors have no slider range in the model (only numbers do), so none is given here
        code: [
            '// Repeat: copies "spacing" apart, "count" each way along each axis (0: not along it),',
            '// so 2 count + 1 per axis -- all for the price of one, which makes it the cheapest',
            '// thing here. The children must fit in one cell, half a spacing around this group\'s',
            '// origin, or the distance is wrong near the cell borders.',
            'p = p - spacing * clamp(round(p / spacing), -count, count);',
            'C = children(C, p);',
        ].join('\n'),
    },
    mirror: {
        label: 'mirror',
        tags: ['space'],
        params: {},
        code: [
            '// Mirror across this group\'s x = 0 plane (turn the group to mirror across another):',
            '// the children on the +x side and their reflection, for the price of one. A reflection',
            '// turns analytic normals the wrong way, so they are taken by differences -- warp(1.0).',
            'p.x = abs(p.x);',
            'warp(1.0);',
            'C = children(C, p);',
        ].join('\n'),
    },
    round: {
        label: 'round',
        tags: ['shape'],
        params: { radius: 0.1 },
        ranges: { radius: { min: 0, max: 2, step: 0.001 } },
        lengths: ['radius'],
        code: [
            '// Round: every edge rounded by "radius" -- the shape grown outward by it, so it is that',
            '// much bigger too. Free per step, but through a Hit of the children\'s own: inside, the',
            '// medium is the nearest surface\'s rather than tracked per child (as in a CSG group).',
            'var H = children(emptyHit(r), p);',
            'H.s.w -= radius * XF_S;',
            'C = fold(C, H.s, H.m);',
        ].join('\n'),
    },
    shell: {
        label: 'shell',
        tags: ['shape'],
        params: { thickness: 0.05 },
        ranges: { thickness: { min: 0.001, max: 1, step: 0.001 } },
        lengths: ['thickness'],
        code: [
            '// Shell: the children\'s surface as a skin "thickness" thick, hollow inside -- cut it',
            '// open with a subtract group to see in. Free per step; a Hit of their own, as round.',
            'var H = children(emptyHit(r), p);',
            'H.s = VEC4(H.s.xyz * sign(H.s.w), abs(H.s.w) - thickness * XF_S);',
            'C = fold(C, H.s, H.m);',
        ].join('\n'),
    },
    displace: {
        label: 'displace',
        tags: ['surface'],
        params: { amount: 0.05, frequency: 2.0 },
        ranges: { amount: { min: 0, max: 1, step: 0.001 }, frequency: { min: 0.1, max: 20, step: 0.01 } },
        lengths: ['amount'],                // a height; the frequency is waves per unit, not a length
        code: [
            '// Displace: a ripple "amount" high, "frequency" waves per unit, on the children\'s',
            '// surface. Three sines per step, and the ripple steepens the field, so distances are',
            '// divided by its steepest slope -- smaller steps -- and the normal is by differences.',
            '// In a CSG group foldRelief leaves that to the group, after its blend (DIVIDED_ABOVE).',
            'var H = children(emptyHit(r), p);',
            'let q = p * frequency * 6.2831853;',
            'let ripple = amount * sin(q.x) * sin(q.y) * sin(q.z);',
            'let slope = 1.0 + amount * frequency * 6.2831853 * 1.7320508;',
            'C = foldRelief(C, H.s.w + ripple * XF_S, H.m, slope, DIVIDED_ABOVE);',
        ].join('\n'),
    },
    relief: {
        label: 'noise relief',
        tags: ['surface'],
        params: { amount: 0.03, size: 0.3 },
        ranges: { amount: { min: 0, max: 1, step: 0.001 }, size: { min: 0.01, max: 10, step: 0.01 } },
        lengths: ['amount', 'size'],
        code: reliefCode('nzFbmLip(4u, 2.0, 0.5, NZ_GRAD_LIP_MEASURED)'),
    },
}

/** A modifier as the options model.addGroup takes. */
export const modifierGroup = key => {
    const m = MODIFIERS[key]
    if (!m) return null
    const out = { label: m.label, code: m.code, params: structuredClone(m.params) }
    // which parameters are lengths in the scene's unit (model.js setLength): the panel shows the unit
    if (m.lengths?.length) out.lengths = [...m.lengths]
    const ranges = Object.fromEntries(Object.entries(m.ranges || {}).filter(([k]) => typeof m.params[k] === 'number'))
    if (Object.keys(ranges).length) out.ranges = structuredClone(ranges)
    return out
}
