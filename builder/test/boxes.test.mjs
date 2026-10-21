//======================================================================================================================
// Tests for the measured boxes (builder/boxes.js). Run: node builder/test/boxes.test.mjs
//
// The GPU is replaced by a sampler of EXACT shapes: each node a sphere, a box or a plane in its own frame,
// evaluated at the lattice points the tool asks for (the real header, decoded) through the node's real
// transforms -- so everything but the WGSL runs: the lattices, the growing search, the fine pass, the
// frames, the caching, the groups. What the kernel itself returns is core/field.js's and check-shaders'.
//======================================================================================================================
import * as M from '../model.js'
import { createBoxes, toLocalOf, fromParent, latticeFor, COARSE, geometryKey, cullBoxes, cullUniforms, cullReport, smoothBulge, measured } from '../boxes.js'
import { toParent } from '../bounds.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const near = (a, b, tol) => a.every((v, k) => Math.abs(v - b[k]) <= tol)

/* THE FAKE GPU: shapes[id](local point) -> distance in the node's frame; world distance is that times
   the frames' scales. Nearest shape wins, tagged as the scene's tag list would (tags[k-1] = id). */
const makeSampler = (doc, shapes) => {
    const S = { calls: 0 }
    S.sample = async input => {
        S.calls++
        const u = new Uint32Array(input.buffer)
        const o = [input[0], input[1], input[2]], count = u[3], nx = u[7], ny = u[11]
        const ax = input[4], ay = input[9], az = input[14]
        const d = doc(), ids = Object.keys(shapes).filter(id => M.find(d, id))
        const loc = ids.map(id => toLocalOf(d, id))
        const scale = ids.map(id => { let s = 1; for (let f = M.find(d, id); f && f.node !== d.root; f = f.parent ? M.find(d, f.parent.id) : null) s *= f.node.transform?.scale ?? 1; return s })
        const D = new Float32Array(count), T = new Uint32Array(count)
        for (let i = 0; i < count; i++) {
            const ix = i % nx, iy = Math.floor(i / nx) % ny, iz = Math.floor(i / (nx * ny))
            const p = [o[0] + ix * ax, o[1] + iy * ay, o[2] + iz * az]
            let best = Infinity, tag = 0
            ids.forEach((id, k) => {
                const dist = Math.abs(shapes[id](loc[k](p), M.find(d, id).node)) * scale[k]
                if (dist < best) { best = dist; tag = k + 1 }
            })
            D[i] = best; T[i] = tag
        }
        return { d: D, tag: T, tags: ids }
    }
    return S
}
const sphere = r => (p, n) => Math.hypot(...p) - (n?.params?.radius ?? r)
const cube = h => p => { const q = p.map((v, k) => Math.abs(v) - h[k]); return Math.hypot(...q.map(v => Math.max(v, 0))) + Math.min(Math.max(...q), 0) }
const plane = p => p[2]

//----------------------------------------------------------------------------------------------------------------------
// FRAMES: fromParent undoes toParent
{
    const t = { pos: { x: 1, y: -2, z: 3 }, rot: { x: 20, y: -35, z: 110 }, scale: 2.5 }
    const p = [0.3, -1.7, 4.2]
    ok('fromParent undoes toParent', near(fromParent(t, toParent(t, p)), p, 1e-9))
    const L = latticeFor([0, 0, 0], [10, 5, 2], COARSE)
    ok('a lattice has cubic cells and covers the region', L.nx === COARSE && L.cell * (L.ny - 1) >= 5 - 1e-9 && L.cell * (L.nz - 1) >= 2 - 1e-9)
}

