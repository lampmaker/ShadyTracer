# Shapes

> Made by `help/reference.mjs` from the program's own lists: edit that, not this page.

Every shape the **+** menu and the Library offer, by group. Each is a code node that starts as the shape: its parameters are in Properties, in the scene's unit; its code can be edited into something else. See [How shapes are made](../modelling/sdf.md) for what a distance function is.

## Primitives

### sphere

A sphere around this node's origin.

| parameter | starts at |
|---|---|
| radius | 0.5 |

### box

A box: size is the HALF-size along each axis; the rounding stays inside it.

| parameter | starts at |
|---|---|
| size | 0.5, 0.5, 0.5 |
| rounding | 0.02 |

### cylinder

A cylinder along z, centred on this node's origin.

| parameter | starts at |
|---|---|
| radius | 0.5 |
| height | 1 |

### capsule

A capsule along z: height between the centres of its two end caps.

| parameter | starts at |
|---|---|
| radius | 0.25 |
| height | 0.5 |

### torus

A torus in the xy plane: ring is the radius to the tube's centre, tube its own radius.

| parameter | starts at |
|---|---|
| ring | 0.4 |
| tube | 0.1 |

### cone

A capped cone along z: base radius at the bottom, top radius at the top. No analytic normal (sdCappedCone): the renderer takes one by differences.

| parameter | starts at |
|---|---|
| base | 0.5 |
| top | 0 |
| height | 1 |

### round cone

Two spheres along z, bottom radius at z = -height/2 and top at +height/2, and the cone touching both (shapes.js NroundCone). A height under the radii's difference leaves the bigger sphere.

| parameter | starts at |
|---|---|
| bottom | 0.3 |
| top | 0.15 |
| height | 0.55 |

### pyramid

A pyramid along z: its base base.x by base.y at z = -height/2, its top top.x by top.y at +height/2 -- a top of 0 by 0 is an apex, anything else a frustum (bigger than the base: upside down). shapes.js Nfrustum.

| parameter | starts at |
|---|---|
| base | 1, 1 |
| top | 0, 0 |
| height | 1 |

### prism

A prism along z, centred: a regular polygon of sides sides (3 a triangle, 4 a square, ...), radius to its corners, a flat side down -- extruded. sides is live: dragging it needs no compile. shapes.js Nprism.

| parameter | starts at |
|---|---|
| sides | 3 |
| radius | 0.5 |
| height | 1 |

### octahedron

A regular octahedron around this node's origin, size from the centre to each of its six vertices.

| parameter | starts at |
|---|---|
| size | 0.5 |

### capped torus

Part of a torus in the xy plane: angle degrees of the ring (360 is all of it), symmetric about +y, its ends rounded. ring is the radius to the tube's centre, tube its own radius.

| parameter | starts at |
|---|---|
| ring | 0.42 |
| tube | 0.08 |
| angle | 270 |

### link

A chain link in the xy plane: a ring pulled apart along y by span (its straight sides), ring the radius of its rounded ends to the tube's centre, tube its own radius.

| parameter | starts at |
|---|---|
| span | 0.36 |
| ring | 0.25 |
| tube | 0.07 |

### tube

A hollow cylinder along z, centred: outer and inner radius. An inner radius of 0 makes it solid.

| parameter | starts at |
|---|---|
| outer | 0.5 |
| inner | 0.4 |
| height | 1 |

### dome

A dome: the top of a sphere of this radius, height tall, its flat base ON z = 0 -- placed on a board, it sits on it. A height over the radius is more than half a sphere; up to twice the radius.

| parameter | starts at |
|---|---|
| radius | 0.5 |
| height | 0.3 |

### plane

The plane z = 0, solid below.


## Optics

### lens

A spherical lens along z (sdf.js Nlens): r1 the +z face, r2 the -z face; a positive radius bulges out, a negative one is hollowed in, 0 is flat. Its refractive index is its material's -- give it a glass. Thin lens: 1/f = (n - 1)(1/r1 + 1/r2).

| parameter | starts at |
|---|---|
| diameter | 1 |
| thickness | 0.2 |
| r1 | 2 |
| r2 | 2 |

### aspheric lens

