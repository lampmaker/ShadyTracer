//======================================================================================================================
// Tests for the expressions in a path's points (builder/expr.js): what reads and what it is worth, precedence,
// every refusal at its column, a rename that touches the name and nothing else, and a path resolved against a
// node's parameters with every problem said by its point. Run: node builder/test/expr.test.mjs
//======================================================================================================================
import { parseExpr, evalExpr, namesOf, renameIn, resolvePath, resolveProfile, pathNames, pathUses, pointNames, pointUses } from '../expr.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want),
    `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)

const scope = { rise: 0.6, w: 2, r: 0.1, corner: { x: 1, y: -2, z: 3 }, base: { x: 4, y: 5 }, tint: { r: 1, g: 0, b: 0 }, outline: [[0, 0], [1, 0], [0, 1]] }
const look = (n, c) => { const v = scope[n]; return c ? v?.[c] : v }
const val = t => { const r = parseExpr(t); return r.ast ? evalExpr(r.ast, look) : r }

//----------------------------------------------------------------------------------------------
// WHAT READS, AND WHAT IT IS WORTH
//----------------------------------------------------------------------------------------------
for (const [t, want] of [
    ['0.5', 0.5], ['.5', 0.5], ['3.', 3], ['1e-2', 0.01], ['2.5E+1', 25], ['rise', 0.6], ['-w/2', -1], ['- w / 2', -1],
    ['−w ÷ 2', -1], ['w × 3', 6], ['1 + 2 * 3', 7], ['(1 + 2) * 3', 9], ['2 - 3 - 4', -5], ['8 / 4 / 2', 1],
    ['-(rise + 0.4)', -1], ['--1', 1], ['+rise', 0.6], ['corner.x + corner.z', 4], ['base.y', 5], ['-corner.y', 2],
    ['rise*2-r', 1.1], ['((w))', 2],
]) {
    const got = val(t)
    ok(`"${t}" is ${want}`, typeof got === 'number' && Math.abs(got - want) < 1e-12, JSON.stringify(got))
}

//----------------------------------------------------------------------------------------------
// WHAT DOES NOT, SAID AT ITS COLUMN
//----------------------------------------------------------------------------------------------
for (const [t, msg, at] of [
    ['', /empty/, 1], ['1 +', /ends too soon/, 4], ['(1 + 2', /not closed/, 7], ['1 + 2)', /closes nothing/, 6],
    ['rise ^ 2', /'\^' is not part/, 6], ['2rise', /'rise' does not belong/, 2], ['corner.w', /\.x, \.y, \.z \(a vector\) or \.r, \.g, \.b/, 8],
    ['corner.', /\.x, \.y, \.z \(a vector\) or \.r, \.g, \.b/, 8], ['* 2', /'\*' cannot start/, 1], ['sin(1)', /'\(' does not belong/, 4],
    ['1 2', /'2' does not belong/, 3], [')', /closes nothing/, 1],
]) {
    const r = parseExpr(t)
    ok(`"${t}" is refused: ${msg} at column ${at}`, !!r.error && msg.test(r.error) && r.at === at, JSON.stringify(r))
}

//----------------------------------------------------------------------------------------------
// NAMES, AND A RENAME
//----------------------------------------------------------------------------------------------
eq('namesOf: every name read, with its component and column', namesOf(parseExpr('rise + corner.x * rise').ast),
    [{ name: 'rise', at: 1 }, { name: 'corner', comp: 'x', at: 8 }, { name: 'rise', at: 19 }])
eq('renameIn: the whole name, wherever it is read', renameIn('rise + 2*rise - (rise)', 'rise', 'lift'), 'lift + 2*lift - (lift)')
eq('...never a longer name, nor a component', renameIn('rise2 + risen + corner.x + x', 'x', 'y'), 'rise2 + risen + corner.x + y')
eq('...the vector itself, its component kept', renameIn('-corner.z', 'corner', 'tip'), '-tip.z')
eq('...and text that does not read, unchanged', renameIn('rise ^ 2', 'rise', 'lift'), 'rise ^ 2')

//----------------------------------------------------------------------------------------------
// A PATH RESOLVED AGAINST A NODE'S PARAMETERS
//----------------------------------------------------------------------------------------------
{
    const v = { path: [[0, 0, 0], ['w/2', 0, 0, 'r'], ['w/2', 'corner.y', 'rise']] }
    const r = resolvePath(scope, v)
    eq('numbers stay, names read', r, { points: [[0, 0, 0], [1, 0, 0, 0.1], [1, -2, 0.6]], problems: [] })
    eq('pathNames: each name once, in order', pathNames(v), ['w', 'r', 'corner', 'rise'])
    eq('pathUses: the first point that reads a name', [pathUses(v, 'w'), pathUses(v, 'rise'), pathUses(v, 'h')], [2, 3, 0])
    const bad = resolvePath(scope, { path: [[0, 0, 'h'], ['corner', 0, 'tint', 'outline'], ['base.z', '1 +', 0], [1, 2], [0, 0, true]] })
    eq('every problem by its point and entry', bad.problems, [
        "point 1, z: no parameter 'h'",
        "point 2, x: 'corner' is a vector -- say corner.x, corner.y or corner.z",
        "point 2, z: 'tint' is not a number",
        "point 2, fillet: 'outline' is not a number",
        "point 3, x: 'base' has no z",
        'point 3, y: "1 +": the expression ends too soon (column 4)',
        'point 4: x, y, z, then a fillet, scale x, scale y and twist if it has them',
        'point 5, z: a number or an expression',
    ])
    ok('...and the points filled anyway, NaN where an entry could not be read', bad.points.length === 5 && Number.isNaN(bad.points[0][2]) && bad.points[2][2] === 0)
    eq('a fillet named on an end is refused: an end has no corner', resolvePath(scope, { path: [[0, 0, 0, 'r'], [1, 0, 0]] }).problems, ['point 1: an end has no corner to round'])
    eq('...a number there is pathPieces\' to judge (0 is allowed)', resolvePath(scope, { path: [[0, 0, 0, 0], [1, 0, 0]] }).problems, [])
    ok('a value that is not finite reads (pathPieces refuses it, as a slider can reach it)', Number.isNaN(resolvePath({ w: 0 }, { path: [['0/w', 0, 0], [1, 0, 0]] }).points[0][0]))
    // PER POINT, THE CROSS-SECTION'S SCALE X, SCALE Y AND TWIST (2026-10-02): entries 5 to 7, each a number or a name
    const sc = resolvePath(scope, { path: [[0, 0, 0, 0, 'w'], [1, 0, 0, 'r', 1.5, 'rise', 'w * 45'], [2, 0, 0]] })
    eq('a point may go on with scale x, scale y and twist, names read', sc, { points: [[0, 0, 0, 0, 2], [1, 0, 0, 0.1, 1.5, 0.6, 90], [2, 0, 0]], problems: [] })
    eq('...each said by its name when it does not read', resolvePath(scope, { path: [[0, 0, 0, 0, 'h'], [1, 0, 0, 0, 1, 1, 'tint']] }).problems,
        ["point 1, scale x: no parameter 'h'", "point 2, twist: 'tint' is not a number"])
    eq('...and eight entries are too many', resolvePath(scope, { path: [[0, 0, 0, 0, 1, 1, 0, 9], [1, 0, 0]] }).problems,
        ['point 1: x, y, z, then a fillet, scale x, scale y and twist if it has them'])
}

//----------------------------------------------------------------------------------------------
// A PROFILE (2026-10-02): x, y and a fillet, two or three entries a point, a closed outline -- every point a corner
//----------------------------------------------------------------------------------------------
{
    const list = [[0, 0], ['w', 0, 'r'], ['w', 'rise'], [0, 'rise', 'r']]
    eq('a profile\'s names read against the node', resolveProfile(scope, list), { points: [[0, 0], [2, 0, 0.1], [2, 0.6], [0, 0.6, 0.1]], problems: [] })
    eq('pointNames and pointUses on a bare list', [pointNames(list), pointUses(list, 'rise'), pointUses(list, 'h')], [['w', 'r', 'rise'], 3, 0])
    eq('every problem by its point and entry: x, y, fillet', resolveProfile(scope, [['h', 0], [1, 'tint', 'corner'], [1, 2, 3, 4], [0]]).problems, [
        "point 1, x: no parameter 'h'",
        "point 2, y: 'tint' is not a number",
        "point 2, fillet: 'corner' is a vector -- say corner.x, corner.y or corner.z",
        'point 3: x, y, and a fillet radius if it has one',
        'point 4: x, y, and a fillet radius if it has one',
    ])
    eq('...a fillet named on the first point is fine: a closed outline has no ends', resolveProfile(scope, [[0, 0, 'r'], [1, 0], [0, 1]]).problems, [])
    eq('not a list at all', resolveProfile(scope, 3).problems, ['a profile is a list of points'])
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `expr: ${pass} passed, 0 failed`)
process.exit(fail ? 1 : 0)
