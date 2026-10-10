//======================================================================================================================
// Tests for the recipe (builder/recipe.js): a group's joins as text, read back into the document through the
// model's own operations. Run: node builder/test/recipe.test.mjs
//
// The one promise that matters most: the recipe the panel shows, applied unchanged, changes NOTHING -- for every
// group of every bundled scene and of the golden CSG cases. Then that what is written is what happens, and that
// whatever is wrong is said at its line and column.
//======================================================================================================================
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as M from '../model.js'
import { generate } from '../codegen.js'
import { GLYPH, handleOf, handlesOf, baseOf, summaryOf, recipeOf, parseRecipe, applyRecipe } from '../recipe.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)

// THE HANDLES: a spreadsheet's columns
eq('handles: a .. z, aa, ab .. zz, aaa', [0, 1, 25, 26, 27, 51, 52, 701, 702].map(handleOf), ['a', 'b', 'z', 'aa', 'ab', 'az', 'ba', 'zz', 'aaa'])

// A RECIPE APPLIED UNCHANGED CHANGES NOTHING: every group of every bundled scene and of the golden cases
{
    const docs = [...['../../scenes/', '../../test/fixtures/scenes/'].flatMap(d => {
            const scenes = fileURLToPath(new URL(d, import.meta.url))
            return readdirSync(scenes).filter(f => f.endsWith('.json')).map(f => [f, readFileSync(scenes + f, 'utf8')])
        }),
        ['csg-v10/cases.json', readFileSync(new URL('./fixtures/csg-v10/cases.json', import.meta.url), 'utf8')]]
    let groups = 0
    const bad = []
    for (const [name, text] of docs) {
        const doc = M.parse(text)
        const before = M.serialize(doc), shader = generate(M.toTree(doc)).wgsl
        M.walk(doc, n => {
            if (n.kind !== 'group' || n === doc.root) return
            groups++
            const r = parseRecipe(recipeOf(n), n)
            if (r.errors.length) return bad.push(`${name} ${n.id}: ${r.errors.map(e => e.message).join('; ')}\n${recipeOf(n)}`)
            applyRecipe(doc, n.id, r.plan)
        })
        if (M.serialize(doc) !== before) bad.push(`${name}: the document changed`)
        if (generate(M.toTree(doc)).wgsl !== shader) bad.push(`${name}: the shader changed`)
    }
    ok(`every group's own recipe reads back and applies as a no-op (${groups} groups)`, groups > 20 && !bad.length, bad.slice(0, 3).join('\n      '))
}