An aspheric lens along z (shapes.js Nasphere): r1, k1, a4_1..a10_1 the +z face, r2, k2, a4_2..a10_2 the -z face, each face's sag z(r) = c r^2 / (1 + sqrt(1 - (1 + k) c^2 r^2)) + a4 r^4 + a6 r^6 + a8 r^8 + a10 r^10, c = 1 / r, measured INTO the lens: a positive radius bulges out, a negative one is hollowed in, 0 is flat; k the conic constant (0 a sphere, -1 a paraboloid, below -1 a hyperboloid). A datasheet in Zemax's signs gives the face light enters by this way round; for the face it leaves by, negate r and the a's (k stays). As it starts, a condenser: in glass of n 1.5, a light on the axis 1 beyond the curved face's vertex comes out of the flat face as a parallel beam (k = -n^2, r = f (n - 1)). Its index is its material's -- give it a glass. The a's are in this scene's unit and are not converted when the lens moves to a scene of another.

| parameter | starts at |
|---|---|
| diameter | 1 |
| thickness | 0.3 |
| r1 | 0.5 |
| k1 | -2.25 |
| a4_1 | 0 |
| a6_1 | 0 |
| a8_1 | 0 |
| a10_1 | 0 |
| r2 | 0 |
| k2 | 0 |
| a4_2 | 0 |
| a6_2 | 0 |
| a8_2 | 0 |
| a10_2 | 0 |

### fresnel lens

A Fresnel lens, as (radius, z) turned about z (revolve): a flat back on z = 0 and the curved face of a plano-convex lens of focal length 1.5 in glass of n 1.49, cut into six rings -- edit the points, or work out others. Give it a glass. Straight facets: each ring's face is a cone, not a sphere.

| parameter | starts at |
|---|---|
| outline | 14 points |

### reflector

A parabolic reflector with its FOCUS AT THIS NODE'S ORIGIN, opening to +z: the mirror is the paraboloid with that focal length, out to the aperture's radius, its wall behind it -- a light at the origin is at the focus. Give it a mirror material. (shapes.js Ndish: its distance outside is a bound near the rim, never too large.)

| parameter | starts at |
|---|---|
| focal | 0.125 |
| aperture | 0.5 |
| wall | 0.01 |

### rectangle

A flat rectangle in the xy plane, no thickness (sdf.js Nrectangle), seen from both sides: a planar optics detector, or a ray limiter across a beam, with that material type.

| parameter | starts at |
|---|---|
| width | 1 |
| height | 1 |

### disc

A flat disc in the xy plane, no thickness (sdf.js Ndisc), seen from both sides.

| parameter | starts at |
|---|---|
| radius | 0.5 |


## From points

### extrusion

An outline in the xy plane, extruded along z, centred: one point per line in outline -- x, y, and a fillet radius to round that corner. Here a plate with a notch, every corner rounded.

| parameter | starts at |
|---|---|
| outline | 7 points |
| height | 0.2 |

### revolution

An outline as (radius, z), turned about z: a knob. The edge along the axis (x = 0) closes the outline and is no surface once revolved.

| parameter | starts at |
|---|---|
| outline | 6 points |

### bent tube

A tube along a path: one point per line in route -- x, y, z, and a fillet radius to round that corner (none leaves it a sharp corner), and a fifth number to scale the tube's diameter there (it tapers to the next point's) -- each a number or an expression of the parameters, as the last point's rise. The path is LIVE: rise moves it with no compile (below 0.2 the last fillet does not fit, and it draws nothing); untick live once it is right. rounded 1 rounds the two ends, 0 cuts them flat.

| parameter | starts at |
|---|---|
| route | a path of 4 points |
| rise | 0.6 |
| radius | 0.08 |
| rounded | 0 |

### light guide

A profile swept along a path, its ends flat: a light guide, a rounded bar bent twice in different planes. section is a closed outline (x, y, and a fillet, as an extrusion's); route the path (x, y, z and a fillet a point; the twisted bar shows three numbers more). The section's y starts as near world up (+z) as the path allows and is carried along it without twisting. Give it a glass and put a light at one end.

| parameter | starts at |
|---|---|
| route | a path of 4 points |
| section | 4 points |

### twisted bar

A bar swept along a path, turning and narrowing as it goes: after a point's x, y, z and fillet, three more numbers -- the section's scale x, its scale y (scale x's when left off) and its twist in degrees. They change evenly along a straight and hold round a bend: here the bar turns by turn degrees along the first straight, keeps that round the corner, and narrows to 0.6 along the second. The path is LIVE, so turn moves it with no compile. (A tube reads scale x alone: its diameter.)

| parameter | starts at |
|---|---|
| route | a path of 3 points |
| turn | 90 |
| section | 4 points |