//----------------------------------------------------------------------------------------------------------------------
// A SCENE: a sphere, a rotated box in a moved group, a tiny sphere by a big one, an object whose code
// puts it far from where its parameters say, and a plane without an end
const doc = M.createDoc()
const ball = M.addObject(doc, 'root', { primitive: 'sphere', label: 'ball', transform: { pos: { x: 3, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: 1 } })
ball.params = { radius: 1 }
const grp = M.addGroup(doc, 'root', { label: 'g', transform: { pos: { x: -4, y: 2, z: 1 }, rot: { x: 0, y: 0, z: 30 }, scale: 2 } })
const blk = M.addObject(doc, grp.id, { primitive: 'box', label: 'block', transform: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 45 }, scale: 1 } })
const big = M.addObject(doc, 'root', { primitive: 'sphere', label: 'big', transform: { pos: { x: 0, y: -8, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: 1 } })
big.params = { radius: 3 }
const tiny = M.addObject(doc, 'root', { primitive: 'sphere', label: 'tiny', transform: { pos: { x: 0, y: -4.9, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: 1 } })
tiny.params = { radius: 0.02 }
const far = M.addObject(doc, 'root', { primitive: 'sphere', label: 'far', transform: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: 1 } })
far.params = { radius: 0.5 }
const shapes = {
    [ball.id]: sphere(1), [blk.id]: cube([1, 0.5, 0.25]), [big.id]: sphere(3), [tiny.id]: sphere(0.02),
    // its code puts it 20 units off, where its parameters say nothing about
    [far.id]: p => Math.hypot(p[0] - 20, p[1], p[2]) - 0.5,
}
let current = doc
const G = makeSampler(() => current, shapes)
const B = createBoxes({ sample: G.sample, doc: () => current })

const run = async () => {
    const measuredIds = await B.update()
    ok('the first update measures every object', [ball, blk, big, tiny, far].every(n => measuredIds.includes(n.id)), measuredIds.join())
    const b = B.get(ball.id)
    ok('a sphere of radius 1: its box is ±1 in its own frame, to a cell', b && near(b.lo, [-1, -1, -1], 1.5 * b.cell) && near(b.hi, [1, 1, 1], 1.5 * b.cell),
        JSON.stringify(b))
    ok('...measured finely: its cell is a fortieth of it, not a sixty-fourth of the scene', b.cell < 0.1, `${b.cell}`)
    const k = B.get(blk.id)
    ok('a box turned 45° in a group turned 30° and scaled 2: its box is its own half-sizes, in its own frame',
        k && near(k.lo, [-1, -0.5, -0.25], 1.5 * k.cell) && near(k.hi, [1, 0.5, 0.25], 1.5 * k.cell), JSON.stringify(k))
    const t = B.get(tiny.id)
    ok('a sphere of 0.02 beside one of 3: found, and its box is its own size, to its own cell', t && near(t.hi, [0.02, 0.02, 0.02], 0.02) && t.cell < 0.005,
        JSON.stringify(t))
    const f = B.get(far.id)
    ok('an object 20 units from where its parameters say: found by growing the search', f && near(f.lo, [19.5, -0.5, -0.5], 3 * f.cell), JSON.stringify(f))
    ok('...and it is not open: it ends', f && !f.open)

    // A GROUP's box is its child's, through the child's 45° turn, in the group's frame
    const g = B.get(grp.id)
    const r = Math.hypot(1, 0.5) * Math.cos(Math.atan2(0.5, 1) - Math.PI / 4)       // the turned box's reach along x
    ok('a group\'s box is its children\'s, in its own frame', g && Math.abs(g.hi[0] - (Math.SQRT1_2 * 1.5)) < 2 * k.cell && Math.abs(g.hi[2] - 0.25) < 2 * k.cell,
        JSON.stringify(g) + ` want x ${Math.SQRT1_2 * 1.5} (r ${r})`)
    // corners in the world: the ball's are at its centre ± 1
    const C = B.corners(doc, ball.id)
    ok('a box\'s corners in the world are where the node is', C && near(C[0], [2, -1, -1], 1.5 * b.cell) && near(C[7], [4, 1, 1], 1.5 * b.cell), JSON.stringify(C?.[0]))

    // MOVING needs no measuring; the corners follow
    const calls = G.calls
    ball.transform.pos.x = 10; grp.transform.rot.z = 80
    ok('moving or turning an object or a group is not a change of shape', !B.due())
    ok('...update measures nothing', (await B.update()).length === 0 && G.calls === calls)
    ok('...and the corners follow the node', near(B.corners(doc, ball.id)[0], [9, -1, -1], 1.5 * b.cell))

    // A CHANGE OF SHAPE: that node and no other
    ball.params.radius = 2
    ok('a parameter changed: due', B.due())
    const again = await B.update()
    ok('...update measures that node alone', again.length === 1 && again[0] === ball.id, again.join() + ' / ball ' + ball.id)
    ok('...and its box is its new size', near(B.get(ball.id).hi, [2, 2, 2], 1.5 * B.get(ball.id).cell), JSON.stringify(B.get(ball.id)))
    // a parent's code shapes its children: the child is measured again
    M.setCode(doc, grp.id, '// something else')       // its block's (model.js version 16)
    const kids = await B.update()
    ok('a parent\'s code changed: its children are measured again', kids.includes(blk.id) && !kids.includes(ball.id), kids.join())

    // AN ARRAY (model.js copies): a group's box holds its children at every copy
    {
        const row = M.addGroup(doc, 'root', { label: 'row' })
        const one = B.get(ball.id)
        M.move(doc, ball.id, row.id)
        M.setCopies(doc, row.id, [{ pos: { x: -10, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: 1 }, { pos: { x: 10, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 90 }, scale: 2 }])
        const R = B.get(row.id), t = ball.transform.pos
        ok('an array\'s box holds its child at every copy: the first\'s place and the second\'s, turned and doubled',
            // x from the first copy's least x, to the second's: turned 90 degrees and doubled, its least y is its most x
            Math.abs(R.lo[0] - (-10 + t.x + one.lo[0])) < 1e-9 && Math.abs(R.hi[0] - (10 - 2 * (t.y + one.lo[1]))) < 1e-9,
            JSON.stringify({ R, one, t }))
        M.setCopies(doc, row.id, null)
        M.move(doc, ball.id, 'root')
        M.remove(doc, row.id)
    }

    // A DELETED node is forgotten; a NEW one is measured
    M.remove(doc, tiny.id)
    const nb = M.addObject(doc, 'root', { primitive: 'sphere', label: 'new' }); nb.params = { radius: 0.5 }
    shapes[nb.id] = sphere(0.5)
    const got = await B.update()
    ok('a new node is measured, the deleted one forgotten', got.includes(nb.id) && B.get(tiny.id) === null, got.join())

    // AN OBJECT WITHOUT AN END: open, its box where the search stopped
    const d2 = M.createDoc()
    const fl = M.addObject(d2, 'root', { primitive: 'box', label: 'floor' })
    const s2 = makeSampler(() => d2, { [fl.id]: plane })
    const B2 = createBoxes({ sample: s2.sample, doc: () => d2 })
    await B2.update()
    const fb = B2.get(fl.id)
    ok('an infinite plane is open', fb && fb.open, JSON.stringify(fb))
    ok('...and flat: its box has no height to speak of', fb && fb.hi[2] - fb.lo[2] < 3 * fb.cell)

    // NOT READY (the renderer shows another scene): nothing measured, nothing kept
    const B3 = createBoxes({ sample: G.sample, doc: () => doc, ready: () => false })
    ok('while the renderer is not showing the document, nothing is measured', (await B3.update()).length === 0 && B3.get(ball.id) === null)
    // THE SCENE CHANGED WHILE SAMPLING (sample says null): abandoned, tried again later
    const B4 = createBoxes({ sample: async () => null, doc: () => doc })
    ok('a sample abandoned (the scene changed meanwhile): nothing measured, still due', (await B4.update()).length === 0 && B4.due())
    // ANOTHER DOCUMENT (a scene switch): nothing carries over
    current = d2
    ok('another document: the old boxes do not answer for its ids', B.get(ball.id) === null)
}

await run()
//----------------------------------------------------------------------------------------------------------------------
// ONLY WHAT IS WANTED IS MEASURED (PERFORMANCE.md: every node after every edit took 37 s on the Noise library):
// nothing wanted measures nothing and samples nothing; a group stands for the objects in it; request() adds one
{
    let want = []
    const S = makeSampler(() => doc, shapes)
    const B = createBoxes({ sample: S.sample, doc: () => doc, wanted: () => want })
    const none = await B.update()
    ok('nothing wanted: nothing measured, the GPU not asked', none.length === 0 && S.calls === 0 && B.pending() === '', `${none} ${S.calls}`)
    want = [grp.id]
    const g = await B.update()
    ok('a group wanted: the objects in it, and only those', g.length === 1 && g[0] === blk.id, JSON.stringify(g))
    ok('...and its box is there', !!B.get(grp.id) && !B.get(ball.id))
    ok('corners of one not measured are null, and ask for it', B.corners(doc, ball.id) === null && B.pending() !== '')
    const r = await B.update()
    ok('...which the next update measures', r.length === 1 && r[0] === ball.id && !!B.get(ball.id), JSON.stringify(r))
    ok('a sample that returns nothing (held) abandons the update, to be tried again', await (async () => {
        const H = createBoxes({ sample: async () => null, doc: () => doc, wanted: () => [ball.id] })
        return (await H.update()).length === 0 && H.pending() !== ''
    })())
}

// A MATERIAL'S RELIEF IS SHAPE: giving one to what an object wears, or changing it, is re-measured; a colour is not
{
    const doc = M.createDoc()
    const m = M.addMaterial(doc, { id: 'stone' })
    const o = M.addObject(doc, 'root', { primitive: 'box', material: 'stone' })
    const k0 = geometryKey(doc, o.id)
    m.params.baseColor = { r: 0.1, g: 0.2, b: 0.3 }
    ok('a material\'s colour is not the shape of what wears it', geometryKey(doc, o.id) === k0)
    M.setRelief(doc, 'stone', 'noise')
    const k1 = geometryKey(doc, o.id)
    ok('...its relief is', k1 !== k0)
    m.relief.params.amplitude = 2
    ok('...and so is a change to it', geometryKey(doc, o.id) !== k1)
    // a group above that stops the material following its warp moves where the relief is read: shape too
    const tw = M.addGroup(doc, 'root', { id: 'tw', code: 'warp(0.5);\nC = children(C, p);' })
    const inTw = M.addObject(doc, 'tw', { primitive: 'box', material: 'stone' })
    const k2 = geometryKey(doc, inTw.id)
    M.setStraightMaterial(doc, tw.id, true)
    ok('...and a group above laying its material out straight (straightMaterial)', geometryKey(doc, inTw.id) !== k2)
    M.setStraightMaterial(doc, tw.id, false)
    ok('...back again, the key it had', geometryKey(doc, inTw.id) === k2)
    /* A GROUP'S MATERIAL (model.js version 23, 0.76.0) is what its objects wear: its relief their shape -- for the
       object's key and the group's, which holds its subtree -- and not one keeping its own */
    M.addMaterial(doc, { id: 'paint' })
    const g = M.addGroup(doc, 'root', { id: 'g' })
    const inG = M.addObject(doc, 'g', { primitive: 'box', material: 'paint' })
    const [k3, kg] = [geometryKey(doc, inG.id), geometryKey(doc, g.id)]
    M.setMaterial(doc, g.id, 'stone')
    ok('...a group above giving its objects a material with a relief', geometryKey(doc, inG.id) !== k3 && geometryKey(doc, g.id) !== kg)
    M.setOwnMaterial(doc, inG.id, true)
    ok('...not one keeping its own', geometryKey(doc, inG.id) === k3)
}

//----------------------------------------------------------------------------------------------------------------------
// THE BOXES THE RENDERER CULLS WITH (cullBoxes): each top-level node's, padded, CONTAINING its whole shape -- or
// null, never culled. A box too small cuts the object out of the picture, so containment is checked against the
// exact shapes' surfaces. The case that made groups measured: a relief's displaced surface is folded by the
// GROUP, so near its outward bulge the tag is the group's, not its object's -- modelled here by giving the group
// a shape of its own (the shell), which the sampler tags as the group wherever it is nearer than the child.
{
    const d = M.createDoc()
    const at = (x, y, z, rz = 0, s = 1) => ({ pos: { x, y, z }, rot: { x: 0, y: 0, z: rz }, scale: s })
    const ball = M.addObject(d, 'root', { primitive: 'sphere', label: 'ball', transform: at(3, 0, 0) }); ball.params = { radius: 1 }
    const relief = M.addGroup(d, 'root', { label: 'relief', transform: at(-3, 1, 0.5, 20, 1.5),
        code: 'var H = children(emptyHit(r), p);\nC = fold(C, H.s, H.m);', params: { amount: 0.2 } })
    const core = M.addObject(d, relief.id, { primitive: 'sphere', label: 'core', transform: at(0, 0, 0) }); core.params = { radius: 1 }
    const pair = M.addGroup(d, 'root', { label: 'pair', blend: 0.4, transform: at(0, 5, 0, 45, 2) })
    const pa = M.addObject(d, pair.id, { primitive: 'box', label: 'a', transform: at(-0.6, 0, 0, 30) })
    const pb = M.addObject(d, pair.id, { primitive: 'sphere', label: 'b', transform: at(0.6, 0, 0) }); pb.params = { radius: 0.4 }
    const shapes = {
        [ball.id]: (p, n) => Math.hypot(...p) - n.params.radius,
        [core.id]: (p, n) => Math.hypot(...p) - n.params.radius,
        // THE GROUP'S OWN SURFACE: the core displaced outward by the relief's amount (the worst of the noise)
        [relief.id]: (p, n) => Math.hypot(p[0] - core.transform.pos.x, p[1] - core.transform.pos.y, p[2] - core.transform.pos.z) - core.params.radius - n.params.amount,
        [pa.id]: cube([0.3, 0.3, 0.3]), [pb.id]: (p, n) => Math.hypot(...p) - n.params.radius,
    }
    const S = makeSampler(() => d, shapes)
    const B = createBoxes({ sample: S.sample, doc: () => d })
    ok('a group with code, or a CSG combine, is measured itself; a plain one is not', measured(d).includes(relief.id)
        && measured(d).includes(pair.id) && !measured(d).includes('root'))
    ok('before measuring: every top-level box unknown', [...cullBoxes(d, B).values()].every(b => b === null))
    await B.update()
    const C = cullBoxes(d, B)
    ok('measured: every top-level node has a box, and only those', [...C.keys()].sort().join() === [ball.id, relief.id, pair.id].sort().join()
        && [...C.values()].every(Boolean))
    /* CONTAINMENT: points on each exact surface, taken into the top-level node's frame, inside its padded box */
    const inside = (b, p) => p.every((v, k) => v >= b.lo[k] && v <= b.hi[k])
    const onSphere = (r, n = 400) => Array.from({ length: n }, (_, i) => {
        const z = 1 - 2 * (i + 0.5) / n, rr = Math.sqrt(1 - z * z), a = i * 2.399963
        return [r * rr * Math.cos(a), r * rr * Math.sin(a), r * z]
    })
    const onCube = h => onSphere(1, 400).map(v => { const m = Math.max(...v.map(Math.abs)); return v.map((c, k) => c / m * h[k]) })
    const outOf = (b, pts) => pts.filter(p => !inside(b, p))
    ok('a sphere: all of it inside its box', outOf(C.get(ball.id), onSphere(1)).length === 0)
    ok('a relief: all of its DISPLACED surface inside -- the group\'s own points count', outOf(C.get(relief.id), onSphere(1.2)).length === 0,
        JSON.stringify(outOf(C.get(relief.id), onSphere(1.2)).slice(0, 2)) + ' box ' + JSON.stringify(C.get(relief.id)))
    ok('a smooth union\'s children, through their transforms, inside the group\'s box', outOf(C.get(pair.id),
        [...onCube([0.3, 0.3, 0.3]).map(p => toParent(pa.transform, p)), ...onSphere(0.4).map(p => toParent(pb.transform, p))]).length === 0)
    /* THE PADDING: the coarsest cell, and a smooth union's bulge (blend / 4, in world units), into the node's frame */
    const raw = B.get(pair.id), cb = C.get(pair.id), m = (raw.cell + 0.4 / 4) / 2
    ok('padded by a cell and a quarter of the blend, taken into the node\'s frame by its scale', near(cb.lo, raw.lo.map(v => v - m), 1e-9) && near(cb.hi, raw.hi.map(v => v + m), 1e-9))
    ok('smoothBulge: a quarter of each smooth union\'s blend in the subtree, none for a plain one', smoothBulge(pair) === 0.1 && smoothBulge(relief) === 0)
    /* PER UNION JOIN (model version 14): the combines run one after another, each able to go a quarter of its
       blend below what came before -- three equal spheres meeting in one point go 25/64 of k below, by csgUnion's
       formula, more than the one quarter a group used to be padded by */
    {
        const csgUnion = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0); return Math.min(a, b) - h * h * 0.25 / k }
        ok('(csgUnion chained over three equal distances lowers them by 25/64 of the blend)',
            Math.abs(csgUnion(csgUnion(1, 1, 0.4), 1, 0.4) - (1 - 0.4 * 25 / 64)) < 1e-12)
        const t = M.createDoc()
        const three = M.addGroup(t, 'root', { blend: 0.4 })
        for (let i = 0; i < 3; i++) M.addObject(t, three.id, { primitive: 'sphere' })
        ok('...so three children in a smooth union are padded by two quarters', Math.abs(smoothBulge(three) - 0.2) < 1e-12, smoothBulge(three))
        const cut = M.addGroup(t, 'root', { blend: 0.4 })
        M.addObject(t, cut.id, { primitive: 'box' }); M.addObject(t, cut.id, { primitive: 'sphere', join: 'subtract' })
        M.addObject(t, cut.id, { primitive: 'sphere', joinBlend: 0.8 })
        ok('a subtraction only takes away; a union with its own blend is padded by its own', Math.abs(smoothBulge(cut) - 0.2) < 1e-12, smoothBulge(cut))
    }
    ok('the uniforms: lo.w 1 when known, all zero when not', JSON.stringify(cullUniforms({ lo: [1, 2, 3], hi: [4, 5, 6] })) === '{"lo":[1,2,3,1],"hi":[4,5,6,0]}'
        && JSON.stringify(cullUniforms(null)) === '{"lo":[0,0,0,0],"hi":[0,0,0,0]}')

    /* STALE IS UNKNOWN: a shape changed and not measured since is never culled with its old box */
    ball.params.radius = 1.5
    ok('a parameter changed: that node\'s box unknown at once, the others still known', cullBoxes(d, B).get(ball.id) === null
        && !!cullBoxes(d, B).get(relief.id) && !!cullBoxes(d, B).get(pair.id))
    await B.update()
    ok('...measured again: known, and the new size inside', outOf(cullBoxes(d, B).get(ball.id), onSphere(1.5)).length === 0)
    core.transform.pos.x = 0.3                                            // a child moved INSIDE a relief
    ok('a child moved inside a group with code: the group\'s box unknown (its own surface moved with it)', cullBoxes(d, B).get(relief.id) === null)
    await B.update()
    ok('...measured again: known, the moved shell inside', outOf(cullBoxes(d, B).get(relief.id), onSphere(1.2).map(p => [p[0] + 0.3, p[1], p[2]])).length === 0)
    ball.transform.pos.x = 7; relief.transform.rot.z = 70
    ok('a top-level node itself moved or turned: its box still known (it is in its own frame)', !!cullBoxes(d, B).get(ball.id) && !!cullBoxes(d, B).get(relief.id))
    M.setEnabled(d, pair.id, false)
    ok('a hidden top-level node: unknown (reported, never culled)', cullBoxes(d, B).has(pair.id) && cullBoxes(d, B).get(pair.id) === null)
    // AN OBJECT WITHOUT AN END is never culled
    const d2 = M.createDoc()
    const fl = M.addObject(d2, 'root', { primitive: 'box', label: 'floor' })
    const B2 = createBoxes({ sample: makeSampler(() => d2, { [fl.id]: plane }).sample, doc: () => d2 })
    await B2.update()
    ok('an open box (an infinite plane): unknown, never culled', cullBoxes(d2, B2).get(fl.id) === null)
}