// A GROUP TO WRITE RECIPES FOR: a light first and an export box among the shapes, two labelled alike
const fresh = () => {
    const d = M.createDoc()
    M.addGroup(d, 'root', { id: 'g', blend: 0.1 })
    M.addLight(d, 'g', { id: 'lamp', shape: 'disc' })
    M.addObject(d, 'g', { id: 'p', primitive: 'box', label: 'Plate' })
    M.addObject(d, 'g', { id: 'r1', primitive: 'box', label: 'Rib' })
    M.addExportBox(d, 'g', { id: 'out' })
    M.addObject(d, 'g', { id: 'r2', primitive: 'box', label: 'Rib' })
    M.addObject(d, 'g', { id: 'h', primitive: 'cylinder', label: 'Hole', join: 'subtract', joinBlend: 0.02 })
    return d
}
{
    const d = fresh(), g = M.find(d, 'g').node
    eq('handles by position among the shapes: a light and an export box are none', [...handlesOf(g)], [['p', 'a'], ['r1', 'b'], ['r2', 'c'], ['h', 'd']])
    eq('the recipe: the group\'s blend, consecutive alike joins on one line, the labels as a comment', recipeOf(g).split('\n').map(l => l.replace(/\s+#.*/, '')),
        ['blend 0.1', 'union a, b, c', 'subtract d  blend 0.02'])
    ok('...the comment names each letter\'s child', /# a Plate, b Rib, c Rib/.test(recipeOf(g)) && /# d Hole/.test(recipeOf(g)))
    eq('the summary: the shown shapes, base first', summaryOf(g), `a ${GLYPH.union} b ${GLYPH.union} c ${GLYPH.subtract} d`)
    M.setEnabled(d, 'p', false)
    eq('...a hidden base: the next shown one is the base, and keeps its letter', [baseOf(g).id, summaryOf(g)], ['r1', `b ${GLYPH.union} c ${GLYPH.subtract} d`])
    eq('...cut to the length asked, with an ellipsis', summaryOf(g, 6), 'b ∪ c…')
}

// WHAT IS WRITTEN IS WHAT HAPPENS
const apply = (d, text) => { const r = parseRecipe(text, M.find(d, 'g').node); if (r.plan) applyRecipe(d, 'g', r.plan); return r }
{
    const d = fresh()
    const r = apply(d, 'blend 0.3\nunion c, a\nintersect b  blend 0.05\n- d')
    eq('no errors', r.errors, [])
    const g = M.find(d, 'g').node
    eq('the shapes in the recipe\'s order; the light and the export box keep their places',
        g.children.map(c => c.id), ['lamp', 'r2', 'p', 'out', 'r1', 'h'])
    eq('each one\'s join and own blend; the base joins nothing', g.children.filter(c => c.kind === 'object' && c.type === 'code').map(c => [c.id, c.join ?? 'union', c.joinBlend ?? null]),
        [['r2', 'union', null], ['p', 'union', null], ['r1', 'intersect', 0.05], ['h', 'subtract', null]])
    eq('the group\'s blend', g.blend, 0.3)
    eq('the handles follow the new order', [...handlesOf(g).values()].join(''), 'abcd')
    eq('...and the recipe written from it again says the same', parseRecipe(recipeOf(g), g).plan?.order, ['r2', 'p', 'r1', 'h'])
}
{
    /* A BASE THAT STAYS KEEPS ITS DORMANT JOIN AND BLEND. No recipe can say them (the base's line's op is the
       others'), so applying one that keeps the base leaves them. This said "cleared" until 2026-10-07, which the
       first promise above contradicts: OpticsBench's lens holders, each a box joining by intersect at the top,
       changed under their own recipe. */
    const d = fresh(), shader = generate(M.toTree(d)).wgsl
    M.setJoin(d, 'p', 'subtract'); M.setJoinBlend(d, 'p', 0.4)
    const before = M.serialize(d)
    apply(d, recipeOf(M.find(d, 'g').node))
    eq('the base\'s dormant join and blend are kept: the group\'s own recipe changes nothing', [M.find(d, 'p').node.join, M.find(d, 'p').node.joinBlend, M.serialize(d) === before], ['subtract', 0.4, true])
    const g = generate(M.toTree(d))
    ok('...dormant: the shader is the one without them, and the own blend\'s uniform is still declared for a live write (codegen)',
        g.wgsl === shader && g.uniforms.jblend_p?.def === 0.4)
    apply(d, 'union a, b, c, d')
    eq('no blend line: the group\'s blend is 0; no own blend: none', [M.find(d, 'g').node.blend, M.find(d, 'h').node.joinBlend, M.find(d, 'h').node.join], [0, undefined, undefined])
    apply(d, '∪ "Plate", @r1, c\n∩ d')
    eq('the tree\'s marks for ops, a label in quotes, an @id', M.find(d, 'h').node.join, 'intersect')
}
{
    // a recipe that makes another shape the base: that one joins nothing, as written; the old base joins as written
    const d = fresh()
    M.setJoin(d, 'p', 'subtract'); M.setJoinBlend(d, 'p', 0.4)
    apply(d, 'union d, a, b, c')
    const node = id => M.find(d, id).node
    eq('...a new base\'s join and blend are cleared, and the old base takes the join written for it',
        [node('p').join, node('p').joinBlend, node('h').join, node('h').joinBlend], [undefined, undefined, undefined, undefined])
}

// WHATEVER IS WRONG, SAID WHERE IT IS -- and nothing changed
{
    const d = fresh(), before = M.serialize(d)
    const err = text => { const r = apply(d, text); return r.errors.map(e => `${e.line}:${e.col} ${e.message}`) }
    const one = (name, text, at, re) => {
        const e = err(text)
        ok(name, e.length >= 1 && e[0].startsWith(at) && re.test(e[0]), JSON.stringify(e))
    }
    one('an unknown op, at its start', 'union a, b, c\nxor d', '2:1', /starts with union, subtract or intersect/)
    one('an unknown name, at it', 'union a, b, q, c, d', '1:13', /no child 'q'.*a label goes in quotes/)
    one('a name twice, at the second', 'union a, b, c\nsubtract d, b', '2:13', /b \(Rib\) is listed twice: first at line 1/)
    one('one missing, named by its label', 'union a, b, c', '1:1', /d \(Hole\) is not in the recipe/)
    one('a label that is two children', 'union a, "Rib", c, d', '1:10', /"Rib" is 2 children here \(b, c\)/)
    one('a label that is none', 'union a, "Peg"', '1:10', /no child labelled "Peg"/)
    one('an @id that is not a shape of the group', 'union a, @lamp, b, c, d', '1:10', /no child @lamp/)
    one('a bad blend', 'blend x\nunion a, b, c, d', '1:7', /blend takes one number/)
    one('a blend given twice', 'blend 0.1\nblend 0.2\nunion a, b, c, d', '2:1', /blend is given twice/)
    one('a missing comma', 'union a b, c, d', '1:9', /separated by commas/)
    one('a trailing comma', 'union a, b, c, d,', '1:17', /a comma with no name after it/)
    one('an op with nothing after it', 'union\nunion a, b, c, d', '1:1', /nothing after 'union'/)
    one('a quote not closed', 'union a, "Pla', '1:10', /not closed/)
    one('nothing at all', '# nothing', '1:1', /nothing to combine/)
    eq('...and not one of them changed the document', M.serialize(d), before)
    // a plan made before the group changed is refused, and changes nothing
    const plan = parseRecipe('union a, b, c, d', M.find(d, 'g').node).plan
    M.addObject(d, 'g', { id: 'late', primitive: 'sphere' })
    const now = M.serialize(d)
    let refused = false
    try { applyRecipe(d, 'g', plan) } catch (e) { refused = e instanceof M.ModelError }
    ok('a plan for the group as it was is refused, and changes nothing', refused && M.serialize(d) === now)
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
