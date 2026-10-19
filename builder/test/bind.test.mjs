//======================================================================================================================
// Tests for component parameters (builder/bind.js; model.js version 18): a node's values bound by expressions to the
// parameters of the groups above it. Run: node builder/test/bind.test.mjs
//
// WHAT IT CHECKS: what a node can bind and what each line reads, refused at its line and column; the values written top
// down, a group's own parameters for its placement and copies but never for its parameters; a binding that cannot be
// resolved said and its value kept; a parameter renamed, removed or made another kind with its bindings following or
// refusing; what a lock-honouring caller sees (heldOf); the file -- validated, saved, read back, a version 17 file
// upgraded; and the shader: a bound value is a value, so codegen's text is the text of the same values typed. A light's
// own settings (0.68.0): bound with the way the light is given, two ways at once refused, a value its checks refuse kept
// and said; a colour parameter read by its components, and a whole colour or vector bound in one line.
//======================================================================================================================
import * as M from '../model.js'
import { generate } from '../codegen.js'
import { targetsOf, parseBindings, lookupIn, liveKeyOf, evaluate, LIGHT_TARGETS } from '../bind.js'
import { liveUniformsOf } from '../animate.js'
import { transformReadout } from '../readout.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
const throws = (name, fn, re) => { try { fn(); ok(name, false, 'no error') } catch (e) { ok(name, !re || re.test(e.message), e.message) } }

/* a lens component: `diameter` and `height` on the group, a cylinder and a holder ring inside, a sub-group with its own
   `gap`, and an LED strip whose copies are its own count and pitch */
function lensDoc() {
    const d = M.createDoc()
    M.addGroup(d, 'root', { id: 'lens', params: { diameter: 2, height: 0.5, corner: { x: 1, y: 2, z: 3 } } })
    M.addObject(d, 'lens', { id: 'body', primitive: 'cylinder' })
    M.addGroup(d, 'lens', { id: 'holder', params: { gap: 0.1 } })
    M.addObject(d, 'holder', { id: 'ring', primitive: 'box' })
    M.addGroup(d, 'root', { id: 'strip', params: { count: 4, pitch: 0.5 } })
    M.addObject(d, 'strip', { id: 'led', primitive: 'sphere' })
    return d
}
const node = (d, id) => M.find(d, id).node

//----------------------------------------------------------------------------------------------
// WHAT A NODE CAN BIND, AND WHAT A LINE READS
//----------------------------------------------------------------------------------------------
{
    const d = lensDoc()
    const t = M.bindTargets(d, 'ring')
    ok('a box binds its size\'s components, its rounding, its transform and its own join blend; no blend, no copies',
        ['size.x', 'size.y', 'size.z', 'rounding', 'pos.x', 'pos.z', 'rot.y', 'scale', 'join.blend'].every(x => t.includes(x))
        && !t.includes('blend') && !t.includes('size') && !t.some(x => x.startsWith('copies.')), t.join())
    const g = M.bindTargets(d, 'strip')
    ok('a plain group binds its own parameters, its blend and its copies', ['count', 'pitch', 'blend', 'copies.count', 'copies.pitch', 'copies.along'].every(x => g.includes(x)), g.join())
    eq('the root binds nothing', M.bindTargets(d, 'root'), [])
    eq('...and names nothing', M.bindNames(d, 'root'), [])
    eq('the names a node reads: the groups above it, nearest first', M.bindNames(d, 'ring').map(s => [s.id, s.names]), [['holder', ['gap']], ['lens', ['diameter', 'height', 'corner']]])
    eq('...a group\'s own first, said to be its own', M.bindNames(d, 'strip').map(s => [s.id, !!s.own]), [['strip', true]])
    eq('the keys a target is pushed live under', ['radius', 'size.x', 'pos.z', 'rot.x', 'scale', 'blend', 'join.blend', 'copies.count'].map(liveKeyOf),
        ['radius', 'size', 'transform', 'transform', 'transform', 'blend', 'jblend', 'copies'])
    // every refusal at its line and column
    const bad = M.readBindings(d, 'ring', 'size.x = diameter\n\nsize.q = 1\nrounding = diamter / 2\npos.z = height +\nscale\nsize.x = 1\npos.x = corner\n// a comment\npos.y = corner.x  // the corner')
    eq('refused by line and column: an unknown target, an unknown name, an expression that ends, no =, twice, a vector without its component',
        bad.errors.map(e => [e.line, e.col]), [[3, 1], [4, 12], [5, 17], [6, 1], [7, 1], [8, 9]])
    eq('...and what did read is kept, in order, comments aside', bad.bind, { 'size.x': 'diameter', 'pos.y': 'corner.x' })
    ok('a name the node\'s own group has, read for a parameter: refused (a parameter reads only the groups above)',
        M.readBindings(d, 'strip', 'pitch = count').errors.length === 1 && M.readBindings(d, 'strip', 'copies.count = count').errors.length === 0)
    ok('copies.along is a letter, and needs a count or a pitch', M.readBindings(d, 'strip', 'copies.along = w').errors.length === 1
        && M.readBindings(d, 'strip', 'copies.along = y').errors.length === 1 && M.readBindings(d, 'strip', 'copies.count = count\ncopies.along = y').errors.length === 0)
    ok('evaluate: a value, or why not', evaluate('2 * a', lookupIn([{ params: { a: 3 } }])).value === 6 && /not a parameter/.test(evaluate('b', lookupIn([{ params: { a: 3 } }])).error)
        && /comes to Infinity/.test(evaluate('1 / (a - a)', lookupIn([{ params: { a: 3 } }])).error))
    ok('targetsOf a node read through no view still lists its numbers', targetsOf({ kind: 'object', params: { r: 1, c: { r: 1, g: 1, b: 1 } } }).includes('c.g'))
    void parseBindings
}

