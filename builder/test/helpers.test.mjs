//======================================================================================================================
// Tests for the helpers an asset carries (builder/helpers.js; model.js extractAsset, insertAsset). Run:
//   node builder/test/helpers.test.mjs
//
// WHAT IT CHECKS: the functions block read as its top-level items, comments and bodies not fooling it; what a piece of
// code needs of it, transitively; an asset carrying exactly that, and nothing when it needs nothing (so an old asset and
// a new one of the same item compare equal); insertion adding what the scene lacks, once, and refusing -- with nothing
// changed -- a helper the scene has differently; and the shader of the scene it went into having the helper.
//======================================================================================================================
import * as M from '../model.js'
import { generate } from '../codegen.js'
import { helpersOf, helpersFor, sameHelper, withoutComments } from '../helpers.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
const throws = (name, fn, re) => { try { fn(); ok(name, false, 'no error') } catch (e) { ok(name, !re || re.test(e.message), e.message) } }

const BLOCK = `// Functions: helpers for this scene.

// the sag of a spherical surface of radius R at height h
fn lensSag(R: f32, h: f32) -> f32 {
    const k = 2.0;                      // a const inside is no item
    return R - sqrt(max(R * R - h * h, 0.0)) * LENS_N / k;
}
const LENS_N: f32 = 1.0;
/* a block comment { with a brace } and fn fake() { } in it */
struct Ring { inner: f32, outer: f32 };
fn ringOf(r: Ring) -> f32 { return r.outer - r.inner; }
var<private> SCRATCH: f32 = 0.0;
fn unused() -> f32 { /* nested /* } */ */ return 1.0; }
alias Len = f32;`

//----------------------------------------------------------------------------------------------
// THE ITEMS
//----------------------------------------------------------------------------------------------
{
    const items = helpersOf(BLOCK)
    eq('every top-level item, in order, and nothing from inside a body or a comment', items.map(x => `${x.kind} ${x.name}`),
        ['fn lensSag', 'const LENS_N', 'struct Ring', 'fn ringOf', 'var SCRATCH', 'fn unused', 'alias Len'])
    ok('a function with the comment line right above it, and its whole body', items[0].text.startsWith('// the sag of a spherical surface')
        && items[0].text.trimEnd().endsWith('}') && items[0].text.includes('LENS_N / k'), items[0].text)
    ok('...a blank line cuts the comment off: the block\'s header is no one\'s', !items[0].text.includes('Functions: helpers'))
    ok('a struct with its ; and the comment right above it, a nested comment\'s brace not ending a body',
        items[2].text === '/* a block comment { with a brace } and fn fake() { } in it */\nstruct Ring { inner: f32, outer: f32 };'
        && items[5].text.includes('return 1.0; }'), JSON.stringify([items[2].text, items[5].text]))
    ok('comments out, nested ones too', withoutComments('a /* b /* c */ d */ e // f\ng').replace(/\s+/g, ' ') === 'a e g')
    ok('the same helper whatever its spacing and comments; another body is not', sameHelper('fn a() -> f32 {\n  return 1.0; }', '// one\nfn a() -> f32 { return 1.0; }')
        && !sameHelper('fn a() -> f32 { return 1.0; }', 'fn a() -> f32 { return 2.0; }'))
}

//----------------------------------------------------------------------------------------------
// WHAT CODE NEEDS
//----------------------------------------------------------------------------------------------
{
    const need = code => helpersOf(helpersFor(BLOCK, [code])).map(x => x.name)
    eq('a call, and what that reads in turn (a const), in the block\'s order', need('C = add_new(C, sd(p.z - lensSag(1.0, length(p.xy))), MATERIAL);'), ['lensSag', 'LENS_N'])
    eq('a struct read through a function', need('let w = ringOf(Ring(0.1, 0.2));'), ['struct Ring'.split(' ')[1], 'ringOf'])
    eq('nothing called, nothing carried -- a name in a comment is not a call', need('// lensSag would be nice\nC = add_new(C, Nsphere(p, 1.0), MATERIAL);'), [])
    eq('a longer name that contains one is not it', need('let x = lensSagged(1.0);'), [])
}