//----------------------------------------------------------------------------------------------------------------------
// A RELIEF THE COARSE LATTICE MISSED: its group caught no coarse point (a neighbour's fold was nearer at each), and
// its object finds none of its own anywhere (inside a relief the group's fold is nearer almost everywhere: its
// distance is divided by the slope). It used to be measured only where the coarse lattice had found it -- here,
// nowhere -- so it had no box and was never culled; the first run on hardware had 13 of 14. Now a group with no
// coarse points is looked for over its objects. The sampler stands in for the two conditions: the group's tag is
// hidden on the coarse lattices, and the object's own fold is never the nearest.
{
    const d = M.createDoc()
    const at = (x, y, z) => ({ pos: { x, y, z }, rot: { x: 0, y: 0, z: 0 }, scale: 1 })
    const big = M.addObject(d, 'root', { primitive: 'sphere', label: 'big', transform: at(0, 0, 0) }); big.params = { radius: 1 }
    const rel = M.addGroup(d, 'root', { label: 'relief', transform: at(3, 0, 0), code: 'var H = children(emptyHit(r), p);\nC = fold(C, H.s, H.m);', params: { amount: 0.02 } })
    const obj = M.addObject(d, rel.id, { primitive: 'sphere', label: 'core', transform: at(0, 0, 0) }); obj.params = { radius: 0.1 }
    const shapes = { [big.id]: p => Math.hypot(...p) - 1, [obj.id]: () => 1e9, [rel.id]: p => Math.hypot(...p) - 0.12 }
    const S = makeSampler(() => d, shapes)
    const coarseBlind = async input => {
        const r = await S.sample(input)
        // a coarse lattice has COARSE (64) points on its longest side, a fine one FINE (40)
        const u = new Uint32Array(input.buffer), nx = u[7], ny = u[11], nz = u[3] / (nx * ny)
        if (Math.max(nx, ny, nz) > 40) { const t = r.tags.indexOf(rel.id) + 1; for (let i = 0; i < r.tag.length; i++) if (r.tag[i] === t) r.tag[i] = 0 }
        return r
    }
    const B = createBoxes({ sample: coarseBlind, doc: () => d })
    await B.update()
    const b = cullBoxes(d, B).get(rel.id)
    ok('a relief the coarse lattice missed, whose object finds nothing: still has a box (looked for over its objects)', !!b, JSON.stringify(B.get(rel.id)))
    const shell = Array.from({ length: 200 }, (_, i) => { const z = 1 - 2 * (i + 0.5) / 200, rr = Math.sqrt(1 - z * z), a = i * 2.399963; return [0.12 * rr * Math.cos(a), 0.12 * rr * Math.sin(a), 0.12 * z] })
    ok('...and its shell is inside it', !!b && shell.every(p => p.every((v, k) => v >= b.lo[k] && v <= b.hi[k])))
    ok('...the report names nothing missing', cullReport(d, B).length === 0, JSON.stringify(cullReport(d, B)))
    /* ITS OBJECT IS NOT MEASURED AGAIN ON EVERY EDIT: it finds nothing of its own by design (the group's fold is
       what is seen, and the group is measured again whenever anything under it changes) -- an object with no box
       is measured again when the scene changes, but not one covered by a group with code that has a box */
    big.params.radius = 1.2
    const again = await B.update()
    ok('...an edit elsewhere measures what changed, not the object inside the relief', again.includes(big.id) && !again.includes(obj.id), JSON.stringify(again))
    ok('...and the relief stays culled', !!cullBoxes(d, B).get(rel.id))
}

