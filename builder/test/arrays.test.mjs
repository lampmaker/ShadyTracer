//======================================================================================================================
// THE WINDOW OF AN ARRAY (builder/arrays.js, 0.next). Run: node builder/test/arrays.test.mjs
//
// The pattern: what copiesRow and copiesRing make, about every axis and either way round, a row of turned copies, are
// rows and rings; a copy moved, turned or scaled off them is neither. The window, by brute force at points in and around
// each: every copy it leaves out is farther from the point than the margin -- its true distance to the copy's content box
// -- and the bound it stands in with is never above any of theirs, so the march can neither miss a surface nor take a
// bound for one. A window wider than it need be would be slower, not wrong; it is held small too.
//======================================================================================================================
import { copyPattern, windowOf, codeOf, contentKey } from '../arrays.js'
import { copiesRow, copiesRing } from '../model.js'
import { matrixOf } from '../transform.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)

// ---- the pattern
eq('a row along x, y and z: a row', ['x', 'y', 'z'].map(a => copyPattern(copiesRow(5, 0.3, a))), [{ kind: 'row', n: 5 }, { kind: 'row', n: 5 }, { kind: 'row', n: 5 }])
eq('a ring about x, y and z: a ring about that axis', ['x', 'y', 'z'].map(a => copyPattern(copiesRing(8, 2, a))?.axis), [0, 1, 2])
eq('...of radius 0 too (the circular array\'s copies)', copyPattern(copiesRing(6, 0, 'z')), { kind: 'ring', n: 6, axis: 2, sign: 1 })
const turned = copiesRow(4, 1, 'y').map(t => ({ ...t, rot: { x: 20, y: -30, z: 45 }, scale: 0.5 }))
eq('a row of copies turned and scaled alike: a row', copyPattern(turned), { kind: 'row', n: 4 })
const back = copiesRing(5, 1, 'x').reverse()
eq('a ring the other way round: a ring, sign -1', copyPattern(back), { kind: 'ring', n: 5, axis: 0, sign: -1 })
const moved = copiesRow(4, 1); moved[2] = { ...moved[2], pos: { ...moved[2].pos, y: 0.01 } }
const twisted = copiesRow(4, 1); twisted[1] = { ...twisted[1], rot: { x: 0, y: 0, z: 5 } }
const grown = copiesRing(4, 1); grown[3] = { ...grown[3], scale: 1.1 }
eq('a copy moved, turned or scaled off its row or ring: neither', [copyPattern(moved), copyPattern(twisted), copyPattern(grown)], [null, null, null])
eq('one copy: no pattern', copyPattern(copiesRow(1, 1)), null)
eq('the codes: none 0, a row 1, a ring 2 + 2 axis + way', [codeOf(null), codeOf({ kind: 'row' }), codeOf({ kind: 'ring', axis: 2, sign: -1 })], [0, 1, 7])
ok('the content key is no node id (letters and digits only)', !/^[A-Za-z][A-Za-z0-9]*$/.test(contentKey('g7')))

