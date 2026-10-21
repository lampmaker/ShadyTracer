//======================================================================================================================
// STEP -- a STEP file (ISO 10303-21, the AP203 / AP214 / AP242 a CAD program exports) read into solids whose faces
// know the exact surface they lie on: the B-rep, in millimetres, every placement of an assembly applied.
//
// OUR OWN READER, NOT OPENCASCADE'S (roadmap/IMPORT.md section 11, 2026-10-21). The investigation of 2026-10-02 chose
// occt-wasm, a 4.5 MB LGPL WebAssembly build, because the optics route needed each face's surface type and occt-
// import-js gives only triangles. But the file already says each face's surface type in plain text -- a face is an
// ADVANCED_FACE naming a PLANE, a CYLINDRICAL_SURFACE, ... -- and reading the B-rep's topology and its analytic
// geometry is a few hundred lines, with no dependency and nothing to load. What this does not do is what only a
// geometry kernel does: tessellate a B-spline surface, sew an open shell, repair a bad one. Such faces are kept with
// their type ('bspline', 'revolution', ...) so the caller can say what it cannot convert (csg.js refuses them).
//
// WHAT IS READ:
//   the entities, lazily: the file is cut into records at the top-level ';', and a record's parameters are parsed
//     only when something asks for it -- most of a file (pcurves, presentation, product data) is never looked at
//   the units: the length unit of each shape's context, an SI prefix or a conversion-based one like the inch, so
//     every length comes out in mm; the plane-angle unit, since a cone's semi-angle is in it (degrees in some files)
//   the solids: MANIFOLD_SOLID_BREP and BREP_WITH_VOIDS -- their faces, each face's surface and same_sense, its loops
//     as the oriented edges they are, each edge sampled along its curve (a line, circle, ellipse, B-spline, or one
//     wrapped in a SURFACE_CURVE or SEAM_CURVE) between its vertices, in the direction the loop runs it
//   the assembly: representations placed in their parents by REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION (an
//     ITEM_DEFINED_TRANSFORMATION between two axis placements) and by MAPPED_ITEM, composed from the roots down, so
//     a part used twice is two solids where it sits
//   names: a solid's own, else its product's
//
//   readSTEP(text) -> { schema, solids: [{ name, faces: [{ id, surface, sense, loops: [{ outer, points: [[x,y,z]],
//                                                          edges: [{ id, points }] }] }] }], unitMM, warnings }
//   where surface is geom.js's (plane, cylinder, cone, sphere, torus) or { type: 'bspline' | ..., unsupported: true }
//======================================================================================================================

import { frame, line, circle, ellipse, bspline, sampleCurve, makeSurface, moveSurface, fromFrame, compose, invert, apply,
         IDENTITY, sub, len } from './geom.js'

//----------------------------------------------------------------------------------------------------------------------
// PART 21: records, then values
//----------------------------------------------------------------------------------------------------------------------

/** The DATA section cut into records { id: text }: one per `#n = ...;`. Strings may hold ';' and comments may too. */
function records(text) {
    const start = text.search(/\bDATA\s*(\([^)]*\))?\s*;/)
    if (start < 0) throw new Error('not a STEP file: no DATA section')
    const out = new Map(), n = text.length
    let i = text.indexOf(';', start) + 1, recStart = i, pieces = []     // a record without its comments: the pieces between them
    while (i < n) {
        const c = text.charCodeAt(i)
        if (c === 39) {                                   // ' a string: '' is a quote inside it
            i++
            while (i < n) { if (text.charCodeAt(i) === 39) { if (text.charCodeAt(i + 1) === 39) i += 2; else break } else i++ }
            i++
            continue
        }
        if (c === 47 && text.charCodeAt(i + 1) === 42) {  // /* a comment */
            const e = text.indexOf('*/', i + 2)
            pieces.push(text.slice(recStart, i))
            i = e < 0 ? n : e + 2
            recStart = i
            continue
        }
        if (c === 59) {                                   // ;
            const rec = (pieces.join(' ') + text.slice(recStart, i)).trim()
            recStart = i + 1; pieces = []
            if (/^ENDSEC$/i.test(rec)) break
            const m = /^#(\d+)\s*=\s*/.exec(rec)
            if (m) out.set(+m[1], rec.slice(m[0].length))
        }
        i++
    }
    return out
}