//----------------------------------------------------------------------------------------------
// THE VALUES WRITTEN
//----------------------------------------------------------------------------------------------
{
    const d = lensDoc()
    let r = M.setBindings(d, 'body', 'radius = diameter / 2\nheight = height\npos.z = height / 2')
    eq('a cylinder sized and placed by its lens', [node(d, 'body').params.radius, node(d, 'body').params.height, node(d, 'body').transform.pos.z], [1, 0.5, 0.25])
    eq('...and what moved, by the key it is pushed under', r.changed.map(c => `${c.id}.${c.key}`).sort(), ['body.height', 'body.radius', 'body.transform'])
    r = M.setBindings(d, 'ring', 'size.x = diameter + 2 * gap\nsize.y = diameter + 2 * gap\npos.z = corner.z - gap')
    eq('a ring by its holder\'s gap and its lens\'s diameter, a vector\'s component too', [node(d, 'ring').params.size.x, node(d, 'ring').transform.pos.z], [2.2, 2.9])
    // the lens's diameter changed: a resolve writes everything bound to it, and says what moved
    node(d, 'lens').params.diameter = 3
    r = M.resolveBindings(d)
    eq('a parameter changed: everything bound to it follows', [node(d, 'body').params.radius, node(d, 'ring').params.size.y], [1.5, 3.2])
    eq('...and only that is said to have moved', r.changed.map(c => `${c.id}.${c.key}`).sort(), ['body.radius', 'ring.size'])
    eq('...a resolve with nothing changed moves nothing', M.resolveBindings(d).changed, [])
    // a group's own: bound from above, then read by its children -- top down
    M.setBindings(d, 'holder', 'gap = diameter / 10')
    eq('a group\'s parameter bound from above, its children reading the value it was given', [node(d, 'holder').params.gap, node(d, 'ring').params.size.x], [0.3, 3.6])
    // an LED strip: its copies from its own count and pitch
    r = M.setBindings(d, 'strip', 'copies.count = count\ncopies.pitch = pitch\ncopies.along = y')
    eq('an array from its own parameters: a row of count, pitch apart, along y', node(d, 'strip').copies.map(t => t.pos.y), [-0.75, -0.25, 0.25, 0.75])
    node(d, 'strip').params.count = 2
    r = M.resolveBindings(d)
    eq('...another count, another row, pushed as the copies', [node(d, 'strip').copies.length, r.changed.map(c => `${c.id}.${c.key}`)], [2, ['strip.copies']])
    node(d, 'strip').params.count = 40
    r = M.resolveBindings(d)
    ok('...a count past ARRAY_MAX: said, and the row it had kept', node(d, 'strip').copies.length === 2 && r.problems.some(p => /copies\.count/.test(p)), r.problems.join())
    node(d, 'strip').params.count = 2
    // a blend, a join blend, a scale that cannot be
    M.addGroup(d, 'lens', { id: 'cut', blend: 0, params: { k: 0.05 } })
    M.addObject(d, 'cut', { id: 'cb', primitive: 'box' })
    M.addObject(d, 'cut', { id: 'cs', primitive: 'sphere', join: 'subtract' })
    M.setBindings(d, 'cut', 'blend = k * 2')
    M.setBindings(d, 'cs', 'join.blend = -height\nscale = height - 0.5')
    r = M.resolveBindings(d)
    ok('a blend from its own parameter, a join blend below 0 made 0, a scale of 0 refused and kept',
        node(d, 'cut').blend === 0.1 && node(d, 'cs').joinBlend === 0 && node(d, 'cs').transform.scale === 1 && r.problems.some(p => /'cs' scale/.test(p)), r.problems.join())
    // moved out of its component: said, and the value kept
    M.move(d, 'body', 'root')
    r = M.resolveBindings(d)
    ok('a bound node moved out of its component: its bindings say so, its values stay', node(d, 'body').params.radius === 1.5
        && r.problems.some(p => /'body' radius: 'diameter' is not a parameter of any group above/.test(p)), r.problems.join('; '))
    M.move(d, 'body', 'lens')
    // a duplicate keeps its bindings, and a copy of a component is a component
    M.duplicate(d, 'lens')
    const copy = d.root.children.find(n => n.id !== 'lens' && n.kind === 'group' && n.params?.diameter !== undefined)
    ok('a component duplicated: its copy\'s children bound to the copy\'s parameters', !!copy && (() => {
        copy.params.diameter = 5; M.resolveBindings(d)
        const b = copy.children.find(n => n.bind?.radius)
        return b?.params.radius === 2.5 && node(d, 'body').params.radius === 1.5
    })())
    eq('setBindings with no text: none', (M.setBindings(d, 'ring', ''), node(d, 'ring').bind), undefined)
    throws('the root binds nothing', () => M.setBindings(d, 'root', 'pos.x = 1'), /root/)
    throws('a refusal says its line and column, and changes nothing', () => M.setBindings(d, 'body', 'radius = nope'), /line 1:10/)
    ok('...nothing', node(d, 'body').bind.radius === 'diameter / 2')
}