//----------------------------------------------------------------------------------------------------------------------
// A COPY ON TOP OF ITS ORIGINAL (the user, 2026-10-01: "a union group of 2 boxes ... did not show the second box"). A
// new object starts at the identity and a duplicate exactly where its original is, so the two coincide; every tie
// goes to the first fold (scene_api.js fold, strict <; so does the sampler), and the copy finds no surface of its
// own. Its box is null -- "nothing of its own, AS PLACED THEN". Moved, nothing in its key changed (a transform is
// not shape), so it was never measured again: its group's box stayed the original's alone, and the culling cut the
// copy off outside it. Now an object with no box is measured again once the scene has changed, and until then its
// top-level node is not culled.
{
    const at = (x, y, z, rz = 0) => ({ pos: { x, y, z }, rot: { x: 0, y: 0, z: rz }, scale: 1 })
    const inside = (b, p) => p.every((v, k) => v >= b.lo[k] && v <= b.hi[k])
    const onCube = h => Array.from({ length: 400 }, (_, i) => {
        const z = 1 - 2 * (i + 0.5) / 400, rr = Math.sqrt(1 - z * z), a = i * 2.399963
        const v = [rr * Math.cos(a), rr * Math.sin(a), z], m = Math.max(...v.map(Math.abs))
        return v.map((c, k) => c / m * h[k])
    })
    const H = [0.5, 0.5, 0.5]
    const pair = (csg = false) => {
        const d = M.createDoc()
        const g = M.addGroup(d, 'root', { label: 'pair', transform: at(1, 2, 0, 30) })
        const a = M.addObject(d, g.id, { primitive: 'box', label: 'a' })
        const b = M.duplicate(d, a.id)
        const shapes = { [a.id]: cube(H), [b.id]: cube(H) }
        if (csg) {      // a CSG group: a third child, subtracted, off to the side the copy does not go
            const s = M.addObject(d, g.id, { primitive: 'sphere', label: 'cut', join: 'subtract', transform: at(0, 0, -9) })
            shapes[s.id] = sphere(0.3)
        }
        const B = createBoxes({ sample: makeSampler(() => d, shapes).sample, doc: () => d })
        return { d, g, a, b, B }
    }
    // every point of a node's exact cube, in the group's frame, inside the group's culling box
    const holds = (P, n) => { const c = cullBoxes(P.d, P.B).get(P.g.id); return !!c && onCube(H).map(p => toParent(n.transform, p)).every(p => inside(c, p)) }

    for (const csg of [false, true]) {
        const k = csg ? ' (CSG group)' : ''
        {
            const P = pair(csg)
            await P.B.update()
            ok('a copy on top of its original finds no surface of its own' + k, P.B.get(P.b.id) === null, JSON.stringify(P.B.get(P.b.id)))
            ok('...while they coincide, the group\'s box is the original\'s, which is the copy\'s too' + k, holds(P, P.a) && holds(P, P.b))
            P.b.transform.pos.x = 3
            ok('the copy moved: the group\'s box not known until it is measured again' + k, cullBoxes(P.d, P.B).get(P.g.id) === null)
            ok('...and a measure is due' + k, P.B.due())
            const ids = await P.B.update()
            ok('...measured again: the copy found' + k, ids.includes(P.b.id) && !!P.B.get(P.b.id), JSON.stringify(ids))
            ok('...the moved copy inside the group\'s box, and the original' + k, holds(P, P.b) && holds(P, P.a))
            ok('...nothing more due' + k, !P.B.due())
            P.b.transform.rot.z = 45
            // (a CSG group's own key is its subtree, transforms included: it is due for itself)
            if (!csg) ok('a copy that has its box is not measured again for being turned', !P.B.due() && !!cullBoxes(P.d, P.B).get(P.g.id))
        }
        {
            const P = pair(csg)
            await P.B.update()
            P.a.transform.pos.x = -3
            ok('the ORIGINAL moved away instead: the group\'s box not known' + k, cullBoxes(P.d, P.B).get(P.g.id) === null)
            await P.B.update()
            ok('...measured again: both inside it' + k, holds(P, P.a) && holds(P, P.b))
        }
        {
            const P = pair(csg)
            await P.B.update()
            P.b.transform.pos.x = 3
            M.remove(P.d, P.a.id)
            await P.B.update()
            ok('the original deleted, the copy moved: the copy inside the group\'s box' + k, holds(P, P.b))
        }
    }
}

