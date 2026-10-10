// node bench/test/wgslgraph.test.mjs
//
// THE CALL GRAPH shaderstats.mjs counts scene copies with: a number nobody can check by eye in an 800K kernel, so
// it is checked here on WGSL whose answer is known -- calls through helpers, a call in a loop counted once (a
// loop the compiler cannot unroll is one copy), comments that name a function, a nested block comment, and a
// function that never calls SDF.
import { inlineStats, functionsOf, stripComments } from '../wgslgraph.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) pass++
    else { fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
}

const src = `
/* outer /* nested SDF( */ still a comment: getMaterial2( */
fn SDF(r: f32) -> f32 { return r * 2.0; }               // SDF( in a comment is not a call
fn getMaterial2(x: f32) -> f32 { return x + SDF(x); }
fn normal(r: f32) -> f32 {
    var g = 0.0;
    for (var k = 0u; k < 3u + UB.opaqueZero; k++) { g += SDF(r + f32(k)); }
    return g;
}
fn unused(r: f32) -> f32 { return SDF(r) + SDF(r); }
fn main() {
    let a = SDF(1.0);
    let b = normal(a);
    let c = getMaterial2(b) + getMaterial2(a);
}
`
const s = inlineStats(src, 'main')
// 4, not 6: unused() calls it twice, and nothing calls unused()
ok('copies: SDF once, once in the loop, once inside each of two getMaterial2', s.copies.SDF === 4, JSON.stringify(s.copies))
ok('copies: getMaterial2 twice', s.copies.getMaterial2 === 2, JSON.stringify(s.copies))
const f = functionsOf(src)
ok('every fn found, with its call sites', f.size === 5 && f.get('main').calls.join() === 'SDF,normal,getMaterial2,getMaterial2', [...f.keys()].join() + ' / ' + f.get('main').calls.join())
ok('inlined size is the sum along the call tree', s.inlined === f.get('main').size + f.get('SDF').size + f.get('normal').size + f.get('SDF').size
    + 2 * (f.get('getMaterial2').size + f.get('SDF').size), String(s.inlined))
ok('one copy of SDF is its own size', s.one.SDF === f.get('SDF').size)
ok('nested block comments are stripped whole', !stripComments(src).includes('still a comment'))
ok('no entry: null', inlineStats(src, 'nope') === null)

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