/** One record's value: TYPE(args) -> { type, args }, or a complex ( A(...) B(...) ) -> { type: null, parts: { A: args } }.
 *  args: numbers, strings, { ref }, { enum }, null ($), '*', nested arrays, and { type, args } for a typed value. */
function parseRecord(s) {
    let i = 0
    const ws = () => { while (i < s.length && /\s/.test(s[i])) i++ }
    const name = () => { const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i, i + 200)); if (!m) throw new Error(`bad STEP value near '${s.slice(i, i + 40)}'`); i += m[0].length; return m[0].toUpperCase() }
    const list = () => {
        const out = []
        i++                                               // (
        ws()
        if (s[i] === ')') { i++; return out }
        for (;;) {
            out.push(value()); ws()
            if (s[i] === ',') { i++; continue }
            if (s[i] === ')') { i++; return out }
            throw new Error(`bad STEP list near '${s.slice(i, i + 40)}'`)
        }
    }
    const value = () => {
        ws()
        const c = s[i]
        if (c === '#') { const m = /^#(\d+)/.exec(s.slice(i, i + 24)); i += m[0].length; return { ref: +m[1] } }
        if (c === "'") {
            let j = i + 1, out = ''
            for (;;) {
                const k = s.indexOf("'", j)
                if (k < 0) throw new Error('unterminated STEP string')
                out += s.slice(j, k)
                if (s[k + 1] === "'") { out += "'"; j = k + 2 } else { i = k + 1; break }
            }
            return decodeString(out)
        }
        if (c === '.') { const k = s.indexOf('.', i + 1); const e = s.slice(i + 1, k).toUpperCase(); i = k + 1; return { enum: e } }
        if (c === '$') { i++; return null }
        if (c === '*') { i++; return '*' }
        if (c === '(') return list()
        if (c === '"') { const k = s.indexOf('"', i + 1); i = k + 1; return { binary: s.slice(i, k) } }
        if (/[-+0-9.]/.test(c)) {
            const m = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(s.slice(i, i + 40))
            i += m[0].length
            return parseFloat(m[0])
        }
        const t = name(); ws()
        return { type: t, args: list() }                  // a typed value, LENGTH_MEASURE(1.)
    }
    ws()
    if (s[i] === '(') {
        i++
        const parts = {}
        for (;;) {
            ws()
            if (s[i] === ')') break
            const t = name(); ws()
            parts[t] = list()
        }
        return { type: null, parts }
    }
    const t = name(); ws()
    return { type: t, args: list() }
}