//----------------------------------------------------------------------------------------------------------------------
// THE REPORT OF WHAT GOES UNCULLED, and why: a node never culled only costs speed, so shows nowhere else
{
    const d = M.createDoc()
    const at = (x, y, z) => ({ pos: { x, y, z }, rot: { x: 0, y: 0, z: 0 }, scale: 1 })
    const a = M.addObject(d, 'root', { primitive: 'sphere', label: 'a', transform: at(0, 0, 0) }); a.params = { radius: 1 }
    const h = M.addObject(d, 'root', { primitive: 'sphere', label: 'h', transform: at(4, 0, 0) }); h.params = { radius: 1 }
    const nothing = M.addObject(d, 'root', { primitive: 'sphere', label: 'nothing', transform: at(-4, 0, 0) }); nothing.params = { radius: 1 }
    const S = makeSampler(() => d, { [a.id]: p => Math.hypot(...p) - 1, [h.id]: p => Math.hypot(...p) - 1, [nothing.id]: () => 1e9 })
    const B = createBoxes({ sample: S.sample, doc: () => d })
    const why = () => Object.fromEntries(cullReport(d, B).map(u => [u.label, u.why]))
    ok('before measuring: each "not measured yet"', Object.values(why()).length === 3 && Object.values(why()).every(w => w === 'not measured yet'), JSON.stringify(why()))
    await B.update()
    ok('measured: a node with no surface found is named, the others not', JSON.stringify(why()) === JSON.stringify({ nothing: 'no surface found (none for: nothing)' }), JSON.stringify(why()))
    a.params.radius = 2
    ok('a shape changed: "changed since measured"', why().a === 'changed since measured', JSON.stringify(why()))
    M.setEnabled(d, h.id, false)
    ok('hidden: "hidden"', why().h === 'hidden', JSON.stringify(why()))
    const d2 = M.createDoc()
    const fl = M.addObject(d2, 'root', { primitive: 'box', label: 'floor' })
    const B2 = createBoxes({ sample: makeSampler(() => d2, { [fl.id]: plane }).sample, doc: () => d2 })
    await B2.update()
    ok('an infinite plane: "unbounded (open)"', cullReport(d2, B2)[0]?.why === 'unbounded (open)', JSON.stringify(cullReport(d2, B2)))
}

