//======================================================================================================================
// PRIMITIVES -- ready-made code nodes: what the + offers under "Shapes".
//
// NOT A NODE TYPE, AND NOTHING THE GENERATOR KNOWS ABOUT. There is one kind of object, a code node;
// a primitive is a code node whose label, code and parameters start as one of these. From then on it
// is a code node like any other and its code is the user's to change -- which is the point: a
// sphere with a dent in it starts as a sphere. The same design as modifiers.js for groups.
//
// IT COSTS NOTHING. These were node types once, each a `body` that codegen emitted through exactly
// the path a code node takes -- the same aliases, the same block, the same uniforms -- so a scene
// built from these compiles to the shader the types gave, only with each entry's comment in it, and
// a file saved with the types is upgraded to exactly the old shader (model.js v8to9, and
// codegen.test.mjs holds both). What was given up is the bounding box a type could be measured by:
// code can put its surface anywhere, so no object has a box any more.
//
// ADDING ONE is an entry here: its parameters (a number, {x, y, z} or {r, g, b} each), optional
// slider ranges for the numbers, the code, in the node's own frame with z up -- see
// OBJECT_CODE_TEMPLATE in codegen.js for what is in scope -- and its group (SHAPE_GROUPS). It
// appears in its group's submenu in this order.
// check-shaders builds a scene holding every entry, so a new one is compiled before it ships.
//
// USE AN N* FUNCTION FROM sdf.js OR shapes.js WHERE THERE IS ONE: it returns an analytic normal, and a
// shape without one costs the renderer three more evaluations of the whole scene per hit for a normal by
// differences (tracebasics.js calcNormals_fast). The cone is the one left without (see sdCappedCone).
// The newer shapes (core/shapes.js) say there whether their distance is exact or a bound, and its test
// holds them to it.
//
// STRETCH (2026-10-02, the user: move and scale in one control, "for some elements, scale could be independent for
// x, y, z axes"): which of a shape's own parameters a stretch along each of its axes multiplies -- `{ x: ['size.x'],
// ... }`, a vector's component as `name.c`, and two axes naming one parameter when the shape is round in them (a
// cylinder's radius is x and y). The gizmo's cube on that axis does it (builder/stretch.js, overlay.js): the shape
// stays exact -- a rounding keeps its radius -- where a stretched space would not, its distance no longer one
// (transform.js). Only on axes along which the shape's code says what its parameter spans (read in its comment and
// its call); a shape whose sizes are not one per axis (a sphere, the octahedron) has none, and is scaled whole.
//   LOOKED AT AGAIN, SHAPE BY SHAPE (the user, 2026-10-02: "check other shapes that can have size/dimension parameters
// using the sliders. Don't force it if it feels unnatural"). Added: the torus's and the capped torus's ring in x and
// y (it lies in xy), the link's span in y (its straight sides). Left out, as forced: a tube's own radius (a torus's,
// a link's) for z -- it is round, so it thickens every way, not along z; the link's ring for x -- it lengthens y as
// much; the reflector -- its depth follows its aperture and focal length together, and z by the focal length would
// run backwards; the shapes from points, whose points are their sizes (the Points mode). The lights and the export
// box, which are not presets, say theirs beside their parameters (lights.js, exportbox.js).
//
// LENGTHS AND WHAT IS PER ONE: `lengths` lists the parameters in the scene's unit (every one when it is left out), and
// `perLength` those that are per a length to a power -- the aspheric lens's coefficients; a modifier's rate or frequency
// (modifiers.js) -- so a unit's change that keeps the real size converts every built-in exactly (unitchange.js
// `dimensions`). A parameter in neither is a pure number: a count, an angle, a conic constant.
//
// SIZES: EVERY SHAPE FITS A 1-UNIT CUBE (the user, 2026-10-02: "sphere is now larger than cube ... ideally 1x1 so they
// are comparable in size"): its largest extent 1 in the scene's unit, centred where its code centres it -- the box,
// cylinder, tube, pyramid and lens always were; the sphere was 2 across, the torus 2, the cone 1.2, the octahedron
// 1.6, the round cone 1.75 tall, the dome, the Fresnel lens and the reflector 2 (an aperture is a radius), the link
// 1.64, the extrusion and the revolution 1.2. Their proportions are kept. Thin and flat ones stay so (a lens 0.2
// thick, a torus's tube). OLD FILES ARE NOT RESIZED: a version 8 node with no parameters keeps the sizes its type had
// (model.js V8_TYPES, frozen), and a node in a scene keeps the numbers it was saved with -- these are only where a
// new one starts. The modifiers keep theirs (a repeat's spacing 2): looser around 1-unit shapes, not wrong.
//
// Parameter names avoid WGSL builtins -- a parameter is a `let` alias, and one called `length`
// would hide length() from the code (codegen's header). Hence the capsule's `height`.
//======================================================================================================================