/* \X2\00E9\X0\ and \X\E9 (ISO 10303-21's encodings) into the characters they are; names are only shown */
function decodeString(s) {
    return s.replace(/\\X2\\([0-9A-F]+)\\X0\\/gi, (_, h) => String.fromCharCode(...h.match(/.{4}/g).map(x => parseInt(x, 16))))
            .replace(/\\X\\([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

/** The file's entities, parsed on first asking. get(ref) -> { id, type, args } or { id, type: null, parts }. */
export function entities(text) {
    const raw = records(text), cache = new Map()
    const get = r => {
        const id = typeof r === 'object' && r ? r.ref : r
        if (cache.has(id)) return cache.get(id)
        const s = raw.get(id)
        if (s === undefined) throw new Error(`STEP: #${id} is referred to and not defined`)
        const e = { id, ...parseRecord(s) }
        cache.set(id, e)
        return e
    }
    /* the ids of every record of a type, found without parsing the rest: a simple record starts with its name */
    const ofType = type => {
        const out = []
        for (const [id, s] of raw) if (s.startsWith(type) && /^[A-Z_0-9]+/.exec(s)[0] === type) out.push(id)
        return out
    }
    /* complex records holding a part of this name */
    const complexWith = part => {
        const out = [], re = new RegExp(`\\b${part}\\s*\\(`)
        for (const [id, s] of raw) if (s.startsWith('(') && re.test(s)) out.push(id)
        return out
    }
    return { get, ofType, complexWith, size: raw.size }
}

/** The args of an entity's part: a simple entity's own when its type matches, a complex one's part of that name. */
const part = (e, type) => e.type === type ? e.args : e.type === null ? e.parts[type] ?? null : null
const is = (e, type) => e.type === type || (e.type === null && type in e.parts)

//----------------------------------------------------------------------------------------------------------------------
// UNITS
//----------------------------------------------------------------------------------------------------------------------
const SI_PREFIX = { EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 1e1,
                    DECI: 1e-1, CENTI: 1e-2, MILLI: 1e-3, MICRO: 1e-6, NANO: 1e-9, PICO: 1e-12, FEMTO: 1e-15, ATTO: 1e-18 }

/** A unit entity's size: for a length, in metres; for a plane angle, in radians. */
function unitSize(E, u) {
    const si = part(u, 'SI_UNIT')
    if (si) {
        const prefix = si[0]?.enum, unit = si[1]?.enum
        const base = unit === 'METRE' ? 1 : unit === 'RADIAN' ? 1 : unit === 'STERADIAN' ? 1 : unit === 'GRAM' ? 1e-3 : 1
        return base * (prefix ? SI_PREFIX[prefix] ?? 1 : 1)
    }
    const cb = part(u, 'CONVERSION_BASED_UNIT')
    if (cb) {
        const m = E.get(cb[1])                             // a MEASURE_WITH_UNIT: a value of another unit
        const mw = part(m, 'MEASURE_WITH_UNIT') ?? part(m, 'LENGTH_MEASURE_WITH_UNIT') ?? part(m, 'PLANE_ANGLE_MEASURE_WITH_UNIT') ?? m.args
        const v = mw[0]?.args ? mw[0].args[0] : mw[0]
        return v * unitSize(E, E.get(mw[1]))
    }
    return 1
}

/** A representation context's lengths in mm and angles in radians: { mm, rad }. Without units, mm and radians. */
function contextUnits(E, ctxRef, warnings) {
    const out = { mm: 1, rad: 1 }
    if (!ctxRef) return out
    const ctx = E.get(ctxRef)
    const g = part(ctx, 'GLOBAL_UNIT_ASSIGNED_CONTEXT')
    if (!g) return out
    for (const r of g[0]) {
        const u = E.get(r)
        if (is(u, 'LENGTH_UNIT')) out.mm = unitSize(E, u) * 1000
        else if (is(u, 'PLANE_ANGLE_UNIT')) out.rad = unitSize(E, u)
    }
    if (!(out.mm > 0 && Number.isFinite(out.mm))) { warnings.push('the length unit could not be read: taken as mm'); out.mm = 1 }
    if (!(out.rad > 0 && Number.isFinite(out.rad))) { warnings.push('the angle unit could not be read: taken as radians'); out.rad = 1 }
    return out
}

//----------------------------------------------------------------------------------------------------------------------
// GEOMETRY, in the file's units scaled to mm (`u`)
//----------------------------------------------------------------------------------------------------------------------
function geometry(E, U) {
    const point = r => { const a = part(E.get(r), 'CARTESIAN_POINT'); return a[1].map(x => x * U.mm) }
    const direction = r => { const a = part(E.get(r), 'DIRECTION'); return a[1].slice() }
    const placement = r => {
        const a = part(E.get(r), 'AXIS2_PLACEMENT_3D')
        if (!a) throw new Error(`STEP: #${r.ref ?? r} is not an AXIS2_PLACEMENT_3D`)
        return frame(point(a[1]), a[2] ? direction(a[2]) : [0, 0, 1], a[3] ? direction(a[3]) : null)
    }
    const curve = r => {
        const e = E.get(r)
        let a
        if ((a = part(e, 'SURFACE_CURVE') ?? part(e, 'SEAM_CURVE') ?? part(e, 'INTERSECTION_CURVE'))) return curve(a[1])
        if ((a = part(e, 'LINE'))) {
            const v = part(E.get(a[2]), 'VECTOR')
            const d = direction(v[1]), m = v[2] * U.mm
            return line(point(a[1]), [d[0] * m, d[1] * m, d[2] * m])
        }
        if ((a = part(e, 'CIRCLE'))) return circle(placement(a[1]), a[2] * U.mm)
        if ((a = part(e, 'ELLIPSE'))) return ellipse(placement(a[1]), a[2] * U.mm, a[3] * U.mm)
        if ((a = part(e, 'B_SPLINE_CURVE_WITH_KNOTS'))) {
            const b = part(e, 'B_SPLINE_CURVE') ?? part(e, 'B_SPLINE_CURVE_WITH_KNOTS')
            // simple: (name, degree, points, form, closed, self, mults, knots, spec); complex: B_SPLINE_CURVE(degree, points, ...)
            const simple = e.type === 'B_SPLINE_CURVE_WITH_KNOTS'
            const degree = simple ? b[1] : b[0], pts = (simple ? b[2] : b[1]).map(point)
            const mults = simple ? b[6] : a[0], ks = simple ? b[7] : a[1]
            const knots = []
            mults.forEach((m, i) => { for (let k = 0; k < m; k++) knots.push(ks[i]) })
            const w = part(e, 'RATIONAL_B_SPLINE_CURVE')
            return bspline(degree, pts, knots, w ? w[0] : null)
        }
        if ((a = part(e, 'POLYLINE'))) {
            const pts = a[1].map(point)
            return { type: 'polyline', pts }
        }
        if ((a = part(e, 'TRIMMED_CURVE'))) return curve(a[1])
        return { type: 'unsupported', name: e.type ?? Object.keys(e.parts).join('+') }
    }
    const surface = r => {
        const e = E.get(r)
        let a
        if ((a = part(e, 'PLANE'))) return makeSurface('plane', placement(a[1]), {})
        if ((a = part(e, 'CYLINDRICAL_SURFACE'))) return makeSurface('cylinder', placement(a[1]), { r: a[2] * U.mm })
        if ((a = part(e, 'CONICAL_SURFACE'))) return makeSurface('cone', placement(a[1]), { r: a[2] * U.mm, semi: a[3] * U.rad })
        if ((a = part(e, 'SPHERICAL_SURFACE'))) return makeSurface('sphere', placement(a[1]), { r: a[2] * U.mm })
        if ((a = part(e, 'TOROIDAL_SURFACE')) || (a = part(e, 'DEGENERATE_TOROIDAL_SURFACE')))
            return makeSurface('torus', placement(a[1]), { R: a[2] * U.mm, r: a[3] * U.mm })
        const kind = e.type ?? Object.keys(e.parts).find(k => /SURFACE/.test(k)) ?? 'surface'
        const name = /B_SPLINE/.test(kind) ? 'bspline' : /REVOLUTION/.test(kind) ? 'revolution' : /EXTRUSION/.test(kind) ? 'extrusion'
            : /OFFSET/.test(kind) ? 'offset' : kind.toLowerCase()
        return { type: name, unsupported: true }
    }
    return { point, direction, placement, curve, surface }
}

//----------------------------------------------------------------------------------------------------------------------
// TOPOLOGY: a solid's faces, each loop as points in the order the loop runs
//----------------------------------------------------------------------------------------------------------------------

/** An edge's points from its start vertex to its end, along its curve; `forward` false reverses it. */
function edgePoints(E, G, edgeRef, forward, warnings) {
    const ec = part(E.get(edgeRef), 'EDGE_CURVE')
    if (!ec) throw new Error(`STEP: #${edgeRef.ref} is not an EDGE_CURVE`)
    const vp = r => G.point(part(E.get(r), 'VERTEX_POINT')[1])
    const v1 = vp(ec[1]), v2 = vp(ec[2]), c = G.curve(ec[3]), same = ec[4]?.enum !== 'F'
    let pts
    if (c.type === 'line') pts = [v1, v2]
    else if (c.type === 'polyline') pts = [v1, ...c.pts.slice(1, -1), v2]
    else if (c.type === 'unsupported') { warnings.add(`an edge on a ${c.name.toLowerCase()} is taken as straight`); pts = [v1, v2] }
    else {
        // the stretch of the curve between the vertices, running the curve's own way when same_sense
        let a = c.paramOf(same ? v1 : v2), b = c.paramOf(same ? v2 : v1)
        if (c.periodic) {
            if (len(sub(v1, v2)) < 1e-9 * (1 + len(v1))) b = a + c.periodic          // a closed edge: the whole circle
            else { while (b <= a) b += c.periodic; while (b - a > c.periodic) b -= c.periodic }
        } else if (b < a) [a, b] = [b, a]
        pts = sampleCurve(c, a, b)
        if (!same) pts.reverse()
        pts[0] = v1; pts[pts.length - 1] = v2
    }
    return forward ? pts : pts.slice().reverse()
}

function readFace(E, G, ref, warnings) {
    const e = E.get(ref)
    const a = part(e, 'ADVANCED_FACE') ?? part(e, 'FACE_SURFACE')
    if (!a) throw new Error(`STEP: #${ref.ref ?? ref} is not a face`)
    const surface = G.surface(a[2])
    const sense = a[3]?.enum !== 'F'
    const loops = []
    for (const bref of a[1]) {
        const be = E.get(bref)
        const b = part(be, 'FACE_OUTER_BOUND') ?? part(be, 'FACE_BOUND')
        const outer = is(be, 'FACE_OUTER_BOUND'), orient = b[2]?.enum !== 'F'
        const le = E.get(b[1])
        /* each edge's points in the order the loop runs it, and which edge it is: two faces sharing an edge is how
           brep.js tells a sphere's or a torus's face which side of its loops it is on */
        let edges = []
        const el = part(le, 'EDGE_LOOP'), vl = part(le, 'VERTEX_LOOP'), pl = part(le, 'POLY_LOOP')
        if (el) {
            for (const oref of el[1]) {
                const oe = part(E.get(oref), 'ORIENTED_EDGE')
                edges.push({ id: oe[3].ref, points: edgePoints(E, G, oe[3], oe[4]?.enum !== 'F', warnings) })
            }
        } else if (vl) edges = [{ id: null, points: [G.point(part(E.get(vl[1]), 'VERTEX_POINT')[1])] }]
        else if (pl) edges = [{ id: null, points: pl[1].map(G.point) }]
        if (!orient) { edges.reverse(); edges.forEach(e => e.points = e.points.slice().reverse()) }
        const points = []
        for (const e of edges) points.push(...(points.length ? e.points.slice(1) : e.points))
        if (points.length > 1 && len(sub(points[0], points[points.length - 1])) < 1e-9 * (1 + len(points[0]))) points.pop()
        loops.push({ outer, points, edges })
    }
    return { id: ref.ref ?? ref, name: a[0] || '', surface, sense, loops }
}

function readSolid(E, G, ref, warnings) {
    const e = E.get(ref)
    const shells = []
    let a
    if ((a = part(e, 'MANIFOLD_SOLID_BREP'))) shells.push({ ref: a[1], flip: false })
    else if ((a = part(e, 'BREP_WITH_VOIDS'))) {
        shells.push({ ref: a[1], flip: false })
        for (const v of a[2]) {
            const o = part(E.get(v), 'ORIENTED_CLOSED_SHELL')
            shells.push({ ref: o ? o[2] : v, flip: o ? o[3]?.enum === 'F' : false })
        }
    }
    const faces = []
    for (const sh of shells) {
        const s = part(E.get(sh.ref), 'CLOSED_SHELL') ?? part(E.get(sh.ref), 'OPEN_SHELL')
        if (is(E.get(sh.ref), 'OPEN_SHELL')) warnings.add('a shell is open: what is inside it may be wrong')
        for (const f of s[1]) {
            const face = readFace(E, G, f, warnings)
            if (sh.flip) {
                face.sense = !face.sense
                face.loops.forEach(l => { l.points.reverse(); l.edges.reverse(); l.edges.forEach(e => e.points = e.points.slice().reverse()) })
            }
            faces.push(face)
        }
    }
    return { name: e.args?.[0] || part(e, 'MANIFOLD_SOLID_BREP')?.[0] || '', faces }
}

/** A solid moved by a rigid transform: its surfaces' frames and its loops' points. */
function moveSolid(s, T) {
    return { ...s, faces: s.faces.map(f => ({ ...f,
        surface: f.surface.unsupported ? f.surface : moveSurface(f.surface, T),
        loops: f.loops.map(l => ({ ...l, points: l.points.map(p => apply(T, p)),
                                   edges: l.edges.map(e => ({ ...e, points: e.points.map(p => apply(T, p)) })) })) })) }
}

//----------------------------------------------------------------------------------------------------------------------
// THE ASSEMBLY: which representation holds which solid, and where each representation is placed
//----------------------------------------------------------------------------------------------------------------------
const REPS = ['ADVANCED_BREP_SHAPE_REPRESENTATION', 'MANIFOLD_SURFACE_SHAPE_REPRESENTATION', 'SHAPE_REPRESENTATION',
              'FACETED_BREP_SHAPE_REPRESENTATION']
const SOLIDS = ['MANIFOLD_SOLID_BREP', 'BREP_WITH_VOIDS']

export function readSTEP(text) {
    const E = entities(text)
    const warnings = new Set()
    const schema = (/FILE_SCHEMA\s*\(\s*\(\s*'([^']*)'/i.exec(text) || [])[1] || ''

    // every representation: its items and context
    const reps = new Map()
    for (const t of REPS) for (const id of E.ofType(t)) { const a = E.get(id).args; reps.set(id, { id, items: a[1].map(r => r.ref), ctx: a[2] }) }
    for (const t of REPS) for (const id of E.complexWith(t)) {
        const e = E.get(id), a = [part(e, 'REPRESENTATION'), part(e, t)].find(x => x && x.length >= 3)
        if (a) reps.set(id, { id, items: a[1].map(r => r.ref), ctx: a[2] })
    }

    // placements of one representation in another: child -> [{ parent, T }]
    const placedIn = new Map(), childOf = new Set()
    const place = (child, parent, T) => {
        if (!placedIn.has(child)) placedIn.set(child, [])
        placedIn.get(child).push({ parent, T })
        childOf.add(child)
    }
    const axisOf = (U, r) => geometry(E, U).placement(r)
    for (const id of [...E.complexWith('REPRESENTATION_RELATIONSHIP'), ...E.ofType('SHAPE_REPRESENTATION_RELATIONSHIP'), ...E.ofType('REPRESENTATION_RELATIONSHIP')]) {
        const e = E.get(id)
        const rr = part(e, 'REPRESENTATION_RELATIONSHIP') ?? part(e, 'SHAPE_REPRESENTATION_RELATIONSHIP')
        if (!rr) continue
        const r1 = rr[2].ref, r2 = rr[3].ref
        const wt = part(e, 'REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION')
        if (!wt) {
            // the same shape, said twice (a product's SHAPE_REPRESENTATION and its B-rep's): placed where the other is
            if (reps.get(r1)?.items.some(i => SOLIDS.some(t => is(E.get(i), t)))) place(r1, r2, IDENTITY)
            else place(r2, r1, IDENTITY)
            continue
        }
        const idt = part(E.get(wt[0]), 'ITEM_DEFINED_TRANSFORMATION')
        if (!idt) { warnings.add('a placement that is not an ITEM_DEFINED_TRANSFORMATION was ignored'); continue }
        const i1 = idt[2].ref, i2 = idt[3].ref
        // rep_1 is placed in rep_2; transform_item_1 belongs to rep_1 -- unless the file has them the other way round
        let child = r1, parent = r2, from = i1, to = i2
        const holds = (rep, item) => reps.get(rep)?.items.includes(item)
        if (holds(r1, i2) && holds(r2, i1) && !holds(r1, i1)) { from = i2; to = i1 }
        const Uc = contextUnits(E, reps.get(child)?.ctx, warnings), Up = contextUnits(E, reps.get(parent)?.ctx, warnings)
        const T = compose(fromFrame(axisOf(Up, to)), invert(fromFrame(axisOf(Uc, from))))
        place(child, parent, T)
    }
    // MAPPED_ITEM: a representation placed as an item of another
    for (const id of E.ofType('MAPPED_ITEM')) {
        const a = E.get(id).args
        const map = part(E.get(a[1]), 'REPRESENTATION_MAP')
        const rep = map[1].ref
        for (const [pid, P] of reps) if (P.items.includes(id)) {
            const Uc = contextUnits(E, reps.get(rep)?.ctx, warnings), Up = contextUnits(E, P.ctx, warnings)
            place(rep, pid, compose(fromFrame(axisOf(Up, a[2])), invert(fromFrame(axisOf(Uc, map[0])))))
        }
    }

    // product names, by representation
    const names = new Map()
    for (const id of E.ofType('SHAPE_DEFINITION_REPRESENTATION')) {
        const a = E.get(id).args
        try {
            const pds = part(E.get(a[0]), 'PRODUCT_DEFINITION_SHAPE')
            const pd = part(E.get(pds[2]), 'PRODUCT_DEFINITION')
            const pdf = part(E.get(pd[2]), 'PRODUCT_DEFINITION_FORMATION') ?? part(E.get(pd[2]), 'PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE')
            const prod = part(E.get(pdf[2]), 'PRODUCT')
            names.set(a[1].ref, prod[1] || prod[0])
        } catch { }
    }

    // every way from a root down to each representation, composed
    const solids = [], seen = new Set()
    const nameOf = rep => { for (let r = rep, k = 0; r != null && k < 64; k++) { if (names.has(r)) return names.get(r); r = placedIn.get(r)?.[0]?.parent } return '' }
    const visit = (rep, T, depth, trail) => {
        if (depth > 32 || trail.includes(rep)) { warnings.add('an assembly that contains itself was cut short'); return }
        const R = reps.get(rep)
        if (R) {
            const U = contextUnits(E, R.ctx, warnings)
            const G = geometry(E, U)
            for (const item of R.items) {
                const e = E.get(item)
                if (!SOLIDS.some(t => is(e, t))) continue
                const s = readSolid(E, G, item, warnings)
                solids.push(moveSolid({ ...s, name: s.name || nameOf(rep) || `solid ${item}` }, T))
                seen.add(item)
            }
        }
        for (const [child, list] of placedIn) for (const { parent, T: Tc } of list)
            if (parent === rep) visit(child, compose(T, Tc), depth + 1, [...trail, rep])
    }
    const roots = [...reps.keys()].filter(r => !childOf.has(r))
    for (const r of roots) visit(r, IDENTITY, 0, [])

    // solids no representation reached: read where they are, said
    const orphans = [...SOLIDS.flatMap(t => E.ofType(t))].filter(id => !seen.has(id))
    if (orphans.length) {
        warnings.add(`${orphans.length} solid(s) outside any representation read without a placement`)
        const G = geometry(E, { mm: 1, rad: 1 })
        for (const id of orphans) solids.push(readSolid(E, G, id, warnings))
    }
    if (!solids.length) {
        const shells = E.ofType('SHELL_BASED_SURFACE_MODEL').length + E.ofType('OPEN_SHELL').length
        throw new Error(shells ? 'this STEP file holds surfaces, not solids: there is no inside to convert' : 'this STEP file holds no solid')
    }
    const first = reps.values().next().value
    return { schema, solids, unitMM: contextUnits(E, first?.ctx, warnings).mm, warnings: [...warnings] }
}