//----------------------------------------------------------------------------------------------------------------------
// AN OBJECT ONLY THE COARSEST LATTICE CATCHES. Measured on a software GPU (the scaling bench's lens assembly x 32, 0.22.9):
// the optics bench's lens, inside its holder, was missed by the first coarse lattice, so the search grew three times, to
// a 48.9 cm cell; two of that lattice's points, up to 44 cm off, had the lens as their nearest surface, and every fine
// lattice laid over them missed it again. Its box was those two points, padded by 48.9 cm -- and a group takes the
// coarsest cell of its children, so the whole assembly's box grew by 49 cm on every side, every copy inherited it, and
// every ray in the scene walked the copies at every step (20 times the work at x 32). At x 4 and x 16 the lens was not
// found at all. The stand-in GPU here plays that: the lens hidden on every lattice between its own size and the grown
// search's, so only the coarsest finds it, and only a lattice laid over the lens itself sees it again.
{
    const d = M.createDoc()
    const at = (x, y, z) => ({ pos: { x, y, z }, rot: { x: 0, y: 0, z: 0 }, scale: 1 })
    const a = M.addObject(d, 'root', { primitive: 'sphere', label: 'a', transform: at(0, 0, 0) }); a.params = { radius: 1 }
    const b = M.addObject(d, 'root', { primitive: 'sphere', label: 'b', transform: at(40, 0, 0) }); b.params = { radius: 1 }
    const holder = M.addGroup(d, 'root', { label: 'holder', transform: at(0, 6, 0) })
    const ring = M.addObject(d, holder.id, { primitive: 'box', label: 'ring', transform: at(0, 0, 0.5) })
    const lens = M.addObject(d, holder.id, { primitive: 'sphere', label: 'lens', transform: at(0, 0, 0) }); lens.params = { radius: 0.1 }
    const S = makeSampler(() => d, { [a.id]: sphere(1), [b.id]: sphere(1), [ring.id]: cube([0.5, 0.5, 0.1]), [lens.id]: sphere(0.1) })
    const HIDDEN = [0.02, 3]              // the cells the lens is missed at: under its own size it is seen, over the grown search's too
    let cells = []
    const sample = async input => {
        const r = await S.sample(input), cell = input[4]
        cells.push(cell)
        const k = r.tags.indexOf(lens.id) + 1
        if (cell >= HIDDEN[0] && cell < HIDDEN[1]) for (let i = 0; i < r.tag.length; i++) if (r.tag[i] === k) { r.tag[i] = 0; r.d[i] = 1e9 }
        return r
    }
    const B = createBoxes({ sample, doc: () => d })
    await B.update()
    ok('(the stand-in: the search grew past the hidden cells, and the lens was caught there)', cells.some(c => c >= HIDDEN[1]), cells.map(c => c.toFixed(3)).join(' '))
    const L = B.get(lens.id), H = B.get(holder.id)
    ok('an object only the grown search caught is measured again over its own place, and finely', L && L.cell < HIDDEN[0]
        && near(L.lo, [-0.1, -0.1, -0.1], 2 * L.cell) && near(L.hi, [0.1, 0.1, 0.1], 2 * L.cell), JSON.stringify(L))
    ok('...so its group is measured to its own parts\' cells, not the grown search\'s', H && H.cell < 0.1 && H.hi[2] < 0.7, JSON.stringify(H))
    const C = cullBoxes(d, B)
    ok('...and culled by a box its own size', C.get(holder.id) && Math.max(...C.get(holder.id).hi.map((v, k) => v - C.get(holder.id).lo[k])) < 1.5, JSON.stringify(C.get(holder.id)))
}

