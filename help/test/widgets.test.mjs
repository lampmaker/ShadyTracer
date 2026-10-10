// node help/test/widgets.test.mjs
//
// THE SDF WIDGET'S NUMBERS (help/widgets.js), no DOM: the shapes' distances exact where they can be worked out by hand,
// the blend the renderer's own (lib/pathtracer/core/scene_api.js csgUnion: min - h^2 / 4k), every mode's field finite
// over the picture, and sphere tracing stopping at the surface -- what the help says the renderer does.
import { circle, box, smin, smax, MODES, trace } from '../widgets.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e

ok('circle: the distance to the centre, less the radius', near(circle(3, 4, 1), 4) && near(circle(0, 0, 1), -1))
ok('box: to a face, to a corner, inside', near(box(2, 0, 1, 1), 1) && near(box(2, 2, 1, 1), Math.SQRT2) && near(box(0.5, 0, 1, 1), -0.5))
ok('smin with k 0 is min, smax with k 0 is max', smin(1, 2, 0) === 1 && smax(1, 2, 0) === 2)
ok('smin: the renderer\'s, min - h^2/4k with h = max(k - |a - b|, 0)', near(smin(0.1, 0.3, 0.5), 0.1 - 0.3 * 0.3 / 2) && near(smin(1, 3, 0.5), 1))
ok('smax is its mirror', near(smax(0.1, 0.3, 0.5), 0.3 + 0.3 * 0.3 / 2))
ok('smin never above the plain min', [[0, 0], [0.2, -0.1], [1, 1.3]].every(([a, b]) => smin(a, b, 0.4) <= Math.min(a, b)))
{
    const bad = []
    for (const [name, M] of Object.entries(MODES)) {
        const p = Object.fromEntries(Object.entries(M.params).map(([k, [v]]) => [k, v]))
        for (let x = -2.6; x <= 2.6; x += 0.13) for (let y = -1.7; y <= 1.7; y += 0.13) if (!Number.isFinite(M.field(x, y, p))) bad.push(`${name} at ${x}, ${y}`)
        if (!M.note) bad.push(`${name}: no note`)
    }
    ok('every mode: a finite distance over the picture, and a note', !bad.length, bad.slice(0, 5).join('; '))
}
{
    const t = trace((x, y) => circle(x, y, 1), -3, 0, 1, 0)
    ok('sphere tracing a circle head-on: one step to the surface, found', t.hit && t.steps.length === 2 && near(t.steps[1].x, -1, 1e-6), JSON.stringify(t.steps))
    const g = trace((x, y) => circle(x, y, 1), -3, 1.01, 1, 0)
    ok('...passing just above it: many small steps, and a miss', !g.hit && g.steps.length > 10, `${g.steps.length} steps`)
    const s = trace((x, y) => box(x, y, 1, 1), -3, 0.3, 1, 0.1)
    ok('...a box at a slant: the last point on its surface', s.hit && Math.abs(box(s.steps.at(-1).x, s.steps.at(-1).y, 1, 1)) < 1e-3)
}

console.log(`widgets: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
