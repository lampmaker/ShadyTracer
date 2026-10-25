# Functions for code

> Made by `help/reference.mjs` from the program's own lists: edit that, not this page.

What the code of an object, a group, a material or the scene's functions can call. Code is WGSL, the graphics card's language, and every block is compiled after the same library, so everything here is in scope in every block -- along with WGSL's own functions: `length`, `abs`, `min`, `max`, `clamp`, `mix`, `smoothstep`, `dot`, `cross`, `normalize`, `sin`, `cos`, `fract`, `floor` and the rest ([the WGSL standard's list](https://www.w3.org/TR/WGSL/#builtin-functions)). See [Parameters and code](../modelling/parameters.md#writing-code) for how to write and apply code, and the [Shapes](shapes.md) and [Modifiers](modifiers.md) for code that uses these.

## What each block has

| block | runs | has, besides its own parameters by name |
|---|---|---|
| an object's | at every march step | `p` the point in the node's own frame, `C` the Hit to fold into, `MATERIAL` its material |
| a group's | at every march step, around its children | `p` (which it may change), `C`, `r` the ray, `children(C, p)`, `XF_S` this frame's units in world units, `SURFACE_ONLY`, `READ_REACH`, `DIVIDED_ABOVE` |
| a material's | once where a ray hits | `m` the material to change, `p` and `n` the hit and its normal in the world, `C`, and `p_local`, `R_local`, `S_local` the hit in the object's frame, its turn and its scale |
| a material's relief | at every march step near an object wearing it | `q` the point in mm in that object's frame, `world` the same in the scene's; it sets `h`, the height in mm outward, and `slope`, a bound on how steep `h` is |
| the scene's functions | -- | its functions are called from any of the others |

The comments a new block starts with say the same, with examples; **Functions you can call…** under a block opens this page.

## Words the page rewrites

Before it compiles, every whole word below is replaced -- in your code too, so do not name a variable or a parameter one of them: a variable `X` becomes `vec4<f32>`.

| word | becomes |
|---|---|
| `FLOAT` | `f32` |
| `INT` | `i32` |
| `VEC2` | `vec2<f32>` |
| `VEC3` | `vec3<f32>` |
| `VEC4` | `vec4<f32>` |
| `MAT4` | `mat4x4<f32>` |
| `PI` | `3.14159265359` |
| `TAU` | `6.28318530718` |
| `EPS` | `1e-5` |
| `F` | `f32` |
| `V` | `vec2<f32>` |
| `W` | `vec3<f32>` |
| `X` | `vec4<f32>` |
| `I` | `i32` |
| `U` | `u32` |
| `U3` | `vec3<u32>` |

## What a shape is

A shape is a `VEC4`: `xyz` its outward normal, unit length, and `w` its signed distance -- negative inside. A zero normal means *none*, and the renderer then takes the normal by differences. A distance must never be more than the true distance to the surface, or the march steps through it. `C = add_new(C, Nsphere(p, 0.5), MATERIAL);` is a sphere. `C = add_new(C, sd((p.z - 0.1 * sin(p.x * 10.0)) / 1.5), MATERIAL);` is a wavy floor: the height's slope reaches 1, so the field's reaches √2, and divided by 1.5 it is never more than the distance.

## Putting shapes into the scene

What an object's code calls once a shape, and what a group's code works with.

- `add_new(C: Hit, sdf: VEC4, matIndex: u32) -> Hit` -- Folds a shape into `C`: `sdf` is (normal, distance) in this node's own frame, taken to the world here; `matIndex` its material -- `MATERIAL` for the node's own. Every shape's code is this call. Used by *sphere*, *box*, *cylinder*, *capsule*, *torus* and 21 more.
- `fold(C: Hit, sdf: VEC4, matIndex: u32) -> Hit` -- `add_new` without the transform: for a result already in world units, such as the `s` of a Hit its children were folded into (`fold(C, H.s, H.m)`). Used by *circular array*, *round*, *shell*, *noise relief*.
- `emptyHit(r: Ray) -> Hit` -- A Hit with nothing in it yet: what a group folds its children into when it works on their result before it reaches `C` (`var H = children(emptyHit(r), p);`). Used by *circular array*, *round*, *shell*, *displace*, *noise relief*.
- `warp(k: f32)` -- Call after changing `p` in a way that is not a plain move or turn: every distance folded in from here on is multiplied by `k` (below 1 for a warp that stretches space, so the march does not step through), and normals are taken by differences. Used by *twist*, *bend*, *mirror*.
- `foldRelief(C: Hit, d: f32, m: u32, slope: f32, deferred: bool) -> Hit` -- A distance steepened by up to `slope` -- a noise added to it -- folded in: divided by `slope` here, so the march stays safe, or, passed `DIVIDED_ABOVE` in a CSG group, once after the blend. Used by *displace*, *noise relief*.

## Joining shapes

Each takes two (normal, distance) results and gives one; `k` is the blend's width, in the frame's units. The `csg` three are what a CSG group compiles to, and the ones to use: `k = 0` is a hard join, and the result has a normal only when both shapes have one -- otherwise the renderer takes it by differences, which is right for any shapes. The older ones, below, are kept for the code that calls them.

- `csgUnion(a: VEC4, b: VEC4, k: f32) -> VEC4` -- Both shapes; `k` above 0 melts them together where they come within `k` of each other.
- `csgIntersect(a: VEC4, b: VEC4, k: f32) -> VEC4` -- Only where both are.
- `csgSubtract(a: VEC4, b: VEC4, k: f32) -> VEC4` -- `a` with `b` cut out of it.

## Older joins

Kept for the code that calls them; new code is better off with the `csg` three above.

- `Nsmin(a: VEC4, b: VEC4, k: f32) -> VEC4` -- A smooth union with the normals blended. `k` must be above 0 (it is divided by), and both shapes need a normal: an `sd` shape's zero normal can make it NaN, and a NaN normal deletes the surface. `csgUnion` has neither problem.
- `Nsmax(a: VEC4, b: VEC4, k: f32) -> VEC4` -- A smooth intersection, as `Nsmin` with its caveats.
- `NopSmoothUnion(a: VEC4, b: VEC4, k: f32) -> VEC4` -- `Nsmin` by another name.
- `NopSmoothIntersect(a: VEC4, b: VEC4, k: f32) -> VEC4` -- `Nsmax` by another name.
- `NopSmoothSubtract(a: VEC4, b: VEC4, k: f32) -> VEC4` -- `a` with `b` cut out, smoothly: `Nsmax` of `a` and `b` turned inside out.
- `opSmoothUnion(d1: VEC4, d2: VEC4, k: f32) -> VEC4` -- A smooth union of the distances alone: no normal. `k` above 0.
- `opSmoothIntersect(d1: VEC4, d2: VEC4, k: f32) -> VEC4` -- A smooth intersection of the distances alone. `k` above 0.
- `opSmoothSubtract(d1: VEC4, d2: VEC4, k: f32) -> VEC4` -- `d1` with `d2` cut out, smoothly, distances alone. `k` above 0.
- `opUninion(d1: VEC4, d2: VEC4) -> VEC4` -- The smaller distance (a union), no normal. Spelled as it is in the code.
- `opIntersection(d1: VEC4, d2: VEC4) -> VEC4` -- The larger distance, no normal.
- `opSubtraction(d1: VEC4, d2: VEC4) -> VEC4` -- `d1` with `d2` cut out, no normal.
- `opScale(d: VEC4, s: f32) -> VEC4` -- The distance times `s`, no normal: what a shape drawn at `p / s` needs, `s` times its distance.

## Shapes with a normal

Each returns `VEC4(normal, distance)` with the normal worked out exactly, which saves the renderer three more evaluations of the whole scene at every hit (`tracebasics.js` `hitNormal`). All are centred on the origin with z up, unless it says otherwise; sizes are in the frame's units.

- `Nsphere(p: VEC3, r: f32) -> VEC4` -- A sphere of radius `r`. Used by *sphere*.
- `NboxRounded(p: VEC3, b: VEC3, r: f32) -> VEC4` -- A box of half-sizes `b`, its edges rounded by `r` within that size (`r = 0` sharp). Used by *box*.
- `Nroundedbox(p: VEC3, b: VEC3, r: f32) -> VEC4` -- A box of half-sizes `b` rounded by `r` outside it: `b + r` in all.
- `Nbox(p: VEC3, b: VEC3) -> VEC4` -- A box of half-sizes `b`, rounded by 0.01 outside them -- kept for the code that calls it; `NboxRounded` is the box shape's.
- `Ncylinder(p: VEC3, h: f32, r: f32) -> VEC4` -- A cylinder along z: `h` its half-height, `r` its radius. Used by *cylinder*.
- `Ncapsule(p: VEC3, h: f32, r: f32) -> VEC4` -- A segment from z = -`h` to +`h`, swept by radius `r`: a pill. Used by *capsule*.
- `Ntorus(p: VEC3, R: f32, r: f32) -> VEC4` -- A ring in the xy plane: `R` from the axis to the tube's centre, `r` the tube's radius. Used by *torus*.
- `NcappedTorus(p: VEC3, R: f32, r: f32, angle: f32) -> VEC4` -- An arc of a ring: radius `R` in the xy plane, `angle` degrees of it, symmetric about +y, swept by a tube of radius `r`. 360 is a whole ring. Used by *capped torus*.
- `Nlink(p: VEC3, span: f32, R: f32, r: f32) -> VEC4` -- A chain link: a ring of radius `R` pulled apart along y by `span`, swept by a tube of radius `r`. Used by *link*.
- `Nplane(p: VEC3) -> VEC4` -- Everything below z = 0, its surface facing +z. Infinite. Used by *plane*.
- `Nrectangle(p: VEC3, h: VEC2) -> VEC4` -- A flat rectangle of half-sizes `h` in the xy plane, no thickness: seen from both sides. Used by *rectangle*.
- `Ndisc(p: VEC3, r: f32) -> VEC4` -- A flat disc of radius `r` in the xy plane, no thickness. Used by *disc*.
- `NroundCone(p: VEC3, r1: f32, r2: f32, h: f32) -> VEC4` -- A sphere of radius `r1` at z = -`h`/2 and one of `r2` at +`h`/2, and the cone that touches both. Exact. Used by *round cone*.
- `Noctahedron(p: VEC3, s0: f32) -> VEC4` -- A regular octahedron, `s0` from its centre to each corner. Exact. Used by *octahedron*.
- `Npyramid(p: VEC3, base: f32, height: f32) -> VEC4` -- A square pyramid: base side `base` on z = -`height`/2, apex on +`height`/2. Exact.
- `Nfrustum(p: VEC3, base: VEC2, top: VEC2, height: f32) -> VEC4` -- A rectangular base `base.x` by `base.y` on z = -`height`/2 and a rectangular top `top` on +`height`/2; a top of 0 by 0 is a pyramid. Exact. Used by *pyramid*.
- `Nprism(p: VEC3, sides: f32, radius: f32, height: f32) -> VEC4` -- A regular polygon of `sides` sides (3 to 64), `radius` to its corners, a flat side facing -y, extruded `height` along z. Exact. Used by *prism*.
- `Ntriprism(p: VEC3, width: f32, height: f32, apex: f32, depth: f32) -> VEC4` -- A triangle in the xz plane, base `width` on z = -`height`/2, its top at `apex` along the base (0 over its -x end, 0.5 the middle, 1 its +x end), extruded `depth` along y. Exact.
- `Ndome(p: VEC3, R0: f32, height: f32) -> VEC4` -- The part of a sphere of radius `R0` above z = 0, `height` tall: its base sits on z = 0. Exact. Used by *dome*.
- `Ntube(p: VEC3, outer: f32, inner: f32, height: f32) -> VEC4` -- A hollow cylinder: radii `outer` and `inner`, `height` tall. `inner` of 0 or less is solid. Exact. Used by *tube*.
- `Ndish(p: VEC3, f: f32, aperture: f32, wall: f32) -> VEC4` -- A parabolic mirror of focal length `f`, its focus at the origin, opening to +z, out to radius `aperture`, with a wall `wall` thick behind the mirror. Exact inside, a bound outside near the rim. Used by *reflector*.
- `Nlens(p: VEC3, D: f32, t: f32, r1: f32, r2: f32) -> VEC4` -- A spherical lens along z: diameter `D`, centre thickness `t`, face radii `r1` (+z) and `r2` (-z) -- positive bulges out, negative is hollowed, 0 flat. A bound, exact near the face that wins. Used by *lens*.
- `Nasphere(p: VEC3, D: f32, t: f32, R1: f32, k1: f32, a1: VEC4, R2: f32, k2: f32, a2: VEC4) -> VEC4` -- An aspheric lens along z: diameter `D`, centre thickness `t`, and each face's radius, conic constant and coefficients a4..a10 (`R1, k1, a1` the +z face, `R2, k2, a2` the -z). A bound both sides. Used by *aspheric lens*.
- `Nmenger(p: VEC3, ITER: u32) -> VEC4` -- A Menger sponge `ITER` levels deep in a cube of half-size 1. Make `ITER` a compile-time parameter so its loop can be unrolled.

## Shapes with a distance only

These return a zero normal, so wherever one of them is the surface the renderer takes the normal by differences: three more evaluations of the whole scene at each hit. Use the `N` one where there is one.

- `sd(f: f32) -> VEC4` -- Wraps a bare distance as a result: `sd(length(p) - 0.5)` is a sphere. For a shape of your own.
- `sdSphere(p: VEC3, r: f32) -> VEC4` -- A sphere of radius `r`.
- `sdBox(p: VEC3, b: VEC3) -> VEC4` -- A sharp box of half-sizes `b`.
- `sdRoundedBox(p: VEC3, b: VEC3, r: f32) -> VEC4` -- A box of half-sizes `b` rounded by `r` outside it.
- `sdCylinder(p: VEC3, h: f32, r: f32) -> VEC4` -- A cylinder along z: `h` its half-height, `r` its radius.
- `sdCappedCylinder(p: VEC3, a: VEC3, b: VEC3, r: f32) -> VEC4` -- A cylinder of radius `r` from point `a` to point `b`.
- `sdCappedCone(p: VEC3, h: f32, r1: f32, r2: f32) -> VEC4` -- A cone along z: radius `r1` at z = -`h`, `r2` at +`h` (0 for a point). Exact; its normal is left to the renderer on purpose. Used by *cone*.
- `sdMenger(p: VEC3, ITER: u32) -> VEC4` -- A Menger sponge `ITER` levels deep in a cube of half-size 1.

## Building shapes in 2D

A shape of revolution is a 2D shape in the half-plane `q = VEC2(length(p.xy), p.z)`, and an extrusion one in `p.xy`. These return `VEC3(gradient.xy, distance)` there, and `g2Revolve` and `g2Extrude` lift that into 3D with its normal -- how the dish, the dome and the round cone are made.

- `g2Circle(q: VEC2, c: VEC2, r: f32) -> VEC3` -- A circle of radius `r` around `c`.
- `g2Box(q: VEC2, c: VEC2, b: VEC2) -> VEC3` -- A rectangle of half-sizes `b` around `c`. Exact.
- `g2RegularPolygon(q: VEC2, sides: f32, R0: f32) -> VEC3` -- A regular polygon of `sides` sides, `R0` to its corners, a flat side facing -y. Exact.
- `g2Triangle(q: VEC2, a: VEC2, b: VEC2, c: VEC2) -> VEC3` -- The triangle `a`, `b`, `c`, counter-clockwise. Exact.
- `g2Parabola(q: VEC2, k: f32) -> VEC3` -- The parabola y = `k` x^2 (`k` above 0), positive below it. Exact.
- `g2Max(a: VEC3, b: VEC3) -> VEC3` -- The larger of two: an intersection.
- `g2Neg(a: VEC3) -> VEC3` -- Inside and outside swapped.
- `g2Offset(a: VEC3, t: f32) -> VEC3` -- Grown by `t` (shrunk, for `t` below 0).
- `g2Revolve(p: VEC3, g: VEC3) -> VEC4` -- A 2D result at `q = VEC2(length(p.xy), p.z)` turned around the z axis.
- `g2Extrude(p: VEC3, g: VEC3, h: f32) -> VEC4` -- A 2D result at `p.xy`, extruded `h` either side of z = 0.
- `g2Dir(v: VEC2, fallback: VEC2) -> VEC2` -- `v` made unit length, or `fallback` where `v` is zero.
- `safeDir(v: VEC3, fallback: VEC3) -> VEC3` -- The same in 3D: `v` unit length, or `fallback` where it has no direction -- a normal that must never be NaN.

## Noise

Solid noise: one cell per unit of the point it is given, a pure function of the point and the `seed` (a `u32`, such as `3u`). Each returns its gradient with it, `VEC4(gradient, value)`, so a bump has a normal. A noise added to a distance makes the field steeper than 1, and the march then steps through the surface: divide by the steepness, or fold it with `foldRelief` as the *noise relief* modifier does. In a material, where it runs once a hit, nothing needs dividing.

- `vnoise3(p: VEC3, seed: u32) -> VEC4` -- Value noise: (gradient, value), the value in -1 to 1. Blockier than gradient noise.
- `gnoise3(p: VEC3, seed: u32) -> VEC4` -- Gradient (Perlin) noise: (gradient, value), the value about -1 to 1. Smoother and less tied to the grid.
- `fbm3(p: VEC3, seed: u32, octaves: u32, lac: f32, gain: f32) -> VEC4` -- `octaves` of gradient noise added up, each at `lac` times the last one's frequency and `gain` times its amplitude: (gradient, value). Used by *noise relief*.
- `nzFbmLip(octaves: u32, lac: f32, gain: f32, L: f32) -> f32` -- How steep `fbm3` with those settings can be, given `L` for one octave: `NZ_GRAD_LIP` (proved) or `NZ_GRAD_LIP_MEASURED` (a quarter of it, measured). What a distance with `fbm3` added is divided by. Used by *noise relief*.
- `worley3(p: VEC3, seed: u32) -> VEC4` -- Cells: `VEC4(F1, F2, id1, id2)` -- the distances to the nearest and second-nearest point, and a number from 0 to 1 for each of their cells. `F2 - F1` is 0 on a border: cracks, leather, grains.
- `worley3x(p: VEC3, seed: u32) -> VEC4` -- `worley3` of two point sets at once, the second turned and of another size, so no grid shows. Twice the cost.
- `perMm(cyclesPerMm: f32) -> f32` -- Cycles per millimetre in cycles per scene unit: `gnoise3(p * perMm(2.0), 1u)` has two cells a millimetre.

## Units

Code's numbers are in the scene's unit. These give a real size whatever that is.

- `metres(x: f32) -> f32` -- `x` metres in the scene's unit.
- `mm(x: f32) -> f32` -- `x` millimetres in the scene's unit.

## Materials

For a material's code, which changes `m` -- or returns a material of its own -- where a ray hits.

- `makeDefaultMaterial() -> Material2` -- A light grey dielectric: the starting point of every material.
- `makeDiffuse(color: VEC3, roughness: f32) -> Material2` -- A pure diffuse surface of colour `color`, no reflection. `roughness` changes nothing.
- `makePlastic(color: VEC3, roughness: f32, specular: f32) -> Material2` -- A coloured dielectric with a reflection: `specular` 0.5 the physical one.
- `makeMetal(color: VEC3, roughness: f32) -> Material2` -- A metal, `color` its reflectance.
- `makeMirror(color: VEC3) -> Material2` -- A perfect mirror, tinted `color`.
- `makeGlassSmooth(color: VEC3, ior: f32) -> Material2` -- Clear glass of index `ior`, tinted `color`.
- `makeGlassRough(color: VEC3, ior: f32, roughness: f32) -> Material2` -- Frosted glass: `makeGlassSmooth` with a `roughness`.
- `makeEmissive(color: VEC3) -> Material2` -- A surface emitting `color`.
- `mixMaterials(m1: Material2, m2: Material2, t: f32) -> Material2` -- Part way from `m1` to `m2`, `t` 0 to 1. A coating is one or the other, never half of each: `m2`'s past 0.5.
- `grainAlong(R: mat3x3<f32>, axis: VEC3) -> VEC3` -- A brushed grain, for `m.tangent` (with an anisotropy above 0): straight along `axis` in the object's frame. Pass `R_local` as `R`.
- `grainAround(R: mat3x3<f32>, q: VEC3, axis: VEC3) -> VEC3` -- A turned grain: circles about `axis` through the origin of `q` (usually `p_local`).
- `grainRadial(R: mat3x3<f32>, q: VEC3, axis: VEC3) -> VEC3` -- Spokes out from `axis`, as on a sunburst dial.
- `srfNoise(x: VEC3, seed: u32) -> f32` -- Smooth value noise from 0 to 1, one cell per unit of `x`.
- `streaksAlong(q: VEC3, axis: VEC3, width: f32, len: f32) -> f32` -- Brush lines along `axis`: a value from 0 to 1 per line, about `len` long and `width` across, for varying `m.roughness`. `q`, `width` and `len` in one unit.
- `streaksAround(q: VEC3, axis: VEC3, width: f32, len: f32) -> f32` -- The same as circles about `axis`, for a turned part.

## A scene's outlines and paths

A shape from points -- an outline or a path parameter, which the Points mode edits -- is given to these by its parameter's name, which is a handle for it. They exist in a scene that has such a parameter.

- `extrude(id: u32, p: VEC3, height: f32) -> VEC4` -- The node's profile parameter `id` (its name) in xy, extruded `height` along z, centred. Used by *extrusion*.
- `revolve(id: u32, p: VEC3) -> VEC4` -- The profile, as (radius, z), turned around the z axis. Used by *fresnel lens*, *revolution*.
- `profile(id: u32, q: VEC2) -> VEC3` -- The profile in 2D: (gradient, distance) at `q`, for use with the 2D functions.
- `tube(id: u32, p: VEC3, radius: f32, rounded: f32) -> VEC4` -- A tube of `radius` along the path parameter `id`; `rounded` above 0.5 gives it round ends. Used by *bent tube*.
- `sweep(id: u32, outline: u32, p: VEC3) -> VEC4` -- The profile `outline` swept along the path `id`, its ends flat. Used by *light guide*, *twisted bar*.