//----------------------------------------------------------------------------------------------------------------------
// AN OBJECT ONLY THE FIRST COARSE LATTICE CATCHES -- the other way round. Measured on a software GPU (2026-10-07, the
// optics bench): the search grew three times, to 35 m cells, because an object was missing; the pillars' 0.6 m cylinders
// were found by the first lattice (4.4 m cells) and by none after; measured from the last lattice alone, each was looked
// for again over its guess padded by 1.5 of the grown cells -- a 113 m lattice of 2.9 m cells -- and not found, and had no
// box. Its group's box was the rest of the pillar, and the scene as data culled the pillar by it: 0.61 where the surface
// was 0.23 away. The stand-in plays it: the pin hidden on every lattice coarser than the first, and on the cells between
// a little over half the first's and the first's own -- where a fine lattice over its guess, padded by the grown cell,
// falls -- and seen on the first and on anything laid closely round it. Something the search cannot find until it has
// grown three times makes it grow.
{
    const d = M.createDoc()
    const at = (x, y, z) => ({ pos: { x, y, z }, rot: { x: 0, y: 0, z: 0 }, scale: 1 })
    const a = M.addObject(d, 'root', { primitive: 'sphere', label: 'a', transform: at(0, 0, 0) }); a.params = { radius: 1 }
    const b = M.addObject(d, 'root', { primitive: 'sphere', label: 'b', transform: at(40, 0, 0) }); b.params = { radius: 1 }
    const pillar = M.addGroup(d, 'root', { label: 'pillar', transform: at(20, 0, 0) })
    const post = M.addObject(d, pillar.id, { primitive: 'box', label: 'post', transform: at(0, 0, 0) })
    const pin = M.addObject(d, pillar.id, { primitive: 'sphere', label: 'pin', transform: at(0, 0, 4) }); pin.params = { radius: 0.3 }
    const lost = M.addObject(d, 'root', { primitive: 'sphere', label: 'lost', transform: at(0, 0, 0) }); lost.params = { radius: 0.5 }
    const S = makeSampler(() => d, { [a.id]: sphere(1), [b.id]: sphere(1), [post.id]: cube([0.5, 0.5, 2]), [pin.id]: sphere(0.3),
                                     // its code puts it far off: found only once the search has grown
                                     [lost.id]: p => Math.hypot(p[0] - 150, p[1], p[2]) - 0.5 })
    let c0 = null, cells = []
    const sample = async input => {
        const r = await S.sample(input), cell = input[4]
        c0 ??= cell
        cells.push(cell)
        const k = r.tags.indexOf(pin.id) + 1
        if (cell > c0 * 1.0001 || (cell > 0.55 * c0 && cell < 0.9999 * c0)) for (let i = 0; i < r.tag.length; i++) if (r.tag[i] === k) { r.tag[i] = 0; r.d[i] = 1e9 }
        return r
    }
    const B = createBoxes({ sample, doc: () => d })
    await B.update()
    ok('(the stand-in: the search grew past the first lattice)', cells.slice(0, 4).every((c, i) => i === 0 || c > c0 * 1.5), cells.slice(0, 4).map(c => c.toFixed(3)).join(' '))
    const P = B.get(pin.id)
    ok('an object only the first coarse lattice caught keeps those points: measured over its own place, its own size',
        P && near(P.lo, [-0.3, -0.3, -0.3], 2 * P.cell) && near(P.hi, [0.3, 0.3, 0.3], 2 * P.cell), JSON.stringify(P))
    const C = cullBoxes(d, B), N = cullBoxes(d, B, { nested: true })
    ok('...so its group\'s box holds it, culled or nested', [C, N].every(m => m.get(pillar.id) && m.get(pillar.id).hi[2] >= 4.3 && B.missing(pillar.id).length === 0),
        JSON.stringify(C.get(pillar.id)))
}

//----------------------------------------------------------------------------------------------------------------------
// AN OBJECT AT THE FIRST LATTICE'S EDGE, while the search grows for another: its points in the first lattice are the part
// of it inside, so a wider lattice's finding replaces them -- kept, they were refined into a box of that part alone.
{
    const d = M.createDoc()
    const at = (x, y, z) => ({ pos: { x, y, z }, rot: { x: 0, y: 0, z: 0 }, scale: 1 })
    const a = M.addObject(d, 'root', { primitive: 'sphere', label: 'a', transform: at(0, 0, 0) }); a.params = { radius: 1 }
    // its parameters say a sphere of 1 at x 3; its code makes it 6 across: it runs past the first lattice
    const wide = M.addObject(d, 'root', { primitive: 'sphere', label: 'wide', transform: at(3, 0, 0) }); wide.params = { radius: 1 }
    const lost = M.addObject(d, 'root', { primitive: 'sphere', label: 'lost', transform: at(0, 0, 0) }); lost.params = { radius: 0.5 }
    const S = makeSampler(() => d, { [a.id]: sphere(1), [wide.id]: p => Math.hypot(...p) - 6,
                                     [lost.id]: p => Math.hypot(p[0] - 60, p[1], p[2]) - 0.5 })
    let cells = []
    const B = createBoxes({ sample: async input => { cells.push(input[4]); return S.sample(input) }, doc: () => d })
    await B.update()
    const W = B.get(wide.id)
    ok('(the stand-in: the search grew)', cells[1] > cells[0] * 1.5, cells.slice(0, 4).map(c => c.toFixed(3)).join(' '))
    ok('an object running past the first lattice: its box is all of it, from a wider lattice', W && near(W.lo, [-6, -6, -6], 2 * W.cell) && near(W.hi, [6, 6, 6], 2 * W.cell),
        JSON.stringify(W))
}