//----------------------------------------------------------------------------------------------
// AN ASSET CARRIES THEM, AND INSERTING PUTS THEM IN
//----------------------------------------------------------------------------------------------
const lensScene = () => {
    const d = M.createDoc()
    d.functions = BLOCK
    M.addGroup(d, 'root', { id: 'lens' })
    M.addObject(d, 'lens', { id: 'face', code: 'C = add_new(C, sd(p.z - lensSag(radius, length(p.xy))), MATERIAL);', params: { radius: 2 } })
    M.addObject(d, 'lens', { id: 'ball', primitive: 'sphere' })
    const m = M.addMaterial(d, { id: 'glass', code: 'm.albedo = VEC3(ringOf(Ring(0.2, 0.9)));' })
    M.find(d, 'ball').node.material = m.id
    return d
}
{
    const d = lensScene()
    const a = M.extractAsset(d, 'lens')
    eq('a lens asset carries the helpers its code and its material call, and only those', helpersOf(a.functions).map(x => x.name), ['lensSag', 'LENS_N', 'Ring', 'ringOf'])
    eq('a sphere whose own code calls none: what its material calls, and nothing of the lens\'s', helpersOf(M.extractAsset(d, 'ball').functions).map(x => x.name), ['Ring', 'ringOf'])
    const plain = M.createDoc(); M.addObject(plain, 'root', { id: 's', primitive: 'sphere' })
    ok('...a scene with no functions: no key', !('functions' in M.extractAsset(plain, 's')))
    eq('a material asset carries what its code calls', helpersOf(M.extractAsset(d, 'glass').functions).map(x => x.name), ['Ring', 'ringOf'])

    // into a scene without them: added, the scene sound, its shader with them
    const e = M.createDoc()
    M.addObject(e, 'root', { primitive: 'box' })
    M.insertAsset(e, a, 'root')
    eq('inserted where there are none: the helpers added to the functions block', helpersOf(e.functions).map(x => x.name), ['lensSag', 'LENS_N', 'Ring', 'ringOf'])
    ok('...the scene sound', M.validate(e).length === 0, M.validate(e).join())
    const s = generate(...M.generateArgs(e, { id: 'built' }))
    ok('...and its shader defines what the code calls', /fn lensSag\(/.test(s.wgsl) && /const LENS_N/.test(s.wgsl) && /fn ringOf\(/.test(s.wgsl))
    // again: nothing added twice
    M.insertAsset(e, a, 'root')
    eq('a second copy: nothing added twice', helpersOf(e.functions).map(x => x.name), ['lensSag', 'LENS_N', 'Ring', 'ringOf'])
    // into a scene with one of them the same, written its own way: kept, the rest added
    const f = M.createDoc()
    f.functions = 'const LENS_N:   f32 =   1.0;   // the same, spaced otherwise\n'
    M.insertAsset(f, a, 'root')
    eq('a helper the scene has the same: its own kept, the others added after it', helpersOf(f.functions).map(x => x.name), ['LENS_N', 'lensSag', 'Ring', 'ringOf'])
    // into a scene with one of them otherwise: refused, nothing changed
    const g = M.createDoc()
    g.functions = 'fn lensSag(R: f32, h: f32) -> f32 { return 0.0; }\n'
    const before = M.serialize(g)
    throws('a helper the scene has differently: refused, naming it', () => M.insertAsset(g, a, 'root'), /'lensSag' in this scene's functions is not the one the pasted code calls/)
    ok('...and nothing changed', M.serialize(g) === before)
    // copy and paste within the scene it came from: everything there already
    const fnBefore = d.functions
    M.insertAsset(d, M.extractAsset(d, 'lens'), 'root')
    ok('a copy pasted into its own scene: its functions block as it was', d.functions === fnBefore)
}

console.log(`helpers: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