const LEN = { min: 0.01, max: 10, step: 0.01 }
const NONNEG = { min: 0, max: 10, step: 0.01 }

/* PROFILES (model.js setProfile; BUILDER.md §6 phase 3), for the presets that start from one: a Fresnel lens's sawtooth
   -- worked out once here, then the user's to edit like any outline */
const r4 = x => Math.round(x * 1e4) / 1e4
/* A FRESNEL LENS's outline as (radius, z), for revolve: a plano-convex lens of focal length f in glass of index n,
   its curved face cut into `zones` rings of equal width, each dropped back to the base -- so its sag is a sawtooth
   no taller than one ring's share. Straight facets stand in for each ring's arc (a polygon's normals, flat per
   ring), and the curvature is the thin lens's, 1/f = (n - 1) / R: a starting point, not a design. */
function fresnel({ radius = 1, f = 3, n = 1.49, zones = 6, base = 0.05 } = {}) {
    const Rc = f * (n - 1), sag = r => Rc - Math.sqrt(Rc * Rc - r * r), at = k => radius * k / zones
    const rise = k => sag(at(k + 1)) - sag(at(k))
    const pts = [[0, 0], [radius, 0], [radius, base]]
    for (let k = zones - 1; k >= 1; k--) pts.push([r4(at(k)), r4(base + rise(k))], [r4(at(k)), base])
    pts.push([0, r4(base + rise(0))])
    return pts
}

/* THE GROUPS the + menu and the library show the shapes in (the user, 2026-10-01: "organize / tag shapes: primitives,
   optics, complex" -- the third named "From points", what its shapes start from). Each entry says its own `group`; a
   `tags` list adds the library tags of another (the Fresnel lens is optics, and also from points). */
export const SHAPE_GROUPS = [
    { key: 'primitives', label: 'Primitives' },
    { key: 'optics', label: 'Optics' },
    { key: 'from points', label: 'From points' },
]