//----------------------------------------------------------------------------------------------
// A PARAMETER RENAMED, REMOVED, MADE ANOTHER KIND
//----------------------------------------------------------------------------------------------
{
    const d = lensDoc()
    M.setBindings(d, 'body', 'radius = diameter / 2\npos.z = height')
    M.setBindings(d, 'ring', 'size.x = diameter + gap')
    M.renameParam(d, 'lens', 'diameter', 'dia')
    eq('a group\'s parameter renamed: every binding reading it rewritten, and nothing else', [node(d, 'body').bind, node(d, 'ring').bind],
        [{ radius: 'dia / 2', 'pos.z': 'height' }, { 'size.x': 'dia + gap' }])
    throws('renamed to a name a nearer group has: refused, since that one would be read instead', () => M.renameParam(d, 'lens', 'dia', 'gap'), /would read 'holder''s 'gap'/)
    ok('...and nothing changed', 'dia' in node(d, 'lens').params && node(d, 'ring').bind['size.x'] === 'dia + gap')
    // a name a nearer group has hides the farther: renaming the farther does not reach it
    M.addParam(d, 'holder', 'height', 9)
    M.setBindings(d, 'ring', 'size.x = dia + gap\npos.z = height')
    M.renameParam(d, 'lens', 'height', 'tall')
    eq('a nearer group\'s parameter of the same name hides the renamed one', [node(d, 'body').bind['pos.z'], node(d, 'ring').bind['pos.z']], ['tall', 'height'])
    // the node's own parameter renamed: its target follows, on every node of the block
    M.renameParam(d, 'body', 'radius', 'r')
    eq('a bound parameter renamed: its binding\'s target follows', node(d, 'body').bind, { r: 'dia / 2', 'pos.z': 'tall' })
    throws('a parameter a binding reads cannot be removed', () => M.removeParam(d, 'lens', 'dia'), /read by 'body' r, 'ring' size\.x/)
    throws('...nor made another kind', () => M.setParamKind(d, 'lens', 'dia', 'vector'), /read by/)
    M.removeParam(d, 'body', 'r')
    eq('a bound parameter removed: its binding goes with it', node(d, 'body').bind, { 'pos.z': 'tall' })
    M.setParamKind(d, 'ring', 'size', 'number')
    eq('a bound vector made a number: its components\' bindings go', node(d, 'ring').bind, { 'pos.z': 'height' })
    // a group's own copies read its own parameter: that counts as reading it
    M.setBindings(d, 'strip', 'copies.count = count')
    throws('a group\'s own copies reading its parameter: it cannot be removed either', () => M.removeParam(d, 'strip', 'count'), /'strip' copies\.count/)
}

//----------------------------------------------------------------------------------------------
// WHAT HOLDS IT, THE FILE, THE SHADER
//----------------------------------------------------------------------------------------------
{
    const d = lensDoc()
    M.setBindings(d, 'body', 'radius = diameter / 2')
    M.setBindings(d, 'ring', 'pos.z = height')
    eq('held: a bound parameter holds the parameters, a bound position the position -- the user\'s locks untouched',
        [M.heldOf(node(d, 'body')), M.heldOf(node(d, 'ring')), M.lockOf(node(d, 'body'))],
        [{ position: false, params: true, bound: { position: false, params: true } }, { position: true, params: false, bound: { position: true, params: false } }, { position: false, params: false }])
    // the numbers' panel says why the handles are missing: bound, not locked -- and where to change it
    const notes = id => transformReadout(d, id).notes.map(n => n.text).join(' | ')
    ok('the readout: a bound position is said to be from parameters, not locked', /from parameters: position and rotation/.test(notes('ring')) && !/locked:/.test(notes('ring')), notes('ring'))
    M.setLock(d, 'ring', 'position', true)
    ok('...locked as well: the lock is said, and the binding is not said twice', /locked: position and rotation/.test(notes('ring')) && !/from parameters: position/.test(notes('ring')), notes('ring'))
    M.setLock(d, 'ring', 'position', false)
    eq('the document is sound', M.validate(d), [])
    const back = M.parse(M.serialize(d))
    eq('saved and read back: the bindings and their values', [back.version, node(back, 'body').bind, node(back, 'body').params.radius], [M.VERSION, { radius: 'diameter / 2' }, 1])
    const old = JSON.parse(M.serialize(d)); old.version = 17
    walkDel(old.root)
    function walkDel(n) { delete n.bind; (n.children || []).forEach(walkDel) }
    ok('a version 17 file reads, upgraded', M.parse(JSON.stringify(old)).version === M.VERSION)   // the version of the moment: every upgrade after 17 runs too
    const broken = JSON.parse(M.serialize(d))
    broken.root.children[0].children[0].bind = { 'radius': 'diameter /', nothing: '1' }
    const p = M.validate(broken)
    ok('a file whose binding does not read, or binds what the node has not: refused, each said', p.some(x => /bind radius/.test(x)) && p.some(x => /bind nothing is not one of its values/.test(x)), p.join('; '))
    // the shader: the same as the values typed in
    const typed = lensDoc()
    node(typed, 'body').params.radius = 1
    node(typed, 'ring').transform.pos.z = 0.5
    const a = generate(...M.generateArgs(d, { id: 'built' })), b = generate(...M.generateArgs(typed, { id: 'built' }))
    ok('codegen: a bound scene is the text of its values typed in -- a binding is nothing to the shader', a.wgsl === b.wgsl
        && JSON.stringify(a.uniforms) === JSON.stringify(b.uniforms))
    // an array on a group with parameters (a block with no code): allowed now; with code, not
    M.setBindings(d, 'strip', 'copies.count = count\ncopies.pitch = pitch')
    eq('an LED strip: a group with parameters is an array', node(d, 'strip').copies.length, 4)
    ok('...and sound', M.validate(d).length === 0, M.validate(d).join())
    M.setCode(d, 'strip', 'C = children(C, p);')
    ok('...with code it is not', M.validate(d).some(x => /a group with code has no copies/.test(x)))
}

// THE COMPONENT DATABASE (the library): a component put in and taken out elsewhere keeps its bindings, and they read the
// parameters of the copy inserted, not of the one it came from
{
    const d = lensDoc()
    M.setBindings(d, 'body', 'radius = diameter / 2')
    const e = M.createDoc()
    M.addObject(e, 'root', { primitive: 'box' })
    M.insertAsset(e, M.extractAsset(d, 'lens'), 'root')
    const g = e.root.children.at(-1), body = g.children.find(n => n.bind)
    g.params.diameter = 6
    const r = M.resolveBindings(e)
    ok('a component through the library: its bindings with it, reading the inserted copy\'s parameters',
        body?.bind?.radius === 'diameter / 2' && body.params.radius === 3 && r.problems.length === 0 && M.validate(e).length === 0
        && node(d, 'body').params.radius === 1, JSON.stringify({ bind: body?.bind, r }))
}

//----------------------------------------------------------------------------------------------
// A LIGHT'S OWN SETTINGS (0.68.0): a lamp component's flux and colour -- the user, 2026-10-19: "a parameter such as colour
// and flux in a group, used for a light source: I can't get it to work" -- they were not targets at all
//----------------------------------------------------------------------------------------------
{
    const lampDoc = () => {
        const d = M.createDoc()
        M.addGroup(d, 'root', { id: 'lamp', params: { flux: 800, tint: { r: 1, g: 0.5, b: 0.25 }, kelvin: 3000, w: 0.2, at: { x: 1, y: 2, z: 3 } } })
        M.addLight(d, 'lamp', { id: 'led', shape: 'rectangle' })
        M.addLight(d, 'lamp', { id: 'rays', shape: 'rayfile' })
        M.addObject(d, 'lamp', { id: 'shade', primitive: 'box' })
        return d
    }
    const d = lampDoc(), L = id => M.lightOf(node(d, id))
    const t = M.bindTargets(d, 'led')
    ok('a face light binds its size, then its own settings, then its placement', JSON.stringify(t.slice(0, 2 + LIGHT_TARGETS.length))
        === JSON.stringify(['width', 'height', ...LIGHT_TARGETS]) && t.includes('pos.z') && !t.includes('blend'), t.join())
    eq('...a ray file only its flux and the index it emits into', M.bindTargets(d, 'rays').filter(x => x.startsWith('light.')), ['light.flux', 'light.emitN'])
    ok('...an object none', !M.bindTargets(d, 'shade').some(x => x.startsWith('light.')))
    eq('the keys a light setting is pushed live under: the light\'s, all three of its face\'s uniforms', ['light.flux', 'light.colour.g', 'light.xy.x'].map(liveKeyOf), ['light', 'light', 'light'])
    // what a line reads, and what it is refused for
    const err = text => M.readBindings(d, 'led', text).errors.map(e => [e.line, e.col, e.message])
    ok('the slip `flux = ...` named for what it is', /'flux' is a light setting: write light.flux/.test(err('flux = flux')[0]?.[2]), JSON.stringify(err('flux = flux')))
    eq('a colour parameter read by its components', err('light.colour.r = tint.r\nlight.colour.g = tint.g * 0.5'), [])
    ok('...not whole, nor by a vector\'s', /'tint' is a colour: say which component, tint.r/.test(err('light.colour.r = tint')[0]?.[2])
        && /its components are .r, .g, .b/.test(err('light.colour.r = tint.x')[0]?.[2]), JSON.stringify([err('light.colour.r = tint'), err('light.colour.r = tint.x')]))
    ok('...and a vector\'s not by a colour\'s', /'at' has no .r/.test(err('width = at.r')[0]?.[2]), JSON.stringify(err('width = at.r')))
    eq('two ways at once refused at the line that makes them two', [err('light.flux = flux\nlight.luminance = 3'), err('light.cct = kelvin\n\nlight.xy.x = 0.3')].map(e => e.map(x => [x[0], x[1]])),
        [[[2, 1]], [[3, 1]]])
    ok('...said so', /'light.luminance' and 'light.flux' give its brightness two ways/.test(err('light.flux = flux\nlight.luminance = 3')[0]?.[2]))
    eq('...cct and duv are one way, n and the cone none', [err('light.cct = kelvin\nlight.duv = 0.001'), err('light.flux = flux\nlight.n = 2\nlight.halfAngle = 40\nlight.emitN = 1.4')], [[], []])
    // a whole colour or vector in one line, kept one line a component
    const whole = M.readBindings(d, 'led', 'light.colour = tint\npos = at')
    eq('a whole colour, and a whole vector, each one line: three components each', whole.bind, { 'light.colour.r': 'tint.r', 'light.colour.g': 'tint.g',
        'light.colour.b': 'tint.b', 'pos.x': 'at.x', 'pos.y': 'at.y', 'pos.z': 'at.z' })
    ok('...a name, not an expression, and of the kind it is', /takes a parameter's name/.test(err('light.colour = tint * 2')[0]?.[2])
        && /takes a parameter's name/.test(err('light.colour = tint.r')[0]?.[2]) && /'at' has no .r/.test(err('light.colour = at')[0]?.[2]),
        JSON.stringify([err('light.colour = tint * 2'), err('light.colour = at')]))
    ok('...and a component bound twice by it refused', err('light.colour.r = 1\nlight.colour = tint').some(e => e[0] === 2 && /bound twice/.test(e[2])))
    // the values written, with the way the light is given
    let r = M.setBindings(d, 'led', 'light.flux = flux\nlight.colour = tint\nwidth = w')
    eq('the flux and the colour written, the light now set by its flux and coloured by RGB, its width beside them',
        [L('led').flux, L('led').colour, L('led').colourBy, node(d, 'led').params.width], [800, { r: 1, g: 0.5, b: 0.25 }, 'rgb', 0.2])
    eq('...pushed once, as the light', r.changed.map(c => `${c.id}.${c.key}`).sort(), ['led.light', 'led.width'])
    eq('...and saved as what was applied', M.bindingsOf(d, 'led'), 'light.flux = flux\nlight.colour.r = tint.r\nlight.colour.g = tint.g\nlight.colour.b = tint.b\nwidth = w')
    node(d, 'lamp').params.flux = 400; node(d, 'lamp').params.tint.g = 1
    r = M.resolveBindings(d)
    eq('the lamp\'s flux and tint changed: the light follows, said as the light', [L('led').flux, L('led').colour.g, r.changed.map(c => `${c.id}.${c.key}`)], [400, 1, ['led.light']])
    eq('what moves with the lamp\'s flux, by its live key (model.js boundFrom)', M.boundFrom(d, 'lamp', 'flux'), [{ id: 'led', key: 'light' }])
    ok('...and the uniforms an animated lamp flux keeps: the face\'s three (animate.js)', ['emissive_led', 'emissiveLuminance_led', 'beam_led']
        .every(u => liveUniformsOf(d, 'lamp', 'flux').includes(u)), liveUniformsOf(d, 'lamp', 'flux').join())
    eq('its width bound holds its size, as any bound parameter (heldOf)', M.heldOf(node(d, 'led')).bound, { position: false, params: true })
    M.setBindings(d, 'led', 'light.flux = flux\nlight.colour = tint')
    eq('...its flux and colour hold neither its place nor its size: its stretch handles stay', M.heldOf(node(d, 'led')).bound, { position: false, params: false })
    M.setBindings(d, 'led', 'light.luminance = flux / 2\nlight.cct = kelvin\nlight.duv = 0.002')
    eq('a luminance bound: set by its luminance (its flux gone); a CCT and Duv: coloured by them',
        [L('led').flux, L('led').luminance, L('led').colourBy, L('led').cct, L('led').duv], [null, 200, 'cct', 3000, 0.002])
    // a value the light's own checks refuse is said, and the value kept -- the others still written
    node(d, 'lamp').params.kelvin = 99999; node(d, 'lamp').params.flux = 1000
    r = M.resolveBindings(d)
    ok('a CCT out of range: said, kept; the luminance beside it written', L('led').cct === 3000 && L('led').luminance === 500
        && r.problems.length === 1 && /'led' light.cct, light.duv: cct must be/.test(r.problems[0]), JSON.stringify(r))
    node(d, 'lamp').params.kelvin = 3000
    M.setLight(d, 'led', { distribution: 'collimated', flux: 5 })
    r = M.resolveBindings(d)
    ok('a luminance onto a collimated light: refused by its checks, said, the flux kept', L('led').flux === 5 && /a collimated light has no luminance/.test(r.problems.join()), JSON.stringify(r))
    // the file: kept, read back; two ways at once refused on the way in
    M.setLight(d, 'led', { distribution: 'cosine' })
    M.setBindings(d, 'led', 'light.flux = flux\nlight.colour = tint')
    M.setBindings(d, 'rays', 'light.flux = flux * 2\nlight.emitN = 1.41')
    eq('a ray file: its flux and index written', [L('rays').flux, L('rays').emitN], [2000, 1.41])
    const back = M.parse(M.serialize(d))
    ok('saved and read back with its bindings, sound', JSON.stringify(node(back, 'led').bind) === JSON.stringify(node(d, 'led').bind) && M.validate(back).length === 0, M.validate(back).join())
    const j = JSON.parse(M.serialize(d))
    const find = (n, id) => n.id === id ? n : (n.children || []).map(c => find(c, id)).find(Boolean)
    find(j.root, 'led').bind = { 'light.flux': 'flux', 'light.luminance': '3' }
    throws('a file binding one light\'s brightness two ways is refused, said why', () => M.parse(JSON.stringify(j)), /give its brightness two ways/)
    find(j.root, 'led').bind = { 'light.cct': 'kelvin' }
    find(j.root, 'shade').bind = { 'light.flux': 'flux' }
    throws('...and an object binding a light setting', () => M.parse(JSON.stringify(j)), /'shade': bind light.flux is not one of its values/)
}

console.log(`bindings: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