//----------------------------------------------------------------------------------------------------------------------
// A PART NO LATTICE FINDS: its group's box would be the rest of it, and a culling by that box skips the part where it is.
// So the group has no culling box (B.missing, cullBoxes) -- top level or nested -- and the report says which part; its
// other parts keep theirs. Not for a part that only takes away (a cut in a CSG group: what is left is inside the
// others), nor for the objects under a group with code that has a box (the relief above: they find nothing by design).
{
    const d = M.createDoc()
    const at = (x, y, z) => ({ pos: { x, y, z }, rot: { x: 0, y: 0, z: 0 }, scale: 1 })
    const g = M.addGroup(d, 'root', { label: 'g', transform: at(0, 0, 0) })
    const solid = M.addObject(d, g.id, { primitive: 'box', label: 'solid', transform: at(0, 0, 0) })
    const ghost = M.addObject(d, g.id, { primitive: 'sphere', label: 'ghost', transform: at(0, 0, 3) }); ghost.params = { radius: 0.5 }
    const cutg = M.addGroup(d, 'root', { label: 'cutg', transform: at(6, 0, 0) })
    const base = M.addObject(d, cutg.id, { primitive: 'box', label: 'base', transform: at(0, 0, 0) })
    const hole = M.addObject(d, cutg.id, { primitive: 'sphere', label: 'hole', join: 'subtract', transform: at(0, 0, 0.5) }); hole.params = { radius: 0.4 }
    const shapes = { [solid.id]: cube([1, 1, 1]), [ghost.id]: sphere(0.5), [base.id]: cube([1, 1, 1]), [hole.id]: sphere(0.4) }
    const S = makeSampler(() => d, shapes)
    // the ghost and the hole are never anyone's nearest surface: no lattice finds them
    const sample = async input => {
        const r = await S.sample(input)
        const gone = [ghost.id, hole.id].map(id => r.tags.indexOf(id) + 1)
        for (let i = 0; i < r.tag.length; i++) if (gone.includes(r.tag[i])) { r.tag[i] = 0; r.d[i] = 1e9 }
        return r
    }
    const B = createBoxes({ sample, doc: () => d })
    await B.update()
    ok('(the stand-in: neither the ghost nor the hole has a box; the solid and the base have theirs)', !B.get(ghost.id) && !B.get(hole.id) && !!B.get(solid.id) && !!B.get(base.id))
    ok('the group\'s box from the rest alone leaves the ghost out (what culling by it would skip)', !!B.get(g.id) && B.get(g.id).hi[2] < 2.5, JSON.stringify(B.get(g.id)))
    ok('...so it is missing, and the group has no culling box -- top level and nested; the solid keeps its own',
        JSON.stringify(B.missing(g.id)) === JSON.stringify([ghost.id]) && cullBoxes(d, B).get(g.id) === null
        && cullBoxes(d, B, { nested: true }).get(g.id) === null && !!cullBoxes(d, B, { nested: true }).get(solid.id))
    const why = Object.fromEntries(cullReport(d, B).map(u => [u.label, u.why]))
    ok('...and the report says which part', /a part found no surface/.test(why.g ?? '') && /ghost/.test(why.g), JSON.stringify(why))
    ok('a cut that found nothing takes nothing out of the box: the CSG group keeps its culling box', B.missing(cutg.id).length === 0 && !!cullBoxes(d, B).get(cutg.id))
}

//----------------------------------------------------------------------------------------------------------------------
// ...AND THROUGH THE BENCH'S VIEW OF THE BOXES (bench/index.js boxesFor `same`: the scaling bench's copies, each given its
// original's). cullBoxes asks a store three things -- fresh, get and missing -- and that view answered the first two
// alone. Asked as `B.missing?.()`, its silence read as "nothing missing", so every copy was culled by its original's box
// with the part found no surface of left out: the safety net above off on the very bench the pillars were found on, as
// data (nested) and as codegen. Through boxesFor itself on a stand-in renderer, and the contract: a store that cannot say
// what is missing is refused out loud, never culled by.
{
    const { boxesFor, sceneOf } = await import('../../bench/index.js')
    const { boxLoName } = await import('../codegen.js')
    const d = M.createDoc()
    const at = (x, y, z) => ({ pos: { x, y, z }, rot: { x: 0, y: 0, z: 0 }, scale: 1 })
    const copy = x => {
        const g = M.addGroup(d, 'root', { label: `copy at ${x}`, transform: at(x, 0, 0) })
        const solid = M.addObject(d, g.id, { primitive: 'box', label: 'solid', transform: at(0, 0, 0) })
        const ghost = M.addObject(d, g.id, { primitive: 'sphere', label: 'ghost', transform: at(0, 0, 3) }); ghost.params = { radius: 0.5 }
        return { g, solid, ghost }
    }
    const one = copy(0), two = copy(6)
    const same = new Map([[two.g.id, one.g.id], [two.solid.id, one.solid.id], [two.ghost.id, one.ghost.id]])
    const S = makeSampler(() => d, { [one.solid.id]: cube([1, 1, 1]), [one.ghost.id]: sphere(0.5), [two.solid.id]: cube([1, 1, 1]), [two.ghost.id]: sphere(0.5) })
    const sample = async input => {
        const r = await S.sample(input)
        const gone = [one.ghost.id, two.ghost.id].map(id => r.tags.indexOf(id) + 1)
        for (let i = 0; i < r.tag.length; i++) if (gone.includes(r.tag[i])) { r.tag[i] = 0; r.d[i] = 1e9 }
        return r
    }
    const warn = console.warn; console.warn = () => { }
    const plain = sceneOf(d, 'boxes-view'), data = sceneOf(d, 'boxes-view', true)
    console.warn = warn
    // the codegen road: each top-level node's box uniforms, lo.w 1 for known (cullUniforms)
    {
        let vals = {}
        const RT = { sampleTags: sample, scene: plain, set: v => { vals = v }, setStepCacheBox: () => { } }
        const r = await boxesFor(d, { only: [one.g.id], same })(RT)
        ok('(the stand-in: both copies have a box test, and the original\'s ghost no box)', boxLoName(two.g.id) in plain.uniforms && boxLoName(one.g.id) in plain.uniforms
            && typeof plain.dataOf !== 'function', JSON.stringify(Object.keys(plain.uniforms)))
        ok('the bench\'s view: a copy whose original left a part out has no culling box, as its original has none',
            vals[boxLoName(one.g.id)]?.[3] === 0 && vals[boxLoName(two.g.id)]?.[3] === 0, JSON.stringify(vals))
        const why = (r.unknown || []).find(u => u.includes(`(${two.g.id})`)) ?? ''
        ok('...and the bench\'s report says so for the copy, naming the part', /a part found no surface/.test(why) && /ghost/.test(why), JSON.stringify(r.unknown))
    }
    // as data: the records' boxes, nested -- the road the pillars were found on
    {
        let C = null
        const scene = { ...data, dataOf: (tree, c) => { C = c; return data.dataOf(tree, c) }, writeData: () => { } }
        const RT = { sampleTags: sample, scene, set: () => { }, setStepCacheBox: () => { } }
        await boxesFor(d, { only: [one.g.id], same })(RT)
        ok('...as data too: the copy\'s group no box, its solid its own, its ghost none',
            !!C && C.get(one.g.id) === null && C.get(two.g.id) === null && !!C.get(two.solid.id) && C.get(two.ghost.id) === null,
            C && JSON.stringify([...C]))
    }
    const unit = { lo: [-1, -1, -1], hi: [1, 1, 1], cell: 0.1 }
    let threw = null
    try { cullBoxes(d, { fresh: () => true, get: () => unit }) } catch (e) { threw = e }
    ok('a store that cannot say what is missing is refused, never culled by', !!threw && /missing/.test(threw.message), String(threw))
}

console.log(`boxes: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