export const PRIMITIVES = {
    sphere: {
        group: 'primitives',
        params: { radius: 0.5 },
        ranges: { radius: LEN },
        code: [
            '// A sphere around this node\'s origin.',
            'C = add_new(C, Nsphere(p, radius), MATERIAL);',
        ].join('\n'),
    },
    box: {
        group: 'primitives',
        stretch: { x: ['size.x'], y: ['size.y'], z: ['size.z'] },
        params: { size: { x: 0.5, y: 0.5, z: 0.5 }, rounding: 0.02 },
        ranges: { rounding: { min: 0, max: 2, step: 0.005 } },
        code: [
            '// A box: size is the HALF-size along each axis; the rounding stays inside it.',
            'C = add_new(C, NboxRounded(p, size, rounding), MATERIAL);',
        ].join('\n'),
    },
    cylinder: {
        group: 'primitives',
        stretch: { x: ['radius'], y: ['radius'], z: ['height'] },
        params: { radius: 0.5, height: 1.0 },
        ranges: { radius: LEN, height: LEN },
        code: [
            '// A cylinder along z, centred on this node\'s origin.',
            'C = add_new(C, Ncylinder(p, height * 0.5, radius), MATERIAL);',
        ].join('\n'),
    },
    capsule: {
        group: 'primitives',
        stretch: { x: ['radius'], y: ['radius'], z: ['height'] },
        params: { radius: 0.25, height: 0.5 },
        ranges: { radius: LEN, height: NONNEG },
        code: [
            '// A capsule along z: height between the centres of its two end caps.',
            'C = add_new(C, Ncapsule(p, height * 0.5, radius), MATERIAL);',
        ].join('\n'),
    },
    torus: {
        group: 'primitives',
        stretch: { x: ['ring'], y: ['ring'] },
        params: { ring: 0.4, tube: 0.1 },
        ranges: { ring: LEN, tube: LEN },
        code: [
            '// A torus in the xy plane: ring is the radius to the tube\'s centre, tube its own radius.',
            'C = add_new(C, Ntorus(p, ring, tube), MATERIAL);',
        ].join('\n'),
    },
    cone: {
        group: 'primitives',
        stretch: { x: ['base', 'top'], y: ['base', 'top'], z: ['height'] },
        params: { base: 0.5, top: 0.0, height: 1.0 },
        ranges: { base: NONNEG, top: NONNEG, height: LEN },
        code: [
            '// A capped cone along z: base radius at the bottom, top radius at the top.',
            '// No analytic normal (sdCappedCone): the renderer takes one by differences.',
            'C = add_new(C, sdCappedCone(p, height * 0.5, base, top), MATERIAL);',
        ].join('\n'),
    },
    'round cone': {
        group: 'primitives',
        stretch: { x: ['bottom', 'top'], y: ['bottom', 'top'], z: ['height'] },
        params: { bottom: 0.3, top: 0.15, height: 0.55 },
        ranges: { bottom: NONNEG, top: NONNEG, height: LEN },
        code: [
            '// Two spheres along z, bottom radius at z = -height/2 and top at +height/2, and the cone touching',
            '// both (shapes.js NroundCone). A height under the radii\'s difference leaves the bigger sphere.',
            'C = add_new(C, NroundCone(p, bottom, top, height), MATERIAL);',
        ].join('\n'),
    },
    pyramid: {
        group: 'primitives',
        stretch: { x: ['base.x', 'top.x'], y: ['base.y', 'top.y'], z: ['height'] },
        params: { base: { x: 1.0, y: 1.0 }, top: { x: 0.0, y: 0.0 }, height: 1.0 },
        ranges: { height: LEN },
        code: [
            '// A pyramid along z: its base base.x by base.y at z = -height/2, its top top.x by top.y at +height/2 --',
            '// a top of 0 by 0 is an apex, anything else a frustum (bigger than the base: upside down). shapes.js Nfrustum.',
            'C = add_new(C, Nfrustum(p, base, top, height), MATERIAL);',
        ].join('\n'),
    },
    prism: {
        group: 'primitives',
        stretch: { x: ['radius'], y: ['radius'], z: ['height'] },
        params: { sides: 3, radius: 0.5, height: 1.0 },
        ranges: { sides: { min: 3, max: 12, step: 1 }, radius: LEN, height: LEN },
        lengths: ['radius', 'height'],
        code: [
            '// A prism along z, centred: a regular polygon of sides sides (3 a triangle, 4 a square, ...), radius to its',
            '// corners, a flat side down -- extruded. sides is live: dragging it needs no compile. shapes.js Nprism.',
            'C = add_new(C, Nprism(p, sides, radius, height), MATERIAL);',
        ].join('\n'),
    },
    octahedron: {
        group: 'primitives',
        params: { size: 0.5 },
        ranges: { size: LEN },
        code: [
            '// A regular octahedron around this node\'s origin, size from the centre to each of its six vertices.',
            'C = add_new(C, Noctahedron(p, size), MATERIAL);',
        ].join('\n'),
    },
    'capped torus': {
        group: 'primitives',
        stretch: { x: ['ring'], y: ['ring'] },
        params: { ring: 0.42, tube: 0.08, angle: 270 },
        ranges: { ring: LEN, tube: LEN, angle: { min: 0, max: 360, step: 1 } },
        lengths: ['ring', 'tube'],
        code: [
            '// Part of a torus in the xy plane: angle degrees of the ring (360 is all of it), symmetric about +y,',
            '// its ends rounded. ring is the radius to the tube\'s centre, tube its own radius.',
            'C = add_new(C, NcappedTorus(p, ring, tube, angle), MATERIAL);',
        ].join('\n'),
    },
    link: {
        group: 'primitives',
        stretch: { y: ['span'] },
        params: { span: 0.36, ring: 0.25, tube: 0.07 },
        ranges: { span: NONNEG, ring: LEN, tube: LEN },
        code: [
            '// A chain link in the xy plane: a ring pulled apart along y by span (its straight sides),',
            '// ring the radius of its rounded ends to the tube\'s centre, tube its own radius.',
            'C = add_new(C, Nlink(p, span, ring, tube), MATERIAL);',
        ].join('\n'),
    },
    tube: {
        group: 'primitives',
        stretch: { x: ['outer', 'inner'], y: ['outer', 'inner'], z: ['height'] },
        params: { outer: 0.5, inner: 0.4, height: 1.0 },
        ranges: { outer: LEN, inner: NONNEG, height: LEN },
        code: [
            '// A hollow cylinder along z, centred: outer and inner radius. An inner radius of 0 makes it solid.',
            'C = add_new(C, Ntube(p, outer, inner, height), MATERIAL);',
        ].join('\n'),
    },
    dome: {
        group: 'primitives',
        stretch: { x: ['radius'], y: ['radius'], z: ['height'] },
        params: { radius: 0.5, height: 0.3 },
        ranges: { radius: LEN, height: LEN },
        code: [
            '// A dome: the top of a sphere of this radius, height tall, its flat base ON z = 0 -- placed on a board,',
            '// it sits on it. A height over the radius is more than half a sphere; up to twice the radius.',
            'C = add_new(C, Ndome(p, radius, height), MATERIAL);',
        ].join('\n'),
    },
    lens: {
        group: 'optics',
        stretch: { x: ['diameter'], y: ['diameter'], z: ['thickness'] },
        params: { diameter: 1.0, thickness: 0.2, r1: 2.0, r2: 2.0 },
        ranges: { diameter: LEN, thickness: { min: 0.001, max: 10, step: 0.001 },
                  r1: { min: -50, max: 50, step: 0.01 }, r2: { min: -50, max: 50, step: 0.01 } },
        code: [
            '// A spherical lens along z (sdf.js Nlens): r1 the +z face, r2 the -z face; a positive radius',
            '// bulges out, a negative one is hollowed in, 0 is flat. Its refractive index is its material\'s --',
            '// give it a glass. Thin lens: 1/f = (n - 1)(1/r1 + 1/r2).',
            'C = add_new(C, Nlens(p, diameter, thickness, r1, r2), MATERIAL);',
        ].join('\n'),
    },
    /* THE ASPHERIC LENS (the user, 2026-10-04: "I'd like to make condenser lens"): it starts as the condenser that is
       exact on axis -- a hyperboloid of k = -n^2 over a flat face -- and its a's start at 0. Its ranges are wide,
       because they are not converted with the scene's unit: a 25 mm condenser in a millimetre scene is 25 of them.
       Its a's have none: a datasheet's are typed, and a slider's step would round 1e-9 to nothing (the panel shows a
       number without a range in as many digits as it has). */
    'aspheric lens': {
        group: 'optics',
        stretch: { x: ['diameter'], y: ['diameter'], z: ['thickness'] },
        params: { diameter: 1.0, thickness: 0.3, r1: 0.5, k1: -2.25, a4_1: 0, a6_1: 0, a8_1: 0, a10_1: 0,
                  r2: 0, k2: 0, a4_2: 0, a6_2: 0, a8_2: 0, a10_2: 0 },
        ranges: { diameter: { min: 0.01, max: 1000, step: 0.001 }, thickness: { min: 0.001, max: 1000, step: 0.001 },
                  r1: { min: -10000, max: 10000, step: 0.0001 }, k1: { min: -100, max: 100, step: 0.000001 },
                  r2: { min: -10000, max: 10000, step: 0.0001 }, k2: { min: -100, max: 100, step: 0.000001 } },
        lengths: ['diameter', 'thickness', 'r1', 'r2'],
        // a4..a10 are the scene's unit to the power 1 - 2i (shapes.js Nasphere): a unit's change divides them by the
        // factor to these powers (unitchange.js); k1 and k2 have none
        perLength: { a4_1: 3, a6_1: 5, a8_1: 7, a10_1: 9, a4_2: 3, a6_2: 5, a8_2: 7, a10_2: 9 },
        code: [
            '// An aspheric lens along z (shapes.js Nasphere): r1, k1, a4_1..a10_1 the +z face, r2, k2, a4_2..a10_2 the -z',
            '// face, each face\'s sag z(r) = c r^2 / (1 + sqrt(1 - (1 + k) c^2 r^2)) + a4 r^4 + a6 r^6 + a8 r^8 + a10 r^10,',
            '// c = 1 / r, measured INTO the lens: a positive radius bulges out, a negative one is hollowed in, 0 is flat;',
            '// k the conic constant (0 a sphere, -1 a paraboloid, below -1 a hyperboloid). A datasheet in Zemax\'s signs',
            '// gives the face light enters by this way round; for the face it leaves by, negate r and the a\'s (k stays).',
            '// As it starts, a condenser: in glass of n 1.5, a light on the axis 1 beyond the curved face\'s vertex comes',
            '// out of the flat face as a parallel beam (k = -n^2, r = f (n - 1)). Its index is its material\'s -- give it a',
            '// glass. The a\'s are in this scene\'s unit and are not converted when the lens moves to a scene of another.',
            'C = add_new(C, Nasphere(p, diameter, thickness, r1, k1, VEC4(a4_1, a6_1, a8_1, a10_1), r2, k2, VEC4(a4_2, a6_2, a8_2, a10_2)), MATERIAL);',
        ].join('\n'),
    },
    'fresnel lens': {
        group: 'optics', tags: ['from points'],
        params: { outline: fresnel({ radius: 0.5, f: 1.5, base: 0.025 }) },
        code: [
            '// A Fresnel lens, as (radius, z) turned about z (revolve): a flat back on z = 0 and the curved face of a',
            '// plano-convex lens of focal length 1.5 in glass of n 1.49, cut into six rings -- edit the points, or work',
            '// out others. Give it a glass. Straight facets: each ring\'s face is a cone, not a sphere.',
            'C = add_new(C, revolve(outline, p), MATERIAL);',
        ].join('\n'),
    },
    reflector: {
        group: 'optics',
        params: { focal: 0.125, aperture: 0.5, wall: 0.01 },
        ranges: { focal: LEN, aperture: LEN, wall: { min: 0.001, max: 1, step: 0.001 } },
        code: [
            '// A parabolic reflector with its FOCUS AT THIS NODE\'S ORIGIN, opening to +z: the mirror is the',
            '// paraboloid with that focal length, out to the aperture\'s radius, its wall behind it -- a light at',
            '// the origin is at the focus. Give it a mirror material. (shapes.js Ndish: its distance outside is a',
            '// bound near the rim, never too large.)',
            'C = add_new(C, Ndish(p, focal, aperture, wall), MATERIAL);',
        ].join('\n'),
    },
    extrusion: {
        group: 'from points',
        stretch: { z: ['height'] },
        params: { outline: [[-0.5, -0.35, 0.08], [0.5, -0.35, 0.08], [0.5, 0.35, 0.08], [0.125, 0.35, 0.035], [0, 0.125, 0.05], [-0.125, 0.35, 0.035], [-0.5, 0.35, 0.08]], height: 0.2 },
        ranges: { height: LEN },
        code: [
            '// An outline in the xy plane, extruded along z, centred: one point per line in outline -- x, y, and a',
            '// fillet radius to round that corner. Here a plate with a notch, every corner rounded.',
            'C = add_new(C, extrude(outline, p, height), MATERIAL);',
        ].join('\n'),
    },
    revolution: {
        group: 'from points',
        params: { outline: [[0, -0.42], [0.5, -0.42, 0.08], [0.5, 0.08], [0.21, 0.25, 0.125], [0.33, 0.5, 0.08], [0, 0.5]] },
        code: [
            '// An outline as (radius, z), turned about z: a knob. The edge along the axis (x = 0) closes the outline',
            '// and is no surface once revolved.',
            'C = add_new(C, revolve(outline, p), MATERIAL);',
        ].join('\n'),
    },
    'bent tube': {
        group: 'from points',
        params: { route: { path: [[-0.5, -0.5, 0], [0.5, -0.5, 0, 0.2], [0.5, 0.5, 0, 0.2], [0.5, 0.5, 'rise']], live: true }, rise: 0.6, radius: 0.08, rounded: 0 },
        ranges: { rise: LEN, radius: LEN, rounded: { min: 0, max: 1, step: 1 } },
        lengths: ['route', 'rise', 'radius'],
        code: [
            '// A tube along a path: one point per line in route -- x, y, z, and a fillet radius to round that corner',
            '// (none leaves it a sharp corner), and a fifth number to scale the tube\'s diameter there (it tapers to the',
            '// next point\'s) -- each a number or an expression of the parameters, as the last point\'s',
            '// rise. The path is LIVE: rise moves it with no compile (below 0.2 the last fillet does not fit, and it draws',
            '// nothing); untick live once it is right. rounded 1 rounds the two ends, 0 cuts them flat.',
            'C = add_new(C, tube(route, p, radius, rounded), MATERIAL);',
        ].join('\n'),
    },
    'light guide': {
        group: 'from points',
        params: { route: { path: [[-0.7, 0, 0], [-0.2, 0, 0, 0.25], [0.2, 0.4, 0, 0.25], [0.2, 0.4, 0.5]] },
                  section: [[-0.08, -0.04, 0.02], [0.08, -0.04, 0.02], [0.08, 0.04, 0.02], [-0.08, 0.04, 0.02]] },
        code: [
            '// A profile swept along a path, its ends flat: a light guide, a rounded bar bent twice in different',
            '// planes. section is a closed outline (x, y, and a fillet, as an extrusion\'s); route the path (x, y, z',
            '// and a fillet a point; the twisted bar shows three numbers more). The section\'s y starts as near world',
            '// up (+z) as the path allows and is carried along it without twisting. Give it a glass and put a light at',
            '// one end.',
            'C = add_new(C, sweep(route, section, p), MATERIAL);',
        ].join('\n'),
    },
    'twisted bar': {
        group: 'from points',
        params: { route: { path: [[-0.6, 0, 0], [0.2, 0, 0, 0.25, 1, 1, 'turn'], [0.2, 0.5, 0.3, 0, 0.6, 0.6, 'turn']], live: true }, turn: 90,
                  section: [[-0.12, -0.04, 0.02], [0.12, -0.04, 0.02], [0.12, 0.04, 0.02], [-0.12, 0.04, 0.02]] },
        ranges: { turn: { min: -360, max: 360, step: 1 } },
        lengths: ['route', 'section'],
        code: [
            '// A bar swept along a path, turning and narrowing as it goes: after a point\'s x, y, z and fillet, three',
            '// more numbers -- the section\'s scale x, its scale y (scale x\'s when left off) and its twist in degrees.',
            '// They change evenly along a straight and hold round a bend: here the bar turns by turn degrees along',
            '// the first straight, keeps that round the corner, and narrows to 0.6 along the second. The path is',
            '// LIVE, so turn moves it with no compile. (A tube reads scale x alone: its diameter.)',
            'C = add_new(C, sweep(route, section, p), MATERIAL);',
        ].join('\n'),
    },
    rectangle: {
        group: 'optics',
        stretch: { x: ['width'], y: ['height'] },
        params: { width: 1.0, height: 1.0 },
        ranges: { width: LEN, height: LEN },
        code: [
            '// A flat rectangle in the xy plane, no thickness (sdf.js Nrectangle), seen from both sides:',
            '// a planar optics detector, or a ray limiter across a beam, with that material type.',
            'C = add_new(C, Nrectangle(p, VEC2(width, height) * 0.5), MATERIAL);',
        ].join('\n'),
    },
    disc: {
        group: 'optics',
        stretch: { x: ['radius'], y: ['radius'] },
        params: { radius: 0.5 },
        ranges: { radius: LEN },
        code: [
            '// A flat disc in the xy plane, no thickness (sdf.js Ndisc), seen from both sides.',
            'C = add_new(C, Ndisc(p, radius), MATERIAL);',
        ].join('\n'),
    },
    plane: {
        group: 'primitives',
        params: {},
        code: [
            '// The plane z = 0, solid below.',
            'C = add_new(C, Nplane(p), MATERIAL);',
        ].join('\n'),
    },
}