// ---- the window, against every copy
const fromParent = (m, p) => {                     // the inverse of matrixOf's: R^T (p - t) / s
    const d = [p[0] - m[12], p[1] - m[13], p[2] - m[14]]
    return [0, 1, 2].map(j => (m[4 * j] * d[0] + m[4 * j + 1] * d[1] + m[4 * j + 2] * d[2]) / m[15])
}
const boxDist = (q, b) => {
    const d = q.map((v, i) => Math.abs(v - 0.5 * (b.lo[i] + b.hi[i])) - 0.5 * (b.hi[i] - b.lo[i]))
    return Math.hypot(...d.map(x => Math.max(x, 0))) + Math.min(Math.max(...d), 0)
}
let seed = 12345
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
const cases = [
    ['a row of 16 LEDs, 8 cm apart', copiesRow(16, 0.08, 'x'), { lo: [-0.02, -0.02, -0.001], hi: [0.02, 0.02, 0.001] }],
    ['a ring of 16 about z, 0.9 out', copiesRing(16, 0.9, 'z'), { lo: [-0.6, -0.05, -0.01], hi: [0.6, 0.05, 0.01] }],
    ['a ring of 12 about x, its content off the axis', copiesRing(12, 0, 'x'), { lo: [0.1, 0.4, -0.1], hi: [0.3, 0.6, 0.1] }],
    ['a ring of 6 whose content is on the axis', copiesRing(6, 0, 'y'), { lo: [-0.1, -0.5, -0.1], hi: [0.1, 0.5, 0.1] }],
    ['a row of copies turned and halved', turned, { lo: [-0.2, -0.2, -0.2], hi: [0.2, 0.2, 0.2] }],
    ['a row whose copies overlap', copiesRow(10, 0.05, 'z'), { lo: [-0.1, -0.1, -0.1], hi: [0.1, 0.1, 0.1] }],
]
for (const [label, copies, box] of cases) {
    const pattern = copyPattern(copies), M = copies.map(t => matrixOf(t))
    let missed = 0, above = 0, worst = 0, widths = 0, loose = 0
    const margin = 0.002, scale = 1.7
    for (let i = 0; i < 4000; i++) {
        const q = [0, 1, 2].map(() => (rnd() * 2 - 1) * 1.6)
        // half the points near a copy's content: on its box's surface, give or take the margin
        if (i % 2) {
            const k = Math.floor(rnd() * copies.length), m = M[k]
            const local = box.lo.map((v, j) => v + (box.hi[j] - v) * rnd())
            local[i % 3] = rnd() < 0.5 ? box.lo[i % 3] : box.hi[i % 3]
            const R = v => [0, 1, 2].map(j => m[j] * v[0] + m[4 + j] * v[1] + m[8 + j] * v[2])
            const w = R(local).map((v, j) => m[12 + j] + m[15] * v + (rnd() - 0.5) * 0.004)
            q.splice(0, 3, ...w)
        }
        const { window, bound } = windowOf(q, copies, pattern, box, margin, scale)
        widths += window.length
        const inWindow = new Set(window)
        let nearest = Infinity
        for (let k = 0; k < copies.length; k++) {
            if (inWindow.has(k)) continue
            const d = boxDist(fromParent(M[k], q), box) * M[k][15] * scale
            nearest = Math.min(nearest, Math.max(d, 0))
            if (d <= margin) missed++
            if (bound > d + 1e-12) { above++; worst = Math.max(worst, bound - d) }
        }
        /* A ROW'S BOUND IS THE NEAREST LEFT-OUT COPY'S BOX DISTANCE (0.next), but for the slack (SLACK of the copy frame's
           reach, here up to 1.5e-4 at a box's corner): the sphere round the box it was before put the march's steps a
           sphere's distance from a flat or long content, a tenth of a box and more (arraywindow.gpu.mjs counts them) */
        if (pattern.kind === 'row' && Number.isFinite(nearest) && nearest - bound > 1e-3 * (1 + nearest)) loose++
        if (window.length === 0 && bound <= margin) missed++
    }
    ok(`${label}: no copy within the margin left out of the window`, missed === 0, `${missed} missed`)
    ok(`${label}: the bound never above a left-out copy's distance`, above === 0, `${above} above, by up to ${worst}`)
    if (pattern.kind === 'row') ok(`${label}: the bound the nearest left-out copy's own distance, but for the slack`, loose === 0, `${loose} looser`)
    ok(`${label}: a window of ${(widths / 4000).toFixed(2)} copies on average, of ${copies.length}`, label.includes('on the axis') || label.includes('overlap') || widths / 4000 < copies.length / 3)
}
eq('no pattern or no box: every copy, no bound', [windowOf([0, 0, 0], copiesRow(3, 1), null, { lo: [0, 0, 0], hi: [1, 1, 1] }, 0.1),
    windowOf([0, 0, 0], copiesRow(3, 1), { kind: 'row', n: 3 }, null, 0.1)], [{ window: [0, 1, 2], bound: null }, { window: [0, 1, 2], bound: null }])

console.log(`arrays: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