/** The shapes by group, in SHAPE_GROUPS' order and this file's within each: [{ key, label, keys: [...] }]. */
export const shapeMenu = () => SHAPE_GROUPS.map(g => ({ ...g, keys: Object.keys(PRIMITIVES).filter(k => PRIMITIVES[k].group === g.key) }))
/** A shape's library tags: its group's, and any its entry adds. */
export const shapeTags = key => [PRIMITIVES[key]?.group, ...(PRIMITIVES[key]?.tags || [])].filter(Boolean)

/** A primitive as the options model.addObject takes: a code node named after it. Ranges only for
 *  numbers, which are all the panel can put a slider on. Every parameter of these is a length in the
 *  scene's unit (model.js setLength: the panel shows "radius (cm)"), unless an entry lists its own. */
export const primitiveObject = key => {
    const s = PRIMITIVES[key]
    if (!s) return null
    const out = { label: key, code: s.code, params: structuredClone(s.params) }
    const lengths = s.lengths ?? Object.keys(s.params)
    if (lengths.length) out.lengths = [...lengths]
    const ranges = Object.fromEntries(Object.entries(s.ranges || {}).filter(([k]) => typeof s.params[k] === 'number'))
    if (Object.keys(ranges).length) out.ranges = structuredClone(ranges)
    return out
}
